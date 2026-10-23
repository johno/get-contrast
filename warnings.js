// Internal warning helper for legacy-but-preserved behavior. See
// docs/legacy-warnings.md for the policy. No dependencies, runtime-neutral.
//
// Also importable as `get-contrast/warnings` for programmatic control.

const ENV_VAR = "GET_CONTRAST_NO_WARNINGS";

const emitted = new Set();
let enabled = true;
let handler = null;

function envSuppressed() {
  if (typeof process === "undefined" || !process.env) return false;
  const v = process.env[ENV_VAR];
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

function defaultHandler(warning) {
  const line = `get-contrast: [${warning.code}] ${warning.message}\n`;
  if (typeof process !== "undefined" && process.stderr && process.stderr.write) {
    process.stderr.write(line);
  } else if (typeof console !== "undefined") {
    console.warn(line.trimEnd());
  }
}

// Emit a warning at most once per code per process. Never writes to stdout.
// Returns true if the warning was delivered.
function warn(code, message) {
  if (!enabled || envSuppressed() || emitted.has(code)) return false;
  emitted.add(code);
  (handler || defaultHandler)({ code, message });
  return true;
}

// configure({ enabled?: boolean, onWarning?: (w: {code, message}) => void })
function configure(options) {
  if (options && "enabled" in options) enabled = !!options.enabled;
  if (options && "onWarning" in options) handler = options.onWarning || null;
}

// Restore defaults and forget which codes were emitted (for tests).
function reset() {
  emitted.clear();
  enabled = true;
  handler = null;
}

module.exports = { warn, configure, reset, ENV_VAR };
