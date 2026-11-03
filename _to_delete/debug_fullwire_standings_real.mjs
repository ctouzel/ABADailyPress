import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";
import { buildSingleColumn } from "../src/services/columnFactory.mjs";
import { __test_renderFrontPageHtml as renderFrontPageHtml } from "../src/views/renderFrontPage_verify2.mjs";

const rootDir = path.resolve(process.cwd(), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

console.log("ABA currentMode:", snapshot.currentMode);
console.log("Frontier currentMode:", snapshot.frontierLeague?.currentMode);
console.log("ABA championshipChase.phase:", snapshot.championshipChase?.phase);
console.log("Frontier championshipChase.phase:", snapshot.frontierLeague?.championshipChase?.phase);
console.log("headlines count:", snapshot.headlines?.length);

const matt = config.columnists.find((c) => c.name === "Matt Gropius");
const col = buildSingleColumn(snapshot, matt, null, new Set());
const html = renderFrontPageHtml(snapshot, [col], config, null);
const body = html.slice(html.indexOf("</style>"));

console.log("\n--- real-data render checks ---");
console.log("lead-column teaser list present:", body.includes('class="news-snippet"'));
console.log("lead-column expanded full wire present:", /<div class="lead-column">\s*<section id="news-section"/.test(body));
console.log("separate collapsed <details id=\"news-section\"> present:", body.includes('<details id="news-section"'));
console.log("main pennant-races standings present:", body.includes('id="pennant-races"'));
console.log("minor-league-panel present:", body.includes('class="minor-league-panel"'));
console.log("minor-league-standings table present:", /minor-league-panel[\s\S]*?minor-league-standings/.test(body));
const leadColumnStart = body.indexOf('<div class="lead-column">');
console.log("\n--- lead column snippet ---");
console.log(body.slice(leadColumnStart, leadColumnStart + 700));
