// JD14 adjudication — WHICH edges are the 33 lodash `unexplained` rows?
// The new contains-truth only derives method_definition / field_definition
// containment. The analyzer ALSO emits contains for prototype-assignment
// methods (`X.prototype.m = function(){}`), which the truth does not derive —
// so these are candidate TRUTH defects, not analyzer fabrications.
// (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import { deriveJavaScriptEdges } from "../../../script/m14/differential"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/bb_tests/repositories/lodash"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any

  const files: string[] = []
  const walk = (d: string, depth = 0): void => {
    if (depth > 12) return
    let es: fs.Dirent[]
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const q = path.join(d, e.name)
      if (e.isDirectory()) walk(q, depth + 1)
      else if (e.name.endsWith(".js")) files.push(q)
    }
  }
  walk(ROOT)

  const byShape = new Map<string, { count: number; example: string }>()
  let totalUnexplained = 0
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400000) continue
    let tree: any
    try { tree = p.parse(src) } catch { continue }
    const r = await a.analyze(tree.rootNode, src, f, undefined)

    const truth = new Set(deriveJavaScriptEdges(tree.rootNode).map((e: any) => `${e.label}:${e.target}`))
    const rels = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "contains")

    for (const rel of rels) {
      const k = `contains:${rel.target}`
      if (truth.has(k)) continue
      totalUnexplained++
      // classify by the SOURCE node shape that could have produced it
      const owner = rel.source
      const kind = (r.symbols ?? []).find((s: any) => s.name === rel.target && s.kind === "method")
      const shape = kind?.metadata?.isPrototypeMethod
        ? "prototype assignment (X.prototype.m = fn) — TRUTH does not derive it"
        : kind?.ownerName
          ? "class member — TRUTH should have derived it (TRUTH BUG)"
          : "ownerless member — analyzer emitted contains with no ownerName (ANALYZER BUG)"
      const cur = byShape.get(shape) ?? { count: 0, example: "" }
      cur.count++
      if (!cur.example) cur.example = `${path.basename(f)}: ${owner} -> ${rel.target} (ownerName=${kind?.ownerName ?? "-"}, isPrototypeMethod=${!!kind?.metadata?.isPrototypeMethod})`
      byShape.set(shape, cur)
    }
  }
  console.log(`total unexplained contains edges across lodash: ${totalUnexplained}\n`)
  for (const [shape, v] of [...byShape.entries()].sort((x, y) => y[1].count - x[1].count)) {
    console.log(`  ${String(v.count).padStart(4)}  ${shape}`)
    console.log(`        e.g. ${v.example}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
