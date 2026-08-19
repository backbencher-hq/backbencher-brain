// M12.29: shape safety — PHP analyzer dispatch refs vs emitted grammar types.
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const analyzer = readFileSync("src/ast/real-php-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of analyzer.matchAll(/(?:\.type|\btype)\s*===\s*"([a-z_]+)"/g)) refs.add(match[1])
const root = process.argv[2] || "$HOME/fixtures/repositories/phpunit"
const corpusFiles = execFileSync("git", ["-C", root, "ls-files", "*.php"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((f) => `${root}/${f}`)
const fixtures = [
  "validation/m12/fixtures/php/BaseService.php",
  "validation/m12/fixtures/php/Service.php",
  "validation/m12/fixtures/php/Negative.php",
]
const parser = await ASTEngine.getParser("php")
const emitted = new Set<string>()
let parseErrors = 0
for (const file of [...corpusFiles, ...fixtures]) {
  const source = await Bun.file(file).text()
  const tree = parser.parse(source)
  const walk = (node: any) => {
    emitted.add(node.type)
    if (node.type === "ERROR" || node.isMissing) parseErrors++
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) walk(child)
    }
  }
  walk(tree.rootNode)
}
const missing = [...refs].filter((ref) => !emitted.has(ref)).sort()
console.log(`analyzer refs=${refs.size} emitted=${emitted.size} files=${corpusFiles.length + fixtures.length} parseErrors=${parseErrors}`)
console.log(`missing=${missing.length ? missing.join(",") : "none"}`)
