// #915 fixture dump: what does the analyzer surface on bare-macro-statements
// with the patched analyzer (working tree) — symbols, their lines, and the
// error lines, so the expectation can be pinned to measured truth.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = (wts.Parser ?? wts.default) as any
const L = (wts.Language ?? wts.default?.Language) as any
const wasm = process.argv[2] ?? `${ROOT}/wasm/tree-sitter-cpp.wasm`
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang = await L.load(readFileSync(wasm))
const parser = new P()
parser.setLanguage(lang)
const F = `${ROOT}/validation/m14/fixtures/cpp/bare-macro-statements.cpp`
const src = readFileSync(F, "utf8")
const tree = parser.parse(src)
const errLines: number[] = []
const walk = (n: any) => {
  if (n.type === "ERROR" || n.isMissing) errLines.push(n.startPosition.row + 1)
  for (const c of n.children ?? []) walk(c)
}
walk(tree.rootNode)
console.log("error lines:", [...new Set(errLines)].join(",") || "(none)")
console.log("root children:")
for (const c of tree.rootNode.children ?? []) {
  console.log(`@${c.startPosition.row + 1} ${c.type} ${JSON.stringify(c.text.length > 40 ? c.text.slice(0, 40) + "…" : c.text)}`)
}
const { parseFile } = await import(`${ROOT}/src/ast/engine.ts`)
const out = await parseFile(F, src, { language: "cpp" } as any)
console.log("symbols:")
for (const s of (out.symbols ?? []).sort((a: any, b: any) => a.range.startLine - b.range.startLine)) {
  console.log(`  @${s.range.startLine} ${s.kind} ${s.name}${s.ownerName ? ` (owner ${s.ownerName})` : ""}`)
}
console.log("relationships:")
for (const r of out.relationships ?? []) {
  const any = r as any
  console.log(`  @${any.line_number} ${any.type ?? any.relationshipType} ${any.source ?? any.fromSymbol ?? any.from} -> ${any.target ?? any.toSymbol ?? any.to} ${JSON.stringify(Object.keys(any).filter(k => !["id", "metadata", "confidence"].includes(k))) }`)
}
