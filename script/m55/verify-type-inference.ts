// script/m55/verify-type-inference.ts — M55.T6 verifier + mutation suite.
//
// THE GAP THIS GATE CLOSES
// -------------------------
// `src/ast/type-inference.ts` is a 1006-line type/flow inference engine that
// had never been wired to ANY editor surface (`grep -rn "type-inference\|
// TypeInference" src/lsp/` returned nothing at this lane's start). This gate is
// about SURFACING it HONESTLY, which turned out to be the harder half.
//
// WHAT THE ASSESSMENT FOUND (measured, 14 launch languages)
// --------------------------------------------------------
//   lang        the engine's answer for a function returning String
//   ----------  ---------------------------------------------------------
//   typescript  string @1.0      javascript string @1.0   java   string @1.0
//   python      string @1.0      go        unknown @0
//   kotlin      covered but NO ENTRY (getFunctionBody finds no body field)
//   rust/c/cpp  covered but NO ENTRY
//   vue/svelte  ZERO declared node types matched — no coverage at all
//   scala       void   @1.0   <-- WRONG
//   groovy      void   @1.0   <-- WRONG
//   zig         void   @1.0   <-- WRONG
//
// Root cause of the three wrong rows, in the engine's own source:
// `inferFunctionReturnType` (type-inference.ts:227-240) returns `getVoidType()`
// — confidence 1.0 — when `findReturnStatements` finds no node typed
// `return_statement`. That is "this grammar's return form was not recognized",
// reported as maximum certainty in `void`.
//
// So `confidence` is NOT a measurement. Measured: it is a per-codepath constant
// (getStringType/getNumberType/getBooleanType/getVoidType are all 1.0;
// initializeGenericTypes hands every unlisted language 0.8; the method-pattern
// table answers `o.push(1)` on an `any` with `number` at 1.0; createUnionType
// takes Math.max over its members). A gate of the form "render when
// confidence >= X" would print `-> void` on a Scala method returning String.
// THAT IS WHY THIS GATE EXISTS IN THIS SHAPE.
//
// WHAT IS ACTUALLY PROVEN HERE
//   R1 fixture   every authored case, and the MEASURED engine answer pinned
//                next to it (so an engine change fails loudly)
//   R2 facade    every authored expectation: provenance class, exact rendered
//                text, engine confidence, withheld reason
//   R3 wire      the REAL dist server renders the type line with its
//                provenance; the dishonest rows render the DECLARED marker
//   R4 no invention  differential: every rendered text is either the stored
//                value or a verbatim engine answer — nothing else can appear
//   R5 freshness a stale file marks the INFERRED line stale, not just the card
//   R6 latency   real nearest-rank p95 over 200 samples/shape, multiple shapes,
//                load average recorded. A budget miss fails this gate.
//   R7 mutants   fabricated type / suppressed unknown marker / confidence
//                override / promoted void — each must FAIL, none caught by a
//                load failure
//
// Run: npx tsx script/m55/verify-type-inference.ts
// Evidence: validation/m55/results/T6.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { loadavg, totalmem, cpus } from "node:os"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { T6_SYMBOLS, T6_SOURCES, seedT6Db, writeT6Workspace } from "./type-inference-fixture.ts"
import { StdioLsp, ensureServerBuilt } from "./lsp-wire.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const FACADE = path.join(ROOT, "src/lsp/type_inference_surface.ts")
const SIGNATURE = path.join(ROOT, "src/lsp/signature.ts")
const EVIDENCE = path.join(ROOT, "validation/m55/results/T6.json")

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []
let mutantsTotal = 0
let mutantsCaught = 0
let anchorDrift = 0

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  check(`NEG ${label}`, ok, detail)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  else anchorDrift++
  check(`${label} [mutant]`, caught, detail)
}

function nearestRankP95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!
}
function nearestRank(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })

// --- R1: the fixture ------------------------------------------------------------
console.log("R1: the fixture and the MEASURED engine answer pinned beside it")
const ws = mkdtempSync(path.join(tmpdir(), "m55-t6-ws-"))
const dataDir = mkdtempSync(path.join(tmpdir(), "m55-t6-data-"))
writeT6Workspace(ws)
const seed = await seedT6Db(ws, dataDir)
const raw = seed.raw as any

check("R1: every fixture symbol exists in the index with its authored return_type", (() => {
  for (const s of T6_SYMBOLS) {
    const row = raw.prepare("SELECT return_type FROM brain_symbol WHERE name = ? AND qualified_name = ?").get(s.name, s.qualified) as { return_type: string | null } | undefined
    if (row === undefined || row.return_type !== s.returnType) return false
  }
  return true
})(), "")
check("R1: the fixture carries a case for every provenance class", (() => {
  const classes = new Set(T6_SYMBOLS.map((s) => s.expect.provenance))
  return classes.has("inferred") && classes.has("stored") && classes.has("unknown")
})(), "")
check("R1: the dishonest-engine case is in the fixture (scala void@1.0)", (() => {
  const s = T6_SYMBOLS.find((x) => x.file.endsWith(".scala"))!
  return s.expect.provenance === "unknown" && s.expect.withheld === "engine-reported-void-without-valueless-return"
})(), "")
check("R1: the fixture's sources exist on disk with the authored content", readFileSync(path.join(ws, "src/scala/Scaler.scala"), "utf8").includes('def scaled(): String = "s"'), "")

// --- R2: the facade -------------------------------------------------------------
console.log("\nR2: the facade (src/lsp/type_inference_surface.ts)")
const facade = (await import(FACADE)) as {
  resolveTypeLine: (
    f: string, c: string,
    s: { name: string; symbol_type: string; return_type: string | null; line_start: number | null; line_end: number | null; language: string | null },
    r: string | null,
  ) => Promise<any>
  ENGINE_CONFIDENCE_FLOOR: number
  MAX_WITNESS_BYTES: number
  UNRESOLVED_TYPE?: string
}
const { UNRESOLVED_TYPE } = (await import(SIGNATURE)) as { UNRESOLVED_TYPE: string }

// §8.7 self-audit. The gate and the facade both import UNRESOLVED_TYPE from
// signature.ts, so asserting `card.includes(UNRESOLVED_TYPE)` alone is
// TAUTOLOGICAL: the two would agree on any value, including a real type name.
// The marker is therefore pinned to its literal word here, so changing it to
// something a reader could mistake for a type fails the gate.
check("R2: the declared unknown marker is the literal word `unknown`", UNRESOLVED_TYPE === "unknown", `got "${UNRESOLVED_TYPE}"`)

function langFor(rel: string): string {
  if (rel.endsWith(".ts")) return "typescript"
  if (rel.endsWith(".scala")) return "scala"
  if (rel.endsWith(".kt")) return "kotlin"
  if (rel.endsWith(".svelte")) return "svelte"
  return "typescript"
}

const observed: Record<string, unknown> = {}

// The ceiling is a measured number, so it is pinned here rather than read from
// the module: a facade that RAISED its own ceiling to dodge the fixture would
// otherwise pass silently. 48 KiB is where the measured p95 band first exceeds
// the 50 ms budget (48-72 KiB band worst p95 65.4 ms).
check("R2: the declared witness ceiling is the measured 48 KiB", facade.MAX_WITNESS_BYTES === 48 * 1024, `got ${facade.MAX_WITNESS_BYTES}`)
check("R2: the fixture's over-ceiling file really is over the ceiling", Buffer.byteLength(T6_SOURCES["src/big.ts"]!, "utf8") > facade.MAX_WITNESS_BYTES, `${Buffer.byteLength(T6_SOURCES["src/big.ts"]!, "utf8")} bytes`)

for (const s of T6_SYMBOLS) {
  const abs = path.join(ws, s.file)
  const content = readFileSync(abs, "utf8")
  const r = await facade.resolveTypeLine(
    abs, content,
    { name: s.name, symbol_type: s.type, return_type: s.returnType, line_start: s.line, line_end: s.line + s.span - 1, language: langFor(s.file) },
    s.returnType,
  )
  observed[s.id] = { provenance: r.line.provenance, text: r.line.text, confidence: r.line.confidence, withheld: r.line.withheld, engine: r.engine, coverage: r.engineCoverage }
  check(`R2: ${s.name} renders its authored provenance class`, r.line.provenance === s.expect.provenance, `got "${r.line.provenance}" want "${s.expect.provenance}"`)
  check(`R2: ${s.name} renders the authored text`, r.line.text === s.expect.text, `got "${r.line.text}" want "${s.expect.text}"`)
  if (s.expect.confidence !== undefined) {
    check(`R2: ${s.name} carries the engine's confidence verbatim`, r.line.confidence === s.expect.confidence, `got ${String(r.line.confidence)} want ${s.expect.confidence}`)
  }
  check(`R2: ${s.name} carries the authored withheld reason`, r.line.withheld === s.expect.withheld, `got "${String(r.line.withheld)}" want "${String(s.expect.withheld)}"`)
}

// --- R3/R4: the wire -----------------------------------------------------------
console.log("\nR3: the wire — the REAL server renders the type line with its provenance")
ensureServerBuilt()
const wire = new StdioLsp(ws, { ...process.env, BB_DATA_DIR: dataDir } as Record<string, string | undefined>)
const wireTypeLines: Record<string, unknown> = {}
try {
  const initRes = await wire.initialize(ws)
  check("R3: the server initializes over the fixture workspace", initRes.error === undefined, JSON.stringify(initRes).slice(0, 200))
  for (const s of T6_SYMBOLS) {
    const abs = path.join(ws, s.file)
    const lineText = readFileSync(abs, "utf8").split("\n")[s.line - 1]!
    const char = Math.max(0, lineText.indexOf(s.name))
    const res = await wire.request("textDocument/hover", { textDocument: { uri: `file://${abs}` }, position: { line: s.line - 1, character: char } })
    const card: string = res.result?.contents?.value ?? ""
    const tl = res.result?.data?.symbol?.typeLine
    wireTypeLines[s.id] = tl ?? null
    check(`R3: ${s.name}'s hover card carries a type line`, tl !== undefined && tl !== null, JSON.stringify(res.result?.data?.symbol ?? null).slice(0, 200))
    if (tl === undefined || tl === null) continue
    check(`R3: ${s.name}'s wire provenance matches the facade`, tl.provenance === s.expect.provenance, `got "${tl.provenance}" want "${s.expect.provenance}"`)
    check(`R3: ${s.name}'s wire text matches the facade`, tl.text === s.expect.text, `got "${tl.text}" want "${s.expect.text}"`)

    // §15.4 human text is human: the marker renders, a raw shape never does.
    negative(`R3: ${s.name}'s card renders no raw JSON shape`, !/[{[]\s*"?[A-Za-z_][A-Za-z0-9_]*"?\s*:/.test(card), card.slice(0, 120))
    // The three classes must be VISUALLY distinguishable in the human text.
    if (s.expect.provenance === "inferred") {
      negative(`R3: ${s.name}'s card labels the type as INFERRED`, /inferred/i.test(card), card.slice(0, 200))
      negative(`R3: ${s.name}'s card states the engine's confidence`, new RegExp(String(s.expect.confidence), "").test(card) && /confidence/i.test(card), card.slice(0, 240))
    }
    if (s.expect.provenance === "stored") {
      negative(`R3: ${s.name}'s card labels the type as STORED`, /stored/i.test(card), card.slice(0, 200))
    }
    if (s.expect.provenance === "unknown") {
      negative(`R3: ${s.name}'s card renders the DECLARED unknown marker`, card.includes(UNRESOLVED_TYPE), card.slice(0, 240))
    }

    // R4 — differential: no invention. A rendered text must be the stored value
    // or a verbatim engine answer; anything else is fabricated.
    const obs = observed[s.id] as { engine: { name: string } | null }
    if (tl.provenance === "inferred") {
      const allowed = obs.engine === null ? [] : [obs.engine.name]
      negative(`R4: ${s.name}'s rendered type is an engine answer, not an invention`, allowed.includes(tl.text), `rendered "${tl.text}" engine=${JSON.stringify(obs.engine)}`)
    }
    if (tl.provenance === "stored") {
      negative(`R4: ${s.name}'s rendered type is the stored value verbatim`, tl.text === s.returnType, `rendered "${tl.text}" stored "${String(s.returnType)}"`)
    }
    // §15.1 — one surface, one answer. The signature's own arrow must agree with
    // the type line whenever both speak.
    const sig: string = res.result?.data?.symbol?.signature ?? ""
    if (s.returnType !== null) {
      negative(`R4: ${s.name}'s signature arrow agrees with its type line`, sig.includes(`→ ${tl.text}`), `signature "${sig}" typeLine "${tl.text}"`)
    }
  }

  // The dishonesty itself, asserted as a NEGATIVE over the rendered card: a
  // Scala method whose source declares String must NOT render void anywhere.
  const scalaSym = T6_SYMBOLS.find((x) => x.file.endsWith(".scala"))!
  const scalaAbs = path.join(ws, scalaSym.file)
  const scalaRes = await wire.request("textDocument/hover", {
    textDocument: { uri: `file://${scalaAbs}` },
    position: { line: scalaSym.line - 1, character: 0 },
  })
  const scalaCard: string = scalaRes.result?.contents?.value ?? ""
  const scalaTl = scalaRes.result?.data?.symbol?.typeLine
  negative("R3: the scala method's card does NOT render `→ void`", !/→\s*void/.test(scalaCard), scalaCard.slice(0, 240))
  negative("R3: the scala method's card does NOT claim its engine confidence", !/confidence\s*1(\.0)?\b/.test(scalaCard), scalaCard.slice(0, 240))
  check("R3: the scala method's card explains why the engine's answer was withheld", typeof scalaTl?.withheld === "string" && scalaTl.withheld !== null, JSON.stringify(scalaTl))
} finally {
  await wire.dispose()
}

// --- R5: freshness --------------------------------------------------------------
console.log("\nR5: freshness — a stale file marks the INFERRED line stale too")
{
  const s = T6_SYMBOLS.find((x) => x.id === "t6-literal")!
  const abs = path.join(ws, s.file)
  writeFileSync(abs, T6_SOURCES[s.file]! + "\n// edited after indexing\n")
  const lineText = readFileSync(abs, "utf8").split("\n")[s.line - 1]!
  const res = await wire2Hover(ws, dataDir, abs, s.line - 1, Math.max(0, lineText.indexOf(s.name)))
  check("R5: the edited file is reported stale", res?.data?.symbol?.stale === true, JSON.stringify(res?.data?.symbol?.stale))
  const card: string = res?.contents?.value ?? ""
  negative("R5: the stale card carries a staleness marker", /stale/i.test(card), card.slice(0, 200))
  const tl = res?.data?.symbol?.typeLine
  negative("R5: the INFERRED type line itself is marked stale, not only the card", tl !== undefined && tl !== null && tl.stale === true, JSON.stringify(tl))
  negative("R5: an inferred type is never presented fresh on a stale file", !(tl?.provenance === "inferred" && tl?.stale !== true), JSON.stringify(tl))
  writeFileSync(abs, T6_SOURCES[s.file]!) // restore
}

/** A one-shot server for a leg that needs a fresh process. */
async function wire2Hover(root: string, dd: string, file: string, line: number, character: number): Promise<any> {
  const w = new StdioLsp(root, { ...process.env, BB_DATA_DIR: dd } as Record<string, string | undefined>)
  try {
    await w.initialize(root)
    const r = await w.request("textDocument/hover", { textDocument: { uri: `file://${file}` }, position: { line, character } })
    return r.result
  } finally {
    await w.dispose()
  }
}

// --- R6: latency ----------------------------------------------------------------
console.log("\nR6: latency — real nearest-rank p95, 200 samples per shape, load recorded")
{
  const shapes = [
    { id: "ts-literal", file: "src/inferred.ts", symbol: T6_SYMBOLS.find((s) => s.id === "t6-literal")! },
    { id: "ts-void", file: "src/inferred.ts", symbol: T6_SYMBOLS.find((s) => s.id === "t6-void")! },
    { id: "scala", file: "src/scala/Scaler.scala", symbol: T6_SYMBOLS.find((s) => s.id === "t6-scala")! },
    { id: "kotlin", file: "src/kotlin/Kt.kt", symbol: T6_SYMBOLS.find((s) => s.id === "t6-kotlin")! },
    { id: "over-ceiling", file: "src/big.ts", symbol: T6_SYMBOLS.find((s) => s.id === "t6-over-ceiling")! },
  ]
  const load0 = loadavg()
  const perShape: Record<string, { p95: number; p50: number; n: number }> = {}
  for (const sh of shapes) {
    const abs = path.join(ws, sh.file)
    const samples: number[] = []
    // WARM definition (contract §3): server running, index open, page cache
    // warm — 10 prior requests served before the first measured sample.
    for (let i = 0; i < 10; i++) await wire2Hover(ws, dataDir, abs, sh.symbol.line - 1, 0)
    const w = new StdioLsp(ws, { ...process.env, BB_DATA_DIR: dataDir } as Record<string, string | undefined>)
    try {
      await w.initialize(ws)
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now()
        await w.request("textDocument/hover", { textDocument: { uri: `file://${abs}` }, position: { line: sh.symbol.line - 1, character: 2 } })
        samples.push(performance.now() - t0)
      }
    } finally {
      await w.dispose()
    }
    const p95 = nearestRankP95(samples)
    perShape[sh.id] = { p95, p50: nearestRank(samples, 0.5), n: samples.length }
    check(`R6: ${sh.id} warm p95 under the 50ms hover budget`, p95 < 50, `p95=${p95.toFixed(2)}ms p50=${nearestRank(samples, 0.5).toFixed(2)}ms n=${samples.length}`)
  }
  var LATENCY = { perShape, loadAtStart: load0, loadAtEnd: loadavg() }
}

// --- R7: mutants ---------------------------------------------------------------
console.log("\nR7: mutants — each planted defect must FAIL the suite")
let mutantSeq = 0
const mutantDir = mkdtempSync(path.join(tmpdir(), "m55-t6-mut-"))
function dropScratch(): void {
  try { rmSync(mutantDir, { recursive: true, force: true }) } catch {}
}
process.on("exit", dropScratch)
process.on("SIGINT", () => { dropScratch(); process.exit(130) })
process.on("SIGTERM", () => { dropScratch(); process.exit(143) })

/** Load a mutated COPY of the facade from the OS temp dir (never the evidence
 *  tree — see docs/MUTANT-SCRATCH-LEAK.md) and probe it. A copy that fails to
 *  LOAD is reported as NOT-CAUGHT: a mutant whose module will not load no longer
 *  tests what the gate names. */
async function withFacade(name: string, from: string, to: string, probe: (m: any) => boolean | Promise<boolean>): Promise<void> {
  const source = readFileSync(FACADE, "utf8")
  if (!source.includes(from)) {
    check(`M: ${name} (ANCHOR DRIFT — not found in source)`, false, from.slice(0, 100))
    anchorDrift++
    return
  }
  const target = path.join(mutantDir, `facade.mutant.${Date.now()}.${mutantSeq++}.ts`)
  // The copy leaves src/lsp/, so its RELATIVE imports cannot resolve. Rewrite
  // them to absolute file paths first. Without this every mutant dies at
  // `import()` and the suite would report six catches that are really six load
  // failures — the exact vacuous catch docs/MUTANT-SCRATCH-LEAK.md §8.7 names.
  const rewritten = source
    .replace(/from "\.\.\/ast\/engine"/g, `from ${JSON.stringify(path.join(ROOT, "src/ast/engine.ts"))}`)
    .replace(/from "\.\.\/ast\/type-inference"/g, `from ${JSON.stringify(path.join(ROOT, "src/ast/type-inference.ts"))}`)
    .replace(/from "\.\/signature"/g, `from ${JSON.stringify(path.join(ROOT, "src/lsp/signature.ts"))}`)
  writeFileSync(target, rewritten.replace(from, to))
  let m: any
  try {
    m = await import(pathToFileURL(target).href)
  } catch (e) {
    // NOT a catch: this is a report that the mutant could not be evaluated.
    mutant(name, false, `mutant module failed to load — ${String(e).slice(0, 120)}`)
    return
  }
  try {
    mutant(name, await probe(m))
  } catch (e) {
    mutant(name, false, `probe threw — ${String(e).slice(0, 120)}`)
  }
}

const probeCase = async (m: any, id: string) => {
  const s = T6_SYMBOLS.find((x) => x.id === id)!
  const abs = path.join(ws, s.file)
  const content = readFileSync(abs, "utf8")
  const r = await m.resolveTypeLine(
    abs, content,
    { name: s.name, symbol_type: s.type, return_type: s.returnType, line_start: s.line, line_end: s.line + s.span - 1, language: langFor(s.file) },
    s.returnType,
  )
  return r
}

// M1 — FABRICATED TYPE: the facade invents a type the engine never returned.
await withFacade(
  "M1: a type the engine never returned is fabricated",
  `  if (wanted === null) {`,
  `  if (wanted === null) { return { line: { provenance: "inferred", text: "String", confidence: 1, reason: "", withheld: null, withheldText: null, storedProvenanceUnknown: false, witness: null }, engine: null, engineCoverage: { language: "x", covered: true, matchedNodeTypes: [] } }
  }
  if (false) {`,
  async (m) => {
    const r = await probeCase(m, "t6-unresolvable")
    return r.line.text === "String" && r.engine === null
  },
)

// M2 — SUPPRESSED UNKNOWN MARKER: the declared marker is dropped for a
//        no-coverage language and an empty string renders instead.
await withFacade(
  "M2: the declared unknown marker is suppressed",
  `    text: UNRESOLVED_TYPE,`,
  `    text: "",`,
  async (m) => {
    const r = await probeCase(m, "t6-svelte")
    return r.line.text === "" && r.line.provenance === "unknown"
  },
)

// M3 — CONFIDENCE OVERRIDE: the engine's number is replaced by a constant.
// NOTE the constant is 0.42, NOT 1.0. The fixture's engine answers are already
// confidence 1.0, so "override with 1.0" is unobservable here and would be a
// mutant that cannot fail — the fixture-that-cannot-fail defect. 0.42 differs
// from every authored value, so the override is visible.
await withFacade(
  "M3: the engine's confidence is overridden with a constant",
  `        confidence: answer.confidence,
        reason: \`witnessed in the tree: ${"${witness.returnExpressionsSeen}"} return expression(s) of kind ${"${kinds[0]}"} at ${"${witness.nodeType}"}\`,`,
  `        confidence: 0.42,
        reason: \`witnessed in the tree\`,`,
  async (m) => {
    const r = await probeCase(m, "t6-literal")
    return r.line.confidence === 0.42
  },
)

// M4 — PROMOTED VOID: the engine's `void` is trusted without the tree showing a
//        valueless return. This is the exact dishonesty the assessment measured
//        on scala/groovy/zig (`void` at confidence 1.0 for a function returning
//        String).
//        The anchor is deliberately the WITNESS, not a guard. Two earlier
//        attempts to anchor this at a condition guard were semantically
//        EQUIVALENT and could not fail: neutralising the withhold guard alone
//        still falls through to the "outside the proven subset" branch, and
//        neutralising the promote condition alone leaves the withhold guard in
//        place. Flipping the single witness predicate — "no return node seen" is
//        read as "a valueless return was witnessed" — is the one edit that
//        actually renders `void` on a function whose source says String.
await withFacade(
  "M4: absence of a return node is read as a witnessed valueless return",
  `    const hasValuelessReturn = own.length > 0 && own.every((r) => r.kind === "valueless")`,
  `    const hasValuelessReturn = true`,
  async (m) => {
    const r = await probeCase(m, "t6-scala")
    return r.line.provenance === "inferred" && r.line.text === "void"
  },
)

// M5 — WITNESS DELETED: the corroboration requirement is removed, so a stored
//        type is overridden by an unproven inference (§15.1 violation).
await withFacade(
  "M5: a stored type is overridden by an unproven inference",
  `  if (stored !== null) {`,
  `  if (stored !== null && false) {`,
  async (m) => {
    const r = await probeCase(m, "t6-stored")
    return r.line.provenance !== "stored"
  },
)

// M6 — THE WITNESS IS NOT A WITNESS: the tree-agreement check is dropped, so the
//        engine's answer is rendered whatever the tree says. Probed on the
//        PATTERN-TABLE case, where the engine's answer is right but unwitnessed
//        — the subtle dishonesty. Probing it on a case the engine already calls
//        `unknown` would be a fixture that cannot fail, because the narrower
//        "outside the proven subset" branch would catch it anyway.
await withFacade(
  "M6: the tree-agreement requirement is dropped",
  `    if (kinds.length !== 1 || kinds[0] !== wanted) {`,
  `    if (false) {`,
  async (m) => {
    const r = await probeCase(m, "t6-pattern-table")
    return r.line.provenance === "inferred" && r.line.text === "string"
  },
)

// M7 — CONFIDENCE LEAKED ONTO A NON-INFERRED TYPE: a confidence is attached to a
//        stored/unknown line, which would let a reader read a stored value as a
//        measurement.
await withFacade(
  "M7: a confidence is attached to a non-inferred type line",
  `        text: stored,
        confidence: null,`,
  `        text: stored,
        confidence: 1,`,
  async (m) => {
    const r = await probeCase(m, "t6-stored")
    return r.line.provenance === "stored" && r.line.confidence !== null
  },
)

// M8 — THE CEILING IS REMOVED: the size guard is dropped, so a file over the
//        declared 48 KiB ceiling is parsed anyway. MEASURED cost of that: p95
//        65.4 ms in the 48-72 KiB band and 1615 ms on a real 1311 KiB indexed
//        file — 32x the 50 ms hover budget. The mutant is caught by the
//        DECLARED ABSENCE it produces, not by a load failure and not by a
//        timeout, which is why this leg exists as a fixture case.
await withFacade(
  "M8: the size ceiling is removed, so an over-budget file is parsed anyway",
  `  if (Buffer.byteLength(content, "utf8") > MAX_WITNESS_BYTES) {`,
  `  if (false && Buffer.byteLength(content, "utf8") > MAX_WITNESS_BYTES) {`,
  async (m) => {
    const r = await probeCase(m, "t6-over-ceiling")
    // The honest facade withholds with `file-too-large-for-witness`. The
    // mutant parses, witnesses a string literal, and renders `inferred`.
    return r.line.provenance === "inferred" && r.line.withheld === null
  },
)

dropScratch()

// --- evidence -------------------------------------------------------------------
const failed = checks - passed
const relevant = status.split("\n").map((l) => l.slice(3).trim()).filter((p) => p.startsWith("src/lsp/type_inference") || p.startsWith("script/m55/"))
const result = {
  issue: "M55.T6",
  code: "T6",
  milestone: "M55",
  status: failed === 0 && anchorDrift === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  realFailed: failed,
  negativeCases: negatives,
  mutants: { total: mutantsTotal, caught: mutantsCaught },
  anchorDrift,
  currentCommit,
  workingTreeRelevantChanges: relevant,
  verifierCommand: "npx tsx script/m55/verify-type-inference.ts",
  evidenceFile: "T6.json",
  generatedAt: new Date().toISOString(),
  fixture: { workspace: ws, projectId: seed.projectId, symbols: T6_SYMBOLS.length },
  observed,
  wireTypeLines,
  latency: typeof LATENCY === "undefined" ? null : LATENCY,
  machine: { platform: process.platform, release: execFileSync("uname", ["-r"], { encoding: "utf8" }).trim(), cpus: cpus().length, ramGB: Number((totalmem() / 1e9).toFixed(1)), loadavg: loadavg().map((n) => Number(n.toFixed(2))) },
  failures,
  limitations: [
    "The proven inferred subset is deliberately narrow: a bare primitive literal type (string/number/boolean) whose every return expression in the tree agrees, or `void` witnessed by a valueless return or an explicit void/Unit annotation. Anything else renders the declared unknown marker. Measured coverage on the fixture: 2 of 8 cases (both typescript).",
    "MEASURED engine coverage is 0 for vue and svelte (no declared node type matches), and 'covered but no entry' for kotlin, rust, c and cpp (getFunctionBody finds no body field). Those absences are DECLARED with distinct reasons, never rendered as an empty type.",
    "MEASURED engine dishonesty: scala, groovy and zig get `void` at confidence 1.0 for expression-bodied functions that return String. The facade withholds all three. This is a defect in src/ast/type-inference.ts (read-only to this lane); the API needed to fix it is recorded in docs/M55-T6-TYPE-INFERENCE.md.",
    "The index's own return_type column carries NO marker of explicit-vs-inferred (measured across 735 brain.db indexes / 985,094 symbols: 38,924 carry a type, and 62% of the typescript ones do not appear verbatim at the declaration line). The `stored` class therefore declares `storedProvenanceUnknown: true` on the wire rather than resolving it by guessing.",
    "Latency is measured over a four-file fixture workspace. The p95 is a real nearest-rank p95 over 200 samples per shape with the load average recorded, but the fixture is small; no large-file hover leg is measured here.",
    "No editor leg (I3) and no fork leg (I4) is measured. This is an I2-surface claim at best: the component and the wire are exercised, not a pinned editor.",
  ],
}

try {
  writeSealed(EVIDENCE, result)
  console.log(`\nEV T6 evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV T6 evidence write failed: ${String(e)}`)
}

console.log(`\nT6 RESULT: ${failed === 0 && anchorDrift === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed, ${negatives} negative, ${mutantsCaught}/${mutantsTotal} mutants caught`)
if (failed > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
try { rmSync(ws, { recursive: true, force: true }); rmSync(dataDir, { recursive: true, force: true }) } catch {}
process.exit(failed === 0 && anchorDrift === 0 ? 0 : 1)