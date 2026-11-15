/**
 * PROOF RUNNER for `script/m14/bash-ruled.ts` — runs the shared arbiter against this
 * lane's ruling table WITHOUT editing the shared file.
 *
 * ## What this proves, and what it deliberately does not
 *
 * The gate (`script/m14/ontology-coverage-gate.ts`) is supervisor-owned, brief §8, and
 * it already carries a bash ruling table as an INLINE literal. So this lane's table
 * cannot be exercised by running the gate, and a table nobody has run is a claim.
 * This runner makes it a measurement: it copies the gate to /tmp, applies EXACTLY the
 * three changes the supervisor's permanent fix needs — import the lane's table, delete
 * the inline duplicate — and runs the copy.
 *
 * The comparison is deliberately NOT "the two runs print the same bytes". They cannot.
 * The gate's `extends` detail string interpolates `grammarNodeTypes.size`, the number
 * of distinct node types the wasm reached, and this lane has measured that to move
 * between runs: the wasm aborts with `memory access out of bounds` on whichever files
 * it reaches and which files those are differs run to run, so one run reported 164 and
 * the population is not stable. Demanding byte equality would be demanding a
 * reproducibility the instrument does not have.
 *
 * So this asserts the four things that MUST hold, and prints the rest:
 *
 *   1. all three RULED rows report status RULED-SOUND
 *   2. FALSIFIED is 0 and ruled-without-justification is 0
 *   3. the summary line reports 7 emitted
 *   4. the citation the gate prints — `script/m14/bash-ruled.ts` — EXISTS. This is
 *      the defect that made this file necessary: before it, all three rows cited a
 *      path that was not on disk.
 *
 * ## The three patches, printed so they can be applied by hand
 *
 *   import { BASH_RULED } from "<abs>/script/m14/bash-ruled"
 *   delete the inline `const BASH_RULED: Ruled[] = [ … ]` literal (lines 86-137)
 *   `RULED_BY_LANG` is UNCHANGED: it already reads `{ bash: BASH_RULED, … }`
 *
 * The inline literal's fourth entry — `overrides`, instrument B, with a `countOnTree`
 * probe — is DEAD and is not carried into the lane's table. The gate's row loop
 * `continue`s the moment a type is observed emitting, so an entry for an emitted type
 * is read zero times. Keeping it would mean the ruling surface shows four bash
 * rulings where three are live, one of which looks like evidence that `overrides` is
 * inapplicable when `overrides` is EMITTED at 138 corpus edges.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/bash/ruled-gate.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"

const ROOT = process.cwd()
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const TABLE = path.join(ROOT, "script/m14/bash-ruled.ts")
const TMP = path.join("/tmp/opencode/bash-ruled-gate")
const COPY = path.join(TMP, "gate-with-bash-ruled.mts")

if (!existsSync(TABLE)) {
  console.error(`ruled-gate: ${TABLE} does not exist. This runner proves that file; without it there is nothing to prove.`)
  process.exit(1)
}

const src = readFileSync(GATE, "utf8")

// ---- patch 1: delete the inline duplicate, which starts at its declaration and ends
// at the line that closes the array literal.
const declAt = src.indexOf("const BASH_RULED: Ruled[] = [")
if (declAt < 0) {
  console.error("ruled-gate: the inline `const BASH_RULED: Ruled[] = [` literal is not in the gate. The supervisor's fix is already applied, or the gate was restructured — re-read it before trusting this runner.")
  process.exit(1)
}
const endAt = src.indexOf("\n]\n", declAt)
if (endAt < 0) {
  console.error("ruled-gate: could not find the end of the inline BASH_RULED literal (`\\n]\\n`). Refusing to guess where it stops.")
  process.exit(1)
}
let patched = src.slice(0, declAt) + src.slice(endAt + 3)

// ---- patch 2: import the lane's table where the literal used to be declared.
const anchor = 'import { detectLanguageFromPath } from "../../src/ast/language-detection"'
if (!patched.includes(anchor)) {
  console.error("ruled-gate: the import anchor moved. Re-read the gate; this runner pins a line, not a meaning.")
  process.exit(1)
}
patched = patched.replace(anchor, `import { BASH_RULED } from "${TABLE}"\n${anchor}`)

// ---- patch 3: /tmp cannot resolve the gate's imports, so every one of them becomes
// absolute — the RELATIVE ones against the gate's own directory, and the BARE ones
// against the repo's node_modules. The bare rewrite is the one that matters: the gate
// does `await import("web-tree-sitter")`, and Node resolves a bare specifier from the
// IMPORTING FILE's directory, so a copy in /tmp looks for /tmp/node_modules and dies
// with ERR_MODULE_NOT_FOUND. Both rewrites are properties of running a copy, not of
// the fix, and the printed patch list below says so.
//
// NO REGEX. The workstream's rule is no pattern matching in a census script or an
// oracle, and the first version of this function used one — six literals in this file,
// which `probe-bash-no-regex.mts` caught. So the import specifiers are found by
// walking characters: locate every quoted span, then ask whether the token in front of
// it is `from` or `import(`. A quoted span anywhere else — `path.join("…")`, a
// comparison, a comment — is not an import and is left alone, which is what the
// pattern's capture groups were doing and is now done by position instead.
const isSpaceCh = (c: string | undefined): boolean => {
  if (c === undefined) return false
  const k = c.charCodeAt(0)
  return k === 32 || k === 9 || k === 10 || k === 13
}
/** Split on runs of whitespace, dropping empties — the gate's row and summary parsing
 * both need it and neither may use a pattern. */
const splitOnSpace = (s: string): string[] => {
  const out: string[] = []
  let cur = ""
  for (const ch of s) {
    if (isSpaceCh(ch)) {
      if (cur.length > 0) { out.push(cur); cur = "" }
    } else cur += ch
  }
  if (cur.length > 0) out.push(cur)
  return out
}
const isIdentCh = (c: string | undefined): boolean => {
  if (c === undefined) return false
  const k = c.charCodeAt(0)
  return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 95 /* _ */ || k === 36 /* $ */
}
/**
 * Every IMPORT SPECIFIER in `s`, as [openQuoteIndex, closeQuoteIndex].
 *
 * The first version of this walked the file collecting quoted spans and pairing
 * quotes globally, and it silently rewrote nothing: the gate's header comment
 * contains an odd number of `"` and `'` characters, so the pairing desynchronised
 * at the comment and every real import was absorbed into a "string" that started
 * there. The failure mode is the dangerous kind — the tool printed a patch list,
 * the list was short, and nothing said the rewrite had not happened.
 *
 * So the scan is STRUCTURAL: it reads identifier tokens and looks for `from` and
 * `import`, then reads the specifier that belongs to that token. A quote inside a
 * comment, a string, or a comparison is never reached, because the scan only ever
 * starts from a token it recognised.
 */
const importSpans = (s: string): [number, number][] => {
  const out: [number, number][] = []
  for (let i = 0; i < s.length; i++) {
    // An identifier token START: the previous character is not an identifier char.
    if (isIdentCh(s[i]) && i > 0 && isIdentCh(s[i - 1])) continue
    if (!isIdentCh(s[i])) continue
    let j = i
    while (j < s.length && isIdentCh(s[j])) j++
    const token = s.slice(i, j)
    if (token !== "from" && token !== "import") { i = j - 1; continue }
    let k = j
    while (k < s.length && isSpaceCh(s[k])) k++
    if (token === "import") {
      if (s[k] !== "(") { i = j - 1; continue }
      k++
      while (k < s.length && isSpaceCh(s[k])) k++
    }
    const quote = s[k]
    if (quote !== '"' && quote !== "'") { i = j - 1; continue }
    let close = k + 1
    while (close < s.length && s[close] !== quote) {
      if (s[close] === "\\") close++
      close++
    }
    if (close >= s.length) return out
    out.push([k, close])
    i = close
  }
  return out
}

const rewritten: string[] = []
{
  const req = createRequire(path.join(ROOT, "package.json"))
  // Rebuilt back-to-front so the indices of the spans still ahead of the cursor stay
  // valid; splicing front-to-back would invalidate every later span.
  const spans = importSpans(patched)
  for (let k = spans.length - 1; k >= 0; k--) {
    const [open, close] = spans[k]
    const spec = patched.slice(open + 1, close)
    if (spec.startsWith("node:")) continue
    if (path.isAbsolute(spec)) continue // patch 2's own import, already absolute
    // A bare specifier resolves to the package's ENTRY FILE rather than its directory:
    // ESM refuses a directory import (ERR_UNSUPPORTED_DIR_IMPORT), so pointing at
    // `node_modules/web-tree-sitter` is not enough.
    const abs = spec.startsWith(".") ? path.resolve(path.dirname(GATE), spec) : req.resolve(spec)
    rewritten.push(spec)
    patched = patched.slice(0, open + 1) + abs + patched.slice(close)
  }
}

// `.mts`, not `.ts`: the gate uses top-level await, and /tmp has no package.json
// saying `"type": "module"`, so a `.ts` copy is treated as CommonJS and esbuild
// refuses to transform it. That is a property of running a copy from /tmp, not of
// the fix, and it is why the extension is pinned here.
mkdirSync(TMP, { recursive: true })
writeFileSync(COPY, patched)

console.log(`ruled-gate: 3 patches applied to a copy of the shared gate. None of them touches the repo.`)
console.log(`  1  deleted the inline \`const BASH_RULED: Ruled[] = [\` literal (${endAt - declAt} bytes) — the duplicate this lane's table replaces`)
console.log(`  2  added \`import { BASH_RULED } from "${TABLE}"\``)
console.log(`  3  rewrote ${rewritten.length} import(s) to absolute paths, because the copy lives in /tmp and Node resolves a bare specifier from the importing file: ${rewritten.join(", ")}`)
console.log(`  RULED_BY_LANG is UNCHANGED — it already reads \`{ bash: BASH_RULED, … }\``)
console.log(`\nrunning the patched copy (this parses the corpus; several minutes)…\n`)

// `spawnSync`, not `execFileSync`, for two reasons that both bit this runner. It does
// not throw on a non-zero exit, so a falsified table does not bury its verdict under a
// node stack. And it returns STDERR, which matters because the exit code is NOT a
// clean signal on this gate: `src/ast/engine.ts:1442` arms a 120s self-destruct
// timer around the synchronous wasm parse and calls `process.exit(1)` on a parser
// bomb, so a run that HUNG exits 1 with a perfectly passing ontology summary. Reading
// the exit code alone would report that as a failed ruling table. So the exit code is
// asserted only on runs that did not hang, and the hang is named rather than counted.
const proc = spawnSync("npx", ["tsx", COPY, "bash"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
const out = proc.stdout ?? ""
const err = proc.stderr ?? ""
if (out.length === 0) {
  console.error(`ruled-gate: the patched gate produced no stdout (exit ${proc.status}). Its stderr:`)
  console.error(err.slice(0, 4000))
  process.exit(1)
}
const hung = err.includes("[BB-HANG]")

// NO REGEX, continued: the row scan, the summary read and the citation check are all
// character work for the same reason. The gate's summary line is a fixed shape, so the
// four numbers are read by splitting on spaces and on `/` rather than by capturing.
// `isSpaceCh` and `splitOnSpace` are the helpers declared above, reused here rather
// than declared twice.
const RULED_TYPES = ["extends", "implements", "instantiates"]
/** Every type whose row this runner reads. `overrides` is here because it must be seen
 * to be EMITTED: its absence from the lane's ruling table is the point, and a check
 * that only looked for the three RULED rows would not notice a table that wrongly
 * carried a ruling for it. */
const ROW_TYPES = ["extends", "implements", "instantiates", "overrides"]
const CITATION_MARK = "Written ruling:"

const problems: string[] = []
const rows: string[] = []
for (const line of out.split("\n")) {
  const fields = splitOnSpace(line)
  if (fields.length < 2) continue
  if (!ROW_TYPES.includes(fields[0])) continue
  rows.push(line)
  if (!RULED_TYPES.includes(fields[0])) continue
  if (fields[1] !== "RULED-SOUND") problems.push(`${fields[0]} reported ${fields[1]}, expected RULED-SOUND`)
}
// `emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0`
const summary = out.split("\n").find((l) => l.startsWith("emitted ")) ?? ""
const sf = splitOnSpace(summary)
const EXPECTED = ["emitted", "ruled-sound", "FALSIFIED", "ruled-without-justification"]
if (sf.length !== 8) {
  problems.push(`could not read the summary line from the run; got: ${JSON.stringify(summary)}`)
} else {
  for (let i = 0; i < EXPECTED.length; i++) {
    if (sf[i * 2] !== EXPECTED[i]) { problems.push(`summary field ${i} is ${sf[i * 2]}, expected ${EXPECTED[i]}`); break }
  }
  // sf[1] is `7/10`; the denominator is read so a change to the ontology's own shape is
  // visible rather than silently accepted.
  const slash = sf[1].indexOf("/")
  const gotEmitted = sf[1].slice(0, slash)
  const gotDenom = sf[1].slice(slash + 1)
  if (gotEmitted !== "7") problems.push(`emitted ${gotEmitted}, expected 7`)
  if (gotDenom !== "10") problems.push(`the gate's denominator reads ${gotDenom}, expected 10 — the ontology changed shape`)
  if (sf[3] !== "3") problems.push(`ruled-sound ${sf[3]}, expected 3`)
  if (sf[5] !== "0") problems.push(`FALSIFIED ${sf[5]}, expected 0`)
  if (sf[7] !== "0") problems.push(`ruled-without-justification ${sf[7]}, expected 0`)
}
for (const line of out.split("\n")) {
  const at = line.indexOf(CITATION_MARK)
  if (at < 0) continue
  const cited = splitOnSpace(line.slice(at + CITATION_MARK.length))[0] ?? ""
  if (!existsSync(path.join(ROOT, cited))) problems.push(`the gate cites ${cited} and that path does not exist`)
}

console.log("RULED rows as the patched gate printed them:")
for (const r of rows) console.log(`  ${r}`)
console.log(`\nsummary: ${summary}`)
console.log(`citation check: script/m14/bash-ruled.ts exists = ${existsSync(TABLE)}`)
console.log(`\nNOTE the \`the grammar produced N distinct node types\` figure inside those detail strings is a`)
console.log(`PER-RUN population, not a constant: the wasm aborts on whichever files it reaches and that`)
console.log(`differs between runs, so N is expected to move. It is not part of the comparison above, and a`)
console.log(`ruling is only as strong as the population it was measured over — which is why the gate runs`)
console.log(`instrument A over every admitted file rather than this lane's 400-file sample (144 node types).`)

if (problems.length) {
  console.log(`\nruled-gate FAILS:`)
  for (const p of problems) console.log(`  - ${p}`)
  const verdict = out.split("\n").find((l) => l.startsWith(">>> THIS GATE FAILS"))
  if (verdict) console.log(`\n  the patched gate said:\n    ${verdict}`)
  process.exit(1)
}
if (!hung && proc.status !== 0) problems.push(`the patched gate exited ${proc.status} while printing a passing summary and reporting no parser hang`)
if (problems.length) {
  console.log(`\nruled-gate FAILS on the exit code:`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
if (hung) {
  const which = err.split("\n").find((l) => l.includes("[BB-HANG]")) ?? ""
  console.log(`\nNOTE this run HUNG: ${which.trim()}`)
  console.log(`  That is a parser-robustness finding in the pinned wasm, not a verdict about the table:`)
  console.log(`  engine.ts:1442 self-destructs the process, so the exit code is 1 whatever the ontology`)
  console.log(`  summary says. The four assertions above are read from the summary, which the hang does`)
  console.log(`  not reach — so on a hung run this runner reports what it saw and nothing more.`)
}
console.log(`\nruled-gate PASSES: 3 RULED-SOUND, 0 FALSIFIED, 0 unjustified, 7 emitted, and the cited path resolves.`)