// Characterize the paren-less command-argument gap precisely.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["two-literals", "foo 'a', 'b'\n"],
  ["two-identifiers", "foo a, b\n"],
  ["one-map-one-lit", "foo group: 'a', 'b'\n"],
  ["one-map-one-id", "foo group: 'a', b\n"],
  ["two-maps", "foo group: 'a', module: 'b'\n"],
  ["two-maps-key-expr", "foo group: 'a', module: y\n"],
  ["map-then-map-parens", "foo(group: 'a', module: 'b')\n"],
  ["method-two-maps", "x.foo group: 'a', module: 'b'\n"],
  ["map-literal", "foo([group: 'a', module: 'b'])\n"],
  ["three-maps", "foo group: 'a', module: 'b', version: 'c'\n"],
  ["one-map-semicolon", "foo group: 'a'; bar\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const tree = parser.parse(src)
    const root = tree?.rootNode
    const errs: string[] = []
    const walk = (n: any): void => {
      if (n.type === "ERROR") errs.push(`ERROR@${n.startPosition.row}:${n.startPosition.column}`)
      if (n.isMissing) errs.push(`${n.type}!@${n.startPosition.row}:${n.startPosition.column}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    if (root) walk(root)
    const tag = errs.length === 0 ? "PARSE-OK " : "FAIL     "
    console.log(`${name.padEnd(22)} ${tag} ${errs.join(",")}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
