// script/m14/tmp/sw-errshape-probe.ts — the exact child shape of each ERROR-wrapped
// nominal declaration header (5 sites) so the recovery rule can be read structurally.
// Run: bun script/m14/tmp/sw-errshape-probe.ts
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
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const pp = new P(); pp.setLanguage(LANG)
  const root = pp.parse(src).rootNode
  if (!root.hasError) continue
  const lineOf = (i: number) => (src.slice(0, i).match(/\n/g) ?? []).length + 1
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "ERROR") {
      const first = n.child(0)
      if (first && !first.isNamed && KW.has(first.type)) {
        console.log(`\n### ${path.relative(REPO, f)}:${lineOf(n.startIndex)} kw=${first.type} parent=${n.parent?.type} span=${lineOf(n.startIndex)}..${lineOf(n.endIndex)}`)
        for (let i = 0; i < Math.min(n.childCount, 12); i++) {
          const c = n.child(i)!
          const kids: string[] = []
          for (let j = 0; j < Math.min(c.namedChildCount, 4); j++) kids.push(c.namedChild(j)!.type)
          console.log(`  [${i}] ${c.type}${c.isNamed ? "" : " (anon)"} ${JSON.stringify(c.text.slice(0, 46))}${kids.length ? ` kids=[${kids.join(",")}]` : ""}`)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}
