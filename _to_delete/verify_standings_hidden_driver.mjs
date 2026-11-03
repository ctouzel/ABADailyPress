import path from "node:path";
import { loadProjectConfig } from "./src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "./src/lib/files.mjs";
import { parseOotpExport } from "./src/parsers/ootpParser.mjs";
import { buildSnapshot } from "./src/services/snapshotBuilder.mjs";
import { renderFrontPageHtml } from "./src/views/renderFrontPage_verify_standings.mjs";

const rootDir = process.cwd();
const inputDir = path.resolve(rootDir, "News");

const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selectedHtmlFiles);
const snapshot = buildSnapshot(parsedPages, config);

console.log("ABA phase:", snapshot.championshipChase?.phase);
console.log("Frontier phase:", snapshot.frontierLeague?.championshipChase?.phase);

const html = renderFrontPageHtml(snapshot, [], config, null);

console.log("\nHas 'Pennant Races' (ABA full standings):", html.includes("Pennant Races"));
console.log("Has 'Championship Chase' (ABA bracket):", html.includes("Championship Chase"));
console.log("Has 'Minor League Report':", html.includes("Minor League Report"));
const minorPanel = html.split('id="minor-leagues"')[1] ?? "";
console.log("Minor league panel has a GB standings header:", /<th>GB<\/th>/.test(minorPanel));
console.log("Minor league panel has its bracket grid:", minorPanel.includes("minor-bracket-grid"));
