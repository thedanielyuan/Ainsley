/**
 * Ainsley's replies, produced the way the browser produces them. This mirrors src/lib/use-chat.ts
 * (a React hook, so it can't be imported): `generate` for a reply (the tutoring policy for the
 * turn, then requests to /api/chat with tool calls run through the app's own runTool, pause_turn
 * resumed, the transcript replayed append-only, and a review of the help it gave), `auditReply`
 * for the check of a finished reply's math, and the effect that posts a correction when that
 * check finds a false claim. Everything else (tool code, history building, the policy, the review,
 * the check) is the app's own code, loaded by app.mjs.
 *
 * If you change that loop or what the browser sends to /api/chat, change this to match, or the
 * evals measure an app that no longer exists.
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
 * One reply to `input`: the conversation ending with the student's message, or (with
 * `correction`) with the reply the app asked Ainsley to correct. Returns the conversation before
 * the reply as the browser stores it (the student's message now carries the turn's policy), the
 * reply as stored and as shown, its tool calls, and a status: done, truncated, refused or error.
 */
export async function reply(app, { conversationId, input, correction, signal }) {
  const started = Date.now();
  // The tutoring policy for this turn, once the last reply's review is in.
  await app.reviewsSettled(conversationId);
  let history = input.map(app.withReview);
  const tutor = new app.TurnTutor(history);
  const student = history.at(-1);
  if (student?.role === "user" && (student.policy ?? null) !== tutor.policy) {
    history = [...history.slice(0, -1), { ...student, policy: tutor.policy ?? undefined }];
  }
  const base = app.toApiMessages(history, app.getLibrary());
  if (correction) base.push(...app.correctionPrefix(correction));

  const turns = [];
  const tools = [];
  // The timeline's entries for tool calls, which the check of the reply's math reads.
  const activity = [];
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
      const outcomes = await Promise.all(
        calls.map(async (call) => {
          const outcome = await app.runTool(call, { courseId: null, conversationId, attachments: [] }, signal);
          const item = app.toolActivity(call.name, call.input ?? {}, call.id);
          if (item) activity.push({ ...item, status: outcome.ok ? "done" : "error", detail: outcome.detail });
          return outcome;
        }),
      );
      // A simulation appears where Ainsley showed it, after what it wrote before the call.
      calls.forEach((call, i) => {
        if (call.name !== app.SIMULATION_TOOL || !outcomes[i].ok) return;
        if (text && !text.endsWith("\n")) text += "\n\n";
        text += `${app.simulationMarker(call.input)}\n`;
      });
      // Solving and answer checks move the tutoring policy on; their results carry it.
      const results = outcomes.map((o, i) => tutor.afterTool(calls[i].name, o));
      calls.forEach((call, i) => {
        tools.push({
          id: call.id,
          name: call.name,
          input: call.input,
          ok: outcomes[i].ok,
          detail: outcomes[i].detail,
          result: resultText(results[i]),
        });
      });
      turns.push({ role: "user", content: results });
      continue;
    }
    if (done.stopReason === "max_tokens") status = "truncated";
    break;
  }
  if (step === MAX_STEPS) status = "truncated";

  // A correction is the app's follow-up to a math check, not help on the tutoring ladder.
  const tutoring = status === "refused" ? undefined : tutor.record(!correction);
  // As in use-chat.ts: a declined reply is dropped, and a failed one is kept as it stood.
  const finalTurns = status === "refused" ? [] : status === "error" ? turns : app.closeTurns(turns);
  let shown = "";
  if (status === "error") shown = app.withoutSimulations(text);
  else if (status !== "refused") shown = app.summarizeReply(finalTurns, app.getLibrary()).text || app.withoutSimulations(text);
  const message = {
    id: randomUUID(),
    role: "assistant",
    text: shown,
    turns: finalTurns,
    status,
    createdAt: Date.now(),
    ...(correction ? { correction } : {}),
    ...(tutoring ? { tutoring } : {}),
  };

  // The review of what it was about and the help it gave: on the problem in progress, or on a new
  // one the student brought.
  const problem = tutor.focus();
  const finished = status === "done" || status === "truncated";
  if (finished && !correction && tutoring && shown.trim()) {
    app.startReview({
      conversationId,
      replyId: message.id,
      problem: problem ? { id: problem.id, text: problem.problem, solved: problem.verdict === "correct" } : null,
      allowed: tutoring.allowed,
      attempted: Boolean(problem && problem.attempts > 0),
      reply: shown,
      history,
      onReviewed: (fields) => {
        message.tutoring = { ...message.tutoring, ...fields };
      },
    });
  }

  return {
    history,
    message,
    text: shown,
    status,
    error,
    tools,
    activity,
    // The finished reply's text, when it has math the app checks.
    toAudit: finished && app.containsMath(shown) ? shown : null,
    requests,
    retries,
    ms: Date.now() - started,
  };
}

/** The check of a finished reply's math (auditReply in use-chat.ts): its status and claims. */
async function audit(app, r, signal) {
  try {
    const checked = await app.checkReply(r.history, r.toAudit, signal);
    const claims = [...checked, ...app.unsettledAnswers(r.activity)];
    return { status: app.auditStatus(claims), claims };
  } catch (err) {
    if (signal.aborted) throw err;
    // A check that can't run leaves the math unverified, never verified.
    return { status: "failed", claims: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** A reply as the evals record it: what the student saw, and what ran behind it. */
function shownReply(app, r, kind) {
  return {
    id: r.message.id,
    kind,
    text: r.text,
    status: r.status,
    tools: r.tools,
    audit: r.audit ?? null,
    // What the student sees beside the reply: "Math checked", "Not verified", or nothing.
    badge: r.audit ? app.auditLabel(r.audit.status) : null,
    tutoring: r.message.tutoring ?? null,
    policy: kind === "reply" ? (r.history.at(-1)?.policy ?? null) : null,
    ms: r.ms,
    requests: r.requests,
    retries: r.retries,
  };
}

async function audited(app, r, signal) {
  if (!r.toAudit) return;
  r.audit = await audit(app, r, signal);
  r.message.audit = { status: r.audit.status, claims: r.audit.claims };
}

/**
 * Everything the app does after a student's message: Ainsley's reply, the check of its math once
 * it's finished, and, when that check finds a false claim, the correction the app asks for. (The
 * browser posts the correction once the chat is idle; here the student waits for it.) Returns the
 * conversation as stored afterwards and the replies the student saw, or the error that stopped it.
 */
export async function respond(app, { conversationId, history, signal }) {
  const first = await reply(app, { conversationId, input: history, signal });
  if (first.status === "error") return { error: first.error };
  await audited(app, first, signal);
  let conversation = [...first.history, first.message];
  const replies = [shownReply(app, first, "reply")];

  if (first.audit?.status === "wrong") {
    const index = conversation.length - 1;
    const request = app.correctionRequest(first.audit.claims, first.message.text, true);
    conversation = conversation.map((m, i) => (i === index ? { ...m, audit: { ...m.audit, corrected: true } } : m));
    const fix = await reply(app, { conversationId, input: conversation, correction: { of: first.message.id, ...request }, signal });
    if (fix.status === "error") return { error: fix.error };
    await audited(app, fix, signal);
    conversation = [...fix.history, fix.message];
    replies.push(shownReply(app, fix, "correction"));
  }
  return { history: conversation, replies };
}
