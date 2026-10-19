/**
 * rust-arm-reconcile — reconcile the ONE column deviation of the task-36 post-fix arm: unresolved
 * 58,380 → 61,086 (+2,706) while the edge pre-commit held exactly (TOTAL 298,909).
 *
 * Method (LIGHT — parse-only, no gate/DB):
 *  1. OLD rows = the pre-fix whole-population dump (accepted 297,177 arm); every row's OLD class is exact.
 *  2. NEW rows = the CURRENT analyzer over the same population (project context passed so file/namespace
 *     claims are emitted exactly as the gate sees them).
 *  3. Multiset diff by (type,target,file,line): NEW EDGES = new−old; GONE = old−new; SHARED = same key.
 *  4. Predicted NEW class per row, mirroring production's rule: a verified claim → extOK (declCount 0);
 *     else project symbol count(target)==1 → resolved, >1 → amb(decl), 0 → unresolved.
 *  5. SHARED rows get old class → predicted new class transitions; NEW EDGES get their predicted class.
 *  6. Predicted totals are checked against the Lead's reported table; the +2,706 is decomposed into
 *     (a) new edges' own unresolved, (b) existing rows reclassified into unresolved, (c) defect class
 *     (named: rows that resolved to an impl CONTAINER of a type this project does not declare — after the
 *     identity fix there is no such declaration, so those rows become unresolved: a CORRECTNESS change).
 *
 * CLI: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/rust-arm-reconcile.ts
 *      --old-dump=.tmp-rust/rust-arm-dump.txt [--json=path] [--text]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`))
  if (eq) return eq.slice(f.length + 1)
  const i = process.argv.indexOf(f)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}
const OLD_DUMP = argOf("--old-dump") ?? path.join(ROOT, ".tmp-rust", "rust-arm-dump.txt")
const JSON_OUT = argOf("--json")
const TEXT = process.argv.includes("--text")

const key = (t: string, target: string, line: number, file: string) => `${t}\u0000${target}\u0000${line}\u0000${file}`
const oldRows = new Map<string, { type: string; target: string; file: string; line: number; cls: string }>()
for (const line of fs.readFileSync(OLD_DUMP, "utf8").split("\n")) {
  const p = line.split("\t")
  if (p[0] !== "DUMP") continue
  const m = (p[4] ?? "").match(/^(.*):(\d+)$/)
  if (!m) continue
  oldRows.set(key(p[1], p[3], Number(m[2]), m[1]), { type: p[1], target: p[3], file: m[1], line: Number(m[2]), cls: p[2] })
}

// ── current analyzer over the same population, WITH project context (claims emitted) ────────────────
const files: Array<{ repo: string; abs: string }> = []
for (const repo of fs.readdirSync(CR).sort()) {
  const dir = path.join(CR, repo)
  try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "rust") continue
    files.push({ repo, abs })
  }
}
const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const rustMod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
const parser: any = await getParser("rust")

const projectNames = new Map<string, Map<string, number>>()  // repo -> name -> count (all published symbols)
const projNameCount = (repo: string, name: string) => projectNames.get(repo)?.get(name) ?? 0
const newRows = new Map<string, { type: string; target: string; file: string; line: number; claim: string | null }>()
let parsed = 0
for (const f of files) {
  let src = ""
  try { src = fs.readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  parsed++
  try {
    const projRoot = path.join(CR, f.repo)
    const r: any = await new rustMod.RealRustAnalyzer().analyze(tree.rootNode, src, f.abs, { projectRoot: projRoot })
    const names = projectNames.get(f.repo) ?? new Map<string, number>()
    for (const sym of r.symbols ?? []) { if (sym?.name) names.set(String(sym.name), (names.get(String(sym.name)) ?? 0) + 1) }
    projectNames.set(f.repo, names)
    for (const row of r.relationships ?? []) {
      const claim = row.metadata?.importProjectFile ? "projectFile" : Array.isArray(row.metadata?.languageNamespace) ? "languageNamespace" : null
      newRows.set(key(String(row.type), String(row.target), Number(row.line_number), f.abs), { type: String(row.type), target: String(row.target), file: f.abs, line: Number(row.line_number), claim })
    }
  } finally { tree.delete?.() }
}

const predictClass = (repo: string, target: string, claim: string | null): "resolved" | "amb" | "unresolved" | "extOK" => {
  const cnt = projNameCount(repo, target)
  if (claim) return cnt === 0 ? "extOK" : cnt === 1 ? "resolved" : "amb"
  if (cnt === 1) return "resolved"
  if (cnt > 1) return "amb"
  return "unresolved"
}
const repoOf = (abs: string): string => {
  const rel = path.relative(CR, abs)
  return rel.split(path.sep)[0]
}

// ── classify every CURRENT row against its OLD class (absent from the old dump = previously RESOLVED) ──
type Row = { type: string; target: string; file: string; line: number; claim: string | null }
const current: Row[] = [...newRows.values()]
const transitions: Record<string, number> = {}
const predicted: Record<string, number> = { resolved: 0, amb: 0, unresolved: 0, extOK: 0 }
const unresolvedReasons: Record<string, number> = {}
const unresolvedFromOld: Record<string, number> = {}
// impl-only nominal names per project: an impl target the project declares ONLY through the (removed) container
const implOnly = new Map<string, Set<string>>()
for (const [repo, names] of projectNames) {
  const set = new Set<string>()
  for (const [name, n] of names) {
    if (!name.endsWith("::impl")) continue
    const nominal = name.slice(0, -"::impl".length)
    const bareCount = (names.get(nominal) ?? 0)
    if (bareCount <= 1 && n >= 1) set.add(nominal)   // the container was the only (or the duplicate) declaration spelling
  }
  implOnly.set(repo, set)
}
for (const r of current) {
  const repo = repoOf(r.file)
  const oldCls = oldRows.get(key(r.type, r.target, r.line, r.file))?.cls ?? "resolved"
  const newCls = predictClass(repo, r.target, r.claim)
  predicted[newCls]++
  const tkey = `${oldCls}->${newCls}|${r.type}`
  transitions[tkey] = (transitions[tkey] ?? 0) + 1
  if (newCls === "unresolved") {
    let reason: string
    if (r.claim) reason = `claim-${r.claim}`
    else if (r.target.includes("::")) reason = "module-or-qualified-path-target"
    else if (implOnly.get(repo)?.has(r.target)) reason = "impl-container-name-removed"
    else if (projNameCount(repo, r.target) === 0) reason = "name-absent-from-project"
    else reason = "other"
    const rk = `${r.type}|${reason}`
    unresolvedReasons[rk] = (unresolvedReasons[rk] ?? 0) + 1
    const ok = `${r.type}|${reason}|old=${oldCls}`
    unresolvedFromOld[ok] = (unresolvedFromOld[ok] ?? 0) + 1
  }
}
const observed = { resolved: 100787, amb: 129491, unresolved: 61086, extOK: 7545 }
const oldTotals = { resolved: 82504, amb: 148802, unresolved: 58380, extOK: 7491 }
const modelCheck = {
  predictedTotals: predicted,
  observedTotals: observed,
  deltaPredictedMinusObserved: {
    resolved: predicted.resolved - observed.resolved,
    amb: predicted.amb - observed.amb,
    unresolved: predicted.unresolved - observed.unresolved,
    extOK: predicted.extOK - observed.extOK,
  },
}
const report = {
  schemaVersion: 1,
  instrument: "script/m14/rust-arm-reconcile.ts",
  population: { files: files.length, parsed, oldDumpRows: oldRows.size, currentRows: current.length },
  modelCheck,
  reclassified: Object.fromEntries(Object.entries(transitions).sort((a, b) => b[1] - a[1]).slice(0, 40)),
  unresolvedPredictedByReason: Object.fromEntries(Object.entries(unresolvedReasons).sort((a, b) => b[1] - a[1])),
  unresolvedPredictedByReasonAndOldClass: Object.fromEntries(Object.entries(unresolvedFromOld).sort((a, b) => b[1] - a[1]).slice(0, 40)),
  note: "Every current row is classified by the production rule (verified claim + declCount 0 → extOK; else project name count 1/2+/0 → resolved/amb/unresolved) and compared with its OLD class (absent from the old dump = previously RESOLVED). predictedTotals are checked against the Lead's reported arm; unresolved creations are attributed by reason.",
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1) + "\n")
if (TEXT || !JSON_OUT) {
  console.log(`rust-arm-reconcile — ${files.length} files parsed; OLD dump rows ${oldRows.size}, current rows ${current.length}`)
  console.log(`MODEL CHECK (predicted vs Lead observed): ${JSON.stringify(report.modelCheck)}`)
  console.log(`RECLASSIFIED (old->new|type): ${JSON.stringify(report.reclassified)}`)
  console.log(`UNRESOLVED predicted by reason: ${JSON.stringify(report.unresolvedPredictedByReason)}`)
  console.log(`UNRESOLVED predicted by reason|oldClass: ${JSON.stringify(report.unresolvedPredictedByReasonAndOldClass)}`)
}
