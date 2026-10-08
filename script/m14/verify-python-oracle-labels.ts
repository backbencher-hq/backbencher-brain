// VERIFY_PY10 — prove `PYTHON_ORACLE_LABELS` is what the oracle DERIVES.
//
// WHY THIS FILE EXISTS. `script/m60/rel-type-coverage-gate.ts` prefers a lane's own
// exported label list over the shared filter, which is how ruby repaid its two DERIVATION
// debts. It cannot reach python's: the gate reads `script/m14/python-truth.ts` and the
// oracle lives at `script/m14/oracles/python-truth.ts`, so the read returns null and the
// gate falls back to a filter that cannot see `contains`, `exports` or `imports` — the
// three registered python DERIVATION findings in
// validation/m60/rel-type-coverage-baseline.json.
//
// An exported label list is only better than the shared filter if it is TRUE, and a
// hand-written list is a stale list read as a current one — a worse failure than an empty
// set, because an empty set is visible and a stale one is not. So this runs the oracle
// over a real corpus and asserts the declared set equals the OBSERVED set, in both
// directions:
//
//   declared but never derived  -> FAIL (the list claims an audit that does not happen)
//   derived but not declared    -> FAIL (the list is incomplete; the gate would still
//                                  under-report this lane's coverage)
//
// Usage: bun script/m14/verify-python-oracle-labels.ts [NFILES]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || process.cwd()
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const NFILES = Number(process.argv[2] || 400)
const EXTS = [".py", ".pyi"]
const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "build", "dist", ".tox", "vendor",
  "__pycache__", ".mypy_cache", ".venv", "venv", "htmlcov", ".eggs",
])
const SIGNAL = ["def ", "class ", "import ", "@", "lambda "]

function derivePopulation(): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 24) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1)
        continue
      }
      let isPy = false
      for (const x of EXTS) if (e.name.endsWith(x)) { isPy = true; break }
      if (!isPy) continue
      let st
      try { st = statSync(p) } catch { continue }
      if (!st.isFile() || st.size >= 400_000) continue
      let c = ""
      try { c = readFileSync(p, "utf8") } catch { continue }
      let bearing = false
      for (const s of SIGNAL) if (c.includes(s)) { bearing = true; break }
      if (bearing) out.push(p)
    }
  }
  walk(CORPUS, 0)
  out.sort()
  return out
}

const wts: any = await import("web-tree-sitter")
const wdir = join(REPO, "node_modules", "web-tree-sitter")
await wts.Parser.init({
  locateFile: () =>
    ["tree-sitter.wasm", "web-tree-sitter.wasm"]
      .map((f) => join(wdir, f))
      .find((f) => { try { statSync(f); return true } catch { return false } })!,
})
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(readFileSync(join(REPO, "wasm/tree-sitter-python.wasm"))))
const { derivePythonTruth, PYTHON_ORACLE_LABELS } = await import(
  join(REPO, "script/m14/oracles/python-truth")
)
// The shim the DERIVATION gate actually reads carries its OWN inline literal, because that
// gate resolves the array with a regex and cannot follow a re-export. So the shim's list is
// a restatement and has to be checked separately — a stale restatement is the failure this
// file exists to catch, and there are now two lists where there was one.
const { PYTHON_TRUTH_ORACLE_LABELS } = await import(join(REPO, "script/m14/python-truth"))

const population = derivePopulation()
const sample: string[] = []
const n = Math.min(NFILES, population.length)
for (let i = 0; i < n; i++) sample.push(population[Math.floor((i * population.length) / n)])

const observed = new Map<string, number>()
let files = 0
for (const f of sample) {
  let content = ""
  try { content = readFileSync(f, "utf8") } catch { continue }
  let root: any
  try { root = parser.parse(content).rootNode } catch { continue }
  const stem = f.split("/").pop() ?? "module"
  const dot = stem.lastIndexOf(".")
  const moduleScope = dot > 0 ? stem.slice(0, dot) : stem
  for (const e of derivePythonTruth(root, moduleScope)) {
    observed.set(e.type, (observed.get(e.type) ?? 0) + 1)
  }
  files++
}

const declared = new Set<string>(PYTHON_ORACLE_LABELS)
const seen = new Set<string>(observed.keys())
const phantom = [...declared].filter((l) => !seen.has(l)).sort()
const undeclared = [...seen].filter((l) => !declared.has(l)).sort()

console.log(`verify-python-oracle-labels`)
console.log(`population (derived by readdir): ${population.length} code-bearing .py/.pyi`)
console.log(`sample: ${sample.length} files, ${files} parsed by the oracle`)
console.log(`declared (${declared.size}): ${[...declared].sort().join(" ")}`)
console.log(`observed (${seen.size}): `)
for (const [k, v] of [...observed.entries()].sort()) console.log(`   ${k.padEnd(14)} ${v}`)

// canonical vs shim, first: if these two disagree the gate reads the wrong one.
const shim = new Set<string>(PYTHON_TRUTH_ORACLE_LABELS)
const shimOnly = [...shim].filter((l) => !declared.has(l)).sort()
const canonicalOnly = [...declared].filter((l) => !shim.has(l)).sort()
if (shimOnly.length > 0 || canonicalOnly.length > 0) {
  console.log(`\nFAIL — the shim the DERIVATION gate reads DISAGREES with the canonical list:`)
  if (shimOnly.length) console.log(`   only in script/m14/python-truth.ts      : ${shimOnly.join(" ")}`)
  if (canonicalOnly.length) console.log(`   only in oracles/python-truth.ts      : ${canonicalOnly.join(" ")}`)
  console.log(`   The gate reads the SHIM, so the shim is the list that counts.`)
  process.exit(1)
}

if (phantom.length > 0) {
  console.log(`\nFAIL — declared but NEVER derived over ${files} real files: ${phantom.join(" ")}`)
  console.log(`  A label the gate would count as audited, that no run produces, is a claim about`)
  console.log(`  an audit that does not happen.`)
  process.exit(1)
}
if (undeclared.length > 0) {
  console.log(`\nFAIL — derived but NOT declared: ${undeclared.join(" ")}`)
  console.log(`  The gate would under-report this lane's coverage, which is the DERIVATION defect`)
  console.log(`  this whole exercise exists to remove.`)
  process.exit(1)
}
console.log(`\nshim (script/m14/python-truth.ts, what the gate reads): identical to the canonical list`)
console.log(`PASS — declared == observed, in both directions, over ${files} real files.`)