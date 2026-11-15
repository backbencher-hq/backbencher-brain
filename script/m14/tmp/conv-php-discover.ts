import * as fs from "fs"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-php.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealPhpAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = "<?php\n" + lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.php")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("write+read", [
    "class W {",
    "  public $x = 0;",
    "  public function set($v) { $this->x = $v; }",
    "  public function get() { return $this->x; }",
    "}",
  ])
  run("chain+dup+string", [
    "class Inner { public Deeper $deeper; }",
    "class Deeper { public int $leaf = 1; }",
    "class C {",
    "  public Inner $inner;",
    "  public function read() { return $this->inner->deeper->leaf; }",
    "  public function foo() { return 1; }",
    "  public function foo() { return 2; }",
    "  public function go() { $this->log('save'); }",
    "  public function log($m) {}",
    "}",
  ])
  run("laravel", [
    "use Illuminate\\Support\\Facades\\Route;",
    "class App {}",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
