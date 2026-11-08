import { compile, ExpressionError, FUNCTION_NAMES, type Evaluator, type Scope } from "./simulation/expression";

/**
 * Finds the final answers a reply states, by machine comparison with each answer's sympy form
 * (solve_problem saves every final answer as a sympy expression). The tutoring policy uses it to
 * measure answer leaks: replies that give a problem's answer before the student has attempted it.
 *
 * The math in a reply ($…$, $$…$$, \(…\), \[…\]) is split at relations (=, \approx, commas…), and
 * each piece is converted from LaTeX and evaluated; numbers in the prose count too. A piece states
 * an answer when it has the same value (allowing for the rounding its digits show) or, for an answer
 * in variables, the same values at sample points. Values that turn up in passing aren't counted:
 * 0 and ±1 never, small integers and simple fractions only when assigned ("x = 3"), and nothing the
 * student has seen in the problem or written themselves.
 */

export interface AnswerToFind {
  part: string;
  answer: string;
  sympy: string;
}

export interface StatedAnswer {
  part: string;
  /** The answer, as solve_problem presents it. */
  answer: string;
  /** Where the reply states it. */
  quote: string;
}

interface Quantity {
  evaluate: Evaluator;
  /** The variables it reads, sorted (v_0 and v0 are the same variable). */
  names: string[];
  /** How far a rounded decimal may be from the exact value; 0 when exact. */
  tolerance: number;
}

interface Candidate extends Quantity {
  quote: string;
  /** Stated as the value of something ("x = 3", "the answer is 3"), not just mentioned. */
  assigned: boolean;
}

const MAX_TEXT = 60_000;
const MAX_CANDIDATES = 1_000;

/** The answers in `answers` that `reply` states; `known` is text the student has already seen or written. */
export function findStatedAnswers(reply: string, answers: AnswerToFind[], known: string[]): StatedAnswer[] {
  const candidates = extractCandidates(reply);
  if (candidates.length === 0) return [];
  const seen = known.flatMap(extractCandidates);

  // A value the student has seen or written isn't news, whatever it rounds to.
  const fresh = new Map<Candidate, boolean>();
  const isFresh = (c: Candidate) => {
    let ok = fresh.get(c);
    if (ok === undefined) fresh.set(c, (ok = !seen.some((k) => same(k, c, true))));
    return ok;
  };

  const found: StatedAnswer[] = [];
  for (const a of answers) {
    const values = sympyValues(a.sympy);
    // An answer the student has seen or written (a "show that" problem, their own correct answer)
    // can't be told apart from a restatement.
    if (!values || values.some((v) => trivial(v) || seen.some((k) => same(v, k)))) continue;
    const quotes: string[] = [];
    const all = values.every((v) => {
      const simple = isSimple(v);
      const hit = candidates.find((c) => (!simple || c.assigned) && same(v, c) && isFresh(c));
      if (hit && !quotes.includes(hit.quote)) quotes.push(hit.quote);
      return Boolean(hit);
    });
    if (all) found.push({ part: a.part, answer: a.answer, quote: quotes.join(" … ") });
  }
  return found;
}

// ---------- Comparing values ----------

// Sample points for expressions in variables: fixed, so results are reproducible.
const POINTS = [
  [1.37, 2.11, 1.73, 2.53, 1.19, 2.87],
  [2.29, 1.41, 2.67, 1.13, 1.97, 1.61],
  [1.83, 2.41, 1.27, 2.03, 2.71, 1.49],
];

function pointScope(names: string[], point: number): Scope {
  const scope: Scope = {};
  names.forEach((name, k) => {
    scope[name] = POINTS[point][k % 6] + Math.floor(k / 6) * 0.17;
  });
  return scope;
}

/** Whether `c` has the value of `a`; `exact` ignores rounding. */
function same(a: Quantity, c: Quantity, exact = false): boolean {
  if (a.names.length === 0) {
    if (c.names.length) return false;
    const x = a.evaluate({});
    const y = c.evaluate({});
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const rounding = exact ? 0 : Math.max(a.tolerance, c.tolerance);
    return Math.abs(x - y) <= Math.max(rounding, 1e-9 * Math.max(1, Math.abs(x)));
  }
  if (c.names.length === 0 || c.names.some((n) => !a.names.includes(n))) return false;
  for (let p = 0; p < POINTS.length; p++) {
    const scope = pointScope(a.names, p);
    const x = a.evaluate(scope);
    const y = c.evaluate(scope);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x))) return false;
  }
  return true;
}

/** 0, ±1, or a bare variable: these turn up everywhere. */
function trivial(q: Quantity): boolean {
  if (q.names.length === 0) {
    const x = q.evaluate({});
    return !Number.isFinite(x) || (Math.abs(x) <= 1 && Number.isInteger(Math.round(x * 1e9) / 1e9));
  }
  return q.names.some((name) => POINTS.every((_, p) => {
    const scope = pointScope(q.names, p);
    return Math.abs(q.evaluate(scope) - scope[name]) < 1e-9;
  }));
}

/** A small integer or a simple fraction (halves, thirds, quarters): common in passing. */
function isSimple(q: Quantity): boolean {
  if (q.names.length) return false;
  const x = q.evaluate({});
  if (Math.abs(x) > 10) return false;
  return [1, 2, 3, 4].some((d) => Math.abs(x * d - Math.round(x * d)) < 1e-9);
}

const LITERAL = /^\s*[-+]?(\d*)(?:\.(\d+))?(?:[eE]([-+]?\d+))?\s*$/;

/** How far the exact value may be from a decimal literal that was rounded; 0 for anything else. */
function roundingTolerance(source: string, needDigits: boolean): number {
  const m = LITERAL.exec(source);
  if (!m || (!m[1] && !m[2])) return 0;
  const decimals = m[2]?.length ?? 0;
  const exponent = Number(m[3] ?? 0);
  if (needDigits) {
    // A reply's "0.5" or "12" says too little about its precision to count as a rounding.
    const significant = `${m[1]}${m[2] ?? ""}`.replace(/^0+/, "").length;
    if (significant < (decimals ? 2 : 3)) return 0;
  } else if (!decimals && m[3] === undefined) {
    return 0;
  }
  return 0.5 * 10 ** (exponent - decimals);
}

// ---------- Reading values ----------

const FUNCTIONS = new Set(FUNCTION_NAMES);

/** Compiles an expression (the evaluator's syntax); null if it can't be read. */
function quantity(source: string, tolerance: number, eIsConstant: boolean): Quantity | null {
  const names = new Set<string>();
  const normalized = source.replace(/(?<![\p{N}.])[\p{L}_][\p{L}\p{N}_]*/gu, (name: string, offset: number, whole: string) => {
    if (FUNCTIONS.has(name) && /^\s*\(/.test(whole.slice(offset + name.length))) return name;
    if (name === "pi" || name === "π" || (name === "e" && eIsConstant)) return name;
    const clean = name.replace(/_/g, "") || name;
    names.add(clean);
    return clean;
  });
  try {
    const { evaluate } = compile(normalized, names);
    return { evaluate, names: [...names].sort(), tolerance };
  } catch (err) {
    if (err instanceof ExpressionError) return null;
    throw err;
  }
}

// What sympy prints that the evaluator can't compare (complex numbers, infinities, matrices,
// intervals, relations, logic).
const UNSUPPORTED_SYMPY =
  /\b(?:I|oo|zoo|nan|Matrix|ImmutableMatrix|Interval|Union|Intersection|Complement|Piecewise|Integral|Derivative|Sum|Product|Limit|Lambda|True|False|And|Or|Not|Ne|Lt|Le|Gt|Ge|EmptySet|ConditionSet|ImageSet)\b|==|!=|<|>/;

/** The index of the bracket closing the one at `open`, or -1. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if ("([{".includes(s[i])) depth++;
    else if (")]}".includes(s[i]) && --depth === 0) return i;
  }
  return -1;
}

/** Splits at commas outside brackets. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if ("([{".includes(s[i])) depth++;
    else if (")]}".includes(s[i])) depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts;
}

/** The elements of a set, tuple or list; null for a single value. */
function elements(s: string): string[] | null {
  const head = /^(?:FiniteSet|Tuple)\(/.exec(s);
  if (head) return closing(s, head[0].length - 1) === s.length - 1 ? splitTopLevel(s.slice(head[0].length, -1)) : null;
  if (!"([{".includes(s[0]) || closing(s, 0) !== s.length - 1) return null;
  const inner = s.slice(1, -1).trim();
  if (inner.startsWith("[")) return null; // A nested list is a matrix.
  const parts = splitTopLevel(inner);
  return s[0] === "(" && parts.length < 2 ? null : parts;
}

/** An answer's values: one, or each element of a set or tuple. Null when it can't be compared. */
function sympyValues(sympy: string): Quantity[] | null {
  let s = sympy.trim();
  if (!s || s.length > 400 || UNSUPPORTED_SYMPY.test(s)) return null;
  const eq = /^Eq\(([\s\S]*)\)$/.exec(s);
  if (eq) {
    const [lhs, rhs, ...rest] = splitTopLevel(eq[1]);
    if (rest.length || !rhs || !/^[A-Za-z_]\w*$/.test(lhs)) return null;
    s = rhs;
  }
  const parts = (elements(s) ?? [s]).filter(Boolean);
  const values = parts.map(sympyScalar);
  return values.length && values.every(Boolean) ? (values as Quantity[]) : null;
}

function sympyScalar(source: string): Quantity | null {
  const s = source
    .trim()
    .replace(/\bRational\(\s*([-+]?\d+)\s*,\s*([-+]?\d+)\s*\)/g, "(($1)/($2))")
    .replace(/\bInteger\(\s*([-+]?\d+)\s*\)/g, "($1)")
    .replace(/\bFloat\(\s*['"]?([-+]?[\d.]+(?:[eE][-+]?\d+)?)['"]?\s*(?:,\s*\d+\s*)?\)/g, "($1)")
    .replace(/\bS\(/g, "(")
    .replace(/\bE\b/g, `(${Math.E})`)
    .replace(/\bAbs\(/g, "abs(")
    .replace(/\bceiling\(/g, "ceil(")
    .replace(/\bMin\(/g, "min(")
    .replace(/\bMax\(/g, "max(");
  return quantity(s, roundingTolerance(source, false), false);
}

// ---------- Finding values in text ----------

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$])\$(?!\s)([^$\n]+?)(?<![\\\s])\$(?!\d)/g;
// Prose that introduces a value: "v = 5.4", "the answer is 3", "it comes to 12".
const CUE =
  /(?:[=≈:]|\b(?:is|equals?|gets?|got|gives?|be|becomes?|(?:comes?|simplifies|reduces|works out|evaluates|rounds) to)\b)\s*$/i;
const PLAIN_NUMBER =
  /(?<![\p{L}\p{N}_.^\\])([-−]?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?(?:\s*[×x*]\s*10\s*\^\s*\(?\s*([-−]?\d+)\s*\)?)?(?![\p{L}\p{N}_]|\.\d)/gu;

function extractCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  const clean = text
    .slice(0, MAX_TEXT)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  let last = 0;
  for (const m of clean.matchAll(MATH)) {
    const at = m.index ?? 0;
    const before = clean.slice(last, at);
    plainCandidates(before, out);
    mathCandidates(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "", CUE.test(before.slice(-30)), out);
    last = at + m[0].length;
    if (out.length > MAX_CANDIDATES) return out;
  }
  plainCandidates(clean.slice(last), out);
  return out;
}

function quoteOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 100 ? `${flat.slice(0, 99)}…` : flat;
}

function plainCandidates(text: string, out: Candidate[]) {
  for (const m of text.matchAll(PLAIN_NUMBER)) {
    const [whole, num, den, exponent] = m;
    let source = num.replace("−", "-");
    if (exponent) source = `${source}e${exponent.replace("−", "-")}`;
    if (den) source = `(${source})/(${den})`;
    const q = quantity(source, den ? 0 : roundingTolerance(source, true), true);
    if (!q) continue;
    const at = m.index ?? 0;
    out.push({
      ...q,
      assigned: CUE.test(text.slice(Math.max(0, at - 30), at)),
      quote: quoteOf(text.slice(Math.max(0, at - 40), at + whole.length + 20)),
    });
  }
}

// Separators between the pieces of a formula. Assignments make the piece after them "assigned".
const ASSIGNMENTS = new Set(["=", "\\approx", "≈", "\\simeq", "\\sim", "\\equiv", "≡"]);
const SEPARATOR_COMMANDS = new Set([
  "approx", "simeq", "sim", "equiv", "cong", "neq", "ne", "leq", "le", "geq", "ge", "lt", "gt", "to",
  "rightarrow", "Rightarrow", "longrightarrow", "Longrightarrow", "implies", "iff", "quad", "qquad",
  "therefore", "because",
]);
const CONNECTOR_WORDS = /^\s*(?:and|or|so|if|then|for|where|when|with|since|hence|thus|giving|gives|i\.e\.,?)\s*$/i;

/** Splits a formula at top-level relations, commas and connecting words. */
function splitMath(latex: string): { text: string; separator: string }[] {
  const pieces: { text: string; separator: string }[] = [];
  let depth = 0;
  let start = 0;
  let separator = "";
  const cut = (at: number, next: string, resume: number) => {
    pieces.push({ text: latex.slice(start, at), separator });
    separator = next;
    start = resume;
  };
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (depth !== 0) continue;
    if (ch === "\\") {
      const command = /^\\([A-Za-z]+|\\)/.exec(latex.slice(i));
      if (!command) {
        i++; // An escaped character or a space (\, \; \{): never a separator.
        continue;
      }
      const name = command[1];
      if (name === "\\") {
        cut(i, "\\\\", i + 2);
        i++;
      } else if (name === "text" || name === "mathrm" || name === "textrm") {
        // A connecting word splits ("x = 1 \text{ and } y = 2"); units stay with their value.
        const open = i + command[0].length;
        const end = latex[open] === "{" ? closing(latex, open) : -1;
        if (end > 0 && CONNECTOR_WORDS.test(latex.slice(open + 1, end))) {
          cut(i, "text", end + 1);
          i = end;
        } else {
          i += command[0].length - 1;
        }
      } else if (SEPARATOR_COMMANDS.has(name)) {
        cut(i, `\\${name}`, i + command[0].length);
        i += command[0].length - 1;
      } else {
        i += command[0].length - 1;
      }
    } else if ("=<>&;,≈≠≤≥→⇒≡".includes(ch)) {
      // "{,}" is a thousands separator, handled before this.
      cut(i, ch, i + 1);
    }
  }
  pieces.push({ text: latex.slice(start), separator });
  return pieces.filter((p) => p.text.trim());
}

/** Letters outside command names, counting Greek letters: whether a piece names something. */
function hasVariable(piece: string): boolean {
  return /[A-Za-z]/.test(piece.replace(/\\([A-Za-z]+)/g, (whole, name: string) => (GREEK.has(name) ? "x" : " ")));
}

function mathCandidates(latex: string, cue: boolean, out: Candidate[]) {
  const quote = quoteOf(latex);
  const prepared = latex
    .replace(/\{,\}/g, "")
    .replace(/\\(?:boxed|displaystyle|textstyle|left|right|bigl|bigr|Bigl|Bigr|big|Big)(?![A-Za-z])/g, " ")
    .replace(/\\[dt]frac(?![A-Za-z])/g, "\\frac")
    // Scientific notation stays one literal, so its rounding is known.
    .replace(/(\d+(?:\.\d+)?)\s*(?:\\times|\\cdot|×|·)\s*10\s*\^\s*\{?\s*([-+−]?\d+)\s*\}?/g, (_, m: string, e: string) => `${m}e${e.replace("−", "-")}`);
  const pieces = splitMath(prepared);
  pieces.forEach((piece, k) => {
    const assigned = k === 0 ? cue : ASSIGNMENTS.has(piece.separator) && hasVariable(pieces[k - 1].text);
    for (const variant of variants(piece.text)) {
      const source = latexToExpression(variant.text, variant.degrees);
      if (!source) continue;
      const q = quantity(source, roundingTolerance(source, true), true);
      if (q) out.push({ ...q, assigned, quote });
    }
  });
}

/** ± gives two values; degrees and percentages are read both as written and converted. */
function variants(piece: string): { text: string; degrees: "radians" | "raw" }[] {
  let texts = [piece];
  if (/\\(?:pm|mp)(?![A-Za-z])|±|∓/.test(piece)) {
    texts = [piece.replace(/\\pm(?![A-Za-z])|±/g, "+").replace(/\\mp(?![A-Za-z])|∓/g, "-"), piece.replace(/\\pm(?![A-Za-z])|±/g, "-").replace(/\\mp(?![A-Za-z])|∓/g, "+")];
  }
  if (/\\%|%/.test(piece)) texts = texts.flatMap((t) => [t.replace(/\\?%/g, ""), t.replace(/\\?%/g, "\\cdot 0.01")]);
  const degrees = /\\circ(?![A-Za-z])|°|\\degree(?![A-Za-z])/.test(piece);
  return texts.flatMap((text) =>
    degrees ? [{ text, degrees: "raw" as const }, { text, degrees: "radians" as const }] : [{ text, degrees: "raw" as const }],
  );
}

// ---------- LaTeX to the evaluator's syntax ----------

const GREEK = new Set(
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Sigma Upsilon Phi Psi Omega".split(" "),
);
const UNICODE_GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", θ: "theta", λ: "lambda", μ: "mu", ρ: "rho",
  σ: "sigma", τ: "tau", φ: "phi", ω: "omega", Δ: "Delta", Ω: "Omega",
};
const LATEX_FUNCTIONS: Record<string, string> = {
  sin: "sin", cos: "cos", tan: "tan", arcsin: "asin", arccos: "acos", arctan: "atan",
  sinh: "sinh", cosh: "cosh", tanh: "tanh", ln: "ln", log: "ln", exp: "exp",
};
const RECIPROCALS: Record<string, string> = { sec: "cos", csc: "sin", cot: "tan" };
// Formatting around a symbol: keep what's inside.
const WRAPPERS = new Set(["mathbf", "boldsymbol", "vec", "hat", "bar", "tilde", "overline", "mathit", "mathcal", "bm"]);
// Words and units: they don't change a value.
const TEXT_COMMANDS = new Set(["text", "textrm", "textbf", "textit", "mathrm", "operatorname", "unit", "si", "mbox"]);
const SPACES = new Set([",", ";", ":", "!", " ", "quad", "qquad", "displaystyle", "left", "right", "big", "Big", "bigl", "bigr", "Bigl", "Bigr"]);

class Unreadable extends Error {}

function fail(): never {
  throw new Unreadable();
}

/**
 * Converts one piece of LaTeX (no relations) to the evaluator's syntax, with every multiplication
 * written out; null when it holds something that can't be evaluated.
 */
function latexToExpression(latex: string, degrees: "radians" | "raw"): string | null {
  const s = latex;
  let i = 0;

  const skipSpace = () => {
    for (;;) {
      if (i < s.length && /\s|~/.test(s[i])) {
        i++;
        continue;
      }
      const command = /^\\([A-Za-z]+|[,;:! ])/.exec(s.slice(i));
      if (command && SPACES.has(command[1])) {
        i += command[0].length;
        continue;
      }
      return;
    }
  };

  /** A braced group, or the single token that stands for one ("\frac12", "x^2"). */
  const group = (): string => {
    skipSpace();
    if (s[i] === "{") {
      i++;
      return sequence("}");
    }
    const one = /^(?:\d|[A-Za-z]|\\[A-Za-z]+)/.exec(s.slice(i));
    if (!one) fail();
    const piece = one[0];
    i += piece.length;
    return latexToExpression(piece, degrees) ?? fail();
  };

  /** The raw text of a braced group (for subscripts and text). */
  const rawGroup = (): string => {
    skipSpace();
    if (s[i] !== "{") {
      const ch = s[i] ?? "";
      i++;
      return ch;
    }
    const end = closing(s, i);
    if (end < 0) fail();
    const text = s.slice(i + 1, end);
    i = end + 1;
    return text;
  };

  /** A function's argument: in brackets, or the next factor ("\sin 2\theta", "\ln x"). */
  const argument = (): string => {
    skipSpace();
    if (s[i] === "(" || s[i] === "[") {
      const close = s[i] === "(" ? ")" : "]";
      i++;
      return sequence(close);
    }
    if (s[i] === "{") {
      i++;
      return sequence("}");
    }
    const first = factor();
    if (first === null) fail();
    skipSpace();
    // A coefficient takes the variable after it: \sin 2\theta.
    if (/^\d/.test(first) && /^(?:[A-Za-z]|\\[A-Za-z]+)/.test(s.slice(i))) {
      const next = factor();
      if (next) return `${first}*${next}`;
    }
    return first;
  };

  /** One value with its powers, or "" for something that doesn't change the value; null if none starts here. */
  const factor = (): string | null => {
    skipSpace();
    if (i >= s.length) return null;
    let base: string | null = null;
    const ch = s[i];
    const rest = s.slice(i);
    const number = /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/.exec(rest);
    if (number) {
      base = number[0];
      i += number[0].length;
    } else if (/[A-Za-z]/.test(ch)) {
      i++;
      let name = ch;
      skipSpace();
      if (s[i] === "_") {
        i++;
        name += rawGroup()
          .replace(/\\(?:text|textrm|mathrm|mathit|mathbf|operatorname)(?![A-Za-z])/g, "")
          .replace(/\\([A-Za-z]+)/g, "$1")
          .replace(/[^A-Za-z0-9]/g, "");
      }
      base = name;
    } else if (UNICODE_GREEK[ch]) {
      i++;
      base = UNICODE_GREEK[ch];
    } else if (ch === "π") {
      i++;
      base = "pi";
    } else if (ch === "{") {
      i++;
      const inner = sequence("}");
      base = inner ? `(${inner})` : "";
    } else if (ch === "(" || ch === "[") {
      i++;
      base = `(${sequence(ch === "(" ? ")" : "]")})`;
    } else if (ch === "\\") {
      const command = /^\\([A-Za-z]+)/.exec(rest);
      if (!command) return null;
      const name = command[1];
      i += command[0].length;
      if (name === "frac") {
        const top = group();
        const bottom = group();
        if (!top && !bottom) base = ""; // A unit like \frac{\text{m}}{\text{s}}.
        else if (!top || !bottom) fail();
        else base = `((${top})/(${bottom}))`;
      } else if (name === "sqrt") {
        skipSpace();
        let index = "";
        if (s[i] === "[") {
          i++;
          index = sequence("]");
        }
        const radicand = group();
        base = index ? `((${radicand})^(1/(${index})))` : `sqrt(${radicand})`;
      } else if (name === "pi") {
        base = "pi";
      } else if (GREEK.has(name)) {
        base = name.replace(/^var/, "");
      } else if (WRAPPERS.has(name)) {
        const inner = group();
        base = inner ? `(${inner})` : "";
      } else if (TEXT_COMMANDS.has(name)) {
        const text = rawGroup().trim();
        base = name === "mathrm" && text === "e" ? "e" : "";
      } else if (LATEX_FUNCTIONS[name] || RECIPROCALS[name]) {
        skipSpace();
        let power = "";
        if (s[i] === "^") {
          i++;
          power = group();
        }
        let base10 = "";
        if (name === "log" && s[i] === "_") {
          i++;
          base10 = rawGroup();
        }
        const arg = argument();
        const call = RECIPROCALS[name]
          ? `(1/${RECIPROCALS[name]}(${arg}))`
          : base10
            ? `(ln(${arg})/ln(${latexToExpression(base10, degrees) ?? fail()}))`
            : `${LATEX_FUNCTIONS[name]}(${arg})`;
        base = power ? `(${call})^(${power})` : call;
      } else {
        fail(); // \infty, \sum, \int, \partial, …
      }
    } else {
      return null;
    }

    // Powers, and the degree sign.
    for (;;) {
      skipSpace();
      if (s[i] === "^") {
        i++;
        skipSpace();
        const circle = /^(?:\\circ|\{\s*\\circ\s*\}|\\degree)/.exec(s.slice(i));
        if (circle) {
          i += circle[0].length;
          if (base && degrees === "radians") base = `(${base}*pi/180)`;
          continue;
        }
        const exponent = group();
        if (!base) fail();
        base = `(${base})^(${exponent})`;
      } else if (s[i] === "°") {
        i++;
        if (base && degrees === "radians") base = `(${base}*pi/180)`;
      } else if (s[i] === "!" || s[i] === "'" || s[i] === "_") {
        fail(); // Factorials, primes, subscripts on brackets.
      } else {
        return base;
      }
    }
  };

  /** Values and operators until `stop` (or the end), with multiplication written out. */
  function sequence(stop: string | null): string {
    let out = "";
    // Whether `out` ends with a value, so a value after it multiplies.
    let value = false;
    for (;;) {
      skipSpace();
      if (i >= s.length) {
        if (stop) fail();
        return out;
      }
      const ch = s[i];
      if (stop && ch === stop) {
        i++;
        return out;
      }
      const operator = /^(?:[-+*/−·×]|\\cdot(?![A-Za-z])|\\times(?![A-Za-z])|\\ast(?![A-Za-z])|\\div(?![A-Za-z]))/.exec(s.slice(i));
      if (operator) {
        i += operator[0].length;
        const op = operator[0];
        out += op === "−" ? "-" : op === "\\div" ? "/" : op === "+" || op === "-" || op === "/" ? op : "*";
        value = false;
        continue;
      }
      const next = factor();
      if (next === null) fail();
      if (!next) continue;
      out += (value ? "*" : "") + next;
      value = true;
    }
  }

  try {
    const result = sequence(null).trim();
    return result || null;
  } catch (err) {
    if (err instanceof Unreadable) return null;
    throw err;
  }
}
