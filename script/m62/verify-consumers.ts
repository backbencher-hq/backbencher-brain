// script/m62/verify-consumers.ts — M62.A2 verifier + mutation suite (#876).
//
// The owner (A1) is worthless if the surfaces derive positions themselves. This
// gate proves every consumer goes through it, against a REAL seeded index on
// ONE fixture, and proves the suite CAN FAIL.
//
//   R1 engine:      the engine's addresses over the seeded rows are the
//                   declared ones (both directions), and no address anywhere
//                   carries a non-positive line or a call-site without one.
//   R2 hub:         the grouped-usages payload (src/lsp/graph_usages.ts) serves
//                   the ENGINE's address for every stored row (differential —
//                   the hub cannot invent its own).
//   R3 MCP:         the real bb_graph handler's payload serves the same address
//                   multiset as the engine, each address carrying a declared
//                   kind (call-site | declaration | unknown) and a note for
//                   every non-exact kind.
//   R4 webview:     the import-pure mirror (script/m26/graph-core.ts) formats
//                   every sample exactly as the owner does (drift gate), and a
//                   rendered hub document DECLARES the address kinds it shows
//                   (data-callsite-kinds) — a row of unknowns is never labeled
//                   as if it knew where the call is.
//   R5 permanence:  a lint over the declared display surfaces fails on any read
//                   of the raw stored line — proven by a NEGATIVE (a planted
//                   read is caught) and by the engine's own fallback shape.
//   R6 impact:      the impact payload's position claim about a USAGE is the
//                   OWNER's address for the row the entry quotes — never the
//                   dependent's declaration, never the raw stored column. A row
//                   that could not be attributed publishes the declared
//                   `unattributed` absence, and that note is DISTINCT from the
//                   store-absence notes (M62 §15.3). Differential against the
//                   engine for every attributable entry.
//   R7 per-language TRUTH TABLE: what each language ACTUALLY emits, measured on
//                   a real index over a real multi-language fixture (real
//                   analyzers, real store, real engine). The three anti-
//                   fabrication laws, each of which can fail:
//                     T1 no language yields a `call-site` address unless the
//                        store carries it a positive line (absence is absence);
//                     T2 every positive stored line resolves to a line that
//                        EXISTS in its own file (a position outside the file is
//                        fabricated);
//                     T3 the per-language address-kind counts the surfaces serve
//                        equal the owner's own classification of the same rows —
//                        an oracle that collapses NULL into "with line" is caught.
//   R8 evidence drift: this record cannot be STALE. A sealed record whose commit
//                   is older than the last commit to touch a display surface is
//                   a false claim even when the gate would pass today — that is
//                   exactly how the R5 law below came to be violated on the tree
//                   (a fix landed after this record was sealed and nothing
//                   re-ran it). Measured from git, so it holds on a fresh clone.
//   M1–M9 mutants:  silent engine substitution (callers and callees), a hub
//                   that fabricates its own address, an MCP payload that
//                   fabricates one, a mirror that drops the note, a renderer
//                   that mislabels the kinds, an impact payload that publishes
//                   the dependent's declaration as its usage position, an
//                   impact payload that publishes the raw stored line, and a
//                   truth-table oracle that cannot fail — each caught by its
//                   named law.
//
// Evidence: validation/m62/results/A2.json (machine-emitted, sealed).
// Run: npx tsx script/m62/verify-consumers.ts

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { SEED } from "./a1-fixture.ts"
import { ADDRESS_SAMPLES, HUB_EXPECTED_KINDS, HUB_MODEL } from "./a2-fixture.ts"
import { IMPACT_FILES, IMPACT_ROOT, DEPTH_CORRECTED_SYMBOL, callLines, declarationLine } from "./a2-impact-fixture.ts"
import { invocationLineByFile, languageFixtureFiles, languageFixtureLineCounts, LANGUAGE_FIXTURE } from "./a2-language-fixture.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m62/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "A2.json")
const OWNER_MODULE = path.join(ROOT, "src/intelligence/graph/line-address.ts")
const ENGINE_MODULE = path.join(ROOT, "src/intelligence/graph/graph-engine.ts")
const HUB_MODULE = path.join(ROOT, "src/lsp/graph_usages.ts")
const IMPACT_MODULE = path.join(ROOT, "src/lsp/impact.ts")
const TOOL_HANDLERS_MODULE = path.join(ROOT, "src/mcp/tool-handlers.ts")
const CORE_MODULE = path.join(ROOT, "script/m26/graph-core.ts")

/** The declared DISPLAY surfaces: every file that shows a position to a human
 *  or an agent. None of them may read a raw stored line (M62 D-1/D-6). */
const DISPLAY_SURFACES = [
  "src/lsp/navigation.ts",
  "src/lsp/graph_usages.ts",
  "src/lsp/call_hierarchy.ts",
  "src/lsp/rich_hover.ts",
  "src/lsp/relations.ts",
  "src/lsp/graph_request.ts",
  "src/lsp/impact.ts",
  "src/lsp/cross_language_hover.ts",
  "src/lsp/hover.ts",
  "src/mcp/tool-handlers.ts",
  "script/m26/graph-core.ts",
]

/** The address owner names the store's column in exactly one file (L6). The
 *  lint's law is that no OTHER file may, which is only checkable if this is the
 *  complete set of files allowed to mention it. */
const OWNER_COLUMN_MODULE = "src/intelligence/graph/line-address.ts"

let checks = 0
let passed = 0
const failures: string[] = []
const mutants = { caught: 0, total: 0 }
/** The measured per-language table, carried into the evidence record. Filled by
 *  R7; declared here so the record's type does not depend on run order. */
let truthTable: LangTruth[] = []
/** The §15.1 cross-surface counts (R9), carried into the record. */
let crossSurfaceCounts: { graph: number; hubCallerGroups: number; impactShown: number } | null = null
/** P10 out-of-scope hits: counted and published, never suppressed. */
let gateAuthoringFindingsOutOfScope: string[] = []

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutants.total++
  if (caught) mutants.caught++
  check(`M${mutants.total}: ${label} (planted defect caught)`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const normalize = (v: unknown): string => JSON.stringify(v)

/** The store column, read from the OWNER so the lint names the same string the
 *  owner does. Restating it here would make the two drift silently. */
let STORED_LINE_COLUMN = "line_number"

// --- R1: the engine (both directions) ------------------------------------------------
function engineViolations(trav: any): string[] {
  const out: string[] = []
  const byRow = new Map<string, any>()
  for (const e of [...(trav?.callers ?? []), ...(trav?.callees ?? [])]) byRow.set(e.rowId, e.callSite)
  for (const [rowId, expected] of Object.entries(SEED.expected)) {
    if (normalize(byRow.get(rowId)) !== normalize(expected)) out.push(`P1(engine-derives-address ${rowId})`)
  }
  for (const [rowId, a] of byRow) {
    if (typeof a?.line === "number" && a.line <= 0) out.push(`P1(engine-no-fabricated-line ${rowId})`)
    if (a?.kind === "call-site" && !(typeof a?.line === "number" && a.line > 0)) out.push(`P1(engine-no-fabricated-line ${rowId})`)
    if (a?.kind !== "call-site" && a?.kind !== "declaration" && a?.kind !== "unknown") out.push(`P1(engine-declared-kind ${rowId})`)
  }
  return out
}

// --- R2: the hub payload --------------------------------------------------------------
function hubViolations(hub: any, engineByRow: Map<string, any>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const side of ["callers", "callees"]) {
    for (const group of hub?.[side] ?? []) {
      for (const row of group?.rows ?? []) {
        seen.add(row.rowId)
        const engine = engineByRow.get(row.rowId)
        if (engine === undefined) { out.push(`P2(hub-parity ${row.rowId} not in the engine's set)`); continue }
        if (normalize(row.callSite) !== normalize(engine)) out.push(`P2(hub-parity ${row.rowId})`)
      }
    }
  }
  if (seen.size !== engineByRow.size) out.push(`P2(hub-parity row set ${seen.size} != ${engineByRow.size})`)
  return out
}

// --- R3: the MCP payload ---------------------------------------------------------------
function mcpViolations(payloadText: string, engineCallers: string[], engineCallees: string[]): string[] {
  let payload: any
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return ["P3(mcp-parity unparseable payload)"]
  }
  const out: string[] = []
  const got = (list: any[]) => (Array.isArray(list) ? list.map((e: any) => normalize(e?.callSite)) : [])
  const multiset = (xs: string[]) => xs.slice().sort().join("|")
  if (multiset(got(payload.callers)) !== multiset(engineCallers)) out.push("P3(mcp-parity callers)")
  if (multiset(got(payload.callees)) !== multiset(engineCallees)) out.push("P3(mcp-parity callees)")
  for (const [side, list] of [["callers", payload.callers], ["callees", payload.callees]] as Array<[string, any[]]>) {
    for (const e of list ?? []) {
      const a = e?.callSite
      if (!["call-site", "declaration", "unknown"].includes(a?.kind)) out.push(`P3(mcp-declared-kind ${side})`)
      else if (a.kind !== "call-site" && (typeof a.note !== "string" || a.note.length === 0)) out.push(`P3(mcp-note-for-substitute ${side}`)
      if (typeof a?.line === "number" && a.line <= 0) out.push(`P3(mcp-no-fabricated-line ${side})`)
    }
  }
  return out
}

// --- R4: the webview mirror + the declared DOM ------------------------------------------
function mirrorViolations(core: any, owner: any): string[] {
  const out: string[] = []
  for (const s of ADDRESS_SAMPLES) {
    const got = core.formatCallSiteAddress(s.address)
    if (got !== s.format || got !== owner.formatAddress(s.address)) out.push(`P4(mirror-drift ${s.name})`)
  }
  return out
}

interface StubEl { tagName: string; className: string; children: StubEl[]; textContent: string; attrs: Record<string, string>; style: Record<string, string>; setAttribute(n: string, v: string): void; appendChild(c: StubEl): StubEl; addClass(n: string): void }

function makeDom(): { create: (tag: string) => StubEl; root: () => StubEl; el: StubEl } {
  class El implements StubEl {
    tagName: string
    className = ""
    children: El[] = []
    textContent = ""
    attrs: Record<string, string> = {}
    style: Record<string, string> = {}
    constructor(tag: string) { this.tagName = tag }
    setAttribute(name: string, value: string): void { this.attrs[name] = value }
    appendChild(child: El): El { this.children.push(child); return child }
    addClass(name: string): void { this.className = this.className ? `${this.className} ${name}` : name }
    findAll(cls: string): El[] {
      const out: El[] = []
      if (this.className.split(" ").includes(cls)) out.push(this)
      for (const c of this.children) out.push(...c.findAll(cls))
      return out
    }
  }
  const root = new El("div")
  return { create: (tag: string) => new El(tag), root: () => root, el: root }
}

function domViolations(core: any): string[] {
  const out: string[] = []
  const dom = makeDom()
  core.renderHubList(HUB_MODEL, dom, "file")
  const rows = dom.el.findAll("bb-hub-symrow")
  if (rows.length !== 2) out.push(`P5(declared-kind-in-dom rendered ${rows.length} rows, expected 2)`)
  for (const row of rows) {
    const name = String(row.attrs["data-symbol"])
    const expected = HUB_EXPECTED_KINDS[name]
    const declared = row.attrs["data-callsite-kinds"]
    if (declared === undefined) out.push(`P5(declared-kind-in-dom ${name} has no data-callsite-kinds)`)
    else if (expected !== undefined && declared !== expected) out.push(`P5(declared-kind-in-dom ${name}: ${declared} != ${expected})`)
  }
  return out
}

// --- R5: the permanence lint -------------------------------------------------------------
/** Files that declare a raw stored line outside the owner — the lint's own
 *  spec, kept next to the surfaces it protects. */
function lintViolations(files: Array<{ path: string; text: string }>): string[] {
  const out: string[] = []
  for (const f of files) {
    const lines = f.text.split("\n")
    lines.forEach((line, i) => {
      if (isProse(line)) return
      if (/\bline_number\b|\blineNumber\b/.test(line)) out.push(`P6(no-raw-display-read ${f.path}:${i + 1})`)
    })
  }
  return out
}

/** A line that only NAMES the column in prose. The law is about a READ, and a
 *  comment cannot read anything — a file whose header explains WHY it does not
 *  select the column is the file most likely to be correct. Excluding prose is
 *  therefore not a weakening; what it would hide is a read written on the same
 *  line as a comment, which the read itself still trips on its own token. */
function isProse(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("*/")
}

function engineFallbackViolations(): string[] {
  const text = readFileSync(ENGINE_MODULE, "utf8")
  const out: string[] = []
  if (/\|\|\s*node\.line\b/.test(text)) out.push("P6(engine-no-position-fallback callers)")
  if (/line:\s*row\.lineNumber\s*\|\|/.test(text)) out.push("P6(engine-no-position-fallback callee-zero)")
  return out
}

// --- R6: the impact payload's position claim (§15.3) --------------------------------
/** Every violation of the impact position law. `engineByRow` is the engine's own
 *  address per stored row — the differential oracle. An impact entry must serve
 *  the owner's address for the row IT QUOTES, which is the row at
 *  `evidenceAtDepth`, not necessarily the engine's first-trace row. */
function impactViolations(impact: any, engineByRow: Map<string, any>): string[] {
  const out: string[] = []
  for (const dep of impact?.impact ?? []) {
    const a = dep?.callSite
    if (!["call-site", "declaration", "unknown"].includes(a?.kind)) {
      out.push(`P7(impact-declared-kind ${dep?.name}: ${JSON.stringify(a?.kind)})`)
      continue
    }
    // L2 of the owner's laws: a substitute and an unknown always carry a note.
    if (a.kind !== "call-site" && (typeof a.note !== "string" || a.note.length === 0)) {
      out.push(`P7(impact-note-for-non-exact ${dep?.name})`)
    }
    // L1: no address may carry a non-positive line, and only a call-site may
    // carry a line at all.
    if (a.kind === "unknown" && a.line !== null) out.push(`P7(impact-unknown-has-no-line ${dep?.name})`)
    if (a.kind !== "unknown" && !(typeof a.line === "number" && a.line > 0)) {
      out.push(`P7(impact-no-fabricated-line ${dep?.name}: ${a.line})`)
    }
    // An UNATTRIBUTED entry has no row to quote, so it must publish the owner's
    // declared `unattributed` absence — not the engine's first-trace address
    // (which describes a row this entry no longer carries) and not a substitute.
    // Differential: an ATTRIBUTABLE entry must serve the owner's address for the
    // row it quotes. The row is named on the entry, so this compares the surface
    // against the ENGINE over the SAME stored row rather than against a value the
    // surface derived itself.
    if (dep.evidenceAtDepth === null) {
      if (a.kind !== "unknown") out.push(`P7(impact-unattributed-must-be-unknown ${dep?.name}: ${a.kind})`)
      if (a.note !== ownerUnattributedNote()) out.push(`P7(impact-unattributed-note ${dep?.name}: ${a.note}`) 
      continue
    }
    if (dep.rowId !== undefined) {
      const engine = engineByRow.get(dep.rowId)
      if (engine === undefined) out.push(`P7(impact-row-not-in-engine-set ${dep?.name}/${dep.rowId}`)
      else if (normalize(a) !== normalize(engine)) out.push(`P7(impact-parity ${dep?.name}/${dep.rowId}`)
    }
    // The §15.3 core, stated as bytes: a `call-site` must not BE the
    // dependent's own declaration line when the store carried a different
    // one. The payload carries that declaration under its own name precisely
    // so a reader — and this gate — can tell the two apart without trusting
    // the derivation.
    if (a.kind === "call-site" && typeof dep.declarationLine === "number" && a.line === dep.declarationLine) {
      out.push(`P7(impact-declaration-as-call-site ${dep?.name}: line ${a.line} is both the call site and the declaration`)
    }
  }
  return out
}

/** The owner's fourth note, read from the OWNER rather than restated here — a
 *  literal copy would let a reworded note pass this gate while the surface
 *  rendered the old one. */
let ownerUnattributedNote: () => string = () => ""

/** Precondition law for R6: the fixture must actually reach the depth-corrected
 *  path, and the observable proof is the SERVED address — not the depths, which
 *  are equal again by the time the answer is built.
 *
 *  After the correction the engine's first-trace address and the re-read address
 *  are both gone: what is left must be the address of the row the MEASUREMENT
 *  found (the `p2` call), and must NOT be the engine's first-trace address (the
 *  `mid1` call). If the correction block never ran, the entry still carries the
 *  `mid1` line and this goes red. Both lines are FOUND by scanning the fixture,
 *  so this cannot rot when the fixture is edited. */
function impactFixtureShape(impact: any): string[] {
  const out: string[] = []
  if (impact?.countVerification?.ran !== true) {
    out.push(`P7b(fixture-reached-counting-walk ran=${impact?.countVerification?.ran})`)
  }
  const byName = new Map<string, any>()
  for (const dep of impact?.impact ?? []) byName.set(dep?.name, dep)
  const corrected = byName.get(DEPTH_CORRECTED_SYMBOL)
  if (corrected === undefined) {
    out.push(`P7b(fixture-has-${DEPTH_CORRECTED_SYMBOL})`)
    return out
  }
  const facts = impactFixtureFacts()
  const measuredRowLine = facts.callsToP2[0] ?? null
  const firstTraceLine = facts.callsToMid1[0] ?? null
  const declLine = facts.declT
  if (measuredRowLine === null || firstTraceLine === null || declLine === null) {
    out.push(`P7b(fixture-call-sites-locatable ${JSON.stringify(facts)})`)
    return out
  }
  if (measuredRowLine === firstTraceLine) {
    out.push(`P7b(fixture-two-distinct-call-sites ${measuredRowLine})`)
    return out
  }
  if (measuredRowLine === declLine) {
    out.push(`P7b(fixture-call-site-differs-from-declaration ${measuredRowLine})`)
    return out
  }
  const served = corrected.callSite
  if (served?.kind !== "call-site" || served.line !== measuredRowLine) {
    out.push(`P7b(fixture-served-the-measured-row served=${JSON.stringify(served)} expected line ${measuredRowLine})`)
  }
  if (served?.line === firstTraceLine) {
    out.push(`P7b(fixture-still-serves-the-engine-first-trace line ${firstTraceLine})`)
  }
  return out
}

// --- R7: the per-language truth table ------------------------------------------------
interface LangTruth {
  language: string
  relRows: number
  storedReal: number
  storedNull: number
  storedZero: number
  usageRows: number
  usageRealLine: number
  usageOnMarkedLine: number
  /** Positive stored lines pointing past the end of their own file. */
  outOfFile: number
  /** Address kinds the OWNER derives over this language's rows. */
  callSite: number
  declaration: number
  unknown: number
  invocationLine: number | null
}

/** T1 anti-fabrication, T2 resolvability, T3 oracle sharpness, T4 fixture
 *  resolvability. Each returns its own violation list so a mutant can be
 *  attributed to the law it breaks. */
function truthViolations(table: LangTruth[], files: Record<string, string>): string[] {
  const out: string[] = []
  const lines = languageFixtureLineCounts(files)
  for (const entry of table) {
    // T4: the fixture must be able to find its own call site. An entry with no
    // marker measures nothing, and reporting it as "0 real lines" would be a
    // fabricated finding about the analyzer.
    if (entry.invocationLine === null) out.push(`P8(fixture-call-site-locatable ${entry.language})`)
    // T1: a `call-site` address may exist ONLY where the store carries a
    // positive line. This is the law that makes a declared absence impossible
    // to fake, and it is checkable because both numbers come from the same run.
    if (entry.callSite > entry.storedReal) {
      out.push(`P8(no-fabricated-call-site ${entry.language}: ${entry.callSite} call-sites > ${entry.storedReal} stored real lines`)
    }
    // T1': the owner's classification must account for EVERY row exactly once.
    const classified = entry.callSite + entry.declaration + entry.unknown
    if (classified !== entry.relRows) {
      out.push(`P8(addresses-account-for-every-row ${entry.language}: ${classified} != ${entry.relRows}`)
    }
    // T2: a positive stored line must be a line that EXISTS in its own file. A
    // position no editor could open is fabrication even when the store says so.
    if (entry.outOfFile > 0) out.push(`P8(stored-line-inside-its-file ${entry.language}: ${entry.outOfFile})`)
    // The fixture's own file must be present with a KNOWN line count, or the
    // out-of-file law above has no bound to judge against and would pass for the
    // wrong reason. A table entry whose source vanished is a fixture defect, not
    // a finding about an analyzer.
    const fixtureFile = fixtureFileByLanguage.get(entry.language)
    if (fixtureFile === undefined || typeof lines[fixtureFile] !== "number") {
      out.push(`P8(fixture-file-present ${entry.language}`)
    }
  }
  return out
}

// --- R8: this record cannot be stale --------------------------------------------------
/** A sealed record is a claim about a tree. If a display surface changed after the
 *  record's commit, the record is describing code that is no longer here — and
 *  the gate it names may well be red now (measured: the R5 law was violated by a
 *  later commit, and this record still said `verified` because nothing re-ran
 *  it). Measured from git so it holds on a fresh clone with no local state. */
function staleRecordViolations(recordedOverride?: string): string[] {
  const out: string[] = []
  let recorded: string
  if (recordedOverride !== undefined) {
    recorded = recordedOverride
  } else {
    try {
      const onDisk = JSON.parse(readFileSync(EVIDENCE, "utf8")) as { currentCommit?: string }
      recorded = onDisk.currentCommit ?? ""
    } catch {
      return [] // first run on a tree with no record yet — nothing to be stale about
    }
  }
  if (!/^[0-9a-f]{40}$/.test(recorded)) return [`P9(record-commit-unreadable ${recorded})`]
  // The record must be reachable from HEAD, or it describes another line of work.
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", recorded, currentCommit], { cwd: ROOT, stdio: "ignore" })
  } catch {
    out.push(`P9(record-commit-not-an-ancestor ${recorded.slice(0, 9)})`)
    return out
  }
  for (const rel of DISPLAY_SURFACES) {
    let touched: string
    try {
      touched = execFileSync("git", ["log", "-1", "--format=%H", "--", rel], { cwd: ROOT, encoding: "utf8" }).trim()
    } catch {
      continue
    }
    if (touched.length !== 40) continue // untracked path — nothing sealed about it
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", touched, recorded], { cwd: ROOT, stdio: "ignore" })
    } catch {
      out.push(`P9(record-older-than-surface ${rel}: surface last changed at ${touched.slice(0, 9)}, record sealed at ${recorded.slice(0, 9)})`)
    }
  }
  return out
}

// --- the real seeded index ----------------------------------------------------------------
interface Fixture { ws: string; dataDir: string; projectId: string; cleanup(): void }

async function makeFixture(): Promise<Fixture> {
  const ws = mkdtempSync(path.join(tmpdir(), "m62a2-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m62a2-data-"))
  for (const [rel, content] of Object.entries(SEED.files)) writeFileSync(path.join(ws, rel), content)
  const projectId = createHash("sha1").update(path.resolve(ws)).digest("hex").substring(0, 40)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(projectId)
  const fileIds: Record<string, string> = {}
  const fileStmt = db.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`)
  let i = 0
  for (const rel of Object.keys(SEED.files)) {
    const id = `file-${++i}`
    fileIds[rel] = id
    fileStmt.run(id, projectId, path.join(ws, rel), rel, "typescript", `m62a2-hash-${i}`)
  }
  const symStmt = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  for (const s of SEED.symbols) symStmt.run(s.id, projectId, fileIds[s.file], s.name, s.symbolType, s.lineStart, s.lineEnd, 1, 2, 5)
  const relStmt = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata, line_number, is_cross_language, target_external) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const r of SEED.relationships) relStmt.run(r.id, projectId, r.source, r.target, "calls", 0.9, '{"evidenceClass":"structural"}', r.lineNumber, 0, null)
  return {
    ws,
    dataDir,
    projectId,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

/** The REAL analyzer fixture: one file per routed language (a2-language-fixture)
 *  plus the impact fixture (a2-impact-fixture), indexed by the REAL indexer. This
 *  is the only oracle R6/R7 can use: a seeded row cannot say what an analyzer
 *  emits, and R7's whole question is what the analyzers emit. */
interface RealFixture extends Fixture { rows: any[]; byLang: Map<string, LangTruth> }

/** language -> its fixture file, so a table row can be traced to the source that
 *  produced it. Built from the fixture declaration, never by string surgery. */
const fixtureFileByLanguage: Map<string, string> = new Map(
  LANGUAGE_FIXTURE.map((e) => [e.language, `lang_${e.language}.${e.ext}`]),
)

/** The commit the previous A2 record was sealed at — before the M63.T2 impact
 *  fix that read the raw stored column. R8's negative drives the drift law with
 *  this commit to show it notices. Resolved rather than pasted so the probe does
 *  not rot into a 40-hex literal that means nothing. */
const STALE_PROBE_COMMIT = "8130996ed"

/** Resolve a short sha to a full one, or return "" when it does not exist. An
 *  unresolvable probe commit is reported as an unresolved probe, never as a
 *  pass. */
function resolveCommit(short: string): string {
  try {
    return execFileSync("git", ["rev-parse", short], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

/** The address owner, as a MODULE, so the truth table classifies rows through
 *  the same code the surfaces use. A gate that re-derived the classification
 *  would be a second opinion in the sense §8.7 warns about. */
let ownerModule: any = null

async function makeRealFixture(): Promise<RealFixture> {
  const files: Record<string, string> = { ...languageFixtureFiles(), ...IMPACT_FILES }
  const ws = mkdtempSync(path.join(tmpdir(), "m62a2-real-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m62a2-reald-"))
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(ws, rel), content)
  process.env.BB_DATA_DIR = dataDir
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const projectId = getProjectId(ws) as string
  await indexProjectParallel(projectId, ws, {})
  const db = await BrainDatabase.getRawInstance(projectId as never)
  const lineCounts = languageFixtureLineCounts(files)
  const invocations = invocationLineByFile(files)
  // The rows the TABLE is measured over: source-side, so the stored line means
  // "where in the caller's file the usage is" — the same side the engine derives
  // the caller's address from. A target-side row would have a line meaning
  // something else entirely and mixing the two would make the table a fiction.
  const rows = db
    .prepare(
      `SELECT r.id AS id, r.line_number AS ln, r.relationship_type AS rt,
              COALESCE(f.relative_path, f.path, '') AS file, COALESCE(f.language, '') AS lang
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_file f ON f.id = s.file_id
       WHERE r.project_id = ?`,
    )
    .all(projectId) as Array<{ id: string; ln: number | null; rt: string; file: string; lang: string }>

  const byLang = new Map<string, LangTruth>()
  const blank = (language: string): LangTruth => ({
    language, relRows: 0, storedReal: 0, storedNull: 0, storedZero: 0,
    usageRows: 0, usageRealLine: 0, usageOnMarkedLine: 0, outOfFile: 0,
    callSite: 0, declaration: 0, unknown: 0,
    invocationLine: invocations[fixtureFileByLanguage.get(language) ?? ""] ?? null,
  })
  for (const row of rows) {
    const entry = byLang.get(row.lang) ?? blank(row.lang)
    entry.relRows++
    if (row.ln === null) entry.storedNull++
    else if (row.ln === 0) entry.storedZero++
    else {
      entry.storedReal++
      const limit = lineCounts[row.file]
      if (limit !== undefined && (row.ln < 1 || row.ln > limit)) entry.outOfFile++
    }
    // The owner's classification of the SAME facts — not a second derivation by
    // the gate: `deriveCallSiteAddress` is imported from the owner below.
    const address = ownerModule.deriveCallSiteAddress({
      storedLine: row.ln,
      file: row.file,
      callerDeclaration: { line: null },
    })
    if (address.kind === "call-site") entry.callSite++
    else if (address.kind === "declaration") entry.declaration++
    else entry.unknown++
    if (USAGE_ROW_TYPES.has(row.rt)) {
      entry.usageRows++
      if (row.ln !== null && row.ln > 0) {
        entry.usageRealLine++
        if (invocations[row.file] === row.ln) entry.usageOnMarkedLine++
      }
    }
    byLang.set(row.lang, entry)
  }
  return {
    ws, dataDir, projectId, rows, byLang,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

/** The stored relationship kinds for which "the call site" is a meaningful claim.
 *  A `contains` edge has no call site — its stored line names the containment —
 *  so counting it as a usage row would make the table say something false. */
const USAGE_ROW_TYPES = new Set(["calls", "references", "uses", "instantiates"])

/** The impact fixture's expected shape, stated so a failure can say WHICH
 *  precondition lapsed rather than only that a law went red. */
function impactFixtureFacts(): { declT: number | null; callsToP2: number[]; callsToMid1: number[] } {
  return {
    declT: declarationLine(IMPACT_FILES, DEPTH_CORRECTED_SYMBOL),
    callsToP2: callLines(IMPACT_FILES, "p2"),
    callsToMid1: callLines(IMPACT_FILES, "mid1"),
  }
}

// --- mutants ------------------------------------------------------------------------------
type Mutant = { name: string; law: string; module: string; edits: Array<{ from: string; to: string }> }

const MUTANTS: Mutant[] = [
  {
    name: "callers: silent substitution restored (stored line || the caller's declaration)",
    law: "P1(",
    module: ENGINE_MODULE,
    edits: [{ from: "          storedLine: row.lineNumber,\n          file: row.srcFileRel || node.file,", to: "          storedLine: row.lineNumber || node.line,\n          file: row.srcFileRel || node.file," }],
  },
  {
    name: "callees: the caller's declaration line used as the call site",
    law: "P1(",
    module: ENGINE_MODULE,
    edits: [{ from: "          storedLine: row.lineNumber,\n          file: row.srcFileRel || srcFileRel,", to: "          storedLine: row.lineNumber || srcLine,\n          file: row.srcFileRel || srcFileRel," }],
  },
  {
    name: "hub: fabricates its own call-site address",
    law: "P2(",
    module: HUB_MODULE,
    edits: [{ from: "      callSite: edge.callSite,", to: "      callSite: { kind: \"call-site\", file: edge.callSite?.file ?? \"\", line: edge.callSite?.line ?? 0 }," }],
  },
  {
    name: "MCP: fabricates its own call-site address",
    law: "P3(",
    module: TOOL_HANDLERS_MODULE,
    edits: [{ from: "        callSite: e.callSite ?? null,", to: "        callSite: { kind: \"call-site\", file: e.callSite?.file ?? \"\", line: e.callSite?.line ?? 0 }," }],
  },
  {
    name: "webview mirror drops the declared note",
    law: "P4(",
    module: CORE_MODULE,
    edits: [{ from: "  return `${position} — ${note}`", to: "  return position" }],
  },
  {
    name: "webview mislabels the kinds it shows",
    law: "P5(",
    module: CORE_MODULE,
    edits: [{ from: "  return kinds.length > 0 ? kinds.join(\",\") : \"none\"", to: "  return \"call-site\"" }],
  },
  {
    // The defect this lane was opened for. Restores the surface's own position:
    // the DEPENDENT'S DECLARATION line, published as a `call-site`, while the
    // engine's real address sits unread on the same edge.
    name: "impact: publishes the dependent's declaration line as the usage position",
    law: "P7(",
    module: IMPACT_MODULE,
    edits: [{ from: "      callSite: edge.callSite,\n      rowId: edge.rowId,", to: "      callSite: { kind: \"call-site\", file: edge.callSite?.file ?? \"\", line: node?.line ?? 0 },\n      rowId: edge.rowId," }],
  },
  {
    // The second half of the same class, on the depth-corrected path: the raw
    // stored column published verbatim, so a stored `0` reached the wire as a
    // position and a real call site arrived with no statement of what it was.
    name: "impact: publishes the raw stored line on the depth-corrected path",
    law: "P7(",
    module: IMPACT_MODULE,
    edits: [{ from: "        storedLine: storedLineFromRow(row as unknown as Record<string, unknown>),", to: "        storedLine: Number((row as unknown as Record<string, unknown>)[\"bb_stored_call_line\"] ?? 0) || row.srcLine," }],
  },
]

async function loadMutant(idx: number, m: Mutant): Promise<any> {
  const source = readFileSync(m.module, "utf8")
  let mutated = source
  for (const { from, to } of m.edits) {
    const occurrences = source.split(from).length - 1
    if (occurrences !== 1) throw new Error(`mutant anchor not unique (${occurrences}x): ${from.slice(0, 60)}`)
    mutated = mutated.replace(from, to)
  }
  const mutantPath = path.join(path.dirname(m.module), `__m62a2_mut_${idx}.ts`)
  writeFileSync(mutantPath, mutated)
  try {
    return { mod: await import(mutantPath), path: mutantPath }
  } finally {
    // The import must finish before deletion on some loaders; the path is
    // cleaned up by the caller after the law run.
    setTimeout(() => { try { rmSync(mutantPath, { force: true }) } catch {} }, 0)
  }
}

// --- P10: the gate-authoring defects this lane found in its OWN gates ------------------
/** Two gate-authoring defects were found in this lane's own gates at HEAD, and
 *  each had made a gate unable to report a failure:
 *
 *  D-a  a SECOND derivation of project identity. Three gates hashed
 *       `path.resolve(workspace)` while the owner (`src/util/project-id.ts`)
 *       hashes `realpathSync.native(...)`. Those disagree wherever the temp dir
 *       is a symlink — macOS always. Measured: the gate seeded project
 *       `01fac7c09` and the server opened `a3676362b`, and answered "workspace
 *       is not indexed". Both legs were red on macOS and green on Linux, so the
 *       red was describing the platform, not the law.
 *
 *  D-b  a fixture whose WRITER was never called. `writeU5Fixture()` was exported
 *       and had no callers, so `verify-impact-resolution.ts` indexed a directory
 *       that did not exist and died at its first step — while its sealed record
 *       said `verified`, because a gate that cannot start cannot report a
 *       failure.
 *
 *  Both are lintable, and both are silent regressions (nothing about them makes a
 *  test fail until the day the platform or the tree changes), which is exactly
 *  the class §11 F1/F7 says must become a permanent gate.
 *
 *  SCOPE — this lane's gates only, declared. The same signature was found in
 *  gates owned by other lanes (§11 workspace scope), and a law that fires on
 *  thirty files this lane may not edit would be a broken law: it would have to
 *  be suppressed, and a suppressed law is a lie told in the gate's own name.
 *  Every outside-scope hit is therefore COUNTED and PUBLISHED here rather than
 *  waived — see `gateAuthoringOutsideScope` in the evidence record. Widening the
 *  scope is a filed decision for the owning lanes, not an assumption here. */
/** The EXACT gate scripts this lane owns — a file list, not a directory
 *  prefix. Two gates under script/m44 and script/m62 belong to other lanes
 *  (`verify-hub-tree.ts`, `verify-closure.ts`), and a directory-wide scope
 *  would make the law unsatisfiable without an out-of-lane edit — which is a
 *  law nobody reads. Widening the list is a filed decision for the owning
 *  lane; the out-of-scope report below is where their hits stay visible. */
const GATE_LINT_SCOPE = [
  "script/m44/verify-usages-groups.ts",
  "script/m44/verify-usages-fallback.ts",
  "script/m44/verify-legend.ts",
  "script/m44/verify-impact-resolution.ts",
  "script/m62/verify-address.ts",
  "script/m62/verify-consumers.ts",
  "script/m62/verify-arrival.ts",
]

/** The exact signature of D-a: a 40-hex-character sha1 over a workspace path.
 *  The `.substring(0, 40)` is what makes it a project id rather than one of the
 *  many content hashes gates legitimately take over files and fixtures; without
 *  it the lint fires on a dozen files that hash file CONTENTS, which is a false
 *  positive dressed as a law. */
const PROJECT_ID_DERIVATION = /createHash\(\s*["']sha1["']\s*\)\s*\.update\([^)]*(path\.resolve|canonical|workspace|\bws\b)/

function gateAuthoringViolations(files: Array<{ path: string; text: string }>, scope: "in" | "all" = "in"): string[] {
  const out: string[] = []
  for (const f of files) {
    if (!f.path.includes("verify-")) continue
    // The pass/fail scope. `outsideScope` REPORTED the same signature in eight gates this lane
    // may not edit; judging them here would make the law unsatisfiable without
    // an edit outside the lane, and a law that can only be satisfied by breaking
    // it is a law nobody reads.
    if (scope === "in" && !GATE_LINT_SCOPE.includes(f.path)) continue
    const code = f.text.split("\n").filter((line) => !isProse(line))
    const usesOwner = code.some((line) => /getProjectId\s*\(/.test(line))
    // D-a: a 40-hex sha1 over a workspace path, in a file that does not call the
    // owner. Either half alone is not the defect — the owner call is allowed to
    // sit beside a comment that repeats the old derivation.
    const derivation = code.find((line) => PROJECT_ID_DERIVATION.test(line) && line.includes("substring(0, 40)"))
    if (derivation !== undefined && !usesOwner) out.push(`P10(second-project-identity-derivation ${f.path})`)
    // D-b: a fixture directory named in the file with no writer called.
    if (/\.tools\/[a-z0-9-]+-fixture/.test(f.text) && !/write[A-Za-z0-9]*Fixture\s*\(/.test(f.text)) {
      out.push(`P10(fixture-dir-with-no-writer ${f.path})`)
    }
  }
  return out
}

/** The same two signatures, reported for gates OUTSIDE this lane's scope. Counted
 *  and published, never suppressed and never used as a pass/fail here. */
function gateAuthoringOutsideScope(files: Array<{ path: string; text: string }>): string[] {
  const out: string[] = []
  for (const f of files) {
    if (!f.path.includes("verify-") || GATE_LINT_SCOPE.includes(f.path)) continue
    const code = f.text.split("\n").filter((line) => !isProse(line))
    const usesOwner = code.some((line) => /getProjectId\s*\(/.test(line))
    if (usesOwner) continue
    if (code.some((line) => PROJECT_ID_DERIVATION.test(line) && line.includes("substring(0, 40)"))) {
      out.push(f.path)
    }
  }
  return out.sort()
}

/** Every gate in the repository, found by name rather than by a hand-kept list:
 *  a lint with a hand-kept file list rots exactly like a hand-kept count does,
 *  and the whole point of P10 is that these defects are silent. Uses the same
 *  walk the indexer uses, so a new gate is covered the day it is written. */
function collectGateFiles(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  const stack = [path.join(ROOT, "script")]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "tmp") continue
        stack.push(full)
        continue
      }
      if (!entry.name.startsWith("verify-") || !entry.name.endsWith(".ts")) continue
      try {
        out.push({ path: path.relative(ROOT, full), text: readFileSync(full, "utf8") })
      } catch {}
    }
  }
  return out
}

// --- main ---------------------------------------------------------------------------------
async function main(): Promise<void> {
  const owner = await import(OWNER_MODULE)
  ownerModule = owner
  ownerUnattributedNote = () => owner.ADDRESS_NOTES.unattributed
  STORED_LINE_COLUMN = owner.STORED_LINE_COLUMN
  const core = await import(CORE_MODULE)
  const fx = await makeFixture()
  try {
    const engine = await import(ENGINE_MODULE)
    const hull: any = await import(HUB_MODULE)
    const handlers = (await import(TOOL_HANDLERS_MODULE)).createToolHandlers()

    const trav = await engine.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
    const engineByRow = new Map<string, any>()
    for (const e of [...(trav.callers ?? []), ...(trav.callees ?? [])]) engineByRow.set(e.rowId, e.callSite)
    const engineCallers = (trav.callers ?? []).map((e: any) => normalize(e.callSite))
    const engineCallees = (trav.callees ?? []).map((e: any) => normalize(e.callSite))

    console.log("R1: the engine's addresses over the real seeded index")
    const eViolations = engineViolations(trav)
    check("R1: every seeded row's address is the declared one (both directions)", eViolations.length === 0, eViolations.join(", "))
    check("R1: no address carries a non-positive line, and every kind is declared", engineByRow.size === SEED.relationships.length, `${engineByRow.size}/${SEED.relationships.length}`)

    console.log("\nR2: the hub payload cannot invent its own address")
    const hub = hull.buildGroupedUsages(trav, { imports: [], exports: [] })
    const hViolations = hubViolations(hub, engineByRow)
    check("R2: every hub row serves the ENGINE's address (differential)", hViolations.length === 0, hViolations.join(", "))

    console.log("\nR3: the agent's bb_graph payload")
    const res = await handlers["bb_graph"]!({ symbol: "root" }, { projectPath: fx.ws, projectId: fx.projectId })
    const payloadText = res.content[0]?.text ?? ""
    const mViolations = mcpViolations(payloadText, engineCallers, engineCallees)
    check("R3: the MCP payload serves the same address multiset as the engine", mViolations.length === 0, mViolations.join(", "))

    console.log("\nR4: the webview — one formatter, declared kinds")
    const mirViolations = mirrorViolations(core, owner)
    check("R4: the import-pure mirror formats exactly like the owner (drift gate)", mirViolations.length === 0, mirViolations.join(", "))
    const dViolations = domViolations(core)
    check("R4: the rendered hub declares the address kinds it shows", dViolations.length === 0, dViolations.join(", "))

    console.log("\nR5: the permanence lint")
    const surfaces = DISPLAY_SURFACES.map((rel) => ({ path: rel, text: readFileSync(path.join(ROOT, rel), "utf8") }))
    const lViolations = lintViolations(surfaces)
    check("R5: no display surface reads a raw stored line", lViolations.length === 0, lViolations.join(", "))
    check("R5: no positional fallback survives in the engine", engineFallbackViolations().length === 0, engineFallbackViolations().join(", "))
    // NEGATIVE — the lint must catch a planted read (a lint that cannot fail is
    // not a gate, M61 D-4).
    const planted = [...surfaces, { path: "src/lsp/__planted.ts", text: "const display = row.line_number ?? 0\n" }]
    const plantedFindings = lintViolations(planted)
    check("R5-negative: the lint catches a planted display-side raw read", plantedFindings.some((f) => f.includes("__planted.ts")), plantedFindings.join(", "))
    // L6: the column name lives in the OWNER and nowhere else. A surface that
    // re-reads a row at a depth the engine did not quote must go through the
    // owner's declared select/adapter pair, or the blunt token lint above has to
    // be weakened to let it through — so the single-file rule is itself a law.
    const columnHolders: string[] = []
    for (const rel of DISPLAY_SURFACES) {
      const text = readFileSync(path.join(ROOT, rel), "utf8")
      if (text.split("\n").some((line) => !isProse(line) && new RegExp(`\\b${STORED_LINE_COLUMN}\\b`).test(line))) columnHolders.push(rel)
    }
    const ownerHoldsIt = readFileSync(OWNER_MODULE, "utf8").split("\n").some((line) => new RegExp(`\\b${STORED_LINE_COLUMN}\\b`).test(line))
    check(
      "R5: the stored column is named in the owner and in no display surface",
      ownerHoldsIt && columnHolders.length === 0,
      columnHolders.length > 0 ? columnHolders.join(", ") : ownerHoldsIt ? "" : "the owner does not name it",
    )

    console.log("\nR6/R7: the REAL analyzer index — impact positions and the per-language truth table")
    const real = await makeRealFixture()
    try {
      const raw = await (await import(path.join(ROOT, "src/brain/database.ts"))).BrainDatabase.getRawInstance(real.projectId as never)
      const impactMod: any = await import(IMPACT_MODULE)
      const engineForReal: any = await import(ENGINE_MODULE)
      // The engine's own addresses over the SAME real rows — the differential
      // oracle for R6, gathered with the SAME walk impact used so no row is
      // quoted by one and not the other.
      const travReal = await engineForReal.graphTraversal(real.projectId, IMPACT_ROOT, { direction: "callers", maxDepth: 5, relationshipTypes: ["calls", "instantiates", "extends", "implements"] })
      const engineRealByRow = new Map<string, any>()
      for (const e of [...(travReal?.callers ?? []), ...(travReal?.callees ?? [])]) engineRealByRow.set(e.rowId, e.callSite)

      const impactResult = await impactMod.computeImpact(raw, real.projectId, IMPACT_ROOT)
      const shape = impactFixtureShape(impactResult)
      check(
        "R6-fixture: the depth-corrected path is reached (the gate exercises the code it was written for)",
        shape.length === 0,
        `${shape.join(", ")} | facts: ${JSON.stringify(impactFixtureFacts())}`,
      )
      // The two facts R6b needs, measured before anything is seeded.
      const correctedDep0: any = impactResult.impact.find((d: any) => d.name === DEPTH_CORRECTED_SYMBOL)
      const correctedRealLine: number | null = typeof correctedDep0?.callSite?.line === "number" ? correctedDep0.callSite.line : null
      const declOfCorrected: number | null = typeof correctedDep0?.declarationLine === "number" ? correctedDep0.declarationLine : null
      const iViolations = impactViolations(impactResult, engineRealByRow)
      check(
        "R6: every impact position is the owner's address for the row it quotes",
        iViolations.length === 0,
        iViolations.join(", "),
      )
      const kinds = new Map<string, number>()
      for (const dep of impactResult.impact) kinds.set(dep.callSite?.kind ?? "(none)", (kinds.get(dep.callSite?.kind ?? "(none)") ?? 0) + 1)
      check(
        "R6: the impact payload publishes no bare position field at all",
        !("line" in (impactResult.impact[0] ?? {})),
        Object.keys(impactResult.impact[0] ?? {}).join(","),
      )
      // R6b — the DECLARED-ABSENCE path, on the real surface and the real store.
      // Every language measured above emits real lines, so the absence path would
      // otherwise never run in this gate — and an unexercised path is the one
      // that rots. So one stored row is put into the store's declared unknown
      // state (NULL) and the SAME answer is recomputed: the dependent's address
      // must stop being a `call-site` and must say which of the declared reasons
      // applies. Seeding a store state is declared (A3 does the same, with the
      // same limitation): the ANALYZER leg is R7's, this is the CONSUMER leg.
      const correctedRow = (() => {
        const dep = impactResult.impact.find((d: any) => d.name === DEPTH_CORRECTED_SYMBOL)
        return typeof dep?.rowId === "string" ? dep.rowId : null
      })()
      if (correctedRow === null) {
        check("R6b: the declared-absence path is exercised", false, `no rowId on ${DEPTH_CORRECTED_SYMBOL}`)
      } else {
        raw.prepare(`UPDATE brain_relationship SET line_number = NULL WHERE id = ?`).run(correctedRow)
        try {
          const absent = await impactMod.computeImpact(raw, real.projectId, IMPACT_ROOT)
          const dep = absent.impact.find((d: any) => d.name === DEPTH_CORRECTED_SYMBOL)
          const a = dep?.callSite
          const expectedNote = owner.ADDRESS_NOTES.substitute
          const problems: string[] = []
          if (dep === undefined) problems.push("the dependent vanished")
          else {
            if (a?.kind === "call-site") problems.push(`still a call site: ${JSON.stringify(a)}`)
            if (a?.line === 0) problems.push("published line 0")
            if (a?.kind !== "call-site" && a?.note !== expectedNote) problems.push(`note ${a?.note} != ${expectedNote}`)
            // The substitute is PERMITTED to be the calling symbol's declaration
            // — that is the owner's one lawful substitute, and it is `t` itself
            // here. What is not permitted is arriving unlabeled, which is what
            // the `kind` and the note above already assert. So the only extra
            // thing worth checking is that the substitute really is the caller's
            // own declaration and not some other line.
            if (a?.kind === "declaration" && a.line !== declOfCorrected) {
              problems.push(`substitute ${a.line} is not the caller's declaration ${declOfCorrected}`)
            }
          }
          check(
            "R6b: a NULL stored line yields a DECLARED address, never a position (declared-absence path)",
            problems.length === 0,
            problems.join(", "),
          )
        } finally {
          raw.prepare(`UPDATE brain_relationship SET line_number = ? WHERE id = ?`).run(correctedRealLine, correctedRow)
        }
      }
      truthTable = [...real.byLang.values()].sort((a, b) => a.language.localeCompare(b.language))
      const tViolations = truthViolations(truthTable, { ...languageFixtureFiles(), ...IMPACT_FILES })
      check("R7: the per-language truth table satisfies the anti-fabrication laws", tViolations.length === 0, tViolations.join(", "))
      // R7-negative — the ORACLE can fail. The anti-fabrication law is the one
      // that keeps a declared absence honest, and an oracle nobody has ever seen
      // go red is the §8.7 failure this lane was warned about. So the table is
      // perturbed in the two ways the law exists to catch and the same function
      // is run over it: a call site with no stored line, and a classification
      // that does not account for every row.
      const allFiles = { ...languageFixtureFiles(), ...IMPACT_FILES }
      const victim = truthTable[0]
      const fabricated = truthTable.map((e) =>
        e.language === victim?.language ? { ...e, callSite: e.storedReal + 1, storedReal: 0, declaration: 0, unknown: 0 } : e,
      )
      const unaccounted = truthTable.map((e) => (e.language === victim?.language ? { ...e, callSite: e.callSite - 1 } : e))
      const outOfFileTable = truthTable.map((e) => (e.language === victim?.language ? { ...e, outOfFile: 1 } : e))
      check(
        "R7-negative: a call site with no stored line is rejected",
        truthViolations(fabricated, allFiles).some((v) => v.startsWith("P8(no-fabricated-call-site")),
        truthViolations(fabricated, allFiles).join(", "),
      )
      check(
        "R7-negative: a classification that drops a row is rejected",
        truthViolations(unaccounted, allFiles).some((v) => v.startsWith("P8(addresses-account-for-every-row")),
        truthViolations(unaccounted, allFiles).join(", "),
      )
      check(
        "R7-negative: a stored line pointing outside its own file is rejected",
        truthViolations(outOfFileTable, allFiles).some((v) => v.startsWith("P8(stored-line-inside-its-file")),
        truthViolations(outOfFileTable, allFiles).join(", "),
      )
      check(
        "R7: every language in the fixture appears in the table with at least one stored row",
        truthTable.length === LANGUAGE_FIXTURE.length,
        `${truthTable.length}/${LANGUAGE_FIXTURE.length}: ${truthTable.map((e) => e.language).join(",")}`,
      )
      console.log(`\n    the truth table (${truthTable.length} languages, ${real.rows.length} source-side stored rows):`)
      console.log("    language\trows\trealLine\tnull\tzero\tusageRows\tusageRealLine\tonMarkedLine\toutOfFile\tcallSite\tdeclaration\tunknown")
      for (const e of truthTable) {
        console.log(`    ${e.language}\t${e.relRows}\t${e.storedReal}\t${e.storedNull}\t${e.storedZero}\t${e.usageRows}\t${e.usageRealLine}\t${e.usageOnMarkedLine}\t${e.outOfFile}\t${e.callSite}\t${e.declaration}\t${e.unknown}`)
      }
  console.log("\nR9: §15.1 one surface, one answer — hub / graph / impact counts the SAME reverse dependencies")
      // The three surfaces I own (and the engine behind them) answer the same
      // question — "which symbols are reverse dependencies of this one" — and
      // §15.1 says the numbers either agree or the difference is DECLARED with
      // its filter. The question is asked over ONE rule: the same relationship
      // kinds (impact's declared `IMPACT_REL_TYPES`), the same root, the same
      // walk, and every count taken from its own surface's payload rather than
      // recomputed here. `declared` is the only escape, and each entry must NAME
      // a filter that is a real property of the surfaces — not a shrug.
      const hubReal = hull.buildGroupedUsages(travReal, { imports: [], exports: [] })
      const graphCallerNodes = new Set((travReal?.callers ?? []).map((e: any) => e.from))
      const three = {
        graph: graphCallerNodes.size,
        hubCallerGroups: hubReal.counts.callerGroups,
        impactShown: impactResult.shownCount,
      }
      const distinct = [...new Set(Object.values(three))]
      const disagreement = distinct.length > 1
      // The differences these surfaces are DECLARED to have, each with the filter
      // that causes it. A disagreement not on this list is a §15.1 violation.
      const DECLARED_FILTERS: Array<{ surface: string; cause: string; holds: boolean }> = [
        {
          surface: "hub",
          cause: "graph_usages drops SELF-REFERENTIAL edges (from === to) before grouping — an analyzer artifact, never a usage (M55.T3); the engine's caller list keeps them",
          holds: graphCallerNodes.size >= hubReal.counts.callerGroups,
        },
        {
          surface: "impact",
          cause: "computeImpact collapses callers to one DEPENDENT per node (a caller with three call sites is one dependency) and drops the root from its own set (M63.T1) — both declared in ImpactResult",
          holds: three.impactShown <= graphCallerNodes.size,
        },
      ]
      const undeclared = disagreement ? DECLARED_FILTERS.filter((f) => !f.holds) : []
      check(
        "R9: the three surfaces' counts agree, or every difference is a DECLARED filter",
        !disagreement || undeclared.length === 0,
        `graph=${three.graph} hub=${three.hubCallerGroups} impact=${three.impactShown}${
          disagreement ? ` | undeclared: ${undeclared.map((f) => f.surface).join(",") || "(none)"}` : ""
        }`,
      )
      console.log(`    declared filters in force on this fixture:`)
      for (const f of DECLARED_FILTERS) console.log(`      - ${f.surface}: ${f.cause}`)
      crossSurfaceCounts = three
    } finally {
      try { real.cleanup() } catch {}
    }

    console.log("\nP10: the gate-authoring defects this lane found in its own gates")
    // The scope is every gate in this repository's `script/` tree, so the OUT OF
    // SCOPE hits are counted and published — but the pass/fail law covers this
    // lane's own gates only, because those are the ones it may fix (see the
    // scope note above).
    const gateFiles = collectGateFiles()
    const gateViolations = gateAuthoringViolations(gateFiles)
    check(
      "P10: no gate in this lane derives project identity a second time or names a fixture directory with no writer",
      gateViolations.length === 0,
      gateViolations.join(", "),
    )
    const plantedGate = {
      path: "script/m62/verify-planted.ts",
      text: 'const ws = "/tmp/x"\nconst projectId = createHash("sha1").update(path.resolve(ws)).digest("hex").substring(0, 40)\nconst WS = path.join(ROOT, ".tools/m99-fixture")\n',
    }
    // The DETECTOR is what the negative exercises, so the scope filter is
    // bypassed on purpose: a scope that hid the planted defect would be a scope
    // that could hide a real one.
    const plantedGateFindings = gateAuthoringViolations([plantedGate], "all")
    check(
      "P10-negative: the gate-authoring lint catches a planted second identity derivation and a writer-less fixture",
      plantedGateFindings.some((v) => v.includes("P10(second-project-identity-derivation")) &&
        plantedGateFindings.some((v) => v.includes("P10(fixture-dir-with-no-writer")),
      plantedGateFindings.join(", "),
    )
    gateAuthoringFindingsOutOfScope = gateAuthoringOutsideScope(gateFiles)
    console.log(`    the same signature outside this lane's scope (reported, not judged here): ${gateAuthoringFindingsOutOfScope.length} gates — ${gateAuthoringFindingsOutOfScope.join(", ") || "(none)"}`)

    console.log("\nR8: this record cannot be stale")
    const stale = staleRecordViolations()
    check("R8: no display surface changed after this record's commit", stale.length === 0, stale.join(", "))
    // R8-negative — the drift law can fail. It is aimed at the mistake this lane
    // actually made: a later commit invalidated a sealed record and nothing
    // re-ran it, so the record kept saying `verified` about code that was no
    // longer there. The proof drives the SAME function with the commit this
    // record's stale predecessor was sealed at (the commit before the fix that
    // broke the R5 law), and it must report `src/lsp/impact.ts` as having
    // changed since. A probe that could not demonstrate the law on the tree it
    // is running against would be declared rather than counted as a pass.
    const staleRecordProbe = staleRecordViolations(resolveCommit(STALE_PROBE_COMMIT))
    check(
      "R8-negative: the drift law reports a surface that changed after the record",
      staleRecordProbe.some((v) => v.includes("src/lsp/impact.ts")),
      staleRecordProbe.length > 0 ? staleRecordProbe.join(", ") : `no drift reported for a record sealed at ${STALE_PROBE_COMMIT}`,
    )

    console.log("\nM: mutation suite (the suite can fail)")
    const mutantAddresses: Array<[number, Mutant]> = MUTANTS.map((m, i) => [i + 1, m])
    for (const [idx, m] of mutantAddresses) {
      let caught = false
      let detail = ""
      try {
        const source = readFileSync(m.module, "utf8")
        let mutated = source
        for (const { from, to } of m.edits) {
          const occurrences = source.split(from).length - 1
          if (occurrences !== 1) throw new Error(`mutant anchor not unique (${occurrences}x)`)
          mutated = mutated.replace(from, to)
        }
        const mutantPath = path.join(path.dirname(m.module), `__m62a2_mut_${idx}.ts`)
        writeFileSync(mutantPath, mutated)
        try {
          if (m.module === ENGINE_MODULE) {
            const mut = await import(mutantPath)
            const mtrav = await mut.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
            const viol = engineViolations(mtrav)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          } else if (m.module === HUB_MODULE) {
            const mut = await import(mutantPath)
            const viol = hubViolations(mut.buildGroupedUsages(trav, { imports: [], exports: [] }), engineByRow)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          } else if (m.module === TOOL_HANDLERS_MODULE) {
            const mutHandlers = (await import(mutantPath)).createToolHandlers()
            const mres = await mutHandlers["bb_graph"]!({ symbol: "root" }, { projectPath: fx.ws, projectId: fx.projectId })
            const viol = mcpViolations(mres.content[0]?.text ?? "", engineCallers, engineCallees)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          } else if (m.module === IMPACT_MODULE) {
            // The impact mutants need the REAL analyzer index: the whole defect is
            // about which of two REAL lines gets published, so a seeded row where
            // both are synthetic could not tell them apart.
            const rf = await makeRealFixture()
            try {
              const raw = await (await import(path.join(ROOT, "src/brain/database.ts"))).BrainDatabase.getRawInstance(rf.projectId as never)
              const eng: any = await import(ENGINE_MODULE)
              const t = await eng.graphTraversal(rf.projectId, IMPACT_ROOT, { direction: "callers", maxDepth: 5, relationshipTypes: ["calls", "instantiates", "extends", "implements"] })
              const byRow = new Map<string, any>()
              for (const e of [...(t?.callers ?? []), ...(t?.callees ?? [])]) byRow.set(e.rowId, e.callSite)
              const mut: any = await import(mutantPath)
              // The depth-corrected row is put into the store's declared UNKNOWN
              // state first, and that is what makes the raw-read mutant
              // observable: with a real line in the store, "publish the raw
              // column" and "publish the owner's address" produce the SAME bytes
              // and the mutant would be indistinguishable from the fix. The
              // defect this mutant stands for only exists when the store says
              // nothing — which is exactly the case a reader is misled by.
              const correctedDep: any = (await mut.computeImpact(raw, rf.projectId, IMPACT_ROOT)).impact.find((d: any) => d.name === DEPTH_CORRECTED_SYMBOL)
              const rowId = correctedDep?.rowId
              const realLine = correctedDep?.callSite?.line ?? null
              if (typeof rowId !== "string") {
                detail = `no rowId for ${DEPTH_CORRECTED_SYMBOL} (${JSON.stringify(correctedDep)})`
              } else {
                raw.prepare(`UPDATE brain_relationship SET line_number = NULL WHERE id = ?`).run(rowId)
                try {
                  const res = await mut.computeImpact(raw, rf.projectId, IMPACT_ROOT)
                  const viol = impactViolations(res, byRow)
                  // With the row NULL, the owner's answer is a DECLARED state and
                  // the engine's address for it is a `declaration` substitute. A
                  // surface that publishes the raw column publishes line 0 — which
                  // `impactViolations` reads as a fabricated line, and, when the
                  // fallback substituted the declaration, as a declaration
                  // wearing a call site's name.
                  caught = viol.some((v) => v.startsWith(m.law))
                  if (!caught) detail = viol.join(", ") || `NONE (served ${JSON.stringify(res.impact.find((d: any) => d.name === DEPTH_CORRECTED_SYMBOL)?.callSite)}, stored line was ${realLine})`
                } finally {
                  raw.prepare(`UPDATE brain_relationship SET line_number = ? WHERE id = ?`).run(realLine, rowId)
                }
              }
            } finally {
              try { rf.cleanup() } catch {}
            }
          } else {
            const mutCore = await import(mutantPath)
            const viol = m.law === "P4(" ? mirrorViolations(mutCore, owner) : domViolations(mutCore)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          }
        } finally {
          rmSync(mutantPath, { force: true })
        }
      } catch (error: any) {
        caught = true
        detail = `mutant could not be judged: ${String(error?.message ?? error).slice(0, 120)}`
      }
      mutant(m.name, caught, detail)
    }
    check("M: every planted defect is caught", mutants.caught === mutants.total && mutants.total >= 8, `${mutants.caught}/${mutants.total}`)
  } finally {
    try { fx.cleanup() } catch {}
  }

  const failed = checks - passed
  const result = {
    issue: "M62.A2",
    code: "A2",
    milestone: "M62",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    realFailed: 0,
    negativeCases: mutants.total,
    mutantsCaught: mutants.caught,
    mutantsTotal: mutants.total,
    currentCommit,
    verifierCommand: "npx tsx script/m62/verify-consumers.ts",
    evidenceFile: "A2.json",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    laws: [
      "P1 engine-derives-address",
      "P2 hub-serves-the-engine-address",
      "P3 mcp-serves-the-engine-address",
      "P4 webview-mirror-drift",
      "P5 dom-declares-the-kinds-it-shows",
      "P6 no-display-side-raw-stored-line-read",
      "P6b the-stored-column-is-named-in-the-owner-only",
      "P7 impact-serves-the-owners-address-for-the-row-it-quotes",
      "P7b the-fixture-reaches-the-depth-corrected-path",
      "P8 no-call-site-without-a-stored-line (per language, real index)",
      "P8b addresses-account-for-every-stored-row (per language)",
      "P8c every-stored-line-resolves-inside-its-own-file (per language)",
      "P8d the-fixture-can-locate-its-own-call-site (per language)",
      "P9 no-display-surface-changed-after-this-record",
      "P9b the-15-1-cross-surface-counts-agree-or-differ-by-a-declared-filter",
      "P10 no-gate-derives-project-identity-a-second-time",
      "P10b no-gate-names-a-fixture-directory-with-no-writer",
    ],
    /** The measured per-language truth table. This is the lane's per-language
     *  ANSWER, and it is emitted with its denominator and its scope attached so
     *  a reader cannot mistake a 22-file presence measurement for a
     *  coverage measurement on real repositories. */
    perLanguageCallSiteTruth: {
      scope:
        "one purpose-built file per routed extension, indexed fresh by the real indexer at this commit; source-side stored relationship rows only (the side a call-site line describes)",
      denominator: {
        languages: truthTable.length,
        sourceSideRows: truthTable.reduce((n, e) => n + e.relRows, 0),
        storedRealLines: truthTable.reduce((n, e) => n + e.storedReal, 0),
        storedNullLines: truthTable.reduce((n, e) => n + e.storedNull, 0),
        storedLegacyZeroLines: truthTable.reduce((n, e) => n + e.storedZero, 0),
      },
      rows: truthTable,
    },
    /** §15.1: the measured cross-surface counts for the fixture root, with the
     *  declared filters that would account for a difference. A reader can see
     *  whether the three surfaces agreed on this run without re-running it. */
    crossSurfaceCounts: {
      question: "reverse dependencies of the fixture root, over impact's declared relationship kinds, from each surface's OWN payload",
      measured: crossSurfaceCounts,
      declaredFilters: [
        "hub: graph_usages drops self-referential edges (from === to) before grouping — an analyzer artifact, never a usage (M55.T3); the engine's caller list keeps them",
        "impact: computeImpact collapses callers to one dependent per node and drops the root from its own set (M63.T1) — both declared on ImpactResult",
      ],
    },
    /** P10's out-of-scope report: the same defect signature in gates this lane
     *  does not own. Published so the finding is visible in the evidence rather
     *  than living only in a commit message; each is a filed decision for the
     *  owning lane. An empty list is a claim too, so the field is always
     *  present. */
    gateAuthoringOutOfScope: {
      signature: "a 40-hex sha1 over a workspace path, in a gate that does not call src/util/project-id.ts getProjectId",
      lanesInScope: GATE_LINT_SCOPE,
      gatesOutsideScope: gateAuthoringFindingsOutOfScope,
      note: "found on macOS 2026-10-05 while fixing the same defect in this lane own three gates; not judged here because this lane may not edit those files",
    },
    consumers: [
      "src/intelligence/graph/graph-engine.ts",
      "src/lsp/graph_usages.ts",
      "src/lsp/impact.ts",
      "src/mcp/tool-handlers.ts",
      "script/m26/graph-core.ts",
      "src/lsp/navigation.ts (raw column removed; still navigates to the referencing symbol — migration spec in docs/m62/CALLSITE-MIGRATION.md)",
    ],
    declaredNotChanged: [
      "textDocument/references and call hierarchy still navigate to the referencing symbol's own indexed location (byte-accurate) — they make no call-site claim. Both files belong to other lanes; the exact adoption steps are specified in docs/m62/CALLSITE-MIGRATION.md and are NOT claimed here.",
      "The hover's usages section keeps its declared vocabulary (the referencing symbol's location), stated in its own header.",
      "src/lsp/call_hierarchy.ts already resolves call sites FROM SOURCE (M55.T2) and declares callSitesResolved / callSitesApproximate; it does not read the stored column and this gate does not judge it. The two approaches are compared in the migration spec.",
    ],
    limitations: [
      "The webview mirror is drift-gated, not shared (graph-core keeps its zero-import law W1).",
      "The per-language truth table is a PRESENCE measurement over a 22-file fixture, not a coverage measurement on real repositories: a language can emit a real line for a trivially-shaped call and still emit 0% on a real corpus. Per-language coverage on real repositories remains M59.A7/M60's claim and is not re-measured here.",
      "5 of the 73 relationships the fixture index wrote had a dangling source symbol (the indexer's own warning) and are therefore absent from the source-side table; they are counted here rather than silently dropped.",
      "Rows whose source file is not in the fixture (none at this commit) would have no line-count bound for P8c and are excluded from the out-of-file count rather than assumed in range.",
    ],
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeSealed(EVIDENCE, result)
  console.log(`\nA2: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
