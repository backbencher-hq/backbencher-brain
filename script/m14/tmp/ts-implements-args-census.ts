/**
 * M60 oracle-sharpness spin-off, issue evidence: `implements` targets that are not
 * names. script/m14/tmp/ts-heritage-convention.ts measured the lane publishing three
 * spellings for one relationship kind:
 *
 *   class A extends CSS.Properties<number>    -> "CSS.Properties"      (head, qualified)
 *   interface D extends CSS.Properties<number>-> "Properties"          (leaf, TSD3)
 *   class C implements ns.Iface<number>       -> "ns.Iface<number>"    (RAW TEXT, args included)
 *
 * The third is the #924 shape — a published string that is not a name — and it is
 * invisible to BOTH the differential and the sharpness sweep, because every
 * comparison strips `<...>` from the target before matching (normTarget does, and
 * strictTargetText keeps that stripping on purpose: args are not the qualifier).
 * The R10 census saw it and could not explain it: validation/m60/results/
 * target-spelling.json carries `implements|<` and `implements|>` in `unruledTriples`
 * with `separatorAdjudicable: true`.
 *
 * This census sizes it over the lane's whole corpus through the production entry.
 */
import * as fs from "fs"
import * as path from "path"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

const ROOT = process.env.BB_M14_ROOT ?? "<corpus-root>/mcp/backbencher-brain"
const REPOS = "<corpus-root>/bb_tests/repositories"
const LANES = ["vue-core", "element-plus"]

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (/^(\.|node_modules|dist|build|coverage|__snapshots__)$/.test(e.name)) continue
      filesUnder(p, out)
    } else if (/\.(ts|tsx|mts|cts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p)
  }
  return out
}

const hasArgs = (t: string) => /[<>]/.test(t)
const hasWhitespace = (t: string) => /\s/.test(String(t).trim())

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-typescript.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealTypeScriptAnalyzer()

  let files = 0
  const counts: Record<string, { total: number; args: number; ws: number }> = {
    extends: { total: 0, args: 0, ws: 0 },
    implements: { total: 0, args: 0, ws: 0 },
  }
  const samples: string[] = []
  const byFile = new Map<string, number>()

  for (const repo of LANES) {
    for (const f of filesUnder(path.join(REPOS, repo))) {
      let content = ""
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      files++
      const rel = path.relative(REPOS, f)
      const s: any = az.analyze(parser.parse(content).rootNode, content, path.basename(f))
      for (const r of s.relationships ?? []) {
        const t = String(r.type)
        const c = counts[t]
        if (!c) continue
        const target = String(r.target ?? "")
        c.total++
        if (hasArgs(target)) {
          c.args++
          byFile.set(rel, (byFile.get(rel) ?? 0) + 1)
          if (samples.length < 40) samples.push(`${rel}:${r.line_number ?? 0}  ${t}  ${r.source} -> ${JSON.stringify(target)}`)
        }
        if (hasWhitespace(target)) { c.ws++; if (samples.length < 40) samples.push(`${rel}:${r.line_number ?? 0}  ${t}  ${r.source} -> ${JSON.stringify(target)} (whitespace)`) }
      }
    }
  }

  console.log(`files analyzed: ${files}`)
  for (const k of Object.keys(counts)) console.log(`${k.padEnd(11)} total=${counts[k].total} withArgs=${counts[k].args} withWhitespace=${counts[k].ws}`)
  console.log(`files carrying an args-leaking target: ${byFile.size}`)
  console.log("samples:")
  for (const s of samples) console.log(`  ${s}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
