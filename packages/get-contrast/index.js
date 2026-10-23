// Entry point. Re-exports the compiled API from dist/cjs as plain CommonJS
// properties, so that:
//  - requiring this package returns a plain object with no `__esModule`
//    marker (default imports of the module keep working in transpiled code),
//    and the four v3 functions are exactly the legacy implementations, and
//  - Node can detect the named exports for ESM `import { ratio } from ...`
//    (it only recognizes `module.exports.name = ...` assignments).
// Keep this list in sync with src/index.ts (test/consumers.test.js checks it).
const api = require("./dist/cjs/index.js");

// v3 API
module.exports.ratio = api.ratio;
module.exports.score = api.score;
module.exports.isAccessible = api.isAccessible;
module.exports.isNotTransparent = api.isNotTransparent;

// v4 API
module.exports.check = api.check;
module.exports.wcag = api.wcag;
module.exports.WCAG_THRESHOLDS = api.WCAG_THRESHOLDS;
module.exports.thresholdFor = api.thresholdFor;
module.exports.find = api.find;
module.exports.fix = api.fix;
module.exports.audit = api.audit;
module.exports.auditTokens = api.auditTokens;
module.exports.parseRelations = api.parseRelations;
module.exports.parseTokens = api.parseTokens;
module.exports.resolveToken = api.resolveToken;
module.exports.toJsonPatch = api.toJsonPatch;
module.exports.RelationError = api.RelationError;
module.exports.TokenSourceError = api.TokenSourceError;
module.exports.pick = api.pick;
module.exports.parseColor = api.parseColor;
module.exports.ColorInputError = api.ColorInputError;
