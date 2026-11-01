# `test/` — harness suites and fixtures (not the gate suite)

The verification gates live in `script/` (see [../script/README.md](../script/README.md)). This directory holds
test harnesses that drive the product the way a user or package manager would, plus fixtures those suites and
the site work use.

| Path | What it covers |
| --- | --- |
| `test/cli-surface/` | The `bb` command line end to end: every command and flag, the behaviour of the commands users reach for, the exit-code contract, and whether the package works as shipped. Run `npx tsx test/cli-surface/run-all.ts` (~7 min). |
| `test/indexing-lifecycle/` | The launch-critical indexer paths the ordinary gates do not isolate: resume, checkpoints, `--changed`, the index lock, worker-pool fallback, empty/trivial projects. |
| `test/fixtures/` | Small demo projects (`m45-demo`, `m45-studio`) used by documentation/website capture work; not a test of the analyzers. |

Everything here follows the repository's verification convention: a `check`/`negative` counter, one
`ok:`/`FAIL:` line per assertion, exit 1 on failure. They are slower than the gate suite and are run
deliberately, not on every edit.
