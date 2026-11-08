"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fitView, niceStep, toScreenX, toScreenY, toWorldX, toWorldY, type View } from "@/lib/simulation/view";
import { CanvasButton } from "./shared";

/**
 * The coordinate plane under a vector field or a graph: a canvas view of world coordinates that
 * the student pans (drag, arrow keys) and zooms (pinch, Ctrl/⌘-scroll, the buttons, + and −).
 * A plain scroll still scrolls the chat.
 */

export { fitView, niceStep, toScreenX, toScreenY, toWorldX, toWorldY, type View } from "@/lib/simulation/view";

function tickText(value: number, step: number) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const text = (Math.abs(value) < step * 1e-6 ? 0 : value).toFixed(Math.min(decimals, 8));
  return text.replace(/^-/, "−");
}

/** Sizes a canvas for the screen's pixel density; returns its 2D context in CSS pixels. */
export function prepareCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const width = Math.round(w * dpr);
  const height = Math.round(h * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export interface PlaneColors {
  grid: string;
  axis: string;
  text: string;
  font: string;
}

export function drawGrid(ctx: CanvasRenderingContext2D, v: View, w: number, h: number, colors: PlaneColors) {
  const stepX = niceStep(90 / v.sx);
  const stepY = niceStep(70 / v.sy);
  const x0 = toWorldX(v, w, 0);
  const x1 = toWorldX(v, w, w);
  const y0 = toWorldY(v, h, h);
  const y1 = toWorldY(v, h, 0);

  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.grid;
  ctx.beginPath();
  for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1; x += stepX) {
    const px = Math.round(toScreenX(v, w, x)) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
  }
  for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1; y += stepY) {
    const py = Math.round(toScreenY(v, h, y)) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
  }
  ctx.stroke();

  // Axes where they're in view; otherwise their numbers stay on the nearest edge.
  const axisY = toScreenY(v, h, 0);
  const axisX = toScreenX(v, w, 0);
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  if (axisY >= 0 && axisY <= h) {
    ctx.moveTo(0, Math.round(axisY) + 0.5);
    ctx.lineTo(w, Math.round(axisY) + 0.5);
  }
  if (axisX >= 0 && axisX <= w) {
    ctx.moveTo(Math.round(axisX) + 0.5, 0);
    ctx.lineTo(Math.round(axisX) + 0.5, h);
  }
  ctx.stroke();

  ctx.fillStyle = colors.text;
  ctx.font = colors.font;
  const labelY = Math.min(h - 16, Math.max(4, axisY + 5));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1; x += stepX) {
    if (Math.abs(x) < stepX * 1e-6) continue;
    const px = toScreenX(v, w, x);
    if (px < 14 || px > w - 14) continue;
    ctx.fillText(tickText(x, stepX), px, labelY);
  }
  const rightSide = axisX < 28;
  ctx.textAlign = rightSide ? "left" : "right";
  ctx.textBaseline = "middle";
  const labelX = rightSide ? Math.max(4, axisX + 5) : Math.min(w - 4, axisX - 5);
  for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1; y += stepY) {
    if (Math.abs(y) < stepY * 1e-6) continue;
    const py = toScreenY(v, h, y);
    if (py < 10 || py > h - 10) continue;
    ctx.fillText(tickText(y, stepY), labelX, py);
  }
  if (axisX >= 0 && axisX <= w && axisY >= 0 && axisY <= h) {
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("0", axisX - 4, axisY + 4);
  }
}

/** Grid, axis and label colors from the theme. */
export function planeColors(element: Element): PlaneColors {
  const style = getComputedStyle(element);
  const ink = style.getPropertyValue("--color-ink").trim() || "#ffffff";
  const light = ink.toLowerCase() === "#000000" || ink.toLowerCase() === "#000";
  return {
    grid: light ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.07)",
    axis: light ? "rgba(0,0,0,0.38)" : "rgba(255,255,255,0.36)",
    text: style.getPropertyValue("--color-subtle").trim() || "#8f8f8f",
    font: `11px ${style.fontFamily || "ui-sans-serif, system-ui, sans-serif"}`,
  };
}

const ZOOM_LIMIT = 40;

/**
 * The view, with the handlers that move it. `onTap` fires for a click or tap that didn't drag;
 * `onHover` follows a mouse over the plane.
 */
export function usePlane({
  xRange,
  yRange,
  equal,
  width,
  height,
  onTap,
  onHover,
}: {
  xRange: [number, number];
  yRange: [number, number];
  equal: boolean;
  width: number;
  height: number;
  onTap?: (x: number, y: number) => void;
  onHover?: (point: { x: number; y: number } | null) => void;
}) {
  const fitted = useMemo(
    () => (width > 0 && height > 0 ? fitView(xRange, yRange, width, height, equal) : null),
    [xRange, yRange, width, height, equal],
  );
  const [moved, setMoved] = useState<View | null>(null);
  const view = moved ?? fitted;
  const viewRef = useRef(view);
  const element = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; travel: number; multi: boolean } | null>(null);
  const callbacks = useRef({ onTap, onHover });

  useEffect(() => {
    viewRef.current = view;
    callbacks.current = { onTap, onHover };
  });

  const clampScale = useCallback(
    (next: View): View => {
      if (!fitted) return next;
      const factor = Math.min(ZOOM_LIMIT, Math.max(1 / ZOOM_LIMIT, next.sx / fitted.sx));
      const ratio = (fitted.sx * factor) / next.sx;
      return { ...next, sx: next.sx * ratio, sy: next.sy * ratio };
    },
    [fitted],
  );

  const zoomAt = useCallback(
    (factor: number, px = width / 2, py = height / 2) => {
      const v = viewRef.current;
      if (!v) return;
      const wx = toWorldX(v, width, px);
      const wy = toWorldY(v, height, py);
      const scaled = clampScale({ ...v, sx: v.sx * factor, sy: v.sy * factor });
      setMoved({ ...scaled, cx: wx - (px - width / 2) / scaled.sx, cy: wy + (py - height / 2) / scaled.sy });
    },
    [clampScale, width, height],
  );

  const reset = useCallback(() => setMoved(null), []);

  const local = (e: PointerEvent) => {
    const rect = element.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 1) gesture.current = { startX: p.x, startY: p.y, travel: 0, multi: false };
    else if (gesture.current) gesture.current.multi = true;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = local(e);
    const v = viewRef.current;
    const previous = pointers.current.get(e.pointerId);
    if (!previous) {
      if (e.pointerType === "mouse" && v) {
        callbacks.current.onHover?.({ x: toWorldX(v, width, p.x), y: toWorldY(v, height, p.y) });
      }
      return;
    }
    if (!v) return;
    if (pointers.current.size === 1) {
      const dx = p.x - previous.x;
      const dy = p.y - previous.y;
      if (gesture.current) gesture.current.travel += Math.hypot(dx, dy);
      if (gesture.current && gesture.current.travel > 4) {
        setMoved({ ...v, cx: v.cx - dx / v.sx, cy: v.cy + dy / v.sy });
      }
      pointers.current.set(e.pointerId, p);
      return;
    }
    // Two fingers: zoom by how far apart they move, about the point between them.
    const [a, b] = [...pointers.current.values()];
    const other = a === previous ? b : a;
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    const after = Math.hypot(p.x - other.x, p.y - other.y);
    pointers.current.set(e.pointerId, p);
    if (before > 10 && after > 10) zoomAt(after / before, (p.x + other.x) / 2, (p.y + other.y) / 2);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) gesture.current = null;
    if (!had || !g || g.multi || g.travel > 6 || e.type === "pointercancel") return;
    const v = viewRef.current;
    if (!v) return;
    const p = local(e);
    callbacks.current.onTap?.(toWorldX(v, width, p.x), toWorldY(v, height, p.y));
  };

  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") callbacks.current.onHover?.(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const v = viewRef.current;
    if (!v) return;
    const panX = width * 0.1;
    const panY = height * 0.1;
    switch (e.key) {
      case "ArrowLeft":
        setMoved({ ...v, cx: v.cx - panX / v.sx });
        break;
      case "ArrowRight":
        setMoved({ ...v, cx: v.cx + panX / v.sx });
        break;
      case "ArrowUp":
        setMoved({ ...v, cy: v.cy + panY / v.sy });
        break;
      case "ArrowDown":
        setMoved({ ...v, cy: v.cy - panY / v.sy });
        break;
      case "+":
      case "=":
        zoomAt(1.25);
        break;
      case "-":
      case "_":
        zoomAt(0.8);
        break;
      case "0":
        reset();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // Ctrl/⌘-scroll and trackpad pinches zoom; a plain scroll is left to the page.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [node, zoomAt]);

  const ref = useCallback((el: HTMLDivElement | null) => {
    element.current = el;
    setNode(el);
  }, []);

  return {
    view,
    zoomed: moved !== null,
    zoomAt,
    reset,
    surface: {
      ref,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerLeave,
      onKeyDown,
    },
  };
}

/** Zoom and reset buttons in a plane's corner. */
export function PlaneButtons({ onZoom, onReset }: { onZoom: (factor: number) => void; onReset: () => void }) {
  return (
    <div className="absolute right-2 top-2 flex flex-col gap-1">
      <CanvasButton label="Zoom in" onClick={() => onZoom(1.5)}>
        <Plus className="size-4" />
      </CanvasButton>
      <CanvasButton label="Zoom out" onClick={() => onZoom(1 / 1.5)}>
        <Minus className="size-4" />
      </CanvasButton>
      <CanvasButton label="Reset view" onClick={onReset}>
        <RotateCcw className="size-3.5" />
      </CanvasButton>
    </div>
  );
}
