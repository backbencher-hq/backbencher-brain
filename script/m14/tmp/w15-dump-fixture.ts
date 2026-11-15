// M49 W15: dump a fixture's analyzer output (relationships + symbols) so that
// re-pinned expectations come from the live analyzer, never from guessing.
// Usage: bun run script/m14/tmp/w15-dump-fixture.ts <lang> <fixturePath>
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const ROOT = path.resolve(import.meta.dir ?? __dirname, "..", "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")

const LANGS: Record<string, { wasm: string; file: string; cls: string; ext: string }> = {
  javascript: { wasm: "tree-sitter-javascript.wasm", file: "real-javascript-analyzer", cls: "RealJavaScriptAnalyzer", ext: "js" },
  typescript: { wasm: "tree-sitter-typescript.wasm", file: "real-typescript-analyzer", cls: "RealTypeScriptAnalyzer", ext: "ts" },
  java: { wasm: "tree-sitter-java.wasm", file: "real-java-analyzer", cls: "RealJavaAnalyzer", ext: "java" },
  swift: { wasm: "tree-sitter-swift.wasm", file: "real-swift-analyzer", cls: "RealSwiftAnalyzer", ext: "swift" },
  scala: { wasm: "tree-sitter-scala.wasm", file: "real-scala-analyzer", cls: "RealScalaAnalyzer", ext: "scala" },
  vue: { wasm: "tree-sitter-vue.wasm", file: "real-vue-analyzer", cls: "RealVueAnalyzer", ext: "vue" },
  svelte: { wasm: "tree-sitter-svelte.wasm", file: "real-svelte-analyzer", cls: "RealSvelteAnalyzer", ext: "svelte" },
}

const lang = process.argv[2]
const file = process.argv[3]
const cfg = LANGS[lang]
if (!cfg) { console.error(`unknown lang ${lang}`); process.exit(2) }
const src = fs.readFileSync(file, "utf8")

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
const parser = new P()
parser.setLanguage(language)
const tree = parser.parse(src)
const mod = await import(`../../../src/ast/${cfg.file}`)
const r = await new mod[cfg.cls]().analyze(tree.rootNode, src, path.basename(file))

console.log("=== symbols ===")
for (const s of r.symbols ?? []) console.log(JSON.stringify(s))
console.log("=== relationships ===")
for (const e of r.relationships ?? []) console.log(JSON.stringify(e))
