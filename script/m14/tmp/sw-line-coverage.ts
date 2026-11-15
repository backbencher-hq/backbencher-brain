// script/m14/tmp/sw-line-coverage.ts — the swift lane's M59.A7 measurement.
//
// Before this round the swift analyzer emitted NO `line_number` at all (the
// LCM `lines` cell read `fail`: "line_number not emitted"). This probe reports
// per-edge-kind totals vs how many carry a line, over the lane's two pinned
// corpora, at a caller-chosen cap per repo (default: both corpora, full extent).
//
// Run: bun script/m14/tmp/sw-line-coverage.ts [capPerRepo]
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = ["swift-nio", "alamofire"].map((r) => path.join("/home/ishaq2321/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|\.build|build|dist|\.git)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".swift")) out.push(p)
  }
  return out
}

async function main() {
  const cap = Number(process.argv[2] ?? 10000)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-swift-analyzer"))

  const byType: Record<string, { total: number; lined: number; zeroLine: number; sample: string[] }> = {}
  let files = 0
  let errored = 0
  let totalRels = 0

  for (const repo of REPOS) {
    const all = filesUnder(repo).sort().slice(0, cap)
    for (const f of all) {
      files++
      const content = fs.readFileSync(f, "utf8")
      const p = new P()
      p.setLanguage(LANG)
      let r: any
      try { r = await new mod.RealSwiftAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f)) } catch { errored++; continue }
      for (const e of r.relationships ?? []) {
        totalRels++
        const t = String(e.type)
        byType[t] ??= { total: 0, lined: 0, zeroLine: 0, sample: [] }
        byType[t].total++
        if (typeof e.line_number === "number" && e.line_number > 0) byType[t].lined++
        else {
          if (e.line_number === 0) byType[t].zeroLine++
          if (byType[t].sample.length < 4) {
            const src = content.split("\n")
            const ln = typeof e.line_number === "number" ? e.line_number : 0
            byType[t].sample.push(`${e.source}->${e.target}@${String(e.line_number)} ${JSON.stringify((src[ln - 1] ?? "").trim().slice(0, 60))}`)
          }
        }
      }
    }
  }

  console.log(`files=${files} relationships=${totalRels} analyzerThrew=${errored}`)
  let lined = 0
  for (const [t, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
    lined += s.lined
    if (s.total !== s.lined) console.log(`${t.padEnd(12)} total=${String(s.total).padStart(6)} lined=${String(s.lined).padStart(6)} UNLINED=${String(s.total - s.lined).padStart(5)} zero=${s.zeroLine}  e.g. ${s.sample.join(" ; ")}`)
    else console.log(`${t.padEnd(12)} total=${String(s.total).padStart(6)} lined=${String(s.lined).padStart(6)} unlined=     0`)
  }
  console.log(`TOTAL unlined=${totalRels - lined} of ${totalRels}`)
}
main()
