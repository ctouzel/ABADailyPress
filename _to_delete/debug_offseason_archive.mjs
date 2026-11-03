import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import {
  __test_buildTransactionItemsFromRawHtml as buildTransactionItemsFromRawHtml,
  __test_loadOffseasonTransactionArchive as loadOffseasonTransactionArchive,
  __test_computeOffseasonArchiveMonths as computeOffseasonArchiveMonths,
} from "../src/services/snapshotBuilder_verify.mjs";

// 1. Confirm the fixed raw-HTML parser now works against a real monthly
// archive file read directly off disk (never goes through parsedPages).
import fs from "node:fs";
const novHtml = fs.readFileSync(path.resolve("..", "News/leagues/league_200_all_transactions_11_2034.html"), "utf8");
const novItems = buildTransactionItemsFromRawHtml(novHtml);
console.log("Nov 2034 archive: parsed", novItems.length, "transactions directly from raw HTML");
const cora = novItems.find((t) => /Orlando Cora/i.test(t.summary));
console.log("Orlando Cora entry found:", Boolean(cora), cora?.summary);

// 2. Confirm computeOffseasonArchiveMonths for a Feb 2035 "today".
const months = computeOffseasonArchiveMonths(new Date("2035-02-04T00:00:00Z"));
console.log("\nmonths for 2035-02-04:", months);

// 3. Full loader against real data, today's actual date.
const rootDir = path.resolve(process.cwd(), "..");
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
