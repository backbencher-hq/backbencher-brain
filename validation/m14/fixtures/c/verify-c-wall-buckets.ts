/**
 * verify-c-wall-buckets — DOES THE WALL PAGE'S BUCKET TABLE STILL ADD UP?
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY.
 *
 * THE QUESTION. `C-HEADER-WALL-BUCKETS.md` prices the header wall into buckets and says they sum to
 * **232,676 EXACTLY**. A page that says "exactly" and cannot be checked is a promise, not a price.
 * This verifier reads the artifact the buckets were derived from
 * (`validation/m14/fixtures/c/measurements/c-header-impact.json`) and re-derives every cell, then
 * checks the sum.
 *
 * IT EXITS NON-ZERO IF THE PAGE AND THE ARTIFACT DISAGREE, so it is a gate on the page, not a
 * commentary on it. Run it after any edit to the page or the artifact.
 *
 *   bun run validation/m14/fixtures/c/verify-c-wall-buckets.ts
 */
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"

/** the repository root — the nearest ancestor holding a `package.json`. */
function repoRoot(): string {
  let dir = path.resolve(import.meta.dirname ?? ".")
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}
const ROOT = repoRoot()
const ARTIFACT = path.join(ROOT, "validation/m14/fixtures/c/measurements/c-header-impact.json")
const LEDGER_WALL = 232_676

const art = JSON.parse(readFileSync(ARTIFACT, "utf8"))
const byLabel = art.byLabel as Array<Record<string, any>>

const sum = (k: string): number => byLabel.reduce((a, x) => a + (x[k] ?? 0), 0)

const globalToken = sum("globalTokenRows")
const sameRepoToken = sum("sameRepoTokenRows")
const strong = sum("strongDeclaredRows")
const weak = sum("weakTokenRows")
const foreign = globalToken - sameRepoToken

// the five measured buckets, over the whole frame
const A = sum("unresolvedUnique") // same-repo DECLARED, exactly one entry, unresolved
const B = sum("unresolvedMany") // same-repo DECLARED, many entries, unresolved
const C = sum("ambiguousDeclaredRows") // same-repo DECLARED, ambiguous
const D = weak // same-repo header TOKEN only, no declaration shape
const E = foreign // token only in ANOTHER repository's header
const K1 = 5 // the pre-K1 rows the ledger's figure carries

let failed = 0
const check = (name: string, got: number, want: number): void => {
  const ok = got === want
  if (!ok) failed++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${got} ${ok ? "=" : "!="} ${want}`)
}

console.log("verify-c-wall-buckets — the page's table, re-derived from the artifact")
console.log(`  artifact: ${path.relative(ROOT, ARTIFACT)}`)
console.log(`  artifact dump: ${art.dump}`)
console.log("")

console.log("  the measured cells (the artifact's own per-label sums)")
check("global header-token rows", globalToken, 232_671)
check("same-repo header-token rows", sameRepoToken, 216_261)
check("  of which header-DECLARED (strong)", strong, 163_978)
check("  of which header TOKEN only (weak)", D, 52_283)
check("foreign-only header-token rows", E, 16_410)
check("strong + weak == same-repo", strong + D, sameRepoToken)
check("same-repo + foreign == global", sameRepoToken + E, globalToken)
console.log("")

console.log("  the five buckets, and the frame they partition")
check("A  would RESOLVE (declared, one entry, unresolved)", A, 57_817)
check("B  stays UNRESOLVED (declared, many entries)", B, 49_673)
check("C  stays AMBIGUOUS (declared, ambiguous)", C, 56_488)
check("D  no declaration shape (token only)", D, 52_283)
check("E  foreign-only (RULED)", E, 16_410)
check("A+B+C == the same-repo DECLARED rows", A + B + C, strong)
check("A+B+C+D+E == the measured global wall", A + B + C + D + E, globalToken)
console.log("")

console.log("  THE TWO PRICES, EACH NAMED WITH THE INSTRUMENT THAT PRODUCED IT")
// THE POST-K1 PRICE — the I1 instrument AFTER the K1 correction (it reads the analyzer's exact
// C_KEYWORDS, `_Static_assert` included, so a call to a keyword is not a header-token row). F = 0,
// because the five rows are NOT IN THE PROBE's PRICED ROW SET AT ALL: the probe's own per-row dump
// holds no `_Static_assert` row (its keyword rule excludes them), and the artifact's own controls
// record the same fact — c2_tokenControl reads 232,671 and c1_rowFrame reads 269,671 with
// ledgerDelta 5 ("the ledger's 269,676 vs the lane artifact's 269,671 is the 5-row K1 correction").
check("POST-K1: A+B+C+D+E == 232,671 (F = 0)", A + B + C + D + E, 232_671)
check("POST-K1: the artifact's own c2_tokenControl", art.controls?.c2_tokenControl?.got ?? -1, 232_671)
check("POST-K1: the artifact's own c1_rowFrame", art.controls?.c1_rowFrame?.got ?? -1, 269_671)
check("POST-K1: the artifact's own c1_rowFrame ledgerDelta", art.controls?.c1_rowFrame?.ledgerDelta ?? -1, 5)
// THE PRE-K1 PRICE — the SAME instrument BEFORE the K1 correction (its family classifier used a
// keyword copy missing the underscore keywords). THIS IS THE LEDGER's FIGURE and the price the
// brief asks for; its F line is the five rows, NAMED and NOT ABSORBED into a neighbour.
check("PRE-K1: A+B+C+D+E+F == the ledger's wall", A + B + C + D + E + K1, LEDGER_WALL)
console.log(`      (F = ${K1} the K1-correction rows the ledger's PRE-correction figure carries)`)
console.log("")

console.log(failed === 0 ? "ALL CHECKS PASS" : `${failed} CHECK(S) FAILED — the page and the artifact disagree`)
process.exit(failed === 0 ? 0 : 1)
