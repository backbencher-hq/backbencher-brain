// Is the reduced candidate's failure the CONSTRUCT or the CONTEXT? Take the lines
// from the failing node's start to EOF, parse them alone, and compare.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CAND = "/tmp/g841-reduced.groovy"

async function hasError(parser: any, text: string): Promise<boolean> {
  return !!parser.parse(text)?.rootNode?.hasError
}

async function main() {
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const parser = await ASTEngine.getParser("groovy")
  const text = readFileSync(CAND, "utf8")
  const lines = text.split("\n")
  const ctx = parser.parse(text)?.rootNode
  const err = (function first(n: any): any {
    if (n.type === "ERROR" || n.isMissing) return n
    for (const c of n.namedChildren ?? []) {
      const hit = first(c)
      if (hit) return hit
    }
    return null
  })(ctx)
  const startRow = err?.startPosition?.row ?? 0
  console.log(`candidate: ${lines.length} lines · first failing node at row ${startRow + 1}`)
  console.log(`candidate hasError: ${await hasError(parser, text)}`)
  const tail = lines.slice(startRow).join("\n")
  console.log(`same lines from the failing node onward, parsed alone: hasError=${await hasError(parser, tail)} (${tail.split("\n").length} lines)`)
  const dir = mkdtempSync(path.join(tmpdir(), "g841ctx-"))
  const f = path.join(dir, "Tail.groovy")
  writeFileSync(f, tail)
  const res: any = await ASTEngine.parseFile(f, tail)
  console.log(`  through the product: symbols=${res?.symbols?.length} rels=${res?.relationships?.length}`)
  console.log("\ninterpretation: if the tail parses clean, the reduced failure lives in the RETAINED CONTEXT, not in the construct the error node points at.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
