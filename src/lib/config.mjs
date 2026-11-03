import fs from "node:fs/promises";
import path from "node:path";

const defaultConfig = {
  newspaperName: "The ABA Daily Press",
  leagueName: "American Baseball League",
  city: "Grand Harbor",
  // Fed into every AI columnist/interview prompt (aiColumnFactory.mjs,
  // aiInterviewFactory.mjs) so the model doesn't default to real-world MLB
  // assumptions about this fictional league. Edit freely — this is the
  // place to correct any league fact the AI keeps getting wrong.
  leagueContext:
    "The American Baseball League runs on its own calendar and scale, not real MLB's. The regular season is 92 games long, not 162 — never describe a \"long season\", a \"six-month grind\", or make any length- or pace-based comparison that assumes the real MLB slate. The postseason begins in July, not September or October. Rely only on the standings, schedule, and dates in the data given below for anything about season timing or length; never assume real-world MLB scheduling, awards, records, or history.",
  // Length of the regular season in games — the same fact as in
  // leagueContext above, but as a number the code itself can use (e.g. to
  // tell early season from late season for the standings' Magic Number
  // column in renderFrontPage.mjs). Keep this in sync with leagueContext
  // if the league's schedule ever changes.
  regularSeasonGames: 92,
  columnists: [
    {
      name: "Mack Dalton",
      role: "Game recap columnist",
      voice:
        "bold and blunt, quick with a wisecrack, unimpressed by hype, calls a bad play ugly and a good one great without hedging, finds the funny angle before the reverent one",
      focus: "last night's games — the plays, the swings, and the moments that actually decided them",
      // Persona kept on file so the byline/voice can come back later without
      // re-writing it — buildColumns() in aiColumnFactory.mjs skips any
      // columnist with active: false.
      active: false,
    },
    {
      name: "Darren Kline",
      role: "Analytics columnist",
      voice:
        "dry, contrarian, distrusts the obvious storyline, always chasing the number that undercuts the headline, a little smug about being right, shows the receipts",
      focus: "the stat that contradicts the narrative — surprising numbers buried in the leaderboards and standings",
      // Same idea as Mack Dalton above — persona stays on file, just inactive.
      active: false,
    },
    {
      name: "Matt Gropius",
      role: "Team-trend columnist",
      voice:
        "narrative and atmospheric, thinks in seasons rather than single games, ties tonight's result to the shape of a division race or a franchise's history",
      focus: "the slow-building arcs in the standings and division races — what's forming before it shows up in the numbers, and where he thinks it's headed: a real prediction for how a race or a playoff series ends",
    },
  ],
};

export function parseCliArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--input") {
      args.input = argv[index + 1];
      index += 1;
    } else if (token === "--output") {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

export async function loadProjectConfig(rootDir) {
  const configPath = path.join(rootDir, "league-config.json");

  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultConfig,
      ...parsed,
      columnists: parsed.columnists?.length ? parsed.columnists : defaultConfig.columnists,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultConfig;
    }

    throw new Error(`Could not load league-config.json: ${error.message}`);
  }
}
