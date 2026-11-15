/**
 * RESIDUAL COMPOSITION PROBE — is php's unresolved population composed ENTIRELY of ruled classes, or
 * is there an unattributed remainder?
 *
 * Per type, every edge the gate's key space cannot answer is classified into exactly one bucket, so
 * "attributed" stops being a claim and becomes a partition:
 *
 *   include_path        a path target (`metadata.relationshipType: "include_path"`) — RULED
 *                       (PHP-INCLUDE-PATHS: 147 claimed, 61 ruled)
 *   builtin_unclaimed   the target is a PHP internal symbol (`phpInternalKind`) and the edge carries
 *                       NO external claim — a DEFECT if any exist: the lane has a table for this
 *   leaf_declared       the target's LAST SEGMENT is declared in the project but the full spelling is
 *                       not (an FQN whose leaf exists) — a SPELLING question, measurable, possibly
 *                       fixable, and NOT a boundary until measured
 *   owner_provable      the edge carries `metadata.owner` AND the file's own symbol table publishes
 *                       `<owner>.<target>` — by construction this cannot be unresolved (the bare name
 *                       would be in the key space), so a NON-ZERO count here would REFUTE the
 *                       owner-qualification rule's completeness claim
 *   vendor_unknown      nothing above: the name is outside the population — the ruled boundary
 *
 *   npx tsx validation/m14/fixtures/php/tools/residual-composition-probe.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { phpInternalKind } = await import(path.join(ROOT, "src/ast/php-internal-symbols.ts"))
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

type Buckets = { unresolved: number; claimed: number; include_path: number; builtin_unclaimed: number; leaf_declared: number; owner_provable: number; vendor_unknown: number; vendor_multi_repo: number }
const perType: Record<string, Buckets> = {}
const leafExamples = new Map<string, number>()
let sameNs = 0, otherNs = 0
const sameNsExamples: string[] = []
const otherNsExamples: string[] = []
const vendorTop = new Map<string, Map<string, number>>()
const targetRepos = new Map<string, Set<string>>()
const vendorSeen: { row: Buckets; tgt: string }[] = []
const ownerExamples: string[] = []

for (const { repo, files } of repos) {
  const keyCount = new Map<string, number>()
  const leafCount = new Map<string, number>()
  const leafFqns = new Map<string, string[]>()
  const parsed: { file: string; rels: any[]; symbols: any[] }[] = []
  for (const abs of files) {
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ file: abs, rels: res.relationships ?? [], symbols: res.symbols ?? [] })
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length === 0) continue
      keyCount.set(n, (keyCount.get(n) ?? 0) + 1)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) keyCount.set(q, (keyCount.get(q) ?? 0) + 1)
      const leaf = n.includes("\\") ? n.slice(n.lastIndexOf("\\") + 1) : n
      leafCount.set(leaf, (leafCount.get(leaf) ?? 0) + 1)
      // WHICH declarations carry that leaf, by their own fqn — so a bare leaf match can be told
      // apart from a declaration in the SAME namespace the target names (a real spelling defect).
      const fq = String(s.metadata?.fqn ?? q ?? n)
      const arr = leafFqns.get(leaf) ?? []
      if (arr.length < 6 && !arr.includes(fq)) arr.push(fq)
      leafFqns.set(leaf, arr)
    }
  }
  for (const { file, rels, symbols } of parsed) {
    const members = new Set<string>()
    void leafFqns
    for (const s of symbols) {
      const k = String(s.kind ?? "")
      if (!s.ownerName || !["class", "interface", "trait", "enum"].includes(k)) continue
      members.add(`${s.ownerName}.${s.name}`)
    }
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      const tgt = String(r.target ?? "")
      if (tgt.length === 0) continue
      if ((keyCount.get(tgt) ?? 0) > 0) continue // answerable: not this probe's population
      const md = (r.metadata ?? {}) as any
      const row = perType[t] ?? (perType[t] = { unresolved: 0, claimed: 0, include_path: 0, builtin_unclaimed: 0, leaf_declared: 0, owner_provable: 0, vendor_unknown: 0, vendor_multi_repo: 0 })
      row.unresolved++
      targetRepos.get(tgt)?.add(repo) ?? targetRepos.set(tgt, new Set([repo]))
      const carried = EXTERNAL_KEYS.some((k) => md[k] === true || (Array.isArray(md[k]) && md[k].length > 0))
      // THE GATE'S `unresolved` EXCLUDES CLAIMED EDGES — a claim routes to externalVerified/Refuted
      // before the count is read — so a composition that maps onto the gate's number must skip them.
      // They are counted separately rather than dropped, because a claim is a statement about the
      // edge and its absence here is what "unresolved" means.
      if (carried) { row.claimed++; continue }
      const owner = typeof md.owner === "string" ? md.owner : ""
      if (owner.length > 0 && members.has(`${owner}.${tgt}`)) {
        row.owner_provable++
        if (ownerExamples.length < 8) ownerExamples.push(`${t}: ${String(r.source)} -> ${tgt} (owner ${owner})   (${path.relative(CR, file)})`)
        continue
      }
      if (md.relationshipType === "include_path") { row.include_path++; continue }
      if (!carried && phpInternalKind(tgt) !== null) { row.builtin_unclaimed++; continue }
      const leaf = tgt.includes("\\") ? tgt.slice(tgt.lastIndexOf("\\") + 1) : tgt
      if (leaf !== tgt && (leafCount.get(leaf) ?? 0) > 0) {
        row.leaf_declared++
        leafExamples.set(tgt, (leafExamples.get(tgt) ?? 0) + 1)
        // SAME NAMESPACE? The target names a namespace prefix; a declaration whose own fqn shares
        // that prefix is the same class published under a spelling the key space does not hold — a
        // real defect. A declaration in a DIFFERENT namespace is a leaf coincidence: the target's
        // class is simply not in this project.
        const prefix = tgt.includes("\\") ? tgt.slice(0, tgt.lastIndexOf("\\") + 1) : ""
        const fqns = leafFqns.get(leaf) ?? []
        if (prefix.length > 0 && fqns.some((f) => f.startsWith(prefix))) {
          sameNs++
          if (sameNsExamples.length < 8) sameNsExamples.push(`${tgt}   leaf declared as ${fqns.filter((f) => f.startsWith(prefix)).join(", ")}`)
        } else {
          otherNs++
          if (otherNsExamples.length < 8) otherNsExamples.push(`${tgt}   leaf declared as ${fqns.join(", ")}`)
        }
        continue
      }
      row.vendor_unknown++
      vendorSeen.push({ row, tgt })
      {
        const m = vendorTop.get(t) ?? new Map<string, number>()
        m.set(tgt, (m.get(tgt) ?? 0) + 1)
        vendorTop.set(t, m)
      }
    }
  }
}

// REPO-SPREAD on the vendor_unknown class, because the lane's own doc says a name targeted from
// exactly ONE repo cannot be told apart from a declaration this analyzer failed to publish — so the
// boundary's strength is measured rather than assumed.
for (const { row, tgt } of vendorSeen) if ((targetRepos.get(tgt)?.size ?? 0) > 1) row.vendor_multi_repo++
const cols = ["unresolved", "claimed", "include_path", "builtin_unclaimed", "leaf_declared", "owner_provable", "vendor_unknown", "vendor_multi_repo"] as const
console.log(`php residual composition — whole admitted population (production path)`)
console.log(`${"type".padEnd(14)} ${cols.map((c) => c.padStart(17)).join(" ")}`)
const totals: Record<string, number> = {}
for (const c of cols) totals[c] = 0
for (const [t, r] of Object.entries(perType).sort((a, b) => b[1].unresolved - a[1].unresolved)) {
  console.log(`${t.padEnd(14)} ${cols.map((c) => String(r[c]).padStart(17)).join(" ")}`)
  for (const c of cols) totals[c] += r[c]
}
console.log(`${"TOTAL".padEnd(14)} ${cols.map((c) => String(totals[c]).padStart(17)).join(" ")}`)
const gateUnresolved = totals.unresolved - totals.claimed
console.log(`\nUNRESOLVED IN THE GATE'S SENSE (no claim, no declaration): ${gateUnresolved}`)
console.log(`  of it: include_path ${totals.include_path} (RULED) · vendor_unknown ${totals.vendor_unknown} (RULED boundary) · owner_provable ${totals.owner_provable} (would refute the qualification rule) · builtin_unclaimed ${totals.builtin_unclaimed} (a DEFECT if non-zero) · leaf_declared ${totals.leaf_declared} (UNRULED: an FQN whose leaf the project declares)`)
console.log(`  UNATTRIBUTED REMAINDER beyond the ruled classes: ${gateUnresolved - totals.include_path - totals.vendor_unknown - totals.owner_provable}`)
console.log(`\nLEAF-DECLARED SPLIT — same namespace (a REAL spelling defect) vs a leaf coincidence (the vendor boundary):`)
console.log(`  same namespace : ${sameNs}`)
console.log(`  other namespace: ${otherNs}`)
for (const e of sameNsExamples) console.log(`    SAME-NS ${e}`)
for (const e of otherNsExamples) console.log(`    other   ${e}`)
console.log(`\nREPO-SPREAD of vendor_unknown: multi-repo ${totals.vendor_multi_repo} · single-repo ${totals.vendor_unknown - totals.vendor_multi_repo}`)
console.log(`  (a name targeted from >= 2 independent repos that NEITHER declares is external evidence; one repo cannot be told apart from a publication miss — the lane doc's own limit)`)
console.log(`\nTOP vendor_unknown TARGETS PER TYPE (the class that names nothing):`)
for (const [t, m] of [...vendorTop].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
  const tot = [...m.values()].reduce((x, y) => x + y, 0)
  console.log(`  ${t} (${tot}): ` + [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}×${c}`).join("  "))
}
console.log(`\ntop leaf-declared targets (an FQN whose LEAF the project declares):`)
console.log("  " + [...leafExamples].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `${n}×${c}`).join("  "))
console.log(`\nowner-provable-but-unresolved examples (non-zero would REFUTE the qualification rule's completeness):`)
for (const e of ownerExamples) console.log(`  ${e}`)
if (ownerExamples.length === 0) console.log(`  none`)
