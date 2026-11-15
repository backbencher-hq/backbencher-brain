// MAKE'S UNRESOLVED COLUMN, SPLIT — and the replica that is allowed to say so.
//
// The gate prints 1,211 unresolved of 1,830 on a 60-file stride and caps its worklist, so the lane
// cannot act on the number. This probe reproduces the gate's own columns (same discovery, same
// key space, same imported classification rule) at BOTH scopes, then splits the unresolved set by
// the analyzer's own `evidenceClass` AND by whether the project's FULL key space declares it:
//
//   in-corpus-exact   the project declares this name; the SAMPLE is why it did not resolve
//   in-corpus-owner   the owner of a dotted target is declared in the project
//   nowhere-in-corpus the project declares it nowhere -> an external tool/file/variable name
//
// Usage: bun .tmp-probe/make-lane/mk-unresolved-split.mts <maxFiles> [--repo=otp]
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "/home/ishaq2321/mcp/backbencher-brain/src/ast/pool-worker.ts"
import { classifyEdge, externalClaimOf, tally, emptyOutcomes } from "/home/ishaq2321/mcp/backbencher-brain/script/m14/incoming-rule.ts"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] || 60)
const REPO = (process.argv.find((a) => a.startsWith("--repo=")) ?? "").slice("--repo=".length)
const SIZE_CAP = 1024 * 1024

// ── discovery: incoming-gate.ts discoverFiles, for the `.mk` extension ────────────────────────
const found: string[] = []
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  if (REPO && name !== REPO) continue
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512e6 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".mk")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
let files = found
if (MAX > 0 && found.length > MAX) {
  const stride = Math.max(1, Math.floor(found.length / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
console.error(`scope: ${files.length} of ${found.length} .mk files${REPO ? ` (--repo=${REPO})` : " (stride sample)"}`)

// ── pass 1: walk the measured population, build its key space, stage the edges ────────────────
type Pending = { label: string; tgt: string; claim: any; repo: string; file: string; cls: string; evidenceClass: string; role: string }
const pending: Pending[] = []
const decl = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
let parsed = 0

const walk = async (list: string[], buildKeys: boolean) => {
  const declOut = buildKeys ? decl : null
  for (const f of list) {
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
    if (!r) continue
    if (buildKeys) parsed++
    const repo = repoOf(f)
    if (declOut) {
      let m = declOut.get(repo); if (!m) declOut.set(repo, (m = new Map()))
      let km = kinds.get(repo); if (!km) kinds.set(repo, (km = new Map()))
      const add = (k: string, kd: string) => {
        m!.set(k, (m!.get(k) ?? 0) + 1)
        let s = km!.get(k); if (!s) km!.set(k, (s = new Set())); s.add(kd)
      }
      for (const s of r.symbols ?? []) {
        const n = String(s?.name ?? ""); if (!n) continue
        add(n, String(s?.kind ?? ""))
        const q = String(s?.qualifiedName ?? "")
        if (q && q !== n) add(q, String(s?.kind ?? ""))
      }
    }
    for (const rel of r.relationships ?? []) {
      const label = String(rel?.type ?? rel?.relationshipType ?? "")
      if (!label) continue
      const tgt = String(rel?.target ?? "")
      if (!tgt) continue
      const md: any = (rel as any).metadata ?? {}
      pending.push({
        label, tgt, claim: externalClaimOf(rel), repo, file: f,
        cls: String(md.targetResolution ?? ""),
        evidenceClass: String(md.evidenceClass ?? ""),
        role: String(md.role ?? ""),
      })
    }
  }
}

// the MEASURED scope first (its key space is what the gate resolves against)
await walk(files, true)
const measuredDecl = decl

// ── pass 2: the FULL project key space, for the "would this resolve at project scope?" question
const fullDecl = new Map<string, Map<string, number>>()
const fullKinds = new Map<string, Map<string, Set<string>>>()
const allProjectFiles = found
{
  for (const f of allProjectFiles) {
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
    if (!r) continue
    const repo = repoOf(f)
    let m = fullDecl.get(repo); if (!m) fullDecl.set(repo, (m = new Map()))
    let km = fullKinds.get(repo); if (!km) fullKinds.set(repo, (km = new Map()))
    const add = (k: string, kd: string) => {
      m!.set(k, (m!.get(k) ?? 0) + 1)
      let s = km!.get(k); if (!s) km!.set(k, (s = new Set())); s.add(kd)
    }
    for (const s of r.symbols ?? []) {
      const n = String(s?.name ?? ""); if (!n) continue
      add(n, String(s?.kind ?? ""))
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== n) add(q, String(s?.kind ?? ""))
    }
  }
}

// ── classify: the gate's rule, measured scope (the verdict) and full project (the split) ──────
const totals = emptyOutcomes()
let edges = 0
const unresolved: any[] = []
for (const e of pending) {
  edges++
  const c = classifyEdge(measuredDecl.get(e.repo)!, kinds.get(e.repo)!, e.tgt, e.claim)
  tally(totals, c, e.tgt, e.label)
  if (c.outcome !== "unresolved") continue
  const fm = fullDecl.get(e.repo)
  const whole = fm ? (fm.get(e.tgt) ?? 0) : 0
  const owner = e.tgt.includes(".") ? e.tgt.slice(0, e.tgt.lastIndexOf(".")) : null
  const ownerHit = owner && fm ? (fm.get(owner) ?? 0) : 0
  unresolved.push({
    ...e, whole, ownerHit,
    projectScope: whole > 0 ? "in-corpus-exact" : ownerHit > 0 ? "in-corpus-owner" : "nowhere-in-corpus",
  })
}

console.log(`REPLICA (must equal the gate's line): edges ${edges}, resolved ${totals.resolved}, amb(decl) ${totals.ambiguousByDecl}, unresolved ${totals.unresolved}`)
let fullKeys = 0
for (const m of fullDecl.values()) fullKeys += m.size
console.log(`project key space: ${allProjectFiles.length} files, ${fullKeys} keys across ${fullDecl.size} repo(s)\n`)

const byProjectScope = new Map<string, number>()
const byEvidence = new Map<string, number>()
const byEvidenceUnresolved = new Map<string, number>()
for (const u of unresolved) {
  byProjectScope.set(u.projectScope, (byProjectScope.get(u.projectScope) ?? 0) + 1)
  byEvidenceUnresolved.set(u.evidenceClass || "(none)", (byEvidenceUnresolved.get(u.evidenceClass || "(none)") ?? 0) + 1)
}
for (const e of pending) byEvidence.set(e.evidenceClass || "(none)", (byEvidence.get(e.evidenceClass || "(none)") ?? 0) + 1)

console.log(`UNRESOLVED (${unresolved.length}) BY CLASS, judged against the PROJECT's full key space:`)
for (const [k, v] of [...byProjectScope].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
console.log(`\nUNRESOLVED BY THE ANALYZER'S OWN evidenceClass (all edges in parens):`)
for (const [k, v] of [...byEvidenceUnresolved].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k.padEnd(24)} (of ${byEvidence.get(k) ?? 0} edges)`)
console.log(`\nUNRESOLVED BY LABEL:`)
const byLabel = new Map<string, number>()
for (const u of unresolved) byLabel.set(u.label, (byLabel.get(u.label) ?? 0) + 1)
for (const [k, v] of [...byLabel].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
console.log(`\nSAMPLES (nowhere-in-corpus, first 12):`)
for (const u of unresolved.filter((x) => x.projectScope === "nowhere-in-corpus").slice(0, 12)) {
  console.log(`  ${u.label.padEnd(11)} ${JSON.stringify(u.tgt).slice(0, 46).padEnd(48)} ev=${u.evidenceClass} role=${u.role}  ${path.relative(CR, u.file)}`)
}
console.log(`\nSAMPLES (in-corpus-exact, first 8):`)
for (const u of unresolved.filter((x) => x.projectScope === "in-corpus-exact").slice(0, 8)) {
  console.log(`  ${u.label.padEnd(11)} ${JSON.stringify(u.tgt).slice(0, 46).padEnd(48)} declared x${u.whole}  ${path.relative(CR, u.file)}`)
}
