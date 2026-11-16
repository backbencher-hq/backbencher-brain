import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const REPO = "<corpus-root>/bb_tests/repositories/grails-core"

async function main(): Promise<void> {
  for (const file of process.argv.slice(2)) {
    const src = readFileSync(`${REPO}/${file}`, "utf8")
    // mirror the comparator exactly: fresh parser per parse
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`\n### ${file}`)
    console.log(`root.hasError=${root?.hasError}  type=${root?.type}`)
    const found: any[] = []
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "ERROR") found.push(n)
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    console.log(`ERROR nodes by walk: ${found.length}`)
    for (const n of found.slice(0, 3)) {
      console.log(`  @${n.startPosition.row + 1}:${n.startPosition.column} named=${n.isNamed} missing=${n.isMissing} text=${JSON.stringify(n.text.slice(0, 80))}`)
    }
    // Also: does a SECOND parse of the same source give the same answer?
    const parser2 = await ASTEngine.getParser("groovy" as any)
    const root2 = parser2.parse(src)?.rootNode
    let n2 = 0
    const st2: any[] = [root2]
    while (st2.length) {
      const n = st2.pop()!
      if (n.type === "ERROR") n2++
      for (let i = 0; i < n.childCount; i++) st2.push(n.child(i))
    }
    console.log(`second parse: hasError=${root2?.hasError} errors=${n2}`)
    // Third: use the parser WITHOUT re-fetching
    const root3 = parser.parse(src)?.rootNode
    let n3 = 0
    const st3: any[] = [root3]
    while (st3.length) {
      const n = st3.pop()!
      if (n.type === "ERROR") n3++
      for (let i = 0; i < n.childCount; i++) st3.push(n.child(i))
    }
    console.log(`reused parser: hasError=${root3?.hasError} errors=${n3}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
