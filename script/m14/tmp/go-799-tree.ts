// go (round 3) — is `var _ = slices.Backward[[]int]` a PARSE failure?
//
// The analyzer loses every symbol and edge after that line, which is the
// signature of a broken tree rather than a wrong rule. This dumps the tree,
// flags ERROR/MISSING nodes, and tries the same line in the shapes that differ:
// a bare generic function reference, an instantiated CALL, and the same with a
// local generic function.
//
// Run: bun script/m14/tmp/go-799-tree.ts
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  [
    "1 package-scope generic FUNCTION VALUE (var _ = f[T])",
    `package p\n\nimport (\n\t"slices"\n)\n\nvar _ = slices.Backward[[]int]\n\nfunc caller(s []int) {\n\t_ = s\n}\n`,
  ],
  [
    "2 package-scope instantiated CALL (var _ = f[T](x))",
    `package p\n\nimport (\n\t"slices"\n)\n\nvar _ = slices.Backward[[]int](nil)\n\nfunc caller(s []int) {\n\t_ = s\n}\n`,
  ],
  [
    "3 local generic func, same line shape",
    `package p\n\nfunc Id[T any](x T) T { return x }\n\nvar _ = Id[[]int]\n\nfunc caller(s []int) {\n\t_ = s\n}\n`,
  ],
  [
    "4 generic TYPE instantiation (var _ T[int])",
    `package p\n\ntype Box[T any] struct{ v T }\n\nvar _ Box[int]\n\nfunc caller(s []int) {\n\t_ = s\n}\n`,
  ],
]

const parser = await ASTEngine.getParser("go" as any)

function dump(node: any, depth: number, out: string[], max = 40) {
  if (out.length > max) return
  const flag = node.type === "ERROR" || node.isMissing ? `   <-- ${node.type === "ERROR" ? "ERROR" : "MISSING"}` : ""
  out.push(`${"  ".repeat(depth)}${node.type}${flag}${depth <= 2 ? `  ${JSON.stringify(String(node.text).slice(0, 40))}` : ""}`)
  for (let i = 0; i < node.namedChildCount; i++) dump(node.namedChild(i), depth + 1, out, max)
}

for (const [name, src] of CASES) {
  const tree: any = parser.parse(src)
  const root: any = tree.rootNode
  console.log(`=== ${name}`)
  console.log(`   hasError=${root.hasError}`)
  const out: string[] = []
  dump(root, 0, out, 30)
  console.log(out.map((l) => "   " + l).join("\n"))
  const errs = (root.descendantsOfType ? [] : []).length
  void errs
}
