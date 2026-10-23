#!/usr/bin/env bun
/**
 * SCSS SPEC COVERAGE — the 14-value declaration, written from the MEASURED artifacts.
 *
 * WHY THIS IS A GENERATOR AND NOT A HAND EDIT. The coverage block is what the Lead's coverage gate
 * reads for the owner's first condition ("every applicable type is implemented"). A hand edit is a
 * table nobody summed; this script composes the two RULING entries out of the census's own counters
 * (so a count cannot drift from the measurement) and refuses to write if the arithmetic or the
 * citations are wrong.
 *
 * THE VERDICTS THIS WRITES, each after its ladder was walked (validation/m14/verification/SCSS-EXTENDED-TYPES.md):
 *   implemented += mixes_in, part_of            — R3, existing node types, no grammar change
 *   excluded    += decorates (ontological), renders (grammar-absence) — R1 measured on the served
 *                  build's inventory, R2 unavailable because it would invent syntax, R3 no target node
 *
 * THE GRAMMAR LINE IS CORRECTED TO THE MEASURED SERVED IDENTITY: the old string cited sha256
 * 729731fb83e4 / 84 named types; the served build measured through the live parser is
 * 67b77cd800be… / 90 named of 195 ids (validation/m14/measurements/scss-grammar-nodes.json). A
 * digest is an identity, and the identity in the file must be the one that was measured.
 *
 * RUN:  bun script/m14/scss-spec-coverage.ts
 * WRITE: script/m14/spec/scss-completeness.json (coverage block + grammar line only)
 * EXIT: 5 an invariant failed (nothing written)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const SPEC = resolve(ROOT, "script/m14/spec/scss-completeness.json")
const CENSUS = resolve(ROOT, "validation/m14/measurements/scss-extended-census.json")
const GRAMMAR = resolve(ROOT, "validation/m14/measurements/scss-grammar-nodes.json")
const POP = resolve(ROOT, "validation/m14/measurements/scss-population.json")

const fail = (m: string): never => {
  console.error(`SCSS SPEC COVERAGE REFUSED — ${m}`)
  process.exit(5)
}
for (const [p, what] of [[SPEC, "spec"], [CENSUS, "extended census"], [GRAMMAR, "grammar inventory"], [POP, "population"]] as const) {
  if (!existsSync(p)) fail(`missing ${what}: ${p}`)
}

const spec = JSON.parse(readFileSync(SPEC, "utf8")) as any
const census = JSON.parse(readFileSync(CENSUS, "utf8")) as any
const grammar = JSON.parse(readFileSync(GRAMMAR, "utf8")) as any
const pop = JSON.parse(readFileSync(POP, "utf8")) as any

if (census.kind !== "WHOLE POPULATION") fail(`the extended census is a ${census.kind}`)
if (census.guard?.filesRead !== census.guard?.filesAdmitted || census.guard?.filesFailed !== 0) fail("the extended census leak guard did not hold")
if (!(pop.admitted > 0)) fail("the population artifact says 0 admitted")

const c = census.counts as Record<string, number>
const filesBy = census.filesBy as Record<string, number>
const served = String(census.servedBuildR1?.servedWasSha256 ?? "")
const named = Number(census.servedBuildR1?.namedTypes ?? grammar.namedTypes ?? 0)
const ids = Number(census.servedBuildR1?.totalIds ?? grammar.totalIds ?? 0)
if (served.length !== 64) fail("the census carries no full served sha256")
if (!(named > 0)) fail("the served inventory has 0 named types — a broken accessor prints 0 named")
const stems = census.servedBuildR1?.stemMatches as Record<string, string[]>
for (const stem of ["decorat", "render", "component", "jsx", "template", "markup", "part"]) {
  if (!Array.isArray(stems?.[stem])) fail(`the census carries no stemMatches.${stem}`)
}
const decorStemTotal = ["decorat", "annotation", "application", "modifier"].reduce((a, s) => a + (stems?.[s]?.length ?? 0), 0)
const renderStemTotal = ["render", "component", "jsx", "template", "markup"].reduce((a, s) => a + (stems?.[s]?.length ?? 0), 0)
if (decorStemTotal !== 0) fail(`the served inventory has ${decorStemTotal} decorator-stem node type(s) — the decorates ruling's R1 is refuted`)
if (renderStemTotal !== 0) fail(`the served inventory has ${renderStemTotal} render-stem node type(s) — the renders ruling's R1 is refuted`)
if (!(c.contentCapitalizedComponentShape === 0)) fail("content sites naming a component-shaped value exist — the renders falsifier fires")
if (!(c.importantNamingCallable === 0)) fail("an !important node names a callable — the decorates falsifier fires")

const implemented = [
  "calls", "uses", "contains", "imports", "references", "exports", "extends", "overrides",
  "mixes_in", "part_of",
]
const existingExcluded: any[] = Array.isArray(spec.coverage?.excluded) ? spec.coverage.excluded : []
const kept = existingExcluded.filter((e) => e?.label !== "decorates" && e?.label !== "renders")
for (const e of kept) if (implemented.includes(String(e?.label))) fail(`"${e?.label}" is both implemented and excluded`)

const decorates = {
  label: "decorates",
  evidence: "ontological",
  from:
    `RULED 2026-10-23 AFTER THE FULL LADDER, WITH THE R1 HALF MEASURED RATHER THAN ASSERTED. R1 (a published build whose inventory HAS the construct) is UNAVAILABLE, and the measurement is the served build's OWN node inventory, read through the live parser: validation/m14/measurements/scss-grammar-nodes.json, ${named} named node types of ${ids} ids, sha256 of the bytes the resolver's candidate list returns ${served} — the stems decorat/annotation/application/modifier match ${decorStemTotal} of those ${named}, so no published build of this grammar carries a decorator-application node (the one "attribute" match is attribute_selector/attribute_name, CSS attribute SELECTORS, not applied decorators). R2 (a patched grammar) is UNAVAILABLE BECAUSE IT WOULD INVENT SYNTAX: the vendored source (grammars/tree-sitter-scss/grammar.js, ${census.grammarSourceR2?.ruleCount ?? "?"} productions) has no decorator production, and this lane's 2 local patches add NO named node type at all (they widen existing list/parenthesised value rules and relax one delimiter); a patch would have to create a node type nothing in the language produces. R3 (an existing node type that carries the relation) is UNAVAILABLE: there is no TARGET node to carry it — the decorator edge needs a named callable APPLIED to a declaration, and the near miss is COUNTED in validation/m14/measurements/scss-extended-census.json over the whole admitted set of ${pop.admitted} files: ${c.importantSites} !important nodes of which ${c.importantNamingCallable} name any callable, ${c.declarationsWithGlobalFlag} !global and ${c.declarationsWithDefaultFlag} !default flag declarations — declaration MODIFIERS, each naming no callable. The mode of the ruling is ONTOLOGICAL, not grammar-absence: the flag syntax EXISTS and is parsed; what does not exist is a decorator. FALSIFIER, a construct an instrument in the tree COUNTS: an SCSS construct that APPLIES A NAMED CALLABLE TO A DECLARATION — the census's importantNamingCallable counter is that construct and it is ${c.importantNamingCallable}; a nonzero count would refute this ruling.`,
}
const renders = {
  label: "renders",
  evidence: "grammar-absence",
  from:
    `RULED 2026-10-23 AFTER THE FULL LADDER, WITH THE R1 HALF MEASURED RATHER THAN ASSUMED ("obvious" is what this fleet keeps being wrong about). R1 (a published build whose inventory HAS a render node) is UNAVAILABLE: the served build's OWN inventory (validation/m14/measurements/scss-grammar-nodes.json, ${named} named types of ${ids} ids, sha256 of the served bytes ${served}) has ${renderStemTotal} node types matching render/component/jsx/template/markup; the only "element" match is pseudo_element_selector, a SELECTOR and not a renderer. R2 (a patched grammar) is UNAVAILABLE BECAUSE IT WOULD INVENT SYNTAX: there is no rendering production in the vendored grammar (${census.grammarSourceR2?.ruleCount ?? "?"} productions) to fix, and a stylesheet has no component construct for one to produce. R3 (an existing node type that carries the relation) is UNAVAILABLE: no node names a COMPONENT, and the two constructs that could be mistaken for rendering are counted and are value generation — validation/m14/measurements/scss-extended-census.json over the whole admitted set of ${pop.admitted} files: ${c.contentDeclarations} "content:" declarations over ${filesBy.content} files and ${c.pseudoElementSelectors} pseudo_element_selector sites over ${filesBy.pseudoElement} files render a VALUE (a string, an image, a generated box), never a component declaration. THE MEASURED ZERO THAT IS THE FALSIFIER: a "content:" declaration whose value IS a COMPONENT NAME — an IDENTIFIER-shaped (capitalized) value, not a quoted string — the census's contentCapitalizedComponentShape counter is that construct and it is ${c.contentCapitalizedComponentShape}; a nonzero count would refute this ruling. The predicate is stated because the first cut stripped quotes and matched capitalized TEXT LABELS: MEASURED ${c.contentCapitalizedInStringValue} such quoted-string matches (hasura-engine: content 'Alpha'/'Beta'; nomad-ui: content 'Canary'), counted BESIDE in contentCapitalizedInStringValue and never as component names — a measure that cannot tell a label from a component name is not a measure, so the counter was split. MODE: the construct is absent from the language as a class of syntax, so the basis is GRAMMAR ABSENCE and not an ontology choice about a construct that exists.`,
}

const coverage = {
  ...(spec.coverage ?? {}),
  implemented,
  excluded: [...kept, decorates, renders],
  corpusUnexercised: Array.isArray(spec.coverage?.corpusUnexercised) ? spec.coverage.corpusUnexercised : [],
  _from:
    `MEASURED ON THE WHOLE ADMITTED SET, NOT SAMPLED. The population is validation/m14/measurements/scss-population.json: ${pop.admitted} admitted of ${pop.tracked} git-tracked .scss paths over ${pop.repositoriesCarrying} repositories (git ls-files per corpus checkout, 1 MiB cap, dedup realpath; the 2 over-cap paths are carried by name). The constructs are counted by validation/m14/measurements/scss-extended-census.json (whole population, ${census.guard.filesRead} files read, ${census.guard.filesFailed} failed, trees deleted). The implemented types' whole-population closure is validation/m14/instruments/scss/incoming-declaration.json (arm: BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts scss scss 0 --dump --index).`,
  _extends_vs_css:
    "SCSS and CSS do NOT disagree about `extends`: tree-sitter-scss is `grammar(require('tree-sitter-css/grammar'), {…})` with an `extend_statement` production ADDED, so `@extend` is real syntax here and the type fires (the arm's TABLE 1 counts it); the CSS lane declares it grammar-absence because the `.css` population cannot contain the construct at all.",
  _implemented_measured: {
    ...(spec.coverage?._implemented_measured ?? {}),
    mixes_in: {
      _why:
        "IMPLEMENTED 2026-10-23 AT R3 (an existing node type carries the relation, no grammar change): `include_statement` is a mixin COMPOSITION. The row previously carried `calls` only when the mixin resolved IN THE FILE (measured: 84 of 132 clean include sites on a 247-file screen named a mixin the file did not declare and produced NOTHING); it is now published for every clean include with the lane's published target spelling `@mixin <name>`, unresolved rather than absent. `@extend` is `extends`; the namespaced `@include ns.mixin` form is a counted wall (the served build splits the node at the dot) with R2 named as the available remedy. Counts: validation/m14/measurements/scss-extended-census.json (`includeSites`, `includeClean`, `includeUnparsable`) and the arm's TABLE 1 mixes_in row.",
    },
    part_of: {
      _why:
        "IMPLEMENTED 2026-10-23 AT R3 (no grammar change): the Sass FILE-INCLUSION form of `@import` shares the importing file's single scope — the vocabulary's part semantics — so its row MOVED from `imports` to `part_of` with the mandatory `metadata.partRole: \"library\"`. The discriminator is a tree fact (exactly one `string_value` named child); `url(...)`, media queries, `.css` specifiers, protocol URLs and `sass:` stay `imports`. A LABEL MOVE, NOT A NEW EDGE: source, target, line and the delegate's file claim are unchanged. Counts: validation/m14/measurements/scss-extended-census.json (`importSassForm`, `importSassFormVerified`, `importCssForm`) and the arm's TABLE 1 part_of row.",
    },
  },
  _population_note:
    "THE POPULATION IS THE GIT-TRACKED SET, NOT THE DISK. language-extensions.ts carries scss:\"scss\" only — `.sass` is the css lane's (the router gives it its own language and the engine reads it with the CSS analyzer), so this lane must not admit the 67 `.sass` files it does not own.",
  _corrected: "The previous `grammar` string and the lane's ruled-table page said 84 named types / sha256 729731fb83e4 and 116 repositories. MEASURED 2026-10-23: the served build is 90 named of 195 ids with sha256 67b77cd800be… (grammar-node-inventory), and the population is 4,433 admitted over 25 repositories (population artifact). Both are CORRECTED AGAINST A MEASUREMENT and recorded as corrections, not edited silently.",
}
spec.coverage = coverage
spec.grammar = `tree-sitter-scss@1.0.0 (vendored, 2 local patches that add NO named node type) — served bytes sha256 ${served}, ${ids} ids / ${named} named — measured by script/m14/grammar-node-inventory.ts → validation/m14/measurements/scss-grammar-nodes.json`

// the same arithmetic the coverage gate runs
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]
const impl = new Set<string>(implemented)
const ex = new Set<string>(coverage.excluded.map((e: any) => String(e.label)))
for (const t of impl) if (!TYPES.includes(t)) fail(`implemented "${t}" is not one of the fourteen`)
for (const t of ex) if (!TYPES.includes(t)) fail(`excluded "${t}" is not one of the fourteen`)
for (const t of impl) if (ex.has(t)) fail(`"${t}" is BOTH implemented and excluded`)
for (const e of coverage.excluded) {
  if (!String(e?.from ?? "").trim()) fail(`exclusion "${e?.label}" cites no source`)
  if (!/\d/.test(String(e.from))) fail(`exclusion "${e?.label}" cites no count`)
}
const applicable = TYPES.length - ex.size
if (impl.size !== applicable) fail(`implemented ${impl.size} does not equal applicable ${TYPES.length} - ${ex.size} excluded = ${applicable}`)

writeFileSync(SPEC, JSON.stringify(spec, null, 2) + "\n")
console.log("SCSS SPEC COVERAGE — written")
console.log(`  applicable ${applicable} = 14 - ${ex.size} excluded (${[...ex].join(", ")})`)
console.log(`  implemented ${impl.size}: ${implemented.join(", ")}`)
console.log(`  grammar: served sha256 ${served.slice(0, 16)}… · ${named} named of ${ids} ids`)
console.log(`  census counts cited: important ${c.importantSites}/${c.importantNamingCallable} naming · flags !global ${c.declarationsWithGlobalFlag} !default ${c.declarationsWithDefaultFlag} · content ${c.contentDeclarations} (${c.contentCapitalizedComponentShape} component-shaped) · pseudo-elements ${c.pseudoElementSelectors}`)
console.log(`  -> ${SPEC}`)
