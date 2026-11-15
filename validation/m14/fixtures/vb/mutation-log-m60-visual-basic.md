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
| `vb/construction-climbs-any-access-chain` | fabricated-target | **SURVIVED** — the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach |
| `vb/namespace-prefix-climb-removed` | wrong-target | **SURVIVED** — the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach |
| `vb/type-arguments-kept-in-heritage-target` | unusable-target | **SURVIVED** — the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach |
| `vb/tuple-type-published-as-its-own-text` | fabricated-target | **SURVIVED** — the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach |
| `vb/duplicate-relationship-rows-restored` | duplicate-edge | **SURVIVED** — the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach |
| `vb/dedupe-keyed-without-the-line` | lost-fact | **SURVIVED** — the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach |
| `vb/unnamed-construction-dropped-silently` | undisclosed-gap | **SURVIVED** — the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach |

Baseline before the run: green. Analyzer restored: yes.
