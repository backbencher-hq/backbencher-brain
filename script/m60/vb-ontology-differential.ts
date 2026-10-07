/**
 * VB ONTOLOGY DIFFERENTIAL — analyzer edges against the lane's own truth oracle,
 * per label, over the whole corpus.
 *
 * This is the answer to ONTOLOGY-WORKSTREAM Part 1 question 3 ("does an independent
 * oracle agree?"), and it is also the instrument that makes the DERIVATION finding
 * closable: before `script/m14/vb-truth.ts` existed, VB's `calls`, `contains`,
 * `imports` and `references` were emitted and audited by nobody.
 *
 * WHAT IT DOES AND DOES NOT PROVE, stated once and repeated in every report:
 *
 *   The oracle and the analyzer are two separate walkers over the SAME grammar. So
 *   the comparison catches an implementation defect in either — a dropped node
 *   type, a mis-derived target, a mislabelled edge, a scope attributed wrongly.
 *   It CANNOT catch a grammar defect, because both paths are downstream of it.
 *   A coverage number from this script is evidence about two implementations, not
 *   about tree-sitter-vbnet.
 *
 * THE THREE NUMBERS PER LABEL:
 *   covered    truth edges the analyzer also published — the label is real and right
 *   MISSING    truth edges with no analyzer edge — the analyzer is incomplete
 *   unexplained analyzer edges with no truth edge — either the analyzer invents
 *              something, or the oracle is silent on a construct it should derive.
 *              Both are findings; neither is dismissed.
 *
 * ZERO REGEX.
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveVbTruth, vbEdgeKey, VB_ORACLE_LABELS } from "../m14/vb-truth"
import type { VbTruthLabel } from "../m14/vb-truth"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_VB_REPOS ?? "roslyn-vb,vbnet-samples").split(",").filter(Boolean)
const LIMIT = Number(process.env.BB_VB_LIMIT ?? 0)
const SHOW = Number(process.env.BB_VB_SHOW ?? 10)

const IMPORT_ALIASES = new Set(["imports", "brain_import"])

type File = { repo: string; dir: string; rel: string; abs: string; text: string; label: string }
const files: File[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  try { statSync(dir) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  let admitted = 0
  for (const rel of tracked) {
    if (!rel.endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 900_000) continue; text = readFileSync(abs, "utf8") } catch { continue }
    files.push({ repo, dir, rel, abs, text, label: `${repo}/${rel}` })
    admitted++
    if (LIMIT > 0 && admitted >= LIMIT) break
  }
  console.error(`corpus ${repo}: ${admitted} .vb`)
}

// The oracle needs its own tree. It shares the wasm BY DESIGN — that limit is
// stated in the oracle's header — but it must parse independently so neither side
// can be handed the other's tree.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const tsParser = new WSP()
tsParser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-vbnet.wasm"))))

type Row = { truth: number; analyzer: number; covered: number; missing: string[]; unexplained: string[]; truthFiles: number }
const rows = new Map<string, Row>()
const rowFor = (l: string): Row => {
  let r = rows.get(l)
  if (!r) { r = { truth: 0, analyzer: 0, covered: 0, missing: [], unexplained: [], truthFiles: 0 }; rows.set(l, r) }
  return r
}

let idx = 0
const ORACLE_FAILS: string[] = []
let oracleFail = 0
let productionFail = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { productionFail++; continue }
    let tree: any
    try { tree = tsParser.parse(f.text) } catch { oracleFail++; continue }
    if (!tree) { oracleFail++; continue }

    let truth: ReturnType<typeof deriveVbTruth> = []
    try { truth = deriveVbTruth(tree.rootNode, f.text, f.label) } catch (e) {
      oracleFail++
      if (ORACLE_FAILS.length < 5) ORACLE_FAILS.push(`${f.label}: ${e instanceof Error ? e.message : String(e)}`)
      tree.delete?.(); continue
    }

    const truthByLabel = new Map<string, Set<string>>()
    for (const e of truth) {
      const k = vbEdgeKey({ label: e.label, from: e.from, target: e.target })
      let set = truthByLabel.get(e.label)
      if (!set) { set = new Set(); truthByLabel.set(e.label, set) }
      set.add(k)
    }
    const analyzerByLabel = new Map<string, Set<string>>()
    for (const e of r?.relationships ?? []) {
      const label = IMPORT_ALIASES.has(String(e.type)) ? "imports" : String(e.type)
      const k = vbEdgeKey({ label, from: String(e.source), target: String(e.target) })
      let set = analyzerByLabel.get(label)
      if (!set) { set = new Set(); analyzerByLabel.set(label, set) }
      set.add(k)
    }

    const labels = new Set<string>([...truthByLabel.keys(), ...analyzerByLabel.keys()])
    for (const label of labels) {
      const row = rowFor(label)
      const tset = truthByLabel.get(label) ?? new Set<string>()
      const aset = analyzerByLabel.get(label) ?? new Set<string>()
      row.truth += tset.size
      row.analyzer += aset.size
      if (tset.size > 0) row.truthFiles++
      for (const k of tset) if (aset.has(k)) row.covered++
      for (const k of tset) if (!aset.has(k) && row.missing.length < 400) row.missing.push(k)
      for (const k of aset) if (!tset.has(k) && row.unexplained.length < 400) row.unexplained.push(k)
    }
    tree.delete?.()
  }
}
console.error(`differential over ${files.length} files …`)
const t0 = Date.now()
await Promise.all(Array.from({ length: 8 }, () => worker()))
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s · oracle failures ${oracleFail} · production failures ${productionFail}\n`)
for (const m of ORACLE_FAILS) console.error(`  ORACLE FAIL ${m}`)

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const ALL = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
console.log("VB ONTOLOGY DIFFERENTIAL — analyzer (production path) vs script/m14/vb-truth.ts")
console.log(`corpus ${REPOS.join("+")} · ${files.length} files · oracle labels ${VB_ORACLE_LABELS.length}: ${VB_ORACLE_LABELS.join(" ")}`)
console.log(`LIMIT OF THE CLAIM: the two walkers share tree-sitter-vbnet.wasm, so a GRAMMAR defect is invisible to both.`)
console.log(`                 These numbers are evidence about two implementations, not about the grammar.\n`)
console.log(`${pad("label", 14)}${pad("truth", 9)}${pad("analyzer", 10)}${pad("covered", 10)}${pad("coverage", 11)}${pad("MISSING", 9)}unexplained`)
console.log("-".repeat(110))
let totTruth = 0, totCov = 0, totMiss = 0, totUn = 0
for (const l of ALL) {
  const row = rows.get(l)
  if (!row) { console.log(`${pad(l, 14)}${"0"}  — label never appeared on either side`); continue }
  totTruth += row.truth; totCov += row.covered; totMiss += row.missing.length; totUn += row.unexplained.length
  const cov = row.truth === 0 ? "n/a" : `${((row.covered / row.truth) * 100).toFixed(1)}%`
  console.log(`${pad(l, 14)}${pad(row.truth.toLocaleString(), 9)}${pad(row.analyzer.toLocaleString(), 10)}${pad(row.covered.toLocaleString(), 10)}${pad(cov, 11)}${pad(String(row.missing.length), 9)}${row.unexplained.length}`)
}
console.log("-".repeat(110))
console.log(`TOTAL truth ${totTruth.toLocaleString()} · covered ${totCov.toLocaleString()} · MISSING ${totMiss.toLocaleString()} · unexplained ${totUn.toLocaleString()}`)
console.log(`overall coverage ${totTruth === 0 ? "n/a" : `${((totCov / totTruth) * 100).toFixed(2)}%`}`)

console.log("\n=== per-label detail ===")
for (const l of ALL) {
  const row = rows.get(l)
  if (!row) continue
  console.log(`\n${l}: truth ${row.truth} in ${row.truthFiles} files · analyzer ${row.analyzer} · covered ${row.covered} · MISSING ${row.missing.length} · unexplained ${row.unexplained.length}`)
  if (row.missing.length) {
    console.log(`  MISSING (truth with no analyzer edge), first ${Math.min(SHOW, row.missing.length)}:`)
    for (const k of row.missing.slice(0, SHOW)) console.log(`    ${k}`)
  }
  if (row.unexplained.length) {
    console.log(`  UNEXPLAINED (analyzer edge with no truth edge), first ${Math.min(SHOW, row.unexplained.length)}:`)
    for (const k of row.unexplained.slice(0, SHOW)) console.log(`    ${k}`)
  }
}
void SHOW as number
export type { VbTruthLabel }