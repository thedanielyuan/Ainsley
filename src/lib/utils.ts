export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function createId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

export function titleFromText(text: string, max = 48) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const DAY = 86_400_000;

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatShortDate(ts: number, now = Date.now()) {
  const today = startOfDay(now);
  if (ts >= today) return "Today";
  if (ts >= today - DAY) return "Yesterday";
  const d = new Date(ts);
  if (ts >= today - 6 * DAY) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "just now", "5 minutes ago", "yesterday", "3 days ago", then a date. */
export function formatRelative(ts: number, now = Date.now()) {
  const minutes = Math.floor((now - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor((startOfDay(now) - startOfDay(ts)) / DAY);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

export function formatDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

export function omit<V>(obj: Record<string, V>, key: string): Record<string, V> {
  const next = { ...obj };
  delete next[key];
  return next;
}
