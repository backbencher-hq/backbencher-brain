// script/m14/tmp/dt-bare-read-census.ts — the sub-threshold `uses` edges.
//
// M12's dart run reports 8 observed facts in state "unknown": they are the
// analyzer's own low-confidence claims (confidence 0.6 < the harness's 0.7
// claim threshold), so the truth never has to assert their target. That is the
// honesty channel working — but "unknown" is not the same as "correct": this
// probe dumps every edge the analyzer labels below 0.7, with its metadata, so
// each one can be triaged against the SOURCE TEXT rather than against the
// analyzer's own output.
//
// Reads only. Usage: bun script/m14/tmp/dt-bare-read-census.ts [--corpus]
import { readdirSync, statSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

function walk(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|dist|\.dart_tool)/.test(e.name)) walk(p, out) }
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

async function dump(file: string, label: string) {
  const p: any = await parseFile(resolve(file), ROOT)
  const rels = (p.relationships ?? []).filter((r: any) => (r.confidence ?? 1) < 0.7)
  if (rels.length === 0) return 0
  console.log(`\n=== ${label} (${rels.length} sub-threshold edges)`)
  for (const r of rels) {
    console.log(`  ${r.type} ${r.source} -> ${r.target} conf=${r.confidence} line=${r.line_number} meta=${JSON.stringify(r.metadata ?? {})}`)
  }
  return rels.length
}

async function main() {
  const corpus = process.argv.includes("--corpus")
  let total = 0
  const fixtures = readdirSync(join(ROOT, "validation/m12/fixtures/dart")).filter((f) => f.endsWith(".dart")).sort()
  for (const f of fixtures) total += await dump(join(ROOT, "validation/m12/fixtures/dart", f), `m12/${f}`)

  if (corpus) {
    // Full extent on the pinned dart corpora — the fixtures are the witness,
    // the corpus is the blast radius.
    const repos = ["proxicall", "dart-http"].map((r) => join("<corpus-root>/bb_tests/repositories", r))
    const byShape = new Map<string, { n: number; sample: string }>()
    let files = 0, edges = 0
    for (const repo of repos) {
      // proxicall is a symlink; walk with -L semantics via readdir on the real path
      const list = walk(repo).sort()
      for (const f of list) {
        files++
        let p: any
        try { p = await parseFile(resolve(f), ROOT) } catch { continue }
        for (const r: any of p.relationships ?? []) {
          if ((r.confidence ?? 1) >= 0.7) continue
          edges++
          const meta = JSON.stringify(r.metadata ?? {})
          const key = `${r.type}|${meta}`
          const cur = byShape.get(key)
          if (cur) cur.n++
          else byShape.set(key, { n: 1, sample: `${f.replace("<corpus-root>/", "")}:${r.line_number} ${r.source} -> ${r.target}` })
        }
      }
      console.log(`[corpus] ${repo}: ${list.length} files so far, ${edges} sub-threshold edges`)
    }
    console.log(`\n[corpus] ${files} files, ${edges} sub-threshold edges`)
    for (const [k, v] of [...byShape].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${v.n}\t${k}\t${v.sample}`)
  }
  console.log(`\nfixture sub-threshold total: ${total}`)
}

main().then(() => process.exit(0))
