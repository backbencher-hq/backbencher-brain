// #912 part 1 census: across the two C corpora, how many sites present the
// refused shape and what does the analyzer publish there?
//   shape = a call_expression that is the LAST named child of an ERROR node,
//           immediately preceded inside that ERROR by >=1 identifier token,
//           with a compound_statement starting where the call ends.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const parser = new P(); parser.setLanguage(lang)

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    let st: any; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".c") || e.endsWith(".h")) out.push(p)
  }
  return out
}
const REPOS = [
  ["jq", "/home/ishaq2321/bb_tests/repositories/jq"],
  ["sqlite", "/home/ishaq2321/bb_tests/repositories/sqlite"],
]
let totalFiles = 0, sites = 0
for (const [name, repo] of REPOS) {
  const files = walk(repo)
  totalFiles += files.length
  let inRepo = 0
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const root = parser.parse(src).rootNode
    const hits: any[] = []
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "ERROR") {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i))
        const last = kids[kids.length - 1]
        if (last && last.type === "call_expression" && !last.isMissing) {
          // named siblings immediately before, inside the ERROR
          const before: any[] = []
          let s = last.previousNamedSibling
          while (s && before.length < 3) { before.push(s); s = s.previousNamedSibling }
          const after = n.nextNamedSibling
          const bodyAdjacent = after && after.type === "compound_statement" &&
            after.startIndex === last.endIndex
          if (bodyAdjacent) hits.push({ row: last.startPosition.row + 1, text: last.text.slice(0, 45), before: before.map((b: any) => `${b.type}:${JSON.stringify(b.text.slice(0, 12))}`).join(" "), errText: JSON.stringify(n.text.slice(0, 30)) })
        }
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
    if (hits.length) { inRepo += hits.length; sites += hits.length; console.log(`[${name}] ${f.replace(repo + "/", "")}: ${hits.length}`); for (const h of hits.slice(0, 6)) console.log(`    L${h.row} call=${h.text}  before=<${h.before}>  errHead=${h.errText}`) }
  }
  console.log(`[${name}] sites=${inRepo}`)
}
console.log(`TOTAL files=${totalFiles} sites=${sites}`)
