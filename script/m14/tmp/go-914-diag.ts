// go #914 — WHY a pair disagrees: the analyzer's own symbols and signatures
// beside the oracle's derivation, for ONE file.
//
// Run: bun script/m14/tmp/go-914-diag.ts <file>
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoImplements } from "../differential"

const file = process.argv[2]
const src = fs.readFileSync(file, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree = parser.parse(src)
const analyzer = new RealGoAnalyzer()
const res: any = await analyzer.analyze(tree.rootNode, src, file)

console.log(`=== ${file}  (parse error: ${tree.rootNode.hasError})`)
console.log("--- types/interfaces/structs ---")
for (const s of res.symbols ?? []) {
  if (["struct", "interface", "type", "class"].includes(String(s.kind))) {
    console.log(`  ${String(s.kind).padEnd(9)} ${s.name}${s.metadata?.isEmbeddedInterface ? "  <embedded-iface>" : ""}`)
  }
}
console.log("--- methods (name, owner, params, return) ---")
for (const s of res.symbols ?? []) {
  if (String(s.kind) !== "method") continue
  const params = (s.parameters ?? []).map((p: any) => `${p.name ?? ""}:${p.type ?? ""}`).join(", ")
  console.log(`  ${s.ownerName}::${s.name}(${params}) -> ${s.returnType ?? "void"}`)
}
console.log("--- analyzer implements rows ---")
for (const r of res.relationships ?? []) {
  if (String(r.type) !== "implements") continue
  console.log(`  ${r.source} -> ${r.target}   ${JSON.stringify(r.metadata ?? {}).slice(0, 120)}`)
}
console.log("--- oracle implements rows ---")
for (const e of deriveGoImplements(tree.rootNode)) {
  console.log(`  ${e.from} -> ${e.target}`)
}
