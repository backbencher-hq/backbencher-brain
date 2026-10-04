/**
 * M14 ONTOLOGY — CSS instrument for §2b: the PER-TYPE census through the PRODUCTION
 * entry point.
 *
 * ## Why `parseFile` and not `analyze()`
 *
 * `analyze()` is the per-file unit the analyzer implements. It SKIPS every stage
 * `parseFile` owns — the size early-returns, the fallback extraction, the timeout,
 * the enhancement pass, and `filterNoiseRelationships`. An edge count read off
 * `analyze()` is therefore a count of what the analyzer WROTE, not of what the store
 * receives. `script/m14/results/css-ontology-census-before.json` carries the shape of
 * that difference already: the same 457 files, 59,940 relationships out of `analyze()`
 * and 22,946 out of `parseFile`. This harness reads `parseFile` only, so its numbers
 * are the ones a consumer sees.
 *
 * ## What it measures, per the workstream's §2b list
 *
 *   - relationship types with counts and the files each came from
 *   - SymbolKind values, with any empty/unknown kind named
 *   - symbols with an empty name
 *   - relationship endpoints equal to the literal `unknown`
 *   - both-endpoint resolution per type, under parallel-indexer's insert-time rules
 *   - the confidence distribution per type (the contract's §4 heuristic ratio)
 *
 * ## Resolution is measured against the PRODUCTION filter, not the analyzer's own
 *
 * parallel-indexer binds a relationship to a symbol at insert time; a name it cannot
 * bind is stored as `source_external` / `target_external` and is unjoinable at query.
 * So the honest question is not "does a name appear in the analyzer's symbol list" but
 * "does it bind". Both are reported, and the divergence between them is itself a
 * finding — an edge whose target IS a published symbol can still fail to bind when the
 * file holds several symbols with that name in different scopes.
 *
 * ## READ-ONLY
 *
 * Writes nothing. Prints a report and, with `--json <path>`, one JSON document.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------------- corpus
// The admission rule is `ontology-coverage-gate.ts`'s, copied rather than imported
// for the reason its own header would give: the gate is shared machinery that may
// change under this lane, and a census whose file set drifts with someone else's edit
// is not a census. git-tracked, a real directory, <= 512 KB, detected as `css`.
type File = { repo: string; dir: string; rel: string; abs: string; size: number }
const files: File[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try {
      size = statSync(abs).size
      if (size > 512 * 1024) continue
      if (size === 0) continue
      // detectLanguageFromPath is cheap for a path-only answer on every extension css
      // owns (.css, .sass, .less); the text is only read for extensionless paths, so
      // this costs one stat per tracked file rather than one read.
      if (detectLanguageFromPath(abs) !== "css") continue
    } catch {
      continue
    }
    files.push({ repo: e, dir, rel, abs, size })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
const repos = new Set(files.map((f) => f.repo))

// ---------------------------------------------------------------------- census
type TypeRow = {
  type: Type
  edges: number
  files: number
  /** edges whose SOURCE binds to a published symbol */
  srcResolves: number
  /** edges whose TARGET binds to a published symbol */
  tgtResolves: number
  bothResolves: number
  confBelow1: number
  confBelow07: number
  /** evidenceClass -> count */
  evidence: Record<string, number>
  /** relationship metadata label -> count, so a type's sub-shapes are separable */
  labels: Record<string, number>
  examples: string[]
}
const rows = new Map<Type, TypeRow>()
const row = (t: Type): TypeRow => {
  const r = rows.get(t) ?? {
    type: t, edges: 0, files: 0, srcResolves: 0, tgtResolves: 0, bothResolves: 0,
    confBelow1: 0, confBelow07: 0, evidence: {}, labels: {}, examples: [],
  }
  rows.set(t, r)
  return r
}

const kinds = new Map<string, number>()
/**
 * Symbol-side branch tally: metadata flag -> occurrences. This is what answers the
 * workstream's second question — "Fires" — per BRANCH rather than per type. A type can
 * be EMITTED at 100% while a third of its branches have never executed on any corpus
 * file, and only a per-branch tally can tell the two apart.
 */
const symFlags = new Map<string, number>()
let emptyKind = 0
let unknownKind = 0
let emptyName = 0
let placeholderEndpoints = 0
let symbolsTotal = 0
let relationshipsTotal = 0
let filesParsed = 0
let filesFailed = 0
let filesEmpty = 0
const failedExamples: string[] = []

/**
 * parallel-indexer's own binding rules, re-derived from its insert path. EXACT name,
 * the leaf after the last `.` of the last `:`-segment, and the `endsWith(":name")` /
 * `endsWith(".name")` shapes. Read from `src/ast/parallel-indexer.ts`; a census that
 * used a different rule would report a rate for a resolver that does not exist.
 */
const binds = (name: string, names: Set<string>): boolean => {
  if (!name) return false
  if (names.has(name)) return true
  const noLine = name.replace(/:\d+$/, "")
  const segs = noLine.split(":").filter((s) => s.length > 0)
  const leaf = (segs[segs.length - 1] ?? "").split(".").pop() ?? ""
  if (leaf && names.has(leaf)) return true
  for (let i = 0; i < name.length; i++) {
    const c = name[i]
    if (c !== ":" && c !== ".") continue
    const tail = name.slice(i + 1)
    if (tail.length > 0 && names.has(tail)) return true
  }
  return false
}

let cursor = 0
async function worker(): Promise<void> {
  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      filesFailed++
      if (failedExamples.length < 8) failedExamples.push(`${f.repo}/${f.rel}`)
      continue
    }
    const syms: any[] = r.symbols ?? []
    const rels: any[] = r.relationships ?? []
    filesParsed++
    if (syms.length === 0 && rels.length === 0) filesEmpty++
    symbolsTotal += syms.length
    relationshipsTotal += rels.length

    const names = new Set<string>()
    for (const s of syms) {
      const k = String(s.kind ?? "")
      if (k.length === 0) emptyKind++
      else if (k === "unknown" || k === "undefined") unknownKind++
      kinds.set(k, (kinds.get(k) ?? 0) + 1)
      if (!s.name || String(s.name).trim().length === 0) {
        emptyName++
        continue
      }
      const smd = (s.metadata ?? {}) as Record<string, unknown>
      for (const [k, v] of Object.entries(smd)) {
        if (!/^(is|has)[A-Z]/.test(k)) continue
        if (v === false) continue
        if (v === undefined || v === null) continue
        symFlags.set(k, (symFlags.get(k) ?? 0) + 1)
      }
      names.add(String(s.name))
      if (s.scope) names.add(`${s.scope}.${s.name}`)
      const qn = s.qualifiedName
      if (typeof qn === "string" && qn.length > 0) names.add(qn)
    }

    const perFile = new Map<Type, number>()
    for (const rel of rels) {
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const label = `${f.repo}/${f.rel}`
      const src = String(rel.source ?? rel.from ?? "")
      const tgt = String(rel.target ?? rel.to ?? "")
      if (src.length === 0 || tgt.length === 0 || src === "unknown" || tgt === "unknown") placeholderEndpoints++
      const r0 = row(t)
      r0.edges++
      perFile.set(t, (perFile.get(t) ?? 0) + 1)
      const conf = typeof rel.confidence === "number" ? rel.confidence : undefined
      if (conf !== undefined && conf < 1) r0.confBelow1++
      if (conf !== undefined && conf < 0.7) r0.confBelow07++
      const md = (rel.metadata ?? {}) as Record<string, unknown>
      const ev = typeof md.evidenceClass === "string" ? md.evidenceClass : "(none)"
      r0.evidence[ev] = (r0.evidence[ev] ?? 0) + 1
      // The sub-shape label. Every CSS edge carries one of a small set of boolean
      // metadata flags naming WHAT KIND of thing the edge is; the flag is what tells
      // a `references` to a custom property from one to a `@custom-media` apart, so
      // the census reports the flags rather than a single per-type number.
      const flags = Object.keys(md).filter((k) => /^is[A-Z]/.test(k) || k === "cssSpecific")
      const lab = flags.sort().join("+") || "(none)"
      r0.labels[lab] = (r0.labels[lab] ?? 0) + 1
      if (r0.examples.length < 3) r0.examples.push(`${label}: ${src} -> ${tgt}`)
      if (binds(src, names)) r0.srcResolves++
      if (binds(tgt, names)) r0.tgtResolves++
      if (binds(src, names) && binds(tgt, names)) r0.bothResolves++
    }
    for (const [t, n] of perFile) {
      const r0 = row(t)
      r0.files += 1
      void n
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ---------------------------------------------------------------------- report
const pct = (a: number, b: number): string => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
const report = {
  instrument: "css-parsefile-census",
  corpusRoot: CR,
  filesAdmitted: files.length,
  repos: repos.size,
  repoList: [...repos].sort(),
  filesParsed,
  filesFailed,
  filesProducingNothing: filesEmpty,
  symbolsTotal,
  relationshipsTotal,
  perType: ALL_TYPES.map((t) => rows.get(t) ?? row(t)),
  symbolKinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])),
  symbolMetadataFlags: Object.fromEntries([...symFlags.entries()].sort((a, b) => b[1] - a[1])),
  emptyKindRows: emptyKind,
  unknownKindRows: unknownKind,
  emptySymbolNameRows: emptyName,
  placeholderEndpointRows: placeholderEndpoints,
}
const jsonArg = process.argv.indexOf("--json")
if (jsonArg !== -1 && process.argv[jsonArg + 1]) writeFileSync(process.argv[jsonArg + 1], JSON.stringify(report, null, 2) + "\n")

console.log(`css parseFile census — production entry point`)
console.log(`corpus: ${files.length} admitted files across ${repos.size} repos; parsed ${filesParsed}, failed ${filesFailed}, produced nothing ${filesEmpty}`)
console.log(`symbols ${symbolsTotal}   relationships ${relationshipsTotal}   (ALL types, not only the ontology's ten)`)
console.log("")
console.log(`${w("type", 13)}${w("edges", 9)}${w("files", 7)}${w("srcRes", 9)}${w("tgtRes", 9)}${w("bothRes", 9)}${w("conf<1", 8)}${w("conf<.7", 9)}${w("heur%", 7)}both`)
console.log("-".repeat(100))
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r || r.edges === 0) {
    console.log(`${w(t, 13)}${w("0", 9)}${w("0", 7)}${w("-", 9)}${w("-", 9)}${w("-", 9)}${w("-", 8)}${w("-", 9)}${w("-", 7)}NOT EMITTED`)
    continue
  }
  console.log(
    `${w(t, 13)}${w(r.edges.toLocaleString(), 9)}${w(String(r.files), 7)}${w(pct(r.srcResolves, r.edges), 9)}${w(pct(r.tgtResolves, r.edges), 9)}${w(pct(r.bothResolves, r.edges), 9)}${w(pct(r.confBelow1, r.edges), 8)}${w(pct(r.confBelow07, r.edges), 9)}${w(pct(r.confBelow07, r.edges), 7)}${r.bothResolves}/${r.edges}`,
  )
}
console.log("")
console.log("EVIDENCE CLASS per type")
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r || r.edges === 0) continue
  console.log(`  ${w(t, 13)}${Object.entries(r.evidence).map(([k, v]) => `${k}=${v}`).join("  ")}`)
}
console.log("")
console.log("METADATA LABEL per type (the sub-shape of each type)")
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r || r.edges === 0) continue
  console.log(`  ${w(t, 13)}`)
  for (const [k, v] of Object.entries(r.labels).sort((a, b) => b[1] - a[1])) console.log(`${" ".repeat(16)}${w(k, 62)}${v}`)
}
console.log("")
console.log("EXAMPLE FILES per type (up to 3)")
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r || r.edges === 0) continue
  console.log(`  ${w(t, 13)}`)
  for (const e of r.examples) console.log(`${" ".repeat(16)}${e}`)
}
console.log("")
console.log(`SYMBOL KIND tally: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || "(empty)"}=${v}`).join(" ")}`)
console.log("")
console.log("SYMBOL METADATA FLAG tally (the per-branch firing table — a flag at 0 has never executed on this corpus)")
{
  const dead = [...symFlags.entries()].filter(([, v]) => v === 0)
  for (const [k, v] of [...symFlags.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 38)}${v}`)
  if (dead.length) console.log(`  flags at zero: ${dead.map(([k]) => k).join(", ")}`)
}
console.log(`empty kind rows: ${emptyKind}   unknown/undefined kind rows: ${unknownKind}`)
console.log(`empty symbol name rows: ${emptyName}`)
console.log(`edge endpoint empty/placeholder rows: ${placeholderEndpoints}`)
if (failedExamples.length) console.log(`failed files (first 8): ${failedExamples.join(", ")}`)
console.log("")
console.log("per-repo file counts")
const perRepo = new Map<string, number>()
for (const f of files) perRepo.set(f.repo, (perRepo.get(f.repo) ?? 0) + 1)
console.log(`  ${[...perRepo.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)