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
// It also carries the LSP lane's CROSS-PLATFORM leg (contract §10, the F7 rule):
// this gate used to compute its own fingerprint by spawning `sha256sum`, a GNU
// coreutils binary that does not exist on macOS, so on darwin the gate died with
// `spawnSync sha256sum ENOENT` before it could write a verdict — the position
// gate was DEAD on this OS, not green. The fingerprint is now node:crypto over
// raw bytes (script/m24/portability.ts), and the leg below is the permanent gate
// for the bug class: no LSP-lane harness may spawn a binary that is absent on a
// supported OS, use a GNU-only command form, or read a Linux-only path. It is
// proven red by planting each shape into a copy of a real lane file, and proven
// precise by planting the same text where it is NOT a spawn (a string literal, a
// comment, a CoreDatabase `.exec(sql)`).
//
// Run: npx tsx script/m24/verify-positions.ts
// Evidence: validation/m24/results/P1.json (machine-emitted)

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import {
  KNOWN_PORTABLE_BINARIES,
  NON_PORTABLE_BINARIES,
  SHA256_KAT,
  allScriptSources,
  auditLspLane,
  findNonPortableSpawns,
  gitHead,
  lspLaneSources,
  measuredOs,
  sha256File,
  sha256Text,
} from "./portability.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/lsp/positions.ts")
const TMP = path.join(ROOT, "validation/m24/.positions-mutant.ts")
const OS = measuredOs()

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

// ---------------------------------------------------------------------------
// Cross-platform legs (contract §10; the F7 gate for the bug class that killed
// this gate on darwin: a harness spawning a binary that does not exist on every
// supported OS).
// ---------------------------------------------------------------------------

// --- X1: the fingerprint helper is sha256, not a shape that looks like one ---
for (const v of SHA256_KAT) {
  check(`X1: fingerprint algorithm is sha256 over raw bytes (vector: ${v.label})`, sha256Text(v.input) === v.want, sha256Text(v.input))
}
// The digest must be over BYTES: a CRLF checkout of an unchanged file has the
// same fingerprint on every OS. A helper that decodes and re-encodes, or
// normalizes line endings, breaks exactly here.
const CR_DIR = mkdtempSync(path.join(tmpdir(), "m24p1-crlf-"))
const crlfFile = path.join(CR_DIR, "crlf.ts")
const lfFile = path.join(CR_DIR, "lf.ts")
writeFileSync(crlfFile, "const a = 1\r\nconst b = 2\r\n")
writeFileSync(lfFile, "const a = 1\nconst b = 2\n")
check(
  "X1: fingerprint is byte-exact (CRLF and LF spellings of the same source differ)",
  sha256File(crlfFile) !== sha256File(lfFile) && sha256File(crlfFile) === sha256Text("const a = 1\r\nconst b = 2\r\n"),
  `crlf=${sha256File(crlfFile)} lf=${sha256File(lfFile)}`,
)
rmSync(CR_DIR, { recursive: true, force: true })
// The recorded fingerprint of the component under test is the portable digest.
check(
  "X1: the record's sourceFingerprint is the portable sha256 of the component (64 hex)",
  /^[0-9a-f]{64}$/.test(sha256File(COMPONENT)),
  sha256File(COMPONENT),
)

// --- X2: the rule set itself is well-formed (a gate over an empty rule set
// passes everything and proves nothing) ---
check(
  "X2: every denied binary declares a reason and an OS-measurement",
  Object.values(NON_PORTABLE_BINARIES).every((e) => e.reason.length > 20 && e.absentOnDarwin !== undefined),
  JSON.stringify(Object.entries(NON_PORTABLE_BINARIES).filter(([, e]) => !(e.reason.length > 20 && e.absentOnDarwin !== undefined)).map(([k]) => k)),
)
check("X2: the portable allowlist is non-empty", KNOWN_PORTABLE_BINARIES.length > 0, `${KNOWN_PORTABLE_BINARIES.length} entries`)

// --- X3: THE GATE. Zero non-portable spawns in the LSP lane -----------------
const laneAudit = auditLspLane(ROOT)
for (const f of laneAudit.findings) {
  check(`X3: LSP-lane harness spawns nothing non-portable — ${f.file}:${f.line} [${f.kind}] ${f.matched}`, false, `${f.api}: ${f.reason}`)
}
check(
  "X3: LSP-lane portability sweep ran (files scanned > 0, spawn sites seen > 0, no read errors)",
  laneAudit.filesScanned > 0 && laneAudit.spawnSites.length > 0 && laneAudit.errors.length === 0,
  `files=${laneAudit.filesScanned} sites=${laneAudit.spawnSites.length} errors=${JSON.stringify(laneAudit.errors)}`,
)
// The sweep is not vacuous: it must actually SEE the spawn sites it judged.
check(
  "X3: the sweep judged the lane's real spawn sites (direct call sites + laundered wrapper calls)",
  laneAudit.spawnSites.filter((s) => s.via === "direct" && s.resolved).length > 0 && laneAudit.spawnSites.some((s) => s.via === "wrapper"),
  `direct=${laneAudit.spawnSites.filter((s) => s.via === "direct" && s.resolved).length} wrapper=${laneAudit.spawnSites.filter((s) => s.via === "wrapper").length} computed=${laneAudit.spawnSites.filter((s) => s.via === "computed").length}`,
)

// --- X4: mutation suite — every planted non-portable shape must be caught ---
// Each mutant appends a spawn to a COPY of a real lane file and re-scans it.
// The assertion is the finding's KIND, its MATCHED token and its LINE: a rule
// that fires on everything, or fires somewhere else, fails here.
const PORTABILITY_HOST = "script/m24/verify-hover.ts" // a real lane harness (not a copy of this gate)
const hostSource = readFileSync(path.join(ROOT, PORTABILITY_HOST), "utf8")
const hostLines = hostSource.split("\n").length
type PortMutant = {
  name: string
  /** The child_process API the plant uses; imported by the plant when the host lacks it. */
  api?: string
  /** The planted line(s), appended verbatim to the host copy. */
  plant: string
  kind: string
  matched: string
  /** must NOT produce a finding (precision proofs) */
  expectClean?: boolean
}
const portabilityMutants: PortMutant[] = [
  { name: "planted execFileSync sha256sum (the defect that killed this gate)", api: "execFileSync", plant: `const fp = execFileSync("sha256sum", [COMPONENT], { encoding: "utf8" })`, kind: "non-portable-binary", matched: "sha256sum" },
  { name: "planted execSync shell sha256sum", api: "execSync", plant: `const fp = execSync("sha256sum src/lsp/positions.ts", { encoding: "utf8" })`, kind: "non-portable-binary", matched: "sha256sum" },
  { name: "planted spawnSync md5sum", api: "spawnSync", plant: `const fp = spawnSync("md5sum", [COMPONENT], { encoding: "utf8" })`, kind: "non-portable-binary", matched: "md5sum" },
  { name: "planted spawn of an absent-on-darwin coreutils binary (timeout)", api: "spawnSync", plant: `const fp = spawnSync("timeout", ["5", "true"], { encoding: "utf8" })`, kind: "non-portable-binary", matched: "timeout" },
  { name: "planted /proc read inside a shell spawn", api: "execFileSync", plant: `const cpu = execFileSync("sh", ["-c", "grep -m1 'model name' /proc/cpuinfo"], { encoding: "utf8" })`, kind: "platform-only-path", matched: "/proc" },
  { name: "planted GNU-only stat -c", api: "execSync", plant: `const size = execSync("stat -c %s file.txt", { encoding: "utf8" })`, kind: "gnu-only-command-form", matched: "stat -c" },
  { name: "planted GNU-only sort -V (accepted-but-ignored on BSD)", api: "execSync", plant: `const out = execSync("printf '2\\n10\\n' | sort -V", { encoding: "utf8" })`, kind: "gnu-only-command-form", matched: "sort -V" },
  { name: "planted GNU-only grep -P", api: "execSync", plant: `const hit = execSync("grep -P foo file.txt", { encoding: "utf8" })`, kind: "gnu-only-command-form", matched: "grep -P" },
  { name: "planted GNU-only sed -i in-place form (argv shape)", api: "execFileSync", plant: `execFileSync("sed", ["-i", "s/x/y/", "file.txt"], { encoding: "utf8" })`, kind: "gnu-only-command-form", matched: "sed -i (GNU form)" },
  { name: "planted sha256sum laundered through a local spawn wrapper", api: "execFileSync", plant: `function plantRun(cmd, args) { return execFileSync(cmd, args, { encoding: "utf8" }) }\nconst digest = plantRun("bash", ["-lc", "find . -type f | sort | xargs sha256sum"])`, kind: "denylisted-binary-in-spawned-command", matched: "sha256sum" },
  { name: "PRECISION: the same spawn text inside a string literal is not a spawn", plant: `const doc = "run execFileSync(\\"sha256sum\\", [file]) to fingerprint"`, expectClean: true },
  { name: "PRECISION: the same spawn text inside a comment is not a spawn", plant: `// execFileSync("sha256sum", [file]) — the darwin defect, in prose`, expectClean: true },
  { name: "PRECISION: a CoreDatabase .exec(sql) is not a process spawn", plant: `const raw = { exec(sql: string) { return { run: () => {} } } }\nraw.exec("PRAGMA journal_mode = WAL")`, expectClean: true },
  { name: "PRECISION: a portable spawn of git/node stays unflagged", api: "execFileSync", plant: `const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })\nconst ver = execFileSync("node", ["--version"], { encoding: "utf8" })`, expectClean: true },
]
const portabilityMutantResults: { name: string; caught: boolean; detail: string }[] = []
for (const mut of portabilityMutants) {
  const plantLines = [...(mut.api ? [`import { ${mut.api} } from "node:child_process"`] : []), ...mut.plant.split("\n")]
  const plantedSource = `${hostSource}\n${plantLines.join("\n")}\n`
  const plantStartLine = hostLines + 1 // the plant begins on the line after the host's last
  const r = findNonPortableSpawns(PORTABILITY_HOST, plantedSource)
  const mine = r.findings.filter((f) => f.line >= plantStartLine)
  let caught: boolean
  let detail: string
  if (mut.expectClean) {
    caught = mine.length === 0
    detail = caught ? "no finding (precision kept)" : `false positive: ${mine.map((f) => `${f.kind}:${f.matched}@${f.line}`).join(", ")}`
  } else {
    const hit = mine.find((f) => f.kind === mut.kind && f.matched === mut.matched)
    caught = !!hit
    detail = caught
      ? `caught at line ${hit!.line} (${hit!.kind}: ${hit!.matched})`
      : `survived; got ${mine.length ? mine.map((f) => `${f.kind}:${f.matched}@${f.line}`).join(", ") : "no findings"}`
  }
  portabilityMutantResults.push({ name: mut.name, caught, detail })
  check(`X4: planted portability defect [${mut.name}] ${mut.expectClean ? "not flagged" : "caught at its line"}`, caught, caught ? "" : detail)
}
check("X4: every planted portability defect was caught (and no precision proof regressed)", portabilityMutantResults.every((m) => m.caught))

// --- X5: the planted defect is REAL on this OS, not a theory ---------------
// Execute a disposable copy of a harness that spawns the denied binary and
// record what actually happens here. OS-scoped by measurement (contract §10):
//   darwin -> must die with ENOENT (that is the defect)
//   linux  -> must succeed AND agree with node:crypto (cross-OS agreement)
//   win32  -> declared unsupported for this lane; recorded, not asserted
const PROBE_DIR = mkdtempSync(path.join(tmpdir(), "m24p1-probe-"))
const probeFile = path.join(PROBE_DIR, "planted-harness.mjs")
writeFileSync(
  probeFile,
  `import { execFileSync } from "node:child_process"\nimport { createHash } from "node:crypto"\nimport { readFileSync } from "node:fs"\nconst target = ${JSON.stringify(COMPONENT)}\nconst printed = execFileSync("sha256sum", [target], { encoding: "utf8" }).trim().split(/\\s+/)[0]\nconst portable = createHash("sha256").update(readFileSync(target)).digest("hex")\nconsole.log(JSON.stringify({ printed, portable }))\n`,
)
let probeOutcome: { os: string; expected: string; observed: string; ok: boolean } = {
  os: OS.platform,
  expected: "declared-unsupported",
  observed: "not executed",
  ok: true,
}
if (OS.platform === "darwin" || OS.platform === "linux") {
  let stdout = ""
  let stderr = ""
  let status: number | null = null
  try {
    stdout = execFileSync(process.execPath, [probeFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 })
  } catch (e: any) {
    stdout = String(e.stdout ?? "")
    stderr = String(e.stderr ?? "")
    status = typeof e.status === "number" ? e.status : 1
  }
  const errNoEnt = /ENOENT/.test(stderr)
  const digestsAgree = (() => {
    try {
      const parsed = JSON.parse(stdout.trim()) as { printed: string; portable: string }
      return parsed.printed === parsed.portable
    } catch {
      return false
    }
  })()
  if (OS.platform === "darwin") {
    probeOutcome = {
      os: OS.platform,
      expected: "spawn sha256sum dies with ENOENT",
      observed: errNoEnt ? "ENOENT (the defect reproduces here)" : `exited status=${status} stdout=${stdout.trim().slice(0, 80)}`,
      ok: errNoEnt,
    }
  } else {
    probeOutcome = {
      os: OS.platform,
      expected: "spawn sha256sum succeeds and agrees with node:crypto",
      observed: digestsAgree ? "digest matches sha256File()" : `status=${status} agree=${digestsAgree} err=${stderr.trim().slice(0, 80)}`,
      ok: digestsAgree,
    }
  }
}
check(
  "X5: the planted sha256sum spawn behaves as this OS declares (darwin ENOENT / linux digest agreement)",
  probeOutcome.ok,
  `expected ${probeOutcome.expected}; observed ${probeOutcome.observed}`,
)
rmSync(PROBE_DIR, { recursive: true, force: true })

// --- X6: discovery sweep OUTSIDE the LSP lane (report, not verdict) --------
// The rule is the LSP lane's to pass; the sweep exists so the other lanes'
// occurrences are counted and named in the record instead of being discovered
// by accident later. It does NOT fail this gate: those files are owned by
// other lanes, and a gate that fails on files it may not fix is a gate nobody
// reads. Every hit is recorded with file:line and the reason.
const laneFiles = new Set(lspLaneSources(ROOT))
const allScript = allScriptSources(ROOT)
const outOfLaneFiles = new Set<string>()
const outOfLane: Array<{ file: string; line: number; kind: string; matched: string; api: string; reason: string }> = []
for (const rel of allScript) {
  if (laneFiles.has(rel)) continue
  outOfLaneFiles.add(rel)
  let source: string
  try {
    source = readFileSync(path.join(ROOT, rel), "utf8")
  } catch {
    continue
  }
  for (const f of findNonPortableSpawns(rel, source).findings) {
    outOfLane.push({ file: f.file, line: f.line, kind: f.kind, matched: f.matched, api: f.api, reason: f.reason })
  }
}
const sweptExactlyOnce = allScript.filter((f) => laneFiles.has(f) || outOfLaneFiles.has(f)).length === allScript.length
const disjoint = [...outOfLaneFiles].every((f) => !laneFiles.has(f))
check(
  "X6: the two sweeps partition the source tree exactly once (no file judged twice, none missed)",
  sweptExactlyOnce && disjoint,
  `allScript=${allScript.length} laneFiles=${laneFiles.size} outOfLaneFiles=${outOfLaneFiles.size} sweptOnce=${sweptExactlyOnce} disjoint=${disjoint}`,
)
check(
  "X6: every out-of-lane finding is named with file:line in the record (report-only: those files are owned by other lanes)",
  outOfLane.length > 0 && outOfLane.every((f) => typeof f.file === "string" && f.line > 0 && f.reason !== undefined),
  `${outOfLane.length} out-of-lane findings recorded`,
)

const portabilityVerdictOk = laneAudit.findings.length === 0 && portabilityMutantResults.every((m) => m.caught) && probeOutcome.ok

// --- Persist evidence -------------------------------------------------------
const currentCommit = gitHead(ROOT)
const sourceFingerprint = sha256File(COMPONENT)

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
  portability: {
    rule: "no LSP-lane harness may spawn a binary absent on a supported OS, use a GNU-only command form, or read a Linux-only path",
    scope: "script/m24, m25, m26, m27, m28, m29, m42, m44, m45, m55 + src/lsp",
    measuredOs: OS,
    supportedOses: ["darwin", "linux"],
    declaredAbsentOses: ["win32"],
    filesScanned: laneAudit.filesScanned,
    spawnSitesJudged: laneAudit.spawnSites.length,
    spawnSitesByReach: {
      directCallSitesResolvedByName: laneAudit.spawnSites.filter((s) => s.via === "direct" && s.resolved).length,
      localWrapperCallSitesArgumentScanned: laneAudit.spawnSites.filter((s) => s.via === "wrapper").length,
      commandComputedAtRuntimeNotJudgedByName: laneAudit.spawnSites.filter((s) => s.via === "computed").length,
    },
    findings: laneAudit.findings.map((f) => ({ file: f.file, line: f.line, kind: f.kind, matched: f.matched, api: f.api, reason: f.reason })),
    plantedDefectsCaught: portabilityMutantResults.filter((m) => m.caught).length,
    plantedDefectsTotal: portabilityMutantResults.length,
    plantedDefects: portabilityMutantResults,
    plantedDefectExecution: probeOutcome,
    outOfLaneFindings: outOfLane,
    ok: portabilityVerdictOk,
  },
  currentCommit,
  sourceFingerprint,
  sourceFingerprintAlgorithm: "sha256 over raw file bytes (node:crypto; no process spawn)",
  verifierCommand: "npx tsx script/m24/verify-positions.ts",
  evidenceFile: "P1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Fixture-based; does not exercise real analyzer output end-to-end (covered by the V1 harness).",
    "resolveRowByteColumns: a file-absolute row whose offset also fits the target line's byte length is still read as per-line (the pre-existing declared ambiguity in the function header). Only byte 0 — impossible as a 1-based per-line column — is disambiguated. Removing the ambiguity for real rows needs a writer-side convention flag (indexer lane); found and reported by M55.T2.",
    "Tab-width treated as 1 UTF-16 unit (LSP standard); editor tab rendering is a client concern.",
    "Roundtrip property samples code-point boundaries, not every byte of multi-byte sequences.",
    "Portability rule coverage, counted in `spawnSitesByReach`: a direct child_process call site is resolved by name; a call to a local function that forwards to one is scanned argument-by-argument (checksum class only, since a wrapper's arguments are arbitrary strings); a site whose command is built at runtime is counted but cannot be judged by name; a wrapper that launders a command ACROSS files (imported from another module) is not resolved; win32 is declared absent for this lane and unverified.",
    "The portability denylist is static by design so the gate gives the same verdict on every OS; a binary's presence on this machine is therefore NOT probed by the gate. The X5 leg measures the one binary this bug class is about (sha256sum) by executing the planted spawn, and the record states which OS it ran on.",
    "The out-of-lane sweep (script/ outside the LSP lane) is a REPORT: its findings are named in the record with file:line, and they do not change this gate's verdict because those files belong to other lanes.",
    "CORRECTION (M24 lane-1 wave 2), superseding this lane's wave-1 REPORT — the original claim is kept here in the open, not deleted: wave 1 stated that script/m24/lsp_harness.ts:80 was 'unguarded and throws on macOS' and that 'every M24 harness that calls machineInfo() (runHarness :435/:450/:494, i.e. L1-L5, V1) dies there'. BOTH halves were wrong. (a) It does NOT throw: the call is `sh -c 'grep MemTotal /proc/meminfo | awk ...'`, and a shell PIPELINE exits with its LAST stage's status, so grep failing and awk succeeding returns normally with an empty string; the sibling `catch {}` on the CPU line never fires for the same reason. (b) The blast radius was overstated: of the M24 gates only verify-harness.ts (V1) publishes machine facts from that harness, so L1-L5 were never involved. The narrower truth is worse in one way and better in another: nothing crashed, so the failure was SILENT — three sealed V1 runs published machine {cpu:'', ramGb:0} under a VERIFIED verdict, and the only trace was a grep error on the gate's own stderr. Both were fixed in wave 2 (script/m24/lsp_harness.ts machineFacts(), node:os only) and gated by V1's G5/G6 legs; the two /proc findings this gate published for lsp_harness.ts:78/:80 are RESOLVED by that fix, not waived.",
    "A second correction to that same wave-1 statement, for completeness: `runHarness` has more consumers than V1 (script/m27/verify-zed.ts:187, script/m27/verify-lsp4ij.ts:188, script/m27/verify-helix.ts:163, script/m48/l1-hub-smoke.ts:29). None of them copies `.machine` into its evidence, so only V1 published the bad values, but the defect was reachable from four more gates.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m24/results"), { recursive: true })
writeSealed(path.join(ROOT, "validation/m24/results/P1.json"), result)
console.log(`P1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantResults.filter((m) => m.caught).length}/${mutants.length} component mutants caught, ${portabilityMutantResults.filter((m) => m.caught).length}/${portabilityMutantResults.length} portability plants handled, ${laneAudit.findings.length} lane portability findings)`)
process.exit(failed === 0 ? 0 : 1)
