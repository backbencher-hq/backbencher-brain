// EXTQ / EXTOK CENSUS — the extQ triples (`ext?`, `extOK`, `extFAIL`) by claim kind and shape.
//
// WHY IT EXISTS, AND HOW IT RELATES TO `lane-residual-census.ts`. That instrument's
// `EXT-Q INVENTORY` is the per-shape enumerator of the unverifiable set and is where the shape table
// in `docs/analyzers/history/yaml-lane-notes.md` comes from. What it does NOT print is the other two thirds of the
// question: the set that IS verified, split by the claim kind and the evidence that confirmed it, and
// the set the project REFUTES. Those two are the control — a change that moved claims out of extQ by
// breaking the verified set would otherwise look like progress — and this prints all three triples
// over the same population, so the lane has two instruments agreeing on one number.
//
// `externalUnverified` is the one column that separates this lane from a formal PASS (`incoming-gate`
// requires `ext? = 0`) and the one column that CANNOT be reduced by marking differently: a claim the
// arbiter cannot check is neither a resolution nor a gap. The fleet's
// ruling on it (`archive/docs-pre-consolidation/analyzers-HANDOFF.md` §5v, "`extQ` IS A RULED CLASS") requires four things of
// a lane that stands on it — the SHAPE split by target form, the MECHANISM, the COUNT split by
// shape, and a FALSIFIER — and requires the split to happen BEFORE the ruling, because a subset
// will be "a claim the lane should stop making" rather than a claim nothing can check.
//
// That is what this prints. It reproduces the INCOMING GATE's own population (`yaml,yml`), its
// discovery, and its `parseFile(f, repoOf(f), { projectRoot: repoOf(f) })` call, then groups every
// `externalUnverified` edge by (relationship type) x (claim kind) x (target shape), with the top
// targets and one emitting file each. It prints the VERIFIED and REFUTED sets the same way, because
// "which claims CAN be verified" is the control: a change that broke the verified set would
// otherwise look like progress.
//
// MEASURED, at the revision that added the two document-claim fixes (`pointerClaim`,
// `workflowCallClaim`) and the dependency-position rule: `ext?` 1,903 -> 343, `extOK` 9,208 ->
// 10,701, `extFAIL` 0 -> 0. The 1,560 that moved were three shapes the lane should not have been
// claiming as external at all; the 343 that remain are the ruling. The BEFORE column is only
// reproducible at the parent revision (`git checkout HEAD~ -- src/ast/real-yaml-analyzer.ts`), which
// is a property of every before/after pair and not of this instrument.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/extq-census.ts > validation/m14/fixtures/yaml/extq-yaml-whole-corpus.txt
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { classifyEdge, externalClaimOf, isMarkedExternal } = await import(`${REPO}/script/m14/incoming-rule.ts`)
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = ["yaml", "yml"]
const maxFiles = Number(process.argv[2] ?? 0)
const log = (s: string) => process.stderr.write(s + "\n")

const repoOf = (abs: string): string => join(CR, path.relative(CR, abs).split(path.sep)[0] ?? "")

// ---- discovery, copied from incoming-gate.ts `discoverFiles` --------------------------------
const found: string[] = []
const repos = new Set<string>()
let absent = 0, overCap = 0, overCapLargest = 0
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith("." + e))) continue
    const abs = join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) { overCap++; overCapLargest = Math.max(overCapLargest, size); continue }
    } catch { absent++; continue }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()
const total = found.length
let files = found
if (maxFiles > 0 && total > maxFiles) {
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
  files = picked
}
const admittedByRepo = new Map<string, string[]>()
for (const abs of found) {
  const r = repoOf(abs)
  const list = admittedByRepo.get(r) ?? []
  list.push(abs)
  admittedByRepo.set(r, list)
}
const projectFacts = new Map<string, { packages: Set<string>; files: Set<string>; sdkLib: boolean }>()
for (const [repo, list] of admittedByRepo) {
  const fs2 = new Set<string>()
  for (const abs of list) {
    const rel = path.relative(repo, abs)
    if (rel.length > 0) fs2.add(rel.split(path.sep).join("/"))
  }
  projectFacts.set(repo, { packages: new Set(), files: fs2, sdkLib: false })
}

console.log(`corpus ${total} admitted .yaml/.yml · draw ${files.length} · repos ${repos.size} · absent ${absent} · overCap ${overCap} (largest ${overCapLargest})`)

/** A coarse, STATED shape vocabulary — nothing here is a rule, it only names the buckets. */
function shape(tgt: string): string {
  if (/\{\{|\$\{/.test(tgt)) return "template"
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(tgt)) return "uri-scheme"
  if (/[*?]/.test(tgt)) return "glob"
  if (tgt.startsWith("#")) return "json-pointer"
  if (tgt.startsWith("./") || tgt.startsWith("../")) return "relative-path"
  if (tgt.startsWith("/")) return "absolute-path"
  if (tgt.includes("@")) return "ref-pinned"
  if (tgt.includes("/")) return "owner-repo"
  if (tgt.includes(".")) return "dotted"
  if (tgt.includes(":")) return "colon"
  return "bare-name"
}

type Pend = {
  file: string; repo: string; label: string; tgt: string
  claim: ReturnType<typeof externalClaimOf>; sig: string; line: number | string
}
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
// ONLY claim-bearing edges are retained; the population totals come from `residual-gate`.
const pending: Pend[] = []
let parsed = 0, failed = 0
const t0 = Date.now()
for (const f of files) {
  if (parsed > 0 && parsed % 2000 === 0) log(`  … ${parsed}/${files.length} parsed ${Math.round((Date.now() - t0) / 1000)}s — ${path.basename(f)}`)
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    pDecl.set(name, (pDecl.get(name) ?? 0) + 1)
    let ks = pKinds.get(name); if (!ks) pKinds.set(name, (ks = new Set())); ks.add(kind)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) {
      pDecl.set(q, (pDecl.get(q) ?? 0) + 1)
      let qs = pKinds.get(q); if (!qs) pKinds.set(q, (qs = new Set())); qs.add(kind)
    }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!tgt) continue
    const claim = externalClaimOf(rel)
    if (claim === null && !isMarkedExternal(rel)) continue
    const md = rel?.metadata ?? {}
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
    markKeys.sort()
    pending.push({
      file: f, repo, label: String(rel?.type ?? rel?.relationshipType ?? ""),
      tgt, claim, sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      line: rel?.line_number ?? rel?.line ?? rel?.lineNumber ?? "?",
    })
  }
}

const byOutcome = new Map<string, number>()
const unverified: { e: Pend; kind: string }[] = []
const verified: { e: Pend; kind: string; verifiedBy?: string }[] = []
const refuted: { e: Pend; kind: string }[] = []
for (const e of pending) {
  const f = projectFacts.get(e.repo)
  const c = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, f)
  byOutcome.set(c.outcome, (byOutcome.get(c.outcome) ?? 0) + 1)
  const kind = e.claim?.kind ?? "(no claim)"
  if (c.outcome === "externalUnverified") unverified.push({ e, kind })
  else if (c.outcome === "externalVerified") verified.push({ e, kind, verifiedBy: c.verifiedBy })
  else if (c.outcome === "externalRefuted") refuted.push({ e, kind })
}

console.log(`parsed ${parsed} failed ${failed} · claim-bearing edges ${pending.length}`)
console.log("outcomes:", [...byOutcome.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "))

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) { const k = key(r); const l = m.get(k) ?? []; l.push(r); m.set(k, l) }
  return m
}

console.log(`\n================ externalUnverified: ${unverified.length} ================`)
for (const [k, rows] of [...group(unverified, (r) => `${r.e.label} | claim=${r.kind} | ${shape(r.e.tgt)}`).entries()]
  .sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n--- ${k}: ${rows.length}`)
  const byTgt = [...group(rows, (r) => r.e.tgt).entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [tgt, rs] of byTgt.slice(0, 10)) {
    const sample = rs[0].e
    console.log(`  ${String(rs.length).padStart(5)} × ${JSON.stringify(tgt)}`)
    console.log(`         markers=${sample.sig}`)
    console.log(`         in ${path.relative(CR, sample.file)}:${sample.line}`)
  }
  if (byTgt.length > 10) console.log(`  … ${byTgt.length - 10} more distinct targets`)
}

console.log(`\n================ externalVerified: ${verified.length} ================`)
for (const [k, rows] of [...group(verified, (r) => `${r.e.label} | claim=${r.kind} | by=${r.verifiedBy} | ${shape(r.e.tgt)}`).entries()]
  .sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(rows.length).padStart(6)}  ${k}`)
  const byTgt = [...group(rows, (r) => r.e.tgt).entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [tgt, rs] of byTgt.slice(0, 3)) console.log(`            ${String(rs.length).padStart(5)} × ${JSON.stringify(tgt)}  in ${path.relative(CR, rs[0].e.file)}`)
}

console.log(`\n================ externalRefuted: ${refuted.length} ================`)
for (const [tgt, rs] of [...group(refuted, (r) => r.e.tgt).entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
  console.log(`  ${String(rs.length).padStart(5)} × ${JSON.stringify(tgt)}  in ${path.relative(CR, rs[0].e.file)}`)
}
