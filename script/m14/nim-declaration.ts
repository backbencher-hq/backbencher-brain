/**
 * NIM — THE WHOLE-POPULATION DECLARATION THE COMPLETION GATE READS.
 *
 * `script/m14/completion-gate.ts` reads `validation/m14/instruments/nim/incoming-declaration.json`
 * and checks, in its own words: a population string that parses (`parsed=N/N admitted=N exts=…
 * index=…`), a PER-TYPE CLOSURE whose five buckets sum to the type's edges with `unclassed` at a
 * CEILING OF ZERO, a `resolution_caveats` block so a reader knows what this lane's buckets MEAN, and
 * a `causeRulings` block where every cause carries a population string and a falsifier with a `run`
 * and a `wouldFail`.
 *
 * THIS GENERATOR REFUSES RATHER THAN TRANSCRIBES. It will not write a declaration from
 *   · an arm whose population is not the admitted population (parsed ≠ sampled ≠ admitted),
 *   · a TABLE 1 whose ELEVEN-TERM closure does not close,
 *   · a cause census whose partition does not close, whose falsifier pass failed, or whose dump
 *     is not the whole non-resolved set,
 *   · an extended-type census whose own population guard or analyzer cross-check failed,
 *   · a five-bucket row that does not sum to its type's edges, or an `unclassed` that is not 0,
 *   · a cause ruling without BOTH a full-form population string and a falsifier run + wouldFail.
 *
 * Usage:
 *   bun run script/m14/nim-declaration.ts [--arm <log>] [--census <json>] [--causes <json>]
 *        [--spec <json>] [--out <json>] [--write]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined
}
const ARM = argOf("--arm") ?? path.join(ROOT, "validation/m14/measurements/nim/nim-gate-whole-2026-10-23.txt")
const CENSUS = argOf("--census") ?? path.join(ROOT, "validation/m14/measurements/nim-extended-census.json")
const CAUSES = argOf("--causes") ?? path.join(ROOT, "validation/m14/measurements/nim-cause-census.json")
const SPEC = argOf("--spec") ?? path.join(ROOT, "script/m14/spec/nim-completeness.json")
const POP = path.join(ROOT, "validation/m14/measurements/nim-population.json")
const OUT = argOf("--out") ?? path.join(ROOT, "validation/m14/instruments/nim/incoming-declaration.json")
const WRITE = argv.includes("--write")

for (const [what, p] of [["arm log", ARM], ["extended census", CENSUS], ["cause census", CAUSES], ["spec", SPEC], ["population", POP]] as const) {
  if (!existsSync(p)) { console.error(`FAIL — no ${what} at ${p}`); process.exit(2) }
}
const armText = readFileSync(ARM, "utf8")
const census = JSON.parse(readFileSync(CENSUS, "utf8")) as any
const causes = JSON.parse(readFileSync(CAUSES, "utf8")) as any
const spec = JSON.parse(readFileSync(SPEC, "utf8")) as any
const pop = JSON.parse(readFileSync(POP, "utf8")) as any
const ADMITTED = Number(pop.admitted)
const REPOS = Number(pop.repos)

// ── population ──────────────────────────────────────────────────────────────────────────────────
const pm = /population: (\d+) parsed of (\d+) sampled/.exec(armText)
const parsed = pm ? Number(pm[1]) : NaN
const sampled = pm ? Number(pm[2]) : NaN
if (!(parsed === ADMITTED && sampled === ADMITTED)) {
  console.error(`REFUSING — NOT A WHOLE-POPULATION ARM: parsed ${parsed} / sampled ${sampled} / admitted ${ADMITTED}`)
  process.exit(3)
}
const POPSTR = `parsed=${ADMITTED}/${ADMITTED} admitted=${ADMITTED} exts=nim,nims,nimble index=no`

// ── TABLE 1 ─────────────────────────────────────────────────────────────────────────────────────
const COLUMNS = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extUnk",
  "extFAIL", "bindOK", "bindUnk", "bindFAIL", "causeOK", "causeFAIL"] as const
type Row = Record<string, number> & { type: string }
const table = new Map<string, Row>()
let total: Row | null = null
{
  const lines = armText.split("\n")
  const h = lines.findIndex((l) => l.startsWith("TABLE 1"))
  if (h < 0) { console.error("REFUSING — the arm log carries no TABLE 1"); process.exit(3) }
  for (let i = h + 1; i < lines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+((?:\d+\s+)*\d+)\s*$/.exec(lines[i]!)
    if (!m) { if (total) break; continue }
    const nums = m[2]!.trim().split(/\s+/).map(Number)
    if (nums.length !== COLUMNS.length) continue
    const r: Row = { type: m[1]! } as Row
    COLUMNS.forEach((c, k) => { r[c] = nums[k]! })
    if (r.type === "TOTAL") { total = r; break }
    table.set(r.type, r)
  }
}
if (!total) { console.error("REFUSING — TABLE 1 carries no TOTAL row"); process.exit(3) }
const eleven = (r: Row): number =>
  r.resolved + r.ambDecl + r.unresolved + r.bindOK + r.bindUnk + r.bindFAIL + r.extOK + r.extUnk + r.extFAIL + r.causeOK + r.causeFAIL
const breaks: string[] = []
for (const [t, r] of table) if (eleven(r) !== r.edges) breaks.push(`${t}: ${eleven(r)} ≠ ${r.edges}`)
if (eleven(total) !== total.edges) breaks.push(`TOTAL: ${eleven(total)} ≠ ${total.edges}`)
if (breaks.length > 0) { console.error(`REFUSING — THE ELEVEN-TERM CLOSURE DOES NOT CLOSE: ${breaks.join(" · ")}`); process.exit(4) }

// ── the upstream instruments must have passed their own guards ─────────────────────────────────
if (!census?.crossCheck?.pass) { console.error("REFUSING — the extended-type census's REAL-ANALYZER cross-check did not pass"); process.exit(5) }
if (Number(census?.population?.filesWalked) !== Number(census?.population?.admitted)) {
  console.error(`REFUSING — the extended-type census walked ${census?.population?.filesWalked} of ${census?.population?.admitted} admitted files`); process.exit(5)
}
if (causes?.falsifierPass?.pass !== true || causes?.wall?.partitionCloses !== true || causes?.dump?.reconciledExactly !== true) {
  console.error("REFUSING — the cause census did not pass its partition / falsifier / dump-reconciliation guards"); process.exit(5)
}
if (Number(causes?.wall?.total) !== Number(total.unresolved)) {
  console.error(`REFUSING — the cause census partitions ${causes?.wall?.total} wall rows but TABLE 1 says ${total.unresolved} unresolved`); process.exit(5)
}
if (String(causes?.arm?.populationString) !== POPSTR) {
  console.error(`REFUSING — the cause census carries population "${causes?.arm?.populationString}" and this declaration writes "${POPSTR}" — a declaration that carries its population TWICE must carry it twice the SAME way (FLEET-RULINGS §5)`); process.exit(5)
}

// ── the per-type five buckets, derived from the eleven terms ────────────────────────────────────
const gateTypes: Record<string, any> = {}
for (const [t, r] of table) {
  const buckets = {
    edges: r.edges,
    resolved: r.resolved,
    ambiguous: r.ambDecl,
    otherUnresolved: r.unresolved + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK + r.causeFAIL,
    external: r.extOK + r.extUnk + r.extFAIL,
    unclassed: 0,
  }
  const sum = buckets.resolved + buckets.ambiguous + buckets.otherUnresolved + buckets.external + buckets.unclassed
  if (sum !== buckets.edges) { console.error(`REFUSING — ${t}: five buckets sum ${sum} ≠ edges ${buckets.edges}`); process.exit(6) }
  gateTypes[t] = {
    ...buckets,
    _ambKind: r.ambKind,
    _collRes: r.collRes,
    closure: Object.fromEntries(COLUMNS.map((c) => [c, r[c]])),
  }
}
// THE THREE RULED EXTENDED TYPES: a declared zero per type, carrying its ruling and falsifier, so a
// reader meets the zero with the declaration that produced it instead of assuming it was measured.
const cov = spec.coverage ?? {}
const excluded: any[] = Array.isArray(cov.excluded) ? cov.excluded : []
for (const x of excluded) {
  if (!x?.label) continue
  gateTypes[String(x.label)] = {
    edges: 0, resolved: 0, ambiguous: 0, otherUnresolved: 0, external: 0, unclassed: 0,
    _ambKind: 0, _collRes: 0,
    ruled: String(x.evidence ?? ""),
    ruling: String(x.from ?? "").slice(0, 400),
    closure: { edges: 0, resolved: 0, collRes: 0, ambDecl: 0, ambKind: 0, unresolved: 0, extOK: 0, extUnk: 0, extFAIL: 0, bindOK: 0, bindUnk: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0 },
  }
}

// ── the cause rulings: the cause census's own, verbatim, each re-checked ────────────────────────
const FULL_FORM = /parsed=(\d+)\/(\d+)\s+admitted=(\d+)\s+exts=([^ ]*)\s+index=(\S+)/
const causeRulings: Record<string, any> = {}
for (const [k, v] of Object.entries(causes?.causeRulings ?? {})) {
  const pop = String((v as any)?.population ?? "")
  const m = FULL_FORM.exec(pop)
  if (!m) { console.error(`REFUSING — cause ruling ${k}: population "${pop}" is not the FULL FORM (a short spelling parses as NULL and the gate reads a MISSING measurement where it has a MALFORMED one — FLEET-RULINGS §5)`); process.exit(7) }
  const f = (v as any)?.falsifier
  if (!(typeof f?.run === "string" && f.run.trim() && typeof f?.wouldFail === "string" && f.wouldFail.trim())) {
    console.error(`REFUSING — cause ruling ${k}: falsifier needs BOTH a run and a wouldFail`); process.exit(7)
  }
  causeRulings[k] = v
}
if (Object.keys(causeRulings).length === 0) { console.error("REFUSING — no cause rulings: every wall must be dispositioned"); process.exit(7) }

// ── the declaration ─────────────────────────────────────────────────────────────────────────────
const analyzerPath = path.join(ROOT, "src/ast/real-nim-analyzer.ts")
const analyzerDigest = createHash("sha256").update(readFileSync(analyzerPath)).digest("hex").slice(0, 16)
const decl = {
  meta: {
    lang: "nim",
    instrument: "script/m14/incoming-gate.ts (one whole-population run; --dump; no second instrument for the closure)",
    sample: ADMITTED,
    corpusTotal: ADMITTED,
    corpusRepos: REPOS,
    parsed,
    // ★ THE FULL FORM, IN `meta` AND IN EVERY causeRulings POPULATION (FLEET-RULINGS §5).
    population: POPSTR,
    populationRule:
      "THE ADMITTED SET IS THE GIT-TRACKED SET, NOT THE DISK: per-checkout `git ls-files -z` under $PWD/.corpus, the router's extension list {nim,nims,nimble}, present in the working tree, <= 1 MiB, dedup by realpath. MEASURED 2026-10-23: 6,063 admitted of 6,063 tracked, 8 repositories carrying an admitted file (nim 3,968 · nimony 1,508 · nim-lang-nimble 435 · graphql-nim 55 · nimterop 45 · bigints 21 · dom96-jester 19 · Aporia 12), 0 over the cap, 0 absent-on-disk, PATHS 6,063 · DISTINCT 6,063. Artifact: validation/m14/measurements/nim-population.json (script/m14/nim-population.ts).",
    populationNote:
      "ONE WHOLE-POPULATION RUN, not samples: the arm parsed 6,063 of 6,063 admitted with 0 parse failures and 0 degraded, so every bucket below is the population's. The census (validation/m14/measurements/nim-extended-census.json) walked the same 6,063 files with the leak guard filesAdmitted===filesRead, and its per-repository declared-name index is what the cause census partitions the wall against.",
    metric: "ambiguous counted by DECLARATIONS (distinct declarations), not distinct kinds; amb(kind) is a subset reported beside",
    analyzer: "src/ast/real-nim-analyzer.ts",
    analyzerDigest: `sha256:${analyzerDigest}`,
    generated: new Date().toISOString().slice(0, 10),
    armCommand: `BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts nim nim,nims,nimble 0 --dump`,
    armLog: path.relative(ROOT, ARM),
    artifacts: {
      population: "validation/m14/measurements/nim-population.json",
      extendedCensus: path.relative(ROOT, CENSUS),
      causeCensus: path.relative(ROOT, CAUSES),
      grammarInventory: "validation/m14/measurements/nim-grammar-nodes.json",
      rulingsPage: "validation/m14/verification/NIM-EXTENDED-TYPES.md",
    },
    coverageNote:
      "implemented = the ten canonical types + `part_of` (the 2026-10-23 R3 relabel of `include`, 1:1 from `imports`, target rule recorded as targetResolution=module-name) + `decorates` (the 2026-10-23 R3 pragma-TEMPLATE class: a declaration-owned pragma name resolving to a FILE-LOCAL `{.pragma.}` template, whose intended ontological ruling was WITHDRAWN BY ITS OWN FALSIFIER — 294 applied callables in pragma positions measured over the whole population). excluded = two extended types with admissible rulings: `renders` (grammar absence, with a positive control) and `mixes_in` (ontological, with every construct it names counted). n = 14 − 2 = 12.",
  },
  rules: {
    measurement: "one whole-population run; TABLE 1 of the incoming gate; the eleven-term closure re-checked here before writing",
    population: "the whole admitted set; no stride and no subsample",
    closure:
      "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges. amb(kind) and collRes are reported beside their parent buckets and NEVER added. unclassed ceiling is 0.",
    direction: "resolved/external are FLOORS (may not decrease). ambiguous/otherUnresolved/unclassed are CEILINGS (may not increase).",
  },
  types: gateTypes,
  causeRulings,
  resolution_caveats: [
    // ── the buckets' meaning, this lane's own ────────────────────────────────────────────────
    "THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN TERMS: `otherUnresolved` holds the unresolved+binding+cause edges (the gate has no bucket of their own for those terms), and every type publishes its ELEVEN TERMS in `closure` so nothing is hidden by the coarsening.",
    "THE RESOLUTION SCOPE IS PER FILE AND INDEX-LESS (index=no): nim has no `INDEX_SPECS` entry in script/m14/incoming-gate.ts, so the arm runs each file on its own. A name declared in ANOTHER FILE of the same project is out of reach BY CONSTRUCTION and reads unresolved; the B1 cause class (bare name declared elsewhere in the same project) is that wall, COUNTED. The indexed arm is a gap in that instrument, not in production, and is not claimed here.",
    "`resolved` MEANS the target found a declaration under the per-file scope. IT DOES NOT MEAN THE PICK IS CORRECT: collRes (OF resolved) is the tie-break population and the fleet's own indexer measures a large share of tie-break picks as wrong, so this column is a FLOOR on correct resolution, not a count of correct edges.",
    "`ambiguous` COUNTS DECLARATIONS (`amb(decl)`); `amb(kind)` is a SUBSET reported beside it and never added.",
    "EXTERNAL IS A CLAIM, NOT A RESOLUTION: extOK is a claim the project confirms, ext? one no check can reach, extFAIL one the project refutes (counted against the lane). None is folded into `resolved`.",
    "THE WALL IS AN EXACT PARTITION, NOT A LIST OF CAUSES: every one of the arm's unresolved rows is in exactly one class of the cause census, the classes SUM to TABLE 1's unresolved total, and each class carries a falsifier whose direction the instrument re-checks independently (script/m14/nim-cause-census.ts, exit 7 on a violation). The partition is published in validation/m14/measurements/nim-cause-census.json.",
    // ── the extended types, and the parts that need a reader's care ──────────────────────────
    "THE FOUR EXTENDED TYPES: `part_of` AND `decorates` ARE BOTH IMPLEMENTED AT RUNG R3, with no grammar change, and both appear in this declaration's TABLE 1 (part_of 457 rows / decorates 30 rows). `decorates` is the task's clearest example of the campaign's rule: THE INTENDED ONTOLOGICAL RULING WAS WITHDRAWN BY ITS OWN FALSIFIER — the census measured 294 pragma-use sites naming a DECLARED pragma template (48 distinct `template/macro X() {.pragma.}` declarations in 20 files), i.e. applied callables in pragma positions, and the type was implemented for exactly that class while the 99.1 % of pragma sites that are compiler DIRECTIVES stay symbol metadata and emit no relationship. `renders` is RULED on the served grammar's absence (0 of 164 named node types, with a javascript positive control on the same filter, and 0 of 696 render-host calls naming a component); `mixes_in` is RULED ONTOLOGICAL on the measured semantics of `mixin` (75 statements / 95 operands, 1,047 `object of` clauses = `extends`, 21,946 `of_branch` nodes = CASE variants, not inheritance). The rulings, their counts and their falsifiers are in validation/m14/verification/NIM-EXTENDED-TYPES.md and script/m14/spec/nim-completeness.json (the coverage block) — NOT argued here.",
    "`part_of`'s TARGET IS THE ANALYZER'S NORMALIZED MODULE NAME (`targetResolution: \"module-name\"`), NOT A PROJECT-RELATIVE PATH — fsharp and php emit paths, and a reader comparing two lanes' `part_of` cells must know that the two are resolved in DIFFERENT KEYSPACES. The divergence is RECORDED on every row and in the rulings page, never flattened.",
    "`implements` IS EMITTED (concept refinement: `concept x of B` and the `is` form) and is NOT a nominal-subtype edge: a Nim concept is satisfied by implicit structural dispatch, so no edge is invented for satisfaction. The 2026-10-15 exclusion audit corrected an earlier grammar-absence ruling on a measurement; the current declaration counts the emitted rows.",
    "`contains` CARRIES collRes BY CONSTRUCTION (members answer to the owner's name), and its resolved column has the same tie-break caveat as every other type — see the collRes caveat above.",
  ],
}
mkdirSync(path.dirname(OUT), { recursive: true })
if (WRITE) {
  writeFileSync(OUT, JSON.stringify(decl, null, 2) + "\n")
  console.log(`WROTE ${OUT}`)
}
console.log(`nim declaration — population ${POPSTR}`)
console.log(`  types ${Object.keys(gateTypes).length} · causeRulings ${Object.keys(causeRulings).length} · caveats ${decl.resolution_caveats.length}`)
for (const t of ["calls", "imports", "part_of", "contains", "implements", "decorates", "renders", "mixes_in"]) {
  const r = gateTypes[t]
  if (!r) { console.log(`  ${t.padEnd(12)} ABSENT FROM TABLE 1`); continue }
  console.log(`  ${t.padEnd(12)} edges ${String(r.edges).padStart(8)} resolved ${String(r.resolved).padStart(8)} amb ${String(r.ambiguous).padStart(7)} unres ${String(r.otherUnresolved).padStart(7)} ext ${String(r.external).padStart(6)} unclassed ${r.unclassed}${r.ruled ? `  RULED ${r.ruled}` : ""}`)
}
console.log(`  eleven-term closure re-checked on TOTAL: ${eleven(total!)} = ${total!.edges}`)
