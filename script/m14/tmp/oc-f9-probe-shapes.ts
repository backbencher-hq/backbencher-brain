// script/m14/tmp/oc-f9-probe-shapes.ts — dry-run the two shapes the objc lane is
// about to pin in the F9 probe battery (M60, 2026-09-25):
//   (D) a block-pointer/function-pointer PARAMETER's declared name is never a read
//       (analyzer AND oracle), while the call where it is invoked is published;
//   (B) the PRODUCTION entry (pool-worker.parseFile) keeps a selector target that
//       ends in ':' — the row its noise filter used to eat.
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const PARAM_SRC = [
  `void runBlock(void (^handler)(NSString *)) {`,
  `  NSString *tag = @"t";`,
  `  handler(tag);`,
  `}`,
  ``,
  `void runPtr(void (*cb)(int)) {`,
  `  int x = 1;`,
  `  cb(x);`,
  `}`,
  ``,
  `@implementation Applier`,
  `- (void)apply:(void (^)(int))done {`,
  `  int n = 1;`,
  `  done(n);`,
  `}`,
  `@end`,
].join("\n") + "\n"

const PROD_SRC = [
  `#import <Foundation/Foundation.h>`,
  `@interface UserService`,
  `- (void)saveUser:(NSString *)userId;`,
  `@end`,
  `@implementation UserService {`,
  `  NSMutableArray *_savedUsers;`,
  `}`,
  `- (void)saveUser:(NSString *)userId {`,
  `  [_savedUsers addObject:userId];`,
  `}`,
  `@end`,
].join("\n") + "\n"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const ocLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
  const mod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))

  const p = new P(); p.setLanguage(ocLang)
  const tree = p.parse(PARAM_SRC)
  console.log(`param snippet parse errors: ${tree.rootNode.hasError}`)
  const res: any = await new mod.RealObjectiveCAnalyzer().analyze(tree.rootNode, PARAM_SRC, "probe.m")
  console.log("ANALYZER:", JSON.stringify((res.relationships ?? []).map((e: any) => `${e.type}:${e.source}->${e.target}`)))
  const oracle = diff.deriveObjcEdges(tree.rootNode)
  console.log("ORACLE:  ", JSON.stringify(oracle.map((e: any) => `${e.label}:${e.target}`)))

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-objc-prod-"))
  const file = path.join(tmp, "probe.m")
  fs.writeFileSync(file, PROD_SRC)
  const pw: any = await import(path.join(ROOT, "src/ast/pool-worker"))
  const prod = await pw.parseFile(file, tmp)
  console.log("PRODUCTION relationships:", JSON.stringify((prod.relationships ?? []).map((e: any) => `${e.type}:${e.source}->${e.target}`)))
  console.log("PRODUCTION symbols:", JSON.stringify((prod.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ?? ""}${s.name}`)))
  fs.rmSync(tmp, { recursive: true, force: true })
}
main()
