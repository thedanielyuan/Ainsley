/**
 * Problems with known answers for the solver (/api/solve) and the checker (/api/evaluate).
 *
 * Each well-posed problem has its expected answers as sympy expressions in the units the problem
 * asks for (`alts` accepts the same value in another unit; tolerances are relative unless `abs`),
 * and two student attempts for the checker: one correct, one with a planted error at a known
 * step. `final` is the planted attempt's final answer, which the grader self-test must reject.
 * Every expected value was re-derived by hand and checked numerically.
 *
 * Ill-posed problems are missing information, contradict themselves, or point at something that
 * isn't there. The solver should come back "Not verified" or "Couldn't solve", never "Verified".
 */

export const PROBLEMS = [
  // ---------- Calculus ----------
  {
    id: "calc-balloon",
    topic: "calculus",
    tags: ["multi-part", "units"],
    problem:
      "A spherical balloon is being inflated so that its volume increases at a constant rate of 100 cm³/s. (a) How fast is the radius increasing, in cm/s, at the instant the radius is 5 cm? (b) How fast is the surface area increasing, in cm²/s, at that instant?",
    answers: [
      { part: "a", value: "1/pi" },
      { part: "b", value: "40" },
    ],
    correct: [
      "1. V = (4/3)πr³, so dV/dt = 4πr² · dr/dt.",
      "2. At r = 5: 100 = 4π(5)² · dr/dt = 100π · dr/dt.",
      "3. (a) dr/dt = 100/(100π) = 1/π ≈ 0.318 cm/s.",
      "4. S = 4πr², so dS/dt = 8πr · dr/dt.",
      "5. (b) dS/dt = 8π(5)(1/π) = 40 cm²/s.",
    ],
    planted: {
      kind: "differentiation",
      errorSteps: [1],
      final: { a: "3/pi", b: "120" },
      work: [
        "1. V = (4/3)πr³, so dV/dt = (4/3)πr² · dr/dt.",
        "2. At r = 5: 100 = (4/3)π(5)² · dr/dt = (100π/3) · dr/dt.",
        "3. (a) dr/dt = 100 · 3/(100π) = 3/π ≈ 0.955 cm/s.",
        "4. S = 4πr², so dS/dt = 8πr · dr/dt.",
        "5. (b) dS/dt = 8π(5)(3/π) = 120 cm²/s.",
      ],
    },
  },
  {
    id: "calc-parts-integral",
    topic: "calculus",
    tags: [],
    problem: "Evaluate the definite integral ∫₀¹ x² eˣ dx exactly.",
    answers: [{ part: "", value: "E - 2" }],
    correct: [
      "1. Integrate by parts with u = x², dv = eˣ dx: ∫x²eˣ dx = x²eˣ − ∫2x eˣ dx.",
      "2. By parts again with u = 2x, dv = eˣ dx: ∫2x eˣ dx = 2x eˣ − 2eˣ.",
      "3. So ∫x²eˣ dx = x²eˣ − (2x eˣ − 2eˣ) = eˣ(x² − 2x + 2) + C.",
      "4. ∫₀¹ x²eˣ dx = e(1 − 2 + 2) − e⁰(0 − 0 + 2) = e − 2.",
    ],
    planted: {
      kind: "sign",
      errorSteps: [3],
      final: { "": "2 - 3*E" },
      work: [
        "1. Integrate by parts with u = x², dv = eˣ dx: ∫x²eˣ dx = x²eˣ − ∫2x eˣ dx.",
        "2. By parts again with u = 2x, dv = eˣ dx: ∫2x eˣ dx = 2x eˣ − 2eˣ.",
        "3. So ∫x²eˣ dx = x²eˣ − (2x eˣ − 2eˣ) = eˣ(x² − 2x − 2) + C.",
        "4. ∫₀¹ x²eˣ dx = e(1 − 2 − 2) − e⁰(0 − 0 − 2) = 2 − 3e.",
      ],
    },
  },
  {
    id: "calc-limit",
    topic: "calculus",
    tags: [],
    problem: "Find lim_{x→0} (1 − cos 3x)/x².",
    answers: [{ part: "", value: "9/2" }],
    correct: [
      "1. Substituting x = 0 gives 0/0, so L'Hôpital's rule applies.",
      "2. Differentiating top and bottom: lim_{x→0} 3 sin 3x / (2x).",
      "3. Still 0/0, so apply it again: lim_{x→0} 9 cos 3x / 2.",
      "4. = 9/2.",
    ],
    planted: {
      kind: "chain rule",
      errorSteps: [2],
      final: { "": "3/2" },
      work: [
        "1. Substituting x = 0 gives 0/0, so L'Hôpital's rule applies.",
        "2. Differentiating top and bottom: lim_{x→0} sin 3x / (2x).",
        "3. Still 0/0, so apply it again: lim_{x→0} 3 cos 3x / 2.",
        "4. = 3/2.",
      ],
    },
  },

  // ---------- Linear algebra ----------
  {
    id: "linalg-eigenvalues",
    topic: "linear algebra",
    tags: [],
    problem: String.raw`Find the eigenvalues of $A = \begin{pmatrix} 4 & 1 \\ 2 & 3 \end{pmatrix}$.`,
    answers: [{ part: "", value: "FiniteSet(2, 5)" }],
    correct: [
      "1. det(A − λI) = (4 − λ)(3 − λ) − (1)(2).",
      "2. = λ² − 7λ + 12 − 2 = λ² − 7λ + 10.",
      "3. = (λ − 2)(λ − 5) = 0, so λ = 2 or λ = 5.",
    ],
    planted: {
      kind: "sign",
      errorSteps: [1],
      final: { "": "FiniteSet()" },
      work: [
        "1. det(A − λI) = (4 − λ)(3 − λ) + (1)(2).",
        "2. = λ² − 7λ + 14.",
        "3. The discriminant is 49 − 56 = −7 < 0, so A has no real eigenvalues.",
      ],
    },
  },
  {
    id: "linalg-system",
    topic: "linear algebra",
    tags: [],
    problem: "Solve the system x + y + z = 6, 2x − y + z = 3, x + 2y − z = 2. Give (x, y, z).",
    answers: [{ part: "", value: "Tuple(1, 2, 3)" }],
    correct: [
      "1. From the first equation, x = 6 − y − z.",
      "2. Substituting into the second: 2(6 − y − z) − y + z = 3, so 12 − 3y − z = 3, i.e. 3y + z = 9.",
      "3. Substituting into the third: (6 − y − z) + 2y − z = 2, so 6 + y − 2z = 2, i.e. y − 2z = −4.",
      "4. From step 3, y = 2z − 4; then 3(2z − 4) + z = 9, so 7z = 21 and z = 3.",
      "5. y = 2(3) − 4 = 2 and x = 6 − 2 − 3 = 1, so (x, y, z) = (1, 2, 3).",
    ],
    planted: {
      kind: "algebra",
      errorSteps: [2],
      final: { "": "Tuple(-2.6, 4.4, 4.2)" },
      work: [
        "1. From the first equation, x = 6 − y − z.",
        "2. Substituting into the second: 2(6 − y − z) − y + z = 3, so 12 − 3y + z = 3, i.e. 3y − z = 9.",
        "3. Substituting into the third: (6 − y − z) + 2y − z = 2, so 6 + y − 2z = 2, i.e. y − 2z = −4.",
        "4. From step 3, y = 2z − 4; then 3(2z − 4) − z = 9, so 5z = 21 and z = 4.2.",
        "5. y = 2(4.2) − 4 = 4.4 and x = 6 − 4.4 − 4.2 = −2.6, so (x, y, z) = (−2.6, 4.4, 4.2).",
      ],
    },
  },
  {
    id: "linalg-inverse",
    topic: "linear algebra",
    tags: [],
    problem: String.raw`Find the inverse of $A = \begin{pmatrix} 2 & 1 \\ 5 & 3 \end{pmatrix}$.`,
    answers: [{ part: "", value: "Matrix([[3, -1], [-5, 2]])" }],
    correct: [
      "1. det A = (2)(3) − (1)(5) = 1.",
      "2. For a 2×2 matrix [[a, b], [c, d]], A⁻¹ = (1/det A)·[[d, −b], [−c, a]] = (1/1)·[[3, −1], [−5, 2]].",
      "3. A⁻¹ = [[3, −1], [−5, 2]].",
    ],
    planted: {
      kind: "method",
      errorSteps: [2],
      final: { "": "Matrix([[3, -5], [-1, 2]])" },
      work: [
        "1. det A = (2)(3) − (1)(5) = 1.",
        "2. For a 2×2 matrix [[a, b], [c, d]], A⁻¹ = (1/det A)·[[d, −c], [−b, a]] = (1/1)·[[3, −5], [−1, 2]].",
        "3. A⁻¹ = [[3, −5], [−1, 2]].",
      ],
    },
  },

  // ---------- Statistics and probability ----------
  {
    id: "stats-normal",
    topic: "statistics",
    tags: ["multi-part"],
    problem:
      "Exam scores are normally distributed with mean 70 and standard deviation 8. (a) What proportion of students score above 82? (b) What score marks the 90th percentile?",
    answers: [
      { part: "a", value: "0.0668072", tol: { rel: 0.01 }, alts: ["6.68072"] },
      { part: "b", value: "80.2524", tol: { abs: 0.05 } },
    ],
    correct: [
      "1. (a) z = (82 − 70)/8 = 1.5.",
      "2. P(X > 82) = P(Z > 1.5) = 1 − 0.9332 = 0.0668, so about 6.7% of students.",
      "3. (b) The 90th percentile of the standard normal is z = 1.2816.",
      "4. x = 70 + 1.2816 × 8 = 80.25.",
    ],
    planted: {
      kind: "conceptual",
      errorSteps: [2],
      final: { a: "0.9332", b: "80.25" },
      work: [
        "1. (a) z = (82 − 70)/8 = 1.5.",
        "2. P(X > 82) = P(Z > 1.5) = 0.9332, so about 93.3% of students.",
        "3. (b) The 90th percentile of the standard normal is z = 1.2816.",
        "4. x = 70 + 1.2816 × 8 = 80.25.",
      ],
    },
  },
  {
    id: "stats-binomial",
    topic: "statistics",
    tags: [],
    problem: "A fair coin is tossed 10 times. What is the probability of getting exactly 7 heads?",
    answers: [{ part: "", value: "15/128" }],
    correct: [
      "1. The number of heads X ~ Binomial(n = 10, p = 0.5).",
      "2. P(X = 7) = C(10, 7)(0.5)⁷(0.5)³ = C(10, 7)/2¹⁰.",
      "3. C(10, 7) = 120, so P(X = 7) = 120/1024 = 15/128 ≈ 0.117.",
    ],
    planted: {
      kind: "calculation",
      errorSteps: [3],
      final: { "": "45/64" },
      work: [
        "1. The number of heads X ~ Binomial(n = 10, p = 0.5).",
        "2. P(X = 7) = C(10, 7)(0.5)⁷(0.5)³ = C(10, 7)/2¹⁰.",
        "3. C(10, 7) = 10 × 9 × 8 = 720, so P(X = 7) = 720/1024 = 45/64 ≈ 0.703.",
      ],
    },
  },
  {
    id: "stats-t-interval",
    topic: "statistics",
    tags: ["multi-part", "units"],
    problem:
      "A random sample of 16 bolts has mean length 50.2 mm and sample standard deviation 0.8 mm. Assume lengths are normally distributed. (a) Find the margin of error for a 95% confidence interval for the mean length, in mm. (b) Give the 95% confidence interval, in mm.",
    answers: [
      { part: "a", value: "0.42629", tol: { abs: 0.002 } },
      { part: "b", value: "Tuple(49.77371, 50.62629)", tol: { abs: 0.006 } },
    ],
    correct: [
      "1. σ is unknown and n = 16, so use the t distribution with 15 degrees of freedom.",
      "2. t₀.₀₂₅,₁₅ = 2.131.",
      "3. (a) Margin of error = 2.131 × 0.8/√16 = 2.131 × 0.2 = 0.426 mm.",
      "4. (b) 50.2 ± 0.426 gives (49.774, 50.626) mm.",
    ],
    planted: {
      kind: "method",
      errorSteps: [1, 2],
      final: { a: "0.392", b: "Tuple(49.808, 50.592)" },
      work: [
        "1. For a 95% confidence interval, use z = 1.96.",
        "2. (a) Margin of error = 1.96 × 0.8/√16 = 1.96 × 0.2 = 0.392 mm.",
        "3. (b) 50.2 ± 0.392 gives (49.808, 50.592) mm.",
      ],
    },
  },
  {
    id: "stats-bayes",
    topic: "statistics",
    tags: [],
    problem:
      "A disease affects 1% of a population. A test detects the disease in 95% of people who have it, and gives a false positive for 5% of people who don't. A randomly chosen person tests positive. What is the probability that they have the disease?",
    answers: [{ part: "", value: "19/118", tol: { rel: 0.01 }, alts: ["16.10169"] }],
    correct: [
      "1. P(D) = 0.01, P(+ | D) = 0.95, P(+ | not D) = 0.05.",
      "2. P(+) = 0.95 × 0.01 + 0.05 × 0.99 = 0.0095 + 0.0495 = 0.059.",
      "3. P(D | +) = P(+ | D)P(D)/P(+) = 0.0095/0.059 ≈ 0.161.",
    ],
    planted: {
      kind: "conceptual",
      errorSteps: [2],
      final: { "": "0.95" },
      work: [
        "1. P(D) = 0.01, P(+ | D) = 0.95, P(+ | not D) = 0.05.",
        "2. The test is 95% accurate, so a positive result means P(D | +) = 0.95.",
      ],
    },
  },

  // ---------- Physics ----------
  {
    id: "phys-projectile",
    topic: "physics",
    tags: ["multi-part", "units"],
    problem:
      "A ball is launched from ground level at 20 m/s, 30° above the horizontal. Ignoring air resistance and taking g = 9.8 m/s², find (a) the time of flight, in s; (b) the maximum height, in m; (c) the horizontal range, in m.",
    answers: [
      { part: "a", value: "2.0408", tol: { rel: 0.01 } },
      { part: "b", value: "5.1020", tol: { rel: 0.01 } },
      { part: "c", value: "35.348", tol: { rel: 0.01 } },
    ],
    correct: [
      "1. v_x = 20 cos 30° = 17.32 m/s and v_y = 20 sin 30° = 10 m/s.",
      "2. (a) The ball lands when y = 0: T = 2v_y/g = 2(10)/9.8 = 2.04 s.",
      "3. (b) At the top v_y = 0: H = v_y²/(2g) = 100/19.6 = 5.10 m.",
      "4. (c) R = v_x T = 17.32 × 2.04 = 35.3 m.",
    ],
    planted: {
      // The range comes out right by symmetry, but (a) and (b) don't.
      kind: "conceptual",
      errorSteps: [1],
      final: { a: "3.53", b: "15.3", c: "35.3" },
      work: [
        "1. v_x = 20 sin 30° = 10 m/s and v_y = 20 cos 30° = 17.32 m/s.",
        "2. (a) The ball lands when y = 0: T = 2v_y/g = 2(17.32)/9.8 = 3.53 s.",
        "3. (b) At the top v_y = 0: H = v_y²/(2g) = 300/19.6 = 15.3 m.",
        "4. (c) R = v_x T = 10 × 3.53 = 35.3 m.",
      ],
    },
  },
  {
    id: "phys-braking",
    topic: "physics",
    tags: ["multi-part", "units"],
    problem:
      "A 1200 kg car travelling at 72 km/h brakes uniformly to a stop over a distance of 40 m. Find (a) the car's initial kinetic energy, in kJ; (b) the magnitude of the average braking force, in kN.",
    answers: [
      { part: "a", value: "240", alts: ["240000"] },
      { part: "b", value: "6", alts: ["6000"] },
    ],
    correct: [
      "1. v = 72 km/h = 72 × 1000/3600 = 20 m/s.",
      "2. (a) KE = ½mv² = ½(1200)(20)² = 240 000 J = 240 kJ.",
      "3. (b) By the work–energy theorem, F·d = KE, so F = 240 000/40 = 6000 N = 6.0 kN.",
    ],
    planted: {
      kind: "units",
      errorSteps: [1],
      final: { a: "3110.4", b: "77.76" },
      work: [
        "1. (a) KE = ½mv² = ½(1200)(72)² = 3 110 400 J ≈ 3110 kJ.",
        "2. (b) By the work–energy theorem, F·d = KE, so F = 3 110 400/40 = 77 760 N ≈ 77.8 kN.",
      ],
    },
  },
  {
    id: "phys-circuit",
    topic: "physics",
    tags: ["multi-part", "units"],
    problem:
      "A 12 V battery with negligible internal resistance is connected to a 4 Ω resistor in series with a parallel combination of a 6 Ω resistor and a 3 Ω resistor. Find (a) the current drawn from the battery, in A; (b) the power dissipated in the 3 Ω resistor, in W.",
    answers: [
      { part: "a", value: "2" },
      { part: "b", value: "16/3" },
    ],
    correct: [
      "1. The parallel pair: R_p = (6 × 3)/(6 + 3) = 2 Ω.",
      "2. (a) R_total = 4 + 2 = 6 Ω, so I = V/R = 12/6 = 2 A.",
      "3. The voltage across the parallel pair is V_p = I R_p = 2 × 2 = 4 V.",
      "4. (b) P = V_p²/R = 4²/3 = 16/3 ≈ 5.33 W.",
    ],
    planted: {
      kind: "conceptual",
      errorSteps: [3],
      final: { a: "2", b: "12" },
      work: [
        "1. The parallel pair: R_p = (6 × 3)/(6 + 3) = 2 Ω.",
        "2. (a) R_total = 4 + 2 = 6 Ω, so I = V/R = 12/6 = 2 A.",
        "3. (b) The 3 Ω resistor carries the battery current, so P = I²R = 2² × 3 = 12 W.",
      ],
    },
  },

  // ---------- Chemistry ----------
  {
    id: "chem-stoichiometry",
    topic: "chemistry",
    tags: ["units"],
    problem:
      "Hydrogen burns in oxygen: 2H₂ + O₂ → 2H₂O. How many grams of water form when 8.0 g of H₂ reacts with excess O₂? Use H = 1.008 g/mol and O = 16.00 g/mol.",
    answers: [{ part: "", value: "71.492", tol: { rel: 0.01 } }],
    correct: [
      "1. M(H₂) = 2 × 1.008 = 2.016 g/mol, so n(H₂) = 8.0/2.016 = 3.97 mol.",
      "2. From the equation, 2 mol H₂ gives 2 mol H₂O, so n(H₂O) = 3.97 mol.",
      "3. M(H₂O) = 2(1.008) + 16.00 = 18.016 g/mol, so m(H₂O) = 3.97 × 18.016 = 71.5 g.",
    ],
    planted: {
      kind: "conceptual",
      errorSteps: [2],
      final: { "": "35.7" },
      work: [
        "1. M(H₂) = 2 × 1.008 = 2.016 g/mol, so n(H₂) = 8.0/2.016 = 3.97 mol.",
        "2. From the equation, 2 mol H₂ gives 1 mol H₂O, so n(H₂O) = 3.97/2 = 1.98 mol.",
        "3. M(H₂O) = 2(1.008) + 16.00 = 18.016 g/mol, so m(H₂O) = 1.98 × 18.016 = 35.7 g.",
      ],
    },
  },
  {
    id: "chem-weak-acid",
    topic: "chemistry",
    tags: [],
    problem: "Find the pH of a 0.10 M acetic acid solution at 25 °C. Ka = 1.8 × 10⁻⁵.",
    answers: [{ part: "", value: "2.8753", tol: { abs: 0.01 } }],
    correct: [
      "1. CH₃COOH ⇌ H⁺ + CH₃COO⁻, with Ka = x²/(0.10 − x) where x = [H⁺].",
      "2. Assuming x ≪ 0.10: x² = 1.8 × 10⁻⁵ × 0.10 = 1.8 × 10⁻⁶, so x = 1.34 × 10⁻³ M.",
      "3. Check: 1.34 × 10⁻³/0.10 = 1.3% < 5%, so the approximation holds.",
      "4. pH = −log(1.34 × 10⁻³) = 2.87.",
    ],
    planted: {
      kind: "calculation",
      errorSteps: [2],
      final: { "": "5.74" },
      work: [
        "1. CH₃COOH ⇌ H⁺ + CH₃COO⁻, with Ka = x²/(0.10 − x) where x = [H⁺].",
        "2. Assuming x ≪ 0.10: x² = 1.8 × 10⁻⁵ × 0.10 = 1.8 × 10⁻⁶, so x = 1.8 × 10⁻⁶ M.",
        "3. pH = −log(1.8 × 10⁻⁶) = 5.74.",
      ],
    },
  },
  {
    id: "chem-ideal-gas",
    topic: "chemistry",
    tags: ["units"],
    problem:
      "A sealed 2.50 L container holds 0.100 mol of an ideal gas at 27 °C. What is the pressure, in kPa? Use R = 8.314 J/(mol·K).",
    answers: [{ part: "", value: "99.818", alts: ["99818", "0.98513"] }],
    correct: [
      "1. T = 27 + 273.15 = 300.15 K and V = 2.50 L = 2.50 × 10⁻³ m³.",
      "2. P = nRT/V = (0.100)(8.314)(300.15)/(2.50 × 10⁻³).",
      "3. P = 9.98 × 10⁴ Pa = 99.8 kPa.",
    ],
    planted: {
      kind: "units",
      errorSteps: [1],
      final: { "": "8.98" },
      work: [
        "1. T = 27 and V = 2.50 L = 2.50 × 10⁻³ m³.",
        "2. P = nRT/V = (0.100)(8.314)(27)/(2.50 × 10⁻³).",
        "3. P = 8.98 × 10³ Pa = 8.98 kPa.",
      ],
    },
  },

  // ---------- Harder problems and traps, where a plausible wrong answer is close at hand ----------
  {
    id: "hard-divergent-integral",
    topic: "calculus",
    tags: ["trap"],
    problem: "Evaluate ∫₋₁¹ 1/x² dx.",
    answers: [{ part: "", value: "oo", describe: "The integral diverges (to +∞); 1/x² isn't integrable at x = 0." }],
    correct: [
      "1. 1/x² is unbounded at x = 0, inside [−1, 1], so the integral is improper: split it at 0.",
      "2. ∫₀¹ 1/x² dx = lim_{t→0⁺} [−1/x]ₜ¹ = lim_{t→0⁺} (−1 + 1/t) = ∞.",
      "3. Since one part diverges, ∫₋₁¹ 1/x² dx diverges (to +∞).",
    ],
    planted: {
      // Step 1 is true on each side of 0; the error is applying the FTC across the discontinuity.
      kind: "conceptual",
      errorSteps: [2],
      final: { "": "-2" },
      work: ["1. An antiderivative of 1/x² is −1/x.", "2. ∫₋₁¹ 1/x² dx = [−1/x]₋₁¹ = (−1) − (1) = −2."],
    },
  },
  {
    id: "hard-gaussian-moment",
    topic: "calculus",
    tags: [],
    problem: "Evaluate ∫₀^∞ x² e^(−x²) dx exactly.",
    answers: [{ part: "", value: "sqrt(pi)/4" }],
    correct: [
      "1. Integrate by parts with u = x and dv = x e^(−x²) dx, so du = dx and v = −½ e^(−x²).",
      "2. ∫₀^∞ x² e^(−x²) dx = [−½ x e^(−x²)]₀^∞ + ½ ∫₀^∞ e^(−x²) dx.",
      "3. The boundary term is 0 − 0 = 0.",
      "4. ∫₀^∞ e^(−x²) dx = √π/2, so the integral is ½ · √π/2 = √π/4.",
    ],
    planted: {
      kind: "calculation",
      errorSteps: [1],
      final: { "": "sqrt(pi)/2" },
      work: [
        "1. Integrate by parts with u = x and dv = x e^(−x²) dx, so du = dx and v = −e^(−x²).",
        "2. ∫₀^∞ x² e^(−x²) dx = [−x e^(−x²)]₀^∞ + ∫₀^∞ e^(−x²) dx.",
        "3. The boundary term is 0 − 0 = 0.",
        "4. ∫₀^∞ e^(−x²) dx = √π/2, so the integral is √π/2.",
      ],
    },
  },
  {
    id: "hard-determinant-scaling",
    topic: "linear algebra",
    tags: ["trap"],
    problem: "A is a 3×3 matrix with det(A) = 4. Find det(2A⁻¹Aᵀ).",
    answers: [{ part: "", value: "8" }],
    correct: [
      "1. For a 3×3 matrix, det(cM) = c³ det(M), so det(2A⁻¹Aᵀ) = 8 det(A⁻¹Aᵀ).",
      "2. det(A⁻¹Aᵀ) = det(A⁻¹) det(Aᵀ) = (1/4)(4) = 1.",
      "3. So det(2A⁻¹Aᵀ) = 8.",
    ],
    planted: {
      kind: "conceptual",
      errorSteps: [1],
      final: { "": "2" },
      work: [
        "1. det(2A⁻¹Aᵀ) = 2 det(A⁻¹Aᵀ).",
        "2. det(A⁻¹Aᵀ) = det(A⁻¹) det(Aᵀ) = (1/4)(4) = 1.",
        "3. So det(2A⁻¹Aᵀ) = 2.",
      ],
    },
  },
  {
    id: "hard-two-children",
    topic: "statistics",
    tags: ["trap"],
    problem:
      "A family has two children, each independently a boy or a girl with probability 1/2. Given that at least one of them is a boy, what is the probability that both are boys?",
    answers: [{ part: "", value: "1/3" }],
    correct: [
      "1. The equally likely outcomes are BB, BG, GB and GG.",
      "2. \"At least one boy\" leaves BB, BG and GB, still equally likely.",
      "3. Only BB has two boys, so P(both boys | at least one boy) = 1/3.",
    ],
    planted: {
      // Step 1 already reads "at least one is a boy" as "a particular child is a boy".
      kind: "conceptual",
      errorSteps: [1, 2],
      final: { "": "1/2" },
      work: [
        "1. One of the children is a boy.",
        "2. The other child is independent of the first, so it's a boy with probability 1/2.",
        "3. So P(both boys | at least one boy) = 1/2.",
      ],
    },
  },
  {
    id: "hard-p-value",
    topic: "statistics",
    tags: [],
    problem:
      "A coin is flipped 100 times and lands heads 61 times. Using the normal approximation without a continuity correction, find the two-sided p-value for H₀: p = 0.5.",
    answers: [{ part: "", value: "0.0278069", tol: { abs: 0.0005 } }],
    correct: [
      "1. Under H₀, X ~ Bin(100, 0.5), with mean 50 and SD √(100 × 0.25) = 5.",
      "2. z = (61 − 50)/5 = 2.2.",
      "3. Two-sided p-value = 2P(Z > 2.2) = 2(0.0139) = 0.0278.",
    ],
    planted: {
      kind: "method",
      errorSteps: [3],
      final: { "": "0.0139" },
      work: [
        "1. Under H₀, X ~ Bin(100, 0.5), with mean 50 and SD √(100 × 0.25) = 5.",
        "2. z = (61 − 50)/5 = 2.2.",
        "3. p-value = P(Z > 2.2) = 0.0139.",
      ],
    },
  },
  {
    id: "hard-rolling-sphere",
    topic: "physics",
    tags: ["units"],
    problem:
      "A solid sphere rolls without slipping from rest down a ramp, dropping a vertical height of 2.0 m. Find its speed at the bottom, in m/s. Take g = 9.8 m/s².",
    answers: [{ part: "", value: "sqrt(28)" }],
    correct: [
      "1. Energy is conserved: mgh = ½mv² + ½Iω².",
      "2. For a solid sphere I = (2/5)mr², and rolling without slipping gives ω = v/r.",
      "3. So mgh = ½mv² + ⅕mv² = (7/10)mv².",
      "4. v = √(10gh/7) = √(10 × 9.8 × 2.0/7) = √28 ≈ 5.29 m/s.",
    ],
    planted: {
      kind: "conceptual",
      errorSteps: [1],
      final: { "": "6.26" },
      work: ["1. Energy is conserved: mgh = ½mv².", "2. v = √(2gh) = √(2 × 9.8 × 2.0) ≈ 6.26 m/s."],
    },
  },
  {
    id: "hard-buffer",
    topic: "chemistry",
    tags: ["multi-part"],
    problem:
      "A buffer is made by dissolving 0.20 mol of acetic acid and 0.10 mol of sodium acetate in water to make 1.0 L (Ka = 1.8 × 10⁻⁵). (a) What is its pH? (b) What is the pH after 0.050 mol of HCl is added? Assume the volume doesn't change.",
    answers: [
      { part: "a", value: "4.4437", tol: { abs: 0.01 } },
      { part: "b", value: "4.0458", tol: { abs: 0.01 } },
    ],
    correct: [
      "1. pKa = −log(1.8 × 10⁻⁵) = 4.74.",
      "2. (a) pH = pKa + log([A⁻]/[HA]) = 4.74 + log(0.10/0.20) = 4.74 − 0.30 = 4.44.",
      "3. (b) HCl reacts with the acetate: A⁻ goes from 0.10 to 0.050 mol and HA from 0.20 to 0.25 mol.",
      "4. pH = 4.74 + log(0.050/0.25) = 4.74 − 0.70 = 4.04.",
    ],
    planted: {
      kind: "conceptual",
      errorSteps: [3],
      final: { a: "4.44", b: "4.74" },
      work: [
        "1. pKa = −log(1.8 × 10⁻⁵) = 4.74.",
        "2. (a) pH = pKa + log([A⁻]/[HA]) = 4.74 + log(0.10/0.20) = 4.74 − 0.30 = 4.44.",
        "3. (b) HCl reacts with the acetic acid: HA goes from 0.20 to 0.15 mol and A⁻ from 0.10 to 0.15 mol.",
        "4. pH = 4.74 + log(0.15/0.15) = 4.74.",
      ],
    },
  },
];

export const ILL_POSED = [
  {
    id: "ill-missing-speed",
    topic: "physics",
    flaw: "missing the launch speed",
    problem: "A ball is thrown straight up from ground level. Find the maximum height it reaches, in meters. Take g = 9.8 m/s².",
  },
  {
    id: "ill-contradictory-triangle",
    topic: "geometry",
    flaw: "legs 3 and 4 force a hypotenuse of 5, not 6",
    problem: "A right triangle has legs of length 3 cm and 4 cm and a hypotenuse of 6 cm. Find its area in cm².",
  },
  {
    id: "ill-missing-figure",
    topic: "physics",
    flaw: "refers to a figure that isn't given",
    problem: "For the circuit shown in the figure, find the current through the 4 Ω resistor.",
  },
  {
    id: "ill-missing-sd",
    topic: "statistics",
    flaw: "no standard deviation",
    problem:
      "The weights of apples from an orchard are normally distributed with mean 150 g. What proportion of apples weigh more than 170 g?",
  },
  {
    id: "ill-missing-concentration",
    topic: "chemistry",
    flaw: "no concentration",
    problem: "What is the pH of an acetic acid solution? Ka = 1.8 × 10⁻⁵.",
  },
  {
    id: "ill-inconsistent-kinematics",
    topic: "physics",
    flaw: "30 m/s in 10 s from rest means 150 m, not 50 m",
    problem:
      "A car accelerates uniformly from rest to 30 m/s in 10 s, covering 50 m in that time. Find its acceleration, in m/s².",
  },
];
