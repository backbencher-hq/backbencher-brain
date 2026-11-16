// G7 regression check: `build-logic/settings.gradle` lost ONE `calls` edge in the
// corpus before/after (44 -> 43). Explain it, do not round it away. Prints both
// edge sets and the source lines around whatever differs.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const FILE = "build-logic/settings.gradle"

async function main(): Promise<void> {
  const p = `${REPO}/${FILE}`
  const src = readFileSync(p, "utf8")
  const res: any = await ASTEngine.parseFile(p, src)
  const lines = src.split("\n")
  const calls = (res.relationships ?? []).filter((r: any) => String(r.type) === "calls")
  console.log(`calls=${calls.length}`)
  for (const c of calls) console.log(`  ${c.source ?? c.from} -> ${c.target} @${c.line_number} ${c.metadata?.groovyCallExpression ? "expr=" + c.metadata.groovyCallExpression : ""}`)
  // every line carrying a `${…}` or `$name`, so the interpolation surface is visible
  console.log("--- interpolation-bearing lines ---")
  lines.forEach((l, i) => {
    if (/\$\{[^}]*\}|\$[A-Za-z_]/.test(l)) console.log(`${i + 1}: ${l.trim().slice(0, 150)}`)
  })
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
