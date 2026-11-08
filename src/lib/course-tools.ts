import { courseModules, findModule, type CourseModule } from "./course-modules";
import { courseMaterials, getLibrary, isSearchable, pageUnit, type LibraryState } from "./library";
import { MODULE_TOOL, OPEN_TOOL, SEARCH_TOOL } from "./tool-names";
import type { ApiBlock, Material } from "./types";

/**
 * The tools Ainsley uses to read a student's course materials: search, open a file, and
 * retrieve a module. They run in the browser, where the library lives; /api/chat only
 * declares them.
 */
export { MODULE_TOOL, OPEN_TOOL, SEARCH_TOOL };

/** Search results cite back to this source string, so a citation can open the right page. */
export function materialSource(materialId: string, page: number) {
  return `ainsley:material/${materialId}#page=${page}`;
}

export function parseMaterialSource(source: string) {
  const m = /^ainsley:material\/([A-Za-z0-9_-]+)#page=(\d+)$/.exec(source);
  return m ? { materialId: m[1], page: Number(m[2]) } : null;
}

/** PDFs up to this length are shown to Ainsley whole (pages as images plus text). */
export const MAX_VIEW_PAGES = 100;
const MAX_OPEN_PAGES = 30;
const TOP_K = 6;
/** Keyword matches handed to the re-ranker, which keeps the TOP_K that help most. */
const CANDIDATES = 30;
const RERANK_TIMEOUT_MS = 15_000;
/** A module's text comes back up to about this many characters (~25k tokens), shared fairly between its files. */
const MODULE_MAX_CHARS = 100_000;

/** Which materials a chat may read: its course's, plus files attached in the chat itself. */
export function materialsInScope(s: LibraryState, courseId: string | null, conversationId: string) {
  return Object.values(s.materials).filter(
    (m) => (courseId !== null && m.courseId === courseId) || m.conversationId === conversationId,
  );
}

// ---------- Search (BM25 over page text) ----------

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have how i if in into is it its of on or that the their " +
    "then there these this to was were what when where which while who why will with you your do does " +
    "can could should would about explain what's whats me my we our us they them than so such not no"
  ).split(" "),
);

function stem(w: string) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

export function tokenize(text: string): string[] {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!words) return [];
  return words.filter((w) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w))).map(stem);
}

interface Chunk {
  material: Material;
  page: number;
  text: string;
  terms: Map<string, number>;
  length: number;
}

interface Index {
  chunks: Chunk[];
  df: Map<string, number>;
  avgLength: number;
}

const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 200;

/** Splits a page into overlapping windows, preferring to break at line or sentence ends. */
function chunkPage(text: string): string[] {
  if (text.length <= CHUNK_CHARS * 1.2) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const window = text.slice(start + CHUNK_CHARS * 0.6, end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > 0) end = start + Math.floor(CHUNK_CHARS * 0.6) + cut + 1;
    }
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return out;
}

const indexCache = new WeakMap<Material[], Index>();

function buildIndex(materials: Material[]): Index {
  const cached = indexCache.get(materials);
  if (cached) return cached;
  const chunks: Chunk[] = [];
  const df = new Map<string, number>();
  for (const material of materials) {
    for (const page of material.pages) {
      for (const text of chunkPage(page.text)) {
        if (!text) continue;
        const tokens = tokenize(`${text} ${material.name}`);
        const terms = new Map<string, number>();
        for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
        for (const t of terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
        chunks.push({ material, page: page.n, text, terms, length: tokens.length });
      }
    }
  }
  const avgLength = chunks.reduce((sum, c) => sum + c.length, 0) / Math.max(1, chunks.length);
  const index = { chunks, df, avgLength };
  indexCache.set(materials, index);
  return index;
}

const K1 = 1.4;
const B = 0.75;

/** The best keyword matches, at most one passage per page. */
function search(materials: Material[], query: string, limit: number) {
  const index = buildIndex(materials);
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];
  const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  const n = index.chunks.length;

  const scored = index.chunks.map((chunk) => {
    let score = 0;
    let matched = 0;
    for (const term of queryTerms) {
      const tf = chunk.terms.get(term);
      if (!tf) continue;
      matched++;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * chunk.length) / index.avgLength));
    }
    if (score === 0) return { chunk, score };
    // Reward chunks that cover more of the query, or contain it verbatim.
    score *= 0.6 + 0.4 * (matched / queryTerms.length);
    if (phrase.length > 3 && chunk.text.toLowerCase().includes(phrase)) score *= 1.5;
    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked: Chunk[] = [];
  const seen = new Set<string>();
  for (const { chunk, score } of scored) {
    if (score <= 0 || picked.length >= limit) break;
    const key = `${chunk.material.id}:${chunk.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(chunk);
  }
  return picked;
}

/**
 * Re-orders keyword matches by meaning (/api/materials/rerank) and keeps the `limit` that help,
 * best first, or none when none do. If they can't be judged, the keyword order stands.
 */
async function rerank(query: string, chunks: Chunk[], signal: AbortSignal, limit = TOP_K): Promise<Chunk[]> {
  const keywordOrder = chunks.slice(0, limit);
  try {
    const res = await fetch("/api/materials/rerank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit,
        passages: chunks.map((c) => ({ title: pageTitle(c.material, c.page), text: c.text })),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(RERANK_TIMEOUT_MS)]),
    });
    const data = (await res.json().catch(() => null)) as { order?: unknown } | null;
    if (!res.ok || !Array.isArray(data?.order)) return keywordOrder;
    return data.order.flatMap((i) => (typeof i === "number" && chunks[i] ? [chunks[i]] : [])).slice(0, limit);
  } catch (err) {
    if (signal.aborted) throw err;
    return keywordOrder;
  }
}

/** A passage of a course file: a page, or part of a long one. */
export interface Passage {
  material: Material;
  page: number;
  text: string;
}

/** Keyword matches handed to the re-ranker when finding where a concept is taught. */
const PLACE_CANDIDATES = 15;

/**
 * Where these materials teach `query`: keyword matches re-ranked by meaning, best first, at most
 * `limit`; none when no passage is about it (prerequisite maps use this across all courses).
 */
export async function findPassages(
  s: LibraryState,
  materials: Material[],
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<Passage[]> {
  const candidates = search(stableList(s, materials), query, PLACE_CANDIDATES);
  // Always judged, even when there are few: a wrong "taught in" sends the student to the wrong place.
  return candidates.length ? rerank(query, candidates, signal, limit) : [];
}

// ---------- Tool execution ----------

export interface ToolContext {
  courseId: string | null;
  conversationId: string;
}

export interface ToolOutcome {
  result: Extract<ApiBlock, { type: "tool_result" }>;
  /** Short status for the activity list ("4 passages"). */
  detail: string;
  ok: boolean;
}

function pageTitle(m: Material, page: number) {
  const unit = m.pageCount > 1 || m.kind !== "image" ? ` · ${pageUnit(m.kind)} ${page}` : "";
  return `${m.name}${unit}`;
}

function pageBlock(m: Material, page: number, text: string): ApiBlock {
  return {
    type: "search_result",
    source: materialSource(m.id, page),
    title: pageTitle(m, page),
    content: [{ type: "text", text }],
    citations: { enabled: true },
  };
}

function errorResult(id: string, message: string, detail = "Couldn't run"): ToolOutcome {
  return {
    result: { type: "tool_result", tool_use_id: id, is_error: true, content: message },
    detail,
    ok: false,
  };
}

/** Photos and scans whose text search can't reach (not transcribed, or none found). */
function unviewable(materials: Material[]) {
  return materials.filter((m) => (m.kind === "image" || m.scanned) && !isSearchable(m));
}

export async function runCourseTool(
  block: { id: string; name: string; input: unknown },
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const s = getLibrary();
  const input = (block.input ?? {}) as Record<string, unknown>;
  const scope = materialsInScope(s, ctx.courseId, ctx.conversationId);
  const course = ctx.courseId ? s.courses[ctx.courseId] : undefined;

  if (block.name === SEARCH_TOOL) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) return errorResult(block.id, "`query` must be a non-empty string.");
    if (scope.length === 0) {
      return {
        result: {
          type: "tool_result",
          tool_use_id: block.id,
          content: course
            ? `The student hasn't uploaded any materials to “${course.name}” yet.`
            : "This chat isn't linked to a course and has no attached files, so there's nothing to search.",
        },
        detail: "No materials yet",
        ok: true,
      };
    }

    // Keyword matches (the index is cached per unchanged scope by reusing the same array for the
    // same library), then re-ranked by meaning.
    const candidates = search(stableList(s, scope), query, CANDIDATES);
    const hits = candidates.length > TOP_K ? await rerank(query, candidates, signal) : candidates;
    if (hits.length === 0) {
      const visual = unviewable(scope);
      const note = visual.length
        ? ` These files have no searchable text, but you can view them with ${OPEN_TOOL}: ${visual
            .slice(0, 12)
            .map((m) => `[${m.id}] ${m.name}`)
            .join("; ")}.`
        : "";
      const found = candidates.length
        ? `None of the passages that share words with “${query}” are about it.`
        : `No passages matched “${query}”.`;
      return {
        result: {
          type: "tool_result",
          tool_use_id: block.id,
          content: `${found} Try other wording or the course's own terms, or tell the student their materials don't seem to cover this.${note}`,
        },
        detail: "No matches",
        ok: true,
      };
    }
    return {
      result: {
        type: "tool_result",
        tool_use_id: block.id,
        content: hits.map((c) => pageBlock(c.material, c.page, c.text)) as Extract<
          ApiBlock,
          { type: "tool_result" }
        >["content"],
      },
      detail: `${hits.length} passage${hits.length === 1 ? "" : "s"}`,
      ok: true,
    };
  }

  if (block.name === OPEN_TOOL) {
    const id = typeof input.material_id === "string" ? input.material_id.trim().replace(/^\[|\]$/g, "") : "";
    // Files in the student's other courses open too: a prerequisite map can point to where an
    // earlier course taught something. (Files attached in other chats stay with those chats.)
    const m = scope.find((x) => x.id === id) ?? (s.materials[id]?.courseId ? s.materials[id] : undefined);
    if (!m) {
      return errorResult(
        block.id,
        `No material with id “${id}” in the student's courses or this chat's attachments. Use an id from the course context or a prerequisite map.`,
        "Not found",
      );
    }
    const requested = parsePages(typeof input.pages === "string" ? input.pages : "", m.pageCount);
    if (requested === "invalid") {
      return errorResult(block.id, `\`pages\` should look like "4", "3-7" or "2, 5, 9" (1-${m.pageCount}).`);
    }
    return openMaterial(s, block.id, m, requested);
  }

  if (block.name === MODULE_TOOL) {
    const name = typeof input.module === "string" ? input.module.trim() : "";
    if (!name) return errorResult(block.id, "`module` must be a module's name from the course outline.");
    if (!course) {
      return {
        result: {
          type: "tool_result",
          tool_use_id: block.id,
          content: `This chat isn't in a course, so there are no modules to retrieve. Files attached here can be searched with ${SEARCH_TOOL} or opened with ${OPEN_TOOL}.`,
        },
        detail: "Not in a course",
        ok: true,
      };
    }
    const modules = courseModules(courseMaterials(s, course.id));
    if (modules.length === 0) {
      return {
        result: {
          type: "tool_result",
          tool_use_id: block.id,
          content: `The student hasn't added any materials to “${course.name}” yet.`,
        },
        detail: "No materials yet",
        ok: true,
      };
    }
    const mod = findModule(modules, name);
    if (!mod) {
      const list = modules.map((m) => `${m.title} (${m.materials.length} file${m.materials.length === 1 ? "" : "s"})`);
      return errorResult(
        block.id,
        `No module called “${name}” in “${course.name}”. Its modules: ${list.join("; ")}. Use one of these names, or ${SEARCH_TOOL} to find a topic across modules.`,
        "Not found",
      );
    }
    return moduleResult(block.id, mod);
  }

  return errorResult(block.id, `Unknown tool ${block.name}.`);
}

/** Splits `total` so items needing less than an equal share get all they need and the rest share what's left. */
function fairShares(sizes: number[], total: number): number[] {
  const shares = sizes.map(() => 0);
  let left = total;
  let open = sizes.map((_, i) => i);
  while (open.length > 0 && left > 0) {
    const each = Math.floor(left / open.length);
    if (each === 0) break;
    const unmet: number[] = [];
    for (const i of open) {
      const give = Math.min(sizes[i] - shares[i], each);
      shares[i] += give;
      left -= give;
      if (shares[i] < sizes[i]) unmet.push(i);
    }
    open = unmet;
  }
  return shares;
}

/**
 * A whole module as citable passages: every page of its files in order, or, when that's more
 * than MODULE_MAX_CHARS, each file's opening pages within a fair share of the budget. Page titles
 * show what came back, and the outline in the course context shows what's left.
 */
function moduleResult(id: string, mod: CourseModule): ToolOutcome {
  const files = mod.materials.length;
  const detail = `${files} file${files === 1 ? "" : "s"}`;
  const readable = mod.materials.filter(isSearchable);
  if (readable.length === 0) {
    const list = mod.materials.map((m) => `[${m.id}] ${m.name}`).join("; ");
    return {
      result: {
        type: "tool_result",
        tool_use_id: id,
        content: `“${mod.title}” holds only photos or scans without transcribed text. View them with ${OPEN_TOOL}: ${list}.`,
      },
      detail,
      ok: true,
    };
  }

  const sizes = readable.map((m) => m.pages.reduce((sum, p) => sum + p.text.trim().length, 0));
  const shares = fairShares(sizes, MODULE_MAX_CHARS);
  const blocks: ApiBlock[] = [];
  readable.forEach((m, i) => {
    let used = 0;
    for (const page of m.pages) {
      const text = page.text.trim();
      if (!text) continue;
      if (used + text.length > shares[i]) {
        // A file whose first page alone is over its share still contributes that page's start.
        if (used === 0) blocks.push(pageBlock(m, page.n, `${text.slice(0, Math.max(shares[i], 2_000)).trimEnd()} …`));
        break;
      }
      blocks.push(pageBlock(m, page.n, text));
      used += text.length;
    }
  });
  return {
    result: { type: "tool_result", tool_use_id: id, content: blocks as Extract<ApiBlock, { type: "tool_result" }>["content"] },
    detail,
    ok: true,
  };
}

const stableLists = new WeakMap<Record<string, Material>, Map<string, Material[]>>();

/** Returns the same array instance for the same pool of materials, so the index cache hits. */
function stableList(s: LibraryState, pool: Material[]) {
  let byKey = stableLists.get(s.materials);
  if (!byKey) {
    byKey = new Map();
    stableLists.set(s.materials, byKey);
  }
  const key = pool.map((m) => m.id).join(",");
  let list = byKey.get(key);
  if (!list) {
    list = pool;
    byKey.set(key, list);
  }
  return list;
}

function parsePages(spec: string, max: number): number[] | null | "invalid" {
  if (!spec.trim()) return null;
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) return "invalid";
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    if (from < 1 || to < from) return "invalid";
    for (let p = from; p <= Math.min(to, max); p++) pages.add(p);
  }
  return pages.size ? [...pages].sort((a, b) => a - b) : "invalid";
}

function openMaterial(s: LibraryState, id: string, m: Material, requested: number[] | null): ToolOutcome {
  const ok = (content: Extract<ApiBlock, { type: "tool_result" }>["content"], detail: string): ToolOutcome => ({
    result: { type: "tool_result", tool_use_id: id, content },
    detail,
    ok: true,
  });

  if (m.kind === "image") {
    if (!m.fileId) return errorResult(id, "This image isn't available.", "Unavailable");
    return ok(
      [
        { type: "text", text: `${pageTitle(m, 1)} (image):` },
        { type: "image", source: { type: "file", file_id: m.fileId } },
      ],
      "Viewed image",
    );
  }

  // Whole PDFs of reasonable length: let Ainsley see the pages, diagrams included. Chosen pages
  // of a scan come as their transcribed text, or, before there is any, as the whole scan.
  const untranscribedScan = Boolean(m.scanned) && !isSearchable(m);
  if (m.kind === "pdf" && m.fileId && m.pageCount <= MAX_VIEW_PAGES && (!requested || untranscribedScan)) {
    const note = requested ? ` This is a scan; look at ${pageUnit(m.kind, requested.length)} ${requested.join(", ")}.` : "";
    return ok(
      [
        { type: "text", text: `${m.name} (${m.pageCount} ${pageUnit(m.kind, m.pageCount)}).${note}` },
        {
          type: "document",
          source: { type: "file", file_id: m.fileId },
          title: m.name,
          citations: { enabled: true },
        },
      ],
      `Viewed ${m.pageCount} ${pageUnit(m.kind, m.pageCount)}`,
    );
  }

  if (untranscribedScan) {
    return errorResult(
      id,
      `${m.name} is a ${m.pageCount}-page scan with no text layer, too long to view whole. Ask the student to upload the specific pages they need help with.`,
      "Too long to view",
    );
  }

  const pages = requested ?? (m.pageCount <= MAX_OPEN_PAGES ? m.pages.map((p) => p.n) : null);
  if (!pages) {
    return errorResult(
      id,
      `${m.name} has ${m.pageCount} ${pageUnit(m.kind, m.pageCount)}, too many to open at once. Use ${SEARCH_TOOL} to find the relevant part, or pass \`pages\` (up to ${MAX_OPEN_PAGES}, e.g. "45-52").`,
      "Too long to open",
    );
  }
  const slice = pages.slice(0, MAX_OPEN_PAGES);
  const byNumber = new Map(m.pages.map((p) => [p.n, p.text]));
  // Only search results: the API rejects a tool result that mixes them with any other block
  // (a summary line, say). Each one's title names its file and page, and the tool description
  // gives the page cap, so a request past it can see which pages came back.
  const blocks = slice.map((n) => pageBlock(m, n, byNumber.get(n)?.trim() || "(no text on this page)"));
  return ok(
    blocks as Extract<ApiBlock, { type: "tool_result" }>["content"],
    `Read ${slice.length} ${pageUnit(m.kind, slice.length)}${pages.length > slice.length ? ` of ${pages.length}` : ""}`,
  );
}
