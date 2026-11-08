"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useTooltip, type TooltipSide } from "./tooltip";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  /** Show the label in a tooltip on this side, instead of the browser's slow native one. */
  tooltip?: TooltipSide;
  /** A keyboard shortcut to show in the tooltip. */
  shortcut?: string;
};

export function IconButton({ label, tooltip, shortcut, className, children, ...props }: IconButtonProps) {
  const tip = useTooltip(tooltip ? { label, shortcut, side: tooltip } : null);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={tooltip ? undefined : label}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-muted transition-colors",
          "hover:bg-ink/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        {...props}
        {...tip.triggerProps}
      >
        {children}
      </button>
      {tip.tooltip}
    </>
  );
}

/** The student's initial in an accent-colored circle. */
export function Avatar({ initial, className }: { initial: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-accent-strong text-xs font-semibold text-on-accent",
        className,
      )}
    >
      {initial}
    </span>
  );
}

export function CopyButton({
  getText,
  label = "Copy",
  className,
}: {
  getText: () => string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <IconButton
      label={copied ? "Copied" : label}
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => setCopied(true));
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </IconButton>
  );
}
