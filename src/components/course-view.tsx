"use client";

import { ChevronLeft, Ellipsis, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { syncFolder } from "@/lib/folders";
import { courseMaterials, deleteCourse, getLibrary, setCourseLook, useLibrary } from "@/lib/library";
import type { Conversation } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { CourseIconPicker } from "./course-icon";
import { folderNews, MaterialsDialog, MaterialsRow, useMaterialActions } from "./course-materials";
import { PromptDialog } from "./dialogs";
import { Menu } from "./menu";

type Prompt = Omit<React.ComponentProps<typeof PromptDialog>, "onClose">;

/** The confirmation for deleting a course, from its page or the sidebar. */
export function courseDeleteRequest(courseId: string, onDeleted: () => void): ConfirmRequest | null {
  const s = getLibrary();
  const course = s.courses[courseId];
  if (!course) return null;
  const files = Object.values(s.materials).filter((m) => m.courseId === courseId).length;
  return {
    title: "Delete course?",
    description: `“${course.name}” and its ${files} file${files === 1 ? "" : "s"} will be permanently deleted from Ainsley. Its chats stay and move to Recents. Nothing on your computer is touched.`,
    confirmLabel: "Delete course",
    onConfirm: () => {
      deleteCourse(courseId);
      onDeleted();
    },
  };
}

/** Folder sync auto-runs on opening a course at most this often. */
const AUTO_SYNC_MS = 60_000;

/**
 * A course page, laid out like a Claude project: the course's name, composer and chats, with a
 * slim column beside them (under the composer on narrow screens) whose Materials row opens the
 * course's folder and files in a dialog.
 */
export function CourseView({
  courseId,
  composer,
  conversations,
  streaming,
  onOpenChat,
  onRenameChat,
  onDeleteChat,
  onAllCourses,
  onEdit,
  onAskAbout,
  onNotify,
  onDeleted,
}: {
  courseId: string;
  composer: ReactNode;
  conversations: Conversation[];
  streaming: Record<string, true>;
  onOpenChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  /** Asks to delete a chat (with confirmation). */
  onDeleteChat: (id: string, title: string) => void;
  onAllCourses: () => void;
  /** Opens the dialog to edit the course's name, icon and materials. */
  onEdit: () => void;
  /** Attaches a course file to the composer. */
  onAskAbout: (materialId: string) => void;
  onNotify: (message: string) => void;
  onDeleted: () => void;
}) {
  const library = useLibrary();
  const course = library.courses[courseId];
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const actions = useMaterialActions(course, onNotify);
  const canSync = Boolean(course?.folder?.canSync);

  // Pick up files added to the linked folder since the last visit, if the browser still has
  // access (it can only ask again from a click: Sync in the Add or folder menu).
  useEffect(() => {
    const folder = getLibrary().courses[courseId]?.folder;
    if (!canSync || !folder || Date.now() - folder.syncedAt < AUTO_SYNC_MS) return;
    let cancelled = false;
    void syncFolder(courseId, false).then((result) => {
      if (!cancelled && result.status === "done" && result.added + result.updated > 0) {
        onNotify(folderNews(folder.name, result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [courseId, canSync, onNotify]);

  if (!course) return null;
  const chats = conversations.filter((c) => c.courseId === courseId);
  const materials = courseMaterials(library, courseId);
  const uploads = Object.values(library.uploads).filter((u) => u.courseId === courseId);

  return (
    // Dialogs stay outside the @container element: it contains layout, which would pin their
    // fixed overlays to the page instead of the window.
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="@container/course px-4">
        <div
          className={cn(
            "mx-auto grid w-full max-w-[720px] gap-y-6 pb-16 pt-5 md:pt-10",
            "@[1000px]/course:max-w-[1096px] @[1000px]/course:grid-cols-[minmax(0,1fr)_320px] @[1000px]/course:gap-x-14",
          )}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <button
              type="button"
              onClick={onAllCourses}
              className="-ms-1 flex w-fit items-center gap-1 rounded-lg py-0.5 pe-1.5 ps-0.5 text-sm text-muted transition-colors hover:text-fg"
            >
              <ChevronLeft className="size-4" />
              All courses
            </button>

            <header className="flex items-center gap-2">
              <CourseIconPicker
                look={{ icon: course.icon ?? "", color: course.color }}
                onChange={(look) => setCourseLook(courseId, look)}
                label="Change icon"
                className="-ms-1.5 size-10"
                iconClassName="size-6"
              />
              <h1 className="min-w-0 flex-1 truncate text-[28px] font-semibold leading-9 tracking-[-0.02em] text-fg">
                {course.name}
              </h1>
              <Menu
                label="Course options"
                triggerClassName="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg"
                trigger={<Ellipsis className="size-5" />}
                width={200}
                items={[
                  { label: "Edit course", icon: <SlidersHorizontal className="size-4" />, onSelect: onEdit },
                  {
                    label: "Delete course",
                    icon: <Trash2 className="size-4" />,
                    danger: true,
                    onSelect: () => {
                      const request = courseDeleteRequest(courseId, onDeleted);
                      if (request) setConfirm(request);
                    },
                  },
                ]}
              />
            </header>
          </div>

          <div className="min-w-0 @[1000px]/course:col-start-1">{composer}</div>

          {/* Beside the composer and chats when there's room, else between them. */}
          <aside
            aria-label="Course details"
            className="min-w-0 self-start @[1000px]/course:col-start-2 @[1000px]/course:row-span-2 @[1000px]/course:row-start-2"
          >
            <MaterialsRow
              course={course}
              files={materials.length}
              uploading={uploads.length}
              busy={actions.busy}
              addItems={actions.addItems}
              onOpen={() => setMaterialsOpen(true)}
              className="border border-line @[1000px]/course:-mx-3 @[1000px]/course:border-transparent"
            />
          </aside>

          <section aria-labelledby="course-chats-heading" className="min-w-0 @[1000px]/course:col-start-1 @[1000px]/course:row-start-3">
            <h2 id="course-chats-heading" className="pb-2 text-sm font-medium text-subtle">
              Recents
            </h2>
            {chats.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-ink/[0.1] px-4 py-6 text-center text-sm text-subtle">
                Chats you start here stay with this course.
              </p>
            ) : (
              <ul className="flex flex-col gap-px">
                {chats.map((c) => (
                  <ChatRow
                    key={c.id}
                    conversation={c}
                    streaming={Boolean(streaming[c.id])}
                    onOpen={() => onOpenChat(c.id)}
                    onRename={() =>
                      setPrompt({
                        title: "Rename chat",
                        label: "Title",
                        initial: c.title,
                        confirmLabel: "Rename",
                        onSubmit: (v) => onRenameChat(c.id, v),
                      })
                    }
                    onDelete={() => onDeleteChat(c.id, c.title)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {actions.inputs}
      {materialsOpen && (
        <MaterialsDialog
          course={course}
          materials={materials}
          uploads={uploads}
          actions={actions}
          onAskAbout={(id) => {
            setMaterialsOpen(false);
            onAskAbout(id);
          }}
          onNotify={onNotify}
          onClose={() => setMaterialsOpen(false)}
        />
      )}
      {prompt && <PromptDialog {...prompt} onClose={() => setPrompt(null)} />}
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

/** A chat in the course's Recents: opens it, with a menu (on hover) to rename or delete it. */
function ChatRow({
  conversation: c,
  streaming,
  onOpen,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  streaming: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li
      className={cn(
        "group flex items-center gap-1 rounded-xl pe-2 transition-colors",
        menuOpen ? "bg-ink/[0.04]" : "hover:bg-ink/[0.04]",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{c.title}</span>
          {streaming && <span aria-label="Generating" className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
        </span>
        <span className="text-xs text-subtle">Last message {formatRelative(c.updatedAt)}</span>
      </button>
      <div
        className={cn(
          "shrink-0 transition-opacity",
          menuOpen
            ? "opacity-100"
            : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <Menu
          label="Chat options"
          onOpenChange={setMenuOpen}
          triggerClassName="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/[0.08] hover:text-fg"
          trigger={<Ellipsis className="size-4" />}
          items={[
            { label: "Rename", icon: <Pencil className="size-4" />, onSelect: onRename },
            { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  );
}
