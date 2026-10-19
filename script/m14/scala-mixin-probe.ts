// scala-mixin-probe — bounded (600-file) MEASURED before/after for the fleet MIXIN RULING (2026-10-19).
// Light instrument: parses a stride sample of the gate's admitted scala population through the production
// analyzer path (getParser -> analyzer.analyze), counts the analyzer's ACTUAL labels (after), and derives
// the PRE-RULING labeling from the same AST independently (before): class/object pos0 extends then
// implements; trait/enum all extends. TOTAL must be invariant (relabel only).
// USAGE: export BB_CORPUS_ROOT=$PWD/.corpus; bun run script/m14/scala-mixin-probe.ts --cap=600 --out=<json>
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const args = process.argv.slice(2)
const CAP = Number(args.find((a) => a.startsWith("--cap="))?.split("=")[1] ?? 600)
const OUT = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? ""
const EXT = [".scala", ".sc", ".sbt"], SIZE = 1024 * 1024
const files: string[] = []; const repos = new Set<string>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0") } catch { continue }
  for (const rel of tracked) {
    if (!rel) continue
    const low = rel.toLowerCase()
    if (!EXT.some((e) => low.endsWith(e))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE) continue } catch { continue }
    files.push(abs); repos.add(name)
  }
}
files.sort()
const stride = Math.max(1, Math.floor(files.length / CAP))
const sample: string[] = []
for (let i = 0; i < files.length && sample.length < CAP; i += stride) sample.push(files[i])
const { RealScalaAnalyzer } = await import("../../src/ast/real-scala-analyzer")
const analyzer = new (RealScalaAnalyzer as any)()
const parser: any = await getParser("scala" as any)
const LABELS = ["extends", "implements", "mixes_in"]
const after: Record<string, number> = {}; const before: Record<string, number> = {}
let analyzerEdges = 0, parsed = 0, skipped = 0
const DECL = new Set(["class_definition", "trait_definition", "object_definition", "enum_definition"])
function heritageNames(clause: any): string[] {
  const names: string[] = []
  for (let i = 0; i < (clause?.namedChildCount ?? 0); i++) {
    const c = clause.namedChild(i); if (!c) continue
    let nm = ""
    if (c.type === "type_identifier" || c.type === "identifier" || c.type === "stable_type_identifier") nm = c.text
    else if (c.type === "generic_type") { for (let j = 0; j < c.childCount; j++) { const h = c.child(j); if (h && (h.type === "stable_type_identifier" || h.type === "type_identifier")) { nm = h.text; break } } if (!nm) nm = c.text.split("[")[0] }
    if (nm && !names.includes(nm)) names.push(nm)
  }
  return names
}
for (const f of sample) {
  let content: string; try { content = readFileSync(f, "utf8") } catch { skipped++; continue }
  let res: any, tree: any
  try { tree = parser.parse(content); res = await analyzer.analyze(tree.rootNode, content, f); parsed++ } catch { skipped++; try { tree?.delete?.() } catch {} ; continue }
  for (const rel of res.relationships ?? []) {
    const t = String(rel.type ?? ""); analyzerEdges++
    if (LABELS.includes(t)) after[t] = (after[t] ?? 0) + 1
  }
  // independent PRE-RULING labeling from the same AST
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop(); if (!n) continue
    if (DECL.has(n.type)) {
      let clause: any = null
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c?.type === "extends_clause") { clause = c; break } }
      const names = heritageNames(clause)
      const traitOrEnum = n.type === "trait_definition" || n.type === "enum_definition"
      for (let i = 0; i < names.length; i++) {
        const label = traitOrEnum ? "extends" : i === 0 ? "extends" : "implements"
        before[label] = (before[label] ?? 0) + 1
      }
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  try { tree?.delete?.() } catch {}
}
const beforeTotal = LABELS.reduce((s, l) => s + (before[l] ?? 0), 0)
const afterTotal = LABELS.reduce((s, l) => s + (after[l] ?? 0), 0)
const report = {
  probe: "scala-mixin-probe", generatedAt: new Date().toISOString(),
  population: { admitted: files.length, repos: repos.size, sampled: sample.length, parsed, skipped, stride },
  labels: Object.fromEntries(LABELS.map((l) => [l, { before: before[l] ?? 0, after: after[l] ?? 0 }])),
  invariant: { beforeHeritageEdges: beforeTotal, afterHeritageEdges: afterTotal, totalAnalyzerEdges: analyzerEdges, invariant: beforeTotal === afterTotal },
  note: "BOUNDED 600-file stride sample; 'before' = pre-ruling labeling derived independently from the same AST (class/object pos0 extends then implements; trait/enum all extends), 'after' = the analyzer's actual labels at HEAD. Relabel-only: heritage-edge TOTAL must be invariant.",
}
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n")
console.log(JSON.stringify(report, null, 1))
