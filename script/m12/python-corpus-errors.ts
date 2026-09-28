// M12.27: scan the cython corpus for parse errors / crashes.
import { ASTEngine } from "../../src/ast/engine"
import { execSync } from "child_process"

const root = process.argv[2] || "$HOME/fixtures/repositories/cython"
const files = execSync(`find ${root} -name "*.py" -size +1k`, { encoding: "utf8" })
  .trim().split("\n").filter(Boolean)

const parser = await ASTEngine.getParser("python")
let errFiles = 0
let crashFiles = 0
const errList: string[] = []
for (const f of files) {
  const src = await Bun.file(f).text()
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
console.log(`total=${files.length} errFiles=${errFiles} crashFiles=${crashFiles}`)
for (const l of errList.slice(0, 30)) console.log("  " + l)
