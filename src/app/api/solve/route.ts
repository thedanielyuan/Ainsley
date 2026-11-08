import { describeError } from "@/lib/server/ainsley-ai";
import { parseAttachments } from "@/lib/server/attachments";
import { solveProblem } from "@/lib/server/solve";
import { parseSolveInput } from "@/lib/solution";
import type { SolveResponse } from "@/lib/types";

/**
 * Runs a solve_problem call for the browser, which drives Ainsley's tool loop: two solvers work
 * the problem independently and their answers are cross-checked. The browser saves the solution
 * and gives it to Ainsley as the tool result.
 */
export async function POST(req: Request) {
  let payload: { input?: unknown; attachments?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = parseSolveInput(payload?.input);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const attachments = parseAttachments(payload?.attachments);
  if (typeof attachments === "string") return Response.json({ error: attachments }, { status: 400 });

  try {
    const solution = await solveProblem(input, attachments, req.signal);
    const body: SolveResponse = { solution };
    return Response.json(body);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] solving failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
