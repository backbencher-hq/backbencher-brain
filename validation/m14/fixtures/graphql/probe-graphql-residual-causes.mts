/**
 * PROBE-GRAPHQL-RESIDUAL-CAUSES — the gate's population, the gate's rule, and the residual
 * attributed to a NAMED cause per type with a measured count.
 *
 * ## Why this file exists
 *
 * The lane's residual gate reads `FAIL — 31,012 ambiguous + 53,063 unresolved of 205,327 edges`.
 * That is a worklist, not a cause list: the programme's bar is that every ambiguous and unresolved
 * edge is attributed to a named cause with a MEASURED count, and a cause is a property of an
 * EMITTING SITE plus the evidence about its target — neither of which the gate's per-type table can
 * express. `script/m14/incoming-gate.ts` prints a marker-set table (edges grouped by the metadata
 * KEYS they carry), which is the site half; it cannot say whether the target names something the
 * GraphQL specification predeclares, something no file in the project declares, or something the
 * edge's own file declares exactly once.
 *
 * So this probe answers, over the WHOLE admitted population and in ONE walk:
 *
 *   1. REPRODUCE the gate's TABLE 1 columns exactly, or refuse. A probe that cannot reproduce the
 *      gate is evidence about the probe, not about the lane (bash-lane's rule, §5w of the handoff:
 *      its first probe agreed on the edge count and read 0 where the gate read 42,392).
 *   2. THE CAUSE TABLE — residual per (type × relationshipRole × marker-set signature), with the
 *      target names that carry it, in the gate's own marker-set unit.
 *   3. THE EVIDENCE SPLIT of that residual — spec vocabulary (declared lists), dotted targets whose
 *      OWNER the project publishes, dotted targets whose owner it does not, bare names nothing
 *      declares, path-shaped targets. First-match, so the classes sum to the residual exactly.
 *   4. THE OWN-FILE DETERMINACY of the ambiguous half — of the edges the count model calls
 *      ambiguous, how many have EXACTLY ONE declaration of the target in the edge's OWN file. For
 *      those, production's `resolveTargetStmt` (`ORDER BY … (s.file_id = ?) DESC … LIMIT 1`) has a
 *      determinate answer, so `amb(decl)` is a statement about the NAME-KEYED MODEL, not the graph.
 *   5. THE §5e RESPELL CEILING — of those, how many would ALSO become project-unique if the target
 *      were respelled to the own-file declaration's derived `qualifiedName`. The programme's most
 *      repeated fix, and §5w says its ceiling must be MEASURED per lane before it is written
 *      (php 100% · bash 59.5% · julia 0.6%). §5e's monotonicity clause is COMPUTED, not assumed.
 *
 * ## The scope, because it is the whole difference between two published numbers
 *
 * Every key space here is PER PROJECT (the repository a file belongs to) — `parallel-indexer.
 * resolveRelationships`' scope, and the scope `incoming-gate.ts`'s TABLE 1 (the verdict's) resolves
 * in. A single pooled map over the corpus is TABLE 2's scope and reads `101,893 ambiguous / 18,989
 * unresolved` on the same edges: a number about the corpus's name collisions, not about resolution.
 *
 * ## What it must NOT do
 *
 * It does not attach a claim, does not respell anything, and does not print a rate as a result. The
 * `spec:` classes are LABELS ON EVIDENCE (a name the specification predeclares), NEVER a marker:
 * §5k/§5l rule that a claim must be checkable by a mechanism the claimant does not control, and for
 * a BARE target `verifyExternalClaim` verifies by construction — the only refutation it can reach is
 * the one `classifyEdge` has already excluded (`decls === 0`). Marking those edges external would
 * move the residual without making one edge truer; that is the laundering vector julia-lane refused.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/graphql/probe-graphql-residual-causes.mts \
 *        [--ext graphql,gql] [--compare <gate-run.log>] [--top 8]
 *
 * Read-only.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import {
  classifyEdge, externalClaimOf, emptyOutcomes, tally, isContainsEdge, pathLikeTarget,
} from "../../../../script/m14/incoming-rule"
import type { Outcomes } from "../../../../script/m14/incoming-rule"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
/** BOTH spellings the ROUTER maps to this language, because the lane's population is the pair:
 *  a probe that admits one measures a different population than the gate it claims to reproduce. */
const EXTS = (flag("ext") ?? "graphql,gql").split(",").map((e) => e.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
const COMPARE = flag("compare")
const TOP = Number(flag("top") ?? "8")
const ALL_TYPES = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------------------------------------
// THE SPECIFICATION'S OWN DECLARED VOCABULARY — used ONLY to label evidence, never to mark an edge.
// Each list is CLOSED, so the label is auditable: a name not in one of them cannot be filed under it.
// ---------------------------------------------------------------------------------------------
/** spec §3.5 "Scalars" — the five built-in scalars; the spec forbids a schema to redefine them. */
const SPEC_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"])
/** spec §3.13 "Built-in Directives". Split from the draft directives ON PURPOSE: `@defer`/`@stream`
 *  are draft/experimental rather than released-spec built-ins, and a bucket that merges them is a
 *  bucket a reader cannot audit. */
const SPEC_DIRECTIVES = new Set(["skip", "include", "deprecated", "specifiedBy", "oneOf"])
const SPEC_DIRECTIVES_DRAFT = new Set(["defer", "stream"])

/** `Owner.field` -> `Owner`. FIRST dot, the spelling a member target uses. */
const ownerOf = (t: string): string | null => {
  const i = t.indexOf(".")
  if (i <= 0) return null
  return t.slice(0, i)
}
const headOf = (t: string): string => {
  const raw = ownerOf(t) ?? t
  return raw.startsWith("@") ? raw.slice(1) : raw
}
/** THE LAST SEGMENT — the MEMBER of a dotted target (`JiraIssueField.__typename` -> `__typename`). */
const memberOf = (t: string): string | null => {
  const i = t.lastIndexOf(".")
  if (i <= 0 || i === t.length - 1) return null
  return t.slice(i + 1)
}
/**
 * THE SPEC LABEL, or null. The `__` test is the specification's own reservation (§3.9 "Reserved
 * Names"): names beginning with `__` are reserved for introspection and a schema may not define
 * them. That makes it a LANGUAGE FACT rather than a heuristic.
 *
 * IT IS TESTED ON THE **MEMBER** SEGMENT AS WELL AS THE HEAD, and the first version of this function
 * did not — which would have misfiled the lane's largest single spec class. `JiraIssueField.__typename`
 * is `__typename`, the meta-field spec §3.6.3 defines for EVERY type; its head is `JiraIssueField`,
 * an ordinary project type, so a head-only test files it under "the owner does not declare this
 * member" — a bucket that mixes a spec-reserved name no schema may declare with a genuine
 * split-schema gap, and those are different facts with different owners (§5x).
 */
const specLabel = (t: string): string | null => {
  const head = headOf(t)
  if (head.startsWith("__")) return "spec:__-reserved (introspection namespace)"
  if (SPEC_SCALARS.has(head)) return "spec:built-in scalar"
  if (SPEC_DIRECTIVES.has(head)) return "spec:built-in directive"
  if (SPEC_DIRECTIVES_DRAFT.has(head)) return "spec:draft directive"
  const member = memberOf(t)
  if (member !== null && member.startsWith("__")) return "spec:__-reserved meta-field (`Type.__typename`)"
  return null
}

// ------------------------------------------------------------------ discovery (the gate's rule)
const found: string[] = []
const repos = new Set<string>()
let absent = 0
let overCap = 0
let overCapLargest = 0
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const low = rel.toLowerCase()
    if (!EXTS.some((e) => low.endsWith(`.${e}`))) continue
    const abs = path.join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) {
        overCap++
        overCapLargest = Math.max(overCapLargest, size)
        continue
      }
    } catch {
      absent++
      continue
    }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()
const files = found
/**
 * THE PROJECT KEY IS THE ABSOLUTE REPOSITORY ROOT, and this probe's first version got it wrong in
 * a way that the reproduction check caught: it used the repository NAME (`gql-graphql-tools`) as
 * both the parse context and `projectRoot`, while `incoming-gate.ts` builds
 * `path.join(CR, firstSegment)` — an absolute path. Everything else reproduced, because the key
 * space is grouped by the same partition either way; the ONE thing that moved was `imports`
 * (`unresolved 170 vs 14`, `extOK 0 vs 156`), because the analyzer attaches its `importProjectFile`
 * claim only when `context.projectRoot` is a non-empty STRING and the guard then resolves the
 * target against it. A bare name resolves nothing, so the claim quietly never attached.
 *
 * THAT IS THE WHOLE ARGUMENT FOR THIS CHECK. The instrument was wrong in exactly one column, and
 * the column it was wrong in is the one a lane would have "fixed" next. `parsed=1911 failed=0` and
 * every other cell agreed, so nothing but a reproduction check could have said so.
 */
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}
const relOf = (f: string): string => path.relative(repoOf(f), f).split(path.sep).join("/")

// ------------------------------------------------------------ the key space, PER PROJECT (TABLE 1)
type Proj = {
  decl: Map<string, number>
  kinds: Map<string, Set<string>>
  /** key -> (file -> declarations in that file) — the own-file test's whole input */
  byFile: Map<string, Map<string, number>>
}
const newProj = (): Proj => ({ decl: new Map(), kinds: new Map(), byFile: new Map() })
const projs = new Map<string, Proj>()
const proj = (repo: string): Proj => {
  let p = projs.get(repo)
  if (!p) projs.set(repo, (p = newProj()))
  return p
}
const bumpKey = (p: Proj, key: string, kind: string, file: string) => {
  p.decl.set(key, (p.decl.get(key) ?? 0) + 1)
  let ks = p.kinds.get(key)
  if (!ks) p.kinds.set(key, (ks = new Set()))
  ks.add(kind)
  let byFile = p.byFile.get(key)
  if (!byFile) p.byFile.set(key, (byFile = new Map()))
  byFile.set(file, (byFile.get(file) ?? 0) + 1)
}
/** A symbol's symbol row as the key space sees it. */
type Sym = { name: string; qname: string; kind: string; line: number }
/** the symbols a FILE publishes — the own-file-proof clause of the respell test */
const fileSymbols = new Map<string, Sym[]>()
/** the project's own admitted file list, per repo — the evidence a FILE claim is checked against */
const projectFileList = new Map<string, Set<string>>()

type Pending = {
  label: Type
  tgt: string
  /** the SOURCE as the analyzer spelled it — checked in its own table, because a relationship whose
   *  source names nothing is a fact about nothing, and nothing in the residual gate measures that. */
  src: string
  /** `metadata.fileLevel === true`, the M60/#910 store contract for a module-level edge */
  srcFileLevel: boolean
  claim: ReturnType<typeof externalClaimOf>
  repo: string
  file: string
  rel: string
  line: number
  /** the marker-set SIGNATURE — the gate's own rule, re-spelled from the rule's definition */
  sig: string
  role: string
}
const pending: Pending[] = []
const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
let parsed = 0
let failed = 0
let degraded = 0
let holes = 0
let emptyFiles = 0
for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch {
    failed++
    continue
  }
  if (!r) {
    failed++
    continue
  }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const syms = Array.isArray(r.symbols) ? r.symbols : []
  const rels = Array.isArray(r.relationships) ? r.relationships : []
  if (syms.length === 0 && rels.length === 0) {
    // A file the engine never actually analysed (a timeout returns `symbols: []`) contributes NO
    // EDGES AT ALL — the population hole `incoming-gate` reports. Counted, never folded in silently.
    if (statSync(f).size > 0) holes++
    else emptyFiles++
  }
  const p = proj(repo)
  const list = fileSymbols.get(f) ?? []
  if (!fileSymbols.has(f)) fileSymbols.set(f, list)
  for (const s of syms) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const qname = String(s?.qualifiedName ?? "")
    const kind = String(s?.kind ?? "")
    const line = Number(s?.range?.startLine ?? s?.line_start ?? s?.line ?? 0) || 0
    list.push({ name, qname, kind, line })
    bumpKey(p, name, kind, f)
    // THE ALIAS IS THE SAME DECLARATION, not a second one (`incoming-gate`'s own comment): it is
    // another SPELLING of one symbol, and counting it is what makes a qualified target findable.
    if (qname.length > 0 && qname !== name) bumpKey(p, qname, kind, f)
  }
  for (const rel of rels) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "") as Type
    if (!ALL_TYPES.includes(label)) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    const md = (rel as any)?.metadata ?? {}
    const markKeys = Object.keys(md).filter(
      (k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null,
    )
    markKeys.sort()
    pending.push({
      label, tgt, claim: externalClaimOf(rel), repo, file: f, rel: relOf(f),
      src: String((rel as any)?.source ?? (rel as any)?.from ?? ""),
      srcFileLevel: md.fileLevel === true,
      line: Number((rel as any)?.line_number ?? 0) || 0,
      sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      role: String(md.relationshipRole ?? "(none)"),
    })
  }
}
for (const f of files) {
  const repo = repoOf(f)
  let s = projectFileList.get(repo)
  if (!s) projectFileList.set(repo, (s = new Set()))
  s.add(relOf(f))
}

// --------------------------------------------------------------- classification: production scope
type Row = Outcomes & { edges: number }
const rows = new Map<Type, Row>()
for (const ty of ALL_TYPES) rows.set(ty, { ...emptyOutcomes(), edges: 0 })
/** type × (role · marker set) — the emitting SITE. */
type Site = Outcomes & { edges: number }
const sites = new Map<Type, Map<string, Site>>()
for (const ty of ALL_TYPES) sites.set(ty, new Map())
const emptyKinds = new Map<string, Set<string>>()

/** every not-resolved edge, kept for the evidence and determinacy tables. */
type Resid = Pending & { decls: number; amb: boolean }
const resid: Resid[] = []
for (const e of pending) {
  const p = proj(e.repo)
  const facts = { packages: new Set<string>(), files: projectFileList.get(e.repo) ?? new Set<string>(), sdkLib: false }
  // classified against the PROJECT's own key space, with the project's own file list — the same two
  // arguments `incoming-gate.ts`'s classification pass passes (including `containsLike`).
  const c = classifyEdge(p.decl, p.kinds ?? emptyKinds, e.tgt, e.claim, facts, isContainsEdge(e.label))
  const row = rows.get(e.label)!
  row.edges++
  tally(row, c, e.tgt, e.label)
  const key = `${e.role} · ${e.sig}`
  const m = sites.get(e.label)!
  let site = m.get(key)
  if (!site) m.set(key, (site = { ...emptyOutcomes(), edges: 0 }))
  site.edges++
  tally(site, c, e.tgt, e.label)
  const amb = c.outcome === "ambDeclOnly" || c.outcome === "ambBoth"
  if (amb || c.outcome === "unresolved") resid.push({ ...e, decls: c.decls, amb })
}

// ------------------------------------------------------------------- the reproduction check (§5w)
/** read the gate's TABLE 1 rows out of a run log: `type edges resolved collRes amb ambKind unres …` */
function parseGateTable(text: string): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const line of text.split("\n")) {
    const line2 = line.trim()
    const first = line2.split(/\s+/)[0]
    if (first !== "TOTAL" && !(ALL_TYPES as readonly string[]).includes(first)) continue
    const parts = line2.split(/\s+/)
    if (parts.length < 15) continue
    const nums = parts.slice(1).map((x) => Number(x.replace(/,/g, "")))
    if (nums.some((n) => !Number.isFinite(n))) continue
    out.set(parts[0], nums)
  }
  return out
}
const COLS = ["edges", "resolved", "collRes", "amb(decl)", "amb(kind)", "unresolved", "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL"]
const diffs: string[] = []
let reproduces: boolean | null = null
if (COMPARE !== undefined) {
  const gate = parseGateTable(readFileSync(COMPARE, "utf8"))
  let compared = 0
  for (const ty of ALL_TYPES) {
    const g = gate.get(ty)
    if (!g) continue
    compared++
    const r = rows.get(ty)!
    const mine = [r.edges, r.resolved, r.resolvedAmongCollision, r.ambiguousByDecl, r.ambiguousByKind, r.unresolved, r.externalVerified, r.externalUnverified, r.externalRefuted, r.bindingVerified, r.bindingUnverified, r.bindingRefuted, r.causeDeclared, r.causeRefuted]
    for (let i = 0; i < COLS.length; i++) if (g[i] !== mine[i]) diffs.push(`${ty}.${COLS[i]}: gate ${g[i]} vs probe ${mine[i]}`)
  }
  if (compared === 0) diffs.push("the gate log carried no TABLE 1 row this probe could compare against")
  reproduces = diffs.length === 0
}

const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const num = (n: number) => n.toLocaleString("en-US")

console.log(`PROBE-GRAPHQL-RESIDUAL-CAUSES  ext=${EXTS.map((e) => `.${e}`).join(",")}`)
console.log(`  population: ${files.length} admitted of ${files.length + overCap + absent} tracked, ${repos.size} repos · parsed=${parsed} failed=${failed} degraded=${degraded}`)
console.log(`  excluded: absent=${absent} over-cap=${overCap}${overCap > 0 ? ` (largest ${(overCapLargest / 1024 / 1024).toFixed(1)} MB)` : ""}`)
console.log(`  population holes (content, 0 symbols AND 0 relationships — a timed-out file contributes NOTHING): ${holes}`)
console.log(`  genuinely empty files (0 bytes/whitespace): ${emptyFiles}`)
console.log(`  key space: PER PROJECT (production's scope) over ${projs.size} project(s), name + qualifiedName alias`)
console.log("")

console.log("REPRODUCTION CHECK — this probe's columns against the gate's own TABLE 1 (§5w: a probe that")
console.log("cannot reproduce the gate is evidence about the probe, not about the lane):")
if (COMPARE === undefined) {
  console.log(`  UNCHECKED — no --compare <gate-run.log> given. Every table below is UNCHECKED.`)
} else if (reproduces === true) {
  console.log(`  AGREE — all 14 columns × ${ALL_TYPES.length} types identical to ${COMPARE}`)
} else {
  console.log(`  ** DISAGREE ** — ${diffs.length} cell(s) differ from ${COMPARE}:`)
  for (const d of diffs.slice(0, 20)) console.log(`     ${d}`)
  console.log(`  REFUSING to draw a conclusion from a probe that does not reproduce the gate.`)
  process.exit(2)
}
console.log("")

// -------------------------------------------------------------------------------------- TABLE 1
const t = (ty: Type) => rows.get(ty)!
const totalEdges = ALL_TYPES.reduce((a, ty) => a + t(ty).edges, 0)
const residOf = (r: Outcomes) => r.ambiguousByDecl + r.unresolved + r.externalRefuted + r.bindingRefuted + r.causeRefuted
let totalResid = 0
for (const ty of ALL_TYPES) totalResid += residOf(t(ty))
console.log("TABLE 1 — PER TYPE (production scope):")
console.log(`  ${w("type", 13)} ${w("edges", 8)} ${w("resolved", 9)} ${w("amb(decl)", 10)} ${w("unresolved", 11)} ${w("extOK", 7)} ${w("extFAIL", 8)} ${w("residual", 9)} ${w("share", 7)}`)
for (const ty of [...ALL_TYPES].sort((a, b) => residOf(t(b)) - residOf(t(a)))) {
  const r = t(ty)
  if (r.edges === 0) continue
  const res = residOf(r)
  console.log(`  ${w(ty, 13)} ${w(num(r.edges), 8)} ${w(num(r.resolved), 9)} ${w(num(r.ambiguousByDecl), 10)} ${w(num(r.unresolved), 11)} ${w(num(r.externalVerified), 7)} ${w(num(r.externalRefuted), 8)} ${w(num(res), 9)} ${w(((res / totalEdges) * 100).toFixed(2) + "%", 7)}`)
}
console.log(`  ${w("TOTAL", 13)} ${w(num(totalEdges), 8)} ${w("", 9)} ${w("", 10)} ${w("", 11)} ${w("", 7)} ${w("", 8)} ${w(num(totalResid), 9)} ${w(((totalResid / totalEdges) * 100).toFixed(2) + "%", 7)}`)
console.log("")

// -------------------------------------------------------------------------------------- TABLE 2
console.log(`TABLE 2 — CAUSE BY EMITTING SITE (type × relationshipRole × marker set), ordered by residual.`)
console.log(`  The marker set is the gate's own unit: the metadata KEYS on the edge, minus evidenceClass/analysisVersion.`)
console.log(`  ${w("type", 11)} ${w("relationshipRole", 28)} ${w("marker set", 48)} ${w("edges", 7)} ${w("res", 7)} ${w("amb", 6)} ${w("unres", 6)} ${w("residual", 8)} ${w("share", 7)}`)
const flat: { ty: Type; role: string; sig: string; site: Site; res: number }[] = []
for (const ty of ALL_TYPES) {
  for (const [key, site] of sites.get(ty)!) {
    const res = residOf(site)
    if (res === 0) continue
    const [role, sig] = key.split(" · ")
    flat.push({ ty, role, sig, site, res })
  }
}
flat.sort((a, b) => b.res - a.res)
for (const f of flat.slice(0, TOP * 2)) {
  console.log(`  ${w(f.ty, 11)} ${w(f.role, 28)} ${w(f.sig, 48)} ${w(num(f.site.edges), 7)} ${w(num(f.site.resolved), 7)} ${w(num(f.site.ambiguousByDecl), 6)} ${w(num(f.site.unresolved), 6)} ${w(num(f.res), 8)} ${w(((f.res / totalResid) * 100).toFixed(1) + "%", 7)}`)
}
console.log(`  (${flat.length} site(s) carry residual; the ${Math.min(TOP * 2, flat.length)} largest are shown)`)
console.log("")

// -------------------------------------------------------------------------------------- TABLE 3
/**
 * THE EVIDENCE SPLIT — first-match, so the classes sum to the residual exactly. The order is the
 * order of specificity: a path is not a name, a spec-reserved name is not a missing declaration, and
 * a dotted target whose OWNER the project publishes is a different fact from one whose owner it does
 * not. `BARE-NAME-DECLARED-ONCE` is a CONTROL: at project scope a name with exactly one declaration
 * must have resolved, so a non-zero count there means the model and the key space disagree.
 */
type Ev = { edges: number; amb: number; unres: number; names: Map<string, number> }
const evByType = new Map<Type, Map<string, Ev>>()
const eV = (ty: Type, cls: string): Ev => {
  let m = evByType.get(ty)
  if (!m) evByType.set(ty, (m = new Map()))
  let e = m.get(cls)
  if (!e) m.set(cls, (e = { edges: 0, amb: 0, unres: 0, names: new Map() }))
  return e
}
const classifyEvidence = (e: Resid): string => {
  if (pathLikeTarget(e.tgt)) return "PATH-SHAPED (a path or URI cannot be a published name)"
  const spec = specLabel(e.tgt)
  if (spec !== null) return spec
  const owner = ownerOf(e.tgt)
  const p = proj(e.repo)
  if (owner === null) {
    if (e.decls === 0) return "BARE-NAME-ABSENT (nothing in the project declares this name)"
    if (e.decls === 1) return "BARE-NAME-DECLARED-ONCE <-- CONTROL (must be 0: one declaration resolves)"
    return `BARE-NAME-COLLIDING (${e.decls} declarations in the project)`
  }
  const ownerDecls = p.decl.get(owner) ?? 0
  if (ownerDecls === 0) return "DOTTED-OWNER-ABSENT (the owner type is declared nowhere in the project)"
  if (e.amb) return `DOTTED-MEMBER-COLLIDING (${e.decls} declarations; the owner IS declared)`
  return "DOTTED-OWNER-DECLARED-MEMBER-ABSENT (a member the owner does not declare)"
}
for (const e of resid) {
  const ev = eV(e.label, classifyEvidence(e))
  ev.edges++
  // THE TWO HALVES ARE COUNTED APART. The residual is amb + unres, and the two have different owners
  // (`amb` is a name collision the model cannot break; `unres` is a target nothing answers). A class
  // table that prints only the sum cannot say which of the two a fix would move, which is exactly the
  // question a lane asks before editing code — so each class carries its own split and each type's
  // split must close on the type's own amb/unres columns.
  if (e.amb) ev.amb++
  else ev.unres++
  ev.names.set(e.tgt, (ev.names.get(e.tgt) ?? 0) + 1)
}
console.log(`TABLE 3 — THE EVIDENCE SPLIT OF THE RESIDUAL (${num(resid.length)} edges · first-match · classes sum to the type's residual):`)
for (const ty of ALL_TYPES) {
  const m = evByType.get(ty)
  if (!m) continue
  const tRow = t(ty)
  const res = residOf(tRow)
  const sum = [...m.values()].reduce((a, x) => a + x.edges, 0)
  console.log(`  ${ty} — residual ${num(res)} (amb ${num(tRow.ambiguousByDecl)} · unres ${num(tRow.unresolved)}) · classified ${num(sum)}${sum === res ? " = residual OK" : " ** DOES NOT ADD UP **"}`)
  for (const [cls, ev] of [...m.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
    const top = [...ev.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}(${num(c)})`).join(" ")
    // THE DISTINCT-NAME COUNT IS PART OF THE CLASS, not decoration: "2,000 edges over 3 names" and
    // "2,000 edges over 2,000 names" have different owners, and a bucket that prints only edges
    // cannot tell a lane which one it is looking at.
    console.log(`      ${w(num(ev.edges), 7)}  ${w(((ev.edges / res) * 100).toFixed(1) + "%", 6)}  ${w(cls, 68)} names=${w(num(ev.names.size), 6)} e.g. ${top}`)
  }
}
console.log("")
// ------------------------------------------------------------------------------------- TABLE 3b
/**
 * THE UNRESOLVED HALF, BUCKETED BY THE SAME NAMED CLASS — the number a fix is judged on.
 *
 * TABLE 3 answers "what is the residual made of"; this answers "what is the part with NO ANSWER made
 * of", and they are not the same list in the same order: `uses`' largest class overall is the
 * `__`-reserved introspection namespace, but a class can be mostly AMBIGUOUS rather than unresolved
 * (a bare `name` collides with many declarations and is answered by the tie-break, so it is a
 * different problem from a name nothing declares). A lane that reads TABLE 3 and fixes the top row
 * can spend its whole change on a collision the count model cannot break and move `unresolved` by 0.
 *
 * The closure is per type: Σ(classes' unres) must equal the type's `unresolved` column, and the type
 * line REFUSES to print a verdict when it does not.
 */
console.log(`TABLE 3b — THE UNRESOLVED HALF OF EACH NAMED CLASS (the part with NO answer at all):`)
for (const ty of ALL_TYPES) {
  const m = evByType.get(ty)
  if (!m) continue
  const tRow = t(ty)
  if (tRow.unresolved === 0) continue
  const sum = [...m.values()].reduce((a, x) => a + x.unres, 0)
  console.log(`  ${ty} — unresolved ${num(tRow.unresolved)} · classified ${num(sum)}${sum === tRow.unresolved ? " = unresolved OK" : " ** DOES NOT ADD UP **"}`)
  for (const [cls, ev] of [...m.entries()].filter(([, x]) => x.unres > 0).sort((a, b) => b[1].unres - a[1].unres)) {
    const top = [...ev.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => `${n}(${num(c)})`).join(" ")
    console.log(`      ${w(num(ev.unres), 7)}  ${w(((ev.unres / tRow.unresolved) * 100).toFixed(1) + "%", 6)}  of which amb ${w(num(ev.amb), 7)}  ${w(cls, 60)} names=${w(num(ev.names.size), 6)} e.g. ${top}`)
  }
}
console.log("")

// -------------------------------------------------------------------------------------- TABLE 4
/**
 * THE OWN-FILE DETERMINACY — the ruling this probe exists to price.
 *
 * Production's `resolveTargetStmt` orders by `COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC,
 * (s.language = ?), s.id` and takes LIMIT 1, so when the edge's OWN FILE declares the name EXACTLY
 * ONCE the binding is determinate and no tie-break is consulted. `classifyEdge` cannot see this: it
 * is handed a name-keyed count and no file (its own docstring says so). So for every AMBIGUOUS edge
 * this asks the exact question the model cannot: how many declarations of the target live in the
 * edge's own file?
 */
type Det = { ownOne: number; ownMany: number; ownZero: number; qualifiedUnique: number; qualifiedAlsoMultiple: number; noBetterSpelling: number; monoViolations: number; unproven: number }
const det = new Map<Type, Det>()
for (const ty of ALL_TYPES) det.set(ty, { ownOne: 0, ownMany: 0, ownZero: 0, qualifiedUnique: 0, qualifiedAlsoMultiple: 0, noBetterSpelling: 0, monoViolations: 0, unproven: 0 })
for (const e of resid) {
  if (!e.amb) continue
  const d = det.get(e.label)!
  const p = proj(e.repo)
  const own = p.byFile.get(e.tgt)?.get(e.file) ?? 0
  if (own === 0) { d.ownZero++; continue }
  if (own > 1) { d.ownMany++; continue }
  d.ownOne++
  // The §5e respell: the own file proves the name exactly once, so the declaration's derived
  // qualifiedName is a spelling the store can match EXACTLY. It is a fix only if that spelling is
  // itself project-unique — otherwise the same collision reappears under a new key.
  const cand = (fileSymbols.get(e.file) ?? []).find((s) => s.name === e.tgt)
  if (!cand) { d.unproven++; continue }
  const q = cand.qname.length > 0 && cand.qname !== cand.name ? cand.qname : null
  if (q === null) { d.noBetterSpelling++; continue }
  const qc = p.decl.get(q) ?? 0
  if (qc === 1) d.qualifiedUnique++
  else d.qualifiedAlsoMultiple++
  // §5e's monotonicity clause, COMPUTED: every file that declares the qualified spelling must also
  // declare the bare name. If one does not, the respell is ADMITTING a candidate rather than
  // narrowing to one — the bet §5e refuses.
  for (const [qf] of p.byFile.get(q) ?? []) {
    if ((p.byFile.get(e.tgt)?.get(qf) ?? 0) === 0) d.monoViolations++
  }
}
console.log("TABLE 4 — OWN-FILE DETERMINACY of the AMBIGUOUS half, and the §5e respell ceiling:")
console.log(`  ${w("type", 11)} ${w("amb", 8)} ${w("ownFile=1", 10)} ${w("ownFile>1", 10)} ${w("ownFile=0", 10)} ${w("respell-unique", 15)} ${w("still>1", 9)} ${w("no better", 10)} ${w("unproven", 9)} ${w("monoViol", 9)}`)
for (const ty of ALL_TYPES) {
  const d = det.get(ty)!
  const r = t(ty)
  if (r.ambiguousByDecl === 0) continue
  console.log(`  ${w(ty, 11)} ${w(num(r.ambiguousByDecl), 8)} ${w(num(d.ownOne), 10)} ${w(num(d.ownMany), 10)} ${w(num(d.ownZero), 10)} ${w(num(d.qualifiedUnique), 15)} ${w(num(d.qualifiedAlsoMultiple), 9)} ${w(num(d.noBetterSpelling), 10)} ${w(num(d.unproven), 9)} ${w(num(d.monoViolations), 9)}`)
}
console.log(`  ownFile=1      => production's own-file preference binds it determinately; the model's "ambiguous" is about the MODEL.`)
console.log(`  respell-unique => the §5e respell would make it exactly-one for the store as well (the fix's whole ceiling).`)
console.log(`  monoViol       => respelled declarations NOT reachable through the bare name; >0 means the respell ADMITS candidates.`)
console.log("")
// -------------------------------------------------------------------------------------- TABLE 5
/**
 * THE SOURCE SIDE, which no residual column measures.
 *
 * `incoming-gate.ts` classifies TARGETS. A relationship whose SOURCE names nothing is a fact about
 * nothing — the edge exists, the dependency exists, and the row names no declarer — and the store
 * has a contract for exactly one shape of it (`parallel-indexer.ts:4391`):
 *
 *     if (!sourceSymbol && rel.metadata?.fileLevel === true) { … sourceExternal = relativePath }
 *
 * so a module-level edge whose source is a FILE spelling is made joinable ONLY by that flag. The two
 * columns that matter are therefore `src-unres` (the source answers to no declaration) and, inside it,
 * `no-fileLevel` — the edges for which the store names NO importer at all. The second is the defect;
 * the first is its population.
 *
 * THE FLAG IS METADATA-ONLY AND THIS COLUMN IS INVARIANT UNDER IT, which is what makes a single run a
 * before/after: `classifyEdge` reads claims through `externalClaimOf`, and `fileLevel` is not one of
 * its keys, so adding it cannot move any resolution count. The reproduction check against the gate's
 * TABLE 1 in the same run is the independent confirmation of that invariance on the target side.
 */
type SrcRow = { edges: number; fileLevel: number; resolved: number; amb: number; unres: number; unresNoFlag: number }
const srcRows = new Map<Type, SrcRow>()
for (const ty of ALL_TYPES) srcRows.set(ty, { edges: 0, fileLevel: 0, resolved: 0, amb: 0, unres: 0, unresNoFlag: 0 })
for (const e of pending) {
  const srow = srcRows.get(e.label)!
  srow.edges++
  if (e.srcFileLevel) srow.fileLevel++
  if (e.src.length === 0) { srow.unres++; if (!e.srcFileLevel) srow.unresNoFlag++; continue }
  const p = proj(e.repo)
  const facts = { packages: new Set<string>(), files: projectFileList.get(e.repo) ?? new Set<string>(), sdkLib: false }
  // a SOURCE carries no claim: it is a symbol name, and the question is only whether one answers it
  const c = classifyEdge(p.decl, p.kinds, e.src, null, facts, false)
  if (c.outcome === "resolved") srow.resolved++
  else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") srow.amb++
  else { srow.unres++; if (!e.srcFileLevel) srow.unresNoFlag++ }
}
console.log("TABLE 5 — THE SOURCE SIDE (the direction no residual column measures):")
console.log(`  ${w("type", 11)} ${w("edges", 8)} ${w("fileLevel", 10)} ${w("src-resolved", 13)} ${w("src-amb", 8)} ${w("src-unres", 9)} ${w("of those: no fileLevel", 23)}`)
for (const ty of ALL_TYPES) {
  const s = srcRows.get(ty)!
  if (s.edges === 0) continue
  console.log(`  ${w(ty, 11)} ${w(num(s.edges), 8)} ${w(num(s.fileLevel), 10)} ${w(num(s.resolved), 13)} ${w(num(s.amb), 8)} ${w(num(s.unres), 9)} ${w(num(s.unresNoFlag), 23)}`)
}
console.log(`  no-fileLevel => the source answers no declaration AND the store's M60/#910 rewrite is not`)
console.log(`  armed, so the stored row names no importer (parallel-indexer.ts:4391). THIS is the defect.`)
console.log("")
console.log(`CHECKED: ${COMPARE === undefined ? "UNCHECKED (no --compare)" : "reproduces the gate's TABLE 1 on all 14 columns"}`)
