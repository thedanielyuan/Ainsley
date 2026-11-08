import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

// The knowledge map's logic, loaded straight from its TypeScript (Node 24 strips the types). The
// app's imports leave out ".ts", so a resolve hook adds it, and the sources load as ES modules.
// IndexedDB doesn't exist here, so the map lives in memory only.
// Run with `node --test tests/knowledge.test.mjs`.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (err) {
        if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context);
        throw err;
      }
    }
    export async function load(url, context, next) {
      return next(url, url.endsWith(".ts") ? { ...context, format: "module-typescript" } : context);
    }
  `)}`,
  import.meta.url,
);

const knowledge = await import("../src/lib/knowledge.ts");
const { parsePrerequisiteMap, parseTraceRequest } = await import("../src/lib/prerequisite-map.ts");
const { applyMap, clearKnowledge, conceptKey, describeRecord, findConcept, knownForMapper, masteryLevel, masteryOf, recordCheck } =
  knowledge;

const where = (courseId) => ({ courseId, conversationId: "chat1" });
const courseName = (id) => ({ calc: "MATH 2551", phys: "PHYS 2212" })[id] ?? null;
const prerequisite = (name, requiredBy = [], likelihood = "possible") => ({
  name,
  summary: "",
  required_by: requiredBy,
  why: `needed for ${requiredBy[0] ?? "the target"}`,
  diagnostic_question: "?",
  right_answer_shows: "",
  likelihood,
  search_query: name,
});
const mapOf = (target, prerequisites) =>
  parsePrerequisiteMap({ target: { name: target, summary: "" }, prerequisites, most_likely_gap: "", reasoning: "" });

test("names of the same concept share a key; different concepts don't", () => {
  assert.equal(conceptKey("Double integrals in polar coordinates"), conceptKey("double integral, polar coordinates"));
  assert.equal(conceptKey("Gauss's law"), conceptKey("Gauss law"));
  assert.equal(conceptKey("Polar coordinates: double integrals"), conceptKey("Double integrals in polar coordinates"));
  assert.notEqual(conceptKey("Double integrals"), conceptKey("Double integrals in polar coordinates"));
  assert.equal(conceptKey("  ...  "), "");
});

test("a map adds concepts once and links what builds on what", async () => {
  await clearKnowledge();
  const first = await applyMap(
    mapOf("Electric flux through a surface", [
      prerequisite("Double integrals in polar coordinates", ["Electric flux through a surface"], "likely"),
      prerequisite("Arc length on a circle", ["Double integrals in polar coordinates"]),
      prerequisite("Dot product"), // no required_by: the target needs it
      prerequisite("Electric flux through a surface"), // the target itself: skipped
    ]),
  );
  assert.equal(first.nodes.length, 3);
  const flux = findConcept("electric flux through surfaces");
  const polar = findConcept("Double integral in polar coordinates");
  const arc = findConcept("Arc length on a circle");
  const dot = findConcept("Dot product");
  assert.deepEqual(flux.prerequisites.map((p) => p.id).sort(), [dot.id, polar.id].sort());
  assert.deepEqual(polar.prerequisites.map((p) => p.id), [arc.id]);

  // The same concept from another map (another course's chat) is the same node.
  const second = await applyMap(mapOf("Gauss's law", [prerequisite("Double integrals in polar coordinates", ["Gauss's law"])]));
  assert.equal(second.nodes[0].concept.id, polar.id);
});

test("a map can't make a concept build on itself", async () => {
  await clearKnowledge();
  await applyMap(mapOf("A concept", [prerequisite("B concept", ["A concept"])]));
  await applyMap(mapOf("B concept", [prerequisite("A concept", ["B concept"])]));
  assert.deepEqual(findConcept("B concept").prerequisites, []);
  assert.equal(findConcept("A concept").prerequisites.length, 1);
});

test("answer checks become a record across courses", async () => {
  await clearKnowledge();
  const polar = "Double integrals in polar coordinates";
  await recordCheck(
    [
      { name: polar, role: "practiced", outcome: "error", misconception: "Thinks dA = dr dθ." },
      { name: "double integral in polar coordinates", role: "practiced", outcome: "shown", misconception: "" }, // same concept: counted once
      { name: "Area of a circle", role: "prerequisite", outcome: "not_reached", misconception: "" },
    ],
    where("calc"),
  );
  await recordCheck([{ name: polar, role: "prerequisite", outcome: "error", misconception: "Forgets the Jacobian r." }], where("phys"));

  const record = masteryOf(findConcept(polar).id);
  assert.equal(record.checks, 2);
  assert.equal(record.errors, 2);
  assert.deepEqual(record.courseIds, ["calc", "phys"]);
  assert.equal(masteryLevel(record), "gap");
  const text = describeRecord(record, courseName);
  assert.match(text, /^likely a gap: errors in 2 of 2 answer checks, in MATH 2551 and PHYS 2212 \(latest just now\)/);
  assert.match(text, /misconception noted: Forgets the Jacobian r$/);

  // Not reached: in the map, but no evidence.
  assert.equal(masteryOf(findConcept("Area of a circle").id).checks, 0);
  assert.equal(describeRecord(masteryOf(findConcept("Area of a circle").id), courseName), "no answer checks on it yet");
});

test("right answers build a record of knowing it", async () => {
  await clearKnowledge();
  const shown = { name: "Dot product", role: "prerequisite", outcome: "shown", misconception: "" };
  await recordCheck([shown], where("calc"));
  await recordCheck([shown], where("phys"));
  const record = masteryOf(findConcept("Dot product").id);
  assert.equal(masteryLevel(record), "known");
  assert.match(describeRecord(record, courseName), /^likely known: shown correctly in all 2 answer checks/);
});

test("the mapper sees nearby concepts and past errors in full, the rest by name", async () => {
  await clearKnowledge();
  await applyMap(mapOf("Electric flux through a surface", [prerequisite("Dot product", ["Electric flux through a surface"])]));
  await recordCheck(
    [{ name: "Chain rule", role: "prerequisite", outcome: "error", misconception: "Drops the inner derivative." }],
    where("calc"),
  );
  await recordCheck([{ name: "Ideal gas law", role: "practiced", outcome: "shown", misconception: "" }], where("chem"));

  const known = await knownForMapper({ concept: "Electric flux through a surface" }, courseName);
  const byName = Object.fromEntries(known.map((k) => [k.name, k]));
  assert.deepEqual(byName["Electric flux through a surface"].buildsOn, ["Dot product"]);
  assert.match(byName["Chain rule"].record, /^likely a gap/); // a past error, though unrelated by name
  assert.deepEqual(byName["Ideal gas law"], { name: "Ideal gas law" }); // unrelated: name only
});

test("the mapper's output and the browser's request are checked", () => {
  const map = parsePrerequisiteMap({
    target: { name: "  Flux  ", summary: "x" },
    prerequisites: [
      { name: "Dot product", required_by: ["Flux", 4], likelihood: "very likely", diagnostic_question: "q" },
      { name: "" },
      "junk",
    ],
    most_likely_gap: "Dot product",
    reasoning: "r",
  });
  assert.equal(map.target.name, "Flux");
  assert.equal(map.prerequisites.length, 1);
  assert.deepEqual(map.prerequisites[0].requiredBy, ["Flux"]);
  assert.equal(map.prerequisites[0].likelihood, "possible"); // unknown values fall back
  assert.equal(map.prerequisites[0].diagnostic, "q");
  assert.equal(parsePrerequisiteMap({ prerequisites: [] }), null);

  assert.match(parseTraceRequest({ input: {} }), /concept/);
  const request = parseTraceRequest({
    input: { concept: "Flux", context: "  saw an error  " },
    course: "",
    courses: [{ name: "PHYS", outline: "Week 1" }, { outline: "nameless" }],
    known: [{ name: "Dot product", record: "likely known", buildsOn: ["Vectors", 3] }, { record: "nameless" }],
  });
  assert.equal(request.input.context, "saw an error");
  assert.equal(request.course, null);
  assert.deepEqual(request.courses, [{ name: "PHYS", outline: "Week 1" }]);
  assert.deepEqual(request.known, [{ name: "Dot product", record: "likely known", buildsOn: ["Vectors"] }]);
});
