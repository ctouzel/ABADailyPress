import path from "node:path";
import { loadProjectConfig } from "./src/lib/config.mjs";
import { listHtmlFiles, selectRelevantHtmlFiles } from "./src/lib/files.mjs";
import { parseOotpExport } from "./src/parsers/ootpParser.mjs";
import { buildSnapshot } from "./src/services/snapshotBuilder_verify_bracket.mjs";

function assert(cond, msg) {
  console.log((cond ? "OK: " : "FAIL: ") + msg);
}

const rootDir = process.cwd();
const inputDir = path.resolve(rootDir, "News");

const config = await loadProjectConfig(rootDir);
const htmlFiles = await listHtmlFiles(inputDir);
const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
const parsedPages = await parseOotpExport(selectedHtmlFiles);
const snapshot = buildSnapshot(parsedPages, config);

const cc = snapshot.frontierLeague?.championshipChase;
console.log("phase:", cc?.phase);
assert(cc?.phase === "playoffs", "Frontier League championshipChase phase is 'playoffs'");

for (const conf of cc?.conferences ?? []) {
  console.log(`\n=== ${conf.label} ===`);
  for (const [roundName, entries] of Object.entries(conf.rounds ?? {})) {
    console.log(` ${roundName}: ${entries.length} matchup(s)`);
    for (const entry of entries) {
      const teams = (entry.matchup ?? []).map((slot) =>
        slot ? (slot.placeholder ? `[${slot.placeholder}]` : `${slot.team} (${slot.seriesWins ?? "0"})`) : "[bye]",
      );
      console.log("   ", teams.join(" vs "));
    }
  }

  const divisionEntries = conf.rounds?.division ?? [];
  assert(divisionEntries.length === 2, `${conf.label}: division round has both scheduled matchups (got ${divisionEntries.length})`);

  const seed1Entry = divisionEntries.find((e) => (e.matchup ?? []).some((slot) => slot?.seed === 1));
  assert(!!seed1Entry, `${conf.label}: the #1 seed's division matchup is present (previously dropped)`);
  if (seed1Entry) {
    const names = (seed1Entry.matchup ?? []).map((s) => s?.team).filter(Boolean);
    console.log(`    #1 seed matchup teams: ${names.join(" vs ")}`);
    assert(names.length === 2, `${conf.label}: #1 seed's matchup has both teams named, not a dropped/placeholder slot`);
  }
}

console.log("\nDone.");
