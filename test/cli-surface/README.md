# CLI-surface tests

Exhaustive verification of the `bb` command line: **every command, every flag**,
plus the behaviour of the commands a user actually reaches for, the exit-code
contract, and whether the package works as shipped.

They follow the repo's verification-script convention (`script/verify-index.ts`,
`script/m22/verify-r1-resume.ts`): a `check`/`negative` counter, one
`ok:`/`FAIL:` line per assertion, exit 1 when anything fails.

## Running

```bash
export PATH="<node-22-bin>:$PATH"

npx tsx test/cli-surface/run-all.ts              # all three suites (~7 min)
npx tsx test/cli-surface/matrix.ts               # the command x flag matrix (~2 min)
npx tsx test/cli-surface/run-all.ts matrix.ts     # one suite
```

No network. `npm pack --dry-run` and `npm run build` both run offline; embedding
config is scrubbed from every child env unless a check deliberately sets it.

## Files

| file | covers |
|---|---|
| `harness.ts` | isolated `$BB_DATA_DIR`, the `bb()` runner, help/man-page/source parsers, db ground truth |
| `matrix.ts` | **the deliverable** — every command and flag, discovered from the product's own help |
| `behaviour.ts` | version / upgrade / help / doctor / projects / stats / status / search / onboard, and the exit-code contract |
| `packaging.ts` | `files` vs what ships, the build, and a staged clean-install layout running the real `bin/bb` |
| `run-all.ts` | runs the above, one process each, with a summary table |

## The matrix is discovered, not hand-written

Nothing in `matrix.ts` lists a command or a flag. The surface is read out of
`bb --help` and `bb help <cmd>`, then each discovered entity is put through four
questions:

1. **Is it accepted?** Proved, not assumed. A value-taking flag is probed with
   `bb <cmd> --flag` and must answer `option '--flag <arg>' argument missing` —
   a *positive* proof of registration with no side effects. A boolean flag is
   really invoked inside an isolated data dir and rejected if the output carries a
   commander usage error. `mcp` gets an MCP JSON-RPC handshake instead.
2. **Does it appear in help, with a non-empty description?**
3. **Is it registered in `src/cli/index.ts`?** Help is generated *from* the
   registry, so this is what makes check 2 non-tautological: help cannot hide a
   flag, and a flag cannot exist only in help. Both directions are checked.
4. **Is it in `docs/man/bb.1`?** — the assertion that would have caught
   `status`/`stats`/`projects`/`doctor` missing from the man page.

Every "accepted" probe is paired with a **negative**: `bb <cmd>
--definitely-not-a-flag` must be refused. If the product stopped refusing unknown
options, every acceptance assertion here would silently become true — the
negative is what keeps the gate load-bearing.

Flags the man page genuinely does not mention are listed in
`KNOWN_UNDOCUMENTED_FLAGS` in `matrix.ts`. The gate fails if a flag is missing
from *both* the man page and that list, so new drift is caught while the known
gaps stay visible.

## Two entry points, and they are not the same code

`bin/bb` imports `runCli` from `dist/cli/index.js`. `src/cli/index.ts` self-execs
`runCli` from inside its own module evaluation (`import.meta.main`). The rest of
the suite drives the source entry, because that needs no build; `packaging.ts`
builds and stages the package and runs the real binary, and asserts both entries
behave the same way.