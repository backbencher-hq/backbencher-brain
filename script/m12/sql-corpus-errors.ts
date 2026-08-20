import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

const corpus = process.argv[2] || "$HOME/ProxiCall"
const wasmPath = process.argv[3] || resolveWasmAsset("tree-sitter-sql.wasm")
const W: any = await loadWebTreeSitter()
const ParserCtor = W.Parser ?? W.default ?? W
const LanguageCtor = W.Language ?? W.default?.Language
const init = W.init ?? ParserCtor.init
if (init) await init({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const grammar = await LanguageCtor.load(new Uint8Array(readFileSync(wasmPath)))
const files = execFileSync("git", ["-C", corpus, "ls-files", "*.sql", "*.SQL", "*.psql", "*.ddl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const errors: { file: string; nodes: number; bytes: number }[] = []
let errorNodes = 0
let totalBytes = 0
for (const rel of files) {
  const parser = new ParserCtor()
  parser.setLanguage(grammar)
  const text = readFileSync(`${corpus}/${rel}`, "utf8")
  totalBytes += text.length
  const tree = parser.parse(text)
  let nodes = 0
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "ERROR" || n.isMissing) { nodes++; errorNodes++ }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (nodes) errors.push({ file: rel, nodes, bytes: text.length })
  parser.delete?.()
}
const result = { grammar: "@derekstride/tree-sitter-sql 0.3.11", corpus, wasmArtifact: wasmPath.split("/").pop(), files: files.length, errorFiles: errors.length, errorNodes, totalBytes, errors: errors.slice(0, 100) }
writeFileSync("validation/m12/results/sql-corpus-errors.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
