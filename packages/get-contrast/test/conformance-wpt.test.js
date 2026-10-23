// Conformance against browser behavior: CSS Color tests from web-platform-tests
// (see fixtures/wpt/README.md for provenance and license). Each fixture file
// is one test; a failure lists the syntax, input, and expected value of the
// offending rows. Separate from the v3 compatibility suite in compat/.
const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const { parseColor, convert } = require("../dist/cjs/color/index.js");
const fixture = require("./fixtures/wpt/wpt-color.json");

// Syntax the engine intentionally does not support. These rows are not
// compared for value; supported-looking ones must at least be REJECTED
// (never silently misparsed).
const UNSUPPORTED = [
  [/calc\(|var\(|env\(/i, "math functions and variables"],
  [/\bfrom\b/i, "relative color syntax"],
  [/color-mix|light-dark|contrast-color/i, "color-mix(), light-dark(), contrast-color()"],
  [/currentcolor/i, "context-dependent keywords"],
  [/a98-rgb|rec2020|prophoto-rgb|display-p3-linear/i, "color() spaces beyond the supported set"],
  [/infinity|\bnan\b/i, "calc keywords"],
  [/\/\*/, "CSS comments"],
  [/\\/, "CSS escapes in identifiers"],
];
const unsupportedReason = (row) =>
  (UNSUPPORTED.find(([re]) => re.test(row[1]) || (row[2] && re.test(row[2]))) || [])[1];

function decimals(expected) {
  const found = expected.match(/\d*\.(\d+)/g) || [];
  return Math.max(0, ...found.map((f) => f.split(".")[1].length));
}

const HUE = { hsl: 0, hwb: 0, lch: 2, oklch: 2 };

/** Why `actual` does not match the parsed `expected` string, or null if it does. */
function mismatch(input, expectedText, actual) {
  const expected = parseColor(expectedText);
  if (!expected.ok) return null; // expected form we cannot parse: nothing to compare
  const want = expected.color;
  const got = convert(actual, want.space);
  // Browsers serialize rgb() computed values as 8-bit integers; everything else
  // keeps at most the printed precision.
  const integerRgb = /^rgba?\(\s*\d+,\s*\d+,\s*\d+/.test(expectedText);
  const tolerance = integerRgb ? 0.5 / 255 + 1e-9 : Math.max(2e-6, 0.6 * Math.pow(10, -decimals(expectedText)));
  const alphaTolerance = integerRgb ? 0.005 : 1e-6;
  const bad = [];
  got.coords.forEach((value, i) => {
    let delta = Math.abs(value - want.coords[i]);
    if (HUE[want.space] === i) delta = Math.min(delta, 360 - delta);
    // percentage-scaled spaces print fewer significant digits relative to range
    const scale = !integerRgb && ["hsl", "hwb", "lab", "lch"].includes(want.space) && HUE[want.space] !== i ? 10 : 1;
    if (delta > tolerance * scale) bad.push(`component ${i}: got ${value}, want ${want.coords[i]}`);
  });
  if (Math.abs(got.alpha - want.alpha) > alphaTolerance) bad.push(`alpha: got ${got.alpha}, want ${want.alpha}`);
  return bad.length ? bad.join("; ") : null;
}

const byFile = new Map();
for (const row of fixture.rows) {
  if (!byFile.has(row[3])) byFile.set(row[3], []);
  byFile.get(row[3]).push(row);
}

function report(file, failures) {
  if (failures.length === 0) return;
  throw new Error(
    `${failures.length} ${file} rows disagree with browsers:\n` +
      failures.slice(0, 20).map((f) => `  ${f}`).join("\n") +
      (failures.length > 20 ? `\n  ... and ${failures.length - 20} more` : "")
  );
}

describe("web-platform-tests CSS Color conformance", () => {
  test("fixture is present and covers every syntax", () => {
    expect(fixture.rows.length).toBeGreaterThan(2000);
    for (const f of ["color-valid-rgb", "color-valid-hsl", "color-valid-hwb", "color-valid-lab", "color-valid-color-function", "color-invalid-rgb", "color-invalid-hsl", "color-invalid-hwb", "color-invalid-lab", "color-invalid-color-function", "color-invalid-named-color", "color-invalid-hex-color", "color-computed-named-color", "color-computed-hex-color"]) {
      expect(byFile.has(f)).toBe(true);
    }
  });

  for (const [file, rows] of byFile) {
    test(file, () => {
      const failures = [];
      for (const row of rows) {
        const [kind, input, expectedText] = row;
        const result = parseColor(input);
        const unsupported = unsupportedReason(row);

        if (kind === "invalid") {
          if (result.ok) failures.push(`accepted invalid input ${JSON.stringify(input)}`);
          continue;
        }
        if (unsupported) {
          // Valid CSS we do not support must fail loudly, not misparse.
          if (result.ok) failures.push(`unsupported (${unsupported}) but parsed: ${JSON.stringify(input)}`);
          continue;
        }
        if (!result.ok) {
          failures.push(`rejected valid input ${JSON.stringify(input)}: ${result.error.code}: ${result.error.message}`);
          continue;
        }
        if (expectedText) {
          const why = mismatch(input, expectedText, result.color);
          if (why) failures.push(`${JSON.stringify(input)} -> expected ${JSON.stringify(expectedText)}; ${why}`);
        }
      }
      report(file, failures);
    });
  }
});
