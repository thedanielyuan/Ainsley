import { readTextFields } from "./answer-check";
import type { SolutionAnswer, SolutionStatus, SolutionStep, SolvePurpose, VerifiedSolution } from "./types";

/**
 * Shared by the browser (which runs Ainsley's solve_problem calls and saves the solutions),
 * /api/solve (which works problems out) and /api/evaluate (which checks a student's work against
 * a solution): the tool's input, a solution's shape, and how each reader sees it.
 */

export interface SolveInput {
  problem: string;
  reference?: string;
  course_expectations?: string;
}

const LIMITS: Record<keyof SolveInput, number> = {
  problem: 20_000,
  reference: 40_000,
  course_expectations: 5_000,
};

/** How each status reads in the timeline above a reply. */
export const SOLUTION_LABELS: Record<SolutionStatus, string> = {
  verified: "Verified",
  disputed: "Not verified",
  cannot_solve: "Couldn't solve",
};

/** Validates solve_problem's input, or says what's wrong. */
export function parseSolveInput(raw: unknown): SolveInput | string {
  const out = readTextFields(raw, LIMITS);
  if (typeof out === "string") return out;
  if (!out.problem) return "`problem` must be the problem exactly as the student was given it.";
  return out as SolveInput;
}

const PURPOSES: readonly SolvePurpose[] = ["guide", "example", "practice"];

/** What a solve_problem call says it's for, if it says (the solvers never see it). */
export function solvePurpose(raw: unknown): SolvePurpose | undefined {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>).purpose : undefined;
  return PURPOSES.find((p) => p === value);
}

// ---------- Shape ----------

const STATUSES: SolutionStatus[] = ["verified", "disputed", "cannot_solve"];
const REFERENCE = ["agrees", "disagrees", "none"] as const;
const MAX_ITEMS = 60;

const str = (v: unknown, max = 20_000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function readAnswers(v: unknown): SolutionAnswer[] {
  return list(v)
    .filter(isObject)
    .map((a) => ({ part: str(a.part, 200), answer: str(a.answer), sympy: str(a.sympy, 2_000) }))
    .filter((a) => a.answer);
}

export function readSteps(v: unknown): SolutionStep[] {
  return list(v)
    .filter(isObject)
    .map((s) => ({ step: str(s.step), why: str(s.why) }))
    .filter((s) => s.step);
}

export function readStrings(v: unknown): string[] {
  return list(v)
    .map((s) => str(s))
    .filter(Boolean);
}

/** Checks a solution's shape (from a request, or this device's storage); null if it isn't one. */
export function parseSolution(raw: unknown): VerifiedSolution | null {
  if (!isObject(raw)) return null;
  const status = STATUSES.find((v) => v === raw.status);
  if (!status) return null;
  return {
    status,
    answers: readAnswers(raw.answers),
    method: str(raw.method),
    steps: readSteps(raw.steps),
    keyIdeas: readStrings(raw.keyIdeas),
    assumptions: str(raw.assumptions),
    verification: str(raw.verification),
    reference: REFERENCE.find((v) => v === raw.reference) ?? "none",
    referenceIssue: str(raw.referenceIssue),
    doubt: str(raw.doubt),
  };
}

// ---------- How it reads ----------

function answerLines(s: VerifiedSolution, withSympy: boolean): string[] {
  const line = (a: SolutionAnswer) =>
    `${a.part ? `${a.part} ` : ""}${a.answer}${withSympy && a.sympy ? `  [sympy: ${a.sympy}]` : ""}`;
  if (s.answers.length === 0) return [];
  if (s.answers.length === 1 && !s.answers[0].part) return [`Answer: ${line(s.answers[0])}`];
  return ["Answers:", ...s.answers.map((a) => `- ${line(a)}`)];
}

function workingLines(s: VerifiedSolution): string[] {
  const lines: string[] = [];
  if (s.method) lines.push(`Method: ${s.method}`);
  if (s.steps.length) lines.push("Steps:", ...s.steps.map((x, i) => `${i + 1}. ${x.step}${x.why ? ` — ${x.why}` : ""}`));
  if (s.keyIdeas.length) lines.push("What a complete answer needs:", ...s.keyIdeas.map((k) => `- ${k}`));
  if (s.assumptions) lines.push(`Assumptions: ${s.assumptions}`);
  return lines;
}

/** The solution as Ainsley reads it in solve_problem's result. */
export function formatSolution(id: string, s: VerifiedSolution): string {
  if (s.status === "cannot_solve") {
    return [
      `The solvers couldn't solve this problem${s.doubt ? `: ${s.doubt}` : "."}`,
      "",
      "Tell the student what's missing or what doesn't add up, and ask for the full problem as they were given it (a value may have been copied wrong) before going on. Don't answer it from the givens that do agree.",
    ].join("\n");
  }

  const lines = [`Solution (for you; the student doesn't see this). Problem id: ${id}`];
  if (s.status === "verified") {
    lines.push(`Verified. ${s.verification}`.trim());
  } else {
    lines.push(
      `NOT verified: the solvers disagreed${s.doubt ? ` (${s.doubt})` : ""}. The answer below is the more likely one, not a settled one.`,
    );
  }
  if (s.reference === "agrees") lines.push("It agrees with the answer key from their materials.");
  if (s.reference === "disagrees") {
    lines.push(`It disagrees with the answer key from their materials${s.referenceIssue ? `: ${s.referenceIssue}` : "."}`);
  } else if (s.referenceIssue) {
    lines.push(`Problem with the question or the answer key: ${s.referenceIssue}`);
  }
  lines.push(...answerLines(s, false), ...workingLines(s));
  lines.push(
    "",
    s.status === "verified"
      ? "Use it to guide the student, not to hand it over: it tells you where the problem is going, so give them the next step they need and keep the answer back until they've had a real go."
      : "Tell the student, in those words, that you're not sure of the answer to this one (\"I'm not sure …\"), and what couldn't be verified (above). Don't settle it yourself: check_math can confirm computations, not that the method is right, so say you're not sure however your own checks come out. Guide them by the method, judge their reasoning on its own merits, and tell them if the problem looks ambiguous.",
    `When they attempt it, pass problem_id "${id}" to evaluate_answer.`,
  );
  return lines.join("\n");
}

/** The solution as the answer checker reads it: with machine-checkable answers, and whether to rely on it. */
export function solutionForChecker(s: VerifiedSolution): string {
  const head =
    s.status === "verified"
      ? `Verified: ${s.verification || "two solvers working independently agreed."}`
      : `Not verified: the solvers disagreed${s.doubt ? ` (${s.doubt})` : ""}. Rely on your own work.`;
  return [head, ...answerLines(s, true), ...workingLines(s)].join("\n");
}
