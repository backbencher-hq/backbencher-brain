// kotlin-claim-arm-audit — classify the two-arm claim movements from the analyzer's own output (light:
// one analyzer sweep of the admitted population at the recorded population; no gate re-run, no dump).
// Answers: claims emitted by label; their OFF-arm outcome class (resolved / ambiguous / unresolved) from
// the run's own per-repo key space; the RESOLVED-DISPLACEMENT rows in detail; emitted-vs-verified
// accounting; and the cut-2 receiver-position residual size.
// USAGE: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/kotlin-claim-arm-audit.ts [--cap=0]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.split("=")[1] ?? 0)
const OUT = "validation/m14/fixtures/kotlin/measurements/kotlin-claim-arm-audit.json"
process.env.BB_KOTLIN_IMPORT_CLAIM = "1"
const { RealKotlinAnalyzer } = await import("../../src/ast/real-kotlin-analyzer")
const analyzer = new (RealKotlinAnalyzer as any)()
const parser: any = await getParser("kotlin" as any)
const EXT = [".kt", ".kts"], SIZE = 1024 * 1024
const files: string[] = []; const repos = new Set<string>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0") } catch { continue }
  for (const rel of tracked) {
    if (!rel || !EXT.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE) continue } catch { continue }
    files.push(abs); repos.add(name)
  }
}
files.sort()
const sample = CAP > 0 ? files.filter((_, i) => i % Math.max(1, Math.floor(files.length / CAP)) === 0).slice(0, CAP) : files
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]
type Claim = { file: string; label: string; target: string; specifier: string; repo: string }
const claims: Claim[] = []
const declsByRepo = new Map<string, Map<string, string[]>>() // repo -> name -> files
const cut2 = { calls: 0, uses: 0 }
let parsed = 0, skipped = 0, claimRows = 0, evidenceRows = 0
const unclaimedSamples: string[] = []
for (const f of sample) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { skipped++; continue }
  let res: any, tree: any
  try { tree = parser.parse(content); res = await analyzer.analyze(tree.rootNode, content, f); parsed++ } catch { skipped++; try { tree?.delete?.() } catch {} ; continue }
  const repo = repoOf(f)
  const decls = declsByRepo.get(repo) ?? new Map<string, string[]>()
  declsByRepo.set(repo, decls)
  const fileDeclared = new Set<string>()
  for (const s of res.symbols ?? []) { if (!s?.name) continue; fileDeclared.add(s.name); const arr = decls.get(s.name) ?? []; arr.push(f); decls.set(s.name, arr) }
  const bindings = new Set<string>()
  for (const r of res.relationships ?? []) {
    if (String(r.type) !== "imports") continue
    const md = r.metadata ?? {}
    if (Array.isArray(md.importedBindings)) { evidenceRows++; for (const b of md.importedBindings) bindings.add(b) }
  }
  for (const r of res.relationships ?? []) {
    const label = String(r.type); const md = r.metadata ?? {}
    if (label !== "calls" && label !== "uses") continue
    const tgt = String(r.target ?? "")
    if (md.importedBinding) {
      claimRows++
      claims.push({ file: f, label, target: tgt, specifier: String(md.importedBinding.specifier ?? ""), repo })
    } else if (bindings.has(tgt) && !fileDeclared.has(tgt)) {
      // target IS an imported binding but the row is not claimed: receiver-position class (cut 2)
      if (label === "calls") cut2.calls++; else cut2.uses++
      if (unclaimedSamples.length < 8) unclaimedSamples.push(`${path.basename(f)} :: ${label} ${tgt}`)
    }
  }
  try { tree?.delete?.() } catch {}
}
// classify each claim against the run's own per-repo declaration key space (OFF-arm outcome)
const byClass = { resolved: 0, ambiguous: 0, unresolved: 0 }
const resolvedDetail: any[] = []
for (const c of claims) {
  const decls = declsByRepo.get(c.repo)?.get(c.target) ?? []
  const otherFiles = decls.filter((x: string) => x !== c.file)
  const cls = otherFiles.length === 0 ? "unresolved" : otherFiles.length === 1 ? "resolved" : "ambiguous"
  byClass[cls]++
  if (cls === "resolved") resolvedDetail.push({ file: path.relative(CR, c.file), label: c.label, target: c.target, specifier: c.specifier, decoyDeclFile: path.relative(CR, otherFiles[0]) })
}
const report = {
  instrument: "script/m14/kotlin-claim-arm-audit.ts",
  population: { admitted: files.length, repos: repos.size, swept: sample.length, parsed, skipped },
  claims: {
    emitted: claimRows,
    byLabel: claims.reduce((acc: Record<string, number>, c) => { acc[c.label] = (acc[c.label] ?? 0) + 1; return acc }, {}),
    byOffArmOutcome: byClass,
    resolvedDisplacements: resolvedDetail,
  },
  evidenceRows,
  cut2ReceiverResidual: { ...cut2, samples: unclaimedSamples },
  accounting: {
    emitted: claimRows,
    armBindOK: 2811,
    armResolvedDelta: -18,
    armAmbDelta: -1998,
    armUnresolvedDelta: -795,
    reproduced: byClass.resolved === 18 && byClass.ambiguous === 1998 && byClass.unresolved === 795,
    note: "emission count vs arm-verified: bindOK 2811 = every emitted claim verified (bindFAIL 0); the stride projection was ≈2,756 (sampling +55, 2.0% relative).",
  },
}
writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n")
console.log(JSON.stringify({ population: report.population, claims: { emitted: claimRows, byLabel: report.claims.byLabel, byOffArmOutcome: byClass, resolved: resolvedDetail }, evidenceRows, cut2: report.cut2ReceiverResidual, reproduced: report.accounting.reproduced }, null, 1))
