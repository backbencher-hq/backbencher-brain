import * as fs from "fs"
import { RealObjectiveCAnalyzer } from "../../../src/ast/real-objective-c-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-objc.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealObjectiveCAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.m")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("write+read", [
    "@interface W : NSObject",
    "@property (atomic, assign) int x;",
    "@end",
    "@implementation W",
    "- (void)setV:(int)v {",
    "  self.x = v;",
    "}",
    "- (int)getV {",
    "  return self.x;",
    "}",
    "@end",
  ])
  run("call+string", [
    "@implementation S",
    "- (void)go {",
    "  [self log:@\"save\"];",
    "}",
    "- (void)log:(NSString *)m {}",
    "@end",
  ])
  run("uikit", [
    "#import <UIKit/UIKit.h>",
    "@implementation HomeVC",
    "@end",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
