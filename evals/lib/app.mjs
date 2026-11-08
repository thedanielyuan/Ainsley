/**
 * Loads Ainsley's own browser-side code into Node, so the evals drive the app the way the
 * browser does: the real tool runner (src/lib/agent-tools.ts), course context, history builder
 * and stream reader, all talking to a running dev server.
 *
 * Three stand-ins make that possible:
 * - Module resolution: `@/…` and extensionless imports inside src/ resolve to the .ts files,
 *   whose types Node strips.
 * - Storage: src/lib/storage.ts (IndexedDB) becomes an in-memory store per trial, so each
 *   simulated student starts with an empty library and no saved solutions.
 * - fetch: relative URLs ("/api/solve") go to the dev server with no response timeout (a solve
 *   can take minutes). Transient Claude API errors from /api/solve and /api/evaluate are retried,
 *   since they measure the network rather than Ainsley; a trial can inject a failure instead.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { registerHooks } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "src");
const STORAGE = path.join(SRC, "lib", "storage.ts");
const STORAGE_URL = pathToFileURL(STORAGE).href;

/** Per-trial state: { id, problems: Map, faults: { [route]: message }, requests: [] }. */
export const trials = new AsyncLocalStorage();
const TRIAL_KEY = Symbol.for("ainsley.evals.trial");
globalThis[TRIAL_KEY] = () => trials.getStore();

export function newTrial(id, faults = {}) {
  return { id, problems: new Map(), faults, requests: [] };
}

// ---------- Module resolution ----------

function sourceFile(specifier, parentURL) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(SRC, specifier.slice(2));
  } else if (/^\.\.?\//.test(specifier) && parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(parentURL);
    if (!parent.startsWith(SRC + path.sep)) return null;
    base = path.resolve(path.dirname(parent), specifier);
  } else {
    return null;
  }
  for (const file of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * storage.ts with every export replaced: solved problems live in the current trial's map, whole
 * stores (loadAll) load empty, and everything else does nothing. Generated from the file's own
 * exports, so a new export there can't break the import graph here.
 */
function storageShim() {
  const exports = [
    ...readFileSync(STORAGE, "utf8").matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let)\s+([A-Za-z_$][\w$]*)(.*)$/gm),
  ];
  const lines = [`const trial = () => globalThis[Symbol.for("ainsley.evals.trial")]();`];
  for (const [, name, rest] of exports) {
    if (name === "loadProblem") lines.push("export async function loadProblem(id) { return trial()?.problems.get(id); }");
    else if (name === "saveProblem") lines.push("export async function saveProblem(p) { trial()?.problems.set(p.id, p); }");
    else if (rest.includes("loadAll<")) lines.push(`export async function ${name}() { return []; }`);
    else lines.push(`export async function ${name}() { return undefined; }`);
  }
  return lines.join("\n");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const file = sourceFile(specifier, context.parentURL);
    if (!file) return nextResolve(specifier, context);
    return { url: pathToFileURL(file).href, format: file.endsWith(".ts") ? "module-typescript" : undefined, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (url === STORAGE_URL) return { format: "module", source: storageShim(), shortCircuit: true };
    return nextLoad(url, context);
  },
});

// ---------- fetch to the dev server ----------

let base = null;
/** Ceiling on any one request to the app, so a hung stream can't hold a worker forever. */
const REQUEST_LIMIT_MS = 20 * 60_000;
// Routes that answer with a small JSON body once the work is done (not a stream).
const RETRIED_ROUTES = new Set(["/api/solve", "/api/evaluate", "/api/check", "/api/audit", "/api/review"]);
const MAX_RETRIES = 2;
// What /api/* report (describeError in src/lib/server/anthropic.ts) when the Claude API itself failed.
export const TRANSIENT = /too many requests|overloaded|couldn't reach the claude api|claude api error/i;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

export const backoff = (attempt) => 5_000 * 3 ** (attempt - 1) * (0.75 + Math.random() / 2);

function plainHeaders(headers) {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

/** One HTTP request with Node's http module: unlike fetch, it has no headers or body timeout. */
function request(url, init, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const send = url.protocol === "https:" ? https.request : http.request;
    const req = send(url, { method: init.method ?? "GET", headers: plainHeaders(init.headers), signal }, (res) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else if (value !== undefined) headers.set(key, value);
      }
      const empty = res.statusCode === 204 || res.statusCode === 304 || init.method === "HEAD";
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    req.on("error", reject);
    if (init.body !== undefined && init.body !== null) req.write(init.body);
    req.end();
  });
}

async function appFetch(pathname, init) {
  const trial = trials.getStore();
  const route = pathname.split("?")[0];
  const started = Date.now();
  const fault = trial?.faults?.[route];
  if (fault) {
    trial.requests.push({ route, status: 502, ms: 0, attempts: 1, injected: true });
    return Response.json({ error: fault }, { status: 502 });
  }
  const signal = AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_LIMIT_MS)].filter(Boolean));
  const url = new URL(pathname, base);

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await request(url, init, signal);
    } catch (err) {
      if (signal.aborted || attempt > MAX_RETRIES) throw err;
      await sleep(backoff(attempt), signal);
      continue;
    }
    if (!RETRIED_ROUTES.has(route)) {
      trial?.requests.push({ route, status: res.status, ms: Date.now() - started, attempts: attempt });
      return res;
    }
    // Solve and check replies are small JSON: read them to see whether the Claude API failed.
    const text = await res.text();
    if (!res.ok && attempt <= MAX_RETRIES && TRANSIENT.test(text)) {
      await sleep(backoff(attempt), signal);
      continue;
    }
    trial?.requests.push({ route, status: res.status, ms: Date.now() - started, attempts: attempt });
    return new Response(text, { status: res.status, headers: res.headers });
  }
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (base && url.startsWith("/")) return appFetch(url, init);
  return realFetch(input, init);
};

/** POSTs JSON to one of Ainsley's routes; the parsed reply and status. */
export async function postJson(route, body, signal) {
  const res = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

/** The /api routes the browser's code calls, from the string literals in src/lib. */
function appRoutes() {
  const routes = new Set();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith(".ts")) {
        for (const m of readFileSync(file, "utf8").matchAll(/["'`](\/api\/[\w/-]+)["'`]/g)) routes.add(m[1]);
      }
    }
  };
  visit(path.join(SRC, "lib"));
  return [...routes].sort();
}

/**
 * Checks the dev server is up and knows every route the browser's code calls: an empty POST gets
 * a 400 from a route that exists. A 404 usually means a dev server started before the route was
 * added (it doesn't always pick up new route folders), which would quietly change what's measured.
 */
export async function checkServer(url) {
  for (const route of appRoutes()) {
    let status;
    try {
      const res = await request(
        new URL(route, url),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        AbortSignal.timeout(120_000),
      );
      status = res.status;
      await res.body?.cancel();
    } catch (err) {
      throw new Error(`Can't reach Ainsley at ${url} (${err.code ?? err.message}). Start it with \`npm run dev\`, or pass --url.`);
    }
    if (status === 404) {
      throw new Error(`The app at ${url} has no ${route}, which the browser's code calls. Restart the dev server so it picks up new routes.`);
    }
  }
}

/** Points the app's fetches at `url` and imports the browser-side modules the evals drive. */
export async function loadApp(url) {
  base = new URL(url);
  const [
    agentTools,
    chatClient,
    courseContext,
    library,
    citations,
    solution,
    answerCheck,
    toolNames,
    tutoring,
    tutoringReview,
    mathCheck,
    replyCheck,
    simulation,
  ] = await Promise.all([
    import("@/lib/agent-tools"),
    import("@/lib/chat-client"),
    import("@/lib/course-context"),
    import("@/lib/library"),
    import("@/lib/citations"),
    import("@/lib/solution"),
    import("@/lib/answer-check"),
    import("@/lib/tool-names"),
    import("@/lib/tutoring"),
    import("@/lib/tutoring-review"),
    import("@/lib/math-check"),
    import("@/lib/reply-check"),
    import("@/lib/simulation/marker"),
  ]);
  await library.loadLibrary();
  return {
    runTool: agentTools.runTool,
    toolActivity: agentTools.toolActivity,
    streamChat: chatClient.streamChat,
    toApiMessages: chatClient.toApiMessages,
    closeTurns: chatClient.closeTurns,
    correctionPrefix: chatClient.correctionPrefix,
    buildContext: courseContext.buildContext,
    lastContextState: courseContext.lastContextState,
    getLibrary: library.getLibrary,
    summarizeReply: citations.summarizeReply,
    TurnTutor: tutoring.TurnTutor,
    reviewsSettled: tutoringReview.reviewsSettled,
    startReview: tutoringReview.startReview,
    withReview: tutoringReview.withReview,
    checkReply: replyCheck.checkReply,
    auditStatus: mathCheck.auditStatus,
    auditLabel: mathCheck.auditLabel,
    containsMath: mathCheck.containsMath,
    correctionRequest: mathCheck.correctionRequest,
    unsettledAnswers: mathCheck.unsettledAnswers,
    simulationMarker: simulation.simulationMarker,
    withoutSimulations: simulation.withoutSimulations,
    SOLUTION_LABELS: solution.SOLUTION_LABELS,
    VERDICT_LABELS: answerCheck.VERDICT_LABELS,
    SOLVE_TOOL: toolNames.SOLVE_TOOL,
    EVALUATE_TOOL: toolNames.EVALUATE_TOOL,
    CHECK_TOOL: toolNames.CHECK_TOOL,
    SIMULATION_TOOL: toolNames.SIMULATION_TOOL,
  };
}
