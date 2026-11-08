#!/usr/bin/env node
/**
 * Measures Ainsley against its three guiding principles, end to end, against a running app.
 * Usage: npm run eval -- [--suite math,tutoring,judge] [--only id,...] [--limit n] [--reps n]
 *        [--turns n] [--concurrency n] [--url http://localhost:3000] [--out dir] [--compare dir]
 *        npm run eval -- --report dir [--compare dir]   (re-print a saved run; no API calls)
 *        npm run eval -- --rejudge dir [--out dir]      (re-score a saved run's conversations)
 * See evals/README.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkServer, loadApp, newTrial, trials } from "./lib/app.mjs";
import { HarnessError, harnessUsage } from "./lib/claude.mjs";
import { gradeAnswers } from "./lib/math-grade.mjs";
import { loadRun, renderReport } from "./lib/report.mjs";
import { pool, seconds } from "./lib/stats.mjs";
import { PROBLEMS } from "./math/problems.mjs";
import { mathJobs, mathMetrics } from "./math/suite.mjs";
import { judge, rubric } from "./tutoring/judge.mjs";
import { SCENARIOS } from "./tutoring/scenarios.mjs";
import { judgeJobs, judgeMetrics, tutoringAudits, tutoringJobs, tutoringMetrics } from "./tutoring/suite.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUITES = ["math", "tutoring", "judge"];
const JOB_LIMIT_MS = 60 * 60_000;

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: process.env.AINSLEY_EVAL_URL ?? process.env.AINSLEY_TEST_URL ?? "http://localhost:3000" },
    suite: { type: "string", default: "math,tutoring" },
    only: { type: "string" },
    limit: { type: "string" },
    reps: { type: "string", default: "1" },
    turns: { type: "string", default: "4" },
    concurrency: { type: "string", default: "4" },
    out: { type: "string" },
    compare: { type: "string" },
    report: { type: "string" },
    rejudge: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 9).join("\n").replace(/^ \*\/? ?/gm, ""));
  process.exit(0);
}

const int = (v, name, min = 1) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) fail(`--${name} must be a whole number of at least ${min}.`);
  return n;
};
const concurrency = int(args.concurrency, "concurrency");
const previous = args.compare ? loadRun(args.compare).summary : null;

// ---------- Summaries and files, shared by a run and a re-score ----------

function commit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean).length;
    return { sha, dirty };
  } catch {
    return { sha: "unknown", dirty: 0 };
  }
}

/** The metrics and status tallies for whichever suites the records cover. */
function score(records, suites) {
  const { statuses: mathStatuses = null, ...mathRates } = suites.includes("math") ? mathMetrics(records) : {};
  return {
    metrics: {
      ...(suites.includes("tutoring") ? tutoringMetrics(records) : {}),
      ...mathRates,
      ...(suites.includes("judge") ? judgeMetrics(records) : {}),
    },
    statuses: {
      ...mathStatuses,
      ...(suites.includes("tutoring") ? { replyAudits: tutoringAudits(records) } : {}),
    },
  };
}

function save(outDir, summary, records, errors) {
  const report = renderReport({ summary, records, errors, previous });
  console.log(`\n${report}`);
  mkdirSync(outDir, { recursive: true });
  const jsonl = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");
  writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(outDir, "summary.md"), `\`\`\`\n${report}\n\`\`\`\n`);
  writeFileSync(path.join(outDir, "records.jsonl"), jsonl(records));
  writeFileSync(path.join(outDir, "errors.jsonl"), jsonl(errors));
  const shown = path.relative(process.cwd(), outDir);
  console.log(`Results: ${shown.startsWith("..") ? outDir : shown} (summary.md, summary.json, records.jsonl with every transcript, errors.jsonl)`);
}

// ---------- Re-print, or re-score, a saved run ----------

if (args.report) {
  console.log(renderReport({ ...loadRun(args.report), previous }));
  process.exit(0);
}

if (args.rejudge) {
  // The judge or rubric changed: label the saved conversations again, so runs from before the
  // change stay comparable. Nothing is sent to the app; math records are kept as they were.
  const saved = loadRun(args.rejudge);
  const app = await loadApp(args.url);
  const started = Date.now();
  const kept = saved.records.filter((r) => r.suite !== "tutoring");
  const errors = [...saved.errors];
  const convos = saved.records.filter((r) => r.suite === "tutoring");
  console.log(`Re-scoring ${convos.length} conversations from ${args.rejudge} with the current judge and rubric.`);
  const rescored = await pool(convos, concurrency, async (r) => {
    const scenario = SCENARIOS.find((s) => s.id === r.id);
    if (!scenario) {
      errors.push({ suite: "tutoring", id: r.id, rep: r.rep, kind: "harness", message: "No scenario with this id any more." });
      return null;
    }
    // Runs from before corrections existed stored one reply per turn as `ainsley`.
    const turns = r.turns.map((t) => ({
      student: t.student,
      replies: t.replies ?? [{ kind: "reply", ...t.ainsley, audit: null, badge: null }],
    }));
    try {
      const labels = await judge(scenario, turns, AbortSignal.timeout(JOB_LIMIT_MS));
      let k = 0;
      const out = turns.map((t) => ({ ...t, replies: t.replies.map((reply) => ({ ...reply, labels: labels[k++] })) }));
      console.log(`  ${r.id}${r.rep > 1 ? ` #${r.rep}` : ""} re-scored`);
      return { ...r, rubric: rubric(app, scenario, turns, labels), turns: out };
    } catch (err) {
      errors.push({ suite: "tutoring", id: r.id, rep: r.rep, kind: "harness", message: String(err?.message ?? err) });
      return null;
    }
  });
  const records = [...kept, ...rescored.filter(Boolean)];
  const { sha, dirty } = commit();
  const { metrics, statuses } = score(records, saved.summary.meta.suites);
  const summary = {
    meta: {
      ...saved.summary.meta,
      header: `${saved.summary.meta.header} · re-scored with the judge at ${sha}${dirty ? ` (+${dirty} uncommitted)` : ""}`,
      notScored: errors.length,
      rescoredAt: new Date(started).toISOString(),
      harnessUsage: harnessUsage(),
    },
    metrics,
    statuses,
  };
  save(path.resolve(args.out ?? `${path.resolve(args.rejudge)}-rejudged`), summary, records, errors);
  process.exit(0);
}

// ---------- Run ----------

const suites = args.suite === "all" ? SUITES : args.suite.split(",").map((s) => s.trim());
for (const s of suites) if (!SUITES.includes(s)) fail(`Unknown suite "${s}". Use ${SUITES.join(", ")} or all.`);
const options = {
  only: args.only ? args.only.split(",").map((s) => s.trim()).filter(Boolean) : null,
  limit: args.limit ? int(args.limit, "limit") : undefined,
  reps: int(args.reps, "reps"),
  turns: int(args.turns, "turns"),
};

// Offline self-test of the answer key: free, and catches a typo before a paid run.
for (const p of PROBLEMS) {
  const oracle = p.answers.map((a) => ({ part: a.part, answer: a.value, sympy: a.value }));
  const planted = Object.entries(p.planted.final).map(([part, sympy]) => ({ part, answer: sympy, sympy }));
  if (gradeAnswers(p.answers, oracle).correct !== true) fail(`Answer key self-test: ${p.id}'s expected answers don't grade as correct.`);
  if (gradeAnswers(p.answers, planted).correct !== false) fail(`Answer key self-test: ${p.id}'s planted answer doesn't grade as wrong.`);
}

const started = Date.now();
const app = await loadApp(args.url);
if (suites.some((s) => s !== "judge")) await checkServer(args.url);

const jobs = [
  ...(suites.includes("math") ? mathJobs(options) : []),
  ...(suites.includes("tutoring") ? tutoringJobs(app, options) : []),
  ...(suites.includes("judge") ? judgeJobs(options) : []),
];
if (jobs.length === 0) fail("No cases match. Check --only and --suite.");

const stop = new AbortController();
process.once("SIGINT", () => {
  console.log("\nStopping: finishing the report with the cases done so far (Ctrl-C again to quit now).");
  stop.abort(new Error("Stopped by the user."));
  process.once("SIGINT", () => process.exit(130));
});

console.log(
  `Ainsley evals: ${jobs.length} case${jobs.length === 1 ? "" : "s"} (${suites.join(", ")}) against ${args.url}, ${concurrency} at a time.` +
    " Each case calls Ainsley AI's models, so this takes a while and costs real money.\n",
);

let finished = 0;
let lastReport = Date.now();
const heartbeat = setInterval(() => {
  if (Date.now() - lastReport < 120_000) return;
  lastReport = Date.now();
  console.log(`  … ${finished}/${jobs.length} done, ${seconds(Date.now() - started)} so far`);
}, 30_000);

const outcomes = await pool(jobs, concurrency, async (job) => {
  const t = Date.now();
  const name = `${job.suite} ${job.id}${options.reps > 1 ? ` #${job.rep}` : ""}`;
  const trial = newTrial(`${job.suite}:${job.id}:${job.rep}`, job.faults);
  try {
    if (stop.signal.aborted) throw stop.signal.reason;
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(JOB_LIMIT_MS)]);
    const out = await trials.run(trial, () => job.run(signal));
    finished++;
    lastReport = Date.now();
    console.log(`[${finished}/${jobs.length}] ${name} (${seconds(Date.now() - t)}): ${out.line}`);
    // The case's requests to the app ride on its first record.
    return { records: out.records.map((r, i) => (i === 0 ? { ...r, requests: trial.requests } : r)), errors: [] };
  } catch (err) {
    finished++;
    lastReport = Date.now();
    const kind = stop.signal.aborted ? "stopped" : err?.name === "TimeoutError" ? "timeout" : err instanceof HarnessError ? "harness" : "error";
    console.log(`[${finished}/${jobs.length}] ${name}: NOT SCORED (${kind}): ${err?.message ?? err}`);
    return { records: [], errors: [{ suite: job.suite, id: job.id, rep: job.rep, kind, message: String(err?.message ?? err), requests: trial.requests }] };
  }
});
clearInterval(heartbeat);

const records = outcomes.flatMap((o) => o.records);
const errors = outcomes.flatMap((o) => o.errors);
const appRequests = {};
for (const o of outcomes) {
  for (const q of o.records[0]?.requests ?? o.errors[0]?.requests ?? []) appRequests[q.route] = (appRequests[q.route] ?? 0) + 1;
}

const { sha, dirty } = commit();
const summary = {
  meta: {
    header: `Ainsley evals · ${args.url} · ${new Date(started).toISOString().slice(0, 16).replace("T", " ")} UTC · harness at ${sha}${dirty ? ` (+${dirty} uncommitted)` : ""}`,
    url: args.url,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    commit: sha,
    uncommittedFiles: dirty,
    suites,
    options: { ...options, concurrency },
    cases: jobs.length,
    notScored: errors.length,
    appRequests,
    harnessUsage: harnessUsage(),
  },
  ...score(records, suites),
};
const stamp = new Date(started).toISOString().replace(/[:.]/g, "-").slice(0, 19);
save(path.resolve(args.out ?? path.join(ROOT, "evals", "results", stamp)), summary, records, errors);

// Keep-alive sockets to the dev server and the API would otherwise hold the process open.
process.exit(errors.length === jobs.length ? 1 : 0);
