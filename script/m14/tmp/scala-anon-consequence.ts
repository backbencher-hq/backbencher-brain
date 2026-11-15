// What does a duplicate `anonymous_X` name COST?
//
// 402 scala3 files declare the same synthetic name for 2+ genuinely distinct
// anonymous classes. This asks what the graph does with them: are the members of
// the second, third and fourth class MERGED into the first's node, so the graph
// carries one class where the source has four?
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const f = process.argv[2]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const parser = new P(); parser.setLanguage(gl)
const analyzer = new RealScalaAnalyzer()
const src = fs.readFileSync(f, "utf8")
const res: any = analyzer.analyze(parser.parse(src).rootNode, src, f)
console.log(`# ${path.basename(f)}\n`)
console.log("anonymous symbols, as published:")
for (const s of (res.symbols ?? []).filter((x: any) => String(x.name).startsWith("anonymous_"))) {
  console.log(`  ${JSON.stringify(s.name).padEnd(42)} kind=${String(s.kind).padEnd(10)} line=${s.range?.startLine}`)
}
const owner = "anonymous_TypeTraverser"
const members = (res.relationships ?? []).filter((r: any) => String(r.type) === "contains" && String(r.source) === owner)
console.log(`\ncontains rows whose SOURCE is ${owner}: ${members.length}`)
for (const m of members) console.log(`  -> ${m.target}   line ${m.line_number ?? "-"}`)
// how many DISTINCT source lines do those members' declarations sit on?
const lines = new Set<number>()
for (const m of members) {
  const s = (res.symbols ?? []).find((x: any) => x.name === m.target)
  if (s?.range?.startLine) lines.add(s.range.startLine)
}
console.log(`\nmembers declared on ${lines.size} distinct lines: ${[...lines].sort((a, b) => a - b).join(", ")}`)
console.log(`=> ${members.length} member names are all attributed to ONE owner, but they come from ${lines.size} distinct classes.`)
