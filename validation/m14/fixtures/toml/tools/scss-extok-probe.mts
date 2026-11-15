/**
 * WHERE DOES scss's `extOK` COME FROM? — the question markdown-lane could not answer by reading the
 * analyzer, because the column is not filled by the analyzer's own file.
 *
 * This runs the ARBITER'S OWN classifier (`classifyEdge`, `externalClaimOf`) over a bounded stride
 * sample on the production path, and for every edge that comes out `externalVerified` prints:
 *   - the relationship type it belongs to,
 *   - the claim KIND the arbiter read,
 *   - the metadata keys that carried it.
 *
 * If the verified column is produced by a claim, this names the claim. If a lane's verified edges
 * carry NO claim, that would mean the column is filled by a mechanism outside `classifyEdge`, which
 * is a finding about the gate.
 *
 *   npx tsx validation/m14/fixtures/toml/tools/scss-extok-probe.mts [--files=200]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=200").split("=")[1])
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { classifyEdge, externalClaimOf } = await import(path.join(ROOT, "script/m14/incoming-rule.ts"))

// The lane under examination, from the gate's own table (`incoming-gate.ts`: `scss: "scss"`).
const EXTS = ["scss"]

const byType: Record<string, { edges: number; verified: number }> = {}
const byClaim: Record<string, number> = {}
const byKeys: Record<string, number> = {}
const examples: string[] = []
let sampled = 0
let population = 0

for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const all: string[] = []
  for (const rel of tracked) {
    if (!EXTS.includes(rel.slice(rel.lastIndexOf(".") + 1).toLowerCase())) continue
    const abs = path.join(repo, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    all.push(abs)
  }
  all.sort()
  if (all.length === 0) continue
  population += all.length
  let files = all
  if (SAMPLE > 0 && all.length > SAMPLE) {
    const stride = all.length / SAMPLE
    const picked: string[] = []
    for (let i = 0; i < SAMPLE; i++) picked.push(all[Math.floor(i * stride)])
    files = [...new Set(picked)].sort()
  }
  const declCount = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  const parsed: { file: string; rels: any[] }[] = []
  for (const abs of files) {
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ file: abs, rels: res.relationships ?? [] })
    sampled++
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length === 0) continue
      declCount.set(n, (declCount.get(n) ?? 0) + 1)
      const k = kinds.get(n) ?? new Set<string>()
      k.add(String(s.kind ?? ""))
      kinds.set(n, k)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) {
        declCount.set(q, (declCount.get(q) ?? 0) + 1)
        const kq = kinds.get(q) ?? new Set<string>()
        kq.add(String(s.kind ?? ""))
        kinds.set(q, kq)
      }
    }
  }
  for (const { file, rels } of parsed) {
    for (const r of rels) {
      const t = String(r.type ?? "")
      const tgt = String(r.target ?? "")
      const row = byType[t] ?? (byType[t] = { edges: 0, verified: 0 })
      row.edges++
      const claim = externalClaimOf(r)
      const c = classifyEdge(declCount, kinds, tgt, claim) as { outcome: string }
      if (c.outcome !== "externalVerified") continue
      row.verified++
      const kind = claim === null ? "NO-CLAIM" : (claim as any).kind ?? "unknown"
      byClaim[kind] = (byClaim[kind] ?? 0) + 1
      const md = (r.metadata ?? {}) as Record<string, unknown>
      const sig = Object.keys(md).filter((k) => /external|claim|stdlib|module|ref|import|binding|ProjectFile/i.test(k)).sort().join("+") || "(no claim-shaped key)"
      byKeys[sig] = (byKeys[sig] ?? 0) + 1
      if (examples.length < 12) examples.push(`${t.padEnd(11)} ${tgt.slice(0, 48).padEnd(50)} claim=${kind.padEnd(14)} keys=${sig}   (${path.relative(repo, file)})`)
    }
  }
}

console.log(`scss extOK provenance — PRODUCTION path, stride sample of ${SAMPLE} per repo`)
console.log(`  files measured ${sampled} of ${population} admitted .scss`)
console.log(`\nper type (edges / externalVerified):`)
for (const [t, r] of Object.entries(byType).sort((a, b) => b[1].verified - a[1].verified)) {
  console.log(`  ${t.padEnd(12)} ${String(r.edges).padStart(6)} / ${r.verified}`)
}
console.log(`\nby CLAIM KIND the arbiter read:`)
for (const [k, v] of Object.entries(byClaim).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`)
console.log(`\nby metadata key signature:`)
for (const [k, v] of Object.entries(byKeys).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(50)} ${v}`)
console.log(`\nexamples:`)
for (const e of examples) console.log(`  ${e}`)
