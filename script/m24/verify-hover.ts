// script/m24/verify-hover.ts — M24.L2 verifier + mutation suite.
//
// Proves the hover component (src/lsp/hover.ts) honors its declared
// guarantees against a CoreDatabase-shaped double backed by fixture data
// matching the real index schema, and proves the suite CAN FAIL by planting
// defects and asserting the suite catches each one.
//
// Guarantees under test (declared in src/lsp/hover.ts header):
//   G1 content:     hover at an indexed symbol returns name, signature,
//                   usage count, and evidence tier(s)
//   G2 consistency: usage count agrees with the stored USAGE SITES of the
//                   symbol (M55.T3, §14 Truth Rule 1: incoming rows whose
//                   kind is not a declaration containment, deduplicated by
//                   location) — the fixture's outgoing/tier rows and the
//                   owning-class `contains` row must NOT be counted
//   G3 honesty:     symbol not in index → declared "not indexed", never
//                   fabricated; unsupported language → declared absence
//   G4 positions:   position resolution via the P1 component ONLY
//   G5 freshness:   stale file (hash differs from disk) → stale marker
//   G6 latency:     p95 warm hover under the 50 ms budget (contract §3)
//
// Run: npx tsx script/m24/verify-hover.ts
// Evidence: validation/m24/results/L2.json (machine-emitted)

import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { hashFileContent } from "../../src/brain/freshness"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT = join(ROOT, "src", "lsp", "hover.ts")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "L2.json")

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

const FIXTURE_SOURCE = `class Greeter {
  private greeting: string

  constructor(message: string) {
    this.greeting = message
  }

  greet(): string {
    return this.greeting
  }
}

function callerA(): string {
  const g = new Greeter("a")
  return g.greet()
}

function callerB(): string {
  const g = new Greeter("b")
  return g.greet()
}

function callerC(): string {
  const g = new Greeter("c")
  return g.greet()
}
`

const FILE_ID = "file-fixture-1"
const FILE_PATH_REL = "fixture.ts"

// M55.T3: the rows are stored the way the analyzers store them — the USED
// symbol is the row's TARGET and the referencing symbol is its SOURCE. The
// pre-M55 fixture had it backwards (three `call` rows with greet as the
// SOURCE and no target), so it asserted a usage count that was really greet's
// own outgoing rows.
const FIXTURE_SYMBOLS = [
  { id: "sym-greeter", name: "Greeter", qualified_name: null, symbol_type: "class", line_start: 1, line_end: 11, byte_start: 1, byte_end: 2, return_type: null, parameters: null, visibility: null },
  { id: "sym-ctor", name: "constructor", qualified_name: "Greeter.constructor", symbol_type: "method", line_start: 4, line_end: 6, byte_start: 3, byte_end: 4, return_type: "void", parameters: "message: string", visibility: "private" },
  { id: "sym-greet", name: "greet", qualified_name: "Greeter.greet", symbol_type: "method", line_start: 8, line_end: 10, byte_start: 1, byte_end: 4, return_type: "string", parameters: "", visibility: "public" },
  { id: "sym-caller-a", name: "callerA", qualified_name: "callerA", symbol_type: "function", line_start: 13, line_end: 16, byte_start: 1, byte_end: 8, return_type: "string", parameters: "", visibility: null },
  { id: "sym-caller-b", name: "callerB", qualified_name: "callerB", symbol_type: "function", line_start: 18, line_end: 21, byte_start: 1, byte_end: 8, return_type: "string", parameters: "", visibility: null },
  { id: "sym-caller-c", name: "callerC", qualified_name: "callerC", symbol_type: "function", line_start: 23, line_end: 26, byte_start: 1, byte_end: 8, return_type: "string", parameters: "", visibility: null },
]

const FIXTURE_RELS = [
  { id: "rel-1", source_symbol_id: "sym-caller-a", target_symbol_id: "sym-greet", relationship_type: "calls", confidence: 1.0 },
  { id: "rel-2", source_symbol_id: "sym-caller-b", target_symbol_id: "sym-greet", relationship_type: "calls", confidence: 1.0 },
  { id: "rel-3", source_symbol_id: "sym-caller-c", target_symbol_id: "sym-greet", relationship_type: "calls", confidence: 0.9 },
  // The owning declaration: how greet is DECLARED, not a usage (T3).
  { id: "rel-4", source_symbol_id: "sym-greeter", target_symbol_id: "sym-greet", relationship_type: "contains", confidence: 1.0 },
  // An outgoing row of greet's own (its return type): never a usage of greet.
  { id: "rel-5", source_symbol_id: "sym-greet", target_symbol_id: "sym-greeter", relationship_type: "return", confidence: 0.3 },
]

/** The gate's own, independent statement of the T3 vocabulary — computed with
 *  plain JS from the fixture (never imported from the component under test). */
function expectedUsageSites(forSymbolId: string): Set<string> {
  const ids = new Set(FIXTURE_SYMBOLS.map((s) => s.id))
  const sites = new Set<string>()
  for (const r of FIXTURE_RELS) {
    if (r.target_symbol_id !== forSymbolId) continue
    if (r.source_symbol_id === forSymbolId) continue
    if (r.relationship_type === "contains" || r.relationship_type === "exports") continue
    if (!ids.has(r.source_symbol_id as string)) continue
    sites.add(`${r.source_symbol_id}`)
  }
  return sites
}

/** CoreDatabase-shaped double: only prepare().get()/all() with SQL matching
 *  the exact queries the hover component issues against the index. */
function makeFixture(dir: string): any {
  const filePath = join(dir, FILE_PATH_REL)
  // Write the real file to disk so the freshness path (P2) can hash it.
  // Stored hash must equal hashFileContent of the on-disk content.
  const fileHash = hashFileContent(FIXTURE_SOURCE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (!existsSync(filePath)) writeFileSync(filePath, FIXTURE_SOURCE)

  const fileRow = { id: FILE_ID, path: filePath, language: "typescript", file_hash: fileHash }

  const raw = {
    prepare(sql: string) {
      const s = sql.toLowerCase().replace(/\s+/g, " ")
      return {
        get(...args: any[]) {
          if (s.includes("from brain_file") && s.includes("where id = ?")) {
            if (args[0] === FILE_ID) return { path: fileRow.path, file_hash: fileRow.file_hash, size_bytes: null, last_modified: null }
            return undefined
          }
          // M55.T3: the SQL usage-site count (relations.countUsageSites) — the
          // double mirrors its semantics: incoming rows, no declaration
          // containments, one distinct referencing symbol per location.
          if (s.includes("count(*)") && s.includes("brain_relationship")) {
            const sid = args[0] as string
            return { c: expectedUsageSites(sid).size }
          }
          return undefined
        },
        all(...args: any[]) {
          if (s.includes("from brain_symbol s join brain_file f")) {
            // args: [filePath, line+1, line+1]
            const fpath = args[0]
            const line1 = args[1] as number
            if (fpath !== filePath) return []
            return FIXTURE_SYMBOLS
              .filter((sym) => sym.line_start <= line1 && sym.line_end >= line1)
              .map((sym) => ({ ...sym, file_id: FILE_ID, f_id: FILE_ID, path: filePath, language: "typescript" }))
          }
          if (s.includes("brain_relationship") && s.includes("relationship_type, confidence")) {
            const sid = args[0]
            return FIXTURE_RELS.filter((r) => r.source_symbol_id === sid || r.target_symbol_id === sid)
              .map((r) => ({ relationship_type: r.relationship_type, confidence: r.confidence }))
          }
          // M55.T3: the rich-sites collection query (rich_hover) — the hover
          // count and list are taken from THIS collection, so the double must
          // serve it with the row shape the collector reads (both ends' stored
          // coordinates; the side the collector uses depends on direction).
          if (s.includes("from brain_relationship r")) {
            const sid = args[0] as string
            const byId = new Map(FIXTURE_SYMBOLS.map((sym) => [sym.id, sym]))
            const coords = (id: string | null) => {
              const sym = id === null ? undefined : byId.get(id)
              return sym === undefined
                ? { n: null, t: null, path: null, bs: null, be: null, ls: null, le: null }
                : { n: sym.name, t: sym.symbol_type, path: filePath, bs: sym.byte_start, be: sym.byte_end, ls: sym.line_start, le: sym.line_end }
            }
            return FIXTURE_RELS.filter((r) => r.source_symbol_id === sid || r.target_symbol_id === sid).map((r) => {
              const src = coords(r.source_symbol_id)
              const tgt = coords(r.target_symbol_id)
              return {
                id: r.id,
                relationship_type: r.relationship_type,
                confidence: r.confidence,
                metadata: null,
                time_updated: null,
                source_symbol_id: r.source_symbol_id,
                target_symbol_id: r.target_symbol_id,
                src_name: src.n, src_type: src.t, src_path: src.path, src_bs: src.bs, src_be: src.be, src_ls: src.ls, src_le: src.le,
                tgt_name: tgt.n, tgt_type: tgt.t, tgt_path: tgt.path, tgt_bs: tgt.bs, tgt_be: tgt.be, tgt_ls: tgt.ls, tgt_le: tgt.le,
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

async function testContent(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2-content-"))
  const raw = makeFixture(dir)
  const { hover } = await import(COMPONENT)

  // Position inside greet() (0-based line 8 → 1-based line 9).
  const result = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
  check("G1: hover returns symbol name", result.data?.name === "greet", JSON.stringify(result.data))
  check("G1: hover returns signature containing name", (result.data?.signature ?? "").includes("greet"), result.data?.signature)
  check("G1: hover returns the usage-site count (3 stored callers)", result.data?.usageCount === 3, String(result.data?.usageCount))
  check("G1: hover returns evidence tiers", (result.data?.evidenceTiers ?? []).length > 0, JSON.stringify(result.data?.evidenceTiers))
  check("G1: hover content is markdown", result.contents?.kind === "markdown")
  check("G1: hover content labeled as bb index source", (result.contents?.value ?? "").includes("bb index"))
  cleanupDir(dir)
}

async function testConsistency(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2-cons-"))
  const raw = makeFixture(dir)
  const { hover } = await import(COMPONENT)

  const result = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
  const sid = result.data ? (result.data.name === "greet" ? "sym-greet" : null) : null
  // The gate states the T3 vocabulary itself (plain JS, above): incoming,
  // non-declaration, resolvable other end, deduplicated by referencing symbol.
  const direct = sid === null ? -1 : expectedUsageSites(sid).size
  check("G2: usage count agrees with the stored usage sites", sid !== null && result.data?.usageCount === direct, `${result.data?.usageCount} vs ${direct}`)
  check(
    "G2: the owning-class declaration and greet's own outgoing row are not counted",
    sid !== null && expectedUsageSites(sid).size === 3 && result.data?.usageCount === 3,
    `${result.data?.usageCount}`,
  )
  cleanupDir(dir)
}

async function testHonesty(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2-hon-"))
  const raw = makeFixture(dir)
  const { hover } = await import(COMPONENT)

  // Position outside every indexed symbol — derived from the fixture text
  // (the pre-M55 hard-coded line 13 is inside callerA since T3's fixture).
  const pastEnd = FIXTURE_SOURCE.split("\n").length + 5
  const result = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: pastEnd, character: 0 } })
  check("G3: not-indexed position returns null contents", result.contents === null)
  check("G3: not-indexed position has no fabricated data", result.data === null)
  check("G3: provenance explains not indexed", (result.provenance.limitations.join(" ") || "").includes("not indexed"))

  // Unsupported language: declared absence with provenance. python JOINED the
  // launch set in the M29 wave — the declared-absence oracle must be a
  // language that stays outside the set.
  const result2 = await hover(raw, { filePath: join(dir, "fixture.rb"), position: { line: 0, character: 0 } })
  check("G3: unsupported language returns null contents", result2.contents === null)
  check("G3: unsupported language provenance explains launch set", (result2.provenance.limitations.join(" ") || "").includes("launch"))
  cleanupDir(dir)
}

async function testPositions(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2-pos-"))
  const raw = makeFixture(dir)
  const { hover } = await import(COMPONENT)

  // greet() spans index lines 9-11 (1-based); a position on 0-based line 8
  // inside it must resolve to greet via the P1 component.
  const result = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
  check("G4: position inside symbol range resolves to the symbol", result.data?.name === "greet", JSON.stringify(result.data))

  // Range conversion must come from P1: greet() spans index lines 8-10
  // (1-based), byte cols 1-4 (end exclusive) → LSP 0-based range.
  const { createPositionMapper } = await import(join(ROOT, "src", "lsp", "positions.ts"))
  const mapper = createPositionMapper(FIXTURE_SOURCE)
  const expected = mapper.indexRangeToLsp({ start: { line: 8, column: 1 }, end: { line: 10, column: 4 } })
  check(
    "G4: hover range equals P1 conversion of indexed range",
    JSON.stringify(result.range) === JSON.stringify(expected),
    `${JSON.stringify(result.range)} vs ${JSON.stringify(expected)}`,
  )
  cleanupDir(dir)
}

async function testFreshness(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2-fr-"))
  const raw = makeFixture(dir)
  const { hover } = await import(COMPONENT)

  // Fresh file: no stale marker.
  const fresh = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
  check("G5: fresh file → stale=false", fresh.data?.stale === false, JSON.stringify(fresh.data))
  check("G5: fresh hover provenance not marked stale", fresh.provenance.stale === false)

  // Stale file: edit the fixture on disk; hash now differs from the index.
  writeFileSync(join(dir, FILE_PATH_REL), FIXTURE_SOURCE + "\n// edited after indexing\n")
  const stale = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
  check("G5: edited file → stale=true", stale.data?.stale === true, JSON.stringify(stale.data))
  check("G5: stale hover includes stale marker in content", (stale.contents?.value ?? "").includes("stale"))
  check("G5: stale hover provenance carries evidenceClass stale", stale.provenance.evidenceClass === "stale")
  cleanupDir(dir)
}

async function testLatency(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2-lat-"))
  const raw = makeFixture(dir)
  const { hover } = await import(COMPONENT)

  // Warm the path first.
  for (let i = 0; i < 10; i++) {
    await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
  }
  const samples: number[] = []
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now()
    await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  check("G6: p95 warm hover under 50ms budget", p95 < 50, `p95=${p95.toFixed(2)}ms`)
  cleanupDir(dir)
}

function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

// --- Hover mutants -----------------------------------------------------------

const HOVER_MUTANTS: Array<{ name: string; from: string; to: string }> = [
  {
    // M55.T3: the hover's count is now DERIVED from the usage-site collection
    // (count and list are the same array), so the count mutation has to be
    // planted on that derivation. The pre-M55 anchor (`  return row.c`) no
    // longer exists and the mutant was silently skipping — found by the T3
    // sweep.
    name: "content: usage count off by one",
    from: "  const usageCount = usageSiteRows.length",
    to: "  const usageCount = usageSiteRows.length + 1",
  },
  {
    // M55.T5: the tier RULE moved to src/lsp/evidence_tier.ts (one owner for
    // every surface), so the pre-M55 anchor (the hover's local structural
    // branch) no longer exists and the mutant was silently skipping — found
    // by the T5 sweep. The defect is planted where the hover still owns the
    // answer: the CARD's tier line, which must render the owner's tier list.
    name: "content: wrong tier label (structural rows mislabeled)",
    from: 'lines.push(`evidence: ${data.evidenceTiers.join(", ")}`)',
    to: 'lines.push(`evidence: indexed`)',
  },
  {
    name: "honesty: fabricate not-indexed entry",
    from: "if (!found) {\n    return {\n      contents: null,",
    to: "if (false) {\n    return {\n      contents: null,",
  },
  {
    name: "freshness: never mark stale",
    from: 'const stale = freshnessStatus !== "fresh"',
    to: "const stale = false",
  },
]

async function runHoverMutants(): Promise<number> {
  console.log("Hover mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0

  for (const mutant of HOVER_MUTANTS) {
    if (!source.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    const mutantPath = join(ROOT, "validation", "m24", `hover.mutant.${Date.now()}.ts`)
    // The mutant is written outside src/, so its relative imports would break.
    // Rewrite them to absolute file:// paths against the real sources.
    // Rewrite EVERY relative import of the component copy to absolute file://
    // URLs against the real sources (../brain/* -> src/brain, ../ast/* ->
    // src/ast, ./x -> src/lsp) — a missed specifier would make the mutant
    // fail to LOAD, which the harness would hollowly count as "caught".
    const absImport = mutantSource.replace(/from "(\.\.\/(?:brain|ast)\/[a-z0-9_-]+|\.\/[a-z0-9_-]+)"/g, (_m, spec: string) => {
      const rel = spec.startsWith("../ast/")
        ? `src/ast/${spec.slice(7)}.ts`
        : spec.startsWith("../brain/")
          ? `src/brain/${spec.slice(9)}.ts`
          : `src/lsp/${spec.slice(2)}.ts`
      return `from "file://${join(ROOT, rel).replace(/\\/g, "/")}"`
    })
    writeFileSync(mutantPath, absImport)
    // Load and probe are separated on purpose: a module that fails to LOAD is
    // not evidence that the mutant was functionally caught (the pre-M55 split
    // reported an oracle crash as a load failure, which reads as a hollow
    // catch). Each outcome is named for what it is.
    let mod: any
    try {
      mod = await import(mutantPath)
    } catch (error) {
      console.log(`  NOT-CAUGHT (mutant module failed to load): ${mutant.name} — ${String(error).slice(0, 120)}`)
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    try {
      const ok = await hoverMutantOracle(mod)
      if (ok) {
        caught++
        console.log(`  caught: ${mutant.name}`)
      } else {
        console.log(`  SURVIVED: ${mutant.name}`)
      }
    } catch (error) {
      caught++
      console.log(`  caught (the mutant broke the declared path: ${String(error).slice(0, 90)}): ${mutant.name}`)
    } finally {
      try { rmSync(mutantPath, { force: true }) } catch {}
    }
  }
  return caught
}

/** Oracle for hover mutants: returns true when the mutation visibly breaks a
 *  declared guarantee against the fixture-backed double. */
async function hoverMutantOracle(mod: any): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2mut-"))
  try {
    const raw = makeFixture(dir)
    const { hover } = mod

    // Content oracle: usage count must match the fixture's stored call sites
    // (3 for greet — M55.T3 vocabulary; the fixture's contains row and the
    // outgoing `return` row are not usages).
    const result = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
    if (result.data?.usageCount !== 3) return true
    // Tier honesty, stated by the CURRENT rule (M55.T5 closed vocabulary: the
    // legend's five tiers + the declared unknown). The `calls`/`contains` rows
    // are parser-deterministic structural facts; the low-confidence `return`
    // row is an unrecognized kind, which the legend defines as `inferred` (a
    // heuristic classification) — the pre-T5 `semantic_candidate` bucket is
    // retired, and the tier list may only contain legend tiers (that is what
    // makes it renderable at all). The card must render that same list.
    const tiers: string[] = result.data?.evidenceTiers ?? []
    if (!tiers.includes("structural")) return true
    if (!tiers.includes("inferred")) return true
    if (tiers.some((t) => !["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"].includes(t))) return true
    if (!result.contents?.value) return true
    const card = result.contents.value
    if (!card.includes("evidence: structural, inferred")) return true

    // Honesty oracle: not-indexed position must not fabricate. Derived from
    // the fixture (the pre-M55 hard-coded line 13 is INSIDE callerA now).
    const pastEnd = FIXTURE_SOURCE.split("\n").length + 5
    const notFound = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: pastEnd, character: 0 } })
    if (notFound.contents !== null || notFound.data !== null) return true

    // Freshness oracle: an edited file must produce a stale marker.
    writeFileSync(join(dir, FILE_PATH_REL), FIXTURE_SOURCE + "\n// edited\n")
    const stale = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
    if (stale.data?.stale !== true) return true
    if (stale.provenance.evidenceClass !== "stale") return true

    return false
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L2 verifier — hover over the persisted index\n")

  await testContent()
  await testConsistency()
  await testHonesty()
  await testPositions()
  await testFreshness()
  await testLatency()

  const mutantsCaught = await runHoverMutants()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(readFileSync(COMPONENT)).digest("hex")
  const ok = failed === 0 && mutantsCaught === HOVER_MUTANTS.length
  const status = ok ? "verified" : "known-gap"

  const evidence = {
    issue: "491",
    code: "L2",
    status,
    currentCommit,
    sourceFingerprint,
    verifierCommand: "npx tsx script/m24/verify-hover.ts",
    evidenceFile: "L2.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    verdict: {
      realComponentFailures: failed,
      mutantsCaught,
      mutantsTotal: HOVER_MUTANTS.length,
      ok,
      note: "`failed` counts real functional failures only; mutant runs are reported separately via the verdict block.",
    },
    limitations: [
      "index-sourced only; no compiler-backed types (complement stance)",
      "evidence tiers describe relationship data quality, not symbol truth",
      "fixture-backed double for the DB layer; live brain.db path covered by upstream freshness verifiers and the V1 harness",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nL2: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${mutantsCaught}/${HOVER_MUTANTS.length} mutants caught, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})
