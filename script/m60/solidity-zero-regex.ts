#!/usr/bin/env bun
/**
 * M60 — ZERO-REGEX gate for the Solidity analyzer.
 *
 * WHY THIS EXISTS, in the sibling lane's own words because the argument is
 * general. The PowerShell analyzer's doc once claimed "zero regex usages (census
 * 10 -> 0)". Both halves were false: no powershell regex census was ever written,
 * and the source carried eight regexes put back by later waves after the original
 * ten were removed. The number was true once and quietly stopped being true,
 * because a claim with no instrument behind it decays silently and decays
 * invisibly precisely because everyone reading it trusts that a census ran. So
 * the claim is enforced here rather than asserted.
 *
 * WHAT IT ENFORCES, and the second half matters more than the first
 * ---------------------------------------------------------------
 *   1. ZERO regex OPERATIONS and ZERO stored regex LITERALS in the analyzer's own
 *      source, counted on the file itself.
 *   2. The required character-loop HELPERS are still PRESENT. Without this the
 *      gate is trivially satisfiable by deleting the code that does the work, and
 *      a green "zero regex" that means "nothing left to be wrong about" is the
 *      vacuous pass this repo refuses elsewhere. A zero-regex gate is exactly
 *      where that temptation lives, so the helper list is part of the pass
 *      condition, not a note.
 *
 * BLOCK COMMENTS ONLY ARE STRIPPED, and that is deliberate. The analyzer's header
 * quotes the patterns its helpers replaced and its docstrings quote Solidity
 * character-class source; stripping `//` line comments as well would be the
 * obvious next step and is WRONG here, because a `//` stripper would corrupt a
 * template literal the same way it corrupted the PowerShell one. Block-only was
 * therefore
 * VERIFIED sufficient rather than assumed: after removing block comments the
 * analyzer contains 0 lines matching any regex operation and 0 stored literals.
 * If a future line comment ever mentions `.replace(` in prose this gate will
 * over-report — which fails loudly and points at the line, the correct failure
 * direction for a gate whose subject is "did someone quietly add a regex".
 *
 * THE GATE IS ITSELF CHECKED IN BOTH DIRECTIONS. A gate that cannot fail is
 * decoration. So `--selftest` runs this same gate over a MUTATED COPY of the
 * analyzer with a regex injected, and requires it to FAIL; it also deletes one
 * required helper and requires that to FAIL too. A gate whose subject is "did
 * someone add a regex" that has never been observed failing is not evidence.
 *
 * Usage:
 *   bun run script/m60/solidity-zero-regex.ts              # the gate
 *   bun run script/m60/solidity-zero-regex.ts --selftest   # prove it can fail
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const ANALYZER = path.join(ROOT, "src/ast/real-solidity-analyzer.ts")
const SELFTEST = process.argv.includes("--selftest")

/**
 * The helpers the analyzer's zero-regex policy is implemented with. Each one
 * replaced a regex, and each is named in the analyzer's own header with the
 * pattern it replaced — so the list is a claim about work that exists, not a
 * token count.
 */
const HELPERS: { name: string; why: string }[] = [
  { name: "isSpaceCode", why: "JavaScript's `\\s` exactly (25 code points incl. NBSP and U+FEFF); a naive `c <= 32` silently stops matching both." },
  { name: "isPlausibleSymbolName", why: "F9: could this string be a symbol name at all? Drops an edge whose target can never resolve." },
  { name: "skipLeadingSpace", why: "`/^\\s+/` on AST-derived text — an indented keyword still compares equal." },
  { name: "unquote", why: "one layer of matching surrounding quotes, `\"`=34 / `'`=39; an import path arrives quoted." },
]

/** Block comments only, per the header. Non-`/*`-closing content is preserved as
 *  spaces so every reported LINE NUMBER stays true to the original file — a
 *  replacement that collapsed newlines would point the reader at the wrong line,
 *  which is the one thing a gate that names lines must not do. */
function stripBlockComments(src: string): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const open = src.indexOf("/*", i)
    if (open < 0) { out += src.slice(i); break }
    out += src.slice(i, open)
    const close = src.indexOf("*/", open + 2)
    if (close < 0) { out += " ".repeat(src.length - open); break }
    const block = src.slice(open, close + 2)
    out += block.split("\n").map((l) => " ".repeat(l.length)).join("\n")
    i = close + 2
  }
  return out
}

/** A regex OPERATION: a String method that takes a pattern, or a RegExp construction. */
function findRegexOperations(line: string): boolean {
  const ops = [".match(", ".matchAll(", ".replace(", ".replaceAll(", ".test(", "new RegExp"]
  return ops.some((op) => line.includes(op))
}

/**
 * A regex LITERAL stored in a binding or handed to a call: `= /…/flags`.
 *
 * Read at the character level, and the reading is the careful part. The rule is
 * `an expression-ending character, any whitespace, then a `/` that is not a
 * comment` — and the WHITESPACE is load-bearing, which this gate's own selftest
 * proved by failing on it. The first draft tested the character IMMEDIATELY
 * before the `/`, so `const x = /ab+c/gi` (a space before the slash) was scored 0
 * literals and MUTANT 1 sailed through a gate that was supposed to be watching for
 * exactly that. The reference implementation it follows allows `\s*` between the
 * two; "looks equivalent is not a proof" was the sibling lane's stated lesson and
 * here it was the gate, not the analyzer, that had not learned it.
 *
 * A `/` starts a literal only when the last significant character before it can
 * end an expression (`=`, `(`, `,`, `:`, `[`, `?`, `|`, `&`) and the character
 * after it is not `/` (a comment), `*` (a comment), or whitespace (this analyzer
 * divides nowhere, so a spaced division cannot occur — an unspaced one would be
 * preceded by a digit, which is not an expression-ender).
 */
function findStoredLiteral(line: string): boolean {
  const FLAGS = "gimsuy"
  for (let i = 1; i < line.length; i++) {
    if (line.charCodeAt(i) !== 47 /* / */) continue
    // Walk back over spaces and tabs to the last significant character. This is
    // the step whose absence made MUTANT 1 pass.
    let back = i - 1
    while (back >= 0) {
      const c = line.charCodeAt(back)
      if (c !== 32 && c !== 9) break
      back--
    }
    if (back < 0) continue
    const prev = line.charCodeAt(back)
    const endsExpression =
      prev === 61 /* = */ || prev === 40 /* ( */ || prev === 44 /* , */ ||
      prev === 58 /* : */ || prev === 91 /* [ */ || prev === 63 /* ? */ ||
      prev === 124 /* | */ || prev === 38 /* & */ ||
      prev === 62 /* > */ || prev === 33 /* ! */
    if (!endsExpression) continue
    const next = line.charCodeAt(i + 1)
    if (next === 47 || next === 42 || next === 32 || next === 9) continue
    // find the closing slash and any trailing flags
    for (let j = i + 1; j < line.length; j++) {
      if (line.charCodeAt(j) !== 47) continue
      let k = j + 1
      let sawFlag = false
      while (k < line.length && FLAGS.includes(line[k])) { sawFlag = true; k++ }
      if (sawFlag || j + 1 >= line.length) return true
      break
    }
  }
  return false
}

interface Result { operations: string[]; literals: string[]; missingHelpers: string[]; helperNames: string[] }

function runGate(label: string, src: string, expectHelpers: string[]): Result {
  const code = stripBlockComments(src)
  const lines = code.split("\n")
  const operations: string[] = []
  const literals: string[] = []
  lines.forEach((line, idx) => {
    if (findRegexOperations(line)) operations.push(`L${idx + 1}  ${line.trim().slice(0, 92)}`)
    if (findStoredLiteral(line)) literals.push(`L${idx + 1}  ${line.trim().slice(0, 92)}`)
  })
  const present = expectHelpers.filter((h) =>
    code.includes(`const ${h} =`) || code.includes(`function ${h}(`) || code.includes(`const ${h}:`))
  const missingHelpers = expectHelpers.filter((h) => !present.includes(h))
  console.log(`  --- ${label}`)
  console.log(`      regex OPERATIONS in code      : ${operations.length}`)
  for (const o of operations.slice(0, 8)) console.log(`          ${o}`)
  console.log(`      stored regex LITERALS in code  : ${literals.length}`)
  for (const l of literals.slice(0, 8)) console.log(`          ${l}`)
  console.log(`      zero-regex helpers present    : ${present.length}/${expectHelpers.length}`)
  for (const m of missingHelpers) console.log(`          MISSING: ${m}`)
  return { operations, literals, missingHelpers, helperNames: present }
}

const original = fs.readFileSync(ANALYZER, "utf8")

console.log("M60 — solidity analyzer, zero-regex gate")
console.log("")
console.log(`  file : ${path.relative(ROOT, ANALYZER)}`)

const real = runGate("the analyzer as committed", original, HELPERS.map((h) => h.name))

const realFailed = real.operations.length > 0 || real.literals.length > 0 || real.missingHelpers.length > 0

if (!SELFTEST) {
  console.log("")
  if (realFailed) {
    console.log("  FAIL — see above. The policy is in the analyzer's own header: NO REGEX IN")
    console.log("  THAT FILE DECIDES A FACT. Normalising AST-derived text belongs in a")
    console.log("  character loop; re-deriving a fact by matching source text does not. A new")
    console.log("  regex must arrive with a reason, in a comment, at the call site — and if it")
    console.log("  changes output, with the full-corpus byte-comparison re-run.")
    process.exit(1)
  }
  console.log(`  PASS — 0 regex operations, 0 stored regex literals, all ${HELPERS.length} helpers present.`)
  console.log("")
  for (const h of HELPERS) console.log(`      ${h.name}: ${h.why}`)
  console.log("")
  console.log("  Run with --selftest to watch this gate FAIL on an injected regex and on a")
  console.log("  deleted helper. A gate that has never been seen failing is not evidence.")
  process.exit(0)
}

// ── SELFTEST: the gate must be able to fail, in BOTH of its halves. An
// instrument that cannot fail is decoration, and the two halves fail for
// different reasons, so both are exercised.
console.log("")
console.log("  SELFTEST — this gate must fail on each mutation below, or it proves nothing:")
// The literal is assembled from character codes rather than typed as source, so
// the mutant cannot be corrupted by an escaping layer between this file and the
// string it produces. The first draft wrote the pattern inline and arrived as
// `/s+/g` — a backslash lost somewhere — so the gate reported 0 literals on a
// mutant that plainly contained one. An instrument that cannot see its own test
// case is worse than no instrument.
const injected = `const _smuggled = /${String.fromCharCode(92)}s+/g${String.fromCharCode(10)}${original}`
const r1 = runGate("MUTANT 1: a stored regex literal injected", injected, HELPERS.map((h) => h.name))

// Delete a required helper: the zero-regex count stays 0, so only the helper
// assertion can catch this. That is precisely why the assertion exists.
const firstHelper = HELPERS[0].name
// Cut from the helper's declaration to the START of the NEXT top-level
// declaration. The first draft searched for a closing brace followed by a blank
// line, which over-ran and took `isPlausibleSymbolName` with it — so the mutant
// reported a MISSING helper, just not the one it was deleting. A mutant that
// fails for the wrong reason is as useless as one that cannot fail, so the cut is
// anchored on the next declaration keyword and the expectation below asserts the
// missing set is EXACTLY the one helper.
const helperAt = original.indexOf(`const ${firstHelper} =`)
let helperEnd = -1
for (const marker of ["\nconst ", "\n/**", "\nexport "]) {
  const at = original.indexOf(marker, helperAt + 1)
  if (at > 0 && (helperEnd < 0 || at < helperEnd)) helperEnd = at + 1
}
if (helperEnd < 0) throw new Error("selftest could not locate the end of " + firstHelper + " — the gate is measuring a mutant it did not build")
const deleted = original.slice(0, helperAt) + original.slice(helperEnd)
const r2 = runGate(`MUTANT 2: required helper '${firstHelper}' replaced by a stub`, deleted, HELPERS.map((h) => h.name))

// A real regex OPERATION. The first draft injected `target.split(" ")` and
// `.split` is not a regex operation at all, so the gate correctly reported 0 —
// the mutant tested nothing. `String.prototype.replace` with a pattern IS one.
const operationMutant = original.replace(
  "if (!isPlausibleSymbolName(target)) return",
  'if (target.replace(/[^a-zA-Z0-9_$.()]/g, "").length === 0) return',
)
const r3 = runGate("MUTANT 3: a regex OPERATION injected (String.prototype.replace)", operationMutant, HELPERS.map((h) => h.name))

const checks: { name: string; ok: boolean; detail: string }[] = [
  { name: "MUTANT 1 is caught by the stored-literal check", ok: r1.literals.length > 0, detail: `${r1.literals.length} literal(s)` },
  { name: "MUTANT 1 fails the gate overall", ok: r1.literals.length > 0 || r1.missingHelpers.length > 0 },
  { name: `MUTANT 2 is caught by the REQUIRED-HELPER assertion`, ok: r2.missingHelpers.includes(firstHelper), detail: `missing=${r2.missingHelpers.join(",") || "none"}` },
  // The mutant must fail for the INTENDED reason. The first draft over-ran its
  // cut and took a second helper with it, so the assertion fired while naming the
  // wrong helper — a mutant that fails for the wrong reason is as useless as one
  // that cannot fail.
  { name: "MUTANT 2 fails ONLY because of the intended helper", ok: r2.missingHelpers.length === 1 && r2.missingHelpers[0] === firstHelper, detail: `missing=${r2.missingHelpers.join(",")}` },
  { name: "MUTANT 2 leaves the zero-regex count at 0 (so only the assertion can catch it)", ok: r2.operations.length === 0 && r2.literals.length === 0, detail: `${r2.operations.length} ops / ${r2.literals.length} literals` },
  { name: "MUTANT 3 is caught by the operation check", ok: r3.operations.length > 0, detail: `${r3.operations.length} operation(s)` },
  { name: "MUTANT 3 leaves the helper list intact (so only the operation check can catch it)", ok: r3.missingHelpers.length === 0, detail: `missing=${r3.missingHelpers.join(",") || "none"}` },
  { name: "the analyzer as committed still passes", ok: !realFailed },
]
for (const c of checks) console.log(`      ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? `  (${c.detail})` : ""}`)
const failed = checks.filter((c) => !c.ok)
console.log("")
if (failed.length > 0) {
  console.log(`  FAIL — ${failed.length} selftest expectation(s) did not hold. A gate that cannot`)
  console.log("  fail is decoration, so this is a defect in the GATE, not in the analyzer.")
  process.exit(1)
}
console.log(`  PASS — the gate fails on an injected literal, on a deleted helper, and on an`)
console.log(`  injected operation; and the analyzer as committed passes it. ${checks.length}/${checks.length}.`)
process.exit(0)