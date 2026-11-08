import { parseEvaluateInput } from "@/lib/answer-check";
import { describeError } from "@/lib/server/ainsley-ai";
import { parseAttachments } from "@/lib/server/attachments";
import { checkedConcepts, evaluateAnswer, formatAssessment } from "@/lib/server/evaluate";
import { parseSolution } from "@/lib/solution";
import type { EvaluateResponse } from "@/lib/types";

const MAX_KNOWN_CONCEPTS = 300;
const MAX_CONCEPT_NAME = 200;

/**
 * Runs an evaluate_answer call for the browser, which drives Ainsley's tool loop: an
 * independent checker marks the student's attempt step by step, starting from the problem's
 * verified solution when Ainsley worked it out first, and the assessment goes back to Ainsley
 * as the tool result. The concepts it names come back too, for the student's knowledge map
 * (named like those already in it, which the browser sends).
 */
export async function POST(req: Request) {
  let payload: { input?: unknown; attachments?: unknown; solution?: unknown; concepts?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = parseEvaluateInput(payload?.input);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const attachments = parseAttachments(payload?.attachments);
  if (typeof attachments === "string") return Response.json({ error: attachments }, { status: 400 });
  // A solution the solvers couldn't produce is no help to the checker.
  const parsed = parseSolution(payload?.solution);
  const solution = parsed && parsed.status !== "cannot_solve" ? parsed : null;
  const known = Array.isArray(payload?.concepts)
    ? payload.concepts
        .filter((c): c is string => typeof c === "string" && Boolean(c.trim()))
        .slice(0, MAX_KNOWN_CONCEPTS)
        .map((c) => c.replace(/\s+/g, " ").trim().slice(0, MAX_CONCEPT_NAME))
    : [];

  try {
    const assessment = await evaluateAnswer(input, solution, attachments, known, req.signal);
    const body: EvaluateResponse = assessment
      ? {
          content: formatAssessment(assessment, solution),
          verdict: assessment.verdict,
          concepts: checkedConcepts(assessment),
          firstErrorConcept: assessment.errors[0]?.concept ?? "",
          reliable: assessment.reading_confidence !== "low",
        }
      : {
          content: "The answer check declined to assess this. Judge the answer yourself, carefully.",
          verdict: "cannot_evaluate",
        };
    return Response.json(body);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] answer check failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
