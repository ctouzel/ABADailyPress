// Shared offseason-transaction analysis for Matt Gropius's offseason column
// topics (a notable signing, a team's winter recap, a division call, and the
// best/worst-offseason-team rankings). Built once here so the algorithmic
// column engine (columnFactory.mjs) and the AI-written one
// (aiColumnFactory.mjs) classify the same raw transaction feed
// (snapshot.transactions — see snapshotBuilder.mjs's buildTransactionItems)
// the same way, instead of drifting apart on what counts as a "big" move.
//
// Transaction summary text looks like (team names/players vary):
//   "Albuquerque Isotopes : Signed free agent 1B David Shelton to a 3-year
//   contract worth a total of $16,900,000."
//   "Vancouver Canadians : Signed SP Orlando Cora to a 3-year contract
//   extension worth a total of $96,400,000."
//   "Stockton Ospreys : Signed free agent RP Brett Criste to a minor league
//   contract with a $75,000 signing bonus."
//   "Pasadena Eagles : 2B Olivier Boucher becomes a free-agent."
//   "El Paso Tigers : Released LF Jose Jimenez."
//   "The Charlotte Knights traded ... to the Portland Sea Dogs, getting ... in return."
// Note the table-cell extraction leaves a space before the colon on the
// team-prefixed rows ("Team Name : Signed ..."), so every pattern below
// tolerates that.

const FREE_AGENT_SIGNING_PATTERN =
  /^(.+?)\s*:\s*Signed free agent ([A-Z0-9]+)\s+(.+?)\s+to an? (\d+)-year contract worth a total of \$([\d,]+)\.?$/i;
const EXTENSION_PATTERN =
  /^(.+?)\s*:\s*Signed ([A-Z0-9]+)\s+(.+?)\s+to an? (\d+)-year contract extension worth a total of \$([\d,]+)\.?$/i;
const MINOR_LEAGUE_SIGNING_PATTERN = /^(.+?)\s*:\s*Signed (free agent |international amateur )?([A-Z0-9]+)\s+(.+?)\s+(?:out of .+?\s+)?to an? minor league contract/i;
const FREE_AGENT_DEPARTURE_PATTERN = /^(.+?)\s*:\s*(.+?) becomes a free-agent\.?$/i;
const RELEASE_PATTERN = /^(.+?)\s*:\s*Released ([A-Z0-9]+)\s+(.+?)\.?$/i;
const TRADE_PATTERN = /^The (.+?) traded (.+?) to the (.+?)\s*,\s*getting (.+?) in return\.?$/i;

function parseDollarAmount(text) {
  const n = Number.parseInt(String(text ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(amount) {
  const n = Number(amount) || 0;
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `$${Math.round(n / 1000)}K`;
  }
  return `$${n}`;
}

// Classifies one transaction's summary text into a typed record. Returns
// { type, team?, player?, position?, years?, totalValue?, text } where
// `type` is one of: free-agent-signing, extension, minor-league-signing,
// free-agent-departure, release, trade, roster-move, other.
export function classifyTransaction(summary) {
  const text = String(summary ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return { type: "other", text };
  }

  let match = text.match(FREE_AGENT_SIGNING_PATTERN);
  if (match) {
    return {
      type: "free-agent-signing",
      team: match[1].trim(),
      position: match[2].trim(),
      player: match[3].trim(),
      years: Number.parseInt(match[4], 10),
      totalValue: parseDollarAmount(match[5]),
      text,
    };
  }

  match = text.match(EXTENSION_PATTERN);
  if (match) {
    return {
      type: "extension",
      team: match[1].trim(),
      position: match[2].trim(),
      player: match[3].trim(),
      years: Number.parseInt(match[4], 10),
      totalValue: parseDollarAmount(match[5]),
      text,
    };
  }

  match = text.match(MINOR_LEAGUE_SIGNING_PATTERN);
  if (match) {
    return {
      type: "minor-league-signing",
      team: match[1].trim(),
      international: Boolean(match[2]?.toLowerCase().includes("international")),
      position: match[3].trim(),
      player: match[4].trim(),
      text,
    };
  }

  match = text.match(FREE_AGENT_DEPARTURE_PATTERN);
  if (match) {
    return { type: "free-agent-departure", team: match[1].trim(), player: match[2].trim(), text };
  }

  match = text.match(RELEASE_PATTERN);
  if (match) {
    return { type: "release", team: match[1].trim(), position: match[2].trim(), player: match[3].trim(), text };
  }

  match = text.match(TRADE_PATTERN);
  if (match) {
    return {
      type: "trade",
      fromTeam: match[1].trim(),
      sent: match[2].trim(),
      toTeam: match[3].trim(),
      received: match[4].trim(),
      text,
    };
  }

  if (/designated for assignment|secondary \(40-man\) roster|waivers/i.test(text)) {
    return { type: "roster-move", text };
  }

  return { type: "other", text };
}

// Builds the shared offseason digest from snapshot.transactions
// ({date, summary}[]). Every list below is newest-first, matching the
// input order.
export function buildOffseasonDigest(transactions) {
  const items = (transactions ?? []).map((entry) => ({ date: entry?.date ?? "", ...classifyTransaction(entry?.summary) }));

  const bigMoves = items
    .filter((item) => (item.type === "free-agent-signing" || item.type === "extension") && item.totalValue > 0)
    .sort((left, right) => right.totalValue - left.totalValue);

  const byTeam = new Map();
  const ensureTeam = (teamName) => {
    if (!teamName) return null;
    if (!byTeam.has(teamName)) {
      byTeam.set(teamName, { team: teamName, signings: [], departures: [], trades: [], totalCommitted: 0 });
    }
    return byTeam.get(teamName);
  };

  for (const item of items) {
    if (item.type === "free-agent-signing" || item.type === "extension" || item.type === "minor-league-signing") {
      const record = ensureTeam(item.team);
      if (record) {
        record.signings.push(item);
        record.totalCommitted += item.totalValue ?? 0;
      }
    } else if (item.type === "free-agent-departure" || item.type === "release") {
      const record = ensureTeam(item.team);
      if (record) {
        record.departures.push(item);
      }
    } else if (item.type === "trade") {
      const fromRecord = ensureTeam(item.fromTeam);
      if (fromRecord) fromRecord.trades.push(item);
      const toRecord = ensureTeam(item.toTeam);
      if (toRecord) toRecord.trades.push(item);
    }
  }

  const teamSpendRanking = [...byTeam.values()]
    .map((record) => ({
      team: record.team,
      totalCommitted: record.totalCommitted,
      signingCount: record.signings.filter((s) => s.type !== "minor-league-signing").length,
      departureCount: record.departures.length,
    }))
    .sort((left, right) => right.totalCommitted - left.totalCommitted);

  return { items, bigMoves, byTeam, teamSpendRanking };
}

// Teams that have at least one real (non-minor-league) signing, extension,
// departure, or trade — i.e. enough for a "here's their winter" recap.
export function teamsWithNotableActivity(digest) {
  return [...digest.byTeam.values()].filter(
    (record) =>
      record.signings.some((s) => s.type !== "minor-league-signing") ||
      record.departures.length > 0 ||
      record.trades.length > 0,
  );
}
