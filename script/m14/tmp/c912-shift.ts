// Where does the one-line shift come from? Raw web-tree-sitter parse of the
// SAME text the analyzer is handed, then the analyzer's own output, then the
// same through ASTEngine.parseTree (the shared entry the analyzer uses).
//
// Usage: bun script/m14/tmp/c912-shift.ts <file>
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const abs = process.argv[2]
const src = readFileSync(abs, "utf8")
const lines = src.split("\n")
const needle = process.argv[3] ?? "OnFinalize"

console.log(`file lines=${lines.length}`)
const trueLine = lines.findIndex((l) => l.includes(`bool ${needle}(bool failed);`)) + 1
console.log(`the declaration 'bool ${needle}(bool failed);' is written at ${trueLine}: ${(lines[trueLine - 1] ?? "").trim()}`)

// 1. raw parse of the file's own text
const P: any = (WTS as any).Parser ?? (WTS as any).default
const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const p = new P()
p.setLanguage(lang)
const tree = p.parse(src)
const hits: string[] = []
const walk = (n: any): void => {
  const t = n.text ?? ""
  if (t.length < 200 && t.includes(`${needle}(bool failed);`)) hits.push(`${n.type} row=${n.startPosition.row} (line ${n.startPosition.row + 1}) | ${t.replace(/\n/g, "\\n").slice(0, 60)}`)
  for (let i = 0; i < n.childCount; i++) walk(n.child(i))
}
walk(tree.rootNode)
console.log("\n=== raw tree (file's own text) ===")
for (const h of hits) console.log("  " + h)

// 2. the shared engine entry the analyzer is given
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const et: any = await ASTEngine.parseTree(abs, src)
const hits2: string[] = []
const walk2 = (n: any): void => {
  const t = n.text ?? ""
  if (t.length < 200 && t.includes(`${needle}(bool failed);`)) hits2.push(`${n.type} row=${n.startPosition.row} (line ${n.startPosition.row + 1})`)
  for (let i = 0; i < n.childCount; i++) walk2(n.child(i))
}
walk2(et.tree.rootNode)
console.log("\n=== ASTEngine.parseTree (what the analyzer walks) ===")
for (const h of hits2) console.log("  " + h)

// 3. the analyzer's own output for that name
const { parseFile } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await parseFile(abs, src, { language: "cpp" })
console.log("\n=== analyzer symbols named " + needle + " ===")
for (const s of res.symbols ?? []) {
  if (String(s.name) !== needle) continue
  console.log(`  claimed startLine=${s.range?.startLine} kind=${s.kind} owner=${s.ownerName ?? "-"} meta=${JSON.stringify(s.metadata ?? {}).slice(0, 120)}`)
}
