# HCL lane — `hcl` (engine language id; `HCL` in the firing log)

Lane owner: **hcl-lane**. Verdict page, refutation-first. The analyzer's own long-form document is
`docs/analyzers/real-hcl-analyzer.md` (outside this lane's write scope); this page carries what the
COVERAGE DECLARATION rests on, the measurements behind it, and what it does NOT settle.

**Corpus.** 9,329 git-tracked `.tf` / `.tfvars` / `.hcl` / `.tofu` files over 16 repositories under
`$HOME/fixtures/repositories` (the engine's own 1 MiB admission cap; 0 files excluded by
it), 1,645,992 **named** nodes. Counted by `validation/m14/fixtures/hcl/tools/construct-census.mts`,
artefact `validation/m14/fixtures/hcl/construct-census.current.json`. The walk visits **named**
children only, so this node count is not comparable with a count that includes anonymous tokens.

**Declared row.** `hcl 8/9 from=spec coverage block` — closure `8 implemented + 0 unexercised +
1 gap = 9 applicable = 10 − 1 grammar-absence − 0 unclassified`.

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
| `extends` | **implemented** (HCL-D10, 2026-10-09) | **44** `inherits` sites in **8** docker-bake files naming **53** parents, **53 resolved**, **0 unresolved**; **53 `extends` edges** emitted, 53/53 binding to a declared `target` — label limit measured: 16 of 44 children re-declare an inherited key, so this is merge-reuse, not a subtype hierarchy | numerator |
| `implements` | **grammar-absence — leaves** | **0 of 18** declaration-shaped node types produced; **0 of 455** distinct block types and **0 of 5,311** distinct attribute keys name one; the only candidate keyword `protocol` has **162 sites in 50 files** and every captured site is data (ALB/SG/enos network protocol or a matrix value) | denominator −1 |
| `part_of` | **implemented at R3** (HCL-D11, 2026-10-28) | **287** terragrunt `include` blocks over the whole admitted population (9,329 files / 16 repos, the same `tf,hcl,tfvars,tofu` router set the arm counts): **22** with a literal `path` (all 22 naming a file inside the admitted population), **265** computed (`find_in_parent_folders(...)` / interpolated templates — refused, not guessed); the production path emits exactly **22 `part_of` edges over 17 files**, 22/22 literal sites, exact. Module `source` is the DISCRIMINATOR, not the construct: **2,042** sites (941 local, 496 registry, 193 vcs, 364 registry-subdir, 49 dynamic), all inclusion-by-reference addressed `module.NAME.*`, none a textual splice — so `imports`, never `part_of`. Artefact `validation/m14/fixtures/hcl/extended-census.current.json`, fixture `terragrunt-include.tf` (pre-change 12 pass / 1 fail, post-change 13 pass / 0 fail) | numerator |
| `mixes_in` | **RULED ontological — leaves** (HCL-D12, 2026-10-28) | whole admitted population 9,329 files / 16 repos: `dynamic` 374 blocks write their generated members in the source `content` block (15 with nested block children, 359 attribute-only) and iterate VALUES (`for_each` 859 sites = 306 identifier reads / 263 calls / 218 conditionals / 41 for-expressions / 28 collections / 3 literals); `lifecycle` 227 and `provisioner` 294 are members the enclosing resource itself declares (already `contains`); module `source` 2,042 and `providers` 38 reference a separate unit whose members stay namespaced `module.NAME.*` (HCL-D11). A `mixes_in` row would require DESIGNATING a variable's value map as the member set and a resource block as the composer — a designation the tree does not say, so the type is ruled with a falsifier rather than invented | denominator −1 |
| `decorates` | **RULED ontological — leaves** (HCL-D14, 2026-10-28) | shows the decoration SHAPE and none of it is a callable application, measured on the whole admitted population (9,329 files / 16 repos): `validation` blocks **1,228** (**992** invoke a function inside the CONDITION — evaluated by Terraform, its boolean result is the assertion, never applied TO the declaration), `precondition`/`postcondition` **57** (**16** with a call in the condition), `depends_on` attribute sites **883** (a list of ADDRESSES expressing ordering; already published as `references`), **0** declaration-attached callable sites. Ladder: R1 — the pinned grammar's 64 named node types have no decorator-shaped production and every published build is the same container grammar; R2 — a patch would have to INVENT a syntax no HCL dialect has; R3 — the assertion blocks and `depends_on` are the only decoration-shaped nodes and they are the near misses. Falsifier: a corpus construct in which a callable is applied TO a declaration (the declaration is the subject the callable transforms/annotates) | denominator −1 |
| `renders` | **RULED ontological — leaves** (HCL-D15, 2026-10-28) | HCL HAS templates and they render STRINGS, not declarations: whole admitted population (9,329 files / 16 repos) — `templatefile()` **60** call sites, **0** with a literal path (all 60 pass a computed `"${path.module}/…"`), **0** naming an admitted file; `templatestring()` **2**; `template_dir()` **0**; `template_file`/`template_dir` data sources **21** (output read as a VALUE via `data.template_file.NAME.rendered`, already `references`); `quoted_template` nodes **3,710**, `heredoc_template` nodes **3,506**; **0 declaration-target candidates**. Ladder: R1 — every published build carries the same template productions and no declaration-target notion; R2 — the template nodes already exist, and no HCL dialect has a syntax naming a declaration as a render target, so a patch would invent one; R3 — the template nodes are already read (interpolated references published), and an edge needs a declaration target the language does not provide. Class is ONTOLOGICAL because the grammar HAS the nodes — a grammar-absence claim would be false. Falsifier: a corpus render that NAMES a declaration as its target (e.g. a `templatefile` literal path to an admitted declaration file whose members are rendered into a declaration) | denominator −1 |
| `instantiates` | **implemented — CORPUS-UNEXERCISED** (HCL-D13, 2026-10-28) | the analyzer publishes it at R3 from `resource`/`data` blocks: source = the declaring document's root-module symbol, target = the PROVIDER TYPE label as written (`aws_instance`), `metadata.instanceType`/`instanceKind`/`instanceName`; no declaration is invented for the type. Whole admitted population (9,329 files / 16 repos): **3,932** resource/data blocks over **444** distinct type labels, **0** labels declared as a TYPE — a provider type is declared by a provider binary, in no repository. The **42** address collisions are all names of other kinds (**14** variables, **12** modules, **6** outputs, **2** providers, **4** label-less resource blocks, **1** label-less data block, **3** DSL blocks http/test/beep), and **997** of the 3,932 sites carry a colliding label — production resolution matches by name with no kind filter, so the arm's `resolved` column is an UPPER BOUND on correct type binding. Doability pinned by `instantiates-resource-type.tf` (pre-change 13 pass / 1 fail, 5 rows missing; post-change 14 pass / 0 fail, 9 forbids). Falsifier: a corpus file declaring one of the 444 labels as a type | numerator (counted once; unexercised is its property) |

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

**Then the gap was closed, and its label's limit was measured with it (HCL-D10).** The analyzer now
reads `inherits` inside a `target` block and emits one `extends` edge per DECLARED parent, resolved
after the DFS because docker-bake.hcl's own `binary-cross` inherits `_platforms`, declared BELOW it;
an unresolved parent publishes nothing, because a dangling `extends` is worse than a missing one.
Measured: **53 edges over the 8 files, 53/53 binding to a declaration in the same file, 0
unresolved** — and the gate's hcl row moved from `extends FALSIFIED` to `extends EMITTED 53 edges`.
The fixture `validation/m14/fixtures/hcl/docker-bake-inherits.tf` was authored BEFORE the change and
its pre-change run is recorded as **11 pass / 1 fail**; after the change the suite is **12/12**.

The label's limit, stated rather than hidden: `inherits` **merges** definitions, so `extends` here
asserts reuse-of-a-declaration, not a subtype hierarchy — **16 of the 44** inheriting targets
re-declare at least one key they also inherit, and 25 of the 53 parent occurrences are abstract bases
by docker-bake's leading-underscore convention while the rest are functional targets. `extends` is
the house label for exactly this shape (the yaml lane labels `<<: *base` merge-key reuse `extends`),
the relation is between declarations, and a change to the parent does propagate to the child. NOT
published, and therefore declared: a child's re-declaration of an inherited key is **not** a separate
`overrides` edge (16 sites).

`implements` survives the same test with the opposite result, which is what makes the test a test:
the only keyword a DSL could have used, `protocol`, occurs 162 times and every captured site is a
network-protocol value. No corpus construct expresses contract satisfaction, and the grammar
produces no declaration node to hang one on.

## 3. Near-misses, checked rather than waved through

Every candidate keyword the corpus actually writes, and what its sites are (the census captures up
to 40 sites per word with file:line and text):

| word | sites / files | adjudication |
|---|---|---|
| `inherits` | 44 / 8 | **real**: docker-bake target inheritance; 53/53 parents resolve → `extends` EMITTED (53 edges, HCL-D10) |
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

- **implemented (8):** `calls`, `contains`, `exports`, `extends`, `imports`, `overrides`, `references`, `uses`
- **excluded (2):** `implements` = `grammar-absence` (0 of 18 / 0 of 455 / 0 of 5,311, with `protocol`
  162 data sites); `instantiates` = `zero-sites` (3,932 blocks / 444 labels / 0 declared)
- **corpusUnexercised (0)** — `calls` and `overrides` are exercised corpus-wide (4 and 68 edges), so
  they are declared implemented and explained, not parked as unexercised
- **gaps (1, still in the denominator):** `instantiates` (HCL-G2), with a falsifier; `gap.gaps`
  carries it plus HCL-G1 marked CLOSED, so the spec and the board's derived column agree

Instrument readings, verbatim:

```
npx tsx script/m14/coverage-block-gate.ts
hcl          yes       8     9     2     calls extends overrides                  -
BB_BOARD_FIRING=validation/m14/results/firing-laptop-b.current.log bun script/m14/language-board.ts --coverage
hcl          8/9  from=spec coverage block
npx tsx script/m14/ontology-coverage-gate.ts hcl --fresh     # BEFORE the space check (see §6)
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
  calls 4 edges in 1+ files · overrides 68 edges · extends/implements/instantiates RULED-SOUND via #HCL-D1a
npx tsx script/m14/ontology-coverage-gate.ts hcl --fresh     # AFTER the space check
key spaces: 35,627 key/value bindings observed over 4047 files (top node types attribute=28,222, object_elem=7,398)
attestation hcl: … VERIFIED nodeTypes=64, blockTypes=455, attributeKeys=5311, extends.constructSites=44
emitted 7/10   ruled-sound 2   FALSIFIED 1   ruled-without-justification 0
  extends FALSIFIED (44 attested sites) · implements/instantiates RULED-SOUND with the attestation
npx tsx script/m14/ontology-coverage-gate.ts hcl --fresh     # AFTER HCL-D10 landed
  extends EMITTED 53 edges · calls 4 · overrides 68
emitted 8/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0   ruled-unknown 2
npx tsx script/m14/run-fixtures.ts --lang hcl                # before HCL-D10: 11 pass / 1 fail; after:
summary: {"hcl":{"pass":12,"fail":0}}
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
5. **`extends` is emitted, and its label is a judgment the Lead may overrule.** HCL-D10 publishes 53
   `extends` edges for docker-bake `inherits`; the relation is a MERGE (16 of 44 children re-declare an
   inherited key), labelled `extends` on the yaml merge-key precedent. If a reviewer reads that as an
   overstatement, the honest alternative is to reopen HCL-G1 and unpublish the edges — the measurement
   needed for that decision is in HCL-D10 and needs no new run. The `func` spelling of user-defined
   functions (0 corpus occurrences) and cross-file function resolution (0 sites) remain the analyzer's
   declared limitations.
6. **`module` blocks are not `instantiates`.** A `module "x" { source = "./child" }` is published as
   `imports` (target = the source string). Whether module instantiation should also be an
   `instantiates` edge is not settled by this census; HCL-G2's falsifier is the test that would
   decide it, and no corpus file currently declares a type a resource block instantiates.

## 8. The RESIDUAL worklist — the completion bar, and the first cause named

`hcl 8/9` is the coverage answer and it is not the completion answer. The completion bar is that every
emitted edge of every applicable type resolves to exactly one real declaration, with zero unexplained
edges. Measured whole-population by `npx tsx script/m14/residual-gate.ts --lane hcl`:

| type | edges | resolved | amb(decl) | unresolved | residual% |
|---|---|---|---|---|---|
| contains | 97,550 | 29,040 | 68,299 | 211 | 70.2% |
| references | 31,228 | 1,031 | 727 | 29,470 | 96.7% |
| exports | 23,103 | 4,421 | 18,471 | 211 | 80.9% |
| uses | 1,909 | 0 | 0 | 1,909 | 100.0% |
| imports | 1,853 | 0 | 12 | 1,841 | 100.0% |
| **TOTAL** | **155,643** | **34,492** | **87,509** | **33,642** | **77.8%** |

`resolved 22.2%`, `extFAIL 0`, `bindFAIL 0`, `causeFAIL 0` — nothing here is a broken claim; it is all
unresolved or ambiguous resolution. **Read this table as the PRE-CORRECTION model**: `fa2dc27e8`
taught the gate that `contains` resolves by its own statement, and the correction is what collapsed
the 68,299 bucket below. The table is kept because it is the worklist the lane was handed, and the
store measurement under it is what priced the bucket.

### Cause 1 — `contains` amb(decl) 68,299: an INSTRUMENT artifact, priced against the STORE

The gate's count model classified `contains` by declaration count, so a target whose name occurs twice
in a repository read ambiguous. Production does not work that way: `contains` is resolved at INSERT
time by `resolveContainsTargetStmt` — `ORDER BY (s.file_id = ?) DESC, (s.line_start = ?) DESC … LIMIT 1`
— the edge's OWN FILE first, exactly one row, with no "N candidates" state. xml-lane found it
(count model 94.1% ambiguous vs store 98.4% bound) and the gate now models it.

Measured here with the store itself
(`validation/m14/fixtures/hcl/tools/store-binding-truth.mts`, report
`validation/m14/fixtures/hcl/store-binding-truth.terraform.json`), one project, same files, model and
store side by side:

| type | store rows | bound | same file | other file | unbound | model resolved | model amb |
|---|---|---|---|---|---|---|---|
| contains | 1,046 | **1,042 (99.6%)** | **1,010 (96.6%)** | 32 | 4 | 125 (12.0%) | 503 (48.1%) |
| exports | 215 | 213 (99.1%) | 169 | 44 | 2 | 35 | 179 |
| references | 25 | 22 | 20 | 2 | 3 | 5 | 2 |
| imports | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| **total** | **1,287** | **1,277 (99.2%)** | **1,199 (93.2%)** | **78 (6.1%)** | **10 (0.8%)** | **165 (18.9%)** | **684 (78.3%)** |

So the bucket that was 56% of this lane's residual **collapses against the store**: `project.license`,
`listener.tcp`, `schema_version` are exactly the shape production binds to the edge's own file. THE
FILE-SCOPING PRICE IS NOT PAID — no public identifier-space change, no fixture churn.

**The cause that remains is the OTHER-FILE rate: 78 edges (6.1%).** Those are edges bound to an
identically named declaration in a DIFFERENT file — `basic_set_null/main.tf`'s
`tfcoremock_set.set` binding to `basic_set/main.tf`'s declaration, `.terraform.lock.hcl` files
binding to another lock file's `registry.terraform.io/...` — which happens when the edge's own module
does not declare (or the index does not hold) the name it spells. That is a wrong edge a name-space
change WOULD fix, and it is priced at 78 edges for this project, not 68,299 — a different decision
from the one the model's number suggested, and one that needs the whole population before it is taken.

### Cause 2 — `exports` amb 18,471: the gate's second count-model artifact, AND a real wrong-binding class under it

The gate's `amb(decl)` for a non-`contains` type is a count model too: production's `resolveTargetStmt`
is `LIMIT 1` as well, so a row is always written. But the indexer's own comment on that statement is
decisive about what the row MEANS — it orders by `s.id` alone, which is `${fileId}:${name}:${line}`
compared as TEXT, so "it is the LEXICOGRAPHICALLY smallest line that wins, NOT the intended symbol",
with a measured control arm of 37,318 of 49,729 ambiguous edges bound to the WRONG symbol. So the
honest question is not "resolved or ambiguous" but "bound to the INTENDED declaration or to an
arbitrary twin".

Measured with the store (terragrunt, even-stride draw of 900 files → **894 indexer-eligible**,
4,389 symbols, 7,609 relationship rows; report
`validation/m14/fixtures/hcl/store-binding-truth.terragrunt-900.json`). For `contains` and `exports`
the analyzer writes the edge on the TARGET SYMBOL's own start line, so OWN FILE + OWN LINE is the
intent test:

| type | store rows | bound | own file + own line | own file off-line | other file | unbound | model amb |
|---|---|---|---|---|---|---|---|
| contains | 5,728 | 5,698 (99.5%) | **5,417 (94.6%)** | 12 | 269 (4.7%) | 30 | 2,632 |
| exports | 1,273 | 1,272 (99.9%) | **1,075 (84.4%)** | **0** | **197 (15.5%)** | 1 | 1,087 |
| references | 566 | 503 (88.9%) | 32 (5.7%) | 240 | 231 (40.8%) | 63 | 41 |

Verdict, in two halves:

1. **`exports`' 18,471 "ambiguous" is a count-model artifact in the same way `contains`' 68,299 was** —
   99.9% of exports rows bind. `fa2dc27e8`'s correction applies to it too; a lane must not rename its
   identifier space on that number.
2. **But 15.5% bind to ANOTHER file's identically named declaration, and that is a real wrong edge.**
   The intent test is exact for exports: **every same-file binding is on its own line (1,075/1,075,
   0 off-line)**, and 197 rows cross the file boundary — 139 of them landing on a same-line twin in a
   different file, which is the arbitrary pick the `s.id` ordering produces. `contains` crosses the
   boundary at 4.7%, `exports` at 15.5%: the store distinguishes them, the gate's single ratio does
   not. **The gate needs a THIRD outcome** — `bound-to-an-arbitrary-twin` — or the 15.5% hides inside
   a number that reads as success.
3. The name-space lever is therefore justified for `exports` (and probably `references`), NOT for
   `contains`: exports' edge names the DOCUMENT's own export, so a cross-file binding is wrong by
   construction, while `contains` is resolved by production with its own statement against the edge's
   own file. Priced from this sample: ~15.5% of 23,103 exports edges ≈ 3,600 rows project-wide, to be
   confirmed on the whole population before any rename.

`references` in the same sample: the model calls 514 of 566 unresolved, the store binds 503 — so the
model OVERSTATES unresolved there too (production's I13 pass rebinds a non-dotted target by name
ranked same-file-first). Its intents are not measurable by line (the edge line is the READ SITE), and
231 of 503 bound rows cross a file boundary — the next cause to price, and the one where a declared
external claim (provider types, `var.*` module inputs) is the likely verdict rather than a rename.

### Cause 3 — `references`: the class split whole-population, and why the claim must NOT be written against it

Whole-population gate run (`incoming-gate.ts hcl hcl 0`, 4,047 `.hcl` files — note this is the
`.hcl` spelling only; the residual gate's 31,228 references admit more spellings, so the two are
different populations and both are labelled), BINDING INTENT block:

| type | edges | intended | sameFileUnproven | arbitraryTwin | noDeclaration |
|---|---|---|---|---|---|
| references | 10,899 | 0 (line test N/A) | 869 | 1,221 | **8,809** |
| contains | 40,916 | 40,916 | 0 | 0 | 0 |
| exports | 8,461 | 8,461 | 0 | 0 | 0 |
| uses | 164 | 0 | 0 | 32 | 132 |
| TOTAL | 60,754 | 49,377 | 926 | 1,253 | 9,198 |

The model's reading is "80.8% of references name nothing in the project". **The store says that is an
overstatement by 8×, and the difference is the I13 pass.** Measured on terragrunt-900
(`store-binding-truth.terragrunt-900.json`): the model calls **514** of 566 references unresolved while
the store leaves **63** unbound — production rebinds a NON-DOTTED target by name, same-file first, so
"the model found no declaration" and "no row was written" are different facts.

**And the same row carries the second finding, which must stay separate:** of the store's 503 bound
references, **487 (96.8%) bind only after LEAF REDUCTION** — the analyzer publishes a chain
(`dependency.hello_world.outputs.rendered_template`, `data.aws_caller_identity.current.account_id`) and
the store matches its LAST SEGMENT. So most of that 88.9% bound is a leaf-name coincidence rather than
a resolution of the reference, and the middle case — bound by leaf reduction, possibly wrong — has no
column in either instrument.

**Consequence for the claim, and the reason it is not written yet:** the claim set is the
STORE-UNBOUND class (63 of 566 in the sample, ≈11%; classes: terragrunt `dependency.*.outputs.*` whose
module is not in the population, provider-backed attribute chains, `values.*`/`local.*` reads, and in
the other repos `var.*` roots plus `provider.*`/`terraform.*` aliases), NOT the model's 8,809
`noDeclaration`. A claim emitted against `noDeclaration` would mark ~8,000 edges external that
production in fact binds, and would leave the 487 leaf-reduced bindings hidden under it — a residual
number that moves without the graph getting truer. Per the settled rule these are NAMES genuinely
outside the population, so the marker is the external claim (owner-verified where undeclared) and
NEVER a file claim, because a miss refutes and `extFAIL` must stay 0. Before/after on the same
population is the next step, with the leaf-reduction count printed beside it.

### Cause 4 — `uses`: the builtin claim CAN miss, so it is NOT written — 29 of 128 sampled edges refute

The proposal was that `uses` is external BY CONSTRUCTION (its label comes from the analyzer's own
`BUILTIN_ROOTS = {count, each, self, path, terraform}`), so an external claim on it "cannot miss".
The claim mechanism's own verifier says otherwise, and the check is one line of measurement: a claim
is REFUTED when the target's OWNER is a declared symbol, so the question is not whether `count.index`
is a declaration but whether anything in the project is named `count`.

Measured (600-file stride over the 9,329-file population, 16 repos):

| builtin root | `uses` edges | owner declared in the project | verdict |
|---|---|---|---|
| `each` | 85 | 0 | safe so far |
| `path` | 30 | **17 (57%)** | REFUTABLE |
| `count` | 7 | **7 (100%)** | REFUTABLE |
| `terraform` | 6 | **5 (83%)** | REFUTABLE |
| **total** | **128** | **29 (23%)** | a blanket claim would put 29 edges into `extFAIL` |

The refutations are not the verifier misbehaving; they are HCL's own shape. `count = 3` is an
ATTRIBUTE, and this analyzer publishes attribute keys as symbols, so a project that uses `count`
declares a symbol named `count`. `include { path = … }` declares `path`. `terraform { … }` declares
`terraform`. A builtin NAMESPACE and a project DECLARATION can share a spelling, and the owner test
cannot tell them apart.

So the claim is written for `each` only (zero refutations in the sample) or NOT AT ALL — and the honest
answer at this size is not at all, because a claim over 128 edges that refutes 29 of them would put
`extFAIL` above 0 and make the lane's `uses` row look better while adding 29 false externalities to
the graph. What WOULD justify the full claim is an instrument change, not an analyzer one: a NAMESPACE form of
the claim, and the Lead has settled its design (authorized as a separate instrument task, deliberately
NOT landed at the end of a turn and not by this lane alone):

* a NEW claim kind — the target asserts *"my root is a language namespace, not a declaration"* —
  carrying the analyzer's root list (`count, each, self, path, terraform`) as its evidence;
* the verifier checks the target's ROOT against THAT LIST, never against the symbol table — which is
  the only way the collision above stops mattering;
* it must stay REFUTABLE: a target whose root is not in the declared list is `externalRefuted`, so the
  kind cannot become a blanket excuse;
* the list is PART OF THE CLAIM, so widening it is a visible, reviewable act rather than a silent one.

With that kind, all 1,909 `uses` edges claim cleanly and `extFAIL` stays 0 for a structural reason —
which is what the current mechanism cannot deliver, and what this measurement showed.

### Cause 5 — the WHOLE-POPULATION store-unbound split, and the four-clause answer

Sixteen repositories, each indexed as its OWN scratch project (one store run each, order preserved;
a pooled scratch would change the per-project key space), **6,838 indexer-eligible files, 2,491 refused
by the indexer**. Artefact: `validation/m14/fixtures/hcl/store-binding-truth.whole-population.json`.

| type | store rows | bound | unbound | same file | other file | leaf-reduced |
|---|---|---|---|---|---|---|
| contains | 208,167 | 207,993 | 174 | 204,823 | 3,170 | 90,543 |
| references | 35,379 | 33,297 | **2,082** | 18,995 | 14,302 | **30,194** |
| exports | 24,863 | 24,851 | 12 | 22,993 | 1,858 | 0 |
| uses | 1,806 | 1,387 | **419** | 288 | 1,099 | 1,355 |
| imports | 1,366 | 19 | **1,347** | 17 | 2 | 8 |
| extends | 53 | 53 | 0 | 29 | 24 | 0 |
| **total** | **271,638** | **267,604** | **4,034** | — | — | — |

**The claim set for `references` is 2,082 rows (5.9%), by named class**: `data` 511 · `module` 434 ·
`global` 247 · `var` 212 · `provider` 134 · `local` 99 · `random_string` 73 · `aws` 70 ·
`aws_instance` 27 · `quality` 23 · `build` 17 · `values` 17 — provider types, module outputs,
cross-module variable reads. Compare the MODEL's `noDeclaration` 8,809 on the `.hcl`-only population:
the overstatement is ~4x on a wider population, which is the same direction the terragrunt-900 draw
found (514 vs 63). **And 30,194 of the 33,297 bound references (90.7%) bind only after LEAF
REDUCTION** — that column travels with the claim, because it is the difference between "resolved" and
"matched a leaf name".

`imports` is the clean external/file case: **1,347 of 1,366 unbound**, and the unbound spellings are
module sources (`cloudposse/stack-config/yaml//modules/remote-state` 271, `git::https://github` 170,
`cloudposse/label/null` 40 …) — names outside the population, no file claim available.
`uses` unbound 419 with roots `each` 200 · `path` 168 · `count` 44 · `self` 5 · `terraform` 2 — the
namespace-claim case, still unbuilt.

### Cause 6 — the NAME-SPACE LEVER, PRICED at whole population: 4,725 rows, not 19,330

The lever (a FILE-SCOPED identity published and targeted) is priced on the store by asking, per row,
whether a declaration in the EDGE'S OWN FILE answers to the target while the store bound elsewhere or
nowhere — that is what a scoped identity would move. Fifteen of sixteen repositories (one store run
each; **`terraform-aws-components` was KILLED — `timeout` exit 124 after 900 s, its 1,809 eligible
files are NOT in these totals and are reported as KILLED, never as a zero**), 5,029 indexer-eligible
files, 129,941 store rows. Artefact: `validation/m14/fixtures/hcl/store-binding-truth.lever-price.json`.

| type | store rows | other-file | unbound | **PRICE (scoped would move)** | of those leaf-reduced | already bind inside the own file |
|---|---|---|---|---|---|---|
| contains | 98,899 | 2,462 | 164 | **2,462** | 843 | 96,273 |
| references | 17,670 | 8,557 | 1,478 | **678** | 85 | 787 |
| exports | 12,161 | 1,561 | 10 | **1,561** | 0 | 10,590 |
| uses | 812 | 608 | 169 | **0** | 0 | 0 |
| imports | 342 | 0 | 334 | **0** | 0 | 0 |
| **total** | **129,941** | **15,749** | — | **4,725** | **928** | **107,683** |

READ IT AGAINST THE WRONG-BINDING CLASS: 15,749 rows bind to another file, but only **4,725** have an
own-file declaration a scoped identity could move them to — **the other ~11,000 name a declaration
that genuinely lives elsewhere or nowhere**, so no rename touches them. The lever is therefore NOT the
lane's main cause: it is ~1.7% of the store rows in scope, and `references` — the largest residual —
would move only **678 of its 8,557 cross-file bindings (8%)**.

WHERE IT DOES PAY, exactly as argued: **`exports` 1,561 of 1,561** — every cross-file export binding
is wrong by construction and a scoped identity fixes all of them. `contains` shows 2,462, which is a
QUESTION rather than a gain: production resolves `contains` with its own own-file-first statement, so
a row that bound elsewhere while the own file answers wants explaining before any rename credits it.
`uses` and `imports` price at zero: their targets are namespaces and module paths with no own-file
declaration to move to.

THE OVERLAP COLUMN the Lead asked to travel with the price: of the 4,725 movable rows, **928 (20%)
currently bind only after LEAF REDUCTION** — those are the rows where "bound" is already a leaf-name
coincidence that a scoped identity would either fix or break, so the net gain cannot be counted as
4,725 without them.

Conclusion for sequencing: the identity change is NOT the main event (name-space pricing outranks it
only in the sense that it is now answered), the namespace claim kind and `imports` remain the named
work, and the ~11,000 cross-file bindings with no own-file declaration are a THIRD defect that neither
the lever nor a claim addresses — recorded as an open cause with its count.

### Cause 7 — the ~11,000 cross-file bindings ARE partly a STORE-ORDER artifact (measured)

The ~11,000 rows that bind to another file while NO declaration in their own file answers were priced
out of the name-space lever and left as the lane's biggest open cause. The question the Lead set is
whether they are an hcl defect at all, and xml-lane's determinism A/B answers it: the SAME file set,
indexed in a different ORDER, writes different bindings.

Adapted instrument (`validation/m14/fixtures/hcl/tools/store-determinism.mts`, from xml-lane's; same
three arms and comparison, only the extension list differs). HCL, terragrunt, 800 files, 10,124
relationship rows, three arms:

| comparison | rows compared | differing | by type | only-in-X / only-in-Y |
|---|---|---|---|---|
| A sorted vs B **reversed** | 10,124 | **113 (1.1%)** | `contains` 113 | 0 / 0 |
| A sorted vs C **eager** (`BB_TEST_FORCE_EDGE_RESOLVE=1`) | 10,124 | **200 (2.0%)** | `references` 96 · `exports` 99 · `contains` 5 | 0 / 0 |
| B reversed vs C eager | 10,124 | **312 (3.1%)** | `exports` 99 · `contains` 117 · `references` 96 | 0 / 0 |

The row set is identical in every arm (`onlyInX`/`onlyInY` both 0); what moves is WHICH declaration a
row binds to. The examples are the exact shape in question — a `contains` row for `s3` under
`…/step-2-refactoring/live/backend.tf` binds to `…/step-1-starting-the-terralith/live/s3.tf`'s `s3` in
one order and to `…/step-2-refactoring/live/main.tf`'s `s3` in the other: terragrunt's walkthrough
fixtures repeat module names across sibling directories, no own-file declaration answers, and the store
picks a twin — a different twin per order.

**So a measurable share of the ~11,000 is a STORE writing-order artifact, not a lane defect, and the
churn lands on exactly the three types that carry this lane's residual.** Two limits are stated rather
than rounded off: the churn rate is 1.1-3.1% of rows while the class is 8.5% of store rows, so order
explains PART of it and the remainder still needs its own named classes; and only one repository was
measured, so the rate is a rate and not a fleet total.

### Cause 8 — the TWIN SPLIT: the ~11,000 are NOT mostly order artifacts

The churn measurement said bindings move with index order; the twin split says HOW MUCH of the class
that can touch. For every row whose own file does not answer, two questions are asked of the store: does
a declaration exist SOMEWHERE in the project (a twin — order can move this binding), or NOWHERE (not an
order artifact at all: an external name, or a target no declaration can answer).

Thirteen of sixteen repositories banked when this was written (the resumable per-repo loop was still
running; one JSON per repo, labelled — see the artifact), 1,575 indexer-eligible files, artefact
`validation/m14/fixtures/hcl/store-binding-truth.twin-split.json`:

| type | rows | other-file | unbound | **twin exists** | **no candidate anywhere** |
|---|---|---|---|---|---|
| contains | 74,517 | 1,091 | 27 | 0 | 0 |
| references | 15,527 | 7,670 | 1,231 | **1,375** | **11,560** |
| exports | 7,009 | 589 | 3 | 0 | 0 |
| uses | 688 | 484 | 169 | 32 | 487 |
| imports | 288 | 0 | 281 | 0 | 7 |
| **total** | — | — | — | **1,407** | **12,054** |

**The ~11,000 are therefore NOT predominantly order artifacts.** Only about 1,400 rows have a twin for
the store's ordering to pick between — the population the measured 113/200/312 churn lives in — while
~12,000 name a target that NO declaration anywhere answers. Those are two different ruled classes with
different mechanisms, exactly as the Lead framed the split:

* **twin exists (≈1,400)** — the store's write order decides which foreign declaration wins. A scoped
  target removes the choice, and this is the class the determinism A/B can move.
* **no candidate anywhere (≈12,000)** — no rename and no ordering change touches these: they are
  external names (provider/data/module/variable roots) or attribute chains no analyzer in this
  population declares. They need a CLAIM or an explicit rule, per class.

LIMITS: thirteen of sixteen repositories (the remaining three were still indexing), and the split is a
count over that population, not a fleet total.

### Cause 9 — the two churn mechanisms SEPARATE, and the `exports` fix is not as narrow as it looked

**The mechanisms separate in the data already committed**, by reading the churn per ARM rather than in
total (`store-determinism.terragrunt-800.json`):

| arm comparison | what changes | contains | references | exports |
|---|---|---|---|---|
| sorted vs **reversed** | file/insert order only | 113 | **0** | **0** |
| sorted vs **eager** | when resolution runs | 5 | 96 | **99** |
| reversed vs eager | both | 117 | 96 | **99** |

`exports` churns **99 under eager-vs-deferred and 0 under file-order reversal**. The
`file_id`-is-insert-order lead predicts exactly the opposite signature — churn under order reversal —
so for `exports` the mechanism is table COMPLETENESS (deferred resolution reading a table that is not
complete yet), not insertion order. `contains` is the one type that churns under order (113/0/117),
which is what `resolveContainsTargetStmt`'s insert-time resolution predicts. Settled with data, not by
a new run.

**And a design constraint on the fix, found before landing it:** a scoped `exports` target cannot be
scoped ALONE. Pass 1 binds `target_external = qualified_name` exactly, so the SYMBOL's qualifiedName
must carry the same scope for the target to match — which means the "exports-only" change touches the
qualified name of every exported symbol, i.e. it is a public identifier change (narrower than the
lane-wide rename, but not free). Alternatively the target may be scoped only where the symbol's qname is
already unique in the project. Recorded rather than landed: the choice between those two is a
consumer-visible decision and belongs with the lane owner before the rename is paid at all.

### Cause 10 — the LANE-WIDE qname scoping, PRICED from the store before it is paid (a projection, labelled)

The Lead's decision: scope the SYMBOL qualified name (option A), because an identity that cannot
distinguish two `s3`s cannot make a target determinate — but price it LANE-WIDE first, since a symbol's
qname is what EVERY type's target must match. This is that price, computed from the store probe's own
columns (`store-binding-truth.lever-price.json`, 15 of 16 repositories, labelled — one was KILLED):

| type | store rows | already bound inside the own file | **would move to the own-file declaration** | other-file now | unbound now |
|---|---|---|---|---|---|
| contains | 98,899 | 96,273 | **2,462** | 2,462 | 164 |
| references | 17,670 | 787 | **678** | 8,557 | 1,478 |
| exports | 12,161 | 10,590 | **1,561** | 1,561 | 10 |
| uses | 812 | 0 | **0** | 608 | 169 |
| imports | 342 | 0 | **0** | 0 | 334 |
| **total** | 129,941 | 107,683 | **4,725** | — | — |

READING IT PER TYPE, which is the point of the price: **no type regresses in this projection** —
`exports` gains exactly its 1,561, `contains` gains 2,462, `references` gains 678, `uses` and `imports`
gain nothing (their targets are namespaces and module paths that no symbol qname can match, so scoping
cannot change them either way).

**WHY IT IS A PROJECTION AND NOT AN AFTER-MEASUREMENT, stated so it is not read as one:** it is derived
from the store's OWN columns — "does a declaration in the edge's own file answer to the target" against
"where the row actually bound" — not from a store run made after the rename. The after-run needs the
analyzer change (scoped qname + targets scoped to match), which is the next item, and until it exists
the 4,725 is the size of the population the change acts on, not a measured post-change binding count.
A projection can also be wrong in the direction the Lead named: scoping qnames can change which rows
pass 2 (unique-name) accepts, and only the after-run can show that.

THE CONSUMER-VISIBLE CONSEQUENCE, named rather than left as a side effect: a scoped qname changes the
PUBLIC qualified name of every exported symbol, so a consumer holding an old spelling will not match it.
That is a deliberate trade for determinacy and it should appear in the lane's release note.

AND WHAT THE FIX IS FOR, corrected by the arm data: a scoped target's value here is **exact-match
determinacy**, NOT tie removal — `exports` churns on table COMPLETENESS (99 under eager-vs-deferred,
0 under file-order reversal), so it was never riding the tie-break that scoping removes. The monotonicity
assertion still holds (scoping cannot create a tie), but it is not the mechanism that fixes exports.

### Cause 11 — the rename is AUTHORIZED but NOT LANDED: the falsifier, named before the run, and a cost the price did not include

The lane-wide qname change is authorized and this lane did NOT land it, because the acceptance items
include a coherent analyzer edit plus a store pair over the same population, and a half-landed rename is
worse than neither (a scoped target against an unscoped qname binds nothing). What is fixed here, before
any run, is the falsifier and one cost the store price did not include.

**THE FALSIFIER, named so the run can fail** — the projection says `exports` +1,561, `contains` +2,462,
`references` +678 and `uses`/`imports` +0 with NO type regressing. It is refuted by any of:

1. a type that was predicted to hold LOSES rows it had — `references` below its 17,670 bound, or
   `contains` below 207,993;
2. `contains` moving OFF the own file — its 96,273 own-file bindings are the baseline the change must
   not disturb, and a drop there is a regression in the type the projection says gains most;
3. `uses`/`imports` gaining nothing was a prediction too: if either gains, the projection's mechanism is
   wrong even though the direction is favourable, and the artifact needs correcting;
4. and the sharpest one: **the after-run showing the 4,725 rows NOT moving**, because their own-file
   declaration was already reachable and the binding they have now came from a tie-break that a scoped
   qname does not remove — which the arm data already suggests is possible for `contains` (it churns on
   insert order, 113/0/117) and not for `exports` (completeness, 99 eager-vs-deferred, 0 on order).

**AND THE COST THE STORE PRICE DID NOT INCLUDE**: the rename moves the lane's own fixtures. Measured:
**12 expectation files carrying 162 target pins and 107 source pins, every one of them an UNSCOPED path**
(`aws_instance.web`, `function.double`, `target._common`), so all 269 pins must be re-spelled in the same
change. The store price answered "how many store rows does this act on" (4,725); it did not answer "how
much fixture churn does it cost", and that number belongs in the decision too.

RECORDED AS THE HANDOVER SHAPE for whoever lands it: (1) one analyzer edit that scopes the symbol
qualified name AND the targets that name a symbol's own path (`contains`, `exports`, `extends`) — the
two must move together; (2) the store pair over the same population, one labelled run each; (3) the
monotonicity assertion, stated as a SAFETY property rather than the mechanism, because the arms show
`exports` never rode the tie-break; (4) the falsifier above, fixed before the run.

### Cause 12 — the deciding test answered BY CONSTRUCTION: YES for 100% of the 4,725, and the inference from it needs one correction

The Lead's cheap deciding test: for the 4,725 rows, is the own-file declaration's name IDENTICAL to the
target as currently spelled? The instrument answers it without a new pass, because the column that
selects those rows IS that test:

```
own_file_answers = SELECT COUNT(*) FROM brain_symbol x
  WHERE x.file_id = <the edge's own file> AND (x.name = target OR x.qualified_name = target)
```

`scopedWouldMove` counts rows where `own_file_answers > 0` and the store bound elsewhere or nowhere —
so **for all 4,725 the answer is YES by definition, not by measurement**: an own-file declaration whose
spelling equals the target EXACTLY already exists. The Lead's branch-1 condition is met at 100%.

**THE INFERENCE FROM IT, corrected.** The Lead read YES as "an exact match was already available and the
resolver chose elsewhere anyway, so a scoped qname does not remove it". The first half is right; the
conclusion does not follow. Why the resolver chose elsewhere with an exact own-file match in hand is a
question about DUPLICATES: store pass 1 binds `target_external = qualified_name` **project-wide with
LIMIT 1**, ordered by `is_declaration, file_id, language, s.id` — so when several files declare the same
spelling, the pick is decided by that ordering, not by locality. **Scoping the qname does not remove the
match that already existed; it removes the DUPLICATE that made the match ambiguous**, which is exactly
the mechanism that produced the foreign pick. On that reading the rename would help the 4,725 — so the
test that decides is neither availability nor spelling but the **duplicate count** for those targets.

**AND THE TEST THAT DECIDES IS ONE COLUMN AWAY**: for the 4,725 rows, the distribution of
`any_file_answers` (the project-wide count of declarations answering to the target) — 1 means the
own-file declaration was already UNIQUE and pass 1 should have bound it, so those rows come from another
mechanism (unbound rows, or a later pass); >1 means duplicates exist and the ordering is what picks the
foreign one, which scoping fixes. The instrument has the column (`any_file_answers`) and the pass is
cheap; it is the next measurement, not this one.

### Cause 13 — the DUPLICATE SPLIT: 2,079 of the 2,308 movable rows are the rename's case, and per type it is not one fix

The deciding measurement, per row: for the rows a scoped qname would move, does the target spelling have
EXACTLY ONE declaration in the project (the own-file one — pass 1 should have bound it, scoping changes
nothing) or SEVERAL (pass 1's ordering `is_declaration, file_id, language, s.id` chose the foreign one —
scoping removes the duplicate and the ambiguity with it)?

Thirteen of sixteen repositories banked when written (the resumable pass was still running; artefact
`validation/m14/fixtures/hcl/store-binding-truth.duplicate-split.json`), 1,575 indexer-eligible files:

| type | movable rows | spelling **project-unique** | **DUPLICATES exist** |
|---|---|---|---|
| contains | 1,089 | **229** | **860** |
| references | 606 | **0** | **606** |
| exports | 589 | **0** | **589** |
| uses / imports | 0 | 0 | 0 |
| **total** | **2,308** | **229 (10%)** | **2,079 (90%)** |

**ANSWER: 90% of the movable rows are the rename's case, and the split is not uniform per type** —
which is exactly why it was asked for per type:
* **`exports` 589/589 and `references` 606/606 are 100% duplicates**: every one of those rows is an
  ambiguous match that scoping makes unique. For those two types the rename buys what it was priced at.
* **`contains` is mixed — 229 unique / 860 duplicate (21/79)**: the 229 rows are the subset where an
  exact own-file match was already project-unique, pass 1 should have bound it, and a rename changes
  nothing; those rows come from the other mechanism (unbound rows, or a later pass). This is the subset
  the Lead's branch-1 conclusion holds for, and it is 10% of the movable class rather than the class.
So the rename is worth its pins for `exports` and `references` in full and for 79% of `contains`, while
the fix for the remaining 229 `contains` rows is a different one — the resolver's own behaviour, not the
identifier's spelling. Two fixes, not one, and the boundary between them is now a number.

LIMITS: thirteen of sixteen repositories (three still indexing; resumable), and the counts are over that
population rather than a fleet total.

### Cause 14 — the rename is AUTHORIZED for the 2,079 (not landed here), the 229 are handed over, and a FIFTH expectation joins the falsifier

The decision: pay the rename for the rows whose mechanism it addresses — `exports` 589/589,
`references` 606/606, `contains` 860 of 1,089 — and NOT for the 229, which are the resolver's population
rather than the identifier's.

**FIFTH EXPECTATION, added to the four-condition falsifier BEFORE the run** (so the run can fail): **the
229 must NOT move.** They are the rows whose target spelling is already project-unique, where pass 1
should have bound the own file and did not; a rename must leave them exactly where they are. If they
move, the rename is doing something other than removing a duplicate and the mechanism measured above is
refuted — that is a failure of the fix's justification, not a bonus.

**THE 229 ARE HANDED OVER AS THE SHARED FIX'S TEST POPULATION**, isolated by this lane's own probe and
identified by a predicate anyone can re-run (the instrument already computes both columns):

```
own-file:   EXISTS symbol x WHERE x.file_id = <edge's own file> AND (x.name = target OR x.qualified_name = target)
project:    COUNT  symbol x WHERE x.project_id = <project>   AND (x.name = target OR x.qualified_name = target)
the 229:    own-file EXISTS  AND  project COUNT = 1  AND  (target_symbol_id IS NULL OR target_symbol_id's file <> the edge's file)
```

That is a clean population for the shared fix because it removes every alternative explanation: the
declaration exists, it is spelled exactly as the target, it is the ONLY declaration answering to that
spelling in the project, and the row still bound elsewhere or nowhere. Four sightings of the same
mechanism now point at it — xml's `calls` 138, this lane's ~12,054 no-candidate-anywhere rows, the
order/eager churn (113/0/117 and 99), and these 229 — so the Lead takes the fix and this lane's
contribution is the isolated population and its count.

**STATUS, PLAINLY**: the rename is authorized and NOT landed by this lane in this budget. The acceptance
items stand unchanged — one coherent edit (qname plus every self-path target together, since a scoped
target against an unscoped qname binds nothing), the store pair over the same population with one
labelled run each, monotonicity as a SAFETY property (`exports` never rode the tie-break: 0 under
file-order reversal, 99 under eager-vs-deferred), the four-condition falsifier plus the fifth above, and
the 269-pin fixture cost (12 files, 162 target + 107 source pins) paid in the same change. The
consumer-visible cost is named and accepted: the public qualified name of every exported symbol changes,
so a consumer holding an old spelling will not match it — a deliberate trade for determinacy, for the
release note.

### Cause 15 — POST-LANDING BASELINE: the movable class measures ZERO, so the rename's case has evaporated

The precondition this lane waited for — a baseline taken on the indexer AFTER the five landings — now
exists, and it changes the decision. One labelled run, `nice -n 10`, no lock (phantom-held; a 20-minute
hold is a fleet stall, not a private cost):

`.tmp-hcl/post-landing/terragrunt.json` → `validation/m14/fixtures/hcl/store-binding-truth.post-landing.terragrunt.json`
(terragrunt, **3,376 indexer-eligible of 3,399** copied; exclusions `testdata` 17, `test` 4,
`.terraform.lock.hcl` 2):

| measure | pre-landing | **post-landing** |
|---|---|---|
| movable rows (`scopedWouldMove`) | 582 (this repo, earlier pass) | **0** |
| spelling project-unique (the 229 class) | part of 582 | **0** |
| duplicates exist (the 2,079 class) | part of 582 | **0** |
| twin exists somewhere | — | 76 |
| no candidate anywhere | — | 1,825 |

**The class the rename was priced to fix measures zero on the post-landing indexer** — `12,865 → 0` is
r-lane's fleet reading and this run reproduces the direction independently on this lane's own instrument,
unchanged. The duplicates that made pass 1's choice ambiguous, and the unique-spelling rows that should
have bound the own file, are both gone: the indexer landings (`71286549c`'s `contains` deferral and the
key-selection changes) addressed the mechanism the rename was aimed at.

**CONSEQUENCE, stated rather than implied: the rename must NOT be paid.** 269 fixture pins, a public
qualified-name change for every exported symbol, and a store pair would buy a class that now measures 0
in the repository that carried the largest share of it. Condition (4) of the falsifier — "the 2,079 NOT
moving" — is no longer testable because there is nothing left to move, and condition (5) is satisfied by
r-lane's zero independently. What remains is `references`' wrong-file class (6,167 fleet-wide), which is
a different question:

**`references` other-file is dominated by cross-MODULE reads, and is a RISK, not proven wrongness.** The
post-landing unbound worklist is `module.ddb.aws_dynamodb_table.asset_metadata` 12,
`module.iam.aws_iam_policy.lambda_basic_execution` 12, `module.iam.aws_iam_role.lambda_role` 12, and so
on — chains reaching into modules that are not in the indexed population, which is what a cross-document
reference IS for a type whose target is not the edge's own file. The intent legend is explicit that
`"twin"` marks a WRONG EDGE only for `contains`/`exports`; for `references` a foreign declaration is a
RISK. **So sample before pricing, which is the assignment this run starts.**

### Cause 16 — the claim-kind block for hcl: CONTRADICTED 0, and a MEASURED zero rather than a silent block

Read on a 600-file sample (`incoming-gate.ts hcl hcl 600`, exit 1 — the gate's own FAIL verdict for a lane
with residual, not an instrument error):

```
BY CLAIM KIND: of 0 ambiguous edge(s) — 0 claim VERIFIED · 0 NOT verified · 0 REFUTED ·
               0 CONTRADICTED · 0 OWN-FILE-SILENT · 0 n/a
(no ambiguous edge on this lane carries any claim — so there is nothing of this shape here,
 and that is a MEASURED zero rather than a block that failed to print.)
```

**So hcl has no `CONTRADICTED` edges and no `OWN-FILE-SILENT` edges** — the scss 714 does not reproduce
here, and nothing on this lane needs the open fleet-wide ruling about whether a contradicted claim counts
as `extFAIL`. Both counts are reported, neither is resolved, and the block's own sentence is the reason
this is a fact rather than an absence: it always prints, so "0" here cannot be a gate that skipped it.

NOTED WITH IT: the block's denominator is the run's ambiguous count, so the zero is a statement about
**ambiguous edges carrying claims**, not a claim that the lane has no ambiguity — the same run's TABLE 1
is where the lane's `amb(decl)` lives, and the two must be quoted together.

### Cause 17 — `collRes` 1,742 NAMED: it is 100% `contains`, and the tie-break is own-file DETERMINATE

`collRes` (`resolvedAmongCollision`) is the class where a row RESOLVED but the target had more than one
declaration, so production's tie-break chose it — and the indexer's own measurement is that **37,318 of
49,729 such picks (75%) go to the WRONG symbol.** On this lane it is the largest figure in the table
(1,742 of 6,100 edges, 28.6%) and had no cause named. Named now, from the same 600-file sample and
crossed against that run's own BINDING INTENT columns:

| type | edges | resolved | **collRes** | share of the type | intended | sameFileUnproven | arbitraryTwin | nothingAnywhere |
|---|---|---|---|---|---|---|---|---|
| contains | 4,338 | 4,338 | **1,742** | **40.2%** | **4,338** | 0 | 0 | 0 |
| (all other types) | 1,762 | 367 | **0** | 0% | 983 | 79 | 1 | 699 |
| **run total** | **6,100** | 4,705 | **1,742** | 28.6% | 5,321 | 79 | 1 | 699 |

**(a) WHICH TYPES CARRY IT: one type.** The entire `collRes` on this lane is `contains` — 1,742 of
`contains`' 4,338 edges (40.2%), and every other type is zero. So `collRes 1,742` is not a lane-wide
collision risk; it is one type's characteristic, which is what `resolveContainsTargetStmt` predicts: a
`contains` target is a path like `target._common` that repeats across files by construction (docker-bake
targets, Terraform nested blocks), so collisions are the NORM for the type rather than an accident.

**(b) IS THE TIE-BREAK DETERMINATE HERE: yes, for the whole class.** The same run's intent table reads
`contains 4,338 edges → intended 4,338`, i.e. for EVERY `contains` edge a declaration in the edge's own
file answers ON the edge's own line. A collision is determinate whenever the edge's own file declares
that name exactly once, because both resolvers put the file preference second in their `ORDER BY` — and
`resolveContainsTargetStmt` puts it first. So the 75% wrong-pick risk does not apply to this class:
**the 1,742 are own-file-settled, and the genuinely arbitrary subset is 0 (`arbitraryTwin 0`).**
`collRes 28.6%` therefore reads much smaller as a risk than as a number, and the honest reading is that
`contains`' collisions are the type working as designed — which is consistent with the store measurement
that `contains` other-file bindings are 0 post-landing.

**GAP IN THE INSTRUMENT, stated rather than worked around**: the marker-set breakdown cannot answer
"per marker set" for `collRes`. That table covers NOT-RESOLVED edges plus bindings — its columns are
`resolved / amb / unres / extClaim / binding / cause` — so a collision-RESOLVED row has no marker-set row
at all. The marker keys on this lane are `hclSite`, `hclBuiltin+hclSite`, `hclOverrideKind+hclSite`, and
`contains` edges carry `hclSite`; a per-marker `collRes` column is what the table would need to answer the
question as asked.

### Cause 18 — the TWIN TEST ON NIM (cross-lane): the population exists, and the store BINDS almost all of it

This lane's `arbitraryTwin` is 0, so hcl cannot test whether a twin is really WRONG — the question the
whole `collRes`/`ofWhich`/`twin` machinery rests on, which the indexer's control arm answers statistically
(37,318 of 49,729 collision-bound picks to the WRONG symbol) and nobody has tested per row on a
population that has twins. **Nim was chosen because it carries the programme's largest twin population
(`calls arbitraryTwin 70,223`); nim's files were NOT edited — the measurement is a copy of this lane's
instrument with the extension list and env names changed (`store-binding-truth.nim.mts`), run once,
labelled, `nice -n 10`, no lock.**

ONE RUN: nim, **1,499 indexer-eligible of 1,500** files copied (top exclusion `tests` 1), **75,094 store
rows**. Artefact `validation/m14/fixtures/hcl/store-binding-truth.nim-twin-1500.json`.

| type | rows | bound | unbound | other-file | **twin (own file silent, declaration elsewhere)** | no-candidate | leaf-reduced |
|---|---|---|---|---|---|---|---|
| calls | 25,335 | 19,322 | 6,013 | 9,846 | **9,782** | 0 | **0** |
| references | 14,234 | 9,724 | 4,510 | 3,471 | **3,471** | 0 | 0 |
| uses | 10,995 | 10,966 | 29 | 1,614 | **1,614** | 0 | 0 |
| imports | 2,021 | 973 | 1,048 | 973 | **973** | 0 | 0 |
| contains | 21,486 | 21,477 | 9 | **1** | 1 | 0 | 0 |
| **total** | **75,094** | 63,425 | 11,669 | 16,306 | **16,242** | **0** | **0** |

THREE THINGS THIS ESTABLISHES BEFORE THE INTENT TEST:

1. **The population exists and is large: 16,242 twin rows, and `noCandidateAnywhere` is 0** — on nim,
   every own-file-silent row has a declaration somewhere, so the twin class is the whole class there.
2. **The store BINDS almost all of them** — `calls` 9,782 twins against 9,846 other-file bindings,
   `references` 3,471/3,471, `imports` 973/973. So "the store refused it" is not what happens; what
   happens is a foreign declaration is chosen. Whether that foreign declaration is the one the edge MEANT
   is precisely the untested question, and it is now isolated to 16,242 rows rather than assumed.
3. **`leafReduced` is 0 on nim, in every type** — unlike hcl, where 96.8% of bound references needed leaf
   reduction. So nim's bindings are exact-name bindings, which makes it a CLEANER test population than
   hcl: a wrong twin here cannot be excused as a leaf coincidence, and `contains` shows **1** other-file
   binding out of 21,486, so the deferral fix holds on this lane too.

THE FALSIFIER FOR "TWINS ARE WRONG", named before the intent run: a twin row whose bound declaration
lives in a file the SOURCE file can actually reach (nim: the module is imported, or the declaration is in
the same package path) and whose name matches is a binding that is plausibly the one the edge meant. **If
most of the 16,242 look like that, "twins are wrong" fails to fire** and the intent legend's scoping — a
foreign declaration is what a cross-document reference IS, a RISK not proven wrongness — is the stronger
reading, which would make a large share of the fleet's `twin` columns risk-shaped numbers read as defects.
The negative control is the other side: twin rows bound to a file the source cannot reach at all, which
are arbitrary picks whatever else is true. **The intent column this needs (source-file reachability of
the bound declaration) is the next edit; it is not in the instrument yet, and no number above depends on
it.**

### Cause 19 — PRE-REGISTRATION for the nim intent run: three buckets, and the numbers that decide

Written BEFORE the intent run, so the run can fail. The question: for the 16,242 twin rows, is the bound
declaration's file reachable from the source file? (Nim `import`/`include`, which the store already holds
as `imports` rows — and note that on this very run nim's `imports` are only 973 bound of 2,021, so the
evidence for reachability is itself half-missing, which is why the third bucket below is mandatory rather
than tidy.)

BUCKETS, each counted separately and never folded:

| bucket | definition | reading |
|---|---|---|
| **REACHABLE** | an `imports` row in the same project whose SOURCE is the twin row's source file and whose bound target symbol's file IS the twin's bound declaration file | plausibly the declaration the edge meant |
| **UNREACHABLE** | the source file has import rows, NONE of which reaches the bound declaration's file | an arbitrary pick — the negative control, and it carries whatever the REACHABLE share does not |
| **UNDECIDABLE** | the source file has at least one `imports` row that is itself UNBOUND, so reachability cannot be established either way | a finding about the INSTRUMENT if large; if small, the two outcomes above are clean |

PRE-REGISTERED THRESHOLDS, on the share of the 16,242 that are REACHABLE (UNDECIDABLE excluded from the
denominator, reported beside it):

* **≥ 70% REACHABLE → "twins are wrong" FAILS TO FIRE.** The indexer's 37,318-of-49,729 control arm does
  not generalise to binding choice, the intent legend's scoping is the stronger reading, and a large share
  of the fleet's `twin` columns are risk-shaped numbers that have been read as defects. That is the bigger
  claim of the two and it needs the UNREACHABLE bucket to carry it.
* **≤ 40% REACHABLE → "twins are wrong" STANDS.** The twins are arbitrary picks, 37,318/49,729
  generalises, and `twin` is a defect class everywhere it appears in the fleet.
* **40-70% → INCONCLUSIVE, and it stays inconclusive**: the result is reported as a split, not rounded to
  whichever side is nearer, and the next measurement is a second repository rather than a re-reading of
  the same one.

WHY THE THRESHOLDS ARE THESE AND NOT 50%: the claim under test is not "more likely right than wrong" but
"a twin is a risk worth a lane's attention". A 50% floor would let a coin flip pass as a repair, and the
fleet reads `twin` columns as defect columns — so the test must clear a margin, and the margin is set
before the data rather than after it. The precedent is this lane's own `contains` pair, where the floor
(50) was pre-registered before the confirming run.

STATUS, PLAINLY: this is the pre-registration only. The intent column is NOT implemented yet (the join
above needs an `imports`-to-symbol join plus the three-bucket counters) and the nim run has NOT been
re-taken, so no number exists for any bucket. Nothing in Causes 17-18 depends on this, and the artefact
will carry the run's label when it exists.

### Cause 20 — the nim TWIN BUCKETS, run against the pre-registration: 0% REACHABLE, and an UNDECIDABLE bucket that did not fire

One labelled run (`nice -n 10`, no lock, nim's files untouched), 1,499 indexer-eligible of 1,500,
`store-binding-truth.nim-twin-buckets.json`:

| bucket | count |
|---|---|
| **REACHABLE** | **0** |
| **UNREACHABLE** | **16,242** |
| **UNDECIDABLE** | **0** |

By the pre-registered rule (share = REACHABLE / (REACHABLE + UNREACHABLE), UNDECIDABLE excluded and
reported beside it): **0.0% ≤ 40% → "twins are wrong" STANDS** — on nim's population, every twin binds to
a file the source's own imports do not reach, so the twins are arbitrary picks, the indexer's
37,318-of-49,729 control arm generalises to binding choice, and `twin` is a defect class wherever it
appears. Per type, and uniform: `calls` 9,782 unreachable / 0 reachable, `references` 3,471/0,
`uses` 1,614/0, `imports` 973/0.

**BUT THE UNDECIDABLE BUCKET DID NOT FIRE WHERE THE EVIDENCE SAYS IT MUST, and that is reported rather
than smoothed:** nim's `imports` are **1,048 unbound of 2,021**, so source files demonstrably carry
import rows whose reachability cannot be established — yet the bucket counted **0**. The cause is in my
own predicate: the undecidable subquery JOINs `brain_symbol` on the import row's source symbol, so an
unbound import row with no source symbol is DROPPED before it can be counted. **So `UNDECIDABLE 0` is an
instrument artifact, not a measurement**, and the pre-registration says exactly what to do with that: if
UNDECIDABLE is large — or here, if it fails to appear on a population that requires it — that is a finding
about the instrument.

**WHAT THAT DOES AND DOES NOT DO TO THE VERDICT:** the REACHABLE count of 0 is measured; the share is
therefore 0% *on the rows the buckets could classify*, and a correct UNDECIDABLE bucket could only move
rows OUT of UNREACHABLE and INTO undecidable — it cannot create reachable rows, because REACHABLE requires
a bound reaching import that was not found in any of the 16,242. So the verdict **STANDS on a weaker
basis than the pre-registration intended**: the direction is measured, the denominator is not yet
trustworthy, and the next measurement is the fixed bucket (LEFT JOIN, or count import rows by the source
FILE rather than by a source symbol) before this is quoted fleet-wide.

### Cause 21 — the SECOND population (clean): the verdict holds, the MARGIN does not, and UNDECIDABLE fires

Nim is the CLEANEST population (`leafReduced` 0 in every type) and a verdict there is not yet evidence for
lanes where leaf reduction does the binding, so the same three pre-registered buckets were run on **clean**
(the lane carrying `references twin 6,650`), one labelled run per repository, `nice -n 10`, no lock
(phantom-held), the language's files untouched. Artefact
`validation/m14/fixtures/hcl/store-binding-truth.clean-twin-buckets.json`.

| repository | eligible | twins | REACHABLE | UNREACHABLE | UNDECIDABLE |
|---|---|---|---|---|---|
| Clyde | 109 | 3,033 | **360** | 38 | **2,635** |
| clean-stdlib | 74 | 1,428 | **160** | 1,268 | 0 |
| eastwood | 73 | 399 | **105** | 19 | **275** |
| **total** | **256** | **4,860** | **625** | **1,325** | **2,910** |

**By the pre-registered rule: 625 / (625 + 1,325) = 32.1% ≤ 40% → "twins are wrong" STANDS on clean too.**
So the DIRECTION survives a second population and a different language — which is what the fleet-wide
claim needed. **Two things do not survive, and both are reported rather than averaged away:**

1. **THE MARGIN IS NOT 0%, IT IS 32%.** Nim read 0.0% reachable; clean reads 32.1% — the same direction
   with a materially different size, and `clean-stdlib` alone reads 160 of 1,428 with only 0 undecidable.
   So "twins are wrong" is not uniformly near-total: on clean, roughly a third of decidable twins bind to
   a declaration the source could plausibly reach. The claim stands, and the number a fleet reads off its
   `twin` column should not be treated as 100% defect.
2. **UNDECIDABLE IS NOW 60% OF THE CLASS (2,910 of 4,860) AND IS WILDLY UNEVEN PER REPOSITORY** — Clyde
   2,635 undecidable against clean-stdlib **0**. That is the instrument finding the pre-registration
   anticipated, now with a second population behind it: the bucket depends on whether a project's unbound
   `imports` rows are anchored to a source symbol at all, which is a property of the LANGUAGE's emission
   and not of the twins. On nim the bucket could not fire (its unbound imports are not file-anchored,
   hence `UNDECIDABLE 0` where 1,048 unbound imports exist); on clean it fires massively on two of three
   repositories. **One bucket, two behaviours — so the bucket must be stated with its anchoring rule
   wherever it is quoted.**

**FIX NOT YET LANDED, and the choice is recorded rather than implied**: count import rows by the source
FILE rather than by the source symbol, because the question is "can this source FILE reach that
declaration's file" and the unit should match the question; a LEFT JOIN would keep the row and mark it
undecidable but would still need a file anchor the row may not carry, which is exactly the case that
produced nim's `UNDECIDABLE 0`. Until that lands, every `UNDECIDABLE` figure above is quoted with its
repository and its anchoring caveat.

**WHAT THIS DOES TO THE FLEET CLAIM**: the direction is now measured on two languages and four
repositories — twins are predominantly bound to files the source cannot reach — so `twin` is a defect
class, and the indexer's 37,318/49,729 control arm generalises to binding choice. That is earned. What is
NOT earned is quoting a per-lane `twin` column as a defect count without the reachable/undecidable split
beside it, because on clean a third of decidable twins are plausibly right and 60% cannot be decided at
all.

### Cause 22 — `imports` RULED: a directory is not a file, so the file route has no target — 88 edges, 95.5% naming a directory

toml-lane measured this lane's `imports` residue as part of the fleet ceiling (`558c9828f`, copy
instrument, **this lane's files untouched**), and the cause is now named rather than left as a
percentage:

```
hcl   708/9,329 files · imports 88 · VERIFY 0 · refute 0 · RESIDUE 88 (100%)
      THE CAUSE: MODULE SOURCES THAT NAME A DIRECTORY — 84 of 88 (95.5%)
        ./module 12 · ./child 7 · ../../account-map/modules/iam-role 6 · ./provision-nomad 3
      0 refute, STRUCTURALLY: a directory is not a file, so the file route has nothing to refute —
      and nothing to CLAIM, which is why the ceiling is 0.0% rather than "small"
```

**RULED, and the ruling is on the route rather than on the edges:** these 88 edges are Terraform
module sources that name a DIRECTORY (`./module`, `../../account-map/modules/iam-role`), which is a
legitimate and expected shape — a module reference points at a directory, and the directory resolves by
looking for the manifest inside it. **So the file-claim route has no target here: 0.0% is a ceiling for
the FILE route specifically, not for these directives generally**, and quoting it as "hcl's imports are
0% claimable" would be the same class of error as reading a `twin` column as a defect count.

**The mechanism that would reach them is a manifest-in-directory claim** (toml's own manifest shape),
not a file claim — and it is NOT TAKEN here, for a priced reason: the population is **88 edges across
9,329 files (0.9%)**, 100% of them one mechanism, and building a second claim route for a class this
small would add a mechanism to the shared claim machinery to move 88 edges. Recorded as a named cause
with its count and its route, which is what the class needed; if a lane ever builds the directory route
for a larger population, this lane's 88 are its first beneficiaries.

**AND THE ORDERING FACT THAT FOLLOWS, recorded because it is not obvious:** this lane's `imports` row is
**not a file-claim population at all** — the old fleet figure that counted hcl's 334 edges among the
file-claim lanes was counting directory targets as file targets. The fleet `imports` cause is now four
file-claim lanes, one shared-rule question, and three named non-file causes, and hcl is one of the three.

### Cause 23 — CORRECTION: the nim bucket is INCONCLUSIVE-ON-INSTRUMENT, and the fleet direction is earned on ONE language

The file-anchored nim run landed (Lead's lease, 400-file draw, `EXIT=0`; the instrument fix is
`85bf30299`, committed by the Lead so it could not be lost, with the thresholds quoted into the artefact
before the run):

```
edges 18,549 · bound 14,589 · sameFile 12,457 · otherFile 2,132
scopedWouldMove 0 · scopedAlreadyRight 12,457 · noCandidateAnywhere 0
boundNeedsLeafReduction 5 · sourceUnbound 2,018
type: calls 1,172 · references 361 · uses 418 · imports 93 · instantiates 80 · extends 4 · exports 4
TOTAL twins 2,132 · REACHABLE 0 · UNREACHABLE 0 · UNDECIDABLE 2,132
```

**The share is 0/0 — UNDEFINED — so the reading is INCONCLUSIVE-ON-INSTRUMENT**, which is the branch
this lane fixed before the number existed.

**THE DIAGNOSIS, which is a finding about the predicate and not about nim: a bucket that reads 0% and then
100% on the same question has not measured the twins — it has measured its own predicate.**
* un-anchored predicate → **0%**: an unbound import row with no source symbol was dropped by an INNER JOIN
  before it could be counted, so the bucket could not fire on a corpus whose evidence for it is
  half-missing;
* file-anchored predicate → **100%**: it asks whether the source FILE has ANY unbound `imports` row, and
  `sourceUnbound` is **2,018**, so it fires for essentially every row.
Two values, opposite directions, one question — neither is a measurement of reachability.

**CORRECTION TO THIS PAGE'S OWN CLAIM**: the earlier EARNED block said the direction was measured on "two
languages and four repositories". **That does not survive this run.** The direction is now earned on
**ONE language (clean, 32.1% ≤ 40% → STANDS)**; **nim is INCONCLUSIVE-ON-INSTRUMENT**, not 0.0% and not
anything else. The correction came from this lane's own pre-registration rather than from a critic.

**WHAT THE RUN DOES ESTABLISH**: `noCandidateAnywhere 0` and `scopedWouldMove 0` on nim — every
own-file-silent row has a candidate somewhere, and **no row had an own-file declaration that the store
passed over for the full spelling**; and **`boundNeedsLeafReduction 5`**, i.e. nim binds twins by FULL
SPELLING, against hcl's 12,014 — which is exactly why nim was the cleanest population AND exactly why its
undecidable rate reads 100%.

**THE NEXT MEASUREMENT IS NAMED, and re-running this predicate on a bigger draw is NOT it** (it will read
100% again): the predicate must ask whether **the file the twin actually BOUND TO** could be reached — a
**PER-ROW** reachability question, not a per-file one. Until that exists, the reachable/undecidable split
must not be quoted for nim at all.

**OPERATIONAL FACT, for the handoff**: a teammate's background job dies when the teammate's turn ends —
two nim runs of this lane died at that boundary (verified: no artefact, log ending mid-store, no surviving
process), while the same run under the Lead's lease completed. The division is **the Lead holds long jobs,
lanes hold bounded ones**; a lane with something long should poll in-turn or hand it over with its label
lines and thresholds. Both deaths were reported KILLED, never as results.

### Cause 24 — the PER-ROW name-text predicate, BUILT and pre-registered (for the Lead's lease)

Built because the per-file predicate measured itself: 0% then 100% on the same question (Cause 23). The
question is whether the source file holds an import row that could reach **the file the twin actually
BOUND TO**, and the split is on **the import ROWS and their NAME TEXT**, not on the file as a whole.

| bucket | predicate | why decidable |
|---|---|---|
| **REACHABLE** | a BOUND import row whose target file **IS** the twin's bound declaration file (`i_src.file_id = ss.file_id AND i_tgt.file_id = <bound file>`) | the only case that is EVIDENCE of reachability rather than of possibility |
| **UNDECIDABLE** | no such row, but an import row's **name text** could name that declaration — the leaf segments match | every `imports` edge carries a target name even when unbound, so nim's 1,048 unbound rows are informative rather than obstructive |
| **UNREACHABLE** | no bound row reaches it and no row's name text can name it | the negative control, decidable from text the store already holds |

**PRE-REGISTERED THRESHOLDS AGAIN, before the run, same 70/40 bands** on REACHABLE / (REACHABLE +
UNREACHABLE), with UNDECIDABLE excluded from the denominator and reported beside it:
* **≥ 70% → "twins are wrong" FAILS TO FIRE** for nim;
* **≤ 40% → STANDS**, and then the direction is earned on TWO languages rather than one (clean 32.1%);
* **40-70% → INCONCLUSIVE**, reported as a split and never rounded;
* **and if the split is 0/0 AGAIN, the reading is INCONCLUSIVE-ON-INSTRUMENT and it STANDS THERE** — no
  fourth predicate. A second instrument that also cannot fire is a result about the population, and this
  lane already has one of those.

INSTRUMENT, committed and hashed so the run's provenance is checkable:
`validation/m14/fixtures/hcl/tools/store-binding-truth.nim.mts`
`sha256 a6688e4f5f12189724b1545a9231f2b0fff53e83898a51dab37f8e021bb093e6`
`npx tsc --noEmit -p tsconfig.json` **exit 0** · `npm run audit:script-typecheck` **exit 0**

HANDOVER COMMAND (the Lead's lease; 400-file draw, which completed inside one turn for this corpus, and
the drawn population is stated in the artefact because the rule works on shares):

```
nice -n 10 env BB_DATA_DIR=$PWD/.tmp-hcl/bb-data BB_NIM_TRUTH_REPOS=nim   BB_NIM_TRUTH_MAX=400 BB_NIM_TRUTH_OUT=.tmp-hcl/nim/nim-perrow.json   npx tsx validation/m14/fixtures/hcl/tools/store-binding-truth.nim.mts
```

Read `TWIN BUCKETS (pre-registered): REACHABLE … · UNREACHABLE … · UNDECIDABLE …` from the log and quote
the thresholds above into the artefact's first lines BEFORE the run, as was done for the previous one.
**What the predicate does NOT measure, stated so it is not read as more than it is**: a leaf-text match is
possible-evidence, not proof, and a nim import written through a computed path matches nothing — those
rows land in UNREACHABLE, which is why the negative control is the bucket to read beside the share.

### Cause 25 — the PER-ROW predicate LANDED: 0 of 2,132, so the direction is earned on TWO languages

The Lead ran the per-row name-text predicate under his own lease (400-file nim draw), with the instrument's
`sha256` verified against the declared `a6688e4f5f12189724b1545a9231f2b0fff53e83898a51dab37f8e021bb093e6`
BEFORE the run and the thresholds quoted into the artefact's first lines, so the run measured the
committed instrument and nothing else:

```
TWIN BUCKETS (pre-registered): REACHABLE 0 · UNREACHABLE 2,132 · UNDECIDABLE 0
share = 0 / 2,132 = 0.0%      (NOT 0/0 — both sides of the ratio are real numbers)
```

**0.0% ≤ 40% → "TWINS ARE WRONG" STANDS, and the pre-registered consequence follows: the direction is
earned on TWO languages — nim 0.0% and clean 32.1%, both under the floor — not one.** The third predicate
succeeded where the pre-registration said there would be no fourth; it did not need one, and the stop was
written before it was known whether it would be needed.

**TWO TRUE STATEMENTS, AND THEY ARE NOT THE SAME STATEMENT** (the distinction fixed before the run):
* **"0 of 2,132 twins bind to a file that a BOUND import reaches"** — REACHABLE required a bound import row
  whose target file IS the twin's bound file, the only case that is evidence rather than possibility, and
  it held **0 times**. That is a strong, decidable fact.
* **"all 2,132 are unreachable"** — bounded by the name-text test, **in the direction that inflates
  UNREACHABLE**, because a nim import written through a computed path matches nothing.

Also read from the same artefact: `no candidate ANYWHERE 0` · **`NAME-SPACE LEVER PRICE 0`** (no row whose
own file answers to the target while the store bound elsewhere or nowhere) · `scopedWouldMove 0` from the
earlier run — **so nim has NO ignored-own-declaration defect at all: its twins are entirely OTHER-FILE
bindings whose source cannot reach them.** And `boundNeedsLeafReduction 5` against hcl's 12,014 confirms
why nim was the strongest population for this test — and why its earlier 100% undecidable reading was a
property of that predicate rather than of the corpus.

**THIS PAGE'S OWN LEDGER, corrected twice by measurement rather than by argument**: the headline claim
"two languages and four repositories" was retracted when the second predicate returned 0/0 (Cause 23) and
is now **restored by a better measurement** — nim 0.0% (0 of 2,132) and clean 32.1% (625 of 1,950) — with
the margin still NOT earned as a fleet statement, `UNDECIDABLE` still not portable, and a bare `twin`
column still not readable as a defect count anywhere.

### Is hcl COMPLETE under the four clauses? NO — clause 1 fails by 4,034 edges

| clause | verdict |
|---|---|
| 1. every emitted edge of every applicable type resolves to exactly one real declaration | **FAILS — 4,034 store-unbound rows** (references 2,082 · imports 1,347 · uses 419 · contains 174 · exports 12), plus the wrong-binding classes that are bound but not intended: references other-file 14,302 · exports 1,858 · contains 3,170 |
| 2. ambiguity and unresolved classified by NAMED cause with a measured count | PASSES — every bucket above is split by named root class on the store-unbound population, and the model-vs-store gap is itself named (I13 leaf rebinding) |
| 3. each cause fixed with a before/after over the SAME population, or ruled legitimate with evidence | PARTIAL — `contains` is RULED (97,339/97,550 resolved; the model bucket was an instrument artifact); `exports` is measured (99.9% bind, 15.5% cross-file); `references`, `uses`, `imports` are NAMED and COUNTED but not yet fixed or ruled |
| 4. `extFAIL` / `bindFAIL` / `causeFAIL` all zero | **HOLDS — 0 / 0 / 0** |

`hcl` is NOT among the analyzers affected by `a82e4134d` (`projectRoot` never passed): the readers of
that parameter are dart, json, php, toml, typescript and yaml — **hcl is not one of them**, and this
lane's numbers are unaffected by that defect rather than merely unexamined for it.

### A population finding the comparison forced: the gates classify files the indexer never reads

The probe asked production's OWN discovery (`discoverIndexableFiles`) what it would index, and for
terraform the answer is **78 of 2,299 HCL files — 2,221 (96.6%) sit under `testdata/`** and are skipped
by the indexer's built-in ignore for test-data directories, which the `ignore` package matches
CASE-INSENSITIVELY (measured: that one glob reports `ignored=true` for `testdata/x.tf` AND for
`a/testData/b.tf`). The ontology and incoming gates build their population from `git ls-files` + the
language router, so their HCL tables classify edges from files production NEVER INDEXES. Both numbers
are therefore reported here, and the store comparison above runs over the indexer-eligible set
(`indexer-eligible 78 of 2299 copied; top exclusions testdata=2221`).

**KILLED, reported as KILLED:** the whole-population `incoming-gate.ts hcl hcl 0` run never started —
`flock -w 600` returned exit 9 (the heavy lock was held by another lane for the whole window). The
marker table quoted earlier is SAMPLE scope, labelled; the residual table above is the residual gate's
own whole-population run.

**The `xml-ruled.ts` question, answered rather than assumed:** HCL has NO ruling table —
`script/m14/hcl-ruled.ts` does not exist and `RULED_BY_LANG` has no `hcl` entry — so an element-only
probe cannot be hiding here. Its absence claims come from the spec's HCL-D1a plus
`validation/m14/fixtures/hcl/ruling-attestation.json`, which attests THREE spaces (node-types,
block-types, attribute-keys) with pointers the gate verifies, and the key-space check enforces that
fleet-wide.

## 9. Reproducing every number here

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

# the store-level truth (needs a writable data dir; see the probe's header)
BB_DATA_DIR=$PWD/.tmp-hcl/bb-data npx tsx validation/m14/fixtures/hcl/tools/store-binding-truth.mts

# the residual worklist
# the fixture lane
npx tsx script/m14/run-fixtures.ts --lang hcl
```

Raw artefacts: `validation/m14/fixtures/hcl/construct-census.current.json` (census),
`validation/m14/results/firing-laptop-b.current.log` (firing sample),
`docs/analyzers/real-hcl-analyzer.md` (the prior whole-corpus census and the analyzer's contract).
