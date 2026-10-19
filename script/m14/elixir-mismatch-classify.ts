/**
 * ELIXIR LANE — post-wiring MISMATCH CLASSIFIER (task-25 round 2, read-only).
 *
 * Reproduces ONE differential elixir draw EXACTLY (same drawn file list, same truth oracles, the
 * same published match rule imported from `differential.ts` — `normTarget`/`auditTarget` — and the
 * same allowlist the lane now has) and then prints EVERY MISSING and UNEXPLAINED row with the
 * metadata needed to adjudicate it under the task-9 discipline: oracle-defect (truth row the
 * analyzer cannot emit / does not emit), analyzer-defect (analyzer row no oracle shape explains), or
 * rule-gap (a contract question, not a bug).
 *
 * WHY NOT THE HARNESS SAMPLES: differential prints at most 12 unexplained / 6 missing samples per
 * draw; a 23-MISSING / 34-UNEXPLAINED row class cannot be adjudicated from a dozen samples. This
 * walker is lane-owned and read-only, and it must mirror the harness exactly or the classification
 * is about a different measurement — so the match rule and the sample list come FROM the harness
 * (the file list via `BB_F5_SHOW_FILES=1`, the rule via its exported helpers).
 *
 * CLI: bun run script/m14/elixir-mismatch-classify.ts <repo> <files-file> [--json]
 * EXIT 0 measured · 2 usage
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveElixirEdges, normTarget, auditTarget } from "./differential"
import { deriveElixirContainsTruth, deriveElixirUsesTruth, deriveElixirExportsTruth } from "./oracles/elixir-contains"
import { deriveElixirImportsTruth, deriveElixirCallInstantiationTruth, deriveElixirAtomRemoteCallsTruth } from "./oracles/elixir-gap-truth"

const argv = process.argv.slice(2)
const repo = argv.find((a) => !a.startsWith("--"))
const filesFile = argv.filter((a) => !a.startsWith("--"))[1]
const asJson = argv.includes("--json")
if (!repo || !filesFile) {
  console.error("usage: elixir-mismatch-classify.ts <repo> <files-file> [--json]")
  process.exit(2)
}
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")
const repoDir = path.join(CORPUS, repo)
const rels0 = readFileSync(filesFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)

const ELIXIR_COMPARED = new Set(["extends", "implements", "instantiates", "calls", "references", "contains", "exports", "uses", "imports"])
const PATH_EXT = new Set(["sol","h","hh","hpp","hxx","c","cc","cpp","cxx","cu","js","jsx","mjs","cjs","ts","tsx","mts","cts","py","pyi","pyw","dart","rb","java","go","rs","json","yaml","yml","toml","md","css","scss","sass","html","proto"])
const isPathLikeImport = (t: string): boolean => {
  const dot = t.lastIndexOf(".")
  if (dot > 0 && dot < t.length - 1) return PATH_EXT.has(t.slice(dot + 1).toLowerCase())
  return false
}
const matchKey = (label: string, target: any): string => {
  const t = String(target ?? "")
  return label === "imports" && isPathLikeImport(t) ? `EXACT:${t}` : normTarget(auditTarget(t))
}

type Mismatch = {
  dir: "MISSING" | "UNEXPLAINED"
  file: string
  label: string
  target: string
  from?: string
  confidence?: number
  metadata?: any
}
function familyOf(label: string, target: string): string {
  const t = String(target ?? "")
  if (t.length === 0) return "empty"
  if (t.startsWith(":")) return "erlang-atom"
  if (t.includes("/")) return "function-arity"
  if (t.includes(".")) {
    const f = t.split(".")[0]
    return f.length > 0 && f[0] >= "A" && f[0] <= "Z" ? "module-qualified" : "dotted-other"
  }
  if (t[0] >= "A" && t[0] <= "Z") return "module-leaf"
  return "member-leaf"
}

const parser = await getParser("elixir" as any)
const mismatches: Mismatch[] = []
let truthTotal = 0, covered = 0, analyzerTotal = 0, explainable = 0
let missingCount = 0, unexplainedCount = 0
for (const rel of rels0) {
  const abs = path.join(repoDir, rel)
  let tree: any
  try { tree = parser.parse(readFileSync(abs, "utf8")) } catch { continue }
  let analysis: any = null
  try { analysis = await parseFile(abs, path.dirname(abs)) } catch { continue }
  const all = ((analysis?.relationships ?? []) as any[]).map((r) => ({
    label: String(r.type), target: String(r.target ?? ""), confidence: typeof r.confidence === "number" ? r.confidence : 1, metadata: r.metadata, line: r.line_number,
  }))
  const analyzerRels = all
    .filter((r) => ELIXIR_COMPARED.has(r.label))
    .filter((r, i, arr) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x) => (x.label + "|" + x.target) === k) })
  const truth: { label: string; from?: string; target: string }[] = [
    ...deriveElixirEdges(tree.rootNode),
    ...deriveElixirContainsTruth(tree.rootNode),
    ...deriveElixirUsesTruth(tree.rootNode),
    ...deriveElixirExportsTruth(tree.rootNode),
    ...deriveElixirImportsTruth(tree.rootNode),
    ...deriveElixirCallInstantiationTruth(tree.rootNode),
    // MEASUREMENT ONLY, gated: the atom-remote calls derivation is not wired yet; including
    // it here prices what wiring it would do (its unmatched rows become MISSING).
    ...(process.env.ELIXIR_INCLUDE_ATOM ? deriveElixirAtomRemoteCallsTruth(tree.rootNode) : []),
  ] as any[]
  truthTotal += truth.length
  analyzerTotal += analyzerRels.length
  for (const te of truth) {
    const hit = analyzerRels.some((r) => r.label === te.label && matchKey(r.label, r.target) === matchKey(te.label, te.target))
    if (hit) covered++
    else {
      missingCount++
      mismatches.push({ dir: "MISSING", file: rel, label: te.label, target: String(te.target), from: String((te as any).from ?? "") })
    }
  }
  for (const r of analyzerRels) {
    const hit = truth.some((te) => te.label === r.label && (matchKey(te.label, te.target) === matchKey(r.label, r.target) || (r.label !== "imports" && String(te.target).includes(normTarget(auditTarget(r.target))))))
    if (hit) { explainable++; continue }
    if (r.confidence < 0.7) continue
    unexplainedCount++
    mismatches.push({ dir: "UNEXPLAINED", file: rel, label: r.label, target: r.target, confidence: r.confidence, metadata: r.metadata })
  }
}
const groups = new Map<string, { count: number; samples: Mismatch[] }>()
for (const m of mismatches) {
  const key = `${m.dir}\u0000${m.label}\u0000${familyOf(m.label, m.target)}`
  const g = groups.get(key) ?? { count: 0, samples: [] as Mismatch[] }
  g.count++
  if (g.samples.length < 6) g.samples.push(m)
  groups.set(key, g)
}
const out = {
  repo, drawn: rels0.length, truthTotal, covered, missingCount, analyzerTotal, explainable, unexplainedCount,
  groups: [...groups.entries()].map(([k, v]) => { const [dir, label, family] = k.split("\u0000"); return { dir, label, family, count: v.count, samples: v.samples } }).sort((a, b) => b.count - a.count),
  mismatches,
}
if (asJson) console.log(JSON.stringify(out, null, 2))
else {
  console.log(`repo=${repo} drawn=${rels0.length} truth=${truthTotal} covered=${covered} missing=${missingCount} analyzer=${analyzerTotal} unexplained=${unexplainedCount}`)
  for (const g of out.groups) {
    console.log(`\n${g.dir} ${g.label} (${g.family}) × ${g.count}`)
    for (const s of g.samples.slice(0, 4)) console.log(`   ${s.from ? `from ${s.from} ` : ""}-> ${s.target}  [${s.file}]  ${s.metadata ? JSON.stringify(s.metadata).slice(0, 220) : ""}`)
  }
}
