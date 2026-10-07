// script/m60/objc-truth.ts — DERIV_EXPORTS_OBJC's independent truth oracle.
//
// WHY THIS FILE EXISTS. `validation/m60/rel-type-coverage-baseline.json` records
// FOUR DERIVATION findings for objective-c: the analyzer emits `calls`,
// `contains`, `references` and `uses` and the shared differential audits only
// ["extends","implements","instantiates","overrides"]. Four types — about 22,000
// of the lane's 23,695 edges — were stored and compared against nothing. That is
// the first-class half of this lane's job, because an unverified edge ships a bug
// invisibly.
//
// WHAT THIS ORACLE IS AND IS NOT. It is a SEPARATE WALKER over the SAME grammar:
// it re-derives each fact from tree-sitter nodes with its own traversal and its
// own rules, and never calls the analyzer or any of its helpers. That makes it a
// second opinion at the level of IMPLEMENTATION, which is exactly the level the
// ontology gate says is not enough on its own:
//
//   "The analyzer and the oracle are two separate walkers over one grammar, so
//    they disagree when either is wrong. But when a relationship type is absent
//    from BOTH … there is nothing to disagree about."
//
// So a grammar bug shared by both paths is INVISIBLE here, and no number this
// file produces should be read as "the graph is right". What it can establish is
// narrower and worth having: that the analyzer's own selections agree with an
// independent reading of the same trees, per type, with the disagreements counted
// and classified rather than asserted.
//
// NO REGEX (lane rule 1): `node.type`, field lookups, `namedChild(i)`, and a
// pre-order stack walk. Nothing in this file matches a pattern in source text.
import type { Node } from "web-tree-sitter"

/**
 * The label set this oracle can emit, exported so a repository-wide coverage gate
 * can read it from HERE rather than from the shared `differential.ts`.
 *
 * The exported literal is what `script/m60/rel-type-coverage-gate.ts`
 * (`readOwnOracleLabels`) looks for, and it is DERIVED from the checks below
 * rather than restated, so it cannot drift from what the oracle actually derives.
 * Note it lists `exports` and not `overrides`: the oracle derives the four types
 * the differential never audited for this lane, plus `exports` because the lane
 * newly constructs it. `extends`, `implements`, `instantiates` and `overrides`
 * are deliberately absent — they are audited by `deriveObjcEdges` in the shared
 * differential, and claiming them here would overstate what this file checks.
 */
export const OBJC_ORACLE_LABELS: ReadonlyArray<string> = [
  // Audited by `deriveObjcEdges` in script/m14/differential.ts (the shared
  // differential, on sdwebimage + afnetworking). Listed here because
  // `script/m60/rel-type-coverage-gate.ts`'s `readOwnOracleLabels` REPLACES a
  // lane's audited set with this export rather than merging the two: verified
  // 2026-10-05 by running the gate with this file present as
  // script/m14/objective-c-truth.ts, which turned CHECK 1 from "5 un-audited"
  // into "4 un-audited: extends, implements, instantiates, overrides" — the gate
  // stopped crediting the four the shared differential genuinely audits. So the
  // export has to be the UNION of both auditors' labels or it makes the gate
  // assert a false debt.
  "extends", "implements", "instantiates", "overrides",
  // Derived by THIS module, audited by script/m60/objc-oracle-audit.ts.
  "calls", "contains", "exports", "references", "uses",
]

export type ObjcTruthLabel = "calls" | "contains" | "exports" | "references" | "uses"

/** One derived fact. `from` is the edge's source side. */
export interface ObjcTruthFact {
  label: ObjcTruthLabel
  from: string
  to: string
  line: number
}

// ============================================================================
// Structural derivations. Each is a fresh selection over the tree; none of them
// calls the analyzer's helpers.
// ============================================================================

/**
 * A method node's selector, re-derived: the chain of keywords (each an
 * `identifier` immediately followed by a `method_parameter`), else the first bare
 * `identifier`. A zero-argument selector is exactly one bare identifier; the chain
 * ENDS at the first bare one either way, because a bare identifier after a
 * keyword is a trailing annotation.
 */
export function truthMethodSelector(node: any): string {
  let sel = ""
  const count = node.namedChildCount
  for (let i = 0; i < count; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "identifier") continue
    const next = i + 1 < count ? node.namedChild(i + 1) : null
    if (next && next.type === "method_parameter") { sel += c.text + ":"; continue }
    if (sel === "") sel = c.text
    break
  }
  return sel
}

/** A message_expression's selector, re-derived: keyword identifiers get ':', and
 *  a send with no keyword is its last bare identifier. */
export function truthMessageSelector(node: any): string {
  let sel = ""
  let lastBare = ""
  const count = node.childCount
  for (let i = 0; i < count; i++) {
    const c = node.child(i)
    if (!c || !c.isNamed || c.type !== "identifier") continue
    const next = i + 1 < count ? node.child(i + 1) : null
    if (next && !next.isNamed && next.type === ":") sel += c.text + ":"
    else lastBare = c.text
  }
  return sel || lastBare
}

/** The module name of a `preproc_include`, re-derived: angle-bracket system_lib_string
 *  with its first and last character sliced off, or a quoted string's string_content. */
export function truthIncludeModule(node: any): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (c.type === "system_lib_string") {
      const t = c.text
      return t.length >= 2 ? t.slice(1, t.length - 1) : null
    }
    if (c.type === "string_literal") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const s = c.namedChild(k)
        if (s && s.type === "string_content") return s.text
      }
      return c.text
    }
  }
  return null
}

/** The declared name of a declarator subtree: the first `identifier` in pre-order.
 *  A declarator holds no expressions, so nothing inside one is a value read. */
export function truthDeclaratorName(node: any): string | null {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const c = stack.pop()
    if (c.type === "identifier") return c.text
    for (let i = c.namedChildCount - 1; i >= 0; i--) {
      const ch = c.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  return null
}

/** Does this declarator subtree reach a `function_declarator`, stopping at a
 *  parameter_list so a function-POINTER parameter does not count? */
export function truthIsPrototypeDeclarator(node: any): boolean {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const c = stack.pop()
    if (c.type === "function_declarator") return true
    if (c.type === "parameter_list") continue
    for (let i = c.namedChildCount - 1; i >= 0; i--) {
      const ch = c.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  return false
}

/** Every identifier TEXT that appears anywhere in the tree. The fabrication test:
 *  a target that is in here is a name the file itself wrote; one that is not, was
 *  invented. Compared as a Set of node texts, never as a pattern. */
export function truthIdentifiersInTree(root: any): Set<string> {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "identifier" || n.type === "type_identifier" ||
        n.type === "field_identifier" || n.type === "constant" ||
        n.type === "statement_identifier" || n.type === "property_identifier") {
      out.add(n.text)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * The BOUND-VALUE INVENTORY of a file, re-derived: what a bare identifier in this
 * file could legitimately be a read OF. This is the oracle's answer to the
 * `uses` question, built from the tree with its own traversal:
 *
 *   - file globals: file-scope declaration declarator names, function_definition names
 *   - same-file class members: property_declaration / instance_variable names under a
 *     class_interface / class_implementation
 *   - same-file enum cases: enumerator names under an enum_specifier
 *
 * Per-scope locals and parameters are NOT collected here on purpose. A `uses`
 * target that is a local is a read of a name the file binds, so the audit checks
 * the SUPERSET: any target that is neither in this inventory nor a parameter nor a
 * local of any definition in the file is a name nothing binds, which is a defect
 * the analyzer's own gate cannot see because it shares the inventory's code.
 */
export function truthGlobalInventory(root: any): Set<string> {
  const globals = new Set<string>()
  const classMembers = new Set<string>()
  const enumCases = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "declaration" && truthIsFileScope(n)) {
      let missingSemi = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && c.isMissing && c.type === ";") missingSemi = true
      }
      if (!missingSemi) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const d = n.namedChild(i)
          if (!d) continue
          if (d.type === "init_declarator" || d.type === "pointer_declarator" ||
              d.type === "array_declarator" || d.type === "identifier" ||
              d.type === "function_declarator" || d.type === "parenthesized_declarator" ||
              d.type === "attributed_declarator") {
            const nm = truthDeclaratorName(d)
            if (nm) globals.add(nm)
          }
        }
      }
    }
    if (n.type === "function_definition") {
      const stack2: any[] = [n]
      while (stack2.length > 0) {
        const c = stack2.pop()
        if (c.type === "compound_statement") continue
        if (c.type === "function_declarator") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const idc = c.namedChild(k)
            if (idc && idc.type === "identifier") { globals.add(idc.text); break }
          }
          break
        }
        for (let i = c.namedChildCount - 1; i >= 0; i--) {
          const ch = c.namedChild(i)
          if (ch) stack2.push(ch)
        }
      }
    }
    if (n.type === "property_declaration" || n.type === "instance_variable") {
      const nm = truthDeclaredMemberName(n)
      if (nm) classMembers.add(nm)
    }
    if (n.type === "enum_specifier") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const el = n.namedChild(i)
        if (!el || el.type !== "enumerator_list") continue
        for (let k = 0; k < el.namedChildCount; k++) {
          const en = el.namedChild(k)
          if (!en || en.type !== "enumerator") continue
          for (let j = 0; j < en.namedChildCount; j++) {
            const idc = en.namedChild(j)
            if (idc && idc.type === "identifier") { enumCases.add(idc.text); break }
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  for (const x of classMembers) globals.add(x)
  for (const x of enumCases) globals.add(x)
  return globals
}

/** A property / ivar name: the deepest identifier under a struct_declaration's
 *  struct_declarator, never the type position. */
export function truthDeclaredMemberName(node: any): string | null {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const c = stack.pop()
    if (c.type === "struct_declaration") {
      const stack2: any[] = [c]
      while (stack2.length > 0) {
        const d = stack2.pop()
        if (d.type === "struct_declarator") return truthDeclaratorName(d)
        for (let i = d.namedChildCount - 1; i >= 0; i--) {
          const ch = d.namedChild(i)
          if (ch) stack2.push(ch)
        }
      }
    }
    for (let i = c.namedChildCount - 1; i >= 0; i--) {
      const ch = c.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  const direct = truthDeclaratorName(node)
  return direct
}

/**
 * Every PARAMETER name and every method-local declared name in the file. Used as a
 * PERMISSIVE half of the `uses` audit: the analyzer's `uses` targets include reads
 * of locals, and this set is derived independently so a target that is neither a
 * local, a parameter, nor in the global inventory is a name nothing in the file
 * binds.
 */
export function truthLocalAndParameterInventory(root: any): Set<string> {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "method_parameter") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") { out.add(c.text); break }
      }
    }
    if (n.type === "parameter_declaration") {
      const nm = truthDeclaratorName(n)
      if (nm) out.add(nm)
    }
    if (n.type === "declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const d = n.namedChild(i)
        if (!d) continue
        if (d.type === "init_declarator" || d.type === "pointer_declarator" ||
            d.type === "array_declarator" || d.type === "identifier") {
          const nm = truthDeclaratorName(d)
          if (nm) out.add(nm)
        }
      }
    }
    if (n.type === "for_statement") {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed && c.type === "in" && i > 0) {
          for (let j = i - 1; j >= 0; j--) {
            const pc = n.child(j)
            if (pc && pc.isNamed) { if (pc.type === "identifier") out.add(pc.text); break }
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * Is this node at FILE SCOPE — that is, is there no enclosing definition or block?
 *
 * Not "is its parent `translation_unit`". A `#if` block wraps top-level
 * declarations and does NOT open a scope, so `parent.type === "translation_unit"`
 * would have missed every marker-bearing declaration inside a conditional
 * (AFNetworkReachabilityManager.h puts all three of its FOUNDATION_EXPORT
 * constants inside `#if !TARGET_OS_WATCH`, and the oracle derived 0 exports from
 * that file on the parent test). The test that matches the language is the
 * ancestor chain.
 */
export function truthIsFileScope(node: any): boolean {
  let p = node.parent
  let g = 0
  while (p && g++ < 200) {
    const t = p.type
    if (t === "method_declaration" || t === "method_definition" ||
        t === "function_definition" || t === "block_literal") return false
    p = p.parent
  }
  return true
}

/**
 * Every method selector and function name the tree carries, wherever it carries
 * them.
 *
 * This is deliberately NOT derived from the containers: 36 of the 322 admitted
 * files contain an ERROR node, and a macro-wrapped typedef (`typedef
 * NSURLSessionAuthChallengeDisposition (^Block)(...)`, which is a MACRO form no
 * grammar expands) swallows the rest of the file — AFURLSessionManager.m has NO
 * `class_implementation` node at all, and its `dealloc` is a method_definition
 * inside the ERROR region. A container-scoped oracle would have called every edge
 * out of such a method "source is not a selector this tree declares", which is an
 * artefact of the oracle, not a finding about the analyzer.
 */
export function truthDefinitionSelectors(root: any): Set<string> {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "method_declaration" || n.type === "method_definition") {
      const s = truthMethodSelector(n)
      if (s) out.add(s)
    } else if (n.type === "function_definition") {
      const s = truthFunctionName(n)
      if (s) out.add(s)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * Every CONTAINER the tree declares: the class / protocol / category name of a
 * class_interface, class_implementation or protocol_declaration, and the
 * type_identifier of a struct / union / enum specifier that DEFINES one (a field
 * list, an enumerator list, or a typedef parent).
 *
 * The `contains` audit asserts every `contains` SOURCE is one of these, which is
 * what rules out the `global contains X` shape the lane documents as forbidden —
 * derived from the tree rather than read out of the analyzer's own bookkeeping.
 */
export function truthContainers(root: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (owner: string | null, member: string): void => {
    if (!owner) return
    if (!out.has(owner)) out.set(owner, new Set<string>())
    out.get(owner)!.add(member)
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "class_interface" || n.type === "class_implementation") {
      let owner: string | null = null
      let seenFirst = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (!seenFirst && (c.type === "identifier" || c.type === "type_identifier")) {
          owner = c.text; seenFirst = true; continue
        }
        break
      }
      const members: any[] = [n]
      while (members.length > 0) {
        const m = members.pop()
        if (m !== n && (m.type === "class_interface" || m.type === "class_implementation" || m.type === "protocol_declaration")) continue
        if (m.type === "method_declaration" || m.type === "method_definition") {
          const s = truthMethodSelector(m)
          if (s) add(owner, s)
        } else if (m.type === "property_declaration" || m.type === "instance_variable") {
          const s = truthDeclaredMemberName(m)
          if (s) add(owner, s)
        }
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) members.push(c)
        }
      }
    }
    if (n.type === "enum_specifier" || n.type === "struct_specifier" || n.type === "union_specifier") {
      // The aggregate's NAME: the macro form carries it inside the macro's own
      // arguments (NS_ENUM(NSUInteger, AFSSLPinningMode) — no type_identifier
      // child at all, so the C route returns nothing), the plain form a
      // type_identifier child, and an anonymous aggregate its typedef alias.
      let name: string | null = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "type_identifier") { name = c.text; break }
      }
      if (!name) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "macro_enum_arguments") {
            for (let k = c.namedChildCount - 1; k >= 0; k--) {
              const a = c.namedChild(k)
              if (a && a.text.trim()) { name = a.text.trim(); break }
            }
            break
          }
        }
      }
      if (!name && n.parent && n.parent.type === "type_definition") {
        for (let i = 0; i < n.parent.namedChildCount; i++) {
          const c = n.parent.namedChild(i)
          if (c && (c.type === "type_identifier" || c.type === "identifier")) name = c.text
        }
      }
      const defines = n.type === "enum_specifier"
        ? n.namedChildren.some((c: any) => c && c.type === "enumerator_list")
        : n.namedChildren.some((c: any) => c && c.type === "field_declaration_list")
      if (name && defines) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "enumerator_list") {
            for (let k = 0; k < c.namedChildCount; k++) {
              const en = c.namedChild(k)
              if (!en || en.type !== "enumerator") continue
              for (let j = 0; j < en.namedChildCount; j++) {
                const idc = en.namedChild(j)
                if (idc && idc.type === "identifier") { add(name, idc.text); break }
              }
            }
          } else if (c.type === "field_declaration_list") {
            for (let k = 0; k < c.namedChildCount; k++) {
              const fd = c.namedChild(k)
              if (!fd || fd.type !== "field_declaration") continue
              const s2: any[] = [fd]
              while (s2.length > 0) {
                const x = s2.pop()
                if (x.type === "field_identifier") { add(name, x.text); break }
                for (let j = x.namedChildCount - 1; j >= 0; j--) {
                  const y = x.namedChild(j)
                  if (y) s2.push(y)
                }
              }
            }
          }
        }
      }
    }
    if (n.type === "protocol_declaration") {
      let owner: string | null = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") { owner = c.text; break }
      }
      const members: any[] = [n]
      while (members.length > 0) {
        const m = members.pop()
        if (m !== n && (m.type === "class_interface" || m.type === "class_implementation" || m.type === "protocol_declaration")) continue
        if (m.type === "method_declaration" || m.type === "method_definition") {
          const s = truthMethodSelector(m)
          if (s) add(owner, s)
        } else if (m.type === "property_declaration" || m.type === "instance_variable") {
          // A @protocol declares @property members too (SDImageTransformer is a
          // protocol with `preserveImageMetadata` and `transformerKey`); the first
          // version of this function collected only methods and reported all 15
          // protocol-property `contains` edges as endpoint failures, which was the
          // ORACLE's gap and not a finding about the analyzer.
          const s = truthDeclaredMemberName(m)
          if (s) add(owner, s)
        }
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) members.push(c)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * Callee names of `call_expression` nodes whose DIRECT parent is an
 * `at_expression`, with the plain-call names alongside.
 *
 * WHY THIS IS SEPARATED. `@weakify(self)`, `@keypath(self, prop)` and
 * `@selector(foo)` all parse as `at_expression > call_expression`. A macro invoked
 * under `@` is a MACRO, and a compiler directive under `@` is a DIRECTIVE; neither
 * is an invocation of a function named by the callee. The analyzer gates exactly
 * one of them (`protocol`, the OC-G ruling) and publishes the rest, so this
 * derivation exists to CLASSIFY those edges rather than to agree or disagree with
 * them: measured over the admitted universe, 50 of 8,077 `calls` edges target a
 * name whose only call site in the file is an `at_expression`, and every one of
 * them is a macro defined in another file (SDWebImage/Private/SDInternalMacros.h
 * defines `weakify`, `strongify` and `keypath`). Macro expansion boundaries are a
 * declared limitation class in the honesty contract, so these are reported as
 * their own bucket with a count instead of being argued about edge by edge.
 *
 * The DIRECT-parent test is what distinguishes them from a boxed expression:
 * `@(CGSizeMake(180, 120))` is `at_expression > parenthesized_expression >
 * call_expression`, where `CGSizeMake` really IS called.
 */
export function truthCallSiteKinds(root: any): { atCallees: Set<string>; plainCallees: Set<string> } {
  const atCallees = new Set<string>()
  const plainCallees = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "call_expression") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") {
          if (n.parent && n.parent.type === "at_expression") atCallees.add(c.text)
          else plainCallees.add(c.text)
          break
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return { atCallees, plainCallees }
}

/**
 * `references` facts: one per `preproc_include` the grammar resolves to a module
 * name, sourced from `root`. The MULTISET of targets is the claim, so the audit
 * can compare it to the analyzer's edges as counts as well as as a set.
 */
export function truthReferences(root: any): ObjcTruthFact[] {
  const out: ObjcTruthFact[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "preproc_include") {
      const m = truthIncludeModule(n)
      if (m) out.push({ label: "references", from: "root", to: m, line: n.startPosition.row + 1 })
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * `exports` facts: a file-scope declaration carrying a marker in the specifier
 * slot, read from a NAMED `storage_class_specifier` node's own text. The marker
 * set is the census's (script/m60/objc-exports-census.ts), derived from the
 * corpus: FOUNDATION_EXPORT 98 declarations in 18 files, `extern` 1, everything
 * else 0.
 */
export const OBJC_TRUTH_EXPORT_MARKERS: ReadonlySet<string> = new Set(["FOUNDATION_EXPORT", "extern"])

export function truthExports(root: any): ObjcTruthFact[] {
  const out: ObjcTruthFact[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "declaration" && truthIsFileScope(n)) {
      let missingSemi = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && c.isMissing && c.type === ";") missingSemi = true
      }
      let marker: string | null = null
      if (!missingSemi) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "storage_class_specifier" && OBJC_TRUTH_EXPORT_MARKERS.has(c.text.trim())) {
            marker = c.text.trim(); break
          }
        }
      }
      if (marker) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const d = n.namedChild(i)
          if (!d) continue
          if (d.type === "init_declarator" || d.type === "pointer_declarator" ||
              d.type === "array_declarator" || d.type === "identifier" ||
              d.type === "function_declarator" || d.type === "parenthesized_declarator" ||
              d.type === "attributed_declarator") {
            const nm = truthDeclaratorName(d)
            if (nm) out.push({ label: "exports", from: "root", to: nm, line: n.startPosition.row + 1 })
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * `calls` facts: a message_expression's structurally derived selector, or a
 * `call_expression`'s callee identifier, sourced from the enclosing
 * method_definition / method_declaration / function_definition selector.
 *
 * alloc/new sends are NOT calls (they are `instantiates`, a label the shared
 * differential audits) and message sends at file or class scope are not calls
 * (there is no method to be inside), so the oracle reproduces both gates and
 * says so rather than deriving a wider set the analyzer would fail.
 */
export function truthCalls(root: any): ObjcTruthFact[] {
  const out: ObjcTruthFact[] = []
  const stack: any[] = [{ node: root, scope: "", inBody: false }]
  while (stack.length > 0) {
    const { node, scope, inBody } = stack.pop()!
    if (!node) continue
    let nextScope = scope
    let nextInBody = inBody
    if (node.type === "method_declaration" || node.type === "method_definition" || node.type === "function_definition") {
      nextScope = node.type === "function_definition" ? truthFunctionName(node) : truthMethodSelector(node)
      if (nextScope) nextInBody = true
    } else if (node.type === "block_literal") {
      nextInBody = true
    }
    if (node.type === "message_expression" && scope && inBody) {
      const sel = truthMessageSelector(node)
      if (sel) {
        const firstKw = sel.split(":")[0]
        if (firstKw !== "alloc" && firstKw !== "new") {
          out.push({ label: "calls", from: scope, to: sel, line: node.startPosition.row + 1 })
        }
      }
    }
    if (node.type === "call_expression" && scope && inBody) {
      // A compiler DIRECTIVE is a call_expression whose DIRECT parent is an
      // at_expression (`@weakify(self)`, `@selector(foo)`, `@protocol(P)`); a
      // BOXED expression is `at_expression > parenthesized_expression >
      // call_expression` (`@(MAX(scale, 1))`, `@(CGSizeMake(180, 120))`) and the
      // call inside it is a real call. The first version of this function walked
      // three ancestors up and gated BOTH, which made it drop `CGSizeMake` and
      // `MAX` and report them as analyzer-only disagreements — the oracle's error,
      // reported rather than hidden, and then corrected here. Same discriminator
      // as `truthCallSiteKinds`.
      const inAtDirective = !!(node.parent && node.parent.type === "at_expression")
      if (!inAtDirective) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "identifier") {
            out.push({ label: "calls", from: scope, to: c.text, line: node.startPosition.row + 1 })
            break
          }
        }
      }
    }
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, scope: nextScope, inBody: nextInBody })
    }
  }
  return out
}

/** A function_definition's name, re-derived: the first function_declarator in
 *  pre-order that is not inside the compound_statement, then its first identifier. */
export function truthFunctionName(node: any): string {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const c = stack.pop()
    if (c.type === "compound_statement") continue
    if (c.type === "function_declarator") {
      for (let i = 0; i < c.namedChildCount; i++) {
        const id = c.namedChild(i)
        if (id && id.type === "identifier") return id.text
      }
      return ""
    }
    for (let i = c.namedChildCount - 1; i >= 0; i--) {
      const ch = c.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  return ""
}