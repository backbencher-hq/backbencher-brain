/**
 * POWERSHELL_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` needs before it
 * will report this lane at all.
 *
 * ## This table is EMPTY, and that is the finding
 *
 * `POWERSHELL_RULED` has zero entries because this lane fires all ten relationship types on
 * real PowerShell code, and a ruling table only adjudicates types the analyzer does NOT emit.
 * There is nothing to adjudicate, so there is nothing to write.
 *
 * ## The measurement, and the command that produces it
 *
 *   npx tsx validation/m14/fixtures/powershell/census.ts --out <artifact>
 *
 * Production `parseFile` from `src/ast/pool-worker.ts` (NOT `analyze()`, which is a per-file
 * unit that skips the pool, the timeouts, the truncation and the enhancements), over the WHOLE
 * admitted set — no sampling cut — admitted byte-identically to the arbiter: git work tree,
 * `git ls-files`, <=512 KiB, `detectLanguageFromPath(abs, text) === "powershell"`. The
 * committed artifact is `validation/m14/measurements/powershell-census-*.json` and its ten
 * edge counts are restated in `docs/analyzers/real-powershell-analyzer.md` under "The ten
 * ontology types", where the population each count is about is named beside it.
 *
 * Two of the ten are narrow enough that a small sample says they do not fire at all, and both
 * narrow counts are the reason this table is written by a measurement rather than by a
 * reading:
 *
 *   `implements`   3 edges over 2 files. A PowerShell class header's `: Base, IFoo` list is
 *                   the only construct that expresses it, and the corpus uses a second name
 *                   in that list in two files.
 *   `overrides`    12 edges over 1 file. PowerShell has no `override` keyword — class methods
 *                   are virtual by default — so the edge is a same-name/same-kind comparison
 *                   against a resolved base, and the corpus exercises it in one inheritance
 *                   test suite.
 *
 * The committed 26-lane sweep (`validation/m14/measurements/firing-sweep-26-lanes.ndjson`,
 * powershell row) records `firedCount: 8` and `notFired: ["implements","overrides"]` over a
 * 120-file sample. That is a property of THE SAMPLE, not of the language: those 15 edges live
 * in 3 files, and 120 files drawn across 20 repos do not contain them. A gate that ruled on
 * that row would convict two types that do fire, on the evidence of a window too small to hold
 * them — which is the error the arbiter exists to catch, reached from the other direction.
 *
 * ## Why an empty table is the STRICT choice, not a convenient one
 *
 * `RULED_BY_LANG.powershell` being DEFINED is what the gate needs; its contents are only
 * consulted for a type with `observed.n === 0`. So with this table registered:
 *
 *   - all ten fired  -> ten EMITTED rows, `FALSIFIED 0`, exit 0;
 *   - any type later stops firing -> that type falls through to `rulingFor()`, which finds no
 *     table entry and no spec decision, and reports RULED-UNJUSTIFIED, exit 1.
 *
 * The second branch is the point. A table carrying stale prose would convert a regression into a
 * `RULED-SOUND` row and the gate would stay green while the lane lost a type. An empty table
 * cannot excuse anything, so a regression in this lane fails the gate loudly.
 *
 * ## Three open items that are NOT rulings, recorded so nobody adds them here
 *
 * All three are live, and all three are reachable by writing a ruling — which is why they are
 * named. None belongs in this table, and putting any of them in it would be a false verdict: a
 * ruling asserts a construct is INAPPLICABLE, and all three are cases where the type fires.
 *
 * 1. **DERIVATION: 3 types stored and compared against nothing.** `derivePowershellEdges` in
 *    `script/m14/differential.ts` (shared machinery) pushes seven labels — `contains`, `uses`,
 *    `calls`, `instantiates`, `exports`, `references`, `overrides` — and pushes ZERO `extends`,
 *    ZERO `implements`, ZERO `imports`. `script/m60/rel-type-coverage-gate.ts` CHECK 1 sees one
 *    of the three (`imports`); the other two are audited in name only, so their edges land in
 *    `unexplained` as confidently as an invented edge would. The fix is one derivation per
 *    label inside a shared file, so it is a report item rather than a lane edit.
 *
 * 2. **`calls` resolution is 7.4% on a 40-file stride and the unresolved population is
 *    overwhelmingly RUNTIME-resolved, not missing.** `Get-ChildItem`, `Join-Path`,
 *    `Where-Object` and the Pester DSL (`Describe`, `It`, `Should`, `BeforeAll`) are resolved
 *    by the PowerShell runtime from installed modules; no file in the corpus declares them.
 *    Measured and classified by
 *    `validation/m14/fixtures/powershell/ambiguity-split.mts`, artifact
 *    `validation/m14/measurements/powershell-ambiguity-split-*.json`. Marking them external is
 *    an ADDITIVE `metadata` key that changes no edge count.
 *
 * 3. **`contains` says lexical nesting, and the difference from scoping is a measured 950
 *    sites** (`named_block` bodies: `begin`/`process`/`end`/`dynamicparam`, plus 49 inside a
 *    `& { … }` child scope). Fixing it needs a synthetic scope symbol, which the Contract
 *    forbids. Declared, sized, not fixed.
 *
 * None of the three is a claim that PowerShell lacks a construct. All three are resolution or
 * derivation defects on types this analyzer emits, which is a different axis from the one this
 * table adjudicates.
 *
 * ## The supervisor's registry edit, in full
 *
 * In `script/m14/ontology-coverage-gate.ts`:
 *
 *   1. after the last `import { …_RULED } from "./…-ruled"` line, add
 *        import { POWERSHELL_RULED } from "./powershell-ruled"
 *   2. add `  powershell: POWERSHELL_RULED,` to `RULED_BY_LANG`.
 *
 * Both are additive. That file's own header calls `RULED_BY_LANG` a REGISTRY whose merge
 * conflict is always "both sides added a lane" and must resolve toward the UNION, so an
 * additive pair of lines cannot delete another lane's ruling table.
 */
import type { Ruled } from "./ontology-coverage-gate"

export const POWERSHELL_RULED: Ruled[] = []
