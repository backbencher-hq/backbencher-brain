import { ASTEngine } from "../../../src/ast/engine"
const f = "/home/ishaq2321/bb_tests/repositories/zig/lib/compiler/aro/aro/Attribute.zig"
const src = await Bun.file(f).text()
for (let i = 1; i <= 5; i++) {
  const parser = await ASTEngine.getParser("zig")
  const tree = parser.parse(src)
  const root: any = tree.rootNode
  let errs = 0
  if (root.hasError) {
    const stack = [root]
    while (stack.length) { const n = stack.pop()!; if (n.type === "ERROR" || n.isMissing) errs++; for (let j = 0; j < n.childCount; j++) { const c = n.child(j); if (c) stack.push(c) } }
  }
  console.log(`parse ${i}: hasError=${root.hasError} errNodes=${errs}`)
}
