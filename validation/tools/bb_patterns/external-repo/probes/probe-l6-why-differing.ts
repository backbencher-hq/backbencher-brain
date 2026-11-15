// Is the reason-list ORDER the only difference between the two dumps?
//
// The canonical dumps of every finding across ten repositories differ on 664
// lines. Every one examined so far differs only in the order of the parenthetical
// reason list inside "REFUSED EVIDENCE: N row(s) ... (a, b)" — the old code took
// the order SQLite happened to return rows in, the new code takes the gate's own
// precedence, which is both stable between runs and consistent with the order the
// gate tests the conditions.
//
// "Every one examined so far" is not a proof, so this checks all of them: it
// normalises the reason list in both sides and requires the corpora to become
// byte-identical. If anything else differs, this reports it rather than the
// normalised counts matching by coincidence.
//
// A weaker version of this check — comparing counts of findings, or comparing a
// sample — is what let a mutant that mislabelled every construction report
// CLEAN, and what let this rewrite's first version pass while deleting a whole
// disclosure.

import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const beforeDir = process.argv[2]
const afterDir = process.argv[3]

/** Sort the parenthetical reason list in "REFUSED EVIDENCE: N row(s) ... (a, b)". */
function normaliseReasons(line: string): string {
  return line.replace(/\(([a-zA-Z]+(?:, [a-zA-Z]+)+)\)\. A row like that/, (_m, list: string) => {
    const sorted = list.split(", ").sort().join(", ")
    return `(${sorted}). A row like that`
  })
}

let totalLines = 0
let totalDiffering = 0
const residual: string[] = []

for (const file of readdirSync(beforeDir).sort()) {
  const a = readFileSync(path.join(beforeDir, file), "utf8").split("\n")
  const b = readFileSync(path.join(afterDir, file), "utf8").split("\n")
  if (a.length !== b.length) {
    residual.push(`${file}: LINE COUNT ${a.length} -> ${b.length}`)
    continue
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    totalLines++
    if (a[i] === b[i]) continue
    diff++
    totalDiffering++
    if (normaliseReasons(a[i]) !== normaliseReasons(b[i])) {
      // Find the first differing character so the report names a place, not a
      // whole finding.
      let j = 0
      while (j < a[i].length && j < b[i].length && a[i][j] === b[i][j]) j++
      residual.push(
        `${file} line ${i + 1}: differs beyond the reason order, at char ${j}\n` +
          `    old: ...${a[i].slice(Math.max(0, j - 60), j + 90)}\n` +
          `    new: ...${b[i].slice(Math.max(0, j - 60), j + 90)}`,
      )
    }
  }
  console.log(`${file.padEnd(16)} lines=${String(a.length).padStart(6)}  differing=${String(diff).padStart(5)}`)
}

console.log(`\n${totalLines} findings compared, ${totalDiffering} differ before normalising the reason order.`)
if (residual.length === 0) {
  console.log("After sorting the reason list, the two dumps are BYTE-IDENTICAL.")
  console.log("So the rewrite changed exactly one thing: the reason list is now in the gate's own")
  console.log("precedence instead of in whatever order SQLite returned rows, which is what the")
  console.log("comment in the code always claimed and only now actually does.")
  process.exit(0)
}
console.log(`\n${residual.length} difference(s) that are NOT reason ordering:`)
for (const r of residual.slice(0, 12)) console.log(`  ${r}`)
process.exit(1)
