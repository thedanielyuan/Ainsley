/**
 * One of Ainsley's replies, produced the way the browser produces it: this mirrors `generate` in
 * src/lib/use-chat.ts (a React hook, so it can't be imported). Each request goes to /api/chat;
 * tool calls run through the app's own runTool (src/lib/agent-tools.ts), whose solve and check
 * requests reach the dev server; pause_turn resumes; the transcript is replayed append-only.
 *
 * If you change that loop or what the browser sends (new system messages, new client tools),
 * change this to match, or the evals measure an app that no longer exists.
 */
import { randomUUID } from "node:crypto";
import { backoff, TRANSIENT } from "./app.mjs";

/** As in use-chat.ts: the most API requests one reply may take. */
const MAX_STEPS = 12;
const MAX_RETRIES = 2;
// The stream to the dev server dropping (a restart, a recompile), as opposed to Ainsley failing.
const DROPPED = /connection closed before|econnreset|socket hang up|fetch failed|other side closed/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A student's message, with the course context the browser would append (none: no course). */
export function userMessage(app, history, text) {
  const context = app.buildContext(app.getLibrary(), { courseId: null }, app.lastContextState(history));
  return {
    id: randomUUID(),
    role: "user",
    text,
    createdAt: Date.now(),
    ...(context ? { context: context.text, contextState: context.state } : {}),
  };
}

/** Text of a tool result as Ainsley read it. */
function resultText(result) {
  if (typeof result.content === "string") return result.content;
  return (result.content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
}

/**
 * Streams Ainsley's reply to `history` (ending with the student's message). Returns the reply as
 * the student sees it, the assistant message to append to the history, every tool call with its
 * outcome, and a status: done, truncated, refused, or error.
 */
export async function reply(app, { conversationId, history, signal }) {
  const started = Date.now();
  const base = app.toApiMessages(history, app.getLibrary());
  const turns = [];
  const tools = [];
  let text = "";
  let container = null;
  let status = "done";
  let error;
  let step = 0;
  let requests = 0;
  let retries = 0;

  for (; step < MAX_STEPS; step++) {
    const prefix = text;
    let stepText = "";
    let done = null;
    let streamError = null;
    const serverTools = new Map();

    try {
      requests++;
      await app.streamChat(
        { messages: [...base, ...turns], container },
        (event) => {
          switch (event.type) {
            case "text":
              stepText += event.text;
              text = prefix && stepText && !prefix.endsWith("\n") ? `${prefix}\n\n${stepText}` : prefix + stepText;
              break;
            case "tool":
              if (event.name === "web_search" || event.name === "web_fetch") {
                serverTools.set(event.id, { id: event.id, name: event.name, input: event.input, ok: true, detail: "" });
              }
              break;
            case "tool_result": {
              const call = serverTools.get(event.id);
              if (call) {
                call.ok = event.ok;
                call.detail = event.ok ? (event.count !== undefined ? `${event.count} results` : "done") : "Failed";
              }
              break;
            }
            case "done":
              done = event;
              break;
            case "error":
              streamError = event.message;
              break;
          }
        },
        signal,
      );
    } catch (err) {
      if (signal.aborted) throw err;
      streamError = err instanceof Error ? err.message : String(err);
    }

    if (streamError || !done) {
      // The Claude API failing or the connection dropping says nothing about Ainsley: retry the
      // request, which is safe because nothing from it joined the transcript.
      if (streamError && (TRANSIENT.test(streamError) || DROPPED.test(streamError)) && retries < MAX_RETRIES) {
        retries++;
        text = prefix;
        step--;
        await sleep(backoff(retries));
        continue;
      }
      status = "error";
      error = streamError ?? "The stream ended without a result.";
      break;
    }
    tools.push(...serverTools.values());
    turns.push({ role: "assistant", content: done.content });
    container = done.container ?? container;

    if (done.stopReason === "refusal") {
      status = "refused";
      break;
    }
    if (done.stopReason === "pause_turn") continue;
    if (done.stopReason === "tool_use") {
      const calls = done.content.filter((b) => b.type === "tool_use");
      if (calls.length === 0) break;
      const results = await Promise.all(
        calls.map(async (call) => {
          const outcome = await app.runTool(call, { courseId: null, conversationId, attachments: [] }, signal);
          tools.push({
            id: call.id,
            name: call.name,
            input: call.input,
            ok: outcome.ok,
            detail: outcome.detail,
            result: resultText(outcome.result),
          });
          return outcome.result;
        }),
      );
      turns.push({ role: "user", content: results });
      continue;
    }
    if (done.stopReason === "max_tokens") status = "truncated";
    break;
  }
  if (step === MAX_STEPS) status = "truncated";

  // As in use-chat.ts: a declined reply is dropped, and a failed one is kept as it stood.
  const finalTurns = status === "refused" ? [] : status === "error" ? turns : app.closeTurns(turns);
  const shown = status === "refused" ? "" : app.summarizeReply(finalTurns, app.getLibrary()).text || text;
  return {
    text: shown,
    status,
    error,
    tools,
    requests,
    retries,
    ms: Date.now() - started,
    message: {
      id: randomUUID(),
      role: "assistant",
      text: shown,
      turns: finalTurns,
      status,
      createdAt: Date.now(),
    },
  };
}
