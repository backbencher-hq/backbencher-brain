/**
 * cpp-citation-displacement — measure the class the Lead's §18.27 falsifier exposed.
 *
 * The full-population citation arm measured: 23,019 claims, of which resolved fell 12,883 (43× the lane's
 * ~300 bound), amb fell 2,461 and unresolved fell 7,675 (closure exact). This instrument measures the
 * DISPLACED class directly on a bounded stride sample of files, using the FULL-population baseline dump as
 * ground truth:
 *
 *   - enumerate the citation claims this analyzer emits on the sampled files (flag on);
 *   - for each claim, match its exact row key (file, line, target) in the baseline dump:
 *       · present  -> the row was previously amb/unresolved = it was a WALL row (correct citation gain);
 *       · absent   -> the row was previously RESOLVED = the claim DISPLACED a name-model answer (the defect);
 *   - report the split, the displaced target spellings (the decoy census), and up to N source-spelling
 *     samples with their file:line so the story is shown, not asserted.
 *
 * The sample is for SPELLING EVIDENCE ONLY (matching is against the full dump, so each sampled row's
 * classification is exact); the exact whole-population split is the arm's own closure (12,883/2,461/7,675).
 * No heavy: default 800 files. `--files=0` would enumerate the whole population (operator-gated, not used here).
 *
 * USAGE: bun run script/m14/cpp-citation-displacement.ts [--files=800] [--json=path] [--text]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const EXTS = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const argOf = (f: string): string | null => { const j = process.argv.find((a) => a.startsWith(`${f}=`)); return j ? j.slice(f.length + 1) : null }
const FILES = Number(argOf("--files") ?? "800")
const DUMP = argOf("--dump") ?? path.join(ROOT, ".tmp-cpp", "cpp-noindex-cap0-dump.txt")
const JSON_OUT = argOf("--json")
const TEXT = process.argv.includes("--text")
if (!fs.existsSync(DUMP)) { console.error(`cpp-citation-displacement: baseline dump missing: ${DUMP}`); process.exit(2) }

// ── the admitted population, stride-sampled (the gate's discoverFiles shape) ─────────────────────────
const repos = fs.readdirSync(CR).filter((r) => fs.statSync(path.join(CR, r)).isDirectory())
const found: string[] = []
for (const repo of repos) {
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.has(rel.split(".").pop() ?? "")) continue
    const abs = path.join(CR, repo, rel)
    try { if (fs.statSync(abs).size <= 1024 * 1024) found.push(abs) } catch { /* absent */ }
  }
}
found.sort()
const stride = FILES > 0 ? Math.max(1, Math.floor(found.length / FILES)) : 1
const picked: string[] = []
for (let i = 0; i < found.length && (FILES <= 0 || picked.length < FILES); i += stride) picked.push(found[i])

// ── the baseline dump's non-resolved calls, as row keys ─────────────────────────────────────────────
const key = (file: string, line: number, target: string) => `${file}\u0000${line}\u0000${target}`
const nonResolved = new Set<string>()
for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
  const p = line.split("\t")
  if (p[0] !== "DUMP" || p[1] !== "calls") continue
  const where = p[4] ?? ""
  const m = where.match(/^(.*):(\d+)$/)
  if (!m) continue
  nonResolved.add(key(m[1], Number(m[2]), p[3]))
}

// ── enumerate claims on the sampled files ───────────────────────────────────────────────────────────
const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const cppMod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const parser: any = await getParser("cpp")
process.env.BB_CPP_CITATION = "1"
type Claim = { file: string; line: number; target: string; qualified: string; policy: string }
const claims: Claim[] = []
let parsed = 0
for (const abs of picked) {
  let src = ""
  try { src = fs.readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src, abs) } catch { continue }
  parsed++
  try {
    const rel = path.relative(CR, abs)
    const r: any = await new cppMod.RealCppAnalyzer().analyze(tree.rootNode, src, rel)
    for (const row of r.relationships ?? []) {
      if (row.type !== "calls") continue
      const ns = row.metadata?.languageNamespace
      if (!Array.isArray(ns)) continue
      claims.push({
        file: abs, line: Number(row.line_number), target: String(row.target),
        qualified: String(row.metadata?.qualified ?? ""),
        policy: String(row.metadata?.languageNamespacePolicy ?? ""),
      })
    }
  } finally { tree.delete?.() }
}
const displaced = claims.filter((c) => !nonResolved.has(key(c.file, c.line, c.target)))
const wall = claims.filter((c) => nonResolved.has(key(c.file, c.line, c.target)))
const tally = (xs: Claim[]) => { const m: Record<string, number> = {}; for (const x of xs) m[x.target] = (m[x.target] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25)) }

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-citation-displacement.ts",
  population: { admittedFiles: found.length, sampledFiles: picked.length, parsed },
  dump: path.relative(ROOT, DUMP),
  claims: { sampled: claims.length, walls: wall.length, displaced: displaced.length, displacedShare: claims.length > 0 ? displaced.length / claims.length : 0, policyMarkerOnAllClaims: claims.every((c) => c.policy === "strict-absent") },
  displacedTargets: tally(displaced),
  wallTargets: tally(wall),
  displacedSamples: displaced.slice(0, 40),
  note: "Displaced = absent from the full-population baseline dump = the row was RESOLVED before the citation and the claim withdrew it (the §18.27 defect class). Walls = present in the dump (amb/unresolved) = correct citation gain. Matching is against the FULL dump, so each sampled row's class is exact; the sample's share estimates the class, and the arm's own closure (12,883/2,461/7,675) is the exact whole-population split.",
}
if (TEXT) {
  console.log(`cpp-citation-displacement — ${picked.length} of ${found.length} files, ${claims.length} claims`)
  console.log(`  WALLS (previously amb/unresolved): ${wall.length}`)
  console.log(`  DISPLACED (previously resolved):   ${displaced.length} (${(report.claims.displacedShare * 100).toFixed(1)}%)`)
  console.log(`  policy marker on all claims: ${report.claims.policyMarkerOnAllClaims}`)
  console.log(`  displaced targets: ${JSON.stringify(report.displacedTargets)}`)
  console.log(`  samples: ${JSON.stringify(report.displacedSamples.slice(0, 8))}`)
} else if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1) + "\n")
if (!TEXT && !JSON_OUT) console.log(JSON.stringify(report, null, 1))
