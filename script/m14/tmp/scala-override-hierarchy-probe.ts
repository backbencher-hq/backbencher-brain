// The FULL prize of a corpus-wide override index, measured before changing anything.
//
// scala-override-index-probe.ts showed that building `overrideCompanion` over the
// corpus resolves 31 of 677 blind guesses and makes analysis FASTER. Only 31,
// because the transitive walk behind tier 2 is handed an IN-FILE hierarchy:
//
//   findDeclaringParent(name, parents, companion,
//     (t) => typeIndex.get(t)?.metadata?.superTypes ?? [])      // <- real-scala-analyzer.ts:689
//
// `typeIndex` is built from the current file's own symbols (line 251), so the walk
// climbs while every intermediate ancestor happens to be declared in the same file
// and dead-ends the moment one is not — which, for a library like scala3, is at
// the first base type outside the file.
//
// So the question is whether a corpus-wide HIERARCHY (type -> supertypes) resolves
// the remaining 646. This simulates exactly that walk against a corpus index,
// without editing the analyzer, so the prize is known before the cost.
//
// The simulation mirrors the analyzer's own rule, not an idealised one: a guess is
// resolved only if some ancestor reachable through the corpus hierarchy DECLARES
// the method name, and the nearest such ancestor wins. Anything unresolved stays a
// guess, which is the honest floor.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { mergeSymbolsIntoOverrideCompanion } from "../../../src/ast/override-context"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 400)
const MAX_DEPTH = 12

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()

  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT)
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

  // corpus indices, built the same way the fixture verifier builds its companion
  const companion = new Map<string, Set<string>>()
  for (const p of parsed) mergeSymbolsIntoOverrideCompanion(companion as any, p.symbols)

  // type -> supertypes, corpus-wide. superTypes is the analyzer's own published
  // heritage surface, so this index adds no new judgement; it only widens scope.
  const hierarchy = new Map<string, string[]>()
  const inFileHierarchy = new Map<string, string[]>()
  for (const p of parsed) {
    const local = new Map<string, string[]>()
    for (const s of p.symbols ?? []) {
      if (!s?.name) continue
      const sup = (s.metadata?.superTypes ?? []).map(String)
      if (sup.length) {
        hierarchy.set(s.name, [...(hierarchy.get(s.name) ?? []), ...sup])
        local.set(s.name, [...(local.get(s.name) ?? []), ...sup])
      }
    }
    inFileHierarchy.set(p.file, local)
  }
  for (const [k, v] of hierarchy) hierarchy.set(k, [...new Set(v)])

  const declaringAncestor = (method: string, parents: string[], hier: (t: string) => string[]): string => {
    const seen = new Set<string>()
    let frontier = [...parents]
    let depth = 0
    while (frontier.length && depth < MAX_DEPTH) {
      const next: string[] = []
      for (const t of frontier) {
        if (!t || seen.has(t)) continue
        seen.add(t)
        if (companion.get(t)?.has(method)) return t
        next.push(...hier(t))
      }
      frontier = [...new Set(next)]
      depth++
    }
    return ""
  }

  let guesses = 0
  let resolvable = 0
  let retargetsWrong = 0
  let resolvableButFirstSupertypeWrong = 0
  const examples: string[] = []
  const byDepth = new Map<number, number>()

  for (const p of parsed) {
    let res: any
    try { res = analyzer.analyze(p.root, p.src, path.join(CORPUS, repo, p.file)) } catch { continue }
    const local = inFileHierarchy.get(p.file) ?? new Map<string, string[]>()
    const localOnly = (t: string): string[] => local.get(t) ?? []
    for (const r of (res.relationships ?? [])) {
      if (String(r.type) !== "overrides") continue
      if (r.metadata?.reasonCode !== "first-supertype-guess") continue
      guesses++
      const method = String(r.source).split(".").pop() ?? ""
      const owner = String(r.source).slice(0, String(r.source).length - method.length - 1)
      const sym = (p.symbols ?? []).find((s: any) => s?.name === owner && String(s.kind) === "class")
      const parents = (sym?.metadata?.superTypes ?? []).map(String)
      if (!parents.length) continue
      const first = parents[0]
      const declaring = declaringAncestor(method, parents, (t) => hierarchy.get(t) ?? [])
      if (declaring) {
        resolvable++
        if (declaring !== first) {
          retargetsWrong++
          if (!companion.get(first)?.has(method)) resolvableButFirstSupertypeWrong++
        }
        // how deep was the winning ancestor?
        let d = 0
        let fr = [...parents]
        const sn = new Set<string>()
        while (fr.length && d < MAX_DEPTH && fr[0] !== declaring) {
          const nx: string[] = []
          for (const t of fr) { if (sn.has(t)) continue; sn.add(t); nx.push(...(hierarchy.get(t) ?? [])) }
          fr = [...new Set(nx)]
          d++
        }
        byDepth.set(d, (byDepth.get(d) ?? 0) + 1)
        if (examples.length < 14) {
          examples.push(`  ${r.source}  first-supertype=${first}  DECLARING=${declaring}  depth=${d}${companion.get(first)?.has(method) ? "" : "   (first supertype does NOT declare it)"}`)
        }
      }
    }
  }

  console.log(`# full corpus-hierarchy simulation — ${parsed.length} files from ${repo}`)
  console.log(`companion: ${companion.size} types / ${[...companion.values()].reduce((a, s) => a + s.size, 0)} methods`)
  console.log(`hierarchy: ${hierarchy.size} types carry supertypes\n`)
  console.log(`- first-supertype guesses: ${guesses}`)
  console.log(`- **resolvable** by a corpus hierarchy walk: ${resolvable}  (${((resolvable / guesses) * 100).toFixed(1)}%)`)
  console.log(`- of those, the correct parent is NOT the first supertype: ${retargetsWrong} (${((retargetsWrong / guesses) * 100).toFixed(1)}% of all guesses)`)
  console.log(`- and the first supertype does NOT even declare the method: ${resolvableButFirstSupertypeWrong} (${((resolvableButFirstSupertypeWrong / guesses) * 100).toFixed(1)}% — these are demonstrably WRONG today)`)
  console.log(`- still unresolved after ${MAX_DEPTH} levels: ${guesses - resolvable}`)
  console.log(`\nwinning-ancestor depth: ${[...byDepth].sort((a, b) => a[0] - b[0]).map(([d, n]) => `d${d}=${n}`).join(" ")}`)
  console.log(`\n## examples — a guess retargeted to the ancestor that actually declares it`)
  for (const e of examples) console.log(e)
}
main().catch((e) => { console.error(e); process.exit(1) })