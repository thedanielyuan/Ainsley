"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { displayNumber, formatNumber, formatStep, withUnit } from "@/lib/simulation/format";
import { fitYRange } from "@/lib/simulation/graph";
import { scopeWith, type FunctionGraphSpec } from "@/lib/simulation/spec";
import {
  drawGrid,
  planeColors,
  PlaneButtons,
  prepareCanvas,
  toScreenX,
  toScreenY,
  toWorldX,
  usePlane,
} from "./plane";
import { cssVar, ParameterSliders, SimulationFrame, TeX, useElementSize, useSavedState, useThemeKey } from "./shared";

/** A graph of one or more functions, with sliders, marked points, and values read under the pointer. */

const CURVE_COLORS = ["--course-1", "--course-4", "--course-2", "--course-0", "--course-3", "--course-5"];
const DEFAULT_NAMES = ["f", "g", "h", "p", "q", "r"];

export default function FunctionGraph({ spec, stateKey }: { spec: FunctionGraphSpec; stateKey: string }) {
  const [values, setValues] = useSavedState<Record<string, number>>(`${stateKey}:values`, () =>
    Object.fromEntries(spec.parameters.map((p) => [p.name, p.value])),
  );
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeKey = useThemeKey();

  const W = area.width;
  const H = Math.round(Math.min(400, Math.max(240, W * 0.56)));
  const yRange = useMemo(() => spec.yRange ?? fitYRange(spec), [spec]);
  const plane = usePlane({
    xRange: spec.xRange,
    yRange,
    equal: false,
    width: W,
    height: H,
    onTap: (x) => setHoverX(x),
    onHover: (p) => setHoverX(p ? p.x : null),
  });
  const view = plane.view;
  const scope = useMemo(() => scopeWith(spec, values), [spec, values]);

  const evaluate = (index: number, x: number) => {
    const s = { ...scope, [spec.variable]: x };
    return spec.functions[index].f.evaluate(s);
  };

  const points = useMemo(
    () =>
      spec.points.map((p) => ({ label: p.label, x: p.x.evaluate(scope), y: p.y.evaluate(scope) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    [spec, scope],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || W === 0) return;
    void themeKey;
    const ctx = prepareCanvas(canvas, W, H);
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, view, W, H, planeColors(canvas));

    const s = { ...scope };
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    spec.functions.forEach((fn, i) => {
      ctx.strokeStyle = cssVar(canvas, CURVE_COLORS[i % CURVE_COLORS.length]);
      ctx.beginPath();
      let drawing = false;
      let lastY = 0;
      for (let px = 0; px <= W; px += 0.5) {
        s[spec.variable] = toWorldX(view, W, px);
        const y = fn.f.evaluate(s);
        const py = toScreenY(view, H, y);
        if (!Number.isFinite(py)) {
          drawing = false;
          continue;
        }
        // A jump of more than the canvas height between neighbors is an asymptote: don't join it.
        if (drawing && Math.abs(py - lastY) > H * 1.2) drawing = false;
        const clamped = Math.max(-H, Math.min(2 * H, py));
        if (drawing) ctx.lineTo(px, clamped);
        else ctx.moveTo(px, clamped);
        drawing = true;
        lastY = py;
      }
      ctx.stroke();
    });

    const ink = cssVar(canvas, "--color-fg", "#ededed");
    const bg = cssVar(canvas, "--color-bg", "#191919");
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(toScreenX(view, W, p.x), toScreenY(view, H, p.y), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = bg;
      ctx.stroke();
    }

    if (hoverX !== null) {
      const px = toScreenX(view, W, hoverX);
      ctx.strokeStyle = cssVar(canvas, "--color-subtle", "#8f8f8f");
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
      ctx.setLineDash([]);
      spec.functions.forEach((fn, i) => {
        s[spec.variable] = hoverX;
        const py = toScreenY(view, H, fn.f.evaluate(s));
        if (!Number.isFinite(py) || py < -10 || py > H + 10) return;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = cssVar(canvas, CURVE_COLORS[i % CURVE_COLORS.length]);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = bg;
        ctx.stroke();
      });
    }
  }, [view, W, H, scope, spec, points, hoverX, themeKey]);

  const nameOf = (i: number) => spec.functions[i].label ?? `${DEFAULT_NAMES[i]}(${spec.variable})`;

  const parameterText = spec.parameters
    .map((p) => `${p.label ? p.label.toLowerCase() : p.name} = ${withUnit(formatStep(values[p.name] ?? p.value, p.step).replace("−", "-"), p.unit)}`)
    .join(", ");

  const share = () => {
    let text = `In the graph “${spec.title}”${parameterText ? ` with ${parameterText}` : ""}`;
    if (hoverX !== null) {
      const read = spec.functions.map((f, i) => `${f.label ?? `${DEFAULT_NAMES[i]}(${spec.variable})`} = ${formatNumber(evaluate(i, hoverX))}`);
      text += `, at ${spec.variable} = ${formatNumber(hoverX)}: ${read.join(", ")}`;
    }
    return `${text}.`;
  };

  const legend = (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {spec.functions.map((f, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className="h-[3px] w-3.5 shrink-0 rounded-full" style={{ background: `var(${CURVE_COLORS[i % CURVE_COLORS.length]})` }} />
          {f.label ? <TeX tex={f.label} /> : <span className="font-mono text-[13px]">{`${DEFAULT_NAMES[i]}(${spec.variable}) = ${f.source}`}</span>}
        </span>
      ))}
    </div>
  );

  const axisY = view ? toScreenY(view, H, 0) : 0;
  const axisX = view ? toScreenX(view, W, 0) : 0;

  return (
    <SimulationFrame
      title={spec.title}
      subtitle={legend}
      share={share}
      footer={<ParameterSliders parameters={spec.parameters} values={values} onChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))} />}
    >
      <div ref={areaRef} className="relative border-t border-line" style={{ height: W ? H : 280 }}>
        <canvas ref={canvasRef} className="absolute inset-0 block" style={{ width: W, height: H }} />
        <div
          {...plane.surface}
          tabIndex={0}
          role="img"
          aria-label={`Graph ${spec.title}: ${spec.functions.map((f, i) => `${nameOf(i)} = ${f.source}`).join("; ")}. Arrow keys pan, plus and minus zoom.`}
          className="absolute inset-0 cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        />
        {view && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 text-[12px] text-muted">
            {points.map((p, i) =>
              p.label ? (
                <span
                  key={i}
                  className="absolute whitespace-nowrap rounded px-0.5 text-fg"
                  style={{
                    left: toScreenX(view, W, p.x) + 8,
                    top: toScreenY(view, H, p.y) - 22,
                    background: "color-mix(in srgb, var(--color-bg) 75%, transparent)",
                  }}
                >
                  <TeX tex={p.label} />
                </span>
              ) : null,
            )}
            {spec.xLabel && (
              <span className="absolute right-12 whitespace-nowrap" style={{ top: Math.min(H - 34, Math.max(4, axisY - 20)) }}>
                {spec.xLabel}
              </span>
            )}
            {spec.yLabel && (
              // Beside the axis, clear of its numbers (which sit on its right when it's at the left edge).
              <span className="absolute top-1.5 whitespace-nowrap" style={{ left: Math.min(W - 120, Math.max(4, axisX + (axisX < 28 ? 44 : 8))) }}>
                {spec.yLabel}
              </span>
            )}
          </div>
        )}
        {hoverX !== null && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-4.5rem)] rounded-lg border border-line bg-bg/85 px-2.5 py-1.5 text-[12px] leading-[18px] text-muted backdrop-blur-sm"
          >
            <div>
              {spec.variable} = <span className="font-mono tabular-nums text-fg">{displayNumber(hoverX)}</span>
            </div>
            {spec.functions.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-[3px] w-2.5 rounded-full" style={{ background: `var(${CURVE_COLORS[i % CURVE_COLORS.length]})` }} />
                {f.label ? <TeX tex={f.label.split("=")[0]} /> : `${DEFAULT_NAMES[i]}(${spec.variable})`} ={" "}
                <span className="font-mono tabular-nums text-fg">{displayNumber(evaluate(i, hoverX))}</span>
              </div>
            ))}
          </div>
        )}
        {view && <PlaneButtons onZoom={(f) => plane.zoomAt(f)} onReset={plane.reset} />}
      </div>
    </SimulationFrame>
  );
}
