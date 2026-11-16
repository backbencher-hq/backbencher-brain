// #919 sanity: what does macroDeclaredBody actually match, and how big are the
// spans? Print 6 samples with span size, first line, and the file-scope edge
// count inside.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const before = JSON.parse(readFileSync("/tmp/c919-before.json", "utf8"))
const { macroDeclaredBody } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const f = path.join(CORPUS, "fmt/test/format-test.cc")
const src = readFileSync(f, "utf8")
const root = parser.parse(src).rootNode
const st: any[] = [root]
const rows: any[] = []
while (st.length) {
  const n = st.pop()!
  if (macroDeclaredBody(n)) {
    const dump = before["fmt/test/format-test.cc"]
    const a = n.startPosition.row + 1, b = n.endPosition.row + 1
    const g = (dump?.rels ?? []).filter((r: string) => { const p = r.split("|"); const ln = Number(p[p.length - 1]); return ln >= a && ln <= b && p[1] === "global" }).length
    rows.push({ type: n.type, lines: `${a}-${b} (${b - a + 1})`, head: src.split("\n")[a - 1].trim().slice(0, 46), global: g, sib: n.nextNamedSibling?.type ?? "-" })
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
rows.sort((a, b) => b.global - a.global)
for (const r of rows.slice(0, 6)) console.log(JSON.stringify(r))
console.log(`total matches in file: ${rows.length}; span>1 line: ${rows.filter(r => !r.lines.includes("(") || Number(r.lines.split("(")[1].slice(0, -1)) > 1).length}`)
