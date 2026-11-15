/**
 * ZIG EXTERNAL-CLAIM AUDIT — what `zigExternalRef` marks, and what answers it.
 *
 * ## Why this instrument exists
 *
 * `script/m14/incoming-rule.ts:23-25` justifies the whole external-marking mechanism with a
 * number from THIS lane: "real-zig-analyzer.ts:2281 zigExternalReceiverPath, measured marking
 * 2,189 recoverable + 5,009 external edges
 * (validation/m14/fixtures/zig/measurements/incoming-abc-400-p30.json)". That file was written
 * 2026-10-05 and the analyzer has changed since. A rule resting on a stale measurement is the
 * failure class this programme keeps finding, so the number is re-derived here from the current
 * analyzer and the current corpus, and the SAME population is asked the question the incoming
 * gate asks: of the marked edges, how many does the project confirm, refute, or not check?
 *
 * ## The three questions, each answered with names
 *
 * (a) HOW MANY EDGES ARE MARKED. Every edge carrying an `EXTERNAL_KEYS` claim, by type, at the
 *     gate's own stride population — plus p30's second number, the marked edges whose target's
 *     LAST SEGMENT is a published name, which is the population Z66 rescued from binding to a
 *     same-named local declaration ("recoverable" in p30's vocabulary).
 * (b) OF THOSE, WHICH SURVIVE. `classifyEdge` (imported, never copied) in PROJECT scope, the
 *     scope `incoming-gate.ts` decides on: extOK (externalVerified) / extFAIL (externalRefuted) /
 *     ext? (externalUnverified).
 * (c) WHAT ANSWERS A REFUTED ONE. For every refuted claim: the target, the owner the arbiter
 *     looked up, that owner's declaration count and kinds, and the declarations themselves
 *     (file:line kind name) — because "the owner is published" is not actionable until a reader
 *     can see WHICH declaration published it and whether it is the file's own `@import` binding
 *     (Z35) or a real declaration of the name the target depends on. Those two are different
 *     findings and this instrument is what tells them apart.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/external-claim-audit.ts [--sample 400] [--out p.json]
 *   npx tsx validation/m14/fixtures/zig/external-claim-audit.ts --head 400 --out p.json   # p30's own draw
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import {
  classifyEdge, externalClaimOf, EXTERNAL_KEYS, targetOwner,
} from "../../../../script/m14/incoming-rule"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const HEAD = arg("head", "")
const SAMPLE = Number(arg("sample", "400"))
const OUT = arg("out", "")

// ───────────────────────────────────────────── population
// DEFAULT: the incoming gate's own draw (tracked *.zig under git repos, sorted, even stride).
// --head N: p30's draw (`find <root> -name '*.zig' | sort | head -N`) so the old number has a
// population to be compared on, named at the top of the report rather than assumed.
const found: string[] = []
if (HEAD) {
  const out = execFileSync("find", [CR, "-name", "*.zig", "-type", "f"], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  })
  for (const abs of out.split("\n").filter(Boolean).sort()) {
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
} else {
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".zig")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
}
const total = found.length
let files = found
if (HEAD) {
  files = found.slice(0, Number(HEAD))
} else if (SAMPLE > 0 && total > SAMPLE) {
  const stride = Math.max(1, Math.floor(total / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < SAMPLE; i += stride) picked.push(found[i])
  files = picked
}
/** the gate's project scope: the repository a file belongs to */
const repoOf = (f: string) => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0]!)
}

// ───────────────────────────────────────────── walk + key space, with declarations kept
type Decl = { file: string; line: number; kind: string; name: string; qname: string }
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const projectWho = new Map<string, Map<string, Decl[]>>()
type Pend = { repo: string; file: string; type: string; target: string; claim: any; marked: boolean; meta: any }
const pending: Pend[] = []
let parsed = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
  if (!r) continue
  parsed++
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  let pWho = projectWho.get(repo)
  if (!pWho) projectWho.set(repo, (pWho = new Map()))
  const rel = path.relative(CR, f)
  const count = (key: string, kind: string, d: Decl) => {
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let ps = pKinds!.get(key)
    if (!ps) pKinds!.set(key, (ps = new Set()))
    ps.add(kind)
    let ws = pWho!.get(key)
    if (!ws) pWho!.set(key, (ws = []))
    if (ws.length < 40) ws.push(d)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const nm = String(s?.name ?? "")
    if (nm.length === 0) continue
    const kind = String(s?.kind ?? "")
    const q = String(s?.qualifiedName ?? "")
    const d: Decl = { file: rel, line: Number(s?.line ?? 0), kind, name: nm, qname: q }
    count(nm, kind, d)
    if (q.length > 0 && q !== nm) count(q, kind, d)
  }
  for (const rl of Array.isArray(r.relationships) ? r.relationships : []) {
    const md = rl?.metadata ?? {}
    const marked = EXTERNAL_KEYS.some((k) => md[k] === true || (Array.isArray(md[k]) && md[k].length > 0))
    if (!marked) continue
    pending.push({
      repo, file: rel, type: String(rl?.type ?? ""), target: String(rl?.target ?? ""),
      claim: externalClaimOf(rl), marked, meta: md,
    })
  }
}

// ───────────────────────────────────────────── classify, and name what answers
type Refuted = {
  target: string; owner: string; type: string; files: string[]
  ownerDecls: number; ownerKinds: string; answering: Decl[]; answersInSameFile: boolean
}
const tally = { edges: 0, extOK: 0, extFAIL: 0, extUnv: 0, byTypeOK: new Map<string, number>(), byTypeFAIL: new Map<string, number>(), byTypeUnv: new Map<string, number>() }
/** depth cross-tab: how many DOTS the target has (owner === alias at 1) x outcome, so a rule
 *  that would drop the claim on the alias-owned targets can be checked against the data rather
 *  than argued for. 0 dots = a bare target (no receiver at all). */
const depthTab = new Map<string, { extOK: number; extFAIL: number; extUnv: number }>()
const bumpDepth = (dots: number, bucket: "extOK" | "extFAIL" | "extUnv") => {
  const k = String(dots)
  const row = depthTab.get(k) ?? { extOK: 0, extFAIL: 0, extUnv: 0 }
  row[bucket]++
  depthTab.set(k, row)
}
const refuted: Refuted[] = []
const refutedByTarget = new Map<string, Refuted>()
/** p30's "recoverable": marked edges whose target's LAST SEGMENT is a published name */
let recoverableEdges = 0
const recoverableByType = new Map<string, number>()
const markedByType = new Map<string, number>()

for (const p of pending) {
  tally.edges++
  markedByType.set(p.type, (markedByType.get(p.type) ?? 0) + 1)
  const leaf = p.target.includes(".") ? p.target.slice(p.target.lastIndexOf(".") + 1) : p.target
  if ((projectDecl.get(p.repo)!.get(leaf) ?? 0) > 0) {
    recoverableEdges++
    recoverableByType.set(p.type, (recoverableByType.get(p.type) ?? 0) + 1)
  }
  const c = classifyEdge(projectDecl.get(p.repo)!, projectKinds.get(p.repo)!, p.target, p.claim)
  const bucket =
    c.outcome === "externalVerified" ? "extOK" :
    c.outcome === "externalRefuted" ? "extFAIL" : "extUnv"
  const m = bucket === "extOK" ? tally.byTypeOK : bucket === "extFAIL" ? tally.byTypeFAIL : tally.byTypeUnv
  m.set(p.type, (m.get(p.type) ?? 0) + 1)
  tally[bucket]++
  let dots = 0
  for (const ch of p.target) if (ch === ".") dots++
  bumpDepth(dots, bucket as "extOK" | "extFAIL" | "extUnv")
  if (bucket !== "extFAIL") continue
  const owner = targetOwner(p.target) ?? ""
  const pd = projectDecl.get(p.repo)!
  const pk = projectKinds.get(p.repo)!
  const who = projectWho.get(p.repo)!.get(owner) ?? []
  let rec = refutedByTarget.get(`${p.repo}|${p.target}`)
  if (!rec) {
    rec = {
      target: p.target, owner, type: p.type, files: [], ownerDecls: pd.get(owner) ?? 0,
      ownerKinds: [...(pk.get(owner) ?? [])].sort().join("|"), answering: who.slice(0, 6),
      answersInSameFile: who.some((d) => d.file === p.file),
    }
    refutedByTarget.set(`${p.repo}|${p.target}`, rec)
    refuted.push(rec)
  }
  if (rec.files.length < 5 && !rec.files.includes(p.file)) rec.files.push(p.file)
}

const report = {
  population: { mode: HEAD ? `find|sort|head ${HEAD}` : `gate stride ${SAMPLE}`, files: files.length, corpusTotal: total, parsed },
  marked: { edges: tally.edges, byType: Object.fromEntries(markedByType) },
  outcome: {
    extOK: tally.extOK, extFAIL: tally.extFAIL, extUnverified: tally.extUnv,
    byTypeOK: Object.fromEntries(tally.byTypeOK), byTypeFAIL: Object.fromEntries(tally.byTypeFAIL),
    byTypeUnverified: Object.fromEntries(tally.byTypeUnv),
  },
  p30Comparable: {
    markedEdgesAllShapes: tally.edges,
    recoverableEdgesLeafPublished: recoverableEdges,
    recoverableByType: Object.fromEntries(recoverableByType),
  },
  refutedTargets: refuted,
  depthCrossTab: Object.fromEntries([...depthTab.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))),
}
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))

console.log(`zig external-claim audit — ${report.population.mode}; ${parsed} parsed of ${files.length} (corpus ${total} .zig)`)
console.log(`\n(a) MARKED EDGES NOW: ${tally.edges}`)
console.log(`    by type: ${JSON.stringify(Object.fromEntries(markedByType))}`)
console.log(`    p30-comparable: markedEdgesAllShapes ${tally.edges} (p30 said 5,009)`)
console.log(`    p30-comparable: recoverable (target leaf IS published) ${recoverableEdges} (p30 said 2,189) ${JSON.stringify(Object.fromEntries(recoverableByType))}`)
console.log(`\n(b) OF THOSE: extOK ${tally.extOK} · extFAIL ${tally.extFAIL} · ext? ${tally.extUnv}`)
console.log(`    extOK by type  ${JSON.stringify(Object.fromEntries(tally.byTypeOK))}`)
console.log(`    extFAIL by type ${JSON.stringify(Object.fromEntries(tally.byTypeFAIL))}`)
console.log(`    ext? by type   ${JSON.stringify(Object.fromEntries(tally.byTypeUnv))}`)
console.log(`\n(b2) BY TARGET DEPTH (dots) x OUTCOME — owner === alias at 1 dot:`)
for (const [k, v] of [...depthTab.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`    ${k} dot(s):  extOK ${String(v.extOK).padStart(5)}   extFAIL ${String(v.extFAIL).padStart(5)}   ext? ${String(v.extUnv).padStart(5)}`)
}
console.log(`\n(c) DISTINCT REFUTED TARGETS: ${refuted.length}`)
for (const r of refuted.sort((a, b) => b.ownerDecls - a.ownerDecls).slice(0, 40)) {
  console.log(
    `  ${r.type.padEnd(11)} ${r.target.padEnd(34)} owner=${r.owner.padEnd(18)} decls=${String(r.ownerDecls).padStart(3)} kinds=${r.ownerKinds.padEnd(20)} sameFileBinding=${r.answersInSameFile}`,
  )
  for (const d of r.answering.slice(0, 3)) console.log(`        answered by ${d.file}:${d.line} ${d.kind} ${JSON.stringify(d.name)}`)
}
const bindingAnswered = refuted.filter((r) => r.answersInSameFile).length
console.log(`\n  refuted targets whose owner is declared IN THE EDGE'S OWN FILE: ${bindingAnswered} / ${refuted.length}`)
