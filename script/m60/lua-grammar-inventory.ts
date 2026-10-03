/**
 * M14 ONTOLOGY CENSUS — lua, INSTRUMENT A: the grammar's own vocabulary.
 *
 * Why this file exists separately from lua-ontology-census.ts. The census records
 * `nodeTypesProduced` as a COUNT (100), and a count cannot be argued with: a
 * reader cannot check whether the node type that would express the construct is in
 * the set, because the set is not written down. The ontology gate's instrument A
 * is "enumerate every node type the grammar actually produces across the corpus and
 * show none expresses the construct", which requires the LIST, not the count.
 *
 * It also records the node types that WOULD mean the construct, and whether the
 * grammar produced any of them. That is what makes a ruling falsifiable: if a
 * future grammar or a future corpus revision introduces one, this artifact says so
 * and the ruling is wrong, without anyone having to re-derive the argument.
 *
 * WHAT THE 100 NODE TYPES SETTLE, and what it does not. Lua is a language with no
 * `class` keyword, no `interface` keyword and no `new`, so its grammar carries no
 * node type for a type declaration at all — that is positive evidence about the
 * LANGUAGE, and it is what rules `implements`. It is equally silent about
 * `overrides`, because a redefinition is simply a second `function_declaration` and
 * a grammar cannot see a repeat; that is why `overrides` needed instrument B
 * (65 occurrences) and could not be ruled from this file. A grammar inventory that
 * settled `overrides` would have been wrong in the same way json's `exports`
 * ruling was, and the reason is the same: a grammar cannot see a CONVENTION.
 *
 * Usage: npx tsx script/m60/lua-grammar-inventory.ts [--cap 400]
 *        --cap bounds files PER REPO (default 400); omit for every tracked file.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const CAP = Number(arg("--cap", "400"))
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/grammar-inventory.json")!)

/** The node types whose presence would mean each ruled construct exists. Taken from
 * the gate's own bash and json tables (script/m14/ontology-coverage-gate.ts) so the
 * lua ruling asks the SAME question those rulings ask. */
const WOULD_MEAN: Record<string, { type: string; describe: string; nodeTypes: string[] }> = {
  implements: {
    type: "implements",
    describe: "a supertype clause naming an implemented or conformed-to type",
    nodeTypes: ["implements_clause", "extends_clause", "superclass", "interface_implementation", "interface_declaration", "trait_declaration"],
  },
  overrides: {
    type: "overrides",
    describe: "a second declaration replacing a prior one",
    nodeTypes: ["override_specifier", "redefinition", "override_declaration"],
  },
  instantiates: {
    type: "instantiates",
    describe: "a constructor call",
    nodeTypes: ["new_expression", "object_creation_expression", "constructor_invocation"],
  },
  extends: {
    type: "extends",
    describe: "a type declaration another type could extend",
    nodeTypes: ["class_declaration", "class", "struct_declaration", "inheritance_specifier"],
  },
}

const files: Array<{ abs: string; text: string; label: string }> = []
let repos = 0
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
      .sort()
  } catch {
    continue
  }
  repos++
  for (const rel of tracked.slice(0, CAP)) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      files.push({ abs, text: readFileSync(abs, "utf8"), label: `${e}/${rel}` })
    } catch {
      continue
    }
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

const counts = new Map<string, number>()
let errorNodes = 0
let errorFiles = 0
let missingNodes = 0
const errorLabels: string[] = []
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  let sawError = false
  const visit = (n: any) => {
    counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    if (n.type === "ERROR") { errorNodes++; sawError = true }
    if (n.isMissing) missingNodes++
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)
  if (sawError) { errorFiles++; if (errorLabels.length < 6) errorLabels.push(f.label) }
  t.delete?.()
}

const produced = [...counts.keys()].sort()
const verdicts = Object.fromEntries(
  Object.entries(WOULD_MEAN).map(([k, v]) => {
    const present = v.nodeTypes.filter((n) => counts.has(n))
    return [k, { describe: v.describe, nodeTypesThatWouldMeanIt: v.nodeTypes, presentInCorpus: present, instrumentASettlesIt: present.length === 0 }]
  }),
)

const artifact = {
  schemaVersion: 1,
  kind: "lua_grammar_inventory",
  at: new Date().toISOString(),
  commit: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpus: { root: CR, repos, filesParsed: files.length, capPerRepo: CAP },
  grammarWasm: "wasm/tree-sitter-lua.wasm",
  distinctNodeTypesProduced: produced.length,
  nodeTypesProduced: produced,
  nodeTypeCounts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
  parseHealth: { errorFiles, errorNodes, missingNodes, errorFileExamples: errorLabels },
  verdicts,
}

writeFileSync(OUT, JSON.stringify(artifact, null, 2))
console.log(`instrument A — ${files.length} files from ${repos} repos, ${produced.length} distinct node types`)
console.log(`error nodes: ${errorNodes} in ${errorFiles} file(s); missing nodes: ${missingNodes}`)
console.log(`\nnode types produced:\n${produced.join(" ")}`)
console.log(`\nfor each ruled type, the node types that WOULD mean it exists:`)
for (const [k, v] of Object.entries(verdicts)) {
  console.log(`  ${k.padEnd(13)} ${v.presentInCorpus.length === 0 ? "NONE of" : `!! ${v.presentInCorpus.join(", ")} IS among`} ${v.nodeTypesThatWouldMeanIt.length} candidates — ${v.describe}`)
}
console.log(`\nartifact: ${path.relative(ROOT, OUT)}`)
