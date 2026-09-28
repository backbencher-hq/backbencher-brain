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
 *   contains     owner -> owned member (from the analyzer's own owner names,
 *                shared ground truth).
 *   extends      `ref object of B` -> the base, unless the base is one of the
 *                compiler's roots (RootObj/RootRef/Object), which exist nowhere.
 *   overrides    a method whose receiver is a declared subtype of another
 *                method's receiver, owner-qualified `Receiver.method`.
 *   references   declared-type sites: parameter/field/discriminator/value
 *                annotations, return types, `cast[T]`, `ref object of`,
 *                `concept … of`, and a type alias's RHS — constructor AND
 *                type arguments.
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
      emitImport(m ? modulePathOf(m) : "")
    } else if (n.type === "include_statement") {
      const list = firstOfType(n, "expression_list")
      for (const operand of list ? named(list) : []) emitImport(modulePathOf(operand))
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
  const bindNames = (frame: Scope | null, listNode: any): void => {
    if (!frame || !listNode) return
    for (const d of named(listNode)) {
      if (d.type === "symbol_declaration") {
        const info = nameOf(field(d, "name"))
        if (info.name && info.name !== "_") frame.names.add(info.name)
      } else if (d.type === "tuple_deconstruct_declaration") {
        for (const inner of named(d)) {
          const info = nameOf(inner)
          if (info.name && info.name !== "_") frame.names.add(info.name)
        }
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
      if (!(isModifierCall(node) && isTypePosition(node))) {
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
      if (leafText && leafText !== "_" && !inCallee && resolvable(leafText) && !KEYWORD_LIKE.has(leafText)) {
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
  if (node.type === "prefix_expression" || node.type === "dot_expression") return [node.text]
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
    // `as` — the right side is the LOCAL ALIAS, not a module.
    if (op.type === "as" || op.text === "as") return modulePaths(left)
    if (!op.text.includes("/")) return []
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
