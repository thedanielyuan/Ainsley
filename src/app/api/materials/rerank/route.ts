import { describeError } from "@/lib/server/ainsley-ai";
import { rerankPassages, type Passage } from "@/lib/server/rerank";

const MAX_QUERY = 2_000;
const MAX_PASSAGES = 40;
const MAX_TITLE = 300;
const MAX_TEXT = 6_000;
const MAX_LIMIT = 20;

/**
 * Re-ranks the passages search_course_materials found in the browser (where the library lives).
 * Returns `order`, the passages' indices best first (an empty list when none help), or null
 * when they couldn't be judged, in which case the search keeps its keyword order.
 */
export async function POST(req: Request) {
  let payload: { query?: unknown; passages?: unknown; limit?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = typeof payload?.query === "string" ? payload.query.trim() : "";
  if (!query || query.length > MAX_QUERY) return Response.json({ error: "query must be short, non-empty text." }, { status: 400 });
  const raw = payload?.passages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PASSAGES) {
    return Response.json({ error: `passages must be a list of 1 to ${MAX_PASSAGES}.` }, { status: 400 });
  }
  const passages: Passage[] = [];
  for (const p of raw) {
    if (typeof p?.title !== "string" || typeof p?.text !== "string") {
      return Response.json({ error: "Each passage needs a title and text." }, { status: 400 });
    }
    passages.push({ title: p.title.slice(0, MAX_TITLE), text: p.text.slice(0, MAX_TEXT) });
  }
  const limit = typeof payload?.limit === "number" && Number.isInteger(payload.limit) ? payload.limit : 6;
  if (limit < 1 || limit > MAX_LIMIT) return Response.json({ error: `limit must be 1 to ${MAX_LIMIT}.` }, { status: 400 });

  try {
    return Response.json({ order: await rerankPassages(query, passages, limit, req.signal) });
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] re-ranking failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
