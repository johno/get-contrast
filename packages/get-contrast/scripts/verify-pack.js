// Packs the package, inspects the tarball, installs it into a clean temporary
// project, and exercises the library and the CLI the way consumers do.
//   node scripts/verify-pack.js
// Run by `prepublishOnly` and CI. Exits non-zero with a reason on any problem.
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pkgRoot = path.join(__dirname, "..");
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "get-contrast-pack-"));
const run = (cmd, args, options = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", cwd: tmp, ...options });

try {
  // 1. Pack and inspect the file list.
  const out = execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], {
    cwd: pkgRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [packed] = JSON.parse(out.slice(out.indexOf("[")));
  const files = packed.files.map((f) => f.path).sort();

  const required = [
    "package.json",
    "readme.md",
    "license",
    "index.js",
    "warnings.js",
    "cli.js",
    "cli-src/run.js",
    "dist/cjs/index.js",
    "dist/cjs/index.d.ts",
    "dist/esm/index.js",
    "dist/esm/index.d.ts",
    "dist/esm/package.json",
  ];
  for (const f of required) check(files.includes(f), `tarball is missing ${f}`);

  const allowed = [
    /^(package\.json|readme\.md|license|index\.js|warnings\.js|cli\.js)$/,
    /^cli-src\/[\w.-]+\.js$/,
    /^dist\/(cjs|esm)\/([\w-]+\/)*[\w.-]+\.(js|d\.ts)$/,
    /^dist\/esm\/package\.json$/,
  ];
  for (const f of files) {
    check(allowed.some((re) => re.test(f)), `unexpected file in tarball: ${f}`);
  }
  check(!files.some((f) => /\.map$|\.tsbuildinfo$|^src\/|^test\/|^compat\//.test(f)), "source, tests, or maps leaked into tarball");
  check(!files.includes("dist/esm/index.esm.js"), "dist/esm/index.esm.js should have been renamed");

  // 2. Runtime dependency policy.
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOzf", path.join(tmp, packed.filename), "package/package.json"], {
      encoding: "utf8",
    })
  );
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    check(Object.keys(manifest[field] || {}).length === 0, `tarball declares ${field}`);
  }
  check(manifest.name === "get-contrast", "package name must stay get-contrast");
  check(manifest.bin && manifest.bin.contrast === "./cli.js", "bin `contrast` must stay ./cli.js");

  // 3. Install into a clean project (zero dependencies, so no network needed).
  const project = path.join(tmp, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "package.json"), '{"name":"smoke","private":true}\n');
  const install = run("npm", ["install", "--no-audit", "--no-fund", path.join(tmp, packed.filename)], { cwd: project });
  check(install.status === 0, `npm install failed:\n${install.stderr}`);
  const installed = fs.readdirSync(path.join(project, "node_modules")).filter((n) => !n.startsWith("."));
  check(installed.join() === "get-contrast", `expected only get-contrast installed, got: ${installed}`);

  const inProject = (cmd, args, options = {}) => run(cmd, args, { cwd: project, ...options });
  const expectOk = (label, r, stdout) => {
    check(r.status === 0, `${label} failed (exit ${r.status}): ${r.stderr}`);
    if (stdout !== undefined) check(r.stdout.trim() === stdout, `${label}: expected ${JSON.stringify(stdout)}, got ${JSON.stringify(r.stdout.trim())}`);
  };

  // 4. Legacy CommonJS import: exact v3 shape.
  expectOk(
    "node require",
    inProject("node", ["-e", 'const c=require("get-contrast");console.log(Object.keys(c).slice(0,4).join(),"__esModule" in c,c.ratio("#000","#fff"),c.score("#777","#fff"),c.check("#000","#fff").target.passes)']),
    "ratio,score,isAccessible,isNotTransparent false 21 AA Large true"
  );
  expectOk("node require subpath", inProject("node", ["-e", 'console.log(typeof require("get-contrast/warnings").warn, require("get-contrast/package.json").name)']), "function get-contrast");

  // 5. ESM, resolved through the exports map.
  expectOk(
    "node import",
    inProject("node", ["--input-type=module", "-e", 'import c, { ratio, check } from "get-contrast"; import { warn } from "get-contrast/warnings"; console.log(ratio("#000","#fff"), typeof c.score, typeof warn, check("#767676","#fff").ratioText)']),
    "21 function function 4.54:1"
  );

  // 6. Bun, when available (CI installs it; local runs may not have it).
  const bun = run("bun", ["--version"]);
  if (bun.status === 0) {
    expectOk("bun import", inProject("bun", ["-e", 'import c, { ratio } from "get-contrast"; console.log(ratio("#000","#fff"), typeof c.score)']), "21 function");
    expectOk("bun require", inProject("bun", ["-e", 'console.log(require("get-contrast").ratio("#000","#fff"))']), "21");
  }

  // 7. The contrast binary.
  const bin = path.join(project, "node_modules", ".bin", "contrast");
  const ok = inProject(bin, ["#000", "#fff"]);
  check(ok.status === 0 && ok.stdout === "Ratio: 21\nScore: AAA\n" && ok.stderr === "", `contrast #000 #fff: ${JSON.stringify(ok)}`);
  const checkRun = inProject(bin, ["check", "#767676", "white"]);
  check(checkRun.status === 0 && checkRun.stdout.includes("Contrast ratio  4.54:1") && checkRun.stderr === "", `contrast check: ${JSON.stringify(checkRun)}`);
  const fixed = inProject(bin, ["fix", "#777777", "#ffffff"]);
  check(fixed.status === 0 && fixed.stdout.startsWith("Suggested #767676"), `contrast fix: ${JSON.stringify(fixed)}`);
  const failing = inProject(bin, ["check", "#777", "#fff"]);
  check(failing.status === 1, `contrast check (failing) should exit 1: ${JSON.stringify(failing)}`);
  const invalid = inProject(bin, ["check", "nope", "#fff"]);
  check(invalid.status === 2 && invalid.stdout === "" && invalid.stderr.startsWith("error: "), `contrast check (invalid) should exit 2: ${JSON.stringify(invalid)}`);
  const asJson = inProject(bin, ["check", "#767676", "white", "--json"]);
  let envelope = null;
  try {
    envelope = JSON.parse(asJson.stdout);
  } catch {}
  check(asJson.status === 0 && asJson.stderr === "" && envelope && envelope.schema === 1 && envelope.result.ratio > 4.5, `contrast check --json: ${JSON.stringify(asJson)}`);
  const piped = inProject(bin, ["pick", "white", "-"], { input: "#111111\n#767676\n" });
  check(piped.status === 0 && piped.stdout.includes("Winner: #111111"), `contrast pick (stdin): ${JSON.stringify(piped)}`);
  const quiet = inProject(bin, ["check", "#777", "#fff", "--quiet"]);
  check(quiet.status === 1 && quiet.stdout === "" && quiet.stderr === "", `contrast check --quiet: ${JSON.stringify(quiet)}`);
  const version = inProject(bin, ["--version"]);
  check(version.stdout.trim() === manifest.version, `contrast --version: ${JSON.stringify(version)}`);
  const bad = inProject(bin, ["#777"]);
  check(bad.status === 1 && bad.stdout.endsWith("The contrast is not accessible.\n"), `contrast #777: ${JSON.stringify(bad)}`);

  // 8. Types resolve for CJS and ESM consumers under each resolution mode.
  const tsc = require.resolve("typescript/bin/tsc", { paths: [pkgRoot] });
  fs.writeFileSync(
    path.join(project, "types.ts"),
    [
      'import { ratio, score, isAccessible, isNotTransparent } from "get-contrast";',
      'import { configure } from "get-contrast/warnings";',
      'import { check } from "get-contrast";',
      'const n: number = ratio("#000", "#fff");',
      'const passes: boolean = check("#000", "#fff", { level: "AAA" }).target.passes;',
      'const s: "AAA" | "AA" | "AA Large" | "Fail" = score("#000", "#fff");',
      "configure({ enabled: false });",
      "export { n, s, passes, isAccessible, isNotTransparent };",
    ].join("\n") + "\n"
  );
  const modes = [
    ["node10", "commonjs"],
    ["bundler", "esnext"],
    ["node16", "node16"],
  ];
  for (const [resolution, module] of modes) {
    const r = inProject(process.execPath, [tsc, "--noEmit", "--strict", "--skipLibCheck", "--esModuleInterop", "--moduleResolution", resolution, "--module", module, "types.ts"]);
    check(r.status === 0, `tsc (${resolution}) failed:\n${r.stdout}${r.stderr}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error("verify-pack failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("verify-pack ok");
