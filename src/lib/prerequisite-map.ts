import { readTextFields } from "./answer-check";

/**
 * Shared by the browser (which runs Ainsley's trace_prerequisites calls and keeps the student's
 * knowledge map) and /api/prerequisites (which maps what a concept builds on): the tool's input,
 * what the browser sends with it, and the map that comes back.
 */

export interface TraceInput {
  concept: string;
  /** What Ainsley has seen: the problem, the error and its misconception, what the student said. */
  context?: string;
}

const LIMITS: Record<keyof TraceInput, number> = { concept: 300, context: 20_000 };

/** Validates trace_prerequisites' input, or says what's wrong. */
export function parseTraceInput(raw: unknown): TraceInput | string {
  const out = readTextFields(raw, LIMITS);
  if (typeof out === "string") return out;
  if (!out.concept) return '`concept` must name the concept or skill, e.g. "Electric flux through a closed surface".';
  return out as TraceInput;
}

/** A concept already in the student's knowledge map, as the mapper sees it. */
export interface KnownConcept {
  name: string;
  /** How the student's answers on it went, e.g. "likely a gap: errors in 2 of 3 answer checks". */
  record?: string;
  /** The concepts it's known to build on. */
  buildsOn?: string[];
}

/** One of the student's courses: its name, and its files by module, so the map fits their level. */
export interface CourseOutline {
  name: string;
  outline: string;
}

/** POST /api/prerequisites. */
export interface TraceRequest {
  input: TraceInput;
  /** The course the chat is in, if any. */
  course: string | null;
  courses: CourseOutline[];
  known: KnownConcept[];
}

export type GapLikelihood = "likely" | "possible" | "unlikely";

export interface MappedPrerequisite {
  name: string;
  summary: string;
  /** The concepts in this map that build on it: the target, or other prerequisites. */
  requiredBy: string[];
  /** What those concepts use it for. */
  why: string;
  /** A quick question that shows whether the student has it. */
  diagnostic: string;
  /** What a right answer to the diagnostic shows. */
  rightAnswerShows: string;
  likelihood: GapLikelihood;
  /** Terms a lecture slide or textbook section teaching it would use. */
  searchQuery: string;
}

export interface PrerequisiteMap {
  target: { name: string; summary: string };
  prerequisites: MappedPrerequisite[];
  /** The prerequisite most likely behind the student's trouble, or "" when nothing points to one. */
  mostLikelyGap: string;
  reasoning: string;
}

/** Result of POST /api/prerequisites: `map` is null when the mapper declined. */
export interface TraceResponse {
  map: PrerequisiteMap | null;
  error?: string;
}

export const MAX_PREREQUISITES = 10;
const MAX_KNOWN = 300;
const MAX_COURSES = 12;

const LIKELIHOODS: GapLikelihood[] = ["likely", "possible", "unlikely"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);

/** Checks the mapper's JSON (or a request's echo of it); null if it isn't a map. */
export function parsePrerequisiteMap(raw: unknown): PrerequisiteMap | null {
  if (!isObject(raw) || !isObject(raw.target)) return null;
  const target = { name: str(raw.target.name, 200), summary: str(raw.target.summary, 500) };
  if (!target.name) return null;
  const prerequisites = list(raw.prerequisites, MAX_PREREQUISITES)
    .filter(isObject)
    .map(
      (p): MappedPrerequisite => ({
        name: str(p.name, 200),
        summary: str(p.summary, 500),
        requiredBy: list(p.required_by ?? p.requiredBy, 8)
          .map((n) => str(n, 200))
          .filter(Boolean),
        why: str(p.why, 500),
        diagnostic: str(p.diagnostic_question ?? p.diagnostic, 1_000),
        rightAnswerShows: str(p.right_answer_shows ?? p.rightAnswerShows, 500),
        likelihood: LIKELIHOODS.find((l) => l === p.likelihood) ?? "possible",
        searchQuery: str(p.search_query ?? p.searchQuery, 200),
      }),
    )
    .filter((p) => p.name);
  return {
    target,
    prerequisites,
    mostLikelyGap: str(raw.most_likely_gap ?? raw.mostLikelyGap, 200),
    reasoning: str(raw.reasoning, 1_500),
  };
}

/** Validates a request to /api/prerequisites, or says what's wrong. */
export function parseTraceRequest(raw: unknown): TraceRequest | string {
  if (!isObject(raw)) return "The request must be an object.";
  const input = parseTraceInput(raw.input);
  if (typeof input === "string") return input;
  const courses = list(raw.courses, MAX_COURSES)
    .filter(isObject)
    .map((c) => ({ name: str(c.name, 200), outline: typeof c.outline === "string" ? c.outline.slice(0, 6_000) : "" }))
    .filter((c) => c.name);
  const known = list(raw.known, MAX_KNOWN)
    .filter(isObject)
    .map((k): KnownConcept => {
      const record = str(k.record, 400);
      const buildsOn = list(k.buildsOn, 12)
        .map((n) => str(n, 200))
        .filter(Boolean);
      return { name: str(k.name, 200), ...(record ? { record } : {}), ...(buildsOn.length ? { buildsOn } : {}) };
    })
    .filter((k) => k.name);
  return { input, course: str(raw.course, 200) || null, courses, known };
}
