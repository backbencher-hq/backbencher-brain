/**
 * TYPESCRIPT DERIVATION AUDIT — the runner for the two labels the differential
 * never audits.
 *
 * ## Why this file exists
 *
 * `validation/m60/rel-type-coverage-baseline.json` records five DERIVATION findings
 * for typescript. Three of them are already repaid and the baseline was never
 * refreshed: `oracles/typescript-contains.ts`, `-references.ts` and `-uses.ts` are
 * imported by `differential.ts:35,64,65` and typescript joins the contains,
 * references and uses audited sets. Run live, the gate reports TWO:
 *
 *     CHECK 1 — DERIVATION: typescript 2 un-audited: ["exports","imports"]
 *
 * `script/m14/oracles/typescript-imports-exports.ts` EXISTS (258 lines) and
 * exports `deriveImportsTruth` / `deriveExportsTruth`. It is not imported by
 * `differential.ts` — `grep -c typescript-imports-exports script/m14/differential.ts`
 * is 0. So the audit was written and never switched on, which is the same failure as
 * never writing it: the 6,490 `imports` and 3,974 `exports` edges this lane emits
 * on a 400-file corpus draw are stored and compared against nothing.
 *
 * `script/m14/**` is master-owned, so this lane does not wire it. What this lane
 * CAN do, and does, is answer the question that decides whether wiring it is safe:
 * **does the oracle actually agree with the analyzer?** An unwired oracle that
 * disagrees is worse than no oracle, because wiring it turns a silent lane red for
 * reasons nobody has read. So this runner measures the agreement, per label, per
 * file, and prints the disagreements.
 *
 * ## What the agreement does and does not prove
 *
 * Both paths walk the SAME tree-sitter-typescript grammar. So agreement proves the
 * two DERIVATIONS agree — it does not prove either is right. A grammar bug shared
 * by both is invisible to this instrument by construction, and the M14 contract's
 * L3 claim ("ORACLE-CONFORMANT"/"DIFFERENTIALLY-CHECKED") must not be read past
 * that. What this DOES establish, which nothing else here has:
 *
 *   * the audit is not tautological — it shares no helper with the analyzer and is
 *     shown able to go RED (see `--selftest`);
 *   * every emitted `imports` / `exports` edge is either reproduced by an
 *     independent derivation or named as a discrepancy, with a count;
 *   * the two shapes the analyzer invents that the oracle deliberately does not
 *     (the module-stem source, the `module:name` target) are measured rather than
 *     assumed.
 *
 * ## NO REGEXP
 *
 * Like the analyzer it audits. Module leaf, specifier and name handling is
 * `endsWith`/`indexOf`/`slice`/char-code. A regular expression over source text
 * matches comments and string literals, which is exactly how an oracle comes to
 * agree with a buggy analyzer for the wrong reason.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import {
  deriveImportsTruth,
  deriveExportsTruth,
} from "../../m14/oracles/typescript-imports-exports"

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1]
  for (const a of argv) if (a.startsWith(flag + "=")) return a.slice(flag.length + 1)
  return undefined
}
const CORPUS_DIR = argOf("--repo-dir") ?? "$HOME/fixtures/repositories/typescript"
const LIMIT = Number(argOf("--limit") ?? "200")
const OUT = argOf("--out")
const SELFTEST = argv.includes("--selftest")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(400 * 1024))

/** The basename without its extension — the `moduleLeaf` both the analyzer's
 *  `moduleLeafName()` and the oracle's `moduleLeaf` parameter mean. Written with
 *  `lastIndexOf(".")`, never a pattern. */
const moduleLeafOf = (p: string): string => {
  const base = p.slice(p.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

type Rel = { type?: string; source?: string; target?: string; [k: string]: unknown }
type Row = { label: string; from: string; target: string }

/** Multiset key for one row. A multiset and not a set: two `imports` rows with the
 *  same target from the same module are duplicates the analyzer may or may not
 *  publish, and collapsing them would hide exactly the duplication this audit is
 *  for. */
const keyOf = (r: Row): string => `${r.label}|${r.from}|${r.target}`

/** Compare two multisets and report, in BOTH directions, which side had rows the
 *  other did not. One direction is not an audit: "every emitted edge is explained"
 *  is satisfied by an oracle that derives nothing. */
const compare = (analyzer: Row[], truth: Row[]) => {
  const a = new Map<string, number>()
  const t = new Map<string, number>()
  for (const r of analyzer) a.set(keyOf(r), (a.get(keyOf(r)) ?? 0) + 1)
  for (const r of truth) t.set(keyOf(r), (t.get(keyOf(r)) ?? 0) + 1)
  let matched = 0
  const analyzerOnly: string[] = []
  const truthOnly: string[] = []
  for (const [k, n] of a) {
    const m = t.get(k) ?? 0
    const common = Math.min(n, m)
    matched += common
    if (n > m) analyzerOnly.push(k)
  }
  for (const [k, n] of t) {
    const m = a.get(k) ?? 0
    if (n > m) truthOnly.push(k)
  }
  return {
    analyzer: analyzer.length,
    truth: truth.length,
    matched,
    /** emitted, and no independent derivation reproduces it — a FABRICATION */
    unexplained: analyzerOnly,
    /** derived, and never emitted — a MISSING edge */
    missing: truthOnly,
  }
}

/* ------------------------------------------------------------------ *
 * Corpus admission — git-tracked, deterministic, same rule as the census.
 * ------------------------------------------------------------------ */
const tracked = (() => {
  try {
    return execFileSync("git", ["-C", CORPUS_DIR, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return [] as string[] }
})()
const candidates = tracked.filter((f) => {
  if (f.endsWith(".d.ts")) return false
  if (f.indexOf("/testdata/") >= 0) return false
  return f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".mts")
})
const admitted: Array<{ rel: string; abs: string; text: string }> = []
for (const rel of candidates) {
  if (admitted.length >= LIMIT) break
  const abs = path.join(CORPUS_DIR, rel)
  try {
    if (statSync(abs).size > MAX_BYTES) continue
    admitted.push({ rel, abs, text: readFileSync(abs, "utf8") })
  } catch { continue }
}

const { getParser } = await import("../../../src/ast/engine")
const { RealTypeScriptAnalyzer } = await import("../../../src/ast/real-typescript-analyzer")

const LABELS = ["imports", "exports"] as const
type Label = (typeof LABELS)[number]
type Tally = {
  files: number
  analyzer: number
  truth: number
  matched: number
  unexplainedCount: number
  missingCount: number
  unexplained: string[]
  missing: string[]
}
const fresh = (): Tally => ({
  files: 0, analyzer: 0, truth: 0, matched: 0, unexplainedCount: 0, missingCount: 0,
  unexplained: [], missing: [],
})
const tally = new Map<Label, Tally>(LABELS.map((l) => [l, fresh()]))

let parsed = 0
let failed = 0
const failures: string[] = []
for (const f of admitted) {
  let pr: any
  let res: { relationships?: Rel[] }
  try {
    const parser = await getParser("typescript" as never)
    pr = await parser.parse(f.text, f.abs)
    res = new RealTypeScriptAnalyzer().analyze(pr.rootNode, f.text, f.abs) as never
  } catch (e) {
    failed++
    if (failures.length < 10) failures.push(`${f.rel}: ${String(e).slice(0, 100)}`)
    continue
  }
  parsed++
  const leaf = moduleLeafOf(f.abs)
  for (const label of LABELS) {
    const emitted: Row[] = (res.relationships ?? [])
      .filter((r) => String(r.type ?? r.relationshipType ?? "") === label)
      .map((r) => ({ label, from: String(r.source ?? ""), target: String(r.target ?? "") }))
    const derived: Row[] = label === "imports"
      ? deriveImportsTruth(pr.rootNode, leaf)
      : deriveExportsTruth(pr.rootNode, leaf)
    if (emitted.length === 0 && derived.length === 0) continue
    const c = compare(emitted, derived)
    const t = tally.get(label)!
    t.files++
    t.analyzer += c.analyzer
    t.truth += c.truth
    t.matched += c.matched
    t.unexplainedCount += c.unexplained.length
    t.missingCount += c.missing.length
    for (const k of c.unexplained) if (t.unexplained.length < 40) t.unexplained.push(`${f.rel}  ${k}`)
    for (const k of c.missing) if (t.missing.length < 40) t.missing.push(`${f.rel}  ${k}`)
  }
}

/* ------------------------------------------------------------------ *
 * Self-test: an audit nobody has watched fail is a claim.
 *
 * The audit's failure mode is a TAUTOLOGY — an oracle that derives nothing makes
 * every emitted row "unexplained" and every derived row "missing", which is red;
 * but an oracle that derives EXACTLY what the analyzer derives by construction
 * would be green while proving nothing. Neither is detectable by running the real
 * corpus, so each direction is asserted on a synthetic case with a known answer.
 * ------------------------------------------------------------------ */
const SELFTEST_FAILURES: string[] = []
const selfCheck = (name: string, cond: boolean) => { if (!cond) SELFTEST_FAILURES.push(name) }
{
  const row = (l: string, f: string, t: string): Row => ({ label: l, from: f, target: t })
  const a = [row("imports", "m", "x:y"), row("imports", "m", "x:z")]
  const tSame = [row("imports", "m", "x:y"), row("imports", "m", "x:z")]
  selfCheck("identical sets are fully matched", (() => { const c = compare(a, tSame); return c.matched === 2 && c.unexplained.length === 0 && c.missing.length === 0 })())
  const tOne = [row("imports", "m", "x:y")]
  selfCheck("an extra emitted row is UNEXPLAINED", (() => { const c = compare(a, tOne); return c.unexplained.length === 1 && c.unexplained[0] === "imports|m|x:z" })())
  selfCheck("a missing derived row is MISSING", (() => { const c = compare(tOne, a); return c.missing.length === 1 && c.missing[0] === "imports|m|x:z" })())
  selfCheck("an empty oracle makes every row unexplained, not green",
    (() => { const c = compare(a, []); return c.matched === 0 && c.unexplained.length === 2 && c.missing.length === 0 })())
  selfCheck("an empty analyzer makes every derived row MISSING, not green",
    (() => { const c = compare([], a); return c.matched === 0 && c.missing.length === 2 })())
  selfCheck("a duplicated row is counted as a multiset, not collapsed",
    (() => { const c = compare([...a, row("imports", "m", "x:y")], tSame); return c.unexplained.length === 1 })())
  selfCheck("labels do not cross-match",
    (() => { const c = compare([row("imports", "m", "x:y")], [row("exports", "m", "x:y")]); return c.unexplained.length === 1 && c.missing.length === 1 })())
  // moduleLeafOf is the join key on both sides; if it were wrong every row would be
  // "unexplained" for a reason that has nothing to do with the analyzer.
  selfCheck("moduleLeafOf strips one extension", moduleLeafOf("/a/b/api.sync.ts") === "api.sync")
  selfCheck("moduleLeafOf keeps a dotted basename", moduleLeafOf("/a/b/api.d.ts") === "api.d")
  selfCheck("moduleLeafOf handles a dotfile-ish name", moduleLeafOf("/a/b/.hidden") === ".hidden")
}
if (SELFTEST) {
  console.log(`derivation audit self-test: ${SELFTEST_FAILURES.length === 0 ? "all assertions pass" : "FAILED"}`)
  for (const f of SELFTEST_FAILURES) console.log(`  FAIL ${f}`)
  console.log(`  asserted: identical->matched, extra->unexplained, absent->missing, empty oracle->red,`)
  console.log(`  empty analyzer->red, duplicate->multiset, labels do not cross-match, moduleLeafOf x3`)
  process.exit(SELFTEST_FAILURES.length === 0 ? 0 : 1)
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(2) : "n/a")

console.log(`typescript derivation audit — the two labels differential.ts does not audit`)
console.log(`oracle: script/m14/oracles/typescript-imports-exports.ts (EXISTS, NOT WIRED: grep -c in differential.ts = 0)`)
console.log(`corpus ${CORPUS_DIR}: ${admitted.length} admitted, ${parsed} parsed, ${failed} failed`)
if (failures.length) for (const f of failures) console.log(`  parse failure ${f}`)
console.log(`\n${pad("label", 10)}${pad("files", 8)}${pad("analyzer", 11)}${pad("truth", 10)}${pad("matched", 11)}${pad("unexpl", 10)}${pad("missing", 10)}${pad("precision", 12)}recall`)
console.log("-".repeat(96))
for (const label of LABELS) {
  const t = tally.get(label)!
  console.log(`${pad(label, 10)}${pad(String(t.files), 8)}${pad(t.analyzer.toLocaleString(), 11)}${pad(t.truth.toLocaleString(), 10)}${pad(t.matched.toLocaleString(), 11)}${pad(t.unexplainedCount.toLocaleString(), 10)}${pad(t.missingCount.toLocaleString(), 10)}${pad(pct(t.matched, t.analyzer), 12)}${pct(t.matched, t.truth)}`)
}
for (const label of LABELS) {
  const t = tally.get(label)!
  if (!t.unexplained.length && !t.missing.length) continue
  console.log(`\n--- ${label}: up to 40 discrepancies each way ---`)
  if (t.unexplained.length) {
    console.log(`  ANALYZER-ONLY (emitted, no independent derivation reproduces it): ${t.unexplainedCount}`)
    for (const u of t.unexplained) console.log(`    ${u}`)
  }
  if (t.missing.length) {
    console.log(`  TRUTH-ONLY (derived, never emitted): ${t.missingCount}`)
    for (const m of t.missing) console.log(`    ${m}`)
  }
}

const totalUnexplained = LABELS.reduce((a, l) => a + tally.get(l)!.unexplainedCount, 0)
const totalMissing = LABELS.reduce((a, l) => a + tally.get(l)!.missingCount, 0)
console.log(`\nTOTALS over ${parsed} files: unexplained ${totalUnexplained}, missing ${totalMissing}`)

if (OUT) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    lane: "VERIFY_TS",
    oracle: "script/m14/oracles/typescript-imports-exports.ts",
    oracleWiredIntoDifferential: false,
    corpusDir: CORPUS_DIR,
    filesAdmitted: admitted.length,
    filesParsed: parsed,
    filesFailed: failed,
    labels: Object.fromEntries(LABELS.map((l) => [l, {
      files: tally.get(l)!.files,
      analyzer: tally.get(l)!.analyzer,
      truth: tally.get(l)!.truth,
      matched: tally.get(l)!.matched,
      unexplainedCount: tally.get(l)!.unexplainedCount,
      missingCount: tally.get(l)!.missingCount,
      unexplainedSamples: tally.get(l)!.unexplained,
      missingSamples: tally.get(l)!.missing,
    }])),
    totals: { unexplained: totalUnexplained, missing: totalMissing },
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
process.exit(totalUnexplained === 0 && totalMissing === 0 ? 0 : 1)
