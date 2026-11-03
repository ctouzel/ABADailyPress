import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";
import { classifyTransaction, buildOffseasonDigest, formatMoney, teamsWithNotableActivity } from "../src/lib/offseasonDigest.mjs";

const rootDir = path.resolve(process.cwd(), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

let otherCount = 0;
for (const t of snapshot.transactions) {
  const c = classifyTransaction(t.summary);
  if (c.type === "other") {
    otherCount += 1;
    console.log("UNCLASSIFIED:", t.summary);
  }
}
console.log("unclassified:", otherCount, "/", snapshot.transactions.length);

const digest = buildOffseasonDigest(snapshot.transactions);
console.log("\nbigMoves:");
for (const m of digest.bigMoves) console.log(" -", m.team, m.player, formatMoney(m.totalValue), m.years + "yr");

console.log("\nteamSpendRanking (top 5):");
for (const r of digest.teamSpendRanking.slice(0, 5)) console.log(" -", r.team, formatMoney(r.totalCommitted), "signings:", r.signingCount, "departures:", r.departureCount);

console.log("\nteams with notable activity:", teamsWithNotableActivity(digest).length);
