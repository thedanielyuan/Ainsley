import { SIMULATION_TOOL } from "../tool-names";

/**
 * A reply shows each simulation where Ainsley called show_simulation, as a fenced block of this
 * language holding the tool's input (markdown.tsx renders it). The JSON stays on one line, with `
 * and $ escaped, so it can't close the fence or read as math to the citation code. Kept apart
 * from the simulation code itself, which loads only when a reply has a simulation.
 */
export const SIMULATION_LANGUAGE = "ainsley-simulation";

export { SIMULATION_TOOL };

export function simulationMarker(input: unknown): string {
  const json = JSON.stringify(input ?? {})
    .replace(/`/g, "\\u0060")
    .replace(/\$/g, "\\u0024");
  return `\`\`\`${SIMULATION_LANGUAGE}\n${json}\n\`\`\`\n`;
}

const MARKER = new RegExp(`\`\`\`${SIMULATION_LANGUAGE}\\n[^\\n]*\\n\`\`\`\\n?`, "g");

/** Text without its simulation blocks: what a reply says, for copying and search. */
export function withoutSimulations(text: string) {
  if (!text.includes(SIMULATION_LANGUAGE)) return text;
  return text.replace(MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
}
