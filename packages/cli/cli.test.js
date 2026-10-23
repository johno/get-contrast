const { test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// bin.js loads the workspace get-contrast package, which must be built.
require("../get-contrast/scripts/ensure-build");

const bin = path.join(__dirname, "bin.js");
const run = (...args) => spawnSync("node", [bin, ...args], { encoding: "utf8" });

test("prints ratio and score and exits 0 when accessible", () => {
  const r = run("#000", "#fff");
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("Ratio: 21\nScore: AAA\n");
  expect(r.stderr).toBe("");
});

test("defaults the second color to #fff and exits 1 when inaccessible", () => {
  const r = run("#777");
  expect(r.status).toBe(1);
  expect(r.stdout).toBe(
    "Ratio: 4.478089453577214\nScore: AA Large\nThe contrast is not accessible.\n"
  );
});

test("prints usage to stderr and exits 0 with no arguments", () => {
  const r = run();
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("usage: contrast <color1> [color2 (default: #fff)]\n");
});
