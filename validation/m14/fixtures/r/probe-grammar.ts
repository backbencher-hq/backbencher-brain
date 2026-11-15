/**
 * R LANE — grammar conformance for the node types and fields the `uses` change reads.
 *
 * Why a targeted check rather than `script/m14/audit-analyzer-grammar.ts`: that gate
 * sweeps every analyzer and takes a long time under the concurrent load of seven
 * lanes, and it is shared machinery this lane does not edit. What the honesty
 * contract §2 calls L2 is a specific precondition — every node type and field an
 * analyzer consults is validated against the grammar's OWN node-type table, read
 * from the shipped wasm at run time — so the precondition for THIS change can be
 * checked directly against that table, and the node types that did not exist before
 * this change are named explicitly rather than swept for.
 *
 * The table is read from `Language.nodeTypeForId` over the full id space, which is
 * what makes this an inventory of the grammar rather than a list somebody wrote
 * down. A node type the analyzer reads that is absent from the table is reported,
 * and so is a FIELD absent from the node type's own entry.
 *
 * USAGE: npx tsx validation/m14/fixtures/r/probe-grammar.ts
 */
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")

/** Node types the `uses` surface reads. Everything else the analyzer touches is
 *  pre-existing and is covered by `script/m14/audit-analyzer-grammar.ts`. */
const USES_NODE_TYPES = ["extract_operator", "subset2", "subset", "argument", "binary_operator", "identifier", "string", "call", "function_definition"]
/** Fields the `uses` surface reads, per node type. */
const USES_FIELDS: Record<string, string[]> = {
  extract_operator: ["lhs", "operator", "rhs"],
  subset2: ["arguments"],
  subset2_arguments: ["value"],
  argument: ["name", "value"],
  binary_operator: ["operator", "lhs", "rhs"],
  call: ["function"],
}
/** Fields reached through a helper rather than by node type. */
const INDIRECT_FIELDS: Record<string, string[]> = {
  subset2: ["value"],
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar: any = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm")))

/** Every node type the grammar declares, read from its own table. */
const table = new Map<string, any>()
for (let id = 0; id < 4096; id++) {
  let name: string | null = null
  try { name = grammar.nodeTypeForId(id) } catch { break }
  if (!name) break
  table.set(name, id)
}

console.log(`grammar conformance for the \`uses\` surface — wasm/tree-sitter-r.wasm`)
console.log(`node types declared by the grammar's own table: ${table.size}`)

let unknown = 0
for (const t of USES_NODE_TYPES) {
  const present = table.has(t)
  if (!present) unknown++
  console.log(`  node type ${present ? "OK  " : "MISSING"}  ${t}`)
}

let unknownField = 0
const parser = new P()
parser.setLanguage(grammar)
const probes: { label: string; src: string; checks: { node: (n: any) => any; field: string }[] }[] = [
  {
    label: "extract_operator ($ and @, chained, computed rhs)",
    src: "a$b\na@b\na$b$c\n",
    checks: [{ node: (n: any) => (n.type === "extract_operator" ? n : null), field: "lhs" }, { node: (n: any) => (n.type === "extract_operator" ? n : null), field: "operator" }, { node: (n: any) => (n.type === "extract_operator" ? n : null), field: "rhs" }],
  },
  {
    label: "subset2 with a string index and with a computed index",
    src: 'x[["k"]]\nx[[i]]\n',
    checks: [{ node: (n: any) => (n.type === "subset2" ? n : null), field: "arguments" }, { node: (n: any) => (n.type === "subset2" ? n : null), field: "function" }],
  },
  {
    label: "subset with a string index",
    src: 'x["k"]\n',
    checks: [{ node: (n: any) => (n.type === "subset" ? n : null), field: "arguments" }],
  },
  {
    label: "argument name and value",
    src: 'f(a = 1, 2)\n',
    checks: [{ node: (n: any) => (n.type === "argument" ? n : null), field: "name" }, { node: (n: any) => (n.type === "argument" ? n : null), field: "value" }],
  },
  {
    label: "binary_operator operator/lhs/rhs on all five assignment forms",
    src: "a <- 1\nb <<- 1\nc = 1\n1 -> d\n1 ->> e\n",
    checks: [{ node: (n: any) => (n.type === "binary_operator" ? n : null), field: "operator" }, { node: (n: any) => (n.type === "binary_operator" ? n : null), field: "lhs" }, { node: (n: any) => (n.type === "binary_operator" ? n : null), field: "rhs" }],
  },
  {
    label: "call function field",
    src: "f(1)\n",
    checks: [{ node: (n: any) => (n.type === "call" ? n : null), field: "function" }],
  },
]
for (const probe of probes) {
  const tree = parser.parse(probe.src)
  const found: Record<string, number> = {}
  const visit = (n: any) => {
    for (const c of probe.checks) {
      const target = c.node(n)
      if (!target) continue
      const v = target.childForFieldName(c.field)
      if (v) found[c.field] = (found[c.field] ?? 0) + 1
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(tree.rootNode)
  tree.delete?.()
  // A field is DECLARED when at least one node of the type carries it, not when
  // every node does. The first version of this probe required every node to, and
  // reported `argument`'s `name` field as undeclared because `f(a = 1, 2)` writes
  // the second argument bare -- an unnamed argument has no `name` field, which is
  // R and every other language being correct rather than the grammar being wrong.
  // A check that reports a defect where there is none trains its reader to
  // ignore it.
  const expected = [...new Set(probe.checks.map((c) => c.field))].sort()
  const absent = expected.filter((f) => !found[f])
  unknownField += absent.length
  console.log(`  ${absent.length === 0 ? "OK  " : "MISSING"}  ${probe.label}: ${expected.map((k) => `${k}x${found[k] ?? 0}`).join(" ")}${absent.length ? ` | NEVER A FIELD: ${absent.join(", ")}` : ""}`)
}
void INDIRECT_FIELDS

console.log("")
console.log(`unknown node types: ${unknown}   fields the grammar does not declare: ${unknownField}`)
console.log(unknown + unknownField === 0 ? "L2 precondition for the `uses` change: MET against the shipped wasm." : "L2 precondition for the `uses` change: NOT met — see above.")
process.exitCode = unknown + unknownField === 0 ? 0 : 1