import path from "node:path";
import { loadProjectConfig } from "./src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "./src/lib/files.mjs";
import { parseOotpExport } from "./src/parsers/ootpParser.mjs";
import { buildSnapshot } from "./src/services/snapshotBuilder.mjs";
import { __buildSingleColumn as buildSingleColumn } from "./src/services/columnFactory_realcheck_sibling.mjs";

const rootDir = process.cwd();
const inputDir = path.resolve(rootDir, "News");

const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selectedHtmlFiles);
const snapshot = buildSnapshot(parsedPages, config);

console.log("ABA phase:", snapshot.championshipChase?.phase);
for (const section of snapshot.standingsSections ?? []) {
  if (section.kind !== "division") continue;
  console.log(`--- ${section.label}`);
  for (const row of section.rows) console.log(" ", row.Team, row.W, row.L, "GB=" + row.GB, "Strk=" + row.Strk, "L10=" + row.L10);
}

const columnist = { name: "Matt Gropius", role: "Team-trend columnist", voice: "narrative", focus: "division races" };
const column = buildSingleColumn(snapshot, columnist, null, new Set());
console.log("\n=== Matt Gropius column (algorithmic, real ABA data) ===");
console.log("HEADLINE:", column.headline);
console.log(column.body);
