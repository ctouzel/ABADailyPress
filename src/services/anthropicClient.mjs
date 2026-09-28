// Shared low-level helper for calling the Anthropic API and parsing a
// single JSON object out of the response text. Used by both
// aiColumnFactory.mjs (the opinion columns) and aiInterviewFactory.mjs
// (the player interview) so the request/response/error-handling logic
// isn't duplicated between them — each caller still builds its own
// system/user prompts and picks its own model env var.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export async function callAnthropic({ system, prompt, maxTokens = 1000, model = DEFAULT_MODEL, temperature }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        ...(temperature != null ? { temperature } : {}),
      }),
    });
  } catch (networkError) {
    throw new Error(`network error calling Anthropic API: ${networkError.message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Anthropic API returned ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = (data.content ?? []).map((block) => block.text ?? "").join("");
  if (!text.trim()) {
    throw new Error("Anthropic API returned an empty response");
  }

  return text;
}

// The model is asked to reply with a single JSON object. Models sometimes
// wrap that in a sentence or a code fence despite instructions, so pull
// out the first {...} block rather than requiring an exact match.
export function parseJsonResponse(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("no JSON object found in the model's response");
  }

  try {
    return JSON.parse(match[0]);
  } catch (parseError) {
    throw new Error(`could not parse the model's JSON response: ${parseError.message}`);
  }
}
