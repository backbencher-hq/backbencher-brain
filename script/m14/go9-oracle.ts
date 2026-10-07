// VERIFY_GO9 independent oracle.
//
// WHAT THIS IS. The workstream's question 3 ("does an independent oracle
// agree?") asked per emitted type. This file answers it with a SECOND WALKER
// over the same grammar, written from Go's own semantics rather than from the
// analyzer's helpers, and using a different traversal strategy: a TreeCursor
// with an explicit enter/leave stack, where the analyzer recurses over
// `child(i)`/`namedChildren` and reads fields by name.
//
// ITS LIMIT, STATED UP FRONT (the workstream requires this rather than a
// stronger claim than the harness supports): both walkers consume the SAME
// `wasm/tree-sitter-go.wasm`. A bug in that grammar — a mis-typed node, a
// missing field, a mis-scoped `namedChildren` — is invisible to this oracle
// because it is inherited, not independently observed. What this file CAN
// establish is that two independently written readings of the tree agree on
// which edges exist, how they are labelled, and where they point. It cannot
// establish that the tree itself is a faithful reading of the .go file.
//
// Per-type derivation notes are on each builder. Each returns a SET of edge
// keys, so agreement is set equality — order and duplicates are not scored.
//
//   NFILES=200 bun script/m14/go9-oracle.ts
//   NFILES=200 TYPES=exports,overrides bun script/m14/go9-oracle.ts
//
// No regular expression in this file. Char-code tests only.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/VERIFY_GO9"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const DIR = join(CORPUS, process.env.BB_DIR || "go-stdlib")
const NFILES = Number(process.env.NFILES || 200)
const ONLY = (process.env.TYPES || "").split(",").filter(Boolean)
const SIGNALS = ["func ", "package "]

function pickFiles(dir: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (out.length >= want || depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "node_modules") continue
        walk(p, depth + 1)
      } else if (e.name.endsWith(".go")) {
        try {
          if (statSync(p).size >= 400_000) continue
          const src = readFileSync(p, "utf8")
          if (!SIGNALS.some((s) => src.includes(s))) continue
          out.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  return out.slice(0, want)
}

// ------------------------------------------------------------------ parsing

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const GO_LANG = await L.load(readFileSync(join(REPO, "wasm", "tree-sitter-go.wasm")))
const parser = new P()
parser.setLanguage(GO_LANG)

/** CURSOR WALK — enter/leave over the whole tree, collecting nodes flat. */
interface Collected { nodes: any[]; }
function collect(root: any): Collected {
  const nodes: any[] = []
  const c = root.walk()
  let cont = true
  while (cont) {
    if (c.currentNode) nodes.push(c.currentNode)
    if (c.gotoFirstChild()) continue
    while (true) {
      if (c.gotoNextSibling()) break
      if (!c.gotoParent()) { cont = false; break }
    }
  }
  try { c.delete() } catch {}
  return { nodes }
}

/** Nearest ancestor of `n` whose type is in `types`, inclusive walk-up. */
function ancestorOfType(n: any, types: Set<string>): any {
  let cur = n.parent
  while (cur) {
    if (types.has(cur.type)) return cur
    cur = cur.parent
  }
  return null
}

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i))
  return out
}
function fieldNode(n: any, field: string): any {
  try { return n.childForFieldName(field) ?? null } catch { return null }
}
/** A dotted selector's final segment, or the identifier itself. */
function leafName(n: any): string {
  if (!n) return ""
  if (n.type === "selector_expression") {
    const f = fieldNode(n, "field")
    return f ? String(f.text ?? "") : ""
  }
  if (n.type === "identifier" || n.type === "field_identifier" || n.type === "package_identifier" || n.type === "type_identifier") {
    return String(n.text ?? "")
  }
  // `qualified_type` (`io.Reader`) and `qualified_type_identifier` carry the
  // package qualifier in their own text. The FAMILY convention for go is that a
  // target is the LEAF after the final `.` — an import PATH is the one thing
  // allowed to keep its separators — so descend with lastIndexOf, not a regex.
  if (n.type === "qualified_type" || n.type === "qualified_type_identifier" || n.type === "qualified_field_identifier") {
    const t = String(n.text ?? "")
    const i = t.lastIndexOf(".")
    return i >= 0 ? t.slice(i + 1) : t
  }
  return String(n.text ?? "")
}
function isExportedName(s: string): boolean {
  if (!s.length) return false
  const c = s.charCodeAt(0)
  return c >= 65 && c <= 90 // A-Z
}

// -------------------------------------------------------- per-type builders

type EdgeSet = Set<string>
const k = (s: string, t: string) => `${s} ${t}`

/** The declared name of a type at package scope, from its `type_spec`. */
function declaredTypeNames(nodes: any[]): Set<string> {
  const out = new Set<string>()
  for (const n of nodes) {
    if (n.type !== "type_spec") continue
    const nm = fieldNode(n, "name")
    if (nm) out.add(String(nm.text ?? ""))
  }
  return out
}

/** package clause name, or "" */
function packageNameOf(nodes: any[]): string {
  for (const n of nodes) {
    if (n.type !== "package_clause") continue
    for (const c of namedChildren(n)) {
      if (c.type === "package_identifier" || c.type === "identifier") return String(c.text ?? "")
    }
  }
  return ""
}

/**
 * exports — Go has NO export declaration. The fact that exists is a naming
 * convention: a package-scope identifier whose first character is A-Z is
 * exported, and the Go spec makes that the whole of "exported". So truth =
 * one edge per package-scope declared name with an uppercase first letter,
 * sourced at the package clause's own identifier.
 *
 * Note what this cannot be: an `export` KEYWORD. The grammar has no
 * export_statement node, which is why this oracle derives the convention
 * rather than reading a node — and why the two walkers agreeing here is
 * evidence about the convention's application, not about a declaration.
 */
function truthExports(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  const pkg = packageNameOf(nodes)
  if (!pkg) return out
  // Direct children of source_file only: package scope, by construction.
  const root = nodes[0]
  for (const d of namedChildren(root)) {
    let names: string[] = []
    if (d.type === "function_declaration") {
      const nm = fieldNode(d, "name")
      names = nm ? [String(nm.text ?? "")] : []
    } else if (d.type === "method_declaration") names = [] // methods are not package-scope names
    else if (d.type === "type_declaration") {
      names = namedChildren(d).filter((c) => c.type === "type_spec").map((c) => {
        const nm = fieldNode(c, "name"); return nm ? String(nm.text ?? "") : ""
      })
    } else if (d.type === "var_declaration" || d.type === "const_declaration") {
      names = namedChildren(d).flatMap((c) => {
        const nm = fieldNode(c, "name")
        return nm ? [String(nm.text ?? "")] : []
      })
    }
    for (const nm of names) if (isExportedName(nm)) out.add(k(pkg, nm))
  }
  return out
}

/**
 * overrides — Go's only "override" is METHOD SHADOWING THROUGH EMBEDDING.
 * When `type T struct { E }` and `E` has method `M`, then `T.M` selects the
 * shallowest declaration; `func (t T) M()` on T therefore hides E's, and a
 * promotion chain hides a deeper one. Go has no override KEYWORD and no
 * virtual dispatch, so nothing else in the language is an override.
 *
 * Truth: for every method declared on T, and every type reachable from T by
 * embedding, if a method of that name is declared on some embedder E in the
 * chain, the edge is `T.M -> E.M` where E is the DECLARING receiver.
 */
function truthOverrides(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  const declaredTypes = declaredTypeNames(nodes)

  // embedding map: type name -> embedded leaf names, from anonymous fields
  const embeds = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.type !== "field_declaration") continue
    const nm = fieldNode(n, "name")
    if (nm) continue // named field — not embedding
    const ownerDecl = ancestorOfType(n, new Set(["type_spec"]))
    if (!ownerDecl) continue
    const tn = fieldNode(ownerDecl, "name")
    if (!tn) continue
    const outer = String(tn.text ?? "")
    const ty = fieldNode(n, "type")
    if (!ty) continue
    const leaf = leafName(ty)
    if (!leaf) continue
    const cur = embeds.get(outer) ?? []
    cur.push(leaf)
    embeds.set(outer, cur)
  }

  // methods: receiver type -> method names
  const methodsOf = new Map<string, Map<string, string>>()
  for (const n of nodes) {
    if (n.type !== "method_declaration") continue
    const recv = fieldNode(n, "receiver")
    if (!recv) continue
    let rt = ""
    for (const rp of namedChildren(recv)) {
      for (const t of namedChildren(rp)) {
        if (t.type === "type_identifier") rt = String(t.text ?? "")
        if (t.type === "pointer_type") {
          for (const q of namedChildren(t)) if (q.type === "type_identifier") rt = String(q.text ?? "")
        }
      }
    }
    const nm = fieldNode(n, "name")
    if (!rt || !nm) continue
    const mm = methodsOf.get(rt) ?? new Map()
    mm.set(String(nm.text ?? ""), rt)
    methodsOf.set(rt, mm)
  }

  for (const n of nodes) {
    if (n.type !== "method_declaration") continue
    const recv = fieldNode(n, "receiver")
    if (!recv) continue
    let outer = ""
    for (const rp of namedChildren(recv)) {
      for (const t of namedChildren(rp)) {
        if (t.type === "type_identifier") outer = String(t.text ?? "")
        if (t.type === "pointer_type") for (const q of namedChildren(t)) if (q.type === "type_identifier") outer = String(q.text ?? "")
      }
    }
    const nm = fieldNode(n, "name")
    const mname = nm ? String(nm.text ?? "") : ""
    if (!outer || !mname) continue
    if (!declaredTypes.has(outer) && !embeds.has(outer)) {
      // receiver type not declared in this file: the analyzer's candidate rule
      // may still emit; truth records it under the same name and lets the
      // comparison speak.
    }
    const seen = new Set<string>()
    const visit = (tname: string, depth: number) => {
      if (depth > 4 || seen.has(tname)) return
      seen.add(tname)
      for (const et of embeds.get(tname) ?? []) {
        const own = methodsOf.get(et)
        if (own && own.has(mname) && et !== outer) out.add(k(`${outer}.${mname}`, `${et}.${mname}`))
        visit(et, depth + 1)
      }
    }
    visit(outer, 0)
  }
  return out
}

/**
 * extends — Go's type relation. A struct with an anonymous field embeds that
 * type's METHOD SET; an interface embedding another interface inherits its
 * method set and its type set. Both are `extends` in this lane's ontology and
 * both are one edge per embedded name, never a `contains` twin.
 */
function truthExtends(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  for (const n of nodes) {
    // A struct embeds with `field_declaration` (no `name` field); an interface
    // embeds with `type_elem` (an explicit `name:` the interface does not
    // actually have). Both are one `extends` edge to the embedded type.
    // tree-sitter-go calls an interface body element `constraint_elem` (measured
    // on src/net/netip/netip_pkg_test.go:335 `encoding.TextMarshaler`), NOT
    // `type_elem`. Guessing `type_elem` here silently drops every interface
    // embedding from the truth and turns an interface embedding into a phantom
    // false positive.
    if (n.type !== "field_declaration" && n.type !== "constraint_elem") continue
    if (n.type === "field_declaration" && fieldNode(n, "name")) continue
    // A `type_elem` carries the element in `name` when it is an embedded
    // interface (`interface { encoding.TextMarshaler }`) and in `type` when it
    // is a named method (`AppendTo([]byte) []byte`). Only the first is extends.
    const ownerDecl = ancestorOfType(n, new Set(["type_spec"]))
    if (!ownerDecl) continue
    const tn = fieldNode(ownerDecl, "name")
    if (!tn) continue
    const ty = fieldNode(n, "type") ?? fieldNode(n, "name")
    if (!ty) continue
    const leaf = leafName(ty)
    if (leaf) out.add(k(String(tn.text ?? ""), leaf))
  }
  return out
}

/**
 * contains — Go's membership relations, all three of which the language
 * states outright: a struct's fields, an interface's method set, and a type's
 * method set are the type's members.
 */
function truthContains(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  for (const n of nodes) {
    if (n.type === "method_declaration") {
      const recv = fieldNode(n, "receiver"); const nm = fieldNode(n, "name")
      if (!recv || !nm) continue
      let rt = ""
      for (const rp of namedChildren(recv)) for (const t of namedChildren(rp)) {
        if (t.type === "type_identifier") rt = String(t.text ?? "")
        if (t.type === "pointer_type") for (const q of namedChildren(t)) if (q.type === "type_identifier") rt = String(q.text ?? "")
      }
      if (rt) out.add(k(rt, String(nm.text ?? "")))
    } else if (n.type === "method_elem" || n.type === "method_spec") {
      const ownerDecl = ancestorOfType(n, new Set(["type_spec"]))
      if (!ownerDecl) continue
      const tn = fieldNode(ownerDecl, "name"); const nm = fieldNode(n, "name")
      if (tn && nm) out.add(k(String(tn.text ?? ""), String(nm.text ?? "")))
    } else if (n.type === "field_declaration") {
      const ownerDecl = ancestorOfType(n, new Set(["type_spec"]))
      if (!ownerDecl) continue
      const tn = fieldNode(ownerDecl, "name")
      if (!tn) continue
      // `a, b int` declares two fields sharing one type node; a field_declaration's
      // names are repeated `name` field occurrences and childForFieldName returns
      // only the first, so read the raw child list.
      const outer = String(tn.text ?? "")
      const raw: any[] = []
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (n.fieldNameForChild?.(i) === "name") raw.push(c)
      }
      for (const rn of raw) out.add(k(outer, String(rn.text ?? "")))
      // An EMBEDDED field has no `name`: Go names it after its type
      // (`struct { io.Reader }` declares the field `Reader`). It is a field of
      // the struct, so it is a `contains` member AND an `extends` edge.
      if (!raw.length) {
        const ty = fieldNode(n, "type")
        const leaf = leafName(ty)
        if (leaf) out.add(k(outer, leaf))
      }
    }
  }
  return out
}

/**
 * imports — an import names a MODULE by PATH STRING. The `import_spec` is the
 * only place a Go file can name another package, so the set of interpreted
 * paths is the complete truth for this channel.
 */
function truthImports(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  for (const n of nodes) {
    if (n.type !== "import_spec") continue
    let p = ""
    for (const c of namedChildren(n)) if (c.type === "interpreted_string_literal") p = unquote(String(c.text ?? ""))
    if (p) out.add(k("", p))
  }
  return out
}
function unquote(s: string): string {
  if (s.length >= 2) {
    const a = s.charCodeAt(0)
    if ((a === 34 || a === 96) && s.charCodeAt(s.length - 1) === a) return s.slice(1, -1)
  }
  return s
}

// A call inside a closure belongs to the function the closure is written in —
// the same attribution the analyzer makes. `func_literal` is therefore NOT in
// FNOWNER: walking past it lands on the enclosing func_decl/method_decl.
const FNOWNER = new Set(["function_declaration", "method_declaration"])
const SRC_OF_FILE = "<file>"

/**
 * calls — every call site is a `call_expression`; the callee's LEAF name is
 * the target. `go f()` and `defer f()` carry the call in an `expression`
 * field inside their own node, so they are counted through the same shape.
 */
// Go's predeclared identifiers. The analyzer filters them by design
// (`BuiltinsAreFiltered`) so the oracle must too, or every `make`/`len` call is
// scored as a miss. String equality against Go's own list; no regex.
const GO_BUILTINS = new Set([
  "append", "cap", "clear", "close", "complex", "copy", "delete", "imag", "len",
  "make", "max", "min", "new", "panic", "print", "println", "real", "recover",
])
function truthCalls(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  for (const n of nodes) {
    if (n.type !== "call_expression") continue
    const f = fieldNode(n, "function")
    if (!f) continue
    // An immediately-invoked closure `func(){...}()` has a func_literal callee.
    // leafName falls through to node.text for an unrecognised node, so the
    // whole closure BODY became a call target — a truth full of source text.
    if (f.type === "func_literal") continue
    const leaf = leafName(f)
    if (!leaf) continue
    if (GO_BUILTINS.has(leaf)) continue
    // A CONVERSION is written as a call but is not one: `uint16(r)`,
    // `string(oneMB)`, `float64(mt.count)` — Go spec, Conversions. Counting
    // them made the first version of this truth report 2,033 phantom misses
    // and put calls recall at 66.6% when the real figure is far higher. A
    // conversion's callee names a TYPE, so the type names are excluded.
    if (GO_BUILTIN_TYPES.has(leaf)) continue
    if (declaredTypeNames(nodes).has(leaf)) continue
    const owner = ancestorOfType(n, FNOWNER)
    const src = owner ? String(fieldNode(owner, "name")?.text ?? "") : SRC_OF_FILE
    out.add(k(src, leaf))
  }
  return out
}

/**
 * uses — a selector read that is not itself the callee of a call, plus a
 * channel operation. Source is the enclosing function/method, target the
 * field leaf.
 */
function truthUses(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  // web-tree-sitter returns a FRESH wrapper per retrieval, so identity must be
  // compared on .id, not ===. Comparing wrappers made every call callee look
  // like a plain selector and put 1 extra `uses` target per call into the truth.
  const calleeSel = new Set<any>()
  for (const n of nodes) if (n.type === "call_expression") { const f = fieldNode(n, "function"); if (f) calleeSel.add(f.id) }
  for (const n of nodes) {
    if (n.type !== "selector_expression") continue
    if (calleeSel.has(n.id)) continue
    const field = fieldNode(n, "field")
    if (!field) continue
    const owner = ancestorOfType(n, FNOWNER)
    const src = owner ? String(fieldNode(owner, "name")?.text ?? "") : SRC_OF_FILE
    out.add(k(src, String(field.text ?? "")))
  }
  return out
}


/** Go's predeclared type names — excluded from type-position targets. */
const GO_BUILTIN_TYPES = new Set([
  "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
  "int", "int8", "int16", "int32", "int64", "rune", "string",
  "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "any", "comparable",
])

/** A node that can stand as a type name (not a literal, not an operand). */
function isTypeNode(t: any): boolean {
  if (!t) return false
  const n = t.type
  return (
    n === "type_identifier" || n === "qualified_type" || n === "generic_type" ||
    n === "pointer_type" || n === "array_type" || n === "slice_type" ||
    n === "map_type" || n === "channel_type" || n === "struct_type" ||
    n === "interface_type" || n === "qualified_type_identifier"
  )
}

/**
 * The LEAF type name at a type position, unwrapping pointer/array/slice/map/
 * channel. The ELEMENT is the LAST type-shaped named child, not the first:
 * `[64]byte` puts the LENGTH first, so taking namedChild(0) yields `64` and
 * invents a type called 64. That is how the first version of this function
 * scored `references` at 52.9% target agreement against a truth full of
 * integers.
 */
function typePositionLeaf(t: any): string {
  if (!t) return ""
  if (t.type === "pointer_type") return typePositionLeaf(t.namedChildCount ? t.namedChild(0) : null)
  if (t.type === "array_type" || t.type === "slice_type" || t.type === "map_type" || t.type === "channel_type") {
    let last: any = null
    for (let i = 0; i < t.namedChildCount; i++) { const c = t.namedChild(i); if (isTypeNode(c)) last = c }
    return last ? typePositionLeaf(last) : ""
  }
  if (t.type === "struct_type" || t.type === "interface_type") return "" // anonymous shape, no name
  return leafName(t)
}

/**
 * references — a DECLARED-TYPE reference graph: every position where Go code
 * writes a type name. Struct fields, parameter and result declarations,
 * receivers, var/const specs and composite-literal types. Builtins excluded.
 */
function truthReferences(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  for (const n of nodes) {
    let ty: any = null
    if (n.type === "field_declaration") ty = fieldNode(n, "type")
    else if (n.type === "parameter_declaration" || n.type === "variadic_parameter_declaration") ty = fieldNode(n, "type")
    else if (n.type === "var_spec" || n.type === "const_spec") ty = fieldNode(n, "type")
    else if (n.type === "composite_literal") ty = fieldNode(n, "type")
    if (!ty) continue
    const leaf = typePositionLeaf(ty)
    if (!leaf || GO_BUILTIN_TYPES.has(leaf)) continue
    const owner = ancestorOfType(n, new Set(["type_spec", "type_alias", "function_declaration", "method_declaration"]))
    const src = owner ? String(fieldNode(owner, "name")?.text ?? "") : SRC_OF_FILE
    out.add(k(src, leaf))
  }
  return out
}

/**
 * instantiates — Go has no `new`. Construction is written as a composite
 * literal (`Base{...}`, `&Base{...}`) or by a PascalCase FUNCTION call, which
 * is a naming convention and nothing more. Both are one edge per constructed
 * type name.
 */
function isPascalCase(s: string): boolean {
  if (!s.length) return false
  const c = s.charCodeAt(0)
  return c >= 65 && c <= 90
}
function truthInstantiates(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  // Go's own spec: a composite literal's type may be elided inside a slice/map
  // literal or an array of a known element type. An elided element has no type
  // node, so it contributes nothing — absence, not a guess.
  for (const n of nodes) {
    if (n.type !== "composite_literal") continue
    const ty = fieldNode(n, "type")
    if (!ty) continue
    const leaf = typePositionLeaf(ty)
    if (!leaf || GO_BUILTIN_TYPES.has(leaf)) continue
    const owner = ancestorOfType(n, FNOWNER)
    const src = owner ? String(fieldNode(owner, "name")?.text ?? "") : SRC_OF_FILE
    out.add(k(src, leaf))
  }
  // PascalCase calls. Restricted to functions DECLARED at package scope in this
  // file, which is the analyzer's stated contract; a method receiver call is a
  // `calls` edge and is measured separately.
  const topLevelFuncs = new Set<string>()
  for (const n of nodes) if (n.type === "function_declaration") {
    const nm = fieldNode(n, "name")
    if (nm) topLevelFuncs.add(String(nm.text ?? ""))
  }
  for (const n of nodes) {
    if (n.type !== "call_expression") continue
    const f = fieldNode(n, "function")
    if (!f || f.type !== "identifier") continue
    const name = String(f.text ?? "")
    if (!isPascalCase(name) || GO_BUILTINS.has(name)) continue
    if (!topLevelFuncs.has(name)) continue
    const owner = ancestorOfType(n, FNOWNER)
    const src = owner ? String(fieldNode(owner, "name")?.text ?? "") : SRC_OF_FILE
    out.add(k(src, name))
  }
  return out
}

/** A method's NAME, per receiver type, and each interface's own method names. */
function goMethodSets(nodes: any[]) {
  const methods = new Map<string, Set<string>>()
  for (const n of nodes) {
    if (n.type !== "method_declaration") continue
    const recv = fieldNode(n, "receiver"); const nm = fieldNode(n, "name")
    if (!recv || !nm) continue
    let rt = ""
    for (const rp of namedChildren(recv)) for (const t of namedChildren(rp)) {
      if (t.type === "type_identifier") rt = String(t.text ?? "")
      if (t.type === "pointer_type") for (const q of namedChildren(t)) if (q.type === "type_identifier") rt = String(q.text ?? "")
    }
    if (!rt) continue
    if (!methods.has(rt)) methods.set(rt, new Set())
    methods.get(rt)!.add(String(nm.text ?? ""))
  }
  const interfaces = new Map<string, Set<string>>()
  for (const n of nodes) {
    if (n.type !== "type_spec") continue
    const nm = fieldNode(n, "name"); const body = fieldNode(n, "type")
    if (!nm || !body || body.type !== "interface_type") continue
    const own = new Set<string>()
    for (const c of namedChildren(body)) if (c.type === "method_spec") {
      const m = fieldNode(c, "name")
      if (m) own.add(String(m.text ?? ""))
    }
    interfaces.set(String(nm.text ?? ""), own)
  }
  // fold embedded interfaces, PATH-marked like the analyzer's own rule
  for (const [iname, own] of interfaces) {
    const body = nodes.find((n) => n.type === "type_spec" && String(fieldNode(n, "name")?.text ?? "") === iname)
    const it = fieldNode(body!, "type")
    if (!it) continue
    const seen = new Set<string>([iname])
    const visit = (n: any, depth: number) => {
      if (depth > 4) return
      for (const c of namedChildren(n)) {
        if (c.type !== "constraint_elem") continue
        const leaf = typePositionLeaf(fieldNode(c, "type") ?? fieldNode(c, "name"))
        if (!leaf || seen.has(leaf)) continue
        seen.add(leaf)
        const sub = interfaces.get(leaf)
        if (sub) for (const s2 of sub) own.add(s2)
        const subSpec = nodes.find((x) => x.type === "type_spec" && String(fieldNode(x, "name")?.text ?? "") === leaf)
        if (subSpec) visit(fieldNode(subSpec, "type"), depth + 1)
      }
    }
    visit(it, 0)
  }
  return { methods, interfaces }
}

/**
 * implements — Go satisfies an interface IMPLICITLY: a type implements I iff
 * I's method set is a subset of the type's method set, by NAME and by
 * SIGNATURE. This oracle matches on NAME ONLY and says so: signature
 * canonicalisation (variadics `...T`, grouped params, named results) is the
 * analyzer's own code, and re-deriving it here would make the two walkers one
 * implementation instead of two. A NAME-only truth therefore measures the
 * analyzer's signature gate from ABOVE: any edge here that the analyzer omits
 * is a signature-matching difference to be read, not counted as a defect.
 */
function truthImplements(nodes: any[]): EdgeSet {
  const out: EdgeSet = new Set()
  const { methods, interfaces } = goMethodSets(nodes)
  if (!interfaces.size) return out
  const declared = declaredTypeNames(nodes)
  // Candidates: declared non-interface types, plus every receiver type name with
  // no same-file `type` declaration (Go method sets are package-level).
  const candidates = new Set<string>()
  for (const d of declared) if (!interfaces.has(d)) candidates.add(d)
  for (const m of methods.keys()) if (!declared.has(m)) candidates.add(m)
  for (const impl of candidates) {
    const have = methods.get(impl) ?? new Set<string>()
    for (const [iname, need] of interfaces) {
      if (!need.size) continue
      let ok = true
      for (const m of need) if (!have.has(m)) { ok = false; break }
      if (ok) out.add(k(impl, iname))
    }
  }
  return out
}

const TRUTH: Record<string, (nodes: any[]) => EdgeSet> = {
  exports: truthExports,
  overrides: truthOverrides,
  extends: truthExtends,
  contains: truthContains,
  imports: truthImports,
  calls: truthCalls,
  uses: truthUses,
  references: truthReferences,
  instantiates: truthInstantiates,
  implements: truthImplements,
}


/**
 * Adjudication aid. When the oracle and the analyzer disagree on (src,tgt),
 * print where in the FILE a node carrying that name actually is, so the
 * disagreement can be settled by reading one line rather than by argument.
 */
function locate(nodes: any[], src: string, tgt: string, text: string): string {
  const hits: string[] = []
  for (const n of nodes) {
    const nm = leafName(n)
    if (nm !== tgt) continue
    const line = n.startPosition?.row ?? 0
    const raw = text.split("\n")[line] ?? ""
    let snip = raw.trim()
    if (snip.length > 90) snip = snip.slice(0, 90)
    hits.push(`L${line + 1} ${n.type} :: ${snip}`)
    if (hits.length >= 2) break
  }
  if (!hits.length) return "no node carries that name"
  return hits.join(" || ")
}

// ------------------------------------------------------------------ compare

const { RealGoAnalyzer } = await import(`${REPO}/src/ast/real-go-analyzer.ts`)
const { getParser } = await import(`${REPO}/src/ast/engine.ts`)

const files = pickFiles(DIR, NFILES)
console.log(`GO9 independent oracle  corpus=${DIR}  NFILES=${NFILES}  files=${files.length}`)
console.log(`oracle walks the same wasm/tree-sitter-go.wasm as the analyzer: a shared grammar bug is inherited, not observed\n`)

const agg = new Map<string, { tp: number; fp: number; fn: number; fpEx: string[]; fnEx: string[]; files: number; rows: number; srcMatch: number; tgtMatch: number; emittedWithTarget: number }>()
const types = ONLY.length ? ONLY : Object.keys(TRUTH)

for (const f of files) {
  let res: any
  try {
    const content = readFileSync(f, "utf8")
    const p2 = await getParser("go")
    const pr = await p2.parse(content, f)
    res = new RealGoAnalyzer().analyze(pr.rootNode, content, f)
  } catch { continue }
  const short = f.slice(DIR.length + 1)
  const text = readFileSync(f, "utf8")
  const tree = parser.parse(text)
  if (!tree) continue
  const { nodes } = collect(tree.rootNode)

  // emitted, kept as Map<target, Set<source>> so `calls`/`uses` can be scored
  // on "does this edge exist and point at the right thing" SEPARATELY from
  // "is it attributed to the right owner". Those are two different defects and
  // one combined score hides which one is present.
  const emitted = new Map<string, Map<string, Set<string>>>()
  for (const r of res.relationships || []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (!types.includes(t)) continue
    const s = String(r.source ?? r.from ?? "")
    const tg = String(r.target ?? r.to ?? "")
    // An import names a MODULE PATH; the source half is the file's own package
    // name and carries no independent fact, so the edge is keyed on the path.
    const sk = t === "imports" ? "" : s
    if (!emitted.has(t)) emitted.set(t, new Map())
    const byT = emitted.get(t)!
    if (!byT.has(tg)) byT.set(tg, new Set())
    byT.get(tg)!.add(sk)
  }

  for (const t of types) {
    const truth = TRUTH[t](nodes)
    const got = emitted.get(t) ?? new Map()
    const a = agg.get(t) ?? { tp: 0, fp: 0, fn: 0, fpEx: [], fnEx: [], files: 0, rows: 0, srcMatch: 0, tgtMatch: 0, emittedWithTarget: 0 }
    for (const srcs of got.values()) a.rows += srcs.size

    const truthByT = new Map<string, Set<string>>()
    for (const key of truth) {
      const i = key.indexOf(" ")
      const tg = key.slice(i + 1)
      if (!truthByT.has(tg)) truthByT.set(tg, new Set())
      truthByT.get(tg)!.add(key.slice(0, i))
    }

    let matched = 0
    for (const [tg, srcs] of got) {
      const tsrcs = truthByT.get(tg)
      if (!tsrcs) {
        a.fp += srcs.size
        if (a.fpEx.length < 3) a.fpEx.push(`-> ${tg} from ${[...srcs].join(",")}  [${short}] ${locate(nodes, "", tg, text)}`)
        continue
      }
      a.tgtMatch++
      a.emittedWithTarget += srcs.size
      for (const s of srcs) {
        if (tsrcs.has(s)) { a.tp++; a.srcMatch++; matched++ }
        else { a.fp++; if (a.fpEx.length < 3) a.fpEx.push(`${s} -> ${tg} (oracle owner: ${[...tsrcs].join(",")})  [${short}] ${locate(nodes, s, tg, text)}`) }
      }
    }
    for (const [tg, tsrcs] of truthByT) {
      if (got.has(tg)) continue
      a.fn += tsrcs.size
      if (a.fnEx.length < 3) a.fnEx.push(`${[...tsrcs].join(",")} -> ${tg}  [${short}] ${locate(nodes, "", tg, text)}`)
    }
    if (matched) a.files++
    agg.set(t, a)
  }
  tree.delete?.()
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 12)}${w("emitted", 10)}${w("truth", 10)}${w("TP", 9)}${w("FP", 7)}${w("FN", 7)}${w("prec", 8)}${w("recall", 8)}files w/ agreement`)
console.log("-".repeat(100))
for (const t of types) {
  const a = agg.get(t)!
  const truthTotal = a.tp + a.fn
  const prec = a.tp + a.fp ? ((100 * a.tp) / (a.tp + a.fp)).toFixed(1) : "-"
  const rec = truthTotal ? ((100 * a.tp) / truthTotal).toFixed(1) : "-"
  const tgtPct = a.tgtMatch + a.fn ? ((100 * a.tgtMatch) / (a.tgtMatch + a.fn)).toFixed(1) : "-"
  const ownPct = a.emittedWithTarget ? ((100 * a.srcMatch) / a.emittedWithTarget).toFixed(1) : "-"
  console.log(`${w(t, 12)}${w(String(a.rows), 10)}${w(String(truthTotal), 10)}${w(String(a.tp), 9)}${w(String(a.fp), 7)}${w(String(a.fn), 7)}${w(prec, 8)}${w(rec, 8)}${a.files}`)
  console.log(`${w("", 12)}target-set agreement ${tgtPct}%   owner agreement given the target exists ${ownPct}%`)
  if (a.fpEx.length) console.log(`   FP e.g. ${a.fpEx.join(" | ")}`)
  if (a.fnEx.length) console.log(`   FN e.g. ${a.fnEx.join(" | ")}`)
}