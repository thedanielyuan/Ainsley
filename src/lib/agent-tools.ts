import { parseEvaluateInput, VERDICT_LABELS, workAttachments } from "./answer-check";
import { runCourseTool, type ToolContext, type ToolOutcome } from "./course-tools";
import { getLibrary } from "./library";
import { EVALUATE_TOOL, MODULE_TOOL, OPEN_TOOL, SEARCH_TOOL } from "./tool-names";
import type { Activity, EvaluateResponse, Material } from "./types";

/**
 * Runs the tool calls Ainsley makes on the browser's side of its loop, and describes each for the
 * activity list under a reply. Course tools read the local library; answer checks go to
 * /api/evaluate. (Web search and fetch run on Anthropic's side.)
 */

export interface AgentToolContext extends ToolContext {
  /** Files on the student's latest message: the work an answer check should look at. */
  attachments: Material[];
}

export async function runTool(
  call: { id: string; name: string; input: unknown },
  ctx: AgentToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (call.name === EVALUATE_TOOL) return runEvaluate(call, ctx, signal);
  return runCourseTool(call, ctx, signal);
}

function failed(id: string, message: string, detail: string): ToolOutcome {
  return { result: { type: "tool_result", tool_use_id: id, is_error: true, content: message }, detail, ok: false };
}

async function runEvaluate(
  call: { id: string; input: unknown },
  ctx: AgentToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const input = parseEvaluateInput(call.input);
  if (typeof input === "string") return failed(call.id, input, "Couldn't run");

  const fallback = "Check the answer yourself, carefully.";
  let res: Response;
  let data: Partial<EvaluateResponse> | null = null;
  try {
    res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, attachments: workAttachments(ctx.attachments) }),
      signal,
    });
    data = (await res.json().catch(() => null)) as Partial<EvaluateResponse> | null;
  } catch (err) {
    if (signal.aborted) throw err;
    return failed(call.id, `The answer check couldn't be reached. ${fallback}`, "Couldn't check");
  }
  if (!res.ok || typeof data?.content !== "string" || !data.verdict) {
    const reason = data?.error ? `: ${data.error}` : ` (${res.status})`;
    return failed(call.id, `The answer check failed${reason}. ${fallback}`, "Couldn't check");
  }
  return {
    result: { type: "tool_result", tool_use_id: call.id, content: data.content },
    detail: VERDICT_LABELS[data.verdict] ?? "Checked",
    ok: true,
  };
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
    case EVALUATE_TOOL:
      return { id, kind: "evaluate", label: str(input.problem).replace(/\s+/g, " ").trim(), status: "running" };
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
