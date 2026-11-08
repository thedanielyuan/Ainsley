"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useTooltip, type TooltipSide } from "./tooltip";

export interface MenuItem {
  label: string;
  key?: string;
  icon?: ReactNode;
  /** Secondary text on the right. */
  detail?: string;
  danger?: boolean;
  /** Renders as a radio-style option with a check mark when true. */
  checked?: boolean;
  /** Leave the menu open after selecting (e.g. choosing a course, then a module). */
  keepOpen?: boolean;
  indent?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | { type: "header"; label: string } | { type: "separator"; key: string };

type Position = { left: number; top?: number; bottom?: number; maxHeight: number };
export type PopoverPlacement = "bottom-end" | "bottom-start" | "top-start" | "top-end";

/**
 * A panel anchored to a trigger button and rendered in a portal (so scroll containers can't
 * clip it): opens on the preferred side unless that side is cramped, and closes on Escape, a
 * click outside, scrolling or resizing.
 */
export function usePopover({
  placement,
  width,
  onOpenChange,
}: {
  placement: PopoverPlacement;
  width: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  // Where the panel is portaled: the <dialog> the trigger is in (a modal one makes the rest of the
  // page inert, the workspace drawer for one), else the body.
  const [container, setContainer] = useState<Element | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = position !== null;

  const close = useCallback(() => {
    setPosition(null);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const toggle = () => {
    if (open) return close();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const alignEnd = placement.endsWith("end");
    const preferred = alignEnd ? rect.right - width : rect.left;
    const left = Math.min(Math.max(8, preferred), window.innerWidth - width - 8);
    // Open on the preferred side unless it's cramped and the other side has more room.
    const above = rect.top - 16;
    const below = window.innerHeight - rect.bottom - 16;
    const wantsTop = placement.startsWith("top");
    const top = wantsTop ? above >= 240 || above >= below : below < 240 && above > below;
    setContainer(triggerRef.current?.closest("dialog") ?? document.body);
    setPosition(
      top
        ? { left, bottom: window.innerHeight - rect.top + 6, maxHeight: above }
        : { left, top: rect.bottom + 6, maxHeight: below },
    );
    onOpenChange?.(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      !panelRef.current?.contains(target as Node) && !triggerRef.current?.contains(target as Node);
    const onPointerDown = (e: PointerEvent) => {
      if (outside(e.target)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close just this layer, not a dialog it sits in.
      e.stopPropagation();
      close();
    };
    const onScroll = (e: Event) => {
      if (outside(e.target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  return { open, position, container, toggle, close, triggerRef, panelRef };
}

/** A small popover menu. */
export function Menu({
  label,
  trigger,
  triggerClassName,
  items,
  placement = "bottom-end",
  width = 184,
  onOpenChange,
  disabled,
  tooltip,
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  items: MenuEntry[];
  placement?: PopoverPlacement;
  width?: number;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Show the label in a tooltip on this side, instead of the browser's native one. */
  tooltip?: TooltipSide;
}) {
  const { open, position, container, toggle, close, triggerRef, panelRef } = usePopover({ placement, width, onOpenChange });
  const tip = useTooltip(tooltip ? { label, side: tooltip } : null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={tooltip ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        {...tip.triggerProps}
        onClick={() => {
          tip.hide();
          toggle();
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {!open && tip.tooltip}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", width, ...position }}
            className="z-50 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-popover"
          >
            {items.map((item, i) => {
              if ("type" in item && item.type === "header") {
                return (
                  <div key={`h-${item.label}-${i}`} className="px-2.5 pb-1 pt-2 text-xs font-medium text-subtle">
                    {item.label}
                  </div>
                );
              }
              if ("type" in item && item.type === "separator") {
                return <div key={item.key} className="mx-1 my-1 h-px bg-line" />;
              }
              const entry = item as MenuItem;
              const radio = entry.checked !== undefined;
              return (
                <button
                  key={entry.key ?? entry.label}
                  type="button"
                  role={radio ? "menuitemradio" : "menuitem"}
                  aria-checked={radio ? entry.checked : undefined}
                  onClick={() => {
                    if (!entry.keepOpen) close();
                    entry.onSelect();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-ink/[0.06]",
                    entry.danger ? "text-danger" : "text-fg",
                    entry.indent && "ps-7",
                  )}
                >
                  {entry.icon}
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.detail && <span className="shrink-0 text-xs text-subtle">{entry.detail}</span>}
                  {radio && (
                    <Check className={cn("size-4 shrink-0 text-accent-soft", !entry.checked && "invisible")} />
                  )}
                </button>
              );
            })}
          </div>,
          container ?? document.body,
        )}
    </>
  );
}
