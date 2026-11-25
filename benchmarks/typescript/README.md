# TypeScript — the first benchmark language

Three pinned repositories, chosen for **scale asymmetry** rather than convenience, so the
result can say something about *when* bb helps and not merely *whether* it does.

| slot | repository | pin | files | why this one |
|---|---|---|---|---|
| `project1` | `sindresorhus/p-queue` | `7f272ab5` | 27 | **small, dense, high-churn.** A promise queue where the entire public surface is a few hundred lines. If bb helps here it is not through navigation — there is nothing to navigate. This is the honest negative control. |
| `project2` | `immerjs/immer` | `784c86bb` | 169 | **medium, subtle invariants.** A proxy-based structural-sharing library where the bug is usually in reasoning about draft semantics, not in finding the file. Prose in `bb_ask` could plausibly beat grep here, or could add nothing. |
| `project3` | `sindresorhus/execa` | `6f856d55` | 686 | **large, cross-cutting.** Process spawning with streams, transforms and typed option plumbing. A change to `options.stdin` legitimately touches several files, so this is where `bb_graph`/`bb_impact` have a chance to earn their cost. |

## Why these and not popular-React-app #1

1. **All three have a real fix-commit history with tests attached.** Track 1 (replay) needs
   `fix^` to fail the fix's own tests. Verified per-commit, not assumed — see
   `script/bench/replay-anchor.ts` and the count below.
2. **They are dependency-light and install offline-ish quickly**, so a wave is minutes not
   hours, and a reader can reproduce without a registry mirror.
3. **Two of three are single-maintainer style-consistent codebases.** That matters for the
   contamination argument: the failure mode we can *measure* is "the model already knows
   this repository", and these are less memorised than `express`/`lodash`.
4. **One is deliberately tiny.** If bb shows a benefit on a 27-file repo, the mechanism is
   almost certainly *not* navigation, and we would have to explain it. A benchmark whose
   control arm is a case where it should NOT help is stronger than one where every task is
   favourable.

## Verified anchor counts (measured 2026-11-25)

`script/bench/replay-anchor.ts scan` over each pin — commits that touch **both** a source
file and a test file, which is the structural precondition for a replay task:

| repository | eligible fix commits | verified anchors so far |
|---|---|---|
| p-queue | 74 | 1 (`48586f4`, 2 tests move) |
| immer | 77 | 0 |
| execa | 216 | in progress |

The gap between "structurally eligible" and "verified" is the point: `anchor` re-installs
the project at `fix^`, runs the fix's tests, applies the source diff and demands that at
least one test move fail→pass. A commit that does not move a test is **dropped with a
reason**, never silently admitted.

## Reproducing a pin

```bash
git clone https://github.com/<org>/<repo> project1
cd project1 && git checkout <pin>
sha256sum <(git archive HEAD)   # must match tarball_sha256 in benchmarks/manifest.json
```
