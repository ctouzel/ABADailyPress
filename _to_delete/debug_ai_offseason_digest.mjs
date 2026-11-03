import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder.mjs";
import { __test_buildDigest as buildDigest, __test_buildSystemPrompt as buildSystemPrompt, __test_buildVerificationSystemPrompt as buildVerificationSystemPrompt } from "../src/services/aiColumnFactory_verify_offseason.mjs";

const rootDir = path.resolve(process.cwd(), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

console.log("snapshot.currentMode:", snapshot.currentMode);

const matt = config.columnists.find((c) => c.name === "Matt Gropius");
const digest = buildDigest(matt, snapshot, config);
console.log("\n--- digest.data ---");
console.log(JSON.stringify(digest.data, null, 2));

const system = buildSystemPrompt(matt, config, snapshot);
console.log("\n--- system prompt ---");
console.log(system);

const verificationSystem = buildVerificationSystemPrompt(config, digest);
console.log("\n--- verification system prompt (offseason clause check) ---");
console.log(verificationSystem.includes("This column was written during the offseason") ? "OFFSEASON CLAUSE PRESENT" : "MISSING OFFSEASON CLAUSE");
