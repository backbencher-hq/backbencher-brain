/**
 * GraphQL MUTATION harness (L4).
 *
 * A differential that only ever passes proves nothing. Each mutant below
 * RE-INTRODUCES one defect that the deep review actually found, as a source
 * edit, and the run FAILS unless the same differential that passes on the real
 * analyzer catches it. A surviving mutant is a hole in the fixture suite and is
 * reported as such, not hidden.
 *
 * Every mutant is a real behavioural regression — each names the defect it
 * represents and the measurement that found it — and each carries an ID matching
 * the finding ID in the lane review, so a survivor points at a specific missing
 * fixture. That review is `reviews/graphql/master-review.md`; it used to live at
 * `bb_tests/graphql/REVIEW.md`, which no longer exists, and a second copy sat at
 * `script/m14/tmp/graphql/REVIEW.md` that had drifted from it — so the two files
 * disagreed about the mutant count while both read as authoritative. They are now
 * one file, and `script/m14/tmp/graphql/REVIEW.md` is a byte-identical copy of it.
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const SRC = path.join(ROOT, "src/ast/real-graphql-analyzer.ts")
const WORK = path.join(HERE, "mutants")

interface Mutant {
  id: string
  /** the finding ID in REVIEW.md */
  defect: string
  /** [find, replace] pairs applied to the analyzer source. */
  edits: Array<[string, string]>
  /**
   * Set when the mutant is NOT distinguishable from the real analyzer on any
   * input, with the reason. A text scan for `!` and the `NonNullType` node
   * necessarily agree on every GraphQL the grammar can produce — `!` cannot
   * appear in a type name — so "did you replace the AST read with a text scan?"
   * has no answer at the output level, and claiming otherwise by deleting the
   * mutant would be hiding the check rather than reporting it. The mutant stays,
   * it is recorded as equivalent, and the readable-AST rule is enforced by the
   * source guard in `probe/no-text-scan.mts` instead.
   */
  equivalentByConstruction?: string
  /**
   * Names the OTHER guard that catches this mutant, for a defect the fixture suite
   * cannot separate. Expected to survive here for a measured reason — two
   * independent guards, and this instrument only exercises one of them. Still
   * counted and reported, never dropped.
   */
  defeatedByAnotherGuard?: string
}

const MUTANTS: Mutant[] = [
  // ---------------------------------------------------------------- A: line numbers
  {
    id: "range-includes-leading-description",
    defect: "C1: a definition's range started on its Description — 3,131 of 3,332 symbols on the GitHub public schema (94%) pointed at a docstring line (M59/#861 family rule)",
    edits: [[
      `    let anchor: Node = node
    const firstChild = node.child(0)
    if (firstChild && this.typeOf(firstChild) === "Description") {
      const afterDescription = node.child(1)
      if (afterDescription) anchor = afterDescription
    }`,
      `    let anchor: Node = node    }`,
      `    let anchor: Node = node
    const firstChild = node.child(0)
    if (firstChild && firstChild.type === "Description") {
      // mutant: the pre-fix implementation, whose range started on the
      // description instead of the definition keyword
      anchor = firstChild
    }`,
    ]],
  },
  {
    id: "no-line-on-relationships",
    defect: "C2: no relationship carried `line_number`, so the store's (source,target,type,line) identity collapsed two genuine facts of `f(x: Int): Int` into one row (M59 #825)",
    edits: [[
      `        line_number: line,`,
      `        // mutant: M59 #825 line dropped`,
    ]],
  },

  // ---------------------------------------------------------------- C: lost data
  {
    id: "no-type-extensions",
    defect: "C3: `extend type|interface|input|enum|union` members were dropped entirely — 0 of 7 members emitted on the corpus sample",
    edits: [[
      `      if (EXTENSION_TO_DEFINITION[t]) {`,
      `      if (false) {`,
    ]],
  },
  {
    id: "implements-direct-children-only",
    defect: "C4: `ImplementsInterfaces` is left-recursive, so reading only DIRECT children kept just the LAST implemented interface — 496 relationships lost across 47 corpus files under the patched grammar",
    edits: [[
      `            for (const { name: iface, node: ifaceNode } of this.collectNamedTypes(implNode)) {
              emitHeritage(name, iface, this.lineOf(ifaceNode), inExtension)`,
      `            for (const { name: iface, node: ifaceNode } of this.directNamedTypes(implNode)) {
              emitHeritage(name, iface, this.lineOf(ifaceNode), inExtension)`,
    ], [
      `  private namedTypeNode(typeNode: Node): Node | null {`,
      `  /** mutant: the pre-fix reader, which looked at direct children only. */
  private directNamedTypes(node: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type !== "NamedType") continue
      const n = this.nameOf(c)
      if (n) out.push({ name: n, node: c })
    }
    return out
  }

  private namedTypeNode(typeNode: Node): Node | null {`,
    ]],
  },
  {
    id: "union-members-direct-children-only",
    defect: "C5: same defect on the other left-recursive rule, `UnionMemberTypes`",
    edits: [[
      `              for (const { name: member, node: memberNode } of this.collectNamedTypes(membersNode)) {
                addRelationship(name, member, ASTEngine.RelationshipType.Uses, this.lineOf(memberNode), "union_member", {`,
      `              for (const { name: member, node: memberNode } of this.directNamedTypes(membersNode)) {
                addRelationship(name, member, ASTEngine.RelationshipType.Uses, this.lineOf(memberNode), "union_member", {`,
    ]],
  },
  {
    id: "dedupe-drops-role",
    defect: "B1: the relationship dedupe key omitted the role, so a field whose argument type equals its return type lost one of the two facts",
    edits: [[
      `      const key = \`\${source}\\u0000\${type}\\u0000\${target}\\u0000\${role}\\u0000\${line}\``,
      `      const key = \`\${source}\\u0000\${type}\\u0000\${target}\``,
    ]],
  },
  {
    id: "is-optional-is-only-non-null",
    defect: "C6: `isOptional` asked only `!NonNullType`, reporting BOTH nullable argument shapes as optional — the opposite of GraphQL's rule that a nullable argument is required unless it has a default",
    edits: [[
      `        isOptional: typeNode ? !this.isNonNullType(typeNode) && defaultValue !== undefined : true,`,
      `        isOptional: typeNode ? !this.isNonNullType(typeNode) : true,`,
    ]],
  },
  {
    id: "non-null-read-through-the-wrapper",
    defect: "C7: non-null-ness read one level too deep — a realistic mistake once the wrapper is not looked up by name",
    edits: [[
      `  private isNonNullType(typeNode: Node): boolean {
    const first = typeNode.namedChild(0)
    return first?.type === "NonNullType"
  }`,
      `  private isNonNullType(typeNode: Node): boolean {
    // mutant: looks inside the wrapper instead of at it
    const first = typeNode.namedChild(0)
    return first?.namedChild(0)?.type === "NonNullType"
  }`,
    ]],
  },
  {
    id: "is-optional-by-text-scan",
    enforcedBy: "probe/no-text-scan.mts — the contract is that no regex is used at all, and that probe is what checks it",
    equivalentByConstruction:
      "a `Type` node's text contains `!` if and only if its first named child is a `NonNullType`, for every GraphQL this grammar accepts — `!` is not a legal character in a GraphQL name and the grammar has no other token that can carry it inside a `Type`. The two implementations are therefore extensionally equal on the whole input language, so no fixture can separate them. The defect is a readability/robustness one and is enforced by probe/no-text-scan.mts, not here.",
    defect: "C7: the pre-fix read non-null-ness off `typeNode.text.includes(\"!\")` — a text scan where the grammar has a `NonNullType` node",
    edits: [[
      `  private isNonNullType(typeNode: Node): boolean {
    const first = typeNode.namedChild(0)
    return first?.type === "NonNullType"
  }`,
      `  private isNonNullType(typeNode: Node): boolean {
    // mutant: the pre-fix text scan
    return typeNode.text.includes("!")
  }`,
    ]],
  },
  {
    id: "no-directive-applications",
    defect: "C8: a directive applied to a declaration produced neither metadata nor a reference — Apollo Federation's `@key`/`@external`/`@requires` carry a subgraph's whole structure",
    edits: [[
      `    for (const app of applications) {`,
      `    for (const app of [] as DirectiveApplication[]) {`,
    ]],
  },
  {
    id: "no-variable-reference-sites",
    defect: "C9: a declared variable that was referenced recorded nothing, so every variable read as dead",
    edits: [[
      `        if (valueParent?.type === "Value" && sel.root) {`,
      `        if (false) {`,
    ]],
  },
  {
    id: "selections-never-qualified",
    defect: "G1: a selection inside a fragment or inline fragment targeted a BARE name, so `... on User { id }` pointed at an unqualified `id` that resolves to nothing",
    edits: [[
      `          const qualified = sel.enclosingType ? \`\${sel.enclosingType}.\${fieldName}\` : fieldName`,
      `          const qualified = fieldName // mutant: the pre-fix bare target`,
    ]],
  },
  {
    id: "no-escape-resolution-in-docstrings",
    defect: "B2: `\"a \\\"quote\\\"\"` was published as `a \\\"quote\\\"` — the description VALUE was the raw inner text with its backslashes still in it",
    edits: [[
      `    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      return this.unescapeStringValue(raw.slice(1, raw.length - 1))
    }`,
      `    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      // mutant: the pre-fix implementation, which returned the raw inner text
      return raw.slice(1, raw.length - 1)
    }`,
    ]],
  },
  {
    id: "no-block-string-dedent",
    defect: "B3: a block description kept its common indent and its leading/trailing blank lines, so the published value was not the description's value",
    edits: [[
      `    if (common !== undefined && common > 0) {`,
      `    if (false) {`,
    ], [
      `    while (lines.length > 0 && lines[0].trim() === "") lines.shift()
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()`,
      `    // mutant: leading/trailing blank lines retained`,
    ]],
  },
  {
    id: "no-schema-docstring",
    defect: "C10: the `schema` namespace dropped its description",
    edits: [[
      `            docstring: this.descriptionOf(node),
            metadata: {
              graphqlType: t === "SchemaDefinition" ? "schema" : "schema_extension",`,
      `            metadata: {
              graphqlType: t === "SchemaDefinition" ? "schema" : "schema_extension",`,
    ]],
  },
  {
    id: "repeatable-never-seen",
    defect: "A1: `repeatable` is an ANONYMOUS token, so a named-child scan never found it and every repeatable directive was published as non-repeatable",
    edits: [[
      `          const repeatable = this.hasChild(node, (n) => this.typeOf(n) === "repeatable")`,
      `          const repeatable = this.findChild(node, (n) => n.type === "repeatable") !== null // mutant: named-child scan only`,
    ]],
  },
  {
    id: "directive-locations-direct-children-only",
    defect: "C11: `DirectiveLocations` is left-recursive too, so `on A | B | C` published only the last location",
    edits: [[
      `          const locationNames = locations
            ? this.collectDirectiveLocations(locations).map((l) => l.name)
            : undefined`,
      `          const locationNames = locations
            ? [this.findDescendant(locations, (n) => n.type === "DirectiveLocation")?.text ?? "?"]
            : undefined // mutant: only the first location found`,
    ]],
  },

  // ------------------------------------------- D: the master-review families
  // The final master review found THREE referenceable families the analyzer
  // emitted nothing for, and a family with no mutant is a family nothing pins.
  {
    id: "variable-type-edge-removed",
    defect: "D1: a VariableDefinition's declared type had NO relationship, while a field return type, an argument type and an input field type all had one — so `$c: Color` said nothing about `Color` and `returnType`/`rawType` carried the fact as a string where every sibling fact is an edge",
    edits: [[
      `            if (varType) {
              addDeclaredType(\`$\${varName}\`, varType, this.lineOf(this.namedTypeNode(typeNode!) ?? typeNode!), "variable_type", {
                operation: opName,
              })
            }`,
      `            if (varType) {
              // mutant: the pre-review behaviour — the declared type is a string
              // on the symbol and nothing else
            }`,
    ]],
  },
  {
    id: "enum-value-reference-collector-disabled",
    defect: "D2: an enum member named in a VALUE position (an input field default, an argument default, a variable default, an executable field argument, a directive argument) was recorded only as an opaque string in `defaultValue`, so the enum member was a declared symbol that NOTHING ever referenced",
    edits: [[
      `    const out: Array<{ name: string; line: number }> = []
    if (!valueNode) return out`,
      `    const out: Array<{ name: string; line: number }> = []
    if (!valueNode) return out
    return out // mutant: collect nothing`,
    ]],
  },
  {
    id: "directive-argument-type-edges-removed",
    defect: "D3: the DirectiveDefinition branch emitted the `@name` symbol with `parameters` and then NO relationships at all, so `directive @auth(requires: Role = ADMIN)` said nothing about `Role` — and a directive's argument type was the only declared type in the language with no edge to it",
    edits: [[
      `              addDeclaredType(\`@\${name}\`, arg.type, this.lineOf(arg.typeNode), "directive_argument_type", { argument: arg.name })`,
      `              void arg // mutant: the pre-review branch emitted no relationship for an argument type`,
    ]],
  },
  {
    id: "enum-value-qualification-dropped",
    defect: "D4: the enum-value edge is qualified `Enum.RED` only where the document itself states the type, and bare `RED` where it does not. Dropping the qualification collapses `Color.RED` to `RED` on every input field, argument and variable default — the two spellings are different facts and the store resolves them by different strategies",
    edits: [[
      `      const target = enumType ? \`\${enumType}.\${ref.name}\` : ref.name`,
      `      const target = ref.name // mutant: never qualify, even where the document states the type`,
    ]],
  },
  {
    id: "enum-value-declaration-confused-with-reference",
    enforcedBy: "the OTHER two enum mutants (D2 the collector returning nothing, D4 the qualification) plus the 37 corpus occurrences of the family — the parent test itself has no observable effect at any current call site, which is exactly what the justification says",
    equivalentByConstruction:
      "NOT separable at the current call sites, and the reason is structural rather than convenient. All SIX call sites pass a `DefaultValue` or a `Value` node: four pass `DefaultValue` (whose only child is `Value`) and two pass `Value` directly. An `EnumValue` reached from either subtree therefore ALWAYS has a `Value` parent, so `n.parent?.type === \"Value\"` is true for every node the collector can reach, and dropping it changes no output on any input. The test is a CONTRACT on the helper — \"return references, not declarations\" — and it becomes load-bearing the moment a call site passes anything wider (a whole `Directive`, a `Definition`, a selection set). Declared equivalent rather than quietly deleted, because the guard is correct and a future call site is exactly when it would matter. What IS pinned at the call sites is D2 (the collector returning nothing) and D4 (the qualification), both caught.",
    defect: "D5: the `EnumValue` node appears BOTH as a declaration (`EnumValueDefinition > EnumValue`, already a symbol with a `contains` edge) and as a reference (`Value > EnumValue`). Keying on the node type alone would publish a declaration as a reference to itself",
    edits: [[
      `      if (this.typeOf(n) === "EnumValue" && n.parent?.type === "Value") {`,
      `      if (n.type === "EnumValue") { // mutant: the parent test dropped — a declaration is not a reference`,
    ]],
  },

  // ------------------------------- E: the iterative conversions (robustness)
  // Four helpers walked the AST by recursion and were converted to an explicit
  // stack. Two things can go wrong in that rewrite and neither is visible to a
  // fixture: the traversal ORDER (children must be pushed in reverse so they pop in
  // order, preserving the pre-order the recursion produced) and the "keep
  // descending / stop here" decision at a match.
  {
    id: "find-descendant-children-order",
    enforcedBy: "the robustness gate plus the grammar itself: this ordering is load-bearing for CORRECTNESS OF REVERSAL only if a predicate could match twice, and the grammar rules that out (see equivalentByConstruction). The robustness gate is what would catch a reversal that DID start mattering after a grammar change, because it exercises every construct at 20,000 clauses.",
    equivalentByConstruction:
      "DERIVABLE from the grammar, not merely unobserved by the fixtures. `findDescendant` is called on two shapes and both admit exactly one match. (1) A `Type` subtree: `Type: NamedType | ListType | NonNullType`, `ListType: \'[' Type \']\'`, `NonNullType: (NamedType | ListType) \'!\' | Type \'!\'` — by induction a Type subtree contains EXACTLY ONE NamedType, so the order in which children are examined cannot change the result. (2) A `DirectiveLocation`: `DirectiveLocation: ExecutableDirectiveLocation | TypeSystemDirectiveLocation`, a CHOICE with exactly one child. So pushing children forward instead of backward returns the same node on every input this grammar can produce. The reverse-order push is kept because it makes the helper correct for a predicate that CAN match more than once — `collectNamedTypes` is that predicate, and it is a different function — and because a grammar change adding a second NamedType to a Type would otherwise silently start returning the wrong one.",
    defect: "E1: the iterative `findDescendant` pushed children FORWARD, so it popped the LAST child first and returned a different first match — a different NamedType, and therefore a different type reference. A right answer for the wrong reason, and invisible to any fixture that has one clause",
    edits: [[
      `    const stack: Node[] = []
    const rootKids = node.namedChildren
    for (let i = rootKids.length - 1; i >= 0; i--) {
      const c = rootKids[i]
      if (c) stack.push(c)
    }`,
      `    const stack: Node[] = []
    const rootKids = node.namedChildren
    for (let i = 0; i < rootKids.length; i++) {
      const c = rootKids[i]
      if (c) stack.push(c)
    } // mutant: forward order, so the last child is examined first`,
    ]],
  },
  {
    id: "collect-named-types-first-clause-only",
    defect: "E2: `ImplementsInterfaces` and `UnionMemberTypes` are LEFT-recursive, so `A & B & C` nests; collecting only the first NamedType silently dropped every clause after the first, which is the defect the pre-pass exists to prevent",
    edits: [[
      `      if (this.typeOf(n) === "NamedType") {
        const name = this.nameOf(n)
        if (name && !seen.has(name)) {
          seen.add(name)
          out.push({ name, node: n })
        }
        continue
      }`,
      `      if (this.typeOf(n) === "NamedType") {
        const name = this.nameOf(n)
        if (name && !seen.has(name)) {
          seen.add(name)
          out.push({ name, node: n })
        }
        break // mutant: stop at the first clause
      }`,
    ]],
  },
  {
    id: "enum-value-reference-descends-into-a-match",
    equivalentByConstruction:
      "The grammar says `EnumValue: Name` — an EnumValue node's only content is a `Name`, and a `Name` is never an `EnumValue`. So descending into a matched EnumValue cannot find another EnumValue, and the collector returns the same list on every input this grammar can produce. Kept as `continue` (do not descend) anyway, because it states the intent — an enum value in a value position is a LEAF — and because the loop form needs an explicit decision there where the recursion got it from `return`.",
    defect: "E3: an `EnumValue` in a value position is a leaf — there is nothing below it. Descending into it is harmless today, but the loop form uses `continue` where the recursion used `return`, and `continue` that descended would make the walk unbounded on a cyclic-looking shape",
    edits: [[
      `        if (name) out.push({ name, line: this.lineOf(n) })
        continue
      }
      const kids = n.namedChildren
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i]
        if (c) stack.push(c)
      }
    }
    return out
  }`,
      `        if (name) out.push({ name, line: this.lineOf(n) })
        const inner2 = n.namedChildren
        for (let j = 0; j < inner2.length; j++) { const c2 = inner2[j]; if (c2) stack.push(c2) }
        continue
      }
      const kids = n.namedChildren
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i]
        if (c) stack.push(c)
      }
    }
    return out
  } // mutant: descend into a matched EnumValue`,
    ]],
  },

  // ---------------------------------------------------------------- B: fabricated data
  {
    id: "extension-of-declared-type-publishes-a-second-symbol",
    defect: "B4: an `extend` of a type the same file also declares minted a SECOND symbol of the same identity — a duplicate row in the index (this is the bug the `topLevelDefinitions` descent fix closed)",
    edits: [[
      `  private topLevelDefinitions(rootNode: Node): Node[] {
    if (this.typeOf(rootNode) === "Definition") return [rootNode]
    if (this.typeOf(rootNode) === "Document") return this.childrenOfType(rootNode, "Definition")
    const document = this.firstChildOfType(rootNode, "Document")
    if (document) return this.childrenOfType(document, "Definition")
    return this.childrenOfType(rootNode, "Definition")
  }`,
      `  private topLevelDefinitions(rootNode: Node): Node[] {
    // mutant: the pre-fix reader, which looked for Definition straight off
    // source_file and therefore found NONE, disabling extension de-duplication
    return this.childrenOfType(rootNode, "Definition")
  }`,
    ]],
  },
  {
    id: "declared-type-relabelled-back-to-uses",
    defect: "R9 regression: the five positions where a DECLARATION writes a type name were re-published as `uses`. Every retyped fact is ALSO a `mustNotEmit` row under its old label, so this is caught by the pin set and not only by the diff",
    edits: [[
      `      addRelationship(source, target, ASTEngine.RelationshipType.References, line, role, {
        ...metadata,
        relationshipType: "declared_type",
      })`,
      `      addRelationship(source, target, ASTEngine.RelationshipType.Uses, line, role, {
        ...metadata,
        relationshipType: "declared_type",
      })`,
    ]],
  },
  {
    id: "declared-type-marker-dropped",
    defect: "R9 regression, second half: the edge keeps the `references` label but loses `metadata.relationshipType='declared_type'`, so every consumer filtering on the family marker (script/m60/declared-type-refs-census.ts) silently misses the lane",
    edits: [[
      `      addRelationship(source, target, ASTEngine.RelationshipType.References, line, role, {
        ...metadata,
        relationshipType: "declared_type",
      })`,
      `      addRelationship(source, target, ASTEngine.RelationshipType.References, line, role, {
        ...metadata,
      })`,
    ]],
  },
  {
    id: "exports-edge-removed",
    defect: "the `exports` EDGE reverted to ExportInfo only, which `parallel-indexer.ts` does not read — so the schema's public surface reached no graph and `exports` went back to being an un-emitted ontology type",
    edits: [[
      `      addRelationship("(file)", s.name, ASTEngine.RelationshipType.Exports, s.range.startLine, "exports", {`,
      `      void 0 // mutant: ExportInfo only, the shape no consumer reads`,
    ]],
  },  // ---- the `imports` family ---------------------------------------------------------
  //
  // `imports` is the one ontology type this lane ADDED, on 170 corpus edges across 131
  // files, and until these seven existed it had NO mutant at all: a suite printing
  // "0 survived" says nothing about a family nothing has ever broken. These are driven
  // by fixtures/10-file-imports.graphql, whose truth rows were derived from the fixture
  // source before the analyzer was run on it.
  {
    id: "imports-family-removed",
    defect: "the `#import` convention stops being read, so `imports` returns to 0 edges — the state the lane was handed, and the state in which 170 real cross-file edges across 131 corpus files are invisible",
    edits: [[
      `    if (hashImports.length > 0) {`,
      `    if (false as boolean) { // mutant: the convention is not read`,
    ]],
  },
  {
    id: "import-source-becomes-the-file-sentinel",
    defect: "the imports SOURCE reverts to the `(\"(file)\")` literal this file's `exports` edges use. CSS moved off that literal for exactly this reason (real-css-analyzer.ts:2029-2038): a magic source names no symbol in any document, so every edge is unjoinable",
    edits: [[
      `      const importer = lastPathSegment(filePath) || filePath`,
      `      const importer = "(file)" // mutant: a magic source names no symbol`,
    ]],
  },
  {
    id: "import-bindings-first-only",
    defect: "the binding list stops at the first name. This is the defect the deep review actually found in the measuring probe: `# import First, Second from \"...\"` is 12 of the corpus's 170 directives, and a reader that stopped at the first name produced [\"First,\"] and then read `Second` where it expected `from` and returned null — so the one form it failed on was silently the form that could not be expressed at all",
    edits: [[
      `    if (text.charCodeAt(i) === 0x2c) {`,
      `    if (false as boolean) { // mutant: stops at the first binding name`,
    ]],
  },
  {
    id: "import-form-always-bare",
    defect: "`importForm` is flattened to `bare`, so a reader cannot tell a whole-document inclusion from a named binding — the distinction is what separates 117 of the corpus's 170 directives from 53",
    edits: [[
      `          importForm: hi.form,`,
      `          importForm: "bare", // mutant: the two forms collapse`,
    ]],
  },
  {
    id: "import-bindings-key-dropped",
    defect: "`importBindings` is never published. This is the key that distinguishes the comma-separated form, and asserting it only became possible when score.mts stopped comparing metadata with `!==` — two arrays holding equal contents are never the same reference, so before that fix the key was UNASSERTABLE and omitting it left the fact unchecked",
    edits: [[
      `          ...(hi.bindings.length > 0 ? { importBindings: hi.bindings } : {}),`,
      `          ...(false as boolean ? { importBindings: hi.bindings } : {}), // mutant: key dropped`,
    ]],
  },
  {
    id: "import-unterminated-quote-read-to-end-of-line",
    defect: "an unterminated quote is read to end-of-line instead of being refused, so `#import \"./unterminated.graphql` invents a target that was never written. Reading to the closing quote is what makes the malformed line a non-edge rather than a fabricated one",
    edits: [[
      `    if (i >= text.length) return null // unterminated quote: not a directive`,
      `    // mutant: unterminated quote no longer refused`,
    ]],
  },
  {
    id: "import-as-form-rejected",
    defect: "`#import \"./x.gql\" as Name` is refused. It is a bare directive with a local name attached, it occurs in the corpus, and refusing it drops a real directive while looking like a stricter reader",
    edits: [[
      `    return after === "as" ? { target: first, form: "bare", bindings: [word()] } : null`,
      `    return null // mutant: the \`as\` form is refused`,
    ]],
  },
  {
    id: "overrides-edge-removed",
    defect: "the member-supplied-from-an-interface post-pass removed, so the one override-shaped construct GraphQL has (spec 3.6 requires the object to supply every interface member) emitted nothing — 1,054 occurrences over 4 corpus files",
    edits: [[
      `        addRelationship(\`\${h.owner}.\${member}\`, \`\${h.iface}.\${member}\`, ASTEngine.RelationshipType.Override, this.lineOf(nameNode), "interface_member_supplied", {`,
      `        void 0 // mutant: no override edge for a supplied member`,
    ]],
  },
  {
    id: "extends-label-collapsed-to-implements",
    defect: "heritage label always `implements`, so an `implements` clause naming a supertype the document declares to be an OBJECT type is reported as interface conformance — the contract battery forbids exactly that pairing",
    edits: [[
      `      const relType = supertypeKind === ASTEngine.SymbolKind.Class || supertypeKind === ASTEngine.SymbolKind.Type ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements`,
      `      const relType = ASTEngine.RelationshipType.Implements // mutant: the pre-R9 label`,
    ]],
  },
  {
    id: "extends-guessed-when-the-document-is-silent",
    defect: "heritage label `extends` whenever the document does not declare the supertype AS AN INTERFACE — the cross-file guess. 11 of the corpus's object-typed supertypes are declared by files other than the one carrying the clause, so this manufactures edges from silence",
    edits: [[
      `      const relType = supertypeKind === ASTEngine.SymbolKind.Class || supertypeKind === ASTEngine.SymbolKind.Type ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements`,
      `      const relType = supertypeKind === ASTEngine.SymbolKind.Interface ? ASTEngine.RelationshipType.Implements : ASTEngine.RelationshipType.Extends // mutant: absence read as inheritance`,
    ]],
  },
  {
    id: "evidence-class-dropped",
    defect: "`metadata.evidenceClass` removed from every relationship, so the honesty contract 4.3 ratio (structural vs heuristic) has no machine-readable key on this lane and 38 sibling lanes lose their only common filter",
    edits: [[
      `        metadata: { ...metadata, relationshipRole: role, evidenceClass: "structural" },`,
      `        metadata: { ...metadata, relationshipRole: role },`,
    ]],
  },
  {
    id: "scalar-extension-emits-a-symbol",
    defect: "B5: `extend scalar S` minted a `type S` even though a scalar extension has no members — a duplicate identity beside the file's own `scalar S`",
    edits: [[
      `        if (t === "ScalarTypeExtension") {
          this.emitDirectiveApplications(node, directivesOf(node), this.nameOf(node) ?? "", sel, addRelationship, true)
          continue
        }`,
      `        // mutant: the pre-fix handling, which fell through to the shared
        // extension path and published a symbol for a construct with no members`,
    ]],
  },
  {
    id: "root-operation-duplicated-across-definition-and-extension",
    defect: "B6: a `schema` plus an `extend schema` that both declare `query` minted two `query` property symbols with the same identity",
    edits: [[
      `          if (rootOperationNames.has(opType)) continue
          rootOperationNames.add(opType)`,
      `          // mutant: no de-duplication across SchemaDefinition + SchemaExtension`,
    ]],
  },
  {
    id: "exports-every-scope-empty-symbol",
    defect: "B7: `exports` published every scope-empty symbol, so a query document's operations and fragments were exported names of the file",
    edits: [[
      `      if (s.metadata?.topLevel !== true) continue`,
      `      if (false) continue // mutant: the pre-fix rule, which exported every top-level symbol`,
    ]],
  },
  {
    id: "anonymous-identity-uses-a-line-number",
    defect: "C12, twice over and in both directions. The FIRST form was `Anonymous_<op>_<line>`; the second, which this analyzer shipped for a while, was `anonymous_operation_<startIndex>`. The first is a name that no longer matches the source after one line is inserted above it; the second matches /^(anonymous|anon|unnamed)[_-]/i and is therefore discarded at store time by isIndexArtifactName (src/ast/analysis-exclusions.ts:171) — 66 emitted, 0 stored, 836 relationships left with no source. The identity now published is the file that holds the operation plus its ordinal. This mutant reintroduces the line-derived half, so the differential must separate it from the ordinal.",
    edits: [[
      `          nameNode?.text ?? unnamedOperationIdentity(filePath, this.unnamedOperationOrdinal++)`,
      `          nameNode?.text ?? \`Anonymous_\${opType}_\${node.startPosition.row + 1}\` // mutant: a line-derived identity`,
    ]],
  },
  {
    id: "field-selection-can-target-itself",
    defect: "B8: no self-edge guard, so a selection whose field is named after its operation published `uses|Op|Op`",
    edits: [[
      `      if (source === target && role === "field_selection") return // a selection can never be a reference to itself`,
      `      // mutant: no self-edge guard`,
    ]],
  },
  {
    id: "both-empty-endpoint-guards-removed",
    defect: "B9+B10 together: the caller's `if (returnType)` guard AND the emitter's `if (!source || !target)` refusal. Either alone is sufficient, so each single-removal mutant is defeated by the other — defence in depth, measured, and recorded as such — and only the pair produces the junk row. This is the mutant that pins the requirement.",
    edits: [[
      `          if (fieldType) {
            addDeclaredType(ownerSymbol, fieldType,`,
      `          if (typeNode) {
            addDeclaredType(ownerSymbol, fieldType!,`,
    ], [
      `      if (!source || !target) return`,
      `      // mutant: both guards removed`,
    ]],
  },
  {
    id: "empty-relationship-endpoint",
    defect: "B9: the guard was `if (typeNode)` while the fact is the RESOLVED NAME, so a recovered `Type` node with a MISSING `Name` published `uses Damaged.bad -> \"\"` — a relationship whose target names nothing. Found by script/m12/graphql-contract-probe.ts, which had been failing this check since 2026-09-14. NOTE: this mutant removes ONE of two independent guards, and the emitter-level refusal defeats it — see `both-empty-endpoint-guards-removed`, which is the mutant that pins the requirement.",
    defeatedByAnotherGuard: "emitDirectiveApplications' emitter-level `if (!source || !target) return`",
    edits: [[
      `          if (fieldType) {
            addDeclaredType(ownerSymbol, fieldType,`,
      `          if (typeNode) {
            addDeclaredType(ownerSymbol, fieldType!,`,
    ]],
  },
  {
    id: "empty-endpoint-not-refused-at-the-emitter",
    defect: "B10: the second half of B9 — nothing at the emitter refused an empty source or target, so any other route to one would publish a junk row. NOTE: likewise defeated by the caller's `if (returnType)` guard; the pair-removal mutant is the one that pins the requirement.",
    defeatedByAnotherGuard: "the input-field arm's `if (fieldType)` guard",
    edits: [[
      `      if (!source || !target) return`,
      `      // mutant: no emitter-level refusal`,
    ]],
  },
  {
    id: "unnamed-operation-ordinal-not-reset",
    defect:
      "The unnamed-operation identity numbers the operations of a DOCUMENT, and the counter lives on the analyzer instance. A pooled worker reuses one instance across files, so without the per-`analyze` reset the second file's only unnamed operation publishes as `<stem>::operation_2`. Not catchable by this harness or by run-fixtures.ts, because BOTH construct a fresh analyzer per file (score.mts:77 does `new Analyzer()` inside the loop, and a fixture is one file) and therefore start the counter at 0 regardless. Verified: this mutant SURVIVES the fixture suite 5/5 and is caught by probe/analyzer-reuse.mts, which reuses one instance and exits 1.",
    defeatedByAnotherGuard: "script/m14/tmp/graphql/probe/analyzer-reuse.mts (one instance, four documents, asserts the ordinal restarts)",
    edits: [[
      `    this.typeCache = new Map()
    this.unnamedOperationOrdinal = 0`,
      `    this.typeCache = new Map()`,
    ]],
  },
  {
    id: "complexity-ignores-relationships",
    defect: "D1: `complexity` counted symbols only, where every other data-language analyzer (lua, json) counts symbols + relationships",
    edits: [[
      `        complexity: symbols.length + relationships.length,`,
      `        complexity: symbols.length, // mutant: the pre-fix value`,
    ]],
  },
  {
    id: "document-kind-always-empty",
    defect: "D2: `documentKind` read `Definition` off the root, so every file was classified `empty`",
    edits: [[
      `      if (this.typeOf(inner) === "OperationDefinition" || this.typeOf(inner) === "FragmentDefinition") hasExecutable = true`,
      `      if (false) hasExecutable = true // mutant: type_system only, never executable`,
    ]],
  },
]

async function loadAnalyzer(source: string, tag: string) {
  fs.mkdirSync(WORK, { recursive: true })
  const file = path.join(WORK, `analyzer-${tag}.ts`)
  fs.writeFileSync(file, source.replace('from "./engine"', `from "${ROOT}/src/ast/engine"`))
  const mod = await import(`${file}?v=${tag}`)
  return mod.RealGraphqlAnalyzer
}

const { evaluate } = await import("./score.mts")
const { RealGraphqlAnalyzer } = await import(SRC)

console.log("=== baseline (unmutated) ===")
const base = evaluate(RealGraphqlAnalyzer)
console.log(
  `  sym ${base.symTp}tp/${base.symFp}fp/${base.symFn}fn  ` +
    `rel ${base.relTp}tp/${base.relFp}fp/${base.relFn}fn  ` +
    `param ${base.paramTp}tp/${base.paramFp}fp/${base.paramFn}fn  ` +
    `doc ${base.docTp}tp/${base.docFp}fp/${base.docFn}fn  ` +
    `violations=${base.violations.length} ranges=${base.rangeFailures.length} failed=${base.failed}`,
)
if (base.failed) {
  console.log("  BASELINE IS FAILING — every mutant result below would be meaningless:")
  for (const f of base.failures.slice(0, 20)) console.log("    " + f)
  process.exit(1)
}

const original = fs.readFileSync(SRC, "utf8")
let caught = 0
let survived = 0
let staleEquivalences = 0
const unapplied: string[] = []
const survivors: string[] = []
const defeated: string[] = []
const equivalent: string[] = []
const results: any[] = []

for (const m of MUTANTS) {
  let src = original
  let applied = true
  for (const [find, replace] of m.edits) {
    if (!src.includes(find)) {
      applied = false
      console.log(`  !! ${m.id}: anchor not found -> ${JSON.stringify(find.slice(0, 78))}`)
      break
    }
    src = src.replace(find, replace)
  }
  if (!applied) {
    // An edit that no longer matches the source is a HARNESS ERROR, not a mutant
    // that survived detection. Counting it as a survival is the worst possible
    // outcome: the suite still printed "0 survived" while proving nothing about
    // this defect, and a drifted anchor anywhere else would do the same silently.
    // This is exactly what happened when `topLevelDefinitions` was rewritten to
    // use `firstChildOfType` — the anchor went stale, the mutant was never
    // applied, and it was reported as a survivor.
    results.push({ ...m, applied: false, caught: false })
    unapplied.push(m.id)
    continue
  }

  let verdict: any
  try {
    const A = await loadAnalyzer(src, m.id)
    verdict = evaluate(A)
  } catch (e: any) {
    verdict = { failed: true, failures: [`threw: ${e?.message ?? e}`], violations: [], rangeFailures: [], symFp: -1, symFn: -1, relFp: -1, relFn: -1, paramFp: -1, paramFn: -1, docFp: -1, docFn: -1, unexpectedParseErrors: [] }
  }
  const wasCaught = verdict.failed === true
  if (m.equivalentByConstruction) {
    equivalent.push(m.id)
    if (wasCaught) {
      // The declaration is stale: the differential DID separate this mutant, so
      // the "no fixture can tell them apart" claim is false and must be
      // corrected against the printed facts rather than waived.
      console.log(`  !! ${m.id}: declared equivalent but the differential CAUGHT it — the justification is stale`)
      for (const f of (verdict.failures ?? []).slice(0, 4)) console.log(`             ${f}`)
      staleEquivalences++
    } else {
      // The enforcement is stated PER MUTANT. A single blanket line is how a
      // justification ends up claiming a probe checks something it does not.
      console.log(`  EQUIVALENT ${m.id.padEnd(47)} not separable by construction; enforced by ${(m as any).enforcedBy ?? "(no enforcement recorded — that is itself a gap)"}`)
    }
    results.push({ id: m.id, defect: m.defect, caught: wasCaught, equivalentByConstruction: m.equivalentByConstruction })
    fs.rmSync(path.join(WORK, `analyzer-${m.id}.ts`), { force: true })
    continue
  }
  if (wasCaught) caught++
  else if (m.defeatedByAnotherGuard) {
    // a mutant that removes one of two independent guards is EXPECTED to survive:
    // the other guard holds. That is a measured property of the code (defence in
    // depth), not a hole in the suite — but it is still a mutant that does not fail
    // on its own, so it is reported and counted, never quietly dropped.
    defeated.push(`${m.id} (by ${m.defeatedByAnotherGuard})`)
  } else {
    survived++
    survivors.push(m.id)
  }
  results.push({ id: m.id, defect: m.defect, caught: wasCaught, firstFailures: (verdict.failures ?? []).slice(0, 3) })
  console.log(
    `  ${wasCaught ? "CAUGHT  " : "SURVIVED"} ${m.id.padEnd(48)} ` +
      `symFp=${verdict.symFp} symFn=${verdict.symFn} relFp=${verdict.relFp} relFn=${verdict.relFn} paramFp=${verdict.paramFp} paramFn=${verdict.paramFn} docFp=${verdict.docFp} docFn=${verdict.docFn} ranges=${(verdict.rangeFailures ?? []).length}`,
  )
  for (const f of (verdict.failures ?? []).slice(0, 2)) console.log(`             ${f}`)
  fs.rmSync(path.join(WORK, `analyzer-${m.id}.ts`), { force: true })
}

console.log(`\nmutants=${MUTANTS.length} caught=${caught} survived=${survived} defeatedByAnotherGuard=${defeated.length} equivalentByConstruction=${equivalent.length} UNAPPLIED=${unapplied.length}`)
if (defeated.length) console.log("DEFEATED BY ANOTHER GUARD (defence in depth, measured): " + defeated.join("; "))
if (equivalent.length) console.log("EQUIVALENT (not separable by construction, justification recorded): " + equivalent.join(", "))
if (staleEquivalences) console.log("STALE EQUIVALENCE DECLARATIONS: " + staleEquivalences)
if (survivors.length) console.log("SURVIVORS: " + survivors.join(", "))
fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(path.join(HERE, "out/mutation.json"), JSON.stringify({ mutants: MUTANTS.length, caught, survived, defeated, equivalent, staleEquivalences, survivors, unapplied, results }, null, 2))
if (unapplied.length) {
  console.error(`\nHARNESS ERROR: ${unapplied.length} mutant(s) could not be applied, so this run proves NOTHING about them:`)
  for (const id of unapplied) console.error(`  ${id}`)
  console.error(`An anchor is a verbatim copy of analyzer source. When the analyzer is refactored,`)
  console.error(`the anchor is stale and the mutant silently stops testing anything.`)
}
process.exitCode = survived === 0 && staleEquivalences === 0 && unapplied.length === 0 ? 0 : 1
