import path from "node:path";
import { loadProjectConfig } from "../src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "../src/lib/files.mjs";
import { parseOotpExport } from "../src/parsers/ootpParser.mjs";
import { buildSnapshot } from "../src/services/snapshotBuilder_verify.mjs";
import { classifyTransaction } from "../src/lib/offseasonDigest.mjs";

const rootDir = process.cwd();
const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(path.join(rootDir, "News"));
const selected = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selected);
const snapshot = buildSnapshot(parsedPages, config);

const POSITION_CODES = /\b(SP|RP|CL|C|1B|2B|3B|SS|LF|CF|RF|DH)\b/;
const candidates = [];
for (const t of snapshot.offseasonTransactions) {
  const c = classifyTransaction(t.summary);
  if (c.type !== "other") continue;
  if (/\$[\d,]+/.test(t.summary) && POSITION_CODES.test(t.summary) && !/automatic renewal/i.test(t.summary) && !/vesting criteria/i.test(t.summary) && !/buyout/i.test(t.summary)) {
    candidates.push(t.summary);
  }
}
console.log("candidates with $ + position code, not automatic-renewal/vesting/buyout:", candidates.length);
for (const s of candidates.slice(0, 40)) console.log(" -", s);
