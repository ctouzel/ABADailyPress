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

console.log("total offseason transactions:", snapshot.offseasonTransactions.length);

const counts = new Map();
const otherSamples = [];
for (const t of snapshot.offseasonTransactions) {
  const c = classifyTransaction(t.summary);
  counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  if (c.type === "other" && otherSamples.length < 400) {
    otherSamples.push(t.summary);
  }
}
console.log("\ncounts by type:", Object.fromEntries(counts));

// Dedup the "other" samples by a normalized shape (strip names/numbers) to see distinct sentence patterns
const shapes = new Map();
for (const s of otherSamples) {
  const shape = s
    .replace(/<a[^>]*>([^<]*)<\/a>/g, "$1")
    .replace(/\$[\d,]+/g, "$AMT")
    .replace(/\b\d+(st|nd|rd|th)?\b/g, "#")
    .replace(/[A-Z][a-z]+ [A-Z][a-zA-Z'-]+/g, "NAME");
  shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
}
console.log("\ndistinct 'other' sentence shapes (count):");
for (const [shape, count] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(count, "x:", shape);
}
