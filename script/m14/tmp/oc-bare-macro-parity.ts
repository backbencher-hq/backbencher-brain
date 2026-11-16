// Parity: does a bare file-scope macro invocation swallow the NEXT line in the
// c / cpp grammars too, or is the swallow objc-specific?
//
// Mechanism found by oc-macro-bisect.ts: tree-sitter-objc parses
//   NS_ASSUME_NONNULL_BEGIN
//   @interface Foo : NSObject
// as ONE `declaration` whose first token is `type_identifier
// NS_ASSUME_NONNULL_BEGIN` followed by an ERROR swallowing `@interface Foo :`
// — destroying the whole file's declaration surface.
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const cases: Array<[string, string, string[]]> = [
  ["c", "tree-sitter-c.wasm", ["SOME_MACRO\nint f(void);\n", "int g(void);\n", "SOME_MACRO\nint f(void);\nint g(void);\n"]],
  ["cpp", "tree-sitter-cpp.wasm", ["SOME_MACRO\nint f();\n", "SOME_MACRO\nclass Foo {};\n"]],
  ["objc", "tree-sitter-objc.wasm", ["SOME_MACRO\n@interface Foo : NSObject\n@end\n", "SOME_MACRO\nint f(void);\n"]],
]

function topLevel(n: any): string {
  return n.children
    .map((c: any) => {
      const err = c.type === "ERROR" || c.hasError ? "<ERR>" : ""
      return `${c.type}[${c.startPosition.row + 1}..${c.endPosition.row + 1}]${err}`
    })
    .join(" ")
}

for (const [label, wasm, srcs] of cases) {
  const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  for (const src of srcs) {
    const p = new P()
    p.setLanguage(lang)
    const tree: any = p.parse(src)
    console.log(`--- ${label}: ${JSON.stringify(src.split("\n")[0])} + ${JSON.stringify(src.split("\n")[1] ?? "")}`)
    console.log(`    hasError=${tree.rootNode.hasError}  children: ${topLevel(tree.rootNode)}`)
  }
}
process.exit(0)
