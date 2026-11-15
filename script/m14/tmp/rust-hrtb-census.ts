import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS = "/home/sano/ishaq/bb_rust_corpora"
const SKIP = new Set([".git", "target", "tests", "test", "benches", "examples"])
function walk(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) out.push(p)
  }
  return out
}
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts, L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const parser = new P(); parser.setLanguage(g)
  let hrtbSites = 0, files = 0, rows: string[] = []
  for (const repo of fs.readdirSync(CORPUS)) {
    const dir = path.join(CORPUS, repo)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of walk(dir)) {
      const text = fs.readFileSync(f, "utf8")
      const root = parser.parse(text).rootNode
      let hit = 0
      const st: any[] = [root]
      while (st.length) {
        const n = st.pop()
        // a trait bound list whose FIRST bound is a `for<…>` binder
        if (n.type === "trait_bounds") {
          const first = n.namedChild(0)
          if (first && /^\s*for\s*</.test(first.text)) { hit++; if (rows.length < 8) rows.push(`${repo}/${path.relative(dir, f)}:${first.startPosition.row + 1}  ${first.text.slice(0, 70)}`) }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
      if (hit) { hrtbSites += hit; files++ }
    }
  }
  console.log(`\n######## RUST HRTB CENSUS — higher-ranked trait bounds (for<'a> Trait<'a>)`)
  console.log(`  sites=${hrtbSites} in ${files} files across 5 corpora`)
  for (const r of rows) console.log(`    ${r}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
