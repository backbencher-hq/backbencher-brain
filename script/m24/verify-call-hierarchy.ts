// script/m24/verify-call-hierarchy.ts — M24.L5 verifier + mutation suite.
//
// Proves the call hierarchy component (src/lsp/call_hierarchy.ts) honors
// its declared guarantees. The component drives the M14 traverseGraph
// engine through an injectable TraverseFn; this verifier supplies a
// fixture-backed double that reproduces the engine's contract, so the
// adapter's mapping logic (prepare -> item, edges -> LSP calls, truncation
// and external-node metadata) is proven without native DB bindings.
//
// Guarantees under test (declared in src/lsp/call_hierarchy.ts header):
//   G1 prepare:  symbol at position -> call hierarchy item
//   G2 expand:   incoming/outgoing edges -> LSP calls, deduplicated
//   G3 truncate: engine truncated + truncationReason carried verbatim
//   G4 external: unresolved targets (ext:*) render as declared external
//   G5 positions: ranges convert via the P1 component only
//   G6 latency:  p95 warm prepare/expand under the 100 ms budget (§3)
//   G7 absence:  §11.7 DECLARED ABSENCE with a machine-readable code for a
//                file outside the launch set, an unknown symbol id, an
//                external node and an unplaceable span. The pre-lane answers
//                were a bare `null` / a bare `[]` — indistinguishable from
//                "this symbol has no callers", which is a different claim.
//                Each case has a NEGATIVE test.
//   G8 nodes:    an edge into a file outside the launch set is omitted and
//                listed in `declaredAbsentNodes` — never rendered as a caller
//                bb cannot vouch for.
//   G9 basis:    §15.3 an item whose position cannot be placed carries
//                `positionBasis: "declared_unresolvable"` and says so in its
//                identity line — never a plausible-looking range.
//  G10 stale:    §4 every response carries a machine-readable staleness marker.
//  G11 positions: §5 Rule 1 the two lane-owned files carry NO inline position
//                conversion (script/m24/position-inline-gate.ts, which has its
//                own planted-defect self-test).
//
// MUTATION-HARNESS HONESTY (issue found by this lane, fixed here): the pre-lane
// rewriter missed `from "./signature"`, so EVERY mutant in this suite died on an
// import error and was counted as "caught" while the oracle never ran — a gate
// that proved nothing. The rewriter below covers every relative import the
// component has, and an import failure is now reported as NOT JUDGED rather
// than caught, because a mutant that never executed is not a caught mutant.
//
// Run: npx tsx script/m24/verify-call-hierarchy.ts
// Evidence: validation/m24/results/L5.json (machine-emitted)

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
const COMPONENT = join(ROOT, "src", "lsp", "call_hierarchy.ts")
const INLINE_GATE_FILES = ["src/lsp/symbols.ts", "src/lsp/call_hierarchy.ts"] as const
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "L5.json")

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

// --- Fixture data -------------------------------------------------------------

const FIXTURE_MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
}

function main(): void {
  const g = new Greeter()
  g.greet()
}
`

const MAIN_REL = "main.ts"

/** A language the launch set does NOT serve. The index DELIBERATELY holds rows
 *  for it, and `spin` really INVOKES `greet()` in that file — so without the
 *  launch-set gate the component renders a caller with a source-resolved call
 *  site. The gate is therefore the ONLY thing that can empty the list: this
 *  negative test cannot pass for the wrong reason. (An earlier version of this
 *  fixture used a bare `greet` reference, which the transitive-hop rule dropped
 *  for an unrelated reason — a test that passes for the wrong reason is not a
 *  gate.) */
const OFF_LAUNCH_REL = "fixture.rb"
const OFF_LAUNCH_SOURCE = "# ruby\nclass Widget\n  def spin\n    greet()\n  end\nend\n"

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
  complexity: number
}

// Per-line 1-based byte columns, end exclusive. Multi-line symbols store
// their END column on their END line (verified against the fixture text):
//   greet spans lines 2-4: start col 3 (line 2), end col 4 (line 4 "  }")
//   main  spans lines 7-10: start col 10 (line 7), end col 2 (line 10 "}")
// spin  spans lines 3-5 of the OFF-LAUNCH file, so an edge from a symbol the
// server does not serve is expressible (G8).
const FIXTURE_SYMBOLS: FixtureSymbol[] = [
  { id: "sym-greet", name: "greet", qualified_name: "Greeter.greet", symbol_type: "method", file: MAIN_REL, line_start: 2, line_end: 4, byte_start: 3, byte_end: 4, complexity: 1 },
  { id: "sym-main", name: "main", qualified_name: null, symbol_type: "function", file: MAIN_REL, line_start: 7, line_end: 10, byte_start: 10, byte_end: 2, complexity: 2 },
  { id: "sym-spin", name: "spin", qualified_name: "Widget.spin", symbol_type: "method", file: OFF_LAUNCH_REL, line_start: 3, line_end: 5, byte_start: 3, byte_end: 4, complexity: 1 },
  { id: "sym-ghostline", name: "ghostline", qualified_name: null, symbol_type: "function", file: MAIN_REL, line_start: 900, line_end: 900, byte_start: 1, byte_end: 2, complexity: 1 },
]

interface FixtureNode {
  id: string
  name: string
  symbolType: string
  file: string
  filePath: string
  line: number
  lineEnd: number
  language: string
  complexity: number
  isExternal: boolean
}

// Real-engine shape (M55.T2): an INDEXED node carries its ABSOLUTE filePath (the
// DB path column) and a workspace-relative `file`; only external nodes have no
// file. The original fixture left filePath empty, which made a call-site
// resolution from the caller's own source impossible — the component then had
// to fall back, and the M55.T2 contract could not be exercised here (found by
// the M55 re-shoot: the fixture was shaped for convenience, not for the truth).
function fixtureNodes(dir: string): Record<string, FixtureNode> {
  const abs = join(dir, MAIN_REL)
  const off = join(dir, OFF_LAUNCH_REL)
  return {
    "sym-greet": { id: "sym-greet", name: "greet", symbolType: "method", file: MAIN_REL, filePath: abs, line: 2, lineEnd: 4, language: "typescript", complexity: 1, isExternal: false },
    "sym-main": { id: "sym-main", name: "main", symbolType: "function", file: MAIN_REL, filePath: abs, line: 7, lineEnd: 10, language: "typescript", complexity: 2, isExternal: false },
    "sym-spin": { id: "sym-spin", name: "spin", symbolType: "method", file: OFF_LAUNCH_REL, filePath: off, line: 3, lineEnd: 5, language: "ruby", complexity: 1, isExternal: false },
    // A node whose stored line is past EOF (a stale index row): its position
    // CANNOT be placed, and the item must say so instead of clamping to line 0.
    "sym-ghostline": { id: "sym-ghostline", name: "ghostline", symbolType: "function", file: MAIN_REL, filePath: abs, line: 900, lineEnd: 900, language: "typescript", complexity: 1, isExternal: false },
    "ext:console": { id: "ext:console", name: "console", symbolType: "external", file: "", filePath: "", line: 0, lineEnd: 0, language: "unknown", complexity: 0, isExternal: true },
    // Depth-3 fixture node for the depth-cap mutant: top -> helper -> main -> greet.
    "sym-helper": { id: "sym-helper", name: "helper", symbolType: "function", file: MAIN_REL, filePath: abs, line: 12, lineEnd: 12, language: "typescript", complexity: 1, isExternal: false },
    "sym-top": { id: "sym-top", name: "top", symbolType: "function", file: MAIN_REL, filePath: abs, line: 13, lineEnd: 13, language: "typescript", complexity: 1, isExternal: false },
  }
}

// Deeper caller chain for depth testing: helper calls main (depth 2),
// top calls helper (depth 3). Present only when maxDepth >= 3.
const FIXTURE_DEEP_EDGES: FixtureEdge[] = [
  { from: "sym-helper", to: "sym-main", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 12 }, depth: 2 },
  { from: "sym-top", to: "sym-helper", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 13 }, depth: 3 },
]

interface FixtureEdge {
  from: string
  to: string
  relationshipType: string
  confidence: number
  isCrossLanguage: boolean
  callSite: { file: string; line: number }
  depth: number
}

// main calls greet at line 8; greet calls console (external) at line 3.
const FIXTURE_EDGES: FixtureEdge[] = [
  { from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 8 }, depth: 1 },
  { from: "sym-greet", to: "ext:console", relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 3 }, depth: 1 },
]

function makeFixture(dir: string, opts: { staleHashes?: boolean } = {}): any {
  const filePath = join(dir, MAIN_REL)
  if (!existsSync(filePath)) writeFileSync(filePath, FIXTURE_MAIN)
  if (!existsSync(join(dir, OFF_LAUNCH_REL))) writeFileSync(join(dir, OFF_LAUNCH_REL), OFF_LAUNCH_SOURCE)
  const hashOf = (p: string, rel: string): string =>
    opts.staleHashes === true ? "0".repeat(16) : hashFileContent(readFileSync(p, "utf8"))
  const fileId = (rel: string): string => `file-${rel}`
  const langOf = (rel: string): string => (rel === OFF_LAUNCH_REL ? "ruby" : "typescript")

  const raw = {
    prepare(sql: string) {
      const s = sql.toLowerCase().replace(/\s+/g, " ")
      return {
        get(...args: any[]) {
          if (s.includes("from brain_symbol s join brain_file f") && s.includes("where s.id = ?")) {
            const id = args[0] as string
            const sym = FIXTURE_SYMBOLS.find((x) => x.id === id)
            if (!sym) return undefined
            const abs = join(dir, sym.file)
            return {
              id: sym.id,
              name: sym.name,
              symbol_type: sym.symbol_type,
              line: sym.line_start,
              lineEnd: sym.line_end,
              relativePath: sym.file,
              filePath: abs,
              fileId: fileId(sym.file),
              language: langOf(sym.file),
              complexity: sym.complexity,
            }
          }
          // signature row (M55.T4 detail line)
          if (s.includes("select parameters, return_type, visibility")) {
            const sym = FIXTURE_SYMBOLS.find((x) => x.id === args[0])
            if (!sym) return undefined
            return { parameters: "message: string", return_type: "string", visibility: null }
          }
          // brain/freshness.ts's freshness lookup — answered faithfully.
          if (s.includes("from brain_file where id = ?")) {
            const rel = FIXTURE_SYMBOLS.map((x) => x.file).find((f) => fileId(f) === args[0])
            if (rel === undefined) return undefined
            const abs = join(dir, rel)
            if (!existsSync(abs)) return undefined
            return { path: abs, file_hash: hashOf(abs, rel), size_bytes: null, last_modified: null }
          }
          return undefined
        },
        all(...args: any[]) {
          // expandCalls' batched edge-file lookup (§4 freshness).
          if (s.includes("from brain_file where path in")) {
            const wanted = args as string[]
            const rows: Array<{ id: string; path: string }> = []
            for (const rel of new Set(FIXTURE_SYMBOLS.map((x) => x.file))) {
              const abs = join(dir, rel)
              if (wanted.includes(abs)) rows.push({ id: fileId(rel), path: abs })
            }
            return rows
          }
          // findIndexedSymbol's symbol query (shared with L3).
          if (s.includes("from brain_symbol s join brain_file f") && s.includes("where f.path = ?")) {
            const fpath = args[0] as string
            const line1 = args[1] as number
            const rel = FIXTURE_SYMBOLS.map((x) => x.file).find((f) => join(dir, f) === fpath)
            if (rel === undefined) return []
            return FIXTURE_SYMBOLS
              .filter((sym) => sym.file === rel && sym.line_start <= line1 && sym.line_end >= line1)
              .map((sym) => ({
                ...sym,
                file_id: fileId(rel),
                f_id: fileId(rel),
                path: join(dir, rel),
                language: langOf(rel),
              }))
          }
          return []
        },
      }
    },
  }
  return raw
}

/** TraverseFn double: reproduces the engine contract from fixture data.
 *  Faithfully simulates the engine's depth semantics: edges deeper than
 *  options.maxDepth are NOT returned — so a component mutant that caps the
 *  depth wrong is observable through this double. */
function makeTraverseDouble(dir: string, overrides: Partial<{
  callers: FixtureEdge[]
  callees: FixtureEdge[]
  truncated: boolean
  truncationReason?: string
  maxDepthReached: number
}> = {}) {
  return async (_projectId: string, root: any, options: any): Promise<any> => {
    const direction = options?.direction ?? "both"
    const maxDepth = options?.maxDepth ?? 5
    const depthFilter = (e: FixtureEdge) => e.depth <= maxDepth
    const callers = (overrides.callers ?? FIXTURE_EDGES.filter((e) => e.to === root.id)).filter(depthFilter)
    const callees = (overrides.callees ?? FIXTURE_EDGES.filter((e) => e.from === root.id)).filter(depthFilter)
    // Ghost node: present in the engine's node map so a fabricated edge to it
    // would RENDER as a real caller — the fabrication must be observable.
    const nodes: Record<string, FixtureNode> = {
      ...fixtureNodes(dir),
      "ext:ghost": { id: "ext:ghost", name: "ghost", symbolType: "external", file: "", filePath: "", line: 0, lineEnd: 0, language: "unknown", complexity: 0, isExternal: true },
    }
    return {
      callers,
      callees,
      nodes,
      truncated: overrides.truncated ?? false,
      truncationReason: overrides.truncationReason,
      maxDepthReached: overrides.maxDepthReached ?? 1,
    }
  }
}

/** Deep-chain double: greet's incoming chain is main(d1) -> helper(d2) ->
 *  top(d3). The engine returns one edge per level; the component surfaces
 *  each edge's `from` as a caller. With maxDepth 5 all three appear; with
 *  maxDepth 2 only main + helper appear — the depth-cap mutant is visible. */
function makeDeepDouble(_dir: string) {
  return async (_projectId: string, root: any, options: any): Promise<any> => {
    const maxDepth = options?.maxDepth ?? 5
    const chain: FixtureEdge[] = [
      { from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 8 }, depth: 1 },
      { from: "sym-helper", to: "sym-main", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 12 }, depth: 2 },
      { from: "sym-top", to: "sym-helper", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 13 }, depth: 3 },
    ]
    void root
    return {
      callers: chain.filter((e) => e.depth <= maxDepth),
      callees: [],
      nodes: { ...fixtureNodes(_dir) },
      truncated: false,
      maxDepthReached: maxDepth,
    }
  }
}

/** An edge INTO a file the server does not serve: the engine returned it, and
 *  the component must omit it and DECLARE it (G8). */
function makeOffLaunchDouble(dir: string) {
  return async (_projectId: string, root: any, _options: any): Promise<any> => ({
    callers: [{ from: "sym-spin", to: root.id, relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { file: OFF_LAUNCH_REL, line: 4 }, depth: 1 }],
    callees: [],
    nodes: { ...fixtureNodes(dir) },
    truncated: false,
    maxDepthReached: 1,
  })
}

// --- Tests -------------------------------------------------------------------

const GREET_ITEM = {
  name: "greet", kind: 6, uri: "file://x",
  range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } },
  selectionRange: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } },
  data: { symbolId: "sym-greet", isExternal: false },
} as any

async function testPrepare(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-prep-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  // Position on greet (0-based line 1, char 4).
  const result = ch.prepareCallHierarchy(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 4 })
  check("G1: prepare resolves greet", result.item?.name === "greet", JSON.stringify(result.item))
  check("G1: prepare not indexed false", result.notIndexed === false)
  check("G1: prepare declares NO absence when it answered", result.absence === null, JSON.stringify(result.absence))
  check("G1: item kind is Method", result.item?.kind === 6, String(result.item?.kind))
  check("G1: item carries symbol identity", result.item?.data?.symbolId === "sym-greet")
  check("G1: item uri is file uri", (result.item?.uri ?? "").startsWith("file://"))
  check("G9: a resolved item declares a source_resolved position basis", result.item?.positionBasis === "source_resolved", JSON.stringify(result.item?.positionBasis))

  // Not-indexed position (trailing empty line, 0-based line 10).
  const missing = ch.prepareCallHierarchy(raw, { filePath: join(dir, MAIN_REL), line: 10, character: 0 })
  check("G1: not-indexed position -> null + declared", missing.item === null && missing.notIndexed === true)
  check("G7: a position with no indexed symbol carries a machine-readable code", missing.absence?.code === "symbol_not_at_position", JSON.stringify(missing.absence))
  cleanupDir(dir)
}

/** §11.7 DECLARED ABSENCE — the negative tests the pre-lane suite never had. */
async function testDeclaredAbsence(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-abs-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  // 1. prepareCallHierarchy on a file outside the launch set. The fixture index
  // HOLDS a symbol for that file, so a gate that runs after the index read
  // would answer with an item — the lie §11.7 names.
  const prep = ch.prepareCallHierarchy(raw, { filePath: join(dir, OFF_LAUNCH_REL), line: 2, character: 4 })
  negative("G7: prepare on a non-launch file returns NO item even though the index has one", prep.item === null, JSON.stringify(prep.item))
  negative("G7: prepare on a non-launch file is declared not-indexed", prep.notIndexed === true)
  negative("G7: prepare on a non-launch file carries a machine-readable code", prep.absence?.code === "file_type_unknown", JSON.stringify(prep.absence))
  negative("G7: the prepare absence names the launch set", Array.isArray(prep.absence?.launchLanguages) && prep.absence.launchLanguages.length === 14, JSON.stringify(prep.absence?.launchLanguages))

  // 2. incomingCalls / outgoingCalls rooted at a non-launch file.
  const offItem = {
    name: "spin", kind: 6, uri: `file://${join(dir, OFF_LAUNCH_REL)}`,
    range: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
    selectionRange: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
    data: { symbolId: "sym-spin", isExternal: false },
  } as any
  const incoming = await ch.expandCalls(raw, "proj", { item: offItem, direction: "incoming" }, makeOffLaunchDouble(dir))
  negative("G7: incomingCalls on a non-launch file returns NO calls", incoming.calls.length === 0, JSON.stringify(incoming.calls))
  negative("G7: incomingCalls on a non-launch file is not 'indexed'", incoming.evidenceTier === "not_indexed", incoming.evidenceTier)
  negative("G7: incomingCalls on a non-launch file carries a machine-readable code", incoming.absence?.code === "file_type_unknown", JSON.stringify(incoming.absence))

  const outgoing = await ch.expandCalls(raw, "proj", { item: offItem, direction: "outgoing" }, makeOffLaunchDouble(dir))
  negative("G7: outgoingCalls on a non-launch file returns NO calls", outgoing.calls.length === 0, JSON.stringify(outgoing.calls))
  negative("G7: outgoingCalls on a non-launch file carries a machine-readable code", outgoing.absence?.code === "file_type_unknown", JSON.stringify(outgoing.absence))

  // 3. an unknown symbol id: declared, with its own code (not "no callers").
  const unknown = { ...GREET_ITEM, data: { symbolId: "sym-nope", isExternal: false } }
  const unknownInc = await ch.expandCalls(raw, "proj", { item: unknown, direction: "incoming" }, makeTraverseDouble(dir))
  negative("G7: an unknown symbol id returns NO calls", unknownInc.calls.length === 0)
  negative("G7: an unknown symbol id says 'symbol_not_in_index' (not 'no callers')", unknownInc.absence?.code === "symbol_not_in_index", JSON.stringify(unknownInc.absence))
  negative("G7: the unknown-id message quotes the id it could not resolve", String(unknownInc.absence?.message ?? "").includes("sym-nope"), JSON.stringify(unknownInc.absence?.message))

  // 4. an external target: no index identity to traverse — declared as such.
  const extItem = {
    name: "console", kind: 2, uri: "",
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    data: { symbolId: "ext:console", isExternal: true },
  } as any
  const ext = await ch.expandCalls(raw, "proj", { item: extItem, direction: "incoming" }, makeTraverseDouble(dir))
  negative("G7: expanding an external node declares 'external_target'", ext.absence?.code === "external_target", JSON.stringify(ext.absence))
  negative("G7: expanding an external node returns NO calls", ext.calls.length === 0)

  // 5. a SERVED index with no stored edge: "none stored", a different claim.
  const lonely = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, { callers: [] }))
  check("G7: a served symbol with no stored caller says so and renders nothing", lonely.calls.length === 0 && lonely.absence !== null && String(lonely.absence.message).includes("none stored"), JSON.stringify(lonely.absence))
  cleanupDir(dir)
}

/** §11.7 — an edge into a file the server does not serve is omitted+declared. */
async function testDeclaredAbsentNodes(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-node-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  const result = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeOffLaunchDouble(dir))
  negative("G8: an edge from a non-launch file is NOT rendered as a caller", result.calls.length === 0, JSON.stringify(result.calls.map((c: any) => c.from?.name)))
  check("G8: the omitted edge is DECLARED with its symbol id and reason", result.declaredAbsentNodes.some((n: any) => n.symbolId === "sym-spin" && String(n.reason).includes("launch set")), JSON.stringify(result.declaredAbsentNodes))
  cleanupDir(dir)
}

/** §15.3 — an unplaceable stored position is declared, not clamped to line 0. */
async function testPositionBasis(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-basis-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  // A caller whose stored line is past EOF (a stale index row). The pre-lane
  // code clamped `Math.max(0, node.line - 1)` and rendered "line 1" with the
  // confidence of a real answer.
  const stale = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 900 }, depth: 1 }],
  }))
  const caller = stale.calls[0]?.from as any
  check("G9: an unplaceable caller is still RENDERED (the edge is real)", caller !== undefined, JSON.stringify(stale.calls))
  check("G9: its position basis is declared unresolvable", caller?.positionBasis === "declared_unresolvable", JSON.stringify(caller?.positionBasis))
  check("G9: its identity line says the position is unresolvable", String(caller?.detail ?? "").includes("position unresolvable"), JSON.stringify(caller?.detail))
  check("G9: its call site is declared APPROXIMATE (not a resolved position)", stale.callSitesResolved === 0 && stale.callSitesApproximate === 1, JSON.stringify({ r: stale.callSitesResolved, a: stale.callSitesApproximate }))

  // An external callee has no file at all — its item must declare the same.
  const ext = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "outgoing" }, makeTraverseDouble(dir))
  const callee = ext.calls[0]?.to as any
  check("G9: an external callee declares an unresolvable position basis", callee?.positionBasis === "declared_unresolvable" && callee?.data?.isExternal === true, JSON.stringify(callee))

  // A genuinely resolved caller keeps the exact, source-derived position.
  const good = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir))
  const resolved = good.calls[0]?.from as any
  check("G9: a resolved caller declares a source_resolved basis", resolved?.positionBasis === "source_resolved", JSON.stringify(resolved?.positionBasis))
  cleanupDir(dir)
}

/** §4 — every response carries a machine-readable staleness marker. */
async function testFreshness(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-fresh-"))
  const fresh = makeFixture(dir)
  const ch = await import(COMPONENT)

  const prep = ch.prepareCallHierarchy(fresh, { filePath: join(dir, MAIN_REL), line: 1, character: 4 })
  check("G10: prepare carries a staleness marker reporting 'fresh'", prep.staleness?.status === "fresh" && prep.staleness?.stale === false, JSON.stringify(prep.staleness))
  check("G10: the prepare marker counts the file it checked", prep.staleness?.filesChecked === 1, JSON.stringify(prep.staleness))

  const expanded = await ch.expandCalls(fresh, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir))
  check("G10: expand carries a staleness marker reporting 'fresh'", expanded.staleness?.status === "fresh" && expanded.staleness?.stale === false, JSON.stringify(expanded.staleness))

  const staleDir = mkdtempSync(join(tmpdir(), "bblsp-l5-stale-"))
  const stale = makeFixture(staleDir, { staleHashes: true })
  const stalePrep = ch.prepareCallHierarchy(stale, { filePath: join(staleDir, MAIN_REL), line: 1, character: 4 })
  check("G10: a file whose content changed reports 'stale' with stale=true", stalePrep.staleness?.status === "stale" && stalePrep.staleness?.stale === true, JSON.stringify(stalePrep.staleness))

  const noSourceDir = mkdtempSync(join(tmpdir(), "bblsp-l5-nosrc-"))
  const noSource = makeFixture(noSourceDir)
  rmSync(join(noSourceDir, MAIN_REL), { force: true })
  const unknown = ch.prepareCallHierarchy(noSource, { filePath: join(noSourceDir, MAIN_REL), line: 1, character: 4 })
  check("G10: an unverifiable file reports 'unknown' with stale=true (never silently fresh)", unknown.staleness?.status === "unknown" && unknown.staleness?.stale === true, JSON.stringify(unknown.staleness))
  cleanupDir(dir)
  cleanupDir(staleDir)
  cleanupDir(noSourceDir)
}

async function testExpand(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-exp-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  const incoming = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir))
  check("G2: incoming callers found", incoming.calls.length === 1, String(incoming.calls.length))
  const caller = incoming.calls[0] as any
  check("G2: caller is main", caller.from?.name === "main", JSON.stringify(caller.from))
  // M55.T2: the call site is the INVOCATION of greet inside main — `g.greet()`
  // on 0-based line 8 — found in the caller's own source and positioned exactly.
  // The stored edge line (8, 1-based) points at `const g = new Greeter()`: a
  // position taken from it would be wrong, which is why the component resolves
  // from source instead (Truth Rule 3).
  check("G2: caller carries the INVOCATION as its call site", caller.fromRanges?.[0]?.start?.line === 8, JSON.stringify(caller.fromRanges))
  check("G2: call-site range is exactly the invoked name", (() => {
    const r = caller.fromRanges?.[0]
    if (!r || r.start.line !== r.end.line) return false
    return FIXTURE_MAIN.split("\n")[r.start.line]!.slice(r.start.character, r.end.character) === "greet"
  })(), JSON.stringify(caller.fromRanges))
  check("G2: resolved (not approximate) call sites are declared", incoming.callSitesResolved === 1 && incoming.callSitesApproximate === 0, JSON.stringify({ resolved: incoming.callSitesResolved, approx: incoming.callSitesApproximate }))

  const outgoing = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "outgoing" }, makeTraverseDouble(dir))
  check("G2: outgoing callees found", outgoing.calls.length === 1, String(outgoing.calls.length))
  const callee = outgoing.calls[0] as any
  check("G2: callee is external console", callee.to?.data?.isExternal === true && callee.to?.name === "console", JSON.stringify(callee.to))
  cleanupDir(dir)
}

async function testTruncation(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-trunc-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  const truncated = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, { truncated: true, truncationReason: "caller-budget-exhausted", maxDepthReached: 4 }))
  check("G3: engine truncation carried verbatim", truncated.truncated === true)
  check("G3: truncation reason surfaced", truncated.truncationReason === "caller-budget-exhausted", String(truncated.truncationReason))
  check("G3: max depth reached surfaced", truncated.maxDepthReached === 4, String(truncated.maxDepthReached))
  cleanupDir(dir)
}

async function testExternal(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-ext-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  // Expanding an external item is declared empty (no index identity).
  const extItem = {
    name: "console", kind: 2, uri: "",
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    data: { symbolId: "ext:console", isExternal: true },
  } as any
  const result = await ch.expandCalls(raw, "proj", { item: extItem, direction: "incoming" }, makeTraverseDouble(dir))
  check("G4: external expand declared empty", result.calls.length === 0 && result.evidenceTier === "not_indexed")
  cleanupDir(dir)
}

async function testPositions(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-pos-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  // greet spans index lines 2-4, start col 3 (line 2), end col 4 (line 4).
  // P1 conversion of that range is the oracle for the prepared item range.
  const result = ch.prepareCallHierarchy(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 4 })
  const { createPositionMapper } = await import(join(ROOT, "src", "lsp", "positions.ts"))
  const mapper = createPositionMapper(FIXTURE_MAIN)
  const expected = mapper.indexRangeToLsp({ start: { line: 2, column: 3 }, end: { line: 4, column: 4 } })
  const r = result.item?.range
  check("G5: prepare range start equals P1 conversion", r?.start?.line === expected.start.line && r?.start?.character === expected.start.character, `${JSON.stringify(r)} vs ${JSON.stringify(expected)}`)
  check("G5: prepare range end equals P1 conversion", r?.end?.line === expected.end.line && r?.end?.character === expected.end.character, `${JSON.stringify(r)} vs ${JSON.stringify(expected)}`)
  // The selection range is the NAME token, resolved through the owner from the
  // range the owner already produced (the pre-lane code rebuilt the scan window
  // inline with a `?? 1` default).
  const sel = result.item?.selectionRange
  check("G5: selectionRange is the name token, resolved from the owner's range", sel?.start?.line === expected.start.line && FIXTURE_MAIN.split("\n")[sel.start.line]!.slice(sel.start.character, sel.end.character) === "greet", JSON.stringify(sel))
  cleanupDir(dir)
}

/** §5 Rule 1 — the two lane-owned files convert no coordinate inline. */
function testInlinePositionGate(): void {
  const survivors = selfTestSurvivors()
  check("G11: the inline-position gate's own planted defects are ALL caught (the gate can fail)", survivors.length === 0, survivors.join(" | "))
  for (const rel of INLINE_GATE_FILES) {
    const findings = findInlinePositionArithmetic(readFileSync(join(ROOT, rel), "utf8"), rel)
    check(`G11: ${rel} carries no inline position conversion`, findings.length === 0, findings.map((f) => `${f.shape}: ${f.text}`).join(" | "))
  }
  const planted = "  const start0 = Math.max(0, node.line - 1);\n"
  check("G11 [negative]: the same scan convicts a planted inline conversion", findInlinePositionArithmetic(planted, "planted.ts").length > 0)
}

async function testLatency(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-lat-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)
  const traverse = makeTraverseDouble(dir)

  for (let i = 0; i < 10; i++) await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, traverse)
  const samples: number[] = []
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now()
    await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, traverse)
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  check("G6: p95 warm expand under 100ms budget", p95 < 100, `p95=${p95.toFixed(2)}ms`)
  cleanupDir(dir)
}

function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

// --- Call hierarchy mutants -----------------------------------------------------

const CH_MUTANTS: Array<{ name: string; from: string; to: string }> = [
  {
    name: "callers: fabricated caller (invent edge)",
    from: "  const edges = direction === \"callers\" ? result.callers : result.callees;",
    to: "  const edges = direction === \"callers\" ? [{ from: \"ext:ghost\", to: item.data.symbolId, relationshipType: \"calls\", confidence: 1, isCrossLanguage: false, callSite: { file: \"\", line: 1 }, depth: 1 }, ...result.callers] : result.callees;",
  },
  {
    name: "callers: dropped caller (skip first)",
    from: "  for (const edge of edges) {\n    const otherId = direction === \"callers\" ? edge.from : edge.to;\n    if (seenFrom.has(otherId)) continue;",
    to: "  for (const edge of edges.slice(1)) {\n    const otherId = direction === \"callers\" ? edge.from : edge.to;\n    if (seenFrom.has(otherId)) continue;",
  },
  {
    name: "depth: wrong max depth cap",
    from: "  const maxDepth = Math.max(1, Math.min(request.maxDepth ?? CH_MAX_DEPTH, 10));",
    to: "  const maxDepth = Math.max(1, Math.min(request.maxDepth ?? CH_MAX_DEPTH, 2));",
  },
  {
    name: "truncation: swallow engine truncation",
    from: "    truncated: result.truncated,\n    truncationReason: result.truncationReason,",
    to: "    truncated: false,\n    truncationReason: undefined,",
  },
  {
    // M55.T2: the pre-M55 behaviour — positions taken from the stored edge line
    // instead of the caller's source. Must be caught by the invocation and
    // approximate-count assertions above.
    name: "call sites: skip the source resolution (stored line / fallback only)",
    from: "    if (invocations.length > 0) {\n      fromRanges = invocations.map((i) => i.range);",
    to: "    if (false) {\n      fromRanges = invocations.map((i) => i.range);",
  },
  // §11.7 bug class, pre-lane behaviour verbatim: the launch-set gate removed.
  {
    name: "absence: drop the root's launch-set gate (the pre-lane component)",
    from: "  const rootScope = declaredAbsenceFor(rootRow.filePath);\n  if (rootScope !== null) {",
    to: "  const rootScope = null;\n  if (rootScope !== null) {",
  },
  // §11.7 bug class: keep the gate, swallow the reason (silent empty).
  {
    name: "absence: declare the gate but return no reason",
    from: "      absence: absenceWith(\n        \"external_target\",",
    to: "      absence: null,\n      unused: absenceWith(\n        \"external_target\",",
  },
  // §15.3 bug class, pre-lane behaviour verbatim: the clamped inline line.
  {
    name: "positions: restore the clamped inline node line (the pre-lane component)",
    from: "  const window = mapper === null ? null : lspLineWindow(mapper, node.line, node.lineEnd);",
    to: "  const window = mapper === null ? null : { start: Math.max(0, node.line - 1), end: Math.max(0, node.lineEnd - 1) };",
  },
  // §15.3 bug class: an unplaceable item rendered as if it were a location.
  {
    name: "honesty: hide an unresolvable position basis",
    from: "    positionBasis: resolved ? \"source_resolved\" : \"declared_unresolvable\",",
    to: "    positionBasis: \"source_resolved\",",
  },
  // §4 bug class: the staleness marker removed.
  {
    name: "freshness: drop the staleness marker",
    from: "function unknownStaleness(paths: string[] = []): StalenessMarker {\n  return { stale: true, status: \"unknown\", filesChecked: 0, filesUnverified: paths };\n}",
    to: "function unknownStaleness(paths: string[] = []): StalenessMarker {\n  return { stale: false, status: \"fresh\", filesChecked: 99, filesUnverified: [] };\n}",
  },
]

let mutantsSeen = 0

async function runChMutants(): Promise<{ caught: number; notJudged: number }> {
  console.log("Call hierarchy mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0
  let notJudged = 0

  for (const mutant of CH_MUTANTS) {
    if (!source.includes(mutant.from)) {
      console.log(`  NOT JUDGED (anchor not found): ${mutant.name}`)
      notJudged++
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    const mutantPath = join(ROOT, "validation", "m24", `ch.mutant.${mutantsSeen++}.ts`)
    // EVERY relative import the component has, rewritten. The pre-lane rewriter
    // missed `./signature`, which made all five pre-lane mutants die on an
    // import error and be counted as "caught" while the oracle never ran.
    const absImport = mutantSource
      .replace(/from "\.\.\/brain\/database"/g, `from "file://${join(ROOT, "src", "brain", "database.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/brain\/freshness"/g, `from "file://${join(ROOT, "src", "brain", "freshness.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/project\/schema"/g, `from "file://${join(ROOT, "src", "project", "schema.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/positions"/g, `from "file://${join(ROOT, "src", "lsp", "positions.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/launch_languages"/g, `from "file://${join(ROOT, "src", "lsp", "launch_languages.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/signature"/g, `from "file://${join(ROOT, "src", "lsp", "signature.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/symbols"/g, `from "file://${join(ROOT, "src", "lsp", "symbols.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/hover"/g, `from "file://${join(ROOT, "src", "lsp", "hover.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/navigation"/g, `from "file://${join(ROOT, "src", "lsp", "navigation.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/intelligence\/graph\/graph-engine"/g, `from "file://${join(ROOT, "src", "intelligence", "graph", "graph-engine.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/intelligence\/contracts"/g, `from "file://${join(ROOT, "src", "intelligence", "contracts.ts").replace(/\\/g, "/")}"`)
    writeFileSync(mutantPath, absImport)
    let mod: any
    try {
      mod = await import(mutantPath)
    } catch (error) {
      // NOT a caught mutant: the oracle never ran, so the mutant proved
      // nothing. This distinction is the whole point (see the header).
      notJudged++
      console.log(`  NOT JUDGED (import failure — the oracle never ran): ${mutant.name}`)
      console.log(`      ${String(error).split("\n")[0]}`)
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    try {
      const ok = await chMutantOracle(mod, mutantSource)
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

async function chMutantOracle(mod: any, mutantSource: string): Promise<boolean> {
  const d = mkdtempSync(join(tmpdir(), "bblsp-l5mut-"))
  try {
    // G11 is a gate like any other: a reintroduced inline conversion is
    // convicted by the same scan the real source runs.
    if (findInlinePositionArithmetic(mutantSource, "call_hierarchy.mutant.ts").length > 0) return true
    const raw = makeFixture(d)

    // Caller oracle: exactly one incoming caller (main), no fabrication.
    const incoming = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(d))
    if (incoming.calls.length !== 1) return true
    if (incoming.calls[0].from?.name !== "main") return true
    if (incoming.calls[0].from?.data?.isExternal === true) return true
    if (incoming.calls.some((c: any) => c.from?.name === "ghost")) return true
    // M55.T2 oracle: the call site must be the INVOCATION in the caller's own
    // source (`g.greet()`, 0-based line 8), declared as resolved.
    const r0 = incoming.calls[0].fromRanges?.[0]
    if (!r0 || r0.start.line !== 8 || r0.end.line !== 8) return true
    if ((FIXTURE_MAIN.split("\n")[r0.start.line] ?? "").slice(r0.start.character, r0.end.character) !== "greet") return true
    if (incoming.callSitesResolved !== 1 || incoming.callSitesApproximate !== 0) return true
    if (incoming.calls[0].from?.positionBasis !== "source_resolved") return true

    // Outgoing oracle: exactly one callee (external console), declared.
    const outgoing = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "outgoing" }, makeTraverseDouble(d))
    if (outgoing.calls.length !== 1) return true
    if (outgoing.calls[0].to?.data?.isExternal !== true) return true
    if (outgoing.calls[0].to?.positionBasis !== "declared_unresolvable") return true

    // Truncation oracle: engine truncation must surface.
    const truncated = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(d, { truncated: true, truncationReason: "caller-budget-exhausted", maxDepthReached: 4 }))
    if (truncated.truncated !== true) return true
    if (truncated.truncationReason !== "caller-budget-exhausted") return true

    // Depth oracle: default maxDepth must reach depth 3 (main, helper, top).
    const deep = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeDeepDouble(d))
    const deepNames = deep.calls.map((c: any) => c.from?.name).sort()
    if (JSON.stringify(deepNames) !== JSON.stringify(["helper", "main", "top"])) return true

    // §11.7 oracle: a non-launch file must be DECLARED absent on all three doors
    // (prepare, incoming, outgoing), with a machine-readable code.
    const prep = mod.prepareCallHierarchy(raw, { filePath: join(d, OFF_LAUNCH_REL), line: 2, character: 4 })
    if (prep.item !== null || prep.absence === null || prep.absence === undefined) return true
    if (prep.absence.code !== "file_type_unknown") return true
    if (!Array.isArray(prep.absence.launchLanguages) || prep.absence.launchLanguages.length !== 14) return true
    const offItem = {
      name: "spin", kind: 6, uri: `file://${join(d, OFF_LAUNCH_REL)}`,
      range: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
      selectionRange: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
      data: { symbolId: "sym-spin", isExternal: false },
    }
    for (const direction of ["incoming", "outgoing"] as const) {
      const r = await mod.expandCalls(raw, "proj", { item: offItem as any, direction }, makeOffLaunchDouble(d))
      if (r.calls.length !== 0) return true
      if (r.absence === null || r.absence === undefined || r.absence.code !== "file_type_unknown") return true
    }
    // An unknown symbol id is declared with its own code.
    const unknown = await mod.expandCalls(raw, "proj", { item: { ...GREET_ITEM, data: { symbolId: "sym-nope", isExternal: false } }, direction: "incoming" }, makeTraverseDouble(d))
    if (unknown.absence === null || unknown.absence === undefined || unknown.absence.code !== "symbol_not_in_index") return true
    // An EXTERNAL target is declared with its own code too.
    const ext = await mod.expandCalls(raw, "proj", { item: { ...GREET_ITEM, data: { symbolId: "ext:console", isExternal: true } }, direction: "incoming" }, makeTraverseDouble(d))
    if (ext.absence === null || ext.absence === undefined || ext.absence.code !== "external_target") return true
    // §4/G10: an answer that read NO indexed file says so — 'unknown', stale.
    if (prep.staleness === undefined || prep.staleness.status !== "unknown" || prep.staleness.stale !== true) return true
    if (unknown.staleness === undefined || unknown.staleness.status !== "unknown" || unknown.staleness.stale !== true) return true

    // §11.7/G8 oracle: an edge into a non-launch file is omitted and DECLARED.
    const offEdge = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeOffLaunchDouble(d))
    if (offEdge.calls.length !== 0) return true
    if (!offEdge.declaredAbsentNodes.some((n: any) => n.symbolId === "sym-spin")) return true

    // §15.3/G9 oracle: an unplaceable caller declares its basis and stays
    // approximate — it is NOT clamped to line 0 and rendered as a location.
    const stale = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(d, {
      callers: [{ from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { file: MAIN_REL, line: 900 }, depth: 1 }],
    }))
    const ghost = stale.calls[0]?.from
    if (ghost === undefined) return true
    if (ghost.positionBasis !== "declared_unresolvable") return true
    if (!String(ghost.detail ?? "").includes("position unresolvable")) return true

    // §4/G10 oracle: the staleness marker is present and honest.
    const freshPrep = mod.prepareCallHierarchy(raw, { filePath: join(d, MAIN_REL), line: 1, character: 4 })
    if (freshPrep.staleness === undefined || freshPrep.staleness.status !== "fresh" || freshPrep.staleness.stale !== false || freshPrep.staleness.filesChecked !== 1) return true

    return false
  } finally {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
}

// --- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L5 verifier — call hierarchy over the bounded traverseGraph engine\n")

  await testPrepare()
  await testDeclaredAbsence()
  await testDeclaredAbsentNodes()
  await testPositionBasis()
  await testFreshness()
  await testExpand()
  await testTruncation()
  await testExternal()
  await testPositions()
  testInlinePositionGate()
  await testLatency()

  const { caught, notJudged } = await runChMutants()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(readFileSync(COMPONENT)).digest("hex")
  const ok = failed === 0 && caught === CH_MUTANTS.length
  const status = ok ? "verified" : "known-gap"

  const evidence = {
    issue: "494",
    code: "L5",
    status,
    currentCommit,
    sourceFingerprint,
    verifierCommand: "npx tsx script/m24/verify-call-hierarchy.ts",
    evidenceFile: "L5.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    verdict: {
      realComponentFailures: failed,
      mutantsCaught: caught,
      mutantsTotal: CH_MUTANTS.length,
      mutantsNotJudged: notJudged,
      ok,
      note: "`failed` counts real functional failures only; mutant runs are reported separately via the verdict block. `mutantsNotJudged` counts a mutant the harness could not judge (missing anchor or an import failure) — an import failure is NOT counted as caught, because the oracle never ran. The pre-lane suite reported 5/5 caught while all five mutants had died on an unrewritten `./signature` import.",
    },
    limitations: [
      "adapter proven against a fixture double reproducing the engine contract; the engine itself is M14-verified and exercised end-to-end by the V1 harness",
      "heuristic edges from the engine are included; their ratio is declared by the engine's provenance",
      "ranges for engine nodes use line-level precision when the engine lacks byte columns",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
      "the machine-readable absence reason is carried on the component result; src/lsp/server.ts (another lane) maps the wire response and currently returns a bare `null` / bare `[]` — the exact patch is reported",
      "the declared-absence and staleness vocabulary lives in src/lsp/symbols.ts (this lane owns both files); a dedicated src/lsp/declared_absence.ts owner would be the right home and is reported",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nL5: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${caught}/${CH_MUTANTS.length} mutants caught, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})