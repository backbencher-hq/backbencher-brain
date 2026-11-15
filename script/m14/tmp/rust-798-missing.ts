// rust #798 — WHERE the new read/type oracles disagree with the analyzer.
//
// The scoped differential found MISSING=3 on one cargo 200-file draw now that
// `uses` and `references` are compared for rust (both were excluded from the
// comparison before this round, so the whole read surface and the whole
// declared-type surface were outside the gate). A scoped draw's samples are
// not persisted, and re-running only rotates to a DIFFERENT 200 files, so this
// probe enumerates the disagreement over the FULL corpus instead — every file,
// every label the lane compares, printed with its kind so each row can be
// adjudicated individually.
//
// Run: bun script/m14/tmp/rust-798-missing.ts <repoRoot> [labelFilter]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
import {
  deriveRustEdges,
  deriveRustBareUses,
  deriveRustDeclaredTypeRefs,
  deriveTreeEdges,
} from "../differential"

// Verbatim from the harness (differential.ts), so a row here is a row there.
const lastSegment = (t: string): string => t.split("::").pop()!.split(".").pop()!.trim()
const normTarget = (t: string): string =>
  lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
const RUST_LABELS = new Set(["calls", "uses", "references", "extends", "implements", "instantiates", "overrides"])

const root = process.argv[2]
const only = process.argv[3]
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 14) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".rs")) files.push(p)
  }
}
walk(root)
files.sort()

const parser = await ASTEngine.getParser("rust" as any)
const analyzer = new RealRustAnalyzer()
let missing = 0
let unexplained = 0
let truthTotal = 0
let analyzeredges = 0
const byLabel: Record<string, number> = {}
const byLabelUn: Record<string, number> = {}
const shown = new Set<string>()
const seenFiles = new Set<string>()

for (const f of files) {
  const content = fs.readFileSync(f, "utf8")
  let tree: any
  try { tree = parser.parse(content) } catch { continue }
  const rootNode = tree.rootNode
  if (!rootNode) continue
  const res: any = await analyzer.analyze(rootNode, content, f)
  const rels = (res.relationships ?? [])
    .map((r: any) => ({ label: String(r.type ?? r.relationshipType ?? ""), target: String(r.target ?? r.to ?? r.toSymbol ?? "") }))
    .filter((r: any) => RUST_LABELS.has(r.label))
    .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })

  const truth: any[] = [
    ...deriveTreeEdges(rootNode, "rust"),
    ...deriveRustEdges(rootNode),
    ...deriveRustBareUses(rootNode),
    ...deriveRustDeclaredTypeRefs(rootNode),
  ]
  truthTotal += truth.length
  analyzeredges += rels.length

  for (const te of truth) {
    const hit = rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))
    if (hit) continue
    missing++
    byLabel[te.label] = (byLabel[te.label] ?? 0) + 1
    seenFiles.add(`${te.label}:${f}`)
    const key = `${te.label}|${te.target}`
    if ((!only || te.label === only) && shown.size < 60 && !shown.has(key)) {
      shown.add(key)
      console.log(`MISSING ${te.label} -> ${JSON.stringify(te.target)}  from=${te.from}  ${path.relative(root, f)}`)
    }
  }
  for (const r of rels) {
    const hit = truth.some((te: any) => te.label === r.label && normTarget(r.target) === normTarget(te.target))
    if (hit) continue
    unexplained++
    byLabelUn[r.label] = (byLabelUn[r.label] ?? 0) + 1
    if ((!only || r.label === only) && shown.size < 60) console.log(`UNEXPLAINED ${r.label} -> ${JSON.stringify(r.target)}  ${path.relative(root, f)}`)
  }
}
console.log(JSON.stringify({ repo: root, files: files.length, truthTotal, analyzeredges, missing, unexplained, missingByLabel: byLabel, unexplainedByLabel: byLabelUn, filesWithMissing: seenFiles.size }, null, 1))
