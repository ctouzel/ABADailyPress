import path from "node:path";
import { loadProjectConfig } from "./src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "./src/lib/files.mjs";
import { parseOotpExport } from "./src/parsers/ootpParser.mjs";
import { buildSnapshot } from "./src/services/snapshotBuilder_verify_seriestracker.mjs";

const rootDir = process.cwd();
const inputDir = path.resolve(rootDir, "News");

const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selectedHtmlFiles);
const snapshot = buildSnapshot(parsedPages, config);

const fl = snapshot.frontierLeague?.championshipChase;
console.log("phase:", fl?.phase, "date:", fl?.dateLabel);
for (const conf of fl?.conferences ?? []) {
  console.log(`--- ${conf.label}`);
  for (const roundKey of Object.keys(conf.rounds ?? {})) {
    for (const series of conf.rounds[roundKey] ?? []) {
      const teams = (series.matchup ?? []).filter((e) => e && !e.placeholder);
      if (!teams.length) continue;
      console.log(
        `  [${roundKey}]`,
        teams.map((t) => `${t.team} (seed ${t.seed}): ${t.seriesWins} wins${t.advanced ? " ADV" : ""}${t.eliminated ? " ELIM" : ""}`).join(" vs "),
      );
    }
  }
}
