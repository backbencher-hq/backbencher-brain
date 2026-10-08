// LANE-OWNED (php), 2026-10-08. `overrides` was the LAST label on php's axis, and it
// failed in the opposite direction to `exports`: the differential COMPARED it (php is in
// the base `overrides` disjunct, which excludes only csharp/dart/swift/cpp/go) while no
// php oracle derived it, so every analyzer row entered the comparison with no truth to
// meet and was counted as an unexplained FABRICATION. The state was declared rather than
// discovered late — `script/m14/spec/php-completeness.json`,
// `label_coverage.declared_no_truth`, with the reason and the `closes_when` this file
// discharges — but a declaration is not an oracle, and an accusation of fabrication is a
// worse reading than "nobody wrote down what it should have produced".
//
// ## The rule, in PHP's terms
//
// A method that re-declares a name its BASE CLASS already declares OVERRIDES it. Three
// properties decide it, and each has a boundary worth stating:
//
//   1. THE BASE IS DECLARED IN THE SAME FILE. This is not a modelling convenience, it is
//      the boundary of what is decidable from one compilation unit: php keys every edge on
//      the LEAF name, so `class B extends A` tells you the base is called `A` and nothing
//      about WHICH `A` — phpunit alone declares three `TestSuite` classes and two `Assert`
//      classes, one of them vendored, with different method sets. Resolving that needs a
//      cross-file, qualified index that this lane does not have (recorded as a gap), so a
//      cross-file base produces NO edge on EITHER side, and the fixtures
//      `php/cross-file-override` and `php/external-override` pin exactly that: a
//      same-leaf base in another file must not produce an override at any confidence.
//      The consequence for a reader: this label is COMPLETE OVER ITS SUBSET, not complete
//      over PHP. The subset is stated in the artifact, and the analyser's own count is the
//      same subset, so the comparison is sound; it is the CLAIM that must stay bounded.
//
//   2. THE BASE'S DECLARATION IS NOT `private`. PHP: "Members declared as private may only
//      be accessed by the class that defines the member" — a private method is not
//      inherited, so a subclass method of the same name is a DIFFERENT method and no
//      override at all. This is not a hypothetical: the fixture that found the analyzer's
//      missing filter declares a private method on both sides on purpose, and the
//      population measurement (0 private base methods among phpunit's 527 and phpmyadmin's
//      553 override edges) is why it survived for as long as it did.
//
//   3. THE SUBCLASS DECLARES A METHOD OF THAT NAME. Any visibility on the subclass side:
//      widening `protected` to `public` is the ordinary case, and `private` on the
//      subclass is legal PHP (the two privates are unrelated, but the NAME still
//      re-declares the inherited one for every non-private case — see the note below on
//      what this oracle does NOT model).
//
// WHAT IS DELIBERATELY NOT MODELLED, priced rather than guessed:
//   - `implements`: implementing an interface's method is an IMPLEMENTATION, not an
//     override, and PHP's own vocabulary separates them. The analyzer's base is the
//     `extends` clause only, and so is this oracle's.
//   - `use SomeTrait;`: a class that re-declares a trait method is resolving a precedence
//     conflict, not overriding a base — PHP's rule for traits is "the current class's
//     member overrides the trait's", which is a different relationship.
//   - `$object->m()` calls, `parent::m()`, `static`, `final`, and signature
//     compatibility: PHP's rules about redeclaring a `final` method or changing a
//     signature are FATAL ERRORS in a runnable program, not graph relationships, and the
//     lane models the inheritance name, not the fatal-error surface.
//   - a base in ANOTHER FILE, per (1) above.
//
// ## The base's spelling
//
// The lane keys on the LEAF name, so `class B extends Vendor\Base` has the base `Base` —
// with one exception the analyzer documents as PHPD10: when the written base is QUALIFIED
// and its leaf equals the class's OWN name (`class A extends Foo\A`), taking the leaf would
// fabricate a self-edge, so the qualified spelling is kept. This oracle applies the same
// rule because it is a property of the lane's IDENTITY scheme (what a base is CALLED in the
// graph), not a property of the analyzer: the two sides have to agree on the name before
// their edges can be compared.
//
// ## The edge shape
//
// `source: "<owner>.<method>"`, `target: "<base>.<method>"` — the same shape the analyzer
// emits, because the differential matches on label+target and a differently-spelled target
// would read as a mismatch in the corpus rather than in the instrument. Deduped per file on
// label+target, which is the shape the analyzer side is collapsed to before comparison.

export function derivePhpOverridesTruth(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()

  /** A named type body that can declare methods. */
  const TYPE_KINDS = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"])

  const nameOf = (node: any): string => String(node?.childForFieldName?.("name")?.text ?? "")

  /** The leaf of a possibly-qualified, possibly-leading-`\` name. */
  const leaf = (raw: string): string => {
    const i = raw.lastIndexOf("\\")
    return i >= 0 ? raw.substring(i + 1) : raw
  }
  /** The lane's identity for a base: the leaf, unless that would name the class itself. */
  const baseIdentity = (raw: string, ownName: string): string => {
    const l = leaf(raw)
    if (raw.includes("\\") && l === ownName) {
      let i = 0
      while (i < raw.length && raw.charCodeAt(i) === 92) i++
      return raw.substring(i)
    }
    return l
  }

  /** `private` as a MODIFIER node on the declaration — never a text scan of the body. */
  const isPrivate = (member: any): boolean => {
    for (let i = 0; i < member.childCount; i++) {
      const c = member.child(i)
      if (c && c.type === "visibility_modifier" && String(c.text) === "private") return true
    }
    return false
  }

  type TypeInfo = { name: string; base: string | null; methods: Map<string, { private: boolean }> }
  const types = new Map<string, TypeInfo>()

  // One walk, collecting every named type's own name, base and methods. A single pass is
  // enough because the cross-reference is by NAME within the file, not by order — and the
  // population's order (`class B extends A` before `class A`) is legal PHP and must not
  // change the answer.
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (TYPE_KINDS.has(String(n.type))) {
      const name = nameOf(n)
      if (name) {
        let baseNode: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "base_clause") {
            baseNode = c.namedChild(0) ?? null
            break
          }
        }
        const methods = new Map<string, { private: boolean }>()
        const bodies: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "declaration_list" || c.type === "enum_declaration_list")) bodies.push(c)
        }
        for (const body of bodies) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const m = body.namedChild(i)
            if (!m) continue
            const mt = String(m.type)
            // A method with a BODY, or an abstract/interface declaration without one —
            // both declare the name, which is what an override is about.
            if (mt !== "method_declaration" && mt !== "abstract_method_declaration") continue
            const mname = nameOf(m) || String(m.childForFieldName?.("name")?.text ?? "")
            if (!mname) continue
            methods.set(mname, { private: isPrivate(m) })
          }
        }
        types.set(name, { name, base: baseNode ? baseIdentity(String(baseNode.text ?? ""), name) : null, methods })
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  for (const info of types.values()) {
    if (!info.base) continue
    const base = types.get(info.base)
    // (1) the base must be declared in THIS file; (2) it must declare the member.
    if (!base) continue
    for (const [mname, decl] of info.methods) {
      const baseMethod = base.methods.get(mname)
      if (!baseMethod) continue
      // (3) a private base method is not inherited, so there is nothing to override.
      if (baseMethod.private) continue
      const target = `${base.name}.${mname}`
      const key = "overrides:" + target
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ label: "overrides", from: `${info.name}.${mname}`, target })
    }
  }
  return edges
}
