import type Anthropic from "@anthropic-ai/sdk";

/** A content block exactly as sent to (or returned by) the Messages API. */
export type ApiBlock = Anthropic.Beta.BetaContentBlockParam;

/**
 * Pre-tool-use assistant content (text and thinking only). Older conversations stored
 * replies in this shape; new replies store their full API transcript in `turns`.
 */
export type ReplayBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

/**
 * One API message inside an assistant reply. A reply that uses tools spans several:
 * the model's turn, the tool results we send back, the model's next turn, and so on.
 * They are replayed byte-for-byte so preserved thinking and the prompt cache stay valid.
 */
export interface ApiTurn {
  role: "user" | "assistant";
  content: ApiBlock[];
}

export type MessageStatus =
  | "streaming"
  | "done"
  | "stopped"
  | "error"
  | "refused"
  | "truncated";

export type MaterialKind = "pdf" | "slides" | "image" | "doc" | "text";

/** What a file is for. Inferred from its name and type; shown to the student and to Ainsley. */
export type MaterialRole =
  | "slides"
  | "notes"
  | "reading"
  | "problem-set"
  | "exam"
  | "syllabus"
  | "photo"
  | "other";

/** A file as shown on a student's message. */
export interface AttachmentMeta {
  materialId: string;
  name: string;
  kind: MaterialKind;
  mimeType: string;
  pageCount?: number;
  thumbnail?: string;
}

/** Which course a chat belongs to and draws on; null for a chat outside any course. */
export interface ChatScope {
  courseId: string | null;
}

/** The course context last given to Ainsley in a conversation, used to send only changes. */
export interface ContextState extends ChatScope {
  materialIds: string[];
}

/** A step in the timeline above a reply: a stretch of Ainsley's thinking, or a tool call. */
export interface Activity {
  /** The tool_use id; generated for a thought. */
  id: string;
  kind: "thought" | "materials" | "open" | "module" | "evaluate" | "web_search" | "web_fetch";
  /** What a tool call looked up; a thought's name ("" until /api/thought names it). */
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
}

/** The answer checker's overall judgment of a student's attempt. */
export type AnswerVerdict = "correct" | "partially_correct" | "incorrect" | "incomplete" | "cannot_evaluate";

/** Result of POST /api/evaluate. */
export interface EvaluateResponse {
  /** The tool result for Ainsley: the full assessment, worded for the tutor. */
  content: string;
  verdict: AnswerVerdict;
  error?: string;
}

/** `quotes`: the distinct passages Ainsley cited from it, shown in the source details in chat. */
export type Source =
  | { type: "material"; materialId: string; title: string; page?: number; quotes?: string[] }
  /** `uncited`: a page Ainsley read but neither cited nor linked in the text. */
  | { type: "web"; url: string; title: string; uncited?: boolean; quotes?: string[] };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** What the student sees (plain text, used for copy and search). */
  text: string;
  status?: MessageStatus;
  error?: string;
  createdAt: number;

  // ---- Student messages ----
  attachments?: AttachmentMeta[];
  /** The exact content sent for this message (attachments + text). */
  content?: ApiBlock[];
  /** A system message sent right after this message: course context, or what changed in it. */
  context?: string;
  contextState?: ContextState;

  // ---- Ainsley's replies ----
  /** The full API transcript of this reply, replayed unchanged on later requests. */
  turns?: ApiTurn[];
  /** Legacy single-turn replies (before tools). */
  blocks?: ReplayBlock[];
  /** Markdown with citation markers, derived from `turns` when the reply finishes. */
  display?: string;
  sources?: Source[];
  activity?: Activity[];
  /**
   * How long Ainsley worked before its answer: from the request to the first text after its last
   * step (or to the end, if it wrote nothing after). Unset while it's still working.
   */
  thinkingMs?: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** The course this chat is in: listed under it, and searching its materials. */
  courseId?: string | null;
}

// ---------- Courses and materials ----------

/** A folder on the student's computer whose files are kept in the course. */
export interface LinkedFolder {
  name: string;
  /** False where the browser can't re-read a folder later: the student picks it again to sync. */
  canSync: boolean;
  linkedAt: number;
  syncedAt: number;
}

export interface Course {
  id: string;
  name: string;
  /** Index into COURSE_COLORS. */
  color: number;
  /** Key into COURSE_ICONS (components/course-icon.tsx); a folder when unset. */
  icon?: string;
  folder?: LinkedFolder;
  createdAt: number;
  updatedAt: number;
}

export interface MaterialPage {
  /** 1-based page, slide, or section number. */
  n: number;
  text: string;
}

export interface Material {
  id: string;
  /** null for files attached in a chat that isn't in a course. */
  courseId: string | null;
  /** Set when the file was attached in a chat. */
  conversationId?: string;
  name: string;
  kind: MaterialKind;
  role: MaterialRole;
  mimeType: string;
  size: number;
  /** Pages (PDF), slides (PPTX), or sections (documents). */
  pageCount: number;
  /** Anthropic Files API id: PDFs and images, which Ainsley can view directly. */
  fileId?: string;
  /** Extracted text used for search, and sent in place of files the API can't read (slides, docs). */
  pages: MaterialPage[];
  /** True when a PDF had no selectable text (a scan): viewable, but not searchable. */
  scanned?: boolean;
  thumbnail?: string;
  /** Files from a linked folder: "<folder>/<path in it>", and when the file last changed (to spot edits). */
  folderPath?: string;
  lastModified?: number;
  createdAt: number;
}

/** Result of POST /api/materials. */
export interface ProcessedUpload {
  name: string;
  kind: MaterialKind;
  mimeType: string;
  size: number;
  pageCount: number;
  fileId?: string;
  pages: MaterialPage[];
  scanned?: boolean;
  thumbnail?: string;
}

// ---------- Client ↔ /api/chat ----------

export interface ApiMessage {
  role: "user" | "assistant" | "system";
  content: string | ApiBlock[];
}

/** /api/chat → client, one JSON object per line. */
export type StreamEvent =
  | { type: "text"; text: string }
  /** Part of the summary of Ainsley's reasoning: used to name the step, never shown as is. */
  | { type: "thinking"; text: string }
  /** The thinking block in progress ended. */
  | { type: "thinking_stop" }
  /** A tool call is complete (client tools run after `done`; server tools run on Anthropic's side). */
  | { type: "tool"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean; count?: number }
  | {
      type: "done";
      content: ApiBlock[];
      stopReason: string | null;
      container: string | null;
    }
  | { type: "error"; message: string };
