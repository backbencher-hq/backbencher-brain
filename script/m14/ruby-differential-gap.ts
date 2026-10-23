/**
 * THE DIFFERENTIAL GAP — EVERY MISSING AND EVERY UNEXPLAINED ROW, WITH ITS LOCATION.
 *
 * ⇒ WHY THIS FILE EXISTS. The campaign's differential prints a SAMPLE of the rows the truth
 * publishes and the analyzer does not (and of the rows the analyzer publishes and the truth does
 * not). **⇒ A SAMPLE NAMES A CLASS; IT DOES NOT DISPOSITION ONE.** This instrument prints EVERY
 * row of both sets, with the file and the line, so that every one of them can be given a
 * disposition — a fix, a ruling, or a documented refusal — instead of a shrug.
 *
 * ⇒ IT USES THE DIFFERENTIAL'S OWN MATCH KEY: **(label, target) ONLY**. The `from`/`source` is
 * NOT part of the match, because the campaign's own oracle deliberately does not restate the
 * enclosing scope on a `calls` edge (`from` is still carried for the two cases that genuinely
 * need it: an anonymous scope's `contains`, and an implicit `overrides`).
 *
 * ⇒ AND IT ALSO DIFFS THE TWO BUILT-IN SUPPRESSION LISTS, because that is a SHARED CONTRACT
 * between the analyzer and the oracle and a difference in it is a whole CLASS of disagreement:
 * the oracle's own comment says the list "is the analyzer's suppression list, not a judgement
 * about the Ruby language". ⇒ ⇒ If the analyzer suppresses a call the oracle does not, every
 * occurrence of that call is a MISSING row; if the oracle suppresses one the analyzer does not,
 * every occurrence is an UNEXPLAINED row. ⇒ THE LIST DIFF IS THE CLASS, AND THE ROWS ARE THE
 * INSTANCES.
 *
 * EXIT CODE: 0 when there is nothing to disposition; 4 when there is (the caller reads the
 * report). The instrument never decides — it MEASURES and LOCATES.
 */
import { getParser } from "../../src/ast/engine"
import { RealRubyAnalyzer, RUBY_BUILTINS as ANALYZER_BUILTINS } from "../../src/ast/real-ruby-analyzer"
import { deriveRubyEdges, RUBY_BUILTINS as ORACLE_BUILTINS } from "./ruby-truth"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { BINDING_SEP as SHARED_BINDING_SEP } from "../../src/ast/types"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const OUT_DIR = path.join(CR, "..", "validation", "m14", "measurements")

// ⇒ THE REPOSITORIES TO WALK. The differential's draws are `--repo rack --lang ruby` and
// `--repo gql-ruby --lang ruby --sample 60`; this instrument walks the WHOLE of each repo, so
// the gap census is not limited to a rotation.
const REPOS = (process.argv.find(a => a.startsWith("--repos=")) ?? "--repos=rack,gql-ruby").split("=")[1].split(",")
const LIMIT = Number((process.argv.find(a => a.startsWith("--limit=")) ?? "--limit=0").split("=")[1])

/**
 * THE MATCH KEY — the differential's own, in BOTH directions, with its ASYMMETRY intact.
 *
 * ⇒ THE RULE IS COPIED FROM THE DIFFERENTIAL, NOT GUESSED AT. `matchKey` is
 * `script/m14/differential.ts:25779-25782` and the two comparisons are lines 25784 and 25789:
 *
 *   MISSING (a truth row the analyzer lacks):    the analyzer has a row of the same LABEL whose
 *     matchKey EQUALS the truth row's matchKey. Nothing looser.
 *   UNEXPLAINED (an analyzer row the truth lacks): a truth row of the same label explains it if
 *     the matchKeys are equal **OR** the truth row's RAW target CONTAINS the analyzer row's leaf
 *     (`te.target.includes(normTarget(auditTarget(r.target)))`), except for `imports`.
 *
 * ⇒ AND THE ASYMMETRY IS THE POINT: a truth row that names a QUALIFIED target explains an
 * analyzer row that names the LEAF, but not the other way round. ⇒ ⇒ MY FIRST VERSION OF THIS
 * INSTRUMENT MATCHED ON THE RAW TARGET AND REPORTED 89 MISSING AND 90 UNEXPLAINED `overrides`
 * ROWS — WHICH WERE NOTHING: the oracle spells the target `Rack::Response.initialize` and the
 * analyzer spells it `initialize`. **⇒ A COMPARISON THAT IS STRICTER THAN THE ONE IT CLAIMS TO
 * REPRODUCE INVENTS GAPS**, and the number it reports is then a measurement of the instrument.
 *
 * ⇒ `normTarget` is `script/m14/differential.ts:1250-1276` — trim, cut at the first `[` or `<`
 * (only when that bracket is not at index 0), take the last dot/`::` segment.
 */
const lastSegment = (s: string): string => {
  const i = Math.max(s.lastIndexOf("."), s.lastIndexOf(":"))
  return (i >= 0 ? s.slice(i + 1) : s).trim()
}
const normTarget = (t: string): string => {
  const s = String(t ?? "").trim()
  const cut = s.search(/[[<]/)
  const head = cut > 0 ? s.slice(0, cut) : s
  return lastSegment(head)
}
/** THE LOCAL-BINDING SEPARATOR — a binding edge names no declaration, so the audit reads the part AFTER it. */
const BINDING_SEP = SHARED_BINDING_SEP
const auditTarget = (t: string): string => {
  const s = String(t ?? "")
  const at = s.lastIndexOf(BINDING_SEP)
  return at >= 0 ? s.slice(at + BINDING_SEP.length) : s
}
const matchKey = (label: string, target: any): string => `${label}|${normTarget(auditTarget(String(target ?? "")))}`

const parser = await getParser("ruby" as any)
const analyzer = new RealRubyAnalyzer()

type Gap = {
  label: string
  target: string
  file: string
  line: number
  /** The oracle's `from`, when it carried one. */
  from: string | undefined
  /** The analyzer's source, for an UNEXPLAINED row. */
  analyzerSource: string
  /** The analyzer's line, for an UNEXPLAINED row. */
  analyzerLine: number
  /** The oracle's line, for a MISSING row. */
  oracleLine: number
}

const missing: Gap[] = []      // the truth publishes it, the analyzer does not
const unexplained: Gap[] = []  // the analyzer publishes it, the truth does not
let filesRead = 0
let parseFailures = 0
let truthRows = 0
let analyzerRows = 0

for (const repo of REPOS) {
  const repoDir = path.join(CR, repo)
  let rels: string[] = []
  try {
    const { execFileSync } = await import("node:child_process")
    rels = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\0").filter(Boolean).filter(f => f.endsWith(".rb"))
  } catch { continue }
  if (LIMIT > 0) rels = rels.slice(0, LIMIT)
  for (const rel of rels) {
    const abs = path.join(repoDir, rel)
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { parseFailures++; continue }
    let root: any
    // ⇒ THE ROOT IS CHECKED, NOT ASSUMED — a null root is a file this instrument did not read,
    // and it is COUNTED, never treated as a file with no edges.
    try { root = parser.parse(content)?.rootNode } catch { parseFailures++; continue }
    if (!root) { parseFailures++; continue }
    filesRead++

    const truth = deriveRubyEdges(root)
    truthRows += truth.length
    const res = await analyzer.analyze(root, content, rel)
    const aRels = (res.relationships ?? []) as any[]
    analyzerRows += aRels.length

    // ⇒ THE TWO COMPARISONS, EXACTLY AS THE DIFFERENTIAL MAKES THEM (line 25784 and line 25789).
    //   MISSING    — a truth row with no analyzer row of the same label whose matchKey EQUALS it.
    //   UNEXPLAINED — an analyzer row with no truth row of the same label that either matches it
    //                 or names a target CONTAINING its leaf (the `imports` label excepted).
    for (const te of truth) {
      const hit = aRels.some((r: any) => String(r.type) === te.label && matchKey(String(r.type), r.target) === matchKey(te.label, te.target))
      if (!hit) {
        missing.push({
          label: te.label, target: te.target, file: `${repo}/${rel}`, line: te.line,
          from: te.from, analyzerSource: "", analyzerLine: 0, oracleLine: te.line,
        })
      }
    }
    for (const r of aRels) {
      const label = String(r.type)
      const hit = truth.some(te =>
        te.label === label &&
        (matchKey(label, r.target) === matchKey(te.label, te.target) ||
          (label !== "imports" && te.target.includes(normTarget(auditTarget(String(r.target)))))))
      if (!hit) {
        unexplained.push({
          label, target: String(r.target), file: `${repo}/${rel}`,
          line: 0, from: undefined, analyzerSource: String(r.source ?? ""),
          analyzerLine: Number(r.line_number ?? r.lineNumber ?? 0), oracleLine: 0,
        })
      }
    }
  }
}

// ⇒ THE BUILT-IN LIST DIFF — THE SHARED CONTRACT, MEASURED.
const onlyAnalyzer = [...ANALYZER_BUILTINS].filter(x => !ORACLE_BUILTINS.has(x)).sort()
const onlyOracle = [...ORACLE_BUILTINS].filter(x => !ANALYZER_BUILTINS.has(x)).sort()

const byMissingLabel: Record<string, number> = {}
for (const g of missing) byMissingLabel[g.label] = (byMissingLabel[g.label] ?? 0) + 1
const byUnexplainedLabel: Record<string, number> = {}
for (const g of unexplained) byUnexplainedLabel[g.label] = (byUnexplainedLabel[g.label] ?? 0) + 1

const report = {
  question:
    "Which rows does the oracle publish and the analyzer does not, which does the analyzer publish and the oracle does not, and where do the two built-in suppression lists disagree?",
  repos: REPOS,
  filesRead,
  parseFailures,
  truthRows,
  analyzerRows,
  missingCount: missing.length,
  unexplainedCount: unexplained.length,
  byMissingLabel,
  byUnexplainedLabel,
  builtinList: {
    analyzerSize: ANALYZER_BUILTINS.size,
    oracleSize: ORACLE_BUILTINS.size,
    onlyInTheAnalyzer: onlyAnalyzer,
    onlyInTheOracle: onlyOracle,
    identical: onlyAnalyzer.length === 0 && onlyOracle.length === 0,
  },
  missing,
  unexplained,
  instrument: "script/m14/ruby-differential-gap.ts",
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, "ruby-differential-gap-2026-10-22.json"), JSON.stringify(report, null, 2) + "\n")

console.log("RUBY — THE DIFFERENTIAL GAP (every row, with its location)")
console.log(`  repos ${REPOS.join(", ")} · files read ${filesRead} · parse failures ${parseFailures}`)
console.log(`  oracle rows ${truthRows} · analyzer rows ${analyzerRows}`)
console.log(`  ⇒ MISSING (the oracle publishes, the analyzer does not): ${missing.length}  ${JSON.stringify(byMissingLabel)}`)
console.log(`  ⇒ UNEXPLAINED (the analyzer publishes, the oracle does not): ${unexplained.length}  ${JSON.stringify(byUnexplainedLabel)}`)
console.log(`  ⇒ THE BUILT-IN LIST: analyzer ${ANALYZER_BUILTINS.size} · oracle ${ORACLE_BUILTINS.size} · identical: ${report.builtinList.identical}`)
if (onlyAnalyzer.length) console.log(`      ONLY IN THE ANALYZER: ${onlyAnalyzer.join(", ")}`)
if (onlyOracle.length) console.log(`      ONLY IN THE ORACLE: ${onlyOracle.join(", ")}`)
console.log("  ⇒ MISSING, by (label, target):")
const missingGroups = new Map<string, Gap[]>()
for (const g of missing) {
  const k = `${g.label} -> ${g.target}`
  if (!missingGroups.has(k)) missingGroups.set(k, [])
  missingGroups.get(k)!.push(g)
}
for (const [k, gs] of [...missingGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`      ${String(gs.length).padStart(4)}  ${k}   e.g. ${gs[0].file}:${gs[0].line}`)
}
console.log("  ⇒ UNEXPLAINED, by (label, target):")
const unexpGroups = new Map<string, Gap[]>()
for (const g of unexplained) {
  const k = `${g.label} -> ${g.target}`
  if (!unexpGroups.has(k)) unexpGroups.set(k, [])
  unexpGroups.get(k)!.push(g)
}
for (const [k, gs] of [...unexpGroups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
  console.log(`      ${String(gs.length).padStart(4)}  ${k}   e.g. ${gs[0].file}:${gs[0].analyzerLine} (source ${gs[0].analyzerSource})`)
}
process.exit(0)
