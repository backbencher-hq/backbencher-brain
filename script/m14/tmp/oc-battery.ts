import * as fs from "fs"
import * as path from "path"
import { RealObjectiveCAnalyzer } from "../../../src/ast/real-objective-c-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  recv_read: `@implementation Cache\n- (id)objectForKey:(id)k {\n  return [store objectForKey:k];\n}\n@end\n`,
  rhs_return: `@implementation C\n- (int)get {\n  int y = level + 1;\n  return total;\n}\n@end\n`,
  arg_read: `int helper(int); @implementation C\n- (void)go {\n  int r = helper(limit);\n}\n@end\n`,
  ivar_block: `@implementation Widget {\n  int _count;\n  NSString *_name;\n}\n- (void)tick { _count = _count + 1; }\n@end\n`,
  category_export: `@interface NSString (Trim)\n- (NSString *)trimmed;\n@end\n`,
  prop_attr: `@interface Box\n@property (nonatomic, strong) NSString *prefix;\n@property (readonly) int size;\n@end\n`,
  synthesize: `@implementation Box\n@synthesize prefix = _prefix;\n@dynamic size;\n@end\n`,
  super_send: `@implementation Child\n- (id)init {\n  self = [super init];\n  return self;\n}\n@end\n`,
  struct_enum_typedef: `typedef int Counter;\nstruct Point { int x; int y; };\nenum Color { Red, Green };\nCounter gTotal = 0;\n`,
  update_prop: `@implementation C\n- (void)bump {\n  self.count++;\n  --level;\n}\n@end\n`,
  nested_alloc_lower: `@implementation C\n- (id)make {\n  return [[helper alloc] init];\n}\n@end\n`,
  fnptr_call: `@implementation C\n- (void)go {\n  (*callback)(42);\n  [self fire];\n}\n@end\n`,
  block_param: `@implementation C\n- (void)go {\n  void (^blk)(int) = ^(int n) { [self use:n]; };\n  blk(3);\n}\n@end\n`,
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const only = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (only && name !== only) continue
    const root = await parseSrc(src)
    const r: any = await new RealObjectiveCAnalyzer().analyze(root, src, "t.m")
    const syms = (r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ? s.ownerName + "." : ""}${s.name}`)
    const rels = (r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)
    const ora = mod.deriveObjcEdges(root).map((x: any) => `${x.label}[${x.from}->${x.target}]`)
    console.log("=== " + name + " err=" + root.hasError)
    console.log("  syms:", JSON.stringify(syms))
    console.log("  rels:", JSON.stringify(rels))
    console.log("  ora: ", JSON.stringify(ora))
    console.log("  exp: ", JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
  }
}
main()
