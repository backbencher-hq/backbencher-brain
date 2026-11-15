import * as fs from "fs"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c_sharp.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealCSharpAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.cs")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("write+read", [
    "public class W {",
    "  private int x;",
    "  public void Set(int v) { x = v; }",
    "  public int Get() { return x; }",
    "}",
  ])
  run("chain+dup", [
    "public class Inner { public Deeper deeper; }",
    "public class Deeper { public int leaf; }",
    "public class Ch {",
    "  public Inner inner;",
    "  public int Read() { return inner.deeper.leaf; }",
    "  public int Foo() { return 1; }",
    "  public int Foo() { return 2; }",
    "}",
  ])
  run("aspnet", [
    "using Microsoft.AspNetCore.Mvc;",
    "public class HomeController : Controller {}",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
