import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ApiBlock } from "@/lib/types";

/**
 * Prepares the response content to be sent back on later requests. After a server-side
 * fallback, work from before the last switch point belongs to the model that declined:
 * only its text and completed server-tool calls carry over.
 */
export function toReplayContent(content: Anthropic.Beta.BetaContentBlock[]): ApiBlock[] {
  let boundary = -1;
  content.forEach((block, i) => {
    if (block.type === "fallback") boundary = i;
  });
  const answered = new Set<string>();
  for (const block of content) {
    if ("tool_use_id" in block && typeof block.tool_use_id === "string") answered.add(block.tool_use_id);
  }

  const out: Anthropic.Beta.BetaContentBlock[] = [];
  content.forEach((block, i) => {
    if (block.type === "fallback") return;
    if (block.type === "text" && !block.text) return;
    if (i < boundary) {
      const keep =
        block.type === "text" ||
        (block.type === "server_tool_use" && answered.has(block.id)) ||
        block.type === "web_search_tool_result" ||
        block.type === "web_fetch_tool_result";
      if (!keep) return;
    }
    out.push(block);
  });
  return out as unknown as ApiBlock[];
}
