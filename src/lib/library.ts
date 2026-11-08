"use client";

import { useSyncExternalStore } from "react";
import {
  loadCourses,
  loadMaterials,
  removeCourse,
  removeFolderHandle,
  removeMaterials,
  saveCourse,
  saveMaterial,
} from "./storage";
import type { Course, LinkedFolder, Material, MaterialKind, MaterialRole, ProcessedUpload } from "./types";
import { createId, omit } from "./utils";

/**
 * The student's courses and materials. A module-level store (rather than React state) so
 * the sidebar, course page, composer and chat engine all read the same, current library.
 */

export interface PendingUpload {
  /** Becomes the material's id once processing finishes. */
  id: string;
  name: string;
  kind: MaterialKind;
  courseId: string | null;
  conversationId?: string;
  /** Set for files from a linked folder. */
  folderPath?: string;
  progress: number;
  phase: "uploading" | "processing" | "error";
  error?: string;
}

export interface LibraryState {
  ready: boolean;
  courses: Record<string, Course>;
  materials: Record<string, Material>;
  uploads: Record<string, PendingUpload>;
}

const SERVER_STATE: LibraryState = { ready: false, courses: {}, materials: {}, uploads: {} };
let state: LibraryState = SERVER_STATE;
const listeners = new Set<() => void>();

function setState(update: (s: LibraryState) => LibraryState) {
  state = update(state);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLibrary() {
  return state;
}

export function useLibrary() {
  return useSyncExternalStore(subscribe, getLibrary, () => SERVER_STATE);
}

let loading: Promise<void> | null = null;

export function loadLibrary() {
  loading ??= Promise.all([loadCourses(), loadMaterials()])
    .catch((err) => {
      console.error("[ainsley] couldn't load the course library:", err);
      return [[], []] as [Course[], Material[]];
    })
    .then(([courseList, materialList]) => {
      setState((s) => ({
        ...s,
        ready: true,
        courses: Object.fromEntries(courseList.map((c) => [c.id, c])),
        materials: Object.fromEntries(materialList.map((m) => [m.id, m])),
      }));
    });
  return loading;
}

function persist(task: Promise<unknown>) {
  task.catch((err) => console.error("[ainsley] couldn't save to the library:", err));
}

// ---------- Display helpers ----------

export const COURSE_COLORS = [
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#f472b6",
  "#22d3ee",
  "#a3e635",
];

export const ROLE_LABELS: Record<MaterialRole, string> = {
  slides: "Slides",
  notes: "Notes",
  reading: "Reading",
  "problem-set": "Problem set",
  exam: "Exam",
  syllabus: "Syllabus",
  photo: "Photo",
  other: "Document",
};

const UNIT_LABELS: Record<MaterialKind, [string, string]> = {
  pdf: ["page", "pages"],
  slides: ["slide", "slides"],
  doc: ["section", "sections"],
  text: ["section", "sections"],
  image: ["image", "images"],
};

export function pageUnit(kind: MaterialKind, count = 1) {
  const [one, many] = UNIT_LABELS[kind];
  return count === 1 ? one : many;
}

/** Materials for a course, oldest first. */
export function courseMaterials(s: LibraryState, courseId: string): Material[] {
  return Object.values(s.materials)
    .filter((m) => m.courseId === courseId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function inferRole(name: string, kind: MaterialKind): MaterialRole {
  const n = name.toLowerCase().replace(/[_\-.]+/g, " ");
  if (/syllabus|course outline|course info/.test(n)) return "syllabus";
  if (/\b(midterm|final|exam|quiz|test)s?\b/.test(n)) return "exam";
  if (/\b(hw|homework|problem ?sets?|psets?|assignments?|worksheets?|exercises?|tutorial|lab ?\d+)\b/.test(n)) {
    return "problem-set";
  }
  if (kind === "image") return "photo";
  if (/\bnotes?\b/.test(n)) return "notes";
  if (kind === "slides" || /\b(lecture|lec|slides?|deck)\b/.test(n)) return "slides";
  if (/\b(chapter|ch \d+|reading|textbook|paper|article|book)\b/.test(n)) return "reading";
  return "other";
}

// ---------- Files we accept ----------

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const UPLOAD_ACCEPT =
  ".pdf,.pptx,.docx,.txt,.md,.markdown,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

/** Classifies a file before upload, or returns why it can't be used. */
export function classifyFile(file: File): MaterialKind | { error: string } {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `${file.name} is larger than 32 MB. Try splitting it into smaller files.` };
  }
  if (file.size === 0) return { error: `${file.name} is empty.` };
  if (file.type === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "pptx") return "slides";
  if (ext === "docx") return "doc";
  if (file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) {
    return "image";
  }
  if (file.type.startsWith("text/") || ["txt", "md", "markdown"].includes(ext)) return "text";
  if (ext === "ppt" || ext === "key") {
    return { error: `${file.name}: save it as .pptx or export it as a PDF first.` };
  }
  if (ext === "doc" || ext === "pages") {
    return { error: `${file.name}: save it as .docx or export it as a PDF first.` };
  }
  return { error: `${file.name} isn't a supported file. Use PDFs, slides (.pptx), Word documents, text, or photos.` };
}

function displayName(fileName: string) {
  const base = fileName.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
  return base || fileName;
}

// ---------- Courses ----------

export interface CourseLook {
  icon: string;
  color: number;
}

/** A color no course uses yet (cycling once all are taken), so new courses stand apart. */
export function nextCourseColor() {
  const used = new Set(Object.values(state.courses).map((c) => c.color));
  const free = COURSE_COLORS.findIndex((_, i) => !used.has(i));
  return free === -1 ? Object.keys(state.courses).length % COURSE_COLORS.length : free;
}

export function createCourse(name: string, look?: CourseLook): Course {
  const now = Date.now();
  const course: Course = {
    id: createId(),
    name: name.trim() || "Untitled course",
    color: look?.color ?? nextCourseColor(),
    ...(look?.icon ? { icon: look.icon } : {}),
    createdAt: now,
    updatedAt: now,
  };
  setState((s) => ({ ...s, courses: { ...s.courses, [course.id]: course } }));
  persist(saveCourse(course));
  return course;
}

function updateCourse(id: string, update: (c: Course) => Course) {
  const current = state.courses[id];
  if (!current) return;
  const next = { ...update(current), updatedAt: Date.now() };
  setState((s) => ({ ...s, courses: { ...s.courses, [id]: next } }));
  persist(saveCourse(next));
}

export function setCourseLook(id: string, look: CourseLook) {
  updateCourse(id, (c) => ({ ...c, ...look }));
}

export function renameCourse(id: string, name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean) updateCourse(id, (c) => ({ ...c, name: clean }));
}

/** Sets (or, with undefined, clears) the folder a course keeps in step with. */
export function setCourseFolder(id: string, folder: LinkedFolder | undefined) {
  updateCourse(id, (c) => {
    const next = { ...c, folder };
    if (!folder) delete next.folder;
    return next;
  });
}

/** Deletes a course and every file in it. Chats in it stay, moving to Recents. */
export function deleteCourse(id: string) {
  const doomed = Object.values(state.materials).filter((m) => m.courseId === id);
  removeMaterialRecords(doomed);
  setState((s) => ({ ...s, courses: omit(s.courses, id) }));
  persist(removeCourse(id));
  persist(removeFolderHandle(id));
}

// ---------- Materials ----------

function updateMaterial(id: string, patch: Partial<Material>) {
  const current = state.materials[id];
  if (!current) return;
  const next = { ...current, ...patch };
  setState((s) => ({ ...s, materials: { ...s.materials, [id]: next } }));
  persist(saveMaterial(next));
}

export function renameMaterial(id: string, name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean) updateMaterial(id, { name: clean });
}

function removeMaterialRecords(list: Material[]) {
  if (list.length === 0) return;
  const ids = new Set(list.map((m) => m.id));
  setState((s) => ({
    ...s,
    materials: Object.fromEntries(Object.entries(s.materials).filter(([id]) => !ids.has(id))),
  }));
  persist(removeMaterials([...ids]));
  // Remove the copies on Anthropic's side too. Chats that referenced them replay a
  // placeholder instead (see chat-client.ts).
  for (const m of list) {
    if (m.fileId) {
      void fetch(`/api/materials?fileId=${encodeURIComponent(m.fileId)}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  }
}

export function deleteMaterial(id: string) {
  const m = state.materials[id];
  if (m) removeMaterialRecords([m]);
}

/** Files attached in a chat that isn't linked to a course go when the chat goes. */
export function deleteChatOnlyMaterials(conversationId?: string) {
  removeMaterialRecords(
    Object.values(state.materials).filter(
      (m) => m.courseId === null && (conversationId === undefined || m.conversationId === conversationId),
    ),
  );
}

/**
 * Removes chat-only files whose chat no longer exists — attached to a draft that was never
 * sent, or left behind by a chat deleted in another tab.
 */
export function pruneOrphanMaterials(conversationIds: Set<string>) {
  removeMaterialRecords(
    Object.values(state.materials).filter(
      (m) => m.courseId === null && (!m.conversationId || !conversationIds.has(m.conversationId)),
    ),
  );
}

export function dismissUpload(id: string) {
  setState((s) => ({ ...s, uploads: omit(s.uploads, id) }));
}

function patchUpload(id: string, patch: Partial<PendingUpload>) {
  setState((s) =>
    s.uploads[id] ? { ...s, uploads: { ...s.uploads, [id]: { ...s.uploads[id], ...patch } } } : s,
  );
}

function postFile(file: File, onProgress: (fraction: number) => void): Promise<ProcessedUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/materials");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as (ProcessedUpload & { error?: string }) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body && !body.error) resolve(body);
      else reject(new Error(body?.error ?? `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export interface UploadTarget {
  courseId: string | null;
  conversationId?: string;
  /** For files from a linked folder: where in it. */
  folderPath?: string;
  /** An older version of this file, deleted once the new one is in. */
  replaces?: string;
}

// A linked folder can bring dozens of files at once: process a few at a time.
const MAX_PARALLEL_UPLOADS = 4;
let uploading = 0;
const waiting: Array<() => void> = [];

function takeUploadSlot(): Promise<void> {
  if (uploading < MAX_PARALLEL_UPLOADS) {
    uploading++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseUploadSlot() {
  const next = waiting.shift();
  if (next) next();
  else uploading--;
}

/**
 * Uploads and processes a file into the library. Returns the id the material will have
 * (usable right away to track progress in `uploads`), or an error for unusable files.
 */
export function uploadMaterial(file: File, target: UploadTarget): { id: string } | { error: string } {
  const kind = classifyFile(file);
  if (typeof kind !== "string") return kind;

  const id = createId().slice(0, 10);
  const { replaces, ...pending } = target;
  setState((s) => ({
    ...s,
    uploads: {
      ...s.uploads,
      [id]: { id, name: file.name, kind, ...pending, progress: 0, phase: "uploading" },
    },
  }));

  void (async () => {
    await takeUploadSlot();
    try {
      if (!state.uploads[id]) return; // Dismissed while waiting its turn.
      const processed = await postFile(file, (fraction) => {
        patchUpload(id, fraction >= 1 ? { progress: 1, phase: "processing" } : { progress: fraction });
      });
      const upload = state.uploads[id];
      if (!upload) {
        // Dismissed while uploading: don't keep the file anywhere.
        if (processed.fileId) {
          void fetch(`/api/materials?fileId=${encodeURIComponent(processed.fileId)}`, {
            method: "DELETE",
          }).catch(() => undefined);
        }
        return;
      }
      // The course may have been deleted meanwhile.
      const courseId = upload.courseId && state.courses[upload.courseId] ? upload.courseId : null;
      const material: Material = {
        id,
        courseId,
        conversationId: upload.conversationId,
        name: displayName(processed.name),
        kind: processed.kind,
        role: inferRole(processed.name, processed.kind),
        mimeType: processed.mimeType,
        size: processed.size,
        pageCount: processed.pageCount,
        fileId: processed.fileId,
        pages: processed.pages,
        scanned: processed.scanned,
        thumbnail: processed.thumbnail,
        ...(upload.folderPath ? { folderPath: upload.folderPath, lastModified: file.lastModified } : {}),
        createdAt: Date.now(),
      };
      setState((s) => ({
        ...s,
        materials: { ...s.materials, [id]: material },
        uploads: omit(s.uploads, id),
      }));
      persist(saveMaterial(material, file));
      if (replaces) deleteMaterial(replaces);
    } catch (err) {
      patchUpload(id, {
        phase: "error",
        error: err instanceof Error ? err.message : "Upload failed.",
      });
    } finally {
      releaseUploadSlot();
    }
  })();

  return { id };
}

/** Points a file attached in an unlinked chat at that chat, once the chat exists. */
export function claimForConversation(ids: string[], conversationId: string) {
  for (const id of ids) {
    const m = state.materials[id];
    if (m && m.courseId === null && !m.conversationId) updateMaterial(id, { conversationId });
    if (state.uploads[id] && !state.uploads[id].conversationId) patchUpload(id, { conversationId });
  }
}
