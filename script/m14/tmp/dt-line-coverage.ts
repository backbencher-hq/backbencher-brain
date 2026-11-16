// script/m14/tmp/dt-line-coverage.ts — the dart lane's M59.A7 baseline.
//
// The `lines` cell of the language-completion matrix needs `line_number` to be
// ALIVE for the language (M60.P1 reads the analyzers' own emission). dart emits
// NONE, so this measures the starting point the php round measured for its lane:
// per-edge-kind totals vs how many carry a line, over both pinned corpora.
//
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPOS = ["proxicall", "dart-http"].map((r) => path.join("<corpus-root>/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|dist|\.dart_tool)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

async function main() {
  const cap = Number(process.argv[2] ?? 120)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-dart-analyzer"))

  const byType: Record<string, { total: number; lined: number; sample: string[] }> = {}
  let files = 0
  let totalRels = 0

  for (const repo of REPOS) {
    for (const f of filesUnder(repo).sort().slice(0, cap)) {
      files++
      const content = fs.readFileSync(f, "utf8")
      const p = new P()
      p.setLanguage(LANG)
      let r: any
      try { r = await new mod.RealDartAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f)) } catch { continue }
      for (const e of r.relationships ?? []) {
        totalRels++
        const t = String(e.type)
        byType[t] ??= { total: 0, lined: 0, sample: [] }
        byType[t].total++
        if (typeof e.line_number === "number" && e.line_number > 0) byType[t].lined++
        else if (byType[t].sample.length < 3) byType[t].sample.push(`${e.source}->${e.target}`)
      }
    }
  }

  console.log(`files=${files} (cap ${cap}/repo) relationships=${totalRels}`)
  let lined = 0
  for (const [t, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
    lined += s.lined
    console.log(`${t.padEnd(14)} total=${String(s.total).padStart(6)} lined=${String(s.lined).padStart(6)} unlined=${String(s.total - s.lined).padStart(6)}  e.g. ${s.sample.join(" ; ")}`)
  }
  console.log(`TOTAL unlined=${totalRels - lined} of ${totalRels}`)
}
main()
