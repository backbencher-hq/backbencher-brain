import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
const P = "validation/m14/fixtures/go/grouped-and-embedded-fields-889.go"
const src = fs.readFileSync(P, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree: any = parser.parse(src)
console.log("hasError:", tree.rootNode.hasError)
const res: any = await new RealGoAnalyzer().analyze(tree.rootNode, src, P)
console.log("=== symbols")
for (const s of res.symbols ?? []) console.log(`  ${s.kind}: ${s.name}${s.ownerName ? ` owner=${s.ownerName}` : ""}${s.metadata?.isEmbeddedField ? " [embedded]" : ""}${s.metadata?.groupedFieldDeclaration ? " [grouped]" : ""}`)
console.log("=== relationships")
for (const r of res.relationships ?? []) console.log(`  ${r.type} ${r.source} -> ${r.target} (line ${r.line_number ?? r.metadata?.line ?? "?"})`)
