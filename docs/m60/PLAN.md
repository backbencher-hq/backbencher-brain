# M60: Family Truth Reconciliation — the standing rules, and the JVM/web remainder

> GitHub milestone [M60](https://github.com/backbencher-hq/backbencher-brain/milestones) (owner-ordered).
> This is the **last new milestone**. Its purpose is to make that sentence enforceable instead of a hope.
>
> Depends on: **M59** (`docs/m59/PLAN.md` — call-site truth; tool layer, 6 issues open).
> Fold target: **M49** (receives this milestone's family results at close).
> Hand-off: **M14**-clean (receives ONE milestone covering all remaining analyzers).

## The milestone invariant (verbatim, enforced by X1)

> **A family may be called closed only when its closure gate is green AND every payload cell of
> every onboarded language in it is alive — produced by the analyzer, preserved by the store,
> reachable at query, and truthful at the tool. Any closure claim not backed by a live gate is
> itself a defect. No new milestone may be created to carry work that belongs to an existing one.**

Every acceptance criterion below traces to that sentence. `family closed` stops being a prose
status and becomes a computed boolean.

## Why this milestone exists

Three milestones — M14, M37, M49 — each state that the JVM and Web families are done. Measured
against the tracker at HEAD `62b1a8b3`:

| Family | What the milestones say | What the tracker says |
|---|---|---|
| JVM | #610 CLOSED, four review waves closed | **4 findings open** — #739 java · #740 kotlin · #741 scala · #742 groovy |
| Web | #611 CLOSED, family-closure report CERTIFIED | **2 deferrals open** — #816 (name-resolution FP) · #818 (dart lane re-measure) |
| All | — | **14 open M49-CONV issues** across every family |

The mechanism is not neglect. It is that **each milestone was scoped to its own artifact**:

| Milestone | Its lens | What it measured against |
|---|---|---|
| M14 | analyzer honesty | the analyzer's own oracle |
| M37 | family closure | the families, against each other |
| M49 | review intake | external claims, against the code |

**Not one of them measured payload truth across the seam** — emit → store → query → tool. So every
new dimension looked like a *new phase* instead of an *unfinished one*, and the remainder was
deferred to "the next milestone" each time. That is how the count became unbounded.

M60 closes the remainder **and removes the mechanism**, by turning the missing dimension into a
standing gate that binds every milestone, present and future.

## Scope

### 1. The JVM remainder (family `jvm`)

| Issue | Language | Defect |
|---|---|---|
| #739 | java | bare member reads emit no `Uses` edge |
| #740 | kotlin | plain and dotted member reads emit no `Uses` edge |
| #741 | scala | Spring ecosystem invisible to framework detection |
| #742 | groovy | pinned grammar fails on 58.5% of grails-core files |

All four are re-verified live before any fix (verify-first protocol). #739 and #740 are the same
class already fixed and closed for JavaScript (#744) — port the existing, oracle-mirrored,
mutant-gated pattern; do not re-derive it.

### 2. The Web remainder (family `web`)

- #816 — cross-language false positive: TS `greet` → `package.json` `name` (name-resolution layer, 0.85).
- #818 — the dart F5 lane measured an **uncommitted** analyzer; re-measure once the DT wave lands.
- Re-assert Web closure **through the new matrix** (P1), not through the closure report's prose.

### 3. The payload-seam matrix (the thing that ends the recurrence) — P1

Enumerate, mechanically, the entire payload surface and every cell of it:

**33 declared payload fields** (11 on `UniversalRelationship`, 22 on `UniversalSymbol`) **× 21 onboarded
languages × 4 seam stages (emit → store → query → tool)** ≈ **2,772 cells**.

A first enumeration already ran; the non-alive cells found in one pass, with no review and no wave:

| Cell | Producers | Production readers | Verdict |
|---|---|---|---|
| `comments` | 9 analyzers | **0** | real docstring work no product surface reads (harness-only) |
| `from` | 0 | many | alias read by consumers, never produced |
| `gravityScore` | 0 | 1 | read without a producer |
| `line_number` | 3 of 41 (scala, xml, cross-language-persister) | 6 | **stored as `0` for 189,499 rows** — M59's subject |

That last row is the milestone's proof-of-concept: one command bounded the surface, where review
cycles had been sampling it at random. **Random sampling of a finite set never terminates; enumeration
does.**

### 4. The standing rules (bind M14, M37, M49, M59 and every milestone after) — G1

| # | Rule | Enforced by |
|---|---|---|
| R1 | **No new milestone** for work that belongs to an existing one. Findings are issues. | G1 gate |
| R2 | A family is `closed` **only** when its closure gate is green **and** its payload matrix has zero non-alive cells. | G1 + P1 |
| R3 | Every finding document must be **registered as an issue** before it is worked. A doc is not a queue. | G1 gate |
| R4 | **Fold contract:** at close, M60's family results are recorded into M49 as the evidence that its jvm/web closure claims are true. | X1 |
| R5 | M14-clean gets **one** milestone covering all remaining analyzers, each analyzer carrying the accumulated checks of every prior milestone. | X1 |

`reviews/m49-callsite-line-gap.md` is the standing example of R3: a complete, correct, reproducible
handoff that sat **unregistered** — no ledger row, no issue — until M59 was created for it.

## Issues

| ID | Issue | Title | State |
|---|---|---|---|
| G1 | [#828](https://github.com/backbencher-hq/backbencher-brain/issues/828) | Standing rules R1–R4 + the gate that enforces them | open |
| P1 | [#829](https://github.com/backbencher-hq/backbencher-brain/issues/829) | Payload-seam matrix: 33 fields × 21 languages × 4 stages; wired into the closure gate | open |
| J1 | [#830](https://github.com/backbencher-hq/backbencher-brain/issues/830) | JVM remainder: #739 #740 #741 #742 under the verify-first protocol | open |
| W1 | [#831](https://github.com/backbencher-hq/backbencher-brain/issues/831) | Web remainder: #816 #818, and re-assert web closure through the matrix | open |
| X1 | [#832](https://github.com/backbencher-hq/backbencher-brain/issues/832) | Closure: fold into M49, hand M14 the single analyzer milestone, prove no new milestone is required | open |

## Evidence

- `validation/m60/results/*.json` — machine-emitted only; hand-edited results are an instant reopen.
- `validation/m60/ledger.json` — per-issue status with `verifiedAtCommit`.
- Fold record into M49 at close.

## Reproduce

```bash
# the bounded surface (the number that ends the infinity)
npx tsx script/m60/payload-matrix.ts

# the closure computation (family = green gate AND alive matrix)
npx tsx script/m60/verify-family-closure-truth.ts

# the standing-rules gate (R1-R4)
npx tsx script/m60/verify-standing-rules.ts
```

## What this milestone does NOT promise

Defects will keep appearing. No method prevents that. What M60 buys is that they stop appearing as
**new classes that invalidate the milestone just finished**, and become a red cell in a table we
already own. That is the difference between unbounded work and a finite bug list.
