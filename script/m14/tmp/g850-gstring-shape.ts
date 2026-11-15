import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const CASES: Array<[string, string]> = [
  ["plain", 'def s = "no interp"\n'],
  ["braced", 'def s = "${field}"\n'],
  ["braced-call", 'def s = "${obj.method()}"\n'],
  ["dollar-ident", 'def s = "value $field"\n'],
  ["nested-quote", 'def s = "${System.getenv("X")}"\n'],
  ["sq-braced", "def s = '${field}'\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`\n### ${name}  hasError=${root?.hasError}`)
    console.log(root?.toString())
    const a = new RealGroovyAnalyzer()
    const res: any = a.analyze(root!, src, "t.groovy")
    const rels = (res.relationships ?? []).map((r: any) => `${r.type} ${r.source} -> ${r.target}`)
    console.log(`  analyzer rels: ${rels.length ? rels.join(" | ") : "(none)"}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
