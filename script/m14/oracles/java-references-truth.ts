/**
 * The JAVA `references`/`contains` oracle EXTENSIONS — lane-owned, pure derivations over the tree.
 *
 * Beside this file rather than inside `script/m14/differential.ts` for the reason that file's header
 * records: the shared file is edited by several lanes at once, and every line a lane keeps out of it
 * is a line that cannot conflict. The WIRING is the Lead's: the four functions below are imported,
 * dispatched in the `if (lang === "java")` branch, and their labels admitted to the compared-label
 * filter. Until that wiring lands, the rows these functions derive are ABSENT truth: every analyzer
 * edge of the same label/target reads UNEXPLAINED (a fabrication), which is worse than a missing row.
 *
 * WHY EACH OF THE FOUR EXISTS. Each is a NEW JAVA EMISSION made under the owner ruling of 2026-10-18
 * ("complete surface"), and each would be charged as a fabrication by the differential's matcher,
 * which matches analyzer rows to truth rows on `label + normalized target` and has no source escape.
 * They are therefore not "nice to have": they are the difference between a measurement and an
 * accusation.
 *
 *   a) ANNOTATIONS — `references` (isAnnotation, relationshipType "annotation"). JLS 9.6 declares an
 *      annotation interface, JLS 9.7 uses it; the annotation type is NAMED in the declaration. The
 *      pinned grammar has two node types (`marker_annotation` = `@Override`, `annotation` =
 *      `@SuppressWarnings("x")`) whose NAME child is an `identifier` (bare) or a `scoped_identifier`
 *      (fully qualified). The analyzer publishes the WRITTEN spelling, so the oracle must derive the
 *      written spelling too — `@Override` is `Override`, `@java.lang.Deprecated` is
 *      `java.lang.Deprecated`. This oracle derives EVERY annotation node, whatever declaration it
 *      decorates (class/method/field/parameter/local/type-use/record component/package), because the
 *      lane emits a type mention for every one of them.
 *
 *   b) TYPE-PARAMETER BOUNDS — `references` (relationshipType "type_parameter_bound"). JLS 4.4: a
 *      bound NAMES A TYPE. The types derived here are ONLY the ones under a `type_bound` node —
 *      the type parameter's own NAME is a declaration, not a usage, and `differential.ts`'s existing
 *      `notAReference` rule (any type under a `type_parameters` ancestor) is exactly right about
 *      the NAME and exactly wrong about the bound TYPES. This function is the narrow exception:
 *      it walks from each `type_bound`'s children down, never from the `type_parameters` node, so a
 *      parameter named `T` cannot appear as its own bound while `<T extends Number & Comparable<T>>`
 *      derives Number, Comparable AND the `T` written as a generic ARGUMENT (the analyzer publishes
 *      generic arguments as references — the same consistency rule that makes `List<T>` publish T).
 *      The existing notAReference exclusion does not need changing for the same reason: its climb
 *      from a bound type reaches `type_parameters` too, but the exclusion is applied to the shared
 *      references derivation, not to this one; this function is called INSTEAD for the bound rows.
 *      The Lead's dispatch must therefore add these rows without re-filtering them.
 *
 *   c) RECORD PATTERNS — `references` (relationshipType "record_pattern"). JLS 14.30.2: a record
 *      pattern NAMES the record type (`o instanceof Point(int x, int y)`). The pinned grammar puts
 *      the type in the `record_pattern` node's first named child that is NOT `record_pattern_body`,
 *      and it is usually an `identifier` — not a `type_identifier` — which is why the shared
 *      `type_identifier` walk cannot see it (that was gap G3). Same spelling rule as the analyzer:
 *      bare name as written, a scoped/generic type reduced to its base name.
 *
 *   d) ENUM-CONSTANT BODIES — `contains` (the members declared inside a constant's class body).
 *      JLS 8.9.1: a constant with a body declares an anonymous SUBCLASS, and its members belong to
 *      that subclass. The analyzer gives the subclass the synthetic identity `anonymous_<CONSTANT>`
 *      (the same family convention as `anonymous_<Supertype>` for object_creation, JD18/JD32). The
 *      matcher keys `label + target`, so only the MEMBER names have to match; `from` is reported as
 *      `(anonymous)` exactly as the object_creation precedent does. Mirroring a naming convention is
 *      not mirroring a semantic decision: the members are still derived from the language's own
 *      containment rule, and the edge can still go red if a member goes missing.
 *
 * SHAPE. Every function is pure over a tree-sitter root (the same `root` `deriveJavaContainsTruth` /
 * `deriveJavaReferencesTruth` receive in differential.ts) and returns the same
 * `{ label, from, target }[]` shape those functions return, deduped BY TARGET (the matcher's own
 * key). The normalized-target comparison in the harness is `normTarget`; a target is emitted as
 * written and the harness normalizes both sides.
 *
 * NO WIRING HERE. Editing differential.ts is the Lead's single-writer job; this file exports and
 * stops.
 */

export type JavaOracleEdge = { label: string; from: string; target: string }

const LABEL_REFERENCES = "references"
const LABEL_CONTAINS = "contains"

/** The source the existing java reference oracle uses for every row — the matcher ignores `from`,
 *  and keeping it identical means the two oracle halves print the same way in a worklist. */
const REFERENCE_SOURCE = "(expr)"

/** The anonymous-container source the existing java contains oracle uses (see
 *  `deriveJavaContainsTruth`'s object_creation branch). */
const ANONYMOUS_SOURCE = "(anonymous)"

const namedChildren = (n: any): any[] => (n?.namedChildren ?? [])

/** The name child of an annotation / marker_annotation node, as written. Mirrors the analyzer's
 *  `javaAnnotationNameNode`: the grammar's `$._name` is choice(identifier, scoped_identifier), and a
 *  direct-children search cannot mistake an identifier inside an argument list for the name. */
function annotationName(ann: any): string | null {
  for (const c of namedChildren(ann)) {
    if (c?.type === "identifier" || c?.type === "scoped_identifier") return String(c.text ?? "")
  }
  return null
}

/**
 * The base name of a TYPE node, mirroring `javaTypeBaseName` in the analyzer:
 *   type_identifier / identifier -> its text
 *   scoped_type_identifier       -> the dotted chain, type-use annotations dropped (JLS 9.7.4)
 *   generic_type                 -> the base name of its name child, arguments NOT descended here
 *   annotated_type               -> past the annotation to the annotated type
 *   array_type                   -> the element type's base name
 *   primitives                   -> their keyword (the analyzer publishes those where the language
 *                                   spells a type; callers filter the positions they do not want)
 * Returns "" when no name can be derived (a malformed node) — callers skip an empty target, because
 * an edge with no endpoint names nothing and the harness's own truth-side guard drops it too.
 */
export function javaOracleBaseTypeName(n: any): string {
  if (!n) return ""
  const t = String(n.type ?? "")
  if (t === "type_identifier" || t === "identifier") return String(n.text ?? "")
  if (t === "integral_type" || t === "floating_point_type" || t === "boolean_type" || t === "void_type") {
    return String(n.text ?? "")
  }
  if (t === "generic_type") {
    for (const c of namedChildren(n)) {
      if (c?.type === "type_identifier" || c?.type === "scoped_type_identifier" || c?.type === "generic_type") {
        const b = javaOracleBaseTypeName(c)
        if (b) return b
      }
    }
    return ""
  }
  if (t === "scoped_type_identifier") {
    const parts: string[] = []
    for (const c of namedChildren(n)) {
      if (!c) continue
      if (c.type === "annotation" || c.type === "marker_annotation") continue
      const b = javaOracleBaseTypeName(c)
      if (b) parts.push(b)
    }
    return parts.join(".")
  }
  if (t === "annotated_type") {
    for (const c of namedChildren(n)) {
      if (!c) continue
      if (c.type === "annotation" || c.type === "marker_annotation") continue
      const b = javaOracleBaseTypeName(c)
      if (b) return b
    }
    return ""
  }
  if (t === "array_type") {
    const el = typeof n.childForFieldName === "function" ? n.childForFieldName("element") : null
    return javaOracleBaseTypeName(el ?? namedChildren(n)[0])
  }
  return ""
}

/**
 * (a) ANNOTATION TYPE REFERENCES — one `references` row per annotation node, target as written.
 *
 * Every annotation position is derived because every one is a type mention (JLS 9.7): declaration
 * annotations under a `modifiers` child, type-use annotations inside `annotated_type`, parameter /
 * record-component annotations, and annotations nested in another annotation's argument values.
 * Deduped by target: the analyzer emits one edge per annotated DECLARATION (a multi-declarator field
 * yields two edges with the same target), and the matcher is label+target, so one truth row covers
 * both without inventing a count.
 */
export function deriveJavaAnnotationReferencesTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const push = (target: string) => {
    if (!target || seen.has(target)) return
    seen.add(target)
    out.push({ label: LABEL_REFERENCES, from: REFERENCE_SOURCE, target })
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "annotation" || n.type === "marker_annotation") {
      const name = annotationName(n)
      if (name) push(name)
      // keep walking: an annotation's ARGUMENTS may hold another annotation (`@A(@B)`).
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * (b) TYPE-PARAMETER BOUND REFERENCES — one `references` row per type named under a `type_bound`.
 *
 * The bound rule: a type parameter is declared by its NAME (never derived here — that is a
 * declaration, not a usage) and its bound is a type list (JLS 4.4: `extends Type (& Type)*`). So the
 * walk starts at each `type_bound` node and collects every type NAME beneath it, including the names
 * inside generic arguments (`Comparable<T>` names Comparable and T), which the analyzer publishes
 * with the same rule it uses for every other generic declaration. A bound written fully qualified
 * (`<E extends java.io.IOException>`) keeps the written path, matching the lane's throws/annotation
 * spelling rule.
 */
export function deriveJavaTypeParameterBoundReferencesTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const push = (target: string) => {
    if (!target || seen.has(target)) return
    seen.add(target)
    out.push({ label: LABEL_REFERENCES, from: REFERENCE_SOURCE, target })
  }
  const collectTypes = (n: any): void => {
    if (!n) return
    const t = String(n.type ?? "")
    if (t === "type_identifier" || t === "scoped_type_identifier") {
      const b = javaOracleBaseTypeName(n)
      if (b) push(b)
      // a scoped type's chain is nested type_identifiers; baseTypeName already joined it, so do
      // not descend (descending would push every qualifier segment as a separate target).
      return
    }
    if (t === "annotation" || t === "marker_annotation") {
      // A type-use annotation inside a bound is its own annotation reference, derived by (a).
      for (const c of namedChildren(n)) collectTypes(c)
      return
    }
    for (const c of namedChildren(n)) collectTypes(c)
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "type_bound") {
      for (const c of namedChildren(n)) collectTypes(c)
      return // the bound's own subtree is fully handled; no nested type_bound can exist inside it
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * (c) RECORD-PATTERN TYPE REFERENCES — one `references` row per record pattern's record type.
 *
 * JLS 14.30.2. The pinned grammar's `record_pattern` is `TYPE record_pattern_body`; the type child is
 * an `identifier` (NOT a `type_identifier`, which is exactly why the shared walk missed it — gap G3)
 * and is followed by a `record_pattern_body` holding the components. NOTE the analyzer emits ONE row
 * per record_pattern node, and a NESTED pattern (`Point(Point(int a))`) is a record_pattern node too,
 * so every nesting level derives here by the same walk. A generic record pattern
 * (`Box<String>(String s)`) reduces to the base name, matching the lane.
 */
export function deriveJavaRecordPatternReferencesTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const push = (target: string) => {
    if (!target || seen.has(target)) return
    seen.add(target)
    out.push({ label: LABEL_REFERENCES, from: REFERENCE_SOURCE, target })
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "record_pattern") {
      // The TYPE is the first named child that is not the component body. Using the node type
      // (not text offsets) keeps this independent of grammar child ordering.
      for (const c of namedChildren(n)) {
        if (!c || c.type === "record_pattern_body") continue
        const b = javaOracleBaseTypeName(c)
        if (b) push(b)
        break // one type per record_pattern node; nested patterns are their own nodes
      }
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * (d) ENUM-CONSTANT BODY MEMBERS — one `contains` row per member declared inside a constant's body.
 *
 * JLS 8.9.1: `ONE { void act() {} }` declares an anonymous subclass of the enum, and `act` is a
 * member of THAT subclass. The analyzer publishes the container as `anonymous_<CONSTANT>` (family
 * convention; the store never indexes it) and `contains`s each member under it. The matcher keys
 * `label + target`, so deriving the member NAMES is what makes those rows explainable; `from` is
 * reported as `(anonymous)` exactly as the object_creation precedent does.
 *
 * Derived member kinds, mirroring `deriveJavaContainsTruth`'s membersOf: fields/constants (per
 * declarator), methods, constructors, compact constructors, annotation type elements, enum constants
 * declared in the body, and nested type declarations. Nothing is crafted that the source does not
 * name — this is the same containment rule the named-type walk applies.
 */
export function deriveJavaEnumConstantBodyContainsTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const push = (target: string) => {
    if (!target || seen.has(target)) return
    seen.add(target)
    out.push({ label: LABEL_CONTAINS, from: ANONYMOUS_SOURCE, target })
  }
  const fieldName = (n: any, f: string): string | null =>
    typeof n?.childForFieldName === "function" ? (n.childForFieldName(f)?.text ?? null) : null
  const membersOf = (body: any): void => {
    for (const c of namedChildren(body)) {
      if (!c) continue
      if (c.type === "field_declaration" || c.type === "constant_declaration") {
        for (const d of namedChildren(c)) {
          if (d?.type === "variable_declarator") {
            const nm = fieldName(d, "name")
            if (nm) push(nm)
          }
        }
      } else if (
        c.type === "method_declaration" || c.type === "annotation_type_element_declaration" ||
        c.type === "constructor_declaration" || c.type === "compact_constructor_declaration"
      ) {
        const nm = fieldName(c, "name")
        if (nm) push(nm)
      } else if (c.type === "enum_constant") {
        const nm = fieldName(c, "name")
        if (nm) push(nm)
      } else if (c.type === "enum_body_declarations") {
        membersOf(c)
      } else if (
        c.type === "class_declaration" || c.type === "interface_declaration" ||
        c.type === "enum_declaration" || c.type === "record_declaration" ||
        c.type === "annotation_type_declaration"
      ) {
        const nm = fieldName(c, "name")
        if (nm) push(nm)
      }
    }
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "enum_constant") {
      for (const c of namedChildren(n)) {
        if (c?.type === "class_body") membersOf(c)
      }
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * CONVENIENCE — all four extensions in one call, for a single wiring site. The Lead may dispatch the
 * four individually instead; either way the rows are the same. Kept as a separate function rather
 * than folded into the four so a lane can import exactly the one it needs.
 */
export function deriveJavaOracleExtensionEdges(root: any): JavaOracleEdge[] {
  return [
    ...deriveJavaAnnotationReferencesTruth(root),
    ...deriveJavaTypeParameterBoundReferencesTruth(root),
    ...deriveJavaRecordPatternReferencesTruth(root),
    ...deriveJavaEnumConstantBodyContainsTruth(root),
  ]
}
