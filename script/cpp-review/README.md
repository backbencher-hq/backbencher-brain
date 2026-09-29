# `script/cpp-review` — the C++ lane's measurement instruments

Every number in `docs/analyzers/real-cpp-analyzer.md` and in issues #957–#961 comes from
one of these. They are probes, not gates: they are how a claim was measured, kept so the
claim can be re-measured rather than taken on trust. A finding nobody can re-run is a
claim.

All of them honour `BB_CORPUS_ROOT` (default `$HOME/ishaq/fixtures/repositories`) and
`CPP_REPOS` (default `fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig` — 1,722 C++ files).

| probe | what it answers |
|---|---|
| `defect-register.ts` | **the gate.** Asserts on what the analyzer PUBLISHES across D1–D6, and reports R1 (the grammar limitation) without gating on it. Exits non-zero on any gated class above 0. |
| `explain.ts` | per-file dump of every symbol and relationship, with a `DUPLICATE (source,type,target) PAIRS` section. How D3 and the D4/D5 fabrications were found. |
| `dump.ts` | node-level tree dumps for a shape — fields, spans, MISSING/ERR marks. Every node-level ruling in the analyzer's comments rests on one of these. |
| `keywords.ts` | the C++ keyword space in isolation: every keyword landing as a `calls` target, a `uses` target, or a symbol name. This is D1's measurement. |
| `d3-contains-dupes.ts` | duplicate `contains`/`references` rows per file, with `calls` excluded **by contract** and the exclusion stated in the artifact. |
| `d5-fnowner.ts` | symbols owned by a function, split by kind into fabrication vs legitimate local type. This is D5's measurement. |
| `d5-decision.ts` | class-body truncation census and the lines-outside totals behind R1. |
| `class-extent.ts` | for one class: where the grammar's node ends, where the source's brace balance ends, and the gap. |
| `macro-label-recovery.ts` | the D4 tree shape in isolation (declarator error-adjacent to a single bare identifier). |
| `d5-fnparam.ts` | **a hypothesis that measurement REFUTED.** Kept on purpose: the theory was that `parameter_declaration[declarator=function_declarator]` is always recovery (C++ has no function-*type* parameter). 177 sites over 970 files, and the population is overwhelmingly legitimate direct-initialization — `std::string contents(ReadEntireFile(f));` — so gating on that shape would have deleted real code. The repo's practice is to record what was measured and thrown away. |
| `loss-census.ts` | **the complement of the register.** For every declaration the grammar hands over at file/namespace/class scope, is there a published symbol? D1–D6 are all fabrication-shaped and cannot see a loss; this asks the other question, and found D7. |
| `coverage-share.ts` | how much of the lane's output the M14 differential actually audits (17.4% of rows are inside its "100% covered" and unexamined) |
| `d7-attribute-name.ts` | D7's measurement: specifiers whose `name` field is a `qualified_identifier`, and which arm each belongs to |
| `dbg-parent.ts`, `enumnodes.ts` | two-line node probes used to pin a parent/field chain before a fix was written on it |
| `perf-interleaved.ts` | the pre/post A/B, both arms in ONE process, order alternated per rep, parse excluded. |

## Two disciplines these encode

**A gate must be able to fail, and D7 is the one that proved it.** The first cut of D7's
check imported the analyzer's own `specifierDeclaredName` — consistent with every other
class, and wrong here. Its self-test died with *"Export named 'specifierDeclaredName' not
found"* instead of reporting a violation, because a gate that imports the code under test
cannot be run against the code it gates. D7's legibility test is therefore stated inside
the register as the contract it is (five lines), while the analyzer implements it in the
two exported helpers. Two statements of one small contract, on purpose: one of them has
to be able to run when the other is broken. Verified: pre-fix analyzer → `D7: 22`,
`pass: false`; fixed → 0.

**A shape is not a defect; an OUTPUT is.** The first version of `defect-register.ts` asserted
on tree shapes for D4/D5 and on repeated `(source,type,target)` rows for D3. All three were
wrong: a shape can be present and correctly handled, and two call sites are two facts rather
than one duplicated fact. The register now asserts on what the analyzer publishes, and says so
in its own `assertsOn` field.

**One arm per process measures contention, not code.** `perf-interleaved.ts` exists because
the first A/B reported 14.6 ms/file pre-fix against 18.6 ms/file post-fix — a 27%
"regression" on a box whose run-to-run spread was 27%. Both arms now alternate in one process
on the same trees. The measured result is that the two distributions **overlap** (ratio 0.755
/ 0.975 and 0.898 / 1.101 across two runs), so there is no time claim; the machine-independent
win is the output volume (`removedPerPass`: 91 symbols and 773 relationships per 120 files).

## The pre-fix arm is not committed

`perf-interleaved.ts` materialises it from `git show <BASE>:src/ast/real-cpp-analyzer.ts` at
run time (`BASE`, default `2d32f088b9`) and deletes it afterwards. A committed second copy of
the analyzer is 2,700 lines that go stale the next time it is edited, and a stale measurement
harness is worse than none.

## The payload/grammar/line instruments (M60.P1 wave, 2026-09-29)

Four new probes, each answering a question the existing suite had no vocabulary for.

### `payload-coverage.ts` — the complement question for FIELDS, not symbols

`defect-register.ts` and `loss-census.ts` both ask whether a *declaration* reached the
output. Neither can see a symbol that is published perfectly and carries an **empty
payload field** — which is exactly what `parameters`, `returnType` and `decorators` were.
This probe counts, per corpus file, how many callables carry each field, plus the shape
counts that make each defect's size concrete: defaulted parameters, parameters whose
type carries a `*`/`&`, and `returnType` values spelled `auto`.

It is a **coverage report, not a gate**: it exits 0 whenever the three fields are
populated. Correctness of the values is gated by the fixture and its mutants, which is
the right division of labour — a corpus-wide count can prove a field is *there*, and only
a fixture can prove it is *right*.

Measured over 13,767 files / 1,078,003 symbols / 215,817 callables: `parameters` on
125,047 (57.9% — the rest genuinely take none), `returnType` on 113,965 (52.8%),
`decorators` on 63,833 callables and 11,913 non-callables. Defect sizes: 160,717
ptr/ref-typed parameters, 2,146 defaults, 95 bare deduced returns.

### `grammar-provenance.ts` — is the wired grammar the thing the doc names?

Answers a question no other probe asked: **is the wasm actually what the documentation
claims it is?** For cpp it is not. The doc said "0.23.4 (npm, latest)"; the wired bytes
are a **local fork of 0.23.4** carrying three rules for upstream #743, and the two
differ by ~118 KB in sha256 and length. The probe reports both hashes, the surface
delta, and the load-bearing comparison: the fork parses **22/28** of this lane's fixtures
clean against upstream's **20/28**, and the two it rescues are the ones whose symbols
would otherwise be lost. Re-record with `verify-grammar-pins.ts --write --lane cpp`.

### `line-contract.ts` — M59.A7/M60, every row, not a sample

Walks all **238,172** relationship rows and asserts each `line_number` is either absent
or a positive integer matching the tree-derived truth. Result: `noLine 0`, `lineZero 0`,
`subOneOrNonInteger 0`, `mirrorDisagrees 0`. It also prints the relationship types never
seen, which cross-checks the ontology probe below.

### `relationship-ontology.ts` — "no such construct" vs "the analyzer forgot"

The engine carries **10** `RelationshipType` values; C++ emits **7**. This probe asserts
that every engine value is accounted for in the doc, and that each doc claim (`emits` /
`silent`) matches the code in **both** directions. It exists because the first version of
that table claimed `imports`/`exports` were emitted (they are separate `ImportInfo[]` /
`ExportInfo[]` payload) and omitted `implements` entirely (no distinct C++ spelling —
`class D : B` publishes `extends`). Its self-test proves it can catch a false *emitted*
claim and a deleted row, not just a missing one.

### What the perf probe said about the payload work

The added work is O(N) over the existing walk (one decorator scan, one parameter walk, one
`trailing_return_type` lookup per declaration) with no new traversal. The first
measurement disagreed with that argument — `ratioBest 1.246` — and the measurement was
right: `hasDirectModifier` does **two** scans per call and the branch made six, so eight
scans were answering four questions the decorator list answers at once. Deriving the
`isStatic`/`isConstexpr`/`isConst`/`isVirtual` flags **from** the list brought it to
`ratioBest 0.99`. The distributions still overlap (pre 1617–3488 ms, post 1601–3444 ms
over 9 interleaved reps), so **no time claim is made**; `removedPerPass` is
`{ symbols: 0, relationships: 0 }`, which is the honest number for a wave that only
completed a payload.
