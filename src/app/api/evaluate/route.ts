import { parseEvaluateInput } from "@/lib/answer-check";
import { describeError } from "@/lib/server/anthropic";
import { evaluateAnswer, formatAssessment, parseAttachments } from "@/lib/server/evaluate";
import type { EvaluateResponse } from "@/lib/types";

/**
 * Runs an evaluate_answer call for the browser, which drives Ainsley's tool loop: an
 * independent grader checks the student's attempt and the assessment goes back to Ainsley
 * as the tool result.
 */
export async function POST(req: Request) {
  let payload: { input?: unknown; attachments?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = parseEvaluateInput(payload?.input);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const attachments = parseAttachments(payload?.attachments);
  if (typeof attachments === "string") return Response.json({ error: attachments }, { status: 400 });

  try {
    const assessment = await evaluateAnswer(input, attachments, req.signal);
    const body: EvaluateResponse = assessment
      ? { content: formatAssessment(assessment), verdict: assessment.verdict }
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
