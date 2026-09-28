// M12.30: shape safety — Perl analyzer dispatch refs vs emitted grammar types.
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const analyzer = readFileSync("src/ast/real-perl-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of analyzer.matchAll(/(?:\.type|\btype)\s*===\s*"([a-z_]+)"/g)) refs.add(match[1])
const root = process.argv[2] || "$HOME/fixtures/repositories/mojo"
const relative = execFileSync("git", ["-C", root, "ls-files", "*.pm", "*.pl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const corpusFiles = relative.map((file) => `${root}/${file}`)
const fixtures = [
  "validation/m12/fixtures/perl/BaseService.pm",
  "validation/m12/fixtures/perl/Service.pm",
  "validation/m12/fixtures/perl/Negative.pm",
]
const parser = await ASTEngine.getParser("perl")
const emitted = new Set<string>()
let parseErrors = 0
for (const file of [...corpusFiles, ...fixtures]) {
  const source = await Bun.file(file).text()
  const tree = parser.parse(source)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()
    emitted.add(node.type)
    if (node.type === "ERROR" || node.isMissing) parseErrors++
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
}
const missing = [...refs].filter((ref) => !emitted.has(ref)).sort()
console.log(`analyzer refs=${refs.size} emitted=${emitted.size} files=${corpusFiles.length + fixtures.length} parseErrors=${parseErrors}`)
console.log(`missing=${missing.length ? missing.join(",") : "none"}`)
