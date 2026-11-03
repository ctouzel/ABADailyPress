// Shared "how far along is the season, and is this team still realistically
// alive" logic. Used by the render layer (renderFrontPage.mjs — gates the
// standings table's Magic Number column) and by both columnist engines
// (columnFactory.mjs's algorithmic Matt Gropius, aiColumnFactory.mjs's
// AI-written one) so a team buried in the standings doesn't get written up
// as part of a live division race once the season is mostly over.

// "Late season" = the team that's played the most games has reached this
// fraction of the full regular-season schedule. Using games played rather
// than a calendar date keeps this correct even if a team's games get
// rained out/rescheduled, and keeps it portable to any league-config.json
// with a different season length.
export const LATE_SEASON_PROGRESS = 0.75;

export function isLateSeason(standingsSections, totalGames) {
  const games = Number(totalGames) || 0;
  if (!games) {
    return false;
  }

  const maxGamesPlayed = (standingsSections ?? []).reduce(
    (seasonMax, section) =>
      (section.rows ?? []).reduce((sectionMax, row) => {
        const played = (Number(row.W) || 0) + (Number(row.L) || 0);
        return Math.max(sectionMax, played);
      }, seasonMax),
    0,
  );

  return maxGamesPlayed / games >= LATE_SEASON_PROGRESS;
}

// Standings "GB" cells come as "-" (in first place), "+N" (ahead of a
// wildcard cutoff by N games), a plain number ("24.5"), or occasionally
// non-numeric status text. Returns 0 for an "in front" reading, the
// parsed deficit as a number, or null when it isn't a readable back-of-
// the-pack number at all.
export function parseGamesBackNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text.startsWith("+")) {
    return 0;
  }

  const num = Number.parseFloat(text);
  return Number.isFinite(num) ? num : null;
}

// A team is out of realistic contention once it's behind by more games
// than it has left to play — it can't close that gap on its own results
// alone, never mind what the teams ahead of it do. Deliberately generous
// (ignores head-to-head/tiebreakers, and treats an unreadable GB value as
// "not out of contention" rather than guessing) so this only flags teams
// that are unambiguously done, not merely longshots.
export function isOutOfContention(gamesBack, gamesRemaining) {
  const gb = typeof gamesBack === "number" ? gamesBack : parseGamesBackNumber(gamesBack);
  if (gb === null || gb <= 0) {
    return false;
  }
  if (!Number.isFinite(gamesRemaining)) {
    return false;
  }

  return gb > gamesRemaining;
}
