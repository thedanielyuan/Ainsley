"use client";

import { classifyFile, getLibrary, setCourseFolder, uploadMaterial } from "./library";
import { loadFolderHandle, removeFolderHandle, saveFolderHandle } from "./storage";
import type { Material } from "./types";

/**
 * Linking a folder on the student's computer to a course. Where the browser has the File
 * System Access API (Chrome, Edge), the folder's handle is kept so the course can re-read it
 * and pick up new or changed files; elsewhere the folder is read once, from a folder picker.
 */

interface FileEntry {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

interface DirectoryEntry {
  kind: "directory";
  name: string;
  values(): AsyncIterable<FileEntry | DirectoryEntry>;
  queryPermission?(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" }): Promise<PermissionState>;
}

type DirectoryPicker = (options?: { id?: string; mode?: "read" }) => Promise<DirectoryEntry>;

/** At most this many files come from one folder (the most recently changed). */
export const MAX_FOLDER_FILES = 60;
const MAX_DEPTH = 4;
// Stop reading a folder this big (someone picked their whole Documents folder).
const MAX_ENTRIES = 3000;
const SKIPPED_DIRS = new Set(["node_modules", "__MACOSX"]);

export interface FolderFile {
  file: File;
  /** Path inside the folder. */
  path: string;
}

/** A folder the student picked, and the files from it Ainsley will add (newest first). */
export interface FolderPick {
  name: string;
  files: FolderFile[];
  /** Usable files found, before the MAX_FOLDER_FILES cap. */
  found: number;
  handle?: DirectoryEntry;
}

// Handles read back from storage this session, so "Sync" can ask for permission straight
// from the click without waiting on IndexedDB first.
const handles = new Map<string, DirectoryEntry>();

function hidden(name: string) {
  // ".DS_Store", "~$notes.docx" (Office's lock files) and the like aren't course materials.
  return name.startsWith(".") || name.startsWith("~$");
}

function toPick(name: string, all: FolderFile[], handle?: DirectoryEntry): FolderPick {
  const usable = all
    .filter(({ file }) => typeof classifyFile(file) === "string")
    .sort((a, b) => b.file.lastModified - a.file.lastModified);
  return { name, files: usable.slice(0, MAX_FOLDER_FILES), found: usable.length, handle };
}

async function readDirectory(dir: DirectoryEntry, prefix = "", depth = 0, out: FolderFile[] = []) {
  for await (const entry of dir.values()) {
    if (out.length >= MAX_ENTRIES) break;
    if (hidden(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      if (depth < MAX_DEPTH && !SKIPPED_DIRS.has(entry.name)) await readDirectory(entry, path, depth + 1, out);
    } else {
      out.push({ file: await entry.getFile(), path });
    }
  }
  return out;
}

/** Whether this browser can keep a folder linked (and re-read it later). */
export function canKeepFolders() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Opens the system folder picker (File System Access API). Null if cancelled. */
export async function pickFolder(): Promise<FolderPick | null> {
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) return null;
  let dir: DirectoryEntry;
  try {
    dir = await picker({ id: "ainsley-course-folder", mode: "read" });
  } catch {
    return null; // Cancelled, or access declined.
  }
  return toPick(dir.name, await readDirectory(dir), dir);
}

/** A folder chosen with <input webkitdirectory>, in browsers without the File System Access API. */
export function folderFromInput(list: FileList | File[]): FolderPick | null {
  const all = [...list];
  if (all.length === 0) return null;
  const name = all[0].webkitRelativePath.split("/")[0] || "Folder";
  const files = all
    .map((file) => ({ file, parts: file.webkitRelativePath.split("/").slice(1) }))
    .filter(
      ({ parts }) =>
        parts.length > 0 &&
        parts.length <= MAX_DEPTH + 1 &&
        !parts.some((p) => hidden(p) || SKIPPED_DIRS.has(p)),
    )
    .map(({ file, parts }) => ({ file, path: parts.join("/") }));
  return toPick(name, files);
}

/** Uploads a folder's files that the course doesn't have yet, or that changed since. */
function addFromFolder(courseId: string, pick: FolderPick) {
  const s = getLibrary();
  const known = new Map<string, Material>();
  for (const m of Object.values(s.materials)) {
    if (m.courseId === courseId && m.folderPath) known.set(m.folderPath, m);
  }
  const inFlight = new Set(
    Object.values(s.uploads)
      .filter((u) => u.courseId === courseId && u.folderPath && u.phase !== "error")
      .map((u) => u.folderPath),
  );
  let added = 0;
  let updated = 0;
  for (const { file, path } of pick.files) {
    // Keyed by folder name too, so linking a different folder never replaces this one's files.
    const folderPath = `${pick.name}/${path}`;
    if (inFlight.has(folderPath)) continue;
    const existing = known.get(folderPath);
    if (existing && existing.size === file.size && existing.lastModified === file.lastModified) continue;
    const result = uploadMaterial(file, { courseId, folderPath, replaces: existing?.id });
    if ("error" in result) continue;
    if (existing) updated++;
    else added++;
  }
  return { added, updated };
}

/** Links a picked folder to a course (replacing any other) and adds its files. */
export async function linkFolder(courseId: string, pick: FolderPick) {
  const current = getLibrary().courses[courseId]?.folder;
  const now = Date.now();
  setCourseFolder(courseId, {
    name: pick.name,
    canSync: Boolean(pick.handle),
    linkedAt: current?.name === pick.name ? current.linkedAt : now,
    syncedAt: now,
  });
  if (pick.handle) {
    handles.set(courseId, pick.handle);
    await saveFolderHandle(courseId, pick.handle).catch(() => undefined);
  } else {
    handles.delete(courseId);
    await removeFolderHandle(courseId).catch(() => undefined);
  }
  return addFromFolder(courseId, pick);
}

export type SyncResult =
  | { status: "done"; added: number; updated: number }
  /** Only from a click can the browser be asked for access again. */
  | { status: "needs-permission" }
  | { status: "denied" }
  /** Moved, renamed or deleted (or this browser never kept it): pick it again. */
  | { status: "missing" };

/**
 * Re-reads a course's linked folder and adds new or changed files. Pass `interactive` when
 * called from a click, so the browser may ask the student for access again.
 */
export async function syncFolder(courseId: string, interactive: boolean): Promise<SyncResult> {
  if (!getLibrary().courses[courseId]?.folder?.canSync) return { status: "missing" };
  let handle = handles.get(courseId);
  if (!handle) {
    handle = await loadFolderHandle<DirectoryEntry>(courseId).catch(() => undefined);
    if (!handle) return { status: "missing" };
    handles.set(courseId, handle);
  }
  let permission = (await handle.queryPermission?.({ mode: "read" })) ?? "granted";
  if (permission !== "granted") {
    if (!interactive) return { status: "needs-permission" };
    permission = (await handle.requestPermission?.({ mode: "read" }).catch(() => "denied" as const)) ?? "denied";
    if (permission !== "granted") return { status: "denied" };
  }
  let all: FolderFile[];
  try {
    all = await readDirectory(handle);
  } catch {
    return { status: "missing" };
  }
  const counts = addFromFolder(courseId, toPick(handle.name, all, handle));
  const folder = getLibrary().courses[courseId]?.folder;
  if (folder) setCourseFolder(courseId, { ...folder, syncedAt: Date.now() });
  return { status: "done", ...counts };
}

/** Unlinks the folder. Files already added stay in the course. */
export async function unlinkFolder(courseId: string) {
  handles.delete(courseId);
  setCourseFolder(courseId, undefined);
  await removeFolderHandle(courseId).catch(() => undefined);
}
