// Matrix: which map_item value kind, followed by another map_item, breaks?
import { ASTEngine } from "../../../src/ast/engine"

const VALUES: Array<[string, string]> = [
  ["int", "1"],
  ["dquote", '"x"'],
  ["squote1", "'x'"],
  ["squote2", "'xy'"],
  ["squote-dot", "'a.b'"],
  ["ident", "v"],
  ["field", "v.k"],
  ["list", "[1]"],
  ["empty-sq", "''"],
]

async function main(): Promise<void> {
  console.log("case: foo(a: <V1>, b: <V2>)")
  for (const [n1, v1] of VALUES) {
    for (const [n2, v2] of VALUES) {
      const src = `foo(a: ${v1}, b: ${v2})\n`
      const parser = await ASTEngine.getParser("groovy" as any)
      const tree = parser.parse(src)
      const bad = tree?.rootNode.hasError
      console.log(`${n1.padEnd(10)} -> ${n2.padEnd(10)} ${bad ? "FAIL" : "ok  "}`)
    }
  }
  console.log("\nsingle value alone:")
  for (const [n1, v1] of VALUES) {
    const src = `foo(a: ${v1})\n`
    const parser = await ASTEngine.getParser("groovy" as any)
    const tree = parser.parse(src)
    console.log(`${n1.padEnd(10)} ${tree?.rootNode.hasError ? "FAIL" : "ok  "}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
