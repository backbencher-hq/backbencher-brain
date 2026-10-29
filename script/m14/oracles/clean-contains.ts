/**
 * The Clean `contains` oracle — LANE-OWNED.
 *
 * ## The rule, from CLEAN
 *
 * Containment is DECLARATION NESTING. A Clean module contains the declarations written in its
 * body; a data type contains its constructors and its record fields; a class contains its member
 * signatures; an instance contains its member definitions; a function contains the definitions
 * bound in its `where` (and `with`/`let`) blocks. Nothing else contains anything, and a name is
 * contained by exactly one owner — the nearest enclosing declaration that HAS a name.
 *
 * ## HOW THIS DIFFERS FROM THE FUNCTION UNDER TEST
 *
 * The analyzer derives `contains` from its SYMBOL TABLE: `for each symbol with an ownerName, emit
 * (owner, name)`. That is a sound projection of whatever its two passes put in the table, and it is
 * also why it cannot disagree with itself: a symbol that is missing is missing from both this edge
 * and every other one, and no count in the lane shows it.
 *
 * This oracle starts from the TREE and asks a different question — "which declaration encloses
 * which other declaration?" — so a disagreement is a fact about the analyzer's symbol emission
 * rather than a restatement of it. Three consequences are deliberate:
 *
 *  1. AN INSTANCE'S IDENTITY IS A NAME. `instance toString (List a)` is an instance FOR `List`, and
 *     `List a` is a type expression no symbol can be named. The oracle takes the instance's head
 *     name; the full spelling is `targetSpelling` metadata on the analyzer's side. Measured before
 *     the analyzer was aligned: 19 `contains` sources and 22 `implements` targets carried a space
 *     in them, every one an instance identity.
 *  2. A `derive` CLAUSE DERIVES AN INSTANCE, it does not declare a container. Its target is the
 *     derived type and it has no members of its own.
 *  3. A LOCAL IS CONTAINED BY ITS FRAME. `where`/`with`/`let` do not open an owner of their own —
 *     the frame that owns the block owns the locals, which is why `contains toString -> toS` is a
 *     resolvable edge and `contains <where-block> -> toS` would not be.
 *
 * ## What this oracle deliberately does NOT claim
 *
 * It does not check symbol KINDS, parameters, comments, ranges, or the scoped identity a local
 * carries (`frame.local`). It derives the (owner, name) SET. A `contains` edge whose owner is a
 * class declared in another file is not this oracle's business either — the analyzer's rule for
 * that case (case 3 of its `frameOwner`) is a decision about resolvability, and it is stated in the
 * lane doc rather than delegated here.
 */

export type CleanContainsEdge = { label: "contains"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

function moduleNameOf(node: any): string {
  if (!node) return ""
  let out = ""
  for (const c of kids(node)) {
    const leaf = c.type === "module_name" ? moduleNameOf(c) : String(c.text ?? "")
    if (!leaf) continue
    if (out) out += "."
    out += leaf
  }
  return out || String(node.text ?? "")
}

/** Every whitespace character removed — a type constructor's spelling carries none. */
function bare(text: string): string {
  let out = ""
  for (const ch of String(text ?? "")) if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
  return out
}

/**
 * The nameable identity of a type EXPRESSION, or null when it has none.
 *
 * Only a shape with a HEAD NAME has one: `List a` → `List`, `(List a)` → `List`, `? a` → `?`,
 * `Data.Error` → `Data.Error`. A tuple, a unit type or a bare type variable names no type
 * constructor, so it is not an identity — publishing the spelling would create a container that no
 * symbol can ever match.
 */
function typeIdentity(node: any): string | null {
  if (!node) return null
  switch (node.type) {
    case "constructor":
    case "dotted_type":
      return String(node.text ?? "").trim() || null
    case "question_type":
      return String(kids(node)[0]?.text ?? node.text ?? "").trim() || null
    case "type_variable":
      // A POLYMORPHIC instance (`instance Sized {!} a`) is for a type VARIABLE, which Clean's own
      // rule says is a binding and never a name. No identity.
      return null
    case "type_application":
    case "type_paren":
    case "array_type":
    case "uniqueness_type":
    case "unique_var_type": {
      for (const c of kids(node)) {
        const inner = typeIdentity(c)
        if (inner) return inner
      }
      return null
    }
    case "tuple_type":
    case "unit_type":
    case "list_type":
    case "type_function":
      return bare(node.text) || null
    default:
      return null
  }
}

/** The `name` field, as the spelling the declaration publishes. */
function declaredNameOf(node: any): string | null {
  const named = node.childForFieldName?.("name")
  const text = named ? String(named.text ?? "").trim() : ""
  return text || null
}

/**
 * `contains` truth for one tree.
 *
 * Deduped by (owner, name): one declaration contains a name once, however many clauses spell it.
 */
export function deriveCleanContainsTruth(root: any): CleanContainsEdge[] {
  const edges: CleanContainsEdge[] = []
  const seen = new Set<string>()
  let moduleScope = "root"

  const emit = (owner: string | null, name: string | null): void => {
    if (!owner || !name || owner === name) return
    const key = `${owner}|${name}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ label: "contains", from: owner, target: name })
  }

  /** `owner` is the nearest enclosing DECLARATION's name, or null before any declaration. */
  const visit = (n: any, owner: string | null): void => {
    if (n.type === "module_declaration") {
      const named = n.childForFieldName?.("name")
      const name = named ? moduleNameOf(named) : ""
      if (name) moduleScope = name
      // The module header is not a declaration nested in anything: it IS the file's owner.
      for (const c of kids(n)) if (c.type !== "module_name") visit(c, owner)
      return
    }

    // An instance's identity comes from its TARGET TYPE, not from a `name` field (`name` is the
    // CLASS). A polymorphic instance has no identity and therefore contains nothing.
    if (n.type === "instance_declaration") {
      let target: any = null
      for (let i = 0; i < n.childCount; i++) {
        if (n.fieldNameForChild(i) !== "argument") continue
        const c = n.child(i)
        if (c && typeIdentity(c)) target = c
      }
      const identity = target ? typeIdentity(target) : null
      for (const c of kids(n)) {
        if (c.type === "instance_class") continue
        if (c === target) continue
        visit(c, identity ?? owner)
      }
      return
    }

    // A `derive` clause declares no container: `derive bimap PAIR` derives an instance for an
    // existing type, and its children are the generic name and the target.
    if (n.type === "derive_declaration") return

    // A declaration that names itself. Its own name is contained by the enclosing declaration; its
    // children are contained by IT.
    const name = declaredNameOf(n)
    const isDeclaration =
      name !== null &&
      (n.type === "function_declaration" ||
        n.type === "operator_definition" ||
        n.type === "generic_case_definition" ||
        n.type === "type_definition" ||
        n.type === "class_declaration" ||
        n.type === "macro_definition" ||
        n.type === "generic_declaration" ||
        n.type === "data_constructor" ||
        n.type === "record_field" ||
        n.type === "foreign_export" ||
        n.type === "type_signature")
    if (isDeclaration) {
      emit(owner, name)
      for (const c of kids(n)) visit(c, name)
      return
    }

    // A class member's name is inside its own `class_member` wrapper, not on a `name` field.
    if (n.type === "class_member" || n.type === "instance_member") {
      const inner = kids(n).find((c) => declaredNameOf(c) !== null)
      const memberName = inner ? declaredNameOf(inner) : null
      if (memberName) emit(owner, memberName)
      for (const c of kids(n)) visit(c, memberName ?? owner)
      return
    }

    for (const c of kids(n)) visit(c, owner)
  }

  // The module name is the owner of everything at file top level, and it is known before the walk
  // reaches the module header in the ordinary case, but a headerless include stub has none: those
  // files publish nothing, which is the lane's own stated rule.
  const header = kids(root).find((c) => c.type === "module_declaration")
  if (header) {
    const named = header.childForFieldName?.("name")
    const name = named ? moduleNameOf(named) : ""
    if (name) moduleScope = name
  }
  for (const c of kids(root)) visit(c, moduleScope)
  return edges
}
