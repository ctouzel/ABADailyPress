import fs from "node:fs";
import path from "node:path";
import { historySheet } from "../data/historySheet.mjs";

export function enrichSnapshotWithHistory(snapshot) {
  const notes = buildHistoryNotes(snapshot);
  const lookBackItems = buildLookBackItems(snapshot);

  return {
    ...snapshot,
    historyNotes: notes,
    lookBackItems,
    historySource: historySheet.source,
  };
}

export function findTeamHistory(teamName) {
  const normalized = normalizeName(teamName);
  return historySheet.teams.find((team) => normalizeName(team.fullName) === normalized) ?? null;
}

export function findPlayerHistory(playerName) {
  const normalized = normalizeName(playerName);
  return historySheet.greats.find((player) => normalizeName(player.name) === normalized) ?? null;
}

export function findRecordByPlayer(playerName) {
  const normalized = normalizeName(playerName);
  return [...historySheet.records.career, ...historySheet.records.season].filter(
    (record) => normalizeName(record.holder) === normalized,
  );
}

export function findLeaderboardEntriesByPlayer(playerName) {
  const normalized = normalizeName(playerName);
  return readHistoricalLeaderboardEntries()
    .filter((entry) => normalizeName(entry.player) === normalized)
    .sort((left, right) => left.rank - right.rank || left.player.localeCompare(right.player));
}

export function getLastCompletedSeason() {
  return historySheet.history.find((entry) => entry.champion) ?? null;
}

export function summarizeTeamLegacy(teamName) {
  const team = findTeamHistory(teamName);
  if (!team) {
    return "";
  }

  const parts = [];
  if (team.championships) {
    parts.push(`${team.championships} championship${team.championships === 1 ? "" : "s"}`);
  }
  if (team.conferenceTitles) {
    parts.push(`${team.conferenceTitles} conference title${team.conferenceTitles === 1 ? "" : "s"}`);
  }
  if (team.divisionTitles) {
    parts.push(`${team.divisionTitles} division crown${team.divisionTitles === 1 ? "" : "s"}`);
  }

  return parts.join(", ");
}

function buildHistoryNotes(snapshot) {
  const notes = [];
  const standingsLeader = snapshot.standings?.[0]?.Team;
  const standingsLeaderHistory = findTeamHistory(standingsLeader);
  const lastChampion = getLastCompletedSeason();

  if (lastChampion) {
    notes.push({
      kicker: "Defending Crown",
      text: `${lastChampion.champion} won the ${lastChampion.year} title, with ${lastChampion.championshipMvp} taking championship MVP honors.`,
    });
  }

  if (standingsLeaderHistory) {
    const legacy = summarizeTeamLegacy(standingsLeaderHistory.fullName);
    notes.push({
      kicker: "Standings Context",
      text: legacy
        ? `${standingsLeaderHistory.fullName} currently lead the table. Historically, the club owns ${legacy} since joining the league in ${standingsLeaderHistory.firstYear}.`
        : `${standingsLeaderHistory.fullName} currently lead the table, but this would be new ground for a franchise that has yet to build a trophy shelf.`,
    });
  }

  const headlinePlayers = extractHeadlinePlayers(snapshot.headlines ?? []);
  for (const playerName of headlinePlayers) {
    const playerHistory = findPlayerHistory(playerName);
    if (!playerHistory) {
      continue;
    }

    const recordHits = findRecordByPlayer(playerName);
    const accolades = [];
    if (playerHistory.mvps) {
      accolades.push(`${playerHistory.mvps} MVP${playerHistory.mvps === 1 ? "" : "s"}`);
    }
    if (playerHistory.championships) {
      accolades.push(`${playerHistory.championships} title${playerHistory.championships === 1 ? "" : "s"}`);
    }
    if (playerHistory.notes) {
      accolades.push(playerHistory.notes);
    }
    const recordText = recordHits[0]
      ? ` He also owns the ${recordHits[0].category.toLowerCase()} record at ${recordHits[0].value}${recordHits[0].year ? `, set in ${recordHits[0].year}` : ""}.`
      : "";

    notes.push({
      kicker: "Archive Note",
      text: `${playerHistory.name} is already one of the era's signature names, carrying ${accolades.join(", ")}.${recordText}`,
    });
    break;
  }

  return notes.slice(0, 3);
}

function extractHeadlinePlayers(headlines) {
  const players = new Set();

  for (const headline of headlines) {
    const title = String(headline.title ?? "");
    const honoredMatch = title.match(/^[A-Z0-9/ -]+\s+(.+?)\s+of the\s+/i);
    if (honoredMatch) {
      players.add(honoredMatch[1].trim());
    }

    const allStarText = String(headline.fullText ?? "");
    for (const match of allStarText.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+)+)\b/g)) {
      const candidate = match[1].trim();
      if (findPlayerHistory(candidate)) {
        players.add(candidate);
      }
    }
  }

  return [...players];
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildLookBackItems(snapshot) {
  const items = [];
  const recentHistory = historySheet.history.filter((entry) => entry && entry.year);
  const awardMemory = buildAwardMemoryLookBackItem(snapshot);
  const latestMarketMove = recentHistory.find((entry) => entry.topSigning || entry.topTrade);
  const legend = pickStableLegend(snapshot);
  const leaderboardNotes = buildLeaderboardLookBackItems(snapshot);
  const accomplishmentFeat = buildAccomplishmentLookBackItem(snapshot);

  if (awardMemory) {
    items.push({
      kicker: awardMemory.kicker,
      text: awardMemory.text,
    });
  }

  items.push(...leaderboardNotes);

  if (accomplishmentFeat) {
    items.push({
      kicker: accomplishmentFeat.kicker,
      text: accomplishmentFeat.text,
    });
  }

  if (latestMarketMove) {
    const moveText = [
      latestMarketMove.topSigning ? `the winter's loudest signing was ${latestMarketMove.topSigning}` : "",
      latestMarketMove.topTrade ? `the trade everybody remembered was ${latestMarketMove.topTrade}` : "",
    ].filter(Boolean).join(", and ");

    items.push({
      kicker: "Hot Stove Echo",
      text: `Back in ${latestMarketMove.year}, ${moveText}. Those are the kinds of moves that give an era its own flavor.`,
    });
  }

  if (legend) {
    const parts = [];
    if (legend.championships) {
      parts.push(`${legend.championships} championship${legend.championships === 1 ? "" : "s"}`);
    }
    if (legend.seasons) {
      parts.push(`${legend.seasons} seasons`);
    }
    if (legend.notes) {
      parts.push(legend.notes);
    }

    items.push({
      kicker: "League Figure",
      text: `${legend.name} still reads like ABA folklore: ${parts.join(", ")}.${legend.opsPlus ? ` The bat also left a mark in ${legend.opsPlus} elite OPS+ season${legend.opsPlus === 1 ? "" : "s"}.` : ""}`,
    });
  }

  const prospectsGame = recentHistory.find((entry) => entry.prospectsGameMvp && entry.prospectsGameMvp !== "N/A");
  if (prospectsGame) {
    items.push({
      kicker: "Prospect Game Flash",
      text: `${prospectsGame.prospectsGameMvp} grabbed the Prospects Game spotlight in ${prospectsGame.year}, the sort of footnote that looks small until that player grows into the center of a pennant race.`,
    });
  }

  return items.slice(0, 4);
}

function buildAwardMemoryLookBackItem(snapshot) {
  const awards = readHistoricalAwardMemories();
  if (!awards.length) {
    return null;
  }

  const seed = `${String(snapshot.generatedAt ?? "").slice(0, 10)}::award-memory`;
  const selected = awards
    .map((item, index) => ({
      item,
      score: hashSeed(`${seed}::${index}::${item.year}::${item.award}::${item.player}::${item.team}`),
    }))
    .sort((left, right) => left.score - right.score)[0]?.item;

  if (!selected) {
    return null;
  }

  const teamText = selected.team ? ` for ${selected.team}` : "";
  const detailText = selected.detail ? ` ${selected.detail}` : "";

  return {
    kicker: "Award Memory",
    text: `${selected.player} won the ${selected.year} ${selected.award}${teamText}.${detailText}`.trim(),
  };
}

function readHistoricalAwardMemories() {
  const historyDir = path.resolve(process.cwd(), "News", "history");
  if (!fs.existsSync(historyDir)) {
    return [];
  }

  const fileSpecs = [
    { fileName: "sl_award_winners_200_0.html", type: "major" },
    { fileName: "sl_award_winners_200_1.html", type: "major" },
    { fileName: "sl_golden_glove_award_winners_200_0.html", type: "glove" },
    { fileName: "sl_golden_glove_award_winners_200_1.html", type: "glove" },
    { fileName: "sl_silver_slugger_award_winners_200_0.html", type: "bat" },
    { fileName: "sl_silver_slugger_award_winners_200_1.html", type: "bat" },
  ];
  const items = [];

  for (const spec of fileSpecs) {
    const filePath = path.join(historyDir, spec.fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const rawHtml = fs.readFileSync(filePath, "utf8");
    const rows = [...rawHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((match) => {
      const cells = [...match[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];
      return {
        raw: cells.map((cell) => cell[1]),
        clean: cells.map((cell) => cleanHtml(cell[1])),
      };
    });

    if (spec.type === "major") {
      const headerRow = rows.find((row) => row.clean[0] === "Year" && row.clean.includes("Most Valuable Player Award"));
      if (!headerRow) {
        continue;
      }

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row?.clean?.[0] || !/\d{4}/.test(row.clean[0])) {
          continue;
        }

        const year = extractAwardYear(row.clean[0]);
        const detailRow = rows[index + 1]?.clean ?? [];
        for (let cellIndex = 1; cellIndex < headerRow.clean.length; cellIndex += 1) {
          const award = cleanMajorAwardLabel(headerRow.clean[cellIndex] ?? "");
          const winnerCell = row.raw[cellIndex] ?? "";
          const detail = detailRow[cellIndex] ?? "";
          const winner = parseAwardWinnerCell(winnerCell);
          if (!year || !award || !winner?.player) {
            continue;
          }

          items.push({
            year,
            award,
            player: winner.player,
            team: winner.team,
            detail,
          });
        }
      }
      continue;
    }

    const headerRow = rows.find((row) => row.clean[0] === "Year");
    if (!headerRow) {
      continue;
    }

    for (const row of rows) {
      if (!row?.clean?.[0] || !/\d{4}/.test(row.clean[0])) {
        continue;
      }

      const year = extractAwardYear(row.clean[0]);
      for (let cellIndex = 1; cellIndex < row.clean.length; cellIndex += 1) {
        const position = cleanHtml(headerRow.clean[cellIndex] ?? "");
        const winner = parseAwardWinnerCell(row.raw[cellIndex] ?? "");
        if (!year || !position || !winner?.player) {
          continue;
        }

        const award =
          spec.type === "glove"
            ? `${position} Gold Glove`
            : `${position} Platinum Stick`;

        items.push({
          year,
          award,
          player: winner.player,
          team: "",
          detail: "",
        });
      }
    }
  }

  return items;
}

function parseAwardWinnerCell(value) {
  const cleaned = cleanHtml(value);
  if (!cleaned) {
    return null;
  }

  const playerId = String(value ?? "").match(/player_(\d+)\.html/i)?.[1] ?? "";
  const teamMatch = cleaned.match(/\(([^)]+)\)\s*$/);
  const fallbackPlayer = cleaned
    .replace(/\(([^)]+)\)\s*$/g, "")
    .replace(/\(\d+\s*\)/g, "")
    .trim();
  const team = teamMatch ? teamMatch[1].trim() : "";
  const player = resolveHistoryPlayerFullName(playerId) || fallbackPlayer;

  return player ? { player, team } : null;
}

function resolveHistoryPlayerFullName(playerId) {
  if (!playerId) {
    return "";
  }

  const playerPath = path.resolve(process.cwd(), "News", "players", `player_${playerId}.html`);
  if (!fs.existsSync(playerPath)) {
    return "";
  }

  try {
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const reptitle = cleanHtml(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    if (reptitle) {
      return reptitle
        .replace(/^(SP|RP|CL|P|C|1B|2B|3B|SS|LF|CF|RF|DH)\s+/i, "")
        .replace(/\s+#\d+.*$/i, "")
        .trim();
    }

    const title = cleanHtml(rawHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "");
    if (title) {
      return title
        .replace(/^Player Report for\s*#?\d+\s*/i, "")
        .trim();
    }

    return "";
  } catch {
    return "";
  }
}

function extractAwardYear(value) {
  return String(value ?? "").match(/(\d{4})/)?.[1] ?? "";
}

function cleanMajorAwardLabel(value) {
  return String(value ?? "")
    .replace(/\s+Award$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAccomplishmentLookBackItem(snapshot) {
  const feats = readHistoricalAccomplishmentItems()
    .filter((item) => item.player && item.category && item.detail)
    .filter((item) => !/milestones/i.test(item.category));

  if (!feats.length) {
    return null;
  }

  const seed = `${String(snapshot.generatedAt ?? "").slice(0, 10)}::accomplishment-feat`;
  const selected = feats
    .map((item, index) => ({
      item,
      score: hashSeed(`${seed}::${index}::${item.player}::${item.category}::${item.date}::${item.detail}`),
    }))
    .sort((left, right) => left.score - right.score)[0]?.item;
  if (!selected) {
    return null;
  }

  return {
    kicker: "Historic Feat",
    text: formatHistoricalAccomplishmentText(selected),
  };
}

function buildLeaderboardLookBackItems(snapshot) {
  const leaderboardEntries = readHistoricalLeaderboardEntries();
  if (!leaderboardEntries.length) {
    return [];
  }

  const preferredEntries = leaderboardEntries.filter((entry) => entry.rank >= 2 && entry.rank <= 8);
  const fallbackEntries = leaderboardEntries.filter((entry) => entry.rank <= 12);
  const pool = preferredEntries.length ? preferredEntries : fallbackEntries;
  const seed = `${String(snapshot.generatedAt ?? "").slice(0, 10)}::leaderboards`;
  const positionalPool = pool.filter((entry) => entry.group !== "ABA history");
  const selectedEntries = [];

  if (positionalPool.length) {
    selectedEntries.push(...pickStableEntries(positionalPool, `${seed}::positional`, 1));
  }

  for (const entry of pickStableEntries(pool, `${seed}::overall`, 3)) {
    if (selectedEntries.length >= 2) {
      break;
    }
    if (selectedEntries.some((selected) => sameLeaderboardEntry(selected, entry))) {
      continue;
    }
    if (selectedEntries.some((selected) => selected.rank === entry.rank)) {
      continue;
    }
    selectedEntries.push(entry);
  }

  return selectedEntries.map((entry) => ({
    kicker: entry.scope === "career" ? "Leaderboard Watch" : "Season Shelf",
    text: formatLeaderboardLookBackText(entry),
  }));
}

function readHistoricalLeaderboardEntries() {
  const historyDir = path.resolve(process.cwd(), "News", "history");
  if (!fs.existsSync(historyDir)) {
    return [];
  }

  const fileNames = fs
    .readdirSync(historyDir)
    .filter((fileName) => /^league_200_leaderboard_(career|season)_\d+_\d+\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));
  const entries = [];

  for (const fileName of fileNames) {
    const filePath = path.join(historyDir, fileName);
    const rawHtml = fs.readFileSync(filePath, "utf8");
    const title = cleanHtml(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    const subtitle = cleanHtml(rawHtml.match(/<div class="repsubtitle">([^<]+)<\/div>/i)?.[1] ?? "");
    const scope = /career/i.test(title) ? "career" : "season";
    const fallbackGroup = normalizeLeaderboardGroup(title);
    const rowMatches = [...rawHtml.matchAll(/<tr>\s*<td class="dr"[^>]*>(\d+)<\/td>\s*<td class="dl"><a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="d[rc]">([^<]+)<\/td>\s*<td class="dc">([^<]+)<\/td>/gi)];

    for (const match of rowMatches) {
      const rank = Number.parseInt(match[1], 10);
      if (!Number.isFinite(rank) || rank > 12) {
        continue;
      }
      const playerId = cleanHtml(match[2]);
      const playerGroup = resolveHistoryPlayerGroup(playerId);

      entries.push({
        rank,
        player: cleanHtml(match[3]).replace(/[#*]+$/g, "").trim(),
        value: cleanHtml(match[4]),
        years: cleanHtml(match[5]),
        scope,
        group: playerGroup || fallbackGroup,
        stat: toTitleCase(subtitle),
      });
    }
  }

  return entries.filter((entry) => entry.player && entry.stat && entry.group);
}

function readHistoricalAccomplishmentItems() {
  const historyDir = path.resolve(process.cwd(), "News", "history");
  if (!fs.existsSync(historyDir)) {
    return [];
  }

  const fileNames = fs
    .readdirSync(historyDir)
    .filter((fileName) => /^league_200_accomplishments_(?:[1-9]|11)\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));
  const items = [];

  for (const fileName of fileNames) {
    const filePath = path.join(historyDir, fileName);
    const rawHtml = fs.readFileSync(filePath, "utf8");
    const category = cleanHtml(rawHtml.match(/<span class="boxcurrent">([^<]+)<\/span>/i)?.[1] ?? "");

    for (const match of rawHtml.matchAll(
      /<tr>\s*<td class="d[lr]">([^<]+)<\/td>\s*<td class="dl"><a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dl">([\s\S]*?)<\/td>/gi,
    )) {
      const date = cleanHtml(match[1]);
      const playerId = cleanHtml(match[2]);
      const player = cleanHtml(match[3]).replace(/[#*]+$/g, "").trim();
      const detail = cleanHtml(match[4]);

      if (!player || !detail || !category) {
        continue;
      }

      items.push({
        date,
        playerId,
        player,
        category,
        detail,
      });
    }
  }

  return items;
}

function formatHistoricalAccomplishmentText(item) {
  const dateText = item.date ? ` (${item.date})` : "";
  const categoryText = String(item.category ?? "").trim();
  const detailText = String(item.detail ?? "").trim().replace(/\s+/g, " ");

  if (/hitting streaks?/i.test(categoryText)) {
    return `${item.player}${dateText}: ${detailText}, the kind of run that can take over a whole summer.`;
  }

  return `${item.player}${dateText}: ${detailText}.`;
}

function normalizeLeaderboardGroup(title) {
  const cleaned = cleanHtml(title).replace(/\s+(SINGLE\s+SEASON|CAREER|SEASON)$/i, "").trim();
  const map = {
    "CAREER": "ABA history",
    "SEASON": "ABA history",
    "CATCHERS": "catchers",
    "FIRST BASEMEN": "first basemen",
    "SECOND BASEMEN": "second basemen",
    "THIRD BASEMEN": "third basemen",
    "SHORTSTOPS": "shortstops",
    "LEFT FIELDERS": "left fielders",
    "CENTER FIELDERS": "center fielders",
    "RIGHT FIELDERS": "right fielders",
    "DESIGNATED HITTERS": "designated hitters",
    "PITCHERS": "pitchers",
    "REGULAR SEASON": "ABA history",
    "AMERICAN BASEBALL ASSOCIATION": "ABA history",
  };

  return map[cleaned.toUpperCase()] ?? cleaned.toLowerCase();
}

function pickStableEntries(items, seed, count) {
  if (!items.length || count <= 0) {
    return [];
  }

  const scored = items.map((item, index) => ({
    item,
    score: hashSeed(`${seed}::${index}::${item.player}::${item.group}::${item.stat}::${item.rank}`),
  }));

  return scored
    .sort((left, right) => left.score - right.score)
    .slice(0, count)
    .map((entry) => entry.item);
}

function formatLeaderboardLookBackText(entry) {
  const statName = entry.stat.toLowerCase();
  const qualifier = entry.scope === "career" ? "career" : "single-season";
  const place = ordinal(entry.rank);
  const yearsText = entry.scope === "career" ? `across ${entry.years}` : `back in ${entry.years}`;
  const valueText = formatLeaderboardValue(entry.value, entry.stat);

  if (entry.group === "ABA history") {
    return `${entry.player} sits ${place} on the ABA ${qualifier} board for ${statName}, with ${valueText} ${yearsText}.`;
  }

  return `${entry.player} ranks ${place} among ABA ${entry.group} in ${qualifier} ${statName}, posting ${valueText} ${yearsText}.`;
}

function formatLeaderboardValue(value, stat) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) {
    return "";
  }

  if (/%|pct|average/i.test(stat) || /^\./.test(cleaned)) {
    return cleaned;
  }

  return cleaned;
}

function ordinal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${number}th`;
  }
  switch (number % 10) {
    case 1:
      return `${number}st`;
    case 2:
      return `${number}nd`;
    case 3:
      return `${number}rd`;
    default:
      return `${number}th`;
  }
}

function hashSeed(value) {
  let hash = 0;
  for (const char of String(value ?? "")) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  }
  return Math.abs(hash);
}

function sameLeaderboardEntry(left, right) {
  return left.player === right.player && left.group === right.group && left.stat === right.stat && left.rank === right.rank;
}

const historyPlayerGroupCache = new Map();

function resolveHistoryPlayerGroup(playerId) {
  if (!playerId) {
    return "";
  }

  if (historyPlayerGroupCache.has(playerId)) {
    return historyPlayerGroupCache.get(playerId);
  }

  try {
    const playerPath = path.resolve(process.cwd(), "News", "players", `player_${playerId}.html`);
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const header = cleanHtml(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    const position = header.match(/^(SP|RP|CL|P|C|1B|2B|3B|SS|LF|CF|RF|DH)\b/i)?.[1]?.toUpperCase() ?? "";
    const group = mapPositionToLeaderboardGroup(position);
    historyPlayerGroupCache.set(playerId, group);
    return group;
  } catch {
    historyPlayerGroupCache.set(playerId, "");
    return "";
  }
}

function mapPositionToLeaderboardGroup(position) {
  const map = {
    C: "catchers",
    "1B": "first basemen",
    "2B": "second basemen",
    "3B": "third basemen",
    SS: "shortstops",
    LF: "left fielders",
    CF: "center fielders",
    RF: "right fielders",
    DH: "designated hitters",
    SP: "pitchers",
    RP: "pitchers",
    CL: "pitchers",
    P: "pitchers",
  };

  return map[String(position ?? "").toUpperCase()] ?? "";
}

function cleanHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pickStableLegend(snapshot) {
  const greats = historySheet.greats.filter((player) => player?.name);
  if (!greats.length) {
    return null;
  }

  const seed = `${String(snapshot.generatedAt ?? "").slice(0, 10)}::look-back`;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  }

  return greats[Math.abs(hash) % greats.length] ?? greats[0];
}
