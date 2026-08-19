// M12.30: compare the pinned Perl WASM with npm tree-sitter-perl 1.2.1.
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"
import { execFileSync } from "node:child_process"

const root = process.argv[2] || "$HOME/fixtures/repositories/mojo"
const newWasm = process.argv[3] || "/tmp/tree-sitter-perl-npm-1.2.1.wasm"
const relative = execFileSync("git", ["-C", root, "ls-files", "*.pm", "*.pl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const files = relative.map((file) => `${root}/${file}`)

const currentParser = await ASTEngine.getParser("perl")
const mod = await loadWebTreeSitter()
const newLanguage = await mod.Language.load(newWasm)
const newParser = new mod.Parser()
newParser.setLanguage(newLanguage)

function errorCount(tree: any): number {
  let count = 0
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node.type === "ERROR" || node.isMissing) count++
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return count
}

let currentErrorFiles = 0
let newErrorFiles = 0
let fixed = 0
let regressed = 0
let crashes = 0
const changes: string[] = []
for (const file of files) {
  const source = await Bun.file(file).text()
  try {
    const currentErrors = errorCount(currentParser.parse(source))
    const newErrors = errorCount(newParser.parse(source))
    if (currentErrors > 0) currentErrorFiles++
    if (newErrors > 0) newErrorFiles++
    if (currentErrors > 0 && newErrors === 0) { fixed++; changes.push(`FIXED ${file.slice(root.length + 1)} ${currentErrors}->0`) }
    if (currentErrors === 0 && newErrors > 0) { regressed++; changes.push(`REGRESSED ${file.slice(root.length + 1)} 0->${newErrors}`) }
  } catch (error: any) {
    crashes++
    changes.push(`CRASH ${file.slice(root.length + 1)} ${String(error?.message || error).slice(0, 120)}`)
  }
}
console.log(`files=${files.length} currentErrorFiles=${currentErrorFiles} npmErrorFiles=${newErrorFiles} fixed=${fixed} regressed=${regressed} crashes=${crashes}`)
for (const change of changes.slice(0, 50)) console.log(`  ${change}`)
