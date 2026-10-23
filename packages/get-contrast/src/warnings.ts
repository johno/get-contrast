// Internal warning helper for legacy-but-preserved behavior. See
// docs/legacy-warnings.md for the policy. No dependencies, runtime-neutral.
//
// Also importable as `get-contrast/warnings` for programmatic control.

// The library is runtime-neutral and does not depend on Node typings; declare
// only the slice of `process` that is read, guarded by typeof at each use.
declare const process:
  | {
      env?: Record<string, string | undefined>;
      stderr?: { write?(chunk: string): unknown };
    }
  | undefined;

export interface Warning {
  code: string;
  message: string;
}

export interface WarningOptions {
  enabled?: boolean;
  onWarning?: ((warning: Warning) => void) | null;
}

export const ENV_VAR = "GET_CONTRAST_NO_WARNINGS";

const emitted = new Set<string>();
let enabled = true;
let handler: ((warning: Warning) => void) | null = null;

function envSuppressed(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  const v = process.env[ENV_VAR];
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

function defaultHandler(warning: Warning): void {
  const line = `get-contrast: [${warning.code}] ${warning.message}\n`;
  if (typeof process !== "undefined" && process.stderr && process.stderr.write) {
    process.stderr.write(line);
  } else if (typeof console !== "undefined") {
    console.warn(line.trimEnd());
  }
}

// Emit a warning at most once per code per process. Never writes to stdout.
// Returns true if the warning was delivered.
export function warn(code: string, message: string): boolean {
  if (!enabled || envSuppressed() || emitted.has(code)) return false;
  emitted.add(code);
  (handler || defaultHandler)({ code, message });
  return true;
}

// configure({ enabled?: boolean, onWarning?: (w: {code, message}) => void })
export function configure(options?: WarningOptions): void {
  if (options && "enabled" in options) enabled = !!options.enabled;
  if (options && "onWarning" in options) handler = options.onWarning || null;
}

// Restore defaults and forget which codes were emitted (for tests).
export function reset(): void {
  emitted.clear();
  enabled = true;
  handler = null;
}
