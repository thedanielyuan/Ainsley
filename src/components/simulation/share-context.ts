"use client";

import { createContext, useContext } from "react";

/**
 * Puts text into the student's message box, for a simulation's "Share with Ainsley": what they set
 * or drew, ready to send with a question of their own. Null where there's no composer.
 */
export const SimulationShareContext = createContext<((text: string) => void) | null>(null);

export function useSimulationShare() {
  return useContext(SimulationShareContext);
}
