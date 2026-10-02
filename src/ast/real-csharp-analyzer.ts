// Pure-AST C# analyzer — M12 per-analyzer perfection contract.
//
// Emits exactly the M12 differential contract (mirroring the Java family):
//   Symbols: namespace, class, interface, struct, record, enum, enum_member,
//            delegate, event, method, constructor, property. NO locals, NO
//            parameters, NO accessor scopes, NO synthetic members.
//   Relationships: contains, extends, implements, calls, instantiates,
//            overrides (qualified Owner.method -> Parent.method), uses
//            (field access), references (imports -> module paths).
//
// Grammar notes (tree-sitter-c-sharp v0.23.5, upgraded for M12.07):
//   * primary constructors (C# 12) parse cleanly (the previously wired
//     grammar failed on them)
//   * C# base lists have no keyword distinction (unlike Java's
//     extends/implements): the first entry may be a base class OR an
//     interface. Kind is resolved via the optional type-kind companion
//     (context.typeKinds, built by the harness pre-pass from the cross-file
//     symbol space — same machinery as the override companion); unknown
//     external types use the deterministic C# language rule: first base =
//     extends, remaining = implements.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// ============================================================================
// SHARED TARGET-TYPED `new()` RESOLUTION (CSD14, OO family closure 2026-09)
// ============================================================================
// The 200-file deep fsharp:csharp lane exposed a defect class SHARED by the
// analyzer AND the oracle (invisible at 60-file depth): member-type prepasses
// and resolvers only accepted identifier/generic/qualified/predefined/nullable
// DIRECT children, so array/collection-wrapped members (`EnumSettingEntry[]
// ExtensionChoice { get; } = [ new(...), ... ]`) fell through to the member
// NAME as the declared type — fabricating self-targets (`ExtensionChoice ->
// ExtensionChoice`) on the analyzer side and property/argument names on the
// oracle side. These helpers are the single source of truth for both sides:
//
//  - csharpMemberDeclaredTypeText: the RAW declared-type text of a field /
//    property / indexer / local declarator, unwrapping array_type / pointer_type
//    / nullable_type / ref_type containers to their inner token.
//  - csharpResolveTargetTypedNew: resolve an implicit_object_creation_expression
//    to its construction target — the declared type BASE for direct
//    assignments, or the ELEMENT type when the new() sits inside a collection /
//    array initializer (`T[] x = [new()]` -> T; `List<T> x = [new()]` -> T).

export function csharpCleanTypeLeaf(text: string): string {
  // Strip generic arguments, nullable and array suffixes, keep qualified paths
  // verbatim (legacy cleanTypeName contract — no last-segment collapse).
  const lt = text.indexOf("<")
  const base = lt > 0 ? text.slice(0, lt) : text
  const q = base.indexOf("?")
  const noQ = q > 0 ? base.slice(0, q) : base
  const br = noQ.indexOf("[")
  return (br > 0 ? noQ.slice(0, br) : noQ).trim()
}

/**
 * The CANONICAL text of a type / namespace name: whitespace runs collapse to one
 * space, spaces next to a NAME SEPARATOR (`.`, `<`, `>`, `,`, `[`, `]`) are
 * removed, and the result is trimmed.
 *
 * Why the separators and not only `.`: the function's contract is "the name, never
 * the layout", and C# allows whitespace around every one of them — `C < T >`, the
 * conversion target the old operator regex did not merely mis-space but TRUNCATED
 * (`implicit C` for `implicit operator C<T>(...)`, measured with
 * script/m14/tmp/cs-op-check.ts), and `int [ ]`. Including the whole separator set
 * here rather than a second cleaning rule at the operator site is deliberate: one
 * definition of "the canonical name" is what keeps the analyzer and the
 * differential's truth derivation in lockstep, and two cleaning rules would be free
 * to disagree about the same name.
 *
 * C# lets a qualified name WRAP (the grammar allows whitespace between the `.`
 * and the next identifier, or before the dot), and the target of a relationship
 * is the NAME, never the layout. Measured (script/m14/tmp/cs-wrapped-qualified.ts):
 * `using System\n    .Collections.Generic;` parsed with the target text
 * `"System\n    .Collections.Generic"` and `class C :\n    System.\n        IDisposable`
 * with `"System.\n        IDisposable"` — the ruby lane's D3 class, found on this
 * lane by probing the same shape rather than assuming it away. Single-line names
 * are unchanged by construction. Shared with the differential's C# truth
 * derivation, so the two sides clean identically (lockstep, CSD14's rule).
 * Zero-regex char scan (R2).
 */
function isCSharpNameSeparator(ch: string | undefined): boolean {
  return ch === "." || ch === "<" || ch === ">" || ch === "," || ch === "[" || ch === "]"
}

export function csharpTypeNameText(text: string): string {
  const out: string[] = []
  let pendingSpace = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      if (out.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) {
      const last = out[out.length - 1]
      // A separator cannot carry meaning, so no space survives on either side of it.
      if (!isCSharpNameSeparator(last) && !isCSharpNameSeparator(ch)) out.push(" ")
      pendingSpace = false
    }
    out.push(ch)
  }
  return out.join("")
}

/** The node types that can CARRY a declared type — module-level so the M59.A7
 *  line stamp and the text extraction resolve the SAME holder through ONE
 *  definition (two copies of this set would be free to drift apart). */
const CSHARP_DECLARED_TYPE_NODES = new Set([
  "identifier", "generic_name", "qualified_name", "predefined_type",
  "array_type", "pointer_type", "nullable_type", "ref_type", "tuple_type",
  // C2a: a `global::`-qualified name with a SINGLE segment is an `alias_qualified_name` — the
  // grammar only wraps it in a `qualified_name` when the path has a dot after the qualifier. The
  // set's two consumers are the return-type and indexer-type fallback scans, so without this the
  // declared-type graph lost the dependency for exactly the qualified spelling it exists to
  // normalise (measured: `public global::Root RetAlias()` published NO `return_type` ref while
  // `public Root RetPlain()` published one — script/m14/tmp/cs-alias-position-battery3.ts).
  "alias_qualified_name",
])

/** The declaration node types this analyzer turns into SYMBOLS whose name is a
 *  `name` field (or, for an indexer, the `this` keyword). Used by the M59.A7
 *  containment stamp (#825) to find the line a member's NAME is written on, so
 *  the set has to mirror the symbol pass — a type missing here is a member whose
 *  containment edge falls back to the declaration's start line, which is the
 *  pre-existing behaviour rather than a wrong claim. `field_declaration` and
 *  `event_field_declaration` are NOT here (their names live on the declarators,
 *  which the collector walks separately) and neither is `destructor_declaration`
 *  (its symbol name is synthesised — see collectContainmentSites). */
const CSHARP_SYMBOL_DECLARATIONS = new Set([
  "namespace_declaration", "file_scoped_namespace_declaration",
  "class_declaration", "struct_declaration", "interface_declaration",
  "record_declaration", "enum_declaration",
  "enum_member_declaration", "delegate_declaration", "event_declaration",
  "operator_declaration", "conversion_operator_declaration",
  "method_declaration", "constructor_declaration",
  "property_declaration", "indexer_declaration",
])

export function csharpMemberDeclaredTypeText(memberLike: any): string | null {
  // A member-LIKE node is any declaration that carries (or wraps) a declared
  // type: field_declaration > variable_declaration, property/indexer, or a
  // variable_declarator whose type lives on the enclosing variable_declaration.
  const TYPES = CSHARP_DECLARED_TYPE_NODES

  const resolveHolder = (holder: any, nameFieldChild: any): string | null => {
    // Preferred: the explicit `type` FIELD (never the declarator name).
    const tf = holder?.childForFieldName?.("type")
    if (tf) return String(tf.text ?? "").trim()
    // Fallback: first direct type-ish child that is NOT the node's name field
    // (a variable_declarator's identifier name must never read as a type — the
    // CSD14 self-target fabrication: `Widget Fallback = new()` resolved to
    // Fallback because the name identifier matched the type-ish scan).
    for (const c of holder?.namedChildren ?? []) {
      if (!c || !TYPES.has(c.type)) continue
      if (nameFieldChild && c.startIndex === nameFieldChild.startIndex && c.endIndex === nameFieldChild.endIndex) continue
      return String(c.text ?? "").trim()
    }
    return null
  }

  if (memberLike.type === "field_declaration") {
    const vd = memberLike.namedChildren?.find((c: any) => c.type === "variable_declaration")
    if (vd) {
      const t = resolveHolder(vd, null)
      if (t) return t
    }
  }
  if (memberLike.type === "variable_declarator") {
    // The declarator's own type field is empty for fields/locals — climb to
    // the enclosing variable_declaration which holds the type.
    const parentDecl = memberLike.parent
    if (parentDecl && parentDecl.type === "variable_declaration") {
      const t = resolveHolder(parentDecl, null)
      if (t) return t
    }
  }
  const nameFieldChild = memberLike.childForFieldName?.("name") ?? null
  const holder = memberLike.type === "field_declaration"
    ? memberLike.namedChildren?.find((c: any) => c.type === "variable_declaration")
    : memberLike
  return resolveHolder(holder, nameFieldChild)
}

/**
 * WHERE a target-typed `new()` gets its construction target.
 *
 * ONE walk, TWO consumers — CSD14's rule, extended by M59.A7 (#825): the
 * differential oracle needs the resolution's *text*, and the analyzer's line
 * stamp needs the resolution's *site* (the declaration that writes the target
 * name). Two copies of this walk would be free to disagree about which
 * declaration answered — and a line stamp derived from a walk the oracle does
 * not share is exactly the kind of claim the line round exists to make
 * checkable. So the walk returns the site, and the text is derived from it.
 */
export type CSharpTargetTypedNewSite =
  | { kind: "declaration"; decl: any; isElement: boolean }
  | { kind: "assignment"; memberName: string; isElement: boolean }

export function csharpTargetTypedNewSite(nodeLike: any): CSharpTargetTypedNewSite | null {
  // Walk UP from the implicit new: collect whether we crossed an element
  // position (collection_expression / collection_element / initializer of an
  // array creation) and bail when we cross an enclosing object_creation
  // (object-initializer member values need the OTHER type's member table).
  let isElement = false
  let cur: any = nodeLike.parent
  while (cur) {
    if (cur.type === "collection_expression" || cur.type === "collection_element" ||
        cur.type === "expression_element" || cur.type === "initializer_expression" ||
        cur.type === "array_creation_expression") {
      // array_creation_expression > initializer_expression holds ELEMENTS.
      isElement = isElement || cur.type === "collection_element" ||
        cur.type === "expression_element" || cur.type === "collection_expression" ||
        cur.type === "initializer_expression" || cur.type === "array_creation_expression"
    }
    if (cur.type === "object_creation_expression" || cur.type === "implicit_object_creation_expression" ||
        cur.type === "anonymous_object_creation_expression") {
      // Nested inside another construction (object initializer member value) —
      // the target is a member of the OUTER type, not resolvable per-file.
      return null
    }
    if (cur.type === "invocation_expression" || cur.type === "argument_list" ||
        // ≡ /^(binary|conditional|prefix_unary|postfix_unary|cast|as_|await|coalesce|conditional_access|element_access|member_access)_expression$/ —
        // anchored alternation over the fixed expression-node set: endsWith("_expression") + membership excludes arbitrary *_expression node types (equals-check per disjunct; as_* is startsWith).
        CSHARP_TARGETISH_EXPRESSIONS.has(cur.type)) {
      // The new() sits INSIDE a larger expression (a call argument such as
      // `Foo(new())`, `x ? new() : y`): its target is the parameter/operand
      // type, not the enclosing declaration's type — an honest no-edge.
      return null
    }
    if (cur.type === "variable_declarator" || cur.type === "property_declaration" ||
        cur.type === "indexer_declaration" || cur.type === "field_declaration") {
      return { kind: "declaration", decl: cur, isElement }
    }
    if (cur.type === "assignment_expression") {
      const lhs = cur.childForFieldName?.("left")
      if (!lhs) return null
      const name = lhs.type === "identifier" ? lhs.text : (lhs.childForFieldName?.("name")?.text ?? "")
      return name ? { kind: "assignment", memberName: name, isElement } : null
    }
    cur = cur.parent
  }
  return null
}

export function csharpResolveTargetTypedNew(nodeLike: any, memberTypes?: Map<string, string>): string | null {
  const site = csharpTargetTypedNewSite(nodeLike)
  if (!site) return null
  if (site.kind === "declaration") {
    const declared = csharpMemberDeclaredTypeText(site.decl)
    if (!declared) return null
    if (declared === "var") return null
    return csharpTargetFromDeclaredType(declared, site.isElement)
  }
  const declared = memberTypes?.get(site.memberName)
  return declared ? csharpTargetFromDeclaredType(declared, site.isElement) : null
}

export function csharpTargetFromDeclaredType(typeText: string, isElement: boolean): string {
  // C2a: a declared type written `global::A.B` denotes the SAME type as `A.B`, and the
  // lane publishes the full dotted path, so the qualifier comes off here — the point where
  // a declared type becomes a construction TARGET. Measured by
  // `script/m14/tmp/cs-alias-position-battery.ts`: `System.Text.StringBuilder b = new()` and
  // `global::System.Text.StringBuilder b = new()` published two spellings of one type
  // (the qualifier survived because this path cleans through csharpCleanTypeLeaf, which
  // keeps qualified paths verbatim by contract).
  let t = csharpTypeSpelling(typeText).trim()
  if (t === "var") return ""
  // Outer nullable marker (`List<int>?`, `T?`) is not part of the construction
  // target.
  if (t.endsWith("?")) t = t.slice(0, -1).trim()
  if (isElement) {
    // Element of an array-typed member: content before the first `[`.
    const br = t.indexOf("[")
    if (br > 0) return csharpCleanTypeLeaf(t.slice(0, br))
    // Element of a generic collection member: the FIRST type argument
    // (`List<EnumSettingEntry>` -> EnumSettingEntry).
    const lt = t.indexOf("<")
    if (lt > 0 && t.endsWith(">")) {
      const inner = t.slice(lt + 1, -1)
      const first = inner.split(",")[0].trim()
      return csharpCleanTypeLeaf(first)
    }
    return csharpCleanTypeLeaf(t)
  }
  // Direct assignment: the declared type itself (generic base for `List<int>`).
  return csharpCleanTypeLeaf(t)
}
import { findDeclaringParent, localEdgeLabel } from "./override-context"

interface Scope {
  node: Node
  name: string // full name (namespace-qualified for types)
  rawName: string
  kind: ASTEngine.SymbolKind
  fqn: string
  symbolRef?: ASTEngine.UniversalSymbol
  visibility: "public" | "private" | "protected" | "internal" | undefined
  isInterface: boolean
  parents: string[]
}

interface OverrideTask {
  fqn: string
  methodName: string
  signature: string
  ownerFqn: string
  /** M59.A7 (#825): the line of the OVERRIDING declaration — the node that
   *  writes the overriding name. The target (the base member) is external, so
   *  the overriding symbol's own declaration is the family contract's site
   *  (same rule as ruby's `overrides` stamp). */
  line?: number
}

/**
 * C923 (#923): one member declaration that may satisfy an interface member.
 *
 * C# needs NO keyword to satisfy an interface, so the `override`-modifier machinery above
 * cannot see either form — `class C : IFoo { public void M() {} }` (implicit) and
 * `class C : IFoo { void IFoo.M() {} }` (explicit) both publish no member-level edge at all.
 * Tasks are collected during the walk and resolved AFTER it, because C# lets an interface be
 * declared below its implementor (the same reason `OverrideTask` is a deferred pass).
 */
interface InterfaceImplTask {
  /** The declaring member's local edge label (`Owner.member`) — see `localEdgeLabel`. */
  fqn: string
  /** The declaring type's FQN: the key `classHierarchy` records bases under. */
  ownerFqn: string
  memberName: string
  /** The interface the declaration WRITES (`void IFoo.M()`), else null (implicit form). */
  explicitIface: string | null
  /** The name node's line (the member contract's site convention, M59.A7); `undefined` is an
   *  honest no-line, never a fabricated 0. */
  line?: number
}

interface StackItem {
  node: Node
  parentContext?: Scope
  isExit?: boolean
}

// ≡ /^(if|for|foreach|while|do|switch|case|else|return|throw|using|new|delegate|in|is|as|sizeof|fixed|lock|checked|unchecked|params|ref|out|base|this|get|set)$/ (M49 closure wave: fixed set ≡ membership).
const CSHARP_KEYWORDS = new Set([
  "if", "for", "foreach", "while", "do", "switch", "case", "else", "return",
  "throw", "using", "new", "delegate", "in", "is", "as", "sizeof", "fixed",
  "lock", "checked", "unchecked", "params", "ref", "out", "base", "this",
  // CS-B2 (csharp review): `nameof(x)` parses as an invocation_expression
  // with an identifier callee — without this entry every nameof site
  // fabricated a `calls -> nameof` edge (probe-verified). `typeof`/`default`
  // never parse as invocations (dedicated nodes), so only nameof belongs.
  "get", "set", "nameof",
])

// ≡ /^(binary|conditional|prefix_unary|postfix_unary|cast|as_|await|coalesce|conditional_access|element_access|member_access)_expression$/
// (M49 closure wave): the fixed node-type set whose interior a target-less
// new() may sit in.
const CSHARP_TARGETISH_EXPRESSIONS = new Set([
  "binary_expression", "conditional_expression", "prefix_unary_expression",
  "postfix_unary_expression", "cast_expression", "as_expression",
  "await_expression", "coalesce_expression", "conditional_access_expression",
  "element_access_expression", "member_access_expression",
])

const CSHARP_BUILTINS = new Set([
  // Console output — filtered (like Java's System.out.println)
  "Console.WriteLine", "Console.Write", "Console.WriteAsync",
  "Console.Error.WriteLine", "Console.Error.Write", "Console.Error.WriteAsync",
  "Console.Out.WriteLine", "Console.Out.Write", "Console.Out.WriteAsync",
  // System-level noise
  "Environment.Exit", "Environment.GetEnvironmentVariable",
  "Environment.GetEnvironmentVariables", "Environment.SetEnvironmentVariable",
  "GC.Collect", "GC.SuppressFinalize", "GC.WaitForPendingFinalizers",
  "Debug.WriteLine", "Debug.Write", "Debug.Print",
  "Trace.WriteLine", "Trace.Write",
  // Object methods (C# equivalent of Java's Object methods)
  "ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals",
])

/**
 * The MODULE a `using` directive names — read from the GRAMMAR, by position, never from
 * the directive's text.
 *
 * ONE implementation, two consumers: the analyzer publishes `imports.module` and a
 * `references` edge from it, and the differential oracle derives the same target as truth.
 * This function is that one implementation, extracted so the two sides cannot drift — the
 * R9 round needed csharp's `references` label to become comparable (see the harness
 * allowlist), and a truth derived from a SECOND reading of the alias/plain shapes is
 * exactly how a lane ends up with edges the oracle cannot confirm.
 *
 * The shapes (M60.R1 paydown, probe script/m14/tmp/cs-using-tree-probe.ts, 8 cases):
 *
 *     alias form:  using [global] identifier[field=name] '=' <target> ';'
 *     plain form:  using [global] <target> ';'          (no `name` field)
 *
 * so the ALIAS is the `name` field (only when an `=` follows it) and the TARGET is the
 * first named child after the `=`, falling back to the directive's first name node. The
 * pre-R1 text parse published the ALIAS as the module for `using Alias = Plain;` — the
 * two positions have the same shape, so only position discriminates (CSD7).
 */
export function csharpUsingDirectiveTarget(
  node: any,
): { module: string; typeArguments: string[]; targetNode: any; alias: string | null } | null {
  if (!node) return null
  const firstNamed = (pred: (n: any) => boolean): any => {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && pred(c)) return c
    }
    return null
  }
  // C2a: `alias_qualified_name` is the node a `global::`-qualified name with a SINGLE segment
  // gets (the grammar only wraps it in a `qualified_name` when a dot follows the qualifier).
  // Omitting it made `using global::System;` publish NOTHING — no import, no references edge,
  // no `imports` payload — while `using System;` published all three (measured:
  // script/m14/tmp/cs-alias-position-battery4.ts).
  const nameNode = firstNamed((n: any) => n.type === "identifier" || n.type === "qualified_name" || n.type === "alias_qualified_name")
  if (!nameNode) return null
  let eq: any = null
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && c.type === "=") { eq = c; break }
  }
  const aliasNode = eq ? (node.childForFieldName?.("name") ?? null) : null
  let targetAfterEq: any = null
  if (eq) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.startIndex >= eq.endIndex) { targetAfterEq = c; break }
    }
  }
  const targetNode =
    targetAfterEq ??
    firstNamed((n: any) => n.type === "qualified_name" || n.type === "alias_qualified_name") ??
    nameNode
  // C2a: `using X = global::A.B;` / `using static global::A.B;` denote the same module as the
  // unqualified twins, and the twin publishes the full dotted path (measured side by side in
  // `script/m14/tmp/cs-alias-position-battery.ts`), so the qualifier is removed here — the one
  // point where a using directive's text becomes a module name. Shared with the oracle by
  // construction: the differential's csharp truth calls THIS function.
  const spelled = csharpTypeNameText(csharpTypeSpelling(String(targetNode?.text ?? "")))
  // D3 (2026-09-28, this round): a using ALIAS may name a TYPE, and a type is not always a
  // name. `using M = Dictionary<string, Widget>;` published `Dictionary<string,Widget>` — a
  // type EXPRESSION, with its type arguments welded on — as both the module and the
  // `references` target, and with a TUPLE argument it published the element NAMES too:
  //
  //   using PropertiesMap = ImmutableDictionary<(UnusedValuePreference preference,
  //                                               bool isUnusedLocalAssignment,
  //                                               bool isRemovableAssignment), …>;
  //   -> "ImmutableDictionary<(UnusedValuePreference preference,bool isUnusedLocalAssignment,
  //       bool isRemovableAssignment),…>"
  //
  // which is a target no source can ever name, in the one position where the file declares
  // what it imports. Every OTHER name position in this analyzer already strips the type
  // arguments through `csharpCleanTypeLeaf` (heritage, creation, target-typed `new()`, and
  // from this round the attribute payload), so this was the single place that did not.
  //
  // Stripping them is only half the fix: R9's own contract says "the argument is the real
  // dependency", so the arguments are NOT dropped — they are returned here, from the same
  // walk, and the caller publishes one `references` edge per argument beside the module
  // edge. Measured frequency (script/m14/tmp/cs-deep-12-frequencies.ts): 132 occurrences in
  // 116 of 1,500 roslyn files, 1 in 1,500 aspnetcore files.
  const module = csharpCleanTypeLeaf(spelled)
  if (!module) return null
  return {
    module,
    typeArguments: csharpTypeExpressionArguments(targetNode),
    targetNode,
    alias: aliasNode ? csharpTypeNameText(String(aliasNode.text ?? "")) : null,
  }
}

/**
 * D3: the TYPE NAMES a using directive's target expression carries beyond its base.
 *
 * Read from the tree, never from text: only a `generic_name` introduces arguments, the
 * wrappers that can wrap one are descended, a `tuple_type` yields each element's TYPE and
 * never its NAME, and every argument that is itself a type expression contributes its base
 * AND its own arguments (R9's rule, applied at argument depth). Each name is taken through
 * the same canonical-name rule the module uses, so `System.Text.StringBuilder` and
 * `StringBuilder` agree the way every other position in this analyzer agrees, and
 * predefined types (`string`, `int`) are silent — the grammar's own tag.
 *
 * Deduplicated: two arguments naming the same type are one dependency.
 */
function csharpTypeExpressionArguments(targetNode: any): string[] {
  if (!targetNode) return []
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string): void => {
    const name = csharpCleanTypeLeaf(csharpTypeNameText(csharpTypeSpelling(raw)))
    if (!name || name === "var" || name === "dynamic" || name === "nint" || name === "nuint") return
    if (seen.has(name)) return
    seen.add(name)
    out.push(name)
  }
  /**
   * One type ARGUMENT, as a list of names. An argument is itself a type expression, so
   * `List<Widget>` as an argument contributes BOTH `List` and `Widget` — the same
   * base-plus-arguments rule the declared-type graph uses (R9), which is why this
   * function is a walk and not a lookup. A tuple argument contributes each element's
   * TYPE and never its NAME; a predefined type contributes nothing (the grammar's own
   * tag, the documented silence).
   */
  const walkArgument = (n: any): void => {
    if (!n) return
    const t = n.type
    if (t === "predefined_type" || t === "implicit_type" || t === "void_keyword") return
    if (t === "identifier") { add(String(n.text ?? "")); return }
    if (t === "tuple_type") {
      for (const el of n.namedChildren ?? []) {
        if (el.type !== "tuple_element") continue
        walkArgument(el.childForFieldName?.("type") ?? el.namedChild(0))
      }
      return
    }
    if (t === "generic_name") {
      const base = n.namedChild(0)
      if (base) walkArgument(base)
      const args = (n.namedChildren ?? []).find((c: any) => c.type === "type_argument_list")
      if (args) for (const a of args.namedChildren ?? []) walkArgument(a)
      return
    }
    if (t === "qualified_name" || t === "alias_qualified_name") {
      // A qualified name is ONE name: publish its leaf and nothing else. If the leaf is
      // itself a `generic_name` its own arguments are this name's arguments, walked below.
      const leaf = csharpTypeLeafNode(n)
      if (leaf) {
        add(String(leaf.text ?? ""))
        const owner = n.namedChild(n.namedChildCount - 1)
        if (owner && owner.type === "generic_name") {
          const args = (owner.namedChildren ?? []).find((c: any) => c.type === "type_argument_list")
          if (args) for (const a of args.namedChildren ?? []) walkArgument(a)
        }
      }
      return
    }
    for (const c of n.namedChildren ?? []) walkArgument(c)
  }
  /**
   * The arguments the TARGET itself carries. Only a `generic_name` introduces
   * arguments; the wrappers that can wrap one (`array_type`, `pointer_type`,
   * `nullable_type`, `ref_type`, and the `qualified_name` whose last segment is the
   * `generic_name`) are descended, and a plain namespace path contributes none —
   * `using System.Text;` is a path, and its segments are not type arguments.
   */
  const collectFromTarget = (n: any): void => {
    if (!n) return
    const t = n.type
    if (t === "generic_name") {
      const args = (n.namedChildren ?? []).find((c: any) => c.type === "type_argument_list")
      if (args) for (const a of args.namedChildren ?? []) walkArgument(a)
      return
    }
    if (t === "qualified_name" || t === "alias_qualified_name") {
      const last = n.namedChild(n.namedChildCount - 1)
      if (last && last.type === "generic_name") collectFromTarget(last)
      return
    }
    if (t === "array_type" || t === "pointer_type" || t === "nullable_type" || t === "ref_type") {
      const inner = n.namedChild(0)
      if (inner) collectFromTarget(inner)
      return
    }
    if (t === "tuple_type") {
      for (const el of n.namedChildren ?? []) {
        if (el.type !== "tuple_element") continue
        collectFromTarget(el.childForFieldName?.("type") ?? el.namedChild(0))
      }
    }
  }
  collectFromTarget(targetNode)
  return out
}

/**
 * R9 (#804) — the declared-type reference graph: a declaration that WRITES a type
 * name depends on the type it names.
 *
 * WHY THIS IS A FAMILY CONTRACT AND NOT A FEATURE. rust's R13 header calls it one
 * ("family standard, mirrors go/c/zig"), and ten lanes implement it — go, rust, zig,
 * python, typescript, java, kotlin, scala, groovy and c (under the marker
 * `type_reference`). csharp did not, and nothing measured that: an ABSENT capability
 * emits no edge for any per-edge oracle to adjudicate, so it read clean in the line
 * contract, the depth draws and the fixtures alike. `reviews/csharp/master-review.md`
 * even records it, as a "recorded gap for its own wave". It is measured now, per lane,
 * by `script/m60/declared-type-refs-census.ts` under M60's rule R9.
 *
 * THE CONVENTIONS ARE INHERITED, NOT INVENTED (probe: script/m14/tmp/dt-contract-probe.ts,
 * which read the four decisions off the lanes that already implement the graph):
 *
 *   source    a FIELD's / property's dependency is attributed to the enclosing TYPE
 *             (`Holder`), a parameter's / return's / local's to the enclosing CALLABLE
 *             (`m`) — java, kotlin and python agree on this, and it is what makes the
 *             edge readable as "Holder depends on Dep".
 *   marker    `declared_type`, except a return type, which java/kotlin/python/typescript
 *             all publish as `return_type`. `declaredOn` carries the position, java's
 *             convention, spelled in C#'s own node names.
 *   generics  `List<Dep>` emits BOTH `List` and `Dep` (rust and java do; kotlin, python
 *             and typescript emit only the base and so lose the dependency that
 *             actually matters). The argument is the real dependency, so it is here.
 *   silent    `predefined_type` (`int`, `string`, `void`) — the grammar's own tag, the
 *             same exclusion java gets from its primitive_type; and `implicit_type`
 *             (`var`), which the grammar gives its own node so no name test is needed.
 *             `dynamic` / `nint` / `nuint` are language built-ins the grammar spells as
 *             plain identifiers, so they are excluded by name.
 *   leaf      a qualified name publishes its LEAF (`System.Text.StringBuilder` ->
 *             `StringBuilder`, the oracle's own leafOf convention), stamped at the token
 *             that writes it — so a wrapped `A.B\n  .C` reports C's line, not A's.
 *   bound     a name bound as a TYPE PARAMETER by an enclosing generic declaration is not
 *             a dependency — `class G<T> { List<T> _items; }` depends on `List`, not on `T`
 *             (rust's R13 rule: a bare `T` edge could never resolve to a symbol, because
 *             T exists only as a parameter). `where T : Dep` IS a real dependency and is a
 *             disclosed boundary below rather than a half-handled position.
 *   dedupe    per (source, target, LINE), not per (source, target): two fields of the
 *             same type are two mentions with two lines, and collapsing them would throw
 *             away the line the M59.A7 contract exists to check. (java keeps both too;
 *             rust collapses — the family diverges here and this is the more truthful
 *             reading.)
 *
 * BOUNDARIES, DISCLOSED. Positions NOT covered: `foreach`/`catch`/`using` declaration
 * headers, `using Alias = T;` directives, attribute argument types, and generic
 * CONSTRAINT clauses (`where T : Dep` — the R8 framework branch owns the where-clause
 * shape). Each is a real dependency position; each is unwritten rather than silently
 * approximated. A self-edge (`class Node { Node _next; }`) IS emitted, following rust's
 * `Selfish` precedent, and the fixture pins it so it cannot be dropped by accident.
 *
 * ONE COPY, TWO CONSUMERS. The analyzer emits these edges and the differential oracle
 * derives its truth from the SAME function, because a rule the truth does not share is a
 * rule that can drift (CSD14) — and the depth draws would then read every new edge as
 * analyzer-only.
 */
export interface CSharpDeclaredTypeRef {
  source: string
  target: string
  /** The M59.A7 (#825) line: where the TARGET name is written. */
  line: number | null
  relationshipType: "declared_type" | "return_type"
  declaredOn: string
}

/** Built-ins the grammar spells as ordinary identifiers, so no node type excludes them. */
const CSHARP_BUILTIN_TYPE_SPELLINGS = new Set(["dynamic", "nint", "nuint", "var"])

/** Callables whose name a parameter / return / local attributes its dependency to. */
const CSHARP_CALLABLE_DECLARATIONS = new Set([
  "method_declaration", "constructor_declaration", "delegate_declaration",
  "operator_declaration", "conversion_operator_declaration", "local_function_statement",
])

/** The type declarations a member's dependency is attributed to. */
const CSHARP_TYPE_DECLARATIONS = new Set([
  "class_declaration", "struct_declaration", "interface_declaration",
  "record_declaration", "enum_declaration",
])

/**
 * How csharp spells a type name where a name becomes an edge TARGET.
 *
 * The lane's contract is the FULL dotted path (`new System.Text.StringBuilder()` publishes
 * `System.Text.StringBuilder`, not `StringBuilder`), so a `global::`-qualified name must
 * publish the same path WITHOUT the qualifier. Otherwise one type has two spellings in the
 * graph depending on whether a source file happened to write the qualifier, which is the
 * exact class R10 exists to catch. Measured, not assumed —
 * `script/m14/tmp/cs-alias-qualifier-census.ts` over BOTH pinned corpora (all 76 files
 * containing `::`, 71,984 relationships): **51 targets carried the qualifier — 49
 * `instantiates`, 2 `extends`, 0 in any other position**; the side-by-side probe
 * (`script/m14/tmp/cs-alias-rule-probe.ts`) shows the unqualified twin publishing the same
 * path, which is what makes these two spellings one symbol.
 *
 * Grammar note: tree-sitter-c_sharp nests the alias INSIDE the qualified name —
 * `qualified_name text="global::System.Text.StringBuilder"` containing
 * `alias_qualified_name text="global::System"` — so the qualifier arrives as TEXT at the
 * publication site and has to be removed there; no node type distinguishes it.
 *
 * Char scan, not a regex (R1/R2, and the php/ruby precedent from this same program).
 * ONLY `global` is stripped: any other alias head (`Alias::X`) names a namespace bound by
 * a using-alias and cannot be dropped without resolving that binding, so it is published
 * as written — a ruled boundary with its measurement (that shape does not occur in either
 * pinned corpus), not an assumption.
 */
export function csharpTypeSpelling(text: string): string {
  const GLOBAL = "global"
  if (text.length <= GLOBAL.length + 2) return text
  for (let i = 0; i < GLOBAL.length; i++) {
    if (text.charCodeAt(i) !== GLOBAL.charCodeAt(i)) return text
  }
  const isWs = (c: number) => c === 32 || c === 9 || c === 10 || c === 13
  let i = GLOBAL.length
  while (i < text.length && isWs(text.charCodeAt(i))) i++
  // `::` — colon is char code 58.
  if (text.charCodeAt(i) !== 58 || text.charCodeAt(i + 1) !== 58) return text
  i += 2
  while (i < text.length && isWs(text.charCodeAt(i))) i++
  // Never return the empty string: a bare `global::` with nothing after it is malformed,
  // and publishing "" as a target is worse than publishing the text as written.
  return i < text.length ? text.slice(i) : text
}

/**
 * The kind of a type declaration the PINNED grammar produces.
 *
 * The grammar spells BOTH `record class Foo` and `record struct Foo` as
 * `record_declaration`: enumerating wasm/tree-sitter-c_sharp.wasm yields 533 node
 * types and **no `record_struct_declaration`** (the F1 audit convicts the spellings
 * that assumed otherwise, and this rule is the repayment). The two forms differ by
 * an UNNAMED TOKEN child — `*record("record") *class("class")` versus
 * `*record("record") *struct("struct")` (probe: script/m14/tmp/cs-record-struct-probe.ts)
 * — so the token decides. Neither the node type can answer this, nor the node's TEXT:
 * searching text would also fire on a member named `structThing`, which is the same
 * shape of mistake in the other direction.
 *
 * One definition, two callers (the symbol pass and the typeKinds pass), so the two
 * cannot drift apart.
 */
function csharpTypeDeclarationKind(node: Node): ASTEngine.SymbolKind | null {
  switch (node.type) {
    case "class_declaration":
      return ASTEngine.SymbolKind.Class
    case "record_declaration": {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && !c.isNamed && c.type === "struct") return ASTEngine.SymbolKind.Struct
      }
      return ASTEngine.SymbolKind.Class
    }
    case "struct_declaration":
      return ASTEngine.SymbolKind.Struct
    case "interface_declaration":
      return ASTEngine.SymbolKind.Interface
    case "enum_declaration":
      return ASTEngine.SymbolKind.Enum
    default:
      return null
  }
}

/** The leaf NODE of a type / namespace name — the token that writes the published name. */
function csharpTypeLeafNode(n: Node | null | undefined): Node | undefined {
  if (!n) return undefined
  const t = n.type
  if (t === "identifier") return n
  if (t === "generic_name" || t === "primary_constructor_base_type") return csharpTypeLeafNode(n.namedChild(0))
  if (t === "qualified_name" || t === "alias_qualified_name") return csharpTypeLeafNode(n.namedChild(n.namedChildCount - 1))
  return undefined
}

/**
 * Every NAMED type written inside one declared type, in source order.
 *
 * Wrappers are descended (`array_type`, `nullable_type`, `pointer_type`, `ref_type`,
 * `tuple_type`/`tuple_element`, `scoped_type`, function pointers); a `generic_name`
 * yields its base AND each type argument; a `qualified_name` yields one leaf name.
 *
 * D1 (2026-09-28, this round): a QUALIFIED name whose LAST SEGMENT is generic carries
 * its `type_argument_list` on that segment, and the leaf-only rule above walked straight
 * past it. tree-sitter-c-sharp spells
 *
 *     System.Collections.Generic.Dictionary<string, Widget>
 *     -> qualified_name [ qualified_name, ".", generic_name [ identifier, type_argument_list ] ]
 *
 * so the leaf descent reached the `identifier` inside the `generic_name`, published
 * `Dictionary`, and returned — while the PLAIN twin
 *
 *     Dictionary<string, Widget>
 *     -> generic_name [ identifier, type_argument_list ]
 *
 * took the branch below and published `Widget` as well. One type, two spellings, TWO
 * DIFFERENT DEPENDENCY SETS: the qualified spelling silently dropped every type
 * argument, which is the dependency R9's own contract calls "the real dependency" (see
 * this round's header). Measured with script/m14/tmp/cs-deep-8-declared-type-rootcause.ts
 * (the trees) and script/m14/tmp/cs-deep-11-qualified-generic-probe.ts (all ten
 * spellings side by side); frequency over 1,500 roslyn files: 39 occurrences in 12
 * files, against 3,033 plain occurrences in 725 — the shape is REAL and RARE, which is
 * exactly the combination that survives five depth draws (the trap #804's record names
 * for `record struct`). So the arguments are walked here, on the qualified path, by the
 * SAME `type_argument_list` lookup the working branch uses — one rule, not two.
 */
function csharpDeclaredTypeLeaves(
  typeRoot: Node | null | undefined,
  isBoundTypeParameter: (node: Node, name: string) => boolean,
): { node: Node; name: string }[] {
  const acc: { node: Node; name: string }[] = []
  const accept = (node: Node, raw: string): void => {
    const name = raw.trim()
    if (!name || CSHARP_BUILTIN_TYPE_SPELLINGS.has(name)) return
    if (isBoundTypeParameter(node, name)) return
    acc.push({ node, name })
  }
  const walk = (n: Node | null | undefined): void => {
    if (!n) return
    const t = n.type
    if (t === "predefined_type" || t === "implicit_type" || t === "void_keyword") return
    if (t === "identifier") {
      accept(n, String(n.text ?? ""))
      return
    }
    if (t === "qualified_name" || t === "alias_qualified_name") {
      const leaf = csharpTypeLeafNode(n)
      if (leaf) accept(leaf, String(leaf.text ?? ""))
      // D1: the path's LAST SEGMENT may be the `generic_name` that owns the type
      // arguments. Walking them is the same rule the `generic_name` branch applies, and
      // it is the only difference between the two spellings of one type.
      const lastSegment = n.namedChild(n.namedChildCount - 1)
      if (lastSegment && lastSegment.type === "generic_name") {
        const args = (lastSegment.namedChildren as Node[]).find((c) => c.type === "type_argument_list")
        if (args) for (const a of args.namedChildren as Node[]) walk(a)
      }
      return
    }
    if (t === "generic_name" || t === "primary_constructor_base_type") {
      walk(n.namedChild(0))
      const args = (n.namedChildren as Node[]).find((c) => c.type === "type_argument_list")
      if (args) for (const a of args.namedChildren as Node[]) walk(a)
      return
    }
    if (t === "tuple_element") {
      // A tuple element holds a TYPE child AND a NAME child (`(Dep First, int Count)`):
      // descending into both publishes the element's name as a type — the CSD14
      // fabrication class, caught here by this fixture's own measurement.
      walk(n.childForFieldName("type") ?? n.namedChild(0))
      return
    }
    for (const c of n.namedChildren as Node[]) walk(c)
  }
  walk(typeRoot)
  return acc
}

/**
 * R9 (#804): the declared-type reference graph of one parsed C# file.
 *
 * Called by the analyzer (which emits these as `references` edges, stamped
 * `declared_type` / `return_type`) and by the differential oracle (which derives its
 * truth from the same list). Positions, source naming, the two markers, the leaf rule
 * and the dedupe key are all documented on this section's header.
 */
export function csharpDeclaredTypeRefs(root: Node): CSharpDeclaredTypeRef[] {
  const out: CSharpDeclaredTypeRef[] = []
  const emitted = new Set<string>()

  /**
   * Is this name a TYPE PARAMETER bound by an enclosing generic declaration?
   *
   * Climbed from the mention through EVERY enclosing declaration that can bind type
   * parameters, reading each `type_parameter_list` — rust's `genericParamsOf` idea,
   * widened to match C#'s lexical binding: `class G<T> { List<T> x; void m() { List<T> y; } }`
   * depends on List in both places, and `T` is a parameter of G, so an edge to it would
   * name a symbol only that declaration has. A method's own `<U>` is read the same way,
   * which is why the fixture pins both spellings.
   */
  const isBoundTypeParameter = (from: Node, name: string): boolean => {
    let cur: Node | null = from
    while (cur) {
      if (
        cur.type === "class_declaration" || cur.type === "struct_declaration" ||
        cur.type === "interface_declaration" || cur.type === "record_declaration" ||
        cur.type === "method_declaration" ||
        cur.type === "delegate_declaration" || cur.type === "local_function_statement" ||
        cur.type === "operator_declaration" || cur.type === "conversion_operator_declaration"
      ) {
        const tp = cur.childForFieldName("type_parameters") ??
          (cur.namedChildren as Node[]).find((c) => c.type === "type_parameter_list")
        if (tp) {
          const w: Node[] = [tp]
          while (w.length > 0) {
            const m = w.pop()!
            if ((m.type === "type_parameter" || m.type === "identifier") && m.text.trim() === name) return true
            for (const c of m.namedChildren as Node[]) w.push(c)
          }
        }
        // NO break: C# type parameters are LEXICALLY scoped, so every enclosing
        // generic declaration binds its own parameters. Stopping at the first item
        // (rust's shape) missed the case this fixture's own measurement caught — a
        // class-level `T` used inside a non-generic method body, which reads
        // `List<T>` and would otherwise publish a dependency on `T`.
      }
      cur = cur.parent
    }
    return false
  }

  const enclosing = (from: Node, kinds: Set<string>): string => {
    let cur: Node | null = from.parent
    while (cur) {
      if (kinds.has(cur.type)) {
        const nm = cur.childForFieldName("name")?.text
        if (nm) return nm
        // A nameless callable (an indexer) still owns its declarations; the
        // enclosing TYPE is the honest attribution rather than an empty source.
      }
      cur = cur.parent
    }
    return ""
  }

  const push = (
    source: string,
    typeNode: Node | null | undefined,
    relationshipType: "declared_type" | "return_type",
    declaredOn: string,
  ): void => {
    if (!source || !typeNode) return
    for (const leaf of csharpDeclaredTypeLeaves(typeNode, isBoundTypeParameter)) {
      const line = leaf.node.startPosition.row + 1
      const key = `${source}\u0000${leaf.name}\u0000${line}`
      if (emitted.has(key)) continue
      emitted.add(key)
      out.push({ source, target: leaf.name, line, relationshipType, declaredOn })
    }
  }

  /** The node that CARRIES a declaration's written type — the `type` field when the
   *  grammar gives one (parameters, properties, indexers, variable declarations), else
   *  the first type-ish child (a `field_declaration` holds a `variable_declaration`, and
   *  a method's return type is a bare child). */
  const typeRootOf = (n: Node | null | undefined): Node | null => {
    if (!n) return null
    const tf = n.childForFieldName("type")
    if (tf) return tf
    if (n.type === "field_declaration" || n.type === "event_field_declaration") {
      const vd = (n.namedChildren as Node[]).find((c) => c.type === "variable_declaration")
      return vd ? typeRootOf(vd) : null
    }
    return null
  }

  /** A callable's return type: the `type` field when the grammar has one, else the
   *  first type-ish child that is not the declaration's own NAME (the method return
   *  type is a bare `identifier` child, and treating the name as a type is exactly
   *  the CSD14 self-target fabrication). */
  const returnTypeNode = (n: Node): Node | null => {
    const tf = n.childForFieldName("type")
    if (tf) return tf
    const nameChild = n.childForFieldName("name")
    for (const c of n.namedChildren as Node[]) {
      if (
        c.type === "modifier" || c.type === "attribute_list" || c.type === "parameter_list" ||
        c.type === "type_parameter_list" || c.type === "block" || c.type === "arrow_expression_clause" ||
        c.type === "where_clause" || c.type === "constructor_initializer" || c.type === "type_parameter_constraints_clause"
      ) continue
      if (nameChild && c.startIndex === nameChild.startIndex && c.endIndex === nameChild.endIndex) continue
      if (CSHARP_DECLARED_TYPE_NODES.has(c.type)) return c
    }
    return null
  }

  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    switch (n.type) {
      case "field_declaration":
      case "event_field_declaration": {
        const vd = (n.namedChildren as Node[]).find((c) => c.type === "variable_declaration")
        push(enclosing(n, CSHARP_TYPE_DECLARATIONS), typeRootOf(vd), "declared_type", n.type)
        break
      }
      case "property_declaration":
      case "indexer_declaration":
      case "event_declaration": {
        push(enclosing(n, CSHARP_TYPE_DECLARATIONS), typeRootOf(n), "declared_type", n.type)
        break
      }
      case "method_declaration":
      case "delegate_declaration":
      case "operator_declaration":
      case "conversion_operator_declaration": {
        // The return type belongs to the callable itself (java/kotlin/python all
        // attribute it to `m`), so the owner is the declaration, falling back to
        // the enclosing type for a nameless one.
        const owner = n.childForFieldName("name")?.text ?? enclosing(n, CSHARP_TYPE_DECLARATIONS)
        push(owner, returnTypeNode(n), "return_type", "return_type")
        break
      }
      case "parameter": {
        push(enclosing(n, CSHARP_CALLABLE_DECLARATIONS), typeRootOf(n), "declared_type", "parameter")
        break
      }
      case "variable_declaration": {
        // A LOCAL declaration. Fields and event fields are the parents' business, so
        // only the local_declaration_statement form is claimed here; a bare
        // variable_declaration elsewhere (a `for` initializer, a `using`) is a
        // disclosed boundary rather than a half-handled position.
        if (n.parent?.type === "local_declaration_statement") {
          push(
            enclosing(n, CSHARP_CALLABLE_DECLARATIONS),
            typeRootOf(n),
            "declared_type",
            "local_declaration_statement",
          )
        }
        break
      }
    }
    for (const c of n.namedChildren as Node[]) stack.push(c)
  }
  return out
}

export class RealCSharpAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    const classHierarchy = new Map<string, string[]>()
    const overrideTasks: OverrideTask[] = []
    // C923 (#923): member-level interface implementation. `interfaceTasks` holds the
    // IMPLEMENTING declarations, `interfaceMembers` the CONTRACT each in-file interface declares
    // (keyed by both its FQN and its local name, so a base list written either way resolves).
    const interfaceTasks: InterfaceImplTask[] = []
    const interfaceMembers = new Map<string, Set<string>>()
    // C923 (#923): the member names each in-file CLASS declares, so the implicit resolution can
    // stop at a base class that already fills the interface slot (C#: a derived member hidden
    // with `new` — or redeclared without it — does NOT become the interface implementation; the
    // base class's member already is. Continuing through it would publish a fabricated edge).
    const classMembers = new Map<string, Set<string>>()
    // In-file declared type name -> kind. Built in a pre-pass so base-list
    // kind resolution works regardless of declaration order (C# allows a
    // class to implement an interface declared later in the same file).
    const typeKinds = new Map<string, string>()
    this.collectDeclaredTypeKinds(rootNode, typeKinds)
    // CSD11 (re-review 2026-09-04): field/property declarator name -> declared
    // type, built in the pre-pass so assignment-form target-typed `new()`
    // (`_items = new();` in a constructor) can resolve through the assignment
    // LHS regardless of declaration order.
    const memberTypes = new Map<string, string>()
    // M59.A7 (#825): the declared-type NODE per member name. A target-typed
    // `new()` resolves its target through this table (CSD14's assignment form),
    // so the table has to carry the node and not only the text — otherwise the
    // only claimable line would be the assignment's, where the target name is
    // not written at all.
    const memberTypeNodes = new Map<string, Node>()
    this.collectMemberTypes(rootNode, memberTypes, memberTypeNodes)

    const scopeStack: Scope[] = []
    // File-scoped namespaces (C# 10: `namespace A.B;`) apply to every type
    // declared after them in the file — the type declarations are SIBLINGS of
    // the namespace node, so the namespace scope is tracked here instead of
    // the scope stack (which only handles true lexical nesting).
    let fileScopedNamespace: Scope | undefined = undefined
    const stack: StackItem[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, parentContext, isExit } = item

      if (isExit) {
        if (parentContext) {
          if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === parentContext) {
            scopeStack.pop()
          }
        }
        continue
      }

      if (node.isMissing || node.hasError) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({
            message: `Syntax ${node.type} detected.`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let newContext = parentContext
      const type = node.type
      let pushedScope = false

      // Cyclomatic complexity
      const complexityNodes = new Set([
        "if_statement", "for_statement", "foreach_statement", "while_statement",
        // CS-B3 (csharp review): BOTH catch forms parse as `catch_clause`
        // (which CONTAINS an optional `catch_declaration`) — counting the
        // inner declaration counted typed catches but never bare `catch { }`.
        // Count the clause instead (exactly once either way); matches
        // swift's catch_block.
        "case_switch_label", "catch_clause", "conditional_expression",
        "logical_and_expression", "logical_or_expression",
        // CSD2 (re-review 2026-09-04, probe): switch EXPRESSION arms are
        // decision points exactly like case labels — a 3-arm switch
        // expression measured complexity 1 (its legacy statement twin
        // counted every case_switch_label). 42 arms in the first 400 corpus
        // files were systematically undercounted.
        "switch_expression_arm",
      ])
      if (complexityNodes.has(type)) cyclomaticComplexity++

      // tree-sitter-c_sharp has no `using_static_directive` node type — `using
      // static X.Y` parses as a `using_directive` with a `name_modifier`/modifier
      // child (deep-review csharp #264). The old `using_static_directive` literal
      // was a dead branch (grammar drift) and is removed.
      if (type === "using_directive") {
        const nameNode =
          this.findChild(node, (n) =>
            n.type === "identifier" || n.type === "qualified_name" || n.type === "alias_qualified_name",
          )
        if (nameNode) {
          // CSD7 (re-review 2026-09-04): alias usings (`using A = B.C;`) parse
          // with the alias identifier BEFORE the target, so the old
          // first-identifier match captured the ALIAS as the module. Prefer the
          // qualified_name target; fall back to identifier (plain usings have no
          // qualified child only when they are a single identifier).
          // `global::X.Y` is captured raw (honest full path).
          //
          // M60.R1 paydown (csharp lane, 2026-09-22): the target and the alias are
          // now read from the GRAMMAR, not from the directive's text. The tree
          // (probe: script/m14/tmp/cs-using-tree-probe.ts, 8 shapes) is
          //   alias form:  using [global] identifier[field=name] '=' <target> ';'
          //   plain form:  using [global] <target> ';'          (no `name` field)
          // so the ALIAS is the `name` field and the TARGET is the first named
          // child AFTER the anonymous `=`. The old `/using\s+([\w.]+)\s*=/` was
          // not only a regex: it was also WRONG in both directions, measured with
          // script/m14/tmp/cs-using-alias-probe.ts — best-vs-target extraction
          // cannot be repaired textually, because the two positions are the same
          // shape. `using Alias = Plain;` (bare-identifier target) published
          // `module: "Alias"`: the ALIAS as the module, with the real target named
          // NOWHERE in the payload and the dependency edge pointing at a name the
          // file never imports a namespace from. Position is the only honest
          // discriminator, and the tree already has it.
          // The alias/target shapes are read by ONE extracted function, because the
          // differential oracle now derives the same target as truth (R9: csharp's
          // `references` label is comparable, so the using references must be
          // confirmable) — a second reading here would be free to drift from it.
          const usingTarget = csharpUsingDirectiveTarget(node)
          if (!usingTarget) continue
          const { module: text, typeArguments, targetNode: nameNode2, alias: usingAlias } = usingTarget
          imports.push({
            module: text,
            source: text,
            imported: [],
            range: this.nodeToRange(node),
            isTypeOnly: false,
          })
          relationships.push({
            source: "root",
            target: text,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            // M59.A7 (#825): the line of the node that NAMES the target — the
            // qualified_name / identifier the using directive writes, which for
            // the alias form (`using A = B.C;`) is the TARGET, never the alias.
            // `nodeNamingToken` descends to the last segment's own node, so a
            // WRAPPED qualified name stamps the line its leaf is written on
            // rather than the line the name starts on.
            line_number: this.nodeLine(this.nodeNamingToken(nameNode2, text) ?? nameNode2),
            // isImport (family contract — c/go emit import deps with isImport)
            // lets the completeness section-B `imports` pin and the tier
            // classifier mark this import_based.
            metadata: {
              isUsingDirective: true,
              isImport: true,
              ...(usingAlias ? { isUsingAlias: true, usingAlias } : {}),
            },
          })
          // D3 (2026-09-28, this round): a using ALIAS may name a generic TYPE, and the type
          // ARGUMENTS are the dependencies the import itself no longer carries (the module
          // edge publishes the base name, because a module must be a name — see
          // csharpUsingDirectiveTarget). So each argument gets its own `references` edge from
          // the same source, marked `using_type_argument` so the two roles stay
          // distinguishable in the payload.
          //
          // The metadata deliberately carries NEITHER `isImport` NOR `isUsingDirective`, and
          // that is load-bearing rather than an omission: `classifyEvidenceTier` keys
          // `reference_qualified` on exactly `!(isUsingDirective || isImport)`, so copying
          // the module edge's flags would stamp an argument — which is a TYPE reference, not
          // a namespace import — with the import evidence class. The oracle derives these
          // from the same function, so the differential compares them rather than reporting
          // them as fabrication.
          for (const arg of typeArguments) {
            if (arg === text) continue
            relationships.push({
              source: "root",
              target: arg,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              line_number: this.nodeLine(this.nodeNamingToken(nameNode2, arg) ?? nameNode2),
              metadata: { relationshipType: "using_type_argument" },
            })
          }
        }
      }

        if (type === "namespace_declaration") {
        // CSD10 (re-review 2026-09-04, fixture-probe): a NEW namespace scope
        // must replace a surviving file-scoped one (the CSD1 push has no exit
        // item, so it would outlive its own file-section in multi-namespace
        // files), otherwise `namespace A; ... namespace B { class T }` nests
        // to A.B.T. Runs ONLY at namespace nodes — never at siblings.
        if (fileScopedNamespace) {
          const fi = scopeStack.indexOf(fileScopedNamespace)
          if (fi >= 0) scopeStack.splice(fi, 1)
          fileScopedNamespace = undefined
        }
        const rawName = this.extractNamespaceName(node)
        const fullName = this.buildFullName(scopeStack, rawName)
        symbols.push({
          name: rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCSharpNamespace: true, fullName },
        })
        newContext = {
          node,
          name: rawName,
          rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          fqn: fullName,
          visibility: "public",
          isInterface: false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "file_scoped_namespace_declaration") {
        // CSD10: same replacement rule when a SECOND file-scoped section
        // starts (multi-section files).
        if (fileScopedNamespace) {
          const fi = scopeStack.indexOf(fileScopedNamespace)
          if (fi >= 0) scopeStack.splice(fi, 1)
          fileScopedNamespace = undefined
        }
        const rawName = this.extractNamespaceName(node)
        const fullName = this.buildFullName(scopeStack, rawName)
        symbols.push({
          name: rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCSharpNamespace: true, fullName, isFileScoped: true },
        })
        // File-scoped namespace: applies to all following sibling declarations.
        fileScopedNamespace = {
          node,
          name: rawName,
          rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          fqn: fullName,
          visibility: "public",
          isInterface: false,
          parents: [],
        }
        // CSD1 (re-review 2026-09-04, probe on real powershell file-scoped
        // file): the scope was tracked ONLY in the side variable and never
        // pushed, so buildFullName produced BARE type fullNames (and the
        // oracle/harness cross-file companions keyed by fullName desynced
        // from block-namespace files in the same corpus). Push the scope
        // WITHOUT an exit item: a file-scoped namespace has no closing
        // brace — its scope must survive its own subtree exit and cover the
        // SIBLING type declarations that follow it in the file (an exit item
        // pops it before the siblings are visited; probe-verified).
        newContext = fileScopedNamespace
        scopeStack.push(newContext)
        pushedScope = false
      } else if (
        type === "class_declaration" ||
        type === "struct_declaration" ||
        type === "interface_declaration" ||
        type === "record_declaration"
      ) {
        let rawName = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"

        const fullName = this.buildFullName(scopeStack, rawName)
        const isInterface = type === "interface_declaration"
        const kind = csharpTypeDeclarationKind(node) ?? ASTEngine.SymbolKind.Class

        const visibility = this.extractVisibility(node)
        typeKinds.set(rawName, kind)
        // The owner of a top-level type: a file-scoped namespace if one is in
        // effect (its scope is lexical-file-wide, not a tree ancestor), else
        // the enclosing block namespace (a true tree ancestor).
        const ownerScope =
          parentContext?.kind === ASTEngine.SymbolKind.Namespace
            ? parentContext
            : fileScopedNamespace && !parentContext
              ? fileScopedNamespace
              : undefined

        // Base list: C# has no keyword distinction. Resolve each base type's
        // kind: in-file declarations first, then the cross-file type-kind
        // companion; unknown external types use the deterministic language
        // rule (first base = extends, rest = implements; interfaces: all
        // bases are extends).
        const parents: string[] = []
        const baseList = this.findChild(node, "base_list")
        if (baseList) {
          const baseTypes: string[] = []
          // M59.A7 (#825): the base type's OWN node, in lockstep with the name —
          // a wrapped base list (`class D :` / `  Base`) writes `Base` on a
          // different line than the `:`, so the base_list node would stamp the
          // wrong one. `null` is an honest no-line.
          const baseNodes: Array<Node | null> = []
          for (let i = 0; i < baseList.namedChildCount; i++) {
            const baseType = baseList.namedChild(i)
            if (!baseType) continue
            // CSD9 (re-review 2026-09-04, fixture-probe): two primary-base
            // shapes carry ARGUMENT LISTS that fabricated garbage targets:
            // records parse as primary_constructor_base_type (type name is
            // the identifier child); CLASSES with primary bases parse as a
            // bare identifier FOLLOWED BY a sibling argument_list inside the
            // base_list (the argument_list is not a base type — skip it).
            if (baseType.type === "primary_constructor_base_type") {
              const tn = this.findChild(baseType, (n) => n.type === "identifier" || n.type === "generic_name")
              if (tn) {
                baseTypes.push(this.cleanTypeName(tn.text))
                baseNodes.push(tn)
              }
              continue
            }
            if (baseType.type === "argument_list") continue
            // M59.A7 (#825): canonical text (a wrapped qualified base carries a
            // newline in its raw text — see csharpTypeNameText).
            baseTypes.push(this.cleanTypeName(csharpTypeNameText(baseType.text)))
            baseNodes.push(baseType)
          }
          if (isInterface) {
            // All base types of an interface are extended interfaces.
            for (let i = 0; i < baseTypes.length; i++) {
              const b = baseTypes[i]
              parents.push(b)
              relationships.push({
                source: this.declarationPath(scopeStack, rawName),
                target: b,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                line_number: this.nodeLine(this.nodeNamingToken(baseNodes[i], b) ?? baseNodes[i]),
                metadata: { isInterfaceBase: true },
              })
            }
          } else {
            const crossFileKinds = context?.typeKinds as Map<string, string> | undefined
            for (let i = 0; i < baseTypes.length; i++) {
              const b = baseTypes[i]
              parents.push(b)
              // Resolve the declared kind: exact in-file name, then exact
              // cross-file companion name, then qualified-name leaf (a nested
              // type like BaseService.Entity is keyed by its leaf Entity in
              // both the in-file map and the companion).
              const dotIdx = b.lastIndexOf(".")
              const leaf = dotIdx > 0 ? b.slice(dotIdx + 1) : b
              const declaredKind =
                typeKinds.get(b) || crossFileKinds?.get(b) ||
                typeKinds.get(leaf) || crossFileKinds?.get(leaf)
              // Unknown externals follow the deterministic C# rule: the base
              // class, if any, is listed first and the rest are interfaces.
              // CSD12 (re-review 2026-09-04): interface-only base lists are
              // among the most common C# shapes (66 of ~400 powershell files
              // carry one) and an unknown EXTERNAL index-0 entry there is
              // conventionally an interface — `class Job : IDisposable` must
              // emit implements, not a fabricated extends. An I-prefixed
              // PascalCase name (I + uppercase, length > 2 so Icon/IntPtr
              // never match) is the convention signal; declared kinds still
              // win, non-I names keep the first-base rule. Structs/record
              // structs can NEVER inherit (C#): every base of a struct is an
              // interface regardless of naming.
              const isStruct = kind === ASTEngine.SymbolKind.Struct
              // ≡ /^[I][A-Z]/ — "I" followed by an uppercase letter
              // (IInterface shape heuristic; length guard stays external).
              const looksLikeInterface = !declaredKind && (isStruct || (i === 0 && leaf.charCodeAt(0) === 73 && leaf.charCodeAt(1) >= 65 && leaf.charCodeAt(1) <= 90 && leaf.length > 2))
              const isImplements = declaredKind === ASTEngine.SymbolKind.Interface || looksLikeInterface || (i > 0 && !declaredKind)
              relationships.push({
                source: this.declarationPath(scopeStack, rawName),
                target: b,
                type: isImplements ? ASTEngine.RelationshipType.Implements : ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                // the leaf's own node: a wrapped qualified base writes its last
                // segment on a different line than the name starts on
                line_number: this.nodeLine(this.nodeNamingToken(baseNodes[i], b) ?? baseNodes[i]),
                metadata: { isImplements },
              })
            }
          }
        }
        classHierarchy.set(fullName, parents)
        // C923 (#923): ALSO key the raw name. A base list writes the type as the source spells it
        // (`class C : IThingEx`), while this map is keyed by FQN — so an INTERFACE's own base list
        // (`interface IThingEx : IThing`) was unreachable from its implementors, and the member
        // contract could not see the chained contract at all (measured on the C923 fixture:
        // `Chain.GetName -> IThing.GetName` was missing while `Chain.Extra` was present).
        // Set only when free, so a bare name can never shadow a real FQN key.
        if (rawName !== fullName && !classHierarchy.has(rawName)) classHierarchy.set(rawName, parents)

        // Generic type parameters (no symbols — suppressed like Java)
        const typeParamsNode = this.findChild(node, "type_parameter_list")
        const genericTypes: string[] = []
        if (typeParamsNode) {
          for (let i = 0; i < typeParamsNode.namedChildCount; i++) {
            const child = typeParamsNode.namedChild(i)
            if (child) genericTypes.push(child.text)
          }
        }

        // Record positional properties (Roslyn: record params are properties)
        const isRecord = stringIncludes(type, "record")
        const paramList = this.findChild(node, "parameter_list")
        if (isRecord && paramList) {
          for (let i = 0; i < paramList.namedChildCount; i++) {
            const p = paramList.namedChild(i)
            if (p && p.type === "parameter") {
              const pName = p.childForFieldName("name")?.text || this.childText(p, "identifier") || "anonymous"
              const pType = this.extractTypeString(p)
              symbols.push({
                name: pName,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(p),
                visibility: "public",
                ownerName: rawName,
                ownerKind: kind,
                metadata: { hasGet: true, hasInit: true, dataType: pType, isRecordProperty: true },
              })
            }
          }
        }

        const sym: ASTEngine.UniversalSymbol = {
          name: rawName,
          kind,
          range: this.nodeToRange(node),
          visibility,
          ownerName: ownerScope ? ownerScope.rawName : parentContext?.rawName,
          ownerKind: ownerScope ? ownerScope.kind : parentContext?.kind,
          decorators: this.extractAttributes(node),
          metadata: {
            isCSharpType: true,
            isStruct: kind === ASTEngine.SymbolKind.Struct,
            isValueType: kind === ASTEngine.SymbolKind.Struct,
            isRecord,
            genericTypes: genericTypes.length > 0 ? genericTypes : undefined,
            fullName,
            isInterface,
          },
        }
        symbols.push(sym)
        // M49 exports invariant: only NAMESPACE-free top-level types export
        // (a type inside `namespace Acme.Things` is imported as
        // Acme.Things.Widget, not bare Widget — the namespace is the unit
        // the using-directive binds). The pre-fix push exported
        // namespace-nested types under bare names, which the F3 gate
        // correctly rejects as unresolvable; membership rides Contains.
        // CS-B4: `file`-scoped types never export (file-only visibility).
        if (!parentContext && !this.hasModifier(node, "file")) {
          exports.push({ name: sym.name, kind: sym.kind, range: sym.range, visibility: visibility || "public" })
        }
        newContext = {
          node,
          name: fullName,
          rawName,
          kind,
          fqn: fullName,
          visibility,
          symbolRef: sym,
          isInterface,
          parents,
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "enum_declaration") {
        const rawName = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const fullName = this.buildFullName(scopeStack, rawName)
        const visibility = this.extractVisibility(node)
        typeKinds.set(rawName, ASTEngine.SymbolKind.Enum)
        const ownerScope =
          parentContext?.kind === ASTEngine.SymbolKind.Namespace
            ? parentContext
            : fileScopedNamespace && !parentContext
              ? fileScopedNamespace
              : undefined

        let baseType: string | undefined
        const baseList = this.findChild(node, "base_list")
        if (baseList) baseType = baseList.namedChild(0)?.text

        symbols.push({
          name: rawName,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility,
          ownerName: ownerScope ? ownerScope.rawName : parentContext?.rawName,
          ownerKind: ownerScope ? ownerScope.kind : parentContext?.kind,
          decorators: this.extractAttributes(node),
          metadata: { isEnum: true, baseType, fullName },
        })
        // M49 exports invariant: same namespace-nesting rule as the class
        // branch above — only namespace-free top-level enums export.
        if (!parentContext) {
          exports.push({ name: rawName, kind: ASTEngine.SymbolKind.Enum, range: this.nodeToRange(node), visibility: visibility || "public" })
        }
        newContext = {
          node,
          name: rawName,
          rawName,
          kind: ASTEngine.SymbolKind.Enum,
          fqn: fullName,
          visibility,
          isInterface: false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "enum_member_declaration") {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.EnumMember,
          range: this.nodeToRange(node),
          visibility: "public",
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          metadata: {},
        })
      } else if (type === "delegate_declaration") {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const returnType = node.childForFieldName("type")?.text || "void"
        const parameters: ASTEngine.Parameter[] = []
        const paramList = this.findChild(node, "parameter_list")
        if (paramList) {
          for (let i = 0; i < paramList.namedChildCount; i++) {
            const parameter = paramList.namedChild(i)
            if (parameter?.type !== "parameter") continue
            const parameterName = parameter.childForFieldName("name")?.text || "anonymous"
            parameters.push({ name: parameterName, type: parameter.childForFieldName("type")?.text })
          }
        }
        const visibility = this.extractVisibility(node)
        const ownerScope =
          parentContext?.kind === ASTEngine.SymbolKind.Namespace
            ? parentContext
            : fileScopedNamespace && !parentContext
              ? fileScopedNamespace
              : undefined
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Delegate,
          range: this.nodeToRange(node),
          visibility,
          ownerName: ownerScope ? ownerScope.rawName : parentContext?.rawName,
          ownerKind: ownerScope ? ownerScope.kind : parentContext?.kind,
          parameters,
          returnType,
          decorators: this.extractAttributes(node),
          metadata: { isDelegate: true, returnType },
        })
      } else if (type === "event_field_declaration") {
        const varDecl = this.findChild(node, "variable_declaration")
        const visibility = this.extractVisibility(node)
        if (varDecl) {
          for (let i = 0; i < varDecl.namedChildCount; i++) {
            const child = varDecl.namedChild(i)
            if (child && child.type === "variable_declarator") {
              const name = this.childText(child, "identifier") || "anonymous"
              // C923 (#923): a field-like event satisfies an interface event by the same rule.
              this.collectMemberContract(
                node,
                name,
                parentContext,
                parentContext ? parentContext.fqn : "",
                parentContext ? `${parentContext.rawName}.${name}` : name,
                interfaceTasks,
                interfaceMembers,
                classMembers,
                this.findChild(child, (n) => n.type === "identifier") ?? undefined,
              )
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Event,
                range: this.nodeToRange(node),
                visibility,
                ownerName: parentContext?.rawName,
                ownerKind: parentContext?.kind,
                decorators: this.extractAttributes(node),
                metadata: { isEvent: true },
              })
            }
          }
        }
      } else if (type === "operator_declaration" || type === "conversion_operator_declaration") {
        // CSD3 (re-review 2026-09-04): every overload collapsed into a symbol
        // literally named "operator" — `operator +` and `operator ==` were
        // indistinguishable (haskell/ruby name operators by identity). Per-symbol
        // complexity added (was always missing here).
        //
        // M60.R1 paydown (csharp lane, 2026-09-22): the identity is read from the
        // GRAMMAR now, not from the declaration text. Probe
        // (script/m14/tmp/cs-operator-grammar-probe.ts, 7 shapes): an
        // `operator_declaration` carries the operator token as an ANONYMOUS child
        // with the FIELD `operator` (`+`, `==`, `true`, `=>`), with `checked` as a
        // separate anonymous sibling; a `conversion_operator_declaration` carries
        // the target in the FIELD `type` and `implicit`/`explicit` as an anonymous
        // child. So `no AST path` — the claim the regex was carrying — was FALSE:
        // both rails exist. The regexes were also structurally wrong in a way text
        // cannot fix (`[^\s(]+` stops at the first `(`, so any target written with
        // a SPACE before the parenthesis is truncated). The field text is used
        // verbatim, so the published names are unchanged for every shape the old
        // regex got right — pinned by the pre-existing operator fixture entries and
        // the operator-name-collapse mutant.
        const opField = node.childForFieldName("operator")
        const convTargetNode = type === "conversion_operator_declaration" ? node.childForFieldName("type") : null
        const modifierKeyword = this.anonymousChildNode(node, "implicit") ?? this.anonymousChildNode(node, "explicit")
        const checkedKeyword = this.anonymousChildNode(node, "checked")
        // C2a: the conversion target is a TYPE NAME in a symbol name, so the alias qualifier
        // is not part of it — measured side by side in
        // `script/m14/tmp/cs-alias-position-battery2.ts`: `implicit operator PlainBase` and
        // `implicit operator global::Probe.PlainBase` published two names for one operator
        // shape (the qualified one was the only position that survived cleanTypeName, because
        // a symbol name never passes through it).
        const opName = modifierKeyword
          ? `${modifierKeyword.type}${convTargetNode ? ` ${csharpTypeNameText(csharpTypeSpelling(convTargetNode.text))}` : ""}`
          : opField
            ? `operator ${checkedKeyword ? "checked " : ""}${opField.text}`
            : "operator"
        const visibility = this.extractVisibility(node)
        symbols.push({
          name: opName,
          kind: ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          complexity: this.calculateCyclomaticComplexity(node),
          metadata: { isOperatorOverload: true, isConversionOperator: type === "conversion_operator_declaration" },
        })
      } else if (type === "event_declaration") {
        // CSD5 (re-review 2026-09-04, probe): accessor-form event declarations
        // (`event EventHandler Ready { add {...} remove {...} }`) emitted NO
        // symbol — only event_field_declaration was handled. The name is the
        // grammar `name` field; the type is the qualified/generic type child.
        const nameNode = node.childForFieldName("name")
        const name = nameNode?.text || this.childText(node, "identifier") || "anonymous"
        const typeNode = this.findChild(
          node,
          (n) => n.type === "qualified_name" || ((n.type === "identifier" || n.type === "generic_name") && n.id !== nameNode?.id),
        )
        // C923 (#923): the ACCESSOR-form event is also a member the contract covers — and it is
        // the only form that can carry an explicit interface specifier in C#.
        this.collectMemberContract(
          node,
          name,
          parentContext,
          parentContext ? parentContext.fqn : "",
          parentContext ? `${parentContext.rawName}.${name}` : name,
          interfaceTasks,
          interfaceMembers,
          classMembers,
        )
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Event,
          range: this.nodeToRange(node),
          visibility: this.extractVisibility(node),
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          decorators: this.extractAttributes(node),
          metadata: { isEvent: true, isAccessorForm: true, dataType: typeNode?.text },
        })
      } else if (type === "constructor_initializer") {
        // CSD8 (re-review 2026-09-04, probe: 120 corpus occurrences):
        // `public Sub() : base(42) { }` / `: this()` — a real constructor-to-
        // constructor call that was never emitted. Attribute to the enclosing
        // constructor (its scope is active when the initializer is visited).
        // `: base(42)` vs `: this()` — node text STARTS with the colon, so
        // the discriminator is the first identifier after it.
        // ≡ /:\s*base\s*\(/ — ":", any whitespace run, "base", optional
        // whitespace, "(". Converted with the same discipline; the node text
        // here is a constructor initializer (base_list), never a comment.
        const target = this.matchesBaseInitializer(node.text) ? "base" : "this"
        if (parentContext?.name) {
          relationships.push({
            source: parentContext.name === "constructor" ? parentContext.rawName || "constructor" : parentContext.name,
            target,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.95,
            // M59.A7 (#825): the `base`/`this` KEYWORD, not the initializer: the
            // node starts at the `:` and a wrapped initializer writes the
            // keyword on the next line. Both tokens are anonymous children.
            line_number: this.nodeLine(this.initializerKeywordNode(node)),
            metadata: { isConstructorInitializer: true },
          })
        }
      } else if (
        type === "method_declaration" ||
        type === "constructor_declaration" ||
        type === "destructor_declaration"
      ) {
        let name =
          node.childForFieldName("name")?.text ||
          this.childText(node, "identifier") ||
          (type === "constructor_declaration" ? parentContext?.rawName : "anonymous") ||
          "anonymous"

        if (type === "constructor_declaration") name = "constructor"
        if (type === "destructor_declaration") name = "Finalize"

        const visibility = this.extractVisibility(node)
        const returnType =
          type === "constructor_declaration" || type === "destructor_declaration"
            ? "void"
            : node.childForFieldName("type")?.text || this.extractTypeString(node) || "void"

        const parameters: ASTEngine.Parameter[] = []
        let isExtensionMethod = false
        let sigParams = ""
        const paramList = this.findChild(node, "parameter_list")
        if (paramList) {
          // The parameter list is read from ALL children, not only the named
          // `parameter` ones, because `params` parameters are the one shape
          // tree-sitter-c-sharp does NOT wrap: `params string[] a` puts the
          // ANONYMOUS `params` token, the array_type and the identifier as
          // DIRECT children of the parameter_list (probe:
          // script/m14/tmp/cs-params-modifier.ts), so the old named-only loop
          // silently dropped every `params` parameter — from the published
          // payload AND from the overload signature. The bare form is accepted
          // ONLY behind the `params` token, so nothing else is guessed, and the
          // modifier is modelled the way java models varargs: the array type IS
          // the published type (`params string[] a` -> `string[]`).
          let inParamsForm = false
          let paramsTypeNode: Node | null = null
          for (let i = 0; i < paramList.childCount; i++) {
            const child = paramList.child(i)
            if (!child) continue
            const childType = child.type
            if (childType === "params") {
              inParamsForm = true
              paramsTypeNode = null
              continue
            }
            if (childType === "parameter") {
              inParamsForm = false
              paramsTypeNode = null
              const pName = child.childForFieldName("name")?.text || this.childText(child, "identifier") || "anonymous"
              const pTypeField = child.childForFieldName("type")?.text
              // M60.R7 paydown (csharp lane, 2026-09-22): a parameter whose type
              // cannot be resolved publishes NO type, never the placeholder
              // `"unknown"` the census adjudicated as a fabricated value — the
              // family convention is already `type: undefined` (groovy/kotlin).
              // And `extractTypeString`'s last-resort scan can land on the
              // parameter's OWN NAME on a damaged list (`void M(int a, b)` ->
              // type `"b"`, measured), which is the same fabrication class: a
              // value in a type field that is not a type. Neither branch is
              // reachable on a well-formed corpus (measured: 0 of 12,946
              // published parameters over 400 powershell files), so both are
              // pinned by the fixture instead.
              let pType = pTypeField || this.extractTypeString(child) || undefined
              if (!pTypeField && pType && pType === pName) pType = undefined
              if (child.text.startsWith("this ")) isExtensionMethod = true
              parameters.push(pType ? { name: pName, type: pType } : { name: pName })
              if (sigParams.length > 0) sigParams += ","
              // The signature is an overload-IDENTITY key, never a published
              // name: an unresolved type contributes the parameter AS WRITTEN,
              // which is the most informative honest token available and cannot
              // collide with a type the resolver would have extracted.
              sigParams += pType ?? csharpTypeNameText(child.text)
              continue
            }
            if (!inParamsForm) continue
            if (!paramsTypeNode && CSHARP_DECLARED_TYPE_NODES.has(childType)) {
              paramsTypeNode = child
              continue
            }
            if (childType === "identifier" || childType === "generic_name" || childType === "qualified_name") {
              const pName = csharpTypeNameText(child.text)
              // An EMPTY name is not a name. The grammar's recovery for a nameless
              // `params` parameter still inserts an `identifier` child and writes
              // NOTHING in it (tree, measured with script/m14/tmp/cs-param-noname-tree.ts:
              // `void M(params int[])` -> `array_type(int[])` then `identifier ""`),
              // so reading the node's text published `{ name: "" }` — a name-bearing
              // field holding a blank, which is the same fabrication class as the
              // `"unknown"` literal this round removed. The source writes no name, so
              // the honest state is NO parameter, and the type it could have carried
              // is genuinely unattributable: `params int[]` with no parameter has no
              // symbol to hang `int[]` on.
              if (pName.length > 0) {
                const pType = paramsTypeNode ? csharpTypeNameText(paramsTypeNode.text) : undefined
                parameters.push(pType ? { name: pName, type: pType } : { name: pName })
                if (sigParams.length > 0) sigParams += ","
                sigParams += pType ?? pName
              }
              inParamsForm = false
              paramsTypeNode = null
            }
          }
        }
        const signature = `(${sigParams})`

        const ownerFqn = parentContext ? parentContext.fqn : ""
        const fqn = parentContext ? `${ownerFqn}.${name}${signature}` : `${name}${signature}`
        const localOwnerPrefix = parentContext ? `${parentContext.rawName}.${name}${signature}` : `${name}${signature}`

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: type === "constructor_declaration" ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          parameters,
          returnType,
          decorators: this.extractAttributes(node),
          // Per-symbol cyclomatic complexity (family contract — JVM/rust/go/c
          // all emit symbol.complexity; csharp only had file-level complexity, so
          // the completeness section-C payload pin was impossible. Added csharp
          // #264 wave, same counter as the file-level one).
          complexity: this.calculateCyclomaticComplexity(node),
          metadata: {
            returnType,
            isExtensionMethod,
            isVirtual: this.hasModifier(node, "virtual"),
            isOverride: this.hasModifier(node, "override"),
            isAbstract: this.hasModifier(node, "abstract"),
            isStatic: this.hasModifier(node, "static"),
          },
        }
        symbols.push(sym)
        symbolMap.set(fqn, sym)
        symbolMap.set(localOwnerPrefix, sym)

        this.collectMemberContract(node, name, parentContext, ownerFqn, localOwnerPrefix, interfaceTasks, interfaceMembers, classMembers)

        if (this.hasModifier(node, "override")) {
          overrideTasks.push({
            fqn: localOwnerPrefix,
            methodName: name,
            signature,
            ownerFqn,
            // M59.A7 (#825): the NAME node, not the declaration's start — an
            // attribute above the override would otherwise be the claimed site
            // of a name written on the next line.
            line: this.nodeLine(this.declarationNameNode(node)),
          })
        }

        newContext = {
          node,
          name,
          rawName: name,
          kind: type === "constructor_declaration" ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
          fqn: ownerFqn,
          visibility,
          symbolRef: sym,
          isInterface: parentContext?.isInterface ?? false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "invocation_expression") {
        // CS-P1 (csharp review): positional-pattern heads (`o is Point(1,
        // y)`) parse as invocation_expressions inside pattern contexts — a
        // pattern match, never a call. Bounded climb: a constant_pattern /
        // is_pattern_expression ancestor before any statement / declaration
        // / block / method-ish / lambda / query / invocation boundary means
        // pattern position (note: trailing `&&` misparses INSIDE the
        // constant_pattern, so direct-parent checks miss — probe-verified).
        // Skipping here (the read pass treats their bare identifiers as
        // constant-pattern reads, and declared vars bind via declaration
        // rules).
        let inPattern = false
        {
          let q: Node | null = node.parent
          while (q) {
            const t: string = q.type
            if (t === "constant_pattern" || t === "is_pattern_expression") { inPattern = true; break }
            if (
              t === "invocation_expression" ||
              t.includes("statement") || t.includes("declaration") ||
              t.includes("block") || t.includes("function") ||
              t === "lambda_expression" || t === "local_function_statement" ||
              t === "query_expression" || t === "method_declaration" ||
              t === "constructor_declaration"
            ) break
            q = q.parent
          }
        }
        if (inPattern) {
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        const callExpr = this.buildCSharpCallExpression(node)
        // M59.A7 (#825, depth-draw finding): the callee NODE, needed both for
        // the line stamp and for the name-node hygiene below.
        const calleeNode = this.csharpCallCalleeNode(node)
        // Call sites live in method bodies AND constructor/property/indexer
        // bodies (csharp #264 Station-6: calls inside a constructor like
        // `this._list.Add(...)` were silently dropped because the guard
        // required the enclosing symbol to be a Method — the differential
        // oracle surfaced `Add`/`AddRange`/`DeepClone` as MISSING).
        const enclosingKind = parentContext?.kind
        const isCallSite =
          enclosingKind === ASTEngine.SymbolKind.Method ||
          enclosingKind === ASTEngine.SymbolKind.Constructor ||
          enclosingKind === ASTEngine.SymbolKind.Property ||
          // Class-body expression contexts (field/type-member initializers and
          // attribute arguments) — csharp #264 Station-6: calls like
          // `Thread.AllocateDataSlot()`, `PSTraceSource.GetTracer(...)`,
          // `DependencyProperty.Register(...)` in static field initializers
          // live at class scope, so the enclosing context is the Class/Struct/
          // Interface, not a method. Previously dropped, the differential
          // oracle surfaced them ALL as MISSING (it derives every
          // invocation_expression leaf from `(expr)`).
          enclosingKind === ASTEngine.SymbolKind.Class ||
          enclosingKind === ASTEngine.SymbolKind.Struct ||
          enclosingKind === ASTEngine.SymbolKind.Interface
        // CS-B1 (csharp review): top-level statements (C# 9) execute at file
        // scope with no enclosing symbol — their calls were dropped for lack
        // of a source name (the oracle derives every invocation leaf, so each
        // one surfaced as MISSING). Attribute to "global" (the field-use
        // pass convention for file-scope reads).
        const callSource = parentContext?.rawName || "global"
        if (callExpr && callSource && (isCallSite || !parentContext)) {
          // Strip generic type arguments so a generic call `x?.Get<T>(...)` /
          // `Foo.Gen<T>(...)` resolves to its clean leaf `Get` / `Gen` before
          // hygiene (the raw callExpr leaf carries `<T>`).
          const target = String(callExpr.split(".").pop() || callExpr).split("<")[0]
          // Call-target hygiene (csharp #264 Station-6 differential surfaced
          // fabricated Calls to non-method callee shapes): `if (...)` parses as
          // an invocation_expression in the tree-sitter grammar but is a
          // statement, and unsafe vtable dispatch chains slot a bare pointer
          // index as the callee (`... 2 ...))(...)`), element accesses
          // (`handlers[handler](...)`) and argument fragments surface as junk
          // targets too. Only a clean identifier is a real call target.
          // ≡ /^(if|for|…|set)$/ — fixed keyword set ≡ Set membership.
          const isCSharpKeyword = CSHARP_KEYWORDS.has(target)
          // ≡ /^[A-Za-z_][A-Za-z0-9_]*$/ — full-string identifier shape
          // (cpp isPlainIdentifier twin; same \w class semantics).
          if (!isCSharpKeyword && this.isPlainIdentifier(target) && !this.isCSharpBuiltin(callExpr) && this.isCSharpCalleeNameNode(calleeNode)) {
            relationships.push({
              source: callSource,
              target,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              // M59.A7 (#825): the CALLEE LEAF, never the call node — an
              // invocation starts at its receiver, so `helper\n  .Strip()`
              // would otherwise be stamped on the receiver's line.
              line_number: this.nodeLine(this.csharpCallCalleeNode(node)),
              metadata: { csharpCallExpression: callExpr },
            })
          }
        }
      } else if (type === "object_creation_expression") {
        const typeNode = this.findChild(node, (n) =>
          n.type === "identifier" || n.type === "generic_name" || n.type === "qualified_name" ||
          n.type === "predefined_type" ||
          // C2a: `new global::Root()` — single-segment alias shape. Without this the edge was
          // not merely mis-spelled, it was ABSENT (measured: `new Root()` published
          // `instantiates -> Root` while `new global::Root()` published nothing).
          n.type === "alias_qualified_name",
        )
        if (typeNode) {
          const source = parentContext?.rawName || "global"
          relationships.push({
            source,
            target: this.cleanTypeName(typeNode.text),
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            line_number: this.nodeLine(typeNode),
            metadata: { isNew: true },
          })
        }
      } else if (type === "implicit_object_creation_expression") {
        // Target-typed `new()` — the type comes from the enclosing
        // variable_declarator (pure AST resolution).
        const declaredType = this.resolveImplicitNewType(node, memberTypes)
        if (declaredType) {
          const source = parentContext?.rawName || "global"
          relationships.push({
            source,
            target: declaredType,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            line_number: this.nodeLine(
              this.targetTypedNewTypeNode(node, memberTypes, memberTypeNodes, declaredType),
            ),
            metadata: { isNew: true, isImplicit: true },
          })
        }
      } else if (type === "property_declaration" || type === "indexer_declaration") {
        const name = type === "indexer_declaration" ? "this" : node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const dataType = this.extractTypeString(node)
        const visibility = this.extractVisibility(node)

        let hasGet = false
        let hasSet = false
        let hasInit = false
        let isAutoProperty = false
        const accessorList = this.findChild(node, "accessor_list")
        if (accessorList) {
          isAutoProperty = true
          for (let i = 0; i < accessorList.namedChildCount; i++) {
            const acc = accessorList.namedChild(i)
            if (acc && acc.type === "accessor_declaration") {
              const accText = acc.text
              if (stringIncludes(accText, "get")) hasGet = true
              if (stringIncludes(accText, "set")) hasSet = true
              if (stringIncludes(accText, "init")) hasInit = true
              if (this.findChild(acc, "block") || this.findChild(acc, "arrow_expression_clause")) {
                isAutoProperty = false
              }
            }
          }
        } else if (this.findChild(node, "arrow_expression_clause")) {
          hasGet = true
        }

        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Property,
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          decorators: this.extractAttributes(node),
          complexity: this.calculateCyclomaticComplexity(node),
          metadata: { hasGet, hasSet, hasInit, isAutoProperty, dataType },
        })
        // C923 (#923): a property satisfies an interface property by the same rule a method
        // does, and the census measured the property form as 21% of all explicit interface
        // members (75 of 352) and 29% of the resolvable implicit ones (145 of 503) — a
        // methods-only contract would leave them permanently unwitnessed.
        this.collectMemberContract(
          node,
          name,
          parentContext,
          parentContext ? parentContext.fqn : "",
          parentContext ? `${parentContext.rawName}.${name}` : name,
          interfaceTasks,
          interfaceMembers,
          classMembers,
        )
        // Push a property/indexer scope so calls inside a getter/setter/accessor
        // body attribute to the property (csharp #264 Station-6: setter bodies
        // like `this.NotifyPropertyChanged(...)` were dropped because the
        // enclosing context stayed at the class — the differential surfaced
        // NotifyPropertyChanged/InvalidateValidationResult as MISSING).
        newContext = {
          node,
          name,
          rawName: name,
          kind: ASTEngine.SymbolKind.Property,
          fqn: parentContext ? `${parentContext.fqn}.${name}` : name,
          visibility,
          symbolRef: symbols[symbols.length - 1],
          isInterface: parentContext?.isInterface ?? false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "field_declaration") {
        const dataType = this.extractTypeString(node)
        const varDecl = this.findChild(node, "variable_declaration")
        const visibility = this.extractVisibility(node)
        if (varDecl) {
          for (let i = 0; i < varDecl.namedChildCount; i++) {
            const child = varDecl.namedChild(i)
            if (child && child.type === "variable_declarator") {
              const name = this.childText(child, "identifier") || "anonymous"
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(node),
                visibility,
                ownerName: parentContext?.rawName,
                ownerKind: parentContext?.kind,
                decorators: this.extractAttributes(node),
                metadata: { dataType, isField: true },
              })
            }
          }
        }
      }

      if (pushedScope) {
        stack.push({ node, parentContext: newContext, isExit: true })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parentContext: newContext })
        }
      }
    }

    // Override resolution: exact-signature BFS first (in-file), then the
    // cross-file companion (interface-over-superclass), then deterministic
    // first-parent fallback. Mirrors Java/Kotlin/Scala/Groovy semantics.
    this.resolveOverrides(overrideTasks, classHierarchy, symbolMap, relationships, context?.overrideCompanion)
    // C923 (#923): the member-level implements contract — explicit always (the interface is
    // written in the source), implicit only where the contract is KNOWN (in-file always; a
    // cross-file interface only when the caller supplies the member companion, the family's
    // sanctioned index). No branch guesses an unknown external interface's member set.
    this.resolveInterfaceImplementations(interfaceTasks, classHierarchy, interfaceMembers, classMembers, relationships)

    // Rewrite using-directive reference sources from "root" to the file's
    // primary type (first top-level type declared). Top-level types live
    // inside a namespace (block or file-scoped), so the owner may be a
    // namespace — never a class/interface/enum/struct.
    const primaryType = symbols.find((s) => {
      if (s.kind === ASTEngine.SymbolKind.Namespace) return false
      if (s.ownerKind && s.ownerKind !== ASTEngine.SymbolKind.Namespace) return false
      return s.kind === ASTEngine.SymbolKind.Class ||
             s.kind === ASTEngine.SymbolKind.Interface ||
             s.kind === ASTEngine.SymbolKind.Enum ||
             s.kind === ASTEngine.SymbolKind.Struct ||
             s.kind === ASTEngine.SymbolKind.Delegate
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && rel.source === "root") {
          rel.source = primaryType.name
        }
      }
    }

    // M59.A7 (#825): where each symbol's NAME is written (see the collector for
    // why the symbol's range start is not it).
    const containmentSites = this.collectContainmentSites(rootNode)

    // Contains: owner -> owned members via ownerName (top-level declarations
    // inside a namespace have the namespace as owner).
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // M59.A7 (#825): the member's own declaration — but the line its NAME
          // is written on, which is NOT always the declaration's start line: an
          // attribute (`[Parameter]`) or a wrapped signature puts the name a
          // line or more later. Measured on a 200-file draw: the range-start
          // stamp claimed a line the target is not written on for 653 of 23,924
          // relationships, every one of them this shape.
          line_number: this.containmentLine(s, containmentSites),
          metadata: {},
        })
      }
    }

    // Field-access Uses pass (csharp #264 wave). The M12 contract declares
    // `uses (field access)` but it was never emitted — a genuine Station-3
    // gap. Mirrors the go/rust family: member_access_expression on a field
    // (not in call-callee position) emits `uses containingFn -> field`.
    this.analyzeFieldAccessUses(rootNode, relationships, symbols)

    // CS-R1 (csharp review): bare-identifier value reads. The analyzer
    // emitted NO bare-identifier edges at all (`return Max;` produced zero
    // relationships) while the oracle audits only calls/instantiates — a
    // both-sides blind spot (CONV-CS-1), same class as pre-review CP1/R1.
    // Every bare identifier naming a class member VALUE (fields, consts,
    // properties — all Property-kind symbols) is a Uses edge, with the
    // C-family exclusion discipline adapted to C#: declaration positions
    // (entity names, declarators, patterns), call callees (calls branch
    // owns them, incl. generic/conditional wrappers), member leaves (the
    // field pass owns member_access leaves; RECEIVERS read), qualified
    // names (types/namespaces stay silent), preprocessor text, labels,
    // attributes names, named-argument designators, with/subpattern
    // designators, anonymous-type designators, assignment LHS writes
    // (incl. deconstruction), out-param writes, nameof/typeof/default/
    // sizeof operands, is/as type operands — and walk-order shadowing via
    // lexical frames (methods, blocks, lambdas, local functions, switch
    // arms, queries, catch/foreach/for/using constructs, class frames for
    // primary-ctor params). Resolvability required: unknown names stay
    // silent. `uses` is uncompared for csharp, so fixtures + mutants gate
    // this surface (no oracle change).
    this.analyzeCSharpBareIdentifierUses(rootNode, relationships, symbols, classHierarchy)

    // R9 (#804): the declared-type reference graph — family standard, mirrors
    // go/c/rust/java/kotlin (see csharpDeclaredTypeRefs' header for the inherited
    // conventions and the disclosed boundaries). Emitted BEFORE
    // classifyEvidenceTier so these edges carry an evidence class like every other
    // reference edge (`reference_qualified`), and from the SAME function the
    // differential oracle derives its truth from.
    for (const ref of csharpDeclaredTypeRefs(rootNode)) {
      relationships.push({
        source: ref.source,
        target: ref.target,
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        ...(ref.line ? { line_number: ref.line } : {}),
        metadata: { relationshipType: ref.relationshipType, declaredOn: ref.declaredOn },
      })
    }

    this.classifyEvidenceTier(relationships)

    // CONV-CS-2 (#751): framework markers from using roots / base types /
    // attribute names — family-aligned payload (the java sibling keys:
    // framework + detectedFrameworks + frameworkPatterns), ALWAYS present,
    // [] when nothing matches (never undefined — python's empty shell).
    const { detectedFrameworks, frameworkPatterns } = this.detectCSharpFrameworks(rootNode)

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        cyclomaticComplexity,
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        hasTypeInference: true,
        framework: detectedFrameworks.length > 0 ? detectedFrameworks[0] : undefined,
        detectedFrameworks,
        frameworkPatterns,
        hasFrameworkIntelligence: true,
        analysisVersion: "4.1.0-pure-ast-m12",
      },
    }
  }

  /**
   * Evidence-tier classification (family contract — mirrors JVM/rust/zig; M14
   * section D requires >=2 distinct evidenceClass values). Same rules as the
   * JVM family: structural (grammar clauses, conf 1.0) | usage_contextual
   * (calls, field access) | import_based (using-directive dependencies) |
   * reference_qualified (type references) | inferred (confidence < 1 edges).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "references") {
        md.evidenceClass = (md.isUsingDirective || md.isImport) ? "import_based" : "reference_qualified"
        continue
      }
      if (type === "imports") { md.evidenceClass = "import_based"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "overrides") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * CONV-CS-2 (#751): framework detection — the family contract (java
   * sibling): metadata carries `framework` (deterministic primary pick),
   * `detectedFrameworks` (always an array, [] when none) and
   * `frameworkPatterns`. Markers are grammar-level: using-directive roots
   * (incl. static / alias / global forms), base-list type names and
   * attribute names. The emitted order is the fixed CS_FRAMEWORK_ORDER
   * (application frameworks most-specific first, test frameworks last), so
   * source/import order can never change the payload. String ops only (R2
   * shrink-only: no new regex literals); edges are untouched — fixtures +
   * mutants gate this surface.
   */
  private detectCSharpFrameworks(rootNode: Node): {
    detectedFrameworks: string[]
    frameworkPatterns: Array<{ framework: string; patterns: string[] }>
  } {
    const usings = new Set<string>()
    const bases = new Set<string>()
    const attributes = new Set<string>()
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = n.type
      if (t === "using_directive") {
        const path = csharpUsingDirectivePath(n.text)
        if (path) usings.add(path)
        continue // directive subtrees contribute nothing else
      }
      if (t === "base_list") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const leaf = csharpTypeLeafName(n.namedChild(i)!)
          if (leaf) bases.add(leaf)
        }
        // keep descending: base entries carry no using/attribute nodes
      }
      if (t === "attribute") {
        const first = n.namedChild(0)
        const leaf = first ? csharpTypeLeafName(first) : undefined
        if (leaf) attributes.add(leaf)
        // keep descending: arguments may contain further subtrees
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    const detected: string[] = []
    for (let i = 0; i < CS_FRAMEWORK_ORDER.length; i++) {
      const fw = CS_FRAMEWORK_ORDER[i]
      if (CS_FRAMEWORK_MARKERS[fw](usings, bases, attributes)) detected.push(fw)
    }
    return {
      detectedFrameworks: detected,
      frameworkPatterns: detected.map((fw) => ({ framework: fw, patterns: CS_FRAMEWORK_PATTERNS[fw] })),
    }
  }

  /**
   * Per-symbol cyclomatic complexity (family contract — csharp #264 wave).
   * Same node set as the file-level counter above so per-symbol and
   * file-level agree; base complexity 1.
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1
    const complexityNodes = new Set([
      "if_statement", "for_statement", "foreach_statement", "while_statement",
      // CS-B3: `catch_clause` (not `catch_declaration`) — both catch forms
      // parse as catch_clause containing an optional declaration.
      "case_switch_label", "catch_clause", "conditional_expression",
      "logical_and_expression", "logical_or_expression",
      // CSD2: keep per-symbol in sync with the file-level counter above.
      "switch_expression_arm",
    ])
    const stack = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (complexityNodes.has(n.type)) complexity++
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return complexity
  }

  /** Pre-pass: record every type declaration's kind for in-file base-list resolution. */
  // CSD11: declarator name -> declared type for fields and properties.
  // Feeds assignment-form target-typed `new()` resolution (see
  // resolveImplicitNewType). Locals are NOT collected — a local resolved
  // through an assignment LHS would need a locals map with block scoping;
  // out of scope here, honestly unresolved instead.
  private collectMemberTypes(
    rootNode: Node,
    memberTypes: Map<string, string>,
    memberTypeNodes: Map<string, Node>,
  ): void {
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = n.type
      if (t === "field_declaration" || t === "property_declaration") {
        const isField = t === "field_declaration"
        // CSD14 (OO family closure 2026-09): the type token is extracted via
        // the shared csharpMemberDeclaredTypeText, which unwraps array_type /
        // pointer_type / nullable_type containers and never confuses the
        // member NAME with the type (the old direct-child scan fell through to
        // the name for array-typed members, self-mapping EnumSettingEntry[]
        // ExtensionChoice => ExtensionChoice). RAW text is stored — element /
        // base resolution happens at use time (csharpResolveTargetTypedNew).
        const declaredType = csharpMemberDeclaredTypeText(n) ?? undefined
        const names: string[] = []
        if (isField) {
          const varDecl = this.findChild(n, "variable_declaration")
          if (varDecl) {
            for (let i = 0; i < varDecl.namedChildCount; i++) {
              const d = varDecl.namedChild(i)
              if (d?.type === "variable_declarator") {
                const nm = this.childText(d, "identifier")
                if (nm) names.push(nm)
              }
            }
          }
        } else {
          const nm = n.childForFieldName("name")?.text || this.childText(n, "identifier")
          if (nm) names.push(nm)
        }
        const declaredTypeNode = this.memberDeclaredTypeNode(n)
        if (declaredType) for (const nm of names) if (!memberTypes.has(nm)) memberTypes.set(nm, declaredType)
        if (declaredTypeNode) for (const nm of names) if (!memberTypeNodes.has(nm)) memberTypeNodes.set(nm, declaredTypeNode)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * M59.A7 (#825): where each SYMBOL's name is written.
   *
   * The containment edge's contract is "the line of the node that NAMES the
   * target", and for a member that node is the declaration's NAME — which the
   * symbol's `range` cannot stand in for, because the range starts at the
   * declaration node and a C# declaration can begin a line or more before its
   * name (attributes such as `[Parameter]`, modifiers on their own line, a
   * wrapped signature). One walk over the declarations this analyzer turns into
   * symbols, keyed by the declaration's start index AND its name, because the
   * start index alone is ambiguous: a multi-declarator field (`int a, b;`)
   * produces two symbols that share the field_declaration's range. Keying by
   * name is also what makes the mapping self-protecting — a symbol whose name the
   * declaration does NOT write (a constructor is named `constructor`, an
   * operator `operator +`) finds no entry here and so can never claim a line the
   * target is not written on.
   */
  private collectContainmentSites(rootNode: Node): {
    named: Map<string, number>
    synthesized: Set<number>
  } {
    const named = new Map<string, number>()
    const synthesized = new Set<number>()
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = n.type
      if (t === "field_declaration" || t === "event_field_declaration") {
        // The member names live on the declarators — one symbol per name.
        const varDecl = this.findChild(n, "variable_declaration")
        if (varDecl) {
          for (let i = 0; i < varDecl.namedChildCount; i++) {
            const d = varDecl.namedChild(i)
            if (!d || d.type !== "variable_declarator") continue
            const id = this.findChild(d, "identifier")
            if (id) named.set(`${n.startIndex}\u0000${id.text}`, id.startPosition.row + 1)
          }
        }
      } else if (t === "destructor_declaration" || t === "constructor_declaration") {
        // Two declarations whose SYMBOL name the source never writes: a
        // destructor is named `Finalize` (written `~ClassName`) and a constructor
        // is named `constructor` (written `<ClassName>(...)`). No line in the
        // file can be the site of either name, so the honest state is NO line —
        // the same state java's synthesised members take, and the state the
        // oracle's own phantom rule calls correct (it counts a synthesised
        // member's containment edge CLAIMING a line as a definite defect).
        // Measured on the 200-file draw before this rule: 366 constructor edges
        // claimed the declaration's start line, which for an attributed
        // constructor is the ATTRIBUTE's line (`[Obsolete(...)]`) — a claim the
        // token check can only classify as uncheckable, never as true.
        synthesized.add(n.startIndex)
      } else if (CSHARP_SYMBOL_DECLARATIONS.has(t)) {
        const nameNode = this.declarationNameNode(n)
        if (nameNode) named.set(`${n.startIndex}\u0000${nameNode.text}`, nameNode.startPosition.row + 1)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return { named, synthesized }
  }

  /**
   * The containment edge's line: the NAME node where the declaration writes the
   * symbol's name, the declaration's own start line otherwise (a synthesised or
   * rewritten name still has a navigable declaration, and the oracle classifies
   * an uncheckable target as `notCheckable` rather than as a failed claim), and
   * NO line for a declaration whose symbol name is written nowhere in the file.
   */
  private containmentLine(
    s: ASTEngine.UniversalSymbol,
    sites: { named: Map<string, number>; synthesized: Set<number> },
  ): number | undefined {
    const start = s.range?.startIndex
    if (typeof start !== "number") return undefined
    if (sites.synthesized.has(start)) return undefined
    return sites.named.get(`${start}\u0000${s.name}`) ?? s.range?.startLine
  }

  /**
   * The node that WRITES a declaration's name — the symbol pass's own rule
   * (`childForFieldName("name")`, then the first identifier), plus the one shape
   * where the name is not a field: an indexer's symbol is named `this`, which the
   * grammar writes as an anonymous keyword child.
   */
  private declarationNameNode(node: Node): Node | null {
    const field = node.childForFieldName("name")
    if (field) return field
    if (node.type === "indexer_declaration") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.type === "this") return child
      }
      return null
    }
    return this.findChild(node, "identifier")
  }

  private collectDeclaredTypeKinds(rootNode: Node, typeKinds: Map<string, string>): void {
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = n.type
      if (
        t === "class_declaration" || t === "struct_declaration" ||
        t === "interface_declaration" || t === "record_declaration" ||
        t === "enum_declaration"
      ) {
        const name = n.childForFieldName("name")?.text || this.childText(n, "identifier")
        if (name) {
          const kind = t === "interface_declaration"
            ? ASTEngine.SymbolKind.Interface
            : t === "enum_declaration"
              ? ASTEngine.SymbolKind.Enum
              : csharpTypeDeclarationKind(n) ?? ASTEngine.SymbolKind.Class
          typeKinds.set(name, kind)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * C923 (#923): record one member declaration for the interface-implementation contract — or,
   * when the declaration IS the interface's, record the CONTRACT it declares.
   *
   * The contract side is indexed under BOTH the interface's FQN and its local name, because a
   * base-list entry is written either way (`class C : IFoo` / `class C : Ns.IFoo`), and the
   * resolution below looks the ancestor up by the name the base list actually wrote.
   */
  private collectMemberContract(
    node: Node,
    name: string,
    parentContext: Scope | undefined,
    ownerFqn: string,
    localLabel: string,
    tasks: InterfaceImplTask[],
    members: Map<string, Set<string>>,
    classMembers: Map<string, Set<string>>,
    lineNode?: Node,
  ): void {
    if (!parentContext) return
    const kind = parentContext.kind
    if (
      kind !== ASTEngine.SymbolKind.Class &&
      kind !== ASTEngine.SymbolKind.Struct &&
      kind !== ASTEngine.SymbolKind.Interface
    ) {
      return
    }
    if (parentContext.isInterface) {
      for (const key of [parentContext.fqn, parentContext.rawName]) {
        if (!key) continue
        let set = members.get(key)
        if (!set) {
          set = new Set<string>()
          members.set(key, set)
        }
        set.add(name)
      }
      return
    }
    for (const key of [parentContext.fqn, parentContext.rawName]) {
      if (!key) continue
      let set = classMembers.get(key)
      if (!set) {
        set = new Set<string>()
        classMembers.set(key, set)
      }
      set.add(name)
    }
    tasks.push({
      fqn: localLabel,
      ownerFqn,
      memberName: name,
      explicitIface: this.explicitInterfaceName(node),
      // M59.A7: the NAME node's line. A field-like event writes its name on a
      // `variable_declarator`, not on the declaration's `name` field, so the caller passes that
      // node — otherwise the edge is stamped with an honest-but-avoidable no-line.
      line: this.nodeLine(lineNode ?? this.declarationNameNode(node)),
    })
  }

  /**
   * The interface an explicit interface member writes (`void IFoo.M()` → `IFoo`). The trailing
   * `.` is punctuation, not part of the name, so it is cut by a linear scan (no regex).
   */
  private explicitInterfaceName(node: Node): string | null {
    const spec = this.findChild(node, (n) => n.type === "explicit_interface_specifier")
    if (!spec) return null
    const cleaned = this.cleanTypeName(spec.text)
    let end = cleaned.length
    while (end > 0) {
      const c = cleaned.charCodeAt(end - 1)
      if (c === 46 || c === 32 || c === 9 || c === 10 || c === 13) end--
      else break
    }
    const name = cleaned.slice(0, end)
    return name.length > 0 ? name : null
  }

  /**
   * C923 (#923): the member-level implements contract, mirroring the family's five-lane
   * precedent (`overrides M -> I.m`, measured in java, kotlin, typescript, dart and python).
   *
   *   explicit (`void IFoo.M()`): ALWAYS. The interface is written in the declaration, so the
   *     edge is derivable from the tree alone at any scope — measured on csharp's two pinned
   *     corpora, 215 of 352 explicit members name an interface the corpus text never declares,
   *     so requiring resolution would drop 61% of a class that needs none.
   *   implicit (a member that satisfies a base-list interface): only where the member set of
   *     that interface is KNOWN, which is the case exactly when the interface is declared in
   *     this file. An interface the analyzer cannot see stays an honest no-edge (measured in the
   *     full extent: 273 member declarations whose contract lives in another file, and 2,107
   *     types whose bases are not in the corpus text at all — both disclosed, neither guessed).
   *
   * No caller context is consulted, deliberately: a rule that changes with an optional companion
   * would be a rule a fixture cannot pin (fixtures pass no context), and the family's own doctrine
   * is that nothing ships unverified. The cross-file extension is measured and registered as an
   * open scope limit instead (issue #923).
   *
   * First ancestor in declaration order that both IS an interface and declares the member wins —
   * the family's rule for a name-keyed target (cf. findDeclaringParent).
   */
  private resolveInterfaceImplementations(
    tasks: InterfaceImplTask[],
    classHierarchy: Map<string, string[]>,
    interfaceMembers: Map<string, Set<string>>,
    classMembers: Map<string, Set<string>>,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    if (tasks.length === 0) return
    // `interfaceMembers` holds ONLY interfaces declared in this file (both raw and FQN keys),
    // so membership IS the known-contract test — no kind lookup is needed, and an external
    // interface cannot reach this branch even by name collision.
    const declaresMember = (iface: string, member: string): boolean =>
      interfaceMembers.get(iface)?.has(member) === true

    // One member, one edge: an overload set cannot publish the same (source, target) twice.
    const emitted = new Set<string>()
    for (const task of tasks) {
      let target: string | null = null
      if (task.explicitIface) {
        target = `${task.explicitIface}.${task.memberName}`
      } else if (task.ownerFqn) {
        const queue: string[] = [...(classHierarchy.get(task.ownerFqn) ?? [])]
        const seen = new Set<string>()
        while (queue.length > 0) {
          const parent = queue.shift()!
          if (seen.has(parent)) continue
          seen.add(parent)
          if (declaresMember(parent, task.memberName)) {
            target = `${parent}.${task.memberName}`
            break
          }
          // A base CLASS that declares the same member already owns the interface slot
          // (C# interface mapping binds to the most-derived *implementation*, and a member
          // redeclared over it is a hide/re-implementation, which this rule deliberately does
          // not claim — an incompleteness recorded on #923, never a fabrication).
          if (classMembers.get(parent)?.has(task.memberName)) continue
          for (const next of classHierarchy.get(parent) ?? []) {
            if (!seen.has(next)) queue.push(next)
          }
        }
      }
      if (!target) continue
      const source = localEdgeLabel(task.fqn)
      const label = localEdgeLabel(target)
      if (!source || !label) continue
      const key = `${source}|${label}`
      if (emitted.has(key)) continue
      emitted.add(key)
      relationships.push({
        source,
        target: label,
        type: ASTEngine.RelationshipType.Overrides,
        confidence: 1.0,
        line_number: task.line,
        metadata: {
          relationshipType: "interface_member_implementation",
          isCSharpInterfaceImpl: true,
          explicitInterfaceMember: task.explicitIface != null,
        },
      })
    }
  }

  private resolveOverrides(
    tasks: OverrideTask[],
    classHierarchy: Map<string, string[]>,
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    relationships: ASTEngine.UniversalRelationship[],
    companion?: Map<string, Set<string>>,
  ) {
    for (const task of tasks) {
      let targetFqn: string | null = null

      // Pass 1: exact-signature BFS over the in-file hierarchy.
      const queue: string[] = []
      const ownerH = classHierarchy.get(task.ownerFqn)
      if (ownerH) {
        for (let i = 0; i < ownerH.length; i++) queue.push(ownerH[i])
      }
      const seen: Set<string> = new Set()

      while (queue.length > 0) {
        const parent = queue.shift()!
        if (seen.has(parent)) continue
        seen.add(parent)

        const potentialTargetFqn = `${parent}.${task.methodName}${task.signature}`
        if (symbolMap.has(potentialTargetFqn)) {
          targetFqn = potentialTargetFqn
          break
        }
        const pH = classHierarchy.get(parent)
        if (pH) {
          for (let i = 0; i < pH.length; i++) queue.push(pH[i])
        }
      }

      // Pass 2: cross-file companion declaring-parent resolution.
      if (!targetFqn && companion && ownerH && ownerH.length > 0) {
        const declaring = findDeclaringParent(
          task.methodName,
          ownerH,
          companion,
          (t) => classHierarchy.get(t) ?? [],
        )
        if (declaring) targetFqn = `${declaring}.${task.methodName}${task.signature}`
      }

      // Pass 3: deterministic per-file fallback — first hierarchy parent.
      if (!targetFqn && ownerH && ownerH.length > 0) {
        targetFqn = `${ownerH[0]}.${task.methodName}${task.signature}`
      }

      if (targetFqn) {
        // R10 sibling sweep: was `split("(")[0].split(".").slice(-2)` —
        // immune to a dotted parameter list, but it cuts at the FIRST "(" and
        // so silently truncates a paren-bearing OWNER chain to a wrong label.
        const localSource = localEdgeLabel(task.fqn)
        const localTarget = localEdgeLabel(targetFqn)
        relationships.push({
          source: localSource,
          target: localTarget,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 1.0,
          line_number: task.line,
          metadata: { relationshipType: "method_override", isCSharpOverride: true },
        })
      }
    }
  }

  /**
   * Field-access Uses pass (csharp #264 wave, Station 3). Emits `uses
   * containingFn -> field` for member_access_expression on a field (e.g.
   * `this.Name`, `obj.Radius`) that is NOT the callee of a call. Mirror of the
   * go/rust selector-uses family contract. Call-callee member accesses are
   * skipped (calls analysis emits the leaf-target calls edge instead).
   */
  private analyzeFieldAccessUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // CS-D6 (2026-09-28, the `uses`-oracle round): a "dedup against calls" guard used to live
    // here, keyed on `${source}->${target}` with NO SITE:
    //
    //     if (!seen.has(key) && !emittedCalls.has(`${src}->${tgt}`)) { … }
    //
    // Its stated purpose was to avoid duplicating a `calls` edge for a member access in
    // call-callee position — but `isCallee` above already does that, STRUCTURALLY, by
    // comparing node spans against the invocation's `function` field. The name-keyed guard was
    // therefore a coarser duplicate of a precise rule, and it dropped real reads: in C# a static
    // member and a method call can share a name, so ANY read of one is lost as soon as
    // something else in the same function is CALLED by that name. Four occurrences over 150 real
    // roslyn files, all the same class, all measured against a NEW independent truth:
    //
    //   * `_options.X.Severity == ReportDiagnostic.Suppress`  (a READ, line 164) dropped because
    //     `context.ReportDiagnostic(diagnostic)` is CALLED in the same function (line 229);
    //   * `properties.ContainsKey(RedundantEqualityConstants.Negate)` (a READ, line 56) dropped
    //     because `generator.Negate(…)` is CALLED in the same function (line 57);
    //   * `declarationDeclarators.Count` (a READ, line 65) dropped because
    //     `fieldDeclarators.Count()` is CALLED on the same line's other side.
    //
    // So the suppression is now SITE-AWARE, which is what `isCallee` already was: the caller's
    // own gate decides, and the name is never a reason to drop a read. `seen` stays, because
    // that one is genuine dedup — the same (source, member) read twice is one dependency.
    const stack: Node[] = [rootNode]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "member_access_expression" || node.type === "member_binding_expression") {
        // Skip when the selectoing member_access is the callee of a call
        // expression (call-callee position). CSD4 (re-review 2026-09-04):
        // null-conditional calls `x?.M()` host the member binding inside a
        // conditional_access_expression that is itself the call's function —
        // that 2-level shape must be skipped too, or `?.M()` emits a bogus
        // uses edge for the METHOD name.
        let isCallee = false
        const parent = node.parent
        if (parent && parent.type === "invocation_expression") {
          const fn = parent.childForFieldName("function")
          // web-tree-sitter returns fresh wrapper objects per node access —
          // object identity NEVER matches (TSD6 class, M37 hygiene gate).
          // Compare stable node ids; the old `fn === node` / `gp... === parent`
          // checks were dead, so `?.M()` (and plain `x.M()`) callee skips
          // never fired and method names leaked bogus uses edges.
          if (fn && fn.id === node.id) isCallee = true
        } else if (parent && parent.type === "conditional_access_expression") {
          const gp = parent.parent
          if (gp && gp.type === "invocation_expression" && gp.childForFieldName("function")?.id === parent.id) isCallee = true
        }
        // SCD1 (M37 #599 pre-wave): an assignment LHS is a WRITE, never a
        // read — `this.count = 0` and `this.count += 1` both emitted a bogus
        // `uses count`. Gate the LHS by exact span containment: the RHS of
        // `this.count = this.count + 1` stays a genuine read (java JAD1/
        // kotlin KAD1/scala SCD1 family contract).
        let isLhsWrite = false
        {
          let a = node.parent
          while (a && (a.type === "member_access_expression" || a.type === "member_binding_expression")) a = a.parent
          if (a && a.type === "assignment_expression") {
            const lhs = a.childForFieldName("left")
            if (lhs && lhs.startIndex <= node.startIndex && lhs.endIndex >= node.endIndex) isLhsWrite = true
          }
        }
        if (!isCallee && !isLhsWrite) {
          const field = node.childForFieldName("name")
          const expr = node.childForFieldName("expression")
          // CSD4: member_binding_expression (`.Count`) has NO expression field
          // — the binding itself is the member selection; its receiver lives
          // in the parent conditional_access_expression. Require expr only for
          // the member_access form, or `?.Count` reads never emit.
          if (field && (expr || node.type === "member_binding_expression")) {
            const containing = this.findContainingCSharpFunction(node)
            const src = containing || "global"
            const tgt = field.text
            const key = `${src}.${tgt}`
            if (!seen.has(key)) {
              seen.add(key)
              relationships.push({
                source: src,
                target: tgt,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.7,
                // M59.A7 (#825): the member-access NAME field (`obj\n  .Radius`
                // writes Radius on line 2, the access node starts on line 1).
                line_number: this.nodeLine(field),
                metadata: { relationshipType: "csharp_field_access", fieldAccess: key },
              })
            }
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * CS-R1: bare-identifier value reads (see the call site for the contract).
   * Inventory = Property-kind member names keyed by owner (full name and
   * leaf); resolution walks the lexical class chain innermost-first, then
   * base classes transitively (capped), then lexically enclosing classes.
   * Methods, enum members, events and delegates never resolve bare
   * (method groups, qualified-only members, ruled boundaries).
   */
  private analyzeCSharpBareIdentifierUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    classHierarchy: Map<string, string[]>,
  ): void {
    // DEPTH FIX. `using_directive` and `extern_alias_directive` are always DIRECT children of
    // `compilation_unit`, so "is p inside an import?" is answerable from a precomputed span table
    // rather than by climbing to the root for every identifier. The climb was unconditional and ran
    // to the top of the tree on files with no import at all -- the powershell corpus among others --
    // and per-site instrumentation put `isImportName` among five predicates carrying ~96% of the
    // ancestor-walk invocations in a deeply nested file.
    //
    // Span containment is equivalent to the ancestor walk: p is inside a using directive exactly
    // when its extent falls within that directive's, and p is never itself a using directive.
    // childCount rather than namedChildCount so an unnamed form cannot be missed.
    const importSpans: Array<[number, number]> = []
    {
      const importStack: Node[] = [rootNode]
      while (importStack.length > 0) {
        const n = importStack.pop()!
        if (n.type === "using_directive" || n.type === "extern_alias_directive") {
          importSpans.push([n.startIndex, n.endIndex])
          continue // nothing inside a using directive is itself one
        }
        for (let k = 0; k < n.childCount; k++) {
          const kid = n.child(k)
          if (kid) importStack.push(kid)
        }
      }
    }
    const leafOf = (s: string): string => {
      // Last ::- or .-separated segment, skipping empties (R2 shrink-only:
      // no regex literals for what two splits express exactly).
      const segs: string[] = []
      for (const a of s.split("::")) {
        for (const b of a.split(".")) {
          if (b) segs.push(b)
        }
      }
      return segs.length > 0 ? segs[segs.length - 1] : s
    }
    const membersByOwner = new Map<string, Set<string>>()
    const addMember = (owner: string, name: string): void => {
      if (!owner || !name || name === "_") return
      for (const key of [owner, leafOf(owner)]) {
        let s = membersByOwner.get(key)
        if (!s) { s = new Set<string>(); membersByOwner.set(key, s) }
        s.add(name)
      }
    }
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Property && s.ownerName) addMember(s.ownerName, s.name)
    }
    const emitted = new Set<string>()
    interface Frame { names: Set<string>; cls: string | null }
    const scopeStack: Frame[] = []
    // File-scope frame: top-level-statement locals (`int x = 1;` outside
    // any type) bind here instead of leaking into member resolution on
    // colliding names. Popped at root exit like every other frame.
    scopeStack.push({ names: new Set<string>(), cls: null })
    const isShadowed = (name: string): boolean => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeStack[i].names.has(name)) return true
      }
      return false
    }
    const isResolvableRead = (name: string): boolean => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const fr = scopeStack[i]
        if (!fr.cls) continue
        const seen = new Set<string>()
        const queue = [fr.cls]
        let depth = 0
        while (queue.length > 0 && depth < 10) {
          depth++
          const cur = queue.shift()!
          if (seen.has(cur)) continue
          seen.add(cur)
          const mm = membersByOwner.get(cur) ?? membersByOwner.get(leafOf(cur))
          if (mm && mm.has(name)) return true
          for (const b of classHierarchy.get(cur) ?? classHierarchy.get(leafOf(cur)) ?? []) {
            if (!seen.has(b)) queue.push(b)
          }
        }
      }
      return false
    }
    // First identifier-ish direct child (the declared name for parameters,
    // declarators, catch variables, from/join/let range variables).
    const firstIdent = (n: Node | null): Node | null => {
      if (!n) return null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "identifier" )) return c
      }
      return null
    }
    // Leftmost declarator name (`int *p` → p, `int x` → x): descend through
    // declarator wrappers to the declared identifier.
    const declaratorName = (declNode: Node | null): Node | null => {
      let cur: Node | null = declNode
      while (cur) {
        if (cur.type === "identifier") return cur
        let next: Node | null = null
        for (let i = 0; i < cur.namedChildCount; i++) {
          const c = cur.namedChild(i)
          if (
            c && (c.type === "identifier"  ||
              c.type.endsWith("declarator"))
          ) {
            next = c
            break
          }
        }
        if (!next || next === cur) return null
        cur = next
      }
      return null
    }
    // A variable_declarator declares a LOCAL (bind) or a MEMBER (skip) —
    // climb to the nearest scope boundary. Method-ish bodies (incl. blocks
    // and lambdas, which always precede any arrow clause on the climb)
    // mean local; class-ish means member; file top level (top-level
    // statements) means local.
    const declaratorRole = (declNode: Node): "local" | "member" => {
      let cur: Node | null = declNode.parent
      while (cur) {
        const t: string = cur.type
        if (
          t === "method_declaration" || t === "constructor_declaration" ||
          t === "destructor_declaration" || t === "operator_declaration" ||
          t === "conversion_operator_declaration" ||
          t === "local_function_statement" || t === "lambda_expression" ||
          t === "block" || t === "accessor_declaration"
        ) return "local"
        if (
          t === "class_declaration" || t === "struct_declaration" ||
          t === "interface_declaration" || t === "record_declaration" ||
          t === "enum_declaration"
        ) return "member"
        cur = cur.parent
      }
      return "local"
    }
    interface ScopeFrameT { names: Set<string> }
    // `=`, `:` or `{` among a node's ALL children switches it from
    // declaring to reading (CP8-class segment discipline for anonymous
    // initializers and attribute arguments).
    const hasEqualsAfter = (parent: Node, node: Node): boolean => {
      let sawSelf = false
      for (let i = 0; i < parent.childCount; i++) {
        const c = parent.child(i)
        if (!c) continue
        if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) { sawSelf = true; continue }
        if (!c.isNamed && sawSelf && (c.type === "=" || c.type === ":")) return true
      }
      return false
    }
    const stack: Array<{ node: Node; exit: boolean; pushed: boolean }> = [{ node: rootNode, exit: false, pushed: false }]
    while (stack.length > 0) {
      const { node, exit, pushed } = stack.pop()!
      if (exit) {
        if (pushed) scopeStack.pop()
        continue
      }
      const t = node.type
      let pushedScope = false
      const top = (): Frame | null => (scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null);
      if (
        t === "method_declaration" || t === "constructor_declaration" ||
        t === "destructor_declaration" || t === "operator_declaration" ||
        t === "conversion_operator_declaration" || t === "local_function_statement"
      ) {
        const frame: Frame = { names: new Set<string>(), cls: null }
        const plist = this.findChild(node, (n) => n.type === "parameter_list")
        if (plist) {
          for (let i = 0; i < plist.namedChildCount; i++) {
            const p = plist.namedChild(i)
            if (!p || p.type !== "parameter") continue
            const nm = p.childForFieldName("name") ?? firstIdent(p)
            if (nm && nm.text !== "_") frame.names.add(nm.text)
          }
        }
        // Local functions declare their NAME in the enclosing scope.
        if (t === "local_function_statement") {
          const nm = node.childForFieldName("name") ?? firstIdent(node)
          const outer = top()
          if (outer && nm && nm.text !== "_") outer.names.add(nm.text)
        }
        scopeStack.push(frame)
        pushedScope = true
      } else if (
        t === "block" || t === "lambda_expression" ||
        t === "switch_expression_arm" || t === "query_expression" ||
        t === "foreach_statement" || t === "for_statement" ||
        t === "using_statement" || t === "catch_clause"
      ) {
        // Lambda parameters bind at entry (named `parameter` nodes via
        // their name field, plus bare `implicit_parameter` names).
        if (t === "lambda_expression") {
          const frame: Frame = { names: new Set<string>(), cls: null }
          const walk: Node[] = [node]
          while (walk.length > 0) {
            const m = walk.pop()!
            if (m !== node && (m.type === "block" || m.type === "lambda_expression")) continue
            if (m.type === "parameter") {
              const pn = m.childForFieldName("name") ?? firstIdent(m)
              if (pn && pn.text !== "_") frame.names.add(pn.text)
            } else if (m.type === "implicit_parameter") {
              for (let i = 0; i < m.namedChildCount; i++) {
                const c = m.namedChild(i)
                if (c && (c.type === "identifier" ) && c.text !== "_") frame.names.add(c.text)
              }
            }
            for (let i = m.namedChildCount - 1; i >= 0; i--) {
              const c = m.namedChild(i)
              if (c) walk.push(c)
            }
          }
          scopeStack.push(frame)
          pushedScope = true
        } else if (t === "foreach_statement") {
          // `foreach (var x in ys)` binds x; `foreach (Point p in ps)`
          // binds p (a bare-identifier type is still a type — the grammar
          // spells all C# type names `identifier`); `foreach (x in ys)`
          // assigns the existing x (a write — binds nothing, and the
          // identifier gate below silences the write site). Rule: with a
          // recognized type node present, bind the first identifier after
          // it; otherwise (all-bare shapes) bind all-but-first-and-last
          // (first = the positional type, last = the source, both read
          // nothing... the source reads normally via the read path).
          const frame: Frame = { names: new Set<string>(), cls: null }
          const isTypeish = (c: Node): boolean =>
            c.type === "implicit_type" || c.type === "predefined_type" ||
            c.type === "generic_name" ||
            c.type === "qualified_name" || c.type === "nullable_type" ||
            c.type === "array_type" || c.type === "pointer_type" ||
            c.type === "tuple_type" || c.type === "ref_type"
          const kids: Node[] = []
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c || c.type === "block") break
            kids.push(c)
          }
          const hasType = kids.some((c) => isTypeish(c))
          if (hasType) {
            let bound = false
            let seen = false
            for (const c of kids) {
              if (isTypeish(c)) { seen = true; continue }
              if (!bound && seen && c.type === "identifier" && c.text !== "_") {
                frame.names.add(c.text)
                bound = true
              }
            }
          } else {
            const ids = kids.filter((c) => c.type === "identifier" && c.text !== "_")
            for (let i = 1; i + 1 < ids.length; i++) frame.names.add(ids[i].text)
          }
          scopeStack.push(frame)
          pushedScope = true
        } else {
          scopeStack.push({ names: new Set<string>(), cls: null })
          pushedScope = true
        }
      } else if (
        t === "class_declaration" || t === "struct_declaration" ||
        t === "interface_declaration" || t === "record_declaration"
      ) {
        // Class scope: resolution context + primary-constructor params.
        // Record positionals are NOT bound (they coincide with properties —
        // reads must flow to the member). Enums push no frame (no members
        // resolve bare, no params exist).
        const frame: Frame = { names: new Set<string>(), cls: null }
        const nm = node.childForFieldName("name")?.text ?? firstIdent(node)?.text ?? null
        if (nm) frame.cls = nm
        if (t !== "record_declaration") {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && c.type === "parameter_list") {
              for (let k = 0; k < c.namedChildCount; k++) {
                const p = c.namedChild(k)
                if (!p || p.type !== "parameter") continue
                const pn = p.childForFieldName("name") ?? firstIdent(p)
                if (pn && pn.text !== "_") frame.names.add(pn.text)
              }
            }
          }
        }
        scopeStack.push(frame)
        pushedScope = true
      } else if (t === "variable_declarator") {
        // Locals bind (walk-order shadowing); member declarators declare
        // symbols elsewhere and never bind (their reads resolve via the
        // member inventory — binding them would self-shadow).
        if (declaratorRole(node) === "local") {
          const f = top()
          const nm = declaratorName(node)
          if (f && nm && nm.text !== "_") f.names.add(nm.text)
        }
      } else if (t === "declaration_pattern") {
        // `Point p`, `List<int> x`, `var v`: skip the TYPE (first child),
        // bind the rest.
        const f = top()
        if (f) {
          for (let i = 1; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && (c.type === "identifier" ) && c.text !== "_") f.names.add(c.text)
          }
        }
      } else if (t === "declaration_expression") {
        // `out int v`, `out v`: the LAST direct identifier declares (a
        // lone `out <type>` never names a value). Earlier siblings are
        // types (never read as values here).
        const f = top()
        if (f) {
          let last: Node | null = null
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && c.type === "identifier") last = c
          }
          if (last && last.text !== "_") f.names.add(last.text)
        }
      } else if (t === "from_clause" || t === "join_clause" || t === "let_clause") {
        // `from x in src`, `join y in ys`, `let b = a`: the FIRST
        // identifier binds, the rest read. (`into` continuations do not
        // parse in this grammar version — the identifiers vanish, so no
        // rule can bind them; ruled grammar limitation.)
        const f = top()
        if (f) {
          const id = firstIdent(node)
          if (id && id.text !== "_") f.names.add(id.text)
        }
      } else if (t === "catch_declaration") {
        // `catch (E e)`: bind direct identifiers that have an earlier
        // sibling (the variable, never the leading type). `catch (E)`
        // binds nothing; `catch {}` has nothing to bind.
        const f = top()
        if (f) {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c || c.type !== "identifier" || c.text === "_") continue
            let earlier = false
            for (let k = 0; k < i; k++) {
              if (node.namedChild(k)) { earlier = true; break }
            }
            if (earlier) f.names.add(c.text)
          }
        }
      } else if (t === "tuple_expression") {
        // Deconstruction (`(int a, int b) = t`, `(a, b) = t`): per
        // `argument` child — with a recognized type sibling, bind its
        // identifier children (declarations); with multiple bare
        // identifiers and no type, bind all-but-first (first is the
        // positional type, e.g. `(Point p)`); a lone bare identifier
        // assigns an existing variable (a write — bind nothing; the
        // emission gate silences it). Only when this tuple is the LHS of
        // an assignment (RHS tuples read normally).
        const p = node.parent
        if (p && p.type === "assignment_expression" && p.namedChild(0) &&
          node.startIndex >= p.namedChild(0)!.startIndex && node.endIndex <= (p.namedChild(0)!.endIndex ?? 0)) {
          const f = top()
          if (f) {
            const isTypeish = (c: Node): boolean =>
              c.type === "implicit_type" || c.type === "predefined_type" ||
              c.type === "generic_name" ||
              c.type === "qualified_name" || c.type === "nullable_type" ||
              c.type === "array_type" || c.type === "pointer_type" ||
              c.type === "tuple_type" || c.type === "ref_type"
            for (let i = 0; i < node.namedChildCount; i++) {
              const arg = node.namedChild(i)
              if (!arg || arg.type !== "argument") continue
              const ids: Node[] = []
              let typed = false
              for (let k = 0; k < arg.namedChildCount; k++) {
                const c = arg.namedChild(k)
                if (!c) continue
                if (isTypeish(c)) typed = true
                else if (c.type === "identifier" && c.text !== "_") ids.push(c)
              }
              const bind = typed ? ids : ids.slice(1)
              for (const b of bind) f.names.add(b.text)
            }
          }
        }
      } else if (t === "identifier") {
        const name = node.text
        const p = node.parent
        // Attribute NAMES name attribute types, never values (arguments
        // below read normally).
        const isAttrName = !!p && p.type === "attribute" &&
          (() => {
            for (let i = 0; i < p.namedChildCount; i++) {
              const c = p.namedChild(i)
              if (c && (c.type === "identifier" || c.type === "generic_name" || c.type === "qualified_name")) {
                return c.startIndex === node.startIndex && c.endIndex === node.endIndex
              }
            }
            return false
          })()
        // Named-argument designators (`Size = 3`): first identifier
        // followed by `=` designates, never reads.
        const isNamedArgDesignator = !!p && p.type === "attribute_argument" &&
          (() => {
            const first = firstIdent(p)
            return !!first && first.startIndex === node.startIndex && first.endIndex === node.endIndex && hasEqualsAfter(p, node)
          })()
        // Anonymous-type designators (`new { X = 1, Y = v }`): same
        // equals-rule per comma segment; lone identifiers read (shorthand).
        const isAnonDesignator = !!p && (() => {
          let q: Node | null = p
          while (q && q.type !== "anonymous_object_creation_expression" && q.type !== "block" &&
            q.type !== "method_declaration" && q.type !== "constructor_declaration" &&
            q.type !== "local_function_statement" && q.type !== "lambda_expression") {
            q = q.parent
          }
          if (!q || q.type !== "anonymous_object_creation_expression") return false
          // Segment discipline: reset at `,`/`;`/`{`/`}` (the opening
          // brace starts the member list fresh — it must NOT poison
          // freshness, else the first designator leaks as a read);
          // `=`/`:` switch a segment to reading; the first identifier of
          // a fresh segment with `=` after designates, lone identifiers
          // read (shorthand).
          let fresh = true
          let foundFirst = false
          for (let i = 0; i < q.childCount; i++) {
            const c = q.child(i)
            if (!c) continue
            if (!c.isNamed) {
              if (c.type === "," || c.type === ";" || c.type === "{" || c.type === "}") { fresh = true; foundFirst = false } else if (c.type === "=" || c.type === ":") fresh = false
              continue
            }
            if (c.type === "identifier" ) {
              if (!foundFirst && fresh) {
                if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) {
                  return hasEqualsAfter(q, c)
                }
                foundFirst = true
              } else {
                if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) return false
              }
            }
          }
          return false
        })()
        // with-initializer + subpattern designators: the first direct
        // identifier child names the member (never reads, never binds).
        const isMemberDesignator = !!p && (p.type === "with_initializer" || p.type === "subpattern") &&
          (() => {
            const first = firstIdent(p)
            return !!first && first.startIndex === node.startIndex && first.endIndex === node.endIndex
          })()
        // `out x` writes (bare existing var); `out <decl>` binds above.
        // `ref`/`in` read.
        const isOutWrite = !!p && p.type === "argument" &&
          (() => {
            let sawOut = false
            for (let i = 0; i < p.childCount; i++) {
              const c = p.child(i)
              if (!c) continue
              if (!c.isNamed && c.type === "out") { sawOut = true; continue }
              if (c.isNamed) {
                if (c.type === "declaration_expression") return false
                if ((c.type === "identifier" ) &&
                  c.startIndex === node.startIndex && c.endIndex === node.endIndex) return sawOut
                return false
              }
            }
            return false
          })()
        // Deconstruction writes: identifiers in the LHS tuple of an
        // assignment (nested reads inside still read via their own rules —
        // this only covers identifiers whose nearest tuple/call/index/
        // member/lambda boundary is the LHS itself).
        const isDeconWrite = (() => {
          let cur: Node | null = node
          let q: Node | null = p
          while (q && (q.type === "tuple_expression" || q.type === "argument" || q.type === "parenthesized_expression")) {
            cur = q
            q = q.parent
          }
          if (!q || q.type !== "assignment_expression") return false
          const lhs = q.namedChild(0)
          return !!lhs && cur.startIndex >= lhs.startIndex && cur.endIndex <= lhs.endIndex
        })()
        // Member declarator names declare symbols (never read, never bind
        // here — locals self-suppress via shadowing). Covers both wrapped
        // (`int *p`, leftmost match) and flat field shapes (first direct).
        const isMemberDeclName = (() => {
          if (!p) return false
          if (p.type === "variable_declarator") {
            const nm = declaratorName(p)
            return !!nm && nm.startIndex === node.startIndex && nm.endIndex === node.endIndex &&
              declaratorRole(p) === "member"
          }
          if (p.type === "field_declaration") {
            const first = firstIdent(p)
            return !!first && first.startIndex === node.startIndex && first.endIndex === node.endIndex
          }
          return false
        })()
        // Type contexts never read values: type parameter lists declare
        // type params; where-clause and base-list subtrees mention only
        // types; tuple types name members-or-pattern-vars, never values
        // (tuple EXPRESSIONS are a different node and read normally).
        const isTypeContextName = (() => {
          if (!p) return false
          if (p.type === "type_parameter_list") return true
          let q: Node | null = p
          while (q) {
            const t: string = q.type
            if (t === "type_parameter_constraints_clause" || t === "base_list") return true
            if (t === "tuple_type") return true
            if (
              t.includes("statement") || t.includes("declaration") ||
              t.includes("block") || t.includes("function") ||
              t.includes("body") || t.includes("clause") && t !== "type_parameter_constraints_clause"
            ) return false
            q = q.parent
          }
          return false
        })()
        // Write-position foreach variables (`foreach (x in ys)` with no
        // type): assigned, never declared and never read here. (Declared
        // forms bind in the branch above and self-suppress; the source
        // `ys` is always last and always reads.) Positional rule: a direct
        // identifier child that is not the last child never reads — the
        // loop variable precedes the source in every shape.
        const isForeachWrite = !!p && p.type === "foreach_statement" &&
          (() => {
            let last: Node | null = null
            for (let i = p.namedChildCount - 1; i >= 0; i--) {
              const c = p.namedChild(i)
              if (c && c.type !== "block") { last = c; break }
            }
            if (!last || last.type === "block") return false
            for (let i = 0; i < p.namedChildCount; i++) {
              const c = p.namedChild(i)
              if (!c || c === last || c.type === "block") continue
              if (c.type === "identifier" && c.startIndex === node.startIndex && c.endIndex === node.endIndex) return true
            }
            return false
          })()
        // Deconstruction LHS arguments: direct identifier children never
        // read here — declared names self-suppress via shadowing, plain
        // names are writes (the tuple branch above binds exactly the
        // declaring ones).
        const isDeconArgName = !!p && p.type === "argument" &&
          (() => {
            let q: Node | null = p.parent
            while (q && q.type === "parenthesized_expression") q = q.parent
            if (!q || q.type !== "tuple_expression") return false
            const a = q.parent
            if (!a || a.type !== "assignment_expression") return false
            const lhs = a.namedChild(0)
            if (!lhs || q.startIndex < lhs.startIndex || q.endIndex > (lhs.endIndex ?? 0)) return false
            return node.type === "identifier"
          })()
        // Using directives and extern aliases are imports (handled by the
        // import logic) — their names never read as values.
        const isImportName = (() => {
          if (!p) return false
          for (let i = 0; i < importSpans.length; i++) {
            const sp = importSpans[i]
            if (p.startIndex >= sp[0] && p.endIndex <= sp[1]) return true
          }
          return false
        })()
        // Pattern heads that are invocations (`Point(1, y)` under a pattern
        // context) are patterns, not calls — but the invocation keeps its
        // shape, so the callee rule below already skips it only when the
        // calls branch owns it. Bare identifiers inside pattern-position
        // invocations are constant-pattern reads and flow through normally.
        if (
          name && name !== "_" &&
          !isAttrName && !isNamedArgDesignator && !isAnonDesignator &&
          !isMemberDesignator && !isOutWrite && !isDeconWrite &&
          !isDeconArgName &&
          !isMemberDeclName && !isForeachWrite && !isImportName &&
          !isTypeContextName &&
          !this.isInValueSetter(node) &&
          !this.isNameofOperand(node) &&
          !this.isCSharpCallCalleeShaped(node) &&
          !this.isCSharpMemberLeaf(node) &&
          !this.isCSharpQualifiedNamePart(node) &&
          !this.isCSharpNamePosition(node) &&
          !this.isCSharpPreprocText(node) &&
          !this.isCSharpLabelOrDiscard(node) &&
          !this.isCSharpEntityName(node) &&
          !this.isCSharpAssignLhs(node) &&
          !isShadowed(name) &&
          isResolvableRead(name)
        ) {
          // Source attribution: enclosing method/ctor/property if any,
          // else the innermost enclosing class (member initializers and
          // class-level attribute arguments read in class scope — strictly
          // more precise than "global"), else global (top-level statements).
          let clsScope: string | null = null
          for (let i = scopeStack.length - 1; i >= 0; i--) {
            if (scopeStack[i].cls) { clsScope = scopeStack[i].cls; break }
          }
          const src = this.findContainingCSharpFunction(node) || clsScope || "global"
          const key = `${src}::uses::${name}`
          if (!emitted.has(key)) {
            emitted.add(key)
            relationships.push({
              source: src,
              target: name,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              // M59.A7 (#825): the identifier node IS the node that names the
              // target (this pass visits the read itself).
              line_number: this.nodeLine(node),
              metadata: { relationshipType: "identifier_usage", nodeType: node.type },
            })
          }
        }
      }
      stack.push({ node, exit: true, pushed: pushedScope })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, exit: false, pushed: false })
      }
    }
  }

  /**
   * CS-R1 gate helpers (see analyzeCSharpBareIdentifierUses for the contract).
   * All climb-based, span-compared (never object identity — web-tree-sitter
   * wraps per retrieval), mirroring the family gates where they exist.
   */

  /** True when `node` is the implicit `value` parameter of a set/init/add/remove accessor. */
  private isInValueSetter(node: Node): boolean {
    if (node.text !== "value") return false
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      if (t === "accessor_declaration") {
        for (let i = 0; i < cur.childCount; i++) {
          const c = cur.child(i)
          if (c && !c.isNamed && (c.type === "set" || c.type === "init" || c.type === "add" || c.type === "remove")) {
            return true
          }
        }
        return false
      }
      if (
        t === "method_declaration" || t === "constructor_declaration" ||
        t === "local_function_statement" || t === "lambda_expression" ||
        t === "class_declaration" || t === "struct_declaration" ||
        t === "interface_declaration" || t === "record_declaration" ||
        t === "enum_declaration"
      ) return false
      cur = cur.parent
    }
    return false
  }

  /** True when `node` is (part of) the callee the calls branch owns. */
  private isCSharpCallCalleeShaped(node: Node): boolean {
    let top: Node = node
    let p: Node | null = node.parent
    while (p && (p.type === "generic_name" || p.type === "parenthesized_expression")) {
      top = p
      p = p.parent
    }
    // Member-access callee (`o.M()`, `o.M<T>()`): only the member side is
    // the callee — the receiver reads (never climb through it blindly).
    if (p && p.type === "member_access_expression") {
      const expr = p.childForFieldName("expression")
      if (expr && node.startIndex >= expr.startIndex && node.endIndex <= expr.endIndex) return false
      top = p
      p = p.parent
    }
    // Null-conditional callee (`x?.M()`): the member binding is always the
    // member side (it has no receiver child to confuse).
    if (p && p.type === "member_binding_expression") {
      top = p
      p = p.parent
      if (p && p.type === "conditional_access_expression") {
        top = p
        p = p.parent
      }
    }
    if (!p || p.type !== "invocation_expression") return false
    const fn = p.childForFieldName("function")
    return !!fn && top.startIndex >= fn.startIndex && top.endIndex <= fn.endIndex
  }

  /** True when `node` is the member LEAF the field pass owns. */
  private isCSharpMemberLeaf(node: Node): boolean {
    const p = node.parent
    if (!p || p.type !== "member_access_expression") return false
    const field = p.childForFieldName("name")
    return !!field && field.startIndex === node.startIndex && field.endIndex === node.endIndex
  }

  /** True when `node` sits under a qualified_name (types/namespaces — never value reads). */
  private isCSharpQualifiedNamePart(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "qualified_name") return true
      cur = cur.parent
    }
    return false
  }

  /** True for name/type positions that never read values. */
  private isCSharpNamePosition(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      // typeof/default/sizeof operands name declarations. (There is no
      // name_of_expression node in this grammar — nameof parses as an
      // invocation; its operand is gated by isNameofOperand, not here.)
      if (
        t === "typeof_expression" || t === "default_expression" ||
        t === "sizeof_expression"
      ) return true
      // `is`/`as` type operands: only the first child reads.
      if (t === "is_expression" || t === "as_expression") {
        const first = cur.namedChild(0)
        return !first || node.startIndex < first.startIndex || node.endIndex > first.endIndex
      }
      if (
        t.includes("statement") || t.includes("declaration") ||
        t.includes("expression") || t.includes("clause") ||
        t.includes("function") || t.includes("body") ||
        t.includes("pattern") || t.includes("argument")
      ) return false
      cur = cur.parent
    }
    return false
  }

  /** True when `node` is the operand of a `nameof(...)` (names, never reads). */
  private isNameofOperand(node: Node): boolean {
    const calleeIsNameof = (inv: Node): boolean => {
      const fn = inv.childForFieldName("function")
      return !!fn && fn.type === "identifier" && fn.text === "nameof"
    }
    const p0 = node.parent
    if (p0 && p0.type === "invocation_expression") return calleeIsNameof(p0)
    let cur: Node | null = p0
    while (cur && (cur.type === "argument_list" || cur.type === "argument" || cur.type === "parenthesized_expression")) {
      cur = cur.parent
      if (cur && cur.type === "invocation_expression") return calleeIsNameof(cur)
    }
    return false
  }

  /** True for preprocessor-directive text with no code container between (CGD11 contract). */
  private isCSharpPreprocText(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      if (
        t.includes("statement") || t.includes("declaration") ||
        t.includes("declarator") || t.includes("specifier") ||
        t.includes("enumerator") || t.includes("compound") ||
        t.includes("argument_list") || t.includes("init") ||
        t.includes("expression") || t.includes("function") ||
        t.includes("class_body") || t.includes("field_declaration_list") ||
        t.includes("block")
      ) return false
      if (t.startsWith("preproc_")) return true
      cur = cur.parent
    }
    return false
  }

  /** True for goto/break/continue/label identifiers (never values). */
  private isCSharpLabelOrDiscard(node: Node): boolean {
    const p = node.parent
    return !!p && (
      p.type === "goto_statement" || p.type === "break_statement" ||
      p.type === "continue_statement" || p.type === "labeled_statement"
    )
  }

  /** True when `node` is the defining NAME of its entity parent, or a TYPE it declares. */
  /**
   * CS-D8 helper: is this identifier inside a declared TYPE, judged by which declaration owns a
   * `type` field that CONTAINS it? See the CS-D8 note in `isCSharpEntityName` for why the walk
   * ascends through name-shaped wrappers and why it is bounded.
   */
  private isDeclaredTypeSite(node: Node): boolean {
    const DECL = "declaration"
    let cur: Node | null = node.parent
    for (let hops = 0; cur && hops < 12; hops++) {
      const t: string = cur.type
      if (
        t === "variable_declaration" || t === "parameter" ||
        t === "property_declaration" || t === "indexer_declaration" ||
        t === "event_declaration" || t === "event_field_declaration" ||
        t === "variable_declarator" || t === "base_list" ||
        t === "type_parameter_list" || t === "type_parameter_constraints_clause" ||
        t === "delegate_declaration"
      ) {
        const tf = cur.childForFieldName("type")
        if (tf && node.startIndex >= tf.startIndex && node.endIndex <= tf.endIndex) return true
        // A `variable_declarator` is the boundary between the declaration's TYPE and its
        // INITIALIZER, so a read inside `var f = Some.Field;` must stop the walk here rather
        // than inherit the `var`'s type position. Without this, every initializer read in the
        // language is gated by the keyword that introduces it.
        if (t === "variable_declarator") return false
      }
      if (t.includes(DECL) || t === "class_body" || t === "block" || t.includes("statement")) return false
      cur = cur.parent
    }
    return false
  }

  private isCSharpEntityName(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    // CS-D7 (2026-09-28, the `uses`-oracle round): a declared TYPE is never a value read, and
    // the grammar does not put a field's type directly under `field_declaration` — it nests it:
    //
    //     field_declaration > variable_declaration [ type = identifier, variable_declarator [ … ] ]
    //
    // so the "first direct identifier child" rule below never saw it, and a field whose TYPE
    // name collides with a MEMBER of the same class published a read of itself:
    // `public Widget Widget;` -> `uses Holder -> Widget`, stamped on the field's own line. The
    // read resolves because the class-chain inventory holds a Property-kind member of exactly
    // that name, and the shadowing frame cannot help: the shadow and the read are the same
    // identifier. Probe: script/m14/tmp/cs-deep-22-type-as-value.ts, cases T1/T3.
    //
    // The `type` FIELD is the grammar's own statement of "this is a type", so the gate reads the
    // field rather than counting children. Nothing is lost: the declared-type reference graph
    // already publishes this name, and it is the position that owns it (R9).
    // SPAN containment, not equality — and the reason is CS-D8's third shape. For
    // `Func<Gadget, Gadget> f = …` the `type` field is a `generic_name` and the name is NESTED
    // inside it, so an equality test against the field's own offsets misses the very case it was
    // written for. The fixture case that found it is a lambda whose types come from the delegate
    // type rather than from a lambda parameter list, so there is no `parameter` node to gate:
    //
    //     public void TakesDoodadInLambda() { Func<Doodad, Doodad> f = doodad => doodad; }
    //                                               ^^^^^^ a TYPE ARGUMENT, pre-fix published
    //                                               as `uses TakesDoodadInLambda -> Doodad`
    //
    // This is the same rule, the same reason, and the same round as the `parameter` gate below;
    // the two differ only in which node carries the `type` field. Measured, not assumed: 6 rows
    // over 200 roslyn files from the corpus sweep (script/m14/tmp/cs-deep-33-param-type-scope.ts).
    // CS-D8 (2026-09-28, the bare-`uses`-oracle round): a declared TYPE is never a value read, in
    // any position, and the position is found by asking which DECLARATION owns a `type` field that
    // CONTAINS this identifier. The walk goes UP through the name-shaped type wrappers, because
    // the identifier's own parent is not the declaration: for `Func<Gadget, Gadget> f = …` the
    // immediate parent is the `generic_name`, and the node that owns the type is the
    // `variable_declaration` two levels above it.
    //
    // Why containment and not equality: an equality test against the `type` field's own offsets
    // passes for `Gadget gadget` and fails for `Func<Gadget, Gadget>`, which is the case that
    // matters. And why the walk CONTINUES past a `generic_name` rather than stopping at it: the
    // same node type spells a TYPE in a declaration and a METHOD in an expression, and the
    // distinguishing fact is which declaration's `type` field encloses it. Stopping at the first
    // `generic_name` ancestor gated every read that reaches a generic method — the most common
    // shape in modern C# — and cost one real row in 200 files
    // (`Document.GetRequiredLanguageService<ISyntaxFactsService>()`, cs-deep-26).
    //
    // Bounded at 12 ancestors: a type expression is never deeper than that from the declaration
    // that owns it (argument > type_argument > generic_name > variable_declaration), and the
    // bound keeps this off the per-identifier cost path.
    if (this.isDeclaredTypeSite(node)) return true
    {
      const nf0 = p?.childForFieldName?.("name")
      if (nf0 && nf0.startIndex === node.startIndex && nf0.endIndex === node.endIndex) return true
    }
    // The same round, second half: for a PROPERTY the first direct identifier is the TYPE, so
    // the rule below gated the type and let the property's own NAME through — and a property
    // whose name collides with a member published a read of ITSELF (`public Widget Widget
    // { get; set; }` -> `uses Widget -> Widget`, case T4). The `name` FIELD is the grammar's own
    // statement of "this is the declared name", so it is read the same way. This is the rule the
    // function was named for, applied to the field that actually carries the name instead of to
    // a child-count proxy for it.
    {
      const nf = p.childForFieldName("name")
      if (nf && nf.startIndex === node.startIndex && nf.endIndex === node.endIndex) return true
    }
    switch (p.type) {
      case "class_declaration":
      case "struct_declaration":
      case "interface_declaration":
      case "record_declaration":
      case "enum_declaration":
      case "delegate_declaration":
      case "method_declaration":
      case "constructor_declaration":
      case "destructor_declaration":
      case "operator_declaration":
      case "conversion_operator_declaration":
      case "property_declaration":
      case "indexer_declaration":
      case "event_declaration":
      case "event_field_declaration":
      case "enum_member_declaration":
      case "namespace_declaration":
      case "file_scoped_namespace_declaration":
        break
      default:
        return false
    }
    for (let i = 0; i < p.namedChildCount; i++) {
      const c = p.namedChild(i)
      if (c && c.type === "identifier") {
        return c.startIndex === node.startIndex && c.endIndex === node.endIndex
      }
    }
    return false
  }

  /** True when `node` is an assignment-LHS write (GO9-class climb). */
  private isCSharpAssignLhs(node: Node): boolean {
    let cur: Node | null = node
    let p: Node | null = node.parent
    // Climb through assignment-transparent wrappers only (tuples for
    // deconstruction are handled by the dedicated rule — a bare tuple
    // element here would double-skip; parens are transparent).
    while (p && p.type === "parenthesized_expression") {
      cur = p
      p = p.parent
    }
    if (!p || p.type !== "assignment_expression") return false
    const lhs = p.namedChild(0)
    return !!lhs && cur.startIndex >= lhs.startIndex && cur.endIndex <= lhs.endIndex
  }

  /** Find the nearest enclosing method/constructor/property symbol name. */
  private findContainingCSharpFunction(node: Node): string | null {
    let cur: Node | null = node.parent
    while (cur) {
      if (
        cur.type === "method_declaration" || cur.type === "constructor_declaration" ||
        cur.type === "destructor_declaration"
      ) {
        const name =
          cur.childForFieldName("name")?.text ||
          this.childText(cur, "identifier") ||
          (cur.type === "constructor_declaration" ? "constructor" : "anonymous")
        if (cur.type === "constructor_declaration") return "constructor"
        if (cur.type === "destructor_declaration") return "Finalize"
        return name
      }
      if (cur.type === "property_declaration" || cur.type === "indexer_declaration") {
        return cur.type === "indexer_declaration" ? "this" : cur.childForFieldName("name")?.text || this.childText(cur, "identifier") || "anonymous"
      }
      cur = cur.parent
    }
    return null
  }

  private buildCSharpCallExpression(node: Node): string | null {
    const func = node.childForFieldName("function") || this.findChild(node, (n) => n.type === "identifier" || n.type === "generic_name" || n.type === "member_access_expression")
    if (!func) return null
    if (func.type === "member_access_expression") {
      const nameNode = func.childForFieldName("name")
      const exprNode = func.childForFieldName("expression")
      if (!nameNode) return null
      const leaf = nameNode.type === "generic_name" ? nameNode.childForFieldName("name")?.text || nameNode.text.split("<")[0] : nameNode.text
      if (exprNode) {
        const expr = this.cleanTypeName(exprNode.text)
        return `${expr}.${leaf}`
      }
      return leaf
    }
    if (func.type === "generic_name") {
      return func.childForFieldName("name")?.text || func.text.split("<")[0]
    }
    return func.text
  }

  private resolveImplicitNewType(node: Node, memberTypes: Map<string, string>): string | null {
    // CSD14 (OO family closure 2026-09): single shared source of truth with
    // the differential oracle (csharpResolveTargetTypedNew) — element-type
    // resolution through array/generic collection members plus guarded bail
    // on nested expression contexts. Both sides previously carried their own
    // divergent copies (the oracle's DFS even picked argument identifiers as
    // targets).
    return csharpResolveTargetTypedNew(node, memberTypes)
  }

  // ≡ /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) — zero-regex helper (M49 closure
  // wave). \w ≡ [A-Za-z0-9_] in non-unicode mode.
  private isPlainIdentifier(s: string): boolean {
    if (s.length === 0) return false
    const c0 = s.charCodeAt(0)
    const firstOk = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95
    if (!firstOk) return false
    for (let i = 1; i < s.length; i++) {
      const c = s.charCodeAt(i)
      const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
      if (!ok) return false
    }
    return true
  }

  // ≡ /:\s*base\s*\(/ (zero-regex helper, M49 closure wave): colon, any
  // whitespace run, "base", optional whitespace, open paren.
  private matchesBaseInitializer(text: string): boolean {
    let i = text.indexOf(":")
    if (i === -1) return false
    i++
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++
    if (!text.startsWith("base", i)) return false
    i += 4
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++
    return i < text.length && text[i] === "("
  }

  private isCSharpBuiltin(call: string): boolean {
    if (CSHARP_BUILTINS.has(call)) return true
    // Leaf Object methods (toString-style calls without qualification)
    const leaf = call.split(".").pop() || call
    if (leaf === "ToString" || leaf === "GetHashCode" || leaf === "Equals" || leaf === "GetType" || leaf === "ReferenceEquals") return true
    // System.* roots are external framework calls — kept (like Java's JDK
    // calls). Only the explicit builtin list is filtered.
    return false
  }

  private extractVisibility(node: Node): "public" | "private" | "protected" | "internal" | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "modifier") {
        const text = child.text
        if (text === "public") return "public"
        if (text === "private") return "private"
        if (text === "protected") return "protected"
        if (text === "internal") return "internal"
        // CS-B4 (csharp review): `file`-scoped types are visible only in
        // their own file — never public API. Closest representable value
        // is private (probe: `file class Hidden` reported undefined and
        // was exported).
        if (text === "file") return "private"
      }
    }
    return undefined
  }

  private hasModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "modifier" && child.text === modifier) return true
    }
    return false
  }

  private extractNamespaceName(node: Node): string {
    // file-scoped: `namespace A.B;` → qualified_name; block: `namespace A.B {`
    const nameNode = this.findChild(node, (n) => n.type === "qualified_name" || n.type === "identifier")
    return nameNode ? nameNode.text : "anonymous"
  }

  private cleanTypeName(text: string): string {
    // Strip generic arguments and nullable/array suffixes for identity, and the alias
    // qualifier (one definition, `csharpTypeSpelling`, shared with the differential
    // oracle's mirror).
    const spelled = csharpTypeSpelling(text)
    const lt = spelled.indexOf("<")
    const base = lt > 0 ? spelled.slice(0, lt) : spelled
    const q = base.indexOf("?")
    return (q > 0 ? base.slice(0, q) : base).trim()
  }

  /**
   * A type's DECLARATION path: itself, qualified by enclosing TYPE declarations only.
   *
   * `buildFullName` qualifies with every enclosing scope including NAMESPACES, which is
   * right for an FQN and wrong for a relationship source. This lane's hand-audited truth
   * labels an extends/implements edge at the declared name — `BaseService`, `UserService`,
   * `Shape`, `IRepository` — and for a NESTED type it keeps the enclosing type but still
   * drops the namespace: `UserService.User -> BaseService.Entity`, not
   * `Example.Service.UserService.User`. That is why the nested row matched before this fix
   * and the seven top-level ones did not: `UserService.User` happens to equal the declared
   * path while `Example.Base.BaseService` does not.
   *
   * So seven false negatives were a label, not a missing edge.
   */
  private declarationPath(scopeStack: Scope[], name: string): string {
    const segs: string[] = []
    for (let i = 0; i < scopeStack.length; i++) {
      if (scopeStack[i].kind === ASTEngine.SymbolKind.Namespace) continue
      segs.push(scopeStack[i].rawName)
    }
    segs.push(name)
    return segs.join(".")
  }

  private buildFullName(scopeStack: { rawName: string }[], name: string): string {
    if (scopeStack.length === 0) return name
    let res = ""
    for (let i = 0; i < scopeStack.length; i++) {
      res += scopeStack[i].rawName + "."
    }
    return res + name
  }

  private extractTypeString(node: Node): string | undefined {
    const typeNodes = [
      "predefined_type", "type_identifier", "identifier", "generic_name",
      "array_type", "nullable_type", "tuple_type", "implicit_type",
    ]
    for (let idx = 0; idx < typeNodes.length; idx++) {
      const t = typeNodes[idx]
      const found = this.findChild(node, (n) => n.type === t)
      if (found) return found.text
    }
    return undefined
  }

  private extractAttributes(node: Node): string[] {
    const attrs: string[] = []
    const attrLists = this.findAllChildren(node, "attribute_list")
    for (let idx = 0; idx < attrLists.length; idx++) {
      const list = attrLists[idx]
      for (let i = 0; i < list.namedChildCount; i++) {
        const attr = list.namedChild(i)
        if (attr && attr.type === "attribute") {
          // C2a: the name of an attribute is a type name, so it takes the same two rules as
          // every other one — `alias_qualified_name` is a name node too (omitting it dropped
          // `[global::Root]` from the decorator list entirely: measured, the qualified class
          // published `decorators: []` while its plain twin published `["Root"]`), and the
          // qualifier is not part of the name it publishes.
          //
          // D2 (2026-09-28, this round): the same omission, one node type further on. A
          // GENERIC attribute's name child is a `generic_name` — a fourth shape this
          // predicate never named — so `[Marker<int>]` published `decorators: []` while its
          // plain twin `[Marker]` published `["Marker"]`. And the twin that DOES get named,
          // `[System.Marker<int>]`, published `"System.Marker<int>"`: a type EXPRESSION where
          // the position publishes a NAME, which is the defect class R10 exists to catch (its
          // DELIMITER set `;(){},` would have convicted the `,` on any corpus holding the
          // shape; over 1,500 roslyn files the shape occurs once, and 13 times in 1,500
          // aspnetcore files — `[JSMarshalAs<JSType.Number>]`, `[TestRenderMode<…>]`,
          // production code, measured by script/m14/tmp/cs-deep-12-frequencies.ts).
          //
          // So this position now goes through the lane's ONE canonical-name rule, the same
          // `csharpCleanTypeLeaf` that strips generic arguments and nullability in heritage,
          // creation and target-typed `new()`: an attribute publishes the type's NAME with its
          // full dotted path intact (`System.Marker`) and its type arguments dropped
          // (`Marker`). Two wrongs, one cause, one rule — and the `generic_name` shape is now
          // in the predicate so it is not silently absent.
          const nameNode = this.findChild(attr, (n) =>
            n.type === "identifier" || n.type === "generic_name" ||
            n.type === "qualified_name" || n.type === "alias_qualified_name")
          if (nameNode) {
            const name = csharpCleanTypeLeaf(csharpTypeNameText(csharpTypeSpelling(nameNode.text)))
            if (name) attrs.push(name)
          }
        }
      }
    }
    return attrs
  }

  /**
   * M59.A7 (#825): the 1-based line of the node that NAMES an edge's target.
   *
   * The contract is the family's, not this file's: a relationship's
   * `line_number` is the line where the TARGET is written — the callee for a
   * call, the read for a member use, the constructed type for an instantiation,
   * the symbol's own declaration for contains/overrides. It is checked
   * independently by script/m59/oracle-callsite.ts, which re-derives every edge
   * from the tree and requires the target token to appear on the claimed line.
   *
   * Three shapes are traps and all three were measured on this lane (probe:
   * script/m14/tmp/cs-line-shapes.ts) rather than assumed:
   *   * an invocation node starts at its RECEIVER, so `helper\n  .Strip()` needs
   *     the callee leaf, not the call node;
   *   * a `constructor_initializer` starts at its `:` and `base`/`this` are
   *     anonymous children, so a wrapped initializer needs the keyword token or
   *     it lands one line early;
   *   * a target-typed `new()` names NO type at the call site at all — the
   *     target is written in the DECLARATION (see targetTypedNewTypeNode).
   *
   * `undefined` is a first-class answer. A node that does not exist contributes
   * NO line rather than a fabricated 0, which is the rule `0 means unknown and
   * unknown must be absent` (#820/#821) applied to this field.
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
  }

  /**
   * The `base` / `this` keyword of a constructor_initializer.
   *
   * Both are ANONYMOUS tokens in tree-sitter-c-sharp, so findChild (named
   * children only) cannot see them, and the initializer node itself starts at
   * the `:`. Measured: `public C(int x)\n  :\n    base(x)` puts the colon on 3
   * and the keyword on 4 — the keyword is the node that names the target.
   */
  private initializerKeywordNode(node: Node): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && (child.type === "base" || child.type === "this")) return child
    }
    return null
  }

  /**
   * The FIRST anonymous child whose text is `text` — an operator or punctuation
   * token, which `findChild` (named children only) cannot see.
   *
   * Added for the M60.R1 paydown: a using directive's alias form is the only
   * shape that contains an `=`, and position (not text) is what tells the ALIAS
   * from the TARGET — see the using_directive branch. Returns the NODE, so the
   * caller can then ask for the child after it as well as its presence.
   */
  private anonymousChildNode(node: Node, text: string): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && child.type === text) return child
    }
    return null
  }

  /** The first NAMED child that starts after `after` ends — the target of an
   *  alias using, which the grammar writes after the `=`. */
  private firstNamedChildAfter(node: Node, after: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.startIndex >= after.endIndex) return child
    }
    return null
  }

  /**
   * The node that CARRIES a declaration's declared type.
   *
   * Mirrors csharpMemberDeclaredTypeText's holder resolution exactly (the same
   * three shapes: field_declaration > variable_declaration, a variable_declarator
   * whose type lives on the enclosing variable_declaration, and property/
   * indexer/other declarations that hold the type themselves), because the two
   * must never disagree about WHICH declaration answered — one writes the text,
   * the other is used for the line stamp.
   */
  private memberDeclaredTypeNode(memberLike: Node | null): Node | null {
    if (!memberLike) return null
    let holder: Node | null = memberLike
    if (memberLike.type === "field_declaration") {
      holder = this.findChild(memberLike, "variable_declaration")
    } else if (memberLike.type === "variable_declarator" && memberLike.parent?.type === "variable_declaration") {
      holder = memberLike.parent
    }
    if (!holder) return null
    const typeField = holder.childForFieldName("type")
    if (typeField) return typeField
    // Fallback: the first direct type-ish child that is not the node's NAME
    // field — the same CSD14 guard csharpMemberDeclaredTypeText carries (a
    // declaration's own name must never read as its type).
    const nameChild = holder.childForFieldName("name")
    for (let i = 0; i < holder.namedChildCount; i++) {
      const child = holder.namedChild(i)
      if (!child || !CSHARP_DECLARED_TYPE_NODES.has(child.type)) continue
      if (nameChild && child.startIndex === nameChild.startIndex && child.endIndex === nameChild.endIndex) continue
      return child
    }
    return null
  }

  /**
   * The narrowest node inside a type annotation whose text IS `target`.
   *
   * For `List<EnumSettingEntry> xs = new();` the target is the ELEMENT type, so
   * the node that names it is the type argument, not the annotation. Matching is
   * by exact text (then by csharpCleanTypeLeaf, which is the same unwrapping the
   * target text went through), and the narrowest match wins. No match means the
   * target was resolved from something other than a written name — an honest
   * no-line, never a guess at a nearby line.
   */
  private nodeNamingToken(typeNode: Node | null, target: string): Node | null {
    if (!typeNode) return null
    const parts = target.split(".")
    const leaf = parts[parts.length - 1] || target
    let best: Node | null = null
    const stack: Node[] = [typeNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const text = n.text
      if (text === leaf || csharpCleanTypeLeaf(text) === leaf) {
        if (!best || n.endIndex - n.startIndex <= best.endIndex - best.startIndex) best = n
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return best
  }

  /**
   * M59.A7 (#825), the target-typed-`new()` site.
   *
   * `List<T> xs = new();` writes its construction target in the DECLARATION, and
   * the assignment form (`xs = new();`) writes it on the MEMBER's declaration,
   * not on the assignment line. Both are reached through the shared walk
   * (csharpTargetTypedNewSite) so the stamp and the resolved target can never
   * describe different declarations; the member table carries the node for the
   * assignment form, because the declaration is in another subtree.
   */
  private targetTypedNewTypeNode(
    node: Node,
    memberTypes: Map<string, string>,
    memberTypeNodes: Map<string, Node>,
    target: string,
  ): Node | null {
    const site = csharpTargetTypedNewSite(node)
    if (!site) return null
    const holder = site.kind === "declaration" ? site.decl : memberTypeNodes.get(site.memberName) ?? null
    return this.nodeNamingToken(this.memberDeclaredTypeNode(holder), target)
  }

  /**
   * Is a call's callee a node that NAMES something?
   *
   * Found by a depth draw rather than by reading the code: on powershell's
   * `RunspaceConnectionInfo.cs` the grammar's error recovery (one ERROR node
   * spanning `false; return StartSSHProcessImpl(...)`) produced an
   * invocation_expression whose `function` field IS a `boolean_literal`, and the
   * analyzer emitted `calls StartSSHProcess -> false` — a fabricated call to a
   * literal, the only unexplained edge on a 900-file draw (line 2331, measured
   * with script/m14/tmp/cs-u2331-probe.ts). The old hygiene checked the target
   * STRING (keyword set + identifier shape + builtin set), and `false` is a
   * well-formed identifier as far as a string check can see. The rule is
   * structural instead: a callee names its target only if the node that carries
   * it is a NAME node (an identifier or a generic_name) — which is what the
   * existing keyword-list rejection encodes for the legal `if (...)` case, done
   * once for every junk-callee shape.
   */
  private isCSharpCalleeNameNode(node: Node | null): boolean {
    if (!node) return false
    return node.type === "identifier" || node.type === "generic_name"
  }

  /**
   * The node that names a call's target: the callee leaf.
   *
   * Mirrors buildCSharpCallExpression's leaf selection (the member-access NAME
   * field, a generic_name's name field, else the callee node itself) — that
   * function returns the text, this returns the node the text is written on.
   */
  private csharpCallCalleeNode(node: Node): Node | null {
    const func = node.childForFieldName("function") || this.findChild(node, (n) => n.type === "identifier" || n.type === "generic_name" || n.type === "member_access_expression")
    if (!func) return null
    if (func.type === "member_access_expression") {
      const nameNode = func.childForFieldName("name")
      if (!nameNode) return null
      return nameNode.type === "generic_name" ? nameNode.childForFieldName("name") ?? nameNode : nameNode
    }
    if (func.type === "generic_name") return func.childForFieldName("name") ?? func
    // `Overflow?.Invoke(x)` (the lane's CSD4 shape): a null-conditional call's
    // callee is a conditional_access_expression whose LAST member BINDING
    // (`.Invoke`) names it — and a binding carries no `name` field, so the leaf
    // is its identifier child. Returning the conditional access itself would
    // both mis-name the callee and stamp the RECEIVER's line (the trap this
    // round exists to remove); measured with script/m14/tmp/cs-conditional-callee.ts.
    if (func.type === "conditional_access_expression" || func.type === "member_binding_expression") {
      const binding = func.type === "member_binding_expression"
        ? func
        : this.findChild(func, (n) => n.type === "member_binding_expression")
      const leaf = binding ? this.csharpBindingLeaf(binding) : null
      return leaf ?? func
    }
    return func
  }

  /**
   * The identifier a `member_binding_expression` binds: the member name after
   * the dot (`.Invoke` -> `Invoke`). Walks the binding's children backwards
   * because the dot is an anonymous token and the name is the last name node.
   */
  private csharpBindingLeaf(binding: Node): Node | null {
    for (let i = binding.childCount - 1; i >= 0; i--) {
      const child = binding.child(i)
      if (!child) continue
      if (child.type === "identifier") return child
      if (child.type === "generic_name") return child.childForFieldName("name") ?? child
    }
    return null
  }

  private nodeToRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private findChild(node: Node, type: string | ((n: Node) => boolean)): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (typeof type === "string" ? child.type === type : type(child)) return child
    }
    return null
  }

  private findAllChildren(node: Node, type: string): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) res.push(child)
    }
    return res
  }

  private childText(node: Node, type: string): string | null {
    const child = this.findChild(node, type)
    return child ? child.text : null
  }
}

function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

// ============================================================================
// CONV-CS-2 (#751) FRAMEWORK DETECTION — family-aligned marker table
// ============================================================================
// Order = detection priority (application frameworks most-specific first,
// test frameworks last); the emitted detectedFrameworks array uses this
// order, so the payload is byte-stable regardless of source/import order.
const CS_FRAMEWORK_ORDER = [
  "ASP.NET Core",
  "Entity Framework Core",
  "Unity",
  "WPF",
  "Windows Forms",
  "xUnit",
  "NUnit",
  "MSTest",
]

const CS_FRAMEWORK_PATTERNS: Record<string, string[]> = {
  "ASP.NET Core": ["mvc_pattern", "api_endpoints"],
  "Entity Framework Core": ["orm_mapping", "repository_pattern"],
  Unity: ["game_engine"],
  WPF: ["ui_framework"],
  "Windows Forms": ["ui_framework"],
  xUnit: ["test_framework"],
  NUnit: ["test_framework"],
  MSTest: ["test_framework"],
}

function csharpSetHasAny(s: Set<string>, vs: string[]): boolean {
  for (let i = 0; i < vs.length; i++) if (s.has(vs[i])) return true
  return false
}

function csharpUsingPrefix(usings: Set<string>, prefix: string): boolean {
  for (const u of usings) {
    if (u === prefix || u.startsWith(prefix + ".")) return true
  }
  return false
}

const CS_FRAMEWORK_MARKERS: Record<
  string,
  (usings: Set<string>, bases: Set<string>, attributes: Set<string>) => boolean
> = {
  "ASP.NET Core": (u, b, a) =>
    csharpUsingPrefix(u, "Microsoft.AspNetCore") ||
    csharpSetHasAny(b, ["Controller", "ControllerBase", "PageModel", "Hub"]) ||
    csharpSetHasAny(a, ["ApiController", "HttpGet", "HttpPost", "HttpPut", "HttpDelete", "HttpPatch"]),
  "Entity Framework Core": (u, b) =>
    csharpUsingPrefix(u, "Microsoft.EntityFrameworkCore") ||
    b.has("DbContext"),
  Unity: (u, b) =>
    csharpUsingPrefix(u, "UnityEngine") ||
    csharpSetHasAny(b, ["MonoBehaviour", "ScriptableObject"]),
  WPF: (u, b) => {
    // `System.Windows.Forms` is a strict child path of `System.Windows` —
    // WinForms files must never double-report as WPF (Forms is checked
    // before window-level bases that WinForms code also uses).
    for (const x of u) {
      if (
        (x === "System.Windows" || x.startsWith("System.Windows.")) &&
        !(x === "System.Windows.Forms" || x.startsWith("System.Windows.Forms."))
      ) {
        return true
      }
    }
    return csharpSetHasAny(b, ["Window", "UserControl"])
  },
  "Windows Forms": (u, b) =>
    csharpUsingPrefix(u, "System.Windows.Forms") ||
    b.has("Form"),
  xUnit: (u, _b, a) =>
    csharpUsingPrefix(u, "Xunit") ||
    csharpSetHasAny(a, ["Fact", "Theory"]),
  NUnit: (u, _b, a) =>
    csharpUsingPrefix(u, "NUnit") ||
    a.has("TestFixture"),
  MSTest: (u, _b, a) =>
    csharpUsingPrefix(u, "Microsoft.VisualStudio.TestTools") ||
    csharpSetHasAny(a, ["TestClass", "TestMethod"]),
}

/**
 * Dotted path of a using_directive's text: strips `global` / `using` /
 * `static` keywords and resolves aliases to their SOURCE path
 * (`using E = X.Y;` -> `X.Y`), so marker matching sees what the file
 * actually references.
 */
function csharpUsingDirectivePath(text: string): string | undefined {
  let t = text.trim()
  const semi = t.indexOf(";")
  if (semi >= 0) t = t.slice(0, semi)
  t = t.trim()
  for (;;) {
    if (t.startsWith("global ")) { t = t.slice(7).trim(); continue }
    if (t.startsWith("using ")) { t = t.slice(6).trim(); continue }
    if (t.startsWith("static ")) { t = t.slice(7).trim(); continue }
    break
  }
  const eq = t.indexOf("=")
  if (eq >= 0) t = t.slice(eq + 1).trim()
  const space = t.indexOf(" ")
  if (space >= 0) t = t.slice(0, space)
  return t.length > 0 ? t : undefined
}

/**
 * Leaf type name of a base-list entry / attribute name / qualified type:
 * identifier -> itself; generic_name -> its name child;
 * primary_constructor_base_type -> its inner type; qualified_name /
 * alias_qualified_name -> their rightmost member.
 */
// The leaf rule has ONE implementation (csharpTypeLeafNode, above the class); this
// name-only view delegates to it so the R9 declared-type walk and the base-list /
// framework detection can never disagree about which token a type name's leaf is.
function csharpTypeLeafName(n: Node): string | undefined {
  const leaf = csharpTypeLeafNode(n)
  return leaf ? leaf.text : undefined
}
