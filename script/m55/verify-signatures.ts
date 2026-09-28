// script/m55/verify-signatures.ts — M55.T4 verifier + mutation suite
// (issue #772, §14 Truth Rule 4: human text is human).
//
// The defect: the hover interpolated the stored `parameters` column, so a
// developer read the analyzer's JSON (`method greetAll([{"name":"names",…}])`)
// instead of a signature. The fix is one renderer (src/lsp/signature.ts) used
// by every surface that renders a signature.
//
// What this gate proves, in order:
//
//   R1 fixture:   the seeded index carries one symbol per stored parameter
//                 shape (empty list, multi-param + optional flag, default
//                 value with no type, generics, a rest parameter, no type at
//                 all) and the sources exist on disk.
//   R2 renderer:  every case renders exactly the authored expectation; the
//                 language notation table is exercised directly (java
//                 variadics, python rest/default, TS optional); an unresolved
//                 type renders the declared marker and NEVER an empty string;
//                 no rendered signature matches the raw-JSON shape.
//   R3 wire:      the REAL dist server renders the same text in the hover
//                 card AND the call-hierarchy item detail, the wire's
//                 structured parameters survive untouched (typed data for
//                 clients), and no rendered wire surface carries raw JSON.
//   R4 one owner: no module in the LSP lane interpolates the stored
//                 `parameters` column into text — the drift that produced the
//                 defect is a source-level assertion, not a promise.
//   R5 mutants:   JSON interpolation, an empty-string type, a dropped
//                 parameter and an ignored optional flag each FAIL.
//
// Run: npx tsx script/m55/verify-signatures.ts
// Evidence: validation/m55/results/T4.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { T4_EXPECT, T4_SYMBOLS, seedT4Db, writeT4Workspace } from "./t4-fixture.ts"
import { StdioLsp, ensureServerBuilt } from "./lsp-wire.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const SIGNATURE = path.join(ROOT, "src/lsp/signature.ts")
const EVIDENCE = path.join(ROOT, "validation/m55/results/T4.json")

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsTotal = 0
let mutantsCaught = 0

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`${label} [mutant]`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })

// --- R1: fixture ------------------------------------------------------------------
console.log("R1: the fixture's index carries every stored parameter shape")
const ws = mkdtempSync(path.join(tmpdir(), "m55-t4-ws-"))
const dataDir = mkdtempSync(path.join(tmpdir(), "m55-t4-data-"))
writeT4Workspace(ws)
const seed = await seedT4Db(ws, dataDir)
const raw = seed.raw as any
const TS_FILE = path.join(ws, "src/sig.ts")
const PY_FILE = path.join(ws, "src/sig.py")

const storedShapes = new Set<string>()
for (const s of T4_SYMBOLS) {
  const row = raw.prepare("SELECT parameters FROM brain_symbol WHERE id = ?").get(s.id) as { parameters: string | null }
  if (row.parameters === null) storedShapes.add("null")
  else if (row.parameters === "[]") storedShapes.add("empty")
  else storedShapes.add(Object.keys(JSON.parse(row.parameters)[0]).sort().join("+"))
}
check("R1: the fixture stores a null, an empty list and parsed entry shapes", storedShapes.has("null") && storedShapes.has("empty") && storedShapes.size >= 5, JSON.stringify([...storedShapes]))
check("R1: the unresolvable case genuinely has no stored type", (raw.prepare("SELECT parameters FROM brain_symbol WHERE id = 's-mystery'").get() as { parameters: string }).parameters === '[{"name":"raw"}]', "")
check("R1: the sources exist on disk", readFileSync(TS_FILE, "utf8").includes("export class Box<T>") && readFileSync(PY_FILE, "utf8").includes("def total"), "")

// --- R2: the renderer -------------------------------------------------------------
console.log("\nR2: the ONE renderer (owned by src/lsp/signature.ts)")
const sig = (await import(SIGNATURE)) as {
  renderSignature: (s: Record<string, unknown>, language: string | null) => string
  renderParameterList: (raw: string | null | undefined, language: string | null) => string
  renderParameter: (e: Record<string, unknown>, language: string | null) => string
  parseParameters: (raw: string | null | undefined) => { shape: string; entries: Array<Record<string, unknown>> }
  RAW_JSON_SHAPE: RegExp
  UNRESOLVED_TYPE: string
}

let exact = 0
for (const s of T4_SYMBOLS) {
  const language = s.file.endsWith(".py") ? "python" : "typescript"
  const rendered = sig.renderSignature(
    { name: s.name, symbol_type: s.type, parameters: s.parameters, return_type: s.returnType, visibility: "public" },
    language,
  )
  const expected = T4_EXPECT[s.id]
  check(`R2: ${s.name} renders its authored signature`, rendered === expected, `got "${rendered}" want "${expected ?? "(no expectation)"}"`)
  if (rendered === expected) exact++
}
check("R2: every fixture case matched its authored expectation", exact === T4_SYMBOLS.length, `${exact}/${T4_SYMBOLS.length}`)

// The notation table, exercised directly (the fixture's stored data cannot
// carry every language's spelling; the LANGUAGE is the input that decides it).
check("R2: java variadics render in java notation", sig.renderParameter({ name: "args", type: "String[]", isRest: true }, "java") === "String[]... args", sig.renderParameter({ name: "args", type: "String[]", isRest: true }, "java"))
check("R2: kotlin variadics render in kotlin notation", sig.renderParameter({ name: "args", type: "String", isRest: true }, "kotlin") === "vararg args: String", sig.renderParameter({ name: "args", type: "String", isRest: true }, "kotlin"))
check("R2: scala varargs render in scala notation", sig.renderParameter({ name: "args", type: "String", isRest: true }, "scala") === "args: String*", sig.renderParameter({ name: "args", type: "String", isRest: true }, "scala"))
check("R2: python rest renders in python notation from the stored name marker", sig.renderParameter({ name: "*rest" }, "python") === "*rest: unknown", sig.renderParameter({ name: "*rest" }, "python"))
check("R2: a stored default renders as the shared notation", sig.renderParameter({ name: "count", defaultValue: "3", isOptional: true }, "python") === "count: unknown = 3", sig.renderParameter({ name: "count", defaultValue: "3", isOptional: true }, "python"))
check("R2: an implicit receiver renders unannotated", sig.renderParameter({ name: "self", isImplicit: true }, "python") === "self", sig.renderParameter({ name: "self", isImplicit: true }, "python"))
check("R2: java optionality (no java notation) stays plain — never invented syntax", sig.renderParameter({ name: "x", type: "int", isOptional: true }, "java") === "int x", sig.renderParameter({ name: "x", type: "int", isOptional: true }, "java"))

const mysteryRendered = sig.renderSignature({ name: "mystery", symbol_type: "method", parameters: '[{"name":"raw"}]', return_type: "void", visibility: null }, "typescript")
check("R2: an unresolved type renders the declared marker", mysteryRendered.includes(`raw: ${sig.UNRESOLVED_TYPE}`), mysteryRendered)
check("R2: no parameter renders an empty type", !/:\s*[,)]/.test(mysteryRendered) && !mysteryRendered.includes(": )"), mysteryRendered)
check("R2: an absent parameter list is the declared absence, not an empty string", sig.renderParameterList(null, "typescript") === "…", sig.renderParameterList(null, "typescript"))
check("R2: a non-callable never renders parentheses", sig.renderSignature({ name: "Box", symbol_type: "class", parameters: null, return_type: null, visibility: "public" }, "typescript") === "public class Box", "")
check("R2: a stored JSON object (not a list) renders the declared absence, never the JSON", sig.renderParameterList('{"name":"x"}', "typescript") === "…", sig.renderParameterList('{"name":"x"}', "typescript"))
check("R2: an opaque non-JSON value passes through unchanged", sig.renderParameterList("name: string", "typescript") === "name: string", "")
check("R2: the parser declares the shape it found", sig.parseParameters('[{"name":"a"}]').shape === "list" && sig.parseParameters("").shape === "absent" && sig.parseParameters("x").shape === "opaque", "")

// --- R5 mutants (defined before the wire legs so both run over the same rule) ------
async function withSignature(name: string, from: string, to: string, probe: (m: any) => boolean | Promise<boolean>): Promise<void> {
  const source = readFileSync(SIGNATURE, "utf8")
  if (!source.includes(from)) {
    check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 90))
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), "m55-t4-mut-"))
  const target = path.join(dir, "signature.mutant.ts")
  writeFileSync(target, source.replace(from, to))
  try {
    const m = await import(pathToFileURL(target).href)
    mutant(name, await probe(m))
  } catch (e) {
    check(`M: ${name} (mutant failed to load)`, false, String(e).slice(0, 120))
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// --- R3: the wire -----------------------------------------------------------------
console.log("\nR3: the wire — the real server renders the same text")
ensureServerBuilt()
const wire = new StdioLsp(ws, { ...process.env, BB_DATA_DIR: dataDir } as Record<string, string | undefined>)
const wireSignatures: Record<string, string> = {}
try {
  const initRes = await wire.initialize(ws)
  check("R3: the server initializes over the fixture workspace", initRes.error === undefined, JSON.stringify(initRes).slice(0, 200))
  for (const s of T4_SYMBOLS) {
    const abs = path.join(ws, s.file)
    const lineText = readFileSync(abs, "utf8").split("\n")[s.line - 1]!
    const char = Math.max(0, lineText.indexOf(s.name))
    const res = await wire.request("textDocument/hover", { textDocument: { uri: `file://${abs}` }, position: { line: s.line - 1, character: char } })
    const symbol = res.result?.data?.symbol
    if (symbol === undefined || symbol === null) {
      check(`R3: hover resolves ${s.name}`, false, JSON.stringify(res).slice(0, 200))
      continue
    }
    wireSignatures[s.id] = symbol.signature
    check(`R3: the wire renders ${s.name}'s signature`, symbol.signature === T4_EXPECT[s.id], `got "${symbol.signature}"`)
    const md: string = res.result?.contents?.value ?? ""
    check(`R3: ${s.name}'s rendered card carries no raw JSON`, !sig.RAW_JSON_SHAPE.test(md), md.slice(0, 160))
    // Acceptance 3: the structured data survives as typed data on the wire.
    if (s.parameters === null || s.parameters === "[]") {
      const structured = symbol.parameters
      check(`R3: ${s.name} carries the declared structured absence (not text)`, structured === null || (Array.isArray(structured) && structured.length === 0), JSON.stringify(structured))
    } else {
      const expectedEntries = JSON.parse(s.parameters) as Array<Record<string, unknown>>
      const structured = symbol.parameters
      check(
        `R3: ${s.name} carries its structured parameters, typed, unrendered`,
        Array.isArray(structured) && structured.length === expectedEntries.length && structured.every((e: Record<string, unknown>) => typeof e.name === "string" && "type" in e && typeof e.isOptional === "boolean"),
        JSON.stringify(structured),
      )
    }
  }

  // Call hierarchy: the editor label carries the human signature too.
  const putLine = T4_SYMBOLS.find((s) => s.id === "s-put")!
  const putText = readFileSync(TS_FILE, "utf8").split("\n")[putLine.line - 1]!
  const prep = await wire.request("textDocument/prepareCallHierarchy", {
    textDocument: { uri: `file://${TS_FILE}` },
    position: { line: putLine.line - 1, character: Math.max(0, putText.indexOf("put")) },
  })
  const item = prep.result?.item ?? (Array.isArray(prep.result) ? prep.result[0] : prep.result)
  check(
    "R3: the call-hierarchy item detail carries the rendered signature",
    typeof item?.detail === "string" && item.detail.includes("method put(key: string, value: T, loud?: boolean) → void"),
    String(item?.detail),
  )
  check("R3: the call-hierarchy detail carries no raw JSON", typeof item?.detail === "string" && !sig.RAW_JSON_SHAPE.test(item.detail), String(item?.detail))
} finally {
  await wire.dispose()
}

// --- R4: one owner (source-level) --------------------------------------------------
console.log("\nR4: one owner — nothing else interpolates the stored parameters")
const laneDirs = [path.join(ROOT, "src/lsp")]
const offenders: string[] = []
for (const dir of laneDirs) {
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".ts")) continue
    const file = path.join(dir, entry)
    if (file === SIGNATURE) continue
    const text = readFileSync(file, "utf8")
    // The drift shape that produced the defect is an interpolation that puts
    // the stored column into TEXT (`${row.parameters}`). Handing the same
    // column to the owner's own functions is the point, so a `${…}` that calls
    // a declared renderer/parser (or serializes into a typed field) is fine.
    for (const m of text.matchAll(/\$\{([^}]*\b\w*[Pp]arameters\b[^}]*)\}/g)) {
      const expr = m[1]!
      const viaOwner = /(renderSignature|renderParameterList|renderParameter|parseParameters)\s*\(/.test(expr) || /JSON\.stringify\s*\(/.test(expr)
      if (!viaOwner) offenders.push(`${entry}: ${m[0].slice(0, 70)}`)
    }
  }
}
check("R4: only signature.ts renders the stored parameters column", offenders.length === 0, offenders.join(" | "))
const signatureSource = readFileSync(SIGNATURE, "utf8")
check("R4: the renderer declares its unresolved marker and raw-JSON guard", signatureSource.includes("UNRESOLVED_TYPE") && signatureSource.includes("RAW_JSON_SHAPE"), "")

// --- R5: mutants -------------------------------------------------------------------
console.log("\nR5: mutants (each planted defect must fail the suite)")
await withSignature(
  "M1: JSON interpolation reintroduced",
  "      return parsed.entries.map((e) => renderParameter(e, language)).join(\", \")",
  "      return JSON.stringify(parsed.entries)",
  (m) => checkRawJsonCaught(m),
)
async function checkRawJsonCaught(m: any): Promise<boolean> {
  const rendered = m.renderSignature({ name: "put", symbol_type: "method", parameters: T4_SYMBOLS.find((s) => s.id === "s-put")!.parameters, return_type: "void", visibility: "public" }, "typescript")
  return m.RAW_JSON_SHAPE.test(rendered)
}
await withSignature(
  "M2: an unresolved type renders an empty string",
  "  return t === \"\" ? UNRESOLVED_TYPE : t",
  "  return t",
  (m) => {
    const rendered = m.renderSignature({ name: "mystery", symbol_type: "method", parameters: '[{"name":"raw"}]', return_type: "void", visibility: null }, "typescript")
    return rendered.includes("raw:") && /:\s*[,)]/.test(rendered)
  },
)
await withSignature(
  "M3: a parameter is silently dropped",
  "      return parsed.entries.map((e) => renderParameter(e, language)).join(\", \")",
  "      return parsed.entries.slice(0, 1).map((e) => renderParameter(e, language)).join(\", \")",
  (m) => {
    const put = T4_SYMBOLS.find((s) => s.id === "s-put")!
    const rendered = m.renderSignature({ name: "put", symbol_type: "method", parameters: put.parameters, return_type: "void", visibility: "public" }, "typescript")
    return rendered !== T4_EXPECT["s-put"] && !rendered.includes("loud")
  },
)
await withSignature(
  "M4: the optional flag is ignored",
  "  if (entry.isOptional === true && trailingDefault === \"\") {",
  "  if (false) {",
  (m) => {
    const put = T4_SYMBOLS.find((s) => s.id === "s-put")!
    const rendered = m.renderSignature({ name: "put", symbol_type: "method", parameters: put.parameters, return_type: "void", visibility: "public" }, "typescript")
    return !rendered.includes("loud?: boolean")
  },
)

// --- evidence ----------------------------------------------------------------------
const failed = checks - passed
const relevant = status
  .split("\n")
  .map((l) => l.slice(3).trim())
  .filter((p) => p.startsWith("src/lsp/signature") || p.startsWith("script/m55/"))
const result = {
  issue: "M55.T4",
  code: "T4",
  milestone: "M55",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  realFailed: failed,
  negativeCases: mutantsTotal,
  mutants: { total: mutantsTotal, caught: mutantsCaught },
  currentCommit,
  workingTreeRelevantChanges: relevant,
  verifierCommand: "npx tsx script/m55/verify-signatures.ts",
  evidenceFile: "T4.json",
  generatedAt: new Date().toISOString(),
  fixture: { workspace: ws, projectId: seed.projectId, symbols: T4_SYMBOLS.length, storedShapes: [...storedShapes] },
  observed: { wireSignatures, expectations: T4_EXPECT },
  failures,
  limitations: [
    "No analyzer on this machine writes a rest/variadic FLAG (isRest/rest/variadic) or isImplicit for anything but a receiver — the fixture declares the flag form AND the stored-name form (`...rest`, `*rest`) and the gate exercises both. The flag is the declared contract for analyzers; the name marker is the fallback the renderer honors today.",
    "Java/Kotlin/Scala have no `?` optionality notation, so an isOptional flag without a stored default renders the parameter plainly rather than in invented syntax; the shape that carries optionality in those languages (a default value) renders as `= default`. Recorded as a declared gap, not a silent drop.",
    "The expanded call-hierarchy items (callers/callees) come from the traversal engine's nodes, which carry no parameters column: their detail stays the declared identity line (type · relationship · call sites), not a signature. The prepared item — the symbol the developer invoked the view on — carries the rendered signature.",
    "The hub's usage rows render no signature today (their payload has no parameters field); when a row gains one it must render through this owner (R4 asserts the source-level rule for the whole lane).",
  ],
}

try {
  writeSealed(EVIDENCE, result)
  console.log(`\nEV T4 evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV T4 evidence write failed: ${String(e)}`)
}

console.log(`\nT4 RESULT: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught`)
if (failed > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
try {
  rmSync(ws, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
} catch {}
process.exit(failed === 0 ? 0 : 1)
