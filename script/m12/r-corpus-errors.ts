// M12.31: scan the pinned R corpus for grammar errors and parser crashes.
import { ASTEngine } from "../../src/ast/engine"
import { execFileSync } from "node:child_process"

const root = process.argv[2] || "$HOME/fixtures/repositories/dplyr"
const files = execFileSync("git", ["-C", root, "ls-files", "*.R", "*.r"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((f) => `${root}/${f}`)
let errorFiles = 0
let errorNodes = 0
let crashFiles = 0
const errorList: string[] = []
for (const file of files) {
  try {
    const parser = await ASTEngine.getParser("r")
    const tree = parser.parse(await Bun.file(file).text())
    let errors = 0
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const node = stack.pop()
      if (node.type === "ERROR" || node.isMissing) errors++
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
    if (errors > 0) {
      errorFiles++
      errorNodes += errors
      errorList.push(`${file.slice(root.length + 1)}: ${errors} errors`)
    }
  } catch (error: any) {
    crashFiles++
    errorList.push(`${file.slice(root.length + 1)}: CRASH ${String(error?.message || error).slice(0, 100)}`)
  }
}
console.log(`total=${files.length} errorFiles=${errorFiles} errorNodes=${errorNodes} crashFiles=${crashFiles}`)
for (const item of errorList.slice(0, 30)) console.log(`  ${item}`)
if (errorFiles || crashFiles) process.exitCode = 1
