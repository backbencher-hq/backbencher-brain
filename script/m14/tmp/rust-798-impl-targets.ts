// rust #798 — the impl-target NAME surface, enumerated rather than guessed.
//
// R10's conviction for rust is one root with three surfaces: the impl SYMBOL is
// named after the implemented type, the `implements` edge's SOURCE is that same
// text, and `Self` inside the impl resolves to it too. When the implemented type
// is not nominal (`&mut ProcessBuilder`, `[u8]`, `(T, U)`, `&'a Path`) the
// published string is source TEXT, not a name.
//
// Before choosing a naming rule, count the shapes that actually occur: node
// type, the trait's presence, and whether the current name is a bare name.
//
// Run: bun script/m14/tmp/rust-798-impl-targets.ts <repoRoot>
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const root = process.argv[2]
const files: string[] = []
const walk = (dir: string) => {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".rs")) files.push(p)
  }
}
walk(root)
files.sort()

const parser = await ASTEngine.getParser("rust" as any)
const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/

const shapes = new Map<string, number>()
const bareNames = new Map<string, number>()
const nonNominal: string[] = []
const NON_NOMINAL_NODES = new Set([
  "slice_type", "array_type", "tuple_type", "unit_type", "never_type",
  "function_type", "dynamic_type", "bounded_type", "qualified_type",
  "macro_invocation", "reference_type", "pointer_type", "parenthesized_type",
  "removed_type",
])
let impls = 0
let withTrait = 0
let nonNominalNoTrait = 0

const leafOf = (n: any): { node: any; ok: boolean } => {
  // descend through transparent wrappers to the innermost name-bearing node
  let cur = n
  for (let guard = 0; guard < 20; guard++) {
    const t = cur.type
    if (t === "reference_type" || t === "pointer_type" || t === "parenthesized_type") {
      const inner = cur.childForFieldName("type") ?? cur.namedChild(cur.namedChildCount - 1)
      if (!inner) break
      cur = inner
      continue
    }
    break
  }
  if (cur.type === "type_identifier" || cur.type === "primitive_type") return { node: cur, ok: true }
  if (cur.type === "scoped_type_identifier" || cur.type === "generic_type") {
    const nameField = cur.childForFieldName("name")
    if (nameField) return leafOf(nameField)
    const first = cur.namedChild(0)
    if (first) return leafOf(first)
  }
  return { node: cur, ok: false }
}

for (const f of files) {
  const content = fs.readFileSync(f, "utf8")
  let rootNode: any
  try {
    rootNode = parser.parse(content).rootNode
  } catch {
    continue
  }
  if (!rootNode) continue
  const rel = path.relative(root, f)
  const stack: any[] = [rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "impl_item") {
      impls++
      const typeNode = n.childForFieldName("type")
      const traitNode = n.childForFieldName("trait")
      if (traitNode) withTrait++
      const t = typeNode ? typeNode.type : "<none>"
      shapes.set(t, (shapes.get(t) ?? 0) + 1)
      if (typeNode) {
        const text = String(typeNode.text)
        if (BARE.test(text)) bareNames.set(text, (bareNames.get(text) ?? 0) + 1)
        else {
          const leaf = leafOf(typeNode)
          if (!traitNode) nonNominalNoTrait++
          if (nonNominal.length < 100000) {
            nonNominal.push(
              `${t} ${JSON.stringify(text)} leaf=${JSON.stringify(leaf.node.text)}(${leaf.node.type},ok=${leaf.ok}) trait=${traitNode ? JSON.stringify(String(traitNode.text)) : "NONE"} @ ${rel}:${n.startPosition.row + 1}`,
            )
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

console.log(`repo=${root} files=${files.length} impls=${impls} withTrait=${withTrait} nonNominalNoTrait=${nonNominalNoTrait}`)
console.log("impl type node shapes:", JSON.stringify(Object.fromEntries([...shapes].sort((a, b) => b[1] - a[1]))))
console.log(`\nnon-nominal implemented types (${nonNominal.length}${nonNominal.length >= 80 ? "+" : ""}):`)
for (const s of nonNominal) console.log("  " + s)
