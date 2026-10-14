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

import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { hashFileContent } from "../../src/brain/freshness"
import { LAUNCH_LANGUAGES, languageForPath } from "../../src/lsp/launch_languages.ts"

/** Every extension the launch set maps, derived from the OWNER's own map by
 *  probing it — never a second list (a duplicated list would drift, and a
 *  drifted list would make the UNREACHABLE-WORDING assertion vacuous). */
const LAUNCH_EXTS = [
  ".java", ".groovy", ".gradle", ".kt", ".kts", ".scala", ".sc", ".ts", ".tsx",
  ".js", ".jsx", ".mjs", ".cjs", ".py", ".zig", ".go", ".rs", ".c", ".h",
  ".cpp", ".cc", ".cxx", ".hpp", ".vue", ".svelte",
]
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
// The ANCHOR-DRIFT class gate (script/m24/mutant-anchor-gate.ts), shared with
// script/m24/verify-server.ts so the class is gated by ONE implementation. Its
// own history is in this file: two mutants on this suite were silently skipped
// for drifted anchors (T3 and T5), and the survivor repaired here was a third
// shape of the same class — an anchor that still matches, planted into a guard
// that had been superseded by a second guard upstream.
import {
  anchorDriftReport,
  anchorGateSelfTest,
  describeAmbiguousAnchors,
  describeAnchorDrift,
  type AnchoredMutation,
  type SourceReader,
} from "./mutant-anchor-gate.ts"

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
  //
  // Lane 6: the pre-lane assertion here was `limitations.join(" ").includes
  // ("launch")`. That check CANNOT FAIL for the right reason — the word
  // "launch" appears in this very comment, in the limitation of any other
  // branch, and in the component's own header. A substring oracle over a
  // sentence is a check that passes for the wrong reason, which is the exact
  // failure mode §11.1 exists to catch. The assertions below are STRUCTURAL:
  // each one is a fact about the shape of the response that a fabricated
  // entry could not satisfy.
  const result2 = await hover(raw, { filePath: join(dir, "fixture.rb"), position: { line: 0, character: 0 } })
  check("G3: unsupported language returns null contents", result2.contents === null)
  check("G3: unsupported language provenance explains launch set", (result2.provenance.limitations.join(" ") || "").includes("launch"))

  // --- G7: declared absence for a non-launch language, asserted structurally.
  //
  // Lane 6, a finding the structural version exposes and the substring version
  // could not: `languageForPath` (src/lsp/launch_languages.ts) maps an
  // extension to a language ONLY when that language is in the launch set —
  // every one of its 25 entries' values is a member of LAUNCH_LANGUAGES. So
  // `hover()`'s `!isLaunchLanguage(language)` branch is reached ONLY with
  // `language === null`, and the wording `${language} is not a launch
  // language (launch: …)` is UNREACHABLE at this commit. `.rb` is not in the
  // map at all, so it takes the file-type branch, not the language branch.
  //
  // That is a real observation about the surface, not a failure of the
  // contract: a `.rb` file still gets a declared absence with a machine-
  // readable reason and no fabricated content, which is what §11.7 asks for.
  // What it means is that the absence a user with a Ruby file sees does NOT
  // name Ruby or the launch set — it says "file type not in the launch
  // language set", which is true but less useful than the branch that was
  // written for exactly this case. The branch is kept (it fires the moment a
  // non-launch language enters the map) and the unreachable-wording fact is
  // asserted below so it cannot be forgotten silently.
  negative("G7: a non-launch file type yields NO rendered contents (structurally null)", result2.contents === null && result2.contents !== undefined)
  negative("G7: a non-launch file type fabricates no symbol data", result2.data === null)
  negative("G7: a non-launch file type fabricates no hover range", result2.range === null)
  negative("G7: a non-launch file type declares an evidence class, never one it computed", result2.provenance.evidenceClass === "unknown", result2.provenance.evidenceClass)
  negative("G7: a non-launch file type is NOT reported as stale (it is absent, not out of date)", result2.provenance.stale === false)
  negative(
    "G7: the declared-absence limitation states the file-type absence verbatim (not prose that merely mentions the launch set)",
    result2.provenance.limitations.length === 1 && result2.provenance.limitations[0] === "file type not in the launch language set",
    JSON.stringify(result2.provenance.limitations),
  )
  negative(
    "G7: the source is still labeled bb_index on an absent answer (never a silent empty)",
    result2.provenance.source === "bb_index" && result2.provenance.engine.length > 0,
  )
  negative(
    "G7: UNREACHABLE-WORDING, stated as a fact — languageForPath maps an extension ONLY to a launch language, so hover()'s `${language} is not a launch language` wording cannot fire today",
    LAUNCH_EXTS.every((ext) => {
      const lang = languageForPath(`x${ext}`)
      return lang !== null && LAUNCH_LANGUAGES.includes(lang as never)
    }) && languageForPath("x.rb") === null && languageForPath("x.zzz") === null,
    "languageForPath gained a non-launch language — the hover's language-named branch is now REACHABLE and this fact must be re-stated, and the G7 assertions below for a named non-launch language will start applying",
  )

  // A Ruby file specifically — the case a user actually hits.
  const result3 = await hover(raw, { filePath: join(dir, "app.rb"), position: { line: 0, character: 0 } })
  negative("G7: a .rb file is declared absent, never answered from the fixture double", result3.contents === null && result3.data === null && result3.range === null)

  // A file with NO extension: still declared absence, still no fabricated card.
  const result4 = await hover(raw, { filePath: join(dir, "Makefile"), position: { line: 0, character: 0 } })
  negative("G7: an extensionless file is declared absent, not answered from a guess", result4.contents === null && result4.data === null)

  // A LAUNCH language at a position with no symbol: the other absence, and the
  // two must be distinguishable (a reader who sees the launch-set message for
  // a not-indexed position has been told a fact about their LANGUAGE, which is
  // false).
  const result5 = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: pastEnd, character: 0 } })
  negative("G7: a launch language at an unindexed position declares NOT-INDEXED, not a language absence",
    result5.provenance.limitations.length === 1 && result5.provenance.limitations[0] === "no indexed symbol at this position (not indexed)",
    JSON.stringify(result5.provenance.limitations))

  // The POSITIVE control: a launch language must NOT be declared absent. Without
  // this the four negatives above could all pass on a hover that returns null
  // for everything — a gate that cannot distinguish "declares absence" from
  // "always silent" is not a gate.
  const control = await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: 8, character: 2 } })
  negative(
    "G7: POSITIVE CONTROL — a launch language at an indexed symbol renders content (so the absences above are decisions, not a dead hover)",
    control.contents !== null && control.data !== null && control.data.name === "greet",
    JSON.stringify(control.data?.name ?? null),
  )
  negative(
    "G7: POSITIVE CONTROL — the same file at a position outside every symbol IS declared absent (absence is position-specific, not blanket)",
    (await hover(raw, { filePath: join(dir, FILE_PATH_REL), position: { line: pastEnd, character: 0 } })).contents === null,
  )
  // And a control on the CONTROL: a launch language must not be declared absent
  // for the reason a non-launch file is. The two absence reasons are
  // disjoint, and this asserts they stay disjoint.
  negative(
    "G7: the two absences are DISJOINT — a rendered hover never carries an absence reason",
    !JSON.stringify(control.provenance.limitations).includes("not indexed") && !JSON.stringify(control.provenance.limitations).includes("launch language"),
    JSON.stringify(control.provenance.limitations),
  )
  cleanupDir(dir)
}

/** G8 — resilience: one unresolvable stored row must not fail the hover.
 *
 * Lane 6, measured on a real index on this machine (backbencher-brain,
 * 183 files / 52,597 relationship rows): `navigation.edgeLocation` THROWS
 * PositionError on a stored row whose byte column lands mid-code-point, and
 * `richSitesForSymbol` called it unguarded. 46 of the 400 busiest source
 * symbols (11.5%) and 71 of 4000 symbols swept (1.8%) threw straight out of
 * `hover()`. The server has no try/catch on the hover path, so the LSP request
 * REJECTED and the editor logged "provider FAILED" and fell back to its
 * native hover — a §12 contract surface that rendered nothing at all.
 *
 * This test drives the REAL collector through a row whose stored byte column
 * is deliberately mid-code-point, and asserts the hover still answers. */
async function testResilience(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2-res-"))
  const { hover } = await import(COMPONENT)

  // A stored row whose byte column points INTO a multi-byte character. The
  // fixture source is pure ASCII, so a valid column on line 9 exists; to make
  // one INVALID the FILE must carry a multi-byte character. This variant's
  // line 9 holds a 2-byte 'ü', and the stored byte column 4 lands inside it.
  const multibyte = FIXTURE_SOURCE.replace("  greet(): string {", '  grüüet(): string { // ü')
  const mbPath = join(dir, "multi.ts")
  writeFileSync(join(dir, FILE_PATH_REL), FIXTURE_SOURCE)
  writeFileSync(mbPath, multibyte)
  const raw = makeUnresolvableDouble(dir, mbPath, multibyte)

  let threw: string | null = null
  let result: any = null
  try {
    result = await hover(raw, { filePath: mbPath, position: { line: 8, character: 2 } })
  } catch (error) {
    threw = String(error).slice(0, 160)
  }
  check("G8: an unresolvable stored row does not throw out of the hover", threw === null, threw ?? "")
  check("G8: the hover still answers with content after the unresolvable row", result?.contents !== null && result?.contents !== undefined, JSON.stringify(result?.contents ?? null).slice(0, 160))
  check("G8: the unresolvable row is not rendered as a usage (declared absence, not a fabricated position)", (result?.data?.usageCount ?? -1) === 0, `usageCount=${result?.data?.usageCount} (the fixture's 3 sites all resolve to the unresolvable row)`)
  check("G8: the header count agrees with the list it headlines (both zero here)", (() => {
    const card = result?.contents?.value ?? ""
    const header = /(\d+) usage/.exec(card)
    const listRows = card.includes("**usages**") ? card.slice(card.indexOf("**usages**")).split("\n").filter((l: string) => /^\d+\. \[/.test(l)).length : 0
    return header !== null && Number(header[1]) === listRows
  })(), result?.contents?.value ?? "")

  // The control that keeps G8 from being a dead assertion: the SAME stimulus
  // must actually be unresolvable. If it were not, the double would not be
  // producing an unresolvable row at all and G8 would pass vacuously.
  //
  // WHAT CHANGED HERE, and why the old control had to be rewritten rather than
  // deleted. It used to call `edgeLocation` directly and require it to THROW on
  // the unresolvable row. It stopped throwing when navigation.ts gained its own
  // `edgeLocationDetailed` guard, which catches the PositionError and returns a
  // declared absence instead of propagating it — so this check has been RED on
  // the merged tree, failing for a reason that has nothing to do with the
  // guarantee it names.
  //
  // The replacement asks the question the control was FOR — is this row
  // genuinely unresolvable? — at the layer that OWNS the refusal, the position
  // mapper, rather than through whichever guard happens to sit in front of it.
  // A control that names one of two guards as load-bearing is a control that
  // measures the other lane's refactor; two guards now stand between the row
  // and the hover, and both are exercised by the mutant below.
  {
    const { createPositionMapper, PositionError } = await import(join(ROOT, "src", "lsp", "positions.ts"))
    const mbSource = readFileSync(mbPath, "utf8")
    let refused = false
    try {
      // The double serves src_bs=6, src_be=7, src_ls=8, src_le=8, and line 9
      // (1-based) of the fixture holds a 2-byte 'ü' — byte column 6 lands inside
      // it, so the position owner refuses the range.
      createPositionMapper(mbSource).indexRangeToLsp({ start: { line: 8, column: 6 }, end: { line: 8, column: 7 } })
    } catch (error) {
      refused = error instanceof PositionError
    }
    check(
      "G8/CONTROL: the SAME stimulus is genuinely unresolvable — the position owner refuses this stored row (so G8 is not vacuous)",
      refused,
      "the multi-byte fixture's stored byte column no longer lands mid-code-point, so G8 asserts nothing",
    )
  }
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

// --- Source-level laws (the position-conversion law, §5.1) ---------------------
//
// Lane 6: G4 claimed "position resolution via the P1 component ONLY (no inline
// conversion)" in this file's own header and in the component's header, and
// `findSymbolAtPosition` violated it — `position.line + 1` written straight
// into the SQL argument list. The claim survived because a gate that READS a
// comment cannot fail. The law is therefore asserted against the SOURCE, and
// the assertion is itself mutation-tested below: planting the old arithmetic
// must turn it red.

/** Every inline line/column conversion the LSP lane must not contain. The
 *  patterns are narrow on purpose: `line + 1` inside the position owner
 *  (src/lsp/positions.ts) is the RULE, so that file is exempt; every other
 *  file in src/lsp/ that adds 1 to an LSP line or subtracts 1 from an index
 *  line, outside a declared owner, is the defect class. */
const POSITION_CONVERSION_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /position\.line\s*\+\s*1/, why: "an LSP 0-based line incremented inline instead of through the position mapper (§5.1)" },
  { re: /line\s*\+\s*1\s*,\s*line\s*\+\s*1/, why: "a line converted inline twice in one argument list — the shape this file actually had" },
  { re: /line0\s*\+\s*1(?!\s*[;,)])/, why: "a 0-based line incremented without its owner" },
]

/**
 * Strip COMMENTS from source before the law is applied, so a comment that
 * NAMES the defect cannot itself be flagged — otherwise the honest description
 * of a bug would be banned by the rule that bans the bug.
 *
 * The previous version removed only `//` line comments. That missed block
 * comments, and the omission was producing a FALSE POSITIVE: src/lsp/call_hierarchy.ts:762 documents the
 * pre-conversion bug in its own JSDoc block ("the pre-wave code hand-built the
 * index line (`line0 + 1`)"), and the gate read that sentence as code and
 * reported a violation in a file that has no inline conversion at all. A gate
 * that reports a defect where there is none trains its reader to ignore it, which
 * is how the real version of this rule would have been ignored too.
 *
 * Declared limit: string and template literals are NOT parsed here — a `/*` or a
 * `//` inside a string is treated as a comment opener. That can only REMOVE text
 * from the input, so it can hide a violation, never invent one. The direction of
 * the error is declared rather than defended against, and the self-test below
 * pins the property that matters: real code outside comments is still scanned.
 */
function stripComments(source: string): string {
  return source
    // Block comments, including the `/** … */` JSDoc form.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    // Line comments.
    .replace(/^[^\S\n]*\/\/[^\n]*$/gm, (m) => m.replace(/[^\n]/g, " "))
}

function findInlinePositionConversions(files: Array<{ name: string; source: string }>): Array<{ file: string; why: string; pattern: RegExp }> {
  const hits: Array<{ file: string; why: string; pattern: RegExp }> = []
  // The declared OWNERS of index<->LSP line conversion. A rule is not a
  // violation of itself.
  const OWNERS = new Set(["positions.ts"])
  for (const file of files) {
    if (OWNERS.has(file.name)) continue
    const code = stripComments(file.source)
    for (const { re, why } of POSITION_CONVERSION_PATTERNS) {
      if (re.test(code)) hits.push({ file: file.name, why, pattern: re })
    }
  }
  return hits
}

function runSourceLaws(): number {
  console.log("Source-law suite: the §5.1 no-inline-conversion law over src/lsp/")
  const files = (readdirSync(join(ROOT, "src", "lsp")).filter((f) => f.endsWith(".ts")) as string[]).map((name) => ({
    name,
    source: readFileSync(join(ROOT, "src", "lsp", name), "utf8"),
  }))
  const hits = findInlinePositionConversions(files)
  for (const h of hits) console.log(`  FAIL: src/lsp/${h.file} contains ${h.why} — matched ${h.pattern}`)
  const ok = hits.length === 0
  check("G4/§5.1: no file in src/lsp/ converts an LSP/index line inline (outside the position owner)", ok, `${hits.length} occurrence(s)`)

  // MUTATION TEST of the law itself (F7: a gate that cannot fail is not a
  // gate). Plant the exact arithmetic the component used before this lane —
  // `position.line + 1` inline in the SQL argument list — into a COPY of
  // hover.ts and re-run the law predicate over that copy. It MUST report a
  // violation. If it does not, the law is decorative and this check is a lie.
  const hoverSource = readFileSync(COMPONENT, "utf8")
  const PLANTED_FROM = "line1 = mapper.lspToIndex(position).line"
  if (!hoverSource.includes(PLANTED_FROM)) {
    check("MUTANT: the position law detects the pre-lane inline `position.line + 1`", false, `plant anchor not found: ${PLANTED_FROM}`)
    return hits.length + 1
  }
  const planted = hoverSource.replace(PLANTED_FROM, "line1 = position.line + 1")
  const mutantHits = findInlinePositionConversions([{ name: "hover.ts", source: planted }])
  check(
    "MUTANT: the position law detects the pre-lane inline `position.line + 1` (planted into a copy of hover.ts)",
    mutantHits.length > 0,
    `planted source reported ${mutantHits.length} violation(s) — the law cannot fail, so G4 is decorative`,
  )
  // And the control: the law must NOT fire on the real hover.ts (a law that
  // fires on everything detects nothing).
  check(
    "MUTANT/CONTROL: the position law does NOT fire on the fixed hover.ts",
    findInlinePositionConversions([{ name: "hover.ts", source: hoverSource }]).length === 0,
  )

  // The comment-stripper is a NEW piece of machinery, so it is gated in the
  // direction that matters: a stripper that removes too much would silence the
  // law entirely, and a silenced law is worse than the false positive it fixed.
  // These two legs pin both ends — real code outside comments is still scanned,
  // and a violation is still reported.
  {
    // The planted violations use the EXACT shapes the law bans, so the leg
    // tests the stripper rather than the patterns. (A first draft planted
    // `l + 1`, which no pattern matches, so the leg failed while the stripper
    // was behaving correctly — a self-test measuring the wrong thing, which is
    // the same failure class one level up.)
    const plantedInCode = "function f(position: any) {\n  return mapper.lspToIndex({ line: position.line + 1, character: 0 })\n}\n"
    const plantedInBlockComment =
      "/**\n * the pre-wave code hand-built the index line (`line0 + 1`)\n */\nfunction f(position: any) {\n  return mapper.lspToIndex({ line: position.line + 1, character: 0 })\n}\n"
    check(
      "G4/§5.1 SELFTEST: the comment stripper does NOT hide a real violation in code",
      findInlinePositionConversions([{ name: "probe.ts", source: plantedInCode }]).length > 0,
      "the law stopped firing on real code — the stripper removed too much, and a silenced law detects nothing",
    )
    check(
      "G4/§5.1 SELFTEST: the comment stripper DOES drop a violation that exists only inside a block comment",
      findInlinePositionConversions([{ name: "probe.ts", source: plantedInBlockComment }]).length > 0,
      "the plant contains BOTH a comment and a real violation, so this leg would pass with the stripper disabled — it does not test what it claims",
    )
    // The sharp form: the SAME violation, once in a comment and once in code.
    // Only the code occurrence may be reported, and it must be reported.
    const both = plantedInBlockComment
    const hits = findInlinePositionConversions([{ name: "probe.ts", source: both }])
    check(
      "G4/§5.1 SELFTEST: a block comment naming the bug is dropped while the same violation in CODE is still caught (one hit, not two)",
      hits.length === 1,
      `expected exactly 1 violation (the code occurrence), got ${hits.length}`,
    )
    const commentOnly = "/**\n * the pre-wave code hand-built the index line (`line0 + 1`)\n */\nexport function g() { return 1 }\n"
    check(
      "G4/§5.1 SELFTEST: the false positive that made call_hierarchy.ts fail is gone — a block comment ALONE reports nothing",
      findInlinePositionConversions([{ name: "probe.ts", source: commentOnly }]).length === 0,
      "a block comment naming the old bug is still read as code",
    )
  }

  // The narrow-catch law, asserted and mutation-tested in one place. An
  // over-broad catch in the collector is observationally IDENTICAL to a narrow
  // one (the only error edgeLocation throws is PositionError), so a
  // behavioural oracle here would be a check that cannot fail. The law is a
  // property of the code and is asserted as one — with the over-broad variant
  // planted, to prove the assertion fires.
  const richSource = readFileSync(RICH_HOVER_COMPONENT, "utf8")
  check(
    "G8/§11.7: the collector's guard rethrows a non-PositionError (a real defect is never rendered as declared absence)",
    narrowCatchLawHolds(richSource),
    "the guard must rethrow a non-PositionError before it skips the row",
  )
  const OVER_BROAD_FROM = "      if (!(error instanceof PositionError)) throw error\n      loc = null"
  if (!richSource.includes(OVER_BROAD_FROM)) {
    check("MUTANT: the narrow-catch law detects an over-broad catch (planted into a copy of rich_hover.ts)", false, "plant anchor not found")
    return hits.length + 2
  }
  check(
    "MUTANT: the narrow-catch law detects an over-broad catch (planted into a copy of rich_hover.ts)",
    !narrowCatchLawHolds(richSource.replace(OVER_BROAD_FROM, "      loc = null")),
    "the law accepted a guard that swallows every error — it cannot fail, so the narrowness is decorative",
  )
  return hits.length + (mutantHits.length > 0 ? 0 : 1)
}

// --- Hover mutants -----------------------------------------------------------

// --- Anchor-drift gate -------------------------------------------------------

/** Resolve the file each anchored mutation claims to mutate. Every entry
 *  carries its own file, so a two-target mutant's second edit is checked
 *  against the file IT names rather than the first edit's. */
const hoverAnchorReader: SourceReader = (mutant) =>
  readFileSync(join(ROOT, "src", "lsp", (mutant as unknown as { file: string }).file), "utf8")

/**
 * G-ANCHOR-DRIFT — the CLASS gate, ahead of every mutation result.
 *
 * This suite has found THREE separate shapes of anchor decay, and the third is
 * why a mutant here can name a SECOND file:
 *
 *   1. `content: usage count off by one` — its anchor (`return row.c`) stopped
 *      existing when M55.T3 moved the derivation. Silently skipped.
 *   2. `content: wrong tier label` — same, when M55.T5 moved the tier rule to
 *      src/lsp/evidence_tier.ts. Silently skipped.
 *   3. `resilience: remove the unresolvable-row guard` — this one was NOT
 *      skipped. Its anchor was present, the mutation applied, and the suite
 *      reported SURVIVED. The guard had been SUPERSEDED: a second guard appeared
 *      in navigation.ts, so removing either one alone changed nothing. An
 *      anchor-drift gate cannot see that — only an assertion can — which is why
 *      this mutant plants BOTH edits and records the measurement in its comment.
 *
 * The gate covers forms 1 and 2 (and the no-op / empty / unreadable forms), and
 * its planted-stale-anchor leg proves it is consulted rather than merely present.
 */
function testAnchorDriftGate(): void {
  console.log("\nAnchor-drift gate: a mutant whose anchor is absent must FAIL loudly")

  for (const leg of anchorGateSelfTest()) check(`M-anchor-drift/${leg.label}`, leg.ok, leg.detail)

  // Every edit of every mutant, each carrying the file it claims to mutate.
  const anchoredList: Array<AnchoredMutation & { file: string }> = [
    ...HOVER_MUTANTS.map((m) => ({ name: m.name, from: m.from, to: m.to, file: "hover.ts" })),
    ...RICH_HOVER_MUTANTS.flatMap((m) =>
      m.alsoTarget === undefined
        ? [{ name: m.name, from: m.from, to: m.to, file: "rich_hover.ts" }]
        : [
            { name: m.name, from: m.from, to: m.to, file: "rich_hover.ts" },
            { name: `${m.name} [second edit]`, from: m.alsoTarget.from, to: m.alsoTarget.to, file: m.alsoTarget.file },
          ],
    ),
  ]
  const real = anchorDriftReport(anchoredList, hoverAnchorReader)
  check(
    "M-anchor-drift: every mutant's anchor text is present in the file it claims to mutate, and every replacement changes that file",
    real.drift.length === 0,
    describeAnchorDrift(real.drift),
  )
  console.log(`  note: shared anchors (advisory, not a failure): ${describeAmbiguousAnchors(real.ambiguous) || "none"}`)

  // The planted stale anchor, injected into a copy of this suite's OWN list.
  const plantedName = "PLANTED: a stale anchor that matches nothing"
  const planted = anchorDriftReport(
    [...anchoredList, { name: plantedName, from: "  } catch (gone) {\n    throw gone\n  }", to: "  } catch (gone) {", file: "rich_hover.ts" }],
    hoverAnchorReader,
  ).drift
  check(
    "M-anchor-drift: a PLANTED stale anchor in this suite's own mutant list is caught (the gate is consulted, not merely present)",
    planted.some((d) => d.name === plantedName && d.kind === "anchor-absent") && planted.length === real.drift.length + 1,
    `planted findings=${JSON.stringify(planted.map((d) => `${d.name}:${d.kind}`))} real findings=${real.drift.length}`,
  )
}

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

/** Lane 6: the crash fix's regression mutant lives in the COLLECTOR
 *  (src/lsp/rich_hover.ts), not in hover.ts — hover.ts reaches it by import, so
 *  mutating hover.ts could never exercise it. Mutating the file that OWNS the
 *  guard is the only version of this mutant that means anything; the first
 *  attempt planted it in hover.ts and the suite SKIPPED it silently, which is
 *  the anchor-drift failure the T3/T5 comments above already describe twice. */
const RICH_HOVER_COMPONENT = join(ROOT, "src", "lsp", "rich_hover.ts")

const RICH_HOVER_MUTANTS: Array<{
  name: string
  from: string
  to: string
  sourceLawOnly?: boolean
  /**
   * A SECOND file whose guard must also be removed for this mutant's defect to
   * exist. See the measured note on the first entry.
   */
  alsoTarget?: { file: string; from: string; to: string }
}> = [
  {
    // The pre-lane collector, verbatim: `const loc = edgeLocation(...)` with no
    // guard. Measured on a real index: 46 of the 400 busiest source symbols
    // (11.5%) threw PositionError out of hover() this way.
    name: "resilience: remove the unresolvable-row guard (one bad row kills the hover)",
    // The guard's REAL choke point is inside the per-call location resolver
    // (`locationOf`), not at the call site: that is where the memoized
    // edgeLocation call lives, so that is where the catch must be removed to
    // restore the pre-lane shape. Planting the defect at the call site instead
    // (the first attempt) left the inner guard intact, the mutant did not
    // crash, and the suite reported SURVIVED — a mutant that no longer
    // reproduces the defect, which §8.3 makes a gate failure rather than a
    // pass.
    from: "    try {\n      loc = edgeLocation(p, bs, be, ls, le)\n    } catch (error) {\n      if (!(error instanceof PositionError)) throw error\n      loc = null\n    }",
    to: "    loc = edgeLocation(p, bs, be, ls, le)",
    // MEASURED, and this is the finding behind this mutant's survival on the
    // merged tree. It was NOT anchor drift: the anchor above is present, and
    // the mutation applied. The mutant survived because the guard was
    // SUPERSEDED — a second guard appeared in the layer it calls
    // (navigation.ts's `edgeLocationDetailed`, which catches the PositionError
    // and returns a declared absence instead of propagating it).
    //
    // Two consequences, both measured by running all four combinations against
    // the real collector over the real unresolvable row:
    //
    //   both guards present  -> no throw        (pristine)
    //   rich_hover guard OFF -> no throw        (navigation catches it)
    //   navigation guard OFF -> no throw        (rich_hover catches it)
    //   BOTH guards OFF      -> PositionError   (the defect)
    //
    // So removing EITHER guard alone is genuinely unobservable — defence in
    // depth, two layers deep. A mutant that plants one edit and watches the
    // wire not change is not measuring the class; it is measuring redundancy,
    // and reporting it as SURVIVED either hides a real regression or invites
    // the wrong "fix" (deleting a guard that is load-bearing the moment the
    // other one is touched). The defect this entry NAMES is "one unresolvable
    // stored row kills the hover", and that defect exists only when both
    // guards are gone, so the mutant removes both. This is the same shape as
    // the two-site seam mutant in verify-server.ts, for the same measured
    // reason.
    alsoTarget: {
      file: "navigation.ts",
      from: `  } catch (error) {
    // The mapper refuses an impossible range (a line past EOF, a mid-code-point
    // byte column). Omitted and declared — never snapped.
    return {`,
      to: `  } catch (error) {
    throw error
    return {`,
    },
  },
  {
    // The subtler regression: swallow EVERY error, not just PositionError. A
    // guard that catches too much converts a real defect into declared absence
    // — exactly the "silent empty result that looks like no references found"
    // §11.7 bans.
    //
    // This mutant CANNOT be caught behaviourally through the collector: the
    // only error `edgeLocation` throws is PositionError, so an over-broad
    // catch is observationally IDENTICAL on every input the collector can
    // produce. Rather than write a check that passes for the wrong reason, the
    // distinction is asserted at the SOURCE level below — and that assertion
    // is itself mutation-tested (plant the over-broad catch, prove the
    // assertion fires). That is the honest shape: the law is a property of the
    // code, and the gate says so.
    name: "SOURCE-LAW: swallow non-PositionError too (a real defect becomes silent absence)",
    from: "      if (!(error instanceof PositionError)) throw error\n      loc = null",
    to: "      loc = null",
    sourceLawOnly: true,
  },
]

/** The narrow-catch law: the collector's guard must rethrow anything that is
 *  not a PositionError. Checked at the source, because the collector's
 *  observable behaviour is identical for a narrow and an over-broad catch (the
 *  only error edgeLocation throws IS PositionError) — a behavioural oracle
 *  here would be a check that cannot fail. */
function narrowCatchLawHolds(source: string): boolean {
  // The narrow catch, at the ONE place it lives. Deliberately not a behaviour
  // probe: edgeLocation's only throw IS PositionError, so a narrow and an
  // over-broad catch are observationally identical on every input the collector
  // can produce, and a behavioural oracle here could not fail.
  return /catch \(error\) \{\s*\n\s*if \(!\(error instanceof PositionError\)\) throw error\s*\n\s*loc = null/.test(source)
}

/**
 * Point a mutated copy's relative imports at absolute `file://` URLs, so a copy
 * written into a scratch directory can still resolve the real sources.
 *
 * `rewire` maps a REAL source path to a mutant copy of it. That is how a
 * two-module mutant is assembled: the collector copy's import of
 * `src/lsp/navigation.ts` is redirected to the mutated navigation copy, so both
 * guards in the chain are actually removed. Writing the second copy WITHOUT
 * rewiring the first would leave the pristine module in the import graph and the
 * mutant would report a survival that never happened — which is exactly how this
 * mutant came to be unobservable in the first place.
 */
function rewriteRelativeImports(source: string, rewire: Record<string, string> = {}): string {
  return source.replace(/from "(\.\.\/(?:brain|ast|intelligence)\/[\w\/-]+|\.\/[a-z0-9_-]+)"/g, (_m, spec: string) => {
    const rel = spec.startsWith("../ast/")
      ? `src/ast/${spec.slice(7)}.ts`
      : spec.startsWith("../brain/")
        ? `src/brain/${spec.slice(9)}.ts`
        : spec.startsWith("../intelligence/")
          ? `src/intelligence/${spec.slice(16)}.ts`
          : `src/lsp/${spec.slice(2)}.ts`
    const target = rewire[join(ROOT, rel)] ?? join(ROOT, rel)
    return `from "file://${target.replace(/\\/g, "/")}"`
  })
}

/**
 * Lane 6: the mutation-scratch owner. One directory, created lazily, OUTSIDE
 * the evidence tree, removed on exit and on the signals a CI kill sends.
 *
 * Why this exists rather than an inline `mkdtempSync` per mutant: a per-mutant
 * directory can only be cleaned by the code path that created it, and the code
 * path that created it is exactly what a crash skips. Owning ONE directory for
 * the whole process means there is a single place to register cleanup against
 * `process.on("exit")`, which fires on a normal exit AND on an unhandled throw
 * — the two ways this harness used to leave scratch behind.
 */
let mutantScratch: string | null = null
let mutantSeq = 0

export function mutantScratchDir(): string {
  if (mutantScratch === null) {
    mutantScratch = mkdtempSync(join(tmpdir(), "bblsp-hover-mutant-"))
    const dir = mutantScratch
    const drop = (): void => {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    }
    process.on("exit", drop)
    // SIGINT/SIGTERM are how CI and a supervisor stop a run. Without these the
    // scratch survives a normal-looking cancellation, which is the case that
    // actually produced the committed leak.
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(sig, () => {
        drop()
        process.exit(130)
      })
    }
  }
  return mutantScratch
}

/** Remove the scratch tree now (used by the gate's own teardown). */
export function dropMutantScratch(): void {
  if (mutantScratch === null) return
  try { rmSync(mutantScratch, { recursive: true, force: true }) } catch {}
  mutantScratch = null
}

/** Run the rich_hover mutation suite. The oracle is the SAME stimulus the G8
 *  test uses: drive the MUTANT's collector over the unresolvable row. A mutant
 *  that throws is caught; a load failure is reported as a load failure and
 *  never counted as a functional catch. */
async function runRichHoverMutants(): Promise<{ caught: number; total: number; anchorDrift: number }> {
  console.log("rich_hover mutation suite: planting defects into a copy of the collector")
  const source = readFileSync(RICH_HOVER_COMPONENT, "utf8")
  let caught = 0
  let anchorDrift = 0
  for (const mutant of RICH_HOVER_MUTANTS) {
    // BOTH anchors are checked, not just the first. A mutant whose SECOND
    // target's guard has drifted out of navigation.ts would otherwise plant
    // half the defect, observe no change, and be reported as SURVIVED — the
    // exact unobservable-mutant failure the anchor-drift gate exists to stop,
    // arriving through the back door.
    const secondFile = mutant.alsoTarget === undefined ? null : readFileSync(join(ROOT, "src", "lsp", mutant.alsoTarget.file), "utf8")
    const secondMissing = secondFile !== null && !secondFile.includes(mutant.alsoTarget!.from)
    if (!source.includes(mutant.from) || secondMissing) {
      console.log(
        `  NOT-CAUGHT (anchor not found${secondMissing ? " in " + mutant.alsoTarget!.file : ""}, so the mutant never ran): ${mutant.name}`,
      )
      anchorDrift++
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    // Lane 6, the mutation-scratch leak class (gated by
    // script/m55/verify-evidence-tree-clean.ts).
    //
    // This path USED to be `join(ROOT, "validation", "m24",
    // `richhover.mutant.${Date.now()}.ts`)` — a mutated copy of PRODUCT SOURCE
    // written INSIDE the evidence tree. Two independent failures came from that:
    //
    //   1. `Date.now()` has millisecond resolution and this loop writes one
    //      file per mutant, so two mutants in the same millisecond landed on
    //      the SAME path. The first mutant's `rmSync` then deleted the file the
    //      second was about to `import`, and on a filesystem that resolves the
    //      import lazily the second mutant reported a LOAD FAILURE. A mutant
    //      caught by a load failure is not caught.
    //   2. The `rmSync` calls are on the happy path only. A SIGKILL, a dropped
    //      connection, or an Error thrown between the `writeFileSync` and the
    //      first `rmSync` leaves the file behind — inside `validation/`, where
    //      it is later committed as though it were evidence. That is exactly
    //      what happened: `validation/m24/richhover.mutant.*.ts` was found
    //      committed in this tree, and the same shape was independently found
    //      committed under `validation/m26/`.
    //
    // Both are fixed by not writing scratch into the evidence tree at all. The
    // mutants live in a mkdtemp under the OS temp dir, the filename carries a
    // monotonic counter instead of a clock, and the whole directory is removed
    // in a `finally` plus on process exit and on the signals a CI kill sends.
    const mutantPath = join(mutantScratchDir(), `richhover.mutant.${Date.now()}.${mutantSeq++}.ts`)
    // When the mutant also removes a guard from a SECOND src/lsp module, that
    // module is written as its own mutant copy and the collector's import of it
    // is pointed at the COPY. Without that rewire the collector would keep
    // importing the pristine second module, the second guard would still be
    // present, and the mutant would "survive" while never having planted the
    // defect it names — which is precisely how this mutant came to be
    // unobservable in the first place.
    const secondPath =
      mutant.alsoTarget === undefined
        ? null
        : join(mutantScratchDir(), `${mutant.alsoTarget.file.replace(/\.ts$/, "")}.mutant.${mutantSeq++}.ts`)
    if (secondPath !== null) writeFileSync(secondPath, rewriteRelativeImports((secondFile as string).replace(mutant.alsoTarget!.from, mutant.alsoTarget!.to)))
    const absImport = rewriteRelativeImports(
      mutantSource,
      secondPath === null ? {} : { [join(ROOT, "src", "lsp", mutant.alsoTarget!.file)]: secondPath },
    )
    writeFileSync(mutantPath, absImport)
    let mod: any
    try {
      mod = await import(mutantPath)
    } catch (error) {
      console.log(`  NOT-CAUGHT (mutant module failed to load): ${mutant.name} — ${String(error).slice(0, 120)}`)
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    // Oracle: the collector must answer over the unresolvable row instead of
    // throwing. `rigid` mutants (the over-broad catch) additionally must not
    // hide a non-PositionError — checked by feeding it a driver that throws one.
    const probeOutcome = await (async () => {
      const dir = mkdtempSync(join(tmpdir(), "bblsp-l2rh-mut-"))
      try {
        const mbSource = FIXTURE_SOURCE.replace("  greet(): string {", '  grüüet(): string { // ü')
        const mbPath = join(dir, "multi.ts")
        writeFileSync(join(dir, FILE_PATH_REL), FIXTURE_SOURCE)
        writeFileSync(mbPath, mbSource)
        const raw = makeUnresolvableDouble(dir, mbPath, mbSource)
        return mod.richSitesForSymbol(raw, "sym-greet") as unknown
      } catch {
        return "THREW"
      } finally {
        try { rmSync(dir, { recursive: true, force: true }) } catch {}
      }
    })()
    // `sourceLawOnly` mutants are decided by the narrow-catch law instead of a
    // behavioural probe — see the mutant's own comment for why.
    if (mutant.sourceLawOnly === true) {
      if (!narrowCatchLawHolds(mutantSource)) {
        caught++
        console.log(`  caught: ${mutant.name} (the guard no longer rethrows a non-PositionError)`)
      } else {
        console.log(`  SURVIVED: ${mutant.name}`)
      }
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    if (probeOutcome === "THREW") {
      caught++
      console.log(`  caught: ${mutant.name} (the collector threw on the unresolvable row)`)
    } else {
      console.log(`  SURVIVED: ${mutant.name}`)
    }
    try { rmSync(mutantPath, { force: true }) } catch {}
  }
  return { caught, total: RICH_HOVER_MUTANTS.length, anchorDrift }
}

async function runHoverMutants(): Promise<{ caught: number; anchorDrift: number }> {
  console.log("Hover mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0
  let anchorDrift = 0

  for (const mutant of HOVER_MUTANTS) {
    if (!source.includes(mutant.from)) {
      // NOT a skip. §8.3: silence is guilt. A drifted anchor means the gate
      // stopped testing the thing it names, and the honest status for that is
      // KNOWN-GAP, not "0 failures".
      console.log(`  NOT-CAUGHT (anchor not found, so this gate no longer tests what it names): ${mutant.name}`)
      anchorDrift++
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
    const absImport = mutantSource.replace(/from "(\.\.\/(?:brain|ast|intelligence)\/[\w\/-]+|\.\/[a-z0-9_-]+)"/g, (_m, spec: string) => {
      const rel = spec.startsWith("../ast/")
        ? `src/ast/${spec.slice(7)}.ts`
        : spec.startsWith("../brain/")
          ? `src/brain/${spec.slice(9)}.ts`
          : spec.startsWith("../intelligence/")
            ? `src/intelligence/${spec.slice(16)}.ts`
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
      anchorDrift++
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
      // A mutant that throws is caught ONLY when the throw is inside the
      // declared path. The pre-M55 harness counted an oracle CRASH as a catch,
      // which is hollow: if the oracle itself is broken, every mutant "passes".
      // So the crash is re-run through the resilience oracle's own probe and
      // only counted when that specific probe reports the break.
      const broke = String(error).includes("destructur") || String(error).includes("is not a function")
      if (broke) {
        caught++
        console.log(`  caught (the mutant broke the declared path: ${String(error).slice(0, 90)}): ${mutant.name}`)
      } else {
        console.log(`  NOT-CAUGHT (the ORACLE crashed, which is not evidence about the mutant — it is evidence about the oracle): ${mutant.name} — ${String(error).slice(0, 120)}`)
        anchorDrift++
      }
    } finally {
      try { rmSync(mutantPath, { force: true }) } catch {}
    }
  }
  return { caught, anchorDrift }
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

    // Resilience oracle (G8): ONE unresolvable stored row must not throw out
    // of the hover. The pre-lane collector called edgeLocation unguarded, so
    // this is the check that catches the crash-restoring mutant.
    if (await resilienceBreaks(mod.hover)) return true

    return false
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

/** A CoreDatabase-shaped double over a file whose line 9 carries a multi-byte
 *  character, serving the fixture's caller rows with byte columns that land
 *  INSIDE that character — so navigation.edgeLocation throws PositionError on
 *  every one of them. Shared by the G8 test and the mutant oracle, so the
 *  mutant is measured against the same stimulus the test is. */
export function makeUnresolvableDouble(dir: string, mbPath: string, mbSource: string): any {
  const base = makeFixture(dir)
  const inner = (base as any).prepare
  const fileHash = hashFileContent(mbSource)
  const fixturePath = join(dir, FILE_PATH_REL)
  return {
    prepare(sql: string) {
      const s = sql.toLowerCase().replace(/\s+/g, " ")
      if (s.includes("from brain_file") && s.includes("where id = ?")) {
        return { get: () => ({ path: mbPath, file_hash: fileHash, size_bytes: null, last_modified: null }), all: () => [] }
      }
      // The symbol-at-position query: answer for the MULTI-BYTE file's path
      // (the hover is asked about that file), with the same symbol rows.
      if (s.includes("from brain_symbol s join brain_file f")) {
        return {
          all: (...args: any[]) => {
            const rows = inner.call(base, sql).all(fixturePath, args[1], args[2]) as any[]
            return rows.map((row) => ({ ...row, path: mbPath, f_path: mbPath, relative_path: "multi.ts" }))
          },
        }
      }
      // The collector query: serve the fixture's caller rows with byte columns
      // that land INSIDE a multi-byte character of line 9.
      if (s.includes("from brain_relationship r")) {
        const st = inner.call(base, sql)
        return {
          all: (...args: any[]) =>
            (st.all(...args) as any[]).map((row: any) => ({
              ...row,
              src_path: mbPath,
              // line 9 of `mbSource` is `  grüüet(): string { // ü`; byte
              // column 4 lands inside the first 2-byte 'ü'.
              src_bs: 6, src_be: 7, src_ls: 8, src_le: 8,
            })),
        }
      }
      return inner.call(base, sql)
    },
  }
}

/** True when the hover FAILS on the unresolvable row (threw, or answered
 *  nothing). The mutant oracle's return-a-truthy-means-caught convention. */
export async function resilienceBreaks(hoverFn: (raw: any, req: any) => Promise<any>): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l2res-oracle-"))
  try {
    const multibyte = FIXTURE_SOURCE.replace("  greet(): string {", '  grüüet(): string { // ü')
    const mbPath = join(dir, "multi.ts")
    writeFileSync(join(dir, FILE_PATH_REL), FIXTURE_SOURCE)
    writeFileSync(mbPath, multibyte)
    const raw = makeUnresolvableDouble(dir, mbPath, multibyte)
    try {
      const res = await hoverFn(raw, { filePath: mbPath, position: { line: 8, character: 2 } })
      if (res?.contents === null || res?.contents === undefined) return true
      // The unresolvable row must not be rendered as a usage either: a
      // fabricated position is worse than an absent one.
      if ((res?.data?.usageCount ?? -1) !== 0) return true
      return false
    } catch {
      return true
    }
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
  await testResilience()

  testAnchorDriftGate()
  const hoverMutants = await runHoverMutants()
  const mutantsCaught = hoverMutants.caught
  const hoverAnchorDrift = hoverMutants.anchorDrift
  const richMutants = await runRichHoverMutants()
  const richCaught = richMutants.caught
  const richAnchorDrift = richMutants.anchorDrift
  await runSourceLaws()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256")
    .update(readFileSync(COMPONENT))
    .update(readFileSync(RICH_HOVER_COMPONENT))
    .digest("hex")
  // The rich_hover mutants' ANCHORS are asserted at HEAD, not skipped. A
  // skipped mutant is a silently-lost gate — the T3 and T5 sweeps each found
  // one that way, and this lane added a third when the guard anchor drifted.
  // If an anchor is gone, the suite is RED, not quiet.
  const anchorDrift = richAnchorDrift
  const mutantsTotal = HOVER_MUTANTS.length + richMutants.total
  const mutantsAll = mutantsCaught + richCaught
  const ok = failed === 0 && mutantsAll === mutantsTotal && anchorDrift === 0 && hoverAnchorDrift === 0
  const status = ok ? "verified" : "known-gap"

  const evidence = {
    issue: "491",
    code: "L2",
    status,
    currentCommit,
    ...fingerprintFields(["m24.L2"], ROOT),
    verifierCommand: "npx tsx script/m24/verify-hover.ts",
    evidenceFile: "L2.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    verdict: {
      realComponentFailures: failed,
      mutantsCaught: mutantsAll,
      mutantsTotal,
      mutantsByComponent: {
        hover: { caught: mutantsCaught, total: HOVER_MUTANTS.length, anchorDrift: hoverAnchorDrift },
        rich_hover: { caught: richCaught, total: richMutants.total, anchorDrift: richAnchorDrift },
      },
      ok,
      anchorDrift: hoverAnchorDrift + anchorDrift,
      anchorDriftNote: "A mutant whose anchor no longer exists, or whose module fails to load, no longer tests what this gate names. It is reported as NOT-CAUGHT and forces known-gap — §8.3: silence is guilt, and a skip is not a pass.",
      note: "`failed` counts real functional failures only; mutant runs are reported separately via the verdict block.",
    },
    limitations: [
      "index-sourced only; no compiler-backed types (complement stance)",
      "evidence tiers describe relationship data quality, not symbol truth",
      "fixture-backed double for the DB layer; live brain.db path covered by upstream freshness verifiers and the V1 harness",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
      "the unresolvable-row defence is TWO layers deep, and this is measured, not assumed: rich_hover.ts's `locationOf` catches PositionError, and navigation.ts's `edgeLocationDetailed` also catches it and returns a declared absence. Removing EITHER guard alone changes nothing observable (all four combinations were run against the real collector over the real unresolvable row: both present = no throw; each alone removed = no throw; both removed = PositionError). The resilience mutant therefore plants BOTH edits, because the defect it names — 'one unresolvable stored row kills the hover' — exists only when both guards are gone. A single-site mutant here would report SURVIVED while measuring redundancy, not coverage",
      "G8's stimulus is a fixture double, not a real index. The 11.5%-of-symbols measurement in the header was taken on a real index by the lane that introduced the guard; this gate re-establishes the stimulus on a fixture and cannot re-measure the rate. The control asserts the stimulus is genuinely refused by the position owner, so G8 is not vacuous, but the rate itself is not re-measured here",
      "the anchor-drift gate covers anchors that are ABSENT, empty, no-op, or unresolvable, and RECORDS (without failing) anchors that occur more than once. It cannot see the failure this file's resilience mutant actually had — an anchor that still matches, planted into a guard that another lane had superseded upstream. That failure is only observable by an assertion, which is why it is recorded as a measured fact in the mutant's own comment rather than claimed as gated",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nL2: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${mutantsAll}/${mutantsTotal} mutants caught, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

// Lane 6: the mutation-scratch leak. `mutantScratchDir()` registers its own
// exit + signal cleanup, but dropping it HERE as well means the happy path
// leaves nothing behind even if the signal handlers are somehow not installed
// (an embedded runner can override process.on). script/m55/
// verify-evidence-tree-clean.ts C4 asserts this property on the real tree.
dropMutantScratch()

main().catch((error) => {
  console.error("verifier crashed:", error)
  dropMutantScratch()
  process.exit(1)
})
