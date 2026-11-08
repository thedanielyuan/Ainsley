#!/usr/bin/env node
/**
 * Measures Ainsley against its three guiding principles, end to end, against a running app.
 * Usage: npm run eval -- [--suite math,tutoring,judge] [--only id,...] [--limit n] [--reps n]
 *        [--turns n] [--concurrency n] [--url http://localhost:3000] [--out dir] [--compare dir]
 *        npm run eval -- --report dir [--compare dir]   (re-print a saved run; no API calls)
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
import { judgeJobs, judgeMetrics, tutoringJobs, tutoringMetrics } from "./tutoring/suite.mjs";

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
    help: { type: "boolean", short: "h" },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 8).join("\n").replace(/^ \*\/? ?/gm, ""));
  process.exit(0);
}

const previous = args.compare ? loadRun(args.compare).summary : null;

if (args.report) {
  console.log(renderReport({ ...loadRun(args.report), previous }));
  process.exit(0);
}

const suites = args.suite === "all" ? SUITES : args.suite.split(",").map((s) => s.trim());
for (const s of suites) if (!SUITES.includes(s)) fail(`Unknown suite "${s}". Use ${SUITES.join(", ")} or all.`);
const int = (v, name, min = 1) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) fail(`--${name} must be a whole number of at least ${min}.`);
  return n;
};
const options = {
  only: args.only ? args.only.split(",").map((s) => s.trim()).filter(Boolean) : null,
  limit: args.limit ? int(args.limit, "limit") : undefined,
  reps: int(args.reps, "reps"),
  turns: int(args.turns, "turns"),
};
const concurrency = int(args.concurrency, "concurrency");

// ---------- Offline self-test of the answer key: free, and catches a typo before a paid run ----------

for (const p of PROBLEMS) {
  const oracle = p.answers.map((a) => ({ part: a.part, answer: a.value, sympy: a.value }));
  const planted = Object.entries(p.planted.final).map(([part, sympy]) => ({ part, answer: sympy, sympy }));
  if (gradeAnswers(p.answers, oracle).correct !== true) fail(`Answer key self-test: ${p.id}'s expected answers don't grade as correct.`);
  if (gradeAnswers(p.answers, planted).correct !== false) fail(`Answer key self-test: ${p.id}'s planted answer doesn't grade as wrong.`);
}

// ---------- Run ----------

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
    " Each case calls Claude, so this takes a while and costs real money.\n",
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

// ---------- Summary ----------

const { statuses = null, ...mathRates } = suites.includes("math") ? mathMetrics(records) : {};
const metrics = {
  ...(suites.includes("tutoring") ? tutoringMetrics(records) : {}),
  ...mathRates,
  ...(suites.includes("judge") ? judgeMetrics(records) : {}),
};

function commit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean).length;
    return { sha, dirty };
  } catch {
    return { sha: "unknown", dirty: 0 };
  }
}

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
  metrics,
  statuses,
};
const report = renderReport({ summary, records, errors, previous });
console.log(`\n${report}`);

const stamp = new Date(started).toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(args.out ?? path.join(ROOT, "evals", "results", stamp));
mkdirSync(outDir, { recursive: true });
const jsonl = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");
writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(path.join(outDir, "summary.md"), `\`\`\`\n${report}\n\`\`\`\n`);
writeFileSync(path.join(outDir, "records.jsonl"), jsonl(records));
writeFileSync(path.join(outDir, "errors.jsonl"), jsonl(errors));
const shown = path.relative(process.cwd(), outDir);
console.log(`Results: ${shown.startsWith("..") ? outDir : shown} (summary.md, summary.json, records.jsonl with every transcript, errors.jsonl)`);

// Keep-alive sockets to the dev server and the API would otherwise hold the process open.
process.exit(errors.length === jobs.length ? 1 : 0);
