// Legacy `contrast <color1> [color2]` command. Takes the library as an
// argument so the same file can run against the workspace package (here) and
// against the sibling index.js inside the published get-contrast tarball.
module.exports = function run(contrast, argv) {
  if (argv.length <= 2) {
    console.error("usage: contrast <color1> [color2 (default: #fff)]");
    process.exit();
  }

  const color1 = argv[2];
  const color2 = argv[3] || "#fff";

  console.log("Ratio:", contrast.ratio(color1, color2));
  console.log("Score:", contrast.score(color1, color2));

  if (!contrast.isAccessible(color1, color2)) {
    console.log("The contrast is not accessible.");
    process.exit(1);
  }
};
