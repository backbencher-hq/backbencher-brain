// #924 row 2, shape 2 — the REGRESSION RISK before any fix: with a macro prefix,
// what does a GENUINE qualified declarator look like? The fix must keep
// `MyClass::method` while dropping a misplaced return type.
import { getParser } from "../run-fixtures"

const CASES: Array<[string, string]> = [
  ["genuine scope + macro prefix", "MY_API void MyClass::method(int a) {}\n"],
  ["genuine scope, templated return", "MY_API std::vector<int> MyClass::method(int a) {}\n"],
  ["genuine scope, nested template return", "MY_API std::pair<int, int> MyClass::method(int a) {}\n"],
  ["genuine nested scope + macro prefix", "MY_API void ns::Sub::method(int a) {}\n"],
  ["genuine scope, NO macro", "void MyClass::method(int a) {}\n"],
  ["genuine scope, templated class + macro", "MY_API void MyClass<T>::method(int a) {}\n"],
  ["genuine scope, template args with space", "MY_API void MyClass<std::pair<int, int>>::method(int a) {}\n"],
  ["genuine scope operator", "MY_API bool MyClass::operator==(const MyClass& o) const { return true; }\n"],
  ["macro prefix, no return type", "MY_API MyClass::MyClass() {}\n"],
  ["macro prefix, unqualified builtin return", "MY_API int count() { return 1; }\n"],
  ["two macro prefixes then scope", "MY_API MY_CONST void MyClass::method(int a) {}\n"],
  ["genuine scope, qid in decl only", "MY_API void MyClass::method(int a);\n"],
]

for (const [label, src] of CASES) {
  const parser = await getParser("cpp")
  const tree: any = parser.parse(src)
  console.log(`\n=== ${label}\n   src: ${JSON.stringify(src.trim())}`)
  const walk = (n: any, d = 0): void => {
    const interesting = ["function_declarator", "qualified_identifier", "namespace_identifier", "type_identifier", "identifier", "function_definition", "declaration"].includes(n.type)
    if (interesting) console.log(`${"  ".repeat(d + 1)}${n.type} ${JSON.stringify(n.text.length > 60 ? n.text.slice(0, 60) + "…" : n.text)}`)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && c.isNamed) walk(c, interesting ? d + 1 : d)
    }
  }
  walk(tree.rootNode)
}
