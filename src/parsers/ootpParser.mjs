import fs from "node:fs/promises";
import path from "node:path";

export async function parseOotpExport(filePaths) {
  const pages = [];

  for (const filePath of filePaths) {
    const rawHtml = await fs.readFile(filePath, "utf8");
    pages.push(parseHtmlPage(filePath, rawHtml));
  }

  return pages;
}

function parseHtmlPage(filePath, rawHtml) {
  const title = extractTitle(rawHtml) ?? path.basename(filePath, ".html");
  const heading = extractPrimaryHeading(rawHtml);
  const text = htmlToText(rawHtml);
  const tables = extractTables(rawHtml);
  const displayTitle = pickDisplayTitle(heading, title);
  const storyCandidates = extractStoryCandidates(rawHtml);

  return {
    filePath,
    fileName: path.basename(filePath),
    title: displayTitle,
    documentTitle: title,
    heading,
    rawHtml,
    text,
    summary: summarizeText(text),
    storyCandidates,
    tables,
  };
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(stripTags(match[1])).trim() : null;
}

function extractPrimaryHeading(html) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  return match ? decodeHtml(stripTags(match[1])).replace(/\s+/g, " ").trim() : null;
}

function extractTables(html) {
  const tableMatches = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];

  return tableMatches
    .map((match, index) => {
      const rows = [...match[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map((rowMatch) => extractCells(rowMatch[1]))
        .filter((row) => row.length > 0);

      if (rows.length === 0) {
        return null;
      }

      const [firstRow, ...remainingRows] = rows;
      const headerLike = firstRow.every((cell) => /[A-Za-z]/.test(cell));
      const headers = headerLike ? firstRow : firstRow.map((_, cellIndex) => `col_${cellIndex + 1}`);
      const bodyRows = headerLike ? remainingRows : rows;

      return {
        id: `${index + 1}`,
        label: extractTableLabel(html, match.index ?? 0),
        headers,
        rows: bodyRows,
      };
    })
    .filter(Boolean);
}

function extractCells(rowHtml) {
  const cellMatches = [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];

  return cellMatches
    .map((cellMatch) => normalizeText(decodeHtml(stripTags(cellMatch[1]))).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function summarizeText(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40);

  return dedupeSequentialSentences(sentences).slice(0, 3).join(" ");
}

function htmlToText(html) {
  return normalizeText(
    decodeHtml(
    stripTags(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " "),
    ),
    ),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(input) {
  return input.replace(/<[^>]+>/g, " ");
}

function decodeHtml(input) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(input) {
  return input
    .replace(/Â([¼½¾])/g, "$1")
    .replace(/½/g, ".5")
    .replace(/¼/g, ".25")
    .replace(/¾/g, ".75")
    .replace(/Ã©/g, "e")
    .replace(/Ã/g, "");
}

function extractTableLabel(html, tableIndex) {
  const precedingHtml = html.slice(Math.max(0, tableIndex - 1500), tableIndex);
  const matches = [...precedingHtml.matchAll(/<td[^>]*class="boxtitle"[^>]*>([\s\S]*?)<\/td>/gi)];
  const latestMatch = matches.at(-1);

  if (!latestMatch) {
    return null;
  }

  return normalizeText(decodeHtml(stripTags(latestMatch[1]))).replace(/\s+/g, " ").trim();
}

function extractStoryCandidates(html) {
  const candidates = [];

  for (const match of html.matchAll(/<span[^>]*font-weight:bold;[^>]*>([\s\S]*?)<\/span>/gi)) {
    const text = normalizeText(decodeHtml(stripTags(match[1]))).replace(/\s+/g, " ").trim();
    if (isUsefulStoryLine(text)) {
      candidates.push(text);
    }
  }

  for (const match of html.matchAll(/<td[^>]*class="dl wrap"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const text = normalizeText(decodeHtml(stripTags(match[1]))).replace(/\s+/g, " ").trim();
    if (isUsefulStoryLine(text)) {
      candidates.push(text);
    }
  }

  for (const match of html.matchAll(/<li>\s*<a [^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi)) {
    const text = normalizeText(decodeHtml(stripTags(match[1]))).replace(/\s+/g, " ").trim();
    if (isUsefulStoryLine(text)) {
      candidates.push(text);
    }
  }

  return [...new Set(candidates)].slice(0, 12);
}

function isUsefulStoryLine(text) {
  if (!text || text.length < 18 || text.length > 180) {
    return false;
  }

  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),/i.test(text)) {
    return false;
  }

  if (/^(american baseball association|frontier league|news|home|standings report|batting report|pitching report)$/i.test(text)) {
    return false;
  }

  return /[A-Za-z]/.test(text);
}

function pickDisplayTitle(heading, title) {
  if (!heading) {
    return title;
  }

  return heading.toLowerCase() === title.toLowerCase() ? title : heading;
}

function dedupeSequentialSentences(sentences) {
  const cleaned = [];

  for (const sentence of sentences) {
    if (cleaned[cleaned.length - 1] !== sentence) {
      cleaned.push(sentence);
    }
  }

  return cleaned;
}
