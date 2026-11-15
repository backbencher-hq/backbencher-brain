/**
 * How many TRUTH rows carry the placeholder literal `unknown` as an endpoint —
 * the price of the analyzer obeying M60 rule R7 without the harness doing the same.
 *
* ## Why this is measured rather than argued
 *
 * The analyzer no longer publishes a relationship whose source or target is the
 * literal `unknown`. That side is measured by the ANALYZER, on the full proxicall
 * file set with the filter removed: 40 rows (`BB_DART_REPOS=proxicall
 * BB_DART_PER_REPO=2400 …/census.ts`), 0 with the filter. See
 * `R7_PLACEHOLDER_NAME` in `src/ast/real-dart-analyzer.ts`.
 *
 * This file measures the OTHER side, and the two numbers must not be added or
 * confused: it counts rows the DIFFERENTIAL's oracles derive that name `unknown`.
 * Those rows are not analyzer rows — `deriveDartEdges` never produced 19 of them on
 * 1,167 files — they are truth rows, and they are not the same population.
 *
 * The point of counting them is the ASYMMETRY. The differential matches on
 * (label, target) — `script/m14/differential.ts` line ~23479 — so a truth row naming
 * `unknown` with no analyzer counterpart reads MISSING on any sample containing the
 * file. That is a loss the analyzer did not make: the analyzer never published the
 * row. A gate that reports a loss that did not happen is worse than a gate that
 * reports a placeholder, because a reader cannot tell them apart without re-deriving
 * both. The symmetric fix is the one the harness already applies to the EMPTY
 * endpoint case, immediately above the comparison: TRUTH may not assert an edge that
 * names nothing, and the rule is applied to BOTH sides so neither can turn it into a
 * false gap. This file is the measurement that says the same rule is needed for the
 * literal case.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/dart/r7-truth-cost.ts
 *   BB_DART_PER_REPO=200 npx tsx validation/m14/fixtures/dart/r7-truth-cost.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_DART_REPOS ?? "proxicall,dart-http,riverpod,flutter-packages,dart-sdk").split(",").filter(Boolean)
const PER_REPO = Number(process.env.BB_DART_PER_REPO ?? 100)

const differential: any = await import("../../../../script/m14/differential")
const containsOracle: any = await import("../../../../script/m14/oracles/dart-contains")
const importsOracle: any = await import("../../../../script/m14/oracles/dart-imports")
const overridesOracle: any = await import("../../../../script/m14/oracles/dart-overrides")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

const files: { repo: string; rel: string; abs: string }[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean).sort()
  } catch { continue }
  const stride = Math.max(1, Math.floor(tracked.length / PER_REPO))
  for (let i = 0; i < tracked.length && files.length < 4000; i += stride) {
    const abs = path.join(dir, tracked[i])
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    files.push({ repo, rel: tracked[i], abs })
  }
}

const byLabel = new Map<string, number>()
const examples: string[] = []
let total = 0
for (const f of files) {
  let src: string
  try { src = readFileSync(f.abs, "utf8") } catch { continue }
  const tree = parser.parse(src)
  if (!tree) continue
  const rows: { label: string; from: string; target: string }[] = []
  for (const e of differential.deriveDartEdges(tree.rootNode)) rows.push(e)
  for (const e of containsOracle.deriveDartContainsTruth(tree.rootNode)) rows.push(e)
  for (const e of importsOracle.deriveDartImportsTruth(tree.rootNode, f.abs)) rows.push(e)
  for (const e of overridesOracle.deriveDartOverridesTruth(tree.rootNode)) rows.push(e)
  for (const r of rows) {
    if (String(r.from) === "unknown" || String(r.target) === "unknown") {
      total++
      byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + 1)
      if (examples.length < 12) examples.push(`${r.label.padEnd(10)} ${r.from} -> ${r.target}   ${f.repo}/${f.rel}`)
    }
  }
}

console.log(`truth rows carrying the placeholder literal "unknown" — ${files.length} files across ${REPOS.length} repos`)
console.log(`total ${total}`)
for (const [k, v] of [...byLabel].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${v}`)
for (const e of examples) console.log("  " + e)
console.log(`\nThese are ORACLE rows, not analyzer rows. The analyzer publishes 0 rows whose endpoint is`)
console.log(`the literal (measured on all 2,351 tracked proxicall files with its filter removed: 40`)
console.log(`rows, all of them \`X.unknown(...)\` on a cross-file type; with the filter: 0). Every truth`)
console.log(`row above therefore reads MISSING in the differential, and none of them is a loss the`)
console.log(`analyzer made — the differential needs the same empty-endpoint rule applied to both sides.`)