"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";

export type TooltipSide = "right" | "bottom";

export interface TooltipContent {
  label: string;
  /** A keyboard shortcut, shown after the label. */
  shortcut?: string;
  side: TooltipSide;
}

const OPEN_DELAY_MS = 300;
// Moving from one labelled icon to the next shows the next label straight away.
const WARM_MS = 400;
let lastHidden = 0;

/**
 * A label for an icon-only control: shown on mouse hover (after a short delay) or keyboard
 * focus, in a portal so the collapsed sidebar's overflow can't clip it. Spread `triggerProps`
 * on the control and render `tooltip` beside it. Pass null to turn it off.
 */
export function useTooltip(content: TooltipContent | null) {
  // The trigger's box, and where to portal the label: the <dialog> the trigger is in (a modal one
  // makes the rest of the page inert), else the body.
  const [anchor, setAnchor] = useState<{ rect: DOMRect; container: Element } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const trigger = useRef<HTMLElement | null>(null);
  const shown = useRef(false);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!shown.current) return;
    shown.current = false;
    lastHidden = Date.now();
    setAnchor(null);
  }, []);

  const show = useCallback((el: HTMLElement, immediate: boolean) => {
    window.clearTimeout(timer.current);
    trigger.current = el;
    const open = () => {
      shown.current = true;
      setAnchor({ rect: el.getBoundingClientRect(), container: el.closest("dialog") ?? document.body });
    };
    if (immediate || Date.now() - lastHidden < WARM_MS) open();
    else timer.current = window.setTimeout(open, OPEN_DELAY_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!anchor) return;
    // Only scrolling that moves the trigger (not, say, a streaming reply) hides the label.
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target === document || (target instanceof Node && target.contains(trigger.current))) hide();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hide);
    };
  }, [anchor, hide]);

  if (!content) return { triggerProps: {}, tooltip: null, hide };

  return {
    hide,
    triggerProps: {
      onPointerEnter: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === "mouse") show(e.currentTarget, false);
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, true);
      },
      onBlur: hide,
    },
    tooltip: anchor ? <TooltipBubble anchor={anchor.rect} container={anchor.container} {...content} /> : null,
  };
}

function TooltipBubble({ anchor, container, label, shortcut, side }: TooltipContent & { anchor: DOMRect; container: Element }) {
  const ref = useRef<HTMLDivElement>(null);

  // Position once the bubble's size is known, keeping it 8px inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const left = side === "right" ? anchor.right + 8 : anchor.left + anchor.width / 2 - w / 2;
    const top = side === "right" ? anchor.top + anchor.height / 2 - h / 2 : anchor.bottom + 6;
    el.style.left = `${Math.round(Math.min(Math.max(8, left), window.innerWidth - w - 8))}px`;
    el.style.top = `${Math.round(Math.min(Math.max(8, top), window.innerHeight - h - 8))}px`;
    el.style.visibility = "visible";
  }, [anchor, side]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="tooltip-in pointer-events-none invisible fixed left-0 top-0 z-[70] flex items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-elevated px-2 py-1 text-[13px] font-medium leading-5 text-fg shadow-popover"
    >
      {label}
      {shortcut && <kbd className="font-sans text-subtle">{shortcut}</kbd>}
    </div>,
    container,
  );
}
