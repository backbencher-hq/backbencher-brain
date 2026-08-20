import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const source = readFileSync("src/ast/real-bash-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/(?:\\.type\\s*===\\s*|new Set\(\[|case\\s+)(?:["']?)([A-Za-z_]+)(?:["'])?/g)) {
  if (match[1] && match[1].includes("_")) refs.add(match[1])
}
// Node types referenced structurally (not via `type ===` string literals).
for (const type of [
  "program", "comment", "command", "command_name", "word", "declaration_command",
  "variable_assignment", "variable_name", "function_definition", "compound_statement",
  "array", "simple_expansion", "expansion", "special_variable_name", "subscript",
  "string", "raw_string", "string_content", "concatenation", "command_substitution",
  "subshell", "pipeline", "list", "if_statement", "elif_clause", "for_statement",
  "while_statement", "case_statement", "case_item", "test_command", "binary_expression",
  "do_group", "arithmetic_expansion", "number", "ERROR",
]) refs.add(type)

const parser = await ASTEngine.getParser("bash")
const observed = new Set<string>()
const files = readdirSync("validation/m12/fixtures/bash").filter((file) => /\.(sh|bash)$/i.test(file)).sort()
const corpus = "$HOME/fixtures/repositories/fsharp"
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort()
const inputs = files.map((file) => readFileSync(`validation/m12/fixtures/bash/${file}`, "utf8"))
for (const file of corpusFiles.slice(0, 32)) inputs.push(execFileSync("git", ["-C", corpus, "show", `HEAD:${file}`], { encoding: "utf8" }))
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
  analyzer: "bash",
  grammar: "vendored wasm/tree-sitter-bash.wasm",
  fixtureFiles: files,
  corpus: "fsharp@22a8a5dc",
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/bash-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
