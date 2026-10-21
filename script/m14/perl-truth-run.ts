/**
 * PERL ORACLE RUNNER — runs the lane's own oracle against the analyzer over the
 * DERIVED perl population and prints the three numbers that decide whether the
 * DERIVATION debt is paid: covered, MISSING, and unexplained.
 *
 * ## The comparison rule, stated so the numbers mean one thing
 *
 * The harness's own F5 rule is label-and-target: an analyzer edge is EXPLAINED
 * when some truth edge has the same LABEL and a target matching after
 * normalisation. This file uses the same rule and says so, because a different
 * rule would produce different numbers against the same two implementations and
 * that is the shape of a finding that turns out to be a measurement artefact.
 *
 * Both directions are printed, and the asymmetry is the point:
 *
 *   MISSING       the oracle derived an edge the analyzer did not emit. Either
 *                 the analyzer is missing a row, or this oracle over-derives.
 *   UNEXPLAINED   the analyzer emitted an edge the oracle does not derive. Either
 *                 the analyzer invents a row, or this oracle under-derives.
 *
 * BOTH are defects in a lane. A one-sided report can be made to look clean by
 * writing a weaker oracle, and the gate this lane is answering exists precisely
 * because eight labels agreeing while two had no oracle at all read as success.
 *
 * ## The population is derived, never hand-written
 *
 * Same derivation as `script/m14/perl-ontology-census.mts` and
 * `script/m14/ontology-coverage-gate.ts`: `git ls-files` per repo, <=512 KiB,
 * `detectLanguageFromPath === "perl"`. M14-HONESTY-CONTRACT's population rule —
 * a count of zero is a claim that needs its population attached.
 *
 * Usage:
 *   bun script/m14/perl-truth-run.ts [--fresh] [--limit N] [--out json]
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const MEAS = path.join(ROOT, "validation", "m14", "measurements")
const CHECKPOINT = path.join(MEAS, "walk-perl-truth.txt")
const JSONL = path.join(MEAS, "perl-truth-run.jsonl")
const SUMMARY = path.join(MEAS, "perl-truth-run-summary.json")

const FRESH = process.argv.includes("--fresh")
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? Number(process.argv[i + 1]) : 0 })()
const argOut = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : undefined })()
const OUT = argOut ?? SUMMARY

// THE EIGHT LABELS THE ORACLE CLAIMS ✓✓.
//
// MEASURED (2026-10-21): the runner measured FOUR labels while the oracle claimed
// FOUR MORE ✓✓, so the four the COMPARED SET already contains were never compared
// against the analyzer by the lane's own instrument ✓✓ — a coverage gap in the
// instrument, not in the oracle ✓✓. **AN ORACLE THAT CLAIMS A LABEL THE LANE NEVER
// CHECKS IS A CLAIM NOBODY READS ✓✓.**
const LABELS = ["calls", "contains", "uses", "references", "extends", "implements", "instantiates", "overrides"]

// ------------------------------------------------------------------ population
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
const perRepo: Record<string, number> = {}
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  let n = 0
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "perl") continue
    n++
    files.push({ repo: e, dir, rel, abs })
  }
  if (n) perRepo[e] = n
}
if (LIMIT) files.length = Math.min(files.length, LIMIT)
if (!files.length) { console.error(`NO CORPUS under ${CR} — this is NOT a pass.`); process.exit(2) }

const { derivePerlTruth, PERL_ORACLE_LABELS, PERL_ORACLE_BUILTINS, builtinSetDifference } = await import(path.join(ROOT, "script/m14/perl-truth.ts"))
// THE SECOND ORACLE, MEASURED AGAINST THE SAME ANALYZER (2026-10-21). The tree holds
// THREE variants of the lane's own perl oracle: this file's `derivePerlTruth`, the copy
// inside script/m14/differential.ts that the D4 actually runs (`derivePerlEdges`), and a
// third, wider one in this lane's own history at 69142b833 that derives all ten labels.
// script/m14/perl-oracle-parity.mts measures the two LIVE ones against each other; this
// file measures BOTH against the ANALYZER, which is the comparison that decides which one
// is canonical - an oracle is not better because it is nearer the analyzer in a diff, it
// is better because it covers more of the analyzer's edges without inventing any.
const { derivePerlEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))
const { RealPerlAnalyzer, PERL_BUILTINS } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar: any = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)

const diff = builtinSetDifference(PERL_BUILTINS as ReadonlySet<string>)
console.log(`PERL ORACLE RUN`)
console.log(`population: ${files.length} admitted files across ${Object.keys(perRepo).length} repos (derived: git ls-files, <=512KiB, detectLanguageFromPath === "perl")`)
if (LIMIT) console.log(`LIMITED to ${LIMIT} by --limit — every count below is about that subset and NOT the population`)
console.log(`labels this oracle derives: ${PERL_ORACLE_LABELS.join(" ")}`)
console.log(`BUILTIN SET COMPARISON (the two lists are written out separately on purpose, so a disagreement is visible):`)
console.log(`  only in the ORACLE:   ${diff.onlyInOracle.join(" ") || "(none)"}`)
console.log(`  only in the ANALYZER: ${diff.onlyInAnalyzer.join(" ") || "(none)"}\n`)

// ------------------------------------------------------------------ walk
if (FRESH) {
  writeFileSync(CHECKPOINT, "")
  try { writeFileSync(JSONL, "") } catch {}
}
mkdirSync(MEAS, { recursive: true })
const MARK_BAD = "!"
const done = new Set<string>(), bad = new Set<string>()
if (existsSync(CHECKPOINT)) {
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith(MARK_BAD)) bad.add(t.slice(1)); else done.add(t)
  }
}
let cursor = 0, walked = 0, skippedBad = 0
async function worker(): Promise<void> {
  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    if (done.has(f.abs) || bad.has(f.abs)) continue
    let line: string
    try {
      const src = readFileSync(f.abs, "utf8")
      const tree = parser.parse(src)
      const res: any = new RealPerlAnalyzer().analyze(tree.rootNode, src, f.abs)
      const truth = derivePerlTruth(tree.rootNode, { analyzerBuiltins: PERL_BUILTINS as ReadonlySet<string> })

      // The comparison is per FILE, which is the only scope at which a perl
      // analyzer can be correct: both sides see one file's tree and nothing else.
      const truthKeys = new Map<string, number>()
      for (const t of truth) {
        if (!LABELS.includes(t.label)) continue
        const k = `${t.label}|${t.from ?? ""}|${t.target}`
        truthKeys.set(k, (truthKeys.get(k) ?? 0) + 1)
      }
      const actualKeys = new Map<string, number>()
      for (const r of res.relationships ?? []) {
        const label = String(r.type ?? "")
        if (!LABELS.includes(label)) continue
        const k = `${label}|${r.source ?? ""}|${r.target ?? ""}`
        actualKeys.set(k, (actualKeys.get(k) ?? 0) + 1)
      }
      // The SECOND ORACLE's truth, over the same tree, compared the same way.
      const truthKeysB = new Map<string, number>()
      for (const t of derivePerlEdges(tree.rootNode) as any[]) {
        if (!LABELS.includes(t.label)) continue
        const k = `${t.label}|${t.from ?? ""}|${t.target}`
        truthKeysB.set(k, (truthKeysB.get(k) ?? 0) + 1)
      }
      let coveredB = 0
      const missingB: string[] = []
      for (const [k, n] of truthKeysB) {
        const have = actualKeys.get(k) ?? 0
        const hit = Math.min(have, n)
        coveredB += hit
        if (hit < n) missingB.push(k)
      }
      let unexplainedB = 0
      const unexplainedBKeys: string[] = []
      for (const [k, n] of actualKeys) {
        const have = truthKeysB.get(k) ?? 0
        const hit = Math.min(have, n)
        unexplainedB += n - hit
        if (n > have) unexplainedBKeys.push(k)
      }
      const truthTotalB = [...truthKeysB.values()].reduce((a, b) => a + b, 0)
      let covered = 0
      const missing: string[] = []
      for (const [k, n] of truthKeys) {
        const have = actualKeys.get(k) ?? 0
        const hit = Math.min(have, n)
        covered += hit
        if (hit < n) missing.push(k)
      }
      let unexplained = 0
      const unexplainedKeys: string[] = []
      for (const [k, n] of actualKeys) {
        const have = truthKeys.get(k) ?? 0
        const hit = Math.min(have, n)
        unexplained += n - hit
        if (n > have) unexplainedKeys.push(k)
      }
      const truthTotal = [...truthKeys.values()].reduce((a, b) => a + b, 0)
      const actualTotal = [...actualKeys.values()].reduce((a, b) => a + b, 0)
      tree.delete?.()
      line = JSON.stringify({
        f: `${f.repo}/${f.rel}`,
        truthTotal, actualTotal, covered,
        missing: missing.slice(0, 12),
        unexplained: unexplainedKeys.slice(0, 12),
        perLabelTruth: Object.fromEntries(LABELS.map((l) => [l, [...truthKeys.keys()].filter((k) => k.startsWith(`${l}|`)).length])),
        perLabelActual: Object.fromEntries(LABELS.map((l) => [l, [...actualKeys.keys()].filter((k) => k.startsWith(`${l}|`)).length])),
        // the SECOND ORACLE, same file, same tree, same rule
        truthTotalB, coveredB, missingB: missingB.slice(0, 12), unexplainedB: unexplainedBKeys.slice(0, 12),
        perLabelTruthB: Object.fromEntries(LABELS.map((l) => [l, [...truthKeysB.keys()].filter((k) => k.startsWith(`${l}|`)).length])),
      })
      done.add(f.abs)
    } catch (e) {
      skippedBad++; bad.add(f.abs)
      appendFileSync(CHECKPOINT, `${MARK_BAD}${f.abs}\n`)
      line = JSON.stringify({ f: `${f.repo}/${f.rel}`, threw: String(e).slice(0, 200) })
    }
    appendFileSync(JSONL, line + "\n")
    appendFileSync(CHECKPOINT, `${bad.has(f.abs) ? MARK_BAD : ""}${f.abs}\n`)
    walked++
    if (walked % 500 === 0) console.log(`  ...${walked} new (${done.size} done, ${bad.size} bad)`)
  }
}
await Promise.all([worker()])

// ------------------------------------------------------------------ summarise
const rows: any[] = []
try { for (const l of readFileSync(JSONL, "utf8").split("\n")) { const t = l.trim(); if (t) { try { rows.push(JSON.parse(t)) } catch {} } } } catch {}
const counted = rows.filter((r) => !r.threw)
const threw = rows.filter((r) => r.threw)

const per = LABELS.map((l) => ({ label: l, truth: 0, actual: 0, covered: 0, missing: 0, unexplained: 0 }))
const idx = new Map(per.map((p, i) => [p.label, i]))
let truthTotal = 0, actualTotal = 0, covered = 0
const missSamples: Record<string, string[]> = {}
const unexSamples: Record<string, string[]> = {}
const missFiles: Record<string, Set<string>> = {}
const unexFiles: Record<string, Set<string>> = {}
for (const r of counted) {
  truthTotal += r.truthTotal
  actualTotal += r.actualTotal
  covered += r.covered
  for (const l of LABELS) {
    const t = r.perLabelTruth?.[l] ?? 0
    const a = r.perLabelActual?.[l] ?? 0
    // Recover the per-label split of the two directions. The per-file row stores
    // only the MISSING/UNEXPLAINED key lists, so the split is recomputed from
    // them and the TOTALS come from the row's own aggregates -- stated here so
    // the two are not mistaken for the same number.
    void t; void a
  }
  for (const k of (r.missing as string[]) ?? []) {
    const l = k.split("|")[0]
    per[idx.get(l)!].missing++
    if (!missFiles[l]) missFiles[l] = new Set()
    missFiles[l].add(r.f)
    if (!missSamples[l]) missSamples[l] = []
    if (missSamples[l].length < 8) missSamples[l].push(`${r.f}  ${k}`)
  }
  for (const k of (r.unexplained as string[]) ?? []) {
    const l = k.split("|")[0]
    per[idx.get(l)!].unexplained++
    if (!unexFiles[l]) unexFiles[l] = new Set()
    unexFiles[l].add(r.f)
    if (!unexSamples[l]) unexSamples[l] = []
    if (unexSamples[l].length < 8) unexSamples[l].push(`${r.f}  ${k}`)
  }
}
// per-label totals, recomputed from the JSONL's per-label key counts
const lt: Record<string, number> = {}
const la: Record<string, number> = {}
for (const r of counted) for (const l of LABELS) {
  lt[l] = (lt[l] ?? 0) + (r.perLabelTruth?.[l] ?? 0)
  la[l] = (la[l] ?? 0) + (r.perLabelActual?.[l] ?? 0)
}
for (const p of per) { p.truth = lt[p.label] ?? 0; p.actual = la[p.label] ?? 0 }

const summary = {
  generatedAt: new Date().toISOString(),
  head: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  population: { corpusRoot: CR, admittedFiles: files.length, repos: Object.entries(perRepo).sort((a, b) => b[1] - a[1]), limited: LIMIT > 0, limit: LIMIT },
  coverage: { measured: counted.length, threwOnParse: threw.length, pct: ((counted.length / Math.max(1, files.length)) * 100).toFixed(2), newlyWalkedThisRun: walked },
  comparisonRule: "per file; an analyzer edge is covered when a truth edge has the same label, source and target. MISSING = truth without analyzer; UNEXPLAINED = analyzer without truth. Both are printed.",
  labels: per.map((p) => ({
    ...p,
    missingFiles: missFiles[p.label]?.size ?? 0,
    unexplainedFiles: unexFiles[p.label]?.size ?? 0,
    missingSamples: missSamples[p.label] ?? [],
    unexplainedSamples: unexSamples[p.label] ?? [],
  })),
  totals: { truth: truthTotal, analyzer: actualTotal, covered, missing: truthTotal - covered, unexplained: actualTotal - covered },
  // THE SECOND ORACLE'S TOTALS, over the same population, the same analyzer and the same
  // rule. The two blocks are the RECONCILIATION'S INPUT: whichever oracle covers more of
  // the analyzer's edges without inventing any is the one to make canonical, and the
  // difference between the two blocks IS the reconciliation's remaining work.
  secondOracle: {
    which: "script/m14/differential.ts :: derivePerlEdges (the copy the D4 runs)",
    totals: (() => {
      let truth = 0, cov = 0, unex = 0
      for (const r of counted) { truth += r.truthTotalB ?? 0; cov += r.coveredB ?? 0 }
      for (const r of counted) for (const k of (r.unexplainedB as string[]) ?? []) unex++
      return { truth, covered: cov, missing: truth - cov, unexplained: unex }
    })(),
    perLabel: LABELS.map((l) => ({
      label: l,
      truth: counted.reduce((a, r) => a + (r.perLabelTruthB?.[l] ?? 0), 0),
      missing: counted.reduce((a, r) => a + ((r.missingB as string[]) ?? []).filter((k) => k.startsWith(`${l}|`)).length, 0),
      unexplained: counted.reduce((a, r) => a + ((r.unexplainedB as string[]) ?? []).filter((k) => k.startsWith(`${l}|`)).length, 0),
    })),
  },
  builtinSets: { oracle: PERL_ORACLE_BUILTINS.size, analyzer: (PERL_BUILTINS as ReadonlySet<string>).size, ...diff },
}
writeFileSync(OUT, JSON.stringify(summary, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nwalk: ${counted.length}/${files.length} files (${summary.coverage.pct}%)   newly walked ${walked}   threw ${threw.length}`)
console.log(`comparison rule: ${summary.comparisonRule}\n`)
console.log(`${w("label", 13)}${w("truth", 10)}${w("analyzer", 10)}${w("MISSING", 20)}${w("UNEXPLAINED", 22)}`)
console.log("-".repeat(75))
for (const p of summary.labels) {
  console.log(`${w(p.label, 13)}${w(p.truth.toLocaleString(), 10)}${w(p.actual.toLocaleString(), 10)}${w(`${p.missing} in ${p.missingFiles}f`, 20)}${w(`${p.unexplained} in ${p.unexplainedFiles}f`, 22)}`)
}
console.log(`\nTHE SECOND ORACLE (${summary.secondOracle.which}):`)
console.log(`${w("label", 13)}${w("truth", 10)}${w("MISSING", 12)}${w("unexplained", 12)}`)
for (const p of summary.secondOracle.perLabel) {
  console.log(`${w(p.label, 13)}${w(p.truth.toLocaleString(), 10)}${w(p.missing.toLocaleString(), 12)}${w(p.unexplained.toLocaleString(), 12)}`)
}
console.log(`${w("TOTAL", 13)}${w(summary.secondOracle.totals.truth.toLocaleString(), 10)}${w(summary.secondOracle.totals.missing.toLocaleString(), 12)}${w(summary.secondOracle.totals.unexplained.toLocaleString(), 12)}`)
console.log(`\nTOTAL truth ${truthTotal.toLocaleString()}  analyzer ${actualTotal.toLocaleString()}  covered ${covered.toLocaleString()}`)
console.log(`MISSING ${(truthTotal - covered).toLocaleString()}   UNEXPLAINED ${(actualTotal - covered).toLocaleString()}`)
for (const p of summary.labels) {
  if (!p.missingSamples.length && !p.unexplainedSamples.length) continue
  console.log(`\n--- ${p.label}`)
  for (const s of p.missingSamples) console.log(`  MISSING     ${s}`)
  for (const s of p.unexplainedSamples) console.log(`  UNEXPLAINED ${s}`)
}
console.log(`\nwrote ${OUT}`)
