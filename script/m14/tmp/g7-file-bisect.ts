import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-data-graphql/core/src/main/groovy/org/grails/gorm/graphql/types/DefaultGraphQLTypeManager.groovy"

async function errs(src: string): Promise<number> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const root = parser.parse(src)?.rootNode
  let n = 0
  const w = (x: any): void => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }
  if (root) w(root)
  return n
}

async function main(): Promise<void> {
  const src = readFileSync(F, "utf8")
  const lines = src.split("\n")
  console.log(`full file errors: ${await errs(src)} (${lines.length} lines)`)

  // A: remove the two interpolation lines entirely.
  const noInterp = lines.filter((_, i) => i + 1 !== 254 && i + 1 !== 280).join("\n")
  console.log(`without lines 254/280 (interpolation removed): ${await errs(noInterp)}`)

  // B: keep the lines but flatten `${...}` to plain text in place.
  const flat = lines.map((l, i) => (i + 1 === 254 || i + 1 === 280) ? l.replace(/\$\{[^}]*\}/g, "TYPE") : l).join("\n")
  console.log(`lines 254/280 with \${...} flattened:            ${await errs(flat)}`)

  // C: walk from the top, dropping trailing lines in blocks, to find where the
  // failure starts (block granularity to limit parse count).
  let lo = 1
  for (let n = 20; n <= lines.length; n += 20) {
    const e = await errs(lines.slice(0, n).join("\n"))
    if (e > 0) { lo = n - 20; break }
  }
  console.log(`first failing 20-line block ends near line ${lo + 20}`)
  for (let n = Math.max(1, lo); n <= Math.min(lines.length, lo + 20); n++) {
    const e = await errs(lines.slice(0, n).join("\n"))
    console.log(`  prefix ${String(n).padStart(3)} lines -> errors ${e}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
