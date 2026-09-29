import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

// The GRAMMAR, not the parser. `ASTEngine.getParser()` returns a Parser, which has no
// `nodeTypeCount` / `nodeTypeForId` — only a Language does. Loading the parser and asking
// it for node types yields an empty vocabulary, which made every extracted candidate look
// like a non-node-type and left the gate passing on its hardcoded fallback list. A gate
// that silently falls back to a weaker check while reporting green is the worst outcome
// available, so the Language is loaded from the same wasm the engine loads.
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const yamlGrammar = await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-yaml.wasm")))

const source = readFileSync("src/ast/real-yaml-analyzer.ts", "utf8")
const candidates = new Set<string>()
for (const match of source.matchAll(/(?:\.type\s*===\s*|new Set\(\[|case\s+)(?:["']?)([A-Za-z_]+)(?:["'])?/g)) {
  if (match[1] && match[1].includes("_")) candidates.add(match[1])
}

// A candidate is only a NODE TYPE if the GRAMMAR declares it. The extractor reads every
// `new Set([...])` of underscored strings as a node-type table, which also catches this
// lane's KEY-SPELLING tables — `DEPENDS_ON_KEYS`, `RESOURCE_REF_KEYS`,
// `SENSITIVE_KEY_NAMES`. `depends_on` is a key a Compose file writes, not a node the
// grammar produces, and reporting it as a "dead defensive reference" was the extractor
// guessing. This asks the grammar instead, which is the same discipline M14.0.F1 uses.
const grammarNodeTypes = new Set<string>()
for (let id = 0; id < yamlGrammar.nodeTypeCount; id++) grammarNodeTypes.add(yamlGrammar.nodeTypeForId(id))
const refs = new Set<string>([...candidates].filter((c) => grammarNodeTypes.has(c)))
const rejectedCandidates = [...candidates].filter((c) => !grammarNodeTypes.has(c)).sort()
for (const type of ["stream", "document", "block_node", "flow_node", "block_mapping", "flow_mapping", "block_mapping_pair", "flow_pair", "block_sequence", "flow_sequence", "block_sequence_item", "anchor", "anchor_name", "alias", "alias_name", "plain_scalar", "string_scalar", "single_quote_scalar", "double_quote_scalar", "integer_scalar", "float_scalar", "boolean_scalar", "null_scalar", "block_scalar"]) refs.add(type)

const parser = await ASTEngine.getParser("yaml")
const observed = new Set<string>()
// BOTH fixture lanes. The M12 fixtures are the differential's four files; the M14 lane
// is the analyzer's real fixture set and is where directives, tags, anchors and merge
// keys are exercised. Reading only the former reported `%YAML`/`%TAG` as dead defensive
// references on a lane that has a fixture for each — a gate reading the wrong inputs is
// worse than no gate, because its red row looks like a defect.
const m12Files = readdirSync("validation/m12/fixtures/yaml").filter((file) => /\.(yaml|yml)$/i.test(file)).sort()
const m14Dir = "validation/m14/fixtures/yaml"
const m14Files = existsSync(m14Dir) ? readdirSync(m14Dir).filter((file) => /\.(yaml|yml)$/i.test(file)).sort() : []
const files = [...m12Files, ...m14Files.map((f) => `m14/${f}`)]
const corpus = "$HOME/fixtures/repositories/grails-core"
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.yaml", "*.yml"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort()
const inputs = [
  ...m12Files.map((file) => readFileSync(`validation/m12/fixtures/yaml/${file}`, "utf8")),
  ...m14Files.map((file) => readFileSync(`${m14Dir}/${file}`, "utf8")),
]
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
/**
 * A type the grammar declares, the analyzer names, and NO input exercises is a real
 * signal — the analyzer has a branch nothing has proven. It is not automatically a
 * defect, so each such type is classified with a reason rather than either excused or
 * failed. `timestamp_scalar` is the known one: the wired build is the `core` schema
 * variant (grammar src/scanner.c selects it with -DYAML_SCHEMA) and only the `legacy`
 * backend has an RS_TIMESTAMP resolution, so the type is in the grammar and in the wasm
 * and the wired build never produces it. See script/m14/spec/yaml-completeness.json
 * design_decision YAML-D6.
 */
const DECLARED_UNREACHABLE: Record<string, string> = {
  timestamp_scalar: "produced only by the `legacy` scalar backend (HAS_TIMESTAMP 1); the wired build is the `core` one (HAS_TIMESTAMP 0), so no input can reach it",
}
const live = [...refs].filter((type) => observed.has(type)).sort()
const unobserved = [...refs].filter((type) => !observed.has(type))
const declaredUnreachable = unobserved.filter((type) => DECLARED_UNREACHABLE[type])
const dead = unobserved.filter((type) => !DECLARED_UNREACHABLE[type])
const result = {
  analyzer: "yaml",
  grammar: "wasm/tree-sitter-yaml.wasm",
  grammarVocabulary: { ids: yamlGrammar.nodeTypeCount, fieldCount: yamlGrammar.fieldCount },
  fixtureFiles: files,
  m12FixtureFiles: m12Files,
  m14FixtureFiles: m14Files,
  corpus: "grails-core@a83f8748",
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  declaredUnreachable: declaredUnreachable.map((type) => ({ type, reason: DECLARED_UNREACHABLE[type] })),
  rejectedNonNodeTypeCandidates: rejectedCandidates,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/yaml-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
