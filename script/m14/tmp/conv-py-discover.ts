import * as fs from "fs"
import { RealPythonAnalyzer } from "../../../src/ast/real-python-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-python.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealPythonAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.py")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + " lines: " + JSON.stringify((res.symbols ?? []).map((s: any) => s.name + "@" + s.range?.startLine)) + "\n")
  }

  run("write+read", [
    "class W:",
    "    def __init__(self):",
    "        self.x = 0",
    "    def set(self, v):",
    "        self.x = v",
    "    def get(self):",
    "        return self.x",
  ])
  run("chain+dup", [
    "class Inner:",
    "    def __init__(self):",
    "        self.deeper = None",
    "class C:",
    "    def __init__(self):",
    "        self.inner = Inner()",
    "    def read(self):",
    "        return self.inner.deeper.leaf",
    "    def foo(self):",
    "        return 1",
    "    def foo(self):",
    "        return 2",
  ])
  run("django+flask", [
    "from django.db import models",
    "from flask import Flask",
    "class App:",
    "    pass",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
