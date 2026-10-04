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
/**
 * `silentByConstruction` is the field the first version of this script did not
 * have, and its absence produced a machine-readable claim that is false for
 * THREE of the four entries.
 *
 * The old line was `instrumentASettlesIt: present.length === 0`. That is the
 * right arithmetic and the wrong question. It asks "did any of these node types
 * appear in the corpus?", which for three of these four types is a question about
 * the GRAMMAR's vocabulary rather than about the corpus, so the answer is `true`
 * whatever the corpus contains:
 *
 *   overrides     Lua expresses a redefinition as a SECOND `function_declaration`.
 *                  No corpus can make an `override_specifier` node appear, because
 *                  the grammar cannot produce one at any corpus. The inventory
 *                  would read `true` on a corpus where every function is
 *                  redefined, which is exactly the corpus where the ruling is
 *                  wrong. Only instrument B can see it, and probe B1 counted 65
 *                  redefinitions across 37 files.
 *   extends       `setmetatable(D, B)` is an ordinary `function_call` with two
 *                  identifier arguments. Nothing about it needs a new node type.
 *   instantiates  `Table:new(...)` is likewise an ordinary `function_call`.
 *
 * So the committed artifact asserted `instrumentASettlesIt: true` for `overrides`,
 * `extends` and `instantiates` while this lane's own doc says instrument A is
 * silent for them. That contradiction is not cosmetic: `ontology-coverage-gate.ts`
 * consumes a table of exactly this shape, so a `RULED_BY_LANG.lua` built from
 * this artifact would have reported `extends` and `instantiates` RULED-SOUND and
 * been contradicted by the lane's own 171 and 122 emitted edges.
 *
 * `implements` is the one entry where the inventory IS conclusive, and for a
 * reason worth stating rather than assuming: Lua has no `class` keyword, no
 * `interface` keyword, and no declaration form for a type at all, so there is no
 * node type ANY corpus could produce. The absence is a property of the language's
 * vocabulary. Instrument B was still run (1,295 supertype links across 453 files,
 * every one of them the relation `extends` already publishes) because a second
 * measurement of the same absence is worth more than one.
 */
const WOULD_MEAN: Record<string, { type: string; describe: string; nodeTypes: string[]; silentByConstruction: boolean; why: string }> = {
  implements: {
    type: "implements",
    describe: "a supertype clause naming an implemented or conformed-to type",
    nodeTypes: ["implements_clause", "extends_clause", "superclass", "interface_implementation", "interface_declaration", "trait_declaration"],
    silentByConstruction: false,
    why: "Lua has no type declaration of any kind, so no corpus can produce a supertype clause. The inventory is conclusive here.",
  },
  overrides: {
    type: "overrides",
    describe: "a second declaration replacing a prior one",
    nodeTypes: ["override_specifier", "redefinition", "override_declaration"],
    silentByConstruction: true,
    why: "A redefinition IS a second function_declaration / variable_declaration. The grammar expresses it and cannot also express its ABSENCE, so a node-type count is 0 on every possible corpus. Instrument B is the only instrument that can falsify this ruling, and it did: 65 redefinitions across 37 files.",
  },
  instantiates: {
    type: "instantiates",
    describe: "a constructor call",
    nodeTypes: ["new_expression", "object_creation_expression", "constructor_invocation"],
    silentByConstruction: true,
    why: "`Table:new(...)` is an ordinary function_call with a method_index_expression callee. Lua has no `new` keyword, so there is no node type to count. This lane emits 122 such edges.",
  },
  extends: {
    type: "extends",
    describe: "a type declaration another type could extend",
    nodeTypes: ["class_declaration", "class", "struct_declaration", "inheritance_specifier"],
    silentByConstruction: true,
    why: "`setmetatable(D, B)` is an ordinary function_call with two identifier arguments. Lua's only type relation is a runtime call, so a grammar inventory cannot see it. This lane emits 171 such edges.",
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
    return [k, {
      describe: v.describe,
      nodeTypesThatWouldMeanIt: v.nodeTypes,
      presentInCorpus: present,
      /** `present.length === 0` alone is the WRONG question for an entry the
       * grammar cannot express the construct for — it is 0 on every possible
       * corpus. See silentByConstruction for why three of the four entries are
       * that way and what instrument settles them instead. */
      nodeTypesAbsentInCorpus: present.length === 0,
      silentByConstruction: v.silentByConstruction,
      instrumentASettlesIt: present.length === 0 && !v.silentByConstruction,
      instrumentThatSettlesIt: v.silentByConstruction
        ? "B:parse-tree-count (a node-type inventory cannot see multiplicity, and this construct is an ordinary call or a repeat declaration)"
        : "A:grammar-inventory",
      why: v.why,
    }]
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
