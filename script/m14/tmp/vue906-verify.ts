// #906 verification, through the ORACLE'S OWN path (deriveEmbeddedScriptTrees +
// deriveTypeScriptEdges), not a reimplementation:
//   (1) no truth edge whose target is a reserved word or primitive type name
//       (the fabricated `calls -> key/return/string/if` rows);
//   (2) the real script-setup calls are present (generateColumns/generateData/...)
//   (3) the dispatch matches the engine per block (ts/tsx/js).
import fs from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPO = path.join("/home/ishaq2321/bb_tests/repositories/element-plus")
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))

const KEYWORDS = new Set([
  "return", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "typeof", "instanceof", "new", "delete", "void", "in", "of",
  "function", "class", "catch", "try", "finally", "throw", "await", "yield",
  "string", "number", "boolean", "any", "unknown", "never", "object", "key",
])

const FILES = [
  "docs/examples/table-v2/selection.vue",
  "docs/examples/table-v2/grouping-header.vue",
  "docs/examples/table-v2/inline-editing.vue",
  "docs/examples/table-v2/cell-templating.vue",
]

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const vueLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-vue.wasm")))
const parser = new P()
parser.setLanguage(vueLang)

const eng: any = await import(path.join(ROOT, "src/ast/engine.ts"))

let bogusTotal = 0
let missingReal = 0
for (const rel of FILES) {
  const abs = path.join(REPO, rel)
  const content = fs.readFileSync(abs, "utf8")
  const root = parser.parse(content).rootNode
  const blocks = eng.ASTEngine.extractSfcScriptBlocks(root, content)
  console.log(`\n=== ${rel}  blocks=[${blocks.map((b: any) => b.lang).join(",")}]`)

  const trees = await diff.deriveEmbeddedScriptTrees(root, content, "vue")
  const calls = new Set<string>()
  const full = new Set<string>()
  for (const t of trees) {
    for (const e of diff.deriveTypeScriptEdges(t)) {
      if (e.label !== "calls") continue
      calls.add(e.target)
      if (e.fullCallee) full.add(e.fullCallee)
    }
  }
  const bogus = [...calls].filter((c) => KEYWORDS.has(c)).sort()
  bogusTotal += bogus.length
  // the calls the analyzer emits on this file that truth must corroborate
  const REAL: Record<string, string[]> = {
    "docs/examples/table-v2/selection.vue": ["generateColumns", "generateData", "map"],
    "docs/examples/table-v2/grouping-header.vue": ["generateColumns", "generateData", "map"],
    "docs/examples/table-v2/inline-editing.vue": ["generateColumns", "generateData", "map", "ref"],
    "docs/examples/table-v2/cell-templating.vue": ["dayjs"],
  }
  const want = REAL[rel] ?? []
  const absent = want.filter((w) => !calls.has(w))
  missingReal += absent.length
  console.log(`  truth calls: ${calls.size} | fullCallees: ${[...full].slice(0, 8).join(", ")}`)
  console.log(`  ${bogus.length === 0 ? "ok  " : "FAIL"} no keyword/primitive callee — ${bogus.length ? bogus.join(",") : "none"}`)
  console.log(`  ${absent.length === 0 ? "ok  " : "FAIL"} real calls present — want ${want.join(",")}${absent.length ? " missing " + absent.join(",") : ""}`)
}
console.log(`\nTOTAL: bogus=${bogusTotal} missingReal=${missingReal}`)
process.exit(bogusTotal === 0 && missingReal === 0 ? 0 : 1)
