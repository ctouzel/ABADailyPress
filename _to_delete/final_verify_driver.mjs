import path from "node:path";
import fs from "node:fs";
import { loadProjectConfig } from "./src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "./src/lib/files.mjs";
import { parseOotpExport } from "./src/parsers/ootpParser.mjs";
import { buildSnapshot } from "./src/services/snapshotBuilder_final_verify.mjs";

const rootDir = process.cwd();
const inputDir = path.resolve(rootDir, "News");

const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selectedHtmlFiles);
const snapshot = buildSnapshot(parsedPages, config);

fs.writeFileSync("frontierLeague_final_verify.json", JSON.stringify(snapshot.frontierLeague, null, 2));
console.log("wrote frontierLeague_final_verify.json");
console.log("phase:", snapshot.frontierLeague?.championshipChase?.phase);
