import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";
import { buildSingleColumn } from "../src/services/columnFactory.mjs";
import { renderFrontPageHtml } from "../src/views/renderFrontPage.mjs";

const rootDir = path.resolve(process.cwd(), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

const matt = config.columnists.find((c) => c.name === "Matt Gropius");
let previousColumn = null;
const usedTargets = new Set();
const topics = [];
for (let i = 0; i < 5; i += 1) {
  const col = buildSingleColumn(snapshot, matt, previousColumn, usedTargets);
  topics.push(col.topicKey);
  previousColumn = col;
}
console.log("5-pick topic rotation (deployed columnFactory.mjs):", topics);

const html = renderFrontPageHtml(snapshot, [previousColumn], config, null);
const body = html.slice(html.indexOf("</style>"));
console.log("deployed renderFrontPage.mjs -> sidebar hidden:", !body.includes('<aside class="sidebar"'));
console.log("deployed renderFrontPage.mjs -> main-grid-solo applied:", html.includes('<div class="main-grid main-grid-solo">'));
console.log("deployed renderFrontPage.mjs -> top-performances hidden:", !body.includes('<section id="top-performances-section"'));
