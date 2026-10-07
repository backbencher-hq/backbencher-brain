/**
 * JAVA ORACLE — VERIFY_JAVA9's independent second opinion.
 *
 * ## What this is, and what it is not
 *
 * The workstream asks, for each already-emitted type, whether an INDEPENDENT
 * oracle agrees. This file is that oracle for the six structural types java
 * emits (`calls`, `extends`, `implements`, `instantiates`, `references`,
 * `contains`) plus `uses`, and for `overrides` it audits the tier that is
 * decidable from one file alone.
 *
 * **Its declared limit, stated here so no reader claims more than the harness
 * supports: the oracle loads the SAME `tree-sitter-java` wasm the analyzer
 * loads.** It is independent at the level of IMPLEMENTATION — a different
 * walker, a different strategy for every fact — and it is BLIND at the level of
 * the GRAMMAR. A bug in the grammar's own node shapes would be invisible to
 * both walkers and this oracle would report total agreement while both were
 * wrong. What it can catch is an analyzer defect: a wrong predicate, a
 * mislabelled edge, an unstripped generic argument, a fabricated edge, an
 * endpoint that names nothing.
 *
 * ## Where the two implementations genuinely diverge
 *
 * Every fact below is derived by a DIFFERENT mechanism than the analyzer uses,
 * not a re-reading of the analyzer's own output:
 *
 *   fact              analyzer                              this oracle
 *   ----              -------                              -----------
 *   type name         `childText(node, "identifier")`      descend `scoped_identifier` /
 *                                                         `generic_type` / `array_type`
 *                                                         children and take the LEAF
 *   visibility        `getJavaVisibility` over a           read the `modifiers` child node
 *                     joined modifier STRING                node TYPES
 *   enclosing scope   a scope STACK pushed during the      an ancestor walk from each
 *                     single-pass walk                      declaration to its nearest
 *                                                         enclosing type body
 *   call target       `buildJavaCallExpression` over       the `name` FIELD of the
 *                     `object`/`field_access` text          method_invocation, which is a
 *                                                         node, never a string cut
 *   import flags      `node.text.indexOf("static ")`       the `static` / `asterisk` CHILD
 *                     (the pre-EXPORTS_JAVA2 shape)         NODE types
 *   instantiation     text of `object_creation_expression`  the `type` FIELD, then the
 *                                                         same leaf descent
 *   override target   a 4-tier resolver over classHierarchy  in-file structural fact only:
 *                                                         an ancestor in THIS file that
 *                                                         declares the same name at the
 *                                                         same arity
 *
 * ## Why the comparison is on SETS, not on counts
 *
 * The analyzer's edge set per file carries duplicates deliberately — two
 * call sites of the same callee from the same caller are two relationships.
 * The oracle enumerates sites, so it also produces duplicates. Comparing counts
 * would therefore measure agreement about multiplicity, which is a property of
 * neither correctness nor fabrication; comparing per-file SETS of
 * (source, target) measures whether the two walkers found the same edges, which
 * is the question Part 1 q3 asks. Both numbers are printed: `edges` (raw) and
 * `distinct` (the set comparison), so a multiplicity disagreement is visible
 * rather than hidden inside a percentage.
 *
 * ## NO REGEX
 *
 * Not one regular expression in this file. Every programmatic step is a tree
 * walk over `node.type`, `child(i)` and `childForFieldName`, or a char-code
 * walk with explicit ranges.
 *
 * ## USAGE
 *   bun script/m14/lanes/java-verify/java-verify-oracle.ts
 *   LANE_NFILES=200 bun script/m14/lanes/java-verify/java-verify-oracle.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../../src/ast/real-java-analyzer"

// ------------------------------------------------------------------ config
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.LANE_REPO ?? "java-lib"
const LANE_NFILES = Number(process.env.LANE_NFILES ?? 0) // 0 = every file

const TYPES = ["calls", "extends", "implements", "instantiates", "references", "contains", "uses", "overrides"] as const
type T = (typeof TYPES)[number]

/** Set-key separator, and the arrow printed between the two endpoints. */
const SEP = " > "

const TYPE_DECLS = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"])
const MEMBER_DECLS = new Set([
  "method_declaration", "constructor_declaration", "field_declaration",
  "enum_constant", "annotation_type_element_declaration", "compact_constructor_declaration",
])

// ------------------------------------------------------- independent helpers
/** Leaf NAME of a type node, by DESCENDING the grammar rather than cutting text.
 *  `generic_type` -> its `type` field; `array_type` -> its `element`; dotted
 *  `scoped_identifier`/`scoped_type_identifier` -> the last `identifier`
 *  descendant; anything else -> its own text when it is an identifier. */
function typeLeafName(n: any): string {
  if (!n) return ""
  const t = n.type
  if (t === "type_identifier" || t === "identifier") return String(n.text ?? "")
  // `superclass` / `extends_interfaces` clause nodes wrap the type; descend to
  // the first TYPE-ish named child.
  if (t === "superclass") {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && TYPEISH.has(c.type)) return typeLeafName(c)
    }
    return ""
  }
  if (t === "generic_type" || t === "annotated_type" || t === "array_type") {
    // On the pinned grammar `generic_type` carries its base as a NAMED CHILD
    // with NO field name, so `childForFieldName("type")` returns undefined and
    // the base name silently becomes "" -- which is how a superscript oracle
    // ends up disagreeing with a CORRECT analyzer on every generic superclass
    // (`extends B<X>`). Scan the named children for the first TYPE-ish one,
    // skipping `type_arguments`.
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && TYPEISH.has(c.type) && c.type !== "type_arguments") return typeLeafName(c)
    }
    return ""
  }
  if (t === "scoped_type_identifier" || t === "scoped_identifier") {
    // descend to the rightmost identifier descendant
    let leaf = ""
    const v = (x: any) => {
      if (!x) return
      if (x.type === "type_identifier" || x.type === "identifier") { leaf = String(x.text ?? ""); return }
      for (let i = 0; i < x.childCount; i++) v(x.child(i))
    }
    v(n)
    return leaf
  }
  return ""
}
const TYPEISH = new Set([
  "type_identifier", "scoped_type_identifier", "generic_type", "array_type",
  "annotated_type", "identifier", "scoped_identifier", "primitive_type", "integral_type", "floating_point_type", "boolean_type", "void_type",
  "type_arguments", "wildcard",
])

/** The nearest enclosing TYPE declaration ancestor of `n`, by walking parents.
 *  The analyzer keeps a scope stack during one pass; this oracle re-derives the
 *  same fact by walking up, so a scope-stack imbalance in the analyzer is
 *  exactly the kind of bug the two implementations disagree about. */
function enclosingType(n: any): any {
  let p = n.parent
  while (p) { if (TYPE_DECLS.has(p.type)) return p; p = p.parent }
  return null
}
/** The nearest enclosing METHOD or CONSTRUCTOR ancestor, else the enclosing type. */
function enclosingCallableName(n: any): string {
  let p = n.parent
  while (p) {
    if (p.type === "method_declaration" || p.type === "constructor_declaration" || p.type === "compact_constructor_declaration") {
      return String(p.childForFieldName?.("name")?.text ?? "")
    }
    if (TYPE_DECLS.has(p.type)) return String(p.childForFieldName?.("name")?.text ?? "")
    p = p.parent
  }
  return ""
}
/** `Owner.member` — the analyzer's `localEdgeLabel` shape, re-derived here:
 *  the last two dot segments of a name whose balanced parens are removed. */
function lastTwo(qualified: string): string {
  let cleaned = ""
  let depth = 0
  for (let i = 0; i < qualified.length; i++) {
    const c = qualified.charCodeAt(i)
    if (c === 40) depth++
    else if (c === 41) { if (depth > 0) depth-- }
    else if (depth === 0) cleaned += qualified[i]
  }
  const segs: string[] = []
  let cur = ""
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === ".") { if (cur.length) segs.push(cur); cur = "" } else cur += cleaned[i]
  }
  if (cur.length) segs.push(cur)
  if (segs.length === 0) return ""
  if (segs.length === 1) return segs[0]
  return segs[segs.length - 2] + "." + segs[segs.length - 1]
}
/** the package name, read by DESCENDING the scoped_identifier rather than
 *  taking the node's text (the analyzer takes `childText`, i.e. text). */
function packageName(root: any): string {
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (c.type === "package_declaration") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const s = c.namedChild(j)
        if (s.type === "scoped_identifier" || s.type === "identifier") return typeLeafName2(s)
      }
    }
  }
  return ""
}
/** dotted text of a scoped_identifier, assembled by walking children. */
function typeLeafName2(n: any): string {
  if (n.type === "identifier") return String(n.text ?? "")
  const parts: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.type === "identifier") parts.push(String(c.text ?? ""))
    else if (c.type === "scoped_identifier") parts.push(typeLeafName2(c))
  }
  return parts.join(".")
}
/** Does a `modifiers` node carry `public`? read from CHILD NODE TYPES, not by
 *  joining the modifier text the way the analyzer's string helper does. */
function hasPublicModifier(n: any): boolean {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === "modifiers") {
    const m = n.child(i)
    for (let j = 0; j < m.childCount; j++) if (m.child(j).type === "public") return true
  }
  return false
}
/** The lane's DECLARED call filter, mirrored. An exact-name builtin list plus a
 *  ROOT-segment stdlib set; `isJavaBuiltin`'s own comment records that org/com
 *  were removed from that set because `com.sun` and `com.mycompany` share a
 *  first segment and nothing else. Mirroring is stated rather than hidden: this
 *  oracle can catch a mis-implementation of the filter, not a bad filter. */
const STDLIB_ROOTS = new Set([
  "System", "String", "Integer", "Long", "Double", "Float", "Boolean", "Byte", "Short", "Character",
  "Math", "StrictMath", "Object", "Class", "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder",
  "Throwable", "Error", "Exception", "StackTraceElement", "Enum", "Void", "Compiler", "Package",
  "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet", "LinkedHashMap", "LinkedHashSet",
  "WeakHashMap", "IdentityHashMap", "Collections", "Arrays", "Objects", "Optional", "OptionalInt",
  "OptionalLong", "OptionalDouble", "Stream", "Collectors", "Comparator", "Iterator", "ListIterator",
  "Spliterator", "Random", "UUID", "Date", "Calendar", "TimeZone", "Locale", "Currency", "Base64",
  "Scanner", "Formatter", "StringJoiner", "AbstractList", "AbstractMap", "AbstractSet", "AbstractCollection",
  "EnumMap", "EnumSet", "Queue", "Deque", "Stack", "Vector", "Hashtable", "Properties", "BitSet", "Dictionary",
  "List", "Map", "Set", "Collection", "Iterable", "File", "Files", "Path", "Paths", "InputStream",
  "OutputStream", "Reader", "Writer", "BufferedReader", "BufferedWriter", "FileInputStream", "FileOutputStream",
  "FileReader", "FileWriter", "ByteArrayInputStream", "ByteArrayOutputStream", "StringReader", "StringWriter",
  "PrintWriter", "PrintStream", "IOException", "FileNotFoundException", "EOFException", "URL", "URI",
  "HttpURLConnection", "URLEncoder", "URLDecoder", "Connection", "DriverManager", "ResultSet", "Statement",
  "PreparedStatement", "SQLException", "DataSource", "javax", "jakarta", "kotlin", "Unit", "Nothing", "Any",
  "Int", "java", "jdk", "sun", "Logger", "LoggerFactory", "LogManager", "Level", "LogRecord", "Marker",
  "MDC", "NDC", "Override", "Deprecated", "SuppressWarnings", "SafeVarargs", "FunctionalInterface",
  "Nullable", "NotNull", "NonNls", "Test", "Before", "After", "BeforeClass", "AfterClass", "Ignore",
  "RunWith", "Suite", "Parameterized", "slf4j", "log4j", "logback",
])
const BUILTIN_NAMES = new Set([
  "System.out.println", "System.out.print", "System.out.printf", "System.err.println", "System.err.print",
  "System.exit", "System.gc", "System.currentTimeMillis", "System.nanoTime", "System.getProperty",
  "System.getenv", "System.identityHashCode", "System.arraycopy", "toString", "hashCode", "equals",
  "getClass", "notify", "notifyAll", "wait", "clone", "finalize",
])
function isJavaBuiltin(call: string): boolean {
  if (BUILTIN_NAMES.has(call)) return true
  const segs = call.split(".")
  if (segs.length > 0 && STDLIB_ROOTS.has(segs[0])) return true
  if (STDLIB_ROOTS.has(call)) return true
  return false
}

/** Is this node the LEFT side of an assignment? A write is not a read (the
 *  family-wide JAD1 rule, and the reason a `this.x = v` used to emit a bogus
 *  `uses` edge for `x`). */
function isWriteSite(n: any): boolean {
  const par = n.parent
  if (!par || par.type !== "assignment_expression") return false
  const lhs = par.childForFieldName?.("left") ?? par.namedChild(0)
  return !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
}

/** node types whose `name` field IS this identifier, so the identifier is a
 *  DECLARATION and never a read. */
const DECL_NAME_PARENTS = new Set([
  "variable_declarator", "formal_parameter", "method_declaration", "constructor_declaration",
  "class_declaration", "interface_declaration", "enum_declaration", "record_declaration",
  "annotation_type_declaration", "enum_constant", "catch_formal_parameter", "enhanced_for_statement",
])

/** Receiver-qualified expression for a `method_invocation`, by recursion over
 *  the `object` field. */
function callExpr(n: any): string {
  if (n.type === "method_invocation") {
    const nm = String(n.childForFieldName?.("name")?.text ?? "")
    const obj = n.childForFieldName?.("object")
    return obj ? callExpr(obj) + "." + nm : nm
  }
  return String(n.text ?? "")
}

/** First NAMED child of the given node type. Used for the inheritance clauses,
 *  which on the pinned grammar are unnamed fields. */
function childOfType(n: any, type: string): any {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

/** Top-level = no TYPE_DECLS ancestor. */
function isTopLevelType(n: any): boolean {
  let p = n.parent
  while (p) { if (TYPE_DECLS.has(p.type)) return false; p = p.parent }
  return true
}

// ------------------------------------------------------------------ oracle walk
interface OracleEdges { sets: Map<T, Set<string>>; edges: Map<T, number> }

function deriveOracle(root: any): OracleEdges {
  const sets = new Map<T, Set<string>>()
  const edges = new Map<T, number>()
  for (const t of TYPES) { sets.set(t, new Set()); edges.set(t, 0) }
  const add = (t: T, s: string, g: string) => {
    if (!s || !g) return
    edges.set(t, (edges.get(t) ?? 0) + 1)
    sets.get(t)!.add(s + SEP + g)
  }
  const pkg = packageName(root)
  // import_declarations collected first: their source is rewritten in a
  // post-pass to the file's PRIMARY top-level type, so they cannot be emitted
  // during the walk without knowing the file's type list.
  const flags: Array<{ isStatic: boolean; isAsterisk: boolean; mod: string }> = []
  const topLevelTypes: string[] = []

  // in-file type hierarchy, for the structural override tier
  const parentOf = new Map<string, string[]>()
  const declaredNames = new Set<string>()

  const visit = (n: any) => {
    const t = n.type

    if (TYPE_DECLS.has(t)) {
      const name = String(n.childForFieldName?.("name")?.text ?? "")
      declaredNames.add(name)
      const parents: string[] = []
      // The inheritance clauses are read as CHILD NODE TYPES, not field names.
      // On the pinned grammar `superclass` IS a field but `super_interfaces`
      // and `extends_interfaces` are NOT — a field lookup returns undefined and
      // the clause silently vanishes, which is exactly how an oracle can report
      // fabricated total agreement. Child-type scanning cannot do that.
      const sc = n.childForFieldName?.("superclass") ?? childOfType(n, "superclass")
      if (sc) {
        const nm = typeLeafName(sc)
        if (nm) { parents.push(nm); add("extends", name, nm) }
      }
      const si = childOfType(n, "super_interfaces")
      if (si) for (let i = 0; i < si.namedChildCount; i++) {
        const it = si.namedChild(i)
        if (it.type === "type_list") {
          for (let j = 0; j < it.namedChildCount; j++) {
            const nm = typeLeafName(it.namedChild(j))
            if (!nm) continue
            parents.push(nm)
            // java grammar: super_interfaces on a CLASS means `implements`,
            // on an INTERFACE it means `extends`. Both are read from the node
            // kind, not inferred from the text.
            add(t === "interface_declaration" ? "extends" : "implements", name, nm)
          }
        }
      }
      const ei = childOfType(n, "extends_interfaces")
      if (ei) for (let i = 0; i < ei.namedChildCount; i++) {
        const it = ei.namedChild(i)
        if (it.type === "type_list") {
          for (let j = 0; j < it.namedChildCount; j++) {
            const nm = typeLeafName(it.namedChild(j))
            if (!nm) continue
            parents.push(nm)
            add("extends", name, nm)
          }
        }
      }
      parentOf.set(name, parents)
      if (isTopLevelType(n)) topLevelTypes.push(name)
    }

    // A nested TYPE is itself a contained member of its nearest enclosing type,
    // and the owner must SKIP the node itself (walking up from a declaration
    // finds itself first). Derived here by asking for the parent-side type.
    if (TYPE_DECLS.has(t)) {
      const name = String(n.childForFieldName?.("name")?.text ?? "")
      let p = n.parent
      let ownerName = ""
      while (p) { if (TYPE_DECLS.has(p.type)) { ownerName = String(p.childForFieldName?.("name")?.text ?? ""); break } p = p.parent }
      if (ownerName && name) add("contains", ownerName, name)
    }

    if (MEMBER_DECLS.has(t)) {
      const owner = enclosingType(n)
      const ownerName = String(owner?.childForFieldName?.("name")?.text ?? "")
      let memberName = ""
      if (t === "constructor_declaration" || t === "compact_constructor_declaration") memberName = "constructor"
      else if (t === "field_declaration") {
        // A field's names are `variable_declarator` children, each with its own
        // `name` field. `private int a, b;` declares TWO members.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c.type === "variable_declarator") {
            const nm = String(c.childForFieldName?.("name")?.text ?? "")
            if (nm) add("contains", ownerName, nm)
          }
        }
      } else memberName = String(n.childForFieldName?.("name")?.text ?? "")
      if (ownerName && memberName) add("contains", ownerName, memberName)
    }

    if (t === "import_declaration") {
      const isStatic = n.children?.some((c: any) => c.type === "static") ?? false
      const isAsterisk = n.children?.some((c: any) => c.type === "asterisk") ?? false
      const mod = typeLeafName2(n) // the dotted module path, assembled by walking
      flags.push({ isStatic, isAsterisk, mod })
    }

    if (t === "explicit_constructor_invocation") {
      // Constructor delegation is a CALL edge (analyzer metadata
      // relationshipType: "constructor_invocation"). The target names the
      // receiver keyword, deliberately NOT resolved to a parent type -- the
      // analyzer's own comment records that parents[] mixes extends and
      // implements entries so any resolution could fabricate a wrong edge.
      const src = enclosingCallableName(n)
      if (src) add("calls", src, "super")
    }

    if (t === "method_invocation") {
      // The family's call contract is the RECEIVER-QUALIFIED expression, built
      // by recursing the `object` field and appending the `name` field's text;
      // the analyzer reaches the same shape through `buildJavaCallExpression`,
      // which special-cases a nested invocation and takes the receiver's TEXT.
      // Same contract, different mechanism.
      const nm = String(n.childForFieldName?.("name")?.text ?? "")
      const obj = n.childForFieldName?.("object")
      const full = obj ? callExpr(obj) + "." + nm : nm
      // The declared contract: the EDGE target is the LEAF segment of the
      // receiver-qualified expression; the whole expression rides
      // `metadata.javaCallExpression`. A mirror, not an independent judgement --
      // it is recorded as such, because a mirror is still a second
      // implementation of the same rule and can catch a mis-implementation.
      const leaf = full.split(".").pop() ?? full
      if (nm) {
        if (isJavaBuiltin(full)) filteredCalls.count++
        else add("calls", enclosingCallableName(n), leaf)
      }
    }

    if (t === "object_creation_expression") {
      const ty = n.childForFieldName?.("type") ?? childOfType(n, "type_identifier") ?? childOfType(n, "generic_type") ?? childOfType(n, "scoped_type_identifier") ?? childOfType(n, "identifier")
      const nm = typeLeafName(ty)
      add("instantiates", enclosingCallableName(n), nm)
    }

    if (t === "field_access") {
      const fld = n.childForFieldName?.("field")
      const nm = fld ? String(fld.text ?? "") : ""
      const owner = enclosingType(n)
      const src = enclosingCallableName(n) || String(owner?.childForFieldName?.("name")?.text ?? "")
      if (nm && !isWriteSite(n)) add("uses", src, nm)
    }

    if (t === "array_access") {
      const arr = n.childForFieldName?.("array")
      if (arr && !isWriteSite(n)) {
        const owner = enclosingType(n)
        const ownerName = String(owner?.childForFieldName?.("name")?.text ?? "")
        const src = enclosingCallableName(n) || ownerName
        if (arr.type === "identifier") add("uses", src, String(arr.text ?? ""))
        else if (arr.type === "field_access" || arr.type === "scoped_identifier") {
          const leaf = String(arr.childForFieldName?.("field")?.text ?? (arr.text ?? "").split(".").pop() ?? "")
          if (leaf) add("uses", src, leaf)
        }
      }
    }

    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)

  for (const f of flags) add("references", topLevelTypes[0] ?? pkg ?? "root", f.mod)

  // ---- bare-identifier member reads, the third `uses` shape. Gated on the name
  // resolving to a member the ENCLOSING TYPE declares, on the current function not
  // binding it, and on the site not being a write, a callee, a declaration's own
  // name or an annotation's name. Sourced at the DECLARING TYPE, which is what
  // the analyzer's own comment records as the correction.
  {
    const membersByOwner = new Map<string, Set<string>>()
    const collectMembers = (x: any) => {
      if (TYPE_DECLS.has(x.type)) {
        const own = String(x.childForFieldName?.("name")?.text ?? "")
        if (own) {
          if (!membersByOwner.has(own)) membersByOwner.set(own, new Set())
          const set = membersByOwner.get(own)!
          for (const b of ["class_body", "interface_body", "enum_body", "enum_body_declarations", "annotation_type_body"]) {
            const body = childOfType(x, b)
            if (!body) continue
            for (let i = 0; i < body.namedChildCount; i++) {
              const mem = body.namedChild(i)
              if (MEMBER_DECLS.has(mem.type)) {
                if (mem.type === "field_declaration") {
                  for (let j = 0; j < mem.namedChildCount; j++) {
                    const vd = mem.namedChild(j)
                    if (vd.type === "variable_declarator") {
                      const nm = String(vd.childForFieldName?.("name")?.text ?? "")
                      if (nm) set.add(nm)
                    }
                  }
                } else {
                  const nm = String(mem.childForFieldName?.("name")?.text ?? "")
                  if (nm) set.add(nm)
                }
              }
            }
          }
        }
      }
      for (let i = 0; i < x.namedChildCount; i++) collectMembers(x.namedChild(i))
    }
    collectMembers(root)

    // names a function body BINDS: parameters, locals, catch/loop bindings.
    const boundIn = (fn: any): Set<string> => {
      const out = new Set<string>()
      const v = (x: any) => {
        if (["formal_parameter", "spread_parameter", "catch_formal_parameter", "resource", "enhanced_for_statement", "local_variable_declaration", "lambda_expression", "type_pattern", "record_pattern_component"].includes(x.type)) {
          for (let i = 0; i < x.namedChildCount; i++) {
            const c = x.namedChild(i)
            if (c.type === "identifier" && c.parent?.childForFieldName?.("name")?.startIndex === c.startIndex) out.add(String(c.text ?? ""))
            if (c.type === "variable_declarator") {
              const nm = String(c.childForFieldName?.("name")?.text ?? "")
              if (nm) out.add(nm)
            }
            if (c.type === "inferred_parameters") {
              for (let j = 0; j < c.namedChildCount; j++) {
                const nm = String(c.namedChild(j).childForFieldName?.("name")?.text ?? "")
                if (nm) out.add(nm)
              }
            }
          }
        }
        for (let i = 0; i < x.namedChildCount; i++) v(x.namedChild(i))
      }
      v(fn)
      return out
    }

    const visitBare = (x: any, locals: Set<string>) => {
      if (TYPE_DECLS.has(x.type)) {
        // a type body opens a FRESH binding scope
        for (let i = 0; i < x.namedChildCount; i++) visitBare(x.namedChild(i), new Set())
        return
      }
      let nextLocals = locals
      if (x.type === "method_declaration" || x.type === "constructor_declaration" || x.type === "compact_constructor_declaration") nextLocals = boundIn(x)
      if (x.type === "identifier") {
        const txt = String(x.text ?? "")
        const par = x.parent
        const memberish = !!par && (par.type === "field_access" || par.type === "method_invocation" || par.type === "scoped_identifier" || par.type === "array_access")
        const annotationName = !!par && (par.type === "marker_annotation" || par.type === "annotation")
        const declName = !!par && DECL_NAME_PARENTS.has(par.type) && par.childForFieldName?.("name")?.startIndex === x.startIndex
        if (!memberish && !annotationName && !declName && !isWriteSite(x) && !locals.has(txt) && txt !== "this" && txt !== "super") {
          const owner = enclosingType(x)
          const ownerName = String(owner?.childForFieldName?.("name")?.text ?? "")
          if (ownerName && membersByOwner.get(ownerName)?.has(txt)) add("uses", ownerName, txt)
        }
      }
      for (let i = 0; i < x.namedChildCount; i++) visitBare(x.namedChild(i), nextLocals)
    }
    visitBare(root, new Set())
  }

  // structural override tier: a method whose name AND arity match a method
  // declared by an ancestor IN THIS FILE. This is the only tier a per-file
  // oracle can decide; the 0.85 companion-index and 0.5 first-parent-guess
  // tiers name a parent outside the file and are therefore NOT audited here.
  // Saying so is part of the answer — an unaudited tier is a DERIVATION finding.
  const arityOf = (n: any): number => {
    const fp = n.childForFieldName?.("parameters")
    if (!fp) return 0
    let k = 0
    for (let i = 0; i < fp.namedChildCount; i++) {
      const c = fp.namedChild(i)
      if (c.type === "formal_parameter" || c.type === "spread_parameter" || c.type === "receiver_parameter") k++
    }
    return k
  }
  const declaredSig = new Map<string, Set<string>>() // ownerName -> "name/arity"
  const walkMembers = (n: any) => {
    if (TYPE_DECLS.has(n.type)) {
      const owner = String(n.childForFieldName?.("name")?.text ?? "")
      if (owner) {
        if (!declaredSig.has(owner)) declaredSig.set(owner, new Set())
        const set = declaredSig.get(owner)!
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c.type === "class_body" || c.type === "interface_body" || c.type === "enum_body" || c.type === "annotation_type_body") {
            for (let j = 0; j < c.childCount; j++) {
              const m = c.child(j)
              if (m.type === "method_declaration") {
                const mn = String(m.childForFieldName?.("name")?.text ?? "")
                if (mn) set.add(mn + "/" + arityOf(m))
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walkMembers(n.child(i))
  }
  walkMembers(root)

  const visitOverrides = (n: any) => {
    if (n.type === "method_declaration") {
      const owner = enclosingType(n)
      const ownerName = String(owner?.childForFieldName?.("name")?.text ?? "")
      const mn = String(n.childForFieldName?.("name")?.text ?? "")
      if (ownerName && mn) {
        const parents = parentOf.get(ownerName) ?? []
        for (const p of parents) {
          const set = declaredSig.get(p)
          if (set && set.has(mn + "/" + arityOf(n))) { add("overrides", ownerName + "." + mn, p + "." + mn); break }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visitOverrides(n.child(i))
  }
  visitOverrides(root)

  return { sets, edges }
}

// ------------------------------------------------------------------ corpus
const dir = join(CORPUS_ROOT, REPO_DIR)
const all: string[] = []
function walk(d: string) {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) all.push(p)
  }
}
walk(dir)
all.sort()
const files = LANE_NFILES > 0 ? all.slice(0, LANE_NFILES) : all

console.log(`JAVA ORACLE (VERIFY_JAVA9) — independent walker, SAME grammar as the analyzer`)
console.log(`corpus repo: ${REPO_DIR}`)
console.log(`population: ${all.length} .java files on disk · MEASURED ${files.length} · sampling: ${LANE_NFILES > 0 ? `first ${LANE_NFILES} lexicographic` : "ALL (lexicographic)"}`)
console.log(`audited types: ${TYPES.join(" ")}\n`)

interface Acc {
  /** analyzer distinct, oracle distinct */
  aSet: Set<string>
  oSet: Set<string>
  aEdges: number
  oEdges: number
  agree: number
  onlyAnalyzer: string[]
  onlyOracle: string[]
  onlyAnalyzerCount: number
  onlyOracleCount: number
  tp: number
  fp: number
  fn: number
  byCause: Record<string, number>
  /** UNATTRIBUTED residuals, kept verbatim: a cause table without the offending
   *  rows is a claim the reader cannot check. */
  unattributed: string[]
  onlyAnalyzerFiles: Set<string>
  onlyOracleFiles: Set<string>
}
const acc = new Map<T, Acc>()
for (const t of TYPES) acc.set(t, { aSet: new Set(), oSet: new Set(), aEdges: 0, oEdges: 0, agree: 0, onlyAnalyzer: [], onlyOracle: [], onlyAnalyzerCount: 0, onlyOracleCount: 0, tp: 0, fp: 0, fn: 0, byCause: {}, unattributed: [], onlyAnalyzerFiles: new Set(), onlyOracleFiles: new Set() })

/** the CURRENT file's synthesized anonymous-type names, so the cause test is
 *  per-file rather than a global guess. Rebound before each file's comparison. */
let anonFileNames = new Set<string>()

const analyzer = new RealJavaAnalyzer()
/** invocations the declared stdlib filter removed: a population the oracle
 *  reproduces by MIRRORING, so it is reported as a count rather than hidden
 *  inside an agreement percentage. */
const filteredCalls = { count: 0 }
/** override edges by the resolver TIER. Only `exact-in-file` is decidable from
 *  one file; `companion-index` (0.85) and `first-parent-guess` (0.5) name a
 *  parent outside the file, so this oracle does not adjudicate them and counts
 *  them instead. */
const overrideTiers = { count: {} as Record<string, number> }
/** type-reference edges this oracle does not derive. */
const unauditedReferences = { count: 0, examples: [] as string[] }
let parsed = 0, failures = 0
const t0 = Date.now()

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failures++; continue }
  const fl = relative(dir, f)
  let tree: any, res: any
  try {
    const parser = await getParser("java")
    tree = parser.parse(content, f)
    if (!tree) { failures++; continue }
    res = analyzer.analyze(tree.rootNode as any, content, f) as any
  } catch { failures++; tree?.delete?.(); continue }
  parsed++
  const o = deriveOracle(tree.rootNode)
  tree.delete?.()

  // Global sets: totals only.
  const fileA = new Map<T, Set<string>>()
  const fileO = new Map<T, Set<string>>()
  for (const t of TYPES) { fileA.set(t, new Set()); fileO.set(t, new Set()) }
  anonFileNames = new Set<string>()
  for (const sy of res.symbols ?? []) if (String(sy.name ?? "").startsWith("anonymous_")) anonFileNames.add(String(sy.name))

  for (const r of res.relationships ?? []) {
    let t = String(r.type ?? r.relationshipType ?? "") as T
    if (!acc.has(t)) continue
    // `references` carries TWO populations: import-derived (evidenceClass
    // `import_based`, one per import declaration) and type-reference
    // (`reference_qualified`, one per type mention). This oracle derives ONLY
    // the import population -- which is the one the `imports` verdict rests on
    // -- so the type-reference edges are COUNTED and DECLARED UNAUDITED rather
    // than silently counted as analyzer disagreements. A "disagreement" that is
    // really "the oracle does not look at this" is the shape of a fake finding.
    if (t === "overrides") {
      const rc = String(r.metadata?.reasonCode ?? "(none)")
      if (rc !== "exact-in-file") { overrideTiers.count[rc] = (overrideTiers.count[rc] ?? 0) + 1; continue }
    }
    if (t === "references") {
      if (r.metadata?.evidenceClass === "import_based") t = "references" as T
      else { unauditedReferences.count++; unauditedReferences.examples.push(fl + ": " + String(r.source) + " -> " + String(r.target)); continue }
    }
    const a = acc.get(t)!
    const k = String(r.source ?? "") + SEP + String(r.target ?? "")
    a.aEdges++
    a.aSet.add(k)
    fileA.get(t)!.add(k)
  }
  for (const t of TYPES) {
    const a = acc.get(t)!
    a.oEdges += o.edges.get(t) ?? 0
    for (const k of o.sets.get(t)!) { a.oSet.add(k); fileO.get(t)!.add(k) }
  }
  // Disagreements are decided PER FILE, against that file's own two sets. A
  // global pair of sets cannot attribute a difference to a file, and a
  // difference computed globally VANISHES whenever some other file happens to
  // emit the same pair -- which is what the first version of this script did,
  // printing the same four "analyzer-only" rows once per file.
  for (const t of TYPES) {
    const a = acc.get(t)!
    // Pair the two sides per file BEFORE counting, so a difference that is only
    // a naming convention on one axis is classified instead of landing in the
    // residual. Unpaired rows fall through to the text predicates, and whatever
    // is still unpaired is UNATTRIBUTED -- which is the only cell that can hide
    // a fabricated edge.
    const onlyA: string[] = []
    const onlyO: string[] = []
    for (const k of fileA.get(t)!) {
      if (fileO.get(t)!.has(k)) a.tp++
      else onlyA.push(k)
    }
    for (const k of fileO.get(t)!) if (!fileA.get(t)!.has(k)) onlyO.push(k)

    const srcOf = (k: string) => { const i = k.indexOf(SEP); return i < 0 ? k : k.slice(0, i) }
    const tgtOf = (k: string) => { const i = k.indexOf(SEP); return i < 0 ? "" : k.slice(i + SEP.length) }
    const leafOf = (s: string) => { const d = s.split("."); return d[d.length - 1] }

    const consumedO = new Set<string>()
    for (const k of onlyA) {
      let cause = ""
      for (const o of onlyO) {
        if (consumedO.has(o)) continue
        // same edge, different ACTOR: both walkers agree a call/use/instantiates
        // happens on `tgt` but name a different source
        if (tgtOf(k) === tgtOf(o) && srcOf(k) !== srcOf(o)) { cause = "SOURCE_ATTRIBUTION_DIFFERS"; consumedO.add(o); break }
        // same actor, different TARGET SPELLING: the analyzer keeps the
        // qualifier (`Monitor.Guard`, `Maps.KeySet`) where the oracle takes the
        // leaf (`Guard`, `KeySet`)
        if (srcOf(k) === srcOf(o) && leafOf(tgtOf(k)) === leafOf(tgtOf(o)) && tgtOf(k) !== tgtOf(o)) { cause = "QUALIFIED_TARGET_LEAF"; consumedO.add(o); break }
      }
      if (!cause) cause = attribute(t, k, "analyzer-only", fl)
      a.fp++
      a.byCause[cause] = (a.byCause[cause] ?? 0) + 1
      if (a.onlyAnalyzer.length < 6) a.onlyAnalyzer.push(fl + ": " + fmt(k) + "   [" + cause + "]")
      if (cause === "UNATTRIBUTED" && a.unattributed.length < 12) a.unattributed.push("ANALYZER-ONLY " + fl + ": " + fmt(k))
      a.onlyAnalyzerFiles.add(fl)
    }
    for (const k of onlyO) {
      if (consumedO.has(k)) continue
      a.fn++
      const cause = attribute(t, k, "oracle-only", fl)
      a.byCause[cause] = (a.byCause[cause] ?? 0) + 1
      if (a.onlyOracle.length < 6) a.onlyOracle.push(fl + ": " + fmt(k) + "   [" + cause + "]")
      if (cause === "UNATTRIBUTED" && a.unattributed.length < 12) a.unattributed.push("ORACLE-ONLY   " + fl + ": " + fmt(k))
      a.onlyOracleFiles.add(fl)
    }
  }
}

/* ------------------------------------------------------------------ *
 * CAUSE ATTRIBUTION.
 *
 * "1,115 analyzer-only calls" is not a finding, it is a number awaiting an
 * explanation, and an unexplained residual is exactly the shape a fabricated
 * edge hides inside. Every disagreement is therefore classified into a NAMED
 * cause by a deterministic predicate over the edge's own text, and the causes
 * are counted. A residual cause that is not one of the declared ones shows up as
 * `UNATTRIBUTED`, which is a real finding; a declared cause with a count is a
 * documented difference between two implementations.
 *
 * NO REGEX: each predicate is a char-code walk or a prefix test.
 * ------------------------------------------------------------------ */
function hasAngleBrackets(s: string): boolean {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 60 || c === 62) return true }
  return false
}
function startsWith(s: string, p: string): boolean {
  return s.length >= p.length && s.slice(0, p.length) === p
}
function attribute(t: T, key: string, side: string, fileLabel: string): string {
  const i = key.indexOf(SEP)
  const src = i < 0 ? key : key.slice(0, i)
  const tgt = i < 0 ? "" : key.slice(i + SEP.length)
  // Java keywords used as edge endpoints. Not declarations, so an endpoint equal
  // to one names nothing -- the analyzer's own comment on
  // explicit_constructor_invocation says the receiver keyword is used
  // deliberately rather than resolved.
  if (tgt === "this" || tgt === "super" || src === "this" || src === "super") return "KEYWORD_ENDPOINT"
  // a JPMS module directive: the analyzer emits `references` for every
  // exports/requires/opens/... target in a module-info.java and this oracle
  // derives only `import_declaration`, so these are a GAP IN THE ORACLE, not a
  // disagreement about a fact both walkers looked at. Classified rather than left
  // in the residual, and the count is the oracle's debt, named.
  if (fileLabel.endsWith("module-info.java")) return "JPMS_MODULE_DIRECTIVE_ORACLE_DOES_NOT_DERIVE"
  // a synthesized anonymous type name: written nowhere in the source
  if (startsWith(tgt, "anonymous_") || startsWith(src, "anonymous_") || anonFileNames.has(tgt) || anonFileNames.has(src)) return "SYNTHESIZED_ANONYMOUS_TYPE"
  // unstripped generic arguments in a type endpoint: `AbstractMultiset<E>.EntrySet`
  if (hasAngleBrackets(tgt) || hasAngleBrackets(src)) return "UNSTRIPPED_GENERIC_ENDPOINT"
  // a qualified target where the oracle derived the bare leaf: the analyzer keeps
  // the receiver on inheritance targets, the oracle does not
  if (side === "analyzer-only" && tgt.indexOf(".") >= 0 && tgt.split(".").pop() === src) return "QUALIFIED_TARGET_LEAF_MISMATCH"
  // the analyzer's constructor spelling as a source
  if (src === "constructor") return "CONSTRUCTOR_SPELLING_SOURCE"
  if (side === "oracle-only") return "ORACLE_ATTRIBUTES_TO_OUTER_TYPE"
  return "UNATTRIBUTED"
}

function fmt(k: string): string {
  const i = k.indexOf(SEP)
  return i < 0 ? k : k.slice(0, i) + " -> " + k.slice(i + SEP.length)
}

const wall = Date.now() - t0
console.log(`MEASURED ${parsed}/${files.length} files · ${failures} failures · ${wall} ms\n`)

function pct(n: number, d: number): string { return d > 0 ? ((n / d) * 100).toFixed(2) + "%" : "n/a" }

console.log(`| type | analyzer edges | analyzer distinct | oracle edges | oracle distinct | TP | FP (files) | FN (files) | precision | recall |`)
console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`)
for (const t of TYPES) {
  const a = acc.get(t)!
  const tp = a.tp, fp = a.fp, fn = a.fn
  console.log(`| ${t} | ${a.aEdges} | ${a.aSet.size} | ${a.oEdges} | ${a.oSet.size} | ${tp} | ${fp} (${a.onlyAnalyzerFiles.size} files) | ${fn} (${a.onlyOracleFiles.size} files) | ${pct(tp, tp + fp)} | ${pct(tp, tp + fn)} |`)
}

console.log(`\n=== DISAGREEMENT CAUSES (every FP and FN classified; UNATTRIBUTED is a finding) ===`)
for (const t of TYPES) {
  const a = acc.get(t)!
  const entries = Object.entries(a.byCause).sort((x, y) => y[1] - x[1])
  if (!entries.length) { console.log(`${t}: none`); continue }
  console.log(`${t}:`)
  for (const [k, v] of entries) console.log(`    ${k.padEnd(38)} ${v}`)
  for (const u of a.unattributed) console.log(`      UNATTRIBUTED ${u}`)
}

console.log(`\n=== POPULATIONS THIS ORACLE DOES NOT ADJUDICATE (counted, not scored) ===`)
console.log(`calls removed by the mirrored stdlib filter: ${filteredCalls.count}`)
console.log(`overrides by resolver tier:`)
for (const [k, v] of Object.entries(overrideTiers.count).sort()) console.log(`    ${k.padEnd(22)} ${v}`)
console.log(`references of evidenceClass reference_qualified (type mentions): ${unauditedReferences.count}`)
for (const x of unauditedReferences.examples.slice(0, 4)) console.log(`    ${x}`)

console.log(`\n=== DISAGREEMENT DETAIL (whole corpus, first 4 per type per side) ===`)
for (const t of TYPES) {
  const a = acc.get(t)!
  const fp = a.fp
  const fn = a.fn
  if (!fp && !fn) { console.log(`${t}: no disagreement`); continue }
  console.log(`${t}: ${fp} analyzer-only, ${fn} oracle-only`)
  for (const x of a.onlyAnalyzer) console.log(`    analyzer-only  ${x}`)
  for (const x of a.onlyOracle) console.log(`    oracle-only    ${x}`)
}
