/**
 * PROBE-GROOVY-RESIDUAL-CAUSES — the gate's population, the gate's rule, and the residual
 * attributed to a NAMED CONSTRUCT with a measured count; then the COUNTERFACTUAL for the one fix
 * this lane can land (publish the package-qualified name the analyzer already computes).
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-gate.ts` prints `9626 unresolved of 20642 edges` plus a marker-set table.
 * A marker set is the EMITTING SITE (which metadata keys the edge carries); it cannot say what
 * the target NAMES, which is the whole question a cause list has to answer. The programme's bar
 * (`RESIDUAL-CLASSIFICATION-41-LANES.md`) is that every unresolved edge is attributed to a named
 * construct with a measured count, and that the cap is recorded.
 *
 * So this probe answers, over the gate's OWN stride population and in ONE walk:
 *
 *   1. REPRODUCE the gate's TABLE 1 columns exactly, or refuse. A probe that cannot reproduce the
 *      gate is evidence about the probe, not about the lane.
 *   2. THE CAUSE TABLE — every unresolved (and, separately, every ambiguous) edge filed under a
 *      NAMED CONSTRUCT, first-match, with classes that PARTITION the residual and an explicit
 *      closure check.
 *   3. THE COUNTERFACTUAL — the same classification re-run over a key space that ALSO indexes the
 *      `package.Type` path `buildFqn` already computes for every declaration, which the analyzer
 *      today uses only as an internal `symbolMap` key and never publishes as `qualifiedName`. That
 *      is the erlang-class defect named in the 41-lane brief, in its publishable form.
 *   4. BOTH AXES OF THE FIX — unresolved and collRes — plus the binding-intent split, so a fix
 *      that turned "no answer" into "an arbitrary cross-file answer" would be visible as a RISE in
 *      `arbitraryTwin` BEFORE it was landed.
 *
 * ## What it must NOT do
 *
 * It does not edit the analyzer, does not attach a claim, does not respell a target, and does not
 * print a rate as a result. Every class below is a LABEL ON EVIDENCE, never a marker.
 *
 * CLI:
 *   bun run validation/m14/fixtures/groovy/probe-groovy-residual-causes.mts \
 *       [--ext groovy,gradle] [--max 400] [--compare <gate-run.log>] [--top 10]
 *
 * Read-only.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import {
  classifyEdge, externalClaimOf, emptyOutcomes, tally, isContainsEdge, DOTTED_MODULE_TYPE,
} from "../../../../script/m14/incoming-rule"
import type { Outcomes } from "../../../../script/m14/incoming-rule"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const EXTS = (flag("ext") ?? "groovy,gradle").split(",").map((e) => e.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
const MAX = Number(flag("max") ?? "400")
const COMPARE = flag("compare")
const TOP = Number(flag("top") ?? "10")
/** dump the edges the COUNTERFACTUAL key space moves (v1 not-resolution -> v2 resolution), with
 *  the declaration that answers them, so step 5's hand-read is over the fix's OWN movers. */
const DUMP = Number(flag("dump-movers") ?? "0")
const movers: string[] = []
const ALL_TYPES = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const admitByExtension = (rel: string, exts: string[], lang: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
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
  } catch { continue }
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel, EXTS, "groovy")) continue
    const abs = path.join(dir, rel)
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
if (MAX > 0 && total > MAX) {
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}
const relOf = (f: string): string => path.relative(repoOf(f), f).split(path.sep).join("/")

// ------------------------------------------------------------- key space, PER PROJECT (TABLE 1)
type Space = {
  decl: Map<string, number>
  kinds: Map<string, Set<string>>
  /** key -> (file -> declaration lines) — the own-file + own-line test's whole input */
  byFile: Map<string, Map<string, number[]>>
}
const newSpace = (): Space => ({ decl: new Map(), kinds: new Map(), byFile: new Map() })
const addKey = (sp: Space, key: string, kind: string, file: string, line: number): void => {
  sp.decl.set(key, (sp.decl.get(key) ?? 0) + 1)
  let ks = sp.kinds.get(key)
  if (!ks) sp.kinds.set(key, (ks = new Set()))
  ks.add(kind)
  let bf = sp.byFile.get(key)
  if (!bf) sp.byFile.set(key, (bf = new Map()))
  let ls = bf.get(file)
  if (!ls) bf.set(file, (ls = []))
  ls.push(line)
}
const spaces = new Map<string, Space>()
/** how many DISTINCT keys v1 indexes that are not the symbol's own bare name */
let v1Aliases = 0
const spaceOf = (repo: string): Space => {
  let sp = spaces.get(repo)
  if (!sp) spaces.set(repo, (sp = newSpace()))
  return sp
}
const projectFileList = new Map<string, Set<string>>()

type Pending = {
  label: Type; tgt: string; src: string; repo: string; file: string; rel: string
  line: number; sig: string; md: Record<string, any>
}
const pending: Pending[] = []
const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
let parsedN = 0
let failed = 0
let degraded = 0
let holes = 0
let emptyFiles = 0
/** per file: the package the analyzer itself resolved (`metadata.currentPackage`), and the
 *  symbol list — the two inputs the counterfactual alias needs, both READ FROM THE PAYLOAD. */
const filePkg = new Map<string, string>()
const fileSyms = new Map<string, { name: string; kind: string; owner: string; line: number }[]>()

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsedN++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const syms = Array.isArray(r.symbols) ? r.symbols : []
  const rels = Array.isArray(r.relationships) ? r.relationships : []
  if (syms.length === 0 && rels.length === 0) {
    if (statSync(f).size > 0) holes++
    else emptyFiles++
  }
  const sp = spaceOf(repo)
  const symRows: { name: string; kind: string; owner: string; line: number }[] = []
  for (const s of syms) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const line = Number(s?.startLine ?? s?.range?.startLine ?? 0) || 0
    const qname = String(s?.qualifiedName ?? "")
    symRows.push({ name, kind, owner: String(s?.ownerName ?? ""), line })
    addKey(sp, name, kind, f, line)
    if (qname.length > 0 && qname !== name) { addKey(sp, qname, kind, f, line); v1Aliases++ }
  }
  fileSyms.set(f, symRows)
  filePkg.set(f, String(r?.metadata?.currentPackage ?? ""))
  for (const rel of rels) {
    const label = String(rel?.type ?? "") as Type
    if (!ALL_TYPES.includes(label)) continue
    const tgt = String(rel?.target ?? "")
    if (tgt.length === 0) continue
    const md = (rel as any)?.metadata ?? {}
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
    markKeys.sort()
    pending.push({
      label, tgt, repo, file: f, rel: relOf(f),
      src: String((rel as any)?.source ?? ""),
      line: Number((rel as any)?.line_number ?? 0) || 0,
      sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      md,
    })
  }
}
for (const f of files) {
  const repo = repoOf(f)
  let s = projectFileList.get(repo)
  if (!s) projectFileList.set(repo, (s = new Set()))
  s.add(relOf(f))
}

/**
 * THE COUNTERFACTUAL KEY SPACE — `name + qualifiedName` as it would be if the analyzer published
 * the `fqn` `buildFqn` already computes (`currentPackage` + owner chain + name).
 *
 * THE SIMULATION IS FAITHFUL IN THE TWO INPUTS IT USES AND APPROXIMATE IN ONE: `currentPackage`
 * is the analyzer's OWN resolved package (read off the payload, not re-derived), and the owner
 * chain is walked through the file's own symbol list. It cannot see a scope the payload does not
 * publish as an owner, so it UNDER-counts aliases rather than inventing any.
 */
const spacesV2 = new Map<string, Space>()
const spaceOfV2 = (repo: string): Space => {
  let sp = spacesV2.get(repo)
  if (!sp) spacesV2.set(repo, (sp = newSpace()))
  return sp
}
/** v2 is v1 PLUS aliases, never a replacement — so it starts as an exact copy, per PROJECT. */
const cloneSpace = (sp: Space): Space => {
  const out = newSpace()
  for (const [k, n] of sp.decl) out.decl.set(k, n)
  for (const [k, ks] of sp.kinds) out.kinds.set(k, new Set(ks))
  for (const [k, bf] of sp.byFile) {
    const m = new Map<string, number[]>()
    for (const [file, lines] of bf) m.set(file, [...lines])
    out.byFile.set(k, m)
  }
  return out
}
let aliasKeys = 0
for (const [repo, sp1] of spaces) {
  const sp2 = cloneSpace(sp1)
  spacesV2.set(repo, sp2)
  void repo
}
for (const f of files) {
  const repo = repoOf(f)
  const sp2 = spaceOfV2(repo)
  const pkg = filePkg.get(f) ?? ""
  const syms = fileSyms.get(f) ?? []
  const byName = new Map<string, { name: string; kind: string; owner: string; line: number }>()
  for (const s of syms) if (!byName.has(s.name)) byName.set(s.name, s)
  const chainOf = (s: { name: string; owner: string }): string[] => {
    const out: string[] = [s.name]
    let owner = s.owner
    const seen = new Set<string>([s.name])
    while (owner.length > 0 && !seen.has(owner) && out.length < 8) {
      seen.add(owner)
      out.unshift(owner)
      owner = byName.get(owner)?.owner ?? ""
    }
    return out
  }
  for (const s of syms) {
    const parts = [...(pkg ? [pkg] : []), ...chainOf(s)]
    const alias = parts.join(".")
    if (alias.length === 0 || alias === s.name) continue
    const existing = sp2.decl.has(alias)
    addKey(sp2, alias, s.kind, f, s.line)
    if (!existing) aliasKeys++
  }
}

// --------------------------------------------------------------- classification: production scope
type Row = Outcomes & { edges: number }
const rows = new Map<Type, Row>()
for (const ty of ALL_TYPES) rows.set(ty, { ...emptyOutcomes(), edges: 0 })

type Resid = Pending & { decls: number; amb: boolean; alts: number }
const resid: Resid[] = []
for (const e of pending) {
  const sp = spaceOf(e.repo)
  const facts = { packages: new Set<string>(), files: projectFileList.get(e.repo) ?? new Set<string>(), sdkLib: false }
  const c = classifyEdge(sp.decl, sp.kinds, e.tgt, externalClaimOf({ metadata: e.md, type: e.label, target: e.tgt }), facts, isContainsEdge(e.label))
  const row = rows.get(e.label)!
  row.edges++
  tally(row, c, e.tgt, e.label)
  const amb = c.outcome === "ambDeclOnly" || c.outcome === "ambBoth"
  if (amb || c.outcome === "unresolved") resid.push({ ...e, decls: c.decls, amb, alts: 0 })
}

// ------------------------------------------------------------- the reproduction check (b5w rule)
function parseGateTable(text: string): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const line of text.split("\n")) {
    const t = line.trim()
    const first = t.split(/\s+/)[0]
    if (first !== "TOTAL" && !(ALL_TYPES as readonly string[]).includes(first)) continue
    const parts = t.split(/\s+/)
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

// ------------------------------------------------------------------- NAMED-CAUSE CLASSIFICATION
/**
 * FIRST-MATCH, and the classes PARTITION the set by construction: every test is a fact about the
 * target string read off the payload, and the last class is the complement.
 */
const leafOf = (t: string): string => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t)
const quotedCallee = (t: string): boolean => t.startsWith("'") || t.startsWith('"')
const dotted = (t: string): boolean => t.includes(".")

type Classes = { label: string; edges: number; names: Map<string, number>; types: Map<string, number> }
const classes = new Map<string, Classes>()
const bump = (map: Map<string, Classes>, label: string, tgt: string, ty: string): void => {
  let c = map.get(label)
  if (!c) map.set(label, (c = { label, edges: 0, names: new Map(), types: new Map() }))
  c.edges++
  c.names.set(tgt, (c.names.get(tgt) ?? 0) + 1)
  c.types.set(ty, (c.types.get(ty) ?? 0) + 1)
}

const UNRES = new Map<string, Classes>()
const AMBC = new Map<string, Classes>()
for (const e of resid) {
  const sp = spaceOf(e.repo)
  const sp2 = spaceOfV2(e.repo)
  const map = e.amb ? AMBC : UNRES
  const t = e.tgt
  const inProject = (k: string) => (sp.decl.get(k) ?? 0) > 0
  const aliasWouldAnswer = !inProject(t) && (sp2.decl.get(t) ?? 0) > 0
  if (e.label === "calls") {
    const rel = String(e.md.relationshipType ?? "method_invocation")
    if (quotedCallee(t)) { bump(map, `calls: QUOTED-CALLEE-LITERAL (written form kept, no declaration can answer)`, t, e.label); continue }
    const callExpr = String(e.md.groovyCallExpression ?? "")
    if (rel === "juxt_call" && callExpr.includes(".")) {
      bump(map, `calls: JUXT-CALL continued chain — target is the bare leaf, the receiver is in metadata.groovyCallExpression`, t, e.label); continue
    }
    if (callExpr.includes(".") && !quotedCallee(t)) {
      bump(map, `calls: METHOD-INVOCATION on a receiver — target is the bare leaf, the dotted call is in metadata`, t, e.label); continue
    }
    bump(map, `calls: BARE / SCRIPT-LEVEL callee — no receiver written, name declared nowhere in the project`, t, e.label)
    continue
  }
  if (e.label === "uses") {
    if (e.md.isInterpolationRead === true) { bump(map, `uses: INTERPOLATION read (\${obj.prop} / \${x})`, t, e.label); continue }
    if (e.md.isArrayAccess === true) { bump(map, `uses: ARRAY-ACCESS read (xs[i])`, t, e.label); continue }
    if (e.md.isFieldAccess === true) { bump(map, `uses: FIELD-ACCESS read (obj.prop) — target is the bare leaf`, t, e.label); continue }
    bump(map, `uses: OTHER (${e.sig})`, t, e.label)
    continue
  }
  if (e.label === "references") {
    if (aliasWouldAnswer) { bump(map, `references: DOTTED PATH THAT IS A DECLARATION'S OWN package.Type (computed by buildFqn, published nowhere)`, t, e.label); continue }
    if (dotted(t) && inProject(leafOf(t))) { bump(map, `references: DOTTED PATH, leaf declared, path not — would need REBASING (the collRes trap)`, t, e.label); continue }
    bump(map, `references: DOTTED EXTERNAL path — no package.Type declaration and no leaf declaration in the project`, t, e.label)
    continue
  }
  if (e.label === "imports") {
    if (aliasWouldAnswer) { bump(map, `imports: DOTTED IMPORT PATH that IS a declaration's own package.Type (computed by buildFqn, published nowhere)`, t, e.label); continue }
    if (dotted(t) && inProject(leafOf(t))) { bump(map, `imports: DOTTED IMPORT PATH, leaf declared, path not — would need REBASING (the collRes trap)`, t, e.label); continue }
    if (dotted(t)) { bump(map, `imports: DOTTED EXTERNAL import path (java.*, groovy.*, org.* …)`, t, e.label); continue }
    bump(map, `imports: NON-DOTTED import target`, t, e.label)
    continue
  }
  if (e.label === "extends" || e.label === "implements") {
    if (aliasWouldAnswer) { bump(map, `${e.label}: DOTTED BASE that IS a declaration's own package.Type`, t, e.label); continue }
    if (dotted(t) && inProject(leafOf(t))) { bump(map, `${e.label}: DOTTED BASE, leaf declared, path not — REBASING required (the trap)`, t, e.label); continue }
    if (dotted(t)) { bump(map, `${e.label}: DOTTED EXTERNAL base (no package.Type and no leaf declaration in the project)`, t, e.label); continue }
    bump(map, `${e.label}: BARE base class/interface declared nowhere in the project`, t, e.label)
    continue
  }
  if (e.label === "instantiates") {
    if (aliasWouldAnswer) { bump(map, `instantiates: DOTTED TYPE that IS a declaration's own package.Type`, t, e.label); continue }
    if (dotted(t) && inProject(leafOf(t))) { bump(map, `instantiates: DOTTED TYPE, leaf declared, path not — REBASING required (the trap)`, t, e.label); continue }
    if (dotted(t)) { bump(map, `instantiates: DOTTED EXTERNAL type (new java.util.ArrayList() etc.)`, t, e.label); continue }
    bump(map, `instantiates: BARE external type (new Selenium/Spock class the project does not declare)`, t, e.label)
    continue
  }
  bump(map, `${e.label}: OTHER (${e.sig})`, t, e.label)
}

const pooled = newSpace()
for (const [, sp] of spaces) {
  for (const [k, n] of sp.decl) pooled.decl.set(k, (pooled.decl.get(k) ?? 0) + n)
  for (const [k, ks] of sp.kinds) {
    let s = pooled.kinds.get(k)
    if (!s) pooled.kinds.set(k, (s = new Set()))
    for (const x of ks) s.add(x)
  }
  for (const [k, bf] of sp.byFile) {
    let m = pooled.byFile.get(k)
    if (!m) pooled.byFile.set(k, (m = new Map()))
    for (const [file, lines] of bf) {
      const cur = m.get(file) ?? []
      m.set(file, [...cur, ...lines])
    }
  }
}
/** the SAME pooled question under the counterfactual key space — the alias fix's whole reach */
const pooled2 = newSpace()
for (const [, sp] of spacesV2) {
  for (const [k, n] of sp.decl) pooled2.decl.set(k, (pooled2.decl.get(k) ?? 0) + n)
  for (const [k, bf] of sp.byFile) {
    let m = pooled2.byFile.get(k)
    if (!m) pooled2.byFile.set(k, (m = new Map()))
    for (const [file, lines] of bf) {
      const cur = m.get(file) ?? []
      m.set(file, [...cur, ...lines])
    }
  }
}
// ------------------------------------------------------------------------- COUNTERFACTUAL (v2)
type CF = { unresolved: number; amb: number; resolved: number; collRes: number; extOK: number; extUnver: number; extFail: number; cause: number }
const emptyCF = (): CF => ({ unresolved: 0, amb: 0, resolved: 0, collRes: 0, extOK: 0, extUnver: 0, extFail: 0, cause: 0 })
const cf = new Map<Type, { before: CF; after: CF }>()
for (const ty of ALL_TYPES) cf.set(ty, { before: emptyCF(), after: emptyCF() })
const intentBefore = new Map<Type, { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }>()
const intentAfter = new Map<Type, { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }>()
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
for (const ty of ALL_TYPES) {
  intentBefore.set(ty, { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 })
  intentAfter.set(ty, { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 })
}
const fold = (c: ReturnType<typeof classifyEdge>, out: CF): void => {
  const r = c as any
  if (r.outcome === "unresolved") out.unresolved++
  else if (r.outcome === "ambDeclOnly" || r.outcome === "ambBoth") out.amb++
  else if (r.outcome === "resolved") { out.resolved++; if (r.boundAmongCollision) out.collRes++ }
  else if (r.outcome === "externalVerified") out.extOK++
  else if (r.outcome === "externalUnverified") out.extUnver++
  else if (r.outcome === "externalRefuted" || r.outcome === "bindingRefuted" || r.outcome === "causeRefuted") out.extFail++
  else if (r.outcome === "causeDeclared") out.cause++
}
for (const e of pending) {
  const facts = { packages: new Set<string>(), files: projectFileList.get(e.repo) ?? new Set<string>(), sdkLib: false }
  const rel = { metadata: e.md, type: e.label, target: e.tgt }
  const sp1 = spaceOf(e.repo)
  const sp2 = spaceOfV2(e.repo)
  const cBefore = classifyEdge(sp1.decl, sp1.kinds, e.tgt, externalClaimOf(rel), facts, isContainsEdge(e.label))
  const cAfter = classifyEdge(sp2.decl, sp2.kinds, e.tgt, externalClaimOf(rel), facts, isContainsEdge(e.label))
  fold(cBefore, cf.get(e.label)!.before)
  fold(cAfter, cf.get(e.label)!.after)
  if (DUMP > 0 && cBefore.outcome !== "resolved" && cAfter.outcome === "resolved" && movers.length < DUMP) {
    const bf = sp2.byFile.get(e.tgt)
    const decls = bf ? [...bf.entries()].map(([f, ls]) => `${relOf(f)}:${ls.join(",")}`).join(" + ") : "(none)"
    movers.push(`${e.rel}:${e.line} | ${e.label} | v1=${cBefore.outcome} v2=${cAfter.outcome} | target="${e.tgt}" | source="${e.src}" | sig=${e.sig} | answered by ${decls}`)
  }
  /**
   * THE GATE'S OWN INSTRUMENT, REPLICATED: `incoming-gate.ts:888` builds ONE `declPos` map for the
   * WHOLE RUN (`const declPos` sits OUTSIDE the per-project loop), so a target declared in ANOTHER
   * repository answers this test while production's per-project resolver would not see it. That is
   * the gate's published `BINDING INTENT` block, and the baseline has to be the gate's, not a
   * stricter variant of it — a Δ measured against a different instrument is not a Δ.
   */
  for (const [sp, into] of [[pooled, intentBefore], [pooled2, intentAfter]] as const) {
    const tallyRow = into.get(e.label)!
    const bf = sp.byFile.get(e.tgt)
    const own = bf?.get(e.file) ?? []
    if (!bf || bf.size === 0) tallyRow.noDeclaration++
    else if (own.length === 0) tallyRow.arbitraryTwin++
    else if (LINE_IS_TARGET_LINE.has(e.label) && e.line > 0 && own.includes(e.line)) tallyRow.intended++
    else tallyRow.sameFileUnproven++
  }
}

// -------------------------------------------------------------------------------------- OUTPUT
console.log(`PROBE-GROOVY-RESIDUAL-CAUSES  ext=${EXTS.map((e) => `.${e}`).join(",")} max=${MAX}`)
console.log(`  population: ${files.length} of ${total} admitted across ${repos.size} repos · parsed=${parsedN} failed=${failed} degraded=${degraded}`)
console.log(`  excluded: absent=${absent} over-cap=${overCap}${overCap > 0 ? ` (largest ${(overCapLargest / 1024 / 1024).toFixed(1)} MB)` : ""}`)
console.log(`  population holes (content, 0 symbols AND 0 relationships): ${holes} · genuinely empty: ${emptyFiles}`)
console.log(`  key space v1 (as published): name + qualifiedName aliases indexed: ${v1Aliases}`)
console.log(`  key space v2 (COUNTERFACTUAL): v1 + the package.Type path buildFqn already computes — aliases ADDED: ${aliasKeys.toLocaleString("en-US")}`)
console.log("")

console.log("REPRODUCTION CHECK — this probe's columns against the gate's own TABLE 1:")
if (COMPARE === undefined) console.log("  UNCHECKED — no --compare <gate-run.log> given.")
else if (reproduces === true) console.log(`  AGREE — all 14 columns x ${ALL_TYPES.length} types identical to ${COMPARE}`)
else {
  console.log(`  ** DISAGREE ** — ${diffs.length} cell(s) differ from ${COMPARE}:`)
  for (const d of diffs.slice(0, 20)) console.log(`     ${d}`)
  console.log("  REFUSING to draw a conclusion from a probe that does not reproduce the gate.")
  process.exit(2)
}
console.log("")

console.log("TABLE 1 — PER TYPE (production scope, as published):")
console.log(`  ${w("type", 13)} ${w("edges", 8)} ${w("resolved", 9)} ${w("collRes", 8)} ${w("amb(decl)", 10)} ${w("unresolved", 11)} ${w("extOK", 7)} ${w("extFAIL", 8)}`)
let tUnres = 0; let tAmb = 0; let tEdges = 0; let tResolved = 0; let tColl = 0
for (const ty of ALL_TYPES) {
  const r = rows.get(ty)!
  tEdges += r.edges; tUnres += r.unresolved; tAmb += r.ambiguousByDecl; tResolved += r.resolved; tColl += r.resolvedAmongCollision
  if (r.edges === 0) continue
  console.log(`  ${w(ty, 13)} ${w(num(r.edges), 8)} ${w(num(r.resolved), 9)} ${w(num(r.resolvedAmongCollision), 8)} ${w(num(r.ambiguousByDecl), 10)} ${w(num(r.unresolved), 11)} ${w(num(r.externalVerified), 7)} ${w(num(r.externalRefuted), 8)}`)
}
console.log(`  ${w("TOTAL", 13)} ${w(num(tEdges), 8)} ${w(num(tResolved), 9)} ${w(num(tColl), 8)} ${w(num(tAmb), 10)} ${w(num(tUnres), 11)}`)
console.log("")

const printClasses = (map: Map<string, Classes>, header: string, totalN: number): void => {
  console.log(header)
  const list = [...map.values()].sort((a, b) => b.edges - a.edges)
  for (const c of list) {
    const pct = totalN > 0 ? ((c.edges / totalN) * 100).toFixed(1) + "%" : "n/a"
    const types = [...c.types.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(" · ")
    console.log(`  ${w(num(c.edges), 7)} ${w(pct, 7)} ${c.label}`)
    console.log(`          types: ${types}`)
    const names = [...c.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    console.log(`          top targets: ${names.map(([n, k]) => `${JSON.stringify(n)}x${k}`).join(" · ")}${c.names.size > names.length ? ` … ${c.names.size - names.length} more distinct` : ""}`)
  }
  const sum = list.reduce((a, c) => a + c.edges, 0)
  console.log(`  CLASSES SUM = ${num(sum)}  (residual ${num(totalN)}) -> ${sum === totalN ? "CLOSES" : "** DOES NOT CLOSE **"}`)
  console.log("")
}
printClasses(UNRES, `UNRESOLVED BY NAMED CONSTRUCT — ${num(tUnres)} edges, ${UNRES.size} classes:`, tUnres)
printClasses(AMBC, `AMBIGUOUS BY NAMED CONSTRUCT — ${num(tAmb)} edges, ${AMBC.size} classes:`, tAmb)

console.log("COUNTERFACTUAL — publish `qualifiedName: buildFqn(...)` (the path the analyzer ALREADY computes):")
console.log(`  ${w("type", 13)} ${w("unres bef", 9)} ${w("unres aft", 9)} ${w("delta", 8)} ${w("amb bef", 8)} ${w("amb aft", 8)} ${w("res bef", 8)} ${w("res aft", 8)} ${w("coll bef", 9)} ${w("coll aft", 9)} ${w("extOK bef", 10)} ${w("extOK aft", 10)}`)
const tot = { ub: 0, ua: 0, ab: 0, aa: 0, rb: 0, ra: 0, cb: 0, ca: 0, eb: 0, ea: 0 }
for (const ty of ALL_TYPES) {
  const { before, after } = cf.get(ty)!
  if (before.unresolved + before.amb + before.resolved + before.extOK === 0 && after.unresolved + after.amb + after.resolved + after.extOK === 0) continue
  tot.ub += before.unresolved; tot.ua += after.unresolved
  tot.ab += before.amb; tot.aa += after.amb
  tot.rb += before.resolved; tot.ra += after.resolved
  tot.cb += before.collRes; tot.ca += after.collRes
  tot.eb += before.extOK; tot.ea += after.extOK
  console.log(`  ${w(ty, 13)} ${w(num(before.unresolved), 9)} ${w(num(after.unresolved), 9)} ${w(num(after.unresolved - before.unresolved), 8)} ${w(num(before.amb), 8)} ${w(num(after.amb), 8)} ${w(num(before.resolved), 8)} ${w(num(after.resolved), 8)} ${w(num(before.collRes), 9)} ${w(num(after.collRes), 9)} ${w(num(before.extOK), 10)} ${w(num(after.extOK), 10)}`)
}
console.log(`  ${w("TOTAL", 13)} ${w(num(tot.ub), 9)} ${w(num(tot.ua), 9)} ${w(num(tot.ua - tot.ub), 8)} ${w(num(tot.ab), 8)} ${w(num(tot.aa), 8)} ${w(num(tot.rb), 8)} ${w(num(tot.ra), 8)} ${w(num(tot.cb), 9)} ${w(num(tot.ca), 9)} ${w(num(tot.eb), 10)} ${w(num(tot.ea), 10)}`)
console.log(`  (extOK bef/aft is the CLAIM column: an import path the project DOES declare stops being claimed external.)`)
console.log("")

console.log("BINDING INTENT — the gate's own exact test, before vs after:")
console.log(`  ${w("type", 13)} ${w("intended", 8)} ${w("sameFileUnproven", 16)} ${w("arbitraryTwin", 13)} ${w("noDeclaration", 13)}   ${w("Δintended", 10)} ${w("Δsame", 8)} ${w("Δarbitrary", 10)} ${w("Δnothing", 9)}`)
const d = { i: 0, s: 0, a: 0, n: 0 }
for (const ty of ALL_TYPES) {
  const b = intentBefore.get(ty)!
  const a = intentAfter.get(ty)!
  if (b.intended + b.sameFileUnproven + b.arbitraryTwin + b.noDeclaration === 0) continue
  d.i += a.intended - b.intended; d.s += a.sameFileUnproven - b.sameFileUnproven
  d.a += a.arbitraryTwin - b.arbitraryTwin; d.n += a.noDeclaration - b.noDeclaration
  console.log(`  ${w(ty, 13)} ${w(num(a.intended), 8)} ${w(num(a.sameFileUnproven), 16)} ${w(num(a.arbitraryTwin), 13)} ${w(num(a.noDeclaration), 13)}   ${w((a.intended - b.intended >= 0 ? "+" : "") + num(a.intended - b.intended), 10)} ${w((a.sameFileUnproven - b.sameFileUnproven >= 0 ? "+" : "") + num(a.sameFileUnproven - b.sameFileUnproven), 8)} ${w((a.arbitraryTwin - b.arbitraryTwin >= 0 ? "+" : "") + num(a.arbitraryTwin - b.arbitraryTwin), 10)} ${w((a.noDeclaration - b.noDeclaration >= 0 ? "+" : "") + num(a.noDeclaration - b.noDeclaration), 9)}`)
}
console.log(`  ${w("TOTAL Δ", 13)} ${w((d.i >= 0 ? "+" : "") + num(d.i), 10)} ${w((d.s >= 0 ? "+" : "") + num(d.s), 8)} ${w((d.a >= 0 ? "+" : "") + num(d.a), 10)} ${w((d.n >= 0 ? "+" : "") + num(d.n), 9)}`)
console.log(`  (ΔarbitraryTwin is the axis the task says must NOT rise. Now measured BEFORE the edit, not after.)`)
console.log("")

// ------------------------------------------------------------------ DOABILITY EVIDENCE (step 2)
/**
 * IS THE TOP CAUSE DOABLE? The two tests the task names are (i) the grammar has the nodes and
 * (ii) the corpus HAS instances — and for a resolution fix the second one is sharper than "the
 * name appears": the DECLARATION the edge means has to exist somewhere. These blocks measure that
 * directly, on the same population, with a POOLED key space so "exists anywhere in the run" is a
 * different question from "exists in this project".
 */
const TYPE_KINDS = new Set(["class", "interface", "enum", "struct", "trait"])
const rootOf = (t: string): string => (t.includes(".") ? t.slice(0, t.indexOf(".")) : t)
const isProjType = (repo: string, name: string): boolean => {
  const ks = spaceOf(repo).kinds.get(name)
  if (!ks) return false
  for (const k of ks) if (TYPE_KINDS.has(k)) return true
  return false
}
{
  const calls = resid.filter((e) => e.label === "calls" && !e.amb)
  const withReceiver = calls.filter((e) => String(e.md.groovyCallExpression ?? "").includes("."))
  const rootIsType = withReceiver.filter((e) => isProjType(e.repo, rootOf(String(e.md.groovyCallExpression))))
  const leafDeclaredInRun = rootIsType.filter((e) => pooled.decl.has(leafOf(e.tgt)))
  const leafDeclaredInProj = rootIsType.filter((e) => spaceOf(e.repo).decl.has(leafOf(e.tgt)))
  const quoted = calls.filter((e) => quotedCallee(e.tgt))
  const bare = calls.filter((e) => !String(e.md.groovyCallExpression ?? "").includes(".") && !quotedCallee(e.tgt))
  console.log("DOABILITY EVIDENCE — the TOP class: `calls` with an unresolved callee (the 5,080):")
  console.log(`  calls unresolved .................................... ${num(calls.length)}`)
  console.log(`    a receiver IS written (metadata.groovyCallExpression dotted) ... ${num(withReceiver.length)}`)
  console.log(`      of those, the receiver's ROOT is a project-declared TYPE ... ${num(rootIsType.length)}   <- the only population a type-qualified respell could even address`)
  console.log(`        of those, the LEAF is declared in that project .......... ${num(leafDeclaredInProj.length)}   <- the population a 'Type.member' respell could reach`)
  console.log(`        of those, the LEAF is declared NOWHERE IN THE RUN ....... ${num(rootIsType.length - leafDeclaredInRun.length)}   <- the callee exists in no source file: injected/DSL/GDK`)
  console.log(`      of those, the receiver's root is a LOCAL/FIELD/EXPRESSION ... ${num(withReceiver.length - rootIsType.length)}`)
  console.log(`    NO receiver written (script-level / juxt / Gradle DSL verb) .. ${num(bare.length)}`)
  console.log(`    quoted-callee literal ........................................ ${num(quoted.length)}`)
  const distinct = new Set(calls.map((e) => e.tgt)).size
  console.log(`  distinct callee spellings among them: ${num(distinct)}`)
  console.log("")
  const refs = resid.filter((e) => e.label === "references" && !e.amb)
  const refsLeafInRun = refs.filter((e) => pooled.decl.has(leafOf(e.tgt)))
  const refsPathInRun = refs.filter((e) => pooled.decl.has(e.tgt))
  const refsPathInRun2 = refs.filter((e) => pooled2.decl.has(e.tgt))
  console.log("DOABILITY EVIDENCE — the SECOND class: `references` dotted paths (the 2,103):")
  console.log(`  references unresolved ....................................... ${num(refs.length)}`)
  console.log(`    the FULL dotted path is a key AS PUBLISHED (pooled RUN) .... ${num(refsPathInRun.length)}`)
  console.log(`    the FULL dotted path is a key UNDER THE ALIAS KEY SPACE .... ${num(refsPathInRun2.length)}   <- the alias fix's whole reach, pooled`)
  console.log(`    only the LEAF is declared anywhere in the RUN ............. ${num(refsLeafInRun.length)}   <- rebasing would move these (the trap)`)
  console.log(`    NEITHER the path nor the leaf is declared in the RUN ...... ${num(refs.length - refsLeafInRun.length)}   <- external library paths (spock.*, groovy.*, org.springframework.*)`)
  console.log("")
  const uses = resid.filter((e) => e.label === "uses" && !e.amb)
  const usesLeafInRun = uses.filter((e) => pooled.decl.has(leafOf(e.tgt)))
  console.log("DOABILITY EVIDENCE — `uses` field/array/interpolation reads (the 1,063):")
  console.log(`  uses unresolved ..................................... ${num(uses.length)}`)
  console.log(`    the read's leaf is declared somewhere in the RUN .... ${num(usesLeafInRun.length)}   (a read site, so a leaf match is sameFileUnproven at best)`)
  console.log(`    the read's leaf is declared NOWHERE in the RUN ...... ${num(uses.length - usesLeafInRun.length)}   <- field of a receiver whose type the analyzer never resolves`)
}

if (DUMP > 0) {
  console.log("")
  console.log(`MOVERS OF THE COUNTERFACTUAL — every edge the alias key space takes from NOT-RESOLVED to RESOLVED (cap ${DUMP}):`)
  for (const m of movers) console.log(`  ${m}`)
  console.log(`  ... ${movers.length} printed of the movement tabulated above. THESE are the edges step 5 hand-reads.`)
}
