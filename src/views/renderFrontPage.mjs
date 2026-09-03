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

  const headlines = snapshot.headlines ?? [];
  const [hero, ...restHeadlines] = headlines;
  const secondaryStories = restHeadlines.slice(0, 2);

  const featured = pickFeaturedDivision(snapshot.standingsSections ?? []);
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
    <div class="kicker">${escapeHtml(city)} &bull; ${escapeHtml(leagueName)}</div>
    <h1>${escapeHtml(newspaperName)}</h1>
    <div class="masthead-meta">
      <span>${escapeHtml(snapshot.leagueDateLabel ?? "")}</span>
      <span>${escapeHtml(formatMode(snapshot.currentMode))}</span>
    </div>
  </header>

  <div class="main-grid">
    <div class="lead-column">
      ${hero ? renderHero(hero) : `<p class="empty-state">No headline candidates were detected in the current export.</p>`}
      ${secondaryStories.length ? `<div class="secondary-grid">${secondaryStories.map(renderSecondaryStory).join("")}</div>` : ""}
    </div>

    <aside class="sidebar">
      ${renderThreeStars(snapshot.threeStarsOfDay ?? [])}
      ${featured ? renderStandingsSnippet(featured) : ""}
      ${battingSnippet ? renderLeadersSnippet(battingSnippet) : ""}
    </aside>
  </div>

  ${renderOpinionDesk(columns ?? [])}

  ${renderBoxScores(snapshot.lastDayScores ?? [])}

  ${renderPennantRaces(snapshot.standingsSections ?? [])}

  ${renderFooterTicker(snapshot.injuries ?? [], snapshot.transactions ?? [])}

</div>
</body>
</html>`;
}

// ---------- hero / secondary stories ----------

function renderHero(headline) {
  return `
    <article class="hero-story">
      <div class="tag">${escapeHtml(inferTag(headline))}</div>
      <h2>${escapeHtml(headline.title)}</h2>
      ${headline.date ? `<div class="dateline">${escapeHtml(headline.date.toUpperCase())}</div>` : ""}
      <p class="hero-body">${escapeHtml(headline.fullText || headline.summary || "")}</p>
    </article>
  `;
}

function renderSecondaryStory(headline) {
  return `
    <div class="secondary-story">
      <h3>${escapeHtml(headline.title)}</h3>
      ${headline.date ? `<div class="dateline small">${escapeHtml(headline.date.toUpperCase())}</div>` : ""}
      <p>${escapeHtml(truncateToSentences(headline.fullText || headline.summary || "", 2))}</p>
    </div>
  `;
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

// ---------- opinion desk ----------

function renderOpinionDesk(columns) {
  if (!columns.length) {
    return "";
  }

  const [lead, ...rest] = columns;

  return `
    <section class="opinion-band">
      <div class="kicker light">Opinion Desk</div>
      <div class="opinion-grid">
        <div class="opinion-lead">
          <h3>${escapeHtml(lead.headline)}</h3>
          <div class="byline">${escapeHtml(lead.author)}</div>
          <p>${escapeHtml(truncateToSentences(lead.body, 3))}</p>
        </div>
        ${rest
          .slice(0, 2)
          .map(
            (column) => `
              <div class="opinion-secondary">
                <h4>${escapeHtml(column.headline)}</h4>
                <div class="byline">${escapeHtml(column.author)}</div>
                <p>${escapeHtml(truncateToSentences(column.body, 1))}</p>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
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

function pickFeaturedDivision(sections) {
  const divisions = sections.filter((section) => section.kind === "division" && section.rows?.length);

  if (!divisions.length) {
    return null;
  }

  const ranked = divisions
    .map((section) => ({ section, rows: section.rows, leaderPct: winPct(section.rows[0]) }))
    .sort((a, b) => b.leaderPct - a.leaderPct);

  return ranked[0];
}

function winPct(row) {
  const wins = Number.parseInt(row?.W, 10) || 0;
  const losses = Number.parseInt(row?.L, 10) || 0;
  const total = wins + losses;
  return total ? wins / total : 0;
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

function shortenTeamName(fullName) {
  const name = String(fullName ?? "").trim();
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
  .masthead{padding:32px 32px 18px 32px; border-bottom:3px solid var(--ink);}
  .kicker{font-family:"IBM Plex Sans",sans-serif; font-size:11px; letter-spacing:.14em; font-weight:600; text-transform:uppercase; color:var(--green);}
  .kicker.light{color:oklch(0.70 0.05 152);}
  .masthead h1{margin:6px 0 0 0; font-size:clamp(36px, 6vw, 68px); font-weight:600; letter-spacing:-0.01em;}
  .masthead-meta{display:flex; justify-content:space-between; margin-top:10px; font-family:"IBM Plex Sans",sans-serif; font-size:13px; color:var(--ink-soft);}
  .main-grid{display:grid; grid-template-columns: 2fr 1fr; gap:48px; padding:36px 32px 0 32px;}
  @media (max-width: 860px){ .main-grid{grid-template-columns: 1fr;} }
  .lead-column{display:flex; flex-direction:column; gap:32px;}
  .hero-story .tag{display:inline-block; background:var(--green); color:#fff; font-family:"IBM Plex Sans",sans-serif; font-size:10.5px; letter-spacing:.1em; font-weight:700; text-transform:uppercase; padding:4px 10px; margin-bottom:12px;}
  .hero-story h2{margin:0 0 8px 0; font-size:clamp(26px,4vw,40px); font-weight:600; line-height:1.1;}
  .dateline{font-family:"IBM Plex Sans",sans-serif; font-size:12px; color:var(--ink-soft); letter-spacing:.04em; margin-bottom:12px;}
  .dateline.small{font-size:11px;}
  .hero-body{font-size:17px; line-height:1.55; margin:0;}
  .secondary-grid{display:grid; grid-template-columns:1fr 1fr; gap:28px; border-top:1px solid var(--rule); padding-top:24px;}
  @media (max-width: 640px){ .secondary-grid{grid-template-columns:1fr;} }
  .secondary-story h3{margin:0 0 6px 0; font-size:20px; font-weight:600; line-height:1.15;}
  .secondary-story p{font-size:14px; line-height:1.55; margin:0; color:oklch(0.32 0.01 260);}
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
  .opinion-band{margin-top:44px; padding:32px; background:var(--ink); color:var(--bg);}
  .opinion-grid{display:grid; grid-template-columns:2fr 1fr 1fr; gap:36px; margin-top:14px;}
  @media (max-width: 860px){ .opinion-grid{grid-template-columns:1fr;} }
  .opinion-band h3{margin:0 0 6px 0; font-size:22px; font-weight:600;}
  .opinion-band h4{margin:0 0 6px 0; font-size:17px; font-weight:600; line-height:1.2;}
  .byline{font-family:"IBM Plex Sans",sans-serif; font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; color:oklch(0.65 0.01 260); margin-bottom:8px;}
  .opinion-band p{font-size:14px; line-height:1.6; margin:0; color:oklch(0.85 0.005 260);}
  .scores-strip{padding:32px 32px 0 32px;}
  .scores-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); gap:14px; margin-top:14px;}
  .score-card{border:1px solid var(--rule); padding:12px; font-family:"IBM Plex Sans",sans-serif; font-size:13px;}
  .score-line{display:flex; justify-content:space-between;}
  .score-meta{color:var(--ink-soft); font-size:11px; margin-top:8px;}
  .pennant-races{margin-top:48px; padding:32px 32px 0 32px; border-top:1px solid var(--ink);}
  .conference-grid{display:grid; gap:48px; margin-top:20px;}
  @media (max-width: 860px){ .conference-grid{grid-template-columns:1fr !important;} }
  .conf-label{font-family:"IBM Plex Sans",sans-serif; font-size:13px; letter-spacing:.1em; font-weight:700; text-transform:uppercase; border-bottom:1px solid var(--ink); padding-bottom:8px; margin-bottom:16px;}
  .division-stack{display:flex; flex-direction:column; gap:20px;}
  .sublabel{font-family:"IBM Plex Sans",sans-serif; font-size:11.5px; letter-spacing:.08em; font-weight:700; text-transform:uppercase; color:var(--green); display:block;}
  .footer-ticker{margin-top:40px; padding:16px 32px; font-family:"IBM Plex Sans",sans-serif; font-size:13px;}
  .ticker-row{margin-bottom:8px;}
  .ticker-row.injuries{background:var(--green-soft); border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); padding:12px 0; margin:0 -32px 8px -32px; padding-left:32px; padding-right:32px;}
`;
