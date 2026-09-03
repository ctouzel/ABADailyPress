import fs from "node:fs/promises";
import path from "node:path";

import { loadProjectConfig, parseCliArgs } from "./lib/config.mjs";
import { ensureDirectory, listHtmlFiles, selectRelevantHtmlFiles } from "./lib/files.mjs";
import { parseOotpExport } from "./parsers/ootpParser.mjs";
import { enrichHeadlinesWithArticleContent } from "./services/articleResolver.mjs";
import { buildSnapshot } from "./services/snapshotBuilder.mjs";
import { enrichSnapshotWithHistory } from "./services/historyContext.mjs";
import { buildColumns } from "./services/columnFactory.mjs";
import { renderFrontPageHtml } from "./views/renderFrontPage.mjs";

async function main() {
  const runStartedAt = new Date().toISOString();
  const args = parseCliArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const inputDir = path.resolve(rootDir, args.input ?? "News");
  const outputDir = path.resolve(rootDir, args.output ?? "dist");
  const historySnapshotPath = path.join(rootDir, "src", "data", "historySheet.mjs");
  const columnistsDir = path.join(rootDir, "Columnists");

  await ensureDirectory(outputDir);

  try {
    const config = await loadProjectConfig(rootDir);
    const htmlFiles = await listHtmlFiles(inputDir);

    if (htmlFiles.length === 0) {
      throw new Error(
        `No HTML files were found in ${inputDir}. Export your OOTP league to a News folder and try again.`,
      );
    }

    const selectedHtmlFiles = selectRelevantHtmlFiles(htmlFiles);
    const parsedPages = await parseOotpExport(selectedHtmlFiles);
    const baseSnapshot = buildSnapshot(parsedPages, config);
    const headlineSnapshot = await enrichHeadlinesWithArticleContent(baseSnapshot, htmlFiles);
    const snapshot = enrichSnapshotWithHistory(headlineSnapshot);
    const previousColumnState = await readColumnState(outputDir);
    const columns = buildColumns(snapshot, config, previousColumnState);
    const html = renderFrontPageHtml(snapshot, columns, config);

    await fs.writeFile(
      path.join(outputDir, "snapshot.json"),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(outputDir, "column-state.json"),
      JSON.stringify(buildColumnState(columns, snapshot.generatedAt), null, 2),
      "utf8",
    );
    await fs.writeFile(path.join(outputDir, "edition.html"), html, "utf8");
    await copyColumnistImages(columnistsDir, outputDir);
    await writeRunStatus(outputDir, {
      runStartedAt,
      runCompletedAt: new Date().toISOString(),
      buildSucceeded: true,
      inputDir,
      outputDir,
      htmlFilesScanned: htmlFiles.length,
      htmlFilesSelected: selectedHtmlFiles.length,
      latestHeadlineDate: snapshot.headlines?.[0]?.date ?? "",
      historySnapshotPath,
    });

    console.log(`Scanned ${htmlFiles.length} HTML files and selected ${selectedHtmlFiles.length} for the edition.`);
    console.log(`Wrote edition to ${path.join(outputDir, "edition.html")}`);
    console.log(`Wrote debug snapshot to ${path.join(outputDir, "snapshot.json")}`);
  } catch (error) {
    await writeRunStatus(outputDir, {
      runStartedAt,
      runCompletedAt: new Date().toISOString(),
      buildSucceeded: false,
      inputDir,
      outputDir,
      historySnapshotPath,
      error: error.message,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function readColumnState(outputDir) {
  try {
    const raw = await fs.readFile(path.join(outputDir, "column-state.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.columns ?? {};
  } catch {
    return {};
  }
}

function buildColumnState(columns, generatedAt) {
  return {
    generatedAt,
    columns: Object.fromEntries(
      columns.map((column) => [
        column.author,
        {
          headline: column.headline,
          topicKey: column.topicKey ?? "",
          targetKey: column.targetKey ?? "",
        },
      ]),
    ),
  };
}

async function writeRunStatus(outputDir, details) {
  const historySnapshotLastModifiedAt = await readFileModifiedTime(details.historySnapshotPath);
  const historySheetSyncedOn = await readHistorySheetSyncedOn(details.historySnapshotPath);
  const historySnapshotRefreshedThisRun = wasHistorySnapshotRefreshedForRun(
    historySnapshotLastModifiedAt,
    details.runStartedAt,
  );
  const payload = {
    runStartedAt: details.runStartedAt,
    runCompletedAt: details.runCompletedAt,
    buildSucceeded: details.buildSucceeded,
    inputDir: details.inputDir,
    outputDir: details.outputDir,
    htmlFilesScanned: details.htmlFilesScanned ?? 0,
    htmlFilesSelected: details.htmlFilesSelected ?? 0,
    latestHeadlineDate: details.latestHeadlineDate ?? "",
    historySnapshotPath: details.historySnapshotPath,
    historySnapshotLastModifiedAt,
    historySheetSyncedOn,
    historySnapshotRefreshedThisRun,
    error: details.error ?? "",
  };

  await fs.writeFile(
    path.join(outputDir, "last-sync.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

async function readFileModifiedTime(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime.toISOString();
  } catch {
    return "";
  }
}

async function readHistorySheetSyncedOn(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const match = raw.match(/"?syncedOn"?\s*:\s*"([^"]+)"/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function wasHistorySnapshotRefreshedForRun(historySnapshotLastModifiedAt, runStartedAt) {
  if (!historySnapshotLastModifiedAt || !runStartedAt) {
    return false;
  }

  const modifiedAt = Date.parse(historySnapshotLastModifiedAt);
  const startedAt = Date.parse(runStartedAt);
  if (Number.isNaN(modifiedAt) || Number.isNaN(startedAt)) {
    return false;
  }

  return modifiedAt >= startedAt || startedAt - modifiedAt <= 10 * 60 * 1000;
}

async function copyColumnistImages(sourceDir, outputDir) {
  const targetDir = path.join(outputDir, "columnists");
  await ensureDirectory(targetDir);

  const fileNames = ["mack_dalton.png", "darren_kline.png", "matt_gropius.png"];

  await Promise.all(
    fileNames.map(async (fileName) => {
      const sourcePath = path.join(sourceDir, fileName);
      const targetPath = path.join(targetDir, fileName);

      try {
        await fs.copyFile(sourcePath, targetPath);
      } catch {
        // Skip missing portraits so the build can still complete.
      }
    }),
  );
}
