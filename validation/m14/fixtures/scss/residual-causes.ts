/**
 * SCSS RESIDUAL CAUSES — the WHOLE residual, enumerated by cause with counts.
 *
 * WHY THIS EXISTS. The gate prints its residual NAMES, but the worklist is **capped at 25 per type**
 * (measured: imports 297 unresolved -> 25 names, references 1,501 ambiguous -> 25, exports 983 -> 25;
 * every type with more than 25 lists exactly 25). A capped worklist is a sample, and a sample of a
 * residual cannot be reported as its cause split. This walks the SAME admitted population, classifies
 * every edge with the gate's OWN rule module (`classifyEdge`, the same function `incoming-gate.ts`
 * calls at its line 953), and tallies the residual by (type, outcome, target SHAPE) over ALL of it.
 *
 * IT IS NOT A SECOND OPINION. The classification is the gate's, imported; the discovery rule is the
 * gate's (git-tracked, `.scss`, <= 1 MiB, sorted); the scope is the gate's (per PROJECT — the
 * repository a file belongs to — which `resolutionScope` names as production's own scope). What is
 * added is only the tally and the shape split.
 *
 * SHAPE decides ownership: MODULE-PATH (`.`/`/`/`::`) is a specifier with no referent by
 * construction; URL is a remote resource; FRAGMENT names a node; CUSTOM-PROP has a live
 * counterfactual (the css delegate publishes custom properties); BARE-IDENT is the only shape whose
 * referent would be a plain declaration.
 *
 * USAGE  npx tsx validation/m14/fixtures/scss/residual-causes.ts [out-json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

type Shape = "MODULE-PATH" | "SELECTOR" | "CUSTOM-PROP" | "URL" | "FRAGMENT" | "EMPTY" | "BARE-IDENT"
/**
 * SHAPE IS TYPE-AWARE, and the first version was not: it read a leading `.` as a relative path for
 * EVERY type, so the `contains` targets `.pma_table th.draggable span` and the `extends` targets
 * `.is-dark` were filed as MODULE-PATH — module specifiers in a type where nothing is a specifier.
 * A `.` at the start of a selector is a CLASS. Only the specifier-bearing types (`imports`,
 * `exports`) may read `.`/`/` as a path.
 */
export function shapeOf(target: string, type: string): Shape {
  const t = target.trim()
  if (t.length === 0) return "EMPTY"
  if (t.startsWith("--")) return "CUSTOM-PROP"
  if (t.startsWith("#")) return "FRAGMENT"
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return "URL"
  const specifierType = type === "imports" || type === "exports"
  if (specifierType && (t.startsWith(".") || t.includes("/") || t.includes("::"))) return "MODULE-PATH"
  if (!specifierType && (t.includes("/") || t.includes("::"))) return "MODULE-PATH"
  if (!specifierType && (t.startsWith(".") || t.startsWith("%") || t.startsWith("&") || t.includes(" "))) return "SELECTOR"
  return "BARE-IDENT"
}

/**
 * THE CLAIM KEYS — ONE LIST, USED IN BOTH PLACES. The first version of this probe filtered the
 * metadata here with `/external|stdlib|isExternal/` while classifying with a longer list, so
 * `importProjectFile` (the key scss's `imports` edges actually carry) was dropped before the
 * classifier ever saw it: `claimed` read 0 for imports and the residual read 3,405 against the
 * gate's 297. A filter and a classifier that disagree about what a claim IS will always report the
 * filter's blind spot as the lane's defect.
 */
const CLAIM_KEY_RE = /^(zigExternalRef|nimStdlibModule|isExternal|isExternalTarget|external|externalRef|isStdlib|stdlibModule|moduleNamingEdges|markAsExternal|importOutsideProject|isExternalBase|importProjectFile)$/

const files: { repo: string; rel: string; abs: string }[] = []
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".scss")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    files.push({ repo: name, rel, abs })
  }
}

const decl = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
/** name -> the FILES that declare it. S1 is "every declaration of the name is in the edge's OWN
 *  file", which is a question about ownership — a count cannot answer it. */
const declFiles = new Map<string, Map<string, Set<string>>>()
type Edge = { repo: string; file: string; type: string; tgt: string; markers: string[]; claim: unknown }
const edges: Edge[] = []
let parsed = 0, failed = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (!decl.has(f.repo)) { decl.set(f.repo, new Map()); kinds.set(f.repo, new Map()); declFiles.set(f.repo, new Map()) }
  const d = decl.get(f.repo)!, k = kinds.get(f.repo)!, df = declFiles.get(f.repo)!
  const bump = (key: string, kind: string) => {
    d.set(key, (d.get(key) ?? 0) + 1)
    let s = k.get(key); if (!s) k.set(key, (s = new Set())); s.add(kind)
    let fs = df.get(key); if (!fs) df.set(key, (fs = new Set())); fs.add(f.rel)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const kind = String(s?.kind ?? "")
    bump(name, kind)
    const q = String(s?.qualifiedName ?? ""); if (q && q !== name) bump(q, kind)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!type || !tgt) continue
    const md: any = rel?.metadata ?? {}
    const markers = Object.keys(md).filter((key) => CLAIM_KEY_RE.test(key) && md[key])
    edges.push({ repo: f.repo, file: f.rel, type, tgt, markers, claim: externalClaimOf(rel) })
  }
}

/**
 * THE CLAIM KEYS, read from the edges themselves (the SAME list the walk filters with, above) (measured on this lane: scss `imports` edges carry
 * `importProjectFile` — the FILE claim, verified against the project's own file list — and that is
 * what the gate counts as `extOK`; 3,108 of the 3,405 imports edges that resolve to no symbol carry
 * it, and 3,405 - 3,108 = **297**, the gate's own unresolved row). The first version of this probe
 * did not know the key, read `claimed: 0` for imports, and reported 3,405 residual against the
 * gate's 297 — the instrument's blind spot, not the lane's number.
 */
const EXTERNAL_MARKER = CLAIM_KEY_RE
type Row = { edges: number; resolved: number; ambiguousByDecl: number; unresolved: number; claimed: number; claimedVerified: number; byShape: Record<string, number>; examples: Record<string, string[]>; resolvableCounterfactual?: { checked: number; couldHaveResolved: number; candidates: string[] }; scoping?: Record<string, number>; scopingExamples?: Record<string, string[]> }
const perType: Record<string, Row> = {}
const mk = (): Row => ({ edges: 0, resolved: 0, ambiguousByDecl: 0, unresolved: 0, claimed: 0, claimedVerified: 0, byShape: {}, examples: {} })
for (const e of edges) {
  const row = (perType[e.type] ??= mk())
  const c = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.tgt, null) as any
  const outcome = String(c?.outcome ?? "")
  row.edges++
  const marked = e.markers.some((m) => EXTERNAL_MARKER.test(m))
  if (marked) { row.claimed++; row.claimedVerified++ }   // the gate verifies these against project facts/owner; here they are the marked population
  if (outcome === "resolved") { row.resolved++; continue }
  if (outcome.startsWith("amb")) row.ambiguousByDecl++
  else if (outcome === "unresolved") row.unresolved++
  else continue
  // THE RESIDUAL IS THE UNMARKED EDGES. The gate reports `externalUnverified 0` and
  // `externalRefuted 0` on this lane, so every marked edge is a VERIFIED claim and none of them is
  // residual — counting them here would inflate the cause split by the 6,841 claimed edges (the
  // first version of this probe did exactly that: 9,877 "residual" against the gate's 3,015).
  if (marked) continue
  const s = shapeOf(e.tgt, e.type)
  row.byShape[s] = (row.byShape[s] ?? 0) + 1
  // ── THE S1/S2/S3 SCOPING SPLIT (the lane's own vocabulary, docs/analyzers/scss.md)
  //   S1  every declaration of the name is in the edge's OWN file — a SCOPING FAILURE, this lane's,
  //       repairable, and the only slice the lane can fix
  //   S2  more than one file declares it, one kind — the published-name contract (.btn in two
  //       stylesheets is two rules that both call themselves .btn); not an analyzer defect
  //   S3  more than one file, more than one kind — the kind signal narrows and does not close
  //   SINGLE-ELSEWHERE  exactly one file declares it and it is NOT the edge's file
  {
    const files = declFiles.get(e.repo)!.get(e.tgt)
    const kindSet = kinds.get(e.repo)!.get(e.tgt) ?? new Set<string>()
    const own = files?.has(e.file) ?? false
    const bucket = !files || files.size === 0 ? "NO-DECLARATION"
      : files.size === 1 ? (own ? "S1" : "SINGLE-ELSEWHERE")
      : kindSet.size > 1 ? "S3" : "S2"
    const sc = (row.scoping ??= {})
    sc[bucket] = (sc[bucket] ?? 0) + 1
    if (bucket === "S1" || bucket === "SINGLE-ELSEWHERE") {
      const ex = (row.scopingExamples ??= {})
      ;(ex[bucket] ??= [])
      if (ex[bucket].length < 25) ex[bucket].push(`${e.type} ${e.file}: ${e.tgt}  [${[...(files ?? [])].join(", ")}]`)
    }
  }
  // THE COUNTERFACTUAL, per shape, from the SAME census the classification used — a cause is only
  // ruled if the case that would have made it resolvable is checked:
  //   MODULE-PATH: could the edge have named a published symbol by the path's BASENAME?
  //   BARE-IDENT / CUSTOM-PROP: the name itself is already asked by classifyEdge (0 declarations).
  //   URL: no admitted file can be named by a URL, by construction.
  if (s === "MODULE-PATH") {
    const leaf = e.tgt.split("/").pop() ?? ""
    const bare = leaf.replace(/^_/, "").replace(/\.(scss|sass|css)$/, "")
    const hit = decl.get(e.repo)!.has(bare) || decl.get(e.repo)!.has(leaf)
    const rf = (row.resolvableCounterfactual ??= { checked: 0, couldHaveResolved: 0, candidates: [] })
    rf.checked++
    if (hit) {
      rf.couldHaveResolved++
      if (rf.candidates.length < 40) rf.candidates.push(`${e.file}: ${e.tgt}  (basename '${bare}' IS declared in this project)`)
    }
  }
  ;(row.examples[s] ??= [])
  if (row.examples[s].length < 5) row.examples[s].push(`${e.file}: ${e.tgt}`)
}
const report = {
  instrument: "scss residual causes — the WHOLE residual by type and target shape, classified with the gate's own rule module",
  population: { admitted: files.length, parsed, failed, repos: decl.size, admission: "git-tracked, .scss, <= 1 MiB, detectLanguageFromPath === 'scss', sorted" },
  scope: "per PROJECT (the repository a file belongs to) — the gate's default scope, named in its own `resolutionScope`",
  note: "the gate's printed worklists are CAPPED at 25 names per type, so this enumeration exists to give the real counts",
  perType,
  totals: (() => {
    const t: Record<string, number> = {}
    for (const row of Object.values(perType)) for (const [s, n] of Object.entries(row.byShape)) t[s] = (t[s] ?? 0) + n
    return t
  })(),
}
const out = process.argv[2] ?? "validation/m14/fixtures/scss/residual-causes.json"
writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ population: report.population, perType: Object.fromEntries(Object.entries(perType).map(([t, r]) => [t, { edges: r.edges, resolved: r.resolved, amb: r.ambiguousByDecl, unresolved: r.unresolved, claimed: r.claimed, byShape: r.byShape }])), totals: report.totals }, null, 2))
