"use client";

import {
  ArrowLeft,
  Ellipsis,
  ExternalLink,
  Files,
  FolderOpen,
  LoaderCircle,
  MessageSquarePlus,
  PanelRightClose,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { canKeepFolders, folderFromInput, linkFolder, pickFolder, syncFolder, unlinkFolder, type FolderPick } from "@/lib/folders";
import {
  deleteMaterial,
  dismissUpload,
  pageUnit,
  renameMaterial,
  ROLE_LABELS,
  UPLOAD_ACCEPT,
  uploadMaterial,
  type PendingUpload,
} from "@/lib/library";
import type { Course, LinkedFolder, Material } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import { FileKindIcon, openMaterialFile } from "./attachments";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { PromptDialog } from "./dialogs";
import { MaterialPreview } from "./material-preview";
import { Menu, type MenuEntry } from "./menu";
import { IconButton } from "./ui";

/*
 * A course's materials, the way a Claude project keeps its context: the course page shows one
 * Materials row (what's there, and Add), and the row opens the Materials dialog, a list of the
 * linked folder and the files with a preview beside it.
 */

type Prompt = Omit<React.ComponentProps<typeof PromptDialog>, "onClose">;

export function hasFiles(e: DragEvent) {
  return e.dataTransfer.types.includes("Files");
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "2 new files and 1 updated file", or "" when nothing changed. */
function fileCounts({ added, updated }: { added: number; updated: number }) {
  const parts: string[] = [];
  if (added) parts.push(`${added} new file${added === 1 ? "" : "s"}`);
  if (updated) parts.push(`${updated} updated file${updated === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/** What a folder sync found, for a notice. */
export function folderNews(name: string, counts: { added: number; updated: number }) {
  const changes = fileCounts(counts);
  return changes ? `Adding ${changes} from “${name}”.` : `“${name}” is up to date.`;
}

/** "12 files · 1 linked folder", with any still uploading; "" when the course has none. */
function materialsSummary(files: number, folder: boolean, uploading: number) {
  return [files > 0 && plural(files, "file"), folder && "1 linked folder", uploading > 0 && `uploading ${uploading}`]
    .filter(Boolean)
    .join(" · ");
}

function folderStatus(folder: LinkedFolder, busy: boolean) {
  if (busy) return "Syncing…";
  return `${folder.canSync ? "Synced" : "Added"} ${formatRelative(folder.syncedAt)}`;
}

export interface MaterialActions {
  /** A folder is being linked or synced. */
  busy: boolean;
  upload: (files: File[]) => void;
  pickFiles: () => void;
  chooseFolder: () => Promise<void>;
  sync: () => Promise<void>;
  unlink: () => void;
  /** The Add menu: upload files, and link (or sync) the course's folder. */
  addItems: MenuEntry[];
  /** The hidden file and folder pickers. Render them once, beside whatever offers these actions. */
  inputs: ReactNode;
}

/** Adding to a course's materials: uploading files, and linking, syncing or unlinking its folder. */
export function useMaterialActions(course: Course | undefined, onNotify: (message: string) => void): MaterialActions {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const courseId = course?.id;
  const folder = course?.folder;

  const upload = (files: File[]) => {
    if (!courseId) return;
    for (const file of files) {
      const result = uploadMaterial(file, { courseId });
      if ("error" in result) onNotify(result.error);
    }
  };

  const pickFiles = () => {
    const input = fileInput.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const link = async (pick: FolderPick | null) => {
    if (!pick || !courseId) return;
    const changes = fileCounts(await linkFolder(courseId, pick));
    onNotify(
      changes
        ? `Linked “${pick.name}”: adding ${changes}.`
        : `Linked “${pick.name}”. It has no new PDFs, slides, documents or photos to add.`,
    );
  };

  const chooseFolder = async () => {
    // Browsers that can't keep a folder read it once, from a folder picker.
    if (!canKeepFolders()) {
      folderInput.current?.click();
      return;
    }
    setBusy(true);
    try {
      await link(await pickFolder());
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!folder || !courseId) return;
    setBusy(true);
    try {
      const result = await syncFolder(courseId, true);
      if (result.status === "done") onNotify(folderNews(folder.name, result));
      else if (result.status === "denied") onNotify(`Ainsley needs permission to read “${folder.name}” to sync it.`);
      else onNotify(`Couldn't open “${folder.name}”. If it was moved or renamed, link it again.`);
    } finally {
      setBusy(false);
    }
  };

  const unlink = () => {
    if (!folder || !courseId) return;
    void unlinkFolder(courseId);
    onNotify(`Unlinked “${folder.name}”. Its files stay in this course.`);
  };

  const addItems: MenuEntry[] = [
    { key: "upload", label: "Upload files", icon: <Upload className="size-4" />, onSelect: pickFiles },
    folder
      ? folder.canSync
        ? { key: "sync", label: "Sync folder", icon: <RefreshCw className="size-4" />, onSelect: () => void sync() }
        : { key: "again", label: "Add new files from folder", icon: <RefreshCw className="size-4" />, onSelect: () => void chooseFolder() }
      : { key: "link", label: "Link a folder", icon: <FolderOpen className="size-4" />, onSelect: () => void chooseFolder() },
  ];

  const inputs = (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) upload(files);
          e.target.value = "";
        }}
      />
      <input
        ref={(el) => {
          folderInput.current = el;
          el?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        hidden
        onChange={(e) => {
          void link(folderFromInput(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );

  return { busy, upload, pickFiles, chooseFolder, sync, unlink, addItems, inputs };
}

const ADD_BUTTON =
  "inline-flex h-7 shrink-0 items-center rounded-lg px-2.5 text-sm text-fg transition-colors hover:bg-ink/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/**
 * The course page's Materials row, like the Context row on a Claude project: what the course has,
 * and Add. Clicking it opens the Materials dialog.
 */
export function MaterialsRow({
  course,
  files,
  uploading,
  busy,
  addItems,
  onOpen,
  className,
}: {
  course: Course;
  files: number;
  uploading: number;
  busy: boolean;
  addItems: MenuEntry[];
  onOpen: () => void;
  className?: string;
}) {
  const summary = busy ? "Syncing folder…" : materialsSummary(files, Boolean(course.folder), uploading);
  return (
    <div className={cn("flex h-[52px] items-center gap-1 rounded-xl pe-2 transition-colors hover:bg-ink/[0.04]", className)}>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-xl ps-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        {busy || uploading > 0 ? (
          <LoaderCircle className="size-5 shrink-0 animate-spin text-muted" />
        ) : (
          <Files className="size-5 shrink-0 text-muted" />
        )}
        <span className="shrink-0 text-sm text-fg">Materials</span>
        {summary && <span className="min-w-0 truncate text-xs text-subtle">{summary}</span>}
      </button>
      <Menu label="Add materials" trigger="Add" triggerClassName={ADD_BUTTON} items={addItems} width={220} />
    </div>
  );
}

// Name | Size | Details | menu, once the list is wide enough; below that, details sit under the name.
// (Display classes never share an element with a conflicting one: `cn` doesn't merge them.)
const ROW_COLUMNS = "grid-cols-[minmax(0,1fr)_28px] items-center gap-3 @[560px]/list:grid-cols-[minmax(0,1fr)_96px_168px_28px]";
const ROW_GRID = `grid ${ROW_COLUMNS}`;
const WIDE_ONLY = "hidden truncate text-sm text-subtle @[560px]/list:block";
const NARROW_ONLY = "block truncate text-xs text-subtle @[560px]/list:hidden";
const ROW_MENU =
  "grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/[0.08] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/**
 * A course's linked folder and files in a dialog, as Claude shows a project's context: search, Add,
 * and a row per file that opens a preview beside the list (in its place on phones). Files dropped
 * anywhere while it's open are added to the course.
 */
export function MaterialsDialog({
  course,
  materials,
  uploads,
  actions,
  onAskAbout,
  onNotify,
  onClose,
}: {
  course: Course;
  /** The course's files, oldest first. */
  materials: Material[];
  uploads: PendingUpload[];
  actions: MaterialActions;
  /** Attaches a file to the course's composer (the dialog closes). */
  onAskAbout: (materialId: string) => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const depth = useRef(0);
  const [query, setQuery] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [over, setOver] = useState(false);
  const folder = course.folder;
  const preview = previewId ? materials.find((m) => m.id === previewId) : undefined;
  const nested = Boolean(prompt || confirm);
  const q = query?.trim().toLowerCase() ?? "";
  const files = [...materials].reverse().filter((m) => !q || m.name.toLowerCase().includes(q));
  const empty = !folder && materials.length === 0 && uploads.length === 0;
  const fromFolder = materials.filter((m) => m.folderPath).length;

  // Focus the dialog as it opens; give focus back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Escape closes the preview, then the dialog. A rename or delete confirmation opened from here,
  // a menu, and text fields (search, a page number) handle their own.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || nested) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      e.preventDefault();
      if (previewId) setPreviewId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nested, previewId, onClose]);

  // Files dropped here go into the course (not the composer behind the dialog).
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      e.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      actions.upload([...e.dataTransfer.files]);
    },
  };

  const rename = (m: Material) =>
    setPrompt({
      title: "Rename file",
      label: "Name",
      initial: m.name,
      confirmLabel: "Rename",
      onSubmit: (value) => renameMaterial(m.id, value),
    });

  const remove = (m: Material) =>
    setConfirm({
      title: "Delete file?",
      description: `“${m.name}” will be permanently deleted from this course${m.folderPath ? " (the copy in your folder stays)" : ""}. Chats that used it will no longer be able to see it.`,
      confirmLabel: "Delete",
      onConfirm: () => {
        deleteMaterial(m.id);
        if (previewId === m.id) setPreviewId(null);
      },
    });

  const openOriginal = (m: Material) => {
    void openMaterialFile(m.id).then((ok) => {
      if (!ok) onNotify("This file isn't stored on this device.");
    });
  };

  const closeButton = (
    <IconButton label="Close" tooltip="bottom" onClick={onClose}>
      <X className="size-[18px]" />
    </IconButton>
  );

  const list = (
    <div
      className={cn(
        "@container/list min-h-0 min-w-0 flex-col",
        preview ? "hidden md:flex md:w-[360px] md:shrink-0 lg:w-[400px]" : "flex flex-1",
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-1 pe-2.5 ps-5">
        <h2 id={titleId} className={cn("min-w-0 flex-1 truncate text-[15px] font-medium text-fg", query !== null && "sr-only")}>
          Materials
        </h2>
        {query === null ? (
          materials.length > 0 && (
            <IconButton label="Search files" tooltip="bottom" onClick={() => setQuery("")}>
              <Search className="size-[18px]" />
            </IconButton>
          )
        ) : (
          <label className="-ms-2 me-1 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-ink/[0.05] ps-2.5 pe-1">
            <Search className="size-4 shrink-0 text-subtle" />
            <input
              autoFocus
              value={query}
              placeholder="Search files"
              aria-label="Search files"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                e.stopPropagation();
                setQuery(query ? "" : null);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={() => setQuery(null)}
              className="grid size-6 shrink-0 place-items-center rounded-md text-subtle transition-colors hover:bg-ink/[0.08] hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </label>
        )}
        <Menu label="Add materials" trigger="Add" triggerClassName={ADD_BUTTON} items={actions.addItems} width={220} />
        {!preview && closeButton}
      </div>

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 pb-12 text-center">
          <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-line bg-ink/[0.03]">
            <Upload className="size-5 text-muted" />
          </div>
          <h3 className="text-base font-medium text-fg">Add your course materials</h3>
          <p className="mt-2 max-w-80 text-sm leading-6 text-muted">
            Slides, notes, readings and past papers. Ainsley searches them first when you ask about this course.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={actions.pickFiles} className={EMPTY_BUTTON}>
              <Upload className="size-4" />
              Upload files
            </button>
            <button
              type="button"
              onClick={() => void actions.chooseFolder()}
              disabled={actions.busy}
              className={EMPTY_BUTTON}
            >
              {actions.busy ? <LoaderCircle className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
              Link a folder
            </button>
          </div>
          <p className="mt-4 text-xs leading-5 text-subtle">PDFs, slides (.pptx), Word, text, or photos. Or drop them here.</p>
        </div>
      ) : (
        <>
          <div aria-hidden="true" className={cn(ROW_COLUMNS, "hidden h-8 shrink-0 px-5 text-xs text-subtle @[560px]/list:grid")}>
            <span>Name</span>
            <span>Size</span>
            <span>Details</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {folder && !q && (
              <FolderRow folder={folder} files={fromFolder} actions={actions} />
            )}
            {!q && uploads.map((u) => <UploadRow key={u.id} upload={u} />)}
            {files.map((m) => (
              <FileRow
                key={m.id}
                material={m}
                selected={m.id === preview?.id}
                onOpen={() => setPreviewId(m.id === preview?.id ? null : m.id)}
                onAskAbout={() => onAskAbout(m.id)}
                onOpenOriginal={() => openOriginal(m)}
                onRename={() => rename(m)}
                onDelete={() => remove(m)}
              />
            ))}
            {q && files.length === 0 && (
              <li className="px-3 py-10 text-center text-sm text-subtle">No files match “{query?.trim()}”.</li>
            )}
          </ul>
          <p className="flex h-11 shrink-0 items-center border-t border-line px-5 text-xs text-subtle">
            {materialsSummary(materials.length, Boolean(folder), uploads.length) || "No files yet"}
          </p>
        </>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      {...dropHandlers}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "dialog-in relative flex h-dvh w-full overflow-hidden bg-elevated text-fg outline-none transition-[max-width] duration-200 ease-out",
          "sm:h-[min(760px,calc(100dvh-32px))] sm:rounded-2xl sm:border sm:border-line sm:shadow-dialog",
          preview ? "sm:max-w-[1152px]" : "sm:max-w-[640px]",
        )}
      >
        {list}

        {preview && (
          <section aria-label={preview.name} className="flex min-w-0 flex-1 flex-col md:border-s md:border-line">
            <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line pe-2.5 ps-2 md:ps-4">
              <IconButton label="Back to materials" className="md:hidden" onClick={() => setPreviewId(null)}>
                <ArrowLeft className="size-[18px]" />
              </IconButton>
              <FileKindIcon kind={preview.kind} className="hidden size-4 shrink-0 text-subtle md:block" />
              <span className="min-w-0 flex-1 truncate px-1.5 text-sm font-medium text-fg" title={preview.name}>
                {preview.name}
              </span>
              <button
                type="button"
                onClick={() => onAskAbout(preview.id)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-fg transition-colors hover:bg-ink/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <MessageSquarePlus className="size-4 text-muted" />
                Ask about this
              </button>
              {/* A variant (not `hidden`) so it overrides IconButton's own inline-flex. Phones use Back. */}
              <IconButton label="Close preview" tooltip="bottom" className="max-md:hidden" onClick={() => setPreviewId(null)}>
                <PanelRightClose className="size-[18px]" />
              </IconButton>
              {closeButton}
            </div>
            <div className="min-h-0 flex-1">
              <MaterialPreview key={preview.id} materialId={preview.id} />
            </div>
          </section>
        )}

        {over && (
          <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-accent/60 bg-elevated/85 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 px-6 text-center">
              <Upload className="size-6 text-accent-soft" />
              <p className="text-base font-medium text-fg">Drop to add to {course.name}</p>
              <p className="text-sm text-muted">PDFs, slides, documents or photos</p>
            </div>
          </div>
        )}
      </div>

      {prompt && <PromptDialog {...prompt} onClose={() => setPrompt(null)} />}
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

const EMPTY_BUTTON =
  "inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-fg transition-colors hover:bg-ink/[0.06] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** Shows its menu while hovered, focused or open (always on touch screens). */
function rowMenuClass(open: boolean) {
  return cn(
    "relative z-10 shrink-0 transition-opacity",
    open ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
  );
}

function FolderRow({ folder, files, actions }: { folder: LinkedFolder; files: number; actions: MaterialActions }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = folderStatus(folder, actions.busy);
  return (
    <li className={cn(ROW_GRID, "group min-h-11 rounded-lg px-3 py-1.5 transition-colors", menuOpen ? "bg-ink/[0.04]" : "hover:bg-ink/[0.04]")}>
      <div className="flex min-w-0 items-center gap-2.5">
        {actions.busy ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-soft" />
        ) : (
          <FolderOpen className="size-4 shrink-0 text-subtle" />
        )}
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm text-fg" title={folder.name}>
              {folder.name}
            </span>
            <span className="shrink-0 text-xs text-subtle">Linked folder</span>
          </span>
          <span className={NARROW_ONLY}>{status}</span>
        </span>
      </div>
      <span className={WIDE_ONLY}>{plural(files, "file")}</span>
      <span className={WIDE_ONLY}>{status}</span>
      <div className={rowMenuClass(menuOpen)}>
        <Menu
          label="Folder options"
          onOpenChange={setMenuOpen}
          width={220}
          triggerClassName={ROW_MENU}
          trigger={<Ellipsis className="size-4" />}
          items={[
            folder.canSync
              ? { key: "sync", label: "Sync now", icon: <RefreshCw className="size-4" />, onSelect: () => void actions.sync() }
              : {
                  key: "again",
                  label: "Add new files from it",
                  icon: <RefreshCw className="size-4" />,
                  onSelect: () => void actions.chooseFolder(),
                },
            {
              key: "change",
              label: "Link a different folder",
              icon: <FolderOpen className="size-4" />,
              onSelect: () => void actions.chooseFolder(),
            },
            { key: "unlink", label: "Unlink folder", icon: <Unlink className="size-4" />, onSelect: actions.unlink },
          ]}
        />
      </div>
    </li>
  );
}

function FileRow({
  material: m,
  selected,
  onOpen,
  onAskAbout,
  onOpenOriginal,
  onRename,
  onDelete,
}: {
  material: Material;
  selected: boolean;
  onOpen: () => void;
  onAskAbout: () => void;
  onOpenOriginal: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const size = m.kind === "image" ? "—" : `${m.pageCount} ${pageUnit(m.kind, m.pageCount)}`;
  const details = [ROLE_LABELS[m.role], m.scanned ? "Scanned" : null].filter(Boolean).join(" · ");

  return (
    <li
      className={cn(
        ROW_GRID,
        "group relative min-h-11 rounded-lg px-3 py-1.5 transition-colors",
        selected ? "bg-ink/[0.07]" : menuOpen ? "bg-ink/[0.04]" : "hover:bg-ink/[0.04]",
      )}
    >
      {/* The name's button covers the whole row, so a click anywhere on it opens the preview. */}
      <button
        type="button"
        onClick={onOpen}
        title={m.name}
        aria-current={selected || undefined}
        className="flex min-w-0 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/60"
      >
        <FileKindIcon kind={m.kind} className="size-4 shrink-0 text-subtle" />
        <span className="min-w-0">
          <span className="block truncate text-sm text-fg">{m.name}</span>
          <span className={NARROW_ONLY}>{m.kind === "image" ? details : `${size} · ${details}`}</span>
        </span>
      </button>
      <span className={WIDE_ONLY}>{size}</span>
      <span className={WIDE_ONLY}>{details}</span>
      <div className={rowMenuClass(menuOpen)}>
        <Menu
          label="File options"
          onOpenChange={setMenuOpen}
          width={210}
          triggerClassName={ROW_MENU}
          trigger={<Ellipsis className="size-4" />}
          items={[
            { label: "Ask Ainsley about this", icon: <MessageSquarePlus className="size-4" />, onSelect: onAskAbout },
            { label: "Open original", icon: <ExternalLink className="size-4" />, onSelect: onOpenOriginal },
            { label: "Rename", icon: <Pencil className="size-4" />, onSelect: onRename },
            { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  );
}

function UploadRow({ upload: u }: { upload: PendingUpload }) {
  const failed = u.phase === "error";
  const progress = (
    <span className="mt-1 block h-1 w-full max-w-40 overflow-hidden rounded-full bg-ink/[0.06]">
      <span
        className={cn("block h-full rounded-full bg-accent transition-[width]", u.phase === "processing" && "animate-pulse")}
        style={{ width: `${u.phase === "processing" ? 100 : Math.max(4, u.progress * 100)}%` }}
      />
    </span>
  );
  const status = failed ? (
    <span className="block truncate text-xs text-danger" title={u.error}>
      {u.error}
    </span>
  ) : (
    progress
  );

  return (
    <li className={cn(ROW_GRID, "min-h-11 rounded-lg px-3 py-1.5")}>
      <div className="flex min-w-0 items-center gap-2.5">
        {failed ? (
          <TriangleAlert className="size-4 shrink-0 text-danger" />
        ) : (
          <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-soft" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-fg">{u.name}</span>
          <span className="block @[560px]/list:hidden">{status}</span>
        </span>
      </div>
      <span className={WIDE_ONLY}>{failed ? "—" : u.phase === "processing" ? "Reading…" : "Uploading…"}</span>
      <span className="hidden min-w-0 @[560px]/list:block">{status}</span>
      <div className="shrink-0">
        {failed && (
          <button
            type="button"
            aria-label={`Dismiss ${u.name}`}
            onClick={() => dismissUpload(u.id)}
            className={ROW_MENU}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </li>
  );
}
