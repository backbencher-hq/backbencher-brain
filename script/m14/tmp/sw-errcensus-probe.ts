// script/m14/tmp/sw-errcensus-probe.ts — how widespread is the ERROR-wrapped nominal
// declaration in swift-nio (an ERROR node whose first anonymous token is
// class/struct/enum/extension/actor and which owns a direct type_identifier)?
// Run: bun script/m14/tmp/sw-errcensus-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPO = "/home/ishaq2321/bb_tests/repositories/swift-nio"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))

const files: string[] = []
;(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/^(\.|build|\.build)/.test(e.name)) walk(path.join(dir, e.name)) }
    else if (e.name.endsWith(".swift")) files.push(path.join(dir, e.name))
  }
})(REPO)

const KW = new Set(["class", "struct", "enum", "extension", "actor"])
let total = 0, filesHit = 0, errFiles = 0
const rows: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const pp = new P(); pp.setLanguage(LANG)
  const root = pp.parse(src).rootNode
  if (!root.hasError) continue
  errFiles++
  const lineOf = (i: number) => (src.slice(0, i).match(/\n/g) ?? []).length + 1
  const st: any[] = [root]
  let hits = 0
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "ERROR") {
      const first = n.child(0)
      if (first && !first.isNamed && KW.has(first.type)) {
        let ti: any = null
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i)!; if (c.type === "type_identifier" || c.type === "simple_identifier" || c.type === "identifier") { ti = c; break } }
        if (ti) {
          hits++; total++
          rows.push(`${path.relative(REPO, f)}:${lineOf(n.startIndex)} kw=${first.type} name=${ti.text} span=${lineOf(n.startIndex)}..${lineOf(n.endIndex)} parent=${n.parent?.type}`)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  if (hits > 0) filesHit++
}
console.log(`files with parse errors: ${errFiles}/${files.length}`)
console.log(`ERROR-wrapped declarations: ${total} in ${filesHit} files`)
for (const r of rows.slice(0, 60)) console.log("  " + r)
if (rows.length > 60) console.log(`  … +${rows.length - 60} more`)
