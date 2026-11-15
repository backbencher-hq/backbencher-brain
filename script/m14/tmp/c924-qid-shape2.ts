// #924 row 2, shape 2 — the regression set the fix must not touch: operator,
// constructor, destructor, and nested-template qualified declarators. Every
// child of every qid, named and anonymous.
import { getParser } from "../run-fixtures"

const CASES: Array<[string, string]> = [
  ["operator with macro", "MY_API bool MyClass::operator==(const MyClass& o) const { return true; }\n"],
  ["operator no macro", "bool MyClass::operator==(const MyClass& o) const { return true; }\n"],
  ["operator<< with macro", "MY_API std::ostream& operator<<(std::ostream& os, const X& x) { return os; }\n"],
  ["constructor with macro", "MY_API MyClass::MyClass() {}\n"],
  ["destructor with macro", "MY_API MyClass::~MyClass() {}\n"],
  ["nested scope", "void ns::Sub::method(int a) {}\n"],
  ["glued qid", "FMT_API std::system_error vwindows_error(int a);\n"],
  ["nested + templated return (glued prefix)", "MY_API std::vector<int> MyClass::method(int a) {}\n"],
  ["literal operator", "MY_API X operator\"\" _json(const char*, std::size_t) { return {}; }\n"],
]

for (const [label, src] of CASES) {
  const parser = await getParser("cpp")
  const tree: any = parser.parse(src)
  console.log(`\n=== ${label}\n   ${JSON.stringify(src.trim())}`)
  const walk = (n: any, d = 0): void => {
    if (n.type === "qualified_identifier" || n.type === "function_declarator" || n.type === "operator_name" || n.type === "destructor_name") {
      console.log(`${"  ".repeat(d)}${n.type} ${JSON.stringify(n.text)}  named=${n.namedChildCount} total=${n.childCount}`)
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        console.log(`${"  ".repeat(d + 1)}[${i}] ${c!.isNamed ? "named" : "anon "} ${c!.type} ${JSON.stringify(c!.text)}`)
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && c.isNamed) walk(c, d + 1)
    }
  }
  walk(tree.rootNode)
}
