/**
 * c-header-scan — D7 sizing instrument for the C per-file wall (task-21, charter §18).
 *
 * TWO REPORTS, ONE DUMP, ONE POPULATION:
 *   I1 (header split)  — for every class target, is the name a token in a project header?
 *   I2 (in-file macro pre-check) — for every macro-spelled row, is the macro defined in the ROW'S OWN
 *        file? A hit would be a DEFECT of the in-file macro symbol path (the "macro declared in-file"
 *        candidate from the task brief), reported rather than smoothed. Text-level `#define NAME`
 *        detection, stated limit, parse-verified follow-up.
 *
 * WHAT THIS ANSWERS. §15's classification leaves the biggest C wall as one named class,
 * `name-not-in-run-key-space` (calls 84,927 unresolved / 18,301 ambiguous; uses 47,812 / 52,887),
 * plus `macro-spelled` (calls 42,316 / 18,294; uses 168 / 2,505) and the `type-shaped` half of
 * references. The run's key space holds declarations from the admitted `.c` files only, so EVERY row
 * in those classes is by definition not declared in a `.c` file — but the row is EITHER declared in a
 * project `.h` (invisible to the population; an INSTRUMENT GAP) OR declared nowhere the project ships
 * (external/platform; RULED UNDECIDABLE in a per-file model). Spelling cannot tell those apart, which
 * is why `C-D7-DISPOSITION.md` D-RULED-1 is stated as a SPLIT with this instrument as its falsifier.
 *
 * WHAT IT DOES, AND WHAT IT DOES NOT. It streams the gate's OWN dump (the same 324,853-row artifact
 * the classifier reads), groups the rows into the SAME families the classifier uses (same spelling
 * rules, copied deliberately and cross-checked by a CONTROL that the family totals equal §15's
 * published numbers — a drifting copy fails loudly instead of producing a quiet number), and then
 * searches every tracked project HEADER for each target as an IDENTIFIER TOKEN. It is a TEXT-LEVEL
 * scan: "this name appears as a token somewhere in a project header", not "this header declares it".
 * That limit is stated in the output and in the disposition; a parse-verified spot-check is the
 * follow-up, not a claim here. No tree-sitter parse of 18k headers is done (the box's memory gate).
 * The identifier TOKENIZER is a character scanner (no regex); the ISO-C list extraction mirrors the
 * classifier's own extraction, regex included, so the two instruments read one list the same way.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/c-header-scan.ts <dump-file> [--json]
 *
 * EXIT: 0 printed · 2 environment/usage · 3 CONTROL DID NOT FIRE (family totals differ from §15, or
 *       the tokenizer self-check fails).
 */
import { execFileSync } from "node:child_process"
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { createInterface } from "node:readline"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")
if (!FILE) {
  console.error("usage: bun run script/m14/c-header-scan.ts <dump-file> [--json]")
  process.exit(2)
}

// ── §15's published class totals (the CONTROL). Each row: [unresolved, ambiguous]. ────────────────
const SECTION_15: Record<string, Record<string, [number, number]>> = {
  calls: {
    "name-not-in-run-key-space": [84_927, 18_301],
    "macro-spelled": [42_316, 18_294],
    "iso-c-stdlib-name": [2, 4_708],
    "keyword-spelled": [29, 1],
    "non-identifier-shaped": [5, 0],
  },
  uses: {
    "name-not-in-run-key-space": [47_812, 52_887],
    "macro-spelled": [168, 2_505],
    "iso-c-stdlib-name": [96, 152],
  },
  references: {
    "name-not-in-run-key-space": [16, 1_366],
    "type-shaped": [15, 987],
    "macro-spelled": [0, 82],
    "non-identifier-shaped": [0, 2],
  },
}

// ── the classifier's family rules, copied VERBATIM from script/m14/c-dump-classify.ts ───────────
// Deliberate copy: the CONTROL below re-derives §15's published class totals with this copy, so a
// drift between the two instruments fails loudly instead of producing a quiet number. The ISO-C list
// is extracted from the analyzer's own source exactly as the classifier does it (one list, two readers).
const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")
const ISO_C_LIBRARY_NAMES: Set<string> = (() => {
  let src = ""
  try { src = readFileSync(ANALYZER, "utf8") } catch { return new Set() }
  const at = src.indexOf("ISO_C_LIBRARY_NAMES")
  if (at < 0) return new Set()
  const open = src.indexOf("[", at)
  const close = src.indexOf("]", open + 1)
  if (open < 0 || close < 0) return new Set()
  const body = src.slice(open + 1, close)
  const names = new Set<string>()
  let i = 0
  while (i < body.length) {
    if (body[i] !== '"') { i++; continue }
    let j = i + 1
    let out = ""
    while (j < body.length && body[j] !== '"') { out += body[j]; j++ }
    if (out.length > 0 && /^[A-Za-z_]/.test(out)) names.add(out)
    i = j + 1
  }
  return names
})()
if (ISO_C_LIBRARY_NAMES.size < 40) {
  console.error(`CONTROL DID NOT FIRE: extracted ${ISO_C_LIBRARY_NAMES.size} ISO-C library names from ${ANALYZER}.`)
  process.exit(3)
}
const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "return", "sizeof", "goto",
  "break", "continue", "default", "auto", "register", "restrict", "volatile",
  "int", "char", "void", "static", "const", "struct", "union", "enum", "typedef",
  "unsigned", "signed", "long", "short", "float", "double", "extern", "inline",
])
function isIdentifierShape(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  const c0 = s[0]
  return !(c0 >= "0" && c0 <= "9")
}
function isAllCapsIdentifier(s: string): boolean {
  let hasUpper = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") hasUpper = true
  }
  return hasUpper
}
/** One family per target SPELLING — the classifier's function, verbatim incl. its subfamilies. */
function family(label: string, target: string): string {
  const s = String(target ?? "").trim()
  if (s.length === 0) return "empty"
  if (label === "imports") {
    if (s.includes("/") || s.includes("\\")) return "include-path/subdirectory"
    return "include-path/bare-header"
  }
  if (label === "exports") return "export-marker-token"
  if (C_KEYWORDS.has(s)) return "keyword-spelled"
  if (!isIdentifierShape(s)) {
    if (s.includes("(") || s.includes(")")) return "call-or-attribute-shaped"
    if (s.includes(".") || s.includes("->")) return "member-path-shaped"
    return "non-identifier-shaped"
  }
  if (ISO_C_LIBRARY_NAMES.has(s)) return "iso-c-stdlib-name"
  if (isAllCapsIdentifier(s)) return "macro-spelled"
  if (label === "references" && (s.endsWith("_t") || (s[0] >= "A" && s[0] <= "Z"))) return "type-shaped"
  return "name-not-in-run-key-space"
}

// ── read the dump, group rows into §15 families, keep the target sets for the split classes ──────
const OUTCOMES_UNRESOLVED = new Set(["unresolved", "externalRefuted"])
const OUTCOMES_AMBIG = new Set(["ambDeclOnly", "ambBoth"])
const tallies = new Map<string, { unresolved: number; ambiguous: number }>() // `${type}\0${family}`
const splitTargets = new Map<string, Set<string>>() // `${type}\0${family}` -> unique targets
const splitClass = (type: string, fam: string): boolean =>
  fam === "name-not-in-run-key-space" || fam === "macro-spelled" || (type === "references" && fam === "type-shaped")

let dumpRows = 0
const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.startsWith("DUMP\t")) continue
  const parts = line.split("\t")
  if (parts.length < 6) continue
  const label = parts[1]
  const outcome = parts[2]
  const target = parts[3]
  if (label !== "calls" && label !== "uses" && label !== "references") continue
  if (!OUTCOMES_UNRESOLVED.has(outcome) && !OUTCOMES_AMBIG.has(outcome)) continue
  dumpRows++
  const fam = family(label, target)
  const key = `${label}\u0000${fam}`
  const t = tallies.get(key) ?? { unresolved: 0, ambiguous: 0 }
  if (OUTCOMES_UNRESOLVED.has(outcome)) t.unresolved++
  else t.ambiguous++
  tallies.set(key, t)
  if (splitClass(label, fam)) {
    const set = splitTargets.get(key) ?? new Set<string>()
    set.add(String(target).trim())
    splitTargets.set(key, set)
  }
}

// ── CONTROL 1: the family totals must equal §15's published numbers ─────────────────────────────
const controlFailures: string[] = []
for (const label of Object.keys(SECTION_15)) {
  for (const fam of Object.keys(SECTION_15[label])) {
    const want = SECTION_15[label][fam]
    const got = tallies.get(`${label}\u0000${fam}`) ?? { unresolved: 0, ambiguous: 0 }
    if (got.unresolved !== want[0] || got.ambiguous !== want[1]) {
      controlFailures.push(`${label}/${fam}: instrument ${got.unresolved}/${got.ambiguous} != §15 ${want[0]}/${want[1]}`)
    }
  }
}
if (controlFailures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the family copy is not the classifier's family copy.")
  for (const f of controlFailures.slice(0, 20)) console.error("  " + f)
  process.exit(3)
}

// ── CONTROL 2: the token scanner (char scan, no regex) on a synthetic string ─────────────────────
const scanTokens = (text: string, into: (tok: string) => void): void => {
  let i = 0
  while (i < text.length) {
    let c = text.charCodeAt(i)
    const firstOk = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (!firstOk) { i++; continue }
    let j = i + 1
    while (j < text.length) {
      const d = text.charCodeAt(j)
      const ok = (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95
      if (!ok) break
      j++
    }
    into(text.slice(i, j))
    i = j
  }
}
{
  const seen = new Set<string>()
  scanTokens("int alpha_beta; #define GAMMA 1 int $bad tail_9", (t) => seen.add(t))
  for (const want of ["int", "alpha_beta", "define", "GAMMA", "tail_9", "bad"]) {
    if (!seen.has(want)) controlFailures.push(`tokenizer self-check missed ${want}`)
  }
  if (seen.has("$bad")) controlFailures.push("tokenizer self-check accepted a $-prefixed run as a token")
  if (controlFailures.length > 0) {
    console.error("CONTROL DID NOT FIRE: tokenizer self-check failed.")
    for (const f of controlFailures) console.error("  " + f)
    process.exit(3)
  }
}

// ── the scan: every tracked project header, identifier tokens checked against the split targets ─
const repoRoots: string[] = []
let entries: string[] = []
try { entries = readdirSync(CR) } catch { entries = [] }
for (const name of entries.sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  repoRoots.push(dir)
}
const found = new Set<string>()
const allTargets = new Set<string>()
for (const set of splitTargets.values()) for (const t of set) allTargets.add(t)
let headersScanned = 0
let headersTracked = 0
let headersSkippedUnreadable = 0
let headerBytes = 0
for (const repo of repoRoots) {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter((rel) => rel.endsWith(".h"))
  } catch { continue }
  headersTracked += tracked.length
  for (const rel of tracked) {
    let text: string
    try { text = readFileSync(path.join(repo, rel), "utf8") } catch { headersSkippedUnreadable++; continue }
    headersScanned++
    headerBytes += text.length
    scanTokens(text, (tok) => {
      if (allTargets.has(tok) && !found.has(tok)) found.add(tok)
    })
  }
}

// ── I2: the in-file macro pre-check (a DEFECT screen, not a resolution) ─────────────────────────
// A macro-spelled call/uses row whose macro is `#define`d in the ROW'S OWN file is a defect of the
// in-file macro symbol path (the analyzer publishes those symbols; an invocation of them should bind).
// Text-level detection of `#define NAME` / `#define NAME(...)`: token scan over the row's own file.
// LIMIT: a `#define` split by continuations is still found (the token follows the directive token), but
// a macro defined under a DIFFERENT name passed through `#undef`/replacement is not modelled — the flag
// is a screen for a parse-verified follow-up, never a conviction on its own.
const macroRows: Array<{ file: string; target: string; label: string }> = []
{
  const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.startsWith("DUMP\t")) continue
    const parts = line.split("\t")
    if (parts.length < 6) continue
    const label = parts[1]
    if (label !== "calls" && label !== "uses") continue
    if (!OUTCOMES_UNRESOLVED.has(parts[2]) && !OUTCOMES_AMBIG.has(parts[2])) continue
    const target = String(parts[3]).trim()
    if (family(label, target) !== "macro-spelled") continue
    const where = String(parts[4] ?? "")
    const cut = where.lastIndexOf(":")
    if (cut <= 0) continue
    macroRows.push({ file: where.slice(0, cut), target, label })
  }
}
const definedInOwnFile = new Set<string>()
{
  const byFile = new Map<string, Set<string>>()
  for (const row of macroRows) {
    const set = byFile.get(row.file) ?? new Set<string>()
    set.add(row.target)
    byFile.set(row.file, set)
  }
  const DIR = path.join(ROOT, ".corpus")
  for (const [file, names] of byFile) {
    let text = ""
    try { text = readFileSync(path.join(DIR, file), "utf8") } catch { continue }
    const tokens: string[] = []
    scanTokens(text, (tok) => tokens.push(tok))
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (tokens[i] !== "define") continue
      let j = i + 1
      while (j < tokens.length && (tokens[j] === "define" || tokens[j] === "#")) j++
      if (j < tokens.length && names.has(tokens[j])) definedInOwnFile.add(`${file}\u0000${tokens[j]}`)
    }
  }
}
const i2Rows = macroRows.length
const i2Hits = macroRows.filter((r) => definedInOwnFile.has(`${r.file}\u0000${r.target}`)).length
const i2 = {
  what: "I2 in-file macro pre-check: macro-spelled rows whose macro is `#define`d in the row's OWN file (a hit = suspected DEFECT of the in-file macro symbol path, not a disposition)",
  rowsChecked: i2Rows,
  uniqueMacroTargets: new Set(macroRows.map((r) => r.target)).size,
  uniqueFiles: new Set(macroRows.map((r) => r.file)).size,
  definedInOwnFileRows: i2Hits,
  definedInOwnFileSamples: macroRows.filter((r) => definedInOwnFile.has(`${r.file}\u0000${r.target}`)).slice(0, 10).map((r) => `${r.file}: ${r.label} -> ${r.target}`),
  limit: "text-level `#define NAME` detection over the row's own file; a hit is a SCREEN for a parse-verified defect check, never a conviction",
}

// ── the split table (row-weighted: one target spelling can carry many rows) ─────────────────────
const rowWeight = new Map<string, number>() // `${type}\0${family}\0${target}` -> rows
{
  const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.startsWith("DUMP\t")) continue
    const parts = line.split("\t")
    if (parts.length < 6) continue
    const label = parts[1]
    const outcome = parts[2]
    const target = String(parts[3]).trim()
    if (label !== "calls" && label !== "uses" && label !== "references") continue
    if (!OUTCOMES_UNRESOLVED.has(outcome) && !OUTCOMES_AMBIG.has(outcome)) continue
    const fam = family(label, target)
    if (!splitClass(label, fam)) continue
    const k = `${label}\u0000${fam}\u0000${target}`
    rowWeight.set(k, (rowWeight.get(k) ?? 0) + 1)
  }
}
const splitRows: Record<string, any> = {}
let rowsHeader = 0
let rowsAbsent = 0
for (const [key, set] of [...splitTargets.entries()].sort((a, b) => b[1].size - a[1].size)) {
  const [label, fam] = key.split("\u0000")
  const tally = tallies.get(key) ?? { unresolved: 0, ambiguous: 0 }
  const targets = [...set]
  const headerTargets = targets.filter((t) => found.has(t))
  const absentTargets = targets.filter((t) => !found.has(t))
  let headerRows = 0
  let absentRows = 0
  for (const t of headerTargets) headerRows += rowWeight.get(`${label}\u0000${fam}\u0000${t}`) ?? 0
  for (const t of absentTargets) absentRows += rowWeight.get(`${label}\u0000${fam}\u0000${t}`) ?? 0
  rowsHeader += headerRows
  rowsAbsent += absentRows
  splitRows[`${label}/${fam}`] = {
    rows: tally.unresolved + tally.ambiguous,
    unresolved: tally.unresolved,
    ambiguous: tally.ambiguous,
    uniqueTargets: targets.length,
    headerDeclaredTargets: headerTargets.length,
    absentFromHeadersTargets: absentTargets.length,
    headerDeclaredRows: headerRows,
    absentFromHeadersRows: absentRows,
    headerTargetSamples: headerTargets.slice(0, 8),
    absentTargetSamples: absentTargets.slice(0, 8),
  }
}

const result = {
  instrument: "script/m14/c-header-scan.ts",
  purpose: "D7 sizing: splits the C per-file wall rows into header-declared (INSTRUMENT GAP, resolvable in principle) vs absent-from-headers (RULED UNDECIDABLE in a per-file model) — the falsifier test for C-D7-DISPOSITION.md D-RULED-1/D-RULED-2",
  dump: path.relative(ROOT, FILE),
  scope: {
    population: "the SAME gate dump the classifier reads (arm A: 5,022/5,022 .c, 39 repos, no index); NO second population and NO tree-sitter parse of headers",
    headers: {
      repos: repoRoots.length,
      filesTracked: headersTracked,
      filesScanned: headersScanned,
      filesSkippedUnreadable: headersSkippedUnreadable,
      bytes: headerBytes,
      skippedNote: "a header the scan could not read as UTF-8 text is COUNTED, not silently dropped; a token in such a file would under-count the header-declared share, which is the conservative direction for an instrument-gap price",
    },
    scanLevel: "TEXT-LEVEL identifier-token search in project headers — 'this name appears as a token in some project header', NOT 'this header declares it'. Stated limit; a parse-verified spot-check is the follow-up.",
    tokenizer: "character scanner, no regex literals (M49.R2)",
  },
  controls: {
    familyTotalsEqualSection15: true,
    tokenizerSelfCheck: true,
    dumpedRowsReclassified: dumpRows,
    note: "CONTROL 1: every family total this instrument re-derived equals the §15 published class table (a drifting copy fails loudly). CONTROL 2: the identifier tokenizer is self-checked on a synthetic string, including a negative for $-prefixed runs.",
  },
  split: splitRows,
  inFileMacroPreCheck: i2,
  totals: { rows: rowsHeader + rowsAbsent, headerDeclaredRows: rowsHeader, absentFromHeadersRows: rowsAbsent },
}

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`c-header-scan — ${path.relative(ROOT, FILE)}`)
  console.log(`headers: ${headersScanned} files across ${repoRoots.length} repos (${(headerBytes / 1e6).toFixed(1)} MB), text-level token scan`)
  console.log(`control: PASS — family totals equal §15 (${dumpRows} calls/uses/references non-resolved rows re-grouped) + tokenizer self-check`)
  console.log()
  for (const [k, v] of Object.entries(splitRows)) {
    console.log(`${k}: rows ${v.rows} (unres ${v.unresolved} / amb ${v.ambiguous})`)
    console.log(`  unique targets ${v.uniqueTargets} · in headers ${v.headerDeclaredTargets} targets / ${v.headerDeclaredRows} rows · absent ${v.absentFromHeadersTargets} targets / ${v.absentFromHeadersRows} rows`)
    if (v.headerTargetSamples.length) console.log(`  e.g. in headers: ${v.headerTargetSamples.slice(0, 4).join(", ")}`)
    if (v.absentTargetSamples.length) console.log(`  e.g. absent:    ${v.absentTargetSamples.slice(0, 4).join(", ")}`)
  }
  console.log(`\nTOTAL split rows: header-declared ${rowsHeader} · absent-from-headers ${rowsAbsent}`)
  console.log(`\nI2 in-file macro pre-check: ${i2.rowsChecked} macro-spelled rows over ${i2.uniqueFiles} files, ${i2.uniqueMacroTargets} unique targets → defined in the row's OWN file: ${i2.definedInOwnFileRows} row(s) ${i2.definedInOwnFileRows === 0 ? "(no defect — the in-file macro path is clean on this population)" : "(SUSPECTED DEFECTS, named above)"}`)
  for (const sample of i2.definedInOwnFileSamples.slice(0, 5)) console.log(`  DEFECT CANDIDATE ${sample}`)
}
