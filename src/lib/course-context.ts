import { courseModules, type CourseModule } from "./course-modules";
import { pageUnit, ROLE_LABELS, type LibraryState } from "./library";
import { MODULE_TOOL, OPEN_TOOL, SEARCH_TOOL } from "./tool-names";
import type { ChatMessage, ChatScope, ContextState, Material } from "./types";

/**
 * Course context reaches Ainsley as a system message appended after the student's message,
 * never by editing the system prompt: earlier turns stay byte-identical, which keeps the
 * prompt cache warm and preserves Ainsley's earlier reasoning. When nothing changed, nothing
 * is sent; when only the files changed, only the change is sent.
 */

const MAX_LISTED = 150;

/** The scope as it stands now, ignoring a course that no longer exists. */
export function resolveScope(s: LibraryState, scope: ChatScope): ChatScope {
  return { courseId: scope.courseId && s.courses[scope.courseId] ? scope.courseId : null };
}

/** The most recent course context given in this history. */
export function lastContextState(history: ChatMessage[]): ContextState | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].contextState) return history[i].contextState;
  }
  return undefined;
}

function describe(m: Material) {
  const parts = [ROLE_LABELS[m.role].toLowerCase()];
  if (m.kind !== "image") parts.push(`${m.pageCount} ${pageUnit(m.kind, m.pageCount)}`);
  if (m.kind === "image") parts.push("view with open_course_material; not searchable");
  else if (m.scanned) parts.push("scanned: view with open_course_material; not searchable");
  return `[${m.id}] ${m.name} — ${parts.join(", ")}`;
}

/** The course outline: each module's name, then its files. */
function catalog(modules: CourseModule[]) {
  const sections: string[] = [];
  let listed = 0;
  for (const mod of modules) {
    const lines = [mod.title];
    for (const m of mod.materials) {
      if (listed >= MAX_LISTED) break;
      lines.push(`- ${describe(m)}`);
      listed++;
    }
    const rest = mod.materials.length - (lines.length - 1);
    if (rest > 0) lines.push(`- …and ${rest} more`);
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

/** Which module each file is in, for describing changes. */
function moduleTitles(materials: Material[]) {
  const titles = new Map<string, string>();
  for (const mod of courseModules(materials)) for (const m of mod.materials) titles.set(m.id, mod.title);
  return titles;
}

export function buildContext(
  s: LibraryState,
  rawScope: ChatScope,
  previous: ContextState | undefined,
): { text: string; state: ContextState } | null {
  const scope = resolveScope(s, rawScope);
  const course = scope.courseId ? s.courses[scope.courseId] : undefined;
  const materials = course
    ? Object.values(s.materials)
        .filter((m) => m.courseId === course.id)
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const state: ContextState = { ...scope, materialIds: materials.map((m) => m.id).sort() };

  const sameScope = previous && previous.courseId === state.courseId;
  if (sameScope) {
    const before = new Set(previous.materialIds);
    const after = new Set(state.materialIds);
    const added = materials.filter((m) => !before.has(m.id));
    const removed = previous.materialIds.filter((id) => !after.has(id));
    if (added.length === 0 && removed.length === 0) return null;
    const lines = ["Course materials changed since the last update."];
    if (added.length) {
      const titles = moduleTitles(materials);
      lines.push(`Added:\n${added.map((m) => `- ${describe(m)} · in ${titles.get(m.id) ?? "the course"}`).join("\n")}`);
    }
    if (removed.length) lines.push(`Removed (deleted by the student): ${removed.map((id) => `[${id}]`).join(", ")}`);
    return { text: lines.join("\n\n"), state };
  }

  if (!course) {
    return {
      text:
        "This chat isn't in a course, so there are no course materials to search beyond files the student attaches here. " +
        "If their question is about a specific course, you can mention that adding the course to this chat (the Add course button below the message box) lets you use their slides and notes.",
      state,
    };
  }

  const header = `This chat is in the student's course “${course.name}”: what they ask here is about this course.`;

  if (materials.length === 0) {
    return {
      text: `${header}\n\nThey haven't added any materials to it yet. Teach from your own knowledge; when course specifics matter (notation, methods, what's assessed), suggest they add their slides or notes to the course.`,
      state,
    };
  }

  return {
    text:
      `${header}\n\nTheir materials for this course, by module ([id] name — type, length):\n\n${catalog(courseModules(materials))}\n\n` +
      `Search them with ${SEARCH_TOOL} before teaching course content, retrieve a whole module with ${MODULE_TOOL} for reviews, quizzes, and summaries, and open a file with ${OPEN_TOOL} when you need to see it whole.`,
    state,
  };
}
