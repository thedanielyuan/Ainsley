"use client";

import { useMemo } from "react";
import { parseSimulation } from "@/lib/simulation/spec";
import FreeBodyDiagram from "./free-body-diagram";
import FunctionGraph from "./function-graph";
import VectorField from "./vector-field";

/**
 * A simulation in a reply, from the show_simulation input stored there. Loaded only when a reply
 * has one (see markdown.tsx).
 */
export default function SimulationBlock({ source }: { source: string }) {
  const parsed = useMemo(() => {
    try {
      return parseSimulation(JSON.parse(source));
    } catch {
      return { errors: ["The simulation couldn't be read."] };
    }
  }, [source]);

  if ("errors" in parsed) {
    return (
      <div className="mb-4 rounded-2xl border border-line px-4 py-3 text-sm text-subtle">
        This simulation couldn&apos;t be shown.
      </div>
    );
  }
  const { spec } = parsed;
  switch (spec.kind) {
    case "free_body_diagram":
      return <FreeBodyDiagram spec={spec} stateKey={source} />;
    case "vector_field":
      return <VectorField spec={spec} stateKey={source} />;
    case "function_graph":
      return <FunctionGraph spec={spec} stateKey={source} />;
  }
}
