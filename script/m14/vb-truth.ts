/**
 * VB LANE — standalone differential truth oracle. (M60, VB_MEASURE)
 *
 * WHY THIS FILE EXISTS — and it is a DERIVATION finding, not a nicety.
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) asks: is every type
 * an analyzer EMITS also in that language's AUDITED set? A type that is emitted
 * and never audited is "stored and compared against nothing" — an edge that ships
 * a bug invisibly. Measured on this branch before this file existed:
 *
 *     vb  4 un-audited: ["calls", "contains", "imports", "references"]
 *
 * because `vb` appears in NO per-language list in `differential.ts`'s audited-label
 * filter, so it inherited only the filter's four-element head
 * (`extends implements instantiates overrides`). VB emitted 7 types and 4 of them
 * were compared against nothing. The lane doc's claim that the F5 differential
 * "audited all seven labels" was true of a run and false of the gate's own reading
 * of the repository — and the gate is the arbiter.
 *
 * The gate already supports the fix, and its comment names this exact case: a lane
 * whose oracle owns its label set exports `*_ORACLE_LABELS` from
 * `script/m14/<lang>-truth.ts`, and the per-lane export WINS over the shared filter
 * because it is derived from the emitter itself. That is what this file is.
 *
 * INDEPENDENCE, STATED PRECISELY — the limit the harness supports and no more.
 *
 * This oracle never imports `real-vb-analyzer.ts`, never reads its output, never
 * reuses a helper from it, and traverses the tree with its own iterative stack
 * rather than the analyzer's recursion. So it is independent at the level of
 * IMPLEMENTATION, and the two disagree whenever either is wrong.
 *
 * It is NOT independent at the level of the GRAMMAR: it reads the same
 * tree-sitter-vbnet wasm. A defect in the grammar's rule definitions — a
 * mis-grouped `New X()` that becomes an `array_creation_expression` with no type
 * field, say — is invisible to both paths, because both are downstream of it.
 * Every report that quotes a coverage number from this file carries that sentence
 * with it. This is the same limit `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1
 * question 3 states, and no amount of oracle-writing removes it.
 *
 * ZERO REGEX, by construction. Every classification is `node.type`, a field read,
 * a Set membership test, or a character-code scan. There is no pattern anywhere in
 * this file, so "no regex" is a property of the construction rather than a lint
 * that can be forgotten.
 */
import type { Node } from "web-tree-sitter"

export type VbTruthLabel =
  | "calls" | "uses" | "contains" | "imports" | "references"
  | "exports" | "extends" | "implements" | "overrides" | "instantiates"

export interface VbTruthEdge {
  label: VbTruthLabel
  /** The declaring symbol's own name, matching what the analyzer publishes. */
  from: string
  target: string
  line: number
}

// ---------------------------------------------------------------------------
// The label set, exported so the repository-wide gate reads it from HERE.
// Derived from the emitter below by hand and kept adjacent to the switches that
// produce each label, so a label added below without a line here is visible in
// the diff rather than discovered by the gate.
// ---------------------------------------------------------------------------
export const VB_ORACLE_LABELS: ReadonlyArray<VbTruthLabel> = [
  "calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates",
]

// ---------------------------------------------------------------------------
// Node vocabulary, read off the pinned wasm's enumerable surface.
// ---------------------------------------------------------------------------
const DECLARATION = new Set([
  "namespace_declaration", "class_declaration", "structure_declaration",
  "interface_declaration", "module_declaration", "enum_declaration",
  "enum_member_declaration", "delegate_declaration", "method_declaration",
  "constructor_declaration", "property_declaration", "event_declaration",
  "operator_declaration", "declare_statement", "field_declaration",
  "interface_method_declaration", "interface_property_declaration",
  "interface_event_declaration",
])
const MEMBER = new Set([
  "method_declaration", "constructor_declaration", "property_declaration",
  "event_declaration", "operator_declaration", "declare_statement",
  "field_declaration", "enum_member_declaration", "interface_method_declaration",
  "interface_property_declaration", "interface_event_declaration",
])
const NAME_WRAPPER = new Set(["simple_name", "qualified_name", "global_qualified_name", "generic_name"])
const MODIFIER = new Set(["member_modifier", "local_declaration_modifier"])

/** Everything a name can be wrapped in that must be reduced to its last segment. */
const NAME_STRIP: ReadonlyArray<readonly [string, string]> = [
  ["qualified_name", "name"], ["global_qualified_name", "name"],
  ["array_type", "element_type"], ["nullable_type", "declared_type"],
]

const isCalleeOf = (n: any, p: any): boolean => {
  const fn = p.childForFieldName?.("function")
  return !!fn && fn.startIndex === n.startIndex && fn.endIndex === n.endIndex
}
const isAssignedTo = (n: any, p: any): boolean => {
  const l = p.childForFieldName?.("left")
  return !!l && l.startIndex === n.startIndex && l.endIndex === n.endIndex
}

/**
 * The leaf that names a thing, reduced to its last segment.
 *
 * Iterative on purpose: an unbounded descent is how a 4,211-file corpus finds the
 * one file whose tree is deep enough to overflow the stack, and the analyzer
 * already has that failure recorded (`T_68086.vb`). A guard is not a workaround
 * here; it is what lets the oracle report on every file rather than skipping the
 * one that is hard.
 */
function nameLeaf(start: any, depth = 0): any | null {
  let cur = start
  // Progress is tracked by NODE IDENTITY, never by startIndex. An `array_type`
  // `Byte()` and its element type both start at the same byte, so a startIndex
  // guard reads "no progress" on the one hop that matters and returns the
  // array_type — publishing the target `Byte()`, which is an expression, not a
  // name. That was 72 MISSING rows and 26 UNEXPLAINED rows on a 50-file draw,
  // and every one of them was this oracle's bug, not the analyzer's.
  const seen = new Set<number>()
  for (let i = 0; i < 48; i++) {
    if (seen.has(cur.id)) return cur
    seen.add(cur.id)
    if (!cur) return null
    if (cur.type === "identifier") return cur
    if (cur.type === "type_argument_list") return null
    if (NAME_WRAPPER.has(cur.type) || cur.type === "array_type" || cur.type === "nullable_type") {
      let next: any = null
      for (const [t, f] of NAME_STRIP) if (cur.type === t) next = cur.childForFieldName?.(f)
      if (cur.type === "simple_name" || cur.type === "generic_name") {
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && c.type === "identifier") return c
        }
      }
      if (!next || next.id === cur.id) {
        // No field to descend through: the node is a wrapper whose own text is not
        // a name. Take its first NAMED child instead, which for a `As New T()`
        // construction is the constructed type and for anything else is the name.
        const first = cur.namedChildCount > 0 ? cur.namedChild(0) : null
        if (first && first.id !== cur.id) { cur = first; continue }
        return cur
      }
      cur = next
      continue
    }
    return cur
  }
  void depth
  return cur
}

function leafOf(n: any): any | null {
  // The LAST identifier at or under a node — the callee, not its receiver.
  const stack: any[] = [n]
  let best: any = null
  let guard = 0
  while (stack.length > 0 && guard++ < 4096) {
    const cur = stack.pop()
    if (!cur) continue
    if (cur.type === "type_argument_list") continue
    if (cur.type === "identifier") { best = cur; continue }
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const c = cur.child(i)
      if (c) stack.push(c)
    }
  }
  return best
}

function modifiers(n: any): Set<string> {
  const out = new Set<string>()
  const stack: Array<{ n: any; d: number }> = [{ n, d: 0 }]
  while (stack.length > 0) {
    const { n: cur, d } = stack.pop()!
    if (d > 4) continue
    for (let i = 0; i < cur.childCount; i++) {
      const c = cur.child(i)
      if (!c) continue
      if (MODIFIER.has(c.type)) { out.add(c.text.toLowerCase()); continue }
      stack.push({ n: c, d: d + 1 })
    }
  }
  return out
}

function declaredName(n: any): string {
  const f = n.childForFieldName?.("name")
  if (f) {
    const leaf = nameLeaf(f)
    return leaf ? String(leaf.text).trim() : String(f.text).trim()
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && (c.type === "identifier" || c.type === "simple_name")) {
      const leaf = nameLeaf(c)
      return leaf ? String(leaf.text).trim() : String(c.text).trim()
    }
  }
  return ""
}

/** The first declared name inside a `field_declaration` (its `variable_declarator`). */
function fieldNames(n: any): string[] {
  const out: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "variable_declarator") {
      const nm = declaredName(c)
      if (nm) out.push(nm)
    }
  }
  return out
}

/**
 * Does this `as_clause` name the type of a SYMBOL, or of a local binding?
 *
 * The product's contract is a project symbol table and the family does not publish
 * locals or control-flow variables, so an `as_clause` that introduces a binding no
 * index holds has no edge source. The question is decided by the DIRECT parent's
 * ancestry, not by "is there a declaration somewhere above": every local lives
 * inside a method, so walking up until a declaration is found says yes for
 * `Dim total As Integer` inside a `Sub`, which is the bug this replaced.
 *
 *   as_clause < variable_declarator < field_declaration   → a FIELD: a symbol
 *   as_clause < variable_declarator < declaration_statement → a LOCAL: no symbol
 *   as_clause < parameter                                 → a PARAMETER: a symbol
 *   as_clause < method_declaration                        → the RETURN type: a symbol
 *   as_clause < for_each_statement / using_statement / …  → a BINDING: no symbol
 */
function asClauseHasSymbolSource(n: any): boolean {
  const p = n.parent
  if (!p) return false
  if (p.type === "parameter") return true
  if (p.type === "variable_declarator") {
    const grand = p.parent
    return !!grand && (grand.type === "field_declaration" || DECLARATION.has(grand.type))
  }
  // The as_clause IS the declaration's own type clause — a return type, an event
  // type, a delegate's return type.
  return DECLARATION.has(p.type) && p.type !== "field_declaration"
}

const HERITAGE_NAME = new Set(["identifier", "simple_name", "qualified_name", "global_qualified_name", "generic_name"])

const TYPE_DECL = new Set(["class_declaration", "structure_declaration", "interface_declaration", "module_declaration"])

/**
 * The header-form heritage clause: `Class C : Inherits B, Implements I`.
 *
 * DERIVED FROM THE TREE, NOT ASSUMED. The first version of this oracle read only
 * `inherits_statement` / `implements_statement` children, so it silently UNDER-derived
 * every header-form edge — which showed up as 2 UNEXPLAINED `extends` rows against
 * the analyzer and, worse, as a coverage figure that looked complete because the
 * missing truth rows were not there to be counted.
 *
 * The keyword is NOT in the tree: for `Class VBKindProvider : Implements
 * ISyntaxNodeKindProvider` the children after the colon are one `simple_name` and
 * then the first member. So the discriminator is the declaration's own node type,
 * which is VB's rule — a Class header has at most one `Inherits` and it comes first;
 * a Structure, Interface or Module cannot inherit at all, so its whole list is
 * implemented interfaces.
 */
function headerHeritage(typeDecl: any): Array<{ name: any; label: "extends" | "implements" }> {
  const out: Array<{ name: any; label: "extends" | "implements" }> = []
  const nm = typeDecl.childForFieldName?.("name")
  if (!nm) return out
  let colon = -1
  for (let i = 0; i < typeDecl.childCount; i++) {
    const c = typeDecl.child(i)
    if (c.startIndex > nm.startIndex && c.type === ":") { colon = i; break }
  }
  if (colon < 0) return out
  const baseFirst = typeDecl.type === "class_declaration"
  let seen = 0
  for (let i = colon + 1; i < typeDecl.childCount; i++) {
    const c = typeDecl.child(i)
    if (DECLARATION.has(c.type)) break
    if (!HERITAGE_NAME.has(c.type)) continue
    out.push({ name: c, label: baseFirst && seen === 0 ? "extends" : "implements" })
    seen++
  }
  return out
}

/** The name-bearing children of a heritage clause, in source order. */
function heritageNames(node: any): any[] {
  const out: any[] = []
  const stack: any[] = [...namedChildren(node)].reverse()
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur) continue
    if (HERITAGE_NAME.has(cur.type)) { out.push(cur); continue }
    const kids = namedChildren(cur)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  return out
}

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

// ---------------------------------------------------------------------------
// THE DERIVATION
// ---------------------------------------------------------------------------

/**
 * Derive every edge this oracle believes the tree implies.
 *
 * `sourceOverride` is the enclosing declaration for positions where the tree
 * cannot name one: an expression in a field initializer or in a `Module`'s body
 * has no method above it, and an edge from nothing is a phantom, so those sites
 * are skipped rather than attributed to the file.
 */
export function deriveVbTruth(root: any, _content: string, _filePath: string): VbTruthEdge[] {
  const out: VbTruthEdge[] = []
  // NOTHING is derived from the synthetic file root. `root` is not a symbol in
  // this product, so an edge that starts there cannot be published by any analyzer
  // and can only ever register as a permanent MISSING row — a finding about the
  // oracle rather than about the code. A construction in a file-scope field
  // initializer has no enclosing declaration, so it gets no edge, which is the
  // analyzer's own behaviour and is counted as a gap there rather than invented.
  const push = (label: VbTruthLabel, from: string, target: string, line: number): void => {
    if (!from || from === "root" || !target) return
    out.push({ label, from, target, line })
  }

  // Pass 1 — every name the file DECLARES. Needed before any `references` or
  // confidence-shaped judgement, and it is why the derivation is two passes rather
  // than one: a declaration can follow its first use.
  const declared = new Set<string>()
  /** Declaring type name -> the base type its own `Inherits` names, for `overrides`. */
  const baseOf = new Map<string, string>()

  type Frame = { node: any; name: string; kind: string }
  const walkDecls = (start: any, ownerName: string): void => {
    const stack: Frame[] = []
    for (const c of namedChildren(start)) stack.push({ node: c, name: ownerName, kind: "file" })
    let guard = 0
    while (stack.length > 0 && guard++ < 200_000) {
      const f = stack.pop()!
      const n = f.node
      let owner = f.name
      if (DECLARATION.has(n.type)) {
        let nm = declaredName(n)
        if (n.type === "constructor_declaration") nm = "constructor"
        if (n.type === "operator_declaration") nm = "operator"
        if (n.type === "field_declaration") {
          // A field declaration names SEVERAL symbols and carries no `name` field
          // of its own, which is the same reason a `contains` edge for a field has
          // to be pushed once PER declarator rather than once per declaration.
          for (const fn of fieldNames(n)) {
            declared.add(fn)
            push("contains", owner, fn, n.startPosition.row + 1)
          }
          for (const c of namedChildren(n)) stack.push({ node: c, name: owner, kind: "field" })
          continue
        }
        if (n.type === "enum_member_declaration") {
          if (nm) { declared.add(nm); push("contains", owner, nm, n.startPosition.row + 1) }
          continue
        }
        if (nm) {
          declared.add(nm)
          // NO `contains` FROM THE SYNTHETIC FILE ROOT. `root` is not a symbol:
          // the analyzer records `ownerName` on a top-level declaration and emits
          // no edge, because an edge whose source is nothing cannot be navigated.
          // Deriving `root -> Namespace` would report a truth edge that no
          // implementation can publish, which is how an oracle manufactures a
          // permanent MISSING row.
          if (owner !== "root") push("contains", owner, nm, n.startPosition.row + 1)
          owner = nm
        }
        if (n.type === "class_declaration" || n.type === "structure_declaration") {
          const lineForm = (): void => {
            for (const c of namedChildren(n)) {
              if (c.type !== "inherits_statement") continue
              for (const hn of heritageNames(c)) {
                const leaf = nameLeaf(hn)
                if (leaf) { baseOf.set(nm, String(leaf.text).trim()); return }
              }
            }
          }
          lineForm()
          if (!baseOf.has(nm)) {
            for (const h of headerHeritage(n)) {
              if (h.label !== "extends") continue
              const leaf = nameLeaf(h.name)
              if (leaf) { baseOf.set(nm, String(leaf.text).trim()); break }
            }
          }
        }
        const mods = modifiers(n)
        if (mods.has("overrides") && MEMBER.has(n.type) && nm) {
          // The BASE MEMBER's name, qualified by the base type when this file says
          // what the base type is. Deriving the qualified form INDEPENDENTLY is the
          // only way the comparison can catch the analyzer qualifying with the
          // wrong base — normalising it away would hide exactly that defect.
          // The base member lives on the nearest enclosing TYPE. `f.kind` is the
          // parent node type and `f.name` the parent's name, so for a member that
          // sits directly in a class this is the class; for a member nested one
          // level down the walk has already replaced `owner` with the intermediate
          // declaration, and using `owner` alone would look up an event or a field
          // name that has no base type at all.
          const ownerType = (f.kind === "class_declaration" || f.kind === "structure_declaration" || f.kind === "interface_declaration" || f.kind === "module_declaration") ? f.name : owner
          const base = baseOf.get(ownerType)
          out.push({ label: "overrides", from: nm, target: base ? `${base}.${nm}` : nm, line: n.startPosition.row + 1 })
        }
      }
      for (const c of namedChildren(n)) stack.push({ node: c, name: owner, kind: n.type })
    }
  }
  walkDecls(root, "root")

  // Pass 2 — relationships. The enclosing declaration is carried on the stack, so
  // a `calls` edge names the member a reader would navigate into.
  type RFrame = { node: any; owner: string }
  const stack: RFrame[] = []
  for (const c of namedChildren(root)) stack.push({ node: c, owner: "root" })
  let guard = 0
  while (stack.length > 0 && guard++ < 400_000) {
    const f = stack.pop()!
    const n = f.node
    const t = n.type
    let owner = f.owner

    if (DECLARATION.has(t)) {
      let nm = declaredName(n)
      if (t === "constructor_declaration") nm = "constructor"
      if (t === "operator_declaration") nm = "operator"
      // EVERY declaration owns its children — a NAMESPACE and a TYPE just as much
      // as a method. The first version of this oracle propagated the owner only
      // for members, so everything inside a namespace was attributed to the
      // synthetic `root` and 24 `extends` rows, 50 `contains` rows and most of the
      // `references` rows came out MISSING and their analyzer counterparts came out
      // UNEXPLAINED — 100+ findings, every one of them an oracle bug wearing the
      // costume of an analyzer defect.
      if (t === "field_declaration" || t === "enum_member_declaration") owner = f.owner
      else if (nm) owner = nm
    }

    if (t === "imports_statement") {
      for (const nameNode of heritageNames(n)) {
        const leaf = nameLeaf(nameNode)
        if (leaf) out.push({ label: "imports", from: "root", target: String(leaf.text).trim(), line: leaf.startPosition.row + 1 })
      }
    }

    if (t === "inherits_statement") {
      for (const nameNode of heritageNames(n)) {
        const leaf = nameLeaf(nameNode)
        if (leaf) push("extends", owner, String(leaf.text).trim(), leaf.startPosition.row + 1)
      }
    }
    if (TYPE_DECL.has(t)) {
      // The HEADER form. Without this the oracle under-derived every
      // `Class C : Inherits B`, and under-derivation is the dangerous direction:
      // the rows are not MISSING, they are simply absent, so the coverage figure
      // looks complete while two analyzer edges sit unexplained against it.
      for (const h of headerHeritage(n)) {
        const leaf = nameLeaf(h.name)
        if (leaf) push(h.label, owner, String(leaf.text).trim(), leaf.startPosition.row + 1)
      }
    }
    if (t === "implements_statement" || t === "implements_member_clause") {
      for (const nameNode of heritageNames(n)) {
        const leaf = nameLeaf(nameNode)
        // A MEMBER clause keeps its qualifier: the member is named BY the
        // interface, so last-segment reduction would yield `X -> X`.
        const raw = String(nameNode.text).trim()
        if (leaf) push("implements", owner, t === "implements_member_clause" ? raw : String(leaf.text).trim(), leaf.startPosition.row + 1)
      }
    }

    if (t === "as_clause") {
      const declaredType = n.childForFieldName?.("declared_type")
      if (declaredType) {
        const leaf = nameLeaf(declaredType)
        if (leaf) {
          const nm = String(leaf.text).trim()
          // A FIELD's declared type is referenced FROM THE FIELD. `Dim x As New T()`
          // puts the `as_clause` inside a `variable_declarator`, and the declarator
          // is a symbol of its own, so the edge is `x -> T`. A method's return type
          // is referenced from the method.
          let src = owner
          const declarator = n.parent
          if (declarator && declarator.type === "variable_declarator") {
            const dn = declaredName(declarator)
            if (dn) src = dn
          }
          // A LOCAL introduces no symbol, so there is nothing for a `references`
          // edge to start from. The rule is stated as "walk up until a symbol or a
          // parameter is reached" rather than as a list of statement types to
          // exclude, because the first version listed `declaration_statement` and
          // therefore derived `references|<method>|Integer` for
          // `For Each url As String In _urlList` — a control variable that is not a
          // symbol either. Those 11 rows registered as MISSING and were an oracle
          // bug wearing the costume of an analyzer gap.
          if (asClauseHasSymbolSource(n) && nm && !declared.has(nm)) {
            push("references", src, nm, leaf.startPosition.row + 1)
          }
        }
      }
    }

    if (t === "constructor_initializer") {
      // `: base(...)` / `: Me(...)` — the one VB call form that is not an
      // expression. `Me` and `MyBase` are not constructions of anything this file
      // names, so they are neither called nor instantiated.
      const leaf = leafOf(n)
      const nm = leaf ? String(leaf.text).trim() : ""
      if (nm && nm !== "Me" && nm !== "MyBase") {
        push("calls", owner, nm, leaf.startPosition.row + 1)
        push("instantiates", owner, nm, leaf.startPosition.row + 1)
      }
    }

    if (t === "invocation_expression") {
      const fn = n.childForFieldName?.("function")
      if (fn) {
        const leaf = leafOf(fn)
        if (leaf) {
          const nm = String(leaf.text).trim()
          push("calls", owner, nm, leaf.startPosition.row + 1)
          if (fn.type === "object_creation_expression" || fn.type === "array_creation_expression") {
            push("instantiates", owner, nm, leaf.startPosition.row + 1)
          }
        }
      }
    }

    if (t === "object_creation_expression" || t === "array_creation_expression") {
      // A construction that is NOT the callee of an invocation — `Dim x As New T()`,
      // `Private _c As New Timer()` — is still a construction. Keying only on the
      // invocation path drops every one of them, and that is a measured number, not
      // a hypothesis: the census found constructions on the tree with no analyzer
      // edge naming their type.
      const isCallee = n.parent && n.parent.type === "invocation_expression" && isCalleeOf(n, n.parent)
      if (!isCallee) {
        const ty = n.childForFieldName?.("type")
        if (ty) {
          const leaf = leafOf(ty)
          if (leaf) {
            const nm = String(leaf.text).trim()
            push("instantiates", owner, nm, leaf.startPosition.row + 1)
            push("calls", owner, nm, leaf.startPosition.row + 1)
          }
        }
      }
    }

    if (t === "member_access_expression" || t === "with_member_access_expression") {
      // A member READ: not in a callee chain, not written to.
      let cur: any = n
      let inCallee = false
      for (let g = 0; g < 48; g++) {
        const p = cur.parent
        if (!p) break
        if (p.type === "invocation_expression" || p.type === "generic_invocation_expression") { inCallee = isCalleeOf(cur, p); break }
        if (p.type === "member_access_expression" || p.type === "with_member_access_expression") {
          const recv = p.childForFieldName?.("expression")
          if (recv && recv.startIndex === cur.startIndex && recv.endIndex === cur.endIndex) { cur = p; continue }
          break
        }
        break
      }
      const isWrite = n.parent && (n.parent.type === "assignment_expression" || n.parent.type === "assignment_statement") && isAssignedTo(n, n.parent)
      if (!inCallee && !isWrite) {
        const leaf = leafOf(n)
        if (leaf) push("uses", owner, String(leaf.text).trim(), leaf.startPosition.row + 1)
      }
    }

    if (t === "module_declaration") {
      const modName = declaredName(n)
      if (modName) {
        // A MODULE's Public members are its external surface. Nested inside the
        // module so `owner` is the module.
        for (const c of namedChildren(n)) {
          const stack2: RFrame[] = [{ node: c, owner: modName }]
          let g2 = 0
          while (stack2.length > 0 && g2++ < 20_000) {
            const f2 = stack2.pop()!
            const m = f2.node
            if (DECLARATION.has(m.type) && MEMBER.has(m.type)) {
              const mm = modifiers(m)
              if (mm.has("public")) {
                const nm = m.type === "field_declaration" ? fieldNames(m)[0] : (m.type === "constructor_declaration" ? "constructor" : m.type === "operator_declaration" ? "operator" : declaredName(m))
                if (nm) push("exports", modName, nm, m.startPosition.row + 1)
              }
            }
            for (const c2 of namedChildren(m)) stack2.push({ node: c2, owner: f2.owner })
          }
        }
      }
    }

    for (const c of namedChildren(n)) stack.push({ node: c, owner })
  }

  return out
}

/**
 * An edge key, for set arithmetic. Normalised on both sides so a `qualified_name`
 * reduced by either implementation lands on the same key — the same normalisation
 * `differential.ts` applies for other lanes, and the reason two walkers can be
 * compared at all.
 */
export function vbEdgeKey(e: { label: string; from: string; target: string }): string {
  return `${e.label}|${e.from}|${e.target}`
}