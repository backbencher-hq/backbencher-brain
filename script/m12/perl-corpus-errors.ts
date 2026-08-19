// M12.30: scan the pinned Mojo corpus for Perl grammar errors and crashes.
import { ASTEngine } from "../../src/ast/engine"
import { execFileSync } from "node:child_process"

const root = process.argv[2] || "$HOME/fixtures/repositories/mojo"
const relative = execFileSync("git", ["-C", root, "ls-files", "*.pm", "*.pl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const files = relative.map((file) => `${root}/${file}`)
const parser = await ASTEngine.getParser("perl")
let errorFiles = 0
let crashFiles = 0
const errorList: string[] = []
for (const file of files) {
  const source = await Bun.file(file).text()
  try {
    const tree = parser.parse(source)
    let errors = 0
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node.type === "ERROR" || node.isMissing) errors++
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
    if (errors > 0) {
      errorFiles++
      errorList.push(`${file.slice(root.length + 1)}: ${errors} errors`)
    }
  } catch (error: any) {
    crashFiles++
    errorList.push(`${file.slice(root.length + 1)}: CRASH ${String(error?.message || error).slice(0, 120)}`)
  }
}
console.log(`total=${files.length} errorFiles=${errorFiles} crashFiles=${crashFiles}`)
for (const item of errorList.slice(0, 40)) console.log(`  ${item}`)
