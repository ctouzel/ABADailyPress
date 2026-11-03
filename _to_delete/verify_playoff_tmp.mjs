import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder_debug_tmp.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.resolve(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

console.log("\n=== RESULT ===");
console.log("leagueDateLabel:", snapshot.leagueDateLabel);
console.log("championshipChase:", snapshot.championshipChase ? "present" : "NULL");
if (snapshot.championshipChase) {
  console.log("phase:", snapshot.championshipChase.phase);
  console.log("conferences:", snapshot.championshipChase.conferences.map(c => c.label));
}
