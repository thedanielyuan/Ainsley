import { clear, createStore, del, delMany, entries, get, set, setMany, type UseStore } from "idb-keyval";
import type { Concept, ConceptEvidence, Conversation, Course, Material, SavedProblem } from "./types";

// Everything lives in IndexedDB: thinking-block signatures and extracted course text make
// this far too large for localStorage's ~5 MB quota. idb-keyval keeps one object store per
// database, hence one database per kind of record.
const stores = new Map<string, UseStore>();

function getStore(db: string, name: string): UseStore | null {
  if (typeof indexedDB === "undefined") return null;
  let store = stores.get(db);
  if (!store) {
    store = createStore(db, name);
    stores.set(db, store);
  }
  return store;
}

const conversations = () => getStore("ainsley", "conversations");
const courses = () => getStore("ainsley-courses", "courses");
const materials = () => getStore("ainsley-materials", "materials");
// The student's original files, kept on their device so they can open them again.
const files = () => getStore("ainsley-files", "files");
// Rendered slides are derived from immutable originals; deleting a material removes both.
const previews = () => getStore("ainsley-previews", "previews");
// Handles to linked folders (File System Access API), so a course can read its folder again.
const folders = () => getStore("ainsley-folders", "folders");
// Problems Ainsley has worked out (solve_problem), by problem id, so each is solved once.
const problems = () => getStore("ainsley-problems", "problems");
// The student's knowledge map, across all their courses: concepts, what each builds on, and
// where their materials teach it.
const concepts = () => getStore("ainsley-concepts", "concepts");
// What answer checks showed about each concept, one record per concept per check.
const evidence = () => getStore("ainsley-evidence", "evidence");

async function loadAll<T>(store: UseStore | null): Promise<T[]> {
  if (!store) return [];
  const rows = await entries<string, T>(store);
  return rows.map(([, value]) => value);
}

// ---------- Conversations ----------

export const loadConversations = () => loadAll<Conversation>(conversations());

export async function saveConversation(conversation: Conversation) {
  const s = conversations();
  if (s) await set(conversation.id, conversation, s);
}

export async function removeConversation(id: string) {
  const s = conversations();
  if (s) await del(id, s);
}

export async function removeAllConversations() {
  const s = conversations();
  if (s) await clear(s);
}

// ---------- Courses ----------

export const loadCourses = () => loadAll<Course>(courses());

export async function saveCourse(course: Course) {
  const s = courses();
  if (s) await set(course.id, course, s);
}

export async function removeCourse(id: string) {
  const s = courses();
  if (s) await del(id, s);
}

// ---------- Materials and their original files ----------

export const loadMaterials = () => loadAll<Material>(materials());

export async function saveMaterial(material: Material, file?: Blob) {
  const s = materials();
  if (s) await set(material.id, material, s);
  const f = files();
  if (file && f) await set(material.id, file, f);
}

export async function removeMaterials(ids: string[]) {
  if (ids.length === 0) return;
  const s = materials();
  const f = files();
  const p = previews();
  if (s) await delMany(ids, s);
  if (f) await delMany(ids, f);
  if (p) await delMany(ids, p);
}

export async function loadFile(materialId: string): Promise<Blob | undefined> {
  const f = files();
  return f ? get<Blob>(materialId, f) : undefined;
}

const SLIDE_PREVIEW_VERSION = 1;

export async function loadSlidePreview(materialId: string): Promise<Blob | undefined> {
  const s = previews();
  if (!s) return undefined;
  const cached = await get<{ version: number; pdf: Blob }>(materialId, s);
  return cached?.version === SLIDE_PREVIEW_VERSION && cached.pdf instanceof Blob ? cached.pdf : undefined;
}

export async function saveSlidePreview(materialId: string, pdf: Blob) {
  const s = previews();
  if (s) await set(materialId, { version: SLIDE_PREVIEW_VERSION, pdf }, s);
}

// ---------- Linked folder handles ----------

export async function saveFolderHandle(courseId: string, handle: unknown) {
  const s = folders();
  if (s) await set(courseId, handle, s);
}

export async function loadFolderHandle<T>(courseId: string): Promise<T | undefined> {
  const s = folders();
  return s ? get<T>(courseId, s) : undefined;
}

export async function removeFolderHandle(courseId: string) {
  const s = folders();
  if (s) await del(courseId, s);
}

// ---------- Solved problems ----------

export async function loadProblem(id: string): Promise<SavedProblem | undefined> {
  const s = problems();
  return s ? get<SavedProblem>(id, s) : undefined;
}

export async function saveProblem(problem: SavedProblem) {
  const s = problems();
  if (s) await set(problem.id, problem, s);
}

// ---------- The knowledge map ----------

export const loadConcepts = () => loadAll<Concept>(concepts());
export const loadEvidence = () => loadAll<ConceptEvidence>(evidence());

export async function saveConcepts(list: Concept[]) {
  const s = concepts();
  if (s && list.length) await setMany(list.map((c) => [c.id, c]), s);
}

export async function saveEvidence(list: ConceptEvidence[]) {
  const s = evidence();
  if (s && list.length) await setMany(list.map((e) => [e.id, e]), s);
}

export async function removeKnowledge() {
  const c = concepts();
  const e = evidence();
  if (c) await clear(c);
  if (e) await clear(e);
}
