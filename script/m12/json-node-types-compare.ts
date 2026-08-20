import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const source = readFileSync("src/ast/real-json-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/node\.type\s*===\s*["']([^"']+)["']|value\.type\s*===\s*["']([^"']+)["']|case\s*["']([^"']+)["']/g)) {
  const type = match[1] || match[2] || match[3]
  if (type) refs.add(type)
}
const corpus = process.argv[2] || "$HOME/roslyn"
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.json"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
function strictJson(file: string): boolean {
  try {
    const text = readFileSync(`${corpus}/${file}`, "utf8")
    JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    return true
  } catch {
    return false
  }
}
const unsupportedFiles = corpusFiles.filter((file) => !strictJson(file))
const cleanFiles = corpusFiles.filter((file) => strictJson(file))
const fixtureFiles = [
  "validation/m12/fixtures/json/api-contract.json",
  "validation/m12/fixtures/json/package.json",
  "validation/m12/fixtures/json/Negative.json",
]
const parser = await ASTEngine.getParser("json")
const observed = new Set<string>()
let parseErrors = 0
let excludedParseErrors = 0
for (const file of [...corpusFiles.map((file) => `${corpus}/${file}`), ...fixtureFiles]) {
  const excluded = file.startsWith(`${corpus}/`) && unsupportedFiles.includes(file.slice(corpus.length + 1))
  const text = await Bun.file(file).text()
  const tree = parser.parse(text)
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const node = stack.pop()
    observed.add(node.type)
    if (node.type === "ERROR" || node.isMissing) {
      parseErrors++
      if (excluded) excludedParseErrors++
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  tree.delete?.()
}
const unexpectedParseErrors = parseErrors - excludedParseErrors
const live = [...refs].filter((type) => observed.has(type)).sort()
const dead = [...refs].filter((type) => !observed.has(type)).sort()
const result = {
  analyzer: "json",
  corpus,
  acceptanceFiles: cleanFiles.length + fixtureFiles.length,
  excludedFiles: unsupportedFiles,
  parseErrors,
  excludedParseErrors,
  unexpectedParseErrors,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  passed: unexpectedParseErrors === 0 && dead.length === 0,
}
writeFileSync("validation/m12/results/json-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
