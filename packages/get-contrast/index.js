// Entry point. Re-exports the legacy API from the compiled sources under
// dist/ as plain CommonJS properties, so that:
//  - `require("get-contrast")` returns exactly { ratio, score, isAccessible,
//    isNotTransparent } with no `__esModule` marker (default imports of the
//    module keep working in transpiled code), and
//  - Node can detect the named exports for ESM `import { ratio } from ...`.
const legacy = require("./dist/index.js");

module.exports.ratio = legacy.ratio;
module.exports.score = legacy.score;
module.exports.isAccessible = legacy.isAccessible;
module.exports.isNotTransparent = legacy.isNotTransparent;
