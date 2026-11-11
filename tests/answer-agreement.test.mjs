// Pins when two solvers' answers count as the same (src/lib/answer-agreement.ts). Agreement lets
// a solution stand as verified without the verifier, so the second half matters most: everything
// that isn't certainly the same value has to come back false.
//
//   node --test tests/answer-agreement.test.mjs
//
// Needs no server: it imports the TypeScript modules directly (Node 22.18+ strips their types).
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, test } from "node:test";

// The app's modules import each other without file extensions, as the bundler allows; resolve
// those to .ts here.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith(".") && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
          try { return await next(specifier + ".ts", context); } catch {}
        }
        return next(specifier, context);
      }`),
);

const { sameAnswers, sameSympyValue } = await import("../src/lib/answer-agreement.ts");

const same = (a, b) => {
  // Agreement can't depend on which solver came first.
  assert.equal(sameSympyValue(a, b), sameSympyValue(b, a), `${a} / ${b} isn't symmetric`);
  return sameSympyValue(a, b);
};
const answers = (...list) => list.map(([part, sympy]) => ({ part, answer: sympy, sympy }));

describe("the same value, written differently", () => {
  test("numbers", () => {
    assert.equal(same("24/5", "4.8"), true);
    assert.equal(same("-1", "-1.0"), true);
    assert.equal(same("Rational(1, 3)", "1/3"), true);
    assert.equal(same("3*sqrt(2)/2", "3/sqrt(2)"), true);
    assert.equal(same("exp(1)", "E"), true);
    assert.equal(same("pi/6", "S(1)/6*pi"), true);
    assert.equal(same("1.6e-19", "16e-20"), true);
    assert.equal(same("0", "0.0"), true);
  });

  test("expressions in variables", () => {
    assert.equal(same("(x + 1)**2", "x**2 + 2*x + 1"), true);
    assert.equal(same("4*x/5 + 9/5", "0.8*x + 1.8"), true);
    assert.equal(same("3*x**2*sin(2*x) + 2*x**3*cos(2*x)", "x**2*(3*sin(2*x) + 2*x*cos(2*x))"), true);
    assert.equal(same("sqrt(2*g*h)", "(2*g*h)**(1/2)"), true);
    assert.equal(same("v_0*t - g*t**2/2", "t*(v0 - g*t/2)"), true);
    assert.equal(same("log(x)/2", "log(sqrt(x))"), true); // Both undefined for negative x: those points say nothing.
    assert.equal(same("asin(x)", "pi/2 - acos(x)"), true);
  });

  test("sets in any order, lists and equations in the same one", () => {
    assert.equal(same("FiniteSet(-1, 2)", "{2, -1}"), true);
    assert.equal(same("(1, 2.5)", "(1.0, 5/2)"), true);
    assert.equal(same("[x, 2*x]", "[x, x + x]"), true);
    assert.equal(same("Eq(y, 4*x/5 + 9/5)", "Eq(y, (4*x + 9)/5)"), true);
  });
});

describe("anything less than certain is a difference", () => {
  test("values that differ, however slightly", () => {
    assert.equal(same("2*sqrt(3)", "3.46"), false); // One was rounded.
    assert.equal(same("9.81", "9.8"), false);
    assert.equal(same("1.6e-19", "1.7e-19"), false); // Tiny values get no absolute allowance.
    assert.equal(same("0", "1e-12"), false);
    assert.equal(same("x**2", "x**3"), false);
    assert.equal(same("x + y", "x - y"), false);
    assert.equal(same("x", "t"), false);
  });

  test("forms that agree only on part of the domain", () => {
    assert.equal(same("sqrt(x**2)", "x"), false);
    assert.equal(same("Abs(x)", "x"), false);
    assert.equal(same("log(x**2)", "2*log(x)"), false);
  });

  test("a different shape, order or variable", () => {
    assert.equal(same("(1, 2)", "(2, 1)"), false);
    assert.equal(same("[1, 2]", "FiniteSet(1, 2)"), false);
    assert.equal(same("FiniteSet(1, 2)", "FiniteSet(1, 2, 3)"), false);
    assert.equal(same("FiniteSet(1, 1, 2)", "FiniteSet(1, 2, 2)"), false);
    assert.equal(same("[5]", "5"), false);
    assert.equal(same("Eq(x, 3)", "Eq(y, 3)"), false);
    assert.equal(same("Eq(x, 3)", "3"), false);
  });

  test("forms it can't evaluate", () => {
    assert.equal(same("Matrix([[1, 0], [0, 1]])", "Matrix([[1.0, 0], [0, 1]])"), false);
    assert.equal(same("2 + 3*I", "3*I + 2"), false);
    assert.equal(same("oo", "oo"), false);
    assert.equal(same("Interval(0, 1)", "Interval(0, 1.0)"), false);
    assert.equal(same("factorial(5)", "120"), false);
    assert.equal(same("", ""), false);
    assert.equal(same("1/0", "1/0"), false);
  });

  test("a function it doesn't know is never read as a multiplication", () => {
    assert.equal(same("erf(2*x)", "2*erf(x)"), false);
    assert.equal(same("gamma(x)*2", "gamma(2*x)"), false);
    assert.equal(same("f(x)", "f*x"), false);
    assert.equal(same("sec(x)", "sec*x"), false);
  });
});

describe("a solve's answers", () => {
  test("agree part by part, by text or by value", () => {
    assert.equal(sameAnswers(answers(["(a)", "24/5"], ["(b)", "x**2"]), answers(["(A)", "4.8"], ["(b)", "x*x"])), true);
    // Identical text still counts for a form that can't be evaluated, as it always has.
    assert.equal(sameAnswers(answers(["", "Matrix([[1, 2], [3, 4]])"]), answers(["", "Matrix([[1,2],[3,4]])"])), true);
  });

  test("differ on any part, label, count or missing form", () => {
    assert.equal(sameAnswers(answers(["(a)", "24/5"], ["(b)", "3"]), answers(["(a)", "4.8"], ["(b)", "3.1"])), false);
    assert.equal(sameAnswers(answers(["(a)", "2"], ["(b)", "3"]), answers(["(b)", "2"], ["(a)", "3"])), false);
    assert.equal(sameAnswers(answers(["", "2"]), answers(["", "2"], ["", "3"])), false);
    assert.equal(sameAnswers(answers(["", ""]), answers(["", ""])), false);
    assert.equal(sameAnswers([], []), false);
  });
});
