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

  const featuredHeadlines = (snapshot.headlines ?? []).slice(0, 6);

  const featured = pickFeaturedDivision(snapshot.standingsSections ?? [], snapshot.leagueDateLabel);
  const battingSnippet = findLeaderboard(snapshot.battingLeaderboards, "Batting AVG");

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
      <span>News</span><span>Opinion</span><span>Standings</span><span>Leaders</span><span>Schedule</span>
    </div>
  </div>

  <header class="masthead">
    <h1>${escapeHtml(newspaperName)}</h1>
    <div class="masthead-meta">
      <span>${escapeHtml(snapshot.leagueDateLabel ?? "")}</span>
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
      ${battingSnippet ? renderLeadersSnippet(battingSnippet) : ""}
      ${renderOpinionSnippet(columns ?? [])}
    </aside>
  </div>

  ${renderBoxScores(snapshot.lastDayScores ?? [])}

  ${renderNewsSection(featuredHeadlines)}

  ${renderPennantRaces(snapshot.standingsSections ?? [])}

  ${renderOpinionSection(columns ?? [])}

  ${renderFooterTicker(snapshot.injuries ?? [], snapshot.transactions ?? [])}

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
                <a class="headline-link" href="#news-${index}">${escapeHtml(headline.title)}</a>
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
                <h3>${escapeHtml(headline.title)}</h3>
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
  return `
    <div class="sidebar-block">
      <div class="label">Leaders &mdash; ${escapeHtml(leaderboard.label)}</div>
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
          .slice(0, 5)
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
    game.winningPitcher ? `W: ${game.winningPitcher}` : "",
    game.savePitcher ? `S: ${game.savePitcher}${game.savePitcherRecord ? ` (${game.savePitcherRecord})` : ""}` : "",
  ].filter(Boolean);
  return parts.join(" • ");
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

// ---------- footer ticker ----------

function renderFooterTicker(injuries, transactions) {
  if (!injuries.length && !transactions.length) {
    return "";
  }

  return `
    <section class="footer-ticker">
      ${injuries.length ? `<div class="ticker-row injuries"><strong>Injuries:</strong> ${injuries.slice(0, 4).map((item) => escapeHtml(item.summary)).join(" • ")}</div>` : ""}
      ${transactions.length ? `<div class="ticker-row"><strong>Transactions:</strong> ${transactions.slice(0, 4).map((item) => escapeHtml(item.summary)).join(" • ")}</div>` : ""}
    </section>
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

function findLeaderboard(leaderboards, label) {
  return (leaderboards ?? []).find((board) => board.label === label) ?? (leaderboards ?? [])[0] ?? null;
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
  }
  *{box-sizing:border-box;}
  body{margin:0; background:var(--bg); color:var(--ink); font-family:"Newsreader",Georgia,"Times New Roman",serif;}
  a{color:var(--green); text-decoration:none;}
  a:hover{color:oklch(0.30 0.09 152);}
  .page{max-width:1200px; margin:0 auto; padding-bottom:56px;}
  .empty-state{color:var(--ink-soft); font-family:"IBM Plex Sans",sans-serif; font-size:14px;}
  .util-strip{display:flex; justify-content:space-between; align-items:center; padding:10px 32px; background:var(--ink); color:var(--bg); font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.08em; text-transform:uppercase;}
  .util-strip .dim{color:oklch(0.65 0.01 260); margin-left:16px;}
  .util-right span{margin-left:20px;}
  .masthead{padding:38px 32px 24px 32px; border-bottom:3px solid var(--ink);}
  .masthead h1{margin:0; font-size:clamp(42px, 7.5vw, 80px); font-weight:600; letter-spacing:-0.01em;}
  .masthead-meta{display:flex; justify-content:space-between; margin-top:16px; font-family:"IBM Plex Sans",sans-serif; font-size:13px; color:var(--ink-soft);}
  .main-grid{display:grid; grid-template-columns: 2fr 1fr; gap:48px; padding:36px 32px 0 32px;}
  @media (max-width: 860px){ .main-grid{grid-template-columns: 1fr;} }
  .lead-column{display:flex; flex-direction:column; gap:32px;}
  .tag{display:inline-block; background:var(--green); color:#fff; font-family:"IBM Plex Sans",sans-serif; font-size:10.5px; letter-spacing:.1em; font-weight:700; text-transform:uppercase; padding:4px 10px; margin-bottom:12px;}
  .dateline{font-family:"IBM Plex Sans",sans-serif; font-size:12px; color:var(--ink-soft); letter-spacing:.04em; margin-bottom:12px;}
  .news-snippet .label, .news-section > .label, .opinion-section > .label{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.12em; font-weight:700; text-transform:uppercase; color:var(--ink); border-bottom:2px solid var(--ink); padding-bottom:6px; display:inline-block;}
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
  .scores-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); gap:14px; margin-top:14px;}
  .score-card{border:1px solid var(--rule); padding:12px; font-family:"IBM Plex Sans",sans-serif; font-size:13px;}
  .score-line{display:flex; justify-content:space-between;}
  .score-meta{color:var(--ink-soft); font-size:11px; margin-top:8px;}
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
  .footer-ticker{margin-top:40px; padding:16px 32px; font-family:"IBM Plex Sans",sans-serif; font-size:13px;}
  .ticker-row{margin-bottom:8px;}
  .ticker-row.injuries{background:var(--green-soft); border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); padding:12px 0; margin:0 -32px 8px -32px; padding-left:32px; padding-right:32px;}
`;
