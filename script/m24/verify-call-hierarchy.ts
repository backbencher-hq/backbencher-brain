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
import { fileURLToPath, pathToFileURL } from "node:url"
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

/** The fixture text, with every line number the suite depends on:
 *
 *   1-based  1 `class Greeter {`        greet  = lines 2-4
 *            2   `greet(): string {`     main   = lines 7-11, invokes greet on 9 AND 10
 *            3     `return "hello"`      helper = lines 13-15, invokes main on 14
 *            4   `}`                    top    = lines 17-19, invokes helper on 18
 *            5 `}`
 *            7 `function main(): void {`
 *            9   `g.greet()`            <- the resolved call sites (0-based 8 and 9)
 *           10   `g.greet()`
 *           14   `main()`               <- helper's OWN invocation (0-based 13)
 *           18   `helper()`             <- top's OWN invocation (0-based 17)
 *
 * TWO shapes here are load-bearing and a shorter fixture would make the new gates
 * pass for the wrong reason:
 *   - `main` invokes `greet` TWICE, so one stored row yields TWO ranges. §13.4
 *     asserts the header count equals what is RENDERED, and this is the only
 *     shape on which the old per-CALLER-ENTRY unit can be caught.
 *   - `helper` and `top` form a real chain, each invoking the previous one, so a
 *     DEPTH-2/3 hop row's stored line names that hop's OWN invocation. D4's
 *     like-for-like cross-check is only provable when the hop row is genuinely
 *     correct in the store — with no invocation in the hop's source the row is
 *     stale and "agree" would be unreachable.
 */
const FIXTURE_MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
}

function main(): void {
  const g = new Greeter()
  g.greet()
  g.greet()
}

function helper(): void {
  main()
}

function top(): void {
  helper()
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
//   main  spans lines 7-11: start col 10 (line 7), end col 2 (line 11 "}")
// spin  spans lines 3-5 of the OFF-LAUNCH file, so an edge from a symbol the
// server does not serve is expressible (G8).
const FIXTURE_SYMBOLS: FixtureSymbol[] = [
  { id: "sym-greet", name: "greet", qualified_name: "Greeter.greet", symbol_type: "method", file: MAIN_REL, line_start: 2, line_end: 4, byte_start: 3, byte_end: 4, complexity: 1 },
  { id: "sym-main", name: "main", qualified_name: null, symbol_type: "function", file: MAIN_REL, line_start: 7, line_end: 11, byte_start: 10, byte_end: 2, complexity: 2 },
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
    // Depth-3 chain for the depth-cap mutant: top -> helper -> main -> greet. The
    // spans match FIXTURE_MAIN: helper = 13-15 (`main()` on 14), top = 17-19
    // (`helper()` on 18). Each span CONTAINS its own invocation, which is what
    // makes a like-for-like cross-check of a hop row provable.
    "sym-helper": { id: "sym-helper", name: "helper", symbolType: "function", file: MAIN_REL, filePath: abs, line: 13, lineEnd: 15, language: "typescript", complexity: 1, isExternal: false },
    "sym-top": { id: "sym-top", name: "top", symbolType: "function", file: MAIN_REL, filePath: abs, line: 17, lineEnd: 19, language: "typescript", complexity: 1, isExternal: false },
  }
}

// Deeper caller chain for depth testing: helper calls main (depth 2),
// top calls helper (depth 3). Present only when maxDepth >= 3. The stored lines
// are the hops' OWN invocations in FIXTURE_MAIN: `main()` on line 14 (helper's
// span 13-15) and `helper()` on line 18 (top's span 17-19).

/** A stored edge in the REAL engine's shape (M62.A1): `callSite` is a
 *  `CallSiteAddress` union, not a bare `{file, line}`. The pre-D4 fixture carried
 *  the old shape, which meant the cross-check could only ever see
 *  "an object that is not an address" — the gate would have passed for the wrong
 *  reason, which is the failure this whole lane exists to remove. */
type FixtureAddress =
  | { kind: "call-site"; file: string; line: number }
  | { kind: "declaration"; file: string; line: number; note: string }
  | { kind: "unknown"; file: string; line: null; note: string }

interface FixtureEdge {
  from: string
  to: string
  relationshipType: string
  confidence: number
  isCrossLanguage: boolean
  callSite: FixtureAddress
  depth: number
  rowId?: string
}

const CALLSITE_MAIN_TO_GREET: FixtureAddress = { kind: "call-site", file: MAIN_REL, line: 9 }

// main calls greet at line 9 (`  g.greet()`); greet calls console (external) at line 3.
const FIXTURE_EDGES: FixtureEdge[] = [
  { from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: CALLSITE_MAIN_TO_GREET, depth: 0, rowId: "row-main-greet" },
  { from: "sym-greet", to: "ext:console", relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 3 }, depth: 0, rowId: "row-greet-console" },
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
 *  maxDepth 2 only main + helper appear — the depth-cap mutant is visible.
 *  Each row's stored line names that row's OWN invocation (see FIXTURE_MAIN), so
 *  a like-for-like cross-check classifies all three as `agree`. */
function makeDeepDouble(_dir: string) {
  return async (_projectId: string, root: any, options: any): Promise<any> => {
    const maxDepth = options?.maxDepth ?? 5
    const chain: FixtureEdge[] = [
      { from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 9 }, depth: 0 },
      { from: "sym-helper", to: "sym-main", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 14 }, depth: 1 },
      { from: "sym-top", to: "sym-helper", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 18 }, depth: 2 },
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
    callers: [{ from: "sym-spin", to: root.id, relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: OFF_LAUNCH_REL, line: 4 }, depth: 0 }],
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

  // Not-indexed position: past every symbol span (the file's last line is 20).
  const missing = ch.prepareCallHierarchy(raw, { filePath: join(dir, MAIN_REL), line: 24, character: 0 })
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
    callers: [{ from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 900 }, depth: 0 }],
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
  // M55.T2: the call site is the INVOCATION of greet inside main — `g.greet()`,
  // 0-based line 8 (1-based 9) — found in the caller's own source and positioned
  // exactly. Truth Rule 3: the position is where the thing IS.
  check("G2: caller carries the INVOCATION as its call site", caller.fromRanges?.[0]?.start?.line === 8, JSON.stringify(caller.fromRanges))
  check("G2: call-site range is exactly the invoked name", (() => {
    const r = caller.fromRanges?.[0]
    if (!r || r.start.line !== r.end.line) return false
    return FIXTURE_MAIN.split("\n")[r.start.line]!.slice(r.start.character, r.end.character) === "greet"
  })(), JSON.stringify(caller.fromRanges))
  // Two invocations in the fixture body => two resolved RANGES. The count is in
  // the unit §13.4 requires (ranges), which is why it is 2 and not 1.
  check("G2: resolved (not approximate) call sites are declared", incoming.callSitesResolved === 2 && incoming.callSitesApproximate === 0, JSON.stringify({ resolved: incoming.callSitesResolved, approx: incoming.callSitesApproximate }))

  const outgoing = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "outgoing" }, makeTraverseDouble(dir))
  check("G2: outgoing callees found", outgoing.calls.length === 1, String(outgoing.calls.length))
  const callee = outgoing.calls[0] as any
  check("G2: callee is external console", callee.to?.data?.isExternal === true && callee.to?.name === "console", JSON.stringify(callee.to))
  cleanupDir(dir)
}

// --- D4: two sources of truth for "where is this called?" ---------------------

/** Total `fromRanges` a response RENDERS — the number §13.4 says the header
 *  counts must equal. */
function renderedRanges(result: any): number {
  return (result.calls as any[]).reduce((sum, c) => sum + ((c.fromRanges ?? []) as any[]).length, 0)
}

/**
 * §13.4 — `callSitesResolved + callSitesApproximate == fromRanges.length`.
 *
 * THE GATE NOTHING ASSERTED (docs/m62/CALLSITE-MIGRATION.md §3.2 item 3). It is
 * RED against the pre-D4 component and this is the proof it can fail: with the
 * old per-CALLER-ENTRY unit, one stored row with TWO invocations reports
 * `resolved: 1` while rendering TWO ranges, so the header count is a number the
 * eye cannot verify against the list (§13.4's exact prohibition).
 *
 * The fixture has to be able to produce two ranges from one row, which is why
 * `main` calls `greet()` twice — without that shape the assertion holds under
 * BOTH units and proves nothing.
 */
async function testCountsEqualRendered(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-c134-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  const multi = makeTraverseDouble(dir, {
    callers: [{ from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 9 }, depth: 0, rowId: "row-main-greet" }],
  })
  const result = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, multi)
  const ranges = result.calls[0]?.fromRanges?.length ?? 0
  check("G12: the fixture really renders TWO ranges from ONE stored row", ranges === 2, `ranges=${ranges}`)

  const declared = result.callSitesResolved + result.callSitesApproximate
  check("G12: resolved + approximate equals the rendered range count (13.4)", declared === ranges, `declared=${declared} rendered=${ranges}`)
  check("G12: the per-entry counter is kept beside it and also equals 1 (13.2)", result.callSiteEntries?.resolved === 1, JSON.stringify(result.callSiteEntries))

  // Approximate side: an unplaceable caller renders ONE range from the name
  // token, so the sum must still hold on the fallback path.
  const ghost = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 900 }, depth: 0 }],
  }))
  const ghostRanges = renderedRanges(ghost)
  check("G12: the approximate fallback satisfies 13.4 too", ghost.callSitesResolved + ghost.callSitesApproximate === ghostRanges && ghostRanges === 1, JSON.stringify({ declared: ghost.callSitesResolved + ghost.callSitesApproximate, rendered: ghostRanges }))

  // Both shapes at once, which is the case a per-entry count cannot express.
  const mixed = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [
      { from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 9 }, depth: 0 },
      { from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 900 }, depth: 0 },
    ],
  }))
  check("G12: a MIXED response (one caller with 2 ranges, one approximate) satisfies 13.4", mixed.callSitesResolved + mixed.callSitesApproximate === renderedRanges(mixed), JSON.stringify({ declared: mixed.callSitesResolved + mixed.callSitesApproximate, rendered: renderedRanges(mixed) }))
  cleanupDir(dir)
}

/** D4 (a) — the cross-check must be a PARTITION over every stored edge read, and
 *  each disagreement must be declared with BOTH positions and a reason. */
async function testAddressCrossCheck(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-d4-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)
  const census = (r: any) => r.addressCrossCheck
  const buckets = (c: any) => c.agree + c.disagree + c.sourceOnly + c.storeOnly + c.neither

  // 1. AGREE: the stored line names the invocation the scan found.
  const agree = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir))
  const c1 = census(agree)
  check("G13: the census covers every stored edge the answer read", c1.edges === 1, JSON.stringify(c1))
  check("G13: the buckets form a PARTITION of the edges (sum == edges)", buckets(c1) === c1.edges, JSON.stringify(c1))
  check("G13: a stored line naming the scan's own line is 'agree'", c1.agree === 1, JSON.stringify(c1))
  check("G13: agreement lists BOTH positions", (() => {
    const d = agree.addressDisagreements ?? []
    return d.length === 0 // agree is not a disagreement
  })(), JSON.stringify(agree.addressDisagreements))
  check("G13: directness is declared per row", c1.direct === 1 && c1.hop === 0 && c1.directnessUnstated === 0, JSON.stringify(c1))
  check("G13: the engine's address is present (no store-contract violation)", c1.addressMissing === 0, JSON.stringify(c1))

  // 2. DISAGREE: the store names the caller's DECLARATION line (7) while the
  // source invokes greet on 0-based 8. The spec's §3.2 test 1, as a gate.
  const disagree = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 7 }, depth: 0 }],
  }))
  const c2 = census(disagree)
  check("G13: a stored line naming the DECLARATION is classified 'disagree'", c2.disagree === 1 && c2.agree === 0, JSON.stringify(c2))
  check("G13: the declaration line is NEVER presented as the call site", disagree.calls[0]?.fromRanges?.[0]?.start?.line === 8, JSON.stringify(disagree.calls[0]?.fromRanges))
  const d2 = disagree.addressDisagreements ?? []
  // The reason must name BOTH positions (the store's line AND the scan's lines),
  // not merely contain the word "disagree" — a reason that restates the bucket
  // name tells a reader nothing they could not get from the bucket.
  check("G13: the disagreement is DECLARED naming the store's line AND the scan's lines", d2.length === 1 && String(d2[0].reason).includes("main.ts:7") && String(d2[0].reason).includes("[9,10]"), JSON.stringify(d2.map((x: any) => x.reason)))
  check("G13: the declared disagreement carries BOTH positions (both scan lines + the store line)", (() => {
    const a = d2[0]?.agreement;
    return Array.isArray(a?.sourceLines0) && a.sourceLines0.length === 2 && a.address !== null && a.renderedLine0 === 8
  })(), JSON.stringify(d2[0]?.agreement))
  check("G13: the declared disagreement says which relation the row is about", d2[0]?.agreement?.direct === true && d2[0]?.agreement?.edgeTargetName === "greet", JSON.stringify(d2[0]?.agreement))

  // 3. SOURCE-ONLY: the store names NO call site (the legacy 0 substitute), the
  // scan resolves the invocation. §15.1's other direction.
  const sourceOnly = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "declaration", file: MAIN_REL, line: 7, note: "this is the calling symbol's declaration, not the call site" }, depth: 0 }],
  }))
  check("G13: a store that names no call site is classified 'source-only'", census(sourceOnly).sourceOnly === 1, JSON.stringify(census(sourceOnly)))
  check("G13: 'source-only' is DECLARED, not silently dropped", (sourceOnly.addressDisagreements ?? []).length === 1, JSON.stringify(sourceOnly.addressDisagreements))
  check("G13: the rendered position is still the source-resolved one", sourceOnly.calls[0]?.fromRanges?.[0]?.start?.line === 8, JSON.stringify(sourceOnly.calls[0]?.fromRanges))

  // 4. STORE-ONLY: the store names a real call site the source scan cannot see.
// The macro / template / dynamic case. It needs a caller whose span does NOT
// contain the invoked name (`top`, span 17-19, calls `helper`) plus a stored
// call-site line: `disagree` requires the scan to have resolved SOMETHING else,
// so a caller that does resolve would land in that bucket instead. This is the
// distinction that keeps the two buckets from being the same claim.
  const storeOnly = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-top", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 18 }, depth: 0 }],
  }))
  const c4 = census(storeOnly)
  check("G13: a stored call site the scan cannot see is 'store-only'", c4.storeOnly === 1 && c4.disagree === 0 && c4.neither === 0, JSON.stringify(c4))
  check("G13: 'store-only' is DECLARED as a dropped edge naming the store's line", (storeOnly.droppedEdges ?? []).some((d: any) => String(d.reason).includes("the store and the caller's own text disagree") && String(d.reason).includes("18")), JSON.stringify(storeOnly.droppedEdges))
  check("G13: a store-only row renders NO range (there is no text position to render)", storeOnly.calls.length === 0, JSON.stringify(storeOnly.calls.map((c: any) => c.from?.name)))
  check("G13: the partition still holds with a dropped edge in it", buckets(c4) === c4.edges, JSON.stringify(c4))
  // NEGATIVE for the store-only bucket: with the SAME store line but a caller
  // that DOES resolve the name, the bucket must be `disagree`, not `store-only`.
  const notStoreOnly = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 18 }, depth: 0 }],
  }))
  negative("G13: the same store line against a caller that DOES resolve is 'disagree', not 'store-only'", census(notStoreOnly).disagree === 1 && census(notStoreOnly).storeOnly === 0, JSON.stringify(census(notStoreOnly)))

  // 5. NEITHER: neither side has a call-site position (the declared fallback).
  const neither = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "unknown", file: "", line: null, note: "call site not stored (no line_number in the index)" }, depth: 0 }],
  }))
  check("G13: neither side naming a call site is 'neither'", census(neither).neither === 1, JSON.stringify(census(neither)))
  check("G13: 'neither' is NOT listed as a disagreement (a shared absence is not a conflict)", (neither.addressDisagreements ?? []).length === 0, JSON.stringify(neither.addressDisagreements))

  // 6. A HOP is compared LIKE-FOR-LIKE and counted apart. For the depth-2 row
  // (`helper` -> `main`), the stored line names `helper`'s own invocation of
  // `main` on line 14 — correct in the store. Comparing that against "does
  // `helper` invoke `greet`" would report a contradiction the data does not
  // contain; that misreading is what this assertion exists to convict.
  const hop = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeDeepDouble(dir))
  const c6 = census(hop)
  check("G13: the census covers the DEEPER rows too", c6.edges === 3, JSON.stringify(c6))
  check("G13: hop rows are counted apart from direct rows (engine depth is 0-BASED)", c6.hop === 2 && c6.direct === 1 && c6.directnessUnstated === 0, JSON.stringify(c6))
  check("G13: a hop whose stored line names its OWN invocation is 'agree' (not a contradiction)", c6.agree === 3 && c6.disagree === 0, JSON.stringify(c6))
  check("G13: every row's comparison actually ran (no silent skip)", c6.comparisonNotRun === 0, JSON.stringify(c6))
  check("G13: the hop drop reason states the ENGINE'S depth, not a guess", (hop.droppedEdges ?? []).some((d: any) => String(d.reason).includes("depth 1")) && (hop.droppedEdges ?? []).some((d: any) => String(d.reason).includes("depth 2")), JSON.stringify((hop.droppedEdges ?? []).map((d: any) => d.reason)))
  check("G13: a hop's reason no longer offers 'or a stale stored row' (the engine already answered)", !(hop.droppedEdges ?? []).some((d: any) => String(d.reason).includes("stale stored row")), JSON.stringify((hop.droppedEdges ?? []).map((d: any) => d.reason)))

  // 7. An edge the engine returned WITHOUT an address is a store-contract
  // violation, declared — never read as "the store knows no call site".
  const noAddress = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, depth: 0 } as any],
  }))
  check("G13: an edge with NO address is counted as addressMissing", census(noAddress).addressMissing === 1, JSON.stringify(census(noAddress)))
  check("G13: addressMissing does not become a store-only claim", census(noAddress).storeOnly === 0, JSON.stringify(census(noAddress)))
  check("G13: the partition holds even with a contract violation", buckets(census(noAddress)) === census(noAddress).edges, JSON.stringify(census(noAddress)))

  // 8. An answer that read NO stored row says so — `edges: 0` is not
  // "0 disagreements found".
  const lonely = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, { callers: [] }))
  check("G13: an answer with no stored row publishes a ZERO-edge census, not an all-clear", census(lonely).edges === 0 && buckets(census(lonely)) === 0, JSON.stringify(census(lonely)))
  check("G13: the absent-answer path still carries the census field", lonely.addressCrossCheck !== undefined && lonely.addressCrossCheck !== null)
  cleanupDir(dir)
}

/** §15.3 — the DECLARATION of the invoked symbol is not an invocation. Measured
 *  as a live defect on the real M55 fixture before this gate existed: `Store`'s
 *  own body contains `get(key: string)`, the signature of the very method being
 *  expanded, and the scan read it as a call — so `Store` was rendered as a
 *  caller of `Store.get` with a range pointing at a declaration. */
async function testDeclarationIsNotACallSite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-decl-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  // `sym-top` (span 17-19) invokes `helper()`, never `greet`. A stored row saying
  // it does must yield NO range — the name-token fallback would otherwise point
  // at `helper`'s own DECLARATION (line 17), which §15.3 names first among the
  // things a range must never be.
  const declaredOnly = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-top", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 18 }, depth: 0 }],
  }))
  check("G13: a caller that does NOT invoke the name yields NO range (never the declaration)", declaredOnly.calls.length === 0, JSON.stringify(declaredOnly.calls.map((c: any) => c.from?.name)))
  check("G13: the non-invoking caller is DECLARED dropped", (declaredOnly.droppedEdges ?? []).some((d: any) => d.name === "top"), JSON.stringify(declaredOnly.droppedEdges))

  // The exclusion must be scoped to the DECLARED symbol's own line: a caller's
  // own declaration is not an invocation of the target, but an invocation on any
  // other line is, and a fix that skipped the name everywhere would lose it.
  const bothPresent = await ch.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 9 }, depth: 0 }],
  }))
  check("G13: the real invocation beside the caller's own declaration is still resolved", bothPresent.calls[0]?.fromRanges?.[0]?.start?.line === 8, JSON.stringify(bothPresent.calls[0]?.fromRanges))
  check("G13: BOTH invocations are resolved, neither eaten by the exclusion", bothPresent.calls[0]?.fromRanges?.length === 2, JSON.stringify(bothPresent.calls[0]?.fromRanges))
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

// --- D4 mutants -----------------------------------------------------------------
//
// Each of these is a way the two-sources-of-truth machinery can rot into
// decoration. A cross-check nobody mutates is a comment, and a count nobody
// mutates is a number.
//
// DEPTH CONVENTION, learned the hard way and now load-bearing: the engine's
// `depth` is 0-BASED (an edge adjacent to the traced symbol is `depth: 0`,
// measured on a real index — six caller rows at depth 0, one deeper row at 1).
// The `direct` predicate therefore tests `depth === 0`, and the mutants below
// include the off-by-one that reading it as 1 would be, because that mistake
// classifies every direct row as a hop and silently empties the `direct`
// population the agreement rate is reported over.

const D4_MUTANTS: Array<{ name: string; from: string; to: string }> = [
  {
    // §13.4: revert to counting CALLER ENTRIES. The oracle's fixture renders two
    // ranges from one row, so this reports 1 while rendering 2.
    name: "13.4: count caller ENTRIES again (the pre-D4 unit)",
    from: "      callSitesResolved += invocations.length;",
    to: "      callSitesResolved += 1;",
  },
  {
    // §13.4: the approximate side, same defect.
    name: "13.4: over-count the approximate side",
    from: "      callSitesApproximate += 1;",
    to: "      callSitesApproximate += 2;",
  },
  {
    // §15.1: silently resolve a disagreement in favour of the store. This is
    // option (b) smuggled in — the stored line rendered as the call site.
    name: "D4: render the STORE's line when the two sources disagree (D4=(b) by the back door)",
    from: "    if (invocations.length > 0) {\n      fromRanges = invocations.map((i) => i.range);",
    to: "    if (invocations.length > 0 && agreement.agreement !== \"disagree\") {\n      fromRanges = invocations.map((i) => i.range);",
  },
  {
    // §15.1: declare nothing. The census keeps counting, the reasons vanish.
    name: "D4: swallow the declared disagreements (keep the census)",
    from: "    if (agreement.agreement !== \"agree\" && agreement.agreement !== \"neither\") {",
    to: "    if (false) {",
  },
  {
    // §15.1: call everything agreement. Every row then lands in one bucket and the
    // gate is decoration.
    name: "D4: classify every row as agreement",
    from: "  if (storeNamesCallSite && storedLine0 !== null && sourceLines.includes(storedLine0)) {",
    to: "  if (true) {",
  },
  {
    // The like-for-like rule removed: a hop row compared against the EXPANDED
    // symbol instead of its own target. On the deep fixture this turns two
    // correct stored rows into false contradictions.
    name: "D4: compare a HOP row against the expanded symbol (not like-for-like)",
    from: "    const likeForLike = edge.depth === 0 && edgeTargetName === invokedName && edgeSource !== undefined;",
    to: "    const likeForLike = edge.depth === 0 && edgeSource !== undefined;",
  },
  {
    // §15.3: the declaration exclusion removed. `Store`-shaped cases read a
    // member's own signature as a call of itself.
    name: "15.3: read the invoked symbol's DECLARATION as an invocation",
    from: "          targetDeclPos === undefined ? [] : [targetDeclPos],",
    to: "          [],",
  },
  {
    // The directness declaration removed: hops and direct rows averaged together.
    name: "D4: stop declaring directness (count hops as direct)",
    from: "  if (depth === 0) census.direct++;\n  else if (Number.isInteger(depth) && depth >= 1) census.hop++;",
    to: "  if (depth >= 0) census.direct++;\n  else if (false) census.hop++;",
  },
  {
    // A missing address read as "the store knows no call site" — the exact
    // confusion the `addressMissing` counter exists to prevent.
    name: "D4: read a MISSING address as a source-only row (no contract-violation count)",
    from: "  const address = (edge as { callSite?: CallSiteAddress }).callSite ?? null;",
    to: "  const address = ((edge as { callSite?: CallSiteAddress }).callSite ?? { kind: \"unknown\", file: \"\", line: null, note: \"fabricated\" }) as CallSiteAddress;",
  },
  {
    // §13.4: the partition broken — edges counted without a bucket, so the rate's
    // denominator no longer matches the numerator's population.
    name: "D4: break the partition (count an edge in no bucket)",
    from: "  census.edges++;",
    to: "  census.edges++; if (agreement.agreement === \"agree\") return;",
  },
  {
    // The off-by-one this lane actually shipped and then measured on a real
    // index: the engine's depth is 0-based, so `depth === 1` empties the direct
    // population and reports the whole corpus as hops.
    name: "D4: read directness as depth === 1 (the engine is 0-based)",
    from: "  const direct = depth === 0;",
    to: "  const direct = depth === 1;",
  },
  {
    // The like-for-like predicate keyed on the same wrong convention.
    name: "D4: like-for-like keyed on the 1-based depth (off by one)",
    from: "    const likeForLike = edge.depth === 0 && edgeTargetName === invokedName && edgeSource !== undefined;",
    to: "    const likeForLike = edge.depth === 1 && edgeTargetName === invokedName && edgeSource !== undefined;",
  },
  {
    // The hop guard likewise: with `> 1` a real depth-1 hop stops being declared
    // a hop and is reported as a stale direct row.
    name: "D4: the hop guard off by one (a depth-1 hop called stale)",
    from: "      const hop = Number.isInteger(edge.depth) && edge.depth >= 1;",
    to: "      const hop = Number.isInteger(edge.depth) && edge.depth > 1;",
  },
]

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

/**
 * Rewrite every RELATIVE import in a component copy to an absolute file URL, so
 * the copy can live in a scratch directory and still resolve its siblings.
 *
 * Why generic and not a list: the hand-written list this replaced omitted
 * `./signature`, and every mutant then failed to import while the suite counted
 * it "caught". A missing list entry is silent, and a silent list entry turns the
 * mutation gate into decoration. Resolving what the source actually says cannot
 * go stale.
 */
function rewriteRelativeImports(source: string): string {
  const componentDir = dirname(COMPONENT)
  return source.replace(/from\s+"(\.\.?\/[^"]+)"/g, (_match, specifier: string) => {
    const target = join(componentDir, specifier)
    const resolved = existsSync(`${target}.ts`) ? `${target}.ts` : existsSync(target) ? target : `${target}.ts`
    return `from "${pathToFileURL(resolved).href}"`
  })
}


async function runChMutants(): Promise<{ caught: number; notJudged: number }> {
  console.log("Call hierarchy mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0
  let notJudged = 0

  for (const mutant of [...CH_MUTANTS, ...D4_MUTANTS]) {
    if (!source.includes(mutant.from)) {
      console.log(`  NOT JUDGED (anchor not found): ${mutant.name}`)
      notJudged++
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    const mutantPath = join(ROOT, "validation", "m24", `ch.mutant.${mutantsSeen++}.ts`)
    // GENERIC relative-import rewrite. The pre-lane rewriter was a hand-written
    // list, it missed `./signature`, and every one of its five mutants then died
    // on an import error while being counted "caught" — a suite that proved
    // nothing. A list is the wrong shape: every import added to the component
    // would have to be added here too, and forgetting is silent. This resolves
    // whatever the component actually imports, so a NEW import cannot break the
    // harness. An import failure is still NOT counted as caught (see below).
    const absImport = rewriteRelativeImports(mutantSource)
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

/**
 * The D4 oracle: what a two-sources-of-truth surface must still do when a defect
 * is planted in the cross-check or the counts.
 *
 * Return `true` = the mutant is CAUGHT (the oracle found the defect). Every
 * assertion here mirrors a named check in `testAddressCrossCheck` /
 * `testCountsEqualRendered` / `testDeclarationIsNotACallSite`, so a mutant cannot
 * be caught by an assertion the real suite does not also run — the standard that
 * keeps a mutation gate from proving something the suite does not claim.
 */
async function d4OracleFails(mod: any, dir: string): Promise<boolean> {
  const raw = makeFixture(dir)
  const buckets = (c: any) => c.agree + c.disagree + c.sourceOnly + c.storeOnly + c.neither
  const rendered = (r: any) => (r.calls as any[]).reduce((n, c) => n + ((c.fromRanges ?? []) as any[]).length, 0)
  const edge = (callSite: any, depth = 0, from = "sym-main") => ({
    from, to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, callSite, depth,
  })

  // §13.4 on the shape that distinguishes the units: ONE row, TWO ranges.
  const multi = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [edge({ kind: "call-site", file: MAIN_REL, line: 9 })],
  }))
  if ((multi.calls[0]?.fromRanges?.length ?? 0) !== 2) return true
  if (multi.callSitesResolved + multi.callSitesApproximate !== rendered(multi)) return true
  if (multi.callSiteEntries?.resolved !== 1) return true

  // The disagreement case: the store names the DECLARATION line 7.
  const dis = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [edge({ kind: "call-site", file: MAIN_REL, line: 7 })],
  }))
  if ((dis.addressCrossCheck?.disagree ?? 0) !== 1) return true
  if ((dis.addressDisagreements ?? []).length !== 1) return true
  const d0 = dis.addressDisagreements[0];
  if (!String(d0?.reason ?? "").includes("main.ts:7")) return true
  if (!String(d0?.reason ?? "").includes("[9,10]")) return true
  // The declaration line must never be what the editor is handed.
  if (dis.calls[0]?.fromRanges?.[0]?.start?.line !== 8) return true

  // store-only vs disagree are DIFFERENT claims, and both must be reachable.
  const storeOnly = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [edge({ kind: "call-site", file: MAIN_REL, line: 18 }, 1, "sym-top")],
  }))
  if ((storeOnly.addressCrossCheck?.storeOnly ?? 0) !== 1) return true
  if (storeOnly.calls.length !== 0) return true
  const notStoreOnly = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [edge({ kind: "call-site", file: MAIN_REL, line: 18 })],
  }))
  if ((notStoreOnly.addressCrossCheck?.disagree ?? 0) !== 1) return true
  if ((notStoreOnly.addressCrossCheck?.storeOnly ?? 0) !== 0) return true

  // source-only: the store names no call site, the scan resolves one.
  const srcOnly = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [edge({ kind: "declaration", file: MAIN_REL, line: 7, note: "substitute" })],
  }))
  if ((srcOnly.addressCrossCheck?.sourceOnly ?? 0) !== 1) return true
  if ((srcOnly.addressDisagreements ?? []).length !== 1) return true
  if (srcOnly.calls[0]?.fromRanges?.[0]?.start?.line !== 8) return true

  // neither: a shared absence is not a disagreement.
  const neither = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "unknown", file: "", line: null, note: "not stored" }, depth: 0 }],
  }))
  if ((neither.addressCrossCheck?.neither ?? 0) !== 1) return true
  if ((neither.addressDisagreements ?? []).length !== 0) return true

  // LIKE-FOR-LIKE: the deep chain's hop rows name their OWN invocations.
  const deep = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeDeepDouble(dir))
  const c = deep.addressCrossCheck
  if (c?.edges !== 3 || c.agree !== 3 || c.disagree !== 0) return true
  // 0-based depth: one direct row, two hop rows. This is the assertion that
  // convicts the depth off-by-one in either direction.
  if (c.direct !== 1 || c.hop !== 2 || c.directnessUnstated !== 0) return true
  if (c.comparisonNotRun !== 0) return true
  if (!(deep.droppedEdges ?? []).some((x: any) => String(x.reason).includes("depth 1"))) return true
  if (!(deep.droppedEdges ?? []).some((x: any) => String(x.reason).includes("depth 2"))) return true

  // A missing address is a contract violation, never a source-only claim.
  const noAddr = await mod.expandCalls(raw, "proj", { item: GREET_ITEM, direction: "incoming" }, makeTraverseDouble(dir, {
    callers: [{ from: "sym-main", to: "sym-greet", relationshipType: "calls", confidence: 1.0, isCrossLanguage: false, depth: 0 }],
  }))
  if ((noAddr.addressCrossCheck?.addressMissing ?? 0) !== 1) return true
  if ((noAddr.addressCrossCheck?.sourceOnly ?? 0) !== 0) return true

  // The partition must hold over every one of those responses.
  for (const r of [multi, dis, storeOnly, srcOnly, neither, deep, noAddr]) {
    const k = r.addressCrossCheck
    if (k === undefined || buckets(k) !== k.edges) return true
  }
  return false
}

async function chMutantOracle(mod: any, mutantSource: string): Promise<boolean> {
  const d = mkdtempSync(join(tmpdir(), "bblsp-l5mut-"))
  try {
    // G11 is a gate like any other: a reintroduced inline conversion is
    // convicted by the same scan the real source runs.
    if (findInlinePositionArithmetic(mutantSource, "call_hierarchy.mutant.ts").length > 0) return true
    const raw = makeFixture(d)
    // ---- D4 oracle: the two sources of truth, and §13.4's count.
    if (await d4OracleFails(mod, d)) return true

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
      callers: [{ from: "sym-ghostline", to: "sym-greet", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "call-site", file: MAIN_REL, line: 900 }, depth: 0 }],
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
  await testCountsEqualRendered()
  await testAddressCrossCheck()
  await testDeclarationIsNotACallSite()
  await testTruncation()
  await testExternal()
  await testPositions()
  testInlinePositionGate()
  await testLatency()

  const { caught, notJudged } = await runChMutants()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(readFileSync(COMPONENT)).digest("hex")
  const TOTAL_MUTANTS = CH_MUTANTS.length + D4_MUTANTS.length
  const ok = failed === 0 && caught === TOTAL_MUTANTS && notJudged === 0
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
      mutantsTotal: TOTAL_MUTANTS,
      mutantsNotJudged: notJudged,
      mutantsJudged: caught,
      mutantGroups: { callHierarchy: CH_MUTANTS.length, d4CrossCheck: D4_MUTANTS.length },
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
  console.log(`\nL5: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${caught}/${TOTAL_MUTANTS} mutants caught${notJudged ? `, ${notJudged} NOT JUDGED` : ""}, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})