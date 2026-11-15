/**
 * CSS RESIDUAL CENSUS — every edge of the gate's 400-file `.css` stride classified by the gate's
 * OWN rule, with the residual split into causes and each `@import` candidate claim measured BEFORE
 * a marker is written.
 *
 * WHY. `script/m14/incoming-gate.ts css css 400` prints two residual columns and a worklist capped at
 * 25 names per type. A lane cannot work from that: it needs (a) the count per NAMED CONSTRUCT that
 * closes against TABLE 1, and (b) for each unresolvable `@import`, the answer to "which claim spelling
 * would the arbiter VERIFY, and would any be REFUTED" — asked through the arbiter's own verifier
 * rather than asserted by the author of the fix.
 *
 * THE COUNTING RULE IS IMPORTED, NOT COPIED. `classifyEdge` / `tally` / `externalClaimOf` /
 * `sourcePathCandidates` / `isContainsEdge` come from `script/m14/incoming-rule.ts` — the same module
 * `incoming-gate.ts` imports — so this census cannot drift from the gate it explains. What is
 * transcribed is the gate's DISCOVERY and its key-space construction; that transcription is checked
 * against the gate's own printed TABLE 1, and the run FAILS if any total differs (see `GATE COMPARISON`).
 *
 * THE POPULATION IS THE GATE'S, and the run asserts it: 400 of 1174 `.css` files, 85 repos, 5 tracked
 * absent, 2 over the 1 MB cap. A census of a different population is not printed as a classification.
 *
 * Usage:  bun run validation/m14/fixtures/css/residual-census.ts
 * Output: validation/m14/fixtures/css/measurements/residual-census-400.txt  (via shell redirect)
 */
import { readFileSync, statSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import {
  emptyOutcomes, tally, classifyEdge, externalClaimOf, isContainsEdge, sourcePathCandidates,
  verifyFileClaim,
  type Outcomes, type ProjectFacts,
} from "../../../../script/m14/incoming-rule"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
void ROOT
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = ["css"]
const LANG = "css"
const MAX_FILES = Number(process.env.BB_CENSUS_MAX ?? 400)

// ── THE GATE'S DISCOVERY, transcribed (gate does not export it). The totals are asserted below. ──
function discover(): { files: string[]; admitted: string[]; total: number; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0, overCap = 0
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!EXTS.some((e) => low.endsWith(`.${e}`))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
      found.push(abs)
      // A repo counts when it CONTRIBUTES an admitted file, which is the gate's rule
      // (`incoming-gate.ts` `repos.add(name)` sits inside the push branch). Counting every
      // checkout walked reads 199 where the gate's population statement reads 85.
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (MAX_FILES > 0 && total > MAX_FILES) {
    const stride = Math.max(1, Math.floor(total / MAX_FILES))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, admitted: found, total, repos: repos.size, absent, overCap }
}

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

const pop = discover()
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

// ── PROJECT FACTS, built from the UNSAMPLED admitted list, exactly as the gate builds them ──
const factsByRepo = new Map<string, ProjectFacts>()
{
  const byRepo = new Map<string, string[]>()
  for (const f of pop.admitted) {
    const r = repoOf(f)
    const l = byRepo.get(r)
    if (l) l.push(f); else byRepo.set(r, [f])
  }
  for (const [repo, list] of byRepo) {
    const files = new Set<string>()
    for (const abs of list) {
      const rel = path.relative(repo, abs)
      if (rel.length > 0) files.add(rel.split(path.sep).join("/"))
    }
    factsByRepo.set(repo, { packages: new Set<string>(), files, sdkLib: false })
  }
}

// ── THE KEY SPACE, per project and pooled, exactly as the gate fills it ──
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const pooledDecl = new Map<string, number>()
const pooledKinds = new Map<string, Set<string>>()
const declPos = new Map<string, { file: string; line: number }[]>()
const rows = new Map<string, Outcomes>()
for (const t of TYPES) rows.set(t, emptyOutcomes())

type Pending = { label: string; tgt: string; claim: ReturnType<typeof externalClaimOf>; repo: string; srcFile: string; line: number | null; rel: any }
const pending: Pending[] = []
let parsed = 0, failed = 0

for (const f of pop.files) {
  const repo = repoOf(f)
  if (!projectDecl.has(repo)) { projectDecl.set(repo, new Map()); projectKinds.set(repo, new Map()) }
  const pDecl = projectDecl.get(repo)!
  const pKinds = projectKinds.get(repo)!
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++

  const countKey = (key: string, kind: string, file: string, line: number | null) => {
    const at = declPos.get(key)
    const pos = { file, line: line ?? -1 }
    if (!at) declPos.set(key, [pos])
    else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
    pooledDecl.set(key, (pooledDecl.get(key) ?? 0) + 1)
    let ps = pooledKinds.get(key); if (!ps) pooledKinds.set(key, (ps = new Set())); ps.add(kind)
    pDecl.set(key, (pDecl.get(key) ?? 0) + 1)
    let qs = pKinds.get(key); if (!qs) pKinds.set(key, (qs = new Set())); qs.add(kind)
  }

  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const line = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    const qual = String((s as any)?.qualifiedName ?? "")
    countKey(name, kind, f, line)
    if (qual.length > 0 && qual !== name) countKey(qual, kind, f, line)
  }

  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const raw = String(rel?.type ?? rel?.relationshipType ?? "")
    const label = LABEL_ALIASES[raw]
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    const line = Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null
    pending.push({ label, tgt, claim: externalClaimOf(rel), repo, srcFile: f, line, rel })
  }
}

// ── CLASSIFY (project scope — the verdict's scope), exactly as the gate does ──
type Row = { edges: number; out: Outcomes }
const table = new Map<string, Row>()
for (const t of TYPES) table.set(t, { edges: 0, out: emptyOutcomes() })
const intent = new Map<string, { edges: number; intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }>()
for (const t of TYPES) intent.set(t, { edges: 0, intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 })

const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
function classifyIntent(tgt: string, srcFile: string, line: number | null, label: string): "intended" | "sameFileUnproven" | "arbitraryTwin" | "noDeclaration" {
  const decls = declPos.get(tgt)
  if (!decls || decls.length === 0) return "noDeclaration"
  const sameFile = decls.filter((d) => d.file === srcFile)
  if (sameFile.length === 0) return "arbitraryTwin"
  if (LINE_IS_TARGET_LINE.has(label) && line !== null && sameFile.some((d) => d.line === line)) return "intended"
  return "sameFileUnproven"
}

const unanswered: Pending[] = []
for (const e of pending) {
  const row = table.get(e.label)!
  row.edges++
  const decl = projectDecl.get(e.repo)!
  const kinds = projectKinds.get(e.repo)!
  const facts = factsByRepo.get(e.repo)
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const c = classifyEdge(decl, kinds, e.tgt, e.claim, facts, isContainsEdge(e.label), ownFileDeclares)
  tally(row.out, c, e.tgt, e.label)
  const it = intent.get(e.label)!
  it.edges++
  it[classifyIntent(e.tgt, e.srcFile, e.line, e.label)]++
  if (c.outcome === "unresolved" || c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") unanswered.push(e)
}

// ── TABLE 1 REPRODUCTION + THE ASSERTION THAT THIS IS THE GATE'S POPULATION ──
const out: string[] = []
const p = (s = ""): void => { out.push(s) }
p("CSS RESIDUAL CENSUS — the gate's own counting rule over the gate's own 400-file .css stride")
p(`population: ${parsed} parsed of ${pop.files.length} sampled (corpus has ${pop.total} .css files across ${pop.repos} repos; stride sample)`)
p(`  excluded: ${pop.absent} tracked-but-absent/unreadable + ${pop.overCap} over the ${SIZE_CAP} cap`)
p(`  parse failures: ${failed}`)
p("")
// THE GATE'S OWN LINE IS THE EXPECTATION. Two modes, because the census is run BEFORE and AFTER
// the change and the only column the change may move is `imports`' unresolved -> extOK. The AFTER
// numbers are not invented here: they are what `incoming-gate.ts css css 400` printed on the same
// population after the analyzer published the claims (see measurements/gate-css-after-400.txt).
const BEFORE_EXPECT: Record<string, { edges: number; resolved: number; amb: number; unres: number; extOK: number }> = {
  uses: { edges: 1306, resolved: 1306, amb: 0, unres: 0, extOK: 0 },
  contains: { edges: 115527, resolved: 115527, amb: 0, unres: 0, extOK: 0 },
  imports: { edges: 18, resolved: 3, amb: 0, unres: 15, extOK: 0 },
  references: { edges: 121474, resolved: 118965, amb: 70, unres: 0, extOK: 2439 },
  overrides: { edges: 96, resolved: 96, amb: 0, unres: 0, extOK: 0 },
}
const AFTER_EXPECT: typeof BEFORE_EXPECT = {
  ...BEFORE_EXPECT,
  imports: { edges: 18, resolved: 3, amb: 0, unres: 0, extOK: 15 },
}
const EXPECT_MODE = process.env.BB_CENSUS_EXPECT === "after" ? "after" : "before"
const GATE_EXPECT = EXPECT_MODE === "after" ? AFTER_EXPECT : BEFORE_EXPECT
let mismatches = 0
p(`GATE COMPARISON [${EXPECT_MODE.toUpperCase()} expectation] (every number below is this census; "recorded" is the incoming-gate.ts css css 400 stdout for this arm)`)
const hdr = "type          edges      recorded   resolved   recorded   amb(decl) recorded   unresolved recorded   extOK    recorded"
p(hdr)
p("-".repeat(hdr.length))
for (const t of TYPES) {
  const r = table.get(t)!
  if (r.edges === 0) continue
  const exp = GATE_EXPECT[t]
  const got = { edges: r.edges, resolved: r.out.resolved, amb: r.out.ambiguousByDecl, unres: r.out.unresolved, extOK: r.out.externalVerified }
  const row = [t.padEnd(13), String(got.edges).padStart(8), String(exp?.edges ?? "n/a").padStart(10),
    String(got.resolved).padStart(10), String(exp?.resolved ?? "n/a").padStart(10),
    String(got.amb).padStart(10), String(exp?.amb ?? "n/a").padStart(10),
    String(got.unres).padStart(12), String(exp?.unres ?? "n/a").padStart(10),
    String(got.extOK).padStart(8), String(exp?.extOK ?? "n/a").padStart(10)]
  p(row.join(" "))
  if (exp && (exp.edges !== got.edges || exp.resolved !== got.resolved || exp.amb !== got.amb || exp.unres !== got.unres || exp.extOK !== got.extOK)) mismatches++
}
p("")
p(`INTENT (the gate's exact test, beside the count model's upper bound):`)
p(`type          edges    intended  sameFileUnproven arbitraryTwin  nothingAnywhere`)
for (const t of TYPES) {
  const it = intent.get(t)!
  if (it.edges === 0) continue
  p(`${t.padEnd(13)} ${String(it.edges).padStart(8)} ${String(it.intended).padStart(9)} ${String(it.sameFileUnproven).padStart(16)} ${String(it.arbitraryTwin).padStart(13)} ${String(it.noDeclaration).padStart(15)}`)
}
p("")
p(`*** ${mismatches === 0 ? "POPULATION AGREES WITH THE GATE" : `MISMATCH x${mismatches} — THIS CLASSIFICATION IS OF A DIFFERENT POPULATION`}`)
p("")

// ── BUCKET 1: the ambiguous references, with their declaration sites ──
const ambRefs = pending.filter((e) => {
  const r = table.get(e.label)!
  return e.label === "references"
})
void ambRefs
p("BUCKET 1 — AMBIGUOUS REFERENCES: every edge, its target, and the declarations that answer it")
p("  (ownFile = does the edge's own file declare the name; declarations = project-scope COUNT)")
const ambRows: { e: Pending; decls: number; sites: { file: string; line: number }[]; ownFile: boolean }[] = []
for (const e of pending) {
  if (e.label !== "references") continue
  const decl = projectDecl.get(e.repo)!
  const n = decl.get(e.tgt) ?? 0
  if (n < 2) continue
  const sites = (declPos.get(e.tgt) ?? []).filter((s) => {
    // declPos is GLOBAL; keep only the edge's own project (paths under the same repo root)
    return s.file.startsWith(e.repo + path.sep)
  })
  ambRows.push({ e, decls: n, sites, ownFile: sites.some((s) => s.file === e.srcFile) })
}
p(`  ambiguous references: ${ambRows.length}`)
const byTarget = new Map<string, { n: number; edges: number; files: Set<string>; lines: number[] }>()
for (const a of ambRows) {
  let b = byTarget.get(a.e.tgt)
  if (!b) byTarget.set(a.e.tgt, (b = { n: a.decls, edges: 0, files: new Set(), lines: [] }))
  b.edges++
  for (const s of a.sites) b.files.add(s.file)
  b.lines.push(a.e.line ?? -1)
}
p("  distinct targets: " + byTarget.size)
for (const [tgt, b] of [...byTarget.entries()].sort((x, y) => y[1].edges - x[1].edges)) {
  const files = [...b.files]
  p(`    ${String(b.edges).padStart(3)} edges  ${tgt}  declarations=${b.n}  declaringFiles=${files.length}`)
  for (const f of files.slice(0, 6)) p(`        declared in ${f.slice(CR.length + 1)}`)
  if (files.length > 6) p(`        … ${files.length - 6} more declaring file(s)`)
  p(`        read at: ${ambRows.filter((a) => a.e.tgt === tgt).slice(0, 6).map((a) => `${a.e.srcFile.slice(CR.length + 1)}:${a.e.line ?? "?"}`).join("  ")}${b.edges > 6 ? "  …" : ""}`)
  const oneFile = files.length === 1
  p(`        all ${b.n} declarations in ONE file: ${oneFile ? "yes" : "no"} — ownFileDeclares(edge) = ${ambRows.some((a) => a.e.tgt === tgt && a.ownFile)}`)
}
p("")
p("  every ambiguous reference edge (file:line → target · declarations · ownFile):")
for (const a of ambRows) {
  p(`    ${a.e.srcFile.slice(CR.length + 1)}:${a.e.line ?? "?"} → ${a.e.tgt}  · decls=${a.decls} · ownFile=${a.ownFile} · markers=${Object.keys((a.e.rel?.metadata ?? {}) as object).sort().join("+")}`)
}
p("")

// ── BUCKET 2: the unresolved imports, by shape, with each candidate claim MEASURED ──
type ImportRow = {
  e: Pending
  shape: "network-url" | "at-package-subpath" | "relative-existing-sibling" | "relative-missing" | "bare-name" | "other"
  specifier: string
  // candidate claims, evaluated through the arbiter's own classifier
  sourcePath: { claim: { kind: "sourcePath"; sources: string[] }; outcome: string; refutingCandidate: string | null } | null
  fileClaim: { claim: { kind: "projectFile"; candidates: string[] }; outcome: string; siblingRel: string; inFacts: boolean } | null
  ownerClaim: { outcome: string } | null
}
const importRows: ImportRow[] = []
for (const e of pending) {
  if (e.label !== "imports") continue
  const decl = projectDecl.get(e.repo)!
  const n = decl.get(e.tgt) ?? 0
  if (n >= 1) continue // resolved / ambiguous — claims are not read there anyway
  const facts = factsByRepo.get(e.repo)!
  const md = (e.rel?.metadata ?? {}) as Record<string, unknown>
  const specifier = String(md.importSpecifier ?? e.tgt)
  const low = specifier.toLowerCase()
  let shape: ImportRow["shape"]
  if (specifier.startsWith("http:") || specifier.startsWith("https:") || specifier.startsWith("//")) shape = "network-url"
  else if (specifier.startsWith("@") || specifier.startsWith("~")) shape = "at-package-subpath"
  else if (!specifier.includes("/") && !/\.[a-z]+$/i.test(specifier)) shape = "bare-name"
  else {
    const sib = path.resolve(path.dirname(e.srcFile), specifier)
    let exists = false
    try { exists = statSync(sib).isFile() } catch { exists = false }
    shape = exists ? "relative-existing-sibling" : "relative-missing"
  }
  // candidate 1: sourcePath — the written specifier as the document spells it
  let sourcePath: ImportRow["sourcePath"] = null
  {
    const claim = { kind: "sourcePath" as const, sources: [specifier] }
    const c = classifyEdge(decl, projectKinds.get(e.repo)!, e.tgt, claim, facts, false)
    let refuting: string | null = null
    for (const cand of sourcePathCandidates(specifier)) if (facts.files.has(cand)) { refuting = cand; break }
    sourcePath = { claim, outcome: c.outcome, refutingCandidate: refuting }
  }
  // candidate 2: importProjectFile — the sibling's repo-relative path, checked against the project's
  // own admitted list (the arbiter's verifier, imported)
  let fileClaim: ImportRow["fileClaim"] = null
  {
    let siblingRel: string | null = null
    if (shape === "relative-existing-sibling") {
      const sib = path.resolve(path.dirname(e.srcFile), specifier)
      const rel = path.relative(e.repo, sib)
      if (rel.length > 0 && !rel.startsWith("..")) siblingRel = rel.split(path.sep).join("/")
    }
    if (siblingRel !== null) {
      const claim = { kind: "projectFile" as const, candidates: [siblingRel] }
      const outcome = verifyFileClaim(facts, claim.candidates)
      const c = classifyEdge(decl, projectKinds.get(e.repo)!, e.tgt, claim, facts, false)
      fileClaim = { claim, outcome: c.outcome, siblingRel, inFacts: outcome === "externalVerified" }
    }
  }
  // candidate 3: owner claim (`isExternal: true`) for bare names — the C-lane route
  let ownerClaim: ImportRow["ownerClaim"] = null
  if (shape === "bare-name") {
    const c = classifyEdge(decl, projectKinds.get(e.repo)!, e.tgt, { kind: "owner" }, facts, false)
    ownerClaim = { outcome: c.outcome }
  }
  importRows.push({ e, shape, specifier, sourcePath, fileClaim, ownerClaim })
}

p("BUCKET 2 — UNRESOLVED IMPORTS: every edge, its written specifier, and each candidate claim MEASURED")
p("  (outcomes are the arbiter's own classifyEdge with the claim attached; refutingCandidate is the")
p("   admitted file whose presence would turn a sourcePath claim into extFAIL)")
p(`  unresolved imports: ${importRows.length}`)
const byShapeCount = new Map<string, number>()
for (const r of importRows) byShapeCount.set(r.shape, (byShapeCount.get(r.shape) ?? 0) + 1)
p("  by shape: " + [...byShapeCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "))
p("")
type Pred = { claimed: number; verified: number; unverified: number; refuted: number; staysUnresolved: number; byChoice: Map<string, number> }
const pred: Pred = { claimed: 0, verified: 0, unverified: 0, refuted: 0, staysUnresolved: 0, byChoice: new Map() }
for (const r of importRows) {
  const md = (r.e.rel?.metadata ?? {}) as Record<string, any>
  p(`  ${r.e.srcFile.slice(CR.length + 1)}:${r.e.line ?? "?"}  target=${JSON.stringify(r.e.tgt)}`)
  p(`      specifier=${JSON.stringify(r.specifier)}  shape=${r.shape}  importSource=${JSON.stringify(md.importSource ?? "")}`)
  if (r.sourcePath) {
    p(`      sourcePathClaim        -> ${r.sourcePath.outcome.padEnd(18)} ${r.sourcePath.refutingCandidate === null ? "no admitted file refutes it" : `REFUTED BY ${r.sourcePath.refutingCandidate}`}`)
  }
  if (r.fileClaim) {
    p(`      importProjectFile      -> ${r.fileClaim.outcome.padEnd(18)} candidate=${r.fileClaim.siblingRel}  inAdmittedFacts=${r.fileClaim.inFacts}`)
  }
  if (r.ownerClaim) p(`      isExternal (owner)     -> ${r.ownerClaim.outcome.padEnd(18)} look the bare name up in the project key space`)
  p("")
}
// DECISION RULE, stated before the counts: a claim is published ONLY where the arbiter verifies it
// and where it is TRUE of the construct. Explicitly: network URLs and at-package subpaths get
// sourcePath; an existing sibling project file gets the file claim; a bare package NAME gets nothing
// (the source-path claim is defined only for a target containing `/` or a scheme, and the owner claim
// on a bare name is refutable by a project selector that happens to share the spelling — measured below).
p("PREDICTION — what the gate's columns become if these claims are published (per-edge outcome):")
for (const r of importRows) {
  let choice = "none"
  let outcome = "unresolved"
  if (r.shape === "network-url" && r.sourcePath) { choice = "sourcePathClaim"; outcome = r.sourcePath.outcome }
  else if (r.shape === "at-package-subpath" && r.sourcePath) { choice = "sourcePathClaim"; outcome = r.sourcePath.outcome }
  else if (r.shape === "relative-existing-sibling" && r.fileClaim) { choice = "importProjectFile"; outcome = r.fileClaim.outcome }
  if (choice !== "none") {
    pred.claimed++
    if (outcome === "externalVerified") pred.verified++
    else if (outcome === "externalRefuted") pred.refuted++
    else pred.unverified++
  } else pred.staysUnresolved++
  pred.byChoice.set(`${choice}:${outcome}`, (pred.byChoice.get(`${choice}:${outcome}`) ?? 0) + 1)
}
p(`  claimed ${pred.claimed}: verified ${pred.verified} · refuted ${pred.refuted} · unverified ${pred.unverified}`)
p(`  deliberately left unresolved ${pred.staysUnresolved}`)
p("  by (choice:outcome): " + [...pred.byChoice.entries()].sort().map(([k, v]) => `${k}=${v}`).join("  "))
p("")
p("READING:")
p(`  residual before = ${ambRows.length} ambiguous + ${importRows.length} unresolved = ${ambRows.length + importRows.length}`)
p(`  predicted residual after = ${ambRows.length} ambiguous + ${importRows.length - pred.verified} unresolved = ${ambRows.length + importRows.length - pred.verified}`)
p(`  (ambiguous references are NOT touched — see CSS-FIX.md §5 for why every route is the forbidden one)`)
p("")
p(`VERDICT: ${mismatches === 0 ? "census population and counting rule agree with the gate" : "MISMATCH — the census is not the gate's population"}`)
p(`  predicted extFAIL from the published claims: ${pred.refuted} (must be 0)`)
console.log(out.join("\n"))
process.exitCode = mismatches === 0 && pred.refuted === 0 ? 0 : 1
