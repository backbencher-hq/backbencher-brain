// M12.26: scan the clean-stdlib corpus for parse errors / crashes.
import { ASTEngine } from "../../src/ast/engine"
import { readdirSync } from "fs"
import { join } from "path"

const root = process.argv[2] || "$HOME/fixtures/repositories/clean-stdlib"
const files = readdirSync(root)
  .filter((f) => f.endsWith(".icl") || f.endsWith(".dcl"))
  .map((f) => join(root, f))

const parser = await ASTEngine.getParser("clean")
let errFiles = 0
let crashFiles = 0
let total = 0
const errList: string[] = []
for (const f of files) {
  const src = await Bun.file(f).text()
  if (src.length < 1024) continue
  total++
  try {
    const tree = parser.parse(src)
    const rootNode = tree.rootNode
    let errs = 0
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) errs++
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(rootNode)
    if (errs > 0) {
      errFiles++
      errList.push(`${f.split("/").pop()}: ${errs} errors`)
    }
  } catch (e: any) {
    crashFiles++
    errList.push(`${f.split("/").pop()}: CRASH ${e?.message?.slice(0, 80)}`)
  }
}
console.log(`total=${total} errFiles=${errFiles} crashFiles=${crashFiles}`)
for (const l of errList) console.log("  " + l)
