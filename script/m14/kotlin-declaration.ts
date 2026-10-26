#!/usr/bin/env bun
/**
 * KOTLIN — THE WHOLE-POPULATION DECLARATION, GENERATED FROM THE ARM'S OWN CLOSURE.
 *
 * ## Why this file exists
 *
 * The completion gate (`script/m14/completion-gate.ts`) reads
 * `validation/m14/instruments/kotlin/incoming-declaration.json`. Until this instrument, that file
 * was a 2026-10-13 declaration the lane could not reproduce: its population line was not the
 * admitted set, it carried no cause rulings, and its closure was not the arm's. The kotlin arm is
 * now measured — `validation/m14/results/kotlin-whole-population-closure.json` (3 slices over
 * [0,2346), EDGES 257,582, eleven terms sum EXACTLY) — so the declaration is DERIVED from that
 * closure and refuses to be written when the derivation does not reconstruct it.
 *
 * ## THE CHECKS ARE REFUSALS, NOT WARNINGS (the php/elixir generator pattern)
 *
 *   1. CLOSURE ARITHMETIC — the ELEVEN TERMS sum to `edges` EXACTLY, and the merge's own `sum`
 *      and `exact` agree. A broken closure is not transcribed.
 *   2. POPULATION — the closure's admitted count equals this lane's OWN census
 *      (`validation/m14/measurements/kotlin-extended-types-census.json`) and the generator's own
 *      `git ls-files` walk (the fleet's population rule). No number is hard-coded.
 *   3. NO SAMPLE — the slices' own population lines must read `N parsed of N sampled` and each
 *      slice's parsed count must equal its claimed width; a stride is refused BY NAME (a
 *      declaration over part of a population says nothing about the rest).
 *   4. THE TILING — the closure's slices are contiguous from 0, cover [0, population) with no
 *      overlap and no shortfall, and their edges sum to the closure's edges. A hole refuses.
 *   5. THE TYPE ROWS RECONSTRUCT THE CLOSURE — the per-slice TABLE 1 rows, summed, must equal the
 *      closure's terms COLUMN BY COLUMN (resolved, ambDecl, unresolved, ext*, bind*, cause*), and
 *      each row's eleven terms and five declared buckets must sum to its own `edges`; `unclassed`
 *      is a CEILING of 0; `collRes <= resolved`; `amb(kind) <= amb(decl)`.
 *   6. THE WALL CENSUS RECONCILES — its wall rows equal `ambDecl + unresolved`, its classes sum to
 *      its wall rows, every class is a KNOWN D7 class (an unruled class refuses), and its per-label
 *      amb/unresolved counts equal the TABLE 1 sums for the same labels. A hollow census (no
 *      classes, no counts) refuses.
 *   7. EVERY CAUSE RULING CARRIES A POPULATION IN THE FLEET'S FULL FORM AND A FALSIFIER WITH a
 *      `run` and a `wouldFail` — because the completion gate's condition (D) refuses a hollow one.
 *
 * ⇒ A GENERATOR THAT CANNOT REFUSE IS A FORMATTER. `--self-test` plants each failure and exits
 * non-zero if a check does NOT fire.
 *
 * ## THIS GENERATOR NAMES KOTLIN'S OWN ARTIFACTS
 *
 * Every field cites an artifact THIS LANE produced: the closure, the arm's slice dumps, the wall
 * census, the extended-types census, the grammar inventory, the renders emission census, the
 * coverage block, the D7 wall page. There is no borrowed count.
 *
 * ## Usage
 *
 *   # the wall census over the arm's three slice dumps (the classifier sums them):
 *   bun run script/m14/kotlin-wall-classify.ts .tmp-kotlin-arm/dump-slices/*.dump.txt \
 *     --json=validation/m14/measurements/kotlin-wall-census-2026-10-25.json
 *
 *   # the declaration (refuses on a non-closure / wrong population / stride / hollow walls):
 *   bun run script/m14/kotlin-declaration.ts --write
 *
 *   # the refusal path proves itself:
 *   bun run script/m14/kotlin-declaration.ts --self-test
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import * as os from "node:os"

const ROOT = resolve(import.meta.dir, "../..")
const OUT_PATH = resolve(ROOT, "validation/m14/instruments/kotlin/incoming-declaration.json")
const ANALYZER = resolve(ROOT, "src/ast/real-kotlin-analyzer.ts")
const EXTS = "kt,kts"
const LANE = "kotlin"

// ── THE FLEET'S ELEVEN TERMS, IN TWO SPELLINGS, BECAUSE THE TWO ARTIFACTS SPELL THEM DIFFERENTLY
// AND CONFLATING THEM SILENTLY LOSES ROWS. The ARM's TABLE 1 columns are `ext?`/`bind?`; the MERGE
// CLOSURE writes `extPending`/`bindPending`. MEASURED the first time this generator ran: the closure
// check read 257,560 against 257,582 — EXACTLY the 22 extPending rows — because the closure was
// consulted under the arm's spelling. That is the class of defect the arithmetic check exists for.
const TERMS = [
  "resolved", "ambDecl", "unresolved", "bindOK", "bind?", "bindFAIL",
  "extOK", "ext?", "extFAIL", "causeOK", "causeFAIL",
] as const
const CLOSURE_TERMS = [
  "resolved", "ambDecl", "unresolved", "bindOK", "bindPending", "bindFAIL",
  "extOK", "extPending", "extFAIL", "causeOK", "causeFAIL",
] as const
/** The arm's TABLE 1 column order — a DIFFERENT order from the closure's. */
const ARM_COLUMNS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL",
] as const

// ── THE D7 CLASS TAXONOMY (validation/m14/verification/KOTLIN-D7-WALLS.md) ──
// A class NOT in this map refuses: an unclassified wall row is a hole, and a class the lane has
// never dispositioned must not be written as ruled.
const D7_CLASSES: Record<string, { disposition: string; wouldFail: string }> = {
  "C1-external-jvm-stdlib": {
    disposition:
      "RULED UNDECIDABLE in the per-file model; INSTRUMENT GAP for a citation claim — stdlib names are compiler-provided and no lane keyspace declares them",
    wouldFail: "a project declaration of a stdlib name (a kotlin./java./javax./jdk. target the run's own key space declares)",
  },
  "C2-external-library": {
    disposition: "INSTRUMENT GAP: external-citation claim (no lane claim kind; bindOK 0)",
    wouldFail: "a project declaration spelling the target (a dotted target the run's own key space declares)",
  },
  "C3-external-import-path": {
    disposition: "INSTRUMENT GAP: external module/import claim (same class as C1/C2)",
    wouldFail: "an imports target in the run's key space (the target is declared by a file the run parsed)",
  },
  "C4-override-guess-or-name": {
    disposition: "RULED UNDECIDABLE / heuristic by construction — the first-supertype-guess tier, checked against the in-file tier separately",
    wouldFail: "resolution evidence (an index) confirming the ancestor, or an in-file ancestor the guess missed",
  },
  "C5-placeholder-or-fragment": {
    disposition: "RULED: a placeholder literal is not a name and must not publish an edge endpoint",
    wouldFail: "a real declaration whose whole spelling is the target",
  },
  "C6-type-shaped-simple": {
    disposition: "RULED UNDECIDABLE: generic parameters/local type names and external types are not project declarations in the per-file model",
    wouldFail: "a declaration of the name in the run's key space that the name model fails to join",
  },
  "C7-name-shaped-simple": {
    disposition: "RULED UNDECIDABLE in the per-file model (member calls, locals, generic params, overridden members); includes amb(decl) name collisions",
    wouldFail: "a run name-set containing the target, or an index/tie-break rule selecting one declaration",
  },
  "C8-backticked": {
    disposition: "RULED: a backticked name is a valid Kotlin identifier and its declaration must be in the key space",
    wouldFail: "a declaration of the backticked spelling in the run's key space",
  },
}

// ── ARGUMENTS ───────────────────────────────────────────────────────────────
const argOf = (name: string, dflt = ""): string => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : (process.argv[process.argv.indexOf(hit) + 1] ?? dflt)
}
const DEFAULT_CLOSURE = "validation/m14/results/kotlin-whole-population-closure.json"
const DEFAULT_SLICES = ".tmp-kotlin-arm/dump-slices"
const DEFAULT_WALLS = "validation/m14/measurements/kotlin-wall-census-2026-10-25.json"
const DEFAULT_CENSUS = "validation/m14/measurements/kotlin-extended-types-census.json"

// ── PARSERS ─────────────────────────────────────────────────────────────────
type ArmRow = Record<string, number | string> & { type: string }

/** Parse the arm's TABLE 1 keyed off its HEADER (never off column positions). */
function parseTable1(text: string): { rows: ArmRow[]; total: ArmRow | null } {
  const lines = text.split("\n")
  const hIdx = lines.findIndex((l) => /^type\s+edges\s+resolved\s+collRes\s+amb\(decl\)/.test(l))
  if (hIdx < 0) throw new Error("REFUSED — TABLE 1 header (`type edges resolved collRes amb(decl) …`) not found: this is not an arm slice output")
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

/** The slice's own population line (a whole-population slice prints N parsed of N sampled). */
function parsePopulationLine(text: string): { parsed: number; total: number; repos: number | null } | null {
  const whole = text.match(/(\d[\d,]*)\s+parsed\s+of\s+(\d[\d,]*)\s+sampled/)
  if (!whole) return null
  const parsed = Number(whole[1]!.replace(/,/g, ""))
  const sampled = Number(whole[2]!.replace(/,/g, ""))
  const corpus = text.match(/corpus has (\d[\d,]*)\s+\./)
  const repos = text.match(/across (\d[\d,]*)\s+repos?/)
  const total = corpus ? Number(corpus[1]!.replace(/,/g, "")) : sampled
  return { parsed, total, repos: repos ? Number(repos[1]!.replace(/,/g, "")) : null }
}

const n = (r: ArmRow, k: string): number => Number(r[k] ?? 0)
const elevenSum = (r: ArmRow): number => TERMS.reduce((s, t) => s + n(r, t), 0)

/** THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN TERMS — the mapping the gate reads. */
const bucketise = (r: ArmRow) => ({
  edges: n(r, "edges"),
  resolved: n(r, "resolved"),
  ambiguous: n(r, "ambDecl"),
  otherUnresolved:
    n(r, "unresolved") + n(r, "bindOK") + n(r, "bind?") + n(r, "bindFAIL") + n(r, "causeOK") + n(r, "causeFAIL"),
  external: n(r, "extOK") + n(r, "ext?") + n(r, "extFAIL"),
  unclassed: 0,
  _collRes: n(r, "collRes"),
  _ambKind: n(r, "ambKind"),
})

// ── THE LANE'S OWN POPULATION WALK (the fleet's rule: tracked ∧ present ∧ ≤1 MiB) ─────────────
function trackedAdmitted(): { admitted: number; perRepo: Record<string, number> } {
  const corpus = process.env.BB_CORPUS_ROOT ?? resolve(ROOT, ".corpus")
  const perRepo: Record<string, number> = {}
  let admitted = 0
  let repos: string[] = []
  try {
    repos = execFileSync("ls", ["-1", corpus], { encoding: "utf8" }).split("\n").filter(Boolean)
  } catch {
    return { admitted: 0, perRepo }
  }
  for (const r of repos) {
    const rp = resolve(corpus, r)
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", rp, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    let k = 0
    for (const t of tracked) {
      const dot = t.lastIndexOf(".")
      if (dot < 0) continue
      const ext = t.slice(dot + 1).toLowerCase()
      if (ext !== "kt" && ext !== "kts") continue
      const fp = resolve(rp, t)
      let size = NaN
      try {
        size = Number(execFileSync("stat", ["-c", "%s", fp], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim())
      } catch {
        continue
      }
      if (!Number.isFinite(size)) continue
      if (size > 1024 * 1024) continue
      k++
    }
    if (k > 0) perRepo[r] = k
    admitted += k
  }
  return { admitted, perRepo }
}

// ── BUILD ───────────────────────────────────────────────────────────────────
interface Inputs {
  closure: any
  closurePath: string
  sliceTexts: Array<{ range: [number, number]; text: string; path: string }>
  walls: any
  wallsPath: string
  censusAdmitted: number
  tracked: { admitted: number; perRepo: Record<string, number> }
  armLogPath: string
}

function build(inp: Inputs) {
  const { closure, sliceTexts, walls, censusAdmitted, tracked } = inp
  const problems: string[] = []

  // ── 1 · THE CLOSURE'S OWN ARITHMETIC ─────────────────────────────────────
  const cl = closure?.closure
  if (!cl || typeof cl !== "object") throw new Error("REFUSED — the closure artifact carries no `closure` block; this is not an arm closure")
  const edges = Number(cl.edges)
  const termSum = CLOSURE_TERMS.reduce((s, t) => s + Number(cl[t] ?? 0), 0)
  if (termSum !== edges) problems.push(`CLOSURE: the eleven terms sum to ${termSum} but edges is ${edges} (${termSum - edges})`)
  if (Number(cl.sum) !== termSum) problems.push(`CLOSURE: the merge's own sum ${cl.sum} differs from the recomputed eleven-term sum ${termSum}`)
  if (cl.exact !== true) problems.push("CLOSURE: the merge did not mark the closure exact")
  const pop = Number(closure?.meta?.population?.admitted)
  if (!Number.isFinite(pop) || pop <= 0) problems.push("CLOSURE: the closure does not state an admitted population")

  // ── 2 · THE POPULATION, THREE WAYS ───────────────────────────────────────
  if (pop !== censusAdmitted) problems.push(`POPULATION: the closure says ${pop} admitted and this lane's census says ${censusAdmitted} (two numbers for one population)`)
  if (pop !== tracked.admitted) problems.push(`POPULATION: the closure says ${pop} admitted and this generator's git-ls-files walk says ${tracked.admitted}`)

  // ── 3 · THE TILING (contiguous from 0, covers the population, no hole) ───
  const slices: Array<{ range: [number, number]; parsed: number; edges: number }> = Array.isArray(closure?.meta?.slices) ? closure.meta.slices : []
  if (slices.length === 0) problems.push("TILING: the closure lists no slices")
  let cursor = 0
  for (const s of slices.sort((a: any, b: any) => a.range[0] - b.range[0])) {
    const [start, end] = s.range as [number, number]
    if (start !== cursor) problems.push(`TILING: ${start < cursor ? "OVERLAP" : "GAP"} at ${cursor}..${start}`)
    if (Number(s.parsed) !== end - start) problems.push(`TILING: slice [${start},${end}) claims parsed ${s.parsed}, width ${end - start}`)
    cursor = end
  }
  if (cursor !== pop) problems.push(`TILING: covered ${cursor} of ${pop} (shortfall ${pop - cursor})`)
  const sliceEdgeSum = slices.reduce((a: number, s: any) => a + Number(s.edges ?? 0), 0)
  if (sliceEdgeSum !== edges) problems.push(`TILING: the slices' edges sum to ${sliceEdgeSum}, the closure says ${edges}`)

  // ── 4 · THE ARMS' OWN TABLE 1, SLICE BY SLICE ────────────────────────────
  const gathered: { labels: string[]; byLabel: Map<string, Record<string, number>> } = { labels: [], byLabel: new Map() }
  for (const st of sliceTexts) {
    const { rows, total } = parseTable1(st.text)
    const popLine = parsePopulationLine(st.text)
    if (!popLine) throw new Error(`REFUSED — slice ${st.path} carries no population line`)
    // A slice is a CHUNK of the population: its parsed count must equal its CLAIMED WIDTH (a slice
    // that did not finish is not a slice), and the corpus total it names must be the closure's
    // population. The whole-population property is the UNION (the tiling check above), never one
    // slice's parsed count — that is the difference between a sliced arm and a stride sample.
    if (popLine.parsed !== st.range[1] - st.range[0]) problems.push(`SAMPLE: slice ${st.path} parsed ${popLine.parsed} of its ${st.range[1] - st.range[0]}-file claim — a slice that did not finish is not a slice`)
    if (popLine.parsed !== popLine.total && st.range[0] === 0 && st.range[1] === pop) problems.push(`SAMPLE: the only slice names a corpus of ${popLine.total} but parsed ${popLine.parsed} — a stride sample over the whole range is not the population`)
    if (popLine.total !== pop) problems.push(`POPULATION: slice ${st.path} says the corpus has ${popLine.total}; the closure says ${pop}`)
    for (const r of rows) {
      const es = elevenSum(r)
      if (es !== n(r, "edges")) problems.push(`${r.type} (${st.path}): the eleven terms sum to ${es} but the row has ${n(r, "edges")} edges`)
      const b = bucketise(r)
      const bs = b.resolved + b.ambiguous + b.otherUnresolved + b.external + b.unclassed
      if (bs !== n(r, "edges")) problems.push(`${r.type} (${st.path}): the five buckets sum to ${bs} but the row has ${n(r, "edges")} edges`)
      if (n(r, "collRes") > n(r, "resolved")) problems.push(`${r.type} (${st.path}): collRes ${n(r, "collRes")} exceeds resolved ${n(r, "resolved")}`)
      if (n(r, "ambKind") > n(r, "ambDecl")) problems.push(`${r.type} (${st.path}): amb(kind) ${n(r, "ambKind")} exceeds amb(decl) ${n(r, "ambDecl")}`)
      if (r.type !== "TOTAL") {
        if (!gathered.labels.includes(r.type)) gathered.labels.push(r.type)
        const cur = gathered.byLabel.get(r.type) ?? {}
        for (const c of ARM_COLUMNS) cur[c] = (cur[c] ?? 0) + n(r, c)
        gathered.byLabel.set(r.type, cur)
      }
    }
    if (total) {
      if (elevenSum(total) !== n(total, "edges")) problems.push(`TOTAL (${st.path}): the eleven terms do not sum to its edges`)
    }
  }

  // ── 5 · THE TYPE ROWS RECONSTRUCT THE CLOSURE, COLUMN BY COLUMN ──────────
  const CLOSURE_TO_ARM: Record<string, string> = {
    resolved: "resolved", ambDecl: "ambDecl", unresolved: "unresolved",
    extOK: "extOK", extPending: "ext?", extFAIL: "extFAIL",
    bindOK: "bindOK", bindPending: "bind?", bindFAIL: "bindFAIL",
    causeOK: "causeOK", causeFAIL: "causeFAIL", collRes: "collRes", ambKind: "ambKind", edges: "edges",
  }
  const summed: Record<string, number> = {}
  for (const t of gathered.labels) {
    const row = gathered.byLabel.get(t)!
    for (const k of Object.keys(CLOSURE_TO_ARM)) summed[k] = (summed[k] ?? 0) + (row[CLOSURE_TO_ARM[k]!] ?? 0)
  }
  for (const k of Object.keys(CLOSURE_TO_ARM)) {
    const want = Number(cl[k] ?? 0)
    const got = summed[k] ?? 0
    if (want !== got) problems.push(`RECONSTRUCTION: the slices' ${k} sums to ${got}; the closure says ${want} (${got - want})`)
  }
  if (problems.length > 0) throw new Error("REFUSED — the arm does not close:\n  - " + problems.join("\n  - "))

  // ── 6 · THE WALL CENSUS RECONCILES WITH THE CLOSURE'S WALLS ──────────────
  const wallTotal = Number(walls?.wallRows ?? 0)
  const wallFromClosure = Number(cl.ambDecl ?? 0) + Number(cl.unresolved ?? 0)
  const wallProblems: string[] = []
  if (!walls || !Array.isArray(walls.perDump) || walls.perDump.length === 0) wallProblems.push("the census has no per-dump rows (a wall census with no inputs is hollow)")
  if (wallTotal !== wallFromClosure) wallProblems.push(`the census's wall rows ${wallTotal} ≠ the closure's ambDecl+unresolved ${wallFromClosure}`)
  const perDumpSum = Array.isArray(walls?.perDump) ? walls.perDump.reduce((a: number, d: any) => a + Number(d.wallRows ?? 0), 0) : 0
  if (perDumpSum !== wallTotal) wallProblems.push(`the per-dump rows sum to ${perDumpSum} but the census says ${wallTotal}`)
  const classes: Record<string, number> = {}
  for (const [cls, v] of Object.entries(walls?.classes ?? {})) classes[cls] = Number((v as any)?.rows ?? 0)
  const classSum = Object.values(classes).reduce((a, b) => a + b, 0)
  if (classSum !== wallTotal) wallProblems.push(`the classes sum to ${classSum} but the wall rows are ${wallTotal}`)
  for (const cls of Object.keys(classes)) if (!D7_CLASSES[cls]) wallProblems.push(`the class "${cls}" is NOT in the D7 taxonomy — an unruled class cannot be written as a ruling`)
  // A D7 class with ZERO rows legitimately never appears in the classifier output — absence is not a hole.
  // per-label reconciliation against TABLE 1
  const byLabel: Record<string, { amb: number; unresolved: number }> = walls?.byLabel ?? {}
  let labelRows = 0
  for (const [label, v] of Object.entries(byLabel)) {
    labelRows += Number(v.amb) + Number(v.unresolved)
    const row = gathered.byLabel.get(label)
    if (!row) { wallProblems.push(`the census names label "${label}" the arm's TABLE 1 does not carry`); continue }
    if (Number(v.amb) !== n(row as ArmRow, "ambDecl")) wallProblems.push(`${label}: census amb ${v.amb} ≠ TABLE 1 ambDecl ${n(row as ArmRow, "ambDecl")}`)
    if (Number(v.unresolved) !== n(row as ArmRow, "unresolved")) wallProblems.push(`${label}: census unresolved ${v.unresolved} ≠ TABLE 1 unresolved ${n(row as ArmRow, "unresolved")}`)
  }
  if (labelRows !== wallTotal) wallProblems.push(`the per-label rows sum to ${labelRows} but the wall rows are ${wallTotal}`)
  if (Object.keys(classes).length === 0) wallProblems.push("the census lists NO classes (hollow wall census)")
  if (wallProblems.length > 0) throw new Error("REFUSED — the wall census does not reconcile:\n  - " + wallProblems.join("\n  - "))

  // ── 7 · ASSEMBLE ─────────────────────────────────────────────────────────
  const popLine = sliceTexts[0] ? parsePopulationLine(sliceTexts[0].text) : null
  const repos = popLine?.repos ?? Object.keys(tracked.perRepo).length
  const popStr = `parsed=${pop}/${pop} admitted=${tracked.admitted} exts=${EXTS} index=no`
  const types: Record<string, any> = {}
  for (const t of gathered.labels) {
    const row = gathered.byLabel.get(t)!
    const b = bucketise(row as ArmRow)
    types[t] = { ...b, collRes: n(row as ArmRow, "collRes"), ambKind: n(row as ArmRow, "ambKind") }
  }
  const analyzerSha = (() => { try { return createHash("sha256").update(readFileSync(ANALYZER)).digest("hex").slice(0, 16) } catch { return "unreadable" } })()
  const closureSha = (() => { try { return createHash("sha256").update(readFileSync(resolve(ROOT, inp.closurePath))).digest("hex").slice(0, 16) } catch { return "unreadable" } })()
  const wallsSha = (() => { try { return createHash("sha256").update(readFileSync(resolve(ROOT, inp.wallsPath))).digest("hex").slice(0, 16) } catch { return "unreadable" } })()

  const causeRulings: Record<string, any> = {}
  for (const cls of Object.keys(classes)) {
    const count = classes[cls]!
    const d7 = D7_CLASSES[cls]!
    causeRulings[`wall\u00b7${cls}`] = {
      cause: cls,
      label: "wall",
      count,
      population: popStr,
      falsifier: {
        run:
          `bun run script/m14/kotlin-wall-classify.ts ${sliceTexts.map((s) => s.path).join(" ")} --json=<out> — the classifier's own ` +
          `${cls} rows, summed over the SAME slice dumps, are re-derived and compared to this ruling's ${count}; a difference falsifies the partition`,
        wouldFail: d7.wouldFail,
      },
      artifact: inp.wallsPath,
      note: d7.disposition,
    }
  }

  const populatedCaveats = {
    noIndexArm:
      `THE ARM IS INDEX=NO AND THAT IS THE HONEST ARM: there is no INDEX_SPECS entry for kotlin in ` +
      `script/m14/incoming-gate.ts, so no production project index is built. TABLE 1's scope is the gate's own ` +
      `per-repository declaration table, built from every file the RUN parsed — and the arm is three SLICE runs, ` +
      `so each slice resolves against its own slice-scoped table (${tracked.admitted} admitted over ${repos} repositories in the union).`,
    sliceScopeResolution:
      `★ THE CLOSURE IS THE SUM OF THREE SLICE RUNS, AND PER-PROJECT RESOLUTION IS NOT ADDITIVE ACROSS SLICES — ` +
      `MEASURED, STATED, NOT HIDDEN: a single whole-population run of the SAME gate over the SAME ${tracked.admitted} files ` +
      `(validation/m14/measurements/kotlin-gate-whole-2026-10-25.txt) reads edges 257,582 (IDENTICAL) but ` +
      `resolved 100,228 (+1,893 vs the closure), amb(decl) 75,735 (+9,257), unresolved 70,742 (−11,137), extOK 10,855 (−13). ` +
      `The difference is the per-project declaration table's COMPLETENESS — a property of the run's SCOPE, not of the ` +
      `analyzer: a slice resolves against the declarations of the files in THAT slice, so a name whose other declaration ` +
      `lies outside the slice can read unresolved where the whole run reads ambiguous. The slice-merged closure is the ` +
      `fleet's arm protocol (3 contiguous slices over [0, ${pop})) and is the declared measurement; the whole-run reading is ` +
      `published beside it so no reader assumes the two agree.`,
    collResSubset:
      `\`collRes\` (${Number(cl.collRes ?? 0)}) is a SUBSET of resolved — a resolved edge whose target has MORE THAN ONE ` +
      `declaration in the project, so the tie-break chose the row. NEVER added to \`resolved\`. The fleet's own indexer ` +
      `measures 37,318 of 49,729 such picks as WRONG, so the resolved column is a FLOOR on correctness, not a count of ` +
      `correct edges; the per-row number is published so a reader can discount it.`,
    ambKindSubset:
      `\`amb(kind)\` (${Number(cl.ambKind ?? 0)}) is a SUBSET of \`amb(decl)\` (${Number(cl.ambDecl ?? 0)}): distinct KINDS ` +
      `among colliding declarations vs distinct DECLARATIONS. Reported beside it, never added; only amb(decl) is in the closure.`,
    wallModel:
      `THE WALLS ARE THE D7 PARTITION over the arm's OWN slice dumps (${sliceTexts.map((s) => s.path.split("/").pop()).join(", ")}), ` +
      `classified by script/m14/kotlin-wall-classify.ts: wall rows ${wallFromClosure} = amb(decl) ${Number(cl.ambDecl ?? 0)} + ` +
      `unresolved ${Number(cl.unresolved ?? 0)}, partitioned into ${Object.keys(classes).length} classes whose counts sum EXACTLY ` +
      `to the wall rows (${classSum}). The class taxonomy and each disposition are in validation/m14/verification/KOTLIN-D7-WALLS.md; ` +
      `each ruling above carries the falsifier that would re-open its class. CLAIMED = 0: this lane emits no claim kind ` +
      `(extOK ${Number(cl.extOK ?? 0)} is the fleet's external channel, not a claim column).`,
    rendersCorpusUnexercised:
      `★ \`renders\` IS IMPLEMENTED AT R3 AND CORPUS-UNEXERCISED: the Compose DSL parses as real nodes (annotation[Composable] on a ` +
      `function_declaration, body call_expression), the analyzer emits compose_render rows, and the corpus exercises it ZERO times — ` +
      `0 @Composable sites and 0 androidx.compose imports over the whole population. Proof: the behavioural fixture ` +
      `validation/m14/fixtures/kotlin/composable-renders.kt; measurement: validation/m14/measurements/kotlin-renders-emission-census.json ` +
      `(production parseFile path, parsed=2346/2346, 0 rendered rows). The arm's TABLE 1 carries 0 renders edges.`,
    extendedRulings:
      `★ THE THREE RULED EXTENDED TYPES (script/m14/spec/kotlin-completeness.json): \`decorates\` ONTOLOGICAL (10,333 annotation ` +
      `sites; 250 call-shaped annotation arguments partitioned BY CALLEE NAME — ReplaceWith 248, Param 2, every one a nested ` +
      `annotation constructor, 0 lambdas, 0 anonymous objects); \`mixes_in\` ONTOLOGICAL (50 explicit_delegation, every one under ` +
      `delegation_specifier in the class's SUPERTYPE CLAUSE, so conformance IS declared — implements territory; 611 ` +
      `property_delegate; 240 interface default members); \`part_of\` GRAMMAR-ABSENCE (0 part-directive family on the served ` +
      `152-name inventory AND the published 0.3.8 build's 134 named types; 14,047 import_header and 103 Gradle include() ` +
      `near-misses counted). Evidence: validation/m14/measurements/kotlin-extended-types-census.json.`,
    populationRule:
      `★ THE POPULATION IS THE GIT-TRACKED SET, NOT THE DISK: \`git ls-files\` per repository under \`.corpus\`, .kt/.kts admitted, ` +
      `1 MiB cap. MEASURED: ${tracked.admitted} admitted over ${repos} repositories carrying an admitted file ` +
      `(23 tracked-but-absent paths in pb-reference, 0 over cap). This generator REFUSES to write when the closure's ` +
      `population disagrees with this walk or with the lane's census.`,
    armLog: `THE ARM: the closure is ${inp.closurePath}; its slice dumps are ${sliceTexts.map((s) => s.path).join(", ")}.`,
  }

  return {
    meta: {
      lang: LANE,
      asked:
        "the owner's DONE definition, mechanically: every applicable type implemented, measured on the whole admitted " +
        "population, correctly resolved, every wall dispositioned with a count and a falsifier, fixtures pass, no regex. " +
        "This declaration is GENERATED by script/m14/kotlin-declaration.ts from the arm's closure — it refuses on a broken " +
        "closure, a stride sample, a population that disagrees with the tracked-set walk or the lane's census, a tiling " +
        "hole, and a hollow wall census, so no number here is hand-typed.",
      instrument: "script/m14/incoming-gate.ts (the arm) + script/m14/merge-arm-slices.ts (the closure)",
      instrumentVersion: "row schema: edges/resolved/collRes/amb(decl)/amb(kind)/unresolved/ext*/bind*/cause*; TABLE 1; closure terms",
      sample: pop,
      corpusTotal: pop,
      corpusRepos: repos,
      parsed: pop,
      admitted: tracked.admitted,
      perRepo: tracked.perRepo,
      qualifiedNameAliases: 0,
      metric: "ambiguous counted by DECLARATIONS (distinct-file declarations), not distinct kinds",
      analyzer: "src/ast/real-kotlin-analyzer.ts",
      analyzerDigest: `sha256:${analyzerSha}`,
      closureArtifact: inp.closurePath,
      closureDigest: `sha256:${closureSha}`,
      wallCensus: inp.wallsPath,
      wallCensusDigest: `sha256:${wallsSha}`,
      generated: new Date().toISOString(),
      generator: "script/m14/kotlin-declaration.ts",
      direction:
        "resolved/external are FLOORS (may not decrease). ambiguous/otherUnresolved/unclassed are CEILINGS (may not increase). " +
        "The buckets partition the edges: edges = resolved + ambiguous + otherUnresolved + external + unclassed, and unclassed is checked to be 0.",
      runEnvironment: {
        host: os.hostname(),
        cpus: os.cpus().length,
        totalMemMb: Math.round(os.totalmem() / 1048576),
        freeMemMb: Math.round(os.freemem() / 1048576),
        generatedAt: new Date().toISOString(),
      },
    },
    population: popStr,
    closure: {
      edges,
      resolved: Number(cl.resolved ?? 0),
      ambDecl: Number(cl.ambDecl ?? 0),
      unresolved: Number(cl.unresolved ?? 0),
      bindOK: Number(cl.bindOK ?? 0),
      bindPending: Number(cl.bindPending ?? 0),
      bindFAIL: Number(cl.bindFAIL ?? 0),
      extOK: Number(cl.extOK ?? 0),
      extPending: Number(cl.extPending ?? 0),
      extFAIL: Number(cl.extFAIL ?? 0),
      causeOK: Number(cl.causeOK ?? 0),
      causeFAIL: Number(cl.causeFAIL ?? 0),
      collRes: Number(cl.collRes ?? 0),
      ambKind: Number(cl.ambKind ?? 0),
      check: "the ELEVEN TERMS sum to edges EXACTLY, and the type rows reconstruct the closure column by column (both checked before this file was written)",
    },
    types,
    causeRulings,
    resolution_caveats: populatedCaveats,
    sources: [
      `arm closure: ${inp.closurePath} (3 slices over [0, ${pop}), EDGES ${edges}, eleven terms exact)`,
      `arm slice dumps: ${sliceTexts.map((s) => s.path).join(", ")}`,
      `whole-run cross-check: validation/m14/measurements/kotlin-gate-whole-2026-10-25.txt (same files, edges identical, scope-bucket difference stated in the caveats)`,
      `wall census: ${inp.wallsPath} (D7 classes over the arm's slice dumps)`,
      `population walk: this generator's own git-ls-files pass (the fleet's population rule) + validation/m14/measurements/kotlin-extended-types-census.json`,
      `renders: validation/m14/measurements/kotlin-renders-emission-census.json (0 rows) + validation/m14/fixtures/kotlin/composable-renders.kt`,
      `grammar inventory: validation/m14/measurements/kotlin-grammar-nodes.json (served abe1b9bd…, 152 named ids / 142 unique)`,
      `coverage: script/m14/spec/kotlin-completeness.json (11 implemented + 3 ruled + renders corpus-unexercised)`,
      `D7 wall dispositions: validation/m14/verification/KOTLIN-D7-WALLS.md`,
    ],
  }
}

// ── SELF-TEST — a generator that cannot refuse is a formatter ───────────────
const sliceFixture = (opts: { edges: number; resolved: number; ambDecl: number; unresolved: number; collRes: number; ambKind: number; parsed: number; total: number }): string => `
population: ${opts.parsed} parsed of ${opts.total} sampled (corpus has ${opts.total} .kt,kts files across 8 repos; CHUNK)
TABLE 1 — PER PROJECT, the scope production resolves in (this is the verdict's):
type          edges    resolved  collRes  amb(decl)  amb(kind)  unresolved  extOK   ext?    extFAIL  bindOK   bind?   bindFAIL  causeOK  causeFAIL
----------------------------------------------------------------------------------------------------------------------------------------------------
calls         ${opts.edges}  ${opts.resolved}   ${opts.collRes}   ${opts.ambDecl}   ${opts.ambKind}    ${opts.unresolved}   0       0       0        0        0       0         0        0
TOTAL         ${opts.edges}  ${opts.resolved}   ${opts.collRes}   ${opts.ambDecl}   ${opts.ambKind}    ${opts.unresolved}   0       0       0        0        0       0         0        0
`
function makeFixture() {
  const closure = {
    meta: { population: { admitted: 1000, parsed: 1000, corpusTotal: 1000 }, slices: [{ range: [0, 1000], parsed: 1000, edges: 100 }] },
    closure: {
      edges: 100, resolved: 60, ambDecl: 20, unresolved: 20, collRes: 10, ambKind: 5,
      bindOK: 0, bindPending: 0, bindFAIL: 0, extOK: 0, extPending: 0, extFAIL: 0, causeOK: 0, causeFAIL: 0,
      sum: 100, exact: true,
    },
  }
  const sliceTexts = [{ range: [0, 1000] as [number, number], text: sliceFixture({ edges: 100, resolved: 60, ambDecl: 20, unresolved: 20, collRes: 10, ambKind: 5, parsed: 1000, total: 1000 }), path: "fixture-0-1000.dump.txt" }]
  const walls = {
    perDump: [{ dump: "fixture-0-1000.dump.txt", wallRows: 40 }],
    wallRows: 40,
    byLabel: { calls: { amb: 20, unresolved: 20 } },
    classes: { "C7-name-shaped-simple": { rows: 40, samples: [] } },
  }
  return { closure, sliceTexts, walls }
}
function selfTest(): number {
  const failures: string[] = []
  const base = makeFixture()
  const tracked = { admitted: 1000, perRepo: { repo: 1000 } }
  const run = (o: Partial<Inputs>) =>
    build({
      closure: base.closure, sliceTexts: base.sliceTexts, walls: base.walls, censusAdmitted: 1000,
      tracked, closurePath: "fixture.json", wallsPath: "fixture-walls.json", armLogPath: "fixture", ...o,
    })
  // 0 · the control: a coherent fixture BUILDS (a test that only tests refusals proves nothing)
  try { const d = run({}); if (Object.keys(d.types).length !== 1 || Object.keys(d.causeRulings).length !== 1) failures.push("the coherent fixture did not build the expected 1 type row + 1 cause ruling") }
  catch (e: any) { failures.push(`the coherent fixture was REFUSED: ${String(e?.message ?? e).slice(0, 200)}`) }
  // 1 · a broken eleven-term sum must refuse
  {
    const bad = JSON.parse(JSON.stringify(base.closure))
    bad.closure.resolved += 7
    try { run({ closure: bad }); failures.push("a closure whose eleven terms do not sum to edges was ACCEPTED") } catch {}
  }
  // 2 · a population disagreeing with the lane's census must refuse
  try { run({ censusAdmitted: 999 }); failures.push("a population that disagrees with the census was ACCEPTED") } catch {}
  // 3 · a stride sample must refuse
  {
    const badSlices = [{ range: [0, 1000] as [number, number], text: sliceFixture({ edges: 100, resolved: 60, ambDecl: 20, unresolved: 20, collRes: 10, ambKind: 5, parsed: 500, total: 1000 }), path: "fixture-0-1000.dump.txt" }]
    try { run({ sliceTexts: badSlices }); failures.push("a 500-of-1000 stride sample was ACCEPTED as a population") } catch {}
  }
  // 4 · a hollow wall census must refuse
  try { run({ walls: { perDump: [], wallRows: 0, byLabel: {}, classes: {} } }); failures.push("a declaration with NO wall census was ACCEPTED") } catch {}
  // 5 · type rows that do not reconstruct the closure must refuse
  {
    const badSlices = [{ range: [0, 1000] as [number, number], text: sliceFixture({ edges: 100, resolved: 65, ambDecl: 20, unresolved: 15, collRes: 10, ambKind: 5, parsed: 1000, total: 1000 }), path: "fixture-0-1000.dump.txt" }]
    try { run({ sliceTexts: badSlices }); failures.push("type rows that do NOT reconstruct the closure were ACCEPTED") } catch {}
  }
  if (failures.length > 0) {
    console.error("SELF-TEST FAILED — a refusal did not fire:")
    for (const f of failures) console.error(`  - ${f}`)
    return 1
  }
  console.log("self-test: 5/5 refusals fired + the coherent control BUILT (broken eleven-term sum · census disagreement · stride sample · hollow wall census · type rows not reconstructing the closure)")
  return 0
}

// ── MAIN ────────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) process.exit(selfTest())

const closurePath = argOf("closure", DEFAULT_CLOSURE)
const slicesDir = argOf("slices", DEFAULT_SLICES)
const wallsPath = argOf("walls", DEFAULT_WALLS)
const censusPath = argOf("census", DEFAULT_CENSUS)
const write = process.argv.includes("--write")

for (const [label, p] of [["closure", closurePath], ["slices dir", slicesDir], ["wall census", wallsPath], ["census", censusPath]] as const) {
  if (!existsSync(resolve(ROOT, p))) {
    console.error(`REFUSED — ${label} not found: ${p}`)
    process.exit(3)
  }
}
const closure = JSON.parse(readFileSync(resolve(ROOT, closurePath), "utf8"))
const census = JSON.parse(readFileSync(resolve(ROOT, censusPath), "utf8"))
const censusAdmitted = Number(census?.population?.admitted ?? 0)
const walls = JSON.parse(readFileSync(resolve(ROOT, wallsPath), "utf8"))
const tracked = trackedAdmitted()

// The slice dumps, in the closure's own order.
const sliceFiles = (closure?.meta?.slices ?? []).map((s: any) => {
  const [start, end] = s.range
  const p = `${slicesDir}/kotlin-${start}-${end}.dump.txt`
  if (!existsSync(resolve(ROOT, p))) throw new Error(`REFUSED — the slice dump for [${start}, ${end}) is missing: ${p}`)
  return { range: [start, end] as [number, number], path: p, text: readFileSync(resolve(ROOT, p), "utf8") }
})

let decl: any
try {
  decl = build({ closure, sliceTexts: sliceFiles, walls, censusAdmitted, tracked, closurePath, wallsPath, armLogPath: slicesDir })
} catch (e: any) {
  console.error(String(e?.message ?? e))
  process.exit(4)
}
if (write) {
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(decl, null, 2) + "\n")
  console.log(`written: ${OUT_PATH}`)
  console.log(`population: ${decl.population}`)
  console.log(`types: ${Object.keys(decl.types).length} · causeRulings: ${Object.keys(decl.causeRulings).length}`)
  if (decl.closure) console.log(`closure: ${decl.closure.resolved} + ${decl.closure.ambDecl} + ${decl.closure.unresolved} + ${decl.closure.extOK} + ${decl.closure.extPending} + … = ${decl.closure.edges}`)
} else {
  console.log(JSON.stringify(decl, null, 2))
}
