// Which 12 of csharp's 241 node types are unclassified? The gate says 12 (241 - 51 - 164 - 0 - 14)
// but its detail line does not name them, so this reproduces its own arithmetic from the same
// sources and prints the set. A count without the names is a number to remember, not a defect to
// fix; the names are the defect.
import * as fs from "fs"
import * as path from "path"
const ROOT = process.cwd()
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/csharp-completeness.json"), "utf8"))
const classified = new Set<string>([
  ...(spec.handled_verified?.types ?? spec.handled_verified?.handled ?? []),
  ...(spec.internal_silent?.types ?? []),
  ...(spec.gap?.gaps ?? []),
  ...(spec.design_decision?.decisions ?? []),
])
console.log(`  spec classifies: handled=${spec.handled_verified?.types?.length ?? spec.handled_verified?.handled?.length} silent=${spec.internal_silent?.types.length} gaps=${spec.gap?.gaps.length} decisions=${spec.design_decision?.decisions.length}`)
// get the analyzer's actual type set the same way the gate does: parse the corpus
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const files = fs.readFileSync("/home/sano/ishaq/bb_tests/lists/roslyn-src.txt", "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 200)
const seen = new Set<string>()
for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  if (src.length > 1_000_000) continue
  let root: any
  try { root = p.parse(src).rootNode } catch { continue }
  const st: any[] = [root]
  while (st.length) { const n = st.pop()!; seen.add(n.type); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } }
}
const un = [...seen].filter((t) => !classified.has(t)).sort()
console.log(`\n  node types observed in 200 roslyn files: ${seen.size}`)
console.log(`  UNCLASSIFIED (${un.length}):`)
for (let i = 0; i < un.length; i += 6) console.log("    " + un.slice(i, i + 6).join(", "))
