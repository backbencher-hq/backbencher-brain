/**
 * CSS `overrides` DIFFERENTIAL — the lane's DERIVATION finding, measured.
 *
 * ## What this is for
 *
 * `overrides` was EMITTED and derived by nothing: `deriveCssEdges` pushes four labels
 * and none of them is `overrides`, and the css comparison allowlist is those same four.
 * `script/m14/oracles/css-overrides.ts` is the missing oracle. This runner is what
 * turns "the oracle exists" into a number, and it deliberately does NOT go through
 * `script/m14/differential.ts` — that file is supervisor-owned (lane brief §8) and
 * wiring the oracle into it needs four changes in three places, written out in the
 * oracle's own header.
 *
 * So the comparison is made HERE, over the whole admitted corpus, between:
 *
 *   - the ANALYZER side: production `parseFile` from `src/ast/pool-worker.ts`, filtered
 *     to `overrides`. Not `analyze()` — the per-file unit skips the pipeline stages, and
 *     a number about `analyze()` is a number about a different thing.
 *   - the ORACLE side: `deriveCssOverridesTruth` over the same file's parse tree, walked
 *     with the SAME pinned wasm `parseFile` loads, so the two see one grammar.
 *
 * ## What it reports, and why each number is here
 *
 *   AGREE     the same (name, supersedesLine) pair on both sides
 *   MISSING   the oracle derives it, the analyzer does not publish it  -> analyzer gap
 *   EXTRA     the analyzer publishes it, the oracle derives nothing       -> FABRICATION
 *
 * `EXTRA` is the expensive column and it is the one this lane cannot argue down. Every
 * type has an undershoot risk and only some have a fabrication risk; for `overrides` the
 * fabrication is 97.3% of the corpus population, because 142 of the 146 same-name second
 * `@keyframes` declarations are a vendor-prefixed pair. Both endpoints of such an edge
 * are REAL symbols, so no resolution check catches it — `bb_impact` on a keyframes name
 * would simply report a false replacement.
 *
 * ## The comparison key, and why `(name)` alone is not enough
 *
 * `source === target` by construction — the lane publishes one symbol per name — so
 * `(label, from, target)` cannot tell one redefinition from three, and a set-based
 * comparison would call a file that emits the right name the wrong number of times a
 * match. Every row is therefore keyed `(name, supersedesLine)` and MULTIPLICITY is
 * compared, which is the check that would catch an analyzer emitting two indistinguishable
 * edges where the language performs one replacement.
 *
 * ## Sampling
 *
 * `--files N` (default: ALL admitted files) with a deterministic stride, same admission
 * rule as `script/m14/ontology-coverage-gate.ts`: git-tracked, a real directory,
 * <= 512 KB, `detectLanguageFromPath(abs, text) === "css"`. `--json <path>` writes the
 * full row set.
 *
 * ## READ-ONLY
 *
 * Writes nothing but the optional `--json` file.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveCssOverridesTruth } from "../../../script/m14/oracles/css-overrides"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const fi = argv.indexOf("--files")
const SAMPLE = fi >= 0 ? Number(argv[fi + 1]) || 0 : 0
const ji = argv.indexOf("--json")
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")

// ---------------------------------------------------------------- corpus

type File = { repo: string; rel: string; abs: string; text: string }
const every: File[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "css") continue
    every.push({ repo: e, rel, abs, text })
  }
}
let files = every
if (SAMPLE > 0 && every.length > SAMPLE) {
  const stride = Math.max(1, Math.floor(every.length / SAMPLE))
  files = []
  for (let i = 0; i < every.length && files.length < SAMPLE; i += stride) files.push(every[i])
}

// ---------------------------------------------------------------- the pinned grammar

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(WASM)))

/** A composite comparison key. The NUL separator cannot occur in a CSS name, so
 *  `--x` + `12` and `--x1` + `2` cannot collide into one key. */
const SEP = "\u0000"
const cmpKey = (name: string, sup: unknown): string => `${name}${SEP}${String(sup)}`
/** Multiplicity is part of the key, deliberately — see the file header. */
const tally = (m: Map<string, number>, k: string): void => m.set(k, (m.get(k) ?? 0) + 1)
const splitKey = (k: string): { name: string; sup: string } => {
  const at = k.indexOf(SEP)
  return { name: k.slice(0, at), sup: k.slice(at + 1) }
}

let parsed = 0
let parseFailures = 0
let degraded = 0
let filesWithEither = 0
let emittedTotal = 0
let storeDistinctTotal = 0
let oracleRowsTotal = 0

const missing: { file: string; name: string; supersedesLine: string; rule: string; classification?: string; supersedingLine?: number | null }[] = []
const extra: { file: string; name: string; supersedesLine: string; rule: string }[] = []
/** Surplus oracle rows where both declarations share a line: a store-key collision. */
let storeCollision = 0
/** Surplus oracle rows on different lines: an analyzer gap. This is the number that must be 0. */
let realGap = 0
const perRule = new Map<string, { agree: number; missing: number; extra: number }>()
const bump = (rule: string, col: "agree" | "missing" | "extra", by = 1): void => {
  const row = perRule.get(rule) ?? { agree: 0, missing: 0, extra: 0 }
  row[col] += by
  perRule.set(rule, row)
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  let r: any
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch {
    parseFailures++
    continue
  }
  if (!r) { parseFailures++; continue }
  parsed++
  if (r.fallback === true) degraded++

  const analyzer = new Map<string, number>()
  const analyzerRule = new Map<string, string>()
  // The STORE key for a relationship is (source, type, target, line) - M59 #822 - and
  // rows are inserted with INSERT OR IGNORE, so two emitted edges agreeing on all four
  // are ONE stored row. Counted separately, because "the analyzer emits N" and "a
  // consumer can read N" are different claims and only the second is about the graph.
  const storeKeys = new Set<string>()
  for (const x of (Array.isArray(r.relationships) ? r.relationships : []) as any[]) {
    if (String(x.type).toLowerCase() !== "overrides") continue
    emittedTotal++
    const name = String(x.source ?? "")
    const k = cmpKey(name, (x.metadata ?? {}).supersedesLine)
    tally(analyzer, k)
    storeKeys.add(`${name}${SEP}${String(x.target ?? "")}${SEP}${String(x.line_number ?? "")}`)
    const rule = (x.metadata ?? {}).isKeyframesRedefinition
      ? "keyframes-redefinition"
      : (x.metadata ?? {}).isPropertyReregistration
        ? "property-re-registration"
        : "custom-property-redefinition"
    if (!analyzerRule.has(k)) analyzerRule.set(k, rule)
  }
  storeDistinctTotal += storeKeys.size

  const tree = parser.parse(f.text)
  const truth = tree ? deriveCssOverridesTruth(tree.rootNode, path.basename(f.abs)) : []
  tree?.delete?.()
  oracleRowsTotal += truth.length

  const oracle = new Map<string, number>()
  const oracleRule = new Map<string, string>()
  // The oracle's rows, kept per comparison key so the SURPLUS can be classified. The
  // comparison key is (name, supersedesLine), which on its own cannot tell a store
  // collision from a real gap — see the classification in the surplus loop below.
  const oracleRowsByKey = new Map<string, { line: number; supersedesLine: number }[]>()
  for (const e of truth) {
    const k = cmpKey(e.from, e.supersedesLine)
    tally(oracle, k)
    if (e.rule && !oracleRule.has(k)) oracleRule.set(k, e.rule)
    const rows = oracleRowsByKey.get(k) ?? []
    rows.push({ line: Number(e.line ?? -1), supersedesLine: Number(e.supersedesLine ?? -1) })
    oracleRowsByKey.set(k, rows)
  }

  if (analyzer.size > 0 || oracle.size > 0) filesWithEither++

  // Oracle rows the analyzer does not publish. The shared rows count as AGREE and only
  // the surplus as MISSING, so a file where the analyzer emits the right name twice does
  // not read as two agreements.
  for (const [k, n] of oracle) {
    const a = analyzer.get(k) ?? 0
    const rule = oracleRule.get(k) ?? "?"
    const shared = Math.min(a, n)
    bump(rule, "agree", shared)
    bump(rule, "missing", n - shared)
    const parts = splitKey(k)
    const rows = oracleRowsByKey.get(k) ?? []
    // The surplus rows are CLASSIFIED, because `missing` on its own conflates two
    // things that call for opposite conclusions and the reader cannot tell them apart:
    //
    //   STORE-COLLISION — the superseding declaration and the one it supersedes are on
    //     the SAME line, so the two edges are indistinguishable under the store's
    //     (source,type,target,line) key and one of them cannot be held. This is a
    //     MINIFIED-FILE artefact: `bulma-no-helpers-prefixed.min.css` is 2 lines long,
    //     so all three of its blocks sit on line 2 and three supersessions of one name
    //     all want the same key. The analyzer is not missing a construct here; the
    //     store cannot represent the second and third. Reported separately so it is
    //     not read as a defect in the analyzer.
    //
    //   REAL-GAP — the two declarations are on DIFFERENT lines, so the store can hold
    //     the edge, the oracle derived it, and the analyzer did not publish it. That is
    //     an analyzer gap and it is the number that must be zero.
    //
    // The two are separated by a parse fact (`line` vs `supersedesLine`), not by a
    // judgement about which number looks better.
    const surplus = n - shared
    for (let i = 0; i < surplus; i++) {
      const row = rows[shared + i]
      const cls = row && row.line === row.supersedesLine ? "store-collision" : "real-gap"
      if (cls === "store-collision") storeCollision++
      else realGap++
      missing.push({
        file: label,
        name: parts.name,
        supersedesLine: parts.sup,
        rule,
        classification: cls,
        supersedingLine: row ? row.line : null,
      })
    }
    void surplus
  }
  // Analyzer edges the oracle derives nothing for - the FABRICATION column.
  for (const [k, n] of analyzer) {
    const o = oracle.get(k) ?? 0
    const rule = analyzerRule.get(k) ?? "?"
    // NO `agree` bump here: the shared rows are already counted by the oracle loop
    // above, and counting them from both sides double-counts every agreement — which
    // reads as a HIGHER agreement rate than the edges justify, i.e. the error inflates
    // the number a reader is supposed to be checking.
    const shared = Math.min(o, n)
    bump(rule, "extra", n - shared)
    const parts = splitKey(k)
    for (let i = 0; i < n - shared; i++) extra.push({ file: label, name: parts.name, supersedesLine: parts.sup, rule })
  }
}

const sum = (col: "agree" | "missing" | "extra"): number => {
  let n = 0
  for (const v of perRule.values()) n += v[col]
  return n
}
const AGREE = sum("agree")
const MISSING = sum("missing")
const EXTRA = sum("extra")
const TOTAL = AGREE + MISSING + EXTRA

const report = {
  tool: "css-overrides-differential",
  corpusRoot: CR,
  corpusTotal: every.length,
  sampled: files.length,
  sampling: SAMPLE > 0 ? `deterministic stride, stride=${Math.max(1, Math.floor(every.length / SAMPLE))}` : "ALL admitted files",
  filesParsed: parsed,
  parseFailures,
  degradedFallbacks: degraded,
  filesWithAnOverridesEdgeOnEitherSide: filesWithEither,
  analyzerEdgesEmitted: emittedTotal,
  analyzerEdgesDistinctUnderStoreKey: storeDistinctTotal,
  analyzerEdgesLostToInsertOrIgnore: emittedTotal - storeDistinctTotal,
  oracleRowsDerived: oracleRowsTotal,
  analyzerEdgesLostToInsertOrIgnore: emittedTotal - storeDistinctTotal,
  agree: AGREE,
  missingInAnalyzer: MISSING,
  missingClassified: { storeCollision, realGap },
  extraInAnalyzer: EXTRA,
  agreementPct: TOTAL === 0 ? null : Number(((100 * AGREE) / TOTAL).toFixed(2)),
  perRule: Object.fromEntries(perRule),
  missingExamples: missing.slice(0, 20),
  // The two classes are listed SEPARATELY. A single truncated example list shows the
  // first 20 rows in file order, which here are all store collisions, so the printed
  // examples describe the benign class and the defect class is invisible in them.
  realGapExamples: missing.filter((m) => m.classification === "real-gap").slice(0, 20),
  storeCollisionExamples: missing.filter((m) => m.classification === "store-collision").slice(0, 10),
  extraExamples: extra.slice(0, 20),
}
if (ji !== -1 && argv[ji + 1]) writeFileSync(argv[ji + 1], JSON.stringify(report, null, 2) + "\n")

const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`css overrides differential — production parseFile vs script/m14/oracles/css-overrides.ts`)
console.log(`corpus ${CR}`)
console.log(`sampled ${files.length} of ${every.length} admitted files — ${report.sampling}`)
console.log(`parsed ${parsed}/${files.length}, failures ${parseFailures}, DEGRADED ${degraded}`)
console.log(`files with an \`overrides\` row on either side: ${filesWithEither}`)
console.log(`analyzer edges EMITTED ${emittedTotal}; distinct under the store key (source,type,target,line) ${storeDistinctTotal}; lost to INSERT OR IGNORE ${emittedTotal - storeDistinctTotal}`)
console.log(`oracle rows derived ${AGREE + MISSING}`)
console.log(``)
console.log(`${w("rule", 34)}${w("agree", 9)}${w("missing", 10)}${w("extra", 8)}`)
console.log("-".repeat(61))
for (const [k, v] of [...perRule.entries()].sort()) {
  console.log(`${w(k, 34)}${w(String(v.agree), 9)}${w(String(v.missing), 10)}${w(String(v.extra), 8)}`)
}
console.log("-".repeat(61))
console.log(`${w("TOTAL", 34)}${w(String(AGREE), 9)}${w(String(MISSING), 10)}${w(String(EXTRA), 8)}`)
console.log(``)
console.log(`agreement ${report.agreementPct === null ? "n/a (no rows on either side)" : `${report.agreementPct}%`}  (agree / (agree + missing + extra))`)
console.log(`MISSING (oracle derives, analyzer does not publish) = ${MISSING}`)
console.log(`  of which STORE-COLLISION (both declarations on one line; the store key cannot hold both) = ${storeCollision}`)
console.log(`  of which REAL-GAP (different lines; the store CAN hold it and the analyzer dropped it) = ${realGap}   <- this is the defect count`)
console.log(`EXTRA   (analyzer publishes, oracle derives nothing)  = ${EXTRA}  -> a FABRICATION if non-zero`)
for (const e of missing.slice(0, 10)) console.log(`  MISSING ${e.file}: ${e.name} supersedes L${e.supersedesLine} (${e.rule})`)
for (const e of extra.slice(0, 10)) console.log(`  EXTRA   ${e.file}: ${e.name} supersedes ${e.supersedesLine} (${e.rule})`)
// The exit code answers "is the analyzer wrong", so it keys on the DEFECT count and not
// on the raw surplus. A store collision is not an analyzer defect: two supersessions
// that land on one line in a minified file want the same (source,type,target,line) key
// and the store holds one row for it, so the second edge is unrepresentable rather than
// unpublished. Exiting 1 on it would train the reader to ignore this script's failures,
// which is how a real 42-edge gap sat behind a benign 20 for a round. `EXTRA` — an edge
// the analyzer publishes and the oracle derives nothing for — is a fabrication and is
// still a failure on its own.
const DEFECTS = realGap + EXTRA
console.log(
  DEFECTS === 0
    ? `VERDICT: no analyzer defect. ${realGap} real gap(s), ${EXTRA} fabrication(s).` +
        (storeCollision > 0
          ? ` The ${storeCollision} store collision(s) are unrepresentable under the store key, not unpublished.`
          : "")
    : `VERDICT: ${DEFECTS} analyzer defect(s) — ${realGap} real gap(s), ${EXTRA} fabrication(s).`,
)
process.exitCode = DEFECTS === 0 ? 0 : 1
