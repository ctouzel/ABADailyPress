import path from "node:path";
import { loadProjectConfig } from "./src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "./src/lib/files.mjs";
import { parseOotpExport } from "./src/parsers/ootpParser.mjs";
import { buildSnapshot } from "./src/services/snapshotBuilder_verify_posstrength.mjs";

function assert(cond, msg) {
  console.log((cond ? "OK: " : "FAIL: ") + msg);
}

const rootDir = process.cwd();
const inputDir = path.resolve(rootDir, "News");

const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selectedHtmlFiles);
const snapshot = buildSnapshot(parsedPages, config);

const feature = snapshot.positionalStrengthFeature;
console.log("\npositionalStrengthFeature ->", JSON.stringify(feature, null, 2));

assert(feature !== null && feature !== undefined, "feature is built (not null)");
assert(typeof feature?.position === "string" && feature.position.length > 0, "position name is set");
assert(Array.isArray(feature?.players) && feature.players.length > 0, "players list is non-empty");

const ranks = (feature?.players ?? []).map((p) => p.rank);
const sorted = [...ranks].sort((a, b) => a - b);
assert(JSON.stringify(ranks) === JSON.stringify(sorted), "players are sorted ascending by rank (best first)");
assert(ranks[0] === 1, "the #1 overall-ranked player at this position leads the list");
assert(feature.players.length <= 10, "list is capped at 10");

for (const p of feature.players) {
  assert(typeof p.team === "string" && p.team.length > 0, `row has a team name (got "${p.team}")`);
  assert(typeof p.player === "string" && p.player.length > 0, `row has a player name (got "${p.player}")`);
}

console.log("\nDone.");
