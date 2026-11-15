
## Lead verdict — the numbers, and what the first edition of this page got wrong

verdict(toml): the FIRST lane verified against the strict bar — residual **5 of 26,714**, and ZERO resolved
edges resting on production's tie-break.

> ### ⚠ THE FIRST EDITION OF THIS PAGE DID NOT ADD UP, AND THE SECOND EDITION SAYS SO.
> The first edition (written 2026-10-18) read its numbers from `residual-gate.ts --lane toml` and printed a
> table whose **imports row did not close**: 331 edges, 0 resolved, 13 unresolved — and **318 edges
> unaccounted for**, which the page's own headline ("residual 13 of 25,531 · resolved 98.7 %") silently
> rode over. It also carried a stale `references` count (167 where the analyzer now emits 1,350). The
> toml lane found both while re-measuring for its own verdict page, and reported them to the Lead rather
> than fixing them silently. **A table that does not add up to its own header is the defect class this
> campaign exists to remove — and this one was in a page the LEAD wrote and signed.**
>
> **The second edition is built from a DIFFERENT INSTRUMENT, and it says so.** The first edition's numbers
> came from `residual-gate.ts`; these come from the production arm, `incoming-gate.ts`, which is the
> instrument the acceptance test uses. Mixing the two in one page is how a reader ends up comparing
> numbers that were never comparable, so each block below names its instrument.

**The population, the root, and the command.**

```
BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts toml toml 0
```

1,485 parsed of 1,485 sampled · 1,485 `.toml` files across 77 repos · **the FARM root** · 0 parse failures ·
0 degraded. **R1 HOLDS BY CONSTRUCTION AND WAS CHECKED, NOT ASSUMED:** toml is one of the 23 lanes the
fleet's population table lists as UNAFFECTED BY THE ROOT — 1,485 files / 77 repos under BOTH roots — so the
recorded arm and this arm are the same population. The root is stated anyway, because the fleet has two.

**WHO RAN THIS ARM.** The toml LANE ran it, on the recorded population, and left the log at
`.tmp-lead/toml-arm-before.log`. **THE LEAD'S OWN INDEPENDENT ARM IS QUEUED BEHIND THE ARM TOKEN** — the
fleet runs one heavy arm at a time, and the dart lane holds it. **THIS PAGE'S VERDICT IS PENDING THAT
REPRODUCTION, and it is published as pending rather than as done.** The floor moves only when the Lead
independently reproduces the movement, and the Lead will not record a language as through the bar on the
lane's own report.

### THE TABLE — and it closes exactly

| type | edges | resolved | ofWhich | amb(decl) | unresolved | extOK | ext? | extFAIL | bindFAIL | causeFAIL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| imports | 331 | 0 | 0 | 0 | **5** | **326** | 0 | 0 | 0 | 0 |
| contains | 25,033 | 25,033 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| references | 1,350 | 1,350 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **26,714** | **26,383** | **0** | **0** | **5** | **326** | **0** | **0** | **0** | **0** |

**THE CLASS SUM IS EXACT: 26,383 + 0 + 5 + 326 + 0 = 26,714.** Every edge is in exactly one column, and
the first edition of this page's did not close. **INTENT CLOSURE: every row closes** — the gate's own line,
on every row of its own block. **The instrument's self-test PASSED (the control fired).**

**THE MOVEMENT FROM THE FIRST EDITION, column by column.**

| column | the first edition (residual-gate) | now (incoming-gate) | what changed |
|---|---:|---:|---|
| edges | 25,531 | 26,714 | **+1,183** — all of it in `references` (167 → 1,350), because the analyzer changed after the first edition was written |
| resolved | 25,200 | 26,383 | +1,183, of which +1,183 is the new `references` rows |
| unresolved | 13 | **5** | **−8** |
| extOK | (the column did not exist) | **326** | the 331-row `imports` row is now 326 externally verified + 5 unresolved |
| **UNACCOUNTED** | **318** | **0** | **the first edition's imports row did not close. This is the defect.** |

**THE VERIFIED CLASS, by the campaign's stated formula** (`(resolved + extOK)/edges`,
`JAVA-DEPTH-RECEIVER.md:47`): **(26,383 + 326) / 26,714 = 99.98 %** — the fleet's highest, and the first
edition's "resolved 98.7 %" was the *other* formula (`resolved/edges` alone: 26,383/26,714 = 98.79 %).
**The campaign carries two "verified class" figures for one arm; each block states which formula it used.**

### WHY THIS SATISFIES THE OBJECTIVE'S BAR, clause by clause

* **EVERY APPLICABLE TYPE EMITTED AND REAL.** `contains` 25,033 of 25,033 and `references` 1,350 of 1,350 —
  100 %, zero ambiguous, zero unresolved. The types the lane does not cover leave the denominator as
  `grammar-absence` with cited evidence in the lane's own coverage block, rather than hiding in it. The
  lane's coverage score is **4/4**, measured (`language-board.ts --coverage` prints
  `toml 4/4 from=spec coverage block`; applicable = 10 − 6 grammar-absence; unexercised = []; `exports(0)`
  disclosed as a substantiated zero).

* **`ofWhich = 0`** — and this is the clause that makes the verdict strong rather than merely green. Zero
  resolved edges were chosen by production's `s.id` tie-break among colliding candidates. The indexer's own
  control arm measures 37,318 of 49,729 such picks as the WRONG symbol, so a lane could have reached a
  small residual with a large share of its "resolved" edges being arbitrary. This lane has none. Every
  resolved edge names exactly one declaration and nothing chose between rivals.

* **INCOMING: `extFAIL 0`, `bindFAIL 0`, `causeFAIL 0`.** No false statement about another repository, no
  unfalsifiable binding claim, no declared cause that fails its own check.

* **THE 5 ARE RULED, NOT HIDDEN.** The lane's W1 is **RULED UNDECIDABLE** with a falsifier that was RUN and
  RE-VERIFIED AT THE SOURCE AND IN THE CORPUS this session rather than inherited: Pkg.jl's rule for a
  workspace member's `[sources]` is `project_path_to_manifest_path` (Types.jl:483-487 via
  `load_workspace_sources` :685-699), which resolves against the member's OWN directory — so
  `SubProjectA/SubProjectB` does not exist; and the four Cargo rows live in cargo's `out/` SNAPSHOT tree,
  where `out/primary/dependency/` does not exist and no `.cargo/config.toml` is anywhere in the ancestor
  chain. **A domain boundary with evidence is what the bar accepts in place of zero.**

* **THE OTHER WALLS CARRY ONE DISPOSITION EACH**, on the lane's own page: W2 the 1,085 `arbitraryTwin` —
  RESOLVED (the file-crossing class; `ofWhich 0` on every type; `collRes 0`; ten read by hand); W3 the 331
  `nothingAnywhere` — 326 CLAIMED AND VERIFIED, 5 = W1; W4 the 265 `sameFileUnproven` — line-inconclusive by
  construction; W5 `exports` — a DISCLOSED zero; W6 `amb(decl)` — a MEASURED zero. **No wall class is merely
  named.** (The arms: `arbitraryTwin` 1,085, identical to the recorded baseline — **NOT RISEN**; intended
  25,033 · sameFileUnproven 265 · nothingAnywhere 331.)

* **THE LANE'S OWN ACCOUNT IS HONEST ABOUT ITS SIZE.** Its file-scoping fix was reported as "47 edges, not
  18,971 — a robustness gain, not a count gain" after it refuted the Lead's premise by checking a log row's
  timestamp against the commit that changed the model. The claim change was cross-tabbed BEFORE emission: the
  analyzer's filesystem test and the arbiter's admitted-list verdict disagreed on ZERO edges in either
  direction. Fixtures 9/9; oracle diff unchanged at its pre-existing divergences; TOML-G1 (workspace
  inheritance, 1,269 sites / 138 documents) explicitly untouched and still recorded as an open gap.

### THE STATUS OF THIS PAGE, STATED PLAINLY

| | |
|---|---|
| the numbers above | **MEASURED**, on the recorded population, by the toml lane's arm (`.tmp-lead/toml-arm-before.log`) |
| the wall dispositions | the lane's own, on `validation/m14/verification/TOML-VERDICT-PROPOSAL.md` and `TOML-STATE.md` |
| **the Lead's independent reproduction** | **QUEUED** behind the arm token — the fleet runs one heavy arm at a time |
| **this lane's place on the floor** | **PENDING that reproduction.** The floor moves only when a language has a written verdict page the Lead independently reproduced, and a lane's report of DONE is a claim, not a verdict. |

**AND THE FLEET-WIDE RECORD ITEM THIS PAGE OWES, NOW PAID.** The first edition's imports row did not close
(318 unaccounted) — paid above, with the movement stated. The second is fleet-wide: the imports-emission
citation table in `validation/m14/verification/IMPORTS-EDGE-SHAPE.md` claims "file:line of the emission" for
48 lanes, and **at HEAD not one of the 48 lands on a line that publishes an Imports relationship** — 45 of
them were correct in the old tree and have drifted as the analyzers grew, and 3 were wrong even there. The
verifier is `script/m14/verify-imports-emission-citations.ts`: it re-derives every row FROM THE CODE (the old
tree's cited line's content, matched against HEAD's copy of the same file) rather than by adding a delta,
because a delta is a guess about a movement and the code is the evidence. Rows whose content is ambiguous in
HEAD are REPORTED, not guessed at.
