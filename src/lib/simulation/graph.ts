import { initialScope, type FunctionGraphSpec } from "./spec";

/**
 * A y-range that fits a graph's functions over its x-range at the sliders' starting values: the
 * whole range of values (with 0 in view), unless a few spikes near an asymptote would flatten
 * everything else, in which case the 2nd–98th percentiles. Padded by 12%.
 */
export function fitYRange(spec: FunctionGraphSpec): [number, number] {
  const scope = initialScope(spec);
  const ys: number[] = [];
  for (const f of spec.functions) {
    for (let i = 0; i <= 200; i++) {
      scope[spec.variable] = spec.xRange[0] + (i / 200) * (spec.xRange[1] - spec.xRange[0]);
      const y = f.f.evaluate(scope);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
  if (!ys.length) return [-5, 5];
  ys.sort((a, b) => a - b);
  let lo = ys[0];
  let hi = ys[ys.length - 1];
  const p2 = ys[Math.floor(ys.length * 0.02)];
  const p98 = ys[Math.ceil(ys.length * 0.98) - 1];
  if (hi - lo > 4 * Math.max(p98 - p2, 1e-9)) {
    lo = p2;
    hi = p98;
  }
  lo = Math.min(lo, 0);
  hi = Math.max(hi, 0);
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}
