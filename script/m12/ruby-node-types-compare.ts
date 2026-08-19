// M12.28: shape safety — Ruby analyzer dispatch refs vs emitted grammar types.
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const analyzer = readFileSync("src/ast/real-ruby-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of analyzer.matchAll(/(?:\.type|\btype)\s*===\s*"([a-z_]+)"/g)) refs.add(match[1])
const root = process.argv[2] || "$HOME/fixtures/repositories/rake"
const files = execFileSync("git", ["-C", root, "ls-files", "*.rb"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((f) => `${root}/${f}`)
const parser = await ASTEngine.getParser("ruby")
const emitted = new Set<string>()
let parseErrors = 0
for (const file of [...files,
  "validation/m12/fixtures/ruby/BaseService.rb",
  "validation/m12/fixtures/ruby/Service.rb",
  "validation/m12/fixtures/ruby/Negative.rb",
]) {
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
console.log(`analyzer refs=${refs.size} emitted=${emitted.size} files=${files.length + 3} parseErrors=${parseErrors}`)
console.log(`missing=${missing.length ? missing.join(",") : "none"}`)
