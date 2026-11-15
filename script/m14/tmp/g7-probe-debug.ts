import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-test-core/src/main/groovy/org/grails/test/support/GrailsTestAutowirer.groovy"

async function main(): Promise<void> {
  const src = readFileSync(F, "utf8")
  try {
    const res: any = await ASTEngine.parseFile(F, src)
    console.log("keys:", Object.keys(res))
    console.log("has tree:", !!res.tree, "has rootNode:", !!res.rootNode, "rels:", (res.relationships ?? []).length)
    console.log("metadata keys:", Object.keys(res.metadata ?? {}))
    const root = res.tree?.rootNode ?? res.rootNode
    console.log("root type:", root?.type, "hasError:", root?.hasError)
  } catch (e: any) {
    console.log("THREW:", e?.message)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
