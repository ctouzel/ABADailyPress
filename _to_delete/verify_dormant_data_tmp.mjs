import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.resolve(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

console.log("=== topGamePerformancesFeature ===");
console.log(JSON.stringify(snapshot.topGamePerformancesFeature, null, 2));

console.log("\n=== numberOnePicksFeature ===");
console.log(JSON.stringify(snapshot.numberOnePicksFeature, null, 2));
