const COMMANDS = ["check", "wcag", "pick", "find", "fix"];

const COLOR_FLAGS = `  --json                 Print one JSON document (the library's result) instead of a report
  --quiet                Print nothing; the exit code is the result (not with --json)
  --color / --no-color   Force or disable ANSI colors (default: only on a terminal)
  --no-warnings          Suppress warnings (also: GET_CONTRAST_NO_WARNINGS=1)`;

const TARGET_FLAGS = `  --level AA|AAA         WCAG level to hold the pair to (default: AA)
  --use text|large-text|ui
                         What the color is used for (default: text)
                           text        body text            AA 4.5:1   AAA 7:1
                           large-text  18pt+ or 14pt+ bold  AA 3:1     AAA 4.5:1
                           ui          UI components        3:1
  --min-ratio N          A custom minimum ratio (1-21); replaces --level/--use
  --backdrop COLOR       Opaque color behind a translucent background (default: #ffffff)`;

const SOLVER_FLAGS = `  --direction auto|darker|lighter
                         Which way to move lightness (default: auto, the smaller change)
  --no-preserve-chroma   Allow lowering chroma if it reaches the target with less change
  --gamut srgb|display-p3
                         Gamut the suggestion must fit (default: srgb)
  --max-change N         Largest allowed perceptual change (OKLab distance; black to white is 1)`;

const HELP = {
  check: `Usage: contrast check <foreground> <background> [options]

Check a color pair against WCAG 2.2: the contrast ratio, every level and use,
and whether it meets your target. Exits 0 if the target is met, 1 if not.

Options:
${TARGET_FLAGS}
${COLOR_FLAGS}

Example:
  contrast check "#767676" white --level AAA --use large-text`,

  wcag: `Usage: contrast wcag <foreground> <background> [options]

Print the WCAG 2.2 contrast ratio and what was measured (translucent colors are
composited like a browser). No pass/fail judgment; exits 0.

Options:
  --backdrop COLOR       Opaque color behind a translucent background (default: #ffffff)
${COLOR_FLAGS}`,

  pick: `Usage: contrast pick <background> <candidate...> [options]

Rank candidate foreground colors on a background and pick the best one that
meets the target (highest contrast; ties keep command-line order). Exits 0 if one
meets the target, 1 if none does.

Pass "-" as the only candidate to read them from stdin: a JSON array of colors
or { "name", "color" } objects, or one color per line.

Options:
${TARGET_FLAGS}
${COLOR_FLAGS}

Example:
  contrast pick white "#767676" "#111" "#ddd" --level AAA
  printf '#111\n#767676\n' | contrast pick white - --json`,

  find: `Usage: contrast find <color> --against <color> [options]

Find the smallest change to <color> that meets the target against the other
color. <color> is the foreground unless you pass --role background. Exits 0 if
the target is met (or already was), 1 if it cannot be.

Options:
  --against COLOR        The color that stays fixed (required)
  --role foreground|background
                         Which side <color> is (default: foreground)
${TARGET_FLAGS}
${SOLVER_FLAGS}
${COLOR_FLAGS}

Example:
  contrast find "#777" --against white`,

  fix: `Usage: contrast fix <foreground> <background> [options]

Like "find", for a foreground/background pair: suggests the smallest change to
make it meet the target. Exits 0 if the target is met (or already was), 1 if not.

Options:
  --change foreground|background
                         Which color may change (default: foreground)
${TARGET_FLAGS}
${SOLVER_FLAGS}
${COLOR_FLAGS}

Example:
  contrast fix "#ffcc00" white --level AA`,
};

function mainHelp(version) {
  return `contrast ${version ? version : ""}
Color contrast for the command line.

Usage:
  contrast <color1> [color2]        Ratio and score (color2 defaults to #fff)
  contrast <command> [options]

Commands:
  check <fg> <bg>                   WCAG 2.2 report for a pair
  wcag <fg> <bg>                    The contrast ratio and what was measured
  pick <bg> <candidate...>          Choose the best existing color
  find <color> --against <color>    Smallest change that meets a target
  fix <fg> <bg>                     Same, for a foreground/background pair
  help [command]                    Show help

Run "contrast help <command>" for options. Exit codes: 0 success or target met,
1 target not met, 2 bad usage or an unusable color, 3 unexpected failure.

Colors can be hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(),
color(display-p3 ...), or a named color.
`;
}

module.exports = { COMMANDS, HELP, mainHelp };
