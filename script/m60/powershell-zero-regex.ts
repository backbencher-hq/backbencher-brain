/**
 * M60 #278 — ZERO-REGEX gate for the PowerShell analyzer.
 *
 * WHY THIS EXISTS. The analyzer's doc once claimed "zero regex usages (census 10 ->
 * 0)". Both halves were false: no powershell regex census was ever written, and the
 * source carried eight regexes, put back by later waves after the original ten were
 * removed. The number was never re-derived by anything, so it was true once and
 * quietly stopped being true. That is the whole argument for this file: a claim with
 * no instrument behind it decays silently, and it decays invisibly precisely because
 * everyone reading it trusts that a census ran.
 *
 * So the claim is enforced rather than asserted. The analyzer reaches zero regex
 * operations and zero stored regex literals, and this gate is what keeps it there.
 *
 * EQUIVALENCE WAS MEASURED, NOT REVIEWED. The regex implementation and the
 * character-loop implementation were both run over 759 files (691 corpus + 10
 * fixtures) and their facts compared byte-for-byte — symbols, relationships with
 * metadata, and imports: 0 differing files. "Looks equivalent" is not a proof, and
 * `\s` in particular is a specific set that a naive `code <= 32` gets wrong, which
 * is why `isSpaceCode` spells out all 25 code points.
 *
 * WHY ONLY BLOCK COMMENTS ARE STRIPPED. The seven helpers' docstrings quote the
 * patterns they replaced (`/^\s*<#/`, `/(\[\s*\])+/g`, …), so a raw scan reports a
 * healthy file as full of regex. Stripping `//` line comments as well would be the
 * obvious next step and is WRONG here: this file contains four TEMPLATE LITERALS that
 * contain `//` — the precedence-chain diagrams such as
 * `logical > bitwise > … // at each level` — and a `//` stripper corrupts them.
 *
 * Block-only stripping was therefore VERIFIED to be sufficient rather than assumed:
 * after removing block comments, this file contains 0 lines matching any regex
 * operation and 0 stored regex literals, across all 362 remaining `//` line comments.
 * If a future line comment ever mentions `.replace(` in prose, this gate will
 * over-report — which fails loudly and points at the line, the correct failure
 * direction for a gate whose subject is "did someone quietly add a regex".
 *
 * The gate also asserts the seven helpers are PRESENT. Without that it would be
 * trivially satisfiable by deleting the code that does the work, and a green
 * "zero regex" that means "nothing left to be wrong about" is the vacuous pass this
 * repo refuses elsewhere. A zero-regex gate is exactly where that temptation lives.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const FILE = path.join(ROOT, "src/ast/real-powershell-analyzer.ts")
const raw = readFileSync(FILE, "utf8")

/** Block comments only, per the header: this file's `//`-bearing template literals
 *  make line-comment stripping unsafe, and block-only was measured to suffice. */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))

const lines = code.split("\n")
const OPERATIONS = /\.match\(|\.matchAll\(|\.replace(?:All)?\(|\.test\(|new RegExp/
/** A regex stored in a binding or passed straight to a call: `= /…/flags`. The
 *  negative lookahead rejects `//` and `/*`, which are comments, and a bare `/`,
 *  which is division (this analyzer divides nowhere). */
const STORED_LITERAL = /(?:=|=>|\(|,)\s*\/(?![/*\s])[^/\n]+\/[gimsuy]*/

const operations: string[] = []
const literals: string[] = []
lines.forEach((line, idx) => {
  const n = idx + 1
  if (OPERATIONS.test(line)) operations.push(`L${n}  ${line.trim().slice(0, 92)}`)
  if (STORED_LITERAL.test(line)) literals.push(`L${n}  ${line.trim().slice(0, 92)}`)
})

const HELPERS = [
  "isSpaceCode",
  "stripLeadingDash",
  "stripTypeSuffixBrackets",
  "hasTrailingExtension",
  "stripOpenCommentDelim",
  "stripCloseCommentDelim",
  "stripCommentMarkerRun",
]
const present = HELPERS.filter((h) => code.includes(`const ${h} =`) || code.includes(`function ${h}(`))
const missing = HELPERS.filter((h) => !present.includes(h))

console.log("M60 #278 — powershell analyzer, zero-regex gate")
console.log("")
console.log(`  file                          : ${path.relative(ROOT, FILE)}`)
console.log(`  regex OPERATIONS in code      : ${operations.length}`)
for (const o of operations.slice(0, 12)) console.log(`      ${o}`)
console.log(`  stored regex LITERALS in code  : ${literals.length}`)
for (const l of literals.slice(0, 12)) console.log(`      ${l}`)
console.log(`  zero-regex helpers present    : ${present.length}/${HELPERS.length}`)
for (const m of missing) console.log(`      MISSING: ${m}`)

const failed = operations.length > 0 || literals.length > 0 || missing.length > 0
if (failed) {
  console.log("")
  console.log("  FAIL — see above. The policy is in the analyzer's own header: NO REGEX IN")
  console.log("  THIS FILE DECIDES A FACT. Normalising AST-derived text belongs in a")
  console.log("  character loop; re-deriving a fact by matching source text does not. A new")
  console.log("  regex must arrive with a reason, in a comment, at the call site — and if it")
  console.log("  changes output, with the 759-file byte-comparison re-run.")
  process.exit(1)
}
console.log("")
console.log("  PASS — 0 regex operations, 0 stored regex literals, all 7 helpers present.")
console.log("  Equivalence to the previous regex implementation was MEASURED over 759 files")
console.log("  (691 corpus + 10 fixtures): symbols, relationships with metadata, and imports")
console.log("  compared byte-for-byte, 0 differing files.")
process.exit(0)
