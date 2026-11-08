"use client";

import katex from "katex";
import { MessageSquareShare } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { formatStep, withUnit } from "@/lib/simulation/format";
import type { Parameter } from "@/lib/simulation/spec";
import { cn } from "@/lib/utils";
import { useSimulationShare } from "./share-context";

/** Inline math (labels, symbols) rendered with KaTeX; plain text if it can't be. */
export const TeX = memo(function TeX({ tex, className }: { tex: string; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, strict: "ignore", output: "htmlAndMathml" });
    } catch {
      return null;
    }
  }, [tex]);
  if (html === null) return <span className={className}>{tex}</span>;
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** An element's content size, kept up to date. */
export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size] as const;
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  return () => observer.disconnect();
}

/** Changes when the theme or accent does, so canvases redraw in the new colors. */
export function useThemeKey() {
  return useSyncExternalStore(
    subscribeTheme,
    () => `${document.documentElement.dataset.theme ?? ""}|${document.documentElement.dataset.accent ?? ""}`,
    () => "",
  );
}

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** A CSS color variable's current value, as canvas code needs it. */
export function cssVar(element: Element, name: string, fallback = "#888888") {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

/** [r, g, b] from a #rgb / #rrggbb / rgb() color. */
export function parseColor(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [136, 136, 136];
}

/** A color along a gradient of stops, t in [0, 1]. */
export function mixStops(stops: Array<[number, number, number]>, t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(clamped));
  const f = clamped - i;
  const [a, b] = [stops[i], stops[i + 1]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// ---------- State that survives re-renders of the reply ----------

/**
 * A simulation's state (slider positions, a student's diagram), kept per simulation for as long
 * as the page is open, so it survives the reply re-rendering when it finishes streaming.
 */
const saved = new Map<string, unknown>();

export function useSavedState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => (saved.has(key) ? (saved.get(key) as T) : initial()));
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        saved.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, set] as const;
}

// ---------- Controls ----------

export function ParameterSliders({
  parameters,
  values,
  onChange,
}: {
  parameters: Parameter[];
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
}) {
  if (!parameters.length) return null;
  return (
    <div className="grid gap-x-6 gap-y-3 border-t border-line px-4 py-3 sm:grid-cols-2">
      {parameters.map((p) => (
        <Slider key={p.name} parameter={p} value={values[p.name] ?? p.value} onChange={(v) => onChange(p.name, v)} />
      ))}
    </div>
  );
}

function Slider({ parameter: p, value, onChange }: { parameter: Parameter; value: number; onChange: (v: number) => void }) {
  const id = useId();
  const shown = withUnit(formatStep(value, p.step), p.unit);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm leading-5">
        <label htmlFor={id} className="min-w-0 truncate text-muted">
          {p.label && <span>{p.label} </span>}
          <TeX tex={p.symbol} className="text-fg" />
        </label>
        <span className="shrink-0 font-mono text-[13px] tabular-nums text-fg">{shown}</span>
      </div>
      <input
        id={id}
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={value}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="sim-range w-full"
      />
    </div>
  );
}

/** A toolbar toggle. */
export function ToggleChip({
  pressed,
  onClick,
  children,
  icon,
  disabled,
  label,
}: {
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40",
        pressed
          ? "border-accent/50 bg-accent/15 text-fg"
          : "border-line text-muted hover:bg-ink/[0.05] hover:text-fg",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** One of several options. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 shrink-0 items-center rounded-lg border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-full rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            value === o.value ? "bg-ink/[0.09] text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small square button on top of a canvas (zoom, reset). */
export function CanvasButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg border border-line bg-bg/85 text-muted backdrop-blur-sm transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {children}
    </button>
  );
}

/**
 * The card a simulation sits in: its title (and a formula), a toolbar, the simulation, its
 * sliders, and a button that puts what the student is looking at into their next message.
 */
export function SimulationFrame({
  title,
  badge,
  subtitle,
  toolbar,
  children,
  footer,
  share,
}: {
  title: string;
  badge?: string;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** What to tell Ainsley about the current state. */
  share?: () => string;
}) {
  const shareText = useSimulationShare();
  const titleId = useId();
  return (
    <figure aria-labelledby={titleId} className="sim mb-4 overflow-hidden rounded-2xl border border-line bg-bg">
      <div className="flex items-start gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span id={titleId} className="text-[15px] font-semibold leading-6 text-fg">
              {title}
            </span>
            {badge && (
              <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-accent-soft">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <div className="mt-0.5 min-w-0 overflow-x-auto text-sm leading-6 text-muted">{subtitle}</div>}
        </div>
        {share && shareText && (
          <button
            type="button"
            onClick={() => shareText(share())}
            className="-mr-1.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            title="Put what you're looking at into your message to Ainsley"
          >
            <MessageSquareShare className="size-4" />
            <span className="max-sm:sr-only">Share with Ainsley</span>
          </button>
        )}
      </div>
      {toolbar && <div className="flex flex-wrap items-center gap-2 px-4 pb-3">{toolbar}</div>}
      {children}
      {footer}
    </figure>
  );
}

/** Calls `draw` at most once per frame however often `request` is called. */
export function useFrameScheduler(draw: () => void) {
  const drawRef = useRef(draw);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    drawRef.current = draw;
  });
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      drawRef.current();
    });
  }, []);
}
