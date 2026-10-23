// Entry point of the ESM build (built as dist/esm/index.js in place of
// index.ts). Same named exports, plus a default export so
// `import contrast from "get-contrast"` keeps working as it did when Node
// handed ESM importers the CommonJS `module.exports` object.
import { ratio, score, isAccessible, isNotTransparent } from "./legacy.js";

export { ratio, score, isAccessible, isNotTransparent };
export type { LegacyOptions, LegacyScore } from "./types.js";

export default { ratio, score, isAccessible, isNotTransparent };
