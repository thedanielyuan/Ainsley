import { describeError } from "@/lib/server/anthropic";
import { titleThought } from "@/lib/server/thought-title";

const MAX_TEXT = 8_000;

/**
 * Names one step of Ainsley's thinking for the timeline above its reply. The browser sends a
 * passage of the reasoning summary from /api/chat and gets back a short status line, or a null
 * title when none could be written.
 */
export async function POST(req: Request) {
  let payload: { text?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof payload?.text === "string" ? payload.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return Response.json({ error: "text must be a non-empty string." }, { status: 400 });

  try {
    return Response.json({ title: await titleThought(text, req.signal) });
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] naming a thought failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
