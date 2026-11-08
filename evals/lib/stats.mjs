/** Counting, intervals, a worker pool, and the summary table. */

/** A rate metric: k of n, and which way is better ("up", "down", or "zero" when any hit is a failure). */
export function rate(k, n, better = "up") {
  return { k, n, better };
}

/** Wilson 95% interval for k successes in n trials, as fractions. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** "14/16  88%  [64–97]", or "—" when nothing applied. */
export function formatRate({ k, n }) {
  if (!n) return "—";
  const [lo, hi] = wilson(k, n);
  return `${k}/${n}  ${pct(k / n)}  [${Math.round(lo * 100)}–${Math.round(hi * 100)}]`;
}

/** Runs `fn` over `items` with at most `limit` running at once; results in input order. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Renders rows of cells as an aligned plain-text table (first column left, the rest left too). */
export function table(rows) {
  const widths = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, String(cell).length)));
  return rows.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join("   ").trimEnd()).join("\n");
}

export function seconds(ms) {
  const s = Math.round(ms / 1000);
  return s < 120 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
