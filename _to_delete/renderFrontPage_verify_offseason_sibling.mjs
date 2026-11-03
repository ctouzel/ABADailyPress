// Modern Broadsheet front-page renderer.
//
// Consumes the same (snapshot, columns, config) shape that the legacy
// renderEdition.mjs receives — see src/services/snapshotBuilder.mjs and
// src/services/columnFactory.mjs for the exact fields available.
//
// Design: quick overview above the fold (hero + secondary stories, a
// sidebar with Three Stars / a featured-division standings snippet with a
// jump link / a batting-average leaders snippet), then last night's scores
// at the same overview depth, then the full "Pennant Races" section further
// down the page with every standings table, then Matt Gropius's Hot Takes
// column, then an injuries/transactions footer ticker.
//
// Sections not yet designed (positional leaderboard rankings, financial
// data, etc.) are intentionally left out for now rather than guessed at
// — see the project notes for what's still open.

import { isLateSeason as isLateSeasonShared } from "../lib/seasonProgress.mjs";

export function renderFrontPageHtml(snapshot, columns, config, interview) {
  const newspaperName = config?.newspaperName ?? "The ABA Daily Press";
  const leagueName = config?.leagueName ?? "American Baseball League";
  const city = config?.city ?? "Grand Harbor";

  const featuredHeadlines = sortHeadlines(dedupeHeadlines(snapshot.headlines ?? [])).slice(0, 6);
  const mastheadDateLabel = withLeagueYear(snapshot.leagueDateLabel, snapshot);

  const featured = pickFeaturedDivision(snapshot.standingsSections ?? [], snapshot.leagueDateLabel);
  const featuredLeaderboard = pickFeaturedLeaderboard(
    snapshot.battingLeaderboards ?? [],
    snapshot.pitchingLeaderboards ?? [],
    snapshot.leagueDateLabel,
  );
  const showMagicNumber = isLateSeason(snapshot.standingsSections ?? [], config);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(newspaperName)} — ${escapeHtml(snapshot.leagueDateLabel ?? "")}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,72,400;0,72,500;0,72,600;1,72,400&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>${pageStyles}</style>
</head>
<body>
<div class="page">

  <div class="util-strip">
    <div class="util-left">
      <span>${escapeHtml(city)} Edition</span>
      <span class="dim">${escapeHtml(leagueName)}</span>
    </div>
    <div class="util-right">
      <a href="#news-section">News</a><a href="#opinion-section">Hot Takes</a><a href="#pennant-races">Standings</a><a href="#leaders-section">Leaders</a><a href="#schedule">Schedule</a>
    </div>
  </div>

  <header class="masthead">
    <h1>${escapeHtml(newspaperName)}</h1>
    <div class="masthead-meta">
      <span>${escapeHtml(mastheadDateLabel)}</span>
      <span>${escapeHtml(formatMode(snapshot.currentMode))}</span>
    </div>
  </header>

  <div class="main-grid">
    <div class="lead-column">
      ${featuredHeadlines.length ? renderHeadlineList(featuredHeadlines) : `<p class="empty-state">No headline candidates were detected in the current export.</p>`}
    </div>

    <aside class="sidebar">
      ${renderThreeStars(snapshot.threeStarsOfDay ?? [])}
      ${featured ? renderStandingsSnippet(featured) : ""}
      ${featuredLeaderboard ? renderLeadersSnippet(featuredLeaderboard) : ""}
    </aside>
  </div>

  ${renderBoxScores(snapshot.lastDayScores ?? [])}

  ${renderTopGamePerformancesSection(snapshot.topGamePerformancesFeature)}

  ${renderPlayoffRace(snapshot.championshipChase)}

  ${renderNewsSection(featuredHeadlines)}

  ${snapshot.championshipChase?.phase === "playoffs" ? "" : renderPennantRaces(snapshot.standingsSections ?? [], showMagicNumber)}

  ${renderOpinionSection(columns ?? [])}

  ${renderLeadersSection(snapshot.battingLeaderboards ?? [], snapshot.pitchingLeaderboards ?? [])}

  ${renderPositionalStrengthSection(snapshot.positionalStrengthFeature)}

  ${renderHistoricalLeadersSection(snapshot.leagueCareerLeaders, snapshot.teamCareerLeaders)}

  ${renderPositionalRankingsSection(snapshot.positionCareerLeaderboard)}

  ${renderNumberOnePicksSection(snapshot.numberOnePicksFeature)}

  ${renderFooterTicker(snapshot.injuries ?? [], snapshot.transactions ?? [])}

  ${renderSchedule(snapshot.scheduledGames ?? [])}

  ${renderProspectsSection(snapshot.prospectHighlight, snapshot.topFarmSystems ?? [])}

  ${renderFreeAgentsSection(snapshot.upcomingFreeAgents ?? [])}

  ${renderMilestonesSection(snapshot.playerMilestones ?? [], snapshot.managerHighlightFeature)}

  ${renderPlayerInterviewSection(snapshot.playerInterviewFeature, interview)}

  ${renderTeamHighlightSection(snapshot.playerInterviewFeature?.teamHighlight)}

  ${renderMinorLeaguesSection([snapshot.frontierLeague])}

</div>
</body>
</html>`;
}

// ---------- collapsible sections (native <details>/<summary>, no JS) ----------
//
// Wraps an already-rendered section body in a native disclosure widget
// instead of a plain <section>: the browser handles open/closed state,
// keyboard toggling (Enter/Space) and the closed-by-default look for
// free, with no client-side script. `open: true` renders it expanded;
// omitting it (the default) renders collapsed — used for "Today's
// Schedule" and "The Full Wire" per the user's request, and reusable for
// any other section that should default to collapsed later.
function renderCollapsibleSection(id, className, labelText, bodyHtml, { open = false } = {}) {
  return `
    <details id="${id}" class="${className} collapsible"${open ? " open" : ""}>
      <summary class="label">${escapeHtml(labelText)}<span class="chevron" aria-hidden="true">&rsaquo;</span></summary>
      ${bodyHtml}
    </details>
  `;
}

// ---------- headlines (snippet above the fold + full News section) ----------

function renderHeadlineList(headlines) {
  return `
    <div class="news-snippet">
      <div class="label dark">Today's Headlines</div>
      <ul class="headline-list">
        ${headlines
          .map(
            (headline, index) => `
              <li>
                <a class="headline-link" href="#news-${index}">${escapeHtml(summarizeHeadline(headline))}</a>
                <div class="headline-meta">
                  <span class="tag-inline">${escapeHtml(inferTag(headline))}</span>
                  ${headline.date ? `<span class="dim">${escapeHtml(headline.date)}</span>` : ""}
                </div>
              </li>
            `,
          )
          .join("")}
      </ul>
      <a class="jump-link" href="#news-section">Read full stories &darr;</a>
    </div>
  `;
}

function renderNewsSection(headlines) {
  if (!headlines.length) {
    return "";
  }

  const body = `
      <div class="news-articles">
        ${headlines
          .map(
            (headline, index) => `
              <article id="news-${index}" class="news-article">
                <div class="tag">${escapeHtml(inferTag(headline))}</div>
                <h3>${escapeHtml(summarizeHeadline(headline))}</h3>
                ${headline.date ? `<div class="dateline">${escapeHtml(headline.date.toUpperCase())}</div>` : ""}
                ${formatArticleBody(headline.fullText || headline.summary || "")}
              </article>
            `,
          )
          .join("")}
      </div>
  `;

  return renderCollapsibleSection("news-section", "news-section", "The Full Wire", body);
}

// Some OOTP-generated headlines are just the raw transaction sentence dumped
// as the title ("The X traded ... to the Y , getting ... in return."),
// which reads as a wall of text in a headline slot. Condense a completed
// trade into "<Team> acquires <POS> <Player> from <Team>", built around
// whichever player in the deal matters most (the oldest, most of the time).
// Anything else that's still unusually long falls back to a plain
// truncation so it never blows out the headline layout.
function summarizeHeadline(headline) {
  const title = String(headline?.title ?? "").trim();
  return (
    summarizeTradeHeadline(title) ??
    summarizePlayerOfWeekHeadline(title) ??
    summarizeCycleHeadline(title) ??
    summarizeHittingStreakEndHeadline(title) ??
    truncateHeadline(title)
  );
}

// "<POS> <Name> of the <Team> honored: Wins the ABA <CONF> Player of the
// Week Award." is another raw sentence OOTP hands us verbatim as a title —
// condense it to "<Team> <Name> is the <CONF> Player of the Week". The
// league code varies (ABA for the majors, FL for the Frontier League,
// and whatever a future minor league uses), so it's matched generically
// rather than hardcoded to "ABA".
const PLAYER_OF_WEEK_SENTENCE =
  /^[A-Z0-9]{1,3}\s+([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)*)\s+of the (.+?) honored: Wins the [A-Z]{2,4} (\w+) Player of the Week Award\.?$/;

function summarizePlayerOfWeekHeadline(title) {
  const match = title.match(PLAYER_OF_WEEK_SENTENCE);
  if (!match) {
    return null;
  }

  const [, name, team, conference] = match;
  return `${shortenTeamName(team)} ${name} is the ${conference} Player of the Week`;
}

// "<Team> : <Name> hits for the CYCLE, going 4-5 against the <Team>, ..." is
// another raw box-score-highlight title OOTP hands us verbatim — condense
// it to "<Team> <Name> hits for the CYCLE".
const CYCLE_SENTENCE = /^(.+?)\s*:\s*([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)*)\s+hits for the cycle\b/i;

function summarizeCycleHeadline(title) {
  const match = title.match(CYCLE_SENTENCE);
  if (!match) {
    return null;
  }

  const [, team, player] = match;
  return `${shortenTeamName(team)} ${player} hits for the CYCLE`;
}

// "<Team> : <Name> goes 0-3 against the <Team> , ending his hitting
// streak..." is another raw box-score-highlight title OOTP hands us
// verbatim — condense it to "<Team> <Name> goes 0-3 against <Team>, ending
// his hitting streak".
const HITTING_STREAK_END_SENTENCE =
  /^(.+?)\s*:\s*([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)*)\s+goes\s+(\d+-\d+)\s+against the\s+(.+?)\s*,\s*ending his hitting streak\b/i;

function summarizeHittingStreakEndHeadline(title) {
  const match = title.match(HITTING_STREAK_END_SENTENCE);
  if (!match) {
    return null;
  }

  const [, team, player, record, opponent] = match;
  return `${shortenTeamName(team)} ${player} goes ${record} against ${shortenTeamName(opponent)}, ending his hitting streak`;
}

const TRADE_SENTENCE = /^The (.+?) traded (.+?) to the (.+?)\s*,\s*getting (.+?) in return\.?$/;

function summarizeTradeHeadline(title) {
  const match = title.match(TRADE_SENTENCE);
  if (!match) {
    return null;
  }

  const [, teamA, givenByA, teamB, givenByB] = match;
  const players = [
    ...extractTradedPlayers(givenByA).map((player) => ({ ...player, ownerAfter: teamB })),
    ...extractTradedPlayers(givenByB).map((player) => ({ ...player, ownerAfter: teamA })),
  ];

  if (!players.length) {
    return null;
  }

  const keyPlayer = players.reduce((best, player) => (player.age > best.age ? player : best));
  const acquirer = keyPlayer.ownerAfter;
  const other = acquirer === teamA ? teamB : teamA;

  return `${shortenTeamName(acquirer)} acquires ${keyPlayer.position} ${keyPlayer.name} from ${shortenTeamName(other)}`;
}

// Pulls every "<age>-year old [minor league] <POS> <Name>" player mention out
// of one side of a trade sentence. Cash and retained-salary notes don't
// match (no age/position to anchor on), which is what we want — only real
// players are candidates for "most important asset in the deal".
function extractTradedPlayers(text) {
  const pattern = /(\d+)-year old(?:\s+minor league)?\s+([A-Z0-9]{1,3})\s+([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)*)/g;
  return [...text.matchAll(pattern)].map((match) => ({
    age: Number(match[1]),
    position: match[2],
    name: match[3].trim(),
  }));
}

function truncateHeadline(title, maxLength = 100) {
  if (title.length <= maxLength) {
    return title;
  }
  const truncated = title.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated}…`;
}

// Splits article text into paragraphs, and turns paragraphs that are really
// an inline list (OOTP's report text runs list items together with no line
// breaks — numbered team rankings, or repeated "Name, TEAM, value" leader
// groups) into a proper <ol>/<ul> instead of one hard-to-read run of text.
function formatArticleBody(text) {
  const paragraphs = String(text ?? "")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return "";
  }

  return paragraphs.map(formatArticleParagraph).join("");
}

function formatArticleParagraph(paragraph) {
  return (
    extractNumberedList(paragraph) ??
    extractLeaderList(paragraph) ??
    `<p>${escapeHtml(paragraph)}</p>`
  );
}

// Detects "Teams (Total Points, Tendency): 1) Team A (118.1, ++) 2) Team B
// (116.7, -) ..." style text and splits it into an ordered list.
function extractNumberedList(paragraph) {
  const markers = [...paragraph.matchAll(/(?:^|\s)(\d{1,2})\)\s*/g)];
  if (markers.length < 2) {
    return null;
  }

  const intro = paragraph.slice(0, markers[0].index).trim();
  const items = markers
    .map((marker, i) => {
      const start = marker.index + marker[0].length;
      const end = i + 1 < markers.length ? markers[i + 1].index : paragraph.length;
      return paragraph.slice(start, end).trim();
    })
    .filter(Boolean);

  if (items.length < 2) {
    return null;
  }

  const introHtml = intro ? `<p>${escapeHtml(intro)}</p>` : "";
  const listHtml = `<ol class="article-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
  return introHtml + listHtml;
}

// Detects "Blake Debro , NOR, .462 Roy Hobbs , SAV, .443 ..." style leader
// lists (a run of "Name, TEAM, value" groups with no separators) and splits
// them into an unordered list.
function extractLeaderList(paragraph) {
  const itemPattern = /[A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)*\s*,\s*[A-Z]{2,4}\s*,\s*\.?\d+(?:\.\d+)?/g;
  const matches = [...paragraph.matchAll(itemPattern)];
  if (matches.length < 2) {
    return null;
  }

  const items = matches.map((match) => match[0].trim());
  const coveredLength = items.reduce((sum, item) => sum + item.length, 0);
  if (coveredLength < paragraph.length * 0.5) {
    return null;
  }

  const intro = paragraph.slice(0, matches[0].index).trim();
  const introHtml = intro ? `<p>${escapeHtml(intro)}</p>` : "";
  const listHtml = `<ul class="article-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return introHtml + listHtml;
}

function inferTag(headline) {
  const text = `${headline.title ?? ""} ${headline.summary ?? ""}`.toLowerCase();
  if (/trade|swap|deal/.test(text)) return "Trade";
  if (/sign|contract|free agent/.test(text)) return "Transaction";
  if (/injur|strain|surgery/.test(text)) return "Injury";
  if (/streak|milestone|award|honor/.test(text)) return "Feat";
  return "News";
}

// OOTP often exports the same story more than once (e.g. a "Player of the
// Week" recap turns up as its own news page and again as a home-page
// blurb) with different titles but identical body text. Keep the first
// occurrence — it carries the higher relevance score, which is also the
// fuller, more official-sounding headline — and drop the rest so the same
// story never fills two headline slots.
function dedupeHeadlines(headlines) {
  const seenText = new Set();
  const seenTitle = new Set();

  return headlines.filter((headline) => {
    const fullText = String(headline.fullText ?? "").trim();
    if (fullText) {
      if (seenText.has(fullText)) {
        return false;
      }
      seenText.add(fullText);
      return true;
    }

    const title = String(headline.title ?? "").trim().toLowerCase();
    if (title && seenTitle.has(title)) {
      return false;
    }
    seenTitle.add(title);
    return true;
  });
}

// Headlines are shown newest-day-first, and within a day by a rough
// editorial priority: top-of-the-wire feats (no-hitters, perfect games,
// championships) lead, then critical injuries / incredible feats / real
// trades, then Player of the Week honors, then everything else, then trade
// rumors, with weekly power rankings and stat dumps always last — those
// are reference filler, not news.
const HEADLINE_PRIORITY = {
  TOP: 0,
  HIGH: 1,
  MEDIUM: 2,
  DEFAULT: 3,
  LOW: 4,
  LAST: 5,
};

function classifyHeadlinePriority(headline) {
  const title = String(headline?.title ?? "");
  const text = `${headline?.title ?? ""} ${headline?.summary ?? ""} ${headline?.fullText ?? ""}`.toLowerCase();

  // Always last — weekly filler, not news.
  if (/power rankings|bnn stats/.test(text)) {
    return HEADLINE_PRIORITY.LAST;
  }

  // Top priority — no-hitters, perfect games, championships.
  if (/no-hitter|no hitter|perfect game|champion/.test(text)) {
    return HEADLINE_PRIORITY.TOP;
  }

  // High priority — a critical (season/career) injury, an incredible feat,
  // or a completed trade (as opposed to a rumor).
  const isCriticalInjury = /injur|surger/.test(text) && /season|career|out for the year|tommy john/.test(text);
  const isIncredibleFeat =
    CYCLE_SENTENCE.test(title) || /grand slam|walk-?off|franchise record|league record|club record|immaculate inning/.test(text);
  const isRealTrade = TRADE_SENTENCE.test(title);
  if (isCriticalInjury || isIncredibleFeat || isRealTrade) {
    return HEADLINE_PRIORITY.HIGH;
  }

  // Medium priority — Player of the Week honors.
  if (/player of the week/.test(text)) {
    return HEADLINE_PRIORITY.MEDIUM;
  }

  // Low priority — trade rumors/speculation (a real trade was already
  // caught above, so anything trade-flavored left here is just talk).
  if (/rumor|rumour|trade block|shopping|linked to a trade|could be traded/.test(text)) {
    return HEADLINE_PRIORITY.LOW;
  }

  return HEADLINE_PRIORITY.DEFAULT;
}

// OOTP date labels look like "Monday, June 12th , 2034" — pull out a
// sortable UTC timestamp so headlines from a later day always lead.
function parseHeadlineDate(dateLabel) {
  const match = String(dateLabel ?? "").match(/([A-Za-z]+)\s+(\d+)\D*(\d{4})/);
  if (!match) {
    return null;
  }

  const [, monthName, day, year] = match;
  const monthIndex = MONTH_ABBREVIATIONS.findIndex(
    (abbreviation) => abbreviation.toLowerCase() === monthName.slice(0, 3).toLowerCase(),
  );
  if (monthIndex === -1) {
    return null;
  }

  return Date.UTC(Number(year), monthIndex, Number(day));
}

// Newest day first; within the same day, most important first. A headline
// with an unparseable date sorts after every dated one rather than
// crashing the comparison.
function sortHeadlines(headlines) {
  return [...headlines].sort((a, b) => {
    const dateA = parseHeadlineDate(a.date);
    const dateB = parseHeadlineDate(b.date);
    if (dateA !== dateB) {
      if (dateA == null) return 1;
      if (dateB == null) return -1;
      return dateB - dateA;
    }
    return classifyHeadlinePriority(a) - classifyHeadlinePriority(b);
  });
}

// ---------- sidebar ----------

function renderThreeStars(stars) {
  if (!stars.length) {
    return "";
  }

  return `
    <div class="sidebar-block">
      <div class="label">Three Stars of the Day</div>
      <div class="stars-list">
        ${stars
          .map(
            (star) => `
              <div class="star-row">
                <span class="star-rank">${escapeHtml(star.rank)}</span>
                <div>
                  <strong>${escapeHtml(star.player)}</strong> &mdash; ${escapeHtml(titleCase(star.team))}<br>
                  <span class="dim small">${escapeHtml(star.detailLine ?? "")}</span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderStandingsSnippet(featured) {
  const { section, rows } = featured;

  return `
    <div class="sidebar-block standings-snippet">
      <div class="label dark">${escapeHtml(titleCase(section.label))}</div>
      <table>
        <tr><th>Team</th><th>W</th><th>L</th><th>GB</th></tr>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(shortenTeamName(row.Team))}</td>
                <td>${escapeHtml(row.W)}</td>
                <td>${escapeHtml(row.L)}</td>
                <td>${escapeHtml(row.GB)}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
      <a class="jump-link" href="#pennant-races">See full standings &darr;</a>
    </div>
  `;
}

function renderLeadersSnippet(leaderboard) {
  const labelText = leaderboard.category ? `${leaderboard.category}: ${leaderboard.label}` : leaderboard.label;

  return `
    <div class="sidebar-block">
      <div class="label">Leaders &mdash; ${escapeHtml(labelText)}</div>
      <table>
        ${leaderboard.entries
          .slice(0, 5)
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.player)} &bull; ${escapeHtml(teamCode(entry.team))}</td>
                <td class="value">${escapeHtml(entry.value)}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
      <a class="jump-link" href="#leaders-section">See full leaders &darr;</a>
    </div>
  `;
}

// ---------- Matt Gropius Hot Takes ----------
//
// Formerly a multi-columnist "Opinion Desk" (Mack Dalton / Darren Kline /
// Matt Gropius) with its own above-the-fold snippet + jump link in the
// sidebar. Both other columnists are now inactive (config.mjs), leaving
// Matt Gropius as the section's sole voice, so the sidebar snippet was
// dropped and this full section restyled to read like a single feature
// article rather than a card grid — see the .opinion-article CSS below.
//
// The columnist's portrait floats beside the body text (classic newspaper
// column treatment) instead of sitting in a byline row with a name/role
// label — the section header ("Matt Gropius Hot Takes") already names the
// columnist, so a repeated name/role line under the portrait was dropped.
function renderOpinionSection(columns) {
  if (!columns.length) {
    return "";
  }

  return `
    <section id="opinion-section" class="opinion-section">
      <div class="label">Matt Gropius Hot Takes</div>
      <div class="opinion-articles">
        ${columns
          .map(
            (column, index) => `
              <article id="opinion-${index}" class="opinion-article">
                <h3>${escapeHtml(stripColumnistName(column.headline, column.author))}</h3>
                <img class="opinion-avatar" src="columnists/${columnistSlug(column.author)}.png" alt="${escapeHtml(column.author)}" loading="lazy" onerror="this.remove()">
                ${formatArticleBody(column.body)}
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function columnistSlug(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Column headlines are generated as "Author Name: Actual headline" — strip
// that prefix since the section header and portrait already identify the
// columnist.
function stripColumnistName(headline, author) {
  const text = String(headline ?? "").trim();
  const name = String(author ?? "").trim();

  if (!name) {
    return text;
  }

  const prefixPattern = new RegExp(`^${escapeRegExp(name)}\\s*:\\s*`, "i");
  return text.replace(prefixPattern, "").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- box scores ----------

function renderBoxScores(games) {
  if (!games.length) {
    return "";
  }

  // game.awayTeam/homeTeam (snapshotBuilder.mjs's parseScoreBlock) are
  // scraped straight from OOTP's own line-score table, which already shows
  // just the bare city name ("El Paso", "Sacramento") with no nickname —
  // unlike the full "City Nickname" strings elsewhere (headlines, standings
  // rows, transactions). Do NOT run these through shortenTeamName(): it
  // assumes a trailing nickname word to strip and was chopping multi-word
  // cities down to their first word ("El Paso" -> "El", "New Orleans" ->
  // "New", "Fort Wayne" -> "Fort") since there was no nickname there to
  // begin with.
  return `
    <section class="scores-strip">
      <div class="label">Last Night's Scores</div>
      <div class="scores-grid">
        ${games
          .map(
            (game) => `
              <div class="score-card">
                <div class="score-line"><span>${escapeHtml(game.awayTeam)}</span><strong>${escapeHtml(game.awayRuns)}</strong></div>
                <div class="score-line"><span>${escapeHtml(game.homeTeam)}</span><strong>${escapeHtml(game.homeRuns)}</strong></div>
                <div class="score-meta">${escapeHtml(formatDecisionLine(game))}</div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatDecisionLine(game) {
  const parts = [
    game.winningPitcher
      ? `W: ${game.winningPitcher}${game.winningPitcherRecord ? ` (${game.winningPitcherRecord})` : ""}`
      : "",
    game.losingPitcher
      ? `L: ${game.losingPitcher}${game.losingPitcherRecord ? ` (${game.losingPitcherRecord})` : ""}`
      : "",
    game.savePitcher ? `S: ${game.savePitcher}${game.savePitcherRecord ? ` (${game.savePitcherRecord})` : ""}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

// ---------- top game performances (best individual box-score lines) ----------
//
// Another dormant-data case: snapshotBuilder.mjs already scrapes the
// league's own "Top Game Performances" export into ranked batter/pitcher
// lists (up to 5 each, OOTP's own composite "Score" rating decides the
// order), but it was never wired into the page. Laid out Batting |
// Pitching like the other split sections — current material (today's/
// recent standout lines), so it stays expanded rather than collapsing.
function renderTopGamePerformancesSection(topGamePerformancesFeature) {
  const batters = topGamePerformancesFeature?.batters ?? [];
  const pitchers = topGamePerformancesFeature?.pitchers ?? [];

  if (!batters.length && !pitchers.length) {
    return "";
  }

  const groups = [
    { key: "batters", title: "Batting", rows: batters, render: renderTopBatterPerformanceTable },
    { key: "pitchers", title: "Pitching", rows: pitchers, render: renderTopPitcherPerformanceTable },
  ].filter((group) => group.rows.length);

  return `
    <section id="top-performances-section" class="top-performances-section">
      <div class="label">Top Game Performances</div>
      <div class="conference-grid" style="grid-template-columns: repeat(${groups.length}, 1fr);">
        ${groups
          .map(
            (group) => `
              <div class="conference-column">
                <div class="conf-label">${escapeHtml(group.title)}</div>
                ${group.render(group.rows)}
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

// row.team/row.opponent come back as full city names ("Fort Wayne", "New
// Orleans"), the same as game.awayTeam/homeTeam in renderBoxScores above —
// NOT short codes. Render them as-is; do not run them through teamCode()
// or shortenTeamName(), which assume a different input shape and would
// mangle a multi-word city down to a meaningless 3-letter slice.
function topPerformanceNameCell(row) {
  return `${escapeHtml(row.player)} &bull; ${escapeHtml(row.team)}`;
}

function renderTopBatterPerformanceTable(rows) {
  return `
    <table>
      <tr><th class="text-left">Player</th><th class="text-left">Opp</th><th>Date</th><th>H</th><th>HR</th><th>RBI</th><th>Score</th></tr>
      ${rows
        .map(
          (row) => `
            <tr>
              <td class="text-left">${topPerformanceNameCell(row)}</td>
              <td class="text-left">${escapeHtml(row.opponent)}</td>
              <td>${escapeHtml(formatMilestoneDate(row.date))}</td>
              <td>${escapeHtml(row.hits)}</td>
              <td>${escapeHtml(row.homeRuns)}</td>
              <td>${escapeHtml(row.rbi)}</td>
              <td class="value">${escapeHtml(row.score)}</td>
            </tr>
          `,
        )
        .join("")}
    </table>
  `;
}

function renderTopPitcherPerformanceTable(rows) {
  return `
    <table>
      <tr><th class="text-left">Player</th><th class="text-left">Opp</th><th>Date</th><th>IP</th><th>ER</th><th>K</th><th>Score</th></tr>
      ${rows
        .map(
          (row) => `
            <tr>
              <td class="text-left">${topPerformanceNameCell(row)}</td>
              <td class="text-left">${escapeHtml(row.opponent)}</td>
              <td>${escapeHtml(formatMilestoneDate(row.date))}</td>
              <td>${escapeHtml(row.innings)}</td>
              <td>${escapeHtml(row.earnedRuns)}</td>
              <td>${escapeHtml(row.strikeouts)}</td>
              <td class="value">${escapeHtml(row.score)}</td>
            </tr>
          `,
        )
        .join("")}
    </table>
  `;
}

// ---------- championship chase (the real ABA playoff bracket) ----------
//
// snapshot.championshipChase is already fully computed by the data pipeline
// (snapshotBuilder.mjs) with the ABA's actual format: 3 division winners
// (seeds 1-3) plus the top 2 remaining teams per conference (seeds 4-5) play
// a Wild Card Series; the winner joins the #1 seed (a bye past wild card
// round) in the Division Series, while #2 plays #3; the two Division Series
// winners meet in the Conference Series; the two conference champions meet
// in the Championship Series. This just renders that structure — no
// seeding/standings logic is re-derived here.

function renderPlayoffRace(championshipChase) {
  const cc = championshipChase;
  if (!cc || !cc.conferences?.length) {
    return "";
  }

  const [first, second] = cc.conferences;

  return `
    <section id="playoff-race" class="playoff-section">
      <div class="label">Championship Chase</div>
      <div class="playoff-meta">${escapeHtml(cc.title ?? "Projected Playoff Bracket")} &bull; ${escapeHtml(cc.dateLabel ?? "")}</div>
      <div class="bracket-grid">
        ${first ? renderConferenceBracket(first) : "<div></div>"}
        ${renderFinalBracket(cc)}
        ${second ? renderConferenceBracket(second) : "<div></div>"}
      </div>
      ${cc.phase === "playoffs" ? "" : renderHuntRow(cc.conferences)}
    </section>
  `;
}

function renderConferenceBracket(conference) {
  const labels = conference.seriesLabels ?? {};
  const wildcardRound = conference.rounds?.wildcard ?? [];
  const divisionRound = conference.rounds?.division ?? [];
  const conferenceRound = conference.rounds?.conference ?? [];
  const wildcardWinnerLabel = wildcardRound[0]?.placeholderWinner;

  return `
    <div class="bracket-panel">
      <div class="conf-label">${escapeHtml(conference.label ?? "")}</div>
      ${
        wildcardRound.length
          ? `
            <div class="round-label">${escapeHtml(labels.wildcard ?? "Wild Card Series")}</div>
            <div class="bracket">
              ${wildcardRound.map((entry) => renderMatchupCard(entry.matchup, {})).join("")}
            </div>
          `
          : ""
      }
      ${
        divisionRound.length
          ? `
            <div class="round-label">${escapeHtml(labels.division ?? "Division Series")}</div>
            <div class="bracket">
              ${divisionRound.map((entry) => renderMatchupCard(entry.matchup, { byePlaceholder: wildcardWinnerLabel })).join("")}
            </div>
          `
          : ""
      }
      ${
        conferenceRound.length
          ? `
            <div class="round-label">${escapeHtml(labels.conference ?? "Conference Series")}</div>
            <div class="bracket">
              ${conferenceRound.map((entry) => renderMatchupCard(entry.matchup, {})).join("")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderFinalBracket(cc, finalLabel = "ABA Final") {
  return `
    <div class="bracket-panel bracket-panel-final">
      <div class="conf-label">${escapeHtml(finalLabel)}</div>
      <div class="round-label">${escapeHtml(cc.championshipSeriesLabel ?? "Championship Series")}</div>
      <div class="bracket">
        ${renderMatchupCard(cc.championshipMatchup ?? [], {})}
      </div>
    </div>
  `;
}

function renderHuntRow(conferences) {
  const withHunt = (conferences ?? []).filter((conference) => conference.inTheHunt?.length);
  if (!withHunt.length) {
    return "";
  }

  return `
    <div class="hunt-grid">
      ${withHunt
        .map(
          (conference) => `
            <div class="hunt-panel">
              <span class="sublabel">In the Hunt &mdash; ${escapeHtml(conference.label ?? "")}</span>
              <table>
                ${conference.inTheHunt
                  .map(
                    (team) => `
                      <tr>
                        <td>${escapeHtml(shortenTeamName(team.team))}</td>
                        <td>${escapeHtml(team.record ?? "")}</td>
                        <td class="value">${escapeHtml(formatGb(team.gb))}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </table>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

// A matchup slot is either a real team object (has `.team`), a named
// placeholder object (`{ placeholder: "..." }`, used for rounds that haven't
// been reached yet, e.g. "Division Series winner"), or null/undefined (the
// #1 seed's bye slot in the Division Series, waiting on the Wild Card
// Series — `byePlaceholder` supplies that round's winner-to-be label).
function renderMatchupCard([a, b] = [], { byePlaceholder } = {}) {
  return `
    <div class="bracket-matchup">
      ${renderMatchupSlot(a, byePlaceholder)}
      <div class="bracket-vs">vs</div>
      ${renderMatchupSlot(b, byePlaceholder)}
    </div>
  `;
}

function renderMatchupSlot(entry, byePlaceholder) {
  if (!entry) {
    return `<div class="bracket-team-empty">${escapeHtml(byePlaceholder ?? "TBD")}</div>`;
  }

  if (entry.placeholder) {
    return `<div class="bracket-team-empty">${escapeHtml(entry.placeholder)}</div>`;
  }

  // Once a matchup is a live playoff series (entry.seriesWins is set by
  // buildResolvedPlayoffMatchup/addDefaultSeriesWins in snapshotBuilder.mjs),
  // the regular-season record/GB line is no longer the useful number —
  // the series win count is. Swap to that, with a status suffix once the
  // series is decided, and only then; a projected/regular-season slot
  // (no seriesWins at all) keeps showing record/GB exactly as before.
  const hasSeriesProgress = entry.seriesWins !== undefined && entry.seriesWins !== null && entry.seriesWins !== "";
  const metaLine = hasSeriesProgress
    ? `${escapeHtml(entry.seriesWins)} win${entry.seriesWins === "1" ? "" : "s"}${entry.advanced ? " &bull; Won Series" : entry.eliminated ? " &bull; Eliminated" : ""}`
    : `${escapeHtml(entry.record ?? "")}${entry.gb && entry.gb !== "-" ? ` &bull; ${escapeHtml(entry.gb)} GB` : ""}`;

  return `
    <div class="bracket-team">
      <img class="team-logo" src="${escapeHtml(logoRelativePath(entry.logoUrl))}" alt="" loading="lazy" onerror="this.remove()">
      <div class="bracket-team-info">
        <div class="bracket-team-name">${entry.seed ? `<span class="dim small">#${escapeHtml(entry.seed)}</span> ` : ""}${escapeHtml(shortenTeamName(entry.team))}</div>
        <div class="bracket-team-meta">${metaLine}</div>
      </div>
    </div>
  `;
}

// logoUrl points into the live OOTP export ("/news/images/team_logos/...")
// which isn't copied into dist/ — reference it as a relative path so it
// works automatically once/if that folder is published alongside the page,
// and degrades invisibly (onerror removes the <img>) until then.
function logoRelativePath(logoUrl) {
  return String(logoUrl ?? "").replace(/^\/+/, "");
}

// GB of "-" means tied for the spot — show it bare rather than "- GB".
function formatGb(gb) {
  return gb && gb !== "-" ? `${gb} GB` : gb ?? "";
}

// ---------- pennant races (full standings) ----------

function renderPennantRaces(sections, showMagicNumber) {
  if (!sections.length) {
    return "";
  }

  const byConference = groupByConference(sections);
  const conferenceKeys = Object.keys(byConference);

  return `
    <section id="pennant-races" class="pennant-races">
      <div class="label">Pennant Races &mdash; Full Standings</div>
      <div class="conference-grid" style="grid-template-columns: repeat(${conferenceKeys.length || 1}, 1fr);">
        ${conferenceKeys
          .map(
            (key) => `
              <div class="conference-column">
                <div class="conf-label">Conference ${escapeHtml(titleCase(key))}</div>
                <div class="division-stack">
                  ${byConference[key].map((section) => renderStandingsTable(section, showMagicNumber)).join("")}
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

// The standings data already carries OOTP's own "M#" (Magic Number)
// column (snapshotBuilder.mjs's buildStandingsSections), but showing it
// from Opening Day is meaningless — every team's number just sits near
// the full season length until a race actually narrows. isLateSeason()
// (below) gates the column so it only appears once the season is far
// enough along for the number to mean something.
function renderStandingsTable(section, showMagicNumber) {
  return `
    <div class="division-block">
      <span class="sublabel">${escapeHtml(titleCase(section.label))}</span>
      <table>
        <tr><th>Team</th><th>W</th><th>L</th><th>GB</th><th>L10</th><th>Strk</th>${showMagicNumber ? `<th>M#</th>` : ""}</tr>
        ${section.rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.Team)}</td>
                <td>${escapeHtml(row.W)}</td>
                <td>${escapeHtml(row.L)}</td>
                <td>${escapeHtml(row.GB)}</td>
                <td>${escapeHtml(row.L10 ?? "")}</td>
                <td>${escapeHtml(row.Strk ?? "")}</td>
                ${showMagicNumber ? `<td>${escapeHtml(row["M#"] ?? "")}</td>` : ""}
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

// "Late season" = the team that's played the most games has reached
// LATE_SEASON_PROGRESS of the full regular-season schedule
// (config.regularSeasonGames — see config.mjs). Using games played rather
// than a calendar date keeps this correct even if a team's games get
// rained out/rescheduled, and keeps it portable to any league-config.json
// with a different season length. Missing/zero regularSeasonGames (an
// older config that predates this field) fails safe to "not late season"
// rather than guessing. The actual check now lives in
// src/lib/seasonProgress.mjs so the columnist engines (columnFactory.mjs,
// aiColumnFactory.mjs) can share it — see that file for isOutOfContention,
// the same idea applied to a single team instead of the whole league.
function isLateSeason(standingsSections, config) {
  return isLateSeasonShared(standingsSections, config?.regularSeasonGames);
}

// ---------- league leaders (full batting + pitching leaderboards) ----------

function renderLeadersSection(battingLeaderboards, pitchingLeaderboards) {
  if (!battingLeaderboards.length && !pitchingLeaderboards.length) {
    return "";
  }

  const groups = [
    { key: "batting", title: "Batting", boards: battingLeaderboards },
    { key: "pitching", title: "Pitching", boards: pitchingLeaderboards },
  ].filter((group) => group.boards.length);

  return `
    <section id="leaders-section" class="leaders-section">
      <div class="label">League Leaders</div>
      <div class="conference-grid" style="grid-template-columns: repeat(${groups.length || 1}, 1fr);">
        ${groups
          .map(
            (group) => `
              <div class="conference-column">
                <div class="conf-label">${escapeHtml(group.title)}</div>
                <div class="leaders-stack">
                  ${group.boards.map(renderLeaderboardTable).join("")}
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderLeaderboardTable(leaderboard) {
  return `
    <div class="division-block">
      <span class="sublabel">${escapeHtml(leaderboard.label)}</span>
      <table>
        ${leaderboard.entries
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.player)} &bull; ${escapeHtml(teamCode(entry.team))}</td>
                <td class="value">${escapeHtml(entry.value)}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

// ---------- historical (all-time) statistical leaders ----------
//
// snapshotBuilder.mjs has always computed two separate career-leader
// features alongside the current-season leaderboards above —
// leagueCareerLeaders (the league's full all-time record book) and
// teamCareerLeaders (one franchise's own all-time leaders, picked the
// same stable-daily-pick way as the Team Highlight/Prospect Highlight
// panels) — but like Team Highlights and the Player Interview before
// them, neither was ever wired into the page; see design-prototypes.md
// for why ("career leaders" was explicitly deferred, separately from
// the still-unbuilt positional-rankings feature). Both reuse the same
// {label, entries:[{player, value}]} shape as the current-season
// leaderboards, just without a per-entry team — career totals can span
// multiple teams for a league leader, and are redundant for a
// single-franchise leader — so this mirrors renderLeadersSection's
// layout rather than inventing a new one.
function renderHistoricalLeadersSection(leagueCareerLeaders, teamCareerLeaders) {
  const leagueGroup = leagueCareerLeaders
    ? renderCareerLeaderboardGroup(leagueCareerLeaders.battingLeaderboards ?? [], leagueCareerLeaders.pitchingLeaderboards ?? [])
    : "";
  const teamGroup = teamCareerLeaders
    ? renderCareerLeaderboardGroup(teamCareerLeaders.battingLeaderboards ?? [], teamCareerLeaders.pitchingLeaderboards ?? [])
    : "";

  if (!leagueGroup && !teamGroup) {
    return "";
  }

  const leagueTitle = leagueCareerLeaders?.leagueName ? `${leagueCareerLeaders.leagueName} — All-Time Leaders` : "All-Time Leaders";
  const teamTitle = teamCareerLeaders?.teamName ? `${teamCareerLeaders.teamName} — Franchise Leaders` : "";

  const body = `
      ${
        leagueGroup
          ? `
            <div class="historical-leaders-group">
              <div class="group-label">${escapeHtml(leagueTitle)}</div>
              ${leagueGroup}
            </div>
          `
          : ""
      }
      ${
        teamGroup
          ? `
            <div class="historical-leaders-group">
              <div class="group-label">${escapeHtml(teamTitle)}</div>
              ${teamGroup}
            </div>
          `
          : ""
      }
  `;

  // Collapsed by default, same as "Today's Schedule" and "The Full Wire" —
  // this is reference material most readers won't open every day.
  return renderCollapsibleSection("historical-leaders-section", "historical-leaders-section", "Historical Leaders", body);
}

function renderCareerLeaderboardGroup(battingLeaderboards, pitchingLeaderboards) {
  const groups = [
    { key: "batting", title: "Batting", boards: battingLeaderboards },
    { key: "pitching", title: "Pitching", boards: pitchingLeaderboards },
  ].filter((group) => group.boards.length);

  if (!groups.length) {
    return "";
  }

  return `
    <div class="conference-grid" style="grid-template-columns: repeat(${groups.length}, 1fr);">
      ${groups
        .map(
          (group) => `
            <div class="conference-column">
              <div class="conf-label">${escapeHtml(group.title)}</div>
              <div class="leaders-stack">
                ${group.boards.map(renderCareerLeaderboardTable).join("")}
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCareerLeaderboardTable(leaderboard) {
  return `
    <div class="division-block">
      <span class="sublabel">${escapeHtml(leaderboard.label)}</span>
      <table>
        ${leaderboard.entries
          .slice(0, 5)
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.player)}</td>
                <td class="value">${escapeHtml(entry.value)}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

// ---------- positional rankings (all-time position record book) ----------
//
// Companion to the Historical Leaders section above, built from the same
// dormant career-leader data snapshotBuilder.mjs already computes:
// positionCareerLeaderboard picks one position (stably, once per day,
// the same pickStableIndex pattern as the Team/Prospect Highlight
// panels) and finds the single #1 record-holder at that position — not
// a top-N list like the other leaderboards — across four splits: best
// single season, best career total, best single postseason, and best
// career postseason total. Postseason splits are frequently sparse (not
// every category/position pairing has a postseason record on file), so
// each split — and each category row within it — only renders when real
// data came back for it.
function renderPositionalRankingsSection(positionCareerLeaderboard) {
  if (!positionCareerLeaderboard) {
    return "";
  }

  const splits = [
    { key: "singleSeason", title: "Single Season", rows: positionCareerLeaderboard.singleSeason },
    { key: "career", title: "Career", rows: positionCareerLeaderboard.career },
    { key: "singlePostseason", title: "Single Postseason", rows: positionCareerLeaderboard.singlePostseason },
    { key: "postseasonCareer", title: "Postseason Career", rows: positionCareerLeaderboard.postseasonCareer },
  ]
    .map((split) => ({ ...split, rows: (split.rows ?? []).filter((row) => row.player) }))
    .filter((split) => split.rows.length);

  if (!splits.length) {
    return "";
  }

  const title = positionCareerLeaderboard.positionTitle
    ? `All-Time ${positionCareerLeaderboard.positionTitle} Records`
    : "All-Time Positional Records";

  const body = `
      <div class="group-label">${escapeHtml(title)}</div>
      <div class="conference-grid" style="grid-template-columns: repeat(${Math.min(splits.length, 2)}, 1fr);">
        ${splits.map(renderPositionalSplitTable).join("")}
      </div>
  `;

  // Collapsed by default, same reference-material treatment as Historical
  // Leaders right above it. Labeled "All-Time Positional Records" (not
  // "Positional Rankings") to leave that name free for the current-season
  // positional strength spotlight — a different, current-season feature —
  // below.
  return renderCollapsibleSection("positional-rankings-section", "positional-rankings-section", "All-Time Positional Records", body);
}

// ---------- positional spotlight (current-season positional strength) ----------
//
// Another dormant-data case: snapshotBuilder.mjs's positionalStrengthFeature
// already picks one position (stably, once per day, the same
// pickStableIndex pattern as the other featured panels) from the league's
// own Positional Strength report and ranks every team's best player at
// that position league-wide (1st = the league's best). This is current-
// season content, not a record book, so — like Leaders and Top Game
// Performances — it stays expanded rather than collapsing.
function renderPositionalStrengthSection(positionalStrengthFeature) {
  const players = positionalStrengthFeature?.players ?? [];
  if (!players.length) {
    return "";
  }

  const position = positionalStrengthFeature.position || "Players";

  return `
    <section id="positional-strength-section" class="positional-strength-section">
      <div class="label">Positional Rankings</div>
      <div class="group-label">Best ${escapeHtml(position)}</div>
      <table>
        <tr><th>Rk</th><th class="text-left">Player</th><th class="text-left">Team</th><th>Age</th><th class="text-left">Salary</th></tr>
        ${players
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.rank)}</td>
                <td class="text-left">${escapeHtml(entry.player)}</td>
                <td class="text-left">${escapeHtml(entry.team)}</td>
                <td>${escapeHtml(entry.age || "—")}</td>
                <td class="text-left">${escapeHtml(entry.salary || "—")}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </section>
  `;
}

function renderPositionalSplitTable(split) {
  return `
    <div class="conference-column">
      <div class="conf-label">${escapeHtml(split.title)}</div>
      <table>
        <tr><th class="text-left">Category</th><th class="text-left">Player</th><th>Value</th><th>Year</th></tr>
        ${split.rows
          .map(
            (row) => `
              <tr>
                <td class="text-left">${escapeHtml(row.label)}</td>
                <td class="text-left">${escapeHtml(row.player)}</td>
                <td class="value">${escapeHtml(row.value)}</td>
                <td>${escapeHtml(row.year)}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

// ---------- number one picks (one random team's draft history) ----------
//
// Another dormant-data case: snapshotBuilder.mjs already picks one team
// (stably, once per day, the same pickStableIndex pattern as the other
// featured panels) and scrapes its own draft-history page for its top
// pick each year, newest first. Historical/reference material like
// Historical Leaders and Positional Rankings, so it sits alongside them
// and collapses the same way.
function renderNumberOnePicksSection(numberOnePicksFeature) {
  const picks = numberOnePicksFeature?.picks ?? [];
  if (!picks.length) {
    return "";
  }

  // teamName comes back from OOTP's own page title, which is all caps
  // ("ALBUQUERQUE ISOTOPES") — title-case it so it reads like every other
  // team name on the page instead of shouting.
  const teamName = titleCase(numberOnePicksFeature.teamName ?? "");

  const body = `
      <div class="group-label">${escapeHtml(teamName)} — Draft History</div>
      <table>
        <tr><th>Year</th><th class="text-left">Player</th><th class="text-left">Pos</th><th class="text-left">Current Team</th></tr>
        ${picks
          .map(
            (pick) => `
              <tr>
                <td>${escapeHtml(pick.year)}</td>
                <td class="text-left">${escapeHtml(pick.player)}${pick.didNotSign ? ' <span class="pick-no-sign">(Did Not Sign)</span>' : ""}</td>
                <td class="text-left">${escapeHtml(pick.position)}</td>
                <td class="text-left">${escapeHtml(pick.currentTeam || "—")}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
  `;

  return renderCollapsibleSection("number-one-picks-section", "number-one-picks-section", "Number One Picks", body);
}

// ---------- next free agents ----------
//
// Another dormant-data case: snapshotBuilder.mjs already scrapes OOTP's
// own "upcoming free agents" export (separate batter/pitcher pages) into
// one combined, score-sorted list, but it was never wired into the page.
// The combined list interleaves the two types but keeps each type's own
// relative (score) order, so filtering back into batters/pitchers here
// restores the original per-type ranking — then laid out Batting |
// Pitching like the leaders sections elsewhere on the page. Unlike
// Historical Leaders/Positional Rankings, this is current roster news
// (who's about to be available), not a record book, so it stays expanded
// like Prospect Watch and Milestones rather than collapsing by default.
function renderFreeAgentsSection(upcomingFreeAgents) {
  const batters = (upcomingFreeAgents ?? []).filter((player) => player.type === "batter");
  const pitchers = (upcomingFreeAgents ?? []).filter((player) => player.type === "pitcher");

  if (!batters.length && !pitchers.length) {
    return "";
  }

  const groups = [
    { key: "batters", title: "Position Players", players: batters, render: renderFreeAgentBatterTable },
    { key: "pitchers", title: "Pitchers", players: pitchers, render: renderFreeAgentPitcherTable },
  ].filter((group) => group.players.length);

  return `
    <section id="free-agents-section" class="free-agents-section">
      <div class="label">Next Free Agents</div>
      <div class="conference-grid" style="grid-template-columns: repeat(${groups.length}, 1fr);">
        ${groups
          .map(
            (group) => `
              <div class="conference-column">
                <div class="conf-label">${escapeHtml(group.title)}</div>
                ${group.render(group.players)}
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function freeAgentNameCell(player) {
  return `${escapeHtml(player.name)}${player.isMinorLeagueFreeAgent ? ' <span class="dim small">(ML)</span>' : ""}`;
}

function renderFreeAgentBatterTable(players) {
  return `
    <table>
      <tr><th class="text-left">Player</th><th>Team</th><th>Age</th><th>Pos</th><th>CON</th><th>POW</th><th>EYE</th></tr>
      ${players
        .map(
          (player) => `
            <tr>
              <td class="text-left">${freeAgentNameCell(player)}</td>
              <td>${escapeHtml(player.team)}</td>
              <td>${escapeHtml(player.age)}</td>
              <td>${escapeHtml(player.pos)}</td>
              <td>${escapeHtml(player.contact)}</td>
              <td>${escapeHtml(player.power)}</td>
              <td>${escapeHtml(player.eye)}</td>
            </tr>
          `,
        )
        .join("")}
    </table>
  `;
}

function renderFreeAgentPitcherTable(players) {
  return `
    <table>
      <tr><th class="text-left">Player</th><th>Team</th><th>Age</th><th>Role</th><th>Stuff</th><th>Mvt</th><th>Ctrl</th></tr>
      ${players
        .map(
          (player) => `
            <tr>
              <td class="text-left">${freeAgentNameCell(player)}</td>
              <td>${escapeHtml(player.team)}</td>
              <td>${escapeHtml(player.age)}</td>
              <td>${escapeHtml(player.pos)}</td>
              <td>${escapeHtml(player.stuff)}</td>
              <td>${escapeHtml(player.movement)}</td>
              <td>${escapeHtml(player.control)}</td>
            </tr>
          `,
        )
        .join("")}
    </table>
  `;
}

// ---------- injury report & transactions wire ----------

function renderFooterTicker(injuries, transactions) {
  if (!injuries.length && !transactions.length) {
    return "";
  }

  return `
    <section class="wire-section">
      <div class="wire-grid">
        ${injuries.length ? renderWireColumn("Injury Report", injuries, 12) : ""}
        ${transactions.length ? renderWireColumn("Transactions", transactions, 12) : ""}
      </div>
    </section>
  `;
}

function renderWireColumn(title, items, limit) {
  const shown = items.slice(0, limit);
  const remaining = items.length - shown.length;

  return `
    <div class="wire-column">
      <div class="label">${escapeHtml(title)}</div>
      <ul class="wire-list">
        ${shown.map(renderWireItem).join("")}
      </ul>
      ${remaining > 0 ? `<div class="wire-more">+ ${remaining} more move${remaining === 1 ? "" : "s"} not shown</div>` : ""}
    </div>
  `;
}

function renderWireItem(item) {
  const dateLabel = formatWireDate(item.date);
  const parsed = splitWireSummary(item.summary);

  return `
    <li class="wire-item">
      <div class="wire-item-head">
        ${dateLabel ? `<span class="wire-date">${escapeHtml(dateLabel)}</span>` : ""}
        ${parsed ? `<span class="wire-team">${escapeHtml(parsed.team)}</span>` : `<span class="tag-inline">Trade</span>`}
      </div>
      <div class="wire-detail">${escapeHtml(parsed ? parsed.detail : tidyWireText(item.summary))}</div>
    </li>
  `;
}

// Splits an OOTP transaction/injury summary of the shape "Team Name : detail
// text" into its team and detail parts. Trade summaries ("The X traded ...
// to the Y...") don't follow that shape, so those fall back to a single
// detail line tagged "Trade" instead.
function splitWireSummary(summary) {
  const separatorIndex = summary.indexOf(" : ");
  if (separatorIndex === -1) {
    return null;
  }

  return {
    team: summary.slice(0, separatorIndex).trim(),
    detail: tidyWireText(summary.slice(separatorIndex + 3)),
  };
}

// OOTP summaries carry stray spaces before punctuation ("Released RP Wade
// LeBlanc .") — tidy that up for a cleaner read.
function tidyWireText(text) {
  return text.trim().replace(/\s+([.,])/g, "$1");
}

// OOTP dates look like "Tuesday, June 6th , 2034" — this trims that down to
// a compact "Jun 6" wire-style date label.
function formatWireDate(dateLabel) {
  if (!dateLabel) return "";
  const match = dateLabel.match(/,\s*([A-Za-z]+)\s+(\d+)/);
  if (!match) return "";
  const [, month, day] = match;
  return `${month.slice(0, 3)} ${day}`;
}

// snapshot.leagueDateLabel doesn't carry a year (e.g. "Monday, June 5"), but
// the raw injury/transaction dates do ("Tuesday, June 6th , 2034"). Pull the
// year from whichever item's month/day matches the masthead date, falling
// back to the first year found among those dates if nothing matches exactly.
function withLeagueYear(dateLabel, snapshot) {
  if (!dateLabel) return dateLabel ?? "";

  const monthDay = dateLabel.match(/,\s*([A-Za-z]+)\s+(\d+)/);
  const candidates = [...(snapshot.injuries ?? []), ...(snapshot.transactions ?? [])];

  if (monthDay) {
    const [, month, day] = monthDay;
    const exact = candidates.find((item) => {
      const parsed = item.date?.match(/,\s*([A-Za-z]+)\s+(\d+)\D*(\d{4})/);
      return parsed && parsed[1] === month && parsed[2] === day;
    });
    const exactYear = exact?.date.match(/(\d{4})/)?.[1];
    if (exactYear) {
      return `${dateLabel}, ${exactYear}`;
    }
  }

  for (const item of candidates) {
    const year = item.date?.match(/(\d{4})/)?.[1];
    if (year) {
      return `${dateLabel}, ${year}`;
    }
  }

  return dateLabel;
}

// ---------- schedule (today's probable pitchers & series context) ----------

function renderSchedule(games) {
  if (!games.length) {
    return "";
  }

  const body = `
      <div class="schedule-grid">
        ${games.map(renderScheduleCard).join("")}
      </div>
  `;

  return renderCollapsibleSection("schedule", "schedule-section", "Today's Schedule", body);
}

function renderScheduleCard(game) {
  return `
    <div class="schedule-card">
      ${game.time ? `<div class="schedule-time">${escapeHtml(game.time)}</div>` : ""}
      <div class="schedule-matchup">
        ${renderScheduleTeam(game, "away")}
        <div class="schedule-at">at</div>
        ${renderScheduleTeam(game, "home")}
      </div>
      ${renderScheduleSeries(game.seriesContext)}
    </div>
  `;
}

function renderScheduleTeam(game, side) {
  const team = game[`${side}Team`];
  const record = game[`${side}Record`];
  const pitcher = game[`${side}ProbablePitcher`];

  return `
    <div class="schedule-team">
      <img class="team-logo" src="${escapeHtml(logoRelativePath(game[`${side}LogoUrl`]))}" alt="" loading="lazy" onerror="this.remove()">
      <div class="schedule-team-info">
        <div class="schedule-team-name">${escapeHtml(team ?? "")}${record ? ` <span class="dim small">(${escapeHtml(record)})</span>` : ""}</div>
        ${
          pitcher?.name
            ? `<div class="schedule-pitcher">${escapeHtml(pitcher.name)}${pitcher.line ? ` <span class="dim small">${escapeHtml(pitcher.line)}</span>` : ""}</div>`
            : `<div class="schedule-pitcher dim small">Probable pitcher TBA</div>`
        }
      </div>
    </div>
  `;
}

function renderScheduleSeries(seriesContext) {
  if (!seriesContext) {
    return "";
  }

  const parts = [
    seriesContext.gameNumber ? `Game ${seriesContext.gameNumber}` : "",
    seriesContext.leaderText ?? "",
  ].filter(Boolean);

  if (!parts.length) {
    return "";
  }

  return `<div class="schedule-series">${escapeHtml(parts.join(" • "))}</div>`;
}

// ---------- prospect watch (spotlight prospect + farm system rankings) ----------

function renderProspectsSection(prospectHighlight, topFarmSystems) {
  const highlightHtml = prospectHighlight ? renderProspectHighlight(prospectHighlight) : "";
  const farmHtml = topFarmSystems.length ? renderFarmSystemsPanel(topFarmSystems) : "";
  const panels = [highlightHtml, farmHtml].filter(Boolean);

  if (!panels.length) {
    return "";
  }

  // The highlight card needs enough width to keep its stat line on one row
  // without scrolling, so give it the larger share when both panels sit
  // side by side instead of splitting 50/50 (or favoring the farm table).
  const columns = highlightHtml && farmHtml ? "minmax(0, 1.3fr) minmax(0, 1fr)" : `repeat(${panels.length}, 1fr)`;

  return `
    <section id="prospects" class="prospects-section">
      <div class="label">Prospect Watch</div>
      <div class="prospects-grid" style="grid-template-columns: ${columns};">
        ${panels.join("")}
      </div>
    </section>
  `;
}

// Real player stat tables can run 12-20+ columns, so trimming a couple off
// the end (the old approach) still left far too many to fit on one line.
// Cap at a fixed count instead — currentLine's key order runs basic
// counting stats first and rate/sabermetric stats last, so keeping only
// the leading ones keeps the most meaningful stats and guarantees the
// strip fits without a horizontal scrollbar regardless of how many
// columns the source table actually had.
const MAX_PROSPECT_STATS = 5;

function renderProspectHighlight(prospect) {
  const allStats = filteredStatEntries(prospect.currentLine);
  const stats = allStats.slice(0, MAX_PROSPECT_STATS);

  return `
    <div class="prospect-panel">
      <div class="conf-label">Prospect Highlight</div>
      <div class="prospect-card">
        <img class="prospect-photo" src="${escapeHtml(logoRelativePath(prospect.imageUrl))}" alt="" loading="lazy" onerror="this.remove()">
        <div class="prospect-info">
          <div class="prospect-name">${escapeHtml(prospect.displayName ?? prospect.name ?? "")}</div>
          <div class="prospect-meta">${escapeHtml(
            [prospect.pos, prospect.teamFullName || prospect.team, prospect.level, prospect.age ? `Age ${prospect.age}` : ""]
              .filter(Boolean)
              .join(" • "),
          )}</div>
          ${prospect.rank ? `<div class="prospect-rank">#${escapeHtml(prospect.rank)} Prospect in the ABA</div>` : ""}
        </div>
      </div>
      ${
        stats.length
          ? `
            <div class="prospect-stats">
              ${stats.map(([label, value]) => `<div class="prospect-stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`).join("")}
            </div>
          `
          : ""
      }
      ${prospect.acquisitionSummaryLine ? `<p class="prospect-line">${escapeHtml(prospect.acquisitionSummaryLine)}</p>` : ""}
      ${prospect.awardsLine ? `<p class="prospect-line">${escapeHtml(prospect.awardsLine)}</p>` : ""}
      ${prospect.teamTopProspects?.length ? renderTeamTopProspects(prospect.team, prospect.teamTopProspects) : ""}
    </div>
  `;
}

// prospect.team is already the short city/franchise name (e.g. "New
// Orleans"), not the full mascot name — don't run it through
// shortenTeamName, which would wrongly chop the last word off of it.
function renderTeamTopProspects(team, prospects) {
  return `
    <div class="prospect-team-block">
      <span class="sublabel">${escapeHtml(team ?? "")} Top Prospects</span>
      <table class="prospect-team-table">
        <tr><th>Rk</th><th class="text-left">Player</th><th>Pos</th><th>Age</th><th>Level</th><th class="text-left">Drafted</th></tr>
        ${prospects
          .map(
            (player) => `
              <tr>
                <td>${escapeHtml(player.teamRank ?? "")}${player.overallRank ? ` <span class="dim small">(#${escapeHtml(player.overallRank)})</span>` : ""}</td>
                <td class="text-left">${escapeHtml(player.name ?? "")}</td>
                <td>${escapeHtml(player.pos ?? "")}</td>
                <td>${escapeHtml(player.age ?? "")}</td>
                <td>${escapeHtml(player.level ?? "")}</td>
                <td class="text-left">${escapeHtml(player.draftYear ? `${player.draftRound} '${String(player.draftYear).slice(-2)}` : "")}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

// currentLine mixes hitter and pitcher stat keys (and can carry a stray
// blank key) depending on the prospect's position — filter down to the
// ones that actually have a value rather than hardcoding either shape.
function filteredStatEntries(stats) {
  if (!stats) {
    return [];
  }
  return Object.entries(stats).filter(([key, value]) => key && value !== "" && value != null);
}

function renderFarmSystemsPanel(teams) {
  return `
    <div class="prospect-panel">
      <div class="conf-label">Team Prospects &mdash; Farm System Rankings</div>
      <table class="farm-table">
        <tr><th>Rk</th><th class="text-left">Team</th><th>Pts</th><th class="text-left">Top Prospects</th></tr>
        ${teams
          .map(
            (team) => `
              <tr>
                <td>${escapeHtml(team.rank ?? "")}</td>
                <td class="text-left">
                  <span class="farm-team">
                    <img class="team-logo" src="${escapeHtml(logoRelativePath(team.logoUrl))}" alt="" loading="lazy" onerror="this.remove()">
                    ${escapeHtml(shortenTeamName(team.team))}
                  </span>
                </td>
                <td class="value">${escapeHtml(team.points ?? "")}</td>
                <td class="text-left farm-prospects">${escapeHtml(team.topProspects ?? "")}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

function renderMilestonesSection(playerMilestones, managerHighlight) {
  const milestonesHtml = playerMilestones.length ? renderPlayerMilestonesPanel(playerMilestones) : "";
  const coachHtml = managerHighlight ? renderCoachHighlightPanel(managerHighlight) : "";
  const panels = [milestonesHtml, coachHtml].filter(Boolean);

  if (!panels.length) {
    return "";
  }

  return `
    <section id="milestones" class="milestones-section">
      <div class="label">Milestones &amp; Coaching</div>
      <div class="milestones-grid" style="grid-template-columns: repeat(${panels.length}, 1fr);">
        ${panels.join("")}
      </div>
    </section>
  `;
}

function renderPlayerMilestonesPanel(milestones) {
  return `
    <div class="prospect-panel">
      <div class="conf-label">Player Milestones</div>
      <ul class="milestone-list">
        ${milestones
          .map(
            (milestone) => `
              <li class="milestone-item">
                <span class="milestone-date">${escapeHtml(formatMilestoneDate(milestone.date))}</span>
                <span class="milestone-body"><strong>${escapeHtml(milestone.player ?? "")}</strong> reaches ${escapeHtml(milestone.accomplishment ?? "")}</span>
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

// OOTP milestone dates look like "06/10/2034" (MM/DD/YYYY) — a different
// shape than the "Tuesday, June 6th , 2034" strings elsewhere in the export
// — so this gets its own compact "Jun 10" formatter instead of reusing
// formatWireDate.
const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMilestoneDate(dateStr) {
  const match = String(dateStr ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return String(dateStr ?? "");
  }
  const [, month, day] = match;
  const label = MONTH_ABBREVIATIONS[Number(month) - 1];
  return label ? `${label} ${Number(day)}` : String(dateStr);
}

function renderCoachHighlightPanel(manager) {
  const stats = [
    // "Team Record", not "Record" — this is the club's overall W-L across
    // the seasons this staffer was on staff (summed straight from their
    // career-history table), not necessarily games they personally
    // managed, since the panel can highlight any staff role (Manager,
    // Bench/Hitting/Pitching Coach), not just Managers.
    manager.careerRecord ? ["Team Record", manager.careerRecord] : null,
    manager.careerSeasons ? ["Seasons", manager.careerSeasons] : null,
    manager.playoffAppearances != null ? ["Playoffs", manager.playoffAppearances] : null,
    manager.championships != null ? ["Titles", manager.championships] : null,
  ].filter(Boolean);

  return `
    <div class="prospect-panel">
      <div class="conf-label">Coach Highlight</div>
      <div class="prospect-card">
        <img class="prospect-photo" src="${escapeHtml(logoRelativePath(manager.imageUrl))}" alt="" loading="lazy" onerror="this.remove()">
        <div class="prospect-info">
          <div class="prospect-name">${escapeHtml(manager.name ?? "")}</div>
          <div class="prospect-meta">${escapeHtml(
            [manager.role, manager.teamName, manager.age ? `Age ${manager.age}` : ""].filter(Boolean).join(" • "),
          )}</div>
        </div>
      </div>
      ${
        stats.length
          ? `
            <div class="prospect-stats">
              ${stats.map(([label, value]) => `<div class="prospect-stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`).join("")}
            </div>
          `
          : ""
      }
      ${
        manager.summary?.length
          ? manager.summary.map((line) => `<p class="prospect-line">${escapeHtml(line)}</p>`).join("")
          : ""
      }
      ${manager.careerHistory?.length ? renderCoachCareerHistoryTable(manager.careerHistory) : ""}
    </div>
  `;
}

// Season-by-season record straight from the coach's own OOTP history
// table (snapshotBuilder.mjs already scraped it in full — careerRecord/
// careerSeasons/playoffAppearances/championships above are just a sum of
// these same rows) — same "snippet above, full table below" idea used
// elsewhere on the page, just scaled down to panel size. Newest year
// first, matching how careerHistory is already sorted.
function renderCoachCareerHistoryTable(careerHistory) {
  return `
    <div class="prospect-team-block">
      <span class="sublabel">Career History</span>
      <table class="prospect-team-table">
        <tr><th>Year</th><th class="text-left">Team</th><th>Record</th><th class="text-left">Playoffs</th></tr>
        ${careerHistory
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.year)}</td>
                <td class="text-left">${escapeHtml(row.team)}</td>
                <td class="value">${escapeHtml(row.record)}</td>
                <td class="text-left">${escapeHtml(row.playoffs && row.playoffs !== "-" ? row.playoffs : "—")}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

// ---------- player interview (one-on-one Q&A; who gets picked is decided
// entirely by snapshotBuilder.mjs's buildPlayerInterviewFeature — this only
// renders whatever content aiInterviewFactory.mjs wrote for that player) ----------

function renderPlayerInterviewSection(feature, interview) {
  if (!feature || !interview?.questions?.length) {
    return "";
  }

  const stats = filteredStatEntries(feature.currentLine).slice(0, 4);

  return `
    <section id="player-interview" class="interview-section">
      <div class="label">One-on-One</div>
      <div class="interview-layout">
        <div class="prospect-panel">
          <div class="conf-label">Sit-Down</div>
          <div class="prospect-card">
            <img class="prospect-photo" src="${escapeHtml(logoRelativePath(feature.imageUrl))}" alt="" loading="lazy" onerror="this.remove()">
            <div class="prospect-info">
              <div class="prospect-name">${escapeHtml(feature.displayName ?? feature.name ?? "")}</div>
              <div class="prospect-meta">${escapeHtml(
                [feature.pos, feature.teamFullName || feature.team, feature.age ? `Age ${feature.age}` : ""]
                  .filter(Boolean)
                  .join(" • "),
              )}</div>
            </div>
          </div>
          ${
            stats.length
              ? `
                <span class="sublabel">This Season</span>
                <div class="prospect-stats">
                  ${stats.map(([label, value]) => `<div class="prospect-stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`).join("")}
                </div>
              `
              : ""
          }
          ${feature.careerSummaryLine ? `<p class="prospect-line">${escapeHtml(feature.careerSummaryLine)}</p>` : ""}
          ${feature.careerDetailLine ? `<p class="prospect-line">${escapeHtml(feature.careerDetailLine)}</p>` : ""}
        </div>
        <div class="interview-transcript">
          ${interview.headline ? `<h3 class="interview-headline">${escapeHtml(interview.headline)}</h3>` : ""}
          ${interview.intro ? `<p class="interview-intro">${escapeHtml(interview.intro)}</p>` : ""}
          <div class="interview-qa">
            ${interview.questions
              .map(
                (qa) => `
                  <div class="interview-exchange">
                    <p class="interview-q"><span class="qa-label">Q.</span>${escapeHtml(qa.question)}</p>
                    <p class="interview-a"><span class="qa-label">A.</span>${escapeHtml(qa.answer)}</p>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

// ---------- team highlights (same team as the player interview above;
// snapshotBuilder.mjs's buildTeamHighlight already computes all of this as
// part of playerInterviewFeature.teamHighlight — this only renders it) ----------

function renderTeamHighlightSection(teamHighlight) {
  if (!teamHighlight) {
    return "";
  }

  const standing = teamHighlight.standing ?? {};
  const statusParts = [
    standing.place ? `${formatOrdinal(standing.place)} place` : "",
    standing.wins && standing.losses ? `${standing.wins}-${standing.losses}` : "",
    standing.l10 ? `LAST 10: ${standing.l10}` : "",
  ].filter(Boolean);

  const rotation = (teamHighlight.rotation ?? []).slice(0, 5);
  const bullpen = [...(teamHighlight.bullpen ?? [])].sort((left, right) => (left.rolePriority ?? 99) - (right.rolePriority ?? 99));
  const topHitters = teamHighlight.topHitters ?? [];
  const topSalaries = teamHighlight.topSalaries ?? [];
  const historyNotes = teamHighlight.historyNotes ?? [];
  const injuries = teamHighlight.injuries ?? [];

  const blocks = [
    rotation.length
      ? renderTeamHighlightListBlock(
          "Starting Rotation",
          rotation.map((p) => `${p.pitcher} (${p.throws}) - ${p.wins}-${p.losses}, ${p.era} ERA`),
        )
      : "",
    bullpen.length
      ? renderTeamHighlightListBlock(
          "Bullpen",
          bullpen.map((p) => `${p.pitcher} (${p.role}) (${p.throws}) - ${p.wins}-${p.losses}, ${p.era} ERA`),
        )
      : "",
    topHitters.length
      ? renderTeamHighlightListBlock(
          "Top 5 Hitters",
          topHitters.map((h) => `${h.name} (${h.pos}) - ${h.avg} AVG, ${h.hr} HR, ${h.rbi} RBI`),
        )
      : "",
    topSalaries.length
      ? renderTeamHighlightListBlock("Top Salaries", topSalaries.map((s) => `${s.name} (${s.position}) - ${s.salary}`))
      : "",
    historyNotes.length ? renderTeamHighlightListBlock("History", historyNotes) : "",
    injuries.length ? renderTeamHighlightListBlock("Current Injuries", injuries) : "",
  ].filter(Boolean);

  if (!statusParts.length && !blocks.length) {
    return "";
  }

  return `
    <section id="team-highlight" class="team-highlight-section">
      <div class="label">Team Highlights</div>
      <div class="team-highlight-header">
        <img class="prospect-photo" src="${escapeHtml(logoRelativePath(teamHighlight.logoUrl))}" alt="" loading="lazy" onerror="this.remove()">
        <div class="prospect-info">
          <div class="prospect-name">${escapeHtml(teamHighlight.fullName ?? "")}</div>
          ${statusParts.length ? `<div class="prospect-meta">${escapeHtml(statusParts.join(" | "))}</div>` : ""}
          ${teamHighlight.manager ? `<div class="prospect-meta">Manager: ${escapeHtml(teamHighlight.manager)}</div>` : ""}
          ${teamHighlight.affiliate ? `<div class="prospect-meta">Affiliate: ${escapeHtml(teamHighlight.affiliate)}</div>` : ""}
        </div>
      </div>
      ${teamHighlight.summary?.length ? teamHighlight.summary.map((line) => `<p class="prospect-line">${escapeHtml(line)}</p>`).join("") : ""}
      ${blocks.length ? `<div class="team-highlight-grid">${blocks.join("")}</div>` : ""}
    </section>
  `;
}

function renderTeamHighlightListBlock(title, items) {
  return `
    <div class="team-highlight-block">
      <span class="sublabel">${escapeHtml(title)}</span>
      <ul class="team-highlight-list">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

// ---------- minor leagues (concise: news + standings + leaders, no scores) ----------

// Only the Frontier League is modeled by the data pipeline today. Next
// season a second minor league (an AA level) is being added to the OOTP
// export — once the pipeline exposes it as its own snapshot field, add it
// to this array in the caller below. renderMinorLeaguesSection and
// renderMinorLeaguePanel are written generically against the same
// { leagueName, headlines, standingsSections, battingLeaderboards,
// pitchingLeaderboards } shape as frontierLeague, so no other changes are
// needed to bring a second league online — it'll render as another panel
// stacked under this section automatically.
function renderMinorLeaguesSection(minorLeagues) {
  const leagues = minorLeagues.filter(
    (league) =>
      league &&
      ((league.headlines ?? []).length ||
        (league.standingsSections ?? []).length ||
        (league.battingLeaderboards ?? []).length ||
        (league.pitchingLeaderboards ?? []).length ||
        (league.championshipChase?.phase === "playoffs" && league.championshipChase?.conferences?.length)),
  );

  if (!leagues.length) {
    return "";
  }

  return `
    <section id="minor-leagues" class="minor-leagues-section">
      <div class="label">Minor League Report</div>
      <div class="minor-leagues-stack">
        ${leagues.map(renderMinorLeaguePanel).join("")}
      </div>
    </section>
  `;
}

// Deliberately lighter than the majors' News/Pennant Races/Leaders
// sections — a handful of headlines, division standings only (no
// wildcard tables, which mostly repeat the same teams), and two
// leaderboard categories a side — so the minor-league report reads as a
// glance, not a second front page. No scores, per the brief.
function renderMinorLeaguePanel(league) {
  return `
    <div class="minor-league-panel">
      <div class="conf-label">${escapeHtml(league.leagueName ?? "Minor League")}</div>
      ${renderMinorLeagueNews(league.headlines ?? [])}
      ${renderMinorLeaguePlayoffBracket(league.championshipChase, league.leagueName)}
      ${league.championshipChase?.phase === "playoffs" ? "" : renderMinorLeagueStandings(league.standingsSections ?? [])}
      ${renderMinorLeagueLeaders(league.battingLeaderboards ?? [], league.pitchingLeaderboards ?? [])}
    </div>
  `;
}

// snapshotBuilder.mjs already computes a full championshipChase for the
// minor league (same buildChampionshipChase the majors' Championship Chase
// section uses, just with the Frontier League's own division/wildcard
// counts, series lengths, and — the thing that actually detects the
// playoffs — its own playoffTextIndicators regexes matched against this
// league's news pages). It just never got rendered anywhere. Only show it
// once phase is actually "playoffs" (i.e. those news indicators fired) —
// unlike the majors' section, which shows a projected bracket all season,
// the minor-league report stays a quick glance until there's an actual
// bracket worth showing. Reuses the exact same bracket building blocks
// (logos, series win counts, round labels) as the Championship Chase
// section above for visual consistency.
function renderMinorLeaguePlayoffBracket(championshipChase, leagueName) {
  const cc = championshipChase;
  if (!cc || cc.phase !== "playoffs" || !cc.conferences?.length) {
    return "";
  }

  const [first, second] = cc.conferences;
  const finalLabel = `${leagueName || "League"} Final`;

  return `
    <div class="minor-league-block">
      <span class="sublabel">${escapeHtml(cc.title ?? "Playoff Bracket")}</span>
      <div class="bracket-grid minor-bracket-grid">
        ${first ? renderConferenceBracket(first) : "<div></div>"}
        ${renderFinalBracket(cc, finalLabel)}
        ${second ? renderConferenceBracket(second) : "<div></div>"}
      </div>
    </div>
  `;
}

function renderMinorLeagueNews(headlines) {
  const items = sortHeadlines(dedupeHeadlines(headlines)).slice(0, 3);
  if (!items.length) {
    return "";
  }

  return `
    <div class="minor-league-block">
      <span class="sublabel">Latest News</span>
      <ul class="minor-news-list">
        ${items
          .map(
            (headline) => `
              <li>
                <span class="minor-news-title">${escapeHtml(summarizeHeadline(headline))}</span>
                ${headline.date ? `<span class="dim small">${escapeHtml(headline.date)}</span>` : ""}
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderMinorLeagueStandings(sections) {
  const divisions = sections.filter((section) => section.kind === "division");
  if (!divisions.length) {
    return "";
  }

  const byConference = groupByConference(divisions);
  const conferenceKeys = Object.keys(byConference);

  return `
    <div class="minor-league-block">
      <span class="sublabel">Standings</span>
      <div class="minor-standings-grid" style="grid-template-columns: repeat(${conferenceKeys.length || 1}, 1fr);">
        ${conferenceKeys
          .map(
            (key) => `
              <div class="minor-standings-column">
                ${byConference[key].map(renderMinorStandingsTable).join("")}
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderMinorStandingsTable(section) {
  return `
    <div>
      <span class="sublabel minor-sublabel">${escapeHtml(titleCase(section.label))}</span>
      <table class="compact-table minor-standings-table">
        <tr><th>Team</th><th>W</th><th>L</th><th>GB</th></tr>
        ${section.rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(shortenTeamName(row.Team))}</td>
                <td>${escapeHtml(row.W)}</td>
                <td>${escapeHtml(row.L)}</td>
                <td>${escapeHtml(row.GB)}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

function renderMinorLeagueLeaders(battingLeaderboards, pitchingLeaderboards) {
  const groups = [
    { title: "Batting", boards: battingLeaderboards.slice(0, 2) },
    { title: "Pitching", boards: pitchingLeaderboards.slice(0, 2) },
  ].filter((group) => group.boards.length);

  if (!groups.length) {
    return "";
  }

  return `
    <div class="minor-league-block">
      <span class="sublabel">Leaders</span>
      <div class="minor-leaders-grid">
        ${groups
          .map(
            (group) => `
              <div>
                <div class="minor-leaders-title">${escapeHtml(group.title)}</div>
                <div class="minor-leaders-column">
                  ${group.boards.map(renderMinorLeaderboardTable).join("")}
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderMinorLeaderboardTable(leaderboard) {
  return `
    <div>
      <span class="sublabel minor-sublabel">${escapeHtml(leaderboard.label)}</span>
      <table class="compact-table">
        ${leaderboard.entries
          .slice(0, 3)
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.player)} &bull; ${escapeHtml(teamCode(entry.team))}</td>
                <td class="value">${escapeHtml(entry.value)}</td>
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
}

// ---------- data helpers ----------

// "2nd place", "3rd place", etc. — used by the Team Highlights status line.
function formatOrdinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return "";
  }
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// Picks the division shown in the sidebar's compact standings snippet.
// Rotates through every division by league date rather than always showing
// the same one (e.g. always the division with the best record) so the
// snippet doesn't feature the same division every single day.
function pickFeaturedDivision(sections, dateLabel) {
  const divisions = sections.filter((section) => section.kind === "division" && section.rows?.length);

  if (!divisions.length) {
    return null;
  }

  const section = divisions[rotationIndex(dateLabel, divisions.length)];
  return { section, rows: section.rows };
}

// Deterministic hash of the league date label, so the same day always
// produces the same pick (stable if the edition is rebuilt) while
// consecutive days land on different divisions.
function rotationIndex(dateLabel, count) {
  if (!count) {
    return 0;
  }

  const text = String(dateLabel ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return hash % count;
}

// Picks the leaderboard shown in the sidebar's compact Leaders snippet.
// Rotates through every batting and pitching category by league date (like
// pickFeaturedDivision) instead of always showing the same one. Uses a
// different hash salt than the standings pick so the two snippets don't
// always change together.
function pickFeaturedLeaderboard(battingLeaderboards, pitchingLeaderboards, dateLabel) {
  const pool = [
    ...battingLeaderboards.map((board) => ({ ...board, category: "Batting" })),
    ...pitchingLeaderboards.map((board) => ({ ...board, category: "Pitching" })),
  ].filter((board) => board.entries?.length);

  if (!pool.length) {
    return null;
  }

  return pool[rotationIndex(`${dateLabel}|leaders`, pool.length)];
}

function groupByConference(sections) {
  const grouped = {};

  for (const section of sections) {
    const key = section.conference || "league";
    grouped[key] = grouped[key] ?? [];
    grouped[key].push(section);
  }

  return grouped;
}

// Nicknames that are themselves two words (so "drop the last word" isn't
// enough to strip them) — e.g. "Toledo Mud Hens" should shorten to
// "Toledo", not "Toledo Mud". Extend this list if the league gains another
// team with a multi-word nickname.
const MULTI_WORD_NICKNAMES = [
  "Sea Dogs",
  "Red Wings",
  "River Cats",
  "Mud Hens",
  "Yard Goats",
  "Iron Pigs",
];

function shortenTeamName(fullName) {
  const name = String(fullName ?? "").trim();

  for (const nickname of MULTI_WORD_NICKNAMES) {
    if (name.endsWith(` ${nickname}`)) {
      return name.slice(0, -(nickname.length + 1));
    }
  }

  const words = name.split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(" ") : name;
}

function teamCode(team) {
  return String(team ?? "").slice(0, 3).toUpperCase();
}

function titleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMode(mode) {
  if (!mode) return "";
  return titleCase(String(mode).replace(/_/g, " "));
}

function truncateToSentences(text, count) {
  const sentences = String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, count).join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- styles ----------

const pageStyles = `
  :root{
    --bg: oklch(0.98 0.006 80);
    --ink: oklch(0.18 0.012 260);
    --ink-soft: oklch(0.42 0.01 260);
    --rule: oklch(0.82 0.01 80);
    --green: oklch(0.40 0.09 152);
    --green-soft: oklch(0.94 0.03 152);
    --amber: oklch(0.55 0.13 55);
    --amber-soft: oklch(0.94 0.035 65);
  }
  *{box-sizing:border-box;}
  body{margin:0; background:var(--bg); color:var(--ink); font-family:"Newsreader",Georgia,"Times New Roman",serif;}
  a{color:var(--green); text-decoration:none;}
  a:hover{color:oklch(0.30 0.09 152);}
  .page{max-width:1200px; margin:0 auto; padding-bottom:56px;}
  .empty-state{color:var(--ink-soft); font-family:"IBM Plex Sans",sans-serif; font-size:14px;}
  .util-strip{display:flex; justify-content:space-between; align-items:center; padding:10px 32px; background:var(--ink); color:var(--bg); font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.08em; text-transform:uppercase;}
  .util-strip .dim{color:oklch(0.65 0.01 260); margin-left:16px;}
  .util-right a{margin-left:20px; color:var(--bg); text-decoration:none;}
  .util-right a:hover{color:var(--green-soft); text-decoration:underline;}
  .masthead{padding:38px 32px 24px 32px; border-bottom:3px solid var(--ink);}
  .masthead h1{margin:0; font-size:clamp(42px, 7.5vw, 80px); font-weight:600; letter-spacing:-0.01em;}
  .masthead-meta{display:flex; justify-content:space-between; margin-top:16px; font-family:"IBM Plex Sans",sans-serif; font-size:13px; color:var(--ink-soft);}
  .main-grid{display:grid; grid-template-columns: 2fr 1fr; gap:48px; padding:36px 32px 0 32px;}
  @media (max-width: 860px){ .main-grid{grid-template-columns: 1fr;} }
  .lead-column{display:flex; flex-direction:column; gap:32px;}
  .tag{display:inline-block; background:var(--green); color:#fff; font-family:"IBM Plex Sans",sans-serif; font-size:10.5px; letter-spacing:.1em; font-weight:700; text-transform:uppercase; padding:4px 10px; margin-bottom:12px;}
  .dateline{font-family:"IBM Plex Sans",sans-serif; font-size:12px; color:var(--ink-soft); letter-spacing:.04em; margin-bottom:12px;}
  .news-snippet .label, .news-section > .label, .opinion-section > .label, .leaders-section > .label, .wire-column .label, .playoff-section > .label, .schedule-section > .label, .prospects-section > .label, .milestones-section > .label, .minor-leagues-section > .label, .interview-section > .label, .team-highlight-section > .label, .historical-leaders-section > .label, .positional-rankings-section > .label, .free-agents-section > .label, .top-performances-section > .label, .number-one-picks-section > .label, .positional-strength-section > .label{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.12em; font-weight:700; text-transform:uppercase; color:var(--ink); border-bottom:2px solid var(--ink); padding-bottom:6px; display:inline-block;}
  .headline-list{list-style:none; margin:14px 0 0 0; padding:0; display:flex; flex-direction:column;}
  .headline-list li{padding:14px 0; border-bottom:1px solid var(--rule);}
  .headline-list li:first-child{padding-top:0;}
  .headline-list li:last-child{border-bottom:none;}
  .headline-link{display:block; font-family:"Newsreader",serif; font-size:clamp(19px,2.4vw,24px); font-weight:600; line-height:1.25; color:var(--ink);}
  .headline-link:hover{color:var(--green);}
  .headline-meta{display:flex; gap:10px; align-items:center; margin-top:6px; font-family:"IBM Plex Sans",sans-serif; font-size:11.5px;}
  .tag-inline{color:var(--green); font-weight:700; letter-spacing:.06em; text-transform:uppercase; font-size:10.5px;}
  .sidebar{display:flex; flex-direction:column; gap:26px;}
  .sidebar-block .label{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.12em; font-weight:700; text-transform:uppercase; color:var(--ink); border-bottom:2px solid var(--green); padding-bottom:6px; display:inline-block;}
  .sidebar-block .label.dark{border-bottom-color:var(--ink);}
  .stars-list{display:flex; flex-direction:column; gap:10px; margin-top:12px; font-family:"IBM Plex Sans",sans-serif; font-size:13.5px;}
  .star-row{display:flex; gap:12px; align-items:baseline;}
  .star-rank{font-family:"Newsreader",serif; font-size:19px; font-weight:600; color:var(--green); width:18px;}
  .dim{color:var(--ink-soft);}
  .small{font-size:12px;}
  .standings-snippet{background:var(--green-soft); padding:18px; border-radius:2px;}
  .jump-link{display:inline-block; margin-top:10px; font-family:"IBM Plex Sans",sans-serif; font-size:11.5px; font-weight:600;}
  table{width:100%; border-collapse:collapse; font-family:"IBM Plex Sans",sans-serif; margin-top:10px;}
  td,th{padding:5px 6px; font-size:12.5px; text-align:right; border-bottom:1px solid var(--rule); white-space:nowrap;}
  td:first-child,th:first-child{text-align:left;}
  th{font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); font-weight:600;}
  td.value{font-weight:600;}
  .byline{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); margin-top:4px;}
  .scores-strip{padding:32px 32px 0 32px;}
  .top-performances-section{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .positional-strength-section{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .positional-strength-section > .group-label{margin-top:20px;}
  .scores-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(230px,1fr)); gap:14px; margin-top:14px;}
  .score-card{border:1px solid var(--rule); padding:12px; font-family:"IBM Plex Sans",sans-serif; font-size:13px;}
  .score-line{display:flex; justify-content:space-between;}
  .score-meta{color:var(--ink-soft); font-size:11px; margin-top:8px; line-height:1.5;}
  /* Collapsible sections (native <details>/<summary> — see
     renderCollapsibleSection). Closed by default; clicking the header bar
     (or Enter/Space when it's focused) reveals the body via the browser's
     own disclosure behavior — no JS involved. The label keeps all of the
     shared .label styling above (uppercase, underline, etc.) and this
     just adds the full-width clickable bar and the chevron. */
  .collapsible > summary.label{cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:12px; user-select:none; list-style:none;}
  .collapsible > summary.label::-webkit-details-marker{display:none;}
  .collapsible > summary.label:hover{color:var(--green);}
  .collapsible > summary.label .chevron{font-size:18px; font-weight:700; color:var(--ink-soft); transition:transform .15s ease;}
  .collapsible[open] > summary.label .chevron{transform:rotate(90deg);}
  .news-section{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .news-articles{display:flex; flex-direction:column; gap:8px; margin-top:20px;}
  .news-article{padding-bottom:32px; margin-bottom:32px; border-bottom:1px solid var(--rule);}
  .news-article:last-child{border-bottom:none; margin-bottom:0; padding-bottom:0;}
  .news-article h3{margin:0 0 6px 0; font-size:clamp(22px,3vw,30px); font-weight:600; line-height:1.15;}
  .news-article p{font-size:15px; line-height:1.6; margin:0 0 14px 0; max-width:760px;}
  .news-article p:last-child{margin-bottom:0;}
  .article-list{margin:0 0 14px 0; padding-left:22px; font-size:15px; line-height:1.65; max-width:760px;}
  .article-list li{margin-bottom:4px;}
  .pennant-races{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .conference-grid{display:grid; gap:48px; margin-top:20px;}
  @media (max-width: 860px){ .conference-grid{grid-template-columns:1fr !important;} }
  .conf-label{font-family:"IBM Plex Sans",sans-serif; font-size:13px; letter-spacing:.1em; font-weight:700; text-transform:uppercase; border-bottom:1px solid var(--ink); padding-bottom:8px; margin-bottom:16px;}
  .division-stack{display:flex; flex-direction:column; gap:20px;}
  .sublabel{font-family:"IBM Plex Sans",sans-serif; font-size:11.5px; letter-spacing:.08em; font-weight:700; text-transform:uppercase; color:var(--green); display:block;}
  .leaders-section{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .leaders-stack{display:grid; grid-template-columns:repeat(auto-fit, minmax(190px,1fr)); gap:20px 24px; align-items:start;}
  .historical-leaders-section{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .historical-leaders-group{margin-top:24px;}
  .historical-leaders-group:first-of-type{margin-top:20px;}
  .group-label{font-family:"Newsreader",serif; font-size:19px; font-weight:600; color:var(--ink); border-bottom:1px solid var(--green); padding-bottom:8px; margin-bottom:18px;}
  .positional-rankings-section{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  /* Historical Leaders' .group-label gets its top spacing from the
     .historical-leaders-group wrapper around it; Positional Rankings has
     only one group-label and renders it as the body's first element with
     no such wrapper, so it needs its own margin-top here or it sits
     flush against the summary bar above it. */
  .positional-rankings-section > .group-label{margin-top:20px;}
  .number-one-picks-section{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .number-one-picks-section > .group-label{margin-top:20px;}
  .pick-no-sign{color:var(--ink-soft); font-style:italic; font-size:11.5px; margin-left:4px;}
  .free-agents-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .playoff-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .playoff-meta{font-family:"IBM Plex Sans",sans-serif; font-size:12px; letter-spacing:.04em; color:var(--ink-soft); margin-top:8px;}
  .bracket-grid{display:grid; grid-template-columns:1.3fr 1fr 1.3fr; gap:24px; margin-top:24px; align-items:start;}
  @media (max-width: 860px){ .bracket-grid{grid-template-columns:1fr;} }
  .bracket-panel{border:1px solid var(--rule); padding:20px;}
  .bracket-panel-final{background:var(--green-soft);}
  .round-label{font-family:"IBM Plex Sans",sans-serif; font-size:10.5px; letter-spacing:.08em; font-weight:700; text-transform:uppercase; color:var(--green); margin-top:18px; margin-bottom:10px;}
  .bracket-panel .round-label:first-of-type{margin-top:16px;}
  .bracket{display:flex; flex-direction:column; gap:10px;}
  .bracket-matchup{border:1px solid var(--rule); background:var(--bg); padding:10px 12px; display:flex; flex-direction:column; gap:3px;}
  .bracket-team{display:flex; align-items:center; gap:10px;}
  .team-logo{width:24px; height:24px; object-fit:contain; flex-shrink:0;}
  .bracket-team-info{display:flex; flex-direction:column; flex:1; min-width:0;}
  .bracket-team-name{font-family:"IBM Plex Sans",sans-serif; font-size:13.5px; font-weight:600;}
  .bracket-team-meta{font-family:"IBM Plex Sans",sans-serif; font-size:11px; color:var(--ink-soft); margin-top:1px;}
  .bracket-team-empty{font-family:"IBM Plex Sans",sans-serif; font-size:12.5px; color:var(--ink-soft); font-style:italic; padding:2px 0 2px 34px;}
  .bracket-vs{font-family:"IBM Plex Sans",sans-serif; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft); padding-left:34px;}
  .hunt-grid{display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-top:32px;}
  @media (max-width: 700px){ .hunt-grid{grid-template-columns:1fr;} }
  .hunt-panel table{margin-top:8px;}
  .schedule-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .schedule-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(300px,1fr)); gap:16px; margin-top:20px;}
  .schedule-card{border:1px solid var(--rule); padding:16px;}
  .schedule-time{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:12px;}
  .schedule-matchup{display:flex; flex-direction:column; gap:10px;}
  .schedule-team{display:flex; align-items:center; gap:10px;}
  .schedule-team-info{display:flex; flex-direction:column; min-width:0;}
  .schedule-team-name{font-family:"IBM Plex Sans",sans-serif; font-size:14px; font-weight:600;}
  .schedule-pitcher{font-family:"IBM Plex Sans",sans-serif; font-size:12px; color:var(--ink-soft); margin-top:2px;}
  .schedule-at{font-family:"IBM Plex Sans",sans-serif; font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft); padding-left:34px;}
  .schedule-series{margin-top:12px; padding-top:10px; border-top:1px solid var(--rule); font-family:"IBM Plex Sans",sans-serif; font-size:11.5px; color:var(--ink-soft);}
  .prospects-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .prospects-grid{display:grid; gap:32px; margin-top:20px; align-items:start;}
  @media (max-width: 860px){ .prospects-grid{grid-template-columns:1fr !important;} }
  .prospect-card{display:flex; align-items:center; gap:12px; margin-top:14px;}
  .prospect-photo{width:56px; height:56px; object-fit:cover; border-radius:4px; border:1px solid var(--rule); flex-shrink:0; background:var(--green-soft);}
  .prospect-info{display:flex; flex-direction:column; gap:3px; min-width:0;}
  .prospect-name{font-family:"Newsreader",serif; font-size:19px; font-weight:600; line-height:1.2;}
  .prospect-meta{font-family:"IBM Plex Sans",sans-serif; font-size:12px; color:var(--ink-soft);}
  .prospect-rank{font-family:"IBM Plex Sans",sans-serif; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--green); margin-top:2px;}
  .prospect-stats{display:flex; flex-wrap:nowrap; align-items:baseline; gap:16px; margin-top:10px; padding:9px 14px; background:var(--green-soft); overflow-x:auto;}
  .prospect-stat{display:flex; flex-direction:row; align-items:baseline; gap:4px; flex-shrink:0; white-space:nowrap;}
  .stat-value{font-family:"Newsreader",serif; font-size:14px; font-weight:600;}
  .stat-label{font-family:"IBM Plex Sans",sans-serif; font-size:9px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft);}
  .prospect-line{font-family:"IBM Plex Sans",sans-serif; font-size:12.5px; color:var(--ink-soft); margin:10px 0 0 0;}
  .prospect-team-block{margin-top:20px; padding-top:16px; border-top:1px solid var(--rule);}
  .prospect-team-table{margin-top:10px;}
  .farm-table{margin-top:16px;}
  .text-left{text-align:left !important;}
  .farm-team{display:flex; align-items:center; gap:8px;}
  .farm-prospects{white-space:normal; color:var(--ink-soft); font-size:11.5px; line-height:1.5;}
  .milestones-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .milestones-grid{display:grid; gap:32px; margin-top:20px; align-items:start;}
  @media (max-width: 860px){ .milestones-grid{grid-template-columns:1fr !important;} }
  .milestone-list{margin-top:16px; display:flex; flex-direction:column; gap:14px;}
  .milestone-item{display:flex; gap:12px; align-items:baseline; padding-bottom:14px; border-bottom:1px solid var(--rule);}
  .milestone-item:last-child{border-bottom:none; padding-bottom:0;}
  .milestone-date{font-family:"IBM Plex Sans",sans-serif; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--green); flex-shrink:0; width:52px;}
  .milestone-body{font-family:"IBM Plex Sans",sans-serif; font-size:13px; color:var(--ink); line-height:1.5;}
  .interview-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .interview-layout{display:grid; grid-template-columns:260px 1fr; gap:32px; margin-top:20px; align-items:start;}
  @media (max-width: 860px){ .interview-layout{grid-template-columns:1fr;} }
  .interview-transcript{min-width:0;}
  .interview-headline{font-family:"Newsreader",serif; font-size:clamp(22px,2.8vw,28px); font-weight:600; line-height:1.2; margin:0 0 10px 0;}
  .interview-intro{font-family:"IBM Plex Sans",sans-serif; font-size:13.5px; font-style:italic; color:var(--ink-soft); line-height:1.6; margin:0 0 22px 0;}
  .interview-qa{display:flex; flex-direction:column; gap:20px;}
  .interview-exchange{padding-bottom:20px; border-bottom:1px solid var(--rule);}
  .interview-exchange:last-child{border-bottom:none; padding-bottom:0;}
  .interview-q{font-family:"IBM Plex Sans",sans-serif; font-size:13.5px; font-weight:700; color:var(--ink); line-height:1.5; margin:0 0 8px 0;}
  .interview-a{font-family:"Newsreader",serif; font-size:15.5px; color:var(--ink); line-height:1.65; margin:0;}
  .qa-label{color:var(--green); font-weight:700; margin-right:6px;}
  .team-highlight-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .team-highlight-header{display:flex; align-items:center; gap:12px; margin-top:14px;}
  .team-highlight-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(240px,1fr)); gap:28px; margin-top:24px; align-items:start;}
  .team-highlight-block{display:flex; flex-direction:column; min-width:0;}
  .team-highlight-list{list-style:none; margin:8px 0 0 0; padding:0; display:flex; flex-direction:column;}
  .team-highlight-list li{padding:6px 0; border-bottom:1px solid var(--rule); font-family:"IBM Plex Sans",sans-serif; font-size:12.5px; color:var(--ink); line-height:1.5;}
  .team-highlight-list li:last-child{border-bottom:none; padding-bottom:0;}
  .minor-leagues-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .minor-leagues-stack{display:flex; flex-direction:column; gap:28px; margin-top:20px;}
  .minor-league-panel{display:flex; flex-direction:column; gap:18px;}
  .minor-news-list{list-style:none; margin:10px 0 0 0; padding:0; display:flex; flex-direction:column;}
  .minor-news-list li{display:flex; justify-content:space-between; align-items:baseline; gap:16px; padding:7px 0; border-bottom:1px solid var(--rule); font-family:"IBM Plex Sans",sans-serif; font-size:12.5px;}
  .minor-news-list li:last-child{border-bottom:none; padding-bottom:0;}
  .minor-news-title{color:var(--ink);}
  .minor-bracket-grid{margin-top:12px; gap:16px;}
  .minor-bracket-grid .bracket-panel{padding:14px;}
  .minor-standings-grid{display:grid; gap:20px; margin-top:8px;}
  @media (max-width: 700px){ .minor-standings-grid{grid-template-columns:1fr !important;} }
  .minor-standings-column{display:flex; flex-direction:column; gap:12px;}
  .minor-leaders-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(170px,1fr)); gap:12px 20px; margin-top:8px;}
  .minor-leaders-title{font-family:"IBM Plex Sans",sans-serif; font-size:10.5px; letter-spacing:.06em; font-weight:700; text-transform:uppercase; color:var(--ink-soft); margin-bottom:6px;}
  .minor-leaders-column{display:flex; flex-direction:column; gap:12px;}
  .minor-sublabel{font-size:10px;}
  .compact-table{margin-top:4px;}
  .compact-table td, .compact-table th{padding:3px 5px; font-size:11px;}
  /* Fixed column widths so W/L/GB line up the same way across every
     division table, regardless of how long that division's team names
     happen to run (browsers otherwise auto-size each table's columns
     independently from its own content). */
  .minor-standings-table{table-layout:fixed;}
  .minor-standings-table th:first-child, .minor-standings-table td:first-child{width:52%;}
  .minor-standings-table th:not(:first-child), .minor-standings-table td:not(:first-child){width:16%;}
  .opinion-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  /* Reads as a feature article rather than a card grid, matching
     .news-article's readable-body treatment below — appropriate now that
     the section is normally a single columnist rather than a multi-card
     comparison (see the note above renderOpinionSection). max-width lives
     on the article itself (not just the paragraphs) so the headline and
     the body share one reading width instead of the headline stretching
     to the full section width while the text below it stays narrow. */
  .opinion-articles{display:flex; flex-direction:column; gap:8px; margin-top:20px;}
  .opinion-article{max-width:760px; padding-bottom:32px; margin-bottom:32px; border-bottom:1px solid var(--rule);}
  .opinion-article:last-child{border-bottom:none; margin-bottom:0; padding-bottom:0;}
  .opinion-article::after{content:""; display:block; clear:both;}
  .opinion-article h3{margin:0 0 12px 0; font-size:clamp(22px,3vw,30px); font-weight:600; line-height:1.15;}
  /* Portrait floats beside the body text instead of sitting in a byline
     row with a name/role label (removed — the section header already
     names the columnist); the paragraphs after it wrap around it via
     ordinary float layout. */
  .opinion-avatar{float:left; width:120px; height:120px; border-radius:50%; object-fit:cover; border:1px solid var(--rule); margin:2px 24px 12px 0;}
  .opinion-article p{font-size:15px; line-height:1.6; margin:0 0 14px 0;}
  .opinion-article p:last-child{margin-bottom:0;}
  .opinion-article .article-list{font-size:15px; line-height:1.6;}
  .wire-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .wire-grid{display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:20px;}
  @media (max-width: 700px){ .wire-grid{grid-template-columns:1fr;} }
  .wire-column:first-child .label{border-bottom-color:var(--amber);}
  .wire-list{list-style:none; margin:16px 0 0 0; padding:0; display:flex; flex-direction:column;}
  .wire-column:first-child .wire-list{background:var(--amber-soft); padding:2px 14px; border-radius:2px;}
  .wire-item{padding:10px 0; border-bottom:1px solid var(--rule); font-family:"IBM Plex Sans",sans-serif;}
  .wire-item:first-child{padding-top:0;}
  .wire-item:last-child{border-bottom:none;}
  .wire-item-head{display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;}
  .wire-date{font-size:10.5px; letter-spacing:.04em; color:var(--ink-soft); flex-shrink:0;}
  .wire-team{font-size:12.5px; font-weight:700; color:var(--ink);}
  .wire-detail{font-size:13px; line-height:1.5; color:var(--ink-soft); margin-top:3px;}
  .wire-more{margin-top:12px; font-size:11.5px; color:var(--ink-soft); font-style:italic;}
`;
export { renderFrontPageHtml as __test_renderFrontPageHtml };
