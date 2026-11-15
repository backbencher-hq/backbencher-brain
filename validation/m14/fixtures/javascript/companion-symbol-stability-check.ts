/**
 * RISK C, MEASURED: does attaching an `overrideCompanion` change which SYMBOLS a file publishes?
 *
 * ## Why this exists
 *
 * `override-companion-pass.ts:148` assigns `result.symbols = again.symbols ?? result.symbols` from the
 * re-parse, so the pass CAN move symbols — that is a live path, not a hypothetical. If the companion
 * itself changed symbol extraction, then wiring it for a new lane would move OTHER relationship types
 * as well, and a falsifier phrased "no other type moves" would fail for a legitimate reason and be
 * misread as collateral damage. r-lane raised this as the first thing to check.
 *
 * The reading says it cannot: in `real-javascript-analyzer.ts` the companion is read ONLY in
 * `extractOverrideRelationships` (forwarded at :1407, tested at :1585 and :1606), and `engine.ts`
 * carries the field in `AnalyzeContext` without ever reading it. This instrument turns the reading
 * into a measurement on the repo where the guesses actually concentrate.
 *
 * ## What it does
 *
 * Every admitted `.js/.jsx/.mjs/.cjs` file in ONE repo is parsed TWICE — once with no context, once
 * with a companion built from that same repo's symbol space (exactly as the pass builds it) — and the
 * two symbol arrays are compared field by field. Overrides edges are counted on both sides as a
 * positive control: if the companion is not changing anything, the override count must MOVE.
 *
 * Run: npx tsx validation/m14/fixtures/javascript/companion-symbol-stability-check.ts [repo]
 * Env: BB_CORPUS_ROOT (default /home/ishaq2321/bb_tests/repositories)
 */
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { buildOverrideCompanion } from "../../../../src/ast/override-context"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2] ?? "bootstrap"
const EXTS = new Set([".js", ".mjs", ".cjs", ".jsx"])
const root = path.join(CORPUS, REPO)

const files: string[] = []
const walk = (d: string, depth: number) => {
  if (depth > 20) return
  let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) { walk(p, depth + 1); continue }
    if (!EXTS.has(path.extname(e.name))) continue
    try { if (statSync(p).size > 1_000_000) continue } catch { continue }
    files.push(p)
  }
}
walk(root, 0)
files.sort()
console.log(`RISK C — does an overrideCompanion change SYMBOL publication?`)
console.log(`repo ${REPO} · ${files.length} file(s) parsed twice`)

// pass 1: no context — and this is also the symbol space the pass builds its companion from
type Sym = { name: string; kind: string; owner: string; line: number }
const first: { file: string; symbols: Sym[]; overrides: number }[] = []
const allSymbols: any[] = []
for (const f of files) {
  let r: any
  try { r = await parseFile(f, root) } catch { continue }
  const syms: Sym[] = ((r?.symbols ?? []) as any[]).map((s) => ({
    name: String(s?.name ?? ""), kind: String(s?.kind ?? ""), owner: String(s?.ownerName ?? ""),
    line: Number(s?.range?.startLine ?? s?.line_number ?? 0),
  }))
  for (const s of (r?.symbols ?? []) as any[]) allSymbols.push(s)
  const ov = ((r?.relationships ?? []) as any[]).filter((x) => String(x?.type ?? "").toLowerCase() === "overrides").length
  first.push({ file: f, symbols: syms, overrides: ov })
}
const companion = buildOverrideCompanion(allSymbols)
console.log(`companion: ${companion.size} owner(s) — built exactly as the production pass builds it`)

// pass 2: with the companion
let symbolDiffs = 0, filesWithDiff = 0
let ovBefore = 0, ovAfter = 0, checked = 0
const examples: string[] = []
for (const rec of first) {
  let r2: any
  try { r2 = await parseFile(rec.file, root, { overrideCompanion: companion } as any) } catch { continue }
  checked++
  const syms2: Sym[] = ((r2?.symbols ?? []) as any[]).map((s) => ({
    name: String(s?.name ?? ""), kind: String(s?.kind ?? ""), owner: String(s?.ownerName ?? ""),
    line: Number(s?.range?.startLine ?? s?.line_number ?? 0),
  }))
  const a = rec.symbols.map((s) => `${s.kind}|${s.owner}|${s.name}|${s.line}`).join("\n")
  const b = syms2.map((s) => `${s.kind}|${s.owner}|${s.name}|${s.line}`).join("\n")
  if (a !== b) {
    filesWithDiff++
    symbolDiffs += Math.abs(rec.symbols.length - syms2.length)
    if (examples.length < 3) examples.push(`${path.relative(root, rec.file)}: ${rec.symbols.length} -> ${syms2.length} symbol(s)`)
  }
  ovBefore += rec.overrides
  const ov2 = ((r2?.relationships ?? []) as any[]).filter((x) => String(x?.type ?? "").toLowerCase() === "overrides").length
  ovAfter += ov2
}

console.log(`\nRESULT`)
console.log(`  files checked                     ${checked}`)
console.log(`  files whose SYMBOLS differ        ${filesWithDiff}   (symbol count delta ${symbolDiffs})`)
for (const e of examples) console.log(`    ${e}`)
console.log(`  overrides edges WITHOUT companion ${ovBefore}`)
console.log(`  overrides edges WITH companion    ${ovAfter}`)
console.log(`\n  READING OF THE RESULT:`)
console.log(`  - files whose symbols differ 0  -> the companion does not touch symbol publication, so wiring it`)
console.log(`    for a new lane cannot move another relationship type through the symbol space; Risk A holds.`)
console.log(`  - overrides edges MOVING is the positive control: a check that changed nothing anywhere would`)
console.log(`    say nothing about symbol stability either.`)
console.log(`  - symbol differences ARE still possible through override-companion-pass.ts:148, which ASSIGNS`)
console.log(`    result.symbols from the re-parse; if any appear here they are attributable to the re-parse`)
console.log(`    itself and must be diffed before they are blamed on the companion.`)
