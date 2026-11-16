// #743c: the dominant cpp shape is a CALL-SHAPED macro standing as the whole heading
// of a block — `TEST(Suite, name) { … }`, `GTEST_…(…) { … }`. The grammar reads the
// heading as an expression_statement (MISSING `;`) and the body as a SIBLING, so the
// body is not inside any function scope. This prints the sites and, for each, the
// analyzer's own view of the body: which reads it sources at `global` (the #917
// evidence shape on the C side) and how many symbols the body publishes.
//   bun script/m14/tmp/cpp743-blocks.ts [--wasm <path>] [repo] [limit]
import fs from "node:fs"
import path from "node:path"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const WASM = process.argv.includes("--wasm") ? process.argv[process.argv.indexOf("--wasm") + 1] : "wasm/tree-sitter-cpp.wasm"
const REPOS = process.argv.slice(2).filter((a, i, arr) => a !== "--wasm" && arr[i - 1] !== "--wasm")
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(fs.readFileSync(WASM))
const parser = new P(); parser.setLanguage(lang)

const MAX = 400
type Site = { file: string; line: number; macro: string; bodyLine: number; bodyEnd: number }
const sites: Site[] = []
for (const repo of (REPOS.length ? REPOS : ["fmt", "nlohmann-json"])) {
  const repoDir = path.join(CORPUS, repo)
  const files: string[] = []
  const collect = (dir: string) => {
    if (files.length >= MAX) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= MAX) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(repoDir)
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    const root = parser.parse(src).rootNode
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "expression_statement") {
        let missing = false
        for (let i = 0; i < n.childCount; i++) if (n.child(i)?.isMissing) missing = true
        const first = n.child(0)
        if (missing && first?.type === "call_expression") {
          const rest = src.slice(n.endIndex).replace(/^[ \t\r\n]+/, "")
          if (rest.startsWith("{")) {
            sites.push({ file: path.relative(CORPUS, f), line: n.startPosition.row + 1, macro: first.text.slice(0, 46), bodyLine: n.endPosition.row + 1, bodyEnd: n.endPosition.row + 1 })
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
  }
}
const byMacro = new Map<string, number>()
for (const s of sites) byMacro.set(s.macro.split("(")[0], (byMacro.get(s.macro.split("(")[0]) ?? 0) + 1)
console.log(`macro-call heading + block sites: ${sites.length} in ${new Set(sites.map(s => s.file)).size} files`)
console.log("by macro:", [...byMacro.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}×${v}`).join(", "))
console.log("\nsample sites:")
for (const s of sites.slice(0, 12)) console.log(`   ${s.file}:${s.line}  ${s.macro}`)
fs.writeFileSync("/tmp/c743-blocks.json", JSON.stringify(sites, null, 0))
console.log("\nwrote /tmp/c743-blocks.json")
