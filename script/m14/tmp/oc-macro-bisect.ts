// Bisect the header-macro failure: which construct creates the ERROR node, and
// how much of the file's declaration surface survives it?
//
// oc-preproc-probe.ts ruled out conditional compilation (`#if`/`#ifdef` handled
// correctly). The remaining single failing case is the NS_ASSUME_NONNULL
// prologue. This probe narrows the trigger and measures the loss.
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const IFACE = `@interface Foo : NSObject
- (void)bar;
@end
`

const cases: Array<[string, string]> = [
  ["control (no macro)", IFACE],
  ["BEGIN only", `NS_ASSUME_NONNULL_BEGIN\n${IFACE}`],
  ["END only", `${IFACE}NS_ASSUME_NONNULL_END\n`],
  ["BEGIN+END around iface", `NS_ASSUME_NONNULL_BEGIN\n${IFACE}NS_ASSUME_NONNULL_END\n`],
  ["BARE-IDENT only", `SOME_MACRO_BEGIN\n${IFACE}`],
  ["iface, then class after BEGIN", `${IFACE}NS_ASSUME_NONNULL_BEGIN\n@interface Bar : NSObject\n- (void)baz;\n@end\nNS_ASSUME_NONNULL_END\n`],
  ["iface, then stray macro, then iface", `${IFACE}NS_ASSUME_NONNULL_BEGIN\n@interface Bar : NSObject\n- (void)baz;\n@end\n`],
  ["BEGIN with import after", `NS_ASSUME_NONNULL_BEGIN\n#import <Foundation/Foundation.h>\n${IFACE}`],
  ["UIKIT_EXTERN on a decl", `${IFACE}UIKIT_EXTERN NSString * const Foo.bar;\n`],
  ["extern-prefixed decl", `${IFACE}extern NSString * const kBaz;\n`],
  ["NS_SWIFT_NAME after method", `@interface Foo : NSObject\n- (void)bar NS_SWIFT_NAME(bar());\n@end\n`],
]

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const ocLang: any = await L.load(fs.readFileSync(process.env["OC_WASM"] ?? path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))

function dump(n: any, src: string, depth: number, out: string[], maxDepth = 6) {
  if (depth > maxDepth) return
  const txt = n.childCount === 0 ? JSON.stringify(n.text.length > 44 ? n.text.slice(0, 44) + "…" : n.text) : ""
  out.push(
    `${"  ".repeat(depth)}${n.type} [${n.startPosition.row + 1}..${n.endPosition.row + 1}]${n.type === "ERROR" ? "  <-- ERROR" : ""} ${txt}`,
  )
  for (const c of n.children) dump(c, src, depth + 1, out, maxDepth)
}

for (const [name, src] of cases) {
  const p = new P()
  p.setLanguage(ocLang)
  const tree: any = p.parse(src)
  const res: any = await new ocmod.RealObjectiveCAnalyzer().analyze(tree.rootNode, src, `/tmp/${name}.m`)
  const kinds: Record<string, number> = {}
  for (const s of res.symbols ?? []) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
  const names = (res.symbols ?? []).map((s: any) => `${s.kind}:${s.name}`)
  console.log(`${name.padEnd(34)} hasError=${String(tree.rootNode.hasError).padEnd(5)} symbols=${JSON.stringify(names)}`)
  if (tree.rootNode.hasError) {
    const out: string[] = []
    dump(tree.rootNode, src, 1, out)
    console.log(out.join("\n").replace(/^/gm, "      "))
  }
}
process.exit(0)
