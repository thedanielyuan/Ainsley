// Offline check that an eval run can't start unapproved: no server, no API calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../run.mjs", import.meta.url));
const run = (...args) => execFileSync(process.execPath, [runner, ...args], { input: "", encoding: "utf8", stdio: "pipe" });
const refused = (err) => err.status === 2 && /Not started/.test(err.stderr) && /--approved/.test(err.stderr);

test("with nobody at the terminal, a run without --approved stops before spending anything", () => {
  // The judge suite needs no server, so only the approval gate stands between this and model calls.
  assert.throws(() => run("--suite", "judge"), refused);
  assert.throws(() => run("--suite", "judge", "--only", "none-such"), /No cases match/);
});

test("the usage text needs no approval", () => {
  assert.match(run("--help"), /--approved/);
});
