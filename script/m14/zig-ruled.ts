/**
 * ZIG RULING TABLE — the three types `src/ast/real-zig-analyzer.ts` does not emit,
 * each with the instrument the workstream defines and the measurement behind it.
 *
 * ## Why this file exists and is NOT in the gate
 *
 * `script/m14/ontology-coverage-gate.ts` is shared machinery (§8). Its
 * `RULED_BY_LANG` map currently holds `bash` and `json`, so the gate refuses to
 * rule for zig: `npx tsx script/m14/ontology-coverage-gate.ts zig` exits 2 with
 * "no RULING TABLE for zig", because an empty table would call every un-emitted
 * type RULED-UNJUSTIFIED — a verdict about the TABLE, not about the lane. A ruling
 * table encodes a lane's OWN corpus probe, so it is written by the lane that
 * measured it. WIRLING NEEDED, exactly one import and one map entry:
 *
 *   import { ZIG_RULED } from "./zig-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = {
 *     bash: BASH_RULED, json: JSON_RULED, zig: ZIG_RULED,
 *   }
 *
 * `Ruled` is restated below rather than imported because the gate does not export
 * it and the gate is not mine to change. If the supervisor exports the type, the
 * restatement here is the only thing that becomes redundant.
 *
 * ## The three verdicts, and what each one's measurement was
 *
 *   extends      RULED  instrument A (grammar-inventory)
 *   implements   RULED  instrument A (grammar-inventory)
 *   overrides    RULED  instrument B (parse-tree-count)
 *
 * The other seven types (`calls`, `uses`, `contains`, `imports`, `references`,
 * `exports`, `instantiates`) are EMITTED and the gate counts them from production
 * `parseFile`, so they take no row here. Written reasons, probes and overturn
 * conditions: `script/m14/spec/zig-completeness.json` decisions ZIG.O.1, ZIG.O.2,
 * ZIG.O.3; measurements: `validation/m14/fixtures/zig/measurements/`.
 *
 * ## WHAT INSTRUMENT A CAN AND CANNOT SEE HERE — stated, because it is the one
 * place this table's method is weaker than the lane's own
 *
 * Instrument A asks the gate one question: is any node type in
 * `nodeTypesThatWouldMeanIt` PRODUCED by the grammar on this corpus? Zig DOES
 * produce `struct_declaration` and `opaque_declaration`, and the bash table lists
 * `struct_declaration` — correctly, because bash has none. So for zig that name is
 * deliberately NOT listed: a struct declaration is a type DECLARATION, and the
 * construct `extends` needs is a SUPERTYPE CLAUSE, which is a different node. The
 * lane's own evidence for that distinction is the position test A4, which the
 * gate's `Ruled` shape has no field for: the non-member children of every
 * struct/enum/union/opaque/error declaration, classified — **1,797 across 443
 * files, and 0 UNCLASSIFIED**, which is the only bucket a supertype reference could
 * occupy. Read `describe` below as incomplete without it; the full numbers are in
 * the spec and in `docs/analyzers/real-zig-analyzer.md`.
 */
export type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}
type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"

// ─────────────────────────────────────────────────────────────── extends, implements
//
// The probed vocabulary is the SUPERTYPE RELATION, not a type declaration. Zig has
// no class, no interface, no trait and no inheritance clause of any kind, so every
// name below is absent; measured against the pinned wasm's OWN tables
// (`Language.types` 239 entries, `Language.fields` 16) AND against the node types
// the grammar produces over the 3,848-file corpus, which is what the gate asks.
// Calibrated: the same table DOES hold 11 of 11 tested zig keywords
// (fn, const, var, pub, struct, enum, union, opaque, error, comptime,
// usingnamespace), so "absent" here means absent rather than "the table holds no
// keywords".
const ZIG_SUPERTYPE_NODE_TYPES = [
  "class_declaration",
  "class_specifier",
  "class",
  "interface_declaration",
  "interface_body",
  "trait_declaration",
  "trait",
  "extends_clause",
  "implements_clause",
  "inheritance_specifier",
  "superclass",
  "superclass_field",
  "base_class",
  "base_class_clause",
  "type_parameter_list",
  "protocol_conformance",
  "mixin_declaration",
]

export const ZIG_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ZIG_SUPERTYPE_NODE_TYPES,
    describe:
      "a supertype relation — a declaration that names another type as its base. MEASURED (ZIG.O.1, construct-probe.ts over the full corpus, draw sha256:2f3545f9…): the pinned wasm's own tables declare 239 node types (including anonymous keyword tokens — 11/11 tested zig keywords present) and 16 field names, and 0 of the 28 probed inheritance words (extends, implements, inherits, class, interface, trait, protocol, superclass, super, bases, interfaces, override, overrides, …) is present as a node type, a keyword or a field. The POSITION test the gate's shape cannot carry: the non-member children of every struct/enum/union/opaque/error declaration are 1,797 across 443 files and 0 are UNCLASSIFIED (1,030 enum backing type, 369 nested executable block, 275 packed-struct field count, 122 union tag type, 1 error recovery) — UNCLASSIFIED is the only bucket a supertype slot could occupy. Composition through a by-value struct field is not subtyping: zig has no nominal base type, so an edge would name a relationship the language does not have. OVERTURN: any listed node type produced on the corpus; or UNCLASSIFIED > 0 in A4; or a container declaration carrying a named child that is not a backing type, packed field count, union tag or nested executable block.",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ZIG_SUPERTYPE_NODE_TYPES,
    describe:
      "a conformance clause — a declaration that lists the interfaces or behaviours it satisfies. MEASURED (ZIG.O.2, same run): 0 of the same 28 words present in either table, and the 16 declared field names (alternative, argument, body, condition, error, function, index, left, member, name, object, ok, operator, right, sentinel, type) include no conformance slot. Zig models an interface as an `opaque` container plus a table of function POINTERS, and a pointer-to-function type is a `function_signature` node with NO declaring name (960 corpus-wide, all the anonymous fn-type form), so there is no clause and no name for an edge to point at. OVERTURN: identical to `extends`; the shape that would do it is an `opaque` declaration carrying a named child other than its members.",
  },
  {
    type: "overrides",
    instrument: "B:parse-tree-count",
    countOnTree: countZigOverridesConstruct,
    describe:
      "a second declaration of a name already declared in the same scope, where the second REPLACES the first — the only thing in zig that could stand in for an override, since there is no `override` keyword (0 of the 28 words) and no vtable. MEASURED (ZIG.O.3, construct-probe.ts over the full corpus): 17 duplicate-declaration sites on the parse tree — 3 duplicate functions, 5 duplicate bindings, 9 duplicate container members — and 17 of 17 sit in a file that quotes the compiler's OWN diagnostic for that identifier in a comment (`:2:5: error: duplicate struct member name 'foo'`), i.e. every one of them documents the compiler REJECTING the construct. The 9 further hits in the lane probe are zig DESTRUCTURING (`x, const y, var z: u64 = .{1,2,3}` is one declaration with several binding slots and rebinding an existing name there is legal) and are excluded by this probe's declaration test, not by their path. OVERTURN: any same-scope duplicate declaration in a file that does not carry the compiler's own duplicate/redeclaration diagnostic naming that identifier — i.e. any duplicate declaration the zig compiler ACCEPTS. The probe below pushes only those, so the arbiter flips this row to FALSIFIED by itself.",
  },
]

// ───────────────────────────────────────────────────── the `overrides` probe (B)
/**
 * The tree walk behind the `overrides` ruling. It is the same walk the lane's
 * `construct-probe.ts` runs as its B1/B2/B3 probes, narrowed to the question the
 * gate asks: does a duplicate declaration occur in code zig COMPILES?
 *
 * Three things it deliberately does NOT do:
 *
 * 1. NO TEXT REGEX. Every rule reads node types, fields and comments. The gate's
 *    own header records what a regex costs here — a probe for `extends` once
 *    matched `class voice` inside a telnet IAC word list, and a probe for
 *    `instantiates` matched `new Map(` inside JavaScript embedded in a bash
 *    heredoc; both would have convicted a correct ruling. The one text test here
 *    runs on a COMMENT NODE, which is not code: a file that quotes the compiler's
 *    own `error: duplicate …` diagnostic is a rejection fixture by construction,
 *    whatever its path. That is why `zig/test/cases/global_variable_redeclaration.zig`
 *    — which sits OUTSIDE `compile_errors/` — is excluded too, while a path rule
 *    would have missed it and a `compile_errors/` rule would have been a
 *    convention rather than a fact.
 * 2. NO PATH TEST. `fileLabel` is used for the hit message only.
 * 3. NO DESTRUCTURING. A `variable_declaration` whose first child is an
 *    identifier rather than a `const`/`var`/`pub` token is zig destructuring: it
 *    binds several names in one statement, and rebinding an existing name there is
 *    legal. Counting its slots would convict the ruling for the wrong reason — the
 *    JSON lane's `exports`/`imports` history is the same failure.
 *
 * The optional fourth parameter replaces the compiler-rejection set. It exists so
 * `validation/m14/fixtures/zig/zig-ruled-probe.ts` can measure the RAW duplicate
 * count with the same walk rather than a second implementation of it; the gate
 * passes three arguments and never reaches it.
 */
export function countZigOverridesConstruct(root: any, fileLabel: string, hits: string[], rejections?: Set<string>): void {
  const compilerRejections = rejections ?? collectCompilerRejectionComments(root)
  const names = declaredNamesByScope(root)
  for (const site of names) {
    if (compilerRejections.has(site.name)) continue
    // A duplicate ERROR-SET MEMBER is a compiler rejection on the compiler's own
    // authority, whether or not the file quotes the message: `zig` emits
    // `duplicate error set field '{s}'` and returns `astgen.failTokNotes`
    // (lib/std/zig/AstGen.zig:5945 in the corpus's own checkout, 738d2be9), and its
    // rejection fixture is zig/test/cases/compile_errors/duplicate_error_value_in_error_set.zig.
    // There is no second spelling of an error set, so no accepting program contains
    // one. Measured consequence: this is the rule that takes the count from 1 to 0
    // over the full corpus, and the site it removes is in a zls ANALYSIS test whose
    // expected annotation is the resulting error SET, not an override.
    if (site.kind === "error-member") continue
    hits.push(`${fileLabel}: ${site.name} ${site.kind} declared twice in ${site.scope} (line ${site.line})`)
  }
}

/** Identifiers the compiler itself rejected in this file, from COMMENT nodes only. */
function collectCompilerRejectionComments(root: any): Set<string> {
  const rejected = new Set<string>()
  const visit = (n: any) => {
    if (n.type === "comment") {
      const t = String(n.text ?? "")
      // The zig compiler's own diagnostic for a duplicate declaration. Both
      // spellings it emits are listed; a diagnostic about anything else is not a
      // rejection of a redefinition.
      if (/error:\s*(duplicate|redeclaration)/.test(t)) {
        for (const m of t.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) rejected.add(m[1])
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return rejected
}

const CONTAINER_TYPES = new Set(["struct_declaration", "enum_declaration", "union_declaration", "opaque_declaration", "error_set_declaration"])

/**
 * Scope openers, measured against the node types the grammar PRODUCES over the
 * corpus (`construct-probe.ts`: 210 distinct). `block` alone is not enough and the
 * first version of this walk proved it: a statement-position `{ … }` is a `block`
 * but an EXPRESSION-position one is a `block_expression`, so a name bound in an
 * expression block landed in the enclosing function scope and collided with a real
 * declaration further down that function — 942 phantom sites over a 200-file draw,
 * from three separate scope errors. `switch_case` is a scope because each prong
 * can carry its own bindings.
 */
const SCOPE_OPENERS = new Set(["block", "block_expression", "switch_case", "source_file", ...CONTAINER_TYPES])

/**
 * Every same-scope duplicate DECLARATION on the tree, with the name that collides.
 * Scope is the file, a block, a switch prong, or a container — the places zig lets
 * two declarations share a name, and the ones its own diagnostic names ("struct
 * declared here", "previous declaration here").
 *
 * A child scope starts EMPTY rather than inheriting: a local that shadows a
 * file-scope name is legal zig and must not read as a redefinition. (The first
 * version copied the parent map, which made `error_bundle` in a nested anonymous
 * struct collide with the outer struct's field of the same name.)
 */
function declaredNamesByScope(root: any): { name: string; kind: string; scope: string; line: number }[] {
  const found: { name: string; kind: string; scope: string; line: number }[] = []
  const lineOf = (c: any) => Number(c?.startPosition?.row ?? -1) + 1

  const declare = (scope: Map<string, string>, label: string, name: string, kind: string, line: number) => {
    if (!name) return
    if (scope.has(name)) found.push({ name, kind, scope: label, line })
    else scope.set(name, kind)
  }

  const walk = (n: any, scope: Map<string, string>, label: string) => {
    // This node's own declarations. A node declares when it IS a declaration, so
    // error-set members are read here — on the error_set_declaration itself —
    // rather than from its parent's loop, which would file them under the
    // enclosing scope and make two different error sets collide.
    if (n.type === "error_set_declaration") {
      for (let j = 0; j < n.namedChildCount; j++) {
        const m = n.namedChild(j)
        if (m.type === "identifier") declare(scope, label, String(m.text ?? ""), "error-member", lineOf(m))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c.type === "function_declaration") declare(scope, label, declaredName(c), "function", lineOf(c))
      else if (c.type === "container_field") {
        // The `name` FIELD, not the first identifier (Z28), AND the presence of a
        // `type` FIELD, which is what separates a NAMED field from a POSITIONAL one.
        // Both halves are needed and the corpus proved it: `struct { u16, u16 }` and
        // an unnamed `extern struct` member hand a TYPE over in the name slot with no
        // `type` field (Z28), but a tuple field whose type is a USER-declared name —
        // `var two: ?struct { ZeroBit, ZeroBit }` in zig/test/behavior/optional.zig —
        // parses as `name=identifier` with no `type` field as well, so an
        // identifier test alone read that tuple as two members called `ZeroBit` and
        // the arbiter duly called the `overrides` ruling FALSIFIED on it. The
        // discriminator is the missing `type`: a named field is `name: Type`.
        const nf = c.childForFieldName?.("name")
        if (nf?.type === "identifier" && c.childForFieldName?.("type")) declare(scope, label, String(nf.text ?? ""), "member", lineOf(c))
      } else if (c.type === "variable_declaration" && declaresANewName(c)) declare(scope, label, declaredName(c), "binding", lineOf(c))
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (SCOPE_OPENERS.has(c.type)) walk(c, new Map(), `${c.type}@${lineOf(c)}`)
      else walk(c, scope, label)
    }
  }
  walk(root, new Map(), "source_file")
  return found
}

/**
 * True when a `variable_declaration` introduces a name rather than destructuring.
 * zig destructuring (`x, const y, var z: u64 = .{1,2,3}`) has NO `const`/`var`
 * keyword of its own — its first child is the identifier being rebound — so the
 * keyword test and the destructuring test are the same test.
 */
function declaresANewName(vd: any): boolean {
  const first = vd.child(0)
  if (!first) return false
  const t = String(first.type ?? "")
  return t === "const" || t === "var" || t === "pub" || t === "comptime"
}

/** The declared name: the identifier immediately after the declaration keyword. */
function declaredName(n: any): string {
  const byField = n.childForFieldName?.("name")
  if (byField && byField.type === "identifier") return String(byField.text ?? "")
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c.type === "identifier") return String(c.text ?? "")
  }
  return ""
}