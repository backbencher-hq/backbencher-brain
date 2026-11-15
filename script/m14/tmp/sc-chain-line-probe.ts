// Probe: which line does the scala analyzer claim for each call in a
// MULTI-LINE method chain? (#825: "records the enclosing expression's start
// line rather than the call node's line".)
//
// Prints, for every emitted relationship, the claimed line and the source text
// of that line — so "the call is written here" is checkable by eye against the
// fixture, never inferred.
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const SRC = `object Chain {
  def target(n: Int): Int = n

  def use(): Int = {
    val outerTokens = List(1, 2, 3)
    val toRemove = outerTokens
      .filter(_ > 0)
      .dropRight(1)
      .map(target)
    toRemove.sum
  }
}
`

async function main() {
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const dir = mkdtempSync(path.join(tmpdir(), "sc-chain-"))
  const file = path.join(dir, "Chain.scala")
  writeFileSync(file, SRC)
  const res = await ASTEngine.parseFile(file, SRC)
  const lines = SRC.split("\n")
  console.log("source lines:")
  lines.forEach((l, i) => console.log(`  ${String(i + 1).padStart(3)} | ${l}`))
  console.log("\nemitted relationships carrying a line:")
  for (const r of res.relationships ?? []) {
    if (typeof r.line_number !== "number") continue
    const text = lines[r.line_number - 1] ?? "<out of range>"
    console.log(`  ${String(r.line_number).padStart(3)} | ${r.type} ${r.source} -> ${r.target}   src[${r.line_number}] = ${JSON.stringify(text.trim())}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
