/**
 * PHP AT TWO SCOPES — what the AMBIGUOUS column is made of, and where the UNRESOLVED edges
 * live once the key space is the whole project instead of a 60-file stride.
 *
 * ## Why two scopes in one instrument
 *
 * `incoming-gate.ts php php 60` decides on the file's OWN PROJECT *as that run saw it* — 60
 * files strided over 5,094, so a phpunit file's key space is whatever phpunit files the stride
 * happened to draw (about two). Every number in that verdict is therefore a number about a
 * SAMPLE, and the two columns the Lead asked to classify read very differently at project
 * scale:
 *
 *   ambiguous   135 at sample scope, 80,726 at whole-project scope. Nothing about the analyzer
 *               changed between those two numbers — the key space did. If the 135 are all
 *               MEMBER names (`__construct`, `name`, `file`) then the column is one question
 *               asked twice, and it belongs in the spec as a RULED count rather than chased.
 *   unresolved  2,395 at sample scope, 14,878 at whole-project scope, and the census already
 *               split the sample's 2,483 into 1,325 declared-in-corpus (out of the run's
 *               budget) and 1,158 declared nowhere. At PROJECT scope "declared in the corpus
 *               but not in this project" is a different and much smaller set, and the residual
 *               is what actually needs explaining.
 *
 * ## What is measured, and on whose rule
 *
 * ONE pass over the whole admitted population (5,094 `.php` files, 9 repos) with the production
 * entry point builds every repo's key space — `name` AND `qualifiedName`, exactly the gate's
 * `countKey` — and keeps the target project's edges. Classification uses the gate's own
 * `classifyEdge`, imported rather than re-implemented, against (a) the run's per-repo key space
 * for the sample and (b) the target project's whole key space.
 *
 * AMBIGUITY IS CLASSIFIED BY WHAT THE NAME IS, not by how many declarations carry it:
 *
 *   memberOnly   every declaration carrying the name is a METHOD, CONSTRUCTOR or PROPERTY —
 *                i.e. the name is a member name, and the collision is the family's member-
 *                identity question (`Owner.member` vs bare member), not a namespace collision.
 *   declared     at least one declaration carrying the name is a top-level kind (class,
 *                interface, trait, enum, function, constant) — a real name collision.
 *
 * RESOLUTION IS CLASSIFIED BY WHERE THE DECLARATION WOULD BE:
 *
 *   inThisProject   declared in the project the edge was emitted in -> a DEFECT if unresolved
 *   inAnotherRepo   declared by another admitted repo -> external to this project, in corpus
 *   nowhere         declared by no admitted file -> external to the corpus (php-src or library)
 *
 * Run: npx tsx validation/m14/fixtures/php/project-scope-census.mts [targetRepo] [sampleN]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"
import { phpInternalKind } from "../../../../src/ast/real-php-analyzer"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const TARGET = process.argv[2] ?? "phpunit"
const SAMPLE_N = Number(process.argv[3] ?? 60)

// ---------------------------------------------------------------- population (the gate's rule)
const admitted: { abs: string; repo: string; rel: string }[] = []
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
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    admitted.push({ abs, repo: name, rel })
  }
}
admitted.sort((a, b) => (a.abs < b.abs ? -1 : 1))
const repos = [...new Set(admitted.map((a) => a.repo))].sort()
console.log(`admitted .php files ${admitted.length} across ${repos.length} repos; target project "${TARGET}" (${admitted.filter((a) => a.repo === TARGET).length} files)`)

// ---------------------------------------------------------------- key spaces (one pass)
type KS = { decl: Map<string, number>; kinds: Map<string, Set<string>>; files: Map<string, Set<string>>; owners: Map<string, Set<string>> }
const newKS = (): KS => ({ decl: new Map(), kinds: new Map(), files: new Map(), owners: new Map() })
const byRepo = new Map<string, KS>()
for (const r of repos) byRepo.set(r, newKS())
const addSym = (ks: KS, key: string, kind: string, file: string, owner: string) => {
  ks.decl.set(key, (ks.decl.get(key) ?? 0) + 1)
  let s = ks.kinds.get(key); if (!s) ks.kinds.set(key, (s = new Set())); s.add(kind)
  let f = ks.files.get(key); if (!f) ks.files.set(key, (f = new Set())); f.add(file)
  // A DECLARATION'S IDENTITY IS (file, owner) — not just the file. Two classes in one file each
  // declaring `__construct` are two declarations in ONE file, and a classification that stopped
  // at the file would call them one thing when they are another.
  let o = ks.owners.get(key); if (!o) ks.owners.set(key, (o = new Set())); o.add(`${file}#${owner}`)
}
/** the target project's edges, kept for the project-scope arm */
const targetEdges: { label: string; tgt: string; claim: any }[] = []
let edgesAll = 0
let parsed = 0
let degraded = 0
const edgesPerRepo = new Map<string, number>()
for (const f of admitted) {
  let res: any
  try { res = await parseFile(f.abs, "php") } catch { continue }
  if (!res?.success) continue
  parsed++
  // A DEGRADED PARSE IS NOT AN ANALYZER MEASUREMENT. Same two signatures the gate names: the
  // wasm-trap path sets `fallback`, the analyzer-died path returns analysisVersion 2.0-basic-fallback.
  if (res.fallback === true || res.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const ks = byRepo.get(f.repo)!
  for (const s of res.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (n.length === 0) continue
    const kind = String(s?.kind ?? "")
    const owner = String(s?.ownerName ?? "")
    addSym(ks, n, kind, f.rel, owner)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== n) addSym(ks, q, kind, f.rel, owner)
  }
  const rels = res.relationships ?? []
  edgesPerRepo.set(f.repo, (edgesPerRepo.get(f.repo) ?? 0) + rels.length)
  edgesAll += rels.length
  if (f.repo !== TARGET) continue
  for (const r of rels) {
    const tgt = String(r?.target ?? "")
    if (!tgt) continue
    targetEdges.push({ label: String(r?.type ?? ""), tgt, claim: externalClaimOf(r) })
  }
}
const targetKS = byRepo.get(TARGET)!
console.log(`parsed ${parsed}/${admitted.length}; ${edgesAll} edges corpus-wide; ${targetEdges.length} edges in "${TARGET}"`)
console.log(`degraded (regex fallback / analyzer fallback): ${degraded}${degraded > 0 ? "   *** A DEGRADED FILE IS NOT AN ANALYZER MEASUREMENT — re-run when the diagnostics path is writable ***" : ""}`)
console.log(`"${TARGET}" key space: ${targetKS.decl.size} keys from ${targetKS.files.size === 0 ? 0 : admitted.filter((a) => a.repo === TARGET).length} files`)

// ---------------------------------------------------------------- classification helpers
const MEMBER_KINDS = new Set(["method", "property", "constructor"])
type AmbInfo = { name: string; decls: number; kinds: string; fileCount: number; memberOnly: boolean }
const classifyName = (ks: KS, name: string): AmbInfo => {
  const decls = ks.decl.get(name) ?? 0
  const kinds = [...(ks.kinds.get(name) ?? new Set<string>())].sort()
  const fileCount = ks.files.get(name)?.size ?? 0
  return { name, decls, kinds: kinds.join("|"), fileCount, memberOnly: kinds.length > 0 && kinds.every((k) => MEMBER_KINDS.has(k)) }
}
/**
 * A FILE PATH IS NOT A NAME, and this is the correction of a measured probe defect: the first
 * version of this file split EVERY target on its last dot and looked the owner up, so phpunit's
 * `require_once 'A.php'` (tests/end-to-end/regression/6294/IssueTest6294.php) had "owner" `A`,
 * found `class A` in the same project, and was reported as a resolution DEFECT. It is a file
 * reference. The same rule the Lead's fix states for the gate applies here: a path cannot be a
 * published name, so a lookup returning 0 would prove nothing and a lookup returning 1 proves
 * nothing either. Path-shaped targets get their own bucket and are never called defects.
 */
/**
 * WHAT KIND OF COLLISION IS IT? — the powershell lane's four classes, so two lanes' rulings can
 * be read side by side:
 *
 *   multiFile                  the declarations live in MORE THAN ONE FILE. For a member name this
 *                              is PHP's own semantics: `$obj->run()` dispatches on a value whose
 *                              type one file cannot know, so two classes in two files declaring
 *                              `run` are two declarations the language itself declines to pick
 *                              between.
 *   oneFileDiffOwner           ONE file, DIFFERENT owners — two classes in one file each
 *                              declaring the name. Real, and in principle nameable.
 *   oneFileSameOwnerDiffKind   one file, one owner, MORE THAN ONE KIND (a method and a property
 *                              with the same name — legal PHP, and the family's member-identity
 *                              question in its smallest form).
 *   sameKind                   one file, one owner, one kind, more than one declaration. The only
 *                              class an identity defect could hide in, so its count is the falsifier
 *                              for "this is irreducible".
 */
const ambClass = (ks: KS, name: string): string => {
  const files = ks.files.get(name)?.size ?? 0
  const owners = ks.owners.get(name) ?? new Set<string>()
  const ownerNames = new Set([...owners].map((o) => o.slice(o.indexOf("#") + 1)))
  const kinds = ks.kinds.get(name) ?? new Set<string>()
  if (files > 1) return "multiFile"
  if (ownerNames.size > 1) return "oneFileDiffOwner"
  if (kinds.size > 1) return "oneFileSameOwnerDiffKind"
  return "sameKind"
}

const isFilenameLike = (t: string): boolean =>
  t.startsWith("__DIR__") || t.includes("/") || /\.[A-Za-z0-9]{1,6}$/.test(t)
const isIdentifierLike = (t: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)
const lookup = (t: string) => {
  if (isFilenameLike(t)) return [] as string[]
  const ownerDot = t.lastIndexOf(".")
  const candidates = [t, ownerDot > 0 ? t.slice(0, ownerDot) : null].filter(Boolean) as string[]
  return candidates
}

function report(label: string, edges: { label: string; tgt: string; claim: any }[], ks: KS, allKS: Map<string, KS>) {
  const counts = new Map<string, number>()
  const ambNames = new Map<string, number>()
  const unresNames = new Map<string, number>()
  const unresWhere = { inThisProject: 0, inAnotherRepo: 0, nowhere: 0, pathShaped: 0 }
  const unresPhpSrc = new Map<string, number>()
  let unresNonIdentifier = 0
  // (1) AS THE GATE CLASSIFIES IT — the analyzer's own claims applied. This is the arm that
  // must reproduce the gate's verdict, and it is self-checked below.
  for (const e of edges) {
    const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim)
    counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1)
    if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") {
      ambNames.set(e.tgt, (ambNames.get(e.tgt) ?? 0) + 1)
    }
  }
  // (2) THE POPULATION UNDERNEATH — claims IGNORED, because the question here is where an
  // edge that names nothing WOULD have found its declaration, and an external claim would
  // otherwise remove from view the very edges being classified.
  const rawCounts = new Map<string, number>()
  const defectNames: string[] = []
  for (const e of edges) {
    const c = classifyEdge(ks.decl, ks.kinds, e.tgt, null)
    rawCounts.set(c.outcome, (rawCounts.get(c.outcome) ?? 0) + 1)
    if (c.outcome === "unresolved") {
      unresNames.set(e.tgt, (unresNames.get(e.tgt) ?? 0) + 1)
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(e.tgt)) unresNonIdentifier++
      const cands = lookup(e.tgt)
      if (cands.length === 0) { unresWhere.pathShaped++; continue }
      const inThis = cands.some((t) => (ks.decl.get(t) ?? 0) > 0)
      const inOther = !inThis && [...allKS].some(([r, other]) => r !== TARGET && cands.some((t) => (other.decl.get(t) ?? 0) > 0))
      if (inThis) { unresWhere.inThisProject++; if (defectNames.length < 20) defectNames.push(e.tgt) }
      else if (inOther) unresWhere.inAnotherRepo++
      else {
        unresWhere.nowhere++
        if (phpInternalKind(e.tgt) !== null || cands.some((t) => phpInternalKind(t) !== null)) {
          unresPhpSrc.set(e.tgt, (unresPhpSrc.get(e.tgt) ?? 0) + 1)
        }
      }
    }
  }
  void rawCounts
  const ambInfo = [...ambNames.keys()].map((n) => classifyName(ks, n))
  const memberOnlyEdges = [...ambNames].filter(([n]) => classifyName(ks, n).memberOnly).reduce((a, [, c]) => a + c, 0)
  const ambiguousEdges = [...ambNames.values()].reduce((a, b) => a + b, 0)
  console.log(`\n=== ${label} — ${edges.length} edges ===`)
  console.log(`  AS THE GATE CLASSIFIES IT (claims applied): ${[...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  console.log(`  CLAIMS IGNORED: ${[...rawCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  console.log(`  AMBIGUOUS: ${ambiguousEdges} edges over ${ambNames.size} distinct names`)
  {
    const byClass = new Map<string, { names: number; edges: number }>()
    for (const [n, c] of ambNames) {
      const k = ambClass(ks, n)
      const cur = byClass.get(k) ?? { names: 0, edges: 0 }
      cur.names++; cur.edges += c
      byClass.set(k, cur)
    }
    for (const [k, v] of [...byClass].sort((a, b) => b[1].edges - a[1].edges)) {
      console.log(`    ${k.padEnd(24)} ${String(v.names).padStart(5)} names  ${String(v.edges).padStart(6)} edges  (${ambiguousEdges ? ((v.edges / ambiguousEdges) * 100).toFixed(1) : "0"}% of ambiguous edges)`)
    }
  }
  console.log(`    member-only names (method/property/constructor only): ${ambInfo.filter((a) => a.memberOnly).length} names, ${memberOnlyEdges} edges (${ambiguousEdges ? ((memberOnlyEdges / ambiguousEdges) * 100).toFixed(1) : "0"}%)`)
  const topAmb = [...ambNames].sort((a, b) => b[1] - a[1]).slice(0, 12)
  for (const [n, c] of topAmb) {
    const i = classifyName(ks, n)
    console.log(`      amb ${String(c).padStart(4)}x  ${n.padEnd(22)} ${i.decls} decls in ${i.fileCount} file(s) [${i.kinds}]${i.memberOnly ? " MEMBER-ONLY" : ""}`)
  }
  console.log(`  UNRESOLVED: ${[...unresNames.values()].reduce((a, b) => a + b, 0)} edges over ${unresNames.size} distinct names`)
  console.log(`    path-shaped targets (a FILE reference, not a name — never a defect): ${unresWhere.pathShaped}`)
  console.log(`    declared in THIS project (would be a DEFECT): ${unresWhere.inThisProject}`)
  console.log(`    declared in ANOTHER repo (external to this project, in corpus): ${unresWhere.inAnotherRepo}`)
  console.log(`    declared NOWHERE in the corpus: ${unresWhere.nowhere}  (of which php-src names: ${[...unresPhpSrc.values()].reduce((a, b) => a + b, 0)} over ${unresPhpSrc.size} names)`)
  console.log(`    targets that are NOT a plain identifier (path/URI-shaped, unverifiable even after the rule fix): ${unresNonIdentifier}`)
  if (defectNames.length) console.log(`    DEFECT NAMES (owner/declaration IS in this project, target unresolved): ${[...new Set(defectNames)].join(" ")}`)
  const topUn = [...unresNames].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`    top unresolved: ${topUn.map(([n, c]) => `${n}(${c})`).join(" ")}`)
  return { counts: Object.fromEntries(counts), rawCounts: Object.fromEntries(rawCounts), defectNames: [...new Set(defectNames)], ambiguousEdges, ambiguousNames: ambNames.size, memberOnlyEdges, ambTop: topAmb.map(([n, c]) => ({ name: n, edges: c, ...classifyName(ks, n) })), unresWhere, unresNonIdentifier, unresEdges: [...unresNames.values()].reduce((a, b) => a + b, 0), unresNames: unresNames.size }
}

// ---------------------------------------------------------------- SCOPE A: the sample stride
const total = admitted.length
const stride = SAMPLE_N > 0 && total > SAMPLE_N ? Math.max(1, Math.floor(total / SAMPLE_N)) : 1
const sample: typeof admitted = []
for (let i = 0; i < admitted.length && sample.length < SAMPLE_N; i += stride) sample.push(admitted[i])
const sampleKS = new Map<string, KS>()
const byRepoEdges = new Map<string, { label: string; tgt: string; claim: any }[]>()
for (const f of sample) {
  let res: any
  try { res = await parseFile(f.abs, "php") } catch { continue }
  if (!res?.success) continue
  let ks = sampleKS.get(f.repo); if (!ks) sampleKS.set(f.repo, (ks = newKS()))
  for (const s of res.symbols ?? []) {
    const n = String(s?.name ?? ""); if (!n) continue
    const kind = String(s?.kind ?? "")
    const owner = String(s?.ownerName ?? "")
    addSym(ks, n, kind, f.rel, owner)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== n) addSym(ks, q, kind, f.rel, owner)
  }
  let list = byRepoEdges.get(f.repo); if (!list) byRepoEdges.set(f.repo, (list = []))
  for (const r of res.relationships ?? []) {
    const tgt = String(r?.target ?? "")
    if (tgt) list.push({ label: String(r?.type ?? ""), tgt, claim: externalClaimOf(r) })
  }
}
// The sample's verdict scope is PER PROJECT, so classify each edge against ITS OWN repo's
// sample key space — the gate's rule, not a pooled one.
const sampleCounts = new Map<string, number>()      // CLAIMS APPLIED — the gate's own verdict
const sampleCountsRaw = new Map<string, number>()   // claims ignored — the population underneath
const sampleAmb = new Map<string, number>()
const sampleUnres = new Map<string, number>()
/** ambiguous edges by collision class, classified against the edge's OWN repo key space */
const sampleAmbClassEdges = new Map<string, number>()
const sampleAmbClassNames = new Map<string, Set<string>>()
for (const [repo, edges] of byRepoEdges) {
  const ks = sampleKS.get(repo)!
  for (const e of edges) {
    const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim)
    sampleCounts.set(c.outcome, (sampleCounts.get(c.outcome) ?? 0) + 1)
    const raw = classifyEdge(ks.decl, ks.kinds, e.tgt, null)
    sampleCountsRaw.set(raw.outcome, (sampleCountsRaw.get(raw.outcome) ?? 0) + 1)
    if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") {
      sampleAmb.set(e.tgt, (sampleAmb.get(e.tgt) ?? 0) + 1)
      const cls = ambClass(ks, e.tgt)
      sampleAmbClassEdges.set(cls, (sampleAmbClassEdges.get(cls) ?? 0) + 1)
      let ns = sampleAmbClassNames.get(cls); if (!ns) sampleAmbClassNames.set(cls, (ns = new Set())); ns.add(e.tgt)
    }
    if (raw.outcome === "unresolved") sampleUnres.set(e.tgt, (sampleUnres.get(e.tgt) ?? 0) + 1)
  }
}
console.log(`\n=== SCOPE A — the gate's ${SAMPLE_N}-file stride sample (per-project key space, the gate's verdict scope) ===`)
console.log(`  AS THE GATE CLASSIFIES IT (claims applied): ${[...sampleCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
{
  const amb = (sampleCounts.get("ambDeclOnly") ?? 0) + (sampleCounts.get("ambBoth") ?? 0)
  const unres = sampleCounts.get("unresolved") ?? 0
  const resolved = sampleCounts.get("resolved") ?? 0
  const edges = [...sampleCounts.values()].reduce((a, b) => a + b, 0)
  const ok = resolved === 639 && amb === 135 && unres === 2395 && edges === 3257
  console.log(`  SELF-CHECK vs \`incoming-gate.ts php php ${SAMPLE_N}\` (639 resolved / 135 ambiguous / 2395 unresolved / 3257 edges): ${ok ? "MATCH" : "*** MISMATCH — this instrument is not measuring the gate's sample ***"}`)
}
console.log(`  CLAIMS IGNORED (the population underneath): ${[...sampleCountsRaw].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`  ambiguous ${[...sampleAmb.values()].reduce((a, b) => a + b, 0)} edges over ${sampleAmb.size} distinct names`)
{
  // The sample's ambiguous edges are classified against the key space of the PROJECT they were
  // emitted in — the space the verdict reads. A name ambiguous only because an UNSAMPLED file of
  // the same repo declares it cannot appear here: the sample never sees that file, which is why
  // this column reads smaller than the project-scope one and the two must be read together.
  const tot = [...sampleAmbClassEdges.values()].reduce((a, b) => a + b, 0)
  for (const [k2, v] of [...sampleAmbClassEdges].sort((a, b) => b[1] - a[1])) {
    const names = sampleAmbClassNames.get(k2)?.size ?? 0
    console.log(`    ${k2.padEnd(24)} ${String(names).padStart(5)} names  ${String(v).padStart(6)} edges  (${tot ? ((v / tot) * 100).toFixed(1) : "0"}%)`)
  }
}

console.log(`    ${[...sampleAmb].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, c]) => `${n}(${c})`).join(" ")}`)
console.log(`  unresolved ${[...sampleUnres.values()].reduce((a, b) => a + b, 0)} edges over ${sampleUnres.size} distinct names (full list in the artifact)`)

// ---------------------------------------------------------------- SCOPE B: the whole project
const projectReport = report(`SCOPE B — whole project "${TARGET}" (${targetEdges.length} edges, its own complete key space)`, targetEdges, targetKS, byRepo)

const artifact = {
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  targetProject: TARGET,
  population: { admitted: admitted.length, repos: repos.length, parsed, degraded, edgesAll, targetEdges: targetEdges.length },
  sampleScope: {
    n: sample.length,
    outcomes: Object.fromEntries(sampleCounts),
    ambiguousEdges: [...sampleAmb.values()].reduce((a, b) => a + b, 0),
    ambiguousNames: Object.fromEntries([...sampleAmb].sort((a, b) => b[1] - a[1])),
    unresolvedEdges: [...sampleUnres.values()].reduce((a, b) => a + b, 0),
    unresolvedNames: Object.fromEntries([...sampleUnres].sort((a, b) => b[1] - a[1]).slice(0, 80)),
  },
  projectScope: projectReport,
}
{
  const c = projectReport.counts as Record<string, number>
  const resolved = c["resolved"] ?? 0
  const amb = (c["ambDeclOnly"] ?? 0) + (c["ambBoth"] ?? 0)
  const unres = c["unresolved"] ?? 0
  const extOk = c["externalVerified"] ?? 0
  const ok = resolved === 33427 && amb === 80726 && unres === 14878 && extOk === 4437
  console.log(`\nSELF-CHECK vs \`incoming-gate.ts php php 0 --repo=${TARGET}\` (33427 resolved / 80726 ambiguous / 14878 unresolved / 4437 external-verified / 133468 edges): ${ok ? "MATCH" : "*** MISMATCH ***"}`)
}

const outPath = path.join(ROOT, "validation/m14/fixtures/php/project-scope-census.json")
writeFileSync(outPath, JSON.stringify(artifact, null, 2))
console.log(`\nartifact: validation/m14/fixtures/php/project-scope-census.json`)
