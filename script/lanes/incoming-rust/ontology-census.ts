/**
 * INCOMING_RUST ontology census — LANE-OWNED measurement instrument.
 *
 * WHAT THIS IS FOR
 *
 * The ontology workstream's arbiter (`script/m14/ontology-coverage-gate.ts`) is
 * READ-ONLY and takes a language whose RULING TABLE it already knows (it ships
 * tables for `bash` and `json` and refuses every other lane: exit 2, "a gate with
 * an empty table would call every un-emitted type RULED-UNJUSTIFIED and that is a
 * verdict about the TABLE, not about the lane"). So for rust the arbiter cannot
 * be run by me at all — the table is the master's file to write. This script is
 * the MEASUREMENT the ruling has to be built on: the same EMITTED/construct-absent
 * facts, produced without touching any shared file.
 *
 * HOW IT MEASURES (and why that is the only honest way)
 *
 * Through the PRODUCTION entry — `ASTEngine.parseFile`, which does
 * detectLanguage -> getParser -> parse -> getAnalyzer -> analyze — because that is
 * the path the indexer and every bb tool take. A census that called
 * `new RealRustAnalyzer().analyze()` on a hand-parsed tree would measure a
 * configuration nobody ships.
 *
 * WHAT IT REPORTS, per relationship type
 *   edges           how many came out
 *   files           how many files produced at least one
 *   examples        the first few (file:line source->target)
 *   endpoints       resolved / ambiguous / unresolvable, per endpoint (below)
 *   confidence      the distribution, with every sub-0.7 edge named (a heuristic,
 *                   not a fact — the honesty contract §4)
 *   evidenceClass   the distribution
 *   R7 scan         placeholder-literal or empty-name endpoints
 *
 * THE RESOLUTION CENSUS — the point of this lane
 *
 * Every edge is OUTGOING: the analyzer reads ONE file, so both it and this census
 * can only ever know names that file itself declares. A target that is not a
 * symbol in the same file is therefore NOT a fabrication — it is a fact about a
 * name declared elsewhere in the crate, which a per-file analyzer cannot see. The
 * three classes:
 *
 *   resolved     the name is declared by a symbol in this same file (or by a
 *                `use`/`pub use` leaf this file binds — a name the file genuinely
 *                brings into scope)
 *   unresolvable the name is declared nowhere this file can see: another module of
 *                the same crate, another crate, or std. Genuinely unknowable from
 *                this file, and NOT a hopeful string pretending otherwise
 *   ambiguous    the same name is declared by MORE THAN ONE symbol in this file,
 *                so the edge's target does not name one thing
 *
 * An EMPTY target or a placeholder literal is a different thing again and is
 * counted as a DEFECT (`empty` / `placeholder` columns), never as unresolvable.
 *
 * NO REGEX. Not one regular expression: file selection is `endsWith`, path
 * filtering is string comparison, every counter is a Map lookup. The census would
 * be measuring the wrong thing if it scanned source text.
 *
 * Usage:  bun script/lanes/incoming-rust/ontology-census.ts [--json out.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.resolve(path.join(import.meta.dir, "..", "..", ".."))
const CORPUS_NAME = "ripgrep"
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** R7 placeholder literals: a name field carrying a literal INSTEAD of a name.
 *  Matched by exact string equality / ASCII shape, never by pattern. */
function isPlaceholderName(s: string): boolean {
  if (s === "") return true
  const lowers = ["unknown", "unnamed", "anonymous", "placeholder", "todo", "n/a", "na", "none", "null", "undefined", "<unknown>", "?", "self", "for"]
  if (lowers.includes(s.toLowerCase())) return true
  return false
}

interface Row {
  edges: number
  files: Set<string>
  examples: string[]
  srcResolved: number
  srcAmbiguous: number
  srcUnresolvable: number
  tgtResolved: number
  tgtAmbiguous: number
  tgtUnresolvable: number
  tgtEmpty: number
  tgtPlaceholder: number
  srcEmpty: number
  srcPlaceholder: number
  confBuckets: Map<string, number>
  evidenceClasses: Map<string, number>
  subPointSeven: string[]
  unresolvedTargets: Map<string, number>
  unresolvedSources: Map<string, number>
  ambiguousTargets: Map<string, number>
  byKind: Map<string, number>
  bySpelling: Map<string, number>
  /** target NAME -> how many edges of this type carry it. Joined against the
   *  project-wide name inventory after the sweep: a name NO file in the corpus
   *  declares can never be resolved to a symbol id by the store, and an edge
   *  whose target resolves to nothing is an OUTGOING fact with no far end —
   *  which is the only thing the incoming direction needs. */
  targetsByName: Map<string, number>
  sourcesByName: Map<string, number>
}

function newRow(): Row {
  return {
    edges: 0, files: new Set(), examples: [],
    srcResolved: 0, srcAmbiguous: 0, srcUnresolvable: 0,
    tgtResolved: 0, tgtAmbiguous: 0, tgtUnresolvable: 0,
    tgtEmpty: 0, tgtPlaceholder: 0, srcEmpty: 0, srcPlaceholder: 0,
    confBuckets: new Map(), evidenceClasses: new Map(), subPointSeven: [],
    unresolvedTargets: new Map(), unresolvedSources: new Map(),
    ambiguousTargets: new Map(), byKind: new Map(), bySpelling: new Map(),
    targetsByName: new Map(), sourcesByName: new Map(),
  }
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1)
}

const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, newRow())

// The project-wide name inventory. The store resolves a relationship target to
// a symbol id by NAME across the whole project (parallel-indexer.ts builds
// `resolveTargetStmt` per project/language), so whether an edge can be
// traversed from its far end is a question about this set and not about the file
// the edge was found in.
const projectNames = new Map<string, number>()
const projectQualified = new Set<string>()

// ------------------------------------------------------------------ corpus
const repoDir = path.join(CR, CORPUS_NAME)
let tracked: string[] = []
try {
  tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n").filter(Boolean)
} catch (e) {
  console.error(`cannot list ${repoDir}: ${String(e)}`)
  process.exit(2)
}
const pin = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const files = tracked.filter((r) => r.endsWith(".rs"))

// ------------------------------------------------------------------ production path
const { ASTEngine } = await import(path.join(REPO_ROOT, "src", "ast", "engine.ts"))

let parsed = 0, failed = 0, parseErrorFiles = 0, symbolsTotal = 0, relsTotal = 0
let importRows = 0, exportRows = 0
const failures: string[] = []
const fileLabel = (rel: string): string => `${CORPUS_NAME}/${rel}`

for (const rel of files) {
  const abs = path.join(repoDir, rel)
  let content: string
  try {
    const st = statSync(abs)
    if (st.size > 512 * 1024) continue
    content = readFileSync(abs, "utf8")
  } catch { continue }

  let res: any
  try {
    res = await ASTEngine.parseFile(abs, content)
  } catch (e) {
    failed++
    failures.push(`${fileLabel(rel)}: ${String(e).slice(0, 90)}`)
    continue
  }
  parsed++
  symbolsTotal += (res.symbols ?? []).length
  const rels = res.relationships ?? []
  relsTotal += rels.length
  if ((res.metadata?.errors ?? []).length) parseErrorFiles++
  importRows += (res.imports ?? []).length
  exportRows += (res.exports ?? []).length

  // Every name this file can see without leaving the file.
  const nameCounts = new Map<string, number>()
  for (const s of res.symbols ?? []) {
    if (typeof s.name !== "string" || s.name === "") continue
    nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1)
    projectNames.set(s.name, (projectNames.get(s.name) ?? 0) + 1)
    const owner = s.ownerName ?? s.scope
    if (typeof owner === "string" && owner !== "") projectQualified.add(`${owner}::${s.name}`)
  }
  const inScope = new Set<string>()
  for (const s of res.symbols ?? []) if (typeof s.name === "string") inScope.add(s.name)
  // a `use`/`pub use` leaf is a name this file genuinely binds; `*` is not a name
  for (const im of res.imports ?? []) {
    for (const it of im.items ?? []) {
      if (typeof it === "string" && it !== "" && it !== "*") inScope.add(it)
    }
  }

  const classify = (name: string): "resolved" | "ambiguous" | "unresolvable" | "empty" | "placeholder" => {
    if (typeof name !== "string" || name.trim() === "") return "empty"
    if (isPlaceholderName(name)) return "placeholder"
    const c = nameCounts.get(name) ?? 0
    if (c === 0) return inScope.has(name) ? "resolved" : "unresolvable"
    if (c > 1) return "ambiguous"
    return "resolved"
  }

  for (const r of rels) {
    const t = String(r.type ?? r.relationshipType ?? "") as Type
    const row = rows.get(t)
    if (!row) continue
    row.edges++
    row.files.add(rel)
    const src = String(r.source ?? r.from ?? r.fromSymbol ?? "")
    const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
    const line = typeof r.line_number === "number" ? r.line_number : 0
    if (row.examples.length < 4) row.examples.push(`${fileLabel(rel)}:${line} ${src} -> ${tgt}`)
    const sc = classify(src)
    const tc = classify(tgt)
    if (sc === "resolved") row.srcResolved++
    else if (sc === "ambiguous") row.srcAmbiguous++
    else if (sc === "unresolvable") { row.srcUnresolvable++; bump(row.unresolvedSources, src) }
    else if (sc === "empty") row.srcEmpty++
    else row.srcPlaceholder++
    if (tc === "resolved") row.tgtResolved++
    else if (tc === "ambiguous") { row.tgtAmbiguous++; bump(row.ambiguousTargets, tgt) }
    else if (tc === "unresolvable") { row.tgtUnresolvable++; bump(row.unresolvedTargets, tgt) }
    else if (tc === "empty") row.tgtEmpty++
    else row.tgtPlaceholder++
    const conf = typeof r.confidence === "number" ? r.confidence : 1
    bump(row.confBuckets, String(conf))
    if (conf < 0.7 && row.subPointSeven.length < 8) row.subPointSeven.push(`${fileLabel(rel)}:${line} ${src} -> ${tgt} @${conf}`)
    bump(row.evidenceClasses, String(r.metadata?.evidenceClass ?? "(absent)"))
    const kind = String(r.metadata?.relationshipType ?? "(absent)")
    bump(row.byKind, kind)
    const spelling = String(r.metadata?.constructorSpelling ?? "(absent)")
    bump(row.bySpelling, spelling)
    bump(row.targetsByName, tgt)
    bump(row.sourcesByName, src)
  }
}

// ------------------------------------------------------------------ report
/** Does some file in this corpus DECLARE this name? The upper bound on the
 *  store's ability to give this target an id. `Owner.member` (the family's
 *  qualified label, used by `overrides`) is answered against owner-aware keys
 *  first, because no symbol is NAMED `Owner.member`. */
const declaredSomewhere = (name: string): boolean => {
  if (projectNames.has(name)) return true
  const dot = name.lastIndexOf(".")
  if (dot > 0) {
    const owner = name.slice(0, dot)
    const member = name.slice(dot + 1)
    if (projectQualified.has(`${owner}::${member}`)) return true
  }
  return false
}

const topOf = (m: Map<string, number>, n = 12): string[] =>
  [...m.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([k, v]) => `${k}=${v}`)

const out: any = {
  at: new Date().toISOString(),
  corpus: { name: CORPUS_NAME, pin, rsFiles: files.length, parsed, failed, parseErrorFiles },
  symbolsTotal, relsTotal, importRows, exportRows,
  types: {} as any,
}

console.log(`ontology census — rust via ASTEngine.parseFile (production path)`)
console.log(`corpus ${CORPUS_NAME}@${pin.slice(0, 7)}  ${files.length} tracked .rs  parsed ${parsed}  failed ${failed}  files with parse errors ${parseErrorFiles}`)
console.log(`symbols ${symbolsTotal}  relationships ${relsTotal}  imports[] rows ${importRows}  exports[] rows ${exportRows}\n`)

const pad = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`${pad("type", 13)}${pad("edges", 9)}${pad("files", 7)}tgt resolved / ambiguous / unresolvable / empty / placeholder`)
console.log("-".repeat(118))
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  const verdict = r.edges > 0 ? "EMITTED" : "NEVER PRODUCED"
  console.log(
    `${pad(t, 13)}${pad(String(r.edges), 9)}${pad(String(r.files.size), 7)}` +
    `${r.tgtResolved} / ${r.tgtAmbiguous} / ${r.tgtUnresolvable} / ${r.tgtEmpty} / ${r.tgtPlaceholder}   ${verdict}`,
  )
  let tgtProjectWide = 0, srcProjectWide = 0
  const foreignTargets: string[] = []
  for (const [name, n] of r.targetsByName) {
    if (declaredSomewhere(name)) tgtProjectWide += n
    else if (foreignTargets.length < 12) foreignTargets.push(`${name}=${n}`)
  }
  for (const [name, n] of r.sourcesByName) if (declaredSomewhere(name)) srcProjectWide += n
  out.types[t] = {
    edges: r.edges, files: [...r.files], verdict,
    projectWide: { targetDeclared: tgtProjectWide, targetNotDeclared: r.edges - tgtProjectWide, sourceDeclared: srcProjectWide, topUndeclaredTargets: foreignTargets },
    examples: r.examples,
    src: { resolved: r.srcResolved, ambiguous: r.srcAmbiguous, unresolvable: r.srcUnresolvable, empty: r.srcEmpty, placeholder: r.srcPlaceholder },
    tgt: { resolved: r.tgtResolved, ambiguous: r.tgtAmbiguous, unresolvable: r.tgtUnresolvable, empty: r.tgtEmpty, placeholder: r.tgtPlaceholder },
    confidence: Object.fromEntries(r.confBuckets),
    evidenceClass: Object.fromEntries(r.evidenceClasses),
    metadataRelationshipType: Object.fromEntries(r.byKind),
    constructorSpelling: Object.fromEntries(r.bySpelling),
    subPointSeven: r.subPointSeven,
    topUnresolvedTargets: topOf(r.unresolvedTargets),
    topUnresolvedSources: topOf(r.unresolvedSources, 8),
    topAmbiguousTargets: topOf(r.ambiguousTargets),
  }
}

console.log("\nper-type detail")
for (const t of ALL_TYPES) {
  const o = out.types[t]
  if (o.edges === 0) continue
  console.log(`\n[${t}] ${o.edges} edges / ${o.files.length} files`)
  console.log(`  src  resolved ${o.src.resolved}  ambiguous ${o.src.ambiguous}  unresolvable ${o.src.unresolvable}  empty ${o.src.empty}  placeholder ${o.src.placeholder}`)
  console.log(`  conf ${JSON.stringify(o.confidence)}   evidenceClass ${JSON.stringify(o.evidenceClass)}`)
  console.log(`  metadata.relationshipType ${JSON.stringify(o.metadataRelationshipType)}   metadata.constructorSpelling ${JSON.stringify(o.constructorSpelling)}`)
  if (o.topUnresolvedTargets.length) console.log(`  top targets no symbol in this file names: ${o.topUnresolvedTargets.join(" ")}`)
  if (o.projectWide.targetDeclared !== o.tgt.resolved + o.tgt.ambiguous) {
    console.log(`  project-wide: target name declared somewhere in the corpus ${o.projectWide.targetDeclared}, ` +
      `declared nowhere ${o.projectWide.targetNotDeclared} (the store can only give an id to the first kind, so ` +
      `the second kind has no far end and contributes nothing to an INCOMING query)`)
    if (o.projectWide.topUndeclaredTargets.length) console.log(`  top names no file in the corpus declares: ${o.projectWide.topUndeclaredTargets.join(" ")}`)
  }
  if (o.topAmbiguousTargets.length) console.log(`  targets declared by >1 symbol here: ${o.topAmbiguousTargets.join(" ")}`)
  if (o.subPointSeven.length) console.log(`  confidence <0.7 (heuristic): ${o.subPointSeven.join(" | ")}`)
  for (const e of o.examples) console.log(`  eg ${e}`)
}

if (failures.length) {
  console.log("\nfailures")
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`)
}

const argv = process.argv
const jsonAt = argv.indexOf("--json")
if (jsonAt >= 0 && argv[jsonAt + 1]) {
  writeFileSync(argv[jsonAt + 1], JSON.stringify(out, null, 2))
  console.log(`\nwrote ${argv[jsonAt + 1]}`)
}