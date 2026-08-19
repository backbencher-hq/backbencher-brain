// M12.31: shape safety — R analyzer dispatch refs vs emitted grammar types.
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const analyzer = readFileSync("src/ast/real-r-analyzer.ts", "utf8")
const refs = new Set<string>()
const refPattern = /(?:\.type|\btype)\s*===\s*"([a-z_]+)"/g
let match: RegExpExecArray | null
while ((match = refPattern.exec(analyzer))) refs.add(match[1])

const root = process.argv[2] || "$HOME/fixtures/repositories/dplyr"
const files = execFileSync("git", ["-C", root, "ls-files", "*.R", "*.r"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((f) => `${root}/${f}`)
const parser = await ASTEngine.getParser("r")
const emitted = new Set<string>()
let parseErrors = 0
const walk = (node: any) => {
  emitted.add(node.type)
  if (node.type === "ERROR" || node.isMissing) parseErrors++
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) walk(child)
  }
}
for (const file of [...files, "validation/m12/fixtures/r/Base.R", "validation/m12/fixtures/r/Service.R", "validation/m12/fixtures/r/Negative.R"]) {
  walk(parser.parse(await Bun.file(file).text()).rootNode)
}
// Corpus coverage is supplemented with a deterministic grammar-shape probe;
// uncommon constructs such as `repeat` must be tested even if dplyr does not
// use them in its tracked sources.
const shapeProbe = "f <- function(x) { if (x) y <- 1 else y <- 2; for (i in x) y <- i; while (x) y <- 1; repeat break; x$a; ~x }"
walk(parser.parse(shapeProbe).rootNode)
const missing = [...refs].filter((ref) => !emitted.has(ref)).sort()
console.log(`analyzer refs=${refs.size} emitted=${emitted.size} files=${files.length + 4} parseErrors=${parseErrors}`)
console.log(`missing=${missing.length ? missing.join(",") : "none"}`)
if (missing.length || parseErrors) process.exitCode = 1
