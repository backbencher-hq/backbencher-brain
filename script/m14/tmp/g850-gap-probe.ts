// #850 residual: is `exclude group: '…', module: '…'` (a paren-less command
// expression with named arguments) a real grammar gap, and is the failure the
// same one seen in the .gradle census? Measure shapes one at a time.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["named-args-bare", "exclude group: 'org.apache.groovy'\n"],
  ["named-args-two", "exclude group: 'org.apache.groovy', module: 'groovy'\n"],
  ["named-args-dquote", 'exclude group:"org.apache.grails.async", module:\'grails-async\'\n'],
  ["named-args-in-closure", "dependencies {\n  api(platform('x')) {\n    exclude group: 'a'\n  }\n}\n"],
  ["cmd-trailing-brace", 'api project(":grails-datamapping-core"), {\n    exclude group: "a"\n}\n'],
  ["cmd-trailing-closure", "api project(':x') {\n    exclude group: 'a'\n}\n"],
  ["named-args-var", "overriddenModules.each { ovr ->\n  exclude group: ovr.group, module: ovr.module\n}\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const tree = parser.parse(src)
    if (!tree) {
      console.log(`${name.padEnd(22)} PARSE-NULL`)
      continue
    }
    const root = tree.rootNode
    const errs: string[] = []
    const missing: string[] = []
    const walk = (n: any): void => {
      if (n.type === "ERROR") errs.push(`ERROR@${n.startPosition.row}:${n.startPosition.column}`)
      if (n.isMissing) missing.push(`${n.type}@${n.startPosition.row}:${n.startPosition.column}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    const ok = errs.length === 0 && missing.length === 0
    console.log(`${name.padEnd(22)} ${ok ? "PARSE-OK " : "FAIL     "} errors=[${errs.join(",")}] missing=[${missing.join(",")}]`)
  }
  console.log("\n--- full trees ---")
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const tree = parser.parse(src)
    if (!tree) continue
    console.log(`\n### ${name}\n${tree.rootNode.toString()}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
