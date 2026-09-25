// script/m24/verify-positions.ts — M24.P1 verifier + mutation suite.
//
// Proves the position mapping component (src/lsp/positions.ts) is correct
// against fixtures, and proves the suite CAN FAIL by planting defects
// (off-by-one line, off-by-one column, missing UTF-16 conversion, wrong
// range-end semantics) and asserting the suite catches each one.
//
// The mutant oracle never depends on the real module's error class: each
// mutant is a separate module instance and the suite only checks that the
// functional expectations fail for it.
//
// Run: npx tsx script/m24/verify-positions.ts
// Evidence: validation/m24/results/P1.json (machine-emitted)

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/lsp/positions.ts")
const TMP = path.join(ROOT, "validation/m24/.positions-mutant.ts")

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    failures.push(label + (detail ? ` — ${detail}` : ""))
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

// ---------------------------------------------------------------------------
// Fixtures. Byte/UTF-16 math is written out explicitly per case.
// ---------------------------------------------------------------------------

// ASCII, 5 lines. Line 4 is "\tprintln(\"hi\")" (14 chars).
const ASCII = ["package main", "", "func main() {", "\tprintln(\"hi\")", "}"].join("\n")

// CRLF, 3 lines. Line 2 = "café €100":
//   bytes:  c(0) a(1) f(2) é(3-4) ' '(5) €(6-8) 1(9) 0(10) 0(11)  -> 12 bytes
//   utf16:  c(0) a(1) f(2) é(3)  ' '(4) €(5)  1(6) 0(7) 0(8)     -> 9 units
const CRLF = "line1\r\ncafé €100\r\nlast"

// Astral, 3 lines. Line 2 = `const emoji = "🎉x"`:
//   bytes:  `const emoji = "` = 15 bytes (0-14), 🎉 = 4 bytes (15-18), x = 19
//   utf16:  15 units (0-14), 🎉 = 2 units (15-16), x = 17
const ASTRAL = "const a = 1\nconst emoji = \"🎉x\"\nconst end = 3"

// Trailing newline: 2 content lines + phantom line.
const TRAILING = "a\nb\n"

type Expectation =
  | { kind: "eq"; label: string; call: (m: any) => unknown; want: unknown }
  | { kind: "throws"; label: string; call: (m: any) => unknown }

function runExpectations(m: any, exps: Expectation[]): { ok: boolean; failed: string[] } {
  const failedLabels: string[] = []
  for (const e of exps) {
    if (e.kind === "eq") {
      let got: unknown
      let threw = false
      try {
        got = e.call(m)
      } catch {
        threw = true
      }
      const ok = !threw && JSON.stringify(got) === JSON.stringify(e.want)
      if (!ok) failedLabels.push(`${e.label} (got ${threw ? "throw" : JSON.stringify(got)}, want ${JSON.stringify(e.want)})`)
    } else {
      let threw = false
      try {
        e.call(m)
      } catch {
        threw = true
      }
      if (!threw) failedLabels.push(`${e.label} (expected throw, got none)`)
    }
  }
  return { ok: failedLabels.length === 0, failed: failedLabels }
}

// The functional expectations, shared by the real component and every mutant.
function expectationsFor(text: string): Expectation[] {
  switch (text) {
    case ASCII:
      return [
        { kind: "eq", label: "index(1,1)->lsp(0,0)", call: (m) => m.indexToLsp({ line: 1, column: 1 }), want: { line: 0, character: 0 } },
        { kind: "eq", label: "index(4,2) tab->lsp(3,1)", call: (m) => m.indexToLsp({ line: 4, column: 2 }), want: { line: 3, character: 1 } },
        { kind: "eq", label: "lsp(3,1)->index(4,2)", call: (m) => m.lspToIndex({ line: 3, character: 1 }), want: { line: 4, column: 2 } },
        { kind: "eq", label: "lsp(0,0)->index(1,1)", call: (m) => m.lspToIndex({ line: 0, character: 0 }), want: { line: 1, column: 1 } },
        { kind: "eq", label: "range word main (1,9)-(1,13)->lsp(0,8)-(0,12)", call: (m) => m.indexRangeToLsp({ start: { line: 1, column: 9 }, end: { line: 1, column: 13 } }), want: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } } },
        { kind: "eq", label: "range reverse lsp(0,8)-(0,12)->index(1,9)-(1,13)", call: (m) => m.lspRangeToIndex({ start: { line: 0, character: 8 }, end: { line: 0, character: 12 } }), want: { start: { line: 1, column: 9 }, end: { line: 1, column: 13 } } },
        { kind: "throws", label: "index line 0 throws", call: (m) => m.indexToLsp({ line: 0, column: 1 }) },
        { kind: "throws", label: "index col 0 throws", call: (m) => m.indexToLsp({ line: 1, column: 0 }) },
        { kind: "throws", label: "lsp line 99 throws", call: (m) => m.lspToIndex({ line: 99, character: 0 }) },
        { kind: "throws", label: "lsp char -1 throws", call: (m) => m.lspToIndex({ line: 0, character: -1 }) },
      ]
    case CRLF:
      return [
        { kind: "eq", label: "lineCount 3", call: (m) => m.lineCount, want: 3 },
        { kind: "eq", label: "index(2,6) after café ->lsp(1,4)", call: (m) => m.indexToLsp({ line: 2, column: 6 }), want: { line: 1, character: 4 } },
        { kind: "eq", label: "index(2,10) after € ->lsp(1,6)", call: (m) => m.indexToLsp({ line: 2, column: 10 }), want: { line: 1, character: 6 } },
        { kind: "eq", label: "lsp(1,6)->index(2,10)", call: (m) => m.lspToIndex({ line: 1, character: 6 }), want: { line: 2, column: 10 } },
        { kind: "eq", label: "index(3,1)->lsp(2,0)", call: (m) => m.indexToLsp({ line: 3, column: 1 }), want: { line: 2, character: 0 } },
        { kind: "throws", label: "mid-code-point byte col 5 throws", call: (m) => m.indexToLsp({ line: 2, column: 5 }) },
        // Line-end boundary: real line 1 is "line1" (5 bytes). A mutant that
        // splits on \n only leaves "line1\r" (6 bytes) — these three probe
        // exactly that difference at the boundary.
        { kind: "eq", label: "index(1,6) end of line1 ->lsp(0,5)", call: (m) => m.indexToLsp({ line: 1, column: 6 }), want: { line: 0, character: 5 } },
        { kind: "throws", label: "index(1,7) past line1 throws (catches CR-as-content)", call: (m) => m.indexToLsp({ line: 1, column: 7 }) },
        { kind: "throws", label: "lsp(0,6) past line1 throws (catches CR-as-content)", call: (m) => m.lspToIndex({ line: 0, character: 6 }) },
      ]
    case ASTRAL:
      return [
        { kind: "eq", label: "index(2,20) x ->lsp(1,17)", call: (m) => m.indexToLsp({ line: 2, column: 20 }), want: { line: 1, character: 17 } },
        { kind: "eq", label: "lsp(1,17)->index(2,20)", call: (m) => m.lspToIndex({ line: 1, character: 17 }), want: { line: 2, column: 20 } },
        { kind: "eq", label: "index(2,16) emoji start ->lsp(1,15)", call: (m) => m.indexToLsp({ line: 2, column: 16 }), want: { line: 1, character: 15 } },
        { kind: "eq", label: "astral range end advances 2", call: (m) => m.indexRangeToLsp({ start: { line: 2, column: 16 }, end: { line: 2, column: 20 } }), want: { start: { line: 1, character: 15 }, end: { line: 1, character: 17 } } },
        { kind: "throws", label: "surrogate trailing half throws", call: (m) => m.lspToIndex({ line: 1, character: 16 }) },
      ]
    case TRAILING:
      return [
        { kind: "eq", label: "lineCount 3 (phantom)", call: (m) => m.lineCount, want: 3 },
        { kind: "eq", label: "index(3,1)->lsp(2,0)", call: (m) => m.indexToLsp({ line: 3, column: 1 }), want: { line: 2, character: 0 } },
      ]
    default:
      throw new Error(`unknown fixture ${text.slice(0, 20)}`)
  }
}

const FIXTURES = [ASCII, CRLF, ASTRAL, TRAILING]

// --- Roundtrip property: every valid index position maps to LSP and back ---
function roundtrip(m: any, text: string): string[] {
  const bad: string[] = []
  const lines = text.split(/\r\n|\r|\n/)
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    // Sample byte columns at every code point boundary plus the end.
    const buf = Buffer.from(line, "utf8")
    const byteLen = buf.length
    for (let b = 0; b <= byteLen; b++) {
      if (b > 0 && b < byteLen && (buf[b]! & 0xc0) === 0x80) continue // mid-code-point
      let idx: any
      try {
        idx = m.lspToIndex({ line: li, character: Buffer.from(line.slice(0, 0), "utf8").length + (function () {
          // convert byte offset b to utf16 offset using the component itself
          return m.indexToLsp({ line: li + 1, column: b + 1 }).character
        })() })
      } catch (e) {
        bad.push(`lspToIndex threw at line ${li + 1} byte col ${b + 1}: ${e.message}`)
        continue
      }
      if (idx.line !== li + 1 || idx.column !== b + 1) {
        bad.push(`roundtrip mismatch line ${li + 1} byte col ${b + 1} -> ${JSON.stringify(idx)}`)
      }
    }
  }
  return bad
}

// --- Load the real component ----------------------------------------------
const real = await import(COMPONENT + `?real=${Date.now()}`)
const realMapper = real.createPositionMapper

// --- Functional checks on the real component ------------------------------
for (const text of FIXTURES) {
  const m = realMapper(text)
  const r = runExpectations(m, expectationsFor(text))
  check(`functional fixture ${JSON.stringify(text.slice(0, 12))}...`, r.ok, r.failed.join("; "))
}

// Roundtrip property on the real component.
for (const text of FIXTURES) {
  const m = realMapper(text)
  const bad = roundtrip(m, text)
  check(`roundtrip fixture ${JSON.stringify(text.slice(0, 12))}...`, bad.length === 0, bad.slice(0, 3).join("; "))
}

// --- Row byte-column conversion (the two index-writer conventions) -----------
// `resolveRowByteColumns` is the single owner that turns a stored symbol row
// into a per-line column, and it had NO leg of its own before M55.T2. These
// cases are the conventions the writers actually produce:
//   per-line  the analyzers' declared 1-based byte column (fits the line)
//   absolute  the parallel indexer's file-absolute 0-based offset (byte 0 = the
//             first declaration of a file — the shape the pre-M55 guard threw
//             away, killing prepareCallHierarchy for `loop`/`deep`/any symbol
//             that opens its file)
//   absent    an offset that lands nowhere, and a row claiming byte 0 on a line
//             that is not line 1 (inconsistent data) — both declared null
const ROW_TEXT = ["export function deep(): number {", "  return 1;", "}", ""].join("\n")
type RowCase = {
  name: string
  line: number
  byte: number
  want: { line: number; column: number } | null
}
const ROW_CASES: RowCase[] = [
  { name: "per-line column on a later line", line: 2, byte: 3, want: { line: 2, column: 3 } },
  { name: "per-line exclusive end column (len + 1)", line: 2, byte: 12, want: { line: 2, column: 12 } },
  { name: "absolute offset 0 = the file's first declaration", line: 1, byte: 0, want: { line: 1, column: 1 } },
  { name: "absolute offset inside a later line", line: 3, byte: 45, want: { line: 3, column: 1 } },
  { name: "absolute exclusive end of a later line", line: 3, byte: 46, want: { line: 3, column: 2 } },
  { name: "byte 0 claimed on a line that is not line 1 (inconsistent row)", line: 2, byte: 0, want: null },
  { name: "offset beyond the file", line: 1, byte: 100, want: null },
  { name: "line beyond the file", line: 9, byte: 5, want: null },
]
function runRowExpectations(comp: any): string[] {
  const failures: string[] = []
  if (typeof comp.resolveRowByteColumns !== "function") {
    return ["resolveRowByteColumns is not exported by the component"]
  }
  for (const c of ROW_CASES) {
    let got: { line: number; column: number } | null
    try {
      got = comp.resolveRowByteColumns(ROW_TEXT, c.line, c.byte)
    } catch (e: any) {
      failures.push(`${c.name}: threw ${e.message}`)
      continue
    }
    const want = c.want === null ? null : JSON.stringify(c.want)
    const have = got === null || got === undefined ? null : JSON.stringify(got)
    if (want !== have) failures.push(`${c.name}: want ${String(want)}, got ${String(have)}`)
  }
  return failures
}
const rowFailures = runRowExpectations(real)
check(
  "P1: row conversion covers per-line, absolute (incl. byte 0) and declared-absent rows",
  rowFailures.length === 0,
  rowFailures.join("; "),
)

// --- Mutants ----------------------------------------------------------------
type Mutant = { name: string; mutate: (src: string) => string }
const mutants: Mutant[] = [
  {
    name: "off-by-one line (indexToLsp)",
    mutate: (src) => src.replace("const line0 = pos.line - 1", "const line0 = pos.line"),
  },
  {
    name: "off-by-one column (byte col not decremented)",
    mutate: (src) => src.replace("this.byteOffsetToUtf16Offset(line0, pos.column - 1)", "this.byteOffsetToUtf16Offset(line0, pos.column)"),
  },
  {
    name: "missing byte->utf16 conversion",
    mutate: (src) => src.replace('return buf.subarray(0, byteOffset).toString("utf8").length', "return byteOffset"),
  },
  {
    name: "lsp->index misses line +1",
    mutate: (src) => src.replace("return { line: line0 + 1, column: byteOffset + 1 }", "return { line: line0, column: byteOffset + 1 }"),
  },
  {
    name: "mid-code-point check removed",
    mutate: (src) => src.replace("if ((buf[byteOffset]! & 0xc0) === 0x80) {", "if (false) {"),
  },
  {
    name: "surrogate-half check removed",
    mutate: (src) => src.replace("if (unit >= 0xdc00 && unit <= 0xdfff) {", "if (false) {"),
  },
  {
    name: "CRLF not handled (split on \\n only)",
    mutate: (src) => src.replace("split(/\\r\\n|\\r|\\n/)", 'split("\\n")'),
  },
  {
    name: "line count drops phantom line",
    mutate: (src) => src.replace("this.lineTexts = sourceText.split(/\\r\\n|\\r|\\n/)", "this.lineTexts = sourceText.split(/\\r\\n|\\r|\\n/).filter((l, i, a) => i < a.length - 1 || l !== \"\")"),
  },
  {
    name: "row: byte 0 rejected again (the pre-M55 hole)",
    mutate: (src) => src.replace("!Number.isInteger(byte) || byte < 0", "!Number.isInteger(byte) || byte < 1"),
  },
  {
    name: "row: byte 0 accepted on any line (inconsistent rows invented)",
    mutate: (src) => src.replace("if (byte === 0) return line === 1 ? { line: 1, column: 1 } : null", "if (byte === 0) return { line, column: 1 }"),
  },
  {
    name: "row: absolute column off by one",
    mutate: (src) => src.replace("const col = byte - cumStart + 1", "const col = byte - cumStart"),
  },
]

const componentSource = readFileSync(COMPONENT, "utf8")
const mutantResults: { name: string; caught: boolean; detail: string }[] = []

for (const mut of mutants) {
  const mutated = mut.mutate(componentSource)
  if (mutated === componentSource) {
    mutantResults.push({ name: mut.name, caught: false, detail: "mutation produced no change — fix mutant definition" })
    check(`mutant [${mut.name}] applied`, false, "no change")
    continue
  }
  writeFileSync(TMP, mutated)
  let mod: any
  try {
    mod = await import(TMP + `?m=${encodeURIComponent(mut.name)}&t=${Date.now()}`)
  } catch (e) {
    mutantResults.push({ name: mut.name, caught: false, detail: `mutant module failed to load: ${e.message}` })
    check(`mutant [${mut.name}] loads`, false, e.message)
    if (existsSync(TMP)) unlinkSync(TMP)
    continue
  }
  let caughtBy: string[] = []
  for (const text of FIXTURES) {
    const m = mod.createPositionMapper(text)
    const r = runExpectations(m, expectationsFor(text))
    if (!r.ok) caughtBy.push(...r.failed)
    // Mutants may also throw where the real component succeeds; runExpectations
    // already treats unexpected throws as failures.
  }
  // The row-conversion legs are part of this suite too: a mutant that only the
  // row cases catch is still caught.
  caughtBy.push(...runRowExpectations(mod))
  const caught = caughtBy.length > 0
  mutantResults.push({ name: mut.name, caught, detail: caught ? `caught: ${caughtBy[0]}` : "survived all fixtures" })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
  if (existsSync(TMP)) unlinkSync(TMP)
}

// All mutants caught.
check("P1: every planted defect was caught", mutantResults.every((m) => m.caught))

// --- Persist evidence -------------------------------------------------------
let currentCommit = "unknown"
try {
  currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}
const sourceFingerprint = execFileSync("sha256sum", [COMPONENT], { cwd: ROOT, encoding: "utf8" }).trim().split(/\s+/)[0]

const result = {
  issue: "M24.P1",
  code: "P1",
  milestone: "M24",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  negativeCases: mutants.length,
  mutants: mutantResults,
  currentCommit,
  sourceFingerprint,
  verifierCommand: "npx tsx script/m24/verify-positions.ts",
  evidenceFile: "P1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Fixture-based; does not exercise real analyzer output end-to-end (covered by the V1 harness).",
    "resolveRowByteColumns: a file-absolute row whose offset also fits the target line's byte length is still read as per-line (the pre-existing declared ambiguity in the function header). Only byte 0 — impossible as a 1-based per-line column — is disambiguated. Removing the ambiguity for real rows needs a writer-side convention flag (indexer lane); found and reported by M55.T2.",
    "Tab-width treated as 1 UTF-16 unit (LSP standard); editor tab rendering is a client concern.",
    "Roundtrip property samples code-point boundaries, not every byte of multi-byte sequences.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m24/results"), { recursive: true })
writeSealed(path.join(ROOT, "validation/m24/results/P1.json"), result)
console.log(`P1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantResults.filter((m) => m.caught).length}/${mutants.length} mutants caught)`)
process.exit(failed === 0 ? 0 : 1)
