# Legacy warnings and the compatibility adapter

v4 keeps the v3 API (`ratio`, `score`, `isAccessible`, `isNotTransparent`) and
the `contrast <color1> [color2]` CLI working exactly as documented in
[v3-compatibility.md](./v3-compatibility.md). Corrected behavior ships in new
APIs. Warnings point users from a legacy quirk to the modern replacement.

## Policy

1. **Warn only when the modern API materially differs.** A legacy call whose
   result matches what the modern API would return never warns.
2. **No blanket deprecation.** `ratio`, `score`, and `isAccessible` are not
   deprecated, and a call that is correct today does not warn because a newer
   API exists.
3. **At most once per code per process.**
4. **stderr only, never stdout.** CLI stdout and exit status are part of the
   v3 contract and must not change because of a warning.
5. **Stable, searchable codes** of the form `GC_<SHORT_NAME>` (upper snake
   case). A code is never reused for a different meaning. Each code is listed
   in the table below with the modern replacement.
6. **Suppressible.**
   - Library: `require("get-contrast/warnings").configure({ enabled: false })`,
     or `configure({ onWarning })` to route warnings elsewhere.
   - Environment: `GET_CONTRAST_NO_WARNINGS=1` (any value other than empty,
     `0`, or `false`). Applies to library and CLI.
   - CLI flag: added with the command redesign (#46). Until then the
     environment variable is the CLI switch, because the v3 CLI treats every
     positional argument as a color.
7. **Warnings never change results.** Legacy entry points return and throw
   exactly what v3 did, warnings enabled or disabled.

## Registered codes

None yet. Codes are registered here by the issue that adds the modern API they
point to (for example, the alpha-compositing and strict `> 4.5` differences
become candidates once `check()` exists in Phase 3).

| Code | Triggered by | Modern replacement |
| ---- | ------------ | ------------------ |

## Helper

`warnings.js` exports `warn(code, message)`, `configure(options)` and
`reset()`. It is intentionally not re-exported from the package entry point:
the main export shape (`ratio`, `score`, `isAccessible`, `isNotTransparent`) is
frozen by the compatibility suite.

## Compatibility adapter boundary

Legacy exports are thin adapters. The rules:

- The public functions in `index` keep their names, argument handling, return
  types, and error classes/messages (as recorded by `compat/`).
- An adapter may call new internals only when the compatibility suite proves
  the observable result is identical, including thrown errors.
- Where the new code would behave differently (alpha handling, accepted
  syntaxes, thresholds), the adapter keeps a legacy code path and may emit a
  registered warning. It does not forward to the modern behavior.
- The compatibility suite (`bun run test:compat`) gates every change to an
  adapter, and runs with warnings both enabled and suppressed.
