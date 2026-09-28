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
//
// Run: npx tsx script/m24/verify-call-hierarchy.ts
// Evidence: validation/m24/results/L5.json (machine-emitted)

import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT = join(ROOT, "src", "lsp", "call_hierarchy.ts")
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

interface FixtureSymbol {
  id: string
  name: string
  qualified_name: string | null
  symbol_type: string
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
const FIXTURE_SYMBOLS: FixtureSymbol[] = [
  { id: "sym-greet", name: "greet", qualified_name: "Greeter.greet", symbol_type: "method", line_start: 2, line_end: 4, byte_start: 3, byte_end: 4, complexity: 1 },
  { id: "sym-main", name: "main", qualified_name: null, symbol_type: "function", line_start: 7, line_end: 10, byte_start: 10, byte_end: 2, complexity: 2 },
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
  return {
    "sym-greet": { id: "sym-greet", name: "greet", symbolType: "method", file: MAIN_REL, filePath: abs, line: 2, lineEnd: 4, language: "typescript", complexity: 1, isExternal: false },
    "sym-main": { id: "sym-main", name: "main", symbolType: "function", file: MAIN_REL, filePath: abs, line: 7, lineEnd: 10, language: "typescript", complexity: 2, isExternal: false },
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

function makeFixture(dir: string): any {
  const filePath = join(dir, MAIN_REL)
  if (!existsSync(filePath)) writeFileSync(filePath, FIXTURE_MAIN)

  const raw = {
    prepare(sql: string) {
      const s = sql.toLowerCase().replace(/\s+/g, " ")
      return {
        get(...args: any[]) {
          if (s.includes("from brain_symbol s join brain_file f") && s.includes("where s.id = ?")) {
            const id = args[0] as string
            const sym = FIXTURE_SYMBOLS.find((x) => x.id === id)
            if (!sym) return undefined
            return {
              id: sym.id,
              name: sym.name,
              symbol_type: sym.symbol_type,
              line: sym.line_start,
              lineEnd: sym.line_end,
              relativePath: MAIN_REL,
              filePath,
              language: "typescript",
              complexity: sym.complexity,
            }
          }
          return undefined
        },
        all(...args: any[]) {
          // findIndexedSymbol's symbol query (shared with L3).
          if (s.includes("from brain_symbol s join brain_file f") && s.includes("where f.path = ?")) {
            const fpath = args[0] as string
            const line1 = args[1] as number
            if (fpath !== filePath) return []
            return FIXTURE_SYMBOLS
              .filter((sym) => sym.line_start <= line1 && sym.line_end >= line1)
              .map((sym) => ({
                ...sym,
                file_id: "file-main",
                f_id: "file-main",
                path: filePath,
                language: "typescript",
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

// --- Tests -------------------------------------------------------------------

async function testPrepare(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-prep-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  // Position on greet (0-based line 1, char 4).
  const result = ch.prepareCallHierarchy(raw, { filePath: join(dir, MAIN_REL), line: 1, character: 4 })
  check("G1: prepare resolves greet", result.item?.name === "greet", JSON.stringify(result.item))
  check("G1: prepare not indexed false", result.notIndexed === false)
  check("G1: item kind is Method", result.item?.kind === 6, String(result.item?.kind))
  check("G1: item carries symbol identity", result.item?.data?.symbolId === "sym-greet")
  check("G1: item uri is file uri", (result.item?.uri ?? "").startsWith("file://"))

  // Not-indexed position (trailing empty line, 0-based line 10).
  const missing = ch.prepareCallHierarchy(raw, { filePath: join(dir, MAIN_REL), line: 10, character: 0 })
  check("G1: not-indexed position -> null + declared", missing.item === null && missing.notIndexed === true)
  cleanupDir(dir)
}

async function testExpand(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-exp-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  const item = { name: "greet", kind: 6, uri: "file://x", range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, data: { symbolId: "sym-greet", isExternal: false } }
  const incoming = await ch.expandCalls(raw, "proj", { item, direction: "incoming" }, makeTraverseDouble(dir))
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

  const outgoing = await ch.expandCalls(raw, "proj", { item, direction: "outgoing" }, makeTraverseDouble(dir))
  check("G2: outgoing callees found", outgoing.calls.length === 1, String(outgoing.calls.length))
  const callee = outgoing.calls[0] as any
  check("G2: callee is external console", callee.to?.data?.isExternal === true && callee.to?.name === "console", JSON.stringify(callee.to))
  cleanupDir(dir)
}

async function testTruncation(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-trunc-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)

  const item = { name: "greet", kind: 6, uri: "file://x", range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, data: { symbolId: "sym-greet", isExternal: false } }
  const truncated = await ch.expandCalls(raw, "proj", { item, direction: "incoming" }, makeTraverseDouble(dir, { truncated: true, truncationReason: "caller-budget-exhausted", maxDepthReached: 4 }))
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
  const extItem = { name: "console", kind: 2, uri: "", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, data: { symbolId: "ext:console", isExternal: true } }
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
  cleanupDir(dir)
}

async function testLatency(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bblsp-l5-lat-"))
  const raw = makeFixture(dir)
  const ch = await import(COMPONENT)
  const traverse = makeTraverseDouble(dir)
  const item = { name: "greet", kind: 6, uri: "file://x", range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, data: { symbolId: "sym-greet", isExternal: false } }

  for (let i = 0; i < 10; i++) await ch.expandCalls(raw, "proj", { item, direction: "incoming" }, traverse)
  const samples: number[] = []
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now()
    await ch.expandCalls(raw, "proj", { item, direction: "incoming" }, traverse)
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
]

async function runChMutants(): Promise<number> {
  console.log("Call hierarchy mutation suite: planting defects into a copy of the component")
  const source = readFileSync(COMPONENT, "utf8")
  let caught = 0

  for (const mutant of CH_MUTANTS) {
    if (!source.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    const mutantSource = source.replace(mutant.from, mutant.to)
    const mutantPath = join(ROOT, "validation", "m24", `ch.mutant.${Date.now()}.ts`)
    const absImport = mutantSource
      .replace(/from "\.\.\/brain\/database"/g, `from "file://${join(ROOT, "src", "brain", "database.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/project\/schema"/g, `from "file://${join(ROOT, "src", "project", "schema.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/positions"/g, `from "file://${join(ROOT, "src", "lsp", "positions.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/hover"/g, `from "file://${join(ROOT, "src", "lsp", "hover.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\/navigation"/g, `from "file://${join(ROOT, "src", "lsp", "navigation.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/intelligence\/graph\/graph-engine"/g, `from "file://${join(ROOT, "src", "intelligence", "graph", "graph-engine.ts").replace(/\\/g, "/")}"`)
      .replace(/from "\.\.\/intelligence\/contracts"/g, `from "file://${join(ROOT, "src", "intelligence", "contracts.ts").replace(/\\/g, "/")}"`)
    writeFileSync(mutantPath, absImport)
    let mod: any
    try {
      mod = await import(mutantPath)
    } catch (error) {
      caught++
      console.log(`  caught (import failure): ${mutant.name}`)
      console.log(`      ${String(error).split("\n")[0]}`)
      try { rmSync(mutantPath, { force: true }) } catch {}
      continue
    }
    try {
      const ok = await chMutantOracle(mod, dir)
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
  return caught
}

let dir: string = ""

async function chMutantOracle(mod: any, keepDir: string): Promise<boolean> {
  const d = keepDir || mkdtempSync(join(tmpdir(), "bblsp-l5mut-"))
  try {
    const raw = makeFixture(d)
    const item = { name: "greet", kind: 6, uri: "file://x", range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, data: { symbolId: "sym-greet", isExternal: false } }

    // Caller oracle: exactly one incoming caller (main), no fabrication.
    const incoming = await mod.expandCalls(raw, "proj", { item, direction: "incoming" }, makeTraverseDouble(d))
    if (incoming.calls.length !== 1) return true
    if (incoming.calls[0].from?.name !== "main") return true
    if (incoming.calls[0].from?.data?.isExternal === true) return true
    // Fabricated-caller mutant adds an ext:ghost caller edge; the ghost node
    // IS in the engine's node map, so it would render as a caller — the
    // oracle must catch any caller that is not main.
    if (incoming.calls.some((c: any) => c.from?.name === "ghost")) return true
    // M55.T2 oracle: the call site must be the INVOCATION in the caller's own
    // source (`g.greet()`, 0-based line 8), declared as resolved. A component
    // that echoes the stored edge line or falls back to the caller's name token
    // must fail here — this is what makes the source-resolution mutant mortal.
    const r0 = incoming.calls[0].fromRanges?.[0]
    if (!r0 || r0.start.line !== 8 || r0.end.line !== 8) return true
    if ((FIXTURE_MAIN.split("\n")[r0.start.line] ?? "").slice(r0.start.character, r0.end.character) !== "greet") return true
    if (incoming.callSitesResolved !== 1 || incoming.callSitesApproximate !== 0) return true

    // Outgoing oracle: exactly one callee (external console), declared.
    const outgoing = await mod.expandCalls(raw, "proj", { item, direction: "outgoing" }, makeTraverseDouble(d))
    if (outgoing.calls.length !== 1) return true
    if (outgoing.calls[0].to?.data?.isExternal !== true) return true

    // Truncation oracle: engine truncation must surface.
    const truncated = await mod.expandCalls(raw, "proj", { item, direction: "incoming" }, makeTraverseDouble(d, { truncated: true, truncationReason: "caller-budget-exhausted", maxDepthReached: 4 }))
    if (truncated.truncated !== true) return true
    if (truncated.truncationReason !== "caller-budget-exhausted") return true

    // Depth oracle: default maxDepth must reach depth 3 (main, helper, top).
    // The depth-cap mutant (cap 2) drops top — observable through the deep
    // double's faithful depth simulation.
    const deep = await mod.expandCalls(raw, "proj", { item, direction: "incoming" }, makeDeepDouble(d))
    const deepNames = deep.calls.map((c: any) => c.from?.name).sort()
    if (JSON.stringify(deepNames) !== JSON.stringify(["helper", "main", "top"])) return true

    return false
  } finally {
    if (!keepDir) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
  }
}

// --- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L5 verifier — call hierarchy over the bounded traverseGraph engine\n")

  await testPrepare()
  await testExpand()
  await testTruncation()
  await testExternal()
  await testPositions()
  await testLatency()

  const mutantsCaught = await runChMutants()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(readFileSync(COMPONENT)).digest("hex")
  const ok = failed === 0 && mutantsCaught === CH_MUTANTS.length
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
      mutantsCaught,
      mutantsTotal: CH_MUTANTS.length,
      ok,
      note: "`failed` counts real functional failures only; mutant runs are reported separately via the verdict block.",
    },
    limitations: [
      "adapter proven against a fixture double reproducing the engine contract; the engine itself is M14-verified and exercised end-to-end by the V1 harness",
      "heuristic edges from the engine are included; their ratio is declared by the engine's provenance",
      "ranges for engine nodes use line-level precision when the engine lacks byte columns",
      "latency measured on this machine only; cross-platform budgets are M25 scope",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nL5: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${mutantsCaught}/${CH_MUTANTS.length} mutants caught, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})
