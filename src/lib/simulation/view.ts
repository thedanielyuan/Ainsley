/**
 * A plane's view: world coordinates at the canvas center and pixels per unit. Shared by the
 * vector field and the graph, and by the math that samples what's in view.
 */
export interface View {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

export function fitView(xRange: [number, number], yRange: [number, number], w: number, h: number, equal: boolean): View {
  const sx = w / (xRange[1] - xRange[0]);
  const sy = h / (yRange[1] - yRange[0]);
  const cx = (xRange[0] + xRange[1]) / 2;
  const cy = (yRange[0] + yRange[1]) / 2;
  if (!equal) return { cx, cy, sx, sy };
  const s = Math.min(sx, sy);
  return { cx, cy, sx: s, sy: s };
}

export const toScreenX = (v: View, w: number, x: number) => w / 2 + (x - v.cx) * v.sx;
export const toScreenY = (v: View, h: number, y: number) => h / 2 - (y - v.cy) * v.sy;
export const toWorldX = (v: View, w: number, px: number) => v.cx + (px - w / 2) / v.sx;
export const toWorldY = (v: View, h: number, py: number) => v.cy - (py - h / 2) / v.sy;

/** 1, 2 or 5 times a power of ten, at least `raw`. */
export function niceStep(raw: number) {
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}
