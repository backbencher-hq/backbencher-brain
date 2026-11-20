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
| fixtures | `bun script/m14/run-fixtures.ts --lang rust` | **34 pass / 0 fail** |
| grammar audit | `npx tsx script/m14/audit-analyzer-grammar.ts --lang rust` | **PASS refs=88 unknown=0 unknownFields=0** |
| docs | `npx tsx script/m14/verify-analyzer-docs.ts --lang rust` | **1/1 fully complete, 8/8 sections, 0 unexplained cells** |
| differential | `--lang rust --sample 60` | **0 missing / 0 unexplained** on ripgrep + cargo |
| declaration | `rust-declaration.ts` | 14/14 types close exactly |
| manifest AST | `bun script/m14/rust-manifest-ast-verify.ts` | **PASS — 14 manifests, 0 disagreements** |
| typecheck | `tsc` on the analyzer | **0 errors in `real-rust-analyzer.ts`** |

The grammar audit's repo-wide `dead-literal gate FAILED` line names **javascript**
(`unknown refs 0 -> 3`, `implements_clause` / `generic_type`). That is another lane's regression, not
this one; rust's own row is PASS with 0 unknown.

---

## 6. Known residual — the honest list

1. ~~**`renders` has no differential truth.**~~ **CLOSED 2026-11-19** by
   `script/m14/oracles/rust-renders.ts` (see §4). The allowance now has its truth, the fixture
   pins the emission, and the differential re-run is unchanged at 0/0 on both corpora.
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
| 326,092 edges / per-type rows | `incoming-gate.ts rust rs 0 --dump`, 2026-11-19 |
| 2,532 files / 9 repos / 0 failed | same run, `population:` line |
| 6,690 + 3,885 truth, 0 missing, 0 unexplained | `differential.ts --lang rust --sample 60`, 2026-11-19 |
| 34/34 fixtures | `run-fixtures.ts --lang rust` |
| refs=88 unknown=0 | `audit-analyzer-grammar.ts --lang rust` |
| 14/14 types close | `incoming-declaration.json` + this run's TABLE 1 |
| 14 manifest AST agreements | `rust-manifest-ast-verify.ts` |
| 0 UI frameworks / 0 render macros | `grep` over all 9 repos' `.rs` + `Cargo.toml` |

Anything not in this table is prose, and prose is not evidence.