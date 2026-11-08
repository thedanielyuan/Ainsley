"use client";

import { Check, FolderOpen, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { canKeepFolders, folderFromInput, pickFolder, type FolderPick } from "@/lib/folders";
import {
  classifyFile,
  courseMaterials,
  nextCourseColor,
  UPLOAD_ACCEPT,
  useLibrary,
  type CourseLook,
} from "@/lib/library";
import type { Course } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileKindIcon, fileSummary } from "./attachments";
import { CourseIconPicker } from "./course-icon";

/** Modal shell shared by the dialogs below. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = 440,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
  width?: number;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: width }}
        className="dialog-in flex max-h-[85dvh] w-full flex-col rounded-2xl border border-line bg-panel shadow-dialog"
      >
        <div className="px-5 pt-5">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description && <p className="mt-1.5 text-sm leading-6 text-muted">{description}</p>}
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">{children}</div>}
        <div className="flex justify-end gap-2 px-5 pb-5 pt-5">{footer}</div>
      </div>
    </div>
  );
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "h-9 rounded-full border border-line px-4 text-sm font-medium text-fg transition-colors hover:bg-ink/[0.06]",
        props.className,
      )}
    />
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "h-9 rounded-full bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-default disabled:opacity-50",
        props.className,
      )}
    />
  );
}

export const inputClass =
  "h-10 w-full rounded-xl border border-line bg-bg/60 px-3 text-[15px] text-fg outline-none placeholder:text-subtle";

/** A one-field dialog, e.g. to rename something. */
export function PromptDialog({
  title,
  label,
  initial = "",
  placeholder,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
    onClose();
  };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </PrimaryButton>
        </>
      }
    >
      <label className="block text-sm text-muted">
        {label}
        <input
          autoFocus
          value={value}
          maxLength={120}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className={cn(inputClass, "mt-1.5")}
        />
      </label>
    </Dialog>
  );
}

export interface CourseDialogValues {
  name: string;
  look: CourseLook;
  /** A folder picked here: linked to the course, replacing any other. */
  folder: FolderPick | null;
  /** Files picked here, to upload into the course. */
  files: File[];
  /** Editing: the course's current folder was removed. */
  unlinkFolder: boolean;
}

/**
 * Creates a course, or (given `course`) edits one: its icon, name and materials (link a
 * folder or upload files).
 */
export function CourseDialog({
  course,
  onSubmit,
  onClose,
}: {
  course?: Course;
  onSubmit: (values: CourseDialogValues) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [look, setLook] = useState<CourseLook>(() =>
    course ? { icon: course.icon ?? "folder", color: course.color } : { icon: "folder", color: nextCourseColor() },
  );
  const nameId = useId();
  const [folder, setFolder] = useState<FolderPick | null>(null);
  const [unlinkFolder, setUnlinkFolder] = useState(false);
  // The folder the course already has, unless it's being removed or replaced.
  const linked = course?.folder && !unlinkFolder && !folder ? course.folder : null;
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const keepsFolders = canKeepFolders();

  const acceptPick = (pick: FolderPick | null) => {
    if (!pick) return;
    setFolder(pick);
    if (!course) setName((current) => current || pick.name);
  };

  const chooseFolder = async () => {
    if (!keepsFolders) {
      folderInput.current?.click();
      return;
    }
    setReading(true);
    try {
      acceptPick(await pickFolder());
    } finally {
      setReading(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    const usable = chosen.filter((f) => typeof classifyFile(f) === "string");
    setSkipped(chosen.length - usable.length);
    setFiles((current) => {
      const seen = new Set(current.map((f) => `${f.name}:${f.size}`));
      return [...current, ...usable.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  };

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), look, folder, files, unlinkFolder });
    onClose();
  };

  return (
    <Dialog
      title={course ? "Edit course" : "New course"}
      description={course ? undefined : "Ainsley reads your course materials first when you ask about this course."}
      onClose={onClose}
      width={480}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={!name.trim()}>
            {course ? "Save" : "Create course"}
          </PrimaryButton>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
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
          acceptPick(folderFromInput(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <label htmlFor={nameId} className="block text-sm text-muted">
        Course name
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <CourseIconPicker
          look={look}
          onChange={setLook}
          label="Choose icon"
          className="size-10 rounded-xl border border-line bg-bg/60"
          iconClassName="size-5"
        />
        <input
          id={nameId}
          autoFocus
          value={name}
          maxLength={120}
          placeholder="e.g. BIO 201 · Cell Biology"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className={inputClass}
        />
      </div>

      <div className="mt-5 text-sm text-muted">
        {course ? "Add materials" : "Materials"} <span className="text-subtle">(optional)</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <SourceButton
          icon={reading ? <LoaderCircle className="size-[18px] animate-spin" /> : <FolderOpen className="size-[18px]" />}
          title={folder || linked ? "Change folder" : "Link a folder"}
          detail={keepsFolders ? "New files in it sync in" : "Adds the files in it"}
          onClick={() => void chooseFolder()}
          disabled={reading}
        />
        <SourceButton
          icon={<Upload className="size-[18px]" />}
          title="Upload files"
          detail="PDFs, slides, docs, photos"
          onClick={() => fileInput.current?.click()}
        />
      </div>

      {(linked || folder || files.length > 0 || skipped > 0) && (
        <div className="mt-3 flex flex-col gap-1.5">
          {linked && (
            <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <FolderOpen className="size-4 shrink-0 text-accent-soft" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{linked.name}</div>
                <div className="truncate text-xs text-subtle">Linked folder</div>
              </div>
              <RemoveButton label={`Unlink ${linked.name}`} onClick={() => setUnlinkFolder(true)} />
            </div>
          )}
          {folder && (
            <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <FolderOpen className="size-4 shrink-0 text-accent-soft" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{folder.name}</div>
                <div className="truncate text-xs text-subtle">
                  {folder.files.length === 0
                    ? "No PDFs, slides, documents or photos in this folder"
                    : folder.found > folder.files.length
                      ? `The ${folder.files.length} most recent of ${folder.found} files`
                      : `${folder.files.length} file${folder.files.length === 1 ? "" : "s"}`}
                </div>
              </div>
              <RemoveButton label={`Remove ${folder.name}`} onClick={() => setFolder(null)} />
            </div>
          )}
          {files.map((f) => {
            const kind = classifyFile(f);
            return (
              <div key={`${f.name}:${f.size}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                {typeof kind === "string" && <FileKindIcon kind={kind} className="size-4 shrink-0 text-accent-soft" />}
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.name}</span>
                <RemoveButton
                  label={`Remove ${f.name}`}
                  onClick={() => setFiles((current) => current.filter((x) => x !== f))}
                />
              </div>
            );
          })}
          {skipped > 0 && (
            <p className="px-1 text-xs text-subtle">
              {skipped} file{skipped === 1 ? " isn't a" : "s aren't"} supported type{skipped === 1 ? "" : "s"}: use PDFs,
              slides (.pptx), Word, text, or photos.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function SourceButton({
  icon,
  title,
  detail,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start gap-1.5 rounded-xl border border-line bg-ink/[0.02] p-3 text-left transition-colors hover:border-ink/[0.12] hover:bg-ink/[0.05] disabled:opacity-60"
    >
      <span className="text-accent-soft">{icon}</span>
      <span className="text-sm font-medium text-fg">{title}</span>
      <span className="text-xs leading-4 text-subtle">{detail}</span>
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-lg text-subtle transition-colors hover:bg-ink/[0.06] hover:text-fg"
    >
      <X className="size-4" />
    </button>
  );
}

/** Pick files from a course to attach to a message. */
export function MaterialPickerDialog({
  courseId,
  exclude,
  onPick,
  onClose,
}: {
  courseId: string;
  exclude: string[];
  onPick: (ids: string[]) => void;
  onClose: () => void;
}) {
  const library = useLibrary();
  const course = library.courses[courseId];
  const materials = courseMaterials(library, courseId)
    .filter((m) => !exclude.includes(m.id))
    .reverse();
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <Dialog
      title="Attach from course materials"
      description={course ? `Files in ${course.name}. Ainsley will read the ones you pick in full.` : undefined}
      onClose={onClose}
      width={480}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            disabled={picked.length === 0}
            onClick={() => {
              onPick(picked);
              onClose();
            }}
          >
            {picked.length > 1 ? `Attach ${picked.length} files` : "Attach"}
          </PrimaryButton>
        </>
      }
    >
      {materials.length === 0 ? (
        <p className="py-6 text-center text-sm text-subtle">No other files in this course yet.</p>
      ) : (
        <div className="flex flex-col pb-1">
          {materials.map((m) => {
            const on = picked.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
                  on ? "bg-ink/[0.07]" : "hover:bg-ink/[0.04]",
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink/[0.05] text-accent-soft">
                  <FileKindIcon kind={m.kind} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{m.name}</span>
                  <span className="block truncate text-xs text-subtle">{fileSummary(m.kind, m.pageCount)}</span>
                </span>
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-md border",
                    on ? "border-accent bg-accent text-on-accent" : "border-line",
                  )}
                >
                  {on && <Check className="size-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
