// c-proto-dump.ts — symbols + metadata for one c/cpp file through the analyzer,
// so the declaration/definition marker can be read off the analyzer's own output.
//   bun script/m14/tmp/c-proto-dump.ts <file> [cpp]
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __filename = fileURLToPath(import.meta.url)

const HERE = (import.meta as any).dir ?? path.dirname((import.meta as any).filename ?? __filename)
const ROOT = path.resolve(HERE, "..", "..", "..")
const file = path.resolve(process.argv[2])
const lang = process.argv[3] === "cpp" ? "cpp" : "c"
const cfg = lang === "cpp"
  ? { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer" }
  : { wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer" }

await (Parser as any).init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const p = new Parser()
p.setLanguage(g)
const src = fs.readFileSync(file, "utf8")
const root = p.parse(src).rootNode
const mod: any = await import(`${ROOT}/src/ast/${cfg.analyzerFile}`)
const res: any = await new mod[cfg.className]().analyze(root, src, path.basename(file))

console.log(`# ${path.basename(file)} (${lang}) errors=${root.hasError}`)
console.log(`# symbols (${res.symbols.length}):`)
for (const s of res.symbols) {
  console.log(`  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(22)} line=${s.range?.startLine} metadata=${JSON.stringify(s.metadata ?? null)}`)
}
console.log(`# relationships (${res.relationships.length}):`)
for (const r of res.relationships) {
  console.log(`  ${String(r.type).padEnd(10)} ${String(r.source).padEnd(14)} -> ${String(r.target).padEnd(24)} line=${r.line_number}`)
}
