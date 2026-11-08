"use client";

import {
  Atom,
  BookOpen,
  Brain,
  Briefcase,
  Calculator,
  ChartLine,
  Code,
  Cpu,
  Dna,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Landmark,
  Languages,
  Leaf,
  Lightbulb,
  Microscope,
  Music,
  Palette,
  PenLine,
  Scale,
  Sigma,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { COURSE_COLORS, type CourseLook } from "@/lib/library";
import type { Course } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePopover, type PopoverPlacement } from "./menu";

/** The icons a course can have, like ChatGPT's project icons. The first is the default. */
export const COURSE_ICONS: Array<{ key: string; label: string; Icon: LucideIcon }> = [
  { key: "folder", label: "Folder", Icon: Folder },
  { key: "book", label: "Book", Icon: BookOpen },
  { key: "graduation", label: "Graduation cap", Icon: GraduationCap },
  { key: "flask", label: "Flask", Icon: FlaskConical },
  { key: "atom", label: "Atom", Icon: Atom },
  { key: "dna", label: "DNA", Icon: Dna },
  { key: "microscope", label: "Microscope", Icon: Microscope },
  { key: "leaf", label: "Leaf", Icon: Leaf },
  { key: "brain", label: "Brain", Icon: Brain },
  { key: "stethoscope", label: "Stethoscope", Icon: Stethoscope },
  { key: "calculator", label: "Calculator", Icon: Calculator },
  { key: "sigma", label: "Sigma", Icon: Sigma },
  { key: "chart", label: "Chart", Icon: ChartLine },
  { key: "code", label: "Code", Icon: Code },
  { key: "cpu", label: "Chip", Icon: Cpu },
  { key: "globe", label: "Globe", Icon: Globe },
  { key: "landmark", label: "Landmark", Icon: Landmark },
  { key: "scale", label: "Scales", Icon: Scale },
  { key: "languages", label: "Languages", Icon: Languages },
  { key: "pen", label: "Pen", Icon: PenLine },
  { key: "palette", label: "Palette", Icon: Palette },
  { key: "music", label: "Music", Icon: Music },
  { key: "briefcase", label: "Briefcase", Icon: Briefcase },
  { key: "lightbulb", label: "Light bulb", Icon: Lightbulb },
];

const BY_KEY = new Map(COURSE_ICONS.map((entry) => [entry.key, entry]));
const COLOR_NAMES = ["Violet", "Blue", "Green", "Amber", "Red", "Pink", "Cyan", "Lime"];
const PICKER_WIDTH = 260;

/** A course color as a CSS value: each theme has its own shade (see --course-N in globals.css). */
export function courseColor(color: number) {
  return `var(--course-${color % COURSE_COLORS.length})`;
}

/** A course's icon, drawn in its color. */
export function CourseIcon({ course, className }: { course: Pick<Course, "icon" | "color">; className?: string }) {
  const { Icon } = BY_KEY.get(course.icon ?? "") ?? COURSE_ICONS[0];
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-[18px] shrink-0", className)}
      style={{ color: courseColor(course.color) }}
    />
  );
}

/** A button showing a course's icon; it opens a picker for the icon and its color. */
export function CourseIconPicker({
  look,
  onChange,
  label = "Course icon",
  className,
  iconClassName,
  placement = "bottom-start",
}: {
  look: CourseLook;
  onChange: (look: CourseLook) => void;
  label?: string;
  className?: string;
  iconClassName?: string;
  placement?: PopoverPlacement;
}) {
  const { open, position, container, toggle, triggerRef, panelRef } = usePopover({ placement, width: PICKER_WIDTH });
  const current = BY_KEY.has(look.icon) ? look.icon : COURSE_ICONS[0].key;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "grid shrink-0 place-items-center rounded-xl transition-colors hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          open && "bg-ink/[0.06]",
          className,
        )}
      >
        <CourseIcon course={look} className={iconClassName} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{ position: "fixed", width: PICKER_WIDTH, ...position }}
            className="z-[60] overflow-y-auto rounded-xl border border-line bg-elevated p-3 shadow-popover"
          >
            <div className="flex justify-between">
              {COURSE_COLORS.map((hex, i) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={COLOR_NAMES[i] ?? `Color ${i + 1}`}
                  aria-pressed={look.color === i}
                  onClick={() => onChange({ icon: current, color: i })}
                  className={cn(
                    "grid size-7 place-items-center rounded-full transition-colors hover:bg-ink/[0.08]",
                    look.color === i && "bg-ink/[0.1]",
                  )}
                >
                  <span
                    className={cn("size-4 rounded-full", look.color === i && "ring-2 ring-fg/80")}
                    style={{ backgroundColor: courseColor(i) }}
                  />
                </button>
              ))}
            </div>
            <div className="my-2.5 h-px bg-line" />
            <div className="grid grid-cols-6 gap-1">
              {COURSE_ICONS.map(({ key, label: name, Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={name}
                  title={name}
                  aria-pressed={current === key}
                  onClick={() => onChange({ icon: key, color: look.color })}
                  className={cn(
                    "grid size-9 place-items-center rounded-lg transition-colors hover:bg-ink/[0.08]",
                    current === key && "bg-ink/[0.1]",
                  )}
                >
                  <Icon aria-hidden="true" className="size-[18px]" style={{ color: courseColor(look.color) }} />
                </button>
              ))}
            </div>
          </div>,
          container ?? document.body,
        )}
    </>
  );
}
