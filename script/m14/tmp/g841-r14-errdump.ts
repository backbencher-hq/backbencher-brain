// Round 14, step 2b: STOP hypothesizing shapes — dump real error contexts.
// For a sample of the 209 genuine gaps, print each ERROR node's source line and
// its parent chain, so the actual failure shape is read from the corpus itself.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories/grails-core"

const census = JSON.parse(readFileSync(path.join(ROOT, "validation/m12/results/groovy-corpus-errors.json"), "utf8"))
const oracle = JSON.parse(readFileSync(path.join(ROOT, "validation/m59/results/g841-groovy-oracle.json"), "utf8"))
const accepted = new Set<string>(oracle.acceptedFiles)
const gapFiles = census.errorFileList.filter((e: any) => accepted.has(e.file))

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

const N = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 12)
let shown = 0
for (const e of gapFiles) {
  if (shown >= N) break
  const full = path.join(CORPUS, e.file)
  let src: string
  try { src = readFileSync(full, "utf8") } catch { continue }
  const t = parser.parse(src)
  // find first ERROR node, deepest
  const lines = src.split("\n")
  let found: any = null
  const walk = (n: any, chain: string[]) => {
    if (found) return
    if (n.type === "ERROR") { found = { n, chain } ; return }
    for (const k of n.children ?? []) walk(k, [...chain, n.type])
  }
  walk(t.rootNode, [])
  if (!found) continue
  shown++
  const { n, chain } = found
  const lineText = (lines[n.startPosition.row] ?? "").trim()
  console.log(`\n### ${e.file}`)
  console.log(`    chain: ${chain.slice(-4).join(" > ")} > ERROR  (L${n.startPosition.row + 1})`)
  console.log(`    line : ${lineText.slice(0, 110)}`)
  // two lines of context after, often the closure head lives there
  if (lines[n.startPosition.row + 1]) console.log(`    next : ${(lines[n.startPosition.row + 1] ?? "").trim().slice(0, 110)}`)
}
