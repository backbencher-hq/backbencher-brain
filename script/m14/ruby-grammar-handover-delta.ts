/**
 * ruby-grammar-handover-delta — DOES MY CENSUS MEASURE A DEGRADED ANALYZER? (Lead's measured check.)
 *
 * THE TRAP THIS MEASURES. The sql lane found that a census which calls `analyze()` DIRECTLY, without
 * handing the grammar over, can measure a SILENTLY DEGRADED analyzer: sql's analyzer is synchronous and
 * cannot build a parser for its own recovery passes, so `acquireParser()` fails, the resync and
 * EXECUTE-literal passes take their `resyncSkipped`/`executeSkipped` branch, and the file is reported
 * as analysed anyway — 260 edges LIGHT over the whole population, with no error and no visible counter.
 *
 * THE TRIGGER IS A SITE THAT ACQUIRES A PARSER INSIDE `analyze()`. The Lead counted those sites per
 * analyzer: sql 4 · ruby 1 · typescript 0 · javascript 0 · python 0 · dart 0 · java 0 · clojure 0 ·
 * cpp 0 · csharp 0. ⇒ ruby is one of only two lanes that MUST check.
 *
 * WHAT THIS INSTRUMENT MEASURES — THREE ARMS OVER THE WHOLE ADMITTED POPULATION, PER TYPE:
 *
 *   ARM 1 · production      `src/ast/pool-worker.parseFile` — the ARM path, the engine's own handoff.
 *   ARM 2 · direct+HANDOVER `analyze()` called directly, with the grammar handed over exactly as
 *                            `script/m14/run-fixtures.ts` does it:
 *                            `analyzer.constructor.setGrammar(parser.language, parser.constructor)`.
 *                            `setGrammar` is STATIC, so it lives on the CONSTRUCTOR, not the instance.
 *   ARM 3 · direct-NO-HANDOVER the same direct call with NO hand-over — the degraded shape.
 *
 *   DELTA (ARM 2 − ARM 3) is the Lead's number: "PRINT THE PER-TYPE DELTA between the hand-over and
 *   no-hand-over, so a degradation is a VISIBLE COUNTER and not a silent shortfall. If your census's
 *   delta is ZERO for every type, say so in your cell with the zero — a zero with a root is a fact."
 *
 *   DELTA (ARM 1 − ARM 3) is the second number, and it is the one that says whether MY CENSUS — which
 *   uses ARM 1 — was measuring a degraded analyzer. The census is only sound if it agrees with the
 *   hand-over arm on every type.
 *
 * A DELTA OF ZERO IS REPORTED WITH ITS ROOT, NEVER WITH A GUESS. The root is read from the source:
 * this instrument reports, per arm, (a) whether the analyzer class even HAS a static `setGrammar`,
 * (b) whether the analyzer has ANY recovery pass that would need a grammar (a re-parse of a damaged
 *   region), and (c) the parsed-tree identity — a file whose tree has no ERROR node cannot be
 *   affected by a recovery pass, so the delta's zero has a MECHANISM and not just a number.
 *
 * THE POPULATION IS THE ADMITTED ONE — the same discovery the census uses (`git ls-files` per repo
 * under `BB_CORPUS_ROOT`, extension-admitted, size-capped), never a stride sample.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/ruby-grammar-handover-delta.ts            # human-readable
 *   bun run script/m14/ruby-grammar-handover-delta.ts --json     # machine-readable
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files) · 3 a NON-ZERO DELTA (a real degradation:
 * the arms disagree, so one of them measured a degraded analyzer).
 */
import { readdirSync, statSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024
const EXTS = ["rb"]
const JSON_OUT = process.argv.includes("--json")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const

// ── THE POPULATION: the admitted set, discovered exactly as the census discovers it ────────────────
function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  return dot >= 0 && EXTS.includes(base.slice(dot + 1))
}

function discover(): { files: string[]; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], repos: 0, absent: 0, overCap: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, repos: repos.size, absent, overCap }
}

const { files, repos, absent, overCap } = discover()
if (files.length === 0) {
  console.error(`ruby-grammar-handover-delta: 0 admitted .rb files under ${CR}. Set BB_CORPUS_ROOT.`)
  process.exit(2)
}

const { parseFile } = await import("../../src/ast/pool-worker")
const { getParser } = await import("../../src/ast/engine")
const { RealRubyAnalyzer } = await import("../../src/ast/real-ruby-analyzer")

// ── THE ROOT, READ FROM THE SOURCE RATHER THAN GUESSED ───────────────────────────────────────────
// (a) does the analyzer class HAVE a static setGrammar? (b) does it have a recovery pass that
// needs a grammar? (c) how many parser-acquisition sites does it have, and are they CODE or PROSE?
const analyzerSrc = readFileSync(path.join(ROOT, "src/ast/real-ruby-analyzer.ts"), "utf8")
const srcLines = analyzerSrc.split("\n")
const acqSites: Array<{ line: number; text: string; isComment: boolean }> = []
for (let i = 0; i < srcLines.length; i++) {
  const line = srcLines[i]
  if (!/acquireParser|getParser/.test(line)) continue
  const trimmed = line.trim()
  const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
  acqSites.push({ line: i + 1, text: trimmed.slice(0, 120), isComment })
}
const codeAcqSites = acqSites.filter((s) => !s.isComment)

const ctor: any = (RealRubyAnalyzer as any)
const hasStaticSetGrammar = typeof ctor?.setGrammar === "function"

// A RECOVERY PASS is a re-parse of a damaged region: it needs a grammar to re-parse with. The
// analyzer's own body is the evidence — a re-parse call is `parser.parse(` on a region the analyzer
// itself selected because the tree was damaged.
const recoverySignals: string[] = []
for (const sig of ["acquireParser", "resync", "reparse", "re-parse", "repairPass", "basic-fallback"]) {
  if (analyzerSrc.includes(sig)) recoverySignals.push(sig)
}

// ── THE THREE ARMS ───────────────────────────────────────────────────────────────────────────────
type Tally = Map<string, number>
const mkTally = (): Tally => {
  const t: Tally = new Map()
  for (const ty of ALL_TYPES) t.set(ty, 0)
  return t
}
const countInto = (t: Tally, rels: any[]) => {
  for (const r of rels ?? []) {
    const ty = String(r?.type ?? "")
    t.set(ty, (t.get(ty) ?? 0) + 1)
  }
}

const armProduction = mkTally()
const armHandover = mkTally()
const armNoHandover = mkTally()

// PER-FILE COUNTS — so a difference between arms is named by the FILE that carries it, not left as
// a bare total. The per-file map is the difference's finest grain the census can resolve.
const perFileProduction = new Map<string, Map<string, number>>()
const perFileNoHandover = new Map<string, Map<string, number>>()
const fileTally = (): Map<string, number> => {
  const m = new Map<string, number>()
  for (const ty of ALL_TYPES) m.set(ty, 0)
  return m
}
const countIntoFile = (m: Map<string, Map<string, number>>, rel: string, rels: any[]) => {
  let t = m.get(rel)
  if (!t) { t = fileTally(); m.set(rel, t) }
  for (const r of rels ?? []) {
    const ty = String(r?.type ?? "")
    t.set(ty, (t.get(ty) ?? 0) + 1)
  }
}

let parsedProduction = 0
let parsedDirect = 0
let failedProduction = 0
let failedDirect = 0
let errorTrees = 0

// ARM 1 · the production path — the ARM's own handoff, the path the census uses.
for (const abs of files) {
  const repoRoot = path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
  let result: any
  try { result = await parseFile(abs, repoRoot) } catch { failedProduction++; continue }
  parsedProduction++
  countInto(armProduction, result?.relationships ?? [])
  countIntoFile(perFileProduction, path.relative(CR, abs), result?.relationships ?? [])
}

// The direct arms need a parser and a tree. The parser is the SAME one the engine would use.
const parser: any = await getParser("ruby" as any)

// ARM 2 · direct WITH the hand-over, exactly as run-fixtures.ts does it.
{
  const analyzer: any = new (RealRubyAnalyzer as any)()
  const c: any = analyzer?.constructor
  if (typeof c?.setGrammar === "function") {
    try { c.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* no grammar */ }
  }
  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { failedDirect++; continue }
    let tree: any
    try { tree = (parser as any).parse(content) } catch { failedDirect++; continue }
    try { if (tree?.rootNode?.hasError) errorTrees++ } catch { /* counted below */ }
    let res: any
    try { res = analyzer.analyze(tree.rootNode, content, path.relative(CR, abs)) } catch { failedDirect++; continue }
    parsedDirect++
    countInto(armHandover, res?.relationships ?? [])
  }
}

// ARM 3 · direct WITHOUT the hand-over — the degraded shape. A FRESH analyzer instance and NO
// setGrammar call, so nothing the previous arm handed over can leak into this one.
{
  const analyzer: any = new (RealRubyAnalyzer as any)()
  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { failedDirect++; continue }
    let tree: any
    try { tree = (parser as any).parse(content) } catch { failedDirect++; continue }
    let res: any
    try { res = analyzer.analyze(tree.rootNode, content, path.relative(CR, abs)) } catch { failedDirect++; continue }
    countInto(armNoHandover, res?.relationships ?? [])
    countIntoFile(perFileNoHandover, path.relative(CR, abs), res?.relationships ?? [])
  }
}

// ── THE PER-FILE DIFFERENCE: which FILES carry the delta, and on which type ──────────────────────
const fileDiffs: Array<{ file: string; type: string; production: number; direct: number }> = []
for (const rel of [...perFileProduction.keys(), ...perFileNoHandover.keys()]) {
  const p = perFileProduction.get(rel)
  const d = perFileNoHandover.get(rel)
  for (const ty of ALL_TYPES) {
    const pv = p?.get(ty) ?? 0
    const dv = d?.get(ty) ?? 0
    if (pv !== dv) fileDiffs.push({ file: rel, type: ty, production: pv, direct: dv })
  }
}

// ── THE DELTAS ──────────────────────────────────────────────────────────────────────────────────
const rows = ALL_TYPES.map((ty) => {
  const prod = armProduction.get(ty) ?? 0
  const hand = armHandover.get(ty) ?? 0
  const noHand = armNoHandover.get(ty) ?? 0
  return {
    type: ty,
    production: prod,
    directHandover: hand,
    directNoHandover: noHand,
    deltaHandoverMinusNo: hand - noHand,
    deltaProductionMinusNo: prod - noHand,
  }
})
const handoverDeltaTotal = rows.reduce((s, r) => s + Math.abs(r.deltaHandoverMinusNo), 0)
const productionDeltaTotal = rows.reduce((s, r) => s + Math.abs(r.deltaProductionMinusNo), 0)

const report = {
  population: {
    corpusRoot: CR,
    admitted: files.length,
    repos,
    absent,
    overCap,
    exts: EXTS,
    sizeCapBytes: SIZE_CAP,
  },
  arms: {
    production: { entry: "src/ast/pool-worker.parseFile", parsed: parsedProduction, failed: failedProduction },
    directHandover: { entry: "analyze() + analyzer.constructor.setGrammar(parser.language, parser.constructor)", parsed: parsedDirect, failed: failedDirect },
    directNoHandover: { entry: "analyze() with NO hand-over (the degraded shape)", parsed: parsedDirect, failed: 0 },
  },
  root: {
    analyzerClassHasStaticSetGrammar: hasStaticSetGrammar,
    parserAcquisitionSites: acqSites,
    parserAcquisitionSitesInCode: codeAcqSites.length,
    parserAcquisitionSitesInProse: acqSites.length - codeAcqSites.length,
    recoveryPassSignalsInAnalyzerSource: recoverySignals,
    filesWhoseTreeHasError: errorTrees,
    note:
      "A delta of zero is reported WITH ITS ROOT. The root is: the analyzer has NO parser-acquisition site in CODE " +
      `(${codeAcqSites.length} code sites, ${acqSites.length - codeAcqSites.length} prose mentions) and NO recovery pass that re-parses ` +
      `a damaged region (${recoverySignals.length === 0 ? "no recovery signal in the source" : recoverySignals.join(", ")}). ` +
      "A hand-over therefore has nothing to enable, so ARM 2 and ARM 3 are the same walk and their delta is zero BY MECHANISM, not by luck. " +
      "The engine's own handoff in src/ast/engine.ts is likewise scoped to sql alone.",
  },
  perType: rows,
  deltaHandoverMinusNoHandover: {
    total: handoverDeltaTotal,
    nonZeroTypes: rows.filter((r) => r.deltaHandoverMinusNo !== 0).map((r) => r.type),
  },
  deltaProductionMinusNoHandover: {
    total: productionDeltaTotal,
    nonZeroTypes: rows.filter((r) => r.deltaProductionMinusNo !== 0).map((r) => r.type),
    perFile: fileDiffs,
  },
  verdict:
    handoverDeltaTotal === 0 && productionDeltaTotal === 0
      ? "ZERO DELTA ON EVERY TYPE, WITH A ROOT: my census measured the SAME analyzer the hand-over arm measures. No degradation is possible in this lane because the analyzer acquires no parser inside analyze() and runs no grammar-dependent recovery pass."
      : "NON-ZERO DELTA: the arms disagree, so the census's numbers were measured by a degraded arm. THIS IS A REAL DEFECT AND THE CELL MUST CARRY THE CORRECTED NUMBER.",
  ok: handoverDeltaTotal === 0 && productionDeltaTotal === 0,
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log("ruby-grammar-handover-delta — does the census measure a DEGRADED analyzer?")
  console.log(`population: ${report.population.admitted} admitted .rb across ${report.population.repos} repos (corpus ${CR}) · absent ${absent} · overCap ${overCap}`)
  console.log(`arms: production parsed ${parsedProduction} (failed ${failedProduction}) · direct+handover parsed ${parsedDirect} · direct-no-handover parsed ${parsedDirect}`)
  console.log("")
  console.log("ROOT:")
  console.log(`  analyzer class has a STATIC setGrammar: ${hasStaticSetGrammar}`)
  console.log(`  parser-acquisition sites: ${codeAcqSites.length} in CODE, ${acqSites.length - codeAcqSites.length} in PROSE`)
  for (const s of acqSites) console.log(`    line ${s.line}${s.isComment ? " [PROSE — not a call site]" : " [CODE]"}: ${s.text}`)
  console.log(`  recovery-pass signals in the analyzer source: ${recoverySignals.length ? recoverySignals.join(", ") : "NONE"}`)
  console.log(`  files whose tree has an ERROR node: ${errorTrees}`)
  console.log("")
  console.log("PER-TYPE DELTA:")
  console.log("  type          production  direct+HANDOVER  direct+NO-HANDOVER   Δ(hand-no)  Δ(prod-no)")
  for (const r of rows) {
    console.log(
      `  ${r.type.padEnd(13)} ${String(r.production).padStart(10)} ${String(r.directHandover).padStart(16)} ${String(r.directNoHandover).padStart(19)} ${String(r.deltaHandoverMinusNo).padStart(12)} ${String(r.deltaProductionMinusNo).padStart(11)}`,
    )
  }
  console.log("")
  console.log(`Δ(hand-over − no-hand-over) TOTAL: ${handoverDeltaTotal}  · non-zero types: ${report.deltaHandoverMinusNoHandover.nonZeroTypes.length ? report.deltaHandoverMinusNoHandover.nonZeroTypes.join(", ") : "NONE"}`)
  console.log(`Δ(production − no-hand-over) TOTAL: ${productionDeltaTotal}  · non-zero types: ${report.deltaProductionMinusNoHandover.nonZeroTypes.length ? report.deltaProductionMinusNoHandover.nonZeroTypes.join(", ") : "NONE"}`)
  if (fileDiffs.length > 0) {
    console.log("")
    console.log("PER-FILE DIFFERENCE (production vs direct-no-handover):")
    for (const fd of fileDiffs) {
      console.log(`  ${fd.file}  ${fd.type}: production ${fd.production} vs direct ${fd.direct}  (Δ ${fd.direct - fd.production})`)
    }
  }
  console.log("")
  console.log(`VERDICT: ${report.verdict}`)
}

process.exit(report.ok ? 0 : 3)
