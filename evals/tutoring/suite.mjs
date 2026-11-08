/**
 * Tutoring behavior: simulated students talk to the real /api/chat, the browser's tool loop runs
 * here (lib/chat.mjs), and a rubric judge labels each reply. `--suite judge` instead checks the
 * judge against hand-labelled replies.
 */
import { respond, userMessage } from "../lib/chat.mjs";
import { HarnessError } from "../lib/claude.mjs";
import { rate } from "../lib/stats.mjs";
import { CALIBRATION, observed } from "./calibration.mjs";
import { judge, replies, rubric } from "./judge.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { nextStudentMessage } from "./student.mjs";

export function tutoringJobs(app, { only, limit, reps, turns }) {
  const picked = SCENARIOS.filter((s) => !only || only.some((o) => s.id.startsWith(o))).slice(0, limit ?? Infinity);
  const jobs = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const s of picked) {
      jobs.push({
        suite: "tutoring",
        id: s.id,
        rep,
        faults: s.faults,
        run: (signal) => converse(app, s, rep, turns, signal),
      });
    }
  }
  return jobs;
}

async function converse(app, scenario, rep, maxTurns, signal) {
  const started = Date.now();
  const conversationId = `eval-${scenario.id}-${rep}`;
  let history = [];
  const turns = [];
  let student = { message: scenario.opener, includes_attempt: scenario.persona === "wrong_attempt", done: false };

  for (let t = 0; t < maxTurns; t++) {
    const message = userMessage(app, history, student.message);
    const r = await respond(app, { conversationId, history: [...history, message], signal });
    if (r.error) throw new HarnessError(`Ainsley's reply to message ${t + 1} failed: ${r.error}`);
    history = r.history;
    turns.push({ student: { text: student.message, includes_attempt: student.includes_attempt }, replies: r.replies });
    if (r.replies.some((x) => x.status === "refused") || t === maxTurns - 1) break;
    student = await nextStudentMessage(scenario, turns, signal);
    if (student.done) break;
  }

  // The app reviews each reply's help in the background: record what the last review found too.
  await app.reviewsSettled(conversationId);
  const stored = new Map(history.map((m) => app.withReview(m)).map((m) => [m.id, m.tutoring ?? null]));
  for (const t of turns) for (const r of t.replies) if (stored.has(r.id)) r.tutoring = stored.get(r.id);

  const labels = await judge(scenario, turns, signal);
  const scores = rubric(app, scenario, turns, labels);
  const yesNo = (v) => (v === null ? "n/a" : v ? "yes" : "no");
  const all = replies(turns);
  const tools = all.flatMap((r) => r.tools.map((c) => `${c.name}(${c.detail})`));
  const badges = all.map((r) => r.badge).filter(Boolean);
  let k = 0;
  return {
    records: [
      {
        suite: "tutoring",
        id: scenario.id,
        rep,
        persona: scenario.persona,
        topic: scenario.topic,
        faults: scenario.faults ?? null,
        rubric: scores,
        turns: turns.map((t) => ({ ...t, replies: t.replies.map((r) => ({ ...r, labels: labels[k++] })) })),
        ms: Date.now() - started,
      },
    ],
    line: [
      `${turns.length} turns`,
      tools.length ? tools.join(", ") : "no tools",
      ...(scores.corrections ? [`${scores.corrections} correction${scores.corrections === 1 ? "" : "s"}`] : []),
      ...(badges.length ? [`badges: ${badges.join(", ")}`] : []),
      `answer before attempt: ${yesNo(scores.answer_before_attempt)}`,
      `asked first: ${yesNo(scores.asked_attempt_first)}`,
      `skipped rungs: ${yesNo(scores.skipped_rungs)}`,
      `unchecked math: ${yesNo(scores.unchecked_math)}`,
      `not sure after failed check: ${yesNo(scores.said_not_sure)}`,
    ].join(" · "),
  };
}

export function tutoringMetrics(records) {
  const convos = records.filter((r) => r.suite === "tutoring");
  const metric = (key, label, better) => {
    const applicable = convos.filter((c) => c.rubric[key] !== null);
    return { label, ...rate(applicable.filter((c) => c.rubric[key]).length, applicable.length, better) };
  };
  return {
    "tutoring.answer_before_attempt": metric("answer_before_attempt", "Tutoring: gave the final answer before an attempt", "down"),
    "tutoring.asked_attempt_first": metric("asked_attempt_first", "Tutoring: asked for the attempt or plan first", "up"),
    "tutoring.skipped_rungs": metric("skipped_rungs", "Tutoring: skipped hint rungs", "down"),
    "tutoring.unchecked_math": metric("unchecked_math", "Tutoring: stated math without a check", "down"),
    "tutoring.unchecked_replies": {
      label: "Tutoring: replies stating math without a check",
      ...rate(
        convos.reduce((n, c) => n + c.rubric.replies_with_unchecked_math, 0),
        convos.reduce((n, c) => n + c.rubric.replies, 0),
        "down",
      ),
    },
    "tutoring.said_not_sure": metric("said_not_sure", 'Tutoring: said "I\'m not sure" when a check failed', "up"),
    "tutoring.wrong_math": metric("wrong_math", "Tutoring: stated wrong math", "zero"),
  };
}

/** What the app's own check of each finished reply's math found, across the conversations. */
export function tutoringAudits(records) {
  const out = {};
  for (const c of records.filter((r) => r.suite === "tutoring")) {
    for (const status of c.rubric.audits ?? []) out[status] = (out[status] ?? 0) + 1;
  }
  return out;
}

// ---------- Judge calibration ----------

export function judgeJobs({ only, reps }) {
  const picked = CALIBRATION.filter((c) => !only || only.some((o) => `judge-${c.id}`.startsWith(o)));
  const jobs = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const c of picked) {
      jobs.push({ suite: "judge", id: `judge-${c.id}`, rep, run: (signal) => calibrate(c, rep, signal) });
    }
  }
  return jobs;
}

async function calibrate(item, rep, signal) {
  const [label] = await judge(item.scenario, item.turns, signal);
  const fields = Object.entries(item.expect).map(([field, expected]) => {
    const got = observed(label, field);
    return { field, expected, got, agrees: got === expected };
  });
  const misses = fields.filter((f) => !f.agrees);
  return {
    records: [{ suite: "judge", id: `judge-${item.id}`, rep, fields, label }],
    line: misses.length
      ? `disagrees on ${misses.map((m) => `${m.field} (expected ${m.expected}, got ${m.got})`).join(", ")}`
      : `agrees on all ${fields.length} labels`,
  };
}

export function judgeMetrics(records) {
  const fields = records.filter((r) => r.suite === "judge").flatMap((r) => r.fields);
  return {
    "judge.agreement": {
      label: "Judge: agrees with hand labels",
      ...rate(fields.filter((f) => f.agrees).length, fields.length),
    },
  };
}
