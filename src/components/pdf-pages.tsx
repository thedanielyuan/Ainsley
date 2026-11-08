"use client";

import { FileQuestion, LoaderCircle, RotateCw } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "unpdf/pdfjs";
import { usePagedScroll, type PageJump } from "@/lib/use-paged-scroll";
import { cn } from "@/lib/utils";

type PdfJs = typeof import("unpdf/pdfjs");

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const PADDING = 16;
const GAP = 12;
/** Pages stop growing past this width when the panel is very wide, unless zoomed. */
const MAX_FIT_WIDTH = 1040;
/** Pages this close to the view (in view heights) are drawn; farther ones give their memory back. */
const NEAR_MARGIN = "150% 0px";

type Loaded = { source: Blob; attempt: number } & (
  | { doc: PDFDocumentProxy; pdfjs: PdfJs; ratio: number; error?: never }
  | { doc?: never; error: true }
);

/**
 * Every page of a PDF (or of slides rendered to PDF), top to bottom in one scroll: drawn as they
 * come near the view, with selectable text. Zoom with the toolbar, or pinch / Ctrl-scroll.
 */
export function PdfPages({
  pdf,
  title,
  unit,
  jump,
  zoom,
  onZoom,
  onPage,
  fallback,
}: {
  pdf: Blob;
  title: string;
  /** "page" or "slide". */
  unit: string;
  jump: PageJump;
  zoom: number;
  onZoom: (zoom: number) => void;
  onPage: (page: number, count: number) => void;
  /** Offered when the file can't be drawn, e.g. "Show text instead". */
  fallback?: { label: string; onSelect: () => void };
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = loaded?.source === pdf && loaded.attempt === attempt ? loaded : null;

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;

    void Promise.all([import("unpdf/pdfjs"), pdf.arrayBuffer()])
      .then(async ([pdfjs, data]) => {
        if (cancelled) return;
        // The bundled PDF.js includes its worker. No file bytes or fonts go to a CDN.
        task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true });
        const doc = await task.promise;
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        if (!cancelled) setLoaded({ source: pdf, attempt, doc, pdfjs, ratio: first.height / first.width });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ source: pdf, attempt, error: true });
      });

    return () => {
      cancelled = true;
      void task?.destroy().catch(() => undefined);
    };
  }, [pdf, attempt]);

  if (current?.error) {
    return (
      <div role="status" className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-center">
        <FileQuestion className="size-7 text-subtle" />
        <p className="max-w-sm text-sm leading-6 text-muted">This file couldn’t be displayed.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-fg transition-colors hover:bg-ink/[0.05]"
          >
            <RotateCw className="size-3.5" /> Try again
          </button>
          {fallback && (
            <button
              type="button"
              onClick={fallback.onSelect}
              className="inline-flex h-8 items-center rounded-xl border border-line px-3 text-sm text-fg transition-colors hover:bg-ink/[0.05]"
            >
              {fallback.label}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!current?.doc) {
    return (
      <div role="status" className="flex min-h-40 flex-1 items-center justify-center gap-2 bg-well px-6 text-sm text-muted">
        <LoaderCircle className="size-4 animate-spin text-accent-soft" />
        Opening…
      </div>
    );
  }

  return (
    <Pages
      key={`${attempt}`}
      doc={current.doc}
      pdfjs={current.pdfjs}
      ratio={current.ratio}
      title={title}
      unit={unit}
      jump={jump}
      zoom={zoom}
      onZoom={onZoom}
      onPage={onPage}
    />
  );
}

function Pages({
  doc,
  pdfjs,
  ratio,
  title,
  unit,
  jump,
  zoom,
  onZoom,
  onPage,
}: {
  doc: PDFDocumentProxy;
  pdfjs: PdfJs;
  ratio: number;
  title: string;
  unit: string;
  jump: PageJump;
  zoom: number;
  onZoom: (zoom: number) => void;
  onPage: (page: number, count: number) => void;
}) {
  const count = doc.numPages;
  // Pages shaped differently from the first (a landscape page in a portrait document).
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set());
  const zoomRef = useRef(zoom);
  const onZoomRef = useRef(onZoom);

  // Pages fill the view's width (up to a limit), times the zoom. The hook keeps the last real
  // width while the view is hidden, so a hidden tab keeps its layout.
  const widthFor = (view: number) =>
    view > 0 ? Math.round(Math.min(MAX_FIT_WIDTH, Math.max(120, view - PADDING * 2)) * zoom) : 0;
  const shapes = Object.keys(ratios).length;
  const { scrollRef, pages, register, onScroll, width } = usePagedScroll({
    count,
    jump,
    layout: (view) => (view > 0 ? `${widthFor(view)}:${shapes}` : null),
    onPage,
  });
  const pageWidth = widthFor(width);
  const laidOut = pageWidth > 0;
  const renderWidth = useSettled(pageWidth);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
    onZoomRef.current = onZoom;
  });

  const onRatio = useCallback((page: number, value: number) => {
    setRatios((current) => (current[page] === value ? current : { ...current, [page]: value }));
  }, []);

  // Which pages are near the view. Ignored while hidden, so switching tabs keeps the drawings.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !laidOut) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (root.clientWidth === 0) return;
        setNear((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
          }
          return next;
        });
      },
      { root, rootMargin: NEAR_MARGIN },
    );
    for (const page of pages.current.slice(0, count)) if (page) observer.observe(page);
    return () => observer.disconnect();
  }, [scrollRef, pages, count, laidOut]);

  // Pinch (or Ctrl + scroll) zooms the pages rather than the whole app.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      onZoomRef.current(clampZoom(zoomRef.current * Math.exp(-event.deltaY * 0.01)));
    };
    // Safari reports trackpad pinches as gestures instead.
    let start = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      start = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      onZoomRef.current(clampZoom(start * ((event as Event & { scale?: number }).scale ?? 1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [scrollRef]);

  const label = unit.charAt(0).toUpperCase() + unit.slice(1);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      tabIndex={0}
      role="region"
      aria-label={`${title}, ${count} ${unit}${count === 1 ? "" : "s"}`}
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-well outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      {laidOut && (
        <div className="flex w-max min-w-full flex-col items-center" style={{ padding: PADDING, gap: GAP }}>
          {Array.from({ length: count }, (_, index) => (
            <PdfPage
              key={index}
              index={index}
              doc={doc}
              pdfjs={pdfjs}
              width={pageWidth}
              renderWidth={renderWidth}
              ratio={ratios[index + 1] ?? ratio}
              near={near.has(index)}
              label={`${label} ${index + 1} of ${count}`}
              register={register}
              onRatio={onRatio}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** The width pages are drawn at: follows the layout width once it stops changing (zoom, resize). */
function useSettled(value: number, delay = 160) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), settled === 0 ? 0 : delay);
    return () => clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}

type Painted = { key: string } | { key: string; error: true };

const PdfPage = memo(function PdfPage({
  index,
  doc,
  pdfjs,
  width,
  renderWidth,
  ratio,
  near,
  label,
  register,
  onRatio,
}: {
  index: number;
  doc: PDFDocumentProxy;
  pdfjs: PdfJs;
  width: number;
  renderWidth: number;
  ratio: number;
  near: boolean;
  label: string;
  register: (index: number, element: HTMLElement | null) => void;
  onRatio: (page: number, ratio: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [painted, setPainted] = useState<Painted | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  // Leaving the view's neighbourhood frees the drawing, so it must be drawn again on return.
  const [wasNear, setWasNear] = useState(near);
  if (near !== wasNear) {
    setWasNear(near);
    if (!near) setPainted(null);
  }
  const shown = painted && !("error" in painted) ? painted : null;
  const failed = painted && "error" in painted;
  const height = Math.round(width * ratio);

  // Draw (and redraw at a new size) while near the view. A staging canvas keeps the old drawing
  // on screen until the new one is ready, so zooming never flashes a blank page.
  useEffect(() => {
    if (!near || renderWidth <= 0) return;
    const key = `${renderWidth}:${attempt}`;
    let cancelled = false;
    let task: RenderTask | undefined;
    const staging = window.document.createElement("canvas");

    void doc
      .getPage(index + 1)
      .then(async (page) => {
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        setNaturalWidth(natural.width);
        const own = natural.height / natural.width;
        if (Math.abs(own - ratio) > 0.002) onRatio(index + 1, own);
        const viewport = page.getViewport({ scale: renderWidth / natural.width });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
        staging.width = Math.ceil(viewport.width * outputScale);
        staging.height = Math.ceil(viewport.height * outputScale);
        const context = staging.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        task = page.render({
          canvas: staging,
          canvasContext: context,
          viewport,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
          background: "#ffffff",
        });
        await task.promise;
        if (cancelled) return;
        const canvas = canvasRef.current;
        const visible = canvas?.getContext("2d");
        if (!canvas || !visible) return;
        canvas.width = staging.width;
        canvas.height = staging.height;
        visible.drawImage(staging, 0, 0);
        setPainted({ key });
      })
      .catch(() => {
        if (!cancelled) setPainted({ key, error: true });
      })
      .finally(() => {
        staging.width = 0;
        staging.height = 0;
      });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, renderWidth, attempt, doc, index, ratio, onRatio]);

  // Selectable text over the drawing; it scales with the page through --total-scale-factor.
  useEffect(() => {
    const container = textRef.current;
    if (!near || !container) return;
    let cancelled = false;
    let layer: TextLayer | undefined;
    void doc
      .getPage(index + 1)
      .then((page) => {
        if (cancelled) return;
        layer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport: page.getViewport({ scale: 1 }),
        });
        return layer.render();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [near, doc, pdfjs, index]);

  // Far from the view: give the drawing's memory back.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas) return;
    return () => {
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [near]);

  return (
    <div
      ref={(element) => register(index, element)}
      data-index={index}
      role="group"
      aria-label={label}
      className="relative shrink-0 overflow-hidden rounded-[4px] bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] ring-1 ring-black/[0.06]"
      style={
        {
          width,
          height,
          "--total-scale-factor": naturalWidth ? width / naturalWidth : 1,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as CSSProperties
      }
    >
      {/* No bitmap until the page is drawn (a canvas is 300×150 by default). */}
      <canvas
        ref={canvasRef}
        width={0}
        height={0}
        aria-hidden="true"
        className={cn("absolute inset-0 size-full", !shown && "invisible")}
      />
      <div ref={textRef} className="textLayer" />
      {near && !shown && !failed && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <LoaderCircle className="size-5 animate-spin text-neutral-400" />
        </span>
      )}
      {failed && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-neutral-500">
          This {label.split(" ")[0].toLowerCase()} couldn’t be displayed.
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-neutral-700 hover:bg-neutral-100"
          >
            <RotateCw className="size-3.5" /> Try again
          </button>
        </span>
      )}
    </div>
  );
});
