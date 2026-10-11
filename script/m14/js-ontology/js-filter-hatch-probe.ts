/**
 * JS FILTER-HATCH PROBE — the pin for the SHARED noise filter's escape hatch.
 *
 * WHY A GATE AND NOT A FIXTURE. The change this pins is in
 * `src/ast/pool-worker.ts`, and the fixture harness never runs that file: svelte and
 * vue go through `ASTEngine.parseFile` (production parity for SFCs) and every other
 * lane runs its analyzer directly, so `filterNoiseRelationships` is exercised by NO
 * fixture in the tree. A behaviour change there cannot be pinned where the fixtures
 * live, which is exactly why the lane's Open finding §1 stayed open with a number
 * attached instead of being quietly absorbed. So the pin is a gate with an exit
 * code, in the lane's own idiom.
 *
 * WHAT IT ASSERTS, all by CALLING the filter, never by re-stating its list:
 *
 *   1. a name the FILE DECLARES survives `NOISE_TARGETS` (`type` here);
 *   2. a name the file only BINDS — an import binding — survives it, and this is the
 *      case the hatch could not see before (JS lane §1): the binding publishes no
 *      symbol, and the `imports` row's target is path-spelled (`m:text`), so even a
 *      declared name could not be matched by the old whole-target comparison;
 *   3. a name the file NEITHER declares NOR binds is refused WHEN THE ROW CARRIES NO
 *      STRUCTURAL MARKER — the leak shape, and the assertion that keeps a future
 *      "widen the hatch" change from passing silently;
 *   4. the COLLISION RULE: a scoped noise name the ANALYZER recorded as a source read
 *      (member read, member call, template interpolation) is admitted, in the JS
 *      family only, and NOT for the universal test-lifecycle group.
 *
 * THE NEGATIVE CASES ARE THE ONES THAT MATTER. The positive assertions alone are all
 * satisfied by deleting the check.
 *
 *   bun run script/m14/js-ontology/js-filter-hatch-probe.ts
 *   exit 0 = every case holds; exit 1 = at least one failed (prints which)
 */
import { importBindingNames, filterNoiseRelationships } from "../../../src/ast/pool-worker"

const NOISE = "type" // in NOISE_TARGETS; also an ordinary member name in real code
const NOISE2 = "parent" // in NOISE_TARGETS; read off an external object below

/** One `= (::)` helper so every case is stated the same way. */
function survives(target: string, declared: string[], imported: any[] | undefined): boolean {
  const rel = [{ type: "uses", source: "f", target }]
  return filterNoiseRelationships(rel as any, "javascript", new Set(declared), importBindingNames(imported)).length === 1
}

/** A raw row (so `metadata` can be stated) through the filter for one language. */
function survivesRow(rel: any, language = "javascript"): boolean {
  return filterNoiseRelationships([rel] as any, language, new Set(), new Set()).length === 1
}

type Case = { label: string; target: string; declared: string[]; imported?: any[]; want: boolean }

const cases: Case[] = [
  {
    label: "1. declared name survives",
    target: NOISE,
    declared: [NOISE],
    want: true,
  },
  {
    label: "2a. import BINDING survives (bare read of the imported name)",
    target: NOISE,
    declared: [],
    imported: [{ module: "./x.js", items: [NOISE] }],
    want: true,
  },
  {
    label: "2b. import BINDING survives when the row's target is PATH-SPELLED",
    target: "./x.js:" + NOISE,
    declared: [],
    imported: [{ module: "./x.js", items: [NOISE] }],
    want: true,
  },
  {
    // `import { something as type }` binds the LOCAL name `type`, and the row's
    // leaf is that noise-listed name. This is the alias shape that exercises the
    // hatch: the case that came before it used a target (`par`) that is NOT in
    // NOISE_TARGETS, so it passed with or without the hatch and asserted nothing.
    label: "2c. a local ALIAS of a noise name is admitted",
    target: NOISE,
    declared: [],
    imported: [{ module: "./x.js", items: ["other as " + NOISE] }],
    want: true,
  },
  {
    label: "2d. the imported spelling is admitted too (`parent as par` -> `parent`)",
    target: NOISE2,
    declared: [],
    imported: [{ module: "./x.js", items: [NOISE2 + " as par"] }],
    want: true,
  },
  {
    label: "3. a name the file neither declares nor binds is STILL refused",
    target: NOISE2,
    declared: [],
    imported: [{ module: "./y.js", items: ["other"] }],
    want: false,
  },
  {
    label: "3b. still refused when the file imports a DIFFERENT name",
    target: NOISE,
    declared: [],
    imported: [{ module: "./z.js", items: ["elsewhere"] }],
    want: false,
  },
  {
    label: "3c. still refused when nothing is passed at all (the call shape every instrument uses)",
    target: NOISE,
    declared: [],
    want: false,
  },
]

//
// 4. THE COLLISION RULE. Each POSITIVE here is a row the JS analyzer really emits on
// real corpora — the three markers were added one at a time, each against a measurement
// (svelte 600 files: 378 lost -> 16 -> 0; lodash 51 files: 4 -> 0). Each NEGATIVE is the
// shape that must keep the rule honest, and the last one is why the rule is scoped: the
// universal test-lifecycle group is deliberately NOT covered.
//
const collisionCases: { label: string; rel: any; language?: string; want: boolean }[] = [
  {
    label: "4a. member READ is admitted (`node.type` -> isFieldAccess)",
    rel: { type: "uses", source: "f", target: NOISE, metadata: { isFieldAccess: true } },
    want: true,
  },
  {
    label: "4b. member CALL is admitted (`$el.text('x')` -> dotted calleeExpression)",
    rel: { type: "calls", source: "f", target: "text", metadata: { calleeExpression: "$el.text" } },
    want: true,
  },
  {
    label: "4c. template INTERPOLATION is admitted (`${type}` inside a function)",
    rel: { type: "uses", source: "f", target: NOISE, metadata: { isTemplateInterpolation: true } },
    want: true,
  },
  {
    // THE LEAK SHAPE. An analyzer that passes `node.type` where a symbol name belongs
    // records no structural marker at all, and must still be refused — this is the case
    // the whole list exists for, and it is why the rule reads `metadata` instead of
    // blessing the three names.
    label: "4d. a BARE collision target with NO marker is STILL refused (the leak shape)",
    rel: { type: "uses", source: "f", target: NOISE },
    want: false,
  },
  {
    label: "4e. a bare CALL (undotted calleeExpression) is still refused",
    rel: { type: "calls", source: "f", target: NOISE, metadata: { calleeExpression: NOISE } },
    want: false,
  },
  {
    // Scope, pinned — and the expectation here was WRONG in the first version of this
    // gate, which asserted `false`. The M60 LUA-16 scoping does not refuse a marked row
    // outside the JS family; it skips the accessor list for that language altogether, so
    // the row SURVIVES (`family && !family.has(language)` -> admit). That is the measured
    // Lua fix — 345 real `type()` stdlib calls were being eaten — and the direction is
    // deliberate: a language that never had this noise cannot gain it by being exempt.
    // Stated as an assertion so the exemption cannot be quietly narrowed later.
    label: "4f. a language that never had the accessor noise is EXEMPT from the list entirely",
    rel: { type: "uses", source: "f", target: NOISE, metadata: { isFieldAccess: true } },
    language: "python",
    want: true,
  },
  {
    label: "4g. the UNIVERSAL group keeps its full force even in a member position",
    rel: { type: "calls", source: "f", target: "setUp", metadata: { isFieldAccess: true } },
    want: false,
  },
]

let failed = 0
for (const c of cases) {
  const got = survives(c.target, c.declared, c.imported)
  const ok = got === c.want
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.label}  (target=${JSON.stringify(c.target)}, survived=${got}, want=${c.want})`)
}
for (const c of collisionCases) {
  const got = survivesRow(c.rel, c.language)
  const ok = got === c.want
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.label}  (target=${JSON.stringify(c.rel.target)}, lang=${c.language ?? "javascript"}, survived=${got}, want=${c.want})`)
}

const total = cases.length + collisionCases.length
console.log(`\n${total} cases, ${total - failed} pass, ${failed} fail`)
console.log(`binding names derived for the (X as Y) record: ${JSON.stringify([...importBindingNames([{ items: ["parent as par"] }])])}`)
process.exit(failed === 0 ? 0 : 1)
