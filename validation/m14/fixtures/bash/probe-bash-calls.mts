import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealBashAnalyzer } from "../../../../src/ast/real-bash-analyzer"
const f = process.argv[2]
const content = readFileSync(f, "utf8")
const parsed = await ASTEngine.getParser("bash")
const tree = parsed!.parse(content)!
const r: any = new RealBashAnalyzer().analyze(tree.rootNode, content, f)
console.log(`patterns: ${JSON.stringify(r.metadata.patterns)}`)
console.log(`calls edges:`)
for (const x of r.relationships.filter((y: any) => String(y.type).toLowerCase() === "calls")) {
  console.log(`  ${x.source} -> ${JSON.stringify(x.target)} @${x.line_number} conf=${x.confidence} meta=${JSON.stringify(x.metadata)}`)
}
console.log(`all relationship types: ${JSON.stringify([...new Set(r.relationships.map((x: any) => String(x.type).toLowerCase()))])}`)