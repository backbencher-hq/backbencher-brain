# HCL lane — `hcl` (engine language id; `HCL` in the firing log)

Lane owner: **hcl-lane**. Verdict page, refutation-first. The analyzer's own long-form document is
`docs/analyzers/real-hcl-analyzer.md` (outside this lane's write scope); this page carries what the
COVERAGE DECLARATION rests on, the measurements behind it, and what it does NOT settle.

**Corpus.** 9,329 git-tracked `.tf` / `.tfvars` / `.hcl` / `.tofu` files over 16 repositories under
`$HOME/fixtures/repositories` (the engine's own 1 MiB admission cap; 0 files excluded by
it), 1,645,992 **named** nodes. Counted by `validation/m14/fixtures/hcl/tools/construct-census.mts`,
artefact `validation/m14/fixtures/hcl/construct-census.current.json`. The walk visits **named**
children only, so this node count is not comparable with a count that includes anonymous tokens.

**Declared row.** `hcl 7/9 from=spec coverage block` — closure `7 implemented + 0 unexercised +
2 gaps = 9 applicable = 10 − 1 grammar-absence − 0 unclassified`.

---

## 1. The spec's ruling was FALSIFIED, and the artifact it cited does not exist

`script/m14/spec/hcl-completeness.json` decision **HCL-D1** ruled `calls`, `extends`, `implements`,
`overrides` and `instantiates` all "NOT APPLICABLE". Three independent measurements refute it:

1. **The code and the lane's own fixtures emit two of the five.** `src/ast/real-hcl-analyzer.ts:485`
   emits `Overrides` and `:528` emits `Calls`. The committed fixtures assert them:
   `validation/m14/fixtures/hcl/declared-function-call.expectation.json` expects **3 `calls`**
   edges, `validation/m14/fixtures/hcl/override-target-not-reference.expectation.json` expects
   **4 `overrides`** edges. `npx tsx script/m14/run-fixtures.ts --lang hcl` → `summary:
   {"hcl":{"pass":11,"fail":0}}`.
2. **Its cited adjudication does not exist.** HCL-D1's resolution ends "Adjudication:
   `fixtures/hcl/out/calls-feasibility.json`". That path does not exist on this laptop — indeed
   `$HOME/fixtures/hcl/` does not exist at all. The instrument that wrote it
   (`script/m14/tmp/hcl/calls-feasibility.mts`) imports a hardcoded
   `$HOME/backbencher-brain/src/ast/engine` — the repo is at
   `$HOME/mcp/backbencher-brain`. A ruling that rests on a missing artifact is not a
   ruling; this is the same hardcoded-path class the corrected `firing-check.mjs` header records.
3. **The old corpus root is gone too.** The previous `corpus` block (9,079 files / 9 repos) and every
   probe in `script/m14/tmp/hcl/` point at `$HOME/fixtures/hcl/repos`, which no longer
   exists. The measured population is the one above; the `corpus` block is refreshed to it.

Replacement: **HCL-D1a** (extends / implements / instantiates) and **HCL-D9** (calls / overrides),
both in the spec, both measured.

## 2. The five silent types, each classed by its own measurement

| type | class | measured (whole corpus) | effect on the denominator |
|---|---|---|---|
| `calls` | **implemented** | 12,988 `function_call` nodes over 148 distinct callees; exactly **1** declaration of the shape the analyzer reads (`function "bindir"`, `docker/docker-bake.hcl`), the only shape that yields a resolvable edge; **4 corpus edges on 1 file** (ontology-gate fresh walk today, and the prior whole-corpus census) | numerator |
| `overrides` | **implemented** | **72** blocks named `override*` in 34 files; **71** of the three kinds the analyzer reads in 33 files, **68** carrying a `target`; **68 corpus edges** (gate's fresh walk today) | numerator |
| `extends` | **GAP — stays IN** | **44** `inherits` sites in **8** docker-bake files naming **53** parents, **53 resolved** to a `target` declared in the same file, **0 unresolved** | gap; denominator 9 |
| `implements` | **grammar-absence — leaves** | **0 of 18** declaration-shaped node types produced; **0 of 455** distinct block types and **0 of 5,311** distinct attribute keys name one; the only candidate keyword `protocol` has **162 sites in 50 files** and every captured site is data (ALB/SG/enos network protocol or a matrix value) | denominator −1 |
| `instantiates` | **zero-sites — stays IN** | **3,932** resource/data blocks over **444** distinct type labels; **0** labels declared as an address anywhere in the corpus; the **2** `new` attribute-key sites are data attributes in terraform fixtures | gap; denominator 9 |

The two edge counts above are the numbers the 120-file firing stride cannot see: it draws from
**terragrunt only**, and neither construct occurs in terragrunt. That stride's SILENT column is a
fact about 120 files, not about the language — the firing-check itself prints that warning.

### Why `extends` is the interesting one

The lane's earlier instrument A enumerated **node types** and **block types** and found no
inheritance construct. That probe could not have seen this one, because docker-bake spells
inheritance as an **attribute**:

```hcl
target "_common" { dockerfile = "Dockerfile" }
target "binary"  { inherits = ["_common"] }
```

`validation/m14/fixtures/hcl/tools/construct-census.mts` enumerates the corpus's complete block-type
**and attribute-key** vocabulary and then resolves the values: 44 sites, 53 named parents, and all 53
name a `target` block declared in the same file. The construct exists, occurs, and resolves — so the
type is a **gap that stays in the denominator**, not grammar-absence. This is a self-refutation: my
own first report to the Lead (and the replacement decision I had drafted) said `extends` was
grammar-absence, on the strength of instrument A. The attribute-key inventory refuted it, and the
smaller honest denominator is what this page reports.

`implements` survives the same test with the opposite result, which is what makes the test a test:
the only keyword a DSL could have used, `protocol`, occurs 162 times and every captured site is a
network-protocol value. No corpus construct expresses contract satisfaction, and the grammar
produces no declaration node to hang one on.

## 3. Near-misses, checked rather than waved through

Every candidate keyword the corpus actually writes, and what its sites are (the census captures up
to 40 sites per word with file:line and text):

| word | sites / files | adjudication |
|---|---|---|
| `inherits` | 44 / 8 | **real**: docker-bake target inheritance; 53/53 parents resolve → `extends` GAP |
| `protocol` | 162 / 50 | data: `protocol = "HTTP"`, `"tcp"`, `matrix.protocol` → not `implements` |
| `new` | 2 / 2 | data: `new = "a_override new"` in terraform test fixtures → not `instantiates` |
| `override` | 7 / 7 | data: packer provisioner override maps, tflint fixtures → not an override block |
| `overrides` | 1 / 1 | a bare `overrides { subnet_id = … }` block (vault enos) the analyzer does not read; the 68 real ones are the three `override_*` kinds with a `target` |
| `call` | 1 / 1 | data: `call = "check"` in a vendored bake file → not a call site |
| `contains` | 20 / 2 | data: vault release-pipeline filters (`contains = ["hcp"]`); `contains` edges come from containment |
| `source` | 3,403 / 2,437 | module `source`, read as `imports` (201 block-type `source`, 3,202 attribute keys) |
| `include` | 287 / 258 | terragrunt `include`, read as `imports` |
| `use` | 70 / 28 | waypoint `use "docker" {}` plugin blocks — NOT the analyzer's `uses` (builtin-rooted reads) |

## 4. The instrument, and one trap it walked into and out of

`validation/m14/fixtures/hcl/tools/construct-census.mts` has two passes. The **tree pass** (one
`parser.parse` per file, default) enumerates the grammar vocabulary and the corpus keyword space and
counts the constructs; the **edge pass** (`BB_HCL_CENSUS_EDGES=1`, `engine.parseFile` per file) is
opt-in, because the class-deciding measurement should not have to queue behind the firing
measurement on a shared laptop. The artefact records `edges: null` — "not measured" — when the edge
pass is off; it never renders an unmeasured zero as a zero.

**Control (rule-book §7).** The control document is GENERATED from the candidate vocabulary: 49 words
planted as block types *and* attribute keys. The run exits 3 unless every one is seen by both
enumerators, unless the planted `function "double"` declaration, call sites, `override_resource` and
`resource` blocks are counted, and unless the production path emits the planted `calls`,
`overrides` and `contains` edges. Observed: 49/49 as block types, 49/49 as attribute keys,
`{"contains":160,"overrides":1,"calls":1,"exports":102}`, 0 failures. A corpus zero is therefore a
zero the probe could have seen through.

**The trap.** `script/m14/completeness-inventory.ts` (`emittedKinds`) parses EVERY non-`.json` file at
the top level of a lane's fixtures directory and counts the resulting relationship types as that
lane's emissions. This instrument was first written at
`validation/m14/fixtures/hcl/construct-census.mts`; measured through `parseFile`, that file yields
`calls contains imports references uses` **as TypeScript** — i.e. it would have credited HCL with
emissions nothing HCL-side produced. It now lives one level down, in `tools/`, where
`readdirSync(dir)` + `isFile()` does not reach it; the same admission rule was re-run and the scan
lists only the 11 `.tf` fixtures. This is the second time this lane has paid this toll
(`docs/analyzers/real-hcl-analyzer.md:561` records the first, a phantom `instantiates`), and the
same trap is live elsewhere: `validation/m14/fixtures/toml/construct-census.ts` is at the top level of
its fixtures directory and yields `calls imports instantiates references uses` through the same
scan — reported to the Lead, not touched from this lane.

## 5. Coverage declaration

`script/m14/spec/hcl-completeness.json` → `coverage`:

- **implemented (7):** `calls`, `contains`, `exports`, `imports`, `overrides`, `references`, `uses`
- **excluded (2):** `implements` = `grammar-absence` (0 of 18 / 0 of 455 / 0 of 5,311, with `protocol`
  162 data sites); `instantiates` = `zero-sites` (3,932 blocks / 444 labels / 0 declared)
- **corpusUnexercised (0)** — `calls` and `overrides` are exercised corpus-wide (4 and 68 edges), so
  they are declared implemented and explained, not parked as unexercised
- **gaps (2, still in the denominator):** `extends` (HCL-G1), `instantiates` (HCL-G2), both with a
  falsifier; `gap.gaps` now carries them so the spec and the board's derived column agree

Instrument readings, verbatim:

```
npx tsx script/m14/coverage-block-gate.ts
hcl          yes       7     9     2     calls overrides                          -
BB_BOARD_FIRING=validation/m14/results/firing-laptop-b.current.log bun script/m14/language-board.ts --coverage
hcl          7/9  from=spec coverage block
npx tsx script/m14/ontology-coverage-gate.ts hcl --fresh     # BEFORE the space check (see §6)
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
  calls 4 edges in 1+ files · overrides 68 edges · extends/implements/instantiates RULED-SOUND via #HCL-D1a
npx tsx script/m14/ontology-coverage-gate.ts hcl --fresh     # AFTER the space check
key spaces: 35,627 key/value bindings observed over 4047 files (top node types attribute=28,222, object_elem=7,398)
attestation hcl: … VERIFIED nodeTypes=64, blockTypes=455, attributeKeys=5311, extends.constructSites=44
emitted 7/10   ruled-sound 2   FALSIFIED 1   ruled-without-justification 0
  extends FALSIFIED (44 attested sites) · implements/instantiates RULED-SOUND with the attestation
```

## 6. The shared gate had the same blind spot — reproduced, fixed, and its fleet effect measured

This lane's `extends` correction exposed a defect in the SHARED arbiter, not just in its own ruling.
`script/m14/ontology-coverage-gate.ts` certified `RULED-SOUND` from a node-type inventory, so on
2026-10-09 it printed, for this lane:

```
extends      RULED-SOUND    NOT EMITTED; the construct occurs 0x on the parse tree. Written ruling: script/m14/spec/hcl-completeness.json#HCL-D1a
```

while the corpus held 44 `inherits` sites with 53/53 resolvable parents. Two defects are visible in
that one line: the probe was a **node-type inventory** (which cannot see an attribute-key construct),
and the basis text claimed a **tree count that no probe had taken** — a spec-sourced ruling has no
Instrument-B entry, so "occurs 0x on the parse tree" was printed without anything having counted.

**Fix (in the shared gate).** The gate now observes the key space structurally — a node with `=` or
`:` between two named children is a key/value binding in any grammar — and a *vocabulary-based*
ruling (instrument A, or a spec-text ruling with no table entry) in such a language is
`RULED-UNJUSTIFIED` unless it declares the `attribute-keys` space. Spaces are declared either as
`spacesProbed` in the lane's ruling table or in `validation/m14/fixtures/<lang>/ruling-attestation.json`,
and an attestation must cite an artefact that EXISTS whose JSON pointers hold the declared counts.
Instrument-B rulings are exempt (a semantic tree count is not a vocabulary blind spot). The gate's own
control runs on **every** invocation, prints, and exits 3 if any arm stops behaving:

```
space check self-test: PASS — 8/8 arms (fires on a node-type-only ruling in a key-bearing language;
passes an attested one; a ruling contradicted by its own artefact fails)
```

**This lane's attestation** is `validation/m14/fixtures/hcl/ruling-attestation.json`. It declares
node-types + block-types + attribute-keys and points at the census artefact; the gate verifies
`nodeTypes=64, blockTypes=455, attributeKeys=5311, extends.constructSites=44` against it. That is why
`implements`/`instantiates` are `RULED-SOUND` (0 sites in the attested key space) and `extends` is
**FALSIFIED** — the honest reading of HCL-G1: the type is derivable and unimplemented, so the gate
should keep failing this lane until it is emitted.

**Fleet effect, measured with a fresh whole-corpus walk per lane** (rows whose status changes are the
point of the exercise; `RULED-SOUND → RULED-UNJUSTIFIED` means the ruling was certified on a
vocabulary that cannot see the space the language uses):

| lane | key/value bindings / files | flipped rows |
|---|---|---|
| toml | 19,500 / 1,486 | **6** — calls, uses, exports, extends, implements, instantiates |
| css | 773,735 / 1,228 | **3** — calls, implements, instantiates |
| bash | 60,454 / 4,224 | **3** — extends, implements, instantiates |
| sql | 13,979 / 1,964 | **3** — exports, extends, implements |
| xml | 590,892 / 11,562 | **3** — exports, implements, instantiates |
| graphql | 141 / 1,911 | **2** — calls, instantiates |
| scss | 74,468 / 4,433 | **2** — implements, instantiates |
| hcl | 35,627 / 4,047 | **1 FALSIFIED** — extends (44 attested sites) |
| protobuf | 193 / 847 | 0 |
| clean | 2,309 / 312 | 0 |
| r | 809 / 2,184 | 0 (emits all ten) |
| powershell | 22,824 / 1,181 | 0 (emits all ten) |
| markdown | **0** / 17,460 | 0 (no attribute-key syntax at all — the clean control) |

**22 rows across 7 lanes** moved out of `RULED-SOUND`, and 5 surveyed lanes were unaffected — the
check discriminates rather than failing everything. Markdown is the sharpest control: its corpus
writes **zero** key/value bindings, so its six spec-sourced rulings stay `RULED-SOUND` — the check
fires on the observation, not on the fact that a ruling exists. Every flipped lane needs one of two
things: an attestation that its probe really did enumerate the key space, or a real re-measurement.
(The `json` walk is the heaviest of the batch and was still running when this page was committed; its
row is not reported here rather than reported as zero. It was killed for budget after 20 minutes and
is reported as NOT COMPLETED, never as a zero.)

### 6.1 The same walk hid a SECOND false `RULED-SOUND`, and that one is now a refusal

Surveying the fleet exposed the defect the Lead then made the next task: on a **history-trusted
checkpoint** the gate's `EMITTED` column covers only the files it re-walked, because the checkpoint
stores per-file OUTCOMES and not per-file relationship types — so a settled file contributes **no
edges**. Measured on hcl: a default run re-measured 5 of 4,047 files and printed

```
calls      RULED-SOUND   NOT EMITTED; the construct occurs 0x on the parse tree. …
overrides  RULED-SOUND   NOT EMITTED; …
```

while a fresh walk of the same corpus carries **4 `calls` edges and 68 `overrides` edges**. A false
`RULED-SOUND` in the default invocation, with no signal in the row.

**Fix.** The walk's population is now computed once, printed, and attached to every row it affects:
`walk: emitted population 0/4,047 files measured by the analyzer THIS run (4,047 settled by an
earlier walk and contributing NO edges …) — PARTIAL, so absence is NOT certifiable`. A row that would
have been `RULED-SOUND` while any offered file was settled, degraded or abandoned now reads
**`RULED-UNKNOWN`** — a refusal, not a failure, and never a certification. `FALSIFIED` and
`RULED-UNJUSTIFIED` pass through unchanged: both are findings about the ruling and neither depends on
the `EMITTED` column. Three control arms cover it (I: a partial walk refuses to certify; J: the same
ruling on a complete walk still certifies; K: a partial walk does not soften a key-space
`RULED-UNJUSTIFIED`).

The rule is strict on purpose, and the strictness is visible: on hcl's fresh run **one file of 4,047
is degraded** by the regex fallback, so `implements` and `instantiates` — attested and verified, 0
sites in the key space — read `RULED-UNKNOWN` rather than `RULED-SOUND`. Absence is not established
about a file the analyzer never read, and withholding the certificate is the honest answer.

## 7. What this page does NOT settle

1. **My census did not measure edges.** Its edge pass was off (it is opt-in and the machine is
   shared). The 4 `calls` and 68 `overrides` edges come from the ontology gate's fresh walk today and
   the prior whole-corpus census; the construct counts (44/53/8, 3,932/444/0, 162/50) are mine.
2. **The fleet survey is partial by budget, not by intent.** Thirteen lanes were re-walked fresh (the
   table in §6); `json` was killed for budget after 20 minutes holding the heavy lock — reported as
   NOT COMPLETED, not as a zero — and `dart`, `fsharp`, `nim`, `zig`, `php`, `yaml`, `julia` and `lua`
   still need a run. The survey also predates §6.1's population gate: the flips it reports
   (`RULED-SOUND → RULED-UNJUSTIFIED`) are unaffected, but rows that stayed `RULED-SOUND` there would
   now additionally need a complete emitted population, so some of them would read `RULED-UNKNOWN`
   today. Every flipped lane still needs its own owner to attest or re-measure.
3. **`errorFiles 244` / `missingNodes 6`** in the spec's `corpus` block are the previous census's
   figures and were not re-measured; only `files`, `repos`, `nodes`, and the 63-of-64 grammar-type
   observation were (the last re-confirmed corpus-wide: `template_else_intro` still unobserved, and
   `ERROR` still the one runtime node).
4. **Recall / precision 0.999931 / 1.000000** belong to the previous 9,079-file population and were
   not re-measured on this one.
5. **`extends` is measured, not fixed.** The analyzer still emits no `extends` edge; HCL-G1 records the
   fix shape (a `target`-scoped `inherits` reading), and the ontology gate now fails this lane because
   of it. The `func` spelling of user-defined functions (0 corpus occurrences) and cross-file function
   resolution (0 sites) remain the analyzer's declared limitations.
6. **`module` blocks are not `instantiates`.** A `module "x" { source = "./child" }` is published as
   `imports` (target = the source string). Whether module instantiation should also be an
   `instantiates` edge is not settled by this census; HCL-G2's falsifier is the test that would
   decide it, and no corpus file currently declares a type a resource block instantiates.

## 8. Reproducing every number here

```bash
# the firing sample (control prints itself; exit 3 means do not trust the SILENT column)
NFILES=120 bun script/m14/firing-check.mjs HCL

# the whole-corpus construct census (tree pass, ~20 s; control exits 3 if it cannot see a planted case)
npx tsx validation/m14/fixtures/hcl/tools/construct-census.mts
# …and the edge pass over every file, when the machine allows it
BB_HCL_CENSUS_EDGES=1 npx tsx validation/m14/fixtures/hcl/tools/construct-census.mts

# the declaration
npx tsx script/m14/coverage-block-gate.ts
BB_BOARD_FIRING=validation/m14/results/firing-laptop-b.current.log bun script/m14/language-board.ts --coverage
npx tsx script/m14/ontology-coverage-gate.ts hcl --fresh

# the shared gate's space check, and its own control (the control also runs unasked, and exits 3)
npx tsx script/m14/ontology-coverage-gate.ts --self-test

# the fixture lane
npx tsx script/m14/run-fixtures.ts --lang hcl
```

Raw artefacts: `validation/m14/fixtures/hcl/construct-census.current.json` (census),
`validation/m14/results/firing-laptop-b.current.log` (firing sample),
`docs/analyzers/real-hcl-analyzer.md` (the prior whole-corpus census and the analyzer's contract).
