import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

export async function listHtmlFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name);

      if (entry.isDirectory()) {
        return listHtmlFiles(fullPath);
      }

      return entry.name.toLowerCase().endsWith(".html") ? [fullPath] : [];
    }),
  );

  return files.flat().sort((left, right) => left.localeCompare(right));
}

export function selectRelevantHtmlFiles(filePaths) {
  const normalizedRootIndexes = filePaths
    .filter((filePath) => path.basename(filePath).toLowerCase() === "index.html")
    .sort((left, right) => left.length - right.length);
  const preferredRootIndex = normalizedRootIndexes[0];

  const normalized = filePaths.map((filePath) => ({
    filePath,
    relativePath: filePath.replace(/\\/g, "/"),
    baseName: path.basename(filePath).toLowerCase(),
  }));

  const leagueFocused = normalized
    .filter(({ relativePath, baseName }) => {
      if (preferredRootIndex && filePaths.includes(preferredRootIndex) && relativePath === preferredRootIndex.replace(/\\/g, "/")) {
        return true;
      }

      if (!relativePath.includes("/leagues/")) {
        return /\/history\/league_\d+_accomplishments_10\.html$/i.test(relativePath);
      }

      return (
        /_home\.html$/.test(baseName) ||
        /_standings\.html$/.test(baseName) ||
        /_stats\.html$/.test(baseName) ||
        /_batting_report\.html$/.test(baseName) ||
        /_pitching_report\.html$/.test(baseName) ||
        /_scores\.html$/.test(baseName) ||
        /_schedule_grid\.html$/.test(baseName) ||
        /_schedule_evaluation\.html$/.test(baseName) ||
        /_injuries(?:_report)?\.html$/.test(baseName) ||
        /_transactions_0_0\.html$/.test(baseName) ||
        /_news\.html$/.test(baseName) ||
        /_top_players_page\.html$/.test(baseName) ||
        /_top_prospects\.html$/.test(baseName) ||
        /_positional_strength_overview_positions\.html$/.test(baseName) ||
        /_upcoming_free_agents_report_[01]\.html$/.test(baseName) ||
        /_top_minor_league_systems\.html$/.test(baseName)
      );
    })
    .map(({ filePath }) => filePath);

  const recentScorePages = collectRelevantScorePages(normalized);
  const combined = new Set([...leagueFocused, ...recentScorePages]);

  return combined.size > 0 ? [...combined].sort((left, right) => left.localeCompare(right)) : filePaths;
}

function collectRelevantScorePages(normalizedFiles) {
  const datedScores = normalizedFiles.filter(({ relativePath, baseName }) => {
    return relativePath.includes("/leagues/") && /league_\d+_scores_\d{4}_\d{2}_\d{2}\.html$/.test(baseName);
  });

  const byLeague = new Map();

  for (const file of datedScores) {
    const leagueId = extractLeagueId(file.baseName);
    if (!leagueId) {
      continue;
    }
    if (!byLeague.has(leagueId)) {
      byLeague.set(leagueId, []);
    }
    byLeague.get(leagueId).push(file);
  }

  return [...byLeague.values()]
    .flatMap((files) =>
      files
        .sort((left, right) => right.baseName.localeCompare(left.baseName))
        .map(({ filePath }) => filePath),
    );
}

function extractLeagueId(fileName) {
  const match = String(fileName ?? "").match(/league_(\d+)_/i);
  return match ? match[1] : null;
}
