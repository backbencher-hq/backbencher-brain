import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

// Every tree-sitter-hcl node type the analyzer dispatches on (via
// `type === "..."` / `n.type === "..."`). A stale or misspelled entry here
// would silently route real constructs through the wrong branch, so each must
// be observed in at least one real input.
const refs = new Set<string>([
  "block", "identifier", "string_lit", "attribute", "expression", "body",
  "template_literal", "variable_expr", "get_attr", "for_expr", "for_tuple_expr",
  "for_object_expr", "for_intro", "object_elem",
])

const parser = await ASTEngine.getParser("hcl")
const observed = new Set<string>()

const fixtureFiles = readdirSync("validation/m12/fixtures/hcl")
  .filter((file) => /\.(tf|tfvars|hcl)$/i.test(file))
  .sort()

const corpus = "$HOME/fixtures/repositories/terraform"
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.tf", "*.tfvars", "*.hcl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

const inputs: string[] = fixtureFiles.map((file) => readFileSync(`validation/m12/fixtures/hcl/${file}`, "utf8"))
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
  analyzer: "hcl",
  grammar: "vendored wasm/tree-sitter-hcl.wasm",
  fixtureFiles,
  corpus: `terraform@${revision.slice(0, 7)}`,
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/hcl-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
