// PRODUCTION ADMISSION — WHICH files does the gate admit that the INDEXER ITSELF skips?
//
// The fleet question: `incoming-gate`/`residual-gate` admit a file by EXTENSION over the git-tracked
// population, while `parallel-indexer` drops a file whose path matches `skipPatterns` before it is
// ever parsed. If the two sets differ, every lane's residual is computed over files PRODUCTION NEVER
// SEES — a qualifier on all six verdicts — or the difference is immaterial, and either answer has to
// be a NUMBER rather than a worry.
//
// The rule is IMPORTED (`ParallelIndexerConfig.skipPatterns`, the same list `shouldSkip` uses) rather
// than re-spelled, so this measures the indexer's admission and not a copy of it.
//
//   npx tsx validation/m14/fixtures/yaml/production-admission-diff.ts
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { ParallelIndexerConfig } = await import(`${REPO}/src/ast/parallel-indexer.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = [".yaml", ".yml"]
const PATTERNS: RegExp[] = (ParallelIndexerConfig as any).skipPatterns
const skips = (p: string): RegExp | null => PATTERNS.find((re) => re.test(p)) ?? null

let admitted = 0
const excluded: { repo: string; rel: string; pattern: string }[] = []
const byPattern = new Map<string, number>()
const byRepo = new Map<string, number>()
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    admitted++
    // THE ABSOLUTE path, which is what the discovery phase hands the matcher.
    const hit = skips(abs) ?? skips(rel)
    if (hit) {
      excluded.push({ repo: name, rel, pattern: String(hit) })
      byPattern.set(String(hit), (byPattern.get(String(hit)) ?? 0) + 1)
      byRepo.set(name, (byRepo.get(name) ?? 0) + 1)
    }
  }
}

console.log(`gate-admitted population: ${admitted} .yaml/.yml files`)
console.log(`REFUSED BY THE INDEXER'S OWN skipPatterns: ${excluded.length} file(s)\n`)
console.log(`by pattern:`)
for (const [p, n] of [...byPattern.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${p}`)
console.log(`\nby repository:`)
for (const [r, n] of [...byRepo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`)
console.log(`\nthe files (repo/relpath):`)
for (const e of excluded) console.log(`  ${e.repo}/${e.rel}   [${e.pattern}]`)
writeFileSync(`${REPO}/validation/m14/fixtures/yaml/production-admission-diff.json`, JSON.stringify({
  admitted, excluded: excluded.length, byPattern: Object.fromEntries(byPattern), byRepo: Object.fromEntries(byRepo), files: excluded,
}, null, 1))
