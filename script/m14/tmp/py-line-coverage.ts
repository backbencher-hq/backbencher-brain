import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
function filesUnder(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|dist|build)/.test(e.name)) filesUnder(p, exts, out) }
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}
async function main() {
  const target = process.argv[2]
  const maxFiles = Number(process.argv[3] ?? 40)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-python-analyzer"))
  const files = filesUnder(target, [".py"]).slice(0, maxFiles)
  const byType: Record<string, { total: number; lined: number; unlinedExamples: string[] }> = {}
  let syms = 0
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const p = new P(); p.setLanguage(LANG)
    const t0 = performance.now()
    let r: any
    try { r = await new mod.RealPythonAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f)) } catch { continue }
    const ms = performance.now() - t0
    if (process.argv.includes("--time")) console.log(`${ms.toFixed(0)}ms ${(r.relationships ?? []).length}r ${path.basename(f)}`)
    syms += (r.symbols ?? []).length
    for (const e of (r.relationships ?? [])) {
      const t = String(e.type)
      byType[t] ??= { total: 0, lined: 0, unlinedExamples: [] }
      byType[t].total++
      if (typeof (e as any).line_number === "number" && (e as any).line_number > 0) byType[t].lined++
      else if (byType[t].unlinedExamples.length < 4) byType[t].unlinedExamples.push(`${e.source}->${e.target}`)
    }
  }
  console.log(`files=${files.length} symbols=${syms}`)
  for (const [t, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total))
    console.log(`${t.padEnd(14)} total=${s.total} lined=${s.lined} unlined=${s.total - s.lined} e.g. ${s.unlinedExamples.join(" ; ")}`)
}
main()
