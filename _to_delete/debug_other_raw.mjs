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

const extensionLike = [];
const perYearLike = [];
for (const t of snapshot.offseasonTransactions) {
  const c = classifyTransaction(t.summary);
  if (c.type !== "other") continue;
  if (/contract extension/i.test(t.summary)) extensionLike.push(t.summary);
  if (/per year contract/i.test(t.summary)) perYearLike.push(t.summary);
}
console.log("--- extension-like 'other' samples (first 15) ---");
for (const s of extensionLike.slice(0, 15)) console.log(s);
console.log("\ntotal extension-like other:", extensionLike.length);

console.log("\n--- per-year-contract-like 'other' samples (first 15) ---");
for (const s of perYearLike.slice(0, 15)) console.log(s);
console.log("\ntotal per-year-like other:", perYearLike.length);
