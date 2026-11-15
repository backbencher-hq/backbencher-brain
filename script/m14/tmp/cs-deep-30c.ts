import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const file = "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/UseCollectionInitializer/UpdateExpressionState.cs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const src = fs.readFileSync(file, "utf8"); const root = p.parse(src).rootNode
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await ASTEngine.parseFile(file, src)
// print EVERY identifier named SemanticModel/Document with: line, enclosing callable, parent node type, and whether the analyzer has a row for that callable
const lines = src.split("\n")
const w = (n: any, fn: string | null, cls: string | null): void => {
  let f = fn, c = cls
  if (n.type === "method_declaration") f = n.childForFieldName?.("name")?.text ?? null
  if (n.type === "constructor_declaration") f = "constructor"
  if (n.type === "local_function_statement") f = n.childForFieldName?.("name")?.text ?? null
  if (/^(class|struct|record|interface)_declaration$/.test(n.type)) c = n.childForFieldName?.("name")?.text ?? c
  if (n.type === "identifier" && (n.text === "SemanticModel" || n.text === "Document")) {
    const tf = n.parent?.childForFieldName?.("type"), nf = n.parent?.childForFieldName?.("name")
    const inType = tf && n.startIndex >= tf.startIndex && n.endIndex <= tf.endIndex
    const inName = nf && n.startIndex === nf.startIndex && n.endIndex === nf.endIndex
    console.log(`line ${String(n.startPosition.row + 1).padStart(4)}  ${n.text.padEnd(13)} callable=${(f ?? "<class scope>").padEnd(42)} parent=${(n.parent?.type ?? "?").padEnd(26)} inTypeField=${inType ?? false} inNameField=${inName ?? false}`)
    console.log(`        | ${lines[n.startPosition.row].trim().slice(0, 92)}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) w(ch, f, c) }
}
w(root, null, null)
