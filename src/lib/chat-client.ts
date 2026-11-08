import { MAX_VIEW_PAGES } from "./course-tools";
import { pageUnit, type LibraryState } from "./library";
import type { ApiBlock, ApiMessage, ApiTurn, ChatMessage, Material, StreamEvent } from "./types";

type ToolResultBlock = Extract<ApiBlock, { type: "tool_result" }>;

/**
 * Builds the history sent to /api/chat. Every turn goes back exactly as stored (thinking
 * blocks, tool calls and results, citations) so each request extends the previous one
 * append-only. The exceptions: a file the student has since deleted is replaced with a note
 * (the API drops any reasoning that depended on it), and a tool result the API would reject is
 * repaired (see onlySearchResults).
 */
export function toApiMessages(history: ChatMessage[], s: LibraryState): ApiMessage[] {
  const liveFiles = new Set<string>();
  for (const m of Object.values(s.materials)) if (m.fileId) liveFiles.add(m.fileId);
  const clean = (blocks: ApiBlock[]) => onlySearchResults(s.ready ? replaceDeletedFiles(blocks, liveFiles) : blocks);

  const out: ApiMessage[] = [];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content?.length ? clean(m.content) : m.text });
      if (m.context) out.push({ role: "system", content: m.context });
    } else if (m.turns?.length) {
      for (const turn of m.turns) out.push({ role: turn.role, content: clean(turn.content) });
    } else if (m.blocks?.length) {
      out.push({ role: "assistant", content: m.blocks });
    } else if (m.text.trim() && m.status !== "refused" && m.status !== "error") {
      // A response the student stopped early: replay the partial text.
      out.push({ role: "assistant", content: [{ type: "text", text: m.text }] });
    }
  }
  return out;
}

function replaceDeletedFiles(blocks: ApiBlock[], live: Set<string>): ApiBlock[] {
  let changed = false;
  const next = blocks.map((block): ApiBlock => {
    if ((block.type === "image" || block.type === "document") && block.source.type === "file") {
      if (live.has(block.source.file_id)) return block;
      changed = true;
      const title = block.type === "document" && block.title ? ` (“${block.title}”)` : "";
      return { type: "text", text: `[A file the student has since deleted${title}.]` };
    }
    if (block.type === "tool_result" && Array.isArray(block.content)) {
      const inner = replaceDeletedFiles(block.content as ApiBlock[], live);
      if (inner !== block.content) {
        changed = true;
        return { ...block, content: inner as ToolResultBlock["content"] };
      }
    }
    return block;
  });
  return changed ? next : blocks;
}

/**
 * The API rejects a tool result that mixes `search_result` blocks with any other kind ("all
 * blocks must be of that type"). open_course_material used to put a summary line before the
 * pages it returned, so a reply that failed on it, and every message sent after it, kept
 * failing. Such a result keeps just its search results, which hold everything the line said.
 * Valid history is returned unchanged.
 */
function onlySearchResults(blocks: ApiBlock[]): ApiBlock[] {
  let changed = false;
  const next = blocks.map((block): ApiBlock => {
    if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
    const inner = block.content as ApiBlock[];
    if (!inner.some((b) => b.type === "search_result") || inner.every((b) => b.type === "search_result")) return block;
    changed = true;
    return { ...block, content: inner.filter((b) => b.type === "search_result") as ToolResultBlock["content"] };
  });
  return changed ? next : blocks;
}

/** The content blocks for a student's message: their attachments, then their text. */
export function messageContent(text: string, materials: Material[]): ApiBlock[] {
  const blocks: ApiBlock[] = [];
  for (const m of materials) {
    if (m.kind === "image" && m.fileId) {
      blocks.push({ type: "image", source: { type: "file", file_id: m.fileId } });
    } else if (m.kind === "pdf" && m.fileId && m.pageCount <= MAX_VIEW_PAGES) {
      blocks.push({
        type: "document",
        source: { type: "file", file_id: m.fileId },
        title: m.name,
        citations: { enabled: true },
      });
    } else if (m.kind === "pdf") {
      blocks.push({
        type: "text",
        text: `[The student attached “${m.name}” (${m.pageCount} pages, id ${m.id}). It's too long to include whole: use search_course_materials to find what's relevant, or open_course_material with specific pages.]`,
      });
    } else {
      const body = m.pages.map((p) => `--- ${pageUnit(m.kind)} ${p.n} ---\n${p.text}`).join("\n\n");
      blocks.push({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: body || "(no text)" },
        title: m.name,
        citations: { enabled: true },
      });
    }
  }
  if (text) blocks.push({ type: "text", text });
  return blocks;
}

/**
 * Makes a reply's transcript safe to continue from after it was cut short: every tool call
 * gets a result, and a trailing server tool call with no result is removed.
 */
export function closeTurns(turns: ApiTurn[]): ApiTurn[] {
  const out = turns.filter((t) => t.content.length > 0);
  const last = out[out.length - 1];
  if (!last || last.role !== "assistant") return out;

  const answered = new Set<string>();
  for (const b of last.content) {
    if ("tool_use_id" in b && typeof b.tool_use_id === "string") answered.add(b.tool_use_id);
  }
  const content = last.content.filter((b) => !(b.type === "server_tool_use" && !answered.has(b.id)));
  const pending = content.filter((b): b is Extract<ApiBlock, { type: "tool_use" }> => b.type === "tool_use");
  const closed: ApiTurn[] = [...out.slice(0, -1)];
  if (content.length) closed.push({ role: "assistant", content });
  if (pending.length) {
    closed.push({
      role: "user",
      content: pending.map((b) => ({
        type: "tool_result" as const,
        tool_use_id: b.id,
        is_error: true,
        content: "The student stopped the response before this ran.",
      })),
    });
  }
  return closed;
}

/** Names a step of Ainsley's thinking from its reasoning summary (see /api/thought); null if it can't. */
export async function nameThought(reasoning: string): Promise<string | null> {
  try {
    const res = await fetch("/api/thought", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reasoning }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title ? data.title : null;
  } catch {
    return null;
  }
}

export async function streamChat(
  body: { messages: ApiMessage[]; container?: string | null },
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Non-JSON error body; keep the status message.
    }
    throw new Error(message);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "done" || event.type === "error") finished = true;
      onEvent(event);
    }
  }

  if (!finished) {
    throw new Error("The connection closed before Ainsley finished responding.");
  }
}
