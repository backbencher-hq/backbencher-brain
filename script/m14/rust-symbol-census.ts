#!/usr/bin/env bun
/**
 * RUST SYMBOL + RELATIONSHIP CENSUS — the independent whole-population count.
 *
 * WHY THIS EXISTS. The master review (2026-11-20) needed a number for the symbol
 * surface that did NOT come from the arm's own TABLE 1: how many symbols, of what
 * kind, at what visibility, how many edges refused and why. `incoming-gate.ts`
 * answers the edge question; nothing answered the symbol question. This does, over
 * the same admitted population, through the same production entry
 * (`ASTEngine.parseFile`'s components: getParser -> analyze).
 *
 * IT IS INDEPENDENT IN THE WAY THAT MATTERS: it counts `res.symbols` and
 * `res.relationships` from `RealRustAnalyzer.analyze` directly, so it cannot
 * inherit a number from the gate's classifier. It shares the analyzer and the
 * grammar with production, which is the point — it is a census of what production
 * emits, not a second opinion about what it should emit.
 *
 * ADMITTED POPULATION (the same rule the arm uses): per-checkout `git ls-files`,
 * extension `.rs`, present on disk, <= 1 MiB. Never the disk alone.
 *
 * USAGE:
 *   BB_CORPUS_ROOT=/path/to/corpora bun run script/m14/rust-symbol-census.ts
 *   BB_CORPUS_ROOT=... bun run script/m14/rust-symbol-census.ts --json out.json
 *
 * The nine repositories are discovered, not hard-coded: every immediate child of
 * the corpus root whose `git ls-files '*.rs'` is non-empty is a rust corpus here.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.cwd()
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024

function gitLsFiles(repo: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "*.rs"], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 })
    return out.split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function discoverRepos(): string[] {
  const out: string[] = []
  let entries: string[] = []
  try { entries = readdirSync(CORPUS) } catch { return out }
  for (const e of entries.sort()) {
    if (e.startsWith(".")) continue
    const p = path.join(CORPUS, e)
    try { if (!statSync(p).isDirectory()) continue } catch { continue }
    if (gitLsFiles(p).length > 0) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const mod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
  const analyzer: any = new mod.RealRustAnalyzer()

  const repos = discoverRepos()
  const files: string[] = []
  // A repository is a CORPUS here only if it contributes at least one ADMITTED file.
  // `discoverRepos` finds every child whose `git ls-files '*.rs'` is non-empty, which
  // also matches repositories whose tracked .rs files are all tracked-but-absent on
  // this checkout (measured 2026-11-20: `julia` 14 tracked / 0 present and
  // `pb-reference` 121 tracked / 0 present). Those are not part of the population, so
  // they are counted separately and reported as `reposWithTrackedButNoAdmittedFile`,
  // never folded into `repositories` — the arm's population line says 9 and this must
  // be able to say 9 too.
  const reposWithTracked: string[] = []
  const reposContributing: string[] = []
  for (const r of repos) {
    const tracked = gitLsFiles(r)
    let admitted = 0
    for (const rel of tracked) {
      const abs = path.join(r, rel)
      try { if (statSync(abs).size <= SIZE_CAP) { files.push(abs); admitted++ } } catch { /* tracked-but-absent */ }
    }
    if (tracked.length > 0) reposWithTracked.push(r)
    if (admitted > 0) reposContributing.push(r)
  }
  if (files.length === 0) {
    console.error(`rust-symbol-census: 0 admitted .rs files under ${CORPUS}. Set BB_CORPUS_ROOT.`)
    process.exit(6)
  }

  const kindCount: Record<string, number> = {}
  const visCount: Record<string, number> = {}
  const relCount: Record<string, number> = {}
  const confCount: Record<string, Record<string, number>> = {}
  const evCount: Record<string, Record<string, number>> = {}
  const unattr: Record<string, number> = {}
  let totalSymbols = 0
  let totalEdges = 0
  let filesWithErrors = 0
  let macroArgumentReads = 0

  for (const f of files) {
    let src = ""
    try { src = readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(src) } catch { continue }
    if (!tree) continue
    const res: any = analyzer.analyze(tree.rootNode, src, f)
    totalSymbols += (res.symbols ?? []).length
    if (res.metadata?.errors?.length) filesWithErrors++
    if (res.metadata?.macroArgumentReads) macroArgumentReads += res.metadata.macroArgumentReads
    for (const [k, v] of Object.entries(res.metadata?.unattributedEdges ?? {}) as [string, number][]) {
      unattr[k] = (unattr[k] ?? 0) + v
    }
    for (const s of res.symbols ?? []) {
      kindCount[s.kind] = (kindCount[s.kind] ?? 0) + 1
      const v = String(s.visibility ?? "(none)")
      visCount[v] = (visCount[v] ?? 0) + 1
    }
    for (const r of res.relationships ?? []) {
      totalEdges++
      const t = String(r.type)
      relCount[t] = (relCount[t] ?? 0) + 1
      const c = String(r.confidence ?? "(none)")
      ;(confCount[t] ??= {})[c] = (confCount[t][c] ?? 0) + 1
      const e = String(r.metadata?.evidenceClass ?? "(none)")
      ;(evCount[t] ??= {})[e] = (evCount[t][e] ?? 0) + 1
    }
  }

  const report = {
    population: {
      corpusRoot: CORPUS,
      repositories: reposContributing.length,
      repositoriesWithTrackedRs: reposWithTracked.length,
      reposWithTrackedButNoAdmittedFile: reposWithTracked
        .filter((r) => !reposContributing.includes(r))
        .map((r) => path.basename(r)),
      files: files.length,
      rule: "git ls-files '*.rs', present on disk, <= 1 MiB",
    },
    totals: { symbols: totalSymbols, relationships: totalEdges, filesWithErrors, macroArgumentReads },
    symbolsByKind: kindCount,
    symbolsByVisibility: visCount,
    relationshipsByType: relCount,
    confidenceByType: confCount,
    evidenceClassByType: evCount,
    refusedEdges: unattr,
    refusedTotal: Object.values(unattr).reduce((a, b) => a + b, 0),
    note: "Counts are of what RealRustAnalyzer.analyze emits over the admitted population. They are not a claim about correctness — the differential and the fixtures carry that.",
  }

  const jsonArg = process.argv.indexOf("--json")
  const outPath = jsonArg >= 0 ? process.argv[jsonArg + 1] : null
  const text = JSON.stringify(report, null, 2)
  if (outPath) {
    writeFileSync(outPath, text)
    console.log(`rust-symbol-census: wrote ${outPath}`)
  } else {
    console.log(text)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })