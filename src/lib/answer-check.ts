import type { AnswerVerdict, ApiBlock, Material } from "./types";

/**
 * Shared by the browser (which runs Ainsley's evaluate_answer calls) and /api/evaluate (which
 * has an independent grader check the answer): the tool's input, and the files sent with it.
 */

export interface EvaluateInput {
  problem: string;
  student_answer: string;
  reference?: string;
  course_expectations?: string;
}

const LIMITS: Record<keyof EvaluateInput, number> = {
  problem: 20_000,
  student_answer: 30_000,
  reference: 40_000,
  course_expectations: 5_000,
};

/** How each verdict reads in the activity list under a reply. */
export const VERDICT_LABELS: Record<AnswerVerdict, string> = {
  correct: "Correct",
  partially_correct: "Partly correct",
  incorrect: "Not correct yet",
  incomplete: "Incomplete",
  cannot_evaluate: "Couldn't check",
};

/** Validates evaluate_answer's input (streamed tool input isn't checked by the API), or says what's wrong. */
export function parseEvaluateInput(raw: unknown): EvaluateInput | string {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<EvaluateInput> = {};
  for (const key of Object.keys(LIMITS) as Array<keyof EvaluateInput>) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return `\`${key}\` must be text.`;
    const text = value.trim();
    if (text.length > LIMITS[key]) return `\`${key}\` is too long (over ${LIMITS[key].toLocaleString("en")} characters).`;
    if (text) out[key] = text;
  }
  if (!out.problem) return "`problem` must be the question or task as the student was given it.";
  if (!out.student_answer) return "`student_answer` must be the student's answer and working, verbatim.";
  return out as EvaluateInput;
}

const MAX_WORK_FILES = 4;
const MAX_WORK_PAGES = 20;
const MAX_WORK_TEXT = 30_000;

/**
 * Photos and short documents on the student's latest message, so the grader reads their work
 * itself rather than only Ainsley's transcription of it. No citations: the grader returns JSON.
 */
export function workAttachments(materials: Material[]): ApiBlock[] {
  const blocks: ApiBlock[] = [];
  for (const m of materials) {
    if (blocks.length >= MAX_WORK_FILES) break;
    if (m.kind === "image") {
      if (m.fileId) blocks.push({ type: "image", source: { type: "file", file_id: m.fileId } });
    } else if (m.kind === "pdf") {
      if (m.fileId && m.pageCount <= MAX_WORK_PAGES) {
        blocks.push({ type: "document", source: { type: "file", file_id: m.fileId }, title: m.name });
      }
    } else {
      const text = m.pages.map((p) => p.text).join("\n\n").trim().slice(0, MAX_WORK_TEXT);
      if (text) {
        blocks.push({ type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: m.name });
      }
    }
  }
  return blocks;
}
