import { courseModules } from "./course-modules";
import { findPassages, type ToolContext } from "./course-tools";
import {
  applyMap,
  conceptKey,
  describeRecord,
  findConcept,
  getConcept,
  knownForMapper,
  masteryOf,
  recordCheck,
  setTaughtIn,
  type MappedNode,
} from "./knowledge";
import { courseMaterials, getLibrary, pageUnit, type LibraryState } from "./library";
import type { CourseOutline, GapLikelihood, PrerequisiteMap, TraceInput, TraceRequest } from "./prerequisite-map";
import { OPEN_TOOL, PREREQUISITES_TOOL } from "./tool-names";
import type { CheckedConcept, ConceptLocation, EvaluateResponse } from "./types";

/**
 * Prerequisite remediation on the browser's side: what trace_prerequisites sends the mapper
 * (/api/prerequisites), finding where the student's courses teach each prerequisite, and the map
 * as Ainsley reads it; and, after each answer check, recording what it showed in the student's
 * knowledge map and pointing Ainsley to a gap in a prerequisite.
 */

/** At most this many places a prerequisite is taught, one per course. */
const MAX_COURSES_PER_CONCEPT = 2;
const MAX_FILES_PER_OUTLINE = 60;
const MAX_OUTLINE_CHARS = 6_000;
const EXCERPT_CHARS = 180;

function courseNamer(s: LibraryState) {
  return (id: string | null) => (id ? (s.courses[id]?.name ?? null) : null);
}

/** Each course's files by module, the chat's course first, so the mapper fits the student's level. */
function courseOutlines(s: LibraryState, chatCourseId: string | null): CourseOutline[] {
  const courses = Object.values(s.courses).sort(
    (a, b) => Number(b.id === chatCourseId) - Number(a.id === chatCourseId) || b.updatedAt - a.updatedAt,
  );
  return courses.map((course) => {
    const lines: string[] = [];
    let files = 0;
    for (const mod of courseModules(courseMaterials(s, course.id))) {
      if (files >= MAX_FILES_PER_OUTLINE) break;
      lines.push(mod.title);
      for (const m of mod.materials.slice(0, MAX_FILES_PER_OUTLINE - files)) lines.push(`- ${m.name}`);
      files += mod.materials.length;
    }
    return { name: course.name, outline: lines.join("\n").slice(0, MAX_OUTLINE_CHARS) };
  });
}

/** What trace_prerequisites sends the mapper: the concept, the student's courses, and their knowledge map. */
export async function traceRequest(input: TraceInput, chatCourseId: string | null): Promise<TraceRequest> {
  const s = getLibrary();
  return {
    input,
    course: chatCourseId ? (s.courses[chatCourseId]?.name ?? null) : null,
    courses: courseOutlines(s, chatCourseId),
    known: await knownForMapper(input, courseNamer(s)),
  };
}

/**
 * Where the student's courses teach each prerequisite: the passages most about it across all their
 * course files, the best one per course.
 */
async function locate(s: LibraryState, nodes: MappedNode[], signal: AbortSignal) {
  const pool = Object.values(s.materials).filter((m) => m.courseId !== null);
  const excerpts = new Map<string, string>();
  if (pool.length === 0) return excerpts;
  const found = await Promise.all(
    nodes.map(async ({ concept, mapped }) => {
      const passages = await findPassages(s, pool, mapped.searchQuery || concept.name, 3, signal);
      const places: ConceptLocation[] = [];
      for (const p of passages) {
        const courseId = p.material.courseId;
        if (!courseId || places.some((x) => x.courseId === courseId)) continue;
        places.push({ courseId, materialId: p.material.id, page: p.page });
        excerpts.set(`${p.material.id}#${p.page}`, p.text);
        if (places.length >= MAX_COURSES_PER_CONCEPT) break;
      }
      return { id: concept.id, places };
    }),
  );
  setTaughtIn(found);
  return excerpts;
}

/**
 * "MATH 2551 · Week 9 — “Lecture 17” [k3f9a2b7c1], slide 4: “…”" for each place that still exists.
 * A passage's excerpt is quoted the first time it's listed (`quoted` keeps track across a map).
 */
function describePlaces(
  s: LibraryState,
  places: ConceptLocation[],
  excerpts?: Map<string, string>,
  quoted = new Set<string>(),
) {
  const modules = new Map<string, Map<string, string>>();
  const moduleOf = (courseId: string, materialId: string) => {
    let titles = modules.get(courseId);
    if (!titles) {
      titles = new Map();
      for (const mod of courseModules(courseMaterials(s, courseId))) {
        for (const m of mod.materials) titles.set(m.id, mod.title);
      }
      modules.set(courseId, titles);
    }
    return titles.get(materialId);
  };
  return places.flatMap((place) => {
    const m = s.materials[place.materialId];
    const course = s.courses[place.courseId];
    if (!m || !course || m.courseId !== course.id) return [];
    const where = [course.name, moduleOf(course.id, m.id)].filter(Boolean).join(" · ");
    const key = `${m.id}#${place.page}`;
    const text = quoted.has(key) ? "" : excerpts?.get(key)?.replace(/\s+/g, " ").trim();
    if (text) quoted.add(key);
    const excerpt = text ? `: “${text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).trimEnd()}…` : text}”` : "";
    return [`${where} — “${m.name}” [${m.id}], ${pageUnit(m.kind)} ${place.page}${excerpt}`];
  });
}

const LIKELIHOOD_ORDER: Record<GapLikelihood, number> = { likely: 0, possible: 1, unlikely: 2 };
const LIKELIHOOD_TEXT: Record<GapLikelihood, string> = {
  likely: "likely the gap",
  possible: "possibly the gap",
  unlikely: "unlikely to be the gap",
};

/**
 * Adds a prerequisite map to the student's knowledge map, finds where their courses teach each
 * prerequisite, and words it all for Ainsley.
 */
export async function traceReport(
  map: PrerequisiteMap,
  signal: AbortSignal,
): Promise<{ content: string; detail: string }> {
  const applied = await applyMap(map);
  if (!applied) return { content: "The prerequisite map named no concept. Work out what it builds on yourself.", detail: "Couldn't map" };
  const { target, nodes } = applied;
  if (nodes.length === 0) {
    return {
      content: `“${target.name}” builds on nothing a student at this level can't be assumed to have. If they're stuck, the trouble is in the concept itself: teach it directly.`,
      detail: "No prerequisites",
    };
  }

  const s = getLibrary();
  const excerpts = await locate(s, nodes, signal);
  const courseName = courseNamer(s);
  const gapKey = map.mostLikelyGap ? conceptKey(map.mostLikelyGap) : null;
  const ordered = nodes
    .map((n, i) => ({ ...n, i, first: conceptKey(n.mapped.name) === gapKey || conceptKey(n.concept.name) === gapKey }))
    .sort(
      (a, b) =>
        Number(b.first) - Number(a.first) ||
        LIKELIHOOD_ORDER[a.mapped.likelihood] - LIKELIHOOD_ORDER[b.mapped.likelihood] ||
        a.i - b.i,
    );
  // The map's own names for the concepts it lists, to the names they have in the knowledge map.
  const names = new Map([
    [conceptKey(map.target.name), target.name],
    ...nodes.map((n): [string, string] => [conceptKey(n.mapped.name), n.concept.name]),
  ]);
  const courses = new Set<string>();
  const quoted = new Set<string>();

  const entries = ordered.map(({ concept, mapped }, i) => {
    // Read again: finding where it's taught has just updated it.
    const latest = getConcept(concept.id) ?? concept;
    const places = describePlaces(s, latest.taughtIn, excerpts, quoted);
    for (const p of latest.taughtIn) if (s.materials[p.materialId]) courses.add(p.courseId);
    const neededFor = (mapped.requiredBy.length ? mapped.requiredBy : [target.name]).map(
      (n) => names.get(conceptKey(n)) ?? n,
    );
    return [
      `${i + 1}. ${concept.name} — ${LIKELIHOOD_TEXT[mapped.likelihood]}`,
      mapped.summary && `   What it is: ${mapped.summary}`,
      `   Needed for: ${[...new Set(neededFor)].join("; ")}${mapped.why ? ` — ${mapped.why}` : ""}`,
      `   Their record: ${describeRecord(masteryOf(concept.id), courseName)}`,
      places.length
        ? `   Taught in: ${places.join("\n              ")}`
        : "   Taught in: not found in their course materials",
      mapped.diagnostic &&
        `   Diagnostic: ${mapped.diagnostic}${mapped.rightAnswerShows ? ` (A right answer shows: ${mapped.rightAnswerShows})` : ""}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const gap = ordered.find((n) => n.first)?.concept.name;
  const content = [
    `Prerequisite map for “${target.name}” (for you; the student doesn't see it). It's saved to their knowledge map, which spans all their courses.`,
    gap ? `Most likely gap: ${gap}. ${map.reasoning}` : `No prerequisite stands out as the gap. ${map.reasoning}`.trim(),
    `What it builds on${gap ? ", most likely gap first" : ""}:\n\n${entries.join("\n\n")}`,
    `Use it: before you explain anything, ask the diagnostic question for the most likely gap, one question at a time. If they miss it, teach that prerequisite briefly from where their course taught it: open those pages with ${OPEN_TOOL} (files in their other courses open too) and cite them, so they know where to review it. Then give one quick practice question on it, check their answer with evaluate_answer, and go back to the original problem. If they answer the diagnostic well, it was probably a slip, or the gap is elsewhere: try the next most likely one, or return to the problem.`,
  ].join("\n\n");

  const detail = `${nodes.length} prerequisite${nodes.length === 1 ? "" : "s"}${courses.size > 1 ? ` · ${courses.size} courses` : ""}`;
  return { content, detail };
}

// ---------- After an answer check ----------

const ROLES = ["practiced", "prerequisite"] as const;
const OUTCOMES = ["shown", "error", "not_reached"] as const;

function parseCheckedConcepts(raw: unknown): CheckedConcept[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c): CheckedConcept[] => {
    if (!c || typeof c !== "object") return [];
    const { name, role, outcome, misconception } = c as Record<string, unknown>;
    const r = ROLES.find((v) => v === role);
    const o = OUTCOMES.find((v) => v === outcome);
    if (typeof name !== "string" || !name.trim() || !r || !o) return [];
    return [{ name: name.trim(), role: r, outcome: o, misconception: typeof misconception === "string" ? misconception : "" }];
  });
}

/**
 * Records what an answer check showed in the student's knowledge map, and, when the first error is
 * in a prerequisite, returns a note for Ainsley: their record on it across all their courses, where
 * it's taught, and a pointer to trace_prerequisites. "" otherwise.
 */
export async function afterCheck(data: Partial<EvaluateResponse>, ctx: ToolContext): Promise<string> {
  const concepts = parseCheckedConcepts(data.concepts);
  // An answer that couldn't be assessed, or read with confidence, isn't evidence.
  if (concepts.length === 0 || data.verdict === "cannot_evaluate" || data.reliable === false) return "";
  await recordCheck(concepts, { courseId: ctx.courseId, conversationId: ctx.conversationId });

  const first = data.firstErrorConcept ? concepts.find((c) => c.name === data.firstErrorConcept) : undefined;
  if (!first || first.role !== "prerequisite" || first.outcome !== "error") return "";
  const concept = findConcept(first.name);
  if (!concept) return "";
  const s = getLibrary();
  const places = describePlaces(s, concept.taughtIn);
  return [
    `Prerequisite: the first error is in ${concept.name}, which this problem relies on from earlier.`,
    `Their record on it, including this check: ${describeRecord(masteryOf(concept.id), courseNamer(s))}.`,
    places.length ? `Their course materials teach it in: ${places.join("; ")}.` : "",
    `If this is a gap rather than a slip, map it with ${PREREQUISITES_TOOL} before you explain the problem itself.`,
  ]
    .filter(Boolean)
    .join("\n");
}
