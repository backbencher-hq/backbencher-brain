/**
 * r LANE — THE PRICE OF THE PACKAGE-NAMESPACE CLAIM, measured before it is attached.
 *
 * THE CLAIM IS READ BEFORE THE COUNT (`incoming-rule.ts:1077-1092` returns early: "the claim is the
 * sole authority for the OUTCOME and returning early is the point"). So a `languageNamespace` claim
 * does not only re-label a gap: on an edge whose target IS declared it takes the outcome away from
 * `resolved`, and on a target declared twice it takes it away from `amb(decl)`. Both would be
 * REGRESSIONS, and neither is visible from the analyzer, which cannot see the project key space.
 *
 * This probe measures all three cases over the same 400-file stride population, so the claim's
 * guards can be sized against numbers rather than against a hope:
 *
 *   would gain   currently unresolved -> externalVerified
 *   would LOSE   currently resolved   -> externalVerified   (a resolution, destroyed)
 *   would HIDE   currently ambiguous  -> externalVerified   (a collision, hidden)
 *
 * READ-ONLY. `bun run validation/m14/fixtures/r/namespace-claim-price.ts [maxFiles]`.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.argv[2] ?? 400)
const SIZE_CAP = 1024 * 1024
/** The subtypes that name a PACKAGE — the spellings `handleLibrary` and the `::` branch write. */
const PACKAGE_SUBTYPES = new Set(["library_import", "library_dependency", "namespace_access"])
/** An R package name: letters/digits/dots, starting with a letter, not ending in a dot. */
const R_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9.]*[A-Za-z0-9]$|^[A-Za-z]$/

function admit(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

function discover(exts: string[], maxFiles: number): { files: string[]; total: number } {
  const found: string[] = []
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
      if (!admit(rel, exts, "r")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  if (maxFiles <= 0 || total <= maxFiles) return { files: found, total }
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
  return { files: picked, total }
}

async function main(): Promise<void> {
  const { files, total } = discover(["r"], MAX_FILES)
  const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])
  const decl = new Map<string, Map<string, number>>()
  const declPosGlobal = new Map<string, { file: string; line: number }[]>()
  const kinds = new Map<string, Map<string, Set<string>>>()
  type E = { label: string; tgt: string; file: string; repo: string; sub: string; outcome: string; decls: number; loaded: boolean }
  const edges: E[] = []
  // the package roots a file names, by the same subtype rule the fix will use
  const loadedByFile = new Map<string, Set<string>>()

  for (const f of files) {
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
    if (!r) continue
    const repo = repoOf(f)
    let d = decl.get(repo); if (!d) decl.set(repo, (d = new Map()))
    let k = kinds.get(repo); if (!k) kinds.set(repo, (k = new Map()))
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      const ln = Number((s as any)?.startLine ?? (s as any)?.range?.startLine ?? (s as any)?.line ?? 0) || -1
      const at = declPosGlobal.get(name)
      if (!at) declPosGlobal.set(name, [{ file: f, line: ln }])
      else if (!at.some((x) => x.file === f && x.line === ln)) at.push({ file: f, line: ln })
      d!.set(name, (d!.get(name) ?? 0) + 1)
      let ks = k!.get(name); if (!ks) k!.set(name, (ks = new Set())); ks.add(String(s?.kind ?? ""))
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== name) { d!.set(q, (d!.get(q) ?? 0) + 1); let qs = k!.get(q); if (!qs) k!.set(q, (qs = new Set())); qs.add(String(s?.kind ?? "")) }
    }
    let loaded = loadedByFile.get(f)
    if (!loaded) loadedByFile.set(f, (loaded = new Set()))
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(rel?.type ?? "")
      const tgt = String((rel as any)?.target ?? "")
      if (!tgt) continue
      const md = ((rel as any)?.metadata ?? {}) as Record<string, any>
      const sub = String(md.relationshipSubType ?? "")
      if ((label === "imports" || label === "references") && PACKAGE_SUBTYPES.has(sub) && R_PACKAGE_NAME.test(tgt)) loaded.add(tgt)
      edges.push({ label, tgt, file: f, repo, sub, outcome: "", decls: 0, loaded: false })
    }
  }

  let gain = 0, lose = 0, hide = 0, already = 0, other = 0
  const gainBySub = new Map<string, number>(); const loseBySub = new Map<string, number>()
  const gainByTarget = new Map<string, number>(); const loseByTarget = new Map<string, number>()
  const bumpMap = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const lostExamples: string[] = []
  const hiddenExamples: string[] = []
  const gainExamples: string[] = []
  for (const e of edges) {
    if (!(e.label === "imports" || e.label === "references")) continue
    if (!PACKAGE_SUBTYPES.has(e.sub)) continue
    const loaded = loadedByFile.get(e.file)
    if (!loaded || !loaded.has(e.tgt)) continue
    const d = decl.get(e.repo)!
    const claim = externalClaimOf({ type: e.label, target: e.tgt, metadata: { relationshipSubType: e.sub } })
    const c = classifyEdge(d, kinds.get(e.repo)!, e.tgt, claim, undefined, isContainsEdge(e.label))
    e.outcome = c.outcome
    e.decls = c.decls
    if (c.outcome === "unresolved") {
      gain++; bumpMap(gainBySub, e.sub); bumpMap(gainByTarget, e.tgt)
      if (gainExamples.length < 8) gainExamples.push(`${e.tgt} @ ${path.relative(CR, e.file)}`)
    } else if (c.outcome === "resolved") {
      lose++; bumpMap(loseBySub, e.sub); bumpMap(loseByTarget, e.tgt)
      if (lostExamples.length < 60) {
        const where = (declPosGlobal.get(e.tgt) ?? []).map((x) => path.relative(CR, x.file)).join(",")
        lostExamples.push(`${e.tgt} (decls ${c.decls}, sub ${e.sub}) @ ${path.relative(CR, e.file)}  <- declared at ${where}`)
      }
    } else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") {
      hide++
      if (hiddenExamples.length < 8) hiddenExamples.push(`${e.tgt} (decls ${c.decls}) @ ${path.relative(CR, e.file)}`)
    } else already++
  }

  console.log(`r NAMESPACE-CLAIM PRICE — ${files.length} of ${total} .r files (stride)`)
  console.log(`candidate edges: label imports|references, subtype in {library_import, library_dependency, namespace_access},`)
  console.log(`                 target is an R-package-shaped name AND is loaded by the edge's own file`)
  console.log(``)
  console.log(`  WOULD GAIN  (unresolved -> externalVerified) : ${gain}`)
  for (const x of gainExamples) console.log(`        ${x}`)
  console.log(`  WOULD LOSE  (resolved   -> externalVerified) : ${lose}`)
  for (const x of lostExamples) console.log(`        ${x}`)
  console.log(`  WOULD HIDE  (ambiguous  -> externalVerified) : ${hide}`)
  for (const x of hiddenExamples) console.log(`        ${x}`)
  console.log(`  already claimed / other outcome              : ${already}`)
  console.log(`  candidates with ZERO declarations in project : ${gain}`)
  const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => k + "(" + v + ")").join(" | ")
  console.log(``)
  console.log(`  GAIN by subtype : ${top(gainBySub, 8)}`)
  console.log(`  LOSE by subtype : ${top(loseBySub, 8)}`)
  console.log(`  GAIN top targets: ${top(gainByTarget, 25)}`)
  console.log(`  LOSE top targets: ${top(loseByTarget, 12)}`)
}

main().catch((e) => { console.error(e); process.exit(2) })
