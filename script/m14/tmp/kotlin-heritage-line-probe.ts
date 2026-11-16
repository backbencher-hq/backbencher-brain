// M59 (#825): kotlin heritage lines — verify against the SOURCE, not against
// the analyzer's own output. The file below wraps its supertype list:
//   line 183  internal class TestScopeImpl(context: CoroutineContext) :
//   line 184      AbstractCoroutine<Unit>(...) , TestScope {
// so BOTH heritage edges must be attributed to line 184, never to 183.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE =
  "<corpus-root>/bb_tests/repositories/kotlinx-coroutines/kotlinx-coroutines-test/common/src/TestScope.kt"

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(FILE, "utf8")
  const lines = src.split("\n")
  const res: any = await ASTEngine.parseFile(FILE, src)
  const rels: any[] = res.relationships ?? []
  const heritage = rels.filter(
    (r) =>
      r.type === "extends" ||
      r.type === "implements" ||
      r.metadata?.relationshipType === "kotlin_extends" ||
      r.metadata?.relationshipType === "kotlin_implements"
  )
  console.log(`file: ${path.basename(FILE)}`)
  console.log(`heritage edges: ${heritage.length}`)
  let checked = 0
  let failed = 0
  for (const r of heritage) {
    const ln: number | undefined = r.line_number
    const text = ln ? (lines[ln - 1] ?? "") : ""
    const base = String(r.target).replace(/<.*$/, "")
    const onLine = ln ? text.includes(base) : false
    if (ln) checked++
    if (ln && !onLine) failed++
    console.log(
      `${r.type.padEnd(10)} ${String(r.source).padEnd(16)} -> ${String(r.target).padEnd(28)} line=${ln ?? "(none)"} ${ln ? (onLine ? "OK" : "FAIL") : "NO-LINE"}`
    )
    if (ln) console.log(`           source[${ln}] = ${text.trim()}`)
  }
  console.log(`\nchecked=${checked} failed=${failed}`)
  process.exit(failed === 0 && heritage.length > 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
