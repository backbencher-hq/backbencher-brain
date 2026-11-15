// #743c: WHERE do the bare-macro-statement sites live? Each `expression_statement`
// carrying a MISSING `;` is reported with its enclosing scope chain and the next
// non-space character after it — because a rule that only admits the shape as a
// body's LAST statement (before `}`) covers a different set than one that admits it
// anywhere, and the difference decides the rule's shape before any grammar edit.
//   bun script/m14/tmp/cpp743-context.ts [--wasm <path>] [repo ...]
import fs from "node:fs"
import path from "node:path"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const WASM = process.argv.includes("--wasm") ? process.argv[process.argv.indexOf("--wasm") + 1] : "wasm/tree-sitter-cpp.wasm"
const REPOS = process.argv.slice(2).filter((a, i, arr) => a !== "--wasm" && arr[i - 1] !== "--wasm")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(WASM))
const MAX = 400

type Row = { file: string; line: number; text: string; scope: string; next: string; firstChild: string; ident: boolean }
const rows: Row[] = []
for (const repo of (REPOS.length ? REPOS : ["fmt", "nlohmann-json"])) {
  const parser = new P()
  parser.setLanguage(lang)
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
    const lines = src.split("\n")
    const root = parser.parse(src).rootNode
    const st: Array<[any, string[]]> = [[root, []]]
    while (st.length) {
      const [n, chain] = st.pop()!
      if (n.type === "expression_statement") {
        let missing = false
        for (let i = 0; i < n.childCount; i++) if (n.child(i)?.isMissing) missing = true
        if (missing) {
          // scope chain: the nearest enclosing compound_statement / namespace / class
          const scope = [...chain].reverse().find(t => t === "compound_statement" || t === "namespace_definition" || t === "declaration_list" || t === "translation_unit") ?? "?"
          const rest = src.slice(n.endIndex).replace(/^[ \t\r\n]+/, "")
          const first = n.child(0)
          rows.push({
            file: path.relative(CORPUS, f), line: n.startPosition.row + 1,
            text: (lines[n.startPosition.row] ?? "").trim().slice(0, 58),
            scope, next: rest.slice(0, 12).replace(/\n/g, "\\n"), firstChild: first?.type ?? "(none)",
            ident: first?.type === "identifier",
          })
        }
      }
      const nextChain = [...chain, n.type].slice(-4)
      for (let i = 0; i < n.childCount; i++) st.push([n.child(i), nextChain])
    }
  }
}
const by = (f: (r: Row) => string) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
console.log(`total MISSING-";" macro-statement sites: ${rows.length} (${new Set(rows.map(r => r.file)).size} files)`)
console.log("\nBY FIRST CHILD:"); for (const [k, v] of by(r => r.firstChild)) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log("\nBY NEXT TOKEN AFTER THE STATEMENT:"); for (const [k, v] of by(r => r.next[0] === "}" ? "}" : r.next[0] === "#" ? "#" : r.next.slice(0, 4))) console.log(`  ${String(v).padStart(4)}  ${JSON.stringify(k)}`)
console.log("\nBY ENCLOSING SCOPE:"); for (const [k, v] of by(r => r.scope)) console.log(`  ${String(v).padStart(4)}  ${k}`)
const tail = rows.filter(r => r.next[0] === "}").length
console.log(`\nTAIL-ONLY coverage (next non-space char is "}"): ${tail}/${rows.length}`)
console.log("\nsample (first 25):")
for (const r of rows.slice(0, 25)) console.log(`  ${r.firstChild.padEnd(17)} next=${JSON.stringify(r.next).padEnd(16)} ${r.file}:${r.line}  ${r.text}`)
