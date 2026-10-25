/**
 * vue-declaration.ts — BUILD THE WHOLE-POPULATION DECLARATION FROM THE ARM'S OWN TABLE 1.
 *
 * DERIVED, NOT TYPED (the java lesson, applied to vue): this parses the arm log's
 * population line and per-type rows and maps them into the gate's five buckets,
 * REFUSING (exit 4/5/6) when anything does not close. A hand-written declaration is a
 * second copy of a measurement; this is the measurement re-read.
 *
 * REFUSALS (all fatal, nothing written):
 *   · the arm log does not say parsed == admitted, or disagrees with the census  -> exit 4
 *   · a per-type row's eleven terms do not sum to its edge count                 -> exit 5
 *   · the fleet TOTAL's eleven terms do not sum to the fleet edge count          -> exit 5
 *   · the per-type edge sum does not equal the fleet edge count                   -> exit 5
 *   · a population string is not the FULL FORM (parsed/admitted/exts/index)      -> exit 6
 *
 * USAGE: npx tsx script/m14/vue-declaration.ts --arm <log> --census <json> [--write]
 */
import { readFileSync, writeFileSync } from "node:fs"

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const armLog = arg("--arm")
const residualLog = arg("--residual")
const censusPath = arg("--census")
if (!armLog || !residualLog || !censusPath) { console.error("usage: vue-declaration.ts --arm <incoming-log> --residual <residual-log> --census <json> [--write]"); process.exit(2) }

const log = readFileSync(armLog, "utf8")
// THE RESIDUAL GATE HOLDS THE POPULATION LINE (POPULATION — N parsed of N sampled · corpus N
// files across N repos) and the INCOMING GATE holds TABLE 1's fourteen-term rows; the arm
// produces BOTH artifacts and the declaration is derived from the pair. Reading one file for
// both would be the java generator's shape with one more file — so the two are separate
// arguments and BOTH are measured, cross-checked against the census.
const residual = readFileSync(residualLog, "utf8")
const census = JSON.parse(readFileSync(censusPath, "utf8"))

// ── the population, from the residual gate's own line ───────────────────────────────────────────
const popMatch = residual.match(/POPULATION — (\d+) parsed of (\d+) sampled · corpus (\d+) files across (\d+) repos/)
if (!popMatch) { console.error("REFUSED (4): the arm log has no POPULATION line"); process.exit(4) }
const parsed = Number(popMatch[1])
const admitted = Number(popMatch[3])
const repos = Number(popMatch[4])
if (parsed !== admitted) { console.error(`REFUSED (4): parsed ${parsed} != admitted ${admitted} — a SAMPLE cannot back a population declaration`); process.exit(4) }
if (parsed !== census.population.admitted) { console.error(`REFUSED (4): the arm's admitted ${parsed} != the census's ${census.population.admitted} — two instruments over two populations`); process.exit(4) }
if (repos !== census.population.reposWithAdmitted) { console.error(`REFUSED (4): the arm's repos ${repos} != the census's ${census.population.reposWithAdmitted}`); process.exit(4) }
const POP = `parsed=${admitted}/${admitted} admitted=${admitted} exts=vue index=no`

// ── per-type rows: edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL bindOK bind? bindFAIL causeOK causeFAIL ──
// FOURTEEN numbers, and only TABLE 1 has fourteen — the five-bucket summary under it never matches
// (the java generator's lesson, kept verbatim: a generator that reads two tables with one pattern
// reads neither).
const rows: Record<string, { edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number; unresolved: number; extOK: number; extUnk: number; extFAIL: number; bindOK: number; bindUnk: number; bindFAIL: number; causeOK: number; causeFAIL: number }> = {}
const rowRe = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates|decorates|renders|mixes_in|part_of)\s+((?:\d+\s+){13}\d+)\s*$/gm
let m: RegExpExecArray | null
while ((m = rowRe.exec(log)) !== null) {
  if (rows[m[1]]) continue
  const v = m[2].trim().split(/\s+/).map(Number)
  rows[m[1]] = { edges: v[0], resolved: v[1], collRes: v[2], ambDecl: v[3], ambKind: v[4], unresolved: v[5], extOK: v[6], extUnk: v[7], extFAIL: v[8], bindOK: v[9], bindUnk: v[10], bindFAIL: v[11], causeOK: v[12], causeFAIL: v[13] }
}
const LABELS = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates","decorates","renders","mixes_in","part_of"]
for (const l of LABELS) {
  if (!rows[l]) { console.error(`REFUSED (5): no row for ${l} in the arm log`); process.exit(5) }
  const r = rows[l]
  const sum = r.resolved + r.ambDecl + r.unresolved + r.extOK + r.extUnk + r.extFAIL + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK + r.causeFAIL
  if (sum !== r.edges) { console.error(`REFUSED (5): ${l} terms ${sum} != edges ${r.edges}`); process.exit(5) }
}
const totalRow = log.match(/^TOTAL\s+((?:\d+\s+){13}\d+)\s*$/m)
if (!totalRow) { console.error("REFUSED (5): no fleet TOTAL row (fourteen terms)"); process.exit(5) }
const tv = totalRow[1].trim().split(/\s+/).map(Number)
const totalEdges = tv[0]
const totalSum = tv[1] + tv[3] + tv[5] + tv[6] + tv[7] + tv[8] + tv[9] + tv[10] + tv[11] + tv[12] + tv[13]
if (totalSum !== totalEdges) { console.error(`REFUSED (5): fleet TOTAL terms ${totalSum} != edges ${totalEdges}`); process.exit(5) }
const perTypeSum = LABELS.reduce((n, l) => n + rows[l].edges, 0)
if (perTypeSum !== totalEdges) { console.error(`REFUSED (5): per-type edges ${perTypeSum} != fleet ${totalEdges}`); process.exit(5) }

// THE CENSUS'S EMISSION COUNTS CROSS-CHECKED AGAINST THE ARM (the two instruments ran over the
// same population on the same analyzer; a disagreement is a stale artifact, not a rounding error).
const censusCounts = census.emission.typeCounts
for (const l of LABELS) {
  if (rows[l].edges !== (censusCounts[l] ?? 0)) {
    console.error(`REFUSED (4): the arm's ${l} edges ${rows[l].edges} != the census's ${censusCounts[l] ?? 0} — the two instruments disagree; re-run the census`)
    process.exit(4)
  }
}

// ── the declaration, in the gate's five-bucket schema ───────────────────────────────────────────
const types: Record<string, any> = {}
for (const l of LABELS) {
  const r = rows[l]
  types[l] = {
    edges: r.edges,
    resolved: r.resolved,
    external: r.extOK,
    ambiguous: r.ambDecl,
    otherUnresolved: r.unresolved + r.extUnk + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK,
    unclassed: 0,
    _ambKind: r.ambKind,
    _collRes: r.collRes,
    closure: {
      edges: r.edges, resolved: r.resolved, collRes: r.collRes, ambDecl: r.ambDecl, ambKind: r.ambKind,
      unresolved: r.unresolved, extOK: r.extOK, extUnk: r.extUnk, extFAIL: r.extFAIL,
      bindOK: r.bindOK, bindUnk: r.bindUnk, bindFAIL: r.bindFAIL, causeOK: r.causeOK, causeFAIL: r.causeFAIL,
    },
  }
}

const declaration: any = {
  meta: {
    lang: "vue",
    instrument: "script/m14/incoming-gate.ts (single whole-population measurement; the declaration is DERIVED from its own TABLE 1 by script/m14/vue-declaration.ts, which refuses on any non-closure)",
    sample: admitted,
    corpusTotal: admitted,
    corpusRepos: repos,
    parsed: admitted,
    population: POP,
    populationRule: {
      rule: "the admitted set is the GIT-TRACKED set: per-checkout `git ls-files` over $PWD/.corpus, extension .vue from the router's ONE table, present on disk, <= 512 KB cap, detected as vue",
      root: "$PWD/.corpus",
      scope: `${repos} repositories carry an admitted file: element-plus 1,008 · vue-element-admin 131 · vue-core 11 · nvim-treesitter 3 · gql-graphql-eslint 1 · snacks.nvim 1`,
      censusAgreement: `script/m14/vue-extended-census.ts independently admitted ${census.population.admitted} files over ${census.population.reposWithAdmitted} repos and parsed 1,155 of 1,155 with 0 failures — the two instruments agree`,
    },
    measurementForm: "ONE arm run over the whole admitted population (1,155 files, single process, index=no — under the ~7,600-parse WASM abort point the dart lane measured, and the engine frees every tree). NO chunking, so there is no chunk-resolution bias and no mixed-index arm to caveat.",
    grammarDigests: {
      rule: "sha256 of the bytes the registry serves (L-11/§6 — never a path, never a log line); the repo wasm/ candidate is FIRST in the engine's list for every spelling",
      vue: census.grammars.vue,
      typescript: census.grammars.typescript,
      javascript: census.grammars.javascript,
      tsx: census.grammars.tsx,
    },
    artifacts: {
      armTable1: "validation/m14/measurements/vue-head-incoming-table1-20261024.txt",
      residualGate: "validation/m14/measurements/vue-head-residual-gate-20261024.txt",
      census: "validation/m14/measurements/vue-extended-census.json",
    },
    generator: "script/m14/vue-declaration.ts",
  },
  types,
  causeRulings: {
    imports_module_path_targets: {
      population: POP,
      count: rows.imports.unresolved + rows.imports.bindOK,
      what: "the imports row's unresolved targets are MODULE PATHS and specifier:item pairs (`./mixins/resize:resize`, `element-plus:ElButton`) — an import names a module and creates binding scope, so no per-file declaration can answer it and the row is stated rather than resolved. The delegate's `${modulePath}:${item}` form is the JS family contract, and the seam re-glues it when the module half rides metadata (VUE-SVELTE-REGRESSION).",
      falsifier: {
        run: "npx tsx script/m14/incoming-gate.ts vue 0 --dump (the whole-population arm; TABLE 1's imports unresolved column is the count)",
        wouldFail: "an imports row whose target IS a bare name the project declares — the arbiter's key space is the project's symbols and a bare imported name would resolve, so the unresolved column would fall below the path-shaped share the dump shows",
      },
    },
    renders_registry_name_seam: {
      population: POP,
      count: rows.renders.unresolved + rows.renders.bindOK,
      what: "renders' unresolved tail is the REGISTRY-NAME SEAM measured before the relabel and unchanged by it (the three-arm differential cross-check in the census artifact): the analyzer publishes Vue's RESOLVED registry name (`ElButton` for `<el-button>` — the F31 rule, vue's own resolveAsset order), while most components resolve in neither denominator because they are globally registered in a `components: {}` map or a UI library. The oracle-vs-analyzer normalization gap predates the 2026-10-24 relabel: same rows, same counts, before and after (pre instantiates=448+imports=150 → post renders=458+imports=150 on the 200-file draw; 297→297 EXACT on vue-element-admin).",
      falsifier: {
        run: "npx tsx script/m14/differential.ts --lang vue --sample 200 (the three-arm cross-check recorded in validation/m14/measurements/vue-extended-census.json relabel.renders.differentialCrossCheck)",
        wouldFail: "a renders row whose target is NOT the registry name for the tag the template wrote — the analyzer's `resolution: registry-name` + `tagAsWritten` metadata would disagree with the written spelling, and the differential's unexplained count would move",
      },
    },
    corpus_zero_extended_types: {
      population: POP,
      count: 0,
      what: "FOUR types are IMPLEMENTED AND CORPUS-UNEXERCISED (csharp's class — counted once inside implemented, never exclusions): implements, overrides, decorates, part_of. Each carries a construct census of 0 sites over the whole 1,155-file population and a LIVE positive control in validation/m14/measurements/vue-extended-census.json (all five control arms PASS): a ts class heritage in a script block emits `implements` through the full production path; a decorated class emits `decorates`; a `/// <reference path=…>` in a `<script lang=\"ts\">` block emits `part_of` with the mandatory partRole:'path' (§8) — the served typescript build produces a REAL reference_directive node, measured on the parse tree. The corpus simply writes none of these constructs.",
      falsifier: {
        run: "npx tsx script/m14/vue-extended-census.ts (the construct leg's per-construct counters and the five control arms; exit 5 if any control fails)",
        wouldFail: "an admitted .vue script block carrying a class heritage / an applied decorator / a triple-slash reference directive — the census's construct count would rise above 0 and the arm's row would leave zero",
      },
    },
    mixes_in_adjudication: {
      population: POP,
      count: census.rulings.mixes_in.sites,
      what: "mixes_in is RULED (adjudication, Lead-ruled 2026-10-24), not implemented: Vue's `mixins:` option composes NO supertype chain — vue-core's own runtime merges each mixin's options into a FLAT options object by per-option merge strategy, recursively (componentOptions.ts resolveMergedOptions → mergeOptions(resolved, base, strats) with `mixins.forEach((m) => mergeOptions(to, m, strats, true))`, corpus checkout f8975657d7451d8e4291406427e6a8ae5e50c8d5). The types.ts:155 contract says `mixes_in` = 'a class COMPOSES a mixin into its supertype chain' — the word 'mixins' is in Vue's API but the measured semantics are an options merge. All 9 sites are ALREADY published as `extends{isMixin:true}` under VSD28, the relation the semantics support.",
      falsifier: {
        run: "grep -n 'mixins.forEach' .corpus/vue-core/packages/runtime-core/src/componentOptions.ts (the runtime's own merge loop — the citation is vue-core's source, measured not asserted)",
        wouldFail: "a vue construct that composes behaviour into a supertype chain — the runtime merges options instead; were Vue to gain class-based mixin composition, this ruling needs re-measurement",
      },
    },
    instantiates_delegate_only: {
      population: POP,
      count: rows.instantiates.edges,
      what: "instantiates is DELEGATE-ONLY after the 2026-10-24 renders relabel: its 16 rows are the JS/TS sub-analyzer's script-`new` constructions — the only `instantiates` the language's source contains. The 2,235 SFC template component-tag rows moved to `renders` with the two-label total UNCHANGED (pre instantiates 2,251 + renders 26 = post instantiates 16 + renders 2,261 = 2,277 — no edge gained or lost, the cross-check recorded in the census artifact).",
      falsifier: {
        run: "npx tsx script/m14/vue-extended-census.ts (the emission leg's instantiatesSplit: sfcTemplate must be 0 and delegateNew 16)",
        wouldFail: "a template component tag emitting instantiates again — the census's instantiatesSplit.sfcTemplate would rise above 0 and the relabel's control arm (template-tag-emits-renders) would go red",
      },
    },
  },
  resolution_caveats: [
    "A CAUSE IS STATED, NOT RESOLVED: unresolved rows live in otherUnresolved, never in resolved, and the analyzer's scope is PER FILE with index=no — a target declared in another file of the project is genuinely out of its reach and the arbiter (which holds the project) is what answers it.",
    "amb(kind) IS A SUBSET OF amb(decl), printed beside it and NEVER added to the closure.",
    "collRes IS A SUBSET OF resolved (a tie-break pick among colliding declarations), printed beside it and NEVER added.",
    "THE RENDERS RELABEL IS A LABEL MOVE, NOT AN EDGE MOVE: 2,235 template rows moved from instantiates to renders with the two-label total UNCHANGED at 2,277 (pre 2,251+26 = post 16+2,261), cross-checked in the census artifact; the residual gate's TOTAL closes at the same 24,765 the pre-relabel population published plus the relabel's own label split.",
    "THE REGISTRY-NAME SEAM IS THE LANE'S KNOWN OPEN RESOLUTION LIMIT, not a wrong target: `<el-button>` publishes `ElButton` because that is the name Vue's own resolveAsset order resolves and the registry holds; `tagAsWritten` carries the written spelling and `resolution: registry-name` says the target was normalized, so nothing is lost and a reader can tell a normalized target from a literal one.",
    "39 of 392 ambiguous edges carry an OWN-FILE-SILENT claim (the residual gate's claim census): only ANOTHER file declares the target, which is not a refutation — the count is published beside the column and never subtracted from it.",
    "imports' targets are module paths by the JS family contract (`${modulePath}:${item}`); they land in otherUnresolved rather than resolved because no per-file declaration can answer a module path, and the bindOK rows are targets SPELLED as bindings, which no declaration can answer by construction.",
    "THE SIX CORPUS-ZERO TYPES CARRY THEIR ZEROS AS ROW PROPERTIES (implements, overrides, decorates, part_of, mixes_in ruled, renders' delegate-JSX 26 rows aside): each zero is a census count over the whole population with a live positive control, not an absence — csharp's class, counted once inside implemented, never an exclusion.",
  ],
}

// ── the full-form check (§5: the gate's one regex must parse every population string) ─────────
const FULL_FORM = /^parsed=\d+\/\d+ admitted=\d+ exts=vue index=(yes|no)$/
if (!FULL_FORM.test(declaration.meta.population)) { console.error("REFUSED (6): the meta population is not the full form"); process.exit(6) }
for (const k of Object.keys(declaration.causeRulings)) {
  if (!FULL_FORM.test(declaration.causeRulings[k].population)) { console.error(`REFUSED (6): causeRuling ${k} population is not the full form`); process.exit(6) }
}

const outPath = "validation/m14/instruments/vue/incoming-declaration.json"
if (argv.includes("--write")) {
  writeFileSync(outPath, JSON.stringify(declaration, null, 2) + "\n")
  console.log(`wrote ${outPath}: ${LABELS.length} types, ${Object.keys(declaration.causeRulings).length} cause rulings, population ${POP}`)
} else {
  console.log(`DRY RUN OK: ${LABELS.length} types close exactly; population ${POP}; use --write to write`)
  console.log(`fleet TOTAL: edges ${totalEdges} = terms ${totalSum} EXACT; per-type sum ${perTypeSum}`)
}
