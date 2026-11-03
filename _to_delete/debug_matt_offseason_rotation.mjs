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

// Force rotation through all offseason topics by feeding back each seen
// topicKey as "previousColumn" and accumulating usedTargets, mimicking how
// the real app avoids repeating yesterday's topic.
let previousColumn = null;
const usedTargets = new Set();
const seenTopics = [];
for (let i = 0; i < 6; i += 1) {
  const col = buildSingleColumn(snapshot, matt, previousColumn, usedTargets);
  seenTopics.push(col.topicKey);
  console.log(`\n--- pick ${i + 1}: ${col.topicKey} ---`);
  console.log(col.headline);
  console.log(col.body);
  previousColumn = col;
}
console.log("\nTopic sequence:", seenTopics);
