// What does a CORPUS-WIDE override index actually buy, and what does it cost?
//
// The finding that motivates this: `overrideCompanion` is a declared field on the
// analysis context, and the ONLY thing in the repo that ever builds it is
// script/m12/verify-analyzer.ts — over the FIXTURE directory. The corpus lane
// passes no context, so the analyzer's second `overrides` tier
// (`companion-index`, confidence 0.9, real-scala-analyzer.ts:684) never runs on a
// corpus, and every cross-file override falls through to tier 3
// (`first-supertype-guess`, confidence 0.5), which takes `parents[0]` WITHOUT
// checking that type declares the method.
//
// So the fixture suite certifies a resolution path the corpus never takes. That
// is the L1 ceiling the honesty contract names, in a sharper form: not just
// "fixtures are not a measurement" but "the fixture harness ENABLES a code path
// the engine never enables".
//
// Two passes over the same draw, from the same parsed trees, so the only variable
// is the context:
//   pass A  analyze(root, src, file)                  — what the corpus lane does
//   pass B  analyze(root, src, file, { overrideCompanion })
// Reported: tier movement, rows that appear/disappear/retarget, and wall time for
// each pass, because an index that fixes correctness and wrecks the perf budget
// is not a fix.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { mergeSymbolsIntoOverrideCompanion } from "../../../src/ast/override-context"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 400)

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)

  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT)
  const analyzer = new RealScalaAnalyzer()

  // pass 0 — parse once, reuse for both passes
  const parsed: { file: string; src: string; root: any; symbols: any[] }[] = []
  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    if (!fs.existsSync(fp)) continue
    const src = fs.readFileSync(fp, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    let res: any
    try { res = analyzer.analyze(root, src, fp) } catch { continue }
    parsed.push({ file: f, src, root, symbols: res.symbols ?? [] })
  }

  // the index the fixture verifier builds — identical function, corpus instead of fixtures
  const companion = new Map<string, Set<string>>()
  for (const p of parsed) mergeSymbolsIntoOverrideCompanion(companion as any, p.symbols)
  const indexStats = { types: companion.size, methods: [...companion.values()].reduce((a, s) => a + s.size, 0) }

  const overridesOf = (r: any): any[] => (r.relationships ?? []).filter((x: any) => String(x.type) === "overrides")
  const keyOf = (r: any): string => `${r.source} -> ${r.target}@${r.confidence ?? 1}`

  // pass A — no context (what the corpus lane does today)
  const tA0 = performance.now()
  const A = new Map<string, any[]>()
  for (const p of parsed) {
    let res: any
    try { res = analyzer.analyze(p.root, p.src, path.join(CORPUS, repo, p.file)) } catch { continue }
    A.set(p.file, overridesOf(res))
  }
  const msA = performance.now() - tA0

  // pass B — with the corpus-wide companion index
  const tB0 = performance.now()
  const B = new Map<string, any[]>()
  for (const p of parsed) {
    let res: any
    try { res = analyzer.analyze(p.root, p.src, path.join(CORPUS, repo, p.file), { overrideCompanion: companion } as any) } catch { continue }
    B.set(p.file, overridesOf(res))
  }
  const msB = performance.now() - tB0

  const tier = (rows: any[]): Record<string, number> => {
    const o: Record<string, number> = {}
    for (const r of rows) {
      const t = r.metadata?.reasonCode ?? "exact-in-file"
      o[t] = (o[t] ?? 0) + 1
    }
    return o
  }
  const allA = [...A.values()].flat()
  const allB = [...B.values()].flat()
  const setA = new Set(allA.map(keyOf))
  const setB = new Set(allB.map(keyOf))

  console.log(`# corpus-wide override index — ${parsed.length} files from ${repo}\n`)
  console.log(`index: ${indexStats.types} owner types, ${indexStats.methods} method names\n`)
  console.log("| pass | overrides rows | by reasonCode | ms | ms/file |")
  console.log("|---|---:|---|---:|---:|")
  for (const [name, rows, ms] of [["A — no context (today)", allA, msA], ["B — corpus index", allB, msB]] as const) {
    console.log(`| ${name} | ${rows.length} | ${Object.entries(tier(rows)).map(([k, v]) => `${k}=${v}`).join(", ")} | ${ms.toFixed(0)} | ${(ms / parsed.length).toFixed(2)} |`)
  }

  const added = [...setB].filter((k) => !setA.has(k))
  const removed = [...setA].filter((k) => !setB.has(k))
  const kept = [...setA].filter((k) => setB.has(k))
  console.log(`\n## row movement`)
  console.log(`- unchanged: ${kept.length}`)
  console.log(`- **added** by the index: ${added.length}`)
  console.log(`- **removed** by the index: ${removed.length}`)
  const reasonOf = (k: string): string => k.split("@")[1]
  const group = (keys: string[]): string => {
    const m = new Map<string, number>()
    for (const k of keys) m.set(reasonOf(k), (m.get(reasonOf(k)) ?? 0) + 1)
    return [...m].map(([k, v]) => `${k}:${v}`).join(" ")
  }
  console.log(`  added by confidence: ${group(added)}`)
  console.log(`  removed by confidence: ${group(removed)}`)

  console.log(`\n## sample of rows the index REMOVED (a guess that no longer survives verification)`)
  for (const k of removed.slice(0, 12)) console.log(`  - ${k}`)
  console.log(`\n## sample of rows the index ADDED (a guess upgraded to companion-index)`)
  for (const k of added.slice(0, 12)) console.log(`  - ${k}`)
}
main().catch((e) => { console.error(e); process.exit(1) })