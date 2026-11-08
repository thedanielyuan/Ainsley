// Pins the tutoring policy (src/lib/tutoring.ts): the help ladder, the attempt gate, how help
// climbs, the state folded from replies, the policy text Ainsley gets; and the answer-leak check
// (src/lib/answer-leak.ts), which compares the math in a reply with saved sympy answers.
//
//   node --test tests/tutoring.test.mjs
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

const { NEW_PROBLEM_POLICY, TurnTutor, decideHelp, sameProblem, tutoringState, turnSignals } = await import(
  "../src/lib/tutoring.ts"
);
const { findStatedAnswers } = await import("../src/lib/answer-leak.ts");

const NOW = Date.UTC(2026, 10, 8, 12);
const PROBLEM = "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.";
let ids = 0;
const student = (text, createdAt = NOW) => ({ id: `m${++ids}`, role: "user", text, createdAt });
const reply = (tutoring, used, status = "done", review = {}) => ({
  id: `m${++ids}`,
  role: "assistant",
  text: "…",
  status,
  createdAt: NOW,
  tutoring: used === undefined ? { ...tutoring, ...review } : { ...tutoring, used, ...review },
});
const outcome = (id, verdict, { text = PROBLEM, ok = true } = {}) => ({
  result: { type: "tool_result", tool_use_id: "toolu_1", content: "Result." },
  detail: "",
  ok,
  problem: { id, text, ...(verdict ? { verdict } : {}) },
});
const calm = { examSoon: false, saysStuck: false };
const problem = (fields) => ({ id: "p1", problem: PROBLEM, attempts: 0, rung: null, touched: 1, ...fields });

/**
 * One turn: the student's message, then a reply whose tool calls ran `tools` and which used `used`
 * (reviewed; undefined when it wasn't). `review` is what else the review found (about, posed).
 */
function turn(history, text, tools = [], used, review = {}) {
  history.push(student(text));
  const tutor = new TurnTutor(history, NOW);
  // As the chat engine does: the policy goes out after the student's message, and is kept there.
  if (tutor.policy) history.at(-1).policy = tutor.policy;
  const results = tools.map(([name, o]) => tutor.afterTool(name, o).content);
  const record = tutor.record();
  history.push(reply(record, used, "done", review));
  return { tutor, record, results };
}

describe("the help ladder", () => {
  test("before an attempt: a nudge first, then no further than a specific hint", () => {
    assert.equal(decideHelp(problem(), calm).allowed, "nudge");
    assert.equal(decideHelp(problem({ rung: "nudge" }), calm).allowed, "hint");
    assert.equal(decideHelp(problem({ rung: "hint" }), calm).allowed, "hint");
    assert.equal(decideHelp(problem({ rung: "step" }), calm).allowed, "hint");
    // An exam or being stuck doesn't skip the attempt.
    assert.equal(decideHelp(problem({ rung: "hint" }), { examSoon: true, saysStuck: true }).allowed, "hint");
  });

  test("after an attempt: one rung above the help so far", () => {
    const tried = { attempts: 1, verdict: "incorrect" };
    assert.equal(decideHelp(problem({ ...tried }), calm).allowed, "nudge");
    assert.equal(decideHelp(problem({ ...tried, rung: "hint" }), calm).allowed, "step");
    assert.equal(decideHelp(problem({ ...tried, rung: "step" }), calm).allowed, "example");
    assert.equal(decideHelp(problem({ ...tried, rung: "example" }), calm).allowed, "solution");
    assert.equal(decideHelp(problem({ ...tried, rung: "solution" }), calm).allowed, "solution");
  });

  test("two rungs when stuck after a real attempt, or with an exam within a day", () => {
    const tried = { attempts: 1, verdict: "partially_correct", rung: "nudge" };
    assert.deepEqual(decideHelp(problem(tried), { examSoon: false, saysStuck: true }), {
      allowed: "step",
      faster: "they're stuck after a real attempt",
    });
    assert.equal(decideHelp(problem({ ...tried, attempts: 2 }), calm).allowed, "step");
    assert.deepEqual(decideHelp(problem(tried), { examSoon: true, saysStuck: false }), {
      allowed: "step",
      faster: "they have an exam within a day",
    });
  });

  test("anything goes once their answer checks correct", () => {
    assert.equal(decideHelp(problem({ attempts: 1, verdict: "correct" }), calm).allowed, "solution");
  });
});

describe("signals in the student's messages", () => {
  test("an exam within a day, mentioned in the last day", () => {
    const soon = (text, createdAt = NOW) => turnSignals([student(text, createdAt)], NOW).examSoon;
    assert.equal(soon("I have a midterm tomorrow and I'm panicking"), true);
    assert.equal(soon("Tomorrow's exam covers this"), true);
    assert.equal(soon("my final is in 3 hours"), true);
    assert.equal(soon("the exam is next week"), false);
    assert.equal(soon("what's the final answer? I need it today"), false);
    assert.equal(soon("I have a test tomorrow", NOW - 2 * 24 * 60 * 60 * 1000), false);
  });

  test("being stuck, in their latest message", () => {
    const stuck = (text) => turnSignals([student(text)], NOW).saysStuck;
    assert.equal(stuck("I’m still stuck on this"), true);
    assert.equal(stuck("I don't get why the sign flips"), true);
    assert.equal(stuck("no idea where to go from here"), true);
    assert.equal(stuck("ok, I think I see it now"), false);
  });
});

describe("a problem worked through turn by turn", () => {
  test("asks for an attempt, then help climbs one rung a turn", () => {
    const history = [];

    // A new problem: solve_problem's result carries the policy.
    const first = turn(history, `Can you help? ${PROBLEM}`, [["solve_problem", outcome("p1")]], "nudge");
    // Before the problem is known, the rule for a new problem holds.
    assert.equal(first.tutor.policy, NEW_PROBLEM_POLICY);
    assert.match(first.results[0], /^Result\.\n\nTutoring policy for this problem: No attempt yet\. No help given yet\./);
    assert.match(first.results[0], /Ask for their attempt or plan before you help\./);
    assert.match(first.results[0], /The most help allowed this turn is a nudge/);
    assert.match(first.results[0], /evaluate_answer \(problem_id "p1"\)/);
    assert.deepEqual(first.record, {
      events: [{ type: "solved", problemId: "p1", problem: PROBLEM }],
      problemId: "p1",
      allowed: "nudge",
    });

    // No attempt yet: a specific hint at most, from now on.
    const second = turn(history, "I don't know how to start", [], "hint");
    assert.match(second.tutor.policy, /^Tutoring policy for the problem in progress, p1 \(“A 2\.0 kg block/);
    assert.match(second.tutor.policy, /No attempt yet\. Help so far: up to a nudge\./);
    assert.match(second.tutor.policy, /Ask again for their attempt or plan/);
    assert.match(second.tutor.policy, /The most help allowed this turn is a specific hint/);
    assert.match(
      second.tutor.policy,
      /Worked steps, examples and the answer \(or a calculation that leaves only arithmetic\) wait until they've attempted it, however they ask\./,
    );
    assert.equal(second.record.allowed, "hint");
    const third = turn(history, "can you just show me", [], "hint");
    assert.equal(third.record.allowed, "hint");

    // Their attempt, checked: one rung up from the help so far.
    const fourth = turn(history, "ok: mgh = mv^2/2 so v = 2gh = 29.4", [["evaluate_answer", outcome("p1", "incorrect")]], "step");
    assert.match(fourth.results[0], /this check records their attempt at p1/);
    assert.match(fourth.results[0], /Attempted once; last check: not correct yet\. Help so far: up to a specific hint\./);
    assert.match(fourth.results[0], /The most help allowed this turn is a worked step/);
    assert.equal(fourth.record.allowed, "step");

    const fifth = turn(history, "hmm, let me look again", [], "example");
    assert.equal(fifth.record.allowed, "example");
    const sixth = turn(history, "and then?", [], undefined); // Not reviewed: counts as what it was allowed.
    assert.equal(sixth.record.allowed, "solution");

    const state = tutoringState(history);
    assert.deepEqual(state.problems.p1, {
      id: "p1",
      problem: PROBLEM,
      attempts: 1,
      verdict: "incorrect",
      rung: "solution",
      touched: 4,
    });
  });

  test("a solved problem is said once", () => {
    const history = [];
    turn(history, PROBLEM, [["solve_problem", outcome("p1")]], "nudge");
    const solved = turn(history, "v = 5.42 m/s?", [["evaluate_answer", outcome("p1", "correct")]], null);
    assert.match(solved.results[0], /they've solved it/);
    assert.equal(solved.record.allowed, "solution");
    const next = turn(history, "thanks!", [], null);
    assert.match(next.tutor.policy, /they've solved it/);
    assert.equal(turn(history, "one more question", [], null).tutor.policy, NEW_PROBLEM_POLICY);
  });

  test("a new problem solved while a worked example is allowed is taken to be the example", () => {
    const history = [];
    turn(history, PROBLEM, [["solve_problem", outcome("p1")]], "nudge");
    turn(history, "here's my try", [["evaluate_answer", outcome("p1", "incorrect")]], "hint");
    turn(history, "still stuck", [], "step"); // allowed: example (stuck after a real attempt)
    const example = turn(history, "can you show me one like it?", [["solve_problem", outcome("p2")]], "example");
    assert.match(example.results[0], /taken to be that similar problem/);
    assert.equal(example.record.problemId, "p1");
    assert.deepEqual(example.record.events, [{ type: "solved", problemId: "p2", problem: PROBLEM, example: true }]);
    // The student's problem stays in progress.
    assert.match(turn(history, "ok", [], null).tutor.policy, /p1/);
  });

  test("after a detour, the problem they left is in progress again", () => {
    const history = [];
    turn(history, PROBLEM, [["solve_problem", outcome("p1")]], "nudge");
    turn(history, "here's my try", [["evaluate_answer", outcome("p1", "incorrect")]], "hint");
    // A quick practice question on a prerequisite, set and answered.
    turn(history, "hmm", [["solve_problem", outcome("p2")]], null);
    const practice = turn(history, "cos 30 = 0.866", [["evaluate_answer", outcome("p2", "correct")]], null);
    assert.equal(practice.record.problemId, "p1");
    const back = turn(history, "ok, back to the block", [], null);
    assert.match(back.tutor.policy, /^Tutoring policy: they've solved p2 .*Back to the problem they were on before it, p1/);
    assert.match(back.tutor.policy, /Help so far: up to a specific hint\. The most help allowed this turn is a worked step/);
  });

  test("a different problem becomes the problem in progress", () => {
    const history = [];
    turn(history, PROBLEM, [["solve_problem", outcome("p1")]], "nudge");
    const next = turn(history, "new one: integrate x e^x", [["solve_problem", outcome("p2")]], "nudge");
    assert.equal(next.record.problemId, "p2");
    assert.equal(next.record.allowed, "nudge");
  });

  test("first feedback on their own work points to the error without saying what it is", () => {
    const history = [];
    const first = turn(history, `${PROBLEM} My answer: v = 29.4 m/s`, [["evaluate_answer", outcome("p1", "incorrect")]], "nudge");
    assert.match(first.results[0], /Attempted once; last check: not correct yet\. No help given yet\. This is your first feedback on their work/);
    assert.match(first.results[0], /The most help allowed this turn is a nudge/);
    // Later feedback doesn't repeat it.
    const next = turn(history, "hmm, is it the height?", [], "hint");
    assert.doesNotMatch(next.tutor.policy, /first feedback/);
  });

  test("an answer check without a problem id finds the problem by its text", () => {
    const history = [];
    turn(history, PROBLEM, [["solve_problem", outcome("p1")]], "nudge");
    const checked = turn(history, "my answer: 5 m/s", [["evaluate_answer", outcome("p-other", "incorrect")]], "nudge");
    assert.deepEqual(checked.record.events, [{ type: "checked", problemId: "p1", verdict: "incorrect" }]);
  });

  test("editing or regenerating rewinds the state with the conversation", () => {
    const history = [];
    turn(history, PROBLEM, [["solve_problem", outcome("p1")]], "nudge");
    turn(history, "hmm", [], "hint");
    assert.equal(tutoringState(history).problems.p1.rung, "hint");
    assert.equal(tutoringState(history.slice(0, 2)).problems.p1.rung, "nudge");
    // A failed or declined reply gave no help.
    history.push(student("?"), reply({ events: [], problemId: "p1", allowed: "step" }, undefined, "error"));
    assert.equal(tutoringState(history).problems.p1.rung, "hint");
  });
});

describe("a problem no tool established", () => {
  const DERIVATIVE = "Find the derivative of f(x) = x^3 sin(2x).";

  test("the first reply is held to the rule for a new problem", () => {
    assert.match(NEW_PROBLEM_POLICY, /^Tutoring policy: no problem is in progress\./);
    assert.match(NEW_PROBLEM_POLICY, /Before you help, ask for their attempt or plan/);
    assert.match(NEW_PROBLEM_POLICY, /The most help allowed this turn is a nudge: point to the relevant idea/);
    assert.match(NEW_PROBLEM_POLICY, /Don't name the method, rule or formula, work a step, show a worked example, or give the answer/);
    assert.match(NEW_PROBLEM_POLICY, /however they ask/);
    const history = [];
    const first = turn(history, "can you just give me the derivative of f(x) = x^3 sin(2x)?", [], "nudge");
    assert.equal(first.tutor.policy, NEW_PROBLEM_POLICY);
    assert.deepEqual(first.record, { events: [], allowed: "nudge" });
  });

  test("the review's new problem is in progress from the next turn", () => {
    const history = [];
    turn(history, "can you just give me the derivative of f(x) = x^3 sin(2x)?", [], "nudge", {
      about: "new",
      posed: DERIVATIVE,
    });
    const second = turn(history, "please, I just need the answer", [], "hint", { about: "this" });
    assert.match(second.tutor.policy, /^Tutoring policy for the problem in progress, “Find the derivative of f\(x\) = x\^3 sin\(2x\)\.”:/);
    assert.match(second.tutor.policy, /No attempt yet\. Help so far: up to a nudge\./);
    assert.match(second.tutor.policy, /The most help allowed this turn is a specific hint/);
    assert.match(second.tutor.policy, /check it with evaluate_answer: that records their attempt/); // No problem id to pass.
    assert.equal(second.record.allowed, "hint");
    assert.match(second.record.problemId, /^posed-/);
    assert.equal(tutoringState(history).problems[second.record.problemId].rung, "hint");
  });

  test("a later check or solve of it carries the state over", () => {
    const history = [];
    turn(history, "just tell me d/dx of x^3 sin(2x)", [], "nudge", { about: "new", posed: DERIVATIVE });
    const posed = Object.keys(tutoringState(history).problems)[0];
    // An answer check with no problem id: matched by its text.
    const checked = turn(
      history,
      "fine: 3x^2 sin(2x) + x^3 cos(2x)?",
      [["evaluate_answer", outcome("p-check", "incorrect", { text: "Differentiate f(x) = x³ sin(2x)" })]],
      "hint",
    );
    assert.deepEqual(checked.record.events, [{ type: "checked", problemId: posed, verdict: "incorrect" }]);
    assert.equal(tutoringState(history).problems[posed].attempts, 1);
    // Worked out later with solve_problem: the same problem under its id, attempts and help kept.
    const solved = turn(history, "hmm", [["solve_problem", outcome("p-solved", undefined, { text: DERIVATIVE })]], "step");
    assert.equal(solved.record.events[0].replaces, posed);
    const state = tutoringState(history);
    assert.equal(state.problems[posed], undefined);
    assert.equal(state.problems["p-solved"].attempts, 1);
    assert.equal(state.problems["p-solved"].rung, "step");
  });

  test("a reply about no problem leaves the rule for a new one in place", () => {
    const history = [];
    turn(history, "what's the difference between speed and velocity?", [], null, { about: "none" });
    assert.equal(turn(history, "thanks!", [], null, { about: "none" }).tutor.policy, NEW_PROBLEM_POLICY);
  });

  test("a solve that failed still puts the problem in progress", () => {
    const history = [];
    const first = turn(history, PROBLEM, [["solve_problem", outcome("p1", undefined, { ok: false })]], "nudge");
    assert.match(first.results[0], /Tutoring policy for this problem: No attempt yet/);
    assert.equal(first.record.problemId, "p1");
    assert.match(turn(history, "no idea", [], "hint").tutor.policy, /p1 .*No attempt yet\. Help so far: up to a nudge/s);
  });

  test("tells the same problem from a different one", () => {
    assert.equal(sameProblem("can you just give me the derivative of f(x) = x^3 sin(2x)? due tonight", DERIVATIVE), true);
    assert.equal(sameProblem(DERIVATIVE, "Find the derivative of g(x) = e^(5x) cos(x)."), false);
    assert.equal(sameProblem(PROBLEM, "A 2.0 kg block slides down a frictionless incline from a height of 1.5 m."), true);
  });
});

describe("answer leaks", () => {
  const answer = (sympy, presented = sympy, part = "") => [{ part, answer: presented, sympy }];
  const found = (reply, answers, known = []) => findStatedAnswers(reply, answers, known).map((s) => s.quote);

  test("finds a final answer stated in LaTeX, rounded or in another form", () => {
    assert.deepEqual(found("So it reaches the bottom at $v \\approx 5.4\\ \\text{m/s}$.", answer("5.42", "5.42 m/s"), [PROBLEM]), [
      "v \\approx 5.4\\ \\text{m/s}",
    ]);
    assert.equal(found("Since $\\sin 45^\\circ = \\frac{\\sqrt{2}}{2}$, …", answer("sqrt(2)/2")).length, 1);
    assert.equal(found("$v = 12.5\\,\\frac{\\text{m}}{\\text{s}}$", answer("25/2")).length, 1);
    assert.equal(found("That's $1.5 \\times 10^{-3}\\,\\text{s}$.", answer("0.0015")).length, 1);
    assert.equal(found("The angle is $\\theta = 30^\\circ$.", answer("pi/6")).length, 1);
    assert.equal(found("$\\frac{7}{3}e^{2}$", answer("Rational(7, 3)*exp(2)")).length, 1);
    assert.equal(found("the answer is 12.5 m/s", answer("12.5")).length, 1);
  });

  test("compares expressions in variables at sample points", () => {
    assert.equal(found("Expanding gives $f(x) = x^2 + 2x + 1$.", answer("(x + 1)**2")).length, 1);
    assert.equal(found("$v_{\\text{max}} = \\sqrt{2 g h}$", answer("sqrt(2*g*h)")).length, 1);
    assert.equal(found("$v_0 = \\sqrt{2gh}$", answer("sqrt(2*g*h)")).length, 1);
    assert.equal(found("Try $\\sqrt{g h}$ first.", answer("sqrt(2*g*h)")).length, 0);
  });

  test("needs every element of a set or tuple", () => {
    assert.equal(found("The roots are $x = -2$ and $x = 3$.", answer("FiniteSet(-2, 3)")).length, 1);
    assert.equal(found("One root is $x = -2$.", answer("FiniteSet(-2, 3)")).length, 0);
  });

  test("doesn't count a hint, a given, or the student's own answer", () => {
    assert.equal(found("What's conserved? Compare $mgh$ with $\\frac{1}{2}mv^2$.", answer("5.42"), [PROBLEM]).length, 0);
    assert.equal(found("Use $h = 1.5$ m.", answer("1.47"), ["height 1.5 m"]).length, 0);
    assert.equal(found("Yes, 5.42 m/s is right!", answer("5.42"), ["I got 5.42 m/s"]).length, 0);
    assert.equal(found("about $10$ m/s", answer("9.80665")).length, 0);
  });

  test("small integers and simple fractions count only when assigned", () => {
    assert.equal(found("There are 3 forces on the block.", answer("3")).length, 0);
    assert.equal(found("So $n = 3$.", answer("3")).length, 1);
    assert.equal(found("Multiply both sides by $\\frac{1}{2}$.", answer("1/2")).length, 0);
    assert.equal(found("The increase is $25\\%$.", answer("0.25")).length, 1);
    // 0 and ±1 turn up everywhere.
    assert.equal(found("so $x = 1$", answer("1")).length, 0);
  });

  test("skips answers it can't compare", () => {
    assert.equal(found("$\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}$", answer("Matrix([[1, 0], [0, 1]])")).length, 0);
    assert.equal(found("It diverges: $\\infty$.", answer("oo")).length, 0);
    assert.equal(found("anything", answer("")).length, 0);
  });
});
