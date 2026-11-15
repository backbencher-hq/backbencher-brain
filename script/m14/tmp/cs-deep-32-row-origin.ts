import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
for (const [file, want] of [
  ["/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/UseCollectionInitializer/UpdateExpressionState.cs", ["SemanticModel"]],
  ["/home/sano/ishaq/bb_tests/repositories/roslyn/src/Compilers/VisualBasic/Portable/CodeAnalysis/AbstractImplementInterfaceService.State.cs", ["Document"]],
] as Array<[string,string[]]>) {
  const src = fs.readFileSync(file, "utf8"); const root = p.parse(src).rootNode
  const res: any = await ASTEngine.parseFile(file, src)
  console.log(`\n=== ${path.basename(file)}`)
  for (const r of res.relationships ?? []) {
    if ((r.type ?? r.relationshipType) !== "uses") continue
    if (!want.includes(r.target)) continue
    const m = (r.metadata ?? {})
    console.log(`   ${String(r.source).padEnd(46)} -> ${String(r.target).padEnd(14)} marker=${String(m.relationshipType).padEnd(20)} line=${r.line_number} nodeType=${m.nodeType}`)
  }
  // and the node shape of every occurrence, with the field name the gate reads
  const w = (n: any): void => {
    if (n.type === "identifier" && want.includes(n.text)) {
      const p2 = n.parent
      console.log(`   TREE line ${String(n.startPosition.row + 1).padStart(4)}  parent=${p2?.type}  nameField=${p2?.childForFieldName?.("name")?.text ?? "-"}  exprField=${p2?.childForFieldName?.("expression")?.text?.slice(0,20) ?? "-"}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) w(c) }
  }
  w(root)
}
