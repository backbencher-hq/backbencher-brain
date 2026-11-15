// Adjudicate the 48 `exports` rows the analyzer emits that the new truth does not
// derive, on the lodash corpus. (2026-09-27)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import { deriveJavaScriptEdges } from "../../../script/m14/differential"
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/bb_tests/repositories/lodash"

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

  const byShape = new Map<string, { n: number; ex: string[] }>()
  let total = 0
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400000) continue
    let tree: any
    try { tree = p.parse(src) } catch { continue }
    const r = await a.analyze(tree.rootNode, src, f, undefined)
    const truth = new Set(deriveJavaScriptEdges(tree.rootNode).map((e: any) => `${e.label}:${e.target}`))
    for (const rel of r.relationships ?? []) {
      if (String(rel.type).toLowerCase() !== "exports") continue
      const k = `exports:${rel.target}`
      if (truth.has(k)) continue
      total++
      // what does the SOURCE actually say about this name?
      const isMin = /\.min\.js$/.test(f)
      const shape = isMin ? "minified bundle" : "named export the truth did not derive"
      const cur = byShape.get(shape) ?? { n: 0, ex: [] }
      cur.n++
      if (cur.ex.length < 4) cur.ex.push(`${path.basename(f)}: exports -> ${JSON.stringify(rel.target)}`)
      byShape.set(shape, cur)
    }
  }
  console.log(`unexplained exports edges across lodash: ${total}\n`)
  for (const [shape, v] of [...byShape.entries()].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${String(v.n).padStart(4)}  ${shape}`)
    for (const e of v.ex) console.log(`          ${e}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
