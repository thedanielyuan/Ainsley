import type { Scope } from "./expression";
import { FORCE_NAMES, type ForceSpec, type ForceType, type FreeBodySpec } from "./spec";

/**
 * The physics behind a free-body diagram: where each force points, its components along the
 * chosen axes, the net force, and (in practice mode) how a student's diagram compares with the
 * forces Ainsley gave. Angles are degrees counterclockwise from the +x axis, with y pointing up.
 */

const DEG = Math.PI / 180;

export const normalizeAngle = (a: number) => ((a % 360) + 360) % 360;

/** The smaller angle between two directions, 0–180°. */
export function angleBetween(a: number, b: number) {
  const d = normalizeAngle(a - b);
  return d > 180 ? 360 - d : d;
}

export interface ForceState {
  index: number;
  force: ForceSpec;
  /** Never negative: a negative magnitude is drawn as the opposite direction. */
  magnitude: number;
  angle: number;
  fx: number;
  fy: number;
}

/** The incline's angle from the horizontal, in degrees (0 without an incline). */
export function inclineAngle(spec: FreeBodySpec, scope: Scope) {
  if (spec.surface !== "incline" || !spec.incline) return 0;
  const theta = spec.incline.evaluate(scope);
  return Number.isFinite(theta) ? Math.min(80, Math.max(0, theta)) : 0;
}

/** The world directions of up-the-slope and of the surface's outward normal. */
function inclineFrame(spec: FreeBodySpec, theta: number) {
  return spec.inclineRises === "right"
    ? { up: theta, normal: theta + 90, sign: 1 }
    : { up: 180 - theta, normal: 90 - theta, sign: -1 };
}

/** A direction measured from the incline (0° up the slope, 90° out of the surface), as a world angle. */
export function inclineToWorld(spec: FreeBodySpec, theta: number, angle: number) {
  const frame = inclineFrame(spec, theta);
  return frame.up + frame.sign * angle;
}

export function worldToIncline(spec: FreeBodySpec, theta: number, angle: number) {
  const frame = inclineFrame(spec, theta);
  return normalizeAngle(frame.sign * (angle - frame.up));
}

/**
 * The axes components are taken along: x right and y up, or on an incline y out of the surface
 * and x along the slope (right-handed, so x points up the slope when the incline rises to the
 * right and down it when it rises to the left, as textbooks draw them).
 */
export function axisAngles(spec: FreeBodySpec, theta: number) {
  if (spec.axes !== "incline") return { x: 0, y: 90 };
  const { normal } = inclineFrame(spec, theta);
  return { x: normal - 90, y: normal };
}

export function evaluateForces(spec: FreeBodySpec, scope: Scope): ForceState[] {
  const theta = inclineAngle(spec, scope);
  return spec.forces.map((force, index) => {
    let magnitude = force.magnitude.evaluate(scope);
    let angle = force.angle.evaluate(scope);
    if (!Number.isFinite(magnitude) || !Number.isFinite(angle)) {
      magnitude = 0;
      angle = 0;
    }
    if (force.relativeTo === "incline") angle = inclineToWorld(spec, theta, angle);
    if (magnitude < 0) {
      magnitude = -magnitude;
      angle += 180;
    }
    angle = normalizeAngle(angle);
    return { index, force, magnitude, angle, fx: magnitude * Math.cos(angle * DEG), fy: magnitude * Math.sin(angle * DEG) };
  });
}

/** A vector's components along axes whose x axis points at `xAngle`. */
export function components(fx: number, fy: number, xAngle: number) {
  const c = Math.cos(xAngle * DEG);
  const s = Math.sin(xAngle * DEG);
  return { x: fx * c + fy * s, y: -fx * s + fy * c };
}

export function netForce(forces: ForceState[]) {
  let fx = 0;
  let fy = 0;
  for (const f of forces) {
    fx += f.fx;
    fy += f.fy;
  }
  const magnitude = Math.hypot(fx, fy);
  return { fx, fy, magnitude, angle: normalizeAngle(Math.atan2(fy, fx) / DEG) };
}

/**
 * The largest force (or net force) over the sliders' range, so arrows keep one scale while the
 * student moves them: the starting values plus every corner of the parameter box.
 */
export function largestForce(spec: FreeBodySpec, base: Scope) {
  let largest = 0;
  const visit = (scope: Scope) => {
    const forces = evaluateForces(spec, scope);
    for (const f of forces) largest = Math.max(largest, f.magnitude);
    largest = Math.max(largest, netForce(forces).magnitude);
  };
  visit(base);
  const params = spec.parameters.slice(0, 8);
  for (let corner = 0; corner < 1 << params.length; corner++) {
    const scope = { ...base };
    params.forEach((p, i) => {
      scope[p.name] = corner & (1 << i) ? p.max : p.min;
    });
    visit(scope);
  }
  return largest;
}

// ---------- Describing directions ----------

const WORLD_DIRECTIONS: Array<[number, string]> = [
  [0, "to the right"],
  [90, "straight up"],
  [180, "to the left"],
  [270, "straight down"],
];

const INCLINE_DIRECTIONS: Array<[number, string]> = [
  [0, "up the incline"],
  [90, "perpendicular to the incline, away from it"],
  [180, "down the incline"],
  [270, "perpendicular to the incline, into it"],
];

/** "straight down", "up the incline", or "at 120°". */
export function describeDirection(spec: FreeBodySpec, theta: number, angle: number) {
  for (const [a, words] of WORLD_DIRECTIONS) if (angleBetween(angle, a) <= 6) return words;
  if (spec.surface === "incline") {
    const relative = worldToIncline(spec, theta, angle);
    for (const [a, words] of INCLINE_DIRECTIONS) if (angleBetween(relative, a) <= 6) return words;
  }
  return `at ${Math.round(normalizeAngle(angle))}° from the +x axis`;
}

// ---------- Practice mode ----------

/** An arrow the student drew. */
export interface DrawnForce {
  id: string;
  type: ForceType | null;
  /** World angle. */
  angle: number;
  /** Arrow length on screen, in px (only its direction is checked). */
  length: number;
}

export type DrawnVerdict = "right" | "renamed" | "direction" | "extra" | "duplicate" | "untyped";

export interface DiagramCheck {
  verdicts: Record<string, DrawnVerdict>;
  /** Expected forces the student's arrows matched, by index. */
  found: number[];
  missing: ForceState[];
  expected: number;
  allRight: boolean;
  messages: string[];
}

/** Directions within this many degrees count as right. */
export const DIRECTION_TOLERANCE = 20;

/** Types that are often the same force under another name: matched, with a note. */
const SOFT_MATCHES: Partial<Record<ForceType, ForceType[]>> = {
  tension: ["applied"],
  applied: ["tension", "spring"],
  spring: ["applied"],
};

const DIRECTION_HINTS: Record<ForceType, string> = {
  gravity: "Gravity pulls straight down, whatever the surface.",
  normal: "A normal force pushes perpendicular to the surface, away from it.",
  friction: "Friction acts along the surface, against the sliding or the tendency to slide.",
  tension: "A rope or string pulls along its own line, away from the object.",
  applied: "Check which way the push or pull acts.",
  spring: "A spring pushes or pulls along its length, back toward its natural length.",
  drag: "Drag acts opposite to the velocity.",
  buoyancy: "The buoyant force pushes straight up.",
  electric: "Check the signs of the charges: like charges repel, unlike attract.",
  magnetic: "Check the direction with the right-hand rule.",
  other: "Check which way this force acts.",
};

const EXTRA_HINT =
  "A free-body diagram shows only forces other things exert on the object: there's no separate “force of motion”, and forces the object exerts on others belong in their diagrams.";

export function checkDiagram(spec: FreeBodySpec, expectedForces: ForceState[], drawn: DrawnForce[]): DiagramCheck {
  // A force of zero at these values isn't drawn, so it isn't expected either.
  const expected = expectedForces.filter((f) => f.magnitude > 1e-9);
  const verdicts: Record<string, DrawnVerdict> = {};
  const matchedExpected = new Map<number, string>();
  const usedDrawn = new Set<string>();
  const messages: string[] = [];

  // Pair arrows with forces of the same type, closest directions first; then other names for the same force.
  const assign = (soft: boolean) => {
    const pairs: Array<{ e: ForceState; d: DrawnForce; diff: number }> = [];
    for (const e of expected) {
      if (matchedExpected.has(e.index)) continue;
      for (const d of drawn) {
        if (usedDrawn.has(d.id) || !d.type) continue;
        const same = d.type === e.force.type;
        const alias = SOFT_MATCHES[e.force.type]?.includes(d.type) ?? false;
        if (soft ? alias : same) pairs.push({ e, d, diff: angleBetween(d.angle, e.angle) });
      }
    }
    pairs.sort((a, b) => a.diff - b.diff);
    for (const { e, d, diff } of pairs) {
      if (matchedExpected.has(e.index) || usedDrawn.has(d.id)) continue;
      // An alias only counts when it points the right way.
      if (soft && diff > DIRECTION_TOLERANCE) continue;
      matchedExpected.set(e.index, d.id);
      usedDrawn.add(d.id);
      if (diff > DIRECTION_TOLERANCE) {
        verdicts[d.id] = "direction";
        messages.push(`${e.force.name}: check its direction. ${e.force.hint ?? DIRECTION_HINTS[e.force.type]}`);
      } else if (soft) {
        verdicts[d.id] = "renamed";
        messages.push(`Your ${FORCE_NAMES[d.type!].toLowerCase()} points the right way; this force is usually called ${e.force.name.toLowerCase()}.`);
      } else {
        verdicts[d.id] = "right";
      }
    }
  };
  assign(false);
  assign(true);

  let extras = 0;
  for (const d of drawn) {
    if (usedDrawn.has(d.id)) continue;
    if (!d.type) {
      verdicts[d.id] = "untyped";
      continue;
    }
    if (expected.some((e) => e.force.type === d.type)) {
      verdicts[d.id] = "duplicate";
      messages.push(`You drew ${FORCE_NAMES[d.type].toLowerCase()} more than once. Is there really a second one?`);
    } else {
      verdicts[d.id] = "extra";
      extras++;
      messages.push(`${FORCE_NAMES[d.type]}: what exerts this force on the object?`);
    }
  }
  if (extras) messages.push(EXTRA_HINT);
  if (drawn.some((d) => !d.type)) messages.unshift("Choose which force each arrow is.");

  const missing = expected.filter((e) => !matchedExpected.has(e.index));
  if (missing.length) {
    messages.push(
      `${missing.length === 1 ? "One force is" : `${missing.length} forces are`} missing.` +
        (missing.some((m) => m.force.hint)
          ? ` ${missing.map((m) => m.force.hint).filter(Boolean).join(" ")}`
          : " Think about gravity and everything touching the object."),
    );
  }

  const found = [...matchedExpected.entries()].filter(([, id]) => verdicts[id] === "right" || verdicts[id] === "renamed").map(([i]) => i);
  const allRight = missing.length === 0 && drawn.every((d) => verdicts[d.id] === "right" || verdicts[d.id] === "renamed");
  if (allRight) messages.unshift(`All ${expected.length} force${expected.length === 1 ? " is" : "s are"} right.`);
  return { verdicts, found, missing, expected: expected.length, allRight, messages };
}
