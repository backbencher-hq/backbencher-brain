# M60/VISUAL_BASIC local mutation log — `src/ast/real-vb-analyzer.ts`

Source-level mutants driven by `script/m14/vb-mutate-local.ts`, each a single
edit to the analyzer, each run through `npx tsx script/m14/run-fixtures.ts --lang vb`
with the file restored afterwards and the restoration verified byte-for-byte. The lane is
required to be GREEN before any mutant runs: a "survivor" measured against a red
baseline is not a survivor.

These are lane-owned because `script/m14/mutate-analyzer.ts` is MASTER-owned and
because four of these defects are not expressible as a post-hoc transform of an
emitted result — the edge looks well-formed in the output and only the analyzer's own
tree decision is wrong.

| mutant | defect class | outcome |
|---|---|---|
| `vb/construction-climbs-any-access-chain` | fabricated-target | **KILLED** —       - expected relationship not found: {"comment":"FIX 4 does NOT collapse across lines. Two constructions of one type on two lines are two facts about the program, and the M59.A7 per-site line contract requires both rows -- a per-pair dedupe would silently discard it. `sites` on the `uses` row be |
| `vb/namespace-prefix-climb-removed` | wrong-target | **KILLED** — FAIL  vb/edge-endpoint-integrity /       - expected relationship not found: {"comment":"FIX 1b, and the half that must NOT regress. `New System.Text.StringBuilder` holds only `New System`; the type continues in the access chain, so climbing is REQUIRED and StringBuilder is the answer. This row is th |
| `vb/type-arguments-kept-in-heritage-target` | unusable-target | **KILLED** — FAIL  vb/edge-endpoint-integrity /       - expected relationship not found: {"comment":"FIX 2. The type arguments are dropped, and the arity is recorded so the reduction is visible rather than silent. The target keeps its `IEnumerable` qualifier deliberately: `GetEnumerator` alone would collapse `im |
| `vb/tuple-type-published-as-its-own-text` | fabricated-target | **KILLED** — FAIL  vb/edge-endpoint-integrity /       - expected relationship not found: {"comment":"FIX 3. A tuple type names SEVERAL types, so it emits one `references` edge per element rather than the single name `namingToken` could return.","type":"references","from":"Requirements","target":"ValueRange","met |
| `vb/symbol-metadata-clobbers-access-level` | fabricated-metadata | **KILLED** — FAIL  vb/ontology-exports-instantiates-uses /       - expected relationship not found: {"type":"exports","from":"InternalOnly","target":"LooksPublic","line_number":104,"comment":"A modifier-less top-level CLASS defaults to `Friend`, so `InternalOnly` is not an export of the assembly (`root -> Intern |
| `vb/duplicate-relationship-rows-restored` | duplicate-edge | **KILLED** — FAIL  vb/edge-endpoint-integrity /       - expected metadata.vbGaps = {"construction-without-readable-name":1,"relationship-duplicate-rows-collapsed":1}; got {"construction-without-readable-name":1} /       - expected 1 relationship(s) {"type":"references","from":"ThreeStrings","target":"String"}; g |
| `vb/dedupe-keyed-without-the-line` | lost-fact | **KILLED** — FAIL  vb/edge-endpoint-integrity /       - expected 2 relationship(s) {"type":"instantiates","from":"Twice","target":"StackFrame"}; got 1 /       - expected relationship not found: {"type":"instantiates","from":"Twice","target":"StackFrame","line_number":86} / summary: {"vb":{"pass":5,"fail":1}} / F |
| `vb/unnamed-construction-dropped-silently` | undisclosed-gap | **KILLED** — FAIL  vb/edge-endpoint-integrity /       - expected metadata.vbGaps = {"construction-without-readable-name":1,"relationship-duplicate-rows-collapsed":1}; got {"relationship-duplicate-rows-collapsed":1} / summary: {"vb":{"pass":5,"fail":1}} / FIXTURE REGRESSION vb: 0 -> 1 failures |
| `vb/decorates-suppressed` | relationship-loss | **KILLED** —  |
| `vb/decorates-inherits-enclosing-type-attributes` | relationship-fabrication | **KILLED** — FAIL  vb/attributes-as-decorations /       - forbidden relationship present: {"comment":"THE UNBOUNDED-CLIMB DEFECT. `Keep` is a member of `Store`, which is decorated; if the holder climb were unbounded, `Keep` would inherit `<System.Serializable()>` from its enclosing type. The bounded climb exists |

Baseline before the run: green. Analyzer restored: yes.
