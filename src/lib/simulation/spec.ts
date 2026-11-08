import { compile, ExpressionError, isValidName, type Compiled, type Scope } from "./expression";

/**
 * What show_simulation draws: the tool input Ainsley writes, validated into a typed spec. The
 * same parser runs when the tool is called (its errors go back to Ainsley so it can fix the call)
 * and when a reply is shown (the input is replayed from the reply's transcript).
 */

export const SIMULATION_KINDS = ["free_body_diagram", "vector_field", "function_graph"] as const;
export type SimulationKind = (typeof SIMULATION_KINDS)[number];

/** A slider the student moves; its value is a variable in the simulation's expressions. */
export interface Parameter {
  name: string;
  /** Plain-text name, e.g. "Incline angle". */
  label?: string;
  /** LaTeX symbol, e.g. "\\theta"; the name when unset. */
  symbol: string;
  min: number;
  max: number;
  value: number;
  step: number;
  unit?: string;
}

interface Base {
  title: string;
  parameters: Parameter[];
  constants: Record<string, number>;
}

export const FORCE_TYPES = [
  "gravity",
  "normal",
  "friction",
  "tension",
  "applied",
  "spring",
  "drag",
  "buoyancy",
  "electric",
  "magnetic",
  "other",
] as const;
export type ForceType = (typeof FORCE_TYPES)[number];

export const FORCE_NAMES: Record<ForceType, string> = {
  gravity: "Gravity (weight)",
  normal: "Normal force",
  friction: "Friction",
  tension: "Tension",
  applied: "Applied force (push or pull)",
  spring: "Spring force",
  drag: "Drag (air or fluid resistance)",
  buoyancy: "Buoyant force",
  electric: "Electric force",
  magnetic: "Magnetic force",
  other: "Other force",
};

export interface ForceSpec {
  name: string;
  type: ForceType;
  /** LaTeX, e.g. "F_N". */
  label: string;
  magnitude: Compiled;
  /** Degrees counterclockwise from `relativeTo`'s reference direction. */
  angle: Compiled;
  /** "horizontal": 0° points right, 90° up. "incline": 0° up the slope, 90° out of the surface. */
  relativeTo: "horizontal" | "incline";
  /** LaTeX for an arc between this force and the nearest axis, e.g. "\\theta". */
  angleLabel?: string;
  /** Practice mode: a nudge shown if the student misses or misdraws this force. */
  hint?: string;
}

export interface FreeBodySpec extends Base {
  kind: "free_body_diagram";
  object: "box" | "particle";
  objectLabel?: string;
  surface: "none" | "horizontal" | "incline";
  /** Degrees from the horizontal. */
  incline?: Compiled;
  inclineSource?: string;
  inclineRises: "right" | "left";
  forces: ForceSpec[];
  axes: "standard" | "incline";
  mass?: Compiled;
  forceUnit: string;
  showComponents: boolean;
  showNetForce: boolean;
  mode: "explore" | "practice";
}

export interface VectorFieldSpec extends Base {
  kind: "vector_field";
  /** LaTeX, e.g. "\\vec F(x,y) = \\langle -y,\\ x \\rangle". */
  formula?: string;
  fx: Compiled;
  fy: Compiled;
  /** The components as Ainsley wrote them. */
  sourceX: string;
  sourceY: string;
  xRange: [number, number];
  yRange: [number, number];
  flow: boolean;
  heatmap: "none" | "divergence" | "curl";
  /** Points whose field lines start out drawn. */
  traces: Array<[number, number]>;
}

export interface GraphFunction {
  label?: string;
  source: string;
  f: Compiled;
}

export interface FunctionGraphSpec extends Base {
  kind: "function_graph";
  variable: string;
  functions: GraphFunction[];
  points: Array<{ label?: string; x: Compiled; y: Compiled }>;
  xRange: [number, number];
  /** Unset: fitted to the functions. */
  yRange?: [number, number];
  xLabel?: string;
  yLabel?: string;
}

export type SimulationSpec = FreeBodySpec | VectorFieldSpec | FunctionGraphSpec;

export const SIMULATION_NAMES: Record<SimulationKind, string> = {
  free_body_diagram: "free-body diagram",
  vector_field: "vector field",
  function_graph: "graph",
};

// ---------- Limits ----------

const MAX_PARAMETERS = 8;
const MAX_CONSTANTS = 12;
const MAX_FORCES = 10;
const MAX_FUNCTIONS = 6;
const MAX_POINTS = 12;
const MAX_TRACES = 12;

// ---------- Parsing ----------

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

class Errors {
  list: string[] = [];
  add(path: string, message: string) {
    if (this.list.length < 20) this.list.push(`${path}: ${message}`);
  }
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const clean = v.trim();
  return clean ? clean.slice(0, max) : undefined;
}

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T, errors: Errors, path: string): T {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "string" && (options as readonly string[]).includes(v)) return v as T;
  errors.add(path, `must be one of ${options.map((o) => `"${o}"`).join(", ")}`);
  return fallback;
}

/** An expression field: a string, or a plain number. */
function expression(v: unknown, allowed: ReadonlySet<string>, errors: Errors, path: string): Compiled | undefined {
  const source = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v : undefined;
  if (source === undefined) {
    errors.add(path, v === undefined ? "is required" : "must be an expression (a string) or a number");
    return undefined;
  }
  try {
    return compile(source, allowed);
  } catch (err) {
    errors.add(path, `"${source.slice(0, 80)}" can't be read: ${err instanceof ExpressionError ? err.message : "invalid expression"}`);
    return undefined;
  }
}

function range(v: unknown, fallback: [number, number] | undefined, errors: Errors, path: string): [number, number] | undefined {
  if (v === undefined || v === null) return fallback;
  if (Array.isArray(v) && v.length === 2) {
    const [a, b] = v.map(finite);
    if (a !== undefined && b !== undefined && a < b && b - a < 1e9) return [a, b];
  }
  errors.add(path, "must be [min, max] with min < max");
  return fallback;
}

/** A slider step that lands on round numbers: about 1/100 of the range. */
function defaultStep(min: number, max: number) {
  const raw = (max - min) / 100;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

function parseParameters(raw: unknown, reserved: ReadonlySet<string>, errors: Errors): Parameter[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.add("parameters", "must be a list");
    return [];
  }
  if (raw.length > MAX_PARAMETERS) errors.add("parameters", `at most ${MAX_PARAMETERS}`);
  const out: Parameter[] = [];
  const seen = new Set<string>();
  raw.slice(0, MAX_PARAMETERS).forEach((p, i) => {
    const path = `parameters[${i}]`;
    if (!isObject(p)) return errors.add(path, "must be an object");
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!isValidName(name)) return errors.add(`${path}.name`, `"${name}" must start with a letter and contain only letters, digits and _ (and not be a function name)`);
    if (reserved.has(name)) return errors.add(`${path}.name`, `"${name}" is already the simulation's own variable`);
    if (seen.has(name)) return errors.add(`${path}.name`, `"${name}" is declared twice`);
    seen.add(name);
    const min = finite(p.min);
    const max = finite(p.max);
    if (min === undefined || max === undefined || min >= max) return errors.add(path, "needs numbers min < max");
    const step = finite(p.step) && (p.step as number) > 0 && (p.step as number) <= max - min ? (p.step as number) : defaultStep(min, max);
    const value = Math.min(max, Math.max(min, finite(p.value) ?? min));
    out.push({
      name,
      label: text(p.label, 40),
      symbol: text(p.symbol, 40) ?? name,
      min,
      max,
      value,
      step,
      unit: text(p.unit, 12),
    });
  });
  return out;
}

function parseConstants(raw: unknown, taken: ReadonlySet<string>, errors: Errors): Record<string, number> {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) {
    errors.add("constants", 'must be an object of names to numbers, e.g. {"g": 9.8}');
    return {};
  }
  const out: Record<string, number> = {};
  const entries = Object.entries(raw);
  if (entries.length > MAX_CONSTANTS) errors.add("constants", `at most ${MAX_CONSTANTS}`);
  for (const [name, value] of entries.slice(0, MAX_CONSTANTS)) {
    if (!isValidName(name)) errors.add(`constants.${name}`, "isn't a valid name");
    else if (taken.has(name)) errors.add(`constants.${name}`, "is already a parameter or variable");
    else if (finite(value) === undefined) errors.add(`constants.${name}`, "must be a number");
    else out[name] = value as number;
  }
  return out;
}

/** The scope at the sliders' starting values. */
export function initialScope(spec: Base): Scope {
  const scope: Scope = { ...spec.constants };
  for (const p of spec.parameters) scope[p.name] = p.value;
  return scope;
}

export function scopeWith(spec: Base, values: Record<string, number>): Scope {
  const scope: Scope = { ...spec.constants };
  for (const p of spec.parameters) scope[p.name] = values[p.name] ?? p.value;
  return scope;
}

function parseFreeBody(raw: Raw, base: Base, names: ReadonlySet<string>, errors: Errors): FreeBodySpec | null {
  const path = "free_body_diagram";
  const surface = oneOf(raw.surface, ["none", "horizontal", "incline"] as const, "none", errors, `${path}.surface`);
  const scope = initialScope(base);

  let incline: Compiled | undefined;
  let inclineSource: string | undefined;
  if (surface === "incline") {
    incline = expression(raw.incline_angle, names, errors, `${path}.incline_angle`);
    inclineSource = String(raw.incline_angle ?? "");
    const theta = incline?.evaluate(scope);
    if (theta !== undefined && !(theta >= 0 && theta <= 80)) {
      errors.add(`${path}.incline_angle`, `is ${theta} at the starting values; it must be between 0 and 80 degrees`);
    }
    for (const p of base.parameters) {
      if (incline?.uses.has(p.name) && (p.min < 0 || p.max > 80) && inclineSource.trim() === p.name) {
        errors.add(`parameters.${p.name}`, "sets the incline angle, so its range must stay within 0–80 degrees");
      }
    }
  }

  if (!Array.isArray(raw.forces) || raw.forces.length === 0) {
    errors.add(`${path}.forces`, "must list at least one force");
    return null;
  }
  if (raw.forces.length > MAX_FORCES) errors.add(`${path}.forces`, `at most ${MAX_FORCES}`);
  const forces: ForceSpec[] = [];
  raw.forces.slice(0, MAX_FORCES).forEach((f, i) => {
    const at = `${path}.forces[${i}]`;
    if (!isObject(f)) return errors.add(at, "must be an object");
    const type = oneOf(f.type, FORCE_TYPES, "other", errors, `${at}.type`);
    const relativeTo = oneOf(f.relative_to, ["horizontal", "incline"] as const, "horizontal", errors, `${at}.relative_to`);
    if (relativeTo === "incline" && surface !== "incline") errors.add(`${at}.relative_to`, 'is "incline" but the surface isn\'t an incline');
    const magnitude = expression(f.magnitude, names, errors, `${at}.magnitude`);
    const angle = expression(f.angle, names, errors, `${at}.angle`);
    if (magnitude && !Number.isFinite(magnitude.evaluate(scope))) {
      errors.add(`${at}.magnitude`, "isn't a finite number at the starting values");
    }
    if (angle && !Number.isFinite(angle.evaluate(scope))) errors.add(`${at}.angle`, "isn't a finite number at the starting values");
    const name = text(f.name, 40) ?? FORCE_NAMES[type];
    if (!magnitude || !angle) return;
    forces.push({
      name,
      type,
      label: text(f.label, 40) ?? name,
      magnitude,
      angle,
      relativeTo,
      angleLabel: text(f.angle_label, 30),
      hint: text(f.hint, 240),
    });
  });

  let mass: Compiled | undefined;
  if (raw.mass !== undefined && raw.mass !== null) {
    mass = expression(raw.mass, names, errors, `${path}.mass`);
    const m = mass?.evaluate(scope);
    if (m !== undefined && !(m > 0)) errors.add(`${path}.mass`, "must be positive at the starting values");
  }

  const axes = oneOf(raw.axes, ["standard", "incline"] as const, surface === "incline" ? "incline" : "standard", errors, `${path}.axes`);
  return {
    kind: "free_body_diagram",
    ...base,
    object: oneOf(raw.object, ["box", "particle"] as const, "box", errors, `${path}.object`),
    objectLabel: text(raw.object_label, 20),
    surface,
    incline,
    inclineSource,
    inclineRises: oneOf(raw.incline_rises, ["right", "left"] as const, "right", errors, `${path}.incline_rises`),
    forces,
    axes: surface === "incline" ? axes : "standard",
    mass,
    forceUnit: text(raw.force_unit, 8) ?? "N",
    showComponents: raw.show_components === true,
    showNetForce: raw.show_net_force !== false,
    mode: oneOf(raw.mode, ["explore", "practice"] as const, "explore", errors, `${path}.mode`),
  };
}

function parseVectorField(raw: Raw, base: Base, names: ReadonlySet<string>, errors: Errors): VectorFieldSpec | null {
  const path = "vector_field";
  const fx = expression(raw.x, names, errors, `${path}.x`);
  const fy = expression(raw.y, names, errors, `${path}.y`);
  const xRange = range(raw.x_range, [-5, 5], errors, `${path}.x_range`) as [number, number];
  const yRange = range(raw.y_range, [-5, 5], errors, `${path}.y_range`) as [number, number];
  if (!fx || !fy) return null;

  // The field must be defined somewhere in view (a singular point, like the origin of 1/r², is fine).
  const scope = initialScope(base);
  let defined = 0;
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      scope.x = xRange[0] + ((i + 0.37) / 7) * (xRange[1] - xRange[0]);
      scope.y = yRange[0] + ((j + 0.61) / 7) * (yRange[1] - yRange[0]);
      if (Number.isFinite(fx.evaluate(scope)) && Number.isFinite(fy.evaluate(scope))) defined++;
    }
  }
  if (defined === 0) errors.add(path, "the field isn't a finite number anywhere in the starting view");

  const traces: Array<[number, number]> = [];
  if (Array.isArray(raw.trace_from)) {
    raw.trace_from.slice(0, MAX_TRACES).forEach((p, i) => {
      const [x, y] = Array.isArray(p) ? p.map(finite) : [];
      if (x === undefined || y === undefined) errors.add(`${path}.trace_from[${i}]`, "must be [x, y]");
      else traces.push([x, y]);
    });
  } else if (raw.trace_from !== undefined && raw.trace_from !== null) {
    errors.add(`${path}.trace_from`, "must be a list of [x, y] points");
  }

  return {
    kind: "vector_field",
    ...base,
    formula: text(raw.formula, 200),
    fx,
    fy,
    sourceX: String(raw.x),
    sourceY: String(raw.y),
    xRange,
    yRange,
    flow: raw.flow === true,
    heatmap: oneOf(raw.heatmap, ["none", "divergence", "curl"] as const, "none", errors, `${path}.heatmap`),
    traces,
  };
}

function parseGraph(raw: Raw, base: Base, names: ReadonlySet<string>, variable: string, errors: Errors): FunctionGraphSpec | null {
  const path = "function_graph";
  if (!Array.isArray(raw.functions) || raw.functions.length === 0) {
    errors.add(`${path}.functions`, "must list at least one function");
    return null;
  }
  if (raw.functions.length > MAX_FUNCTIONS) errors.add(`${path}.functions`, `at most ${MAX_FUNCTIONS}`);
  const functions: GraphFunction[] = [];
  raw.functions.slice(0, MAX_FUNCTIONS).forEach((f, i) => {
    const at = `${path}.functions[${i}]`;
    const expr = isObject(f) ? f.expression : f;
    const compiled = expression(expr, names, errors, `${at}.expression`);
    if (compiled) functions.push({ source: String(expr), f: compiled, label: isObject(f) ? text(f.label, 60) : undefined });
  });

  const points: FunctionGraphSpec["points"] = [];
  if (Array.isArray(raw.points)) {
    raw.points.slice(0, MAX_POINTS).forEach((p, i) => {
      const at = `${path}.points[${i}]`;
      if (!isObject(p)) return errors.add(at, "must be an object with x and y");
      const pointNames = new Set([...names].filter((n) => n !== variable));
      const x = expression(p.x, pointNames, errors, `${at}.x`);
      const y = expression(p.y, pointNames, errors, `${at}.y`);
      if (x && y) points.push({ x, y, label: text(p.label, 40) });
    });
  }

  const xRange = range(raw.x_range, [-10, 10], errors, `${path}.x_range`) as [number, number];
  return {
    kind: "function_graph",
    ...base,
    variable,
    functions,
    points,
    xRange,
    yRange: range(raw.y_range, undefined, errors, `${path}.y_range`),
    xLabel: text(raw.x_label, 40),
    yLabel: text(raw.y_label, 40),
  };
}

/** Validates show_simulation's input. Errors are worded for Ainsley, with the path of each problem. */
export function parseSimulation(input: unknown): { spec: SimulationSpec } | { errors: string[] } {
  const errors = new Errors();
  if (!isObject(input)) return { errors: ["The input must be an object."] };
  const kind = input.kind;
  if (typeof kind !== "string" || !(SIMULATION_KINDS as readonly string[]).includes(kind)) {
    return { errors: [`kind: must be one of ${SIMULATION_KINDS.map((k) => `"${k}"`).join(", ")}`] };
  }
  const title = text(input.title, 100);
  if (!title) errors.add("title", "is required");

  const body = input[kind];
  if (!isObject(body)) return { errors: [`${kind}: the details for a ${kind} go in an object named "${kind}"`] };

  // The simulation's own variables: x and y in a field, the graph's variable.
  const graphVariable = kind === "function_graph" ? (text(body.variable, 24) ?? "x") : "";
  if (kind === "function_graph" && !isValidName(graphVariable)) {
    errors.add("function_graph.variable", "must be a simple name such as x or t");
  }
  const own = new Set(kind === "vector_field" ? ["x", "y"] : kind === "function_graph" ? [graphVariable] : []);

  const parameters = parseParameters(input.parameters, own, errors);
  const taken = new Set([...own, ...parameters.map((p) => p.name)]);
  const constants = parseConstants(input.constants, taken, errors);
  const names = new Set([...taken, ...Object.keys(constants)]);
  const base: Base = { title: title ?? "", parameters, constants };

  const spec =
    kind === "free_body_diagram"
      ? parseFreeBody(body, base, names, errors)
      : kind === "vector_field"
        ? parseVectorField(body, base, names, errors)
        : parseGraph(body, base, names, graphVariable, errors);

  if (errors.list.length || !spec) return { errors: errors.list.length ? errors.list : ["The simulation is incomplete."] };
  return { spec };
}
