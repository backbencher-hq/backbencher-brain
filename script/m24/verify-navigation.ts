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
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT = join(ROOT, "src", "lsp", "navigation.ts")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "L3.json")

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
]

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

const FILES: Record<string, string> = { [MAIN_REL]: FIXTURE_MAIN, [USE_REL]: FIXTURE_USE }

/** CoreDatabase-shaped double: only prepare().all() with SQL matching the
 *  exact queries the navigation component issues against the index. */
function makeFixture(dir: string): any {
  for (const [rel, content] of Object.entries(FILES)) {
    const p = join(dir, rel)
    if (!existsSync(p)) writeFileSync(p, content)
  }

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
              let hits = FIXTURE_SYMBOLS.filter((sym) => sym.name === nameArg)
              if (s.includes("f.path = ?")) {
                const relKey = Object.keys(FILES).find((k) => abs(k) === args[0])
                hits = hits.filter((sym) => sym.file === relKey)
              }
              return hits.map((sym) => ({
                ...sym,
                file_id: `file-${sym.file}`,
                f_id: `file-${sym.file}`,
                path: abs(sym.file),
                language: "typescript",
              }))
            }
            const fpath = args[0] as string
            const line1 = args[1] as number
            const rel = Object.entries(FILES).find(([, ]) => abs(Object.keys(FILES)[Object.values(FILES).indexOf(fpath as never)] ?? "") === fpath)
            // Map absolute path back to rel key.
            const relKey = Object.keys(FILES).find((k) => abs(k) === fpath)
            if (!relKey) return []
            void rel
            return FIXTURE_SYMBOLS
              .filter((sym) => sym.file === relKey && sym.line_start <= line1 && sym.line_end >= line1)
              .map((sym) => ({
                ...sym,
                file_id: `file-${sym.file}`,
                f_id: `file-${sym.file}`,
                path: abs(sym.file),
                language: "typescript",
              }))
          }
          if (s.includes("from brain_relationship r")) {
            const sid = args[0] as string
            return FIXTURE_RELS.filter((r) => r.target_symbol_id === sid || r.source_symbol_id === sid).map((r) => {
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

const NAV_MUTANTS: Array<{ name: string; from: string; to: string }> = [
  {
    name: "references: dropped edge (skip one site)",
    from: "    if (locations.length < limit) {\n      locations.push(loc);\n    }",
    to: "    if (locations.length < limit && seen.size % 2 === 1) {\n      locations.push(loc);\n    }",
  },
  {
    name: "definition: wrong position (line off by one)",
    // M44.U5 wrapped the conversion in try/catch (out-of-range is declared
    // absence) — the mutant plants the same defect at the new anchor.
    from: "    indexPos = mapper.lspToIndex({ line: line, character: character });",
    to: "    indexPos = mapper.lspToIndex({ line: line + 1, character: character });",
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
    // requires honest emptiness.
    name: "absence: out-of-range position throws (guard removed)",
    from: "    if (err instanceof PositionError) return null;",
    to: "    if (false) return null;",
  },
  {
    // M53 (permanent, F7 rule): the reference-first resolution is dropped —
    // definition regresses to the containment-only model and a call site
    // navigates to the enclosing symbol (the live defect M53.R2 found).
    name: "call-site: reference-first resolution dropped",
    from: "  const named = findNamedSymbolAtPosition(raw, request.filePath, request.line, request.character);",
    to: "  const named = null as SymbolRow | null; // reference-first dropped",
  },
]

async function runNavMutants(): Promise<number> {
  console.log("Navigation mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0

  for (const mutant of NAV_MUTANTS) {
    if (!source.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    const mutantPath = join(ROOT, "validation", "m24", `navigation.mutant.${Date.now()}.ts`)
    // The mutant is written outside src/, so its relative imports would break.
    // Rewrite them to absolute file:// paths against the real sources.
    const absImport = mutantSource
      .replace(/from "\.\.\/brain\/database"/g, `from "file://${join(ROOT, "src", "brain", "database.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/positions"/g, `from "file://${join(ROOT, "src", "lsp", "positions.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/hover"/g, `from "file://${join(ROOT, "src", "lsp", "hover.ts").replace(/\\/g, "/")}"`)
    writeFileSync(mutantPath, absImport)
    let mod: any
    try {
      mod = await import(mutantPath)
    } catch (error) {
      // A genuine import failure is still a catch, but it must be reported
      // distinctly from behavioral catches — the evidence must show which.
      caught++
      console.log(`  caught (import failure): ${mutant.name}`)
      console.log(`      ${String(error).split("\n")[0]}`)
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    try {
      const ok = await navMutantOracle(mod)
      if (ok) {
        caught++
        console.log(`  caught: ${mutant.name}`)
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

/** Oracle for navigation mutants: returns true when the mutation visibly
 *  breaks a declared guarantee against the fixture-backed double. */
async function navMutantOracle(mod: any): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l3mut-"))
  try {
    const raw = makeFixture(dir)

    // Definition oracle: position on greet must resolve exactly.
    const def = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2 })
    if (def.found !== true || def.symbol?.name !== "greet") return true
    if (def.location?.line !== 1) return true

    // Honesty oracle: not-indexed position must not fabricate.
    const notFound = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 9, character: 0 })
    if (notFound.found !== false || notFound.location !== null) return true

    // M44.U5 absence oracle: a position far past EOF is declared absence —
    // no throw (the guard mutant above survives exactly here).
    try {
      const pastEof = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 9999, character: 0 })
      if (pastEof.found !== false || pastEof.location !== null) return true
    } catch {
      return true
    }

    // M53 call-site oracle (F7: permanent): at a call site the definition
    // must name the CALLEE. A component that regresses to the containment-
    // only model (or loses the reference-first resolution entirely) answers
    // with the enclosing symbol instead — caught exactly here.
    const atCall = mod.resolveDefinition(raw, { filePath: join(dir, MAIN_REL), line: 7, character: 2 })
    if (atCall.found !== true || atCall.symbol?.name !== "greet") return true
    if (atCall.location?.path !== join(dir, MAIN_REL) || atCall.location?.line !== 1) return true

    // References oracle: all 3 call sites present, none dropped.
    const refs = mod.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: false })
    if (refs.locations.length !== 3 || refs.totalCount !== 3) return true
    if (refs.truncated !== false) return true

    // Truncation oracle: cap at 2 must declare the cut.
    const capped = mod.resolveReferences(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 2, includeDeclaration: false, limit: 2 })
    if (capped.locations.length !== 2) return true
    if (capped.truncated !== true || capped.totalCount !== 3) return true

    return false
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// --- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L3 verifier — definition + references over the persisted index\n")

  await testDefinition()
  await testHonesty()
  await testReferences()
  await testTruncation()
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
    },
    limitations: [
      "index-sourced only; no compiler-backed go-to-definition (complement stance)",
      "reference sites resolve to relationship edge coordinates; heuristic-edge ratio per language is declared in the master plan",
      "fixture-backed double for the DB layer; live brain.db path covered by upstream freshness verifiers and the V1 harness",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
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
