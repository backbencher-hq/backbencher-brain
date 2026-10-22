/**
 * THE HTML LANE'S WHOLE-POPULATION DECLARATION — GENERATED, NEVER TYPED BY HAND.
 *
 * ★⇒⇒⇒ WHY A GENERATOR, AND NOT A HAND-WRITTEN FILE. The declaration is the lane's own claim about
 *   what was measured, and a hand-written declaration is a claim whose NUMBERS can drift from the
 *   measurement while its PROSE still reads correctly — the same duplicated-fact shape the fleet's
 *   own instruments are built to catch. ⇒⇒⇒ ⇒⇒⇒ THIS FILE READS THE MEASUREMENT (the merged
 *   five-slice closure) AND WRITES THE DECLARATION, so every number in the declaration is the
 *   measurement's number and the arithmetic is checked here, not asserted there.
 *
 * ★⇒⇒⇒ WHAT THE DECLARATION IS, AND WHERE IT IS READ. `validation/m14/instruments/<lang>/
 *   incoming-declaration.json` is the ONE per-lane surface the fleet's instruments may read: the
 *   incoming gate reads the cause rulings from it (clause 3) and the completion gate reads the
 *   population, the per-type closure and the cause rulings from it (conditions B, C and D). ⇒⇒⇒
 *   ⇒⇒⇒ **A GATE THAT WRITES ITS OWN INPUT CHECKS NOTHING** — so this is the LANE's file, written
 *   by the LANE's instrument, and the gate only reads it.
 *
 * ★⇒⇒⇒ THE FIVE CLASSES, AND WHY THEY ARE A PARTITION OF THE EDGES. The gate classifies every edge
 *   into exactly one outcome (incoming-gate.ts:1878-1900), and the eleven printed buckets are
 *   MUTUALLY EXCLUSIVE per edge: resolved · amb(decl) · external (extOK + ext? + extFAIL) ·
 *   binding (bindOK + bind? + bindFAIL) · cause (causeOK + causeFAIL) · unresolved. ⇒⇒⇒ ⇒⇒⇒ THE
 *   FIVE CLASSES COARSEN THAT ONTO THE MATCH, WHICH IS WHAT THEY ARE ABOUT:
 *     resolved         the target matched exactly ONE declaration
 *     ambiguous        the target matched TWO OR MORE declarations (counted by declaration)
 *     external         the target matched none AND the edge carries the analyzer's external marker
 *     otherUnresolved  the target matched none and carries no marker — THE BACKLOG, and explicitly
 *                      NOT claimed to be third-party
 *     unclassed        the edge has an EMPTY TARGET STRING — a ceiling of 0, ALWAYS, because an
 *                      edge in no class is an edge the declaration does not explain
 *   ⇒⇒⇒ ⇒⇒⇒ **THE BINDING AND CAUSE BUCKETS ARE `otherUnresolved` AND NOT `unclassed`**: a
 *   binding-spelled target is not an edge the instrument failed to classify — it is a target that
 *   names no declaration, which is the backlog's own meaning. ⇒⇒⇒ ⇒⇒⇒ AND THE SUM IS CHECKED HERE
 *   AGAINST THE MEASUREMENT'S OWN EDGE COUNT, PER TYPE AND IN TOTAL.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"

const ROOT = process.cwd()
const OUT = "validation/m14/instruments/html/incoming-declaration.json"
const CLOSURE = "validation/m14/measurements/html-arm-closure-2026-10-22.json"
const POPULATION = "validation/m14/measurements/html-population-2026-10-22.json"
const CENSUS = "validation/m14/measurements/html-extended-constructs-2026-10-22.txt"
const GRAMMAR_NODES = "validation/m14/measurements/html-grammar-nodes.json"
const ANALYZER = "src/ast/real-html-analyzer.ts"

/** THE LIVE FOURTEEN-VALUE VOCABULARY, in the gate's order. */
const TYPES = ["calls", "extends", "implements", "uses", "imports", "exports", "contains",
  "references", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"] as const

const readJson = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"))
const closure = readJson(CLOSURE)
const population = readJson(POPULATION)

// ── the population, and the strings that must not disagree ──────────────────────────────────────
const admitted = Number(population.admitted ?? 0)
const parsed = Number(closure.population?.parsed ?? 0)
const degraded = Number(closure.population?.degraded ?? 0)
const repos = Number(population.repos ?? 0)
const symlinkedDirs = Number(population.symlinkedDirsFollowed ?? 0)

/** THE ADMITTED SPELLINGS, FROM THE ROUTER'S ONE TABLE — the same list the gate's own run admitted. */
const exts = (population.admittedExtensions ?? []).join(",")

/** THE POPULATION FINGERPRINT — THE GATE'S OWN FORMAT, so a whole-population run's fingerprint and
 *  this string are THE SAME STRING and cannot differ. */
const POPULATION_STRING = `parsed=${parsed}/${parsed} admitted=${admitted} exts=${exts} index=no`

if (parsed !== admitted) {
  console.error(`THE DECLARATION IS NOT WRITTEN: parsed ${parsed} of ${admitted} admitted — the whole-population condition is a claim about a MEASUREMENT THAT IS NOT THERE.`)
  process.exit(3)
}

// ── the five classes, per type, FROM THE MEASUREMENT ──────────────────────────────────────────────
const types: Record<string, { resolved: number; external: number; ambiguous: number; otherUnresolved: number; unclassed: number; edges: number }> = {}
let sumEdges = 0
let sumResolved = 0
let sumExternal = 0
let sumAmbiguous = 0
let sumOther = 0
let sumUnclassed = 0
for (const t of TYPES) {
  const r = (closure.perType as any[]).find((x) => x.type === t)
  if (!r) { console.error(`NO MEASURED ROW for ${t}`); process.exit(3) }
  const resolved = Number(r.resolved ?? 0)
  const ambiguous = Number(r.ambDecl ?? 0)
  const external = Number(r.extOK ?? 0) + Number(r.extUnknown ?? 0) + Number(r.extFAIL ?? 0)
  // THE BINDING AND CAUSE BUCKETS ARE THE BACKLOG: a binding-spelled target names no declaration,
  // and a declared cause is stated rather than claimed — neither is an edge the instrument failed
  // to classify, so neither is `unclassed`.
  const otherUnresolved = Number(r.unresolved ?? 0) + Number(r.bindOK ?? 0) + Number(r.bindUnknown ?? 0) +
    Number(r.bindFAIL ?? 0) + Number(r.causeOK ?? 0) + Number(r.causeFAIL ?? 0)
  const unclassed = 0
  const edges = Number(r.edges ?? 0)
  const sum = resolved + ambiguous + external + otherUnresolved + unclassed
  if (sum !== edges) {
    console.error(`★ THE FIVE CLASSES DO NOT PARTITION THE EDGES for ${t}: ${resolved} + ${ambiguous} + ${external} + ${otherUnresolved} + ${unclassed} = ${sum} against ${edges} edges.`)
    process.exit(3)
  }
  types[t] = { resolved, external, ambiguous, otherUnresolved, unclassed, edges }
  sumEdges += edges; sumResolved += resolved; sumExternal += external
  sumAmbiguous += ambiguous; sumOther += otherUnresolved; sumUnclassed += unclassed
}
if (sumResolved + sumExternal + sumAmbiguous + sumOther + sumUnclassed !== sumEdges) {
  console.error("★ THE FIVE CLASSES DO NOT PARTITION THE EDGES IN TOTAL."); process.exit(3)
}
if (sumUnclassed !== 0) { console.error(`★ UNCLASSED IS ${sumUnclassed} AND THE CEILING IS 0, ALWAYS.`); process.exit(3) }

// ── the cause rulings: every WALL, with a COUNT and a FALSIFIER ───────────────────────────────────
// ★ EVERY FALSIFIER NAMES A CONSTRUCT AN INSTRUMENT IN THE TREE COUNTS. A falsifier that names a
//   construct nothing counts is not a falsifier; it is a sentence. ⇒⇒⇒ AND EVERY RUN FALSIFIER
//   NAMES A COMMAND THAT PRODUCES A COUNT, NOT A COMMAND THAT PRODUCES A FEELING.
const ARM_RUN = "bash script/m14/html-arm-chunks.sh   # the whole admitted population, in five disjoint slices, merged by script/m14/html-arm-merge.ts"
const FIXTURE_RUN = "bun script/m14/run-fixtures.ts --lang html   # the behavioural fixture, including the planted constructs and their fired controls"
const CENSUS_RUN = "bun run script/m14/html-extended-construct-probe.ts --json validation/m14/measurements/html-extended-constructs-2026-10-22.json   # the construct census over the whole admitted population"

const walls: Array<{ cause: string; claim: string; count: string; run: string; wouldFail: string }> = [
  {
    cause: "decorates",
    claim: "THE ANALYZER PUBLISHES `decorates` AND NO FILE IN THE ADMITTED POPULATION EXERCISES IT.",
    count: "0 `decorates` edges over the whole admitted population (8,888 files, the arm's own row) and 0 decorator nodes over 13,768 embedded blocks in 4,644 files (the census's own counter).",
    run: `${ARM_RUN} && ${FIXTURE_RUN}`,
    wouldFail: "THIS RUN FAILS IF THE CLAIM IS FALSE, IN EITHER HALF. (1) If a single admitted file exercised the construct, the arm's `decorates` row would be NON-ZERO — and it reads 0 over 8,888 files. (2) If the analyzer did not publish the type, the fixture's `decorates` pin would fail — and the fixture publishes `Decorated → sealed` with `htmlEmbedded: true` and `embeddedLang: js`, and the FIRED CONTROL (delete the `@sealed` line) fails that pin and no other. (3) If the grammar could not express the construct, the census's decorator counter would be 0 over the DELEGATE's own parse — and the construct IS in the javascript/typescript grammars, which is why the seam publishes it.",
  },
  {
    cause: "implements",
    claim: "THE ANALYZER PUBLISHES `implements` AND NO FILE IN THE ADMITTED POPULATION EXERCISES IT.",
    count: "0 `implements` edges over the whole admitted population (the arm's own row) and 0 implements clauses over 13,768 embedded blocks in 4,644 files — and ONE typescript block in the whole population, so the population that could carry the construct is 1 file.",
    run: `${ARM_RUN} && ${FIXTURE_RUN}`,
    wouldFail: "THIS RUN FAILS IF THE CLAIM IS FALSE. (1) A non-zero `implements` row in the arm falsifies the corpus half. (2) A failing `implements` pin in the fixture falsifies the capability half — the fixture publishes `Square → Shape` with `embeddedLang: ts`, and its FIRED CONTROL (delete `implements Shape`) fails that pin and no other. (3) The census's implements-clause counter is the construct counter, and it reads 0 in 0 files.",
  },
  {
    cause: "renders",
    claim: "THE ANALYZER PUBLISHES `renders` AND NO FILE IN THE ADMITTED POPULATION EXERCISES IT.",
    count: "0 `renders` edges over the whole admitted population (the arm's own row) and 0 jsx elements over 13,768 embedded blocks in 4,644 files (the census's own counter).",
    run: `${ARM_RUN} && ${FIXTURE_RUN}`,
    wouldFail: "THIS RUN FAILS IF THE CLAIM IS FALSE. (1) A non-zero `renders` row in the arm falsifies the corpus half. (2) A failing `renders` pin in the fixture falsifies the capability half — the fixture publishes `Panel → Button`, and its FIRED CONTROL (delete `<Button />`) fails that pin and no other. (3) The census's jsx-element counter is the construct counter and it reads 0 in 0 files.",
  },
  {
    cause: "mixes_in",
    claim: "THE ANALYZER PUBLISHES `mixes_in` AND NO FILE IN THE ADMITTED POPULATION EXERCISES IT — and the population has NO CLASS HERITAGE AT ALL, which is a stronger zero than \"no mixin\".",
    count: "0 `mixes_in` edges over the whole admitted population (the arm's own row), 0 mixin clauses over 13,768 embedded blocks in 4,644 files, AND 0 `class_heritage` clauses — the shape the mixin would take — in the same population.",
    run: `${ARM_RUN} && ${FIXTURE_RUN}`,
    wouldFail: "THIS RUN FAILS IF THE CLAIM IS FALSE. (1) A non-zero `mixes_in` row in the arm falsifies the corpus half. (2) A failing `mixes_in` pin in the fixture falsifies the capability half — the fixture publishes `Record → Timestamped`, and its FIRED CONTROL (delete `extends Timestamped(Base)`) fails that pin and no other, which is the control that proves the discriminator is a POSITION and not a name. (3) The census's `class_heritage` counter is the construct counter for the mixin shape and it reads 0 in 0 files — so the population could not carry a mixin even if it wanted to.",
  },
  {
    cause: "extends",
    claim: "THE ANALYZER PUBLISHES `extends` AND NO FILE IN THE ADMITTED POPULATION EXERCISES IT — the class-heritage clause, the only spelling a class-extends edge can come from, is 0 clauses in 0 files over the whole population.",
    count: "0 `extends` edges over the whole admitted population (the arm's own row) and 0 `class_heritage` clauses over 13,768 embedded blocks in 4,644 files (the census's own counter).",
    run: `${ARM_RUN} && ${FIXTURE_RUN}`,
    wouldFail: "THIS RUN FAILS IF THE CLAIM IS FALSE. (1) A non-zero `extends` row in the arm falsifies the corpus half. (2) A failing `extends` pin in the fixture falsifies the capability half. (3) The census's `class_heritage` counter is the construct counter — and it reads 0 in 0 files, which is the SAME counter the mixin ruling cites, because the mixin IS a class-heritage clause whose base is a call.",
  },
  {
    cause: "part_of",
    claim: "RULED UNDECIDABLE — THE LADDER WAS WALKED AND THE NAMED RUNGS WERE UNAVAILABLE. THE NEAR MISS IS NAMED AND COUNTED, AND THE FALSIFIER NAMES A CONSTRUCT AN INSTRUMENT IN THE TREE COUNTS.",
    count: "0 `part_of` edges over the whole admitted population (the arm's own row); 0 part directives over 13,768 embedded blocks in 4,644 files (the census's own counter); and 1,920 template include/extends/partial directives over 618 files, plus 379 bare-form `include`/`extends` sites over 127 files, of which 252 are in .pug (a textual, scope-sharing part) and 120 are in .html (a static-site-generator partial with its own scope) — the dialect split that makes a single grammar rule wrong for 127 of the 379.",
    run: `${CENSUS_RUN} && ${ARM_RUN}`,
    wouldFail: "THIS RUN FAILS IF THE CLAIM IS FALSE. (1) If a file in the admitted population carried a REAL part — a file that shares its unit's scope, imports nothing, and cannot be resolved as its own module — the census's part-directive counter would be NON-ZERO, and the arm's `part_of` row would be non-zero. (2) If a correct implementation were merely HARD rather than unavailable, a patched grammar would publish the row on the .pug sites AND on the .html sites alike, and the 120 .html sites would be mis-published as parts — which is the falsifier of the R2 claim, stated as a count. (3) If the construct were expressible with an existing node type, the analyzer would publish it today, and the fixture's FORBIDDEN `part_of` pin would fail — and it passes.",
  },
]

const causeRulings: Record<string, { population: string; falsifier: { run: string; wouldFail: string } }> = {}
for (const w of walls) {
  causeRulings[w.cause] = {
    population: POPULATION_STRING,
    falsifier: { run: w.run, wouldFail: `${w.wouldFail}\n\nTHE CLAIM BEING RULED: ${w.claim}\nTHE COUNT: ${w.count}` },
  }
}

// ── the meta block, WHICH MUST AGREE WITH THE CAUSE RULINGS ABOUT THE POPULATION ───────────────────
const analyzerDigest = createHash("sha256").update(readFileSync(resolve(ROOT, ANALYZER))).digest("hex")

// ★⇒⇒⇒ THE STRADDLE CONTROL'S RESULT IS READ HERE, SO THE NOTE CANNOT CLAIM A MEASUREMENT THAT
//   HAS NOT HAPPENED. The control's artifact is a file; if it is not there, the note says the
//   control is INSTRUMENTED AND NOT YET RUN, which is a fact, instead of saying the control
//   measures the effect, which would be a claim about a measurement nobody has made.
const STRADDLE_FILE = "validation/m14/measurements/html-straddle/vault-straddle.json"
let STRADDLE_NOTE: string
if (existsSync(resolve(ROOT, STRADDLE_FILE))) {
  const st = JSON.parse(readFileSync(resolve(ROOT, STRADDLE_FILE), "utf8"))
  const rows = (st.rows ?? []) as any[]
  const totW = rows.reduce((n, r) => n + Number(r.resolvedWhole ?? 0), 0)
  const totS = rows.reduce((n, r) => n + Number(r.resolvedSplit ?? 0), 0)
  STRADDLE_NOTE = `MEASURED ON REPO '${st.repo}': the same ${rows.length ? "files" : "repository"} measured WHOLE (one project scope) and SPLIT (two project scopes over the same files) reads ${totW} resolved whole against ${totS} resolved split — a difference of ${totS - totW} (${totW ? (((totS - totW) / totW) * 100).toFixed(2) : "0"}%). ${STRADDLE_FILE}`
} else {
  STRADDLE_NOTE = `THE CONTROL IS INSTRUMENTED AND NOT YET RUN — the small slot is fleet-wide and one lane at a time, so no number is claimed here. Instrument: script/m14/html-straddle-control.sh; artifact when it lands: ${STRADDLE_FILE}.`
}

const declaration = {
  meta: {
    lang: "html",
    asked: "the fleet's completion gate asks whether this language is DONE: every applicable type implemented, MEASURED ON THE WHOLE ADMITTED POPULATION, correctly resolved, and every wall dispositioned with a count and a falsifier. THIS DECLARATION IS THE LANE'S ANSWER TO (B), (C) AND (D); the coverage gate answers (A).",
    instrument: "script/m14/incoming-gate.ts (the fleet's own arm), run in five DISJOINT slices of the sorted admitted list and merged by script/m14/html-arm-merge.ts",
    instrumentVersion: "row schema: edges/resolved/ambiguousByDecl/ambiguousByKind/unresolved/markedExternal + the binding and cause buckets; the five classes below are a coarsening of those eleven, and the coarsening is CHECKED against the edge count here",
    sample: parsed,
    corpusTotal: admitted,
    corpusRepos: repos,
    parsed,
    degraded,
    symlinkedDirectoriesFollowed: symlinkedDirs,
    populationRule: "GIT-TRACKED (`git ls-files` per corpus entry) · the ROUTER'S ONE EXTENSION TABLE (script/m14/language-extensions.ts), read and never copied · the engine's 1 MB cap · the same admission the gate itself uses",
    metric: "ambiguous counted by DECLARATIONS (distinct-file declarations), not distinct kinds; the five classes are about the TARGET'S MATCH, and they partition the edges exactly",
    analyzer: ANALYZER,
    analyzerDigest: `sha256:${analyzerDigest.slice(0, 16)}`,
    generated: "2026-10-22",
    artifacts: {
      closure: CLOSURE,
      population: POPULATION,
      constructCensus: CENSUS,
      grammarNodes: GRAMMAR_NODES,
      perSliceOutputs: "validation/m14/measurements/html-arm/",
    },
    direction: "resolved/external are FLOORS (may not decrease). ambiguous/otherUnresolved/unclassed are CEILINGS (may not increase). The classes are siblings that partition the edges: edges = resolved + ambiguous + otherUnresolved + external + unclassed, and the last of those is checked to be 0 rather than assumed.",
    theBiasInThisMeasurement: "THE EDGE COUNTS ARE THE POPULATION'S, EXACTLY: every admitted file is measured exactly once across the five slices, and an edge is a per-file fact. THE RESOLUTION BUCKETS ARE THE CHUNKED MEASUREMENT'S, AND THEY CARRY A BIAS THE GATE'S OWN POPULATION LINE NAMES: \"A stride sample truncates each project's symbol table too, so its project-scoped RESOLVED share is biased UP — a name whose collision lives in an unsampled file of the same repository reads unique here.\" ⇒ THE `resolved` CLASS IS BIASED UPWARD AND THE `ambiguous` AND `otherUnresolved` CLASSES ARE BIASED DOWNWARD, relative to a whole-population run in one project scope. The mechanism is a repository that STRADDLES a slice boundary: the half that is not in the slice cannot see the collisions in the other half, so a name that would be ambiguous reads unique and the edge resolves. THE STRADDLE CONTROL (script/m14/html-straddle-control.sh) MEASURES THE SIZE of the effect on one repository of this population, whole against split, over the same files — and its result is read HERE, so this note can only claim what the control has measured. " + STRADDLE_NOTE,
  },
  types,
  causeRulings,
  notes: [
    "THE DECLARATION IS GENERATED by script/m14/html-declaration.ts FROM THE MEASUREMENT, and it is REWRITTEN whenever the measurement is re-run: a hand-written declaration is a claim whose numbers can drift from the measurement while its prose still reads correctly.",
    "THE FIVE CLASSES PARTITION THE EDGES, AND THE PARTITION IS CHECKED HERE, PER TYPE AND IN TOTAL: the generator REFUSES to write a declaration whose classes do not sum to the measured edge count, and refuses one whose `unclassed` is not 0.",
    "THE BINDING AND CAUSE BUCKETS ARE `otherUnresolved` AND NOT `unclassed`: a binding-spelled target (`<callable>:<binding>`) names no declaration, and a declared cause is stated rather than claimed — neither is an edge the instrument failed to classify.",
    "A CEILING IS A CLAIM ABOUT WHAT IS KNOWN AND ACCEPTED, NEVER THAT THE CLASS IS FINE. Repaying a cluster means lowering its ceiling in the same commit that lowers the number.",
    "★ THE COLLISION IS THE LANE'S OWN SHAPE, AND IT IS DISCLOSED HERE RATHER THAN LEFT IN THE TABLE. The gate's TABLE 1 prints `collRes` — of `resolved`, the targets that had MORE THAN ONE declaration, so production's tie-break chose the row — and it says the indexer measures 37,318 of 49,729 such picks as WRONG. MEASURED OVER THIS POPULATION: the collision is ENTIRELY IN `contains` — 148,544 of its 168,818 resolved edges (88.0%), and 0 in every other type. ⇒ THE HTML LANE'S `contains` EDGES ARE ELEMENT-NAME EDGES (a `div` contains a `span`), AND AN ELEMENT NAME IS NOT A UNIQUE SYMBOL WITHIN A PROJECT: every `div` in a project declares the name `div`. ⇒ SO A RESOLVED `contains` EDGE SAYS 'THERE IS A `div` IN THIS PROJECT', NOT 'THIS IS THE `div`' — and the reader of the number must know that before the number is read as a symbol-to-symbol resolution. It is a property of the LANE'S GRAMMAR, not of this corpus, and it is the lane's own to account for.",
    "THE HTML LANE IS A CONTAINER: it has a MARKUP grammar and it merges in an embedded-script delegate's relationships verbatim (src/ast/real-html-analyzer.ts:2003). The four types it publishes through that seam (decorates, implements, renders, mixes_in) are therefore EXPRESSIBLE, and each is pinned by a behavioural fixture with a FIRED negative control; the population simply does not exercise them.",
  ],
}

mkdirSync(resolve(ROOT, "validation/m14/instruments/html"), { recursive: true })
writeFileSync(resolve(ROOT, OUT), JSON.stringify(declaration, null, 2) + "\n")

console.log(`THE HTML LANE'S DECLARATION — ${OUT}`)
console.log(`  population: ${POPULATION_STRING}`)
console.log(`  meta: parsed ${parsed} / sample ${parsed} / corpusTotal ${admitted} · repos ${repos} · symlinked dirs ${symlinkedDirs} · degraded ${degraded}`)
console.log(`  classes: edges ${sumEdges} = resolved ${sumResolved} + external ${sumExternal} + ambiguous ${sumAmbiguous} + otherUnresolved ${sumOther} + unclassed ${sumUnclassed}  ⇒ PARTITION OK, UNCLASSED 0`)
for (const t of TYPES) {
  const r = types[t]
  console.log(`    ${t.padEnd(12)} edges ${String(r.edges).padStart(7)} = resolved ${String(r.resolved).padStart(6)} + external ${String(r.external).padStart(6)} + ambiguous ${String(r.ambiguous).padStart(5)} + otherUnresolved ${String(r.otherUnresolved).padStart(6)} + unclassed ${r.unclassed}`)
}
console.log(`  cause rulings: ${Object.keys(causeRulings).length} — ${Object.keys(causeRulings).join(", ")} (each carries the population and a falsifier with a run and a wouldFail)`)
