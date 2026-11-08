"use client";

import { Eraser, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { displayNumber, formatNumber, formatStep, withUnit } from "@/lib/simulation/format";
import { derivatives, makeField, traceLine, typicalMagnitude } from "@/lib/simulation/field";
import type { VectorFieldSpec } from "@/lib/simulation/spec";
import {
  drawGrid,
  niceStep,
  planeColors,
  PlaneButtons,
  prepareCanvas,
  toScreenX,
  toScreenY,
  toWorldX,
  toWorldY,
  usePlane,
} from "./plane";
import {
  cssVar,
  mixStops,
  ParameterSliders,
  parseColor,
  Segmented,
  SimulationFrame,
  TeX,
  ToggleChip,
  useElementSize,
  useReducedMotion,
  useSavedState,
  useThemeKey,
} from "./shared";

/**
 * A vector field explorer: arrows colored by strength, a probe that reads F, its divergence and
 * its curl under the pointer, field lines traced from any point the student clicks, a flow of
 * particles carried by the field, and divergence or curl shaded across the plane.
 */

type Heatmap = VectorFieldSpec["heatmap"];

/** Spacing of the arrow grid on screen, in px. */
const ARROW_SPACING = 34;
const MAX_TRACES = 12;

function subscribeHover(onChange: () => void) {
  const query = window.matchMedia("(hover: none)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export default function VectorField({ spec, stateKey }: { spec: VectorFieldSpec; stateKey: string }) {
  const reducedMotion = useReducedMotion();
  const touch = useSyncExternalStore(subscribeHover, () => window.matchMedia("(hover: none)").matches, () => false);
  const [values, setValues] = useSavedState<Record<string, number>>(`${stateKey}:values`, () =>
    Object.fromEntries(spec.parameters.map((p) => [p.name, p.value])),
  );
  const [showArrows, setShowArrows] = useSavedState(`${stateKey}:arrows`, () => true);
  const [flow, setFlow] = useSavedState(`${stateKey}:flow`, () => spec.flow && !reducedMotion);
  const [heatmap, setHeatmap] = useSavedState<Heatmap>(`${stateKey}:heatmap`, () => spec.heatmap);
  const [traces, setTraces] = useSavedState<Array<[number, number]>>(`${stateKey}:traces`, () => spec.traces);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<HTMLCanvasElement>(null);
  const themeKey = useThemeKey();

  const W = area.width;
  const H = Math.round(Math.min(420, Math.max(260, W * 0.6)));
  const plane = usePlane({
    xRange: spec.xRange,
    yRange: spec.yRange,
    equal: true,
    width: W,
    height: H,
    onTap: (x, y) => {
      setTraces((t) => [...t.slice(-(MAX_TRACES - 1)), [x, y]]);
      setProbe({ x, y });
    },
    onHover: setProbe,
  });
  const view = plane.view;

  const field = useMemo(() => makeField(spec, values), [spec, values]);
  const typical = useMemo(() => (view ? typicalMagnitude(field, view, W, H) : 0), [field, view, W, H]);

  // Divergence or curl on a coarse grid, smoothed when drawn. Colors are scaled to the larger of
  // what's in view and the field's own scale (a typical strength over a quarter of the view), so
  // a field whose curl is zero, like a point vortex away from its center, doesn't have the
  // rounding noise of its derivatives blown up into color.
  const shading = useMemo(() => {
    if (!view || heatmap === "none" || W === 0) return null;
    const cell = 5;
    const gw = Math.ceil(W / cell);
    const gh = Math.ceil(H / cell);
    const values = new Float32Array(gw * gh);
    const h = 0.5 / view.sx;
    const magnitudes: number[] = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const d = derivatives(field, toWorldX(view, W, (i + 0.5) * cell), toWorldY(view, H, (j + 0.5) * cell), h);
        const value = heatmap === "divergence" ? d.div : d.curl;
        values[j * gw + i] = value;
        if (Number.isFinite(value)) magnitudes.push(Math.abs(value));
      }
    }
    magnitudes.sort((a, b) => a - b);
    const spread = magnitudes.length ? magnitudes[Math.floor(magnitudes.length * 0.95)] : 0;
    const natural = typical / (Math.hypot(W / view.sx, H / view.sy) / 4);
    const top = Math.max(spread, natural);
    return { values, gw, gh, cell, top };
  }, [field, view, W, H, heatmap, typical]);

  const lines = useMemo(() => {
    if (!view || W === 0) return [];
    const span = Math.max(W / view.sx, H / view.sy);
    const bounds: [number, number, number, number] = [
      toWorldX(view, W, 0) - span,
      toWorldX(view, W, W) + span,
      toWorldY(view, H, H) - span,
      toWorldY(view, H, 0) + span,
    ];
    return traces.map(([x, y]) => ({ seed: [x, y] as [number, number], points: traceLine(field, x, y, 3 / view.sx, bounds).points }));
  }, [field, view, W, H, traces]);

  // ---------- The static layer: shading, grid, arrows, field lines ----------

  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !view || W === 0) return;
    const ctx = prepareCanvas(canvas, W, H);
    ctx.clearRect(0, 0, W, H);
    void themeKey;

    if (shading && shading.top > 0) {
      const pos = parseColor(cssVar(canvas, "--sim-positive", "#f87171"));
      const neg = parseColor(cssVar(canvas, "--sim-negative", "#60a5fa"));
      const image = new ImageData(shading.gw, shading.gh);
      for (let k = 0; k < shading.values.length; k++) {
        const v = shading.values[k];
        if (!Number.isFinite(v)) continue;
        const t = Math.min(1, Math.abs(v) / shading.top);
        const [r, g, b] = v >= 0 ? pos : neg;
        image.data[k * 4] = r;
        image.data[k * 4 + 1] = g;
        image.data[k * 4 + 2] = b;
        image.data[k * 4 + 3] = Math.round(255 * 0.36 * Math.pow(t, 0.8));
      }
      const off = document.createElement("canvas");
      off.width = shading.gw;
      off.height = shading.gh;
      off.getContext("2d")!.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, shading.gw * shading.cell, shading.gh * shading.cell);
    }

    drawGrid(ctx, view, W, H, planeColors(canvas));

    if (showArrows && typical > 0) {
      const stops = ["--sim-field-1", "--sim-field-2", "--sim-field-3"].map((name) => parseColor(cssVar(canvas, name)));
      const step = niceStep(ARROW_SPACING / view.sx);
      const spacing = step * view.sx;
      const longest = spacing * 0.86;
      const out = [0, 0];
      const x0 = Math.ceil(toWorldX(view, W, 0) / step) * step;
      const y0 = Math.ceil(toWorldY(view, H, H) / step) * step;
      ctx.lineCap = "round";
      for (let x = x0; toScreenX(view, W, x) <= W; x += step) {
        for (let y = y0; toScreenY(view, H, y) >= 0; y += step) {
          field(x, y, out);
          const m = Math.hypot(out[0], out[1]);
          if (!Number.isFinite(m)) continue;
          const px = toScreenX(view, W, x);
          const py = toScreenY(view, H, y);
          const t = m / typical;
          const [r, g, b] = mixStops(stops, Math.min(1, t));
          const color = `rgb(${r | 0},${g | 0},${b | 0})`;
          const length = Math.min(longest, t * longest * 0.9);
          if (length < 2) {
            ctx.fillStyle = color;
            ctx.fillRect(px - 1, py - 1, 2, 2);
            continue;
          }
          const ux = out[0] / m;
          const uy = -out[1] / m;
          // Centered on its grid point, as vector-field plots draw them.
          const sx = px - (ux * length) / 2;
          const sy = py - (uy * length) / 2;
          const ex = px + (ux * length) / 2;
          const ey = py + (uy * length) / 2;
          const head = Math.min(6, Math.max(3, length * 0.32));
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex - ux * head * 0.6, ey - uy * head * 0.6);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - ux * head - uy * head * 0.5, ey - uy * head + ux * head * 0.5);
          ctx.lineTo(ex - ux * head + uy * head * 0.5, ey - uy * head - ux * head * 0.5);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Field lines, with arrowheads along them in the field's direction.
    if (lines.length) {
      const ink = cssVar(canvas, "--color-fg", "#ededed");
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = "round";
      for (const line of lines) {
        const pts = line.points.map(([x, y]) => [toScreenX(view, W, x), toScreenY(view, H, y)]);
        if (pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
        let travelled = 40;
        for (let i = 1; i < pts.length; i++) {
          const dx = pts[i][0] - pts[i - 1][0];
          const dy = pts[i][1] - pts[i - 1][1];
          const d = Math.hypot(dx, dy);
          travelled += d;
          if (travelled < 110 || d < 1e-6) continue;
          travelled = 0;
          const [x, y] = pts[i];
          if (x < 0 || x > W || y < 0 || y > H) continue;
          const ux = dx / d;
          const uy = dy / d;
          ctx.beginPath();
          ctx.moveTo(x + ux * 4, y + uy * 4);
          ctx.lineTo(x - ux * 5 - uy * 4.5, y - uy * 5 + ux * 4.5);
          ctx.lineTo(x - ux * 5 + uy * 4.5, y - uy * 5 - ux * 4.5);
          ctx.closePath();
          ctx.fill();
        }
        const sx = toScreenX(view, W, line.seed[0]);
        const sy = toScreenY(view, H, line.seed[1]);
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [view, W, H, field, showArrows, typical, shading, lines, themeKey]);

  // ---------- The flow: particles carried by the field, leaving fading trails ----------

  const visible = useRef(true);
  useEffect(() => {
    const canvas = flowRef.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = flowRef.current;
    if (!canvas || !view || W === 0) return;
    const ctx = prepareCanvas(canvas, W, H);
    ctx.clearRect(0, 0, W, H);
    if (!flow || typical <= 0) return;
    void themeKey;

    const count = Math.round(Math.min(450, Math.max(140, (W * H) / 2000)));
    const px = new Float64Array(count);
    const py = new Float64Array(count);
    const age = new Float64Array(count);
    const life = new Float64Array(count);
    const x0 = toWorldX(view, W, 0);
    const x1 = toWorldX(view, W, W);
    const y0 = toWorldY(view, H, H);
    const y1 = toWorldY(view, H, 0);
    const spawn = (k: number) => {
      px[k] = x0 + Math.random() * (x1 - x0);
      py[k] = y0 + Math.random() * (y1 - y0);
      age[k] = 0;
      life[k] = 60 + Math.random() * 140;
    };
    for (let k = 0; k < count; k++) {
      spawn(k);
      age[k] = Math.random() * life[k];
    }
    const stops = ["--sim-field-1", "--sim-field-2", "--sim-field-3"].map((name) => parseColor(cssVar(canvas, name)));
    const buckets = 6;
    const colors = Array.from({ length: buckets }, (_, i) => {
      const [r, g, b] = mixStops(stops, (i + 0.5) / buckets);
      return `rgba(${r | 0},${g | 0},${b | 0},0.9)`;
    });
    const paths: Path2D[] = [];
    // At the typical strength a particle moves about 1.6 px a frame.
    const speed = 1.6 / view.sx / typical;
    const out = [0, 0];
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!visible.current) return;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.075)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < buckets; i++) paths[i] = new Path2D();
      for (let k = 0; k < count; k++) {
        const x = px[k];
        const y = py[k];
        field(x, y, out);
        let vx = out[0];
        let vy = out[1];
        // Midpoint step.
        field(x + vx * speed * 0.5, y + vy * speed * 0.5, out);
        vx = out[0];
        vy = out[1];
        const m = Math.hypot(vx, vy);
        age[k]++;
        if (!Number.isFinite(m) || age[k] > life[k] || m < typical * 1e-3) {
          spawn(k);
          continue;
        }
        // Near a singularity, cap the step so particles don't jump across the plane.
        const cap = Math.min(1, 7 / (m * speed * view.sx));
        const nx = x + vx * speed * cap;
        const ny = y + vy * speed * cap;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) {
          spawn(k);
          continue;
        }
        const bucket = Math.min(buckets - 1, Math.floor((m / typical) * buckets * 0.999));
        paths[bucket].moveTo(toScreenX(view, W, x), toScreenY(view, H, y));
        paths[bucket].lineTo(toScreenX(view, W, nx), toScreenY(view, H, ny));
        px[k] = nx;
        py[k] = ny;
      }
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      for (let i = 0; i < buckets; i++) {
        ctx.strokeStyle = colors[i];
        ctx.stroke(paths[i]);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [flow, view, W, H, field, typical, themeKey]);

  // ---------- Reading the field at a point ----------

  const reading = useMemo(() => {
    if (!probe || !view) return null;
    const out = [0, 0];
    field(probe.x, probe.y, out);
    const { div, curl } = derivatives(field, probe.x, probe.y, Math.max(1e-6, 0.5 / view.sx));
    // Rounding noise in the derivatives reads as 0.
    const floor = 1e-6 * Math.max(1, typical) * view.sx;
    const clean = (v: number) => (Math.abs(v) < floor ? 0 : v);
    return { ...probe, P: out[0], Q: out[1], m: Math.hypot(out[0], out[1]), div: clean(div), curl: clean(curl) };
  }, [probe, field, view, typical]);

  const parameterText = spec.parameters
    .map((p) => `${p.label ? p.label.toLowerCase() : p.name} = ${withUnit(formatStep(values[p.name] ?? p.value, p.step).replace("−", "-"), p.unit)}`)
    .join(", ");

  const share = () => {
    const parts = [`In the vector field “${spec.title}”${parameterText ? ` with ${parameterText}` : ""}`];
    if (reading) {
      parts.push(
        `at (x, y) = (${formatNumber(reading.x)}, ${formatNumber(reading.y)}) I read F = (${formatNumber(reading.P)}, ${formatNumber(reading.Q)}), |F| = ${formatNumber(reading.m)}, div F = ${formatNumber(reading.div)}, curl F = ${formatNumber(reading.curl)}`,
      );
    }
    if (heatmap !== "none") parts.push(`with ${heatmap} shaded`);
    return `${parts.join(", ")}.`;
  };

  const subtitle = spec.formula ? (
    <TeX tex={spec.formula} />
  ) : (
    <span className="font-mono text-[13px]">
      F(x, y) = ({spec.sourceX}, {spec.sourceY})
    </span>
  );

  const fieldName = "F";
  const hint = touch ? "Tap a point to read F there and trace its field line." : "Hover to read F. Click to trace a field line.";

  return (
    <SimulationFrame
      title={spec.title}
      subtitle={subtitle}
      share={share}
      toolbar={
        <>
          <ToggleChip pressed={showArrows} onClick={() => setShowArrows(!showArrows)}>
            Arrows
          </ToggleChip>
          <ToggleChip
            pressed={flow}
            onClick={() => setFlow(!flow)}
            icon={flow ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          >
            Flow
          </ToggleChip>
          <Segmented
            label="Shade"
            value={heatmap}
            onChange={setHeatmap}
            options={[
              { value: "none", label: "No shading" },
              { value: "divergence", label: "Divergence" },
              { value: "curl", label: "Curl" },
            ]}
          />
          {traces.length > 0 && (
            <ToggleChip onClick={() => setTraces([])} icon={<Eraser className="size-3.5" />}>
              Clear lines
            </ToggleChip>
          )}
        </>
      }
      footer={<ParameterSliders parameters={spec.parameters} values={values} onChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))} />}
    >
      <div ref={areaRef} className="relative border-t border-line" style={{ height: W ? H : 300 }}>
        <canvas ref={baseRef} className="absolute inset-0 block" style={{ width: W, height: H }} />
        <canvas ref={flowRef} className="pointer-events-none absolute inset-0 block" style={{ width: W, height: H }} />
        <div
          {...plane.surface}
          tabIndex={0}
          role="img"
          aria-label={`Vector field ${spec.title}: F(x, y) = (${spec.sourceX}, ${spec.sourceY}). Arrow keys pan, plus and minus zoom.`}
          className="absolute inset-0 cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        />
        {reading && view && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg"
            style={{ left: toScreenX(view, W, reading.x), top: toScreenY(view, H, reading.y) }}
          />
        )}
        <div
          aria-live="polite"
          className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-4.5rem)] rounded-lg border border-line bg-bg/85 px-2.5 py-1.5 text-[12px] leading-[18px] text-muted backdrop-blur-sm"
        >
          {reading ? (
            <>
              <div>
                (x, y) = <span className="font-mono tabular-nums text-fg">({displayNumber(reading.x)}, {displayNumber(reading.y)})</span>
              </div>
              <div>
                {fieldName} = <span className="font-mono tabular-nums text-fg">⟨{displayNumber(reading.P)}, {displayNumber(reading.Q)}⟩</span>
                {"  "}|{fieldName}| = <span className="font-mono tabular-nums text-fg">{displayNumber(reading.m)}</span>
              </div>
              <div>
                ∇·{fieldName} = <span className="font-mono tabular-nums text-fg">{displayNumber(reading.div)}</span>
                {"  "}(∇×{fieldName})·k̂ = <span className="font-mono tabular-nums text-fg">{displayNumber(reading.curl)}</span>
              </div>
            </>
          ) : (
            hint
          )}
        </div>
        {shading && shading.top > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg border border-line bg-bg/85 px-2 py-1 text-[11px] text-muted backdrop-blur-sm">
            <span>{heatmap === "divergence" ? "∇·F" : "curl"}</span>
            <span className="font-mono tabular-nums">−{formatNumber(shading.top)}</span>
            <span
              aria-hidden="true"
              className="h-2 w-16 rounded-full"
              style={{ background: "linear-gradient(90deg, var(--sim-negative), transparent, var(--sim-positive))" }}
            />
            <span className="font-mono tabular-nums">+{formatNumber(shading.top)}</span>
          </div>
        )}
        {view && <PlaneButtons onZoom={(f) => plane.zoomAt(f)} onReset={plane.reset} />}
      </div>
    </SimulationFrame>
  );
}
