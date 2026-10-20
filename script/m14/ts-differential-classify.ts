/**
 * TS DIFFERENTIAL CLASSIFICATION — every MISSING / UNEXPLAINED row from the lane's own differential,
 * bucketed by CAUSE, so the D4 audit debt is named rather than counted.
 *
 * ## Why this instrument
 *
 * The Lead's scoped differential run reported, over two 60-file draws:
 *   vue-core     truth 5362 · covered 4742 (88.4%) · MISSING 620 · analyzer 3920 · unexplained 331
 *   element-plus truth 1620 · covered 1428 (88.1%) · MISSING 192 · analyzer 1413 · unexplained 77
 * The samples are all `references` rows that look like type parameters and member names. A bucket
 * list with counts is what decides whether a row is the ORACLE over-deriving (a local binding is not
 * a project reference) or the ANALYZER missing a real edge — and those two have opposite fixes.
 *
 * ## How it stays honest
 *
 * It imports the differential's OWN truth builders and normTarget (so the comparison is the
 * differential's, not a re-implementation), runs the SAME per-file matching rule (label + normTarget,
 * with the differential's own `te.target.includes(normTarget(r.target))` allowance in the
 * unexplained direction), and then bucket-classifies the mismatches. It does NOT write the
 * F5 artifact and does NOT claim differential numbers for the differential's population: it draws
 * its own deterministic 60-file stride and PRINTS that population — the counts here classify the
 * same ROW CLASSES, and the differential's own counts remain the Lead's measurement.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-differential-classify.ts [--repo NAME] [--files 60] [--json out]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"
import {
  deriveTreeEdges,
  deriveTypeScriptEdges,
  deriveTypeScriptRendersTruth,
  deriveTypeScriptDecoratorTruth,
  normTarget,
  auditTarget,
} from "./differential"
import { deriveTypeScriptReferencesTruth } from "./oracles/typescript-references"
import { deriveTypeScriptUsesTruth } from "./oracles/typescript-uses"
import { deriveTypeScriptContainsTruth } from "./oracles/typescript-contains"
import { deriveTypeScriptImportTruth, deriveTypeScriptExportTruth } from "./oracles/typescript-imports-truth"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`))
  if (eq !== undefined) return eq.slice(flag.length + 1)
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const REPOS = argOf("--repo") ? [argOf("--repo")!] : ["vue-core", "element-plus"]
const NFILES = Number(argOf("--files") ?? 60)
const jsonOut = argOf("--json")

const parser = await ASTEngine.getParser("typescript" as any)

function filesOf(repo: string): string[] {
  const dir = path.join(CR, repo)
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
  const files = tracked.filter((r) => r.endsWith(".ts")).map((r) => path.join(dir, r)).sort()
  if (files.length <= NFILES) return files
  const stride = Math.max(1, Math.floor(files.length / NFILES))
  const picked: string[] = []
  for (let i = 0; i < files.length && picked.length < NFILES; i += stride) picked.push(files[i]!)
  return picked
}

/** Names declared as TYPE PARAMETERS anywhere in the file (`<T>`, `<K extends X>`). */
function typeParameterNames(root: any): Set<string> {
  const out = new Set<string>()
  const walk = (n: any) => {
    if (!n) return
    if (n.type === "type_parameter") {
      const nm = n.childForFieldName("name") ?? n.namedChild(0)
      if (nm && nm.text) out.add(String(nm.text))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return out
}

/** Member names declared by class/interface/enum bodies in the file (declarations, not references). */
function memberNames(root: any): Set<string> {
  const out = new Set<string>()
  const memberTypes = new Set([
    "method_definition", "public_field_definition", "method_signature", "property_signature",
    "abstract_method_signature", "abstract_property_signature", "enum_assignment", "property_identifier",
  ])
  const walk = (n: any) => {
    if (!n) return
    if (memberTypes.has(n.type) && n.type !== "property_identifier") {
      const nm = n.childForFieldName("name") ?? n.childForFieldName("property") ?? n.namedChild(0)
      if (nm && (nm.type === "property_identifier" || nm.type === "identifier")) out.add(String(nm.text))
    }
    if (n.type === "enum_assignment") {
      const nm = n.childForFieldName("name")
      if (nm) out.add(String(nm.text))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return out
}

type Row = { label: string; from: string; target: string }
type Tally = { count: number; samples: string[] }
const missingBuckets = new Map<string, Tally>()
const unexplainedBuckets = new Map<string, Tally>()
const bump = (m: Map<string, Tally>, key: string, sample: string) => {
  let t = m.get(key)
  if (!t) m.set(key, (t = { count: 0, samples: [] }))
  t.count++
  if (t.samples.length < 4) t.samples.push(sample)
}
const breakdown: any[] = []

for (const repo of REPOS) {
  const files = filesOf(repo)
  let truthTotal = 0
  let covered = 0
  let missingTotal = 0
  let analyzerTotal = 0
  let unexplainedTotal = 0
  for (const abs of files) {
    const rel = abs.slice(CR.length + 1)
    const content = fs.readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    if (tree === null) continue
    const root = tree.rootNode
    let result: any
    try {
      result = new RealTypeScriptAnalyzer().analyze(root, content, rel)
    } catch {
      continue
    }
    // THE DIFFERENTIAL'S TS TRUTH PUSH, line for line (differential.ts: typescript block).
    const truth: Row[] = [
      ...deriveTreeEdges(root, "typescript"),
      ...deriveTypeScriptContainsTruth(root),
      ...deriveTypeScriptReferencesTruth(root),
      ...deriveTypeScriptUsesTruth(root),
      ...deriveTypeScriptEdges(root),
      ...deriveTypeScriptRendersTruth(root),
      ...deriveTypeScriptDecoratorTruth(root),
      ...deriveTypeScriptImportTruth(root, rel),
      ...deriveTypeScriptExportTruth(root, rel),
    ].map((e: any) => ({ label: String(e.label), from: String(e.from ?? ""), target: String(e.target ?? "") }))
      .filter((t) => t.target.trim().length > 0)
    const rels = (result.relationships ?? []).map((r: any) => ({
      label: String(r.type ?? ""),
      from: String(r.source ?? ""),
      target: String(r.target ?? ""),
      confidence: typeof r.confidence === "number" ? r.confidence : 1,
    }))
    truthTotal += truth.length
    analyzerTotal += rels.length
    const typeParams = typeParameterNames(root)
    const members = memberNames(root)
    for (const te of truth) {
      // THE DIFFERENTIAL'S OWN MATCH KEY, verbatim: `normTarget(auditTarget(t))` — the BINDING_SEP
      // strip on BOTH sides (differential.ts:25527, :25535). The classifier used the bare
      // `normTarget`, so a binding-spelled analyzer row never matched the truth's bare name, and
      // the row was charged as MISSING *and* its analyzer twin as UNEXPLAINED. MEASURED on the
      // 40-file/repo draw: 80 MISSING and 123 UNEXPLAINED rows were this instrument's gap.
      const hit = rels.some((r: any) => r.label === te.label && normTarget(auditTarget(r.target)) === normTarget(auditTarget(te.target)))
      if (hit) {
        covered++
        continue
      }
      missingTotal++
      const tn = normTarget(te.target)
      const bindingSeen = rels.some((r: any) => r.label === te.label && r.target.includes("\u0000") && String(r.target).slice(String(r.target).lastIndexOf("\u0000") + 1) === te.target)
      let bucket: string
      if (bindingSeen) bucket = `${te.label}: analyzer emitted it BINDING-SPELLED (truth derives the bare name)`
      else if (typeParams.has(tn)) bucket = `${te.label}: target is a FILE TYPE PARAMETER (a local binding, not a project reference)`
      else if (members.has(tn)) bucket = `${te.label}: target is a DECLARED MEMBER NAME (reached by contains, not a reference)`
      else bucket = `${te.label}: other (sample for manual read)`
      bump(missingBuckets, bucket, `${te.from} -> ${te.target} @ ${rel}`)
    }
    for (const r of rels) {
      const hit = truth.some((te) => te.label === r.label && (
        normTarget(auditTarget(te.target)) === normTarget(auditTarget(r.target)) ||
        te.target.includes(normTarget(auditTarget(r.target)))
      ))
      if (hit) continue
      unexplainedTotal++
      let bucket: string
      if (String(r.target).includes("\u0000")) bucket = `${r.label}: analyzer BINDING-SPELLED target (truth derives a bare name or nothing)`
      else bucket = `${r.label}: other (sample for manual read)`
      bump(unexplainedBuckets, bucket, `${r.from} -> ${String(r.target).replace(/\u0000/g, "\\0")} @ ${rel}`)
    }
  }
  const row = { repo, files: files.length, truthTotal, covered, missingTotal, analyzerTotal, unexplainedTotal }
  breakdown.push(row)
  console.log(`${repo}: files=${files.length} truth=${truthTotal} covered=${covered} (${((100 * covered) / (truthTotal || 1)).toFixed(1)}%) MISSING=${missingTotal} | analyzer=${analyzerTotal} unexplained=${unexplainedTotal} (${((100 * unexplainedTotal) / (analyzerTotal || 1)).toFixed(1)}%)`)
}

console.log(`\nPOPULATION: deterministic stride above, NOT the differential's rotating sample — these buckets classify the ROW CLASSES; the differential's own counts remain its measurement.`)
console.log(`\nMISSING — truth derives a row the analyzer did not emit:`)
for (const [k, t] of [...missingBuckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(t.count).padStart(5)}  ${k}`)
  for (const s of t.samples) console.log(`           e.g. ${s}`)
}
console.log(`\nUNEXPLAINED — analyzer emitted a row no truth derivation explains:`)
for (const [k, t] of [...unexplainedBuckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(t.count).padStart(5)}  ${k}`)
  for (const s of t.samples) console.log(`           e.g. ${s}`)
}
if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        population: { repos: REPOS, filesPerRepo: NFILES, method: "deterministic stride; differential rule imported (deriveTreeEdges/deriveTypeScriptEdges/oracles/normTarget)" },
        lanes: breakdown,
        missing: Object.fromEntries([...missingBuckets.entries()].map(([k, t]) => [k, t])),
        unexplained: Object.fromEntries([...unexplainedBuckets.entries()].map(([k, t]) => [k, t])),
      },
      null,
      2,
    ),
  )
}
