/**
 * `overrides` — the ORACLE against the ANALYZER, over the whole population.
 *
 * ## Why this one sweeps, where `exports-truth-crosscheck` could read a set
 *
 * `exports` already had a tree-derived denominator (`exports-probe.json`, the audit) that
 * listed the 18 files carrying the label, so its cross-check could target exactly those.
 * `overrides` has no such artifact, and the honest denominator has to be derived here —
 * because a denominator taken from the ANALYZER would be blind to the direction that
 * matters: a file where the oracle derives an override and the analyzer emits none would
 * never be looked at. So the file set is built from the tree, and the analyzer runs on it.
 *
 * ## What is swept, and what is run
 *
 * PHASE 1 (local parser, whole admitted population): every `.php` file admitted by the same
 * rule the census and the exports probe use (`git ls-files` per repo,
 * `detectLanguageFromPath`, files > 512KB skipped). Two things are collected per file:
 *
 *   - the ORACLE's edges (`derivePhpOverridesTruth`, the same one the differential
 *     registers) — the truth side;
 *   - "CANDIDATE": a named type declares a BASE at all. This is the analyzer's own
 *     precondition: `resolveOverrides` looks the base up in a map built from the FILE's
 *     method symbols, so a file whose types declare no base cannot produce an override
 *     edge, and a fabrication is impossible there. Widening the set to "declares a base"
 *     rather than "has a same-file base" is deliberate: it costs a few files and removes
 *     the need to argue that the narrower test is complete.
 *
 * PHASE 2 (`parseFile`, the production entry point): every candidate file, compared row by
 * row against the oracle. A PROJECTION-layer loss would show up here, which is why the
 * production path is used and not the analyzer class.
 *
 * Both directions are reported: `MISSING` (truth with no analyzer row — a lost edge) and
 * `unexplained` (analyzer with no truth row — the fabrication the old state could not
 * distinguish from a real defect). Either must be 0.
 *
 * ## Controls, because every instrument in this lane has now failed open once
 *
 *   - the candidate set must be non-empty (a sweep that found nothing would compare
 *     nothing and pass);
 *   - the truth total must be > 0 — and, stronger, the analyzer's total over the sweep
 *     must equal `perType.overrides.edges` in the committed reason census, so a sweep that
 *     silently narrowed the population fails as a count instead of as a mystery;
 *   - the comparator is run on pairs one edge apart in both directions.
 *
 * Run: npx tsx validation/m14/fixtures/php/overrides-truth-crosscheck.mts
 * Exits non-zero on any mismatch or on a control that does not hold.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { normTarget } from "../../../../script/m14/differential"
import { derivePhpOverridesTruth } from "../../../../script/m14/oracles/php-overrides"

const ROOT = process.cwd()
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

// ---------------------------------------------------------------- phase 1: the sweep
const files: { repo: string; rel: string; abs: string }[] = []
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    files.push({ repo: entry, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm"))))

/** Does any named type in this tree declare a base at all? The analyzer's precondition. */
const declaresAnyBase = (root: any): boolean => {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "class_declaration" || n.type === "interface_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        if (n.namedChild(i)?.type === "base_clause") return true
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return false
}

const truthByFile = new Map<string, string[]>()
const candidates: { label: string; abs: string }[] = []
let swept = 0
for (const f of files) {
  let tree: any
  try {
    tree = parser.parse(readFileSync(f.abs, "utf8"))
  } catch {
    continue
  }
  swept++
  const label = `${f.repo}/${f.rel}`
  const edges = derivePhpOverridesTruth(tree.rootNode)
  if (edges.length > 0) truthByFile.set(label, edges.map((e) => e.target))
  if (edges.length > 0 || declaresAnyBase(tree.rootNode)) candidates.push({ label, abs: f.abs })
  tree.delete?.()
}

console.log("php `overrides` — the oracle against the analyzer, over the whole population")
console.log(`  files swept (local parser)   ${swept}`)
console.log(`  files carrying the oracle    ${truthByFile.size}`)
console.log(`  candidate files (parseFile)  ${candidates.length}`)

// ---------------------------------------------------------------- phase 2: the compare
const compareOverrides = (truthTargets: string[], analyzerTargets: string[]): { missing: number; unexplained: number } => {
  const t = new Set(truthTargets.map((x) => `overrides|${normTarget(x)}`))
  const a = new Set(analyzerTargets.map((x) => `overrides|${normTarget(x)}`))
  let missing = 0
  let unexplained = 0
  for (const k of t) if (!a.has(k)) missing++
  for (const k of a) if (!t.has(k)) unexplained++
  return { missing, unexplained }
}

let truthTotal = 0
let analyzerTotal = 0
let missing = 0
let unexplained = 0
const missingRows: string[] = []
const unexplainedRows: string[] = []
for (const c of candidates) {
  const truth = truthByFile.get(c.label) ?? []
  const result: any = await parseFile(c.abs, "php")
  const analyzerEdges = ((result?.relationships ?? []) as any[]).filter((r) => String(r?.type ?? "") === "overrides")
  const analyzerTargets: string[] = []
  const seenA = new Set<string>()
  for (const r of analyzerEdges) {
    const target = String(r.target ?? "")
    const k = `overrides|${normTarget(target)}`
    if (seenA.has(k)) continue
    seenA.add(k)
    analyzerTargets.push(target)
  }
  truthTotal += truth.length
  analyzerTotal += analyzerTargets.length
  const cmp = compareOverrides(truth, analyzerTargets)
  missing += cmp.missing
  unexplained += cmp.unexplained
  if (cmp.missing > 0) {
    const a = new Set(analyzerTargets.map((x) => normTarget(x)))
    for (const t of truth) if (!a.has(normTarget(t)) && missingRows.length < 20) missingRows.push(`${c.label}: truth overrides -> ${t}`)
  }
  if (cmp.unexplained > 0) {
    const t = new Set(truth.map((x) => normTarget(x)))
    for (const r of analyzerEdges) {
      if (!t.has(normTarget(String(r.target ?? ""))) && unexplainedRows.length < 20) {
        unexplainedRows.push(`${c.label}: analyzer overrides -> ${r.target}  ${JSON.stringify(r.metadata ?? {})}`)
      }
    }
  }
}

console.log(`  truth edges                  ${truthTotal}`)
console.log(`  analyzer edges               ${analyzerTotal}`)
console.log(`  MISSING (truth-only)         ${missing}`)
for (const r of missingRows) console.log(`    ${r}`)
console.log(`  unexplained (analyzer-only)  ${unexplained}`)
for (const r of unexplainedRows) console.log(`    ${r}`)

let failures = 0
const check = (name: string, ok: boolean, detail = ""): void => {
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`)
}
console.log("")
check("the sweep admitted the population", swept > 5000, `${swept} files`)
check("a candidate set exists to analyze", candidates.length > 0, `${candidates.length} files`)
check("the oracle derives something (it is not a vacuous zero)", truthTotal > 0, `${truthTotal} edges`)
check(
  "the analyzer's total equals the committed census's perType.overrides.edges",
  (() => {
    try {
      const census = JSON.parse(readFileSync(path.join(ROOT, "validation/m60/php/reason-census.json"), "utf8"))
      return analyzerTotal === census?.perType?.overrides?.edges
    } catch {
      return false
    }
  })(),
  `${analyzerTotal} vs census`,
)
check("MISSING = 0 (no lost edge)", missing === 0)
check("unexplained = 0 (no fabricated edge)", unexplained === 0)
const c1 = compareOverrides(["CONTROL.NAME"], [])
const c2 = compareOverrides([], ["CONTROL.NAME"])
const c3 = compareOverrides(["CONTROL.NAME"], ["CONTROL.NAME"])
check("control: a truth-only edge IS reported as MISSING", c1.missing === 1 && c1.unexplained === 0, JSON.stringify(c1))
check("control: an analyzer-only edge IS reported as unexplained", c2.missing === 0 && c2.unexplained === 1, JSON.stringify(c2))
check("control: a matched pair reports neither", c3.missing === 0 && c3.unexplained === 0, JSON.stringify(c3))

console.log("")
if (failures > 0) {
  console.log(`FAIL — ${failures} check(s) failed`)
  process.exit(1)
}
console.log(`PASS — ${truthTotal} truth edge(s) and ${analyzerTotal} analyzer edge(s) agree across ${candidates.length} candidate file(s)`)
