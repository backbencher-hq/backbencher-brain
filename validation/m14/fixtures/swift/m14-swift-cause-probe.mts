/**
 * M14 SWIFT LANE — CAUSE PROBE (lane-owned fixture tooling, run from the repo root).
 *
 * Buckets the incoming gate's `unresolved` column by NAMED CAUSE with counts.
 *
 * Faithful to script/m14/incoming-gate.ts: same discovery (git ls-files + admitByExtension +
 * 1 MB cap + stride), same `parseFile(f, repoOf(f), { projectRoot: repoOf(f) })` call form,
 * same deferred classification over the COMPLETE project key space, and — the point — it
 * calls `classifyEdge` / `externalClaimOf` / `isContainsEdge` from script/m14/incoming-rule.ts
 * rather than re-implementing the rule, so the bucket counts close on the gate's own total.
 *
 *   bun run validation/m14/fixtures/swift/m14-swift-cause-probe.mts 400
 *
 * A `.mts` file is invisible to script/m14/run-fixtures.ts (matchesExt is `endsWith("." + ext)`,
 * so only `.swift` is a fixture source) and to the incoming gate (admitByExtension likewise).
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import {
  classifyEdge, externalClaimOf, isContainsEdge,
  type ProjectFacts,
} from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const LANG = "swift"
const EXTS = ["swift"]
const MAX = Number(process.argv[2] ?? 400)

function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

const found: string[] = []
const repos = new Set<string>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel, EXTS, LANG)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs); repos.add(name)
  }
}
found.sort()
const total = found.length
let files = found
if (MAX > 0 && total > MAX) {
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}
console.error(`discovered ${files.length} of ${total} .swift files across ${repos.size} repos`)

const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()

type Pending = { label: string; src: string; tgt: string; claim: any; sig: string; repo: string; srcFile: string; line: number | null; md: any }
const pending: Pending[] = []
let parsed = 0, failed = 0

for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo); if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo); if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string, file: string, line: number | null) => {
    const at = declPos.get(key)
    const pos = { file, line: line ?? -1 }
    if (!at) declPos.set(key, [pos])
    else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let qs = pKinds!.get(key); if (!qs) pKinds!.set(key, (qs = new Set()))
    qs.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const symLine = Number(s?.range?.startLine ?? s?.range?.start_line ?? s?.line_start ?? s?.lineStart ?? s?.startLine ?? s?.line ?? 0) || null
    countKey(name, String(s?.kind ?? ""), f, symLine)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== name) countKey(q, String(s?.kind ?? ""), f, symLine)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? ""); if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""); if (!tgt) continue
    const md = (rel as any)?.metadata ?? {}
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
    markKeys.sort()
    const edgeLine = Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null
    pending.push({ label, src: String((rel as any)?.source ?? (rel as any)?.from ?? ""), tgt, claim: externalClaimOf(rel), sig: markKeys.length ? markKeys.join("+") : "(no marker)", repo, srcFile: f, line: edgeLine, md })
  }
}

type Unres = { label: string; tgt: string; sig: string; srcFile: string; line: number | null; md: any; decls: number; kinds: string; spell: string }
const unres: Unres[] = []
/** the edges the arbiter confirms as external claims — the set a claim-routing fix MOVES */
const ext: Pending[] = []
const perType = new Map<string, Record<string, number>>()
const intent = new Map<string, { intended: number; sfu: number; twin: number; nothing: number }>()
for (const t of ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]) {
  perType.set(t, { edges: 0, resolved: 0, collRes: 0, amb: 0, unres: 0, extOK: 0, extq: 0, extFAIL: 0, bindOK: 0, bindq: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0 })
  intent.set(t, { intended: 0, sfu: 0, twin: 0, nothing: 0 })
}
const spellOf = (t: string, sig: string): string => {
  if (sig.includes("isImport") || sig.includes("importModule")) return "module-name (import specifier)"
  if (sig.includes("swiftOverride")) return "qualified-base-member"
  if (sig.includes("isImplements")) return "nominal-base"
  if (sig.includes("isInstantiation") || sig.includes("isSuperInit") || sig.includes("isSelfInit")) return "nominal-type"
  if (t === "extends") return "nominal-base"
  if (t === "calls" || t === "uses") {
    if (t === "uses" && sig.includes("isBareRead")) return "bare-name (unqualified)"
    if (sig.includes("isMemberRead")) return "member-read (unqualified)"
    if (sig.includes("isFieldAccess")) return "field-access"
    return "call-target (unqualified)"
  }
  return "other"
}
for (const e of pending) {
  const row = perType.get(e.label)!
  row.edges++
  const facts: ProjectFacts | undefined = undefined
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const pc = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, facts, isContainsEdge(e.label), ownFileDeclares)
  const ks = projectKinds.get(e.repo)!.get(e.tgt)
  const kindText = [...(ks ?? [])].sort().join("|")
  {
    const at = declPos.get(e.tgt) ?? []
    const own = at.filter((d) => d.file === e.srcFile)
    const it = intent.get(e.label)!
    if (at.length === 0) it.nothing++
    else if (e.label === "contains" || e.label === "exports") {
      if (own.some((d) => d.line === e.line)) it.intended++
      else if (own.length > 0) it.sfu++
      else it.twin++
    } else if (own.length > 0) it.sfu++
    else it.twin++
  }
  switch (pc.outcome) {
    case "resolved": row.resolved++; if (pc.boundAmongCollision) row.collRes++; break
    case "ambDeclOnly": case "ambBoth": row.amb++; break
    case "externalVerified": row.extOK++; ext.push(e); break
    case "externalUnverified": row.extq++; break
    case "externalRefuted": row.extFAIL++; break
    case "bindingVerified": row.bindOK++; break
    case "bindingUnverified": row.bindq++; break
    case "bindingRefuted": row.bindFAIL++; break
    case "causeDeclared": row.causeOK++; break
    case "causeRefuted": row.causeFAIL++; break
    default:
      row.unres++
      unres.push({ label: e.label, tgt: e.tgt, sig: e.sig, srcFile: e.srcFile, line: e.line, md: e.md, decls: pc.decls, kinds: kindText, spell: spellOf(e.label, e.sig) })
  }
}

console.log("=== TABLE 1 RECONSTRUCTION (probe) ===")
console.log("type          edges    resolved  collRes  amb      unres    extOK  ext?   extFAIL bindOK bind?  bindFAIL causeOK causeFAIL")
for (const [t, r] of perType) {
  console.log(`${t.padEnd(13)} ${String(r.edges).padStart(7)} ${String(r.resolved).padStart(9)} ${String(r.collRes).padStart(8)} ${String(r.amb).padStart(8)} ${String(r.unres).padStart(8)} ${String(r.extOK).padStart(6)} ${String(r.extq).padStart(6)} ${String(r.extFAIL).padStart(7)} ${String(r.bindOK).padStart(6)} ${String(r.bindq).padStart(6)} ${String(r.bindFAIL).padStart(8)} ${String(r.causeOK).padStart(7)} ${String(r.causeFAIL).padStart(9)}`)
}
{
  const tot = (k: string) => [...perType.values()].reduce((a, r) => a + (r as any)[k], 0)
  console.log(`TOTAL         ${String(tot("edges")).padStart(7)} ${String(tot("resolved")).padStart(9)} ${String(tot("collRes")).padStart(8)} ${String(tot("amb")).padStart(8)} ${String(tot("unres")).padStart(8)} ${String(tot("extOK")).padStart(6)} ${String(tot("extq")).padStart(6)} ${String(tot("extFAIL")).padStart(7)} ${String(tot("bindOK")).padStart(6)} ${String(tot("bindq")).padStart(6)} ${String(tot("bindFAIL")).padStart(8)} ${String(tot("causeOK")).padStart(7)} ${String(tot("causeFAIL")).padStart(9)}`)
}
console.log("\n=== INTENT ===")
for (const [t, r] of intent) console.log(`${t.padEnd(13)} intended ${String(r.intended).padStart(6)}  sfu ${String(r.sfu).padStart(6)}  twin ${String(r.twin).padStart(6)}  nothing ${String(r.nothing).padStart(6)}`)

const key = (u: Unres) => `${u.label} :: ${u.spell} :: ${u.sig}`
const buckets = new Map<string, Unres[]>()
for (const u of unres) { const k = key(u); const b = buckets.get(k); if (b) b.push(u); else buckets.set(k, [u]) }
console.log(`\n=== UNRESOLVED BUCKETS (total ${unres.length}) ===`)
const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [k, arr] of sorted) {
  const sample = [...new Set(arr.map((u) => u.tgt))].slice(0, 8)
  const sites = [...new Set(arr.map((u) => `${path.relative(CR, u.srcFile)}:${u.line ?? "?"}`))].slice(0, 4)
  console.log(`\n[${arr.length}] ${k}`)
  console.log(`    sample targets: ${sample.join(" | ")}`)
  console.log(`    sample sites  : ${sites.join(" | ")}`)
}
console.log(`\nSUM OF BUCKETS = ${sorted.reduce((a, [, arr]) => a + arr.length, 0)}  (unresolved total ${unres.length})`)

// A MACHINE-READABLE TAIL, so a companion can ask "is this name declared ANYWHERE in the corpus?"
// without re-parsing. `#` is not a legal Swift identifier character, so it is a safe field marker.
console.log(`\n=== UNRES_TSV (type\ttarget\trepo\tsig) ===`)
for (const u of unres) {
  const rel = u.srcFile.startsWith(CR) ? u.srcFile.slice(CR.length + 1) : u.srcFile
  console.log(`UNRES_TSV\t${u.label}\t${u.tgt}\t${rel.split(path.sep)[0]}\t${u.sig}`)
}

console.log(`\n=== EXT_TSV (type\tsource\ttarget\trelpath\tline) — the moved set (${ext.length}) ===`)
for (const e of ext) {
  const rel = e.srcFile.startsWith(CR) ? e.srcFile.slice(CR.length + 1) : e.srcFile
  console.log(`EXT_TSV\t${e.label}\t${e.src}\t${e.tgt}\t${rel}\t${e.line ?? ""}`)
}

const byTgt = new Map<string, number>()
for (const u of unres) { const k = `${u.label}\u0000${u.tgt}`; byTgt.set(k, (byTgt.get(k) ?? 0) + 1) }
console.log(`\n=== TOP 40 UNRESOLVED TARGETS ===`)
for (const [k, n] of [...byTgt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  const [l, t] = k.split("\u0000"); console.log(`${String(n).padStart(6)}  ${l.padEnd(13)} ${t}`)
}
