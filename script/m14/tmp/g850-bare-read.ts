import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const CASES: Array<[string, string]> = [
  ["bare-ident-read", "class A {\n  def f() {\n    def m = otherField\n    consume(m)\n  }\n}\n"],
  ["field-access-read", "class A {\n  def f() {\n    def m = this.label\n    consume(m)\n  }\n}\n"],
  ["local-read", "class A {\n  def f() {\n    def x = 1\n    def y = x\n  }\n}\n"],
  ["static-read", "class A {\n  def f() {\n    def m = Const.VALUE\n  }\n}\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    const a = new RealGroovyAnalyzer()
    const res: any = a.analyze(root!, src, "t.groovy")
    const rels = (res.relationships ?? []).map((r: any) => `${r.type} ${r.source} -> ${r.target}${r.line_number ? "@" + r.line_number : ""}`)
    console.log(`${name.padEnd(22)} ${rels.length ? rels.join(" | ") : "(none)"}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
