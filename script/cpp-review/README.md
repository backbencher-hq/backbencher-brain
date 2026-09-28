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
