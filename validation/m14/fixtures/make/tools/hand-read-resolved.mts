// TEN EDGES THE MAKE FIX CAUSED TO RESOLVE — sampled, not chosen.
//
// The incoming gate reports a count; a count cannot say whether the claim the analyzer attached is
// TRUE of the code at that line. This probe re-walks the gate's own population with the production
// analyzer, keeps only the edges whose outcome CHANGED because of the new claim (externalVerified
// with the claim, unresolved without it), and prints for each one: `file:line`, the emitted target,
// the claim, the project-scope declaration count for that target, and THE SOURCE LINE ITSELF.
//
// Sampling is deterministic (round-robin across the claim's named constructs, then by file), so a
// second reader gets the same ten. The reading of them is in `validation/m14/verification/MAKE-FIX.md`.
//
// Usage: bun validation/m14/fixtures/make/tools/hand-read-resolved.mts [maxFiles]
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"
import { classifyEdge, externalClaimOf, isContainsEdge, type ExternalClaim } from "../../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] || 400)
const SIZE_CAP = 1024 * 1024
const EXTS = ["mk", "mak", "makefile"]
const admit = (rel: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === "make"
}
const found: string[] = []
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512e6 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!admit(rel)) continue
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

const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
type E = { label: string; tgt: string; claim: ExternalClaim | null; file: string; line: number; role: string; ev: string }
const pending: E[] = []
for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
  if (!r) continue
  const repo = repoOf(f)
  let d = projectDecl.get(repo); if (!d) projectDecl.set(repo, (d = new Map()))
  let k = projectKinds.get(repo); if (!k) projectKinds.set(repo, (k = new Map()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const n = String(s?.name ?? ""); if (!n) continue
    d.set(n, (d.get(n) ?? 0) + 1)
    let ks = k.get(n); if (!ks) k.set(n, (ks = new Set())); ks.add(String(s?.kind ?? ""))
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? "")
    const tgt = String(rel?.target ?? "")
    if (!label || !tgt) continue
    const md = (rel as any)?.metadata ?? {}
    pending.push({
      label, tgt, claim: externalClaimOf(rel), file: f,
      line: Number((rel as any)?.line_number ?? (rel as any)?.line ?? 0),
      role: String(md.role ?? ""), ev: String(md.evidenceClass ?? ""),
    })
  }
}
const outcome = (e: E, claim: ExternalClaim | null) =>
  classifyEdge(projectDecl.get(repoOf(e.file))!, projectKinds.get(repoOf(e.file))!, e.tgt, claim, undefined, isContainsEdge(e.label))

// THE POPULATION THE FIX MOVED: externalVerified now, unresolved if the claim is taken away.
const moved = pending.filter((e) => e.claim !== null && outcome(e, e.claim).outcome === "externalVerified" && outcome(e, null).outcome === "unresolved")
console.log(`edges the fix moved from unresolved to a VERIFIED external claim: ${moved.length}`)

// THE TRADE, NAMED: every edge the claim moved OUT of `resolved` (the namespace claim is checked
// before the declaration count, so a builtin/automatic-named edge that a project declaration was
// answering now reads as a claim instead). Printed with its declaration, not summarised away.
const lost = pending.filter((e) => e.claim !== null && outcome(e, null).outcome === "resolved" && outcome(e, e.claim).outcome !== "resolved")
console.log(`edges moved OUT of resolved by the claim: ${lost.length}`)
for (const e of lost) {
  const d = projectDecl.get(repoOf(e.file))!.get(e.tgt) ?? 0
  console.log(`  ${path.relative(CR, e.file)}:${e.line} target=${JSON.stringify(e.tgt)} [${e.label}/${e.ev}] project declarations=${d} -> ${outcome(e, e.claim).outcome}`)
}
// AND every edge the claim moved OUT of `amb(decl)` (the same early return on the ambiguous side).
const lostAmb = pending.filter((e) => e.claim !== null && ["ambDeclOnly", "ambBoth"].includes(outcome(e, null).outcome) && outcome(e, e.claim).outcome !== outcome(e, null).outcome)
console.log(`edges moved OUT of ambiguous by the claim: ${lostAmb.length} (evidenceClasses: ${[...new Set(lostAmb.map((e) => e.ev || e.role))].join(", ")})`)

const bucketOf = (e: E) => `${e.claim!.kind} · ${e.ev || e.role}`
const buckets = new Map<string, E[]>()
for (const e of moved) {
  const b = buckets.get(bucketOf(e)) ?? []
  b.push(e)
  buckets.set(bucketOf(e), b)
}
for (const b of buckets.values()) b.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line)

// round-robin across buckets, preferring a file not already used, until ten are drawn
const picked: E[] = []
const usedFiles = new Set<string>()
const order = [...buckets].sort((a, b) => b[1].length - a[1].length)
for (let pass = 0; picked.length < 10 && pass < 40; pass++) {
  for (const [, list] of order) {
    if (picked.length >= 10) break
    const cand = list.find((e) => !usedFiles.has(e.file) && !picked.includes(e)) ?? list.find((e) => !picked.includes(e))
    if (cand) { picked.push(cand); usedFiles.add(cand.file) }
  }
}
const contentCache = new Map<string, string[]>()
const sourceLine = (f: string, line: number): string => {
  let lines = contentCache.get(f)
  if (!lines) { try { lines = readFileSync(f, "utf8").split("\n") } catch { lines = [] } contentCache.set(f, lines) }
  return (lines[line - 1] ?? "(no such line)").trim().slice(0, 150)
}
console.log(`\nBUCKETS the ten were drawn from: ${[...buckets].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} (${v.length})`).join(" · ")}\n`)
picked.forEach((e, i) => {
  const repoRel = path.relative(CR, e.file)
  const decls = projectDecl.get(repoOf(e.file))?.get(e.tgt) ?? 0
  console.log(`${i + 1}. ${repoRel}:${e.line}`)
  console.log(`   emitted target : ${JSON.stringify(e.tgt)}   [${e.label} · role=${e.role || "(none)"} · evidenceClass=${e.ev || "(none)"}]`)
  console.log(`   claim attached : ${e.claim!.kind === "namespace" ? "languageNamespace (target is in the declared GNU Make name space)" : "isExternal (owner claim, verified by the project's own key space)"}`)
  console.log(`   project declares it: ${decls} time(s)`)
  console.log(`   SOURCE LINE    : ${sourceLine(e.file, e.line)}`)
  console.log("")
})
