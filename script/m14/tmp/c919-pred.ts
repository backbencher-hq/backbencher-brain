// #919: two site predicates over the same file set — the source-based census one
// and the tree-sitter `macroDeclaredBody` one — to explain the count gap.
//   bun script/m14/tmp/c919-pred.ts [repo ...]
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : ["fmt", "nlohmann-json"]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const { macroDeclaredBody } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))

const MAX = Number(process.env.BB_MAX ?? 400)
const files: string[] = []
for (const repo of REPOS) {
  const collect = (dir: string) => {
    if (files.length >= MAX) return
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= MAX) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(path.join(CORPUS, repo))
}

let byCensus = 0
let byTree = 0
let onlyCensus = 0
const samples: string[] = []
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  const root = parser.parse(src).rootNode
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    let c = false
    if (n.type === "expression_statement") {
      const first = n.child(0)
      if (first?.type === "call_expression") {
        let missing = false
        for (let i = 0; i < n.childCount; i++) if (n.child(i)?.isMissing) missing = true
        const nx = n.nextSibling
        // census: missing + call-shaped + the next source run is a block
        const rest = src.slice(n.endIndex).replace(/^[ \t\r\n]+/, "")
        if (missing && rest.startsWith("{")) c = true
        c &&= true
        if (c) byCensus++
        if (missing && nx?.type === "compound_statement" && first.childForFieldName("function")?.type === "identifier") byTree++
        if (c && !(missing && nx?.type === "compound_statement")) {
          onlyCensus++
          if (samples.length < 8) samples.push(`${path.relative(CORPUS, f)}:${n.startPosition.row + 1} next=${nx?.type ?? "null"} parent=${n.parent?.type} ${n.text.slice(0, 40)}`)
        }
        // the exported rule: does it accept every tree-side match?
        if (nx?.type === "compound_statement") {
          const shape = macroDeclaredBody(nx)
          if ((missing && first.childForFieldName?.("function")?.type === "identifier") && !shape) {
            samples.push(`RULE REFUSED ${path.relative(CORPUS, f)}:${n.startPosition.row + 1}`)
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
}
console.log(`files=${files.length}`)
console.log(`census predicate (missing + call + next source run is "{") : ${byCensus}`)
console.log(`tree predicate (missing + call + sibling compound_statement) : ${byTree}`)
console.log(`census-only (no sibling block)                            : ${onlyCensus}`)
console.log("\nsamples of census-only:")
for (const s of samples) console.log("  " + s)
