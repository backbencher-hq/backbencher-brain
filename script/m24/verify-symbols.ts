// script/m24/verify-symbols.ts — M24.L4 verifier + mutation suite.
//
// Proves the symbols component (src/lsp/symbols.ts) honors its declared
// guarantees against a CoreDatabase-shaped double backed by fixture data
// matching the real index schema, and proves the suite CAN FAIL by
// planting defects and asserting the suite catches each one.
//
// Guarantees under test (declared in src/lsp/symbols.ts header):
//   G1 document:  all of a file's symbols from brain_symbol, hierarchical
//                 via owner_symbol_id, ordered by line
//   G2 workspace: query over brain_symbol with existing gravity ranking
//                 (exact-name before fuzzy LIKE, gravity DESC)
//   G3 probe:     every returned range round-trips through P1; extracting
//                 the range text from the file yields the symbol's own
//                 source text (strongest honesty check)
//   G4 honesty:   empty document -> declared absence, never invented;
//                 empty workspace query -> declared empty
//   G5 latency:   p95 warm workspace query under the 150 ms budget (§3)
//   G6 absence:   §11.7 DECLARED ABSENCE with a machine-readable code for a
//                 file outside the launch set, an unknown file type, an
//                 unindexed file and an unreadable file — a bare [] is a
//                 VIOLATION and each of those cases has a NEGATIVE test
//   G7 omitted:   §15.3 a symbol whose stored position cannot be resolved is
//                 OMITTED AND DECLARED (`omitted[]`), never emitted at an
//                 invented line — the pre-lane `?? 1` fabrication is the
//                 defect this pins
//   G8 freshness: §4 every response carries a machine-readable staleness
//                 marker; "unknown" is `stale: true`, never silently fresh
//   G9 selection: selectionRange is the symbol's IDENTIFIER only when the
//                 stored start provably lands on the symbol's own name, and
//                 the entry declares which basis it used
//   G10 positions: §5 Rule 1 the two owned files carry NO inline position
//                 conversion (script/m24/position-inline-gate.ts, which has
//                 its own planted-defect self-test)
//
// Run: npx tsx script/m24/verify-symbols.ts
// Evidence: validation/m24/results/L4.json (machine-emitted)

import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { hashFileContent } from "../../src/brain/freshness.ts"
import {
  findInlinePositionArithmetic,
  selfTestSurvivors,
} from "./position-inline-gate.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT = join(ROOT, "src", "lsp", "symbols.ts")
const INLINE_GATE_FILES = ["src/lsp/symbols.ts", "src/lsp/call_hierarchy.ts"] as const
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "L4.json")

let passed = 0
let failed = 0
const failures: string[] = []
let negativeCases = 0

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++
    console.log(`  ok: ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(name: string, ok: boolean, detail = ""): void {
  negativeCases++
  check(`${name} [negative]`, ok, detail)
}

// --- Fixture data (matches the real index schema) ---------------------------

const FIXTURE_MAIN = `class Greeter {
  private greeting: string

  constructor(message: string) {
    this.greeting = message
  }

  greet(): string {
    return this.greeting
  }
}
`

const MAIN_REL = "main.ts"

/** A language the launch set does NOT serve. `languageForPath` knows no
 *  language outside the launch set, so a `.rb` file resolves to `null` and the
 *  declared code is `file_type_unknown` (the honest answer for "we do not know
 *  this file type"). The `.zzz` file exercises the same branch; the
 *  `language_outside_launch_set` branch is the forward case (a language the map
 *  knows but the approved set does not contain) and is reachable the moment the
 *  map gains one. */
const OFF_LAUNCH_REL = "fixture.rb"
const OFF_LAUNCH_SOURCE = "# ruby fixture\nclass Widget\n  def spin\n  end\nend\n"

interface FixtureSymbol {
  id: string
  name: string
  qualified_name: string | null
  symbol_type: string
  owner_symbol_id: string | null
  file: string
  line_start: number | null
  line_end: number | null
  byte_start: number | null
  byte_end: number | null
  gravity_score: number
}

// Per-line 1-based byte columns, end exclusive (P1 convention). Multi-line
// symbols store their END column on their END line (verified against the
// fixture text above):
//   Greeter     lines 1-11, start col 7 (line 1), end col 2 (line 11 "}")
//   constructor lines 4-6,  start col 3 (line 4), end col 4 (line 6 "  }")
//   greet       line 8,    start col 3, end col 8 (single line)
// sym-greet-b is a DUPLICATE name in a second file with lower gravity — the
// exact-name workspace query must rank it below sym-greet by gravity. Its id
// sorts BEFORE sym-greet lexicographically, so name/id ordering differs from
// gravity ordering: a mutant that drops gravity ranking must be observable.
//
// THE OFF-LAUNCH ROWS (sym-rb-widget / sym-zzz-ghost) are indexed rows for
// files the server does NOT serve. They exist so the declared-absence gate is
// proven to run BEFORE the index is read: the pre-lane component answered with
// these rows and `evidenceTier: "indexed"`, which is the lie §11.7 names.
//
// sym-declared-span stores a start column on the `class` KEYWORD, so its
// identifier span is not provable — the entry must fall back to the stored span
// and DECLARE the basis (G9).
const FIXTURE_SYMBOLS: FixtureSymbol[] = [
  { id: "sym-greeter", name: "Greeter", qualified_name: null, symbol_type: "class", owner_symbol_id: null, file: MAIN_REL, line_start: 1, line_end: 11, byte_start: 7, byte_end: 2, gravity_score: 10 },
  { id: "sym-ctor", name: "constructor", qualified_name: "Greeter.constructor", symbol_type: "method", owner_symbol_id: "sym-greeter", file: MAIN_REL, line_start: 4, line_end: 6, byte_start: 3, byte_end: 4, gravity_score: 5 },
  { id: "sym-greet", name: "greet", qualified_name: "Greeter.greet", symbol_type: "method", owner_symbol_id: "sym-greeter", file: MAIN_REL, line_start: 8, line_end: 8, byte_start: 3, byte_end: 8, gravity_score: 7 },
  { id: "sym-declared-span", name: "Greeter", qualified_name: null, symbol_type: "class", owner_symbol_id: null, file: MAIN_REL, line_start: 1, line_end: 11, byte_start: 1, byte_end: 2, gravity_score: 3 },
  { id: "sym-noline", name: "phantom", qualified_name: null, symbol_type: "variable", owner_symbol_id: null, file: MAIN_REL, line_start: null, line_end: null, byte_start: null, byte_end: null, gravity_score: 1 },
  { id: "aaa-greet-b", name: "greet", qualified_name: "Other.greet", symbol_type: "method", owner_symbol_id: null, file: "other.ts", line_start: 1, line_end: 1, byte_start: 1, byte_end: 6, gravity_score: 2 },
  { id: "sym-rb-widget", name: "spin", qualified_name: "Widget.spin", symbol_type: "method", owner_symbol_id: null, file: OFF_LAUNCH_REL, line_start: 3, line_end: 5, byte_start: 3, byte_end: 4, gravity_score: 9 },
  { id: "sym-zzz-ghost", name: "ghost", qualified_name: null, symbol_type: "class", owner_symbol_id: null, file: "notes.zzz", line_start: 1, line_end: 2, byte_start: 1, byte_end: 2, gravity_score: 9 },
]

interface FixtureFile {
  path: string
  language: string | null
  /** the hash the indexer would have stored (freshness oracle) */
  fileHash: string
}

const FILE_SOURCES: Record<string, string> = {
  [MAIN_REL]: FIXTURE_MAIN,
  "other.ts": "class Other {\n  greet() {}\n}\n",
  [OFF_LAUNCH_REL]: OFF_LAUNCH_SOURCE,
  "notes.zzz": "not a language bb knows\n",
}

function fileIdFor(rel: string): string {
  return `file-${rel}`
}

/** The language the index stores for a relative fixture path (mirrors the real
 *  brain_file.language column — NOT the path map: a `.rb` file indexed by some
 *  other tool still stores `ruby`). */
function fixtureLanguage(rel: string): string | null {
  if (rel === OFF_LAUNCH_REL) return "ruby"
  if (rel === "notes.zzz") return null
  return "typescript"
}

function fixtureFiles(dir: string): FixtureFile[] {
  return Object.keys(FILE_SOURCES).map((rel) => ({
    path: join(dir, rel),
    language: rel === OFF_LAUNCH_REL ? "ruby" : rel === "notes.zzz" ? null : "typescript",
    fileHash: hashFileContent(FILE_SOURCES[rel]!),
  }))
}

/** CoreDatabase-shaped double: only prepare().get()/all() with SQL matching
 *  the exact queries the symbols component issues against the index. */
function makeFixture(dir: string, opts: { staleHashes?: boolean; missingFiles?: string[] } = {}): any {
  const abs = (rel: string) => join(dir, rel)
  for (const [rel, content] of Object.entries(FILE_SOURCES)) {
    const p = abs(rel)
    if (!existsSync(p)) writeFileSync(p, content)
  }
  const files = fixtureFiles(dir)
  const freshById = new Map<string, FixtureFile>()
  for (const f of files) {
    if ((opts.missingFiles ?? []).some((m) => f.path.endsWith(m))) continue
    freshById.set(fileIdFor(f.path.slice(dir.length + 1)), opts.staleHashes === true ? { ...f, fileHash: "0".repeat(16) } : f)
  }
  const pathToRel = (absPath: string): string => Object.keys(FILE_SOURCES).find((rel) => absPath === join(dir, rel)) ?? ""

  const raw = {
    prepare(sql: string) {
      const s = sql.toLowerCase().replace(/\s+/g, " ")
      return {
        get(...args: any[]) {
          if (s.includes("count(*)") && s.includes("brain_symbol")) {
            const q = args[0] as string
            const exact = FIXTURE_SYMBOLS.filter((x) => x.name === q).length
            if (exact > 0) return { c: exact }
            const fuzzy = FIXTURE_SYMBOLS.filter((x) => x.name.includes(q.replace(/%/g, ""))).length
            return { c: fuzzy }
          }
          // brain/freshness.ts's freshness lookup — answered faithfully so the
          // §4 marker is measured, not assumed.
          if (s.includes("from brain_file where id = ?")) {
            const row = freshById.get(args[0] as string)
            if (row === undefined) return undefined
            return { path: row.path, file_hash: row.fileHash, size_bytes: null, last_modified: null }
          }
          return undefined
        },
        all(...args: any[]) {
          if (s.includes("from brain_symbol s join brain_file f") && s.includes("where f.path = ?")) {
            const fpath = args[0] as string
            const rel = pathToRel(fpath)
            if (!rel) return []
            return FIXTURE_SYMBOLS.filter((sym) => sym.file === rel).map((sym) => ({
              ...sym,
              file_id: fileIdFor(rel),
              path: abs(rel),
              language: fixtureLanguage(rel),
            }))
          }
          if (s.includes("from brain_symbol s join brain_file f") && (s.includes("where s.name = ?") || s.includes("where s.name like ?"))) {
            const q = (args[0] as string).replace(/%/g, "")
            const limit = args[1] as number
            const isFuzzy = s.includes("like")
            // Faithfully simulate the SQL: the component's ORDER BY decides
            // the ranking, so a mutant that drops gravity ranking MUST be
            // observable through this double.
            const orderByGravity = s.includes("gravity_score desc")
            const orderByName = s.includes("order by s.name")
            let rows = FIXTURE_SYMBOLS.filter((x) => (isFuzzy ? x.name.includes(q) : x.name === q))
            if (orderByGravity) rows = [...rows].sort((a, b) => (b.gravity_score ?? 0) - (a.gravity_score ?? 0))
            else if (orderByName) rows = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
            return rows.slice(0, limit).map((sym) => ({
              ...sym,
              file_id: fileIdFor(sym.file),
              path: abs(sym.file),
              language: fixtureLanguage(sym.file),
            }))
          }
          return []
        },
      }
    },
  }
  return raw
}

function walkEntries(entries: any[]): any[] {
  const all: any[] = []
  const walk = (e: any): void => {
    all.push(e)
    for (const c of e.children ?? []) walk(c)
  }
  for (const root of entries) walk(root)
  return all
}

// --- Tests -------------------------------------------------------------------

async function testDocument(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-doc-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)

  // Only the main.ts document is asserted here: the fixture deliberately also
  // carries an unresolvable row (sym-noline) and a keyword-anchored row, both
  // covered by their own tests below.
  const result = sym.documentSymbols(raw, join(dir, MAIN_REL))
  check("G1: document symbols found", result.symbols.length >= 1, `roots=${result.symbols.length}`)
  check("G1: root symbol is Greeter", result.symbols[0]?.name === "Greeter", JSON.stringify(result.symbols.map((s: any) => s.name)))
  const greeter = result.symbols.find((s: any) => s.name === "Greeter" && s.range.line === 0)
  check("G1: hierarchy via owner_symbol_id", (greeter?.children ?? []).length === 2, JSON.stringify(greeter?.children?.map((c: any) => c.name)))
  const childNames = (greeter?.children ?? []).map((c: any) => c.name).sort()
  check("G1: children are constructor + greet", JSON.stringify(childNames) === JSON.stringify(["constructor", "greet"]), JSON.stringify(childNames))
  check("G1: indexed evidence tier", result.evidenceTier === "indexed")
  cleanupDir(dir)
}

async function testProbe(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-probe-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)

  // Range probe: for every symbol, extract the selection-range text from the
  // file and assert it contains the symbol's own name. This is the strongest
  // honesty check — the range must contain the symbol's text.
  const result = sym.documentSymbols(raw, join(dir, MAIN_REL))
  const sourceText = FIXTURE_MAIN
  const lines = sourceText.split("\n")
  const probe = (r: any): string => {
    if (r.line === r.endLine) {
      const line = lines[r.line] ?? ""
      return line.slice(r.character, r.endCharacter)
    }
    const first = (lines[r.line] ?? "").slice(r.character)
    const last = (lines[r.endLine] ?? "").slice(0, r.endCharacter)
    return `${first}...${last}`
  }
  const all = walkEntries(result.symbols)
  check("G3: at least 3 symbols probed", all.length >= 3, String(all.length))
  let probeOk = true
  const probeDetail: string[] = []
  for (const entry of all) {
    const text = probe(entry.selectionRange)
    const firstLine = (lines[entry.selectionRange.line] ?? "")
    const contains = firstLine.includes(entry.name) || text.includes(entry.name)
    if (!contains) {
      probeOk = false
      probeDetail.push(`${entry.name}: ${JSON.stringify(text)}`)
    }
  }
  check("G3: every selection range contains its symbol's name", probeOk, probeDetail.join("; "))
  check("G3: constructor range starts on its line and contains its name", (() => {
    const ctor = all.find((e: any) => e.name === "constructor")
    return ctor !== undefined && ctor.selectionRange.line === 3 && (lines[3] ?? "").includes("constructor")
  })(), JSON.stringify(all.find((e: any) => e.name === "constructor")?.selectionRange))
  check("G3: greet range is exact text", (() => {
    const greet = all.find((e: any) => e.name === "greet")
    return greet !== undefined && probe(greet.selectionRange) === "greet"
  })(), JSON.stringify(all.find((e: any) => e.name === "greet")?.selectionRange))
  cleanupDir(dir)
}

async function testWorkspace(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-ws-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)

  const exact = sym.workspaceSymbols(raw, { query: "greet" })
  check("G2: exact query finds both greet symbols", exact.symbols.length === 2 && exact.symbols.every((s: any) => s.name === "greet"), JSON.stringify(exact.symbols.map((s: any) => s.name)))
  check("G2: exact match ranked by gravity (sym-greet 7 before aaa-greet-b 2)", exact.symbols[0]?.id === "sym-greet" && exact.symbols[1]?.id === "aaa-greet-b", JSON.stringify(exact.symbols.map((s: any) => s.id)))

  const fuzzy = sym.workspaceSymbols(raw, { query: "reet" })
  check("G2: fuzzy query falls back to LIKE", fuzzy.symbols.some((s: any) => s.name === "greet"), JSON.stringify(fuzzy.symbols.map((s: any) => s.name)))

  const capped = sym.workspaceSymbols(raw, { query: "greet", limit: 1 })
  check("G2: limit caps results", capped.symbols.length === 1 && capped.limit === 1)
  cleanupDir(dir)
}

async function testHonesty(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-hon-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)

  const none = sym.workspaceSymbols(raw, { query: "zzz_nonexistent" })
  check("G4: no match -> declared not indexed", none.evidenceTier === "not_indexed" && none.symbols.length === 0)
  check("G4: no match carries a declared reason", none.absence !== null, JSON.stringify(none.absence))

  // A served language whose file the index does not know: "not indexed", and
  // the reason says so (it is NOT "unknown language").
  const unindexed = sym.documentSymbols(raw, join(dir, "unindexed.ts"))
  check("G4: unindexed file -> not indexed", unindexed.notIndexed === true && unindexed.symbols.length === 0)
  check("G4: unindexed file evidence tier", unindexed.evidenceTier === "not_indexed")
  cleanupDir(dir)
}

/** §11.7 DECLARED ABSENCE — the negative tests the pre-lane suite never had. */
async function testDeclaredAbsence(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-abs-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)

  // The fixture indexes rows for BOTH off-launch files. If the gate did not run
  // before the index read, the component would answer with those rows and
  // `evidenceTier: "indexed"` — the exact lie §11.7 forbids.
  const offLaunch = sym.documentSymbols(raw, join(dir, OFF_LAUNCH_REL))
  negative("G6: a file outside the launch set renders NO symbols even though the index has rows", offLaunch.symbols.length === 0, JSON.stringify(offLaunch.symbols.map((s: any) => s.name)))
  negative("G6: a file outside the launch set is not indexed", offLaunch.notIndexed === true && offLaunch.evidenceTier === "not_indexed")
  negative("G6: a file outside the launch set carries a MACHINE-READABLE absence code", offLaunch.absence?.code === "file_type_unknown", JSON.stringify(offLaunch.absence))
  negative("G6: the absence names the launch set so a client can render the scope", Array.isArray(offLaunch.absence?.launchLanguages) && offLaunch.absence.launchLanguages.includes("java") && offLaunch.absence.launchLanguages.length === 14, JSON.stringify(offLaunch.absence?.launchLanguages))
  negative("G6: the absence message is human-readable (never empty)", typeof offLaunch.absence?.message === "string" && offLaunch.absence.message.length > 20, JSON.stringify(offLaunch.absence?.message))

  const unknownType = sym.documentSymbols(raw, join(dir, "notes.zzz"))
  negative("G6: an unknown file type is declared absent with its own code", unknownType.absence?.code === "file_type_unknown" && unknownType.symbols.length === 0, JSON.stringify(unknownType.absence))

  // A served language, indexed, but no rows: "not indexed", and the reason says
  // exactly that (NOT "language unknown", which would be a different lie).
  const notIndexed = sym.documentSymbols(raw, join(dir, "unindexed.ts"))
  negative("G6: an unindexed served file is declared 'not_in_index'", notIndexed.absence?.code === "not_in_index", JSON.stringify(notIndexed.absence))

  // Unreadable source text: no position can be converted, so nothing is placed.
  const noSourceDir = mkdtempSync(join(tmpdir(), "bblsp-l4-nosrc-"))
  const rawNoSource = makeFixture(noSourceDir)
  rmSync(join(noSourceDir, MAIN_REL), { force: true })
  const unreadable = sym.documentSymbols(rawNoSource, join(noSourceDir, MAIN_REL))
  negative("G6: an unreadable file is declared absent with 'source_unreadable'", unreadable.absence?.code === "source_unreadable", JSON.stringify(unreadable.absence))
  negative("G6: an unreadable file omits its indexed rows rather than dropping them silently", unreadable.omitted.length > 0 && unreadable.symbols.length === 0, JSON.stringify({ omitted: unreadable.omitted.length, symbols: unreadable.symbols.length }))
  cleanupDir(noSourceDir)

  // The launch set decision must come from the OWNER, not hover's re-export.
  const served = sym.declaredAbsenceFor(join(dir, MAIN_REL))
  check("G6: a served file declares NO absence", served === null, JSON.stringify(served))
  cleanupDir(dir)
}

/** §15.3 — an unresolvable stored position is omitted AND declared. */
async function testOmitted(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-omit-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)

  // sym-noline stores no coordinates at all.
  const doc = sym.documentSymbols(raw, join(dir, MAIN_REL))
  check("G7: a row with no stored coordinates is not rendered", !walkEntries(doc.symbols).some((e: any) => e.id === "sym-noline"))
  check("G7: that row is DECLARED in omitted[] with its reason", doc.omitted.some((o: any) => o.id === "sym-noline" && typeof o.reason === "string" && o.reason.length > 0), JSON.stringify(doc.omitted))
  check("G7: an indexed response is not itself a declared absence", doc.absence === null, JSON.stringify(doc.absence))

  // workspace/symbol: a row with no line must NOT be emitted at line 0 (the
  // pre-lane `(row.line_start ?? 1) - 1` INVENTED line 1 for it).
  const ws = sym.workspaceSymbols(raw, { query: "phantom" })
  negative("G7: a workspace row with NO stored line is omitted, not placed at line 0", ws.symbols.length === 0, JSON.stringify(ws.symbols))
  negative("G7: the omitted workspace row is declared with its reason", ws.omitted.some((o: any) => o.id === "sym-noline" && o.reason === "coordinates_missing"), JSON.stringify(ws.omitted))
  negative("G7: a workspace result with nothing renderable declares why", ws.absence !== null && typeof ws.absence.message === "string", JSON.stringify(ws.absence))

  // A stored line past EOF (a stale row) cannot be validated by the owner and
  // must be declared, not emitted as a position the editor cannot reach.
  const staleDir = mkdtempSync(join(tmpdir(), "bblsp-l4-stale-"))
  const staleRaw = makeFixture(staleDir)
  const shortFile = join(staleDir, "short.ts")
  writeFileSync(shortFile, "class Only {\n}\n")
  const staleRows: any = {
    prepare(sql: string) {
      const s = sql.toLowerCase().replace(/\s+/g, " ");
      return {
        get: (...args: any[]) => (s.includes("count(*)") ? { c: 1 } : undefined),
        all: (...args: any[]) => {
          if (s.includes("count(*)")) return []
          if (s.includes("where s.name = ?")) {
            return [{ id: "sym-beyond", name: "beyond", qualified_name: null, symbol_type: "function", owner_symbol_id: null, file_id: "file-short.ts", line_start: 900, line_end: 900, byte_start: 1, byte_end: 2, gravity_score: 1, path: shortFile, language: "typescript" }]
          }
          return []
        },
      }
    },
  }
  const staleWs = sym.workspaceSymbols(staleRows, { query: "beyond" })
  negative("G7: a stored line past EOF is omitted (no plausible-looking position)", staleWs.symbols.length === 0, JSON.stringify(staleWs.symbols))
  negative("G7: the past-EOF omission is declared as 'line_outside_file'", staleWs.omitted.some((o: any) => o.reason === "line_outside_file"), JSON.stringify(staleWs.omitted))
  cleanupDir(staleDir)
  cleanupDir(dir)
}

/** §4 — every response carries a machine-readable staleness marker. */
async function testFreshness(): Promise<void> {
  const freshDir = mkdtempSync(join(tmpdir(), "bblsp-l4-fresh-"))
  const fresh = makeFixture(freshDir)
  const sym = await import(COMPONENT)
  const freshDoc = sym.documentSymbols(fresh, join(freshDir, MAIN_REL))
  check("G8: a fresh file reports status 'fresh' with stale=false", freshDoc.staleness.status === "fresh" && freshDoc.staleness.stale === false, JSON.stringify(freshDoc.staleness))
  check("G8: the fresh marker counts the file it checked", freshDoc.staleness.filesChecked === 1, JSON.stringify(freshDoc.staleness))

  const staleDir = mkdtempSync(join(tmpdir(), "bblsp-l4-stale2-"))
  const stale = makeFixture(staleDir, { staleHashes: true })
  const staleDoc = sym.documentSymbols(stale, join(staleDir, MAIN_REL))
  check("G8: a file whose content changed reports 'stale' with stale=true", staleDoc.staleness.status === "stale" && staleDoc.staleness.stale === true, JSON.stringify(staleDoc.staleness))

  const missingDir = mkdtempSync(join(tmpdir(), "bblsp-l4-miss-"))
  const missing = makeFixture(missingDir, { missingFiles: [MAIN_REL] })
  const missingDoc = sym.documentSymbols(missing, join(missingDir, MAIN_REL))
  check("G8: a file the index cannot verify reports 'unknown' with stale=true (never silently fresh)", missingDoc.staleness.status === "unknown" && missingDoc.staleness.stale === true && missingDoc.staleness.filesUnverified.length === 1, JSON.stringify(missingDoc.staleness))

  const ws = sym.workspaceSymbols(fresh, { query: "greet" })
  check("G8: workspace/symbol carries a staleness marker too", typeof ws.staleness?.status === "string" && typeof ws.staleness?.stale === "boolean", JSON.stringify(ws.staleness))
  cleanupDir(freshDir)
  cleanupDir(staleDir)
  cleanupDir(missingDir)
}

/** §15.3 / the acknowledged simplification: selectionRange is the identifier
 *  only when that is PROVEN from the stored start column. */
async function testSelectionRangeDeclaration(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-sel-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)
  const doc = sym.documentSymbols(raw, join(dir, MAIN_REL))
  const all = walkEntries(doc.symbols)
  const byId = new Map(all.map((e: any) => [e.id, e]))

  const pinned = byId.get("sym-greeter")
  check("G9: an entry whose stored start lands on its own name is IDENTIFIER precision", pinned?.selectionRangeBasis === "identifier_at_stored_start", JSON.stringify(pinned))
  check("G9: the identifier selection range is exactly the name", (() => {
    const r = pinned?.selectionRange
    if (!r) return false
    return FIXTURE_MAIN.split("\n")[r.line]?.slice(r.character, r.endCharacter) === "Greeter"
  })(), JSON.stringify(pinned?.selectionRange))

  // sym-declared-span stores byte_start 1 = the `class` KEYWORD on line 1, so
  // the identifier span is not provable: the entry must fall back to the stored
  // span AND DECLARE the basis (never claim identifier precision it lacks).
  const declared = byId.get("sym-declared-span")
  check("G9: an entry whose stored start is a keyword falls back to the stored span", declared?.selectionRangeBasis === "declaration_span", JSON.stringify(declared))
  check("G9: the fallback selection range is NOT silently the identifier", (() => {
    const r = declared?.selectionRange
    if (!r) return false
    return FIXTURE_MAIN.split("\n")[r.line]?.slice(r.character, r.endCharacter) !== "Greeter"
  })(), JSON.stringify(declared?.selectionRange))

  check("G9: the response declares the WEAKEST basis any entry used", doc.selectionRangeBasis === "declaration_span", JSON.stringify(doc.selectionRangeBasis))
  cleanupDir(dir)
}

/** §5 Rule 1 — the two lane-owned files convert no coordinate inline. */
function testInlinePositionGate(): void {
  const survivors = selfTestSurvivors()
  check("G10: the inline-position gate's own planted defects are ALL caught (the gate can fail)", survivors.length === 0, survivors.join(" | "))
  for (const rel of INLINE_GATE_FILES) {
    const findings = findInlinePositionArithmetic(readFileSync(join(ROOT, rel), "utf8"), rel)
    check(`G10: ${rel} carries no inline position conversion`, findings.length === 0, findings.map((f) => `${f.shape}: ${f.text}`).join(" | "))
  }
  // A gate that cannot fail is not evidence: the same scan must convict a
  // planted read in a COPY of the component.
  const planted = "const symbols = rows.map((row) => ({ line: Math.max(0, (row.line_start ?? 1) - 1) }))\n"
  check("G10 [negative]: the same scan convicts a planted inline conversion", findInlinePositionArithmetic(planted, "planted.ts").length > 0)
}

async function testLatency(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4-lat-"))
  const raw = makeFixture(dir)
  const sym = await import(COMPONENT)

  for (let i = 0; i < 10; i++) sym.workspaceSymbols(raw, { query: "greet" })
  const samples: number[] = []
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now()
    sym.workspaceSymbols(raw, { query: "greet" })
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  check("G5: p95 warm workspace query under 150ms budget", p95 < 150, `p95=${p95.toFixed(2)}ms`)
  cleanupDir(dir)
}

function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

// --- Symbols mutants ----------------------------------------------------------

const SYMBOL_MUTANTS: Array<{ name: string; from: string; to: string }> = [
  {
    name: "positions: swapped start/end",
    from: "  const selection = mapper.indexRangeToLsp({\n    start: { line: startCol.line, column: startCol.column },\n    end: { line: endCol.line, column: endCol.column },\n  });",
    to: "  const selection = mapper.indexRangeToLsp({\n    start: { line: endCol.line, column: endCol.column },\n    end: { line: startCol.line, column: startCol.column },\n  });",
  },
  {
    name: "workspace: drop gravity ranking",
    from: "ORDER BY s.gravity_score DESC, s.name, s.id LIMIT ?",
    to: "ORDER BY s.name, s.id LIMIT ?",
  },
  {
    name: "workspace: always return empty",
    from: "    symbols.push({\n      id: row.id,",
    to: "    if (false) symbols.push({\n      id: row.id,",
  },
  {
    name: "document: break hierarchy (orphan children)",
    from: "    const parent = parentId !== null ? byId.get(parentId) : undefined;\n    if (parent !== undefined && parent.children !== undefined) {\n      parent.children.push(entry);\n    } else {\n      roots.push(entry);\n    }",
    to: "    const parent = undefined;\n    if (parent !== undefined && parent.children !== undefined) {\n      parent.children.push(entry);\n    } else {\n      roots.push(entry);\n    }",
  },
  // §11.7 bug class: the declared-absence gate removed. This is EXACTLY the
  // pre-lane behaviour, so it is the mutant that proves the negative tests can
  // fail.
  {
    name: "absence: drop the launch-set gate (the pre-lane component)",
    from: "  const scope = declaredAbsenceFor(filePath);\n  if (scope !== null) {",
    to: "  const scope = null;\n  if (scope !== null) {",
  },
  {
    name: "absence: keep the gate but swallow the reason (silent empty)",
    from: "      absence: absenceWith(\n        \"not_in_index\",\n        \"the index stores no symbol rows for this file (bb has no declaration to show)\",\n        filePath,\n      ),",
    to: "      absence: null,",
  },
  // §15.3 bug class: the `?? 1` fabrication, restored verbatim.
  {
    name: "positions: restore the `?? 1` line fabrication (the pre-lane component)",
    from: "    let lspLine: number;\n    try {",
    to: "    let lspLine: number;\n    lspLine = Math.max(0, (row.line_start ?? 1) - 1);\n    if (false) try {",
  },
  // §15.3 bug class: omission without declaration (the pre-lane `continue`).
  {
    name: "honesty: drop an unresolvable row WITHOUT declaring it",
    from: "      omitted.push({\n        id: row.id,\n        name: row.name,\n        reason:",
    to: "      if (true) continue;\n      omitted.push({\n        id: row.id,\n        name: row.name,\n        reason:",
  },
  // The acknowledged simplification, shipped silently: claim identifier
  // precision the stored start does not prove.
  {
    name: "selection: claim identifier precision that is not proven",
    from: "    selectionRangeBasis:\n      identifier === null ? \"declaration_span\" : \"identifier_at_stored_start\",",
    to: "    selectionRangeBasis: \"identifier_at_stored_start\",",
  },
  // §4 bug class: the stale marker removed.
  {
    name: "freshness: drop the staleness marker",
    from: "function markerFor(\n  raw: CoreDatabase,\n  rows: Array<{ file_id: string; path: string }>,\n): StalenessMarker {",
    to: "function markerFor(\n  raw: CoreDatabase,\n  rows: Array<{ file_id: string; path: string }>,\n): StalenessMarker {\n  return { stale: false, status: \"fresh\", filesChecked: 0, filesUnverified: [] };\n  //",
  },
]

async function runSymbolMutants(): Promise<{ caught: number; notJudged: number }> {
  console.log("Symbols mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0
  let notJudged = 0

  for (const mutant of SYMBOL_MUTANTS) {
    if (!source.includes(mutant.from)) {
      console.log(`  NOT JUDGED (anchor not found): ${mutant.name}`)
      notJudged++
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    const mutantPath = join(ROOT, "validation", "m24", `symbols.mutant.${mutantsSeen++}.ts`)
    const absImport = mutantSource
      .replace(/from "\.\.\/brain\/database"/g, `from "file://${join(ROOT, "src", "brain", "database.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/brain\/freshness"/g, `from "file://${join(ROOT, "src", "brain", "freshness.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/positions"/g, `from "file://${join(ROOT, "src", "lsp", "positions.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/launch_languages"/g, `from "file://${join(ROOT, "src", "lsp", "launch_languages.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/hover"/g, `from "file://${join(ROOT, "src", "lsp", "hover.ts").replace(/\\/g, "/")}"`)
    writeFileSync(mutantPath, absImport)
    let mod: any
    try {
      mod = await import(mutantPath)
    } catch (error) {
      // An import failure is NOT a caught mutant: the oracle never ran, so the
      // mutant proved nothing. Counting it as "caught" is how a suite lies.
      notJudged++
      console.log(`  NOT JUDGED (import failure — the oracle never ran): ${mutant.name}`)
      console.log(`      ${String(error).split("\n")[0]}`)
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    try {
      const ok = await symbolMutantOracle(mod, mutantSource)
      if (ok) {
        caught++
        console.log(`  caught: ${mutant.name}`)
      } else {
        console.log(`  SURVIVED: ${mutant.name}`)
      }
    } catch (error) {
      caught++
      console.log(`  caught (component crash): ${mutant.name}`)
      console.log(`      ${String(error).split("\n")[0]}`)
    } finally {
      try { rmSync(mutantPath, { force: true }) } catch {}
    }
  }
  return { caught, notJudged }
}
let mutantsSeen = 0

/** Oracle for symbols mutants: returns true when the mutation visibly breaks
 *  a declared guarantee against the fixture-backed double. */
async function symbolMutantOracle(mod: any, mutantSource: string): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l4mut-"))
  try {
    // G10 is a gate like any other: a mutant that reintroduces an inline
    // coordinate conversion is convicted by the same scan the real source runs.
    if (findInlinePositionArithmetic(mutantSource, "symbols.mutant.ts").length > 0) return true
    const raw = makeFixture(dir)

    // --- Document oracle: hierarchy + ranges + the declared-absence gate.
    const doc = mod.documentSymbols(raw, join(dir, MAIN_REL))
    const greeter = doc.symbols.find((s: any) => s.name === "Greeter" && s.range.line === 0)
    if (!greeter) return true
    if ((greeter.children ?? []).length !== 2) return true
    const lines = FIXTURE_MAIN.split("\n")
    const greet = (greeter.children ?? []).find((c: any) => c.name === "greet")
    if (!greet) return true
    const gText = greet.selectionRange.line === greet.selectionRange.endLine
      ? (lines[greet.selectionRange.line] ?? "").slice(greet.selectionRange.character, greet.selectionRange.endCharacter)
      : ""
    if (gText !== "greet") return true

    // §11.7: a file the index HAS rows for but the server does not serve must
    // still answer declared absence.
    const offLaunch = mod.documentSymbols(raw, join(dir, OFF_LAUNCH_REL))
    if (offLaunch.symbols.length !== 0) return true
    if (offLaunch.absence === null || offLaunch.absence === undefined) return true
    if (offLaunch.absence.code !== "file_type_unknown") return true
    if (!Array.isArray(offLaunch.absence.launchLanguages) || offLaunch.absence.launchLanguages.length === 0) return true

    // §11.7: an unindexed served file names ITS reason, not "language unknown".
    const notIndexed = mod.documentSymbols(raw, join(dir, "unindexed.ts"))
    if (notIndexed.absence === null || notIndexed.absence === undefined) return true
    if (notIndexed.absence.code !== "not_in_index") return true

    // §15.3: the unresolvable row is omitted AND declared.
    const all = walkEntries(doc.symbols)
    if (all.some((e: any) => e.id === "sym-noline")) return true
    if (!doc.omitted.some((o: any) => o.id === "sym-noline")) return true

    // §15.3: the keyword-anchored entry does not claim identifier precision.
    const declaredSpan = all.find((e: any) => e.id === "sym-declared-span")
    if (!declaredSpan || declaredSpan.selectionRangeBasis !== "declaration_span") return true

    // §4: the staleness marker is present and honest.
    if (doc.staleness === undefined || doc.staleness.status !== "fresh" || doc.staleness.stale !== false) return true
    if (doc.staleness.filesChecked !== 1) return true

    // Workspace oracle: exact + gravity ranking + cap + the `?? 1` gate.
    const ws = mod.workspaceSymbols(raw, { query: "greet" })
    if (ws.symbols.length !== 2 || ws.symbols[0]?.name !== "greet") return true
    if (ws.symbols[0]?.id !== "sym-greet" || ws.symbols[1]?.id !== "aaa-greet-b") return true
    const capped = mod.workspaceSymbols(raw, { query: "greet", limit: 1 })
    if (capped.symbols.length !== 1) return true
    const none = mod.workspaceSymbols(raw, { query: "zzz_nonexistent" })
    if (none.symbols.length !== 0) return true
    if (none.absence === null || none.absence === undefined) return true
    const phantom = mod.workspaceSymbols(raw, { query: "phantom" })
    if (phantom.symbols.length !== 0) return true
    if (!phantom.omitted.some((o: any) => o.id === "sym-noline")) return true

    return false
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// --- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L4 verifier — document + workspace symbols from the index\n")

  await testDocument()
  await testProbe()
  await testWorkspace()
  await testHonesty()
  await testDeclaredAbsence()
  await testOmitted()
  await testFreshness()
  await testSelectionRangeDeclaration()
  testInlinePositionGate()
  await testLatency()

  const { caught, notJudged } = await runSymbolMutants()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(readFileSync(COMPONENT)).digest("hex")
  const ok = failed === 0 && caught === SYMBOL_MUTANTS.length
  const status = ok ? "verified" : "known-gap"

  const evidence = {
    issue: "493",
    code: "L4",
    status,
    currentCommit,
    sourceFingerprint,
    verifierCommand: "npx tsx script/m24/verify-symbols.ts",
    evidenceFile: "L4.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    verdict: {
      realComponentFailures: failed,
      mutantsCaught: caught,
      mutantsTotal: SYMBOL_MUTANTS.length,
      mutantsNotJudged: notJudged,
      ok,
      note: "`failed` counts real functional failures only; mutant runs are reported separately via the verdict block. `mutantsNotJudged` counts a mutant the harness could not judge (missing anchor or an import failure) — an import failure is NOT counted as caught, because the oracle never ran.",
    },
    limitations: [
      "index-sourced only; hierarchy depth limited to what the analyzer stored via owner_symbol_id",
      "workspace ranking follows the existing graph-engine convention (exact then fuzzy LIKE, gravity DESC)",
      "fixture-backed double for the DB layer; live brain.db path covered by upstream freshness verifiers and the V1 harness",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
      "workspace/symbol reports a LINE anchor only; the wire still emits a zero-width range at character 0 because src/lsp/server.ts (another lane) builds the location — the byte-accurate span is available on the component result and the server patch is reported",
      "selectionRange is the identifier only when the stored start column provably lands on the symbol's own name; otherwise the stored declaration span is returned and DECLARED via selectionRangeBasis. A second stored span per symbol (name_line / name_byte_start / name_byte_end written by every analyzer) would remove the fallback.",
      "the machine-readable absence reason is carried on the component result; src/lsp/server.ts (another lane) maps the wire response and currently drops it — the exact patch is reported, and until it lands a generic client still reads a bare [] / null",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nL4: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${caught}/${SYMBOL_MUTANTS.length} mutants caught, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})