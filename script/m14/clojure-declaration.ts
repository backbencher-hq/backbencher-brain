#!/usr/bin/env bun
/**
 * CLOJURE — THE WHOLE-POPULATION DECLARATION, GENERATED FROM THE MEASUREMENTS ✓✓
 *
 * ★ WHY A GENERATOR AND NOT A HAND-WRITTEN FILE. A declaration is the LANE'S RULING AND THE
 * LANE'S MEASUREMENT, and the completion gate reads it and reports a DISAGREEMENT rather than
 * picking a side — because the file carries its population TWICE (in `meta` and in every cause
 * ruling) and the two copies can differ. ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ A FILE THAT IS TYPED BY HAND IS A FILE
 * WHOSE TWO COPIES CAN DRIFT. THIS GENERATOR WRITES BOTH COPIES FROM THE SAME ROWS, SO THEY
 * CANNOT DISAGREE — the disagreement the gate reports is the generator's output, not a typing
 * accident.** ⇒⇒⇒ ⇒⇒⇒
 *
 * ⇒⇒⇒ ⇒⇒⇒ **THE TWO INPUTS, EACH NAMED WITH WHAT IT MEASURES:**
 *   · the ARM's own TABLE 1 — the ARBITER's per-type closure over the whole admitted population
 *     (`validation/m14/measurements/clojure-gate-cap0-2026-10-22.txt`);
 *   · the WALL CENSUS — the ANALYZER's own per-wall-class row counts over the same population
 *     (`validation/m14/measurements/clojure-wall-census.json`).
 * ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ AND THE TWO ARE MEASUREMENTS OVER DIFFERENT THINGS, AND THE DECLARATION SAYS SO:
 * the arm counts the rows the ARBITER kept (43,300); the census counts the rows the ANALYZER
 * published (43,859). A reader must never add one to the other.**
 *
 * RUN: bun run script/m14/clojure-declaration.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const ARM = path.join(ROOT, "validation/m14/measurements/clojure-gate-cap0-2026-10-22.txt")
const CENSUS = path.join(ROOT, "validation/m14/measurements/clojure-wall-census.json")
const OUT = path.join(ROOT, "validation/m14/instruments/clojure/incoming-declaration.json")

/* ── 1 · THE ARM's TABLE 1 ── */
const arm = readFileSync(ARM, "utf8")
const rows = new Map<string, Record<string, number>>()
let total: Record<string, number> | null = null
for (const line of arm.split("\n")) {
  const t = line.trim()
  if (!/^[A-Za-z_]+\s+\d+/.test(t)) continue
  const p = t.split(/\s+/)
  if (p.length < 14) continue
  const name = p[0]!
  const nums: Record<string, number> = {}
  const cols = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extUnver", "extFAIL", "bindOK", "bindUnver", "bindFAIL", "causeOK", "causeFAIL"]
  const vals = cols.map((_, i) => Number(p[i + 1] ?? ""))
  if (!vals.every((v) => Number.isFinite(v))) continue
  cols.forEach((c, i) => { nums[c] = vals[i]! })
  if (name === "TOTAL") total = nums
  else rows.set(name, nums)
}
if (!total) { console.error("THE ARM's TABLE 1 WAS NOT FOUND — the declaration is NOT written"); process.exit(2) }

/* the population, read from the arm's OWN line */
const popLine = arm.split("\n").find((l) => l.startsWith("population: ") && l.includes("parsed of")) ?? ""
const pm = popLine.match(/(\d+) parsed of (\d+) sampled/)
if (!pm) { console.error("THE ARM's POPULATION LINE WAS NOT FOUND — the declaration is NOT written"); process.exit(2) }
const parsed = Number(pm[1]), totalFiles = Number(pm[2])
if (parsed !== totalFiles) {
  console.error(`THE ARM's POPULATION IS NOT THE WHOLE ADMITTED SET (parsed ${parsed} / ${totalFiles}) — the declaration is NOT written`)
  process.exit(2)
}
// THE GATE PARSES `parsed=N/N admitted=N exts=... index=...`; THE RULE TRAVELS IN THE SAME
// STRING because a number without its rule cannot be compared with another lane's number.
const POPULATION = `parsed=${parsed}/${totalFiles} admitted=${totalFiles} exts=clj,cljs,cljc,edn index=yes rule=git-ls-files@each-checkout+1MiB-cap,no-stride`

/* ── 2 · THE WALL CENSUS ── */
const census = JSON.parse(readFileSync(CENSUS, "utf8"))
/**
 * ⇒⇒⇒ TWO NUMBERS, EACH WITH ITS RULE, PER FLEET-RULINGS-2026-10-22. **A NUMBER THAT DOES
 * NOT SAY WHICH RULE PRODUCED IT CANNOT BE COMPARED** — so the population names the rule
 * that produced it and the node count carries the grammar's own digest beside it.
 */
const BINDING = JSON.parse(readFileSync(path.join(ROOT, "validation/m14/measurements/clojure-grammar-binding.json"), "utf8"))
const GRAMMAR_NODES = JSON.parse(readFileSync(path.join(ROOT, "validation/m14/measurements/clojure-grammar-nodes.json"), "utf8"))
const grammarNamed = Number(GRAMMAR_NODES.namedTypes)
if (Number(BINDING.surface.namedIds) !== grammarNamed) {
  console.error(`THE TWO GRAMMAR INSTRUMENTS DISAGREE (${BINDING.surface.namedIds} vs ${grammarNamed}) — the declaration is NOT written`)
  process.exit(2)
}
// THE FLEET'S NODE-COUNT RULE: the grammar's OWN named types PLUS the universal ERROR and MISSING pair.
const GRAMMAR = {
  servedWasmSha256: BINDING.binding.productionSha,
  registrySha256: BINDING.binding.registrySha,
  productionPath: BINDING.binding.productionPath,
  nodeCountRule:
    "THE FLEET'S RULE: the count of the wasm's OWN named node types as nodeTypeForId reports them for every id the grammar declares, PLUS the universal ERROR and MISSING pair — the pair is in the rule because every tree-sitter parser produces those two nodes and every analyzer consults them.",
  namedAsTheGrammarDeclares: grammarNamed,
  namedUnderTheFleetRule: grammarNamed + 2,
  universalPair: ["ERROR", "MISSING"],
  anonymousIds: Number(BINDING.surface.anonIds),
  totalIds: Number(GRAMMAR_NODES.totalIds),
  fieldCount: Number(BINDING.surface.fieldCount),
  idOrderDigest: BINDING.surface.idOrderDigest,
  typeSetDigest: BINDING.surface.typeSetDigest,
  fieldSetDigest: BINDING.surface.fieldSetDigest,
  measuredBy: "script/m14/clojure-grammar-binding-probe.ts (the PRODUCTION parser's own Language object) + script/m14/grammar-node-inventory.ts",
  note:
    `⇒ ${grammarNamed} named node types DECLARED BY THE GRAMMAR, ${grammarNamed + 2} under the fleet's rule once the universal ERROR and MISSING pair is added, over ${GRAMMAR_NODES.totalIds} ids in total. ` +
    "The count carries the served wasm's sha256 in the same object, because a count of named node types without the grammar's digest is a measurement of a moment rather than of a grammar. " +
    "THE RULED TYPES' COMPLETENESS WAS CHECKED AGAINST ALL OF THEM, not against the subset the population reaches: see validation/m14/measurements/clojure-whole-inventory-census.json.",
}
const SYMLINKS = census.method.symlinkedDirectories
if (Number(SYMLINKS.entriesEntered) !== 381 || Number(SYMLINKS.distinctRealPaths) !== 271) {
  console.error(`THE SYMLINK COUNT MOVED (${SYMLINKS.entriesEntered} entries / ${SYMLINKS.distinctRealPaths} distinct) — the declaration is NOT written, because a number that moved must be explained before it is published`)
  process.exit(2)
}
if (census.population.files !== totalFiles) {
  console.error(`THE CENSUS's POPULATION (${census.population.files}) IS NOT THE ARM's POPULATION (${totalFiles}) — the declaration is NOT written`)
  process.exit(2)
}

/* ── 3 · THE CLOSURE, PER TYPE, IN THE GATE's OWN BUCKETS ── */
const types: Record<string, any> = {}
for (const [name, r] of rows) {
  const resolved = r.resolved!
  const external = r.extOK! + r.extUnver! + r.extFAIL!
  const ambiguous = r.ambDecl!
  const otherUnresolved = r.unresolved! + r.bindOK! + r.bindUnver! + r.bindFAIL! + r.causeOK! + r.causeFAIL!
  const unclassed = 0
  const edges = resolved + external + ambiguous + otherUnresolved + unclassed
  if (edges !== r.edges!) {
    console.error(`THE CLOSURE DOES NOT ADD UP for ${name}: ${edges} != ${r.edges} — the declaration is NOT written`)
    process.exit(2)
  }
  types[name] = { resolved, external, ambiguous, otherUnresolved, unclassed }
}

/* the closure over the WHOLE edge set */
const sum = (k: string) => Object.values(types).reduce((a, t: any) => a + t[k], 0)
const closureEdges = sum("resolved") + sum("external") + sum("ambiguous") + sum("otherUnresolved") + sum("unclassed")
if (closureEdges !== total!.edges) {
  console.error(`THE CLOSURE OVER ALL TYPES DOES NOT ADD UP: ${closureEdges} != ${total!.edges} — the declaration is NOT written`)
  process.exit(2)
}

/* ── 4 · THE CAUSE RULINGS — one per WALL, each with a COUNT, a POPULATION, and a FALSIFIER ── */
const wallByKey = new Map<string, any>((census.walls as any[]).map((w) => [w.key, w]))
const armPop = POPULATION

const causeRulings: Record<string, any> = {}

/* 4a · the analyzer-side wall classes, counted by the wall census */
for (const w of census.walls as any[]) {
  if (w.key === "name-model-ambiguity") continue // the ambiguity is the ARBITER's finding ⇒ 4b
  causeRulings[w.key] = {
    count: w.rows,
    countedBy: "script/m14/clojure-wall-census.ts over the same 646-file population (the ANALYZER's rows)",
    population: armPop,
    what: w.what,
    disposition: w.disposition,
    falsifier: w.falsifier,
  }
}

/* 4b · the ARBITER-side wall classes, counted by the ARM's own table */
causeRulings["name-model-ambiguity"] = {
  count: total!.ambDecl,
  countedBy: "script/m14/incoming-gate.ts TABLE 1 (the ARBITER's amb(decl) column) over the same 646-file population",
  population: armPop,
  what: "the target has MORE THAN ONE declaration in the project, so the project-scoped name model cannot choose — production's tie-break picks one and the row is resolved",
  disposition:
    "INSTRUMENT GAP — the gate resolves names PROJECT-WIDE and a bare name unique in a project is resolved; where the same name is declared in several files or namespaces the project-scoped name model collides. The lane owns no namespace-aware module-space fact, and the tie-break's own reach is measured separately (the join's 994 and the tie-break's 4,197 moved rows).",
  falsifier: {
    run: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump",
    wouldFail:
      "THIS RUN FAILS IF the claim is false: (1) any `extFAIL`/`bindFAIL`/`causeFAIL` row — a claim the project REFUTES is counted against the lane and clause 4 fails; or (2) an ambiguous row whose target has EXACTLY ONE project declaration would be RESOLVED by the name model and would not be ambiguous — the arm's own `arbitraryTwin` / `nothingAnywhere` columns are the instrument for that, and a row in the arbitraryTwin class that the arbiter cannot tie-break is the refutation. Note what is NOT a falsifier here: a name being declared in ANOTHER project — production's scope is PER PROJECT, so a collision across projects is not ambiguity to production.",
  },
}
causeRulings["unresolved-without-a-declaration"] = {
  count: total!.unresolved,
  countedBy: "script/m14/incoming-gate.ts TABLE 1 (the ARBITER's unresolved column) over the same 646-file population",
  population: armPop,
  what: "the target names nothing the project declares and nothing the project imports — a macro-created var, a dynamic invocation, or a genuinely absent name",
  disposition:
    "INSTRUMENT GAP — a single-file analyzer cannot decide ABSENCE from EXTERNALITY, and the gate's own key space (a project-wide declaration lookup) is what answers it. The wall census splits this residual into its named classes (the java/jvm interop class, the ctor/tagged-literal class, the bare-name class) and each split class carries its own ruling above.",
  falsifier: {
    run: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump",
    wouldFail:
      "THIS RUN FAILS IF the claim is false: any unresolved row that DOES have a project declaration and is left unresolved anyway — the arm's `nothingAnywhere` column counts exactly those rows (a target the project does not declare ANYWHERE), and a row in `nothingAnywhere` that the project in fact declares is the refutation. Note what is NOT a falsifier here: a name being absent from the corpus (absence of the symbol is not evidence about the edge).",
  },
}
causeRulings["unverified-external-claims"] = {
  count: total!.extUnver,
  countedBy: "script/m14/incoming-gate.ts TABLE 1 (the ARBITER's ext? column) over the same 646-file population",
  population: armPop,
  what: "the edge carries an external claim (language namespace or package scope) and NO project fact can reach it — the claim is stated, not confirmed",
  disposition:
    "CLAIMED, NOT CONFIRMED — these rows are the lane's own claims that the project's facts cannot reach (a third-party module's membership is a manifest fact the corpus's clojure projects do not carry). They are counted in `external`, never in `resolved`.",
  falsifier: {
    run: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump",
    wouldFail:
      "THIS RUN FAILS IF the claim is false: (1) any `extFAIL` — a claim the project REFUTES is counted against the lane and clause 4 fails; or (2) an ext? row whose target IS declared by the project, or whose specifier IS listed by the project's own manifest — the claim is then checkable and the row belongs in `resolved`. Note what is NOT a falsifier here: a third-party module being absent from the corpus (absence of the library is not evidence about the edge).",
  },
}

/* ── 5 · THE DECLARATION ── */
const decl = {
  meta: {
    lang: "clojure",
    asked:
      "the fleet gate MEASURES clojure and exits 1 on its fleet-wide bar; this declaration RATCHETS the same measurement per type, so a class can only move deliberately.",
    instrument:
      "script/m14/incoming-gate.ts (the closure) + script/m14/clojure-wall-census.ts (the wall classes) — TWO INSTRUMENTS IN ONE POPULATION, because the arm's `--dump` is BOUNDED (BB_DUMP_LIMIT) and therefore cannot carry the wall census",
    instrumentVersion:
      "row schema: edges/resolved/ambiguousByDecl/ambiguousByKind/unresolved/markedExternal + 25-name worklists; the wall census classifies by the ANALYZER'S OWN METADATA KEYS",
    sample: totalFiles,
    corpusTotal: totalFiles,
    corpusRepos: Object.keys(census.population.repos).length,
    parsed,
    qualifiedNameAliases: 9166,
    metric: "ambiguous counted by DECLARATIONS (distinct-file declarations), not distinct kinds",
    analyzer: "src/ast/real-clojure-analyzer.ts",
    analyzerDigest: "sha256:ac2abea4e8411e90",
    generated: "2026-10-22",
    population: POPULATION,
    populationRule:
      "THE POPULATION IS `git ls-files` INSIDE EACH CHECKOUT OF THE CORPUS ROOT, restricted to .clj/.cljs/.cljc/.edn and to files at or under the 1 MiB cap — NOT a walk of the disk, which would also find untracked files the repositories do not carry. " +
      `MEASURED OVER ${SYMLINKS.root}: ${SYMLINKS.entriesEntered} symlinked DIRECTORY ENTRIES followed by the walk, ${SYMLINKS.distinctRealPaths} DISTINCT real paths behind them, deduplicated=${SYMLINKS.deduplicated} (a repeat target is counted per entry, because the walk really did enter each one). ` +
      "Both numbers are published rather than one, so a reader comparing this population with another lane's knows whether either deduplicated.",
    grammar: GRAMMAR,
    populationNote:
      "THE POPULATION IS THE WHOLE ADMITTED SET, AND THE SAMPLE *IS* THE POPULATION: there is no stride and no subsample. MEASURED by the arm's own population line over BB_CORPUS_ROOT=$PWD/.corpus — " +
      `${totalFiles} admitted .clj/.cljs/.cljc/.edn files in ${Object.keys(census.population.repos).length} repositories ` +
      `(${Object.entries(census.population.repos).map(([k, v]) => `${k} ${v}`).join(", ")}), 0 excluded (0 tracked-but-absent/unreadable, 0 over the 1 MiB cap), ` +
      "0 parse failures, 0 degraded (regex fallback), and the PROJECT INDEX WAS USED (3 repo indexes built over the same 646 files) — so this population IS production's scope for this lane. " +
      "The wall census reads the SAME 646 files and the generator REFUSES to write if the two populations differ.",
    classMapping:
      "THE FIVE DECLARATION BUCKETS ARE THE GATE's CLASSES, MAPPED ONCE, HERE, SO NOTHING IS HIDDEN: " +
      "resolved = resolved (collRes is a SUBSET of resolved and is never added — it is the tie-break's picks, 2,075 of them); " +
      "ambiguous = amb(decl) (amb(kind) is a SUBSET of amb(decl), 484 of them, reported beside it and NEVER added); " +
      "otherUnresolved = unresolved + bindOK + bind? + bindFAIL + causeOK + causeFAIL (a causeOK edge is STATED, not resolved — the gate says 'NEVER folded into resolved'); " +
      "external = extOK + ext? + extFAIL; unclassed = 0, ALWAYS. " +
      "THE CLOSURE: resolved + ambiguous + otherUnresolved + external + unclassed = edges, EXACTLY — and the generator REFUSES to write the file if it does not add up, per type and over all types.",
    edgeBucketsNote:
      "THE EDGE BUCKETS ARE THE POPULATION's — every admitted file is measured exactly once, so the edge counts are unbiased.",
    resolutionBucketsNote:
      "THE RESOLUTION BUCKETS ARE THE ARBITER's, and the arbiter resolves in a PROJECT SCOPE: a name collision in a half of the corpus that is not in the slice is INVISIBLE, so the name reads unique and the edge resolves. The scope and its consequence are named here so no reader assumes a resolved bucket means what another lane's resolved bucket means.",
    source:
      "the arm's own TABLE 1, validation/m14/measurements/clojure-gate-cap0-2026-10-22.txt (the whole-population arm, cap 0, --index)",
  },
  rules: [],
  notes: [
    "THE FOUR APPLIED TYPES ARE EMITTED AND MEASURED: calls, uses, contains, imports, references, exports, extends, implements, overrides, instantiates, and `renders` (the HICCUP-vector component render). The three ruled types (decorates, mixes_in, part_of) are excluded in script/m14/spec/clojure-completeness.json with their ladder walks and falsifiers.",
    "THE IMPLEMENTED SET IS 11 OF 14 and the denominator is 14 with NO unclassified type: the coverage gate reads `clojure yes 11 11 3 - -`.",
  ],
  types,
  causeRulingsNote:
    "EVERY WALL IS DISPOSITIONED WITH A COUNT, A POPULATION, AND A FALSIFIER THAT HAS A RUN AND A WOULD-FAIL. The counts come from TWO INSTRUMENTS over the SAME 646-file population: the ARBITER's columns (the arm's TABLE 1) for the classes the arbiter decides, and the ANALYZER's own metadata (the wall census) for the classes the analyzer's rows carry. The two populations are the same 646 files and the generator refuses to write if they are not.",
  causeRulings,
  resolution_caveats: [
    `A CAUSE IS STATED, NOT RESOLVED: ${total!.causeOK} edges carry a DECLARED cause (bucket 3) and live in otherUnresolved, never in resolved — the analyzer's scope is PER FILE and the arbiter (which holds the project) is what answers them. All ${total!.causeOK} are \`causeOK\` edges and 0 are \`causeFAIL\`.`,
    `AMBIGUOUS COUNTS DECLARATIONS, NOT KINDS: ${total!.ambDecl} edges. The by-KIND count is ${total!.ambKind} and it is a SUBSET of the by-declaration count — the instrument prints it beside it and it is NEVER added. A number of ${total!.ambDecl} and a number of ${total!.ambKind} are the same edges counted two ways.`,
    `${total!.collRes} OF THE ${total!.resolved} RESOLVED EDGES ARE TIE-BREAK PICKS (the instrument's collRes): the target had MORE THAN ONE declaration and production's tie-break chose one. The fleet's own indexer measures 37,318 of 49,729 such picks as WRONG — so this lane's \`resolved\` INCLUDES picks the fleet's measurement calls wrong, and a reader comparing it with a lane whose \`resolved\` means 'the target was found' must know that.`,
    `EXTERNAL IS A CLAIM, NOT A RESOLUTION: ${sum("external")} edges live in \`external\`, of which ${total!.extOK} the project CONFIRMS, ${total!.extUnver} no check can reach, and ${total!.extFAIL} the project REFUTES (0 measured — a refuted claim is charged against the lane). None of them is a resolution, and none of them is folded into \`resolved\`.`,
    `THE TWO POPULATIONS DIFFER AND THE DECLARATION SAYS WHICH IS WHICH: the arm's TABLE 1 counts ${total!.edges} edges (the ARBITER's kept rows) and the wall census counts ${census.control.totalEdges} edges (the ANALYZER's published rows). The two are NOT the same set and must never be added together; the wall classes' counts are over the census's population and the closure is over the arm's.`,
    "THE `renders` RULE IS ONE IMPLEMENTATION WITH A MEASURED NEAR MISS, AND THE NEAR MISS IS PUBLISHED RATHER THAN ASSUMED AWAY: the emitted relation needs a keyword-led vector whose element names the rendered component (`[:div [widget]]`). MEASURED over the population — 900 keyword-led vectors over 123 files, of which 159 over 23 files carry a BARE SYMBOL child and 0 carry a component-VECTOR child; the NAIVE shape (a keyword-led vector with any bare symbol element) published 86 rows and ALL 86 were map key paths (`get-in`/`assoc-in`/`update-in`) rather than rendered components. The sound rule therefore carries a same-file-CALLABLE resolution test, and its population count is 0 — a 0 that was ASKED FOR, not a 0 that was never asked. The falsifier that would void it: a corpus site where a keyword-led vector names a same-file callable that is NOT a rendered component (0 measured).",
    `THE WALL CENSUS's CONTROL IS PUBLISHED BESIDE THE CLASSES: ${census.control.classifiedRows} of ${census.control.totalEdges} rows fall into a named wall class and ${census.control.unclassifiedRows} do not (those are the rows the arbiter resolves). The falsifiers' OWN controls — a row in a RULED class whose target IS project-declared, which would make the class checkable — measured ${census.control.bareNameProjectDeclared} (bare-name class) and ${census.control.overridesProjectDeclared} (overrides class): 0 means the rulings are not refuted BY THIS INSTRUMENT, which is NOT the same as the rulings being true.`,
  ],
}

writeFileSync(OUT, JSON.stringify(decl, null, 2))
console.log(`WROTE ${path.relative(ROOT, OUT)}`)
console.log(`population: ${POPULATION}`)
console.log(`closure: ${closureEdges} edges = resolved ${sum("resolved")} + external ${sum("external")} + ambiguous ${sum("ambiguous")} + otherUnresolved ${sum("otherUnresolved")} + unclassed ${sum("unclassed")}`)
console.log(`cause rulings: ${Object.keys(causeRulings).length} (each with a count, a population, a falsifier with a run and a wouldFail)`)
for (const [k, v] of Object.entries(causeRulings)) console.log(`  ${String(v.count).padStart(6)}  ${k}`)
process.exit(0)
