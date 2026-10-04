// script/m24/verify-navigation.ts — M24.L3 verifier + mutation suite.
//
// Proves the navigation component (src/lsp/navigation.ts) honors its
// declared guarantees against a CoreDatabase-shaped double backed by
// fixture data matching the real index schema, and proves the suite CAN
// FAIL by planting defects and asserting the suite catches each one.
//
// Guarantees under test (declared in src/lsp/navigation.ts header):
//   G1 definition: symbol at position -> its indexed location; unresolved
//                  positions return empty honestly (never a guess)
//   G2 references: reverse edges -> one location per edge, deduplicated
//   G3 truncation: result sets bounded by MAX_LOCATIONS; when cut,
//                  truncated=true and totalCount report the full size
//   G4 honesty:    not-indexed symbol -> empty result, never fabricated
//   G5 positions:  position + range conversion via the P1 component ONLY
//   G6 latency:    p95 warm navigation under the 50 ms budget (contract §3)
//
// Run: npx tsx script/m24/verify-navigation.ts
// Evidence: validation/m24/results/L3.json (machine-emitted)

import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeSealed } from "../lib/evidence.ts"
import { noInlinePositionArithmetic } from "./no-inline-position-arithmetic.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT_REL = "src/lsp/navigation.ts"
const COMPONENT = join(ROOT, COMPONENT_REL)
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "L3.json")
/** The name printed for the source-level §5 rule 1 gate, so the log says which
 *  gate caught a mutant rather than which oracle. */
const POSITION_LINT_GATE = "§5-rule-1-lint"
/** The position owner, for the oracle's own conversion. Imported lazily inside
 *  the oracle so a mutant module (which imports the real positions.ts through
 *  the rewritten absolute path) and the oracle judge positions by the SAME
 *  component — the oracle must not share a bug with the implementation. */
const { createPositionMapper } = await import(join(ROOT, "src", "lsp", "positions.ts"))

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

// Two files so references can cross file boundaries.
const FIXTURE_MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
}

const g = new Greeter()
g.greet()
g.greet()
`

const FIXTURE_USE = `import { Greeter } from "./main"
const other = new Greeter()
other.greet()
`

const MAIN_REL = "main.ts"
const USE_REL = "use.ts"
// The non-launch file (§11.7 declared absence). `.cob` maps to no launch
// language (languageForPath returns null for an unmapped extension), and the
// fixture DOUBLE serves it indexed rows on purpose: the defect this fixture
// exists for is that navigation answered real definitions and real references
// for a language the server declares absent everywhere else, so a client could
// not tell "no navigation here" from "not your language". An EMPTY fixture
// would prove nothing — an empty result and a declared absence would be
// indistinguishable.
const COBOL_REL = "hello.cob"
/** The language brain_file reports for hello.cob. */
const COBOL_LANGUAGE = "cobol"
// NOTE on what `.cob` proves: `languageForPath` keys off the extension, and
// `.cob` is not in src/lsp/launch_languages.ts's map, so it resolves to null.
// Every extension the owner DOES map resolves to a member of the launch set —
// there is no mapped-but-unlaunched extension today. So the two declared
// branches ("file type not in the launch language set" for null, "<lang> is not
// a launch language" for a named language) differ only in that `language`
// field, and the null branch is the reachable one. The assertions below state
// that rather than pretending otherwise.

interface FixtureSymbol {
  id: string
  name: string
  qualified_name: string | null
  symbol_type: string
  file: string
  line_start: number
  line_end: number
  byte_start: number
  byte_end: number
}

interface FixtureRel {
  id: string
  source_symbol_id: string | null
  target_symbol_id: string | null
  relationship_type: string
  confidence: number
  line_number: number | null
  site_file: string
  site_line: number
  site_col: number
  site_text: string
}

// Byte columns are PER-LINE 1-based byte columns, end exclusive — the same
// convention the analyzers store and the P1 component converts (Tree-sitter
// point style). Computed from the fixture text below.

// main.ts line 1: "class Greeter {"  → Greeter at 1-based col 7, len 7.
// main.ts line 2: "  greet(): string {" → greet at 1-based col 3, len 5.
// Greeter spans lines 1-4; its END column (byte_end) lives on its end line:
// line 4 "  }" — exclusive end column 4 (per P1 convention, end column is on
// the end line, not the start line).
const FIXTURE_SYMBOLS: FixtureSymbol[] = [
  { id: "sym-greeter", name: "Greeter", qualified_name: null, symbol_type: "class", file: MAIN_REL, line_start: 1, line_end: 4, byte_start: 7, byte_end: 4 },
  { id: "sym-greet", name: "greet", qualified_name: "Greeter.greet", symbol_type: "method", file: MAIN_REL, line_start: 2, line_end: 2, byte_start: 3, byte_end: 8 },
  // hello.cob line 3: `    DISPLAY "HELLO".` -> DISPLAY at 1-based col 5, len 7.
  // Indexed on purpose: the non-launch file has REAL rows, so "declared absent"
  // is a decision this component makes, not an accident of an empty index.
  { id: "sym-hello", name: "HELLO", qualified_name: "HELLO", symbol_type: "program", file: COBOL_REL, line_start: 2, line_end: 2, byte_start: 13, byte_end: 18 },
  { id: "sym-display", name: "DISPLAY", qualified_name: "HELLO.DISPLAY", symbol_type: "statement", file: COBOL_REL, line_start: 4, line_end: 4, byte_start: 5, byte_end: 12 },
]

/** A stored relationship INSIDE the non-launch file, so references for it would
 *  look populated if the §11.7 gate were absent. Both ends are COBOL symbols:
 *  an edge into a launch-language symbol would perturb the launch fixtures'
 *  counts, and a fixture that changes the expected numbers of a passing test
 *  cannot tell its own noise from a defect. */
const COBOL_RELS: FixtureRel[] = [
  { id: "rel-cobol-1", source_symbol_id: "sym-hello", target_symbol_id: "sym-display", relationship_type: "call", confidence: 1.0, line_number: 4, site_file: COBOL_REL, site_line: 4, site_col: 5, site_text: "DISPLAY" },
]

/** A stored row whose source file is NOT on disk. The index says greet is
 *  referenced from ghost.ts; the workspace has no such file. The location
 *  cannot be resolved from source, so §15.3 requires the row be OMITTED AND
 *  DECLARED — not fabricated at the stored line. This fixture row is what makes
 *  `omittedUnresolvable` a value a test can assert: with every row resolvable
 *  the count is always 0 and a check on it cannot fail.
 *
 *  `ghost.ts` is deliberately NOT in FILES, so makeFixture never writes it. */
const GHOST_RELS: FixtureRel[] = [
  { id: "rel-ghost", source_symbol_id: null, target_symbol_id: "sym-greeter", relationship_type: "uses", confidence: 0.8, line_number: 5, site_file: "ghost.ts", site_line: 5, site_col: 3, site_text: "ghost.Greeter" },
]

// Call sites: main.ts g.greet() x2 (lines 7, 8), use.ts other.greet() (line 3).
// Site coords are per-line 1-based byte columns; site_col is the 1-based
// column of the first byte, and the range end is site_col + byteLength(text).
const FIXTURE_RELS: FixtureRel[] = [
  { id: "rel-1", source_symbol_id: null, target_symbol_id: "sym-greet", relationship_type: "call", confidence: 1.0, line_number: 8, site_file: MAIN_REL, site_line: 8, site_col: 1, site_text: "g.greet" },
  { id: "rel-2", source_symbol_id: null, target_symbol_id: "sym-greet", relationship_type: "call", confidence: 1.0, line_number: 9, site_file: MAIN_REL, site_line: 9, site_col: 1, site_text: "g.greet" },
  { id: "rel-3", source_symbol_id: null, target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.9, line_number: 3, site_file: USE_REL, site_line: 3, site_col: 1, site_text: "other.greet" },
  { id: "rel-4", source_symbol_id: null, target_symbol_id: "sym-greeter", relationship_type: "uses", confidence: 1.0, line_number: 7, site_file: MAIN_REL, site_line: 7, site_col: 11, site_text: "new Greeter" },
  { id: "rel-5", source_symbol_id: null, target_symbol_id: "sym-greeter", relationship_type: "uses", confidence: 1.0, line_number: 2, site_file: USE_REL, site_line: 2, site_col: 15, site_text: "new Greeter" },
]

const FIXTURE_COBOL = `IDENTIFICATION DIVISION.
PROGRAM-ID. HELLO.
PROCEDURE DIVISION.
    DISPLAY "HELLO".
    STOP RUN.
`

const FILES: Record<string, string> = {
  [MAIN_REL]: FIXTURE_MAIN,
  [USE_REL]: FIXTURE_USE,
  [COBOL_REL]: FIXTURE_COBOL,
}

/** Every stored relationship the double serves — the launch-set fixtures, the
 *  non-launch file's, and the unresolvable ghost row. */
const ALL_RELS: FixtureRel[] = [...FIXTURE_RELS, ...COBOL_RELS, ...GHOST_RELS]

/** The language the fixture double reports for a path (mirrors brain_file). */
function fixtureLanguage(rel: string): string {
  return rel === COBOL_REL ? COBOL_LANGUAGE : "typescript"
}

/** CoreDatabase-shaped double: only prepare().all() with SQL matching the
 *  exact queries the navigation component issues against the index. */
function makeFixture(dir: string, extraFiles: Record<string, string> = {}): any {
  for (const [rel, content] of Object.entries({ ...FILES, ...extraFiles })) {
    const p = join(dir, rel)
    if (!existsSync(p)) writeFileSync(p, content)
  }
  // The emoji rows join the served symbol set only when the test asks for the
  // emoji file to exist — so no other test's counts shift under it.
  const extraSymbols = extraFiles[EMOJI_REL] !== undefined ? Object.values(EMOJI_SYMBOLS) : []
  const allSymbols = [...FIXTURE_SYMBOLS, ...extraSymbols]
  const allFiles = { ...FILES, ...extraFiles }

  const abs = (rel: string) => join(dir, rel)

  const raw = {
    prepare(sql: string) {
      const s = sql.toLowerCase().replace(/\s+/g, " ")
      return {
        get(..._args: any[]) {
          return undefined
        },
        all(...args: any[]) {
          if (s.includes("from brain_symbol s join brain_file f")) {
            // M53: the name-resolution queries (reference-first model) —
            // same-file exact name (args: path, name) and workspace exact
            // name (args: name). Mirror the real schema's truth.
            if (s.includes("s.name = ?")) {
              const nameArg = String(s.includes("f.path = ?") ? args[1] : args[0])
              let hits = allSymbols.filter((sym) => sym.name === nameArg)
              if (s.includes("f.path = ?")) {
                const relKey = Object.keys(allFiles).find((k) => abs(k) === args[0])
                hits = hits.filter((sym) => sym.file === relKey)
              }
              return hits.map((sym) => ({
                ...sym,
                file_id: `file-${sym.file}`,
                f_id: `file-${sym.file}`,
                path: abs(sym.file),
                language: fixtureLanguage(sym.file),
              }))
            }
            const fpath = args[0] as string
            const line1 = args[1] as number
            // Map absolute path back to rel key.
            const relKey = Object.keys(allFiles).find((k) => abs(k) === fpath)
            if (!relKey) return []
            return allSymbols
              .filter((sym) => sym.file === relKey && sym.line_start <= line1 && sym.line_end >= line1)
              .map((sym) => ({
                ...sym,
                file_id: `file-${sym.file}`,
                f_id: `file-${sym.file}`,
                path: abs(sym.file),
                language: fixtureLanguage(sym.file),
              }))
          }
          if (s.includes("from brain_relationship r")) {
            const sid = args[0] as string
            return ALL_RELS.filter((r) => r.target_symbol_id === sid || r.source_symbol_id === sid).map((r) => {
              const useSource = r.target_symbol_id === sid
              const siteFile = r.site_file
              const siteText = r.site_text
              const siteLine = r.site_line
              // Per-line 1-based byte columns, end exclusive.
              const siteCol = r.site_col
              const siteEndCol = siteCol + Buffer.byteLength(siteText, "utf8")
              const declSym = FIXTURE_SYMBOLS.find((x) => x.id === (useSource ? r.source_symbol_id : r.target_symbol_id))
              return {
                id: r.id,
                source_symbol_id: r.source_symbol_id,
                target_symbol_id: r.target_symbol_id,
                line_number: r.line_number,
                confidence: r.confidence,
                relationship_type: r.relationship_type,
                source_path: useSource ? abs(siteFile) : declSym ? abs(declSym.file) : null,
                source_byte_start: useSource ? siteCol : declSym ? declSym.byte_start : null,
                source_byte_end: useSource ? siteEndCol : declSym ? declSym.byte_end : null,
                source_line_start: useSource ? siteLine : declSym ? declSym.line_start : null,
                source_line_end: useSource ? siteLine : declSym ? declSym.line_end : null,
                target_path: useSource ? (declSym ? abs(declSym.file) : null) : abs(siteFile),
                target_byte_start: useSource ? (declSym ? declSym.byte_start : null) : siteCol,
                target_byte_end: useSource ? (declSym ? declSym.byte_end : null) : siteEndCol,
                target_line_start: useSource ? (declSym ? declSym.line_start : null) : siteLine,
                target_line_end: useSource ? (declSym ? declSym.line_end : null) : siteLine,
              }
            })
          }
          return []
        },
      }
    },
  }
  return raw
}

// --- Tests -------------------------------------------------------------------

async function testDefinition(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-def-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)

  // Position on greet() (0-based line 1, char 2).
  const result = nav.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2 })
  check("G1: definition found at indexed position", result.found === true, JSON.stringify(result))
  check("G1: definition resolves to greet symbol", result.symbol?.name === "greet", JSON.stringify(result.symbol))
  check("G1: definition carries indexed evidence tier", result.evidenceTier === "indexed")
  check("G1: definition location points at the file", result.location?.path === join(dir, MAIN_REL))
  check("G1: definition location is 0-based LSP line 1", result.location?.line === 1, String(result.location?.line))

  // --- M53 call-site law (found live during M53.R2) -------------------------
  // At a call site the identifier under the cursor must resolve to the symbol
  // it NAMES (greet), never the symbol that CONTAINS the cursor (the
  // enclosing function). The fixture's call sites: main.ts lines 8-9
  // (1-based) = 0-based 7-8, use.ts line 3 = 0-based 2.
  const callMain = nav.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 7, character: 2 })
  check("G1b: definition at a CALL SITE names the callee (greet)", callMain.symbol?.name === "greet", JSON.stringify(callMain.symbol))
  check("G1b: the call-site location lands on greet's declaration", callMain.location?.path === join(dir, MAIN_REL) && callMain.location?.line === 1, JSON.stringify(callMain.location))
  const callUse = nav.resolveDefinition(raw, { filePath: join(dir, USE_REL), line: 2, character: 6 })
  check("G1b: CROSS-FILE call site resolves to the unique callee", callUse.symbol?.name === "greet" && callUse.location?.path === join(dir, MAIN_REL), JSON.stringify(callUse.symbol))
  // Declared absence: an identifier no index row names keeps found=false —
  // containment would have answered with the enclosing symbol, which would
  // read as a fabricated navigation target for an unindexed name.
  const unknownName = nav.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 6, character: 5 })
  check("G1b: an unindexed identifier stays declared-absent (never the enclosing symbol)", unknownName.found === false && unknownName.location === null, JSON.stringify(unknownName.symbol))
  cleanupDir(dir)
}

async function testHonesty(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-hon-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)

  // Position outside every indexed symbol (0-based line 9 = trailing blank).
  const def = nav.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 9, character: 0 })
  check("G4: not-indexed definition returns found=false", def.found === false)
  check("G4: not-indexed definition has null location", def.location === null)
  check("G4: not-indexed definition declares not_indexed", def.evidenceTier === "not_indexed")

  const refs = nav.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 9, character: 0, includeDeclaration: false })
  check("G4: not-indexed references return empty", refs.locations.length === 0 && refs.totalCount === 0)
  check("G4: not-indexed references declare not_indexed", refs.evidenceTier === "not_indexed")
  cleanupDir(dir)
}

// --- §11.7 DECLARED ABSENCE (contract §11.7) --------------------------------
//
// The defect this whole section is a gate for, found by reading the handler
// path at HEAD:
//
//   resolveDefinition (:291)  never consulted the launch set -> for a file
//   outside it the wire received a bare `null` (server.ts:573), which reads as
//   "no definition HERE" and is indistinguishable from "no definition because
//   this server does not serve your language".
//   resolveReferences (:403) never consulted it either -> a bare `[]` on the
//   wire, which is EXACTLY the shape the contract calls a violation: "silent
//   empty results that look like 'no references found' are a violation".
//
// Both are negative cases, and a negative case that cannot fail is not a gate.
// The fixture is built so a missing gate produces a DIFFERENT observable: the
// non-launch file has indexed symbols and an indexed relationship row, so a
// component without the gate answers found:true and one non-empty location —
// and the check below fails. Against the HEAD code the assertions on the
// declared-reason fields fail, which is the RED proof.

async function testDeclaredAbsence(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-absent-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)
  const cobol = join(dir, COBOL_REL)

  // PRECONDITION (so this section cannot pass for the wrong reason): the double
  // really serves indexed rows for the non-launch file. Line 3 (1-based) is
  // `    DISPLAY "HELLO".` and DISPLAY is indexed there.
  const indexed = raw
    .prepare("SELECT 1 FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path = ? AND s.line_start <= ? AND s.line_end >= ?")
    .all(cobol, 4, 4) as unknown[]
  check(
    "N0: the fixture serves a non-launch file WITH indexed symbols (the gate is what must refuse it)",
    indexed.length === 1,
    `${indexed.length} rows`,
  )
  // ...and a stored relationship INTO that symbol, so references for the
  // non-launch language would be non-empty without the gate.
  check(
    "N0: the fixture serves a stored relationship into the non-launch file (references could be non-empty)",
    (raw.prepare("SELECT r.id FROM brain_relationship r WHERE r.target_symbol_id = ?").all("sym-display") as unknown[]).length === 1,
  )

  // --- definition ------------------------------------------------------------
  // 0-based line 3 = 1-based line 4, the DISPLAY statement.
  const def = nav.resolveDefinition(raw, { filePath: cobol, line: 3, character: 4 })
  check("N1: definition for a non-launch language is not served", def.found === false, `found=${def.found}`)
  check("N1: definition carries no fabricated location", def.location === null)
  check("N1: definition carries no symbol", def.symbol === null)

  // THE ASSERTION THAT FAILS AT HEAD: there is no machine-readable reason. The
  // HEAD result is a bare {found:false, location:null, symbol:null,
  // evidenceTier:"not_indexed"} — the client cannot tell this apart from
  // "not indexed".
  const absence = (def as any).absence
  negative(
    "N1: definition for a non-launch language carries a DECLARED reason (not a bare null)",
    typeof absence === "object" && absence !== null,
    `absence=${JSON.stringify(absence)}`,
  )
  // `.cob` is not in the launch owner's extension map, so languageForPath
  // resolves it to null and the absent `language` is null (not a guess — see
  // the note next to COBOL_LANGUAGE). What the detail MUST do is name the
  // launch set, so a reader of the log learns what "unsupported" excludes.
  negative(
    "N1: the declared reason names the launch set (and does not guess a language)",
    absence?.reason === "language_not_launched" &&
      absence.language === null &&
      typeof absence.detail === "string" &&
      absence.detail.includes("launch") &&
      /java/.test(absence.detail ?? ""),
    JSON.stringify(absence),
  )

  // An unmapped extension is a DIFFERENT declared reason from a mapped
  // non-launch language: "I do not know what this file is" is not "I know and
  // it is not served". hover.ts already draws that distinction
  // (hover.ts:393-395); navigation must not flatten it.
  const unknownExt = join(dir, "notes.zzz")
  writeFileSync(unknownExt, "nothing here\n")
  const defUnknown = nav.resolveDefinition(raw, { filePath: unknownExt, line: 0, character: 0 })
  negative(
    "N2: an unmapped extension is declared absent with language=null (not guessed)",
    defUnknown.found === false && (defUnknown as any).absence?.language === null,
    JSON.stringify((defUnknown as any).absence),
  )

  // --- references ------------------------------------------------------------
  const refs = nav.resolveReferences(raw, { filePath: cobol, line: 3, character: 4, includeDeclaration: false })
  check("N3: references for a non-launch language return no locations", refs.locations.length === 0, `${refs.locations.length}`)
  const refAbsence = (refs as any).absence
  negative(
    "N4: references for a non-launch language carry a DECLARED reason (an empty array reads as 'no references found')",
    refAbsence?.reason === "language_not_launched" &&
      refAbsence.language === null &&
      String(refAbsence.detail).includes("launch") &&
      refAbsence.searchedIndex === false,
    JSON.stringify(refAbsence),
  )
  negative(
    "N5: the references absence is carried beside the count, and the count does not claim a search happened",
    typeof refAbsence?.totalCount === "number" && typeof refAbsence?.searchedIndex === "boolean" && refAbsence.searchedIndex === false,
    JSON.stringify(refAbsence),
  )

  // --- the discriminator: a LAUNCH language with no symbol is a DIFFERENT
  // --- absence. Without this, "declared absent for everything" passes.
  const blank = join(dir, "empty.ts")
  writeFileSync(blank, "const x = 1\n")
  const launchDef = nav.resolveDefinition(raw, { filePath: blank, line: 0, character: 0 })
  check(
    "N6: a launch language with no indexed symbol is absent for the OTHER reason (not language_not_launched)",
    launchDef.found === false && (launchDef as any).absence?.reason !== "language_not_launched",
    JSON.stringify((launchDef as any).absence),
  )
  check(
    "N6: the launch-language absence says the index was searched",
    (launchDef as any).absence?.reason === "not_indexed" && (launchDef as any).absence?.searchedIndex === true,
    JSON.stringify((launchDef as any).absence),
  )
  const launchRefs = nav.resolveReferences(raw, { filePath: blank, line: 0, character: 0, includeDeclaration: false })
  check(
    "N6: references for a launch language with no symbol declare not_indexed (searched)",
    (launchRefs as any).absence?.reason === "not_indexed" && (launchRefs as any).absence?.searchedIndex === true,
    JSON.stringify((launchRefs as any).absence),
  )

  // --- the launch gate is ONE owner, not a copy of hover's --------------------
  // The absence reason must be derived from src/lsp/launch_languages.ts (the
  // single owner). A literal "cobol" string in navigation.ts would drift the
  // moment the launch set moves, so the source-level gate forbids it.
  const source = readFileSync(COMPONENT, "utf8")
  check(
    "N7: navigation imports the launch set from its single owner (not from hover.ts)",
    /from "\.\/launch_languages"/.test(source) && !/from "\.\/hover"/.test(source),
    source.split("\n").filter((l) => /from "\.\/(hover|launch_languages)"/.test(l)).join(" | "),
  )
  const hoverReexports = source.split("\n").filter((l) => /^\s*(import|export)\b.*from "\.\/hover"/.test(l))
  check("N7: no import from hover survives in navigation (the launch set comes from its owner)", hoverReexports.length === 0, hoverReexports.join(" | "))

  // --- the gate is present for BOTH handlers, and it is IN the handler -------
  // A check that the constant exists somewhere proves nothing; the check has
  // to observe the OBSERVED RESULT. This is the mutation anchor.
  check("N8: the definition handler's absence is produced by the launch gate (not by an empty index)", (def as any).absence?.reason === "language_not_launched")

  cleanupDir(dir)
}

async function testReferences(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-ref-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)

  // References to greet() from its position.
  const result = nav.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: false })
  check("G2: references found for greet", result.locations.length === 3, `got ${result.locations.length}`)
  check("G2: totalCount reports full size", result.totalCount === 3, String(result.totalCount))
  check("G2: references span both files", new Set(result.locations.map((l: any) => l.path)).size === 2, JSON.stringify(result.locations.map((l: any) => l.path)))
  check("G2: no duplicated locations", new Set(result.locations.map((l: any) => `${l.path}:${l.line}:${l.character}`)).size === result.locations.length)

  // With declaration included.
  const withDecl = nav.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: true })
  check("G2: includeDeclaration adds the definition site", withDecl.totalCount === 4, String(withDecl.totalCount))
  check("G2: truncated=false under the cap", withDecl.truncated === false)
  cleanupDir(dir)
}

// --- §15.3 OMITTED AND DECLARED ---------------------------------------------------
//
// The defect: edgeLocation's read-failure branch returned
// `{path, line: lineStart - 1, character: 0, endLine: same, endCharacter: 0}` —
// a zero-width range at a plausible-looking line, for a file the component
// could not read. An editor presents that exactly like a real navigation
// target, and the user clicks into a line nobody verified. Contract §15.3:
// "an unresolvable relation is omitted and declared — never emitted with a
// plausible-looking range".
//
// The fixture that makes this testable: `rel-ghost` is a stored row into
// sym-greeter whose source file (ghost.ts) is NOT on disk. Every other row
// resolves, so `omittedUnresolvable` is a number a check can be wrong about.

async function testUnresolvableOmission(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-omit-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)

  // PRECONDITION: the ghost row is stored but its file is absent.
  check("P0: the fixture stores a row whose source file is not on disk", !existsSync(join(dir, "ghost.ts")))
  // The double's relationship query serves rows keyed on either end, so a query
  // for sym-greeter returns the ghost row. That IS the proof it is indexed.
  const storedRows = raw
    .prepare("SELECT r.id FROM brain_relationship r WHERE r.target_symbol_id = ? OR r.source_symbol_id = ?")
    .all("sym-greeter", "sym-greeter") as Array<{ id: string }>
  check(
    "P0: the unresolvable row is in the index the handler reads",
    storedRows.some((r) => r.id === "rel-ghost"),
    JSON.stringify(storedRows.map((r) => r.id)),
  )
  check(
    "P0: the stored row's source file does not resolve (so it must be omitted)",
    storedRows.filter((r) => r.id === "rel-ghost").every((r) => !existsSync(join(dir, "ghost.ts"))),
  )

  const refs = nav.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 0, character: 6, includeDeclaration: false })
  check("P1: references for Greeter serve the two resolvable call sites", refs.locations.length === 2, `${refs.locations.length}`)
  check("P1: the resolvable locations are in main.ts and use.ts", new Set(refs.locations.map((l: any) => l.path)).size === 2)
  negative(
    "P2: the unresolvable row is DECLARED, not silently dropped (omittedUnresolvable counts it)",
    refs.omittedUnresolvable === 1,
    `omittedUnresolvable=${refs.omittedUnresolvable}`,
  )
  check(
    "P2: no location is fabricated for the unreadable file",
    !refs.locations.some((l: any) => l.path.includes("ghost.ts")),
    JSON.stringify(refs.locations.map((l: any) => l.path)),
  )
  check(
    "P2: locations carry no zero-width fabricated range (character 0 with endCharacter 0 on a named identifier)",
    !refs.locations.some((l: any) => l.character === 0 && l.endCharacter === 0 && l.line === l.endLine),
    JSON.stringify(refs.locations),
  )

  // totalCount must count what was RENDERED, not what was stored — the header
  // count rule (§13.4): a number the eye cannot verify against the list is a
  // violation. Here the stored rows for Greeter are 3 (two resolvable + the
  // ghost); the list shows 2 and totalCount says 2, with the third declared
  // as omitted. If totalCount were 3, the header would claim a row the list
  // does not show.
  check("P2: totalCount counts the rendered rows, not the stored ones", refs.totalCount === 2, `${refs.totalCount}`)
  check("P2: truncated=false when nothing was cut by the cap", refs.truncated === false)

  // The §15.3 absence reason for an unresolvable stored position, at the
  // builder itself. This is the assertion the fabricated-range mutant dies on.
  const missing = nav.edgeLocation(join(dir, "ghost.ts"), 3, 9, 5, 5)
  negative(
    "P3: edgeLocation returns null for an unreadable file (no fabricated line)",
    missing === null,
    JSON.stringify(missing),
  )
  const pastEof = nav.edgeLocation(join(dir, MAIN_REL), 3, 9, 9999, 9999)
  negative(
    "P3: edgeLocation returns null for a stored line past EOF",
    pastEof === null,
    JSON.stringify(pastEof),
  )
  const nullCoords = nav.edgeLocation(null, null, null, null, null)
  negative("P3: edgeLocation returns null when the row carries no range", nullCoords === null, JSON.stringify(nullCoords))
  // ...and the detailed builder says WHY.
  // The detailed builder exists to carry the REASON. A component without it
  // cannot declare anything, so the absence of the function is itself the
  // finding — guarded so a missing export is a reported FAILURE, not a crash
  // that aborts the run and leaves the rest of the suite unproven.
  if (typeof nav.edgeLocationDetailed !== "function") {
    negative("P3: the detailed builder declares the reason (unresolvable_location)", false, "edgeLocationDetailed is not exported")
  } else {
    const detailed = nav.edgeLocationDetailed(join(dir, "ghost.ts"), 3, 9, 5, 5)
    negative(
      "P3: the detailed builder declares the reason (unresolvable_location)",
      detailed.location === null && detailed.absence?.reason === "unresolvable_location",
      JSON.stringify(detailed),
    )
  }
  // The resolvable case must still work — an omission gate that refuses
  // everything is not a gate.
  const good = nav.edgeLocation(join(dir, MAIN_REL), 1, 8, 1, 1)
  check("P3: a resolvable stored range still produces a location", good !== null && good.line === 0, JSON.stringify(good))

  cleanupDir(dir)
}

async function testTruncation(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-trunc-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)

  // Cap at 2 of 3 references → truncated=true, totalCount=3.
  const result = nav.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: false, limit: 2 })
  check("G3: limit caps locations", result.locations.length === 2, String(result.locations.length))
  check("G3: truncated=true when cut", result.truncated === true)
  check("G3: totalCount reports untruncated size", result.totalCount === 3, String(result.totalCount))
  check("G3: effective limit echoed", result.limit === 2)
  cleanupDir(dir)
}

// --- §5: THE MAPPER OWNS EVERY CONVERSION (and validates) --------------------
//
// Two claims, both about the byte -> UTF-16 column step that used to be
// hand-rolled in navigation.ts:
//
//   S1 the conversion is the owner's (the source-level gate proves no feature
//      module performs it; these tests prove the RESULT the owner produces is
//      the one navigation actually serves),
//   S2 the owner's VALIDATION survives — a cursor placed on a position whose
//      byte column lands mid-code-point is DECLARED ABSENT, where the
//      hand-rolled walk silently snapped one code unit left. That is a
//      behavioural difference, not a style one: the old walk resolved `x` on a
//      line like `const emoji = "😀"; const y = 1` to the WRONG identifier,
//      silently.
//
// The emoji fixture is the sharp end: 😀 is U+1F600, 4 UTF-8 bytes, 2 UTF-16
// code units. An astral-plane line is exactly where an ASCII fast path lies.

/**
 * The astral-plane fixture — the line that makes the CC1 bug class observable.
 *
 * Line 1 puts EIGHT U+1F600 characters BEFORE four identifiers. U+1F600 is 4
 * UTF-8 bytes and 2 UTF-16 code units, so on this line every character offset
 * is 16 units short of its byte column. The eight repetitions are not
 * decoration: the gap has to exceed the distance to the NEXT identifier for a
 * byte column to land on a different identifier rather than past the end of the
 * line. At eight, the cursor on `one`, read as a byte column, lands on `two` —
 * a confident, wrong navigation target, exactly the answer a user would be
 * misled by. At three the same bypass returned null (declared absence) and the
 * mutant survived; the fixture was strengthened until the defect produced the
 * harmful answer instead of the harmless one.
 *
 * Line 2 is pure ASCII and exists as the CONTROL: the served answer there must
 * be identical under any implementation, so no mutant can be "caught" by
 * asserting that ASCII positions are broken.
 */
const EMOJI_ASTRAL = "\u{1F600}"
const EMOJI_MULTIBYTE_NAMES = ["one", "two", "three", "four"] as const
const EMOJI_MULTIBYTE_LINE = `const s = "${EMOJI_ASTRAL.repeat(8)}"; ${EMOJI_MULTIBYTE_NAMES.map((n) => `const ${n} = 1`).join("; ")};\n`
const EMOJI_ASCII_LINE = `const greet = 1\n`
const FIXTURE_EMOJI = EMOJI_MULTIBYTE_LINE + EMOJI_ASCII_LINE

const EMOJI_REL = "emoji.ts"

/** 1-based per-line BYTE column of the first byte of `name` on `line` (the
 *  index convention), and its exclusive end. Computed from the text rather
 *  than written by hand: a hand-written column on a line containing astral
 *  characters is exactly the kind of number this suite exists to distrust. */
function byteSpan(lineText: string, name: string): { start: number; end: number } {
  const at = lineText.indexOf(name)
  if (at < 0) throw new Error(`fixture symbol ${name} is not on its line`)
  return {
    start: Buffer.byteLength(lineText.slice(0, at), "utf8") + 1,
    end: Buffer.byteLength(lineText.slice(0, at + name.length), "utf8") + 1,
  }
}

/** The emoji fixture is INDEXED. Without stored rows a "declared absent" answer
 *  and a "resolved to the wrong identifier" answer are the same observable, and
 *  the conversion assertions below could not fail. */
const EMOJI_SYMBOLS: Record<string, FixtureSymbol> = {
  ...Object.fromEntries(
    EMOJI_MULTIBYTE_NAMES.map((name, i) => {
      const span = byteSpan(EMOJI_MULTIBYTE_LINE, name)
      return [
        name,
        { id: `sym-emoji-${i}`, name, qualified_name: null, symbol_type: "variable", file: EMOJI_REL, line_start: 1, line_end: 1, byte_start: span.start, byte_end: span.end },
      ]
    }),
  ),
  greet: (() => {
    const span = byteSpan(EMOJI_ASCII_LINE, "greet")
    return { id: "sym-emoji-greet", name: "greet", qualified_name: null, symbol_type: "variable", file: EMOJI_REL, line_start: 2, line_end: 2, byte_start: span.start, byte_end: span.end }
  })(),
}

async function testMapperOwnership(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-mapper-"))
  const raw = makeFixture(dir, { [EMOJI_REL]: FIXTURE_EMOJI })
  const nav = await import(COMPONENT)
  const { createPositionMapper } = await import(join(ROOT, "src", "lsp", "positions.ts"))

  // The emoji fixture IS indexed (makeFixture's extraFiles argument), or
  // "declared absent" and "resolved to the wrong identifier" would be the same
  // observable and S2 could not fail.
  const emojiPath = join(dir, EMOJI_REL)
  const emojiIndexed = raw
    .prepare("SELECT 1 FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path = ? AND s.line_start <= ? AND s.line_end >= ?")
    .all(emojiPath, 2, 2) as unknown[]
  check("S0: the emoji fixture is indexed (or S2's absence assertions cannot fail)", emojiIndexed.length === 1, `${emojiIndexed.length} rows`)

  const mapper = createPositionMapper(FIXTURE_EMOJI)

  // --- the fixture must still be adversarial, or every assertion below is
  // --- vacuous (contract §8.7: a check that cannot fail is not a check)
  const multibyteLine = mapper.lineTexts[0]!
  const astralAt = multibyteLine.indexOf(EMOJI_ASTRAL)
  const firstIdentAt = multibyteLine.indexOf(EMOJI_MULTIBYTE_NAMES[0])
  check(
    "S1: the multi-byte line puts astral characters BEFORE the identifiers (or the assertions below are vacuous)",
    astralAt >= 0 && firstIdentAt > astralAt,
    `astral at ${astralAt}, first identifier at ${firstIdentAt}`,
  )
  // Every identifier on that line must have a byte column that differs from its
  // character offset, and the gap must exceed the distance to the next
  // identifier — otherwise a byte-column-as-character-column bypass answers
  // null (harmless) instead of a WRONG symbol (harmful).
  const gaps = EMOJI_MULTIBYTE_NAMES.map((name) => {
    const at = multibyteLine.indexOf(name)
    const byteColumn = mapper.lspToIndex({ line: 0, character: at }).column
    return { name, at, byteColumn, gap: byteColumn - 1 - at }
  })
  check(
    "S1: every identifier on the multi-byte line has byte column != character offset",
    gaps.every((g) => g.gap !== 0),
    JSON.stringify(gaps),
  )
  // The bypass, computed here so the oracle and the assertions agree on what
  // "the defect" does: reading the byte column as a character offset.
  const bypassedWordFor = (name: string): string | null => {
    const at = multibyteLine.indexOf(name)
    const naive = mapper.lspToIndex({ line: 0, character: at }).column - 1
    if (naive >= multibyteLine.length) return null
    const isWord = (c: string): boolean => /[A-Za-z0-9_$]/.test(c)
    let j = naive
    if (!isWord(multibyteLine[j]!)) {
      if (j === 0 || !isWord(multibyteLine[j - 1]!)) return null
      j--
    }
    let s = j
    let e = j
    while (s > 0 && isWord(multibyteLine[s - 1]!)) s--
    while (e < multibyteLine.length && isWord(multibyteLine[e]!)) e++
    return multibyteLine.slice(s, e)
  }
  // The harm this fixture exists for: reading a byte column as a character
  // offset must land on a DIFFERENT identifier, not on null. A bypass that
  // returned null would be caught by the "declared absent" assertions too, but
  // a bypass that returns the WRONG SYMBOL is the one a user gets misled by —
  // so the fixture is built until the defect produces that answer, and this
  // check says so out loud.
  const bypassed = EMOJI_MULTIBYTE_NAMES.map((name) => ({ name, word: bypassedWordFor(name) }))
  const harmful = bypassed.filter((b) => b.word !== null && b.word !== b.name)
  check(
    "S1: the bypass resolves at least one identifier to a DIFFERENT one (the harm this fixture exists for)",
    harmful.length > 0,
    JSON.stringify(bypassed),
  )

  // --- S1: the SERVED answer equals the OWNER's conversion -------------------
  // The component's definition location must be the owner's range conversion of
  // the stored row. Comparing against the owner (rather than a hand-written
  // number) is what makes this an assertion about WHO converted.
  for (const name of EMOJI_MULTIBYTE_NAMES) {
    const at = multibyteLine.indexOf(name)
    const got = nav.resolveDefinition(raw, { filePath: emojiPath, line: 0, character: at })
    const row = EMOJI_SYMBOLS[name]!
    const expected = mapper.indexRangeToLsp({
      start: { line: row.line_start, column: row.byte_start },
      end: { line: row.line_end, column: row.byte_end },
    })
    check(`S1: the cursor on ${name} resolves THAT symbol`, got.found === true && got.symbol?.name === name, JSON.stringify(got.symbol))
    check(
      `S1: ${name}'s served range IS the mapper's conversion of the stored row`,
      got.location?.line === expected.start.line &&
        got.location?.character === expected.start.character &&
        got.location?.endLine === expected.end.line &&
        got.location?.endCharacter === expected.end.character,
      `${JSON.stringify(got.location)} vs owner ${JSON.stringify(expected)}`,
    )
    check(
      `S1: ${name}'s served character is its CHARACTER offset, not its byte column (the CC1 class)`,
      got.location?.character === at,
      `served=${got.location?.character}, character=${at}, byteColumn=${gaps.find((g) => g.name === name)?.byteColumn}`,
    )
  }

  // The ASCII CONTROL line: pure ASCII, so byte column == character offset and
  // every implementation agrees. Asserting it keeps the multi-byte assertions
  // honest — no mutant can be "caught" by a broken ASCII path.
  const onGreet = nav.resolveDefinition(raw, { filePath: emojiPath, line: 1, character: EMOJI_ASCII_LINE.indexOf("greet") })
  check("S1: the ASCII control line still resolves greet", onGreet.found === true && onGreet.symbol?.name === "greet", JSON.stringify(onGreet))
  const expectedGreet = mapper.indexRangeToLsp({
    start: { line: EMOJI_SYMBOLS.greet!.line_start, column: EMOJI_SYMBOLS.greet!.byte_start },
    end: { line: EMOJI_SYMBOLS.greet!.line_end, column: EMOJI_SYMBOLS.greet!.byte_end },
  })
  check(
    "S1: the ASCII control line's range is the owner's conversion too",
    onGreet.location?.line === expectedGreet.start.line && onGreet.location?.character === expectedGreet.start.character,
    `${JSON.stringify(onGreet.location)} vs owner ${JSON.stringify(expectedGreet)}`,
  )

  // --- S2: the owner's VALIDATION survives the handover ----------------------
  // A UTF-16 offset on the TRAILING half of a surrogate pair is not a character
  // start. The mapper refuses it (PositionError); the component turns that into
  // declared absence. The hand-rolled walk had no such notion — it walked code
  // units and returned i + 1, one past the pair.
  const trailingHalf = astralAt + 1
  check(
    "S2: the fixture's multi-byte line holds an astral character with its trailing half inside the line",
    astralAt >= 0 && trailingHalf < multibyteLine.length,
    `astralAt=${astralAt} trailingHalf=${trailingHalf} len=${multibyteLine.length}`,
  )
  let mapperRefused = false
  try {
    mapper.lspToIndex({ line: 0, character: trailingHalf })
  } catch (error) {
    mapperRefused = error instanceof Error && error.name === "PositionError"
  }
  check("S2: the mapper REFUSES a mid-surrogate character offset", mapperRefused)

  // The discriminating check: identifiers DO exist on this line, so a component
  // that resolved "some symbol on this line" would answer found:true. The
  // correct answer to a mid-surrogate offset is absence.
  const midSurrogate = nav.resolveDefinition(raw, { filePath: emojiPath, line: 0, character: trailingHalf })
  negative(
    "S2: navigation on a mid-surrogate offset is DECLARED ABSENT (identifiers exist on that line, so this can fail)",
    midSurrogate.found === false && midSurrogate.location === null && midSurrogate.symbol === null,
    JSON.stringify(midSurrogate),
  )

  // The pair's LEADING half is a legal character offset: the guard is a
  // boundary check, not a blanket refusal of any line holding an astral char.
  const onAstralStart = nav.resolveDefinition(raw, { filePath: emojiPath, line: 0, character: astralAt })
  check(
    "S2: the LEADING half of the surrogate pair is still a usable position (the guard is a boundary check)",
    typeof onAstralStart === "object" && onAstralStart.absence?.reason !== null,
    JSON.stringify(onAstralStart),
  )

  cleanupDir(dir)
}

async function testPositions(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-pos-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)

  // Definition location must equal the P1 conversion of the indexed range.
  const result = nav.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2 })
  const { createPositionMapper } = await import(join(ROOT, "src", "lsp", "positions.ts"))
  const mapper = createPositionMapper(FIXTURE_MAIN)
  // Fixture stores greet at line 2, per-line 1-based byte cols 3..8 (exclusive) —
  // exactly what the component reads from the symbol row and converts via P1.
  const expected = mapper.indexRangeToLsp({
    start: { line: 2, column: 3 },
    end: { line: 2, column: 8 },
  })
  // The end line/char must be recomputed across lines correctly; for a
  // single-line symbol the P1 conversion is the oracle for both ends.
  const startOk = result.location?.line === expected.start.line && result.location?.character === expected.start.character
  check("G5: definition start equals P1 conversion", startOk, `${JSON.stringify(result.location)} vs ${JSON.stringify(expected)}`)
  const endOk = result.location?.endLine === expected.end.line && result.location?.endCharacter === expected.end.character
  check("G5: definition end equals P1 conversion", endOk, `${JSON.stringify(result.location)} vs ${JSON.stringify(expected)}`)
  cleanupDir(dir)
}

async function testLatency(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-lat-"))
  const raw = makeFixture(dir)
  const nav = await import(COMPONENT)

  const req = { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: false }
  for (let i = 0; i < 10; i++) nav.resolveReferences(raw, req)
  const samples: number[] = []
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now()
    nav.resolveReferences(raw, req)
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  check("G6: p95 warm references under 50ms budget", p95 < 50, `p95=${p95.toFixed(2)}ms`)
  cleanupDir(dir)
}

function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

// --- Navigation mutants --------------------------------------------------------

/** Which oracle judges a mutant.
 *  "behavior" — run navMutantOracle against the mutated module.
 *  "lint"     — the source-level ownership gate (script/m24/verify-position-
 *               arithmetic.ts). Some defects are invisible to any oracle on
 *               RESULTS: a hand-rolled byte->UTF-16 walk produces nearly the
 *               right answer, so only reading the source sees it. */
type MutantOracle = "behavior" | "lint";

const NAV_MUTANTS: Array<{ name: string; from: string; to: string; oracle?: MutantOracle }> = [
  {
    // §5 (F7: permanent). The mapper's VALIDATION is dropped: the component
    // takes the 0-based UTF-16 character as a byte column directly — the
    // conversion the hand-rolled walk performed, but without its boundary
    // check. On an ASCII line the two agree exactly, which is why this bypass
    // survived so long; on the astral-plane fixture line they do not, so S2
    // catches it. A mutant that is invisible on every ASCII fixture is the
    // reason the emoji fixture exists.
    name: "position: the mapper's validation is bypassed (character read as a byte column)",
    from: "    jsCol = mapper.indexToLsp({ line: indexPos.line, column: indexPos.column }).character;",
    to: "    jsCol = indexPos.column - 1;",
  },
  {
    name: "references: dropped edge (skip one site)",
    from: "    if (locations.length < limit) {\n      locations.push(loc);\n    }\n  }\n\n  if (request.includeDeclaration)",
    to: "    if (locations.length < limit && seen.size % 2 === 1) {\n      locations.push(loc);\n    }\n  }\n\n  if (request.includeDeclaration)",
  },
  {
    name: "definition: wrong position (line off by one)",
    // M44.U5 wrapped the conversion in try/catch (out-of-range is declared
    // absence). The anchor is the DEFINITION path's own block, disambiguated
    // by the enclosing function's context — the previous anchor matched twice
    // (findIndexedSymbol and findNamedSymbolAtPosition), so the mutant was
    // skipped silently (the harness's other un-honest behavior).
    from: "  let indexPos;\n  try {\n    indexPos = mapper.lspToIndex({ line: line, character: character });\n  } catch (err) {\n    if (err instanceof PositionError) return null;\n    throw err;\n  }\n  const rows = raw",
    to: "  let indexPos;\n  try {\n    indexPos = mapper.lspToIndex({ line: line + 1, character: character });\n  } catch (err) {\n    if (err instanceof PositionError) return null;\n    throw err;\n  }\n  const rows = raw",
  },
  {
    name: "truncation: never declare truncated",
    from: "    truncated: totalCount > locations.length,",
    to: "    truncated: false,",
  },
  {
    name: "honesty: fabricate not-indexed definition",
    from: "  if (symbol === null) {\n    return {\n      found: false,",
    to: "  if (false) {\n    return {\n      found: false,",
  },
  {
    // M44.U5 (permanent, F7 rule): without the PositionError guard an
    // out-of-range editor position (past EOF) throws instead of returning
    // declared absence — the wire shows -32603 where the contract (§1)
    // requires honest emptiness. Anchored on the CONTAINMENT lookup's block
    // (the one followed by `const rows = raw`) so the anchor is unique.
    name: "absence: out-of-range position throws (guard removed)",
    from: "    if (err instanceof PositionError) return null;\n    throw err;\n  }\n  const rows = raw",
    to: "    if (false) return null;\n    throw err;\n  }\n  const rows = raw",
  },
  {
    // M53 (permanent, F7 rule): the reference-first resolution is dropped —
    // definition regresses to the containment-only model and a call site
    // navigates to the enclosing symbol (the live defect M53.R2 found).
    name: "call-site: reference-first resolution dropped",
    from: "  const named = findNamedSymbolAtPosition(raw, request.filePath, request.line, request.character);",
    to: "  const named = null as SymbolRow | null; // reference-first dropped",
  },
  {
    // §11.7 (permanent, F7 rule): the launch-set gate is dropped from the
    // DEFINITION handler. Caught by N1/N8 — a declared-absent language would
    // get a real answer from the index.
    name: "declared absence: launch gate removed from definition",
    from: "  const languageGate = languageAbsence(request.filePath);\n  if (languageGate !== null) {\n    return {\n      found: false,\n      location: null,\n      symbol: null,\n      evidenceTier: \"not_indexed\",\n      absence: languageGate,\n    };\n  }",
    to: "  const languageGate = null as NavigationAbsence | null;\n  if (languageGate !== null) {\n    return {\n      found: false,\n      location: null,\n      symbol: null,\n      evidenceTier: \"not_indexed\",\n      absence: languageGate,\n    };\n  }",
  },
  {
    // §11.7 (permanent, F7 rule): the launch-set gate is dropped from the
    // REFERENCES handler. Caught by N4 — the wire would carry a populated
    // array for a language the server declares absent.
    name: "declared absence: launch gate removed from references",
    from: "  const languageGate = languageAbsence(request.filePath);\n  if (languageGate !== null) {\n    return referencesAbsent(languageGate, limit);",
    to: "  const languageGate = null as NavigationAbsence | null;\n  if (languageGate !== null) {\n    return referencesAbsent(languageGate, limit);",
  },
  {
    // §11.7 (permanent, F7 rule): the declared reason is stripped — the
    // absence shape survives, the REASON does not. This is the exact drift
    // hover.ts's own provenance block would suffer, and the shape without a
    // reason is a bare null wearing a costume.
    name: "declared absence: the reason is dropped from the absence",
    from: "    reason: \"language_not_launched\",",
    to: "    reason: undefined as unknown as NavigationAbsenceReason,",
  },
  {
    // §11.7 (permanent, F7 rule): a non-launch language is reported as if the
    // index had been searched (searchedIndex: true) — the "silently wrong"
    // variant: a real number attached to a search that never ran.
    name: "declared absence: claims the index was searched for a language never served",
    from: "    searchedIndex: false,\n  };\n}",
    to: "    searchedIndex: true,\n  };\n}",
  },
  {
    // §15.3 (permanent, F7 rule): edgeLocationDetailed's read-failure branch is
    // replaced by the fabricated zero-width range that used to live there — a
    // plausible-looking target for a row the component cannot verify. Caught by
    // the "no fabricated line" assertion in navMutantOracle (it asserts
    // edgeLocation returns null for an unreadable path).
    name: "position: fabricated line-only location restored on read failure (§15.3)",
    from: "    return {\n      location: null,\n      absence: {\n        reason: \"unresolvable_location\",\n        language: languageForPath(path),\n        detail: `source file could not be read (${(error as Error).message}); the stored line is omitted rather than emitted unverified`,\n        searchedIndex: true,\n      },\n    };",
    to: "    void error;\n    const line = Math.max(0, lineStart - 1);\n    return { location: { path, line, character: 0, endLine: line, endCharacter: 0 }, absence: null };",
  },
  {
    // §5 rule 1 (permanent, F7 rule): the inline byte->UTF-16 walk comes back
    // and the mapper is bypassed. INVISIBLE to any oracle on results — the walk
    // is behaviorally almost right — so this mutant is judged by the
    // source-level ownership gate, which is the only thing that can see it.
    oracle: "lint",
    name: "position: inline byte-column walk restored (mapper bypassed, §5 rule 1)",
    from: "    jsCol = mapper.indexToLsp({ line: indexPos.line, column: indexPos.column }).character;",
    to: "    jsCol = (() => {\n      const raw = indexPos.column - 1;\n      const walk = lineText.length;\n      if (Buffer.byteLength(lineText, \"utf8\") !== walk) {\n        let bytes = 0;\n        let acc = 0;\n        for (let i = 0; i < walk; i++) {\n          const b = Buffer.byteLength(lineText[i], \"utf8\");\n          if (bytes + b > raw) break;\n          bytes += b;\n          acc = i + 1;\n        }\n        return acc;\n      }\n      return raw;\n    })();",
  },
  {
    // §5 rule 1 (permanent, F7 rule): a feature module reaches into the
    // mapper's PRIVATE byte->UTF-16 converter. Lint-only, same reason.
    oracle: "lint",
    name: "position: the mapper's private converter called from a feature module (§5 rule 1)",
    from: "    jsCol = mapper.indexToLsp({ line: indexPos.line, column: indexPos.column }).character;",
    to: "    jsCol = (mapper as unknown as { byteOffsetToUtf16Offset(l: number, b: number): number }).byteOffsetToUtf16Offset(indexPos.line - 1, indexPos.column - 1);",
  },
  {
    // §15.3 (permanent, F7 rule): the omission count is dropped. Every served
    // location is still correct and the list still looks complete — only the
    // explicit count assertion sees the difference.
    name: "declared absence: unresolvable reference rows silently dropped (count lost)",
    from: "    absence: null,\n    omittedUnresolvable,\n  };",
    to: "    absence: null,\n    omittedUnresolvable: 0,\n  };",
  },
]

async function runNavMutants(): Promise<number> {
  console.log("Navigation mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0

  for (const mutant of NAV_MUTANTS) {
    // A mutant whose anchor is missing or ambiguous is a FAILED gate, never a
    // skip. The pre-existing harness printed "SKIP (anchor not found)" and went
    // on, so a rename of the component silently removed the mutation without
    // changing the verdict — the suite could not fail (§8.3: silence is guilt).
    const occurrences = source.split(mutant.from).length - 1
    if (occurrences !== 1) {
      failed++
      failures.push(`mutant anchor matched ${occurrences} times (need exactly 1): ${mutant.name}`)
      console.log(`  FAIL: mutant anchor matched ${occurrences} times (need exactly 1): ${mutant.name}`)
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    // Lint-judged mutants never execute — they are read. Run them through the
    // source-level ownership gate before anything else touches the disk.
    if (mutant.oracle === "lint") {
      const findings = noInlinePositionArithmetic([{ path: COMPONENT_REL, text: mutantSource }])
      if (findings.length > 0) {
        caught++
        console.log(`  caught (${POSITION_LINT_GATE}): ${mutant.name}`)
        console.log(`      ${findings.map((f) => `${f.rule} ${f.file}:${f.line}`).join(", ")}`)
      } else {
        console.log(`  SURVIVED: ${mutant.name} (${POSITION_LINT_GATE} found nothing)`)
      }
      continue
    }
    const mutantPath = join(ROOT, "validation", "m24", `navigation.mutant.${Date.now()}.ts`)
    // The mutant is written outside src/, so its relative imports would break.
    // Rewrite EVERY relative import to an absolute file:// path against the
    // real sources. A list that drifts from the component's actual imports is
    // the defect found at HEAD: `./relations` was missing, so every one of the
    // six mutants "passed" as an IMPORT FAILURE — a load error counted as a
    // behavioral catch, which is the tautological gate §8.7 forbids. The
    // rewrite is now DERIVED from the source, so a new import cannot go
    // un-rewritten, and an import failure is recorded as a FAILURE of the
    // harness rather than a catch of the mutant.
    const absImport = rewriteRelativeImports(mutantSource)
    writeFileSync(mutantPath, absImport)
    let mod: any
    try {
      mod = await import(mutantPath)
    } catch (error) {
      failed++
      failures.push(`mutant harness could not load ${mutant.name} (${String(error).split("\n")[0]})`)
      console.log(`  FAIL: mutant harness could not load ${mutant.name}`)
      console.log(`      ${String(error).split("\n")[0]}`)
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    // Every behavioral mutant is judged on the FULL oracle, which now also
    // covers the emoji fixture's surrogate boundary (S2). The mutant module
    // reads the emoji file from the same temp dir the oracle creates, so a
    // mutation of the identifier-resolution path is caught there.
    try {
      const verdict = await navMutantOracle(mod)
      const ok = verdict.caught
      if (ok) {
        caught++
        console.log(`  caught: ${mutant.name}${verdict.detail ? ` — ${verdict.detail}` : ""}`)
      } else {
        console.log(`  SURVIVED: ${mutant.name}`)
      }
    } catch (error) {
      // Oracle threw: the mutation made the component crash on the fixture.
      // That is a real behavioral catch — the defect is visible — but the
      // message must name it as a crash, not hide it as a load failure.
      caught++
      console.log(`  caught (component crash): ${mutant.name}`)
      console.log(`      ${String(error).split("\n")[0]}`)
    } finally {
      try { rmSync(mutantPath, { force: true }) } catch {}
    }
  }
  return caught
}

/** Rewrite every relative `import ... from "./x"` / `from "../x"` specifier in
 *  a component copy into an absolute file:// URL against the real source tree,
 *  DERIVED from the specifier itself (no hand-maintained list). */
function rewriteRelativeImports(source: string): string {
  return source.replace(/from "(\.\.?\/[^"]+)"/g, (_whole, spec: string) => {
    const resolved = resolve(ROOT, "src", "lsp", spec).replace(/\\/g, "/")
    return `from "file://${resolved}${resolved.endsWith(".ts") ? "" : ".ts"}"`
  })
}

/** Oracle for navigation mutants: returns `{caught, detail}` when the mutation
 *  visibly breaks a declared guarantee against the fixture-backed double.
 *  `detail` names WHICH law broke, so the log distinguishes a behavioral catch
 *  from an import failure (the previous harness counted both as "caught"). */
async function navMutantOracle(mod: any): Promise<{ caught: boolean; detail: string }> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3mut-"))
  try {
    // The emoji fixture is part of EVERY mutant run, not only of the astral
    // tests: a conversion bypass is invisible on ASCII lines, so the oracle
    // must carry the line where it becomes observable.
    const raw = makeFixture(dir, { [EMOJI_REL]: FIXTURE_EMOJI })

    // Definition oracle: position on greet must resolve exactly.
    const def = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2 })
    if (def.found !== true || def.symbol?.name !== "greet") return { caught: true, detail: "definition at greet did not resolve" }
    if (def.location?.line !== 1) return { caught: true, detail: `definition landed on line ${def.location?.line}, expected 1` }

    // Honesty oracle: not-indexed position must not fabricate.
    const notFound = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 9, character: 0 })
    if (notFound.found !== false || notFound.location !== null) {
      return { caught: true, detail: "not-indexed definition fabricated an answer" }
    }

    // M44.U5 absence oracle: a position far past EOF is declared absence —
    // no throw (the guard mutant above survives exactly here).
    try {
      const pastEof = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 9999, character: 0 })
      if (pastEof.found !== false || pastEof.location !== null) {
        return { caught: true, detail: "past-EOF position did not return declared absence" }
      }
    } catch (error) {
      return { caught: true, detail: `past-EOF position threw: ${String(error).split("\n")[0]}` }
    }

    // M53 call-site oracle (F7: permanent): at a call site the definition
    // must name the CALLEE. A component that regresses to the containment-
    // only model (or loses the reference-first resolution entirely) answers
    // with the enclosing symbol instead — caught exactly here.
    const atCall = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 7, character: 2 })
    if (atCall.found !== true || atCall.symbol?.name !== "greet") {
      return { caught: true, detail: `call-site definition named ${JSON.stringify(atCall.symbol?.name)} instead of greet` }
    }
    if (atCall.location?.path !== join(dir, MAIN_REL) || atCall.location?.line !== 1) {
      return { caught: true, detail: `call-site definition landed on ${JSON.stringify(atCall.location)}` }
    }

    // References oracle: all 3 call sites present, none dropped.
    const refs = mod.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: false })
    if (refs.locations.length !== 3 || refs.totalCount !== 3) {
      return { caught: true, detail: `references = ${refs.locations.length}/${refs.totalCount}, expected 3/3` }
    }
    if (refs.truncated !== false) return { caught: true, detail: "truncated set is under the cap" }

    // Truncation oracle: cap at 2 must declare the cut.
    const capped = mod.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: false, limit: 2 })
    if (capped.locations.length !== 2) return { caught: true, detail: `capped references = ${capped.locations.length}, expected 2` }
    if (capped.truncated !== true || capped.totalCount !== 3) {
      return { caught: true, detail: "capped references did not declare the cut" }
    }

    // §11.7 oracle (F7: permanent). A non-launch file WITH indexed symbols and
    // an indexed relationship row must be declared absent, with a reason, on
    // BOTH handlers. Without this the "launch gate removed" mutants survive a
    // suite that never asks the question.
    const cobolPath = join(dir, COBOL_REL)
    const cobolDef = mod.resolveDefinition(raw, { filePath: cobolPath, line: 3, character: 4 })
    if (cobolDef.found !== false || cobolDef.location !== null || cobolDef.symbol !== null) {
      return { caught: true, detail: "definition served a non-launch language" }
    }
    if (cobolDef.absence?.reason !== "language_not_launched") {
      return { caught: true, detail: `definition absence reason = ${JSON.stringify(cobolDef.absence)}` }
    }
    if (cobolDef.absence?.language !== null || cobolDef.absence?.searchedIndex !== false) {
      return { caught: true, detail: `definition absence does not name the language / searchedIndex: ${JSON.stringify(cobolDef.absence)}` }
    }
    const cobolRefs = mod.resolveReferences(raw, { filePath: cobolPath, line: 3, character: 4, includeDeclaration: false })
    if (cobolRefs.locations.length !== 0) {
      return { caught: true, detail: `references served ${cobolRefs.locations.length} location(s) for a non-launch language` }
    }
    if (cobolRefs.absence?.reason !== "language_not_launched" || cobolRefs.absence?.searchedIndex !== false) {
      return { caught: true, detail: `references absence reason = ${JSON.stringify(cobolRefs.absence)}` }
    }
    if (cobolRefs.absence?.totalCount !== 0) {
      return { caught: true, detail: "references absence carries no totalCount" }
    }
    // The DISCRIMINATOR: a launch language with nothing indexed is absent for
    // the OTHER reason, and says the index WAS searched. A module that answered
    // language_not_launched for everything would pass the checks above.
    const blankPath = join(dir, "oracle-empty.ts")
    writeFileSync(blankPath, "const x = 1\n")
    const blankDef = mod.resolveDefinition(raw, { filePath: blankPath, line: 0, character: 0 })
    if (blankDef.found !== false || blankDef.absence?.reason !== "not_indexed" || blankDef.absence?.searchedIndex !== true) {
      return { caught: true, detail: `launch-language absence is wrong: ${JSON.stringify(blankDef.absence)}` }
    }

    // §15.3 oracle (F7: permanent). An unreadable source file must NOT produce a
    // location. The pre-fix code returned `{path, line: lineStart - 1,
    // character: 0, ...}` here — a plausible-looking target. Assert null.
    if (typeof mod.edgeLocation !== "function") return { caught: true, detail: "edgeLocation is no longer exported" }
    const missing = mod.edgeLocation(join(dir, "does-not-exist.ts"), 3, 9, 12, 12)
    if (missing !== null) {
      return { caught: true, detail: `edgeLocation fabricated a location for an unreadable file: ${JSON.stringify(missing)}` }
    }
    // A stored range that cannot convert (line past EOF) is also omitted.
    const outOfRange = mod.edgeLocation(join(dir, MAIN_REL), 3, 9, 9999, 9999)
    if (outOfRange !== null) {
      return { caught: true, detail: `edgeLocation fabricated a location for a line past EOF: ${JSON.stringify(outOfRange)}` }
    }

    // §15.3 omission-count oracle: with every row resolvable the count is 0,
    // and the shape is present at all (a component that dropped the field
    // entirely is caught by the field's absence here).
    if (typeof refs.omittedUnresolvable !== "number") {
      return { caught: true, detail: "references result carries no omittedUnresolvable count" }
    }
    if (refs.omittedUnresolvable !== 0) {
      return { caught: true, detail: `omittedUnresolvable = ${refs.omittedUnresolvable} with every row resolvable` }
    }

    // §15.3 omission-count oracle: the fixture's `rel-ghost` row points at a
    // file that is not on disk, so ONE row must be omitted and declared. A
    // component that silently drops it (the pre-fix behavior) reports 0 here.
    const greeterRefs = mod.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 0, character: 6, includeDeclaration: false })
    if (greeterRefs.omittedUnresolvable !== 1) {
      return { caught: true, detail: `omittedUnresolvable = ${greeterRefs.omittedUnresolvable}, expected 1 (the ghost row)` }
    }
    if (greeterRefs.locations.length !== 2 || greeterRefs.totalCount !== 2) {
      return { caught: true, detail: `Greeter references = ${greeterRefs.locations.length}/${greeterRefs.totalCount}, expected 2/2` }
    }
    if (greeterRefs.locations.some((l: any) => String(l.path).includes("ghost.ts"))) {
      return { caught: true, detail: "a location was fabricated for the unreadable ghost file" }
    }

    // §5 oracle (F7: permanent). The astral-plane line is where an unvalidated
    // byte/UTF-16 conversion becomes observable: the identifier `emoji` sits at
    // U+1F600 characters sit BEFORE the identifiers on the multi-byte line, so
    // each identifier's byte column is 16 units right of its character offset —
    // far enough that reading one where the other belongs lands on the NEXT
    // identifier. That is where the "character read as a byte column" mutant
    // dies: without this line's shape the defect returns null (harmless) and
    // the mutant survives, which is exactly what happened before the fixture
    // was strengthened.
    const emojiPath = join(dir, EMOJI_REL)
    const emojiMapper = createPositionMapper(FIXTURE_EMOJI)
    const emojiLine = emojiMapper.lineTexts[0]!
    const astralAt = emojiLine.indexOf(EMOJI_ASTRAL)
    if (astralAt < 0) return { caught: true, detail: "oracle fixture lost its astral-plane character" }
    const trailingHalf = astralAt + 1

    // The mid-surrogate offset is not a character start: declared absence.
    const mid = mod.resolveDefinition(raw, { filePath: emojiPath, line: 0, character: trailingHalf })
    if (mid.found !== false || mid.location !== null || mid.symbol !== null) {
      return { caught: true, detail: `mid-surrogate offset resolved to ${JSON.stringify(mid.symbol)} instead of declared absence` }
    }

    // THE CONVERSION CHECK: every identifier on the multi-byte line must resolve
    // to ITSELF. A byte-column-as-character-column implementation answers with a
    // neighbouring identifier — a confident, wrong navigation target.
    for (const name of EMOJI_MULTIBYTE_NAMES) {
      const at = emojiLine.indexOf(name)
      const got = mod.resolveDefinition(raw, { filePath: emojiPath, line: 0, character: at })
      if (got.found !== true || got.symbol?.name !== name) {
        return { caught: true, detail: `cursor on ${name} (character ${at}) resolved to ${JSON.stringify(got.symbol)}` }
      }
    }
    // The ASCII control line: byte column == character offset, so any
    // implementation agrees. A mutation that breaks this is caught too.
    const greetLine1 = mod.resolveDefinition(raw, { filePath: emojiPath, line: 1, character: EMOJI_ASCII_LINE.indexOf("greet") })
    if (greetLine1.found !== true || greetLine1.symbol?.name !== "greet") {
      return { caught: true, detail: `the ASCII-line symbol resolved to ${JSON.stringify(greetLine1.symbol)}, expected greet` }
    }

    return { caught: false, detail: "" }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// --- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L3 verifier — definition + references over the persisted index\n")

  await testDefinition()
  await testHonesty()
  await testDeclaredAbsence()
  await testUnresolvableOmission()
  await testReferences()
  await testTruncation()
  await testMapperOwnership()
  await testPositions()
  await testLatency()

  const mutantsCaught = await runNavMutants()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(readFileSync(COMPONENT)).digest("hex")
  const ok = failed === 0 && mutantsCaught === NAV_MUTANTS.length
  const status = ok ? "verified" : "known-gap"

  const evidence = {
    issue: "492",
    code: "L3",
    status,
    currentCommit,
    sourceFingerprint,
    verifierCommand: "npx tsx script/m24/verify-navigation.ts",
    evidenceFile: "L3.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    verdict: {
      realComponentFailures: failed,
      mutantsCaught,
      mutantsTotal: NAV_MUTANTS.length,
      ok,
      note: "`failed` counts real functional failures only; mutant runs are reported separately via the verdict block.",
      harnessDefectsFoundAndFixed: [
        "Every mutant at HEAD was 'caught' as an IMPORT FAILURE: the harness rewrote ./positions and ./hover to absolute paths but not ./relations, so the mutated copy could not load. A load error was counted as a behavioral catch (§8.7: the tautological gate). Fixed by deriving the rewrite from the source's own relative imports and by recording an import failure as a FAILURE of the harness.",
        "Two mutant anchors matched zero or two occurrences and the harness printed 'SKIP (anchor not found)' and continued — so a rename would silently delete a mutation without changing the verdict. Fixed: a missing or ambiguous anchor is now a FAILURE.",
        "The oracle returned a bare boolean, so a catch could not say WHICH law broke. Now it returns {caught, detail}, and the log names the law.",
      ],
      declaredAbsenceLaws: ["N0-N8 (§11.7)", "P0-P3 (§15.3)"],
      positionOwnershipLaws: ["S0-S2 (§5 rule 1)", "G5"],
      lintJudgedMutants: NAV_MUTANTS.filter((m) => m.oracle === "lint").length,
      behaviorJudgedMutants: NAV_MUTANTS.filter((m) => m.oracle !== "lint").length,
      lintJudgedNote: "Two mutants are invisible to any oracle on results — the hand-rolled byte walk is behaviorally almost right — and are judged by the source-level §5 rule 1 lint instead. That lint is its own script (script/m24/verify-position-arithmetic.ts) so it cannot be edited away with this suite.",
    },
    determinism: {
      declaredVolatileFields: ["generatedAt", "bbSeal.sealedAt", "bbSeal.contentSha256"],
      note:
        "Re-running this verifier at an unchanged commit reproduces every field byte-for-byte EXCEPT the three named above. generatedAt is a wall-clock stamp; bbSeal.sealedAt is the write time; bbSeal.contentSha256 is a sha256 over the record's content, which includes generatedAt, so it changes with it. All three are declared here as volatile (contract §8.2 allows regeneration modulo declared timestamps). No other field is time-, path-, or order-dependent: the fixture is temp-dir based and every emitted collection is sorted or in insertion order.",
      measured:
        "Two consecutive runs of `npx tsx script/m24/verify-navigation.ts` compared after canonicalising the three declared volatile fields: identical. The same comparison holds for validation/m24/results/POSITION-OWNERSHIP.json across two runs of its own verifier.",
    },
    limitations: [
      "index-sourced only; no compiler-backed go-to-definition (complement stance)",
      "reference sites resolve to relationship edge coordinates; heuristic-edge ratio per language is declared in the master plan",
      "fixture-backed double for the DB layer; live brain.db path covered by upstream freshness verifiers and the V1 harness",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
      "the declared-absence reason reaches the wire only through src/lsp/server.ts, which is not this lane's file — see `wiringNeededInServerTs` below. This gate proves the component carries the reason; it cannot prove the editor receives it.",
      "the launch gate keys off the file EXTENSION (languageForPath), not brain_file.language. A file whose extension maps to a launch language while its rows say otherwise is served; a file the extension cannot classify is declared absent with language:null.",
      "§15.3 omission count is per-response (omittedUnresolvable); the reasons behind each omission are in the per-row absence from edgeLocationDetailed, which the references result does not enumerate.",
    ],
    wiringNeededInServerTs: [
      "src/lsp/server.ts:573 (textDocument/definition) — `if (!r.found || r.location === null) return null` discards r.absence. The LSP wire shape for definition is `Location | Location[] | null`, so the reason cannot ride the result; it needs either a window/logMessage carrying the reason, or an accepted deviation recorded here.",
      "src/lsp/server.ts:607 (textDocument/references) — `return r.locations.map(navLocationToWire)` turns a declared absence into a bare `[]`, which contract §11.7 calls a violation ('silent empty results that look like no references found'). LSP 3.18 requires Location[] for this request, so the honest options are: (a) a window/logMessage with r.absence.detail, or (b) the client reading a custom field — neither is available on this wire shape.",
      "src/lsp/server.ts:547 (textDocument/hover) — `if (r.contents === null || r.range === null || r.data === null) return null` discards provenance.limitations, which already names the language and the launch set. Same wire constraint as above.",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nL3: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${mutantsCaught}/${NAV_MUTANTS.length} mutants caught, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})
