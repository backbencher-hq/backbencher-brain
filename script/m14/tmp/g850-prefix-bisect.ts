// Prefix bisection: for a failing .gradle file, find the smallest line count N
// at which the parse first produces an error. That N is the trigger.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const file = process.argv[2]

async function errsFor(src: string): Promise<number> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const root = parser.parse(src)?.rootNode
  if (!root) return 0
  let n = 0
  const walk = (x: any): void => {
    if (x.type === "ERROR" || x.isMissing) n++
    for (let i = 0; i < x.childCount; i++) walk(x.child(i))
  }
  walk(root)
  return n
}

async function main(): Promise<void> {
  const src = readFileSync(`${REPO}/${file}`, "utf8")
  const lines = src.split("\n")
  console.log(`file: ${file}  (${lines.length} lines), full errors=${await errsFor(src)}`)
  let firstBad = -1
  for (let n = 1; n <= lines.length; n++) {
    const e = await errsFor(lines.slice(0, n).join("\n"))
    if (e > 0) {
      firstBad = n
      break
    }
  }
  console.log(`first prefix with an error: ${firstBad}`)
  if (firstBad > 0) {
    for (let i = Math.max(0, firstBad - 4); i < Math.min(lines.length, firstBad + 3); i++) {
      console.log(`  ${i === firstBad - 1 ? ">" : " "} ${i + 1}: ${lines[i]}`)
    }
    // minimal reproduction: prefix up to firstBad, then trim leading lines
    const n = firstBad
    for (let start = 0; start < n; start++) {
      const e = await errsFor(lines.slice(start, n).join("\n"))
      if (e === 0) {
        console.log(`\nminimal window: lines ${start + 1}..${n}`)
        for (let i = start; i < n; i++) console.log(`   ${i + 1}: ${lines[i]}`)
        break
      }
    }
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
