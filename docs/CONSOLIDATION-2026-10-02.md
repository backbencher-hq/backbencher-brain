# Retained branches — what each one still holds

Generated 2026-10-02 during the branch consolidation. `main` is the single
integration branch. Every branch below is **archive-only**: it holds at least
one commit that is NOT in `main`, so it was kept rather than deleted.

Do not merge these without reading this file first. Several diverge from
`main` by hundreds of commits; `wip/reflog-only-commits` alone conflicts on
808 paths. They are preserved so that no work is lost, not because they are
ready to merge.

"Unique" counts patch-id equivalence against `main`: a commit counts only
when no commit in `main` carries the same diff.

| branch | unique | what it holds |
|---|---|---|
| `archive/backup-main-before-origin-merge` | 33 | Re-stamp M14 evidence at dart master-review wave-2 HEAD (F1-F9/CC1) |
| `archive/dangling/143459e7e166a4ce16f81d26316b2a7751e36690` | 1 | index on main: 23e94dd6 m14(csharp): RETRACT the "call-count explosion" claim — the counters were on the sam |
| `archive/dangling/1a85808e7f7cef98afbdd18501926708193e6f9f` | 1 | index on main: 2f5b9fe1 docs(ruby): correct the multiple-assignment finding, and record why the first number w |
| `archive/dangling/2019e29cfdaff36d6f2c05109c79e6e12b39d0f6` | 1 | index on main: de42ab54 fix(m14/zig): a local type owned the enclosing container, and the GATE was wrong twice |
| `archive/dangling/351d96d882ab5224e4da5d31e42acc2ab78a860a` | 1 | index on main: f004d14c fix(m14/zig): a ratio that rounds a real loss to 100% is worse than no ratio |
| `archive/dangling/407d454b3ca2fc2262a4ee790edc257023956936` | 1 | index on main: 02a1f0fb fix(clojure-truth): a `references` edge is a USE of an alias, not only a require |
| `archive/dangling/43b28088f0150c5c9b8fb4c30c9e50e19f69fba5` | 1 | index on main: 23e94dd6 m14(csharp): RETRACT the "call-count explosion" claim — the counters were on the sam |
| `archive/dangling/4d5b861e9624bb588ac630f85d3ed0add4728080` | 1 | index on main: 20e4bd8f perf(ts): the same per-node walk, copy-pasted — plus an instrument that finds the cl |
| `archive/dangling/50de3a1423dbd6d198cfa9d4b3cc3e7c14afd4b4` | 1 | index on main: 20e4bd8f perf(ts): the same per-node walk, copy-pasted — plus an instrument that finds the cl |
| `archive/dangling/54be9d95873217601c46b144f1982b10b2114945` | 1 | index on main: a22e713c fix(m14): the M60 gate must not silently measure the default corpus |
| `archive/dangling/6ef7b607c0ab49ba4b37e582039447cfed7e0af1` | 1 | index on main: 02a1f0fb fix(clojure-truth): a `references` edge is a USE of an alias, not only a require |
| `archive/dangling/710ed47af528f93514d48b087471467005bbb722` | 1 | index on main: 0b6ae8e3 fix(erlang): an include directive is a derivable dependency, not an absent declaration |
| `archive/dangling/7c9ab253769e141ba4fd6a2f4981a5d56b226e8b` | 1 | index on main: 2f5b9fe1 docs(ruby): correct the multiple-assignment finding, and record why the first number w |
| `archive/dangling/80eb6fa2ee2f9b127e9dce31022884198e555277` | 1 | index on main: 02a1f0fb fix(clojure-truth): a `references` edge is a USE of an alias, not only a require |
| `archive/dangling/849bd8b2cbd151b3d92b85e11d3a41ed6f37c7e9` | 1 | index on main: 02a1f0fb fix(clojure-truth): a `references` edge is a USE of an alias, not only a require |
| `archive/dangling/a1c250754c242041a4eb8853c7ff8f2a431dde7e` | 1 | index on main: f004d14c fix(m14/zig): a ratio that rounds a real loss to 100% is worse than no ratio |
| `archive/dangling/a9071c55df76c91d6ef0eab975ce4bc1682535b5` | 1 | index on main: b7fee42f fix(m14/zig): the seventh revert \u2014 Z45's dead disjuncts were reintroduced by anot |
| `archive/dangling/aa5610812323550529e0a5eac0e8b9e989b36e3c` | 1 | index on main: a22e713c fix(m14): the M60 gate must not silently measure the default corpus |
| `archive/dangling/b78a6958c950b883cebeb3622c824c557d9d5118` | 1 | index on main: de42ab54 fix(m14/zig): a local type owned the enclosing container, and the GATE was wrong twice |
| `archive/dangling/c2cc78a30850ca03a26364ec1882796b090c06f7` | 1 | index on main: e816f56b docs(m14/zig): the ceremony, and the twelfth loss |
| `archive/dangling/e091871742ffc6e07206d23e4b4ae154128d72ce` | 1 | index on main: a22e713c fix(m14): the M60 gate must not silently measure the default corpus |
| `archive/dangling/e14dfea6055e4e67d3b8bd97a1016f8ab5c2be51` | 1 | index on main: 0b6ae8e3 fix(erlang): an include directive is a derivable dependency, not an absent declaration |
| `archive/dangling/e1ec6e0e7276a69c4b53d574c76c2a41a8ab89e2` | 1 | index on main: a22e713c fix(m14): the M60 gate must not silently measure the default corpus |
| `archive/dangling/e9e71cfa1e52ed4a546ee49cf33741ee53d591c7` | 1 | index on main: b7fee42f fix(m14/zig): the seventh revert \u2014 Z45's dead disjuncts were reintroduced by anot |
| `archive/dangling/f91b35eb817635ffb6ce6656bd452b151d053199` | 1 | index on main: e816f56b docs(m14/zig): the ceremony, and the twelfth loss |
| `archive/go-w3-local-backup` | 3 | M35: re-baseline staleness corpus at the M43 remediation-string wording |
| `archive/m14/612-prefix-arm` | 1 | test(m14): define the PRE-FIX arm of the #612 containment A/B as a revision |
| `archive/recovery/stash-1-2026-09-26` | 1 | index on m48-recovery: 85b2c4a9 probe(m60): #924's node shapes — five snippets reproduce five mechanisms, no |
| `archive/stash2-fifteen-mutants-del` | 1 | index on main: 44e09d09 test(clojure): fifteen mutants so the nine new fixtures can actually FAIL |
| `archive/worktree-uncommitted-0929` | 1 | archive: every secondary worktree's uncommitted state, captured before anything can remove one |
| `bbsearch-fix-source-text` | 2 | fix(bb_search): content-mode recall must not depend on the page size |
| `csharp-oracle-round` | 3 | fix(csharp): CS-D8 extends the bare-`uses` span test to `parameter` (uncommitted work, preserved) |
| `main` | 0 | — |
| `recovery/stash-1-2026-09-26` | 1 | index on m48-recovery: 85b2c4a9 probe(m60): #924's node shapes — five snippets reproduce five mechanisms, no |
| `safety/coagent-inflight-0929` | 1 | safety: the co-agent's in-flight work, captured before any reconciliation |
| `safety/uncommitted-2026-10-02` | 1 | safety: the uncommitted working tree, captured before reconciliation |
| `wip/reflog-only-commits` | 5 | archive(reflog-only): chore: take the last 3 upstream commits (2edef4cb) |
| `wip/stashes-archive` | 7 | archive(stash@{6}): WIP: MCP tool-handlers/registry/hover (3 files) |
| `wip/wt-.bbgraph-base` | 1 | wip(worktree/.bbgraph-base): 4 uncommitted files, captured on consolidation 2026-10-01 |
| `wip/wt-.bbgraph-merge` | 1 | wip(worktree/.bbgraph-merge): 1 uncommitted files, captured on consolidation 2026-10-01 |
| `wip/wt-.bbgraph-verify` | 1 | wip(worktree/.bbgraph-verify): 4 uncommitted files, captured on consolidation 2026-10-01 |
| `wip/wt-bb-selftest` | 1 | wip(worktree/bb-selftest-isolated): 2 uncommitted files, recovered from patch 2026-10-01 |
| `wip/wt-verify-wt` | 1 | wip(worktree/verify-wt): 10 uncommitted files, captured on consolidation 2026-10-01 |
| `wip/wt-wt-check` | 1 | wip(worktree/wt-check): 8 uncommitted files, captured on consolidation 2026-10-01 |
