import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const source = readFileSync("src/ast/real-yaml-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/(?:\.type\s*===\s*|new Set\(\[|case\s+)(?:["']?)([A-Za-z_]+)(?:["'])?/g)) {
  if (match[1] && match[1].includes("_")) refs.add(match[1])
}
for (const type of ["stream", "document", "block_node", "flow_node", "block_mapping", "flow_mapping", "block_mapping_pair", "flow_pair", "block_sequence", "flow_sequence", "block_sequence_item", "anchor", "anchor_name", "alias", "alias_name", "plain_scalar", "string_scalar", "single_quote_scalar", "double_quote_scalar", "integer_scalar", "float_scalar", "boolean_scalar", "null_scalar", "block_scalar"]) refs.add(type)

const parser = await ASTEngine.getParser("yaml")
const observed = new Set<string>()
const files = readdirSync("validation/m12/fixtures/yaml").filter((file) => /\.(yaml|yml)$/i.test(file)).sort()
const corpus = "$HOME/fixtures/repositories/grails-core"
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.yaml", "*.yml"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort()
const inputs = files.map((file) => readFileSync(`validation/m12/fixtures/yaml/${file}`, "utf8"))
for (const file of corpusFiles.slice(0, 274)) inputs.push(readFileSync(`${corpus}/${file}`, "utf8"))
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
  analyzer: "yaml",
  grammar: "vendored wasm/tree-sitter-yaml.wasm",
  fixtureFiles: files,
  corpus: "grails-core@a83f8748",
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/yaml-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
