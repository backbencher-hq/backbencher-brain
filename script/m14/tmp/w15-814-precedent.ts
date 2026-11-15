// M49 W15: family precedent for #814 — for `class C { int count; int read(){ return this.count; } }`
// does a `this.<field>` READ attribute its source to the enclosing TYPE or METHOD?
// Also #813 twin: is a private member's declared symbol name equal to its edge target?
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const ROOT = path.resolve(import.meta.dir ?? __dirname, "..", "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")

const LANGS: Record<string, { wasm: string; file: string; cls: string; ext: string; src: string }> = {
  java: {
    wasm: "tree-sitter-java.wasm", file: "real-java-analyzer", cls: "RealJavaAnalyzer", ext: "java",
    src: "class Store {\n  private int hidden = 1;\n  int count = 0;\n  int read() {\n    return this.count;\n  }\n  int peek() {\n    return this.hidden;\n  }\n}\n",
  },
  swift: {
    wasm: "tree-sitter-swift.wasm", file: "real-swift-analyzer", cls: "RealSwiftAnalyzer", ext: "swift",
    src: "class Store {\n  private var hidden = 1\n  var count = 0\n  func read() -> Int {\n    return self.count\n  }\n  func peek() -> Int {\n    return self.hidden\n  }\n}\n",
  },
  kotlin: {
    wasm: "tree-sitter-kotlin.wasm", file: "real-kotlin-analyzer", cls: "RealKotlinAnalyzer", ext: "kt",
    src: "class Store {\n    private val hidden = 1\n    val count = 0\n    fun read(): Int {\n        return this.count\n    }\n    fun peek(): Int {\n        return this.hidden\n    }\n}\n",
  },
  scala: {
    wasm: "tree-sitter-scala.wasm", file: "real-scala-analyzer", cls: "RealScalaAnalyzer", ext: "scala",
    src: "class Store {\n  private val hidden = 1\n  val count = 0\n  def read: Int = this.count\n  def peek: Int = this.hidden\n}\n",
  },
  cpp: {
    wasm: "tree-sitter-cpp.wasm", file: "real-cpp-analyzer", cls: "RealCppAnalyzer", ext: "cpp",
    src: "class Store {\npublic:\n  int count = 0;\n  int read() {\n    return this->count;\n  }\n};\n",
  },
  python: {
    wasm: "tree-sitter-python.wasm", file: "real-python-analyzer", cls: "RealPythonAnalyzer", ext: "py",
    src: "class Store:\n    def __init__(self):\n        self.count = 0\n    def read(self):\n        return self.count\n",
  },
  dart: {
    wasm: "tree-sitter-dart.wasm", file: "real-dart-analyzer", cls: "RealDartAnalyzer", ext: "dart",
    src: "class Store {\n  int count = 0;\n  int read() {\n    return this.count;\n  }\n}\n",
  },
}

const wanted = process.argv.slice(2)
const langs = wanted.length ? wanted : Object.keys(LANGS)

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

for (const lang of langs) {
  const cfg = LANGS[lang]
  if (!cfg) { console.log(`${lang}: no probe config`); continue }
  try {
    const language = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
    const parser = new P()
    parser.setLanguage(language)
    const tree = parser.parse(cfg.src)
    if (tree.rootNode.hasError) { console.log(`${lang}: PARSE ERROR in probe snippet`); continue }
    const mod = await import(`../../../src/ast/${cfg.file}`)
    const analyzer = new mod[cfg.cls]()
    const r = await analyzer.analyze(tree.rootNode, cfg.src, `probe.${cfg.ext}`)
    const hits: string[] = []
    for (const e of r.relationships ?? r.edges ?? []) {
      const t = String(e.target ?? e.to ?? "")
      const f = String(e.from ?? e.source ?? "")
      if (/count|hidden/i.test(t) || /count|hidden/i.test(f)) {
        hits.push(`      ${JSON.stringify(e)}`)
      }
    }
    const syms: string[] = []
    for (const s of r.symbols ?? []) {
      const nm = String(s.name ?? s.symbolName ?? "?")
      if (/count|hidden/i.test(nm)) syms.push(`      symbol ${JSON.stringify(nm)} kind=${s.kind ?? "?"} owner=${s.ownerName ?? s.owner ?? "-"}`)
    }
    console.log(`\n=== ${lang} ===`)
    console.log("  symbols:"); console.log(syms.join("\n") || "      (none)")
    console.log("  edges:"); console.log(hits.join("\n") || "      (none)")
  } catch (err: any) {
    console.log(`${lang}: ANALYZER ERROR ${err?.message ?? err}`)
  }
}
console.log("\ndone")
