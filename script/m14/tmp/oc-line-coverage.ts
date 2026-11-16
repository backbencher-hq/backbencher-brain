// script/m14/tmp/oc-line-coverage.ts — the objc lane's M59.A7 measurement.
//
// Before this round the objc analyzer emitted NO `line_number` at all (the LCM
// `lines` cell read `fail`: "line_number not emitted"). This probe reports
// per-edge-kind totals vs how many carry a line, over the lane's two pinned
// corpora, at a caller-chosen cap per repo (default: both corpora, full extent).
//
// The file set is the HARNESS's own (`objc: { ext: "m,h" } with the objective-c
// content guard in script/m14/differential.ts), so the corpus this probe measures
// is the corpus the differential draws measure — a coverage claim about a
// different file set would not be about the lane. That universe grew in the
// M60 grammar wave: the header half (169 files of sdwebimage+afnetworking) was
// outside `ext: "m"` and outside every number this probe had ever reported.
//
// Run: bun script/m14/tmp/oc-line-coverage.ts [capPerRepo]
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPOS = ["sdwebimage", "afnetworking"].map((r) => path.join("<corpus-root>/bb_tests/repositories", r))

// A header belongs to this lane only when the ROUTER says so: production sniffs
// `.h` content for `@interface`/`@protocol`. Asking the router (rather than
// taking every `.h`) is what keeps the c/cpp lanes' headers out of an objc claim.
let detectLanguageFromPath: any = null
function onlyObjcRouted(file: string): boolean {
  if (!detectLanguageFromPath) return file.endsWith(".m")
  try {
    return detectLanguageFromPath(path.basename(file), fs.readFileSync(file, "utf8")) === "objective-c"
  } catch {
    return false
  }
}

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|\.git|build|dist|Pods\/Podspecs)/.test(e.name)) filesUnder(p, out) }
    // The lane's universe is now the router's: `.m` plus the headers the
    // OBJECTIVE-C router admits (language-detection sniffs `.h` for
    // `@interface`/`@protocol`). A `.h` that routes elsewhere is not this
    // lane's file — see the sampling-universe audit.
    else if (e.name.endsWith(".m") || e.name.endsWith(".h")) {
      if (onlyObjcRouted(p)) out.push(p)
    }
  }
  return out
}

async function main() {
  const cap = Number(process.argv[2] ?? 10000)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
  const ld: any = await import(path.join(ROOT, "src/ast/language-detection"))
  detectLanguageFromPath = ld.detectLanguageFromPath

  const byType: Record<string, { total: number; lined: number; zeroLine: number; sample: string[] }> = {}
  let files = 0
  let errored = 0
  let totalRels = 0

  for (const repo of REPOS) {
    const all = filesUnder(repo).sort()
    console.log(`[corpus] ${path.basename(repo)}: ${all.length} objc-routed file(s) (.m + admitted .h)${all.length > cap ? ` (drawing ${cap})` : " (full extent)"}`)
    for (const f of all.slice(0, cap)) {
      files++
      const content = fs.readFileSync(f, "utf8")
      const p = new P()
      p.setLanguage(LANG)
      let r: any
      try { r = await new mod.RealObjectiveCAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f)) } catch { errored++; continue }
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
