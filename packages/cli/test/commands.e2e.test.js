// End-to-end tests for the modern commands. Every command is exercised through
// the real binary (stdout, stderr, exit status), plus in-process through run()
// with an injected terminal for the color behavior that spawn() cannot fake.
const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

require("../../get-contrast/scripts/ensure-build");

const lib = require("get-contrast");
const run = require("../src/run");
const bin = path.join(__dirname, "..", "bin.js");
const published = path.join(__dirname, "..", "..", "get-contrast", "cli.js");

const spawn = (script, args, env = {}) => {
  const r = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "", FORCE_COLOR: "", ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const cli = (...args) => spawn(bin, args);
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[/;

function inProcess(args, { tty = false, env = {} } = {}) {
  // env is passed by reference so tests can observe what the CLI sets
  let stdout = "";
  let stderr = "";
  const code = run(lib, ["node", "contrast", ...args], {
    stdout: { write: (s) => (stdout += s), isTTY: tty },
    stderr: { write: (s) => (stderr += s), isTTY: tty },
    env,
    version: "9.9.9",
  });
  return { code, stdout, stderr };
}

describe("dispatch: legacy vs commands", () => {
  test("a color as first argument is the legacy invocation", () => {
    const r = cli("#767676");
    expect(r.stdout).toBe("Ratio: 4.542224959605253\nScore: AA\n");
    expect(r.status).toBe(0);
  });

  test("a command name as first argument is a command", () => {
    expect(cli("check", "#767676", "white").stdout).toContain("Contrast ratio  4.54:1");
  });

  test("the published binary and the workspace binary behave identically", () => {
    for (const args of [["check", "#777", "#fff"], ["wcag", "#000", "#fff"], ["pick", "#fff", "#000", "#ddd"], ["fix", "#777", "#fff"], ["#777"], ["help", "check"]]) {
      expect(spawn(published, args)).toEqual(spawn(bin, args));
    }
  });

  test("help, version, and unknown help topics", () => {
    for (const args of [["--help"], ["-h"], ["help"]]) {
      const r = cli(...args);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout).toContain("check <fg> <bg>");
      expect(r.stdout).toContain("Exit codes: 0 success");
    }
    expect(cli("--version").stdout.trim()).toBe(require("../../get-contrast/package.json").version);
    expect(cli("-v").stdout.trim()).toBe(require("../../get-contrast/package.json").version);
    for (const c of ["check", "wcag", "pick", "find", "fix"]) {
      expect(cli("help", c).stdout).toContain(`Usage: contrast ${c}`);
      expect(cli(c, "--help").stdout).toContain(`Usage: contrast ${c}`);
    }
    const unknown = cli("help", "bogus");
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('no help for "bogus"');
  });
});

describe("contrast check", () => {
  test("a passing pair: report, threshold explanations, exit 0", () => {
    const r = cli("check", "#767676", "white");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      [
        "#767676 on #ffffff",
        "Contrast ratio  4.54:1",
        "",
        "  AA  text          pass   needs 4.5:1",
        "  AA  large text    pass   needs 3:1",
        "  AAA text          fail   needs 7:1",
        "  AAA large text    pass   needs 4.5:1",
        "  UI components     pass   needs 3:1",
        "",
        "Target AA text (4.5:1): PASS",
        "",
      ].join("\n")
    );
  });

  test("a failing target exits 1 and says why", () => {
    const r = cli("check", "#777", "#fff");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Contrast ratio  4.47:1");
    expect(r.stdout).toContain("Target AA text (4.5:1): FAIL");
    expect(r.stderr).toBe("");
  });

  test("--level, --use, and --min-ratio change the target and are explained", () => {
    expect(cli("check", "#767676", "#fff", "--level", "AAA").stdout).toContain("Target AAA text (7:1): FAIL");
    expect(cli("check", "#949494", "#fff", "--use", "large-text").status).toBe(0);
    expect(cli("check", "#949494", "#fff", "--use", "large-text").stdout).toContain("Target AA large text (3:1): PASS");
    expect(cli("check", "#949494", "#fff", "--use=ui").stdout).toContain("UI components (3:1): PASS");
    const custom = cli("check", "#767676", "#fff", "--min-ratio", "5");
    expect(custom.status).toBe(1);
    expect(custom.stdout).toContain("Target custom 5:1: FAIL");
  });

  test("alpha is composited and explained in a note", () => {
    const r = cli("check", "rgba(0,0,0,.75)", "#fafafa");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("#3f3f3f on #fafafa");
    expect(r.stdout).toContain("note The foreground has alpha 0.75");
  });

  test("--backdrop is used for translucent backgrounds", () => {
    const r = cli("check", "#fff", "rgb(0 0 0 / .5)", "--backdrop", "#000");
    expect(r.stdout).toContain("on #000000");
    expect(r.stdout).toContain("21");
  });

  test("modern syntax", () => {
    expect(cli("check", "oklch(0.3 0.05 250)", "lab(98 0 0)").status).toBe(0);
    expect(cli("check", "color(display-p3 0 0 0)", "hsl(0 0% 100%)").status).toBe(0);
  });
});

describe("contrast wcag", () => {
  test("prints the ratio and what was measured; never judges", () => {
    const r = cli("wcag", "#777", "#fff");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      "Contrast ratio  4.48:1  (4.478089453577214)\n" +
        "Foreground      #777777  luminance 0.1845\n" +
        "Background      #ffffff  luminance 1.0000\n"
    );
  });

  test("notes for translucent colors", () => {
    const r = cli("wcag", "rgba(0,0,0,.5)", "#fff");
    expect(r.stdout).toContain("note The foreground has alpha 0.5");
  });
});

describe("contrast pick", () => {
  test("ranks candidates and names the winner; exit 0", () => {
    const r = cli("pick", "#ffffff", "#767676", "#111111", "#dddddd");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        "1. #111111   18.88:1  pass  #111111",
        "2. #767676    4.54:1  pass  #767676",
        "3. #dddddd    1.35:1  fail  #dddddd",
        "",
        "Winner: #111111 has the highest contrast (18.88:1) of the 2 candidates that meet AA text 4.5:1 target.",
        "",
      ].join("\n")
    );
  });

  test("no winner exits 1", () => {
    const r = cli("pick", "#fff", "#ddd", "#eee");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("No winner: None of the 2 candidates");
  });

  test("targets apply and ties keep command-line order", () => {
    expect(cli("pick", "#fff", "#767676", "#595959", "--level", "AAA").stdout).toContain("Winner: #595959 is the only candidate");
    const tie = cli("pick", "#fff", "#000", "black");
    expect(tie.stdout).toContain("1. #000000");
    expect(tie.stdout).toContain("tied on contrast");
  });

  test("needs a background and a candidate", () => {
    const r = cli("pick", "#fff");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("expected a background and at least one candidate");
  });
});

describe("contrast find and fix", () => {
  test("fix suggests the smallest change", () => {
    const r = cli("fix", "#777777", "#ffffff");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        "Suggested #767676  (was #777777)",
        "Contrast  4.54:1  (was 4.47:1)",
        "Change    0.003 perceptual distance  (lightness)",
        "Target met: AA text (4.5:1)",
        "",
      ].join("\n")
    );
  });

  test("find is the same engine with --against", () => {
    expect(cli("find", "#777777", "--against", "#ffffff")).toEqual(cli("fix", "#777777", "#ffffff"));
    const bg = cli("find", "#333333", "--against", "#444444", "--role", "background");
    expect(bg.status).toBe(0);
    expect(bg.stdout).toContain("Suggested #b1b1b1"); // #333 as a background against #444 text
  });

  test("fix --change background", () => {
    const r = cli("fix", "#333333", "#444444", "--change", "background");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("(was #444444)");
  });

  test("already passing: nothing changes, exit 0", () => {
    const r = cli("fix", "#000", "#fff");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("already meets the target");
  });

  test("an unreachable target is reported and exits 1", () => {
    const r = cli("fix", "#999", "#777", "--level", "AAA");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Target not met: AAA text (7:1) (unreachable)");
    expect(r.stdout).toContain("Suggested #000000");
  });

  test("--max-change limits and says so", () => {
    const r = cli("fix", "#ffcc00", "#fff", "--max-change", "0.05");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("limited by --max-change");
  });

  test("solver flags: --direction, --gamut, --no-preserve-chroma", () => {
    expect(cli("fix", "#808080", "#808080", "--use", "large-text", "--direction", "lighter").stdout).toContain("Suggested #");
    expect(cli("fix", "color(display-p3 1 0.8 0)", "#fff", "--gamut", "display-p3").stdout).toContain("Suggested color(display-p3 ");
    expect(cli("fix", "#0000ff", "#101010", "--no-preserve-chroma").status).toBe(0);
  });

  test("find requires --against", () => {
    const r = cli("find", "#777");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("find needs --against <color>");
  });
});

describe("errors and exit codes", () => {
  test("unusable colors: message on stderr, nothing on stdout, exit 2", () => {
    for (const args of [["check", "nope", "#fff"], ["wcag", "#000", ""], ["pick", "#fff", "#000", "nope"], ["fix", "#000", "rgb(from red r g b)"], ["find", "nope", "--against", "#fff"]]) {
      const r = cli(...args);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/^error: /);
      expect(r.stderr).not.toContain("    at "); // no stack traces for user errors
    }
  });

  test("usage errors point to help and exit 2", () => {
    for (const [args, message] of [
      [["check", "#000"], "expected 2 colors"],
      [["check", "#000", "#fff", "#eee"], "expected 2 colors"],
      [["check", "#000", "#fff", "--bogus"], "unknown option --bogus"],
      [["check", "#000", "#fff", "--level"], "--level needs a value"],
      [["check", "#000", "#fff", "--level", "AAAA"], "must be one of: AA, AAA"],
      [["check", "#000", "#fff", "--min-ratio", "30"], "--min-ratio must be a number between 1 and 21"],
      [["check", "#000", "#fff", "--min-ratio", "abc"], "--min-ratio must be a number"],
      [["fix", "#000", "#fff", "--max-change", "-1"], "--max-change must be a number at least 0"],
      [["fix", "#000", "#fff", "--change", "both"], "must be one of: foreground, background"],
      [["wcag", "#000", "#fff", "--level", "AA"], "unknown option --level"],
    ]) {
      const r = cli(...args);
      expect([args.join(" "), r.status]).toEqual([args.join(" "), 2]);
      expect(r.stderr).toContain(message);
      expect(r.stderr).toContain("contrast help");
      expect(r.stdout).toBe("");
    }
  });

  test("a bad --backdrop is a usage-class error (exit 2), not a crash", () => {
    const r = cli("wcag", "#000", "rgb(0 0 0 / .5)", "--backdrop", "nope");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("backdrop");
  });

  test("unexpected internal failures exit 3 with a clear message", () => {
    const broken = { ...lib, check: () => { throw new Error("boom"); } };
    let stderr = "";
    const code = run(broken, ["node", "contrast", "check", "#000", "#fff"], {
      stdout: { write() {} },
      stderr: { write: (s) => (stderr += s) },
      env: {},
    });
    expect(code).toBe(3);
    expect(stderr).toBe("error: unexpected failure: boom\n");
  });
});

describe("terminal output", () => {
  test("piped output has no ANSI codes", () => {
    for (const args of [["check", "#767676", "#fff"], ["wcag", "#000", "#fff"], ["pick", "#fff", "#000"], ["fix", "#777", "#fff"], ["check", "#000", "nope"]]) {
      const r = cli(...args);
      expect(ANSI.test(r.stdout + r.stderr)).toBe(false);
    }
  });

  test("a terminal gets colors; NO_COLOR and --no-color remove them", () => {
    const tty = inProcess(["check", "#767676", "#fff"], { tty: true });
    expect(tty.code).toBe(0);
    expect(ANSI.test(tty.stdout)).toBe(true);
    expect(inProcess(["check", "#767676", "#fff"], { tty: true, env: { NO_COLOR: "1" } }).stdout).not.toMatch(ANSI);
    expect(inProcess(["check", "#767676", "#fff", "--no-color"], { tty: true }).stdout).not.toMatch(ANSI);
    expect(inProcess(["check", "#767676", "#fff", "--color"], { tty: false }).stdout).toMatch(ANSI);
    expect(inProcess(["check", "#767676", "#fff"], { tty: true, env: { TERM: "dumb" } }).stdout).not.toMatch(ANSI);
  });

  test("FORCE_COLOR colors a pipe through the real binary", () => {
    expect(spawn(bin, ["check", "#767676", "#fff"], { FORCE_COLOR: "1" }).stdout).toMatch(ANSI);
  });

  test("colored and plain output differ only by escape codes", () => {
    const colored = inProcess(["fix", "#777", "#fff", "--color"]).stdout;
    const plain = inProcess(["fix", "#777", "#fff", "--no-color"]).stdout;
    expect(colored.replace(/\u001b\[\d+m/g, "")).toBe(plain);
  });

  test("errors are colored on stderr only for a terminal", () => {
    const e = inProcess(["check", "nope", "#fff"], { tty: true });
    expect(e.code).toBe(2);
    expect(e.stderr).toMatch(ANSI);
    expect(e.stdout).toBe("");
  });
});

describe("warnings policy", () => {
  test("--no-warnings sets the suppression variable for the process", () => {
    const env = {};
    const r = inProcess(["check", "#000", "#fff", "--no-warnings"], { env });
    expect(r.code).toBe(0);
    expect(env.GET_CONTRAST_NO_WARNINGS).toBe("1");
  });

  test("commands emit nothing extra on stderr", () => {
    for (const args of [["check", "#000", "#fff"], ["wcag", "#000", "#fff"], ["pick", "#fff", "#000"], ["fix", "#777", "#fff"]]) {
      expect(cli(...args).stderr).toBe("");
    }
  });
});
