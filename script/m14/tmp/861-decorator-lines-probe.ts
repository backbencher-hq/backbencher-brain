// #861 probe: for each decorated declaration, print the symbol's range, the
// exports/contains lines that are derived from it, and the parse-tree shape that
// put the decorator inside the range. Read-only.
import * as fs from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FIX = process.argv.find((a) => a.startsWith("--fixture="))?.slice("--fixture=".length) ??
  "validation/m14/fixtures/typescript/decorator-lines-860.ts"
const LANG = FIX.endsWith(".js") ? "javascript" : "typescript"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const wasm = LANG === "javascript" ? "tree-sitter-javascript.wasm" : "tree-sitter-typescript.wasm"
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const parser = new P()
  parser.setLanguage(grammar)
  const abs = path.join(ROOT, FIX)
  const content = fs.readFileSync(abs, "utf8")
  const tree = parser.parse(content)

  console.log("=== TREE SHAPE: nodes whose text contains a decorator ===")
  const walk = (n: any, depth = 0) => {
    if (n.type === "export_statement" || n.type === "public_field_definition" || n.type === "class_declaration" || n.type === "decorator") {
      const kids: string[] = []
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) kids.push(`${c.type}@${c.startPosition.row + 1}`)
      }
      console.log(`${"  ".repeat(depth)}${n.type} starts L${n.startPosition.row + 1} children=[${kids.join(", ")}]`)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), depth + 1)
  }
  walk(tree.rootNode)

  const res: any = await ASTEngine_parse(abs, content)
  console.log("\n=== SYMBOLS (range + decorators) ===")
  for (const s of res.symbols ?? []) {
    console.log(
      `   L${String(s.range?.startLine).padStart(3)}-${String(s.range?.endLine).padEnd(3)} col${String(s.range?.startColumn).padStart(3)} ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(10)} decorators=${JSON.stringify(s.decorators ?? [])}`,
    )
  }
  console.log("\n=== EXPORTS ===")
  for (const e of res.exports ?? []) console.log(`   ${String(e.name).padEnd(12)} line=${e.range?.startLine}`)
  console.log("\n=== RELATIONSHIPS (contains/references with a line) ===")
  for (const r of res.relationships ?? []) {
    if (true)
      console.log(`   L${String(r.line_number).padStart(3)} ${String(r.type).padEnd(10)} ${String(r.source).padEnd(10)} -> ${String(r.target).padEnd(10)} meta=${JSON.stringify(r.metadata ?? {})}`)
  }
}

async function ASTEngine_parse(file: string, content: string) {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  return ASTEngine.parseFile(file, content)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LANG_USED = LANG

main()
