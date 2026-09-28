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
    const digest = buildDigest(columnist, snapshot);
    if (!digest) {
      throw new Error(`No digest builder for columnist "${columnist.name}"`);
    }

    const system = buildSystemPrompt(columnist, config);
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
    const system = buildVerificationSystemPrompt(config);
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

function buildVerificationSystemPrompt(config) {
  const lines = [
    "You are a meticulous fact-checker at a sports newspaper, reviewing a colleague's drafted column before it runs.",
    "You will be given the exact data the column was written from, and the drafted headline and body.",
  ];

  if (config.leagueContext) {
    lines.push("", `League facts — do not contradict these: ${config.leagueContext}`);
  }

  lines.push(
    "",
    "Check every specific, checkable claim in the draft against the data below: who leads or trails whom and by how much, standings position, rankings, records, streaks, win-loss totals, and any other number or comparison.",
    "Standings rows are listed in ranked order — the first row in a group is that group's best record — and a smaller (or blank/zero) GB means closer to, or in, first place. Work out each comparison from the actual W, L, and GB values in the data rather than assuming; double-check which side of a 'leads' / 'trails' / 'ahead of' / 'back of' claim is correct before confirming it.",
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

function buildSystemPrompt(columnist, config) {
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
    "If the data is thin, write something shorter and sharper rather than padding it out with invented specifics.",
    "Do not repeat the subject, angle, or phrasing of your recent headlines (listed below, if any) — find a genuinely different angle today.",
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

function buildDigest(columnist, snapshot) {
  const builder = DIGEST_BUILDERS[columnist.name];
  if (!builder) {
    return null;
  }
  return { data: builder(snapshot) };
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

function buildTrendDigest(snapshot) {
  const divisionStandings = (snapshot.standingsSections ?? [])
    .filter((section) => section.kind === "division")
    .map((section) => ({ label: section.label, conference: section.conference, rows: section.rows }));

  return {
    league: snapshot.leagueName,
    date: snapshot.leagueDateLabel,
    divisionStandings,
    championshipChase: snapshot.championshipChase ?? null,
    lookBackItems: snapshot.lookBackItems ?? [],
  };
}
