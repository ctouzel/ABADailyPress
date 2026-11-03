// Generates the opinion columns with live calls to the Anthropic API
// instead of the rules engine in columnFactory.mjs. Each columnist gets a
// persona (from league-config.json / config.mjs — name/role/voice/focus),
// a compact slice of today's snapshot relevant to their beat, and a short
// list of their own recent headlines so they don't repeat an angle.
//
// Only columnists without `active: false` are built — Mack Dalton's and
// Darren Kline's personas stay defined in config so either can come back
// later, but both are skipped here, leaving Matt Gropius as the sole
// "Hot Takes" voice on the front page for now (renderFrontPage.mjs).
//
// Resilience: if ANTHROPIC_API_KEY isn't set, or a call for a given
// columnist fails (network, bad response, rate limit), that columnist
// falls back to the original algorithmic column via
// columnFactory.mjs's buildSingleColumn — the build never breaks because
// the AI is unavailable, it just quietly reverts that one voice for the
// day and logs a warning.
//
// Every draft also goes through a second "fact-check" call (verifyColumn)
// before it's used: the same digest data plus the drafted text goes back
// to the model with instructions to check every checkable claim — who
// leads/trails whom and by how much, rankings, records — against the
// actual numbers, and correct anything that doesn't match. This catches
// the case where a number is real (so the "ground every claim" rule in
// the first pass doesn't trip) but was compared backwards, e.g. a
// standings claim that has the two teams' positions flipped. A failed or
// unavailable verification call just keeps the unverified draft rather
// than failing the column.
import { buildSingleColumn } from "./columnFactory.mjs";
import { callAnthropic, parseJsonResponse, DEFAULT_MODEL } from "./anthropicClient.mjs";
import { isLateSeason, isOutOfContention } from "../lib/seasonProgress.mjs";
import { buildOffseasonDigest, formatMoney, teamsWithNotableActivity } from "../lib/offseasonDigest.mjs";

const MAX_RECENT_HEADLINES = 5;

export async function buildColumns(snapshot, config, previousState = {}) {
  const usedTargets = new Set();
  const activeColumnists = (config.columnists ?? []).filter((columnist) => columnist.active !== false);

  const columns = await Promise.all(
    activeColumnists.map((columnist) => buildOneColumn(snapshot, columnist, config, previousState, usedTargets)),
  );

  return columns.filter(Boolean);
}

async function buildOneColumn(snapshot, columnist, config, previousState, usedTargets) {
  const priorState = previousState[columnist.name];
  const recentHeadlines = (priorState?.recent ?? [])
    .map((entry) => entry.headline)
    .filter(Boolean)
    .slice(0, MAX_RECENT_HEADLINES);

  try {
    const digest = buildDigest(columnist, snapshot, config);
    if (!digest) {
      throw new Error(`No digest builder for columnist "${columnist.name}"`);
    }

    const system = buildSystemPrompt(columnist, config, snapshot);
    const prompt = buildUserPrompt(digest, recentHeadlines);
    const model = process.env.ANTHROPIC_COLUMN_MODEL || DEFAULT_MODEL;
    const raw = await callAnthropic({ system, prompt, maxTokens: 1000, model, temperature: 0.7 });
    const parsed = parseJsonResponse(raw);

    if (!parsed.headline || !parsed.body) {
      throw new Error("model response is missing a headline or body");
    }

    const draftColumn = {
      author: columnist.name,
      role: columnist.role,
      voice: columnist.voice,
      focus: columnist.focus,
      headline: String(parsed.headline).trim(),
      body: String(parsed.body).trim(),
      topicKey: String(parsed.topicKey ?? "").trim(),
      targetKey: String(parsed.topicKey ?? "").trim(),
    };

    return await verifyColumn(draftColumn, digest, config, model);
  } catch (error) {
    console.warn(`[aiColumnFactory] ${columnist.name}: falling back to the algorithmic column (${error.message})`);
    return buildSingleColumn(snapshot, columnist, priorState, usedTargets);
  }
}

// ---------- verification pass ----------
// Hands the draft back to the model alongside the exact data it was
// written from and asks it to check every specific, checkable claim
// before the column runs. Run at a low temperature since this pass should
// be precise rather than creative. Any failure here (no API key, network,
// bad JSON) just keeps the unverified draft — this is a quality pass on
// top of a working column, not a step the build depends on.
async function verifyColumn(draftColumn, digest, config, model) {
  try {
    const system = buildVerificationSystemPrompt(config, digest);
    const prompt = buildVerificationUserPrompt(draftColumn, digest);
    const raw = await callAnthropic({ system, prompt, maxTokens: 1000, model, temperature: 0.2 });
    const parsed = parseJsonResponse(raw);

    if (!parsed.headline || !parsed.body) {
      throw new Error("verification response is missing a headline or body");
    }

    return {
      ...draftColumn,
      headline: String(parsed.headline).trim(),
      body: String(parsed.body).trim(),
      topicKey: String(parsed.topicKey ?? draftColumn.topicKey ?? "").trim(),
      targetKey: String(parsed.topicKey ?? draftColumn.targetKey ?? "").trim(),
    };
  } catch (error) {
    console.warn(`[aiColumnFactory] ${draftColumn.author}: verification pass failed, keeping the unverified draft (${error.message})`);
    return draftColumn;
  }
}

function buildVerificationSystemPrompt(config, digest) {
  const lines = [
    "You are a meticulous fact-checker at a sports newspaper, reviewing a colleague's drafted column before it runs.",
    "You will be given the exact data the column was written from, and the drafted headline and body.",
  ];

  if (digest?.data?.mode === "offseason") {
    lines.push(
      "",
      "This column was written during the offseason. Any standings numbers in the data reflect the FINAL completed season, not one in progress — do not apply the magic-number/\"clinched\" check below to them, and do not flag a completed-season claim (e.g. \"finished first last season\", \"returning as the division winner\") as season-state overreach. The draft's own forward-looking prediction or opinion about the upcoming season is not a checkable claim — leave it alone unless it misstates an underlying number from the data (a dollar figure, a player name, a past-season standings position).",
    );
  }

  if (config.leagueContext) {
    lines.push("", `League facts — do not contradict these: ${config.leagueContext}`);
  }

  lines.push(
    "",
    "Check every specific, checkable claim in the draft against the data below: who leads or trails whom and by how much, standings position, rankings, records, streaks, win-loss totals, and any other number or comparison.",
    "Standings rows are listed in ranked order — the first row in a group is that group's best record — and a smaller (or blank/zero) GB means closer to, or in, first place. Work out each comparison from the actual W, L, and GB values in the data rather than assuming; double-check which side of a 'leads' / 'trails' / 'ahead of' / 'back of' claim is correct before confirming it.",
    "Also check for season-state overreach: the draft must not say or imply a division, pennant race, wild card spot, or a team's season is \"clinched,\" \"won,\" \"wrapped up,\" \"over,\" \"sealed,\" or similar unless that team's magic number (\"M#\") is exactly 0 in the data. If the draft declares a race decided while the magic number is blank, missing, or greater than 0 — or games remain (\"gamesRemaining\") — rewrite that claim to describe the race as still open (games back, magic number) instead.",
    "The draft may include the columnist's own prediction about something that hasn't happened yet (who wins a series, how a race turns out). A prediction is not a checkable claim — never 'correct' it just because the predicted outcome hasn't occurred, and never treat a clearly-marked forecast (\"my pick is\", \"here's the call\", etc.) as season-state overreach. Only touch a prediction if it misstates the CURRENT data it's reasoning from (e.g. the actual current series score, standings position, or magic number it cites) — fix that underlying number, not the forecast itself.",
    "If a claim is wrong, rewrite only what's needed to make it accurate — keep the columnist's voice, structure, and everything else exactly as drafted. If nothing is wrong, return the draft unchanged. Do not add any new claim or number that wasn't already in the draft or the data.",
    "",
    "Reply with ONLY a single JSON object and nothing else — no preamble, no code fence, no notes about what you changed — in exactly this shape:",
    '{"headline": "...", "body": "...", "topicKey": "..."}',
  );

  return lines.join("\n");
}

function buildVerificationUserPrompt(draftColumn, digest) {
  return [
    `Data the column was written from:\n${JSON.stringify(digest.data, null, 2)}`,
    "",
    `Drafted headline:\n${draftColumn.headline}`,
    "",
    `Drafted body:\n${draftColumn.body}`,
  ].join("\n");
}

// ---------- prompts ----------

// Extra system-prompt rules for a specific columnist, appended after the
// shared rules above. Keyed by columnist.name the same way DIGEST_BUILDERS
// is below, so a columnist only gets the lines relevant to their own beat.
const COLUMNIST_SYSTEM_PROMPT_EXTRAS = {
  // Matt Gropius's digest (buildTrendDigest, below) tags each standings
  // row with "outOfContention": true once it's late season and that team
  // is behind by more games than it has left to play — see
  // src/lib/seasonProgress.mjs. Without this rule the model will still
  // happily spin a "forming division race" or "slow-building arc" angle
  // around a team that's been mathematically dead for weeks, because the
  // raw W/L/GB numbers alone don't say so.
  "Matt Gropius": [
    "Out-of-contention rule: check \"lateSeason\" and each standings row's \"outOfContention\" flag in the data below. Once lateSeason is true, never frame a team marked outOfContention as part of a live division race, a wild-card hunt, or a \"forming\" or \"building\" arc toward the postseason — that framing stops making sense once a team is this far back with this little season left. You may still mention an out-of-contention team in passing (a spoiler role, a trend worth noting in its own right, a note on how a division shook out), but do not make one the column's main subject or angle while lateSeason is true. If every team you'd otherwise write about is marked outOfContention, pick a different angle instead: a division or wild-card race that's still live, or the championship chase data below.",
    "Prediction rule: every column needs a real, specific forward-looking call, not just a read on where things stand today. If \"championshipChase\" below is in the playoffs phase and has a live series (two real teams, at least one with \"seriesWins\" set), predict how that series actually ends — who wins it and, if you want, in how many games. Otherwise, make a concrete call about where a division or wild-card race is headed next (who takes the division, who closes the gap, how many games separate them when it's settled, who you expect to be playing in October) using the standings and \"gamesRemaining\" data below. State it plainly as your own forecast — \"my money's on\", \"here's the call\", \"I'll go on record\" — never as something that has already happened, and never hedge it away with \"anything could happen\" or similar. Make exactly one such call per column.",
  ],
};

// Matt Gropius's extras while snapshot.currentMode === "OFFSEASON" — used
// instead of (not alongside) COLUMNIST_SYSTEM_PROMPT_EXTRAS["Matt Gropius"]
// above, since those rules (out-of-contention framing, "live series"
// predictions) assume games are actually being played. The digest for this
// mode comes from buildMattOffseasonDigestData below, which reuses the
// same src/lib/offseasonDigest.mjs classification the algorithmic
// columnFactory.mjs offseason topics use, so both paths agree on what
// counts as a notable move.
const MATT_OFFSEASON_SYSTEM_PROMPT_LINES = [
  "It is currently the offseason — there are no games, streaks, or live standings race to write about, so do not write as though the season is in progress.",
  "The data below gives you up to five possible offseason angles: \"bigSigning\" (the most notable free-agent deal or extension of the window, or null if there isn't one), \"teamOffseasonActivity\" (a list of teams and what each one signed, lost, or traded this winter), \"divisions\" (each division's final standings from last season, its returning leader, and whether that leader reinforced itself this winter), and \"teamSpendRanking\" (every team with offseason activity, ranked by total guaranteed dollars committed to major-league free-agent signings and extensions).",
  "Pick exactly ONE of these five angles for today's column: (1) the \"bigSigning\" entry — what it means for that team and your read on why the player chose it — only if \"bigSigning\" is not null; (2) one team from \"teamOffseasonActivity\" and your read on its upcoming season; (3) a prediction for one division from \"divisions\" for the upcoming season, grounded in who returns as the leader and whether they reinforced themselves; (4) your top three offseason teams, using the highest \"totalCommitted\" entries in \"teamSpendRanking\"; (5) your three quietest offseason teams, using the lowest \"totalCommitted\" entries (favoring ones that also show departures). Skip an angle the data is too thin for — don't force a division or team pick, and skip bigSigning if it's null.",
  "Every dollar figure, player name, position, contract length, team name, and standings number you use must come directly from the data below. You may freely speculate in your own voice about motivation, fit, and outlook — why a player picked a team, what a front office believes, how a race plays out next season — that speculation is the column's opinion content, but never invent a number, a transaction, or a player that isn't in the data.",
  "Set topicKey to a short slug naming which of the five angles you picked and its subject, e.g. \"offseason-big-signing:David Shelton\" or \"offseason-division-call:Rosenthal\".",
];

function buildSystemPrompt(columnist, config, snapshot) {
  const lines = [
    `You are ${columnist.name}, ${columnist.role} at "${config.newspaperName}", the daily paper covering the ${config.leagueName}.`,
    `Your voice: ${columnist.voice}.`,
    `Your beat: ${columnist.focus}.`,
  ];

  if (config.leagueContext) {
    lines.push("", `League facts — do not contradict these: ${config.leagueContext}`);
  }

  lines.push(
    "",
    "Write like a real newspaper columnist, not a stats-recap script. Form an actual opinion or angle from the data below — don't just restate numbers or scores back at the reader. Surprise them. Stay fully in character and never mention that you are an AI, a model, a prompt, or that this is a simulated league — write as if these games, players, and teams are real.",
    "Numbers rule: every statistic, ranking, record, or streak you cite — for a player, a team, a manager/coach, or anyone else — must be copied exactly from the data below. Never estimate, round differently, or invent one, and never invent a won-loss record, tenure, or career number for a manager or coach when none is given. If you want to mention a person or team that isn't in the data (or is in the data by name only), you may name them with no numbers attached, or leave them out entirely. When in doubt, don't cite a number.",
    "Season-state rule: never say or imply that a division, pennant race, wild card spot, or a team's season is \"clinched,\" \"won,\" \"wrapped up,\" \"over,\" \"sealed,\" or similar, unless that team's magic number (\"M#\" in the standings data) is exactly 0. If a row's magic number is blank, missing, or greater than 0 — or it has games remaining (\"gamesRemaining\") left to play — treat that race as still open, however large the lead looks, and write about it in terms of the games-back gap and the magic number, not as a settled outcome.",
    "If the data is thin, write something shorter and sharper rather than padding it out with invented specifics.",
    "Do not repeat the subject, angle, or phrasing of your recent headlines (listed below, if any) — find a genuinely different angle today.",
    ...(columnist.name === "Matt Gropius" && snapshot?.currentMode === "OFFSEASON"
      ? MATT_OFFSEASON_SYSTEM_PROMPT_LINES
      : COLUMNIST_SYSTEM_PROMPT_EXTRAS[columnist.name] ?? []),
    "",
    "Reply with ONLY a single JSON object and nothing else — no preamble, no code fence, no sign-off — in exactly this shape:",
    '{"headline": "a punchy headline under 90 characters, no byline or colon-prefixed name", "body": "two to four short paragraphs of plain text separated by \\n\\n, no markdown formatting", "topicKey": "a short slug for today\'s main subject, e.g. a team or player name"}',
  );

  return lines.join("\n");
}

function buildUserPrompt(digest, recentHeadlines) {
  const recentBlock = recentHeadlines.length
    ? `Your last ${recentHeadlines.length} headline(s) — do not repeat these angles:\n${recentHeadlines.map((headline) => `- ${headline}`).join("\n")}\n\n`
    : "";

  return `${recentBlock}Today's data for your beat:\n${JSON.stringify(digest.data, null, 2)}`;
}

// ---------- per-columnist data digests ----------
// Each digest is a deliberately narrow slice of the snapshot — enough for
// a real angle, not the whole export — to keep the model focused and the
// request cheap.

function buildDigest(columnist, snapshot, config) {
  const builder = DIGEST_BUILDERS[columnist.name];
  if (!builder) {
    return null;
  }
  return { data: builder(snapshot, config) };
}

const DIGEST_BUILDERS = {
  "Mack Dalton": buildRecapDigest,
  "Darren Kline": buildAnalyticsDigest,
  "Matt Gropius": buildTrendDigest,
};

function buildRecapDigest(snapshot) {
  const games = (snapshot.lastDayScores ?? []).slice(0, 5).map((game) => ({
    matchup: `${game.awayTeam} ${game.awayRuns} @ ${game.homeTeam} ${game.homeRuns}`,
    summary: game.summary,
    recap: game.recapText,
    winningPitcher: game.winningPitcher ? `${game.winningPitcher} (${game.winningPitcherRecord})` : null,
    losingPitcher: game.losingPitcher ? `${game.losingPitcher} (${game.losingPitcherRecord})` : null,
    savePitcher: game.savePitcher ? `${game.savePitcher} (${game.savePitcherRecord})` : null,
    homeRuns: game.homeRunSummary || null,
    playerOfTheGame: game.playerOfTheGame || null,
    notablePlays: (game.notablePlays ?? []).map((play) => `${play.inning}: ${play.player} ${play.text}`),
  }));

  return {
    league: snapshot.leagueName,
    date: snapshot.leagueDateLabel,
    games,
    threeStars: snapshot.threeStarsOfDay ?? [],
  };
}

function buildAnalyticsDigest(snapshot) {
  const divisionStandings = (snapshot.standingsSections ?? [])
    .filter((section) => section.kind === "division")
    .map((section) => ({ label: section.label, conference: section.conference, rows: section.rows }));

  return {
    league: snapshot.leagueName,
    date: snapshot.leagueDateLabel,
    battingLeaderboards: (snapshot.battingLeaderboards ?? []).slice(0, 6),
    pitchingLeaderboards: (snapshot.pitchingLeaderboards ?? []).slice(0, 6),
    divisionStandings,
    positionalStrength: snapshot.positionalStrengthFeature ?? null,
  };
}

// Matt Gropius's beat is division-race narrative, so his digest needs
// more than the bare W/L/GB a recap or analytics column could get away
// with — it also needs to know how settled each race actually is.
// standingsSections rows already carry "M#" (magic number) straight from
// OOTP's own standings export when the game populates it, but that
// column can be blank or absent early in the season (the same reason
// renderFrontPage.mjs's standings table only shows it in the back half
// of the schedule — see isLateSeason() in src/lib/seasonProgress.mjs).
// gamesRemaining is computed here from config.regularSeasonGames so the
// column always has a reliable "how much season is left" fact to reason
// from, even on days the magic number itself isn't populated yet.
//
// Once it's late season, each row also gets "outOfContention": a team
// that's behind by more games than it has left to play can't be part of
// a real division-race narrative anymore, however the W/L record reads —
// see the "Matt Gropius" entry in COLUMNIST_SYSTEM_PROMPT_EXTRAS above,
// which tells the model not to write about one as if it still were.
function buildTrendDigest(snapshot, config) {
  if (snapshot?.currentMode === "OFFSEASON") {
    return buildMattOffseasonDigestData(snapshot);
  }

  const regularSeasonGames = Number(config?.regularSeasonGames) || 0;
  const lateSeason = isLateSeason(snapshot.standingsSections ?? [], regularSeasonGames);
  const divisionStandings = (snapshot.standingsSections ?? [])
    .filter((section) => section.kind === "division")
    .map((section) => ({
      label: section.label,
      conference: section.conference,
      rows: section.rows.map((row) => {
        const gamesRemaining = computeGamesRemaining(row, regularSeasonGames);
        return {
          ...row,
          gamesRemaining,
          outOfContention: lateSeason && isOutOfContention(row.GB, gamesRemaining),
        };
      }),
    }));

  return {
    league: snapshot.leagueName,
    date: snapshot.leagueDateLabel,
    lateSeason,
    divisionStandings,
    championshipChase: snapshot.championshipChase ?? null,
    lookBackItems: snapshot.lookBackItems ?? [],
  };
}

// Matt Gropius's offseason digest — see MATT_OFFSEASON_SYSTEM_PROMPT_LINES
// above for how the model is instructed to use this. Built from the same
// src/lib/offseasonDigest.mjs classification columnFactory.mjs's
// algorithmic offseason topics use, so the AI-written path and the
// algorithmic fallback agree on what counts as a notable move — only the
// prose differs.
function buildMattOffseasonDigestData(snapshot) {
  const digest = buildOffseasonDigest(snapshot.transactions ?? []);

  const bigMove = digest.bigMoves[0] ?? null;
  const bigSigning = bigMove
    ? {
        team: bigMove.team,
        player: bigMove.player,
        position: bigMove.position,
        years: bigMove.years,
        totalValue: bigMove.totalValue,
        totalValueFormatted: formatMoney(bigMove.totalValue),
        dealType: bigMove.type,
      }
    : null;

  const teamOffseasonActivity = teamsWithNotableActivity(digest).map((record) => ({
    team: record.team,
    signings: record.signings
      .filter((signing) => signing.type !== "minor-league-signing")
      .map((signing) => ({
        player: signing.player,
        position: signing.position,
        years: signing.years,
        totalValueFormatted: formatMoney(signing.totalValue),
      })),
    departures: record.departures.map((departure) => ({ player: departure.player, type: departure.type })),
    tradeCount: record.trades.length,
    totalCommittedFormatted: formatMoney(record.totalCommitted),
  }));

  const divisions = (snapshot.standingsSections ?? [])
    .filter((section) => section.kind === "division" && section.rows?.length)
    .map((section) => {
      const leaderRow =
        section.rows.find((row) => String(row.GB ?? "").trim() === "-" || Number.parseFloat(row.GB) === 0) ?? section.rows[0];
      const leaderTeam = leaderRow?.Team ?? null;
      const leaderRecord = leaderTeam ? digest.byTeam.get(leaderTeam) : null;
      const leaderReinforcedThisWinter = Boolean(
        leaderRecord?.signings.some((signing) => signing.type !== "minor-league-signing") || leaderRecord?.totalCommitted > 0,
      );
      return {
        division: section.label,
        finalStandingsLastSeason: section.rows.map((row) => ({ team: row.Team, W: row.W, L: row.L, GB: row.GB })),
        returningLeader: leaderTeam,
        leaderReinforcedThisWinter,
      };
    });

  const teamSpendRanking = digest.teamSpendRanking.map((row) => ({
    team: row.team,
    totalCommitted: row.totalCommitted,
    totalCommittedFormatted: formatMoney(row.totalCommitted),
    signingCount: row.signingCount,
    departureCount: row.departureCount,
  }));

  return {
    mode: "offseason",
    league: snapshot.leagueName,
    date: snapshot.leagueDateLabel,
    bigSigning,
    teamOffseasonActivity,
    divisions,
    teamSpendRanking,
  };
}

function computeGamesRemaining(row, regularSeasonGames) {
  if (!regularSeasonGames) {
    return null;
  }

  const wins = Number(row.W);
  const losses = Number(row.L);
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) {
    return null;
  }

  return Math.max(regularSeasonGames - (wins + losses), 0);
}

export { buildDigest as __test_buildDigest, buildSystemPrompt as __test_buildSystemPrompt, buildVerificationSystemPrompt as __test_buildVerificationSystemPrompt };
