/**
 * THE ONE-TOKEN WIRING, VERIFIED BY RUNNING THE PASS ITSELF — with a NEGATIVE CONTROL on the spelling.
 *
 * ## What this proves, and why it is not the same as the phase-2 measurement
 *
 * Phase 2 of `overrides-first-parent-guess-audit.ts` ran the pass's ALGORITHM by hand, which measures
 * the fix's EFFECT. This instrument calls `populateOverrideCompanion` — the production function — with
 * the exact language string the one-token change adds, so it measures the WIRING: if the token were
 * spelled wrong (`"js"`, say), the pass would scope its symbols by `r.language === language`, find
 * none, and return `owners: 0` while looking completely healthy in the diff. **That is the negative
 * control, and it is the reason this file exists.**
 *
 * ## What it does
 *
 * One repo is parsed once (no context), its files assembled into the `FileResult` shape the pass
 * consumes, and the pass is then run twice over the SAME results:
 *   `language: "javascript"`  the language name the router assigns (`language-detection.ts:39`)
 *   `language: "js"`          the extension spelling — the control that must find NOTHING
 *
 * Run: npx tsx validation/m14/fixtures/javascript/companion-pass-wiring-check.ts [repo]
 * Env: BB_CORPUS_ROOT (default /home/ishaq2321/bb_tests/repositories)
 */
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { populateOverrideCompanion } from "../../../../src/ast/override-companion-pass"

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
console.log(`COMPANION PASS WIRING CHECK — repo ${REPO}, ${files.length} file(s)`)

// The pass consumes `FileResult`s: { success, language, symbols, relationships, filePath }
const results: any[] = []
let overridesBefore = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f, root) } catch { continue }
  if (!r?.success) continue
  results.push({
    success: true,
    language: "javascript", // the router's language name for every one of these extensions
    symbols: r.symbols ?? [],
    relationships: r.relationships ?? [],
    filePath: f,
  })
  overridesBefore += ((r.relationships ?? []) as any[]).filter((x) => String(x?.type ?? "").toLowerCase() === "overrides").length
}
console.log(`parsed ${results.length} file(s) · overrides edges before the pass: ${overridesBefore}`)

const reparse = async (f: string, p: string, ctx: any) => parseFile(f, p, ctx)
for (const language of ["javascript", "js"]) {
  // A FRESH copy of the results per arm: the pass MUTATES the array in place.
  const arm = results.map((r) => ({ ...r, symbols: [...r.symbols], relationships: [...r.relationships] }))
  const stats = await populateOverrideCompanion({ projectPath: root, results: arm, language, reparse })
  const after = arm.reduce((n, r) => n + ((r.relationships ?? []) as any[]).filter((x) => String(x?.type ?? "").toLowerCase() === "overrides").length, 0)
  const guesses = arm.reduce((n, r) => n + ((r.relationships ?? []) as any[]).filter((x) => (x?.metadata ?? {}).reasonCode === "first-parent-guess").length, 0)
  console.log(`\n  language: ${JSON.stringify(language)}${language === "javascript" ? "   <- THE TOKEN" : "                  <- NEGATIVE CONTROL (extension spelling)"}`)
  console.log(`    owners ${stats.owners} · files re-analyzed ${stats.refiles} · reapplied ${stats.reapplied} · confirmed ${stats.confirmed} · still a guess ${stats.stillGuess} · failed ${stats.failed}`)
  console.log(`    overrides edges after: ${after} (was ${overridesBefore}) · of them first-parent-guess: ${guesses}`)
}
console.log(`\nREADING: the "javascript" arm must report owners > 0 and a fall in first-parent-guess; the "js"`)
console.log(`arm must report owners 0 and change NOTHING — if BOTH arms moved, the language scoping is not`)
console.log(`doing the work the token assumes, and the token is not the fix.`)
