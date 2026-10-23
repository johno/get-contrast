// The historical `contrast <color1> [color2]` invocation. Its observable
// behavior (stdout, stderr, exit status, and the uncaught TypeError for bad
// input) is frozen by the v3 golden compatibility suite; do not "improve" it.
// New behavior belongs in the explicit commands.

/** @returns {number} exit code */
function runLegacy(lib, argv, io) {
  if (argv.length <= 2) {
    io.stderr.write("usage: contrast <color1> [color2 (default: #fff)]\n");
    return 0;
  }

  const color1 = argv[2];
  const color2 = argv[3] || "#fff";

  // Invalid colors throw here on purpose: v3 let the TypeError escape.
  io.stdout.write(`Ratio: ${lib.ratio(color1, color2)}\n`);
  io.stdout.write(`Score: ${lib.score(color1, color2)}\n`);

  if (!lib.isAccessible(color1, color2)) {
    io.stdout.write("The contrast is not accessible.\n");
    return 1;
  }
  return 0;
}

module.exports = { runLegacy };
