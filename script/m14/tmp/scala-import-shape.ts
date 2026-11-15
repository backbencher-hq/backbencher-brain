import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `package x
import scala.collection.mutable.{Map => MutMap, Set}
import java.util.{UUID, List => JList}
object A { val m = MutMap.empty }
`
const root = p.parse(src).rootNode
const hist = new Map<string, number>()
const rename: string[] = []
const walk = (n: any): void => {
  hist.set(n.type, (hist.get(n.type) ?? 0) + 1)
  if (n.type.includes("import") || n.type.includes("selector")) {
    if (n.text.includes("=>")) rename.push(`${n.type}: ${JSON.stringify(n.text)}`)
  }
  for (const c of n.namedChildren ?? []) walk(c)
}
walk(root)
console.log("import-related node types:")
for (const [k, v] of [...hist].filter(([k]) => /import|selector|stable/.test(k)).sort()) console.log(`  ${v}  ${k}`)
console.log("\nnodes containing '=>' (scala RENAMES with =>, not `as`):")
for (const r of [...new Set(rename)]) console.log(`  ${r}`)
