// Minimal reproducer: are declarations inside conditional compilation (`#if`,
// `#ifdef`) visible to the objective-c analyzer?
//
// Discovered while extending the objc lane's sampling universe to headers:
// AFAutoPurgingImageCache.h wraps its entire declaration surface in
// `#if TARGET_OS_IOS || TARGET_OS_TV ... #endif` and yields 3 misclassified
// `variable` symbols instead of its 2 protocols + interface + methods.
// The oracle is blind the same way, so the M12 differential read clean.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const cases: Array<[string, string]> = [
  [
    "plain-iface",
    `@interface Foo : NSObject
- (void)bar;
@end
`,
  ],
  [
    "if-wrapped-iface",
    `#if TARGET_OS_IOS
@interface Foo : NSObject
- (void)bar;
@end
#endif
`,
  ],
  [
    "ifdef-wrapped-iface",
    `#ifdef TARGET_OS_IOS
@interface Foo : NSObject
- (void)bar;
@end
#endif
`,
  ],
  [
    "iftv-iface",
    `#import <Foundation/Foundation.h>
#if TARGET_OS_IOS || TARGET_OS_TV
@interface Foo : NSObject
- (void)bar;
@end
#endif
`,
  ],
  [
    "macro-prologue-iface",
    `#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
@interface Foo : NSObject
- (void)bar;
@end
NS_ASSUME_NONNULL_END
`,
  ],
  [
    "plain-impl",
    `@implementation Foo
- (void)bar { [self baz]; }
@end
`,
  ],
  [
    "if-wrapped-impl",
    `#if TARGET_OS_IOS
@implementation Foo
- (void)bar { [self baz]; }
@end
#endif
`,
  ],
  [
    "if-decl-then-impl",
    `#if TARGET_OS_IOS
@interface Foo : NSObject
- (void)bar;
@end
#endif
@implementation Foo
- (void)bar { [self baz]; }
@end
`,
  ],
]

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const ocLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))

for (const [name, src] of cases) {
  const p = new P()
  p.setLanguage(ocLang)
  const tree: any = p.parse(src)
  const res: any = await new ocmod.RealObjectiveCAnalyzer().analyze(tree.rootNode, src, `/tmp/${name}.m`)
  const kinds: Record<string, number> = {}
  for (const s of res.symbols ?? []) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
  const rels = (res.relationships ?? []).map((e: any) => `${e.type} ${e.source}->${e.target}`)
  console.log(
    `${name.padEnd(22)} hasError=${String(tree.rootNode.hasError).padEnd(5)} ` +
      `symbols=${String((res.symbols ?? []).length).padStart(2)} rels=${String(rels.length).padStart(2)} ` +
      `kinds=${JSON.stringify(kinds)} ${rels.length ? "| " + rels.join(", ") : ""}`,
  )
}
process.exit(0)
