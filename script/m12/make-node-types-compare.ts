import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const source = readFileSync("src/ast/real-makefile-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/(?:\.type\s*===\s*|new Set\(\[|case\s+)(?:["']?)([A-Za-z_]+)(?:["'])?/g)) {
  if (match[1] && (match[1].includes("_") || ["rule", "word", "text", "list"].includes(match[1]))) refs.add(match[1])
}
for (const type of [
  "makefile", "rule", "targets", "prerequisites", "recipe", "recipe_line", "shell_text",
  "variable_assignment", "shell_assignment", "define_directive", "raw_text",
  "include_directive", "list", "conditional", "ifdef_directive", "ifeq_directive",
  "ifndef_directive", "ifneq_directive", "else_directive", "elsif_directive",
  "variable_reference", "automatic_variable", "function_call",
  "arguments", "concatenation", "word", "text", "shell_command", "shell_function",
  "comment", "override_directive", "export_directive", "unexport_directive",
  "undefine_directive",
]) refs.add(type)

const parser = await ASTEngine.getParser("make")
const observed = new Set<string>()
const files = readdirSync("validation/m12/fixtures/make").filter((file) => /\.mk$/i.test(file)).sort()
const corpus = "$HOME/fixtures/repositories/elixir"
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.mk", "Makefile", "GNUmakefile", "makefile"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort()
const inputs = files.map((file) => readFileSync(`validation/m12/fixtures/make/${file}`, "utf8"))
for (const file of corpusFiles) inputs.push(readFileSync(`${corpus}/${file}`, "utf8"))
for (const input of inputs) {
  const tree = parser.parse(input)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    observed.add(node.type)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  tree.delete?.()
}
const live = [...refs].filter((type) => observed.has(type)).sort()
const dead = [...refs].filter((type) => !observed.has(type)).sort()
const result = {
  analyzer: "make",
  grammar: "vendored wasm/tree-sitter-make.wasm (tree-sitter-make@1.1.1)",
  fixtureFiles: files,
  corpus: "elixir@024beb1",
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/make-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
