import { workAttachments } from "./answer-check";
import { getLibrary } from "./library";
import type { ChatMessage, CheckedClaim, CheckResponse, Material } from "./types";

/**
 * The browser's side of the check that runs when one of Ainsley's replies with math finishes:
 * the reply, the conversation it answers and the files on the student's latest message go to
 * /api/audit, which lists the reply's claims and checks each by running code.
 */

/** How much of the conversation before the reply the claim finder reads. */
const CONTEXT_MESSAGES = 6;
// Long enough for a code check, a second look and a slow moment, not forever.
const TIMEOUT_MS = 4 * 60_000;

export async function checkReply(history: ChatMessage[], reply: string, signal: AbortSignal): Promise<CheckedClaim[]> {
  const conversation = history
    .slice(-CONTEXT_MESSAGES)
    .filter((m) => m.text.trim() && m.status !== "refused")
    .map((m) => ({ role: m.role === "user" ? "student" : "tutor", text: m.text }));
  const library = getLibrary();
  const latest = history.findLast((m) => m.role === "user");
  const files = (latest?.attachments ?? [])
    .map((a) => library.materials[a.materialId])
    .filter((m): m is Material => Boolean(m));

  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply, conversation, attachments: workAttachments(files) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  const data = (await res.json().catch(() => null)) as Partial<CheckResponse> | null;
  if (!res.ok || !Array.isArray(data?.claims)) throw new Error(data?.error ?? `The math check failed (${res.status}).`);
  return data.claims;
}
