// SOLIDITY-D1 · the TRUTH for the relationship classes F5's head list compares and
// this lane had no oracle for.
//
// WHY THIS FILE EXISTS. `differential.ts` compares `extends`, `implements`,
// `instantiates` and `overrides` for EVERY lane — they are the head of the
// allowlist, not an opt-in — and a lane with no oracle for them derives ZERO truth
// edges, which the harness correctly refuses:
//
//   differential: solidity:solidity parsed 60 file(s) and derived ZERO truth
//   edges — the parser or the oracle is dead, not clean (a 0/0 row is a
//   fabricated pass)
//
// So the absence of an oracle is not a "cannot measure" — it is a hard failure,
// which is the right default: a lane whose truth cannot disagree with its
// analyzer has a mirror, not a differential. This module derives that truth FROM
// THE TREE by the language's own rules.
//
// INDEPENDENCE, STATED HONESTLY PER CLASS, because "independent" is the whole
// value and a blanket claim would be worthless:
//
//   contains    INDEPENDENT. Derived by walking the tree and attributing every
//               declaration to its NEAREST ENCLOSING DECLARATION — a different
//               computation from the analyzer's frame stack, which attributes a
//               local to the FUNCTION that lexically encloses it. The oracle has
//               no frames at all; it recurses with an owner parameter. If the two
//               disagree, one of them has the wrong notion of what encloses what.
//               Caveat recorded rather than hidden: the oracle also reproduces the
//               SOL-3 synthesised getter (`bal()` for a `public` state variable),
//               because that is a FACT about the language rather than a choice,
//               and a differential that omitted it would report every getter edge
//               as a fabrication.
//
//   extends /   INDEPENDENT, and with a measured divergence in mind. Solidity has
//   implements  ONE heritage construct and no `interface` keyword in the list, so
//               the kind comes from the ancestor's own declaration. The analyzer
//               learns interface-ness INCREMENTALLY, as its single walk reaches
//               each `interface_declaration`; the oracle PRE-PASSES the whole file
//               and builds the interface set before resolving a single ancestor.
//               The two therefore differ on a file that inherits an interface
//               DECLARED LATER IN THE SAME FILE — the analyzer would call it
//               `extends` and the oracle `implements`. MEASURED on 120 files of
//               the pinned corpus: 0 such orderings, so the corpus does not
//               distinguish the two implementations. That is a statement about
//               this corpus, not a proof the divergence cannot happen, and the
//               divergence is the reason the oracle is worth having.
//
//   instantiates INDEPENDENT, and this class earned the oracle on its own: the
//               analyzer emitted ZERO `instantiates` across a six-file probe set
//               while looking healthy, because `new_expression` nests its
//               `user_defined_type` inside a `type_name` and the reader looked at
//               direct children. A class that can be silently EMPTY is precisely
//               the class a differential exists to catch.
//
//   overrides   CONSISTENCY-ONLY, and saying so is the point. Solidity's
//               `override` keyword names the BASE, never the member, so locating
//               the target requires matching a member name inside that base — and
//               the oracle has to match exactly as the analyzer does. What the
//               comparison CAN establish is that every function carrying an
//               `override_specifier` yields an edge for every base that DECLARES a
//               same-named member, and no edge for a base that does not. That is a
//               real check on the resolution — it would catch a member set built
//               from the wrong scope, or a base silently skipped — but it is not
//               an independent derivation of WHICH member is meant, because the
//               language does not say. Recorded here rather than claimed as more.
//
//   uses        INDEPENDENT. An identifier whose PARENT is an `expression` is a
//               read: the same positional rule the analyzer states, derived from
//               grammar.js's `_primary_expression`, so it measures the POSITION
//               rather than a name list. Also derives the `member_expression`
//               property read, refusing a GLOBAL's members.
//
// No regex, no hand-typed name lists, AST only.
import type { Node } from "web-tree-sitter"

/** Names the EVM supplies at any position — DECLARED, like the analyzer's. The
 *  grammar's 262 alphabetic anonymous tokens do not include `msg`, `block`, `tx`,
 *  `super` or `this` (its `externals` array is empty), so the grammar cannot
 *  answer this and both sides declare it. `ENGINE_FUNCTIONS` is the analyzer's own
 *  derived list, imported rather than re-typed — two instruments that must agree
 *  may not each hold a copy, and a sibling lane had to learn that the hard way. */
const GLOBAL_OBJECTS = new Set(["msg", "block", "tx", "super", "this"])

/** The node types that DECLARE something, per declaration kind. The key is the
 *  symbol KIND the analyzer publishes for that node, so the oracle's containment
 *  and the analyzer's are about the same set of declarations by construction —
 *  and the two sides still compute the OWNER differently, which is the check. */
const DECLARERS: Record<string, string> = {
  contract_declaration: "type",
  interface_declaration: "interface",
  library_declaration: "type",
  struct_declaration: "struct",
  enum_declaration: "enum",
  function_definition: "function",
  modifier_definition: "function",
  constructor_definition: "constructor",
  fallback_receive_definition: "function",
  event_definition: "event",
  error_declaration: "error",
  state_variable_declaration: "property",
  constant_variable_declaration: "property",
  user_defined_type_definition: "type",
  struct_member: "property",
  enum_value: "enum_member",
  variable_declaration: "variable",
  yul_variable_declaration: "variable",
  yul_function_definition: "function",
}

/** The one name the STORE refuses to hold, so no edge may target it (SOL-14).
 *  Imported from the analyzer's shared module rather than re-typed, for the same
 *  reason as above. */
import { RESERVED_TOKENS, ENGINE_FUNCTION_NAMES, STORE_REFUSED_SYMBOL_NAMES } from "../../../src/ast/solidity-reserved-tokens"

const children = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) out.push(c) }
  return out
}
const namedChildren = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
const namedChildOfType = (n: any, type: string): any | null => {
  for (const c of namedChildren(n)) if (c.type === type) return c
  return null
}
const descendants = (n: any, type: string, out: any[] = []): any[] => {
  const work: any[] = [n]
  while (work.length > 0) {
    const x = work.shift()!
    if (x !== n && x.type === type) out.push(x)
    for (const c of children(x)) work.push(c)
  }
  return out
}

/**
 * `user_defined_type`'s name. Written the long way — walk to the identifier — so
 * the oracle does not depend on the analyzer's `udtName` helper.
 */
const udtName = (n: any): string => {
  if (!n) return ""
  if (n.type === "identifier") return n.text
  if (n.type !== "user_defined_type") return ""
  for (const c of namedChildren(n)) if (c.type === "identifier") return c.text
  return ""
}

/** Any ERROR/MISSING ancestor within a bounded hop count. */
const damaged = (n: any): boolean => {
  let p: any = n?.parent ?? null
  let d = 0
  while (p && d < 32) {
    if (p.type === "ERROR" || p.isMissing) return true
    p = p.parent
    d++
  }
  return false
}

export function deriveSolidityEdges(root: any, moduleName: string): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    from = (from ?? "").trim()
    target = (target ?? "").trim()
    if (!from || !target) return
    if (label === "contains" && (target === from || !from)) return
    if (STORE_REFUSED_SYMBOL_NAMES.has(target) || STORE_REFUSED_SYMBOL_NAMES.has(from)) return
    // Site-agnostic matching in this harness (label + target, never the line), so
    // one row per (label, from, target) is the right grain. The per-site contract
    // is the fixture lane's to pin; F5 cannot see it.
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  // ── PRE-PASS 1: every interface declared anywhere in this file, BEFORE any
  //    inheritance is resolved. This is the deliberate divergence from the
  //    analyzer's incremental set — see the header's independence note.
  const interfaces = new Set<string>()
  for (const d of descendants(root, "interface_declaration")) {
    const nm = d.childForFieldName?.("name")
    if (nm) interfaces.add(nm.text)
  }

  // ── PRE-PASS 2: the file's whole declaration table, `(owner, name)` pairs, so
  //    `overrides` can be resolved AFTER the walk exactly as the analyzer does.
  //    The analyzer resolves in a POST-pass for the same reason (a base may be
  //    declared after its subclass — legal Solidity, and the corpus does it); the
  //    oracle doing it in a PRE-pass is the independence, not the agreement.
  const HERITAGE_KINDS = ["contract_declaration", "interface_declaration", "library_declaration"]
  const contractBases = new Map<string, string[]>()
  for (const d of HERITAGE_KINDS.flatMap((k) => descendants(root, k))) {
    const nm = d.childForFieldName?.("name")
    if (!nm) continue
    const bases: string[] = []
    for (const c of namedChildren(d)) {
      if (c.type !== "inheritance_specifier") continue
      const anc = c.childForFieldName?.("ancestor")
      const b = udtName(anc)
      if (b !== "") bases.push(b)
    }
    contractBases.set(nm.text, bases)
  }

  // ── inheritance: the label comes from the ancestor's own declaration.
  //
  // All THREE heritage-bearing kinds are walked, not just `contract_declaration`.
  // That was the last oracle bug the differential found: `interface IEntryPoint is
  // IEntryPointNonces, IEntryPointStake` in contracts/interfaces/IERC4337.sol is an
  // `interface_declaration`, so the walk never reached it, the oracle derived ZERO
  // `implements` for the file, and the harness reported the analyzer's one correct
  // edge as "COMPARED A LABEL WITH NO TRUTH". An interface inheriting an interface
  // is ordinary Solidity — it is the shape every IERC* interface takes.
  for (const d of HERITAGE_KINDS.flatMap((k) => descendants(root, k))) {
    const nm = d.childForFieldName?.("name")
    if (!nm) continue
    for (const c of namedChildren(d)) {
      if (c.type !== "inheritance_specifier") continue
      const anc = c.childForFieldName?.("ancestor")
      const b = udtName(anc)
      if (b === "" || b === nm.text) continue
      push(interfaces.has(b) ? "implements" : "extends", nm.text, b)
    }
  }

  // ── `new_expression`: the TYPE is nested under a `type_name`, so this walks
  //    for it rather than looking at direct children — which is the whole defect.
  for (const d of descendants(root, "new_expression")) {
    if (damaged(d)) continue
    const name = udtName(descendants(d, "user_defined_type")[0] ?? null)
    if (name === "" || RESERVED_TOKENS.has(name)) continue
    // The scope of a `new` is the nearest enclosing function; for a contract-scope
    // `new` there is none, and the containing contract is the honest scope.
    let p: any = d.parent
    let scope = ""
    while (p) {
      if (p.type === "function_definition" || p.type === "modifier_definition" ||
          p.type === "constructor_definition") {
        const fn = p.childForFieldName?.("name")
        scope = fn ? fn.text : (p.type === "constructor_definition" ? "constructor" : "")
        break
      }
      if (p.type === "contract_declaration" || p.type === "interface_declaration" ||
          p.type === "library_declaration") {
        const cn = p.childForFieldName?.("name")
        scope = cn ? cn.text : ""
        break
      }
      p = p.parent
    }
    if (scope === "") continue
    push("instantiates", scope, name)
  }

  // ── the member table, for the overrides check above. Built once.
  const memberTable = new Map<string, Set<string>>()
  {
    const stack: { n: any; owner: string }[] = [{ n: root, owner: moduleName }]
    while (stack.length > 0) {
      const { n, owner } = stack.pop()!
      const kind = DECLARERS[n.type]
      if (kind) {
        let name = ""
        if (n.type === "enum_value") {
          // grammar.js: `commaSep(alias($.identifier, $.enum_value))` — an
          // `enum_value` has NO fields; the name IS the node's own text, because
          // the grammar aliased the identifier to the value node. Reading a `name:`
          // field here returns null and silently derives nothing.
          name = n.text.trim()
        } else if (n.type === "constructor_definition") name = "constructor"
        else if (n.type === "fallback_receive_definition") {
          const first = children(n)[0]
          name = first && first.type === "receive" ? "receive" : "fallback"
        } else {
          const nm = n.childForFieldName?.("name")
          if (nm) name = nm.text
          else if (n.type === "yul_function_definition") {
            name = namedChildOfType(n, "yul_identifier")?.text ?? ""
          } else if (n.type === "yul_variable_declaration") {
            // grammar.js:427 — a Yul `let` names itself through `field("left", …)`,
            // NOT through `name:`. Reading `name:` returns null, so every Yul local
            // was silently absent from the oracle: measured as
            // `contains toTypedDataHash -> ptr`, where the source plainly says
            // `let ptr := mload(0x40)`.
            const left = n.childForFieldName?.("left")
            name = left ? left.text.trim() : ""
          }
        }
        if (name !== "" && STORE_REFUSED_SYMBOL_NAMES.has(name)) continue
        if (name !== "") {
          let set = memberTable.get(owner)
          if (!set) { set = new Set<string>(); memberTable.set(owner, set) }
          set.add(name)
          push("contains", owner, name)
          // NO `continue` here. An earlier draft skipped descending into anything
          // that was not a module-level declaration, on a half-formed idea about
          // "members of a member type". It stopped the walk at the first function,
          // struct or enum, so the oracle never reached a LOCAL, a struct member or
          // an enum value — 209 unexplained `contains` rows, the largest class in
          // the adjudication and every one of them a correct analyzer edge.
          // Descending is always right: the `owner` parameter below is what makes a
          // local belong to its FUNCTION (SOL-13), and that is derived from the walk
          // rather than from a frame the walk refuses to enter.
        }
      }
      // Nested declarations take the CURRENT declaration as their owner. A struct's
      // and an enum's own members take the STRUCT/ENUM, not the contract.
      let nextOwner = owner
      if (kind && n.type !== "variable_declaration" && n.type !== "yul_variable_declaration" &&
          n.type !== "struct_member" && n.type !== "enum_value") {
        let name = ""
        if (n.type === "constructor_definition") name = "constructor"
        else if (n.type === "fallback_receive_definition") {
          const first = children(n)[0]
          name = first && first.type === "receive" ? "receive" : "fallback"
        } else {
          const nm = n.childForFieldName?.("name")
          if (nm) name = nm.text
          else if (n.type === "yul_function_definition") {
            name = namedChildOfType(n, "yul_identifier")?.text ?? ""
          } else if (n.type === "yul_variable_declaration") {
            // grammar.js:427 — a Yul `let` names itself through `field("left", …)`,
            // NOT through `name:`. Reading `name:` returns null, so every Yul local
            // was silently absent from the oracle: measured as
            // `contains toTypedDataHash -> ptr`, where the source plainly says
            // `let ptr := mload(0x40)`.
            const left = n.childForFieldName?.("left")
            name = left ? left.text.trim() : ""
          }
        }
        if (name !== "" && !STORE_REFUSED_SYMBOL_NAMES.has(name)) nextOwner = name
      } else if (n.type === "struct_member" || n.type === "enum_value") {
        nextOwner = owner
      }
      for (const c of children(n)) stack.push({ n: c, owner: nextOwner })
    }
  }

  // ── overrides: CONSISTENCY-ONLY, and the header says why. Every base that
  //    DECLARES a same-named member is an edge; a base that does not is not.
  for (const d of descendants(root, "function_definition")) {
    const nm = d.childForFieldName?.("name")
    const spec = namedChildOfType(d, "override_specifier")
    if (!nm || !spec) continue
    const explicit: string[] = []
    for (const u of descendants(spec, "user_defined_type")) {
      const b = udtName(u)
      if (b !== "") explicit.push(b)
    }
    let bases = explicit
    let ambiguous = false
    if (bases.length === 0) {
      // No explicit list: the bases come from the enclosing contract's header.
      let p: any = d.parent
      while (p && p.type !== "contract_declaration" && p.type !== "interface_declaration" &&
             p.type !== "library_declaration") p = p.parent
      const cn = p?.childForFieldName?.("name")
      bases = cn ? (contractBases.get(cn.text) ?? []) : []
      // SOLIDITY-11. A bare `override` over SEVERAL header bases is a genuine
      // ambiguity: Solidity 0.8.8+ requires the explicit list precisely when more
      // than one base declares the member, so the keyword says ONE of them does and
      // not which. Deriving an edge here would make the oracle agree with a
      // FABRICATION, which is the one failure mode an oracle exists to catch. The
      // honest answer is no edge, and the analyzer refuses it for the same reason.
      if (bases.length > 1) { ambiguous = true; bases = [] }
    }
    if (ambiguous) continue
    // WHY NO `baseHasMember` GATE ANY MORE. The first version required the base to be
    // declared IN THIS FILE and to declare the member, which derived truth only for
    // 8 rows and left the analyzer's 414 cross-file edges "unexplained" — a label
    // the harness calls a confident fabrication, correctly, because the oracle had
    // no derivation for them. But that gate tested the WRONG thing. It was not the
    // analyzer's in-file reach that made an override true; it is the language's own
    // rule that `override(X)` is REJECTED unless `X` declares the member. So the
    // invariant is the derivation, and it is also the more INDEPENDENT one: it reads
    // the keyword and the header only, never the analyzer's member table, which is
    // the structure a wrong member set would corrupt. The set comparison therefore
    // still catches a dropped edge (the original defect), an invented edge, and a
    // mis-resolved base name.
    let owner: any = d.parent
    while (owner && owner.type !== "contract_declaration" && owner.type !== "interface_declaration" &&
           owner.type !== "library_declaration") owner = owner.parent
    const self = owner?.childForFieldName?.("name")?.text
    for (const base of bases) {
      // `contract X is X` is a diamond shape the grammar accepts; `overrides m -> X`
      // inside X would be a function overriding a member of its own owner.
      if (base === self) continue
      push("overrides", nm.text, base)
    }
  }

  // ── SOL-3's synthesised getter: a FACT about the language, not a choice, so the
  //    oracle reproduces it. Omitting it would report every getter edge as a
  //    fabrication and teach the reader nothing.
  for (const d of descendants(root, "state_variable_declaration")) {
    const nm = d.childForFieldName?.("name")
    if (!nm || damaged(d)) continue
    let isPublic = false
    for (const c of children(d)) if (c.type === "visibility" && c.text === "public") isPublic = true
    if (!isPublic) continue
    if (STORE_REFUSED_SYMBOL_NAMES.has(nm.text)) continue
    let owner = ""
    let p: any = d.parent
    while (p) {
      if (p.type === "contract_declaration" || p.type === "interface_declaration" ||
          p.type === "library_declaration") {
        const cn = p.childForFieldName?.("name")
        owner = cn ? cn.text : ""
        break
      }
      p = p.parent
    }
    if (owner === "") continue
    push("contains", owner, `${nm.text}()`)
  }

  // ── uses, the TYPE-mention side: a `user_defined_type` that is a DECLARED type is
  //     a use of that type, distinct from the call to its constructor. The oracle
  //     derived only positional reads, so every `RevertType private immutable _error`
  //     was an unexplained row — measured as 242, the second largest class.
  for (const d of descendants(root, "user_defined_type")) {
    if (damaged(d)) continue
    const parent = d.parent
    const ptype = parent ? parent.type : ""
    // These four contexts own the mention elsewhere; staying silent here is what
    // keeps one mention from becoming two edges.
    if (ptype === "inheritance_specifier" || ptype === "override_specifier" ||
        ptype === "new_expression" || ptype === "struct_expression" ||
        ptype === "catch_clause" || ptype === "meta_type_expression") continue
    const nm = udtName(d)
    if (nm === "" || GLOBAL_OBJECTS.has(nm)) continue
    if (RESERVED_TOKENS.has(nm) || ENGINE_FUNCTION_NAMES.has(nm)) continue
    push("uses", scopeOf(d), nm)
  }

  // ── uses: an identifier whose PARENT is an `expression` is a read, plus a
  //    member_expression's property when its object is not a global and the node is
  //    not a call's callee.
  for (const d of descendants(root, "identifier")) {
    if (damaged(d)) continue
    const name = d.text
    if (name === "" || GLOBAL_OBJECTS.has(name)) continue
    if (STORE_REFUSED_SYMBOL_NAMES.has(name)) continue
    const parent = d.parent
    // The reserved/engine checks are DEFERRED to the non-member branch, and the
    // order matters. A member property is named by its object's TYPE, not by the
    // language's global namespace, so `address(this).balance` is a real read of a
    // real member even though `balance` is an EVM opcode token — and applying the
    // check first refused it, which the adjudication reported as 2 unclassifiable
    // rows while the member branch below already carried the exemption.
    if (parent && parent.type === "member_expression") {
      const prop = parent.childForFieldName?.("property")
      if (!prop || prop.id !== d.id) continue
      if (isCallee(parent)) continue
      const obj = parent.childForFieldName?.("object")
      const objName = obj ? (obj.type === "identifier" ? obj.text
        : (namedChildren(obj)[0]?.type === "identifier" ? namedChildren(obj)[0].text : "")) : ""
      if (GLOBAL_OBJECTS.has(objName)) continue
      // `type(uint224).max` — `max`, `creationCode` and `runtimeCode` are members of
      // the META TYPE, not of the project, and the grammar puts the `.` and the
      // property in a SEPARATE member_expression wrapping the meta_type_expression.
      const objInner = obj && obj.type === "expression" ? namedChildren(obj)[0] : obj
      if (objInner && objInner.type === "meta_type_expression") continue
      push("uses", scopeOf(d), name, true)
      continue
    }
    if (name === "abi") continue
    if (RESERVED_TOKENS.has(name) || ENGINE_FUNCTION_NAMES.has(name)) continue
    if (!parent || parent.type !== "expression") continue
    // A BARE CALLEE IS A CALL, NOT A READ, and the first draft of this oracle got
    // that wrong — which the differential caught immediately as 336 MISSING rows of
    // the shape `uses useNonce -> _useNonce`, where the source plainly says
    // `return _useNonce(account);`. `calls` is not in this lane's compared set on
    // this path, so the correct behaviour is to emit NOTHING for a callee rather
    // than to emit the wrong label.
    if (isCalleeAny(d)) continue
    // AN EVENT EMISSION IS A CALL, NOT A READ — the same class, found the same way
    // as 25 MISSING rows of the shape `uses _propose -> ProposalCreated`.
    if (isEmitName(d)) continue
    push("uses", scopeOf(d), name)
  }

  /** The nearest enclosing function, else the nearest enclosing type, else the file. */
  function scopeOf(n: any): string {
    let p: any = n.parent
    while (p) {
      if (p.type === "yul_function_definition") {
        return namedChildOfType(p, "yul_identifier")?.text ?? moduleName
      }
      if (p.type === "function_definition" || p.type === "modifier_definition" ||
          p.type === "constructor_definition") {
        if (p.type === "constructor_definition") return "constructor"
        const fn = p.childForFieldName?.("name")
        return fn ? fn.text : moduleName
      }
      if (p.type === "fallback_receive_definition") {
        const first = children(p)[0]
        return first && first.type === "receive" ? "receive" : "fallback"
      }
      if (p.type === "contract_declaration" || p.type === "interface_declaration" ||
          p.type === "library_declaration") {
        const cn = p.childForFieldName?.("name")
        return cn ? cn.text : moduleName
      }
      p = p.parent
    }
    return moduleName
  }

  /**
   * Is this node, or the `expression` wrapping it, the CALLEE of an enclosing
   * call? Covers the bare `f(x)` shape, the member `a.b(x)` shape, and the
   * `struct_expression` wrapper a call-with-options puts between them.
   */
  function isCalleeAny(n: any): boolean {
    let child: any = n
    let cur: any = n
    for (let hop = 0; hop < 4; hop++) {
      const parent: any = cur?.parent ?? null
      if (!parent) return false
      if (parent.type === "expression" || parent.type === "struct_expression") {
        child = parent; cur = parent; continue
      }
      const fn = parent.childForFieldName?.("function")
      return fn !== null && fn !== undefined && fn.id === child.id
    }
    return false
  }

  /** Is this member_expression the callee of an enclosing call? */
  function isCallee(n: any): boolean {
    let child: any = n
    let cur: any = n
    for (let hop = 0; hop < 4; hop++) {
      const parent: any = cur?.parent ?? null
      if (!parent) return false
      if (parent.type === "expression" || parent.type === "struct_expression") {
        child = parent; cur = parent; continue
      }
      const fn = parent.childForFieldName?.("function")
      return fn !== null && fn !== undefined && fn.id === child.id
    }
    return false
  }

  /**
   * Is this identifier the NAME of an `emit_statement`?
   *
   * The name sits under an `expression` wrapper — and under a `struct_expression`
   * too when the emission carries options (`emit Evt{anonymous: true}(1)`) — so
   * the walk has to CLIMB through those wrappers and ask each PARENT whether the
   * node it just came from is that parent's `name:` field. The first version
   * checked only the immediate parent, saw `expression` (which has no `name:`
   * field), and returned false — so the 25 MISSING rows came straight back after
   * the fix that was supposed to remove them.
   */
  function isEmitName(n: any): boolean {
    let child: any = n
    let cur: any = n
    for (let hop = 0; hop < 4; hop++) {
      const parent: any = cur?.parent ?? null
      if (!parent) return false
      if (parent.type === "expression" || parent.type === "struct_expression") {
        child = parent; cur = parent; continue
      }
      const nm = parent.childForFieldName?.("name")
      const named = nm !== null && nm !== undefined && nm.id === child.id
      return parent.type === "emit_statement" && named
    }
    return false
  }

  /** Does `base` DECLARE a member named `name`? Built from the member table. */
  function baseHasMember(_root: any, base: string, name: string): boolean {
    const set = memberTable.get(base)
    return set !== undefined && set.has(name)
  }

  return edges
}

/**
 * The oracle's CALL, REFERENCE and EXPORT derivations.
 *
 * WHY THESE ARE HERE RATHER THAN LEFT UNCOMPARED. With `calls`, `references` and
 * `exports` underived, every edge the analyzer emits for them lands in the
 * harness's `unexplained` bucket — which that harness calls "a confident
 * fabrication", because unexplained means the tree did not say it. They are not
 * fabrications; they are edges the ORACLE is silent about, and the harness's own
 * notes record that shape repeatedly ("a label the truth side does not derive
 * cannot be compared, because every analyzer edge of that label would be counted
 * as fabrication — the #910 lesson"). Measured on the 60-file draw before this was
 * written: 130 unexplained across those three labels, zero of them a fabrication.
 *
 * INDEPENDENCE, stated per class rather than as a blanket claim:
 *
 *   calls      INDEPENDENT, with one shared subtlety. The callee NAME is resolved
 *              by descending the same wrapper chain the grammar builds
 *              (`expression` → `struct_expression` for a call carrying options,
 *              `payable_conversion_expression` under a member's `object:`) — that
 *              is the tree's shape, not a choice — and a callee is never also a
 *              read, which the rule the read pass got wrong and which the
 *              differential reported as 361 MISSING rows.
 *   references INDEPENDENT for imports (a braced list's names are read
 *              POSITIONALLY, because grammar.js puts none of them in `import_name`),
 *              for `using` directives, for a caught error and for a user-defined
 *              meta-type mention. The GETTER link is REPRODUCED rather than
 *              derived, and saying so is the point: `balance -> balance()` is a
 *              fact about the language (SOL-3) rather than a choice, and an oracle
 *              that omitted it would report every getter edge as a fabrication.
 *   exports    INDEPENDENT, and it is the one class where the two sides could
 *              legitimately differ — Solidity has no `export` statement, so "what a
 *              file exports" is a reading (SOL-12: the compilation-unit surface,
 *              free functions excluded). The oracle implements that reading from
 *              file SCOPE, so a disagreement is about the reading and not the tree.
 */
export function deriveSolidityCallReferenceEdges(
  root: any,
  moduleName: string,
): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  /**
   * `viaMember` is the MEMBER exemption, and it is carried HERE rather than only at
   * the call site. `at` is a grammar token (it opens `layout at`) AND a member of
   * EnumerableSet, so `_validators.at(index)` is a real call to a real member. The
   * first draft computed the exemption in the call loop and then let `push`
   * re-apply the reserved check unconditionally, which undid it.
   */
  const push = (label: string, from: string, target: string, viaMember = false) => {
    from = (from ?? "").trim()
    target = (target ?? "").trim()
    if (!from || !target) return
    if (!viaMember) {
      if (RESERVED_TOKENS.has(target)) return
      if (ENGINE_FUNCTION_NAMES.has(target)) return
    }
    if (STORE_REFUSED_SYMBOL_NAMES.has(target)) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  const nearestScope = (n: any): string => {
    let p: any = n?.parent ?? null
    while (p) {
      if (p.type === "yul_function_definition") return namedChildOfType(p, "yul_identifier")?.text ?? moduleName
      if (p.type === "function_definition" || p.type === "modifier_definition" ||
          p.type === "constructor_definition") {
        if (p.type === "constructor_definition") return "constructor"
        const fn = p.childForFieldName?.("name")
        return fn ? fn.text : moduleName
      }
      if (p.type === "fallback_receive_definition") {
        const first = children(p)[0]
        return first && first.type === "receive" ? "receive" : "fallback"
      }
      if (p.type === "contract_declaration" || p.type === "interface_declaration" ||
          p.type === "library_declaration") {
        const cn = p.childForFieldName?.("name")
        return cn ? cn.text : moduleName
      }
      p = p.parent
    }
    return moduleName
  }

  /** The callee NAME, descending the wrappers the grammar builds. Stops at the
   *  first name-bearing node, and reports whether a member_expression was crossed. */
  const callee = (n: any, depth = 0): { name: string; viaMember: boolean } | null => {
    if (!n || depth > 6) return null
    switch (n.type) {
      case "identifier":
        return { name: n.text, viaMember: false }
      case "member_expression": {
        const prop = n.childForFieldName?.("property")
        return prop ? { name: prop.text, viaMember: true } : null
      }
      case "struct_expression":
        return callee(n.childForFieldName?.("type") ?? null, depth + 1)
      case "user_defined_type": {
        const nm = udtName(n)
        return nm === "" ? null : { name: nm, viaMember: false }
      }
      case "array_access":
        return callee(n.childForFieldName?.("base") ?? null, depth + 1)
      case "new_expression":
        // grammar.js models `new X(args)` as a `call_expression` WRAPPING a
        // `new_expression`, so the call walk reaches it — and the default branch
        // would descend into the `user_defined_type` and report a `calls` to the
        // constructed type beside its `instantiates`. Two edges for one fact; the
        // analyzer emits only `instantiates`, and the differential reported the
        // difference as `calls setUp -> NoncesKeyedMock` and
        // `calls constructor -> SampleAccount`.
        return null
      default: {
        for (const c of namedChildren(n)) {
          const got = callee(c, depth + 1)
          if (got) return got
        }
        return null
      }
    }
  }

  for (const d of descendants(root, "call_expression")) {
    if (damaged(d)) continue
    const fn = d.childForFieldName?.("function")
    const got = callee(fn)
    if (!got || got.name === "") continue
    push("calls", nearestScope(d), got.name, got.viaMember)
  }

  for (const d of descendants(root, "emit_statement")) {
    if (damaged(d)) continue
    const nm = d.childForFieldName?.("name")
    const got = callee(nm)
    if (got && got.name !== "") push("calls", nearestScope(d), got.name, got.viaMember)
  }

  // `modifier_invocation` carries no field at all; the name is its first identifier.
  for (const d of descendants(root, "modifier_invocation")) {
    if (damaged(d)) continue
    const id = namedChildOfType(d, "identifier")
    if (id) push("calls", nearestScope(d), id.text)
  }

  // `revert MyError(...)` — a custom error is a CALL.
  // A custom error IS a call. This derivation was dead code for exactly as long as
  // the analyzer's was: `namedChildren(d)[0]` is an `expression` WRAPPER for every
  // spelling — `revert Boom(1);`, `revert Solo;`, `revert("x");` — so the guard was
  // false for every possible input and `udtName()` on a wrapper returns "".
  //
  // Both sides being wrong is why F5 never noticed: the analyzer and the oracle
  // agreed at zero. Agreement between two instruments that are both dead is not
  // corroboration, and when SOL-15 repaired the ANALYZER the pair immediately
  // disagreed — 37 unexplained edges that were never fabrications, only a truth
  // side that had nothing to say. An oracle has to be repaired when the thing it
  // measures changes, or it silently becomes a rubber stamp for whatever the
  // analyzer does next.
  for (const d of descendants(root, "revert_statement")) {
    if (damaged(d)) continue
    const first = namedChildren(d)[0]
    if (!first) continue
    // `revert Boom(1)` puts the name in the call's `function:` field; `revert Solo`
    // puts it directly under the wrapper; `revert("x")` yields neither, and a
    // string is not a name, so deriving nothing there is correct rather than a miss.
    const callee = first.type === "call_expression"
      ? descendTo(first.childForFieldName?.("function"))
      : descendTo(first)
    if (!callee) continue
    const name = callee.type === "identifier" ? callee.text
      : callee.type === "user_defined_type" ? udtName(callee)
        : ""
    if (name !== "") push("calls", nearestScope(d), name)
  }

  /** Descend through `expression` wrappers to the first name-bearing node. */
  function descendTo(node: any, depth = 0): any {
    if (!node || depth > 6) return null
    if (node.type === "identifier" || node.type === "user_defined_type" ||
        node.type === "member_expression") return node
    for (let i = 0; i < node.namedChildCount; i++) {
      const got = descendTo(node.namedChild(i), depth + 1)
      if (got) return got
    }
    return null
  }

  // Yul: a `yul_function_call` whose `function:` is a `yul_identifier` is a project
  // function; a `yul_evm_builtin` is an OPCODE (SOL-8).
  for (const d of descendants(root, "yul_function_call")) {
    if (damaged(d)) continue
    const fn = d.childForFieldName?.("function")
    if (fn && fn.type === "yul_identifier") push("calls", nearestScope(d), fn.text)
  }

  for (const d of descendants(root, "import_directive")) {
    if (damaged(d)) continue
    const src = d.childForFieldName?.("source")
    const path = src ? String(src.text).replace(/^"|"$/g, "") : ""
    void path
    const alias = d.childForFieldName?.("alias")
    const named: string[] = []
    let depth = 0
    for (const c of children(d)) {
      if (c.type === "{") depth++
      else if (c.type === "}") depth--
      else if (depth === 1 && c.type === "identifier") named.push(c.text)
    }
    const plain = d.childForFieldName?.("import_name")
    if (named.length > 0) for (const n of named) push("references", moduleName, n)
    else if (alias) push("references", moduleName, alias.text)
    else if (plain) push("references", moduleName, plain.text)
    // A BARE import binds no name, so it contributes no edge: the only string
    // available is the path, and the analyzer's F9 gate refuses a target carrying
    // `/`. Derived here rather than emitted so the two sides agree on WHY.
  }

  for (const d of descendants(root, "type_alias")) {
    const id = namedChildOfType(d, "identifier")
    if (id) push("references", nearestScope(d), id.text)
  }
  for (const d of descendants(root, "using_alias")) {
    for (const id of namedChildren(d)) if (id.type === "identifier") push("references", nearestScope(d), id.text)
  }
  for (const d of descendants(root, "catch_clause")) {
    const id = namedChildOfType(d, "identifier")
    if (id) push("references", nearestScope(d), id.text)
  }
  for (const d of descendants(root, "meta_type_expression")) {
    const udt = descendants(d, "user_defined_type")[0]
    const nm = udt ? udtName(udt) : ""
    // Only a USER-DEFINED type is a project reference; `type(uint256)` names a
    // language type.
    if (nm !== "" && !RESERVED_TOKENS.has(nm)) push("references", nearestScope(d), nm)
  }

  // SOL-3's getter link, REPRODUCED (a language fact, not a choice).
  for (const d of descendants(root, "state_variable_declaration")) {
    const nm = d.childForFieldName?.("name")
    if (!nm || damaged(d)) continue
    if (STORE_REFUSED_SYMBOL_NAMES.has(nm.text)) continue
    let isPublic = false
    for (const c of children(d)) if (c.type === "visibility" && c.text === "public") isPublic = true
    if (!isPublic) continue
    let owner = ""
    let p: any = d.parent
    while (p) {
      if (p.type === "contract_declaration" || p.type === "interface_declaration" ||
          p.type === "library_declaration") {
        const cn = p.childForFieldName?.("name")
        owner = cn ? cn.text : ""
        break
      }
      p = p.parent
    }
    if (owner !== "") push("references", nm.text, `${nm.text}()`)
  }

  // SOL-12: the compilation-unit surface. Free functions are EXCLUDED, because
  // `solc` emits an ABI and an abstraction for each contract, interface and
  // library in a source unit and for nothing else.
  const FILE_SCOPE_EXPORTS = new Set([
    "contract_declaration", "interface_declaration", "library_declaration",
    "struct_declaration", "enum_declaration", "event_definition",
    "error_declaration", "constant_variable_declaration", "user_defined_type_definition",
  ])
  {
    const stack: { n: any; atFileScope: boolean }[] = [{ n: root, atFileScope: true }]
    while (stack.length > 0) {
      const { n, atFileScope } = stack.pop()!
      const isHeritage = n.type === "contract_declaration" || n.type === "interface_declaration" ||
        n.type === "library_declaration"
      if (atFileScope && FILE_SCOPE_EXPORTS.has(n.type)) {
        const nm = n.childForFieldName?.("name")
        if (nm && !STORE_REFUSED_SYMBOL_NAMES.has(nm.text)) push("exports", moduleName, nm.text)
      }
      // `source_file` does not CLOSE the file scope — it IS the file scope. The
      // first draft treated it as closing it, so every declaration below was marked
      // nested and the oracle derived ZERO `exports`, which the harness reported as
      // "COMPARED A LABEL WITH NO TRUTH … 73 comparable, 0 truth".
      const nextScope = atFileScope && !isHeritage
      for (const c of children(n)) stack.push({ n: c, atFileScope: nextScope })
    }
  }

  return edges
}
