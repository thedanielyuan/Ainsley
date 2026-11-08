import { parseTraceRequest, type TraceResponse } from "@/lib/prerequisite-map";
import { describeError } from "@/lib/server/ainsley-ai";
import { mapPrerequisites } from "@/lib/server/prerequisites";

/**
 * Runs a trace_prerequisites call for the browser, which drives Ainsley's tool loop and keeps the
 * student's knowledge map: a separate Ainsley AI call maps what the concept builds on, and the browser
 * adds the map to the student's knowledge map and finds where their courses teach each part.
 */
export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const request = parseTraceRequest(payload);
  if (typeof request === "string") return Response.json({ error: request }, { status: 400 });

  try {
    const body: TraceResponse = { map: await mapPrerequisites(request, req.signal) };
    return Response.json(body);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] prerequisite map failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
