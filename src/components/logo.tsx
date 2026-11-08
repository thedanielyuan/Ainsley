import { cn } from "@/lib/utils";

/** Ainsley's mark, in `ink`: white on dark backgrounds, black on light ones (where white wouldn't show). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("text-ink", className)} aria-hidden="true">
      <path
        d="M4.75 19.5 12 4.5l7.25 15"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14.25" r="2.25" fill="currentColor" />
    </svg>
  );
}
