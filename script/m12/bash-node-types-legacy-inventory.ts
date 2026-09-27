/**
 * RETIRED — kept for audit, not for running.
 *
 * This instrument could not fail, for two independent reasons:
 *
 *  1. Lines 11-19 (below) hardcode a 35-entry list of node types and label it
 *     "referenced". That list was the author's memory of the analyzer, not the
 *     analyzer. The F1 auditor (`validation/m14/results/M14.0.F1.json`)
 *     independently measures 26 referenced type literals for bash, so the
 *     hardcoded inventory was inflated by 9.
 *  2. It computes only `refs INTERSECT observed`. It never computes
 *     `observed MINUS refs`, which is the F8 rule
 *     (reviews/LANE-AUDIT-FORMULA.md section 3): every node type occurring in
 *     a real corpus must be CLASSIFIED, because an unclassified node type is
 *     an unmeasured hole. 56 types occur in the pinned corpus; this instrument
 *     accounted for 35 and named none of the other 21.
 *
 * Same defect class the project has already paid for twice: 7767e6b1 ("the
 * sharpness sweep's own parser had the defect it hunts") and f8fe518a ("the
 * oracle's sharpness measured, not assumed - and the instrument proven able to
 * fail").
 *
 * Its last emitted artifact is preserved as
 * `validation/m12/results/bash-node-types-legacy-inventory.json` so the
 * replacement can publish the delta rather than silently overwrite it. The
 * live gate is `script/m12/bash-node-types-compare.ts`.
 */
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
  if (!tree) continue
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
writeFileSync("validation/m12/results/bash-node-types-legacy-inventory.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
