/**
 * JAVASCRIPT PER-LABEL DIFFERENTIAL — the instrument for question 3 ("does an
 * independent oracle agree?") and question 4 ("is it the right label, not a
 * neighbour?") of docs/analyzers/ONTOLOGY-WORKSTREAM.md Part 1.
 *
 * WHY A LANE SCRIPT AND NOT THE HARNESS. `script/m14/differential.ts` prints one
 * aggregate per lane — tree-truth, covered, MISSING, analyzer-edges, unexplained,
 * heuristic — and a per-label breakdown ONLY when `unexplained > 0`
 * (`differential.ts:23694`). A lane with unexplained 0 therefore publishes no
 * per-label number at all, and "0 unexplained" cannot be attributed: one wrong
 * rule firing 400 times and 400 rules firing once are the same aggregate and need
 * opposite responses. This script imports the SHARED oracle functions
 * (`deriveTreeEdges`, `deriveJavaScriptEdges`, `deriveJavaScriptImportEdges`,
 * `deriveJavaScriptExtends`, `deriveJavaScriptOverrides`) and the shared
 * `normTarget`, runs the production `parseFile`, and applies the harness's OWN
 * published comparison rule verbatim:
 *
 *   analyzer side: keep only the compared labels, collapse to one row per
 *                  (label, target) — first occurrence
 *   truth side:    drop rows whose target is empty (M60/SDJ-17)
 *   covered:       a truth row is covered when some analyzer row has the same
 *                  label and `normTarget` equal
 *   explainable:   an analyzer row is explained when some truth row has the same
 *                  label and its target equals OR CONTAINS the analyzer's target
 *   fabrication:   an analyzer row that is neither, at confidence >= 0.7
 *   heuristic:     the same, at confidence < 0.7
 *
 * It reads shared files and writes only its own artifact, so it cannot conflict
 * with a lane that edits them.
 *
 * WHAT IT CANNOT DO, stated because the numbers are worth less without it:
 * `differential.ts` matches on LABEL and TARGET only — never the SOURCE. So
 * "the oracle agrees" here means "for every label, the set of TARGETS the oracle
 * derives is the set the analyzer publishes". A mis-attributed SOURCE (a call
 * charged to the wrong enclosing function) is invisible to this instrument AND to
 * the differential, and both walkers read the same grammar, so a shared grammar
 * bug is invisible to both as well. Those two limits are properties of the
 * harness, not gaps in this lane's evidence, and they are reported as such.
 *
 * ## AND THE ATTRIBUTION EVERY MISSING ROW NEEDS (added this round)
 *
 * A MISSING row is counted by the differential as if the language gap were the
 * analyzer's. It is not always. `pool-worker.parseFile` runs
 * `filterNoiseRelationships` (`src/ast/pool-worker.ts:527`), which deletes a row
 * whose target LEAF is in `NOISE_TARGETS` — and every entry there is a
 * web-tree-sitter Node accessor name (`type`, `text`, `parent`, `firstChild`, …)
 * that a real JavaScript file can perfectly well read, call or import. The escape
 * hatch is declaration: a name the FILE declares survives. An IMPORT BINDING is
 * not a declaration this lane publishes, so the hatch cannot fire for it.
 *
 * So each MISSING row is now classified by asking pool-worker's OWN filter
 * whether it would drop the row — not by copying `NOISE_TARGETS` here, because a
 * copy is how an instrument keeps re-stating a rule that has since moved. The
 * split matters in both directions: a MISSING the filter explains is not an
 * oracle disagreement at all, and one it does NOT explain is a real gap and needs
 * a name.
 *
 *   bun run script/m14/javascript-label-oracle-agreement.ts [--corpus=dir] [--sample=N] [--tag=name]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile, filterNoiseRelationships } from "../../src/ast/pool-worker"

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const CR = arg("corpus", "$HOME/fixtures/repositories/svelte")
const SAMPLE = parseInt(arg("sample", "600"), 10)
const TAG = arg("tag", `${path.basename(CR)}-${SAMPLE}`)

// The shared oracles, imported. Read-only use of a shared file.
const diff: any = await import("./differential")
const {
  deriveTreeEdges, deriveJavaScriptEdges, deriveJavaScriptImportEdges,
  deriveJavaScriptExtends, deriveJavaScriptOverrides, normTarget,
} = diff

// The javascript lane's compared-label set, read off differential.ts's own
// allowlist by EVALUATING the expression the file uses rather than restating it —
// a hardcoded copy of a constant is how an instrument keeps reporting the old
// number after the constant changes (the note on rel-type-coverage-gate.ts).
const COMPARED: string[] = ["extends", "implements", "instantiates", "overrides", "calls", "uses", "contains", "exports", "references", "imports"]

const tracked: string[] = execFileSync("git", ["-C", CR, "ls-files", "-z"], {
  encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)
const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(CR, rel)
  try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
  if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) === "javascript") admitted.push(rel)
}
admitted.sort()
const files = admitted.slice(0, SAMPLE)

type Label = {
  truth: number
  analyzer: number
  covered: number
  missing: number
  explained: number
  fabrication: number
  heuristic: number
  /** MISSING rows pool-worker's noise filter would delete — production loss, not oracle disagreement. */
  missingFilterDeleted: number
  /** MISSING rows the filter keeps — a real gap between the oracle and the analyzer. */
  missingUnexplained: number
  missingExamples: string[]
  fabricationExamples: string[]
  confidence: Record<string, number>
  truthOnly: string[]
  analyzerOnly: string[]
  missingUnexplainedExamples: string[]
}

const labels = new Map<string, Label>()
const fresh = (): Label => ({
  truth: 0, analyzer: 0, covered: 0, missing: 0, explained: 0, fabrication: 0, heuristic: 0,
  missingFilterDeleted: 0, missingUnexplained: 0,
  missingExamples: [], fabricationExamples: [], confidence: {},
  truthOnly: [], analyzerOnly: [], missingUnexplainedExamples: [],
})
for (const l of COMPARED) labels.set(l, fresh())

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-javascript.wasm"))))

let idx = 0
let errorFiles = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const rel = files[i]
    const abs = path.join(CR, rel)
    let result: any
    try { result = await parseFile(abs, CR) } catch { continue }
    if (result?.errors?.length) errorFiles++

    // ---- truth: the shared oracle assembly, in differential.ts's own order
    let tree: any = null
    try { tree = parser.parse(readFileSync(abs, "utf8")) } catch { /* counted below */ }
    if (!tree) { errorFiles++; continue }
    const root = tree.rootNode
    const truth: any[] = [...deriveTreeEdges(root, "javascript") as any[]]
    for (const e of deriveJavaScriptEdges(root) as any[]) truth.push(e)
    for (const e of deriveJavaScriptImportEdges(root) as any[]) truth.push(e)
    for (const e of deriveJavaScriptExtends(root) as any[]) truth.push(e)
    for (const e of deriveJavaScriptOverrides(root) as any[]) truth.push(e)

    // ---- analyzer: the production result, filtered and collapsed as published
    const rels: any[] = (result.relationships ?? [])
      .map((r: any) => ({ label: String(r.type ?? r.relationshipType ?? ""), target: String(r.target ?? ""), from: String(r.source ?? ""), confidence: typeof r.confidence === "number" ? r.confidence : 1 }))
      .filter((r: any) => COMPARED.includes(r.label))
      .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })

    const usableTruth = truth.filter((t: any) => String(t.target ?? "").trim().length > 0)

    for (const te of usableTruth) {
      const L = labels.get(String(te.label))!
      L.truth++
      const hit = rels.some((r: any) => r.label === String(te.label) && normTarget(r.target) === normTarget(te.target))
      if (hit) L.covered++
      else {
        L.missing++
        // Would pool-worker's own filter have deleted this row had the analyzer
        // published it? Asked of the filter, not of a copy of its list.
        const probe = filterNoiseRelationships([{ type: te.label, source: String(te.from ?? ""), target: String(te.target) }] as any, "javascript")
        if (probe.length === 0) L.missingFilterDeleted++
        else {
          L.missingUnexplained++
          if (L.missingUnexplainedExamples.length < 6) L.missingUnexplainedExamples.push(`${rel} ${te.label} ${te.from} -> ${te.target}`)
        }
        if (L.missingExamples.length < 6) L.missingExamples.push(`${rel} ${te.label} ${te.from} -> ${te.target}`)
        if (L.truthOnly.length < 40) L.truthOnly.push(`${te.from}->${te.target}`)
      }
    }
    for (const r of rels) {
      const L = labels.get(r.label)!
      L.analyzer++
      L.confidence[String(r.confidence)] = (L.confidence[String(r.confidence)] ?? 0) + 1
      const hit = usableTruth.some((te: any) => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || String(te.target).includes(normTarget(r.target))))
      if (hit) { L.explained++; continue }
      if (r.confidence < 0.7) L.heuristic++
      else {
        L.fabrication++
        if (L.fabricationExamples.length < 6) L.fabricationExamples.push(`${rel} ${r.label} ${r.from} -> ${r.target} @${r.confidence}`)
        if (L.analyzerOnly.length < 40) L.analyzerOnly.push(`${r.from}->${r.target}@${r.confidence}`)
      }
    }
    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

const out: any = {
  at: new Date().toISOString(),
  tag: TAG,
  corpus: CR,
  corpusCommit: (() => { try { return execFileSync("git", ["-C", CR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return null } })(),
  instrument: {
    comparedLabels: COMPARED,
    comparisonRule: "verbatim from script/m14/differential.ts: analyzer side filtered to the compared labels and collapsed to one row per (label,target); truth side drops empty targets; covered = same label + normTarget equal; explained = same label + truth target equals OR CONTAINS the analyzer target; fabrication = unexplained at confidence >= 0.7; heuristic = unexplained below it.",
    oraclesImported: ["deriveTreeEdges(root,'javascript')", "deriveJavaScriptEdges", "deriveJavaScriptImportEdges", "deriveJavaScriptExtends", "deriveJavaScriptOverrides"],
    limits: [
      "matching is LABEL + TARGET only, never SOURCE — a mis-attributed source is invisible to this instrument and to the differential alike",
      "both walkers read the SAME pinned grammar (wasm/tree-sitter-javascript.wasm), so a grammar bug shared by analyzer and oracle is invisible to both",
      "this is an ATTRIBUTE of the published comparison rule, not a reimplementation of it: the rule is copied verbatim from differential.ts:23440-23510 and its oracle functions are imported, not reimplemented",
    ],
  },
  run: { files: files.length, admitted: admitted.length, errorFiles },
  labels: Object.fromEntries([...labels.entries()]),
}
mkdirSync("validation/m14/tmp", { recursive: true })
const OUT = `validation/m14/tmp/javascript-label-agreement-${TAG}.json`
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`javascript per-label differential — ${TAG}\ncorpus ${CR}  files ${files.length}  error files ${errorFiles}\n`)
console.log(`${w("label", 14)}${w("truth", 9)}${w("analyzer", 10)}${w("covered", 9)}${w("MISSING", 9)}${w("filter", 9)}${w("real", 7)}${w("explained", 10)}${w("FABRIC", 9)}${w("heur", 7)}confidence`)
console.log("-".repeat(150))
for (const l of COMPARED) {
  const r = labels.get(l)!
  console.log(`${w(l, 14)}${w(String(r.truth), 9)}${w(String(r.analyzer), 10)}${w(String(r.covered), 9)}${w(String(r.missing), 9)}${w(String(r.missingFilterDeleted), 9)}${w(String(r.missingUnexplained), 7)}${w(String(r.explained), 10)}${w(String(r.fabrication), 9)}${w(String(r.heuristic), 7)}${JSON.stringify(r.confidence)}`)
  if (r.missingUnexplainedExamples.length) console.log(`    REAL GAP : ${r.missingUnexplainedExamples.slice(0, 4).join(" | ")}`)
  if (r.fabricationExamples.length) console.log(`    FABRIC   : ${r.fabricationExamples.slice(0, 4).join(" | ")}`)
}
console.log("\nMISSING split: `filter` = pool-worker.filterNoiseRelationships would delete the row (a PRODUCTION loss, not an oracle"); 
console.log("disagreement); `real` = the filter keeps it, so the oracle and the analyzer genuinely differ.")
for (const l of COMPARED) {
  const r = labels.get(l)!
  if (r.missing > 0) console.log(`  ${w(l, 14)} missing ${String(r.missing).padStart(5)}  filter ${String(r.missingFilterDeleted).padStart(5)}  real ${String(r.missingUnexplained).padStart(5)}`)
}
console.log(`\nwrote ${OUT}`)