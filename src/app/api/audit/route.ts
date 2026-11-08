import { describeError } from "@/lib/server/anthropic";
import { parseAttachments } from "@/lib/server/attachments";
import { auditReply, type AuditInput } from "@/lib/server/audit";
import type { CheckResponse } from "@/lib/types";

const MAX_REPLY = 60_000;
const MAX_TURNS = 6;
const MAX_TURN = 12_000;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function parseAuditInput(payload: Raw | null): AuditInput | string {
  const reply = typeof payload?.reply === "string" ? payload.reply.trim() : "";
  if (!reply) return "reply must be the finished reply's text.";
  if (reply.length > MAX_REPLY) return "The reply is too long to check.";
  const raw = Array.isArray(payload?.conversation) ? payload.conversation : [];
  const conversation = raw
    .slice(-MAX_TURNS)
    .filter(isObject)
    .flatMap((t): AuditInput["conversation"] =>
      (t.role === "student" || t.role === "tutor") && typeof t.text === "string" && t.text.trim()
        ? [{ role: t.role, text: t.text.trim().slice(0, MAX_TURN) }]
        : [],
    );
  return { reply, conversation };
}

/**
 * Checks the math in one of Ainsley's finished replies for the browser: its claims are listed
 * and each is checked by running code. The browser shows the result in the reply's timeline
 * and, if a claim is false, asks Ainsley to post a correction.
 */
export async function POST(req: Request) {
  let payload: Raw | null;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = parseAuditInput(isObject(payload) ? payload : null);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const attachments = parseAttachments(payload?.attachments);
  if (typeof attachments === "string") return Response.json({ error: attachments }, { status: 400 });

  try {
    const body: CheckResponse = { claims: await auditReply(input, attachments, req.signal) };
    return Response.json(body);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[ainsley] reply check failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
