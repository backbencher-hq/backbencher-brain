import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const file = "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/UseCollectionInitializer/UpdateExpressionState.cs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { deriveCSharpBareUses }: any = await import(path.join(ROOT, "script/m14/tmp/cs-deep-26-bare-uses-truth.ts"))
const src = fs.readFileSync(file, "utf8")
const res: any = await ASTEngine.parseFile(file, src)
const truth = deriveCSharpBareUses(p.parse(src).rootNode, res.symbols ?? [])
console.log("TRUTH rows for this file:")
for (const t of truth) console.log(`   ${t.from} -> ${t.target}`)
const an = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "uses" && String((r.metadata ?? {}).relationshipType) === "identifier_usage")
console.log("ANALYZER identifier_usage rows for this file:")
for (const r of an) console.log(`   ${r.source} -> ${r.target}`)
console.log("\nwhich methods own lines 112 and 202?")
const root = p.parse(src).rootNode
const w = (n: any): void => { if (n.type === "method_declaration" || n.type === "constructor_declaration") { const nm = n.childForFieldName?.("name")?.text; const a = n.startPosition.row+1, b = n.endPosition.row+1; if ((a <= 112 && b >= 112) || (a <= 202 && b >= 202)) console.log(`   line ${a}-${b}: ${n.type} ${nm}`) } for (let i=0;i<n.namedChildCount;i++){const c=n.namedChild(i); if(c) w(c)} }
w(root)
