import * as fs from "fs"
import * as path from "path"
import { RealObjectiveCAnalyzer } from "../../../src/ast/real-objective-c-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `@interface Cache
@property (nonatomic) int level;
@end
@implementation Cache {
  id store;
}
- (id)objectForKey:(id)k {
  int depth = self.level + 1;
  id hit = [store objectForKey:k];
  total = depth;
  [hit retain];
  for (id x in items) { [self use:x]; }
  self.level = depth;
  SEL s = @selector(fire:);
  return hit;
}
@end
int helper(int limit) {
  int r = limit * 2;
  return r;
}
`
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const r: any = await new RealObjectiveCAnalyzer().analyze(root, src, "t.m")
  console.log("rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
}
main()
