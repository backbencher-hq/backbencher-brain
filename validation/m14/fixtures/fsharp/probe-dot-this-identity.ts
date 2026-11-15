/** Direct analyzer call: does `RealFsharpAnalyzer.analyze` publish the `.this` symbol, or only the edge? */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { RealFsharpAnalyzer } from "../../../../src/ast/real-fsharp-analyzer"
import { parseFile } from "../../../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = "/home/ishaq2321/bb_tests/repositories"

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-fsharp.wasm"))))

const FILES = [
  ["fsharp", "fsharp/tests/service/data/SyntaxTree/Type/As 03.fs"],
  ["fsharp", "fsharp/tests/service/data/SyntaxTree/Member/Member 02.fs"],
]

for (const [repo, rel] of FILES) {
  const abs = `${CR}/${rel}`
  const text = readFileSync(abs, "utf8")
  const tree = parser.parse(text)
  const direct: any = new RealFsharpAnalyzer().analyze(tree.rootNode, text, abs)
  tree.delete?.()
  const prod: any = await parseFile(abs, repo)

  console.log("=".repeat(78))
  console.log(rel)
  const ds = direct.symbols ?? []
  const ps = prod.symbols ?? []
  console.log(`  analyze() symbols ${ds.length}: ${ds.map((s: any) => `${s.name}${s.ownerName ? "<" + s.ownerName + ">" : ""}`).join("  ")}`)
  console.log(`  parseFile symbols ${ps.length}: ${ps.map((s: any) => `${s.name}${s.ownerName ? "<" + s.ownerName + ">" : ""}`).join("  ")}`)
  const de = (direct.relationships ?? []).filter((r: any) => /\.this$/.test(String(r.target)))
  for (const e of de) console.log(`  analyze() EDGE ${e.type} ${e.source} -> ${e.target} line=${(e as any).line_number}`)
  console.log(`  analyze() contains edges: ${(direct.relationships ?? []).filter((r: any) => String(r.type) === "contains").length}`)
  // THE INVARIANT IS ABOUT WHAT THE CONSUMER RECEIVES, so the deciding count is taken from
  // `parseFile`, not from `analyze()`. A first cut of this probe printed only the analyzer's
  // edges and therefore reported "no change" after a fix that had in fact worked.
  const pe = (prod.relationships ?? []).filter((r: any) => /\.this$/.test(String(r.target)))
  console.log(`  parseFile EDGES naming .this: ${pe.length}   ${pe.map((e: any) => `${e.type} ${e.source} -> ${e.target}`).join("  ") || "(none)"}`)
}
process.exit(0)
