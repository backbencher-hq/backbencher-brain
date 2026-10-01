#!/usr/bin/env bun
/**
 * Edge-OWNER audit — the blind spot the F5 differential has by construction.
 *
 * WHY. The differential decides whether an analyzer edge is explained with:
 *
 *     truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || …))
 *
 * Label and TARGET. The edge's SOURCE — which scope owns the read, which class the
 * `contains` hangs off — is not compared at all. So an edge attached to the WRONG OWNER
 * counts as covered whenever truth happens to derive a row with the same target, which is
 * almost always, because the read itself is real.
 *
 * D13 is what made that concrete. The differential reported ONE unexplained edge on
 * abseil-cpp (`uses param_type -> b`). The defect actually gates **94 sites** across the
 * C++ corpora — every read inside a friend function definition that the walk attached to
 * the enclosing class instead of to the friend. 91 of 94 were invisible to `unexplained`.
 *
 * So a clean `unexplained=0` means the analyzer's edge SET agrees with truth. It says
 * nothing about whether each edge is attached to the right owner, and that is half of what
 * a relationship means.
 *
 * WHAT THIS DOES. For every analyzer edge, find the truth rows with the same label and
 * target. If there are none, the differential already reports it and this tool skips it.
 * If there ARE, and the analyzer's source is not among them, that is an OWNER DISAGREEMENT —
 * a class of defect no existing gate can see, counted here for the first time.
 *
 * It is a MEASUREMENT, not a gate on a threshold. The counts are the finding: a disagreement
 * count of zero would mean owner agreement is exact, and any non-zero number is a rank of
 * work nobody has enumerated. Deliberately not wired into `verify`, for the same reason
 * `ast-walk-cost.ts` is not: a permanently-red gate trains people to ignore red, and this
 * one is red on first run by construction.
 *
 * USAGE
 *   bun run script/m14/edge-owner-audit.ts
 *   bun run script/m14/edge-owner-audit.ts --repo nlohmann-json --json
 *   BB_ORACLE_MODULE=/path/to/differential.ts bun run script/m14/edge-owner-audit.ts
 *
 * `BB_ORACLE_MODULE` exists because `script/m14/differential.ts` is shared and may be
 * mid-edit by another lane; point this at a known-good copy rather than editing the shared
 * file to make a probe run.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ORACLE = process.env.BB_ORACLE_MODULE ?? join(import.meta.dir, "differential.ts")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"

const argv = process.argv.slice(2)
const asJson = argv.includes("--json")
const onlyRepo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : null
const REPOS = (
  onlyRepo ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog"
).split(",").map((s) => s.trim())

const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
function walk(d: string, o: string[] = []): string[] {
  for (const e of readdirSync(d)) {
    if (SKIP.has(e)) continue
    const p = join(d, e)
    let s
    try {
      s = statSync(p)
    } catch {
      continue
    }
    if (s.isDirectory()) walk(p, o)
    else if (EXTS.some((x) => p.endsWith(x)) && s.size > 0) o.push(p)
  }
  return o
}

const { ASTEngine } = await import("../../src/ast/engine")
const { parseFile } = await import("../../src/ast/engine")
const oracle: any = await import(ORACLE)

/**
 * The cpp truth, assembled from the same exported oracles the differential uses.
 *
 * CRITICAL, and it is why the first version of this tool measured nothing: for `calls`
 * and `uses` the oracle emits `from: "(expr)"`. That is a CATEGORY LABEL — "this edge came
 * from expression context" — not the scope that owns the read. Comparing an analyzer's
 * `source` against it is comparing a scope name to a placeholder, so every edge disagreed
 * and the tool reported 100%, which is a number about the tool and not about the analyzer.
 *
 * So the map records, per (label, target), the truth owners ONLY where truth actually has
 * one, and `"(expr)"` is dropped rather than treated as an owner. The consequence is stated
 * in the output rather than hidden: for `calls` and `uses` there is NO oracle for edge
 * ownership at all, so owner agreement is UNMEASURABLE there, and this tool can only speak
 * to the structural labels where truth does name an owner.
 */
function truthFor(root: any): Map<string, Set<string>> {
  const byTarget = new Map<string, Set<string>>()
  const add = (label: string, from: string, target: string) => {
    if (!target) return
    if (from === "(expr)") return // a category label, not an owner — see the note above
    const k = `${label}|${target}`
    let set = byTarget.get(k)
    if (!set) byTarget.set(k, (set = new Set()))
    set.add(String(from))
  }
  // contains / extends carry a real owner in truth: the class or type they hang off.
  for (const e of oracle.deriveTreeEdges?.(root, "cpp") ?? []) add(e.label, e.from, e.target)
  for (const e of oracle.deriveCppEdges?.(root) ?? []) add(e.label, e.from, e.target)
  for (const e of oracle.deriveCppBareUses?.(root) ?? []) add(e.label, e.from, e.target)
  return byTarget
}

interface Row {
  repo: string
  file: string
  type: string
  analyzerSource: string
  truthSources: string[]
  target: string
  line: number
}

const rows: Row[] = []
let files = 0, edges = 0, explained = 0, noTruthRow = 0, ownerComparable = 0

for (const repo of REPOS) {
  for (const f of walk(join(CORPUS, repo))) {
    let r: any, tree: any
    try {
      r = await parseFile(f, readFileSync(f, "utf8"))
      ;({ tree } = await ASTEngine.parseTree(f, readFileSync(f, "utf8")))
    } catch {
      continue
    }
    files++
    const truth = truthFor(tree.rootNode)
    for (const x of r.relationships ?? []) {
      const label = String(x.type)
      const target = String(x.target)
      edges++
      const owners = truth.get(`${label}|${target}`)
      if (!owners) {
        // The differential already reports this as MISSING-side/unexplained.
        noTruthRow++
        continue
      }
      explained++
      ownerComparable++
      if (!owners.has(String(x.source))) {
        rows.push({
          repo,
          file: f.replace(`${CORPUS}/`, ""),
          type: label,
          analyzerSource: String(x.source),
          truthSources: [...owners].sort(),
          target,
          line: Number(x.line_number ?? -1),
        })
      }
    }
  }
}

const byPair = new Map<string, number>()
for (const r of rows) {
  const k = `${r.type}  ${r.analyzerSource}  !=  ${r.truthSources.join("|")}`
  byPair.set(k, (byPair.get(k) ?? 0) + 1)
}

if (asJson) {
  console.log(JSON.stringify({ files, edges, explained, noTruthRow, ownerComparable, disagreements: rows.length, caveat: "truth names an owner only for contains/extends; calls/uses ownership is unmeasured", byPair: Object.fromEntries([...byPair].sort((a, b) => b[1] - a[1])) }, null, 2))
} else {
  console.log(`\nedge-OWNER audit — the differential matches on label+target and ignores the source.\n`)
  console.log(`  files=${files}  analyzer edges=${edges}  with a truth row=${explained}  with none (differential's side)=${noTruthRow}`)
  const withOwner = rows.length
  console.log(`\n  OWNER DISAGREEMENTS: ${withOwner}  (${(100 * withOwner / Math.max(1, ownerComparable)).toFixed(2)}% of edges whose label has a truth OWNER)`)
  console.log(
    `\n  READ THIS BEFORE THE NUMBERS: truth names an owner only for the STRUCTURAL labels`,
  )
  console.log(`  (contains, extends). For \`calls\` and \`uses\` the oracle emits \`from: "(expr)"\`, which is a`)
  console.log(`  category label rather than a scope, so there is NO oracle for edge ownership on those and this`)
  console.log(`  tool says nothing about them. Owner agreement on calls/uses is UNMEASURED — not zero.`)
  if (rows.length > 0) {
    console.log(`\n  by shape (analyzer owner != truth owner), worst first:`)
    for (const [k, v] of [...byPair].sort((a, b) => b[1] - a[1]).slice(0, 25))
      console.log(`    ${String(v).padStart(5)}  ${k}`)
    console.log(`\n  first 12 sites:`)
    for (const r of rows.slice(0, 12))
      console.log(`    ${r.repo}/${r.file}:${r.line}  ${r.type} ${r.analyzerSource} -> ${r.target}   truth owner(s): ${r.truthSources.join(", ")}`)
  }
}