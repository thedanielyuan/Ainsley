import type { KnownConcept, MappedPrerequisite, PrerequisiteMap, TraceInput } from "./prerequisite-map";
import { loadConcepts, loadEvidence, removeKnowledge, saveConcepts, saveEvidence } from "./storage";
import type { CheckedConcept, Concept, ConceptEvidence, ConceptLocation } from "./types";
import { createId, formatRelative } from "./utils";

/**
 * The student's knowledge map: one graph of concepts across all their courses. Answer checks add
 * the concepts a problem exercised and whether the student's work showed each; prerequisite maps
 * (trace_prerequisites) add what each concept builds on and where their materials teach it. A
 * concept practiced in one course's chats is the same node when it turns up as a prerequisite in
 * another's, so a gap left by an earlier course can be found, and taught from that course, later.
 * Kept on this device (IndexedDB), like the library.
 */

interface KnowledgeState {
  concepts: Record<string, Concept>;
  /** Oldest first. */
  evidence: ConceptEvidence[];
}

let state: KnowledgeState = { concepts: {}, evidence: [] };
let loading: Promise<void> | null = null;

export function loadKnowledge(): Promise<void> {
  loading ??= Promise.all([loadConcepts(), loadEvidence()])
    .catch((err) => {
      console.error("[ainsley] couldn't load the knowledge map:", err);
      return [[], []] as [Concept[], ConceptEvidence[]];
    })
    .then(([concepts, evidence]) => {
      state = {
        concepts: Object.fromEntries(concepts.map((c) => [c.id, c])),
        evidence: evidence.sort((a, b) => a.at - b.at),
      };
    });
  return loading;
}

function persist(task: Promise<unknown>) {
  task.catch((err) => console.error("[ainsley] couldn't save the knowledge map:", err));
}

/** Forgets the whole map, for Settings → Data controls. */
export async function clearKnowledge() {
  await loadKnowledge();
  state = { concepts: {}, evidence: [] };
  await removeKnowledge();
}

// ---------- Finding a concept by name ----------

const FILLER = new Set(["a", "an", "the", "of", "in", "on", "for", "to", "and", "with", "by", "from", "at", "its", "their"]);

/** Names of the same concept that differ only in case, punctuation, plurals or word order share a key. */
export function conceptKey(name: string): string {
  const words =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const stems = words
    .filter((w) => !FILLER.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w));
  return [...new Set(stems)].sort().join(" ");
}

let index: { concepts: Record<string, Concept>; ids: Map<string, string> } | null = null;

function idsByKey() {
  if (index?.concepts === state.concepts) return index.ids;
  const ids = new Map<string, string>();
  for (const c of Object.values(state.concepts)) {
    for (const name of [c.name, ...c.aliases]) {
      const key = conceptKey(name);
      if (key && !ids.has(key)) ids.set(key, c.id);
    }
  }
  index = { concepts: state.concepts, ids };
  return ids;
}

export function findConcept(name: string): Concept | undefined {
  const id = idsByKey().get(conceptKey(name));
  return id ? state.concepts[id] : undefined;
}

export function getConcept(id: string): Concept | undefined {
  return state.concepts[id];
}

// ---------- Changing the map ----------

/** Concepts changed by one operation, saved together at its end. */
type Touched = Map<string, Concept>;

function put(concept: Concept, touched: Touched) {
  state = { ...state, concepts: { ...state.concepts, [concept.id]: concept } };
  touched.set(concept.id, concept);
}

function save(touched: Touched) {
  if (touched.size) persist(saveConcepts([...touched.values()]));
}

/** The concept with this name, added to the map if it isn't there yet; null for an empty name. */
function ensure(rawName: string, summary: string, now: number, touched: Touched): Concept | null {
  const name = rawName.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!conceptKey(name)) return null;
  const existing = findConcept(name);
  if (existing) {
    if (!existing.summary && summary) put({ ...existing, summary, updatedAt: now }, touched);
    return state.concepts[existing.id];
  }
  const concept: Concept = {
    id: createId(),
    name,
    aliases: [],
    summary,
    prerequisites: [],
    taughtIn: [],
    createdAt: now,
    updatedAt: now,
  };
  put(concept, touched);
  return concept;
}

/** Whether `to` is among what `from` builds on, at any depth (or is `from`). */
function reaches(from: string, to: string) {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of state.concepts[id]?.prerequisites ?? []) stack.push(p.id);
  }
  return false;
}

/** Records that `dependentId` builds on `prerequisiteId`, unless that would make a loop. */
function link(dependentId: string, prerequisiteId: string, why: string, now: number, touched: Touched) {
  const dependent = state.concepts[dependentId];
  if (!dependent || !state.concepts[prerequisiteId] || reaches(prerequisiteId, dependentId)) return;
  const existing = dependent.prerequisites.find((p) => p.id === prerequisiteId);
  if (existing && (existing.why === why || !why)) return;
  const prerequisites = existing
    ? dependent.prerequisites.map((p) => (p.id === prerequisiteId ? { id: p.id, why } : p))
    : [...dependent.prerequisites, { id: prerequisiteId, why }];
  put({ ...dependent, prerequisites, updatedAt: now }, touched);
}

export interface MappedNode {
  concept: Concept;
  mapped: MappedPrerequisite;
}

/**
 * Adds a prerequisite map to the knowledge map: its concepts (the same node when a concept is
 * already there, from any course) and what builds on what.
 */
export async function applyMap(map: PrerequisiteMap): Promise<{ target: Concept; nodes: MappedNode[] } | null> {
  await loadKnowledge();
  const now = Date.now();
  const touched: Touched = new Map();
  const target = ensure(map.target.name, map.target.summary, now, touched);
  if (!target) return null;

  const byKey = new Map<string, string>([[conceptKey(map.target.name), target.id]]);
  const nodes: Array<{ id: string; mapped: MappedPrerequisite }> = [];
  for (const mapped of map.prerequisites) {
    const concept = ensure(mapped.name, mapped.summary, now, touched);
    // The concept itself, or one listed twice.
    if (!concept || concept.id === target.id || nodes.some((n) => n.id === concept.id)) continue;
    byKey.set(conceptKey(mapped.name), concept.id);
    nodes.push({ id: concept.id, mapped });
  }
  for (const { id, mapped } of nodes) {
    const dependents = mapped.requiredBy.flatMap((name) => {
      const found = byKey.get(conceptKey(name));
      return found ? [found] : [];
    });
    for (const dependent of dependents.length ? dependents : [target.id]) link(dependent, id, mapped.why, now, touched);
  }
  save(touched);
  return {
    target: state.concepts[target.id],
    nodes: nodes.map((n) => ({ concept: state.concepts[n.id], mapped: n.mapped })),
  };
}

/** Where the student's materials teach these concepts: new places replace older ones in the same course. */
export function setTaughtIn(found: Array<{ id: string; places: ConceptLocation[] }>, maxPlaces = 4) {
  const now = Date.now();
  const touched: Touched = new Map();
  for (const { id, places } of found) {
    const concept = state.concepts[id];
    if (!concept || places.length === 0) continue;
    const courses = new Set(places.map((p) => p.courseId));
    const taughtIn = [...places, ...concept.taughtIn.filter((p) => !courses.has(p.courseId))].slice(0, maxPlaces);
    if (JSON.stringify(taughtIn) === JSON.stringify(concept.taughtIn)) continue;
    put({ ...concept, taughtIn, updatedAt: now }, touched);
  }
  save(touched);
}

/** At most this many concepts from one answer check count as evidence. */
const MAX_CHECKED = 8;

/**
 * Records what an answer check showed: each concept the problem exercised joins the map, and
 * those the student's work showed (or got wrong) become evidence for their record on it.
 */
export async function recordCheck(
  checked: CheckedConcept[],
  where: { courseId: string | null; conversationId: string },
): Promise<void> {
  await loadKnowledge();
  const now = Date.now();
  const touched: Touched = new Map();
  const events: ConceptEvidence[] = [];
  const counted = new Set<string>();
  for (const c of checked.slice(0, MAX_CHECKED)) {
    const concept = ensure(c.name, "", now, touched);
    if (!concept || c.outcome === "not_reached" || counted.has(concept.id)) continue;
    counted.add(concept.id);
    events.push({
      id: createId(),
      conceptId: concept.id,
      outcome: c.outcome,
      role: c.role,
      courseId: where.courseId,
      conversationId: where.conversationId,
      ...(c.outcome === "error" && c.misconception ? { misconception: c.misconception.slice(0, 300) } : {}),
      at: now,
    });
  }
  save(touched);
  if (events.length) {
    state = { ...state, evidence: [...state.evidence, ...events] };
    persist(saveEvidence(events));
  }
}

// ---------- The student's record on a concept ----------

// Bayesian knowledge tracing: the chance they know it before any evidence, of learning it between
// checks, of a slip when they know it, and of a lucky right answer when they don't.
const P_KNOWN = 0.5;
const P_LEARN = 0.15;
const P_SLIP = 0.15;
const P_GUESS = 0.2;

export interface Mastery {
  checks: number;
  errors: number;
  /** The estimated chance they know it now; null with no evidence. */
  estimate: number | null;
  /** When the latest check was. */
  last: number | null;
  /** The courses (null: chats outside any course) the checks were in. */
  courseIds: Array<string | null>;
  /** Misconceptions behind their errors, latest last. */
  misconceptions: string[];
}

export function masteryOf(conceptId: string): Mastery {
  let p = P_KNOWN;
  let checks = 0;
  let errors = 0;
  let last: number | null = null;
  const courseIds = new Set<string | null>();
  const misconceptions: string[] = [];
  for (const e of state.evidence) {
    if (e.conceptId !== conceptId) continue;
    checks++;
    last = e.at;
    courseIds.add(e.courseId);
    let observed: number;
    if (e.outcome === "shown") {
      observed = (p * (1 - P_SLIP)) / (p * (1 - P_SLIP) + (1 - p) * P_GUESS);
    } else {
      errors++;
      if (e.misconception && !misconceptions.includes(e.misconception)) misconceptions.push(e.misconception);
      observed = (p * P_SLIP) / (p * P_SLIP + (1 - p) * (1 - P_GUESS));
    }
    p = observed + (1 - observed) * P_LEARN;
  }
  return { checks, errors, estimate: checks ? p : null, last, courseIds: [...courseIds], misconceptions };
}

export type MasteryLevel = "known" | "mixed" | "gap" | "none";

export function masteryLevel(m: Mastery): MasteryLevel {
  if (m.estimate === null) return "none";
  if (m.estimate >= 0.8) return "known";
  return m.estimate < 0.3 ? "gap" : "mixed";
}

const LEVEL_TEXT: Record<MasteryLevel, string> = {
  known: "likely known",
  mixed: "mixed",
  gap: "likely a gap",
  none: "no record",
};

/** The student's record on a concept, for Ainsley: "likely a gap: errors in 2 of 3 answer checks, in …". */
export function describeRecord(m: Mastery, courseName: (id: string | null) => string | null, now = Date.now()) {
  if (!m.checks || m.last === null) return "no answer checks on it yet";
  const tally =
    m.errors === 0
      ? `shown correctly in ${m.checks === 1 ? "1 answer check" : `all ${m.checks} answer checks`}`
      : `errors in ${m.errors} of ${m.checks} answer check${m.checks === 1 ? "" : "s"}`;
  const courses = [...new Set(m.courseIds.map(courseName).filter((n): n is string => Boolean(n)))];
  const where = courses.length ? `, in ${courses.join(" and ")}` : "";
  const latestMisconception = m.misconceptions.at(-1)?.replace(/[\s.;]+$/, "");
  const misconception = latestMisconception ? `; misconception noted: ${latestMisconception}` : "";
  return `${LEVEL_TEXT[masteryLevel(m)]}: ${tally}${where} (latest ${formatRelative(m.last, now)})${misconception}`;
}

// ---------- What other agents see of the map ----------

const byRecent = (a: Concept, b: Concept) => b.updatedAt - a.updatedAt;

/** The concepts in the map, most recently touched first, so an answer check reuses their names. */
export async function conceptNames(limit = 300): Promise<string[]> {
  await loadKnowledge();
  return Object.values(state.concepts)
    .sort(byRecent)
    .slice(0, limit)
    .map((c) => c.name);
}

/** Adds what `id` builds on, `depth` levels down, to `into`. */
function collect(id: string, depth: number, into: Set<string>) {
  if (depth < 0 || into.has(id)) return;
  into.add(id);
  for (const p of state.concepts[id]?.prerequisites ?? []) collect(p.id, depth - 1, into);
}

/**
 * The map as the prerequisite mapper sees it: the concepts near this one in full (their record
 * and what they build on), and the rest by name, so it names the same concept the same way.
 */
export async function knownForMapper(
  input: TraceInput,
  courseName: (id: string | null) => string | null,
): Promise<KnownConcept[]> {
  await loadKnowledge();
  const all = Object.values(state.concepts);
  if (all.length === 0) return [];

  const near = new Set<string>();
  const target = findConcept(input.concept);
  if (target) collect(target.id, 3, near);
  // Concepts sharing a distinctive word with the concept or what Ainsley saw.
  const words = new Set(conceptKey(`${input.concept} ${input.context ?? ""}`).split(" ").filter((w) => w.length > 3));
  for (const c of all) if (conceptKey(c.name).split(" ").some((w) => words.has(w))) near.add(c.id);
  // Anything they've got wrong before: a gap from one course often shows up in another.
  for (const e of state.evidence) if (e.outcome === "error") near.add(e.conceptId);

  const detailed = all.filter((c) => near.has(c.id)).sort(byRecent).slice(0, 60);
  const rest = all.filter((c) => !near.has(c.id)).sort(byRecent).slice(0, 200);
  return [
    ...detailed.map((c): KnownConcept => {
      const m = masteryOf(c.id);
      const buildsOn = c.prerequisites.flatMap((p) => (state.concepts[p.id] ? [state.concepts[p.id].name] : []));
      return {
        name: c.name,
        ...(m.checks ? { record: describeRecord(m, courseName) } : {}),
        ...(buildsOn.length ? { buildsOn } : {}),
      };
    }),
    ...rest.map((c) => ({ name: c.name })),
  ];
}
