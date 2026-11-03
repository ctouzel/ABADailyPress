import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder_verify.mjs";

const rootDir = process.cwd().endsWith("_to_delete") ? path.resolve(process.cwd(), "..") : process.cwd();
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

console.log("currentMode:", snapshot.currentMode);
console.log("transactions.length (narrow, live page):", snapshot.transactions.length);
console.log("offseasonTransactions.length (full archive):", snapshot.offseasonTransactions.length);

const albuquerque = snapshot.offseasonTransactions.filter((t) => /Albuquerque/i.test(t.summary));
console.log("\nAll Albuquerque Isotopes transactions this offseason:");
for (const t of albuquerque) console.log(" -", t.date, "|", t.summary);

// biggest deals overall by raw total value (sanity: is Orlando Cora's $96.4M now visible?)
import { classifyTransaction } from "../src/lib/offseasonDigest.mjs";
const classified = snapshot.offseasonTransactions.map((t) => classifyTransaction(t.summary));
const bigDeals = classified
  .filter((c) => (c.type === "free-agent-signing" || c.type === "extension") && c.totalValue > 0)
  .sort((a, b) => b.totalValue - a.totalValue)
  .slice(0, 10);
console.log("\nTop 10 biggest deals by total value, full offseason:");
for (const d of bigDeals) console.log(" -", d.team, d.player, d.totalValue, d.type, d.years + "yr");
