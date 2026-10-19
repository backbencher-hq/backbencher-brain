/**
 * rust-wall-classify — D7 wall disposition instrument for the rust lane.
 *
 * Reads the whole-population arm dump (amb/unresolved rows, one per line) and the analyzer's own
 * per-file rows on the same files, JOINS them by (type,target,line), and buckets each wall row by the
 * marker signature the analyzer published. That turns "207,182 ambiguous+unresolved" into NAMED
 * classes with counts — the input the D7 ledger needs. Rows that do not join are counted separately
 * (never dropped silently).
 *
 * LIGHT: re-parses the population through one in-process parser (no engine spawn, no DB, no resolution).
 *
 * CLI: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/rust-wall-classify.ts --dump=.tmp-rust/rust-arm-dump.txt [--json=path] [--text]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => { const j = process.argv.find((a) => a.startsWith(`${f}=`)); return j ? j.slice(f.length + 1) : null }
const DUMP = argOf("--dump") ?? path.join(ROOT, ".tmp-rust", "rust-arm-dump.txt")
const JSON_OUT = argOf("--json")
const TEXT = process.argv.includes("--text")
const MAX_BYTES = 1024 * 1024

// ── wall rows from the arm dump ─────────────────────────────────────────────────────────────────────
type Wall = { type: string; cls: string; target: string; abs: string; line: number }
const walls: Wall[] = []
const claimedRows: Array<{ type: string; cls: string; target: string }> = []
for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
  const p = line.split("\t")
  if (p[0] !== "DUMP") continue
  const m = (p[4] ?? "").match(/^(.*):(\d+)$/)
  if (!m) continue
  // ONLY the three wall classes are walls; `externalVerified` rows are the CLAIM class (extOK), not a
  // wall — counting them as walls would inflate the denominator and add zero-count buckets.
  const cls = p[2]
  if (cls !== "unresolved" && cls !== "ambDeclOnly" && cls !== "ambBoth") { claimedRows.push({ type: p[1], cls, target: p[3] }); continue }
  walls.push({ type: p[1], cls, target: p[3], abs: m[1], line: Number(m[2]) })
}

// ── files that carry walls (only these need parsing for the join) ──────────────────────────────────
const wanted = [...new Set(walls.map((w) => w.abs))].sort()
const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const rustMod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
const parser: any = await getParser("rust")

const key = (t: string, target: string, line: number) => `${t}\u0000${target}\u0000${line}`
const markerSig = (row: any): string => Object.keys(row.metadata ?? {}).sort().join("+")
const analyzerRows = new Map<string, { sig: string; type: string }[]>()
const fileSymbols = new Map<string, Set<string>>()
const globalSymbols = new Set<string>()
let parsed = 0
for (const abs of wanted) {
  let src = ""
  try { src = fs.readFileSync(abs, "utf8") } catch { continue }
  if (detectLanguageFromPath(abs) !== "rust") continue
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  parsed++
  try {
    const rel = path.relative(CR, abs)
    const r: any = await new rustMod.RealRustAnalyzer().analyze(tree.rootNode, src, rel)
    const syms = new Set<string>()
    for (const sym of r.symbols ?? []) {
      if (!sym?.name) continue
      syms.add(String(sym.name))
      globalSymbols.add(String(sym.name))
    }
    fileSymbols.set(abs, syms)
    for (const row of r.relationships ?? []) {
      const k = key(String(row.type), String(row.target), Number(row.line_number))
      const arr = analyzerRows.get(k) ?? []
      arr.push({ sig: markerSig(row), type: String(row.type) })
      analyzerRows.set(k, arr)
    }
  } finally { tree.delete?.() }
}

// ── classify ────────────────────────────────────────────────────────────────────────────────────────
const CLASS: Record<string, string> = {
  // calls
  "macroInvocation": "calls.macro_invocation",
  "isAwait+qualified+rustSpecific": "calls.await_receiver_qualified",
  "qualified": "calls.receiver_qualified",
  // uses
  "accessedFrom+relationshipType": "uses.field_read",
  "macroArgument+nodeType+reasonCode+relationshipType": "uses.inside_macro_argument",
  "nodeType+relationshipType": "uses.identifier_read",
  // references
  "rustSpecific+whereBound": "references.where_bound",
  "relationshipType": "references.declared_type",
  // heritage
  "rustSpecific+traitBound": "extends.trait_bound",
  // other
  "implementsType+method+reasonCode+relationshipType+rustSpecific+trait": "overrides.trait_method_impl",
  "isConstructor+relationshipType": "instantiates.constructor_site",
  "isConstructor": "instantiates.constructor_site",
  "fileLevel+isImport+items+moduleKind+modulePath+relationshipType+rustSpecific": "imports.module_path",
  "isImport+items+moduleKind+modulePath+relationshipType+rustSpecific": "imports.module_path_nested",
  "fileLevel+isImport+items+moduleKind+modulePath+reExports+relationshipType+rustSpecific": "imports.pub_use_module_path",
  "fileLevel+importProjectFile+isImport+items+moduleKind+modulePath+relationshipType+rustSpecific": "imports.file_claim_carried",
  "fileLevel+relationshipType+rustSpecific+symbolKind": "exports.file_level_pub",
  "nodeType+reasonCode": "references.unbound_or_macro_read",
}
const buckets: Record<string, { amb: number; unres: number; other: number }> = {}
const intentBuckets: Record<string, Record<string, number>> = {}
const bump = (cls: string, wallCls: string) => {
  const b = (buckets[cls] ??= { amb: 0, unres: 0, other: 0 })
  if (wallCls === "unresolved") b.unres++
  else if (wallCls.startsWith("amb")) b.amb++
  else b.other++
}
let joined = 0, unjoined = 0
const sigHistogram: Record<string, number> = {}
const samples: Record<string, Array<Record<string, unknown>>> = {}
for (const w of walls) {
  const arr = analyzerRows.get(key(w.type, w.target, w.line))
  if (!arr || arr.length === 0) { unjoined++; bump(`${w.type}.unclassified_no_analyzer_match`, w.cls); continue }
  joined++
  // multiple analyzer rows can share (type,target,line): pick the first signature; record ambiguity count
  // A (type,target,line) key can hold MORE THAN ONE analyzer row (same spelling twice). Prefer the
  // CLAIM-CARRYING row (languageNamespace / importProjectFile) — the class that names why the row is
  // still a wall — then the longest marker set; never silently take an arbitrary first row.
  const rank = (x: { sig: string }) => (x.sig.includes("languageNamespace") ? 3 : x.sig.includes("importProjectFile") ? 2 : 0) * 100 + x.sig.length
  arr.sort((a, b) => rank(b) - rank(a))
  const rawSig = arr[0].sig
  const sig = rawSig.split("+").filter((k) => k && k !== "evidenceClass").sort().join("+")
  sigHistogram[sig] = (sigHistogram[sig] ?? 0) + 1
  let cls: string
  if (sig.includes("languageNamespace") && (w.type === "imports")) cls = "imports.namespace_claim_on_ambiguous"
  else cls = CLASS[sig] ?? (sig === "" ? `${w.type}.no_marker` : `${w.type}.marker:${sig}`)
  bump(cls, w.cls)
  // INTENT cross-tab (same test the gate's binding-intent table applies, recomputed per row):
  const own = fileSymbols.get(w.abs)?.has(w.target) === true
  const anywhere = globalSymbols.has(w.target)
  const intent = own ? "sameFileUnproven" : anywhere ? "arbitraryTwin" : "nothingAnywhere"
  const cb = (intentBuckets[cls] ??= { sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 })
  cb[intent]++
  const sm = (samples[cls] ??= [])
  if (sm.length < 5) sm.push({ file: path.relative(CR, w.abs), line: w.line, target: w.target, wallClass: w.cls, intent })
}
const totalAmb = walls.filter((w) => w.cls.startsWith("amb")).length
const totalUnres = walls.filter((w) => w.cls === "unresolved").length
const claimedBuckets: Record<string, number> = {}
for (const c of claimedRows) claimedBuckets[`${c.type}.${c.cls}`] = (claimedBuckets[`${c.type}.${c.cls}`] ?? 0) + 1
const report = {
  schemaVersion: 1,
  claimed: { rows: claimedRows.length, byClass: claimedBuckets, note: "CLAIMED class: rows the arbiter verified as external claims (extOK). Not walls; reported so the D7 table can name the claimed half explicitly." },
  instrument: "script/m14/rust-wall-classify.ts",
  dump: path.relative(ROOT, DUMP),
  population: { wallRows: walls.length, amb: totalAmb, unresolved: totalUnres, filesWithWalls: wanted.length, filesParsed: parsed, joined, unjoined },
  buckets: Object.fromEntries(Object.entries(buckets).sort((a, b) => (b[1].amb + b[1].unres) - (a[1].amb + a[1].unres))),
  markerSignatures: Object.fromEntries(Object.entries(sigHistogram).sort((a, b) => b[1] - a[1]).slice(0, 30)),
  intentByClass: Object.fromEntries(Object.entries(intentBuckets).map(([k, v]) => [k, v])),
  samples,
  note: "Every wall row joins to an analyzer row by (type,target,line), so each count is the analyzer's OWN published marker set — not a text guess. Rows without a match are counted as unclassified_no_analyzer_match, never dropped.",
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1) + "\n")
if (TEXT) {
  console.log(`rust wall classify — ${walls.length} wall rows (${totalAmb} amb + ${totalUnres} unres) over ${wanted.length} files; joined ${joined}, unjoined ${unjoined}`)
  for (const [cls, b] of Object.entries(report.buckets)) console.log(`  ${String(b.amb + b.unres).padStart(8)} ${String(b.amb).padStart(8)} amb ${String(b.unres).padStart(7)} unres  ${cls}`)
  console.log(`marker signatures: ${JSON.stringify(report.markerSignatures)}`)
} else if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1) + "\n")
if (!TEXT && !JSON_OUT) console.log(JSON.stringify(report, null, 1))
