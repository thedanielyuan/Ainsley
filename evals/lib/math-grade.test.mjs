// Offline checks of the math grader and the problem set's answer key: no server, no API calls.
// Run with `node --test evals/`.
import assert from "node:assert/strict";
import test from "node:test";
import { PROBLEMS } from "../math/problems.mjs";
import { evaluate, gradeAnswers, matches, Seq } from "./math-grade.mjs";

const asGiven = (finals) => Object.entries(finals).map(([part, sympy]) => ({ part, answer: sympy, sympy }));

test("evaluates sympy-style expressions", () => {
  assert.equal(evaluate("9/2"), 4.5);
  assert.equal(evaluate("-2**2"), -4);
  assert.equal(evaluate("2**-1"), 0.5);
  assert.ok(Math.abs(evaluate("E - 2") - 0.718281828) < 1e-9);
  assert.ok(Math.abs(evaluate("3*sqrt(2)/2") - 2.121320344) < 1e-9);
  assert.ok(Math.abs(evaluate("Rational(15, 128)") - 0.1171875) < 1e-12);
  assert.ok(Math.abs(evaluate("1.8e-5*log(10)") - 4.1447e-5) < 1e-8);
  assert.deepEqual(evaluate("Matrix([[3, -1], [-5, 2]])"), new Seq([new Seq([3, -1]), new Seq([-5, 2])]));
  assert.deepEqual(evaluate("FiniteSet(5, 2)"), new Seq([5, 2], true));
  assert.deepEqual(evaluate("Interval(1, 2)"), new Seq([1, 2]));
  assert.equal(evaluate("Eq(x_value_unused, 3)".replace("x_value_unused", "pi")), 3);
  assert.throws(() => evaluate("40*centimeter**2/second"));
  assert.throws(() => evaluate("x**2 +"));
});

test("compares within tolerance, sets in any order, column vectors as tuples", () => {
  assert.ok(matches(0.318, evaluate("1/pi")));
  assert.ok(!matches(0.955, evaluate("1/pi")));
  assert.ok(matches(evaluate("[5, 2]"), evaluate("FiniteSet(2, 5)")));
  assert.ok(!matches(evaluate("[5, 3]"), evaluate("FiniteSet(2, 5)")));
  assert.ok(matches(evaluate("Matrix([[1], [2], [3]])"), evaluate("Tuple(1, 2, 3)")));
  assert.ok(!matches(evaluate("Tuple(3, 2, 1)"), evaluate("Tuple(1, 2, 3)")));
});

test("every expected answer grades as correct against itself", () => {
  for (const p of PROBLEMS) {
    const given = p.answers.map((a) => ({ part: a.part, answer: a.value, sympy: a.value }));
    assert.equal(gradeAnswers(p.answers, given).correct, true, p.id);
  }
});

test("every planted error's final answer grades as wrong", () => {
  for (const p of PROBLEMS) {
    assert.equal(gradeAnswers(p.answers, asGiven(p.planted.final)).correct, false, p.id);
  }
});

test("accepts the forms solvers give the same answer in", () => {
  const byId = Object.fromEntries(PROBLEMS.map((p) => [p.id, p]));
  const grade = (id, given) => gradeAnswers(byId[id].answers, given).correct;
  // Labels written differently, rounded decimals.
  assert.equal(
    grade("calc-balloon", [
      { part: "(a)", answer: "", sympy: "0.3183" },
      { part: "Part (b)", answer: "", sympy: "40" },
    ]),
    true,
  );
  // A tuple given piece by piece.
  assert.equal(
    grade("linalg-system", [
      { part: "x", answer: "", sympy: "1" },
      { part: "y", answer: "", sympy: "2" },
      { part: "z", answer: "", sympy: "3" },
    ]),
    true,
  );
  // The same answer twice, exact and decimal.
  assert.equal(
    grade("calc-limit", [
      { part: "", answer: "", sympy: "9/2" },
      { part: "", answer: "", sympy: "4.5" },
    ]),
    true,
  );
  // Another unit, and a percentage.
  assert.equal(grade("phys-braking", [{ part: "a", answer: "", sympy: "240000" }, { part: "b", answer: "", sympy: "6000" }]), true);
  assert.equal(grade("stats-bayes", [{ part: "", answer: "", sympy: "16.1" }]), true);
  // Unreadable, or a different shape: left to the judge rather than marked wrong.
  assert.equal(grade("calc-limit", [{ part: "", answer: "", sympy: "" }]), null);
  assert.equal(grade("linalg-system", [{ part: "", answer: "", sympy: "Tuple(1, 2)" }]), null);
  // Missing a part is wrong.
  assert.equal(grade("phys-circuit", [{ part: "a", answer: "", sympy: "2" }]), false);
});
