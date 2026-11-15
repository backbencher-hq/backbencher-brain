/**
 * OWNER-CLAIM CROSS-TAB — before attaching an external claim to a member call whose declaration is
 * outside the file, how many such edges would the gate VERIFY and how many would it REFUTE?
 *
 * The rule the Lead set: a name genuinely outside the population gets the external marker, and a
 * claim whose target IS declared in the project is REFUTED (counted as `extFAIL`, which must be 0).
 * The gate checks that BEFORE the count, so an edge that would otherwise resolve cleanly becomes a
 * refutation the moment it carries a claim — which is why the claim may only be attached where the
 * target names nothing in the project.
 *
 * The analyzer sees ONE FILE. This measures, per PROJECT (the gate's scope, on the production path),
 * how the population splits for every `calls`/`uses` edge that carries `metadata.owner`:
 *
 *   declCount == 0   a claim here would VERIFY (the target names nothing in the project)
 *   declCount  > 0   a claim here would REFUTE (and today the edge resolves or is ambiguous)
 *
 * A refuting share that is not zero is the boundary of what a per-file rule can safely claim.
 *
 *   npx tsx validation/m14/fixtures/php/tools/owner-claim-crosstab.mts [--files=N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=0").split("=")[1])
// THE PRODUCTION PATH, not `analyzer.analyze`: pool-worker derives `qualifiedName` from
// `metadata.fqn`, and a probe on the direct path measures a key space production does not have.
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const repos: { repo: string; files: string[] }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  files.sort()
  if (files.length > 0) repos.push({ repo: dir, files })
}
if (N > 0) for (const r of repos) {
  const stride = Math.max(1, Math.floor(r.files.length / Math.max(1, N)))
  r.files = r.files.filter((_, i) => i % stride === 0).slice(0, N)
}

type Row = { edges: number; withOwner: number; verify: number; refute: number; alreadyClaimed: number }
const perType: Record<string, Row> = {}
const refuteTop = new Map<string, number>()
const verifyTop = new Map<string, number>()
const refuteRepos = new Map<string, number>()

for (const { repo, files } of repos) {
  const declCount = new Map<string, number>()
  const parsed: { file: string; rels: any[] }[] = []
  for (const abs of files) {
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ file: abs, rels: res.relationships ?? [] })
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length > 0) declCount.set(n, (declCount.get(n) ?? 0) + 1)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) declCount.set(q, (declCount.get(q) ?? 0) + 1)
    }
  }
  for (const { file, rels } of parsed) {
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      if (t !== "calls" && t !== "uses") continue
      const md = (r.metadata ?? {}) as any
      const owner = typeof md.owner === "string" ? md.owner : ""
      if (owner.length === 0) continue
      const tgt = String(r.target ?? "")
      if (tgt.length === 0) continue
      const row = perType[t] ?? (perType[t] = { edges: 0, withOwner: 0, verify: 0, refute: 0, alreadyClaimed: 0 })
      row.edges++
      row.withOwner++
      if (md.external === true) row.alreadyClaimed++
      const n = declCount.get(tgt) ?? 0
      if (n === 0) {
        row.verify++
        verifyTop.set(tgt, (verifyTop.get(tgt) ?? 0) + 1)
      } else {
        row.refute++
        refuteTop.set(tgt, (refuteTop.get(tgt) ?? 0) + 1)
        refuteRepos.set(path.basename(repo), (refuteRepos.get(path.basename(repo)) ?? 0) + 1)
      }
    }
  }
}

console.log(`php owner-claim cross-tab — ${N === 0 ? "WHOLE admitted population" : `stride sample of ${N} per repo`}`)
console.log(`${"type".padEnd(10)} ${"edges".padStart(8)} ${"with owner".padStart(11)} ${"claim VERIFIES".padStart(15)} ${"claim REFUTES".padStart(14)} ${"already claimed".padStart(16)}`)
for (const [t, r] of Object.entries(perType)) {
  console.log(`${t.padEnd(10)} ${String(r.edges).padStart(8)} ${String(r.withOwner).padStart(11)} ${String(r.verify).padStart(15)} ${String(r.refute).padStart(14)} ${String(r.alreadyClaimed).padStart(16)}`)
}
console.log(`\nA BLANKET claim on owner-carrying member edges would verify ${[...Object.values(perType)].reduce((n, r) => n + r.verify, 0)} and REFUTE ${[...Object.values(perType)].reduce((n, r) => n + r.refute, 0)} — and every refutation is an extFAIL, which must be 0.`)
console.log(`\ntop targets a claim would VERIFY:`)
console.log("  " + [...verifyTop].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `${n}×${c}`).join("  "))
console.log(`\ntop targets a claim would REFUTE:`)
console.log("  " + [...refuteTop].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `${n}×${c}`).join("  "))
console.log(`\nwhere the refutations live (repos, top 10):`)
console.log("  " + [...refuteRepos].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n}×${c}`).join("  "))
