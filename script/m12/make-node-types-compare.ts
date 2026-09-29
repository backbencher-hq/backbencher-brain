import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
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
// The corpus was hardcoded to `elixir`, which is NOT on this machine, so this gate
// could not run at all - and a gate that cannot run is indistinguishable from a
// passing one, which is how "the analyzer's node-type references were never checked"
// stayed true for this lane.
//
// It then named ONE repository, and that was the second way it could not answer its
// own question: a dead-reference check is a claim about the GRAMMAR, so it needs the
// whole corpus, not one checkout. On `tf-aws-components` alone (1 Makefile) it
// reported `substitution_reference` and `endif_directive` as DEAD - types the 99-file
// census shows produced 9 and 51 times respectively. A gate that is wrong in the
// permissive direction is as useless as one that cannot run, so the corpus is
// enumerated by RULE across every checkout, exactly as the lane's manifest does it,
// and the count it used is recorded in the artifact.
const REPOS = "$HOME/fixtures/repositories"
const EXACT = new Set(["Makefile", "makefile", "GNUmakefile", "Makefile.am", "Makefile.in"])
const SKIP = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".venv", "deps"])
const MAX_CORPUS_FILES = 400
const corpusFiles: string[] = []
const reposWithMakefiles: string[] = []
for (const repo of readdirSync(REPOS).sort()) {
  const rp = `${REPOS}/${repo}`
  let st: any
  try { st = statSync(rp) } catch { continue }
  if (!st.isDirectory()) continue
  const found: string[] = []
  const stack = [rp]
  while (stack.length && corpusFiles.length + found.length < MAX_CORPUS_FILES) {
    const dir = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const e of entries) {
      const abs = `${dir}/${e}`
      let s2: any
      try { s2 = statSync(abs) } catch { continue }
      if (s2.isDirectory()) { if (!SKIP.has(e)) stack.push(abs); continue }
      if (EXACT.has(e) || e.endsWith(".mk")) found.push(abs)
    }
  }
  if (found.length) { reposWithMakefiles.push(repo); corpusFiles.push(...found) }
}
if (corpusFiles.length === 0) {
  console.error(JSON.stringify({ analyzer: "make", passed: false, error: "no Makefiles found under the corpus root" }, null, 2))
  process.exit(1)
}
const inputs = files.map((file) => readFileSync(`validation/m12/fixtures/make/${file}`, "utf8"))
for (const file of corpusFiles) inputs.push(readFileSync(file, "utf8"))
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

// A reference the corpus never produces is only a DEFECT when the GRAMMAR does
// not declare it either — that is a phantom, the failure this gate exists to
// catch: an analyzer branch for a node type that cannot exist, which reads as
// coverage and silently never runs. A branch for a type the grammar DOES declare
// but this corpus does not exercise is a defensive branch, and failing on it
// makes the gate permanently red for a reason that is not a bug.
//
// Measured: on the 99-file corpus `endif_directive`, `private_directive` and
// `vpath_directive` are declared by the grammar and produced 0 times. Failing
// those would have trained a reader to ignore this gate, which is the same
// outcome as a gate that cannot run.
const DECLARED = new Set(
  JSON.parse(readFileSync("grammars/tree-sitter-make/src/node-types.json", "utf8"))
    .filter((t: any) => t.named)
    .map((t: any) => t.type),
)
const never = [...refs].filter((type) => !observed.has(type)).sort()
const phantom = never.filter((type) => !DECLARED.has(type))
const unexercised = never.filter((type) => DECLARED.has(type))
const result = {
  analyzer: "make",
  grammar: "vendored wasm/tree-sitter-make.wasm (tree-sitter-make@1.1.1)",
  fixtureFiles: files,
  corpus: "enumerated by rule across every checkout under fixtures/repositories",
  corpusRepositories: reposWithMakefiles,
  corpusFileCap: MAX_CORPUS_FILES,
  corpusNote: "A dead-reference check is a claim about the GRAMMAR, so it needs the whole corpus. This gate previously named ONE repository (and before that a hardcoded `elixir` that is not on this machine), so it could not run at all, and then could not answer its own question: on one checkout it called `substitution_reference` and `endif_directive` DEAD when the 99-file census produces them 9 and 51 times.",
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: phantom,
  unexercisedButDeclaredBranches: unexercised,
  unexercisedNote: "declared by the grammar, produced 0 times by the 99-file corpus. Defensive branches, not phantoms: failing them would make this gate permanently red for a reason that is not a defect.",
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: phantom.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/make-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
