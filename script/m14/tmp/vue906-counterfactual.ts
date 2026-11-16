// #906 counterfactual: does the fix actually carry weight?
// Re-run the same truth derivation but forcing the OLD dispatch (every SFC
// block -> the javascript grammar). If the fabricated keyword-callee rows
// reappear and the real script-setup calls vanish, the fix is load-bearing and
// a revert is detectable. Exit 0 iff the old dispatch is measurably wrong.
import fs from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/element-plus"
const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-vue.wasm")))
const vue = new P()
vue.setLanguage(lang)
const jsLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-javascript.wasm")))
const jsParser = new P()
jsParser.setLanguage(jsLang)

const KEYWORDS = new Set(["key", "return", "string", "if", "for", "while", "typeof", "new", "delete", "in", "of"])
const FILES = [
  "docs/examples/table-v2/selection.vue",
  "docs/examples/table-v2/grouping-header.vue",
  "docs/examples/table-v2/inline-editing.vue",
  "docs/examples/table-v2/cell-templating.vue",
]
const REAL: Record<string, string[]> = {
  "docs/examples/table-v2/selection.vue": ["generateColumns", "generateData"],
  "docs/examples/table-v2/grouping-header.vue": ["generateColumns", "generateData"],
  "docs/examples/table-v2/inline-editing.vue": ["generateColumns", "generateData"],
  "docs/examples/table-v2/cell-templating.vue": ["dayjs"],
}

let bogus = 0
let lost = 0
for (const rel of FILES) {
  const content = fs.readFileSync(path.join(REPO, rel), "utf8")
  const root = vue.parse(content).rootNode
  // the SFC's own script raw_text (independent of the engine, deliberately)
  let body = ""
  const st = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "raw_text") body += n.text + "\n"
    for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i))
  }
  const t = jsParser.parse(body).rootNode
  const calls = new Set<string>()
  const q = [t]
  while (q.length) {
    const n = q.pop()
    if (n.type === "call_expression") {
      const c = n.namedChild(0)
      if (c) calls.add(c.type === "member_expression" ? (c.childForFieldName("property")?.text ?? c.text) : c.text)
    }
    for (let i = 0; i < n.childCount; i++) q.push(n.child(i))
  }
  const b = [...calls].filter((c) => KEYWORDS.has(c))
  const miss = (REAL[rel] ?? []).filter((w) => !calls.has(w))
  bogus += b.length
  lost += miss.length
  console.log(`${rel}: old-dispatch bogus=[${b.join(",")}] lostReal=[${miss.join(",")}]`)
}
console.log(`\nTOTAL old dispatch: bogus=${bogus} lostReal=${lost}`)
process.exit(bogus > 0 && lost > 0 ? 0 : 1)
