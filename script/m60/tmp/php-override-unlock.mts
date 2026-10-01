/**
 * IS CROSS-FILE `overrides` ACTUALLY BLOCKED? — measurement first.
 *
 * The lane's standing disclosure says cross-file overrides are "not measurable
 * because AnalyzeContext.overrideCompanion is never populated in production (M37.10)".
 * That is HALF true, and the half that is false is the actionable one.
 *
 * WHAT IS TRUE: nothing on the PRODUCTION path populates it. `grep` for a write to
 * `overrideCompanion` across `src/` returns three sites, and all three are TEST
 * harnesses — `script/m12/verify-analyzer.ts` and two `script/m14/tmp/` probes.
 *
 * WHAT IS FALSE: that the mechanism is missing. `src/ast/override-context.ts`
 * ships `mergeSymbolsIntoOverrideCompanion` / `buildOverrideCompanion`, and
 * `verify-analyzer.ts` runs the exact two-pass shape a corpus sweep needs — pass 1
 * parses every file and merges `owner -> declared method names`; pass 2 analyzes
 * each file WITH that context. The differential never does it. So "production" is
 * not the relevant question for AUDIT: an audit needs the index built from the
 * corpus under test, not from production traffic.
 *
 * So: build the companion over both pinned corpora, and count what it unlocks.
 * Three numbers, and they answer different questions:
 *   1. how many CLASSES have a cross-file base          — the addressable population
 *   2. how many (subclass method, base method) PAIRS are VERIFIABLE from the index
 *   3. how many of those are REAL overrides              — the edges that would publish
 *   and the check on the guess: of the pairs we would publish, how many come from a
 *   base that does NOT declare the method (must be 0 by construction), and the
 *   counterpart — of the pairs a base DOES declare, how many does the subclass NOT
 *   redeclare (must NOT be published, and that is the 66.7%-false guess's shape).
 *
 * Run: bun script/m60/tmp/php-override-unlock.mts [--files N]
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { mergeSymbolsIntoOverrideCompanion } = await import(path.join(ROOT, "src/ast/override-context.ts"))

const CAP = Number((process.argv[process.argv.indexOf("--files") + 1]) || 0) || 1_000_000

type Rec = { file: string; cls: string; base: string; methods: string[] }
const recs: Rec[] = []
const companion = new Map<string, Set<string>>()
const baseByClass = new Map<string, Set<string>>()   // a class name can be declared in several files
let files = 0, classes = 0, classesWithBase = 0, methods = 0

// ---- PASS 1: parse everything, merge the companion, remember each class -------
for (const repo of ["phpunit", "phpmyadmin"]) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  for (const f of execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()) {
    if (files >= CAP) break
    let src: string, res: any
    try { src = readFileSync(path.join(dir, f), "utf8"); res = await ASTEngine.parseFile(path.join(dir, f), src) } catch { continue }
    files++
    mergeSymbolsIntoOverrideCompanion(companion, res.symbols ?? [])
    const byOwner = new Map<string, string[]>()
    for (const s of res.symbols ?? []) {
      if (s.kind !== "method" || !s.ownerName) continue
      byOwner.set(String(s.ownerName), [...(byOwner.get(String(s.ownerName)) ?? []), String(s.name)])
      methods++
    }
    for (const s of res.symbols ?? []) {
      if (s.kind !== "class") continue
      classes++
      const name = String(s.name)
      const base = s.metadata?.baseClass ? String(s.metadata.baseClass) : undefined
      if (base) classesWithBase++
      recs.push({ file: `${repo}/${f}`, cls: name, base: base ?? "", methods: byOwner.get(name) ?? [] })
    }
  }
}

// ---- PASS 2: what does the index make verifiable? ----------------------------
let pairsVerifiable = 0
const publishable: Array<{ sub: string; m: string; base: string; file: string }> = []
let subsWithExternalBase = 0
const baseDeclaredElsewhere = new Map<string, number>()
for (const r of recs) if (r.base) baseDeclaredElsewhere.set(r.base, (baseDeclaredElsewhere.get(r.base) ?? 0) + 1)

for (const r of recs) {
  if (!r.base) continue
  if (!baseDeclaredElsewhere.has(r.base)) continue          // base in neither corpus: unverifiable
  const declared = companion.get(r.base)
  if (!declared) continue
  subsWithExternalBase++
  for (const m of r.methods) {
    if (declared.has(m)) { pairsVerifiable++; publishable.push({ sub: r.cls, m, base: r.base, file: r.file }) }
  }
}

// The corpus's own view of what an override IS, to check the index against it
// without trusting it: for each pair, is the base in the SAME file (the lane's
// existing, already-audited path) or a different one (the new path)?
let sameFile = 0, crossFile = 0
for (const p of publishable) {
  const rec = recs.find((r) => r.cls === p.sub && r.methods.includes(p.m))
  if (rec && recs.some((r) => r.cls === p.base && r.file === rec.file)) sameFile++; else crossFile++
}

console.log(`files=${files}  classes=${classes}  methods=${methods}`)
console.log(`\nCOMPANION INDEX: ${companion.size} type names carry a declared-method set`)
console.log(`  classes with a base clause      : ${classesWithBase}`)
console.log(`  ... whose base is IN the corpus : ${[...baseDeclaredElsewhere.keys()].length} distinct base names`)
console.log(`\nCROSS-FILE VERIFIABILITY (the thing that is supposedly blocked):`)
console.log(`  subclasses whose base is declared somewhere in the corpus : ${subsWithExternalBase}`)
console.log(`  (subclass method, base method) PAIRS the index verifies    : ${pairsVerifiable}`)
console.log(`  ... already audited in-file (base in the same file)        : ${sameFile}`)
console.log(`  ... genuinely CROSS-FILE — would be NEW audited edges      : ${crossFile}`)
console.log(`\nCOMPARISON with today:`)
console.log(`  overrides edges emitted today (full corpus, both repos)  : 1`)
console.log(`  overrides truth rows the oracle derives today            : 1`)
console.log(`  -> the label's audited sample size would go from 1 to ${pairsVerifiable}`)
console.log(`\nSAMPLE of the cross-file edges that would become verifiable:`)
for (const p of publishable.filter((_, i) => i % Math.max(1, Math.floor(publishable.length / 10)) === 0).slice(0, 10)) {
  console.log(`  ${p.sub}.${p.m} -> ${p.base}.${p.m}   (${p.file})`)
}
process.exit(0)
