import fs from "node:fs/promises";
import path from "node:path";

const defaultConfig = {
  newspaperName: "The ABA Daily Press",
  leagueName: "American Baseball League",
  city: "Grand Harbor",
  columnists: [
    {
      name: "Mack Dalton",
      role: "Old-school columnist",
      voice: "gravelly, tradition-first, suspicious of hype",
      focus: "standings and momentum",
    },
    {
      name: "Darren Kline",
      role: "Analytics columnist",
      voice: "fast, incisive, deeply reported, always chasing the number that explains the league",
      focus: "surprising stats and the hidden math behind what the standings are saying",
    },
    {
      name: "Matt Gropius",
      role: "Former ABA star columnist",
      voice: "ex-player candor, championship perspective, fond of stories that turn into baseball lessons",
      focus: "the state of the game, clubhouse truths, and what contenders and stars look like to someone who has been there",
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
