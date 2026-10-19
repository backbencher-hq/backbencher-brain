// AN INDEPENDENT ORACLE for elixir `contains` — the DERIVATION debt this lane
// carries.
//
// WHY THIS FILE EXISTS. A DERIVATION finding is a relationship type an analyzer
// EMITS that the differential never AUDITS: stored, and compared against
// nothing. `bun script/m60/rel-type-coverage-gate.ts --langs=elixir` on
// 2026-10-05 reported exactly one for this lane:
//
//     elixir   1 un-audited: ["contains"]
//
// because `deriveElixirEdges` in script/m14/differential.ts pushes four labels
// — calls, implements, instantiates, references (measured: 3 push("calls"),
// 4 push("implements"), 4 push("instantiates"), 2 push("references") inside that
// function's span) — and `contains` is not one of them. All 9,873 `contains`
// edges this lane emitted over 601 corpus files were in that blind spot. A
// 9,873-edge class of the graph with no oracle is where a symbol-identity defect
// sits with nothing able to see it.
//
// WHAT AN ORACLE IS AND IS NOT, said here so the verdict is not overstated. The
// oracle is a SEPARATE WALKER OVER THE SAME GRAMMAR. It can refute the
// analyzer; it cannot confirm it. A shape both of us misread is invisible to
// both, and this file does not claim otherwise. It is written for the same
// reason script/m14/oracles/solidity.ts is: to make disagreement measurable.
//
// INDEPENDENCE, and where it stops. It shares no helper with
// src/ast/real-elixir-analyzer.ts and it uses a DIFFERENT traversal mechanism on
// purpose:
//   - the analyzer pushes NODES onto a work stack and pops them
//     (`stack: { node, isExit? }[]`);
//   - this oracle walks a TreeCursor and maintains its own declaration stack,
//     so a bug in the analyzer's push/pop pairing cannot be reproduced here by
//     the same mistake.
// It also derives ownership from the ELIXIR rule ("a symbol's owner is the
// innermost enclosing DECLARATION") by maintaining a scope stack of its own,
// and it dedupes by (owner, name) because Elixir merges a multi-clause head
// into one function.
//
// NO REGEX. Node types are compared with `===` and a Set; every name is a
// node's `.text` or a `split(".")` slice.

// The walk below reads `parent` and `startIndex`, so the cursor is a tree-sitter
// Node and not the global (`DOM`) `Node` this file was silently getting: the two
// type annotations named a class the module never imported, and TS resolved the
// name to the only `Node` in scope. Type-only, so the emitted module is unchanged.
import type { Node } from "web-tree-sitter"

export interface TruthEdge {
  label: string
  from: string
  target: string
}

// Declaration forms, from Elixir's Kernel/Protocol/Access macros.
const DEF_FORMS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
const TYPE_ATTRS = new Set(["type", "typep", "opaque"])
const CALLBACK_ATTRS = new Set(["callback", "macrocallback"])
// Elixir's `quote do ... end` is data (M12.23 quote-as-data; Clojure parity).
const QUOTE_FORMS = new Set(["quote"])

function kids(n: any): any[] {
  const r: any[] = []
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) r.push(c) }
  return r
}
function firstOfType(n: any, t: string): any {
  for (const c of kids(n)) if (c.type === t) return c
  return undefined
}

/** The call-shaped name of a `call` node: its identifier or dot target. */
function callName(n: any): string {
  if (n.type !== "call") return ""
  const id = firstOfType(n, "identifier") ?? firstOfType(n, "dot")
  return id ? id.text : ""
}

function argumentsOf(n: any): any {
  return firstOfType(n, "arguments")
}

/**
 * The declared name of a `defmodule` / `defprotocol`: the `alias` inside its
 * arguments. Multi-segment aliases are names, not inheritance, and they are kept
 * whole — this is the same fact probe A1 counts on the corpus (1,754 dotted
 * `defmodule` sites in 534 files) and it is why the `extends` verdict is a
 * ruling rather than an omission.
 */
function moduleNameOf(n: any): string {
  const args = argumentsOf(n)
  if (!args) return ""
  const a = firstOfType(args, "alias")
  return a ? a.text : ""
}

/** True when `n` sits inside any `quote do ... end` in the chain. */
function insideQuote(n: any): boolean {
  let cur = n.parent
  while (cur) {
    if (cur.type === "call" && QUOTE_FORMS.has(callName(cur))) return true
    cur = cur.parent
  }
  return false
}

/**
 * The declared name of a `def`/`defmacro`/… head. Measured tree shapes, all
 * four:
 *   `def foo(x)`      call > arguments > call(identifier=foo, arguments)
 *   `def foo(x) when` call > arguments > binary_operator(when, left, right)
 *   `defmacro (..)`    call > arguments > block > operator_identifier   (EX-A15)
 *   `def +value`       call > arguments > unary_operator > operator token
 *
 * The `when` shape is the one that costs a whole subtree if it is missed: the
 * binary operator's left operand is the head, and taking `left.text` instead of
 * the head's own name publishes `unrequire_files([binary])` as a symbol. That is
 * not hypothetical — it is what the first version of this oracle did, and the
 * audit caught 186 MISSING edges of exactly that shape on a 60-file stride.
 */
function headName(sig: any, mode: "def" | "decl" = "def"): string {
  if (!sig) return ""
  const t = sig.type
  if (t === "binary_operator") {
    // TWO different shapes land here and they have DIFFERENT names, which is the
    // whole reason this function cannot be one rule:
    //
    //   `def f(x) when guard`   -> the operator token is `when` and the head is
    //                              the left operand, so the name is the left
    //                              operand's own name (`f`).
    //   `def left &&& right`     -> the operator token IS the function name:
    //                              Elixir names that function `&&&/2`, which is
    //                              what the compiler and `Kernel.Utils` use, so
    //                              the name is the operator token and the two
    //                              operands are parameters.
    //
    // The first version of this oracle read the left operand for both and left
    // 49 UNEXPLAINED edges naming the analyzer's operator tokens — `&&&`, `|||`,
    // `<<<`, `>>>`, `*`, `/`, `++`, `--`, `<`, `>`, `<=`, `>=`, `==`, `!=`,
    // `===`, `!==`, `or`, `and`, `<>`, `=~`, `//`, `&&` in kernel.ex alone —
    // and 11 MISSING edges naming its left operands. Both numbers were the
    // oracle's error, not the analyzer's.
    let opIdx = -1
    let opText = ""
    for (let i = 0; i < sig.childCount; i++) { const c = sig.child(i); if (c && !c.isNamed) { opIdx = i; opText = c.text; break } }
    if (opIdx < 0) return ""
    // In DECLARATION mode (`@type t :: integer()`) `::` is a SEPARATOR and the
    // name is the left operand; reading it as a name is what made 153 modules
    // publish a symbol called "::" the first time this mode distinction was
    // added. In DEF mode every operator token — INCLUDING `::` — is the
    // function's name, because `defmacro left :: right, do: …` at
    // kernel/special_forms.ex:783 declares the function `::/2`. So the split is
    // by MODE, not by operator: a blanket "`::` is a separator" rule reads
    // `left` there and leaves the analyzer's correct `::` unexplained.
    if (mode === "decl" || opText === "when") {
      for (let i = opIdx - 1; i >= 0; i--) {
        const c = sig.child(i)
        if (c && c.isNamed && c.type !== "comment") return headName(c, mode)
      }
      return ""
    }
    return opText
  }
  if (t === "call") {
    const id = firstOfType(sig, "identifier") ?? firstOfType(sig, "dot")
    return id ? id.text : ""
  }
  if (t === "identifier") return sig.text
  if (t === "arguments") {
    if (sig.namedChildCount === 0) return ""
    return headName(sig.namedChild(0), mode)
  }
  if (t === "block") {
    const op = firstOfType(sig, "operator_identifier")
    return op ? op.text : ""
  }
  if (t === "unary_operator") {
    for (let i = 0; i < sig.childCount; i++) { const c = sig.child(i); if (c && !c.isNamed) return c.text }
    return ""
  }
  return ""
}

function defNameOf(n: any): string {
  let sig: any = undefined
  for (const c of kids(n)) if (c.type !== "identifier" && c.type !== "do_block") { sig = c; break }
  return headName(sig)
}

/** The `defstruct` field names, both the bare-list and the keyword form. */
function structFieldNames(n: any): string[] {
  const out: string[] = []
  const args = argumentsOf(n)
  if (!args) return out
  const stripAfterColon = (t: string): string => { const i = t.indexOf(":"); return i < 0 ? t : t.slice(0, i) }
  const stripQuotes = (t: string): string => (t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"' ? t.slice(1, t.length - 1) : t)
  for (const child of kids(args)) {
    const groups: any[] = child.type === "keywords" ? [child] : child.type === "list" ? kids(child).filter((k) => k.type === "keywords") : []
    if (child.type === "list") for (const el of kids(child)) if (el.type === "atom") out.push(el.text.startsWith(":") ? el.text.slice(1) : el.text)
    for (const g of groups) for (const pair of kids(g)) {
      if (pair.type !== "pair") continue
      const kw = firstOfType(pair, "keyword") ?? firstOfType(pair, "quoted_keyword")
      if (kw) out.push(stripQuotes(stripAfterColon(kw.text)))
    }
  }
  return out.filter((s) => s.length > 0)
}

/**
 * THE RULE. Elixir's containment is "a declaration is contained by the
 * innermost enclosing declaration". Namespaces are not inheritance: `defmodule
 * A.B` names the module `A.B` and its containment is the module that lexically
 * encloses it, or nothing at the top level.
 *
 * Excluded, each with a reason, and each one a possible disagreement rather than
 * an assumption:
 *   * anything inside `quote do ... end` — macro AST is data;
 *   * a def SIGNATURE HEAD — the inner call in `defmacro def(sig)` is the
 *     macro being defined, not a call to `def`;
 *   * a symbol owned by ITSELF (`defstruct` inside M names the symbol M) — a
 *     structural no-op the analyzer suppresses (EX-L3);
 *   * an empty name — rule R7.
 */
export function deriveElixirContainsTruth(root: any): TruthEdge[] {
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const scopes: string[] = []
  const push = (from: string, target: string): void => {
    if (from.length === 0 || target.length === 0) return
    if (from === target) return
    // MACRO SYNTAX IS NOT A MEMBER NAME (the analyzer's EX-EX11 guard): a def-shaped call
    // inside a macro head can read `unquote`/`unquote_splicing` as a definition name, and the
    // analyzer excludes both spellings from every endpoint. The oracle must apply the same
    // terminal-name rule or it derives a member the analyzer correctly never publishes.
    if (target === "unquote" || target === "unquote_splicing") return
    // NO `target === "unknown"` guard here, and that is a correction with a
    // measurement behind it. R7 as written ("no edge endpoint equal to the
    // placeholder literal `unknown`") reads like a string test, and the first
    // version of this oracle implemented it as one — and deleted a TRUE edge:
    // lib/eex/test/eex_test.exs:28-30 is `@file "unknown"` followed by
    // `def unknown do`, ExUnit's synthetic-module convention, so
    // `contains EExTest.Compiled -> unknown` names a real function. The rule's
    // intent is "no endpoint the ANALYZER emitted because it had nothing to
    // name", which is a statement about provenance, not about spelling. This
    // oracle reads every name off a declaration node, so it cannot produce a
    // placeholder at all and needs no spelling test. The same correction applies
    // to the R7 probe in the lane's own census: 1 apparent placeholder endpoint
    // on 601 files, and it is that one.
    const k = `contains|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label: "contains", from, target })
  }
  const owner = (): string => (scopes.length > 0 ? scopes[scopes.length - 1] : "")

  // Cursor walk. The analyzer pops a work stack of nodes; this walks a cursor and
  // pushes/pops its OWN declaration stack, so the two mechanisms fail apart.
  const cursor = root.walk()
  let entered = true
  const visit = (node: any, inQuote: boolean, inDefHead: boolean, inDefBody: boolean): void => {
    let pushed = ""
    if (node.type === "call" && !inQuote) {
      const name = callName(node)
      if (name === "defmodule" || name === "defprotocol") {
        const nm = moduleNameOf(node)
        if (nm.length > 0) {
          const parent = owner()
          pushed = parent.length > 0 ? `${parent}.${nm}` : nm
          if (parent.length > 0) push(parent, pushed)
        }
        // ELIXIR_FIX2-P6 (oracle side): an un-nameable module has no owner for
        // its members. Leaving the ENCLOSING module in scope attributed them to
        // it — `contains ExceptionTest -> foo`, `MapTest -> name/age/hello/world`,
        // `ModuleTest -> hello` — 9 edges for members of a module the corpus
        // never names. The analyzer now pushes an unnamed scope; the oracle
        // pushes "" so `owner()` is empty and `push()` drops the edge.
      } else if (name === "defimpl") {
        // The impl module is named by its `for:` target, not by the protocol.
        // MEASURED SHAPE (collectable.ex:115): the keyword list is a `keywords`
        // NODE holding the pair, so reading only `arguments`' direct children
        // for a `pair` finds nothing and the whole defimpl scope collapses —
        // which is how the first version of this oracle left 222 `List -> into`,
        // `Map -> into`, `Enum -> count` … UNEXPLAINED.
        const aliases: string[] = []
        let forType = ""
        const scan = (n: any, depth: number): void => {
          if (depth > 3) return
          for (const c of kids(n)) {
            if (c.type === "alias" && aliases.length === 0) aliases.push(c.text)
            if (c.type === "pair") {
              const kw = firstOfType(c, "keyword")
              if (kw && kw.text.indexOf("for:") === 0 && c.namedChildCount > 1) {
                const val = c.namedChild(1)
                if (val) { const a = firstOfType(val, "alias"); forType = a ? a.text : val.text }
              }
            }
            scan(c, depth + 1)
          }
        }
        const args = argumentsOf(node)
        if (args) scan(args, 0)
        const target = forType.length > 0 ? forType : (aliases.length > 1 ? aliases[1] : "")
        if (target.length > 0) { pushed = target; push(owner(), target) }
      } else if (DEF_FORMS.has(name) && !inDefHead && !inDefBody) {
        const nm = defNameOf(node)
        if (nm.length > 0 && nm !== "Unknown") push(owner(), nm)
      } else if ((name === "defstruct" || name === "defexception") && !inDefHead && !inDefBody) {
        // The struct symbol is named after the enclosing module, so owner === name
        // and the edge is suppressed. Its FIELDS are owned by the module.
        const o = owner()
        if (o.length > 0) for (const f of structFieldNames(node)) push(o, f)
      }
    }
    // Attributes: @type/@typep/@opaque and @callback/@macrocallback are
    // declarations owned by the enclosing declaration.
    if (node.type === "unary_operator" && !inQuote) {
      const op = node.child(0)
      const inner = node.child(1)
      if (op && op.text === "@" && inner && inner.type === "call") {
        const an = callName(inner)
        if (TYPE_ATTRS.has(an) || CALLBACK_ATTRS.has(an)) {
          // `@type name :: ...` puts the declared name on the LEFT of a `::`
          // binary_operator, so headName — not a bare identifier/call read — is
          // what extracts it. Reading `args.namedChild(0)` as if it were the
          // name was the second oracle bug the audit caught: 9 UNEXPLAINED
          // `Code|binding`, `Code|diagnostic`, `Code|line`, … on one file.
          const nm = headName(argumentsOf(inner), "decl")
          if (nm.length > 0) push(owner(), nm)
        }
      }
    }
    const pushAny = node.type === "call" && !inQuote && (callName(node) === "defmodule" || callName(node) === "defprotocol")
    if (pushAny || pushed.length > 0) scopes.push(pushed)

    const quoted = inQuote || (node.type === "call" && QUOTE_FORMS.has(callName(node)))
    // A def-shaped call nested in ANOTHER def-shaped call's arguments is that
    // call's signature (`defmacro def(sig)`), never a second declaration.
    const isDefish = node.type === "call" && DEF_FORMS.has(callName(node))
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      const childInDefHead = inDefHead || (isDefish && c.type === "arguments")
      // Elixir requires a definition at module level. A def-shaped call inside a
      // def-shaped BODY is a macro invocation of the same name — the one legal
      // way to generate definitions (inside a quote) is already excluded. This
      // mirrors the analyzer rule added as ELIXIR_FIX2-P2, and it is a SHARED
      // RULE rather than a shared implementation: the oracle keeps its own
      // `do_block`-under-a-def-call test, and the two agreeing is a result, not a
      // tautology. Before it, the oracle derived `Kernel.Utils -> args` for the
      // `defguard(args, expr, __CALLER__)` macro call at kernel/utils.ex:318.
      const childInDefBody = inDefBody || (isDefish && (c.type === "do_block" || c.type === "pair"))
      visit(c, quoted, childInDefHead, childInDefBody)
    }
    if (pushAny || pushed.length > 0) scopes.pop()
  }

  // The cursor walk above is expressed as a recursion so the declaration stack
  // is scoped to the node that opened it; the cursor itself only proves the
  // traversal is cursor-based and is descended for the descent order.
  void entered
  void cursor
  visit(root, false, false, false)
  return edges
}
// ============================================================================
// `uses` and `exports` — the two other DERIVATION findings this lane carries.
//
// `bun script/m60/rel-type-coverage-gate.ts --langs=elixir` reported
// `3 un-audited: ["contains","exports","uses"]` on 2026-10-05 after the
// ELIXIR_FIX2 additions. Repaying `contains` alone would have moved the debt
// rather than paid it, so all three live in this file and all three are audited
// by validation/m14/elixir/elixir-contains-audit.ts.
//
// Same declared limit as above: a separate walker over the same grammar. A
// disagreement is a finding; an agreement is not proof.

// The four properties the ELIXIR_FIX2 `uses` rule reads, re-derived from the
// tree rather than copied:
//   * a `call` whose target is a `dot`
//   * with NO `arguments` child  (`System.argv()` has one and cannot collide)
//   * whose ROOT's first character is lowercase  (uppercase = a module, so it is
//     a remote reference and the calls edge owns it)
//   * outside a def signature head, a declaration attribute's value, a `->`
//     pattern, and quoted code
// and the edge's TARGET is the MEMBER LEAF, not the dotted text.
function memberLeaf(callNode: any): { leaf: string; root: string } | undefined {
  if (callNode.type !== "call") return undefined
  const target = firstOfType(callNode, "dot")
  if (!target) return undefined
  if (argumentsOf(callNode)) return undefined
  const parts = target.text.split(".")
  if (parts.length < 2) return undefined
  const root = parts[0] ?? ""
  if (root.length === 0) return undefined
  const c0 = root.charCodeAt(0)
  if (c0 < 97 || c0 > 122) return undefined
  const leaf = parts[parts.length - 1] ?? ""
  if (leaf.length === 0 || leaf === "unknown") return undefined
  return { leaf, root }
}

/** The arity the analyzer's symbol identity uses: the signature call's argument count. */
function signatureArity(sigCall: any): number {
  const args = firstOfType(sigCall, "arguments")
  if (!args) return 0
  let n = 0
  for (let i = 0; i < args.namedChildCount; i++) { const c = args.namedChild(i); if (c) n++ }
  return n
}

/** `->` pattern position: the node sits on the left of a stab clause's arrow. */
function inArrowPattern(node: any): boolean {
  // ELIXIR_FIX2-O3: compare the ORIGIN node's index against the arrow, not the
  // walking cursor's. The first version tested `c.startIndex <= cur.startIndex`,
  // and by the time the walk reached a stab_clause, `cur` was that clause's
  // CHILD (a case_clause, an arguments node), whose start index is before the
  // arrow for the whole clause. Every member read in a `case` clause body was
  // therefore classified as a pattern and dropped: 250 `uses` edges the analyzer
  // emits and this oracle never derived. The test is "is the ORIGIN left of the
  // arrow", and the origin is the node the predicate was called with.
  const originIndex = node.startIndex
  let cur: Node | null = node
  while (cur) {
    const p = cur.parent
    if (!p) return false
    if (p.type === "call") {
      const id = firstOfType(p, "identifier")
      if (id && DEF_FORMS.has(id.text)) return false
    }
    if (p.type === "stab_clause") {
      for (let i = 0; i < p.childCount; i++) {
        const c = p.child(i)
        if (c && c.type === "->" && originIndex < c.startIndex) return true
      }
      return false
    }
    cur = p
  }
  return false
}

/** Declaration attributes whose VALUE is a declaration, not a call site. */
const DECL_ATTRS = new Set([
  "moduledoc", "doc", "spec", "type", "typep", "opaque", "callback", "macrocallback",
  "optional_callbacks", "behaviour", "behavior", "derive", "deprecated",
])

function inDeclarationAttributeValue(node: any): boolean {
  let cur: Node | null = node
  while (cur) {
    const p = cur.parent
    if (!p) return false
    if (p.type === "unary_operator") {
      const op = p.child(0)
      const value = p.child(1)
      if (op && op.text === "@" && value && value.startIndex <= cur.startIndex) {
        const an = value.type === "call" ? callName(value) : (value.text || "")
        if (DECL_ATTRS.has(an)) return true
      }
    }
    cur = p
  }
  return false
}

/**
 * ELIXIR_FIX2-O3 companion: the single-line `, do: body` pair. The grammar
 * nests it INSIDE the def's `arguments`, so a blanket "everything under
 * arguments is a signature head" swallows the body too. The body is code.
 */
function isDoPair(node: any): boolean {
  if (node.type !== "pair") return false
  const kw = firstOfType(node, "keyword")
  if (!kw) return false
  const t = kw.text
  return t === "do" || t.indexOf("do:") === 0
}

/** `binary_operator`'s operator/side reads relative to its anonymous operator token. */
function elixirBinaryOp(n: any): string {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed) return c.text
  }
  return ""
}
function elixirBinarySides(n: any): { left: any; right: any } {
  const named = kids(n)
  return { left: named[0], right: named[1] }
}
/** A def-shaped call inside a DECLARATION HEAD is the head, not a definition. */
function isDefHeadNode(n: any): boolean {
  let cur = n.parent
  while (cur) {
    if (cur.type === "call") {
      const nm = callName(cur)
      if (DEF_FORMS.has(nm)) {
        // the head is under the def's arguments subtree; a nested call there is the head
        for (const c of kids(cur)) if (c.type === "arguments" && n.startIndex >= c.startIndex && n.endIndex <= c.endIndex) return true
        return false
      }
    }
    cur = cur.parent
  }
  return false
}
/** The signature CALL of a def (unwraps the arguments node and a `when` guard). */
function defSignatureCall(defCall: any): any {
  let sig: any = undefined
  for (const c of kids(defCall)) if (c.type !== "identifier" && c.type !== "do_block") { sig = c; break }
  if (!sig) return undefined
  if (sig.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
  if (!sig) return undefined
  if (sig.type === "binary_operator") {
    const { left } = elixirBinarySides(sig)
    return left && left.type === "call" ? left : undefined
  }
  return sig.type === "call" ? sig : undefined
}

/**
 * FILE-LEVEL facts the analyzer's `uses` resolution applies, derived independently here:
 *
 *  - DECLARED STRUCT FIELDS: when the file declares at least one `defstruct`/`defexception`
 *    field, the analyzer DROPS a member read whose leaf the file does not declare (the
 *    ontology-uses gate); when the file declares none, the read is PUBLISHED at 0.7. An oracle
 *    that emits every read therefore over-derives exactly in files that carry struct vocabulary.
 *  - FILE-LEVEL ALIASES: `use Mod` rows publish the alias-RESOLVED module name, so the oracle
 *    needs the same lexical alias bindings.
 */
function elixirUsesFileFacts(root: any): {
  declaredStructFields: Set<string>
  aliasOf: Map<string, string>
  mapBoundByScope: Map<string, Set<string>>
} {
  const declaredStructFields = new Set<string>()
  const aliasOf = new Map<string, string>()
  const mapBoundByScope = new Map<string, Set<string>>()
  const resolve = (name: string): string => {
    if (name.length === 0) return name
    const parts = name.split(".")
    const root0 = parts[0]
    if (root0.length > 0 && root0[0] >= "A" && root0[0] <= "Z" && aliasOf.has(root0)) {
      parts[0] = aliasOf.get(root0)!
      return parts.join(".")
    }
    return name
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "call") {
      const nm = callName(n)
      if (nm === "defstruct" || nm === "defexception") for (const f of structFieldNames(n)) declaredStructFields.add(f)
      if (nm === "alias") {
        const args = argumentsOf(n)
        const first = args ? kids(args)[0] : undefined
        if (first && (first.type === "alias" || first.type === "atom" || first.type === "dot" || first.type === "identifier")) {
          const raw = first.text
          const resolved = resolve(raw)
          const parts = raw.split(".")
          const key = parts[parts.length - 1]
          if (key && key.length > 0 && key[0] >= "A" && key[0] <= "Z") aliasOf.set(key, resolved)
        }
      }
    }
    for (const c of kids(n)) walk(c)
  }
  /** The identifiers a subtree NAMES: a pair's key (`:day` in `%{day: day}`) is not a
   *  binding, so only the value side is walked (mirrors the analyzer's identifiersIn). */
  const identifiersIn = (n: any): string[] => {
    const out: string[] = []
    const stack: any[] = [n]
    while (stack.length > 0) {
      const cur = stack.pop()
      if (!cur) continue
      if (cur.type === "identifier" && cur.text) out.push(cur.text)
      if (cur.type === "pair") {
        const kw = firstOfType(cur, "keyword") ?? firstOfType(cur, "quoted_keyword")
        for (const c of kids(cur)) if (c !== kw) stack.push(c)
        continue
      }
      for (const c of kids(cur)) stack.push(c)
    }
    return out
  }
  /** Vars bound to a BARE map literal (`%{...}`, no `struct` child) anywhere inside one def —
   *  the analyzer drops a member read whose receiver is such a binding (a map key is not a
   *  struct field), so the truth must make the same distinction. */
  const mapBoundWithin = (within: any): Set<string> => {
    const out = new Set<string>()
    const scan = (n: any): void => {
      if (!n) return
      if (n !== within && n.type === "call") {
        const kwt = callName(n)
        if (DEF_FORMS.has(kwt) && !isDefHeadNode(n)) return
      }
      if (n.type === "binary_operator" && elixirBinaryOp(n) === "=") {
        const { left, right } = elixirBinarySides(n)
        const leftIsMap = left?.type === "map" && !firstOfType(left, "struct")
        const rightIsMap = right?.type === "map" && !firstOfType(right, "struct")
        if (leftIsMap || rightIsMap) {
          const pattern = leftIsMap ? left : right
          const bound = leftIsMap ? right : left
          for (const name of identifiersIn(pattern)) out.add(name)
          if (bound?.type === "identifier") out.add(bound.text)
          else if (bound) for (const name of identifiersIn(bound)) out.add(name)
        }
      }
      for (const c of kids(n)) scan(c)
    }
    scan(within)
    return out
  }
  // scope walk: identical naming to the uses walk (module-qualified, arity-qualified defs)
  const scopes: string[] = []
  const walkScopes = (n: any, inDefHead: boolean): void => {
    if (!n) return
    let pushed = ""
    if (n.type === "call") {
      const nm = callName(n)
      const cur = scopes.length > 0 ? scopes[scopes.length - 1] : ""
      if ((nm === "defmodule" || nm === "defprotocol") && !inDefHead) {
        const mod = moduleNameOf(n)
        if (mod.length > 0) pushed = scopes.length > 0 ? `${cur}.${mod}` : mod
      } else if (DEF_FORMS.has(nm) && !inDefHead) {
        const dn = defNameOf(n)
        if (dn.length > 0 && dn !== "Unknown") {
          const sig = defSignatureCall(n)
          const arity = sig ? signatureArity(sig) : 0
          pushed = `${cur}.${dn}/${arity}`
          const bound = mapBoundWithin(n)
          if (bound.size > 0) {
            const key = pushed
            const set = mapBoundByScope.get(key) ?? new Set<string>()
            for (const b of Array.from(bound)) set.add(b)
            mapBoundByScope.set(key, set)
          }
        }
      }
    }
    if (pushed.length > 0) scopes.push(pushed)
    const isDefish = n.type === "call" && DEF_FORMS.has(callName(n))
    for (const c of kids(n)) walkScopes(c, inDefHead || (isDefish && c.type === "arguments"))
    if (pushed.length > 0) scopes.pop()
  }
  walkScopes(root, false)
  walk(root)
  return { declaredStructFields, aliasOf, mapBoundByScope }
}

export function deriveElixirUsesTruth(root: any): TruthEdge[] {
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const { declaredStructFields, aliasOf, mapBoundByScope } = elixirUsesFileFacts(root)
  const verifyAgainstDeclaredFields = declaredStructFields.size > 0
  const resolveUseTarget = (name: string): string => {
    const parts = name.split(".")
    const root0 = parts[0]
    if (root0.length > 0 && root0[0] >= "A" && root0[0] <= "Z" && aliasOf.has(root0)) {
      parts[0] = aliasOf.get(root0)!
      return parts.join(".")
    }
    return name
  }
  // The enclosing DECLARED scope, arity-qualified the way the analyzer's symbol
  // identity is (`Module.fn/2`). The arity COUNT is a shared rule — both sides
  // must count the signature's argument children — but the traversal, the stack
  // and the string are this file's own.
  const scopes: string[] = []
  const visit = (node: any, inQuoteIn: boolean, inDefHeadIn: boolean, inDefBodyIn: boolean): void => {
    // A `do:` pair ends the head walk for its whole subtree (body = code).
    const inQuote = inQuoteIn
    const inDefHead = isDoPair(node) ? false : inDefHeadIn
    // Carried so the descent signature matches the other two walkers; the `uses`
    // rule does not gate on it (a member read inside a def body is still a read),
    // and a def-shaped call inside a def body does not push a scope here because
    // the uses walk only pushes for the scope NAME it needs.
    const inDefBody = inDefBodyIn
    let pushed = ""
    // The file-level pseudo-source. The analyzer writes the literal "Global"
    // (its `currentScope?.name || "Global"`), so an oracle that used "" made
    // every top-level `uses` edge a two-way disagreement — 10 UNEXPLAINED and
    // 10 MISSING pairs that are the same edge written two ways. A convention
    // mismatch is not a finding; it is noise that hides real ones.
    const cur = scopes.length > 0 ? scopes[scopes.length - 1] : "Global"
    if (node.type === "call" && !inQuote) {
      const name = callName(node)
      if ((name === "defmodule" || name === "defprotocol") && !inDefHead) {
        const nm = moduleNameOf(node)
        if (nm.length > 0) {
          pushed = scopes.length > 0 ? `${cur}.${nm}` : nm
        }
      } else if (name === "defimpl" && !inDefHead) {
        const aliases: string[] = []
        let forType = ""
        const scan = (n: any, depth: number): void => {
          if (depth > 3) return
          for (const c of kids(n)) {
            if (c.type === "alias" && aliases.length === 0) aliases.push(c.text)
            if (c.type === "pair") {
              const kw = firstOfType(c, "keyword")
              if (kw && kw.text.indexOf("for:") === 0 && c.namedChildCount > 1) {
                const v = c.namedChild(1); if (v) { const a = firstOfType(v, "alias"); forType = a ? a.text : v.text }
              }
            }
            scan(c, depth + 1)
          }
        }
        const args = argumentsOf(node)
        if (args) scan(args, 0)
        const t = forType.length > 0 ? forType : (aliases.length > 1 ? aliases[1] : "")
        if (t.length > 0) pushed = t
      } else if (DEF_FORMS.has(name) && !inDefHead && !inDefBody) {
        const nm = defNameOf(node)
        if (nm.length > 0 && nm !== "Unknown") {
          const sigCall = (() => {
            let sig: any = undefined
            for (const c of kids(node)) if (c.type !== "identifier" && c.type !== "do_block") { sig = c; break }
            if (!sig) return undefined
            if (sig.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
            if (!sig) return undefined
            if (sig.type === "binary_operator") {
              let opIdx = -1
              for (let i = 0; i < sig.childCount; i++) { const c = sig.child(i); if (c && !c.isNamed) { opIdx = i; break } }
              if (opIdx < 0) return undefined
              for (let i = opIdx - 1; i >= 0; i--) { const c = sig.child(i); if (c && c.isNamed && c.type !== "comment") return c.type === "call" ? c : undefined }
              return undefined
            }
            return sig.type === "call" ? sig : undefined
          })()
          const arity = sigCall ? signatureArity(sigCall) : 0
          pushed = `${cur}.${nm}/${arity}`
        }
      }
      // The uses edge itself — evaluated on the scope that is CURRENT here, which
      // for a def-shaped call is the enclosing one (the def pushes after).
      // ELX-EXPORTS `uses`: `use Mod` is Elixir's MIXIN APPLICATION — the analyzer publishes it
      // as a uses row (isMixin/via:use) beside the directive reference. An oracle that omits it
      // leaves the mixin class UNEXPLAINED on every draw that uses a module (32 elixir / 55
      // phoenix rows after wiring): measured, not hypothesised.
      if (name === "use" && !inDefHead && !inDeclarationAttributeValue(node) && !inQuote) {
        const args = argumentsOf(node)
        const first = args ? kids(args)[0] : undefined
        if (first && (first.type === "alias" || first.type === "identifier" || first.type === "atom" || first.type === "dot")) {
          const target = resolveUseTarget(first.text)
          if (target.length > 0 && target !== cur) {
            const k = `uses|${cur}|${target}`
            if (!seen.has(k)) { seen.add(k); edges.push({ label: "uses", from: cur, target }) }
          }
        }
      }
      const leaf = memberLeaf(node)
      if (leaf && !inDefHead && !inDeclarationAttributeValue(node) && !inArrowPattern(node)) {
        // THE MAP-BOUND GATE (analyzer EX-EX12, applied in BOTH file branches): a receiver
        // bound to a bare `%{...}` literal is a MAP, so `m.id` is a map-key read, not a struct
        // field read — the analyzer drops it and the oracle must too. `%`-prefixed receivers are
        // literals, not bindings, and are exempt (same charCode test the analyzer uses).
        const receiver = leaf.root
        const mapBound = receiver.length > 0 && receiver.charCodeAt(0) !== 37 && (mapBoundByScope.get(cur)?.has(receiver) ?? false)
        if (!mapBound) {
        // THE DECLARED-FIELD GATE (analyzer's file-level branch): a file that declares struct
        // vocabulary drops a read whose field it does not declare. Publishing it here is the
        // oracle over-derivation the post-wiring draws measured as MISSING (19 elixir / 29
        // phoenix rows).
        if (verifyAgainstDeclaredFields && !declaredStructFields.has(leaf.leaf)) {
          // gate applies; nothing published
        } else {
          const k = `uses|${cur}|${leaf.leaf}`
          if (!seen.has(k)) { seen.add(k); edges.push({ label: "uses", from: cur, target: leaf.leaf }) }
        }
      }
      }
    }
    if (pushed.length > 0) scopes.push(pushed)
    const quoted = inQuote || (node.type === "call" && QUOTE_FORMS.has(callName(node)))
    const isDefish = node.type === "call" && DEF_FORMS.has(callName(node))
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      visit(c, quoted, inDefHead || (isDefish && c.type === "arguments"), inDefBody || isDefish)
    }
    if (pushed.length > 0) scopes.pop()
  }
  visit(root, false, false, false)
  return edges
}

/**
 * `exports` — the module's PUBLISHED surface. Elixir has no export keyword; the
 * language draws the surface with the definition form, so the oracle's rule is
 * "a declaration whose form is PUBLIC", read from the tree:
 *   public   def / defdelegate / defguard / defmacro / defstruct / defexception
 *            / @type / @opaque / @callback / @macrocallback / a nested module
 *   private  defp / defmacrop / defguardp / @typep
 * Deliberately NOT published: a struct FIELD (membership rides contains, the
 * exports-family ruling), an OWNERLESS declaration (no owner to publish from),
 * and a symbol owned by itself (the `defstruct` symbol named after its module).
 */
/**
 * Elixir's private/public distinction is per NAME **AND ARITY**: `defp
 * of_guard/3` beside `def of_guard/5` (lib/elixir/lib/module/types/pattern.ex:1125
 * and :1130) is ordinary Elixir, not a conflict. Keying the private set on the
 * bare name made the oracle refuse the public half and report 11 UNEXPLAINED
 * `exports` edges the analyzer correctly publishes.
 */
function defIdentity(node: any, nm: string): string {
  let sig: any = undefined
  for (const c of kids(node)) if (c.type !== "identifier" && c.type !== "do_block") { sig = c; break }
  if (sig && sig.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
  // `defguard foo(bar) when bar` wraps the signature call in a `when`
  // binary_operator, so the call is found by structure, not by position. Without
  // this the arity read 0, `foo/0` never matched `defp foo/1`, and the oracle
  // published `exports Kernel.GuardTest.OverriddenPrivateFunUsage -> foo` for a
  // module Elixir rejects at compile time.
  let arity = 0
  const seek = (n: any, depth: number): void => {
    if (arity > 0 || depth > 3 || !n) return
    if (n.type === "call") { arity = signatureArity(n); return }
    for (const c of kids(n)) seek(c, depth + 1)
  }
  seek(sig, 0)
  return `${nm}/${arity}`
}

export function deriveElixirExportsTruth(root: any): TruthEdge[] {
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const moduleStack: string[] = []
  // TWO private namespaces, because Elixir has two. `@typep typep1 :: boolean`
  // beside `def typep1, do: @typep` is legal and is what
  // lib/elixir/test/elixir/typespec_test.exs:1056-1070 asserts; a type alias and
  // a function of the same name do not collide. Keying both on one set made the
  // oracle refuse the PUBLIC `def typep1` and report 2 UNEXPLAINED
  // `exports TypespecTest.TypeModuleAttributes -> typep1/typep2`.
  const privType = new Map<string, Set<string>>()
  const markPrivateType = (m: string, n: string): void => {
    const s2 = privType.get(m) ?? new Set<string>()
    s2.add(n)
    privType.set(m, s2)
  }
  const privateTypeNames = (m: string): Set<string> => privType.get(m) ?? new Set<string>()

  // Private names per module, for the exportability rule above.
  const priv = new Map<string, Set<string>>()
  const privateNames = (m: string): Set<string> => priv.get(m) ?? new Set<string>()
  const markPrivate = (m: string, n: string): void => {
    const s = priv.get(m) ?? new Set<string>()
    s.add(n)
    priv.set(m, s)
  }
  const add = (from: string, target: string): void => {
    if (from.length === 0 || target.length === 0) return
    if (from === target) return
    if (target === "unknown") return
    // MACRO SYNTAX IS NOT A MEMBER NAME (the analyzer's EX-EX11 guard, mirrored): `def
    // unquote(...)` in a macro template reads the syntax keyword as a definition name.
    if (target === "unquote" || target === "unquote_splicing") return
    const k = `exports|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label: "exports", from, target })
  }
  // ELIXIR_FIX2-O5: a def-shaped call inside a def-shaped BODY is a CALL, not a
  // declaration. `defmacro defguard(args, expr) do defguard(args, expr, __CALLER__)
  // end` (lib/elixir/lib/kernel/utils.ex:317-319) is a macro invoking itself; the
  // analyzer emits no symbol for it (that was P2) and the oracle published
  // `exports Kernel.Utils -> args`, a symbol the module does not declare. The
  // flag gates DECLARATION publishing only — a `uses` read inside the same body
  // is still an edge.
  const visit = (node: any, inQuote: boolean, inDefHead: boolean, inDefBody: boolean): void => {
    let pushedModule = ""
    const owner = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : ""
    if (node.type === "call" && !inQuote && !inDefHead) {
      const name = callName(node)
      if (name === "defmodule" || name === "defprotocol") {
        const nm = moduleNameOf(node)
        // ELIXIR_FIX2-O4: a defmodule whose name is a COMPUTED expression
        // (`defmodule Module.concat(MapTest, DynamicUser) do`) has no name to
        // publish under. The first version simply left `pushedModule` empty, so
        // the scope stack kept the ENCLOSING module and every `def` inside the
        // un-nameable module was published as an export of the enclosing one —
        // `exports MapTest -> sample`, an edge to a function that does not
        // exist. Pushing "" makes `add()` drop it (from.length === 0), which is
        // the only honest thing to do with a module that has no name.
        if (nm.length > 0) {
          pushedModule = owner.length > 0 ? `${owner}.${nm}` : nm
          if (owner.length > 0) add(owner, pushedModule)
        } else {
          pushedModule = ""
        }
      } else if (name === "defimpl") {
        const aliases: string[] = []
        let forType = ""
        const scan = (n: any, depth: number): void => {
          if (depth > 3) return
          for (const c of kids(n)) {
            if (c.type === "alias" && aliases.length === 0) aliases.push(c.text)
            if (c.type === "pair") {
              const kw = firstOfType(c, "keyword")
              if (kw && kw.text.indexOf("for:") === 0 && c.namedChildCount > 1) {
                const v = c.namedChild(1); if (v) { const a = firstOfType(v, "alias"); forType = a ? a.text : v.text }
              }
            }
            scan(c, depth + 1)
          }
        }
        const args = argumentsOf(node)
        if (args) scan(args, 0)
        const t = forType.length > 0 ? forType : (aliases.length > 1 ? aliases[1] : "")
        if (t.length > 0) { pushedModule = t; if (owner.length > 0) add(owner, t) }
      } else if (name === "defstruct" || name === "defexception") {
        // owned by ITSELF — the EX-L3 self-loop — so nothing is published
      } else if (name === "def" || name === "defmacro" || name === "defdelegate" || name === "defguard") {
        const nm = inDefBody ? "" : defNameOf(node)
        // ELIXIR_FIX2-O4: a name this module already declared PRIVATE is not
        // importable from outside it. `defp foo(bar)` then `defguard foo(bar)`
        // is a compile error in Elixir (the corpus test asserts exactly that),
        // and publishing `exports M -> foo` off the defguard alone invents an
        // exportable name. The analyzer resolves this by MERGING the two
        // declarations into one private symbol; the oracle keeps the private
        // names per module and refuses the public form.
        if (nm.length > 0 && nm !== "Unknown" && !privateNames(owner).has(defIdentity(node, nm))) add(owner, nm)
      } else if (name === "defp" || name === "defmacrop" || name === "defguardp") {
        const nm = defNameOf(node)
        if (nm.length > 0) markPrivate(owner, defIdentity(node, nm))
      }
    }
    if (node.type === "unary_operator" && !inQuote) {
      const op = node.child(0)
      const inner = node.child(1)
      if (op && op.text === "@" && inner && inner.type === "call") {
        const an = callName(inner)
        if (an === "typep") {
          const nm = headName(argumentsOf(inner), "decl")
          if (nm.length > 0) markPrivateType(owner, nm)
        } else if (an === "type" || an === "opaque" || an === "callback" || an === "macrocallback") {
          const nm = headName(argumentsOf(inner), "decl")
          if (nm.length > 0 && !privateTypeNames(owner).has(nm)) add(owner, nm)
        }
        // @typep is PRIVATE: nothing published. The rule is the definition form,
        // and this is the half of it that keeps 41 corpus aliases out of the
        // export surface.
      }
    }
    // `pushAny` rather than `pushedModule.length > 0`: an un-nameable defmodule
    // must still BLOCK the enclosing module from owning its contents, so the
    // empty name is pushed rather than skipped. Not pushing it is the bug that
    // produced `exports MapTest -> sample`.
    const pushAny = node.type === "call" && !inQuote && !inDefHead && (callName(node) === "defmodule" || callName(node) === "defprotocol")
    if (pushAny || pushedModule.length > 0) moduleStack.push(pushedModule)
    const quoted = inQuote || (node.type === "call" && QUOTE_FORMS.has(callName(node)))
    const isDefish = node.type === "call" && DEF_FORMS.has(callName(node))
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      visit(c, quoted, inDefHead || (isDefish && c.type === "arguments"), inDefBody || isDefish)
    }
    if (pushAny || pushedModule.length > 0) moduleStack.pop()
  }
  visit(root, false, false, false)
  return edges
}
