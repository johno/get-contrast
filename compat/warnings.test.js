const { describe, test, expect, beforeEach } = require("bun:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const warnings = require("../warnings");
const { root, buildApiFixture } = require("./harness");

const contrast = require(root);

beforeEach(() => {
  warnings.reset();
  delete process.env[warnings.ENV_VAR];
});

function collect() {
  const seen = [];
  warnings.configure({ onWarning: (w) => seen.push(w) });
  return seen;
}

describe("warn()", () => {
  test("delivers a warning with code and message", () => {
    const seen = collect();
    expect(warnings.warn("GC_TEST", "hello")).toBe(true);
    expect(seen).toEqual([{ code: "GC_TEST", message: "hello" }]);
  });

  test("emits each code at most once per process", () => {
    const seen = collect();
    expect(warnings.warn("GC_A", "one")).toBe(true);
    expect(warnings.warn("GC_A", "again")).toBe(false);
    expect(warnings.warn("GC_B", "other")).toBe(true);
    expect(seen.map((w) => w.code)).toEqual(["GC_A", "GC_B"]);
  });

  test("configure({ enabled: false }) suppresses and does not consume the code", () => {
    const seen = collect();
    warnings.configure({ enabled: false });
    expect(warnings.warn("GC_A", "x")).toBe(false);
    warnings.configure({ enabled: true });
    expect(warnings.warn("GC_A", "x")).toBe(true);
    expect(seen).toHaveLength(1);
  });

  test("environment variable suppresses", () => {
    const seen = collect();
    process.env[warnings.ENV_VAR] = "1";
    expect(warnings.warn("GC_A", "x")).toBe(false);
    for (const off of ["", "0", "false"]) {
      process.env[warnings.ENV_VAR] = off;
      expect(warnings.warn(`GC_${off || "EMPTY"}`, "x")).toBe(true);
    }
    expect(seen).toHaveLength(3);
  });

  test("default handler writes one line to stderr and nothing to stdout", () => {
    const script = `require(${JSON.stringify(path.join(root, "warnings"))}).warn("GC_X", "msg")`;
    const r = spawnSync("node", ["-e", script], { encoding: "utf8" });
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("get-contrast: [GC_X] msg\n");
    const quiet = spawnSync("node", ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, [warnings.ENV_VAR]: "1" },
    });
    expect(quiet.stderr).toBe("");
  });

  test("reset() restores defaults", () => {
    collect();
    warnings.warn("GC_A", "x");
    warnings.configure({ enabled: false });
    warnings.reset();
    const seen = collect();
    expect(warnings.warn("GC_A", "x")).toBe(true);
    expect(seen).toHaveLength(1);
  });
});

describe("legacy API and warnings", () => {
  test("v3 calls emit no warnings (no blanket deprecation)", () => {
    const seen = collect();
    buildApiFixture(contrast);
    expect(seen).toEqual([]);
  });

  test("results are identical with warnings enabled and suppressed", () => {
    const enabled = buildApiFixture(contrast);
    process.env[warnings.ENV_VAR] = "1";
    warnings.configure({ enabled: false });
    expect(buildApiFixture(contrast)).toEqual(enabled);
  });

  test("main export shape is unchanged by the warning helper", () => {
    expect(Object.keys(contrast).sort()).toEqual([
      "isAccessible",
      "isNotTransparent",
      "ratio",
      "score",
    ]);
  });
});
