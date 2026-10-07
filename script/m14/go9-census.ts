// VERIFY_GO9 census — per-relationship-type measurement of the GO lane.
//
// Written for the ontology workstream, NOT a copy of any other lane's script.
// It runs the PRODUCTION path (getParser -> parse -> RealGoAnalyzer.analyze)
// and, for every relationship row, answers the workstream's questions 4/5/6
// with a number instead of a claim:
//
//   Q2 fires?        count + distinct file count per type key
//   Q4 labelled?     metadata.relationshipType distribution per type
//   Q5 resolved?     both endpoints bind to a symbol in the SAME analyze()
//                    call's res.symbols (name set, plus qualified "T.M" set)
//   Q6 confident?    confidence distribution, evidenceClass distribution, and
//                    contract-S4 compliance: every confidence<1.0 row must
//                    carry a machine-readable reasonCode
//   R7 hygiene       empty names, and placeholder-literal endpoints
//
// No regular expression appears in this file. Every test is string equality,
// set membership, or char-code inspection.
//
//   NFILES=200 bun script/m14/go9-census.ts          # census, prints report
//   NFILES=200 JSON=1 bun script/m14/go9-census.ts   # machine-readable dump
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/VERIFY_GO9"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const DIR = join(CORPUS, process.env.BB_DIR || "go-stdlib")
const NFILES = Number(process.env.NFILES || 200)

// Same code-bearing signal the v2 harness uses for .go, so the census and the
// firing check sample the same population. Repeated here rather than imported
// so this script stands alone.
const SIGNALS = ["func ", "package "]

function pickFiles(dir: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (out.length >= want || depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) {
        const n = e.name
        if (n === "node_modules" || n === ".git") continue
        walk(p, depth + 1)
      } else if (e.name.endsWith(".go")) {
        try {
          if (statSync(p).size >= 400_000) continue
          const src = readFileSync(p, "utf8")
          if (!SIGNALS.some((s) => src.includes(s))) continue
          out.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  return out.slice(0, want)
}

// ---------------------------------------------------------------- hygiene ---

/** Placeholder-literal endpoints, standing rule R7. String equality only. */
const PLACEHOLDERS = new Set([
  "unknown", "Unknown", "<unknown>", "?", "TODO", "todo", "TBD", "tbd",
  "placeholder", "PLACEHOLDER", "xxx", "XXX", "nil", "null", "undefined",
  "unknown_type", "unknownName", "unknown_name", "unresolved", "N/A", "n/a",
])

function isPlaceholder(s: string): boolean {
  if (PLACEHOLDERS.has(s)) return true
  if (s.length >= 2) {
    const a = s.charCodeAt(0), b = s.charCodeAt(s.length - 1)
    if (a === 60 && b === 62) return true // <...>
    if (a === 123 && b === 125) return true // {...}
    if (a === 91 && b === 93) return true // [...]
  }
  return false
}

// ------------------------------------------------------------------- tally ---

interface Tally {
  rows: number
  files: Set<string>
  conf: Map<number, number>
  evidence: Map<string, number>
  labels: Map<string, number>
  reasonMissing: number
  reasonTotal: number
  srcResolved: number
  tgtResolved: number
  emptyEndpoint: number
  placeholderEndpoint: string[]
  confOneWithReason: number
  unknownCode: number
  samples: { file: string; src: string; tgt: string; conf: number; label: string }[]
  sepTargets: Set<string>
}

function newTally(): Tally {
  return {
    rows: 0, files: new Set(), conf: new Map(), evidence: new Map(), labels: new Map(),
    reasonMissing: 0, reasonTotal: 0, srcResolved: 0, tgtResolved: 0, emptyEndpoint: 0,
    placeholderEndpoint: [], samples: [], confOneWithReason: 0, unknownCode: 0,
    sepTargets: new Set(),
  }
}

const tally = new Map<string, Tally>()
/** (source,target) seen per type, so CROSS-TYPE overlap can be measured. */
const pairsByType = new Map<string, Set<string>>()
/** Symbols whose name equals their ownerName — the population the contains
 *  pass drops at `owner !== s.name`. Counted from the ANALYZER's own symbol
 *  table, so the number is the size of the suppressed set, not a guess. */
let selfNamedMembers = 0, selfNamedFiles = new Set<string>()
const selfNamedSamples: string[] = []
const inc = (m: Map<any, number>, k: any) => m.set(k, (m.get(k) || 0) + 1)

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const { RealGoAnalyzer } = await import(`${REPO}/src/ast/real-go-analyzer.ts`)
const ENUM = [...new Set(Object.values(RelationshipType)) as string[]]

const files = pickFiles(DIR, NFILES)
if (!files.length) { console.error(`NO CORPUS under ${DIR}`); process.exit(1) }

let parsed = 0, failed = 0, importsTotal = 0, filesWithImports = 0
let importChannelKinds = new Map<string, number>()
let parseErrors = 0

for (const f of files) {
  let pr: any, res: any
  try {
    const content = readFileSync(f, "utf8")
    const parser = await getParser("go")
    pr = await parser.parse(content, f)
    res = new RealGoAnalyzer().analyze(pr.rootNode, content, f)
  } catch { failed++; continue }
  parsed++
  const short = f.slice(DIR.length + 1)
  if (res.errors && res.errors.length) parseErrors += res.errors.length

  const imps = res.imports || []
  importsTotal += imps.length
  if (imps.length) filesWithImports++

  // --- symbol resolution universe for THIS file's analyze() call -----------
  const byName = new Set<string>()
  const qualified = new Set<string>()
  const localNames = new Set<string>()
  for (const s of res.symbols || []) {
    const n = String(s.name ?? "")
    if (!n) continue
    byName.add(n)
    localNames.add(n)
    const owner = s.ownerName ?? s.containerName ?? s.metadata?.receiverType
    if (typeof owner === "string" && owner) qualified.add(`${owner}.${n}`)
  }

  for (const sym of res.symbols || []) {
    const ow = sym.ownerName
    if (typeof ow === "string" && ow.length && ow === String(sym.name ?? "")) {
      selfNamedMembers++
      selfNamedFiles.add(short)
      if (selfNamedSamples.length < 6) selfNamedSamples.push(`${short}:${sym.range?.startLine} ${ow} -> ${sym.name} (${String(sym.kind)})`)
    }
  }

  for (const r of res.relationships || []) {
    const t = String(r.relationshipType ?? r.type ?? "<none>")
    if (!pairsByType.has(t)) pairsByType.set(t, new Set())
    pairsByType.get(t)!.add(`${String(r.source ?? r.from ?? "")} ${String(r.target ?? r.to ?? "")}`)
    let tl = tally.get(t)
    if (!tl) { tl = newTally(); tally.set(t, tl) }
    tl.rows++
    tl.files.add(short)
    const src = String(r.source ?? r.from ?? "")
    const tgt = String(r.target ?? r.to ?? "")
    inc(tl.conf, typeof r.confidence === "number" ? r.confidence : -1)
    const md = r.metadata || {}
    inc(tl.evidence, String(md.evidenceClass ?? "<none>"))
    inc(tl.labels, String(md.relationshipType ?? "<none>"))
    const hasReason = typeof md.reasonCode === "string" && md.reasonCode.length > 0
    if (typeof r.confidence === "number" && r.confidence < 1.0) {
      tl.reasonTotal++
      if (!hasReason) tl.reasonMissing++
    } else if (hasReason) {
      // A confidence-1.0 edge is a FACT, so there is no unresolved step to
      // state and a reason code on it is noise that reads as a caveat the edge
      // does not have. This is the second instrument for the contract-S4 rule:
      // the fixture cannot kill the "stamp every row" mutant because no
      // (type, label) pair in this analyzer is published at both 1.0 and below
      // 1.0, so the census checks the 1.0 half directly.
      tl.confOneWithReason++
    }
    if (!src.length || !tgt.length) tl.emptyEndpoint++
    if (isPlaceholder(src) || isPlaceholder(tgt)) {
      if (tl.placeholderEndpoint.length < 6) tl.placeholderEndpoint.push(`${src} -> ${tgt}`)
    }
    // endpoint resolution. A method edge is written "Owner.Name" (overrides);
    // imports targets a MODULE path, not a symbol, and is counted separately.
    if (t !== "imports") {
      if (byName.has(src) || qualified.has(src)) tl.srcResolved++
      if (byName.has(tgt) || qualified.has(tgt)) tl.tgtResolved++
    }
    if (tgt.includes("/")) tl.sepTargets.add(tgt)
    if (tl.samples.length < 3) {
      tl.samples.push({
        file: short, src, tgt,
        conf: typeof r.confidence === "number" ? r.confidence : -1,
        label: String(md.relationshipType ?? "<none>"),
      })
    }
  }
}

// ------------------------------------------------------------------ report ---

const out: any = {
  corpus: DIR, nfiles: NFILES, sampledFiles: files.length,
  parsed, failed, parseErrors, importsTotal, filesWithImports,
  enum: ENUM, types: {} as any,
}

const keys = [...tally.keys()].sort()
console.log(`GO9 census  corpus=${DIR}  NFILES=${NFILES}  sampled=${files.length}  parsed=${parsed}  failed=${failed}`)
console.log(`parse errors=${parseErrors}  imports[]=${importsTotal} in ${filesWithImports} files\n`)

console.log("type".padEnd(14) + "rows".padStart(8) + "files".padStart(7) + "src%".padStart(7) + "tgt%".padStart(7) + "noReason".padStart(9) + "minConf".padStart(8))
console.log("-".repeat(60))
for (const k of keys) {
  const t = tally.get(k)!
  const sp = t.rows ? ((100 * t.srcResolved) / t.rows).toFixed(1) : "-"
  const tp = t.rows ? ((100 * t.tgtResolved) / t.rows).toFixed(1) : "-"
  const confs = [...t.conf.keys()].filter((c) => c >= 0)
  const minC = confs.length ? String(Math.min(...confs)) : "-"
  console.log(
    k.padEnd(14) + String(t.rows).padStart(8) + String(t.files.size).padStart(7) +
    String(sp).padStart(7) + String(tp).padStart(7) +
    String(t.reasonMissing + "/" + t.reasonTotal).padStart(9) + minC.padStart(8),
  )
  out.types[k] = {
    rows: t.rows, files: t.files.size, fileList: [...t.files].slice(0, 12),
    confidence: Object.fromEntries(t.conf), evidenceClass: Object.fromEntries(t.evidence),
    labels: Object.fromEntries(t.labels),
    subOneReasonTotal: t.reasonTotal, subOneReasonMissing: t.reasonMissing,
    srcResolved: t.srcResolved, tgtResolved: t.tgtResolved,
    emptyEndpoint: t.emptyEndpoint, placeholderEndpoints: t.placeholderEndpoint,
    confOneWithReason: t.confOneWithReason,
    separatorTargets: [...t.sepTargets].slice(0, 8),
    samples: t.samples,
  }
}

// cross-type overlap: the SAME (source,target) emitted under two labels
const overlaps: string[] = []
const typesSorted = [...pairsByType.keys()].sort()
for (let i = 0; i < typesSorted.length; i++) {
  for (let j = i + 1; j < typesSorted.length; j++) {
    const A = pairsByType.get(typesSorted[i])!, B = pairsByType.get(typesSorted[j])!
    let n = 0
    const ex: string[] = []
    for (const k of A) if (B.has(k)) { n++; if (ex.length < 3) ex.push(k.split(" ").join(" -> ")) }
    if (n) overlaps.push(`${typesSorted[i]} & ${typesSorted[j]}: ${n} identical (source,target) pairs  e.g. ${ex.join(" | ")}`)
  }
}
console.log(`\nCROSS-TYPE identical (source,target) pairs:`)
for (const o of overlaps) console.log("  " + o)
if (!overlaps.length) console.log("  none")
console.log(`\ncontains-pass suppressed members (symbol.ownerName === symbol.name): ${selfNamedMembers} in ${selfNamedFiles.size} files`)
for (const s2 of selfNamedSamples) console.log("  " + s2)
out.overlaps = overlaps
out.selfNamedMembers = { count: selfNamedMembers, files: selfNamedFiles.size, samples: selfNamedSamples }

const fired = ENUM.filter((e) => tally.has(e))
const silent = ENUM.filter((e) => !tally.has(e))
// contract S4 both directions: nothing below 1.0 without a code, nothing at
// 1.0 with one. Non-zero exit is the assertion.
const subOneMissing = Object.entries(out.types).reduce((a, [k, v]: any) => a + (v.subOneReasonMissing || 0), 0)
const confOneStamped = Object.entries(out.types).reduce((a, [k, v]: any) => a + (v.confOneWithReason || 0), 0)
console.log(`\ncontract S4: ${subOneMissing} sub-1.0 rows without a reasonCode, ${confOneStamped} confidence-1.0 rows carrying one`)
out.contractS4 = { subOneMissing, confOneStamped }

console.log(`\nENUM fired ${fired.length}/${ENUM.length}: ${fired.join(" ")}`)
console.log(`ENUM silent: ${silent.join(" ") || "-"}`)
const offEnum = keys.filter((k) => !ENUM.includes(k))
console.log(`off-enum relationship keys: ${offEnum.join(" ") || "-"}`)
out.fired = fired; out.silent = silent; out.offEnum = offEnum

console.log("\n--- per type detail ---")
for (const k of keys) {
  const o = out.types[k]
  console.log(`\n[${k}] rows=${o.rows} files=${o.files} emptyEndpoint=${o.emptyEndpoint} placeholders=${o.placeholderEndpoints.length}`)
  console.log(`  confidence : ${JSON.stringify(o.confidence)}`)
  console.log(`  evidence   : ${JSON.stringify(o.evidenceClass)}`)
  console.log(`  labels     : ${JSON.stringify(o.labels)}`)
  if (o.placeholderEndpoints.length) console.log(`  PLACEHOLDER ENDPOINTS: ${JSON.stringify(o.placeholderEndpoints)}`)
  if (o.separatorTargets.length) console.log(`  targets containing "/": ${JSON.stringify(o.separatorTargets)}`)
  console.log(`  files      : ${o.fileList.join(", ")}`)
  for (const s of o.samples) console.log(`  e.g. ${s.src} -> ${s.tgt}  conf=${s.conf} ${s.label}  (${s.file})`)
}

if (subOneMissing > 0 || confOneStamped > 0) {
  console.error(`\nCONTRACT S4 VIOLATION — subOneMissing=${subOneMissing} confOneStamped=${confOneStamped}`)
  process.exitCode = 1
}

if (process.env.JSON) {
  const p = process.env.JSON
  writeFileSync(p, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${p}`)
}