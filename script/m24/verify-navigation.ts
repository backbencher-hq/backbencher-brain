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
  /** Null models a symbol the indexer stored WITHOUT a location — a real store
   *  state, and the one that makes the address owner refuse a substitute. */
  line_start: number | null
  line_end: number | null
  byte_start: number | null
  byte_end: number | null
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

/** The aliases the double serves the stored call-site line under, so a mutant
 *  cannot pass by reading a name the fixture happens not to populate. The
 *  production query selects ONE of them (`stored_call_line`); the others are
 *  decoys carrying the identical value. */
const STORED_LINE_ALIASES = ["stored_call_line", "line_number", "lineNumber", "call_line"] as const

// --- §2 CALL-SITE FIXTURE (M62 §2) -----------------------------------------
//
// The fixture that makes the §2 laws observable, and the reason the existing
// fixture cannot make them observable at all.
//
// The shape is chosen so each of the three possible models produces a
// DIFFERENT number, and the number is the proof. One caller function, eight
// stored rows, all targeting `greet`:
//
//   1  function caller() {
//   2    const a = greet()     <- rel-u-a     stored line 2
//   3    const b = greet()     <- rel-u-b     stored line 3
//   4    greet(); greet()      <- rel-u-c AND rel-u-d, BOTH stored line 4
//   5    return a
//   6  }
//
//   - the pre-M62 model (the referencing symbol's DECLARATION, which is what
//     this surface served for every row): all eight rows resolve to caller's
//     line 1, so a position-only dedupe key collapses them to 1 location;
//   - the §2 position with `path:line:rowId` (shipped in wave 2, corrected at
//     the M55.T3 integration): the two line-4 rows become TWO locations at the
//     SAME file/line/character — one per stored row.
//
// THE INTEGRATION CORRECTION, and what this battery now asserts.
//
// Wave 2 read the line-4 pair as "two call sites in one function are two
// usages" and keyed the dedupe on `path:line:rowId`. Measurement on five real,
// populated indexes found that key's ONLY effect was to serve byte-identical
// duplicate locations: 8,285 (818db37d), 2,417 (064be526) and 684 (99c211a1)
// served positions each carrying two or more rows, 99.5% of them two rows of
// DIFFERENT relationship kinds for one caller at one stored line. The store
// cannot produce two rows at one stored line through its primary writer — the
// row id keys on the call-site LINE (src/ast/parallel-indexer.ts:4147,
// INSERT OR IGNORE) — so the honest read of a same-position pair is: ONE
// PLACE the index can put a caret, plus the multiplicity declared.
//
// So the law is ONE LOCATION PER SERVED POSITION, and the rows that share a
// position are COUNTED in `coalescedRows` rather than served twice or dropped
// (§13.2: nothing is merged into silence; §13.1: a symbol appearing several
// times only because it owns several stored rows is a rendering defect).
// Nothing is lost: two call sites on DIFFERENT stored lines are two different
// positions and are still two locations — which is the genuine §13.4 case, and
// `rel-u-a`/`rel-u-b` (stored lines 2 and 3) assert it.
//
// What U2 asserts below is therefore restated: the line-4 pair yields ONE
// location, the pair's second row is DECLARED coalesced, and no two served
// locations share a position.
//
// The source side comes from a REAL JOIN: every row here names a source
// SYMBOL, so the double serves `source_*` from that symbol's own indexed range
// — exactly what `LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id`
// returns. That is what makes "plant the old declaration position" observable:
// with a real join, the declaration line (1) is a DIFFERENT line from every
// stored call-site line, so serving it is visible instead of coincidental.
const CALLSITE_REL = "calls.ts"
const FIXTURE_CALLSITE = `function caller() {
  const a = greet()
  const b = greet()
  greet(); greet()
  return a
}
`

/** `caller`'s indexed declaration. The index convention this repository's
 *  analyzers follow (see the `Greeter` fixture above): `byte_start` is on
 *  `line_start`, and `byte_end` is on `line_END` — a multi-line symbol's end
 *  column belongs to its last line. Line 1 is `function caller() {`, so the
 *  name token starts at 1-based byte column 10 ("function " is 9 bytes); line 6
 *  is `}`, whose exclusive end column is 2. */
const CALLSITE_SYMBOLS: FixtureSymbol[] = [
  { id: "sym-caller", name: "caller", qualified_name: null, symbol_type: "function", file: CALLSITE_REL, line_start: 1, line_end: 6, byte_start: 10, byte_end: 2 },
  // A caller whose declaration the store has NO line for. The address owner
  // refuses to substitute for it, so a row from this symbol with no stored
  // call site has no position at all — the second absent-position reason.
  { id: "sym-orphan", name: "orphan", qualified_name: null, symbol_type: "function", file: "orphan.ts", line_start: null, line_end: null, byte_start: null, byte_end: null },
  // A caller in a file that is NOT on disk (see CALLSITE_NOT_ON_DISK).
  { id: "sym-ghost-caller", name: "ghostCaller", qualified_name: null, symbol_type: "function", file: "ghost.ts", line_start: 2, line_end: 4, byte_start: 10, byte_end: 21 },
]

const ORPHAN_REL = "orphan.ts"
const FIXTURE_ORPHAN = `function orphan() {
  greet()
}
`
/** The §2 fixture's own extra files. `ghost.ts` is NOT among them on purpose:
 *  the stored call-site row in it must be unresolvable against the source. */
const CALLSITE_FILES: Record<string, string> = {
  [CALLSITE_REL]: FIXTURE_CALLSITE,
  [ORPHAN_REL]: FIXTURE_ORPHAN,
}

/** The eight stored rows, each a different fact about the store. */
interface CallSiteRel extends FixtureRel {
  /** Not a column. The declaration line the double will serve as
   *  `ss.line_start` for this row — i.e. the caller's OWN declaration, which
   *  is what the production join returns and the only substitute the address
   *  owner is permitted. It comes from the source SYMBOL now, so this field
   *  only records which symbol the row names. */
  callerSymbol: string
}

const CALLSITE_RELS: CallSiteRel[] = [
  // The four exact call sites. Note rel-u-c and rel-u-d: same stored line, same
  // caller, DIFFERENT rows. This pair is the dedupe regression.
  { id: "rel-u-a", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 1.0, line_number: 2, site_file: CALLSITE_REL, site_line: 2, site_col: 13, site_text: "greet", callerSymbol: "sym-caller" },
  { id: "rel-u-b", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 1.0, line_number: 3, site_file: CALLSITE_REL, site_line: 3, site_col: 13, site_text: "greet", callerSymbol: "sym-caller" },
  { id: "rel-u-c", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.9, line_number: 4, site_file: CALLSITE_REL, site_line: 4, site_col: 3, site_text: "greet", callerSymbol: "sym-caller" },
  { id: "rel-u-d", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.8, line_number: 4, site_file: CALLSITE_REL, site_line: 4, site_col: 12, site_text: "greet", callerSymbol: "sym-caller" },
  // The store's two DECLARED unknown states, with a resolvable caller
  // declaration: the owner substitutes it and says so in the payload.
  { id: "rel-u-legacy", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.7, line_number: 0, site_file: CALLSITE_REL, site_line: 4, site_col: 3, site_text: "greet", callerSymbol: "sym-caller" },
  { id: "rel-u-null", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.6, line_number: null, site_file: CALLSITE_REL, site_line: 4, site_col: 3, site_text: "greet", callerSymbol: "sym-caller" },
  // `unusable` (a negative stored line): the owner REFUSES to substitute, so
  // this row has no position and must be omitted and counted. Serving the
  // declaration here would be the exact dishonesty this lane removed.
  { id: "rel-u-unusable", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.5, line_number: -5, site_file: CALLSITE_REL, site_line: 4, site_col: 3, site_text: "greet", callerSymbol: "sym-caller" },
  // `not-stored` AND no resolvable caller declaration: `unknown` too, with a
  // different note. Two absent positions, two reasons, both counted.
  { id: "rel-u-nostored", source_symbol_id: "sym-orphan", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.4, line_number: null, site_file: ORPHAN_REL, site_line: 2, site_col: 3, site_text: "greet", callerSymbol: "sym-orphan" },
  // A REAL stored line that is PAST THE END of the file it names. The address
  // is exact (the store's line is a positive integer) and §12.1 still forbids
  // serving it: a line 98 rows below a 6-line file is a link nobody can check,
  // and it is exactly what a stale or half-written index produces. Without this
  // row the §12.1 check is VACUOUS — the "line past EOF" mutant would survive,
  // because no fixture row would ever reach that branch.
  { id: "rel-u-past-eof", source_symbol_id: "sym-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.3, line_number: 99, site_file: CALLSITE_REL, site_line: 99, site_col: 1, site_text: "greet", callerSymbol: "sym-caller" },
]

/** A stored call-site line in a file that is not on disk. The store names a
 *  REAL line, so the address is exact — and §12.1 still forbids serving it: a
 *  target nobody can differentially check is a guessed link. Omitted and
 *  counted as UNRESOLVABLE (a different count from the two unpositionable
 *  rows). `ghost.ts` is deliberately absent from FILES. */
const CALLSITE_GHOST_RELS: CallSiteRel[] = [
  { id: "rel-u-ghost", source_symbol_id: "sym-ghost-caller", target_symbol_id: "sym-greet", relationship_type: "call", confidence: 0.35, line_number: 3, site_file: "ghost.ts", site_line: 3, site_col: 3, site_text: "greet", callerSymbol: "sym-ghost-caller" },
]

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
  // emoji file to exist — so no other test's counts shift under it. The same
  // discipline for the §2 call-site rows.
  const extraSymbols: FixtureSymbol[] = []
  const extraRels: CallSiteRel[] = []
  if (extraFiles[EMOJI_REL] !== undefined) extraSymbols.push(...Object.values(EMOJI_SYMBOLS))
  if (extraFiles[CALLSITE_REL] !== undefined) {
    extraSymbols.push(...CALLSITE_SYMBOLS)
    extraRels.push(...CALLSITE_RELS, ...CALLSITE_GHOST_RELS)
  }
  const allSymbols = [...FIXTURE_SYMBOLS, ...extraSymbols]
  const allRels: FixtureRel[] = [...ALL_RELS, ...extraRels]
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
            return allRels.filter((r) => r.target_symbol_id === sid || r.source_symbol_id === sid).map((r) => {
              const useSource = r.target_symbol_id === sid
              const siteFile = r.site_file
              const siteText = r.site_text
              const siteLine = r.site_line
              // Per-line 1-based byte columns, end exclusive.
              const siteCol = r.site_col
              const siteEndCol = siteCol + Buffer.byteLength(siteText, "utf8")
              const declSym = allSymbols.find((x) => x.id === (useSource ? r.source_symbol_id : r.target_symbol_id))
              // THE REAL JOIN SHAPE (M62 §2). When the row names a source
              // SYMBOL, the `source_*` columns are that symbol's own indexed
              // range — what `LEFT JOIN brain_symbol ss ON ss.id =
              // r.source_symbol_id` returns, and what the production query
              // gets. The pre-existing fixture rows name NO source symbol, and
              // for those the double keeps serving the site's own coordinates.
              //
              // DECLARED, because it is a real divergence and a hidden one
              // would be worse: for a row whose `source_symbol_id` is NULL the
              // production LEFT JOIN yields NULL for every `source_*` column,
              // so those rows are UNRESOLVABLE in production, whereas the
              // double hands them a resolvable site range. U0 pins both halves
              // of this: the §2 rows must come from the join, and the
              // pre-existing rows' divergence is asserted, not assumed.
              const joined = useSource ? allSymbols.find((x) => x.id === r.source_symbol_id) ?? null : null
              const sourcePath = joined ? abs(joined.file) : useSource ? abs(siteFile) : declSym ? abs(declSym.file) : null
              const sourceByteStart = joined ? joined.byte_start : useSource ? siteCol : declSym ? declSym.byte_start : null
              const sourceByteEnd = joined ? joined.byte_end : useSource ? siteEndCol : declSym ? declSym.byte_end : null
              const sourceLineStart = joined ? joined.line_start : useSource ? siteLine : declSym ? declSym.line_start : null
              const sourceLineEnd = joined ? joined.line_end : useSource ? siteLine : declSym ? declSym.line_end : null
              return {
                id: r.id,
                source_symbol_id: r.source_symbol_id,
                target_symbol_id: r.target_symbol_id,
                // The stored call-site line, served under EVERY alias in
                // STORED_LINE_ALIASES with the identical value: a mutant that
                // reads any of them is judged against the same store, and none
                // can pass by picking a name the fixture left unpopulated.
                ...Object.fromEntries(STORED_LINE_ALIASES.map((a) => [a, r.line_number])),
                confidence: r.confidence,
                relationship_type: r.relationship_type,
                source_path: sourcePath,
                source_byte_start: sourceByteStart,
                source_byte_end: sourceByteEnd,
                source_line_start: sourceLineStart,
                source_line_end: sourceLineEnd,
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
  // §15.3, RE-STATED for the post-M62 shape. The pre-M62 form of this check was
  // "no location is a zero-width range" — correct then, when a zero-width range
  // could only mean the fabricated `{line: lineStart - 1, character: 0}` this
  // suite was written to kill. M62 §2 makes zero-width the DECLARED shape of an
  // exact call site: the store records a line and no column, so a line-only
  // range is the most the index knows. The lie is not the zero width — it is a
  // zero-width range that does not SAY it is line-only. So the law is now:
  // every zero-width range carries `callSite.kind === "call-site"`, and no
  // zero-width range exists at all for a row the component could not verify.
  // This is a TIGHTER claim than the one it replaces, not a relaxed one.
  const zeroWidth = refs.locations.filter((l: any) => l.character === 0 && l.endCharacter === 0 && l.line === l.endLine)
  check(
    "P2: every zero-width range is an EXACT call site that says so (never an unlabelled or unreadable one)",
    zeroWidth.length > 0 && zeroWidth.every((l: any) => l.callSite?.kind === "call-site"),
    `${zeroWidth.length} zero-width of ${refs.locations.length}; kinds=${JSON.stringify(zeroWidth.map((l: any) => l.callSite?.kind))}`,
  )
  check(
    "P2: no zero-width range exists for a row whose source could not be verified",
    !zeroWidth.some((l: any) => String(l.path).includes("ghost.ts")),
    JSON.stringify(zeroWidth.map((l: any) => String(l.path).replace(dir, ""))),
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

// --- §2 CALL-SITE MIGRATION (contract §15.3) --------------------------------
//
// The defect: pre-M62, `textDocument/references` served the referencing
// symbol's OWN DECLARATION for every reference row. The store records a
// call-site line per row (`brain_relationship.line_number`); the surface read
// the caller symbol's `line_start` instead. The editor's "find references" on
// `greet` landed on `function caller()` — not a fabricated line, but the wrong
// answer to the question asked, and with two call sites inside one function the
// position-only dedupe key collapsed them into a single entry, so the list also
// under-counted what the index held.
//
// Nine assertions, each paired so that no single number can carry it:
//   U0 the fixture is adversarial AND honest (the real join shape, two rows on
//      one line, four store states, one file that is not on disk)
//   U1 positions are where the thing is: the served lines are the STORE's
//      lines, and the caller's declaration line is NOT among them
//   U2 THE DEDUPE REGRESSION: two stored rows on one line stay two locations
//   U3 differential against the STORE, not a recomputation: each served
//      call-site line equals that row's own `line_number`, and the identifier
//      really is on that line of the source
//   U4 the four store states end as four declared outcomes (exact / labelled
//      substitute ×2 / absent ×2), and the two absent ones are COUNTED
//   U5 the omission counters are DISTINCT facts, and no location is fabricated
//      for the file that is not on disk
//   U6 §13.4: the header count equals the rendered rows
//   U7 includeDeclaration labels itself, so a declaration is never presented
//      as a usage
//   U8 §5 + the M62 discipline: the stored column is read ONCE, handed to the
//      owner, and never rendered inline

async function testCallSiteMigration(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3-callsite-"))
  const raw = makeFixture(dir, CALLSITE_FILES)
  const nav = await import(COMPONENT)
  // The SAME owner the component uses. The oracle must not re-derive what the
  // implementation derives (contract §8.7: the oracle must not share a bug with
  // the implementation) — it CALLS the owner.
  const owner = await import(join(ROOT, "src", "intelligence", "graph", "line-address.ts"))
  const callsiteFile = join(dir, CALLSITE_REL)
  const greetAt = { filePath: join(dir, MAIN_REL), line: 1, character: 2 }
  const refs = () => nav.resolveReferences(raw, { ...greetAt, includeDeclaration: false })
  const locsOf = (r: any) => r.locations as any[]
  const rowsFor = (id: string) => CALLSITE_RELS.find((r) => r.id === id)!
  const servedFor = (id: string) => locsOf(refs()).find((l) => l.callSite?.rowId === id)

  // --- U0 PRECONDITIONS. A fixture that cannot make the defect observable
  // --- makes every assertion below vacuous, so the shape is asserted first.
  check("U0: the §2 fixture stores 9 rows into greet", CALLSITE_RELS.length === 9, String(CALLSITE_RELS.length))
  const line4 = CALLSITE_RELS.filter((r) => r.line_number === 4).map((r) => r.id).sort()
  check(
    "U0: two stored rows share stored line 4 — the case the old dedupe key collapses",
    line4.length === 2,
    JSON.stringify(line4),
  )
  check(
    "U0: the four store states are all present (real / legacy 0 / null / unusable)",
    [CALLSITE_RELS.some((r) => r.line_number === 2), CALLSITE_RELS.some((r) => r.line_number === 0), CALLSITE_RELS.some((r) => r.line_number === null), CALLSITE_RELS.some((r) => r.line_number === -5)].every(Boolean),
    JSON.stringify(CALLSITE_RELS.map((r) => `${r.id}:${String(r.line_number)}`)),
  )
  // The ghost file must genuinely be absent, or U5's omission is proving
  // nothing about an unreadable file.
  check("U0: the §2 ghost file is NOT on disk (so its row cannot be verified)", !existsSync(join(dir, "ghost.ts")))
  // HONESTY OF THE FIXTURE, stated as a law: the §2 rows' source side comes
  // from the production join (the caller's own indexed range), NOT from the
  // site coordinates the pre-existing rows use. Without this the §2 tests would
  // pass against a double that hands the surface a position no real join can
  // produce — and the whole defect would be untestable.
  const joinRow = raw
    .prepare("SELECT r.source_path FROM brain_relationship r WHERE r.target_symbol_id = ?")
    .all("sym-greet") as Array<Record<string, unknown>>
  const callerJoin = joinRow.find((r) => r.source_path === callsiteFile)
  check(
    "U0: a §2 row's source side is served from the CALLER SYMBOL's join (the production shape), not the site coordinates",
    callerJoin !== undefined,
    JSON.stringify(joinRow.map((r) => String(r.source_path).replace(dir, ""))),
  )
  check(
    "U0: the caller's joined declaration line is 1 — DIFFERENT from every stored call-site line, so serving it is observable",
    CALLSITE_SYMBOLS[0]!.line_start === 1 && CALLSITE_RELS.filter((r) => r.line_number !== null && r.line_number > 0).every((r) => r.line_number !== 1),
    `caller.line_start=${String(CALLSITE_SYMBOLS[0]!.line_start)}`,
  )

  const all = refs()
  /** The §2 rows only. The pre-existing fixture rows are ALSO served as exact
   *  call sites after §2 (their stored lines are real too), so every §2
   *  assertion is scoped to `rel-u-*` — otherwise it would be judging rows it
   *  does not own, and its counts would silently drift when the pre-existing
   *  fixture changes. */
  const isU = (l: any) => typeof l.callSite?.rowId === "string" && l.callSite.rowId.startsWith("rel-u-")
  const uLocs = locsOf(all).filter(isU)

  // Declared before U1 so the "is not vacuous" guards can name it: the stored
  // rows the owner says are exact, and the exact call sites served FOR THIS
  // FIXTURE. Both are computed from the OWNER / the rows, never from the
  // component's own answer.
  const exact = CALLSITE_RELS.filter(
    (r) =>
      owner.isExactAddress(owner.deriveCallSiteAddress({ storedLine: r.line_number, file: CALLSITE_REL, callerDeclaration: { line: CALLSITE_SYMBOLS[0]!.line_start } })) &&
      !(NOT_SERVEABLE_BY_DESIGN as readonly string[]).includes(r.id),
  )
  const servedExact = uLocs.filter((l) => l.callSite?.kind === "call-site")

  // --- U1 §15.3: POSITIONS ARE WHERE THE THING IS
  const servedLines = servedExact.map((l) => l.line).sort((a, b) => a - b)
  check(
    "U1: the exact rows are served at the STORE's DISTINCT call-site lines (1-based 2,3,4 -> 0-based 1,2,3; the two rows on line 4 share one position)",
    servedLines.join(",") === "1,2,3",
    `served 0-based lines=${JSON.stringify(servedLines)}`,
  )
  // The row count and the location count are DIFFERENT facts and both are on
  // the payload: four stored rows carry a real call site; three of them name
  // distinct positions. Asserting the DISTINCT lines here and the coalesced
  // count at U2 is what keeps the pair from being quietly dropped (the §13.2
  // duty) without being double-served (§13.1's duty).
  check(
    "U1: the store holds FOUR rows with a real call-site line, naming THREE distinct lines, and exactly those three are served",
    exact.length === 4 && servedExact.length === 3,
    `stored exact rows=${exact.length} served locations=${servedExact.length} (the shared row's accounting is asserted by U2/U5)`,
  )
  // The declaration law, stated as it actually holds: a row with a REAL stored
  // line is never served at the caller's declaration. (A row with no stored
  // line IS served there — as a labelled `declaration` substitute, which U4
  // checks. The distinction is the whole point of §2.)
  // The regression this law exists for: before the call-site migration every row
  // was served at the caller's declaration, so all four exact rows landed on
  // 0-based line 0. The law is that NO exact row is served there, and that the
  // three DISTINCT store lines are the served positions. The fourth row shares a
  // position with the third — its accounting is U2's and U5's, stated there so
  // one assertion does not carry two facts.
  check(
    "U1: no row with a real stored call-site line is served at the caller's DECLARATION line (0-based 0) — positions are where the thing is",
    servedExact.every((l) => l.line !== 0) && servedExact.length === 3 && exact.every((r) => r.line_number !== CALLSITE_SYMBOLS[0]!.line_start),
    `${servedExact.length} exact locations served at lines ${JSON.stringify(servedExact.map((l) => l.line).sort())}; ${exact.length} stored exact rows; none at the caller's declaration line ${CALLSITE_SYMBOLS[0]!.line_start - 1}`,
  )
  check(
    "U1: every served §2 location is inside the caller's OWN file (no row is served at some other file's line)",
    uLocs.every((l) => String(l.path) === callsiteFile),
    JSON.stringify(uLocs.map((l) => String(l.path).replace(dir, ""))),
  )

  // --- U2 THE DEDUPE LAW, restated on the evidence (see the fixture note above)
  const onLine4 = uLocs.filter((l) => l.callSite?.kind === "call-site" && l.line === 3)
  check(
    "U2: the two stored rows on line 4 produce ONE location, not two identical ones (§13.1 — the eye cannot tell them apart)",
    onLine4.length === 1,
    `${onLine4.length} location(s) on 0-based line 3; rows ${JSON.stringify(line4)}`,
  )
  check(
    "U2: exactly one of the two line-4 rows is served and the other is DECLARED coalesced (§13.2 — not merged into silence)",
    line4.filter((id) => servedFor(id) !== undefined).length === 1 && all.coalescedRows >= 1,
    `served on line 4: ${JSON.stringify(line4.filter((id) => servedFor(id) !== undefined))}; coalescedRows=${String(all.coalescedRows)} (the fixture's TOTAL, which also covers the substitution pair — U5 asserts the exact total)`,
  )
  check(
    "U2: no two served locations share a file/line/character (the defect the rowId key shipped)",
    new Set(locsOf(all).map((l) => `${l.path}:${l.line}:${l.character}`)).size === locsOf(all).length,
    JSON.stringify(locsOf(all).map((l) => [String(l.path).replace(dir, ""), l.line, l.character, l.callSite?.rowId])),
  )
  // The genuine §13.4 case is NOT lost by the position key: two call sites on
  // DIFFERENT stored lines are two different positions. rel-u-a (line 2) and
  // rel-u-b (line 3) are that pair, and they must both be served.
  check(
    "U2: two call sites on two DIFFERENT stored lines remain TWO locations (§13.4 survives the position key)",
    servedFor("rel-u-a")?.line === 1 && servedFor("rel-u-b")?.line === 2,
    JSON.stringify(["rel-u-a", "rel-u-b"].map((id) => [id, servedFor(id)?.line])),
  )
  // Every stored row with a real call-site line is either served or counted as
  // coalesced — the §13.2 account, closed over the rows the owner calls exact.
  const exactServedIds = new Set(servedExact.map((l) => l.callSite?.rowId))
  check(
    "U2: every stored row with a real call-site line is served or declared coalesced, and none is duplicated",
    servedExact.length === 3 &&
      new Set(servedExact.map((l) => l.callSite?.rowId)).size === servedExact.length &&
      exact.filter((r) => !exactServedIds.has(r.id)).length === 1,
    `${servedExact.length} served locations from ${exact.length} stored exact rows; ids=${JSON.stringify(servedExact.map((l) => l.callSite?.rowId).sort())}`,
  )

  // --- U3 DIFFERENTIAL against the store, plus a check against the SOURCE.
  // Asserting equality with a recomputation of the same formula would pass for
  // any plausible position; asserting it against the ROW and then reading the
  // bytes at the served line proves the line is where the call site is.
  let diffFail = 0
  let diffDetail = ""
  for (const rel of CALLSITE_RELS) {
    const expected = owner.deriveCallSiteAddress({
      storedLine: rel.line_number,
      file: CALLSITE_REL,
      callerDeclaration: { line: CALLSITE_SYMBOLS[0]!.line_start },
    })
    const served = servedFor(rel.id)?.callSite
    if (!owner.isExactAddress(expected)) continue
    if ((NOT_SERVEABLE_BY_DESIGN as readonly string[]).includes(rel.id)) {
      // The store names a real line the source cannot confirm. §12.1 forbids
      // serving it, so it is asserted the OTHER way round, and asserted here so
      // this loop cannot pass by skipping it.
      if (served !== undefined) {
        diffFail++
        diffDetail = `${rel.id}: served at line ${served.line} although the source cannot confirm it`
      }
      continue
    }
    // A row whose position ANOTHER exact row already occupies is not "not
    // served at all": its place IS served, and the payload says how many stored
    // rows share it (`coalescedRows`). Treating that as absence would assert the
    // §13.1 defect instead of the §13.2 account — U2 asserts the count that makes
    // this acceptance honest, so the acceptance cannot hide a dropped row.
    if (served === undefined) {
      const sharesAPositionWithAnotherExactRow = exact.some((other) => other.id !== rel.id && other.line_number === rel.line_number)
      if (!sharesAPositionWithAnotherExactRow) {
        diffFail++
        if (diffDetail === "") diffDetail = `${rel.id}: not served at all (owner says ${expected.kind}, and no other exact row holds its position)`
      }
      continue
    }
    // KIND and LINE are the owner's verdict, compared as-is. `file` is
    // compared separately below because this surface DELIBERATELY serves an
    // absolute path (it hands the editor absolute paths and holds no project
    // root to relativise against), which is a declared divergence from the
    // owner's RELATIVE-path convention — asserted here rather than smuggled in.
    if (served.line !== expected.line || served.kind !== expected.kind) {
      diffFail++
      if (diffDetail === "") diffDetail = `${rel.id}: served ${JSON.stringify(served)} vs owner ${JSON.stringify(expected)}`
    }
    if (served.file !== join(dir, CALLSITE_REL)) {
      diffFail++
      if (diffDetail === "") diffDetail = `${rel.id}: address file ${JSON.stringify(served.file)} is not this surface's own location path ${JSON.stringify(callsiteFile)}`
    }
    // The stored line, verified against the SOURCE TEXT: the identifier the
    // row is about really is on that line of the file. This is the §12.1
    // differential — not "the number is arithmetically right" but "the file says
    // so".
    const text = readFileSync(callsiteFile, "utf8").split("\n")[served.line - 1] ?? ""
    if (!text.includes("greet")) {
      diffFail++
      if (diffDetail === "") diffDetail = `${rel.id}: line ${served.line} of calls.ts does not mention greet — ${JSON.stringify(text)}`
    }
  }
  check("U3: each served call site EQUALS the store's line for that row, on this surface's own path, and the source confirms the line", diffFail === 0, `${diffFail} mismatch(es); ${diffDetail}`)

  // --- U4 the four store states end as four declared outcomes
  const legacy = servedFor("rel-u-legacy")?.callSite
  check(
    "U4: a legacy stored 0 yields the DECLARATION substitute, with the OWNER's substitute note",
    legacy?.kind === "declaration" && legacy?.note === owner.ADDRESS_NOTES.substitute && legacy?.line === 1,
    JSON.stringify(legacy),
  )
  const nullLine = servedFor("rel-u-null")?.callSite
  // `rel-u-legacy` (stored 0) and `rel-u-null` (stored NULL) are BOTH declared
  // unknown states, so BOTH take the caller's declaration as their substitute —
  // which is the SAME file/line/character. Under the position law that is one
  // place served once and one row declared coalesced, and the substituted
  // declaration's DIFFERENT stored columns (the legacy check above asserts the
  // range) mean the two rows do not even have identical ranges. Asserting both
  // are served at their own positions would assert two locations at one caret
  // position; asserting neither is served would assert a dropped row.
  check(
    "U4: a NULL stored line takes the DECLARATION substitute too (both are the store's DECLARED unknown states), and shares the legacy row's one position",
    nullLine === undefined &&
      legacy?.kind === "declaration" &&
      legacy?.note === owner.ADDRESS_NOTES.substitute &&
      servedFor("rel-u-legacy")?.line === 0 &&
      servedFor("rel-u-legacy")?.character === 9,
    `rel-u-null served=${JSON.stringify(nullLine)}; rel-u-legacy served at ${JSON.stringify([servedFor("rel-u-legacy")?.line, servedFor("rel-u-legacy")?.character])}`,
  )
  check(
    "U4: the second of the two substitution rows is DECLARED coalesced — the account covers the substitute branch as well as the exact branch",
    all.coalescedRows === 2,
    `coalescedRows=${String(all.coalescedRows)}, expected 2 (one exact pair + one substitution pair on the caller's declaration)`,
  )
  check(
    "U4: the substitute's note NEGATES the call-site claim in words, so a reader of the rendered string is not misled either",
    typeof legacy?.note === "string" && /not the call site/i.test(legacy.note),
    JSON.stringify(legacy),
  )
  // A substituted declaration keeps the caller's OWN stored columns, so the two
  // kinds are distinguishable ON THE WIRE and not collapsed into one shape. The
  // differential is against the index's own byte column: column 10 on line 1 is
  // UTF-16 character 9, and that is where the range must start.
  const legacyLoc = servedFor("rel-u-legacy")
  check(
    "U4: the substituted declaration starts at the CALLER's own stored name token (index byte column 10 -> character 9), not on the call site's line",
    legacyLoc !== undefined && legacyLoc.line === 0 && legacyLoc.character === 9 && legacyLoc.endLine === 5,
    JSON.stringify(legacyLoc),
  )
  // `unusable` (negative line) and `not-stored` + no resolvable declaration have
  // NO position. They must not appear as locations at all.
  check("U4: an UNUSABLE stored line produces NO location (the owner never substitutes for one)", servedFor("rel-u-unusable") === undefined, JSON.stringify(servedFor("rel-u-unusable")))
  check("U4: a NULL stored line with no resolvable caller declaration produces NO location", servedFor("rel-u-nostored") === undefined, JSON.stringify(servedFor("rel-u-nostored")))
  negative(
    "U4: those two absent rows are COUNTED, not silently dropped (omittedUnpositionable)",
    all.omittedUnpositionable === 2,
    `omittedUnpositionable=${String(all.omittedUnpositionable)}, expected 2`,
  )

  // --- U5 the two omission counters are DISTINCT facts, and nothing is invented
  check(
    "U5: the rows the store names but the source does not confirm count as UNRESOLVABLE — a different fact from 'the store names no position'",
    all.omittedUnresolvable === 2 && all.omittedUnpositionable === 2,
    `unresolvable=${all.omittedUnresolvable} (expected 2: the file not on disk + the line past EOF) unpositionable=${String(all.omittedUnpositionable)} (expected 2)`,
  )
  // §13.2's "nothing is merged into silence" needs its own counter check: a
  // payload that serves the right places and never says a stored row shares one
  // of them has told the client something false by omission. The M55.T3
  // integration's M6 mutant plants exactly this.
  check(
    "U5: the coalesced-row counter is PRESENT, is a number, and counts both shared positions (a dropped field is the §13.2 defect)",
    typeof all.coalescedRows === "number" && all.coalescedRows === 2,
    `coalescedRows=${String(all.coalescedRows)} (expected 2: one exact pair on line 4 + one substitution pair on the caller's declaration)`,
  )
  check(
    "U5: a REAL stored line that is past the end of its file is omitted, not served — §12.1 makes an unverifiable target a guessed link",
    servedFor("rel-u-past-eof") === undefined,
    JSON.stringify(servedFor("rel-u-past-eof")),
  )
  check(
    "U5: no location was fabricated for the file that is not on disk",
    !locsOf(all).some((l) => String(l.path).includes("ghost.ts")),
    JSON.stringify(locsOf(all).map((l) => String(l.path).replace(dir, ""))),
  )
  // Every §2 row that was stored is accounted for: served, coalesced onto a
  // served position, or omitted-and-counted. Nothing disappears between the
  // index and the payload without appearing in one of the three counters — the
  // §11.7 discipline applied to the reference loop. The account is CLOSED over
  // the stored row count, which is what makes it a check rather than a tally.
  check(
    "U5: every stored §2 row is served, coalesced, or omitted-and-counted — the account is CLOSED (nothing is dropped between the index and the payload)",
    servedExact.length + (uLocs.filter((l) => l.callSite?.kind === "declaration").length) + all.coalescedRows + all.omittedUnresolvable + all.omittedUnpositionable === CALLSITE_RELS.length + CALLSITE_GHOST_RELS.length,
    `served exact=${servedExact.length} served substitutes=${uLocs.filter((l) => l.callSite?.kind === "declaration").length} coalesced=${String(all.coalescedRows)} unresolvable=${all.omittedUnresolvable} unpositionable=${String(all.omittedUnpositionable)} = ${servedExact.length + (uLocs.filter((l) => l.callSite?.kind === "declaration").length) + all.coalescedRows + all.omittedUnresolvable + all.omittedUnpositionable}, of ${CALLSITE_RELS.length + CALLSITE_GHOST_RELS.length} stored §2 rows`,
  )
  check(
    "U5: a served §2 location on line 0 is ALWAYS labelled a declaration — a call-site row is never clamped to the first line",
    uLocs.filter((l) => l.line === 0).every((l) => l.callSite?.kind === "declaration") && uLocs.every((l) => l.line >= 0),
    JSON.stringify(uLocs.map((l) => [l.line, l.callSite?.kind])),
  )
  // A call-site range is LINE-ONLY, and that is declared rather than accidental.
  check(
    "U5: an exact call site is a zero-width range — the store carries a line, never a column, and the payload says so",
    servedExact.length > 0 && servedExact.every((l) => l.character === 0 && l.endCharacter === 0 && l.line === l.endLine),
    `servedExact=${servedExact.length}; ${JSON.stringify(servedExact.map((l) => [l.line, l.character, l.endCharacter]))}`,
  )

  // --- U6 §13.4 COUNTS EQUAL WHAT IS RENDERED
  check("U6: totalCount equals the rendered rows", all.totalCount === all.locations.length, `totalCount=${all.totalCount} locations=${all.locations.length}`)
  check("U6: truncated=false under the cap", all.truncated === false)
  check(
    "U6: every served location carries a callSite — a client never has to infer the kind from a line number",
    locsOf(all).every((l) => typeof l.callSite?.kind === "string" && typeof l.callSite?.rowId === "string"),
    JSON.stringify(locsOf(all).map((l) => l.callSite)),
  )

  // --- U7 includeDeclaration labels ITSELF (§15.2: identity is stated)
  const withDecl = nav.resolveReferences(raw, { ...greetAt, includeDeclaration: true })
  const declEntry = (withDecl.locations as any[]).find((l) => l.callSite?.rowId?.startsWith("declaration:"))
  check(
    "U7: the includeDeclaration entry carries a DECLARATION address, so it can never be presented as a usage",
    declEntry?.callSite?.kind === "declaration" && declEntry.line === 1 && String(declEntry.path) === join(dir, MAIN_REL),
    JSON.stringify((withDecl.locations as any[]).filter((l) => l.callSite?.rowId?.startsWith("declaration:")).map((l) => [l.path, l.line, l.callSite])),
  )
  check(
    "U7: the includeDeclaration note does not claim to be a call site, and does not reuse the substitute note (which would misdescribe it)",
    typeof declEntry?.callSite?.note === "string" &&
      declEntry.callSite.note.length > 0 &&
      declEntry.callSite.note !== owner.ADDRESS_NOTES.substitute &&
      !/call site/i.test(declEntry.callSite.note),
    JSON.stringify(declEntry?.callSite),
  )
  check(
    "U7: includeDeclaration adds exactly one entry over the plain result",
    withDecl.totalCount === all.totalCount + 1,
    `${withDecl.totalCount} vs ${all.totalCount}`,
  )

  // --- U8 §5 + the M62 discipline on the stored column
  const source = readFileSync(COMPONENT, "utf8")
  check(
    "U8: navigation imports the ONE address owner and uses all three of its entry points",
    /from "\.\.\/intelligence\/graph\/line-address"/.test(source) &&
      /deriveCallSiteAddress\(/.test(source) &&
      /addressLine0\(/.test(source) &&
      /isExactAddress\(/.test(source),
    source.split("\n").filter((l) => /line-address|deriveCallSiteAddress|addressLine0|isExactAddress/.test(l)).join(" | "),
  )
  check(
    "U8: the stored column appears in navigation.ts EXACTLY ONCE, as the hand-off to the owner (zero would mean the surface cannot reach a call site; two would mean the read is not confined to the hand-off)",
    countColumnLiterals(source) === 1,
    `${countColumnLiterals(source)} occurrence(s) of the column name in code`,
  )
  check(
    "U8: the stored column is never rendered into a location field directly (no `line:` assigned from the row's own column)",
    !/line:\s*[^,\n]*stored_call_line/.test(source),
    source.split("\n").filter((l) => /line:\s*[^,\n]*stored_call_line/.test(l)).join(" | "),
  )

  cleanupDir(dir)
}

/** The §2 rows the fixture DELIBERATELY makes unserveable, with the reason for
 *  each. Declared rather than discovered, because an expectation must never be
 *  whatever the component happens to do. `rel-u-past-eof` carries a REAL stored
 *  line (the address owner calls it exact) that the SOURCE refuses: line 99 of a
 *  six-line file. That is the §12.1 case — a link nobody can differentially
 *  check — and it is why "exact" below is not simply "every row the owner calls
 *  exact". */
const NOT_SERVEABLE_BY_DESIGN = ["rel-u-past-eof"] as const

/** How many times navigation.ts names the store's call-site column in CODE (not
 *  in prose). Zero would mean the surface cannot reach a call site at all; more
 *  than one means the read is not confined to the hand-off to the owner. */
function countColumnLiterals(source: string): number {
  let n = 0
  source.split("\n").forEach((line) => {
    const t = line.trim()
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return
    if (/\bline_number\b|\blineNumber\b/.test(line)) n++
  })
  return n
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
type MutantOracle = "behavior" | "lint"

/** Per-run mutant judging counters. These exist so the evidence can state what
 *  each catch actually PROVED rather than asserting it — see
 *  `verdict.mutantsNotJudged` in the emitted record. */
let lintCaught = 0
let crashCaught = 0;

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
    // §15.3 (permanent, F7 rule): an omission count is dropped. Every served
    // location is still correct and the list still looks complete — only the
    // explicit count assertion sees the difference.
    name: "declared absence: unresolvable reference rows silently dropped (count lost)",
    from: "    absence: null,\n    omittedUnresolvable,\n    omittedUnpositionable,\n    coalescedRows,\n  };",
    to: "    absence: null,\n    omittedUnresolvable: 0,\n    omittedUnpositionable,\n    coalescedRows,\n  };",
  },
  {
    // M62 §2 (permanent, F7 rule): THE pre-§2 defect. The address owner is
    // bypassed and the row is served at the CALLING SYMBOL'S DECLARATION — the
    // exact line the store records for a call site. Behaviourally visible: the
    // four exact rows, which the store places on lines 2, 3, 4 and 4, would all
    // be served on line 1. This is the lie §15.3 names first.
    name: "position: the old declaration position is served for a stored call site (§15.3)",
    from: "  if (isExactAddress(address)) {\n    const line0 = addressLine0(address);",
    to: "  if (false && isExactAddress(address)) {\n    const line0 = addressLine0(address);",
  },
  {
    // M55.T3 integration (permanent, F7 rule): THE `path:line:rowId` key comes
    // back — what wave 2 shipped, and what the integration measured to be wrong.
    // Its only effect on five real, populated indexes was to serve byte-identical
    // duplicate locations: 8,285 such positions on 818db37d, 2,417 on 064be526,
    // 684 on 99c211a1, and 99.5% of them were two rows of DIFFERENT
    // relationship kinds for one caller at one stored line. The store cannot
    // write two rows at one stored line through its primary writer (the row id
    // keys on the call-site line — src/ast/parallel-indexer.ts:4147, INSERT OR
    // IGNORE), so such a pair is one place with a declared multiplicity, not two
    // places. An editor cannot show two entries at the same file/line/character:
    // this is §13.1's rendering defect and §13.4's count lie at once. Caught by
    // U2's "no two served locations share a position" (the fixture's two pairs).
    name: "references: the rowId dedupe key restored (byte-identical duplicate locations served for one place)",
    from: "    const key = `${loc.path}:${loc.line}:${loc.character}`;",
    to: "    const key = `${loc.path}:${loc.line}:${edge.id}`;",
  },
  {
    // M55.T3 integration (permanent, F7 rule): the DECLARED COLLAPSE counter is
    // dropped. Every served location is still correct and the list still looks
    // complete — only the §13.2 accounting sees it, which is precisely the class
    // of defect a count-free assertion cannot catch. Caught by U5's closed
    // account and by M6 in script/m55/verify-relations.ts.
    name: "declared absence: the coalesced-row counter is dropped (shared positions merged into silence, §13.2)",
    from: "      coalescedRows++;",
    to: "      /* the collapse is not counted */",
  },
  {
    // M62 §2 (permanent, F7 rule): a FABRICATED position for a row the index
    // cannot place. `unusable` (a negative stored line) and `not-stored` with
    // no resolvable caller declaration have no position; the pre-§2 fallback
    // substituted the caller's declaration silently. Restoring it is exactly the
    // dishonesty this lane removed, and the omission counters see it.
    name: "position: a row with NO position is served at the caller's declaration instead of being omitted and declared",
    from: "  if (address.kind === \"unknown\") return { location: null, omission: \"unpositionable\" };",
    to: "  if (address.kind === \"unknown\") {\n    const fake = edgeLocationDetailed(edge.source_path, edge.source_byte_start, edge.source_byte_end, edge.source_line_start, edge.source_line_end).location;\n    return fake === null ? { location: null, omission: \"unresolvable\" } : { location: { ...fake, callSite: { kind: \"call-site\", file: fake.path, line: fake.line + 1, rowId: edge.id } }, omission: \"none\" };\n  }",
  },
  {
    // M62 §2 (permanent, F7 rule): the unpositionable count is dropped. The two
    // absent rows vanish from the payload's accounting, so a client showing 6 of
    // 8 has no way to know the other two were dropped on purpose.
    name: "declared absence: unpositionable rows silently dropped (count lost)",
    from: "    absence: null,\n    omittedUnresolvable,\n    omittedUnpositionable,\n    coalescedRows,\n  };",
    to: "    absence: null,\n    omittedUnresolvable,\n    omittedUnpositionable: 0,\n    coalescedRows,\n  };",
  },
  {
    // M62 §2 (permanent, F7 rule): the stored line is CHECKED against the
    // source. Drop the bound and a stored line past the end of the file is
    // handed to the editor as a position nobody can verify — §12.1's guessed
    // link, and the §15.3 clause the wave-1 lane already killed once for a
    // different branch of the same function.
    name: "position: a stored call-site line past the end of the file is served unverified (§12.1)",
    from: "    if (line0 >= createPositionMapper(sourceText).lineTexts.length) {\n      return { location: null, omission: \"unresolvable\" };\n    }",
    to: "    if (false) {\n      return { location: null, omission: \"unresolvable\" };\n    }",
  },
  {
    // M62 §2 (permanent, F7 rule): the address is dropped from the payload
    // while the POSITION is kept. The ranges are then right and the payload is
    // silent about what they are — the client cannot tell an exact call site
    // from a labelled declaration substitute, which is the §15.2 identity
    // requirement. Caught on the "every served location carries a callSite"
    // law, not on any count.
    name: "position: the callSite address is stripped from the payload (ranges right, kind undeclared)",
    from: "        callSite: { ...address, rowId: edge.id },\n      },\n      omission: \"none\",\n    };",
    to: "      },\n      omission: \"none\",\n    };",
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
        lintCaught++
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
      crashCaught++
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
  // A SECOND temp dir for the §2 fixture. It is separate because `makeFixture`
  // gates its §2 rows on the call-site file being present, and the emoji dir
  // must not grow those rows — a fixture that changes the expected numbers of a
  // passing assertion cannot tell its own noise from a defect.
  const csDir = mkdtempSync(join(tmpdir(), "bblsp-l3mut-cs-"))
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

    // --- §2 / §15.3 oracle (M62, permanent, F7 rule). The SAME fixture shape
    // the suite's U-laws use, so every §2 mutant is judged on behaviour and not
    // on a source reading. Ordered so the first broken law is the one named.
    const csFixture = makeFixture(csDir, CALLSITE_FILES)
    const csRefs = mod.resolveReferences(csFixture, { filePath: join(csDir, MAIN_REL), line: 1, character: 2, includeDeclaration: false })
    const csLocs = csRefs.locations as any[]
    const csU = csLocs.filter((l) => typeof l.callSite?.rowId === "string" && l.callSite.rowId.startsWith("rel-u-"))

    // O1 every served location states WHAT it is. A payload with the right
    // ranges and no declared kind is still a lie (§15.2).
    if (csLocs.some((l) => typeof l.callSite?.kind !== "string")) {
      return { caught: true, detail: "a served reference location carries no callSite.kind" }
    }
    if (csLocs.some((l) => typeof l.callSite?.rowId !== "string")) {
      return { caught: true, detail: "a served reference location carries no callSite.rowId" }
    }
    // O2 THE DEDUPE LAW, on the fixture's two pairs. The store holds two rows on
    // stored line 4 and two rows whose substitute is the caller's declaration.
    // Both pairs resolve to ONE position each, so the oracle expects ONE
    // location per pair and a coalesced count of 2 — and it expects NO two
    // served locations to share a file/line/character, which is where the
    // rowId-key defect shows up (§13.1).
    const csLine4 = csU.filter((l) => l.callSite?.kind === "call-site" && l.line === 3)
    if (csLine4.length !== 1) {
      return { caught: true, detail: `${csLine4.length} location(s) on stored line 4; two stored rows share that ONE position, so exactly 1 must be served` }
    }
    const csPositions = new Set(csLocs.map((l) => `${l.path}:${l.line}:${l.character}`))
    if (csPositions.size !== csLocs.length) {
      return { caught: true, detail: `${csLocs.length} served locations over ${csPositions.size} distinct positions — byte-identical duplicates (§13.1)` }
    }
    if (typeof csRefs.coalescedRows !== "number" || csRefs.coalescedRows !== 2) {
      return { caught: true, detail: `coalescedRows = ${String(csRefs.coalescedRows)}, expected 2 (the line-4 pair + the substitution pair)` }
    }
    // O3 THE DECLARATION DEFECT. Four stored rows name real call sites on lines
    // 2, 3, 4 and 4; the three DISTINCT positions must be served at the store's
    // lines and none at the caller's declaration.
    const csExact = csU.filter((l) => l.callSite?.kind === "call-site")
    if (csExact.length !== 3) {
      return { caught: true, detail: `${csExact.length} exact call sites served; the store's 4 exact rows name 3 distinct lines` }
    }
    if (csExact.some((l) => l.line === 0)) {
      return { caught: true, detail: `an exact call site was served at the caller's declaration (line ${JSON.stringify(csExact.map((l) => l.line))})` }
    }
    if (csExact.map((l) => l.line).sort().join(",") !== "1,2,3") {
      return { caught: true, detail: `exact call sites served at lines ${JSON.stringify(csExact.map((l) => l.line).sort())}; the store says 1,2,3 (0-based, distinct)` }
    }
    // O3b the genuine §13.4 case survives the position key: two call sites on
    // two DIFFERENT stored lines are two locations.
    if (csExact.filter((l) => l.line === 1 || l.line === 2).length !== 2) {
      return { caught: true, detail: "two call sites on two different stored lines did not stay two locations (§13.4)" }
    }
    // O4 the two absent rows are omitted AND counted, apart from the one
    // unreadable file. A fabricated fallback or a lost count dies here.
    if (csRefs.omittedUnpositionable !== 2) {
      return { caught: true, detail: `omittedUnpositionable = ${csRefs.omittedUnpositionable}, expected 2` }
    }
    if (csRefs.omittedUnresolvable !== 2) {
      return { caught: true, detail: `omittedUnresolvable = ${csRefs.omittedUnresolvable}, expected 2 (the file that is not on disk, and the stored line past EOF)` }
    }
    if (csU.some((l) => String(l.path).includes("ghost.ts"))) {
      return { caught: true, detail: "a location was fabricated for the file that is not on disk" }
    }
    // O4b §12.1: a stored line past the end of its file is a guessed link.
    if (csU.some((l) => l.callSite?.rowId === "rel-u-past-eof")) {
      return { caught: true, detail: `a stored call-site line past EOF was served at ${JSON.stringify(csU.find((l) => l.callSite?.rowId === "rel-u-past-eof")?.line)}` }
    }
    // O5 a row the store cannot place is absent — not served at a declaration.
    for (const id of ["rel-u-unusable", "rel-u-nostored"]) {
      if (csU.some((l) => l.callSite?.rowId === id)) {
        return { caught: true, detail: `${id} (no position) was served at ${JSON.stringify(csU.find((l) => l.callSite?.rowId === id)?.callSite)}` }
      }
    }
    // O6 the labelled substitute exists, carries the OWNER's note, and sits on
    // the caller's own stored columns rather than at a call site. Only ONE of
    // the two substitution rows is served: `rel-u-legacy` and `rel-u-null` are
    // both declared-unknown states, so both take the SAME declaration as their
    // substitute and that is ONE served position (asserted by the
    // coalescedRows check above). Asserting both were served would assert two
    // locations at one caret position.
    const legacySubRow = csU.find((l) => l.callSite?.rowId === "rel-u-legacy")
    if (legacySubRow?.callSite?.kind !== "declaration") {
      return { caught: true, detail: `rel-u-legacy is served as ${JSON.stringify(legacySubRow?.callSite?.kind)}, expected a labelled declaration substitute` }
    }
    if (typeof legacySubRow.callSite.note !== "string" || legacySubRow.callSite.note.length === 0) {
      return { caught: true, detail: "rel-u-legacy is served as a declaration with no note" }
    }
    if (legacySubRow.line !== 0 || legacySubRow.character !== 9) {
      return { caught: true, detail: `rel-u-legacy is served at ${legacySubRow.line}:${legacySubRow.character}, expected the caller's own name token at 0:9` }
    }
    // The account must name BOTH substitution rows: served + coalesced. If a
    // component served `rel-u-null` as well it would be double-serving one
    // position; if it served neither it would be dropping a row.
    if (csU.filter((l) => l.callSite?.kind === "declaration").length !== 1) {
      return { caught: true, detail: `${csU.filter((l) => l.callSite?.kind === "declaration").length} declaration substitutes served; the two substitution rows share ONE position` }
    }
    // O7 the substitute must not be laundered into a bare call site.
    if (/^as call site/i.test(String(legacySubRow?.callSite?.note)) || legacySubRow?.callSite?.note === "") {
      return { caught: true, detail: `the substitute note does not say what it is: ${JSON.stringify(legacySubRow?.callSite?.note)}` }
    }
    // O8 includeDeclaration labels itself, so a declaration is never rendered
    // as a usage.
    const csWithDecl = mod.resolveReferences(csFixture, { filePath: join(csDir, MAIN_REL), line: 1, character: 2, includeDeclaration: true })
    const csDeclEntry = (csWithDecl.locations as any[]).find((l) => typeof l.callSite?.rowId === "string" && l.callSite.rowId.startsWith("declaration:"))
    if (csDeclEntry?.callSite?.kind !== "declaration") {
      return { caught: true, detail: `the includeDeclaration entry carries ${JSON.stringify(csDeclEntry?.callSite?.kind)}, expected a declaration` }
    }
    if (typeof csDeclEntry.callSite.note !== "string" || csDeclEntry.callSite.note.length === 0) {
      return { caught: true, detail: "the includeDeclaration entry carries no note" }
    }
    if (csWithDecl.totalCount !== csRefs.totalCount + 1) {
      return { caught: true, detail: `includeDeclaration moved the count by ${csWithDecl.totalCount - csRefs.totalCount}, expected +1` }
    }
    // O9 §13.4: the header count is the rendered truth.
    if (csRefs.totalCount !== csRefs.locations.length) {
      return { caught: true, detail: `totalCount ${csRefs.totalCount} != rendered ${csRefs.locations.length}` }
    }

    return { caught: false, detail: "" }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    try { rmSync(csDir, { recursive: true, force: true }) } catch {}
  }
}

// --- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L3 verifier — definition + references over the persisted index\n")

  await testDefinition()
  await testHonesty()
  await testDeclaredAbsence()
  await testUnresolvableOmission()
  await testCallSiteMigration()
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
      /**
       * WHY THIS BLOCK EXISTS. The wave-1 lesson, and the program's central one:
       * a mutant caught ONLY by a LOAD FAILURE is not caught — the defect never
       * ran, so the suite proved nothing about it while reporting a catch. Six
       * mutants were in exactly that state at HEAD. So the accounting is
       * explicit, not inferred from the count:
       *
       *   mutantsJudgedByBehaviour = the mutant loaded AND ran AND the oracle
       *     observed a wrong SERVED ANSWER. This is the only class that counts
       *     as a catch of the mutation.
       *   mutantsJudgedByLint     = the mutation is invisible to any oracle on
       *     results (the hand-rolled byte walk is behaviourally almost right),
       *     so the independent source-level §5 rule 1 gate judges it. It is a
       *     separate script, so it cannot be edited away with this suite.
       *   mutantsNotJudged        = anything else — a load failure, a missing
       *     or ambiguous anchor, or a component crash. These are reported as
       *     FAILURES of the harness, never as catches.
       *
       * `mutantsNotJudged` is measured per run from the mutants this run
       * actually judged; `mutantsJudgedByCrash` names the one class that is
       * counted separately because a crash on the fixture IS a real
       * behavioural defect (the component throws where the contract requires
       * declared absence) but it is a weaker signal than a wrong answer, and a
       * reader is entitled to know which mutants died that way.
       */
      mutantsJudgedByBehaviour: mutantsCaught - lintCaught - crashCaught,
      mutantsJudgedByLint: lintCaught,
      mutantsJudgedByCrash: crashCaught,
      mutantsNotJudged: NAV_MUTANTS.length - mutantsCaught,
      mutantsNotJudgedMeans:
        "mutants whose anchor did not match exactly once, or whose mutated copy failed to load, or whose run was aborted by a harness failure. Every one of those increments `failed` and prints FAIL, so the count cannot be laundered into a catch.",
      harnessDefectsFoundAndFixed: [
        "Every mutant at HEAD was 'caught' as an IMPORT FAILURE: the harness rewrote ./positions and ./hover to absolute paths but not ./relations, so the mutated copy could not load. A load error was counted as a behavioral catch (§8.7: the tautological gate). Fixed by deriving the rewrite from the source's own relative imports and by recording an import failure as a FAILURE of the harness.",
        "Two mutant anchors matched zero or two occurrences and the harness printed 'SKIP (anchor not found)' and continued — so a rename would silently delete a mutation without changing the verdict. Fixed: a missing or ambiguous anchor is now a FAILURE.",
        "The oracle returned a bare boolean, so a catch could not say WHICH law broke. Now it returns {caught, detail}, and the log names the law.",
        "Wave 2 (M62 §2): the 'a stored call-site line past the end of the file is served unverified' mutant SURVIVED its first run, because no fixture row ever reached that branch — a mutant with no fixture is a mutant with no gate. Fixed at the FIXTURE, not by weakening the mutant: `rel-u-past-eof` stores a real line 99 in a six-line file, and the omission counts moved from 1/2 to 2/2 to match.",
        "Wave 2: three §2 assertions passed VACUOUSLY against the pre-§2 component (a zero-width-range check over an empty set, a 'kind is call-site' check over rows that had no kind, and a 'column appears at most once' check satisfied by zero occurrences). A check that cannot fail is not a check (§8.7), so each now carries an explicit non-emptiness precondition and the column check is `=== 1`, not `<= 1`.",
        "M55.T3 INTEGRATION: U2 asserted the WRONG law, and the suite was green on it. It read the fixture's two rows at stored line 4 as 'two call sites in one function are two usages' and required `path:line:rowId`. Measurement on five real, populated indexes found that key's only effect was byte-identical duplicate locations: 8,285 such positions on project 818db37d, 2,417 on 064be526, 684 on 99c211a1, of which 99.5% are two rows of DIFFERENT relationship kinds for one caller at one stored line. The store cannot write two rows at one stored line through its primary writer (row id keys on the call-site line, src/ast/parallel-indexer.ts:4147, INSERT OR IGNORE) — verified by indexing a real source with two calls to one callee: two calls on ONE line produce ONE row; two calls on DIFFERENT lines produce two rows and two locations. So U2 was asserting a law the store cannot produce, and the real multi-call-site case it was meant to protect is asserted instead on the DIFFERENT-lines pair (rel-u-a/rel-u-b). The shared-position rows are now DECLARED in `coalescedRows` (§13.2) rather than double-served (§13.1), U5's account is closed over the stored rows instead of merely being non-zero, and the reverse mutation (planting the rowId key) plus a dropped-counter mutation are both in the suite.",
        "M55.T3 INTEGRATION: the same fixture's `rel-u-legacy` (stored 0) and `rel-u-null` (stored NULL) BOTH take the caller's declaration as their substitute, so they share one served position. U4 originally required both to be served, which is the same defect as the U2 one at the other end of the fixture. It now asserts one served substitute and the coalesced count that names the other.",
      ],
      declaredAbsenceLaws: ["N0-N8 (§11.7)", "P0-P3 (§15.3)"],
      positionOwnershipLaws: ["S0-S2 (§5 rule 1)", "G5"],
      callSiteMigrationLaws: [
        "U0 the §2 fixture is adversarial AND honest (the production join shape, two rows on one stored line, four store states, a file that is not on disk, a line past EOF)",
        "U1 positions are where the thing is (§15.3): the exact rows are served at the store's DISTINCT lines, never at the caller's declaration",
        "U2 THE DEDUPE LAW: two stored rows sharing one served position produce ONE location and a declared coalesced row; two call sites on two DIFFERENT stored lines stay two locations; no two served locations share a position",
        "U3 differential against the store's own row plus a check against the source text at the served line (§12.1)",
        "U4 the four store states end as four declared outcomes, and the two absent ones are counted",
        "U5 the two omission counters are distinct facts, nothing is fabricated, every stored row is served or counted",
        "U6 §13.4 the header count equals the rendered rows, and every location states what it is",
        "U7 includeDeclaration labels itself as a declaration (§15.2)",
        "U8 §5 plus the M62 discipline: the stored column is read exactly once, as the hand-off to the owner",
      ],
      lintJudgedMutants: NAV_MUTANTS.filter((m) => m.oracle === "lint").length,
      behaviorJudgedMutants: NAV_MUTANTS.filter((m) => m.oracle !== "lint").length,
      lintJudgedNote: "Two mutants are invisible to any oracle on results — the hand-rolled byte walk is behaviorally almost right — and are judged by the source-level §5 rule 1 lint instead. That lint is its own script (script/m24/verify-position-arithmetic.ts) so it cannot be edited away with this suite.",
      determinismOfMutantJudgement:
        "No §2 mutant is judged by the lint and none by a load failure: all six are judged by the behavioural oracle (O1-O9 in navMutantOracle), which serves the mutated module the same call-site fixture the U-laws use.",
    },
    determinism: {
      declaredVolatileFields: ["generatedAt", "bbSeal.sealedAt", "bbSeal.contentSha256"],
      note:
        "Re-running this verifier at an unchanged commit reproduces every field byte-for-byte EXCEPT the three named above. generatedAt is a wall-clock stamp; bbSeal.sealedAt is the write time; bbSeal.contentSha256 is a sha256 over the record's content, which includes generatedAt, so it changes with it. All three are declared here as volatile (contract §8.2 allows regeneration modulo declared timestamps). No other field is time-, path-, or order-dependent: the fixture is temp-dir based (the temp DIRECTORY is random, but no emitted field contains it), and every emitted collection is sorted or in insertion order.",
      measured:
        "Two consecutive runs of `npx tsx script/m24/verify-navigation.ts` compared after canonicalising the three declared volatile fields: identical. Measured again for wave 2 after the §2 gate was added, with the same result. The same comparison holds for validation/m24/results/POSITION-OWNERSHIP.json across two runs of its own verifier. The CALLSITE-AGREEMENT record additionally names the index path and its mtime, because its numbers are properties of an INPUT (a real index) rather than of this repository — re-indexing changes them, and the record says which index it read.",
    },
    callSiteSurfaceLimitations: {
      statement:
        "§2 moved textDocument/references from the referencing symbol's DECLARATION to the store's CALL-SITE line. The M55.T3 integration then corrected the DEDUPE law from one-location-per-stored-row to one-location-per-served-POSITION, with the shared rows declared in `coalescedRows`. Five consequences are declared rather than left for a reader to discover.",
      items: [
        "ONE LOCATION PER SERVED POSITION, AND THE MULTIPLICITY IS COUNTED, NOT SERVED TWICE. Two stored rows that resolve to the same file/line/character are ONE place the index can put a caret, so one location is served and the other row is counted in `coalescedRows` (§13.1's rendering rule, §13.2's accounting rule). The law this replaced — one location per stored row, keyed `path:line:rowId` — was measured on five real indexes and its only effect was byte-identical duplicate locations: 8,285 such positions on 818db37d, 2,417 on 064be526, 684 on 99c211a1; 99.5% were two rows of different relationship kinds for one caller at one stored line. `references`, the hover's list and the SQL count now all count served positions, which is why they agree without any of them declaring a filter. The genuine multi-call-site case is unaffected: two call sites on two DIFFERENT stored lines are two positions and are served as two locations (asserted by U2 and by R5 in script/m55/verify-relations.ts).",
        "`coalescedRows` DOES NOT REACH THE WIRE, and neither do the other two counters — see wiringNeededInServerTs. The three-surface count agreement that §14 rule 1 requires is therefore visible to a COMPONENT-level reader and to this gate, not to an editor. That is the same limitation wave 2 declared for `callSite`, extended to the new field.",
        "AN EXACT CALL SITE IS A LINE-ONLY RANGE. brain_relationship stores a line and no column for a call site, so the served range is zero-width at character 0 of the stored line and the editor places the caret at the start of that line. The payload declares this: callSite.kind === 'call-site'. The exact token needs a call-site column in the store, which is M59's lane (A4/A8), not this one.",
        "THE ADDRESS OWNER'S `file` FIELD CARRIES AN ABSOLUTE PATH HERE. The owner's contract documents it as the RELATIVE path (its graph/hub/MCP consumers render file:line); this surface hands the editor absolute brain_file paths and holds no project root to relativise against. Declared in the payload, asserted by U3, and reported as a gap in the owner's field contract — a renderer printing this address gets an absolute path, which is correct for navigation and differs from the other three surfaces.",
        "THE STORE'S CALL-SITE COVERAGE IS NOT THIS LANE'S CLAIM. Per-language real-line coverage is M59.A7. On an index where every row carries a real line (measured: 10,267 of 10,267 rows on the corpus this lane indexed), the labelled-substitute branch cannot be exercised from real data and is proven on the fixture instead — declared in the CALLSITE-AGREEMENT record, not implied.",
        "THE SERVER DOES NOT FORWARD callSite TO THE WIRE. src/lsp/server.ts maps each location through navLocationToWire, which drops callSite, omittedUnresolvable and omittedUnpositionable. The component is honest; the LSP wire cannot carry the declaration under LSP 3.18's Location[] shape. Until that is wired, an editor cannot tell an exact call site from a labelled substitute. See wiringNeededInServerTs.",
      ],
    },
    declaredConflictsWithOtherGates: {
      M62_P6_permanence_lint:
        "script/m62/verify-consumers.ts's P6 lint flags ANY code line in a display surface that names brain_relationship.line_number, with no exception for the hand-off to the address owner. §2 REQUIRES this surface to select the column — the store's line is the only place a call site is recorded — so the honest implementation trips it: A2 now reports TWO P6 findings (src/lsp/navigation.ts:252 and the pre-existing src/lsp/impact.ts:1242) where it reported one. A2's STATUS is unchanged (known-gap, 15/16, before and after), but the finding count rose by one and that is the correct outcome rather than a regression: the alternative was to spell the column so the regex cannot see it, which is obfuscation and a worse lie than the lint violation. Recommended resolution for the lint's owner: narrow P6 to reads that do not feed deriveCallSiteAddress, and pin that exception with its own planted mutant so it cannot widen silently.",
    },
    limitations: [
      "index-sourced only; no compiler-backed go-to-definition (complement stance)",
      "reference sites resolve to relationship edge coordinates; heuristic-edge ratio per language is declared in the master plan",
      "fixture-backed double for the DB layer; the live brain.db leg is script/m24/verify-callsite-agreement.ts (CALLSITE-AGREEMENT.json), which differentials every served position against its OWN stored row on a real index and re-checks the line's own source text",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
      "the declared-absence reason reaches the wire only through src/lsp/server.ts, which is not this lane's file — see `wiringNeededInServerTs` below. This gate proves the component carries the reason; it cannot prove the editor receives it.",
      "the launch gate keys off the file EXTENSION (languageForPath), not brain_file.language. A file whose extension maps to a launch language while its rows say otherwise is served; a file the extension cannot classify is declared absent with language:null.",
      "§15.3 omission counts are per-response and split into TWO declared facts: omittedUnresolvable (the store names a line the source does not confirm) and omittedUnpositionable (the store names no position at all). A THIRD declared fact, coalescedRows (M55.T3 integration), counts rows whose position another row already occupies — not an omission, a declared multiplicity. The per-row reason is in the owner's note / edgeLocationDetailed's absence, which the references result does not enumerate row by row.",
      "THE HOVER'S COLLECTOR STILL SERVES A CALL-SITE LINE PAST THE END OF THE FILE (known gap, found by the M55.T3 integration, NOT fixed here). rich_hover.ts's richSitesForSymbol does not bound the address owner's line against the file's line count, so a stored line the source cannot confirm renders as a usage link. Measured on the integration's R5 fixture (a three-line target with two usage rows stored at lines 40 and 41): this surface serves 0 locations and declares omittedUnresolvable = 2; the hover's collector returns 2 sites at lines 40 and 41. That is a §12.1 / §14 rule 1 disagreement between two surfaces, in another lane's file, whose fix's blast radius is three gates this integration must not regress. Recorded as knownGaps[0] in script/m55/verify-relations.ts with its numbers, and gated there so the future fix cannot land unverified (contract F7).",
      "THE §2 FIXTURE'S PRE-EXISTING ROWS DIVERGE FROM THE PRODUCTION JOIN, and U0 says so out loud. Rows whose source_symbol_id is NULL have their site coordinates served as the source side, which the production LEFT JOIN cannot produce (it yields NULL for every source_* column). Those rows are retained so wave-1's accepted numbers keep their meaning; the §2 rows use the real join. A fixture that quietly laundered both shapes would prove nothing about production.",
      "no claim is made about call hierarchy: src/lsp/call_hierarchy.ts is another lane's file, actively being edited for the same migration, and was neither read for behaviour nor modified here.",
    ],
    wiringNeededInServerTs: [
      "src/lsp/server.ts:573 (textDocument/definition) — `if (!r.found || r.location === null) return null` discards r.absence. The LSP wire shape for definition is `Location | Location[] | null`, so the reason cannot ride the result; it needs either a window/logMessage carrying the reason, or an accepted deviation recorded here.",
      "src/lsp/server.ts:607 (textDocument/references) — `return r.locations.map(navLocationToWire)` turns a declared absence into a bare `[]`, which contract §11.7 calls a violation ('silent empty results that look like no references found'). LSP 3.18 requires Location[] for this request, so the honest options are: (a) a window/logMessage with r.absence.detail, or (b) the client reading a custom field — neither is available on this wire shape.",
      "src/lsp/server.ts:547 (textDocument/hover) — `if (r.contents === null || r.range === null || r.data === null) return null` discards provenance.limitations, which already names the language and the launch set. Same wire constraint as above.",
      "NEW IN WAVE 2 — src/lsp/server.ts:729 navLocationToWire copies only path/line/character/endLine/endCharacter, so it DROPS loc.callSite. Consequence: the editor receives correct line-only ranges but cannot tell an exact call site from a labelled declaration substitute, and cannot see either omission counter. That is §15.2's identity requirement unmet at the wire. LSP permits extra properties on a Location object, so the fix is available; the wire shape is the server's decision and that file is not this lane's.",
      "NEW IN THE M55.T3 INTEGRATION — the same navLocationToWire also drops `coalescedRows`, the counter the integration added. Consequence at the wire: an editor showing a find-references list cannot learn that two stored rows share one of the served places. The wire count (`locations.length`) is still correct and still equals hover's count, so §14 rule 1's numeric requirement holds on the wire; what is missing is the multiplicity declaration. One line in server.ts, outside this lane's ownership.",
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
