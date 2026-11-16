// M59 (#825): the store check flagged ONE remaining landed line as inconsistent —
// `cats.effect.kernel.testkit.TestInstances` claimed on line 21 of
// TestInstances.scala, where line 21 is `import cats.effect.kernel.testkit.{`.
// The module path opens there; the segment the target is named after (a renamed
// selector) is written later. This probe prints what the analyzer now stamps.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = "<corpus-root>/bb_tests/repositories/cats-effect/testkit/shared/src/main/scala/cats/effect/testkit/TestInstances.scala"

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(F, "utf8")
  const res: any = await ASTEngine.parseFile(F, src)
  const lines = src.split("\n")
  for (const imp of res.imports ?? []) {
    console.log(`IMPORT module=${imp.module} moduleLine=${imp.moduleLine} rangeStart=${imp.range?.startLine}`)
  }
  for (const r of res.relationships ?? []) {
    if (!r.metadata?.isImportDep) continue
    const ln = r.line_number
    const text = typeof ln === "number" ? lines[ln - 1].trim() : "(none)"
    const token = String(r.target).split(".").pop() ?? ""
    const onLine = typeof ln === "number" && new RegExp(`(^|[^\\w])${token}([^\\w]|$)`).test(lines[ln - 1])
    console.log(`EDGE target=${r.target} line=${ln} tokenOnThatLine=${onLine} src="${text.slice(0, 55)}"`)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
