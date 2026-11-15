import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
// Analyzer-level Tier A (no pipeline, no shared DB): every emitted
// relationship line must contain its target's leaf name (Tier-A-exact:
// post-dot leaf, word boundaries, $ sigil tolerated). Mirrors
// verify-store-line-landing.ts boundary semantics.
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function filesUnder(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|dist|build|__pycache__)/.test(e.name)) filesUnder(p, exts, out) }
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}
async function main() {
  const target = process.argv[2]
  const maxFiles = Number(process.argv[3] ?? 200)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-python-analyzer"))
  const files = filesUnder(target, [".py"]).slice(0, maxFiles)
  let pass = 0, fail = 0, nolines = 0
  const bad: string[] = []
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n")
    const src = fs.readFileSync(f, "utf8")
    const p = new P(); p.setLanguage(LANG)
    let r: any
    try { r = await new mod.RealPythonAnalyzer().analyze(p.parse(src).rootNode, src, path.basename(f)) } catch { continue }
    for (const e of (r.relationships ?? [])) {
      const ln = e.line_number
      const rawTarget = String(e.target ?? "")
      if (typeof ln !== "number" || ln <= 0) { nolines++; continue }
      const leaf = rawTarget.split(".").pop() ?? ""
      if (!/^[\w$#:@.-]+$/.test(leaf)) continue
      const t = lines[ln - 1] ?? ""
      const ok = new RegExp(`(^|[^\\w])\\$?${escapeRe(leaf)}([^\\w]|$)`).test(t)
      if (ok) pass++
      else {
        fail++
        if (bad.length < 15) bad.push(`${path.basename(f)}:${ln} ${e.type} ${e.source}->${e.target} | ${t.trim().slice(0, 60)}`)
      }
    }
  }
  console.log(`files=${files.length} pass=${pass} fail=${fail} nolines=${nolines}`)
  for (const b of bad) console.log("FAIL", b)
}
main()
