/**
 * PHP's ruling table for `script/m14/ontology-coverage-gate.ts` — and the record of the
 * ruling that was in it, which measurement FALSIFIED.
 *
 * ## The table is empty, and that is the finding
 *
 * `PHP_RULED` has no rows. All ten types are EMITTED by production `parseFile` on the
 * admitted corpus, and the arbiter's verdict loop checks EMITTED FIRST — so a row for an
 * emitted type is dead configuration and, worse, a claim the type is not emitted, which is
 * false. The census is `validation/m14/fixtures/php/census-harness.mts`; its artifact is
 * `validation/m60/php/ontology-census.json` (4,641 of 4,642 admitted files analysed, 1
 * excluded as a parseFile fallback — see its `fallbackFiles`):
 *
 *   uses 133,419 | calls 94,492 | contains 30,454 | imports 25,914 | instantiates 10,612
 *   references 8,675 | extends 2,819 | implements 1,000 | exports 57 | overrides 2
 *
 * ## WHAT THIS FILE PREVIOUSLY RULED, AND WHY IT WAS WRONG
 *
 * The previous revision of this file carried one row: `exports`, RULED on Instrument B,
 * on a parse-tree count that read
 *
 *   R1  `class_alias` / `function_alias`   0 in 4,642 files
 *   R2  `define('NAME', …)`                 0 in 4,642 files
 *
 * R2 was a VACUOUS ZERO — the probe could not fire on any input. It read
 * `arguments.namedChild(0)` and tested it for `string` / `encapsed_string`, and
 * tree-sitter-php puts an `argument` node in between:
 *
 *   function_call_expression
 *     name "define"
 *     arguments
 *       argument           <- what namedChild(0) returned
 *         encapsed_string  <- the node the test wanted
 *
 * So the test compared an `argument` node against two string node types and never matched.
 * **No corpus could falsify that number, because no corpus makes it non-zero.** The
 * overturn condition the row itself stated — "R1 > 0 or R2 > 0 on any admitted corpus" —
 * was therefore unreachable, which is the specific way a ruling can be both falsifiable in
 * form and unfalsifiable in fact.
 *
 * What caught it was a CONTROL corpus, not a bigger sample:
 * `validation/m14/fixtures/php/exports-probe-controls.mts` builds seven files that contain
 * each construct and asserts every probe FIRES. The control file `define("X", 1);` read 0.
 * With the wrapper descended the corpus reads 60 `define()` calls in 20 files — 57 at file
 * scope, 11 nested inside a function body, across 20 files — so the construct is real, the
 * type is a GAP, and `src/ast/real-php-analyzer.ts` now emits it.
 *
 * The lesson is recorded here rather than only in the commit because it is the general
 * failure: a probe that CANNOT FIRE is indistinguishable from a probe that found nothing,
 * and only a positive control separates them. `validation/m14/fixtures/php/exports-probe.mts`
 * still carries the corrected probe and its counters.
 *
 * ## What the arbiter needs from the owner (workstream §8 — reported, not applied)
 *
 * `ontology-coverage-gate.ts` refuses to report for any language absent from its
 * `RULED_BY_LANG` literal, so run against `php` it spends the whole corpus walk and then
 * declines to print a row:
 *
 *   import { PHP_RULED } from "./php-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { php: PHP_RULED, bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED }
 *
 * Two lines. `validation/m14/fixtures/php/ruled-gate.ts` applies exactly those two lines to
 * a COPY of the gate in /tmp and runs the copy, so the table is proved rather than asserted;
 * with the table wired, the gate prints 10 of 10 EMITTED for php and exits 0.
 *
 * No THIRD patch is needed, and the reason is worth having written down: `rulingFor()` checks
 * `RULED.find(r => r.type === t)` FIRST and only falls through to
 * `script/m14/spec/php-completeness.json` when the table has no row. With every php type
 * emitted, `rulingFor` is never consulted at all. That is fortunate rather than designed —
 * simulating the gate's own predicate against php's real spec returns `null` for `exports`,
 * because PHPD33's `resolution` mentions the type but matches neither half of the gate's
 * second test (`/ontology|emits|excluded|type/i`). If a future php type ever needs a ruling,
 * that spec gap bites immediately. It is reported as `PHP_RULING_FOR_SPEC_GAP` below.
 */

/** The gate's own row shape, restated so this file stays checkable if the gate's moves. */
type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"

export type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

/**
 * EMPTY, deliberately. See the header: the one row this table held was falsified by a
 * positive control, and a row for an emitted type is a false claim.
 */
export const PHP_RULED: Ruled[] = []

/**
 * The falsification, kept as data rather than only as prose, because the numbers are the
 * part a reader cannot re-derive by reading this file.
 */
export const PHP_FALSIFIED_RULINGS = [
  {
    type: "exports",
    instrument: "B:parse-tree-count",
    ruledOn: "0 `class_alias`/`function_alias` calls and 0 `define()` calls in 4,642 admitted corpus files",
    falsifiedBy:
      "a POSITIVE CONTROL corpus (validation/m14/fixtures/php/exports-probe-controls.mts): seven files, one per construct, asserting every probe fires. `define(\"X\", 1);` read 0, which located the defect — `arguments.namedChild(0)` is an `argument` wrapper, so the test could not match on any input and no corpus could have falsified it.",
    measuredAfterFix: {
      defineLiteralNameTotal: 60,
      filesWithDefineLiteralName: 20,
      defineAtFileScope: 57,
      defineInsideAFunctionBody: 11,
      defineWithNonLiteralName: 1,
      aliasCalls: 0,
      qualifiedFunctionConstUse: 12,
      qualifiedUseWhoseLeafTheFileAlsoDeclares: 3,
      unqualifiedFunctionConstUse: 6140,
    },
    outcome: "GAP — implemented in src/ast/real-php-analyzer.ts as emitDefineExports; 57 `exports` edges over 17 files, every target resolving to a published declaration (43 distinct targets exact-tier, 5 ambiguous across 14 edges, 0 unresolvable).",
    artifact: ["validation/m60/php/exports-probe.json", "validation/m60/php/ontology-census.json"],
  },
] as const

/**
 * REPORT (not consumed by the gate): `rulingFor("exports")` returns `null` against PHP's
 * real spec, and the fix is NOT this lane's.
 *
 * `rulingFor` requires a RULED decision whose `resolution` mentions the type AND matches
 * `/ontology|emits|excluded|type/i`. PHP's PHPD33 is the `exports` ruling and its body
 * mentions the type, but matches neither half of the second test. So a future php ruling
 * that is not in `PHP_RULED` would print `RULED-UNJUSTIFIED` — a verdict about the SPEC's
 * prose and not about the lane. This lane's spec (`script/m14/spec/php-completeness.json`)
 * is shared with the completeness inventory and its evidence file
 * `validation/m14/results/M14.0.SPEC*.json` lists each lane's ruled decisions, so amending
 * PHPD33's `resolution` is a two-file change for the owner. Reported, not edited.
 *
 * It is inert today, and that is why it is safe to leave: with all ten types emitted, the
 * verdict loop never reaches `rulingFor`.
 */
export const PHP_RULING_FOR_SPEC_GAP = {
  spec: "script/m14/spec/php-completeness.json",
  decision: "PHPD33",
  rulingForReturns: null,
  reason:
    "PHPD33's resolution mentions `exports` but matches neither half of the gate's second test (/ontology|emits|excluded|type/i), so rulingFor returns null for that type against this spec. Inert while every php type is EMITTED; biting the moment a ruling is needed.",
}