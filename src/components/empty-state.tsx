"use client";

import { CalendarDays, ClipboardCheck, Lightbulb, ListChecks } from "lucide-react";
import type { ReactNode } from "react";

const SUGGESTIONS = [
  { icon: Lightbulb, label: "Explain a concept", prompt: "Help me understand " },
  { icon: ListChecks, label: "Quiz me", prompt: "Quiz me on " },
  { icon: ClipboardCheck, label: "Check my work", prompt: "Can you check my work on this problem?\n\n" },
  { icon: CalendarDays, label: "Plan my studying", prompt: "Help me make a study plan for my exam on " },
];

export function EmptyState({
  composer,
  onSuggestion,
}: {
  composer: ReactNode;
  onSuggestion: (prompt: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex w-full flex-col items-center px-4 pb-10 pt-4">
        {/* Same vertical rhythm as Grok's home: the heading sits at ~0.8× of half the
            viewport (minus the header allowance), 28px above the composer. */}
        <div
          className="flex w-full flex-col items-center gap-7"
          style={{ paddingTop: "max(0px, calc(0.8 * max(50dvh - 64px, 240px) - 118.4px))" }}
        >
          {/* "study" draws its underline and catches a passing glint as the screen opens (globals.css). */}
          <h1 className="text-balance px-4 text-center text-[28px] font-semibold leading-9 tracking-[-0.02em] text-fg">
            What should we{" "}
            <span className="study-word relative inline-block">
              study
              <span aria-hidden="true" className="study-underline absolute inset-x-0.5 -bottom-1 h-0.5 rounded-full" />
            </span>
            ?
          </h1>

          <div className="w-full max-w-[752px]">{composer}</div>

          <div className="-mt-3 flex max-w-[752px] flex-wrap justify-center gap-2">
            {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                type="button"
                onClick={() => onSuggestion(prompt)}
                className="flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-muted transition-colors hover:border-ink/[0.12] hover:bg-ink/[0.04] hover:text-fg"
              >
                <Icon className="size-4 text-accent-soft" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
