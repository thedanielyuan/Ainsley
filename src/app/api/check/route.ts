import { parseCheckInput } from "@/lib/math-check";
import { describeError } from "@/lib/server/ainsley-ai";
import { checkClaims } from "@/lib/server/check";
import type { CheckedClaim, CheckResponse } from "@/lib/types";

/**
 * Runs a check_math call for the browser, which drives Ainsley's tool loop: each claim is
 * checked by running code, and the verdicts go back to Ainsley as the tool result.
 */
export async function POST(req: Request) {
  let payload: { input?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = parseCheckInput(payload?.input);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });

  try {
    // Without a reply to read, no verdict is "not_stated".
    const claims = (await checkClaims(input, req.signal)) as CheckedClaim[];
    const body: CheckResponse = { claims };
    return Response.json(body);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] math check failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
