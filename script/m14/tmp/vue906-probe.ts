// #906 probe: is one root cause behind BOTH shapes?
//
// Hypothesis: `deriveEmbeddedScriptTrees` has only js + ts parsers and its
// `isTs` test is /lang=["']ts["']/, so a `<script lang="tsx">` block is parsed
// with the JAVASCRIPT grammar. JSX then recovers as relational expressions —
// which would (a) fabricate call_expression nodes whose callee is a keyword and
// (b) swallow the following real declarations.
//
// For each file: parse every script block three ways (js / ts / tsx) and print
// the calls the TS oracle would derive, plus the ERROR count of each parse.
import fs from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/element-plus"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const load = async (name: string) => {
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", name)))
  const p = new P()
  p.setLanguage(lang)
  return p
}
const vue = await load("tree-sitter-vue.wasm")
const js = await load("tree-sitter-javascript.wasm")
const ts = await load("tree-sitter-typescript.wasm")
const tsx = await load("tree-sitter-tsx.wasm")

function errors(root: any): number {
  let n = 0
  const st = [root]
  while (st.length) {
    const x = st.pop()
    if (x.type === "ERROR") n++
    for (let i = 0; i < x.childCount; i++) st.push(x.child(i))
  }
  return n
}

/** the TS oracle's call derivation, reduced to the interesting part */
function calls(root: any): string[] {
  const out = new Set<string>()
  const st = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "call_expression") {
      const callee = n.namedChild(0)
      if (callee && callee.type !== "subscript_expression") {
        let t = callee.text
        if (callee.type === "member_expression") {
          const prop = callee.childForFieldName("property")
          if (prop) t = prop.text
        }
        out.add(t)
      }
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  return [...out].sort()
}

const FILES = [
  "docs/examples/table-v2/selection.vue",
  "docs/examples/table-v2/grouping-header.vue",
  "docs/examples/table-v2/inline-editing.vue",
]

for (const rel of FILES) {
  const abs = path.join(REPO, rel)
  const content = fs.readFileSync(abs, "utf8")
  const root = vue.parse(content).rootNode
  console.log(`\n=== ${rel}`)

  // script blocks, as the oracle walks them
  const blocks: any[] = []
  const walk = (n: any) => {
    if (n.type === "script_element") blocks.push(n)
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  for (const b of blocks) {
    const raw = b.namedChildren.find((c: any) => c.type === "raw_text")
    const startTag = b.namedChildren.find((c: any) => c.type === "start_tag")
    const isTs = !!startTag && /lang=["']ts["']/.test(startTag.text)
    console.log(`  script tag: ${JSON.stringify(startTag?.text?.slice(0, 60))}`)
    console.log(`  oracle would pick: ${isTs ? "typescript" : "javascript"}`)
    if (!raw) continue
    for (const [name, parser] of [["js", js], ["ts", ts], ["tsx", tsx]] as const) {
      const r = parser.parse(raw.text).rootNode
      const cs = calls(r)
      const bogus = cs.filter((c) => ["key", "return", "string", "if", "for", "while", "typeof"].includes(c))
      const real = cs.filter((c) => ["generateColumns", "generateData", "map", "from", "ref"].includes(c))
      console.log(
        `    ${name.padEnd(4)} ERRORs=${String(errors(r)).padStart(4)}  calls=${String(cs.length).padStart(4)}` +
          `  bogus=[${bogus.join(",")}]  real=[${real.join(",")}]`,
      )
    }
  }
}
