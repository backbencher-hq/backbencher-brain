// The matrix passed with keys a/b but `group/module` failed — so test the KEY,
// not the value.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["a/b", "foo(a: 'x', b: 'y')\n"],
  ["group/b", "foo(group: 'x', b: 'y')\n"],
  ["a/module", "foo(a: 'x', module: 'y')\n"],
  ["group/module", "foo(group: 'x', module: 'y')\n"],
  ["group/group", "foo(group: 'x', group: 'y')\n"],
  ["module/module", "foo(module: 'x', module: 'y')\n"],
  ["groupOnly", "foo(group: 'x')\n"],
  ["moduleOnly", "foo(module: 'x')\n"],
  ["ab", "foo(ab: 'x')\n"],
  ["abcd", "foo(abcd: 'x')\n"],
  ["bgroup", "foo(bgroup: 'x', bmodule: 'y')\n"],
  ["group1/b2", "foo(group1: 'x', b2: 'y')\n"],
  ["xgroup/xmodule", "foo(xgroup: 'x', xmodule: 'y')\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const tree = parser.parse(src)
    const err = tree?.rootNode.hasError
    console.log(`${name.padEnd(16)} ${JSON.stringify(src.trim()).padEnd(38)} ${err ? "FAIL" : "ok  "}`)
  }
  console.log()
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const tree = parser.parse(src)
    if (tree?.rootNode.hasError) console.log(`### ${name}: ${tree.rootNode.toString()}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
