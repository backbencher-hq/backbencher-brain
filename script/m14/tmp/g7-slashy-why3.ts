// Minimal repro of the missing slashy read. The isolated probe emitted
// uses->style, but the fixture file does not. Binary-search the difference:
// same analyzer, minimal source, only the slashy method.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import * as m from "../run-fixtures"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

async function run(label: string, src: string): Promise<void> {
  const parser: any = await (m as any).getParser("groovy")
  const tree = parser.parse(src)
  const a: any = new RealGroovyAnalyzer()
  const res: any = await a.analyze(tree.rootNode, src, "x.groovy")
  const reads = (res.relationships ?? []).filter((r: any) => (r.metadata ?? {}).isInterpolationRead)
  console.log(`${label.padEnd(28)} reads=${JSON.stringify(reads.map((r: any) => `${r.source}->${r.target}@${r.line_number}`))}`)
}

async function main(): Promise<void> {
  await run("slashy-only", 'class C {\n  String f(className) {\n    def pattern = /${className}.groovy/\n    return pattern\n  }\n}\n')
  await run("slashy-free-var", 'class C {\n  def f() {\n    def pattern = /${className}.groovy/\n    return pattern\n  }\n}\n')
  await run("dquote-free-var", 'class C {\n  def f() {\n    def pattern = "${className}.groovy"\n    return pattern\n  }\n}\n')
  await run("slashy-in-method-with-args", 'class C {\n  String slashyFilter(className) {\n    def pattern = /${className}.groovy/\n    return pattern\n  }\n}\n')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
