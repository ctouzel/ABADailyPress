import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";
import { buildSingleColumn } from "../src/services/columnFactory_verify_offseason.mjs";
import { __test_renderFrontPageHtml as renderFrontPageHtml } from "../src/views/renderFrontPage_verify_offseason.mjs";

const rootDir = path.resolve(process.cwd(), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

console.log("=== snapshot sanity ===");
console.log("currentMode:", snapshot.currentMode);
console.log("transactions:", snapshot.transactions?.length);

console.log("\n=== Matt Gropius column (algorithmic, real data) ===");
const matt = config.columnists.find((c) => c.name === "Matt Gropius");
const col = buildSingleColumn(snapshot, matt, null, new Set());
console.log(col.headline);
console.log("topicKey:", col.topicKey);

console.log("\n=== full front page render (real data, full columns array) ===");
const columns = [col];
const html = renderFrontPageHtml(snapshot, columns, config, null);
console.log("render length:", html.length);
const body = html.slice(html.indexOf("</style>"));
console.log("sidebar present:", body.includes('<aside class="sidebar"'));
console.log("main-grid-solo present:", html.includes('<div class="main-grid main-grid-solo">'));
console.log("top-performances-section present:", body.includes('<section id="top-performances-section"'));
console.log("opinion section includes Matt headline:", html.includes(col.headline));
console.log("minor league standings section still conditionally works:", body.includes("minor-league-panel"));
console.log("opinion section includes stripped headline text:", html.includes("Albuquerque Isotopes Just Changed Their Winter"));
console.log("opinion section includes body text:", html.includes("David Shelton"));
