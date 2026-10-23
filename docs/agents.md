# Using get-contrast with coding agents

get-contrast gives an agent three things, all backed by the same library:

| Piece | What it is | Use it when |
| --- | --- | --- |
| **Skill** (`SKILL.md`) | Judgment and workflow: find the real pair, prefer existing colors, change as little as possible, verify, report from the tool | Your agent supports skills, or you can add a rules file |
| **MCP server** (`contrast mcp`) | Six read-only tools returning structured results | Your agent supports MCP |
| **CLI** (`contrast ... --json`) | The same operations from a shell | The agent can run commands |

You can use any one of them; the skill works with either of the others. Every
step below is explicit: nothing is written until you name a location, `--dry-run`
shows the result first, and uninstall removes only what was added.

## Install

```sh
npm i -D get-contrast        # provides the `contrast` command (version 4 or later)
```

### The skill

```sh
contrast skill install --agent claude            # ./.claude/skills/get-contrast/SKILL.md
contrast skill install --agent claude --global   # ~/.claude/skills/get-contrast/SKILL.md
contrast skill install --dir path/to/skills      # any skills folder: <dir>/get-contrast/SKILL.md
contrast skill install --dir path/to/skills --dry-run
contrast skill uninstall --dir path/to/skills
```

An existing `SKILL.md` that differs (another version, or your edits) is never
overwritten without `--force`, and `uninstall` refuses a modified file the same
way. For an agent that reads a rules file instead (`AGENTS.md`, a project
instructions file, ...), print the skill and paste or include it where that agent
looks: `contrast skill show`.

### The MCP server

The server command is always `npx -y get-contrast mcp` (or `contrast mcp` for a
global install). Print the entry to add by hand:

```sh
contrast mcp config                   # {"mcpServers": {"get-contrast": {"command": "npx", "args": ["-y", "get-contrast", "mcp"]}}}
```

or merge it into a JSON config file you name:

```sh
contrast mcp install --file .mcp.json --dry-run   # show the resulting file, write nothing
contrast mcp install --file .mcp.json             # merge ONE entry; everything else is kept
contrast mcp uninstall --file .mcp.json           # remove only that entry
```

`install` keeps your other servers and the file's indentation, refuses files
that are not strict JSON (for example with comments: it tells you to add the entry
by hand), refuses a *different* existing `get-contrast` entry unless you pass
`--force`, and writes atomically. Options: `--key` (the top-level object, default
`mcpServers`), `--name` (default `get-contrast`), `--local` (use `contrast mcp`
instead of `npx`).

Where the file lives depends on the client. Most use a JSON file with an
`mcpServers` object (a project-level `.mcp.json`, a `.cursor/mcp.json`, a desktop
app's settings file); some, such as VS Code's `.vscode/mcp.json`, use a `servers`
key and may want `"type": "stdio"` added by hand. Check your client's documentation
for the location, then point `--file` (and `--key`) at it. Clients with their own
"add server" command can use the same command and arguments, for example
`claude mcp add get-contrast -- npx -y get-contrast mcp`.

Check that it starts and speaks MCP:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | contrast mcp
```

See [mcp.md](./mcp.md) for the tools, responses and error categories.

## What a session looks like

A user says: *"the muted text on our cards is hard to read."* An agent with the
skill:

1. reads the stylesheet to learn which tokens are used together
   (`--text-muted` on `--surface-default`), and writes them into a `relations.json`;
2. calls `audit_tokens` (or `contrast tokens ... --json`), which fails
   `text.muted on surface.default` at `2.52:1` and reports that the existing token
   `text.secondary` meets AA at `7.81:1`;
3. applies the suggested one-line edit to the token file (the tool never edits
   files; JSON files also get a ready RFC 6902 `patch`);
4. calls the audit again and gets `pass` with `verification.ok: true`;
5. reports the before and after ratios exactly as the tool returned them.

When no existing token fits, step 2 returns a synthesized color found by changing
lightness only (hue and chroma kept), already checked against the requirement.

This flow is not just documentation: `skills/get-contrast/test/e2e.test.js`
replays it on a fixture app through both the CLI and the MCP server, requires the
same final files and report from both, and checks that every figure in the report
came from a tool response.

## Troubleshooting

- `contrast --version` should print 4.x. Older versions have only the
  `contrast <color1> [color2]` form.
- Exit codes (CLI): 0 target met, 1 not met, 2 bad input (read the message), 3
  tool failure. MCP: a failing pair is a normal result; `isError` means bad input
  or a tool failure.
- The server writes protocol messages to stdout only; diagnostics go to stderr.
- APCA is not offered: it is a supplemental model that is not part of WCAG 2.2,
  and its reference implementation's license needs an owner decision (issue #43).
