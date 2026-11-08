import { readTextFields } from "./answer-check";
import { SOLUTION_LABELS } from "./solution";
import type { Activity, AuditStatus, CheckedClaim, ClaimStatus, MathClaim } from "./types";

/**
 * Shared by the browser (which runs Ainsley's check_math calls and the check of each finished
 * reply) and /api/check and /api/audit (which check claims by running code): the tool's input,
 * how Ainsley reads the verdicts, and what the timeline shows of them.
 */

export interface CheckInput {
  claims: MathClaim[];
  /** What the symbols mean: domains, units, definitions from the problem. */
  assumptions?: string;
}

export const MAX_CLAIMS = 25;

const CLAIM_LIMITS = { claim: 2_000, sympy: 2_000, value: 1_000 };

/** Validates check_math's input (or an extracted list of claims), or says what's wrong. */
export function parseCheckInput(raw: unknown): CheckInput | string {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(input.claims) || input.claims.length === 0) {
    return "`claims` must list at least one claim, each with its sympy form and claimed value.";
  }
  if (input.claims.length > MAX_CLAIMS) return `Check at most ${MAX_CLAIMS} claims at a time.`;

  const claims: MathClaim[] = [];
  for (const [i, item] of input.claims.entries()) {
    const fields = readTextFields(item, CLAIM_LIMITS);
    if (typeof fields === "string") return `Claim ${i + 1}: ${fields}`;
    if (!fields.claim) return `Claim ${i + 1} needs \`claim\`: the statement as you'll write it.`;
    claims.push({ claim: fields.claim, sympy: fields.sympy ?? "", value: fields.value ?? "" });
  }
  const rest = readTextFields(input, { assumptions: 3_000 });
  if (typeof rest === "string") return rest;
  return { claims, ...(rest.assumptions ? { assumptions: rest.assumptions } : {}) };
}

// ---------- check_math, as Ainsley and the timeline see it ----------

/** How a check_math call reads in the timeline: worst verdict first. */
export function checkLabel(claims: CheckedClaim[]): string {
  if (claims.some((c) => c.status === "false")) return "Caught an error";
  if (claims.some((c) => c.status === "cannot_check")) return "Not verified";
  return "Verified";
}

const STATUS_WORDS: Record<ClaimStatus, string> = {
  verified: "Verified",
  false: "FALSE",
  cannot_check: "Couldn't check",
};

/** The verdicts as Ainsley reads them in check_math's result. */
export function formatCheck(claims: CheckedClaim[]): string {
  const lines = ["Checked by running code (for you; the student doesn't see this):", ""];
  claims.forEach((c, i) => {
    lines.push(`${i + 1}. ${STATUS_WORDS[c.status]}: ${c.claim}`);
    if (c.status === "false" && c.correct) lines.push(`   Correct: ${c.correct}`);
    if (c.status !== "verified" && c.checkedBy) lines.push(`   (${c.checkedBy})`);
  });
  const wrong = claims.some((c) => c.status === "false");
  const unsure = claims.some((c) => c.status === "cannot_check");
  if (wrong || unsure) lines.push("");
  if (wrong) {
    lines.push(
      "Don't state a false claim. Use the correct value, fix anything that depended on it, and check any new claim the fix brings in.",
    );
  }
  if (unsure) {
    lines.push(
      "Don't state an unchecked claim as fact: check it another way (a clearer sympy form, or solve_problem), leave it out, or tell the student you're not sure of it and why.",
    );
  }
  return lines.join("\n");
}

// ---------- The check of a finished reply ----------

/**
 * The answers a reply rests on that solve_problem couldn't verify (its solvers disagreed): each
 * counts as a claim the check couldn't verify, however the reply's own steps check out.
 */
export function unsettledAnswers(activity: Activity[] | undefined): CheckedClaim[] {
  return (activity ?? [])
    .filter((a) => a.kind === "solve" && a.detail === SOLUTION_LABELS.disputed)
    .map((a) => ({
      claim: `The answer to: ${a.label.length > 200 ? `${a.label.slice(0, 199)}…` : a.label}`,
      status: "cannot_check",
      correct: "",
      checkedBy: "Two solvers disagreed on this problem's answer, and the verifier couldn't settle it.",
    }));
}

/** A reply's overall result: every claim verified, one false, or some left unchecked. */
export function auditStatus(claims: CheckedClaim[]): AuditStatus {
  if (claims.length === 0) return "none";
  if (claims.some((c) => c.status === "false")) return "wrong";
  if (claims.some((c) => c.status === "cannot_check")) return "unverified";
  return "checked";
}

/**
 * What shows beside a finished reply's work time: "Not verified" once the check of its math found
 * a false claim, couldn't verify one or couldn't run. The check itself runs out of sight, so while
 * it runs, and when every claim checks out, nothing shows.
 */
export function auditBadge(status: AuditStatus): string | null {
  return status === "wrong" || status === "unverified" || status === "failed" ? "Not verified" : null;
}

/**
 * Whether a reply states anything worth checking: math in LaTeX, or arithmetic and equations in
 * plain text. Cheap and generous; the check itself decides what's a claim.
 */
export function containsMath(text: string): boolean {
  const t = text.replace(/\\\$/g, "");
  return (
    /\$[^$\n]*[0-9a-zA-Z\\][^$\n]*\$/.test(t) ||
    /\\\(|\\\[/.test(t) ||
    /\d\s*[+×*÷/^=<>≤≥≈]\s*-?\(?\d/.test(t) ||
    /\d\s+[-−]\s+\d/.test(t) ||
    /\b[a-zA-Z]\s*=\s*-?\d/.test(t)
  );
}

/**
 * The app's message asking Ainsley to correct a reply the check found false claims in: a short
 * user turn (a system message has to follow one) and the findings as a system message.
 */
export function correctionRequest(claims: CheckedClaim[], replyStart: string, latest: boolean) {
  const wrong = claims.filter((c) => c.status === "false");
  const which = latest
    ? "your last reply"
    : `your earlier reply that begins “${replyStart.replace(/\s+/g, " ").trim().slice(0, 120)}…”`;
  const items = wrong.map((c, i) =>
    [`${i + 1}. You wrote: ${c.claim}`, `   Correct: ${c.correct || "(not given)"}`, c.checkedBy ? `   How it was checked: ${c.checkedBy}` : ""]
      .filter(Boolean)
      .join("\n"),
  );
  return {
    prompt: "[Automatic math check. This note is from the app, not the student.]",
    note: [
      `The automatic math check ran code on the claims in ${which} and found ${wrong.length === 1 ? "this one" : "these"} false:`,
      "",
      ...items,
      "",
      "Post your correction now, as your instructions describe. The student hasn't written anything new.",
    ].join("\n"),
  };
}
