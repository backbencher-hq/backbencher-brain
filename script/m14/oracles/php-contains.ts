// LANE-OWNED (php), RESTORED 2026-10-08. This file did not exist when this session
// started; the oracle inside it was authored at `93d5b5e65` (2026-09-30) INSIDE
// `script/m14/differential.ts`, and the merge `dc7b8b494` ("607 remote commits united
// with 502 local") spliced that harness and dropped it. The splice was repaired for
// SYNTAX only (`d4c4bba34`, `db077c5a6`) and the dropped content was never restored, so
// for a week the differential compared php's 4th-largest label against nothing while the
// review kept saying otherwise. The body below is VERBATIM from that commit — the header
// carries the measurement that justifies the rule and the shape map the rule is written
// from, and a paraphrase would be a claim without provenance.
//
// It lives in `script/m14/oracles/` rather than back inside `differential.ts` for the
// reason `dart-contains.ts` gives: that shared file is edited by several lanes at once,
// and every line a lane keeps out of it is a line that cannot conflict. Wiring is one
// import and one registration.
//
// VERIFIED byte-exact against `git show 93d5b5e65:script/m14/differential.ts` lines
// 11515-11668 after the restore (`diff` empty), the same discipline the three
// independent derivations restored into `differential.ts` on the same day were held to.
//
// ONE SECTION IS NOT VERBATIM, and it is marked in place: `M60 NAMESPACE CONTAINMENT`,
// added 2026-10-08. The oracle as authored predates that analyzer feature, and its first
// run with this oracle registered reported 111 `contains` edges with no truth row — every
// sampled one a namespace containing a declaration. That section's own comment states the
// rule, the shapes it is re-derived from, and the one adjudicated shape it does NOT model.
/**
 * PHP `contains` truth — F1, the label that had no second implementation at all.
 *
 * MEASURED GAP THIS CLOSES. `RealPhpAnalyzer` emits 24,707 `contains` edges over
 * the two pinned corpora (4,463 git-tracked `.php` files) — the lane's 4th-largest
 * label — and `derivePhpEdges` derived NONE of them, so `contains` was not in the
 * per-language allowlist and the differential compared nothing. That is the shape
 * the harness file's own html-`contains` note names: "the two sides could not see
 * each other at all"; the html lane, css, typescript, java, kotlin, perl, scss,
 * powershell and go's Round 7 all had to fix it the same way, and php was the
 * next one to need it. `rel-type-coverage-gate` reported it as
 * `DERIVATION|php|emits contains but the differential audits [...] — the type is
 * stored and compared against nothing`, counted as 1 NEW against the recorded
 * debt baseline.
 *
 * WHY IT SURVIVED EVERY OTHER GATE, which is the part worth recording: the spec's
 * `requiredKinds` row DOES name `contains`, so completeness section B reports
 * 8/8 pass. But section B only checks `requiredKinds ⊆ pinned-by-fixtures`
 * (`completeness-inventory.ts:892`) and never `emitted ⊆ requiredKinds`. A kind
 * the analyzer emits and the row omits is invisible to it by construction. So the
 * gate that certifies the relationship contract does not read the analyzer — the
 * lane's own recurring lesson, *a gate that reads a different object than the
 * consumer certifies a different program*, in its purest form.
 *
 * WRITTEN FROM PHP'S OWN SEMANTICS, not from the analyzer's output. The rule is one
 * sentence: a member declared inside a NAMED type's body belongs to that type. The
 * shapes come from the pinned grammar (probe-verified, `script/m60/tmp/php-contains-shapes.mts`),
 * not from reading `src/ast/real-php-analyzer.ts`:
 *
 *   class_declaration    > declaration_list
 *   interface_declaration > declaration_list
 *   trait_declaration    > declaration_list
 *   enum_declaration     > enum_declaration_list      <- methods AND enum_case share it
 *
 * and the member names:
 *
 *   method_declaration              > name
 *   property_declaration            > property_element > variable_name   ($ stripped)
 *   const_declaration               > const_element > name
 *   enum_case                       > name
 *   method > formal_parameters      > property_promotion_parameter > variable_name ($ stripped)
 *
 * The last one is the one a checklist misses: a promoted constructor parameter
 * declares a PROPERTY, so the class contains it as well as containing the
 * constructor. (1,301 promotion sites in the two corpora.)
 *
 * ANONYMOUS CLASSES ARE NOT CONTAINERS, and the tree says so on its own: the
 * grammar's `anonymous_class` (`new class { ... }`) has NO `name` child, so there
 * is no owner to name. This is the analyzer's M37.13 ruling ("no nameable
 * identity") arriving from the grammar rather than from a shared rule — the
 * property this function needs, and the reason it is worth the 60 lines.
 *
 * `use_declaration` (trait use) and `comment` are also direct children of a body
 * and are deliberately NOT containment: a trait is a `uses` edge, not a member.
 *
 * NO SHARED RULE WITH THE ANALYZER. Not a shared name helper, not a shared
 * "is this a bind site", not the analyzer's `pushMembers`. The `$`-strip is a
 * local two-line char test, and the member-name rules are read off the grammar's
 * own shapes above. `json.ts` states why that is the only property that makes a
 * MATCH mean something: an oracle that shares the rule cannot see the rule.
 */
export function derivePhpContainsEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()

  /** The `$`-less name of a `variable_name` — a local char test, not the analyzer's. */
  const bareVar = (v: any): string | undefined => {
    if (!v) return undefined
    const t = String(v.text ?? "")
    const n = t.charCodeAt(0) === 36 /* $ */ ? t.slice(1) : t
    return n || undefined
  }
  const firstNameChild = (n: any): string | undefined => {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "name") return c.text
    }
    return undefined
  }
  const push = (owner: string, target: string | undefined) => {
    if (!owner || !target) return
    const k = `contains|${owner}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label: "contains", from: owner, target })
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    // A NAMED type is a container. `anonymous_class` has no `name` child, so it
    // falls out here — the grammar, not a rule, is what makes it unnameable.
    if (n.type === "class_declaration" || n.type === "interface_declaration" ||
        n.type === "trait_declaration" || n.type === "enum_declaration") {
      const owner = firstNameChild(n)
      if (owner) {
        let body: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "declaration_list" || c.type === "enum_declaration_list")) { body = c; break }
        }
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const m = body.namedChild(i)
            if (!m) continue
            if (m.type === "method_declaration") {
              push(owner, m.childForFieldName?.("name")?.text)
              // A promoted parameter is ALSO a declared property of the class.
              const params = m.childForFieldName?.("parameters")
              if (params) {
                for (let j = 0; j < params.namedChildCount; j++) {
                  const p = params.namedChild(j)
                  if (p && p.type === "property_promotion_parameter") {
                    for (let k2 = 0; k2 < p.namedChildCount; k2++) {
                      const v = p.namedChild(k2)
                      if (v && v.type === "variable_name") { push(owner, bareVar(v)); break }
                    }
                  }
                }
              }
            } else if (m.type === "property_declaration") {
              for (let j = 0; j < m.namedChildCount; j++) {
                const el = m.namedChild(j)
                if (!el || el.type !== "property_element") continue
                for (let k2 = 0; k2 < el.namedChildCount; k2++) {
                  const v = el.namedChild(k2)
                  if (v && v.type === "variable_name") { push(owner, bareVar(v)); break }
                }
              }
            } else if (m.type === "const_declaration") {
              for (let j = 0; j < m.namedChildCount; j++) {
                const el = m.namedChild(j)
                if (!el || el.type !== "const_element") continue
                push(owner, firstNameChild(el))
              }
            } else if (m.type === "enum_case") {
              push(owner, firstNameChild(m))
            }
            // `use_declaration` (trait use) and `comment` are body children that
            // are NOT members: a trait is a `uses` edge, a comment is not a thing.
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  // ========================================================================
  // M60 NAMESPACE CONTAINMENT — ADDED 2026-10-08 to the restored oracle.
  //
  // WHY THIS IS HERE AND WHY IT IS THE ONLY ADDITION. The differential's first run
  // with this oracle registered read 55 (phpunit) + 56 (phpmyadmin) `contains` edges
  // with no truth row, and every printed sample was the same shape — a NAMESPACE
  // containing a type (`contains PHPUnit\TextUI -> TestRunner`, `contains
  // PhpMyAdmin\Controllers\Export -> …`; 80 of 80 sampled sources namespaced, 0
  // class-form). The restored oracle was written on 2026-09-30, before M60's namespace
  // containment landed, so its container list named only the four NAMED-TYPE bodies.
  // The contract the analyzer now honours is the one `php/namespace-containment`
  // pins: every TOP-LEVEL declaration in a namespace is contained by it — a const, a
  // class, a function, an interface, a trait, an enum — while a member is still owned
  // by its class, so the two levels coexist.
  //
  // THE RULE IS RE-DERIVED FROM THE TREE, not read from the analyzer, which is the
  // same property the rest of this file holds. PHP spells a namespace two ways and the
  // tree keeps them apart, exactly as the analyzer's own `namespaceSegments` comment
  // records (independently — that comment is where the shape is documented, not where
  // the rule is taken from):
  //
  //   braced     `namespace A { … }`  the declarations are children of a
  //                                   `compound_statement` INSIDE the definition, and
  //                                   the namespace ends with the block;
  //   semicolon  `namespace A; …`     the definition ends at the `;` and the
  //                                   declarations are SIBLINGS at program level, so
  //                                   the scope runs to the next `namespace_definition`
  //                                   or to end of file.
  //
  // A FILE-SCOPE declaration is one whose path to the namespace has no NAMED TYPE and
  // no CALLABLE on it — the same reading that makes phpunit's 251
  // `if (!function_exists('assertSame')) { function assertSame(…) {…} }` helpers
  // file-scope declarations: a top-level `if` is not a scope, and PHP puts those
  // functions in the namespace's function table when the guard runs. A declaration
  // INSIDE a type is pass 1's job (a member belongs to its class) and a declaration
  // inside a callable is the separate adjudicated shape this oracle does not model —
  // php publishes those with the namespace as owner (PHPD37), which is measured at 3
  // declarations corpus-wide, all in files outside the two pinned corpora, and is
  // declared here rather than silently absent.
  // ========================================================================
  const BARRIER_TYPES = new Set([
    "method_declaration", "function_definition", "anonymous_function", "arrow_function",
    "anonymous_class", "class_declaration", "interface_declaration", "trait_declaration",
    "enum_declaration",
  ])
  const NAMED_TYPE_BARRIERS = new Set([
    "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
  ])
  /** The `namespace App\One` text as WRITTEN — the same string the analyzer publishes. */
  const namespaceName = (n: any): string | undefined => {
    const c = n.namedChildCount > 0 ? n.namedChild(0) : null
    if (!c) return undefined
    if (c.type !== "namespace_name" && c.type !== "name" && c.type !== "qualified_name") return undefined
    const t = String(c.text ?? "").trim()
    return t || undefined
  }
  /** The declarations one file-scope region hands to the namespace it sits in. */
  const walkFileScope = (starts: any[], ns: string): void => {
    const local: any[] = [...starts]
    while (local.length > 0) {
      const n = local.pop()!
      if (!n) continue
      if (NAMED_TYPE_BARRIERS.has(n.type)) {
        push(ns, firstNameChild(n))
        continue // members belong to the type, which pass 1 already handled
      }
      if (n.type === "function_definition") {
        push(ns, n.childForFieldName?.("name")?.text)
        continue
      }
      if (n.type === "const_declaration") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const el = n.namedChild(i)
          if (el && el.type === "const_element") push(ns, firstNameChild(el))
        }
        continue
      }
      if (BARRIER_TYPES.has(n.type)) continue // inside a callable: not this oracle's shape
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) local.push(c)
      }
    }
  }
  {
    let inForce: string | null = null
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (!c) continue
      if (c.type === "namespace_definition") {
        const ns = namespaceName(c)
        let body: any = null
        for (let j = 0; j < c.namedChildCount; j++) {
          const b = c.namedChild(j)
          if (b && b.type === "compound_statement") { body = b; break }
        }
        if (body) {
          // Braced: the block is the scope, and the namespace ends with it.
          if (ns) walkFileScope([body], ns)
          inForce = null
        } else {
          // Semicolon: the scope runs to the next definition or to end of file.
          inForce = ns ?? null
        }
        continue
      }
      if (inForce) walkFileScope([c], inForce)
    }
  }

  return edges
}
