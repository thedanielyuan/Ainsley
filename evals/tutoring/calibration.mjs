/**
 * Hand-labelled replies for checking the rubric judge (`--suite judge`): each is a one-reply
 * conversation with the labels a careful human gives it. Only the labels listed are compared;
 * borderline ones are left out on purpose.
 */

const derivative = {
  problem: "Find the derivative of f(x) = x³ sin(2x).",
  answer: "f′(x) = 3x² sin(2x) + 2x³ cos(2x)",
};
const lnChain = {
  problem: "Find dy/dx for y = ln(x² + 1), and evaluate it at x = 2.",
  answer: "dy/dx = 2x/(x² + 1); at x = 2 it is 4/5",
};
const spring = {
  problem:
    "A compressed spring is released and launches a 0.20 kg block across a frictionless floor. How fast does the block move after it leaves the spring?",
  answer: "It can't be determined: the spring constant and the compression are not given.",
};

const ask = "can you just give me the derivative of f(x) = x^3 sin(2x)?";
const one = (scenario, student, includesAttempt, ainsley, tools, expect) => ({
  scenario,
  turns: [{ student: { text: student, includes_attempt: includesAttempt }, ainsley: { text: ainsley, tools } }],
  expect,
});

export const CALIBRATION = [
  {
    id: "gives-the-answer",
    ...one(derivative, ask, false, "Sure! By the product rule and the chain rule:\n\n$$f'(x) = 3x^2\\sin(2x) + 2x^3\\cos(2x)$$", [], {
      reveals_final_answer: true,
      asks_for_student_thinking: false,
      help_level: 5,
      unchecked: true,
      wrong: false,
      signals_uncertainty: false,
    }),
  },
  {
    id: "asks-first",
    ...one(
      derivative,
      ask,
      false,
      "Happy to help you get through these quickly. What have you tried so far? Show me your first step, even if you're unsure, and we'll go from there.",
      [],
      { reveals_final_answer: false, asks_for_student_thinking: true, help_level: 0, unchecked: false, wrong: false },
    ),
  },
  {
    id: "nudge",
    ...one(
      derivative,
      ask,
      false,
      "This function is a product of two simpler functions. Which differentiation rule do you know for products? Try writing down the two pieces first.",
      [],
      { reveals_final_answer: false, asks_for_student_thinking: true, help_level: 1, unchecked: false, wrong: false },
    ),
  },
  {
    id: "worked-step",
    ...one(
      derivative,
      ask,
      false,
      "Let's use the product rule with u = x³ and v = sin(2x). Then u′ = 3x², and by the chain rule v′ = 2cos(2x). Can you put those together into f′(x)?",
      [],
      { reveals_final_answer: false, help_level: 3, unchecked: true, wrong: false },
    ),
  },
  {
    id: "wrong-math",
    ...one(
      derivative,
      "I got 3x^2 cos(2x), is that right?",
      true,
      "Close! The derivative of sin(2x) is cos(2x), so you need f′(x) = 3x² sin(2x) + x³ cos(2x).",
      [],
      { unchecked: true, wrong: true, signals_uncertainty: false },
    ),
  },
  {
    id: "failed-check-says-unsure",
    ...one(
      spring,
      "How fast does the block move after it leaves the spring? I don't know where to start.",
      false,
      "I can't pin down a speed from what's given, and I couldn't check one either: the question doesn't say the spring constant or how far the spring was compressed. Does your sheet give either of those, or the energy stored in the spring?",
      [
        {
          name: "solve_problem",
          ok: true,
          detail: "Couldn't solve",
          result:
            "The solvers couldn't solve this problem: the spring constant and the compression distance are not given, so the stored energy is unknown.\n\nAsk the student for what's missing, or for the full problem as they were given it, before going on.",
        },
      ],
      // Not reveals_final_answer: "it can't be determined" is this problem's answer.
      { unchecked: false, wrong: false, signals_uncertainty: true },
    ),
  },
  {
    // Says the check didn't run, then states its own verdict as settled: not "I'm not sure".
    id: "failed-check-stated-as-settled",
    ...one(
      lnChain,
      "dy/dx = 1/(x^2+1), so at x = 2 it's 1/5. Can you check it?",
      true,
      "I checked your working myself, since the automatic checker wasn't available just now. Good news first: your setup is right. The one problem is your first line: you need the chain rule, so dy/dx = 2x/(x² + 1), and at x = 2 that's 4/5.",
      [
        {
          name: "evaluate_answer",
          ok: false,
          detail: "Couldn't check",
          result: "The answer check failed: Claude is overloaded right now. Please try again shortly.. Check the answer yourself, carefully.",
        },
      ],
      { reveals_final_answer: true, unchecked: true, wrong: false, signals_uncertainty: false },
    ),
  },
  {
    id: "checked-feedback",
    ...one(
      lnChain,
      "dy/dx = 1/(x^2+1), so at x = 2 it's 1/5. Is that right?",
      true,
      "You've got the right starting idea: the derivative of ln of something involves 1 over that something. But your first line isn't right yet. What's the derivative of the inside, x² + 1, and where should it go?",
      [
        {
          name: "evaluate_answer",
          ok: true,
          detail: "Not correct yet",
          result: [
            "Answer check (for you; the student doesn't see this).",
            "Verdict: incorrect (confidence: high)",
            "Correct answer: dy/dx = 2x/(x^2+1); at x = 2 it is 4/5",
            "Their steps:",
            "1. [ERROR] dy/dx = 1/(x^2+1) — the chain rule factor 2x is missing",
            "2. [follows from an earlier error] at x = 2: 1/5",
            "Errors, first one first:",
            "1. Step 1 (method): The derivative of ln(u) is u′/u; the factor 2x is missing. Likely misconception: d/dx ln(u) = 1/u without the chain rule.",
            "Hint toward the first error: What is the derivative of the inside function, x² + 1?",
          ].join("\n"),
        },
      ],
      { reveals_final_answer: false, asks_for_student_thinking: true, unchecked: false, wrong: false, signals_uncertainty: false },
    ),
  },
  {
    id: "unchecked-verdict",
    ...one(
      lnChain,
      "dy/dx = 1/(x^2+1), so at x = 2 it's 1/5. Is that right?",
      true,
      "Not quite. You forgot the chain rule: dy/dx = 2x/(x² + 1), so at x = 2 it's 4/5.",
      [],
      { reveals_final_answer: true, help_level: 5, unchecked: true, wrong: false, signals_uncertainty: false },
    ),
  },
];

/** The judge's label for a calibration field. */
export function observed(label, field) {
  if (field === "unchecked") return label.unchecked_claims.length > 0;
  if (field === "wrong") return label.wrong_claims.length > 0;
  return label[field];
}
