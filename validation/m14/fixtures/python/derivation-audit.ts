/**
 * PY-DERIVATION — which of this lane's emitted relationship types the master's
 * differential never audits, with the edge count for each.
 *
 * ## Why this file exists
 *
 * A DERIVATION finding is a type the analyzer EMITS that the differential never audits:
 * stored, and compared against nothing. The workstream counts 100 of them across 34
 * lanes and calls the payoff for paying them down "as valuable as adding anything,
 * because an unverified edge ships a bug invisibly".
 *
 * The gate that finds them is `script/m14/verify-label-coverage.ts`. It cannot measure
 * this lane. Measured 2026-10-05:
 *
 *     $ bun script/m14/verify-label-coverage.ts
 *     # skipped (not a pass): ... python (no files under cython) ...
 *     FAIL — 9 undeclared gap(s) across 8 lane(s)
 *
 * `cython` is not a directory on this disk. `LANG_REPOS.python = "cython"` in
 * `script/m14/differential.ts` (line 455), with `LANG_REPOS_SECOND.python = "requests"`
 * at line 613, and both repos now live INSIDE `bb_tests/repositories/python-corpus/`.
 * The corpus was reorganised into an aggregate and the shared pins were never moved, so
 * the lane is skipped by the one gate whose job is to report its un-audited output. That
 * is the SAME root cause as the other three dead python instruments: `firing-check.mjs`
 * points at a `python-codesql` that never existed, `firing-check-v2.mjs` has no PYTHON
 * lane at all, and `ontology-coverage-gate.ts` admits only git-tracked TOP-LEVEL
 * directories and so sees 424 stray `.py` instead of the 5,365 real ones.
 *
 * All four are supervisor-owned and none is edited here. This is the lane-owned
 * measurement that stands in for the gate, and it reports the fix the master needs.
 *
 * ## How the allowlist is obtained
 *
 * The allowlist is EXTRACTED from `script/m14/differential.ts` and EVALUATED for
 * `lang === "python"` — never copied. A hand-kept list of labels is a defect the moment
 * the harness changes, and it would make this report a claim about a list rather than
 * about the harness. If the extraction marker moves, this throws rather than guessing.
 *
 * Both SIDES are extracted, because "audited" needs both: a label is compared only if it
 * survives the analyzer-side filter AND the truth-side filter. A label the analyzer
 * emits, the analyzer-side admits, and the truth side has no oracle for is exactly the
 * DERIVATION case.
 *
 * ## Population
 *
 * Derived from `readdir` over `bb_tests/repositories/python-corpus/` filtered to git
 * checkouts — the same rule `python-ontology-census.ts` uses, so the two agree. Stride
 * sampled, and the SAMPLE SIZE IS PRINTED beside every count: the honesty contract's
 * population rule, and the fire-and-forget failure the 2026-10-04 review recorded (Ruby
 * read 1/10 at NFILES=25 and 8/10 at NFILES=200 on the same analyzer and corpus).
 *
 * ## No regex
 *
 * Corpus selection is `endsWith` on extensions; the allowlist is read by bracket
 * matching and evaluated. Nothing matches source text.
 *
 * Usage:
 *   bun run validation/m14/fixtures/python/derivation-audit.ts --files 400
 *   bun run validation/m14/fixtures/python/derivation-audit.ts --json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const PY_CORPUS = path.join(CR, "python-corpus")

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const fi = argv.indexOf("--files")
const LIMIT = fi >= 0 ? Number(argv[fi + 1]) || 0 : 400

const diffSrc = readFileSync(path.join(ROOT, "script", "m14", "differential.ts"), "utf8")

/**
 * The balanced array literal that starts at the first `[` at or after `from`.
 *
 * There is ONE compared-label list in this harness, not two. The analyzer-side filter
 * (`.filter((r: any) => ["extends", "implements", "instantiates", ...`) and the
 * truth-side allowlist are spread into the SAME array literal: the truth side's zig and
 * python clauses sit INSIDE the analyzer side's brackets, because the 2026-10-02
 * consolidation took a UNION of the two. So a label is compared when this list keeps it.
 * `implements` appearing in the list for python is not a python claim — that entry is
 * unconditional in the harness and python emits zero `implements`.
 *
 * Two earlier extractions of this were wrong and both are worth recording. The first
 * scanned BACKWARD from the truth-side marker for an unmatched `[` and returned the
 * analyzer-side array, because the truth spreads are inside it. The second used
 * `indexOf("=>")` from a marker that is a bare `...(cond ? [...] : [])` spread with no
 * arrow of its own, so it evaluated 719 characters of unrelated code from a different
 * statement. The second failed loudly, which is the only reason it was caught; a wrong
 * list that happened to parse would have been worse.
 */
function extractArrayFrom(src: string, from: number, what: string): string {
  const open = src.indexOf("[", from)
  if (open < 0) throw new Error(`${what}: no array literal found in differential.ts`)
  let d = 0
  let inStr: string | null = null
  let inLine = false
  let inBlock = false
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === "\n") inLine = false; continue }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++ } continue }
    if (inStr) { if (c === "\\") { i++; continue } if (c === inStr) inStr = null; continue }
    if (c === "/" && n === "/") { inLine = true; i++; continue }
    if (c === "/" && n === "*") { inBlock = true; i++; continue }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue }
    if (c === "[" || c === "(" || c === "{") { d++; continue }
    if (c === "]" || c === ")" || c === "}") { d--; if (d === 0 && c === "]") return src.slice(open, i + 1) }
  }
  throw new Error(`${what}: array literal end not found in differential.ts`)
}

const COMPARED_MARK = '.filter((r: any) => ["extends", "implements", "instantiates"'
const cAt = diffSrc.indexOf(COMPARED_MARK)
if (cAt < 0)
  throw new Error(
    "compared-label allowlist: marker not found in differential.ts — the harness changed shape and this report would be stale",
  )
const COMPARED_EXPR = extractArrayFrom(diffSrc, cAt, "compared-label allowlist")
const compared = [
  ...new Set((new Function("lang", `return ${COMPARED_EXPR}`) as (l: string) => string[])("python")),
]

// ---- population, derived
function isCheckout(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function population(): string[] {
  const out: string[] = []
  let names: string[]
  try {
    names = readdirSync(PY_CORPUS).sort()
  } catch {
    return out
  }
  for (const name of names) {
    const dir = path.join(PY_CORPUS, name)
    try {
      if (!statSync(dir).isDirectory() || !isCheckout(dir)) continue
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) if (rel.endsWith(".py") || rel.endsWith(".pyi")) out.push(path.join(dir, rel))
  }
  return out
}

const all = population()
if (all.length === 0) {
  console.error(`derivation-audit: no corpus under ${PY_CORPUS}`)
  process.exit(2)
}
let sample = all
let sampled = false
if (LIMIT > 0 && all.length > LIMIT) {
  const stride = Math.max(1, Math.floor(all.length / LIMIT))
  sample = []
  for (let i = 0; i < all.length && sample.length < LIMIT; i += stride) sample.push(all[i])
  sampled = true
}

// ---- production path: getParser -> parse -> analyze
const { getParser } = await import(path.join(ROOT, "src/ast", "engine.ts"))
const { RealPythonAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-python-analyzer.ts"))
const parser = await getParser("python")

const tally = new Map<string, number>()
const filesByLabel = new Map<string, Set<string>>()
let parsed = 0
let failed = 0
for (const f of sample) {
  try {
    const src = readFileSync(f, "utf8")
    const pr = await parser.parse(src, f)
    const res: any = new RealPythonAnalyzer().analyze(pr.rootNode, src, f)
    parsed++
    for (const r of res.relationships ?? []) {
      const label = String(r.type ?? r.relationshipType ?? "")
      if (label.length === 0) continue
      tally.set(label, (tally.get(label) ?? 0) + 1)
      if (!filesByLabel.has(label)) filesByLabel.set(label, new Set())
      filesByLabel.get(label)!.add(f)
    }
  } catch {
    failed++
  }
}

const ALL_TEN = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const emitted = ALL_TEN.filter((l) => (tally.get(l) ?? 0) > 0)
// A DERIVATION finding: emitted, admitted on the analyzer side, and NOT compared.
const derivation = emitted.filter((l) => !compared.includes(l))
// Also reported: emitted, audited, and carrying no reason code in the lane spec.
const droppedByAnalyzerSide: string[] = []
// And: compared even though this lane emits nothing (a denominator the lane cannot fill).
const silentButCompared = compared.filter((l) => (tally.get(l) ?? 0) === 0)

const out = {
  corpusRoot: PY_CORPUS,
  populationTracked: all.length,
  sample: sample.length,
  sampleLimited: sampled,
  parsed,
  failed,
  allowlist: {
    source: "script/m14/differential.ts (extracted and evaluated, not copied)",
    compared,
  },
  emitted: Object.fromEntries(emitted.map((l) => [l, { edges: tally.get(l) ?? 0, files: filesByLabel.get(l)?.size ?? 0 }])),
  silent: ALL_TEN.filter((l) => (tally.get(l) ?? 0) === 0),
  derivation,
  silentButCompared,
}

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 1))
  process.exit(0)
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`python DERIVATION audit`)
console.log(`corpus root:   ${PY_CORPUS}`)
console.log(`POPULATION:    ${all.length} tracked .py/.pyi`)
console.log(`SAMPLE:        ${sample.length}${sampled ? ` (stride-limited from ${all.length})` : " (the whole population)"}  parsed ${parsed}  unread ${failed}`)
console.log(`allowlist:     EXTRACTED from script/m14/differential.ts and evaluated for lang="python"`)
console.log(`  COMPARED:      ${compared.join(" ") || "(none)"}\n`)

console.log(`${pad("type", 14)}${pad("edges", 9)}${pad("files", 7)}verdict`)
console.log("-".repeat(70))
for (const l of ALL_TEN) {
  const n = tally.get(l) ?? 0
  const verdict = n === 0 ? (compared.includes(l) ? "silent, but COMPARED" : "silent") : compared.includes(l) ? "EMITTED + audited" : "DERIVATION (unaudited)"
  console.log(`${pad(l, 14)}${pad(String(n), 9)}${pad(String(filesByLabel.get(l)?.size ?? 0), 7)}${verdict}`)
}
const unauditedEdges = derivation.reduce((a, l) => a + (tally.get(l) ?? 0), 0)
const totalEmitted = emitted.reduce((a, l) => a + (tally.get(l) ?? 0), 0)
console.log(`\nDERIVATION findings: ${derivation.length} label(s) — ${derivation.join(" ") || "(none)"}`)
console.log(`unaudited edges:     ${unauditedEdges} of ${totalEmitted} emitted (${totalEmitted ? ((unauditedEdges / totalEmitted) * 100).toFixed(1) : "0"}%)`)
if (silentButCompared.length) console.log(`silent but compared (the lane cannot fill these denominators): ${silentButCompared.join(" ")}`)