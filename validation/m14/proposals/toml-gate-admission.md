# PROPOSAL — admit `toml` to the gate (one Lead-owned line)

**From: toml lane owner. State: `toml: 22 types classified; sections A-H: 8/8 pass` (rc=0, measured
2026-10-17 15:34). Lane memory: `validation/m14/verification/TOML-STATE.md`.**

## THE LINE

`script/m14/completeness-inventory.ts`, `GATED_LANGS` — add `"toml"`. That is the whole admission; no
analyzer, fixture or spec change is owed beyond what has landed.

## WHAT EACH SECTION READS, AND WHAT CHANGED IN THIS PASS

```
A  pass   22 types, 18 handled, 2 silent, 2 gaps, 1 decision
B  pass   pinned = emitted = contains, exports, imports, references
C  pass   complexity
D  pass   2 tier(s) pinned: import_based, structural            <- landed this pass
E  pass   floor row cargo:toml                                  <- your central sweep (baseline mtime 15:33:03)
F  pass   avgMsPerFile cargo:toml                               <- your central sweep
G  pass   docs/analyzers/toml.md
H  pass   12 checks
```

**Section D was the lane's only real gap, and it was a MISCLASSIFICATION, not a missing pin.** Every edge
carried `evidenceClass: "structural"`. A Cargo `path` dependency (`core = { path = "../core" }`) is a FILE
target the document itself writes — the fleet vocabulary's `import_based` class
(`script/m14/audit-analyzer-grammar.ts:146`, already used by csharp and css for their import edges) — so
`structural` (the class for facts that need nothing outside the file) was the wrong tier for precisely the
edge whose point is that it points outside it. The fix is three small edits, all landed:
`real-toml-analyzer.ts` writes `import_based` in the `pendingImports` loop; the four `imports` rows in
`toml/path-dependencies.expectation.json` pin the tier (they asserted none before, so nothing broke); and
the spec rationale that declared section D "red and that is the honest state" was **corrected, not
erased** — its "TOML has no import of any kind" is contradicted by the lane's own emission, and its own
escape clause ("D stays red until … TOML grows a construct that earns one") is satisfied by the
path-dependency import. The two dishonest routes that rationale refused were NOT taken: no `uses` edge for
a path-shaped string, and no `inferred` tier on an implied parent. Fixtures **10 pass / 0 fail before and
after**; `tsc` 0; edge count unchanged.

**E and F are yours, and the record should say so:** the scoped run at the start of this pass had no
`cargo:toml` floor row and no `avgMsPerFile`; `validation/m14/differential-baseline.json` was written at
15:33:03 with the row, and the 15:34 inventory went rc=0. This lane did not run `--update-baseline`.

## THE `exports` CHECK YOU ASKED FOR

`exports` is the fourth kind in section B and it is **correct that the row names it**, because section B
tests emitted+pinned, not resolved: the lane emits it (`real-toml-analyzer.ts` publish-surface block) and
`toml/publish-surface-and-paths` pins one real edge plus five forbidden look-alikes. But the settled ruling
stands and was not touched — emitting `exports` at corpus scale is **NOT-DOABLE to emit AND resolve**: the
mutant with both guards removed produces 20 edges, 0 resolved, 1 ambiguous, **19 unresolved**, residual
10 → 30 (`CALLS-REFERENCES-AND-TOML.md §2`). The guard stays; what was wrong in the old record was the
exclusion's CLASS ("zero-sites" instead of "implemented but declined by a correctness guard"), and that
correction is already recorded.

## VERIFY

```
bun run script/m14/completeness-inventory.ts --lang toml   # expect: sections A-H: 8/8 pass
bun run script/m14/run-fixtures.ts --lang toml             # expect: 10 pass / 0 fail
```
