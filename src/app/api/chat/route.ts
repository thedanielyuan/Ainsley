import Anthropic from "@anthropic-ai/sdk";
import { AINSLEY_SYSTEM_PROMPT } from "@/lib/ainsley-prompt";
import { describeError, getClient } from "@/lib/server/anthropic";
import { toReplayContent } from "@/lib/server/replay";
import { TOOLS } from "@/lib/server/tools";
import type { ApiBlock, StreamEvent } from "@/lib/types";

const MODEL = "claude-opus-5-5";
// Thinking counts toward max_tokens, so leave room for it as well as the reply.
const MAX_TOKENS = 64_000;
const MAX_MESSAGES = 2_000;

export async function POST(req: Request) {
  let payload: { messages?: unknown; container?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = parseMessages(payload?.messages);
  if (typeof messages === "string") {
    return Response.json({ error: messages }, { status: 400 });
  }
  const container =
    typeof payload?.container === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(payload.container)
      ? payload.container
      : undefined;

  const encoder = new TextEncoder();
  let apiStream: ReturnType<Anthropic["beta"]["messages"]["stream"]> | undefined;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // The client went away.
        }
      };

      try {
        apiStream = getClient().beta.messages.stream(
          {
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: [
              {
                type: "text",
                text: AINSLEY_SYSTEM_PROMPT,
                // Tools and the system prompt (~12k tokens) are the same in every chat, so they
                // get a cache entry of their own: a new chat reads them instead of writing them
                // again. An hour, because students start chats and come back to one minutes
                // apart. (A longer-lived entry must come before a shorter one, as here.)
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            tools: TOOLS,
            messages,
            ...(container ? { container } : {}),
            // Opus 5.5 always thinks; effort is the dial (its default is medium).
            output_config: { effort: "high" },
            thinking: {
              type: "adaptive",
              // Summaries let the browser name each step of Ainsley's thinking for the student,
              // the way Grok shows its own (/api/thought). The summaries themselves are never
              // shown: a tutor's private plan often contains the answer it is deliberately
              // guiding the student toward, so a step's name says what Ainsley is doing, not
              // what it concluded.
              display: "summarized",
              // If a replayed thinking block ever fails the history check (say, a file the
              // student deleted), drop it instead of failing the request.
              block_binding: { prefix_mismatch_behavior: "drop_block" },
            },
            // Cache the growing conversation between turns (5 minutes), after the shared entry above.
            cache_control: { type: "ephemeral" },
            // If a safety classifier declines, retry on Anthropic's recommended model.
            fallbacks: "default",
            betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
          },
          { signal: req.signal },
        );

        // Text blocks split by a tool call (or a citation boundary) arrive as separate
        // blocks; keep paragraphs apart when a tool call sat between them.
        let lastText = "";
        let afterOtherBlock = false;
        const emitText = (text: string) => {
          if (!text) return;
          lastText = text;
          send({ type: "text", text });
        };

        for await (const event of apiStream) {
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "text") {
              if (afterOtherBlock && lastText && !lastText.endsWith("\n")) emitText("\n\n");
              afterOtherBlock = false;
            } else {
              afterOtherBlock = true;
            }
            if (block.type === "web_search_tool_result") {
              const ok = Array.isArray(block.content);
              send({
                type: "tool_result",
                id: block.tool_use_id,
                ok,
                count: Array.isArray(block.content) ? block.content.length : undefined,
              });
            } else if (block.type === "web_fetch_tool_result") {
              send({ type: "tool_result", id: block.tool_use_id, ok: block.content.type === "web_fetch_result" });
            }
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            emitText(event.delta.text);
          } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
            if (event.delta.thinking) send({ type: "thinking", text: event.delta.thinking });
          } else if (event.type === "content_block_stop") {
            const block = apiStream.currentMessage?.content[event.index];
            if (block?.type === "thinking") {
              send({ type: "thinking_stop" });
            } else if (block && (block.type === "tool_use" || block.type === "server_tool_use")) {
              const input =
                block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {};
              send({ type: "tool", id: block.id, name: block.name, input });
            }
          }
        }

        const message = await apiStream.finalMessage();
        logUsage(message);
        send({
          type: "done",
          content: toReplayContent(message.content),
          stopReason: message.stop_reason,
          container: message.container?.id ?? null,
        });
      } catch (err) {
        if (!req.signal.aborted && !(err instanceof Anthropic.APIUserAbortError)) {
          console.error("[ainsley] chat request failed:", err);
          send({ type: "error", message: describeError(err) });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      apiStream?.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------- Validation ----------

// Blocks the client may send back as an assistant turn: exactly what the API returned.
const ASSISTANT_BLOCKS = new Set([
  "text",
  "thinking",
  "redacted_thinking",
  "tool_use",
  "server_tool_use",
  "web_search_tool_result",
  "web_fetch_tool_result",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
]);
const USER_BLOCKS = new Set(["text", "image", "document", "tool_result"]);
const TOOL_RESULT_BLOCKS = new Set(["text", "image", "document", "search_result"]);
const FILE_SOURCES = new Set(["file", "base64", "text"]);

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function checkUserBlock(b: Raw, allowed: Set<string>): string | null {
  if (typeof b.type !== "string" || !allowed.has(b.type)) return `Unsupported content block: ${String(b.type)}.`;
  if (b.type === "text" && (typeof b.text !== "string" || !b.text)) return "Text blocks must be non-empty.";
  if ((b.type === "image" || b.type === "document") && !(isObject(b.source) && FILE_SOURCES.has(String(b.source.type)))) {
    return "Files must be referenced by file id or sent inline.";
  }
  if (b.type === "tool_result") {
    if (typeof b.tool_use_id !== "string") return "Tool results need a tool_use_id.";
    if (Array.isArray(b.content)) {
      for (const inner of b.content) {
        const problem = isObject(inner) ? checkUserBlock(inner, TOOL_RESULT_BLOCKS) : "Invalid tool result.";
        if (problem) return problem;
      }
    } else if (typeof b.content !== "string") {
      return "Tool result content must be text or blocks.";
    }
  }
  return null;
}

/**
 * The API rejects a replayed page citation into a PDF sent by file id ("Invalid citation
 * indices: Document not found for page citation"), so once Ainsley cited an attached or opened
 * PDF, the next request (the next tool step, or the student's next message) failed. Citations
 * only matter for display, which reads the stored reply, so replayed text drops them, the same
 * way on every request, which keeps the history append-only. Search-result citations replay fine.
 */
function withoutPageCitations(b: Raw): Raw {
  if (b.type !== "text" || !Array.isArray(b.citations)) return b;
  const kept = b.citations.filter((c) => !(isObject(c) && c.type === "page_location"));
  if (kept.length === b.citations.length) return b;
  const next: Raw = { ...b };
  if (kept.length) next.citations = kept;
  else delete next.citations;
  return next;
}

/** Validates the client's history and converts it to API message params. */
function parseMessages(input: unknown): Anthropic.Beta.BetaMessageParam[] | string {
  if (!Array.isArray(input) || input.length === 0) return "messages must be a non-empty array.";
  if (input.length > MAX_MESSAGES) return "This conversation is too long. Start a new chat.";

  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const raw of input) {
    if (!isObject(raw)) return "Each message must be an object.";
    const { role, content } = raw;

    if (role === "user") {
      if (typeof content === "string") {
        if (!content.trim()) return "User messages must not be empty.";
        out.push({ role: "user", content });
        continue;
      }
      if (!Array.isArray(content) || content.length === 0) return "User messages must not be empty.";
      for (const b of content) {
        const problem = isObject(b) ? checkUserBlock(b, USER_BLOCKS) : "Invalid content block.";
        if (problem) return problem;
      }
      out.push({ role: "user", content: content as ApiBlock[] });
    } else if (role === "assistant") {
      if (!Array.isArray(content)) return "Assistant content must be a list of blocks.";
      const blocks = (content as unknown[])
        .filter((b): b is Raw => isObject(b) && !(b.type === "text" && !b.text))
        .map(withoutPageCitations);
      for (const b of blocks) {
        if (typeof b.type !== "string" || !ASSISTANT_BLOCKS.has(b.type)) {
          return `Unsupported assistant content block: ${String(b.type)}.`;
        }
      }
      if (blocks.length) out.push({ role: "assistant", content: blocks as unknown as ApiBlock[] });
    } else if (role === "system") {
      // Course context, appended right after the student's message it applies to.
      if (typeof content !== "string" || !content.trim() || content.length > 60_000) {
        return "System messages must be non-empty text.";
      }
      if (out[out.length - 1]?.role !== "user") return "A system message must follow a user message.";
      out.push({ role: "system", content });
    } else {
      return "Each message needs a role of user, assistant or system.";
    }
  }

  if (out[0]?.role !== "user") return "The conversation must start with a user message.";
  return out;
}

function logUsage(message: Anthropic.Beta.BetaMessage) {
  if (process.env.NODE_ENV === "production") return;
  const u = message.usage;
  const web = u.server_tool_use
    ? ` web_search=${u.server_tool_use.web_search_requests} web_fetch=${u.server_tool_use.web_fetch_requests}`
    : "";
  console.log(
    `[ainsley] ${message.model} stop=${message.stop_reason} input=${u.input_tokens} ` +
      `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} ` +
      `output=${u.output_tokens}${web}`,
  );
  if (message.input_transformations?.length) {
    console.warn("[ainsley] input_transformations:", message.input_transformations);
  }
}
