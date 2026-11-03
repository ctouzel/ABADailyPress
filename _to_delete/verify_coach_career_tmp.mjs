import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder_verify_tmp.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.resolve(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

const m = snapshot.managerHighlightFeature;
if (!m) {
  console.log("managerHighlightFeature is null for today's pick - nothing to verify.");
  process.exit(0);
}

console.log("name:", m.name, "| role:", m.role, "| team:", m.teamName);
console.log("careerRecord (aggregate):", m.careerRecord, "| careerSeasons:", m.careerSeasons);
console.log("careerHistory rows:", m.careerHistory?.length ?? 0);
console.log(JSON.stringify(m.careerHistory, null, 2));

const rows = m.careerHistory ?? [];
const missingRecord = rows.filter((r) => !r.record);
console.log("\nRows missing a record value:", missingRecord.length, "/", rows.length);
if (missingRecord.length) {
  console.log("Example missing-record rows:", JSON.stringify(missingRecord.slice(0, 3), null, 2));
}

const sums = rows.reduce(
  (acc, r) => {
    const match = /^(\d+)-(\d+)$/.exec(r.record || "");
    if (match) { acc[0] += Number(match[1]); acc[1] += Number(match[2]); }
    return acc;
  },
  [0, 0],
);
console.log("\nSum of per-row records:", sums[0] + "-" + sums[1], "| aggregate careerRecord:", m.careerRecord);
