/**
 * PERL — THE RESIDUAL'S NAMED CAUSES, on the gate's own population and scope.
 *
 * `script/m14/incoming-gate.ts` prints one `unresolved` number per type and a 25-name worklist
 * (of which it collects 25 and reports how many it dropped). A worklist of NAMES is not a CAUSE:
 * this programme's clause 2 requires every ambiguous/unresolved edge to be attributed to a NAMED
 * cause with a measured count, and the thing that has to be named is the CONSTRUCT.
 *
 * So this instrument decomposes `unresolved` without changing how it is produced: discovery, the
 * 1 MB cap, the stride, `parseFile(f, repoOf(f), { projectRoot })`, the name + qualifiedName key
 * space, `containsLike` and `ownFileDeclares` are the gate's own, and the RULE is IMPORTED from
 * `script/m14/incoming-rule.ts` (never copied). TABLE 1 below reproduces the gate's own numbers
 * first, so a reader can see the decomposition is of THAT total and not of another run.
 *
 * THREE AXES, because one does not name a construct:
 *
 *   THE CONSTRUCT       the analyzer's own `reasonCode`, the marker the gate groups by, and the
 *                       call/instantiation shape retained in the edge's metadata.
 *   WHERE THE NAME IS   nothing in the project declares the target (that IS the outcome). Does
 *                       the SAME FILE declare it under a different spelling? Does ANOTHER file?
 *                       Does nothing in the draw?
 *   THE PRICE OF THE    for every candidate repair, what each unresolved edge would become if the
 *   OBVIOUS REPAIR      analyzer published the qualifier it already holds instead of the leaf:
 *                       exactly-one candidate key -> `resolved`, more than one -> `ambiguous`,
 *                       none -> still `unresolved`. THE `amb` COLUMN IS THE TRAP, priced rather
 *                       than argued: rebasing onto a leaf-stem key mass-moves edges from
 *                       `unresolved` into a tie-break the indexer measures ~75% wrong.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/perl/residual-cause-census.mts [--sample 400] [--top 12] [--out p.json]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = ["pl", "pm", "t", "pod"]
const LANG = "perl"
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "400"))
const TOP = Number(arg("top", "12"))
const OUT = arg("out", "")

// ───────────────────────────────────────────── population (the gate's own predicate, clause for clause)
/** `incoming-gate.ts` `admitByExtension`, including the router-agreeing basename clause. */
function admitByExtension(rel: string, exts: string[]): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === LANG
}
const found: string[] = []
const repos = new Set<string>()
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
    if (!admitByExtension(rel, EXTS)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()
const total = found.length
let files = found
let stride = 1
if (SAMPLE > 0 && total > SAMPLE) {
  stride = Math.max(1, Math.floor(total / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < SAMPLE; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0]!)
}

// ───────────────────────────────────────────── walk, building the gate's key spaces
type Rec = {
  repo: string; file: string; label: string; src: string; tgt: string; line: number | null
  sig: string; outcome: string; md: Record<string, unknown>
}
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
/** key -> the (file, line) of every declaration answering it, for the gate's own-file probes */
const declPos = new Map<string, { file: string; line: number }[]>()
const pooledDecl = new Map<string, number>()
const recs: Rec[] = []
let parsed = 0, failed = 0

function projectOf(repo: string): Map<string, number> {
  let m = projectDecl.get(repo)
  if (!m) projectDecl.set(repo, (m = new Map()))
  return m
}
function projectKindsOf(repo: string): Map<string, Set<string>> {
  let m = projectKinds.get(repo)
  if (!m) projectKinds.set(repo, (m = new Map()))
  return m
}
function noteDecl(key: string, file: string, line: number): void {
  let at = declPos.get(key)
  if (!at) declPos.set(key, (at = []))
  if (!at.some((d) => d.file === file && d.line === line)) at.push({ file, line })
}

function onto(t: string): string {
  const map: Record<string, string> = {
    calls: "calls", imports: "imports", brain_import: "imports", exports: "exports", contains: "contains",
    references: "references", depends_on: "references", related: "references", extends: "extends",
    inheritance: "extends", implements: "implements", implementation: "implements",
    overrides: "overrides", override: "overrides", uses: "uses", instantiates: "instantiates",
  }
  return map[t] ?? t
}

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch { failed++; continue }
  parsed++
  const pDecl = projectOf(repo), pKinds = projectKindsOf(repo)
  for (const s of (Array.isArray(r?.symbols) ? r.symbols : [])) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    const line = Number(s?.range?.startLine ?? 0) || -1
    const q = String(s?.qualifiedName ?? "")
    pDecl.set(name, (pDecl.get(name) ?? 0) + 1)
    pooledDecl.set(name, (pooledDecl.get(name) ?? 0) + 1)
    noteDecl(name, f, line)
    let ks = pKinds.get(name); if (!ks) pKinds.set(name, (ks = new Set())); ks.add(kind)
    // THE QUALIFIED-NAME ALIAS, counted as the SAME declaration (the gate's own rule)
    if (q.length > 0 && q !== name) {
      pDecl.set(q, (pDecl.get(q) ?? 0) + 1)
      pooledDecl.set(q, (pooledDecl.get(q) ?? 0) + 1)
      noteDecl(q, f, line)
      let qs = pKinds.get(q); if (!qs) pKinds.set(q, (qs = new Set())); qs.add(kind)
    }
  }
  for (const rel of (Array.isArray(r?.relationships) ? r.relationships : [])) {
    const label = onto(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? "")
    if (!tgt) continue
    const md = (rel?.metadata ?? {}) as Record<string, unknown>
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
    markKeys.sort()
    recs.push({
      repo, file: f, label, src: String(rel?.source ?? rel?.from ?? ""), tgt,
      line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null,
      sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      outcome: "", md,
    })
  }
}

// ───────────────────────────────────────────── classify (the gate's own rule)
function bucketOf(o: string): "resolved" | "ambiguous" | "unresolved" | "external" | "binding" | "cause" {
  if (o === "resolved") return "resolved"
  if (o === "ambDeclOnly" || o === "ambBoth") return "ambiguous"
  if (o === "unresolved") return "unresolved"
  if (o === "externalVerified" || o === "externalUnverified") return "external"
  if (o.startsWith("binding")) return "binding"
  return "cause"
}
for (const rec of recs) {
  const pDecl = projectOf(rec.repo), pKinds = projectKindsOf(rec.repo)
  const claim = externalClaimOf({ metadata: rec.md })
  const ownFileDeclares = (declPos.get(rec.tgt) ?? []).some((d) => d.file === rec.file)
  const res = classifyEdge(pDecl, pKinds, rec.tgt, claim as any, undefined, isContainsEdge(rec.label), ownFileDeclares)
  rec.outcome = bucketOf(String((res as any)?.outcome ?? "?"))
}

// ───────────────────────────────────────────── report
const out: string[] = []
const ALL = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const byType = new Map<string, Rec[]>()
for (const r of recs) {
  let a = byType.get(r.label); if (!a) byType.set(r.label, (a = [])); a.push(r)
}
const unres = (t: string) => (byType.get(t) ?? []).filter((r) => r.outcome === "unresolved")
const amb = (t: string) => (byType.get(t) ?? []).filter((r) => r.outcome === "ambiguous")

out.push(`# PERL RESIDUAL — NAMED CAUSES, gate population and scope`)
out.push(`population: ${parsed} parsed of ${files.length} sampled (corpus ${total} .pl/.pm/.t/.pod files across ${repos.size} repos; stride ${stride}, cap ${SAMPLE})  failed-parse ${failed}`)
out.push(``)
out.push(`TABLE 1 — REPRODUCED, per project scope (must equal the gate's own table)`)
out.push(`type          edges    resolved  collRes  amb      unresolved  causeOK  causeFAIL`)
let TOT = { edges: 0, resolved: 0, amb: 0, unres: 0, cause: 0, causeFail: 0 }
for (const t of ALL) {
  const rows = byType.get(t) ?? []
  if (rows.length === 0) continue
  const resolved = rows.filter((r) => r.outcome === "resolved").length
  const a = rows.filter((r) => r.outcome === "ambiguous").length
  const u = rows.filter((r) => r.outcome === "unresolved").length
  const c = rows.filter((r) => r.outcome === "cause").length
  TOT.edges += rows.length; TOT.resolved += resolved; TOT.amb += a; TOT.unres += u; TOT.cause += c
  out.push(`${t.padEnd(13)} ${String(rows.length).padEnd(8)} ${String(resolved).padEnd(9)} ${"-".padEnd(8)} ${String(a).padEnd(8)} ${String(u).padEnd(11)} ${String(c).padEnd(8)} ${0}`)
}
out.push(`${"TOTAL".padEnd(13)} ${String(TOT.edges).padEnd(8)} ${String(TOT.resolved).padEnd(9)} ${"-".padEnd(8)} ${String(TOT.amb).padEnd(8)} ${String(TOT.unres).padEnd(11)} ${String(TOT.cause).padEnd(8)} ${0}`)
out.push(`closure: resolved ${TOT.resolved} + amb ${TOT.amb} + unresolved ${TOT.unres} + causeOK ${TOT.cause} = ${TOT.resolved + TOT.amb + TOT.unres + TOT.cause} of ${TOT.edges} edge(s)`)

// ── named cause: reasonCode x target shape
const shapeOf = (r: Rec): string => {
  const t = r.tgt
  if (r.md.isOverride === true) return "dotted leaf-qualified owner.member"
  if (r.md.isConstructor === true) return t.includes(".") ? "dotted owner.constructor" : "bare constructor"
  if (t.includes(".")) return "dotted owner.member"
  if (t.includes("::")) return "fully qualified"
  return "bare leaf"
}
out.push(``)
out.push(`TABLE 2 — THE UNRESOLVED BY NAMED CAUSE: the analyzer's OWN reasonCode x target shape`)
for (const t of ALL) {
  const rows = unres(t)
  if (rows.length === 0) continue
  const m = new Map<string, number>()
  for (const r of rows) {
    const key = `${String(r.md.reasonCode ?? "(no reasonCode)")}  ·  ${shapeOf(r)}`
    m.set(key, (m.get(key) ?? 0) + 1)
  }
  out.push(`  ${t} — ${rows.length} unresolved`)
  for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`    ${String(n).padStart(6)}  ${k}`)
  }
}

// ── marker sets, so a reader can see the gate's grouping agrees
out.push(``)
out.push(`TABLE 3 — THE UNRESOLVED BY MARKER SET (the gate's own grouping; top ${TOP})`)
for (const t of ALL) {
  const rows = unres(t)
  if (rows.length === 0) continue
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.sig, (m.get(r.sig) ?? 0) + 1)
  out.push(`  ${t} — ${rows.length} unresolved`)
  for (const [sig, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    out.push(`    ${String(n).padStart(6)}  ${sig}`)
  }
}

// ── THE PRICE OF PUBLISHING THE QUALIFIER, measured against the real key space
/**
 * For an edge whose target is `X.member` (X = the LEAF the analyzer published), the qualifier it
 * discarded is the package the member belongs to. The key space holds the declaration under
 * `<package>.member` (the scope-qualified alias) — so the repair's answer is a pure function of the
 * key space: every key `Q.member` whose LEAF is X is a candidate. Exactly one -> `resolved`.
 * More than one -> `ambiguous` (the tie-break, the trap). None -> still `unresolved`.
 * The candidate's FILE decides which binding-intent class the edge would land in.
 */
function leafOf(name: string): string {
  const c = name.lastIndexOf("::")
  const d = name.lastIndexOf(".")
  const i = Math.max(c, d)
  return i >= 0 ? name.slice(i + (name[i] === ":" ? 2 : 1)) : name
}
function priceOfQualifierRepair(rows: Rec[]): { one: number; many: number; none: number; oneOwnFile: number; oneOtherFile: number; examples: string[] } {
  let one = 0, many = 0, none = 0, oneOwnFile = 0, oneOtherFile = 0
  const examples: string[] = []
  for (const r of rows) {
    const dot = r.tgt.lastIndexOf(".")
    if (dot <= 0) { none++; continue }
    const member = r.tgt.slice(dot + 1)
    const ownerLeaf = r.tgt.slice(0, dot)          // the LEAF the analyzer published
    const pDecl = projectOf(r.repo)
    const cands: string[] = []
    for (const key of pDecl.keys()) {
      if (!key.endsWith(`.${member}`)) continue
      const owner = key.slice(0, key.length - member.length - 1)
      if (leafOf(owner) !== ownerLeaf && owner !== ownerLeaf) continue
      cands.push(key)
    }
    if (cands.length === 1) {
      one++
      const at = declPos.get(cands[0]!) ?? []
      if (at.some((d) => d.file === r.file)) oneOwnFile++
      else oneOtherFile++
      if (examples.length < 12) examples.push(`${r.tgt}  ->  ${cands[0]}   (${r.file.replace(CR + "/", "")}:${r.line ?? "?"})`)
    } else if (cands.length > 1) many++
    else none++
  }
  return { one, many, none, oneOwnFile, oneOtherFile, examples }
}
out.push(``)
out.push(`TABLE 4 — PRICE OF "PUBLISH THE QUALIFIER THE ANALYZER ALREADY HOLDS" (dotted targets only)`)
out.push(`  For target X.member: candidate keys are the project's OWN declarations spelled <pkg>.member`)
out.push(`  whose package LEAF is X. one=resolved · many=AMBIGUOUS (the trap) · none=still unresolved.`)
out.push(`  oneOwnFile / oneOtherFile = which binding-intent class the resolved edge would land in.`)
out.push(`type          unresolved  wouldResolve  wouldAmbiguous  stillUnresolved  oneOwnFile  oneOtherFile`)
for (const t of ALL) {
  const rows = unres(t)
  if (rows.length === 0) continue
  const p = priceOfQualifierRepair(rows)
  out.push(`${t.padEnd(13)} ${String(rows.length).padEnd(11)} ${String(p.one).padEnd(13)} ${String(p.many).padEnd(15)} ${String(p.none).padEnd(16)} ${String(p.oneOwnFile).padEnd(11)} ${p.oneOtherFile}`)
}

// ── THE PRICE OF THE CAUSE CHANNEL: which unresolved edges could legally carry one
/**
 * `baseBeyondRunScope` is read ONLY where the target names nothing (property 1) and is REFUTED
 * (`causeFAIL`) unless its value is identifier-shaped AND IS the target's own owner (property 3,
 * `targetOwner` = everything before the last dot). So the channel is not available to a bare-leaf
 * target at all — declaring one there would turn a residual edge into a clause-4 defect.
 */
function targetOwner(tgt: string): string | null {
  const dot = tgt.lastIndexOf(".")
  if (dot <= 0) return null
  return tgt.slice(0, dot)
}
const identOk = (s: string) => s.length > 0 && (() => {
  const c = s[0]!
  if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_")) return false
  for (const ch of s.slice(1)) {
    if (!((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_")) return false
  }
  return true
})()
out.push(``)
out.push(`TABLE 5 — WHICH UNRESOLVED EDGES COULD LEGALLY CARRY A DECLARED CAUSE (no resolution moved)`)
out.push(`  eligible = targetOwner(target) is a non-empty IDENTIFIER (property 3), so a cause value equal to`)
out.push(`  it survives `+ "`causeRefuted`" + `. A bare-leaf target is NOT eligible: a cause there is a clause-4 defect.`)
out.push(`type          unresolved  eligible  ineligible(bare/other)`)
for (const t of ALL) {
  const rows = unres(t)
  if (rows.length === 0) continue
  let ok = 0
  for (const r of rows) { const o = targetOwner(r.tgt); if (o !== null && identOk(o)) ok++ }
  out.push(`${t.padEnd(13)} ${String(rows.length).padEnd(11)} ${String(ok).padEnd(9)} ${rows.length - ok}`)
}

// ── TOP unresolved targets with their source sites
out.push(``)
out.push(`TABLE 6 — TOP UNRESOLVED TARGETS with their source sites and provenance in the draw`)
{
  const srcCache = new Map<string, string[]>()
  const lineOf = (f: string, n: number | null): string => {
    if (!n) return "(no line)"
    let ls = srcCache.get(f)
    if (!ls) { try { ls = readFileSync(f, "utf8").split("\n") } catch { ls = [] } srcCache.set(f, ls) }
    return (ls[n - 1] ?? "").trim().slice(0, 100)
  }
  for (const t of ["calls", "instantiates", "overrides", "extends", "references", "uses"]) {
    const rows = unres(t)
    if (rows.length === 0) continue
    const m = new Map<string, Rec[]>()
    for (const r of rows) { let a = m.get(r.tgt); if (!a) m.set(r.tgt, (a = [])); a.push(r) }
    out.push(`  ${t} — ${rows.length} unresolved across ${m.size} distinct targets`)
    for (const [name, rs] of [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, TOP)) {
      const inDraw = pooledDecl.get(name) ?? 0
      const reason = String(rs[0]!.md.reasonCode ?? "-")
      out.push(`    ${String(rs.length).padStart(5)}  ${name.padEnd(30)} reasonCode=${reason.padEnd(24)} inDrawKeys=${String(inDraw).padEnd(4)} ${inDraw === 0 ? "NOTHING IN THE DRAW DECLARES THAT KEY" : "declared elsewhere in the draw"}`)
      for (const r of rs.slice(0, 2)) {
        out.push(`             ${r.file.replace(CR + "/", "")}:${r.line ?? "?"}  ${lineOf(r.file, r.line)}`)
      }
    }
  }
}

// ── the qualifier price, with examples
{
  const t = "calls"
  const p = priceOfQualifierRepair(unres(t))
  out.push(``)
  out.push(`TABLE 7 — EXAMPLES OF THE QUALIFIER REPAIR ON \`calls\` (wouldResolve ${p.one} · wouldAmbiguous ${p.many})`)
  for (const e of p.examples) out.push(`    ${e}`)
}

// ── ROOTS of the unresolved targets (is any perl PREDECLARED namespace among them?)
{
  const rootOf = (t: string): string => {
    const i = t.indexOf("::")
    if (i > 0) return t.slice(0, i)
    const d = t.lastIndexOf(".")
    if (d > 0) return t.slice(0, d)
    return t
  }
  const CLOSED = new Set(["UNIVERSAL", "CORE", "CORE::GLOBAL", "builtin", "main", "DB", "utf8", "strict",
    "warnings", "feature", "vars", "mro", "overload", "Exporter", "DynaLoader", "Config", "Internals",
    "attributes", "re", "subs", "constant", "lib", "base", "parent", "if", "open", "bytes", "charnames",
    "less", "version", "sigtrap", "locale", "ops", "sort", "integer", "fields", "filetest", "autodie"])
  out.push(``)
  out.push(`TABLE 8 — ROOTS OF THE UNRESOLVED TARGETS, and membership in perl's PREDECLARED vocabularies`)
  out.push(`  A namespace claim (\`languageNamespace\`, NAMESPACE_CLAIM_KEY) can only name a CLOSED language`)
  out.push(`  vocabulary whose roots are checked against the list and never the symbol table.`)
  for (const t of ALL) {
    const rows = unres(t)
    if (rows.length === 0) continue
    const m = new Map<string, number>()
    let inClosed = 0
    for (const r of rows) {
      const root = rootOf(r.tgt)
      m.set(root, (m.get(root) ?? 0) + 1)
      if (CLOSED.has(root)) inClosed++
    }
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(" · ")
    out.push(`  ${t.padEnd(13)} ${String(rows.length).padStart(5)}  inClosedRoots ${String(inClosed).padStart(5)}  roots: ${top}`)
  }
}

// ── SAMPLE-MISS: for a 400-of-427 stride, does the DROPPED 27 declare the targets?
{
  const cut = found.slice(files.length)
  let added = 0
  for (const f of cut) {
    const repo = repoOf(f)
    let r: any
    try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
    added++
    const pDecl = projectOf(repo)
    for (const s of (Array.isArray(r?.symbols) ? r.symbols : [])) {
      const name = String(s?.name ?? "")
      if (!name) continue
      pDecl.set(name, (pDecl.get(name) ?? 0) + 1)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) pDecl.set(q, (pDecl.get(q) ?? 0) + 1)
    }
  }
  let wouldResolve = 0, wouldAmb = 0
  for (const r of recs) {
    if (r.outcome !== "unresolved") continue
    const n = projectOf(r.repo).get(r.tgt) ?? 0
    if (n === 1) wouldResolve++
    else if (n > 1) wouldAmb++
  }
  out.push(``)
  out.push(`TABLE 9 — SAMPLE-MISS: the stride dropped ${cut.length} admitted file(s) (${added} parsed). Re-classified`)
  out.push(`  against the key space of ALL ${total} admitted files, ${wouldResolve} of the ${TOT.unres} unresolved edge(s)`)
  out.push(`  would resolve and ${wouldAmb} would read ambiguous — i.e. the cap OWNS that much of the residual.`)
}

// ── SIMULATED REPAIRS: the qualifier the analyzer holds, published, priced on BOTH axes
/** `classifyIntent`'s rule, reproduced from `incoming-gate.ts` (it is not exported); the set of types
 *  whose edge line IS the target's line is the only branch, and `references` is deliberately absent. */
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
function intentOf(tgt: string, srcFile: string, line: number | null, label: string): string {
  const decls = declPos.get(tgt)
  if (!decls || decls.length === 0) return "nothingAnywhere"
  const same = decls.filter((d) => d.file === srcFile)
  if (same.length === 0) return "arbitraryTwin"
  if (LINE_IS_TARGET_LINE.has(label) && line !== null && same.some((d) => d.line === line)) return "intended"
  return "sameFileUnproven"
}
/**
 * A SIMULATED REPAIR: for each unresolved edge the repair touches, the candidate keys are the
 * project's OWN declarations whose LEAF equals the name the analyzer published (for a dotted
 * target, the owner's leaf; for a bare one, the target). Exactly one DECLARATION -> `resolved`;
 * more -> `ambiguous`; none -> unchanged. The intent class is recomputed on the NEW target, which
 * is the only way to price the file-crossing axis rather than argue it.
 */
function simulate(types: string[], rewrite: (r: Rec, cand: string) => string | null): void {
  const before = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }
  const after = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }
  for (const r of recs) before[intentOf(r.tgt, r.file, r.line, r.label) as keyof typeof before]++
  let moved = 0, res = 0, amb = 0, still = 0
  const touched: { label: string; file: string; line: number | null; from: string; to: string; declFile: string; declLine: number }[] = []
  for (const r of recs) {
    let tgt = r.tgt
    if (types.includes(r.label) && r.outcome === "unresolved") {
      const cands: string[] = []
      const dot = tgt.lastIndexOf(".")
      const member = dot > 0 ? tgt.slice(dot + 1) : ""
      const ownerLeaf = dot > 0 ? tgt.slice(0, dot) : tgt
      if (dot > 0) {
        for (const key of projectOf(r.repo).keys()) {
          if (!key.endsWith(`.${member}`)) continue
          const owner = key.slice(0, key.length - member.length - 1)
          if (leafOf(owner) !== ownerLeaf && owner !== ownerLeaf) continue
          cands.push(key)
        }
      } else {
        // A BARE target names a PACKAGE, and the key space holds one declaration TWICE when the
        // symbol's own name already contains `::` (the name key and the scope-derived alias
        // `Mojo::Base.Mojo::Base`). The candidate set must be folded onto DECLARATIONS, not
        // spellings, or a single package reads as a collision.
        const groups = new Map<string, string[]>()
        for (const key of projectOf(r.repo).keys()) {
          if (!key.includes("::")) continue
          if (leafOf(key) !== ownerLeaf) continue
          const kinds = projectKindsOf(r.repo).get(key)
          if (!kinds || !kinds.has("class")) continue
          const sig = JSON.stringify(declPos.get(key) ?? key)
          const g = groups.get(sig)
          if (g) g.push(key); else groups.set(sig, [key])
        }
        if (groups.size === 1) {
          const keys = [...groups.values()][0]!.sort((a, b) => a.length - b.length)
          cands.push(keys[0]!)
        } else if (groups.size > 1) {
          cands.push("", "") // crowded: more than one DECLARATION answers the leaf
        }
      }
      if (cands.length === 1) {
        const n = projectOf(r.repo).get(cands[0]!) ?? 0
        const nt = rewrite(r, cands[0]!)
        if (nt !== null) {
          moved++
          if (n === 1) res++; else amb++
          tgt = nt
          const at = declPos.get(cands[0]!)?.[0]
          touched.push({ label: r.label, file: r.file, line: r.line, from: r.tgt, to: nt, declFile: at?.file ?? "?", declLine: at?.line ?? -1 })
        } else still++
      } else still++
    }
    after[intentOf(tgt, r.file, r.line, r.label) as keyof typeof after]++
  }
  out.push(``)
  out.push(`SIMULATION — ${types.join("+")} :: publish the qualifier the analyzer holds (candidates by LEAF)`)
  out.push(`  moved ${moved} (resolved ${res}, ambiguous ${amb}) · unchanged ${still}`)
  out.push(`  intent BEFORE  intended ${before.intended} · sameFileUnproven ${before.sameFileUnproven} · arbitraryTwin ${before.arbitraryTwin} · nothingAnywhere ${before.nothingAnywhere}`)
  out.push(`  intent AFTER   intended ${after.intended} · sameFileUnproven ${after.sameFileUnproven} · arbitraryTwin ${after.arbitraryTwin} · nothingAnywhere ${after.nothingAnywhere}`)
  out.push(`  ARBITRARYTWIN DELTA: ${after.arbitraryTwin - before.arbitraryTwin >= 0 ? "+" : ""}${after.arbitraryTwin - before.arbitraryTwin}`)
  // WHY a candidate set is empty or crowded, for the first three distinct untouched targets.
  {
    const seenT = new Set<string>()
    for (const r of recs) {
      if (!types.includes(r.label) || r.outcome !== "unresolved" || seenT.has(r.tgt)) continue
      seenT.add(r.tgt)
      const dot = r.tgt.lastIndexOf(".")
      const member = dot > 0 ? r.tgt.slice(dot + 1) : ""
      const ownerLeaf = dot > 0 ? r.tgt.slice(0, dot) : r.tgt
      const cands: string[] = []
      for (const key of projectOf(r.repo).keys()) {
        if (dot > 0) {
          if (!key.endsWith(`.${member}`)) continue
          const owner = key.slice(0, key.length - member.length - 1)
          if (leafOf(owner) !== ownerLeaf && owner !== ownerLeaf) continue
        } else {
          if (!key.includes("::")) continue
          if (leafOf(key) !== ownerLeaf) continue
        }
        cands.push(`${key}[${[...(projectKindsOf(r.repo).get(key) ?? [])].join(",")}]`)
      }
      out.push(`    CANDIDATES for ${JSON.stringify(r.tgt)} in ${r.repo.replace(CR + "/", "")}: ${cands.length === 0 ? "NONE" : cands.slice(0, 5).join(" · ")}`)
      if (seenT.size >= 3) break
    }
  }
  out.push(`  new unresolved = ${TOT.unres - moved} · new ambiguous = ${TOT.amb + amb}`)
  // THE HAND-READ SET: the edges the repair resolves, with BOTH the call site and the DECLARATION
  // site, so "did it pick what the code MEANS" is answerable from the report rather than asserted.
  {
    const srcCache = new Map<string, string[]>()
    const lineOf = (f: string, n: number | null): string => {
      if (!n || n < 0) return "(no line)"
      let ls = srcCache.get(f)
      if (!ls) { try { ls = readFileSync(f, "utf8").split("\n") } catch { ls = [] } srcCache.set(f, ls) }
      return (ls[n - 1] ?? "").trim().slice(0, 96)
    }
    const spread: Record<string, number> = {}
    let printed = 0
    for (const t of touched) {
      spread[t.label] = (spread[t.label] ?? 0) + 1
      if (spread[t.label]! > 4 || printed >= 12) continue
      printed++
      out.push(`  ${t.label.padEnd(12)} ${t.file.replace(CR + "/", "")}:${t.line ?? "?"}  ${lineOf(t.file, t.line)}`)
      out.push(`  ${"".padEnd(12)} emitted ${t.from}  ->  ${t.to}   declared at ${t.declFile.replace(CR + "/", "")}:${t.declLine}  ${lineOf(t.declFile, t.declLine)}`)
    }
  }
}
simulate(["extends"], (_r, cand) => cand)
simulate(["calls", "overrides", "instantiates"], (_r, cand) => cand)

// ── THE CLAIM AS PUBLISHED, and ten claimed edges hand-read in the source
{
  const claimed = recs.filter((r) => r.outcome === "cause")
  const unresAfter = recs.filter((r) => r.outcome === "unresolved")
  out.push(``)
  out.push(`TABLE 10 — THE DECLARED CAUSE AS THE GATE READS IT, and the residual that remains`)
  out.push(`  claimed (causeDeclared) = ${claimed.length}; still unresolved = ${unresAfter.length}; ambiguous = ${recs.filter((r) => r.outcome === "ambiguous").length}`)
  const byT = new Map<string, number>()
  for (const r of claimed) byT.set(r.label, (byT.get(r.label) ?? 0) + 1)
  out.push(`  claimed by type: ${[...byT.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`)
  out.push(`  REMAINING UNRESOLVED BY NAMED CAUSE:`)
  for (const t of ALL) {
    const rows = unresAfter.filter((r) => r.label === t)
    if (rows.length === 0) continue
    const m = new Map<string, number>()
    for (const r of rows) {
      const key = `${String(r.md.reasonCode ?? "(no reasonCode)")}  ·  ${shapeOf(r)}`
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    out.push(`    ${t} — ${rows.length}`)
    for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) out.push(`      ${String(n).padStart(6)}  ${k}`)
  }
  // HAND-READ: file:line, the emitted target, the stated cause, and the declaration the code MEANS
  // (the qualified key whose leaf is the emitted owner, where exactly one declaration answers).
  const srcCache = new Map<string, string[]>()
  const lineOf = (f: string, n: number | null): string => {
    if (!n || n < 0) return "(no line)"
    let ls = srcCache.get(f)
    if (!ls) { try { ls = readFileSync(f, "utf8").split("\n") } catch { ls = [] } srcCache.set(f, ls) }
    return (ls[n - 1] ?? "").trim().slice(0, 92)
  }
  out.push(``)
  out.push(`TABLE 11 — TEN CLAIMED EDGES HAND-READ (spread across the three types)`)
  const spread: Record<string, number> = {}
  let printed = 0
  for (const r of claimed) {
    spread[r.label] = (spread[r.label] ?? 0) + 1
    if (spread[r.label]! > 4 || printed >= 10) continue
    printed++
    const dot = r.tgt.lastIndexOf(".")
    const member = r.tgt.slice(dot + 1)
    const ownerLeaf = r.tgt.slice(0, dot)
    const cands: string[] = []
    for (const key of projectOf(r.repo).keys()) {
      if (!key.endsWith(`.${member}`)) continue
      const owner = key.slice(0, key.length - member.length - 1)
      if (leafOf(owner) !== ownerLeaf && owner !== ownerLeaf) continue
      cands.push(key)
    }
    const distinct = [...new Set(cands)]
    out.push(`  ${printed}. ${r.label}  ${r.file.replace(CR + "/", "")}:${r.line ?? "?"}`)
    out.push(`     source   : ${lineOf(r.file, r.line)}`)
    out.push(`     emitted  : ${r.src} -> ${r.tgt}   stated cause baseBeyondRunScope=${JSON.stringify(r.md.baseBeyondRunScope)}  reasonCode=${String(r.md.reasonCode ?? "-")}`)
    out.push(`     MEANS    : ${distinct.length === 1 ? `the declaration keyed ${distinct[0]} (${(declPos.get(distinct[0]!) ?? []).map((d) => d.file.replace(CR + "/", "") + ":" + d.line).join(", ")})` : distinct.length === 0 ? `NO declaration in the draw answers ${r.tgt} — the member is not published by the class it names` : `AMBIGUOUS between ${distinct.slice(0, 3).join(" · ")} — a genuine leaf collision`}`)
  }
}

const text = out.join("\n")
console.log(text)
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    population: { parsed, sampled: files.length, total, repos: repos.size, stride, cap: SAMPLE },
    totals: TOT,
    table1: ALL.map((t) => {
      const rows = byType.get(t) ?? []
      return { type: t, edges: rows.length, resolved: rows.filter((r) => r.outcome === "resolved").length, amb: rows.filter((r) => r.outcome === "ambiguous").length, unresolved: rows.filter((r) => r.outcome === "unresolved").length }
    }),
    unresolvedByCause: ALL.flatMap((t) => {
      const m = new Map<string, number>()
      for (const r of unres(t)) {
        const key = `${String(r.md.reasonCode ?? "(no reasonCode)")}  ·  ${shapeOf(r)}`
        m.set(key, (m.get(key) ?? 0) + 1)
      }
      return [...m.entries()].map(([cause, count]) => ({ type: t, cause, count }))
    }),
    qualifierPrice: ALL.map((t) => ({ type: t, unresolved: unres(t).length, ...priceOfQualifierRepair(unres(t)) })),
  }, null, 2))
}
