import { cn } from "@/lib/utils";

// The mark's two strokes and the dot at its heart, shared by the logo and the working indicator.
const MARK_PATH = "M4.75 19.5 12 4.5l7.25 15";
const DOT = { cx: 12, cy: 14.25 };

/** Ainsley's mark, in `ink`: white on dark backgrounds, black on light ones (where white wouldn't show). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("text-ink", className)} aria-hidden="true">
      <path d={MARK_PATH} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle {...DOT} r="2.25" fill="currentColor" />
    </svg>
  );
}

/**
 * Ainsley's mark at work, for the "Working for 12s" row: a light glides up one side of the mark,
 * over the top and down the other, and the dot sparks in the accent as it passes (.working-mark in
 * globals.css). Drawn faint in the current color, so it sits with the timeline's step icons.
 */
export function WorkingMark({ className }: { className?: string }) {
  const stroke = { d: MARK_PATH, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="3 3 18 18" fill="none" className={cn("working-mark size-4", className)} aria-hidden="true">
      <path {...stroke} className="working-mark-track" stroke="currentColor" />
      <path {...stroke} className="working-mark-light" pathLength={1} />
      <circle {...DOT} r="2.1" className="working-mark-spark" />
    </svg>
  );
}
