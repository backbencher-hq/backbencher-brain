// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — proven Go receiver-type evidence for selector calls
// (`m.Lock()`, `h.M.Lock()`, `w.Run()`), from the CALLING FILE's own declarations.
// WHY IT IS SHAPED THIS WAY — the index carries no Go types; a selector call was
//   left unresolved even when the file literally declares the receiver's type,
//   so a genuine project-receiver test call was invisible evidence and an
//   external receiver was a name-binding hazard. This helper only returns
//   evidence when a declaration proves it (unique var/param/composite-literal
//   type, then unique struct-field types for chains); anything unknown is null
//   and the caller keeps failing closed.
// WHERE ITS EVIDENCE LIVES — src/ast/parallel-indexer.ts (write-side binding),
//   src/intelligence/testing/test-intel.ts (read-side validation); gates:
//   script/m-fix/verify-receiver-evidence.ts, script/verify-test-intel.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type GoReceiverEvidence = {
  kind: "project" | "external"
  typeName: string
  /** Set for `project` when the project type row is known. */
  typeId?: string
  /** For `project`: does the indexed type declare the called method? */
  ownerHasMethod?: boolean
}

export type GoReceiverContext = {
  /** Source text of the file that makes the call. */
  text: string
  /** Lowercased brain_file.language of the calling file. */
  language: string | null
  /** `brain_import.import_path` values of the calling file. */
  imports: string[]
  /** Stored `callExpression` (e.g. `m.Lock`, `h.M.Lock`, `w.Run`). */
  callExpression: string
  /** The called method name (the leaf, also the stored target name). */
  targetMethod: string
  /** Project type rows with this simple name (symbol_type type-like). */
  projectTypes: (name: string) => Array<{ id: string; fileId: string }>
  /** Project-relative path -> source text, or null when unreadable. */
  readSource: (relativePath: string) => string | null
  /** Project-relative path of an indexed file id. */
  relativePathOfFile: (fileId: string) => string | null
  /** Does the indexed project type `<typeId>` declare a method `<name>`? */
  ownerHasMethod: (typeId: string, method: string) => boolean
}

const TYPE_LIKE_EXCLUDED = new Set(["function", "method", "module", "property", "variable", "parameter", "field"])

export function receiverStripType(text: string): string {
  return text.replace(/[\[\]\s*]/g, "")
}

/** Unique declared type(s) for `root` in a source file: `var x T`, `x := &T{…}`,
 *  `x := T{…}`, `x := new(T)`, and function parameters `x T`. */
export function receiverDeclaredTypes(text: string, root: string): string[] {
  const out: string[] = []
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const patterns = [
    new RegExp(`\\bvar\\s+${esc}\\s+([*\\[\\]]?[A-Za-z_][\\w.]*)`, "g"),
    new RegExp(`\\b${esc}\\s*:=\\s*&?\\s*([A-Za-z_][\\w.]*)\\s*\\{`, "g"),
    new RegExp(`\\b${esc}\\s*:=\\s*new\\(\\s*([A-Za-z_][\\w.]*)\\s*\\)`, "g"),
    new RegExp(`\\b${esc}\\s+([*\\[\\]]?[A-Za-z_][\\w.]*)`, "g"),
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) if (m[1]) out.push(receiverStripType(m[1]))
  }
  return Array.from(new Set(out.filter((t) => t.length > 0 && t !== root)))
}

/** Unique declared type(s) of a struct field in a type's source text. */
export function receiverFieldTypes(text: string, field: string): string[] {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const out: string[] = []
  for (const m of text.matchAll(new RegExp(`\\b${esc}\\s+([*\\[\\]]?[A-Za-z_][\\w.]*)`, "g"))) {
    if (m[1]) out.push(receiverStripType(m[1]))
  }
  return Array.from(new Set(out))
}

export function importPkgKind(imports: string[], pkg: string): "stdlib" | "module" | null {
  for (const spec of imports) {
    const segs = spec.split("/").filter(Boolean)
    if ((segs[segs.length - 1] ?? "") !== pkg) continue
    return segs[0].includes(".") ? "module" : "stdlib"
  }
  return null
}

/** Returns evidence when a declaration proves the receiver; null when it does not. */
export function inferGoReceiverEvidence(ctx: GoReceiverContext): GoReceiverEvidence | null {
  if (String(ctx.language ?? "").toLowerCase() !== "go") return null
  const segments = ctx.callExpression.split(".").filter((seg) => seg.length > 0)
  if (segments.length < 2) return null
  const root = segments[0]
  const declared = receiverDeclaredTypes(ctx.text, root)
  if (declared.length !== 1) return null
  const classify = (typeText: string): { kind: "project" | "external"; typeName: string; typeId?: string } | null => {
    const dot = typeText.lastIndexOf(".")
    const base = dot >= 0 ? typeText.slice(dot + 1) : typeText
    const pkg = dot >= 0 ? typeText.slice(0, dot) : ""
    if (pkg) {
      const kind = importPkgKind(ctx.imports, pkg)
      if (kind === "stdlib") return { kind: "external", typeName: typeText }
      if (kind === "module") {
        const rows = ctx.projectTypes(base)
        return rows.length === 1 ? { kind: "project", typeName: base, typeId: rows[0].id } : null
      }
      return null
    }
    const rows = ctx.projectTypes(base)
    return rows.length === 1 ? { kind: "project", typeName: base, typeId: rows[0].id } : null
  }
  let current = classify(declared[0])
  if (!current) return null
  for (const field of segments.slice(1, segments.length - 1)) {
    if (current.kind !== "project" || !current.typeId) return null
    const rows = ctx.projectTypes(current.typeName)
    if (rows.length !== 1) return null
    const rel = ctx.relativePathOfFile(rows[0].fileId)
    if (!rel) return null
    const typeText = ctx.readSource(rel)
    if (!typeText) return null
    const fieldTypes = receiverFieldTypes(typeText, field)
    if (fieldTypes.length !== 1) return null
    const next = classify(fieldTypes[0])
    if (!next) return null
    current = next
  }
  if (current.kind === "external") return { kind: "external", typeName: current.typeName }
  if (!current.typeId) return { kind: "project", typeName: current.typeName, ownerHasMethod: false }
  return { kind: "project", typeName: current.typeName, typeId: current.typeId, ownerHasMethod: ctx.ownerHasMethod(current.typeId, ctx.targetMethod) }
}

export { TYPE_LIKE_EXCLUDED }
