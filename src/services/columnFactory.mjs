import fs from "node:fs";
import path from "node:path";
import {
  findLeaderboardEntriesByPlayer,
  findPlayerHistory,
  findRecordByPlayer,
  findTeamHistory,
  getLastCompletedSeason,
  summarizeTeamLegacy,
} from "./historyContext.mjs";

let currentSnapshotRef = null;

export function buildColumns(snapshot, config, previousState = {}) {
  currentSnapshotRef = snapshot;
  const usedTargets = new Set();
  const columns = config.columnists
    .map((columnist, index) => buildColumn(snapshot, columnist, index, previousState, usedTargets))
    .filter(Boolean);
  currentSnapshotRef = null;
  return columns;
}

function buildColumn(snapshot, columnist, index, previousState, usedTargets) {
  if (columnist.name === "Mack Dalton") {
    return buildMackDaltonColumn(snapshot, columnist, previousState[columnist.name], usedTargets);
  }
  if (columnist.name === "Darren Kline" || columnist.name === "Ivy Knox") {
    return buildDarrenKlineColumn(snapshot, columnist, previousState[columnist.name] ?? previousState["Ivy Knox"], usedTargets);
  }
  if (columnist.name === "Matt Gropius" || columnist.name === "Rico Valez") {
    return buildMattGropiusColumn(snapshot, columnist, previousState[columnist.name] ?? previousState["Rico Valez"], usedTargets);
  }

  const leadTeam = snapshot.standings[0];
  const battingStar = snapshot.battingLeaders[0];
  const pitchingStar = snapshot.pitchingLeaders[0];
  const topHeadline = snapshot.headlines[0];

  const body = [];

  if (index % 3 === 0) {
    const legacy = leadTeam ? summarizeTeamLegacy(bestLabel(leadTeam)) : "";
    body.push(
      leadTeam
        ? `I think the table matters more than the noise, and right now ${bestLabel(leadTeam)} owns the strongest silhouette in the league. A club does not drift into first place by accident; it gets there by surviving the flat days and punishing weaker opponents without apology.${legacy ? ` The historical file adds weight too: ${bestLabel(leadTeam)} already carry ${legacy}.` : ""}`
        : `I open this edition insisting that April lies are already hardening into May truths. Without a reliable standings table, the only honest move is to keep watching for which clubs stop pretending and start imposing themselves.`,
    );
  }

  if (index % 3 === 1) {
    body.push(
      pitchingStar
        ? `I keep circling run prevention, because numbers have a way of exposing the real adults in the room. The most persuasive line in today's export belongs to ${bestLabel(pitchingStar)}, whose profile suggests that dominance is being built on repeatable skill rather than a lucky week.`
        : `I wanted a clean pitching signal and instead found a mess of fragments, which is a useful lesson in itself. Until the export gives us a sharper leaderboard, any staff claiming superiority should do so quietly.`,
    );
  }

  if (index % 3 === 2) {
    body.push(
      battingStar
        ? `I treat the batting page like theater, and today's leading attraction is ${bestLabel(battingStar)}. Hot streaks can vanish overnight, but star power changes the emotional weather of a league, especially when every rival fanbase starts checking the box scores before breakfast.`
        : `I lean into mood over math today, because some editions are defined less by clean leaderboards and more by the uneasy feeling that somebody's hero is about to catch fire.`,
    );
  }

  if (topHeadline) {
    body.push(
      `The newsroom is also chasing "${topHeadline.title}," a story that feels large enough to bend tomorrow's conversations. My angle is ${columnist.focus}, which means the takeaway is not just what happened, but what it threatens to change next.`,
    );
  }

  return {
    author: columnist.name,
    role: columnist.role,
    voice: columnist.voice,
    focus: columnist.focus,
    headline: buildColumnHeadline(columnist, leadTeam, topHeadline),
    body: body.join(" "),
  };
}

function buildMackDaltonColumn(snapshot, columnist, previousColumn, usedTargets) {
  const topic = pickMackTopic(snapshot, previousColumn, usedTargets);

  return {
    author: columnist.name,
    role: columnist.role,
    voice: columnist.voice,
    focus: columnist.focus,
    headline: topic.headline,
    body: topic.body,
    topicKey: topic.topicKey ?? "",
    targetKey: topic.targetKey ?? "",
  };
}

function buildMattGropiusColumn(snapshot, columnist, previousColumn, usedTargets) {
  const topic = pickMattTopic(snapshot, previousColumn, usedTargets);

  return {
    author: columnist.name,
    role: columnist.role,
    voice: columnist.voice,
    focus: columnist.focus,
    headline: topic.headline,
    body: topic.body,
    topicKey: topic.topicKey ?? "",
    targetKey: topic.targetKey ?? "",
  };
}

function buildDarrenKlineColumn(snapshot, columnist, previousColumn, usedTargets) {
  const topic = pickDarrenRankingTopic(snapshot, previousColumn, usedTargets);
  if (!topic) {
    return null;
  }

  return {
    author: columnist.name,
    role: columnist.role,
    voice: columnist.voice,
    focus: columnist.focus,
    headline: topic.headline,
    body: topic.body,
    topicKey: topic.topicKey ?? "",
    targetKey: topic.targetKey ?? "",
  };
}

let darrenRankingPoolCache = null;

function pickDarrenRankingTopic(snapshot, previousColumn, usedTargets) {
  const pool = loadDarrenRankingPool(snapshot);
  if (!pool.length) {
    return pickDarrenTopPlayerTopic(snapshot, previousColumn, usedTargets);
  }

  const categories = buildDarrenRankingCategories(pool);
  if (!categories.length) {
    return pickDarrenTopPlayerTopic(snapshot, previousColumn, usedTargets);
  }

  const dateSeed = String(snapshot?.leagueDateLabel ?? snapshot?.generatedAt ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const category = categories[pickStableIndexForColumns(`darren-ranking:${dateSeed}`, categories.length)] ?? categories[0];
  if (!category) {
    return pickDarrenTopPlayerTopic(snapshot, previousColumn, usedTargets);
  }

  const ranked = [...category.players]
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3);
  if (ranked.length < 3) {
    return pickDarrenTopPlayerTopic(snapshot, previousColumn, usedTargets);
  }

  const ordered = [...ranked].reverse();
  const headline = `Darren Kline: ${buildDarrenRankingHeadline(category)}`;
  const intro = buildDarrenRankingIntro(category, ranked);
  const paragraphs = ordered.map((player, index) => {
    const rankLabel = `No. ${3 - index}`;
    return `${rankLabel}: ${player.name}, ${buildDarrenRankingPlayerLine(player, category)}`;
  });

  return {
    headline,
    body: [intro, ...paragraphs].join("\n\n"),
    topicKey: `darren:ranking:${category.key}`,
    targetKey: `ranking:${category.key}`,
  };
}

function loadDarrenRankingPool(snapshot) {
  if (darrenRankingPoolCache) {
    return darrenRankingPoolCache;
  }

  const historyDir = path.resolve(process.cwd(), "News", "history");
  if (!fs.existsSync(historyDir)) {
    darrenRankingPoolCache = [];
    return darrenRankingPoolCache;
  }

  const activePlayers = loadDarrenLeaguePlayers(snapshot);
  const activeIds = new Set(activePlayers.map((player) => String(player.playerId ?? "")).filter(Boolean));
  const playerMap = new Map();
  const fileNames = fs
    .readdirSync(historyDir)
    .filter((fileName) => /^sl_(batters|pitchers)_200_[01]_\d{4}\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));
  const allYears = fileNames
    .map((fileName) => Number.parseInt(fileName.match(/_(\d{4})\.html$/i)?.[1] ?? "", 10))
    .filter((year) => Number.isFinite(year));
  const latestYear = allYears.length ? Math.max(...allYears) : 0;
  const recentCutoff = latestYear ? latestYear - 4 : 0;

  for (const fileName of fileNames) {
    const filePath = path.join(historyDir, fileName);
    const rawHtml = fs.readFileSync(filePath, "utf8");
    const type = /^sl_batters_/i.test(fileName) ? "batting" : "pitching";
    const year = Number.parseInt(fileName.match(/_(\d{4})\.html$/i)?.[1] ?? "", 10);
    const rows = extractDarrenHistoryRegisterRows(rawHtml);

    for (const row of rows) {
      const playerId = cleanColumnText(row.playerId ?? "");
      const name = cleanColumnText(row.Player ?? row.player ?? "");
      if (!playerId || !name) {
        continue;
      }

      if (!playerMap.has(playerId)) {
        const meta = readDarrenRankingPlayerMeta(playerId, name);
        playerMap.set(playerId, {
          playerId,
          name: meta.name || name,
          pos: meta.pos || "",
          age: meta.age,
          nationality: meta.nationality || "",
          bats: meta.bats || "",
          throws: meta.throws || "",
          defensiveAwards: meta.defensiveAwards || 0,
          playerHistory: findPlayerHistory(meta.name || name),
          teams: new Set(),
          seasons: new Set(),
          active: activeIds.has(playerId),
          allBatting: initDarrenBattingAggregate(),
          recentBatting: initDarrenBattingAggregate(),
          currentBatting: initDarrenBattingAggregate(),
          allPitching: initDarrenPitchingAggregate(),
          recentPitching: initDarrenPitchingAggregate(),
          currentPitching: initDarrenPitchingAggregate(),
        });
      }

      const player = playerMap.get(playerId);
      const team = cleanColumnText(row.Team ?? row.team ?? "");
      if (team) {
        player.teams.add(team);
      }
      if (Number.isFinite(year) && year > 0) {
        player.seasons.add(year);
      }

      if (type === "batting") {
        updateDarrenBattingAggregate(player.allBatting, row);
        if (year >= recentCutoff) {
          updateDarrenBattingAggregate(player.recentBatting, row);
        }
        if (year === latestYear) {
          updateDarrenBattingAggregate(player.currentBatting, row);
        }
      } else {
        updateDarrenPitchingAggregate(player.allPitching, row);
        if (year >= recentCutoff) {
          updateDarrenPitchingAggregate(player.recentPitching, row);
        }
        if (year === latestYear) {
          updateDarrenPitchingAggregate(player.currentPitching, row);
        }
      }
    }
  }

  darrenRankingPoolCache = [...playerMap.values()]
    .map((player) => ({
      ...player,
      teams: [...player.teams],
      seasonsPlayed: player.seasons.size,
      primaryTeam: [...player.teams][player.teams.size - 1] ?? "",
    }))
    .filter((player) => player.pos && Number.isFinite(player.age));

  return darrenRankingPoolCache;
}

function extractDarrenHistoryRegisterRows(rawHtml) {
  const tableMatch = String(rawHtml ?? "").match(/<table cellspacing="0" cellpadding="0" class="data sortable" width="968px">([\s\S]*?)<\/table>/i);
  if (!tableMatch) {
    return [];
  }

  const rows = [...tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => {
      const rowHtml = match[1];
      const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) => cellMatch[1]);
      if (!cells.length) {
        return null;
      }

      return cells.map((cell) => cleanColumnText(cell));
    })
    .filter(Boolean);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];
  return rows.slice(1)
    .map((cells, index) => {
      const entry = Object.fromEntries(headers.map((header, headerIndex) => [header, cells[headerIndex] ?? ""]));
      const playerIdMatch = String(tableMatch[1]).match(new RegExp(`<tr[^>]*>[\\s\\S]*?<a href="\\.\\.\\/players\\/player_(\\d+)\\.html">${escapeRegExp(cells[0] ?? "")}<\\/a>`, "i"));
      return {
        ...entry,
        playerId: playerIdMatch?.[1] ?? extractDarrenHistoryRowPlayerId(tableMatch[1], index + 1),
      };
    })
    .filter((row) => row.Player || row.player);
}

function extractDarrenHistoryRowPlayerId(tableHtml, rowIndex) {
  const rowMatches = [...String(tableHtml ?? "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rowHtml = rowMatches[rowIndex]?.[1] ?? "";
  return cleanColumnText(rowHtml.match(/player_(\d+)\.html/i)?.[1] ?? "");
}

function readDarrenRankingPlayerMeta(playerId, fallbackName) {
  const playerPagePath = path.resolve(process.cwd(), "News", "players", `player_${playerId}.html`);
  if (!fs.existsSync(playerPagePath)) {
    return {
      name: fallbackName,
      pos: "",
      age: Number.NaN,
      nationality: "",
      bats: "",
      throws: "",
      defensiveAwards: 0,
      allFielding: initDarrenFieldingAggregate(),
      recentFielding: initDarrenFieldingAggregate(),
      currentFielding: initDarrenFieldingAggregate(),
    };
  }

  const rawHtml = fs.readFileSync(playerPagePath, "utf8");
  const reptitle = cleanColumnText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
  const pos = reptitle.match(/^([A-Z0-9]{1,3})\s+/)?.[1] ?? "";
  const titleName = stripDarrenRankingPlayerHeading(reptitle);
  const firstName = cleanColumnText(rawHtml.match(/<tr><td class="dl">First Name<\/td><td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td><\/tr>/i)?.[1] ?? "");
  const lastName = cleanColumnText(rawHtml.match(/<tr><td class="dl">Last Name<\/td><td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td><\/tr>/i)?.[1] ?? "");
  const ageMatch = rawHtml.match(/Age:\s*([^|<]+)\|/i);
  const age = Number.parseInt(cleanColumnText(ageMatch?.[1] ?? ""), 10);
  const nationality = cleanColumnText(
    rawHtml.match(/Nationality:<\/td>\s*<td class="wrap">([^<]+)<\/td>/i)?.[1] ??
    rawHtml.match(/<tr><td class="dl">Nationality<\/td><td class="dl">([^<]+)<\/td><\/tr>/i)?.[1] ??
    "",
  );
  const bats = cleanColumnText(rawHtml.match(/Bats:\s*([^|<]+)\|/i)?.[1] ?? "");
  const throws = cleanColumnText(rawHtml.match(/Throws:\s*([^|<]+)\|/i)?.[1] ?? "");
  const notes = [...String(rawHtml).matchAll(/<td width="888px" class="dl wrap">([\s\S]*?)<\/td>/gi)]
    .map((match) => cleanColumnText(match[1]))
    .filter(Boolean);
  const fielding = extractDarrenFieldingAggregates(rawHtml);

  return {
    name: buildPlainPlayerName([firstName, lastName].filter(Boolean).join(" ") || titleName || fallbackName),
    pos,
    age,
    nationality,
    bats,
    throws,
    defensiveAwards: countDarrenDefensiveAwards(notes),
    allFielding: fielding.all,
    recentFielding: fielding.recent,
    currentFielding: fielding.current,
  };
}

function stripDarrenRankingPlayerHeading(value) {
  return String(value ?? "")
    .replace(/^[A-Z0-9]{1,3}\s+/, "")
    .replace(/\s+#\d+.*$/i, "")
    .trim();
}

function countDarrenDefensiveAwards(notes = []) {
  return (notes ?? []).filter((note) => /gold glove|great glove/i.test(String(note ?? ""))).length;
}

function initDarrenBattingAggregate() {
  return { G: 0, AB: 0, H: 0, HR: 0, RBI: 0, SB: 0, BB: 0, SO: 0, WAR: 0, OPS: 0, OPS_AB: 0, OPSPLUS: 0, OPSPLUS_AB: 0 };
}

function initDarrenPitchingAggregate() {
  return { W: 0, L: 0, SV: 0, IP: 0, SO: 0, WAR: 0, ERA_ER: 0, ERA_IP: 0, WHIP_BASE: 0, WHIP_IP: 0, G: 0, GS: 0, CG: 0, SHO: 0 };
}

function initDarrenFieldingAggregate() {
  return { G: 0, E: 0, ZR_TOTAL: 0, ZR_G: 0, EFF_TOTAL: 0, EFF_G: 0 };
}

function updateDarrenBattingAggregate(target, row) {
  target.G += toDarrenNumber(row.G);
  target.AB += toDarrenNumber(row.AB);
  target.H += toDarrenNumber(row.H);
  target.HR += toDarrenNumber(row.HR);
  target.RBI += toDarrenNumber(row.RBI);
  target.SB += toDarrenNumber(row.SB);
  target.BB += toDarrenNumber(row.BB);
  target.SO += toDarrenNumber(row.SO);
  target.WAR += toDarrenNumber(row.WAR);
  target.OPS += toDarrenRate(row.OPS) * Math.max(1, toDarrenNumber(row.AB));
  target.OPS_AB += Math.max(1, toDarrenNumber(row.AB));
  target.OPSPLUS += toDarrenNumber(row["OPS+"] ?? row["OPS +"]);
  target.OPSPLUS_AB += Math.max(1, toDarrenNumber(row.AB));
}

function updateDarrenPitchingAggregate(target, row) {
  const innings = toDarrenNumber(row.IP);
  const earnedRuns = toDarrenNumber(row.ER);
  const hits = toDarrenNumber(row.H);
  const walks = toDarrenNumber(row.BB);
  target.W += toDarrenNumber(row.W);
  target.L += toDarrenNumber(row.L);
  target.SV += toDarrenNumber(row.SV);
  target.IP += innings;
  target.SO += toDarrenNumber(row.SO);
  target.WAR += toDarrenNumber(row.WAR);
  target.G += toDarrenNumber(row.G);
  target.GS += toDarrenNumber(row.GS);
  target.CG += toDarrenNumber(row.CG);
  target.SHO += toDarrenNumber(row.SHO);
  target.ERA_ER += earnedRuns;
  target.ERA_IP += innings;
  target.WHIP_BASE += hits + walks;
  target.WHIP_IP += innings;
}

function finalizeDarrenBattingAggregate(target) {
  return {
    ...target,
    OPS: target.OPS_AB ? target.OPS / target.OPS_AB : 0,
    OPSPLUS: target.OPSPLUS_AB ? target.OPSPLUS / target.OPSPLUS_AB : 0,
    AVG: target.AB ? target.H / target.AB : 0,
  };
}

function finalizeDarrenPitchingAggregate(target) {
  return {
    ...target,
    ERA: target.ERA_IP ? (target.ERA_ER * 9) / target.ERA_IP : 0,
    WHIP: target.WHIP_IP ? target.WHIP_BASE / target.WHIP_IP : 0,
  };
}

function updateDarrenFieldingAggregate(target, row) {
  const games = toDarrenNumber(row.G);
  const errors = toDarrenNumber(row.E);
  const zr = toSignedDarrenNumber(row.ZR);
  const eff = toDarrenRate(row.EFF);

  target.G += games;
  target.E += errors;
  if (Number.isFinite(zr)) {
    target.ZR_TOTAL += zr * Math.max(1, games);
    target.ZR_G += Math.max(1, games);
  }
  if (Number.isFinite(eff) && eff > 0) {
    target.EFF_TOTAL += eff * Math.max(1, games);
    target.EFF_G += Math.max(1, games);
  }
}

function finalizeDarrenFieldingAggregate(target) {
  return {
    ...target,
    ZR: target.ZR_G ? target.ZR_TOTAL / target.ZR_G : Number.NaN,
    EFF: target.EFF_G ? target.EFF_TOTAL / target.EFF_G : Number.NaN,
    ERRORS_PER_GAME: target.G ? target.E / target.G : Number.NaN,
  };
}

function toDarrenNumber(value) {
  const text = cleanColumnText(value);
  if (!text) {
    return 0;
  }
  return Number.parseFloat(text) || 0;
}

function toDarrenRate(value) {
  const text = cleanColumnText(value);
  if (!text) {
    return 0;
  }
  const normalized = text.startsWith(".") ? `0${text}` : text;
  return Number.parseFloat(normalized) || 0;
}

function toSignedDarrenNumber(value) {
  const text = cleanColumnText(value);
  if (!text) {
    return Number.NaN;
  }
  const normalized = text.startsWith(".") || text.startsWith("-.") || text.startsWith("+.")
    ? text.replace(/^([+-]?)\./, "$10.")
    : text;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function extractDarrenFieldingAggregates(rawHtml) {
  const rows = [...String(rawHtml ?? "").matchAll(/<tr>\s*<td class="dl"><a href="\.\.\/history\/team_year_\d+_(\d{4})\.html">([^<]+)<\/a><\/td>\s*<td class="dc">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>/gi)]
    .map((match) => ({
      year: Number.parseInt(cleanColumnText(match[1]), 10),
      teamLeague: cleanColumnText(match[2]),
      pos: cleanColumnText(match[3]),
      G: cleanColumnText(match[4]),
      E: cleanColumnText(match[10]),
      ZR: cleanColumnText(match[13]),
      EFF: cleanColumnText(match[14]),
    }))
    .filter((row) => Number.isFinite(row.year) && /-\s*MLB$/i.test(row.teamLeague) && row.pos && !/^P$/i.test(row.pos));

  const all = initDarrenFieldingAggregate();
  const recent = initDarrenFieldingAggregate();
  const current = initDarrenFieldingAggregate();
  const maxYear = rows.reduce((max, row) => Math.max(max, row.year), 0);

  for (const row of rows) {
    updateDarrenFieldingAggregate(all, row);
    if (maxYear && row.year >= maxYear - 4) {
      updateDarrenFieldingAggregate(recent, row);
    }
    if (maxYear && row.year === maxYear) {
      updateDarrenFieldingAggregate(current, row);
    }
  }

  return { all, recent, current };
}

function buildDarrenRankingCategories(pool) {
  const categories = [];
  const scopes = ["history", "active", "recent"];
  const focuses = ["best", "offense", "defense"];

  for (const scope of scopes) {
    for (const focus of focuses) {
      const scoped = buildDarrenScopedPool(pool, scope, focus);
      if (scoped.length < 3) {
        continue;
      }

      const positionValues = [...new Set(scoped.map((player) => player.pos).filter(Boolean))]
        .filter((position) => scoped.filter((player) => player.pos === position).length >= 3);
      const ageBands = ["under-25", "under-30", "over-30", "over-35"]
        .filter((band) => scoped.filter((player) => darrenAgeBandMatches(player.age, band)).length >= 3);
      const nationalities = [...new Set(scoped.map((player) => player.nationality).filter(Boolean))]
        .filter((nationality) => scoped.filter((player) => player.nationality === nationality).length >= 3)
        .sort((left, right) => scoped.filter((player) => player.nationality === right).length - scoped.filter((player) => player.nationality === left).length)
        .slice(0, 10);

      const criterionOptions = [];
      for (const position of positionValues) {
        criterionOptions.push([{ type: "position", value: position }]);
      }
      for (const ageBand of ageBands) {
        criterionOptions.push([{ type: "age", value: ageBand }]);
      }
      for (const nationality of nationalities) {
        criterionOptions.push([{ type: "nationality", value: nationality }]);
      }
      for (const position of positionValues) {
        for (const ageBand of ageBands) {
          criterionOptions.push([{ type: "position", value: position }, { type: "age", value: ageBand }]);
        }
      }
      for (const position of positionValues) {
        for (const nationality of nationalities) {
          criterionOptions.push([{ type: "position", value: position }, { type: "nationality", value: nationality }]);
        }
      }
      for (const ageBand of ageBands) {
        for (const nationality of nationalities) {
          criterionOptions.push([{ type: "age", value: ageBand }, { type: "nationality", value: nationality }]);
        }
      }
      for (const position of positionValues) {
        for (const ageBand of ageBands) {
          for (const nationality of nationalities) {
            criterionOptions.push([{ type: "position", value: position }, { type: "age", value: ageBand }, { type: "nationality", value: nationality }]);
          }
        }
      }

      for (const criteria of criterionOptions) {
        if (scope !== "active" && criteria.some((criterion) => criterion.type === "age")) {
          continue;
        }

        const candidates = scoped
          .filter((player) => criteria.every((criterion) => darrenCriterionMatches(player, criterion)))
          .map((player) => ({
            ...player,
            score: scoreDarrenRankingPlayer(player, scope, focus),
          }))
          .filter((player) => Number.isFinite(player.score))
          .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

        if (candidates.length < 3) {
          continue;
        }

        categories.push({
          scope,
          focus,
          criteria,
          players: candidates,
          key: `${scope}:${focus}:${criteria.map((criterion) => `${criterion.type}:${criterion.value}`).join("|")}`,
        });
      }
    }
  }

  return categories.sort((left, right) => left.key.localeCompare(right.key));
}

function buildDarrenScopedPool(pool, scope, focus) {
  return pool.filter((player) => {
    const isPitcher = /^(SP|RP|CL|P)$/i.test(player.pos);
    const battingStats = buildDarrenStatSet(player, scope, "batting");
    const pitchingStats = buildDarrenStatSet(player, scope, "pitching");
    const fieldingStats = buildDarrenStatSet(player, scope, "fielding");
    if (scope === "active" && !player.active) {
      return false;
    }

    if (focus === "offense") {
      return !isPitcher && battingStats.AB >= 50;
    }

    if (focus === "defense") {
      if (isPitcher) {
        return pitchingStats.IP >= 20;
      }
      return player.defensiveAwards > 0 || fieldingStats.G >= 20 || /^(C|SS|2B|3B|CF)$/i.test(player.pos);
    }

    return Math.max(isPitcher ? pitchingStats.WAR : battingStats.WAR, 0) > 0 || player.defensiveAwards > 0 || fieldingStats.G >= 20;
  });
}

function buildDarrenStatSet(player, scope, mode) {
  if (mode === "pitching") {
    if (scope === "history") {
      return finalizeDarrenPitchingAggregate(player.allPitching);
    }
    if (scope === "recent") {
      return finalizeDarrenPitchingAggregate(player.recentPitching);
    }
    return finalizeDarrenPitchingAggregate(player.allPitching);
  }

  if (mode === "fielding") {
    if (scope === "history") {
      return finalizeDarrenFieldingAggregate(player.allFielding ?? initDarrenFieldingAggregate());
    }
    if (scope === "recent") {
      return finalizeDarrenFieldingAggregate(player.recentFielding ?? initDarrenFieldingAggregate());
    }
    return finalizeDarrenFieldingAggregate(player.allFielding ?? initDarrenFieldingAggregate());
  }

  if (scope === "history") {
    return finalizeDarrenBattingAggregate(player.allBatting);
  }
  if (scope === "recent") {
    return finalizeDarrenBattingAggregate(player.recentBatting);
  }
  return finalizeDarrenBattingAggregate(player.allBatting);
}

function darrenCriterionMatches(player, criterion) {
  if (criterion.type === "position") {
    return player.pos === criterion.value;
  }
  if (criterion.type === "age") {
    return darrenAgeBandMatches(player.age, criterion.value);
  }
  if (criterion.type === "nationality") {
    return player.nationality === criterion.value;
  }
  return true;
}

function darrenAgeBandMatches(age, band) {
  if (!Number.isFinite(age)) {
    return false;
  }
  if (band === "under-25") {
    return age < 25;
  }
  if (band === "under-30") {
    return age < 30;
  }
  if (band === "over-30") {
    return age > 30;
  }
  if (band === "over-35") {
    return age > 35;
  }
  return false;
}

function scoreDarrenRankingPlayer(player, scope, focus) {
  const isPitcher = /^(SP|RP|CL|P)$/i.test(player.pos);
  const batting = buildDarrenStatSet(player, scope, "batting");
  const pitching = buildDarrenStatSet(player, scope, "pitching");
  const fielding = buildDarrenStatSet(player, scope, "fielding");
  const history = player.playerHistory ?? {};
  const accoladeBonus = (toDarrenNumber(history.mvps) * 20) + (toDarrenNumber(history.championships) * 8);
  const battingWar = Math.max(batting.WAR, 0);
  const pitchingWar = Math.max(pitching.WAR, 0);
  const fieldingErrorBonus = Number.isFinite(fielding.ERRORS_PER_GAME) ? Math.max(0, 0.12 - fielding.ERRORS_PER_GAME) * 220 : 0;
  const fieldingZrBonus = Number.isFinite(fielding.ZR) ? Math.max(fielding.ZR, 0) * 32 : 0;
  const fieldingEffBonus = Number.isFinite(fielding.EFF) ? Math.max(0, fielding.EFF - 0.980) * 900 : 0;

  if (focus === "offense") {
    return (battingWar * 30) + (batting.OPSPLUS * 0.8) + (batting.HR * 1.5) + (batting.RBI * 0.35) + (batting.SB * 0.25) + accoladeBonus;
  }

  if (focus === "defense") {
    if (isPitcher) {
      const closerBonus = /^CL$/i.test(player.pos) ? (pitching.SV * 1.8) : (pitching.W * 1.5);
      return (pitchingWar * 32) + (pitching.SO * 0.15) + closerBonus + (pitching.IP * 0.04) + ((6 - pitching.ERA) * 18) + ((2 - pitching.WHIP) * 26) + accoladeBonus;
    }
    const positionBonus = /^(SS|C|CF)$/i.test(player.pos) ? 18 : /^(2B|3B)$/i.test(player.pos) ? 12 : 6;
    return (player.defensiveAwards * 95) + (battingWar * 3) + fieldingZrBonus + fieldingEffBonus + fieldingErrorBonus + positionBonus + accoladeBonus;
  }

  if (isPitcher) {
    const closerBonus = /^CL$/i.test(player.pos) ? (pitching.SV * 1.5) : (pitching.W * 1.2);
    return (pitchingWar * 30) + closerBonus + (pitching.SO * 0.12) + ((6 - pitching.ERA) * 16) + ((2 - pitching.WHIP) * 24) + accoladeBonus;
  }

  return (battingWar * 28) + (batting.OPSPLUS * 0.7) + (batting.HR * 1.2) + (batting.H * 0.08) + (batting.RBI * 0.25) + accoladeBonus;
}

function buildDarrenRankingHeadline(category) {
  return `My Top 3 ${buildDarrenRankingDescriptor(category)}`;
}

function buildDarrenRankingDescriptor(category) {
  const scopeText = category.scope === "history" ? "in ABA history" : category.scope === "recent" ? "from the last five ABA seasons" : "among active ABA players";
  const focusText = category.focus === "offense" ? "offensive" : category.focus === "defense" ? "defensive" : "";
  const nationalityText = category.criteria
    .filter((criterion) => criterion.type === "nationality")
    .map((criterion) => criterion.value)
    .join(" ");
  const positionText = category.criteria
    .filter((criterion) => criterion.type === "position")
    .map((criterion) => buildDarrenRankingPositionPlural(criterion.value))
    .join(" ");
  const ageText = category.criteria
    .filter((criterion) => criterion.type === "age")
    .map((criterion) => (
      criterion.value === "under-25"
        ? "younger than 25"
        : criterion.value === "under-30"
          ? "younger than 30"
          : criterion.value === "over-30"
            ? "older than 30"
            : "older than 35"
    ))
    .join(" ");
  return `${nationalityText} ${focusText} ${positionText} ${ageText} ${scopeText}`.replace(/\s+/g, " ").trim();
}

function buildDarrenRankingPositionPlural(position) {
  const map = {
    SP: "starting pitchers",
    RP: "relief pitchers",
    CL: "closers",
    P: "pitchers",
    C: "catchers",
    "1B": "first basemen",
    "2B": "second basemen",
    "3B": "third basemen",
    SS: "shortstops",
    LF: "left fielders",
    CF: "center fielders",
    RF: "right fielders",
    DH: "designated hitters",
  };
  return map[position] ?? String(position ?? "").toLowerCase();
}

function buildDarrenRankingIntro(category, ranked) {
  const bestPlayer = ranked[0];
  const scopeLine = category.scope === "history"
    ? "Today I wanted the broad lens."
    : category.scope === "recent"
      ? "Today I wanted a shorter window."
      : "Today I wanted the active board."
  const focusLine = category.focus === "offense"
    ? "This is an offensive list, so I weighted production and force."
    : category.focus === "defense"
      ? "This is a defensive list, so I leaned toward run prevention, premium spots, and glove evidence."
      : "This is an overall list, so I wanted the players whose full body of work carries the most weight."
  return `${scopeLine} ${focusLine} The category landed on ${buildDarrenRankingDescriptor(category)}, and the best name in the group turned out to be ${bestPlayer.name}, which is why I am making you wait until the end for him.`;
}

function buildDarrenRankingPlayerLine(player, category) {
  const isPitcher = /^(SP|RP|CL|P)$/i.test(player.pos);
  const stats = buildDarrenStatSet(player, category.scope, isPitcher ? "pitching" : "batting");
  const fielding = buildDarrenStatSet(player, category.scope, "fielding");
  const yearsLabel = category.scope === "history"
    ? "across the full league history sample"
    : category.scope === "recent"
      ? "across the last five seasons"
      : "across the full career line";
  const contextBits = [
    player.primaryTeam ? `for ${expandTeamLabel(player.primaryTeam) || player.primaryTeam}` : "",
    player.nationality || "",
    Number.isFinite(player.age) ? `age ${player.age}` : "",
    category.scope === "history" && Number.isFinite(player.seasonsPlayed) && player.seasonsPlayed > 0
      ? `${player.seasonsPlayed} season${player.seasonsPlayed === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);

  if (category.focus === "offense") {
    const statBits = [
      `${formatDarrenRate(stats.OPS)} OPS`,
      stats.OPSPLUS > 0 ? `${Math.round(stats.OPSPLUS)} OPS+` : "",
      `${Math.round(stats.HR)} home runs`,
      `${Math.round(stats.RBI)} RBI`,
      stats.WAR > 0 ? `${formatDarrenOneDecimal(stats.WAR)} WAR` : "",
    ].filter(Boolean);
    return `${contextBits.join(" | ")}. ${player.name} makes the list ${yearsLabel} because the line stacks up: ${joinWithCommasAndAnd(statBits)}.`;
  }

  if (category.focus === "defense") {
    if (isPitcher) {
      const statBits = [
        /^CL$/i.test(player.pos) ? `${Math.round(stats.SV)} saves` : `${Math.round(stats.W)} wins`,
        `${formatDarrenTwoDecimals(stats.ERA)} ERA`,
        `${formatDarrenTwoDecimals(stats.WHIP)} WHIP`,
        `${Math.round(stats.SO)} strikeouts`,
        `${formatDarrenInnings(stats.IP)} innings`,
        stats.WAR > 0 ? `${formatDarrenOneDecimal(stats.WAR)} WAR` : "",
      ];
      return `${contextBits.join(" | ")}. ${player.name} gets in ${yearsLabel} on run prevention more than shine: ${joinWithCommasAndAnd(statBits.filter(Boolean))}.`;
    }
    const statBits = [
      player.defensiveAwards > 0 ? `${player.defensiveAwards} major glove award${player.defensiveAwards === 1 ? "" : "s"}` : "",
      Number.isFinite(fielding.ZR) ? `${formatDarrenOneDecimal(fielding.ZR)} ZR` : "",
      Number.isFinite(fielding.EFF) ? `${formatDarrenRate(fielding.EFF)} EFF` : "",
      Number.isFinite(fielding.G) && fielding.G > 0 && Number.isFinite(fielding.E) ? `${Math.round(fielding.E)} errors in ${Math.round(fielding.G)} games` : "",
      stats.WAR > 0 ? `${formatDarrenOneDecimal(stats.WAR)} WAR` : "",
    ].filter(Boolean);
    return `${contextBits.join(" | ")}. ${player.name} makes a defensive case ${yearsLabel} with ${joinWithCommasAndAnd(statBits)}, and the extra burden of a premium spot at ${player.pos}.`;
  }

  if (isPitcher) {
    const statBits = [
      /^CL$/i.test(player.pos) ? `${Math.round(stats.SV)} saves` : `${Math.round(stats.W)} wins`,
      `${formatDarrenTwoDecimals(stats.ERA)} ERA`,
      `${formatDarrenTwoDecimals(stats.WHIP)} WHIP`,
      `${Math.round(stats.SO)} strikeouts`,
      stats.WAR > 0 ? `${formatDarrenOneDecimal(stats.WAR)} WAR` : "",
    ].filter(Boolean);
    return `${contextBits.join(" | ")}. ${player.name} belongs on an overall list ${yearsLabel} because the package is complete: ${joinWithCommasAndAnd(statBits)}.`;
  }

  const statBits = [
    `${formatDarrenRate(stats.OPS)} OPS`,
    `${Math.round(stats.H)} hits`,
    `${Math.round(stats.HR)} home runs`,
    `${Math.round(stats.RBI)} RBI`,
    stats.WAR > 0 ? `${formatDarrenOneDecimal(stats.WAR)} WAR` : "",
  ].filter(Boolean);
  return `${contextBits.join(" | ")}. ${player.name} earns his spot ${yearsLabel} with a mix that travels: ${joinWithCommasAndAnd(statBits)}.`;
}

function formatDarrenRate(value) {
  return Number.isFinite(value) ? value.toFixed(3).replace(/^0/, "") : "";
}

function formatDarrenTwoDecimals(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function formatDarrenOneDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "";
}

function formatDarrenInnings(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "";
}

function findGameContextForStar(snapshot, star) {
  const targetName = normalizeColumnName(star?.player);
  for (const game of snapshot?.lastDayScores ?? []) {
    const hitter = (game.standoutPerformers ?? []).find((entry) => normalizeColumnName(entry.player) === targetName);
    if (hitter) {
      return { game, performer: hitter, role: "hitter" };
    }

    const pitcher = (game.standoutPitchers ?? []).find((entry) => normalizeColumnName(entry.player) === targetName);
    if (pitcher) {
      return { game, performer: pitcher, role: "pitcher" };
    }
  }

  return { game: null, performer: null, role: star?.role === "pitcher" ? "pitcher" : "hitter" };
}

function resolveDarrenStarPlayer(snapshot, star, gameContext) {
  const players = loadDarrenLeaguePlayers(snapshot);
  const targetName = normalizeColumnName(star?.player);
  const targetTeam = normalizeColumnName(star?.team || gameContext?.performer?.team || "");
  const performerId = cleanColumnText(gameContext?.performer?.playerId ?? "");

  return (
    players.find((player) => performerId && String(player.playerId) === performerId) ??
    players.find((player) => normalizeColumnName(player.name) === targetName && normalizeColumnName(player.team) === targetTeam) ??
    players.find((player) => normalizeColumnName(player.name) === targetName) ??
    buildFallbackDarrenPlayer(star, gameContext)
  );
}

function buildFallbackDarrenPlayer(star, gameContext) {
  const performerId = cleanColumnText(gameContext?.performer?.playerId ?? "");
  if (!performerId) {
    return null;
  }

  const playerPath = path.resolve(process.cwd(), "News", "players", `player_${performerId}.html`);
  return {
    playerId: performerId,
    name: buildPlainPlayerName(star?.player || ""),
    pos: "",
    team: cleanColumnText(star?.team ?? gameContext?.performer?.team ?? ""),
    age: "",
    nationality: "",
    bats: "",
    throws: "",
    playerPagePath: playerPath,
  };
}

function buildDarrenTopPlayerPositionLabel(position, role) {
  const labeledPosition = buildDarrenPositionLabel(position);
  if (labeledPosition && labeledPosition !== "player") {
    return labeledPosition;
  }
  return role === "pitcher" ? "pitcher" : "position player";
}

function buildDarrenTopPlayerHeadline(displayName, role, shapeIndex, gameContext, star, standingsTeam, playerTeam = "") {
  const teamLabel = normalizeColumnTeamDisplay(
    cleanColumnText(
      playerTeam ||
      expandTeamLabel(star?.team ?? "") ||
      expandTeamLabel(gameContext?.performer?.team ?? "") ||
      "",
    ),
  );
  const gb = standingsTeam?.gb ?? standingsTeam?.GB ?? "";
  const chaseTag = gb && gb !== "-" ? "in a race that keeps tightening" : "with a season that keeps getting louder";
  const options = role === "pitcher"
    ? [
        `${displayName} Was the Night's Sharpest Arm`,
        `What ${displayName} Just Did Matters`,
        `${displayName} and the Shape of an Ace's Night`,
        `${displayName} Made the Season Look Smaller for One Evening`,
      ]
    : [
        `${displayName} Had the Loudest Bat in the League`,
        `Why ${displayName}'s Night Was Bigger Than the Box Score`,
        `${displayName} Turned One Game Into a Statement`,
        `${displayName} Is Giving ${teamLabel || "His Club"} a Different Kind of Summer`,
        `${displayName} and the Art of a Full Night's Damage`,
      ];
  const base = options[shapeIndex % options.length] ?? options[0];
  return `Darren Kline: ${base}${shapeIndex === options.length - 1 && teamLabel ? ` ${chaseTag}` : ""}`;
}

function buildDarrenTopPlayerBody(context) {
  const {
    displayName,
    playerTeam,
    positionLabel,
    specialLine,
    seasonLine,
    comparisonLine,
    careerLine,
    whyItMattersLine,
    role,
    shapeIndex,
  } = context;

  const intro = `${displayName}, the ${positionLabel} for ${playerTeam}, is where I want to begin this morning. ${specialLine}`;
  const identityLead = `${displayName}, the ${positionLabel} for ${playerTeam}, `;
  const seasonParagraph = [seasonLine, comparisonLine, whyItMattersLine].filter(Boolean).join(" ");
  const careerParagraph = careerLine;
  const closer = role === "pitcher"
    ? `${displayName} did not just stack clean innings. He changed the emotional temperature of the night, and those are usually the starts that echo past one box score.`
    : `${displayName} did not just pile up a handsome line. He bent the game around him, and those are the nights that make a season feel more deliberate than accidental.`;

  const shapes = [
    [intro, seasonParagraph, careerParagraph || closer].filter(Boolean),
    [`${identityLead}${specialLine} That is the headline, but it is not the whole story.`, `${displayName} is not floating through the season on one bright evening. ${seasonParagraph}`, careerParagraph || closer],
    [`${identityLead}had a huge night, but the more useful question is why it fit so neatly with the rest of his year. ${specialLine}`, seasonParagraph, careerParagraph || closer],
    [`${identityLead}did not arrive here by accident. ${specialLine}`, careerParagraph || seasonParagraph, seasonParagraph ? `${seasonParagraph} ${closer}`.trim() : closer],
    [`${identityLead}made the whole scoreboard look a little slanted. ${specialLine}`, `${seasonParagraph} ${careerParagraph}`.trim(), closer],
  ];

  const paragraphs = shapes[shapeIndex % shapes.length]?.filter(Boolean) ?? [];
  return paragraphs.join("\n\n");
}

function buildDarrenTopPlayerSpecialLine(displayName, role, gameContext, detailLine, star) {
  const game = gameContext?.game;
  const performer = gameContext?.performer;
  const gameSummary = game ? `${game.awayTeam} ${game.awayRuns}, ${game.homeTeam} ${game.homeRuns}` : cleanColumnText(star?.gameSummary ?? "");
  const playerPlays = (game?.notablePlays ?? []).filter((play) => normalizeColumnName(play.player) === normalizeColumnName(displayName));
  const quotedPlay = playerPlays[0]?.text ? ` The best moment may have been when he ${playerPlays[0].text}.` : "";

  if (role === "pitcher") {
    const winText = performer?.decision === "W" ? " and got the win" : performer?.decision === "SV" ? " and closed it out" : "";
    return `${displayName} was the top player of the day in ${gameSummary || "the latest slate"}, working through ${detailLine || "a standout pitching line"}${winText}.${quotedPlay}`.trim();
  }

  const homerNote = Number(performer?.homeRuns ?? 0) > 0 ? ` The home-run swing was part of it, but not all of it.` : "";
  return `${displayName} was the top player of the day in ${gameSummary || "the latest slate"}, finishing with ${detailLine || "a damaging offensive night"}.${quotedPlay}${homerNote}`.trim();
}

function buildDarrenSeasonProgressLine(role, line, standingsTeam, playerTeam, displayName) {
  const teamTrend = classifyDarrenTeamTrend(standingsTeam);
  if (role === "pitcher") {
    const wins = cleanColumnText(line.W ?? "");
    const losses = cleanColumnText(line.L ?? "");
    const era = cleanColumnText(line.ERA ?? "");
    const innings = cleanColumnText(line.IP ?? "");
    const strikeouts = cleanColumnText(line.K ?? "");
    const whip = cleanColumnText(line.WHIP ?? "");
    const seasonPieces = [
      wins || losses ? `${wins || "0"}-${losses || "0"}` : "",
      era ? `${era} ERA` : "",
      innings ? `${innings} innings` : "",
      strikeouts ? `${strikeouts} strikeouts` : "",
      whip ? `${whip} WHIP` : "",
    ].filter(Boolean);

    if (teamTrend === "good") {
      return `${displayName}'s year fits neatly into a club that has been doing real damage in the standings. ${seasonPieces.length ? `The current line sits at ${joinWithCommasAndAnd(seasonPieces)}.` : "The current line backs up the eye test."}`;
    }

    return `${displayName}'s season deserves to stand on its own first. ${seasonPieces.length ? `Right now the line reads ${joinWithCommasAndAnd(seasonPieces)}.` : "The current line backs up the eye test."}`;
  }

  const avg = cleanColumnText(line.AVG ?? "");
  const obp = cleanColumnText(line.OBP ?? "");
  const slg = cleanColumnText(line.SLG ?? "");
  const hr = cleanColumnText(line.HR ?? "");
  const rbi = cleanColumnText(line.RBI ?? "");
  const sb = cleanColumnText(line.SB ?? "");
  const war = cleanColumnText(line.WAR ?? "");
  const seasonPieces = [
    avg ? `${avg} average` : "",
    obp ? `${obp} OBP` : "",
    slg ? `${slg} SLG` : "",
    hr ? `${hr} home runs` : "",
    rbi ? `${rbi} RBI` : "",
    sb ? `${sb} steals` : "",
    war ? `${war} WAR` : "",
  ].filter(Boolean);

  if (teamTrend === "good") {
    return `${displayName}'s season is part of why ${playerTeam} feel dangerous right now. ${seasonPieces.length ? `Right now he is carrying ${joinWithCommasAndAnd(seasonPieces)}.` : "The season line is strong enough that the night fits the larger picture."}`;
  }

  return `${displayName}'s season is worth isolating from the standings for a minute. ${seasonPieces.length ? `Right now he is carrying ${joinWithCommasAndAnd(seasonPieces)}.` : "The season line is strong enough that the night fits the larger picture."}`;
}

function buildDarrenWhyItMattersLine(displayName, playerTeam, standingsTeam, role, line) {
  const trend = classifyDarrenTeamTrend(standingsTeam);
  const gb = cleanColumnText(standingsTeam?.gb ?? standingsTeam?.GB ?? "");
  const division = cleanColumnText(standingsTeam?.sectionLabel ?? standingsTeam?.section ?? "");

  if (role === "pitcher") {
    if (trend === "good") {
      return `${playerTeam} can actually cash in a night like this because ${division ? `${division.toLowerCase()} is staying tight` : "the race is not forgiving"}${gb && gb !== "-" ? ` and they are only ${gb} back` : ""}.`;
    }

    return `For ${playerTeam}, a night like this matters less as proof of the standings and more as proof that the arm talent is real enough to build around.`;
  }

  const ops = buildOps(line);
  if (trend === "good") {
    return `${playerTeam} do not get a night like this by accident. ${displayName} is one of the lineup pieces that changes the geometry of a series${ops ? `, especially when the OPS is living around ${ops}` : ""}.`;
  }

  return `On a club that has had a harder time getting traction, a night like this feels more like a signal flare. ${displayName} gave ${playerTeam} a reminder that there is real middle-of-the-order force here${ops ? `, especially with the OPS living around ${ops}` : ""}.`;
}

function buildDarrenCareerHistoryLine(displayName, playerHistory, recordHits, leaderboardEntries, profile, currentTeam = "") {
  const details = [];
  const normalizedCurrentTeam = normalizeColumnName(currentTeam);

  if (playerHistory?.mvps) {
    details.push(`${playerHistory.mvps} MVP${playerHistory.mvps === 1 ? "" : "s"} on the shelf`);
  }
  if (playerHistory?.championships) {
    details.push(`${playerHistory.championships} championship${playerHistory.championships === 1 ? "" : "s"} in the past`);
  }
  if (profile?.awardsSummary) {
    details.push(profile.awardsSummary);
  }
  if (
    profile?.contractContext?.latestExtension?.summary &&
    (!normalizedCurrentTeam || normalizeColumnName(profile.contractContext.latestExtension.team ?? "") === normalizedCurrentTeam)
  ) {
    details.push(profile.contractContext.latestExtension.summary);
  } else if (profile?.contractContext?.isUpcomingFreeAgent) {
    details.push("free agency coming after the season");
  }
  if (profile?.draftContext?.isFirstOverall) {
    details.push(`the weight of being the first overall pick in ${profile.draftContext.year || "his draft year"}`);
  } else if (profile?.acquisitionSummary) {
    details.push(profile.acquisitionSummary);
  }
  if (recordHits?.length) {
    const bestRecord = recordHits[0];
    const recordCategory = cleanColumnText(bestRecord.category ?? bestRecord.stat ?? "");
    if (recordCategory) {
      details.push(`${recordCategory.toLowerCase()} history attached to his name`);
    }
  } else if (leaderboardEntries?.length) {
    const bestEntry = leaderboardEntries.find((entry) => isPositiveDarrenHistoryCategory(entry.category ?? entry.stat ?? "")) ?? null;
    const leaderboardStat = bestEntry ? cleanColumnText(bestEntry.category ?? bestEntry.stat ?? "") : "";
    if (leaderboardStat) {
      details.push(`a place on the league's history board in ${leaderboardStat.toLowerCase()}`);
    }
  }
  if (playerHistory?.notes) {
    details.push(playerHistory.notes);
  }

  if (!details.length) {
    return `${displayName} may not need a giant plaque to make this kind of night meaningful. Some players write their case a little at a time, and this was one of those entries.`;
  }

  const trimmed = uniqueColumnDetails(details)
    .filter((detail) => {
      const normalizedDetail = normalizeColumnName(detail);
      if (!/\bdeal\b/.test(normalizedDetail)) {
        return true;
      }
      if (!normalizedCurrentTeam) {
        return true;
      }
      return normalizedDetail.includes(normalizedCurrentTeam);
    })
    .slice(0, 3);
  return `${displayName}'s career gives the night a lot more shape than one box score can hold: ${joinWithCommasAndAnd(trimmed)}.`;
}

function isPositiveDarrenHistoryCategory(label) {
  const text = cleanColumnText(label).toLowerCase();
  if (!text) {
    return false;
  }

  if (/passed balls|errors|losses|caught stealing|double plays grounded into|gidp|strikeouts|shutouts against|blown saves|home runs allowed|hits allowed|walks allowed|bases on balls allowed|opponents|wild pitches/.test(text)) {
    return false;
  }

  return /war|ops|obp|slugging|batting average|avg|home runs|hits|doubles|triples|runs batted in|rbi|stolen bases|walks|wins|saves|strikeouts pitched|era|whip|winning percentage/.test(text);
}

function buildDarrenCareerComparisonLine(role, profile) {
  const careerSeasons = profile?.careerSeasons ?? {};
  const currentSeason = careerSeasons.currentSeason;
  const previousSeason = careerSeasons.previousSeason;
  const careerTotal = careerSeasons.careerTotal;

  if (!currentSeason) {
    return "";
  }

  if (role === "pitcher") {
    const currentEra = parseColumnNumber(currentSeason.ERA);
    const lastEra = parseColumnNumber(previousSeason?.ERA);
    const careerEra = parseColumnNumber(careerTotal?.ERA);
    const currentWhip = parseColumnNumber(currentSeason.WHIP);
    const lastWhip = parseColumnNumber(previousSeason?.WHIP);
    const currentWar = parseColumnNumber(currentSeason.WAR);
    const lastWar = parseColumnNumber(previousSeason?.WAR);

    const details = [];

    if (Number.isFinite(currentEra) && Number.isFinite(lastEra)) {
      if (currentEra < lastEra - 0.2) {
        details.push(`The ERA is down from ${formatColumnMetric(lastEra, 2)} last year to ${formatColumnMetric(currentEra, 2)} now`);
      } else if (currentEra > lastEra + 0.2) {
        details.push(`The ERA is a little heavier than last year, moving from ${formatColumnMetric(lastEra, 2)} to ${formatColumnMetric(currentEra, 2)}`);
      }
    }
    if (Number.isFinite(currentWhip) && Number.isFinite(lastWhip) && currentWhip < lastWhip - 0.03) {
      details.push(`the WHIP is cleaner too, from ${formatColumnMetric(lastWhip, 2)} to ${formatColumnMetric(currentWhip, 2)}`);
    }
    if (Number.isFinite(currentEra) && Number.isFinite(careerEra) && currentEra < careerEra - 0.15) {
      details.push(`it also sits better than his ${formatColumnMetric(careerEra, 2)} ABA career ERA`);
    } else if (Number.isFinite(currentWar) && Number.isFinite(lastWar) && currentWar > lastWar + 0.2) {
      details.push(`and the value line is already ahead of last year, moving from ${formatColumnMetric(lastWar, 1)} WAR to ${formatColumnMetric(currentWar, 1)}`);
    }

    if (!details.length) {
      return "";
    }
    return `${joinWithCommasAndAnd(details)}.`;
  }

  const currentAvg = parseColumnRate(currentSeason.AVG);
  const lastAvg = parseColumnRate(previousSeason?.AVG);
  const currentOps = parseColumnRate(currentSeason.OPS);
  const lastOps = parseColumnRate(previousSeason?.OPS);
  const careerOps = parseColumnRate(careerTotal?.OPS);
  const currentOpsPlus = parseColumnNumber(currentSeason.OPS_PLUS);
  const lastOpsPlus = parseColumnNumber(previousSeason?.OPS_PLUS);
  const currentObp = parseColumnRate(currentSeason.OBP);
  const lastObp = parseColumnRate(previousSeason?.OBP);

  const details = [];

  if (Number.isFinite(currentOps) && Number.isFinite(lastOps)) {
    if (currentOps > lastOps + 0.04) {
      details.push(`The OPS has climbed from ${formatColumnRate(lastOps)} last year to ${formatColumnRate(currentOps)} now`);
    } else if (currentOps < lastOps - 0.04) {
      details.push(`The OPS is lighter than last year's ${formatColumnRate(lastOps)}, sitting at ${formatColumnRate(currentOps)} right now`);
    }
  }
  if (Number.isFinite(currentAvg) && Number.isFinite(lastAvg) && currentAvg > lastAvg + 0.01) {
    details.push(`the average is up from ${formatColumnRate(lastAvg)} to ${formatColumnRate(currentAvg)}`);
  }
  if (Number.isFinite(currentObp) && Number.isFinite(lastObp) && currentObp > lastObp + 0.015) {
    details.push(`and the on-base work has improved from ${formatColumnRate(lastObp)} to ${formatColumnRate(currentObp)}`);
  }
  if (Number.isFinite(currentOps) && Number.isFinite(careerOps) && currentOps > careerOps + 0.03) {
    details.push(`which is better than his ${formatColumnRate(careerOps)} ABA career OPS`);
  } else if (Number.isFinite(currentOpsPlus) && Number.isFinite(lastOpsPlus) && currentOpsPlus > lastOpsPlus + 5) {
    details.push(`and he has already pushed past last year's ${formatColumnMetric(lastOpsPlus, 0)} OPS+ with ${formatColumnMetric(currentOpsPlus, 0)}`);
  }

  if (!details.length) {
    return "";
  }
  return `${joinWithCommasAndAnd(details)}.`;
}

function uniqueColumnDetails(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeColumnName(value);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildDarrenStandingsFragment(standing, teamName) {
  if (!standing) {
    return `${teamName} are trying to build a cleaner summer`;
  }

  const wins = cleanColumnText(standing.wins ?? standing.W ?? "");
  const losses = cleanColumnText(standing.losses ?? standing.L ?? "");
  const gb = cleanColumnText(standing.gb ?? standing.GB ?? "");
  const section = cleanColumnText(standing.sectionLabel ?? standing.section ?? "");
  const place = cleanColumnText(standing.place ?? "");
  const parts = [];

  if (wins || losses) {
    parts.push(`${teamName} sit at ${wins || "0"}-${losses || "0"}`);
  } else {
    parts.push(teamName);
  }
  if (place) {
    parts.push(place.toLowerCase());
  } else if (section) {
    parts.push(section.toLowerCase());
  }
  if (gb && gb !== "-") {
    parts.push(`${gb} back`);
  }

  return parts.join(" ");
}

function joinWithCommasAndAnd(values) {
  const filtered = values.map((value) => cleanColumnText(value)).filter(Boolean);
  if (filtered.length <= 1) {
    return filtered[0] ?? "";
  }
  if (filtered.length === 2) {
    return `${filtered[0]} and ${filtered[1]}`;
  }
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`;
}

function normalizeColumnName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractDarrenShapeIndex(topicKey) {
  const match = String(topicKey ?? "").match(/:(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function pickDarrenTopPlayerTopic(snapshot, previousColumn, usedTargets) {
  if (isOffseasonNewspaperDate(snapshot)) {
    return pickDarrenOffseasonProspectTopic(snapshot, previousColumn, usedTargets);
  }

  const topStar = snapshot?.threeStarsOfDay?.[0];
  if (!topStar) {
    return null;
  }

  const gameContext = findGameContextForStar(snapshot, topStar);
  const player = resolveDarrenStarPlayer(snapshot, topStar, gameContext);
  const profile = player ? readDarrenPlayerProfile(player) : null;
  const displayName = buildPlainPlayerName(profile?.displayName || player?.name || topStar.player);
  const playerTeam = profile?.teamFullName || player?.team || topStar.team || gameContext?.game?.awayTeam || "";
  const standingsTeam = findStandingsTeam(snapshot, playerTeam);
  const playerHistory = findPlayerHistory(displayName);
  const recordHits = findRecordByPlayer(displayName);
  const leaderboardEntries = findLeaderboardEntriesByPlayer(displayName);
  const role = topStar.role === "pitcher" ? "pitcher" : "hitter";
  const positionLabel = buildDarrenTopPlayerPositionLabel(player?.pos, role);
  const detailLine = String(topStar.detailLine || "").trim();
  const seasonLine = buildDarrenSeasonProgressLine(role, profile?.currentLine ?? {}, standingsTeam, playerTeam, displayName);
  const comparisonLine = buildDarrenCareerComparisonLine(role, profile);
  const specialLine = buildDarrenTopPlayerSpecialLine(displayName, role, gameContext, detailLine, topStar);
  const careerLine = buildDarrenCareerHistoryLine(displayName, playerHistory, recordHits, leaderboardEntries, profile, playerTeam);
  const whyItMattersLine = buildDarrenWhyItMattersLine(displayName, playerTeam, standingsTeam, role, profile?.currentLine ?? {});
  const shapeCount = role === "pitcher" ? 4 : 5;
  const preferredShape = pickStableIndexForColumns(`darren-shape:${String(snapshot.generatedAt ?? "").slice(0, 10)}:${displayName}:${role}`, shapeCount);
  const previousShape = extractDarrenShapeIndex(previousColumn?.topicKey);
  const shapeIndex = shapeCount > 1 && preferredShape === previousShape ? (preferredShape + 1) % shapeCount : preferredShape;
  const headline = buildDarrenTopPlayerHeadline(displayName, role, shapeIndex, gameContext, topStar, standingsTeam, playerTeam);
  const body = buildDarrenTopPlayerBody({
    displayName,
    playerTeam,
    positionLabel,
    specialLine,
    seasonLine,
    comparisonLine,
    careerLine,
    whyItMattersLine,
    role,
    shapeIndex,
  });

  if (!body) {
    return null;
  }

  return {
    headline,
    body,
    topicKey: `darren:top-player:${String(snapshot.generatedAt ?? "").slice(0, 10)}:${displayName}:${shapeIndex}`,
    targetKey: `player:${displayName}`,
  };
}

function pickDarrenOffseasonProspectTopic(snapshot, previousColumn, usedTargets) {
  const prospect = snapshot?.prospectHighlight;
  if (!prospect?.displayName && !prospect?.name) {
    return null;
  }

  const displayName = buildPlainPlayerName(prospect.displayName || prospect.name);
  const playerTeam = cleanColumnText(prospect.teamFullName || prospect.team || "");
  const role = /^p$/i.test(cleanColumnText(prospect.pos)) || /sp|rp|cl/i.test(cleanColumnText(prospect.pos))
    ? "pitcher"
    : "hitter";
  const positionLabel = buildDarrenPositionLabel(prospect.pos);
  const currentLine = prospect.currentLine ?? {};
  const age = cleanColumnText(prospect.age ?? "");
  const nationality = cleanColumnText(prospect.nationality ?? "");
  const rank = cleanColumnText(prospect.rank ?? "");
  const awardsLine = cleanColumnText(prospect.awardsLine ?? "");
  const acquisitionLine = cleanColumnText(prospect.acquisitionSummaryLine ?? "");
  const playerHistory = findPlayerHistory(displayName);
  const recordHits = findRecordByPlayer(displayName);
  const leaderboardEntries = findLeaderboardEntriesByPlayer(displayName);
  const seasonLine = buildDarrenProspectSeasonLine(role, displayName, currentLine, prospect.level);
  const comparisonLine = buildDarrenProspectComparisonLine(role, displayName, currentLine, prospect);
  const careerLine = buildDarrenProspectCareerLine(displayName, playerHistory, recordHits, leaderboardEntries, awardsLine, acquisitionLine);
  const whyItMattersLine = buildDarrenProspectWhyItMattersLine(displayName, playerTeam, prospect);
  const shapeCount = 4;
  const preferredShape = pickStableIndexForColumns(`darren-prospect-shape:${String(snapshot.generatedAt ?? "").slice(0, 10)}:${displayName}`, shapeCount);
  const previousShape = extractDarrenShapeIndex(previousColumn?.topicKey);
  const shapeIndex = shapeCount > 1 && preferredShape === previousShape ? (preferredShape + 1) % shapeCount : preferredShape;
  const headlineOptions = [
    `${displayName} Is the Prospect Number I Keep Coming Back To`,
    `Why ${displayName} Feels Bigger Than One Winter Ranking`,
    `${displayName} and the Shape of a Real Prospect Bet`,
    `${displayName} Is the Kind of Prospect Who Changes a System's Mood`,
  ];
  const headline = `Darren Kline: ${headlineOptions[shapeIndex % headlineOptions.length]}`;
  const intro = `${displayName}, the ${positionLabel} in the ${playerTeam} system, is where I want to spend the offseason page today. ${rank ? `He opens the morning as the No. ${rank} prospect in the ABA view.` : "He is one of the better names on the board for a reason."}`;
  const detailLead = `${displayName} is ${age ? `${age} years old` : "young enough to matter quickly"}${nationality ? `, comes out of ${nationality}` : ""}, and is already at ${prospect.level || "an upper level"}.`;
  const shapes = [
    [intro, `${detailLead} ${seasonLine}`.trim(), `${comparisonLine} ${careerLine} ${whyItMattersLine}`.trim()].filter(Boolean),
    [`${displayName} is the sort of prospect who makes the offseason a little less abstract. ${detailLead}`, seasonLine, `${careerLine} ${whyItMattersLine}`.trim()].filter(Boolean),
    [`${displayName} is not interesting just because of a rank next to his name. ${detailLead}`, `${seasonLine} ${comparisonLine}`.trim(), `${careerLine} ${whyItMattersLine}`.trim()].filter(Boolean),
    [`The offseason is when I like to find the prospect whose page explains more than the ranking sheet does, and today that player is ${displayName}. ${detailLead}`, seasonLine, `${comparisonLine} ${careerLine} ${whyItMattersLine}`.trim()].filter(Boolean),
  ];
  const body = (shapes[shapeIndex % shapes.length] ?? []).filter(Boolean).join("\n\n");

  return {
    headline,
    body,
    topicKey: `darren:prospect:${String(snapshot.generatedAt ?? "").slice(0, 10)}:${displayName}:${shapeIndex}`,
    targetKey: `prospect:${displayName}`,
  };
}

function pickMackTopic(snapshot, previousColumn, usedTargets) {
  const offseasonSigningTopic = pickMackOffseasonSigningTopic(snapshot, previousColumn);
  if (offseasonSigningTopic) {
    usedTargets.add(offseasonSigningTopic.targetKey);
    return offseasonSigningTopic;
  }

  const gameTopic = pickMackGameTopic(snapshot, previousColumn);
  if (gameTopic) {
    usedTargets.add(gameTopic.targetKey);
    return gameTopic;
  }

  const allStarHeadline = snapshot.headlines.find((headline) => /all-star/i.test(headline.title));
  if (allStarHeadline) {
    const lastSeason = getLastCompletedSeason();
    return {
      headline: "Mack Dalton: Ballots, Bunk, and a Few Real All-Stars",
      body: `I have always loved All-Star day, and I suspect I always will. It is one of those baseball inventions that feels a little silly right up until the moment it feels perfect. Fans get loud. Clubhouses get territorial. A dozen deserving players are left to stare at the ceiling and wonder what exactly they were supposed to do with that .340 average or that pile of scoreless innings. It is wonderful. It is human. It is also, if we are being honest, a terrible way to settle anything permanently.

So when the American Baseball Association starts passing around its latest All-Star sheet, I do not read it like a final exam. I read it like a snapshot of what the league cannot stop talking about. That is useful. It tells me who is making people spill their coffee in the morning and who has become impossible to ignore. But the standings still get the last word with me. They always do. Honors are lovely. Pennant races are merciless. One gives you a ribbon for being splendid in public. The other asks whether you can still be splendid on the fifth day of a road trip when the game starts to feel like work.

${lastSeason ? `That is why I keep thinking about ${lastSeason.champion} ending last season in a heap of joy and dirt. Nobody remembers the exact temperature of the All-Star arguments by the time October arrives. They remember the club that could still breathe in the biggest moments.` : "That is why I keep coming back to the same quiet truth: by the time October arrives, the applause lines have faded and only the hard baseball remains."} If you want my view of the whole affair, it is simple enough. Celebrate the selections. Argue about the snubs. Have yourself a grand old time with it. Just do not confuse a midsummer honor roll with the deeper test. The game, thank goodness, still has another way of sorting people out.`,
      topicKey: "mack:all-star",
      targetKey: "headline:all-star",
    };
  }

  const powerRankings = snapshot.headlines.find((headline) => /power rankings/i.test(headline.title));
  if (powerRankings) {
    const topThree = extractPowerRankingTeams(powerRankings.fullText || "");
    const lead = topThree[0] ?? "the club in front";
    const challenger = topThree[1] ?? "the nearest challenger";
    const third = topThree[2] ?? "the rest of the field";
    const teamHistory = findTeamHistory(lead);
    const legacy = teamHistory ? summarizeTeamLegacy(teamHistory.fullName) : "";

    return {
      headline: `Mack Dalton: ${lead} Has Earned the Ink`,
      body: `I am old enough to remember when people simply looked at the standings and called that good. Now we have power rankings, which are half argument, half entertainment, and every now and then a pretty decent public service. Most weeks they are really just a way to put a necktie on a hunch. But once in a while they land on something honest, and this week they seem to have done exactly that.

The latest stack puts ${lead} out front, with ${challenger} and ${third} close enough behind to keep everybody glancing over a shoulder. I like that, because it tells the story the right way. It does not make the league look settled. It makes the league look alive. There is movement in it. There is weather in it. And there is the unmistakable sense that the clubs at the top are not there because of a lucky Tuesday or a soft patch of schedule. They are there because they have made a habit of winning the plain games, the forgettable games, the games that become meaningful only months later when you realize they all added up.${legacy ? ` In ${lead}'s case, the history file makes the point even sturdier: this is a franchise that already owns ${legacy}.` : ""}

That, to me, is the charm of this kind of list when it works. It does not just flatter a hot team. It puts a shape on the summer. It gives the rest of us a map of where the real trouble is gathering. So yes, let people argue over arrows and little movements from fifth to third if they enjoy that sort of thing. I am not above it myself. But the only part I truly care about is whether the clubs at the top feel like they belong there. This time, they do. And that makes the whole league more interesting.`,
      topicKey: `mack:power:${lead}`,
      targetKey: `team:${lead}`,
    };
  }

  const playerOfWeek = snapshot.headlines.find((headline) => /player of the week/i.test(headline.title));
  if (playerOfWeek) {
    return {
      headline: "Mack Dalton: A Hot Week Is a Start, Not a Legacy",
      body: `One of the sweetest little traditions in baseball is the Player of the Week announcement. It arrives with just enough ceremony to make a man feel ten feet tall and just enough brevity to remind him that the game is already moving on. I like that balance. Baseball should absolutely stop and tip its cap when somebody spends a week turning line drives into gossip.

But I also think the sport is wise not to linger too long. A hot week is a beginning, not a verdict. It tells you who has the timing right, whose confidence is running ahead of the field, which dugout suddenly feels a little more certain of itself in the late innings. That is all valuable. It is also fragile. The next road trip can swallow it. The next pair of sharp breaking balls can cool it. The game has a ruthless way of asking the same question over and over again until it trusts your answer.

So I read these weekly honors with affection, not devotion. I enjoy the sizzle. I admire the craftsmanship. And then I wait to see what happens when the cheering quiets down. The players who matter most are the ones who keep writing their case after the headline has drifted off the page. Those are the fellows who shape a season.`,
      topicKey: "mack:player-of-week",
      targetKey: "headline:player-of-week",
    };
  }

  const leadTeam = snapshot.standings[0];
  return {
    headline: `${columnistLabel("Mack Dalton")}: Why ${bestLabel(leadTeam || { Team: "The Leaders" })} Feel Real`,
    body: `The older I get, the more I trust the standings. Not because they are glamorous. Quite the opposite. They are wonderfully stubborn things. They do not care about our moods, our theories, or the particularly persuasive little speech we heard on behalf of some hot club three days ago. They simply sit there and keep count.

That is why the team on top always catches my attention, even before I know the finer details. First place is built out of small acts of competence most people never remember individually. It is built out of surviving the dreary travel day, converting the awkward one-run game, finding a way to win when the crowd goes quiet and the lineup looks thin. Anybody can look important for a weekend. The table asks whether you can keep doing the work after the weekend is gone.

So yes, I still begin here. With the club at the top. With the plain arithmetic of wins and losses. With the belief that momentum, in baseball, is only as real as the next week allows it to be. If a team stays up there anyway, then it has earned more than attention. It has earned belief.`,
    topicKey: `fallback:${bestLabel(leadTeam || { Team: "The Leaders" })}`,
    targetKey: `team:${bestLabel(leadTeam || { Team: "The Leaders" })}`,
  };
}

function pickMattTopic(snapshot, previousColumn, usedTargets) {
  const candidates = buildMattCandidates(snapshot);
  const selected =
    candidates.find((candidate) => candidate.topicKey !== previousColumn?.topicKey && !usedTargets.has(candidate.targetKey)) ??
    candidates.find((candidate) => !usedTargets.has(candidate.targetKey)) ??
    candidates.find((candidate) => candidate.topicKey !== previousColumn?.topicKey) ??
    candidates[0];

  if (selected) {
    usedTargets.add(selected.targetKey);
    return selected;
  }

  const topHeadline = snapshot.headlines[0];
  return {
    headline: "Matt Gropius: The Game Still Tells You Who It Trusts",
    body: `I have spent enough years in this league to know that the game always gives itself away if you watch long enough. The teams it trusts keep showing up in the eighth inning with good at-bats, a calm bullpen, and a dugout that does not start inventing panic when one inning goes sideways.

That is why I never mind beginning with the biggest current story, even when it starts with something like "${topHeadline?.title ?? "the latest league noise"}." The headline is the doorway, not the whole house. What I want to know is whether the baseball underneath it feels sturdy. Can a club handle its own expectations? Can a star carry the room for six weeks instead of six days? Can a contender keep its personality when the schedule turns mean?

Those are ex-player questions, I suppose, because they come from memory as much as from the standings. I remember what championship clubs sounded like. I remember what nervous clubs sounded like too. The state of the game is never hidden for long. It always leaks into the details.`,
    topicKey: `matt:fallback:${topHeadline?.title ?? "league-noise"}`,
    targetKey: `headline:${topHeadline?.title ?? "league-noise"}`,
  };
}

function pickDarrenTopic(snapshot, previousColumn, usedTargets) {
  const dailyPlayerTopic = pickDarrenDailyPlayerTopic(snapshot, previousColumn, usedTargets);
  if (dailyPlayerTopic) {
    usedTargets.add(dailyPlayerTopic.targetKey);
    if (dailyPlayerTopic.teamTargetKey) {
      usedTargets.add(dailyPlayerTopic.teamTargetKey);
    }
    return dailyPlayerTopic;
  }

  const historyTopic = pickDarrenHistoryTopic(snapshot, previousColumn, usedTargets);
  if (historyTopic) {
    usedTargets.add(historyTopic.targetKey);
    return historyTopic;
  }

  const allStarHeadline = snapshot.headlines.find((headline) => /all-star/i.test(headline.title) && headline.fullText);
  const pitchers = parsePitcherMetrics(allStarHeadline?.fullText ?? "");
  const whipLeader = pitchers
    .filter((pitcher) => Number.isFinite(pitcher.whip))
    .sort((left, right) => left.whip - right.whip || right.k9 - left.k9)[0];

  if (whipLeader) {
    const playerHistory = findPlayerHistory(whipLeader.name);
    const recordHits = findRecordByPlayer(whipLeader.name);
    return {
      headline: `Darren Kline: The ${formatMetric(whipLeader.whip)} WHIP That Explains More Than the ERA`,
      body: `There is a reflex in baseball coverage that I understand even when I do not agree with it. We see a starter with a bright ERA and a glossy win total, and we stop there because those numbers look like answers. They are not answers. They are invitations. If you want the cleaner explanation for why ${formatPersonWithTeam(whipLeader.name, whipLeader.team)} keeps turning innings into dead ends, start with the ${formatMetric(whipLeader.whip)} WHIP.

That number matters because it strips the performance down to its pressure points. It tells you how often hitters are even getting permission to make a mess. In this case, hardly at all. ${whipLeader.name} is limiting traffic, keeping counts from snowballing, and pairing that with a ${formatMetric(whipLeader.k9)} K/9 that leaves very little room for accidental escape. That is how pitchers start to control a league without always sounding flashy when people read the first line of the stat page.

What I like about it is the way it explains the standings instead of merely decorating them. Clubs do not stay sturdy because every game turns into a highlight reel. They stay sturdy because someone keeps killing rallies in the second inning, the fourth inning, the sixth inning, before the game has a chance to get dramatic. ${playerHistory ? `The history file hints that ${whipLeader.name} has been building toward this kind of authority for a while.` : "That sort of authority is usually the first sign that a season is getting real."}${recordHits[0] ? ` And with ${recordHits[0].category.toLowerCase()} history already attached to the name, the line between great month and meaningful season gets thinner.` : ""} So if you are looking for a number that can surprise you and explain the league at the same time, there it is: WHIP, plain and unsentimental, doing a better reporting job than half the noise around it.`,
      topicKey: `darren:whip:${whipLeader.name}:${formatMetric(whipLeader.whip)}`,
      targetKey: `player:${whipLeader.name}`,
    };
  }

  const battingCandidates = parseBatterMetrics(allStarHeadline?.fullText ?? "");
  const wrcLeader = battingCandidates
    .filter((batter) => Number.isFinite(batter.wrcPlus))
    .sort((left, right) => right.wrcPlus - left.wrcPlus)[0];

  if (wrcLeader) {
    const playerHistory = findPlayerHistory(wrcLeader.name);
    const recordHits = findRecordByPlayer(wrcLeader.name);
    return {
      headline: `Darren Kline: ${wrcLeader.wrcPlus} wRC+ Is the Number Hiding in Plain Sight`,
      body: `Every league develops a player whose surface stats look excellent and whose deeper indicators look almost impolite. Right now that player is ${formatPersonWithTeam(wrcLeader.name, wrcLeader.team)}, and the rude number is ${wrcLeader.wrcPlus} wRC+. That is not just a badge for being productive. It is a description of how badly normal run-prevention ideas are failing around him.

The useful thing about wRC+ is that it gives context back to the conversation. Batting average can charm you. Home runs can seduce you. wRC+ asks a less romantic question: relative to the league, how much damage is this hitter really doing? In ${wrcLeader.name}'s case, the answer is enough to bend strategy. Pitchers stop attacking the same way. Bullpens get warmed up earlier. Managers make defensive choices they would rather not make. A single hitter starts changing the architecture of innings.

That is why this matters beyond one hot stat line. ${playerHistory ? `When the historical file already says ${wrcLeader.name} has staying power, the number stops feeling like a novelty and starts feeling like a warning.` : "The challenge is figuring out whether the number is a stunt or a signal."}${recordHits[0] ? ` Add in the shadow of a record-board marker, and now we are talking about a season that may be testing bigger boundaries than people realize.` : ""} If you want a statistic that can both surprise the casual reader and explain what the league keeps feeling in late innings, start there. ${wrcLeader.wrcPlus} wRC+ is not trivia. It is evidence.`,
      topicKey: `darren:wrc:${wrcLeader.name}:${wrcLeader.wrcPlus}`,
      targetKey: `player:${wrcLeader.name}`,
    };
  }

  const pitchingLeader = snapshot.pitchingLeaderboards?.[0]?.entries?.[0];
    if (pitchingLeader) {
      const fullPitchingLeaderName = resolvePlayerName(pitchingLeader.player, pitchingLeader.team);
      return {
        headline: `Darren Kline: The Quiet Math Behind ${fullPitchingLeaderName}`,
        body: `There is a reason I keep going back to the quieter pitching numbers. They are less interested in applause and more interested in survival. ${formatPersonWithTeam(pitchingLeader.player, pitchingLeader.team)} is getting the public credit already, and that is fine. What interests me more is the stack of underlying indicators that usually travel well from one month to the next.
  
The league has a way of exposing fake dominance. A pitcher can bluff his way through a headline for a week or two, maybe even longer if the sequencing is kind. What lasts is the stuff underneath: limiting baserunners, commanding counts, forcing opponents to build rallies one clean swing at a time instead of three cheap mistakes. That is the profile I keep looking for because it tends to explain why certain teams remain calm in the standings while everyone else keeps waiting for the correction.

That is the heart of this beat for me. Find the number that sounds a little less glamorous, hold it up to the light, and ask whether it explains the standings better than the obvious ones do. Usually it does. And usually, by the time the room catches up, the league has already been telling the truth for weeks.`,
      topicKey: `darren:pitching:${pitchingLeader.player}`,
      targetKey: `player:${pitchingLeader.player}`,
    };
  }

  return {
    headline: "Darren Kline: Find the Useful Number, Ignore the Shiny One",
    body: `Every edition comes with a handful of statistics built to flatter the loudest conversation in the room. I am not against loud numbers. I just do not trust them on their own.

The more reliable clues are usually a layer deeper: baserunner suppression, context-adjusted run creation, strike-throwing without waste, the little pieces of performance that survive after the mood changes. Those are the numbers that tend to explain why a first-place team is still there two weeks later and why a breakout player stops feeling like a rumor and starts feeling like a problem.

That is the assignment as I see it. Surprise the reader a little, yes. But more important, explain the league. Find the stat that makes the standings look less mysterious. Find the number that turns noise into shape. Then stay on it until everyone else catches up.`,
    topicKey: "darren:fallback:history-math",
    targetKey: "history:math",
  };
}

function pickDarrenDailyPlayerTopic(snapshot, previousColumn, usedTargets) {
  const candidates = loadDarrenLeaguePlayers(snapshot)
    .filter((player) => player?.playerId && player?.playerPagePath && Number(player?.age) >= 21 && player?.team && !/free agent/i.test(player.team))
    .sort((left, right) => String(left.playerId).localeCompare(String(right.playerId)));

  if (!candidates.length) {
    return null;
  }

  const preferredIndex = pickStableIndexForColumns("darren-daily-player", candidates.length);
  const rotated = [...candidates.slice(preferredIndex), ...candidates.slice(0, preferredIndex)];
  const selected =
    rotated.find((player) => buildDarrenPlayerTopicKey(player) !== previousColumn?.topicKey && !usedTargets.has(`team:${player.team}`)) ??
    rotated.find((player) => buildDarrenPlayerTopicKey(player) !== previousColumn?.topicKey) ??
    rotated[0];

  if (!selected) {
    return null;
  }

  const profile = readDarrenPlayerProfile(selected);
  if (!profile) {
    return null;
  }

  const teamStanding = findStandingsTeam(snapshot, selected.team);
  const playerHistory = findPlayerHistory(profile.displayName || selected.name);
  const recordHits = findRecordByPlayer(profile.displayName || selected.name);
  const teamContext = buildDarrenTeamContext(selected.team, teamStanding);
  const roleContext = buildDarrenRoleContext(selected, profile, teamStanding);
  const statAngle = buildDarrenStatAngle(selected, profile);
  const extraContext = buildDarrenExtraContext(playerHistory, recordHits, profile);
  const headlineMetric = buildDarrenHeadlineMetric(selected, profile);
  const fullName = profile.displayName || selected.name;
  const plainName = buildPlainPlayerName(fullName);
  const positionLabel = buildDarrenPositionLabel(selected.pos);

  return {
    headline: `Darren Kline: ${plainName} and the Number That Explains ${headlineMetric}`,
    body: `${fullName}, the ${positionLabel} for the ${selected.team}, is the kind of player who can disappear into the middle of a page if you let him. I do not want to let him. ${teamContext} That makes this a good moment to stop on a ${selected.age}-year-old ${profile.nationality ? `${profile.nationality.toLowerCase()} ` : ""}${positionLabel.toLowerCase()} and ask what he is actually doing to shape the season.

${statAngle} ${roleContext}

That is where the team context matters. Numbers are not interesting to me unless they tell us something about responsibility, and ${plainName} is carrying real responsibility right now. ${extraContext} If you want a daily reminder that the league is often explained by one player a little further down the page than you expected, start here.`,
    topicKey: buildDarrenPlayerTopicKey(selected),
    targetKey: `player:${plainName}`,
    teamTargetKey: `team:${selected.team}`,
  };
}

function loadDarrenLeaguePlayers(snapshot) {
  if (snapshot?.leaguePlayers?.length) {
    return [...snapshot.leaguePlayers];
  }

  const leagueDir = path.resolve(process.cwd(), "News", "leagues");
  if (!fs.existsSync(leagueDir)) {
    return [];
  }

  const players = [];
  const seenIds = new Set();
  const files = fs
    .readdirSync(leagueDir)
    .filter((fileName) => /^league_200_players_[a-z]\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of files) {
    const rawHtml = fs.readFileSync(path.join(leagueDir, fileName), "utf8");
    for (const match of rawHtml.matchAll(
      /<tr>\s*<td class="dl"><a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dc">([^<]+)<\/td>\s*<td class="dl">(?:<a href="\.\.\/teams\/team_(\d+)\.html">([^<]+)<\/a>|([^<]+))<\/td>\s*<td class="dc">(\d+)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>/gi,
    )) {
      const playerId = cleanColumnText(match[1] ?? "");
      if (!playerId || seenIds.has(playerId)) {
        continue;
      }

      const age = Number.parseInt(cleanColumnText(match[7] ?? ""), 10);
      const team = cleanColumnText(match[5] ?? match[6] ?? "");
      if (!Number.isFinite(age) || age < 21 || !team || /free agent/i.test(team)) {
        continue;
      }

      const teamId = cleanColumnText(match[4] ?? "");
      players.push({
        playerId,
        name: normalizeColumnPlayerListName(match[2] ?? ""),
        pos: cleanColumnText(match[3] ?? ""),
        team,
        teamId,
        age,
        nationality: cleanColumnText(match[10] ?? ""),
        bats: cleanColumnText(match[11] ?? ""),
        throws: cleanColumnText(match[12] ?? ""),
        playerPagePath: path.resolve(leagueDir, "..", "players", `player_${playerId}.html`),
      });
      seenIds.add(playerId);
    }
  }

  return players;
}

function pickMackOffseasonSigningTopic(snapshot, previousColumn) {
  if (!isOffseasonNewspaperDate(snapshot)) {
    return null;
  }

  const signingCandidates = buildMackSigningCandidates(snapshot);
  if (!signingCandidates.length) {
    return null;
  }

  const selected = pickStableMackSigning(signingCandidates, previousColumn);
  if (!selected) {
    return null;
  }

  const yearsLabel = selected.years === 1 ? "one year" : `${selected.years} years`;
  const moneyLabel = selected.totalValueText || "real money";
  const bonusSentence = selected.signingBonusText
    ? ` There is also a signing bonus of ${selected.signingBonusText}, which tells you this was not just a casual flyer.`
    : "";
  const teamNeedSentence = buildMackSigningNeedSentence(selected);
  const playerContextSentence = buildMackSigningPlayerSentence(selected);

  return {
    headline: `Mack Dalton: ${selected.team} Just Told You What They Wanted`,
    body: `This is the part of the baseball year I have always enjoyed more than people admit in public. The games go quiet for a moment, so the transactions have to do the talking. And when a club signs ${selected.player}, it is not really buying a name. It is buying an idea of what the next summer is supposed to feel like.

${selected.team} did not stumble into this one. The club gave ${selected.player}, a ${selected.positionLabel}, ${yearsLabel} and ${moneyLabel}.${bonusSentence}${teamNeedSentence} That is front-office language for urgency. It means somebody in that room looked at the roster, looked at the calendar, and decided this was the kind of move that could not wait for a cheaper afternoon.

${playerContextSentence} That is why I like a signing like this in February. It does not pretend to solve everything. It simply reveals intent. And in the offseason, intent is half the story.`,
    topicKey: `mack:signing:${selected.team}:${selected.player}:${selected.transactionDate}`,
    targetKey: `team:${selected.team}`,
  };
}

function pickMackGameTopic(snapshot, previousColumn) {
  const games = [...(snapshot.lastDayScores ?? [])].filter((game) => game.awayTeam && game.homeTeam);
  if (!games.length) {
    return null;
  }

  const selected = pickStableGame(games, previousColumn);
  if (!selected) {
    return null;
  }

  const winner = Number(selected.awayRuns) > Number(selected.homeRuns) ? selected.awayTeam : selected.homeTeam;
  const loser = winner === selected.awayTeam ? selected.homeTeam : selected.awayTeam;
  const potg = selected.playerOfTheGame || selected.winningPitcher || "the game's main actor";
  const recapSubject = selected.recapSubject || `${winner} found a way through`;
  const recapLead = selected.recapText || `${winner} beat ${loser} and did it in a way that left more to remember than the score alone.`;
  const featuredPerformer = selected.standoutPerformers?.[0] ?? null;
  const secondaryPerformer = selected.standoutPerformers?.[1] ?? null;
  const rankedPlays = rankNarrativeGamePlays(selected.notablePlays ?? []);
  const notablePlay = rankedPlays[0] ?? null;
  const secondNotablePlay = rankedPlays[1] ?? null;
  const performerLead = featuredPerformer ? describePerformerLine(featuredPerformer) : "";
  const secondPerformerLead = secondaryPerformer ? describeSecondaryPerformerLine(secondaryPerformer) : "";
  const firstPlaySentence = notablePlay ? formatNotablePlaySentence(notablePlay, "first") : "";
  const secondPlaySentence = secondNotablePlay ? formatNotablePlaySentence(secondNotablePlay, "later") : "";

  return {
    headline: `Mack Dalton: ${recapSubject}`,
    body: `There are some games that look finished in the box score and somehow still feel alive the next morning. This was one of those. ${recapLead} That is the kind of night I like to keep on the desk a little longer, because the final margin only tells part of the story. The rest lives in the way the innings bent, the way the pressure moved, and the way one or two players suddenly made the whole thing feel tilted.

${potg} is the obvious place to begin, and rightly so.${performerLead ? ` ${performerLead}` : ""}${secondPerformerLead ? ` ${secondPerformerLead}` : ""} What I enjoy about a game like this is that the stars did not perform in a vacuum. They performed in moments that mattered.

That is where the game log earns its keep. ${firstPlaySentence || `The log tells the old baseball truth: somebody had to make the inning blink first.`}${secondPlaySentence ? ` ${secondPlaySentence}` : ""} Those are the details that turn a result into a memory. ${winner} won the game, yes. But more than that, ${winner} authored the kind of evening that makes a columnist want to pour another cup of coffee and read the log one more time.`,
    topicKey: buildGameTopicKey(selected),
    targetKey: `team:${winner}`,
  };
}

function describePerformerLine(performer) {
  const bits = [];
  if (performer.hits) {
    bits.push(`went ${performer.hits} for the night`);
  }
  if (performer.rbi) {
    bits.push(`drove in ${performer.rbi}`);
  }
  if (performer.runs) {
    bits.push(`scored ${performer.runs}`);
  }

  if (!bits.length) {
    return "";
  }

  return `The batting line belongs in ink too: ${performer.player} ${joinClauseBits(bits)}.`;
}

function describeSecondaryPerformerLine(performer) {
  const bits = [];
  if (performer.hits) {
    bits.push(`${performer.hits} hit${performer.hits === 1 ? "" : "s"}`);
  }
  if (performer.rbi) {
    bits.push(`${performer.rbi} RBI`);
  }
  if (performer.runs) {
    bits.push(`${performer.runs} run${performer.runs === 1 ? "" : "s"}`);
  }

  if (!bits.length) {
    return "";
  }

  return `And there was help beyond that, with ${performer.player} supplying ${joinClauseBits(bits)} of his own.`;
}

function formatNotablePlaySentence(play, moment = "first") {
  const inningPhrase = formatColumnInningPhrase(play?.inning, moment);
  const lead =
    moment === "later"
      ? inningPhrase
        ? `Another turn came ${inningPhrase}`
        : "A little later, the game twisted again"
      : inningPhrase
        ? `The first real jolt came ${inningPhrase}`
        : `${play.player} supplied one of the night's first real jolts`;

  return `${lead}, when ${play.player} ${play.text}.`;
}

function formatColumnInningPhrase(value, moment = "first") {
  const inningText = String(value ?? "").trim();
  if (!inningText) {
    return "";
  }

  const match = inningText.match(/^(TOP|BOTTOM)\s+OF\s+THE\s+(\d+)(?:ST|ND|RD|TH)$/i);
  if (!match) {
    return inningText.toLowerCase();
  }

  const half = match[1].toUpperCase() === "TOP" ? "top" : "bottom";
  const inningNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(inningNumber)) {
    return `in the ${half} of the inning`;
  }

  const ordinal = formatColumnOrdinal(inningNumber);
  return `in the ${half} of the ${ordinal}`;
}

function formatColumnOrdinal(value) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function joinClauseBits(bits) {
  if (bits.length <= 1) {
    return bits[0] ?? "";
  }
  if (bits.length === 2) {
    return `${bits[0]} and ${bits[1]}`;
  }
  return `${bits.slice(0, -1).join(", ")}, and ${bits[bits.length - 1]}`;
}

function rankNarrativeGamePlays(plays) {
  return [...plays]
    .filter((play) => !/double play/i.test(String(play?.text ?? "")))
    .sort((left, right) => scoreNarrativePlay(right) - scoreNarrativePlay(left))
    .slice(0, 2);
}

function scoreNarrativePlay(play) {
  const text = String(play?.text ?? "").toLowerCase();
  let score = 0;

  if (text.includes("home run")) {
    score += 100;
  }
  if (text.includes("run-scoring") || text.includes("home")) {
    score += 80;
  }
  if (text.includes("single")) {
    score += 30;
  }
  if (text.includes("double")) {
    score += 25;
  }
  if (text.includes("triple")) {
    score += 35;
  }
  if (/10th|11th|12th|13th|14th/.test(String(play?.inning ?? ""))) {
    score += 40;
  } else if (/9th|8th/.test(String(play?.inning ?? ""))) {
    score += 20;
  }

  return score;
}

function buildGameTopicKey(game) {
  return `game:${game.awayTeam}-${game.homeTeam}:${game.awayRuns}-${game.homeRuns}`;
}

function buildMackSigningCandidates(snapshot) {
  const transactions = [...(snapshot.transactions ?? [])].filter((item) => item?.summary && item?.date);
  if (!transactions.length) {
    return [];
  }

  const groupedByDate = new Map();
  for (const item of transactions) {
    const key = cleanColumnText(item.date);
    if (!groupedByDate.has(key)) {
      groupedByDate.set(key, []);
    }
    groupedByDate.get(key).push(item);
  }

  for (const [, items] of groupedByDate) {
    const candidates = items
      .map((item) => parseMackSigningTransaction(item))
      .filter(Boolean)
      .sort((left, right) => right.priorityScore - left.priorityScore || left.player.localeCompare(right.player));

    if (candidates.length) {
      return candidates;
    }
  }

  return [];
}

function parseMackSigningTransaction(item) {
  const summary = cleanColumnText(item?.summary ?? "");
  const majorDealMatch = summary.match(
    /^(.+?)\s*:\s*Signed\s+(?:free agent\s+)?(?:international amateur\s+)?([A-Z0-9/]+)\s+(.+?)\s+to\s+a\s+(\d+)-year\s+contract\s+worth\s+a\s+total\s+of\s+\$([\d,]+(?:\.\d+)?)/i,
  );
  if (majorDealMatch) {
    const team = cleanColumnText(majorDealMatch[1]);
    const position = cleanColumnText(majorDealMatch[2]);
    const player = buildPlainPlayerName(cleanColumnText(majorDealMatch[3]));
    const years = Number.parseInt(majorDealMatch[4], 10);
    const totalValue = parseCurrencyNumber(majorDealMatch[5]);
    const signingBonusText = cleanColumnText(summary.match(/with a\s+\$([\d,]+(?:\.\d+)?)\s+signing bonus/i)?.[1] ?? "");

    return {
      transactionDate: cleanColumnText(item.date),
      team,
      position,
      positionLabel: buildDarrenPositionLabel(position),
      player,
      years,
      totalValue,
      totalValueText: formatCurrencyForColumn(totalValue),
      signingBonusText: signingBonusText ? formatCurrencyForColumn(parseCurrencyNumber(signingBonusText)) : "",
      priorityScore: totalValue + years * 1000000,
      contractType: "major",
    };
  }

  const minorDealMatch = summary.match(
    /^(.+?)\s*:\s*Signed\s+(?:free agent\s+)?(?:international amateur\s+)?([A-Z0-9/]+)\s+(.+?)\s+to\s+a\s+minor league contract(?:\s+with\s+(?:a\s+\$([\d,]+(?:\.\d+)?)\s+signing bonus|a major league option))?/i,
  );
  if (!minorDealMatch) {
    return null;
  }

  const team = cleanColumnText(minorDealMatch[1]);
  const position = cleanColumnText(minorDealMatch[2]);
  const player = buildPlainPlayerName(cleanColumnText(minorDealMatch[3]));
  const signingBonus = parseCurrencyNumber(minorDealMatch[4] ?? "");
  const hasMajorLeagueOption = /major league option/i.test(summary);

  return {
    transactionDate: cleanColumnText(item.date),
    team,
    position,
    positionLabel: buildDarrenPositionLabel(position),
    player,
    years: 0,
    totalValue: signingBonus,
    totalValueText: "",
    signingBonusText: signingBonus ? formatCurrencyForColumn(signingBonus) : "",
    priorityScore: (hasMajorLeagueOption ? 500000 : 0) + signingBonus,
    contractType: "minor",
    hasMajorLeagueOption,
  };
}

function pickStableMackSigning(candidates, previousColumn) {
  if (!candidates.length) {
    return null;
  }

  const sorted = [...candidates].sort(
    (left, right) =>
      right.priorityScore - left.priorityScore ||
      left.team.localeCompare(right.team) ||
      left.player.localeCompare(right.player),
  );
  const pool = sorted.slice(0, Math.min(sorted.length, 4));
  const preferredIndex = pickStableIndexForColumns("mack-signing", pool.length);
  const rotated = [...pool.slice(preferredIndex), ...pool.slice(0, preferredIndex)];
  return rotated.find((candidate) => `mack:signing:${candidate.team}:${candidate.player}:${candidate.transactionDate}` !== previousColumn?.topicKey) ?? rotated[0];
}

function isOffseasonNewspaperDate(snapshot) {
  return ["OFFSEASON", "PRESEASON", "SPRING"].includes(String(snapshot?.currentMode ?? ""));
}

function parseCurrencyNumber(value) {
  const cleaned = cleanColumnText(value).replace(/[$,]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyForColumn(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(value >= 10000000 ? 1 : 2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")} million`;
  }

  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function buildMackSigningNeedSentence(signing) {
  if (signing.contractType === "major") {
    if (/starting pitcher|pitcher/i.test(signing.positionLabel)) {
      return ` If you are paying that kind of money for a pitcher, you are telling the league you expect your staff to matter again.`;
    }
    if (/catcher|shortstop|center fielder/i.test(signing.positionLabel)) {
      return ` That sort of move usually tells me a club wanted backbone as much as raw production.`;
    }
    return ` That is not a hedge move. That is a club trying to fix a real part of its lineup with one signature.`;
  }

  if (signing.hasMajorLeagueOption) {
    return ` Even as a minor league deal, the major league option tells you ${signing.team} believe there is a real path to helping the big club.`;
  }

  if (signing.signingBonusText) {
    return ` Even on a minor league contract, the bonus tells you ${signing.team} thought the market might move underneath them if they waited.`;
  }

  return ` It may not be the loudest contract on the board, but it still tells you where ${signing.team} think depth can become leverage.`;
}

function buildMackSigningPlayerSentence(signing) {
  if (signing.contractType === "major") {
    return `${signing.player} now carries the pleasant burden that comes with a real winter commitment. Fair or not, people will read the size of the contract as a statement about the size of the expected role. That is baseball. The money talks first, and the player spends the summer answering it.`;
  }

  if (signing.hasMajorLeagueOption) {
    return `${signing.player} is the kind of winter bet I find interesting because the deal sits halfway between caution and conviction. It says the club sees a useful piece, but it also wants to watch the spring tell the truth.`;
  }

  return `${signing.player} may arrive with less ceremony, but that does not make the move meaningless. Good clubs usually spend the quiet months stacking these smaller decisions until the roster feels different in August.`;
}

function pickStableGame(games, previousColumn) {
  if (!games.length) {
    return null;
  }

  const sortedGames = [...games].sort((left, right) => buildGameTopicKey(left).localeCompare(buildGameTopicKey(right)));
  const preferredIndex = pickStableIndexForColumns("mack-game", sortedGames.length);
  const rotated = [...sortedGames.slice(preferredIndex), ...sortedGames.slice(0, preferredIndex)];
  return rotated.find((game) => buildGameTopicKey(game) !== previousColumn?.topicKey) ?? rotated[0];
}

function pickStableIndexForColumns(seedKey, count) {
  if (!count) {
    return 0;
  }

  const seed = `${new Date().toISOString().slice(0, 10)}::${seedKey}`;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  }

  return Math.abs(hash) % count;
}

function buildMattCandidates(snapshot) {
  const playoffCandidates = buildMattPlayoffCandidates(snapshot);
  if (playoffCandidates.length) {
    return playoffCandidates;
  }

  const teams = getMattTeamPool(snapshot)
    .map((team) => buildMattStreakCandidate(snapshot, team))
    .filter(Boolean);

  const streakCandidates = teams
    .filter((team) => Math.abs(team.streakCount) > 5)
    .sort((left, right) => {
      const diff = Math.abs(right.streakCount) - Math.abs(left.streakCount);
      if (diff !== 0) {
        return diff;
      }
      return scoreMattCandidateOrder(left.targetKey) - scoreMattCandidateOrder(right.targetKey);
    });

  if (streakCandidates.length) {
    return streakCandidates;
  }

  const lastTenCandidates = teams
    .filter((team) => team.l10Extreme >= 7)
    .sort((left, right) => {
      const diff = right.l10Extreme - left.l10Extreme;
      if (diff !== 0) {
        return diff;
      }
      return scoreMattCandidateOrder(left.targetKey) - scoreMattCandidateOrder(right.targetKey);
    });

  if (lastTenCandidates.length) {
    return lastTenCandidates;
  }

  const mattLore = getMattGropiusLore();
  const legacyTeams = getMattTeamPool(snapshot);
  return legacyTeams
    .map((team) => buildMattTeamCandidateVaried(snapshot, team, mattLore))
    .filter(Boolean)
    .sort((left, right) => scoreMattCandidateOrder(left.targetKey) - scoreMattCandidateOrder(right.targetKey));

  const candidates = [];
  const mattLoreLegacy = getMattGropiusLore();
  const fresno = findStandingsTeam(snapshot, "Fresno Grizzlies");
  const ramseyHeadline = snapshot.headlines.find((headline) => /Ramsey Parrish/i.test(headline.title));
  if (fresno || ramseyHeadline) {
    const fresnoHistory = findTeamHistory("Fresno Grizzlies");
    const ramseyHistory = findPlayerHistory("Ramsey Parrish");
    candidates.push({
      headline: "Matt Gropius: Fresno Looks Like the Kind of Problem You Feel in October",
      body: `I know what a dangerous club feels like from the inside. It does not always announce itself with fireworks. Sometimes it is just the slow recognition that the lineup never gives you a breath and the dugout never seems surprised by a big moment. That is the sensation Fresno is giving me now, and Ramsey Parrish of the Fresno Grizzlies is sitting right in the middle of it.

I learned a long time ago, especially around ${mattLore.championshipMvpYear}, that the teams worth fearing are the ones that can make urgency feel ordinary. They do not need a pep talk every night. They wake up expecting the game to bend a little in their direction. Fresno is carrying some of that energy right now.${fresnoHistory?.championships ? ` The history helps too. A franchise with ${fresnoHistory.championships} championship${fresnoHistory.championships === 1 ? "" : "s"} knows what a real summer is supposed to feel like.` : ""}${ramseyHistory ? ` And Parrish is not just having a nice stretch. He is operating with the kind of résumé that changes how opponents map a series.` : ""}

I remember being in clubhouses where one hitter could calm the whole room just by taking the on-deck circle. Fresno has that kind of center of gravity right now. That is why I do not file them under entertaining. I file them under dangerous. There is a difference, and players can feel it before everybody else does.`,
      topicKey: "matt:fresno-ramsey",
      targetKey: "team:Fresno Grizzlies",
    });
  }

  const tucson = findStandingsTeam(snapshot, "Tucson Sidewinders");
  if (tucson) {
    candidates.push({
      headline: "Matt Gropius: Tucson Has the Look of a Team Nobody Wants to Draw",
      body: `Some teams make the standings look nice. Other teams make the schedule look unpleasant. Tucson is in the second category, and that is a compliment of the highest order coming from an old first baseman who spent years trying to figure out which clubs could actually hurt you.

When I was still playing, the teams that scared me were not always the prettiest ones. They were the ones that made a game feel crowded. A starter could not cruise. A reliever could not hide. A defense had to execute every little throw. Tucson is giving off some of that energy now. The record is one thing. The pressure they seem to apply to the full shape of a game is another.

That matters because the state of the league changes when one club starts making contenders uncomfortable before first pitch. I have played on nights when the other side looked beaten by the third inning because they could feel the lineup coming in waves. Tucson is not all the way to that territory every night, but they are close enough that people ought to stop describing them with soft words.`,
      topicKey: "matt:tucson-threat",
      targetKey: "team:Tucson Sidewinders",
    });
  }

  const syracuse = findStandingsTeam(snapshot, "Syracuse Mets");
  if (syracuse) {
    candidates.push({
      headline: "Matt Gropius: Syracuse Does Not Get to Hide from the Standard",
      body: `One of the privileges of winning in this league is that people stop letting you be charming. They stop giving you the underdog treatment. They stop patting you on the back for being feisty. Syracuse is in that territory now, and I think that is exactly right.

I say that as somebody who knows the difference between a season that feels cute and one that feels expensive. When I won the championship MVP back in ${mattLore.championshipMvpYear}, every game started to feel heavier because that is what success does. It raises the bill. Syracuse are sitting in the kind of spot where admiration is no longer the main response. Expectation is.

That is healthy for the league. Heavyweight clubs give everybody else a measuring stick. They also reveal who can handle being watched. The state of the game is better when top teams are forced to live in bright light, and right now Syracuse is one of the clubs being asked whether it can carry that weight all the way through summer.`,
      topicKey: "matt:syracuse-heavyweight",
      targetKey: "team:Syracuse Mets",
    });
  }

  return candidates;
}

function buildMattPlayoffCandidates(snapshot) {
  if (snapshot?.championshipChase?.phase !== "playoffs") {
    return [];
  }

  const roundOrder = [
    { key: "wildcard", label: "Wild Card Series", winsNeeded: 3 },
    { key: "division", label: "Division Series", winsNeeded: 4 },
    { key: "conference", label: "Conference Series", winsNeeded: 4 },
  ];

  const candidates = [];

  for (const conference of snapshot.championshipChase?.conferences ?? []) {
    for (const round of roundOrder) {
      for (const series of conference?.rounds?.[round.key] ?? []) {
        const teams = (series?.matchup ?? []).filter((entry) => entry && !entry.placeholder);
        if (teams.length !== 2) {
          continue;
        }
        if (teams.some((team) => team.advanced || team.eliminated)) {
          continue;
        }

        const candidate = buildMattPlayoffSeriesCandidate(snapshot, conference, round, teams);
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates.sort((left, right) => {
    const stateDiff = right.playoffPriority - left.playoffPriority;
    if (stateDiff !== 0) {
      return stateDiff;
    }
    return scoreMattCandidateOrder(left.targetKey) - scoreMattCandidateOrder(right.targetKey);
  });
}

function buildMattPlayoffSeriesCandidate(snapshot, conference, round, teams) {
  const [teamA, teamB] = teams;
  const contextA = buildMattContext(snapshot, teamA.fullName || teamA.team);
  const contextB = buildMattContext(snapshot, teamB.fullName || teamB.team);
  const winsA = Number.parseInt(teamA.seriesWins ?? "0", 10) || 0;
  const winsB = Number.parseInt(teamB.seriesWins ?? "0", 10) || 0;
  const totalWins = winsA + winsB;
  const leadingTeam = winsA >= winsB ? teamA : teamB;
  const trailingTeam = leadingTeam === teamA ? teamB : teamA;
  const leadingContext = leadingTeam === teamA ? contextA : contextB;
  const trailingContext = leadingTeam === teamA ? contextB : contextA;
  const state = totalWins === 0 ? "upcoming" : "ongoing";
  const playoffPriority = totalWins === 0 ? 1 : 2 + Math.max(winsA, winsB);
  const seriesLabel = `${round.label} in ${conference.label}`;
  const stateLine = totalWins === 0
    ? `${leadingTeam.fullName || leadingTeam.team} and ${trailingTeam.fullName || trailingTeam.team} have not started yet, which is exactly when an ex-player starts staring at the shape of a series instead of the glamour of it.`
    : winsA === winsB
      ? `${teamA.fullName || teamA.team} and ${teamB.fullName || teamB.team} are tied ${winsA}-${winsB}, and tied playoff series always force everyone to stop pretending the edges do not matter.`
      : `${leadingTeam.fullName || leadingTeam.team} lead this series ${Math.max(winsA, winsB)}-${Math.min(winsA, winsB)}, which means the pressure has changed address whether anyone wants to admit it or not.`;
  const edgeLine = buildMattPlayoffEdgeLine(leadingTeam, trailingTeam, leadingContext, trailingContext);
  const rosterLine = buildMattPlayoffRosterLine(leadingContext, trailingContext, leadingTeam, trailingTeam);
  const prediction = buildMattPlayoffPrediction(leadingTeam, trailingTeam, winsA, winsB, round.winsNeeded, leadingContext, trailingContext);
  const headline = buildMattPlayoffHeadline(leadingTeam, trailingTeam, state, round.label);

  return {
    headline,
    body: [
      `Playoff baseball is different because the game stops asking general questions and starts asking rude specific ones. ${seriesLabel} is one of those questions this morning. ${stateLine}`,
      `${edgeLine} ${rosterLine}`,
      prediction,
    ].filter(Boolean).join("\n\n"),
    topicKey: `matt:playoffs:${conference.key}:${round.key}:${normalizeMattText(teamA.team)}:${normalizeMattText(teamB.team)}:${winsA}-${winsB}`,
    targetKey: `series:${normalizeMattText(teamA.team)}:${normalizeMattText(teamB.team)}`,
    playoffPriority,
  };
}

function buildMattPlayoffHeadline(leadingTeam, trailingTeam, state, roundLabel) {
  const shortLeader = leadingTeam.displayName || leadingTeam.team || leadingTeam.fullName || "One club";
  const shortTrailer = trailingTeam.displayName || trailingTeam.team || trailingTeam.fullName || "the other side";
  if (state === "upcoming") {
    return `Matt Gropius: ${shortLeader} and ${shortTrailer} Are About to Learn What Travels in a Series`;
  }
  if (/wild/i.test(roundLabel)) {
    return `Matt Gropius: ${shortLeader} Have the Early Grip in This Series`;
  }
  return `Matt Gropius: Why ${shortLeader} Are Ahead and What ${shortTrailer} Must Change`;
}

function buildMattPlayoffEdgeLine(leadingTeam, trailingTeam, leadingContext, trailingContext) {
  const leaderIdentity = leadingContext?.identityLine ?? `${leadingTeam.fullName || leadingTeam.team} have a cleaner shape right now.`;
  const trailerConcern = trailingContext?.concernLine ?? `${trailingTeam.fullName || trailingTeam.team} still look like a club searching for firmer answers.`;
  return `${leaderIdentity} ${trailerConcern}`;
}

function buildMattPlayoffRosterLine(leadingContext, trailingContext, leadingTeam, trailingTeam) {
  const leaderHot = formatMattPlayoffEntryList(leadingContext?.hotEntries ?? []);
  const trailerCold = formatMattPlayoffEntryList(trailingContext?.coldEntries ?? []);
  const trailerHot = formatMattPlayoffEntryList(trailingContext?.hotEntries ?? []);

  if (leaderHot && trailerCold) {
    return `${leadingTeam.fullName || leadingTeam.team} are getting heat from ${leaderHot}, while ${trailingTeam.fullName || trailingTeam.team} need better answers around ${trailerCold}.`;
  }
  if (leaderHot) {
    return `${leadingTeam.fullName || leadingTeam.team} are getting the right kind of push from ${leaderHot}.`;
  }
  if (trailerHot) {
    return `${trailingTeam.fullName || trailingTeam.team} still have enough life from ${trailerHot} to turn this thing if they clean up the rest.`;
  }
  return "";
}

function buildDarrenProspectSeasonLine(role, displayName, line, level) {
  if (role === "pitcher") {
    const wins = cleanColumnText(line.W ?? "");
    const losses = cleanColumnText(line.L ?? "");
    const era = cleanColumnText(line.ERA ?? "");
    const innings = cleanColumnText(line.IP ?? "");
    const strikeouts = cleanColumnText(line.K ?? "");
    const walks = cleanColumnText(line.BB ?? "");
    const whip = cleanColumnText(line.WHIP ?? "");
    const pieces = [
      wins || losses ? `${wins || "0"}-${losses || "0"}` : "",
      era ? `${era} ERA` : "",
      innings ? `${innings} innings` : "",
      strikeouts ? `${strikeouts} strikeouts` : "",
      walks ? `${walks} walks` : "",
      whip ? `${whip} WHIP` : "",
    ].filter(Boolean);

    return pieces.length
      ? `At the ${level || "current"} level, ${displayName} is carrying ${joinWithCommasAndAnd(pieces)}.`
      : `The current stat line is still thin, which is normal enough when a prospect is just arriving at a new level.`;
  }

  const avg = cleanColumnText(line.AVG ?? "");
  const obp = cleanColumnText(line.OBP ?? "");
  const slg = cleanColumnText(line.SLG ?? "");
  const hr = cleanColumnText(line.HR ?? "");
  const rbi = cleanColumnText(line.RBI ?? "");
  const sb = cleanColumnText(line.SB ?? "");
  const war = cleanColumnText(line.WAR ?? "");
  const pieces = [
    avg ? `${avg} average` : "",
    obp ? `${obp} OBP` : "",
    slg ? `${slg} SLG` : "",
    hr ? `${hr} home runs` : "",
    rbi ? `${rbi} RBI` : "",
    sb ? `${sb} steals` : "",
    war ? `${war} WAR` : "",
  ].filter(Boolean);

  return pieces.length
    ? `At the ${level || "current"} level, ${displayName} is carrying ${joinWithCommasAndAnd(pieces)}.`
    : `The current stat line is still light, which is fair enough when a prospect is just settling into a new level.`;
}

function buildDarrenProspectComparisonLine(role, displayName, line, prospect) {
  if (role === "pitcher") {
    const era = cleanColumnText(line.ERA ?? "");
    const strikeouts = cleanColumnText(line.K ?? "");
    const innings = cleanColumnText(line.IP ?? "");
    if (era || strikeouts || innings) {
      return `${displayName} is not just a name on a winter list. The page already shows the outline of a pitcher who can miss bats and hold a workload once the innings start to pile up.`;
    }
    return `${displayName} is still early enough in the process that the evaluation has to live in trajectory more than in finished numbers.`;
  }

  const avg = cleanColumnText(line.AVG ?? "");
  const obp = cleanColumnText(line.OBP ?? "");
  const slg = cleanColumnText(line.SLG ?? "");
  if (avg || obp || slg) {
    return `${displayName} already looks like the kind of hitter whose line can explain itself without much decoration. When a young player gets to base and does damage at the same time, the conversation gets serious quickly.`;
  }

  return `${displayName} is still in the stage where the numbers are only part of the story. With prospects, the useful question is often how quickly the environment is starting to look too small.`;
}

function buildDarrenProspectCareerLine(displayName, playerHistory, recordHits, leaderboardEntries, awardsLine, acquisitionLine) {
  const details = [];

  if (awardsLine) {
    details.push(awardsLine);
  }
  if (acquisitionLine) {
    details.push(acquisitionLine);
  }
  if (playerHistory?.notes) {
    details.push(playerHistory.notes);
  }
  if (recordHits?.length) {
    const bestRecord = recordHits[0];
    const category = cleanColumnText(bestRecord.category ?? bestRecord.stat ?? "");
    if (category) {
      details.push(`${category.toLowerCase()} history already attached to his file`);
    }
  } else if (leaderboardEntries?.length) {
    const bestEntry = leaderboardEntries.find((entry) => isPositiveDarrenHistoryCategory(entry.category ?? entry.stat ?? "")) ?? null;
    const category = bestEntry ? cleanColumnText(bestEntry.category ?? bestEntry.stat ?? "") : "";
    if (category) {
      details.push(`a place on the history board in ${category.toLowerCase()}`);
    }
  }

  const trimmed = uniqueColumnDetails(details).slice(0, 3);
  if (!trimmed.length) {
    return `${displayName} does not need an oversized backstory yet. For a prospect, sometimes the most interesting thing is simply how quickly the page starts to feel crowded with possibility.`;
  }

  return `${displayName}'s file already has some shape to it: ${joinWithCommasAndAnd(trimmed)}.`;
}

function buildDarrenProspectWhyItMattersLine(displayName, playerTeam, prospect) {
  const rank = cleanColumnText(prospect.rank ?? "");
  const level = cleanColumnText(prospect.level ?? "");
  if (rank) {
    return `That is why ${displayName} matters to me in February. A top-${rank} prospect is not just a future headline. He is a clue about where ${playerTeam || "this organization"} think the next wave of real value is coming from${level ? `, especially with the player already at ${level}` : ""}.`;
  }

  return `That is why ${displayName} matters to me in February. Prospects are really about organizational pressure, and ${playerTeam || "this club"} clearly think there is something here worth protecting and accelerating.`;
}

function formatMattPlayoffEntryList(entries) {
  const names = [];
  for (const entry of entries ?? []) {
    const player = cleanColumnText(entry?.player ?? "");
    if (!player || names.includes(player)) {
      continue;
    }
    names.push(player);
  }
  return joinWithCommasAndAnd(names.slice(0, 3));
}

function buildMattPlayoffPrediction(leadingTeam, trailingTeam, winsA, winsB, winsNeeded, leadingContext, trailingContext) {
  const leaderWins = Math.max(winsA, winsB);
  const trailerWins = Math.min(winsA, winsB);
  const leaderName = leadingTeam.fullName || leadingTeam.team;
  const trailerName = trailingTeam.fullName || trailingTeam.team;
  const leaderGap = leadingContext?.gamesBackValue ?? 0;
  const trailerGap = trailingContext?.gamesBackValue ?? 0;
  const leaderHasEdge = (leadingContext?.hotEntries?.length ?? 0) >= (trailingContext?.hotEntries?.length ?? 0) || leaderGap <= trailerGap;
  const projectedWins = leaderHasEdge ? winsNeeded : Math.max(leaderWins + 1, winsNeeded - 1);
  const projectedLosses = Math.min(winsNeeded - 1, trailerWins + (leaderHasEdge ? 1 : 2));
  const predictedWinner = leaderHasEdge ? leaderName : trailerName;

  if (leaderWins === 0 && trailerWins === 0) {
    return `My read is ${predictedWinner} in ${winsNeeded + 1}. Not because playoff predictions are clean work, but because the sturdier club profile usually wins the long argument once the first punch lands.`;
  }

  return `If you want the ex-player pick, here it is: ${predictedWinner} finish this in ${projectedWins + projectedLosses} games. The club with the clearer identity usually wins the tired innings, and tired innings are where series get decided.`;
}

function getMattGropiusLore() {
  return {
    championshipMvpYear: 2027,
    prospectsGameMvpYear: 2031,
  };
}

function getMattTeamPool(snapshot) {
  const seen = new Set();
  const rows = [
    ...(snapshot.standings ?? []),
    ...((snapshot.standingsSections ?? [])
      .filter((section) => !/wildcard/i.test(section?.label ?? ""))
      .flatMap((section) => section.rows ?? [])),
  ];

  return rows.filter((row) => {
    const team = String(row?.Team ?? "").trim();
    if (!team || seen.has(team)) {
      return false;
    }
    seen.add(team);
    return true;
  });
}

function buildMattStreakCandidate(snapshot, teamRecord) {
  const teamName = String(teamRecord?.Team ?? "").trim();
  if (!teamName) {
    return null;
  }

  const seasonMode = getMattSeasonMode(snapshot);
  const context = buildMattContext(snapshot, teamName);
  const streakInfo = parseMattStreakInfo(teamRecord.Strk ?? teamRecord.STRK ?? "");
  const lastTenInfo = parseMattLastTenInfo(teamRecord.L10 ?? teamRecord["Last 10"] ?? "");
  const useStreak = Math.abs(streakInfo.count) > 5;
  const useLastTen = !useStreak && lastTenInfo.extreme >= 7;

  if (!useStreak && !useLastTen) {
    return null;
  }

  const signalKey = useStreak ? `streak:${streakInfo.code}` : `l10:${lastTenInfo.raw}`;
  const body = buildMattStreakBody(
    snapshot,
    teamName,
    context,
    useStreak ? streakInfo : null,
    useLastTen ? lastTenInfo : null,
    seasonMode,
    signalKey,
  );

  return {
    headline: buildMattStreakHeadline(teamName, context, useStreak ? streakInfo : null, useLastTen ? lastTenInfo : null, seasonMode),
    body,
    topicKey: `matt:team:${teamName.toLowerCase()}:${signalKey}`,
    targetKey: `team:${teamName}`,
    streakCount: streakInfo.count,
    l10Extreme: lastTenInfo.extreme,
  };
}

function buildMattStreakHeadline(teamName, context, streakInfo, lastTenInfo, seasonMode = "") {
  if (streakInfo?.type === "win") {
    if (seasonMode === "LATE_SEASON") {
      return `Matt Gropius: ${teamName} Are Making the Race Feel Smaller`;
    }
    if (seasonMode === "MIDDLE_SEASON") {
      return `Matt Gropius: ${teamName} Are Giving Themselves Breathing Room`;
    }
    return `Matt Gropius: ${teamName} Are Off to the Kind of Start People Notice`;
  }
  if (streakInfo?.type === "loss") {
    if (seasonMode === "EARLY_SEASON") {
      return `Matt Gropius: ${teamName} Need to Stop a Bad Start from Settling In`;
    }
    if (seasonMode === "MIDDLE_SEASON") {
      return `Matt Gropius: ${teamName} Need to Correct This Slide`;
    }
    return `Matt Gropius: ${teamName} Are Feeling the Weight of Every Night`;
  }
  if ((lastTenInfo?.wins ?? 0) >= 7) {
    if (seasonMode === "EARLY_SEASON") {
      return `Matt Gropius: ${teamName} Are Starting with Real Momentum`;
    }
    if (seasonMode === "MIDDLE_SEASON") {
      return `Matt Gropius: ${teamName} Are Building Something Real`;
    }
    return `Matt Gropius: ${teamName} Are Playing Like a Team That Can Matter in July`;
  }
  if ((lastTenInfo?.losses ?? 0) >= 7) {
    if (seasonMode === "EARLY_SEASON") {
      return `Matt Gropius: ${teamName} Are Letting a Bad Start Breathe`;
    }
    return `Matt Gropius: ${teamName} Are Running Out of Soft Explanations`;
  }
  return context.isSuccessfulTeam
    ? `Matt Gropius: ${teamName} Have Real Heat Around Them`
    : `Matt Gropius: ${teamName} Need Answers Fast`;
}

function buildMattIntroParagraph(teamName, context, streakInfo, lastTenInfo, seasonMode = "") {
  if (streakInfo?.type === "win") {
    if (seasonMode === "EARLY_SEASON") {
      return `This early in the season, a winning streak is less about finishing anything and more about learning whether a club has shown up ready. ${teamName} have won ${streakInfo.count} in a row, and that is the kind of start people inside a clubhouse bank for later. ${context.standingLine}`;
    }
    if (seasonMode === "MIDDLE_SEASON") {
      return `A hot stretch in the middle of the season can change a room without needing any grand language around it. ${teamName} have won ${streakInfo.count} in a row, and this is exactly how a club gives itself room to breathe after a noisy week or two. ${context.standingLine}`;
    }
    return `I always pay attention when a team gets past the point where you can call it a cute little run. ${teamName} have won ${streakInfo.count} in a row, and once a streak gets that long it starts changing the math of a race and the mood of a room. ${context.standingLine}`;
  }
  if (streakInfo?.type === "loss") {
    if (seasonMode === "EARLY_SEASON") {
      return `Bad starts feel louder because there is not much else on the page yet. ${teamName} have dropped ${streakInfo.count} in a row, and the useful question in April is whether the club treats that as a warning or as an identity. ${context.standingLine}`;
    }
    if (seasonMode === "MIDDLE_SEASON") {
      return `A losing streak in the middle of the season does not end anything by itself, but it does force a club to decide whether it is drifting or correcting. ${teamName} have dropped ${streakInfo.count} in a row, and there is still enough time to fix this if the answers get sharper now. ${context.standingLine}`;
    }
    return `Losing streaks tell the truth in a hurry. ${teamName} have dropped ${streakInfo.count} in a row, and nobody inside a clubhouse needs help understanding what that feels like. ${context.standingLine}`;
  }
  if ((lastTenInfo?.wins ?? 0) >= 7) {
    if (seasonMode === "EARLY_SEASON") {
      return `${teamName} may not have one giant streak hanging over the page, but a ${lastTenInfo.raw} run over the last ten is exactly how a club starts putting a healthy first month together. ${context.standingLine}`;
    }
    if (seasonMode === "MIDDLE_SEASON") {
      return `${teamName} may not have one giant streak hanging over the page, but a ${lastTenInfo.raw} run over the last ten tells me the club is nudging itself back toward the version it wants to be. ${context.standingLine}`;
    }
    return `${teamName} may not have one giant streak hanging over the page, but a ${lastTenInfo.raw} run over the last ten tells me the club is gathering force the honest way. ${context.standingLine}`;
  }
  if (seasonMode === "EARLY_SEASON") {
    return `${teamName} do not need a dramatic losing streak to tell you the start has been wrong. A ${lastTenInfo?.raw || "rough last-ten"} run is enough to show where the first cracks are. ${context.standingLine}`;
  }
  if (seasonMode === "MIDDLE_SEASON") {
    return `${teamName} do not need a dramatic losing streak to tell you the temperature is wrong. A ${lastTenInfo?.raw || "rough last-ten"} run is enough, and the important part is that there is still time to correct it if the club stops pretending this is just weather. ${context.standingLine}`;
  }
  return `${teamName} do not need a dramatic losing streak to tell you the temperature is wrong. A ${lastTenInfo?.raw || "rough last-ten"} run is enough. ${context.standingLine}`;
}

function buildMattPlayoffChaseLine(context, streakInfo, lastTenInfo, seasonMode = "") {
  if (seasonMode === "EARLY_SEASON") {
    if (context.isSuccessfulTeam) {
      return "That does not make anything final this early, but it does give a team permission to believe its better habits are real.";
    }
    if (streakInfo?.type === "loss" && streakInfo.count >= 3) {
      return "The season is too young for doom talk, but not too young to notice when bad habits are repeating themselves every night.";
    }
    return "The season is still young enough that one good week can clean this up, but only if the club is honest about what the start has exposed.";
  }

  if (seasonMode === "MIDDLE_SEASON") {
    if (context.isSuccessfulTeam) {
      return "This is the kind of stretch that gives a team a little oxygen in the middle of the schedule without needing to act like anything has been settled.";
    }
    if (streakInfo?.type === "loss" && streakInfo.count >= 3) {
      return "There is still enough schedule left to repair this, but the correction has to start before the slide turns into the club's personality.";
    }
    return "Midseason is where clubs either correct the shape of a bad run or let it harden, and there is still enough time here to choose the better option.";
  }

  const gamesLead = Number.isFinite(context.remainingGames) && context.remainingGames > 0
    ? `With ${context.remainingGames} games left, `
    : "";

  if (context.isSuccessfulTeam) {
    if (context.isDivisionLeader) {
      return `${gamesLead}this is the kind of stretch that turns a good standing into a chance to control the bracket. ${context.raceLine}`;
    }
    return `${gamesLead}this is how teams stop chasing the race and start leaning on it. ${context.raceLine}`;
  }

  if (streakInfo?.type === "loss" && streakInfo.count >= 3) {
    return `${gamesLead}every loss is making the climb steeper. ${context.raceLine}`;
  }
  if ((lastTenInfo?.losses ?? 0) >= 7) {
    return `${gamesLead}that kind of last-ten slide is how clubs wake up and realize the playoff line has moved farther away than they thought. ${context.raceLine}`;
  }
  return `${gamesLead}the race is still talking to them, but the answer has to come soon. ${context.raceLine}`;
}

function buildMattHotColdLine(context) {
  const hotNames = uniqueColumnDetails(context.hotEntries.map((entry) => entry.player));
  const coldNames = uniqueColumnDetails(context.coldEntries.map((entry) => entry.player));

  if (context.isSuccessfulTeam) {
    if (hotNames.length >= 2) {
      return `The hot hands are easy enough to find: ${joinWithCommasAndAnd(context.hotEntries.slice(0, 3).map((entry) => formatMattTrendEntry(entry)))} are giving the club real lift, and that is usually how a winning run keeps breathing.`;
    }
    if (hotNames.length === 1) {
      return `${formatMattTrendEntry(context.hotEntries[0])} is the name I keep circling, because one hot player can steady a whole dugout when the standings start to tighten.`;
    }
    return context.proofLine;
  }

  if (coldNames.length >= 2) {
    return `When a team is sliding, you start by asking who is not carrying enough weight. Right now that question lands around ${joinWithCommasAndAnd(context.coldEntries.slice(0, 3).map((entry) => formatMattTrendEntry(entry)))}.`;
  }
  if (coldNames.length === 1) {
    return `${formatMattTrendEntry(context.coldEntries[0])} is part of the problem right now, and clubs in this kind of spot do not get better until their important players stop drifting.`;
  }
  if (hotNames.length) {
    return `The frustrating part is that ${joinWithCommasAndAnd(hotNames.slice(0, 2))} are still giving them something, which tells you the whole problem is bigger than one cold bat or one bad night on the mound.`;
  }
  return context.concernLine;
}

function buildMattManagerPressureLine(context, streakInfo, lastTenInfo, seasonMode = "") {
  if (context.isSuccessfulTeam) {
    return "";
  }

  const managerText = context.managerName
    ? `That also puts heat on manager ${context.managerName}, because when a club is this far back the manager becomes the face of every decision the room does not trust.`
    : "That also puts heat on the manager, because when a club is this far back the dugout becomes the easiest place for pressure to land.";

  if (seasonMode === "EARLY_SEASON") {
    return context.managerName
      ? `Nobody fires off grand verdicts this early, but manager ${context.managerName} can already feel which daily decisions are being watched harder than he would like.`
      : "Nobody fires off grand verdicts this early, but the dugout can already feel which daily decisions are being watched harder than anyone would like.";
  }

  if (seasonMode === "MIDDLE_SEASON") {
    const baseText = context.managerName
      ? `Midseason is when the questions start following manager ${context.managerName} out of the ballpark, especially if the club keeps giving away ordinary games.`
      : "Midseason is when the questions start following the manager out of the ballpark, especially if the club keeps giving away ordinary games.";
    if (streakInfo?.type === "loss" && streakInfo.count >= 3) {
      return `${baseText} A streak of ${streakInfo.count} losses in a row makes every lineup card and bullpen move feel louder.`;
    }
    if ((lastTenInfo?.losses ?? 0) >= 7) {
      return `${baseText} A ${lastTenInfo.raw} run over the last ten is exactly the kind of stretch that demands a cleaner answer.`;
    }
    return baseText;
  }

  if (streakInfo?.type === "loss" && streakInfo.count >= 3) {
    return `${managerText} A streak of ${streakInfo.count} losses in a row always makes people start asking whether the room still believes in the daily plan.`;
  }
  if ((lastTenInfo?.losses ?? 0) >= 7) {
    return `${managerText} A ${lastTenInfo.raw} run over the last ten is exactly the kind of stretch that turns quiet frustration into loud questions.`;
  }
  return managerText;
}

function buildMattMeaningLine(context, streakInfo, lastTenInfo, seasonMode = "") {
  if (context.isSuccessfulTeam) {
    if (streakInfo?.type === "win") {
      if (seasonMode === "EARLY_SEASON") {
        return `That is what a strong opening looks like to me. It is not a promise about the finish; it is evidence that the club has shown up with real shape. ${context.identityLine}`;
      }
      if (seasonMode === "MIDDLE_SEASON") {
        return `This is useful midseason work. Good teams buy themselves a little calm this way and give a rough patch less power over the room. ${context.identityLine}`;
      }
      return `I have been on clubs that could feel the standings tighten in their favor, and this has that kind of smell to it. ${context.identityLine}`;
    }
    if (seasonMode === "EARLY_SEASON") {
      return `Good teams do not have to declare themselves forever in April. They just have to show that the good version of them exists. ${context.identityLine}`;
    }
    if (seasonMode === "MIDDLE_SEASON") {
      return `Good teams do not always announce themselves with fireworks. Sometimes they just stack a ${lastTenInfo?.raw || "strong week"} and remind everybody there is still time to shape the summer. ${context.identityLine}`;
    }
    return `Good teams do not always announce themselves with fireworks. Sometimes they just stack a ${lastTenInfo?.raw || "strong week"} and make everybody else check the scoreboard twice. ${context.identityLine}`;
  }

  if (seasonMode === "EARLY_SEASON") {
    return `There is too much season left for panic language, but not too much season left to ignore a bad start. ${context.concernLine}`;
  }
  if (seasonMode === "MIDDLE_SEASON") {
    return `There is still enough time to fix this, but only if the club stops treating a rough stretch like a passing inconvenience. ${context.concernLine}`;
  }
  if (context.gamesBackValue >= 8) {
    return `When you are this far back, you stop talking about patience and start talking about urgency. ${context.concernLine}`;
  }
  return `There is still room to fix this, but not if the club keeps playing as though the standings owe it another chance. ${context.concernLine}`;
}

function getMattSeasonMode(snapshot) {
  return String(snapshot?.currentMode ?? "").trim().toUpperCase();
}

function parseMattStreakInfo(value) {
  const text = cleanColumnText(value);
  const match = text.match(/^([WwLl])(\d+)$/);
  if (!match) {
    return { code: text, type: "", count: 0 };
  }

  const count = Number.parseInt(match[2], 10);
  return {
    code: `${match[1].toUpperCase()}${count}`,
    type: match[1].toLowerCase() === "w" ? "win" : "loss",
    count: Number.isFinite(count) ? count : 0,
  };
}

function parseMattLastTenInfo(value) {
  const raw = cleanColumnText(value);
  const match = raw.match(/^(\d+)-(\d+)$/);
  const wins = match ? Number.parseInt(match[1], 10) : 0;
  const losses = match ? Number.parseInt(match[2], 10) : 0;
  return {
    raw,
    wins,
    losses,
    extreme: Math.max(wins, losses),
  };
}

function buildMattTeamCandidate(teamRecord, mattLore) {
  const teamName = String(teamRecord?.Team ?? "").trim();
  if (!teamName) {
    return null;
  }

  const seasonMode = getMattSeasonMode({ currentMode: inferMattModeFromRecord(teamRecord) });
  const teamHistory = findTeamHistory(teamName);
  const wins = Number.parseInt(teamRecord.W ?? teamRecord.Wins ?? "", 10) || 0;
  const losses = Number.parseInt(teamRecord.L ?? teamRecord.Losses ?? "", 10) || 0;
  const gamesBack = parseGamesBackValue(teamRecord.GB ?? teamRecord["G.B."] ?? "");
  const lastTen = String(teamRecord.L10 ?? teamRecord["Last 10"] ?? "").trim();
  const streak = String(teamRecord.Strk ?? teamRecord.STRK ?? "").trim();
  const division = simplifyMattDivisionLabel(teamRecord.divisionLabel ?? teamRecord.Division ?? "");
  const pct = wins + losses > 0 ? wins / (wins + losses) : 0;
  const success = pct >= 0.5 || gamesBack <= 3;

  return {
    headline: success
      ? `Matt Gropius: Why ${teamName} Are Giving People a Problem`
      : seasonMode === "EARLY_SEASON"
        ? `Matt Gropius: What ${teamName} Need to Fix Before This Start Hardens`
        : `Matt Gropius: What ${teamName} Need to Fix Before Summer Gets Away`,
    body: success
      ? buildMattSuccessExplanation(teamName, division, lastTen, streak, teamHistory, mattLore, seasonMode)
      : buildMattStruggleExplanation(teamName, division, lastTen, streak, teamHistory, mattLore, seasonMode),
    topicKey: `matt:team:${teamName.toLowerCase()}`,
    targetKey: `team:${teamName}`,
  };
}

function buildMattSuccessExplanation(teamName, division, lastTen, streak, teamHistory, mattLore, seasonMode = "") {
  const legacy = teamHistory ? summarizeTeamLegacy(teamName) : "";
  const firstParagraph = `I have been on enough winning clubs to know the difference between a team that is simply hot and a team that is starting to trust itself. ${teamName} look like the second kind to me. When a club is doing well, people rush to the stars, and sometimes that is fair, but the thing I notice first is rhythm. Good teams stop wasting innings. They make a series feel heavy by the middle of the second game. ${division ? `${teamName} are doing that in ${division}.` : `${teamName} are doing that right now.`}`;
  const secondParagraph = `When I was playing, especially around ${mattLore.championshipMvpYear}, the clubs that lasted were the ones that kept giving you competent baseball even on ordinary nights. ${buildMattTrendSentence(lastTen, streak, "success", null, seasonMode)}${legacy ? ` ${teamName} carry ${legacy}, and organizations with memory usually recognize a good rhythm early.` : ""}`;
  const thirdParagraph = `That is why I would explain their success with something simple: they are making the game smaller for themselves and bigger for everyone else. Opponents are being asked to play clean baseball for too long, and most clubs cannot do it. That is the kind of success players respect, because it tends to travel.`;
  return `${firstParagraph}\n\n${secondParagraph}\n\n${thirdParagraph}`;
}

function buildMattStruggleExplanation(teamName, division, lastTen, streak, teamHistory, mattLore, seasonMode = "") {
  const legacy = teamHistory ? summarizeTeamLegacy(teamName) : "";
  const firstParagraph = `I do not enjoy piling on clubs that are fighting it, because I have been in those rooms too, and everybody already knows when the baseball is thin. ${teamName} are not in a spot where they can keep calling this bad luck. ${division ? `The table in ${division} is already honest about that.` : "The standings are already honest about that."} If a team is losing ground, there is always a baseball reason before there is a dramatic reason.`;
  const secondParagraph = `The first thing I would look at is whether they are playing too many loose innings. ${buildMattTrendSentence(lastTen, streak, "struggle", null, seasonMode)} I remember seasons like that from my own career, and the fix was never a speech. The fix was cleaner pitching, firmer at-bats with men on base, and a little less generosity in the field.${legacy ? ` A club with ${legacy} in its history ought to know the standard already.` : ""}`;
  const thirdParagraph = `If I were in that clubhouse, I would tell them to stop waiting for a savior week. Tighten the rotation of mistakes. Win the middle innings again. Make the next two weeks about sound baseball instead of mood. That is how teams improve. They stop asking for rescue and start making life harder on the other dugout.`;
  return `${firstParagraph}\n\n${secondParagraph}\n\n${thirdParagraph}`;
}

function buildMattTeamCandidateVaried(snapshot, teamRecord, mattLore) {
  const teamName = String(teamRecord?.Team ?? "").trim();
  if (!teamName) {
    return null;
  }

  const teamHistory = findTeamHistory(teamName);
  const wins = Number.parseInt(teamRecord.W ?? teamRecord.Wins ?? "", 10) || 0;
  const losses = Number.parseInt(teamRecord.L ?? teamRecord.Losses ?? "", 10) || 0;
  const gamesBack = parseGamesBackValue(teamRecord.GB ?? teamRecord["G.B."] ?? "");
  const lastTen = String(teamRecord.L10 ?? teamRecord["Last 10"] ?? "").trim();
  const streak = String(teamRecord.Strk ?? teamRecord.STRK ?? "").trim();
  const division = simplifyMattDivisionLabel(teamRecord.divisionLabel ?? teamRecord.Division ?? "");
  const pct = wins + losses > 0 ? wins / (wins + losses) : 0;
  const success = pct >= 0.5 || gamesBack <= 3;
  const variants = success
    ? buildMattSuccessVariants(teamName, division, lastTen, streak, teamHistory, mattLore, snapshot)
    : buildMattStruggleVariants(teamName, division, lastTen, streak, teamHistory, mattLore, snapshot);
  const selectedVariant = selectMattVariant(snapshot, teamName, success ? "success" : "struggle", variants);

  if (!selectedVariant) {
    return buildMattTeamCandidate(teamRecord, mattLore);
  }

  return {
    headline: selectedVariant.headline,
    body: selectedVariant.body,
    topicKey: `matt:team:${teamName.toLowerCase()}:${selectedVariant.key}`,
    targetKey: `team:${teamName}`,
  };
}

function buildMattSuccessVariants(teamName, division, lastTen, streak, teamHistory, mattLore, snapshot) {
  const seasonMode = getMattSeasonMode(snapshot);
  const legacy = teamHistory ? summarizeTeamLegacy(teamName) : "";
  const context = buildMattContext(snapshot, teamName);
  const remainingGames = buildMattRemainingGames(context?.standing);
  const trendSentence = buildMattTrendSentence(lastTen, streak, "success", remainingGames, seasonMode);
  const legacySentence = legacy ? ` ${teamName} also carry ${legacy}, and organizations that know what a serious summer feels like usually recognize one early.` : "";
  const evidenceLine = buildMattEvidenceLine(context, "success");
  const heatLine = buildMattHotColdLine(context);

  return [
    {
      key: "schedule-fear",
      headline: `Matt Gropius: ${teamName} Are Becoming the Series Nobody Wants`,
      body: `Some teams make the standings look pretty. Other teams make the schedule feel annoying. ${teamName} are in the second category, and that is a compliment where I come from. ${division ? `You can feel it in ${division}.` : "You can feel it right now."} ${context.identityLine}

When I was playing, especially around ${mattLore.championshipMvpYear}, the clubs that lasted were the ones that kept making you play every inch of the game. No lazy innings. No soft landings for your starter. No relief appearance where you could sneak through on fumes. ${trendSentence}${legacySentence}

${evidenceLine} ${heatLine} ${context.injuryLine} That is why I do not file this under cute. I file it under dangerous. Players know the difference, and the other dugout usually knows it too.`,
    },
    {
      key: "clubhouse-weather",
      headline: `Matt Gropius: ${teamName} Have the Right Kind of Weather Around Them`,
      body: `You spend enough years in clubhouses and you start to notice the weather before you notice the stat line. A good team has a certain calm to it. Guys move like tomorrow is already handled. The jokes land. The mistakes do not spread. ${teamName} have some of that about them now.

I remember that feeling from my own better clubs, especially the one that carried me to the championship MVP in ${mattLore.championshipMvpYear}. We were not loud every day. We were just reliable in boring ways, and boring is a beautiful word in a winning room. ${trendSentence} ${context.identityLine}

${evidenceLine} ${context.injuryLine} ${legacy ? `The history matters too. ${teamName} carry ${legacy}, and franchises with memory tend to recognize the smell of a real season.` : "The best part is that this does not feel borrowed. It feels earned."} That is the state of the game as I see it: some teams are simply playing with cleaner emotional geometry than everybody else.`,
    },
    {
      key: "hard-problem",
      headline: `Matt Gropius: ${teamName} Are Solving the Same Hard Problem Every Night`,
      body: `The older I get, the less I care about whether a contender is dazzling me and the more I care about whether it is solving the same hard problem over and over. Can you make a nine-inning game feel long for the other side? Can you survive the sleepy innings? Can you keep your shape when nothing exciting is happening? ${teamName} keep answering yes.

That is how good clubs travel. That is how they survive the flat Tuesday in a half-full park. That is how they wind up in first before people realize how it happened. ${trendSentence}${legacySentence}

${evidenceLine} ${context.identityLine} If you want my ex-player translation, it is simple: they are not hoping the game comes to them. They are making the game answer to them, and that is usually how summers turn serious.`,
    },
    {
      key: "shape-of-roster",
      headline: `Matt Gropius: ${teamName} Look Built for the Longer Argument`,
      body: `The easiest mistake in a good stretch is to describe only the mood. I would rather describe the build. ${teamName} do not just feel hot. They look put together in a way that survives a bad hop, a quiet night from the star, or a series that refuses to get pretty. ${division ? `That matters in ${division}.` : "That matters in any real race."}

${evidenceLine} ${heatLine} ${trendSentence}

That is the difference between a team catching a week and a team building a season. ${legacy ? `${teamName} carry ${legacy}, and clubs with that kind of memory usually understand which habits travel.` : "Serious teams make you beat several parts of the roster, not just one."} Right now ${teamName} look like more than a passing hot hand.`,
    },
  ];
}

function buildMattStruggleVariants(teamName, division, lastTen, streak, teamHistory, mattLore, snapshot) {
  const seasonMode = getMattSeasonMode(snapshot);
  const legacy = teamHistory ? summarizeTeamLegacy(teamName) : "";
  const context = buildMattContext(snapshot, teamName);
  const remainingGames = buildMattRemainingGames(context?.standing);
  const trendSentence = buildMattTrendSentence(lastTen, streak, "struggle", remainingGames, seasonMode);
  const evidenceLine = buildMattEvidenceLine(context, "struggle");
  const heatLine = buildMattHotColdLine(context);
  const outlookLine = buildMattStruggleOutlook(context, seasonMode);

  return [
    {
      key: "stop-waiting",
      headline: `Matt Gropius: ${teamName} Have to Stop Waiting for a Rescue Week`,
      body: `${teamName} are past the point where a rough patch can be described as random noise. ${division ? `The table in ${division} is already beginning to sort teams by what they really are.` : "The standings are already beginning to sort teams by what they really are."} ${outlookLine}

${evidenceLine} ${context.injuryLine} ${trendSentence}

${heatLine} ${legacy ? `A club with ${legacy} in the background should be able to diagnose this more clearly than it has.` : "The standard does not need to be invented; it needs to be met."} The fix is not a miracle week. It is turning one vague weakness into a specific correction and then repeating it every night.`,
    },
    {
      key: "middle-innings",
      headline: `Matt Gropius: ${teamName} Are Losing the Middle of the Game`,
      body: `A lot of bad baseball hides in the middle innings because that is where structure gets tested. ${teamName} feel like one of those clubs right now, the kind of team that stays close enough for a while and then loses control of the game's texture.

When I see a team stuck in place, I look for the soft spots between the big moments. Is the bullpen inheriting too much traffic? Are the at-bats after a scoring chance getting thin? Is the defense extending innings that should already be dead? ${lastTen ? `A ${lastTen} stretch over the last ten is often the scoreboard version of those little failures.` : "The last stretch looks like the scoreboard version of those little failures."}${streak ? ` ${streak} sharpens that point.` : ""} ${evidenceLine}

${heatLine} ${context.injuryLine} ${legacy ? `And because ${teamName} carry ${legacy}, I am less patient with fuzzy excuses than I would be for a club with no memory at all.` : "This is not a mystery. It is a craft and depth issue."} Win the middle of the game again and the standings will start looking less punitive.`,
    },
    {
      key: "clarity",
      headline: `Matt Gropius: ${teamName} Need Clarity Before Summer Starts Asking Questions`,
      body: `There is a stage of a season when a club can still tell itself it is gathering information. Then there is the stage where the season starts demanding an opinion. ${teamName} are moving into the second stage. ${division ? `That is especially true in ${division}.` : "That is true in this race."} ${outlookLine}

${context.identityLine} ${evidenceLine} ${lastTen ? `A ${lastTen} run over the last ten is not a verdict, but it is enough to require honesty.` : "The recent stretch is enough to require honesty."}${streak ? ` ${streak} is part of the evidence, not a distraction from it.` : ""} ${context.injuryLine}

If you are trying to model the path forward, the first question is simple: what does this team do well enough to scare anybody? Rotation? Bullpen? Top of the order? Defense? If the answer is still vague by now, that is the problem. ${legacy ? `A franchise with ${legacy} in the scrapbook should know better than to drift.` : "Good teams improve by identifying their edge and feeding it."} Right now ${teamName} look like a team that needs a sharper opinion about itself.`,
    },
    {
      key: "thin-margin",
      headline: `Matt Gropius: ${teamName} Are Playing Baseball with Too Little Margin`,
      body: `The problem with a shaky club is not always that it is terrible. Sometimes it is that it is living with no cushion at all. One missed cutoff. One silent night from the middle of the order. One starter who gets through five instead of seven. Then the whole thing tips. ${teamName} feel like that kind of team right now. ${outlookLine}

${evidenceLine} ${heatLine} ${trendSentence}

That is why I do not like lazy explanations for them. ${legacy ? `${teamName} have ${legacy} in the background, so the standards should be sharper than this.` : "This is not a curse. It is a roster and execution problem."} If they want the summer to change, they need to start creating margin instead of spending every night without any.`,
    },
  ];
}

function buildMattContext(snapshot, teamName) {
  const evidence = collectMattTeamEvidence(snapshot, teamName);
  const standing = findStandingsTeam(snapshot, teamName);
  const gamesBackText = cleanColumnText(standing?.gb ?? standing?.GB ?? "");
  const gamesBackValue = parseGamesBackValue(gamesBackText);
  const wins = cleanColumnText(standing?.wins ?? standing?.W ?? "");
  const losses = cleanColumnText(standing?.losses ?? standing?.L ?? "");
  const section = cleanColumnText(standing?.sectionLabel ?? standing?.section ?? "");
  const place = cleanColumnText(standing?.place ?? "");
  const injuryCount = (snapshot.injuries ?? []).filter((item) => normalizeMattText(item.team).includes(normalizeMattText(teamName))).length;
  const standingBits = [
    wins || losses ? `${teamName} are ${wins || "0"}-${losses || "0"}` : `${teamName} are still trying to define the season`,
    place ? `${place.toLowerCase()}` : "",
    section ? `in ${section.toLowerCase()}` : "",
    gamesBackText && gamesBackText !== "-" ? `${gamesBackText} back` : "",
  ].filter(Boolean);
  const raceLine = gamesBackText && gamesBackText !== "-"
    ? `${teamName} are ${gamesBackText} back${section ? ` in ${section.toLowerCase()}` : ""}, so every good week changes the shape of the hunt.`
    : `${teamName} are playing in the part of the table where every series changes the weather.`;
  const totalGames = Number.parseInt(wins || "", 10) + Number.parseInt(losses || "", 10);
  const isSuccessfulTeam = totalGames > 0
    ? (Number.parseInt(wins || "0", 10) / totalGames) >= 0.5 || gamesBackValue <= 3
    : gamesBackValue <= 3;
  const injuryLine = injuryCount > 0
    ? isSuccessfulTeam
      ? `I especially pay attention when a team is doing this while carrying ${injuryCount} active injury${injuryCount === 1 ? "" : "ies"}, because that usually means the room is sturdier than people realize.`
      : `${injuryCount} active injury${injuryCount === 1 ? "" : "ies"} are part of the drag too, and clubs in a slide rarely survive that kind of strain unless the healthy players start carrying cleaner innings.`
    : isSuccessfulTeam
      ? "I am not reaching for easy excuses here, and that matters."
      : "I am not reaching for easy excuses here, and that matters because the healthier clubs do not get to hide from thin baseball.";

  return {
    standing,
    identityLine: evidence.identityLine,
    proofLine: evidence.proofLine,
    concernLine: evidence.concernLine,
    injuryLine,
    hotEntries: evidence.hotEntries,
    coldEntries: evidence.coldEntries,
    hotDetail: evidence.hotDetail,
    coldDetail: evidence.coldDetail,
    managerName: "",
    standingLine: `${standingBits.join(" ")}.`,
    raceLine,
    gamesBackValue,
    remainingGames: buildMattRemainingGames(standing),
    isSuccessfulTeam,
    isDivisionLeader: /^1st$/i.test(place),
  };
}

function collectMattTeamEvidence(snapshot, teamName) {
  const battingHits = collectMattLeaderboardEntries(snapshot.battingLeaderboards, teamName, "positive");
  const pitchingHits = collectMattLeaderboardEntries(snapshot.pitchingLeaderboards, teamName, "positive");
  const coldBattingHits = collectMattLeaderboardEntries(snapshot.battingLeaderboards, teamName, "negative");
  const coldPitchingHits = collectMattLeaderboardEntries(snapshot.pitchingLeaderboards, teamName, "negative");
  const teamPageEvidence = readMattTeamPageEvidence(teamName);
  const totalHits = battingHits.length + pitchingHits.length;
  const bestBat = battingHits[0] ?? null;
  const bestPitch = pitchingHits[0] ?? null;
  const coldEntries = dedupeMattEntries([...teamPageEvidence.coldEntries, ...coldBattingHits, ...coldPitchingHits]).slice(0, 3);
  const hotEntries = dedupeMattEntries([...teamPageEvidence.hotEntries, ...battingHits, ...pitchingHits]).slice(0, 3);
  const coldSummary = buildMattEntrySummary(coldEntries, "cold");
  const hotSummary = buildMattEntrySummary(hotEntries, "hot");

  if (battingHits.length && pitchingHits.length) {
    return {
      identityLine: `${teamName} are showing up on both sides of the stat page, which is usually how real teams announce themselves.`,
      proofLine: `${teamName} already have ${totalHits} leaderboard placements worth noticing, led by ${formatMattLeaderboardEntry(bestBat)} and ${formatMattLeaderboardEntry(bestPitch)}. That is balance, not decoration.`,
      concernLine: `${teamName} are getting something from both sides of the ledger, but not enough of it. ${formatMattLeaderboardEntry(bestBat)} and ${formatMattLeaderboardEntry(bestPitch)} tell you there is talent here, yet the rest of the shape still feels too thin.`,
      hotEntries,
      coldEntries,
      hotDetail: hotSummary || `${formatMattLeaderboardEntry(bestBat)} and ${formatMattLeaderboardEntry(bestPitch)} give the club two clean ways to hurt you.`,
      coldDetail: coldSummary || (coldEntries.length ? `The trouble spots are showing up in ${joinWithCommasAndAnd(coldEntries.map((entry) => entry.label.toLowerCase()))}.` : ""),
    };
  }

  if (battingHits.length) {
    return {
      identityLine: `${teamName} look like a club whose clearest answers are in the lineup, not on the whiteboard.`,
      proofLine: `${formatMattLeaderboardEntry(bestBat)} tells you exactly where the pressure starts. When one club keeps putting bats on the leaderboard, pitchers feel it before the standings say it out loud.`,
      concernLine: `${formatMattLeaderboardEntry(bestBat)} is useful, but a single bright bat is not enough to carry a whole club. That kind of imbalance is how teams stay stuck in the middle of the pack.`,
      hotEntries,
      coldEntries,
      hotDetail: hotSummary || `${formatMattLeaderboardEntry(bestBat)} is the offensive clue that tells you where this team's best pressure comes from.`,
      coldDetail: coldSummary || (coldEntries.length ? `The part that keeps it from becoming a complete team shows up in ${joinWithCommasAndAnd(coldEntries.map((entry) => entry.label.toLowerCase()))}.` : ""),
    };
  }

  if (pitchingHits.length) {
    return {
      identityLine: `${teamName} look like a club whose cleanest baseball begins on the mound.`,
      proofLine: `${formatMattLeaderboardEntry(bestPitch)} is the sort of evidence players believe in. When the arms are doing that kind of work, the rest of the team gets to breathe easier.`,
      concernLine: `${formatMattLeaderboardEntry(bestPitch)} says there is a backbone here, but one sturdy arm group cannot keep covering every weakness around it.`,
      hotEntries,
      coldEntries,
      hotDetail: hotSummary || `${formatMattLeaderboardEntry(bestPitch)} is the kind of pitching signal that can support a real run when the rest of the roster joins in.`,
      coldDetail: coldSummary || (coldEntries.length ? `The leakage is still visible in ${joinWithCommasAndAnd(coldEntries.map((entry) => entry.label.toLowerCase()))}.` : ""),
    };
  }

  return {
    identityLine: `${teamName} are not getting much free reputation from the leaderboard page, which means they have to build belief the slow way.`,
    proofLine: `${teamName} may not own a flashy leaderboard footprint right now, but that can also mean the club is winning through steadiness instead of one loud trick.`,
    concernLine: `${teamName} are not showing up enough on the leaderboard page, and that usually means too few players are bending the season in their favor.`,
    hotEntries,
    coldEntries,
    hotDetail: hotSummary,
    coldDetail: coldSummary,
  };
}

let mattTeamPageEvidenceCache = null;

function readMattTeamPageEvidence(teamName) {
  if (!mattTeamPageEvidenceCache) {
    mattTeamPageEvidenceCache = buildMattTeamPageEvidenceCache();
  }
  return mattTeamPageEvidenceCache.get(normalizeMattText(teamName)) ?? { hotEntries: [], coldEntries: [] };
}

function buildMattTeamPageEvidenceCache() {
  const cache = new Map();
  const teamsDir = path.resolve(process.cwd(), "News", "teams");
  if (!fs.existsSync(teamsDir)) {
    return cache;
  }

  const fileNames = fs.readdirSync(teamsDir).filter((fileName) => /^team_\d+\.html$/i.test(fileName));
  for (const fileName of fileNames) {
    let rawHtml = "";
    try {
      rawHtml = fs.readFileSync(path.join(teamsDir, fileName), "utf8");
    } catch {
      rawHtml = "";
    }
    if (!rawHtml) {
      continue;
    }
    const teamName = cleanColumnText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    if (!teamName) {
      continue;
    }

    const trendTables = [...String(rawHtml).matchAll(/<tr><th class="boxtitle">(WHO'S HOT\?|WHO'S NOT\?)<\/th><\/tr>\s*<\/table>\s*<table cellspacing="0" cellpadding="0" class="data sortable" width="32[78]px">([\s\S]*?)<\/table>/gi)];
    const hotEntries = [];
    const coldEntries = [];
    for (const match of trendTables) {
      const label = cleanColumnText(match[1]);
      const tableHtml = String(match[2] ?? "");
      const entries = [...tableHtml.matchAll(/<tr[^>]*>\s*<td>([^<]*)<\/td>\s*<td><a [^>]*>([^<]+)<\/a><\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/gi)]
        .map((rowMatch) => ({
          label: cleanColumnText(rowMatch[1]) || (/\bP\b/i.test(cleanColumnText(rowMatch[1])) ? "Pitching" : "Form"),
          player: buildPlainPlayerName(cleanColumnText(rowMatch[2])),
          team: teamName,
          value: cleanColumnText(rowMatch[3]),
          span: cleanColumnText(rowMatch[4]),
          source: /NOT/i.test(label) ? "team-cold" : "team-hot",
        }));
      if (/NOT/i.test(label)) {
        coldEntries.push(...entries);
      } else {
        hotEntries.push(...entries);
      }
    }

    cache.set(normalizeMattText(teamName), {
      hotEntries: dedupeMattEntries(hotEntries).slice(0, 3),
      coldEntries: dedupeMattEntries(coldEntries).slice(0, 3),
    });
  }

  return cache;
}

function dedupeMattEntries(entries = []) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = `${normalizeMattText(entry.player)}::${normalizeMattText(entry.label)}::${cleanColumnText(entry.value)}`;
    if (!entry.player || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function buildMattEntrySummary(entries = [], mode = "hot") {
  if (!entries.length) {
    return "";
  }
  const formatted = entries.slice(0, 3).map((entry) => formatMattTrendEntry(entry));
  if (!formatted.length) {
    return "";
  }
  return mode === "cold"
    ? `The colder part of the roster is easy to spot: ${joinWithCommasAndAnd(formatted)}.`
    : `The hotter part of the roster is easy to spot: ${joinWithCommasAndAnd(formatted)}.`;
}

function formatMattTrendEntry(entry) {
  if (!entry) {
    return "";
  }
  const player = cleanColumnText(entry.player);
  const label = cleanColumnText(entry.label);
  const value = cleanColumnText(entry.value);
  const span = cleanColumnText(entry.span);
  const metricText = formatMattTrendMetric(label, value);
  if (value && span) {
    return `${player} (${metricText || value} over ${span.toLowerCase()})`;
  }
  if (metricText) {
    return `${player} (${metricText})`;
  }
  if (value) {
    return `${player} (${value})`;
  }
  return player;
}

function formatMattTrendMetric(label, value) {
  const cleanLabel = cleanColumnText(label);
  const cleanValue = cleanColumnText(value);
  if (!cleanValue) {
    return "";
  }
  if (!cleanLabel) {
    return cleanValue;
  }

  const normalized = cleanLabel.toLowerCase();
  if (["p", "sp", "rp", "cl", "c", "1b", "2b", "3b", "ss", "lf", "cf", "rf", "dh"].includes(normalized)) {
    return cleanValue;
  }
  if (normalized === "avg") {
    return `${cleanValue} batting average`;
  }
  if (normalized === "ops") {
    return `${cleanValue} OPS`;
  }
  if (normalized === "obp") {
    return `${cleanValue} OBP`;
  }
  if (normalized === "slg") {
    return `${cleanValue} SLG`;
  }
  if (normalized === "hr") {
    return `${cleanValue} home runs`;
  }
  if (normalized === "rbi") {
    return `${cleanValue} RBI`;
  }
  if (normalized === "sb") {
    return `${cleanValue} stolen bases`;
  }
  if (normalized === "era") {
    return `${cleanValue} ERA`;
  }
  if (normalized === "whip") {
    return `${cleanValue} WHIP`;
  }
  if (normalized === "k") {
    return `${cleanValue} strikeouts`;
  }
  if (normalized === "sv") {
    return `${cleanValue} saves`;
  }
  if (normalized === "w") {
    return `${cleanValue} wins`;
  }

  return `${cleanValue} ${cleanLabel}`;
}

function collectMattLeaderboardEntries(groups, teamName, mode = "all") {
  const entries = [];
  for (const group of groups ?? []) {
    if (mode === "positive" && isNegativeMattCategory(group.label)) {
      continue;
    }
    if (mode === "negative" && !isNegativeMattCategory(group.label)) {
      continue;
    }
    if (isWeakMattCategory(group.label)) {
      continue;
    }
    for (const entry of group.entries ?? []) {
      const expandedTeam = expandTeamLabel(entry.team);
      if (normalizeMattText(expandedTeam) !== normalizeMattText(teamName)) {
        continue;
      }
      entries.push({
        label: group.label,
        player: resolvePlayerName(entry.player, entry.team),
        team: expandedTeam,
        value: entry.value,
      });
    }
  }

  return entries
    .sort((left, right) => scoreMattLeaderboardPriority(left.label) - scoreMattLeaderboardPriority(right.label) || left.player.localeCompare(right.player))
    .slice(0, 3);
}

function isNegativeMattCategory(label) {
  const text = String(label ?? "").toLowerCase();
  return /home runs allowed|losses|opponents|allowed|bases on balls|bb\/9|hits allowed/.test(text);
}

function isWeakMattCategory(label) {
  const text = String(label ?? "").toLowerCase();
  return /games pitched|complete games/.test(text);
}

function formatMattLeaderboardEntry(entry) {
  if (!entry) {
    return "";
  }
  return `${entry.player} sitting near the top in ${entry.label} at ${entry.value}`;
}

function scoreMattLeaderboardPriority(label) {
  const text = String(label ?? "").toLowerCase();
  if (/war|ops|whip|era/.test(text)) {
    return 1;
  }
  if (/home runs|runs batted in|wins|strikeouts/.test(text)) {
    return 2;
  }
  if (/avg|obp|slugging|innings/.test(text)) {
    return 3;
  }
  return 4;
}

function buildMattTrendSentence(lastTen, streak, mode, remainingGames = null, seasonMode = "") {
  const normalized = String(lastTen ?? "").trim();
  const streakText = String(streak ?? "").trim();
  const parsed = normalized.match(/^(\d+)-(\d+)$/);
  const wins = parsed ? Number.parseInt(parsed[1], 10) : null;
  const losses = parsed ? Number.parseInt(parsed[2], 10) : null;
  const streakPhrase = buildMattReadableStreakPhrase(streakText);
  const streakType = /^[Ww]/.test(streakText) ? "win" : /^[Ll]/.test(streakText) ? "loss" : "";

  if (mode === "success") {
    if (wins !== null && losses !== null) {
      if (wins >= 6) {
        if (seasonMode === "EARLY_SEASON") {
          return `A ${normalized} stretch over the last ten tells me the club is putting together the kind of first impression managers dream about${streakPhrase && streakType === "win" ? `, and ${streakPhrase} fits that picture too` : ""}.`;
        }
        return `A ${normalized} stretch over the last ten tells me the floor is holding${streakPhrase && streakType === "win" ? `, and ${streakPhrase} fits that picture too` : ""}.`;
      }
      if (wins <= 4) {
        if (seasonMode === "MIDDLE_SEASON") {
          return `Even with a ${normalized} slide over the last ten${streakPhrase && streakType === "loss" ? ` and ${streakPhrase} hanging over them` : ""}, they still look like a club with enough time to steady itself.`;
        }
        return `Even with a ${normalized} slide over the last ten${streakPhrase && streakType === "loss" ? ` and ${streakPhrase} hanging over them` : ""}, they still look sturdier than the mood around them.`;
      }
      if (remainingGames !== null && remainingGames > 0) {
        if (seasonMode === "EARLY_SEASON") {
          return `A ${normalized} run over the last ten says the start has not been perfect, but it is early enough that a good club can learn from that without flinching.`;
        }
        return `A ${normalized} run over the last ten says this club has not been perfect. But with ${remainingGames} games left on the schedule, there is no reason for a good team to panic.`;
      }
      return `A ${normalized} run over the last ten says this club has not been perfect, but it still looks composed in the ways that matter.`;
    }

    return streakPhrase && streakType === "win"
      ? `The club has not been spotless lately, but ${streakPhrase} tells you the room still believes in what it is doing.`
      : "The club has not been spotless lately, but it still looks composed in the ways that matter.";
  }

  if (wins !== null && losses !== null) {
    if (seasonMode === "MIDDLE_SEASON") {
      return `A ${normalized} mark over the last ten usually means too many ordinary moments are being lost${streakPhrase && streakType === "loss" ? `, and ${streakPhrase} only underlines it` : ""}, but there is still enough time for a club to correct that if it moves now.`;
    }
    if (seasonMode === "EARLY_SEASON") {
      return `A ${normalized} mark over the last ten usually means too many ordinary moments are being lost${streakPhrase && streakType === "loss" ? `, and ${streakPhrase} only underlines it` : ""}. That is how bad starts take shape.`;
    }
    return `A ${normalized} mark over the last ten usually means too many ordinary moments are being lost${streakPhrase && streakType === "loss" ? `, and ${streakPhrase} only underlines it` : ""}.`;
  }

  return streakPhrase && streakType === "loss"
    ? `The recent shape says too many ordinary moments are being lost, and ${streakPhrase} only underlines it.`
    : "The recent shape says too many ordinary moments are being lost.";
}

function inferMattModeFromRecord(teamRecord) {
  const wins = Number.parseInt(teamRecord?.W ?? teamRecord?.Wins ?? "", 10);
  const losses = Number.parseInt(teamRecord?.L ?? teamRecord?.Losses ?? "", 10);
  const gamesPlayed = (Number.isFinite(wins) ? wins : 0) + (Number.isFinite(losses) ? losses : 0);
  if (gamesPlayed <= 0) {
    return "";
  }
  if (gamesPlayed < 20) {
    return "EARLY_SEASON";
  }
  if (gamesPlayed < 55) {
    return "MIDDLE_SEASON";
  }
  return "LATE_SEASON";
}

function buildMattReadableStreakPhrase(streakText) {
  const parsed = String(streakText ?? "").trim().match(/^([WwLl])(\d+)$/);
  if (!parsed) {
    return "";
  }

  const count = Number.parseInt(parsed[2], 10);
  if (!Number.isFinite(count) || count < 3) {
    return "";
  }

  return parsed[1].toLowerCase() === "w"
    ? `they have won ${count} in a row`
    : `they have lost ${count} in a row`;
}

function buildMattRemainingGames(standing) {
  const wins = Number.parseInt(standing?.wins ?? standing?.W ?? "", 10);
  const losses = Number.parseInt(standing?.losses ?? standing?.L ?? "", 10);
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) {
    return null;
  }

  const remaining = 92 - wins - losses;
  return remaining >= 0 ? remaining : null;
}

function buildMattStreakBody(snapshot, teamName, context, streakInfo, lastTenInfo, seasonMode, signalKey) {
  const signalIsPositive = streakInfo?.type === "win" || (lastTenInfo?.wins ?? 0) >= 7;
  const signalContext = signalIsPositive ? context : { ...context, isSuccessfulTeam: false };
  const intro = buildMattIntroParagraph(teamName, signalContext, streakInfo, lastTenInfo, seasonMode);
  const chase = buildMattPlayoffChaseLine(signalContext, streakInfo, lastTenInfo, seasonMode);
  const roster = buildMattHotColdLine(signalContext);
  const evidence = buildMattEvidenceLine(signalContext, signalIsPositive ? "success" : "struggle");
  const pressure = buildMattManagerPressureLine(signalContext, streakInfo, lastTenInfo, seasonMode);
  const meaning = buildMattMeaningLine(signalContext, streakInfo, lastTenInfo, seasonMode);
  const outlook = !signalIsPositive ? buildMattStruggleOutlook(signalContext, seasonMode) : "";
  const evidenceUsesRosterFallback = !signalIsPositive && !signalContext.coldDetail && (signalContext.coldEntries?.length ?? 0) > 0;
  const variants = (signalIsPositive
    ? [
        [intro, [chase, roster].filter(Boolean).join(" "), meaning],
        [intro, [evidence, chase].filter(Boolean).join(" "), [roster, meaning].filter(Boolean).join(" ")],
        [[intro, roster].filter(Boolean).join(" "), [evidence, chase].filter(Boolean).join(" "), meaning],
        [intro, evidence, meaning],
      ]
    : [
        [intro, [outlook, evidence].filter(Boolean).join(" "), [pressure, meaning].filter(Boolean).join(" ")],
        [intro, [chase, roster].filter(Boolean).join(" "), [evidenceUsesRosterFallback ? pressure : [pressure, evidence].filter(Boolean).join(" "), meaning].filter(Boolean).join(" ")],
        [[intro, outlook].filter(Boolean).join(" "), [evidence, chase].filter(Boolean).join(" "), meaning],
        [intro, evidence, [pressure, meaning].filter(Boolean).join(" ")],
      ])
    .map((parts, index) => ({
    key: `shape-${index}`,
    body: parts.filter(Boolean).join("\n\n"),
  }));
  return (selectMattVariant(snapshot, teamName, `streak:${signalKey}`, variants) ?? variants[0]).body;
}

function buildMattEvidenceLine(context, mode = "success") {
  if (mode === "success") {
    if (context.hotDetail) {
      return `${context.proofLine} ${context.hotDetail}`;
    }
    return context.proofLine;
  }

  if (context.coldDetail) {
    return `${context.concernLine} ${context.coldDetail}`;
  }
  if (context.coldEntries?.length) {
    return `The stat page is not offering many soft excuses either. ${buildMattHotColdLine(context)}`;
  }
  return "The stat page is not offering many soft excuses either. Too few players are forcing the season in the right direction.";
}

function buildMattStruggleOutlook(context, seasonMode = "") {
  const remaining = Number.isFinite(context?.remainingGames) ? context.remainingGames : null;
  const gamesBack = Number.isFinite(context?.gamesBackValue) ? context.gamesBackValue : null;

  if (seasonMode === "EARLY_SEASON") {
    if (gamesBack !== null && gamesBack > 0) {
      return `The gap is still small enough to repair, but the cost of a bad week is already visible at ${gamesBack} back.`;
    }
    return "It is early enough to recover, but not so early that the standings are meaningless.";
  }

  if (seasonMode === "MIDDLE_SEASON") {
    if (gamesBack !== null && remaining !== null) {
      return `${gamesBack} back with ${remaining} games left is manageable only if the team can identify one reliable strength and start leaning on it.`;
    }
    return "There is still time for a correction, but only if the team can identify one reliable strength and start leaning on it.";
  }

  if (gamesBack !== null && remaining !== null) {
    return `${gamesBack} back with ${remaining} games left is the kind of math that turns ordinary sloppiness into real damage.`;
  }
  if (gamesBack !== null) {
    return `${gamesBack} back is the kind of standing that punishes any team that keeps playing vague baseball.`;
  }
  return "The standings are no longer abstract enough to hide behind.";
}

function selectMattVariant(snapshot, teamName, mode, variants) {
  if (!variants?.length) {
    return null;
  }
  const dateSeed = String(snapshot?.leagueDateLabel ?? snapshot?.frontPageDateLabel ?? snapshot?.debugDate ?? new Date().toISOString().slice(0, 10));
  const index = pickStableIndexForColumns(`matt-variant:${dateSeed}:${mode}:${teamName}`, variants.length);
  return variants[index] ?? variants[0];
}

function parseGamesBackValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || /^e$/i.test(text)) {
    return 0;
  }
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 99;
}

function simplifyMattDivisionLabel(value) {
  return String(value ?? "")
    .replace(/^CONFERENCE\s+[A-Z]+\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMattCandidateOrder(targetKey) {
  const seed = `${new Date().toISOString().slice(0, 10)}::${targetKey}`;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 33 + char.charCodeAt(0)) % 2147483647;
  }
  return Math.abs(hash);
}

function normalizeMattText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickDarrenHistoryTopic(snapshot, previousColumn, usedTargets) {
  const candidates = [];
  const standingsLeader = snapshot.standings?.[0]?.Team;
  if (standingsLeader) {
    const teamHistory = findTeamHistory(standingsLeader);
    if (teamHistory) {
      candidates.push({
        headline: `Darren Kline: ${standingsLeader} and the Weight of the Sample`,
        body: `${standingsLeader} sit on top of the table, and I do not think that should be treated like a passing mood. The historical sheet matters here because it gives the current standing a sample larger than the last ten games. ${standingsLeader} have been in the league since ${teamHistory.firstYear}, and they already own ${summarizeTeamLegacy(standingsLeader)}.

That kind of organizational history does not guarantee anything, but it does change the burden of proof. When a club with a record of competence is also running first in the present day, I become much less interested in fluke talk. What looks sudden from week to week can look entirely logical when you widen the frame.

This is one of the blind spots numbers can fix if you let them. Fans love momentum because it feels dramatic. Sample size is less theatrical, but it usually tells the truth sooner. And right now the truth is that ${standingsLeader} look less like a surprise than like a franchise doing what it has often done before.`,
        topicKey: `darren:history-team:${standingsLeader}`,
        targetKey: `team:${standingsLeader}`,
      });
    }
  }

  const archivePlayer = snapshot.historyNotes?.find((note) => /Archive Note/i.test(note.kicker));
  const ted = findPlayerHistory("Ted Ulysse");
  if (archivePlayer && ted) {
    candidates.push({
      headline: "Darren Kline: Ted Ulysse and the Shape of a Resume",
      body: `I like using the history sheet as a stress test for current headlines, and Ted Ulysse of the Norfolk Tides passes it cleanly. The present-day production is loud enough, but the longer view is louder: ${ted.mvps} MVPs, ${ted.championships} titles, and a body of work that keeps showing up when the league is deciding who matters.

That is why I treat today's numbers for Ulysse differently than I would a random hot week. When current form lands on top of an established talent curve, the probability that you are watching something real goes up fast. The stat itself matters. The résumé around it matters too.

This is where analytics can help rather than flatten the story. The point is not to drain the romance out of a season. The point is to figure out when the romance has evidence behind it. Ulysse is one of those cases.`,
      topicKey: "darren:history-player:ted-ulysse",
      targetKey: "player:Ted Ulysse",
    });
  }

  return (
    candidates.find((candidate) => candidate.topicKey !== previousColumn?.topicKey && !usedTargets.has(candidate.targetKey)) ??
    candidates.find((candidate) => !usedTargets.has(candidate.targetKey)) ??
    candidates.find((candidate) => candidate.topicKey !== previousColumn?.topicKey) ??
    null
  );
}

function buildDarrenPlayerTopicKey(player) {
  return `darren:player:${player.playerId}`;
}

function readDarrenPlayerProfile(player) {
  try {
    const rawHtml = fs.readFileSync(player.playerPagePath, "utf8");
    const imageMatch = rawHtml.match(/<img src="([^"]+person_pictures\/player_\d+\.(?:png|jpg|jpeg|webp))"[^>]*title="([^"]*)"/i);
    const teamMatch = rawHtml.match(/<a class="boxlink" style="font-weight:bold; font-size:18px; color:#FFFFFF;" href="\.\.\/teams\/team_\d+\.html">([^<]+)<\/a>/i);
    const metaLineMatch = rawHtml.match(/Age:\s*([^|<]+)\|\s*Bats:\s*([^|<]+)\|\s*Throws:\s*([^|<]+)\|\s*Morale:\s*([^<]+)/i);
    const headerMatch = rawHtml.match(/<th colspan="2" class="boxtitle"><a class="boxlink" [^>]*>(.*?)<\/a><\/th>/i);
    const nationalityMatch = rawHtml.match(/Nationality:<\/td>\s*<td class="wrap">([^<]+)<\/td>/i);
    const statTableMatch = rawHtml.match(/<table class="data" border="0" cellspacing="0" cellpadding="0" width="673px" style="margin-bottom:5px;">([\s\S]*?)<\/table>/i);
    const currentLine = parsePlayerStatTable(statTableMatch?.[1] ?? "");
    const notes = [...String(rawHtml).matchAll(/<td width="888px" class="dl wrap">([\s\S]*?)<\/td>/gi)]
      .map((match) => cleanColumnText(match[1]))
      .filter(Boolean);
    const timelineEntries = extractDarrenTimelineEntries(rawHtml);

    return {
      displayName: cleanColumnText(imageMatch?.[2] ?? player.name),
      imageUrl: imageMatch?.[1] ?? "",
      headerLine: cleanColumnText(headerMatch?.[1] ?? ""),
      teamFullName: cleanColumnText(teamMatch?.[1] ?? player.team),
      nationality: cleanColumnText(nationalityMatch?.[1] ?? player.nationality),
      age: cleanColumnText(metaLineMatch?.[1] ?? player.age),
      bats: cleanColumnText(metaLineMatch?.[2] ?? player.bats),
      throws: cleanColumnText(metaLineMatch?.[3] ?? player.throws),
      morale: cleanColumnText(metaLineMatch?.[4] ?? ""),
      currentLine,
      notes,
      ratings: {
        contact: extractPlayerRating(rawHtml, "Contact"),
        gap: extractPlayerRating(rawHtml, "Gap"),
        power: extractPlayerRating(rawHtml, "Power"),
        eye: extractPlayerRating(rawHtml, "Eye"),
        avoidK: extractPlayerRating(rawHtml, "Avoid K's"),
        stuff: extractPlayerRating(rawHtml, "Stuff"),
        movement: extractPlayerRating(rawHtml, "Movement"),
        control: extractPlayerRating(rawHtml, "Control"),
      },
      velocity: extractPlayerInfoValue(rawHtml, "Velocity"),
      suggestedRole: extractPlayerInfoValue(rawHtml, "Suggested Role"),
      awardsSummary: summarizePlayerAwardsFromNotes(notes),
      acquisitionSummary: buildDarrenAcquisitionSummary(timelineEntries),
      contractContext: buildDarrenContractContext(timelineEntries),
      draftContext: buildDarrenDraftContext(timelineEntries),
      careerSeasons: extractDarrenCareerSeasons(rawHtml, player),
    };
  } catch {
    return null;
  }
}

function extractDarrenTimelineEntries(rawHtml) {
  return [...String(rawHtml ?? "").matchAll(/<tr>\s*<td width="80px" class="dl">([^<]+)<\/td>\s*<td width="888px" class="dl wrap">([\s\S]*?)<\/td>\s*<\/tr>/gi)]
    .map((match) => ({
      date: cleanColumnText(match[1]),
      text: cleanColumnText(match[2]),
    }))
    .filter((entry) => entry.date || entry.text);
}

function buildDarrenAcquisitionSummary(entries) {
  const draftEntry = findDarrenAmateurDraftEntry(entries);
  if (draftEntry) {
    const year = draftEntry.text.match(/Drafted in the (\d{4})/i)?.[1] ?? "";
    const round = draftEntry.text.match(/Round\s+(\d+)/i)?.[1] ?? "";
    const team = cleanColumnText(draftEntry.text.match(/by the (.+?)\./i)?.[1] ?? "");
    return [year ? `drafted in ${year}` : "drafted", round ? `in round ${round}` : "", team ? `by ${team}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  const firstSigning = (entries ?? []).find((entry) => /Signed a .* contract with the .+ organization/i.test(entry.text));
  if (!firstSigning) {
    return "";
  }

  const year = firstSigning.date.match(/(\d{4})$/)?.[1] ?? "";
  const team = cleanColumnText(firstSigning.text.match(/with the (.+?) organization/i)?.[1] ?? "");
  return [year ? `first signed in ${year}` : "first signed", team ? `with ${team}` : ""].filter(Boolean).join(" ");
}

function findDarrenAmateurDraftEntry(entries) {
  return (entries ?? []).find((entry) => {
    const text = String(entry?.text ?? "");
    if (!/Drafted in the \d{4} /i.test(text)) {
      return false;
    }
    if (/expansion draft|rule 5 draft|minor league phase|major league phase|draft from the /i.test(text)) {
      return false;
    }
    return true;
  }) ?? null;
}

function buildDarrenContractContext(entries) {
  const sortedEntries = [...(entries ?? [])].sort((left, right) => (left.date < right.date ? 1 : -1));
  const latestExtension = sortedEntries.find((entry) => /Signed a \d+-year contract extension worth a total of/i.test(entry.text));
  const latestDeal = sortedEntries.find((entry) => /Signed a \d+-year contract worth a total of/i.test(entry.text));
  const currentYear = new Date().getFullYear();
  const upcomingFreeAgent = sortedEntries.find((entry) => /will become a free agent after the season/i.test(entry.text));

  return {
    isUpcomingFreeAgent: Boolean(upcomingFreeAgent),
    latestExtension: latestExtension
      ? {
          year: latestExtension.date.match(/(\d{4})$/)?.[1] ?? "",
          ...summarizeDarrenContractEntry(latestExtension.text),
        }
      : null,
    latestDeal: latestDeal
      ? {
          year: latestDeal.date.match(/(\d{4})$/)?.[1] ?? "",
          ...summarizeDarrenContractEntry(latestDeal.text),
        }
      : null,
    currentYear,
  };
}

function summarizeDarrenContractEntry(text) {
  const years = text.match(/Signed a (\d+)-year/i)?.[1] ?? "";
  const total = text.match(/worth a total of ([^.]+?)(?: with |\.)/i)?.[1] ?? "";
  const team =
    cleanColumnText(text.match(/with (?:the )?(.+?) organization\b/i)?.[1] ?? "") ||
    cleanColumnText(text.match(/with (?:the )?(.+?)\./i)?.[1] ?? "");
  const parts = [];
  if (years) {
    parts.push(`a ${years}-year deal`);
  }
  if (total) {
    parts.push(`worth ${total}`);
  }
  if (team) {
    parts.push(`with ${team}`);
  }
  return {
    team,
    summary: parts.join(" "),
  };
}

function buildDarrenDraftContext(entries) {
  const draftEntry = findDarrenAmateurDraftEntry(entries);
  if (!draftEntry) {
    return null;
  }

  const year = draftEntry.text.match(/Drafted in the (\d{4})/i)?.[1] ?? "";
  const round = draftEntry.text.match(/Round\s+(\d+)/i)?.[1] ?? "";
  const overallPick = draftEntry.text.match(/,\s*(\d+)(?:st|nd|rd|th)\s+Pick/i)?.[1] ?? "";
  const team = cleanColumnText(draftEntry.text.match(/by the (.+?)\./i)?.[1] ?? "");

  return {
    year,
    round,
    overallPick,
    team,
    isFirstOverall: String(round) === "1" && String(overallPick) === "1",
  };
}

function extractDarrenCareerSeasons(rawHtml, player) {
  const isPitcher = /^(SP|RP|CL|P)$/i.test(String(player?.pos ?? ""));
  const title = isPitcher ? "CAREER PITCHING STATS" : "CAREER BATTING STATS";
  const sectionPattern = new RegExp(
    `<th class="boxtitle">${escapeRegExp(title)}<\\/th>[\\s\\S]*?<table class="data sortable"[\\s\\S]*?<tr>[\\s\\S]*?<\\/tr>([\\s\\S]*?)<\\/table>`,
    "i",
  );
  const sectionMatch = String(rawHtml ?? "").match(sectionPattern);
  if (!sectionMatch) {
    return { currentSeason: null, previousSeason: null, careerTotal: null };
  }

  const rowMatches = [...sectionMatch[1].matchAll(/<tr(?: class="[^"]*")?>([\s\S]*?)<\/tr>/gi)];
  const rows = rowMatches.map((match) => extractDarrenCareerSeasonRow(match[1])).filter(Boolean);
  if (!rows.length) {
    return { currentSeason: null, previousSeason: null, careerTotal: null };
  }

  const abaRows = rows.filter((row) => / - ABA\b/i.test(row.label));
  const seasonRows = abaRows
    .filter((row) => /^\d{4}\b/.test(row.label))
    .sort((left, right) => Number.parseInt(left.year ?? "0", 10) - Number.parseInt(right.year ?? "0", 10));
  const currentSeason = seasonRows.at(-1) ?? null;
  const previousSeason = seasonRows.length > 1 ? seasonRows.at(-2) : null;
  const careerTotal = rows.find((row) => /^Total ABA\b/i.test(row.label)) ?? null;

  return { currentSeason, previousSeason, careerTotal };
}

function extractDarrenCareerSeasonRow(rowHtml) {
  const cells = [...String(rowHtml ?? "").matchAll(/<t[dh][^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => ({
      className: cleanColumnText(match[1] ?? ""),
      value: cleanColumnText(match[2] ?? ""),
    }));
  if (!cells.length) {
    return null;
  }

  const label = cleanColumnText(cells[0]?.value ?? "");
  if (!label || /Year\/Team\/League/i.test(label)) {
    return null;
  }

  const numbers = cells.slice(1).map((cell) => cleanColumnText(cell.value));
  const year = label.match(/^(\d{4})\b/)?.[1] ?? "";

  if (/Total ABA\b/i.test(label) && numbers.length >= 20) {
    return {
      label,
      year,
      W: numbers[3] ?? "",
      L: numbers[4] ?? "",
      SV: numbers[5] ?? "",
      ERA: numbers[6] ?? "",
      IP: numbers[7] ?? "",
      K: numbers[13] ?? "",
      WHIP: numbers[16] ?? "",
      WAR: numbers[19] ?? "",
      G: numbers[1] ?? "",
      AVG: numbers[13] ?? "",
      OBP: numbers[14] ?? "",
      SLG: numbers[15] ?? "",
      OPS: numbers[16] ?? "",
      HR: numbers[9] ?? "",
      RBI: numbers[10] ?? "",
      SB: numbers[11] ?? "",
    };
  }

  if (/Total ABA\b/i.test(label) && numbers.length >= 16) {
    return {
      label,
      year,
      G: numbers[1] ?? "",
      HR: numbers[6] ?? "",
      RBI: numbers[7] ?? "",
      SB: numbers[11] ?? "",
      AVG: numbers[12] ?? "",
      OBP: numbers[13] ?? "",
      SLG: numbers[14] ?? "",
      OPS: numbers[15] ?? "",
      OPS_PLUS: numbers[16] ?? "",
      WAR: numbers[18] ?? "",
    };
  }

  if (/ - ABA\b/i.test(label) && numbers.length >= 20) {
    return {
      label,
      year,
      W: numbers[3] ?? "",
      L: numbers[4] ?? "",
      SV: numbers[5] ?? "",
      ERA: numbers[6] ?? "",
      IP: numbers[7] ?? "",
      K: numbers[13] ?? "",
      WHIP: numbers[16] ?? "",
      WAR: numbers[19] ?? "",
    };
  }

  if (/ - ABA\b/i.test(label) && numbers.length >= 16) {
    return {
      label,
      year,
      G: numbers[1] ?? "",
      HR: numbers[6] ?? "",
      RBI: numbers[7] ?? "",
      SB: numbers[11] ?? "",
      AVG: numbers[12] ?? "",
      OBP: numbers[13] ?? "",
      SLG: numbers[14] ?? "",
      OPS: numbers[15] ?? "",
      OPS_PLUS: numbers[16] ?? "",
      WAR: numbers[18] ?? "",
    };
  }

  return {
    label,
    year,
  };
}

function classifyDarrenTeamTrend(standing) {
  if (!standing) {
    return "unknown";
  }

  const wins = Number.parseInt(cleanColumnText(standing.wins ?? standing.W ?? ""), 10);
  const losses = Number.parseInt(cleanColumnText(standing.losses ?? standing.L ?? ""), 10);
  if (!Number.isFinite(wins) || !Number.isFinite(losses) || wins + losses === 0) {
    return "unknown";
  }

  const pct = wins / (wins + losses);
  if (pct >= 0.54) {
    return "good";
  }
  if (pct <= 0.46) {
    return "bad";
  }
  return "middle";
}

function parsePlayerStatTable(tableHtml) {
  const headers = [...String(tableHtml).matchAll(/<th[^>]*class="dc"[^>]*>([^<]*)<\/th>/gi)].map((match) => cleanColumnText(match[1]));
  const values = [...String(tableHtml).matchAll(/<td[^>]*class="dc[^"]*"[^>]*>([^<]*)<\/td>/gi)].map((match) => cleanColumnText(match[1]));
  if (!headers.length || values.length < headers.length) {
    return {};
  }

  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function extractPlayerRating(rawHtml, label) {
  const match = String(rawHtml).match(new RegExp(`${escapeRegExp(label)}<\\/td>[\\s\\S]*?<td class="dc datac\\d+">(\\d+)<\\/td>`, "i"));
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function extractPlayerInfoValue(rawHtml, label) {
  const match = String(rawHtml).match(new RegExp(`${escapeRegExp(label)}<\\/td>\\s*<td class="dc[^"]*">([^<]+)<\\/td>`, "i"));
  return cleanColumnText(match?.[1] ?? "");
}

function summarizePlayerAwardsFromNotes(notes) {
  const awards = [];

  for (const note of notes ?? []) {
    if (/All-Star Game/i.test(note)) {
      awards.push({ label: "All-Star", importance: 80 });
      continue;
    }

    const awardMatch = note.match(/(?:Wins|Won|Receives|Received)\s+the\s+(.+?)\s+Award/i);
    if (awardMatch) {
      const label = cleanColumnText(awardMatch[1]);
      const importance = scoreColumnAwardLabel(label);
      if (label && importance > 0) {
        awards.push({ label, importance });
      }
    }
  }

  if (!awards.length) {
    return "";
  }

  const grouped = new Map();

  for (const award of awards) {
    const existing = grouped.get(award.label);
    if (existing) {
      existing.count += 1;
      existing.importance = Math.max(existing.importance, award.importance);
    } else {
      grouped.set(award.label, {
        label: award.label,
        importance: award.importance,
        count: 1,
      });
    }
  }

  const rankedAwards = [...grouped.values()].sort(
    (left, right) => right.importance - left.importance || right.count - left.count || left.label.localeCompare(right.label),
  );
  const hasMajorAward = rankedAwards.some((award) => isMajorColumnAward(award.label));
  const filteredAwards = rankedAwards.filter((award) => {
    if (isMinorColumnAward(award.label)) {
      return !hasMajorAward;
    }
    return true;
  });

  return filteredAwards
    .slice(0, 2)
    .map((award) => (award.count > 1 ? `${award.count}x ${award.label}` : award.label))
    .join(" | ");
}

function scoreColumnAwardLabel(label) {
  const text = String(label ?? "").toLowerCase();

  if (!text) {
    return 0;
  }
  if (/championship mvp|championship most valuable player|playoff mvp|playoff most valuable player|world series mvp|world championship mvp|league championship mvp/.test(text)) {
    return 100;
  }
  if (/\bmvp\b|most valuable player/.test(text)) {
    return 95;
  }
  if (/pitcher of the year|batter of the year|reliever of the year|rookie of the year/.test(text)) {
    return 90;
  }
  if (/all-star/.test(text)) {
    return 80;
  }
  if (/gold glove|great glove|platinum stick|platinum sticks|silver slugger|silver slugging|silver bat/.test(text)) {
    return 75;
  }
  if (/of the month/.test(text)) {
    return 50;
  }
  if (/of the week/.test(text)) {
    return 40;
  }

  return 30;
}

function isMinorColumnAward(label) {
  return /of the month|of the week/i.test(String(label ?? ""));
}

function isMajorColumnAward(label) {
  return scoreColumnAwardLabel(label) >= 75;
}

function buildDarrenTeamContext(teamName, teamStanding) {
  if (!teamStanding) {
    return `${teamName} are not a mystery-free context either; the club's place in the race gives every good week a little extra weight.`;
  }

  const wins = teamStanding.wins ?? teamStanding.W ?? "";
  const losses = teamStanding.losses ?? teamStanding.L ?? "";
  const sectionLabel = teamStanding.sectionLabel ?? teamStanding.section ?? "";
  const gb = teamStanding.gb ?? teamStanding.GB ?? "";
  const parts = [`${teamName} are ${wins}-${losses}`];
  if (sectionLabel) {
    parts.push(`in ${sectionLabel}`);
  }
  if (gb && gb !== "-") {
    parts.push(`${gb} GB off the lead`);
  }

  return `${parts.join(", ")}.`;
}

function buildDarrenRoleContext(player, profile, teamStanding) {
  const name = buildPlainPlayerName(profile.displayName || player.name);
  const line = profile.currentLine ?? {};
  const isPitcher = /^(SP|RP|CL|P)$/i.test(player.pos);

  if (isPitcher) {
    const era = Number.parseFloat(line.ERA);
    const innings = Number.parseFloat(line.IP);
    const strikeouts = Number.parseFloat(line.K);
    const walks = Number.parseFloat(line.BB);
    const kbb = strikeouts && walks ? (strikeouts / Math.max(walks, 1)).toFixed(2) : "";
    const roleLabel = /^SP$/i.test(player.pos) ? "rotation" : /^(CL|RP)$/i.test(player.pos) ? "bullpen" : "staff";

    return `${name} looks like a real ${roleLabel} driver, not a passenger. ${Number.isFinite(era) && era <= 3.5 ? `The ${formatMetric(era)} ERA is the surface-level proof.` : "The surface line is useful, but the supporting detail matters more."}${Number.isFinite(innings) ? ` He is already up to ${formatMetric(innings)} innings` : ""}${kbb ? ` with a ${kbb} strikeout-to-walk ratio` : ""}, which is the kind of workload-and-command pairing that changes how a team survives a week.`;
  }

  const ops = buildOps(line);
  const war = Number.parseFloat(line.WAR);
  const hr = Number.parseFloat(line.HR);
  const rbi = Number.parseFloat(line.RBI);

  const teamWins = teamStanding?.wins ?? teamStanding?.W ?? "";
  return `${name} reads like a middle-of-the-order problem because the production is showing up in the categories teams actually feel. ${ops ? `An OPS around ${ops}` : "The slash line is healthy"}${Number.isFinite(hr) ? `, ${hr} home runs` : ""}${Number.isFinite(rbi) ? `, and ${rbi} RBI` : ""} is not decorative offense. That is lineup architecture, especially for a club ${teamWins ? `trying to protect ${teamWins} wins` : "trying to keep pace"}.`;
}

function buildDarrenStatAngle(player, profile) {
  const name = buildPlainPlayerName(profile.displayName || player.name);
  const line = profile.currentLine ?? {};
  const isPitcher = /^(SP|RP|CL|P)$/i.test(player.pos);

  if (isPitcher) {
    const whip = Number.parseFloat(line.WHIP);
    const hits = Number.parseFloat(line.HA);
    const walks = Number.parseFloat(line.BB);
    const innings = Number.parseFloat(line.IP);
    const homers = Number.parseFloat(line.HR);

    return `The number I keep circling for ${name} is ${Number.isFinite(whip) ? `${formatMetric(whip)} WHIP` : "traffic suppression"}. ${Number.isFinite(innings) && innings > 0 ? `${name} has allowed ${Number.isFinite(hits) ? hits : "very few"} hits and ${Number.isFinite(walks) ? walks : "a manageable number of"} walks in ${formatMetric(innings)} innings` : "The underlying line is built on limiting baserunners"}${Number.isFinite(homers) ? ` while surrendering only ${homers} home run${homers === 1 ? "" : "s"}` : ""}.`;
  }

  const obp = Number.parseFloat(line.OBP);
  const slg = Number.parseFloat(line.SLG);
  const avg = Number.parseFloat(line.AVG);
  const walks = Number.parseFloat(line.BB);
  const strikeouts = Number.parseFloat(line.K);
  const ops = buildOps(line);

  return `The stat line I care about starts with ${ops ? `${ops} OPS` : "how often he is reaching and doing damage"}, because that is where the player page stops being decorative and starts being explanatory. ${Number.isFinite(avg) ? `${name} is hitting ${avg.toFixed(3).replace(/^0/, "")}` : "The batting average is solid"}${Number.isFinite(obp) ? ` with a ${obp.toFixed(3).replace(/^0/, "")} OBP` : ""}${Number.isFinite(slg) ? ` and a ${slg.toFixed(3).replace(/^0/, "")} SLG` : ""}. ${Number.isFinite(walks) && Number.isFinite(strikeouts) ? `The ${walks}-walk, ${strikeouts}-strikeout balance matters too.` : ""}`;
}

function buildDarrenPositionLabel(position) {
  const normalized = String(position ?? "").trim().toUpperCase();
  const map = {
    SP: "starting pitcher",
    RP: "relief pitcher",
    CL: "closer",
    P: "pitcher",
    C: "catcher",
    "1B": "first baseman",
    "2B": "second baseman",
    "3B": "third baseman",
    SS: "shortstop",
    LF: "left fielder",
    CF: "center fielder",
    RF: "right fielder",
    DH: "designated hitter",
  };

  return (map[normalized] ?? String(position ?? "").trim()) || "player";
}

function buildDarrenExtraContext(playerHistory, recordHits, profile) {
  if (recordHits?.[0]) {
    return `There is also a little history pressure here, because ${recordHits[0].category.toLowerCase()} markers tend to follow players who are doing more than just having a cute month.`;
  }

  if (playerHistory?.notes) {
    return `The larger resume already suggests this is not a random spike, which is exactly the kind of context the standings need when we try to separate a hot week from a meaningful season.`;
  }

  if (profile.awardsSummary) {
    return `Even the awards trail is starting to point in the same direction: ${profile.awardsSummary}.`;
  }

  return `That is the sort of player-team relationship I want to keep tracking, because a season usually reveals itself through these smaller dependencies before it does through the loudest headlines.`;
}

function buildDarrenHeadlineMetric(player, profile) {
  const line = profile.currentLine ?? {};
  if (/^(SP|RP|CL|P)$/i.test(player.pos)) {
    if (line.WHIP) {
      return `${formatMetric(Number.parseFloat(line.WHIP))} WHIP`;
    }
    if (line.ERA) {
      return `${formatMetric(Number.parseFloat(line.ERA))} ERA`;
    }
  } else {
    const ops = buildOps(line);
    if (ops) {
      return `${ops} OPS`;
    }
    if (line.OBP) {
      return `${Number.parseFloat(line.OBP).toFixed(3).replace(/^0/, "")} OBP`;
    }
  }

  return "his season";
}

function buildOps(line) {
  const obp = Number.parseFloat(line?.OBP);
  const slg = Number.parseFloat(line?.SLG);
  if (!Number.isFinite(obp) || !Number.isFinite(slg)) {
    return "";
  }

  return (obp + slg).toFixed(3).replace(/^0/, "");
}

function parseColumnNumber(value) {
  const text = cleanColumnText(value);
  if (!text) {
    return Number.NaN;
  }
  const normalized = text.startsWith(".") ? `0${text}` : text;
  return Number.parseFloat(normalized);
}

function parseColumnRate(value) {
  const parsed = parseColumnNumber(value);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }
  return parsed;
}

function formatColumnMetric(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function formatColumnRate(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(3).replace(/^0/, "");
}

function buildPlainPlayerName(value) {
  return String(value ?? "")
    .replace(/\s+['"][^'"]+['"]\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanColumnText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeColumnPlayerListName(value) {
  const cleaned = cleanColumnText(value);
  if (!cleaned.includes(",")) {
    return cleaned;
  }

  const [lastName, firstName] = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  return firstName && lastName ? `${firstName} ${lastName}` : cleaned;
}

function buildColumnHeadline(columnist, leadTeam, topHeadline) {
  if (leadTeam) {
    return `${columnist.name}: Why ${bestLabel(leadTeam)} Feel Real`;
  }

  if (topHeadline) {
    return `${columnist.name}: The Meaning Behind ${topHeadline.title}`;
  }

  return `${columnist.name}: Reading the League's Mood`;
}

function extractPowerRankingTeams(text) {
  return [...String(text).matchAll(/\d+\)\s+([^()]+?)\s+\([\d.]+,\s*[^)]+\)/g)]
    .slice(0, 3)
    .map((match) => match[1].replace(/\s+/g, " ").trim());
}

function columnistLabel(name) {
  return name;
}

function findStandingsTeam(snapshot, teamName) {
  const normalizedTeam = String(teamName ?? "").toLowerCase();
  const allRows = [
    ...(snapshot.standings ?? []),
    ...((snapshot.standingsSections ?? []).flatMap((section) => section.rows ?? [])),
  ];

  return allRows.find((row) => String(row.Team ?? "").toLowerCase() === normalizedTeam) ?? null;
}

function parsePitcherMetrics(text) {
  return [...String(text).matchAll(/(?:SP|RP|CL)\s+(.+?)\s+\(([A-Z-]+)\)\*?\s*-\s*[\d-]+,\s*([\d.]+)\s+ERA,\s*([\d.]+)\s+IP,\s*([\d.]+)\s+WHIP,\s*([\d.]+)\s+K\/9/gi)].map(
    (match) => ({
      name: match[1].replace(/\s+/g, " ").trim(),
      team: match[2].trim(),
      era: Number.parseFloat(match[3]),
      innings: Number.parseFloat(match[4]),
      whip: Number.parseFloat(match[5]),
      k9: Number.parseFloat(match[6]),
    }),
  );
}

function parseBatterMetrics(text) {
  return [...String(text).matchAll(/(?:C|1B|2B|3B|SS|LF|CF|RF|DH)\s+(.+?)\s+\(([A-Z-]+)\)\*?\s*-\s*[^,]+,\s*(\d+)\s+wRC\+/gi)].map((match) => ({
    name: match[1].replace(/\s+/g, " ").trim(),
    team: match[2].trim(),
    wrcPlus: Number.parseInt(match[3], 10),
  }));
}

function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, "") : String(value ?? "");
}

function formatPersonWithTeam(name, team) {
  if (!name) {
    return "";
  }

  const resolvedName = resolvePlayerName(name, team);
  const expandedTeam = expandTeamLabel(team);
  return expandedTeam ? `${resolvedName} of ${expandedTeam}` : resolvedName;
}

function resolvePlayerName(name, team = "") {
  const rawName = String(name ?? "").trim();
  if (!rawName) {
    return "";
  }

  if (!/^[A-Z]\.\s+/.test(rawName)) {
    return rawName;
  }

  const directory = snapshotPlayerNameDirectory();
  const directMatch = (
    directory[buildPlayerDirectoryKey(rawName, team)] ||
    directory[buildPlayerDirectoryKey(rawName, "")] ||
    ""
  );
  if (directMatch) {
    return directMatch;
  }

  const expandedTeam = expandTeamLabel(team);
  const leaguePlayerMatch = (currentSnapshotRef?.leaguePlayers ?? []).find((player) => {
    if (!columnPlayerNameMatchesAbbreviation(player?.name ?? "", rawName)) {
      return false;
    }
    if (!team) {
      return true;
    }
    return normalizeColumnName(player?.team ?? "") === normalizeColumnName(expandedTeam || team);
  });

  return leaguePlayerMatch?.name || rawName;
}

function abbreviateColumnPlayerName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2) {
    return String(name ?? "").trim();
  }

  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function columnPlayerNameMatchesAbbreviation(fullName, abbreviatedName) {
  const full = String(fullName ?? "").trim();
  const abbreviated = String(abbreviatedName ?? "").trim();
  if (!full || !abbreviated) {
    return false;
  }

  if (abbreviateColumnPlayerName(full) === abbreviated) {
    return true;
  }

  const abbreviatedMatch = abbreviated.match(/^([A-Z])\.\s+(.+)$/i);
  if (!abbreviatedMatch) {
    return false;
  }

  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return false;
  }

  const fullFirstInitial = parts[0][0]?.toLowerCase?.() ?? "";
  const fullLastName = parts.slice(1).join(" ").toLowerCase();
  return fullFirstInitial === abbreviatedMatch[1].toLowerCase() && fullLastName === abbreviatedMatch[2].toLowerCase();
}

function snapshotPlayerNameDirectory() {
  return currentSnapshotRef?.playerNameDirectory ?? {};
}

function buildPlayerDirectoryKey(name, team) {
  return `${String(name ?? "").trim().toLowerCase()}::${String(team ?? "").trim().toLowerCase()}`;
}

function expandTeamLabel(team) {
  const normalized = String(team ?? "").trim();
  if (!normalized) {
    return "";
  }

  if (!/^[A-Z-]+$/.test(normalized)) {
    return normalized;
  }

  if (normalized.endsWith("-AAA")) {
    const parent = expandTeamLabel(normalized.slice(0, -4));
    return parent ? `${parent} Triple-A club` : normalized;
  }

  return TEAM_CODE_MAP[normalized] ?? normalized;
}

function normalizeColumnTeamDisplay(team) {
  const text = cleanColumnText(team);
  if (!text) {
    return "";
  }

  if (/^[A-Z][A-Z\s.'&-]+$/.test(text)) {
    return text
      .toLowerCase()
      .replace(/\b([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  return text;
}

const TEAM_CODE_MAP = {
  SYR: "Syracuse Mets",
  QC: "Quebec Capitales",
  ROC: "Rochester Red Wings",
  POR: "Portland Sea Dogs",
  CHA: "Charlotte Knights",
  DUR: "Durham Bulls",
  NOR: "Norfolk Tides",
  SAV: "Savannah Bananas",
  TOL: "Toledo Mud Hens",
  DAY: "Dayton Dragons",
  FW: "Fort Wayne Wizards",
  COL: "Columbus Clippers",
  VAN: "Vancouver Canadians",
  SPO: "Spokane Indians",
  EUG: "Eugene Emeralds",
  CAL: "Calgary Cannons",
  TUC: "Tucson Sidewinders",
  NO: "New Orleans Privateers",
  EL: "El Paso Tigers",
  ALB: "Albuquerque Isotopes",
  FRE: "Fresno Grizzlies",
  SAC: "Sacramento River Cats",
  STO: "Stockton Ospreys",
  PAS: "Pasadena Eagles",
};

function bestLabel(record) {
  const team = record.team || record.Team || record.TEAM || "";
  const playerName =
    record.Name ||
    record.NAME ||
    record.Player ||
    record.PLAYER ||
    "";

  if (playerName) {
    return resolvePlayerName(playerName, team);
  }

  return record.Team || record.TEAM || Object.values(record).find((value) => /[A-Za-z]/.test(value)) || "the current leader";
}
