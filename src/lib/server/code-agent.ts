import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ApiBlock } from "@/lib/types";
import { AINSLEY_AI, getClient, type AinsleyTier } from "./ainsley-ai";
import { toReplayContent } from "./replay";

/**
 * An Ainsley AI call that can run code (sympy, numpy, scipy) in a sandbox before answering in a
 * fixed JSON shape, with no stake in the tutoring conversation. The two solvers, the verifier, the
 * answer checker and the math checker run this way, on the reasoning tier at high effort unless a
 * caller says otherwise.
 */

// Thinking and code-execution output count toward max_tokens; the JSON itself is short.
const MAX_TOKENS = 32_000;
// Resumes after `pause_turn` (a long run of code execution).
const MAX_RESUMES = 3;

/** The call's JSON answer, or null if it declined (a safety refusal). */
export async function runCodeAgent(opts: {
  /** Names the call in logs and errors ("answer check"). */
  label: string;
  system: string;
  content: ApiBlock[];
  schema: Record<string, unknown>;
  signal: AbortSignal;
  /** The fast tier, for a quicker check (it has no server-side fallback). */
  tier?: AinsleyTier;
  effort?: "high" | "max";
}): Promise<Record<string, unknown> | null> {
  const tier = opts.tier ?? "reasoning";
  const model = AINSLEY_AI[tier];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.content }];
  let container: string | undefined;

  for (let attempt = 0; attempt <= MAX_RESUMES; attempt++) {
    const message = await getClient()
      .beta.messages.stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: opts.system,
          // Not alongside web search here, so a standalone sandbox for checking work is safe to add.
          tools: [{ type: "code_execution_20260521", name: "code_execution" }],
          messages,
          ...(container ? { container } : {}),
          // Each round of code execution (and each resume after `pause_turn`) sends the call so far
          // again: cached, those rounds read it at a twentieth of the input price on the reasoning
          // tier instead of paying full price for it every time. Five minutes is plenty for one call.
          cache_control: { type: "ephemeral" },
          // These have to be right: a wrong solution or verdict teaches the wrong thing.
          output_config: { effort: opts.effort ?? "high", format: { type: "json_schema", schema: opts.schema } },
          thinking: { type: "adaptive", display: "omitted" },
          // If a safety classifier declines, retry on the fallback model the API recommends.
          ...(tier === "reasoning" ? { fallbacks: "default" as const, betas: ["server-side-fallback-2026-07-01"] } : {}),
        },
        { signal: opts.signal },
      )
      .finalMessage();

    logUsage(opts.label, message);
    container = message.container?.id ?? container;

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: toReplayContent(message.content) });
      continue;
    }
    if (message.stop_reason === "refusal") return null;
    if (message.stop_reason === "max_tokens") throw new Error(`The ${opts.label} ran out of room before finishing.`);
    return lastJson(message.content, opts.label);
  }
  throw new Error(`The ${opts.label} took too many steps.`);
}

/** The JSON answer: the last text block. */
function lastJson(content: Anthropic.Beta.BetaContentBlock[], label: string): Record<string, unknown> {
  const texts = content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text" && Boolean(b.text.trim()));
  const raw = texts.at(-1)?.text;
  if (!raw) throw new Error(`The ${label} returned nothing.`);
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`The ${label} returned an unexpected answer.`);
  return data as Record<string, unknown>;
}

function logUsage(label: string, message: Anthropic.Beta.BetaMessage) {
  if (process.env.NODE_ENV === "production") return;
  const u = message.usage;
  console.log(
    `[ainsley] ${label} ${message.model} stop=${message.stop_reason} input=${u.input_tokens} ` +
      `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} output=${u.output_tokens}`,
  );
}
