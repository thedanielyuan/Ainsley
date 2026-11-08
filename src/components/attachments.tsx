"use client";

import { FileText, ImageIcon, LoaderCircle, Presentation, TriangleAlert, X } from "lucide-react";
import { pageUnit } from "@/lib/library";
import { loadFile } from "@/lib/storage";
import type { AttachmentMeta, MaterialKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./workspace-context";

const KIND_LABELS: Record<MaterialKind, string> = {
  pdf: "PDF",
  slides: "Slides",
  doc: "Document",
  text: "Text",
  image: "Image",
};

export function FileKindIcon({ kind, className }: { kind: MaterialKind; className?: string }) {
  const Icon = kind === "slides" ? Presentation : kind === "image" ? ImageIcon : FileText;
  return <Icon className={className} />;
}

export function fileSummary(kind: MaterialKind, pageCount?: number) {
  if (kind === "image" || !pageCount) return KIND_LABELS[kind];
  return `${KIND_LABELS[kind]} · ${pageCount} ${pageUnit(kind, pageCount)}`;
}

/**
 * Opens a student's own copy of a file (kept on their device) in a new tab, at a page for
 * PDFs. The tab opens immediately so popup blockers allow it, then loads the file.
 */
export async function openMaterialFile(materialId: string, page?: number): Promise<boolean> {
  const win = window.open("about:blank", "_blank");
  const blob = await loadFile(materialId).catch(() => undefined);
  if (!blob) {
    win?.close();
    return false;
  }
  const url = URL.createObjectURL(blob);
  const target = page && blob.type === "application/pdf" ? `${url}#page=${page}` : url;
  if (win) win.location.replace(target);
  else window.location.assign(target);
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  return true;
}

export interface AttachmentView {
  id: string;
  name: string;
  kind: MaterialKind;
  thumbnail?: string;
  status: "uploading" | "processing" | "ready" | "error";
  progress?: number;
  error?: string;
  /** Where it's filed, or a caveat ("Large file: Ainsley will search it"). */
  note?: string;
  pageCount?: number;
}

/** A file waiting in the composer. */
export function AttachmentChip({ item, onRemove }: { item: AttachmentView; onRemove: () => void }) {
  const busy = item.status === "uploading" || item.status === "processing";
  const status =
    item.status === "uploading"
      ? `Uploading ${Math.round((item.progress ?? 0) * 100)}%`
      : item.status === "processing"
        ? "Reading…"
        : item.status === "error"
          ? (item.error ?? "Upload failed")
          : (item.note ?? fileSummary(item.kind, item.pageCount));

  return (
    <div
      className={cn(
        "group/chip relative flex h-14 min-w-0 max-w-[260px] shrink-0 items-center gap-2.5 rounded-2xl border bg-ink/[0.03] p-1.5 pe-3",
        item.status === "error" ? "border-danger/30" : "border-line",
      )}
      title={item.status === "error" ? item.error : item.name}
    >
      <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink/[0.05] text-accent-soft">
        {item.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- small local data URLs
          <img src={item.thumbnail} alt="" className="size-full object-cover" />
        ) : (
          <FileKindIcon kind={item.kind} className="size-5" />
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <LoaderCircle className="size-4 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{item.name}</p>
        <p className={cn("flex items-center gap-1 truncate text-xs", item.status === "error" ? "text-danger" : "text-subtle")}>
          {item.status === "error" && <TriangleAlert className="size-3 shrink-0" />}
          <span className="truncate">{status}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.name}`}
        title="Remove"
        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line bg-elevated text-muted opacity-0 shadow transition-opacity hover:text-fg focus-visible:opacity-100 group-hover/chip:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/** Files on a sent message. */
export function MessageAttachments({ items }: { items: AttachmentMeta[] }) {
  const workspace = useWorkspace();
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
      {items.map((a) =>
        a.kind === "image" && a.thumbnail ? (
          <button
            key={a.materialId}
            type="button"
            onClick={() => workspace.openMaterial(a.materialId)}
            title={a.name}
            className="overflow-hidden rounded-2xl border border-line transition-opacity hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- small local data URLs */}
            <img src={a.thumbnail} alt={a.name} className="block size-28 object-cover" />
          </button>
        ) : (
          <button
            key={a.materialId}
            type="button"
            onClick={() => workspace.openMaterial(a.materialId)}
            title={`Open ${a.name}`}
            className="flex h-14 max-w-[260px] items-center gap-2.5 rounded-2xl border border-line bg-surface p-1.5 pe-3 text-left transition-colors hover:bg-elevated"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink/[0.05] text-accent-soft">
              <FileKindIcon kind={a.kind} className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{a.name}</span>
              <span className="block truncate text-xs text-subtle">{fileSummary(a.kind, a.pageCount)}</span>
            </span>
          </button>
        ),
      )}
    </div>
  );
}
