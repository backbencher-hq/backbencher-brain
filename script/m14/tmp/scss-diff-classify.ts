/**
 * Classify the SCSS differential's residual divergence, by CAUSE and with counts.
 *
 *   bun script/m14/tmp/scss-diff-classify.ts [--files N]
 *
 * WHY THIS EXISTS
 *
 * `differential.ts` reports two numbers — `MISSING` (truth rows the analyzer does not
 * emit) and `unexplained` (analyzer edges the truth lacks) — and those numbers alone
 * are not actionable. 114 is a workload; "114 rows, of which 31 are a rule whose `&`
 * names a call site outside the file, 60 are the declared unresolvable-`var()` class
 * and 23 are one shared modelling difference" is a work PLAN, and the difference
 * between the two is whether the next hour goes somewhere useful.
 *
 * So this walks the same pairs the differential walks and labels each divergence with
 * the reason it is a divergence, where a reason is derivable from the two names and the
 * source text. A row that cannot be labelled is counted as `unclassified` and printed,
 * because a classifier that silently drops what it cannot explain is the same defect
 * as a gate that silently passes what it cannot test.
 *
 * It is READ-ONLY. It measures; it never changes an analyzer, an oracle, or a
 * threshold, and it writes no evidence artifact — the differential is the authority on
 * the verdict and this only says which class the residue belongs to.
 */

import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { Parser as TSParser, Language } from "web-tree-sitter"
import { ASTEngine } from "../../../src/ast/engine"
import { deriveCssEdges, deriveScssEdges } from "../differential"

const argv = process.argv.slice(2)
const N = argv.includes("--files") ? parseInt(argv[argv.indexOf("--files") + 1]) : 60
const ROOT = "/home/ishaq2321/bb_tests/repositories/element-plus"
const COMPARABLE = ["uses", "references", "imports", "contains"]

await TSParser.init()
const parser = new TSParser()
parser.setLanguage(await Language.load("wasm/tree-sitter-scss.wasm"))

const files: string[] = []
;(function walk(dir: string, depth = 0) {
  if (depth > 12) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (["node_modules", ".git", "dist", "build"].includes(e)) continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, files, depth + 1)
    else if (e.endsWith(".scss") && st.size > 0) files.push(p)
  }
})(ROOT)
files.sort()

type Class = {
  n: number
  example: string[]
}

const missing = new Map<string, Class>()
const unexp = new Map<string, Class>()
const bump = (m: Map<string, Class>, k: string, sample: string) => {
  const c = m.get(k) ?? { n: 0, example: [] }
  c.n++
  if (c.example.length < 1) c.example.push(sample)
  m.set(k, c)
}

/**
 * The reason a row diverges, decided from the two endpoint names and the source.
 *
 * Deliberately conservative: an unlabelled row is reported as `unclassified` rather
 * than forced into the nearest class, because a wrong label sends the next hour at the
 * wrong thing and looks like progress while it does it.
 */
function classify(
  side: "missing" | "unexplained",
  label: string,
  target: string,
  truth: Set<string>,
  actual: Set<string>,
  src: string,
): string {
  const isCustomProp = target.startsWith("--")
  const isScssVar = target.startsWith("$")
  const hasAmp = target.includes("&")
  const hasInterp = target.includes("#{")

  if (side === "unexplained" && isCustomProp) {
    // The analyzer emits a `var(--x)` read unconditionally; the oracle only derives a
    // read whose property the file declares. DECLARED (SCSS-L6).
    return "declared-unresolvable-custom-property"
  }
  if (side === "unexplained" && isScssVar) {
    return "scss-variable-read-not-derived"
  }
  if (hasAmp) return side === "missing" ? "truth-kept-a-raw-ampersand" : "analyzer-name-kept-a-raw-ampersand"
  if (hasInterp) return "interpolated-selector-naming"
  if (label === "imports") return "import-target-spelling"
  if (label === "contains") {
    // a containment the truth does not model: a reset-suppressed selector, or a
    // selector-chain edge whose endpoints the oracle does not derive
    return "containment-not-modelled"
  }
  return "unclassified"
}

let truthTotal = 0
let actualTotal = 0
let covered = 0
for (const f of files.slice(0, N)) {
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)
  const mod = f.split("/").pop()!.replace(/\.[^.]+$/, "")
  const truth = new Set<string>()
  for (const e of [...deriveCssEdges(tree.rootNode, mod), ...deriveScssEdges(tree.rootNode)]) {
    if (COMPARABLE.includes(e.label)) truth.add(`${e.label}|${e.target}`)
  }
  const r: any = await ASTEngine.parseFile(f, src)
  const actual = new Set<string>()
  for (const x of r.relationships ?? []) if (COMPARABLE.includes(String(x.type))) actual.add(`${x.type}|${x.target}`)

  truthTotal += truth.size
  actualTotal += actual.size
  for (const k of truth) if (actual.has(k)) covered++
  const rel = f.replace(ROOT + "/", "")
  for (const k of truth) {
    if (actual.has(k)) continue
    const [label, target] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)]
    bump(missing, classify("missing", label, target, truth, actual, src), `${label} -> ${target}  (${rel})`)
  }
  for (const k of actual) {
    if (truth.has(k)) continue
    const [label, target] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)]
    bump(unexp, classify("unexplained", label, target, truth, actual, src), `${label} -> ${target}  (${rel})`)
  }
}

const show = (title: string, m: Map<string, Class>) => {
  console.log(`\n${title}`)
  const total = [...m.values()].reduce((a, c) => a + c.n, 0)
  if (total === 0) {
    console.log("  (none)")
    return
  }
  for (const [k, c] of [...m].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(c.n).padStart(4)}  ${k}`)
    for (const e of c.example) console.log(`          ${e}`)
  }
}

console.log(`scss differential residue over ${Math.min(N, files.length)} of ${files.length} element-plus .scss files`)
console.log(`  truth ${truthTotal}  analyzer ${actualTotal}  covered ${covered} (${((100 * covered) / Math.max(truthTotal, 1)).toFixed(1)}%)`)
show(`MISSING — truth the analyzer does not emit (${[...missing.values()].reduce((a, c) => a + c.n, 0)})`, missing)
show(`UNEXPLAINED — analyzer edges the truth lacks (${[...unexp.values()].reduce((a, c) => a + c.n, 0)})`, unexp)
