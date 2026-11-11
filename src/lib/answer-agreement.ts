import { readSympy, type Quantity } from "./answer-leak";
import { FUNCTION_NAMES, type Scope } from "./simulation/expression";
import type { SolutionAnswer } from "./types";

/**
 * Whether two solvers reached the same answers (solve_problem, src/lib/server/solve.ts). Each
 * gives every final answer as a sympy expression, and two solvers rarely write one value the same
 * way: 24/5 and 4.8, -1 and -1.0, (x + 1)**2 and x**2 + 2*x + 1. So the forms are compared by
 * value, by evaluating them here: no model is asked.
 *
 * Agreement lets a solution stand as verified without the verifier, so every doubt counts as a
 * difference and goes to the verifier: a form this can't evaluate (a matrix, a complex number, a
 * function it doesn't know), values that differ beyond floating-point error (2*sqrt(3) and 3.46
 * differ: one of them was rounded), a list in another order, an equation against a bare value, or
 * forms that are defined at different sample points.
 */

// Floating-point error only, relative to the values' size: answers in SI units can be tiny
// (1.6e-19), so there is no absolute allowance.
const RELATIVE_ERROR = 1e-9;

// Sample values for the variables in a form: fixed, so results are reproducible. Both signs,
// since sqrt(x**2) and x agree only for positive x, and some below 1, where asin and acos are defined.
const SAMPLES = [
  [1.37, 2.11, 1.73, 2.53, 1.19, 2.87],
  [2.29, 1.41, 2.67, 1.13, 1.97, 1.61],
  [1.83, 2.41, 1.27, 2.03, 2.71, 1.49],
  [0.31, 0.67, 0.43, 0.89, 0.23, 0.59],
  [-0.71, 0.37, -0.29, 0.83, -0.47, 0.61],
  [0.53, -0.19, 0.77, -0.41, 0.11, -0.93],
  [-1.37, -2.11, -1.73, -2.53, -1.19, -2.87],
  [2.29, -1.41, 2.67, -1.13, 1.97, -1.61],
];
// Sample points where both forms have a value: at least this many, all agreeing.
const MIN_SAMPLES = 3;

function sampleScope(names: string[], sample: number): Scope {
  const scope: Scope = {};
  names.forEach((name, k) => {
    const value = SAMPLES[sample][k % 6];
    scope[name] = value + Math.sign(value) * Math.floor(k / 6) * 0.17;
  });
  return scope;
}

const close = (x: number, y: number) => x === y || Math.abs(x - y) <= RELATIVE_ERROR * Math.max(Math.abs(x), Math.abs(y));

function sameQuantity(a: Quantity, b: Quantity): boolean {
  const names = [...new Set([...a.names, ...b.names])].sort();
  if (names.length === 0) {
    const x = a.evaluate({});
    const y = b.evaluate({});
    return Number.isFinite(x) && Number.isFinite(y) && close(x, y);
  }
  let compared = 0;
  for (let sample = 0; sample < SAMPLES.length; sample++) {
    const scope = sampleScope(names, sample);
    const x = a.evaluate(scope);
    const y = b.evaluate(scope);
    // Outside both forms' domain (sqrt of a negative): this point says nothing.
    if (!Number.isFinite(x) && !Number.isFinite(y)) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !close(x, y)) return false;
    compared++;
  }
  return compared >= MIN_SAMPLES;
}

// What a form may call: the evaluator's functions and the sympy names readSympy rewrites. The
// evaluator reads any other name before a bracket as a multiplication, which would make
// erf(2*x) and 2*erf(x) equal.
const CALLABLE = new Set([...FUNCTION_NAMES, "Eq", "FiniteSet", "Tuple", "Rational", "Integer", "Float", "S", "Abs", "ceiling", "Min", "Max"]);
const callsUnknown = (sympy: string) =>
  [...sympy.matchAll(/([\p{L}_][\p{L}\p{N}_]*)\s*\(/gu)].some((m) => !CALLABLE.has(m[1]));

/** Whether two sympy forms have the same value. False whenever that can't be established. */
export function sameSympyValue(a: string, b: string): boolean {
  if (callsUnknown(a) || callsUnknown(b)) return false;
  const x = readSympy(a);
  const y = readSympy(b);
  if (!x || !y || x.shape !== y.shape || x.variable !== y.variable || x.values.length !== y.values.length) return false;
  if (x.shape !== "set") return x.values.every((v, i) => sameQuantity(v, y.values[i]));
  // A set: pair each element with a different one of the other's.
  const left = [...y.values];
  return x.values.every((v) => {
    const k = left.findIndex((w) => sameQuantity(v, w));
    if (k === -1) return false;
    left.splice(k, 1);
    return true;
  });
}

const compact = (s: string) => s.replace(/\s+/g, "");

/** Both solvers gave every answer, part by part, as the same sympy expression or one of the same value. */
export function sameAnswers(a: SolutionAnswer[], b: SolutionAnswer[]): boolean {
  return (
    a.length > 0 &&
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      if (!x.sympy || !y.sympy || compact(x.part).toLowerCase() !== compact(y.part).toLowerCase()) return false;
      return compact(x.sympy) === compact(y.sympy) || sameSympyValue(x.sympy, y.sympy);
    })
  );
}
