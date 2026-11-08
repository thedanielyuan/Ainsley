"use client";

import {
  ArrowUpRight,
  ChevronDown,
  Ellipsis,
  GraduationCap,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { memo, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { renameCourse, useLibrary } from "@/lib/library";
import { useLocalFlag } from "@/lib/local-flag";
import { useProfileName } from "@/lib/profile";
import type { Conversation, Course } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CourseIcon } from "./course-icon";
import { LogoMark } from "./logo";
import { Menu, type MenuEntry } from "./menu";
import { useTooltip, type TooltipSide } from "./tooltip";
import { Avatar, IconButton } from "./ui";

export interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  /** The course page being shown, if any. */
  activeCourseId: string | null;
  onOpenCourse: (id: string) => void;
  /** The courses page. */
  onOpenCourses: () => void;
  onNewCourse: () => void;
  /** Starts a new chat in a course. */
  onNewCourseChat: (courseId: string) => void;
  /** Opens the dialog to edit a course's name, icon and materials. */
  onEditCourse: (id: string) => void;
  /** Asks to delete a course (with confirmation). */
  onDeleteCourse: (id: string) => void;
  onOpenSettings: () => void;
  streaming: Record<string, true>;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSearch: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
}

export function Sidebar(props: SidebarProps) {
  const { collapsed, mobileOpen, onCloseMobile } = props;
  return (
    <>
      {/* Desktop: 256px panel, or a 56px icon rail when collapsed. */}
      <aside
        className={cn(
          "relative z-30 hidden h-full shrink-0 overflow-hidden border-r-[0.5px] border-line bg-sidebar md:block",
          "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "w-14" : "w-64",
        )}
      >
        {collapsed ? <Rail {...props} /> : <Panel {...props} />}
      </aside>

      {/* Mobile: slide-over drawer. */}
      <div
        aria-hidden="true"
        onClick={onCloseMobile}
        className={cn(
          "fixed inset-0 z-40 bg-scrim transition-opacity duration-300 md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        inert={!mobileOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] border-r-[0.5px] border-line bg-sidebar md:hidden",
          "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Panel {...props} mobile />
      </aside>
    </>
  );
}

const COURSES_HIDDEN_KEY = "ainsley:courses-hidden";
const RECENTS_HIDDEN_KEY = "ainsley:recents-hidden";
/** Under each course, its most recent chats; the course page lists the rest. */
const MAX_COURSE_CHATS = 5;

// One look for the sidebar's navigation rows: Chat, Courses and each course.
const NAV_ROW =
  "flex h-9 items-center gap-1 rounded-xl p-1.5 text-left text-sm text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

interface RowHandlers {
  activeId: string | null;
  streaming: Record<string, true>;
  renamingId: string | null;
  onSelect: (id: string) => void;
  onStartRename: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
}

function Panel(props: SidebarProps & { mobile?: boolean }) {
  const { conversations, activeId, activeCourseId, streaming, mobile } = props;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [coursesHidden, setCoursesHidden] = useLocalFlag(COURSES_HIDDEN_KEY);
  const [recentsHidden, setRecentsHidden] = useLocalFlag(RECENTS_HIDDEN_KEY);
  const coursesId = useId();
  const recentsId = useId();
  const profile = useProfileName();
  const library = useLibrary();
  const courses = useMemo(
    () => Object.values(library.courses).sort((a, b) => a.name.localeCompare(b.name)),
    [library.courses],
  );

  // A course's chats are listed under it; Recents holds the rest.
  const { byCourse, recents } = useMemo(() => {
    const byCourse = new Map<string, Conversation[]>();
    const recents: Conversation[] = [];
    for (const c of conversations) {
      if (c.courseId && library.courses[c.courseId]) {
        byCourse.set(c.courseId, [...(byCourse.get(c.courseId) ?? []), c]);
      } else {
        recents.push(c);
      }
    }
    return { byCourse, recents };
  }, [conversations, library.courses]);

  const rows: RowHandlers = {
    activeId,
    streaming,
    renamingId,
    onSelect: props.onSelect,
    onStartRename: setRenamingId,
    onRename: props.onRename,
    onDelete: props.onDelete,
  };

  return (
    <div className={cn("flex h-full flex-col", mobile ? "w-full" : "w-64")}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
        <button
          type="button"
          onClick={props.onNewChat}
          className="flex h-8 min-w-0 items-center gap-2 rounded-xl pe-2 ps-1.5 text-fg transition-colors hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <LogoMark className="size-5 shrink-0" />
          <span className="truncate text-[17px] font-semibold tracking-[-0.02em]">Ainsley</span>
        </button>
        <div className="flex shrink-0 items-center">
          <IconButton label="Search" shortcut="⌘K" aria-keyshortcuts="Meta+K" tooltip="bottom" onClick={props.onSearch}>
            <Search className="size-[18px]" />
          </IconButton>
          {mobile ? (
            <IconButton label="Close" tooltip="bottom" onClick={props.onCloseMobile}>
              <X className="size-[18px]" />
            </IconButton>
          ) : (
            <IconButton label="Collapse" tooltip="bottom" onClick={props.onToggleCollapsed}>
              <PanelLeft className="size-[18px]" />
            </IconButton>
          )}
        </div>
      </div>

      <nav className="flex flex-col px-1.5 py-0.5">
        <button type="button" onClick={props.onNewChat} className={cn("mx-1 hover:bg-ink/[0.04]", NAV_ROW)}>
          <span className="grid size-6 shrink-0 place-items-center">
            <Plus className="size-[18px]" />
          </span>
          <span className="truncate">Chat</span>
        </button>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-3">
        <section aria-label="Courses" className="pt-2">
          <div className="mx-1 flex h-8 items-center">
            <button
              type="button"
              onClick={() => setCoursesHidden(!coursesHidden)}
              aria-expanded={!coursesHidden}
              aria-controls={coursesId}
              className="group/courses flex h-full min-w-0 flex-1 items-center gap-1 rounded-lg px-[9px] text-sm font-medium text-subtle transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Courses
              <SectionChevron hidden={coursesHidden} group="courses" />
            </button>
            <div className="flex shrink-0 items-center pe-1">
              <RowButton label="Edit courses" side="bottom" onClick={props.onOpenCourses}>
                <Ellipsis className="size-4" />
              </RowButton>
              <RowButton label="New course" onClick={props.onNewCourse}>
                <Plus className="size-4" />
              </RowButton>
            </div>
          </div>
          {!coursesHidden && courses.length > 0 && (
            <ul id={coursesId} className="flex flex-col gap-px">
              {courses.map((course) => (
                <CourseItem
                  key={course.id}
                  course={course}
                  chats={byCourse.get(course.id) ?? []}
                  active={course.id === activeCourseId}
                  onOpen={props.onOpenCourse}
                  onNewChat={props.onNewCourseChat}
                  onEdit={props.onEditCourse}
                  onDelete={props.onDeleteCourse}
                  rows={rows}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="pt-2">
          <button
            type="button"
            onClick={() => setRecentsHidden(!recentsHidden)}
            aria-expanded={!recentsHidden}
            aria-controls={recentsId}
            className="group/recents mx-1 flex h-8 w-[calc(100%-0.5rem)] items-center gap-1 rounded-lg px-[9px] text-sm font-medium text-subtle transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Recents
            <SectionChevron hidden={recentsHidden} group="recents" />
          </button>
          {!recentsHidden && (
            <div id={recentsId}>
              {recents.length === 0 ? (
                <p className="mx-1 pe-2 ps-[9px] pt-1 text-sm leading-6 text-subtle">Your new chats show up here.</p>
              ) : (
                <ul className="flex flex-col gap-px">
                  {recents.map((c) => (
                    <ChatRow key={c.id} conversation={c} {...rows} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="shrink-0 px-2 pb-2 pt-1">
        <Menu
          label="Account"
          placement="top-start"
          width={232}
          triggerClassName="flex h-10 w-full items-center gap-1.5 rounded-xl py-1.5 pe-2 ps-1.5 text-sm font-medium text-fg transition-colors hover:bg-ink/[0.04]"
          trigger={
            <>
              <Avatar initial={profile.initial} />
              <span className="truncate">{profile.displayName}</span>
            </>
          }
          items={accountItems(props)}
        />
      </div>
    </div>
  );
}

/**
 * A course in the sidebar: its icon and name, with its recent chats beneath. Clicking the name
 * shows or hides those chats (or, for a course with none yet, opens it); the menu opens,
 * edits, renames or deletes the course, and the + beside it starts a new chat in it.
 */
function CourseItem({
  course,
  chats,
  active,
  onOpen,
  onNewChat,
  onEdit,
  onDelete,
  rows,
}: {
  course: Course;
  chats: Conversation[];
  active: boolean;
  onOpen: (id: string) => void;
  onNewChat: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  rows: RowHandlers;
}) {
  const [hidden, setHidden] = useLocalFlag(`ainsley:course-chats-hidden:${course.id}`);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const listId = useId();
  const hasChats = chats.length > 0;
  const shown = chats.slice(0, MAX_COURSE_CHATS);

  if (renaming) {
    return (
      <li className="mx-1">
        <RenameInput
          initial={course.name}
          label="Course name"
          indent
          onDone={(value) => {
            setRenaming(false);
            if (value !== null) renameCourse(course.id, value);
          }}
        />
      </li>
    );
  }

  return (
    <li>
      <div
        className={cn(
          "group/course mx-1 flex h-9 items-center rounded-xl transition-colors",
          active ? "bg-ink/[0.07]" : menuOpen ? "bg-ink/[0.04]" : "hover:bg-ink/[0.04]",
        )}
      >
        <button
          type="button"
          title={course.name}
          onClick={() => (hasChats ? setHidden(!hidden) : onOpen(course.id))}
          aria-expanded={hasChats ? !hidden : undefined}
          aria-controls={hasChats ? listId : undefined}
          className={cn(NAV_ROW, "h-full min-w-0 flex-1")}
        >
          <span className="grid size-6 shrink-0 place-items-center">
            <CourseIcon course={course} />
          </span>
          <span className="truncate">{course.name}</span>
        </button>
        <div
          className={cn(
            "flex shrink-0 items-center pe-1 transition-opacity",
            menuOpen
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover/course:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          <Menu
            label="Course options"
            onOpenChange={setMenuOpen}
            width={200}
            triggerClassName={ROW_BUTTON}
            trigger={<Ellipsis className="size-4" />}
            items={[
              { label: "Open course", icon: <ArrowUpRight className="size-4" />, onSelect: () => onOpen(course.id) },
              { label: "Edit course", icon: <SlidersHorizontal className="size-4" />, onSelect: () => onEdit(course.id) },
              { label: "Rename", icon: <Pencil className="size-4" />, onSelect: () => setRenaming(true) },
              { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => onDelete(course.id) },
            ]}
          />
          <RowButton label="New chat" onClick={() => onNewChat(course.id)}>
            <Plus className="size-4" />
          </RowButton>
        </div>
      </div>
      {hasChats && !hidden && (
        <ul id={listId} className="flex flex-col gap-px pt-px">
          {shown.map((c) => (
            <ChatRow key={c.id} conversation={c} indent {...rows} />
          ))}
          {chats.length > shown.length && (
            <li className="mx-1">
              <button
                type="button"
                onClick={() => onOpen(course.id)}
                className="flex h-8 w-full items-center rounded-xl ps-[34px] text-left text-xs text-subtle transition-colors hover:bg-ink/[0.04] hover:text-muted"
              >
                See all {chats.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function Rail(props: SidebarProps) {
  const profile = useProfileName();
  return (
    <div className="flex h-full w-14 flex-col items-center pb-2 pt-3">
      <IconButton label="Expand" tooltip="right" onClick={props.onToggleCollapsed} className="group/logo">
        <LogoMark className="size-5 group-hover/logo:hidden group-focus-visible/logo:hidden" />
        <PanelLeft className="hidden size-[18px] group-hover/logo:block group-focus-visible/logo:block" />
      </IconButton>
      <div className="mt-3 flex flex-col items-center gap-1">
        <IconButton
          label="Chat"
          shortcut="⇧⌘O"
          aria-keyshortcuts="Meta+Shift+O"
          tooltip="right"
          onClick={props.onNewChat}
          className="size-9"
        >
          <Plus className="size-[18px]" />
        </IconButton>
        <IconButton
          label="Search"
          shortcut="⌘K"
          aria-keyshortcuts="Meta+K"
          tooltip="right"
          onClick={props.onSearch}
          className="size-9"
        >
          <Search className="size-[18px]" />
        </IconButton>
        <IconButton label="Courses" tooltip="right" onClick={props.onOpenCourses} className="size-9">
          <GraduationCap className="size-[18px]" />
        </IconButton>
      </div>
      <div className="mt-auto">
        <Menu
          label="Account"
          tooltip="right"
          placement="top-start"
          width={232}
          triggerClassName="grid size-10 place-items-center rounded-xl transition-colors hover:bg-ink/[0.04]"
          trigger={<Avatar initial={profile.initial} />}
          items={accountItems(props)}
        />
      </div>
    </div>
  );
}

function accountItems(props: SidebarProps): MenuEntry[] {
  return [{ label: "Settings", icon: <Settings className="size-4" />, onSelect: props.onOpenSettings }];
}

// A row's small icon controls: the course menu, new chat, new course, delete chat.
const ROW_BUTTON_BASE =
  "grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const ROW_BUTTON = `${ROW_BUTTON_BASE} hover:text-fg`;

/** A 28px icon button for a sidebar row, labelled by a tooltip (to the right, outside the sidebar). */
function RowButton({
  label,
  side = "right",
  danger,
  onClick,
  children,
}: {
  label: string;
  side?: TooltipSide;
  /** Turns red on hover, for deleting. */
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const tip = useTooltip({ label, side });
  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          tip.hide();
          onClick();
        }}
        {...tip.triggerProps}
        className={danger ? `${ROW_BUTTON_BASE} hover:text-danger` : ROW_BUTTON}
      >
        {children}
      </button>
      {tip.tooltip}
    </>
  );
}

/** Points down while a section is open (shown on hover), and right once it's hidden. */
function SectionChevron({ hidden, group }: { hidden: boolean; group: "courses" | "recents" }) {
  return (
    <ChevronDown
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0 transition-[transform,opacity] duration-200",
        hidden
          ? "-rotate-90"
          : cn(
              "opacity-0 [@media(hover:none)]:opacity-100",
              group === "courses"
                ? "group-hover/courses:opacity-100 group-focus-visible/courses:opacity-100"
                : "group-hover/recents:opacity-100 group-focus-visible/recents:opacity-100",
            ),
      )}
    />
  );
}

const ChatRow = memo(function ChatRow({
  conversation,
  indent,
  activeId,
  streaming: streamingIds,
  renamingId,
  onSelect,
  onStartRename,
  onRename,
  onDelete,
}: RowHandlers & {
  conversation: Conversation;
  /** Under a course: lines the title up with the course name. */
  indent?: boolean;
}) {
  const { id, title } = conversation;
  const active = id === activeId;
  // Like Claude, a chat still answering in the background shimmers its title; the open chat
  // shows its progress in the conversation instead.
  const working = Boolean(streamingIds[id]) && !active;
  const renaming = id === renamingId;

  if (renaming) {
    return (
      <li className="mx-1">
        <RenameInput
          initial={title}
          indent={indent}
          onDone={(value) => {
            onStartRename(null);
            if (value !== null) onRename(id, value);
          }}
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group relative mx-1 flex h-9 items-center rounded-xl transition-colors",
        active ? "bg-ink/[0.07]" : "hover:bg-ink/[0.04]",
      )}
    >
      {/* Double-click renames: the row's only visible control is the delete button. */}
      <button
        type="button"
        title={title}
        onClick={() => onSelect(id)}
        onDoubleClick={() => onStartRename(id)}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl py-1.5 pe-1 text-left text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          indent ? "ps-[34px]" : "ps-[9px]",
        )}
      >
        <span className={cn("truncate", working && "title-shimmer")}>{title}</span>
        {working && <span className="sr-only">, responding</span>}
      </button>
      <div
        className={cn(
          "shrink-0 pe-1 transition-opacity",
          "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <RowButton label="Delete" danger onClick={() => onDelete(id, title)}>
          <Trash2 className="size-4" />
        </RowButton>
      </div>
    </li>
  );
});

function RenameInput({
  initial,
  label = "Chat title",
  indent,
  onDone,
}: {
  initial: string;
  label?: string;
  indent?: boolean;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (result: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(result);
  };

  return (
    <input
      autoFocus
      aria-label={label}
      maxLength={120}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(null);
      }}
      className={cn(
        "h-9 w-full rounded-xl border border-ink/15 bg-surface pe-[9px] text-sm text-fg outline-none",
        indent ? "ps-[33px]" : "ps-[9px]",
      )}
    />
  );
}
