// haskell line-coverage probe (M59.A7 / dimension 8), extended 2026-09-25.
//
// Reports, per relationship type:
//   total     — the edges the analyzer emits NOW (line in the dedupe key, so a
//               call from three lines is three edges);
//   lined     — those carrying a positive `line_number` (the field's contract);
//   collapsed — the same edges keyed by `source|type|target` only, which IS the
//               pre-change count on the identical file set: before this round the
//               key had no line, so every later site's edge was swallowed. The
//               difference total-collapsed is the multi-site expansion the round
//               bought, and it is the honest before/after on one draw rather than
//               two different draws compared as if they were the same.
//
// The artifact also carries the before/after pair this round exists to move:
//   after  — the edges as emitted now: `lined` / `edges`;
//   before — the SAME draw under the pre-round pushRel (key `source|type|target`
//            only, no line field), i.e. the collapse, with 0 of them lined. The
//            pre-round edge count is therefore exact, not an estimate: the old
//            key WAS the collapse key. `before.lined = 0` is not a re-run of the
//            old code (the old analyzer is not importable from this probe) — it
//            is the old code's payload contract (this round's diff) corroborated
//            by the live pre-change draw recorded in
//            reviews/functional-family/m60-functional-sweep.md §4
//            (5,240 of 5,240 edges unlined, cabal+hledger 60-file draw).
//
// Usage: bun script/m14/tmp/hs-line-coverage.ts <dir> [maxFiles] [--out file]
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
function filesUnder(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: any[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/^(\.|node_modules|dist|build)/.test(e.name)) filesUnder(p, exts, out)
    } else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}
async function main() {
  const target = process.argv[2]
  const maxFiles = Number(process.argv[3] ?? 40)
  const outIdx = process.argv.indexOf("--out")
  const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-haskell.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-haskell-analyzer"))
  const files = filesUnder(target, [".hs"]).slice(0, maxFiles)
  const byType: Record<string, { total: number; lined: number; collapsed: number; maxSites: number; unlinedExamples: string[] }> = {}
  let symbols = 0
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const p = new P()
    p.setLanguage(LANG)
    let r: any
    try {
      r = await new mod.RealHaskellAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f))
    } catch {
      continue
    }
    symbols += (r.symbols ?? []).length
    const groups = new Map<string, number>()
    for (const e of r.relationships ?? []) {
      const t = String(e.type)
      byType[t] ??= { total: 0, lined: 0, collapsed: 0, maxSites: 0, unlinedExamples: [] }
      byType[t].total++
      if (typeof (e as any).line_number === "number" && (e as any).line_number > 0) byType[t].lined++
      else if (byType[t].unlinedExamples.length < 4) byType[t].unlinedExamples.push(`${e.source}->${e.target}`)
      const gk = `${t}|${e.source}|${e.target}`
      groups.set(gk, (groups.get(gk) ?? 0) + 1)
    }
    for (const [gk, n] of groups) {
      const t = gk.slice(0, gk.indexOf("|"))
      byType[t].collapsed++
      if (n > byType[t].maxSites) byType[t].maxSites = n
    }
  }
  const sum = (k: "total" | "lined" | "collapsed") => Object.values(byType).reduce((a, s) => a + s[k], 0)
  console.log(`files=${files.length} symbols=${symbols}`)
  for (const [t, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total))
    console.log(
      `${t.padEnd(14)} total=${s.total} lined=${s.lined} unlined=${s.total - s.lined} pre=${s.collapsed} multiSite=${s.total - s.collapsed} maxSitesPerGroup=${s.maxSites} ${s.unlinedExamples.length ? "e.g. " + s.unlinedExamples.join(" ; ") : ""}`,
    )
  console.log(
    `TOTAL edges=${sum("total")} lined=${sum("lined")} unlined=${sum("total") - sum("lined")} preChangeEdges=${sum("collapsed")} expansion=${sum("total") - sum("collapsed")}`,
  )
  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "m60-haskell-line-coverage",
          generatedAt: new Date().toISOString(),
          corpus: { dir: target, files: files.length, maxFiles },
          note: "total = edges now emitted (line in the dedupe key); lined = carrying a positive line_number; pre = the same file set keyed source|type|target only, i.e. the pre-round edge count (0 carry a line by construction); expansion = total - pre is what per-site identity bought. Sampled by directory order, NOT the seeded F5 draw — this is a coverage measurement, not the corpus differential.",
          totals: {
            files: files.length,
            symbols,
            edges: sum("total"),
            lined: sum("lined"),
            unlined: sum("total") - sum("lined"),
            preChangeEdges: sum("collapsed"),
            expansion: sum("total") - sum("collapsed"),
          },
          beforeAfter: {
            after: {
              edges: sum("total"),
              lined: sum("lined"),
              unlined: sum("total") - sum("lined"),
              unlinedShare: sum("total") ? (sum("total") - sum("lined")) / sum("total") : 0,
            },
            before: {
              edges: sum("collapsed"),
              lined: 0,
              unlined: sum("collapsed"),
              unlinedShare: 1,
              basis:
                "pre-round pushRel keyed source|type|target only and published no line_number field (this round's diff), so the pre-round edge count IS the same-draw collapse and none of them carried a line; corroborated live before this round landed at 5,240 of 5,240 edges unlined on the cabal+hledger 60-file draw (reviews/functional-family/m60-functional-sweep.md §4).",
            },
          },
          byType,
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`wrote ${OUT}`)
  }
}
main()
