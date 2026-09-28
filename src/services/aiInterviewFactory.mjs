// Generates the "One-on-One" player interview with a live call to the
// Anthropic API. This module only writes the interview CONTENT — which
// player gets sat down is decided entirely by the existing, untouched
// player-selection logic in snapshotBuilder.mjs's buildPlayerInterviewFeature
// (the top-players pool, the weekend pool, pickStableIndex), which already
// runs on every build and hangs its result on snapshot.playerInterviewFeature.
//
// Resilience: mirrors aiColumnFactory.mjs. If ANTHROPIC_API_KEY isn't set,
// or the call fails or comes back malformed, this falls back to the
// algorithmic interview that snapshotBuilder.mjs already computed on
// feature.interview (the original rules-engine Q&A), reshaped into the
// same {headline, intro, questions} contract — so the section never goes
// empty just because the AI is unavailable, it logs a warning and uses
// the algorithmic version for the day instead.
import { callAnthropic, parseJsonResponse, DEFAULT_MODEL } from "./anthropicClient.mjs";

const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 7;

export async function buildPlayerInterviewContent(snapshot, config) {
  const feature = snapshot?.playerInterviewFeature;
  if (!feature) {
    return null;
  }

  try {
    const digest = buildDigest(feature, snapshot);
    const system = buildSystemPrompt(config);
    const prompt = buildUserPrompt(digest);
    const model = process.env.ANTHROPIC_INTERVIEW_MODEL || process.env.ANTHROPIC_COLUMN_MODEL || DEFAULT_MODEL;
    const raw = await callAnthropic({ system, prompt, maxTokens: 1500, model, temperature: 0.7 });
    const parsed = parseJsonResponse(raw);

    return normalizeAiInterview(parsed);
  } catch (error) {
    console.warn(`[aiInterviewFactory] falling back to the algorithmic interview (${error.message})`);
    return buildFallbackInterview(feature);
  }
}

function normalizeAiInterview(parsed) {
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((qa) => ({ question: String(qa?.question ?? "").trim(), answer: String(qa?.answer ?? "").trim() }))
        .filter((qa) => qa.question && qa.answer)
        .slice(0, MAX_QUESTIONS)
    : [];

  if (!questions.length) {
    throw new Error("model response had no usable questions");
  }

  return {
    headline: String(parsed.headline ?? "").trim(),
    intro: String(parsed.intro ?? "").trim(),
    questions,
    source: "ai",
  };
}

function buildFallbackInterview(feature) {
  const questions = Array.isArray(feature.interview)
    ? feature.interview
        .map((qa) => ({ question: String(qa?.question ?? "").trim(), answer: String(qa?.answer ?? "").trim() }))
        .filter((qa) => qa.question && qa.answer)
    : [];

  if (!questions.length) {
    return null;
  }

  return {
    headline: `One-on-One With ${feature.displayName ?? feature.name ?? "the ABA's Biggest Story"}`,
    intro: "",
    questions,
    source: "fallback",
  };
}

// ---------- prompt ----------

function buildSystemPrompt(config) {
  const newspaperName = config?.newspaperName ?? "The ABA Daily Press";
  const leagueName = config?.leagueName ?? "American Baseball League";

  const lines = [`You are a staff reporter for "${newspaperName}", sitting down for a one-on-one interview with a player in the ${leagueName}.`];

  if (config?.leagueContext) {
    lines.push("", `League facts — do not contradict these: ${config.leagueContext}`);
  }

  lines.push(
    "",
    "Write a realistic, engaging Q&A based only on the data provided below. Across the interview, touch on: how his season is going, his career and past achievements, how his team is doing right now, and his contract situation — but only where the data actually supports it, and don't force a topic that isn't there.",
    "Mix your questions: most should be ordinary, direct baseball questions, but include at least one genuine softball or fun question, and at least one pointed, harder question that pushes back a little — on a slump, a losing record, an expiring contract, an unmet expectation, whatever the data actually supports. Don't make every question tough, and don't make them all soft either.",
    "Write the player's answers in first person, in a natural athlete's voice — confident but human, not a press release and not overly poetic.",
    "Numbers rule: every statistic, award, record, or contract term you cite — for the player, his team, his manager/coach, or anyone else mentioned — must be copied exactly from the data below. Never estimate, round differently, or invent one, and never invent a won-loss record, tenure, or career number for a manager or coach when none is given. A name given below with no numbers attached (e.g. a manager's name) may be used by name only — do not attach a stat to it. If a question or answer touches something not in the data, keep it qualitative rather than stating a number, quote, or date that isn't there.",
    "Stay fully in character as a real newspaper interview. Never mention that you are an AI, a model, a prompt, or that this is a simulated league.",
    "",
    "Reply with ONLY a single JSON object and nothing else — no preamble, no code fence, no sign-off — in exactly this shape:",
    '{"headline": "a short headline for the interview, under 90 characters, no byline", "intro": "one or two plain-text sentences setting up the interview (who, and why now)", "questions": [{"question": "...", "answer": "..."}, ...]}',
    `Write between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} question/answer pairs.`,
  );

  return lines.join("\n");
}

function buildUserPrompt(digest) {
  return `Today's data for this interview:\n${JSON.stringify(digest, null, 2)}`;
}

// ---------- digest ----------
// A deliberately narrow slice of playerInterviewFeature — season line,
// career/award summary, contract status, and how the team is doing —
// rather than the whole feature object (which also carries rendering-only
// fields like image URLs and the old algorithmic Q&A itself).

function buildDigest(feature, snapshot) {
  const teamHighlight = feature.teamHighlight ?? {};

  return {
    league: snapshot?.leagueName,
    date: snapshot?.leagueDateLabel,
    player: {
      name: feature.displayName ?? feature.name ?? "",
      position: feature.pos ?? "",
      age: feature.age ?? "",
      team: feature.teamFullName ?? feature.team ?? "",
      thisSeason: compactObject(feature.currentLine),
      career: {
        summary: feature.careerSummaryLine ?? "",
        detail: feature.careerDetailLine ?? "",
        abaSeasons: feature.abaSeasons ?? "",
        allStarSelections: feature.allStarSelections ?? 0,
        awards: feature.awardsSummaryLine ?? "",
        acquisition: feature.acquisitionSummaryLine ?? "",
      },
      contract: {
        salary: feature.salary ?? "",
        upcomingFreeAgent: Boolean(feature.contractContext?.isUpcomingFreeAgent),
        latestExtension: feature.contractContext?.latestExtension?.text ?? null,
        latestDeal: feature.contractContext?.latestDeal?.text ?? null,
      },
    },
    team: {
      name: teamHighlight.fullName ?? feature.teamFullName ?? feature.team ?? "",
      blurb: [teamHighlight.summaryLine, teamHighlight.detailLine].filter(Boolean),
      status: teamHighlight.facts ?? [],
      history: teamHighlight.historyNotes ?? [],
      notableInjuries: (teamHighlight.injuries ?? []).slice(0, 3),
      // Name only — no coaching record/tenure is collected anywhere in the
      // pipeline, so there is nothing to cite beyond the name itself.
      managerName: teamHighlight.manager || null,
    },
  };
}

function compactObject(source) {
  if (!source || typeof source !== "object") {
    return {};
  }
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => key && value !== "" && value != null));
}
