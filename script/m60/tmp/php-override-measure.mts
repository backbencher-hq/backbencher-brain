/**
 * `overrides` — before and after the cross-file companion, on the full corpus.
 *
 * Measures all four numbers the label's credibility rests on:
 *   analyzer edges, truth rows, agreement, and — the one that matters — whether the
 *   published coverage match has anything to compare at all.
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { buildPhpOverrideCompanion, derivePhpEdges, derivePhpContainsEdges, derivePhpDeclaredTypeEdgesIndependent } =
  await import(path.join(ROOT, "script/m14/differential.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const g: any = await (wts as any).Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-php.wasm`))
const parser = new P(); parser.setLanguage(g)

for (const repo of ["phpunit", "phpmyadmin"]) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  const files = execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 })
    .toString().split("\0").filter(Boolean).sort().map((f) => path.join(dir, f))

  // ---- PASS 1: the index, from the grammar ----
  const companion = buildPhpOverrideCompanion(files, (f) => {
    let t: any = null
    try { t = parser.parse(readFileSync(f, "utf8")) } catch { return null }
    return t
  })

  // ---- PASS 2: both sides, with and without the companion ----
  let anNo = 0, anYes = 0, trNo = 0, trYes = 0
  const unmatched: string[] = []
  let matchedPairs = 0
  for (const f of files) {
    let src: string, root: any
    try { src = readFileSync(f, "utf8"); root = parser.parse(src).rootNode } catch { continue }
    const rel = path.relative(dir, f)
    const without: any = await ASTEngine.parseFile(f, src)
    const withCtx: any = await ASTEngine.parseFile(f, src, { overrideCompanion: companion } as any)
    anNo += (without.relationships ?? []).filter((r: any) => r.type === "overrides").length
    anYes += (withCtx.relationships ?? []).filter((r: any) => r.type === "overrides").length
    const syms = withCtx.symbols ?? []
    trNo += derivePhpEdges(root).filter((e: any) => e.label === "overrides").length
    const truth = derivePhpEdges(root, companion).filter((e: any) => e.label === "overrides")
    trYes += truth.length
    const anTargets = new Set((withCtx.relationships ?? []).filter((r: any) => r.type === "overrides").map((r: any) => `${r.target}`))
    for (const e of truth) {
      if (anTargets.has(e.target)) matchedPairs++
      else if (unmatched.length < 15) unmatched.push(`TRUTH-ONLY ${repo}/${rel}  ${e.from} -> ${e.target}`)
    }
    for (const t of anTargets) if (!truth.some((e: any) => e.target === t) && unmatched.length < 15) unmatched.push(`ANALYZER-ONLY ${repo}/${rel}  -> ${t}`)
    // keep the parser healthy
    try { (root as any).tree?.delete?.() } catch { /* noop */ }
  }
  console.log(`\n=== ${repo} (${files.length} tracked .php files) ===`)
  console.log(`  companion index: ${companion.size} type names`)
  console.log(`  overrides  WITHOUT the companion : analyzer ${anNo} edges, truth ${trNo} rows`)
  console.log(`  overrides  WITH    the companion : analyzer ${anYes} edges, truth ${trYes} rows`)
  console.log(`  truth rows the analyzer carries   : ${matchedPairs}/${trYes}`)
  console.log(`  disagreements                    : ${unmatched.length}${unmatched.length >= 15 ? "+" : ""}`)
  for (const u of unmatched) console.log(`    ${u}`)
}
process.exit(0)
