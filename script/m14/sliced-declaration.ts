/**
 * A WHOLE-POPULATION DECLARATION DERIVED FROM A SLICED ARM'S OWN OUTPUT.
 *
 * The completion gate reads `validation/m14/instruments/<lang>/incoming-declaration.json`. When the
 * arm ran as DISJOINT SLICES (a population too large for one process), the measurement is the UNION
 * of the slices and the declaration has to be derived from all of them at once — this instrument.
 *
 * It sums each slice's TABLE 1 rows and fleet TOTAL, CROSS-CHECKS the sums against the merge's
 * closure artifact, and refuses (exit 4/5) when anything does not close. It then writes the gate's
 * four sections: `meta`, `types` (the five buckets per type), `causeRulings` (one per type's wall,
 * with the population, the count and a falsifier that is a run and a would-fail) and
 * `resolution_caveats`.
 *
 * WHY THE WALL CAUSES ARE PER-TYPE AND NOT PER-NAME: the slices print a CAPPED worklist (25 names
 * per type per slice), so a per-name census over it would be a census of the cap. TABLE 1's columns
 * are EXACT, so the count in each ruling is TABLE 1's, and the sampled names are cited as the
 * EVIDENCE OF WHICH CAUSE, never as the count.
 *
 * USAGE: npx tsx script/m14/sliced-declaration.ts --lang go --slices <dir> --closure <json> \
 *          --census <json> --exts <"go"> [--write]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const lang = arg("--lang")
const slicesDir = arg("--slices")
const closurePath = arg("--closure")
const censusPath = arg("--census")
const exts = arg("--exts")
const write = argv.includes("--write")
if (!lang || !slicesDir || !closurePath || !censusPath || !exts) {
  console.error("usage: sliced-declaration.ts --lang <l> --slices <dir> --closure <json> --census <json> --exts <exts> [--write]")
  process.exit(2)
}
const closure = JSON.parse(readFileSync(closurePath, "utf8"))
const census = JSON.parse(readFileSync(censusPath, "utf8"))
const LABELS = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates","decorates","renders","mixes_in","part_of"]

type Row = { edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number; unresolved: number; extOK: number; extUnk: number; extFAIL: number; bindOK: number; bindUnk: number; bindFAIL: number; causeOK: number; causeFAIL: number }
const sum: Record<string, Row> = {}
for (const l of LABELS) sum[l] = { edges:0,resolved:0,collRes:0,ambDecl:0,ambKind:0,unresolved:0,extOK:0,extUnk:0,extFAIL:0,bindOK:0,bindUnk:0,bindFAIL:0,causeOK:0,causeFAIL:0 }
let fleet = 0, sliceCount = 0
const samples: Record<string, { amb: string[]; unres: string[] }> = {}
for (const l of LABELS) samples[l] = { amb: [], unres: [] }

const files = readdirSync(slicesDir).filter((f) => f.endsWith(".txt")).sort()
if (files.length === 0) { console.error("REFUSED (4): no slices"); process.exit(4) }
const rowRe = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates|decorates|renders|mixes_in|part_of)\s+((?:\d+\s+){13}\d+)\s*$/gm
for (const f of files) {
  const text = readFileSync(join(slicesDir, f), "utf8")
  if (!/^TOTAL\s+((?:\d+\s+){13}\d+)\s*$/m.test(text)) { console.error(`REFUSED (4): slice ${f} has no TOTAL row — the union would have a hole`); process.exit(4) }
  sliceCount++
  let m: RegExpExecArray | null
  rowRe.lastIndex = 0
  while ((m = rowRe.exec(text)) !== null) {
    const v = m[2].trim().split(/\s+/).map(Number)
    const r = sum[m[1]]
    r.edges += v[0]; r.resolved += v[1]; r.collRes += v[2]; r.ambDecl += v[3]; r.ambKind += v[4]; r.unresolved += v[5]
    r.extOK += v[6]; r.extUnk += v[7]; r.extFAIL += v[8]; r.bindOK += v[9]; r.bindUnk += v[10]; r.bindFAIL += v[11]; r.causeOK += v[12]; r.causeFAIL += v[13]
  }
  const t = text.match(/^TOTAL\s+((?:\d+\s+){13}\d+)\s*$/m)!
  fleet += Number(t[1].trim().split(/\s+/)[0])
  // the worklist's sampled names, per type — EVIDENCE of the cause, never a count
  const work = text.split("AMBIGUOUS / UNRESOLVED TARGETS")[1] ?? ""
  let cur = ""
  for (const line of work.split("\n")) {
    const head = line.match(/^  ([a-z_]+)\s*$/)
    if (head) { cur = head[1]; continue }
    if (!cur) continue
    const a = line.match(/^    amb\s+(\S+)/)
    const u = line.match(/^    unres\s+(\S+)/)
    if (a && samples[cur] && samples[cur].amb.length < 12) samples[cur].amb.push(a[1])
    if (u && samples[cur] && samples[cur].unres.length < 12) samples[cur].unres.push(u[1])
  }
}

// ── refuse unless the slices' sums ARE the closure's numbers ─────────────────
const c = closure.closure
const sumEdges = LABELS.reduce((n, l) => n + sum[l].edges, 0)
if (sumEdges !== fleet) { console.error(`REFUSED (5): per-type sums ${sumEdges} != the slices' TOTAL ${fleet}`); process.exit(5) }
if (fleet !== c.edges) { console.error(`REFUSED (5): the slices' edges ${fleet} != the closure's ${c.edges}`); process.exit(5) }
if (sumL("resolved") !== c.resolved) { console.error(`REFUSED (5): resolved ${sumL("resolved")} != closure ${c.resolved}`); process.exit(5) }
if (sumL("ambDecl") !== c.ambDecl) { console.error(`REFUSED (5): amb(decl) ${sumL("ambDecl")} != closure ${c.ambDecl}`); process.exit(5) }
if (sumL("unresolved") !== c.unresolved) { console.error(`REFUSED (5): unresolved ${sumL("unresolved")} != closure ${c.unresolved}`); process.exit(5) }
if (sumL("extOK") !== c.extOK) { console.error(`REFUSED (5): extOK ${sumL("extOK")} != closure ${c.extOK}`); process.exit(5) }
function sumL(k: keyof Row): number { return LABELS.reduce((n, l) => n + (sum[l][k] as number), 0) }
const fail = sumL("extFAIL") + sumL("bindFAIL") + sumL("causeFAIL")
if (fail > 0) { console.error(`REFUSED (5): a refusal counter fired (${fail})`); process.exit(5) }

// ── population: the closure's meta, corroborated by the census ────────────────
const pop = closure.meta?.population
const admitted = Number(pop?.admitted)
const parsed = Number(pop?.parsed)
const censusAdmitted = Number(census?.population?.admitted)
if (parsed !== admitted) { console.error(`REFUSED (4): the closure's parsed ${parsed} != admitted ${admitted}`); process.exit(4) }
if (admitted !== censusAdmitted) { console.error(`REFUSED (4): the closure's admitted ${admitted} != the census's ${censusAdmitted} — two instruments over two populations`); process.exit(4) }
const POP = `parsed=${admitted}/${admitted} admitted=${admitted} exts=${exts} index=no`

const types: Record<string, any> = {}
for (const l of LABELS) {
  const r = sum[l]
  types[l] = {
    edges: r.edges,
    resolved: r.resolved,
    external: r.extOK,
    ambiguous: r.ambDecl,
    otherUnresolved: r.unresolved + r.bindOK + r.causeOK,
    unclassed: 0,
    _ambKind: r.ambKind,
    _collRes: r.collRes,
    closure: { edges: r.edges, resolved: r.resolved, collRes: r.collRes, ambDecl: r.ambDecl, ambKind: r.ambKind, unresolved: r.unresolved, extOK: r.extOK, extUnk: r.extUnk, extFAIL: r.extFAIL, bindOK: r.bindOK, bindUnk: r.bindUnk, bindFAIL: r.bindFAIL, causeOK: r.causeOK, causeFAIL: r.causeFAIL },
  }
}

// ── the walls: one ruling per type whose non-resolved tail is non-zero ────────
const CAUSE_TEXT: Record<string, string> = {
  calls: "a call edge whose target is a NAME ONLY (`Clone`, `Errorf`, `Encode`, `Do`): the language lets many types declare the same method name and a call is disambiguated by its RECEIVER, which the published target spelling does not carry — so the arbiter sees several declarations of that name and the row is ambiguous, not wrong. The unresolved tail is calls into packages outside the admitted set.",
  uses: "a `uses` edge whose target name is declared in several files of the project or in none of them (a field or package-level name read across files): the analyzer's scope is PER FILE, so a name it cannot see declared here is stated rather than resolved.",
  contains: "a `contains` edge whose target name is declared more than once in the project — every Go file may declare `init`/`String`/`Error`, and `contains` answers to its owner's name.",
  imports: "an import specifier naming a package the admitted set does not carry (a standard-library or third-party module path): an import names a MODULE and creates binding scope, so no per-file declaration can answer it.",
  references: "a reference whose target name is declared several times in the project, or nowhere in it: the read is a NAME, and the file-scoped analyzer can only answer for names it can see.",
  exports: "an export whose target name collides across the project: the exported declaration exists, but the arbiter cannot pick which one the name means.",
  overrides: "an override whose target names a method declared on several types.",
  part_of: "an inclusion whose target file is outside the admitted set or declares no symbol named after itself.",
}
const causeRulings: Record<string, any> = {}
for (const l of LABELS) {
  const r = sum[l]
  const wall = r.ambDecl + r.unresolved + r.bindOK + r.causeOK
  if (wall === 0) continue
  const s = samples[l]
  const named = [...s.amb.slice(0, 4), ...s.unres.slice(0, 4)].join("`, `")
  causeRulings[`${l}_targets_not_decidable_from_the_published_name`] = {
    population: POP,
    count: wall,
    what: `${l}: ${r.resolved} of ${r.edges} edges resolved; the remaining ${wall} are ${r.ambDecl} ambiguous + ${r.unresolved} unresolved + ${r.bindOK} spelled as a binding + ${r.causeOK} with a declared cause (TABLE 1's own columns, summed over ${sliceCount} slices — EXACT, not sampled). ${CAUSE_TEXT[l] ?? "the target names nothing this file declares."}${named ? ` The arm's worklist samples the ambiguous/unresolved names for this type: \`${named}\`.` : ""}`,
    falsifier: {
      run: `npx tsx script/m14/incoming-gate.ts ${lang} 0 (the whole population in one process) — TABLE 1's ambiguous + unresolved + bindOK + causeOK columns for ${l} are the count`,
      wouldFail: `a run in which one of those ${wall} edges resolves (the count falls) or one of the sampled names resolves to a SINGLE declaration — either would mean the wall was the run's scope, not the corpus's name collisions.`,
    },
  }
}

const decl = {
  meta: {
    lang,
    instrument: `script/m14/incoming-gate.ts over ${sliceCount} DISJOINT slices (a union, merged by script/m14/merge-arm-slices.ts and cross-checked here); this declaration is DERIVED from the slices' own TABLE 1 by script/m14/sliced-declaration.ts, which refuses on any non-closure`,
    sample: parsed, corpusTotal: admitted, parsed,
    population: POP,
    populationRule: { rule: `the admitted set is the GIT-TRACKED set: per-checkout \`git ls-files\` over $PWD/.corpus, extensions ${exts} from the router's one table, files present on disk and at most 1 MiB` },
    resolvedScope: "the file's OWN PROJECT (production's scope; index=no — the analyzer sees one file at a time, and the arbiter holds the project)",
    measuredEdges: fleet,
    slices: sliceCount,
    closure: { resolved: c.resolved, external: c.extOK, ambiguous: c.ambDecl, otherUnresolved: c.unresolved, unclassed: 0, exact: c.exact === true },
    generatedBy: "script/m14/sliced-declaration.ts",
  },
  types,
  causeRulings,
  resolution_caveats: [
    "A CAUSE IS STATED, NOT RESOLVED: unresolved rows live in otherUnresolved (which also holds the binding-spelled and declared-cause rows), never in resolved, and the analyzer's scope is PER FILE with index=no — a target declared in another file of the project is genuinely out of its reach and the arbiter (which holds the project) is what answers it.",
    "THE POPULATION IS A UNION OF DISJOINT SLICES, not one process: the merge refuses a hole, an overlap and a closure whose eleven terms do not sum, and this generator re-checks the union against the closure artifact before writing.",
    "`collRes` IS A SUBSET OF `resolved` AND IS NEVER ADDED: a resolved edge whose target had more than one declaration in the project, so production's own-file tie-break chose the row. The resolved column is a FLOOR on correct resolution, not a count of correct edges.",
    "`amb(kind)` IS A SUBSET OF `amb(decl)`: it counts distinct KINDS among the colliding declarations, while amb(decl) counts distinct DECLARATIONS.",
    "THE WALL COUNTS ARE TABLE 1's EXACT COLUMNS, summed over the slices; the NAMES quoted in each ruling are the arm's own 25-name-capped worklist, cited as evidence of WHICH cause and never as a count.",
  ],
}

if (!write) {
  console.log(JSON.stringify({ lang, slices: sliceCount, edges: fleet, types: Object.keys(types).length, causes: Object.keys(causeRulings).length, population: POP }, null, 1))
  console.log("DRY RUN — nothing written (pass --write)")
  process.exit(0)
}
writeFileSync(`validation/m14/instruments/${lang}/incoming-declaration.json`, JSON.stringify(decl, null, 2) + "\n")
console.log(`WROTE validation/m14/instruments/${lang}/incoming-declaration.json — ${fleet} edges over ${sliceCount} slices, ${Object.keys(types).length} types, ${Object.keys(causeRulings).length} cause rulings, ${POP}`)
