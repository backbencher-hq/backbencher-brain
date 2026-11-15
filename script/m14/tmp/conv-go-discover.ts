import * as fs from "fs"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-go.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealGoAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.go")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("write+read", [
    "package main",
    "type W struct { x int }",
    "func (w *W) Set(v int) {",
    "  w.x = v",
    "}",
    "func (w *W) Get() int {",
    "  return w.x",
    "}",
  ])
  run("chain+string", [
    "package main",
    "type S struct{}",
    "func (s *S) go() {",
    "  log(\"save\")",
    "  s := map[string]string{\"a.b.c\": \"x\"}",
    "  _ = s",
    "}",
  ])
  run("gin", [
    "package main",
    "import \"github.com/gin-gonic/gin\"",
    "func main() { r := gin.Default() }",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
