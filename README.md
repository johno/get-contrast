# get-contrast

Color contrast for code, the command line, and AI agents. See
[packages/get-contrast/readme.md](packages/get-contrast/readme.md) for library
and CLI usage.

## Layout

```text
apps/www/              Next.js App Router site
packages/get-contrast/ the published `get-contrast` package
packages/cli/          the `contrast` command (shipped inside get-contrast)
docs/                  compatibility contract and warning policy
```

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run build       # packages + apps/www
bun run test        # unit + v3 compatibility suites
bun run typecheck
```

`contrast` is published as part of `get-contrast`. `packages/cli` owns its
implementation; `packages/get-contrast/scripts/build-cli.js` copies it into the
package at build/pack time.

v3 behavior is frozen by the suite in `packages/get-contrast/compat`; see
[docs/v3-compatibility.md](docs/v3-compatibility.md).
