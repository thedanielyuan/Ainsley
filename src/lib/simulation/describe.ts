import { axisAngles, components, describeDirection, evaluateForces, inclineAngle, netForce } from "./free-body";
import { formatNumber, withUnit } from "./format";
import { initialScope, SIMULATION_NAMES, type Parameter, type SimulationSpec } from "./spec";

/**
 * What show_simulation tells Ainsley it put in front of the student: what they can do with it and
 * what it shows at the starting values, so the reply can point at it instead of describing it.
 */

function sliders(parameters: Parameter[]) {
  if (!parameters.length) return "";
  const list = parameters.map((p) => `${p.label ? `${p.label} ` : ""}${p.name} (${withUnit(`${formatNumber(p.min)}–${formatNumber(p.max)}`, p.unit)}, starting at ${withUnit(formatNumber(p.value), p.unit)})`);
  return `sliders for ${list.join(", ")}`;
}

const CLOSING =
  "It appears in your reply where you called the tool, so refer to it rather than describing it again, and give the student something to do with it: a prediction to make before moving a slider, or a question to answer from what they see. They can share what they did with you; it arrives as their next message.";

export function describeSimulation(spec: SimulationSpec): string {
  const name = SIMULATION_NAMES[spec.kind];
  const scope = initialScope(spec);

  if (spec.kind === "free_body_diagram") {
    if (spec.mode === "practice") {
      return (
        `Shown to the student: a ${name} to draw, “${spec.title}”. They draw an arrow for each force on the object, name it, and check their diagram against your ${spec.forces.length} force${spec.forces.length === 1 ? "" : "s"}, which stay hidden unless they choose to see them. ` +
        "The check marks each arrow's type and direction and gives your hints for missed or misdrawn forces. Don't name or describe the forces in your reply; tell them what to draw it for and to press Check. If they share their diagram and what the check said, it arrives as their next message."
      );
    }
    const theta = inclineAngle(spec, scope);
    const forces = evaluateForces(spec, scope);
    const unit = spec.forceUnit;
    const listed = forces
      .map((f) => `${f.force.name} ${withUnit(formatNumber(f.magnitude), unit)} ${describeDirection(spec, theta, f.angle)}`)
      .join("; ");
    const net = netForce(forces);
    const largest = Math.max(...forces.map((f) => f.magnitude), 0);
    let netText: string;
    if (net.magnitude <= largest * 1e-3) {
      netText = "The forces balance (net force 0).";
    } else {
      netText = `Net force ${withUnit(formatNumber(net.magnitude), unit)} ${describeDirection(spec, theta, net.angle)}`;
      const m = spec.mass?.evaluate(scope);
      if (m && m > 0 && unit === "N") netText += `, so a = ${formatNumber(net.magnitude / m)} m/s²`;
      netText += ".";
    }
    const axes = axisAngles(spec, theta);
    const comps = components(net.fx, net.fy, axes.x);
    const axesText = spec.axes === "incline" ? "axes along and perpendicular to the incline" : "horizontal and vertical axes";
    const can = [
      sliders(spec.parameters),
      `a switch for each force's components (on ${axesText}; ΣFx = ${formatNumber(comps.x)}, ΣFy = ${formatNumber(comps.y)} at the start)`,
      "the net force arrow",
    ].filter(Boolean);
    return (
      `Shown to the student: an interactive ${name}, “${spec.title}”${spec.surface === "incline" ? `, on an incline at ${formatNumber(theta)}°` : ""}. ` +
      `They have ${can.join(", ")}, and a readout of the sums${spec.mass ? " and the acceleration" : ""}. ` +
      `At the starting values: ${listed}. ${netText} ${CLOSING}`
    );
  }

  if (spec.kind === "vector_field") {
    const formula = spec.formula ? ` (${spec.formula})` : "";
    const extras = [spec.flow ? "the flow animation is running" : "", spec.heatmap !== "none" ? `${spec.heatmap} is shaded` : "", spec.traces.length ? `${spec.traces.length} field line${spec.traces.length === 1 ? " is" : "s are"} drawn` : ""].filter(Boolean);
    return (
      `Shown to the student: an interactive ${name}, “${spec.title}”${formula}, from x = ${formatNumber(spec.xRange[0])} to ${formatNumber(spec.xRange[1])} and y = ${formatNumber(spec.yRange[0])} to ${formatNumber(spec.yRange[1])}. ` +
      `They can pan and zoom, read F, its divergence and its curl at any point, click to trace the field line through a point, play a flow animation, and shade divergence or curl${spec.parameters.length ? `; it has ${sliders(spec.parameters)}` : ""}. ` +
      (extras.length ? `At the start ${extras.join(", ")}. ` : "") +
      CLOSING
    );
  }

  const functions = spec.functions.map((f) => (f.label ? `${f.label} = ${f.source}` : f.source)).join(", ");
  return (
    `Shown to the student: an interactive ${name}, “${spec.title}”, of ${functions} for ${spec.variable} from ${formatNumber(spec.xRange[0])} to ${formatNumber(spec.xRange[1])}` +
    `${spec.points.length ? `, with ${spec.points.length} marked point${spec.points.length === 1 ? "" : "s"}` : ""}. ` +
    `They can pan and zoom and read each function's value under the pointer${spec.parameters.length ? `; it has ${sliders(spec.parameters)}` : ""}. ${CLOSING}`
  );
}
