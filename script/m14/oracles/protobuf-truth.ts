/**
 * The Protobuf oracle — LANE-OWNED, written from the .proto language definition and the lane's own
 * measured conventions, sharing no rule table or resolver with `RealProtobufAnalyzer`.
 *
 * ## What it derives
 *
 *  - `contains`  — the package contains every top-level definition; a message contains its nested
 *                  definitions, its fields and its oneof members; an enum contains its values.
 *                  Names are FULLY QUALIFIED (`pkg.Outer.Inner`), which is the spelling the lane
 *                  publishes, and a name's leaf is what the differential compares.
 *  - `references`— a field whose written type is a MESSAGE or ENUM name references that type. Scalar
 *                  field types (the fifteen protobuf scalars) are not references: the lane emits
 *                  none for them, and a truth row for `string` would be a false MISSING.
 *  - `imports`   — every `import` statement, target = the path EXACTLY as written (the differential
 *                  compares import paths exactly, not by leaf).
 *  - `exports`   — `import public "x"` RE-EXPORTS the path: the lane publishes BOTH an imports and an
 *                  exports row for it, measured on the imports-and-editions fixture.
 *
 * ## What it deliberately does not claim
 *
 * Service/rpc declarations produce no edges in this lane (measured on google/iam/admin/v1/iam.proto:
 * 237 contains / 94 references / 10 imports and nothing else), so the oracle derives nothing from
 * them. Groups, maps and extensions are derived only as far as their FIELD name; a shape the oracle
 * does not model shows up as an unexplained analyzer row rather than as a silent pass.
 */
export type ProtobufEdge = { label: string; from: string; target: string }

const SCALARS = new Set([
  "double", "float", "int32", "int64", "uint32", "uint64", "sint32", "sint64",
  "fixed32", "fixed64", "sfixed32", "sfixed64", "bool", "string", "bytes",
])
const children = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
const firstOfType = (n: any, type: string): any | undefined => children(n).find((c: any) => c.type === type)
const txt = (n: any): string => (n ? String(n.text ?? "") : "")
/** The definition's own name, from the grammar's `*_name` wrapper. */
function defName(node: any): string {
  for (const c of children(node)) {
    if (c.type === "message_name" || c.type === "enum_name") {
      return txt(firstOfType(c, "message_or_enum_type") ?? c)
    }
    if (c.type === "identifier") return txt(c)
  }
  return ""
}
/** A field's identifier: the `identifier` child (not the type, which is its own node). */
function fieldName(node: any): string {
  const id = firstOfType(node, "identifier")
  if (id) return txt(id)
  for (const c of children(node)) if (c.type === "identifier") return txt(c)
  return ""
}
/** The written type of a field, wrapped in `type` (repeated/optional labels live beside it). */
function fieldTypeName(node: any): string {
  const t = firstOfType(node, "type")
  if (!t) return ""
  const inner = children(t)
  if (inner.length === 0) return txt(t)
  const first = inner[0]
  if (first.type === "message_or_enum_type" || first.type === "full_ident") return txt(first)
  return txt(first)
}

export function deriveProtobufTruth(root: any): ProtobufEdge[] {
  const edges: ProtobufEdge[] = []
  const push = (label: string, from: string, target: string) => {
    if (from && target) edges.push({ label, from, target })
  }
  const sourceFile = children(root).find((c: any) => c.type === "source_file") ?? root
  let pkg = ""
  for (const c of children(sourceFile)) {
    if (c.type === "package") pkg = txt(firstOfType(c, "full_ident") ?? c).replace(/^package\s+/, "").replace(/;$/, "").trim()
  }
  for (const c of children(sourceFile)) {
    if (c.type !== "import") continue
    const text = txt(c)
    const m = /"([^"]+)"/.exec(text)
    const path = m ? m[1] : ""
    if (!path) continue
    push("imports", pkg || "(file)", path)
    if (/\bimport\s+public\b/.test(text)) push("exports", pkg || "(file)", path)
  }

  const walkDef = (node: any, parentFqn: string) => {
    const name = defName(node)
    const fqn = parentFqn ? (name ? `${parentFqn}.${name}` : parentFqn) : name
    if (name) push("contains", parentFqn, fqn)
    const body = firstOfType(node, "message_body") ?? firstOfType(node, "enum_body") ?? node
    for (const c of children(body)) {
      if (c.type === "message" || c.type === "enum") walkDef(c, fqn)
      else if (c.type === "field") {
        const fname = fieldName(c)
        if (!fname) continue
        push("contains", fqn, `${fqn}.${fname}`)
        const t = fieldTypeName(c)
        const leaf = t.split(".").pop() ?? t
        if (t && !SCALARS.has(leaf)) push("references", `${fqn}.${fname}`, t.replace(/^\./, ""))
      } else if (c.type === "enum_field") {
        const vname = fieldName(c) || txt(firstOfType(c, "identifier") ?? c)
        if (vname) push("contains", fqn, `${fqn}.${vname}`)
      } else if (c.type === "oneof" || c.type === "oneof_body") {
        for (const f of children(c)) {
          if (f.type !== "field") continue
          const fname = fieldName(f)
          if (!fname) continue
          push("contains", fqn, `${fqn}.${fname}`)
          const t = fieldTypeName(f)
          const leaf = t.split(".").pop() ?? t
          if (t && !SCALARS.has(leaf)) push("references", `${fqn}.${fname}`, t.replace(/^\./, ""))
        }
      }
    }
  }
  for (const c of children(sourceFile)) {
    if (c.type === "message" || c.type === "enum") walkDef(c, pkg)
  }
  return edges
}
