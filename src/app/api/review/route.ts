import { findStatedAnswers, type StatedAnswer } from "@/lib/answer-leak";
import { reviewHelp, type HelpReview } from "@/lib/server/help-review";
import { readAnswers } from "@/lib/solution";
import { HELP_RUNGS, rungLevel } from "@/lib/tutoring";
import type { HelpRung, ReviewResponse } from "@/lib/types";

const MAX_PROBLEM = 20_000;
const MAX_REPLY = 60_000;
const MAX_STUDENT = 30_000;
const MAX_KNOWN = 100_000;

/**
 * Reviews one of Ainsley's replies for the tutoring policy (src/lib/tutoring.ts): whether it was
 * about the problem in progress, a new problem the student brought, or neither, and the most help
 * it gave (Claude Haiku 5.5, src/lib/server/help-review.ts); and whether it stated the final answer
 * before the student had attempted the problem, found by comparing its math with the saved answers'
 * sympy forms (src/lib/answer-leak.ts) and by the reviewer. Leaks and help beyond what the policy
 * allowed are logged in development as metrics; nothing is blocked.
 */
export async function POST(req: Request) {
  let payload: Record<string, unknown> | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const reply = str(payload?.reply, MAX_REPLY);
  if (!reply.trim()) return Response.json({ error: "reply must be a non-empty string." }, { status: 400 });

  // The problem in progress, if there is one.
  const problemId = str(payload?.problemId, 80);
  const problem = str(payload?.problem, MAX_PROBLEM);
  const solved = payload?.solved === true;
  const student = str(payload?.student, MAX_STUDENT);
  const answers = readAnswers(payload?.answers);
  const known: string[] = [];
  let room = MAX_KNOWN;
  for (const text of Array.isArray(payload?.known) ? payload.known : []) {
    if (typeof text !== "string" || room <= 0) continue;
    known.push(text.slice(0, room));
    room -= text.length;
  }
  const attempted = payload?.attempted === true;
  const allowed = HELP_RUNGS.find((rung) => rung === payload?.allowed) ?? null;

  // Only an answer stated before their attempt is a leak; the saved answers are the problem in progress's.
  const stated = attempted || solved || !problem ? [] : findStatedAnswers(reply, answers, [problem, ...known]);
  let review: HelpReview | null = null;
  try {
    review = await reviewHelp({ problem, solved, answers, student, reply }, req.signal);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] reviewing a reply failed:", err);
  }
  const leak = !review
    ? stated.length > 0
    : review.about === "this"
      ? !attempted && !solved && (stated.length > 0 || review.statesAnswer)
      : review.about === "new" && review.statesAnswer;
  logReview({ problemId, attempted, allowed, review, stated: review && review.about !== "this" ? [] : stated, leak });

  const body: ReviewResponse = review
    ? {
        reviewed: true,
        used: review.used,
        about: review.about,
        ...(review.about === "new" ? { problem: review.problem } : {}),
        leak,
      }
    : { reviewed: false, leak };
  return Response.json(body);
}

/** The policy's metrics, in development: each reply's help, answer leaks, and help beyond what was allowed. */
function logReview(r: {
  problemId: string;
  attempted: boolean;
  allowed: HelpRung | null;
  review: HelpReview | null;
  stated: StatedAnswer[];
  leak: boolean;
}) {
  if (process.env.NODE_ENV === "production") return;
  const yes = (v: boolean) => (v ? "yes" : "no");
  const about = r.review?.about ?? "unreviewed";
  // A reply about a new problem is held to what a new problem allows, whatever was in progress.
  const allowed = about === "new" ? "nudge" : r.allowed;
  const subject = about === "new" ? "new problem" : r.problemId || "no problem";
  const used = r.review ? (r.review.used ?? "none") : "unreviewed";
  console.log(
    `[ainsley] tutoring ${subject}: about=${about} allowed=${allowed ?? "?"} used=${used} attempted=${yes(r.attempted && about === "this")}` +
      (r.review ? ` asked_for_attempt=${yes(r.review.asksForAttempt)}` : ""),
  );
  if (r.leak) {
    const found = [
      ...r.stated.map((s) => `sympy match ${s.part ? `${s.part} ` : ""}${s.answer} in "${s.quote}"`),
      ...(r.review?.statesAnswer ? [`reviewer: "${r.review.evidence}"`] : []),
    ];
    console.warn(`[ainsley] answer leak (${subject}): the reply stated the final answer before an attempt (${found.join("; ")})`);
  }
  if (r.review && about !== "none" && allowed && rungLevel(r.review.used) > rungLevel(allowed)) {
    console.warn(
      `[ainsley] over-help (${subject}): used=${r.review.used} allowed=${allowed}` +
        (r.review.evidence ? ` ("${r.review.evidence}")` : ""),
    );
  }
}
