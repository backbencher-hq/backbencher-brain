import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `@implementation C
- (Foo *)makeWith:(int)n err:(NSError **)e {
  SEL s = @selector(fire:);
  for (id x in items) { [self use:x]; }
  @try { [self go]; } @catch (NSException *ex) { [self log:ex]; }
  return nil;
}
- (void)tick { YES; _cmd; }
@end
@implementation Box
@synthesize prefix = _prefix;
@end
`
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const dump = (n: any, d: number): void => {
    if (!n.isNamed && d > 0) { /* show anon only inside interest */ }
    const show = n.isNamed || [":", "@selector", "@synthesize", "@catch", "for", "in"].includes(n.type)
    if (show && d <= 6) console.log("  ".repeat(d) + (n.isNamed ? "" : "'") + n.type + (n.isNamed && (n.type === "identifier" || n.type === "type_identifier" || n.type === "field_identifier") ? ` [${n.text}]` : "") + (!n.isNamed && n.text.length < 14 ? ` (${n.text})` : ""))
    if (d > 6) return
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), d + 1)
  }
  dump(root, 0)
}
main()
