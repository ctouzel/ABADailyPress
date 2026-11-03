import {
  __buildSeriesMatchupKey as buildSeriesMatchupKey,
  __buildTeamLookupKeys as buildTeamLookupKeys,
  __loadScoreHistoryPagesForLeague as loadScoreHistoryPagesForLeague,
  __mergeScoreHistoryPages as mergeScoreHistoryPages,
  __parseCurrentScoreboardDate as parseCurrentScoreboardDate,
  __inferScheduledSeriesContext as inferScheduledSeriesContext,
  __buildLastDayScores as buildLastDayScores,
} from "./src/services/snapshotBuilder_verify_seriestracker.mjs";
import fs from "node:fs";

const scorePageHtml = fs.readFileSync("News/leagues/league_201_scores.html", "utf8");
const scorePage = { fileName: "league_201_scores.html", rawHtml: scorePageHtml, title: "", summary: "" };
const scheduleDate = parseCurrentScoreboardDate(scorePage);
console.log("scheduleDate:", scheduleDate);

const scoreHistoryPages = mergeScoreHistoryPages([], loadScoreHistoryPagesForLeague("201"));
console.log("total history pages:", scoreHistoryPages.length);

const pairs = [
  ["Longueuil Ducs", "Trois-Rivières Aigles"],
  ["Midland RockHounds", "Indianapolis Indians"],
  ["Altoona Curve", "Yakima Pippins"],
  ["Bakersfield Blaze", "San Antonio Missions"],
];

for (const [a, b] of pairs) {
  console.log(`\n--- ${a} vs ${b} ---`);
  console.log("lookup keys a:", buildTeamLookupKeys(a));
  console.log("lookup keys b:", buildTeamLookupKeys(b));
  console.log("matchupKey:", buildSeriesMatchupKey(a, b));
  const ctx = inferScheduledSeriesContext(a, b, scheduleDate, scoreHistoryPages);
  console.log("context:", JSON.stringify({ gameNumber: ctx?.gameNumber, leaderText: ctx?.leaderText, winsByTeam: ctx?.winsByTeam ? [...ctx.winsByTeam.entries()] : null }));
}
