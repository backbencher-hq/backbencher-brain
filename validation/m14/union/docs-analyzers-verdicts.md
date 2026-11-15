# docs/analyzers — 47 paths (29 modified + 18 deleted on main), on the CORRECT basis `HEAD..1b71d837c`

**MARKED RUN**: the classification asserts that main-only content exists across the batch (6,545 lines
across 29 paths); a run reading zero everywhere means the wrong basis — the rule that caught my own
mis-based re-run. Verdicts: **COMPOSE 20 · HEAD-SUPERSET 6 · HEAD-SUPERSEDES 3** — the 6 supersets are
exactly the six the Lead named.

## WRITTEN (2)
* **`java.md`** — HEAD 34 lines / main 273. **main is a strict superset**: it carries HEAD's whole
  skeleton plus tables HEAD lacks, plus four sections HEAD has none of (`## Incoming — the declaration,
  the external marker…`, `### Three changes to the lane…`, `### What the backlog IS, by family`,
  `### What Java's incoming round still owes`, `## The JVM family…`), and `Fixtures: 63` where HEAD still
  says 25. **HEAD's only unique line was the outdated fixture count**, and the mutation-hardening bullet
  HEAD has is at main:273 too. **Took main's file.**
* **`ONTOLOGY-PROGRESS.md`** — HEAD 85 / main 497, with **406 lines at main:80-485** absent here and
  **7 main-only headings**. HEAD's only two unique lines are the PRE-PAYMENT wording
  (`DERIVATION still owed`, `TypeScript emits…`) where main reads
  `**DERIVATION paid and the incoming declaration round closed 2026-10-09**`. **Took main's file.**

## VERIFIED HEAD-SUPERSET — nothing to write (6)
`clean.md` · `css.md` · `json.md` · `powershell.md` ·
`yaml.md` · `zig.md` — main-only lines 0 in every one.

## VERIFIED HEAD-SUPERSEDES (3) — main's prose is the OLDER design, not missing work
* **`lua.md`** — main's block is the **R6 `moduleTarget` proposal**, and HEAD's R6 heading
  reads *"**SUPERSEDED 2026-10-11** … this lane now uses it … that proposal is **WITHDRAWN by its own
  author**"*. **Porting main's text would resurrect a retracted proposal.**
* `dart.md` (1 main-only line) · `fsharp.md` (2).

## REMAINING — COMPOSE, with the size of the gap (18)
`javascript.md` HEAD 800 / main 2,680 · 18 main-only headings · 4 blocks marked
SUPERSEDED · **the largest gap in the batch** ·
`typescript-ambiguity-sweep.md` 993 main-only · `swift.md` 838 ·
`cpp.md` HEAD 1,702 / main 2,267 · 9 headings · `vue.md` 256 ·
`scala.md` 230 · `java.md` 11 headings · `groovy.md` 8 ·
`elixir.md` 8 · `html.md` · `typescript.md` · `svelte.md` ·
`php.md` · `python.md` · `python.md` · `markdown.md` · `toml.md`
(**written into HEAD already** — main's mechanism sentence folded in) · `real-dart`/`real-fsharp` above.
### THE TWO "TRUE COMPOSES" READ PER BLOCK — AND BOTH ARE HEAD-SUPERSEDES. NOTHING TO WRITE.

**`python.md`** (HEAD 280 / main 195): every one of main's 11 unique lines is a **SUPERSEDED STATE** —
`Fixtures 19` (HEAD: 53) · `Mutants 30` (65) · `Completeness 123/62/68` (127/72/55, 0 gaps) ·
`Corpus 3,271 files / 45,560 symbols / 230,420 relationships` (11,488 / 206,953 / 1,290,653, 0 parse
failures) · `oracle 99.9994%` (HEAD: ten labels, all ten independently derived) · `imports` "list or
tuple" (HEAD adds `set` and `future_imports` since round 18) · **"All nine emitted types"** (HEAD: TEN) ·
**"`references` and `depends` are not emitted"** (HEAD emits `references`; only `depends` is excluded).
**Main has ZERO headings HEAD lacks**, so not one of its blocks sits in a section missing here.

**`markdown.md`** (HEAD 315 / main 264): main's two substantive unique lines are **`MD-G1` and `MD-G2`
recorded as `open`** — and HEAD's own entries read **"`MD-G1` **closed 2026-09-28** (recorded in the
spec's `closed_gaps`)"** and **"`MD-G2` **closed as `internal_silent`, grammar-forced**"**. **Taking
main's text would have re-opened two closed defects** — the `real-lua` shape a second time in the same
batch, and the closure is stated on THIS side in the entry itself.

### THE GENERAL TEST FOR A SUPERSET TAKE, NOW STATED
**A take of one side is safe exactly when the other side's unique lines are a STATE or a COUNT that has
since changed — and unsafe when they are a CLAIM, a REASON, or an ERROR STORY.** `java.md` (an outdated
`Fixtures: 25`) and `ONTOLOGY-PROGRESS.md` (pre-payment wording) are the safe kind; `lua.md`
(a WITHDRAWN proposal) and `markdown.md` (two CLOSED defects recorded as open) are the unsafe kind.
**AND THE SEARCH ORDER THAT FALLS OUT OF IT: before taking a main-side block that claims to be a fix or a
decision, grep this side for `SUPERSEDED`, `WITHDRAWN`, `REVERTED`, `closed`, `the wrong answer` — four
retractions have now been found on this branch alone.**

## AND THE 18 DELETED-ON-MAIN — keep HEAD's copies
`AGENT-ROSTER · EXPORTS-CONTAINS-RULING · HANDOFF · INDEX-RESOLUTION-FINDING · LAPTOP-B-STATUS ·
bash.md · fsharp.md · hcl.md · json.md · make.md · php.md · protobuf.md · r.md` (and the rest) —
main deleted them; a deletion loses nothing, and HEAD's copies are the union.
