/**
 * FQN KEY-SPACE PROBE — what would publishing each namespaced declaration's `metadata.fqn` as its
 * `qualifiedName` do to the gate's buckets, and would it REFUTE any existing external claim?
 *
 * The gate's key space is `name` + `qualifiedName` (`incoming-gate.ts`); `metadata.fqn` is NOT in it.
 * A class in a namespace publishes `name: "DatabaseInterface"`, `qualifiedName: null`,
 * `metadata.fqn: "PhpMyAdmin\\Dbal\\DatabaseInterface"` — while the `imports` edges that name it use
 * the FQN. So the FQN never enters the key space and those edges read unresolved.
 *
 * This builds BOTH key spaces over the whole population and re-classifies every edge, per PROJECT:
 *   CURRENT   name + qualifiedName
 *   PROPOSED  name + qualifiedName + metadata.fqn
 *
 * It also cross-tabs every edge carrying an external claim (`EXTERNAL_KEYS`, which the gate REFUTES
 * when the target IS declared), because a key space that resolves more names can turn a verified
 * external claim into a refutation — the one way this fix could make things worse.
 *
 *   npx tsx validation/m14/fixtures/php/tools/fqn-keyspace-probe.mts [--files=N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=0").split("=")[1])

// THE PRODUCTION PATH, not `analyzer.analyze` directly. The first version of this probe called the
// analyzer itself, and `pool-worker.ts` derives `qualifiedName` from `metadata.fqn` when the analyzer
// leaves it null — so the probe measured a key space PRODUCTION DOES NOT HAVE and reported a 16,202
// edge "win" that the gate had already banked (its imports row: 16,368 resolved). A measurement of a
// degraded invocation is a measurement of the invocation, not of the lane.
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { EXTERNAL_KEYS } = await import(path.join(ROOT, "script/m14/incoming-rule.ts"))

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

type Bucket = "res" | "amb" | "unres"
const bucketOf = (n: number): Bucket => (n === 1 ? "res" : n > 1 ? "amb" : "unres")
type Tally = { edges: number; cur: Record<Bucket, number>; pro: Record<Bucket, number> }
const perType: Record<string, Tally> = {}
const transitions: Record<string, number> = {}
let fqnOnly = 0, fqnConflicts = 0
const claimCross: Record<string, number> = {}
const examples: string[] = []
const regressions: string[] = []
// A claim on a target that is UNANSWERABLE today but answerable under the proposal is a NEW
// refutation (the gate refutes a claim whose target IS declared) — the one way this fix could
// make the lane worse. Claims on targets already answerable are pre-existing and not this change.
let newRefutations = 0, preExistingClaimCollisions = 0

for (const { repo, files } of repos) {
  const curCount = new Map<string, number>()
  const proCount = new Map<string, number>()
  const parsed: { file: string; rels: any[] }[] = []
  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    void content
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ file: abs, rels: res.relationships ?? [] })
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      const q = String(s.qualifiedName ?? "")
      // TASK-112: `fqn` IS CARRIED, BY RENAME. `pool-worker.ts` maps
      // `qualifiedName: s.qualifiedName || s.metadata?.fqn || …` (its symbol mapping), so on the
      // production path THIS probe imports, the fqn survives as `qualifiedName` and
      // `metadata.fqn` is `undefined` for every symbol. Reading only the metadata spelling made
      // `fq` `""` always, which made `fqnOnly` 0 BY CONSTRUCTION rather than by measurement, and
      // made the printed "fqn equal to name/qualifiedName already: 0" a structural zero.
      // FACTS: the production key space CANNOT distinguish "the analyzer set qualifiedName" from
      // "the worker derived it from fqn" — that is the cost of the rename. So `fq` is read from
      // where the value actually is, and `fqnConflicts` below is reported as an UPPER BOUND on
      // "the fqn is already a key".
      const fq = String(s.metadata?.fqn ?? s.qualifiedName ?? "")
      const keys = new Set<string>([n, q].filter((k) => k.length > 0))
      for (const k of keys) curCount.set(k, (curCount.get(k) ?? 0) + 1)
      const proKeys = new Set<string>(keys)
      if (fq.length > 0) { proKeys.add(fq); if (!keys.has(fq)) fqnOnly++ }
      for (const k of proKeys) proCount.set(k, (proCount.get(k) ?? 0) + 1)
      if (fq.length > 0 && (fq === n || fq === q)) fqnConflicts++
    }
  }
  for (const { file, rels } of parsed) {
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      const tgt = String(r.target ?? "")
      if (tgt.length === 0) continue
      const row = perType[t] ?? (perType[t] = { edges: 0, cur: { res: 0, amb: 0, unres: 0 }, pro: { res: 0, amb: 0, unres: 0 } })
      row.edges++
      const b1 = bucketOf(curCount.get(tgt) ?? 0)
      const b2 = bucketOf(proCount.get(tgt) ?? 0)
      row.cur[b1]++; row.pro[b2]++
      if (b1 !== b2) {
        const k = `${t}: ${b1}->${b2}`
        transitions[k] = (transitions[k] ?? 0) + 1
        if (b2 === "res" && b1 !== "res" && examples.length < 10) {
          examples.push(`${t}: ${String(r.source)} -> ${tgt}   ${b1} -> resolved   (${path.relative(CR, file)}:${r.line_number ?? "?"})`)
        }
        if (b1 === "res" && b2 !== "res" && regressions.length < 10) {
          regressions.push(`${t}: ${String(r.source)} -> ${tgt}   ${b1} -> ${b2}   (${path.relative(CR, file)}:${r.line_number ?? "?"})`)
        }
      }
      const md = (r.metadata ?? {}) as any
      const carried = EXTERNAL_KEYS.filter((key) => md[key] === true || (Array.isArray(md[key]) && md[key].length > 0))
      if (carried.length > 0) {
        if (b1 === "unres" && b2 !== "unres") {
          newRefutations++
          claimCross[`${t}: NEW refutation — claim on a target only the PROPOSED space answers (${b2})`] = (claimCross[`${t}: NEW refutation — claim on a target only the PROPOSED space answers (${b2})`] ?? 0) + 1
        } else if (b1 !== "unres") preExistingClaimCollisions++
      }
    }
  }
}

console.log(`php FQN key-space probe — ${N === 0 ? "WHOLE admitted population" : `stride sample of ${N} per repo`}`)
console.log(`symbols whose fqn is an ADDITIONAL key: ${fqnOnly}   (symbols whose non-empty qualifiedName already carries the fqn — an UPPER BOUND, because the production path cannot distinguish an analyzer-set qualifiedName from one the worker derived from fqn: ${fqnConflicts})`)
console.log(`\n${"type".padEnd(14)} ${"edges".padStart(8)} ${"cur res/amb/unres".padStart(20)} ${"pro res/amb/unres".padStart(20)}`)
for (const [t, r] of Object.entries(perType).sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(`${t.padEnd(14)} ${String(r.edges).padStart(8)} ${`${r.cur.res}/${r.cur.amb}/${r.cur.unres}`.padStart(20)} ${`${r.pro.res}/${r.pro.amb}/${r.pro.unres}`.padStart(20)}`)
}
console.log(`\nTRANSITIONS`)
for (const [k, v] of Object.entries(transitions).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}  ${k}`)
console.log(`\nREGRESSIONS (resolved -> not resolved):`)
if (regressions.length === 0) console.log(`  none`)
for (const e of regressions) console.log(`  ${e}`)
console.log(`\nCLAIM CROSS-TAB (a claim whose target the PROPOSED space can answer is REFUTED by the gate):`)
console.log(`  NEW refutations (claim was on an unresolvable target, proposal resolves or collides it): ${newRefutations}`)
console.log(`  pre-existing (claim on a target ALREADY answerable today, so already refuted): ${preExistingClaimCollisions}`)
if (Object.keys(claimCross).length === 0) console.log(`  no NEW refutations`)
for (const [k, v] of Object.entries(claimCross)) console.log(`  ${String(v).padStart(7)}  ${k}`)
console.log(`\nexamples (unresolved/ambiguous -> resolved):`)
for (const e of examples) console.log(`  ${e}`)
