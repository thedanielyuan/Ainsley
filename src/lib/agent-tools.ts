import { parseEvaluateInput, VERDICT_LABELS, workAttachments } from "./answer-check";
import { runCourseTool, type ToolContext, type ToolOutcome } from "./course-tools";
import { conceptNames } from "./knowledge";
import { getLibrary } from "./library";
import { checkLabel, formatCheck, parseCheckInput } from "./math-check";
import { parsePrerequisiteMap, parseTraceInput, type TraceResponse } from "./prerequisite-map";
import { afterCheck, traceReport, traceRequest } from "./prerequisites";
import { problemId, savedSolution, saveSolution } from "./problems";
import { formatSolution, parseSolution, parseSolveInput, SOLUTION_LABELS } from "./solution";
import {
  CHECK_TOOL,
  EVALUATE_TOOL,
  MODULE_TOOL,
  OPEN_TOOL,
  PREREQUISITES_TOOL,
  SEARCH_TOOL,
  SIMULATION_TOOL,
  SOLVE_TOOL,
} from "./tool-names";
import type { Activity, CheckResponse, EvaluateResponse, Material, SolveResponse, VerifiedSolution } from "./types";

/**
 * Runs the tool calls Ainsley makes on the browser's side of its loop, and describes each for the
 * activity list under a reply. Course tools read the local library; solving goes to /api/solve
 * (and the solution is saved here), answer checks to /api/evaluate (and what they show goes into
 * the student's knowledge map), math checks to /api/check, prerequisite maps to
 * /api/prerequisites (and into the knowledge map, with where the student's courses teach each
 * part); a simulation is checked here and drawn in the reply. (Web search and fetch run on
 * Anthropic's side.)
 */

export interface AgentToolContext extends ToolContext {
  /** Files on the student's latest message: the problem or work a solve or answer check looks at. */
  attachments: Material[];
}

export async function runTool(
  call: { id: string; name: string; input: unknown },
  ctx: AgentToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (call.name === SOLVE_TOOL) return runSolve(call, ctx, signal);
  if (call.name === EVALUATE_TOOL) return runEvaluate(call, ctx, signal);
  if (call.name === CHECK_TOOL) return runCheck(call, signal);
  if (call.name === SIMULATION_TOOL) return runSimulation(call);
  if (call.name === PREREQUISITES_TOOL) return runTrace(call, ctx, signal);
  return runCourseTool(call, ctx, signal);
}

/**
 * Checks a simulation's input (the reply then draws it where Ainsley called the tool) and tells
 * Ainsley what the student now sees, or what to fix. The simulation code loads only when used.
 */
async function runSimulation(call: { id: string; input: unknown }): Promise<ToolOutcome> {
  const [{ parseSimulation }, { describeSimulation }] = await Promise.all([
    import("./simulation/spec"),
    import("./simulation/describe"),
  ]);
  const parsed = parseSimulation(call.input);
  if ("errors" in parsed) {
    return failed(
      call.id,
      `The simulation wasn't shown. Fix these and call ${SIMULATION_TOOL} again:\n${parsed.errors.map((e) => `- ${e}`).join("\n")}`,
      "Couldn't show it",
    );
  }
  return answered(call.id, describeSimulation(parsed.spec), "");
}

function failed(id: string, message: string, detail: string): ToolOutcome {
  return { result: { type: "tool_result", tool_use_id: id, is_error: true, content: message }, detail, ok: false };
}

function answered(id: string, content: string, detail: string): ToolOutcome {
  return { result: { type: "tool_result", tool_use_id: id, content }, detail, ok: true };
}

/** Posts a tool's work to one of Ainsley's own endpoints; the JSON reply, or a failed outcome. */
async function post<T>(
  url: string,
  body: unknown,
  call: { id: string },
  signal: AbortSignal,
  failure: { what: string; fallback: string; detail: string },
): Promise<{ data: T } | { outcome: ToolOutcome }> {
  let res: Response;
  let data: (T & { error?: string }) | null = null;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  } catch (err) {
    if (signal.aborted) throw err;
    return { outcome: failed(call.id, `${failure.what} couldn't be reached. ${failure.fallback}`, failure.detail) };
  }
  if (!res.ok || !data) {
    const reason = data?.error ? `: ${data.error}` : ` (${res.status})`;
    return { outcome: failed(call.id, `${failure.what} failed${reason}. ${failure.fallback}`, failure.detail) };
  }
  return { data };
}

async function runSolve(
  call: { id: string; input: unknown },
  ctx: AgentToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const input = parseSolveInput(call.input);
  if (typeof input === "string") return failed(call.id, input, "Couldn't run");

  // The same problem in the same course is worked out once.
  const id = await problemId(input, ctx.courseId);
  const saved = await savedSolution(id);
  if (saved) return answered(call.id, formatSolution(id, saved), SOLUTION_LABELS[saved.status]);

  const fallback =
    "Nothing was verified. Check what you'd tell the student with check_math, and tell them you're not sure of anything it can't verify.";
  const reply = await post<Partial<SolveResponse>>(
    "/api/solve",
    { input, attachments: workAttachments(ctx.attachments) },
    call,
    signal,
    { what: "Solving", fallback, detail: "Couldn't solve" },
  );
  if ("outcome" in reply) return reply.outcome;
  const solution = parseSolution(reply.data.solution);
  if (!solution) return answered(call.id, `The solvers declined to work this problem. ${fallback}`, "Couldn't solve");

  await saveSolution(id, ctx.courseId, input.problem, solution);
  return answered(call.id, formatSolution(id, solution), SOLUTION_LABELS[solution.status]);
}

const EVALUATE_FALLBACK =
  "Check their result with check_math; if it can't settle whether they're right, tell them you're not sure and what you couldn't check.";

async function runEvaluate(
  call: { id: string; input: unknown },
  ctx: AgentToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const input = parseEvaluateInput(call.input);
  if (typeof input === "string") return failed(call.id, input, "Couldn't run");

  // A problem Ainsley worked out first: the checker starts from its solution.
  let solution: VerifiedSolution | null = null;
  let note = "";
  if (input.problem_id) {
    solution = await savedSolution(input.problem_id);
    if (!solution) note = `No saved solution has the id ${input.problem_id}, so the check worked the problem out itself.\n\n`;
  }

  // The concepts already in the student's knowledge map, so the check names them the same way.
  const concepts = await conceptNames().catch(() => []);
  const reply = await post<Partial<EvaluateResponse>>(
    "/api/evaluate",
    { input, attachments: workAttachments(ctx.attachments), solution, concepts },
    call,
    signal,
    { what: "The answer check", fallback: EVALUATE_FALLBACK, detail: "Couldn't check" },
  );
  if ("outcome" in reply) return reply.outcome;
  const { content, verdict } = reply.data;
  if (typeof content !== "string" || !verdict) {
    return failed(call.id, `The answer check failed. ${EVALUATE_FALLBACK}`, "Couldn't check");
  }
  const prerequisite = await afterCheck(reply.data, ctx).catch((err) => {
    console.error("[ainsley] couldn't record the answer check in the knowledge map:", err);
    return "";
  });
  const text = note + content + (prerequisite ? `\n\n${prerequisite}` : "");
  return answered(call.id, text, VERDICT_LABELS[verdict] ?? "Checked");
}

async function runTrace(
  call: { id: string; input: unknown },
  ctx: AgentToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const input = parseTraceInput(call.input);
  if (typeof input === "string") return failed(call.id, input, "Couldn't run");

  const fallback =
    "Work out what this concept builds on yourself, and ask the student a quick question on the most likely gap before you explain.";
  const reply = await post<Partial<TraceResponse>>(
    "/api/prerequisites",
    await traceRequest(input, ctx.courseId),
    call,
    signal,
    { what: "Mapping prerequisites", fallback, detail: "Couldn't map" },
  );
  if ("outcome" in reply) return reply.outcome;
  const map = parsePrerequisiteMap(reply.data.map);
  if (!map) return answered(call.id, `The prerequisite mapper declined. ${fallback}`, "Couldn't map");
  const { content, detail } = await traceReport(map, signal);
  return answered(call.id, content, detail);
}

async function runCheck(call: { id: string; input: unknown }, signal: AbortSignal): Promise<ToolOutcome> {
  const input = parseCheckInput(call.input);
  if (typeof input === "string") return failed(call.id, input, "Couldn't run");

  const fallback =
    "Nothing was verified: don't state these claims as fact. Leave them out, or tell the student you're not sure of them because you couldn't check them.";
  const reply = await post<Partial<CheckResponse>>("/api/check", { input }, call, signal, {
    what: "The math check",
    fallback,
    detail: "Couldn't check",
  });
  if ("outcome" in reply) return reply.outcome;
  const claims = reply.data.claims;
  if (!Array.isArray(claims) || claims.length !== input.claims.length) {
    return failed(call.id, `The math check returned an unexpected answer. ${fallback}`, "Couldn't check");
  }
  return answered(call.id, formatCheck(claims), checkLabel(claims));
}

/** A tool call as the activity list shows it while it runs; null for calls that aren't shown. */
export function toolActivity(name: string, input: Record<string, unknown>, id: string): Activity | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case SEARCH_TOOL:
      return { id, kind: "materials", label: str(input.query), status: "running" };
    case OPEN_TOOL: {
      const material = getLibrary().materials[str(input.material_id)];
      const pages = str(input.pages) ? ` (${str(input.pages)})` : "";
      return { id, kind: "open", label: `${material?.name ?? "a file"}${pages}`, status: "running" };
    }
    case MODULE_TOOL:
      return { id, kind: "module", label: str(input.module).trim() || "a module", status: "running" };
    case SOLVE_TOOL:
      return { id, kind: "solve", label: str(input.problem).replace(/\s+/g, " ").trim(), status: "running" };
    case EVALUATE_TOOL:
      return { id, kind: "evaluate", label: str(input.problem).replace(/\s+/g, " ").trim(), status: "running" };
    case CHECK_TOOL: {
      const n = Array.isArray(input.claims) ? input.claims.length : 0;
      return { id, kind: "check", label: n ? `${n} claim${n === 1 ? "" : "s"}` : "", status: "running" };
    }
    case SIMULATION_TOOL: {
      const names: Record<string, string> = {
        free_body_diagram: "free-body diagram",
        vector_field: "vector field",
        function_graph: "graph",
      };
      return { id, kind: "simulation", label: names[str(input.kind)] ?? "simulation", status: "running" };
    }
    case PREREQUISITES_TOOL: {
      const concept = str(input.concept).replace(/\s+/g, " ").trim();
      return { id, kind: "prerequisites", label: concept || "the concept", status: "running" };
    }
    case "web_search":
      return { id, kind: "web_search", label: str(input.query), status: "running" };
    case "web_fetch": {
      let label = str(input.url);
      try {
        const url = new URL(label);
        label = `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
      } catch {
        // Keep the raw string.
      }
      return { id, kind: "web_fetch", label, status: "running" };
    }
    default:
      return null; // Code execution behind web search's result filtering isn't shown.
  }
}
