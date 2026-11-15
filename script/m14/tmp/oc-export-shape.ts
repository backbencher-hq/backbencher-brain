// Does the objc grammar handle the OTHER canonical header macro shape — an
// export/prologue macro decorating a real declaration — and would the repo's
// patched C grammar (#743 macro_prefixed_type_specifier) cover it?
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const ocLang: any = await L.load(fs.readFileSync(process.env["OC_WASM"] ?? path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))

const cases: Array<[string, string, string]> = [
  ["objc", "FOUNDATION_EXPORT NSString * const kFoo;", "c-rule candidate"],
  ["objc", "UIKIT_EXTERN NSString * const kFoo;", "c-rule candidate"],
  ["objc", "FOUNDATION_EXPORT void someFunction(void);", "c-rule candidate"],
  ["objc", "NS_ASSUME_NONNULL_BEGIN\n@interface Foo : NSObject\n- (void)bar;\n@end\nNS_ASSUME_NONNULL_END\n", "the real shape"],
  ["objc", "NS_ASSUME_NONNULL_BEGIN\nFOUNDATION_EXPORT NSString * const kFoo;\n", "macro then macro+type"],
  ["objc", "UIKIT_EXTERN NSString *const Foo;\n@interface Bar : NSObject\n@end\n", "export then interface"],
  ["objc", "NS_ASSUME_NONNULL_BEGIN\n@class Foo;\n", "macro then forward decl"],
  ["objc", "NS_ASSUME_NONNULL_BEGIN\n@protocol P\n- (void)m;\n@end\n", "macro then protocol"],
  ["objc", "NS_ASSUME_NONNULL_BEGIN\ntypedef NS_ENUM(NSInteger, Foo) { FooA };\n", "macro then typedef"],
  ["objc", "@interface Foo : NSObject\n- (void)bar NS_SWIFT_NAME(bar());\n@end\n", "swift-name on a method"],
]

for (const [label, src, note] of cases) {
  const p = new P()
  p.setLanguage(ocLang)
  const tree: any = p.parse(src)
  const kids = tree.rootNode.children
    .map((c: any) => `${c.type}${c.hasError || c.type === "ERROR" ? "<ERR>" : ""}`)
    .join(" ")
  console.log(`${note.padEnd(22)} hasError=${String(tree.rootNode.hasError).padEnd(5)} ${kids}`)
  if (tree.rootNode.hasError) {
    const line = (n: any, d: number): string =>
      `${"  ".repeat(d)}${n.type}${n.type === "ERROR" || n.hasError ? "<ERR>" : ""} [${n.startPosition.row + 1}]${
        n.childCount === 0 ? " " + JSON.stringify(n.text.slice(0, 30)) : ""
      }`
    const out: string[] = []
    const walk = (n: any, d: number) => {
      out.push(line(n, d))
      if (d < 3) for (const c of n.children) walk(c, d + 1)
    }
    walk(tree.rootNode, 0)
    console.log(out.slice(0, 12).join("\n").replace(/^/gm, "        "))
  }
}
process.exit(0)
