/**
 * COVERAGE-DERIVATION PROOF — the board's `implemented / applicable` column, planted.
 *
 * A column derived from specs is worth exactly as much as its behaviour on the cases that are
 * NOT the happy path, and this programme has paid for that lesson: three dart FORBID rows were
 * inert after a separator move, and a probe that cannot fire returns the same number as a clean
 * one. So the board is run against four PLANTED specs (`planted-specs/`) and each must render
 * DISTINCTLY, with the arithmetic auditable in the row:
 *
 *   A  a grammar-absence ruling        -> label excluded with class `grammar-absence`, applicable 9
 *   B  a zero-sites ruling             -> label excluded with class `zero-sites`, and it STAYS in
 *                                         the denominator (applicable 10), which is the whole
 *                                         difference between the two classes
 *   C  an unexercised type             -> implemented + corpus-unexercised === applicable, with the
 *                                         unexercised list non-empty and named
 *   D  a spec with NO coverage field   -> `not declared` (never `none`, never 0), and `implemented`
 *                                         still derives from the firing log alone
 *
 * The board is read-only and takes its spec directory from `BB_BOARD_SPEC_DIR`, so the proof
 * points it at the planted directory instead of editing anything. Exit 1 if a case renders
 * indistinctly.
 */
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(new URL("../../../../", import.meta.url).pathname)
const out = execFileSync("npx", ["tsx", "script/m14/language-board.ts", "--json"], {
  cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, BB_BOARD_SPEC_DIR: "validation/m14/census/board-derivation/planted-specs" },
})
const doc = JSON.parse(out)
const lane = (l: string) => doc.lanes.find((x: any) => x.lane === l)

const fails: string[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "OK  " : "MISS"}  ${name}\n        ${detail}`)
  if (!ok) fails.push(name)
}
const ex = (l: string, label: string) => (lane(l)?.coverage.excluded ?? []).find((x: any) => x.label === label)

// A — grammar-absence leaves the denominator
const A = ex("json", "implements")
check("A grammar-absence ruling is excluded AND classified, and it leaves the denominator",
  A?.evidence === "grammar-absence" && lane("json").coverage.applicable === 9,
  `excluded=${JSON.stringify(A)} applicable=${lane("json").coverage.applicable} (want 9)`)

// B — zero-sites is classified too, and STAYS in the denominator
const B = ex("php", "imports")
check("B zero-sites ruling is excluded from the DENOMINATOR's subtraction but classified `zero-sites`",
  B?.evidence === "zero-sites" && lane("php").coverage.applicable === 10,
  `excluded=${JSON.stringify(B)} applicable=${lane("php").coverage.applicable} (want 10: zero-sites stays IN)`)

// C — the unexercised remainder is named and the arithmetic closes
const C = lane("lua").coverage
check("C corpus-unexercised is named and implemented + unexercised === applicable",
  Array.isArray(C.corpusUnexercised) && C.corpusUnexercised.length > 0 && C.implemented.length + C.corpusUnexercised.length === C.applicable,
  `implemented=${JSON.stringify(C.implemented)} unexercised=${JSON.stringify(C.corpusUnexercised)} applicable=${C.applicable}`)

// D — a missing field is `not declared`, not `none`, and not 0
const D = lane("fsharp").coverage
check("D a spec with no coverage field reads `not declared` (never `none`/0) and still derives implemented from the log",
  D.coverageDeclared === false && D.excluded.length === 0 && Array.isArray(D.implemented) && D.implemented.length > 0,
  `coverageDeclared=${D.coverageDeclared} excluded=${JSON.stringify(D.excluded)} implementedFrom=${D.implementedFrom} implemented=${D.implemented.length}`)

// the four states must be DISTINCT from one another
check("the four cases render distinctly (A G, B 0, C list, D not-declared)",
  A?.evidence !== B?.evidence && D.coverageDeclared === false && C.corpusUnexercised.length > 0,
  `A=${A?.evidence} B=${B?.evidence} C-unexercised=${C.corpusUnexercised.length} D-declared=${D.coverageDeclared}`)

console.log(``)
if (fails.length) { console.error(`${fails.length} case(s) rendered indistinctly — the column is not trustworthy.`); process.exit(1) }
console.log(`all four planted cases render distinctly and the arithmetic closes.`)
