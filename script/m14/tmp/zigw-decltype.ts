/**
 * ZIG WAVE 1 PROBE — the DECLARED-TYPE GRAPH AUDIT.
 *
 * The declared-type graph is zig's largest unaudited relationship class: the
 * differential compares only `calls` and `uses` for this lane, so NOTHING here
 * has a second opinion. This probe measures the class from the tree side:
 *
 *   1. quoted identifiers `@"..."` — the ONLY receiver shape on which the
 *      analyzer's junk-strip regex can fire at all.
 *   2. parameter/container_field leaves: the analyzer's identifier-WALK against
 *      the grammar's `type` FIELD, with the analyzer's own builtin exclusion
 *      applied, so only the sites that change an emitted target are counted.
 *   3. return positions: which node types actually occur as a return type, and
 *      which the analyzer's collection list covers.
 *   4. the LOCAL annotation position (`var x: MyType = ...`) — one of the four
 *      family positions, absent from zig's collector.
 *   5. compound-assignment LHS reads dropped by the write gate.
 */
import * as fs from "fs"
import { init, zigFiles, parser } from "./zigw-harness"

const BUILTINS = new Set(["void", "bool", "f16", "f32", "f64", "f80", "f128", "c_longdouble", "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "anytype", "comptime_int", "comptime_float", "noreturn", "type", "anyerror", "c_char", "c_short", "c_int", "c_long", "c_longlong", "c_uint", "c_ulong", "c_ulonglong", "c_void", "error", "test"])

/** Verbatim replica of the analyzer's zigTypeLeafNode. */
function walkLeaf(node: any): any {
  if (node.type === "identifier") return node
  const ids: any[] = []
  const stack: any[] = [node]
  let guard = 0
  while (stack.length > 0 && guard++ < 200) {
    const n = stack.pop()
    if (n.type === "identifier") ids.push(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (ids.length === 0) return null
  if ((node.type === "parameter" || node.type === "container_field") && node.namedChildCount > 0 && node.namedChild(0)?.type === "identifier") {
    ids.shift()
    if (ids.length === 0) return null
  }
  return ids[ids.length - 1]
}

/** The analyzer's push() filter, verbatim. */
function emittedHead(leaf: string | null): string | null {
  if (!leaf) return null
  const trim = leaf.replace(/[!*\s\[\]{}]+/g, "").trim()
  if (!trim) return null
  const base = trim.split("<or>")[0] ?? trim
  const head = base.indexOf("=") !== -1 ? base.slice(0, base.indexOf("=")).trim() : base
  if (!head || BUILTINS.has(head)) return null
  if (head.length > 0 && head.charCodeAt(0) >= 48 && head.charCodeAt(0) <= 57) return null
  return head
}

/** The leaf of the grammar's `type` field (last identifier under it). */
function fieldLeaf(typeNode: any): string | null {
  if (!typeNode) return null
  if (typeNode.type === "builtin_type") return null
  if (typeNode.type === "identifier") return typeNode.text
  const stack: any[] = [typeNode]
  const ids: any[] = []
  let guard = 0
  while (stack.length > 0 && guard++ < 200) {
    const n = stack.pop()
    if (n.type === "identifier") ids.push(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return ids.length > 0 ? ids[ids.length - 1].text : null
}

const COLLECTED = new Set(["error_union_type", "nullable_type", "pointer_type", "slice_type", "builtin_type", "identifier", "field_expression"])

async function main(): Promise<void> {
  await init()
  const files = zigFiles()
  const quoted = new Map<string, number>()
  const quotedEx: string[] = []
  const leafDisagree = new Map<string, { n: number; ex: string[] }>()
  const retTypes = new Map<string, number>()
  const retUncovered = new Map<string, { n: number; ex: string[] }>()
  const localAnn = new Map<string, { n: number; ex: string[] }>()
  const compound = new Map<string, { n: number; ex: string[] }>()
  const bump = (m: Map<string, { n: number; ex: string[] }>, k: string, ex: string) => {
    const d = m.get(k)
    if (d) { d.n++; if (d.ex.length < 3) d.ex.push(ex) }
    else m.set(k, { n: 1, ex: [ex] })
  }

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const where = (n: any) => `${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}`
    const visit = (n: any, inFn: boolean): void => {
      if (n.type === "identifier" && n.text.startsWith('@"')) {
        quoted.set(n.text, (quoted.get(n.text) ?? 0) + 1)
        if (quotedEx.length < 8) quotedEx.push(`${where(n)}  ${n.text.replace(/\n/g, " ")}`)
      }
      if (n.type === "parameter" || n.type === "container_field") {
        const tf = n.childForFieldName ? n.childForFieldName("type") : null
        if (tf) {
          const a = emittedHead(walkLeaf(n)?.text ?? null)
          const t = emittedHead(fieldLeaf(tf))
          if (a !== t) {
            bump(leafDisagree, `${n.type}|analyzer=${a ?? "<none>"}|field=${t ?? "<none>"}`, `${where(n)}  ${n.text.replace(/\s+/g, " ").slice(0, 90)}`)
          }
        }
      }
      if (n.type === "function_declaration") {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        const ret = kids.filter((c) => c.type !== "identifier" || kids.indexOf(c) !== 0).find((c) => COLLECTED.has(c.type))
        if (!ret) {
          // what IS in return position but uncollected?
          for (const c of kids.slice(1)) {
            if (c.type === "parameters" || c.type === "block") continue
            retTypes.set(c.type, (retTypes.get(c.type) ?? 0) + 1)
            if (!COLLECTED.has(c.type) && emittedHead(fieldLeaf(c)) !== null) {
              bump(retUncovered, c.type, `${where(n)}  ${c.text.replace(/\s+/g, " ").slice(0, 80)}`)
            }
          }
        }
      }
      if (n.type === "variable_declaration" && inFn) {
        const tf = n.childForFieldName ? n.childForFieldName("type") : null
        if (tf) {
          const t = emittedHead(fieldLeaf(tf))
          if (t !== null) bump(localAnn, tf.type, `${where(n)}  ${n.text.replace(/\s+/g, " ").slice(0, 84)}`)
        }
      }
      if (n.type === "variable_declaration" || n.type === "assignment_expression") {
        const op = n.childForFieldName ? n.childForFieldName("operator") : null
        if (op && op.type !== "=") {
          const lhs = n.namedChildCount > 0 ? n.namedChild(0) : null
          if (lhs && (lhs.type === "field_expression" || lhs.type === "index_expression" || lhs.type === "dereference_expression")) {
            bump(compound, `${lhs.type}|${op.type}`, `${where(n)}  ${n.text.replace(/\s+/g, " ").slice(0, 70)}`)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, inFn || n.type === "function_declaration" || n.type === "test_declaration" || n.type === "comptime_declaration" || n.type === "function_signature")
      }
    }
    visit(tree.rootNode, false)
    tree.delete()
  }

  console.log(`files: ${files.length}`)
  console.log(`\n=== 1. quoted identifiers: ${[...quoted.values()].reduce((a, b) => a + b, 0)} occurrences, ${quoted.size} distinct ===`)
  for (const [k, v] of [...quoted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(5)}  ${k}`)
  for (const e of quotedEx) console.log(`   ${e}`)

  console.log(`\n=== 2. parameter/container_field leaf: analyzer-walk vs grammar type FIELD (emitted heads only) ===`)
  const tot2 = [...leafDisagree.values()].reduce((a, b) => a + b.n, 0)
  console.log(`   sites where the EMITTED target differs: ${tot2} in ${leafDisagree.size} shapes`)
  for (const [k, v] of [...leafDisagree.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) {
    console.log(`\n   ${String(v.n).padStart(6)}  ${k}`)
    for (const e of v.ex) console.log(`          ${e}`)
  }

  console.log(`\n=== 3. return-position node types (first found child not collected) ===`)
  for (const [k, v] of [...retTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`   ${String(v).padStart(6)}  ${k}`)
  console.log(`   -- of those, UNCOLLECTED but naming a real type:`)
  for (const [k, v] of [...retUncovered.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`\n   ${String(v.n).padStart(6)}  ${k}`)
    for (const e of v.ex) console.log(`          ${e}`)
  }

  console.log(`\n=== 4. LOCAL annotations naming a real type (position absent from zig) ===`)
  const tot4 = [...localAnn.values()].reduce((a, b) => a + b.n, 0)
  console.log(`   total: ${tot4}`)
  for (const [k, v] of [...localAnn.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
    console.log(`\n   ${String(v.n).padStart(6)}  ${k}`)
    for (const e of v.ex) console.log(`          ${e}`)
  }

  console.log(`\n=== 5. compound-assignment LHS (write gate suppresses the read) ===`)
  for (const [k, v] of [...compound.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
    console.log(`\n   ${String(v.n).padStart(6)}  ${k}`)
    for (const e of v.ex) console.log(`          ${e}`)
  }
}
void main()
