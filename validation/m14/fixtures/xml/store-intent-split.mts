// XML lane — STORE-SIDE INTENT SPLIT, for types where the LINE TEST IS NOT APPLICABLE.
//
// WHY. The gate's exact intent test reads positions: `intended` = a declaration in the edge's OWN
// FILE ON the edge's own line, and it is only sound for the types the analyzer writes on the TARGET
// SYMBOL's own line (`LINE_IS_TARGET_LINE = {contains, exports}`). For every other type the edge
// line is the READ SITE, so the gate can only ever say `sameFileUnproven`, and the twin column is
// NOT evidence about determinacy. That is clause 4's 3,793 edges.
//
// THIS INSTRUMENT answers determinacy for those types WITHOUT borrowing the line test, because a
// line test that is invalid for a type must not be applied to it — the scoping rule the code states
// and the Lead restated. What replaces it is a predicate the analyzer's own labels make sound:
//
//   class `in-document`  the declaration IS in the edge's own file (the analyzer says so). A store
//                        row for that edge bound in ANOTHER file, or bound to nothing, is a
//                        VIOLATION — determinate intent exists and the store did not honour it.
//   class `builtin`      the target names an XML/XSD built-in, held by no document. Same-file
//   class `external`     binding is NOT expected and cross-file binding is the correct shape.
//   class `unresolved`   the analyzer could not decide; reported separately, never scored.
//
// For `contains`/`exports` the line split IS reported, so one instrument carries both answers and
// the two are never conflated: each type row states which predicate applies and why.
//
// ONE RUN, LABELLED. The store is order- and run-dependent (see the lane's §5p finding: reversing
// file order changed 248 of 4,545 bindings (5.46%) on a 300-file draw with current code, and
// eager-vs-deferred differed between runs; the earlier 96-of-7,825 (1.23%) figure is WITHDRAWN —
// it was measured on a store still holding duplicated `contains` rows. Every
// number this prints is a single run against a single index of the population named in the header.
//
// USAGE
//   HOME=$PWD/.tmp-xml/home bun validation/m14/fixtures/xml/store-intent-split.mts
//   BB_SIS_REPOS=libxslt     bound to one repository
//   BB_SIS_LIMIT=300         bound the file count
//   BB_SIS_OUT=path.json     write the report
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/cli/index"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_SIS_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const LIMIT = Number(process.env.BB_SIS_LIMIT ?? "0")
const OUT = process.env.BB_SIS_OUT ?? ""
const EXT_RE = /\.(xml|xsd|dtd|xsl|xslt|svg|rng)$/

/** Types whose edge line IS the target symbol's own line — the ONLY ones a line test may judge. */
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])

type Row = { repo: string; rel: string; abs: string }
const rows: Row[] = []
for (const name of readdirSync(CR).sort()) {
  if (REPOS.length > 0 && !REPOS.includes(name)) continue
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!EXT_RE.test(rel.toLowerCase())) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    rows.push({ repo: name, rel: rel.split(path.sep).join("/"), abs })
  }
}
const drawn = LIMIT > 0 ? rows.slice(0, LIMIT) : rows
if (drawn.length === 0) { console.error("no files admitted"); process.exit(2) }

const root = mkdtempSync(path.join(tmpdir(), "bb-xml-sis-"))
for (const f of drawn) {
  const dest = path.join(root, f.repo, f.rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(f.abs, dest)
}

const { indexProjectParallel } = await import("../../../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../../../src/brain/database")
const PID = getProjectId(root)
const t0 = Date.now()
await indexProjectParallel(PID as any, root, {})
const indexMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(PID as any)

const symOf = new Map<string, { name: string; qname: string; file: string; line: number | null; kind: string }>()
/** name -> every declaration of it, so a violation can show BOTH ends and the declaration the edge
 *  should have reached. */
const byName = new Map<string, Array<{ file: string; line: number | null; qname: string; kind: string }>>()
for (const s of raw.prepare(`SELECT id, name, qualified_name, file_id, line_start, symbol_type FROM brain_symbol WHERE project_id = ?`).all(PID) as any[]) {
  const rec = { name: String(s.name ?? ""), qname: String(s.qualified_name ?? ""), file: String(s.file_id ?? ""), line: s.line_start ?? null, kind: String(s.symbol_type ?? "") }
  symOf.set(String(s.id), rec)
  const list = byName.get(rec.name); if (list) list.push(rec); else byName.set(rec.name, [rec])
}
/** `${projectId}:<relative path>` -> `<relative path>`; ids carry the project prefix. */
const relOf = (fileId: string | null | undefined): string => {
  const f = String(fileId ?? "")
  return f.startsWith(`${PID}:`) ? f.slice(String(PID).length + 1) : f
}
const relId = (id: string): string => { const s2 = String(id ?? ""); return s2.startsWith(`${PID}:`) ? s2.slice(String(PID).length + 1) : s2 }
// NO JOINS: an earlier probe joined brain_symbol twice and the join fanned out on duplicated rows,
// manufacturing 482 phantom differences. Relationships are read alone and resolved through the map.
const storeRows = raw.prepare(`
  SELECT id, relationship_type AS type, source_symbol_id AS src, target_symbol_id AS tgt,
         target_external AS target, line_number AS line, metadata
  FROM brain_relationship WHERE project_id = ?`).all(PID) as any[]
const fileCount = (raw.prepare(`SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?`).get(PID) as any)?.c ?? 0

type Violation = {
  type: string; edge: string; sourceFile: string; source: string; target: string; edgeLine: number | null
  analyzerClass: string; role: string
  boundTo: { file: string; name: string; qname: string; line: number | null } | null
  declaredInSourceFile: Array<{ file: string; line: number | null; kind: string }>
  declaredElsewhere: Array<{ file: string; line: number | null; kind: string }>
}
const violations: Violation[] = []
/** Boundary buckets: candidates the predicate cannot judge, kept with their evidence. */
const boundaryNoSource: Violation[] = []
const boundaryIdRef: Violation[] = []
function snapshot(r: any, type: string, cls: string, bound: boolean, sameFile: boolean, src: any, tgt: any, _unused: undefined): Violation {
  const targetName = String(r.target ?? "")
  const all = byName.get(targetName) ?? []
  const inSrc = src === undefined ? [] : all.filter((d) => d.file === src.file)
  return {
    type, edge: relId(String(r.id)), sourceFile: relOf(src?.file), source: src?.name ?? "", target: targetName,
    edgeLine: r.line ?? null, analyzerClass: cls, role: String((() => { try { return JSON.parse(String(r.metadata ?? "{}"))?.role ?? "" } catch { return "" } })()),
    boundTo: tgt === undefined ? null : { file: relOf(tgt.file), name: tgt.name, qname: tgt.qname, line: tgt.line },
    declaredInSourceFile: inSrc.slice(0, 6).map((d) => ({ file: relOf(d.file), line: d.line, kind: d.kind })),
    declaredElsewhere: all.filter((d) => d.file !== src?.file).slice(0, 4).map((d) => ({ file: relOf(d.file), line: d.line, kind: d.kind })),
  }
}
type Intent = { edges: number; bound: number; unbound: number; sameFile: number; otherFile: number }
const blank = (): Intent => ({ edges: 0, bound: 0, unbound: 0, sameFile: 0, otherFile: 0 })
const perType: Record<string, Intent & { predicate: string; classSplit: Record<string, Intent>; violations: number; violationExamples: string[]; lineSplit?: Record<string, number> }> = {}

for (const r of storeRows) {
  const type = String(r.type ?? "")
  const row = (perType[type] ??= { ...blank(), predicate: LINE_IS_TARGET_LINE.has(type) ? "LINE (own file + own line)" : "CLASS (in-document must bind own file)", classSplit: {}, violations: 0, violationExamples: [] })
  let cls = "(none)"
  try { const md = r.metadata ? JSON.parse(String(r.metadata)) : null; cls = String(md?.resolvable ?? "(none)") } catch { /* an unparseable metadata cell is reported as (none) */ }
  const src = symOf.get(String(r.src ?? ""))
  const tgt = symOf.get(String(r.tgt ?? ""))
  const bound = r.tgt !== null && r.tgt !== undefined
  const sameFile = bound && src !== undefined && tgt !== undefined && src.file === tgt.file
  row.edges++
  if (!bound) row.unbound++
  else { row.bound++; if (sameFile) row.sameFile++; else row.otherFile++ }
  const cs = (row.classSplit[cls] ??= blank())
  cs.edges++
  if (!bound) cs.unbound++
  else { cs.bound++; if (sameFile) cs.sameFile++; else cs.otherFile++ }
  // THE SOUND PREDICATE for a read-site type: `in-document` means the declaration is in the edge's
  // own file, so any other binding is a violation of intent the analyzer stated.
  const isCandidate = !LINE_IS_TARGET_LINE.has(type) && cls === "in-document" && (!bound || !sameFile)
  // TWO SHAPES THE CLASS PREDICATE CANNOT JUDGE, measured on this lane and binned separately rather
  // than scored as violations (each has its own evidence, see clause4-boundary.json):
  //   (a) NO SOURCE SYMBOL — the edge has no own file, so "bound in the edge's own file" has nothing
  //       to compare against. Measured shape: `libxslt/tests/general/bug-110.xml:7 &target;` declares
  //       `<!ENTITY target SYSTEM "bug-110.ent">` in its internal subset, the analyzer emits the edge
  //       with source_symbol_id NULL (id `rel:null:target:references:7`), and the resolver then binds
  //       the bare name `target` to an unrelated `with-param` symbol in tower.xsl.
  //   (b) FRAGMENT IDREF (`#style1`) — the referent is an ELEMENT identified by an ID attribute in
  //       the same document, not a declaration of that NAME, so there is no symbol for a name-based
  //       resolver to find and `unbound` is the correct store state, not a wrong binding.
  const targetIsIdRef = String(r.target ?? "").startsWith("#")
  const noSourceSymbol = src === undefined
  if (isCandidate && noSourceSymbol) {
    boundaryNoSource.push(snapshot(r, type, cls, bound, sameFile, src, tgt, undefined))
  } else if (isCandidate && targetIsIdRef) {
    boundaryIdRef.push(snapshot(r, type, cls, bound, sameFile, src, tgt, undefined))
  } else if (isCandidate) {
    row.violations++
    const targetName = String(r.target ?? "")
    violations.push(snapshot(r, type, cls, bound, sameFile, src, tgt, undefined))
    if (row.violationExamples.length < 8) row.violationExamples.push(`${relId(String(r.id))} -> ${targetName} [${bound ? (sameFile ? "sameFile" : "otherFile") : "unbound"}]`)
  }
  if (LINE_IS_TARGET_LINE.has(type)) {
    const ls = (row.lineSplit ??= { intended: 0, sameFileOffLine: 0, arbitraryTwin: 0, unbound: 0 })
    if (!bound) ls.unbound++
    else if (!sameFile) ls.arbitraryTwin++
    else if (tgt!.line !== null && r.line !== null && tgt!.line === r.line) ls.intended++
    else ls.sameFileOffLine++
  }
}

const report = {
  instrument: "xml store-side intent split — the line test where it is valid, a class predicate where it is not",
  runLabel: "ONE RUN, ONE INDEX — the store is order- and run-dependent (lane finding 2f2a5bb1f), so no figure here may be compared across runs without re-running",
  population: { corpusRoot: CR, repos: REPOS.length ? REPOS : "ALL", filesDrawn: drawn.length, filesIndexed: fileCount, indexMs, projectId: PID },
  scoping: {
    lineTestAppliesTo: [...LINE_IS_TARGET_LINE],
    lineTestIsNotApplicableTo: [...new Set(storeRows.map((r) => String(r.type)))].filter((t) => !LINE_IS_TARGET_LINE.has(t)),
    rule: "a line-based intent test is valid ONLY where the edge line IS the target symbol's line; for a read-site type this instrument applies the analyzer-class predicate instead and says so per row, so one type's exactness never implies another's",
  },
  perType,
  violations,
  boundary: { noSourceSymbol: boundaryNoSource, intraDocumentIdRef: boundaryIdRef },
}
const text = JSON.stringify(report, null, 2)
if (OUT) writeFileSync(OUT, text)
console.log(JSON.stringify({ population: report.population, scoping: report.scoping, perType: Object.fromEntries(Object.entries(perType).map(([t, v]) => [t, { edges: v.edges, bound: v.bound, unbound: v.unbound, sameFile: v.sameFile, otherFile: v.otherFile, violations: v.violations, lineSplit: v.lineSplit, classSplit: v.classSplit }])) }, null, 2))
if (OUT) console.log(`written to ${OUT}`)
if (process.env.BB_SIS_KEEP !== "1") {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.join(homedir(), ".bb", "projects", String(PID)), { recursive: true, force: true })
}
