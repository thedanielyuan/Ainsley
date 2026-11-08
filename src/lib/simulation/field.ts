import { scopeWith, type VectorFieldSpec } from "./spec";
import { toWorldX, toWorldY, type View } from "./view";

/**
 * The math behind the vector field explorer: evaluating F, its divergence and curl, a typical
 * strength for scaling arrows and colors, and tracing field lines.
 */

/** Writes F(x, y) into `out` ([P, Q]). */
export type Field = (x: number, y: number, out: number[]) => void;

export function makeField(spec: VectorFieldSpec, values: Record<string, number>): Field {
  const scope = scopeWith(spec, values);
  return (x, y, out) => {
    scope.x = x;
    scope.y = y;
    out[0] = spec.fx.evaluate(scope);
    out[1] = spec.fy.evaluate(scope);
  };
}

/** Divergence and curl (its z component, ∂Q/∂x − ∂P/∂y) by central differences with step h. */
export function derivatives(field: Field, x: number, y: number, h: number) {
  const a = [0, 0];
  const b = [0, 0];
  field(x + h, y, a);
  field(x - h, y, b);
  const dPdx = (a[0] - b[0]) / (2 * h);
  const dQdx = (a[1] - b[1]) / (2 * h);
  field(x, y + h, a);
  field(x, y - h, b);
  const dPdy = (a[0] - b[0]) / (2 * h);
  const dQdy = (a[1] - b[1]) / (2 * h);
  return { div: dPdx + dQdy, curl: dQdx - dPdy };
}

/**
 * A typical strong |F| in view (the 90th percentile over a grid), so one huge value near a
 * singularity doesn't flatten everything else. 0 if F is undefined everywhere in view.
 */
export function typicalMagnitude(field: Field, v: View, w: number, h: number) {
  const out = [0, 0];
  const mags: number[] = [];
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 16; j++) {
      field(toWorldX(v, w, ((i + 0.5) / 24) * w), toWorldY(v, h, ((j + 0.5) / 16) * h), out);
      const m = Math.hypot(out[0], out[1]);
      if (Number.isFinite(m)) mags.push(m);
    }
  }
  if (!mags.length) return 0;
  mags.sort((a, b) => a - b);
  return mags[Math.floor(mags.length * 0.9)] || mags[mags.length - 1];
}

/**
 * The field line through (x0, y0): followed forward and back at unit speed (RK4, steps of
 * `step`) until it leaves `bounds` ([xmin, xmax, ymin, ymax]), reaches a point where F is zero
 * or undefined, or closes on itself. Points run in the field's direction.
 */
export function traceLine(field: Field, x0: number, y0: number, step: number, bounds: [number, number, number, number]) {
  const out = [0, 0];
  const unit = (x: number, y: number, sign: number): [number, number] | null => {
    field(x, y, out);
    const m = Math.hypot(out[0], out[1]);
    if (!Number.isFinite(m) || m < 1e-12) return null;
    return [(sign * out[0]) / m, (sign * out[1]) / m];
  };
  const follow = (sign: number) => {
    const points: Array<[number, number]> = [];
    let x = x0;
    let y = y0;
    for (let i = 0; i < 900; i++) {
      const k1 = unit(x, y, sign);
      if (!k1) break;
      const k2 = unit(x + (step / 2) * k1[0], y + (step / 2) * k1[1], sign);
      if (!k2) break;
      const k3 = unit(x + (step / 2) * k2[0], y + (step / 2) * k2[1], sign);
      if (!k3) break;
      const k4 = unit(x + step * k3[0], y + step * k3[1], sign);
      if (!k4) break;
      x += (step / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      y += (step / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      points.push([x, y]);
      if (x < bounds[0] || x > bounds[1] || y < bounds[2] || y > bounds[3]) break;
      // Back where it started: a closed loop.
      if (i > 12 && Math.hypot(x - x0, y - y0) < step * 0.75) {
        points.push([x0, y0]);
        return { points, closed: true };
      }
    }
    return { points, closed: false };
  };
  const forward = follow(1);
  if (forward.closed) return { points: [[x0, y0] as [number, number], ...forward.points], closed: true };
  const backward = follow(-1);
  return { points: [...backward.points.reverse(), [x0, y0] as [number, number], ...forward.points], closed: false };
}
