/** The summary table for a run (and, with a previous run, its before/after columns). */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { formatRate, seconds, table, wilson } from "./stats.mjs";

const SECTIONS = [
  ["Principles 1–2: learning over answers, the student's thinking first", (k) => k.startsWith("tutoring.") && !/unchecked|not_sure|wrong/.test(k)],
  ["Principle 3: never wrong about math (solver, /api/solve)", (k) => k.startsWith("solver.") || k.startsWith("illposed.")],
  ["Principle 3: never wrong about math (checker, /api/evaluate)", (k) => k.startsWith("checker.")],
  ["Principle 3: never wrong about math (in tutoring)", (k) => k.startsWith("tutoring.") && /unchecked|not_sure|wrong/.test(k)],
  ["Rubric judge", (k) => k.startsWith("judge.")],
];

const readJsonl = (file) => {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

/** A saved run: its summary, and its records and errors when they're there. */
export function loadRun(p) {
  const dir = statSync(p).isDirectory() ? p : path.dirname(p);
  const summary = JSON.parse(readFileSync(statSync(p).isDirectory() ? path.join(p, "summary.json") : p, "utf8"));
  return { summary, records: readJsonl(path.join(dir, "records.jsonl")), errors: readJsonl(path.join(dir, "errors.jsonl")) };
}

function delta(now, before) {
  if (!before?.n || !now.n) return ["", ""];
  const was = formatRate(before);
  const diff = Math.round((now.k / now.n - before.k / before.n) * 100);
  if (diff === 0) return [was, "±0"];
  const [lo1, hi1] = wilson(before.k, before.n);
  const [lo2, hi2] = wilson(now.k, now.n);
  const noise = lo2 <= hi1 && lo1 <= hi2;
  const good = now.better === "up" ? diff > 0 : now.better === "down" || now.better === "zero" ? diff < 0 : null;
  const verdict = noise ? "within noise" : good === null ? "" : good ? "better" : "worse";
  return [was, `${diff > 0 ? "+" : ""}${diff} pts${verdict ? ` (${verdict})` : ""}`];
}

/** Cases behind the bad numbers, so each leads straight to its transcript in records.jsonl. */
function casesToLook(records, errors) {
  const look = [];
  for (const r of records) {
    if (r.suite === "solver" && !r.correct) {
      look.push(`solver ${r.id}: ${r.status === "verified" ? "marked Verified but wrong" : `wrong (${r.status})`}: ${r.parts.map((p) => p.shown || "no answer").join("; ")}`);
    }
    if (r.suite === "ill-posed" && !r.flagged) look.push(`ill-posed ${r.id}: came back Verified though it's ${r.flaw}`);
    if (r.suite === "checker" && r.expect === "error" && r.verdict === "correct") look.push(`checker ${r.id}: planted error marked correct`);
    if (r.suite === "checker" && r.expect === "error" && r.verdict !== "correct" && !r.located) {
      look.push(`checker ${r.id}: first error found at step ${r.firstErrorStep ?? "none"}, planted at ${r.errorSteps.join(" or ")}`);
    }
    if (r.suite === "checker" && r.expect === "correct" && r.verdict !== "correct") look.push(`checker ${r.id}: correct work marked ${r.verdict}`);
    if (r.suite === "tutoring") {
      const s = r.rubric;
      const issues = [
        s.answer_before_attempt && "gave the answer before an attempt",
        s.asked_attempt_first === false && "didn't ask for an attempt first",
        s.skipped_rungs && "skipped rungs",
        s.unchecked_math && `unchecked math in ${s.replies_with_unchecked_math}/${s.replies} replies`,
        s.said_not_sure === false && "didn't say it wasn't sure after a failed check",
        s.wrong_math && "wrong math",
      ].filter(Boolean);
      if (issues.length) look.push(`tutoring ${r.id}${r.rep > 1 ? ` #${r.rep}` : ""}: ${issues.join(", ")}`);
    }
    if (r.suite === "judge") {
      for (const f of r.fields.filter((x) => !x.agrees)) look.push(`judge ${r.id}: ${f.field} expected ${f.expected}, got ${f.got}`);
    }
  }
  for (const e of errors) look.push(`${e.suite} ${e.id}: not scored (${e.kind}): ${e.message}`);
  return look;
}

/** The report as text: header, the metrics table by principle, statuses, and cases to look at. */
export function renderReport({ summary, records = [], errors = [], previous = null }) {
  const { meta, metrics, statuses } = summary;
  const lines = [meta.header];
  const requests = Object.entries(meta.appRequests ?? {}).map(([r, n]) => `${r} ×${n}`).join(", ") || "none";
  lines.push(
    `${meta.cases - meta.notScored} of ${meta.cases} cases scored in ${seconds(meta.durationMs)}` +
      `${meta.notScored ? ` · ${meta.notScored} not scored (infra; excluded)` : ""}` +
      ` · app requests: ${requests} · harness's own Claude calls ≈ $${meta.harnessUsage.cost.toFixed(2)}`,
  );
  const fallbacks = (meta.harnessUsage.models ?? []).filter((m) => m !== "claude-opus-5-5");
  if (fallbacks.length) lines.push(`Some of the harness's own calls were served by ${fallbacks.join(", ")} (a safety fallback).`);
  if (previous) lines.push(`Before: ${previous.meta.header}`);
  lines.push("");

  // One table, so every section's columns line up; section titles go between its rows.
  const sections = SECTIONS.map(([title, test]) => ({ title, keys: Object.keys(metrics).filter(test) })).filter((s) => s.keys.length);
  const rows = sections.flatMap((s) =>
    s.keys.map((key) => {
      const m = metrics[key];
      const flag = m.better === "zero" && m.k > 0 ? "  ⚠ must be 0" : "";
      return [`  ${m.label}`, `${formatRate(m)}${flag}`, ...(previous ? delta(m, previous.metrics[key]) : [])];
    }),
  );
  if (previous) rows.unshift(["", "now", "before", "change"]);
  const rendered = table(rows).split("\n");
  if (previous) lines.push(rendered.shift());
  for (const s of sections) lines.push(s.title, ...rendered.splice(0, s.keys.length), "");

  if (statuses) {
    const show = (t) => Object.entries(t).map(([k, n]) => `${k} ${n}`).join(" · ") || "—";
    if (statuses.solver) lines.push(`Solver statuses: ${show(statuses.solver)}`);
    if (statuses.illPosed) lines.push(`Ill-posed statuses: ${show(statuses.illPosed)}`);
    if (statuses.checkerVerdicts) lines.push(`Checker verdicts: ${show(statuses.checkerVerdicts)}`);
    if (statuses.replyAudits) lines.push(`App's check of each reply's math: ${show(statuses.replyAudits)}`);
    if (Object.keys(statuses).length) lines.push("");
  }

  const look = casesToLook(records, errors);
  if (look.length) lines.push("Cases to look at:", ...look.map((l) => `  - ${l}`), "");
  return lines.join("\n");
}
