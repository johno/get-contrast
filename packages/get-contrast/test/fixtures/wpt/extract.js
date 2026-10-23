// Regenerates wpt-color.json from a directory of web-platform-tests files:
//   node extract.js <dir containing css/css-color/parsing/*.html copies> <wpt commit sha>
// Not run by the test suite (tests read the committed JSON, no network).
// Source: https://github.com/web-platform-tests/wpt/tree/master/css/css-color/parsing
// WPT is distributed under the 3-Clause BSD license; see ../wpt/README.md.
const fs = require("node:fs");
const path = require("node:path");

const [dir, sha] = process.argv.slice(2);
if (!dir || !sha) throw new Error("usage: node extract.js <dir> <sha>");

const FILES = [
  "color-valid", "color-invalid",
  "color-valid-rgb", "color-invalid-rgb",
  "color-valid-hsl", "color-invalid-hsl",
  "color-valid-hwb", "color-invalid-hwb",
  "color-valid-lab", "color-invalid-lab",
  "color-valid-color-function", "color-invalid-color-function",
  "color-invalid-hex-color", "color-invalid-named-color",
  "color-computed-rgb", "color-computed-hsl", "color-computed-hwb",
  "color-computed-lab", "color-computed-hex-color", "color-computed-named-color",
  "color-computed-color-function",
];

const unescape = (s) => JSON.parse(`"${s}"`);
const entries = [];

for (const name of FILES) {
  const kind = name.includes("invalid") ? "invalid" : name.includes("valid") ? "valid" : "computed";
  const lines = fs.readFileSync(path.join(dir, name + ".html"), "utf8").split("\n");
  const constants = {};
  let loop = null; // { var: [values] } for the current `for (const colorSpace of ...)` block
  const spaceLists = (text) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  for (const line of lines) {
    const constant = line.match(/^const ([A-Z_]+) = \[(.*)\];/);
    if (constant) constants[constant[1]] = spaceLists(constant[2]);

    const loopStart = line.match(/^for \(const colorSpace of (.*)\) \{$/);
    if (loopStart) {
      const spec = loopStart[1].trim();
      loop = spec.startsWith("[...")
        ? [...spec.matchAll(/\.\.\.([A-Z_]+)/g)].flatMap((m) => constants[m[1]] || [])
        : spec.startsWith("[")
        ? spaceLists(spec)
        : constants[spec] || [];
      continue;
    }
    if (line === "}") loop = null;

    // test_xxx_value("color", `a`[, `b`]) or with plain strings
    const call = line.match(/test_(valid|invalid|computed)_value\(\s*"color",\s*(["`])((?:\\.|(?!\2).)*)\2(?:,\s*(["`])((?:\\.|(?!\4).)*)\4)?/);
    if (call) {
      const expand = (tpl, space) =>
        tpl.replace(/\$\{colorSpace\}/g, space).replace(/\$\{resultColorSpace\}/g, space === "xyz" ? "xyz-d65" : space);
      const spaces = loop && /\$\{/.test(call[3] + (call[5] || "")) ? loop : [null];
      for (const space of spaces) {
        entries.push([kind, expand(call[3], space), call[5] === undefined ? null : expand(call[5], space), name]);
      }
      continue;
    }

    // ["input", "expected" | "reason", ...] rows
    const row = line.match(/^\s*\["((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/);
    if (row) {
      entries.push([kind, unescape(row[1]), kind === "invalid" ? null : unescape(row[2]), name]);
    }
  }
}

// color-computed-hsl.html is ~3,700 near-duplicate rows; keep every 10th.
let hslSeen = 0;
for (let i = entries.length - 1; i >= 0; i--) {
  if (entries[i][3] === "color-computed-hsl" && hslSeen++ % 10 !== 0) entries.splice(i, 1);
}

const out = {
  source: "https://github.com/web-platform-tests/wpt/tree/" + sha + "/css/css-color/parsing",
  license: "BSD-3-Clause (web-platform-tests)",
  note: "Rows are [kind, input, expected|null, file]. kind is valid|invalid|computed.",
  rows: entries,
};
fs.writeFileSync(path.join(__dirname, "wpt-color.json"), JSON.stringify(out) .replace(/\],\[/g, "],\n[") + "\n");
console.log(entries.length, "rows");
