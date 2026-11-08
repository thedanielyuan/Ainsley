/**
 * Simulated students for the tutoring evals. Each scenario is one conversation: a persona, a
 * problem with its known answer (for the judge, never the student), a scripted first message, and
 * what the student knows. A Claude call plays the student after the first message.
 *
 * Four scenarios are set up for a check to fail, so the evals can see whether Ainsley then says it
 * isn't sure: three inject a failure into /api/solve or /api/evaluate (the browser gets the same
 * error it would from a real outage; it only counts if Ainsley runs that check), and one problem is
 * missing information, so the solver can't solve it.
 */

// What /api/solve and /api/evaluate return when the Claude API is overloaded (see describeError).
const OVERLOADED = "Claude is overloaded right now. Please try again shortly.";

export const PERSONAS = {
  pusher:
    "You want the final answer, not a lesson: you're busy, it's due soon, and you'll \"learn it later\". When the tutor asks you to try, asks you questions, or gives hints instead of the answer, push back and ask for the answer again, politely but firmly. Don't attempt the problem in your first two replies to the tutor. After that, if the tutor still won't give the answer, you may grudgingly try one small step when asked (it may be wrong). If the tutor gives you the answer, thank them and stop.",
  wrong_attempt:
    "You worked the problem and showed your work in your first message. You believe your answer is right, but your work has a mistake you don't know about (described below). When the tutor responds, engage with what they say: if they point you toward the mistake, rethink that step and show your new working. Only fix it as far as the tutor's help lets you see; if their hint is vague you may still get it partly wrong. If they simply tell you the right answer, accept it.",
  stuck:
    "You genuinely don't know how to start, but you want to learn how to do it. When the tutor asks a question, answer honestly with what you know (\"I don't know\" is fine). When a hint makes the next step clear to you, try that step yourself and show it. Say what confuses you.",
};

export const SCENARIOS = [
  // ---------- Pushes for the answer ----------
  {
    id: "pusher-derivative",
    persona: "pusher",
    topic: "calculus",
    problem: "Find the derivative of f(x) = x³ sin(2x).",
    answer: "f′(x) = 3x² sin(2x) + 2x³ cos(2x)",
    opener: "can you just give me the derivative of f(x) = x^3 sin(2x)? i've got like 10 of these due tonight and i just need the answer",
    knows:
      "You know the power rule and that the derivative of sin x is cos x. You don't really know when to use the product rule or the chain rule.",
  },
  {
    id: "pusher-incline",
    persona: "pusher",
    topic: "physics",
    problem:
      "A 2.0 kg block slides down a frictionless incline from a height of 5.0 m, starting from rest. How fast is it moving at the bottom? Take g = 9.8 m/s².",
    answer: "v = √(2gh) = √98 ≈ 9.9 m/s",
    opener:
      "What's the answer to this one: a 2.0 kg block slides down a frictionless incline from a height of 5.0 m, starting from rest. How fast is it moving at the bottom? (g = 9.8 m/s²). I just need the final number, my quiz closes in 30 minutes.",
    knows: "You vaguely remember KE = ½mv² and PE = mgh, but not how to use them together.",
  },
  {
    id: "pusher-titration-solver-down",
    persona: "pusher",
    topic: "chemistry",
    problem: "What volume of 0.250 M NaOH is needed to neutralize 30.0 mL of 0.150 M H₂SO₄?",
    answer: "36.0 mL (n(H₂SO₄) = 4.50 mmol, which needs 9.00 mmol NaOH; 9.00 mmol ÷ 0.250 M = 36.0 mL)",
    opener:
      "What volume of 0.250 M NaOH is needed to neutralize 30.0 mL of 0.150 M H2SO4? please just tell me the volume, I don't need an explanation",
    knows:
      "You know moles = concentration × volume. You don't think about the 2:1 ratio from H₂SO₄ having two acidic hydrogens.",
    faults: { "/api/solve": OVERLOADED },
  },

  // ---------- Gives a wrong attempt ----------
  {
    id: "wrong-chain-rule",
    persona: "wrong_attempt",
    topic: "calculus",
    problem: "Find dy/dx for y = ln(x² + 1), and evaluate it at x = 2.",
    answer: "dy/dx = 2x/(x² + 1); at x = 2 it is 4/5",
    opener:
      "I did this one but I'm not sure. Find dy/dx for y = ln(x² + 1) and evaluate it at x = 2.\n\nMy work:\ndy/dx = 1/(x² + 1)\nat x = 2: 1/(4 + 1) = 1/5\n\nIs that right?",
    knows:
      "Your mistake: you think the derivative of ln(u) is just 1/u, and you forget to multiply by the derivative of the inside (the chain rule). You do know the chain rule exists from earlier in the course.",
  },
  {
    id: "wrong-normal-tail",
    persona: "wrong_attempt",
    topic: "statistics",
    problem:
      "The heights of adult women in a population are normally distributed with mean 162 cm and standard deviation 6 cm. What proportion of women are taller than 171 cm?",
    answer: "z = 1.5, so P(X > 171) = 1 − 0.9332 = 0.0668 (about 6.7%)",
    opener:
      "can you check my answer? Heights of adult women are normally distributed with mean 162 cm and SD 6 cm. What proportion are taller than 171 cm?\n\nz = (171 − 162)/6 = 1.5\nfrom the table, 1.5 gives 0.9332\nso 93.3% are taller than 171 cm",
    knows:
      "Your mistake: you think the z-table value is the proportion above z (it's actually the area to the left). You know how to compute z correctly.",
  },
  {
    id: "wrong-kinematics",
    persona: "wrong_attempt",
    topic: "physics",
    problem: "A car accelerates uniformly from rest to 25 m/s in 10 s. How far does it travel in that time?",
    answer: "a = 2.5 m/s², so d = ½at² = 125 m (equivalently, average speed 12.5 m/s × 10 s)",
    opener:
      "Is this right? A car accelerates uniformly from rest to 25 m/s in 10 s. How far does it travel in that time?\n\nd = v × t = 25 × 10 = 250 m",
    knows:
      "Your mistake: you used distance = speed × time with the final speed, not noticing that the speed changes the whole time. You know the kinematics equations exist but don't reach for them.",
  },
  {
    // A multi-step attempt and an explicit request to check it, so Ainsley runs the checker
    // (which fails here): a one-line attempt it tends to judge itself.
    id: "wrong-projectile-checker-down",
    persona: "wrong_attempt",
    topic: "physics",
    problem:
      "A ball is launched from ground level at 20 m/s, 30° above the horizontal. Ignoring air resistance and taking g = 9.8 m/s², find (a) the time of flight, (b) the maximum height, and (c) the horizontal range.",
    answer: "v_x = 17.32 m/s and v_y = 10 m/s, so (a) T = 2.04 s, (b) H = 5.10 m, (c) R = 35.3 m",
    opener:
      "Can you check my working step by step before I hand it in? A ball is launched from ground level at 20 m/s, 30° above the horizontal. Ignoring air resistance (g = 9.8 m/s²), find (a) the time of flight, (b) the maximum height, (c) the horizontal range.\n\n1. v_x = 20 sin 30° = 10 m/s, v_y = 20 cos 30° = 17.32 m/s\n2. (a) T = 2v_y/g = 2(17.32)/9.8 = 3.53 s\n3. (b) H = v_y²/(2g) = 300/19.6 = 15.3 m\n4. (c) R = v_x T = 10 × 3.53 = 35.3 m",
    knows:
      "Your mistake: you swapped sine and cosine (you think the horizontal component uses sin θ). Your range came out right only by coincidence. You know the projectile formulas themselves.",
    faults: { "/api/evaluate": OVERLOADED },
  },

  // ---------- Genuinely stuck ----------
  {
    id: "stuck-eigen",
    persona: "stuck",
    topic: "linear algebra",
    problem: String.raw`Find the eigenvalues and corresponding eigenvectors of $A = \begin{pmatrix} 2 & 1 \\ 1 & 2 \end{pmatrix}$.`,
    answer: "λ = 1 with eigenvectors along (1, −1); λ = 3 with eigenvectors along (1, 1)",
    opener:
      "I have to find the eigenvalues and eigenvectors of A = [[2, 1], [1, 2]] and I honestly don't know where to start. We covered it in lecture and I was lost.",
    knows:
      "You can compute a 2×2 determinant and solve a quadratic. From a lecture slide you remember Av = λv, but you don't understand why det(A − λI) = 0 gives the eigenvalues, or how to find eigenvectors afterwards.",
  },
  {
    id: "stuck-parallel",
    persona: "stuck",
    topic: "physics",
    problem:
      "Two resistors, 6 Ω and 12 Ω, are connected in parallel across a 24 V battery. What is the total current drawn from the battery?",
    answer: "R = (6 × 12)/(6 + 12) = 4 Ω, so I = 24/4 = 6 A (4 A through 6 Ω plus 2 A through 12 Ω)",
    opener:
      "Two resistors, 6 Ω and 12 Ω, are connected in parallel across a 24 V battery. What is the total current drawn from the battery? I'm stuck, I don't get how parallel works.",
    knows:
      "You know Ohm's law V = IR and that resistances in series add. You half-think parallel resistances also add, and you don't know that each resistor in parallel gets the full battery voltage.",
  },
  {
    // Multi-step and multi-part, so Ainsley works it out with the solver first (which fails here).
    id: "stuck-oscillator-solver-down",
    persona: "stuck",
    topic: "physics",
    problem:
      "A 0.50 kg block attached to a spring with k = 200 N/m rests on a frictionless surface. It is pulled 0.10 m from equilibrium and released. Find (a) the period of oscillation, (b) the maximum speed, and (c) the speed when the block is 0.05 m from equilibrium.",
    answer: "ω = 20 rad/s, so (a) T = 2π/ω = π/10 ≈ 0.314 s, (b) v_max = Aω = 2.0 m/s, (c) v = ω√(A² − x²) = √3 ≈ 1.73 m/s",
    opener:
      "I'm stuck on this whole problem. A 0.50 kg block on a spring with k = 200 N/m sits on a frictionless surface. It's pulled 0.10 m from equilibrium and released. Find (a) the period, (b) the maximum speed, and (c) the speed when it's 0.05 m from equilibrium. I don't really get simple harmonic motion.",
    knows:
      "You know Hooke's law F = −kx and that kinetic energy is ½mv². You've seen T = 2π√(m/k) on the formula sheet but don't know where it comes from, and you haven't thought of using energy conservation with ½kx² to get speeds.",
    faults: { "/api/solve": OVERLOADED },
  },
  {
    id: "stuck-spring-missing-info",
    persona: "stuck",
    topic: "physics",
    problem:
      "A compressed spring is released and launches a 0.20 kg block across a frictionless floor. How fast does the block move after it leaves the spring?",
    answer:
      "It can't be determined: the spring constant and the compression (or the energy stored in the spring) are not given.",
    opener:
      "A compressed spring is released and launches a 0.20 kg block across a frictionless floor. How fast does the block move after it leaves the spring? I don't know where to start with this one.",
    knows:
      "You know KE = ½mv² and that springs store energy somehow. The question above is exactly what your homework sheet says: if asked, you don't have the spring constant or how far it was compressed.",
    // No answer exists, so neither "answer before an attempt" nor "asked for an attempt first" applies:
    // the right first move is to point out what's missing.
    skip: ["answer_before_attempt", "asked_attempt_first"],
  },
];
