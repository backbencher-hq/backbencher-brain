// Dumps exactly what the analyzer publishes for the #914 fixture, so the
// expectation JSON is authored from the output, not from a guess.
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
const file = process.argv[2]
const src = fs.readFileSync(file, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree = parser.parse(src)
const res: any = await new RealGoAnalyzer().analyze(tree.rootNode, src, file)
console.log("--- symbols")
for (const s of res.symbols ?? []) {
  if (["struct", "interface", "type", "class", "module"].includes(String(s.kind))) console.log(`  {"name":"${s.name}","kind":"${s.kind}"}`)
}
console.log("--- implements/extends")
for (const r of res.relationships ?? []) {
  const t = String(r.type)
  if (t === "implements") console.log(`  ${t} ${r.source} -> ${r.target}  rt=${r.metadata?.relationshipType} ev=${r.metadata?.evidenceClass ?? "?"} recv=${r.metadata?.receiverSet}`)
  if (t === "extends") console.log(`  ${t} ${r.source} -> ${r.target}  rt=${r.metadata?.relationshipType} ev=${r.metadata?.evidenceClass ?? "?"}`)
}
console.log("--- methods + params")
for (const s of res.symbols ?? []) {
  if (String(s.kind) !== "method") continue
  console.log(`  ${s.ownerName}::${s.name} ${JSON.stringify((s.parameters ?? []).map((p: any) => ({ name: p.name, type: p.type, ...(p.isVariadic ? { isVariadic: p.isVariadic } : {}) })))}`)
}
