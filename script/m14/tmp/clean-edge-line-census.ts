// Dimension 8 (M59.A7) for clean: does every edge now name its site? Measured, not asserted.
//
// Reports, over the lane's whole corpus:
//   * coverage by relationship type — how many edges carry a positive integer line_number;
//   * the fabrication check — no edge may carry 0, a negative, or a non-integer (M59.O2: the
//     contract is "the site line or NULL");
//   * the PER-SITE check — for each (from,type,target) with several edges, the distinct lines must
//     equal the number of edges, i.e. the line is in the dedupe key; a per-set implementation
//     reports one edge per pair and collapses here;
//   * the anchor check — a `contains` edge's line must equal the CHILD's own stored line (#921):
//     that is the anchor the store's resolver reads, so a wrong anchor is worse than no anchor.
//
// Usage: bun script/m14/tmp/clean-edge-line-census.ts [repo...]
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const REPOS = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const repos = REPOS.length ? REPOS : ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"]

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const files: string[] = []
for (const repo of repos) {
  const walk = (d: string) => {
    let entries: string[]
    try { entries = readdirSync(d) } catch { return }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules") continue
      const p = path.join(d, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (e.endsWith(".icl") || e.endsWith(".dcl")) files.push(p)
    }
  }
  walk(path.join(CORPUS, repo))
}

type Row = { type: string; withLine: number; without: number }
const byType = new Map<string, Row>()
let edges = 0, withLine = 0, zero = 0, nonInteger = 0, negative = 0
let groups = 0, perSetViolations = 0, multiSiteEdges = 0
let containsChecked = 0, containsWrongAnchor = 0, containsNoLine = 0
const samples: string[] = []

for (const f of files.sort()) {
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)
  const res = new RealCleanAnalyzer().analyze(tree.rootNode as any, src, f)
  const rels: any[] = res.relationships ?? []

  // The child's own naming line, keyed by owner|name — the #921 anchor. A SET, not a scalar:
  // the same name can be owned twice in one module (two constructors, or a type and an instance
  // class that normalize to one name), and a last-wins map reported 329 correct edges as
  // "wrong anchor" on the first run of this probe. A contains edge is right when its line is the
  // line of SOME declaration of that child, so the check is membership, not equality.
  const ownLine = new Map<string, Set<number>>()
  for (const s of res.symbols ?? []) {
    if (!s.ownerName || s.ownerName === s.name) continue
    const k = `${s.ownerName}|${s.name}`
    const set = ownLine.get(k) ?? new Set<number>()
    if (typeof s.range?.startLine === "number") set.add(s.range.startLine)
    ownLine.set(k, set)
  }

  const count = new Map<string, number>()
  const lines = new Map<string, Set<number>>()

  for (const r of rels) {
    edges++
    const t = String(r.type)
    const row = byType.get(t) ?? { type: t, withLine: 0, without: 0 }
    const ln = r.line_number
    const lnOk = typeof ln === "number" && Number.isInteger(ln) && ln > 0
    if (lnOk) {
      row.withLine++
      withLine++
      const k = `${r.source}|${t}|${r.target}`
      count.set(k, (count.get(k) ?? 0) + 1)
      const set = lines.get(k) ?? new Set<number>()
      set.add(ln)
      lines.set(k, set)
    } else {
      row.without++
      if (ln === 0) zero++
      if (typeof ln === "number" && !Number.isInteger(ln)) nonInteger++
      if (typeof ln === "number" && ln < 0) negative++
      if (!lnOk && ln !== undefined && ln !== null && samples.length < 10) {
        samples.push(`${path.relative(CORPUS, f)} :: ${t} ${r.source} -> ${r.target} carries ${JSON.stringify(ln)}`)
      }
    }
    byType.set(t, row)

    if (t === "contains") {
      const expected = ownLine.get(`${r.source}|${r.target}`)
      if (expected === undefined || expected.size === 0) {
        // An owner/child pair this file's own symbol table does not contain: the edge names a
        // child whose symbol was never published (or carries no range). Counted, not ignored.
        if (typeof ln === "number") containsWrongAnchor++
      } else {
        containsChecked++
        if (typeof ln !== "number" || !expected.has(ln)) {
          containsWrongAnchor++
          if (samples.length < 10) {
            samples.push(`contains anchor wrong: ${path.relative(CORPUS, f)} ${r.source} -> ${r.target} edge line ${ln} vs child lines [${[...expected].join(",")}]`)
          }
        }
      }
      if (typeof ln !== "number") containsNoLine++
    }
  }

  for (const [k, n] of count) {
    groups++
    const distinct = lines.get(k)!.size
    if (distinct > 1) multiSiteEdges += n
    // Per-site: the number of edges for a pair can never exceed its distinct lines.
    if (n > distinct) {
      perSetViolations++
      if (samples.length < 10) samples.push(`per-set: ${path.relative(CORPUS, f)} ${k} has ${n} edges over ${distinct} line(s)`)
    }
  }
}

console.log(`clean edge lines — ${files.length} files, ${edges} edges, ${withLine} with a positive line (${((withLine / edges) * 100).toFixed(1)}%)`)
console.log(`  fabricated values: 0 → ${zero}, negative → ${negative}, non-integer → ${nonInteger}`)
console.log(`  per-site dedupe: ${groups} (from,type,target) groups, ${perSetViolations} where the edges outnumber the distinct lines; ${multiSiteEdges} edges belong to a multi-site group`)
console.log(`  contains anchor (#921): ${containsChecked} checked against the child's own line(s), ${containsWrongAnchor} wrong; ${containsNoLine} without a line (child symbol carries no range)`)
console.log("  by type:")
for (const [, row] of [...byType].sort((a, b) => b[1].withLine - a[1].withLine)) {
  console.log(`    ${row.type.padEnd(14)} ${String(row.withLine).padStart(6)} with line, ${String(row.without).padStart(5)} without`)
}
for (const s of samples) console.log(`  ! ${s}`)
