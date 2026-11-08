import { parseMaterialSource } from "./course-tools";
import type { LibraryState } from "./library";
import type { ApiTurn, ChatMessage, Source } from "./types";

type Citation = {
  type: string;
  cited_text?: string;
  url?: string;
  title?: string | null;
  source?: string;
  document_title?: string | null;
  start_page_number?: number;
};

export interface ReplySummary {
  /** Plain text: everything Ainsley wrote, for copying and search. */
  text: string;
  /** Markdown with a citation marker where each cited passage ends (see `markerHref`). */
  display: string;
  /** Sources, numbered by first citation; pages read but not cited (`uncited`) come last. */
  sources: Source[];
}

/** One source behind a citation marker: its number (1-based), and which of its quotes is cited there. */
export interface CiteRef {
  n: number;
  q?: number;
}

/** Cited passages kept per source, for the source details in chat. */
const MAX_QUOTES = 6;

/** "#src-1.0,3": source 1 (its quote 0) and source 3. Replies saved earlier used "#cite-1". */
function markerHref(refs: CiteRef[]) {
  return `#src-${refs.map((r) => (r.q === undefined ? r.n : `${r.n}.${r.q}`)).join(",")}`;
}

function marker(refs: CiteRef[]) {
  return ` [${refs.map((r) => r.n).join(",")}](${markerHref(refs)})`;
}

export function parseMarkerHref(href: string | undefined): CiteRef[] | null {
  const m = /^#(?:src|cite)-(\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)*)$/.exec(href ?? "");
  if (!m) return null;
  return m[1].split(",").map((part) => {
    const [n, q] = part.split(".");
    return { n: Number(n), q: q === undefined ? undefined : Number(q) };
  });
}

/** True when the end of `text` is inside a code block, inline code, or math. */
function insideCodeOrMath(text: string) {
  if ((text.match(/```/g) ?? []).length % 2 === 1) return true;
  if ((text.match(/\$\$/g) ?? []).length % 2 === 1) return true;
  const line = text.slice(text.lastIndexOf("\n") + 1);
  if ((line.replace(/\\\$/g, "").replace(/\$\$/g, "").match(/\$/g) ?? []).length % 2 === 1) return true;
  return (line.match(/`/g) ?? []).length % 2 === 1;
}

/** Appends a marker to `body` (inside the last cell when it ends a table row), or null where it can't go. */
function appendMarker(body: string, mark: string): string | null {
  if (insideCodeOrMath(body)) return null;
  const line = body.slice(body.lastIndexOf("\n") + 1);
  if (!line.trimEnd().endsWith("|")) return body + mark;
  if (/^[\s|:-]*$/.test(line)) return null; // A table's header separator.
  const pipe = body.lastIndexOf("|");
  const cell = body.slice(0, pipe).trimEnd();
  if (cell.endsWith("|")) return null; // An empty cell.
  return `${cell}${mark} ${body.slice(pipe)}`;
}

/**
 * Turns an assistant reply's API transcript into what the student sees: the text, with a
 * marker where Ainsley cited their materials or the web (rendered as a source chip), and the
 * numbered sources behind those markers.
 */
export function summarizeReply(turns: ApiTurn[], s: LibraryState): ReplySummary {
  let text = "";
  let display = "";
  let separate = false;
  const sources: Source[] = [];
  const numbers = new Map<string, number>();

  // Web pages Ainsley fetched, so citations into them can link to the page.
  const fetched = new Map<string, string>();
  for (const turn of turns) {
    for (const block of turn.content) {
      if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
        const title = block.content.content.title;
        if (title) fetched.set(title, block.content.url);
      }
    }
  }

  const sourceFor = (c: Citation): [string, Source] | null => {
    if (c.type === "search_result_location" && c.source) {
      const ref = parseMaterialSource(c.source);
      if (ref) {
        const title = s.materials[ref.materialId]?.name ?? c.title ?? "Course material";
        return [`m:${ref.materialId}:${ref.page}`, { type: "material", materialId: ref.materialId, page: ref.page, title }];
      }
    }
    if (c.type === "web_search_result_location" && c.url) {
      return [`w:${c.url}`, { type: "web", url: c.url, title: c.title || c.url }];
    }
    const docTitle = c.document_title ?? undefined;
    if (docTitle) {
      const url = fetched.get(docTitle);
      if (url) return [`w:${url}`, { type: "web", url, title: docTitle }];
      const material = Object.values(s.materials).find((m) => m.name === docTitle);
      const page = c.type === "page_location" ? c.start_page_number : undefined;
      if (material) {
        return [
          `m:${material.id}:${page ?? 0}`,
          { type: "material", materialId: material.id, page, title: material.name },
        ];
      }
      return [`d:${docTitle}:${page ?? 0}`, { type: "material", materialId: "", page, title: docTitle }];
    }
    return null;
  };

  const quoteIndex = (source: Source, cited: string | undefined) => {
    const quote = cited?.replace(/\s+/g, " ").trim();
    if (!quote) return undefined;
    const quotes = (source.quotes ??= []);
    const i = quotes.indexOf(quote);
    if (i !== -1) return i;
    if (quotes.length >= MAX_QUOTES) return undefined;
    quotes.push(quote);
    return quotes.length - 1;
  };

  // Sources cited in the text so far that still need a marker. A cited passage that ends
  // inside code or math gets its marker at the next place one can go.
  let pending: CiteRef[] = [];
  const placePending = () => {
    if (pending.length === 0) return;
    const trailing = /\s*$/.exec(display)?.[0] ?? "";
    const placed = appendMarker(display.slice(0, display.length - trailing.length), marker(pending));
    if (placed === null) return;
    display = placed + trailing;
    pending = [];
  };

  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    separate = true;
    for (const block of turn.content) {
      if (block.type !== "text") {
        separate = true;
        continue;
      }
      if (!block.text) continue;
      if (separate && text && !text.endsWith("\n")) {
        text += "\n\n";
        display += "\n\n";
      }
      separate = false;
      text += block.text;
      display += block.text;

      for (const c of (block.citations ?? []) as Citation[]) {
        const found = sourceFor(c);
        if (!found) continue;
        const [key, source] = found;
        let n = numbers.get(key);
        if (n === undefined) {
          sources.push(source);
          n = sources.length;
          numbers.set(key, n);
        }
        if (pending.some((r) => r.n === n)) continue;
        pending.push({ n, q: quoteIndex(sources[n - 1], c.cited_text) });
      }
      placePending();
    }
  }
  placePending();

  // Web results reached through result filtering (code execution) come back without
  // citations, and Ainsley links its sources inline instead. A link to a page it really found
  // (never one it didn't) becomes a source chip like a citation; pages it read in full but
  // neither cited nor linked are listed as further reading.
  const found = new Map<string, string>();
  const read: Array<{ url: string; title: string }> = [];
  for (const turn of turns) {
    for (const block of turn.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) found.set(normalizeUrl(r.url), r.title);
      } else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
        const title = block.content.content.title || block.content.url;
        found.set(normalizeUrl(block.content.url), title);
        read.push({ url: block.content.url, title });
      }
    }
  }
  const byUrl = new Map<string, number>();
  sources.forEach((x, i) => {
    if (x.type === "web") byUrl.set(normalizeUrl(x.url), i + 1);
  });
  const webNumber = (url: string, title: string, uncited?: boolean) => {
    const key = normalizeUrl(url);
    let n = byUrl.get(key);
    if (n === undefined) {
      sources.push({ type: "web", url, title, ...(uncited ? { uncited } : {}) });
      n = sources.length;
      byUrl.set(key, n);
    }
    return n;
  };

  display = mapOutsideCode(display, (part) =>
    part.replace(/(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (link, label: string, url: string) => {
      const title = found.get(normalizeUrl(url));
      if (title === undefined) return link;
      const n = webNumber(url, title || label);
      const words = /^(https?:\/\/|www\.)\S*$/i.test(label.trim()) ? "" : label;
      return `${words}${marker([{ n }])}`;
    }),
  );
  for (const page of read) webNumber(page.url, page.title, true);

  return { text, display, sources };
}

/** Applies `fn` to the parts of some Markdown outside fenced and inline code. */
function mapOutsideCode(markdown: string, fn: (part: string) => string) {
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join("");
}

function normalizeUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const views = new WeakMap<ChatMessage, { display?: string; sources?: Source[] }>();

/**
 * A finished reply's Markdown and sources. Replies without source chips (saved before them, or
 * citing nothing) are re-derived from their transcript; messages are immutable, so this is cached.
 */
export function replyCitations(message: ChatMessage, s: LibraryState) {
  let view = views.get(message);
  if (!view) {
    const legacy = Boolean(message.turns && !message.display?.includes("(#src-"));
    const summary = legacy && message.turns ? summarizeReply(message.turns, s) : null;
    view = summary
      ? { display: summary.display || message.display, sources: summary.sources.length ? summary.sources : message.sources }
      : { display: message.display, sources: message.sources };
    views.set(message, view);
  }
  return view;
}
