/**
 * The evals' own model calls (the simulated students, the rubric judge, and the answer-equivalence
 * fallback), separate from the app's. Each returns JSON in a fixed shape, and its token usage is
 * tallied so a run can report what the harness itself spent.
 */
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
// $ per million tokens for claude-opus-5-5 (cache writes at the 5-minute rate).
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

let client;
const usage = new Map();
const served = new Set();

/** A harness call that couldn't produce a usable answer: an infra error, never a score. */
export class HarnessError extends Error {}

function tally(label, message) {
  const u = message.usage;
  const t = usage.get(label) ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  t.calls += 1;
  t.input += u.input_tokens ?? 0;
  t.output += u.output_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  t.cacheWrite += u.cache_creation_input_tokens ?? 0;
  usage.set(label, t);
  served.add(message.model);
}

/**
 * One call that answers in JSON matching `schema`. Thinking is adaptive; `effort` sets how hard it
 * works. Refusals and truncation throw HarnessError, so they're recorded as infra errors.
 */
export async function askJson({ label, system, prompt, schema, effort = "high", maxTokens = 32_000, signal }) {
  client ??= new Anthropic({ maxRetries: 4 });
  let message;
  try {
    message = await client.beta.messages
      .stream(
        {
          model: MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
          thinking: { type: "adaptive" },
          output_config: { effort, format: { type: "json_schema", schema } },
          // If a safety classifier declines, retry on Anthropic's recommended model.
          fallbacks: "default",
          betas: ["server-side-fallback-2026-07-01"],
        },
        { signal },
      )
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new HarnessError(
        "The evals' own model calls couldn't authenticate. Set ANTHROPIC_API_KEY (npm run eval reads .env.local).",
      );
    }
    throw err;
  }
  tally(label, message);
  if (message.stop_reason === "refusal") throw new HarnessError(`The ${label} call was declined (refusal).`);
  if (message.stop_reason === "max_tokens") throw new HarnessError(`The ${label} call ran out of tokens.`);
  const raw = message.content.filter((b) => b.type === "text" && b.text.trim()).at(-1)?.text;
  if (!raw) throw new HarnessError(`The ${label} call returned no text.`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HarnessError(`The ${label} call returned invalid JSON.`);
  }
}

/** What the harness's own calls used, by label, with an estimated cost. */
export function harnessUsage() {
  const rows = [...usage.entries()].map(([label, t]) => ({
    label,
    ...t,
    cost:
      (t.input * PRICE.input + t.output * PRICE.output + t.cacheRead * PRICE.cacheRead + t.cacheWrite * PRICE.cacheWrite) /
      1e6,
  }));
  return { rows, cost: rows.reduce((sum, r) => sum + r.cost, 0), models: [...served] };
}
