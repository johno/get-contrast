# get-contrast agent skill

`SKILL.md` teaches a coding agent how to handle color contrast with the
`get-contrast` CLI or MCP tools: find the real foreground/background pair,
prefer colors the project already has, change as little as possible, verify, and
report from the tool's output. It never asks the agent to do contrast arithmetic.

This directory:

- `SKILL.md`: the skill (keep it short: it is loaded into agent context).
- `fixtures/`: small projects (CSS component, JSON tokens, CSS themes, a palette,
  a before/after pair) the examples run against.
- `evals/evals.json`: example prompts and the expected tool sequence for each
  workflow. `test/skill.test.js` replays every sequence with a scripted agent
  that only calls `contrast`, applies the tool's suggested edit in place, and
  re-runs the check, so the instructions stay executable. It also checks the
  skill text itself (frontmatter, required workflows, size, no contrast math,
  APCA only ever described as supplemental, every command and flag exists).

Run the tests with `bun run test` from the repository root. Installation is
covered in the main docs.
