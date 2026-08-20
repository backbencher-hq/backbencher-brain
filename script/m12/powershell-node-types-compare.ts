import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const source = readFileSync("src/ast/real-powershell-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/(?:\.type\s*===\s*|case\s+)(?:["']?)([A-Za-z_]+)(?:["'])?/g)) {
  if (match[1] && match[1].includes("_")) refs.add(match[1])
}
for (const type of [
  "program", "statement_list", "comment", "function_statement", "function_name",
  "script_block", "script_block_body", "param_block", "parameter_list",
  "script_parameter", "script_parameter_default", "attribute", "attribute_list",
  "attribute_name", "type_literal", "type_spec", "type_name", "type_identifier",
  "variable", "class_statement", "simple_name", "class_method_definition",
  "class_method_parameter_list", "class_method_parameter", "class_property_definition",
  "class_attribute", "enum_statement", "enum_member", "assignment_expression",
  "left_assignment_expression", "assignement_operator", "pipeline", "pipeline_chain",
  "command", "command_name", "command_name_expr", "command_invokation_operator",
  "command_elements", "command_argument_sep", "command_parameter", "generic_token",
  "invokation_expression", "member_access", "member_name", "argument_list",
  "foreach_statement", "if_statement", "elseif_clause", "else_clause",
  "while_statement", "do_statement", "for_statement", "switch_statement",
  "switch_clauses", "switch_condition", "switch_body", "try_statement",
  "catch_clause", "trap_statement", "flow_control_statement",
  "statement_block", "string_literal", "expandable_string_literal", "integer_literal",
  "ERROR", "empty_statement",
]) refs.add(type)

const parser = await ASTEngine.getParser("powershell")
const observed = new Set<string>()
const files = readdirSync("validation/m12/fixtures/powershell").filter((file) => /\.(ps1|psm1|psd1)$/i.test(file)).sort()
const corpus = "$HOME/fixtures/repositories/powershell"
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.ps1", "*.psm1", "*.psd1"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort()
const inputs = files.map((file) => readFileSync(`validation/m12/fixtures/powershell/${file}`, "utf8"))
for (const file of corpusFiles.slice(0, 553)) inputs.push(execFileSync("git", ["-C", corpus, "show", `HEAD:${file}`], { encoding: "utf8" }))
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
  analyzer: "powershell",
  grammar: "vendored wasm/tree-sitter-powershell.wasm",
  fixtureFiles: files,
  corpus: "powershell@91ce9844",
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/powershell-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
