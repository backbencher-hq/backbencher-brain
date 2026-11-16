// Frequency of the "split call" shape (field_access/identifier immediately
// followed by a parenthesized_expression) under both grammars.
import fs from "node:fs"
import path from "node:path"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const REPOS = ["<corpus-root>/bb_tests/repositories/grails-core", "<corpus-root>/bb_tests/repositories/geb"]
function walkFiles(dir: string, out: string[] = []): string[] {
  let es: any[] = []
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (["node_modules", ".git", "build", "target"].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".groovy")) out.push(p)
  }
  return out
}
const files = REPOS.flatMap((r) => walkFiles(r)).sort()
console.log("files:", files.length)
for (const [name, wasm] of [["OLD", "/tmp/g841-worktree-7f01e3ed.wasm"], ["NEW", "<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"]] as Array<[string, string]>) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P()
  parser.setLanguage(lang)
  let total = 0
  const samples: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const t = parser.parse(src)
    const w = (n: any) => {
      if (n.type === "field_access" || n.type === "identifier") {
        const sib = n.nextNamedSibling
        if (sib && sib.type === "parenthesized_expression" && sib.startIndex === n.endIndex) {
          total++
          if (samples.length < 6) samples.push(`${path.relative("<corpus-root>/bb_tests/repositories", f)}:${n.startPosition.row + 1} ${JSON.stringify(src.slice(n.startIndex, sib.endIndex).slice(0, 40))}`)
        }
      }
      for (let i = 0; i < n.childCount; i++) w(n.child(i))
    }
    w(t.rootNode)
  }
  console.log(`\n${name}: split-call shapes = ${total}`)
  for (const s of samples) console.log("   ", s)
}
