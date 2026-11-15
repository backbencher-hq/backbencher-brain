/**
 * MARKDOWN RESIDUAL BUCKETS — the `unresolved` and `amb(decl)` columns split by NAMED
 * CONSTRUCT, over the SAME population the incoming gate measures at the same cap.
 *
 * ## Why this exists
 *
 * The gate prints the residual (`266 ambiguous + 332 unresolved of 12904 edges` at the
 * 400-file cap) and a worklist that is CAPPED at 25 names per type, so the cause mix
 * cannot be read off its report. Clause 2 wants every unresolved edge classified by a
 * named cause with a measured count, and this probe produces that split.
 *
 * ## The population is the gate's, not a new one
 *
 * Discovery (git ls-files per corpus repo, `.md` admission, 1 MB cap, sorted, stride to
 * the cap) and the resolution scope (the file's OWN PROJECT, name + qualifiedName alias
 * keys) are copied from `script/m14/incoming-gate.ts` deliberately: a census that
 * discovers its own population measures a different question. `parseFile` is the
 * production entry point, exactly as the gate calls it.
 *
 * ## What it measures
 *
 *   1. UNRESOLVED edges, bucketed by the construct that produced the target:
 *      link-kind (repoRelativePath / bareToken / externalUri / autolink) crossed with
 *      WHY the path named nothing (dead path, site-absolute path, target file present
 *      on disk but outside this run's key space, outside the repository).
 *   2. AMBIGUOUS `references` edges (a `#fragment` anchor whose heading NAME collides in
 *      the project), with the COUNTERFACTUAL the brief asks about: if the edge published
 *      the heading's QUALIFIED name instead of its leaf, how many would resolve, how many
 *      stay ambiguous, how many would become unresolvable, and how many currently
 *      RESOLVED edges would the same change break.
 *
 * Usage (bounded, one process, no background):
 *   bun run validation/m14/fixtures/markdown/residual-buckets.ts [--max 400]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, existsSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const MAX = Number(argv[argv.indexOf("--max") + 1]) || 400
const REPO_ONLY = argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length)
const LIST_REF = argv.includes("--list-ref")
const DUMP = argv.find((a) => a.startsWith("--dump="))?.slice("--dump=".length)

// ---- discovery, copied from the gate -------------------------------------------------
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".md")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const total = found.length
let files = found
if (REPO_ONLY) {
  files = found.filter((f) => path.basename(path.dirname(f)) === REPO_ONLY || f.includes(`/${REPO_ONLY}/`))
} else if (MAX > 0 && total > MAX) {
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}
const relOf = (f: string, repo: string): string => path.relative(repo, f).split(path.sep).join("/")

console.log(`population: ${files.length} of ${total} admitted .md files (stride cap ${MAX})`)

// ---- parse --------------------------------------------------------------------------
type Sym = any
type Edge = { repo: string; srcFile: string; type: string; target: string; md: any; line: number | null }
const decls = new Map<string, Map<string, number>>()        // repo -> key -> declaration count
const declPos = new Map<string, { file: string; line: number }[]>()
const symbolsByFile = new Map<string, Sym[]>()
const admittedRelByRepo = new Map<string, Set<string>>()
const edges: Edge[] = []
let parsed = 0, failed = 0, degraded = 0

// the UNSAMPLED admitted list is a PROJECT fact (is this path in the language's population at all?)
for (const f of found) {
  const repo = repoOf(f)
  let s = admittedRelByRepo.get(repo)
  if (!s) admittedRelByRepo.set(repo, (s = new Set()))
  s.add(relOf(f, repo))
}

for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const repo = repoOf(f)
  let d = decls.get(repo)
  if (!d) decls.set(repo, (d = new Map()))
  const add = (key: string, file: string, line: number | null) => {
    d!.set(key, (d!.get(key) ?? 0) + 1)
    const k = `${repo}\u0000${key}`
    const at = declPos.get(k)
    const pos = { file, line: line ?? -1 }
    if (!at) declPos.set(k, [pos])
    else if (!at.some((x) => x.file === file && x.line === pos.line)) at.push(pos)
  }
  for (const sym of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(sym?.name ?? "")
    if (!name) continue
    const q = String(sym?.qualifiedName ?? "")
    const line = Number(sym?.range?.startLine ?? 0) || null
    add(name, f, line)
    if (q && q !== name) add(q, f, line)
  }
  symbolsByFile.set(f, Array.isArray(r.symbols) ? r.symbols : [])
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? "")
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    edges.push({ repo, srcFile: f, type: t, target: tgt, md: rel?.metadata ?? {}, line: Number(rel?.line_number ?? 0) || null })
  }
}
console.log(`parsed ${parsed} (failed ${failed}, degraded ${degraded}); ${edges.length} edges`)

// ---- the gate's outcome model, per project ------------------------------------------
const outcomeOf = (repo: string, target: string): { o: "resolved" | "amb" | "unresolved"; n: number } => {
  const n = decls.get(repo)?.get(target) ?? 0
  if (n === 0) return { o: "unresolved", n }
  if (n > 1) return { o: "amb", n }
  return { o: "resolved", n }
}
const isExternalMarked = (md: any): boolean =>
  md && (md.isExternal === true || md.isExternalTarget === true || md.external === true || md.externalRef === true)

// ---- bucketers -----------------------------------------------------------------------
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
const linkShape = (dest: string, srcFile: string): string => {
  if (dest.length === 0) return "empty"
  const bare = dest.split("#")[0]!.split("?")[0]!
  if (bare.length === 0) return "fragmentOnly"
  const repo = repoOf(srcFile)
  const admitted = admittedRelByRepo.get(repo)
  const ext = (p: string): string => {
    const i = p.lastIndexOf(".")
    return i >= 0 ? p.slice(i).toLowerCase() : "(none)"
  }
  if (bare.charCodeAt(0) === 47) {
    // a SITE-ABSOLUTE path: resolved against the filesystem root by the analyzer, so it
    // can never name a file. Measured against the REPOSITORY root, which is the rebase
    // a fix would have to choose.
    const atRepo = path.join(repo, bare.replace(/^\/+/, ""))
    if (existsSync(atRepo)) {
      const rel = path.relative(repo, atRepo).split(path.sep).join("/")
      if (admitted?.has(rel)) return "siteAbsoluteFileAdmittedMdNotRebased"
      return `siteAbsoluteFileOnDisk${ext(rel)}`
    }
    return "siteAbsoluteNothingAtRepoRoot"
  }
  const abs = path.resolve(path.dirname(path.resolve(srcFile)), bare)
  const rel = path.relative(repo, abs).split(path.sep).join("/")
  // A RENDERED `.html` DESTINATION WHOSE `.md` SOURCE IS ON DISK. mdBook/GitHub-Pages
  // repositories link the BUILT page (`../reference/manifest.html`) while the tracked
  // source is `manifest.md`, so the destination names a file that exists only after a
  // build. Counted separately because it is a real, named construct with a decidable
  // count — and because remapping it is a GUESS about a build step, not a rule.
  const renderedSibling = (p: string): boolean => {
    if (!p.endsWith(".html")) return false
    return existsSync(p.slice(0, -".html".length) + ".md")
  }
  if (bare.startsWith("..")) {
    if (!existsSync(abs)) return renderedSibling(abs) ? "parentRelativeDeadHtmlSiblingMdExists" : "parentRelativeDeadPath"
    if (rel.startsWith("..")) return "parentRelativeOutsideRepoRoot"
    if (admitted?.has(rel)) return "parentRelativeAdmittedButNotInRun"
    return "parentRelativeOnDiskNotAdmitted"
  }
  if (existsSync(abs)) {
    if (rel.startsWith("..")) return "outsideRepo"
    if (admitted?.has(rel)) return "targetInAdmittedButNotInRun"
    return `targetOnDiskNotAdmittedMd${ext(rel)}`
  }
  return renderedSibling(abs) ? "deadPathRenderedHtmlSiblingMdExists" : "deadPath"
}

const unresUse = new Map<string, number>()
const unresImport = new Map<string, number>()
const ambRef = new Map<string, number>()
const extUnverifiable = new Map<string, number>()
// counterfactual for `references`
const cfId = { resolved: 0, amb: 0, unresolved: 0, noSymbol: 0 }
const cfResolvedWouldBreak = { staysResolved: 0, becomesAmb: 0, becomesUnresolved: 0, noSymbol: 0 }
const refSamples: string[] = []

for (const e of edges) {
  const { o, n } = outcomeOf(e.repo, e.target)
  const md = e.md
  if (isExternalMarked(md)) { if (o === "unresolved") bump(extUnverifiable, `${e.type}:${md.role ?? "?"}/${md.targetKind ?? "?"}`); continue }
  if (o === "unresolved") {
    if (e.type === "imports") { bump(unresImport, `${md.directive ?? "?"}/${linkShape(e.target, e.srcFile)}`); continue }
    if (e.type === "uses") {
      const role = String(md.role ?? "?")
      const kind = String(md.targetKind ?? "?")
      const dest = String(md.linkDestination ?? e.target)
      const form = md.linkForm ? String(md.linkForm) : md.resolvedVia ? String(md.resolvedVia) : "inline"
      bump(unresUse, `${role}/${kind}/${form}/${linkShape(dest, e.srcFile)}`)
      continue
    }
    bump(unresUse, `${e.type}/(other)`)
    continue
  }
  if (o === "amb" && e.type === "references") {
    const frag = String(md.anchor ?? "?")
    bump(ambRef, `internal_anchor/leaf-collides/decls=${n}`)
    // counterfactual: the heading's QUALIFIED name, which the analyzer computes and the
    // anchorMap discards (it stores only {name,line}).
    const sym = (symbolsByFile.get(e.srcFile) ?? []).find((s: Sym) => String(s?.name) === e.target)
    const q = sym ? String(sym.qualifiedName ?? "") : ""
    if (!q) { cfId.noSymbol++; continue }
    const c = outcomeOf(e.repo, q)
    if (c.o === "resolved") cfId.resolved++
    else if (c.o === "amb") { cfId.amb++; if (refSamples.length < 8) refSamples.push(`${relOf(e.srcFile, e.repo)}:${e.line} leaf=${e.target} (${n} decls) qname=${q} (${c.n} decls)`) }
    else cfId.unresolved++
  }
  if (o === "resolved" && e.type === "references") {
    const sym = (symbolsByFile.get(e.srcFile) ?? []).find((s: Sym) => String(s?.name) === e.target)
    const q = sym ? String(sym.qualifiedName ?? "") : ""
    if (!q) { cfResolvedWouldBreak.noSymbol++; continue }
    const c = outcomeOf(e.repo, q)
    if (c.o === "resolved") cfResolvedWouldBreak.staysResolved++
    else if (c.o === "amb") cfResolvedWouldBreak.becomesAmb++
    else cfResolvedWouldBreak.becomesUnresolved++
  }
}

const show = (title: string, m: Map<string, number>) => {
  console.log(`\n== ${title} (${[...m.values()].reduce((a, b) => a + b, 0)})`)
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`   ${String(v).padStart(6)}  ${k}`)
}
show("UNRESOLVED uses — role/targetKind/form/why-the-path-named-nothing", unresUse)
show("UNRESOLVED imports — directive/shape", unresImport)
show("AMBIGUOUS references — internal anchors", ambRef)
show("EXTERNAL-MARKED edges that are ALSO unresolved (unverifiable claims)", extUnverifiable)

// EDGE-LEVEL DUMP — the before/after delta cannot be read off the gate's per-type columns,
// so an `--dump=path` run writes one row per emitted edge for a byte-level diff.
if (DUMP) {
  const { writeFileSync } = await import("node:fs")
  const rows: string[] = []
  for (const e of edges) {
    rows.push([relOf(e.srcFile, e.repo), e.line ?? 0, e.type, e.target, String(e.md.linkForm ?? e.md.resolvedVia ?? ""), String(e.md.linkDestination ?? "")].join("\t"))
  }
  rows.sort()
  writeFileSync(DUMP, rows.join("\n") + "\n")
  console.log(`\n== EDGE DUMP: ${rows.length} edge(s) -> ${DUMP}`)
}
console.log("\n== COUNTERFACTUAL: reference target = heading QUALIFIED name (the discarded qualifier)")
console.log(`   ambiguous today -> resolved ${cfId.resolved} · stays ambiguous ${cfId.amb} · would name nothing ${cfId.unresolved} · no heading symbol ${cfId.noSymbol}`)
console.log(`   resolved today  -> stays resolved ${cfResolvedWouldBreak.staysResolved} · would become ambiguous ${cfResolvedWouldBreak.becomesAmb} · would name nothing ${cfResolvedWouldBreak.becomesUnresolved} · no heading symbol ${cfResolvedWouldBreak.noSymbol}`)
if (refSamples.length) { console.log("   ambiguous-even-under-qname samples:"); for (const s of refSamples) console.log(`     ${s}`) }

// sample of the biggest unresolved bucket, with the file that emitted it
const topBucket = [...unresUse.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
if (topBucket) {
  console.log(`\n== SAMPLES of the top unresolved bucket (${topBucket})`)
  let shown = 0
  const keys = topBucket.split("/")
  for (const e of edges) {
    if (shown >= 12) break
    if (outcomeOf(e.repo, e.target).o !== "unresolved") continue
    if (isExternalMarked(e.md) || e.type !== "uses") continue
    const role = String(e.md.role ?? "?"), kind = String(e.md.targetKind ?? "?"), form = e.md.linkForm ? String(e.md.linkForm) : e.md.resolvedVia ? String(e.md.resolvedVia) : "inline"
    const dest = String(e.md.linkDestination ?? e.target)
    if (`${role}/${kind}/${form}/${linkShape(dest, e.srcFile)}` !== topBucket) continue
    console.log(`   ${relOf(e.srcFile, e.repo)}:${e.line} -> ${JSON.stringify(e.target)}  (dest ${JSON.stringify(dest)})`)
    shown++
  }
  void keys
}

// the reference-link arm's own unresolved rows, grouped by REPOSITORY — the population a
// `--repo=` measurement of the file model would have to run on
const refArmByRepo = new Map<string, number>()
const refArmSamples: string[] = []
for (const e of edges) {
  if (e.type !== "uses" || isExternalMarked(e.md)) continue
  if (!e.md.linkForm && !e.md.resolvedVia) continue
  if (outcomeOf(e.repo, e.target).o !== "unresolved") continue
  const repo = path.basename(e.repo)
  bump(refArmByRepo, repo)
  if (refArmSamples.length < 20) refArmSamples.push(`${repo}/${relOf(e.srcFile, e.repo)}:${e.line} -> ${JSON.stringify(e.target)} (${linkShape(String(e.md.linkDestination ?? e.target), e.srcFile)})`)
}
console.log(`\n== UNRESOLVED reference-form links by repository (${[...refArmByRepo.values()].reduce((a, b) => a + b, 0)})`)
for (const [k, v] of [...refArmByRepo.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(6)}  ${k}`)
for (const s of refArmSamples) console.log(`     ${s}`)

// THE REFERENCE-FORM EDGE LIST — every `[x][ref]` / `[x][]` / `[x]` edge the reference arm
// emits, with the destination the DEFINITION declares and the target the edge publishes.
// This is the list STEP 5's ten hand-reads are sampled from.
if (LIST_REF) {
  console.log(`\n== REFERENCE-FORM EDGES (type target <- definition destination)`)
  let n = 0
  for (const e of edges) {
    if (isExternalMarked(e.md) || e.type !== "uses") continue
    if (!e.md.linkForm && !e.md.resolvedVia) continue
    const dest = String(e.md.linkDestination ?? "(none: pre-fix edge)")
    const o = outcomeOf(e.repo, e.target)
    console.log(`   ${o.o.padEnd(10)} ${relOf(e.srcFile, e.repo)}:${e.line}  ${JSON.stringify(e.target)}  <- ${JSON.stringify(dest)}  form=${e.md.linkForm ?? e.md.resolvedVia}`)
    n++
  }
  console.log(`   ${n} reference-form edge(s)`)
}
