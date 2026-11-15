import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealBashAnalyzer } from "../../../../src/ast/real-bash-analyzer"

const files = process.argv.slice(2)
const a = new RealBashAnalyzer()
for (const f of files) {
  const content = readFileSync(f, "utf8")
  const parsed = await ASTEngine.getParser("bash")
  const tree = parsed!.parse(content)!
  const r: any = a.analyze(tree.rootNode, content, f)
  console.log(`\nfile: ${f}`)
  const exported = r.symbols.filter((s: any) => s.metadata?.isExported).map((s: any) => `${s.kind}:${s.name}`)
  const exportEdges = r.relationships.filter((x: any) => String(x.type).toLowerCase() === "exports").map((x: any) => x.target)
  console.log(`  exports EDGES (${exportEdges.length}): ${exportEdges.join(", ")}`)
  console.log(`  symbols with metadata.isExported (${exported.length}): ${exported.join(", ")}`)
  const missing = exportEdges.filter((t: string) => !exported.some((e: string) => e.endsWith(`:${t}`)))
  console.log(`  edge targets with NO isExported symbol (${missing.length}): ${missing.join(", ")}`)
  console.log(`  result.exports[] (${(r.exports ?? []).length}): ${(r.exports ?? []).map((x: any) => x.name).join(", ")}`)
}
