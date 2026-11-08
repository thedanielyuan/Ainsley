"use client";

import { CalendarDays, ClipboardCheck, Lightbulb, ListChecks } from "lucide-react";
import type { ReactNode } from "react";

const SUGGESTIONS = [
  { icon: Lightbulb, label: "Explain a concept", prompt: "Help me understand " },
  { icon: ListChecks, label: "Quiz me", prompt: "Quiz me on " },
  { icon: ClipboardCheck, label: "Check my work", prompt: "Can you check my work on this problem?\n\n" },
  { icon: CalendarDays, label: "Plan my studying", prompt: "Help me make a study plan for my exam on " },
];

/**
 * The new-chat screen, placed like Grok's home. From 640px of chat width (Grok's breakpoint, a
 * container query on this screen) the heading sits at Grok's height and the composer 28px under
 * it; narrower, the heading sits in a centered 450px block and the composer pins to the bottom.
 */
export function EmptyState({
  composer,
  onSuggestion,
}: {
  composer: ReactNode;
  onSuggestion: (prompt: string) => void;
}) {
  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-2 pb-36 @min-[40rem]:px-4 @min-[40rem]:pb-10 @min-[40rem]:pt-4">
        {/* Grok puts the heading at 0.8× of half the viewport (less its 64px header allowance)
            minus 118.4px, measured from the top of the window: its header floats over the page.
            Ainsley's 56px header takes up room above this screen, so it comes off here too. */}
        <div className="my-auto flex h-[450px] w-full shrink-0 flex-col items-center gap-6 @min-[40rem]:my-0 @min-[40rem]:h-auto @min-[40rem]:gap-7 @min-[40rem]:pt-[max(0px,calc(0.8*max(50dvh_-_64px,240px)_-_118.4px_-_56px))]">
          {/* "study" draws its underline and catches a passing glint as the screen opens (globals.css). */}
          <h1 className="text-balance px-4 text-center text-[28px] font-semibold leading-9 tracking-[-0.02em] text-fg">
            What should we{" "}
            <span className="study-word relative inline-block">
              study
              <span aria-hidden="true" className="study-underline absolute inset-x-0.5 -bottom-1 h-0.5 rounded-full" />
            </span>
            ?
          </h1>

          <div className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-[752px] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] @min-[40rem]:static @min-[40rem]:p-0">
            {composer}
          </div>

          <div className="flex max-w-[752px] flex-wrap justify-center gap-2 @min-[40rem]:-mt-3">
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
