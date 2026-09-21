// Modern Broadsheet front-page renderer.
//
// Consumes the same (snapshot, columns, config) shape that the legacy
// renderEdition.mjs receives — see src/services/snapshotBuilder.mjs and
// src/services/columnFactory.mjs for the exact fields available.
//
// Design: quick overview above the fold (hero + secondary stories, a
// sidebar with Three Stars / a featured-division standings snippet with a
// jump link / a batting-average leaders snippet), then Opinion Desk and
// last night's scores at the same snippet depth, then the full "Pennant
// Races" section further down the page with every standings table, then
// an injuries/transactions footer ticker.
//
// Sections not yet designed (career leaders, the playoff bracket,
// financial data, manager/prospect features, the Frontier League mirror,
// etc.) are intentionally left out for now rather than guessed at — see
// the project notes for what's still open.

export function renderFrontPageHtml(snapshot, columns, config) {
  const newspaperName = config?.newspaperName ?? "The ABA Daily Press";
  const leagueName = config?.leagueName ?? "American Baseball League";
  const city = config?.city ?? "Grand Harbor";

  const featuredHeadlines = dedupeHeadlines(snapshot.headlines ?? []).slice(0, 6);
  const mastheadDateLabel = withLeagueYear(snapshot.leagueDateLabel, snapshot);

  const featured = pickFeaturedDivision(snapshot.standingsSections ?? [], snapshot.leagueDateLabel);
  const featuredLeaderboard = pickFeaturedLeaderboard(
    snapshot.battingLeaderboards ?? [],
    snapshot.pitchingLeaderboards ?? [],
    snapshot.leagueDateLabel,
  );

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
      <a href="#news-section">News</a><a href="#opinion-section">Opinion</a><a href="#pennant-races">Standings</a><a href="#leaders-section">Leaders</a><a href="#schedule">Schedule</a>
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
      ${renderOpinionSnippet(columns ?? [])}
    </aside>
  </div>

  ${renderBoxScores(snapshot.lastDayScores ?? [])}

  ${renderPlayoffRace(snapshot.championshipChase)}

  ${renderNewsSection(featuredHeadlines)}

  ${renderPennantRaces(snapshot.standingsSections ?? [])}

  ${renderOpinionSection(columns ?? [])}

  ${renderLeadersSection(snapshot.battingLeaderboards ?? [], snapshot.pitchingLeaderboards ?? [])}

  ${renderFooterTicker(snapshot.injuries ?? [], snapshot.transactions ?? [])}

  ${renderSchedule(snapshot.scheduledGames ?? [])}

  ${renderProspectsSection(snapshot.prospectHighlight, snapshot.topFarmSystems ?? [])}

  ${renderMilestonesSection(snapshot.playerMilestones ?? [], snapshot.managerHighlightFeature)}

</div>
</body>
</html>`;
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

  return `
    <section id="news-section" class="news-section">
      <div class="label">The Full Wire</div>
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
    </section>
  `;
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
    truncateHeadline(title)
  );
}

// "<POS> <Name> of the <Team> honored: Wins the ABA <CONF> Player of the
// Week Award." is another raw sentence OOTP hands us verbatim as a title —
// condense it to "<Team> <Name> is the <CONF> Player of the Week".
const PLAYER_OF_WEEK_SENTENCE =
  /^[A-Z0-9]{1,3}\s+([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)*)\s+of the (.+?) honored: Wins the ABA (\w+) Player of the Week Award\.?$/;

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

// ---------- opinion desk (snippet above the fold + full Opinion section) ----------

function renderOpinionSnippet(columns) {
  if (!columns.length) {
    return "";
  }

  return `
    <div class="sidebar-block opinion-snippet">
      <div class="label">Opinion Desk</div>
      <ul class="opinion-headline-list">
        ${columns
          .map(
            (column, index) => `
              <li>
                <a class="opinion-headline-link" href="#opinion-${index}">${escapeHtml(stripColumnistName(column.headline, column.author))}</a>
                <div class="byline">${escapeHtml(column.author)}</div>
              </li>
            `,
          )
          .join("")}
      </ul>
      <a class="jump-link" href="#opinion-section">Read full columns &darr;</a>
    </div>
  `;
}

// Full-length columns, laid out as a card grid (one card per columnist)
// rather than a stacked list — the format modern sports sites (ESPN, The
// Athletic) use for an opinion/writers section.
function renderOpinionSection(columns) {
  if (!columns.length) {
    return "";
  }

  return `
    <section id="opinion-section" class="opinion-section">
      <div class="label">Opinion Desk</div>
      <div class="opinion-articles">
        ${columns
          .map(
            (column, index) => `
              <article id="opinion-${index}" class="opinion-article">
                <div class="opinion-byline-row">
                  <img class="opinion-avatar" src="columnists/${columnistSlug(column.author)}.png" alt="" loading="lazy" onerror="this.remove()">
                  <div>
                    <div class="opinion-name">${escapeHtml(column.author)}</div>
                    ${column.role ? `<div class="opinion-role">${escapeHtml(column.role)}</div>` : ""}
                  </div>
                </div>
                <h3>${escapeHtml(stripColumnistName(column.headline, column.author))}</h3>
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
// that prefix since the byline underneath already names the columnist.
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

  return `
    <section class="scores-strip">
      <div class="label">Last Night's Scores</div>
      <div class="scores-grid">
        ${games
          .map(
            (game) => `
              <div class="score-card">
                <div class="score-line"><span>${escapeHtml(shortenTeamName(game.awayTeam))}</span><strong>${escapeHtml(game.awayRuns)}</strong></div>
                <div class="score-line"><span>${escapeHtml(shortenTeamName(game.homeTeam))}</span><strong>${escapeHtml(game.homeRuns)}</strong></div>
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
      ${renderHuntRow(cc.conferences)}
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

function renderFinalBracket(cc) {
  return `
    <div class="bracket-panel bracket-panel-final">
      <div class="conf-label">ABA Final</div>
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

  return `
    <div class="bracket-team">
      <img class="team-logo" src="${escapeHtml(logoRelativePath(entry.logoUrl))}" alt="" loading="lazy" onerror="this.remove()">
      <div class="bracket-team-info">
        <div class="bracket-team-name">${entry.seed ? `<span class="dim small">#${escapeHtml(entry.seed)}</span> ` : ""}${escapeHtml(shortenTeamName(entry.team))}</div>
        <div class="bracket-team-meta">${escapeHtml(entry.record ?? "")}${entry.gb && entry.gb !== "-" ? ` &bull; ${escapeHtml(entry.gb)} GB` : ""}</div>
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

function renderPennantRaces(sections) {
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
                  ${byConference[key].map(renderStandingsTable).join("")}
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderStandingsTable(section) {
  return `
    <div class="division-block">
      <span class="sublabel">${escapeHtml(titleCase(section.label))}</span>
      <table>
        <tr><th>Team</th><th>W</th><th>L</th><th>GB</th><th>L10</th><th>Strk</th></tr>
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
              </tr>
            `,
          )
          .join("")}
      </table>
    </div>
  `;
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

  return `
    <section id="schedule" class="schedule-section">
      <div class="label">Today's Schedule</div>
      <div class="schedule-grid">
        ${games.map(renderScheduleCard).join("")}
      </div>
    </section>
  `;
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

  // The farm-system table carries more content per row (team, points, and a
  // prose list of prospects) than the highlight card, so give it more of
  // the row when both panels sit side by side instead of splitting 50/50.
  const columns = highlightHtml && farmHtml ? "minmax(0, 1fr) minmax(0, 1.35fr)" : `repeat(${panels.length}, 1fr)`;

  return `
    <section id="prospects" class="prospects-section">
      <div class="label">Prospect Watch</div>
      <div class="prospects-grid" style="grid-template-columns: ${columns};">
        ${panels.join("")}
      </div>
    </section>
  `;
}

function renderProspectHighlight(prospect) {
  const stats = filteredStatEntries(prospect.currentLine);

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
            <span class="sublabel">This Season</span>
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
    manager.careerRecord ? ["Record", manager.careerRecord] : null,
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
            <span class="sublabel">Career</span>
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
    </div>
  `;
}

// ---------- data helpers ----------

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
const MULTI_WORD_NICKNAMES = ["Sea Dogs", "Red Wings", "River Cats", "Mud Hens"];

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
  .news-snippet .label, .news-section > .label, .opinion-section > .label, .leaders-section > .label, .wire-column .label, .playoff-section > .label, .schedule-section > .label, .prospects-section > .label, .milestones-section > .label{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.12em; font-weight:700; text-transform:uppercase; color:var(--ink); border-bottom:2px solid var(--ink); padding-bottom:6px; display:inline-block;}
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
  .opinion-headline-list{list-style:none; margin:12px 0 0 0; padding:0; display:flex; flex-direction:column;}
  .opinion-headline-list li{padding:10px 0; border-bottom:1px solid var(--rule);}
  .opinion-headline-list li:first-child{padding-top:0;}
  .opinion-headline-list li:last-child{border-bottom:none;}
  .opinion-headline-link{display:block; font-family:"Newsreader",serif; font-size:15px; font-weight:600; line-height:1.3; color:var(--ink);}
  .opinion-headline-link:hover{color:var(--green);}
  .byline{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); margin-top:4px;}
  .scores-strip{padding:32px 32px 0 32px;}
  .scores-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(230px,1fr)); gap:14px; margin-top:14px;}
  .score-card{border:1px solid var(--rule); padding:12px; font-family:"IBM Plex Sans",sans-serif; font-size:13px;}
  .score-line{display:flex; justify-content:space-between;}
  .score-meta{color:var(--ink-soft); font-size:11px; margin-top:8px; line-height:1.5;}
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
  .opinion-section{margin-top:48px; padding:32px 32px 40px 32px; border-top:1px solid var(--ink);}
  .opinion-articles{display:grid; grid-template-columns:repeat(auto-fit, minmax(260px,1fr)); gap:28px; margin-top:20px; align-items:start;}
  .opinion-article{padding:22px; border:1px solid var(--rule); border-radius:6px; background:oklch(0.995 0.003 80); box-shadow:0 1px 2px oklch(0.18 0.012 260 / 0.05);}
  .opinion-byline-row{display:flex; align-items:center; gap:10px; margin-bottom:16px;}
  .opinion-avatar{width:42px; height:42px; border-radius:50%; object-fit:cover; border:1px solid var(--rule); flex-shrink:0;}
  .opinion-name{font-family:"IBM Plex Sans",sans-serif; font-size:12.5px; font-weight:700; color:var(--ink);}
  .opinion-role{font-family:"IBM Plex Sans",sans-serif; font-size:10.5px; color:var(--ink-soft); margin-top:1px;}
  .opinion-article h3{margin:0 0 10px 0; font-size:18px; font-weight:600; line-height:1.25;}
  .opinion-article p{font-size:13.5px; line-height:1.55; margin:0 0 10px 0;}
  .opinion-article p:last-child{margin-bottom:0;}
  .opinion-article .article-list{font-size:13.5px; line-height:1.55;}
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
