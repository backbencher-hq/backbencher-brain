// Controls for the DECLARED_SIGNATURE exemption in filterNoiseRelationships.
// A proof without controls is a report: each kept row is paired with the same
// shape NOT declared, which must still be refused.
import { filterNoiseRelationships } from "../../../src/ast/pool-worker"

const rel = (target: string, type = "references") => ({
  source: "src", target, type, confidence: 1, line_number: 1, metadata: {},
})
const cases: [string, string, string, boolean][] = [
  ["declared signature", "references", "balance()", true],
  ["same shape, NOT declared", "references", "balance()", false],
  ["declared signature, contains", "contains", "balance()", true],
  ["declared, with args", "references", "f(a, b)", false],
  ["declared, with space", "references", "f (a)", false],
  ["declared, one arg", "references", "f(a)", false],
  ["declared plain name", "references", "balance", true],
  ["undeclared plain name", "references", "other", true],
]
let bad = 0
for (const [label, type, target, declared] of cases) {
  const declaredNames = declared ? new Set([target]) : new Set<string>()
  const kept = filterNoiseRelationships([rel(target, type)], "solidity", declaredNames).length === 1
  const ok = kept === declared
  if (!ok) bad++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(28)} ${type} -> ${target.padEnd(12)} kept=${kept} want=${declared}`)
}
console.log(bad === 0 ? "CONTROLS GREEN" : `CONTROLS RED (${bad})`)
process.exit(bad === 0 ? 0 : 1)
