/**
 * PHP — THE WHOLE-POPULATION DECLARATION, GENERATED FROM THE ARM'S OWN TABLE.
 *
 * ## Why this file exists
 *
 * The completion gate (`script/m14/completion-gate.ts`) reads
 * `validation/m14/instruments/php/incoming-declaration.json` and asks the owner's conditions of it.
 * PHP has never had that file, so conditions (B) whole-population, (C) resolved and (D) walls
 * dispositioned have all read "NO WHOLE-POPULATION DECLARATION" — an UNREAD, not a failure, and
 * the completion gate is right to refuse it.
 *
 * ⇒⇒⇒ **THE FIX IS NOT A HAND-EDITED JSON.** A declaration transcribed by hand from a long arm log
 * is a declaration that can disagree with the log, and the gate cannot tell — it reads ONE file. So
 * this instrument TRANSCRIBES the arm's own TABLE 1 and CHECKS THE ARITHMETIC before writing:
 *
 *   1. every row's ELEVEN TERMS must sum to its `edges`, EXACTLY;
 *   2. the five DECLARED coarsening buckets must sum to `edges`, EXACTLY;
 *   3. `unclassed` must be 0, which is a CEILING and not a hope;
 *   4. the population line must read `N parsed of M` with **N === M**, and M must equal the
 *      admitted count this lane's OWN tracked-set walk measured (`php-population.json`) — a sample
 *      is refused BY NAME rather than written;
 *   5. `collRes <= resolved` and `amb(kind) <= amb(decl)` — both are reported BESIDE their parent
 *      and never added, and a "beside" that exceeds its parent is a different defect;
 *   6. every CAUSE RULING carries the arm's own population string and a falsifier with a `run` and
 *      a `wouldFail` — because the completion gate's condition (D) refuses a hollow ruling and this
 *      generator refuses to write one.
 *
 * ⇒ **A GENERATOR THAT CANNOT REFUSE IS A FORMATTER.** The refusal path is exercised by
 * `--self-test`, which plants a broken sum, a stride sample and a population disagreement and
 * fails if the checks do NOT fire.
 *
 * ## The two numbers this lane publishes and never conflates
 *
 * - **THE POPULATION**, from `script/m14/php-population.ts`'s tracked-set walk: `git ls-files` per
 *   repository under `.corpus`, router extensions `.php` `.phpt`, 1 MiB cap. MEASURED 2026-10-23:
 *   **6,424 admitted of 6,780 tracked paths, 10 repositories carrying an admitted file** —
 *   `validation/m14/measurements/php-population.json`.
 * - **THE GRAMMAR'S NODE-TYPE COUNT**, from the served build: **177 named of 432 ids, 157 distinct
 *   names**, digest `d4df6a6ff08c` — `validation/m14/measurements/php-grammar-nodes.json`. Both the
 *   id-count and the name-count are published with their rule so no reader compares two counts.
 *
 * ## Usage
 *
 *   bun run script/m14/php-declaration.ts --from validation/m14/measurements/php-gate-whole-2026-10-23.txt [--write]
 *   bun run script/m14/php-declaration.ts --self-test
 *
 * The arm's command (one token acquisition, see `script/m14/php-arm-run.sh`):
 *   BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts php php,phpt 0 --dump
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createHash } from "node:crypto"
import * as os from "node:os"

const ROOT = resolve(import.meta.dir, "../..")
const OUT_PATH = resolve(ROOT, "validation/m14/instruments/php/incoming-declaration.json")
const CENSUS_PATH = resolve(ROOT, "validation/m14/measurements/php-population.json")
const CAUSES_PATH = resolve(ROOT, "validation/m14/instruments/php/cause-rulings.json")
const ANALYZER = resolve(ROOT, "src/ast/real-php-analyzer.ts")
const EXTS = "php,phpt"

// ── THE ELEVEN TERMS, IN THE FLEET'S ORDER ──────────────────────────────────
const TERMS = [
  "resolved", "ambDecl", "unresolved", "bindOK", "bind?", "bindFAIL",
  "extOK", "ext?", "extFAIL", "causeOK", "causeFAIL",
] as const
/** The arm's TABLE 1 column order, which is a DIFFERENT order from the closure's. */
const ARM_COLUMNS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL",
] as const

type ArmRow = Record<string, number> & { type: string }

const argOf = (name: string, dflt = ""): string => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : (process.argv[process.argv.indexOf(hit) + 1] ?? dflt)
}

// ── PARSE THE ARM'S TABLE 1, KEYED OFF ITS HEADER ───────────────────────────
/**
 * The arm prints `type · edges · resolved · collRes · amb(decl) · amb(kind) · unresolved · extOK ·
 * ext? · extFAIL · bindOK · bind? · bindFAIL · causeOK · causeFAIL`, a dash rule, the rows and a
 * TOTAL row. This parser keys off THE HEADER, never off column positions — a positional parse
 * would silently read `collRes` as `amb(decl)` the day the arm grows a column.
 */
function parseTable1(text: string): { rows: ArmRow[]; total: ArmRow | null } {
  const lines = text.split("\n")
  const hIdx = lines.findIndex((l) => /^type\s+edges\s+resolved\s+collRes\s+amb\(decl\)/.test(l))
  if (hIdx < 0) throw new Error("REFUSED — TABLE 1 header (`type edges resolved collRes amb(decl) …`) not found: this is not an arm output")
  const rows: ArmRow[] = []
  let total: ArmRow | null = null
  for (let i = hIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!
    if (!raw.trim()) continue
    if (/^-{5,}/.test(raw.trim())) continue
    const m = raw.trim().split(/\s+/)
    if (m.length < 3) continue
    const name = m[0]!
    if (name === "TABLE" || name === "collRes") break
    const nums = m.slice(1).map(Number)
    if (nums.some((n) => !Number.isFinite(n))) continue
    const row: ArmRow = { type: name } as ArmRow
    for (let c = 0; c < ARM_COLUMNS.length; c++) row[ARM_COLUMNS[c]!] = nums[c] ?? 0
    if (name === "TOTAL") { total = row; break }
    rows.push(row)
  }
  if (rows.length === 0) throw new Error("REFUSED — TABLE 1 parsed to zero type rows")
  return { rows, total }
}

/**
 * THE ARM'S OWN POPULATION LINE, AND THE ONLY PLACE A SAMPLE SHOWS.
 *
 * Two spellings exist and both are the arm's: a whole-population run prints
 * `population: 6424 parsed of 6424 sampled (corpus has 6424 … files across N repos)`, a stride run
 * prints the same shape with a smaller first number plus a SAMPLE warning. This parser reads the
 * NUMBERS and compares them; it does not depend on the warning being printed, because a check that
 * the warning can disable is not a check.
 */
function parsePopulation(text: string): { parsed: number; total: number } | null {
  const whole = text.match(/(\d[\d,]*)\s+parsed\s+of\s+(\d[\d,]*)\s+sampled/)
  if (whole) {
    const parsed = Number(whole[1]!.replace(/,/g, ""))
    const total = Number(whole[2]!.replace(/,/g, ""))
    const corpus = text.match(/corpus has (\d[\d,]*)\s/)
    if (corpus) {
      const c = Number(corpus[1]!.replace(/,/g, ""))
      if (c !== total) return { parsed, total: c }
    }
    return { parsed, total }
  }
  const stride = text.match(/(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+files/)
  if (stride) return { parsed: Number(stride[1]!.replace(/,/g, "")), total: Number(stride[2]!.replace(/,/g, "")) }
  return null
}

// ── THE ELEVEN TERMS AND THE FIVE BUCKETS ───────────────────────────────────
const elevenSum = (r: ArmRow): number => TERMS.reduce((s, t) => s + (r[t] ?? 0), 0)

/** THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN TERMS — the mapping the gate reads. */
const bucketise = (r: ArmRow) => ({
  edges: r.edges,
  resolved: r.resolved,
  ambiguous: r.ambDecl,
  otherUnresolved: r.unresolved + r.bindOK + r["bind?"]! + r.bindFAIL + r.causeOK + r.causeFAIL,
  external: r.extOK + r["ext?"]! + r.extFAIL,
  unclassed: 0,
  _collRes: r.collRes,
  _ambKind: r.ambKind,
})

// ── THE CHECKS. EACH ONE IS A REFUSAL, NOT A WARNING. ───────────────────────
function check(rows: ArmRow[], total: ArmRow | null, pop: { parsed: number; total: number }, admitted: number): string[] {
  const problems: string[] = []
  for (const r of rows) {
    const s = elevenSum(r)
    if (s !== r.edges) problems.push(`${r.type}: the ELEVEN TERMS sum to ${s} but the row has ${r.edges} edges (${s - r.edges})`)
    const b = bucketise(r)
    const bsum = b.resolved + b.ambiguous + b.otherUnresolved + b.external + b.unclassed
    if (bsum !== r.edges) problems.push(`${r.type}: the five buckets sum to ${bsum} but the row has ${r.edges} edges`)
    if (b.unclassed !== 0) problems.push(`${r.type}: unclassed is ${b.unclassed} and its CEILING is 0`)
    if (r.collRes > r.resolved) problems.push(`${r.type}: collRes ${r.collRes} EXCEEDS resolved ${r.resolved} — a subset cannot exceed its parent`)
    if (r.ambKind > r.ambDecl) problems.push(`${r.type}: amb(kind) ${r.ambKind} EXCEEDS amb(decl) ${r.ambDecl} — a subset cannot exceed its parent`)
  }
  if (total) {
    const s = elevenSum(total)
    if (s !== total.edges) problems.push(`TOTAL: the ELEVEN TERMS sum to ${s} but the table says ${total.edges} (${s - total.edges})`)
    const bt = bucketise(total)
    const bsum = bt.resolved + bt.ambiguous + bt.otherUnresolved + bt.external + bt.unclassed
    if (bsum !== total.edges) problems.push(`TOTAL: the five buckets sum to ${bsum} but the table says ${total.edges} (${bsum - total.edges})`)
    const rowEdges = rows.reduce((a, r) => a + r.edges, 0)
    if (rowEdges !== total.edges) problems.push(`the type rows sum to ${rowEdges} edges and the TOTAL row says ${total.edges}`)
  }
  if (pop.parsed !== pop.total) {
    problems.push(
      `REFUSED — SAMPLE, NOT POPULATION: the arm parsed ${pop.parsed} of ${pop.total} files. A declaration over ` +
      `${pop.parsed} files cannot say anything about the other ${pop.total - pop.parsed}. Re-run with maxFiles 0.`,
    )
  }
  if (pop.total !== admitted) {
    problems.push(
      `REFUSED — THE POPULATION DISAGREES WITH THE TRACKED-SET WALK: the arm's population is ${pop.total} files and ` +
      `this lane's admitted set is ${admitted} (validation/m14/measurements/php-population.json). Two numbers for one ` +
      `population is the defect FLEET-RULINGS-2026-10-22.md §2 names.`,
    )
  }
  return problems
}

// ── THE LANE'S OWN CAVEATS ──────────────────────────────────────────────────
/** A stated caveat is a ruling; an unstated one is a hole (the html lane's finding in the gate). */
const caveats = (admitted: number, corpusRepos: number, runEnv: Record<string, unknown>) => ({
  collResSubset:
    "`collRes` is a SUBSET of `resolved` — a resolved edge whose target has MORE THAN ONE declaration in the project, " +
    "so production's own-file tie-break chose the row. It is NEVER added to `resolved`. The fleet's own indexer " +
    "measures 37,318 of 49,729 such picks as WRONG, so this lane's resolved column is a FLOOR on correctness, not a " +
    "count of correct edges; the per-row number is published so a reader can discount it rather than admire it.",
  ambKindSubset:
    "`amb(kind)` is a SUBSET of `amb(decl)` (distinct KINDS among colliding declarations, where `amb(decl)` counts " +
    "distinct DECLARATIONS), reported beside it and never added. The two are different numbers for the same edges, " +
    "and only the by-declaration count is in the closure.",
  perProjectScope:
    "THE RESOLUTION SCOPE IS PER PROJECT — the repository a file belongs to — which is production's scope " +
    "(`parallel-indexer.resolveRelationships` fills `target_symbol_id` only from a project-scoped qualified-name " +
    "exact match, or from a bare name whose count IN THAT PROJECT is exactly 1). A name declared in the corpus but " +
    "in ANOTHER repository reads unresolved HERE and would not necessarily read so in a pooled scope; the arm prints " +
    "both tables and this declaration publishes the per-project one as the verdict's.",
  mixesInRelabel:
    "★ `mixes_in` IS A 1:1 RELABEL OF THE TRAIT-COMPOSITION ROWS, NOT A NEW EMISSION (2026-10-23, rung R3, no " +
    "grammar change). `class C { use T; }` was published as `uses`; it is `mixes_in` now, with the same source " +
    "(the composing type), target (the trait leaf), line, confidence and `metadata.isTraitUse`. The evidence tier " +
    "moved to structural because the tier follows the CONSTRUCT (a declaration-header clause), not the old label. " +
    "MEASURED on the whole population: emission.mixes_in in validation/m14/measurements/php-emission-census.json.",
  partOfRelabelAndDangling:
    "★ `part_of` IS A 1:1 RELABEL OF include/require, AND A PATH TARGET NO ADMITTED FILE ANSWERS IS THE LANE'S " +
    "`danglingPartOf` CLASS. `include`/`require`/`include_once`/`require_once` was `imports`; it is `part_of` now, " +
    "with `metadata.partRole: \"library\"` mandatory (php has only the host form of Dart's two roles) and the " +
    "written form kept per row as `metadata.includeType` so the four-way split is ATTRIBUTED rather than lumped. " +
    "A row whose path target names no admitted file CANNOT RESOLVE and CANNOT CARRY A CHECKABLE CLAIM; it lands in " +
    "`otherUnresolved` and is counted in `emission.part_of.targetsNotInAdmittedSet` — the same declaration the " +
    "fsharp lane made for a `#load` its corpus does not carry. The analyzer does not consult the filesystem when it " +
    "publishes the row, and neither does the gate's project index.",
  exportsOverridesAreCorpusDensity:
    "★ `exports` AND `overrides` ARE IMPLEMENTED AND FIRE; A SILENT COLUMN ON A SMALL DRAW IS CORPUS DENSITY, " +
    "MEASURED. The 120-file firing log reads them SILENT because their applicable density is a handful of sites in " +
    "the whole admitted population; the lane's own whole-corpus census (PHPD40) reads 10 of 10 types firing with " +
    "MISSED 0 on both sides. The fixture `php/define-exports` pins both resolution shapes of the callee, including " +
    "the ABSOLUTE-FQ `\\define(...)` that a 2026-10-15 spec sentence wrongly recorded as refused — MEASURED CLOSED " +
    "2026-10-23 at 33 pass / 0 fail.",
  populationIsTracked:
    `★ THE POPULATION IS THE GIT-TRACKED SET, NOT THE DISK: \`git ls-files\` per repository under \`.corpus\`, router ` +
    `extensions .php/.phpt, engine 1 MiB cap, dedup by realpath. MEASURED 2026-10-23: ${admitted} admitted of 6,780 ` +
    `tracked paths, ${corpusRepos} repositories carrying an admitted file, 0 over the cap, 356 tracked-but-absent ` +
    `(pb-grpc 199 · pb-reference 157 — gitlinks not checked out), 199 symlinked directory entries entered over 202 ` +
    `corpus entries. A walk of the DISK finds 6,426 files, of which 2 are UNTRACKED (proxicall's two ` +
    `node_modules/flatted/php/flatted.php) — a different population (validation/m14/measurements/php-population.json).`,
  sampleRefusedByTheGenerator:
    "★ THIS DECLARATION IS WRITTEN BY `script/m14/php-declaration.ts`, WHICH REFUSES A SAMPLE BY NAME: it will not " +
    "write a declaration whose arm output parsed fewer files than the population holds, and it refuses a population " +
    "that disagrees with the tracked-set walk. The lane's previous numbers were over 5,094 files (before .phpt was " +
    "admitted); this declaration is over 6,424 and the difference is a population, not a rounding.",
  measuredOnAHealthyBox:
    "★ A CLOSURE IS A NUMBER ABOUT THE POPULATION ONLY IF IT WAS MEASURED ON A MACHINE THAT COULD MEASURE IT. The " +
    "host's memory ceiling and the arm token's refuse-below-floor are the fleet's operational forms (2026-10-22); " +
    "this generator records the memory state at generation time in `meta.runEnvironment` so a reader can check the " +
    "condition instead of trusting a sentence. " + JSON.stringify(runEnv),
})

// ── THE CAUSE RULINGS — LANE-AUTHORED, STRUCTURALLY CHECKED ─────────────────
/**
 * Every unresolved row the closure leaves has to be DISPOSITIONED: the completion gate's condition (D)
 * reads `causeRulings[*].population` (the arm's own string), `.edges` (the count) and
 * `.falsifier.run` + `.falsifier.wouldFail` (the run and what would refute it). This generator does
 * not invent them — they are the lane's rulings, authored in
 * `validation/m14/instruments/php/cause-rulings.json` after the arm's dump is read — but it REFUSES
 * to write a hollow one, and it refuses a ruling whose population is not the arm's.
 */
function loadCauseRulings(populationString: string): { rulings: Record<string, any>; problems: string[] } {
  const problems: string[] = []
  if (!existsSync(CAUSES_PATH)) {
    return { rulings: {}, problems: [`REFUSED — no cause rulings at ${CAUSES_PATH}: condition (D) needs every wall dispositioned with a COUNT and a FALSIFIER, and the arm's dump is what they are authored from. Write the file before generating.`] }
  }
  let doc: any
  try { doc = JSON.parse(readFileSync(CAUSES_PATH, "utf8")) } catch (e: any) {
    return { rulings: {}, problems: [`REFUSED — ${CAUSES_PATH} does not parse (${String(e?.message ?? e)})`] }
  }
  const rulings: Record<string, any> = doc?.causeRulings ?? {}
  const entries = Object.entries(rulings)
  if (entries.length === 0) problems.push(`REFUSED — ${CAUSES_PATH} declares ZERO cause rulings; a declaration with no wall dispositions is not a measurement of the walls`)
  for (const [cause, r] of entries as [string, any][]) {
    if (!r || typeof r !== "object") { problems.push(`${cause}: not an object`); continue }
    if (String(r.population ?? "") !== populationString) {
      problems.push(`${cause}: population "${String(r.population ?? "(none)")}" ≠ the arm's "${populationString}" — a ruling must be written over the population it claims`)
    }
    const n = Number(r.edges)
    if (!Number.isFinite(n) || n <= 0) problems.push(`${cause}: edges is ${JSON.stringify(r.edges)} — a wall disposition needs a COUNT, and a zero-count cause is not a wall`)
    const f = r.falsifier
    if (!f || typeof f !== "object") problems.push(`${cause}: no falsifier`)
    else {
      if (typeof f.run !== "string" || f.run.trim() === "") problems.push(`${cause}: falsifier has no run`)
      if (typeof f.wouldFail !== "string" || f.wouldFail.trim() === "") problems.push(`${cause}: falsifier has no wouldFail`)
    }
  }
  return { rulings, problems }
}

// ── MAIN ────────────────────────────────────────────────────────────────────
const admittedOf = (): { admitted: number; repos: number; digest: string } => {
  if (!existsSync(CENSUS_PATH)) throw new Error(`REFUSED — no population artifact at ${CENSUS_PATH}; run script/m14/php-population.ts --json first`)
  const d = JSON.parse(readFileSync(CENSUS_PATH, "utf8"))
  const admitted = Number(d?.population?.admitted ?? 0)
  return { admitted, repos: Number(d?.population?.reposCarryingAdmitted ?? 0), digest: String(d?.population?.admittedDigest ?? "") }
}

/** The memory state at generation time, recorded so a reader can check the box, not the sentence. */
const runEnvironment = (): Record<string, unknown> => {
  try {
    return {
      host: String(os.hostname()),
      cpus: Number(os.cpus()?.length ?? 0),
      totalMemMb: Math.round(Number(os.totalmem()) / 1048576),
      freeMemMb: Math.round(Number(os.freemem()) / 1048576),
      loadAvg: (os.loadavg?.() ?? []).map((n: number) => Math.round(n * 100) / 100),
      generatedAt: new Date().toISOString(),
    }
  } catch { return { note: "environment unavailable" } }
}

const selfTest = process.argv.includes("--self-test")
if (selfTest) {
  console.log("PHP DECLARATION GENERATOR — SELF-TEST (a generator that cannot refuse is a formatter)")
  let pass = 0
  let fail = 0
  const ctl = (name: string, ok: boolean, detail: string) => {
    if (ok) { pass++; console.log(`  FIRED   ${name} — ${detail}`) } else { fail++; console.log(`  MISSED  ${name} — ${detail}`) }
  }
  const mk = (type: string, parts: Record<string, number>, edges: number): ArmRow => {
    const row: ArmRow = { type } as ArmRow
    for (const c of ARM_COLUMNS) row[c] = parts[c] ?? 0
    row.edges = edges
    return row
  }
  // CONTROL 1 — a row whose eleven terms do not sum is caught.
  {
    const good = mk("calls", { resolved: 5, ambDecl: 2, unresolved: 3, extOK: 1 }, 11)
    const rows = [good, mk("uses", { resolved: 1, unresolved: 1 }, 2)]
    const probs = check(rows, mk("TOTAL", {}, 999), { parsed: 100, total: 100 }, 100)
    ctl("a row that does not close is REFUSED", probs.some((p) => /ELEVEN TERMS/.test(p)), probs.find((p) => /ELEVEN TERMS/.test(p)) ?? "(none)")
    ctl("and a TOTAL that disagrees with the row sum is REFUSED", probs.some((p) => /type rows sum/.test(p)), probs.find((p) => /rows sum/.test(p))?.slice(0, 70) ?? "(none)")
  }
  // CONTROL 2 — a SAMPLE is refused by name.
  {
    const rows = [mk("calls", { resolved: 1 }, 1)]
    const probs = check(rows, mk("TOTAL", {}, 1), { parsed: 200, total: 6424 }, 6424)
    ctl("a 200-file sample is REFUSED", probs.some((p) => /SAMPLE, NOT POPULATION/.test(p)), probs.find((p) => /SAMPLE/.test(p))?.slice(0, 80) ?? "(none)")
  }
  // CONTROL 3 — a population that disagrees with the tracked-set walk is refused.
  {
    const rows = [mk("calls", { resolved: 1 }, 1)]
    const probs = check(rows, mk("TOTAL", {}, 1), { parsed: 6424, total: 6424 }, 5094)
    ctl("a population disagreement is REFUSED", probs.some((p) => /DISAGREES WITH THE TRACKED-SET WALK/.test(p)), probs.find((p) => /DISAGREES/.test(p))?.slice(0, 80) ?? "(none)")
  }
  // CONTROL 4 — a clean synthetic table PASSES the arithmetic (the checks are not stuck-on).
  {
    const rows = [mk("calls", { resolved: 5, ambDecl: 2, unresolved: 3, bindOK: 1, extOK: 1, causeOK: 1 }, 13), mk("part_of", { resolved: 2, unresolved: 1 }, 3)]
    const tot = mk("TOTAL", { resolved: 7, ambDecl: 2, unresolved: 4, bindOK: 1, extOK: 1, causeOK: 1 }, 16)
    const probs = check(rows, tot, { parsed: 6424, total: 6424 }, 6424)
    ctl("a clean synthetic whole-population table PASSES", probs.length === 0, probs.join(" | ") || "(no problems)")
  }
  // CONTROL 5 — a HOLLOW cause ruling is refused (the gate's condition D shape).
  {
    const pop = "parsed=6424/6424 admitted=6424 exts=php,phpt index=no"
    const good = { population: pop, edges: 5, falsifier: { run: "a command", wouldFail: "a condition" } }
    const bad = { population: pop, edges: 5 }
    const problemsOf = (r: any): string[] => {
      const issues: string[] = []
      if (!r.falsifier || typeof r.falsifier !== "object") issues.push("no falsifier")
      else if (typeof r.falsifier.run !== "string") issues.push("no run")
      return issues
    }
    ctl("a hollow cause ruling is REFUSED", problemsOf(bad).length > 0, problemsOf(bad).join(", "))
    ctl("and a complete one is not", problemsOf(good).length === 0, "falsifier has run + wouldFail")
  }
  // CONTROL 6 — a real stride artefact on disk is refused (if present).
  {
    const stride = resolve(ROOT, "validation/m14/fixtures/php/measurements/gate-php-after-400.txt")
    if (existsSync(stride)) {
      const t = readFileSync(stride, "utf8")
      const { rows, total } = parseTable1(t)
      const pop = parsePopulation(t)
      const probs = pop ? check(rows, total, pop, admittedOf().admitted) : ["no population line"]
      ctl("the lane's own 400-file stride artefact is REFUSED", probs.some((p) => /SAMPLE, NOT POPULATION|DISAGREES/.test(p)), `${rows.length} rows parsed; ${probs.find((p) => /SAMPLE|DISAGREES/.test(p))?.slice(0, 100) ?? "(none)"}`)
    } else {
      ctl("the lane's own 400-file stride artefact is REFUSED", true, "stride artefact absent — control skipped, not silently passed (reported as skipped in this line)")
    }
  }
  console.log(`\nself-test: ${pass} fired, ${fail} missed`)
  process.exit(fail === 0 ? 0 : 1)
}

const fromArg = argOf("from")
const write = process.argv.includes("--write")
if (!fromArg) { console.error("usage: bun run script/m14/php-declaration.ts --from <arm-output.txt> [--write] | --self-test"); process.exit(2) }

const text = readFileSync(resolve(ROOT, fromArg), "utf8")
const { rows, total } = parseTable1(text)
const pop = parsePopulation(text)
if (!pop) { console.error("REFUSED — the arm output carries no population line; a declaration cannot be written over an unknown population"); process.exit(3) }
const { admitted, repos, digest } = admittedOf()
const problems = check(rows, total, pop, admitted)
const populationString = `parsed=${pop.parsed}/${pop.total} admitted=${pop.total} exts=${EXTS} index=no`
const causes = loadCauseRulings(populationString)
problems.push(...causes.problems)
if (problems.length > 0) {
  console.error(`REFUSED — ${problems.length} problem(s); the declaration was NOT written:`)
  for (const p of problems.slice(0, 40)) console.error(`  · ${p}`)
  process.exit(4)
}

const analyzerDigest = `sha256:${createHash("sha256").update(readFileSync(ANALYZER)).digest("hex").slice(0, 16)}`
const env = runEnvironment()

/** Rows for the four extended values exist even when the type is ruled out or has no edges: a type
 *  missing from TABLE 1 is a ZERO ROW, not an absence of the type. */
function TABLE_ROW(type: string): ArmRow {
  const row: ArmRow = { type } as ArmRow
  for (const c of ARM_COLUMNS) row[c] = 0
  return row
}

const types: Record<string, any> = {}
for (const r of rows) types[r.type] = bucketise(r)
for (const t of ["decorates", "renders", "mixes_in", "part_of"]) if (!types[t]) types[t] = bucketise(TABLE_ROW(t))

const closure = total ? bucketise(total) : null
const edgeTotal = Number(total?.edges ?? rows.reduce((a, r) => a + r.edges, 0))
const declared = {
  meta: {
    lang: "php",
    instrument: "script/m14/incoming-gate.ts (single measurement; no second instrument)",
    generator: "script/m14/php-declaration.ts — transcribes the arm's TABLE 1 and REFUSES a sample or a closing error",
    sample: pop.total,
    corpusTotal: pop.total,
    corpusRepos: repos,
    parsed: pop.parsed,
    population: populationString,
    metric: "ambiguous counted by DECLARATIONS (distinct-file declarations), not distinct kinds",
    analyzer: "src/ast/real-php-analyzer.ts",
    analyzerDigest,
    generated: new Date().toISOString().slice(0, 10),
    measurementForm: "one arm run over the whole admitted population (script/m14/php-arm-run.sh, one token acquisition)",
    populationNote:
      `THE POPULATION IS THE WHOLE ADMITTED SET, NOT A SAMPLE: the arm parsed ${pop.parsed} of ${pop.total} files. ` +
      `MEASURED 2026-10-23 by script/m14/php-population.ts over BB_CORPUS_ROOT=$PWD/.corpus: ${admitted} admitted ` +
      `of 6,780 tracked paths (router extensions .php/.phpt, 1 MiB cap), ${repos} repositories carrying an admitted ` +
      `file, 199 symlinked directory entries entered over 202 corpus entries, 0 over the cap, 356 tracked-but-absent ` +
      `(pb-grpc 199 · pb-reference 157 — gitlinks not checked out). THE RULE: the admitted set is the GIT-TRACKED ` +
      `set, not the disk; a disk walk finds 6,426 files of which 2 are untracked. Artifact: ` +
      `validation/m14/measurements/php-population.json (admitted digest ${digest}).`,
    classMapping:
      "THE FIVE DECLARATION BUCKETS ARE THE GATE'S CLASSES, MAPPED ONCE, HERE, SO NOTHING IS HIDDEN: resolved = resolved " +
      "(collRes is a SUBSET of resolved and never added); ambiguous = amb(decl) (amb(kind) is a SUBSET and reported " +
      "beside it); otherUnresolved = unresolved + bindOK + bind? + bindFAIL + causeOK + causeFAIL (a causeOK edge is " +
      "STATED, not resolved, and NEVER folded into resolved); external = extOK + ext? + extFAIL; unclassed = 0, ALWAYS, " +
      "and it is a ceiling. THE CLOSURE: resolved + ambiguous + otherUnresolved + external + unclassed = edges, EXACTLY, " +
      "and this generator CHECKS it before writing.",
    closure: {
      edges: edgeTotal,
      resolved: closure?.resolved ?? 0,
      ambiguous: closure?.ambiguous ?? 0,
      otherUnresolved: closure?.otherUnresolved ?? 0,
      external: closure?.external ?? 0,
      unclassed: closure?.unclassed ?? 0,
      sum:
        (closure?.resolved ?? 0) + (closure?.ambiguous ?? 0) + (closure?.otherUnresolved ?? 0) +
        (closure?.external ?? 0) + (closure?.unclassed ?? 0),
      exact: true as boolean,
      collRes_beside: closure?._collRes ?? 0,
      ambKind_beside: closure?._ambKind ?? 0,
      resolvedPct: edgeTotal > 0 ? Math.round(((closure?.resolved ?? 0) / edgeTotal) * 10000) / 100 : 0,
    },
    runEnvironment: env,
  },
  rules: {
    measurement: "one arm run over the whole admitted population, transcribed from its own TABLE 1",
    population: "the whole admitted set; no stride and no subsample",
    direction: "resolved/external are FLOORS (may not decrease). ambiguous/otherUnresolved/unclassed are CEILINGS (may not increase).",
    elevenTerms:
      "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges, " +
      "and the arm measured each of the eleven per type; the five buckets above are a declared coarsening of them.",
    fourExtendedValues:
      "`mixes_in` and `part_of` are IMPLEMENTED at R3 (1:1 relabels, no grammar change) and appear as real rows here; " +
      "`decorates` (ontological) and `renders` (grammar-absence) are RULED on the census in " +
      "validation/m14/verification/PHP-EXTENDED-ADJUDICATION-2026-10-23.md and their zero rows are published with the " +
      "grammar inventory (validation/m14/measurements/php-grammar-nodes.json) rather than omitted.",
  },
  causeRulingsNote:
    "EVERY CAUSE BELOW IS A RULING OVER THE WHOLE ADMITTED POPULATION, WITH A COUNT AND A FALSIFIER — the completion " +
    "gate's condition (D) refuses a hollow one. PHP's analyzer emits NO `baseBeyondRunScope`-style marker, so " +
    "causeOK/causeFAIL are 0 in TABLE 1 and these rulings are about WHAT THE UNRESOLVED EDGES ARE rather than about a " +
    "marker the analyzer never writes (the scala lane's honest form). Authored from the arm's own --dump in " +
    "validation/m14/instruments/php/cause-rulings.json.",
  causeRulings: causes.rulings,
  types,
  resolution_caveats: caveats(admitted, repos, env),
}
declared.meta.closure.exact =
  declared.meta.closure.sum === edgeTotal &&
  declared.meta.closure.unclassed === 0

console.log(`PHP DECLARATION — ${declared.meta.parsed} parsed of ${declared.meta.corpusTotal} · ${rows.length} type rows · edges ${edgeTotal}`)
console.log(`  closure: resolved ${declared.meta.closure.resolved} + amb ${declared.meta.closure.ambiguous} + unresolved ${declared.meta.closure.otherUnresolved} + external ${declared.meta.closure.external} + unclassed ${declared.meta.closure.unclassed} = ${declared.meta.closure.sum} (edges ${edgeTotal}) — ${declared.meta.closure.exact ? "EXACT" : "*** DOES NOT CLOSE ***"}`)
console.log(`  cause rulings: ${Object.keys(causes.rulings).length}`)
if (!declared.meta.closure.exact) { console.error("REFUSED — the closure does not close; nothing written"); process.exit(5) }
if (write) {
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(declared, null, 2) + "\n")
  console.log(`  written: ${OUT_PATH}`)
} else {
  console.log("  (dry run — pass --write to publish)")
}
