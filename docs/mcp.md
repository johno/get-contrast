# MCP server

`contrast mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io)
server on stdio, so coding agents can call get-contrast directly instead of
shelling out. It ships inside the `get-contrast` package (the implementation is
`packages/mcp`; there is nothing extra to install), has **no dependencies**
(the protocol surface it needs is small and local), and is **read-only**: it
never touches files or the network. Callers pass file *contents* (tokens,
palettes), not paths.

```json
{ "mcpServers": { "get-contrast": { "command": "npx", "args": ["-y", "get-contrast", "mcp"] } } }
```

(The key names vary by client; the command is always `npx -y get-contrast mcp`,
or `contrast mcp` when installed.) Protocol versions `2025-06-18`, `2025-03-26`
and `2024-11-05` are supported. stdout carries protocol messages only; any
diagnostics go to stderr.

## Tools

| Tool | Purpose | Library function |
| --- | --- | --- |
| `check_contrast` | WCAG 2.2 report for a pair: ratio, AA/AAA for text, large text and UI, your target | `check` |
| `check_wcag` | The ratio and what was measured; no judgment | `wcag` |
| `pick_color` | Choose the best existing color among candidates for a background | `pick` |
| `find_accessible_color` | Smallest change that meets the target (lightness, keeping hue and chroma) | `find` |
| `audit_palette` | All-pairs matrix, passing pairs, best foregrounds per background | `audit` |
| `audit_tokens` | Check explicit token relationships; existing-token fixes first; edits and an RFC 6902 patch | `auditTokens` |

Every tool takes the same target options (`level` AA/AAA, `use`
text/large-text/ui, `minRatio`, `backdrop`) as the CLI and library; see
[modern-api.md](./modern-api.md) for semantics and each tool's `inputSchema`
(from `tools/list`) for exact arguments. An APCA tool is intentionally absent
(see issue #43).

## Responses

Every call returns human-readable `content` (a short explanation) and
`structuredContent`:

```json
{ "schema": 1, "tool": "check_contrast", "status": "fail", "result": { "...": "the library's result object" } }
```

`status` is `pass`, `fail`, `info` (tools that do not judge) or `error`. The
`result` is exactly what the library returns (the same object `contrast ...
--json` puts under `result`); `audit_tokens` adds `patch`.

### Errors are categorized

| Situation | `isError` | `status` | `error.kind` |
| --- | --- | --- | --- |
| A pair fails WCAG, no candidate passes, a fix cannot be reached | **false** | `fail` | (none: this is a result) |
| Unusable color or arguments, invalid tokens/relations, unresolved tokens | true | `error` | `invalid-input` (+ `code`, `role`, `input`) |
| Valid CSS the engine does not support (`calc()`, relative colors, `color-mix()`, other `color()` spaces) | true | `error` | `unsupported-syntax` |
| A bug in a tool | true | `error` | `tool-failure` |

Input problems are returned as tool results (not JSON-RPC errors) so the model
can read and correct them; argument validation lists every problem at once.
Only protocol problems (unknown method, malformed request, unknown tool) are
JSON-RPC errors. For `audit_tokens`, unresolved tokens set `isError` but still
include the per-relation `result` so the issues and "did you mean" suggestions
are available.

## Development

```sh
bun run --cwd packages/mcp test        # protocol, schema, tools, stdio client, parity with the CLI
node packages/mcp/bin.js               # start the server from the monorepo
```

The tests drive the real server with a small stdio client fixture and compare
every tool with the library and the CLI (`--json`) on shared fixtures. An
architecture test fails if the package gains color or contrast math, any file or
network access, or a dependency other than the library.
