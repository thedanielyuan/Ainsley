import { parseSolution } from "./solution";
import { loadProblem } from "./storage";
import { HELP_RUNGS } from "./tutoring";
import type { ChatMessage, HelpRung, ReplyTutoring, ReviewResponse } from "./types";

/**
 * Reviews each of Ainsley's replies on a problem in the background (/api/review: the most help it
 * gave, and whether it leaked the final answer), and lets the next request wait briefly for the
 * review, so the tutoring policy knows the rung the last reply used.
 */

/** How long a new message waits for the last reply's review before going without it. */
const WAIT_MS = 8_000;
const TIMEOUT_MS = 60_000;

type Reviewed = Pick<ReplyTutoring, "used" | "leak">;

/** Reviews in progress, by conversation. */
const pending = new Map<string, Promise<void>>();
/** Finished reviews, by reply, for histories captured before they finished. */
const reviewed = new Map<string, Reviewed>();

/** The message with its review applied, if one has finished since it was read. */
export function withReview(m: ChatMessage): ChatMessage {
  const r = reviewed.get(m.id);
  return r && m.tutoring ? { ...m, tutoring: { ...m.tutoring, ...r } } : m;
}

/** Waits for the conversation's last review, briefly: a reply that wasn't reviewed counts as using what it was allowed. */
export async function reviewsSettled(conversationId: string): Promise<void> {
  const review = pending.get(conversationId);
  if (!review) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([review, new Promise<void>((resolve) => (timer = setTimeout(resolve, WAIT_MS)))]);
  clearTimeout(timer);
}

export interface ReviewRequest {
  conversationId: string;
  replyId: string;
  /** The problem in progress, and the most help the policy allowed on it. */
  problemId: string;
  problem: string;
  allowed?: HelpRung;
  /** Whether the student had attempted it by the end of the reply. */
  attempted: boolean;
  /** What the student saw. */
  reply: string;
  /** The conversation up to the student's message the reply answers. */
  history: ChatMessage[];
  onReviewed: (fields: Reviewed) => void;
}

export function startReview(request: ReviewRequest) {
  const run = review(request).then(
    (fields) => {
      if (!fields) return;
      reviewed.set(request.replyId, fields);
      request.onReviewed(fields);
    },
    () => undefined, // Unreviewed: it counts as using what it was allowed.
  );
  pending.set(request.conversationId, run);
  void run.finally(() => {
    if (pending.get(request.conversationId) === run) pending.delete(request.conversationId);
  });
}

async function review(r: ReviewRequest): Promise<Reviewed | null> {
  const saved = await loadProblem(r.problemId).catch(() => undefined);
  const solution = saved ? parseSolution(saved.solution) : null;
  const students = r.history.filter((m) => m.role === "user");
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      problemId: r.problemId,
      problem: saved?.problem ?? r.problem,
      answers: solution && solution.status !== "cannot_solve" ? solution.answers : [],
      reply: r.reply,
      student: students.at(-1)?.text ?? "",
      // What the student has already seen or written, so restating it isn't counted as a leak.
      known: students.map((m) => m.text).filter(Boolean),
      attempted: r.attempted,
      allowed: r.allowed,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Partial<ReviewResponse>;
  const fields: Reviewed = {};
  if (data.reviewed && (data.used === null || HELP_RUNGS.some((rung) => rung === data.used))) fields.used = data.used;
  if (data.leak) fields.leak = true;
  return Object.keys(fields).length ? fields : null;
}
