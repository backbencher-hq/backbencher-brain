## The defect

`script/m14/differential.ts` → `coldPoolPick()` records the paths it drew in `/tmp/m14-f5-cold-pool.json` and treats a path as "already sampled" on later runs. #760's whole purpose is: *each lane prefers files never sampled before, deterministically seeded per rotation, so a wave sees fresh files instead of the same 60 forever.*

But when a corpus checkout is **not exactly its pin** (moved or dirty), the lane is measured in a detached worktree of the pin — `/tmp/m14-frozen-corpus-<hash>/<repo>/…` (M49 W16, `pinNeedsFrozenTree`). The pool recorded **those absolute paths**. Every run freezes a *new* directory, so:

- every file looked never-sampled on every run → the log line that exists to disclose sampling (`[cold-pool] N/M fresh`) read **100% fresh** forever;
- the pool grew without bound — `proxicall:dart` held **5,942 paths for a 2,211-file corpus** across four freeze prefixes (`6ca4df816c7118ed`, `0b5e3d9fd313a8c5`, `f766a270ca77965b`, `0ef4059f2c381851`);
- consecutive runs therefore draw **overlapping** file sets while reporting disjointness — exactly the failure mode #760 was written to prevent, on exactly the corpora big enough to need it. A "full extent" can be claimed twice and cover two different halves.

Measured live: `proxicall:dart 2211/2211 fresh (rot 10, corpus 2211)` on a run whose predecessors had already drawn 2,631 paths for that lane.

## The fix (this round)

`coldPoolPick` takes an optional `poolKey`; the call site passes the **corpus-relative** path (`path.relative(repoDir, f)`), so a frozen measurement and an in-place one describe the same file. Membership accepts either spelling (`seen.has(key) || seen.has(raw)`) so pools written before the fix — where the absolute path *is* the in-place lane's identity — are not reset; from here on only the relative key is recorded.

## Why it matters beyond dart

Every lane whose primary or second corpus is a moved/dirty checkout was sampling blind, and the guard-rail that would have shown it was the very number that lied. The fix is lane-neutral machinery; dart's full-extent measurement (2,211 files chunked over a private pool, each chunk's drawn paths now printed under `BB_F5_SHOW_FILES`) is what surfaced it.
