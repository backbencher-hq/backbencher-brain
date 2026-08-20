// M12.32: scan the pinned LuaRocks corpus for grammar errors and parser crashes.
import { parseFile } from "../../src/ast/pool-worker"
import { execFileSync } from "node:child_process"

const root = process.argv[2] || "$HOME/fixtures/repositories/luarocks"
const relative = execFileSync("git", ["-C", root, "ls-files", "*.lua", "*.luau"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean)
const files = relative.map((file) => `${root}/${file}`)
let errorFiles = 0
let errorNodes = 0
let crashFiles = 0
const errorList: string[] = []
for (const file of files) {
  try {
    const parsed = await parseFile(file, process.cwd())
    const errors = parsed.errors?.length ?? 0
    if (errors > 0) {
      errorFiles++
      errorNodes += errors
      errorList.push(`${file.slice(root.length + 1)}: ${errors} errors`)
    }
  } catch (error: any) {
    crashFiles++
    errorList.push(`${file.slice(root.length + 1)}: CRASH ${String(error?.message || error).slice(0, 120)}`)
  }
}
console.log(`total=${files.length} errorFiles=${errorFiles} errorNodes=${errorNodes} crashFiles=${crashFiles}`)
for (const item of errorList.slice(0, 30)) console.log(`  ${item}`)
if (errorFiles || crashFiles) process.exitCode = 1
