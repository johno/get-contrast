// Regenerates compat/fixtures/*.json from the implementation in this checkout.
// Only run this when a behavior change is intentional and reviewed; the
// resulting fixture diff is the record of what changed.
//   bun run compat:update
const fs = require("node:fs");
const path = require("node:path");
const { root, buildApiFixture, buildCliFixture } = require("./harness");

const dir = path.join(__dirname, "fixtures");
fs.mkdirSync(dir, { recursive: true });

const write = (name, data) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + "\n");

write("api.json", buildApiFixture(require(root)));
write("cli.json", buildCliFixture());
