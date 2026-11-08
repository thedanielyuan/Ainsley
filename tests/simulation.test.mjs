// Pins the math that show_simulation's simulations compute in the browser: the expression
// language, validation of Ainsley's input, free-body physics, practice-mode checking, vector-field
// derivatives and field lines, graph ranges, and how simulations sit in a reply.
//
//   node --test tests/simulation.test.mjs
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

const { compile, ExpressionError } = await import("../src/lib/simulation/expression.ts");
const { parseSimulation, initialScope } = await import("../src/lib/simulation/spec.ts");
const fb = await import("../src/lib/simulation/free-body.ts");
const { derivatives, makeField, traceLine, typicalMagnitude } = await import("../src/lib/simulation/field.ts");
const { fitYRange } = await import("../src/lib/simulation/graph.ts");
const { fitView } = await import("../src/lib/simulation/view.ts");
const { simulationMarker, withoutSimulations } = await import("../src/lib/simulation/marker.ts");
const { describeSimulation } = await import("../src/lib/simulation/describe.ts");
const { formatNumber } = await import("../src/lib/simulation/format.ts");

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
const evaluate = (source, scope = {}) => compile(source, new Set(Object.keys(scope))).evaluate(scope);
const spec = (input) => {
  const parsed = parseSimulation(input);
  assert.ok("spec" in parsed, JSON.stringify(parsed));
  return parsed.spec;
};
const errorsOf = (input) => {
  const parsed = parseSimulation(input);
  assert.ok("errors" in parsed, "expected the input to be rejected");
  return parsed.errors.join("\n");
};

describe("expressions", () => {
  test("follow the usual precedence", () => {
    close(evaluate("1 + 2*3"), 7);
    close(evaluate("2^3^2"), 512);
    close(evaluate("-2^2"), -4);
    close(evaluate("2^-1"), 0.5);
    close(evaluate("x/y/2", { x: 8, y: 2 }), 2);
    close(evaluate("x - y - 1", { x: 8, y: 2 }), 5);
    close(evaluate("2**3"), 8);
  });

  test("multiply implicitly after numbers and parentheses", () => {
    close(evaluate("2x", { x: 3 }), 6);
    close(evaluate("-2x", { x: 3 }), -6);
    close(evaluate("2x^2", { x: 3 }), 18);
    close(evaluate("(x+1)(x-1)", { x: 3 }), 8);
    close(evaluate("a(x+1)", { a: 2, x: 3 }), 8);
    close(evaluate("3sin(x)", { x: 0.3 }), 3 * Math.sin(0.3));
    close(evaluate("2pi"), 2 * Math.PI);
  });

  test("have radian and degree trigonometry, and other functions", () => {
    close(evaluate("cosd(60)"), 0.5, 1e-12);
    close(evaluate("sind(30)"), 0.5, 1e-12);
    close(evaluate("cos(pi)"), -1);
    close(evaluate("atan2d(1, 1)"), 45, 1e-12);
    close(evaluate("m*g*cosd(theta)", { m: 2, g: 9.8, theta: 30 }), 2 * 9.8 * Math.cos(Math.PI / 6));
    close(evaluate("min(1, 2, -3)"), -3);
    close(evaluate("hypot(3, 4)"), 5);
    close(evaluate("ln(e)"), 1);
    close(evaluate("log10(1000)"), 3);
  });

  test("compare, and choose with if()", () => {
    close(evaluate("x <= 1", { x: 1 }), 1);
    close(evaluate("x > 1", { x: 1 }), 0);
    close(evaluate("if(x < 0, -x, x)", { x: -4 }), 4);
  });

  test("let a declared name override a constant", () => {
    close(evaluate("e"), Math.E);
    close(evaluate("e", { e: 5 }), 5);
  });

  test("accept typographic signs", () => {
    close(evaluate("−y·2", { y: 3 }), -6);
    close(evaluate("θ×2", { θ: 2 }), 4);
  });

  test("reject what they can't read, saying why", () => {
    for (const bad of ["", "2+", "sin", "sin(1, 2)", "(1", "1)", "x y", "atan2(1)", "1 ? 2"]) {
      assert.throws(() => compile(bad, new Set(["x", "y"])), ExpressionError, bad);
    }
    assert.throws(() => compile("k*x", new Set(["x"])), /unknown name "k"/);
    assert.throws(() => compile("x".repeat(401), new Set(["x"])), /longer than/);
  });
});

const INCLINE = {
  kind: "free_body_diagram",
  title: "Block on a rough incline",
  parameters: [
    { name: "theta", min: 0, max: 60, value: 30, unit: "°" },
    { name: "m", min: 1, max: 10, value: 2, unit: "kg" },
  ],
  constants: { g: 9.8, mu: 0.3 },
  free_body_diagram: {
    surface: "incline",
    incline_angle: "theta",
    mass: "m",
    forces: [
      { name: "Weight", type: "gravity", label: "mg", magnitude: "m*g", angle: "-90" },
      { name: "Normal force", type: "normal", label: "F_N", magnitude: "m*g*cosd(theta)", angle: "90", relative_to: "incline" },
      {
        name: "Kinetic friction",
        type: "friction",
        label: "f_k",
        magnitude: "mu*m*g*cosd(theta)",
        angle: "0",
        relative_to: "incline",
        hint: "Which way is the block sliding?",
      },
    ],
  },
};

describe("validating show_simulation input", () => {
  test("accepts a complete free-body diagram", () => {
    const s = spec(INCLINE);
    assert.equal(s.kind, "free_body_diagram");
    assert.equal(s.axes, "incline");
    assert.equal(s.forces.length, 3);
    assert.equal(s.parameters[0].step, 0.5);
  });

  test("names each problem with its path", () => {
    assert.match(
      errorsOf({ kind: "free_body_diagram", title: "x", free_body_diagram: { forces: [{ type: "gravity", magnitude: "m*g", angle: "-90" }] } }),
      /free_body_diagram\.forces\[0\]\.magnitude: .*unknown name "m"/,
    );
    assert.match(errorsOf({ kind: "free_body_diagram", title: "x", free_body_diagram: { forces: [] } }), /at least one force/);
    assert.match(
      errorsOf({ kind: "free_body_diagram", title: "x", free_body_diagram: { surface: "incline", incline_angle: "95", forces: INCLINE.free_body_diagram.forces.slice(0, 1) } }),
      /between 0 and 80/,
    );
    assert.match(
      errorsOf({ kind: "free_body_diagram", title: "x", free_body_diagram: { forces: [{ ...INCLINE.free_body_diagram.forces[1], magnitude: "1" }] } }),
      /relative_to: is "incline" but the surface isn't an incline/,
    );
    assert.match(errorsOf({ kind: "pendulum" }), /kind: must be one of/);
    assert.match(errorsOf({ kind: "vector_field", title: "x" }), /go in an object named "vector_field"/);
    assert.match(
      errorsOf({ kind: "vector_field", title: "x", parameters: [{ name: "x", min: 0, max: 1, value: 0 }], vector_field: { x: "-y", y: "x" } }),
      /"x" is already the simulation's own variable/,
    );
    assert.match(errorsOf({ kind: "vector_field", title: "x", vector_field: { x: "sqrt(-1-x*x)", y: "0" } }), /isn't a finite number anywhere/);
  });

  test("keeps sliders' starting values in range", () => {
    const s = spec({ ...INCLINE, parameters: [{ name: "theta", min: 0, max: 60, value: 75 }, INCLINE.parameters[1]] });
    assert.equal(s.parameters[0].value, 60);
  });
});

describe("free-body diagrams", () => {
  const s = spec(INCLINE);
  const scope = initialScope(s);
  const forces = fb.evaluateForces(s, scope);
  const mgSin = 2 * 9.8 * 0.5;
  const mgCos = 2 * 9.8 * Math.cos(Math.PI / 6);

  test("point each force the right way, with its magnitude", () => {
    assert.deepEqual(
      forces.map((f) => Math.round(f.angle)),
      [270, 120, 30],
    );
    close(forces[0].magnitude, 19.6);
    close(forces[1].magnitude, mgCos);
    close(forces[2].magnitude, 0.3 * mgCos);
  });

  test("sum to the net force along the incline's axes", () => {
    const theta = fb.inclineAngle(s, scope);
    const axes = fb.axisAngles(s, theta);
    assert.deepEqual(axes, { x: 30, y: 120 });
    const net = fb.netForce(forces);
    const along = fb.components(net.fx, net.fy, axes.x);
    close(along.x, -(mgSin - 0.3 * mgCos), 1e-9);
    close(along.y, 0, 1e-9);
    close(net.magnitude / 2, 9.8 * (0.5 - 0.3 * Math.cos(Math.PI / 6)), 1e-9);
    assert.equal(fb.describeDirection(s, theta, net.angle), "down the incline");
  });

  test("mirror an incline rising to the left, with x down the slope", () => {
    const left = spec({ ...INCLINE, free_body_diagram: { ...INCLINE.free_body_diagram, incline_rises: "left" } });
    const lf = fb.evaluateForces(left, scope);
    assert.deepEqual(
      lf.map((f) => Math.round(f.angle)),
      [270, 60, 150],
    );
    const axes = fb.axisAngles(left, 30);
    assert.deepEqual(axes, { x: -30, y: 60 });
    const net = fb.netForce(lf);
    close(fb.components(net.fx, net.fy, axes.x).x, mgSin - 0.3 * mgCos, 1e-9);
  });

  test("draw a negative magnitude the opposite way", () => {
    const flipped = spec({
      kind: "free_body_diagram",
      title: "x",
      free_body_diagram: { forces: [{ name: "Push", type: "applied", label: "F", magnitude: "-5", angle: "0" }] },
    });
    const [f] = fb.evaluateForces(flipped, initialScope(flipped));
    close(f.magnitude, 5);
    close(f.angle, 180);
  });

  test("find the largest force over the sliders' range", () => {
    close(fb.largestForce(s, scope), 10 * 9.8);
  });

  test("describe directions in words", () => {
    assert.equal(fb.describeDirection(s, 30, 270), "straight down");
    assert.equal(fb.describeDirection(s, 30, 120), "perpendicular to the incline, away from it");
    assert.equal(fb.describeDirection(s, 30, 210), "down the incline");
    assert.equal(fb.describeDirection(s, 30, 75), "at 75° from the +x axis");
  });
});

describe("checking a practice diagram", () => {
  const s = spec(INCLINE);
  const expected = fb.evaluateForces(s, initialScope(s));
  const arrow = (id, type, angle) => ({ id, type, angle, length: 0.6 });

  test("accepts the right forces within 20°", () => {
    const check = fb.checkDiagram(s, expected, [arrow("a", "gravity", 265), arrow("b", "normal", 135), arrow("c", "friction", 20)]);
    assert.equal(check.allRight, true);
    assert.equal(check.messages[0], "All 3 forces are right.");
  });

  test("marks a wrong direction, an extra force, and a missing one with Ainsley's hint", () => {
    const check = fb.checkDiagram(s, expected, [arrow("a", "gravity", 270), arrow("b", "normal", 90), arrow("c", "applied", 210)]);
    assert.deepEqual(check.verdicts, { a: "right", b: "direction", c: "extra" });
    assert.deepEqual(
      check.missing.map((m) => m.force.name),
      ["Kinetic friction"],
    );
    assert.ok(check.messages.some((m) => m.includes("Which way is the block sliding?")));
    assert.equal(check.allRight, false);
  });

  test("accepts another name for the same pull, and flags a second copy of a force", () => {
    const rope = spec({
      kind: "free_body_diagram",
      title: "x",
      constants: { T: 10 },
      free_body_diagram: {
        forces: [
          { name: "Tension", type: "tension", label: "T", magnitude: "T", angle: "90" },
          { name: "Weight", type: "gravity", label: "mg", magnitude: "T", angle: "-90" },
        ],
      },
    });
    const ropeForces = fb.evaluateForces(rope, initialScope(rope));
    const check = fb.checkDiagram(rope, ropeForces, [arrow("a", "applied", 90), arrow("b", "gravity", 270), arrow("c", "gravity", 280)]);
    assert.equal(check.verdicts.a, "renamed");
    assert.equal(check.verdicts.b, "right");
    assert.equal(check.verdicts.c, "duplicate");
  });

  test("doesn't expect a force that's zero", () => {
    const smooth = spec({ ...INCLINE, constants: { g: 9.8, mu: 0 } });
    const smoothForces = fb.evaluateForces(smooth, initialScope(smooth));
    const check = fb.checkDiagram(smooth, smoothForces, [arrow("a", "gravity", 270), arrow("b", "normal", 120)]);
    assert.equal(check.allRight, true);
    assert.equal(check.expected, 2);
  });

  test("asks for a name before judging an arrow", () => {
    const check = fb.checkDiagram(s, expected, [arrow("a", null, 270)]);
    assert.equal(check.verdicts.a, "untyped");
    assert.equal(check.messages[0], "Choose which force each arrow is.");
  });
});

describe("vector fields", () => {
  const field = (x, y, params = {}) =>
    makeField(spec({ kind: "vector_field", title: "F", parameters: params.parameters, vector_field: { x, y } }), {});

  test("compute divergence and curl", () => {
    const rotation = field("-y", "x");
    const r = derivatives(rotation, 1.3, -0.7, 1e-4);
    close(r.div, 0, 1e-6);
    close(r.curl, 2, 1e-6);
    const source = field("x", "y");
    const s = derivatives(source, 2, 5, 1e-4);
    close(s.div, 2, 1e-6);
    close(s.curl, 0, 1e-6);
    // F = (x²y, xy²): div = 2xy + 2xy = 4xy, curl = y² − x².
    const poly = derivatives(field("x^2*y", "x*y^2"), 1.5, -2, 1e-4);
    close(poly.div, 4 * 1.5 * -2, 1e-6);
    close(poly.curl, 4 - 2.25, 1e-6);
  });

  test("read a point vortex's curl as zero away from its center", () => {
    const vortex = field("-y/(x^2+y^2)", "x/(x^2+y^2)");
    close(derivatives(vortex, 2, 1, 1e-3).curl, 0, 1e-6);
  });

  test("trace a closed field line around a rotation", () => {
    const rotation = field("-y", "x");
    // About the app's step: 3px at 60px per unit.
    const { points, closed } = traceLine(rotation, 2, 0, 0.05, [-10, 10, -10, 10]);
    assert.equal(closed, true);
    for (const [x, y] of points) close(Math.hypot(x, y), 2, 1e-5);
    // Counterclockwise: the first step from (2, 0) goes up.
    assert.ok(points[1][1] > 0);
  });

  test("follow a source's field line outward until it leaves the region", () => {
    const { points, closed } = traceLine(field("x", "y"), 1, 1, 0.05, [-5, 5, -5, 5]);
    assert.equal(closed, false);
    const last = points[points.length - 1];
    assert.ok(Math.max(Math.abs(last[0]), Math.abs(last[1])) > 5);
    close(last[1] / last[0], 1, 1e-6);
  });

  test("scale to a typical strength, not a singularity", () => {
    const view = fitView([-5, 5], [-5, 5], 400, 400, true);
    const typical = typicalMagnitude(field("x/(x^2+y^2)^2", "y/(x^2+y^2)^2"), view, 400, 400);
    assert.ok(typical > 0 && typical < 50, `typical ${typical}`);
  });
});

describe("graphs", () => {
  test("fit the y-range to a damped oscillation's lowest trough", () => {
    const s = spec({
      kind: "function_graph",
      title: "x",
      function_graph: { variable: "t", functions: [{ expression: "exp(-0.2*t)*cos(2*t)" }], x_range: [0, 20] },
    });
    const [lo, hi] = fitYRange(s);
    assert.ok(lo < -0.74 && hi > 1, `${lo}, ${hi}`);
  });

  test("ignore an asymptote's spike", () => {
    const s = spec({ kind: "function_graph", title: "x", function_graph: { functions: ["1/x"], x_range: [-5, 5] } });
    const [lo, hi] = fitYRange(s);
    assert.ok(hi < 100 && lo > -100, `${lo}, ${hi}`);
  });
});

describe("simulations in a reply", () => {
  test("travel as fenced JSON that can't break the fence or read as math", () => {
    const input = { title: "a `b` $c$" };
    const marker = simulationMarker(input);
    assert.ok(!marker.split("\n")[1].includes("`") && !marker.includes("$"));
    assert.deepEqual(JSON.parse(marker.split("\n")[1]), input);
    assert.equal(withoutSimulations(`Hello\n\n${marker}\nWorld`), "Hello\n\nWorld");
  });

  test("tell Ainsley what the student sees, with the numbers", () => {
    const text = describeSimulation(spec(INCLINE));
    assert.match(text, /Weight 19\.6 N straight down/);
    assert.match(text, /Normal force 17 N perpendicular to the incline, away from it/);
    assert.match(text, /Net force 4\.71 N down the incline, so a = 2\.35 m\/s²/);
    const practice = describeSimulation(spec({ ...INCLINE, free_body_diagram: { ...INCLINE.free_body_diagram, mode: "practice" } }));
    assert.match(practice, /Don't name or describe the forces/);
  });

  test("format numbers to three significant figures", () => {
    assert.deepEqual([19.6, 16.974, 4.70777, 0.0123456, 98, 1234.5, 0].map((v) => formatNumber(v)), [
      "19.6",
      "17",
      "4.71",
      "0.0123",
      "98",
      "1235",
      "0",
    ]);
  });
});
