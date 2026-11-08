"use client";

import { Ellipsis, FolderOpen, GraduationCap, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLibrary } from "@/lib/library";
import type { Conversation, Course } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import { CourseIcon } from "./course-icon";
import { Menu } from "./menu";

/**
 * All of the student's courses, as cards. Each card opens its course, and its menu edits or
 * deletes it.
 */
export function CoursesView({
  conversations,
  onOpenCourse,
  onNewCourse,
  onEditCourse,
  onDeleteCourse,
}: {
  conversations: Conversation[];
  onOpenCourse: (id: string) => void;
  onNewCourse: () => void;
  /** Opens the dialog to edit a course's name, icon, folder and files. */
  onEditCourse: (id: string) => void;
  /** Asks to delete a course (with confirmation). */
  onDeleteCourse: (id: string) => void;
}) {
  const library = useLibrary();
  const [query, setQuery] = useState("");

  const cards = useMemo(() => {
    const files = new Map<string, number>();
    const chats = new Map<string, number>();
    const active = new Map<string, number>();
    const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);
    const touch = (id: string, ts: number) => active.set(id, Math.max(active.get(id) ?? 0, ts));
    for (const m of Object.values(library.materials)) {
      if (!m.courseId) continue;
      bump(files, m.courseId);
      touch(m.courseId, m.createdAt);
    }
    for (const c of conversations) {
      if (!c.courseId) continue;
      bump(chats, c.courseId);
      touch(c.courseId, c.updatedAt);
    }
    return Object.values(library.courses)
      .map((course) => ({
        course,
        files: files.get(course.id) ?? 0,
        chats: chats.get(course.id) ?? 0,
        updatedAt: Math.max(course.updatedAt, active.get(course.id) ?? 0),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [library.courses, library.materials, conversations]);

  const needle = query.trim().toLowerCase();
  const shown = needle ? cards.filter((c) => c.course.name.toLowerCase().includes(needle)) : cards;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-4">
        <div className="mx-auto w-full max-w-[880px] pb-16 pt-6 md:pt-12">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.02em] text-fg">Courses</h1>
            <button
              type="button"
              onClick={onNewCourse}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent pe-4 ps-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
            >
              <Plus className="size-4" />
              New course
            </button>
          </div>

          {cards.length === 0 ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-ink/[0.05] text-accent-soft">
                <GraduationCap className="size-6" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-fg">No courses yet</h2>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted">
                Create a course for each class: link its folder or upload its slides, notes and problem sets, and Ainsley
                will teach from them.
              </p>
              <button
                type="button"
                onClick={onNewCourse}
                className="mt-5 flex h-9 items-center gap-1.5 rounded-full border border-line pe-4 ps-3 text-sm font-medium text-fg transition-colors hover:bg-ink/[0.06]"
              >
                <Plus className="size-4" />
                New course
              </button>
            </div>
          ) : (
            <>
              <label className="mt-6 flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5">
                <Search className="size-4 shrink-0 text-subtle" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search courses…"
                  aria-label="Search courses"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
                />
              </label>

              {shown.length === 0 ? (
                <p className="py-12 text-center text-sm text-subtle">No courses match “{query.trim()}”.</p>
              ) : (
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {shown.map((card) => (
                    <CourseCard
                      key={card.course.id}
                      {...card}
                      onOpen={() => onOpenCourse(card.course.id)}
                      onEdit={() => onEditCourse(card.course.id)}
                      onDelete={() => onDeleteCourse(card.course.id)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CourseCard({
  course,
  files,
  chats,
  updatedAt,
  onOpen,
  onEdit,
  onDelete,
}: {
  course: Course;
  files: number;
  chats: number;
  updatedAt: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex h-full w-full flex-col gap-3 rounded-2xl border border-line p-4 text-left transition-colors hover:border-ink/[0.12] hover:bg-ink/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          menuOpen ? "border-ink/[0.12] bg-ink/[0.035]" : "bg-ink/[0.015]",
        )}
      >
        {/* pe-10 leaves room for the menu button in the corner. */}
        <span className="flex items-center gap-2.5 pe-10">
          <CourseIcon course={course} className="size-5" />
          <span className="min-w-0 truncate text-[15px] font-medium text-fg">{course.name}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          <span>
            {files} file{files === 1 ? "" : "s"} · {chats} chat{chats === 1 ? "" : "s"}
          </span>
          {course.folder && (
            <span className="flex min-w-0 items-center gap-1.5">
              <FolderOpen className="size-3.5 shrink-0 text-subtle" />
              <span className="truncate">{course.folder.name}</span>
            </span>
          )}
        </span>
        <span className="mt-auto text-xs text-subtle">Updated {formatRelative(updatedAt)}</span>
      </button>
      <div
        className={cn(
          "absolute end-2.5 top-2.5 transition-opacity",
          menuOpen
            ? "opacity-100"
            : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <Menu
          label="Course options"
          onOpenChange={setMenuOpen}
          width={200}
          triggerClassName="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/[0.08] hover:text-fg"
          trigger={<Ellipsis className="size-4" />}
          items={[
            { label: "Edit course", icon: <SlidersHorizontal className="size-4" />, onSelect: onEdit },
            { label: "Delete course", icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  );
}
