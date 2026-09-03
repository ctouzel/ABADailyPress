import fs from "node:fs";
import path from "node:path";
import { findLeaderboardEntriesByPlayer, findPlayerHistory, findRecordByPlayer, findTeamHistory, getLastCompletedSeason, summarizeTeamLegacy } from "./historyContext.mjs";

function buildPlainPlayerName(value) {
  return String(value ?? "")
    .replace(/\s+['"][^'"]+['"]\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSnapshot(parsedPages, config) {
  const standingsTables = [];
  const battingTables = [];
  const pitchingTables = [];
  const genericTables = [];
  const scoreHistoryPages = [];
  const leagueIds = new Set();

  for (const page of parsedPages) {
    const pageType = detectPageType(page);
    const leagueId = extractLeagueId(page.fileName);
    if (leagueId) {
      leagueIds.add(leagueId);
    }

    if (pageType === "scores-history") {
      scoreHistoryPages.push(page);
    }

    for (const table of page.tables) {
      const normalizedHeaders = table.headers.map((header) => header.toUpperCase());
      const taggedTable = {
        pageTitle: page.title,
        fileName: page.fileName,
        pageType,
        label: table.label,
        headers: table.headers,
        rows: table.rows,
      };

      if (
        (pageType === "standings" && looksLikeStandings(normalizedHeaders)) ||
        (pageType !== "batting-report" && pageType !== "pitching-report" && looksLikeStandings(normalizedHeaders))
      ) {
        standingsTables.push(taggedTable);
      } else if ((pageType === "batting-report" && looksLikeBatting(normalizedHeaders)) || looksLikeBatting(normalizedHeaders)) {
        battingTables.push(taggedTable);
      } else if ((pageType === "pitching-report" && looksLikePitching(normalizedHeaders)) || looksLikePitching(normalizedHeaders)) {
        pitchingTables.push(taggedTable);
      } else {
        genericTables.push(taggedTable);
      }
    }
  }

  const preferredLeagueId = leagueIds.has("200")
    ? "200"
    : choosePreferredLeagueId(parsedPages);
  const primaryLeagueView = buildLeagueView(parsedPages, preferredLeagueId, scoreHistoryPages);
  const frontierLeagueView = leagueIds.has("201")
    ? buildLeagueView(parsedPages, "201", scoreHistoryPages)
    : null;
  const topPlayersPage = parsedPages.find((page) => detectPageType(page) === "top-players" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const leaguePlayers = buildLeaguePlayers(parsedPages, preferredLeagueId);
  const topProspectsPage = parsedPages.find((page) => detectPageType(page) === "top-prospects" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const upcomingFreeAgentsBattersPage = parsedPages.find((page) => detectPageType(page) === "upcoming-free-agents-batters" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const upcomingFreeAgentsPitchersPage = parsedPages.find((page) => detectPageType(page) === "upcoming-free-agents-pitchers" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const topFarmSystemsPage = parsedPages.find((page) => detectPageType(page) === "top-farm-systems" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const financialReportPage = parsedPages.find((page) => detectPageType(page) === "financial-report" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const accomplishmentsMilestonesPage = parsedPages.find((page) => detectPageType(page) === "accomplishments-milestones" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const positionalStrengthPage = parsedPages.find((page) => detectPageType(page) === "positional-strength" && extractLeagueId(page.fileName) === preferredLeagueId) ?? null;
  const primaryLeagueDate = determineLeagueCalendarDate(primaryLeagueView);
  const primaryLeagueMode = determineLeagueMode(primaryLeagueDate, primaryLeagueView);
  const frontierLeagueDate = frontierLeagueView ? determineLeagueCalendarDate(frontierLeagueView) : null;
  const frontierLeagueMode = frontierLeagueView ? determineLeagueMode(frontierLeagueDate, frontierLeagueView) : "";
  const standingsSections = primaryLeagueView.standingsSections;
  const teamCareerLeaders = buildRandomTeamCareerLeaders(standingsSections);
  const leagueCareerLeaders = buildLeagueCareerLeaders(preferredLeagueId);
  const positionCareerLeaderboard = buildPositionCareerLeaderboard(preferredLeagueId);
  const numberOnePicksFeature = buildRandomTeamNumberOnePicks(standingsSections);
  const topGamePerformancesFeature = buildTopGamePerformancesFeature(preferredLeagueId);
  const championshipChase = buildChampionshipChase(primaryLeagueView, {
    visibleStartMonth: 5,
    visibleEndMonth: 8,
    playoffStartMonth: 7,
    playoffStartDay: 15,
    playoffTextIndicators: [
      /ABA News:\s*Playoffs begin/i,
      /These (?:Wild Card|Division Series|Conference Series|Championship Series) battles will unfold later today/i,
      /Breaks Through for First Win in (?:Wild Card|Division) Series/i,
      /Now Trails \d+-\d+/i,
      /Lead in R\d+/i,
    ],
  });
  const frontierChampionshipChase = frontierLeagueView
    ? buildChampionshipChase(frontierLeagueView, {
        divisionWinnerCount: 3,
        wildcardCount: 1,
        huntCount: 3,
        visibleStartMonth: 6,
        visibleEndMonth: 8,
        playoffStartMonth: 7,
        playoffStartDay: 1,
        playoffTextIndicators: [
          /These Division Series battles will unfold later today/i,
          /the clubs that survived are getting ready to do battle in the 2033 Frontier League playoffs/i,
          /the postseason won't include/i,
        ],
        titleRegular: "Projected Playoff Bracket",
        titlePlayoffs: "Playoff Bracket",
        conferenceSeriesLabel: "Conference Championship Series (4 of 7)",
        championshipSeriesLabel: "Championship Series (4 of 7)",
        seriesLabels: {
          division: "Division Series (4 of 7)",
          conference: "Conference Championship Series (4 of 7)",
        },
      })
    : null;
  const financialFeature = buildFinancialFeature(financialReportPage, preferredLeagueId);
  const managerHighlightFeature = buildManagerHighlightFeature([primaryLeagueView, frontierLeagueView].filter(Boolean));
  const oldestPlayersFeature = buildOldestPlayersFeature(leaguePlayers);
  const standings = standingsSections[0]?.rows ?? [];
  const leagueScopedPages = primaryLeagueView.pages;
  const headlineCandidates = primaryLeagueView.headlines;
  const lastDayScores = attachScoreTeamRecords(primaryLeagueView.lastDayScores, standingsSections);
  const threeStarsOfDay = buildThreeStarsOfDay(lastDayScores);
  const scheduledGames = primaryLeagueView.scheduledGames;
  const leaderboardGroups = buildPlayerLeaderboardGroups(primaryLeagueView.statsPage);
  const frontierLeaderboardGroups = frontierLeagueView
    ? buildPlayerLeaderboardGroups(frontierLeagueView.statsPage)
    : { batting: [], pitching: [] };
  const injuries = buildLatestInjuryItems(primaryLeagueView.injuriesPage);
  const transactions = buildTransactionItems(primaryLeagueView.transactionsPage);
  const battingLeaders = battingTables[0] ? normalizeRows(battingTables[0], 8) : [];
  const pitchingLeaders = pitchingTables[0] ? normalizeRows(pitchingTables[0], 8) : [];

  return {
    generatedAt: new Date().toISOString(),
    newspaperName: config.newspaperName,
    leagueName: preferredLeagueId === "200" ? "American Baseball Association" : config.leagueName,
    city: config.city,
    pageCount: parsedPages.length,
    storiesAnalyzed: headlineCandidates.length,
    leagueDateLabel: primaryLeagueDate ? formatChampionshipChaseDate(primaryLeagueDate) : "",
    currentMode: primaryLeagueMode,
    headlines: headlineCandidates,
    lastDayScores,
    threeStarsOfDay,
    scheduledGames,
    standings,
    standingsSections,
    battingLeaderboards: leaderboardGroups.batting,
    pitchingLeaderboards: leaderboardGroups.pitching,
    playerNameDirectory: buildPlayerNameDirectory(topPlayersPage),
    leaguePlayers,
    injuries,
    transactions,
    battingLeaders,
    pitchingLeaders,
    prospectHighlight: buildProspectHighlight(topProspectsPage),
    playerInterviewFeature: buildPlayerInterviewFeature(topPlayersPage, standingsSections, injuries, leaguePlayers, primaryLeagueDate, primaryLeagueMode),
    upcomingFreeAgents: buildUpcomingFreeAgents(upcomingFreeAgentsBattersPage, upcomingFreeAgentsPitchersPage),
    topFarmSystems: buildTopFarmSystems(topFarmSystemsPage),
    playerMilestones: buildPlayerMilestones(accomplishmentsMilestonesPage),
    positionalStrengthFeature: buildPositionalStrengthFeature(positionalStrengthPage, leaguePlayers),
    underKnifeInjuries: buildUnderKnifeInjuries(primaryLeagueView.injuriesReportPage),
    teamCareerLeaders,
    leagueCareerLeaders,
    positionCareerLeaderboard,
    numberOnePicksFeature,
    topGamePerformancesFeature,
    championshipChase,
    financialFeature,
    managerHighlightFeature,
    oldestPlayersFeature,
      frontierLeague: frontierLeagueView
        ? {
            leagueId: frontierLeagueView.leagueId,
            leagueName: frontierLeagueView.leagueName,
            leagueDateLabel: frontierLeagueDate ? formatChampionshipChaseDate(frontierLeagueDate) : "",
            currentMode: frontierLeagueMode,
            headlines: frontierLeagueView.headlines,
            standingsSections: frontierLeagueView.standingsSections,
            championshipChase: frontierChampionshipChase,
            battingLeaderboards: selectLeaderboardCategories(frontierLeaderboardGroups.batting, [
              "Batting AVG",
              "Home Runs",
              "WAR",
              "Stolen Bases",
            ]),
            pitchingLeaderboards: selectLeaderboardCategories(frontierLeaderboardGroups.pitching, [
              "Wins",
              "ERA",
              "Strikeouts",
              "WHIP",
            ]),
          }
        : null,
    sourcePages: leagueScopedPages.map((page) => ({
      title: page.title,
      fileName: page.fileName,
      summary: page.summary,
      tableCount: page.tables.length,
    })),
    diagnostics: {
      currentMode: primaryLeagueMode,
      frontierMode: frontierLeagueMode,
      standingsTablesFound: standingsTables.length,
      battingTablesFound: battingTables.length,
      pitchingTablesFound: pitchingTables.length,
      genericTablesFound: genericTables.length,
    },
  };
}

function buildRandomTeamCareerLeaders(standingsSections = []) {
  const historyDir = path.resolve("News", "history");
  if (!fs.existsSync(historyDir)) {
    return null;
  }

  const activeTeams = new Set(
    (standingsSections ?? [])
      .flatMap((section) => section.rows ?? [])
      .map((row) => normalizeTeamName(cleanHtmlText(row.Team ?? "")))
      .filter(Boolean),
  );

  const battingFiles = fs
    .readdirSync(historyDir)
    .filter((fileName) => /^team_\d+_batting_leaders\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  const candidates = battingFiles
    .map((fileName) => {
      const teamId = fileName.match(/^team_(\d+)_/i)?.[1] ?? "";
      const pitchingFileName = `team_${teamId}_pitching_leaders.html`;
      const battingPath = path.join(historyDir, fileName);
      const pitchingPath = path.join(historyDir, pitchingFileName);
      if (!teamId || !fs.existsSync(pitchingPath)) {
        return null;
      }

      const teamName = readTeamLeaderPageTitle(battingPath);
      if (!teamName) {
        return null;
      }

      return {
        teamId,
        teamName,
        battingPath,
        pitchingPath,
      };
    })
    .filter(Boolean)
    .filter((candidate) => !activeTeams.size || activeTeams.has(normalizeTeamName(candidate.teamName)));

  if (!candidates.length) {
    return null;
  }

  const selectedIndex = pickStableIndex("team-career-leaders", candidates.length);
  const selected = candidates[selectedIndex] ?? candidates[0];
  const battingLeaderboards = readTeamCareerLeaderboards(selected.battingPath, "batting");
  const pitchingLeaderboards = readTeamCareerLeaderboards(selected.pitchingPath, "pitching");

  if (!battingLeaderboards.length && !pitchingLeaderboards.length) {
    return null;
  }

  return {
    teamId: selected.teamId,
    teamName: selected.teamName,
    battingLeaderboards,
    pitchingLeaderboards,
  };
}

function buildRandomTeamNumberOnePicks(standingsSections = []) {
  const historyDir = path.resolve("News", "history");
  if (!fs.existsSync(historyDir)) {
    return null;
  }

  const activeTeams = new Set(
    (standingsSections ?? [])
      .flatMap((section) => section.rows ?? [])
      .map((row) => normalizeTeamName(cleanHtmlText(row.Team ?? "")))
      .filter(Boolean),
  );

  const draftHistoryFiles = fs
    .readdirSync(historyDir)
    .filter((fileName) => /^team_\d+_draft_history\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  const candidates = draftHistoryFiles
    .map((fileName) => {
      const teamId = fileName.match(/^team_(\d+)_draft_history\.html$/i)?.[1] ?? "";
      const filePath = path.join(historyDir, fileName);
      const rawHtml = safeReadFile(filePath);
      if (!teamId || !rawHtml) {
        return null;
      }

      const teamName = readTeamDraftHistoryName(rawHtml);
      if (!teamName) {
        return null;
      }

      const picks = extractTeamDraftHistoryFirstPicks(filePath, rawHtml);
      return {
        teamId,
        teamName,
        filePath,
        picks,
      };
    })
    .filter(Boolean)
    .filter((candidate) => candidate.picks.length)
    .filter((candidate) => !activeTeams.size || activeTeams.has(normalizeTeamName(candidate.teamName)));

  if (!candidates.length) {
    return null;
  }

  const selected = candidates[pickStableIndex("number-one-picks-team", candidates.length)] ?? candidates[0];

  return {
    teamId: selected.teamId,
    teamName: selected.teamName,
    picks: selected.picks.slice(0, 15),
  };
}

function readTeamDraftHistoryName(rawHtml) {
  return cleanHtmlText(
    rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1]
    ?? rawHtml.match(/team_logos\/[^"]+" border="0" title="([^"]+)"/i)?.[1]
    ?? "",
  );
}

function extractTeamDraftHistoryFirstPicks(baseFilePath, rawHtml) {
  const picks = [];

  for (const match of String(rawHtml ?? "").matchAll(/<tr>\s*<td class="dl">(?:<a [^>]*>)?(\d{4})(?:<\/a>)?[\s\S]*?<\/td>\s*<td class="dl">([\s\S]*?)<\/td>/gi)) {
    const year = cleanHtmlText(match[1] ?? "");
    const pickCell = match[2] ?? "";
    const playerId = cleanHtmlText(pickCell.match(/player_(\d+)\.html/i)?.[1] ?? "");
    const abbreviatedName = cleanHtmlText(pickCell.match(/<a [^>]*>([^<]+)<\/a>/i)?.[1] ?? "");
    const overallPick = cleanHtmlText(pickCell.match(/\((\d+)\)/)?.[1] ?? "");
    if (!year || !playerId || !abbreviatedName) {
      continue;
    }

    const playerPath = path.resolve(path.dirname(baseFilePath), "..", "players", `player_${playerId}.html`);
    const playerProfile = readDraftHistoryPlayerProfile(playerPath, abbreviatedName);

    picks.push({
      year,
      player: playerProfile.name,
      position: playerProfile.position,
      currentTeam: playerProfile.currentTeam || "",
    });
  }

  return picks
    .sort((left, right) => Number.parseInt(right.year, 10) - Number.parseInt(left.year, 10))
    .slice(0, 15);
}

function readDraftHistoryPlayerProfile(playerPath, fallbackName) {
  const rawHtml = safeReadFile(playerPath);
  if (!rawHtml) {
    return {
      name: fallbackName,
      position: "",
    };
  }

  const displayName = stripDraftHistoryNickname(
    cleanHtmlText(rawHtml.match(/<img src="[^"]+person_pictures\/player_\d+\.(?:png|jpg|jpeg|webp)"[^>]*title="([^"]*)"/i)?.[1] ?? fallbackName),
  );
  const headerLine = cleanHtmlText(rawHtml.match(/<th colspan="2" class="boxtitle"><a class="boxlink" [^>]*>(.*?)<\/a><\/th>/i)?.[1] ?? "");
  const firstHeaderSegment = cleanHtmlText(headerLine.split("|")[0] ?? "");
  const position = cleanHtmlText(firstHeaderSegment.match(/^([A-Z0-9-]+)/)?.[1] ?? "");
  const currentTeam = cleanHtmlText(rawHtml.match(/<a class="boxlink" style="font-weight:bold; font-size:18px; color:#FFFFFF;" href="\.\.\/teams\/team_\d+\.html">([^<]+)<\/a>/i)?.[1] ?? "");

  return {
    name: displayName,
    position,
    currentTeam,
  };
}

function stripDraftHistoryNickname(name) {
  const parts = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (parts.length <= 2) {
    return parts.join(" ");
  }

  const cleaned = [];
  let insideNickname = false;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isFirst = index === 0;
    const isLast = index === parts.length - 1;

    if (isFirst || isLast) {
      cleaned.push(part.replace(/^['"]+|['"]+$/g, ""));
      insideNickname = false;
      continue;
    }

    if (insideNickname) {
      if (/['"]{1,2}$/.test(part)) {
        insideNickname = false;
      }
      continue;
    }

    if (/^['"]/.test(part)) {
      if (!/['"]{1,2}$/.test(part.slice(1))) {
        insideNickname = true;
      }
      continue;
    }

    cleaned.push(part.replace(/^['"]+|['"]+$/g, ""));
  }

  return cleaned.join(" ").replace(/\s+/g, " ").trim();
}

function buildTopGamePerformancesFeature(leagueId) {
  const filePath = path.resolve("News", "leagues", `league_${leagueId}_top_game_performances.html`);
  const rawHtml = safeReadFile(filePath);
  if (!rawHtml) {
    return null;
  }

  const sections = [...rawHtml.matchAll(/<td class="boxtitle">\s*(?:<!--[\s\S]*?-->)?\s*([A-Z]+)\s*<\/td>\s*<\/tr>\s*<tr>\s*<td>\s*<table class="data sortable"[\s\S]*?>([\s\S]*?)<\/table>/gi)];
  const batters = parseTopGamePerformanceSection(sections.find((match) => cleanHtmlText(match[1] ?? "") === "BATTERS")?.[2] ?? "", "batters");
  const pitchers = parseTopGamePerformanceSection(sections.find((match) => cleanHtmlText(match[1] ?? "") === "PITCHERS")?.[2] ?? "", "pitchers");

  if (!batters.length && !pitchers.length) {
    return null;
  }

  return {
    batters,
    pitchers,
  };
}

function parseTopGamePerformanceSection(tableHtml, type) {
  if (!tableHtml) {
    return [];
  }

  const rows = [];
  for (const match of tableHtml.matchAll(/<tr>\s*<td class="dr">(\d+)<\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl">([^<]+)<\/td>\s*([\s\S]*?)<\/tr>/gi)) {
    const rank = cleanHtmlText(match[1] ?? "");
    const player = cleanHtmlText(match[2] ?? "");
    const team = cleanHtmlText(match[3] ?? "");
    const opponent = cleanHtmlText(match[4] ?? "");
    const date = cleanHtmlText(match[5] ?? "");
    const numericCells = [...String(match[6] ?? "").matchAll(/<td class="dr">([^<]+)<\/td>/gi)].map((cell) => cleanHtmlText(cell[1] ?? ""));

    if (!rank || !player || numericCells.length < 7) {
      continue;
    }

    if (type === "batters") {
      rows.push({
        rank,
        player,
        team,
        opponent,
        date,
        ab: numericCells[0],
        runs: numericCells[1],
        hits: numericCells[2],
        rbi: numericCells[3],
        homeRuns: numericCells[4],
        walks: numericCells[5],
        score: numericCells[6],
      });
    } else {
      rows.push({
        rank,
        player,
        team,
        opponent,
        date,
        innings: numericCells[0],
        hitsAllowed: numericCells[1],
        runs: numericCells[2],
        earnedRuns: numericCells[3],
        walks: numericCells[4],
        strikeouts: numericCells[5],
        score: numericCells[6],
      });
    }
  }

  return rows.slice(0, 5);
}

function readTeamLeaderPageTitle(filePath) {
  try {
    const rawHtml = fs.readFileSync(filePath, "utf8");
    return cleanHtmlText(rawHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "");
  } catch {
    return "";
  }
}

function normalizeTeamName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readTeamCareerLeaderboards(filePath, type) {
  let rawHtml = "";
  try {
    rawHtml = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const preferredLabels = type === "pitching"
    ? ["Wins", "Innings", "Strikeouts", "Saves", "Games Pitched", "Complete Games"]
    : ["Games", "Hits", "Doubles", "Home Runs", "Runs Batted In", "WAR"];
  const rawToDisplayLabel = type === "pitching"
    ? {
      WINS: "Wins",
      "INNINGS PITCHED": "Innings",
      STRIKEOUTS: "Strikeouts",
      SAVES: "Saves",
      "GAMES PITCHED": "Games Pitched",
      GAMES: "Games Pitched",
      "COMPLETE GAMES": "Complete Games",
    }
    : {
      GAMES: "Games",
      HITS: "Hits",
      DOUBLES: "Doubles",
      "HOME RUNS": "Home Runs",
      RBIS: "Runs Batted In",
      "RUNS BATTED IN": "Runs Batted In",
      WAR: "WAR",
    };
  const categoryTables = [];
  const categoryPattern = /<tr><th class="boxtitle">([^<]+?) - CAREER<\/th><\/tr>\s*<\/table>\s*<table[\s\S]*?class="data sortable"[\s\S]*?>([\s\S]*?)<\/table>/gi;

  for (const match of rawHtml.matchAll(categoryPattern)) {
    const rawLabel = cleanHtmlText(match[1] ?? "").toUpperCase();
    const displayLabel = rawToDisplayLabel[rawLabel];
    if (!displayLabel) {
      continue;
    }

    const entries = [];
    for (const rowMatch of String(match[2] ?? "").matchAll(/<tr>\s*<td class="dc">(\d+)\.<\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dr">([^<]+)<\/td>/gi)) {
      entries.push({
        player: cleanHtmlText(rowMatch[2] ?? ""),
        value: cleanHtmlText(rowMatch[3] ?? ""),
      });
    }

    if (entries.length) {
      categoryTables.push({
        label: displayLabel,
        entries: entries.slice(0, 4),
      });
    }
  }

  return preferredLabels
    .map((label) => categoryTables.find((table) => table.label === label))
    .filter(Boolean)
    .slice(0, preferredLabels.length);
}

function buildLeagueCareerLeaders(leagueId) {
  const historyDir = path.resolve("News", "history");
  if (!fs.existsSync(historyDir)) {
    return null;
  }

  const battingLeaderboards = readLeagueCareerLeaderboards(historyDir, leagueId, "batting");
  const pitchingLeaderboards = readLeagueCareerLeaderboards(historyDir, leagueId, "pitching");

  if (!battingLeaderboards.length && !pitchingLeaderboards.length) {
    return null;
  }

  return {
    leagueName: getLeagueName(leagueId),
    battingLeaderboards,
    pitchingLeaderboards,
  };
}

function buildPositionCareerLeaderboard(leagueId) {
  const historyDir = path.resolve("News", "history");
  if (!fs.existsSync(historyDir)) {
    return null;
  }

  const positionOptions = [
    { code: "2", shortLabel: "C", title: "Catchers" },
    { code: "3", shortLabel: "1B", title: "First Basemen" },
    { code: "4", shortLabel: "2B", title: "Second Basemen" },
    { code: "5", shortLabel: "3B", title: "Third Basemen" },
    { code: "6", shortLabel: "SS", title: "Shortstops" },
    { code: "7", shortLabel: "LF", title: "Left Fielders" },
    { code: "8", shortLabel: "CF", title: "Center Fielders" },
    { code: "9", shortLabel: "RF", title: "Right Fielders" },
  ].filter((position) => fs.existsSync(path.join(historyDir, `league_${leagueId}_0_${position.code}_leaderboards.html`)));

  if (!positionOptions.length) {
    return null;
  }

  const selected = positionOptions[pickStableIndex(`position-career-leaderboard:${leagueId}`, positionOptions.length)] ?? positionOptions[0];
  const summaryPath = path.join(historyDir, `league_${leagueId}_0_${selected.code}_leaderboards.html`);
  const summaryHtml = safeReadFile(summaryPath);
  if (!summaryHtml) {
    return null;
  }

  const rows = readPositionLeaderboardSummaryRows(summaryPath, summaryHtml);
  const desiredCategories = ["Home Runs", "WAR", "Hits", "Stolen Bases", "Games", "Doubles", "Triples", "OPS", "Batting Average", "Walks", "OBP", "Slugging"];
  const selectedRows = desiredCategories
    .map((label) => rows.find((row) => row.label === label))
    .filter(Boolean);

  if (!selectedRows.length) {
    return null;
  }

  return {
    position: selected.shortLabel,
    positionTitle: selected.title,
    singleSeason: selectedRows.map((row) => ({
      label: row.label,
      ...readPositionLeaderboardDetail(row.seasonPath, row.label),
    })),
    career: selectedRows.map((row) => ({
      label: row.label,
      ...readPositionLeaderboardDetail(row.careerPath, row.label),
    })),
    singlePostseason: selectedRows.map((row) => ({
      label: row.label,
      ...readPositionLeaderboardDetail(convertToPostseasonPositionPath(row.seasonPath), row.label),
    })),
    postseasonCareer: selectedRows.map((row) => ({
      label: row.label,
      ...readPositionLeaderboardDetail(convertToPostseasonCareerPositionPath(row.careerPath), row.label),
    })),
  };
}

function readLeagueCareerLeaderboards(historyDir, leagueId, type) {
  const preferredLabels = type === "pitching"
    ? ["Wins", "Strikeouts", "Innings", "Saves", "ERA", "Losses", "Winning Percentage", "Games", "WAR", "Complete Games", "Shutouts", "WHIP"]
    : ["Home Runs", "WAR", "Hits", "Stolen Bases", "Games", "Doubles", "Triples", "OPS", "Batting Average", "Walks", "OBP", "Slugging"];
  const historyIndexPath = path.join(historyDir, `league_${leagueId}_0_0_leaderboards.html`);
  const historyIndexHtml = safeReadFile(historyIndexPath);
  if (!historyIndexHtml) {
    return [];
  }

  const categoryLinks = extractLeagueCareerLeaderboardLinks(historyDir, historyIndexPath, historyIndexHtml, type);
  return preferredLabels
    .map((label) => {
      const filePath = categoryLinks.get(label);
      if (!filePath) {
        return null;
      }
      const entries = readLeagueCareerLeaderboardEntries(filePath).map((entry) => ({
        ...entry,
        value: formatLeagueCareerLeaderboardValue(label, entry.value),
      }));
      if (!entries.length) {
        return null;
      }
      return {
        label,
        entries: entries.slice(0, 10),
      };
    })
    .filter(Boolean);
}

function extractLeagueCareerLeaderboardLinks(historyDir, historyIndexPath, rawHtml, type) {
  const targets = type === "pitching"
    ? {
        Wins: ["wins"],
        Strikeouts: ["strikeouts"],
        Innings: ["innings pitched"],
        Saves: ["saves"],
        ERA: ["earned run average"],
        Losses: ["losses"],
        "Winning Percentage": ["winning percentage"],
        Games: ["games"],
        WAR: ["wins above replacement"],
        "Complete Games": ["complete games"],
        Shutouts: ["shutouts"],
        WHIP: ["walks + hits / ip"],
      }
    : {
        "Home Runs": ["home runs"],
        WAR: ["wins above replacement"],
        Hits: ["hits"],
        "Stolen Bases": ["stolen bases"],
        Games: ["games"],
        Doubles: ["doubles"],
        Triples: ["triples"],
        OPS: ["on-base plus slugging pct"],
        "Batting Average": ["batting average"],
        Walks: ["walks"],
        OBP: ["on-base pct"],
        Slugging: ["slugging pct"],
      };
  const categoryLinks = new Map();
  const sectionIndex = type === "pitching"
    ? rawHtml.search(/CAREER PITCHING/i)
    : rawHtml.search(/CAREER BATTING/i);
  if (sectionIndex < 0) {
    return categoryLinks;
  }

  const sectionHtml = rawHtml.slice(sectionIndex);
  const rowPattern = /<tr>[\s\S]*?<td class="dc" style="font-weight:bold;">([^<]+)<\/td>[\s\S]*?<td class="dc"><a href="([^"]+)">Career<\/a><\/td>[\s\S]*?<\/tr>/gi;

  for (const match of sectionHtml.matchAll(rowPattern)) {
    const statLabel = cleanHtmlText(match[1] ?? "").toLowerCase();
    const href = cleanHtmlText(match[2] ?? "");
    if (!statLabel || !href) {
      continue;
    }

    const entry = Object.entries(targets).find(([, targetAliases]) => targetAliases.includes(statLabel));
    if (!entry) {
      continue;
    }

    const [displayLabel] = entry;
    if (!categoryLinks.has(displayLabel)) {
      categoryLinks.set(displayLabel, path.resolve(path.dirname(historyIndexPath), href));
    }
  }

  return categoryLinks;
}

function readLeagueCareerLeaderboardEntries(filePath) {
  const rawHtml = safeReadFile(filePath);
  if (!rawHtml) {
    return [];
  }

  const entries = [];
  for (const rowMatch of String(rawHtml).matchAll(/<tr>\s*<td class="dr"[^>]*>(\d+)<\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="d[rc]">([^<]+)<\/td>\s*<td class="dc">([^<]+)<\/td>/gi)) {
    const rank = Number.parseInt(cleanHtmlText(rowMatch[1] ?? ""), 10);
    if (!Number.isFinite(rank) || rank > 10) {
      continue;
    }

    entries.push({
      player: cleanHtmlText(rowMatch[2] ?? "").replace(/[#*]+$/g, "").trim(),
      value: cleanHtmlText(rowMatch[3] ?? ""),
    });
  }

  return entries;
}

function readPositionLeaderboardSummaryRows(summaryPath, rawHtml) {
  const targets = {
    "Home Runs": ["home runs"],
    WAR: ["wins above replacement"],
    Hits: ["hits"],
    "Stolen Bases": ["stolen bases"],
    Games: ["games"],
    Doubles: ["doubles"],
    Triples: ["triples"],
    OPS: ["on-base plus slugging pct"],
    "Batting Average": ["batting average"],
    Walks: ["walks"],
    OBP: ["on-base pct"],
    Slugging: ["slugging pct"],
  };
  const rows = [];
  const rowPattern = /<tr>\s*<td class="dl"><a [^>]*>[^<]+<\/a><\/td>\s*<td class="dc">[^<]+<\/td>\s*<td class="dc">[^<]+<\/td>\s*<td class="dc"><a href="([^"]+)">Season<\/a><\/td>\s*<td class="dc" style="font-weight:bold;">([^<]+)<\/td>\s*<td class="dc"><a href="([^"]+)">Career<\/a><\/td>\s*<td class="dc">[^<]+<\/td>\s*<td class="dr"><a [^>]*>[^<]+<\/a><\/td>\s*<\/tr>/gi;

  for (const match of String(rawHtml).matchAll(rowPattern)) {
    const seasonHref = cleanHtmlText(match[1] ?? "");
    const statLabel = cleanHtmlText(match[2] ?? "").toLowerCase();
    const careerHref = cleanHtmlText(match[3] ?? "");
    if (!seasonHref || !careerHref || !statLabel) {
      continue;
    }

    const targetEntry = Object.entries(targets).find(([, aliases]) => aliases.includes(statLabel));
    if (!targetEntry) {
      continue;
    }

    const [label] = targetEntry;
    rows.push({
      label,
      seasonPath: path.resolve(path.dirname(summaryPath), seasonHref),
      careerPath: path.resolve(path.dirname(summaryPath), careerHref),
    });
  }

  return rows;
}

function readPositionLeaderboardDetail(filePath, label = "") {
  const rawHtml = safeReadFile(filePath);
  if (!rawHtml) {
    return { player: "", value: "", year: "" };
  }

  const firstMatch = String(rawHtml).match(/<tr>\s*<td class="dr"[^>]*>\d+<\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="d[rc]">([^<]+)<\/td>\s*<td class="dc">([^<]+)<\/td>/i);
  if (!firstMatch) {
    return { player: "", value: "", year: "" };
  }

  return {
    player: cleanHtmlText(firstMatch[1] ?? "").replace(/[#*]+$/g, "").trim(),
    value: formatPositionLeaderboardValue(label, cleanHtmlText(firstMatch[2] ?? "")),
    year: cleanHtmlText(firstMatch[3] ?? ""),
  };
}

function formatPositionLeaderboardValue(label, value) {
  const text = cleanHtmlText(value);
  if (!text) {
    return "";
  }

  if (label === "WAR") {
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed.toFixed(1) : text;
  }

  if (["OPS", "Batting Average", "OBP", "Slugging", "WHIP", "Winning Percentage"].includes(label)) {
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed.toFixed(3).replace(/^0(?=\.)/, "") : text;
  }

  return text.replace(/(\.\d{3})\d+$/, "$1");
}

function convertToPostseasonPositionPath(filePath) {
  return String(filePath).replace("_leaderboard_season_", "_leaderboard_postseason_");
}

function convertToPostseasonCareerPositionPath(filePath) {
  return String(filePath).replace("_leaderboard_career_", "_leaderboard_postseason_career_");
}

function formatCareerInningsValue(value) {
  const text = cleanHtmlText(value);
  if (!text) {
    return "";
  }

  return text.replace(/\.\d+$/, "");
}

function formatLeagueCareerLeaderboardValue(label, value) {
  const text = cleanHtmlText(value);
  if (!text) {
    return "";
  }

  if (label === "Innings") {
    return formatCareerInningsValue(text);
  }

  if (label === "WAR") {
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed.toFixed(1) : text;
  }

  if (label === "ERA") {
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : text;
  }

  if (["OPS", "Batting Average", "OBP", "Slugging"].includes(label)) {
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed.toFixed(3).replace(/^0(?=\.)/, "") : text;
  }

  if (label === "WHIP") {
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed.toFixed(3).replace(/^0(?=\.)/, "") : text;
  }

  return text;
}

function buildPlayerNameDirectory(page) {
  if (!page?.rawHtml) {
    return {};
  }

  const players = extractTopPlayers(page);
  const directory = {};

  for (const player of players) {
    const abbreviated = abbreviatePlayerName(player.name);
    if (!abbreviated) {
      continue;
    }

    directory[buildPlayerDirectoryKey(abbreviated, player.team)] = player.name;
    directory[buildPlayerDirectoryKey(abbreviated, "")] = directory[buildPlayerDirectoryKey(abbreviated, "")] ?? player.name;
  }

  return directory;
}

function abbreviatePlayerName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2) {
    return String(name ?? "").trim();
  }

  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function buildPlayerDirectoryKey(name, team) {
  return `${String(name ?? "").trim().toLowerCase()}::${String(team ?? "").trim().toLowerCase()}`;
}

function buildLeagueView(parsedPages, leagueId, scoreHistoryPages) {
  const pages = parsedPages.filter((page) => extractLeagueId(page.fileName) === leagueId);
  const standingsPage = pages.find((page) => detectPageType(page) === "standings") ?? null;
  const statsPage = pages.find((page) => detectPageType(page) === "stats") ?? null;
  const injuriesPage = pages.find((page) => detectPageType(page) === "injuries") ?? null;
  const injuriesReportPage = pages.find((page) => detectPageType(page) === "injuries-report") ?? null;
  const transactionsPage = pages.find((page) => detectPageType(page) === "transactions") ?? null;
  const scorePage = pages.find((page) => detectPageType(page) === "scores") ?? null;
  const headlineSourcePages = pages.filter((page) => !page.fileName.toLowerCase().startsWith("toolong_"));

  return {
    leagueId,
    leagueName: getLeagueName(leagueId),
    pages,
    standingsPage,
    statsPage,
    injuriesPage,
    injuriesReportPage,
    transactionsPage,
    scorePage,
    scoreHistoryPages: scoreHistoryPages.filter((page) => extractLeagueId(page.fileName) === leagueId),
    standingsSections: buildStandingsSections(standingsPage),
    headlines: headlineSourcePages
      .flatMap((page) => buildHeadlineCandidates(page))
      .sort((left, right) => right.score - left.score)
      .slice(0, 120),
    lastDayScores: buildLastDayScores(selectLatestCompletedScoresPage(scoreHistoryPages, leagueId)),
    scheduledGames: buildScheduledGames(
      scorePage,
      scoreHistoryPages.filter((page) => extractLeagueId(page.fileName) === leagueId),
    ),
  };
}

function attachScoreTeamRecords(games, standingsSections) {
  if (!games?.length || !standingsSections?.length) {
    return games ?? [];
  }

  const recordByTeamKey = new Map();

  for (const section of standingsSections) {
    for (const row of section.rows ?? []) {
      const record = buildTeamRecord(row);
      if (!record) {
        continue;
      }

      for (const key of buildTeamLookupKeys(row.Team)) {
        if (!recordByTeamKey.has(key)) {
          recordByTeamKey.set(key, record);
        }
      }
    }
  }

  return games.map((game) => ({
    ...game,
    awayRecord: findTeamRecord(recordByTeamKey, game.awayTeam),
    homeRecord: findTeamRecord(recordByTeamKey, game.homeTeam),
  }));
}

function buildTeamRecord(row) {
  const wins = String(row.W ?? "").trim();
  const losses = String(row.L ?? "").trim();
  return wins && losses ? `${wins}-${losses}` : "";
}

function findTeamRecord(recordByTeamKey, teamName) {
  for (const key of buildTeamLookupKeys(teamName)) {
    const record = recordByTeamKey.get(key);
    if (record) {
      return record;
    }
  }

  return "";
}

function buildTeamLookupKeys(teamName) {
  const normalizedName = normalizeTeamLookupValue(teamName);
  if (!normalizedName) {
    return [];
  }

  const keys = new Set([normalizedName]);
  const marketOnly = normalizedName.replace(
    /\s+(red wings|capitales|sidewinders|privateers|canadians|grizzlies|river cats|isotopes|emeralds|knights|bananas|clippers|wizards|dragons|mets|bulls|sea dogs|mud hens|ospreys|eagles|tides|cannons|indians|tigers|missions|mudcats|blaze|berries|aigles|yard goats|iron pigs|curve|pippins|goldeyes)$/i,
    "",
  ).trim();

  if (marketOnly) {
    keys.add(marketOnly);
  }

  return [...keys];
}

function normalizeTeamLookupValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function choosePreferredLeagueId(parsedPages) {
  const firstStandingsLeagueId = parsedPages
    .find((page) => detectPageType(page) === "standings" && !page.fileName.startsWith("league__"));

  return extractLeagueId(firstStandingsLeagueId?.fileName);
}

function getLeagueName(leagueId) {
  if (leagueId === "200") {
    return "American Baseball Association";
  }

  if (leagueId === "201") {
    return "Frontier League";
  }

  return "League";
}

function looksLikeStandings(headers) {
  return headers.includes("W") && headers.includes("L") && (headers.includes("GB") || headers.includes("PCT"));
}

function looksLikeBatting(headers) {
  return headers.includes("AVG") && (headers.includes("HR") || headers.includes("RBI") || headers.includes("OPS"));
}

function looksLikePitching(headers) {
  return headers.includes("ERA") && (headers.includes("SO") || headers.includes("K") || headers.includes("SV") || headers.includes("S") || headers.includes("WHIP"));
}

function normalizeRows(table, limit) {
  return table.rows.slice(0, limit).map((row) => {
    const record = {};
    table.headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
}

function buildStandingsSections(page) {
  if (!page) {
    return [];
  }

  return page.tables
    .filter((table) => looksLikeStandings(table.headers.map((header) => header.toUpperCase())))
    .map((table) => ({
      label: formatStandingsSectionLabel(table.label || "Standings"),
      originalLabel: cleanHtmlText(table.label || "Standings"),
      conference: extractStandingsConference(table.label || ""),
      kind: /WILDCARD/i.test(table.label || "") ? "wildcard" : "division",
      rows: normalizeStandingsRows(table, /WILDCARD/i.test(table.label || "") ? 9 : 12).map((row) => ({
        Team: simplifyTeamName(row.Team ?? row.TEAM ?? ""),
        W: row.W ?? "",
        L: row.L ?? "",
        GB: row.GB ?? "",
        L10: getStandingsColumnValue(row, ["Last10", "L10"]),
        Strk: getStandingsColumnValue(row, ["Streak", "Strk"]),
        "M#": getStandingsColumnValue(row, ["M#", "Magic Number", "Magic"]),
      })),
    }))
    .filter((section) => section.rows.length > 0);
}

function extractStandingsConference(label) {
  const normalized = String(label ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (normalized.includes("CONFERENCE NORTH")) {
    return "north";
  }
  if (normalized.includes("CONFERENCE SOUTH")) {
    return "south";
  }
  return "";
}

function getStandingsColumnValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function buildChampionshipChase(leagueView, options = {}) {
  const standingsSections = leagueView?.standingsSections ?? [];
  if (!standingsSections.length) {
    return null;
  }

  const divisionWinnerCount = options.divisionWinnerCount ?? 3;
  const wildcardCount = options.wildcardCount ?? 2;
  const huntCount = options.huntCount ?? 3;
  const currentDate = determineLeagueCalendarDate(leagueView);
  const phase = determineChampionshipChasePhase(currentDate, leagueView, options);
  if (phase === "offseason") {
    return null;
  }

  const teamDirectory = buildActiveTeamDirectory(leagueView?.leagueId ?? "");
  const postseasonResults = phase === "playoffs"
    ? buildLeaguePostseasonResults(leagueView, currentDate)
    : [];
  const playoffSeriesTracker = phase === "playoffs"
    ? buildPlayoffSeriesTracker(leagueView)
    : new Map();
  const conferences = ["north", "south"]
    .map((conference) => buildChampionshipConference(conference, standingsSections, teamDirectory, {
      divisionWinnerCount,
      wildcardCount,
      huntCount,
      phase,
      seriesLabels: options.seriesLabels,
      postseasonResults,
      playoffSeriesTracker,
    }))
    .filter((conference) => conference?.divisionWinners?.length === divisionWinnerCount && conference?.wildcards?.length >= wildcardCount);

  if (!conferences.length) {
    return null;
  }

  const inTheHunt = conferences
    .flatMap((conference) => conference.inTheHunt.map((team) => ({ ...team, conference: conference.label })))
    .sort(compareChampionshipBubbleTeams)
    .slice(0, huntCount);
  const championshipMatchup = buildChampionshipFinalMatchup(conferences, phase);

  return {
    phase,
    dateLabel: currentDate ? formatChampionshipChaseDate(currentDate) : "",
    title: phase === "playoffs" ? (options.titlePlayoffs ?? "Playoff Bracket") : (options.titleRegular ?? "Projected Playoff Bracket"),
    conferences,
    inTheHunt,
    championshipMatchup,
    championshipSeriesLabel: options.championshipSeriesLabel ?? "Championship Series (4 of 7)",
  };
}

function buildChampionshipFinalMatchup(conferences = [], phase = "regular") {
  if (phase !== "playoffs") {
    return [
      { placeholder: "North finalist" },
      { placeholder: "South finalist" },
    ];
  }

  return (conferences ?? []).slice(0, 2).map((conference) => {
    const conferenceSeries = conference?.rounds?.conference?.[0];
    const advancedTeam = (conferenceSeries?.matchup ?? []).find((entry) => entry && !entry.placeholder && entry.advanced);
    if (advancedTeam) {
      return {
        ...advancedTeam,
        seriesWins: "0",
        advanced: false,
        eliminated: false,
      };
    }
    return { placeholder: "Conference finalist" };
  });
}

function determineLeagueCalendarDate(leagueView) {
  const latestCompletedScoresPage = selectLatestCompletedScoresPage(leagueView?.scoreHistoryPages ?? [], leagueView?.leagueId);
  const sources = [
    latestCompletedScoresPage?.title,
    latestCompletedScoresPage?.summary,
    latestCompletedScoresPage?.rawHtml,
    leagueView?.scorePage?.title,
    leagueView?.scorePage?.summary,
    leagueView?.scorePage?.rawHtml,
    leagueView?.standingsPage?.title,
    leagueView?.standingsPage?.summary,
    leagueView?.standingsPage?.rawHtml,
  ];

  for (const source of sources) {
    const scoreboardDate = parseScoreboardDate(source);
    if (scoreboardDate) {
      return scoreboardDate;
    }

    const shortMatch = String(source ?? "").match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (shortMatch) {
      return new Date(`${shortMatch[3]}-${shortMatch[1]}-${shortMatch[2]}T00:00:00Z`);
    }
  }

  return null;
}

function determineChampionshipChasePhase(currentDate, leagueView, options = {}) {
  const mode = determineLeagueMode(currentDate, leagueView);

  if (mode === "OFFSEASON" || mode === "PRESEASON" || mode === "SPRING") {
    return "offseason";
  }

  if (mode === "PLAYOFFS" || mode === "SEASON_ENDED" || hasLeaguePlayoffIndicators(leagueView, currentDate, options)) {
    return "playoffs";
  }

  return "regular";
}

function determineLeagueMode(currentDate, leagueView) {
  if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    return "";
  }

  const month = currentDate.getUTCMonth() + 1;
  const day = currentDate.getUTCDate();
  const championCrowned = hasLeagueChampion(leagueView, currentDate);

  if (month === 8 && day >= 18) {
    return "OFFSEASON";
  }

  if (championCrowned && (month > 7 || (month === 7 && day >= 17)) && !(month === 8 && day >= 18)) {
    return "SEASON_ENDED";
  }

  if (month === 7 && day >= 17) {
    return "PLAYOFFS";
  }

  if (month === 6 && day >= 3) {
    return "LATE_SEASON";
  }

  if (month === 5) {
    return "MIDDLE_SEASON";
  }

  if (month === 4) {
    return "EARLY_SEASON";
  }

  if (month === 3 && day >= 11) {
    return "SPRING";
  }

  if ((month === 2 && day >= 9) || month === 3) {
    return "PRESEASON";
  }

  return "OFFSEASON";
}

function hasLeagueChampion(leagueView, currentDate) {
  const postseasonResults = buildLeaguePostseasonResults(leagueView, currentDate);
  return postseasonResults.some((result) => /championship series/i.test(String(result?.stage ?? "")));
}

function hasLeaguePlayoffIndicators(leagueView, currentDate, options = {}) {
  const postseasonResults = buildLeaguePostseasonResults(leagueView, currentDate);
  if (postseasonResults.length > 0) {
    return true;
  }

  const patterns = options.playoffTextIndicators ?? [];
  if (!patterns.length) {
    return false;
  }

  const sources = (leagueView?.pages ?? [])
    .map((page) => `${page?.title ?? ""}\n${page?.summary ?? ""}\n${page?.rawHtml ?? ""}`);

  return patterns.some((pattern) => sources.some((source) => pattern.test(String(source ?? ""))));
}

function buildLeaguePostseasonResults(leagueView, currentDate) {
  const leagueId = leagueView?.leagueId ?? "";
  if (!leagueId || !(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    return [];
  }

  const seasonYear = currentDate.getUTCFullYear();
  const results = [];
  const seen = new Set();

  for (const conferenceIndex of [0, 1]) {
    const filePath = path.resolve("News", "history", `sl_stats_${leagueId}_${conferenceIndex}_${seasonYear}.html`);
    const rawHtml = safeReadFile(filePath);
    if (!rawHtml) {
      continue;
    }

    for (const result of parseLeaguePostseasonResults(rawHtml)) {
      const key = `${result.stage}|${normalizeTeamLookupValue(result.winner)}|${normalizeTeamLookupValue(result.loser)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(result);
    }
  }

  return results;
}

function parseLeaguePostseasonResults(rawHtml) {
  if (!rawHtml) {
    return [];
  }

  const results = [];
  for (const match of String(rawHtml).matchAll(/<td[^>]*class="dl"[^>]*>(Wilcard Round|Wildcard Round|Wild Card Series|Division Series|Conference Championship(?: Series)?|Conference Series|Championship Series)<\/td>\s*<td[^>]*class="dl"[^>]*>([^<]+)<\/td>/gi)) {
    const stage = cleanHtmlText(match[1] ?? "");
    const summary = cleanHtmlText(match[2] ?? "");
    const parsed = parseLeaguePostseasonResultSummary(stage, summary);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

function parseLeaguePostseasonResultSummary(stage, summary) {
  const normalizedStage = cleanHtmlText(stage);
  const normalizedSummary = cleanHtmlText(summary);
  const match = normalizedSummary.match(/^(.+?)\s+over\s+(.+?),\s*(\d+)-(\d+)$/i);
  if (!normalizedStage || !match) {
    return null;
  }

  const leftTeam = cleanHtmlText(match[1] ?? "");
  const rightTeam = cleanHtmlText(match[2] ?? "");
  const leftWins = Number.parseInt(match[3] ?? "0", 10) || 0;
  const rightWins = Number.parseInt(match[4] ?? "0", 10) || 0;
  const winnerIsLeft = leftWins >= rightWins;

  return {
    stage: normalizedStage,
    winner: winnerIsLeft ? leftTeam : rightTeam,
    loser: winnerIsLeft ? rightTeam : leftTeam,
    winnerWins: winnerIsLeft ? leftWins : rightWins,
    loserWins: winnerIsLeft ? rightWins : leftWins,
  };
}

function buildChampionshipConference(conferenceKey, standingsSections, teamDirectory, options = {}) {
  const divisionWinnerCount = options.divisionWinnerCount ?? 3;
  const wildcardCount = options.wildcardCount ?? 2;
  const huntCount = options.huntCount ?? 3;
  const divisionSections = standingsSections.filter((section) => section.conference === conferenceKey && section.kind === "division");
  const wildcardSection = standingsSections.find((section) => section.conference === conferenceKey && section.kind === "wildcard");
  if (divisionSections.length < divisionWinnerCount || !wildcardSection?.rows?.length) {
    return null;
  }

  const conferenceTeamKeys = new Set(
    [...divisionSections.flatMap((section) => section.rows ?? []), ...(wildcardSection?.rows ?? [])]
      .flatMap((row) => buildTeamLookupKeys(cleanHtmlText(row?.Team ?? ""))),
  );

  const divisionWinners = divisionSections
    .map((section) => decorateChampionshipTeam(section.rows[0], teamDirectory, section.label))
    .filter(Boolean)
    .sort(compareChampionshipQualifiedTeams)
    .slice(0, divisionWinnerCount)
    .map((team, index) => ({ ...team, seed: index + 1 }));

  const qualifiedTeamKeys = new Set();
  for (const team of divisionWinners) {
    for (const key of buildTeamLookupKeys(team?.team ?? team?.fullName ?? "")) {
      qualifiedTeamKeys.add(key);
    }
    qualifiedTeamKeys.add(normalizeTeamLookupValue(team?.team ?? ""));
    qualifiedTeamKeys.add(normalizeTeamLookupValue(team?.fullName ?? ""));
  }

  const wildcardCandidates = wildcardSection.rows
    .filter((row) => {
      const teamName = cleanHtmlText(row?.Team ?? "");
      const keys = new Set([
        normalizeTeamLookupValue(teamName),
        ...buildTeamLookupKeys(teamName),
      ]);
      for (const key of keys) {
        if (qualifiedTeamKeys.has(key)) {
          return false;
        }
      }
      return true;
    })
    .map((row) => decorateChampionshipTeam(row, teamDirectory, wildcardSection.label))
    .filter(Boolean);

  const wildcardTeams = wildcardCandidates
    .slice(0, wildcardCount)
    .sort(compareChampionshipQualifiedTeams)
    .map((team, index) => ({ ...team, seed: index + divisionWinnerCount + 1 }));

  for (const team of wildcardTeams) {
    for (const key of buildTeamLookupKeys(team?.team ?? team?.fullName ?? "")) {
      qualifiedTeamKeys.add(key);
    }
    qualifiedTeamKeys.add(normalizeTeamLookupValue(team?.team ?? ""));
    qualifiedTeamKeys.add(normalizeTeamLookupValue(team?.fullName ?? ""));
  }

  const divisionContenders = divisionSections
    .flatMap((section) => (section.rows ?? []).slice(1).map((row) => ({ row, sectionLabel: section.label })))
    .filter(({ row }) => {
      const teamName = cleanHtmlText(row?.Team ?? "");
      const keys = new Set([
        normalizeTeamLookupValue(teamName),
        ...buildTeamLookupKeys(teamName),
      ]);
      for (const key of keys) {
        if (qualifiedTeamKeys.has(key)) {
          return false;
        }
      }
      return true;
    })
    .map(({ row, sectionLabel }) => decorateChampionshipTeam(row, teamDirectory, sectionLabel))
    .filter(Boolean);

  const huntPool = [
    ...wildcardCandidates.slice(wildcardCount),
    ...divisionContenders,
  ];

  const bestHuntEntryByTeam = new Map();
  for (const team of huntPool) {
    const teamKey = normalizeTeamLookupValue(team?.fullName ?? team?.team ?? "");
    if (!teamKey) {
      continue;
    }

    const existing = bestHuntEntryByTeam.get(teamKey);
    if (!existing || compareChampionshipBubbleTeams(team, existing) < 0) {
      bestHuntEntryByTeam.set(teamKey, team);
    }
  }

  const inTheHunt = [...bestHuntEntryByTeam.values()]
    .sort(compareChampionshipBubbleTeams)
    .slice(0, huntCount);

  const [seed1, seed2, seed3] = divisionWinners;
  const [wildcardOne, wildcardTwo] = wildcardTeams;
  let wildcardRound = [];
  let divisionSeriesMatchups = [];
  let conferenceSeriesMatchups = [];

  if (divisionWinnerCount === 2 && wildcardCount === 1) {
    divisionSeriesMatchups.push({
      matchup: [seed1, wildcardOne].filter(Boolean),
    });
    conferenceSeriesMatchups.push({
      matchup: [seed2, { placeholder: "Division Series winner" }].filter(Boolean),
    });
  } else if (divisionWinnerCount === 3 && wildcardCount === 1) {
    divisionSeriesMatchups.push({
      matchup: [seed1, wildcardOne].filter(Boolean),
    });
    divisionSeriesMatchups.push({
      matchup: [seed2, seed3].filter(Boolean),
    });
    conferenceSeriesMatchups.push({
      matchup: [{ placeholder: "Division Series winner" }, { placeholder: "Division Series winner" }],
    });
  } else if (divisionWinnerCount === 2 && wildcardCount === 2) {
    divisionSeriesMatchups.push({
      matchup: [seed1, wildcardTwo].filter(Boolean),
    });
    divisionSeriesMatchups.push({
      matchup: [seed2, wildcardOne].filter(Boolean),
    });
    conferenceSeriesMatchups.push({
      matchup: [{ placeholder: "Division Series winner" }, { placeholder: "Division Series winner" }],
    });
  } else {
    wildcardRound = [
      {
        matchup: [wildcardOne, wildcardTwo].filter(Boolean),
        placeholderWinner: `${conferenceKey === "north" ? "North" : "South"} wild card winner`,
      },
    ];
    divisionSeriesMatchups.push({
      matchup: [seed1, { placeholder: "Wild Card winner" }],
    });
    divisionSeriesMatchups.push({
      matchup: [seed2, seed3].filter(Boolean),
    });
    conferenceSeriesMatchups.push({
      matchup: [{ placeholder: "Division Series winner" }, { placeholder: "Division Series winner" }],
    });
  }

  const conferenceResults = (options.postseasonResults ?? []).filter((result) => {
    const winnerKeys = buildTeamLookupKeys(result.winner);
    const loserKeys = buildTeamLookupKeys(result.loser);
    return winnerKeys.some((key) => conferenceTeamKeys.has(key)) && loserKeys.some((key) => conferenceTeamKeys.has(key));
  });

  if (options.phase === "playoffs" && conferenceResults.length) {
    const knownTeams = [...divisionWinners, ...wildcardTeams];
    wildcardRound = applyPlayoffResultsToRound(
      wildcardRound,
      conferenceResults,
      "wildcard",
      teamDirectory,
      knownTeams,
      standingsSections,
      options,
    );
    divisionSeriesMatchups = applyPlayoffResultsToRound(
      divisionSeriesMatchups,
      conferenceResults,
      "division",
      teamDirectory,
      knownTeams,
      standingsSections,
      options,
    );
    conferenceSeriesMatchups = applyPlayoffResultsToRound(
      conferenceSeriesMatchups,
      conferenceResults,
      "conference",
      teamDirectory,
      knownTeams,
      standingsSections,
      options,
    );
  }

  if (options.phase === "playoffs") {
    wildcardRound = applyPlayoffSeriesTrackerToRound(wildcardRound, options.playoffSeriesTracker);
    divisionSeriesMatchups = applyPlayoffSeriesTrackerToRound(divisionSeriesMatchups, options.playoffSeriesTracker);
    conferenceSeriesMatchups = applyPlayoffSeriesTrackerToRound(conferenceSeriesMatchups, options.playoffSeriesTracker);
    wildcardRound = addDefaultSeriesWins(wildcardRound);
    divisionSeriesMatchups = addDefaultSeriesWins(divisionSeriesMatchups);
    conferenceSeriesMatchups = addDefaultSeriesWins(conferenceSeriesMatchups);
    divisionSeriesMatchups = promoteAdvancedTeamsIntoRoundPlaceholders(divisionSeriesMatchups, wildcardRound, "Wild Card winner");
    conferenceSeriesMatchups = promoteAdvancedTeamsIntoRoundPlaceholders(conferenceSeriesMatchups, divisionSeriesMatchups, "Division Series winner");
    divisionSeriesMatchups = applyPlayoffSeriesTrackerToRound(divisionSeriesMatchups, options.playoffSeriesTracker);
    conferenceSeriesMatchups = applyPlayoffSeriesTrackerToRound(conferenceSeriesMatchups, options.playoffSeriesTracker);
    divisionSeriesMatchups = addDefaultSeriesWins(divisionSeriesMatchups);
    conferenceSeriesMatchups = addDefaultSeriesWins(conferenceSeriesMatchups);
    if (conferenceResults.length) {
      const knownTeams = [...divisionWinners, ...wildcardTeams];
      wildcardRound = applyPlayoffResultsToRound(
        wildcardRound,
        conferenceResults,
        "wildcard",
        teamDirectory,
        knownTeams,
        standingsSections,
        options,
      );
      divisionSeriesMatchups = applyPlayoffResultsToRound(
        divisionSeriesMatchups,
        conferenceResults,
        "division",
        teamDirectory,
        knownTeams,
        standingsSections,
        options,
      );
      conferenceSeriesMatchups = applyPlayoffResultsToRound(
        conferenceSeriesMatchups,
        conferenceResults,
        "conference",
        teamDirectory,
        knownTeams,
        standingsSections,
        options,
      );
    }
  }

  return {
    key: conferenceKey,
    label: conferenceKey === "north" ? "Conference North" : "Conference South",
    seriesLabels: {
      wildcard: options.seriesLabels?.wildcard ?? "Wild Card Series (3 of 5)",
      division: options.seriesLabels?.division ?? "Division Series (4 of 7)",
      conference: options.seriesLabels?.conference ?? "Conference Series (4 of 7)",
    },
    divisionWinners,
    wildcards: wildcardTeams,
    inTheHunt,
    rounds: {
      wildcard: wildcardRound,
      division: divisionSeriesMatchups,
      conference: conferenceSeriesMatchups,
    },
  };
}

function applyPlayoffResultsToRound(roundMatchups, postseasonResults, roundKey, teamDirectory, knownTeams, standingsSections, options = {}) {
  const stageMatches = postseasonResults
    .filter((result) => resolvePlayoffStageKey(result.stage) === roundKey)
    .map((result) => buildResolvedPlayoffMatchup(result, roundKey, teamDirectory, knownTeams, standingsSections, options))
    .filter(Boolean)
    .sort(compareResolvedPlayoffMatchups);

  return stageMatches.length ? stageMatches : roundMatchups;
}

function buildResolvedPlayoffMatchup(result, roundKey, teamDirectory, knownTeams, standingsSections, options = {}) {
  const winsNeeded = getPlayoffRoundWinsNeeded(roundKey, options);
  const winnerEntry = resolvePlayoffTeamEntry(result.winner, teamDirectory, knownTeams, standingsSections);
  const loserEntry = resolvePlayoffTeamEntry(result.loser, teamDirectory, knownTeams, standingsSections);
  if (!winnerEntry || !loserEntry) {
    return null;
  }

  const winnerAdvanced = result.winnerWins >= winsNeeded;
  const loserAdvanced = result.loserWins >= winsNeeded;

  return {
    matchup: [
      {
        ...winnerEntry,
        seriesWins: String(result.winnerWins),
        advanced: winnerAdvanced,
        eliminated: !winnerAdvanced && loserAdvanced,
      },
      {
        ...loserEntry,
        seriesWins: String(result.loserWins),
        advanced: loserAdvanced,
        eliminated: !loserAdvanced && winnerAdvanced,
      },
    ],
  };
}

function resolvePlayoffTeamEntry(teamName, teamDirectory, knownTeams = [], standingsSections = []) {
  const matchedKnownTeam = knownTeams.find((team) =>
    buildTeamLookupKeys(team?.fullName ?? team?.team ?? "").some((key) => buildTeamLookupKeys(teamName).includes(key)),
  );
  if (matchedKnownTeam) {
    return matchedKnownTeam;
  }

  const standingsMatch = findStandingsTeamEntry(teamName, standingsSections, teamDirectory);
  if (standingsMatch) {
    return standingsMatch;
  }

  const directoryEntry = resolveChampionshipTeamDirectoryEntry(teamName, teamDirectory);
  return {
    team: teamName,
    displayName: directoryEntry?.shortName || teamName,
    fullName: directoryEntry?.fullName || teamName,
    wins: 0,
    losses: 0,
    record: "",
    gb: "",
    l10: "",
    streak: "",
    magicNumber: "",
    logoUrl: directoryEntry?.logoUrl || "",
    logoAlt: directoryEntry?.logoAlt || teamName,
    sectionLabel: "",
    seed: "",
  };
}

function findTeamConferenceByStandings(teamName, standingsSections = []) {
  for (const section of standingsSections ?? []) {
    for (const row of section.rows ?? []) {
      if (buildTeamLookupKeys(row?.Team ?? "").some((key) => buildTeamLookupKeys(teamName).includes(key))) {
        return section.conference;
      }
    }
  }
  return "";
}

function findStandingsTeamEntry(teamName, standingsSections = [], teamDirectory) {
  for (const section of standingsSections ?? []) {
    for (const row of section.rows ?? []) {
      if (buildTeamLookupKeys(row?.Team ?? "").some((key) => buildTeamLookupKeys(teamName).includes(key))) {
        return decorateChampionshipTeam(row, teamDirectory, section.label);
      }
    }
  }
  return null;
}

function compareResolvedPlayoffMatchups(left, right) {
  const leftSeed = Math.min(...(left?.matchup ?? []).map((team) => Number.parseInt(team?.seed ?? "99", 10) || 99));
  const rightSeed = Math.min(...(right?.matchup ?? []).map((team) => Number.parseInt(team?.seed ?? "99", 10) || 99));
  return leftSeed - rightSeed;
}

function resolvePlayoffStageKey(stageLabel) {
  const normalized = String(stageLabel ?? "").toLowerCase();
  if (normalized.includes("wild") || normalized.includes("wilcard")) {
    return "wildcard";
  }
  if (normalized.includes("division")) {
    return "division";
  }
  if (normalized.includes("conference")) {
    return "conference";
  }
  if (normalized.includes("championship")) {
    return "championship";
  }
  return "";
}

function getPlayoffRoundWinsNeeded(roundKey, options = {}) {
  if (roundKey === "wildcard") {
    return options.seriesWinTargets?.wildcard ?? 3;
  }
  if (roundKey === "championship") {
    return options.seriesWinTargets?.championship ?? 4;
  }
  return options.seriesWinTargets?.[roundKey] ?? 4;
}

function addDefaultSeriesWins(rounds = []) {
  return (rounds ?? []).map((series) => ({
    ...series,
    matchup: (series?.matchup ?? []).map((entry) => {
      if (!entry || entry.placeholder) {
        return entry;
      }
      if (entry.seriesWins !== undefined && entry.seriesWins !== null && String(entry.seriesWins).trim() !== "") {
        return entry;
      }
      return {
        ...entry,
        seriesWins: "0",
      };
    }),
  }));
}

function promoteAdvancedTeamsIntoRoundPlaceholders(targetRound = [], sourceRound = [], placeholderLabel = "") {
  const advancedTeams = (sourceRound ?? [])
    .map((series) => (series?.matchup ?? []).find((entry) => entry && !entry.placeholder && entry.advanced))
    .filter(Boolean);

  if (!advancedTeams.length) {
    return targetRound;
  }

  let advancedIndex = 0;
  return (targetRound ?? []).map((series) => ({
    ...series,
    matchup: (series?.matchup ?? []).map((entry) => {
      if (!entry?.placeholder || !new RegExp(placeholderLabel, "i").test(entry.placeholder)) {
        return entry;
      }

      const replacement = advancedTeams[advancedIndex];
      if (!replacement) {
        return entry;
      }

      advancedIndex += 1;
      return {
        ...replacement,
        seriesWins: "0",
        advanced: false,
        eliminated: false,
      };
    }),
  }));
}

function buildPlayoffSeriesTracker(leagueView) {
  const tracker = new Map();
  const scheduleDate = parseCurrentScoreboardDate(leagueView?.scorePage);
  const scoreHistoryPages = mergeScoreHistoryPages(
    leagueView?.scoreHistoryPages ?? [],
    loadScoreHistoryPagesForLeague(leagueView?.leagueId ?? ""),
  );
  if (!scheduleDate || !scoreHistoryPages.length || !leagueView?.scorePage?.rawHtml) {
    return tracker;
  }

  const blockPattern =
    /<table cellspacing="0" cellpadding="0" width="478px" height="100%" class="databg">[\s\S]*?<td class="dl" width="210px"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl" width="210px">([^<]+)<\/td>[\s\S]*?<td class="dl" width="210px"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl" width="210px">([^<]+)<\/td>[\s\S]*?<\/table>\s*<\/td>\s*<\/tr>\s*<\/table>/gi;

  for (const match of String(leagueView.scorePage.rawHtml).matchAll(blockPattern)) {
    const awayTeam = cleanHtmlText(match[1] ?? "");
    const homeTeam = cleanHtmlText(match[3] ?? "");
    if (!awayTeam || !homeTeam) {
      continue;
    }

    const context = inferScheduledSeriesContext(awayTeam, homeTeam, scheduleDate, scoreHistoryPages);
    tracker.set(buildSeriesMatchupKey(awayTeam, homeTeam), context);
  }

  return tracker;
}

function mergeScoreHistoryPages(primaryPages = [], fallbackPages = []) {
  const merged = new Map();

  for (const page of [...fallbackPages, ...primaryPages]) {
    const key = String(page?.fileName ?? "").toLowerCase();
    if (!key || merged.has(key)) {
      continue;
    }
    merged.set(key, page);
  }

  return [...merged.values()];
}

function loadScoreHistoryPagesForLeague(leagueId) {
  if (!leagueId) {
    return [];
  }

  const leaguesDir = path.resolve("News", "leagues");
  if (!fs.existsSync(leaguesDir)) {
    return [];
  }

  return fs
    .readdirSync(leaguesDir)
    .filter((fileName) => new RegExp(`^league_${leagueId}_scores_\\d{4}_\\d{2}_\\d{2}\\.html$`, "i").test(fileName))
    .sort((left, right) => right.localeCompare(left))
    .map((fileName) => {
      const filePath = path.join(leaguesDir, fileName);
      const rawHtml = safeReadFile(filePath);
      return {
        fileName,
        filePath,
        rawHtml,
        title: cleanHtmlText(rawHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
        summary: "",
      };
    })
    .filter((page) => page.rawHtml);
}

function applyPlayoffSeriesTrackerToRound(rounds = [], tracker = new Map()) {
  return (rounds ?? []).map((series) => {
    const entries = (series?.matchup ?? []).filter((entry) => entry && !entry.placeholder);
    if (entries.length !== 2) {
      return series;
    }

    const context = tracker.get(buildSeriesMatchupKey(entries[0].team, entries[1].team));
    if (!context) {
      return series;
    }

    return {
      ...series,
      matchup: (series?.matchup ?? []).map((entry) => {
        if (!entry || entry.placeholder) {
          return entry;
        }

        const seriesWins = context.winsByTeam?.get(entry.team)
          ?? context.winsByKey?.get(buildCanonicalSeriesTeamKey(entry.team))
          ?? 0;
        const winsNeeded = context.winsNeeded ?? 4;
        const advanced = seriesWins >= winsNeeded;
        const opponentMaxWins = Math.max(
          ...entries
            .filter((candidate) => candidate.team !== entry.team)
            .map((candidate) =>
              context.winsByTeam?.get(candidate.team)
              ?? context.winsByKey?.get(buildCanonicalSeriesTeamKey(candidate.team))
              ?? 0,
            ),
          0,
        );

        return {
          ...entry,
          seriesWins: String(seriesWins),
          advanced,
          eliminated: !advanced && opponentMaxWins >= winsNeeded,
        };
      }),
    };
  });
}

function buildActiveTeamDirectory(preferredLeagueId = "") {
  const teamsDir = path.resolve("News", "teams");
  if (!fs.existsSync(teamsDir)) {
    return new Map();
  }

  const smallLogoDirectory = buildSmallTeamLogoDirectory(preferredLeagueId);
  const directory = new Map(smallLogoDirectory);
  const files = fs
    .readdirSync(teamsDir)
    .filter((fileName) => /^team_\d+\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of files) {
    const teamPath = path.resolve(teamsDir, fileName);
    const rawHtml = safeReadFile(teamPath);
    if (!rawHtml) {
      continue;
    }

    const name = cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    if (!name) {
      continue;
    }

    const logoMatch = rawHtml.match(/<img src="([^"]+team_logos\/[^"]+)" border="0" title="([^"]*)"/i);
    const smallLogoEntry = resolveChampionshipTeamDirectoryEntry(name, smallLogoDirectory);
    const entry = {
      fullName: name,
      shortName: simplifyTeamName(name),
      logoUrl: smallLogoEntry?.logoUrl || toNewsLocalUrl(teamPath, logoMatch?.[1] ?? ""),
      logoAlt: smallLogoEntry?.logoAlt || cleanHtmlText(logoMatch?.[2] ?? name),
    };

    for (const key of buildTeamLookupKeys(name)) {
      if (!directory.has(key)) {
        directory.set(key, entry);
      }
    }
    const shortKey = normalizeTeamLookupValue(entry.shortName);
    if (shortKey && !directory.has(shortKey)) {
      directory.set(shortKey, entry);
    }
  }

  return directory;
}

function buildSmallTeamLogoDirectory(preferredLeagueId = "") {
  const leaguesDir = path.resolve("News", "leagues");
  if (!fs.existsSync(leaguesDir)) {
    return new Map();
  }

  const directory = new Map();
  const teamPages = fs
    .readdirSync(leaguesDir)
    .filter((fileName) => /^league_\d+_teams\.html$/i.test(fileName))
    .filter((fileName) => !preferredLeagueId || extractLeagueId(fileName) === preferredLeagueId)
    .sort((left, right) => left.localeCompare(right));

  const teamPattern = /<img src="([^"]+team_logos\/[^"]+)"[^>]*>\s*<\/td>\s*<td[^>]*>[\s\S]*?<span style="font-weight:bold;">([^<]+)<\/span>/gi;

  for (const fileName of teamPages) {
    const filePath = path.resolve(leaguesDir, fileName);
    const rawHtml = safeReadFile(filePath);
    if (!rawHtml) {
      continue;
    }

    for (const match of rawHtml.matchAll(teamPattern)) {
      const name = cleanHtmlText(match[2] ?? "");
      if (!name) {
        continue;
      }

      const entry = {
        fullName: name,
        shortName: simplifyTeamName(name),
        logoUrl: toNewsLocalUrl(filePath, match[1] ?? ""),
        logoAlt: name,
      };

      for (const key of buildTeamLookupKeys(name)) {
        if (!directory.has(key)) {
          directory.set(key, entry);
        }
      }
      const shortKey = normalizeTeamLookupValue(entry.shortName);
      if (shortKey && !directory.has(shortKey)) {
        directory.set(shortKey, entry);
      }
    }
  }

  return directory;
}

function decorateChampionshipTeam(row, teamDirectory, sectionLabel) {
  const teamName = cleanHtmlText(row?.Team ?? "");
  if (!teamName) {
    return null;
  }

  const directoryEntry = resolveChampionshipTeamDirectoryEntry(teamName, teamDirectory);
  return {
    team: teamName,
    displayName: directoryEntry?.shortName || teamName,
    fullName: directoryEntry?.fullName || teamName,
    wins: toNumber(row?.W),
    losses: toNumber(row?.L),
    record: `${cleanHtmlText(row?.W ?? "")}-${cleanHtmlText(row?.L ?? "")}`,
    gb: cleanHtmlText(row?.GB ?? ""),
    l10: cleanHtmlText(row?.L10 ?? ""),
    streak: cleanHtmlText(row?.Strk ?? ""),
    magicNumber: cleanHtmlText(row?.["M#"] ?? ""),
    logoUrl: directoryEntry?.logoUrl || "",
    logoAlt: directoryEntry?.logoAlt || teamName,
    sectionLabel,
  };
}

function resolveChampionshipTeamDirectoryEntry(teamName, teamDirectory) {
  for (const key of buildTeamLookupKeys(teamName)) {
    const entry = teamDirectory.get(key);
    if (entry) {
      return entry;
    }
  }
  return null;
}

function compareChampionshipQualifiedTeams(left, right) {
  return (
    right.wins - left.wins ||
    left.losses - right.losses ||
    compareGamesBack(left.gb, right.gb) ||
    left.team.localeCompare(right.team)
  );
}

function compareChampionshipBubbleTeams(left, right) {
  return (
    compareGamesBack(left.gb, right.gb) ||
    right.wins - left.wins ||
    left.losses - right.losses ||
    left.team.localeCompare(right.team)
  );
}

function compareGamesBack(leftGb, rightGb) {
  return normalizeGamesBackValue(leftGb) - normalizeGamesBackValue(rightGb);
}

function normalizeGamesBackValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || /^w$/i.test(text)) {
    return 0;
  }
  const numeric = Number.parseFloat(text);
  return Number.isFinite(numeric) ? numeric : 999;
}

function formatChampionshipChaseDate(currentDate) {
  return currentDate.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function normalizeStandingsRows(table, limit) {
  const headers = table.headers ?? [];

  return table.rows.slice(0, limit).map((row) => {
    const alignedRow = alignStandingsRow(headers, row);
    const record = {};

    headers.forEach((header, index) => {
      record[header] = alignedRow[index] ?? "";
    });

    return record;
  });
}

function alignStandingsRow(headers, row) {
  if (!Array.isArray(row)) {
    return [];
  }

  if (row.length === headers.length) {
    return row;
  }

  const last10Index = headers.findIndex((header) => /^Last10$/i.test(String(header ?? "")));
  const streakIndex = headers.findIndex((header) => /^Streak$/i.test(String(header ?? "")));
  const magicIndex = headers.findIndex((header) => /^M#$/i.test(String(header ?? "")));

  if (
    row.length === headers.length - 1 &&
    magicIndex >= 0 &&
    streakIndex === magicIndex + 1 &&
    last10Index === streakIndex + 1
  ) {
    const maybeLast10 = row.at(-1) ?? "";
    const maybeStreak = row.at(-2) ?? "";

    if (looksLikeLastTen(maybeLast10) && looksLikeStreak(maybeStreak)) {
      return [...row.slice(0, magicIndex), "", ...row.slice(magicIndex)];
    }
  }

  return row;
}

function looksLikeLastTen(value) {
  return /^\d+-\d+$/.test(String(value ?? "").trim());
}

function looksLikeStreak(value) {
  return /^[WL]\d+$/i.test(String(value ?? "").trim());
}

function formatStandingsSectionLabel(label) {
  const normalized = String(label ?? "").replace(/\s+/g, " ").trim();
  if (/WILDCARD/i.test(normalized)) {
    return normalized;
  }

  return normalized.replace(/^CONFERENCE\s+(NORTH|SOUTH),?\s+/i, "");
}

function cleanHeadline(title) {
  return title.replace(/\s+/g, " ").trim();
}

function scoreHeadline(page, candidateTitle) {
  let score = 0;
  const title = candidateTitle.toLowerCase();
  const text = page.text.toLowerCase();
  const documentTitle = (page.documentTitle ?? "").toLowerCase();
  const pageType = detectPageType(page);

  if (/(news|report|recap|game|result|injury|trade|standings|announced|award|rankings)/.test(title)) {
    score += 3;
  }

  if (/(win over|wins over|beats|defeats|dominates|all-stars|all stars)/.test(title)) {
    score += 3;
  }

  if (page.heading && page.heading !== page.documentTitle) {
    score += 3;
  }

  if (/\d+\s*-\s*\d+/.test(text)) {
    score += 2;
  }

  if (page.summary.length > 120) {
    score += 1;
  }

  if (/(standings|leaders|stats|statistics|batting report|pitching report)/.test(documentTitle)) {
    score -= 2;
  }

  if (pageType === "home" || pageType === "news") {
    score += 4;
  }

  score += Math.min(page.tables.length, 3);

  return score;
}

function buildHeadlineCandidates(page) {
  const candidates = page.storyCandidates?.length ? page.storyCandidates : [page.title];

  return candidates
    .map((candidateTitle) => ({
      title: cleanHeadline(candidateTitle),
      summary: buildHeadlineSummary(page, candidateTitle),
      fileName: page.fileName,
      score: scoreHeadline(page, candidateTitle),
    }))
    .filter((candidate) => candidate.title && candidate.title.length > 10);
}

function detectPageType(page) {
  const fileName = page.fileName.toLowerCase();
  const documentTitle = (page.documentTitle ?? page.title).toLowerCase();

  if (fileName.includes("_standings") || documentTitle.includes("standings")) {
    return "standings";
  }

  if (fileName.includes("_batting_report") || documentTitle.includes("batting report")) {
    return "batting-report";
  }

  if (fileName.includes("_pitching_report") || documentTitle.includes("pitching report")) {
    return "pitching-report";
  }

  if (fileName.includes("_injuries_report") || documentTitle.includes("injury report")) {
    return "injuries-report";
  }

  if (fileName.includes("_injuries")) {
    return "injuries";
  }

  if (fileName.includes("_transactions_0_0")) {
    return "transactions";
  }

  if (fileName.includes("_news")) {
    return "news";
  }

  if (fileName.includes("_top_prospects")) {
    return "top-prospects";
  }

  if (fileName.includes("_top_players_page")) {
    return "top-players";
  }

  if (fileName.includes("_upcoming_free_agents_report_0")) {
    return "upcoming-free-agents-batters";
  }

  if (fileName.includes("_upcoming_free_agents_report_1")) {
    return "upcoming-free-agents-pitchers";
  }

  if (fileName.includes("_top_minor_league_systems")) {
    return "top-farm-systems";
  }

  if (fileName.includes("_financial_report") || documentTitle.includes("financial report")) {
    return "financial-report";
  }

  if (fileName.includes("_positional_strength_overview_positions")) {
    return "positional-strength";
  }

  if (fileName.includes("_accomplishments_10")) {
    return "accomplishments-milestones";
  }

  if (/_scores_\d{4}_\d{2}_\d{2}\.html$/.test(fileName)) {
    return "scores-history";
  }

  if (fileName.includes("_scores")) {
    return "scores";
  }

  if (fileName.includes("_stats")) {
    return "stats";
  }

  if (fileName.includes("_home")) {
    return "home";
  }

  return "generic";
}

function buildLatestInjuryItems(page) {
  if (!page) {
    return [];
  }

  const injuries = [];

  for (const table of page.tables) {
    const date = table.headers?.[0] ?? "";
    if (!looksLikeTransactionDate(date)) {
      continue;
    }

    for (const row of table.rows) {
      const summary = String(row[0] ?? "").replace(/\s+/g, " ").trim();
      if (!summary) {
        continue;
      }

      injuries.push({
        date,
        summary,
      });
    }
  }

  return injuries.slice(0, 16);
}

function buildUpcomingFreeAgents(battersPage, pitchersPage) {
  const batters = buildUpcomingFreeAgentBatters(battersPage)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5);
  const pitchers = buildUpcomingFreeAgentPitchers(pitchersPage)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5);

  const combined = [];
  const maxLength = Math.max(batters.length, pitchers.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (batters[index]) {
      combined.push(batters[index]);
    }
    if (pitchers[index]) {
      combined.push(pitchers[index]);
    }
  }

  return combined;
}

function buildUpcomingFreeAgentBatters(page) {
  if (!page?.tables?.length) {
    return [];
  }

  const table = page.tables.find((candidate) => candidate.headers?.[0] === "Position Players") ?? page.tables[0];
  if (!table?.rows?.length || !table.headers?.length) {
    return [];
  }

  const headerIndex = Object.fromEntries(table.headers.map((header, index) => [header, index]));
  const linkRows = readUpcomingFreeAgentLinkRows(page);
  let dataRowIndex = 0;

  return table.rows
    .filter((row) => row?.[0] && row?.[1])
    .map((row) => {
      const linkRow = linkRows[dataRowIndex] ?? null;
      dataRowIndex += 1;
      const rawName = cleanHtmlText(row[headerIndex["Position Players"]] ?? "");
      const contact = toNumber(row[headerIndex.CON]);
      const gap = toNumber(row[headerIndex.Gap]);
      const power = toNumber(row[headerIndex.POW]);
      const eye = toNumber(row[headerIndex.Eye]);

      return {
        type: "batter",
        name: rawName.replace(/\s+\*$/, ""),
        team: cleanHtmlText(row[headerIndex.Team] ?? ""),
        age: cleanHtmlText(row[headerIndex.Age] ?? ""),
        pos: cleanHtmlText(row[headerIndex.Pos] ?? ""),
        contact: cleanHtmlText(row[headerIndex.CON] ?? ""),
        gap: cleanHtmlText(row[headerIndex.Gap] ?? ""),
        power: cleanHtmlText(row[headerIndex.POW] ?? ""),
        eye: cleanHtmlText(row[headerIndex.Eye] ?? ""),
        speed: cleanHtmlText(row[headerIndex.Speed] ?? ""),
        isMinorLeagueFreeAgent: /\*\s*$/.test(rawName),
        score: contact + gap + power + eye,
        imageUrl: readPlayerPortraitUrl(page, linkRow?.playerId),
      };
    });
}

function buildUpcomingFreeAgentPitchers(page) {
  if (!page?.tables?.length) {
    return [];
  }

  const table = page.tables.find((candidate) => candidate.headers?.[0] === "Pitchers") ?? page.tables[0];
  if (!table?.rows?.length || !table.headers?.length) {
    return [];
  }

  const headerIndex = Object.fromEntries(table.headers.map((header, index) => [header, index]));
  const linkRows = readUpcomingFreeAgentLinkRows(page);
  let dataRowIndex = 0;

  return table.rows
    .filter((row) => row?.[0] && row?.[1])
    .map((row) => {
      const linkRow = linkRows[dataRowIndex] ?? null;
      dataRowIndex += 1;
      const rawName = cleanHtmlText(row[headerIndex.Pitchers] ?? "");
      const stuff = toNumber(row[headerIndex.Stuff]);
      const movement = toNumber(row[headerIndex.Movement]);
      const control = toNumber(row[headerIndex.CON]);

      return {
        type: "pitcher",
        name: rawName.replace(/\s+\*$/, ""),
        team: cleanHtmlText(row[headerIndex.Team] ?? ""),
        age: cleanHtmlText(row[headerIndex.Age] ?? ""),
        pos: cleanHtmlText(row[headerIndex.Role] ?? ""),
        stuff: cleanHtmlText(row[headerIndex.Stuff] ?? ""),
        movement: cleanHtmlText(row[headerIndex.Movement] ?? ""),
        control: cleanHtmlText(row[headerIndex.CON] ?? ""),
        velocity: cleanHtmlText(row[headerIndex.Velocity] ?? ""),
        stamina: cleanHtmlText(row[headerIndex.Stamina] ?? ""),
        isMinorLeagueFreeAgent: /\*\s*$/.test(rawName),
        score: stuff + movement + control,
        imageUrl: readPlayerPortraitUrl(page, linkRow?.playerId),
      };
    });
}

function readUpcomingFreeAgentLinkRows(page) {
  if (!page?.rawHtml) {
    return [];
  }

  return [...page.rawHtml.matchAll(/<tr>\s*<td class="dl"><a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dl"><a href="\.\.\/teams\/team_(\d+)\.html"[^>]*>/gi)].map((match) => ({
    playerId: cleanHtmlText(match[1]),
    playerName: cleanHtmlText(match[2]).replace(/\s+\*$/, ""),
    teamId: cleanHtmlText(match[3]),
  }));
}

function readPlayerPortraitUrl(page, playerId) {
  if (!page?.filePath || !playerId) {
    return "";
  }

  try {
    const playerPath = path.resolve(path.dirname(page.filePath), "..", "players", `player_${playerId}.html`);
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const imageMatch = rawHtml.match(/<img src="([^"]+person_pictures\/player_\d+\.(?:png|jpg|jpeg|webp))"[^>]*>/i);
    return toNewsLocalUrl(playerPath, imageMatch?.[1] ?? "");
  } catch {
    return "";
  }
}

function buildTopFarmSystems(page) {
  if (!page?.rawHtml || !page?.filePath) {
    return [];
  }

  const systems = [];

  for (const match of page.rawHtml.matchAll(
    /<tr>\s*<td class="dr">([^<]+)<\/td>\s*<td class="dl"><a href="([^"]+)">([^<]+)<\/a><\/td>\s*<td class="dr"[\s\S]*?>([^<]*)<\/td>\s*<td class="dl">([\s\S]*?)<\/td>\s*<\/tr>/gi,
  )) {
    const rank = cleanHtmlText(match[1] ?? "");
    const teamHref = match[2] ?? "";
    const team = cleanHtmlText(match[3] ?? "");
    const points = cleanHtmlText(match[4] ?? "");
    const topProspects = cleanHtmlText(match[5] ?? "").replace(/\s+,/g, ",");

    if (!rank || !team) {
      continue;
    }

    const logo = readTeamLogoFromHref(page.filePath, teamHref, team);
    systems.push({
      rank,
      team,
      points,
      topProspects,
      logoUrl: logo.url,
      logoAlt: logo.alt,
    });
  }

  return systems.slice(0, 10);
}

function readTeamLogoFromHref(baseFilePath, teamHref, fallbackTeam) {
  if (!baseFilePath || !teamHref) {
    return { url: "", alt: fallbackTeam };
  }

  try {
    const teamPath = path.resolve(path.dirname(baseFilePath), teamHref);
    if (!fs.existsSync(teamPath)) {
      return { url: "", alt: fallbackTeam };
    }

    const rawHtml = fs.readFileSync(teamPath, "utf8");
    const logoMatch = rawHtml.match(/<img src="([^"]+team_logos\/[^"]+)" border="0" title="([^"]+)"/i);
    return {
      url: toNewsLocalUrl(teamPath, logoMatch?.[1] ?? ""),
      alt: cleanHtmlText(logoMatch?.[2] ?? fallbackTeam),
    };
  } catch {
    return { url: "", alt: fallbackTeam };
  }
}

function buildPlayerMilestones(page) {
  if (!page?.rawHtml) {
    return [];
  }

  const milestones = [];

  for (const match of page.rawHtml.matchAll(/<tr>\s*<td class="dl">([^<]+)<\/td>\s*<td class="dl"><a href="\.\.\/players\/player_\d+\.html">([^<]+)<\/a><\/td>\s*<td class="dl">([\s\S]*?)<\/td>\s*<td class="dl">/gi)) {
    const date = cleanHtmlText(match[1] ?? "");
    const player = cleanHtmlText(match[2] ?? "");
    const accomplishment = cleanHtmlText(match[3] ?? "");
    if (!date || !player || !accomplishment) {
      continue;
    }

    milestones.push({
      date,
      player,
      accomplishment,
    });
  }

  return milestones.slice(-4).reverse();
}

function buildPositionalStrengthFeature(page, leaguePlayers = []) {
  if (!page?.tables?.length) {
    return null;
  }

  const positionTables = page.tables.filter(
    (table) =>
      table.label &&
      table.headers?.[0] === "Team" &&
      table.headers?.includes("Top player") &&
      table.headers?.includes("Overall ranking"),
  );

  if (!positionTables.length) {
    return null;
  }

  const selectedIndex = pickStableIndex("positional-strength", positionTables.length);
  const selectedTable = positionTables[selectedIndex] ?? positionTables[0];
  const playerDirectory = buildPositionalStrengthPlayerDirectory(leaguePlayers);
  const players = (selectedTable.rows ?? [])
    .slice(0, 20)
    .map((row, index) => {
      const team = cleanHtmlText(row[0] ?? "");
      const player = cleanHtmlText(row[1] ?? "");
      const playerProfile = playerDirectory.get(buildProspectLookupKey(player, team));

      return {
        rank: index + 1,
        team,
        player,
        age: playerProfile?.age ? String(playerProfile.age) : "",
        salary: readPositionalRankingPlayerSalary(playerProfile),
      };
    })
    .filter((entry) => entry.team && entry.player);

  return {
    position: toTitleCase(selectedTable.label),
    players,
  };
}

function buildPositionalStrengthPlayerDirectory(leaguePlayers = []) {
  const directory = new Map();

  for (const player of leaguePlayers) {
    if (!player?.name || !player?.team) {
      continue;
    }

    directory.set(buildProspectLookupKey(player.name, player.team), player);
  }

  return directory;
}

function readPositionalRankingPlayerSalary(playerProfile) {
  if (!playerProfile?.playerPagePath) {
    return "";
  }

  try {
    const rawHtml = fs.readFileSync(playerProfile.playerPagePath, "utf8");
    return cleanHtmlText(rawHtml.match(/<tr><td class="data_capt">Salary:<\/td><td class="wrap">([^<]+)<\/td><\/tr>/i)?.[1] ?? "");
  } catch {
    return "";
  }
}

function buildUnderKnifeInjuries(page) {
  if (!page?.tables?.length) {
    return [];
  }

  const injuries = [];

  for (const table of page.tables) {
    if (
      table.headers?.[0] !== "Player" ||
      !table.headers?.includes("Injury") ||
      !table.headers?.includes("Out for...") ||
      !table.headers?.includes("Injury List Status")
    ) {
      continue;
    }

    const team = cleanHtmlText(table.label ?? "");

    for (const row of table.rows ?? []) {
      const player = cleanHtmlText(row[0] ?? "");
      const injury = cleanHtmlText(row[1] ?? "");
      const outFor = cleanHtmlText(row[2] ?? "");
      const status = cleanHtmlText(row[3] ?? "");

      if (!player || !injury || !outFor) {
        continue;
      }

      injuries.push({
        player,
        team,
        injury,
        outFor,
        status,
        severityScore: scoreInjurySeverity(outFor, status),
      });
    }
  }

  return injuries
    .sort((left, right) => scoreStableInjurySample(left) - scoreStableInjurySample(right))
    .slice(0, 5);
}

function scoreInjurySeverity(outFor, status) {
  const text = `${String(outFor ?? "")} ${String(status ?? "")}`.toLowerCase();
  if (/career ending/.test(text)) {
    return 500;
  }

  const monthMatch = text.match(/(\d+)(?:-(\d+))?\s+months?/);
  if (monthMatch) {
    const low = Number.parseInt(monthMatch[1], 10) || 0;
    const high = Number.parseInt(monthMatch[2] ?? monthMatch[1], 10) || low;
    return high * 30 + low * 15 + (/\(60-day il\)|on il/.test(text) ? 5 : 0);
  }

  const weekMatch = text.match(/(\d+)(?:-(\d+))?\s+weeks?/);
  if (weekMatch) {
    const low = Number.parseInt(weekMatch[1], 10) || 0;
    const high = Number.parseInt(weekMatch[2] ?? weekMatch[1], 10) || low;
    return high * 7 + low * 3 + (/\(60-day il\)|on il/.test(text) ? 5 : 0);
  }

  if (/one week/.test(text)) {
    return 7 + (/\bon il\b/.test(text) ? 5 : 0);
  }

  const dayMatch = text.match(/(\d+)(?:-(\d+))?\s+days?/);
  if (dayMatch) {
    const high = Number.parseInt(dayMatch[2] ?? dayMatch[1], 10) || 0;
    return high + (/\bon il\b/.test(text) ? 5 : 0);
  }

  if (/dtd|day-to-day/.test(text)) {
    return 2 + (/\bon il\b/.test(text) ? 5 : 0);
  }

  return /\bon il\b/.test(text) ? 5 : 1;
}

function scoreStableInjurySample(injury) {
  const seed = `${new Date().toISOString().slice(0, 10)}::${injury.player}::${injury.team}::${injury.injury}`;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  }
  return Math.abs(hash);
}

function buildProspectHighlight(page) {
  if (!page?.rawHtml || !page?.filePath) {
    return null;
  }

  const prospects = extractTopProspects(page);
  if (!prospects.length) {
    return null;
  }

  const pitcherProspects = prospects.filter((prospect) => prospect.profileType === "pitcher");
  const batterProspects = prospects.filter((prospect) => prospect.profileType !== "pitcher");
  const typePools = [pitcherProspects, batterProspects].filter((pool) => pool.length);
  const selectedTypePool = typePools[pickStableIndex("prospect-highlight-type", typePools.length)] ?? prospects;
  const index = pickStableProspectIndex(selectedTypePool);
  const selected = selectedTypePool[index];
  const playerPath = path.resolve(path.dirname(page.filePath), "..", "players", `player_${selected.playerId}.html`);
  const playerProfile = readProspectPlayerProfile(playerPath, selected);
  const teamTopProspects = readTeamTopProspectsPage(page.filePath, selected, prospects);

  return playerProfile
    ? {
        ...selected,
        ...playerProfile,
        teamTopProspects,
      }
    : null;
}

function buildPlayerInterviewFeature(page, standingsSections, injuries = [], leaguePlayers = [], currentDate = null, currentMode = "") {
  if (!page?.rawHtml || !page?.filePath) {
    return null;
  }

  const topPlayers = extractTopPlayers(page);
  const weekendPool = isWeekendInterviewDate(currentDate) ? buildWeekendInterviewPlayerPool(leaguePlayers, topPlayers) : [];
  const interviewPool = weekendPool.length ? weekendPool : topPlayers;

  if (!interviewPool.length) {
    return null;
  }

  const selected = interviewPool[pickStableIndex(weekendPool.length ? "weekend-player-feature" : "top-player-feature", interviewPool.length)];
  const playerPath = path.resolve(path.dirname(page.filePath), "..", "players", `player_${selected.playerId}.html`);
  const teamPath = path.resolve(path.dirname(page.filePath), "..", "teams", `team_${selected.teamId}.html`);
  const playerProfile = readTopPlayerProfile(playerPath, selected);
  const teamStanding = findTeamStandingsContext(selected.team, standingsSections);
  const teamProfile = readTeamFeatureProfile(teamPath, selected.team, teamStanding);
  const playerHistory = findPlayerHistory(selected.name);
  const playerRecords = findRecordByPlayer(selected.name);
  const playerLeaderboardEntries = findLeaderboardEntriesByPlayer(selected.name);
  const teamHistory = findTeamHistory(teamProfile?.fullName ?? selected.team);
  const lastChampion = getLastCompletedSeason();
  const admiredPeer = pickPlayerInterviewAdmiredPeer(interviewPool, selected);

  if (!playerProfile || !teamProfile) {
    return null;
  }

  return {
    ...selected,
    ...playerProfile,
    careerSummaryLine: buildPlayerInterviewHeaderLine(playerHistory, playerProfile),
    careerDetailLine: buildPlayerInterviewDetailLine(playerProfile),
    interview: finalizePlayerInterview(
      buildPlayerInterviewV2(
        selected,
        playerProfile,
        teamProfile,
        teamStanding,
        playerHistory,
        playerRecords,
        playerLeaderboardEntries,
        admiredPeer,
        currentMode,
        currentDate,
      ),
      selected,
      playerProfile,
      teamProfile,
      teamStanding,
      playerHistory,
      playerRecords,
      playerLeaderboardEntries,
      admiredPeer,
    ),
    teamHighlight: buildTeamHighlight(teamProfile, teamStanding, teamHistory, lastChampion, injuries),
  };
}

function isWeekendInterviewDate(currentDate) {
  if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    return false;
  }

  const weekday = currentDate.getUTCDay();
  return weekday === 0 || weekday === 6;
}

function buildWeekendInterviewPlayerPool(leaguePlayers = [], topPlayers = []) {
  const topPlayerById = new Map(
    (topPlayers ?? [])
      .filter((player) => player?.playerId)
      .map((player) => [String(player.playerId), player]),
  );

  return (leaguePlayers ?? [])
    .filter((player) => player?.playerId && player?.teamId && player?.name && player?.team)
    .map((player) => {
      const topPlayer = topPlayerById.get(String(player.playerId));
      return {
        ...player,
        age: cleanHtmlText(topPlayer?.age ?? player.age ?? ""),
        pos: cleanHtmlText(topPlayer?.pos ?? player.pos ?? ""),
        profileType: topPlayer?.profileType ?? (/^(SP|RP|CL|P)$/i.test(String(player.pos ?? "")) ? "pitcher" : "batter"),
        summaryStats: topPlayer?.summaryStats ?? {},
        rank: topPlayer?.rank ?? "",
      };
    });
}

function buildScheduledGames(page, scoreHistoryPages = []) {
  if (!page?.rawHtml || !page?.filePath) {
    return [];
  }

  const blockPattern =
    /<table cellspacing="0" cellpadding="0" width="478px" height="100%" class="databg">[\s\S]*?<img src="([^"]+team_logos\/[^"]+)"[^>]*><br>\s*<img src="([^"]+team_logos\/[^"]+)"[^>]*>[\s\S]*?<td class="dl" colspan="2">([^<]+)<\/td>[\s\S]*?<td class="dl" width="210px"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl" width="210px">([^<]+)<\/td>[\s\S]*?<td class="dl" width="210px"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl" width="210px">([^<]+)<\/td>[\s\S]*?<td style="padding:4px;">([\s\S]*?)<\/td>[\s\S]*?<\/table>\s*<\/td>\s*<\/tr>\s*<\/table>/gi;

  const scheduleDate = parseCurrentScoreboardDate(page);

    return [...page.rawHtml.matchAll(blockPattern)]
      .map((match) => parseScheduledGameBlock(page.filePath, match, scheduleDate, scoreHistoryPages))
      .filter(Boolean);
}

function parseScheduledGameBlock(baseFilePath, match, scheduleDate, scoreHistoryPages = []) {
  const probablePitchers = parseProbablePitchers(match[8] ?? "");
  const awayTeam = cleanHtmlText(match[4]);
  const homeTeam = cleanHtmlText(match[6]);
  const seriesContext = inferScheduledSeriesContext(awayTeam, homeTeam, scheduleDate, scoreHistoryPages);

  return {
    time: cleanHtmlText(match[3]),
    awayTeam,
    awayRecord: extractOverallRecord(match[5]),
    awayContext: extractRecordContext(match[5]),
    homeTeam,
    homeRecord: extractOverallRecord(match[7]),
    homeContext: extractRecordContext(match[7]),
    awayLogoUrl: toNewsLocalUrl(baseFilePath, match[1]),
    homeLogoUrl: toNewsLocalUrl(baseFilePath, match[2]),
    awayProbablePitcher: probablePitchers[0] ?? null,
    homeProbablePitcher: probablePitchers[1] ?? null,
    seriesContext,
  };
}

function parseProbablePitchers(html) {
  return [...String(html ?? "").matchAll(/([A-Z-]+):\s*<a [^>]*>([^<]+)<\/a>\s*\(([^)]*)\)/gi)].map((match) => ({
    teamCode: cleanHtmlText(match[1]),
    name: cleanHtmlText(match[2]),
    line: cleanHtmlText(match[3]),
  }));
}

function extractOverallRecord(value) {
  const match = String(value ?? "").match(/(\d+-\d+)/);
  return match ? match[1] : "";
}

function extractRecordContext(value) {
  const cleaned = cleanHtmlText(value);
  const commaIndex = cleaned.indexOf(",");
  return commaIndex >= 0 ? cleaned.slice(commaIndex + 1).trim() : "";
}

function inferScheduledSeriesContext(awayTeam, homeTeam, scheduleDate, scoreHistoryPages) {
  if (!scheduleDate) {
    return null;
  }

  const matchupKey = buildSeriesMatchupKey(awayTeam, homeTeam);
  const datedPages = scoreHistoryPages
    .map((page) => ({
      page,
      date: parseScoreboardDate(page.title || page.summary || page.rawHtml),
    }))
    .filter((entry) => entry.date && entry.date < scheduleDate && differenceInDays(scheduleDate, entry.date) <= 4)
    .sort((left, right) => right.date - left.date);

  const seriesGames = collectSeriesGames(matchupKey, datedPages);
  if (seriesGames.length) {
    return summarizeSeriesContext(seriesGames);
  }

  const explicitContext = findExplicitPlayoffSeriesContext(matchupKey, awayTeam, homeTeam, datedPages);
  if (explicitContext) {
    return explicitContext;
  }

  return {
    gameNumber: 1,
    label: ordinalNumber(1),
    leaderText: "",
  };
}

function findExplicitPlayoffSeriesContext(matchupKey, awayTeam, homeTeam, datedPages) {
  for (const entry of datedPages) {
    const scoreBlocks = extractScoreboardSeriesBlocks(entry.page?.rawHtml ?? "");
    for (const block of scoreBlocks) {
      if (buildSeriesMatchupKey(block.awayTeam, block.homeTeam) !== matchupKey) {
        continue;
      }

      const explicitLead = parseExplicitSeriesLead(block.summary, awayTeam, homeTeam);
      if (explicitLead) {
        return explicitLead;
      }
    }
  }

  return null;
}

function extractScoreboardSeriesBlocks(rawHtml) {
  const blocks = [];
  const pattern =
    /<table cellspacing="0" cellpadding="0" width="478px" height="100%" class="databg">[\s\S]*?<table cellspacing="0" cellpadding="0" width="420px" class="data">([\s\S]*?)<\/table>[\s\S]*?<table cellspacing="0" cellpadding="0" width="420px" class="databg">([\s\S]*?)<\/table>[\s\S]*?<\/table>/gi;

  for (const match of String(rawHtml ?? "").matchAll(pattern)) {
    const rows = [
      ...String(match[1] ?? "").matchAll(
        /<tr>\s*<td class="dl">[\s\S]*?<a [^>]*>(.*?)<\/a>[\s\S]*?<td class="dc\s+grey\s+bold" width="18px">(.*?)<\/td>[\s\S]*?<\/tr>/gi,
      ),
    ];

    if (rows.length < 2) {
      continue;
    }

    blocks.push({
      awayTeam: cleanScoreTeam(rows[0][1]),
      homeTeam: cleanScoreTeam(rows[1][1]),
      summary: cleanHtmlText(match[2] ?? "").replace(/\s+/g, " ").trim(),
    });
  }

  return blocks;
}

function parseExplicitSeriesLead(summaryText, awayTeam, homeTeam) {
  const summary = cleanHtmlText(summaryText).replace(/\s+/g, " ").trim();
  if (!summary) {
    return null;
  }

  const leadMatch = summary.match(/(.+?)\s+to\s+(\d+)-(\d+)\s+Lead in R\d+/i);
  if (leadMatch) {
    const leaderName = cleanHtmlText(leadMatch[1] ?? "")
      .replace(/^(?:road|home)\s+win\s+lifts\s+/i, "")
      .replace(/^(?:road|home)\s+win\s+/i, "")
      .trim();
    const leaderWins = Number.parseInt(leadMatch[2] ?? "0", 10) || 0;
    const trailerWins = Number.parseInt(leadMatch[3] ?? "0", 10) || 0;
    return buildExplicitSeriesContext(awayTeam, homeTeam, leaderName, leaderWins, trailerWins);
  }

  const tiedMatch = summary.match(/Series tied\s+(\d+)-(\d+)/i);
  if (tiedMatch) {
    const tiedWins = Number.parseInt(tiedMatch[1] ?? "0", 10) || 0;
    const wins = new Map([
      [awayTeam, tiedWins],
      [homeTeam, tiedWins],
    ]);
    return buildSeriesContextFromWinsMap(wins, 4);
  }

  return null;
}

function buildExplicitSeriesContext(awayTeam, homeTeam, leaderName, leaderWins, trailerWins) {
  const leaderKey = buildCanonicalSeriesTeamKey(leaderName);
  const awayKey = buildCanonicalSeriesTeamKey(awayTeam);
  const homeKey = buildCanonicalSeriesTeamKey(homeTeam);
  const wins = new Map();

  if (leaderKey === awayKey) {
    wins.set(awayTeam, leaderWins);
    wins.set(homeTeam, trailerWins);
  } else if (leaderKey === homeKey) {
    wins.set(homeTeam, leaderWins);
    wins.set(awayTeam, trailerWins);
  } else {
    return null;
  }

  return buildSeriesContextFromWinsMap(wins, 4);
}

function buildSeriesContextFromWinsMap(wins, winsNeeded = 4) {
  const played = [...wins.values()].reduce((total, value) => total + value, 0);
  const entries = [...wins.entries()].sort((left, right) => right[1] - left[1]);
  const leader = entries[0] ?? null;
  const runnerUp = entries[1] ?? null;
  const leaderWins = leader?.[1] ?? 0;
  const runnerUpWins = runnerUp?.[1] ?? 0;

  return {
    gameNumber: played + 1,
    label: ordinalNumber(played + 1),
    winsByTeam: new Map(wins),
    winsByKey: new Map([...wins.entries()].map(([team, total]) => [buildCanonicalSeriesTeamKey(team), total])),
    winsNeeded,
    leaderText:
      !leader
        ? ""
        : leaderWins === runnerUpWins
          ? `Series tied ${leaderWins}-${runnerUpWins}`
          : `${leader[0]} lead series ${leaderWins}-${runnerUpWins}`,
  };
}

function collectSeriesGames(matchupKey, datedPages) {
  const games = [];
  let started = false;
  let previousMatchedDate = null;

  for (const entry of datedPages) {
    if (started && previousMatchedDate && differenceInDays(previousMatchedDate, entry.date) > 2) {
      break;
    }

    const matchingGame = buildLastDayScores(entry.page).find(
      (game) => buildSeriesMatchupKey(game.awayTeam, game.homeTeam) === matchupKey,
    );

    if (matchingGame) {
      games.push({
        date: entry.date,
        winner: Number(matchingGame.awayRuns) > Number(matchingGame.homeRuns) ? matchingGame.awayTeam : matchingGame.homeTeam,
      });
      started = true;
      previousMatchedDate = entry.date;
    }
  }

  return games.slice(0, 7);
}

function summarizeSeriesContext(seriesGames) {
  const wins = new Map();

  for (const game of seriesGames) {
    wins.set(game.winner, (wins.get(game.winner) ?? 0) + 1);
  }

  const played = seriesGames.length;
  const entries = [...wins.entries()].sort((left, right) => right[1] - left[1]);
  const leader = entries[0] ?? null;
  const runnerUp = entries[1] ?? null;
  const leaderWins = leader?.[1] ?? 0;
  const runnerUpWins = runnerUp?.[1] ?? 0;

  return {
    gameNumber: played + 1,
    label: ordinalNumber(played + 1),
    winsByTeam: new Map(wins),
    winsByKey: new Map([...wins.entries()].map(([team, total]) => [buildCanonicalSeriesTeamKey(team), total])),
    winsNeeded: 4,
    leaderText:
      !leader
        ? ""
        : played === 1
          ? `${leader[0]} lead series ${leaderWins}-0`
          : leaderWins === runnerUpWins
            ? `Series tied ${leaderWins}-${runnerUpWins}`
            : `${leader[0]} lead series ${leaderWins}-${runnerUpWins}`,
  };
}

function buildSeriesMatchupKey(teamA, teamB) {
  return [buildCanonicalSeriesTeamKey(teamA), buildCanonicalSeriesTeamKey(teamB)].sort().join("::");
}

function buildCanonicalSeriesTeamKey(teamName) {
  const keys = buildTeamLookupKeys(teamName);
  return keys.sort((left, right) => left.length - right.length)[0] ?? normalizeTeamLookupValue(teamName);
}

function differenceInDays(laterDate, earlierDate) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((laterDate - earlierDate) / dayMs);
}

function ordinalNumber(value) {
  const number = Number(value);
  if (number % 100 >= 11 && number % 100 <= 13) {
    return `${number}th`;
  }

  if (number % 10 === 1) {
    return `${number}st`;
  }
  if (number % 10 === 2) {
    return `${number}nd`;
  }
  if (number % 10 === 3) {
    return `${number}rd`;
  }

  return `${number}th`;
}

function parseScoreboardDate(value) {
  const text = String(value ?? "").replace(/\s+/g, " ");
  const match = text.match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,\s*(\d{4})/i,
  );

  if (!match) {
    return null;
  }

  const months = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };
  const monthIndex = months[match[2].toLowerCase()];
  if (monthIndex === undefined) {
    return null;
  }

  return new Date(Date.UTC(Number(match[4]), monthIndex, Number(match[3])));
}

function parseCurrentScoreboardDate(page) {
  const explicitDate = parseScoreboardDate(page?.title || page?.summary || page?.rawHtml);
  if (explicitDate) {
    return explicitDate;
  }

  const rawHtml = String(page?.rawHtml ?? "");
  const subtitleMatch = rawHtml.match(/SCOREBOARD:\s*([A-Z]+,\s+[A-Z]+\s+\d{1,2}(?:ST|ND|RD|TH)?\s*,\s*\d{4})/i);
  if (subtitleMatch) {
    return parseScoreboardDate(subtitleMatch[1]);
  }

  return null;
}

function extractTopProspects(page) {
  const playerIdLookup = new Map();

  for (const match of page.rawHtml.matchAll(/<tr>\s*<td class="dr">(\d+)<\/td>\s*<td class="dl"><a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dl"><a href="\.\.\/teams\/team_(\d+)\.html"[^>]*>([^<]+)<\/a><\/td>/gi)) {
    const rank = cleanHtmlText(match[1]);
    const name = cleanHtmlText(match[3]);
    const team = cleanHtmlText(match[5]);
    playerIdLookup.set(`${rank}::${name}::${team}`, {
      playerId: cleanHtmlText(match[2]),
      teamId: cleanHtmlText(match[4]),
    });
  }

  const prospects = [];

  for (const table of page.tables) {
    if (table.headers[0] !== "col_1" || !table.rows?.length) {
      continue;
    }

    const headerRow = table.rows[0] ?? [];
    if (headerRow[0] !== "#" || headerRow[1] !== "Name" || headerRow[2] !== "Team") {
      continue;
    }

    const rows = table.rows.slice(1);
    for (const row of rows) {
      if (!row?.length || !row[0] || !row[1] || !row[2]) {
        continue;
      }

      const headerMap = Object.fromEntries(headerRow.map((header, index) => [header, row[index] ?? ""]));
      const rank = cleanHtmlText(headerMap["#"]);
      const name = cleanHtmlText(headerMap.Name);
      const team = cleanHtmlText(headerMap.Team);
      const ids = playerIdLookup.get(`${rank}::${name}::${team}`);
      const role = cleanHtmlText(headerMap.Pos || headerMap.Role);
      const isPitcher = /^(P|SP|RP|CL)$/i.test(role);

      prospects.push({
        rank,
        playerId: ids?.playerId ?? "",
        teamId: ids?.teamId ?? "",
        name,
        team,
        age: cleanHtmlText(headerMap.Age),
        pos: role,
        level: cleanHtmlText(headerMap.Level),
        playerPageUrl: ids?.playerId ? `/news/players/player_${ids.playerId}.html` : "",
        profileType: isPitcher ? "pitcher" : "batter",
        contact: cleanHtmlText(headerMap.Contact || headerMap.Stuff),
        power: cleanHtmlText(headerMap.Power || headerMap.Movement),
        eye: cleanHtmlText(headerMap["Eye/Discipline"] || headerMap.Control),
        speed: cleanHtmlText(headerMap.Speed || headerMap.IP),
        defense: cleanHtmlText(headerMap.Defense || headerMap.K),
        avg: cleanHtmlText(headerMap.AVG || headerMap.ERA),
        hr: cleanHtmlText(headerMap.HR || headerMap.BB),
        rbi: cleanHtmlText(headerMap.RBI || headerMap.HR),
        summaryStats: headerMap,
      });
    }
  }

  return prospects.filter((prospect) => prospect.playerId);
}

function readTeamTopProspectsPage(baseLeaguePagePath, selected, allProspects = []) {
  if (!selected?.teamId) {
    return [];
  }

  const prospectsPath = path.resolve(path.dirname(baseLeaguePagePath), "..", "teams", `team_${selected.teamId}_top_prospects.html`);

  try {
    const rawHtml = fs.readFileSync(prospectsPath, "utf8");
    const teamProspects = [];
    const overallRankMap = new Map(
      allProspects.map((prospect) => [
        buildProspectLookupKey(prospect.name, prospect.team),
        cleanHtmlText(prospect.rank),
      ]),
    );
    const playerIdMap = new Map(
      [...rawHtml.matchAll(/<a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a>/gi)].map((match) => [
        cleanHtmlText(match[2]),
        cleanHtmlText(match[1]),
      ]),
    );
    const tableMatches = [...rawHtml.matchAll(/<table\b[^>]*class="data sortable"[^>]*>([\s\S]*?)<\/table>/gi)];

    for (const tableMatch of tableMatches) {
      const rowMatches = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
      const rows = rowMatches
        .map((rowMatch) => [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cellMatch) => cleanHtmlText(cellMatch[1])))
        .filter((row) => row.length > 0);

      const headerRow = rows[0] ?? [];
      const dataRows = rows.slice(1);
      const nameIndex = headerRow.findIndex((header) => header === "Name");
      const ageIndex = headerRow.findIndex((header) => header === "Age");
      const posIndex = headerRow.findIndex((header) => header === "Pos" || header === "Role");
      const levelIndex = headerRow.findIndex((header) => header === "Level");

      if (nameIndex < 0 || ageIndex < 0 || posIndex < 0 || levelIndex < 0) {
        continue;
      }

      for (const cells of dataRows) {
        if (!cells[0] || !cells[nameIndex]) {
          continue;
        }

          teamProspects.push({
            teamRank: cleanHtmlText(cells[0]),
            overallRank: overallRankMap.get(buildProspectLookupKey(cells[nameIndex], selected.team)) ?? "",
            name: cleanHtmlText(cells[nameIndex]),
            age: cleanHtmlText(cells[ageIndex]),
            pos: cleanHtmlText(cells[posIndex]),
            level: cleanHtmlText(cells[levelIndex]),
            draftRound: readProspectDraftRound(
              path.resolve(path.dirname(baseLeaguePagePath), "..", "players", `player_${playerIdMap.get(cleanHtmlText(cells[nameIndex]))}.html`),
            ),
            draftYear: readProspectDraftYear(
              path.resolve(path.dirname(baseLeaguePagePath), "..", "players", `player_${playerIdMap.get(cleanHtmlText(cells[nameIndex]))}.html`),
            ),
          });
      }
    }

    return teamProspects
      .sort((left, right) => Number(left.teamRank) - Number(right.teamRank))
      .slice(0, 12);
  } catch {
    return [];
  }
}

function buildProspectLookupKey(name, team) {
  return `${cleanHtmlText(name).toLowerCase()}::${cleanHtmlText(team).toLowerCase()}`;
}

function readProspectDraftYear(playerPath) {
  if (!playerPath || /player_undefined\.html$/i.test(playerPath)) {
    return "";
  }

  try {
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const draftYearMatch =
      rawHtml.match(/Drafted:<\/td><td class="wrap">(\d{4}),\s*\d+(?:st|nd|rd|th)\s+Pick in Round\s+\d+/i) ||
      rawHtml.match(/Drafted in the (\d{4}) [^.]*?\(Round\s+\d+,/i);
    if (!draftYearMatch) {
      return "";
    }

    return cleanHtmlText(draftYearMatch[1]);
  } catch {
    return "";
  }
}

function readProspectDraftRound(playerPath) {
  if (!playerPath || /player_undefined\.html$/i.test(playerPath)) {
    return "";
  }

  try {
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const draftRoundMatch =
      rawHtml.match(/Drafted:<\/td><td class="wrap">\d{4},\s*\d+(?:st|nd|rd|th)\s+Pick in Round\s+(\d+)/i) ||
      rawHtml.match(/Drafted in the \d{4} [^.]*?\(Round\s+(\d+),/i);
    if (!draftRoundMatch) {
      return "";
    }

    return `Rd ${cleanHtmlText(draftRoundMatch[1])}`;
  } catch {
    return "";
  }
}

function extractTopPlayers(page) {
  const linkLookup = new Map();

  for (const match of page.rawHtml.matchAll(/<tr>\s*<td class="dr">(\d+)<\/td>\s*<td class="dl"><a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dl"><a href="\.\.\/teams\/team_(\d+)\.html">([^<]+)<\/a><\/td>/gi)) {
    const rank = cleanHtmlText(match[1]);
    const name = cleanHtmlText(match[3]);
    const team = cleanHtmlText(match[5]);
    linkLookup.set(`${rank}::${name}::${team}`, {
      playerId: cleanHtmlText(match[2]),
      teamId: cleanHtmlText(match[4]),
    });
  }

  const players = [];

  for (const table of page.tables) {
    if (table.headers[0] !== "col_1" || !table.rows?.length) {
      continue;
    }

    const headerRow = table.rows[0] ?? [];
    if (headerRow[0] !== "#" || headerRow[1] !== "Name" || headerRow[2] !== "Team") {
      continue;
    }

    for (const row of table.rows.slice(1)) {
      if (!row?.[0] || !row?.[1] || !row?.[2]) {
        continue;
      }

      const rowMap = Object.fromEntries(headerRow.map((header, index) => [header, cleanHtmlText(row[index] ?? "")]));
      const rank = rowMap["#"];
      const name = rowMap.Name;
      const team = rowMap.Team;
      const ids = linkLookup.get(`${rank}::${name}::${team}`);
      const role = rowMap.Pos || rowMap.Role || "";
      const profileType = /^(SP|RP|CL|P)$/i.test(role) ? "pitcher" : "batter";

      if (!ids?.playerId || !ids?.teamId) {
        continue;
      }

      players.push({
        rank,
        playerId: ids.playerId,
        teamId: ids.teamId,
        name,
        team,
        age: rowMap.Age,
        pos: role,
        level: rowMap.Level,
        profileType,
        summaryStats: rowMap,
        playerPageUrl: `/news/players/player_${ids.playerId}.html`,
      });
    }
  }

  return players;
}

function buildLeaguePlayers(parsedPages, leagueId) {
  const representativeLeaguePage = parsedPages.find((page) => extractLeagueId(page.fileName) === leagueId && page.filePath);
  const candidateDirs = [
    representativeLeaguePage?.filePath ? path.dirname(representativeLeaguePage.filePath) : "",
    path.resolve("News", "leagues"),
  ].filter(Boolean);
  const playerPageFiles = [];
  let leagueDir = "";

  for (const candidateDir of candidateDirs) {
    if (!fs.existsSync(candidateDir)) {
      continue;
    }

    const matchingFiles = fs
      .readdirSync(candidateDir)
      .filter((fileName) => new RegExp(`^league_${leagueId}_players_[a-z]\\.html$`, "i").test(fileName))
      .sort((left, right) => left.localeCompare(right));

    if (matchingFiles.length) {
      leagueDir = candidateDir;
      playerPageFiles.push(...matchingFiles);
      break;
    }
  }

  if (!leagueDir || !playerPageFiles.length) {
    return [];
  }
  const players = [];
  const seenIds = new Set();

  for (const fileName of playerPageFiles) {
    const filePath = path.join(leagueDir, fileName);
    const rawHtml = fs.readFileSync(filePath, "utf8");

    for (const match of rawHtml.matchAll(
      /<tr>\s*<td class="dl"><a href="\.\.\/players\/player_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dc">([^<]+)<\/td>\s*<td class="dl">(?:<a href="\.\.\/teams\/team_(\d+)\.html">([^<]+)<\/a>|([^<]+))<\/td>\s*<td class="dc">(\d+)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>\s*<td class="dr">([^<]*)<\/td>/gi,
    )) {
      const playerId = cleanHtmlText(match[1] ?? "");
      if (!playerId || seenIds.has(playerId)) {
        continue;
      }

      const age = Number.parseInt(cleanHtmlText(match[7] ?? ""), 10);
      const teamName = cleanHtmlText(match[5] ?? match[6] ?? "");
      if (!Number.isFinite(age) || age < 21 || !teamName || /free agent/i.test(teamName)) {
        continue;
      }

      const teamId = cleanHtmlText(match[4] ?? "");
      const displayName = normalizePlayerListName(cleanHtmlText(match[2] ?? ""));
      const playerPagePath = path.resolve(leagueDir, "..", "players", `player_${playerId}.html`);
      const teamPagePath = teamId ? path.resolve(leagueDir, "..", "teams", `team_${teamId}.html`) : "";

      players.push({
        playerId,
        name: displayName,
        pos: cleanHtmlText(match[3] ?? ""),
        team: teamName,
        teamId,
        age,
        dob: cleanHtmlText(match[8] ?? ""),
        birthPlace: cleanHtmlText(match[9] ?? ""),
        nationality: cleanHtmlText(match[10] ?? ""),
        bats: cleanHtmlText(match[11] ?? ""),
        throws: cleanHtmlText(match[12] ?? ""),
        playerPagePath,
        teamPagePath,
        playerPageUrl: `/news/players/player_${playerId}.html`,
      });
      seenIds.add(playerId);
    }
  }

  return players;
}

function normalizePlayerListName(value) {
  const cleaned = cleanHtmlText(value);
  if (!cleaned.includes(",")) {
    return cleaned;
  }

  const [lastName, firstName] = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  return firstName && lastName ? `${firstName} ${lastName}` : cleaned;
}

function pickStableIndex(seedKey, count) {
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

function pickStableProspectIndex(prospects = []) {
  if (!prospects.length) {
    return 0;
  }

  const rankBands = [
    { key: "1-10", weight: 25, entries: [] },
    { key: "11-25", weight: 22, entries: [] },
    { key: "26-50", weight: 20, entries: [] },
    { key: "51-75", weight: 8, entries: [] },
    { key: "76-100", weight: 5, entries: [] },
  ];

  for (const [index, prospect] of prospects.entries()) {
    const rank = Number.parseInt(String(prospect?.rank ?? "").trim(), 10);
    const band = !Number.isFinite(rank) || rank <= 0
      ? rankBands[rankBands.length - 1]
      : rank <= 10
        ? rankBands[0]
        : rank <= 25
          ? rankBands[1]
          : rank <= 50
            ? rankBands[2]
            : rank <= 75
              ? rankBands[3]
              : rankBands[4];
    band.entries.push(index);
  }

  const availableBands = rankBands.filter((band) => band.entries.length);
  const totalWeight = availableBands.reduce((sum, band) => sum + band.weight, 0);
  if (!availableBands.length || !totalWeight) {
    return pickStableIndex("prospect-highlight", prospects.length);
  }

  let ticket = pickStableIndex("prospect-highlight-band", totalWeight);
  let selectedBand = availableBands[0];
  for (const band of availableBands) {
    if (ticket < band.weight) {
      selectedBand = band;
      break;
    }
    ticket -= band.weight;
  }

  const selectedBandIndex = pickStableIndex(`prospect-highlight:${selectedBand.key}`, selectedBand.entries.length);
  return selectedBand.entries[selectedBandIndex] ?? 0;
}

function readProspectPlayerProfile(playerPath, selected) {
  try {
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const imageMatch = rawHtml.match(/<img src="([^"]+person_pictures\/player_\d+\.(?:png|jpg|jpeg|webp))"[^>]*title="([^"]*)"/i);
    const headerMatch = rawHtml.match(/<th colspan="2" class="boxtitle"><a class="boxlink" [^>]*>(.*?)<\/a><\/th>/i);
    const teamLinkMatch = rawHtml.match(/<a class="boxlink" style="font-weight:bold; font-size:18px; color:#FFFFFF;" href="\.\.\/teams\/team_\d+\.html">([^<]+)<\/a>/i);
    const statTableMatch = rawHtml.match(/<table class="data" border="0" cellspacing="0" cellpadding="0" width="673px" style="margin-bottom:5px;">([\s\S]*?)<\/table>/i);
    const nationalityMatch = rawHtml.match(/Nationality:<\/td>\s*<td class="wrap">([^<]+)<\/td>/i);
    const allNotes = [...rawHtml.matchAll(/<td width="888px" class="dl wrap">([\s\S]*?)<\/td>/gi)]
      .map((match) => cleanHtmlText(match[1]))
      .filter(Boolean);
    const timelineEntries = extractPlayerTimelineEntries(rawHtml);
    const scoutingNotes = allNotes.filter((text) => /OSA scouting updated ratings|Named the #\d+ prospect/i.test(text));
    const acquisitionSummaryLine = buildPlayerAcquisitionSummaryLine(rawHtml) || buildPlayerSigningFallbackLine(rawHtml);

    return {
      displayName: buildPlainPlayerName(cleanHtmlText(imageMatch?.[2] ?? selected.name)),
      imageUrl: toNewsLocalUrl(playerPath, imageMatch?.[1] ?? ""),
      headerLine: cleanHtmlText(headerMatch?.[1] ?? ""),
      teamFullName: cleanHtmlText(teamLinkMatch?.[1] ?? selected.team),
      nationality: cleanHtmlText(nationalityMatch?.[1] ?? ""),
      currentLine: parseProspectStatLine(statTableMatch?.[1] ?? ""),
      scoutingSummary: scoutingNotes.slice(0, 3),
      profileBlurb: buildProspectProfileBlurb(selected, cleanHtmlText(headerMatch?.[1] ?? ""), scoutingNotes),
      highlights: buildProspectHighlights(timelineEntries),
      awardsLine: buildProspectAwardsLine(timelineEntries),
      acquisitionSummaryLine,
    };
  } catch {
    return null;
  }
}

function readTopPlayerProfile(playerPath, selected) {
  try {
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const imageMatch = rawHtml.match(/<img src="([^"]+person_pictures\/player_\d+\.(?:png|jpg|jpeg|webp))"[^>]*title="([^"]*)"/i);
    const headerMatch = rawHtml.match(/<th colspan="2" class="boxtitle"><a class="boxlink" [^>]*>(.*?)<\/a><\/th>/i);
    const teamLinkMatch = rawHtml.match(/<a class="boxlink" style="font-weight:bold; font-size:18px; color:#FFFFFF;" href="\.\.\/teams\/team_\d+\.html">([^<]+)<\/a>/i);
    const statTableMatch = rawHtml.match(/<table class="data" border="0" cellspacing="0" cellpadding="0" width="673px" style="margin-bottom:5px;">([\s\S]*?)<\/table>/i);
    const metaLineMatch = rawHtml.match(/Age:\s*([^|<]+)\|\s*Bats:\s*([^|<]+)\|\s*Throws:\s*([^|<]+)\|\s*Morale:\s*([^<]+)/i);
    const majorServiceMatch = rawHtml.match(/Major Service:<\/td><td class="wrap">(\d+)\s+Years?/i);
    const salaryMatch = rawHtml.match(/<tr><td class="data_capt">Salary:<\/td><td class="wrap">([^<]+)<\/td><\/tr>/i);
    const popularityMatch = rawHtml.match(/<tr><td class="data_capt">Local Popularity:<\/td><td class="wrap">([^<]+)<\/td><\/tr>/i);
    const allStarCount = [...rawHtml.matchAll(/Was selected to the \d{4} American Baseball Association All-Star Game\./gi)].length;
    const awardsSummaryLine = buildPlayerAwardsSummaryLine(rawHtml);
    const acquisitionSummaryLine = buildPlayerAcquisitionSummaryLine(rawHtml);
    const timelineEntries = extractPlayerTimelineEntries(rawHtml);
    const contractContext = buildPlayerInterviewContractContext(timelineEntries);
    const abaSeasonCount = countPlayerAbaSeasons(rawHtml);

    return {
      displayName: buildPlainPlayerName(cleanHtmlText(imageMatch?.[2] ?? selected.name)),
      imageUrl: toNewsLocalUrl(playerPath, imageMatch?.[1] ?? ""),
      headerLine: cleanHtmlText(headerMatch?.[1] ?? ""),
      teamFullName: cleanHtmlText(teamLinkMatch?.[1] ?? selected.team),
      currentLine: parseProspectStatLine(statTableMatch?.[1] ?? ""),
      age: cleanHtmlText(metaLineMatch?.[1] ?? selected.age ?? ""),
      bats: cleanHtmlText(metaLineMatch?.[2] ?? ""),
      throws: cleanHtmlText(metaLineMatch?.[3] ?? ""),
      morale: cleanHtmlText(metaLineMatch?.[4] ?? ""),
      popularity: cleanHtmlText(popularityMatch?.[1] ?? ""),
      nationality: cleanHtmlText(selected.nationality ?? ""),
      abaSeasons: abaSeasonCount ? String(abaSeasonCount) : cleanHtmlText(majorServiceMatch?.[1] ?? ""),
      salary: cleanHtmlText(salaryMatch?.[1] ?? ""),
      acquisitionSummaryLine,
      allStarSelections: allStarCount,
      awardsSummaryLine,
      contractContext,
    };
  } catch {
    return null;
  }
}

function countPlayerAbaSeasons(rawHtml) {
  const years = new Set();
  for (const match of String(rawHtml ?? "").matchAll(/<a href="\.\.\/history\/team_year_\d+_(\d{4})\.html">(\d{4})[^<]*-\s*(?:ABA|MLB)<\/a>/gi)) {
    const year = cleanHtmlText(match[1] ?? "");
    if (year) {
      years.add(year);
    }
  }
  return years.size;
}

function buildPlayerAwardsSummaryLine(rawHtml) {
  const entries = extractPlayerAwardEntries(rawHtml);
  if (!entries.length) {
    return "";
  }

  const grouped = new Map();

  for (const entry of entries) {
    const existing = grouped.get(entry.label);
    if (existing) {
      existing.count += 1;
      existing.importance = Math.max(existing.importance, entry.importance);
    } else {
      grouped.set(entry.label, {
        label: entry.label,
        importance: entry.importance,
        count: 1,
      });
    }
  }

  const rankedAwards = [...grouped.values()]
    .sort((left, right) => right.importance - left.importance || right.count - left.count || left.label.localeCompare(right.label))
  const hasMajorAward = rankedAwards.some((entry) => isMajorAwardLabel(entry.label));
  const hasNonFallbackAward = rankedAwards.some((entry) => !isFallbackInterviewAwardLabel(entry.label));
  const filteredAwards = rankedAwards.filter((entry) => {
    if (isFallbackInterviewAwardLabel(entry.label)) {
      return !hasNonFallbackAward;
    }
    if (isMinorAwardLabel(entry.label)) {
      return !hasMajorAward;
    }
    return true;
  });

  return filteredAwards
    .slice(0, 3)
    .map((entry) => (entry.count > 1 ? `${entry.count}x ${entry.label}` : entry.label))
    .join(" | ");
}

function extractPlayerAwardEntries(rawHtml) {
  const notes = [...String(rawHtml ?? "").matchAll(/<td width="888px" class="dl wrap">([\s\S]*?)<\/td>/gi)]
    .map((match) => cleanHtmlText(match[1]))
    .filter(Boolean);
  const awards = [];

  for (const note of notes) {
    const allStarMatch = note.match(/Was selected to the \d{4} .*?All-Star Game/i);
    if (allStarMatch) {
      awards.push({ label: "All-Star", importance: 80 });
      continue;
    }

    const awardMatch = note.match(/(?:Wins|Won|Receives|Received)\s+the\s+(.+?)\s+Award\.?$/i);
    if (awardMatch) {
      const label = cleanAwardLabel(awardMatch[1]);
      const importance = scoreAwardLabel(label);
      if (label && importance > 0) {
        awards.push({ label, importance });
      }
    }
  }

  return awards;
}

function cleanAwardLabel(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^the\s+/i, "")
    .trim();
}

function scoreAwardLabel(label) {
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

function isMinorAwardLabel(label) {
  return /of the month|of the week/i.test(String(label ?? ""));
}

function isMajorAwardLabel(label) {
  return scoreAwardLabel(label) >= 75;
}

function isFallbackInterviewAwardLabel(label) {
  return /championship mvp|championship most valuable player|playoff mvp|playoff most valuable player|world series mvp|world championship mvp|league championship mvp/i.test(
    String(label ?? ""),
  );
}

function readTeamFeatureProfile(teamPath, fallbackTeamName, teamStanding) {
  try {
    const rawHtml = fs.readFileSync(teamPath, "utf8");
    const personnelPath = teamPath.replace(/\.html$/i, "_personnel.html");
    const personnelHtml = fs.existsSync(personnelPath) ? fs.readFileSync(personnelPath, "utf8") : "";
    const titleMatch = rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i);
    const subtitleMatches = [...rawHtml.matchAll(/<div class="repsubtitle">\s*([\s\S]*?)<\/div>/gi)]
      .map((match) => cleanHtmlText(match[1]))
      .filter(Boolean);
    const logoMatch = rawHtml.match(/<img src="([^"]+team_logos\/[^"]+)" border="0" title="([^"]+)"/i);
    const managerMatch = personnelHtml.match(/<td class="dl"><a href="\.\.\/coaches\/coach_\d+\.html">([^<]+)<\/a><\/td>\s*<td class="dl">Manager<\/td>/i);
    const affiliateMatch = rawHtml.match(
      /<tr><td colspan="2" class="boxtitle">MINOR LEAGUE SYSTEM<\/td><\/tr>[\s\S]*?<a href="\.\.\/teams\/team_\d+\.html">([^<]+)\s*\(([^)]+)\)<\/a>/i,
    );
    const currentInjuries = extractTeamPageInjuries(rawHtml);
    const rotation = extractTeamPageRotation(rawHtml);
    const bullpen = extractTeamPageBullpen(rawHtml);
    const topSalaries = extractTeamTopSalaries(teamPath);
    const topHitters = extractTeamTopHitters(teamPath);
    const historyFirstYear = extractTeamHistoryFirstYear(teamPath);
    const displayName = cleanHtmlText(teamStanding?.team ?? logoMatch?.[2] ?? titleMatch?.[1] ?? fallbackTeamName);

    return {
      fullName: displayName,
      summaryLine: cleanTeamHighlightSummaryLine(subtitleMatches[0] ?? ""),
      detailLine: subtitleMatches[1] ?? "",
      manager: cleanHtmlText(managerMatch?.[1] ?? ""),
      affiliate: affiliateMatch ? `${cleanHtmlText(affiliateMatch[1])} (${cleanHtmlText(affiliateMatch[2])})` : "",
      rotation,
      bullpen,
      topSalaries,
      topHitters,
      currentInjuries,
      historyFirstYear,
      logoUrl: toNewsLocalUrl(teamPath, logoMatch?.[1] ?? ""),
      logoAlt: cleanHtmlText(logoMatch?.[2] ?? displayName),
      teamPageUrl: `/news/teams/${path.basename(teamPath)}`,
      standing: teamStanding,
    };
  } catch {
    return {
      fullName: fallbackTeamName,
      summaryLine: "",
      detailLine: "",
      manager: "",
      rotation: [],
      bullpen: [],
      topSalaries: [],
      topHitters: [],
      currentInjuries: [],
      historyFirstYear: "",
      logoUrl: "",
      logoAlt: fallbackTeamName,
      teamPageUrl: "",
      standing: teamStanding,
    };
  }
}

function extractTeamPageRotation(rawHtml) {
  const tableMatch = String(rawHtml ?? "").match(
    /<tr><th class="boxtitle">PITCHING STAFF<\/th><\/tr>[\s\S]*?<table cellspacing="0" cellpadding="0" class="data sortable" width="100%">([\s\S]*?)<\/table>/i,
  );

  if (!tableMatch) {
    return [];
  }

  const rows = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  const rotation = [];

  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((match) => cleanHtmlText(match[1]));
    if (cells.length < 11 || cells[0] === "Role" || !/^starter$/i.test(cells[0] ?? "")) {
      continue;
    }

    rotation.push({
      throws: cells[1] ?? "",
      pitcher: cells[2] ?? "",
      wins: cells[5] ?? "",
      losses: cells[6] ?? "",
      era: cells[8] ?? "",
      whip: cells[9] ?? "",
      status: cells[10] ?? "",
    });
  }

  return rotation.slice(0, 5);
}

function extractTeamPageBullpen(rawHtml) {
  const tableMatch = String(rawHtml ?? "").match(
    /<tr><th class="boxtitle">PITCHING STAFF<\/th><\/tr>[\s\S]*?<table cellspacing="0" cellpadding="0" class="data sortable" width="100%">([\s\S]*?)<\/table>/i,
  );

  if (!tableMatch) {
    return [];
  }

  const rows = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  const bullpen = [];
  const rolePriority = new Map([
    ["closer", 0],
    ["setup", 1],
    ["middle relief", 2],
  ]);

  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((match) => cleanHtmlText(match[1]));
    if (cells.length < 11 || cells[0] === "Role") {
      continue;
    }

    const role = String(cells[0] ?? "").trim();
    const normalizedRole = role.toLowerCase();
    if (/^starter$/i.test(role) || !role || !rolePriority.has(normalizedRole)) {
      continue;
    }

    bullpen.push({
      role,
      rolePriority: rolePriority.get(normalizedRole) ?? 99,
      throws: cells[1] ?? "",
      pitcher: cells[2] ?? "",
      wins: cells[5] ?? "",
      losses: cells[6] ?? "",
      era: cells[8] ?? "",
      whip: cells[9] ?? "",
    });
  }

  return bullpen
    .sort((left, right) => left.rolePriority - right.rolePriority || left.pitcher.localeCompare(right.pitcher))
    .slice(0, 4)
    .map(({ rolePriority: _rolePriority, ...pitcher }) => pitcher);
}

function extractTeamTopSalaries(teamPath) {
  const salaryReportPath = teamPath.replace(/\.html$/i, "_player_salary_report.html");
  if (!fs.existsSync(salaryReportPath)) {
    return [];
  }

  try {
    const rawHtml = fs.readFileSync(salaryReportPath, "utf8");
    const tableMatch = rawHtml.match(/<table class="data sortable" cellspacing="0" cellpadding="0" width="968px">([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      return [];
    }

    const rows = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
    const salaries = [];

    for (const rowMatch of rows) {
      const cells = [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((match) => cleanHtmlText(match[1]));
      if (cells.length < 4 || cells[0] === "Pos") {
        continue;
      }

      const position = cells[0] ?? "";
      const name = normalizePlayerListName(cells[1] ?? "");
      const salary = cleanHtmlText(cells[3] ?? "");
      const salaryValue = parseSalaryValue(salary);

      if (!name || !salary || !Number.isFinite(salaryValue) || salaryValue <= 0) {
        continue;
      }

      salaries.push({
        position,
        name,
        salary,
        salaryValue,
      });
    }

    return salaries
      .sort((left, right) => right.salaryValue - left.salaryValue || left.name.localeCompare(right.name))
      .slice(0, 3)
      .map(({ salaryValue: _salaryValue, ...entry }) => entry);
  } catch {
    return [];
  }
}

function extractTeamTopHitters(teamPath) {
  const battingStatsPath = teamPath.replace(/\.html$/i, "_batting_stats_0_1.html");
  if (!fs.existsSync(battingStatsPath)) {
    return [];
  }

  try {
    const rawHtml = fs.readFileSync(battingStatsPath, "utf8");
    const tableStart = rawHtml.indexOf('<table class="stats sortable"');
    if (tableStart < 0) {
      return [];
    }

    const tableSlice = rawHtml.slice(tableStart);
    const rows = [...tableSlice.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
    const hitters = [];
    let headers = [];

    for (const rowMatch of rows) {
      const cells = [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((match) => cleanHtmlText(match[1]));
      if (!cells.length) {
        continue;
      }

      if (cells[0] === "Name") {
        headers = cells;
        continue;
      }

      if (cells.length < 19 || !headers.length) {
        continue;
      }

      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));

      const nameAndPos = row.Name ?? cells[0] ?? "";
      const nameMatch = nameAndPos.match(/^(.*?)(?:\s+(C|1B|2B|3B|SS|LF|CF|RF|DH))$/i);
      const name = normalizePlayerListName(nameMatch?.[1] ?? nameAndPos);
      const pos = cleanHtmlText(nameMatch?.[2] ?? "");
      const games = toNumber(row.G);
      const atBats = toNumber(row.AB);
      const hits = toNumber(row.H);
      const doubles = toNumber(row["2B"]);
      const triples = toNumber(row["3B"]);
      const homeRuns = toNumber(row.HR);
      const rbiValue = toNumber(row.RBI);
      const walks = toNumber(row.BB);
      const steals = toNumber(row.SB);
      const avg = cleanHtmlText(row.AVG ?? "");
      const hr = cleanHtmlText(row.HR ?? "");
      const rbi = cleanHtmlText(row.RBI ?? "");
      const battingAverage = toDecimalNumber(row.AVG);
      const obp = toDecimalNumber(row.OBP);
      const slg = toDecimalNumber(row.SLG);
      const ops = toDecimalNumber(row.OPS);

      if (!name) {
        continue;
      }

      if (games < 20 || atBats < 60) {
        continue;
      }

      const offensiveScore =
        ops * 1000 +
        battingAverage * 180 +
        homeRuns * 14 +
        rbiValue * 1.5 +
        hits * 0.35 +
        doubles * 1.5 +
        triples * 2 +
        walks * 0.45 +
        steals * 0.4 +
        obp * 140 +
        slg * 120;
      const playingTimeFactor = Math.min(1, Math.max(games / 40, atBats / 140));
      const war = toDecimalNumber(row.WAR);
      const finalScore = offensiveScore * playingTimeFactor + war * 35;

      hitters.push({
        name,
        pos,
        avg,
        hr,
        rbi,
        ops: cleanHtmlText(row.OPS ?? ""),
        war: cleanHtmlText(row.WAR ?? ""),
        score: finalScore,
      });
    }

    return hitters
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, 5);
  } catch {
    return [];
  }
}

function cleanTeamHighlightSummaryLine(value) {
  return String(value ?? "")
    .replace(/,\s*[\d.]+\s*PCT\b/gi, "")
    .replace(/\s*\|\s*[\d.]+\s*PCT\b/gi, "")
    .replace(/\s*\|\s*M#\s*[^|]*/gi, "")
    .replace(/\s+\|/g, " |")
    .replace(/\|\s*\|/g, "|")
    .replace(/\s+/g, " ")
    .trim();
}

function parseProspectStatLine(tableHtml) {
  if (!tableHtml) {
    return null;
  }

  const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cell) => cleanHtmlText(cell[1])))
    .filter((row) => row.length > 0);

  if (rows.length < 2) {
    return null;
  }

  const headers = rows[0];
  const values = rows[1];
  const record = {};
  headers.forEach((header, index) => {
    record[header] = values[index] ?? "";
  });

  return record;
}

function buildProspectProfileBlurb(selected, headerLine, scoutingNotes) {
  const note = cleanProspectScoutingNote(scoringNoteCandidate(scoutingNotes));
  return note || "";
}

function scoringNoteCandidate(scoutingNotes) {
  return scoutingNotes.find((entry) => /Drafted in/i.test(entry)) ?? scoutingNotes[0] ?? "";
}

function cleanProspectScoutingNote(note) {
  const rawNote = String(note ?? "").replace(/\s+/g, " ").trim();
  if (!rawNote) {
    return "";
  }

  const draftIndex = rawNote.search(/Drafted in/i);
  if (draftIndex >= 0) {
    return rawNote.slice(draftIndex).trim();
  }

  const scoutingIndex = rawNote.search(/OSA scouting updated ratings/i);
  if (scoutingIndex >= 0) {
    return rawNote.slice(scoutingIndex).trim();
  }

  return rawNote;
}

function buildProspectHighlights(notes) {
  const normalizedNotes = (notes ?? [])
    .map((note) =>
      typeof note === "string"
        ? { date: "", text: String(note ?? "").replace(/\s+/g, " ").trim() }
        : {
            date: String(note?.date ?? "").replace(/\s+/g, " ").trim(),
            text: String(note?.text ?? "").replace(/\s+/g, " ").trim(),
          })
    .filter((note) => note.text);
  const highlights = [];
  const seen = new Set();
  const futuresYears = [];
  const repeatableAwards = new Map();

  for (const note of normalizedNotes) {
    if (/Named the #\d+ prospect/i.test(note.text)) {
      continue;
    }

    let label = "";
    if (/selected to the .*All-Star Futures Game/i.test(note.text)) {
      const yearMatch = note.text.match(/\b(20\d{2})\b/);
      const year = cleanHtmlText(yearMatch?.[1] ?? "");
      if (year && !futuresYears.includes(year)) {
        futuresYears.push(year);
      }
      continue;
    } else if (/selected to the .*All-Star Game/i.test(note.text)) {
      label = note.text.replace(/^Was /i, "");
    } else if (/(?:Wins|Won|Receives|Received)\s+the\s+.+?\s+Award/i.test(note.text)) {
      const awardMatch = note.text.match(/(?:Wins|Won|Receives|Received)\s+the\s+(.+?\s+Award)\.?$/i);
      const awardLabel = cleanAwardLabel(awardMatch?.[1] ?? note.text.replace(/\.$/, "")).replace(/^\d{4}\s+/i, "");
      if (/of the week/i.test(awardLabel)) {
        const existing = repeatableAwards.get(awardLabel) ?? { count: 0, dates: [] };
        const formattedDate = formatProspectHighlightDate(note.date);
        existing.count += 1;
        if (formattedDate) {
          existing.dates.push(formattedDate);
        }
        repeatableAwards.set(awardLabel, existing);
        continue;
      } else {
        label = note.text.replace(/\.$/, "");
      }
    } else if (/record/i.test(note.text)) {
      label = note.text.replace(/\.$/, "");
    } else if (/Prospects Game|Future Game|MVP/i.test(note.text)) {
      label = note.text.replace(/\.$/, "");
    }

    if (!label) {
      continue;
    }

    const cleaned = cleanHtmlText(label);
    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    highlights.push(cleaned);
  }

  for (const [awardLabel, info] of repeatableAwards.entries()) {
    const cleanedAward = cleanHtmlText(awardLabel);
    if (!cleanedAward) {
      continue;
    }

    const label = info.count > 1
      ? `${info.count}X ${cleanedAward}`
      : (info.dates[0] ? `${cleanedAward} (${info.dates[0]})` : cleanedAward);
    const dedupeKey = label.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    highlights.push(label);
  }

  if (futuresYears.length) {
    const combinedFuturesLabel = `ABA All-Star Futures Game (${futuresYears.join(", ")})`;
    const futuresKey = combinedFuturesLabel.toLowerCase();
    if (!seen.has(futuresKey)) {
      highlights.unshift(combinedFuturesLabel);
    }
  }

  return highlights.slice(0, 6);
}

function buildProspectAwardsLine(notes) {
  const highlights = buildProspectHighlights(notes);
  if (!highlights.length) {
    return "";
  }

  return highlights.slice(0, 3).join(" | ");
}

function formatProspectHighlightDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return text;
  }

  return `${match[3]}-${match[1]}-${match[2]}`;
}

function findTeamStandingsContext(teamName, standingsSections) {
  for (const section of standingsSections ?? []) {
    for (const row of section.rows ?? []) {
      if (buildTeamLookupKeys(row.Team).some((key) => buildTeamLookupKeys(teamName).includes(key))) {
        return {
          sectionLabel: section.label,
          team: row.Team,
          wins: String(row.W ?? "").trim(),
          losses: String(row.L ?? "").trim(),
          gb: String(row.GB ?? "").trim(),
          l10: String(row.L10 ?? "").trim(),
          streak: String(row.Strk ?? "").trim(),
          magicNumber: String(row["M#"] ?? "").trim(),
        };
      }
    }
  }

  return null;
}

function buildPlayerInterview(selected, playerProfile, teamProfile, teamStanding, playerHistory, playerRecords, playerLeaderboardEntries = [], admiredPeer = null) {
  const isPitcher = selected.profileType === "pitcher";
  const currentLine = playerProfile.currentLine ?? {};
  const teamContext = formatTeamContext(teamProfile.fullName, teamStanding);
  const historyTalkingPoint = buildInterviewHistoryTalkingPoint(playerHistory, playerRecords, playerLeaderboardEntries);
  const awardTalkingPoint = buildInterviewAwardTalkingPoint(playerProfile);
  const roleTalkingPoint = buildInterviewRoleTalkingPoint(selected, teamProfile, teamStanding);
  const admiredPeerTalkingPoint = buildInterviewAdmiredPeerTalkingPoint(admiredPeer);

  if (isPitcher) {
    return [
      {
        question: "How would you describe the season you have put together so far?",
        answer: `I feel like I have been able to stay on the attack. The line is real enough to speak for itself: ${currentLine.Rec || selected.summaryStats?.Rec || ""}, ${currentLine.ERA || selected.summaryStats?.ERA || ""} ERA, ${currentLine.IP || selected.summaryStats?.IP || ""} innings, and ${currentLine.K || selected.summaryStats?.K || ""} strikeouts. More than anything, I like that the starts have been crisp and that I have given the club a chance to win almost every time out.`,
      },
      {
        question: "What does the team context do for your confidence right now?",
        answer: `${teamContext} When the club is in games that matter every night, you feel it. You stop thinking about your line and start thinking about whether you gave the guys enough to win a series.`,
      },
      {
        question: "What has clicked over the last few weeks?",
        answer: `I think I have trusted the whole mix better. The temptation for a pitcher is to chase the perfect punchout pitch, but lately I have been getting ahead, taking the quick outs when they show up, and letting the strikeouts come after that.`,
      },
      {
        question: "What does your role on this team feel like right now?",
        answer: roleTalkingPoint,
      },
      {
        question: "Which player from another team do you most admire or respect, and why?",
        answer: admiredPeerTalkingPoint,
      },
      {
        question: "How do you balance the individual year with the club’s season?",
        answer: `A starter gets to be selfish only for about fifteen seconds after a good outing. After that, it becomes about the next series and whether we kept momentum moving for the team. That is especially true when ${teamProfile.fullName} are trying to turn a strong spring into a real summer run.`,
      },
      {
        question: "How much of your career follows you into a season like this?",
        answer: historyTalkingPoint,
      },
      {
        question: "What would make the second half satisfying for you?",
        answer: `In this league the calendar moves quickly. We open in April, the season already feels like midseason by early June, and by mid-July you are looking at the finish line with the playoffs right there. So for me it is simple: keep taking the ball, keep the starts efficient, and make sure the games in July feel like the kind that push us toward the playoffs, not away from them.`,
      },
    ];
  }

  return [
    {
      question: "How would you sum up your season to this point?",
      answer: `I think it has been forceful without feeling rushed. Right now the line shows ${currentLine.AVG || selected.summaryStats?.AVG || ""}, ${currentLine.OBP || ""} OBP, ${currentLine.SLG || ""} slugging, ${currentLine.HR || selected.summaryStats?.HR || ""} home runs, and ${currentLine.RBI || selected.summaryStats?.RBI || ""} RBI. That tells me I have been driving the baseball, but it also tells me the at-bats have had shape to them.`,
    },
    {
      question: "How much does the club’s season shape the way you look at your own numbers?",
      answer: `${teamContext} That is the backdrop to everything I do. Big numbers are fun, but they are a lot more interesting when they are attached to a team trying to hold first place or chase somebody down.`,
    },
    {
      question: "Have the last few weeks felt different at the plate?",
      answer: `A little. I feel calmer in the first two pitches of the at-bat than I did early on, and when I am calm, I can tell the difference between the ball I should hammer and the ball I should spit on. That is usually where my best stretches begin.`,
    },
    {
      question: "What do you think people miss when they just read the headline stats?",
      answer: `They usually notice the home runs or the batting average first, and that makes sense, but I care just as much about whether the at-bats are clean. If I am controlling the count and not giving away too many strikeouts, the rest of the line usually follows.`,
    },
    {
      question: "Which player from another team do you most admire or respect, and why?",
      answer: admiredPeerTalkingPoint,
    },
    {
      question: "How much of this season feels connected to the rest of your career?",
      answer: historyTalkingPoint,
    },
    {
      question: "What do you like most about the lineup or clubhouse around you?",
      answer: `I like that the room does not chase style points. There are enough hitters in this lineup who can move an inning along, enough people who can change a game with one swing, and enough veterans who know when a good three-run inning is better than a heroic one-run solo act.`,
    },
      {
        question: "What would make the rest of the season feel special?",
        answer: `I want it to feel urgent all the way through, because a 92-game season does not give anybody room to drift. We start in April, we hit midseason by the start of June, and then July shows up fast with the playoffs not far behind. If I keep swinging it the way I have and ${teamProfile.fullName} keep stacking wins, that is the kind of sprint people remember.`,
      },
  ];
}

function buildPlayerInterviewV2(
  selected,
  playerProfile,
  teamProfile,
  teamStanding,
  playerHistory,
  playerRecords,
  playerLeaderboardEntries = [],
  admiredPeer = null,
  currentMode = "",
  currentDate = null,
) {
  const seasonShape = summarizePlayerInterviewSeasonShape(selected, playerProfile);
  const historyTalkingPoint = buildInterviewHistoryTalkingPoint(playerHistory, playerRecords, playerLeaderboardEntries);

  return [
    buildPlayerInterviewSeasonSummaryQuestion(selected, playerProfile, seasonShape, currentDate),
    buildPlayerInterviewModeQuestion(selected, playerProfile, teamProfile, teamStanding, currentMode, seasonShape),
    buildPlayerInterviewCraftQuestion(selected, playerProfile, seasonShape, currentDate),
    buildPlayerInterviewPersonalQuestion(selected, playerProfile, teamProfile, teamStanding, playerHistory),
    {
      question: "Which player from another team do you most admire or respect, and why?",
      answer: buildInterviewAdmiredPeerTalkingPoint(admiredPeer),
    },
    {
      question: selected.profileType === "pitcher" ? "How much of your career follows you into a season like this?" : "How much of this season feels connected to the rest of your career?",
      answer: historyTalkingPoint,
    },
    buildPlayerInterviewLifestyleQuestion(selected, playerProfile, teamProfile, currentDate),
    buildPlayerInterviewClosingQuestion(selected, playerProfile, teamProfile, teamStanding, currentMode, seasonShape, currentDate),
  ];
}

function summarizePlayerInterviewSeasonShape(selected, playerProfile) {
  const line = playerProfile?.currentLine ?? {};
  if (selected?.profileType === "pitcher") {
    const era = parseDecimalNumber(line.ERA ?? selected?.summaryStats?.ERA ?? "");
    const whip = parseDecimalNumber(line.WHIP ?? "");
    if ((Number.isFinite(era) && era >= 4.8) || (Number.isFinite(whip) && whip >= 1.45)) {
      return "rough";
    }
    if ((Number.isFinite(era) && era <= 3.2) || (Number.isFinite(whip) && whip <= 1.15)) {
      return "strong";
    }
    return "steady";
  }

  const avg = parseDecimalNumber(line.AVG ?? selected?.summaryStats?.AVG ?? "");
  const obp = parseDecimalNumber(line.OBP ?? "");
  const slg = parseDecimalNumber(line.SLG ?? "");
  const ops = Number.isFinite(obp) && Number.isFinite(slg) ? obp + slg : Number.NaN;
  if ((Number.isFinite(avg) && avg >= 0.3) || (Number.isFinite(ops) && ops >= 0.85)) {
    return "strong";
  }
  if ((Number.isFinite(avg) && avg <= 0.24) || (Number.isFinite(ops) && ops <= 0.68)) {
    return "rough";
  }
  return "steady";
}

function buildPlayerInterviewSeasonSummaryQuestion(selected, playerProfile, seasonShape, currentDate) {
  const currentLine = playerProfile?.currentLine ?? {};
  const isReliever = isPlayerInterviewReliever(selected);
  const variants = selected.profileType === "pitcher"
    ? [
        {
          question: "When you look at your line right now, what feels the most honest about it?",
          answer: `The line tells the truth if you let it. Right now it shows ${currentLine.Rec || selected.summaryStats?.Rec || ""}, ${currentLine.ERA || selected.summaryStats?.ERA || ""} ERA, ${currentLine.IP || selected.summaryStats?.IP || ""} innings, and ${currentLine.K || selected.summaryStats?.K || ""} strikeouts. ${seasonShape === "strong" ? "That usually means I have been dictating counts instead of surviving them." : seasonShape === "rough" ? `It also tells me I have left some pitches in the wrong part of the zone, and ${isReliever ? "a reliever does not get many chances to hide from one bad inning" : "a pitcher always knows which innings dragged the whole line in the wrong direction"}.` : "It feels like a workable foundation, and now the job is to sharpen it."}`,
        },
        {
          question: "What has this season asked from you on the mound?",
          answer: `Mostly honesty. A pitcher can hide from himself for maybe an inning or two, but not for a full season. The line right now is ${currentLine.ERA || selected.summaryStats?.ERA || ""} ERA with ${currentLine.K || selected.summaryStats?.K || ""} strikeouts over ${currentLine.IP || selected.summaryStats?.IP || ""} innings, and that says I have had to stay committed to the plan every time out.${seasonShape === "rough" ? ` When the numbers are not where you want them, the answer is usually less drama and more execution.` : ""}`,
        },
        {
          question: isReliever ? "How would you describe the work you have been doing out of the bullpen?" : "How would you describe the baseball you are playing right now?",
          answer: `${seasonShape === "strong" ? "Aggressive and clean." : seasonShape === "rough" ? "A little uneven, if I am being fair." : "Fairly solid, with another gear still there."} I keep going back to the basics: get strike one, own the pace, and make hitters feel like the at-bat belongs to me.${isReliever ? " Out of the bullpen, everything gets condensed, so conviction matters even more." : ""}`,
        },
      ]
    : [
        {
          question: "When you look at your line right now, what feels the most honest about it?",
          answer: `I think the shape of the at-bats shows up in it. Right now the line reads ${currentLine.AVG || selected.summaryStats?.AVG || ""}, ${currentLine.OBP || ""} OBP, ${currentLine.SLG || ""} slugging, ${currentLine.HR || selected.summaryStats?.HR || ""} home runs, and ${currentLine.RBI || selected.summaryStats?.RBI || ""} RBI. ${seasonShape === "strong" ? "That feels like a hitter who has been on time and under control." : seasonShape === "rough" ? "It also reminds me there are too many at-bats where I expanded the zone or missed a pitch I usually punish." : "It feels like a decent base, and I know there is more in there."}`,
        },
        {
          question: "What has this season asked from you in the box?",
          answer: `Patience, really. You can want a loud season so badly that you start swinging at noise. I have tried to make the at-bat itself the priority, and the line now reflects that more than any one hot week does.${seasonShape === "rough" ? " When the numbers are not where you want them, that patience gets tested the most." : ""}`,
        },
        {
          question: "How would you describe the baseball you are playing right now?",
          answer: `${seasonShape === "strong" ? "Controlled and dangerous." : seasonShape === "rough" ? "Still searching for a cleaner rhythm." : "Pretty balanced."} When I am right, the swing decisions are quiet and the game speeds up for the pitcher instead of for me.`,
        },
      ];

  return variants[pickInterviewVariantIndex(`interview:season:${selected.playerId}`, variants.length, currentDate)] ?? variants[0];
}

function buildPlayerInterviewModeQuestion(selected, playerProfile, teamProfile, teamStanding, currentMode, seasonShape) {
  const teamName = teamProfile?.fullName ?? selected?.team ?? "the club";
  const teamContext = formatTeamContext(teamName, teamStanding);
  const mode = String(currentMode ?? "").trim().toUpperCase();

  if (mode === "EARLY_SEASON") {
    return {
      question: "It is still early. What can a player actually learn from the first stretch of games?",
      answer: `${teamContext} Early on, I think you learn whether your habits are real. A hot week is nice, but what matters is whether your process looks repeatable when the adrenaline wears off. ${seasonShape === "strong" ? "That is the part I want to hold onto right now." : seasonShape === "rough" ? "If the start is rough, it is still early enough to fix it without inventing drama." : "This part of the year is about building a version of yourself you can trust later."}`,
    };
  }

  if (mode === "MIDDLE_SEASON") {
    return {
      question: "By this point in the season, what gets more important for a player?",
      answer: `${teamContext} Midseason is where the season stops being theoretical. You know what is working, you know what is not, and now it is about making the right adjustment before the calendar gets mean. ${seasonShape === "rough" ? "There is still enough runway to correct a bad stretch, but only if you are honest about it." : "That is why I like this part of the year. The baseball gets more truthful."}`,
    };
  }

  if (mode === "LATE_SEASON") {
    return {
      question: "When the season gets late, how much does the urgency change your day?",
      answer: `${teamContext} You feel the edge more, no question. The work is the same, but the consequences get louder. A good series can move you, a bad one can sting for a while, and players know that without anybody giving a speech about it.`,
    };
  }

  if (mode === "PLAYOFFS") {
    return {
      question: selected.profileType === "pitcher" ? "What changes for a pitcher once the postseason starts?" : "What changes for a hitter once the postseason starts?",
      answer: `Everything gets narrower. The room is tighter, the scouting is sharper, and the margin for one loose inning or one lazy at-bat gets tiny. That is also what makes it fun. Postseason baseball has a way of asking whether you can still look like yourself when everybody is fully awake.`,
    };
  }

  if (mode === "OFFSEASON" || mode === "PRESEASON" || mode === "SPRING") {
    return {
      question: "What are you usually trying to sharpen before the games really start to count?",
      answer: `I usually want the game to feel natural again. Timing, body rhythm, little details in the routine. You are not trying to win the whole season in one week. You are trying to make sure the baseball feels honest when the lights get brighter.`,
    };
  }

  return {
    question: selected.profileType === "pitcher" ? "How much does the team context affect the way you take the mound?" : "How much does the team context shape the way you look at your own numbers?",
    answer: `${teamContext} The club always gives the numbers their proper weight. A good line feels better when it is helping the room breathe a little easier.`,
  };
}

function buildPlayerInterviewCraftQuestion(selected, playerProfile, seasonShape, currentDate) {
  const role = selected.profileType;
  const isReliever = isPlayerInterviewReliever(selected);
  const variants = role === "pitcher"
    ? [
        {
          question: "What pitch has felt most like yours lately?",
          answer: `${seasonShape === "strong" ? "Probably the one I can land when the count is uncomfortable." : "The funny thing is I still know which pitch should carry me; the challenge is commanding it when the inning starts speeding up."} For me, the whole outing changes when I can get ahead with conviction and then let the secondary stuff finish the argument.`,
        },
        {
          question: isReliever ? "What part of pitching have you been thinking about most between appearances?" : "What part of pitching have you been thinking about most between starts?",
          answer: `Tempo, honestly. Mechanics matter, shapes matter, all of that matters, but if my tempo is right the outing usually settles down with it. I want the hitter to feel like the at-bat is being conducted on my terms.${isReliever ? " Relief work can get rushed if you let it, so I think pace matters even more there." : ""}`,
        },
        {
          question: isReliever ? "When an inning is going your way out of the bullpen, what does it feel like from your end?" : "When a start is going your way, what does it feel like from your end?",
          answer: `It feels quiet. Catch the sign, trust it, execute it, move on. ${isReliever ? "The good relief appearances usually feel like the inning never gets a chance to become loud." : "The good starts usually do not feel dramatic from the mound."} They feel like I am shortening every conversation before it gets interesting for the other side.`,
        },
      ]
    : [
        {
          question: "What part of hitting have you been thinking about the most lately?",
          answer: `Really just swing decisions. If I am choosing well early in the count, the whole at-bat gets cleaner. ${seasonShape === "strong" ? "That is usually what the best stretches come down to for me." : seasonShape === "rough" ? "And when I am not choosing well, the whole line starts wearing it." : "That is the part I keep coming back to."}`,
        },
        {
          question: "When you are locked in at the plate, what tells you first?",
          answer: `Usually it is not the homer. It is the foul ball I spoil, or the pitch just off the edge that I do not chase. When those little moments are clean, I know the swing is in a good place.`,
        },
        {
          question: "What are you trying to make a pitcher feel during an at-bat?",
          answer: `I want him to feel like there is no easy answer. Maybe I spit on the pitch he wanted me to offer at. Maybe I get to the mistake he thought he could sneak by me. The whole goal is to make him throw one extra honest pitch.`,
        },
      ];

  return variants[pickInterviewVariantIndex(`interview:craft:${selected.playerId}`, variants.length, currentDate)] ?? variants[0];
}

function buildPlayerInterviewClubhouseQuestion(selected, teamProfile, teamStanding, seasonShape, currentDate) {
  const teamName = teamProfile?.fullName ?? selected?.team ?? "the club";
  const teamContext = formatTeamContext(teamName, teamStanding);
  const variants = selected.profileType === "pitcher"
    ? [
        {
          question: "What is the mood of the room like around this club right now?",
          answer: `${teamContext} I like a room where the game can still breathe. You want urgency, sure, but you also want people loose enough to play clean baseball. The best clubhouses know how to hold both at once.`,
        },
        {
          question: "What do you like about the defense or the staff behind you right now?",
          answer: `I like that there is not much panic in it. A pitcher loves a defense that keeps the game moving and a staff that treats the sixth inning with the same seriousness as the first. That steadiness matters more than outsiders usually realize.`,
        },
        {
          question: "What do good teammates do for a pitcher over a long season?",
          answer: `They keep you from making every inning personal. The season is too long for that. A good room pulls you back to the team when your own head starts getting noisy.`,
        },
      ]
    : [
        {
          question: "What do you like most about the lineup or clubhouse around you right now?",
          answer: `I like that the room does not chase style points. There are enough hitters in this lineup who can move an inning along, enough people who can change a game with one swing, and enough veterans who know when a good three-run inning is better than a heroic one-run solo act.`,
        },
        {
          question: "What does a good clubhouse do for a hitter over a long season?",
          answer: `${seasonShape === "rough" ? "It stops you from overreacting to your own bad week." : "It gives your good days somewhere useful to go."} The best rooms keep the at-bat connected to the team instead of letting every player drift into his own weather.`,
        },
        {
          question: "What do you appreciate about the hitters around you when the lineup is moving?",
          answer: `I appreciate professional at-bats. The guy who takes a nasty pitch and stays alive. The guy who advances an inning even without a hit. That is the kind of baseball players notice in real time.`,
        },
      ];

  return variants[pickInterviewVariantIndex(`interview:clubhouse:${selected.playerId}`, variants.length, currentDate)] ?? variants[0];
}

function buildPlayerInterviewLifestyleQuestion(selected, playerProfile, teamProfile, currentDate) {
  const roleText = isPlayerInterviewReliever(selected)
    ? "before I might get the call from the bullpen"
    : selected.profileType === "pitcher"
      ? "before I get the ball"
      : "before first pitch";
  const variants = [
    {
      question: "What kind of music do you keep around the clubhouse or in the car these days?",
      answer: `Usually a mix of artists like OutKast, Bad Bunny, Luke Combs, or Kendrick Lamar, depending on the day. I do not need a full soundtrack, just enough to keep the room moving a little. Ballplayers spend so much time around each other that everybody winds up borrowing a little of everybody else's taste anyway.`,
    },
    {
      question: isPlayerInterviewReliever(selected) ? "What does your pregame routine look like when you know you need to be ready fast out of the bullpen?" : selected.profileType === "pitcher" ? "What does your pregame routine look like on a day you know you're starting?" : "What does your pregame routine look like before a game?",
      answer: `I like routine because it keeps the mind from wandering. Nothing theatrical. Get the body loose, look at the scouting, settle the breathing down a little, and make sure I feel like myself ${roleText}. If the routine feels too fancy, it usually means I am trying to convince myself of something.`,
    },
    {
      question: "Is there a TV show or movie you always come back to during the season?",
      answer: `I usually lean toward something familiar like The Office, Friday Night Lights, or old Moneyball reruns because the season already gives you enough new information every day. A good comfort show on a hotel night can do more for a player than people think. Sometimes you just want the brain to stop scouting for a little while.`,
    },
    {
      question: "Do you have any small superstition or habit that teammates tease you about?",
      answer: `Nothing too wild, but there are definitely a couple little things I would rather not skip. Ballplayers say they are not superstitious and then get very interested in the exact same chair, the same tape job, the same stretch timing. It is part of the charm of the game.`,
    },
  ];

  return variants[pickInterviewVariantIndex(`interview:lifestyle:${selected.playerId}`, variants.length, currentDate)] ?? variants[0];
}

function buildPlayerInterviewClosingQuestion(selected, playerProfile, teamProfile, teamStanding, currentMode, seasonShape, currentDate) {
  const teamName = teamProfile?.fullName ?? selected?.team ?? "the club";
  const awardTalkingPoint = buildInterviewAwardTalkingPoint(playerProfile);
  const mode = String(currentMode ?? "").trim().toUpperCase();
  const isReliever = isPlayerInterviewReliever(selected);
  const variants = selected.profileType === "pitcher"
    ? [
        {
          question: "What would make the next stretch of games satisfying for you?",
          answer: `${mode === "LATE_SEASON" ? "At this point you want every outing to feel like it is carrying real weight." : mode === "MIDDLE_SEASON" ? "This part of the season is about turning decent work into dependable work." : "I mostly want the habits to stay true."} ${isReliever ? "Keep being ready, keep the tempo right, and make sure the team feels steady when my number gets called." : "Keep taking the ball, keep the tempo right, and make sure the team feels steady when I am in the game."}`,
        },
        {
          question: "What do you want teammates to feel when you hand the ball back to the dugout?",
          answer: `That the game was under control and that they had every chance to go win it. Pitchers can get romantic about strikeouts, but most of us really want the dugout to feel calm when our night is done.`,
        },
        {
          question: "Has anything happened lately that made you feel the season shifting a little?",
          answer: awardTalkingPoint,
        },
      ]
    : [
        {
          question: "What would make the rest of the season feel special?",
          answer: `${mode === "LATE_SEASON" ? "You want the games to feel important and for your at-bats to keep mattering inside them." : mode === "MIDDLE_SEASON" ? "You want this next stretch to clarify what kind of team you really are." : "I want the good work to become steady work."} If I keep taking quality at-bats and ${teamName} keeps putting itself in meaningful games, that is the kind of stretch players remember.`,
        },
        {
          question: "What do you want the other dugout saying about you after a series?",
          answer: `Probably that I was annoying in the right way. That I did not give away many at-bats, that I kept innings alive, and that even the outs were not easy. Hitters like being feared, sure, but players respect being difficult even more.`,
        },
        {
          question: "What has felt most fun about this stretch of the season?",
          answer: `${seasonShape === "strong" ? "When the baseball is good, the game gets light again in the best way." : "Even when the line is not perfect, there is still joy in getting back to the cage and solving the next problem."} That is the part people forget. Players are competitors, but we also really love the work.`,
        },
      ];

  return variants[pickInterviewVariantIndex(`interview:closing:${selected.playerId}`, variants.length, currentDate)] ?? variants[0];
}

function pickInterviewVariantIndex(seedKey, count, currentDate = null) {
  if (!count) {
    return 0;
  }

  const dateSeed = currentDate instanceof Date && !Number.isNaN(currentDate.getTime())
    ? currentDate.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const seed = `${dateSeed}::${seedKey}`;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 33 + char.charCodeAt(0)) % 2147483647;
  }
  return Math.abs(hash) % count;
}

function parseDecimalNumber(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.+-]/g, "").trim();
  if (!cleaned) {
    return Number.NaN;
  }
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function finalizePlayerInterview(interview, selected, playerProfile, teamProfile, teamStanding, playerHistory, playerRecords, playerLeaderboardEntries = [], admiredPeer = null) {
  const inferredMode = inferPlayerInterviewMode(teamStanding);
  const rebuiltInterview = buildPlayerInterviewV2(
    selected,
    playerProfile,
    teamProfile,
    teamStanding,
    playerHistory,
    playerRecords,
    playerLeaderboardEntries,
    admiredPeer,
    inferredMode,
    null,
  );
  const list = Array.isArray(rebuiltInterview) && rebuiltInterview.length ? [...rebuiltInterview] : Array.isArray(interview) ? [...interview] : [];
  const historyTalkingPoint = buildInterviewHistoryTalkingPoint(playerHistory, playerRecords, playerLeaderboardEntries);
  const awardTalkingPoint = buildInterviewAwardTalkingPoint(playerProfile);
  const teamContext = formatTeamContext(teamProfile.fullName, teamStanding);
  const admiredPeerTalkingPoint = buildInterviewAdmiredPeerTalkingPoint(admiredPeer);
  const personalQuestionTalkingPoint = buildPlayerInterviewPersonalQuestion(selected, playerProfile, teamProfile, teamStanding, playerHistory);
  const contractContext = playerProfile?.contractContext ?? {};
  const seasonShape = summarizePlayerInterviewSeasonShape(selected, playerProfile);
  const currentLine = playerProfile?.currentLine ?? {};
  const isReliever = isPlayerInterviewReliever(selected);

  return list.map((item) => {
    const question = String(item?.question ?? "");

    if (/look at your line right now/i.test(question) && selected.profileType === "pitcher") {
      return {
        question: question,
        answer: `The line tells the truth if you let it. Right now it shows ${currentLine.Rec || selected.summaryStats?.Rec || ""}, ${currentLine.ERA || selected.summaryStats?.ERA || ""} ERA, ${currentLine.IP || selected.summaryStats?.IP || ""} innings, and ${currentLine.K || selected.summaryStats?.K || ""} strikeouts. ${
          seasonShape === "rough"
            ? `It also tells me I have left some pitches in the wrong part of the zone, and ${isReliever ? "a reliever does not get many chances to hide from one bad inning" : "a pitcher always knows which innings dragged the whole line in the wrong direction"}.`
            : seasonShape === "strong"
              ? "That usually means I have been dictating counts instead of surviving them."
              : "It feels like a workable foundation, and now the job is to sharpen it."
        }`,
      };
    }

    if (/team context do for your confidence/i.test(question)) {
      return {
        ...item,
        answer: `${teamContext} When the club is in games that matter every night, you feel it. You stop thinking about your line and start thinking about whether you gave the guys enough to win a series.`,
      };
    }

    if (/club.*season shape/i.test(question)) {
      return {
        ...item,
        answer: `${teamContext} That is the truth of it. A good line feels a lot better when it is helping the club breathe a little easier.`,
      };
    }

    if (/osa page/i.test(question) || /ranked among the top players/i.test(question)) {
      return {
        question: personalQuestionTalkingPoint.question,
        answer: personalQuestionTalkingPoint.answer,
      };
    }

    if (/what does your role on this team feel like right now/i.test(question) || /what is your role on this club when things are going right/i.test(question)) {
      return {
        question: personalQuestionTalkingPoint.question,
        answer: personalQuestionTalkingPoint.answer,
      };
    }

    if (/career reputation/i.test(question) || /season feels connected to the rest of your career/i.test(question)) {
      if (contractContext?.isUpcomingFreeAgent) {
        return {
          question: "You're set to be a free agent after the season. How do you feel about that hanging over the year?",
          answer: `You know it is there because players are not blind to the calendar, but I do not think it has to become a burden unless you let it. My job is still to show up, help ${teamProfile.fullName} win games, and trust that the business side will sort itself out after the season. If anything, it sharpens your focus because you want your baseball to stay honest all the way through.`,
        };
      }

      return {
        question: selected.profileType === "pitcher" ? "How much of your career follows you into a season like this?" : "How much of this season feels connected to the rest of your career?",
        answer: historyTalkingPoint,
      };
    }

    if (/balance the individual year/i.test(question) || /what would make the rest of the season feel special/i.test(question)) {
      return {
        question: selected.profileType === "pitcher" ? "Has anything happened lately that made you feel the season shifting a little?" : "What would make the rest of the season feel special?",
        answer:
          selected.profileType === "pitcher"
            ? awardTalkingPoint
            : `${awardTalkingPoint} In a 92-game season you do not have forever to prove what kind of club you are. We are already at the point where a strong couple of weeks can set the whole summer up the right way.`,
      };
    }

    if (/has anything happened lately/i.test(question)) {
      return {
        ...item,
        answer: awardTalkingPoint,
      };
    }

    if (/Which player from another team do you most admire or respect, and why\?/i.test(question)) {
      return {
        question: "Which player from another team do you most admire or respect, and why?",
        answer: admiredPeerTalkingPoint,
      };
    }

    if (/between starts/i.test(question) && isReliever) {
      return {
        question: "What part of pitching have you been thinking about most between appearances?",
        answer: "Tempo, honestly. Mechanics matter, shapes matter, all of that matters, but if my tempo is right the outing usually settles down with it. I want the hitter to feel like the at-bat is being conducted on my terms. Relief work can get rushed if you let it, so I think pace matters even more there.",
      };
    }

    if (/what kind of music do you keep around the clubhouse or in the car these days/i.test(question)) {
      return {
        question: "What kind of music do you keep around the clubhouse or in the car these days?",
        answer: "Usually a mix of artists like OutKast, Bad Bunny, Luke Combs, or Kendrick Lamar, depending on the day. I do not need a full soundtrack, just enough to keep the room moving a little. Ballplayers spend so much time around each other that everybody winds up borrowing a little of everybody else's taste anyway.",
      };
    }

    if (/what would make the next stretch of games satisfying for you/i.test(question) && isReliever) {
      return {
        question: "What would make the next stretch of games satisfying for you?",
        answer: "I mostly want the habits to stay true. Keep being ready, keep the tempo right, and make sure the team feels steady when my number gets called.",
      };
    }

    return item;
  });
}

function inferPlayerInterviewMode(teamStanding) {
  const wins = Number.parseInt(String(teamStanding?.wins ?? "").trim(), 10) || 0;
  const losses = Number.parseInt(String(teamStanding?.losses ?? "").trim(), 10) || 0;
  const gamesPlayed = wins + losses;

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

function buildPlayerInterviewPersonalQuestion(selected, playerProfile, teamProfile, teamStanding, playerHistory) {
  const country = cleanHtmlText(playerProfile?.nationality ?? selected?.nationality ?? "");
  const city = extractPlayerBirthCity(selected?.birthPlace ?? "");
  const popularity = cleanHtmlText(playerProfile?.popularity ?? "");
  const morale = cleanHtmlText(playerProfile?.morale ?? "");
  const age = Number.parseInt(playerProfile?.age ?? selected?.age ?? "", 10);
  const contractContext = playerProfile?.contractContext ?? {};
  const teamName = teamProfile?.fullName ?? selected?.team ?? "your club";
  const teamContext = formatTeamContext(teamName, teamStanding);
  const seasons = playerHistory?.seasons || Number.parseInt(playerProfile?.abaSeasons ?? "", 10) || 0;
  const candidates = [];

  if (country && !/^(american|usa|united states)$/i.test(country) && city) {
    candidates.push({
      priority: 1,
      key: "international-roots",
      question: `You're from ${country}, how was it to play baseball in ${city} as a youngster?`,
      answer: `It made me resourceful. Baseball did not feel like some polished machine when I was young in ${city}; it felt like something you had to chase because you loved it. I think that helps me now because the game still feels personal to me, even on the nights when ${teamName} is dealing with all the noise that comes with a real season.`,
    });
  }

  if (/(extremely popular|very popular|popular|well known)/i.test(popularity)) {
    const cityLabel = extractTeamCity(teamName);
    candidates.push({
      priority: 2,
      key: "popularity",
      question: `You're a very popular player in ${cityLabel}, how do you approach that?`,
      answer: `I try not to act like it changes the work. It is flattering when people in ${cityLabel} know your name and care about what you are doing, but the only way to handle that the right way is to keep it tied to the game. Show up, do the work, be available to people, and remember that the best way to respect that support is to help ${teamName} win.`,
    });
  }

  if (/(unhappy|very unhappy|angry|bad)/i.test(morale)) {
    candidates.push({
      priority: 3,
      key: "morale",
      question: "What's bothering you lately?",
      answer: `Honestly, when a player feels off, it is usually because he knows he has more to give. That is where I am. I do not like feeling like I am leaving something on the table, whether it is in my own game or in how I am helping ${teamName}. The only answer I know is to get honest, keep working, and let the next stretch of games clean some of that up.`,
    });
  }

  if (Number.isFinite(age) && age <= 23) {
    candidates.push({
      priority: 4,
      key: "young-career",
      question: "You're still very young. How do you think about the career that could be in front of you?",
      answer: `I try not to get too far ahead of myself. The game humbles you if you start reading your own future too confidently. What I want is to keep building something solid one year at a time, learn what winning baseball feels like, and make sure I am giving ${teamName} the kind of player they can trust for a long time.`,
    });
  } else if (Number.isFinite(age) && age >= 34) {
    candidates.push({
      priority: 5,
      key: "older-career",
      question: "At this stage of your career, what do you think about when you look back and when you look ahead?",
      answer: `You do look back more when you get older, but I think you do it to stay grounded, not to get sentimental. I know what the good years felt like, I know what the bad stretches felt like, and all of that helps me appreciate where I am now. Looking ahead, I just want the baseball to stay honest and useful for ${teamName}.`,
    });
  }

  if (contractContext?.isUpcomingFreeAgent) {
    candidates.push({
      priority: 6,
      key: "free-agent",
      question: "You're set to be a free agent after the season. How do you see that?",
      answer: `You would be lying if you said you never notice it, because players know where they are in the calendar. But I also know that if I let the contract talk get louder than the baseball, I am doing myself and ${teamName} a disservice. The best way to handle it is to play clean, be a good teammate, and let the rest come when it comes.`,
    });
  }

  if (contractContext?.latestExtension) {
    candidates.push({
      priority: 7,
      key: "extension",
      question: "You signed a big extension. Why was that the right move for you?",
      answer: `${contractContext.latestExtension.team ? `That deal with ${contractContext.latestExtension.team}` : "That extension"} made sense because I knew what kind of place I was choosing. You want stability, sure, but you also want to feel aligned with the clubhouse and with what the organization is trying to build. When that lines up, it becomes about more than dollars. It becomes about where you believe your best baseball belongs.`,
    });
  }

  const selectedCandidate = candidates.sort((left, right) => left.priority - right.priority)[0];
  if (selectedCandidate) {
    return {
      question: selectedCandidate.question,
      answer: selectedCandidate.answer,
    };
  }

  return {
    question: selected.profileType === "pitcher" ? "What does your role on this team feel like right now?" : "What is your role on this club when things are going right?",
    answer: buildInterviewRoleTalkingPoint(selected, teamProfile, teamStanding),
  };
}

function buildPlayerInterviewContractContext(timelineEntries = []) {
  const sortedEntries = [...timelineEntries].sort((left, right) => compareInterviewDates(right.date, left.date));
  const latestExtension = sortedEntries.find((entry) => /Signed a \d+-year contract extension worth a total of/i.test(entry.text));
  const latestDeal = sortedEntries.find((entry) => /Signed a \d+-year contract worth a total of/i.test(entry.text));
  const upcomingFreeAgentEntry = sortedEntries.find((entry) => /becomes a free-agent/i.test(entry.text));

  return {
    isUpcomingFreeAgent: Boolean(upcomingFreeAgentEntry),
    latestExtension: latestExtension
      ? {
          date: latestExtension.date,
          team: cleanHtmlText(latestExtension.text.match(/with the (.+?) organization/i)?.[1] ?? ""),
          text: latestExtension.text,
        }
      : null,
    latestDeal: latestDeal
      ? {
          date: latestDeal.date,
          team: cleanHtmlText(latestDeal.text.match(/with the (.+?) organization/i)?.[1] ?? ""),
          text: latestDeal.text,
        }
      : null,
  };
}

function compareInterviewDates(left, right) {
  const leftDate = parseInterviewDate(left);
  const rightDate = parseInterviewDate(right);
  return leftDate - rightDate;
}

function parseInterviewDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return 0;
  }
  return new Date(`${match[3]}-${match[1]}-${match[2]}T00:00:00Z`).getTime();
}

function extractPlayerBirthCity(value) {
  const parts = String(value ?? "").split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[1];
  }
  return parts[0] ?? "";
}

function extractTeamCity(teamName) {
  const cleaned = String(teamName ?? "").trim();
  const parts = cleaned.split(" ").filter(Boolean);
  return parts.slice(0, -1).join(" ") || cleaned;
}

function pickPlayerInterviewAdmiredPeer(topPlayers, selected) {
  const candidates = (topPlayers ?? [])
    .filter((player) => player?.playerId && player.playerId !== selected.playerId && player.team && player.team !== selected.team)
    .sort((left, right) => String(left.playerId).localeCompare(String(right.playerId)));

  if (!candidates.length) {
    return null;
  }

  return candidates[pickStableIndex(`player-interview-peer:${selected.playerId}`, candidates.length)] ?? candidates[0];
}

function buildInterviewAdmiredPeerTalkingPoint(admiredPeer) {
  if (!admiredPeer?.name || !admiredPeer?.team) {
    return `There are a lot of guys around this league I respect, but it usually comes back to the players who make the game look calm. The ones who never seem rushed tend to be the ones every clubhouse notices.`;
  }

  const peerHistory = findPlayerHistory(admiredPeer.name);
  const peerRecords = findRecordByPlayer(admiredPeer.name);
  const peerLeaderboardEntries = findLeaderboardEntriesByPlayer(admiredPeer.name);
  const playerLabel = `${admiredPeer.name} of the ${admiredPeer.team}`;
  const roleLabel = admiredPeer.profileType === "pitcher"
    ? `because good pitchers can change the whole mood of a series, and he does that without making it look noisy`
    : `because he looks like the kind of hitter who can tilt a whole night with one clean at-bat, and players notice that`;
  const peerProof = buildInterviewAdmiredPeerProof(peerHistory, peerRecords, peerLeaderboardEntries, admiredPeer);

  return `${playerLabel} comes to mind first. I respect him ${roleLabel}.${peerProof ? ` ${peerProof}` : ""} When you are on the field against somebody like that, you feel how little margin there is for getting lazy.`;
}

function buildInterviewAdmiredPeerProof(peerHistory, peerRecords, peerLeaderboardEntries, admiredPeer) {
  if (peerRecords?.[0]) {
    const record = peerRecords[0];
    return `When a guy already has his name attached to something like ${record.category.toLowerCase()}, you pay attention.`;
  }

  if (peerHistory?.mvps) {
    return `${peerHistory.mvps} MVP${peerHistory.mvps === 1 ? "" : "s"} will get your attention in any clubhouse.`;
  }

  if (peerHistory?.championships) {
    return `${peerHistory.championships} championship${peerHistory.championships === 1 ? "" : "s"} tells you he has done it in meaningful games too.`;
  }

  const leaderboardEntry = pickPlayerInterviewLeaderboardEntry(peerLeaderboardEntries);
  if (leaderboardEntry) {
    return `If you are ${ordinal(leaderboardEntry.rank)} in ${leaderboardEntry.scope === "career" ? `career ${leaderboardEntry.stat.toLowerCase()}` : `single-season ${leaderboardEntry.stat.toLowerCase()}`}, other players notice that.`;
  }

  if (peerHistory?.allStars) {
    return `${peerHistory.allStars} All-Star nod${peerHistory.allStars === 1 ? "" : "s"} tells you he has been doing it for a while.`;
  }

  return admiredPeer?.profileType === "pitcher"
    ? "He looks like somebody who can take over the pace of a game."
    : "He looks like somebody who can change a whole series with a few disciplined at-bats.";
}

function buildInterviewHistoryTalkingPoint(playerHistory, playerRecords, playerLeaderboardEntries = []) {
  if (playerRecords?.[0]) {
    const record = playerRecords[0];
    return `People mention that ${record.category.toLowerCase()} record once in a while, and I take it as a compliment, but also as a challenge. Once your name is tied to something like that, you want the standard to stay high every time you walk in the park.`;
  }

  const leaderboardEntry = pickPlayerInterviewLeaderboardEntry(playerLeaderboardEntries);
  if (leaderboardEntry) {
    return `I do not spend all day looking backward, but it means something when your name shows up on one of those history boards. If you are ${ordinal(leaderboardEntry.rank)} in ${leaderboardEntry.scope === "career" ? `career ${leaderboardEntry.stat.toLowerCase()}` : `single-season ${leaderboardEntry.stat.toLowerCase()}`}, you know you have put some real years into this league.`;
  }

  if (playerHistory?.notes) {
    return `I know the longer story is there, and I respect that, but ballplayers are wired to prove it again. What I did a few years ago is nice. What I do tonight is the part my teammates actually need.`;
  }

  return `I have been around long enough to know a season only means something when you keep answering the question every day. That is what I am trying to do now.`;
}

function buildInterviewAwardTalkingPoint(playerProfile) {
  const recentAward = pickPlayerInterviewRecentAward(playerProfile?.awardsSummaryLine ?? "");
  if (recentAward) {
    return `Any time you pick up something like ${recentAward}, it tells you the work is showing up. But those things feel better in a room that is winning, because nobody remembers the certificate if the club is drifting.`;
  }

  return `The biggest thing lately is that the game has felt quiet to me in a good way. When the game slows down, you stop forcing things and start trusting the work you put in before the first pitch.`;
}

function buildInterviewRoleTalkingPoint(selected, teamProfile, teamStanding) {
  const teamName = teamProfile?.fullName ?? selected.team;
  const isPitcher = selected.profileType === "pitcher";
  const isReliever = isPlayerInterviewReliever(selected);
  const gb = String(teamStanding?.gb ?? "").trim();

  if (isPitcher) {
    if (isReliever) {
      return gb && gb !== "-"
        ? `I know what my job is. I am supposed to keep the game from tilting when it gets handed to me, especially when ${teamName} is trying to protect something meaningful. Relief work gets heavier when the race is tight, and honestly that is part of the appeal.`
        : `I know what my job is. I am supposed to be ready fast, control the inning, and make the dugout feel like the game is still where we want it. That is what good bullpen work is supposed to do.`;
    }
    return gb && gb !== "-"
      ? `I know what my job is. I am supposed to keep the game under control long enough for ${teamName} to get comfortable and get rolling. When the race is tight, that job gets heavier, and honestly that is the fun part.`
      : `I know what my job is. I am supposed to set the tone, keep the bullpen in a good place, and make the dugout feel like the night is under control. That is what a good starter is supposed to do.`;
  }

  return gb && gb !== "-"
    ? `On a club like this, my job is to keep the lineup moving and make sure the big at-bats do not get wasted. When you are in a real race, you can feel the difference between empty numbers and production that actually changes the night.`
    : `I think my role is to keep the lineup dangerous all the way through. Some nights that means driving runs in. Some nights it means handing the next guy a better count. Either way, I want the pitcher to feel me in the game.`;
}

function pickPlayerInterviewLeaderboardEntry(entries = []) {
  return [...entries]
    .filter((entry) => Number.isFinite(entry.rank) && entry.rank <= 10)
    .sort((left, right) => left.rank - right.rank || left.player.localeCompare(right.player))[0] ?? null;
}

function isPlayerInterviewReliever(selected) {
  return /^(RP|CL|SU|MR|REL)$/i.test(String(selected?.pos ?? "").trim());
}

function pickPlayerInterviewRecentAward(awardsSummaryLine) {
  const parts = String(awardsSummaryLine ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  const recentAward =
    parts.find((part) => /of the week|of the month/i.test(part)) ??
    "";

  return recentAward.replace(/^\d+x\s+/i, "");
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

function buildPlayerInterviewHeaderLine(playerHistory, playerProfile) {
  const parts = [];
  const seasons = playerHistory?.seasons || Number.parseInt(playerProfile?.abaSeasons ?? "", 10) || 0;
  const rawAwardParts = String(playerProfile?.awardsSummaryLine ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const allStarAwardPart = rawAwardParts.find((part) => /all-?star/i.test(part)) ?? "";
  const inferredAllStars = inferAllStarCount(allStarAwardPart);
  const allStars =
    playerHistory?.allStars ||
    Number(playerProfile?.allStarSelections ?? 0) ||
    inferredAllStars ||
    0;
  const awardParts = rawAwardParts.filter((part) => !/all-?star/i.test(part));

  if (seasons) {
    parts.push(`${seasons} season${seasons === 1 ? "" : "s"}`);
  }
  if (allStars) {
    parts.push(`${allStars} time${allStars === 1 ? "" : "s"} All-Star`);
  }
  parts.push(...awardParts);

  return parts.join(" | ");
}

function buildPlayerInterviewDetailLine(playerProfile) {
  const parts = [];
  if (playerProfile?.salary) {
    parts.push(`Salary ${playerProfile.salary}`);
  }
  if (playerProfile?.acquisitionSummaryLine) {
    parts.push(playerProfile.acquisitionSummaryLine);
  }
  return parts.join(" | ");
}

function inferAllStarCount(allStarAwardPart) {
  if (!allStarAwardPart) {
    return 0;
  }

  const multiplierMatch = allStarAwardPart.match(/(\d+)\s*x/i);
  if (multiplierMatch) {
    return Number.parseInt(multiplierMatch[1], 10) || 0;
  }

  return /all-?star/i.test(allStarAwardPart) ? 1 : 0;
}

function buildPlayerAcquisitionSummaryLine(rawHtml) {
  const entries = extractPlayerTimelineEntries(rawHtml);
  const nonExpansionDraftEntries = entries.filter((entry) => {
    const text = String(entry?.text ?? "");
    if (!/Drafted in the \d{4} /i.test(text)) {
      return false;
    }
    if (/expansion draft|rule 5 draft|minor league phase|major league phase|draft from the /i.test(text)) {
      return false;
    }
    return true;
  });
  const initialDraftEntry = [...nonExpansionDraftEntries].sort((left, right) => compareInterviewDates(left.date, right.date))[0] ?? null;
  const draftedFieldMatch = String(rawHtml ?? "").match(/<tr>\s*<td[^>]*class="data_capt"[^>]*>\s*Drafted:\s*<\/td>\s*<td[^>]*class="wrap"[^>]*>\s*([^<]+?)\s*<\/td>\s*<\/tr>/i);
  const draftedField = cleanHtmlText(draftedFieldMatch?.[1] ?? "");
  if ((draftedField && draftedField !== "-") || initialDraftEntry) {
    const year = draftedField.match(/^(\d{4})/)?.[1] ?? initialDraftEntry?.text.match(/Drafted in the (\d{4})/i)?.[1] ?? "";
    const round = draftedField.match(/Round\s+(\d+)/i)?.[1] ?? initialDraftEntry?.text.match(/Round\s+(\d+)/i)?.[1] ?? "";
    const team = cleanHtmlText(initialDraftEntry?.text.match(/by the (.+?)\./i)?.[1] ?? "");
    const parts = [];
    if (year) {
      parts.push(`Drafted ${year}`);
    } else {
      parts.push("Drafted");
    }
    if (round) {
      parts.push(`Rd ${round}`);
    }
    if (team) {
      parts.push(`by ${team}`);
    }
    return parts.join(" ");
  }

  const signedEntry = entries.find((entry) => /Signed a .* contract .* with the .+ organization/i.test(entry.text));
  const rawSignedMatch = String(rawHtml ?? "").match(/<td width="80px" class="dl">(\d{2}\/\d{2}\/\d{4})<\/td>\s*<td width="888px" class="dl wrap">Signed a .*? contract(?: extension)? worth a total of .*? with the <a [^>]+>([^<]+)<\/a> organization\./i);
  if (signedEntry || rawSignedMatch) {
    const year = signedEntry?.date.match(/(\d{4})$/)?.[1] ?? rawSignedMatch?.[1]?.match(/(\d{4})$/)?.[1] ?? "";
    const team = cleanHtmlText(signedEntry?.text.match(/with the (.+?) organization/i)?.[1] ?? rawSignedMatch?.[2] ?? "");
    const parts = [];
    if (year) {
      parts.push(`First signed ${year}`);
    } else {
      parts.push("First signed");
    }
    if (team) {
      parts.push(`with ${team}`);
    }
    return parts.join(" ");
  }

  return "";
}

function buildPlayerSigningFallbackLine(rawHtml) {
  const signedMatch = String(rawHtml ?? "").match(/<td width="80px" class="dl">(\d{2}\/\d{2}\/\d{4})<\/td>\s*<td width="888px" class="dl wrap">Signed a .*? contract(?: extension)? worth a total of .*? with the <a [^>]+>([^<]+)<\/a> organization\./i);
  if (!signedMatch) {
    return "";
  }

  const year = signedMatch[1]?.match(/(\d{4})$/)?.[1] ?? "";
  const team = cleanHtmlText(signedMatch[2] ?? "");
  return [year ? `First signed ${year}` : "First signed", team ? `with ${team}` : ""].filter(Boolean).join(" ");
}

function extractPlayerTimelineEntries(rawHtml) {
  return [...String(rawHtml ?? "").matchAll(/<tr>\s*<td width="80px" class="dl">([^<]+)<\/td>\s*<td width="888px" class="dl wrap">([\s\S]*?)<\/td>\s*<\/tr>/gi)]
    .map((match) => ({
      date: cleanHtmlText(match[1]),
      text: cleanHtmlText(match[2]),
    }))
    .filter((entry) => entry.date || entry.text);
}

function buildTeamHighlight(teamProfile, teamStanding, teamHistory, lastChampion, injuries = []) {
  const summary = [];
  const fallbackHistory = extractTeamHistorySummaryFromTeamPageUrl(teamProfile?.teamPageUrl);
  const inceptionYear = teamHistory?.firstYear || teamProfile?.historyFirstYear || fallbackHistory.firstYear || "";
  const championships = toNumber(teamHistory?.championships) || fallbackHistory.championships || 0;
  const playoffAppearances = toNumber(teamHistory?.playoffAppearances) || fallbackHistory.playoffAppearances || 0;
  const mvps = extractTeamAbaMvpsFromAwardsPages(teamProfile?.teamPageUrl);
  const bestPitchers = extractTeamAbaBestPitchersFromAwardsPages(teamProfile?.teamPageUrl);
  const bestRookies = extractTeamAbaBestRookiesFromAwardsPages(teamProfile?.teamPageUrl);
  const bestRelievers = extractTeamAbaBestRelieversFromAwardsPages(teamProfile?.teamPageUrl);

  const legacy = summarizeTeamLegacy(teamProfile.fullName);
  if (legacy) {
    summary.push(`The franchise history gives the current push some extra texture: ${teamProfile.fullName} own ${legacy}${inceptionYear ? ` since joining the league in ${inceptionYear}` : ""}.`);
  } else if (lastChampion?.champion && normalizeTeamLookupValue(lastChampion.champion) === normalizeTeamLookupValue(teamProfile.fullName)) {
    summary.push(`${teamProfile.fullName} are also the defending champions, which turns every ordinary good week into a question about whether another October run is taking shape.`);
  }

  const facts = [
    { label: "Season", value: teamStanding?.wins && teamStanding?.losses ? `${teamStanding.wins}-${teamStanding.losses}` : "" },
    { label: "Race", value: teamStanding?.sectionLabel ?? "" },
    { label: "L10", value: teamStanding?.l10 ?? "" },
    { label: "Strk", value: teamStanding?.streak ?? "" },
    { label: "M#", value: teamStanding?.magicNumber ?? "" },
  ].filter((item) => item.value);

  const teamInjuries = teamProfile.currentInjuries?.length
    ? teamProfile.currentInjuries
    : injuries
        .filter((item) => normalizeTeamLookupValue(extractTeamNameFromItemSummary(item.summary)) === normalizeTeamLookupValue(teamProfile.fullName))
        .slice(0, 6)
        .map((item) => cleanTeamInjurySummary(item.summary));
  const historyNotes = [];
  if (inceptionYear) {
    historyNotes.push(`ABA inception: ${inceptionYear}`);
  }
  historyNotes.push(`${championships} championship${championships === 1 ? "" : "s"}`);
  historyNotes.push(`${playoffAppearances} playoff appearance${playoffAppearances === 1 ? "" : "s"}`);
  historyNotes.push(formatLatestTeamAward("Last MVP", mvps));
  historyNotes.push(formatLatestTeamAward("Last Best Pitcher", bestPitchers));
  historyNotes.push(formatLatestTeamAward("Last Best Rookie", bestRookies));
  historyNotes.push(formatLatestTeamAward("Last Best Reliever", bestRelievers));

  return {
    ...teamProfile,
    summary,
    facts,
    historyNotes,
    injuries: teamInjuries,
  };
}

function extractTeamHistoryFirstYear(teamPath) {
  const teamIdMatch = String(teamPath ?? "").match(/team_(\d+)\.html$/i);
  if (!teamIdMatch) {
    return "";
  }

  const historyIndexPath = path.resolve(path.dirname(teamPath), "..", "history", `team_${teamIdMatch[1]}_index.html`);
  if (!fs.existsSync(historyIndexPath)) {
    return "";
  }

  try {
    const rawHtml = fs.readFileSync(historyIndexPath, "utf8");
    const years = [...rawHtml.matchAll(/<td class="dc">\s*(?:<a [^>]+>)?(\d{4})(?:<\/a>)?\s*<\/td>/gi)]
      .map((match) => Number.parseInt(match[1], 10))
      .filter((year) => Number.isFinite(year) && year > 0);
    if (!years.length) {
      return "";
    }
    return String(Math.min(...years));
  } catch {
    return "";
  }
}

function extractTeamHistoryFirstYearFromTeamPageUrl(teamPageUrl) {
  return extractTeamHistorySummaryFromTeamPageUrl(teamPageUrl).firstYear;
}

function extractTeamHistorySummaryFromTeamPageUrl(teamPageUrl) {
  const teamIdMatch = String(teamPageUrl ?? "").match(/team_(\d+)\.html$/i);
  if (!teamIdMatch) {
    return { firstYear: "", championships: 0, playoffAppearances: 0 };
  }

  const historyIndexPath = path.resolve(process.cwd(), "News", "history", `team_${teamIdMatch[1]}_index.html`);
  if (!fs.existsSync(historyIndexPath)) {
    return { firstYear: "", championships: 0, playoffAppearances: 0 };
  }

  try {
    const rawHtml = fs.readFileSync(historyIndexPath, "utf8");
    const years = [...rawHtml.matchAll(/<td class="dc">\s*(?:<a [^>]+>)?(\d{4})(?:<\/a>)?\s*<\/td>/gi)]
      .map((match) => Number.parseInt(match[1], 10))
      .filter((year) => Number.isFinite(year) && year > 0);
    const rowMatches = [...rawHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
    let championships = 0;
    let playoffAppearances = 0;
    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1];
      const cells = [...rowHtml.matchAll(/<td class="d[cr]">([\s\S]*?)<\/td>/gi)].map((match) => cleanHtmlText(match[1]));
      if (cells.length < 14) {
        continue;
      }
      const playoffsCell = String(cells[12] ?? "").trim();
      const championCell = String(cells[13] ?? "").trim();
      if (playoffsCell) {
        playoffAppearances += 1;
      }
      if (/x/i.test(championCell)) {
        championships += 1;
      }
    }
    return {
      firstYear: years.length ? String(Math.min(...years)) : "",
      championships,
      playoffAppearances,
    };
  } catch {
    return { firstYear: "", championships: 0, playoffAppearances: 0 };
  }
}

function extractTeamAwardsFromAwardsPages(teamPageUrl, columnIndex = 1) {
  const teamIdMatch = String(teamPageUrl ?? "").match(/team_(\d+)\.html$/i);
  if (!teamIdMatch) {
    return [];
  }

  const teamId = teamIdMatch[1];
  const files = [
    path.resolve("News", "history", "sl_award_winners_200_0.html"),
    path.resolve("News", "history", "sl_award_winners_200_1.html"),
    path.resolve("News", "history", "sl_award_winners_201_0.html"),
    path.resolve("News", "history", "sl_award_winners_201_1.html"),
  ];
  const winners = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const rawHtml = fs.readFileSync(filePath, "utf8");
      const rowPattern = /<tr>\s*<td class="dl"><a [^>]*>(\d{4})[^<]*<\/a><\/td>([\s\S]*?)<\/tr>/gi;
      for (const match of rawHtml.matchAll(rowPattern)) {
        const year = cleanHtmlText(match[1]);
        const cells = [...String(match[2] ?? "").matchAll(/<td class="d(?:l|lg|g)">([\s\S]*?)<\/td>/gi)].map((cellMatch) => cellMatch[1]);
        const cell = cells[columnIndex - 1] ?? "";
        const teamMatch = cell.match(/<a href="\.\.\/teams\/team_(\d+)\.html">([^<]+)<\/a>/i);
        const playerMatch = cell.match(/<a href="\.\.\/players\/player_\d+\.html">([^<]+)<\/a>/i);
        if (!teamMatch || !playerMatch || teamMatch[1] !== teamId) {
          continue;
        }

        winners.push({
          year,
          player: cleanHtmlText(playerMatch[1]).replace(/\s*\(\d+\s*\)\s*$/i, "").trim(),
        });
      }
    } catch {
      continue;
    }
  }

  return winners.sort((left, right) => Number.parseInt(right.year, 10) - Number.parseInt(left.year, 10));
}

function extractTeamAbaMvpsFromAwardsPages(teamPageUrl) {
  const teamIdMatch = String(teamPageUrl ?? "").match(/team_(\d+)\.html$/i);
  if (!teamIdMatch) {
    return [];
  }

  const teamId = teamIdMatch[1];
  const files = [
    path.resolve("News", "history", "sl_award_winners_200_0.html"),
    path.resolve("News", "history", "sl_award_winners_200_1.html"),
  ];
  return extractTeamAwardWinnersByColumn(teamId, files, 1);
}

function extractTeamAbaBestPitchersFromAwardsPages(teamPageUrl) {
  const teamIdMatch = String(teamPageUrl ?? "").match(/team_(\d+)\.html$/i);
  if (!teamIdMatch) {
    return [];
  }

  const teamId = teamIdMatch[1];
  const files = [
    path.resolve("News", "history", "sl_award_winners_200_0.html"),
    path.resolve("News", "history", "sl_award_winners_200_1.html"),
  ];
  return extractTeamAwardWinnersByColumn(teamId, files, 2);
}

function extractTeamAbaBestRookiesFromAwardsPages(teamPageUrl) {
  const teamIdMatch = String(teamPageUrl ?? "").match(/team_(\d+)\.html$/i);
  if (!teamIdMatch) {
    return [];
  }

  const teamId = teamIdMatch[1];
  const files = [
    path.resolve("News", "history", "sl_award_winners_200_0.html"),
    path.resolve("News", "history", "sl_award_winners_200_1.html"),
  ];
  return extractTeamAwardWinnersByColumn(teamId, files, 3);
}

function extractTeamAbaBestRelieversFromAwardsPages(teamPageUrl) {
  const teamIdMatch = String(teamPageUrl ?? "").match(/team_(\d+)\.html$/i);
  if (!teamIdMatch) {
    return [];
  }

  const teamId = teamIdMatch[1];
  const files = [
    path.resolve("News", "history", "sl_award_winners_200_0.html"),
    path.resolve("News", "history", "sl_award_winners_200_1.html"),
  ];
  return extractTeamAwardWinnersByColumn(teamId, files, 4);
}

function formatLatestTeamAward(label, entries = []) {
  const latest = entries[0] ?? null;
  return `${label}: ${latest ? `${latest.player} (${latest.year})` : "None"}`;
}

function formatLatestTeamCoach(label, entry) {
  return `${label}: ${entry ? `${entry.name} (${entry.year})` : "None"}`;
}

let teamBestManagerAwardCache = null;
let teamManagerSeasonCache = null;

function extractTeamLastBestManagerAward(teamFullName, teamPageUrl) {
  if (!teamFullName) {
    return null;
  }

  if (!teamBestManagerAwardCache) {
    teamBestManagerAwardCache = buildTeamBestManagerAwardCache();
  }

  const teamId = cleanHtmlText(String(teamPageUrl ?? "").match(/team_(\d+)\.html$/i)?.[1] ?? "");
  const keys = buildHistoricalTeamCoachKeys(teamFullName, teamId);
  for (const key of keys) {
    const match = teamBestManagerAwardCache.get(key);
    if (match) {
      return match;
    }
  }

  if (!teamManagerSeasonCache) {
    teamManagerSeasonCache = buildTeamManagerSeasonCache();
  }

  for (const key of keys) {
    const match = teamManagerSeasonCache.get(key);
    if (match) {
      return match;
    }
  }

  return findTeamBestManagerSeasonFallback(teamFullName, teamId);
}

function findTeamBestManagerSeasonFallback(teamFullName, teamId = "") {
  const coachesDir = path.resolve("News", "coaches");
  if (!fs.existsSync(coachesDir)) {
    return null;
  }

  const currentSeasonYear = findCurrentAbaSeasonYear();
  const targetKeys = new Set(buildHistoricalTeamCoachKeys(teamFullName, teamId));
  let bestMatch = null;

  for (const fileName of fs.readdirSync(coachesDir).filter((name) => /^coach_\d+\.html$/i.test(name))) {
    const rawHtml = safeReadFile(path.join(coachesDir, fileName));
    if (!rawHtml) {
      continue;
    }

    const managerName = cleanHtmlText(rawHtml.match(/<div class="reptitle">Manager\s+([^<]+)<\/div>/i)?.[1] ?? "");
    if (!managerName) {
      continue;
    }

    for (const rowMatch of String(rawHtml).matchAll(/<tr>\s*<td class="dc">(\d{4})<\/td>\s*<td class="dl"><a [^>]*>ABA<\/a><\/td>\s*<td class="dl"><a href="\.\.\/teams\/team_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dl">Manager<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">([^<]+)<\/td>\s*<td class="dc">([^<]+)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<\/tr>/gi)) {
      const year = Number.parseInt(rowMatch[1], 10) || 0;
      const historyTeamId = cleanHtmlText(rowMatch[2]);
      const historyTeamName = cleanHtmlText(rowMatch[3]);
      if (currentSeasonYear && year >= currentSeasonYear) {
        continue;
      }

      const historyKeys = buildHistoricalTeamCoachKeys(historyTeamName, historyTeamId);
      if (!historyKeys.some((key) => targetKeys.has(key))) {
        continue;
      }

      const wins = Number.parseInt(rowMatch[5], 10) || 0;
      const losses = Number.parseInt(rowMatch[6], 10) || 0;
      const finish = cleanHtmlText(rowMatch[8]);
      const playoffText = cleanHtmlText(rowMatch[9]);
      const score = scoreHistoricalManagerSeason(finish, playoffText, wins, losses);
      if (score <= 0) {
        continue;
      }

      const candidate = { name: managerName, year: String(year), team: historyTeamName, score };
      if (!bestMatch || candidate.score > bestMatch.score || (candidate.score === bestMatch.score && year > (Number.parseInt(bestMatch.year, 10) || 0))) {
        bestMatch = candidate;
      }
    }
  }

  return bestMatch;
}

function buildTeamBestManagerAwardCache() {
  const cache = new Map();
  const leaguesDir = path.resolve("News", "leagues");
  if (!fs.existsSync(leaguesDir)) {
    return cache;
  }

  const currentSeasonYear = findCurrentAbaSeasonYear();
  const fileNames = fs.readdirSync(leaguesDir).filter((fileName) => /^league_200_news_\d+\.html$/i.test(fileName));
  const bestByKey = new Map();

  for (const fileName of fileNames) {
    const filePath = path.join(leaguesDir, fileName);
    const rawHtml = safeReadFile(filePath);
    if (!rawHtml) {
      continue;
    }

    const title = cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    if (!/manager of the year award/i.test(title)) {
      continue;
    }

    const year = cleanHtmlText(rawHtml.match(/(\d{4})/i)?.[1] ?? "");
    const manager = cleanHtmlText(rawHtml.match(/Award Given to\s+([^<]+)/i)?.[1] ?? rawHtml.match(/([^<]+)\s+Wins .*Manager of the Year Award/i)?.[1] ?? "");
    const team = cleanHtmlText(rawHtml.match(/<a href="\.\.\/teams\/team_\d+\.html">([^<]+)<\/a>/i)?.[1] ?? "");
    if (!year || !manager || !team) {
      continue;
    }

    if (currentSeasonYear && (Number.parseInt(year, 10) || 0) >= currentSeasonYear) {
      continue;
    }

    const entry = { name: manager, year, team };
    for (const key of buildHistoricalTeamCoachKeys(team, "")) {
      const current = bestByKey.get(key);
      if (!current || (Number.parseInt(entry.year, 10) || 0) > (Number.parseInt(current.year, 10) || 0)) {
        bestByKey.set(key, entry);
      }
    }
  }

  return bestByKey;
}

function buildTeamManagerSeasonCache() {
  const cache = new Map();
  const coachesDir = path.resolve("News", "coaches");
  if (!fs.existsSync(coachesDir)) {
    return cache;
  }

  const currentSeasonYear = findCurrentAbaSeasonYear();
  const fileNames = fs.readdirSync(coachesDir).filter((fileName) => /^coach_\d+\.html$/i.test(fileName));
  const bestByKey = new Map();

  for (const fileName of fileNames) {
    const rawHtml = safeReadFile(path.join(coachesDir, fileName));
    if (!rawHtml) {
      continue;
    }

    const managerName = cleanHtmlText(rawHtml.match(/<div class="reptitle">Manager\s+([^<]+)<\/div>/i)?.[1] ?? "");
    if (!managerName) {
      continue;
    }

    for (const rowMatch of String(rawHtml).matchAll(/<tr>\s*<td class="dc">(\d{4})<\/td>\s*<td class="dl"><a [^>]*>ABA<\/a><\/td>\s*<td class="dl"><a href="\.\.\/teams\/team_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dl">Manager<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">([^<]+)<\/td>\s*<td class="dc">([^<]+)<\/td>\s*<td class="dl">([^<]*)<\/td>\s*<\/tr>/gi)) {
      const year = Number.parseInt(rowMatch[1], 10) || 0;
      const teamId = cleanHtmlText(rowMatch[2]);
      const teamName = cleanHtmlText(rowMatch[3]);
      const wins = Number.parseInt(rowMatch[5], 10) || 0;
      const losses = Number.parseInt(rowMatch[6], 10) || 0;
      const finish = cleanHtmlText(rowMatch[8]);
      const playoffText = cleanHtmlText(rowMatch[9]);
      if (!year || !teamId || !teamName) {
        continue;
      }
      if (currentSeasonYear && year >= currentSeasonYear) {
        continue;
      }

      const score = scoreHistoricalManagerSeason(finish, playoffText, wins, losses);
      if (score <= 0) {
        continue;
      }

      const entry = { name: managerName, year: String(year), team: teamName, score };
      for (const key of buildHistoricalTeamCoachKeys(teamName, teamId)) {
        const current = bestByKey.get(key);
        if (!current || entry.score > current.score || (entry.score === current.score && year > (Number.parseInt(current.year, 10) || 0))) {
          bestByKey.set(key, entry);
        }
      }
    }
  }

  return bestByKey;
}

function scoreHistoricalManagerSeason(finish, playoffText, wins, losses) {
  const finishText = cleanHtmlText(finish).toLowerCase();
  const playoff = cleanHtmlText(playoffText).toLowerCase();
  const totalGames = Math.max(1, wins + losses);
  const winPctScore = Math.round((wins / totalGames) * 100);

  let score = 0;
  if (/won league championship/.test(playoff)) {
    score += 500;
  } else if (/made playoffs/.test(playoff)) {
    score += 200;
  }

  if (finishText === "1st") {
    score += 300;
  } else if (finishText === "2nd") {
    score += 80;
  }

  score += winPctScore;
  return score;
}

function findCurrentAbaSeasonYear() {
  const historyDir = path.resolve("News", "history");
  if (!fs.existsSync(historyDir)) {
    return 0;
  }

  const fileNames = fs.readdirSync(historyDir).filter((fileName) => /^team_\d+_index\.html$/i.test(fileName));
  let maxYear = 0;

  for (const fileName of fileNames) {
    const rawHtml = safeReadFile(path.join(historyDir, fileName));
    if (!rawHtml) {
      continue;
    }

    for (const match of rawHtml.matchAll(/team_year_\d+_(\d{4})\.html/gi)) {
      const year = Number.parseInt(match[1], 10) || 0;
      if (year > maxYear) {
        maxYear = year;
      }
    }
  }

  return maxYear;
}

function buildHistoricalTeamCoachKeys(teamName, teamId = "") {
  const text = String(teamName ?? "").trim();
  const keys = new Set();
  if (!text) {
    return [];
  }

  keys.add(normalizeTeamLookupValue(text));
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    keys.add(normalizeTeamLookupValue(words[0]));
    keys.add(normalizeTeamLookupValue(words.slice(0, -1).join(" ")));
  }
  if (teamId) {
    keys.add(`team:${teamId}`);
  }
  return [...keys];
}

function extractTeamAwardWinnersByColumn(teamId, files, columnIndex) {
  const winners = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const rawHtml = fs.readFileSync(filePath, "utf8");
      for (const rowMatch of String(rawHtml).matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
        const rowHtml = rowMatch[1] ?? "";
        const yearMatch = rowHtml.match(/<td class="dl"><a [^>]*>(\d{4})[^<]*<\/a><\/td>/i);
        if (!yearMatch) {
          continue;
        }

        const cells = [...rowHtml.matchAll(/<td class="d(?:l|lg|g)">([\s\S]*?)<\/td>/gi)].map((cellMatch) => cellMatch[1]);
        const cell = cells[columnIndex] ?? "";
        const teamMatch = cell.match(/<a href="\.\.\/teams\/team_(\d+)\.html">([^<]+)<\/a>/i);
        const playerMatch = cell.match(/<a href="\.\.\/players\/player_\d+\.html">([^<]+)<\/a>/i);
        if (!teamMatch || !playerMatch || teamMatch[1] !== teamId) {
          continue;
        }

        winners.push({
          year: cleanHtmlText(yearMatch[1]),
          player: cleanHtmlText(playerMatch[1]).replace(/\s*\(\d+\s*\)\s*$/i, "").trim(),
        });
      }
    } catch {
      continue;
    }
  }

  return winners.sort((left, right) => Number.parseInt(right.year, 10) - Number.parseInt(left.year, 10));
}

function extractTeamPageInjuries(rawHtml) {
  const match = String(rawHtml ?? "").match(
    /<tr><th class="boxtitle">INJURIES<\/th><\/tr>[\s\S]*?<table cellspacing="0" cellpadding="0" class="data sortable" width="100%">([\s\S]*?)<\/table>/i,
  );
  if (!match) {
    return [];
  }

  const injuries = [];
  for (const rowMatch of match[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td class="dl">([\s\S]*?)<\/td>/gi)].map((cell) => cleanHtmlText(cell[1]));
    if (cells.length < 4) {
      continue;
    }

    const [player, injury, outFor, status] = cells;
    if (!player || !injury) {
      continue;
    }

    injuries.push(`${player} — ${injury} | ${outFor}${status ? ` | ${status}` : ""}`);
  }

  return injuries.slice(0, 6);
}

function extractTeamNameFromItemSummary(summary) {
  const text = String(summary ?? "").trim();
  const colonIndex = text.indexOf(":");
  return colonIndex >= 0 ? text.slice(0, colonIndex).trim() : "";
}

function cleanTeamInjurySummary(summary) {
  const text = String(summary ?? "").trim();
  const colonIndex = text.indexOf(":");
  return colonIndex >= 0 ? text.slice(colonIndex + 1).trim() : text;
}

function formatTeamContext(teamName, teamStanding) {
  if (!teamStanding?.wins || !teamStanding?.losses) {
    return `${teamName} have been playing with some urgency, and you can feel that edge around the club right now.`;
  }

  const wins = toNumber(teamStanding.wins);
  const losses = toNumber(teamStanding.losses);
  const gb = String(teamStanding.gb ?? "").trim();
  const l10 = String(teamStanding.l10 ?? "").trim();
  const streak = String(teamStanding.streak ?? "").trim();
  const winPct = wins + losses > 0 ? wins / (wins + losses) : 0;
  const baseLine = buildInterviewTeamBaseline(teamName, winPct, gb);
  const trendParts = [];

  if (l10) {
    const lastTenNote = buildLastTenNote(l10);
    if (lastTenNote) {
      trendParts.push(lastTenNote);
    }
  }
  const streakNote = buildInterviewStreakNote(streak);
  if (streakNote) {
    trendParts.push(streakNote);
  }

  if (!trendParts.length) {
    return baseLine;
  }

  return `${baseLine} Lately, ${trendParts.join(" and ")}.`;
}

function buildInterviewTeamBaseline(teamName, winPct, gb) {
  if (winPct >= 0.56) {
    if (!gb || gb === "-" || /^\+/.test(gb)) {
      return `${teamName} are in a good place right now, and it feels like the club expects to play meaningful games every night.`;
    }
    return `${teamName} are having a strong season, and everybody in that room knows there is something worth pushing for right now.`;
  }

  if (winPct <= 0.44) {
    return `${teamName} have had a hard season, and there is no sense pretending otherwise. The work right now is about playing cleaner baseball and stopping a rough stretch from defining the whole summer.`;
  }

  if (!gb || gb === "-" || /^\+/.test(gb)) {
    return `${teamName} are in one of those stretches where every series feels important, and the room knows it.`;
  }

  return `${teamName} are in the middle of the kind of season where a good week can change the whole picture, so every game feels like it matters.`;
}

function buildLastTenNote(l10) {
  const match = String(l10 ?? "").trim().match(/^(\d+)-(\d+)$/);
  if (!match) {
    return "";
  }

  const wins = Number.parseInt(match[1], 10);
  const losses = Number.parseInt(match[2], 10);
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) {
    return "";
  }

  if (wins >= 7) {
    return `we have gone ${wins}-${losses} over the last ten`;
  }

  if (losses >= 7) {
    return `we have gone ${wins}-${losses} over the last ten, which is not where anybody in the room wants it`;
  }

  return "";
}

function buildInterviewStreakNote(streak) {
  const match = String(streak ?? "").trim().match(/^([WL])(\d+)$/i);
  if (!match) {
    return "";
  }

  const direction = match[1].toUpperCase();
  const length = Number.parseInt(match[2], 10);
  if (!Number.isFinite(length) || length < 3) {
    return "";
  }

  if (direction === "W") {
    return `we have won ${length} in a row`;
  }

  return `we have dropped ${length} in a row`;
}

function buildTransactionItems(page) {
  if (!page) {
    return [];
  }

  const rawHtmlTransactions = buildTransactionItemsFromRawHtml(page.rawHtml ?? "");
  if (rawHtmlTransactions.length) {
    return rawHtmlTransactions.slice(0, 60);
  }

  const transactions = [];

  for (const table of page.tables) {
    const date = table.headers?.[0] ?? "";
    if (!looksLikeTransactionDate(date)) {
      continue;
    }

    for (const row of table.rows) {
      const summary = String(row[0] ?? "").replace(/\s+/g, " ").trim();
      if (!summary) {
        continue;
      }

      transactions.push({
        date,
        summary,
      });
    }
  }

  return transactions.slice(0, 60);
}

function buildTransactionItemsFromRawHtml(rawHtml) {
  const normalized = String(rawHtml ?? "").replace(/\r/g, "");
  if (!normalized) {
    return [];
  }

  const transactions = [];
  const headingPattern = /<th class="boxtitle">\s*([\s\S]*?)\s*<\/th>/gi;
  const headings = [...normalized.matchAll(headingPattern)];

  for (let index = 0; index < headings.length; index += 1) {
    const date = cleanHtmlText(headings[index][1] ?? "");
    if (!looksLikeTransactionDate(date)) {
      continue;
    }

    const start = (headings[index].index ?? 0) + headings[index][0].length;
    const end = index + 1 < headings.length ? (headings[index + 1].index ?? normalized.length) : normalized.length;
    const chunk = normalized.slice(start, end);

    for (const match of chunk.matchAll(/<td class="dl">\s*([\s\S]*?)\s*<\/td>/gi)) {
      const summary = cleanHtmlText(match[1] ?? "").replace(/\s+/g, " ").trim();
      if (!summary) {
        continue;
      }

      transactions.push({
        date,
        summary,
      });
    }
  }

  return transactions;
}

function looksLikeTransactionDate(value) {
  return /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),/i.test(String(value ?? "").trim());
}

function buildLastDayScores(page) {
  if (!page?.rawHtml) {
    return [];
  }

  const boxScoreFiles = [...page.rawHtml.matchAll(/href="\.\.\/box_scores\/(game_box_\d+\.html)"/gi)].map((match) => match[1]);
  const gameLogFiles = [...page.rawHtml.matchAll(/href="\.\.\/game_logs\/(log_\d+\.html)"/gi)].map((match) => match[1]);
  const blocks = [
    ...page.rawHtml.matchAll(
      /<table cellspacing="0" cellpadding="0" width="478px" height="100%" class="databg">[\s\S]*?<table cellspacing="0" cellpadding="0" width="420px" class="data">([\s\S]*?)<\/table>[\s\S]*?<table cellspacing="0" cellpadding="0" width="420px" class="databg">([\s\S]*?)<\/table>[\s\S]*?<\/table>/gi,
    ),
  ];

  return blocks
    .map((match, index) => parseScoreBlock(page, match[1], match[2], boxScoreFiles[index] ?? null, gameLogFiles[index] ?? null))
    .filter(Boolean);
}

function selectLatestCompletedScoresPage(scorePages, preferredLeagueId) {
  const candidates = scorePages
    .filter((page) => !preferredLeagueId || extractLeagueId(page.fileName) === preferredLeagueId)
    .sort((left, right) => extractScoresDateKey(right.fileName).localeCompare(extractScoresDateKey(left.fileName)));

  return candidates.find((page) => buildLastDayScores(page).length > 0) ?? null;
}

function parseScoreBlock(page, linesHtml, summaryHtml, boxScoreFile, gameLogFile) {
  const rowMatches = [
    ...linesHtml.matchAll(
      /<tr>\s*<td class="dl">[\s\S]*?<a [^>]*>(.*?)<\/a>[\s\S]*?<td class="dc\s+grey\s+bold" width="18px">(.*?)<\/td>[\s\S]*?<\/tr>/gi,
    ),
  ];
  if (rowMatches.length < 2) {
    return null;
  }

  const away = {
    team: cleanScoreTeam(rowMatches[0][1]),
    runs: cleanHtmlText(rowMatches[0][2]),
  };
  const home = {
    team: cleanScoreTeam(rowMatches[1][1]),
    runs: cleanHtmlText(rowMatches[1][2]),
  };

  const details = parseScoreDetails(summaryHtml);
  const playerOfTheGame = readPlayerOfTheGame(page, boxScoreFile);
  const feature = readGameFeature(page, boxScoreFile, gameLogFile);

  return {
    awayTeam: away.team,
    awayRuns: away.runs,
    homeTeam: home.team,
    homeRuns: home.runs,
    summary: details.summary,
    winningPitcher: details.winningPitcher,
    winningPitcherRecord: details.winningPitcherRecord,
    losingPitcher: details.losingPitcher,
    losingPitcherRecord: details.losingPitcherRecord,
    savePitcher: details.savePitcher,
    savePitcherRecord: details.savePitcherRecord,
    homeRunSummary: details.homeRunSummary,
    playerOfTheGame,
    recapSubject: feature.recapSubject,
    recapText: feature.recapText,
    notablePlays: feature.notablePlays,
    standoutPerformers: feature.standoutPerformers,
    standoutPitchers: feature.standoutPitchers,
    homeRunCounts: feature.homeRunCounts,
  };
}

function parseScoreDetails(summaryHtml) {
  const summaryText = cleanHtmlText(summaryHtml).replace(/\s+/g, " ").trim();
  const summary = summaryText.split(/ W: | L: | S: | HR - /)[0].trim();
  const winningPitcher = extractPitcherSummary(summaryText, "W");
  const losingPitcher = extractPitcherSummary(summaryText, "L");
  const savePitcher = extractPitcherSummary(summaryText, "S");
  const homeRunSummary = extractHomeRunSummary(summaryText);

  return {
    summary,
    winningPitcher: winningPitcher.name,
    winningPitcherRecord: winningPitcher.record,
    losingPitcher: losingPitcher.name,
    losingPitcherRecord: losingPitcher.record,
    savePitcher: savePitcher.name,
    savePitcherRecord: savePitcher.record,
    homeRunSummary,
  };
}

function extractSummaryName(html, pattern) {
  const match = String(html ?? "").match(pattern);
  return match ? cleanHtmlText(match[1]) : "";
}

function extractPitcherSummary(summaryText, label) {
  const match = String(summaryText ?? "").match(new RegExp(`(?:^|\\s)${label}:\\s*([^()]+?)\\s*\\(([^)]*)\\)`, "i"));
  if (!match) {
    return { name: "", record: "" };
  }

  return {
    name: match[1].replace(/\s+/g, " ").trim(),
    record: match[2].replace(/\s+/g, " ").trim(),
  };
}

function extractHomeRunSummary(summaryText) {
  const match = String(summaryText ?? "").match(/HR\s*-\s*(.+)$/i);
  if (!match) {
    return "";
  }

  const cleaned = String(match[1]).replace(/\s+/g, " ").trim();
  if (!cleaned || /^none$/i.test(cleaned)) {
    return "";
  }

  return cleaned;
}

const playerOfTheGameCache = new Map();
const gameFeatureCache = new Map();

function readPlayerOfTheGame(page, boxScoreFile) {
  if (!boxScoreFile || !page?.filePath) {
    return "";
  }

  if (playerOfTheGameCache.has(boxScoreFile)) {
    return playerOfTheGameCache.get(boxScoreFile);
  }

  const boxScorePath = path.resolve(path.dirname(page.filePath), "..", "box_scores", boxScoreFile);

  try {
    const rawHtml = fs.readFileSync(boxScorePath, "utf8");
    const match = rawHtml.match(/<b>Player of the Game:\s*<\/b>\s*<a [^>]*>(.*?)<\/a>/i);
    const player = match ? cleanHtmlText(match[1]) : "";
    playerOfTheGameCache.set(boxScoreFile, player);
    return player;
  } catch {
    playerOfTheGameCache.set(boxScoreFile, "");
    return "";
  }
}

function readGameFeature(page, boxScoreFile, gameLogFile) {
  const cacheKey = `${boxScoreFile || ""}::${gameLogFile || ""}`;
  if (gameFeatureCache.has(cacheKey)) {
    return gameFeatureCache.get(cacheKey);
  }

  const emptyFeature = {
    recapSubject: "",
    recapText: "",
    notablePlays: [],
    standoutPerformers: [],
    standoutPitchers: [],
    homeRunCounts: {},
  };

  if (!page?.filePath || !boxScoreFile) {
    gameFeatureCache.set(cacheKey, emptyFeature);
    return emptyFeature;
  }

  try {
    const boxScorePath = path.resolve(path.dirname(page.filePath), "..", "box_scores", boxScoreFile);
    const boxScoreHtml = fs.readFileSync(boxScorePath, "utf8");
    const recapSubject = cleanHtmlText(boxScoreHtml.match(/<!--RECAP_SUBJECT_START-->([\s\S]*?)<!--RECAP_SUBJECT_END-->/i)?.[1] ?? "");
    const recapText = cleanHtmlText(boxScoreHtml.match(/<!--RECAP_TEXT_START-->([\s\S]*?)<!--RECAP_TEXT_END-->/i)?.[1] ?? "");
    const standoutPerformers = extractStandoutPerformers(boxScoreHtml, boxScorePath);
    const standoutPitchers = extractStandoutPitchers(boxScoreHtml, boxScorePath);
    const notablePlays = gameLogFile ? readGameLogHighlights(page.filePath, gameLogFile) : [];
    const homeRunCounts = gameLogFile ? readGameHomeRunCounts(page.filePath, gameLogFile) : {};

    const feature = {
      recapSubject,
      recapText,
      notablePlays,
      standoutPerformers,
      standoutPitchers,
      homeRunCounts,
    };
    gameFeatureCache.set(cacheKey, feature);
    return feature;
  } catch {
    gameFeatureCache.set(cacheKey, emptyFeature);
    return emptyFeature;
  }
}

function extractStandoutPerformers(boxScoreHtml, boxScorePath) {
  const rawHtml = String(boxScoreHtml);
  const battingSectionMatch = rawHtml.match(/<th width="480px" class="boxtitle">[^<]+ BATTING LINESCORE<\/th>[\s\S]*?(?=<th width="480px" class="boxtitle">[^<]+ PITCHING LINESCORE<\/th>)/i);
  if (!battingSectionMatch) {
    return [];
  }

  const battingSection = battingSectionMatch[0];
  const battingTitles = [...battingSection.matchAll(/<th width="480px" class="boxtitle">([^<]+) BATTING LINESCORE<\/th>/gi)]
    .map((match) => cleanScoreTeam(match[1]));
  const battingTables = [...battingSection.matchAll(/<table cellspacing="0" cellpadding="0" class="data sortable" width="480px">([\s\S]*?)<\/table>/gi)]
    .map((match) => match[1]);
  const performers = [];

  for (let index = 0; index < Math.min(battingTitles.length, battingTables.length); index += 1) {
    const team = battingTitles[index];
    const rowMatches = [...battingTables[index].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];

    for (const rowMatch of rowMatches) {
      const row = [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cellMatch) => cleanHtmlText(cellMatch[1]));
      if (row.length < 11 || row[0] === "Player") {
        continue;
      }

      const playerLinkMatch = rowMatch[1].match(/player_(\d+)\.html">([^<]+)<\/a>/i);
      const playerId = playerLinkMatch?.[1] ?? "";
      const player = resolveBoxScorePlayerName(boxScorePath, playerId, row[0].replace(/^[a-z]-/i, "").replace(/\s+(RF|LF|CF|SS|2B|3B|1B|C|DH|P)$/i, "").trim());
      const atBats = Number.parseInt(row[1], 10) || 0;
      const hits = Number.parseInt(row[3], 10) || 0;
      const rbi = Number.parseInt(row[4], 10) || 0;
      const walks = Number.parseInt(row[5], 10) || 0;
      const runs = Number.parseInt(row[2], 10) || 0;
      const reachedBase = hits + walks;
      const score =
        hits * 2
        + rbi * 3
        + runs * 2
        + walks
        + (atBats >= 4 && hits === atBats ? 3 : 0)
        + (reachedBase >= 5 ? 2 : 0);

      if (!player || score <= 3) {
        continue;
      }

      performers.push({
        player,
        playerId,
        imageUrl: resolveBoxScorePlayerImage(boxScorePath, playerId),
        team,
        role: "hitter",
        atBats,
        hits,
        rbi,
        walks,
        runs,
        score,
      });
    }
  }

  return performers
    .sort((left, right) => right.score - left.score);
}

function extractStandoutPitchers(boxScoreHtml, boxScorePath) {
  const rawHtml = String(boxScoreHtml);
  const pitchingSectionMatch = rawHtml.match(/<th width="480px" class="boxtitle">[^<]+ PITCHING LINESCORE<\/th>[\s\S]*?(?=<td class="boxtitle">\s*GAME NOTES\s*<\/td>)/i);
  if (!pitchingSectionMatch) {
    return [];
  }

  const pitchingSection = pitchingSectionMatch[0];
  const pitchingTitles = [...pitchingSection.matchAll(/<th width="480px" class="boxtitle">([^<]+) PITCHING LINESCORE<\/th>/gi)]
    .map((match) => cleanScoreTeam(match[1]));
  const pitchingTables = [...pitchingSection.matchAll(/<table cellspacing="0" cellpadding="0" class="data sortable" width="480px">([\s\S]*?)<\/table>/gi)]
    .map((match) => match[1]);
  const performers = [];

  for (let index = 0; index < Math.min(pitchingTitles.length, pitchingTables.length); index += 1) {
    const team = pitchingTitles[index];
    const rowMatches = [...pitchingTables[index].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];

    for (const rowMatch of rowMatches) {
      const row = [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cellMatch) => cleanHtmlText(cellMatch[1]));
      if (row.length < 10 || row[0] === "Player") {
        continue;
      }

      const playerLinkMatch = rowMatch[1].match(/player_(\d+)\.html">([^<]+)<\/a>/i);
      const playerId = playerLinkMatch?.[1] ?? "";
      const player = resolveBoxScorePlayerName(boxScorePath, playerId, row[0].replace(/\s+(W|L|SV)\s+\([^)]+\)$/i, "").trim());
      const decisionMatch = row[0].match(/\b(W|L|SV)\s+\(([^)]+)\)/i);
      const ip = parseBaseballInnings(row[1]);
      const hitsAllowed = Number.parseInt(row[2], 10) || 0;
      const runsAllowed = Number.parseInt(row[3], 10) || 0;
      const earnedRuns = Number.parseInt(row[4], 10) || 0;
        const walks = Number.parseInt(row[5], 10) || 0;
        const strikeouts = Number.parseInt(row[6], 10) || 0;
        const homeRunsAllowed = Number.parseInt(row[7], 10) || 0;
        const era = row[9] ?? "";
        const score =
          ip * 2.35 +
          strikeouts * 1.3 -
          earnedRuns * 4.2 -
          hitsAllowed * 0.9 -
          walks * 0.55 -
          homeRunsAllowed * 1.75 +
          (decisionMatch?.[1] === "W" ? 5 : 0) +
          (decisionMatch?.[1] === "SV" ? 2.5 : 0) +
          (decisionMatch?.[1] === "L" ? -3.5 : 0) +
          (earnedRuns === 0 && ip >= 6 ? 3.5 : 0) +
          (hitsAllowed <= 2 && ip >= 5 ? 2 : 0) +
          (ip >= 7 ? 2.5 : 0) +
          (ip < 5 && decisionMatch?.[1] !== "SV" ? -(5 - ip) * 2.25 : 0);

      if (!player || score <= 5) {
        continue;
      }

      performers.push({
        player,
        playerId,
        imageUrl: resolveBoxScorePlayerImage(boxScorePath, playerId),
        team,
        role: "pitcher",
        ip: row[1] ?? "",
        hitsAllowed,
        runsAllowed,
        earnedRuns,
        walks,
        strikeouts,
        era,
        decision: decisionMatch?.[1] ?? "",
        decisionRecord: decisionMatch?.[2] ?? "",
        score,
      });
    }
  }

  return performers
    .sort((left, right) => right.score - left.score);
}

function readGameLogHighlights(baseFilePath, gameLogFile) {
  try {
    const gameLogPath = path.resolve(path.dirname(baseFilePath), "..", "game_logs", gameLogFile);
    const rawHtml = fs.readFileSync(gameLogPath, "utf8");
    const highlights = [];
    const inningBlocks = [...rawHtml.matchAll(/<table cellspacing="0" cellpadding="0" class="data" width="968px">([\s\S]*?)<\/table>/gi)];

    for (const block of inningBlocks) {
      const inningLabel = cleanHtmlText(block[1].match(/<th colspan="2" class="boxtitle">([^<]+)<\/th>/i)?.[1] ?? "");
      const battingRows = [...block[1].matchAll(/<tr>\s*<td valign="top" width="268px" class="dl">\s*Batting:\s*[^<]*<a [^>]*>([^<]+)<\/a>[\s\S]*?<\/td>\s*<td class="dl" width="700px">([\s\S]*?)<\/td>\s*<\/tr>/gi)];

      for (const row of battingRows) {
        const player = cleanHtmlText(row[1]);
        const playHtml = row[2];
        const playText = cleanHtmlText(playHtml);

        if (/double play/i.test(playText)) {
          continue;
        }

        if (!/(HOME RUN|TRIPLE|DOUBLE|SINGLE|scores|SAFE, throw|Wild Pitch)/i.test(playText)) {
          continue;
        }

        highlights.push({
          inning: inningLabel,
          player,
          text: summarizeGameLogPlay(playHtml),
        });
      }
    }

    return dedupeGameLogHighlights(highlights)
      .sort((left, right) => scoreGameLogHighlight(right) - scoreGameLogHighlight(left))
      .slice(0, 4);
  } catch {
    return [];
  }
}

function readGameHomeRunCounts(baseFilePath, gameLogFile) {
  try {
    const gameLogPath = path.resolve(path.dirname(baseFilePath), "..", "game_logs", gameLogFile);
    const rawHtml = fs.readFileSync(gameLogPath, "utf8");
    const homeRunCounts = {};

    for (const row of rawHtml.matchAll(/<tr>\s*<td valign="top" width="268px" class="dl">\s*Batting:\s*[^<]*<a [^>]*>([^<]+)<\/a>[\s\S]*?<\/td>\s*<td class="dl" width="700px">([\s\S]*?)<\/td>\s*<\/tr>/gi)) {
      const player = cleanHtmlText(row[1]);
      const playHtml = String(row[2] ?? "");
      if (!/HOME RUN/i.test(playHtml)) {
        continue;
      }

      homeRunCounts[player] = (homeRunCounts[player] ?? 0) + 1;
    }

    return homeRunCounts;
  } catch {
    return {};
  }
}

function summarizeGameLogPlay(playText) {
  const rawHtml = String(playText ?? "");
  const clauses = rawHtml
    .split(/\s*<br>\s*/i)
    .map((line) => cleanHtmlText(line))
    .filter(Boolean);

  if (/3-RUN HOME RUN/i.test(rawHtml)) {
    return "launched a 3-run home run";
  }
  if (/2-RUN HOME RUN/i.test(rawHtml)) {
    return "launched a 2-run home run";
  }
  if (/SOLO HOME RUN/i.test(rawHtml)) {
    return "hit a solo home run";
  }
  if (/<b>SINGLE<\/b>/i.test(rawHtml) && /Runner from 3rd tries for Home,\s*SAFE/i.test(rawHtml)) {
    return "lined a run-scoring single";
  }
  if (/<b>DOUBLE<\/b>/i.test(rawHtml) && /Runner from 3rd tries for Home,\s*SAFE/i.test(rawHtml)) {
    return "lined a run-scoring double";
  }
  if (/<b>TRIPLE<\/b>/i.test(rawHtml) && /Runner from 3rd tries for Home,\s*SAFE/i.test(rawHtml)) {
    return "ripped a run-scoring triple";
  }
  if (/<b>TRIPLE<\/b>/i.test(rawHtml) && /scores/i.test(rawHtml)) {
    const scoredPlayers = [...rawHtml.matchAll(/<b><a [^>]*>([^<]+)<\/a> scores<\/b>/gi)].map((match) => cleanHtmlText(match[1]));
    return scoredPlayers.length ? `tripled home ${scoredPlayers.join(" and ")}` : "ripped a triple";
  }
  if (/<b>DOUBLE<\/b>/i.test(rawHtml) && /scores/i.test(rawHtml)) {
    const scoredPlayer = cleanHtmlText(rawHtml.match(/<b><a [^>]*>([^<]+)<\/a> scores<\/b>/i)?.[1] ?? "");
    return scoredPlayer ? `doubled home ${scoredPlayer}` : "lined a double";
  }
  if (/<b>SINGLE<\/b>/i.test(rawHtml) && /scores/i.test(rawHtml)) {
    const scoredPlayers = [...rawHtml.matchAll(/<b><a [^>]*>([^<]+)<\/a> scores<\/b>/gi)].map((match) => cleanHtmlText(match[1]));
    return scoredPlayers.length ? `singled home ${scoredPlayers.join(" and ")}` : "lined a single";
  }
  if (/Wild Pitch!/i.test(rawHtml) && /scores/i.test(rawHtml)) {
    const scoredPlayer = cleanHtmlText(rawHtml.match(/<b><a [^>]*>([^<]+)<\/a> scores<\/b>/i)?.[1] ?? "");
    return scoredPlayer ? `saw ${scoredPlayer} come home on a wild pitch` : "cashed in a wild pitch";
  }
  if (/Runner from 3rd tags up, SCORES/i.test(rawHtml)) {
    return "brought home a run on a sacrifice fly";
  }
  if (/<b>TRIPLE<\/b>/i.test(rawHtml)) {
    return "ripped a triple";
  }
  if (/<b>DOUBLE<\/b>/i.test(rawHtml)) {
    return "lined a double";
  }
  if (/<b>SINGLE<\/b>/i.test(rawHtml)) {
    return "lined a single";
  }

  return (clauses.find((clause) => /(HOME RUN|TRIPLE|DOUBLE|SINGLE|scores|SAFE, throw|Wild Pitch)/i.test(clause)) ?? clauses[clauses.length - 1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreGameLogHighlight(highlight) {
  const text = String(highlight?.text ?? "").toLowerCase();

  if (text.includes("home run")) {
    return 100;
  }
  if (text.includes("home")) {
    return 80;
  }
  if (text.includes("sacrifice fly")) {
    return 70;
  }
  if (text.includes("wild pitch")) {
    return 60;
  }
  if (text.includes("triple")) {
    return 50;
  }
  if (text.includes("double")) {
    return 40;
  }
  if (text.includes("single")) {
    return 30;
  }

  return 10;
}

function dedupeGameLogHighlights(highlights) {
  const seen = new Set();
  return highlights.filter((highlight) => {
    const key = `${highlight.inning}::${highlight.player}::${highlight.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const boxScorePlayerNameCache = new Map();
const boxScorePlayerImageCache = new Map();

function resolveBoxScorePlayerName(boxScorePath, playerId, fallbackName) {
  const cleanFallback = sanitizeBoxScorePlayerName(cleanHtmlText(fallbackName)
    .replace(/^(LF|CF|RF|SS|2B|3B|1B|C|DH|SP|RP|CL|P)\s+/i, "")
    .replace(/\s+(RF|LF|CF|SS|2B|3B|1B|C|DH|P)$/i, "")
    .replace(/\s+#\d+$/i, "")
    .trim());
  if (!playerId || !boxScorePath) {
    return cleanFallback;
  }

  if (boxScorePlayerNameCache.has(playerId)) {
    return boxScorePlayerNameCache.get(playerId);
  }

  try {
    const playerPath = path.resolve(path.dirname(boxScorePath), "..", "players", `player_${playerId}.html`);
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const fullName = sanitizeBoxScorePlayerName(cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? cleanFallback)
      .replace(/^(LF|CF|RF|SS|2B|3B|1B|C|DH|SP|RP|CL|P)\s+/i, "")
      .replace(/\s+#\d+$/i, "")
      .trim());
    boxScorePlayerNameCache.set(playerId, fullName || cleanFallback);
    return fullName || cleanFallback;
  } catch {
    boxScorePlayerNameCache.set(playerId, cleanFallback);
    return cleanFallback;
  }
}

function sanitizeBoxScorePlayerName(value) {
  return cleanHtmlText(value)
    .replace(/\s+['"][^'"]+['"](?=\s+[A-Za-zÀ-ÿ'.-]+$)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resolveBoxScorePlayerImage(boxScorePath, playerId) {
  if (!playerId || !boxScorePath) {
    return "";
  }

  if (boxScorePlayerImageCache.has(playerId)) {
    return boxScorePlayerImageCache.get(playerId);
  }

  try {
    const playerPath = path.resolve(path.dirname(boxScorePath), "..", "players", `player_${playerId}.html`);
    const rawHtml = fs.readFileSync(playerPath, "utf8");
    const imageMatch = rawHtml.match(/<img src="([^"]+person_pictures\/player_\d+\.(?:png|jpg|jpeg|webp))"[^>]*>/i);
    const imageUrl = toNewsLocalUrl(playerPath, imageMatch?.[1] ?? "");
    boxScorePlayerImageCache.set(playerId, imageUrl);
    return imageUrl;
  } catch {
    boxScorePlayerImageCache.set(playerId, "");
    return "";
  }
}

function parseBaseballInnings(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return 0;
  }

  const [wholePart, fractionalPart = "0"] = normalized.split(".");
  const whole = Number.parseInt(wholePart, 10) || 0;
  const outs = Number.parseInt(fractionalPart, 10) || 0;
  return whole + outs / 3;
}

function buildThreeStarsOfDay(games) {
  if (!games?.length) {
    return [];
  }

  const hitterPool = [];
  const pitcherPool = [];

  for (const game of games) {
    for (const performer of game.standoutPerformers ?? []) {
      const homeRuns = game.homeRunCounts?.[performer.player] ?? 0;
      hitterPool.push({
        ...performer,
        homeRuns,
        score: scoreThreeStarHitter({
          ...performer,
          homeRuns,
        }),
        gameSummary: `${game.awayTeam} ${game.awayRuns}, ${game.homeTeam} ${game.homeRuns}`,
        detailLine: buildHitterStarLine({
          ...performer,
          homeRuns,
        }),
      });
    }

    for (const pitcher of game.standoutPitchers ?? []) {
      pitcherPool.push({
        ...pitcher,
        gameSummary: `${game.awayTeam} ${game.awayRuns}, ${game.homeTeam} ${game.homeRuns}`,
        detailLine: buildPitcherStarLine(pitcher),
      });
    }
  }

  hitterPool.sort((left, right) => right.score - left.score);
  pitcherPool.sort((left, right) => right.score - left.score);

  const selected = [];
  const usedPlayers = new Set();
  const topHitter = hitterPool[0];
  const topPitcher = pitcherPool[0];

  if (topHitter && topPitcher) {
    const orderedTopTwo = [topHitter, topPitcher].sort((left, right) => right.score - left.score);
    for (const star of orderedTopTwo) {
      if (!usedPlayers.has(star.player)) {
        selected.push(star);
        usedPlayers.add(star.player);
      }
    }
  }

  const combinedPool = [...hitterPool, ...pitcherPool].sort((left, right) => right.score - left.score);
  for (const candidate of combinedPool) {
    if (selected.length >= 3) {
      break;
    }
    if (usedPlayers.has(candidate.player)) {
      continue;
    }
    selected.push(candidate);
    usedPlayers.add(candidate.player);
  }

  return selected.slice(0, 3).map((star, index) => ({
    rank: index + 1,
    player: star.player,
    team: star.team,
    role: star.role,
    imageUrl: star.imageUrl ?? "",
    detailLine: star.detailLine,
    gameSummary: star.gameSummary,
  }));
}

function scoreThreeStarHitter(performer) {
  const hits = Number(performer.hits ?? 0);
  const atBats = Number(performer.atBats ?? 0);
  const runs = Number(performer.runs ?? 0);
  const rbi = Number(performer.rbi ?? 0);
  const walks = Number(performer.walks ?? 0);
  const homeRuns = Number(performer.homeRuns ?? 0);
  const reachedBase = hits + walks;

  return (
    hits * 2.2 +
    rbi * 4.1 +
    runs * 1.8 +
    walks * 1.2 +
    homeRuns * 4.5 +
    (atBats >= 4 && hits === atBats ? 5.5 : 0) +
    (hits >= 4 ? 4 : 0) +
    (rbi >= 4 ? 5 : 0) +
    (reachedBase >= 5 ? 2.5 : 0)
  );
}

function buildHitterStarLine(performer) {
  const parts = [];
  const hits = Number(performer.hits ?? 0);
  const atBats = Number(performer.atBats ?? 0);
  const runs = Number(performer.runs ?? 0);
  const rbi = Number(performer.rbi ?? 0);
  const walks = Number(performer.walks ?? 0);

  if (atBats >= 1 && hits === atBats && hits >= 3) {
    parts.push(`${hits}-for-${atBats}`);
  } else {
    parts.push(`${hits} H`);
  }
  if (rbi > 0) {
    parts.push(`${rbi} RBI`);
  }
  if (runs > 0) {
    parts.push(`${runs} R`);
  }
  if (walks > 0) {
    parts.push(`${walks} BB`);
  }
  if (Number(performer.homeRuns ?? 0) > 0) {
    parts.push(`${performer.homeRuns} HR`);
  }
  return parts.join(" | ");
}

function buildPitcherStarLine(pitcher) {
  const parts = [];
  if (pitcher.decision) {
    parts.push(pitcher.decision === "SV" ? `SV (${pitcher.decisionRecord})` : `${pitcher.decision} (${pitcher.decisionRecord})`);
  }
  if (pitcher.ip) {
    parts.push(`${pitcher.ip} IP`);
  }
  parts.push(`${pitcher.strikeouts} K`);
  parts.push(`${pitcher.earnedRuns} ER`);
  return parts.join(" | ");
}

function cleanScoreTeam(value) {
  return cleanHtmlText(value).replace(/\s+/g, " ").trim();
}

function cleanHtmlText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toNumber(value) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toDecimalNumber(value) {
  const text = String(value ?? "").trim().replace(/[^0-9.-]/g, "");
  const numeric = Number.parseFloat(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseSalaryValue(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return 0;
  }

  const numeric = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (text.includes("m")) {
    return numeric * 1_000_000;
  }

  if (text.includes("k")) {
    return numeric * 1_000;
  }

  return numeric;
}

function buildFinancialFeature(page, leagueId = "200") {
  const fallbackPath = path.resolve("News", "leagues", `league_${leagueId}_financial_report.html`);
  const rawHtml = page?.rawHtml || safeReadFile(fallbackPath);
  if (!rawHtml) {
    return null;
  }

  const topPayrolls = extractFinancialTopPayrolls(rawHtml).slice(0, 24);
  const topSalaries = extractFinancialTopSalaries(rawHtml).slice(0, 24);

  if (!topPayrolls.length && !topSalaries.length) {
    return null;
  }

  return {
    topPayrolls,
    topSalaries,
  };
}

function buildManagerHighlightFeature(leagueViews = []) {
  const teamsDir = path.resolve("News", "teams");
  if (!fs.existsSync(teamsDir)) {
    return null;
  }

  const allowedLeagueIds = new Set((leagueViews ?? []).map((view) => String(view?.leagueId ?? "")).filter(Boolean));
  const personnelFiles = fs
    .readdirSync(teamsDir)
    .filter((fileName) => /^team_\d+_personnel\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  const teamCandidates = personnelFiles
    .map((fileName) => buildManagerHighlightTeamCandidate(path.join(teamsDir, fileName)))
    .filter((candidate) => candidate && (!allowedLeagueIds.size || allowedLeagueIds.has(candidate.leagueId)));

  if (!teamCandidates.length) {
    return null;
  }

  const selectedTeam = teamCandidates[pickStableIndex("manager-highlight-team", teamCandidates.length)] ?? teamCandidates[0];
  const staffEntries = selectedTeam.staffEntries ?? [];
  if (!staffEntries.length) {
    return null;
  }

  const selectedStaff = staffEntries[pickStableIndex(`manager-highlight-role:${selectedTeam.teamId}`, staffEntries.length)] ?? staffEntries[0];
  const profile = readManagerHighlightCoachProfile(selectedStaff.coachPath, selectedTeam, selectedStaff);
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    teamName: selectedTeam.teamName,
    teamLogoUrl: selectedTeam.logoUrl,
    teamLogoAlt: selectedTeam.logoAlt,
    leagueLabel: selectedTeam.leagueLabel,
  };
}

function buildManagerHighlightTeamCandidate(personnelPath) {
  const rawHtml = safeReadFile(personnelPath);
  if (!rawHtml) {
    return null;
  }

  const teamId = personnelPath.match(/team_(\d+)_personnel\.html$/i)?.[1] ?? "";
  const leagueId = cleanHtmlText(rawHtml.match(/href="\.\.\/leagues\/league_(\d+)_home\.html"/i)?.[1] ?? "");
  const leagueLabel = cleanHtmlText(rawHtml.match(/href="\.\.\/leagues\/league_\d+_home\.html"[^>]*>([^<]+)<\/a>/i)?.[1] ?? "");
  const teamName = cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
  const logoSrc = cleanHtmlText(rawHtml.match(/<a href="\.\.\/teams\/team_\d+\.html"><img src="([^"]+team_logos\/[^"]+)"/i)?.[1] ?? "");
  const staffEntries = [...rawHtml.matchAll(/<tr>\s*<td class="dl"><a href="\.\.\/coaches\/coach_(\d+)\.html">([^<]+)<\/a><\/td>\s*<td class="dl">(Manager|Bench Coach|Hitting Coach|Pitching Coach)<\/td>\s*<td class="dc">(\d+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">([^<]+)<\/td>\s*<td class="dr">([^<]+)<\/td>/gi)]
    .map((match) => ({
      coachId: cleanHtmlText(match[1]),
      name: cleanHtmlText(match[2]),
      role: cleanHtmlText(match[3]),
      age: cleanHtmlText(match[4]),
      experience: cleanHtmlText(match[5]),
      salary: cleanHtmlText(match[6]),
      yearsLeft: cleanHtmlText(match[7]),
      coachPath: path.resolve(path.dirname(personnelPath), "..", "coaches", `coach_${cleanHtmlText(match[1])}.html`),
    }));

  if (!teamId || !leagueId || !teamName || !staffEntries.length) {
    return null;
  }

  return {
    teamId,
    teamName,
    leagueId,
    leagueLabel,
    logoUrl: toNewsLocalUrl(personnelPath, logoSrc),
    logoAlt: teamName,
    staffEntries,
  };
}

function readManagerHighlightCoachProfile(coachPath, team, staffEntry) {
  const rawHtml = safeReadFile(coachPath);
  if (!rawHtml) {
    return null;
  }

  const imageSrc = cleanHtmlText(rawHtml.match(/<img src="([^"]+person_pictures\/coach_\d+\.(?:png|jpg|jpeg|webp))"/i)?.[1] ?? "");
  const titleLine = cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
  const nationality = cleanHtmlText(rawHtml.match(/<tr><td class="dl">Nationality<\/td><td class="dl">([^<]+)<\/td><\/tr>/i)?.[1] ?? "");
  const bornIn = cleanHtmlText(rawHtml.match(/<tr><td class="dl">Born in<\/td><td class="dl">([^<]+)<\/td><\/tr>/i)?.[1] ?? "");
  const birthDate = cleanHtmlText(rawHtml.match(/<tr><td class="dl">Date of Birth<\/td><td class="dl">([^<]+)<\/td><\/tr>/i)?.[1] ?? "");
  const reputation = cleanHtmlText(rawHtml.match(/<tr><td class="dl">Reputation<\/td><td class="dl">([^<]+)<\/td><\/tr>/i)?.[1] ?? "");
  const style = cleanHtmlText(rawHtml.match(/<tr><td class="dl">Manager Style<\/td><td class="srgp">([^<]+)<\/td><\/tr>/i)?.[1] ?? "");
  const personality = cleanHtmlText(rawHtml.match(/<tr><td class="dl" width="148px">Personality<\/td><td class="srp">([^<]+)<\/td><\/tr>/i)?.[1] ?? "");
  const historyRows = [...rawHtml.matchAll(/<tr>\s*<td class="dc">(\d{4})<\/td>\s*<td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td>\s*<td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td>\s*<td class="dl">([^<]+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">(\d+)<\/td>\s*<td class="dr">([^<]+)<\/td>\s*<td class="dc">([^<]+)<\/td>\s*<td class="dl">([^<]+)<\/td>/gi)]
    .map((match) => ({
      year: cleanHtmlText(match[1]),
      league: cleanHtmlText(match[2]),
      team: cleanHtmlText(match[3]),
      job: cleanHtmlText(match[4]),
      games: Number.parseInt(cleanHtmlText(match[5]), 10),
      wins: Number.parseInt(cleanHtmlText(match[6]), 10),
      losses: Number.parseInt(cleanHtmlText(match[7]), 10),
      pct: cleanHtmlText(match[8]),
      finish: cleanHtmlText(match[9]),
      postseason: cleanHtmlText(match[10]),
    }));

  const championships = historyRows.filter((row) => {
    const text = row.postseason;
    return text && /WON Round|WON .* Championship|League Championship/i.test(text);
  }).length;
  const playoffAppearances = historyRows.filter((row) => {
    const text = row.postseason;
    return text && text !== "-" && /Made Playoffs|WON Round|Lost Round|.* Championship/i.test(text);
  }).length;
  const careerSeasons = historyRows.length;
  const totalWins = historyRows.reduce((sum, row) => sum + (Number.isFinite(row.wins) ? row.wins : 0), 0);
  const totalLosses = historyRows.reduce((sum, row) => sum + (Number.isFinite(row.losses) ? row.losses : 0), 0);
  const currentJobHistory = historyRows.filter((row) => normalizeTeamName(row.job) === normalizeTeamName(staffEntry.role));
  const latestYear = historyRows.reduce((max, row) => Math.max(max, Number.parseInt(row.year || "0", 10) || 0), 0);
  const firstYear = historyRows.reduce((min, row) => {
    const year = Number.parseInt(row.year || "0", 10) || 0;
    return !min || (year && year < min) ? year : min;
  }, 0);

  const summary = [];
  summary.push(`${staffEntry.role} for the ${team.teamName}${team.leagueLabel ? ` in the ${team.leagueLabel}` : ""}.`);
  if (careerSeasons) {
    summary.push(`Career track: ${careerSeasons} seasons from ${firstYear || "?"} to ${latestYear || "now"}, with a ${totalWins}-${totalLosses} club record across stops.`);
  }
  if (championships || playoffAppearances) {
    summary.push(`${championships ? `${championships} championship${championships === 1 ? "" : "s"}` : "No championships yet"}, ${playoffAppearances} playoff appearance${playoffAppearances === 1 ? "" : "s"}.`);
  }
  if (style || personality || reputation) {
    summary.push([style ? `${style} style` : "", personality ? `${personality.toLowerCase()} personality` : "", reputation ? `${reputation.toLowerCase()} reputation` : ""].filter(Boolean).join(" | "));
  }
  const playerCareerLine = buildFormerPlayerCareerLine(staffEntry.name, birthDate) || buildFormerPlayerCareerLineByPlayerPage(staffEntry.name, birthDate);

  return {
    name: staffEntry.name,
    role: staffEntry.role,
    age: staffEntry.age,
    experience: staffEntry.experience,
    salary: staffEntry.salary,
    yearsLeft: staffEntry.yearsLeft,
    nationality,
    bornIn,
    birthDate,
    reputation,
    style,
    personality,
    playerCareerLine,
    imageUrl: toNewsLocalUrl(coachPath, imageSrc),
    imageAlt: staffEntry.name,
    titleLine,
    championships,
    playoffAppearances,
    careerSeasons,
    careerRecord: totalWins || totalLosses ? `${totalWins}-${totalLosses}` : "",
    careerHistory: [...historyRows]
      .sort((left, right) => (Number.parseInt(right.year || "0", 10) || 0) - (Number.parseInt(left.year || "0", 10) || 0))
      .map((row) => ({
        year: row.year,
        position: row.job,
        team: row.team,
        playoffs: row.postseason,
      })),
    summary,
  };
}

function buildFormerPlayerCareerLine(coachName, coachBirthDate) {
  const registerHistory = collectFormerPlayerRegisterHistory(coachName);
  if (!registerHistory.length) {
    return "";
  }

  const playerMatch = findRetiredPlayerByNameAndBirthDate(coachName, coachBirthDate);
  if (!playerMatch) {
    const hasHistoricalPlayerPage = findHistoricalPlayerPageByName(coachName);
    if (!hasHistoricalPlayerPage) {
      return "";
    }
  }

  const years = registerHistory
    .map((entry) => Number.parseInt(entry.year, 10))
    .filter((year) => Number.isFinite(year));
  if (!years.length) {
    return "";
  }

  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const teams = [...new Set(registerHistory.map((entry) => entry.team).filter(Boolean))];
  if (!teams.length) {
    const playerRole = inferFormerPlayerRole(coachName, coachBirthDate);
    return `Played in the ABA (${firstYear}-${lastYear})${playerRole ? ` as a ${playerRole}` : ""}.`;
  }

  return `Played in the ABA (${firstYear}-${lastYear}) for ${joinWithCommasAndAnd(teams)}.`;
}

function buildFormerPlayerCareerLineByPlayerPage(coachName, coachBirthDate) {
  const playerMatch =
    findRetiredPlayerByNameAndBirthDate(coachName, coachBirthDate) ??
    findHistoricalPlayerPageByName(coachName);
  if (!playerMatch?.filePath) {
    return "";
  }

  const playerId = cleanHtmlText(playerMatch.filePath.match(/player_(\d+)\.html$/i)?.[1] ?? "");
  if (!playerId) {
    return "";
  }

  const history = collectFormerPlayerRegisterHistoryByPlayerId(playerId);
  if (!history.length) {
    return "";
  }

  const years = history
    .map((entry) => Number.parseInt(entry.year, 10))
    .filter((year) => Number.isFinite(year));
  if (!years.length) {
    return "";
  }

  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const teams = [...new Set(history.map((entry) => entry.team).filter(Boolean))];
  if (!teams.length) {
    const playerRole = inferFormerPlayerRole(coachName, coachBirthDate);
    return `Played in the ABA (${firstYear}-${lastYear})${playerRole ? ` as a ${playerRole}` : ""}.`;
  }

  return `Played in the ABA (${firstYear}-${lastYear}) for ${joinWithCommasAndAnd(teams)}.`;
}

function findHistoricalPlayerPageByName(name) {
  const normalizedName = normalizeTeamName(name);
  if (!normalizedName) {
    return null;
  }

  const playersDir = path.resolve("News", "players");
  if (!fs.existsSync(playersDir)) {
    return null;
  }

  const fileNames = fs.readdirSync(playersDir).filter((fileName) => /^player_\d+\.html$/i.test(fileName));
  for (const fileName of fileNames) {
    const filePath = path.join(playersDir, fileName);
    const rawHtml = safeReadFile(filePath);
    if (!rawHtml) {
      continue;
    }

    const firstName = cleanHtmlText(rawHtml.match(/<tr><td class="dl">First Name<\/td><td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td><\/tr>/i)?.[1] ?? "");
    const lastName = cleanHtmlText(rawHtml.match(/<tr><td class="dl">Last Name<\/td><td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td><\/tr>/i)?.[1] ?? "");
    const structuredName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const titleName = cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    const headingName = cleanHtmlText(titleName.replace(/^Player Report for\s*/i, "").replace(/^#?\d+\s*/i, "").trim());
    const candidateName = structuredName || stripPlayerHeadingNoise(headingName || titleName);
    if (normalizeTeamName(candidateName) !== normalizedName) {
      continue;
    }

    return {
      name: candidateName,
      filePath,
    };
  }

  return null;
}

function inferFormerPlayerRole(name, birthDate) {
  const matchedPlayer =
    findRetiredPlayerByNameAndBirthDate(name, birthDate) ??
    findHistoricalPlayerPageByName(name);
  if (!matchedPlayer?.filePath) {
    return "";
  }

  const rawHtml = safeReadFile(matchedPlayer.filePath);
  if (!rawHtml) {
    return "";
  }

  const titleLine = cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
  const position = cleanHtmlText(titleLine.match(/^([A-Z]{1,3})\s+/i)?.[1] ?? "");
  if (/^(SP|RP|CL|P)$/i.test(position)) {
    return "pitcher";
  }
  return position ? `${position.toLowerCase()}` : "";
}

function findRetiredPlayerByNameAndBirthDate(name, birthDate) {
  const normalizedName = normalizeTeamName(name);
  const normalizedBirthDate = normalizeBirthDate(birthDate);
  if (!normalizedName || !normalizedBirthDate) {
    return null;
  }

  const playersDir = path.resolve("News", "players");
  if (!fs.existsSync(playersDir)) {
    return null;
  }

  const fileNames = fs.readdirSync(playersDir).filter((fileName) => /^player_\d+\.html$/i.test(fileName));
  for (const fileName of fileNames) {
    const filePath = path.join(playersDir, fileName);
    const rawHtml = safeReadFile(filePath);
    if (!rawHtml) {
      continue;
    }

    const firstName = cleanHtmlText(rawHtml.match(/<tr><td class="dl">First Name<\/td><td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td><\/tr>/i)?.[1] ?? "");
    const lastName = cleanHtmlText(rawHtml.match(/<tr><td class="dl">Last Name<\/td><td class="dl">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/td><\/tr>/i)?.[1] ?? "");
    const structuredName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const titleName = cleanHtmlText(rawHtml.match(/<div class="reptitle">([^<]+)<\/div>/i)?.[1] ?? "");
    const headingName = cleanHtmlText(titleName.replace(/^Player Report for\s*/i, "").replace(/^#?\d+\s*/i, "").trim());
    const pageBirthDate = cleanHtmlText(
      rawHtml.match(/<tr><td class="dl">Date of Birth<\/td><td class="dl">([^<]+)<\/td><\/tr>/i)?.[1] ??
      rawHtml.match(/Birthday:<\/td><td class="wrap"[^>]*>([^<]+)<\/td>/i)?.[1] ??
      "",
    );
    const teamCellHtml = String(
      rawHtml.match(/<tr><td class="dl">Team<\/td><td class="dl">([\s\S]*?)<\/td><\/tr>/i)?.[1] ??
      rawHtml.match(/<tr><td width="100px" class="data_capt">Organization:<\/td><td class="wrap"[^>]*>([\s\S]*?)<\/td><\/tr>/i)?.[1] ??
      "",
    );
    const teamText = cleanHtmlText(teamCellHtml);
    const candidateName = structuredName || stripPlayerHeadingNoise(headingName || titleName);
    if (normalizeTeamName(candidateName) !== normalizedName) {
      continue;
    }
    if (normalizeBirthDate(pageBirthDate) !== normalizedBirthDate) {
      continue;
    }

    return {
      name: candidateName,
      birthDate: pageBirthDate,
      filePath,
    };
  }

  return null;
}

function collectFormerPlayerRegisterHistory(playerName) {
  const historyDir = path.resolve("News", "history");
  if (!fs.existsSync(historyDir)) {
    return [];
  }

  const normalizedName = normalizeTeamName(playerName);
  const fileNames = fs
    .readdirSync(historyDir)
    .filter((fileName) => /^sl_(batters|pitchers)_200_[01]_\d{4}\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  const history = [];
  for (const fileName of fileNames) {
    const rawHtml = safeReadFile(path.join(historyDir, fileName));
    if (!rawHtml) {
      continue;
    }

    const year = cleanHtmlText(rawHtml.match(/<div class="reptitle">[^<]+ (\d{4})<\/div>/i)?.[1] ?? fileName.match(/_(\d{4})\.html$/i)?.[1] ?? "");
    for (const match of rawHtml.matchAll(/<tr[^>]*>\s*<td class="dl"><a href="\.\.\/players\/player_\d+\.html">([^<]+)<\/a><\/td>\s*<td class="dl"><a href="[^"]+">([^<]*)<\/a><\/td>/gi)) {
      const candidateName = cleanHtmlText(match[1]).replace(/\s*\(\d+\s*\)\s*$/i, "").trim();
      if (normalizeTeamName(candidateName) !== normalizedName) {
        continue;
      }
      const team = cleanHtmlText(match[2]);
      history.push({
        year,
        team,
      });
    }
  }

  return history
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.year === entry.year && candidate.team === entry.team) === index)
    .sort((left, right) => (Number.parseInt(left.year, 10) || 0) - (Number.parseInt(right.year, 10) || 0));
}

function collectFormerPlayerRegisterHistoryByPlayerId(playerId) {
  const historyDir = path.resolve("News", "history");
  if (!fs.existsSync(historyDir) || !playerId) {
    return [];
  }

  const fileNames = fs
    .readdirSync(historyDir)
    .filter((fileName) => /^sl_(batters|pitchers)_200_[01]_\d{4}\.html$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  const history = [];
  const playerPattern = new RegExp(`<tr[^>]*>\\s*<td class="dl"><a href="\\.\\.\\/players\\/player_${playerId}\\.html">[^<]+<\\/a><\\/td>\\s*<td class="dl"><a href="[^"]+">([^<]*)<\\/a><\\/td>`, "gi");

  for (const fileName of fileNames) {
    const rawHtml = safeReadFile(path.join(historyDir, fileName));
    if (!rawHtml) {
      continue;
    }

    const year = cleanHtmlText(rawHtml.match(/<div class="reptitle">[^<]+ (\d{4})<\/div>/i)?.[1] ?? fileName.match(/_(\d{4})\.html$/i)?.[1] ?? "");
    for (const match of rawHtml.matchAll(playerPattern)) {
      history.push({
        year,
        team: cleanHtmlText(match[1]),
      });
    }
  }

  return history
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.year === entry.year && candidate.team === entry.team) === index)
    .sort((left, right) => (Number.parseInt(left.year, 10) || 0) - (Number.parseInt(right.year, 10) || 0));
}

function normalizeBirthDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return "";
  }

  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function stripLeadingPositionToken(value) {
  return String(value ?? "").replace(/^[A-Z]{1,3}\s+/, "").trim();
}

function stripPlayerHeadingNoise(value) {
  return stripLeadingPositionToken(
    String(value ?? "")
      .replace(/\s+#\d+.*$/i, "")
      .trim(),
  );
}

function joinWithCommasAndAnd(items) {
  const values = [...new Set((items ?? []).filter(Boolean))];
  if (!values.length) {
    return "";
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function buildOldestPlayersFeature(leaguePlayers = []) {
  const oldestPlayers = [...(leaguePlayers ?? [])]
    .filter((player) => Number.isFinite(player.age) && player.age > 0 && player.team)
    .sort((left, right) => right.age - left.age || left.name.localeCompare(right.name))
    .slice(0, 10)
    .map((player, index) => ({
      rank: index + 1,
      name: player.name,
      age: player.age,
      team: player.team,
      position: player.pos,
      nationality: player.nationality,
    }));

  return oldestPlayers;
}

function extractFinancialTopPayrolls(rawHtml) {
  const payrollTableMatch = String(rawHtml ?? "").match(
    /<table class="data sortable"[\s\S]*?<th[^>]*>\s*Payroll\s*<\/th>[\s\S]*?<\/table>/i,
  );
  if (!payrollTableMatch) {
    return [];
  }

  return [...payrollTableMatch[0].matchAll(
    /<tr>\s*<td class="dc">(\d+)<\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dr">(\$[^<]+)<\/td>\s*<\/tr>/gi,
  )].map((match) => ({
    rank: cleanHtmlText(match[1]),
    team: cleanHtmlText(match[2]),
    payroll: cleanHtmlText(match[3]),
    payrollValue: parseSalaryValue(match[3]),
  }))
    .sort((left, right) => (left.rank ? Number.parseInt(left.rank, 10) : 999) - (right.rank ? Number.parseInt(right.rank, 10) : 999));
}

function extractFinancialTopSalaries(rawHtml) {
  const salaryTableMatch = String(rawHtml ?? "").match(
    /<table class="data sortable"[\s\S]*?<th[^>]*>\s*Player\s*<\/th>[\s\S]*?<th[^>]*>\s*Salary\s*<\/th>[\s\S]*?<\/table>/i,
  );
  if (!salaryTableMatch) {
    return [];
  }

  return [...salaryTableMatch[0].matchAll(
    /<tr>\s*<td class="dc">(\d+)<\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dl"><a [^>]*>([^<]+)<\/a><\/td>\s*<td class="dr">(\$[^<]+)<\/td>[\s\S]*?<\/tr>/gi,
  )].map((match) => ({
    rank: cleanHtmlText(match[1]),
    player: cleanHtmlText(match[2]),
    team: cleanHtmlText(match[3]),
    salary: cleanHtmlText(match[4]),
    salaryValue: parseSalaryValue(match[4]),
  }))
    .sort((left, right) => (left.rank ? Number.parseInt(left.rank, 10) : 999) - (right.rank ? Number.parseInt(right.rank, 10) : 999));
}

function toNewsLocalUrl(baseFilePath, relativeSrc) {
  if (!relativeSrc) {
    return "";
  }

  const cleanedSrc = String(relativeSrc).trim();
  if (!cleanedSrc || /^https?:/i.test(cleanedSrc)) {
    return cleanedSrc;
  }

  const absolutePath = path.resolve(path.dirname(baseFilePath), cleanedSrc);
  const newsRoot = findContainingFolder(absolutePath, "News");
  if (!newsRoot) {
    return cleanedSrc;
  }

  const relativePath = path.relative(newsRoot, absolutePath).split(path.sep).map(encodeURIComponent).join("/");
  return `/news/${relativePath}`;
}

function findContainingFolder(filePath, folderName) {
  let currentPath = path.resolve(filePath);

  while (true) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return "";
    }

    if (path.basename(parentPath).toLowerCase() === String(folderName).toLowerCase()) {
      return parentPath;
    }

    currentPath = parentPath;
  }
}

function extractScoresDateKey(fileName) {
  const match = String(fileName ?? "").match(/_scores_(\d{4})_(\d{2})_(\d{2})\.html$/i);
  return match ? `${match[1]}${match[2]}${match[3]}` : "";
}

function simplifyTeamName(teamName) {
  if (!teamName) {
    return "";
  }

  return teamName
    .replace(/\s+/g, " ")
    .replace(/\b(Red Wings|Capitales|Sidewinders|Privateers|Canadians|Grizzlies|River Cats|Isotopes|Emeralds|Knights|Bananas|Clippers|Wizards|Dragons|Mets|Bulls|Sea Dogs|Mud Hens|Ospreys|Eagles|Tides|Cannons|Indians|Tigers)\b/g, (match) => match)
    .trim();
}

function extractLeagueId(fileName) {
  if (!fileName) {
    return null;
  }

  const match = fileName.match(/league_(\d+)_/i);
  return match ? match[1] : null;
}

function buildPlayerLeaderboardGroups(page) {
  if (!page) {
    return { batting: [], pitching: [] };
  }

  const battingLabels = [
    "Batting AVG",
    "Home Runs",
    "Runs Batted In",
    "On-Base + Slugging",
    "WAR",
    "Hits",
    "Doubles",
    "Triples",
    "Bases On Balls",
    "Strikeouts",
    "On-Base PCT",
    "Stolen Bases",
  ];
  const pitchingLabels = [
    "ERA",
    "Wins",
    "Saves",
    "Strikeouts",
    "WHIP",
    "Games Pitched",
    "Innings Pitched",
    "Losses",
    "Complete Games",
    "Opponents OPS",
    "Home Runs Allowed",
    "Strikeouts per 9 IP",
  ];
  const battingCategoryTables = [];
  const pitchingCategoryTables = [];
  let currentLeaderboardStream = "";

  for (const table of page.tables) {
    const stream = detectLeaderboardStream(table);
    if (stream) {
      currentLeaderboardStream = stream;
    }

    const normalizedTable = normalizePlayerCategoryTable(table);
    if (!normalizedTable || !looksLikePlayerCategoryTable(normalizedTable)) {
      continue;
    }

    const categoryTable = {
      label: normalizedTable.categoryLabel,
      entries: normalizedTable.categoryRows.slice(0, 5).map((row) => ({
        player: row[0] ?? "",
        team: row[1] ?? "",
        value: row[2] ?? "",
      })),
    };

    if (currentLeaderboardStream === "batting") {
      battingCategoryTables.push(categoryTable);
    } else if (currentLeaderboardStream === "pitching") {
      pitchingCategoryTables.push(categoryTable);
    }
  }

  const mergedBattingTables = mergeLeaderboardCategories(battingCategoryTables);
  const mergedPitchingTables = mergeLeaderboardCategories(pitchingCategoryTables);

  return {
    batting: selectLeaderboardCategories(mergedBattingTables, battingLabels),
    pitching: selectLeaderboardCategories(mergedPitchingTables, pitchingLabels),
  };
}

function detectLeaderboardStream(table) {
  const headerText = table.headers?.length === 1 ? String(table.headers[0]).trim() : "";

  if (/LEAGUE BATTING LEADERBOARDS$/i.test(headerText)) {
    return "batting";
  }

  if (/LEAGUE PITCHING LEADERBOARDS$/i.test(headerText)) {
    return "pitching";
  }

  return "";
}

function mergeLeaderboardCategories(categoryTables) {
  const merged = new Map();

  for (const table of categoryTables) {
    const key = table.label.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        label: table.label,
        entries: [],
      });
    }

    merged.get(key).entries.push(...table.entries);
  }

  return [...merged.values()].map((table) => ({
    label: table.label,
    entries: sortLeaderboardEntries(table.label, dedupeLeaderboardEntries(table.entries)).slice(0, 5),
  }));
}

function dedupeLeaderboardEntries(entries) {
  const seen = new Set();
  const deduped = [];

  for (const entry of entries) {
    const key = `${entry.player}::${entry.team}::${entry.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function sortLeaderboardEntries(label, entries) {
  const direction = getLeaderboardSortDirection(label);

  return [...entries].sort((left, right) => {
    const leftValue = parseLeaderboardValue(left.value);
    const rightValue = parseLeaderboardValue(right.value);

    if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
      return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
    }

    return `${left.player} ${left.team}`.localeCompare(`${right.player} ${right.team}`);
  });
}

function getLeaderboardSortDirection(label) {
  return /^(era|whip|opponents ops|opponents obp|opponents slg|opponents avg|walks per 9 ip|hits per 9 ip)$/i.test(label)
    ? "asc"
    : "desc";
}

function parseLeaderboardValue(value) {
  const normalized = String(value ?? "").trim().replace(/,/g, "");
  if (!normalized) {
    return Number.NaN;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function looksLikePlayerCategoryTable(table) {
  return Boolean(
    table.categoryLabel &&
      table.categoryRows.length >= 3 &&
      table.categoryRows.every((row) => row.length === 3) &&
      table.categoryRows.some((row) => /[A-Za-z]/.test(row[0] ?? "")) &&
      table.categoryRows.some((row) => /[A-Za-z]/.test(row[1] ?? "")),
  );
}

function selectLeaderboardCategories(categoryTables, preferredLabels) {
  const selected = preferredLabels
    .map((label) => categoryTables.find((table) => table.label.toLowerCase() === label.toLowerCase()))
    .filter(Boolean);

  if (selected.length >= preferredLabels.length) {
    return selected;
  }

  for (const table of categoryTables) {
    if (selected.length >= preferredLabels.length) {
      break;
    }
    if (!selected.some((selectedTable) => selectedTable.label === table.label)) {
      selected.push(table);
    }
  }

  return selected.slice(0, preferredLabels.length);
}

function normalizePlayerCategoryTable(table) {
  const directLabel = getCategoryLabel(table);
  if (directLabel && table.rows.every((row) => row.length === 3)) {
    return {
      categoryLabel: directLabel,
      categoryRows: table.rows,
    };
  }

  if (
    table.headers?.length === 1 &&
    table.rows.length >= 4 &&
    table.rows[0]?.length === 1 &&
    table.rows.slice(1).every((row) => row.length === 3)
  ) {
    return {
      categoryLabel: String(table.rows[0][0]).trim(),
      categoryRows: table.rows.slice(1),
    };
  }

  return null;
}

function getCategoryLabel(table) {
  const label = table.label?.trim();
  if (label) {
    return label;
  }

  if (table.headers?.length === 1) {
    const headerLabel = String(table.headers[0]).trim();
    if (headerLabel && headerLabel.length < 60 && !/LEADERBOARDS$/i.test(headerLabel)) {
      return headerLabel;
    }
  }

  return null;
}

function buildHeadlineSummary(page, candidateTitle) {
  const pageType = detectPageType(page);
  const cleanedTitle = cleanHeadline(candidateTitle);
  const candidatePool = (page.storyCandidates ?? []).filter((candidate) => candidate !== candidateTitle);
  const supportingLine = candidatePool.find((candidate) => candidate.length > 24 && candidate.length < 140);

  if (pageType === "home") {
    if (/power rankings/i.test(cleanedTitle)) {
      return "Fresh power rankings set the daily mood, spotlighting the clubs shaping the league's pecking order.";
    }

    if (/all-star|prospects game/i.test(cleanedTitle)) {
      return "A feature package from the league home page pushes this story to the center of today's conversation.";
    }
  }

  if (pageType === "news") {
    if (/player of the week/i.test(cleanedTitle)) {
      return "Weekly honors headline the news wire and offer an easy snapshot of which stars are driving the league right now.";
    }

    if (/all-star/i.test(cleanedTitle)) {
      return "Selection news gives the edition a strong forward-looking angle, with roster debates likely to spill into tomorrow.";
    }

    if (supportingLine) {
      return supportingLine;
    }
  }

  if (supportingLine) {
    return supportingLine;
  }

  return truncateSummary(page.summary, cleanedTitle);
}

function truncateSummary(summary, title) {
  if (!summary) {
    return "Story details were limited in the current export, but the item stood out strongly enough to reach the front page.";
  }

  const cleaned = summary
    .replace(/\s+/g, " ")
    .replace(/^(Home|News|Standings Report|Batting Report|Pitching Report)\s+/i, "")
    .replace(/BNN Index \|.*?HISTORY\s+/i, "")
    .replace(/Tuesday, April 28th , 2026 - OOTP Baseball 26\.8 Build 82/i, "")
    .trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20 && !sentence.includes(title));

  const chosen = sentences.slice(0, 2).join(" ");
  return chosen.length > 220 ? `${chosen.slice(0, 217).trim()}...` : chosen || cleaned.slice(0, 220).trim();
}
