import path from "node:path";
import fs from "node:fs";
import { loadProjectConfig } from "./src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "./src/lib/files.mjs";
import { parseOotpExport } from "./src/parsers/ootpParser.mjs";
import {
  buildSnapshot,
  __test_buildPositionalStrengthFeature,
  __test_extractPositionalStrengthBlocks,
} from "./src/services/snapshotBuilder_verify_posfix2.mjs";

function assert(cond, msg) {
  console.log((cond ? "OK: " : "FAIL: ") + msg);
}

const rootDir = process.cwd();
const inputDir = path.resolve(rootDir, "News");

// 1. Directly re-parse ALL 11 positions from the raw export and sanity
//    check every one has a complete, contiguous 1..N rank sequence with no
//    gaps (the exact symptom reported: rank 1 silently missing).
const rawHtml = fs.readFileSync(path.join(inputDir, "leagues", "league_200_positional_strength_overview_positions.html"), "utf8");
const blocks = __test_extractPositionalStrengthBlocks(rawHtml);

console.log(`Found ${blocks.length} position blocks:`, blocks.map((b) => b.position).join(", "));
assert(blocks.length === 11, "all 11 position tables are found");

for (const block of blocks) {
  const ranks = block.rows
    .map((r) => Number.parseInt(r.overallRank, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const hasRank1 = ranks[0] === 1;
  const teamCount = block.rows.length;
  const uniqueRanks = new Set(ranks).size;
  console.log(`  ${block.position}: ${teamCount} rows, ${ranks.length} valid ranks, min=${ranks[0]}, max=${ranks[ranks.length - 1]}`);
  assert(hasRank1, `${block.position}: rank #1 is present`);
  assert(ranks.length === teamCount, `${block.position}: every row parsed a valid overall rank (${ranks.length}/${teamCount})`);
}

// 2. Specifically re-check Shortstops (today's previously-broken position)
//    end to end, confirming Savannah/Roy Hobbs (rank 1) and Fresno/Gator
//    Brousseau (rank 10) are no longer dropped.
const shortstops = blocks.find((b) => b.position === "SHORTSTOPS");
const ss1 = shortstops.rows.find((r) => r.overallRank === "1st");
const ss10 = shortstops.rows.find((r) => r.overallRank === "10th");
console.log("\nShortstops rank 1 row:", JSON.stringify(ss1));
console.log("Shortstops rank 10 row:", JSON.stringify(ss10));
assert(ss1?.team === "Savannah Bananas" && ss1?.player === "Roy Hobbs", "Shortstops #1 = Savannah Bananas / Roy Hobbs (previously dropped)");
assert(ss10?.team === "Fresno Grizzlies" && ss10?.player === "Gator Brousseau", "Shortstops #10 = Fresno Grizzlies / Gator Brousseau (previously dropped)");

// 3. Full end-to-end through buildSnapshot, forcing nothing (natural daily
//    pick), just confirming the final feature always starts at rank 1.
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selectedHtmlFiles);
const snapshot = buildSnapshot(parsedPages, config);
const feature = snapshot.positionalStrengthFeature;
console.log("\nEnd-to-end feature (today's pick):", JSON.stringify(feature, null, 2));
assert(feature?.players?.[0]?.rank === 1, "end-to-end: today's list leads with rank #1");

console.log("\nDone.");
