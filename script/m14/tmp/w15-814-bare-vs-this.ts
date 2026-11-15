// M49 W15 #814: is `this.x` sourced differently from a BARE `x` read inside the
// SAME method? If so the pre-ruling behavior was internally inconsistent, not a
// deliberate contract — that is the decisive evidence for the convergence.
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
    src: "class Store {\n  int count = 0;\n  int bare() {\n    return count;\n  }\n  int dotted() {\n    return this.count;\n  }\n}\n",
  },
  javascript: {
    wasm: "tree-sitter-javascript.wasm", file: "real-javascript-analyzer", cls: "RealJavaScriptAnalyzer", ext: "js",
    src: "class Store {\n  count = 0;\n  bare() {\n    return count;\n  }\n  dotted() {\n    return this.count;\n  }\n}\n",
  },
  swift: {
    wasm: "tree-sitter-swift.wasm", file: "real-swift-analyzer", cls: "RealSwiftAnalyzer", ext: "swift",
    src: "class Store {\n  var count = 0\n  func bare() -> Int {\n    return count\n  }\n  func dotted() -> Int {\n    return self.count\n  }\n}\n",
  },
}

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

for (const [lang, cfg] of Object.entries(LANGS)) {
  const language = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
  const parser = new P()
  parser.setLanguage(language)
  const tree = parser.parse(cfg.src)
  if (tree.rootNode.hasError) { console.log(`${lang}: PARSE ERROR`); continue }
  const mod = await import(`../../../src/ast/${cfg.file}`)
  const r = await new mod[cfg.cls]().analyze(tree.rootNode, cfg.src, `probe.${cfg.ext}`)
  console.log(`\n=== ${lang} ===`)
  for (const e of r.relationships ?? []) {
    if (e.type !== "uses") continue
    const t = String(e.target)
    if (!/count/.test(t)) continue
    console.log(`   uses ${e.source} -> ${t}   (bare-read form vs this/self form in the same class)`)
  }
}
console.log("\ndone")
