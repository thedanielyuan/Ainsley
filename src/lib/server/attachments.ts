import "server-only";
import type { ApiBlock } from "@/lib/types";

/**
 * The student's work files sent along with a solve or an answer check (photos and short PDFs on
 * their latest message, see `workAttachments`), validated before they reach Claude.
 */

const MAX_ATTACHMENTS = 4;
const MAX_TEXT_FILE = 30_000;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Accepts only file references (photos, PDFs) and short text documents, with no citations. */
export function parseAttachments(input: unknown): ApiBlock[] | string {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS) return "attachments must be a short list.";
  const out: ApiBlock[] = [];
  for (const b of input) {
    if (!isObject(b) || !isObject(b.source)) return "Invalid attachment.";
    const title = typeof b.title === "string" ? b.title.slice(0, 300) : undefined;
    const source = b.source;
    if (b.type === "image" && source.type === "file" && typeof source.file_id === "string") {
      out.push({ type: "image", source: { type: "file", file_id: source.file_id } });
    } else if (b.type === "document" && source.type === "file" && typeof source.file_id === "string") {
      out.push({ type: "document", source: { type: "file", file_id: source.file_id }, ...(title ? { title } : {}) });
    } else if (
      b.type === "document" &&
      source.type === "text" &&
      typeof source.data === "string" &&
      source.data.trim() &&
      source.data.length <= MAX_TEXT_FILE
    ) {
      out.push({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: source.data },
        ...(title ? { title } : {}),
      });
    } else {
      return "Attachments must be photos, PDFs, or short text documents.";
    }
  }
  return out;
}
