"use client";

import { Check, CircleCheck, CircleX, Eye, EyeOff, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  angleBetween,
  axisAngles,
  checkDiagram,
  components,
  describeDirection,
  evaluateForces,
  inclineAngle,
  inclineToWorld,
  largestForce,
  netForce,
  normalizeAngle,
  type DiagramCheck,
  type DrawnForce,
  type DrawnVerdict,
} from "@/lib/simulation/free-body";
import { displayNumber, formatNumber, formatStep, withUnit } from "@/lib/simulation/format";
import { FORCE_NAMES, FORCE_TYPES, initialScope, scopeWith, type ForceType, type FreeBodySpec } from "@/lib/simulation/spec";
import { cn } from "@/lib/utils";
import { ParameterSliders, SimulationFrame, TeX, ToggleChip, useElementSize, useSavedState } from "./shared";

/**
 * A free-body diagram. Explore mode draws Ainsley's forces from the object's center, to scale,
 * with sliders, components along the chosen axes, and the net force. Practice mode starts with
 * the object alone: the student draws an arrow for each force (drag out from the object, or "Add
 * force"), names it, and checks the diagram against Ainsley's forces.
 */

const DEG = Math.PI / 180;
/** The side panel (legend, or the student's list) sits beside the drawing from this width. */
const WIDE = 600;
const PANEL = 232;

const FORCE_COLORS: Record<ForceType, string> = {
  gravity: "var(--sim-gravity)",
  normal: "var(--sim-normal)",
  friction: "var(--sim-friction)",
  tension: "var(--sim-tension)",
  applied: "var(--sim-applied)",
  spring: "var(--sim-spring)",
  drag: "var(--sim-drag)",
  buoyancy: "var(--sim-buoyancy)",
  electric: "var(--sim-electric)",
  magnetic: "var(--sim-magnetic)",
  other: "var(--sim-other)",
};
const NET_COLOR = "var(--color-fg)";
const UNNAMED_COLOR = "var(--color-subtle)";

type Pt = { x: number; y: number };
/** A world direction (degrees, y up) on screen (y down). */
const dir = (angle: number): Pt => ({ x: Math.cos(angle * DEG), y: -Math.sin(angle * DEG) });
const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const fmt = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

function Arrow({
  from,
  angle,
  length,
  color,
  width = 2.5,
  dashed,
  opacity,
  clipped,
}: {
  from: Pt;
  angle: number;
  length: number;
  color: string;
  width?: number;
  dashed?: boolean;
  opacity?: number;
  /** Longer than drawn: marked with a break across the shaft. */
  clipped?: boolean;
}) {
  if (length < 3) return null;
  const d = dir(angle);
  const n = { x: -d.y, y: d.x };
  const head = Math.min(12, Math.max(7, length * 0.28)) * (width < 2.2 ? 0.8 : 1);
  const tip = add(from, d, length);
  const base = add(from, d, Math.max(0, length - head));
  const half = head * 0.42;
  const breakAt = add(from, d, length * 0.4);
  return (
    <g style={{ opacity }}>
      <line
        x1={from.x}
        y1={from.y}
        x2={base.x}
        y2={base.y}
        style={{ stroke: color, strokeWidth: width, strokeDasharray: dashed ? "5 4" : undefined, strokeLinecap: "round" }}
      />
      <polygon points={`${fmt(tip)} ${fmt(add(base, n, half))} ${fmt(add(base, n, -half))}`} style={{ fill: color }} />
      {clipped &&
        [-3, 3].map((offset) => {
          const c = add(breakAt, d, offset);
          return (
            <line
              key={offset}
              x1={add(c, n, -6).x}
              y1={add(c, n, -6).y}
              x2={add(c, n, 6).x}
              y2={add(c, n, 6).y}
              style={{ stroke: "var(--color-bg)", strokeWidth: 2 }}
            />
          );
        })}
    </g>
  );
}

/** The shorter arc from one direction to another, as an SVG path. */
function arcPath(c: Pt, r: number, a1: number, a2: number) {
  let start = a1;
  let sweep = normalizeAngle(a2 - a1);
  if (sweep > 180) {
    start = a2;
    sweep = 360 - sweep;
  }
  const p1 = add(c, dir(start), r);
  const p2 = add(c, dir(start + sweep), r);
  return { d: `M ${fmt(p1)} A ${r} ${r} 0 0 0 ${fmt(p2)}`, mid: start + sweep / 2 };
}

interface Label {
  key: string;
  at: Pt;
  tex: string;
  color: string;
  /** Pushed further along this direction if it overlaps another label. */
  away: number;
  verdict?: "right" | "wrong";
}

/** Nudges labels apart so two forces pointing the same way don't print over each other. */
function spreadLabels(labels: Label[]) {
  const placed: Label[] = [];
  for (const label of labels) {
    let at = label.at;
    for (let tries = 0; tries < 6 && placed.some((p) => Math.hypot(p.at.x - at.x, p.at.y - at.y) < 22); tries++) {
      at = add(at, dir(label.away), 11);
    }
    placed.push({ ...label, at });
  }
  return placed;
}

interface Scene {
  W: number;
  H: number;
  C: Pt;
  half: number;
  maxLen: number;
  theta: number;
  surface: { kind: "none" } | { kind: "flat"; y: number } | { kind: "incline"; A: Pt; B: Pt; D: Pt };
  /** Screen rotation of the object, degrees clockwise. */
  rotation: number;
}

function layoutScene(width: number, spec: FreeBodySpec, theta: number): Scene {
  const W = Math.max(220, width);
  const H = Math.round(Math.min(400, Math.max(300, W * 0.64)));
  const half = spec.object === "particle" ? 10 : 17;
  const maxLen = Math.min(175, H * 0.44, W * 0.42);
  const C = { x: W / 2, y: H / 2 + (spec.surface === "none" ? 0 : 6) };
  const mirror = (p: Pt): Pt => (spec.inclineRises === "left" ? { x: W - p.x, y: p.y } : p);

  if (spec.surface === "none") return { W, H, C, half, maxLen, theta, surface: { kind: "none" }, rotation: 0 };
  if (spec.surface === "horizontal" || theta < 0.5) {
    return { W, H, C, half, maxLen, theta, surface: { kind: "flat", y: C.y + half }, rotation: 0 };
  }

  // Worked out for an incline rising to the right, then mirrored for one rising to the left.
  const s = Math.sin(theta * DEG);
  const c = Math.cos(theta * DEG);
  const P = { x: C.x + s * half, y: C.y + c * half }; // where the object touches the slope
  const margin = 10;
  const bottom = H - 14;
  const down = Math.min((bottom - P.y) / s, (P.x - margin) / c);
  const up = Math.min((W - margin - P.x) / c, (P.y - margin) / s);
  const A = { x: P.x - c * down, y: P.y + s * down };
  const B = { x: P.x + c * up, y: P.y - s * up };
  const D = { x: B.x, y: A.y };
  return {
    W,
    H,
    C,
    half,
    maxLen,
    theta,
    surface: { kind: "incline", A: mirror(A), B: mirror(B), D: mirror(D) },
    rotation: spec.inclineRises === "left" ? theta : -theta,
  };
}

function SceneBackground({ scene, spec }: { scene: Scene; spec: FreeBodySpec }) {
  const { surface, C, half, rotation, W } = scene;
  return (
    <g>
      {surface.kind === "flat" && (
        <g>
          <line x1={8} y1={surface.y} x2={W - 8} y2={surface.y} style={{ stroke: "var(--color-subtle)", strokeWidth: 1.5 }} />
          {Array.from({ length: Math.floor((W - 16) / 14) }, (_, i) => (
            <line
              key={i}
              x1={14 + i * 14}
              y1={surface.y + 1}
              x2={6 + i * 14}
              y2={surface.y + 9}
              style={{ stroke: "var(--color-line)", strokeWidth: 1.25 }}
            />
          ))}
        </g>
      )}
      {surface.kind === "incline" && (
        <g>
          <polygon
            points={`${fmt(surface.A)} ${fmt(surface.B)} ${fmt(surface.D)}`}
            style={{ fill: "color-mix(in srgb, var(--color-ink) 5%, transparent)", stroke: "var(--color-line)", strokeWidth: 1 }}
          />
          <line
            x1={surface.A.x}
            y1={surface.A.y}
            x2={surface.B.x}
            y2={surface.B.y}
            style={{ stroke: "var(--color-subtle)", strokeWidth: 1.5 }}
          />
          <path
            d={arcPath(surface.A, 34, spec.inclineRises === "left" ? 180 - scene.theta : 0, spec.inclineRises === "left" ? 180 : scene.theta).d}
            style={{ fill: "none", stroke: "var(--color-subtle)", strokeWidth: 1.25 }}
          />
        </g>
      )}
      {spec.object === "box" ? (
        <rect
          x={C.x - half}
          y={C.y - half}
          width={half * 2}
          height={half * 2}
          rx={4}
          transform={`rotate(${rotation} ${C.x} ${C.y})`}
          style={{
            fill: "color-mix(in srgb, var(--color-ink) 9%, var(--color-bg))",
            stroke: "color-mix(in srgb, var(--color-ink) 28%, transparent)",
            strokeWidth: 1.25,
          }}
        />
      ) : (
        <circle
          cx={C.x}
          cy={C.y}
          r={half}
          style={{
            fill: "color-mix(in srgb, var(--color-ink) 9%, var(--color-bg))",
            stroke: "color-mix(in srgb, var(--color-ink) 28%, transparent)",
            strokeWidth: 1.25,
          }}
        />
      )}
      <circle cx={C.x} cy={C.y} r={2.5} style={{ fill: "var(--color-fg)" }} />
    </g>
  );
}

/** Where the incline's angle label goes, beside the arc at its foot. */
function inclineLabelAt(scene: Scene, spec: FreeBodySpec): Pt | null {
  if (scene.surface.kind !== "incline") return null;
  const { mid } = arcPath(
    scene.surface.A,
    34,
    spec.inclineRises === "left" ? 180 - scene.theta : 0,
    spec.inclineRises === "left" ? 180 : scene.theta,
  );
  const r = scene.theta < 20 ? 64 : 50;
  return add(scene.surface.A, dir(mid), r);
}

/** The directions an arrow snaps to: the axes, and along and across the incline. */
function snapTargets(spec: FreeBodySpec, theta: number) {
  const targets = [0, 90, 180, 270];
  if (spec.surface === "incline") for (const a of [0, 90, 180, 270]) targets.push(inclineToWorld(spec, theta, a));
  return targets.map(normalizeAngle);
}

function snap(angle: number, targets: number[]) {
  for (const t of targets) if (angleBetween(angle, t) <= 4) return t;
  return normalizeAngle(Math.round(angle));
}

interface Practice {
  drawn: DrawnForce[];
  check: DiagramCheck | null;
  checked: boolean;
  revealed: boolean;
}

let nextArrow = 0;

export default function FreeBodyDiagram({ spec, stateKey }: { spec: FreeBodySpec; stateKey: string }) {
  const practiceMode = spec.mode === "practice";
  const [values, setValues] = useSavedState<Record<string, number>>(`${stateKey}:values`, () =>
    Object.fromEntries(spec.parameters.map((p) => [p.name, p.value])),
  );
  const [showComponents, setShowComponents] = useSavedState(`${stateKey}:components`, () => spec.showComponents);
  const [showNet, setShowNet] = useSavedState(`${stateKey}:net`, () => spec.showNetForce);
  const [practice, setPractice] = useSavedState<Practice>(`${stateKey}:practice`, () => ({
    drawn: [],
    check: null,
    checked: false,
    revealed: false,
  }));
  const [selected, setSelected] = useState<string | null>(null);
  const [bodyRef, body] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; created: boolean; moved: boolean } | null>(null);
  const focusSelect = useRef<string | null>(null);
  const listId = useId();

  // Practice is checked at the starting values; explore follows the sliders.
  const scope = useMemo(() => (practiceMode ? initialScope(spec) : scopeWith(spec, values)), [practiceMode, spec, values]);
  const theta = inclineAngle(spec, scope);
  const forces = useMemo(() => evaluateForces(spec, scope), [spec, scope]);
  const net = useMemo(() => netForce(forces), [forces]);
  const axes = axisAngles(spec, theta);

  const wide = body.width >= WIDE;
  const drawingWidth = wide ? body.width - PANEL : body.width;
  const scene = layoutScene(drawingWidth, spec, theta);

  // One scale while the sliders move, so a force that doubles looks twice as long: the largest
  // force over the sliders' range fits, unless that would make the starting arrows short, in
  // which case the longest arrows are cut (and marked) instead.
  const reference = useMemo(() => {
    const start = evaluateForces(spec, initialScope(spec));
    const first = Math.max(0, ...start.map((f) => f.magnitude), netForce(start).magnitude);
    const largest = largestForce(spec, initialScope(spec));
    const r = first > 0 ? Math.min(largest, first / 0.6) : largest;
    return r > 0 ? r : 1;
  }, [spec]);
  const scale = scene.maxLen / reference;
  const lengthOf = (magnitude: number) => Math.min(scene.maxLen, magnitude * scale);
  const largest = Math.max(0, ...forces.map((f) => f.magnitude));
  const netShown = showNet && net.magnitude > Math.max(1e-9, largest * 0.005);
  const unit = spec.forceUnit;

  const parameterTex = spec.surface === "incline" && spec.inclineSource
    ? (spec.parameters.find((p) => p.name === spec.inclineSource?.trim())?.symbol ?? null)
    : null;
  const inclineTex = parameterTex ?? `${formatNumber(theta)}^\\circ`;

  // ---------- Practice: drawing arrows ----------

  const targets = snapTargets(spec, theta);
  const updateDrawn = (fn: (drawn: DrawnForce[]) => DrawnForce[]) =>
    setPractice((p) => ({ ...p, drawn: fn(p.drawn), check: null }));

  const pointer = (e: PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const aim = (id: string, p: Pt) => {
    const dx = p.x - scene.C.x;
    const dy = scene.C.y - p.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 6) return;
    const angle = snap(Math.atan2(dy, dx) / DEG, targets);
    const length = Math.min(1, Math.max(0.25, distance / scene.maxLen));
    updateDrawn((drawn) => drawn.map((d) => (d.id === id ? { ...d, angle, length } : d)));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!practiceMode || practice.revealed || e.button !== 0) return;
    const p = pointer(e);
    const hit = (e.target as Element).closest<SVGElement>("[data-arrow]")?.dataset.arrow;
    // Dragging out from the object always draws a new arrow; elsewhere it grabs the arrow there.
    if (Math.hypot(p.x - scene.C.x, p.y - scene.C.y) <= scene.half * 1.6) {
      const id = `arrow-${++nextArrow}`;
      drag.current = { id, created: true, moved: false };
      updateDrawn((drawn) => [...drawn, { id, type: null, angle: 90, length: 0 }]);
      setSelected(id);
    } else if (hit) {
      drag.current = { id: hit, created: false, moved: false };
      setSelected(hit);
    } else {
      setSelected(null);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current) return;
    current.moved = true;
    aim(current.id, pointer(e));
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.created) {
      const p = pointer(e);
      if (!current.moved || Math.hypot(p.x - scene.C.x, p.y - scene.C.y) < 18) {
        updateDrawn((drawn) => drawn.filter((d) => d.id !== current.id));
        setSelected(null);
        return;
      }
      // Its row is already in the list: ask which force it is.
      requestAnimationFrame(() => document.getElementById(`${listId}-${current.id}`)?.focus());
    }
  };

  // A new arrow asks which force it is.
  useEffect(() => {
    if (!focusSelect.current) return;
    const id = focusSelect.current;
    focusSelect.current = null;
    document.getElementById(`${listId}-${id}`)?.focus();
  });

  const addArrow = () => {
    const id = `arrow-${++nextArrow}`;
    updateDrawn((drawn) => [...drawn, { id, type: null, angle: 90, length: 0.6 }]);
    setSelected(id);
    focusSelect.current = id;
  };

  const rotate = (id: string, by: number) =>
    updateDrawn((drawn) => drawn.map((d) => (d.id === id ? { ...d, angle: normalizeAngle(Math.round(d.angle + by)) } : d)));

  const onArrowKey = (e: KeyboardEvent, id: string) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") rotate(id, step);
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") rotate(id, -step);
    else if (e.key === "Delete" || e.key === "Backspace") updateDrawn((drawn) => drawn.filter((d) => d.id !== id));
    else return;
    e.preventDefault();
  };

  const runCheck = () => setPractice((p) => ({ ...p, check: checkDiagram(spec, forces, p.drawn), checked: true }));
  const verdictOf = (id: string): DrawnVerdict | undefined => practice.check?.verdicts[id];

  // ---------- Drawing ----------

  const labels: Label[] = [];
  const C = scene.C;
  const visibleForces = forces.filter((f) => f.magnitude > 1e-9);

  const forceArrows = !practiceMode
    ? visibleForces.map((f) => {
        const length = lengthOf(f.magnitude);
        labels.push({
          key: `f${f.index}`,
          at: add(C, dir(f.angle), length + 16),
          tex: f.force.label,
          color: FORCE_COLORS[f.force.type],
          away: f.angle,
        });
        return (
          <Arrow
            key={f.index}
            from={C}
            angle={f.angle}
            length={length}
            color={FORCE_COLORS[f.force.type]}
            clipped={f.magnitude * scale > scene.maxLen + 0.5}
          />
        );
      })
    : null;

  const componentArrows =
    !practiceMode && showComponents
      ? visibleForces.flatMap((f) => {
          const comp = components(f.fx, f.fy, axes.x);
          if (Math.abs(comp.x) < f.magnitude * 0.02 || Math.abs(comp.y) < f.magnitude * 0.02) return [];
          const color = FORCE_COLORS[f.force.type];
          const xAngle = comp.x >= 0 ? axes.x : axes.x + 180;
          const yAngle = comp.y >= 0 ? axes.y : axes.y + 180;
          const xLen = lengthOf(Math.abs(comp.x));
          const yLen = lengthOf(Math.abs(comp.y));
          const tip = add(C, dir(f.angle), lengthOf(f.magnitude));
          const xTip = add(C, dir(xAngle), xLen);
          const yTip = add(C, dir(yAngle), yLen);
          return [
            <g key={`c${f.index}`}>
              <line x1={tip.x} y1={tip.y} x2={xTip.x} y2={xTip.y} style={{ stroke: color, strokeWidth: 1, strokeDasharray: "2 3", opacity: 0.55 }} />
              <line x1={tip.x} y1={tip.y} x2={yTip.x} y2={yTip.y} style={{ stroke: color, strokeWidth: 1, strokeDasharray: "2 3", opacity: 0.55 }} />
              <Arrow from={C} angle={xAngle} length={xLen} color={color} width={1.75} dashed opacity={0.8} />
              <Arrow from={C} angle={yAngle} length={yLen} color={color} width={1.75} dashed opacity={0.8} />
            </g>,
          ];
        })
      : null;

  const axisLines =
    !practiceMode && showComponents
      ? [axes.x, axes.y].map((a, i) => {
          const reach = scene.maxLen + 14;
          const p1 = add(C, dir(a), -reach);
          const p2 = add(C, dir(a), reach);
          labels.push({ key: `axis${i}`, at: add(C, dir(a), reach + 10), tex: i === 0 ? "x" : "y", color: "var(--color-subtle)", away: a });
          return (
            <line
              key={`axis${i}`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              style={{ stroke: "var(--color-subtle)", strokeWidth: 1, strokeDasharray: "3 4", opacity: 0.7 }}
            />
          );
        })
      : null;

  // An arc between a force and the axis nearest it, for forces Ainsley gave an angle label.
  const angleArcs = !practiceMode
    ? visibleForces
        .filter((f) => f.force.angleLabel)
        .map((f) => {
          const candidates = [axes.x, axes.x + 90, axes.x + 180, axes.x + 270].map(normalizeAngle);
          const nearest = candidates.reduce((best, a) => (angleBetween(f.angle, a) < angleBetween(f.angle, best) ? a : best));
          if (angleBetween(f.angle, nearest) < 2) return null;
          const { d, mid } = arcPath(C, 32, nearest, f.angle);
          const ray = add(C, dir(nearest), 50);
          labels.push({ key: `arc${f.index}`, at: add(C, dir(mid), 46), tex: f.force.angleLabel!, color: FORCE_COLORS[f.force.type], away: mid });
          return (
            <g key={`arc${f.index}`}>
              <line x1={C.x} y1={C.y} x2={ray.x} y2={ray.y} style={{ stroke: "var(--color-subtle)", strokeWidth: 1, strokeDasharray: "3 3" }} />
              <path d={d} style={{ fill: "none", stroke: FORCE_COLORS[f.force.type], strokeWidth: 1.25 }} />
            </g>
          );
        })
    : null;

  const netArrow = !practiceMode && netShown ? (
    <Arrow from={C} angle={net.angle} length={lengthOf(net.magnitude)} color={NET_COLOR} width={3.25} clipped={net.magnitude * scale > scene.maxLen + 0.5} />
  ) : null;
  if (netArrow) labels.push({ key: "net", at: add(C, dir(net.angle), lengthOf(net.magnitude) + 18), tex: "F_{\\text{net}}", color: NET_COLOR, away: net.angle });

  // The answer, once revealed in practice mode: Ainsley's forces as dashed arrows.
  const answerArrows =
    practiceMode && practice.revealed
      ? visibleForces.map((f) => {
          const length = lengthOf(f.magnitude);
          labels.push({ key: `ans${f.index}`, at: add(C, dir(f.angle), length + 16), tex: f.force.label, color: FORCE_COLORS[f.force.type], away: f.angle });
          return <Arrow key={`ans${f.index}`} from={C} angle={f.angle} length={length} color={FORCE_COLORS[f.force.type]} dashed width={2} />;
        })
      : null;

  const drawnArrows = practiceMode
    ? practice.drawn.map((d) => {
        const length = d.length * scene.maxLen;
        const color = d.type ? FORCE_COLORS[d.type] : UNNAMED_COLOR;
        const tip = add(C, dir(d.angle), length);
        const verdict = verdictOf(d.id);
        if (length >= 3) {
          labels.push({
            key: d.id,
            at: add(C, dir(d.angle), length + 16),
            tex: d.type ? shortName(d.type) : "?",
            color,
            away: d.angle,
            verdict: verdict ? (verdict === "right" || verdict === "renamed" ? "right" : "wrong") : undefined,
          });
        }
        const active = selected === d.id;
        return (
          <g
            key={d.id}
            data-arrow={d.id}
            tabIndex={practice.revealed ? -1 : 0}
            role="slider"
            aria-label={`${d.type ? FORCE_NAMES[d.type] : "Unnamed"} arrow`}
            aria-valuemin={0}
            aria-valuemax={359}
            aria-valuenow={Math.round(d.angle)}
            aria-valuetext={`${describeDirection(spec, theta, d.angle)}`}
            onKeyDown={(e) => onArrowKey(e, d.id)}
            onFocus={() => setSelected(d.id)}
            className="cursor-grab outline-none"
          >
            {length > scene.half * 1.6 && (
              <line
                x1={add(C, dir(d.angle), scene.half * 1.6).x}
                y1={add(C, dir(d.angle), scene.half * 1.6).y}
                x2={tip.x}
                y2={tip.y}
                style={{ stroke: "transparent", strokeWidth: 16 }}
              />
            )}
            <Arrow from={C} angle={d.angle} length={length} color={color} opacity={practice.revealed ? 0.55 : 1} />
            <circle
              cx={tip.x}
              cy={tip.y}
              r={active ? 8 : 6}
              style={{
                fill: active ? "color-mix(in srgb, var(--color-accent) 30%, transparent)" : "transparent",
                stroke: active ? "var(--color-accent)" : "transparent",
                strokeWidth: 1.5,
              }}
            />
          </g>
        );
      })
    : null;

  const inclineLabel = inclineLabelAt(scene, spec);
  const placed = spreadLabels(labels);
  const objectLabelAt =
    spec.objectLabel &&
    add(C, dir(90 + (spec.inclineRises === "left" ? -scene.theta : scene.theta) + 45), scene.half * 1.42 + 12);

  const sums = components(net.fx, net.fy, axes.x);
  const mass = spec.mass?.evaluate(scope);

  // ---------- Text for "Share with Ainsley" ----------

  const parameterText = spec.parameters
    .map((p) => `${p.label ? p.label.toLowerCase() : p.name} = ${withUnit(formatStep(values[p.name] ?? p.value, p.step).replace("−", "-"), p.unit)}`)
    .join(", ");

  const share = () => {
    if (practiceMode) {
      const check = practice.check;
      const lines = practice.drawn.map((d) => {
        const verdict = check?.verdicts[d.id];
        const mark = verdict ? (verdict === "right" || verdict === "renamed" ? " (checked: right)" : " (checked: not right)") : "";
        return `- ${d.type ? FORCE_NAMES[d.type] : "An arrow I haven't named"}: ${describeDirection(spec, theta, d.angle)}${mark}`;
      });
      const missing = check?.missing.length
        ? `\nThe check says ${check.missing.length === 1 ? "one force is" : `${check.missing.length} forces are`} missing.`
        : check?.allRight
          ? "\nThe check says it's all right."
          : "";
      const peeked = practice.revealed ? " I've looked at your answer." : "";
      return lines.length
        ? `Here's my free-body diagram for “${spec.title}”:\n${lines.join("\n")}${missing}${peeked}`
        : `I'm working on the free-body diagram for “${spec.title}”.`;
    }
    const listed = visibleForces
      .map((f) => `${f.force.name.toLowerCase()} ${withUnit(formatNumber(f.magnitude), unit)} ${describeDirection(spec, theta, f.angle)}`)
      .join(", ");
    const netText = netShown
      ? `net force ${withUnit(formatNumber(net.magnitude), unit)} ${describeDirection(spec, theta, net.angle)}${mass && unit === "N" ? ` (a = ${formatNumber(net.magnitude / mass)} m/s²)` : ""}`
      : "the forces balance";
    return `In the free-body diagram “${spec.title}”${parameterText ? `, with ${parameterText}` : ""}: ${listed}; ${netText}.`;
  };

  // ---------- Panel: the legend, or the student's arrows ----------

  const legend = (
    <div className="flex flex-col gap-1.5 text-sm">
      {forces.map((f) => (
        <div key={f.index} className="flex min-w-0 items-center gap-2 leading-6">
          <span aria-hidden="true" className="h-[3px] w-4 shrink-0 rounded-full" style={{ background: FORCE_COLORS[f.force.type] }} />
          <TeX tex={f.force.label} className="shrink-0 text-fg" />
          <span className="min-w-0 flex-1 truncate text-muted">{f.force.name}</span>
          <span className="shrink-0 font-mono text-[13px] tabular-nums text-fg">{withUnit(displayNumber(f.magnitude), unit)}</span>
        </div>
      ))}
      <div className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-2 text-[13px] leading-5 text-muted">
        <div className="flex flex-wrap gap-x-3">
          <span>
            ΣF<sub>x</sub> = <span className="font-mono tabular-nums text-fg">{withUnit(displayNumber(sums.x), unit)}</span>
          </span>
          <span>
            ΣF<sub>y</sub> = <span className="font-mono tabular-nums text-fg">{withUnit(displayNumber(sums.y), unit)}</span>
          </span>
        </div>
        <span className="text-xs text-subtle">
          {spec.axes === "incline" ? "x along the incline, y perpendicular to it" : "x horizontal, y vertical"}
        </span>
        <span>
          {net.magnitude <= Math.max(1e-9, largest * 0.005) ? (
            "The forces balance: net force 0"
          ) : (
            <>
              Net force <span className="font-mono tabular-nums text-fg">{withUnit(displayNumber(net.magnitude), unit)}</span>{" "}
              {describeDirection(spec, theta, net.angle)}
            </>
          )}
        </span>
        {mass !== undefined && mass > 0 && unit === "N" && (
          <span>
            a = <span className="font-mono tabular-nums text-fg">{displayNumber(net.magnitude / mass)} m/s²</span>
          </span>
        )}
      </div>
    </div>
  );

  const practicePanel = (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg">Your forces</span>
        <button
          type="button"
          onClick={addArrow}
          disabled={practice.revealed}
          className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Add force
        </button>
      </div>
      {practice.drawn.length === 0 && (
        <span className="text-[13px] leading-5 text-subtle">
          Drag outward from the {spec.object === "particle" ? "object" : "box"} to draw a force, or use Add force.
        </span>
      )}
      {practice.drawn.map((d) => {
        const verdict = verdictOf(d.id);
        return (
          <div
            key={d.id}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-1.5 py-1",
              selected === d.id ? "border-accent/50" : "border-line",
            )}
            onFocus={() => setSelected(d.id)}
          >
            <span aria-hidden="true" className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: d.type ? FORCE_COLORS[d.type] : UNNAMED_COLOR }} />
            <select
              id={`${listId}-${d.id}`}
              value={d.type ?? ""}
              disabled={practice.revealed}
              aria-label="Which force is this arrow?"
              onChange={(e) => {
                const type = e.currentTarget.value as ForceType;
                updateDrawn((drawn) => drawn.map((x) => (x.id === d.id ? { ...x, type } : x)));
              }}
              className="h-7 min-w-0 flex-1 rounded-md bg-transparent text-[13px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <option value="" disabled>
                Which force?
              </option>
              {FORCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FORCE_NAMES[t]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={359}
              value={Math.round(d.angle)}
              disabled={practice.revealed}
              aria-label="Direction, degrees counterclockwise from the +x axis"
              onChange={(e) => {
                const angle = Number(e.currentTarget.value);
                if (Number.isFinite(angle)) {
                  updateDrawn((drawn) => drawn.map((x) => (x.id === d.id ? { ...x, angle: normalizeAngle(angle), length: x.length || 0.6 } : x)));
                }
              }}
              className="h-7 w-12 shrink-0 rounded-md bg-ink/[0.05] px-1 text-right font-mono text-[12px] tabular-nums text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <span aria-hidden="true" className="-ml-1 text-[12px] text-subtle">
              °
            </span>
            {verdict &&
              (verdict === "right" || verdict === "renamed" ? (
                <CircleCheck aria-label="Right" className="size-4 shrink-0 text-[var(--sim-normal)]" />
              ) : (
                <CircleX aria-label="Not right yet" className="size-4 shrink-0 text-danger" />
              ))}
            <button
              type="button"
              aria-label="Remove this arrow"
              disabled={practice.revealed}
              onClick={() => updateDrawn((drawn) => drawn.filter((x) => x.id !== d.id))}
              className="grid size-6 shrink-0 place-items-center rounded-md text-subtle transition-colors hover:bg-ink/[0.06] hover:text-fg disabled:opacity-40"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      {practice.revealed && (
        <div className="mt-1 flex flex-col gap-1 border-t border-line pt-2">
          <span className="text-[13px] font-medium text-fg">Ainsley&apos;s forces</span>
          {visibleForces.map((f) => (
            <div key={f.index} className="flex min-w-0 items-start gap-2 text-[13px] leading-5">
              <span aria-hidden="true" className="mt-2 h-[3px] w-3 shrink-0 rounded-full" style={{ background: FORCE_COLORS[f.force.type] }} />
              <span className="min-w-0 text-muted">
                <span className="text-fg">{f.force.name}</span>, {describeDirection(spec, theta, f.angle)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const toolbar = practiceMode ? (
    <>
      <ToggleChip onClick={runCheck} disabled={practice.drawn.length === 0 || practice.revealed} icon={<Check className="size-3.5" />}>
        Check
      </ToggleChip>
      {practice.checked && (
        <ToggleChip
          pressed={practice.revealed}
          onClick={() => setPractice((p) => ({ ...p, revealed: !p.revealed }))}
          icon={practice.revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        >
          {practice.revealed ? "Hide answer" : "Show answer"}
        </ToggleChip>
      )}
      <ToggleChip
        onClick={() => {
          setPractice({ drawn: [], check: null, checked: practice.checked, revealed: false });
          setSelected(null);
        }}
        disabled={practice.drawn.length === 0 && !practice.revealed}
        icon={<RotateCcw className="size-3.5" />}
      >
        Start over
      </ToggleChip>
    </>
  ) : (
    <>
      <ToggleChip pressed={showComponents} onClick={() => setShowComponents(!showComponents)}>
        Components
      </ToggleChip>
      <ToggleChip pressed={showNet} onClick={() => setShowNet(!showNet)}>
        Net force
      </ToggleChip>
    </>
  );

  const description = practiceMode
    ? `A ${spec.object === "particle" ? "particle" : "box"}${spec.surface === "incline" ? ` on an incline at ${formatNumber(theta)}°` : spec.surface === "horizontal" ? " on a level surface" : ""}. Draw the forces acting on it.`
    : `Free-body diagram: ${visibleForces.map((f) => `${f.force.name}, ${withUnit(formatNumber(f.magnitude), unit)}, ${describeDirection(spec, theta, f.angle)}`).join("; ")}.`;

  return (
    <SimulationFrame
      title={spec.title}
      badge={practiceMode ? "Draw the forces" : undefined}
      toolbar={toolbar}
      share={share}
      footer={!practiceMode ? <ParameterSliders parameters={spec.parameters} values={values} onChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))} /> : undefined}
    >
      <div ref={bodyRef} className="border-t border-line">
        {body.width > 0 && (
          <div className={wide ? "flex" : "flex flex-col"}>
            <div className="relative shrink-0 overflow-hidden" style={{ width: scene.W, height: scene.H }}>
              <svg
                ref={svgRef}
                width={scene.W}
                height={scene.H}
                role={practiceMode ? "group" : "img"}
                aria-label={description}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className={cn("block select-none", practiceMode && !practice.revealed && "touch-none")}
              >
                <SceneBackground scene={scene} spec={spec} />
                {axisLines}
                {componentArrows}
                {angleArcs}
                {forceArrows}
                {answerArrows}
                {drawnArrows}
                {netArrow}
              </svg>
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 text-[13px]">
                {inclineLabel && (
                  <span className="absolute -translate-x-1/2 -translate-y-1/2 text-muted" style={{ left: inclineLabel.x, top: inclineLabel.y }}>
                    <TeX tex={inclineTex} />
                  </span>
                )}
                {objectLabelAt && (
                  <span className="absolute -translate-x-1/2 -translate-y-1/2 text-muted" style={{ left: objectLabelAt.x, top: objectLabelAt.y }}>
                    <TeX tex={spec.objectLabel!} />
                  </span>
                )}
                {placed.map((l) => (
                  <span
                    key={l.key}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded px-0.5 font-medium"
                    style={{ left: l.at.x, top: l.at.y, color: l.color, background: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }}
                  >
                    <TeX tex={l.tex} />
                    {l.verdict === "right" && <Check className="size-3 text-[var(--sim-normal)]" />}
                    {l.verdict === "wrong" && <X className="size-3 text-danger" />}
                  </span>
                ))}
              </div>
              {practiceMode && practice.drawn.length === 0 && !practice.revealed && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -translate-x-1/2 text-[13px] text-subtle"
                  style={{ left: C.x, top: Math.min(scene.H - 22, C.y + scene.half + 34) }}
                >
                  Drag out from the {spec.object === "particle" ? "object" : "box"}
                </span>
              )}
            </div>
            <div className={cn("min-w-0 px-4 py-3", wide ? "flex-1 border-l border-line" : "border-t border-line")}>
              {practiceMode ? practicePanel : legend}
            </div>
          </div>
        )}
        {body.width === 0 && <div style={{ height: 300 }} />}
      </div>
      {practiceMode && practice.check && (
        <div role="status" className="flex flex-col gap-1 border-t border-line px-4 py-3 text-sm leading-6">
          {practice.check.messages.map((m, i) => (
            <span key={i} className={i === 0 && practice.check?.allRight ? "font-medium text-fg" : "text-muted"}>
              {m}
            </span>
          ))}
        </div>
      )}
    </SimulationFrame>
  );
}

/** A short label for a student's arrow. */
function shortName(type: ForceType) {
  switch (type) {
    case "gravity":
      return "\\text{weight}";
    case "normal":
      return "\\text{normal}";
    case "applied":
      return "\\text{applied}";
    case "buoyancy":
      return "\\text{buoyant}";
    default:
      return `\\text{${type}}`;
  }
}

