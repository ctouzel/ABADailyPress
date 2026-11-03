import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";
import { buildSingleColumn } from "../src/services/columnFactory_verify_offseason.mjs";

const rootDir = path.resolve(process.cwd(), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

const matt = config.columnists.find((c) => c.name === "Matt Gropius");

const seen = new Set();
for (let i = 0; i < 5; i += 1) {
  const usedTargets = new Set();
  const col = buildSingleColumn(snapshot, matt, null, usedTargets);
  console.log(`\n=== run ${i + 1} (topicKey: ${col.topicKey}) ===`);
  console.log(col.headline);
  console.log(col.body);
  seen.add(col.topicKey);
}
console.log("\ndistinct topicKeys across 5 independent runs (no previousColumn):", [...seen]);
