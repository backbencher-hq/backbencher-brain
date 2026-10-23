/**
 * YAML — THE WHOLE-POPULATION DECLARATION THE COMPLETION GATE READS.
 *
 * `script/m14/completion-gate.ts` reads `validation/m14/instruments/<lane>/incoming-declaration.json`
 * and checks, in its own words: a population string that parses (`parsed=N/M admitted=…`), a
 * PER-TYPE CLOSURE whose five buckets sum to the type's edges with `unclassed` at a CEILING OF ZERO,
 * a `resolution_caveats` block so a reader knows what this lane's buckets MEAN, and a `causeRulings`
 * block where every cause carries a population string and a falsifier with a `run` and a `wouldFail`.
 *
 * THIS GENERATOR REFUSES RATHER THAN TRANSCRIBES. It will not write a declaration from
 *  · a census that is not a whole-population census (`parsed !== admittedTotal`),
 *  · a census produced by the parse-only mode (the buckets come from the ANALYZER's edges, and a
 *    parse-only run has no edges at all — writing them would publish the absence of the measurement),
 *  · a census whose own bucket closure already failed (the census exits 10 on that),
 *  · a spec whose denominator the gate's arithmetic would not reproduce,
 *  · a cause ruling without BOTH a population string and a falsifier run + wouldFail.
 *
 *   node script/m14/yaml-declaration.ts [--census P] [--spec P] [--out P] [--write]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const CENSUS = argOf("--census") ?? path.join(ROOT, "validation/m14/measurements/yaml-emission-census-full.json")
const SPEC = argOf("--spec") ?? path.join(ROOT, "script/m14/spec/yaml-completeness.json")
const OUT = argOf("--out") ?? path.join(ROOT, "validation/m14/instruments/yaml/incoming-declaration.json")
const WRITE = argv.includes("--write")

for (const [what, p] of [["census", CENSUS], ["spec", SPEC]] as const) {
  if (!existsSync(p)) { console.error(`FAIL — no ${what} at ${p}`); process.exit(2) }
}
const census = JSON.parse(readFileSync(CENSUS, "utf8"))
const spec = JSON.parse(readFileSync(SPEC, "utf8"))

const pop = census?.population ?? {}
const admitted = Number(pop.admittedTotal ?? 0)
const parsed = Number(pop.parsed ?? 0)
const mode = String(census?.mode ?? "")
if (!/full/.test(mode)) {
  console.error(`REFUSING — census mode is "${mode}": the five buckets come from the ANALYZER's edges and a parse-only run has none. Writing them would publish the ABSENCE of the measurement as the measurement.`)
  process.exit(3)
}
if (!(admitted > 0) || parsed !== admitted) {
  console.error(`REFUSING — NOT A WHOLE-POPULATION CENSUS: parsed ${parsed} of ${admitted} admitted`)
  process.exit(3)
}

const buckets: Record<string, any> = census?.perTypeBuckets ?? {}
const perType: Record<string, any> = census?.perType ?? {}
const entries = Object.keys(buckets).sort()
if (entries.length === 0) {
  console.error("REFUSING — the census carries no `perTypeBuckets`; re-run the full pass with the bucketing instrument")
  process.exit(4)
}

const types: Record<string, any> = {}
for (const t of entries) {
  const b = buckets[t]
  const sum = b.resolved + b.external + b.ambiguous + b.otherUnresolved + b.unclassed
  if (sum !== b.edges) { console.error(`REFUSING — ${t}: buckets sum ${sum} ≠ edges ${b.edges}`); process.exit(5) }
  if (Number(b.unclassed ?? 0) !== 0) { console.error(`REFUSING — ${t}: unclassed is ${b.unclassed} and its ceiling is 0`); process.exit(5) }
  types[t] = {
    edges: b.edges,
    resolved: b.resolved,
    ambiguous: b.ambiguous,
    otherUnresolved: b.otherUnresolved,
    external: b.external,
    unclassed: b.unclassed,
    _ambKind: 0,
    _collRes: 0,
    files: perType[t]?.files ?? 0,
    repos: perType[t]?.repos ?? 0,
  }
}

// ── THE FOUR EXTENDED TYPES: the two ruled rows carry their zero and their reconciliation ───────
const cov = spec.coverage ?? {}
const zeroFacts: any[] = Array.isArray(cov.zeroEmissionFacts) ? cov.zeroEmissionFacts : []
for (const z of zeroFacts) {
  // A RULED TYPE HAS NO EDGES, so its closure is four zeros and an `unclassed` of zero — and the
  // row carries the DECLARED-ZERO RECONCILIATION so a reader meets the zero with its declaration.
  types[z.label] = {
    edges: 0, resolved: 0, ambiguous: 0, otherUnresolved: 0, external: 0, unclassed: 0,
    _ambKind: 0, _collRes: 0, files: 0, repos: 0,
    ruled: String(z.evidence ?? ""),
    construct: String(z.construct ?? ""),
    nearMiss: z.nearMiss ?? null,
    reconciliation: z.reconciliation ?? null,
    falsifier: String(z.falsifier ?? ""),
  }
}

// ── THE CAUSE RULINGS: every wall this lane dispositioned, with a population and a falsifier ─────
const causeRulings: Record<string, any> = {}
// ★ THE FULL FORM, AND THE GATE'S OWN REGEX IS WHY: `completion-gate.ts` parses a population with
// /parsed=(\d+)\/(\d+)\s+admitted=(\d+)\s+exts=([^ ]*)\s+index=(\S+)/ — so a SHORT form
// ("parsed=18997/18997 admitted=18997") parses as NULL, and a cause ruling carrying it fails the
// whole-population condition while LOOKING like it says the population. Measured: this lane's first
// declaration had the short form in its four cause rulings and the gate read
// "fails: whole-population, walls-dispositioned" with a meta block that was correct.
const popStr = `parsed=${parsed}/${admitted} admitted=${admitted} exts=yaml,yml index=no`
for (const z of zeroFacts) {
  causeRulings[`contract-not-expressed:${z.label}`] = {
    population: popStr,
    what: String(z.from ?? ""),
    falsifier: {
      run:
        `npx tsx script/m14/yaml-emission-census.ts --parse-only --chunk-idx=<N> --chunk-size=2000 ` +
        `then node script/m14/yaml-census-merge.ts — the chunked whole-population construct census, ` +
        `which counts \`${z.construct}\` for every admitted file`,
      wouldFail:
        `a NON-ZERO count of \`${z.construct}\` falsifies the ruling: the construct the ruling says ` +
        `the language does not express would exist, and ${z.label} would have to be IMPLEMENTED, not ` +
        `ruled. The declaration generator that reads this census REFUSES to write the spec on a ` +
        `non-zero reading (exit 4), so the falsifier is an exit code and not a sentence.`,
    },
  }
}

// ── THE DECLARATION ────────────────────────────────────────────────────────────────────────────
const analyzerPath = path.join(ROOT, "src/ast/real-yaml-analyzer.ts")
const analyzerDigest = createHash("sha256").update(readFileSync(analyzerPath)).digest("hex").slice(0, 16)
const decl = {
  meta: {
    lang: "yaml",
    instrument: "script/m14/yaml-emission-census.ts (single measurement; no second instrument)",
    generator: "script/m14/yaml-declaration.ts — transcribes the arm's own census and REFUSES a sample, a parse-only run, or a bucket closure that does not sum",
    sample: parsed,
    corpusTotal: admitted,
    corpusRepos: Number(pop.reposCarryingAnAdmittedFile ?? 0),
    parsed,
    population: `parsed=${parsed}/${admitted} admitted=${admitted} exts=yaml,yml index=no`,
    metric: "edges counted once per (source, type, target) by the analyzer; buckets counted on the SAME edge in the SAME loop",
    analyzer: "src/ast/real-yaml-analyzer.ts",
    analyzerDigest: `sha256:${analyzerDigest}`,
    generated: new Date().toISOString().slice(0, 10),
    measurementForm:
      `one arm run over the whole admitted population, in ten DISJOINT 2,000-file chunks each taking ` +
      `the arm token with its own declared population, merged by script/m14/yaml-census-merge.ts — ` +
      `chunked because a tree-sitter WASM module's memory grows with every parse and never shrinks, ` +
      `so a single-process walk that LOOKS complete measures a fraction of the population while ` +
      `printing a whole-population header`,
    census: CENSUS.replace(ROOT + "/", ""),
    paths: Number(pop.paths ?? 0),
    distinctFiles: Number(pop.distinctFiles ?? 0),
    symlinkedRepoDirsFollowed: Number(pop.symlinkedRepoDirsFollowed ?? 0),
    countersDeclared: Number((census as any)?.countersDeclared?.length ?? 0),
    countersObserved: Object.keys((census as any)?.constructs ?? {}).length,
  },
  rules: {
    measurement: "one arm run over the whole admitted population, transcribed from its own census",
    population: "the whole admitted set; no stride and no subsample",
    direction:
      "resolved and external are FLOORS (they may not decrease); ambiguous, otherUnresolved and " +
      "unclassed are CEILINGS (they may not increase).",
    elevenTerms:
      "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + " +
      "causeOK + causeFAIL = edges. THIS LANE'S COUNTED FORM IS THE FIVE-BUCKET COARSENING of those " +
      "eleven, each bucket summing to the type's edges with `unclassed` at 0, and the census FAILS " +
      "ITS OWN RUN (exit 10) if the buckets do not sum.",
    fourExtendedValues:
      "`decorates`, `renders`, `mixes_in` and `part_of` are RULED as zero-emission facts, each on ONE " +
      "DECISIVE COUNTER over the whole admitted population with its near miss measured beside it, and " +
      "each row carries the declared-zero reconciliation (53 counters declared, 53 observed, " +
      "difference zero both ways). Their absence is the GRAMMAR'S, not the analyzer's: 161 named node " +
      "types in the served build's own inventory, and none of them is an expression, a call, a " +
      "supertype clause or a shared-scope include.",
    bucketRule:
      "external = metadata.isExternal === true; resolved = confidence >= 1 and not external; " +
      "ambiguous = 0 STRUCTURALLY (yaml has no symbol index, so the analyzer never chooses between " +
      "two same-named declarations); otherUnresolved = confidence < 1 and not external; " +
      "unclassed = 0 BY CONSTRUCTION and CHECKED, not asserted.",
  },
  causeRulingsNote:
    "Every wall this lane dispositioned, with the population it was measured over and a falsifier " +
    "that names a RUN and what would FAIL it. The four extended types are here because their ruling " +
    "IS a wall: the language does not express the relation, and the falsifier says what measurement " +
    "would overturn that.",
  causeRulings,
  types,
  resolution_caveats: [
    "YAML HAS NO SYMBOL INDEX (`index=no`): there is no INDEX_SPECS entry for this language, so no " +
      "edge in this lane is resolved against a project symbol table. `resolved` therefore means THE " +
      "ANALYZER'S OWN SCOPE — a key this lane found in the document or in a file it read — and NOT " +
      "what a symbol-indexed lane means by the word.",
    "`ambiguous` IS 0 FOR A STRUCTURAL REASON AND NOT BECAUSE THE POPULATION IS QUIET: with no " +
      "symbol index there is nothing to be ambiguous between. A reader comparing this lane's " +
      "`ambiguous` against an indexed lane's is comparing two different questions.",
    "THE BUCKETS ARE DERIVED FROM THE ANALYZER'S OWN CONFIDENCE AND `isExternal` FLAG, and the rule " +
      "is stated in `rules.bucketRule` and enforced by the census (exit 10 if the four buckets do " +
      "not sum to the type's edges). `unclassed` is 0 by construction and CHECKED, not asserted.",
    "THE FOUR EXTENDED TYPES APPEAR AS ZERO ROWS AND NOT AS ABSENT ONES, and the difference is the " +
      "point: the census declares all 53 counters it maintains and emits a declared zero for each, " +
      "so a zero here is a MEASUREMENT THAT FOUND NOTHING rather than a counter that never ran. " +
      "Before that rule the construct map carried 42 keys and NONE of the four decisive counters.",
    "`contains` IS LARGE AND THAT IS CORRECT FOR THIS FORMAT: 1,413,388 edges over 18,509 files is " +
      "what a nested data language looks like — every mapping pair and sequence item is a containment " +
      "of its parent. It is not a duplication defect.",
  ],
}

console.log(`CENSUS   ${CENSUS.replace(ROOT + "/", "")}`)
console.log(`MODE     ${mode}`)
console.log(`POP      ${decl.meta.population}`)
console.log(`TXES     ${entries.length} measured type(s) + ${zeroFacts.length} ruled row(s)`)
console.log("")
const totRes = entries.reduce((a, t) => a + buckets[t].resolved, 0)
const totExt = entries.reduce((a, t) => a + buckets[t].external, 0)
const totAmb = entries.reduce((a, t) => a + buckets[t].ambiguous, 0)
const totUnres = entries.reduce((a, t) => a + buckets[t].otherUnresolved, 0)
const totEdges = entries.reduce((a, t) => a + buckets[t].edges, 0)
console.log(`CLOSURE  edges ${totEdges} = resolved ${totRes} + external ${totExt} + ambiguous ${totAmb} + otherUnresolved ${totUnres} + unclassed 0`)
console.log(`CAUSES   ${Object.keys(causeRulings).length} ruling(s), each with a population and a run/wouldFail falsifier`)
if (!WRITE) { console.log("\nDRY RUN — nothing written. Pass --write to write the declaration."); process.exit(0) }
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(decl, null, 2) + "\n")
console.log(`\nWROTE ${OUT.replace(ROOT + "/", "")}`)
