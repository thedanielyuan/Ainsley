"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useLibrary } from "@/lib/library";
import type { ChatScope } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CourseIcon } from "./course-icon";
import { Menu, type MenuEntry } from "./menu";

/**
 * The composer's course chip, for chats that aren't in a course yet. Adding a course puts the
 * chat in it: Ainsley draws on its materials, and the chat is listed under the course.
 */
export function CoursePicker({
  scope,
  onChange,
  onNewCourse,
  compact,
}: {
  scope: ChatScope;
  onChange: (scope: ChatScope) => void;
  onNewCourse: () => void;
  /** In the one-row composer: narrower, leaving room for the text. */
  compact?: boolean;
}) {
  const library = useLibrary();
  const courses = Object.values(library.courses).sort((a, b) => a.name.localeCompare(b.name));
  const course = scope.courseId ? library.courses[scope.courseId] : undefined;

  const items: MenuEntry[] = [];
  if (courses.length > 0) {
    items.push({ type: "header", label: "Course" });
    items.push({
      key: "none",
      label: "No course",
      checked: !course,
      onSelect: () => onChange({ courseId: null }),
    });
    for (const c of courses) {
      items.push({
        key: c.id,
        label: c.name,
        icon: <CourseIcon course={c} className="size-4" />,
        checked: course?.id === c.id,
        onSelect: () => onChange({ courseId: c.id }),
      });
    }
    items.push({ type: "separator", key: "sep" });
  }
  items.push({ key: "new", label: "New course…", icon: <Plus className="size-4" />, onSelect: onNewCourse });

  return (
    <Menu
      label={course ? `Course: ${course.name}` : "Add course"}
      placement="top-start"
      width={264}
      triggerClassName={cn(
        "flex h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        compact ? "max-w-[min(220px,30vw)]" : "max-w-[min(260px,45vw)]",
        course
          ? "border-line bg-ink/[0.03] text-fg hover:bg-ink/[0.06]"
          : "border-transparent text-muted hover:bg-ink/[0.06] hover:text-fg",
      )}
      trigger={
        <>
          {course && <CourseIcon course={course} className="size-4" />}
          <span className="truncate">{course ? course.name : "Add course"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-subtle" />
        </>
      }
      items={items}
    />
  );
}
