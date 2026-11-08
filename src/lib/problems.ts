import { parseSolution, type SolveInput } from "./solution";
import { loadProblem, saveProblem } from "./storage";
import type { VerifiedSolution } from "./types";

/**
 * Solutions Ainsley has worked out (solve_problem), kept on this device by problem: the same
 * problem in the same course, with the same answer key, is solved once, and evaluate_answer finds
 * the solution again by its id.
 */

/** Bump when how problems are solved changes, so saved solutions are worked out again. */
const SOLVER_VERSION = 1;

/** A problem's id: the same problem text, course and answer key always get the same one. */
export async function problemId(input: SolveInput, courseId: string | null): Promise<string> {
  const key = [courseId ?? "", input.problem, input.reference ?? ""]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .join("\u0000");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return `p${[...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The saved solution with this id, if there is one from the current solver. */
export async function savedSolution(id: string): Promise<VerifiedSolution | null> {
  try {
    const saved = await loadProblem(id);
    return saved?.version === SOLVER_VERSION ? parseSolution(saved.solution) : null;
  } catch {
    return null;
  }
}

export async function saveSolution(id: string, courseId: string | null, problem: string, solution: VerifiedSolution) {
  try {
    await saveProblem({ id, courseId, problem, solution, version: SOLVER_VERSION, createdAt: Date.now() });
  } catch {
    // Not saved: the problem is worked out again next time.
  }
}
