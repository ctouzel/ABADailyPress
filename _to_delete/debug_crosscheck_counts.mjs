import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder_verify.mjs";
import { classifyTransaction } from "../src/lib/offseasonDigest.mjs";

const rootDir = process.cwd();
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

let signedFreeAgentCount = 0;
let extensionWorthCount = 0;
let missedSigned = [];
let missedExtension = [];

for (const t of snapshot.offseasonTransactions) {
  const c = classifyTransaction(t.summary);
  if (/Signed free agent/i.test(t.summary)) {
    signedFreeAgentCount += 1;
    if (c.type !== "free-agent-signing" && c.type !== "minor-league-signing") {
      missedSigned.push(t.summary);
    }
  }
  if (/contract extension worth a total of \$/i.test(t.summary)) {
    extensionWorthCount += 1;
    if (c.type !== "extension") {
      missedExtension.push(t.summary);
    }
  }
}

console.log("raw 'Signed free agent' substring count:", signedFreeAgentCount);
console.log("raw 'contract extension worth a total of $' substring count:", extensionWorthCount);
console.log("\nmissed signed (classified as something else):", missedSigned.length);
for (const s of missedSigned.slice(0, 20)) console.log(" -", s);
console.log("\nmissed extension (classified as something else):", missedExtension.length);
for (const s of missedExtension.slice(0, 20)) console.log(" -", s);
