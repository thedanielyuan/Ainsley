/**
 * A small, safe math-expression language for simulations: Ainsley writes force magnitudes,
 * vector fields and functions as strings ("m*g*cosd(theta)", "-y", "a*sin(b*x)"), and they are
 * parsed here into closures. Nothing is passed to eval or Function, and only the names a
 * simulation declares (its variables, parameters and constants) can be read.
 *
 * Syntax: numbers (2, 0.5, 1e-3), names, + - * / ^ (or **), parentheses, function calls,
 * comparisons (< <= > >=, giving 1 or 0), and implicit multiplication after a number or a closing
 * parenthesis ("2x", "3(x+1)", "(x+1)(x-1)"). Unary minus binds looser than powers: -x^2 is -(x^2).
 */

export type Scope = Record<string, number>;
export type Evaluator = (scope: Scope) => number;

const deg = Math.PI / 180;

/** Functions an expression may call, with how many arguments each takes. */
const FUNCTIONS: Record<string, { arity: number | "1+"; fn: (...args: number[]) => number }> = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  atan2: { arity: 2, fn: Math.atan2 },
  sinh: { arity: 1, fn: Math.sinh },
  cosh: { arity: 1, fn: Math.cosh },
  tanh: { arity: 1, fn: Math.tanh },
  // Trigonometry in degrees, for angles students meet in degrees (an incline at 30°).
  sind: { arity: 1, fn: (x) => Math.sin(x * deg) },
  cosd: { arity: 1, fn: (x) => Math.cos(x * deg) },
  tand: { arity: 1, fn: (x) => Math.tan(x * deg) },
  asind: { arity: 1, fn: (x) => Math.asin(x) / deg },
  acosd: { arity: 1, fn: (x) => Math.acos(x) / deg },
  atand: { arity: 1, fn: (x) => Math.atan(x) / deg },
  atan2d: { arity: 2, fn: (y, x) => Math.atan2(y, x) / deg },
  rad: { arity: 1, fn: (x) => x * deg },
  deg: { arity: 1, fn: (x) => x / deg },
  exp: { arity: 1, fn: Math.exp },
  ln: { arity: 1, fn: Math.log },
  log: { arity: 1, fn: Math.log },
  log10: { arity: 1, fn: Math.log10 },
  log2: { arity: 1, fn: Math.log2 },
  sqrt: { arity: 1, fn: Math.sqrt },
  cbrt: { arity: 1, fn: Math.cbrt },
  abs: { arity: 1, fn: Math.abs },
  sign: { arity: 1, fn: Math.sign },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  min: { arity: "1+", fn: Math.min },
  max: { arity: "1+", fn: Math.max },
  hypot: { arity: "1+", fn: Math.hypot },
  pow: { arity: 2, fn: Math.pow },
  // if(condition, then, otherwise): a condition is true when it isn't 0.
  if: { arity: 3, fn: (c, a, b) => (c !== 0 && !Number.isNaN(c) ? a : b) },
};

/** Named constants, unless the simulation declares a variable of the same name. */
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, π: Math.PI };

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

type Token =
  | { type: "num"; value: number; at: number }
  | { type: "name"; value: string; at: number }
  | { type: "op"; value: string; at: number };

export class ExpressionError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ type: "num", value: Number(number[0]), at: i });
      i += number[0].length;
      continue;
    }
    const name = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(source.slice(i));
    if (name) {
      tokens.push({ type: "name", value: name[0], at: i });
      i += name[0].length;
      continue;
    }
    const op = /^(?:\*\*|<=|>=|[-+*/^(),<>·×−])/.exec(source.slice(i));
    if (op) {
      // Typographic signs Ainsley might write: · and × multiply, − subtracts.
      const value = op[0] === "**" ? "^" : op[0] === "·" || op[0] === "×" ? "*" : op[0] === "−" ? "-" : op[0];
      tokens.push({ type: "op", value, at: i });
      i += op[0].length;
      continue;
    }
    throw new ExpressionError(`unexpected character "${ch}"`);
  }
  return tokens;
}

type Node =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "neg"; arg: Node }
  | { kind: "bin"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

/** A Pratt parser over the tokens. */
function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (t: Token | undefined, value: string) => t?.type === "op" && t.value === value;
  const expect = (value: string) => {
    const t = tokens[pos];
    if (!isOp(t, value)) throw new ExpressionError(t ? `expected "${value}" near "${describe(t)}"` : `expected "${value}"`);
    pos++;
  };

  const BINARY: Record<string, { power: number; right?: boolean }> = {
    "<": { power: 1 },
    "<=": { power: 1 },
    ">": { power: 1 },
    ">=": { power: 1 },
    "+": { power: 2 },
    "-": { power: 2 },
    "*": { power: 3 },
    "/": { power: 3 },
    "^": { power: 5, right: true },
  };
  // Unary minus sits between products and powers.
  const UNARY_POWER = 4;

  // Whether the next token starts a value that should be multiplied in ("2x", "(a)(b)").
  const startsImplicit = (t: Token | undefined) => t !== undefined && (t.type === "num" || t.type === "name" || isOp(t, "("));

  function primary(): Node {
    const t = tokens[pos];
    if (!t) throw new ExpressionError("the expression ends too early");
    if (t.type === "num") {
      pos++;
      return { kind: "num", value: t.value };
    }
    if (t.type === "name") {
      pos++;
      if (isOp(peek(), "(") && FUNCTIONS[t.value]) {
        pos++;
        const args: Node[] = [];
        if (!isOp(peek(), ")")) {
          for (;;) {
            args.push(expression(0));
            if (isOp(peek(), ",")) {
              pos++;
              continue;
            }
            break;
          }
        }
        expect(")");
        return { kind: "call", name: t.value, args };
      }
      return { kind: "var", name: t.value };
    }
    if (isOp(t, "(")) {
      pos++;
      const inner = expression(0);
      expect(")");
      return inner;
    }
    if (isOp(t, "-") || isOp(t, "+")) {
      pos++;
      const arg = expression(UNARY_POWER);
      return t.value === "-" ? { kind: "neg", arg } : arg;
    }
    throw new ExpressionError(`unexpected "${describe(t)}"`);
  }

  function expression(minPower: number): Node {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t?.type === "op" && BINARY[t.value]) {
        const { power, right } = BINARY[t.value];
        if (power < minPower) break;
        pos++;
        const rhs = expression(right ? power : power + 1);
        left = { kind: "bin", op: t.value, left, right: rhs };
        continue;
      }
      // Implicit multiplication: "2x", "2(x+1)", "a(x+1)", "(x+1)(x-1)", "2 pi". Binds like *.
      const prev = tokens[pos - 1];
      const afterValue = prev && (prev.type === "num" || isOp(prev, ")") || (prev.type === "name" && isOp(t, "(")));
      if (afterValue && startsImplicit(t) && minPower <= 3) {
        const rhs = expression(4);
        left = { kind: "bin", op: "*", left, right: rhs };
        continue;
      }
      break;
    }
    return left;
  }

  const tree = expression(0);
  if (pos < tokens.length) throw new ExpressionError(`unexpected "${describe(tokens[pos])}"`);
  return tree;
}

function describe(t: Token) {
  return String(t.value);
}

/** Checks names and argument counts; returns the names the expression reads. */
function check(node: Node, allowed: ReadonlySet<string>, used: Set<string>) {
  switch (node.kind) {
    case "num":
      return;
    case "var":
      if (!allowed.has(node.name) && !(node.name in CONSTANTS)) {
        if (FUNCTIONS[node.name]) throw new ExpressionError(`${node.name} is a function: write ${node.name}(…)`);
        const names = [...allowed];
        throw new ExpressionError(
          `unknown name "${node.name}"` +
            (names.length ? ` (it can use ${names.map((n) => `"${n}"`).join(", ")}, pi and e)` : " (it can use pi and e)"),
        );
      }
      used.add(node.name);
      return;
    case "neg":
      check(node.arg, allowed, used);
      return;
    case "bin":
      check(node.left, allowed, used);
      check(node.right, allowed, used);
      return;
    case "call": {
      const { arity } = FUNCTIONS[node.name];
      if (arity === "1+" ? node.args.length < 1 : node.args.length !== arity) {
        throw new ExpressionError(
          `${node.name}() takes ${arity === "1+" ? "one or more arguments" : `${arity} argument${arity === 1 ? "" : "s"}`}`,
        );
      }
      for (const arg of node.args) check(arg, allowed, used);
    }
  }
}

function build(node: Node): Evaluator {
  switch (node.kind) {
    case "num": {
      const value = node.value;
      return () => value;
    }
    case "var": {
      const { name } = node;
      const constant = CONSTANTS[name];
      return constant === undefined ? (s) => s[name] : (s) => (name in s ? s[name] : constant);
    }
    case "neg": {
      const arg = build(node.arg);
      return (s) => -arg(s);
    }
    case "bin": {
      const a = build(node.left);
      const b = build(node.right);
      switch (node.op) {
        case "+":
          return (s) => a(s) + b(s);
        case "-":
          return (s) => a(s) - b(s);
        case "*":
          return (s) => a(s) * b(s);
        case "/":
          return (s) => a(s) / b(s);
        case "^":
          return (s) => Math.pow(a(s), b(s));
        case "<":
          return (s) => (a(s) < b(s) ? 1 : 0);
        case "<=":
          return (s) => (a(s) <= b(s) ? 1 : 0);
        case ">":
          return (s) => (a(s) > b(s) ? 1 : 0);
        case ">=":
          return (s) => (a(s) >= b(s) ? 1 : 0);
      }
      throw new ExpressionError(`unknown operator ${node.op}`);
    }
    case "call": {
      const { fn } = FUNCTIONS[node.name];
      const args = node.args.map(build);
      if (node.name === "if") {
        const [c, then, otherwise] = args;
        return (s) => {
          const v = c(s);
          return v !== 0 && !Number.isNaN(v) ? then(s) : otherwise(s);
        };
      }
      if (args.length === 1) {
        const [x] = args;
        return (s) => fn(x(s));
      }
      if (args.length === 2) {
        const [x, y] = args;
        return (s) => fn(x(s), y(s));
      }
      return (s) => fn(...args.map((arg) => arg(s)));
    }
  }
}

export interface Compiled {
  evaluate: Evaluator;
  /** The declared names it reads. */
  uses: Set<string>;
}

/** Longest expression accepted. */
export const MAX_EXPRESSION_LENGTH = 400;

/**
 * Compiles an expression that may read only `allowed` names (plus pi and e). Throws an
 * ExpressionError with a short reason, worded for Ainsley to fix.
 */
export function compile(source: string, allowed: ReadonlySet<string>): Compiled {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new ExpressionError(`it's longer than ${MAX_EXPRESSION_LENGTH} characters`);
  if (!source.trim()) throw new ExpressionError("it's empty");
  const tree = parse(tokenize(source));
  const uses = new Set<string>();
  check(tree, allowed, uses);
  return { evaluate: build(tree), uses };
}

/** Allowed variable and parameter names: a letter, then letters, digits or underscores. */
export function isValidName(name: string) {
  return /^[\p{L}][\p{L}\p{N}_]*$/u.test(name) && !FUNCTIONS[name] && name.length <= 24;
}
