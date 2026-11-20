# Rust lane — state

**As of:** 2026-11-19 (final close-out pass)
**Analyzer:** `src/ast/real-rust-analyzer.ts`
**Spec:** `script/m14/spec/rust-completeness.json`
**Declaration:** `validation/m14/instruments/rust/incoming-declaration.json`
**Lane doc:** `docs/analyzers/rust.md`

This page is the lane's durable state. It exists because the analyzer's own header cited
`validation/m14/verification/RUST-STATE.md` and `RUST-FIX.md`, and **neither was ever committed** —
so every citation to them from `src/ast/real-rust-analyzer.ts` was unfalsifiable from a fresh
checkout. This file closes that gap. It is written from measurements taken at the head named below,
not from prose.

---

## 1. Relationship vocabulary — all 14 types

Whole admitted population, re-measured 2026-11-19 with
`BB_CORPUS_ROOT=/home/ishaq2321/bb_tests/repositories bun script/m14/incoming-gate.ts rust rs 0 --dump`.

**2,532 parsed of 2,532 admitted · 9 repositories · 0 failed · 326,092 edges.**

| # | type | edges | resolved | amb(decl) | unresolved | extOK | state |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `calls` | 180,486 | 52,703 | 85,094 | 42,689 | 0 | emitted |
| 2 | `references` | 38,680 | 17,417 | 9,411 | 11,852 | 0 | emitted |
| 3 | `uses` | 28,323 | 20,301 | 6,302 | 1,720 | 0 | emitted |
| 4 | `contains` | 22,507 | 22,507 | 0 | 0 | 0 | emitted |
| 5 | `decorates` | 15,930 | 1,968 | 6,567 | 7,395 | 0 | emitted |
| 6 | `imports` | 11,813 | 403 | 296 | 3,185 | 7,929 | emitted |
| 7 | `mixes_in` | 11,176 | 695 | 1,030 | 9,451 | 0 | emitted |
| 8 | `exports` | 6,185 | 5,809 | 338 | 38 | 0 | emitted |
| 9 | `instantiates` | 6,149 | 4,524 | 1,097 | 528 | 0 | emitted |
| 10 | `overrides` | 2,910 | 2,910 | 0 | 0 | 0 | emitted |
| 11 | `implements` | 1,901 | 698 | 191 | 1,012 | 0 | emitted |
| 12 | `extends` | 29 | 1 | 1 | 27 | 0 | emitted |
| 13 | `part_of` | 3 | 0 | 0 | 0 | 3 | emitted |
| 14 | `renders` | 0 | 0 | 0 | 0 | 0 | emitted, **corpus-unexercised** |
| | **TOTAL** | **326,092** | **129,936** | **110,327** | **77,897** | **7,932** | |

Closure is exact per type: `edges = resolved + amb(decl) + unresolved + extOK`.
`amb(kind)` (76,178) is a subset of `amb(decl)`; `collRes` (15,667) a subset of `resolved`. Both are
printed beside their parent column and **never added**. `unclassed = 0`. `extFAIL = 0` — no claim
the project could refute. Instrument self-test: PASS (positive control fired).

**14 emitting + 0 ruled = 14.** No relationship type is ruled for Rust. See §3.

### 1b. Resolution quality, per type (the master review's fresh table)

The 2026-11-20 master review re-ran the arm and the differential and added an
independent symbol census. The **edge counts are byte-identical to the 2026-11-19 run on
all fourteen types**; what is new is the *quality* column, which is the number that
actually says how good the resolution is.

| type | edges | resolved | %resolved | %ambDecl | %unresolved | %extOK | dominant terminal state |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `calls` | 180,486 | 52,703 | 29.2% | 47.1% | 23.7% | 0% | ambDecl |
| `uses` | 28,323 | 20,301 | 71.7% | 22.3% | 6.1% | 0% | resolved |
| `contains` | 22,507 | 22,507 | **100%** | 0% | 0% | 0% | resolved |
| `imports` | 11,813 | 403 | 3.4% | 2.5% | 27.0% | **67.1%** | extOK |
| `references` | 38,680 | 17,417 | 45.0% | 24.3% | 30.6% | 0% | resolved |
| `exports` | 6,185 | 5,809 | 93.9% | 5.5% | 0.6% | 0% | resolved |
| `extends` | 29 | 1 | 3.4% | 3.4% | **93.1%** | 0% | unresolved |
| `implements` | 1,901 | 698 | 36.7% | 10.0% | 53.2% | 0% | unresolved |
| `overrides` | 2,910 | 2,910 | **100%** | 0% | 0% | 0% | resolved |
| `instantiates` | 6,149 | 4,524 | 73.6% | 17.8% | 8.6% | 0% | resolved |
| `decorates` | 15,930 | 1,968 | 12.4% | 41.2% | 46.4% | 0% | unresolved |
| `renders` | 0 | 0 | — | — | — | — | (no edges) |
| `mixes_in` | 11,176 | 695 | 6.2% | 9.2% | **84.6%** | 0% | unresolved |
| `part_of` | 3 | 0 | 0% | 0% | 0% | **100%** | extOK |
| **TOTAL** | **326,092** | **129,936** | **39.8%** | **33.8%** | **23.9%** | **2.4%** | |

**The honest reading.** A 39.8% resolved rate is not a defect — it is what a *per-file*
analyzer produces on a language whose edges mostly point outside the file. But the
distribution is the actionable part:

* **`calls` is 67.9% of all unresolved work** (127,783 of 188,224). Its 42,689
  unresolved rows break down as **45.0% stdlib/prelude names** (`clone` 3,350 ·
  `assert_eq` 2,684 · `Ok` 2,241 · `Some` 1,907 · `into` 1,687 …), **21.9% macros**
  (`format` · `vec` · `println` · `bail` · `assert` …), and **33.1% other** (crate-local
  or third-party methods — `map_err`, `ok_or_else`, `with_context`, `subset_matches` …).
  A per-file analyzer has no declaration for any of them by construction.
* **The 33.8% ambiguous class is a name-collision class, not a failure**: a target
  resolving to **2+ declarations**. The top drivers are `calls file` (11,813 — the
  `(file)` pseudo-symbol colliding with a real callee named `file` in cargo),
  `calls run` (6,091), `calls new` (5,547), `calls cargo` (5,494). These are
  **real Rust code** calling real methods; the collision is with the family's own
  file-scope spelling `(file)`, which 11 lanes publish. It is a corpus-scale
  property of a bare-name key space, not a Rust-analyzer defect.
* **`contains` and `overrides` are the two 100% types** — both are declared inside
  the file (a container's members; an impl's method against a trait), so a per-file
  analyzer resolves them completely. That is the model working exactly as designed.
* **`imports` at 3.4% resolved / 67.1% extOK** is the claim design working: an
  import's honest terminal state is a *file claim*, not a declaration, and 7,929 of
  11,813 rows carry a project-verified claim with `extFAIL = 0`.
* **`mixes_in` at 6.2% / 84.6% unresolved** is the weakest type and the least
  fixable: `#[derive(Serialize)]` names a **trait from another crate**, so the target
  is external by definition. The emission is exact (11,176 rows = the census's
  `derive_args_total` exactly); the *resolution* cannot exceed what a per-file
  analyzer can see.

### 1c. The symbol surface (independent census, 2026-11-20)

| quantity | value |
| --- | ---: |
| admitted files | 2,532 |
| symbols | **40,492** |
| relationships | **326,092** |
| files carrying a parse-error tree | 525 |
| macro-argument reads (0.6 class) | 2,326 |
| refused edges (counted, not silent) | **2,238** (0.686% of edges) |

**By kind:** function 10,175 (25.1%) · method 8,422 (20.8%) · property 7,892 (19.5%) ·
enum_member 3,918 (9.7%) · impl 3,256 (8.0%) · struct 2,283 (5.6%) · module 2,125 (5.2%) ·
enum 1,025 (2.5%) · variable 615 (1.5%) · type 606 (1.5%) · macro 104 (0.3%) · trait 71 (0.2%).

**By visibility:** private 28,040 (69.2%) · public 11,717 (28.9%) · crate 682 (1.7%) ·
super 53 (0.1%).

**Refusals, by class:** `uses:identifier_read` 1,223 · `calls:macro_invocation` 475 ·
`decorates:unnamed_declaration` 265 · `decorates:inner_attribute` 202 ·
`calls:call_expression` 63 · `uses:field_expression` 9 · `part_of:include_non_literal` 1.

**The refusal ledger is the honesty contract in one number: 2,238 edges (0.686%) were
dropped and every one is named.** The largest class, `uses:identifier_read` (1,223), is
the R1 declaration-position guard: a name that appears in a declaring position (a
macro name, a trait-method signature, a fn-pointer parameter, an attribute, a `use`
path, a where-bound) is *not* a read. That is the intended filter, and its size is
measured rather than asserted.

### 1d. Confidence and evidenceClass, by type (from the fresh census)

| type | confidence written | evidenceClass |
| --- | --- | --- |
| `calls` | 1.0 (×180,486) | `usage_contextual` |
| `contains` | 1.0 (×22,507) | `structural` |
| `uses` | 1.0 (×13,194) · 0.9 (×12,803) · 0.6 (×2,326) | `usage_contextual` |
| `references` | 0.9 (×38,646) · none (×34, the where-bound class) | `import_based` (38,646) · `reference_qualified` (34) |
| `imports` | 1.0 (×11,813) | `import_based` |
| `exports` | 1.0 (×6,185) | `structural` |
| `overrides` | 1.0 (×179) · 0.85 (×2,731) | `structural` (179) · `usage_contextual` (2,731) |
| `instantiates` | 0.8 (×6,149) | `usage_contextual` |
| `extends` | 1.0 (×29) | `structural` |
| `implements` | 1.0 (×1,901) | `structural` |
| `decorates` | 1.0 (×15,930) | `usage_contextual` |
| `mixes_in` | 1.0 (×11,176) | `usage_contextual` |
| `part_of` | 1.0 (×3) | `usage_contextual` |
| `renders` | — (0 edges) | — |

The confidence ladder is exactly the documented one: **1.0** for tree-read facts
(a callee leaf, a container member, a `pub` item, a written path), **0.9** for a
declared type read off a node's type field, **0.85** for a cross-file trait-method
pair, **0.8** for a construction, **0.6** for a name read inside an *unexpanded
macro argument*. Nothing publishes 0.5 or below; nothing publishes an empty confidence.

---

## 2. The two measurement populations — and why they differ

| | declared (2026-10-23) | re-measured (2026-11-19) | delta |
| --- | ---: | ---: | ---: |
| files | 2,532 | 2,532 | 0 |
| repos | 9 | 9 | 0 |
| edges | 326,101 | 326,092 | −9 |
| resolved | 130,039 | 129,936 | −103 |
| amb(decl) | 110,581 | 110,327 | −254 |
| unresolved | 77,932 | 77,897 | −35 |
| extOK | 7,549 | 7,932 | **+383** |

The population did **not** move — the same 2,532 files across the same 9 repositories. Every type is
byte-identical except `imports`:

| | declared | re-measured |
| --- | ---: | ---: |
| `imports` edges | 11,822 | 11,813 |
| `imports` resolved | 506 | 403 |
| `imports` amb(decl) | 550 | 296 |
| `imports` unresolved | 3,220 | 3,185 |
| `imports` extOK | 7,546 | 7,929 |

The declared artifact was built against `analyzerDigest sha256:d8f03293…`, and **that commit
(`d52c665be`) is not in this repository** — `git cat-file -t d52c665be` returns
`fatal: Not a valid object name`. The shipped analyzer hashes `c4e5afbb…`. Two commits landed after
the declared measurement and both are in the shipped bytes:

* `f7778c7ad` — the impl container identity changed from `<Type>::impl` to `<Type>::r#impl`.
* `745939568` — Release 0.1.2.

`r#impl` changes the *symbol name* of every impl container, and with it the file a project-scoped
import resolves against. That is the mechanism behind the `imports` movement: **the count is
reproducible, the declaration is stale, and this section is the corrected measurement.**

---

## 3. Implemented vs ruled — the ontological question

**Every one of the 14 canonical relationship types is implemented for Rust, and none is ruled.**
This was verified construct-by-construct, not read from the register. A probe file exercising the
exact Rust syntax for each type was run through the shipped analyzer
(`.tmp-lead/construct-probe.rs`, `.tmp-lead/ext-probe.rs`, `.tmp-lead/exp-probe.rs`):

| # | type | Rust construct that carries it | measured rows |
| --- | --- | --- | ---: |
| 1 | `calls` | `f()`, `m.m()`, `mac!()` | 45 |
| 2 | `extends` | `trait A: B` (supertrait bound) | 1 |
| 3 | `implements` | `impl Trait for Type` | 2 |
| 4 | `uses` | value read `x`, `self.f`, `CONST` | 8 |
| 5 | `imports` | `use path::to::item;` | 1 |
| 6 | `exports` | `pub item`, `pub use`, `#[macro_export]` | 9 |
| 7 | `contains` | declaration nesting (mod/trait/struct/enum/impl) | 19 |
| 8 | `references` | type position (param/return/field/alias/const) | 12 |
| 9 | `overrides` | trait-impl method supplying a declared or default method | 2 |
| 10 | `instantiates` | `Type { .. }`, `Type::new(..)`, tuple-ctor `Type(..)` | 9 |
| 11 | `decorates` | outer attribute `#[attr]` on a declaration | 5 |
| 12 | `renders` | UI macro angle-tag naming a same-file component | 1 |
| 13 | `mixes_in` | `#[derive(A, B)]` | 2 |
| 14 | `part_of` | `include!("file.rs")` textual splice | 1 |

**13 of 14 fire on the first two probes; `exports` fires on the third** (it needs `pub` items, which
the first two files did not carry). A negative control (`fn main() {}`) emits zero relationships, so
no row is a false positive of the probe itself.

### Why "the grammar can't do it" is not a reason this lane accepts

Rust's grammar is not the constraint for any of the 14. `renders` is the only type with zero corpus
rows, and that is **corpus absence, not language absence**: the construct is real Rust (a leptos
`view!`, a yew `html!`, a dioxus `rsx!`), the emission fires on a synthetic file, and the grammar
parses the shape with `hasError:false`. Measured over all 9 repositories:
**0 render-macro invocations, 0 `Cargo.toml` naming leptos/yew/dioxus/maud/askama.** The absence is
in the corpus, and the census instrument counts exactly that shape so a future corpus that carries one
will be caught.

### The two rulings the register still records — and their status

The completeness spec's design-decision register contains 43 entries. Two of them are *historical*
rulings that the shipped analyzer has since **superseded**:

| decision | recorded | shipped reality |
| --- | --- | --- |
| `RUST-D1` | "No `overrides` edge exists by design (no method shadowing across impls)" | **Superseded.** The analyzer emits 2,910 `overrides` rows, and `deriveRustOverridesTruth` audits every one. The 2026-11-19 differential returns 0 unexplained on both rust corpora. |
| `RUST-D16` | "instantiates: the ORACLE's construction surface" — `RULED (SUPERSEDED BY RUST-D30)` | **Superseded by RUST-D30.** A bare `Ok(..)` is a prelude construction and does not publish a local-type `instantiates`. |

`RUST-D1`'s text is the one genuinely misleading sentence left in the register: it states a negative
that the code contradicts. It is prose, not a gate — the completeness spec carries no `excluded`
entry and `coverage.excluded` is `[]` — so nothing fails on it. It is corrected in this pass (§5).

---

## 4. Differential truth — 0 missing, 0 unexplained

`BB_CORPUS_ROOT=/home/ishaq2321/bb_tests/repositories bun script/m14/differential.ts --lang rust --sample 60`
(2026-11-19):

| corpus | files | tree-truth | covered | MISSING | analyzer-edges | unexplained |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ripgrep | 60 | 6,690 | 6,690 (100%) | **0** | 4,773 | **0** (0%) |
| cargo | 60 | 3,885 | 3,885 (100%) | **0** | 3,219 | **0** (0%) |

`heuristic=0` on both. The pinned floor `ripgrep:rust` hash is `3726f83d65a6e09a` and the run
reproduces it.

**One coverage gap existed, and it is CLOSED this pass.** The rust arm of `differential.ts` pushed
truth for `calls`, `uses`, `references`, `contains`, `imports`, `exports`, `overrides`, `extends`,
`implements`, `instantiates`, `decorates`, `mixes_in` and `part_of`. It pushed **no `renders`
truth** — `deriveRustEdges` has no render branch and no other rust oracle derived one — while the
allowlist admits `renders` for every language. That was the *allowance-without-truth* shape the
differential's own comments call worse than useless: the day a corpus carries a render macro, every
true `renders` row would have read UNEXPLAINED.

Closed by `script/m14/oracles/rust-renders.ts`, a lane-owned oracle written from the tree with no
analyzer import (its rule is stated from tree-sitter's own node types; the declaration inventory is
rebuilt from item nodes, not read off the analyzer's symbol table), wired into the rust arm beside
the other lane-owned oracles. Verified against the pinned fixture `rust/renders-component-tag`
(derives exactly `renders App -> MyButton`), plus four controls: a no-render-macro file derives 0;
a bare-HTML-tag `view! { <div/> }` derives 0; an undeclared tag `view! { <Other/> }` derives 0; a
non-render macro `format!("<Comp/>")` derives 0. The re-run differential is unchanged at 0 missing /
0 unexplained on both corpora (the corpus carries no render macro, so the pair stays
empty-passes-empty — which is now a MEASURED empty, not an unmeasured one).

---

## 5. Verification state at this head

| gate | command | result |
| --- | --- | --- |
| fixtures | `bun script/m14/run-fixtures.ts --lang rust` | **35 pass / 0 fail** (2026-11-20; was 34) |
| mutants | `npx tsx script/m14/mutate-analyzer.ts --lang rust` | **47 mutants, all caught** (2026-11-20; was 45) |
| grammar audit | `npx tsx script/m14/audit-analyzer-grammar.ts --lang rust` | **PASS refs=88 unknown=0 unknownFields=0** |
| docs | `npx tsx script/m14/verify-analyzer-docs.ts --lang rust` | **1/1 fully complete, 8/8 sections, 0 unexplained cells** |
| differential | `--lang rust --sample 60` | **0 missing / 0 unexplained** on ripgrep + cargo |
| M12 differential | `bun script/m12/verify-analyzer.ts rust` | **exit 0 — precision 1.000, recall 1.000, FP 0, FN 0** (116 facts) |
| declaration | `rust-declaration.ts` | 14/14 types close exactly |
| manifest AST | `bun script/m14/rust-manifest-ast-verify.ts` | **PASS — 14 manifests, 0 disagreements** |
| typecheck | `tsc` on the analyzer | **0 errors in `real-rust-analyzer.ts`** |
| whole-population arm | `incoming-gate.ts rust rs 0 --dump` | **2,532/2,532, 326,092 edges, closure exact** — byte-identical to 2026-11-19 |

The grammar audit's repo-wide `dead-literal gate FAILED` line names **javascript**
(`unknown refs 0 -> 3`, `implements_clause` / `generic_type`). That is another lane's regression, not
this one; rust's own row is PASS with 0 unknown.

---

## 5b. Artifact audit — every rust result artifact, and whether the tree agrees

Every rust-named artifact under `validation/` was opened at this head. The point is not that each
passes — it is that **no artifact may claim something the committed evidence contradicts**, which is
the failure this pass found twice.

| artifact | claim | verdict |
| --- | --- | --- |
| `validation/m12/results/rust-differential.json` | precision 1.000, recall 1.000, `passed: true` | **WAS FALSE — `passed: false`, 0.819, 21 FP / 5 FN.** Truth re-grounded; now true and exiting 0. §3/§5. |
| `validation/m14/results/M14.0.F5.json` | `differential-rust: fail` — "unexplained 0.1%; drew a different file set than the baseline… needs triage" | **STALE ARTIFACT, superseded.** Measured at `ripgrep@3fce3b5bb0`; the current baseline records `ripgrep:rust` = missing 0 / unexplained 0 with `sampleSetHash 3726f83d65a6e09a`, which the 2026-11-19 run reproduces exactly. The row's own words ("drew a different file set than the baseline") describe sample rotation, not a regression. The M14.0.F5 artifact is a canonical 50-language sweep and is not regenerated by a `--lang rust` scoped run. |
| `validation/m12/results/rust-corpus-errors.json` | `passed: false`, 24/400 error files | **NOT A DEFECT.** The `passed` flag means "this corpus carries parse-error trees", the fleet convention: go 5/400, kotlin 8/300, fsharp 82/400, c 20/45, cpp 133/218 all carry `passed: false`. Rust's 24 (6%) is the documented `str!` grammar gap (§`Unsupported`). |
| `validation/m59/results/oracle-callsite-scoped-rust-f200.json` | line-carrier audit | **CLEAN.** 200 files, 17,783 relationships, all with a line, **17,329 consistent / 0 inconsistent**, 454 not-checkable; the boundary mutation is CAUGHT. |
| `validation/m60/results/P1-rust.json` | M60-P1 line surface | **CLEAN.** 183,141 edges, `gt0: 183141, eq0: 0, nul: 0` — no edge publishes a 0 line. |
| `validation/m14/instruments/rust/incoming-declaration.json` | per-type closure | **CLEAN.** 14/14 types close exactly; `unclassed 0`, `extFAIL 0`. Annotated with the replay pointer. |
| `validation/m29/results/wave-rust.json` | wave fixture | **CLEAN.** `status: verified`. |
| `validation/m14/results/M14.0.F4.json` (mutation) | mutation evidence | **status: pass** — the rust mutant rows are inside a 50-language artifact. |
| `validation/m12/results/rust-complexity.json` | 2026-08-28 perf | **HISTORY, labelled as such** in the doc's Complexity envelope. |

The one thing that changed is the first row. Everything else was already consistent with its own
evidence once read; the two that *looked* like failures (`M14.0.F5`, `rust-corpus-errors`) are a
stale sample artifact and a fleet-wide convention respectively.

---

## 6. Known residual — the honest list

1. ~~**`renders` has no differential truth.**~~ **CLOSED 2026-11-19** by
   `script/m14/oracles/rust-renders.ts` (see §4). The allowance now has its truth, the fixture
   pins the emission, and the differential re-run is unchanged at 0/0 on both corpora.
   **The 2026-11-20 master review then found and fixed two emitter defects that the
   corpus-absence had hidden** — a lowercased bare-HTML test that refused every PascalCase
   component name colliding with an HTML tag, and an at-the-site component test that made
   emission depend on declaration order. Both fixed, pinned by `rust/renders-component-order`,
   and guarded by two mutants. See §8.
2. **`imports` is the weakest resolution class** (403 resolved of 11,813). A per-file analyzer cannot
   bind a module path to a declaration; the `importProjectFile` and `languageNamespace` claims are
   the honest terminal state, and 7,929 rows carry a project-verified claim. `extFAIL=0`.
3. **`extends` has 27 unresolved of 29.** Rust supertraits name `std` markers (`Send`, `Sync`, `Sized`)
   and serde traits by definition; a per-file analyzer has no project declaration for them.
4. **Macro bodies are opaque** (RUST-D2). `macro_rules!` expansion is not performed. This is a real
   Rust property, not a grammar limit: the expansion is a template, and no static per-file analyzer
   can name what it produces.
5. **Cross-file resolution is out of scope by construction.** The analyzer reads one file. The
   arbiter holds the project and is what answers a cross-file target.
6. **The `renders` label's truth is now derived, but the corpus still never exercises it.** The
   oracle's job was to make a future render macro *comparable*; it does not manufacture a corpus
   that carries one. The census counters (`render_macro_invocations`, UI-framework manifests) stay
   the falsifier for the class, and the fixture stays the sole regression guard for the emission.

---

## 7. Provenance of every number on this page

| number | where it comes from |
| --- | --- |
| 326,092 edges / per-type rows | `incoming-gate.ts rust rs 0 --dump`, 2026-11-19 **and re-run identically 2026-11-20** |
| 2,532 files / 9 repos / 0 failed | same run, `population:` line |
| 6,690 + 3,885 truth, 0 missing, 0 unexplained | `differential.ts --lang rust --sample 60`, 2026-11-19 and 2026-11-20 |
| 35/35 fixtures | `run-fixtures.ts --lang rust`, 2026-11-20 |
| 47 mutants, all caught | `mutate-analyzer.ts --lang rust`, 2026-11-20 |
| refs=88 unknown=0 | `audit-analyzer-grammar.ts --lang rust`, 2026-11-20 |
| 14/14 types close | `incoming-declaration.json` + this run's TABLE 1 |
| 40,492 symbols / 2,238 refusals / kind+visibility census | independent census `.tmp-mr/sym-census.mts` over all 2,532 admitted files, 2026-11-20 |
| 42,689 unresolved `calls` breakdown (45.0% std / 21.9% macro / 33.1% other) | `DUMP calls unresolved` rows, 2026-11-20 |
| 2 renders defects + fix | `.tmp-mr/real-render.rs` (leptos-shaped) + `.tmp-mr/dbg7.mts` order test, 2026-11-20 |

Anything not in this table is prose, and prose is not evidence.

---

## 8. The master review's two renders-emitter defects (2026-11-20)

The lane's `renders` fixture had passed since 2026-10-23, so the emitter was treated as
done. The master review tested it against a **real leptos-shaped component** instead of the
synthetic fixture — `#[component] fn App() -> impl IntoView { view! { <Button/> } }` with
`struct Button;` in the same file — and it produced **no `renders` row at all**. Two
independent defects, both latent because the corpus carries no render macro.

**DEFECT 1 — the bare-HTML guard lowercased the tag.**
`BARE_HTML.has(tag.toLowerCase())` refused every component whose PascalCase name lowercases
to an HTML tag. Measured class: `Button`, `Form`, `Label`, `Header`, `Main`, `Section`, `Nav`,
`Select`, `Option`, `Template`, `Canvas`, `Table`, `Path`, `Input`, `Footer`, `Article`,
`Aside` — **17 plausible Rust component names**, all silently refused as "a bare HTML tag".
The guard's real impostor class is **lowercase in every UI framework's grammar**
(`<div>`, `<span>`, `<my-element>`), because that is how HTML spells; Rust components are
PascalCase by convention and snake_case at worst. Fixed by testing the **written spelling**.
Measured: 0 renders edges before, 1 after, for `view! { <Button/> }` + `struct Button;`.

**DEFECT 2 — the component test ran during the walk.**
"Does this file declare the tag?" was asked at the render site, so a component declared
**below** its use was not yet in `ctx.symbols`. Measured: `fn App() { view!{ <Button/> } }`
then `struct Button;` → 0 renders edges; the same two items in the opposite order → 1.
**Same program, different output depending on where the author put the declaration** — a coin
flip, not a rule. Fixed by deferring the candidate until the symbol table is complete
(`pendingRenders`, the shape `pendingInstantiations` already uses for constructor targets).

**Pinned, and provably behaviour-preserving at scale.** New fixture
`rust/renders-component-order` declares `Button` *after* its use and `Form` *before* it, so
it fails if either half regresses; the impostor must-nots stay pinned (`<div/>` refused as
`renders:bare_html_tag`, `<Other/>` as `renders:tag_not_a_same_file_symbol`). Two mutants,
one per defect: `rust/renders-lowercase-html-collision`, `rust/renders-order-dependent`.
Battery 45 → **47, all caught**. Fixtures 34 → **35, all passing**.

The whole-population re-measurement after both fixes is **byte-identical**: 2,532 files,
326,092 edges, 0 renders edges, 0 render files, TABLE 1 unchanged on all fourteen types.
That is the proof this was a latent-correctness fix to an emission the corpus cannot reach,
not a population change.

| 14 manifest AST agreements | `rust-manifest-ast-verify.ts` |
| 0 UI frameworks / 0 render macros | `grep` over all 9 repos' `.rs` + `Cargo.toml` |

Anything not in this table is prose, and prose is not evidence.