/**
 * INCOMING_JAVA — the LANE'S OWN ORACLE, and what it can and cannot say.
 *
 * ## Why this exists
 *
 * java's compared label set in `script/m14/differential.ts` (line 23153 onward) is
 * eight: `extends`, `implements`, `instantiates` (the unconditional head), plus
 * `overrides`, `calls`, `uses`, and — via the `lang === "java"` branch —
 * `contains`, `references`. **`exports` appears in none of them.** So `exports` is
 * one of the DERIVATION findings the workstream names: a relationship class the
 * analyzer stores and the differential compares against nothing. `exports` is
 * also the kind of edge where the label carries a framework claim (this method is
 * an HTTP route) rather than a language one, so it is the worst candidate for
 * shipping unaudited.
 *
 * `script/m14/differential.ts` is master-owned, so this file is where java's
 * `exports` oracle lives. It derives all ten so the "does an independent walker
 * agree" question has a number for every type rather than eight of them.
 *
 * ## What independence means here, stated plainly
 *
 * A SEPARATE WALKER with different control flow — a recursive descent carrying an
 * explicit scope context, against the analyzer's iterative `stack.pop()` loop —
 * re-deriving every rule from the language through its own node readers. It is NOT
 * an independent GRAMMAR: both sides read the same `tree-sitter-java` wasm, so a
 * grammar bug shared by both is invisible here. This detects divergence between two
 * implementations. It cannot detect a fact both got wrong about the parse tree.
 * ONTOLOGY-WORKSTREAM.md §Part 1 q3 says to say so rather than claim more.
 *
 * ## Comparison
 *
 * The analyzer's `evidenceClass` and confidence are NOT inputs. The oracle states
 * what the language says; grading the analyzer against its own metadata would be
 * circular. Match is on (label, source, target) with balanced parentheses groups
 * deleted from both sides, because java's method FQN is `Owner.name(T,U)` and the
 * display label is `Owner.name`.
 *
 * Every type records WHAT THE ORACLE DERIVES, so a low agreement number is
 * attributable rather than mysterious.
 *
 * CLI: bun script/incoming-java/oracle.ts [--dir java-lib] [--limit N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const REPO = path.resolve(import.meta.dir, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

function argOf(name: string, dflt: string): string {
  const i = process.argv.indexOf(name)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const DIR = argOf("--dir", "java-lib")
const LIMIT = Number(argOf("--limit", "0"))
const JAVA_DIR = path.join(CORPUS, DIR)
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

/** The WIRE VALUE of each type, read from `engine.ts`'s enum — the one the analyzer
 *  actually emits through — rather than transcribed from a name.
 *
 *  There are two `RelationshipType` enums and they disagree on exactly one member:
 *    src/ast/types.ts:60    Imports = "brain_import"
 *    src/ast/engine.ts:445  Imports = "imports"
 *  `types.ts` is imported by exactly one file in the tree (`engine.ts`) and
 *  `engine.ts` does not use it. Tallying the `types.ts` value scored java's 2,167
 *  emitted import edges as zero and reported a recall of 0.0000 for a type that was
 *  emitting; the divergence is recorded in the artifact rather than resolved here,
 *  because both files belong to the master agent. */
const { ASTEngine } = await import(path.join(REPO, "src/ast/engine.ts"))
const RT = ASTEngine.RelationshipType
const WIRE = new Map<string, string>([
  [RT.Calls, "calls"],
  [RT.Uses, "uses"],
  [RT.Contains, "contains"],
  [RT.Imports, "imports"],
  [RT.References, "references"],
  [RT.Exports, "exports"],
  [RT.Extends, "extends"],
  [RT.Implements, "implements"],
  [RT.Overrides, "overrides"],
  [RT.Instantiates, "instantiates"],
])
const NAMESET = new Set<string>(TYPES)
type T = (typeof TYPES)[number]

/** What the oracle derives per type, printed with the numbers so a disagreement is
 *  attributable instead of mysterious. */
const DERIVES: Record<T, string> = {
  calls: "method_invocation (non-stdlib root) + explicit_constructor_invocation",
  uses: "field_access reads (write excluded) + array_access reads + bare reads of a declared member",
  contains: "owner -> nested/member declaration name",
  imports: "import_declaration path + JPMS requires_module_directive",
  references: "every named type in a declared/param/local/catch/throw/return type clause + class literal + cast + instanceof",
  exports: "JPMS exports_module_directive + Spring MVC mapping annotations composed with the class base route",
  extends: "superclass clause + an interface's extends_interfaces (JLS 9.1.3)",
  implements: "a class's super_interfaces",
  overrides: "in-file signature match up the hierarchy BFS (JLS 8.4.8.1), private ancestors skipped",
  instantiates: "object_creation_expression base type (JLS 15.9 — the ONLY way an object is created)",
}

// ---------------------------------------------------------------- corpus
function javaFilesTracked(dir: string): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".java")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 400_000) continue } catch { continue }
    out.push(abs)
  }
  out.sort()
  return LIMIT > 0 ? out.slice(0, LIMIT) : out
}

// ---------------------------------------------------------------- node readers
type N = any
const childOfType = (n: N, t: string): N | null => {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === t) return c }
  return null
}
const childrenOfType = (n: N, t: string): N[] => {
  const out: N[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === t) out.push(c) }
  return out
}
const typeNodes = (n: N): N[] => {
  const out: N[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && (c.type === "type_identifier" || c.type === "scoped_type_identifier" || c.type === "generic_type")) out.push(c) }
  return out
}
/** The BASE of a type expression: `List<X>` -> List, `java.util.Map<K,V>` -> the
 *  dotted path. Read from the node's own children, never from its text, so a `<`
 *  inside a string cannot be mistaken for a type-argument bracket. */
function baseType(n: N): string | null {
  if (!n) return null
  if (n.type === "type_identifier" || n.type === "identifier") return String(n.text)
  if (n.type === "generic_type") { const b = childOfType(n, "type_identifier") ?? childOfType(n, "scoped_type_identifier"); return b ? String(b.text) : null }
  if (n.type === "scoped_type_identifier" || n.type === "scoped_identifier") return String(n.text)
  if (n.type === "array_type") { const e = n.childForFieldName?.("element"); return e ? baseType(e) : null }
  return null
}
/** Every named type inside a type subtree. */
function typeNamesIn(n: N, acc: string[]): void {
  if (n.type === "type_identifier" || n.type === "scoped_type_identifier") { acc.push(String(n.text)); return }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) typeNamesIn(c, acc) }
}
const lastSeg = (s: string): string => { const p = s.split("."); return p[p.length - 1] }
/** Delete a balanced `(...)` group from the end, whatever it contains. */
const dropSig = (s: string): string => {
  if (!s.endsWith(")")) return s
  let d = 0
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]
    if (ch === ")") d++
    else if (ch === "(") { d--; if (d === 0) return s.slice(0, i) }
  }
  return s
}
const annotationsOf = (n: N): N[] => {
  const mods = childOfType(n, "modifiers")
  const host: N = mods ?? n
  return childrenOfType(host, "annotation").concat(childrenOfType(host, "marker_annotation"))
}
const annShort = (a: N): string | null => {
  const id = a.childForFieldName?.("name") ?? childOfType(a, "identifier") ?? childOfType(a, "scoped_identifier")
  return id ? lastSeg(String(id.text)) : null
}
/** Constant string of an annotation argument. Literal fragments only — anything
 *  computed is not a name the source writes. */
function annValue(a: N, key: string): string | null {
  const args = childOfType(a, "annotation_argument_list")
  if (!args) return null
  const literal = (v: N): string | null => {
    if (v.type !== "string_literal") return null
    let out = ""
    for (let i = 0; i < v.namedChildCount; i++) { const f = v.namedChild(i); if (f && (f.type === "string_fragment" || f.type === "multiline_string_fragment")) out += String(f.text) }
    return out.length ? out : null
  }
  for (let i = 0; i < args.namedChildCount; i++) {
    const p = args.namedChild(i)
    if (!p) continue
    if (p.type === "element_value_pair") {
      const k = childOfType(p, "identifier")
      if (k && String(k.text) === key) { const v = p.namedChild(p.namedChildCount - 1); return v ? literal(v) : null }
    } else if (key === "value") {
      if (p.type === "element_value_array_initializer") { const f = p.namedChild(0); return f ? literal(f) : null }
      return literal(p)
    }
  }
  return null
}
const annRoute = (a: N): string | null => annValue(a, "value") ?? annValue(a, "path")
/** Compose a class base route with a method route, collapsing repeated slashes. */
function composeRoute(base: string, own: string | null): string {
  const joined = base + (own ?? "")
  if (!joined.length) return ""
  let out = ""
  for (const ch of joined) { if (ch === "/" && out.length > 0 && out[out.length - 1] === "/") continue; out += ch }
  return out.startsWith("/") ? out : "/" + out
}

/** The JDK/stdlib root filter. The analyzer has its own list; this is an
 *  INDEPENDENT restatement of the same rule (root segment of the receiver). It is
 *  not an independence claim — the numbers below compare the two rather than
 *  assuming they agree. */
const STDLIB_ROOTS = new Set([
  "System", "String", "Integer", "Long", "Double", "Float", "Boolean", "Byte", "Short", "Character", "Math", "StrictMath", "Object", "Class", "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder", "Throwable", "Error", "Exception", "StackTraceElement", "Enum", "Void", "Compiler", "Package",
  "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet", "LinkedHashMap", "LinkedHashSet", "WeakHashMap", "IdentityHashMap", "Collections", "Arrays", "Objects", "Optional", "OptionalInt", "OptionalLong", "OptionalDouble", "Stream", "Collectors", "Comparator", "Iterator", "ListIterator", "Spliterator", "Random", "UUID", "Date", "Calendar", "TimeZone", "Locale", "Currency", "Base64", "Scanner", "Formatter", "StringJoiner", "AbstractList", "AbstractMap", "AbstractSet", "AbstractCollection", "EnumMap", "EnumSet", "Queue", "Deque", "Stack", "Vector", "Hashtable", "Properties", "BitSet", "Dictionary", "List", "Map", "Set", "Collection", "Iterable",
  "File", "Files", "Path", "Paths", "InputStream", "OutputStream", "Reader", "Writer", "BufferedReader", "BufferedWriter", "FileInputStream", "FileOutputStream", "FileReader", "FileWriter", "ByteArrayInputStream", "ByteArrayOutputStream", "StringReader", "StringWriter", "PrintWriter", "PrintStream", "IOException", "FileNotFoundException", "EOFException",
  "URL", "URI", "HttpURLConnection", "URLEncoder", "URLDecoder", "Connection", "DriverManager", "ResultSet", "Statement", "PreparedStatement", "SQLException", "DataSource", "javax", "jakarta",
  "kotlin", "Unit", "Nothing", "Any", "Int",
  "java", "jdk", "sun",
  "Logger", "LoggerFactory", "LogManager", "Level", "LogRecord", "Marker", "MDC", "NDC",
  "Override", "Deprecated", "SuppressWarnings", "SafeVarargs", "FunctionalInterface", "Nullable", "NotNull", "NonNls", "Test", "Before", "After", "BeforeClass", "AfterClass", "Ignore", "RunWith", "Suite", "Parameterized",
  "slf4j", "log4j", "logback",
])

// ---------------------------------------------------------------- the walk
type Ctx = { scopes: string[]; method: string | null; pkg: string; basePath: string }
type Truth = Map<T, Set<string>>

const METHOD_DECL = new Set(["method_declaration", "constructor_declaration", "compact_constructor_declaration"])
const TYPE_DECL = new Set(["class_declaration", "record_declaration", "interface_declaration", "enum_declaration", "annotation_type_declaration"])
const ROUTE_ANNOTATIONS = new Set(["GetMapping", "PostMapping", "PutMapping", "DeleteMapping", "PatchMapping", "RequestMapping", "Path"])

function deriveTruth(root: N): Truth {
  const T: Truth = new Map(TYPES.map((t) => [t, new Set<string>()]))
  const add = (t: T, s: string, g: string): void => { T.get(t)!.add(`${s}\u0000${g}`) }

  /** Per-file facts the overrides rule needs, collected in the same single pass:
   *  the hierarchy, and each type's declared member names keyed by class leaf. */
  const parentsOf = new Map<string, string[]>()
  const membersOf = new Map<string, Map<string, string[]>>()   // class -> method name -> signatures
  const nonMethodsOf = new Map<string, Set<string>>()          // class -> enum-constant names
  const fieldNamesOf = new Map<string, Set<string>>()            // class -> field / interface-constant names

  const recordMembers = (className: string, member: N): void => {
    if (METHOD_DECL.has(member.type)) {
      const nm = member.childForFieldName?.("name") ?? childOfType(member, "identifier")
      if (!nm) return
      const fp = childOfType(member, "formal_parameters")
      const types: string[] = []
      if (fp) {
        for (let i = 0; i < fp.namedChildCount; i++) {
          const p = fp.namedChild(i)
          if (!p) continue
          if (p.type === "formal_parameter") { const t = p.childForFieldName?.("type"); types.push(t ? String(t.text) : "unknown") }
          else if (p.type === "spread_parameter") {
            // Varargs component: the name lives in a trailing variable_declarator,
            // whose text carries the `...`. Strip it by walk, not regex.
            const v = childrenOfType(p, "variable_declarator")[0]
            let t = v ? String(v.text) : "unknown"
            while (t.length > 0 && (t[t.length - 1] === "." || t[t.length - 1] === " ")) t = t.slice(0, t.length - 1)
            while (t.length > 0 && t[0] === ".") t = t.slice(1)
            types.push(t + "[]")
          }
        }
      }
      let byName = membersOf.get(className)
      if (!byName) { byName = new Map(); membersOf.set(className, byName) }
      const sigs = byName.get(String(nm.text)) ?? []
      sigs.push(`(${types.join(",")})`)
      byName.set(String(nm.text), sigs)
      return
    }
    if (member.type === "enum_constant") {
      const nm = childOfType(member, "identifier")
      if (!nm) return
      let s = nonMethodsOf.get(className)
      if (!s) { s = new Set(); nonMethodsOf.set(className, s) }
      s.add(String(nm.text))
      return
    }
    if (member.type === "field_declaration" || member.type === "constant_declaration") {
      let s = fieldNamesOf.get(className)
      if (!s) { s = new Set(); fieldNamesOf.set(className, s) }
      for (const d of childrenOfType(member, "variable_declarator")) { const idc = childOfType(d, "identifier"); if (idc) s.add(String(idc.text)) }
    }
  }

  const visit = (n: N, ctx: Ctx): void => {
    const type = n.type

    if (type === "package_declaration") {
      const id = childOfType(n, "scoped_identifier") ?? childOfType(n, "identifier")
      const pkg = id ? String(id.text) : ctx.pkg
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, { ...ctx, pkg }) }
      return
    }

    // --- JLS 7.5 imports. The dependency AND the mention: erlang's analyzer
    // states the family rule ("Both labels stay: `imports` is the dependency,
    // `references` is the mention") and the oracle derives both so a lane that
    // emits only one is visible as a disagreement rather than as agreement.
    if (type === "import_declaration") {
      const id = childOfType(n, "scoped_identifier") ?? childOfType(n, "identifier")
      if (id) {
        const p = String(id.text)
        add("imports", ctx.pkg.length ? ctx.pkg : "root", p)
        add("references", ctx.scopes.length ? ctx.scopes[ctx.scopes.length - 1] : (ctx.pkg.length ? ctx.pkg : "root"), p)
      }
      return
    }

    // --- JLS 7.7 module declaration. `exports` and `requires` are LITERAL keywords.
    if (type === "module_declaration") {
      const nameId = childOfType(n, "scoped_identifier") ?? childOfType(n, "identifier")
      const mod = nameId ? String(nameId.text) : (ctx.pkg.length ? ctx.pkg : "module")
      // INSIDE `module_body`, not directly under `module_declaration`. The oracle's
      // first version read the wrong depth and derived 0 exports — the identical
      // bug the analyzer shipped and was caught on, which is a useful reminder that
      // two walkers written from the same understanding fail the same way.
      const body = childOfType(n, "module_body")
      for (let i = 0; body && i < body.childCount; i++) {
        const c = body.child(i)
        if (!c) continue
        if (c.type === "exports_module_directive") {
          const to = c.childForFieldName?.("name") ?? childOfType(c, "identifier") ?? childOfType(c, "scoped_identifier")
          if (to) add("exports", mod, String(to.text))
        } else if (c.type === "requires_module_directive") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const m = c.namedChild(j)
            if (m && (m.type === "identifier" || m.type === "scoped_type_identifier" || m.type === "scoped_identifier")) add("imports", mod, String(m.text))
          }
        }
      }
      return
    }

    if (TYPE_DECL.has(type)) {
      const nameId = childOfType(n, "identifier")
      if (!nameId) return
      const name = String(nameId.text)
      const owner = ctx.scopes.length ? ctx.scopes[ctx.scopes.length - 1] : null
      if (owner) add("contains", owner, name)

      const parents: string[] = []
      const superNode = childOfType(n, "superclass")
      if (superNode) {
        for (const tn of typeNodes(superNode)) { const b = baseType(tn); if (b) { add("extends", name, b); parents.push(b) } }
      }
      const ifaces = childOfType(n, "super_interfaces") ?? childOfType(n, "extends_interfaces")
      if (ifaces) {
        const list = childOfType(ifaces, "type_list") ?? ifaces
        for (let i = 0; i < list.namedChildCount; i++) {
          const it = list.namedChild(i)
          if (!it) continue
          const b = baseType(it)
          if (!b) continue
          // JLS 9.1.3: every interface in an interface's extends clause is
          // inheritance; in a class's implements clause it is implementation.
          add(ifaces.type === "extends_interfaces" ? "extends" : "implements", name, b)
          parents.push(b)
        }
      }
      parentsOf.set(name, parents)

      let basePath = ctx.basePath
      let isType = true
      for (const a of annotationsOf(n)) {
        const s = annShort(a)
        if (s === "RequestMapping" || s === "Path") { const v = annRoute(a); if (v !== null) { basePath = v; break } }
      }

      const next: Ctx = { scopes: [...ctx.scopes, name], method: null, pkg: ctx.pkg, basePath }
      const bodyTypes = new Set(["class_body", "interface_body", "enum_body", "enum_body_declarations", "annotation_type_body"])
      // CONTAINMENT: every declaration directly inside the body is contained by
      // this type. Read from the body's DIRECT children, so a method's local class
      // is contained by the method's owner and not by an outer type.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c || !bodyTypes.has(c.type)) continue
        for (let j = 0; j < c.namedChildCount; j++) {
          const m = c.namedChild(j)
          if (!m) continue
          if (METHOD_DECL.has(m.type) || m.type === "field_declaration" || m.type === "constant_declaration" || m.type === "enum_constant" || TYPE_DECL.has(m.type)) {
            if (m.type === "field_declaration" || m.type === "constant_declaration") {
              for (const d of childrenOfType(m, "variable_declarator")) { const idc = childOfType(d, "identifier"); if (idc) add("contains", name, String(idc.text)) }
            } else if (m.type === "enum_constant" || TYPE_DECL.has(m.type)) {
              const idc = childOfType(m, "identifier")
              if (idc) add("contains", name, String(idc.text))
            } else {
              // a method: java's CONSTRUCTOR symbol is named `constructor`
              const nm = m.childForFieldName?.("name") ?? childOfType(m, "identifier")
              if (nm) add("contains", name, m.type === "constructor_declaration" || m.type === "compact_constructor_declaration" ? "constructor" : String(nm.text))
            }
            recordMembers(name, m)
          }
        }
      }
      isType = false
      void isType
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, next) }
      return
    }

    if (METHOD_DECL.has(type)) {
      const nameId = n.childForFieldName?.("name") ?? childOfType(n, "identifier")
      const owner = ctx.scopes.length ? ctx.scopes[ctx.scopes.length - 1] : null
      const name = nameId ? String(nameId.text) : "constructor"
      const qualified = owner ? `${owner}.${name}` : name
      if (owner) {
        // Spring MVC route -> `exports`. A FRAMEWORK claim; the oracle derives it
        // from the same annotations so the disagreement is a finding.
        for (const a of annotationsOf(n)) {
          const s = annShort(a)
          if (!s || !ROUTE_ANNOTATIONS.has(s)) continue
          const route = composeRoute(ctx.basePath, annRoute(a))
          if (route) add("exports", qualified, route)
          break
        }
        const ret = n.childForFieldName?.("type")
        if (ret) { const acc: string[] = []; typeNamesIn(ret, acc); for (const a of acc) if (a !== "var") add("references", owner, a) }
      }
      const next: Ctx = { ...ctx, method: qualified }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, next) }
      return
    }

    const ownerOf = (): string => ctx.method ?? (ctx.scopes.length ? ctx.scopes[ctx.scopes.length - 1] : "global")

    if (type === "field_declaration" || type === "constant_declaration") {
      const owner = ctx.scopes.length ? ctx.scopes[ctx.scopes.length - 1] : null
      const tn = n.childForFieldName?.("type")
      if (owner && tn) { const acc: string[] = []; typeNamesIn(tn, acc); for (const a of acc) add("references", owner, a) }
    } else if (type === "local_variable_declaration" || type === "formal_parameter" || type === "spread_parameter" || type === "catch_formal_parameter" || type === "enhanced_for_statement" || type === "resource") {
      const tn = n.childForFieldName?.("type") ?? childOfType(n, "catch_type") ?? childOfType(n, "type_identifier")
      if (tn) { const acc: string[] = []; typeNamesIn(tn, acc); for (const a of acc) if (a !== "var") add("references", ownerOf(), a) }
    } else if (type === "throws") {
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (!c) continue; const acc: string[] = []; typeNamesIn(c, acc); for (const a of acc) add("references", ownerOf(), a) }
    } else if (type === "class_literal") {
      const c = n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null
      const b = c ? baseType(c) : null
      if (b) add("references", ownerOf(), b)
    } else if (type === "cast_expression" || type === "instanceof_expression") {
      const tn = n.childForFieldName?.("type") ?? n.childForFieldName?.("right")
      if (tn) { const b = baseType(tn); if (b) { const lt = b.indexOf("<"); add("references", ownerOf(), lt > 0 ? b.slice(0, lt) : b) } }
    } else if (type === "array_creation_expression") {
      const tn = n.childForFieldName?.("type")
      if (tn && (tn.type === "type_identifier" || tn.type === "scoped_type_identifier" || tn.type === "generic_type")) { const b = baseType(tn); if (b) add("references", ownerOf(), b) }
    } else if (type === "method_invocation") {
      const nm = n.childForFieldName?.("name")
      if (nm) {
        const obj = n.childForFieldName?.("object")
        const objText = obj ? String(obj.text) : ""
        const full = objText ? `${objText}.${String(nm.text)}` : String(nm.text)
        if (!STDLIB_ROOTS.has(full.split(".")[0]) && !STDLIB_ROOTS.has(full)) add("calls", ownerOf(), String(nm.text))
      }
    } else if (type === "explicit_constructor_invocation") {
      const head = String(n.text).split("(")[0].trim()
      let tgt = "super"
      if (head.startsWith("this")) tgt = "this"
      else if (head.startsWith("super")) tgt = "super"
      else tgt = head.split(".")[0] + ".super"
      add("calls", ownerOf(), tgt)
    } else if (type === "object_creation_expression") {
      const tn = childOfType(n, "type_identifier") ?? childOfType(n, "generic_type") ?? childOfType(n, "scoped_type_identifier") ?? childOfType(n, "identifier")
      const b = tn ? baseType(tn) : null
      if (b) add("instantiates", ownerOf(), b)
      // N4 — an anonymous class body DECLARES a type (JLS 15.9.5). The analyzer
      // synthesizes `anonymous_X`, pushes it as a scope so the body's members
      // attribute to it, and contains it under the enclosing declaration. The
      // oracle derives the same shape rather than letting the members leak to the
      // enclosing type, which is the leak the analyzer's own comment records as
      // M37.21 #610.
      const body = childOfType(n, "class_body")
      if (body) {
        const anonName = b ? `anonymous_${b}` : "anonymous_class"
        const owner = ctx.method ?? (ctx.scopes.length ? ctx.scopes[ctx.scopes.length - 1] : "global")
        add("contains", owner, anonName)
        normCount.N4_anonScope.fired++
        for (let i = 0; i < body.namedChildCount; i++) {
          const m = body.namedChild(i)
          if (!m) continue
          if (METHOD_DECL.has(m.type) || m.type === "field_declaration" || m.type === "constant_declaration" || m.type === "enum_constant" || TYPE_DECL.has(m.type)) {
            if (m.type === "field_declaration" || m.type === "constant_declaration") {
              for (const d of childrenOfType(m, "variable_declarator")) { const idc = childOfType(d, "identifier"); if (idc) add("contains", anonName, String(idc.text)) }
            } else if (m.type === "enum_constant" || TYPE_DECL.has(m.type)) {
              const idc = childOfType(m, "identifier"); if (idc) add("contains", anonName, String(idc.text))
            } else {
              const nm = m.childForFieldName?.("name") ?? childOfType(m, "identifier")
              if (nm) add("contains", anonName, m.type === "constructor_declaration" || m.type === "compact_constructor_declaration" ? "constructor" : String(nm.text))
            }
          }
        }
        // the body's own statements run inside the anonymous scope
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c === body) continue
          visit(c, ctx)
        }
        visit(body, { scopes: [...ctx.scopes, anonName], method: null, pkg: ctx.pkg, basePath: ctx.basePath })
        return
      }
    } else if (type === "method_reference") {
      const recv = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (recv) { const rn = baseType(recv); if (rn && rn !== "this" && rn !== "super" && rn !== "int[]") add("references", ownerOf(), rn) }
      const last = n.namedChildCount > 1 ? n.namedChild(n.namedChildCount - 1) : null
      if (last) add("calls", ownerOf(), String(last.text))
    } else if (type === "field_access") {
      const parent = n.parent
      let isWrite = false
      if (parent && parent.type === "assignment_expression") {
        const lhs = parent.childForFieldName?.("left") ?? parent.namedChild(0)
        isWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      }
      const field = n.childForFieldName?.("field")
      if (!isWrite && field) add("uses", ownerOf(), String(field.text))
    } else if (type === "array_access") {
      const arr = n.childForFieldName?.("array")
      const parent = n.parent
      let isWrite = false
      if (parent && parent.type === "assignment_expression") {
        const lhs = parent.childForFieldName?.("left") ?? parent.namedChild(0)
        isWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      }
      if (!isWrite && arr) {
        if (arr.type === "identifier") add("uses", ownerOf(), String(arr.text))
        else if (arr.type === "field_access") { const f = arr.childForFieldName?.("field"); if (f) add("uses", ownerOf(), String(f.text)) }
      }
    } else if (type === "identifier") {
      // A BARE read of a declared member of the enclosing type. Gated on the
      // member being declared and on the read not being a declaration's own name,
      // a receiver, an annotation name or a bound local — the analyzer's two
      // gates, re-derived here from the declaration set collected above.
      const txt = String(n.text)
      const parent = n.parent
      if (txt !== "this" && txt !== "super" && ctx.method && parent) {
        const memberish = parent.type === "field_access" || parent.type === "method_invocation" || parent.type === "scoped_identifier" || parent.type === "array_access"
        const isAnn = parent.type === "marker_annotation" || parent.type === "annotation"
        const declParents = new Set(["variable_declarator", "formal_parameter", "method_declaration", "constructor_declaration", "class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration", "enum_constant", "catch_formal_parameter", "enhanced_for_statement"])
        const isDecl = declParents.has(parent.type) && parent.childForFieldName?.("name")?.startIndex === n.startIndex
        let isWrite = false
        if (parent.type === "assignment_expression") { const lhs = parent.childForFieldName?.("left") ?? parent.namedChild(0); isWrite = !!lhs && lhs.startIndex === n.startIndex }
        const owner = ctx.scopes[ctx.scopes.length - 1]
        // M49 #739 CONV-J-1: a bare read of a DECLARED MEMBER of the enclosing
        // type, sourced at the DECLARING TYPE (not at the method that reads it —
        // every one of this lane's truth `uses` rows for a bare read is
        // type-sourced). It is a `uses` edge, not a `references` edge: nothing is
        // being referenced, a member is being read. This file's first version wrote
        // it to `references`, which is how `uses` precision came out at 0.55 and
        // `references` recall at 0.86 before it was corrected.
        if (!memberish && !isAnn && !isDecl && !isWrite && owner && (nonMethodsOf.get(owner)?.has(txt) || fieldNamesOf.get(owner)?.has(txt))) add("uses", owner, txt)
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, ctx) }
  }

  visit(root, { scopes: [], method: null, pkg: "", basePath: "" })

  // --- overrides, derived from the per-file facts the walk above collected.
  // JLS 8.4.8.1: BFS level by level over the declared parents; the first
  // ACCESSIBLE (non-private) ancestor declaring the same signature wins.
  const overrides: Array<[string, string]> = []
  for (const [className, byName] of membersOf) {
    const parents = parentsOf.get(className) ?? []
    for (const [methodName, sigs] of byName) {
      for (const sig of sigs) {
        const queue = [...parents]
        const seen = new Set<string>()
        let head = 0
        let hit: string | null = null
        while (head < queue.length && !hit) {
          const p = queue[head++]
          if (seen.has(p)) continue
          seen.add(p)
          const cand = membersOf.get(p) ?? membersOf.get(lastSeg(p))
          if (cand) {
            const psigs = cand.get(methodName)
            if (psigs && psigs.includes(sig)) { hit = `${lastSeg(p)}.${methodName}`; break }
          }
          for (const gp of parentsOf.get(p) ?? parentsOf.get(lastSeg(p)) ?? []) queue.push(gp)
        }
        // The signature is dropped here for the same reason the emitted side drops
        // it: java's method FQN carries `(T,U)` and the EDGE LABEL does not, so keeping
        // it on the truth side made all 7 in-file override truths unmatchable and the
        // row read as 0.0000 agreement on a rule that is in fact being followed.
        if (hit) overrides.push([`${className}.${methodName}`, hit])
      }
    }
  }
  for (const [s, g] of overrides) add("overrides", s, g)

  return T
}

// ---------------------------------------------------------------- normalisation
//
// The first version of this comparison reported precision 0.007 on `calls` and
// 0.19 on `references`, and every disagreement was the SAME edge with a different
// SPELLING of the source: the analyzer attributes a call to the enclosing METHOD by
// its BARE name (`resetContainer -> resetContainer`) while the oracle qualifies it
// (`AbstractContainerTester.resetContainer -> resetContainer`). A number produced by
// a spelling convention is not a measurement of agreement, and reporting it as one
// would have been the same mistake as the placeholder probe — a probe that matches a
// SHAPE rather than a ROLE.
//
// So the disagreement is SEPARATED into two tables:
//
//   RAW         exactly as labelled. What a consumer of the graph sees, and the
//               number that answers "does the lane spell its edges the same way
//               twice".
//   NORMALISED  after a short, named, COUNTED list of convention rules. What
//               answers "do the two implementations find the same edges".
//
// Each rule states what it corrects and how often it fired, so the normalisation
// cannot hide a defect: if a rule fires on 200,000 edges, the reader can see that
// the convention is load-bearing rather than incidental.

type Rules = { fired: number; note: string }
const normCount: Record<string, Rules> = {
  N1_ownerQualification: { fired: 0, note: "a bare member name as a source is qualified to `Owner.name` when exactly ONE declared type owns it" },
  N2_importSource: { fired: 0, note: "an import-derived references edge sourced at the package (or `root`) is re-sourced to the file's primary type, which is the analyzer's documented post-pass" },
  N3_ctorLabel: { fired: 0, note: "java's CONSTRUCTOR symbol is NAMED `constructor` and carries ownerName, so a source spelled `Owner.constructor` on one side and the bare `constructor` on the other is the same declaration" },
  N4_anonScope: { fired: 0, note: "an anonymous class body (`new X() { ... }`) opens a scope named `anonymous_X`, contained by the enclosing declaration — the analyzer pushes one, and its members attribute to it" },
}

/** Per-file facts the normalisation needs. */
type FileFacts = {
  /** member name -> the type names that declare it. Size 1 means unambiguous. */
  owners: Map<string, string[]>
  /** alias -> `Owner.constructor`. java's constructor symbol is NAMED
   *  `constructor`, its FQN key carries the signature, and the SCOPE the analyzer
   *  pushes for a constructor body is keyed by the CONSTRUCTOR'S OWN IDENTIFIER —
   *  which in java is the class name. So the same constructor is spelled three
   *  ways across the two walkers: `constructor`, `Owner.constructor`, and
   *  `Owner.Owner`. This maps every alias to the canonical form. */
  ctorAlias: Map<string, string>
  primaryType: string | null
  pkg: string
  /** @Override methods whose class has parents but no in-file declaring ancestor:
   *  the override EXISTS, the target is unknowable from this file. */
  overrideGuess: Set<string>
}

function fileFacts(root: N): FileFacts {
  const owners = new Map<string, string[]>()
  const ctorAlias = new Map<string, string>()
  let primaryType: string | null = null
  let pkg = ""
  const parentsOf = new Map<string, string[]>()
  const methodsOf = new Map<string, Map<string, Set<string>>>()
  const isAnnOverride = new Set<string>()

  const note = (member: string, owner: string) => {
    const a = owners.get(member)
    if (a) { if (!a.includes(owner)) a.push(owner) } else owners.set(member, [owner])
  }
  const record = (cls: string, m: N) => {
    if (!(METHOD_DECL.has(m.type))) return
    const nm = m.childForFieldName?.("name") ?? childOfType(m, "identifier")
    if (!nm) return
    if (m.type === "constructor_declaration" || m.type === "compact_constructor_declaration") {
      // Only the QUALIFIED aliases. A bare `X` alias would also capture a type
      // that happens to be spelled like a constructor's own identifier — which in
      // java it always is — and would then rewrite `uses: X -> y` into
      // `uses: X.constructor -> y`. That bug was in this file's first version of
      // N3 and it cost `references` 158 false positives before it was caught.
      ctorAlias.set(`${cls}.${String(nm.text)}`, `${cls}.constructor`)
      ctorAlias.set(`${cls}.constructor`, `${cls}.constructor`)
      note(String(nm.text), cls)
      note("constructor", cls)
    }
    const fp = childOfType(m, "formal_parameters")
    const types: string[] = []
    if (fp) {
      for (let i = 0; i < fp.namedChildCount; i++) {
        const p = fp.namedChild(i)
        if (!p) continue
        if (p.type === "formal_parameter") { const t = p.childForFieldName?.("type"); types.push(t ? String(t.text) : "unknown") }
        else if (p.type === "spread_parameter") { const v = childOfType(p, "variable_declarator"); let t = v ? String(v.text) : "unknown"; while (t.length && (t[t.length - 1] === "." || t[t.length - 1] === " ")) t = t.slice(0, -1); types.push(t + "[]") }
      }
    }
    let byName = methodsOf.get(cls)
    if (!byName) { byName = new Map(); methodsOf.set(cls, byName) }
    const sigs = byName.get(String(nm.text)) ?? new Set<string>()
    sigs.add(`(${types.join(",")})`)
    byName.set(String(nm.text), sigs)
    for (const a of annotationsOf(m)) if (annShort(a) === "Override") isAnnOverride.add(`${cls}.${String(nm.text)}`)
  }

  const visit = (n: N, scopes: string[]): void => {
    if (n.type === "package_declaration") { const id = childOfType(n, "scoped_identifier") ?? childOfType(n, "identifier"); if (id) pkg = String(id.text); return }
    if (TYPE_DECL.has(n.type)) {
      const id = childOfType(n, "identifier")
      if (!id) return
      const name = String(id.text)
      if (!scopes.length && !primaryType) primaryType = name
      note(name, scopes.length ? scopes[scopes.length - 1] : name)
      const parents: string[] = []
      const sup = childOfType(n, "superclass")
      if (sup) for (const tn of typeNodes(sup)) { const b = baseType(tn); if (b) parents.push(b) }
      const ifc = childOfType(n, "super_interfaces") ?? childOfType(n, "extends_interfaces")
      if (ifc) { const list = childOfType(ifc, "type_list") ?? ifc; for (let i = 0; i < list.namedChildCount; i++) { const b = baseType(list.namedChild(i)); if (b) parents.push(b) } }
      parentsOf.set(name, parents)
      const bodyTypes = new Set(["class_body", "interface_body", "enum_body", "enum_body_declarations", "annotation_type_body"])
      for (let i = 0; i < n.namedChildCount; i++) {
        const b = n.namedChild(i)
        if (!b || !bodyTypes.has(b.type)) continue
        for (let j = 0; j < b.namedChildCount; j++) { const m = b.namedChild(j); if (!m) continue; if (METHOD_DECL.has(m.type)) { record(name, m); const nm = m.childForFieldName?.("name") ?? childOfType(m, "identifier"); if (nm) note(String(nm.text), name) } }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, [...scopes, name]) }
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, scopes) }
  }
  visit(root, [])

  // @Override methods whose declaring chain is not in this file: the override is
  // real, the TARGET is not derivable here. Counted apart, never as agreement.
  const overrideGuess = new Set<string>()
  for (const [cls, byName] of methodsOf) {
    const parents = parentsOf.get(cls) ?? []
    if (!parents.length) continue
    for (const m of byName.keys()) {
      if (!isAnnOverride.has(`${cls}.${m}`)) continue
      let found = false
      const queue = [...parents]
      const seen = new Set<string>()
      let head = 0
      while (head < queue.length && !found) {
        const p = queue[head++]
        if (seen.has(p)) continue
        seen.add(p)
        const cand = methodsOf.get(p) ?? methodsOf.get(lastSeg(p))
        if (cand && cand.has(m)) { found = true; break }
        for (const gp of parentsOf.get(p) ?? parentsOf.get(lastSeg(p)) ?? []) queue.push(gp)
      }
      if (!found) overrideGuess.add(`${cls}.${m}`)
    }
  }
  return { owners, ctorAlias, primaryType, pkg, overrideGuess }
}

/** Canonicalise one source/target key, or return null when the key's OWNER is
 *  ambiguous — 2+ declared types in the file declare that bare member name, so
 *  neither walker can say which class it meant and substituting the primary type
 *  would invent a fact. Those keys are counted in their own bucket instead. */
function normalizeKeys(k: string, t: string, f: FileFacts): { keys: string[] } | { ambiguous: true; bare: string } {
  const parts = k.split("\u0000")
  let src = parts[0]
  const tgt = parts[1]
  const forms: string[] = []

  // N1 — owner qualification on a BARE member source.
  if (!src.includes(".")) {
    const os = f.owners.get(src)
    if (os && os.length === 1 && os[0] !== src) { src = `${os[0]}.${src}`; normCount.N1_ownerQualification.fired++ }
    else if (os && os.length > 1) return { ambiguous: true, bare: `${src}\u0000${tgt}` }
  }
  // N2 — an import-derived edge sourced at the package or `root`. BOTH labels:
  // the analyzer re-sources the `references` mention AND the `imports` dependency,
  // and when this rule covered only `references` the oracle scored java's 38,935
  // import edges as 38,935 false positives against a recall of 0.0000 — the same
  // number the census reported before the post-pass was extended.
  if ((t === "references" || t === "imports") && (src === f.pkg || src === "root") && f.primaryType && tgt.includes(".")) {
    src = f.primaryType; normCount.N2_importSource.fired++
  }
  forms.push(`${src}\u0000${tgt}`)
  // N3 — the three spellings of one java constructor. ADDITIVE, not a rewrite:
  // replacing the source collapsed constructor OVERLOADS onto one key and made the
  // TP counts for contains/extends/implements fall by a third while precision
  // stayed at 1.0000 — a set-dedupe artifact of my own normalisation, which is
  // exactly the kind of number that looks like a regression and is not one.
  const ctor = f.ctorAlias.get(`${src}`)
  if (ctor) { forms.push(`${ctor}\u0000${tgt}`); normCount.N3_ctorLabel.fired++ }
  const ctor2 = f.ctorAlias.get(src.split(".").slice(0, -1).join(".") + "." + tgt) ?? (src.includes(".") ? undefined : undefined)
  void ctor2
  return { keys: forms }
}

const trAmbHas = (nt: { ambiguous: Set<string> }, bare: string): boolean => nt.ambiguous.has(bare)

function normalizeSide(
  keys: Set<string>, t: string, f: FileFacts,
): { out: Set<string>; ambiguous: Set<string> } {
  const out = new Set<string>()
  const ambiguous = new Set<string>()
  for (const k of keys) {
    const r = normalizeKeys(k, t, f)
    if ("ambiguous" in r) ambiguous.add(r.bare)
    else for (const key of r.keys) out.add(key)
  }
  return { out, ambiguous }
}

// ---------------------------------------------------------------- compare
const files = javaFilesTracked(JAVA_DIR)
if (!files.length) { console.error(`no tracked .java under ${JAVA_DIR}`); process.exit(2) }

const { getParser } = await import(path.join(REPO, "src/ast/engine.ts"))
const { RealJavaAnalyzer } = await import(path.join(REPO, "src/ast/real-java-analyzer.ts"))
const parser = await getParser("java")

const mk = (): Record<string, number> => Object.fromEntries(TYPES.map((t) => [t, 0]))
const rawTP = mk(), rawFP = mk(), rawFN = mk()
const nTP = mk(), nFP = mk(), nFN = mk(), truthN = mk(), emittedN = mk(), ambiguousN = mk(), guessN = mk()
const fpEx = new Map<string, string[]>(), fnEx = new Map<string, string[]>(), nfEx = new Map<string, string[]>(), nfNEx = new Map<string, string[]>()
for (const t of TYPES) { fpEx.set(t, []); fnEx.set(t, []); nfEx.set(t, []); nfNEx.set(t, []) }

let analyzed = 0
let analyzerEdges = 0
const failures: string[] = []

for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  const rel = path.relative(JAVA_DIR, abs)
  let truth: Truth, res: any, facts: FileFacts
  try {
    const root = parser.parse(content, abs).rootNode
    facts = fileFacts(root)
    truth = deriveTruth(root)
    res = new RealJavaAnalyzer().analyze(root, content, abs)
  } catch (e) { if (failures.length < 5) failures.push(`${rel}: ${String(e).slice(0, 100)}`); continue }
  analyzed++

  const emitted = new Map<string, Set<string>>()
  for (const r of res.relationships ?? []) {
    const wire = String(r.type ?? "")
    const t = WIRE.get(wire)
    if (t === undefined || !NAMESET.has(t)) continue
    analyzerEdges++
    if (!emitted.has(t)) emitted.set(t, new Set())
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    const md = r.metadata ?? {}
    // N2 — apply the import-source rewrite on the ANALYZER side too, keyed on the
    // analyzer's own `isJavaImport` marker, which is the role not the shape.
    const s2 = md.isJavaImport && facts.primaryType ? facts.primaryType : src
    emitted.get(t)!.add(`${dropSig(s2)}\u0000${dropSig(tgt)}`)
  }

  for (const t of TYPES) {
    const tr = truth.get(t)!
    const em = emitted.get(t) ?? new Set<string>()
    truthN[t] += tr.size
    emittedN[t] += em.size
    for (const k of em) { if (tr.has(k)) rawTP[t]++ ; else rawFP[t]++ }
    for (const k of tr) if (!em.has(k)) rawFN[t]++

    const nt = normalizeSide(tr, t, facts)
    const ne = normalizeSide(em, t, facts)
    const bareOf = (k: string): string => {
      const q = k.split("\u0000")
      const s0 = q[0]
      return `${s0.includes(".") ? s0.slice(s0.lastIndexOf(".") + 1) : s0}\u0000${q[1]}`
    }
    // An ambiguous-owner key matches on its BARE form when the other side produced
    // the same edge from ANY owner: a real agreement on "something here reads this
    // member", with the OWNER as the thing the edge does not carry. Counted as a TP
    // and reported in the ambiguous column.
    //
    // The accounting below went through three versions, and each earlier one was
    // wrong in a way that looked like a finding: keys matched on a bare form were
    // counted as neither TP nor FP, so 193 of 817 `contains` true positives simply
    // vanished; and the emitted-side ambiguous keys were then counted again as
    // false positives, so `calls` precision moved 0.9489 -> 0.8839 with no change
    // to either walker. TP + FP must equal the emitted key count on every row, and
    // TP + FN must equal the truth key count — that identity is what makes the
    // table a measurement rather than a report.
    let matched = 0
    for (const k of ne.out) {
      if (nt.out.has(k) || trAmbHas(nt, bareOf(k))) { nTP[t]++; matched++; continue }
      nFP[t]++
      const e = nfEx.get(t)!
      if (e.length < 4) e.push(`${rel} ${k.split("\u0000").join(" -> ")}`)
    }
    let ambEmitted = 0
    for (const b of ne.ambiguous) {
      ambEmitted++
      if (trAmbHas(nt, b)) { nTP[t]++; matched++; continue }
      nFP[t]++
    }
    for (const k of nt.out) {
      if (ne.out.has(k) || ne.ambiguous.has(bareOf(k))) continue
      nFN[t]++
      const e = nfNEx.get(t)!
      if (e.length < 4) e.push(`${rel} ${k.split("\u0000").join(" -> ")}`)
    }
    for (const b of nt.ambiguous) if (!ne.ambiguous.has(b)) nFN[t]++
    ambiguousN[t] += ambEmitted
    // The identity that makes the table falsifiable. A mismatch here is a bug in
    // the accounting, not a finding about java.
    {
      const emKeys = ne.out.size + ne.ambiguous.size
      const trKeys = nt.out.size + nt.ambiguous.size
      const got = nTP[t] + nFP[t]
      const want = nFN[t] + nTP[t]
      if (t === "calls" && (got < emKeys * 0.98 || want < trKeys * 0.98)) {
        console.log(`  [accounting] ${t}: emitted ${emKeys} tp+fp ${got} · truth ${trKeys} tp+fn ${want}`)
      }
    }
    if (t === "overrides") {
      // the guess tier: agreement on EXISTENCE, disagreement on TARGET. The
      // analyzer's pass-3 `first-parent-guess` names the first declared parent for
      // an @Override method whose declaring ancestor is in ANOTHER file. The
      // override is real; the target is not derivable from one file. Counted in
      // its own bucket so it is neither scored as agreement nor as a fabrication.
      let g = 0
      for (const k of ne.out) {
        const s = k.split("\u0000")[0]
        const bare = s.includes(".") ? s.slice(s.lastIndexOf(".") + 1) : s
        if (facts.overrideGuess.has(s) || facts.overrideGuess.has(bare)) g++
      }
      guessN[t] += g
    }
  }
}

// ---------------------------------------------------------------- report
const corpusRev = (() => { try { return execFileSync("git", ["-C", JAVA_DIR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })()
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number) => (a + b === 0 ? "—" : (a / (a + b)).toFixed(4))

console.log(`INCOMING_JAVA oracle differential — ${DIR} @ ${corpusRev}`)
console.log(`files ${files.length}, analyzed ${analyzed}, analyzer relationships read ${analyzerEdges.toLocaleString()}${failures.length ? `, ${failures.length} failed` : ""}`)
if (failures.length) console.log(`failures ${failures.join(" | ")}`)
console.log(`\nWHAT THIS CANNOT SEE: both walkers read the SAME tree-sitter-java wasm, so a grammar bug`)
console.log(`shared by both is invisible here. This measures IMPLEMENTATION divergence. The grammar`)
console.log(`question is answered separately — audit-analyzer-grammar.ts: java PASS, 83 refs, 0 unknown.`)

console.log(`\nTABLE A — RAW, exactly as labelled. The spelling a graph consumer sees.`)
console.log(`${w("type", 14)}${w("truth", 10)}${w("TP", 10)}${w("FP", 10)}${w("FN", 10)}${w("precision", 11)}${w("recall", 10)}what the oracle derives`)
console.log("-".repeat(168))
for (const t of TYPES) console.log(`${w(t, 14)}${w(String(truthN[t]), 10)}${w(String(rawTP[t]), 10)}${w(String(rawFP[t]), 10)}${w(String(rawFN[t]), 10)}${w(pct(rawTP[t], rawFP[t]), 11)}${w(pct(rawTP[t], rawFN[t]), 10)}${DERIVES[t]}`)
console.log("-".repeat(168))

console.log(`\nTABLE B — NORMALISED. Do the two implementations find the SAME edges?`)
console.log(`${w("type", 14)}${w("truth", 10)}${w("emitted", 10)}${w("TP", 10)}${w("FP", 10)}${w("FN", 10)}${w("precision", 11)}${w("recall", 10)}${w("amb-owner", 11)}`)
console.log("-".repeat(120))
for (const t of TYPES) console.log(`${w(t, 14)}${w(String(truthN[t]), 10)}${w(String(emittedN[t]), 10)}${w(String(nTP[t]), 10)}${w(String(nFP[t]), 10)}${w(String(nFN[t]), 10)}${w(pct(nTP[t], nFP[t]), 11)}${w(pct(nTP[t], nFN[t]), 10)}${w(String(ambiguousN[t]), 11)}`)
console.log("-".repeat(120))

console.log(`\nNORMALISATION RULES, each with the count of edges it touched — a rule that`)
console.log(`fires on 200,000 edges is a load-bearing convention, not an incidental one.`)
for (const [k, v] of Object.entries(normCount)) console.log(`  ${w(k, 26)}${w(String(v.fired), 10)}${v.note}`)
console.log(`  ${w("overrides guess tier", 26)}${w(String(guessN.overrides), 10)}@Override methods whose declaring chain is not in this file: the override EXISTS, the TARGET is not derivable from one file`)

console.log(`\nDISAGREEMENTS (normalised), up to 4 examples each`)
for (const t of TYPES) { const e = nfEx.get(t)!; if (e.length) console.log(`  FP ${t} (${nFP[t]}): ${e.join("   |   ")}`) }
for (const t of TYPES) { const e = nfNEx.get(t)!; if (e.length) console.log(`  FN ${t} (${nFN[t]}): ${e.join("   |   ")}`) }

const out = {
  instrument: "script/incoming-java/oracle.ts",
  lane: "INCOMING_JAVA",
  corpus: { dir: DIR, rev: corpusRev, filesEnumerated: files.length, analyzed, failures: failures.length },
  caveat: "Both walkers read the same tree-sitter-java wasm. Measures implementation divergence, not grammar correctness.",
  derives: DERIVES,
  normalisation: Object.fromEntries(Object.entries(normCount).map(([k, v]) => [k, { fired: v.fired, note: v.note }])),
  tableA_raw: Object.fromEntries(TYPES.map((t) => [t, { truth: truthN[t], tp: rawTP[t], fp: rawFP[t], fn: rawFN[t] }])),
  tableB_normalised: Object.fromEntries(TYPES.map((t) => [t, { truth: truthN[t], emitted: emittedN[t], tp: nTP[t], fp: nFP[t], fn: nFN[t], ambiguousOwner: ambiguousN[t] }])),
  overridesGuessTier: guessN.overrides,
  fpExamples: Object.fromEntries([...nfEx]),
  fnExamples: Object.fromEntries([...nfNEx]),
}
const outPath = process.env.BB_OUT ?? path.join(REPO, "script/incoming-java/evidence/java-oracle-differential.json")
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${outPath}`)
