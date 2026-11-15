// #924 cpp row 3: what NODE does the grammar put in a call_expression's `function`
// field for a functional-style cast, for a typedef cast, and for a class-type
// construction? The fixture's positive/negative controls depend on this.
import { getParser } from "../run-fixtures"

const CASES: Array<[string, string]> = [
  ["int(x)", "void f(int value) { int a = int(value); }\n"],
  ["char(x)", "void f(unsigned uchar) { char c = char(uchar); }\n"],
  ["unsigned(x)", "void f(int p) { unsigned u = unsigned(p); }\n"],
  ["size_t()", "void f() { size_t z = size_t(); }\n"],
  ["size_t(0)", "void f() { size_t z = size_t(0); }\n"],
  ["uint32_t(x)", "void f(int x) { uint32_t z = uint32_t(x); }\n"],
  ["Class(1,2)", "void f() { Buffer b = Buffer(1, 2); }\n"],
  ["Template<int>(x)", "void f() { B<int> b = B<int>(1); }\n"],
  ["lambda iife", "void f(int n) { int k = [](int m) { return m + 1; }(n); }\n"],
  ["lambda captureless call", "void f() { auto l = []() { return 1; }; l(); }\n"],
  ["subscript call", "void f() { fns[0](7); }\n"],
  ["binary callee", "void f() { (a + b)(3); }\n"],
]

for (const [label, src] of CASES) {
  const tree: any = (await getParser("cpp")).parse(src)
  console.log(`\n=== ${label}: ${JSON.stringify(src.trim())}`)
  const walk = (n: any): void => {
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function") || n.namedChild(0)
      console.log(`   call_expression: function field = ${fn ? JSON.stringify(fn.type) + " " + JSON.stringify(fn.text) : "(none)"}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(tree.rootNode)
}
