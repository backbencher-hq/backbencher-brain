/**
 * The JAVA `imports` / `exports` truth derivations — lane-owned, pure over the tree.
 *
 * WHY THIS EXISTS. The programme charter's D4 clause is literal: "every emitted label is derived by a
 * differential oracle AND admitted to that lane's compared set (both halves, same commit). A label
 * compared against nothing is not done." Java's `imports` and `exports` are the last two labels in
 * that position: they are NOT in java's compared set today, which means the analyzer's 209,106
 * `imports` and 10,777 `exports` whole-population edges are audited by NOTHING. Marking them "debt"
 * would leave java un-DONE under D4, so they are derived here from the published contract. The
 * WIRING (import, dispatch, compared-label admission) is the Lead's, by the single-writer rule for
 * `differential.ts`.
 *
 * WHAT THE ANALYZER PUBLISHES, and therefore what these must mirror — read off the emission sites, not
 * guessed:
 *
 *   imports
 *     1. every `import_declaration` publishes the MODULE PATH AS WRITTEN, one row on the
 *        `imports` kind (`relationshipType: import_declaration`, the dependency the module pass
 *        reads) and a second on its own fileLevel channel (`single_type_import` /
 *        `type_on_demand_import` / `static_member_import`, `fileLevel:true`). Both rows have the
 *        SAME target, and the differential's matcher keys label+target, so ONE truth row covers
 *        both.
 *        The path is the grammar's `scoped_identifier` (or `identifier`) child. A wildcard import's
 *        `*` is a SEPARATE `asterisk` node — `import java.util.*;` depends on the PACKAGE
 *        `java.util`, never on a target carrying the star. A static single-member import keeps the
 *        member (`java.util.Collections.sort`, JLS 7.5.3); a static-on-demand import names its
 *        container (`java.util.Arrays`, JLS 7.5.4).
 *     2. a `module-info.java`'s `requires [transitive|static] M` publishes an `imports` row whose
 *        target is the module name (JLS 7.7.1). The directive's modifiers are unnamed children; the
 *        TARGET is the `module` field, which is why it is read by field and not positionally.
 *
 *   exports
 *     1. every TOP-LEVEL type declaration in a NAMED package publishes `exports` package -> type
 *        (JLS 7.6 importability; the analyzer emits BOTH the 1.0 public tier and the 0.6
 *        package-private tier, so both are truth targets). A file with no package emits nothing —
 *        the analyzer counts that rather than fabricating a source).
 *     2. a `module-info.java`'s `exports P [to …]` publishes `exports` module -> P (JLS 7.7.2); the
 *        `to` modules are `references` rows, not exports.
 *     3. the Spring/JAX-RS route branch publishes `exports` owner.method -> fullRoute (an API
 *        endpoint). The route is COMPOSED, not written in one place: class-level mapping value +
 *        method-level mapping value (value, else path), duplicate slashes collapsed, leading `/`
 *        enforced (the analyzer's own composition loop, mirrored below character by character).
 *        Annotation values are constant-folded the same way the analyzer folds them: string
 *        literals and text blocks joined, `+` chains of foldable operands joined, anything else
 *        taken as its own TEXT (the analyzer's `extractStringValue` fallback) — and an annotation
 *        with no route component at all yields NO edge (the analyzer does not fabricate `/`).
 *
 * THE CONTRACT CHECK the charter asks for is structural rather than a second measurement: every
 * function returns rows for exactly the emission sites above and for no other construct, and the
 * dispatch must be the whole of the java truth for these two labels — there is no second rule.
 */

export type JavaOracleEdge = { label: string; from: string; target: string }

const namedChildren = (n: any): any[] => (n?.namedChildren ?? [])
const childByType = (n: any, type: string): any | null => {
  if (!n) return null
  for (const c of namedChildren(n)) if (c && c.type === type) return c
  return null
}
const fieldOf = (n: any, f: string): any | null =>
  typeof n?.childForFieldName === "function" ? n.childForFieldName(f) : null

const TYPE_DECLARATIONS = new Set([
  "class_declaration", "interface_declaration", "enum_declaration",
  "record_declaration", "annotation_type_declaration",
])

/** The short annotation name (`@Override`, `@org.x.Service` -> `Override`, `Service`). */
function shortAnnotationName(ann: any): string {
  for (const c of namedChildren(ann)) {
    if (c && (c.type === "identifier" || c.type === "scoped_identifier")) {
      const text = String(c.text ?? "")
      return text.slice(text.lastIndexOf(".") + 1)
    }
  }
  return ""
}

/** The annotation nodes attached to a declaration (the `modifiers` child's annotation children). */
function annotationsOf(decl: any): any[] {
  const out: any[] = []
  const mods = childByType(decl, "modifiers")
  if (!mods) return out
  for (const c of namedChildren(mods)) {
    if (c && (c.type === "annotation" || c.type === "marker_annotation")) out.push(c)
  }
  return out
}

/**
 * The analyzer's `extractStringValue` / `extractJavaConstantString`, mirrored:
 * a string literal concatenates its fragment children (plain and text-block forms both parse as
 * `string_literal`); `+` chains of foldable operands join; parens descend; ANY other node answers its
 * own TEXT (the analyzer's fallback — this is why an unresolvable operand does not silently vanish).
 */
function constantString(n: any): string | undefined {
  if (!n) return undefined
  if (n.type === "string_literal") {
    let fragment = ""
    for (const c of namedChildren(n)) {
      if (c && (c.type === "string_fragment" || c.type === "multiline_string_fragment")) fragment += String(c.text ?? "")
    }
    if (fragment) return fragment
  }
  if (n.type === "binary_expression") {
    const foldable = (m: any): string | undefined => {
      if (!m) return undefined
      if (m.type === "parenthesized_expression") return foldable(namedChildren(m)[0])
      if (m.type === "string_literal") {
        let fragment = ""
        for (const c of namedChildren(m)) {
          if (c && (c.type === "string_fragment" || c.type === "multiline_string_fragment")) fragment += String(c.text ?? "")
        }
        return fragment || undefined
      }
      if (m.type === "binary_expression") {
        const op = fieldOf(m, "operator")?.text
        if (op !== "+") return undefined
        const l = namedChildren(m)[0]
        const r = namedChildren(m)[1]
        if (!l || !r) return undefined
        const lt = foldable(l)
        const rt = foldable(r)
        if (lt === undefined || rt === undefined) return undefined
        const joined = lt + rt
        return joined || undefined
      }
      return undefined
    }
    return foldable(n)
  }
  return String(n.text ?? "")
}

/** The analyzer's `getAnnotationValue`, mirrored for the keys this surface needs (`value`, `path`). */
function annotationValue(decl: any, annotationName: string, key: string): string | undefined {
  for (const ann of annotationsOf(decl)) {
    if (shortAnnotationName(ann) !== annotationName) continue
    const args = childByType(ann, "annotation_argument_list")
    if (!args) return undefined
    for (const arg of namedChildren(args)) {
      if (!arg) continue
      if (arg.type === "element_value_pair") {
        const keyNode = childByType(arg, "identifier")
        if (keyNode && String(keyNode.text ?? "") === key) {
          const valNode = namedChildren(arg)[namedChildren(arg).length - 1]
          return constantString(valNode)
        }
      } else if (key === "value" && arg.type === "element_value_array_initializer") {
        const first = namedChildren(arg)[0]
        return first ? constantString(first) : undefined
      } else if (key === "value") {
        return constantString(arg)
      }
    }
  }
  return undefined
}

/** The analyzer's route composition: class value + method value, duplicate `/` collapsed, leading `/`. */
function composeRoute(basePath: string, methodRoute: string): string {
  let fullRoute = ""
  const total = basePath.length + methodRoute.length
  for (let i = 0; i < total; i++) {
    const ch = i < basePath.length ? basePath[i] : methodRoute[i - basePath.length]
    if (ch === "/" && fullRoute.length > 0 && fullRoute[fullRoute.length - 1] === "/") continue
    fullRoute += ch
  }
  if (!fullRoute.startsWith("/")) fullRoute = "/" + fullRoute
  return fullRoute
}

const MAPPING_ANNOTATIONS = ["GetMapping", "PostMapping", "PutMapping", "DeleteMapping", "PatchMapping", "RequestMapping", "Path"]

/** A declaration's mapping annotation short name (the analyzer picks the FIRST in its list order). */
function mappingAnnotationOf(decl: any): string | null {
  const names = annotationsOf(decl).map(shortAnnotationName)
  for (const candidate of MAPPING_ANNOTATIONS) if (names.includes(candidate)) return candidate
  return null
}

/**
 * `imports` truth — the published module path of every import declaration and every JPMS `requires`
 * (see the header for the exact rule and why one row per target is enough).
 */
export function deriveJavaImportTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const push = (target: string) => {
    const t = (target ?? "").trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    out.push({ label: "imports", from: "(module)", target: t })
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "import_declaration") {
      const nameNode = childByType(n, "scoped_identifier") || childByType(n, "identifier")
      if (nameNode) push(String(nameNode.text ?? ""))
    } else if (n.type === "requires_module_directive") {
      // JPMS directives live inside `module_body`, so they are matched WHEREVER they appear — the
      // first version tested for them as direct children of `module_declaration` and derived none.
      const moduleNode = fieldOf(n, "module")
      if (moduleNode) push(String(moduleNode.text ?? ""))
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * `exports` truth — top-level types of a named package, JPMS `exports P` directives, and the composed
 * API-route surface (see the header; the three emission sites are all of it).
 *
 * Top-level means: a type declaration NOT nested inside another type's body. The walk tracks nesting
 * so an inner class cannot become an export row (the analyzer's post-pass requires `ownerName`
 * absent, and a nested type always has an owner).
 */
export function deriveJavaExportTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const push = (target: string) => {
    const t = (target ?? "").trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    out.push({ label: "exports", from: "(package)", target: t })
  }
  let packageName = ""
  for (const c of namedChildren(root)) {
    if (c && c.type === "package_declaration") {
      const nameNode = childByType(c, "scoped_identifier") || childByType(c, "identifier")
      if (nameNode) packageName = String(nameNode.text ?? "")
      break
    }
  }
  /**
   * @param typeDepth    nesting depth among TYPE declarations (0 = top level; a nested type is not
   *                     an export — the analyzer's post-pass requires `ownerName` absent)
   * @param enclosingType the nearest enclosing type DECLARATION, which supplies a route's class-level
   *                     path prefix (the analyzer reads it from `parentContext.node`)
   */
  const walk = (n: any, typeDepth: number, enclosingType: any): void => {
    if (!n) return
    if (TYPE_DECLARATIONS.has(String(n.type))) {
      if (typeDepth === 0 && packageName.length > 0) {
        const nameNode = fieldOf(n, "name") || childByType(n, "identifier")
        // A file with NO package emits nothing (the analyzer counts it rather than fabricating a
        // source), which the packageName guard mirrors.
        if (nameNode) push(String(nameNode.text ?? ""))
      }
      const body =
        childByType(n, "class_body") || childByType(n, "enum_body") ||
        childByType(n, "interface_body") || childByType(n, "annotation_type_body")
      if (body) walk(body, typeDepth + 1, n)
      return
    }
    if (n.type === "exports_module_directive") {
      // JLS 7.7.2: `exports P [to M…]` publishes P; the `to` modules are references, not exports.
      const pkg = fieldOf(n, "package")
      if (pkg) push(String(pkg.text ?? ""))
    }
    if (n.type === "method_declaration") {
      // API-ROUTE exports: a mapped method publishes owner.method -> fullRoute. At least one
      // non-empty route component is required, and the composition mirrors the analyzer exactly.
      const mapping = mappingAnnotationOf(n)
      if (mapping) {
        const methodRoute = annotationValue(n, mapping, "value") ?? annotationValue(n, mapping, "path") ?? ""
        let basePath = ""
        if (enclosingType) {
          const classMapping = mappingAnnotationOf(enclosingType)
          if (classMapping) {
            basePath = annotationValue(enclosingType, classMapping, "value") ?? annotationValue(enclosingType, classMapping, "path") ?? ""
          }
        }
        if (basePath || methodRoute) push(composeRoute(basePath, methodRoute))
      }
    }
    for (const c of namedChildren(n)) walk(c, typeDepth, enclosingType)
  }
  walk(root, 0, null)
  return out
}

/** CONVENIENCE — both labels in one call for a single wiring site. */
export function deriveJavaIoSurfaceTruth(root: any): JavaOracleEdge[] {
  return [...deriveJavaImportTruth(root), ...deriveJavaExportTruth(root)]
}
