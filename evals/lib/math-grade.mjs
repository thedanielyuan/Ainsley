/**
 * Grades a solver's final answers against known values without trusting a model: the solver
 * gives each answer as a sympy expression ("3*sqrt(2)/2", "Matrix([[1, 0], [0, 1]])",
 * "FiniteSet(2, 5)"), which this evaluates numerically and compares within a tolerance.
 * Answers it can't evaluate (units as symbols, prose) come back ungraded for a judge to settle.
 */

/** An ordered (tuple, list, matrix row, interval) or unordered (set) collection of values. */
export class Seq {
  constructor(items, unordered = false) {
    this.items = items;
    this.unordered = unordered;
  }
}

const isNum = (v) => typeof v === "number";

function numeric(fn) {
  return (...args) => {
    if (!args.every(isNum)) throw new Error("expected numbers");
    return fn(...args);
  };
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error("bad factorial");
  let out = 1;
  for (let k = 2; k <= n; k++) out *= k;
  return out;
}

const FUNCTIONS = {
  sqrt: numeric(Math.sqrt),
  cbrt: numeric(Math.cbrt),
  root: numeric((x, n) => (x < 0 && n % 2 === 1 ? -((-x) ** (1 / n)) : x ** (1 / n))),
  exp: numeric(Math.exp),
  log: numeric((x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b))),
  ln: numeric(Math.log),
  log10: numeric(Math.log10),
  log2: numeric(Math.log2),
  sin: numeric(Math.sin),
  cos: numeric(Math.cos),
  tan: numeric(Math.tan),
  sec: numeric((x) => 1 / Math.cos(x)),
  csc: numeric((x) => 1 / Math.sin(x)),
  cot: numeric((x) => 1 / Math.tan(x)),
  asin: numeric(Math.asin),
  acos: numeric(Math.acos),
  atan: numeric(Math.atan),
  atan2: numeric(Math.atan2),
  sinh: numeric(Math.sinh),
  cosh: numeric(Math.cosh),
  tanh: numeric(Math.tanh),
  Abs: numeric(Math.abs),
  abs: numeric(Math.abs),
  floor: numeric(Math.floor),
  ceiling: numeric(Math.ceil),
  Max: numeric(Math.max),
  Min: numeric(Math.min),
  factorial: numeric(factorial),
  binomial: numeric((n, k) => factorial(n) / (factorial(k) * factorial(n - k))),
  Rational: numeric((p, q = 1) => p / q),
  Integer: numeric((x) => x),
  Float: numeric((x) => x),
  N: (x) => x,
  S: (x) => x,
  nsimplify: (x) => x,
  simplify: (x) => x,
  Matrix: (rows) => {
    if (!(rows instanceof Seq)) throw new Error("Matrix needs rows");
    return new Seq(rows.items);
  },
  ImmutableMatrix: (rows) => FUNCTIONS.Matrix(rows),
  Tuple: (...items) => new Seq(items),
  Point: (...items) => new Seq(items),
  Interval: numeric((a, b) => new Seq([a, b])),
  FiniteSet: (...items) => new Seq(items, true),
  Eq: (lhs, rhs) => rhs,
};

const CONSTANTS = { pi: Math.PI, E: Math.E, oo: Infinity };

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/^(),[\]{}]))/y;

function tokenize(src) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`can't read "${src.slice(start, start + 12)}"`);
    if (m[1] !== undefined) tokens.push({ kind: "num", value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: "id", value: m[2] });
    else tokens.push({ kind: "op", value: m[3] });
  }
  return tokens;
}

function elementwise(a, b, op) {
  if (isNum(a) && isNum(b)) return op(a, b);
  if (a instanceof Seq && isNum(b)) return new Seq(a.items.map((x) => elementwise(x, b, op)), a.unordered);
  if (isNum(a) && b instanceof Seq) return new Seq(b.items.map((x) => elementwise(a, x, op)), b.unordered);
  if (a instanceof Seq && b instanceof Seq && a.items.length === b.items.length && !a.unordered && !b.unordered) {
    return new Seq(a.items.map((x, i) => elementwise(x, b.items[i], op)));
  }
  throw new Error("can't combine these values");
}

/** Evaluates a sympy-style expression to a number or a Seq; throws if it can't. */
export function evaluate(src) {
  const tokens = tokenize(String(src));
  let i = 0;
  const peek = () => tokens[i]?.value;
  const take = (value) => {
    if (tokens[i]?.value !== value) throw new Error(`expected "${value}"`);
    i++;
  };

  function list(close) {
    const items = [];
    while (peek() !== close) {
      items.push(expr());
      if (peek() === ",") i++;
      else if (peek() !== close) throw new Error(`expected "," or "${close}"`);
    }
    take(close);
    return items;
  }

  function atom() {
    const t = tokens[i++];
    if (!t) throw new Error("unexpected end");
    if (t.kind === "num") return t.value;
    if (t.kind === "op" && t.value === "(") {
      const items = list(")");
      return items.length === 1 ? items[0] : new Seq(items);
    }
    if (t.kind === "op" && t.value === "[") return new Seq(list("]"));
    if (t.kind === "op" && t.value === "{") return new Seq(list("}"), true);
    if (t.kind === "id") {
      if (peek() === "(") {
        i++;
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new Error(`unknown function ${t.value}`);
        return fn(...list(")"));
      }
      if (t.value in CONSTANTS) return CONSTANTS[t.value];
      throw new Error(`unknown symbol ${t.value}`);
    }
    throw new Error(`unexpected "${t.value}"`);
  }

  function power() {
    const left = atom();
    if (peek() === "**" || peek() === "^") {
      i++;
      return elementwise(left, unary(), (a, b) => a ** b);
    }
    return left;
  }

  function unary() {
    if (peek() === "-") {
      i++;
      return elementwise(unary(), -1, (a, b) => a * b);
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return power();
  }

  function term() {
    let left = unary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[i++].value;
      left = elementwise(left, unary(), op === "*" ? (a, b) => a * b : (a, b) => a / b);
    }
    return left;
  }

  function expr() {
    let left = term();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[i++].value;
      left = elementwise(left, term(), op === "+" ? (a, b) => a + b : (a, b) => a - b);
    }
    return left;
  }

  const value = expr();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i].value}"`);
  return value;
}

const DEFAULT_TOLERANCE = { rel: 0.005 };

/** A column vector (Matrix([[1], [2]])) as a plain list, so it compares with a tuple. */
function flatColumn(v) {
  if (!(v instanceof Seq) || !v.items.length || !v.items.every((x) => x instanceof Seq && x.items.length === 1)) return v;
  return new Seq(v.items.map((x) => x.items[0]), v.unordered);
}

/**
 * Whether two values have the same structure: both numbers, both sets (of any size: a set with
 * the wrong members is just wrong), or ordered collections of the same length.
 */
export function sameShape(a, b) {
  a = flatColumn(a);
  b = flatColumn(b);
  if (isNum(a) || isNum(b)) return isNum(a) && isNum(b);
  return a.unordered || b.unordered || a.items.length === b.items.length;
}

/** Whether `actual` equals `expected` within the tolerance ({ rel } and/or { abs }), elementwise. */
export function matches(actual, expected, tol = DEFAULT_TOLERANCE) {
  actual = flatColumn(actual);
  expected = flatColumn(expected);
  if (isNum(expected)) {
    if (!isNum(actual) || Number.isNaN(actual)) return false;
    if (!Number.isFinite(expected)) return actual === expected;
    return Math.abs(actual - expected) <= Math.max(tol.abs ?? 0, (tol.rel ?? 0) * Math.abs(expected), 1e-12);
  }
  if (!(expected instanceof Seq) || !(actual instanceof Seq) || actual.items.length !== expected.items.length) {
    return false;
  }
  if (!expected.unordered && !actual.unordered) {
    return expected.items.every((e, k) => matches(actual.items[k], e, tol));
  }
  // A set: pair each expected item with a different actual item.
  const left = [...actual.items];
  return expected.items.every((e) => {
    const k = left.findIndex((a) => matches(a, e, tol));
    if (k === -1) return false;
    left.splice(k, 1);
    return true;
  });
}

const normalizePart = (part) =>
  String(part ?? "")
    .toLowerCase()
    .replace(/part/g, "")
    .replace(/[^a-z0-9]/g, "");

function tryEvaluate(src) {
  if (!src || !String(src).trim()) return { ok: false, error: "no sympy form" };
  try {
    return { ok: true, value: evaluate(src) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Lines the solver's answers up with the expected parts, by label, else by order. A part answered
 * across several entries (a tuple given as x, y and z separately) is combined in order.
 */
function pairUp(expected, given) {
  const labelled = expected.map((e) => given.filter((g) => normalizePart(g.part) === normalizePart(e.part)));
  if (expected.length === 1) {
    return [labelled[0].length ? labelled[0] : given];
  }
  if (labelled.every((l) => l.length) || given.length !== expected.length) return labelled;
  return expected.map((_, k) => [given[k]]);
}

/**
 * Grades solver answers ([{ part, answer, sympy }]) against expected parts
 * ([{ part, value, tol?, alts? }], values as sympy strings). Each part comes back ok: true or
 * false, or null when the answer couldn't be evaluated or has a different shape from the
 * expected one (a judge decides those).
 */
export function gradeAnswers(expected, given) {
  const pairs = pairUp(expected, given);
  const parts = expected.map((e, k) => {
    const answers = pairs[k];
    const shown = answers.map((g) => g.answer).join("; ");
    const sympy = answers.map((g) => g.sympy).join("; ");
    const row = { part: e.part, expected: e.value, shown, sympy };
    if (answers.length === 0) return { ...row, ok: false, how: "missing" };
    const values = answers.map((g) => tryEvaluate(g.sympy));
    const failed = values.find((v) => !v.ok);
    if (failed) return { ...row, ok: null, how: `unparsed: ${failed.error}` };
    const targets = [e.value, ...(e.alts ?? [])].map((v) => evaluate(v));
    const tol = e.tol ?? DEFAULT_TOLERANCE;
    // Several entries for one part are either a tuple given piece by piece, or the same answer
    // twice (exact and decimal), in which case each has to agree with the expected value.
    const actual = values.length === 1 ? values[0].value : new Seq(values.map((v) => v.value));
    if (targets.some((t) => matches(actual, t, tol))) return { ...row, ok: true, how: "sympy" };
    if (values.length > 1 && values.every((v) => targets.some((t) => matches(v.value, t, tol)))) {
      return { ...row, ok: true, how: "sympy" };
    }
    if (!targets.some((t) => sameShape(actual, t))) return { ...row, ok: null, how: "different shape" };
    return { ...row, ok: false, how: "sympy" };
  });
  const correct = parts.some((p) => p.ok === false) ? false : parts.every((p) => p.ok === true) ? true : null;
  return { correct, parts };
}
