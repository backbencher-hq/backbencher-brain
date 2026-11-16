// Classify the residual .gradle failures by looking at the ERROR node's own
// line (not the recovery container) so each class is countable.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const files = JSON.parse(readFileSync("/tmp/groovy-AFTER.json", "utf8")).files as Record<string, any>

async function main(): Promise<void> {
  const rows: Array<{ file: string; line: number; text: string }> = []
  for (const [file, v] of Object.entries(files)) {
    if (!v.hasError) continue
    const src = readFileSync(`${REPO}/${file}`, "utf8")
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    const lines = src.split("\n")
    // deepest/smallest ERROR node = the closest thing to the trigger
    let best: any = null
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "ERROR" || n.isMissing) {
        const span = n.endIndex - n.startIndex
        if (!best || span < best.endIndex - best.startIndex) best = n
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    rows.push({ file, line: (best?.startPosition.row ?? 0) + 1, text: (lines[best?.startPosition.row ?? 0] ?? "").trim().slice(0, 100) })
  }
  rows.sort((a, b) => a.file.localeCompare(b.file))
  for (const r of rows) console.log(`${r.file}:${r.line}\n    ${r.text}`)
  console.log(`\ntotal failing: ${rows.length}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
