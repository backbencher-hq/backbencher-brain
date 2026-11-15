import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
// Analyzer-level line coverage by edge type (pre-store): which relationship
// classes leave the analyzer WITHOUT a line. Read-only; prints only.
const LANGS: Record<string, { wasm: string; file: string; cls: string; ext: string }> = {
  java: { wasm: "tree-sitter-java.wasm", file: "real-java-analyzer", cls: "RealJavaAnalyzer", ext: "java" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", file: "real-kotlin-analyzer", cls: "RealKotlinAnalyzer", ext: "kt" },
  scala: { wasm: "tree-sitter-scala.wasm", file: "real-scala-analyzer", cls: "RealScalaAnalyzer", ext: "scala" },
  groovy: { wasm: "tree-sitter-groovy.wasm", file: "real-groovy-analyzer", cls: "RealGroovyAnalyzer", ext: "groovy" },
}
function filesUnder(dir: string, ext: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target|out)/.test(e.name)) filesUnder(p, ext, out) }
    else if (e.name.endsWith("." + ext)) out.push(p)
  }
  return out
}
async function main() {
  const lang = process.argv[2]
  const target = process.argv[3]
  const cfg = LANGS[lang]
  if (!cfg) throw new Error("want java|kotlin|scala|groovy")
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const mod: any = await import(path.join(ROOT, "src/ast", cfg.file))
  const files = fs.statSync(target).isDirectory() ? filesUnder(target, cfg.ext).slice(0, Number(process.argv[4] ?? 40)) : [target]
  const byType: Record<string, { total: number; lined: number; unlinedExamples: string[] }> = {}
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(content).rootNode
    let r: any
    try { r = await new mod[cfg.cls]().analyze(root, content, path.basename(f)) } catch { continue }
    for (const e of (r.relationships ?? [])) {
      const t = String(e.type)
      byType[t] ??= { total: 0, lined: 0, unlinedExamples: [] }
      byType[t].total++
      if (typeof (e as any).line_number === "number" && (e as any).line_number > 0) byType[t].lined++
      else if (byType[t].unlinedExamples.length < 3) byType[t].unlinedExamples.push(`${e.source}->${e.target}`)
    }
  }
  for (const [t, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total))
    console.log(`${t.padEnd(14)} total=${s.total} lined=${s.lined} unlined=${s.total - s.lined} e.g. ${s.unlinedExamples.join(" ; ")}`)
}
main()
