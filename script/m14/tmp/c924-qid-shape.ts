// #924 row 2, shape 2: the STRUCTURAL discriminator. Is the separator between a
// qid's segments a real `::` token, or just whitespace? Dump every child.
import { getParser } from "../run-fixtures"

const CASES: Array<[string, string]> = [
  ["glued (misplaced return type)", "FMT_API std::system_error vwindows_error(int a);\n"],
  ["genuine scope", "void MyClass::method(int a) {}\n"],
  ["genuine nested scope", "void ns::Sub::method(int a) {}\n"],
  ["genuine + templated return", "MY_API std::vector<int> MyClass::method(int a) {}\n"],
  ["genuine + template args with space", "MY_API void MyClass<std::pair<int, int>>::method(int a) {}\n"],
  ["genuine, no macro", "void MyClass::method(int a) {}\n"],
]

for (const [label, src] of CASES) {
  const parser = await getParser("cpp")
  const tree: any = parser.parse(src)
  console.log(`\n=== ${label}\n   ${JSON.stringify(src.trim())}`)
  const walk = (n: any, d = 0): void => {
    if (n.type === "qualified_identifier") {
      console.log(`${"  ".repeat(d)}qid ${JSON.stringify(n.text)}`)
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        console.log(`${"  ".repeat(d + 1)}child[${i}] ${c!.isNamed ? "named" : "anon "} ${c!.type} ${JSON.stringify(c!.text)}`)
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && c.isNamed) walk(c, d + 1)
    }
  }
  walk(tree.rootNode)
}
