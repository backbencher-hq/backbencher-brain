/**
 * NIM DIFFERENTIAL ORACLE — the independent second derivation.
 *
 * The M14.0.F5 differential compares the analyzer against TRUTH derived from
 * the same parse tree by a SEPARATE implementation. That is what makes it a
 * differential rather than a self-check: if both sides shared one traversal, a
 * defect in that traversal would be invisible to both. So this file is written
 * against the GRAMMAR (the node types and fields tree-sitter-nim actually
 * exposes, enumerated in fixtures/nim/grammar/dump-grammar.mts) and derives each
 * fact by its own walk, in its own order, with its own data structures.
 *
 * Where a rule is a single SHARED SHAPE (a name-shaping helper both sides must
 * agree on, like the java/csharp `localEdgeLabel`), the shared function is
 * IMPORTED rather than re-implemented — the #917/#919 precedent. Everything
 * else here is derived from the tree.
 *
 * The contract it mirrors, all of it probe-verified against
 * wasm/tree-sitter-nim.wasm:
 *
 *   calls        a `call` / `dot_generic_call`: target = the callee LEAF
 *                (`a.b.c()` -> `c`; `Foo[T](x)` -> `Foo`); NIM_BUILTINS and
 *                keyword-like names excluded; a callee that is an in-file
 *                declared TYPE is object construction, not a call.
 *   uses         the member leaf of a `dot_expression` that is not a call
 *                callee (Nim's UFCS), and bare identifier reads of names the
 *                file declares; resolvable + not shadowed + not a declaration
 *                position + not a label + not an assignment target.
 *   instantiates a call whose callee is a declared type -> `instantiates`; plus
 *                `new(T)`'s type argument.
 *   contains     owner -> owned member. Two SEPARATE derivations, because they
 *                rest on different evidence and only one of them is shared:
 *                  (a) owner -> member from the analyzer's own `ownerName`
 *                      (shared ground truth: the owner assignment is not what
 *                      the differential is for), and
 *                  (b) enclosingRoutine -> nestedRoutine, derived HERE from the
 *                      PARSE TREE by lexical nesting. (b) exists because the
 *                      analyzer stopped reading `ownerName` for a nested
 *                      routine — its owner is a FUNCTION, and `ownerName` is the
 *                      family field for a class owner — and an oracle that
 *                      derived nothing for the family would agree with the
 *                      analyzer by saying nothing, which is the blind spot
 *                      this oracle exists to prevent. Measured on the 400-file
 *                      sample before (b) existed: 126 `contains` MISSING, every
 *                      one of them a nested closure.
 *   extends      `ref object of B` -> the base, unless the base is one of the
 *                compiler's roots (RootObj/RootRef/Object), which exist nowhere.
 *   overrides    a method whose receiver is a declared subtype of another
 *                method's receiver, owner-qualified `Receiver.method`.
 *   references   declared-type sites: parameter/field/discriminator/value
 *                annotations, return types, `cast[T]`, `ref object of`,
 *                `concept … of`, and a type alias's RHS — constructor AND
 *                type arguments.
 *
 * It deliberately does NOT derive `exports` or `implements`. Both are absent
 * here and that absence is RECORDED rather than silent: `script/m14/nim-ruled.ts`
 * carries the falsifiable measurement for `implements` (216 concepts examined, 0
 * refinements) and `exports` is a module-level re-export whose shape is
 * position-dependent (`except` names what does NOT leave). Deriving either here
 * without a corpus measurement behind it would be a second opinion nobody
 * checked.
 *
 * It deliberately does NOT derive the docstring, the range, or the imports
 * array: those are compared by the fixture lane and the pipeline seam gate, and
 * duplicating them here would add a second place to be wrong without adding a
 * second opinion on anything the fixtures do not already pin.
 */
import { REAL_NIM_BUILTINS } from "../../src/ast/real-nim-analyzer"

export interface TruthEdge {
  label: string
  from: string
  target: string
}

/** The compiler's own inheritance roots: `ref object` with no base inherits
 *  RootObj, and no indexed file declares it, so an `extends` to it would be a
 *  guaranteed-dangling edge. Mirrors the analyzer's NIM_COMPILER_ROOTS. */
const COMPILER_ROOTS = new Set(["RootObj", "RootRef", "Object", "rootObj"])

/** Standard-library / language type names a declared-type reference can never
 *  resolve to. Mirrors the analyzer's NIM_BUILTIN_TYPES. */
const BUILTIN_TYPES = new Set([
  "int", "int8", "int16", "int32", "int64",
  "uint", "uint8", "uint16", "uint32", "uint64",
  "float", "float32", "float64", "bool", "char", "byte", "string", "cstring",
  "void", "auto", "untyped", "typedesc", "ordinal", "range",
  "SomeInteger", "SomeFloat", "SomeNumber", "SomeOrdinal", "SomeOrdered",
  "Natural", "Positive", "Signed", "Unsigned", "Ordinal", "Ordered",
  "SomeComparable", "SomeCopyable", "SomeDefault",
  "seq", "array", "openArray", "set", "tuple", "varargs", "pointer",
  "Table", "OrderedTable", "CountTable", "HashSet", "OrderedSet", "CountSet",
  "touches", "isNil", "lent",
  "cpointer", "clong", "cint", "cshort", "cchar", "cschar", "cuchar", "csize",
  "cfloat", "cdouble", "clonglong", "culonglong", "cstringarray",
  "Object", "RootObj", "RootRef", "rootObj", "system",
  "File", "FileStream", "PFile", "PFileStream", "StringStream", "WideString",
  "charStream", "CString", "TEndian", "Endian",
])

/** Words the grammar already models as keyword tokens. A bare `identifier` node
 *  never has one of these types, but a `dot_expression` leaf carries raw text, so
 *  `.import` / `.end` can reach that position. */
const KEYWORD_LIKE = new Set([
  "addr", "and", "as", "bind", "block", "break", "case", "concept", "const",
  "continue", "converter", "defer", "discard", "distinct", "div", "do", "elif",
  "else", "end", "enum", "except", "export", "finally", "for", "from", "func",
  "if", "import", "in", "include", "interface", "is", "isnot", "iterator", "let",
  "macro", "method", "mixin", "mod", "nil", "not", "notin", "object", "of", "or",
  "out", "proc", "ptr", "raise", "ref", "return", "shl", "shr", "static",
  "template", "try", "tuple", "type", "using", "var", "when", "while", "xor", "yield",
])

/** Parameter-kind modifier keywords. `var`/`out`/`ref`/`ptr`/`distinct` have
 *  dedicated `*_type` nodes; `sink` does not, so `a: sink seq[int]` arrives as a
 *  one-argument `call` and must be unwrapped as a type modifier, not a call. */
const PARAM_MODIFIERS = new Set(["sink", "out", "var", "let", "static"])

const CALLABLE_TYPES = new Set([
  "proc_declaration", "func_declaration", "method_declaration",
  "iterator_declaration", "template_declaration", "macro_declaration",
  "converter_declaration",
])

const SECTION_TYPES = new Set(["const_section", "let_section", "var_section", "using_section"])

// ── grammar accessors, written against the node types tree-sitter-nim exposes ──

function named(node: any): any[] {
  const out: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

function field(node: any, name: string): any {
  try {
    return node.childForFieldName(name) ?? null
  } catch {
    return null
  }
}

function firstOfType(node: any, type: string): any {
  for (const c of named(node)) if (c.type === type) return c
  return null
}

function lastNamed(node: any): any {
  const kids = named(node)
  return kids.length > 0 ? kids[kids.length - 1] : null
}

function spansInside(parent: any, child: any): boolean {
  return !!parent && parent.startIndex <= child.startIndex && parent.endIndex >= child.endIndex
}

/** The name a `_symbol` / `exported_symbol` field node carries. */
function nameOf(node: any): { name: string; exported: boolean } {
  if (!node) return { name: "", exported: false }
  if (node.type === "exported_symbol") {
    const inner = named(node)[0]
    return { name: inner ? inner.text : "", exported: true }
  }
  return { name: node.text, exported: false }
}

/** The callee leaf: identifier / accent_quoted, the `right` of a dot chain, or
 *  the `left` of a bracket (a generic instantiation `Foo[T]`). */
function calleeLeaf(fn: any): any {
  let cur = fn
  let guard = 0
  while (cur && guard++ < 16) {
    if (cur.type === "identifier" || cur.type === "accent_quoted") return cur
    if (cur.type === "dot_expression") {
      const right = field(cur, "right")
      if (!right) return null
      if (right.type === "identifier" || right.type === "accent_quoted") return right
      cur = right
      continue
    }
    if (cur.type === "bracket_expression") {
      const left = field(cur, "left")
      if (!left) return null
      cur = left
      continue
    }
    if (cur.type === "parenthesized") {
      const inner = named(cur)[0]
      if (!inner) return null
      cur = inner
      continue
    }
    return null
  }
  return null
}

/** A one-argument `call` whose callee is a parameter-kind modifier keyword:
 *  `a: sink seq[int]`. The grammar has no node for `sink`, so it is a call. */
function isModifierCall(node: any): boolean {
  if (node.type !== "call") return false
  const fn = field(node, "function")
  if (!fn || fn.type !== "identifier") return false
  if (!PARAM_MODIFIERS.has(fn.text)) return false
  const args = firstOfType(node, "argument_list")
  return !!args && args.namedChildCount === 1
}

/** The type CONSTRUCTOR leaf of a type expression: unwrap the modifier nodes,
 *  then the outermost bracket/call, and take the leftmost name. */
function typeConstructorLeaf(te: any): any {
  let cur = te
  let guard = 0
  while (cur && guard++ < 16) {
    if (cur.type === "identifier" || cur.type === "accent_quoted") return cur
    if (cur.type === "type_expression") {
      const inner = named(cur)[0]
      if (!inner) return null
      cur = inner
      continue
    }
    if (cur.type === "ref_type" || cur.type === "pointer_type" || cur.type === "out_type" || cur.type === "var_type" || cur.type === "distinct_type") {
      const inner = lastNamed(cur)
      if (!inner) return null
      cur = inner
      continue
    }
    if (cur.type === "call") {
      if (isModifierCall(cur)) {
        const args = firstOfType(cur, "argument_list")
        const only = args && args.namedChildCount === 1 ? named(args)[0] : null
        if (!only) return null
        cur = only
        continue
      }
      const fn = field(cur, "function")
      if (!fn) return null
      cur = fn
      continue
    }
    if (cur.type === "bracket_expression") {
      const left = field(cur, "left")
      if (!left) return null
      cur = left
      continue
    }
    if (cur.type === "dot_expression") {
      const right = field(cur, "right")
      if (!right) return null
      cur = right
      continue
    }
    return null
  }
  return null
}

/** The type ARGUMENT nodes of a generic type expression. */
function typeArgumentNodes(te: any): any[] {
  let cur = te
  let guard = 0
  while (cur && guard++ < 16) {
    if (cur.type === "type_expression") {
      const inner = named(cur)[0]
      return inner ? typeArgumentNodes(inner) : []
    }
    if (cur.type === "ref_type" || cur.type === "pointer_type" || cur.type === "out_type" || cur.type === "var_type" || cur.type === "distinct_type") {
      const inner = lastNamed(cur)
      return inner ? typeArgumentNodes(inner) : []
    }
    if (cur.type === "call") {
      if (isModifierCall(cur)) {
        const args = firstOfType(cur, "argument_list")
        const only = args && args.namedChildCount === 1 ? named(args)[0] : null
        return only ? [only] : []
      }
      const args = firstOfType(cur, "argument_list")
      return args ? named(args) : []
    }
    if (cur.type === "bracket_expression") {
      const right = field(cur, "right")
      return right ? named(right) : []
    }
    return []
  }
  return []
}

// ── the declared-name inventory the file's own symbols already give us ──

interface Inventory {
  values: Set<string>
  types: Set<string>
  callables: Set<string>
  enumMembers: Set<string>
  fieldNames: Set<string>
  genericParams: Set<string>
  subtypes: Map<string, Set<string>>
}

/** Literal keywords: values, never type names. */
const LITERAL_KEYWORDS = new Set(["true", "false", "nil", "void", "auto"])

function buildInventory(symbols: any[]): Inventory {
  const inv: Inventory = {
    values: new Set(), types: new Set(), callables: new Set(),
    enumMembers: new Set(), fieldNames: new Set(), genericParams: new Set(),
    subtypes: new Map(),
  }
  for (const s of symbols ?? []) {
    const kind = s.kind
    const name = s.name
    if (!name || name === "_") continue
    if (kind === "constant" || kind === "variable") inv.values.add(name)
    else if (kind === "class" || kind === "struct" || kind === "enum" || kind === "type" || kind === "interface") inv.types.add(name)
    else if (kind === "function" || kind === "method" || kind === "macro") inv.callables.add(name)
    if (kind === "enum_member") inv.enumMembers.add(name)
    if (kind === "property") inv.fieldNames.add(name)
    for (const g of s.genericParameters ?? []) inv.genericParams.add(g)
    const base = s.metadata?.nimInherits
    if (typeof base === "string" && base) {
      const set = inv.subtypes.get(base) ?? new Set<string>()
      set.add(name)
      inv.subtypes.set(base, set)
    }
  }
  return inv
}

/** Every strict supertype reachable through the declared-subtype map. */
function supertypesOf(leaf: string, subtypes: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>()
  const seen = new Set<string>([leaf])
  const queue = [leaf]
  while (queue.length > 0) {
    const cur = queue.pop()!
    for (const [base, subs] of subtypes) {
      if (!subs.has(cur) || seen.has(base)) continue
      seen.add(base)
      out.add(base)
      queue.push(base)
    }
  }
  return out
}

// ── the derivation ──

/**
 * `contains` for a NAMED nested routine, derived from the parse tree alone.
 *
 * ## Why this is a separate walk and not a field read
 *
 * The `contains` derivation above reads `symbol.ownerName`, which is declared
 * shared ground truth on the grounds that the owner assignment is not what the
 * differential is for. That reasoning does not transfer here: a nested routine's
 * owner is a FUNCTION, and the analyzer deliberately does not put a function in
 * `ownerName` (the family field is for a class or module owner), so the edge
 * comes from `metadata.nimNestedIn` — the analyzer's own metadata. An oracle
 * that read `nimNestedIn` would be checking the analyzer against itself.
 *
 * So this walks the tree. The rule is the language's, not the analyzer's: a
 * routine declared inside another routine's BODY is nested in it. The BODY is
 * read as the `body` FIELD, because a routine's doc comment is not its body —
 * which is the same distinction the analyzer's `pushCallableChildren` makes, and
 * it is stated here independently so a disagreement is still possible.
 *
 * ## What is deliberately not derived
 *
 * A routine with no name contributes nothing: there is no target to point an edge
 * at, and inventing one would be the fabrication the workstream treats as its
 * most expensive mistake. A routine at file scope has no enclosing routine, so it
 * contributes nothing either.
 *
 * ## Comparison basis
 *
 * START OFFSETS, never `===`. `childForFieldName` and `namedChild` each allocate
 * their own JS wrapper for one underlying node, so object identity is false for
 * the node itself. Two nodes in one tree cannot share a start offset.
 */
const ROUTINE_NODES = new Set([
  "proc_declaration", "func_declaration", "method_declaration",
  "iterator_declaration", "macro_declaration", "template_declaration",
  "converter_declaration",
])

function declaredRoutineName(node: any): string {
  const nameNode = node.childForFieldName?.("name")
  if (!nameNode) return ""
  // `exported_symbol` wraps the identifier and a `*`; the identifier is the name.
  if (nameNode.type === "exported_symbol") {
    return nameNode.namedChildCount > 0 ? String(nameNode.namedChild(0).text) : ""
  }
  return String(nameNode.text ?? "")
}

export function deriveNestedRoutineContainment(root: any): [string, string][] {
  const out: [string, string][] = []
  const seen = new Set<string>()
  const stack: { node: any; enclosing: string }[] = [{ node: root, enclosing: "" }]
  while (stack.length > 0) {
    const { node, enclosing } = stack.pop()!
    const isRoutine = ROUTINE_NODES.has(node.type)
    let selfName = enclosing
    if (isRoutine) {
      const name = declaredRoutineName(node)
      if (name && name !== "_" && enclosing) {
        const k = `${enclosing}|${name}`
        if (!seen.has(k)) { seen.add(k); out.push([enclosing, name]) }
      }
      // Only a routine with a NAME opens a frame: an anonymous nested routine has
      // nothing for a deeper one to be contained by.
      selfName = name || enclosing
    }
    const body = isRoutine ? node.childForFieldName?.("body") : null
    const bodyStart = body ? body.startIndex : -1
    // A `runnableExamples:` argument is a SEPARATE COMPILATION UNIT, and clearing
    // the enclosing routine there is an ADJUDICATED disagreement, not a detail.
    // This oracle derived `then -> fn`, `then -> asyncFact` and `then -> main` for
    // the block at nim/lib/js/asyncjs.nim:206-216 and the analyzer published
    // those three routines with no enclosing routine at all; the block is compiled
    // by `nim doc` as its own unit, so a routine inside it is not lexically inside
    // the proc that documents it, and `then -> fn` states something false. The
    // evidence is the tree and the compiler's own treatment of the block; the
    // analyzer's answer is adopted and the reason is recorded here so the next
    // reader can overturn it with better evidence rather than by re-deriving.
    const exampleStart = docExampleArgumentStart(node)
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (!c) continue
      // A routine's BODY is what opens the lexical frame. Its doc comment and its
      // pragma list are siblings of the body, and a routine written inside a doc
      // comment is not nested in this routine.
      if (exampleStart >= 0 && c.startIndex === exampleStart) {
        stack.push({ node: c, enclosing: "" })
        continue
      }
      stack.push({ node: c, enclosing: bodyStart >= 0 && c.startIndex === bodyStart ? selfName : enclosing })
    }
  }
  return out
}

/**
 * The start offset of a `runnableExamples:` call's ARGUMENT LIST, or -1.
 *
 * ## The shape, not the word
 *
 * The argument must hold a statement list or a block. A user proc named
 * `runnableExamples` called with an expression is an ordinary call and is not a
 * doc block, and `runnableExamples` read as a callee is not a call to anything —
 * see the `isDocExamplePragma` note on the `calls` derivation below, which is the
 * SAME shape test applied to a different question.
 *
 * Read as a NAMED CHILD of that type rather than through `childForFieldName`,
 * because the pinned grammar does not populate the `argument_list` FIELD here: it
 * parses `runnableExamples:` as a labelled statement, so the field accessor
 * returns null while the child is plainly present. Verified on
 * nim/lib/system.nim:859.
 */
function docExampleArgumentStart(node: any): number {
  if (node.type !== "call") return -1
  let fn: any = null
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "identifier") { fn = c; break }
  }
  if (!fn || String(fn.text) !== "runnableExamples") return -1
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "argument_list") continue
    for (let k = 0; k < c.namedChildCount; k++) {
      const g = c.namedChild(k)
      if (g && (g.type === "statement_list" || g.type === "block")) return c.startIndex
    }
  }
  return -1
}

/** True when a `call` node is a `runnableExamples:` doc block rather than a call. */
export function isDocExamplePragma(node: any): boolean {
  return docExampleArgumentStart(node) >= 0
}

export function deriveNimEdges(root: any, symbols: any[]): TruthEdge[] {
  const inv = buildInventory(symbols)
  const edges: TruthEdge[] = []
  // The dedupe key is (label, target) — NOT (from, label, target) — for the
  // reason every oracle in differential.ts states: the coverage comparison is
  // deliberately SITE-AGNOSTIC (it matches label+normalized-target and never
  // the source line), and the analyzer side is collapsed to one edge per
  // (label,target). Keying on the source as well made 5 callers of one target
  // count as 5 independent truth rows against the analyzer's single deduped
  // edge: measured tree-truth=901 vs analyzer-edges=432 with "100% coverage",
  // i.e. the denominator was mostly the same fact repeated and the percentage
  // meant far less than it read. `from` is still carried on the edge for triage
  // and sample printing; it is only the KEY that is source-free.
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string): void => {
    if (!from || !target) return
    const k = `${label}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }
  const resolvable = (n: string): boolean => inv.values.has(n) || inv.enumMembers.has(n) || inv.fieldNames.has(n)

  // ── contains: owner -> member, from the analyzer's own owner names (shared
  //    ground truth: the owner assignment is not what the differential is for).
  for (const s of symbols ?? []) {
    if (s.ownerName) push("contains", s.ownerName, s.name)
  }

  // ── contains: enclosing routine -> nested routine, from the TREE.
  //
  // A named nested routine is contained by the routine it is lexically inside,
  // and the analyzer publishes that edge from `metadata.nimNestedIn` rather than
  // from `ownerName`. So this derivation cannot read the analyzer's metadata at
  // all — it walks the parse tree and records the nesting it can see, which is
  // what makes it a second opinion rather than a restatement.
  for (const pair of deriveNestedRoutineContainment(root)) push("contains", pair[0], pair[1])

  // ── extends / overrides ──
  for (const s of symbols ?? []) {
    const base = s.metadata?.nimInherits
    if (typeof base !== "string" || !base || base === s.name) continue
    if (COMPILER_ROOTS.has(base)) continue
    push("extends", s.name, base)
  }
  const methodsByKey = new Map<string, any[]>()
  for (const s of symbols ?? []) {
    if (s.kind !== "method") continue
    const recv = String(s.metadata?.nimReceiverType ?? "")
    if (!recv) continue
    const k = `${recv} ${s.name}`
    const arr = methodsByKey.get(k) ?? []
    arr.push(s)
    methodsByKey.set(k, arr)
  }
  for (const [k] of methodsByKey) {
    const sep = k.indexOf(" ")
    const recv = k.slice(0, sep)
    const name = k.slice(sep + 1)
    for (const sup of supertypesOf(recv, inv.subtypes)) {
      if (!methodsByKey.has(`${sup} ${name}`)) continue
      push("overrides", `${recv}.${name}`, `${sup}.${name}`)
    }
  }

  // ── imports: one `imports` edge from `(global)` per module ──
  //
  // `doc/grammar.txt`:
  //   importStmt  = 'import' optInd expr ((comma expr)* / 'except' optInd (expr^+ comma))
  //   fromStmt    = 'from' expr 'import' optInd expr (comma expr)*
  //   includeStmt = 'include' optInd expr ^+ comma
  //
  // The module PATH is not always an identifier, and each spelling is a different
  // grammar node (probe-verified):
  //   strutils                  -> identifier
  //   std/[os, strutils]        -> infix_expression(left: std, operator: /, right:
  //                                array_construction(os, strutils))   — TWO modules
  //   std/os as o               -> infix_expression with the `as` operator; the
  //                                right side is the ALIAS, never a module
  //   ./shapes, ../parent       -> PREFIX expression (the leading `./` is the
  //                                prefix OPERATOR, not an infix `/`)
  //   "file.nim"                -> a string literal
  //   x except y                -> an `except_clause` holding the excluded list
  // The kind is the FIRST-CLASS `imports`, not `references`: the LSP usages
  // file-level section answers with `relationship_type IN ('imports','exports')`,
  // so a NIM import hidden behind `references` is invisible to it. The analyzer
  // was measured emitting `references (global) -> tables` for `import tables`
  // and this oracle had to follow it, which is exactly the trap: the oracle
  // agreed with the analyzer (0 unexplained) while both hid the edge from the
  // reader that consumes it. Convention checked against real-c-analyzer.ts:1191
  // (M60/#910), where the same class of gap was fixed for C.
  const emitImport = (pathText: string): void => {
    if (pathText) push("imports", "(global)", pathText)
  }
  const walkImports = (n: any): void => {
    if (n.type === "import_statement") {
      const exceptClause = firstOfType(n, "except_clause")
      const list = firstOfType(n, "expression_list")
      for (const operand of list ? named(list) : []) {
        if (exceptClause && isDescendantOf(operand, exceptClause)) continue
        for (const mod of modulePaths(operand)) emitImport(mod)
      }
    } else if (n.type === "import_from_statement") {
      const m = field(n, "module")
      // modulePaths, NOT modulePathOf: a from-import's module is frequently an
      // infix chain carrying an `as ALIAS` and a `{.all.}` qualifier, and
      // modulePathOf returns the node's raw text. That is how the oracle came to
      // publish `std/uri {.all.} as uri2` as a module — a name no file has —
      // while the analyzer published `std/uri`. The analyzer was right.
      const fromPaths = m ? modulePaths(m) : []
      for (const mp of fromPaths) emitImport(mp)
    } else if (n.type === "include_statement") {
      const list = firstOfType(n, "expression_list")
      // modulePaths, NOT modulePathOf — the same correction the from-import arm
      // needed, for the same reason. `include` takes a module LIST and an
      // ALIAS, and modulePathOf returns the node's raw text, so the oracle
      // published `m9627 / [a, b]` as one module and `foobar as foo` as another.
      // Both are wrong: the first names a module list as a single module, and
      // the second folds a local ALIAS into the dependency's name. The analyzer
      // published `m9627/a` and `m9627/b`, and `foobar`.
      for (const operand of list ? named(list) : []) for (const mp of modulePaths(operand)) emitImport(mp)
    }
  }

  // ── the tree walk: calls / uses / instantiates / references ──
  interface Scope { names: Set<string>; fn: string | null }
  const scopes: Scope[] = []
  const top = (): Scope | null => (scopes.length > 0 ? scopes[scopes.length - 1] : null)
  const shadowed = (n: string): boolean => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].names.has(n)) return true
    return false
  }
  const currentFn = (): string => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].fn) return scopes[i].fn
    return "(global)"
  }
  const isDeclName = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    return (
      p.type === "symbol_declaration" || p.type === "type_symbol_declaration" ||
      p.type === "enum_field_declaration" || p.type === "variant_discriminator_declaration" ||
      p.type === "exported_symbol" || p.type === "tuple_deconstruct_declaration" ||
      p.type === "symbol_declaration_list"
    )
  }
  const isTypePosition = (n: any): boolean => {
    let cur = n
    let p = n.parent
    let guard = 0
    while (p && guard++ < 32) {
      if (p.type === "statement_list" || p.type === "block" || p.type === "source_file" || p.type === "do_block") return false
      for (const f of ["type", "return_type", "inherits", "refines", "generic_parameters"]) {
        const fld = field(p, f)
        if (fld && spansInside(fld, cur)) return true
      }
      cur = p
      p = p.parent
    }
    return false
  }
  const isModulePath = (n: any): boolean => {
    let p = n.parent
    let guard = 0
    while (p && guard++ < 16) {
      if (p.type === "import_statement" || p.type === "export_statement" || p.type === "include_statement" || p.type === "import_from_statement") return true
      if (p.type === "statement_list" || p.type === "source_file" || p.type === "block") return false
      p = p.parent
    }
    return false
  }
  const isLabel = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    if (p.type === "break_statement" || p.type === "continue_statement") return true
    const lab = field(p, "label")
    return !!lab && lab.startIndex === n.startIndex && lab.endIndex === n.endIndex
  }
  const isColonLabel = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "colon_expression") return false
    const left = field(p, "left")
    return !!left && left.startIndex === n.startIndex && left.endIndex === n.endIndex
  }
  const isDotLeaf = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "dot_expression") return false
    const right = field(p, "right")
    return !!right && right.startIndex === n.startIndex && right.endIndex === n.endIndex
  }
  const isCalleeSubtree = (n: any): boolean => {
    let topNode = n
    let p = n.parent
    while (p && p.type !== "call" && p.type !== "dot_generic_call" && p.type !== "statement_list" && p.type !== "block") {
      topNode = p
      p = p.parent
    }
    if (!p || (p.type !== "call" && p.type !== "dot_generic_call")) return false
    const fn = field(p, "function")
    return !!fn && topNode.startIndex >= fn.startIndex && topNode.endIndex <= fn.endIndex
  }
  const isWriteTarget = (n: any, member: boolean): boolean => {
    const p = n.parent
    if (!p || p.type !== "assignment") return false
    const left = field(p, "left")
    if (!left || !spansInside(left, n)) return false
    if (member) return true
    return left.type === "identifier"
  }
  // Recursive, because the pattern NESTS: `let (a, (b, c)): (int, (int, int))`
  // is a tuple_deconstruct_declaration containing a symbol_declaration AND
  // another tuple_deconstruct_declaration. The previous version read one level
  // and then asked a nested destructuring node for its own name, which has none
  // — so `b` and `c` were never bound and the reads of them were published.
  const bindNames = (frame: Scope | null, listNode: any, depth = 0): void => {
    if (!frame || !listNode || depth > 8) return
    for (const d of named(listNode)) {
      if (d.type === "symbol_declaration") {
        const info = nameOf(field(d, "name"))
        if (info.name && info.name !== "_") frame.names.add(info.name)
      } else if (d.type === "tuple_deconstruct_declaration") {
        bindNames(frame, d, depth + 1)
      }
    }
  }

  interface Item { node: any; exit: boolean; pushed: boolean }
  const stack: Item[] = [{ node: root, exit: false, pushed: false }]

  while (stack.length > 0) {
    const { node, exit, pushed } = stack.pop()!
    if (exit) {
      if (pushed) scopes.pop()
      continue
    }
    const t = node.type
    let pushedScope = false

    if (CALLABLE_TYPES.has(t)) {
      const frame: Scope = { names: new Set<string>(), fn: null }
      const info = nameOf(field(node, "name"))
      frame.fn = info.name || null
      const params = field(node, "parameters")
      if (params) {
        for (const p of named(params)) {
          if (p.type !== "parameter_declaration") continue
          bindNames(frame, named(p)[0])
        }
      }
      const gens = field(node, "generic_parameters") ?? firstOfType(node, "generic_parameter_list")
      if (gens) bindNames(frame, gens)
      scopes.push(frame)
      pushedScope = true
    } else if (t === "statement_list" || t === "block" || t === "do_block" || t === "term_rewriting_pattern") {
      scopes.push({ names: new Set<string>(), fn: null })
      pushedScope = true
    } else if (t === "of_branch" || t === "except_branch" || t === "elif_branch" || t === "else_branch" || t === "finally_branch") {
      scopes.push({ names: new Set<string>(), fn: null })
      pushedScope = true
    } else if (t === "for") {
      scopes.push({ names: new Set<string>(), fn: null })
      pushedScope = true
      bindNames(top(), field(node, "left"))
    } else if (t === "concept_declaration") {
      // A CONCEPT binds a formal parameter, and it is the one binder in Nim
      // written with no `symbol_declaration` wrapper and no type annotation —
      // just a bare identifier in a `parameter_list`. So it needs its own frame,
      // and the body's reads of that parameter are reads of a BINDING.
      const frame: Scope = { names: new Set<string>(), fn: null }
      const owner = node.parent && node.parent.type === "type_declaration" ? node.parent.namedChild(0) : null
      if (owner) frame.fn = nameOf(field(owner, "name")).name || null
      const params = firstOfType(node, "parameter_list")
      if (params) {
        for (const c of named(params)) {
          if (c.type === "identifier" && c.text !== "_") frame.names.add(c.text)
        }
      }
      scopes.push(frame)
      pushedScope = true
    } else if (t === "variable_declaration") {
      bindNames(top(), named(node)[0])
    } else if (t === "except_branch") {
      // unreachable: the branch arm above owns the frame
    }

    if (t === "except_branch") {
      const values = field(node, "values")
      if (values) {
        const frame = top()
        for (const v of named(values)) {
          if (v.type !== "infix_expression") continue
          const op = field(v, "operator")
          if (op && op.type === "as") {
            const r = field(v, "right")
            if (r && r.type === "identifier" && frame) frame.names.add(r.text)
          }
        }
      }
    }

    if (t === "import_statement" || t === "import_from_statement" || t === "include_statement") {
      walkImports(node)
    }

    if (t === "call") {
      const fn = field(node, "function")
      // `runnableExamples:` is a doc-comment PRAGMA, not a call. The grammar
      // parses the whole example as the call's `argument_list`, so without this
      // the call branch fires on a keyword. Over the 400-file sample that
      // produced 7 unexplained `calls -> runnableExamples` edges across
      // nim/lib/{experimental/diff,js/asyncjs,pure/base64,pure/collections/lists,
      // pure/complex,pure/encodings,pure/memfiles,pure/parsecsv}.nim — a name no
      // Nim program can call, asserted seven times. Same shape test the
      // containment walk uses; stated here too because the two questions are
      // different and a reader should not have to infer one from the other.
      if (isDocExamplePragma(node)) {
        // no edge
      } else if (!(isModifierCall(node) && isTypePosition(node))) {
        const leaf = fn ? calleeLeaf(fn) : null
        const leafText = leaf ? leaf.text : ""
        const isTypeCtor = !!leafText && inv.types.has(leafText) && !inv.callables.has(leafText)
        if (leafText && leafText !== "_" && !REAL_NIM_BUILTINS.includes(leafText) && !KEYWORD_LIKE.has(leafText) && !isTypeCtor) {
          push("calls", currentFn(), leafText)
        }
        if (isTypeCtor) push("instantiates", currentFn(), leafText)
        if (leafText === "new") {
          const args = firstOfType(node, "argument_list")
          if (args) {
            for (const a of named(args)) {
              if (a.type === "identifier" && inv.types.has(a.text) && !inv.callables.has(a.text)) {
                push("instantiates", currentFn(), a.text)
              }
            }
          }
        }
      }
    } else if (t === "dot_generic_call") {
      const fn = field(node, "function")
      const leafText = fn ? fn.text : ""
      if (leafText && leafText !== "_" && !REAL_NIM_BUILTINS.includes(leafText)) {
        push("calls", currentFn(), leafText)
      }
    }

    if (t === "dot_expression") {
      const right = field(node, "right")
      const leafText = right && (right.type === "identifier" || right.type === "accent_quoted") ? right.text : ""
      const inCallee = node.parent && (node.parent.type === "call" || node.parent.type === "dot_generic_call")
      // A member leaf that names a CALLABLE this file declares is a PARENLESS
      // UFCS CALL: `r.describe` invokes `describe(r)`, written with no
      // parentheses and no call node, so the `inCallee` test never fires for it.
      // It is a `calls` edge and NOT a `uses` read — a callee is not a value
      // read, and emitting both is the double-count a fixture forbids.
      //
      // This oracle had the same omission as the analyzer, so the differential
      // agreed with a wrong shape and reported 0% unexplained. It was found by
      // the M12 ground truth, whose audit asserted the `calls` row from reading
      // the source — which is precisely the case an oracle that mirrors the
      // analyzer cannot make, because both would be wrong in the same direction.
      if (leafText && leafText !== "_" && !inCallee && inv.callables.has(leafText)) {
        push("calls", currentFn(), leafText)
      } else if (leafText && leafText !== "_" && !inCallee && resolvable(leafText) && !KEYWORD_LIKE.has(leafText)) {
        push("uses", currentFn(), leafText)
      }
    }

    if (t === "identifier") {
      const nm = node.text
      if (
        nm && nm !== "_" && !nm.startsWith("gensym") && resolvable(nm) && !KEYWORD_LIKE.has(nm) &&
        !isDeclName(node) && !isCalleeSubtree(node) && !isDotLeaf(node) && !isTypePosition(node) &&
        !isModulePath(node) && !isLabel(node) && !isColonLabel(node) &&
        !(node.parent && node.parent.type === "infix_expression" && (field(node.parent, "operator")?.type ?? "") === "as" && field(node.parent, "right")?.startIndex === node.startIndex) &&
        !isWriteTarget(node, false) && !isWriteTarget(node, true) && !shadowed(nm)
      ) {
        push("uses", currentFn(), nm)
      }
    }

    // ── declared-type references, anchored to the owning declaration ──
    if (t === "parameter_declaration" || t === "field_declaration" || t === "variant_discriminator_declaration" || t === "variable_declaration" || t === "cast" || t === "do_block") {
      const owner = ownerDeclarationOf(node)
      if (owner) {
        const te = field(node, "type")
        if (te) collectTypeRefs(te, owner, inv, push)
      }
    } else if (CALLABLE_TYPES.has(t)) {
      const owner = nameOf(field(node, "name")).name
      if (owner) {
        const ret = field(node, "return_type")
        if (ret) collectTypeRefs(ret, owner, inv, push)
      }
    } else if (t === "object_declaration") {
      const owner = ownerDeclarationOf(node)
      const inh = field(node, "inherits")
      if (owner && inh) collectTypeRefs(inh, owner, inv, push)
    } else if (t === "type_declaration") {
      const symDecl = named(node)[0]
      if (symDecl && symDecl.type === "type_symbol_declaration") {
        const self = nameOf(field(symDecl, "name")).name
        const rhs = typeDefinitionRhs(node)
        if (self && rhs) {
          const ctor = typeConstructorLeaf(rhs)
          if (ctor && ctor.type === "identifier" && ctor.text !== self) pushTypeRef(ctor, self, inv, push)
          for (const arg of typeArgumentNodes(rhs)) {
            if (arg.type === "identifier") {
              if (arg.text !== self) pushTypeRef(arg, self, inv, push)
            } else {
              const nested = typeConstructorLeaf(arg)
              if (nested) pushTypeRef(nested, self, inv, push)
            }
          }
        }
      }
    }

    stack.push({ node, exit: true, pushed: pushedScope })
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, exit: false, pushed: false })
    }
  }

  return edges
}

function pushTypeRef(site: any, owner: string, inv: Inventory, push: (l: string, f: string, t: string) => void): void {
  if (!site || site.type !== "identifier") return
  const leaf = site.text
  if (!leaf) return
  if (BUILTIN_TYPES.has(leaf)) return
  if (inv.genericParams.has(leaf)) return
  // A declared-type reference names a TYPE. Two kinds of identifier sit in a type
  // POSITION without being type names, and this oracle had the same blind spot
  // the analyzer had — which is how `type Foo = typeof(p(fail(123)))` came to
  // publish `references -> p` and `references -> fail` for two PROCS, and
  // `TNestedChoices(outerChoice: false, …)` came to publish a reference to a
  // boolean LITERAL. Written from the rule, not from the analyzer's filter: a
  // name the file declares as a value or a callable is a use of that value, and
  // a literal keyword is a value.
  if (inv.values.has(leaf) || inv.callables.has(leaf)) return
  if (LITERAL_KEYWORDS.has(leaf)) return
  push("references", owner, leaf)
}

function collectTypeRefs(te: any, owner: string, inv: Inventory, push: (l: string, f: string, t: string) => void): void {
  const ctor = typeConstructorLeaf(te)
  if (ctor) pushTypeRef(ctor, owner, inv, push)
  for (const arg of typeArgumentNodes(te)) {
    if (arg.type === "identifier") pushTypeRef(arg, owner, inv, push)
    else collectTypeRefs(arg, owner, inv, push)
  }
}

/** The declaration a type site belongs to: the enclosing callable, or the
 *  owning type for a field / discriminator. Local annotations attribute to the
 *  enclosing callable (they are the most common way a Nim proc names a type). */
function ownerDeclarationOf(start: any): string {
  let p: any = start
  let guard = 0
  while (p && guard++ < 32) {
    if (CALLABLE_TYPES.has(p.type)) return nameOf(field(p, "name")).name
    if (p.type === "type_declaration") {
      const symDecl = named(p)[0]
      if (symDecl && symDecl.type === "type_symbol_declaration") return nameOf(field(symDecl, "name")).name
      return ""
    }
    p = p.parent
  }
  return ""
}

function isDescendantOf(node: any, ancestor: any): boolean {
  let p = node.parent
  let guard = 0
  while (p && guard++ < 32) {
    if (p.id === ancestor.id) return true
    p = p.parent
  }
  return false
}

/** One import operand's module path, verbatim. */
function modulePathOf(node: any): string {
  if (!node) return ""
  if (node.type === "identifier" || node.type === "accent_quoted") return node.text
  if (node.type === "interpreted_string_literal" || node.type === "raw_string_literal" || node.type === "long_string_literal") {
    const t = node.text
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
  }
  // A relative path and a dotted path are both "the node's own text": the
  // prefix operator node's text already carries the whole "./" or "../" (it is
  // ONE token, "./" — not "." followed by "/"), so the operand never has to be
  // reassembled. This is also what makes `./httpcore/httplogue` come out whole
  // instead of losing its first segment.
  if (node.type === "prefix_expression" || node.type === "dot_expression" || node.type === "infix_expression") return node.text
  return ""
}

/**
 * Every module path an import operand names.
 *
 * The grammar models a path separator as a NAMED node of type `operator` whose
 * TEXT is the whole separator — `"/"`, or `"/../"` when a parent hop is fused
 * into the same token — and `./` / `../` likewise are single `operator` tokens
 * inside a `prefix_expression`. So `op.type` is never `"/"`; the separator is
 * recognised by its text. An earlier version of this oracle tested
 * `left.type === "identifier"` instead, which is what made it agree with a
 * broken analyzer: both dropped every path deeper than two segments (171 deep
 * imports across 141 corpus files) and both rewrote `import g/../h` as `g/h`.
 * Two wrong implementations in agreement is not corroboration, so the rule
 * here is stated from the node shape and the analyzer is checked against it.
 */
function modulePaths(node: any): string[] {
  if (!node) return []
  if (node.type === "identifier" || node.type === "accent_quoted") return [node.text]
  if (node.type === "interpreted_string_literal" || node.type === "raw_string_literal" || node.type === "long_string_literal") {
    return [modulePathOf(node)]
  }
  if (node.type === "dot_expression") return [node.text]
  if (node.type === "prefix_expression") {
    // A relative path that also carries a QUALIFIER SET:
    //   prefix_expression(operator("./"), pragma_expression(identifier(m1), pragma_list))
    // The node's own text is the whole "./m1 {.all.}", so the module is the
    // prefix token plus the pragma's left leaf.
    const op = field(node, "operator")
    // The `operator` node is NAMED and is the first named child, so the operand
    // is the first named child that is not the operator — by identity, because
    // both nodes can share a type string.
    const operand = op ? named(node).find((c: any) => c.id !== op.id) : named(node)[0]
    if (op && operand && operand.type === "pragma_expression") {
      const inner = field(operand, "left")
      if (inner && (inner.type === "identifier" || inner.type === "accent_quoted")) return [`${op.text}${inner.text}`]
      return []
    }
    return [node.text]
  }
  if (node.type === "array_construction") {
    const out: string[] = []
    for (const c of named(node)) out.push(...modulePaths(c))
    return out
  }
  if (node.type === "infix_expression") {
    const op = field(node, "operator")
    const left = field(node, "left")
    const right = field(node, "right")
    if (!op || !left || !right) return []
    // `as` — the right side is the LOCAL ALIAS, not a module. The module is the
    // LEFT side, so an aliased import publishes the module and the alias goes to
    // metadata; the pre-fix oracle kept the whole "m as alias" text as the
    // target, which disagreed with the analyzer on 6 real files for a reason that
    // was the ORACLE's fault, not the analyzer's.
    if (op.type === "as" || op.text === "as") return modulePaths(left)
    if (!op.text.includes("/")) return []
    // A QUALIFIER SET: `from std/uri {.all.} as uri2 import x` puts a
    // pragma_expression on the right whose LEFT is the path's last segment and
    // whose RIGHT is the `{.all.}` request. The module is left + that leaf; the
    // qualifier is not part of the path.
    if (right.type === "pragma_expression") {
      const inner = field(right, "left")
      if (!inner || (inner.type !== "identifier" && inner.type !== "accent_quoted")) return []
      return [`${left.text}/${inner.text}`]
    }
    // A `[...]` right side is a module LIST, not a path: one module per element.
    if (right.type === "array_construction") {
      const out: string[] = []
      for (const c of named(right)) {
        const name = c.type === "identifier" ? c.text : ""
        if (name) out.push(`${left.text}/${name}`)
      }
      return out
    }
    return [node.text]
  }
  return []
}

/** The node after the `=` in a `type_declaration` — the `typeDefValue`. */
function typeDefinitionRhs(node: any): any {
  let seenEq = false
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c) continue
    if (!seenEq) {
      if (!c.isNamed && c.type === "=") seenEq = true
      continue
    }
    if (c.isNamed) return c
  }
  return null
}

/** The kind a `type` declaration's right-hand side implies, for the analyzer-side
 *  label allowlist. Exported so a lane replica does not re-derive it. */
export function nimTypeKindLabel(rhsType: string): string {
  if (rhsType === "concept_declaration") return "interface"
  if (rhsType === "enum_declaration") return "enum"
  if (rhsType === "tuple_type") return "type"
  return "type_or_class"
}
