/**
 * The TypeScript `references` oracle — LANE-OWNED.
 *
 * It lives beside `typescript-contains.ts` rather than in `differential.ts` for
 * the reason that file's header records: several lanes edit it at once, and a
 * lane that keeps its rules in its own file keeps conflicts out of a shared one.
 *
 * ## Why this oracle exists
 *
 * `references` is the second-largest relationship TypeScript emits — 12,940
 * edges over 1000 tracked files, behind only `calls` — and it had no
 * independent cross-check at any scale. The committed lane evidence is
 * `truthSource: manual_audit` over five hand-written fixtures: a regression
 * test, not a measurement. Two measured defects came out of the lane before this
 * file existed (a parameter shadowing a file-level symbol, 229 edges; a loop
 * variable and catch binding doing the same, 81 edges), and both were found by
 * reasoning about resolution rather than by any gate. A third and fourth are
 * still open: 425 duplicated (source, target) rows inside single files, and
 * references attributed to a `global` source that no TypeScript declaration
 * could have produced.
 *
 * ## The rule
 *
 * A declaration REFERENCES a name when the declaration MENTIONS that name in its
 * own extent AND the name resolves to a declaration made in this file.
 *
 * Two clauses, and the second is the whole difficulty:
 *
 *   1. the name must be MENTIONED — read, written, or used as a type;
 *   2. the name must RESOLVE to a file-level declaration, which means it must
 *      not be bound by something nearer than that.
 *
 * Clause 2 is ordinary lexical scoping, and the analyzer does not implement it:
 * the reference pass resolves by NAME against the file's symbol table, so the
 * entire burden of correctness falls on a set of "locally bound names" that the
 * pass maintains while walking. This oracle therefore does the resolution
 * properly — it walks scopes — because an oracle that copied the analyzer's
 * shadow set would be incapable of disagreeing with it, and a shadow set is
 * precisely where both measured defects lived.
 *
 * ## Positions that are NOT references
 *
 * Each of these is a place where a name is written but the mention does not
 * resolve to a declaration in this file. All were confirmed by probe against
 * the language before being encoded, not inferred from the analyzer:
 *
 *   - the PROPERTY of a member access: `o.prop` mentions `prop`, and `prop` is a
 *     property of a value, not a declaration in this file. The base still counts.
 *   - a key written in an object literal: `{ Kls: 1 }` and the shorthand `{ Kls }`.
 *     A shorthand does read `Kls`, but the family records that position as a
 *     property, not a resolution (measured: no edge either way).
 *   - a label: `outer: for (;;) break outer` names a label, which is neither a
 *     declaration nor a resolvable name.
 *   - an IMPORTED name. `import { X } from "./m"` makes `X` resolvable in the
 *     file, but the declaration lives in another file and is not this file's to
 *     attribute (measured: no edge).
 *   - the declaration's OWN name. `function f() { return f }` is recursion, and
 *     the recursion is already recorded by the call edge.
 *
 * ## Positions that ARE references
 *
 *   - a read in an expression, including a callee and `typeof X` / `instanceof X`;
 *   - a type annotation, in a parameter, a return, a type argument or a cast;
 *   - a heritage clause's base type;
 *   - a read from a NESTED function of a name bound in an enclosing scope — the
 *     nested function shadows, it does not hide.
 *
 * ## What the oracle deliberately does NOT settle
 *
 * Whether a name that happens to equal a MEMBER of a declared type (an interface
 * property, a class field) is referenceable. The analyzer resolves against a
 * symbol table that contains members, so it can publish `fn -> someField` for a
 * bare `someField` read; whether that is a reference or a collision is a family
 * decision, and the oracle records the mention and lets the comparison speak
 * rather than pre-deciding it here.
 */

export interface TruthEdge {
  label: string
  from: string
  target: string
}

const named = (n: any): any[] => (n?.namedChildren ?? [])
const field = (n: any, f: string): string | null => n?.childForFieldName?.(f)?.text ?? null

/** Nodes that DECLARE a name this file can resolve to. */
const DECLARERS = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "enum_declaration",
  "type_alias_declaration",
  "function_declaration",
  "generator_function_declaration",
  "internal_module",
  "module",
  "method_definition",
  "method_signature",
  "abstract_method_signature",
  "property_signature",
  "public_field_definition",
  "variable_declarator",
])

/** Node types that BIND a name in the scope they sit in, shadowing any file declaration. */
const BINDERS = new Set([
  "variable_declarator",
  "catch_clause",
  "for_in_statement",
  "function_declaration",
  "class_declaration",
  "identifier",
])

/**
 * `references` is the UNION OF TWO SURFACES with different rules, and that is
 * not a modelling detail — it is the rule.
 *
 * The RESOLVED surface is an expression mention whose name resolves to a
 * declaration in this file. `f` mentioning a declared `helper` is a reference to
 * `helper`; `f` mentioning its own parameter `root` is a mention of a local and
 * publishes nothing.
 *
 * The TYPE surface is a mention in a type position, and it does NOT require
 * resolution at all. That is measured and load-bearing: over 600 files, 25.6% of
 * all `references` rows (2,062 of 8,048) name a target that no declaration in the
 * file owns — `Record` 674 times, `Array` 348, `Promise` 334, `Error` 89, `Buffer`
 * 50. Those are ambient and builtin types, and the analyzer's resolved pass could
 * not have produced any of them: its symbol table is built from the file's own
 * symbols and nothing else. They come from the type pass, which records the name
 * a signature SPELLS. `function f(): Promise<T>` does reference `Promise`; a
 * consumer asking "who mentions Promise" is asking a real question, and the
 * declaration may live in another file, in a library, or nowhere at all.
 *
 * The one thing the type surface does exclude is a PRIMITIVE. `string`,
 * `number`, `boolean`, `any`, `unknown`, `never`, `void`, `object`, `symbol`,
 * `bigint`, `undefined` and `null` are the absence of a type rather than a name,
 * and a reference to one is noise: every annotated function would reference
 * `string`.
 */
const TYPE_POSITION_ROOTS = new Set([
  "type_annotation",
  "type_alias_declaration",
  "as_expression",
  "satisfies_expression",
  "type_arguments",
  "type_parameters",
  "heritage_clause",
  "implements_clause",
  "type_predicate",
  "conditional_type",
  "infer_type",
  "call_signature",
  "construct_signature",
  "index_signature",
  "method_signature",
  "abstract_method_signature",
  "property_signature",
  "public_field_definition",
  "enum_member",
  "function_type",
  "generic_type",
  "union_type",
  "intersection_type",
  "array_type",
  "tuple_type",
  "object_type",
  "lookup_type",
  "indexed_access_type",
  "mapped_type_clause",
  "type_query",
  "optional_type",
])

/** Primitives are the absence of a type, not a name to reference. */
const PRIMITIVES = new Set([
  "string", "number", "boolean", "any", "unknown", "never", "void", "object",
  "symbol", "bigint", "undefined", "null", "this", "true", "false",
])

/**
 * Mark every node that sits inside a type position, keyed by its byte span.
 *
 * Tree-sitter node objects are recreated on every access, so identity never
 * matches; a span pair is the stable key. `type_alias_declaration` is a root
 * because its VALUE is a type while its name is a declaration, and walking from
 * the whole node marks the name too — so the name slot is excluded on the way
 * back out by the declarator branch in `collect`.
 */
function typePositionNodes(root: any): Set<string> {
  const out = new Set<string>()
  const mark = (n: any): void => {
    if (!n) return
    out.add(`${n.startIndex}:${n.endIndex}:${n.type}`)
    for (const c of named(n)) mark(c)
  }
  const visit = (n: any): void => {
    if (!n) return
    if (TYPE_POSITION_ROOTS.has(n.type)) {
      if (n.type === "type_alias_declaration") {
        mark(n.childForFieldName?.("type"))
        const tp = n.childForFieldName?.("type_parameters")
        if (tp) mark(tp)
        return
      }
      mark(n)
      return
    }
    for (const c of named(n)) visit(c)
  }
  visit(root)
  return out
}

/** Node types whose mentions are attributed to the declaration that CONTAINS them. */
const OWNED_BY_OWNER = new Set(["property_signature", "public_field_definition"])

/** True when `n` sits inside a function-like body, i.e. it is a LOCAL. */
function insideFunctionBody(n: any): boolean {
  let cur = n?.parent
  while (cur) {
    const t = cur.type
    if (t === "function_declaration" || t === "function_expression" || t === "arrow_function" || t === "generator_function" || t === "generator_function_declaration") return true
    cur = cur.parent
  }
  return false
}

/** The identifier slots of a pattern that BIND, as opposed to its type mentions. */
function patternNames(n: any): string[] {
  const out: string[] = []
  const walk = (x: any): void => {
    if (!x) return
    if (x.type === "object_pattern" || x.type === "array_pattern") {
      for (const c of named(x)) walk(c)
      return
    }
    if (x.type === "shorthand_property_identifier_pattern") {
      out.push(x.text)
      return
    }
    if (x.type === "rest_pattern" || x.type === "spread_pattern") {
      for (const c of named(x)) walk(c)
      return
    }
    if (x.type === "pair_pattern") {
      const v = x.childForFieldName?.("value")
      if (v) walk(v)
      return
    }
    if (x.type === "identifier") out.push(x.text)
  }
  walk(n)
  return out
}

/**
 * Every name the file DECLARES, at any depth — the resolution table.
 *
 * A function-LOCAL variable is deliberately absent. A local binds a name for its
 * scope; it does not declare a name the file resolves to, and the distinction is
 * the whole of scoping: `const x: Ty` inside a function mentions `Ty` as `x`
 * mentions it, but nothing anywhere resolves the bare name `x` to that local.
 * Excluding locals is also what makes a shadowing bug visible to this oracle
 * rather than invisible to it.
 *
 * An interface property and a class field ARE in the table, because the
 * analyzer's symbol table holds members and a bare read of a member's name
 * resolves against it.
 */
function declaredNames(root: any): Set<string> {
  const out = new Set<string>()
  const visit = (n: any): void => {
    if (!n) return
    if (DECLARERS.has(n.type)) {
      if (n.type !== "variable_declarator" || !insideFunctionBody(n)) {
        const nm = field(n, "name")
        if (nm && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nm)) out.add(nm)
      }
    }
    for (const c of named(n)) visit(c)
  }
  visit(root)
  return out
}

/** Names bound by a formal-parameter list, including destructuring and rest. */
function paramNames(fp: any): string[] {
  const out: string[] = []
  for (const p of named(fp)) {
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      const nm = p.childForFieldName?.("pattern")
      if (nm) out.push(...patternNames(nm))
    } else if (p.type === "identifier") {
      out.push(p.text)
    } else if (p.type.endsWith("_pattern")) {
      out.push(...patternNames(p))
    }
  }
  return out
}

/** True when `id` is the property half of a member access (`o.prop`). */
function isMemberAccessProperty(id: any): boolean {
  const p = id?.parent
  if (!p) return false
  if (p.type !== "member_expression" && p.type !== "optional_chain") return false
  return p.childForFieldName?.("property")?.startIndex === id.startIndex
}

/** True when `id` is written as a key in an object literal rather than read. */
function isObjectLiteralKey(id: any): boolean {
  const p = id?.parent
  if (!p) return false
  if (p.type === "pair") return p.childForFieldName?.("key")?.startIndex === id.startIndex
  if (p.type === "shorthand_property_identifier") return true
  return false
}

/** True when `id` names a label (`outer: for(;;) break outer`). */
function isLabelName(id: any): boolean {
  const p = id?.parent
  if (!p) return false
  if (p.type === "labeled_statement") return p.childForFieldName?.("label")?.startIndex === id.startIndex
  if (p.type === "break_statement" || p.type === "continue_statement") return true
  return false
}

/** True when `id` is a binding rather than a mention (a declarator's name slot). */
function isBindingSlot(id: any): boolean {
  const p = id?.parent
  if (!p) return false
  if (p.type === "variable_declarator" && p.childForFieldName?.("name")?.startIndex === id.startIndex) return true
  if (p.type === "catch_clause") return true
  if (p.type === "for_in_statement") return true
  return false
}

export function deriveTypeScriptReferencesTruth(root: any): TruthEdge[] {
  const declared = declaredNames(root)
  const inTypePosition = typePositionNodes(root)
  const isTypePos = (n: any): boolean => inTypePosition.has(`${n.startIndex}:${n.endIndex}:${n.type}`)
  const edges: TruthEdge[] = []
  const seen = new Set<string>()

  /**
   * Walk one declaration's extent, collecting the names it MENTIONS. `bound` is
   * the set of names already shadowed at this point; a mention of a bound name is
   * not a reference to a file declaration. Nested function-like scopes push and
   * pop their own bindings.
   */
  const collect = (n: any, sourceName: string, bound: Set<string>): void => {
    if (!n) return
    const t = n.type

    // A nested function-like scope binds its own parameters and locals, which
    // shadow for its extent only.
    const pushes =
      t === "function_declaration" ||
      t === "function_expression" ||
      t === "arrow_function" ||
      t === "generator_function" ||
      t === "generator_function_declaration" ||
      t === "method_definition"
    if (pushes) {
      const fp = n.childForFieldName?.("parameters")
      const next = new Set(bound)
      if (fp) for (const b of paramNames(fp)) next.add(b)
      for (const c of named(n)) collect(c, sourceName, next)
      return
    }

    // Bindings introduced by this node, applied to its own children.
    let childBound = bound
    if (t === "variable_declarator" || t === "for_in_statement" || t === "catch_clause") {
      childBound = new Set(bound)
      for (const b of patternNames(t === "variable_declarator" ? n.childForFieldName?.("name") : n.namedChild(0))) {
        childBound.add(b)
      }
    }

    // An ANNOTATED declarator owns its own annotation: `const x: Ty = 1` is a
    // mention `x` makes of `Ty`, and the enclosing function does not repeat it.
    // An unannotated declarator owns nothing, so its initializer's mentions stay
    // with the incoming source. Confirmed by probe on all four shapes: annotated
    // local -> `x->Ty`; unannotated local -> `f->Ty`; annotated local whose
    // INITIALIZER mentions -> `f->Kls`; module-level -> `m->Ty`.
    if (t === "variable_declarator" || t === "public_field_definition" || t === "property_signature") {
      const ty = n.childForFieldName?.("type")
      const value = n.childForFieldName?.("value")
      // A VARIABLE declarator owns its annotation; a FIELD is owned by its class
      // or interface, so `q = Ty` and `p: Ty` in a class body are mentions by the
      // CLASS, not by the field (measured: both attribute to `C`).
      const own = t === "variable_declarator" ? field(n, "name") : null
      if (ty) collect(ty, own && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(own) ? own : sourceName, new Set(childBound))
      if (value) collect(value, sourceName, new Set(childBound))
      // the name slot itself is a binding, never a mention
      return
    }

    // BLOCK SCOPE. A binding introduced by a declaration shadows for the REST of
    // the enclosing block, not only inside its own subtree:
    //
    //   function f() { const { dir } = g(); return dir }
    //
    // The read of `dir` is a sibling of the declarator, so a walk that only
    // collected bindings as it descended would resolve that read to a same-named
    // file declaration. Pre-scanning the block's own declarations is what makes
    // the scoping real rather than subtree-local.
    if (t === "statement_block" || t === "program" || t === "switch_body") {
      const blockBound = new Set(bound)
      for (const c of named(n)) {
        if (c.type === "lexical_declaration") {
          for (const d of named(c)) {
            if (d.type === "variable_declarator") for (const b of patternNames(d.childForFieldName?.("name"))) blockBound.add(b)
          }
        } else if (c.type === "function_declaration" || c.type === "class_declaration") {
          const nm = field(c, "name")
          if (nm) blockBound.add(nm)
        }
      }
      for (const c of named(n)) collect(c, sourceName, blockBound)
      return
    }

    if (t === "identifier" || t === "type_identifier" || t === "nested_type_identifier" || t === "shorthand_property_identifier") {
      const name = n.text
      // A QUALIFIED type name is written whole: `NodeJS.ProcessEnv` is the
      // target, not `NodeJS`. The base of a `generic_type` is likewise the name
      // the file spells.
      const typeSurface = t === "type_identifier" || t === "nested_type_identifier" || isTypePos(n)
      const mentionable =
        name !== sourceName &&
        !childBound.has(name) &&
        (typeSurface ? !PRIMITIVES.has(name) : declared.has(name)) &&
        !isMemberAccessProperty(n) &&
        !isObjectLiteralKey(n) &&
        !isLabelName(n) &&
        !isBindingSlot(n)
      if (mentionable) {
        const key = `${sourceName}|${name}`
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({ label: "references", from: sourceName, target: name })
        }
      }
      return
    }

    for (const c of named(n)) collect(c, sourceName, childBound)
  }

  // Every declaration is a potential SOURCE. Two attribution rules, both from
  // what the language writes rather than from how the analyzer happens to walk:
  //
  //   - an ANNOTATED declarator owns its own annotation. `const x: Ty = 1`
  //     inside a function is a mention `x` makes of `Ty`; the enclosing function
  //     does not make it. An UNANNOTATED declarator owns nothing, so mentions in
  //     its initializer belong to the enclosing declaration: `const y = Ty` is a
  //     mention by `f`.
  //   - a class FIELD is owned by its class, not by itself, so `q = Ty` in a
  //     class body is a mention by the class.
  const source = (n: any, owner: string | null): void => {
    if (!n) return
    let name: string | null = null
    if (DECLARERS.has(n.type)) name = field(n, "name")
    // Only an ANNOTATED variable declarator is a source. An unannotated local
    // owns nothing: `const y = Ty` inside `f` is a mention BY `f`, and making
    // `y` a source instead restarts the walk with an empty binding set, which
    // loses the enclosing function's parameters and invents edges to them.
    const sourceable =
      name !== null &&
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) &&
      n.type !== "public_field_definition" &&
      n.type !== "property_signature" &&
      (n.type !== "variable_declarator" || !!n.childForFieldName?.("type"))
    let becameSource: string | null = null
    if (sourceable) {
      becameSource = name
      const bound = new Set<string>()
      const fp = n.childForFieldName?.("parameters")
      if (fp) for (const b of paramNames(fp)) bound.add(b)
      for (const c of named(n)) collect(c, name!, new Set(bound))
    } else if (owner && OWNED_BY_OWNER.has(n.type)) {
      // A field or property signature is owned by its class/interface, so its
      // mentions are made by the owner. Nothing ELSE is re-walked here: an
      // unrestricted branch re-collects every non-declarer child with an EMPTY
      // binding set, which silently discards the enclosing function's parameters
      // and invents references to them.
      for (const c of named(n)) collect(c, owner, new Set())
    }
    // Pass down the name that ACTUALLY became a source. Passing `name` here would
    // let a non-source declarator lend its name to a nested annotated declarator,
    // and that nested one would then walk with an EMPTY binding set — losing the
    // enclosing function's parameters and inventing references to them.
    for (const c of named(n)) source(c, becameSource ?? owner)
  }
  source(root, null)

  return edges
}
