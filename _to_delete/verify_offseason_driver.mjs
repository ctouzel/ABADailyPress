import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";
import { __test_renderFrontPageHtml as renderFrontPageHtml } from "../src/views/renderFrontPage_verify_offseason.mjs";

const rootDir = path.resolve(process.cwd(), "..");
const inputDir = path.join(rootDir, "News");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

console.log("real currentMode:", snapshot.currentMode);

const htmlReal = renderFrontPageHtml(snapshot, [], config, null);
console.log("REAL MODE render length:", htmlReal.length, "| has sidebar:", htmlReal.includes('<aside class="sidebar"'));

const forcedSnapshot = { ...snapshot, currentMode: "OFFSEASON" };
const htmlOffseason = renderFrontPageHtml(forcedSnapshot, [], config, null);
const body = htmlOffseason.slice(htmlOffseason.indexOf("</style>"));
console.log("FORCED OFFSEASON render length:", htmlOffseason.length);
console.log("  has sidebar:", body.includes('<aside class="sidebar"'));
console.log("  has main-grid-solo:", htmlOffseason.includes('<div class="main-grid main-grid-solo">'));
console.log("  has top-performances-section:", body.includes('<section id="top-performances-section"'));
