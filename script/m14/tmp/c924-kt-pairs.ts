// c924-kt-pairs — LOCALIZE a coverage difference between two trees, per file.
//
// The full-extent (60-file) kotlin draw read MISSING=1 on the patched tree and MISSING=0 on
// the unpatched one, with IDENTICAL analyzer-edge counts and the same draw hash: one truth row
// stopped being covered, which is the signature of a lockstep break, not of a lost file. The
// harness prints only the lane total, so this re-derives the same comparison per FILE and prints
// a line per file. Run it on both trees with the same arguments and diff: the file whose
// `matched` differs is the one to read.
//
// Run: bun script/m14/tmp/c924-kt-pairs.ts <repoDir> [seedTag] [sampleN]
import * as fs from "node:fs"
import * as path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".")
// Both trees' own harness/analyzer are imported RELATIVE to this script, so the same probe file
// measures whichever tree it is copied into (the replica copies must be refreshed after an edit).
const { RealKotlinAnalyzer } = await import("../../../src/ast/real-kotlin-analyzer")
const mod: any = await import("../../../script/m14/differential")

function filesUnder(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) filesUnder(p, exts, out) }
    else if (exts.some((x) => e.name.endsWith("." + x))) out.push(p)
  }
  return out
}
function seededPick<T>(items: T[], n: number, seedStr: string): T[] {
  let h = 2166136261
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  const idx = items.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h + i), 2246822519)
    const j = Math.abs(h) % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, n).map(i => items[i])
}
const lastSegment = (name: string): string => {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
const normTarget = (t: string): string => lastSegment(String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim())

// The labels the harness actually COMPARES for kotlin (the allowlist head: a `uses` label is not
// in kotlin's set by construction — that gap is recorded in reviews/m60-924-name-surface.md).
const COMPARED = new Set(["calls", "instantiates", "overrides", "extends", "implements", "exports"])
// `--all` widens truth to the oracle's whole derivation (every label), `--labels=a,b` to a list.
const LABEL_ARG = process.argv.find((a) => a.startsWith("--labels="))?.slice("--labels=".length)
const ALL_LABELS = process.argv.includes("--all")
if (LABEL_ARG) { COMPARED.clear(); for (const l of LABEL_ARG.split(",")) COMPARED.add(l.trim().toLowerCase()) }
const byLabel: Record<string, { truth: number; matched: number }> = {}

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
// The TREE's own node_modules/wasm — never BB_M14_WORK, which is the sweep's scratch root.
const TREE = path.resolve(HERE, "../..", "..")
await P.init({ locateFile: () => path.join(TREE, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(TREE, "wasm", "tree-sitter-kotlin.wasm")))

const repoDir = process.argv[2]
const seedTag = process.argv[3] ?? "m14-f5"
const sampleN = Number(process.argv[4] ?? 60)
const sample = seededPick(filesUnder(repoDir, ["kt", "kts"]), sampleN, `${path.basename(repoDir)}:kotlin:${seedTag}`)

let totalTruth = 0
let totalMatched = 0
for (const f of sample) {
  const content = fs.readFileSync(f, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(content).rootNode
  const r: any = await new RealKotlinAnalyzer().analyze(root, content, path.relative(repoDir, f))
  const rels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), target: String(x.target) }))
  // Label scope is an ARGUMENT, not a constant. The first run of this probe restricted truth to
  // the harness's compared labels and found the two trees identical (1542/1542 both sides) while
  // the harness read one row differently — so the row lives outside that set and the probe must be
  // able to widen (or drop) the filter without being edited.
  const truth: any[] = [...mod.deriveTreeEdges(root, "kotlin"), ...mod.deriveKotlinEdges(root)]
    .filter((e: any) => ALL_LABELS || COMPARED.has(String(e.label).toLowerCase()))
  let matched = 0
  const unmatched: any[] = []
  for (const te of truth) {
    const lab = String(te.label).toLowerCase()
    const hit = rels.some((x: any) => x.label === lab && normTarget(x.target) === normTarget(te.target))
    if (hit) matched++
    else unmatched.push(te)
    byLabel[lab] ??= { truth: 0, matched: 0 }
    byLabel[lab].truth++
    if (hit) byLabel[lab].matched++
  }
  totalTruth += truth.length
  totalMatched += matched
  const rel = path.relative(repoDir, f)
  console.log(`${rel}\ttruth=${truth.length}\tmatched=${matched}`)
  for (const u of unmatched.slice(0, 4)) console.log(`    UNMATCHED ${u.label} -> ${JSON.stringify(String(u.target))}`)
}
for (const [lab, v] of Object.entries(byLabel).sort()) {
  console.log(`LABEL ${lab}\ttruth=${v.truth}\tmatched=${v.matched}\tmissing=${v.truth - v.matched}`)
}
console.log(`TOTAL truth=${totalTruth} matched=${totalMatched} missing=${totalTruth - totalMatched} files=${sample.length}${ALL_LABELS ? " labels=ALL" : ""}`)
