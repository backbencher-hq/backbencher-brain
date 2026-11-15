// #924 cpp row 3: `width = to_unsigned(specs.width)` was published as a CALL
// target (format.h:2107). Which node made that a callee?
import { getParser } from "../run-fixtures"

const CASES: Array<[string, string]> = [
  ["plain assignment statement", "void f(int a) {\n  auto width = to_unsigned(a);\n}\n"],
  ["if with assignment", "void f(int a) {\n  int width;\n  if ((width = to_unsigned(a))) { use(width); }\n}\n"],
  ["lambda at call head", "void f(int n) {\n  int k = [](UInt m) { return m; }(n);\n}\n"],
  ["member init list", "struct S {\n  unsigned size;\n  S(int n, unsigned p, const specs& s) : size((p >> 24) + to_unsigned(n)), padding(0) {\n    auto width = to_unsigned(s.width);\n  }\n};\n"],
]
for (const [label, src] of CASES) {
  const tree: any = (await getParser("cpp")).parse(src)
  console.log(`\n=== ${label}`)
  const walk = (n: any, d = 0): void => {
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function") || n.namedChild(0)
      console.log(`   call_expression text=${JSON.stringify(n.text.slice(0, 70))}`)
      console.log(`      function field: ${fn ? fn.type : "(none)"} ${fn ? JSON.stringify(fn.text.slice(0, 60)) : ""}`)
    }
    if (n.type === "assignment_expression") {
      console.log(`   assignment_expression at L${n.startPosition.row + 1}: ${JSON.stringify(n.text.slice(0, 60))}  parent=${n.parent?.type}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, d + 1) }
  }
  walk(tree.rootNode)
}
