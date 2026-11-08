"use client";

import { useCallback, useState } from "react";
import type { AttachmentView } from "@/components/attachments";
import { fileSummary } from "@/components/attachments";
import { MAX_VIEW_PAGES } from "./course-tools";
import {
  deleteMaterial,
  dismissUpload,
  isSearchable,
  uploadMaterial,
  type LibraryState,
  type UploadTarget,
} from "./library";
import type { ChatScope } from "./types";

export interface DraftAttachment {
  id: string;
  /** Uploaded for this message (removing it deletes it) or picked from the library. */
  origin: "upload" | "library";
}

export interface Draft {
  text: string;
  attachments: DraftAttachment[];
  /** Course scope for a chat that doesn't exist yet. */
  scope?: ChatScope;
}

const EMPTY: Draft = { text: "", attachments: [] };

/** Unsent messages, keyed by chat id ("new" for the home screen, "course:<id>" on a course page). */
export function useDrafts() {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const update = useCallback((key: string, fn: (d: Draft) => Draft) => {
    setDrafts((all) => ({ ...all, [key]: fn(all[key] ?? EMPTY) }));
  }, []);

  const get = useCallback((key: string) => drafts[key] ?? EMPTY, [drafts]);

  const setText = useCallback((key: string, text: string) => update(key, (d) => ({ ...d, text })), [update]);

  const setScope = useCallback(
    (key: string, scope: ChatScope) => update(key, (d) => ({ ...d, scope })),
    [update],
  );

  /** Starts uploading files into the library and attaches them; returns errors for files it can't take. */
  const addFiles = useCallback(
    (key: string, files: File[], target: UploadTarget): string[] => {
      const errors: string[] = [];
      const added: DraftAttachment[] = [];
      for (const file of files) {
        const result = uploadMaterial(file, target);
        if ("error" in result) errors.push(result.error);
        else added.push({ id: result.id, origin: "upload" });
      }
      if (added.length) update(key, (d) => ({ ...d, attachments: [...d.attachments, ...added] }));
      return errors;
    },
    [update],
  );

  const addFromLibrary = useCallback(
    (key: string, ids: string[]) =>
      update(key, (d) => {
        const have = new Set(d.attachments.map((a) => a.id));
        const added = ids.filter((id) => !have.has(id)).map((id) => ({ id, origin: "library" as const }));
        return { ...d, attachments: [...d.attachments, ...added] };
      }),
    [update],
  );

  const removeAttachment = useCallback(
    (key: string, id: string) => {
      const item = (drafts[key] ?? EMPTY).attachments.find((a) => a.id === id);
      if (item?.origin === "upload") {
        dismissUpload(id);
        deleteMaterial(id);
      }
      update(key, (d) => ({ ...d, attachments: d.attachments.filter((a) => a.id !== id) }));
    },
    [drafts, update],
  );

  /** After sending: keeps the files (they're on the message now), clears the draft. */
  const clear = useCallback(
    (key: string) =>
      setDrafts((all) => {
        const scope = all[key]?.scope;
        return { ...all, [key]: { ...EMPTY, scope } };
      }),
    [],
  );

  return { get, setText, setScope, addFiles, addFromLibrary, removeAttachment, clear };
}

/** How a draft's attachments look in the composer, and whether it can be sent. */
export function draftStatus(draft: Draft, s: LibraryState) {
  const views: AttachmentView[] = [];
  const readyIds: string[] = [];
  let busy = false;
  for (const { id } of draft.attachments) {
    const upload = s.uploads[id];
    if (upload) {
      if (upload.phase !== "error") busy = true;
      views.push({
        id,
        name: upload.name,
        kind: upload.kind,
        status: upload.phase === "error" ? "error" : upload.phase,
        progress: upload.progress,
        error: upload.error,
      });
      continue;
    }
    const m = s.materials[id];
    if (!m) continue; // Deleted meanwhile.
    readyIds.push(id);
    const course = m.courseId ? s.courses[m.courseId] : undefined;
    let note = course ? `Saved to ${course.name}` : fileSummary(m.kind, m.pageCount);
    if (m.kind === "pdf" && m.pageCount > MAX_VIEW_PAGES) {
      note =
        !m.scanned || isSearchable(m)
          ? "Long PDF: Ainsley will search it"
          : s.transcribing[id]
            ? "Long scan: reading its text…"
            : "Long scan: too big to view whole";
    } else if (m.scanned) {
      note = "Scanned: Ainsley will view it";
    }
    views.push({ id, name: m.name, kind: m.kind, thumbnail: m.thumbnail, status: "ready", note, pageCount: m.pageCount });
  }
  const canSubmit = !busy && (draft.text.trim().length > 0 || readyIds.length > 0);
  return { views, readyIds, busy, canSubmit };
}
