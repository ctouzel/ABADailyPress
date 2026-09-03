import fs from "node:fs/promises";
import path from "node:path";

export async function enrichHeadlinesWithArticleContent(snapshot, htmlFiles) {
  const hasPrimaryHeadlines = Array.isArray(snapshot.headlines) && snapshot.headlines.length > 0;
  const hasFrontierHeadlines = Array.isArray(snapshot.frontierLeague?.headlines) && snapshot.frontierLeague.headlines.length > 0;

  if (!hasPrimaryHeadlines && !hasFrontierHeadlines) {
    return snapshot;
  }

  const headlineGroups = [
    { key: "headlines", headlines: snapshot.headlines ?? [] },
    { key: "frontier", headlines: snapshot.frontierLeague?.headlines ?? [] },
  ].filter((group) => group.headlines.length > 0);
  const wantedTitles = new Set(headlineGroups.flatMap((group) => group.headlines.map((headline) => normalizeHeadline(headline.title))));

  const wantedLeagueIds = new Set(headlineGroups.flatMap((group) => group.headlines.map((headline) => extractLeagueId(headline.fileName))).filter(Boolean));

  const articleFiles = htmlFiles.filter((filePath) => {
    const baseName = path.basename(filePath).toLowerCase();
    const leagueId = extractLeagueId(baseName);
    return /league_\d+_news_\d+\.html$/.test(baseName) && (!wantedLeagueIds.size || wantedLeagueIds.has(leagueId));
  });

  const articleMap = new Map();
  const articleMapByLeague = new Map();
  const parsedArticles = [];
  const homeStoryMap = new Map();

  const homePageFiles = htmlFiles.filter((filePath) => /league_\d+_home\.html$/i.test(path.basename(filePath)));

  for (const filePath of homePageFiles) {
    const rawHtml = await fs.readFile(filePath, "utf8");
    const stories = parseHomePageStories(filePath, rawHtml);
    homeStoryMap.set(path.basename(filePath), stories);
  }

  for (const filePath of articleFiles) {
    const rawHtml = await fs.readFile(filePath, "utf8");
    const article = parseArticlePage(filePath, rawHtml);
    if (!article) {
      continue;
    }

    parsedArticles.push(article);
    const normalizedTitle = normalizeHeadline(article.title);
    if (wantedTitles.has(normalizedTitle)) {
      const leagueKey = buildLeagueScopedHeadlineKey(normalizedTitle, article.leagueId);
      const existingForLeague = articleMapByLeague.get(leagueKey);
      if (!existingForLeague || (article.timestamp ?? 0) >= (existingForLeague.timestamp ?? 0)) {
        articleMapByLeague.set(leagueKey, article);
      }

      const existing = articleMap.get(normalizedTitle);
      if (!existing || (article.timestamp ?? 0) >= (existing.timestamp ?? 0)) {
        articleMap.set(normalizedTitle, article);
      }
    }
  }

  const enrichedGroups = Object.fromEntries(
    headlineGroups.map((group) => [
      group.key,
      enrichHeadlineGroup(group.headlines, articleMap, parsedArticles, homeStoryMap, {
        maxDistinctDates: 1,
        articleMapByLeague,
        expectedLeagueId:
          (group.key === "frontier" ? snapshot.frontierLeague?.leagueId : extractLeagueId(group.headlines[0]?.fileName)) ||
          extractLeagueId(group.headlines[0]?.fileName),
      }),
    ]),
  );

  if (Array.isArray(enrichedGroups.frontier)) {
    enrichedGroups.frontier = enrichedGroups.frontier.filter((headline) => isFrontierHeadlineAllowed(headline));
  }

  return {
    ...snapshot,
    headlines: enrichedGroups.headlines ?? snapshot.headlines,
    frontierLeague: snapshot.frontierLeague
      ? {
          ...snapshot.frontierLeague,
          headlines: enrichedGroups.frontier ?? snapshot.frontierLeague.headlines,
        }
      : snapshot.frontierLeague,
  };
}

function enrichHeadlineGroup(headlines, articleMap, parsedArticles, homeStoryMap, options = {}) {
  const resolvedHeadlines = headlines.map((headline) => {
    const homeStory = findHomePageStory(homeStoryMap.get(headline.fileName), headline.title);
    const normalizedTitle = normalizeHeadline(headline.title);
    const leagueId = extractLeagueId(headline.fileName);
    const leagueScopedArticle = options.articleMapByLeague?.get(buildLeagueScopedHeadlineKey(normalizedTitle, leagueId)) ?? null;
    const bestLeagueArticle = findBestArticleMatch(headline, parsedArticles);
    const article =
      homeStory ??
      leagueScopedArticle ??
      bestLeagueArticle ??
      articleMap.get(normalizedTitle);

    return article
      ? {
          ...headline,
          fullText: article.body,
          date: article.date,
          imageUrl: article.imageUrl,
          headlineTimestamp: article.timestamp ?? 0,
        }
      : {
          ...headline,
          headlineTimestamp: 0,
      };
  });

  const compatibleHeadlines = resolvedHeadlines.filter((headline) => isHeadlineCompatibleWithLeague(headline, options.expectedLeagueId));
  const sortedHeadlines = resolvedHeadlines.sort(compareResolvedHeadlines);
  const uniqueHeadlines = dedupeHeadlinesByContent((compatibleHeadlines.length ? compatibleHeadlines : resolvedHeadlines).sort(compareResolvedHeadlines));
  const selectedHeadlines = selectHeadlinesForDisplay(uniqueHeadlines, options);
  return selectedHeadlines.map(({ headlineTimestamp, ...headline }) => headline);
}

function buildLeagueScopedHeadlineKey(normalizedTitle, leagueId) {
  return `${String(leagueId ?? "").trim()}::${String(normalizedTitle ?? "").trim()}`;
}

function isFrontierHeadlineAllowed(headline) {
  const title = String(headline?.title ?? "");
  if (!/^bnn stats:/i.test(title)) {
    return true;
  }

  const text = `${headline?.title ?? ""}\n${headline?.fullText ?? ""}\n${headline?.summary ?? ""}`.toLowerCase();
  return !/\bamerican baseball association\b|\baba\b/.test(text);
}

function isHeadlineCompatibleWithLeague(headline, expectedLeagueId) {
  const leagueId = String(expectedLeagueId ?? "").trim();
  if (!leagueId) {
    return true;
  }

  const text = `${headline?.title ?? ""}\n${headline?.fullText ?? ""}\n${headline?.summary ?? ""}`.toLowerCase();
  if (!/^bnn stats:/i.test(String(headline?.title ?? ""))) {
    return true;
  }

  if (leagueId === "201") {
    return !/\bamerican baseball association\b|\baba\b/.test(text);
  }

  if (leagueId === "200") {
    return !/\bfrontier league\b|\bfl\b/.test(text);
  }

  return true;
}

function compareResolvedHeadlines(left, right) {
  const priorityDelta = scoreResolvedHeadlinePriority(right) - scoreResolvedHeadlinePriority(left);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const weightDelta = scoreResolvedHeadlineWeight(right) - scoreResolvedHeadlineWeight(left);
  if (weightDelta !== 0) {
    return weightDelta;
  }

  const timestampDelta = (right.headlineTimestamp ?? 0) - (left.headlineTimestamp ?? 0);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return (right.score ?? 0) - (left.score ?? 0);
}

function selectHeadlinesForDisplay(headlines, options = {}) {
  const displayTarget = options.minLatestHeadlines ?? 5;
  const carryoverLimit = options.carryoverCount ?? 2;
  const maxCarryoverGapDays = options.maxCarryoverGapDays ?? 21;
  const datedHeadlines = headlines.filter((headline) => normalizeDateLabel(headline.date));

  if (!datedHeadlines.length) {
    return headlines;
  }

  const allDateKeys = selectLatestDistinctDateKeys(datedHeadlines, Number.MAX_SAFE_INTEGER);
  const latestDateKey = allDateKeys[0];
  if (!latestDateKey) {
    return headlines;
  }
  const latestTimestamp = datedHeadlines.find((headline) => normalizeDateLabel(headline.date) === latestDateKey)?.headlineTimestamp ?? 0;

  const latestStories = datedHeadlines.filter((headline) => normalizeDateLabel(headline.date) === latestDateKey);
  if (latestStories.length >= displayTarget) {
    return latestStories;
  }

  const selectedStories = [...latestStories];
  for (const carryoverDateKey of allDateKeys.slice(1)) {
    if (selectedStories.length >= displayTarget) {
      break;
    }

    const carryoverTimestamp = datedHeadlines.find((headline) => normalizeDateLabel(headline.date) === carryoverDateKey)?.headlineTimestamp ?? 0;
    if (latestTimestamp && carryoverTimestamp) {
      const gapDays = Math.abs(latestTimestamp - carryoverTimestamp) / (24 * 60 * 60 * 1000);
      if (gapDays > maxCarryoverGapDays) {
        break;
      }
    }

    const carryoverStories = datedHeadlines
      .filter((headline) => normalizeDateLabel(headline.date) === carryoverDateKey)
      .slice(0, carryoverLimit);

    if (!carryoverStories.length) {
      continue;
    }

    selectedStories.push(...carryoverStories);
  }

  return selectedStories;
}

function scoreResolvedHeadlinePriority(headline) {
  const text = `${headline.title ?? ""} ${headline.fullText ?? ""}`.toLowerCase();

  if (/\b(out for the season|season[- ]ending|miss(?:es|ing)? the rest of the season|will miss the rest of the season|done for the year|sidelined for the season)\b/.test(text)) {
    return 100;
  }

  if (/\b(trading block|trade block|put .* on the trading block|put .* on the trade block|shop(ping)? .* around)\b/.test(text)) {
    return -50;
  }

  if (/\b(finalized|confirmed the trade|confirm swap|confirmed swap|swap|swapped|have swapped|have traded|traded|dealt|acquisition|acquire|acquired|in exchange for|sends .+ to|sent .+ to)\b/.test(text)) {
    return 40;
  }

  if (/\b(three-homer|three home run|4-for-4|4 hit|5 hit|cycle|no-hitter|perfect game|hitting streak|milestone|record|strikes out 15|struck out 15)\b/.test(text)) {
    return 30;
  }

  if (/\b(trade talks?|reportedly in talks|talks intensifying|deep in talks|serious trade offer)\b/.test(text)) {
    return -20;
  }

  return 0;
}

function selectLatestDistinctDateKeys(headlines, maxDistinctDates) {
  const datedHeadlines = headlines
    .map((headline) => ({
      timestamp: headline.headlineTimestamp ?? 0,
      dateKey: normalizeDateLabel(headline.date),
    }))
    .filter((headline) => headline.timestamp && headline.dateKey)
    .sort((left, right) => right.timestamp - left.timestamp);

  const chosenDates = [];
  for (const headline of datedHeadlines) {
    if (!chosenDates.includes(headline.dateKey)) {
      chosenDates.push(headline.dateKey);
    }

    if (chosenDates.length >= maxDistinctDates) {
      break;
    }
  }

  return chosenDates;
}

function normalizeDateLabel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function scoreResolvedHeadlineWeight(headline) {
  const text = `${headline.title ?? ""} ${headline.fullText ?? ""}`.toLowerCase();
  let score = 0;

  if (/\b(finalized|confirmed the trade|confirm swap|confirmed swap|swap|swapped|have swapped|have traded|traded|dealt|acquisition|acquire|acquired|in exchange for|sends .+ to|sent .+ to)\b/.test(text)) {
    score += 18;
  }

  if (/\b(three-homer|three home run|4-for-4|4 hit|5 hit|cycle|no-hitter|perfect game|hitting streak|streak|dominates|milestone|record)\b/.test(text)) {
    score += 8;
  }

  if (/\b(trading block|trade block|put .* on the trading block|shop(ping)? .* around)\b/.test(text)) {
    score -= 16;
  }

  if (/\btrade talks?\b/.test(text)) {
    score -= 16;
  }

  if (/\b(close|trying to work through|deep in talks|in talks|talks intensifying|reportedly in talks|serious trade offer)\b/.test(text)) {
    score -= 6;
  }

  if (/\b(buzzing|potential trade|could break at any time|sources say|rumor|rumour)\b/.test(text)) {
    score -= 8;
  }

  return score;
}

function dedupeHeadlinesByContent(headlines) {
  const seen = new Set();
  const unique = [];

  for (const headline of headlines) {
    const contentKey = buildHeadlineDedupKey(headline);
    if (seen.has(contentKey)) {
      continue;
    }

    seen.add(contentKey);
    unique.push(headline);
  }

  return unique;
}

function buildHeadlineDedupKey(headline) {
  const featSignature = extractFeatSignature(headline);
  if (featSignature) {
    return `feat:${featSignature}`;
  }

  const milestoneSignature = extractMilestoneSignature(headline);
  if (milestoneSignature) {
    return `milestone:${milestoneSignature}`;
  }

  const fullText = normalizeHeadline(stripStoryChrome(headline.fullText ?? ""));
  if (fullText) {
    return `body:${fullText}`;
  }

  const summary = normalizeHeadline(headline.summary ?? "");
  if (summary) {
    return `summary:${summary}`;
  }

  const awardSignature = extractAwardSignature(headline);
  if (awardSignature) {
    return `award:${awardSignature}`;
  }

  return `title:${normalizeHeadline(headline.title ?? "")}`;
}

function extractFeatSignature(headline) {
  const title = String(headline.title ?? "");
  const fullText = String(headline.fullText ?? "");
  const summary = String(headline.summary ?? "");
  const date = normalizeDateLabel(headline.date);
  const searchable = `${title}\n${fullText}\n${summary}`;
  const normalized = normalizeHeadline(searchable);

  if (!date) {
    return "";
  }

  if (!/\b(4 for 4|4 for 5|4 for 6|5 for 5|5 for 6|goes \d+\-\d+|went \d+ for \d+|strikes out 15|struck out 15|three run home run|hit a three run home run|cycle|no hitter|perfect game|five hits|4 hit|5 hit)\b/.test(normalized)) {
    return "";
  }

  const playerName = extractFeatPlayerName(title, fullText);
  if (!playerName) {
    return "";
  }

  return `${normalizeHeadline(playerName)}:${date}`;
}

function extractFeatPlayerName(title, fullText) {
  const titleVsMatch = String(title ?? "").match(/:\s*([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+goes\b/);
  if (titleVsMatch) {
    return `${titleVsMatch[1]} ${titleVsMatch[2]}`;
  }

  const titleLeadMatch = String(title ?? "").match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
  if (titleLeadMatch && !/\b(mets|dogs|indians|bananas|bulls|clippers|grizzlies|tides|eagles|ospreys|emeralds|red wings)\b/i.test(`${titleLeadMatch[1]} ${titleLeadMatch[2]}`)) {
    return `${titleLeadMatch[1]} ${titleLeadMatch[2]}`;
  }

  const bodyQuotedName = String(fullText ?? "").match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(?:hit|singled|doubled|tripled|homered|launched|walked|struck out|went)\b/);
  if (bodyQuotedName) {
    return `${bodyQuotedName[1]} ${bodyQuotedName[2]}`;
  }

  return extractFirstPersonName(fullText);
}

function stripStoryChrome(text) {
  return String(text ?? "")
    .replace(/\bView Boxscore\b/gi, " ")
    .replace(/\bView Game Log\b/gi, " ")
    .replace(/\bWatch Highlights\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAwardSignature(headline) {
  const title = String(headline.title ?? "");
  const fullText = String(headline.fullText ?? "");
  const summary = String(headline.summary ?? "");
  const searchable = `${title}\n${fullText}\n${summary}`;
  const normalized = normalizeHeadline(searchable);
  const awardPhrase = detectAwardPhrase(normalized);
  if (!awardPhrase) {
    return "";
  }

  const surname = extractAwardSurname(title, fullText, normalized);
  if (!surname) {
    return "";
  }

  return `${surname}:${awardPhrase}`;
}

function extractMilestoneSignature(headline) {
  const title = String(headline.title ?? "");
  const fullText = String(headline.fullText ?? "");
  const summary = String(headline.summary ?? "");
  const searchable = `${title}\n${fullText}\n${summary}`;
  const normalized = normalizeHeadline(searchable);

  if (!/\b(mark|milestone|career home run|career hit|career win|career strikeout|launches his|launches her|home runs for|hits for|wins for|strikeouts for)\b/.test(normalized)) {
    return "";
  }

  const playerName = extractMilestonePlayerName(title, fullText);
  if (!playerName) {
    return "";
  }

  const homeRunMatch =
    normalized.match(/\b(\d+)\s+home\s+runs?\b/) ??
    normalized.match(/\b(\d+)(?:th)?\s+career\s+home\s+run\b/) ??
    normalized.match(/\blaunches\s+(?:his|her)\s+(\d+)(?:th)?\s+career\s+home\s+run\b/);
  if (homeRunMatch) {
    return `${playerName}:home-runs:${homeRunMatch[1]}`;
  }

  const hitMatch =
    normalized.match(/\b(\d+)\s+hits?\b/) ??
    normalized.match(/\b(\d+)(?:th)?\s+career\s+hit\b/);
  if (hitMatch && /\bcareer\s+hit|hits?\s+for\b/.test(normalized)) {
    return `${playerName}:hits:${hitMatch[1]}`;
  }

  const strikeoutMatch =
    normalized.match(/\b(\d+)\s+strikeouts?\b/) ??
    normalized.match(/\b(\d+)(?:th)?\s+career\s+strikeout\b/);
  if (strikeoutMatch && /\bcareer\s+strikeout|strikeouts?\s+for\b/.test(normalized)) {
    return `${playerName}:strikeouts:${strikeoutMatch[1]}`;
  }

  const winMatch =
    normalized.match(/\b(\d+)\s+wins?\b/) ??
    normalized.match(/\b(\d+)(?:th)?\s+career\s+win\b/);
  if (winMatch && /\bcareer\s+win|wins?\s+for\b/.test(normalized)) {
    return `${playerName}:wins:${winMatch[1]}`;
  }

  return "";
}

function extractMilestonePlayerName(title, fullText) {
  const titleDirectMatch = String(title ?? "").match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(?:launches|reaches|records|collects|hits)\b/);
  if (titleDirectMatch) {
    return normalizeHeadline(`${titleDirectMatch[1]} ${titleDirectMatch[2]}`);
  }

  const bodyVerbMatch = String(fullText ?? "").match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(?:swatted|launched|reached|recorded|collected|picked up|drove in)\b/);
  if (bodyVerbMatch) {
    return normalizeHeadline(`${bodyVerbMatch[1]} ${bodyVerbMatch[2]}`);
  }

  const normalizedTitle = normalizeHeadline(title);
  const normalizedText = normalizeHeadline(`${title} ${fullText}`);
  const lastNameFromTitle = normalizedTitle.match(/\bfor\s+([a-z]+)\b/)?.[1] ?? "";
  if (!lastNameFromTitle) {
    const direct = extractFirstPersonName(fullText);
    return direct ? normalizeHeadline(direct) : "";
  }

  const fullNameMatch = normalizedText.match(new RegExp(`\\b([a-z]+\\s+${lastNameFromTitle})\\b`));
  return fullNameMatch?.[1] ?? lastNameFromTitle;
}

function extractFirstPersonName(text) {
  const cleaned = String(text ?? "").replace(/[#*]+/g, " ");
  const match = cleaned.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/);
  return match ? match[1].trim() : "";
}

function detectAwardPhrase(normalizedText) {
  const directPhrase = AWARD_PHRASES.find((phrase) => normalizedText.includes(phrase));
  if (directPhrase) {
    return directPhrase;
  }

  if (/top hitter|top batter/.test(normalizedText)) {
    return "batter of the month";
  }

  if (/best rookie|rookie star/.test(normalizedText)) {
    return "rookie of the month";
  }

  if (/#1 hurler|elite pitcher|top pitcher/.test(normalizedText)) {
    return "pitcher of the month";
  }

  return "";
}

function extractAwardSurname(title, fullText, normalizedText) {
  const playerName = extractPlayerName(normalizeHeadline(title)) || extractProperName(fullText) || extractProperName(title);
  if (playerName) {
    const parts = playerName.split(/\s+/).filter(Boolean);
    return parts.at(-1)?.toLowerCase() ?? "";
  }

  const titleSurnameMatch = title.match(/\b([A-Z][a-z]+)(?:'s)?\b/);
  if (titleSurnameMatch) {
    return titleSurnameMatch[1].toLowerCase();
  }

  const normalizedTokens = String(normalizedText ?? "").split(/\s+/).filter(Boolean);
  return normalizedTokens[0] ?? "";
}

function extractProperName(text) {
  const match = String(text ?? "").match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function parseHomePageStories(filePath, rawHtml) {
  const stories = [];
  const blockPattern =
    /<table class="databg"[^>]*width="665px"[^>]*style="margin-bottom:4px;"[^>]*>[\s\S]*?<td valign="top" width="110"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/td>[\s\S]*?<td valign="top" width="555"[^>]*>\s*<span style="font-weight:bold; font-size:15px; margin-bottom:0px;">([\s\S]*?)<\/span><br>\s*<span style="font-size:11px; margin-bottom:4px;">([\s\S]*?)<\/span><br>\s*([\s\S]*?)<\/td>[\s\S]*?<\/table>/gi;

  for (const match of rawHtml.matchAll(blockPattern)) {
    const imageUrl = toLocalFileUrl(filePath, match[1]);
    const title = decodeHtml(stripTags(match[2])).replace(/\s+/g, " ").trim();
    const date = decodeHtml(stripTags(match[3])).replace(/\s+/g, " ").trim();
    const body = cleanHomePageStoryBody(match[4]);

    if (!title || !body) {
      continue;
    }

    stories.push({
      title,
      date,
      timestamp: parseLooseDate(date),
      body,
      imageUrl,
      leagueId: extractLeagueId(path.basename(filePath)),
    });
  }

  return stories;
}

function cleanHomePageStoryBody(rawBody) {
  return decodeHtml(
    String(rawBody ?? "")
      .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<a [^>]*>View Boxscore<\/a>/gi, " ")
      .replace(/<a [^>]*>View Game Log<\/a>/gi, " ")
      .replace(/<a [^>]*>Watch Highlights<\/a>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function findHomePageStory(stories, headlineTitle) {
  if (!stories?.length) {
    return null;
  }

  const normalizedHeadline = normalizeHeadline(headlineTitle);
  return stories.find((story) => normalizeHeadline(story.title) === normalizedHeadline) ?? null;
}

function parseArticlePage(filePath, rawHtml) {
  const title = extractTitle(rawHtml) ?? path.basename(filePath, ".html");
  const bodyCellMatch = rawHtml.match(/<td class="dl"[^>]*>([\s\S]*?)<\/td>/i);
  if (!bodyCellMatch) {
    return null;
  }

  const rawBody = bodyCellMatch[1];
  const dateMatch = rawBody.match(/<span[^>]*font-size:11pt; font-weight:bold;[^>]*>([\s\S]*?)<\/span>/i);
  const titleSpanMatch = rawBody.match(/<span[^>]*font-size:15pt; font-weight:bold;[^>]*>([\s\S]*?)<\/span>/i);
  const imageMatch = rawHtml.match(/<td valign="top" width="120px"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/i);

  let cleanedBody = rawBody
    .replace(/<span[^>]*font-size:15pt; font-weight:bold;[^>]*>[\s\S]*?<\/span>/i, " ")
    .replace(/<span[^>]*font-size:11pt; font-weight:bold;[^>]*>[\s\S]*?<\/span>/i, " ")
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<b>(.*?)<\/b>/gi, "$1")
    .replace(/<[^>]+>/g, " ");

  cleanedBody = decodeHtml(cleanedBody).replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/[ \t]+/g, " ").trim();

  return {
    title: decodeHtml(stripTags(titleSpanMatch?.[1] ?? title)).replace(/\s+/g, " ").trim(),
    date: dateMatch ? decodeHtml(stripTags(dateMatch[1])).replace(/\s+/g, " ").trim() : "",
    timestamp: parseLooseDate(dateMatch ? decodeHtml(stripTags(dateMatch[1])).replace(/\s+/g, " ").trim() : ""),
    body: cleanedBody,
    imageUrl: toLocalFileUrl(filePath, imageMatch?.[1] ?? ""),
    normalizedTitle: normalizeHeadline(title),
    normalizedBody: normalizeHeadline(cleanedBody),
    searchableText: normalizeHeadline(`${title} ${cleanedBody}`),
    leagueId: extractLeagueId(path.basename(filePath)),
  };
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(stripTags(match[1])).trim() : null;
}

function stripTags(input) {
  return String(input ?? "").replace(/<[^>]+>/g, " ");
}

function decodeHtml(input) {
  return String(input ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/Ã‚([Â¼Â½Â¾])/g, "$1")
    .replace(/Â½/g, ".5")
    .replace(/Â¼/g, ".25")
    .replace(/Â¾/g, ".75")
    .replace(/ÃƒÂ©/g, "e")
    .replace(/Ãƒ/g, "");
}

function normalizeHeadline(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .toLowerCase();
}

function extractLeagueId(fileName) {
  const match = String(fileName ?? "").match(/league_(\d+)_/i);
  return match ? match[1] : null;
}

function toLocalFileUrl(baseFilePath, relativeSrc) {
  if (!relativeSrc) {
    return "";
  }

  const cleanedSrc = String(relativeSrc).trim();
  if (!cleanedSrc || /^https?:/i.test(cleanedSrc)) {
    return cleanedSrc;
  }

  const absolutePath = cleanedSrc.startsWith("file:")
    ? cleanedSrc.replace(/^file:\/*/i, "")
    : path.resolve(path.dirname(baseFilePath), cleanedSrc);
  const newsRoot = findContainingFolder(absolutePath, "News");

  if (newsRoot) {
    const relativePath = path.relative(newsRoot, absolutePath).split(path.sep).map(encodeURIComponent).join("/");
    return `/news/${relativePath}`;
  }

  return cleanedSrc;
}

function findContainingFolder(filePath, folderName) {
  let currentPath = path.resolve(filePath);

  while (true) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return "";
    }

    if (path.basename(parentPath).toLowerCase() === String(folderName).toLowerCase()) {
      return parentPath;
    }

    currentPath = parentPath;
  }
}

function findBestArticleMatch(headline, parsedArticles) {
  const headlineLeagueId = extractLeagueId(headline.fileName);
  const headlineTokens = tokenize(headline.title);
  const normalizedHeadline = normalizeHeadline(headline.title);
  const scopedArticles = parsedArticles.filter((article) => {
    if (!headlineLeagueId || !article.leagueId) {
      return true;
    }
    return article.leagueId === headlineLeagueId;
  });

  const awardArticle = findAwardArticle(normalizedHeadline, scopedArticles);
  if (awardArticle) {
    return awardArticle;
  }

  let bestArticle = null;
  let bestScore = -Infinity;

  for (const article of scopedArticles) {
    const score = scoreArticleMatch(normalizedHeadline, headlineTokens, article);
    if (score > bestScore) {
      bestScore = score;
      bestArticle = article;
    }
  }

  return bestScore >= 5 ? bestArticle : null;
}

function findAwardArticle(normalizedHeadline, scopedArticles) {
  if (!hasAny(normalizedHeadline, ["honored", "player of the week", "batter of the month", "pitcher of the month", "rookie of the month"])) {
    return null;
  }

  const playerName = extractPlayerName(normalizedHeadline);
  if (!playerName) {
    return null;
  }

  const awardPhrases = AWARD_PHRASES.filter((phrase) => normalizedHeadline.includes(phrase));
  if (!awardPhrases.length) {
    return null;
  }

  return (
    scopedArticles
      .filter((article) => {
        const searchable = `${article.normalizedTitle} ${article.normalizedBody}`;
        return searchable.includes(playerName) && awardPhrases.some((phrase) => searchable.includes(phrase));
      })
      .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))[0] ?? null
  );
}

function scoreArticleMatch(normalizedHeadline, headlineTokens, article) {
  const articleTokens = tokenize(article.searchableText);
  const titleTokens = tokenize(article.normalizedTitle);
  let score = countOverlap(headlineTokens, articleTokens);

  if (article.normalizedTitle === normalizedHeadline) {
    score += 100;
  }

  score += countOverlap(headlineTokens, titleTokens) * 2;

  const headlineNames = extractNameTokens(headlineTokens);
  const articleNames = new Set(extractNameTokens(articleTokens));
  const nameMatches = headlineNames.filter((token) => articleNames.has(token)).length;
  if (nameMatches >= 2) {
    score += 5;
  }
  const playerNameTokens = extractPlayerNameTokens(normalizedHeadline);
  const playerNameMatches = playerNameTokens.filter((token) => articleNames.has(token)).length;
  if (playerNameTokens.length >= 2 && playerNameMatches === playerNameTokens.length) {
    score += 8;
  }
  if (hasAny(normalizedHeadline, ["player of the week", "honored"]) && playerNameTokens.length >= 2 && playerNameMatches < playerNameTokens.length) {
    score -= 40;
  } else if (hasAny(normalizedHeadline, ["player of the week", "honored"]) && headlineNames.length >= 2 && nameMatches < 2) {
    score -= 20;
  }

  if (hasAny(normalizedHeadline, ["player of the week", "all star", "prospects"])) {
    score += countSharedPhrases(normalizedHeadline, article.normalizedTitle, article.normalizedBody);
  }

  if (normalizedHeadline.includes("all star") && article.normalizedTitle.includes("all star")) {
    score += 4;
  }

  if (normalizedHeadline.includes("conference north") && article.normalizedBody.includes("conference north")) {
    score += 3;
  }

  if (
    hasAny(normalizedHeadline, ["rosters", "selections announced"]) &&
    hasAny(`${article.normalizedTitle} ${article.normalizedBody}`, ["official all star rosters", "rosters have been announced"])
  ) {
    score += 6;
  }

  if (
    normalizedHeadline.includes("all star game selections announced") &&
    article.normalizedTitle.includes("all star game rosters have been announced") &&
    !article.normalizedTitle.includes("prospects")
  ) {
    score += 20;
  }

  return score;
}

function extractNameTokens(tokens) {
  return tokens.filter((token) => token.length >= 4 && !ROLE_WORDS.has(token));
}

function extractPlayerNameTokens(normalizedHeadline) {
  const match = normalizedHeadline.match(/(?:^| )(?:[a-z]{1,3} )?([a-z]+) ([a-z]+) of the /);
  if (!match) {
    return [];
  }

  return [match[1], match[2]].filter(Boolean);
}

function extractPlayerName(normalizedHeadline) {
  const tokens = extractPlayerNameTokens(normalizedHeadline);
  return tokens.length === 2 ? tokens.join(" ") : "";
}

function countSharedPhrases(headline, articleTitle, articleBody) {
  let score = 0;
  for (const phrase of KEY_PHRASES) {
    const inHeadline = headline.includes(phrase);
    if (!inHeadline) {
      continue;
    }

    if (articleTitle.includes(phrase)) {
      score += 3;
    } else if (articleBody.includes(phrase)) {
      score += 2;
    }
  }
  return score;
}

function hasAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function parseLooseDate(value) {
  const cleaned = String(value ?? "")
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+/i, "")
    .replace(/\s+,/g, ",")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const timestamp = Date.parse(cleaned);
  if (!Number.isNaN(timestamp)) {
    return timestamp;
  }

  const fallbackMatch = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (!fallbackMatch) {
    return 0;
  }

  const [, month, day, year] = fallbackMatch;
  const fallbackTimestamp = Date.parse(`${month} ${day} ${year}`);
  return Number.isNaN(fallbackTimestamp) ? 0 : fallbackTimestamp;
}

function tokenize(text) {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "have",
    "been",
    "will",
    "into",
    "wins",
    "announced",
    "breaking",
    "news",
    "game",
    "conference",
    "league",
    "association",
  ]);

  return [...new Set(
    normalizeHeadline(text)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopwords.has(token)),
  )];
}

function countOverlap(leftTokens, rightTokens) {
  const rightSet = new Set(rightTokens);
  return leftTokens.reduce((count, token) => count + (rightSet.has(token) ? 1 : 0), 0);
}

const ROLE_WORDS = new Set([
  "news",
  "breaking",
  "award",
  "awards",
  "honored",
  "wins",
  "player",
  "week",
  "conference",
  "north",
  "south",
  "all",
  "star",
  "game",
  "selections",
  "announced",
  "rosters",
]);

const KEY_PHRASES = [
  "player of the week",
  "batter of the month",
  "pitcher of the month",
  "rookie of the month",
  "all star",
  "official all star rosters",
  "rosters have been announced",
  "prospects game",
];

const AWARD_PHRASES = [
  "player of the week",
  "batter of the month",
  "pitcher of the month",
  "rookie of the month",
];
