// script/m14/tmp/clean-127-shape-safety.ts
//
// The lane's "shape-safe 32/32 dispatch refs live against the v1.2.4 grammar" claim, re-derived
// against the PINNED v1.2.7 grammar rather than restated.
//
// The claim is a set-inclusion fact and needs no analyzer run: every node-type string the
// analyzer dispatches on must exist in the grammar's own vocabulary
// (`src/node-types.json`, which the wasm was built from — provenance checked separately: all
// 54 tracked files byte-identical to tag v1.2.7). A literal that names nothing in the grammar
// is a dispatch arm that can never fire, which is how a lane silently stops seeing a construct.
//
// Run: bun script/m14/tmp/clean-127-shape-safety.ts
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const ANALYZER = path.join(ROOT, "src/ast/real-clean-analyzer.ts")
const NODE_TYPES = process.env.CLEAN_NODE_TYPES ?? "/tmp/tsc127-prov/src/node-types.json"

const src = readFileSync(ANALYZER, "utf8")

/** Every node type the analyzer compares `n.type` against. */
const referenced = new Set<string>()
for (const m of src.matchAll(/\.type\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) referenced.add(m[1])
for (const m of src.matchAll(/\.type\s*!==\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) referenced.add(m[1])
for (const m of src.matchAll(/n\.type\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) referenced.add(m[1])

interface NT { type: string; named?: boolean }
const nodeTypes: NT[] = JSON.parse(readFileSync(NODE_TYPES, "utf8"))
const vocab = new Set(nodeTypes.map((n) => n.type))

const unknown = [...referenced].filter((t) => !vocab.has(t)).sort()
const known = [...referenced].filter((t) => vocab.has(t)).sort()

console.log(`analyzer:   ${path.relative(ROOT, ANALYZER)}`)
console.log(`vocabulary: ${NODE_TYPES}  (${vocab.size} node types)`)
console.log(`referenced node-type literals: ${referenced.size}   known: ${known.length}   UNKNOWN: ${unknown.length}`)
if (unknown.length) {
  console.log(`\nUNKNOWN — these dispatch arms can never fire against the pinned grammar:`)
  for (const t of unknown) console.log(`   ${t}`)
} else {
  console.log(`\nshape-safe: every referenced node type exists in the pinned grammar's vocabulary`)
}

// The liveness direction matters too: a node type the grammar has and the analyzer names NOWHERE
// is a construct the lane may be blind to. Reported as a count with the new-in-v1.2.7 ones named,
// because that is the class a grammar bump creates.
const v124 = process.env.CLEAN_NODE_TYPES_OLD ?? "/tmp/nonexistent-old.json"
let oldVocab: Set<string> | null = null
try { oldVocab = new Set((JSON.parse(readFileSync(v124, "utf8")) as NT[]).map((n) => n.type)) } catch { /* not provided */ }
if (oldVocab) {
  const added = [...vocab].filter((t) => !oldVocab!.has(t)).sort()
  const unreferenced = [...vocab].filter((t) => !referenced.has(t)).sort()
  console.log(`\nnode types NEW in v1.2.7 vs v1.2.4: ${added.length}`)
  for (const t of added) console.log(`   ${referenced.has(t) ? "referenced  " : "UNREFERENCED"} ${t}`)
  console.log(`\ngrammar node types the analyzer names nowhere: ${unreferenced.length} of ${vocab.size}`)
} else {
  console.log(`\n(pass CLEAN_NODE_TYPES_OLD=<v1.2.4 node-types.json> to also list the vocabulary delta)`)
}
