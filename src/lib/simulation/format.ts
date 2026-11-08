/** Numbers as simulations show them: about three significant figures, no trailing zeros. */
export function formatNumber(v: number, significant = 3): string {
  if (!Number.isFinite(v)) return "undefined";
  const abs = Math.abs(v);
  if (abs < 1e-9) return "0";
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(significant - 1).replace(/\.?0+e/, "e");
  const decimals = Math.min(6, Math.max(0, significant - 1 - Math.floor(Math.log10(abs))));
  const s = v.toFixed(decimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** For the screen: a true minus sign. */
export function displayNumber(v: number, significant = 3) {
  return formatNumber(v, significant).replace(/^-/, "−");
}

/** A slider's value, to the precision of its step. */
export function formatStep(v: number, step: number) {
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  return v.toFixed(decimals).replace(/^-/, "−");
}

/** "30°", "2 kg", "5". */
export function withUnit(value: string, unit?: string) {
  if (!unit) return value;
  return unit === "°" || unit === "%" ? `${value}${unit}` : `${value} ${unit}`;
}
