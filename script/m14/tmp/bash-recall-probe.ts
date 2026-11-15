/**
 * READ-ONLY PROBE — bash lane recall census.
 *
 * Question: on the pinned corpus, which syntactic positions that DO carry a
 * name (a variable reference or a command) reach the analyzer's extractors?
 *
 * Method: parse each tracked .sh/.bash file once with the pinned wasm, walk the
 * tree, and classify every node by whether it is a name-bearing node the
 * analyzer claims to handle. Then run the REAL analyzer (via the production
 * parseFile) and compare the emitted Uses/Calls edges against the census.
 *
 * Writes nothing. Emits a census to stdout.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const CORPUS = process.env.BB_BASH_CORPUS ?? "/home/ishaq2321/bb_tests/repositories/fsharp"

const NAME_BEARING = new Set([
  "variable_name",
  "special_variable_name",
  "command_name",
  "word",
])
// Node types whose subtree can contain a name the analyzer must attribute.
const CONTAINERS = new Set([
  "simple_expansion",
  "expansion",
  "arithmetic_expansion",
  "postfix_expression",
  "unary_expression",
  "binary_expression",
  "c_style_for_statement",
  "subscript",
  "heredoc_body",
  "herestring_redirect",
  "process_substitution",
  "negated_command",
  "command",
  "command_substitution",
  "declaration_command",
  "variable_assignment",
  "unset_command",
  "function_definition",
  "file_redirect",
  "heredoc_redirect",
])

const ROOTDIR = process.cwd()
const parser = await ASTEngine.getParser("bash")

const files = execFileSync("git", ["-C", CORPUS, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

interface Row {
  file: string
  commands: number
  emittedCalls: number
  varNames: number
  emittedUses: number
  arithmeticVarNames: number
  arithmeticEmitted: number
  heredocVarNames: number
  heredocEmitted: number
  commandsInCase: number
  commandsDroppedByCase: number
  commandsUnderNegated: number
  commandsUnderProcessSub: number
}
const rows: Row[] = []
const containerCensus = new Map<string, number>()
const nameParents = new Map<string, number>()

for (const file of files) {
  const text = execFileSync("git", ["-C", CORPUS, "show", `HEAD:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const tree = parser.parse(text)
  const root = tree.rootNode

  let commands = 0, varNames = 0, arithmeticVarNames = 0, heredocVarNames = 0
  let commandsInCase = 0, commandsDroppedByCase = 0
  let commandsUnderNegated = 0, commandsUnderProcessSub = 0
  const arithmeticNames = new Set<string>()
  const heredocNames = new Set<string>()

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n: any = stack.pop()
    if (!n) continue
    containerCensus.set(n.type, (containerCensus.get(n.type) ?? 0) + 1)
    nameParents.set(n.type, (nameParents.get(n.type) ?? 0) + 1)

    if (n.type === "command") {
      commands++
      if (isUnder(n, "case_item")) { commandsInCase++; commandsDroppedByCase++ }
      if (isUnder(n, "negated_command")) commandsUnderNegated++
      if (isUnder(n, "process_substitution")) commandsUnderProcessSub++
    }
    if (n.type === "variable_name" || n.type === "special_variable_name") {
      if (n.text.length === 0) continue
      varNames++
      if (isUnder(n, "arithmetic_expansion")) { arithmeticVarNames++; arithmeticNames.add(n.text) }
      if (isUnder(n, "heredoc_body")) { heredocVarNames++; heredocNames.add(n.text) }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }

  const res = await parseFile(path.join(CORPUS, file), ROOTDIR)
  const rels = (res as any).relationships ?? []
  const syms = (res as any).symbols ?? []
  const emittedCalls = rels.filter((r: any) => r.type === "calls").length
  const emittedUses = rels.filter((r: any) => r.type === "uses").length
  const useTargets = new Set(rels.filter((r: any) => r.type === "uses").map((r: any) => r.target))
  let arithmeticEmitted = 0
  for (const n of arithmeticNames) if (useTargets.has(n)) arithmeticEmitted++
  let heredocEmitted = 0
  for (const n of heredocNames) if (useTargets.has(n)) heredocEmitted++

  rows.push({
    file,
    commands, emittedCalls,
    varNames, emittedUses,
    arithmeticVarNames, arithmeticEmitted,
    heredocVarNames, heredocEmitted,
    commandsInCase, commandsDroppedByCase,
    commandsUnderNegated, commandsUnderProcessSub,
  })
  tree.delete?.()
}

function isUnder(node: any, ancestorType: string): boolean {
  let p = node.parent
  let hops = 0
  while (p && hops < 60) {
    if (p.type === ancestorType) return true
    p = p.parent
    hops++
  }
  return false
}

const sum = (k: keyof Row) => rows.reduce((a, r) => a + (r[k] as number), 0)

console.log("=== bash recall census ===")
console.log("corpus:", CORPUS, "files:", rows.length)
console.log(JSON.stringify({
  totalCommandsInTrees: sum("commands"),
  totalCallsEdgesEmitted: sum("emittedCalls"),
  commandsSuppressedByCaseDepth: sum("commandsDroppedByCase"),
  commandsUnderNegatedCommand: sum("commandsUnderNegated"),
  commandsUnderProcessSubstitution: sum("commandsUnderProcessSub"),
  totalVarNamesInTrees: sum("varNames"),
  totalUsesEdgesEmitted: sum("emittedUses"),
  arithmeticVarNames: sum("arithmeticVarNames"),
  arithmeticNamesThatGotAUsesEdge: sum("arithmeticEmitted"),
  heredocVarNames: sum("heredocVarNames"),
  heredocNamesThatGotAUsesEdge: sum("heredocEmitted"),
}, null, 2))

console.log("\n=== container census: name-bearing children per node type ===")
const interesting = [...containerCensus.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
for (const [t, c] of interesting) {
  if (CONTAINERS.has(t) || NAME_BEARING.has(t)) console.log(String(c).padStart(8), t)
}
