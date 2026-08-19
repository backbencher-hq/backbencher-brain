// M12.29: scan the phpunit corpus for grammar-error files in the CURRENT
// process (reads the repo wasm at module init, so a fresh process reflects the
// current disk state — used by the corrected wasm-comparison orchestrator).
import { ASTEngine } from "../../src/ast/engine"
import { execFileSync } from "node:child_process"

const root = process.argv[2] || "$HOME/fixtures/repositories/phpunit"
const files = execFileSync("git", ["-C", root, "ls-files", "*.php"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((f) => `${root}/${f}`)
const parser = await ASTEngine.getParser("php")
const errorFiles: string[] = []
for (const file of files) {
  const source = await Bun.file(file).text()
  const tree = parser.parse(source)
  let errors = 0
  const walk = (node: any) => {
    if (node.type === "ERROR" || node.isMissing) errors++
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) walk(child)
    }
  }
  walk(tree.rootNode)
  if (errors > 0) errorFiles.push(file.slice(root.length + 1))
}
console.log(JSON.stringify({ scanned: files.length, errors: errorFiles.length, files: errorFiles }))
