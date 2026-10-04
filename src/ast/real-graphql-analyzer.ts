import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * REAL GRAPHQL ANALYZER — pure tree-sitter AST extraction against the vendored
 * `tree-sitter-graphql` grammar (PascalCase node types: `ObjectTypeDefinition`,
 * `FieldDefinition`, `NamedType`, `OperationDefinition`, …).
 *
 * The grammar is vendored, patched and pinned in
 * `grammars/tree-sitter-graphql/`; the node NAMES above are a contract, not an
 * implementation detail — see that directory's README for why the rules are
 * PascalCase rather than upstream's snake_case.
 *
 * ## Symbol contract (declaration nodes only — usages are relationships)
 *
 *   - `SchemaDefinition` / `SchemaExtension` → `namespace` `schema`, with root
 *     operation types as `property` children named `query`/`mutation`/
 *     `subscription`.
 *   - `ObjectTypeDefinition`/`ObjectTypeExtension` → `class`;
 *     `InterfaceTypeDefinition`/`InterfaceTypeExtension` → `interface`;
 *     `UnionTypeDefinition`/`UnionTypeExtension` and
 *     `ScalarTypeDefinition`/`ScalarTypeExtension` → `type`;
 *     `EnumTypeDefinition`/`EnumTypeExtension` → `enum`;
 *     `EnumValueDefinition` → `enum_member`;
 *     `InputObjectTypeDefinition`/`InputObjectTypeExtension` → `class`.
 *   - `FieldDefinition`, and `InputValueDefinition` under
 *     `InputFieldsDefinition`, → `property` owned by the enclosing type.
 *   - `InputValueDefinition` under `ArgumentsDefinition` → a *parameter* of the
 *     field or directive definition, not a symbol.
 *   - `DirectiveDefinition` → `function` `@name`.
 *   - `OperationDefinition` / `FragmentDefinition` → `method`.
 *   - `VariableDefinition` → `variable` `$name`, owned by its operation.
 *
 * ## Extensions
 *
 * GraphQL splits a type across files with `extend`. An extension's members are
 * members of the extended type, so they are emitted with `ownerName` = the
 * extended type's name and `metadata.inExtension = true`. Whether the extension
 * ALSO produces a symbol for the type name depends on the file: if the file
 * declares the type, the extension contributes members only (a second symbol
 * would be a duplicate identity); if it does not, the extension is the file's
 * only word about that type, so it emits a `partial` symbol for it, because the
 * `contains` edge needs a source. That decision is made from a pre-pass over the
 * document's top-level definitions, never from a guess.
 *
 * ## Relationship ontology
 *
 *   - `contains`    type → field, enum → value, input → input field,
 *                   `schema` → root operation type (qualified identities).
 *   - `implements`  object/interface → each implemented interface. The
 *                   `ImplementsInterfaces` rule is left-recursive, so the node
 *                   tree is NESTED (`I > I > I` for `A & B & C`); every
 *                   `NamedType` in the subtree is collected, which is correct for
 *                   both the nested shape and a flattened one.
 *   - `uses`        type references (field return/argument type, input field
 *                   type, union member, root operation type, directive
 *                   application) and executable references (field selection,
 *                   fragment spread, fragment/inline-fragment type condition,
 *                   variable reference).
 *
 * A field selection is qualified `<Type>.<field>` when the document itself says
 * what type the selection is on — the type condition of a fragment or an inline
 * fragment. Inside a field's own selection set the parent type is the field's
 * return type, which an executable document does not carry, so the target stays
 * the bare field name and `metadata.selectionPath` carries the full path. That
 * is a statement about the document, not an omission.
 *
 * ## Lines
 *
 * `nodeToRange` skips a leading `Description`, so a described definition's line
 * is the line its keyword is written on and not the line its docstring starts
 * on — the M59/#861 rule, already applied to scala (`declaration-lines-825`),
 * typescript and javascript.
 *
 * Every relationship carries `line_number`, read off the AST node that NAMES the
 * fact: the interface name in an `implements` clause, the `NamedType` of a type
 * reference, the field's own `Name` for `contains`. The store's relationship
 * identity is `(source, target, type, line)`, so without a line two genuine facts
 * — `f(x: Int): Int` has both a return type and an argument type of `Int`, and
 * they are on different lines — collapse into one row and the second is lost
 * silently. With the line they are two facts. A line is never invented: it is
 * always a node's own `startPosition.row + 1`.
 *
 * Descriptions are unquoted by slicing and by an explicit escape scan, and block
 * strings are dedented per specification §2.9.4 — no regular expressions and no
 * `RegExp` anywhere in this file. Syntax errors are owned by `ASTEngine`, which
 * walks `ERROR`/`MISSING` nodes after this analyzer returns; `errors` is
 * therefore empty by design and the engine's rows are the real ones.
 */
/**
 * `extend X` -> the DEFINITION whose kind it shares. The two halves of a split
 * type must never drift: a `class` for `type X` and a different kind for
 * `extend type X` would make an extension's members land in a scope the
 * declaration never declared.
 */
const EXTENSION_TO_DEFINITION: Record<string, string> = {
  ObjectTypeExtension: "ObjectTypeDefinition",
  InterfaceTypeExtension: "InterfaceTypeDefinition",
  UnionTypeExtension: "UnionTypeDefinition",
  EnumTypeExtension: "EnumTypeDefinition",
  ScalarTypeExtension: "ScalarTypeDefinition",
  InputObjectTypeExtension: "InputObjectTypeDefinition",
}

/** A directive applied to a declaration or a selection, with its constant arguments. */
interface DirectiveApplication {
  name: string
  arguments?: Record<string, string>
  line: number
}

/**
 * The `Directive` node each application came from, in a side table.
 *
 * The emitter needs the node to reach a directive argument's VALUE, because a
 * directive argument may name an enum member and that is a reference. Storing the
 * node on the application itself would be simpler and wrong: these objects are
 * handed to `metadata.graphqlDirectives` on every symbol they decorate, and a
 * tree-sitter `Node` in stored metadata is an AST handle in a row the store
 * serialises. A WeakMap keeps the association without putting anything in the
 * metadata, and lets the node be collected with the tree.
 */
const DIRECTIVE_NODE = new WeakMap<DirectiveApplication, Node>()

export class RealGraphqlAnalyzer implements ASTEngine.LanguageAnalyzer {
  /**
   * `node.type` memoised per node id, for the duration of one `analyze` call.
   *
   * `type` is a marshalling getter — every read crosses into WASM and copies a
   * string out — and the analyzer reads it far more often than there are nodes:
   * measured on the 20,368-line GitHub public schema, **103,531 reads of 31,491
   * distinct nodes, so 69.6% were redundant.** `node.id`, by contrast, is a plain
   * own property set in the binding's constructor, so keying a `Map` on it costs
   * nothing and turns every read after the first into a hash lookup.
   *
   * It is an instance field only because the readers are instance methods, and it
   * is REASSIGNED at the top of every `analyze` call, which is what makes it safe:
   * a `Node` id is only unique within one tree, and the binding documents that a
   * node reused from an older tree keeps its id, so a cache that outlived a call
   * could answer with the previous tree's type. Reassigning makes that impossible
   * rather than merely unlikely.
   */
  private typeCache: Map<number, string> = new Map()

  /** `node.type`, read through the per-call memo. */
  private typeOf(node: Node): string {
    // The key must be a real id. A node whose `id` is not a number — the binding's
    // sentinel for "no node" carries none — would otherwise share the single key
    // `undefined` with every other such node and be answered with the FIRST one's
    // type. That is not hypothetical: routing a plain object's `.type` string
    // through here did exactly that, cached `ID` under `undefined`, and then
    // reported `ID` as the type of an argument declared `Role`. A string field and
    // a node property look identical to a regex, which is how it got in.
    const id = (node as unknown as { id?: number }).id
    if (typeof id !== "number") return node.type
    const hit = this.typeCache.get(id)
    if (hit !== undefined) return hit
    const t = node.type
    this.typeCache.set(id, t)
    return t
  }

  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // A fresh memo per call: a `Node` id is unique only within one tree, and the
    // binding reuses ids for nodes carried over from an older tree, so a cache
    // that outlived the call could return the PREVIOUS tree's type for this one.
    this.typeCache = new Map()
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // -------------------------------------------------------------- dedupe
    // Identity is (source, type, target, role, line) — the store keys a
    // relationship on (source, target, type, line), so two facts that differ
    // only in ROLE are two different sites and must both survive. Keying on
    // (source, type, target) alone, as this analyzer used to, silently dropped
    // the argument-type edge of every field whose argument type equals its
    // return type.
    const relKeys = new Set<string>()
    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      line: number,
      role: string,
      metadata: Record<string, any> = {},
    ) => {
      if (source === target && role === "field_selection") return // a selection can never be a reference to itself
      // A `Directives` edge on an anonymous operation inside an error region has no
      // anchor, and a MISSING name makes a target empty; either way the store would
      // receive a row naming nothing. Refuse at the emitter, not downstream.
      if (!source || !target) return
      const key = `${source}\u0000${type}\u0000${target}\u0000${role}\u0000${line}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      relationships.push({
        source,
        target,
        type,
        confidence: 1,
        line_number: line,
        // Every edge this analyzer emits is read off a NAMED AST NODE — an
        // `ImplementsInterfaces` clause, a `NamedType`, a field's own `Name`, a
        // `Directives` child — so `structural` is the class for all of them and is
        // stated rather than left absent. 38 sibling lanes publish this key and this
        // one published none, which made "how much of this graph is guesswork" a
        // question with no machine-readable answer on this lane: the honesty contract
        // §4.3 requires the heuristic ratio to be a QUERYABLE number, and an absent
        // key is not queryable. `confidence` was already 1 everywhere, so nothing
        // here is newly a heuristic — the key says so explicitly.
        metadata: { ...metadata, relationshipRole: role, evidenceClass: "structural" },
      })
    }

    /**
     * A DECLARED-TYPE reference: the declaration that WRITES a type name names the
     * type it writes.
     *
     * These five positions are `references`, not `uses`, and the family decided it
     * rather than this lane. Ledger rule R9 states the contract every lane owes — a
     * `references` edge from a declaration to the type it names, marked
     * `metadata.relationshipType === "declared_type"` — and the measured shape of the
     * sibling lanes that satisfy it is uniform: java, kotlin, scala, csharp, go,
     * typescript and rust all emit `RelationshipType.References` for a field type, a
     * parameter, a return type or a variable type, and NONE of them emits a `uses`
     * edge for the same fact. typescript even suppresses the duplicate explicitly
     * (`alreadyPublished`, real-typescript-analyzer.ts:3439). Publishing the same
     * fact under two labels is the label-divergence class R10 exists to catch, so the
     * edge is REPLACED, not duplicated: `uses` loses 7,949 edges here and `references`
     * gains them, and the graph grows by the `exports` and `overrides` families only.
     *
     * The positions are exactly the ones a `Type` node appears in — a field's return
     * type, an argument's type, an input field's type, a variable's type, a directive
     * argument's type — and that is the whole rule. A union member, a root operation
     * type and a fragment type condition are a NAME in a list or a name in a mapping,
     * not a type clause, so they stay `uses`; the census counts both populations
     * (7,949 `Type` nodes under a declaration against 24,630 `uses` edges) so the
     * split is measured rather than asserted.
     */
    const addDeclaredType = (
      source: string,
      target: string,
      line: number,
      role: string,
      metadata: Record<string, any> = {},
    ) => {
      addRelationship(source, target, ASTEngine.RelationshipType.References, line, role, {
        ...metadata,
        relationshipType: "declared_type",
      })
    }

    // ------------------------------------------------- directive applications
    // A `Directives` scan is the single most expensive thing this analyzer does
    // (measured: 582 ms of 1,139 ms on the 20,368-line GitHub public schema —
    // 51%), and the first implementation ran it TWICE on every field, once to
    // build the symbol's metadata and once to build the directive edges. The
    // result is memoised per node, so a declaration with directives pays for one
    // scan instead of two. The cache is a WeakMap on the node, so a node that is
    // never asked about costs nothing and nothing is retained.
    const directiveCache = new WeakMap<Node, DirectiveApplication[] | null>()
    const directivesOf = (node: Node): DirectiveApplication[] | null => {
      const cached = directiveCache.get(node)
      if (cached !== undefined) return cached
      const list = this.scanDirectiveApplications(node)
      directiveCache.set(node, list)
      return list
    }

    // ------------------------------------------------- pre-pass: what is declared
    // Type extensions need to know whether this file also DECLARES the type they
    // extend. Declarations are always top-level, so the pre-pass only reads the
    // document's direct definitions — it is O(top-level definitions), not a
    // second full traversal.
    const declaredHere = new Set<string>()
    /**
     * What kind THIS DOCUMENT gives each type name.
     *
     * It exists for one labelling decision. `type A implements B` and
     * `type A extends B` are written with the SAME grammar rule — GraphQL has an
     * `implements` clause and no `extends` clause — so which relationship an edge
     * carries is a decision about what `B` IS. A per-file analyzer can only read that
     * off the document it is parsing, so this index is exactly the evidence available
     * and the rule states what it does when the document is silent.
     *
     * Corpus measurement behind it (script/m14/tmp/graphql/probe/ontology-census.mts,
     * 426 files / 161,957 nodes): 11 `implements` clauses in the corpus name a
     * supertype no file declares as an interface, 7 of them inside documents the
     * grammar parses with zero ERROR/MISSING nodes — and **0 of those 7 declare the
     * supertype in the SAME document**, every one of them in a schema split across
     * files. So this rule is correct and reaches nothing on this corpus, and the
     * cross-file remainder is a project-scope derivation that a per-file analyzer
     * cannot make. That count is carried as a declared limitation rather than left
     * implicit; it is also why the rule is stated narrowly instead of being widened
     * to guess across files.
     */
    const kindOfNameHere = new Map<string, Set<ASTEngine.SymbolKind>>()
    for (const decl of this.topLevelDeclarations(rootNode)) {
      if (!decl.name) continue
      declaredHere.add(`${decl.symbolKind}\u0000${decl.name}`)
      const kinds = kindOfNameHere.get(decl.name) ?? new Set<ASTEngine.SymbolKind>()
      kinds.add(decl.symbolKind)
      kindOfNameHere.set(decl.name, kinds)
    }
    /**
     * What kind THIS DOCUMENT gave a supertype name, or undefined when the document
     * says nothing about it. `Class` is both an object type and an input object type
     * and `Type` is both a union and a scalar, so the answer is a SET and a name the
     * document declares two ways is genuinely ambiguous — which the caller treats as
     * "not classifiable" rather than resolving by preference.
     */
    const supertypeKindOf = (supertype: string): ASTEngine.SymbolKind | undefined => {
      const kinds = kindOfNameHere.get(supertype)
      if (!kinds || kinds.size !== 1) return undefined
      const only = [...kinds][0]
      return only === ASTEngine.SymbolKind.Interface || only === ASTEngine.SymbolKind.Class || only === ASTEngine.SymbolKind.Type ? only : undefined
    }
    /**
     * One `implements` clause, labelled by what the document says its supertype IS.
     *
     * GraphQL writes both relationships with one rule, so the label is a decision about
     * the supertype: an interface is `implements` — the specification's own meaning —
     * and a supertype the document declares to be an object type, an input object, a
     * union or a scalar is inheritance, which is `extends`. When the document says
     * nothing about the name, or declares it two ways, the edge stays `implements`:
     * inventing an `extends` edge for a supertype this analyzer cannot classify is
     * the fabrication the workstream's rule exists to prevent, and 6 of the 11
     * object-typed supertypes in the corpus are named by a file other than the one
     * carrying the clause.
     *
     * The pair is recorded in `heritageEdges` either way, because it is a fact about
     * the document whatever the edge is called, and the `overrides` post-pass needs it.
     */
    const emitHeritage = (owner: string, supertype: string, line: number, inExtension: boolean) => {
      const supertypeKind = supertypeKindOf(supertype)
      const relType = supertypeKind === ASTEngine.SymbolKind.Class || supertypeKind === ASTEngine.SymbolKind.Type ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements
      heritageEdges.push({ owner, iface: supertype, ifaceKind: supertypeKind })
      addRelationship(owner, supertype, relType, line, relType === ASTEngine.RelationshipType.Extends ? "extends" : "implements", {
        ...(relType === ASTEngine.RelationshipType.Extends ? { implementsClause: true } : {}),
        ...(inExtension ? { extension: true } : {}),
      })
    }
    /** Every `implements` clause this document states, for the `overrides` post-pass. */
    const heritageEdges: Array<{ owner: string; iface: string; ifaceKind?: ASTEngine.SymbolKind }> = []
    /**
     * Every field each type name declares in THIS document, with the field's own `Name`
     * node so an `overrides` edge can carry the line its member is written on.
     *
     * Filled from the walk rather than by a pre-pass, because the walk already visits
     * every `FieldDefinition` with its owner in hand and a second traversal of the tree
     * is not free. A FORWARD reference is the reason the `overrides` edges are emitted
     * after the walk rather than inside the `implements` arm: github-schema.graphql
     * writes `interface Node` after every type that implements it, so at the moment
     * `type App implements Node` is handled the interface's member list is empty.
     */
    const memberNameNodes = new Map<string, Map<string, Node>>()
    // Which types this document EXTENDS. Measured at 320 ms (28%) when computed by
    // re-walking every top-level definition once per scalar definition; the walk is
    // already being done above, so the answer is collected here for free and every
    // later question is a Set lookup.
    const extendedHere = new Set<string>()
    for (const ext of this.topLevelExtensions(rootNode)) {
      extendedHere.add(`${ext.symbolKind}\u0000${ext.name}`)
    }

    // ------------------------------------------------------------ traversal
    interface Owner {
      name?: string
      kind?: ASTEngine.SymbolKind
    }
    interface SelectionContext {
      /** Nearest enclosing operation or fragment symbol — the anchor for executable facts. */
      root?: string
      /** The type a selection is written against, when the document states it. */
      enclosingType?: string
      /** Dotted selection path from the operation/fragment root. */
      path: string[]
    }

    const TYPE_KIND: Record<string, ASTEngine.SymbolKind> = {
      ObjectTypeDefinition: ASTEngine.SymbolKind.Class,
      InterfaceTypeDefinition: ASTEngine.SymbolKind.Interface,
      UnionTypeDefinition: ASTEngine.SymbolKind.Type,
      EnumTypeDefinition: ASTEngine.SymbolKind.Enum,
      ScalarTypeDefinition: ASTEngine.SymbolKind.Type,
      InputObjectTypeDefinition: ASTEngine.SymbolKind.Class,
    }

    // Extensions share the kind of the definition they extend, so one table
    // covers both halves of every pair and a `class` can never drift from its
    // `extend type` form.
    const extensionSymbols: Array<{ index: number; name: string; kindKey: string; typeNode: string }> = []
    const rootOperationNames = new Set<string>()

    const stack: Array<{ node: Node; owner: Owner; sel: SelectionContext; inExtension: boolean }> = [
      { node: rootNode, owner: {}, sel: { path: [] }, inExtension: false },
    ]
    const pushChildren = (
      node: Node,
      owner: Owner,
      sel: SelectionContext,
      inExtension: boolean,
      skip: (n: Node) => boolean = () => false,
    ) => {
      const kids = node.namedChildren
      for (let i = kids.length - 1; i >= 0; i--) {
        const child = kids[i]
        if (child && !skip(child)) stack.push({ node: child, owner, sel, inExtension })
      }
    }

    // ------------------------------------------------------------- schema root
    if (this.isAnyOf(rootNode, "Document", "source_file", "SourceFile")) {
      // (a document whose first definition is an error region still walks; the
      // switch below is per-definition, not per-file)
    }

    // =====================================================================
    // The walk. Every construct the grammar can produce is either handled here
    // or descended through by the default arm; the census probe
    // (fixtures/graphql/probe/grammar-census.mts) reports any node type the
    // grammar produces that this switch never names, so a blind spot shows up
    // as a measurement rather than as silence.
    // =====================================================================
    while (stack.length > 0) {
      const { node, owner, sel, inExtension } = stack.pop()!
      const t = node.type

      // ---- schema definition / extension ----------------------------------
      if (t === "SchemaDefinition" || t === "SchemaExtension") {
        if (!symbols.some((s) => s.name === "schema" && s.kind === ASTEngine.SymbolKind.Namespace)) {
          symbols.push({
            name: "schema",
            kind: ASTEngine.SymbolKind.Namespace,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            docstring: this.descriptionOf(node),
            metadata: {
              graphqlType: t === "SchemaDefinition" ? "schema" : "schema_extension",
              topLevel: true,
              ...(t === "SchemaExtension" ? { inExtension: true } : {}),
            },
          })
        }
        for (const opDef of node.namedChildren) {
          if (opDef?.type !== "OperationTypeDefinition") continue
          const opTypeNode = this.firstChildOfType(opDef, "OperationType")
          const opType = opTypeNode?.text ?? "operation"
          const named = this.firstChildOfType(opDef, "NamedType")
          const rootType = named ? this.nameOf(named) : undefined
          const line = this.lineOf(named ?? opDef)
          // The specification allows one root operation type per operation kind
          // across the whole schema; a second `query:` in the same file (a
          // `SchemaDefinition` plus a `SchemaExtension`) must not mint a second
          // symbol with the same identity, and the reference is a duplicate too.
          if (rootOperationNames.has(opType)) continue
          rootOperationNames.add(opType)
          symbols.push({
            name: opType,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(opDef),
            scope: "schema",
            visibility: "public",
            returnType: rootType,
            ownerName: "schema",
            ownerKind: ASTEngine.SymbolKind.Namespace,
            metadata: {
              graphqlRole: "root_operation_type",
              ...(t === "SchemaExtension" ? { inExtension: true } : {}),
            },
          })
          addRelationship("schema", `schema.${opType}`, ASTEngine.RelationshipType.Contains, line, "contains", {
            ...(t === "SchemaExtension" ? { extension: true } : {}),
          })
          if (rootType) {
            addRelationship(`schema.${opType}`, rootType, ASTEngine.RelationshipType.Uses, line, "root_operation_type", {
              ...(t === "SchemaExtension" ? { extension: true } : {}),
            })
          }
        }
        // `schema @link(url: …)` and `extend schema @link(…)` are how Apollo
        // Federation v2 declares itself, so the application is a real reference
        // to the `@link` directive like any other.
        this.emitDirectiveApplications(node, directivesOf(node), "schema", sel, addRelationship, t === "SchemaExtension")
        pushChildren(node, { name: "schema", kind: ASTEngine.SymbolKind.Namespace }, sel, inExtension, (c) => this.typeOf(c) === "OperationTypeDefinition")
        continue
      }

      // ---- type definitions -------------------------------------------------
      if (TYPE_KIND[t]) {
        const name = this.nameOf(node)
        if (name) {
          const kind = TYPE_KIND[t]
          this.emitTypeSymbol(node, name, kind, t, symbols, relationships, sel, inExtension, directivesOf(node))
          // A `extend scalar S @x` in the same file is a fact about S, not a
          // second S; record it where a reader can see it.
          if (t === "ScalarTypeDefinition" && extendedHere.has(`${kind}\u0000${name}`)) {
            const last = symbols[symbols.length - 1]
            last.metadata = { ...last.metadata, extended: true }
          }
          // `implements` is a nested left-recursive rule; every NamedType in it
          // is an implemented interface, whatever the tree's nesting depth is.
          const implNode = this.firstChildOfType(node, "ImplementsInterfaces")
          if (implNode) {
            for (const { name: iface, node: ifaceNode } of this.collectNamedTypes(implNode)) {
              emitHeritage(name, iface, this.lineOf(ifaceNode), inExtension)
            }
          }
          // union members
          if (t === "UnionTypeDefinition") {
            const membersNode = this.firstChildOfType(node, "UnionMemberTypes")
            if (membersNode) {
              for (const { name: member, node: memberNode } of this.collectNamedTypes(membersNode)) {
                addRelationship(name, member, ASTEngine.RelationshipType.Uses, this.lineOf(memberNode), "union_member", {
                  ...(inExtension ? { extension: true } : {}),
                })
              }
            }
          }
          this.emitDirectiveApplications(node, directivesOf(node), name, sel, addRelationship, inExtension)
          pushChildren(node, { name, kind }, sel, inExtension)
        }
        continue
      }

      // ---- type extensions --------------------------------------------------
      if (EXTENSION_TO_DEFINITION[t]) {
        // `extend scalar S` declares nothing: the rule is
        // `"extend" "scalar" Name Directives?` and a scalar has no fields, no
        // values and no heritage. Emitting a symbol for it publishes a
        // duplicate `type S` whenever the same file also declares the scalar,
        // and a `partial` symbol when it does not — for a construct that
        // carries no members. It is recorded in metadata on the scalar instead
        // (see the ScalarTypeDefinition arm), which is the fact.
        if (t === "ScalarTypeExtension") {
          this.emitDirectiveApplications(node, directivesOf(node), this.nameOf(node) ?? "", sel, addRelationship, true)
          continue
        }
        const definitionType = EXTENSION_TO_DEFINITION[t]
        const name = this.nameOf(node)
        if (name) {
          const kind = TYPE_KIND[definitionType]
          const kindKey = `${kind}\u0000${name}`
          // The extension owns a symbol for the type name only when this file
          // does not declare the type itself. Handled here and undone in the
          // post-pass if a later top-level definition turns out to declare it —
          // a top-level scan cannot know the future, and a wrong extra symbol is
          // a duplicate identity in the index.
          if (!declaredHere.has(kindKey)) {
            const index = symbols.length
            symbols.push({
              name,
              kind,
              range: this.nodeToRange(node),
              scope: "",
              visibility: "public",
              docstring: this.descriptionOf(node),
              metadata: { graphqlType: t, partial: true, inExtension: true, topLevel: true },
            })
            extensionSymbols.push({ index, name, kindKey, typeNode: t })
          }
          const implNode = this.firstChildOfType(node, "ImplementsInterfaces")
          if (implNode) {
            for (const { name: iface, node: ifaceNode } of this.collectNamedTypes(implNode)) {
              emitHeritage(name, iface, this.lineOf(ifaceNode), true)
            }
          }
          if (definitionType === "UnionTypeDefinition") {
            const membersNode = this.firstChildOfType(node, "UnionMemberTypes")
            if (membersNode) {
              for (const { name: member, node: memberNode } of this.collectNamedTypes(membersNode)) {
                addRelationship(name, member, ASTEngine.RelationshipType.Uses, this.lineOf(memberNode), "union_member", { extension: true })
              }
            }
          }
          this.emitDirectiveApplications(node, directivesOf(node), name, sel, addRelationship, true)
          // Members belong to the extended type, tagged so a reader can tell
          // which half of a split type they came from.
          pushChildren(node, { name, kind }, sel, true)
        }
        continue
      }

      // ---- enum value (definition or extension) -----------------------------
      if (t === "EnumValueDefinition") {
        const enumValue = this.firstChildOfType(node, "EnumValue")
        const valueName = enumValue ? this.nameOf(enumValue) : undefined
        if (valueName && owner.name) {
          symbols.push({
            name: valueName,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            scope: owner.name,
            ownerName: owner.name,
            ownerKind: owner.kind,
            visibility: "public",
            docstring: this.descriptionOf(node),
            metadata: { graphqlRole: "enum_value", ...(inExtension ? { inExtension: true } : {}) },
          })
          addRelationship(owner.name, `${owner.name}.${valueName}`, ASTEngine.RelationshipType.Contains, this.lineOf(enumValue ?? node), "contains", {
            ...(inExtension ? { extension: true } : {}),
          })
          this.emitDirectiveApplications(node, directivesOf(node), `${owner.name}.${valueName}`, { root: undefined }, addRelationship, inExtension)
        }
        continue
      }

      // ---- directive definition --------------------------------------------
      if (t === "DirectiveDefinition") {
        const name = this.nameOf(node)
        if (name) {
          const argsNode = this.firstChildOfType(node, "ArgumentsDefinition")
          const repeatable = this.hasChild(node, (n) => this.typeOf(n) === "repeatable")
          const locations = this.firstChildOfType(node, "DirectiveLocations")
          const locationNames = locations
            ? this.collectDirectiveLocations(locations).map((l) => l.name)
            : undefined
          symbols.push({
            name: `@${name}`,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            parameters: argsNode ? this.extractArguments(argsNode) : [],
            docstring: this.descriptionOf(node),
            metadata: {
              graphqlRole: "directive_definition",
              topLevel: true,
              directiveName: name,
              ...(repeatable ? { repeatable: true } : {}),
              ...(locationNames ? { locations: locationNames } : {}),
              ...(this.directiveMetadata(directivesOf(node))),
            },
          })
          // A directive definition's ARGUMENT TYPE is a type reference, and this
          // branch emitted none at all — while the `FieldDefinition` branch below
          // emits `field_argument_type` for the identical construct. So
          // `directive @auth(requires: Role = ADMIN)` said nothing about `Role`,
          // and a directive's argument type was the only declared type in the
          // language with no edge to it. The role is its own name rather than a
          // reuse of `field_argument_type`, because "field" is simply untrue here
          // and a misleading role name hides the finding in the data.
          if (argsNode) {
            for (const arg of this.argumentPairs(argsNode)) {
              if (!arg.type || !arg.typeNode) continue
              addDeclaredType(`@${name}`, arg.type, this.lineOf(arg.typeNode), "directive_argument_type", { argument: arg.name })
              if (arg.name) this.emitEnumValueReferences(`@${name}`, arg.defaultNode, arg.type, addRelationship, { declaration: "directive_argument_default", argument: arg.name })
            }
          }
        }
        continue
      }

      // ---- field definition -------------------------------------------------
      if (t === "FieldDefinition") {
        const fieldName = this.nameOf(node)
        if (fieldName && owner.name) {
          const typeNode = this.firstChildOfType(node, "Type")
          const returnType = typeNode ? this.namedTypeName(typeNode) : undefined
          const argsNode = this.firstChildOfType(node, "ArgumentsDefinition")
          const ownerSymbol = `${owner.name}.${fieldName}`
          symbols.push({
            name: fieldName,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(node),
            scope: owner.name,
            visibility: "public",
            returnType,
            ownerName: owner.name,
            ownerKind: owner.kind,
            parameters: argsNode ? this.extractArguments(argsNode) : [],
            docstring: this.descriptionOf(node),
            metadata: {
              graphqlRole: "field",
              // `rawType` is the type EXPRESSION's source text and is emitted only
              // when there is one: a recovered `Type` node with a MISSING `Name` has
              // the empty text, and publishing `rawType: ""` is a fact about nothing.
              ...(typeNode && typeNode.text ? { rawType: typeNode.text } : {}),
              ...(returnType ? { nullable: !this.isNonNullType(typeNode!) } : {}),
              ...(inExtension ? { inExtension: true } : {}),
              ...(this.directiveMetadata(directivesOf(node))),
            },
          })
          const fieldNameNode = this.firstChildOfType(node, "Name")
          addRelationship(owner.name, ownerSymbol, ASTEngine.RelationshipType.Contains, this.lineOf(fieldNameNode ?? node), "contains", {
            ...(inExtension ? { extension: true } : {}),
          })
          // The member list of `owner.name`, for the `overrides` post-pass. Recorded
          // once per member name, so a field a definition and an extension both write
          // contributes the FIRST declaration and not two rows for one edge.
          if (fieldNameNode) {
            const bag = memberNameNodes.get(owner.name) ?? new Map<string, Node>()
            if (!bag.has(fieldName)) bag.set(fieldName, fieldNameNode)
            memberNameNodes.set(owner.name, bag)
          }
          // The guard is on the RESOLVED NAME, not on the `Type` node existing.
          // `broken:` with no type makes the grammar's recovery emit a `Type` node
          // whose `Name` is MISSING, so `typeNode` is truthy and `returnType` is
          // undefined — and an `if (typeNode)` guard then published a `uses` edge
          // whose target was the EMPTY STRING. Caught by
          // script/m12/graphql-contract-probe.ts, which had asserted exactly that
          // ("missing-type field emits no bogus type reference") and was failing.
          if (returnType) {
            addDeclaredType(ownerSymbol, returnType, this.lineOf(this.namedTypeNode(typeNode!) ?? typeNode!), "field_return_type", {
              ...(inExtension ? { extension: true } : {}),
            })
          }
          if (argsNode) {
            for (const arg of this.argumentPairs(argsNode)) {
              if (!arg.type || !arg.typeNode) continue
              addDeclaredType(ownerSymbol, arg.type, this.lineOf(arg.typeNode), "field_argument_type", {
                argument: arg.name,
                ...(inExtension ? { extension: true } : {}),
              })
              // `role: Color = RED` on an argument definition: the argument
              // declares the type, so the enum value resolves without guessing.
              // An argument is a PARAMETER, not a symbol, so it has no identity to
              // be the source of an edge. The field does, and `argument` says which
              // argument — exactly as `field_argument_type` above already does.
              if (arg.name) this.emitEnumValueReferences(ownerSymbol, arg.defaultNode, arg.type, addRelationship, { declaration: "argument_default", argument: arg.name })
            }
          }
          this.emitDirectiveApplications(node, directivesOf(node), ownerSymbol, sel, addRelationship, inExtension)
        }
        continue
      }

      // ---- input field (InputValueDefinition under InputFieldsDefinition) ----
      if (t === "InputValueDefinition" && node.parent?.type === "InputFieldsDefinition") {
        const fieldName = this.nameOf(node)
        if (fieldName && owner.name) {
          const typeNode = this.firstChildOfType(node, "Type")
          const fieldType = typeNode ? this.namedTypeName(typeNode) : undefined
          const ownerSymbol = `${owner.name}.${fieldName}`
          symbols.push({
            name: fieldName,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(node),
            scope: owner.name,
            visibility: "public",
            returnType: fieldType,
            ownerName: owner.name,
            ownerKind: owner.kind,
            docstring: this.descriptionOf(node),
            metadata: {
              graphqlRole: "input_field",
              ...(typeNode && typeNode.text ? { rawType: typeNode.text } : {}),
              ...(fieldType ? { nullable: !this.isNonNullType(typeNode!) } : {}),
              // Called ONCE. The conditional form below ran it twice per input
              // field — a `firstChildOfType` walk each time — to test a value it
              // then computed again, and this is the per-node hot path.
              ...(() => { const dv = this.defaultValueOf(node); return dv !== undefined ? { defaultValue: dv } : {} })(),
              ...(inExtension ? { inExtension: true } : {}),
              ...(this.directiveMetadata(directivesOf(node))),
            },
          })
          addRelationship(owner.name, ownerSymbol, ASTEngine.RelationshipType.Contains, this.lineOf(this.firstChildOfType(node, "Name") ?? node), "contains", {
            ...(inExtension ? { extension: true } : {}),
          })
          // `color: Color = RED` — the node states its own type, so the value's
          // enum is not a guess.
          // The source is the field's QUALIFIED identity (`Filter.color`), not the
          // bare `color`: the bare name is not a symbol, so an edge from it has no
          // source to resolve to. This is the same identity the `contains` and
          // `input_field_type` edges already use, and the corpus sweep only ever
          // measured unresolved TARGETS, so a bad source here would have been
          // invisible to it.
          this.emitEnumValueReferences(ownerSymbol, this.firstChildOfType(node, "DefaultValue"), fieldType, addRelationship, { declaration: "input_field_default" })
          // Same guard as a field's return type, for the same reason.
          if (fieldType) {
            addDeclaredType(ownerSymbol, fieldType, this.lineOf(this.namedTypeNode(typeNode!) ?? typeNode!), "input_field_type", {
              ...(inExtension ? { extension: true } : {}),
            })
          }
          this.emitDirectiveApplications(node, directivesOf(node), ownerSymbol, sel, addRelationship, inExtension)
        }
        continue
      }

      // ---- operation definition --------------------------------------------
      if (t === "OperationDefinition") {
        const opTypeNode = this.firstChildOfType(node, "OperationType")
        // An operation with no `query`/`mutation`/`subscription` keyword is the
        // specification's shorthand form, which means `query`.
        const opType = opTypeNode?.text ?? "query"
        const nameNode = this.firstChildOfType(node, "Name")
        // Anonymous operations get the house synthetic identity: lower-case
        // `anonymous_*` plus a byte offset, as php (`anonymous_class_<idx>`),
        // javascript (`anonymous_function_<idx>`) and java
        // (`anonymous_<Super>`) do. A line number in a symbol NAME is not an
        // identity — inserting one line above a document renames every
        // anonymous operation in it.
        const opName = nameNode?.text ?? `anonymous_operation_${node.startIndex}`
        symbols.push({
          name: opName,
          kind: ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          scope: "",
          visibility: "public",
          metadata: {
            graphqlRole: "operation",
            graphqlOperationType: opType,
            ...(nameNode ? {} : { anonymous: true, shorthand: true }),
          },
        })
        const varsNode = this.firstChildOfType(node, "VariableDefinitions")
        if (varsNode) {
          for (const varDef of varsNode.namedChildren) {
            if (varDef?.type !== "VariableDefinition") continue
            const varNode = this.firstChildOfType(varDef, "Variable")
            const varName = varNode ? this.nameOf(varNode) : undefined
            const typeNode = this.firstChildOfType(varDef, "Type")
            const varType = typeNode ? this.namedTypeName(typeNode) : undefined
            if (!varName) continue
            // `$c: Color` is a type reference of exactly the same class as a
            // field's return type, an argument's type and an input field's type —
            // and those three all emit one. This one did not, so a variable was
            // the only declared type in the language with no edge to it, and
            // `returnType`/`rawType` were carrying the fact as a string where
            // every sibling fact is a relationship.
            if (varType) {
              addDeclaredType(`$${varName}`, varType, this.lineOf(this.namedTypeNode(typeNode!) ?? typeNode!), "variable_type", {
                operation: opName,
              })
            }
            // `$c: Color = RED` states its own type, so the value resolves.
            this.emitEnumValueReferences(`$${varName}`, this.firstChildOfType(varDef, "DefaultValue"), varType, addRelationship, { declaration: "variable_default" })
            symbols.push({
              name: `$${varName}`,
              kind: ASTEngine.SymbolKind.Variable,
              range: this.nodeToRange(varDef),
              scope: opName,
              returnType: varType,
              ownerName: opName,
              ownerKind: ASTEngine.SymbolKind.Method,
              metadata: {
                graphqlRole: "variable",
                ...(typeNode && typeNode.text ? { rawType: typeNode.text } : {}),
                ...(varType ? { nullable: !this.isNonNullType(typeNode!) } : {}),
                ...(this.defaultValueOf(varDef) !== undefined ? { defaultValue: this.defaultValueOf(varDef) } : {}),
                ...(this.directiveMetadata(directivesOf(varDef))),
              },
            })
          }
        }
        this.emitDirectiveApplications(node, directivesOf(node), opName, sel, addRelationship, false)
        if (varsNode) {
          // `$x: Int @onVar` is specification-valid (3.2) and the vendored
          // grammar rejected it. The application is anchored on the operation
          // that declares the variable, because a variable has no name of its
          // own outside one.
          this.emitDirectiveApplications(varsNode, directivesOf(varsNode), opName, sel, addRelationship, false)
        }
        pushChildren(node, { name: opName, kind: ASTEngine.SymbolKind.Method }, { root: opName, path: [] }, inExtension, (c) => this.typeOf(c) === "VariableDefinition")
        continue
      }

      // ---- fragment definition ---------------------------------------------
      if (t === "FragmentDefinition") {
        const fragNode = this.firstChildOfType(node, "FragmentName")
        const fragName = fragNode ? this.nameOf(fragNode) : undefined
        if (fragName) {
          symbols.push({
            name: fragName,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            metadata: { graphqlRole: "fragment", ...this.directiveMetadata(directivesOf(node)) },
          })
          const typeCondition = this.firstChildOfType(node, "TypeCondition")
          const onType = typeCondition ? this.namedTypeName(typeCondition) : undefined
          if (onType && typeCondition) {
            addRelationship(fragName, onType, ASTEngine.RelationshipType.Uses, this.lineOf(this.namedTypeNode(typeCondition) ?? typeCondition), "fragment_type_condition")
          }
          this.emitDirectiveApplications(node, directivesOf(node), fragName, sel, addRelationship, false)
          // The fragment's own selections are written against its type
          // condition, so they qualify — `fragment F on User { id }` yields
          // `uses F -> User.id`, which the store resolves to the SDL property.
          pushChildren(node, { name: fragName, kind: ASTEngine.SymbolKind.Method }, { root: fragName, enclosingType: onType, path: [] }, inExtension)
        }
        continue
      }

      // ---- VariableDefinition reached on its own ---------------------------
      // Handled by the operation arm, which owns variable symbols so that they
      // are parented by the operation rather than by the variable list. A
      // VariableDefinition cannot occur outside an operation in this grammar.
      if (t === "VariableDefinition") continue

      // ---- executable field selection --------------------------------------
      if (t === "Field") {
        const nameNode = this.firstChildOfType(node, "Name")
        const fieldName = nameNode?.text
        const aliasNode = this.firstChildOfType(node, "Alias")
        const alias = aliasNode ? this.nameOf(aliasNode) : undefined
        if (fieldName && sel.root) {
          // Qualified when the document says what type the selection is on;
          // bare otherwise, because inside a field's own selection set the
          // parent type is the field's return type and an executable document
          // does not carry it.
          const qualified = sel.enclosingType ? `${sel.enclosingType}.${fieldName}` : fieldName
          const path = [...sel.path, fieldName].join(".")
          const argsNode = this.firstChildOfType(node, "Arguments")
          // `item(c: RED)`: an executable document does not carry the argument's
          // type, so the enum member is named bare and the store's unique-name
          // strategy decides it. Naming a type here would be a fabrication.
          if (argsNode && sel.root) {
            for (const arg of this.childrenOfType(argsNode, "Argument")) {
              this.emitEnumValueReferences(sel.root, this.firstChildOfType(arg, "Value"), undefined, addRelationship, { declaration: "field_argument" })
            }
          }
          addRelationship(sel.root, qualified, ASTEngine.RelationshipType.Uses, this.lineOf(nameNode), "field_selection", {
            ...(alias ? { alias } : {}),
            ...(argsNode ? { arguments: this.argumentNames(argsNode) } : {}),
            ...(sel.enclosingType ? { enclosingType: sel.enclosingType } : {}),
            ...(path ? { selectionPath: path } : {}),
          })
        }
        this.emitDirectiveApplications(node, directivesOf(node), sel.root ?? "", sel, addRelationship, false)
        const childPath = [...sel.path, fieldName ?? "?"]
        // A field's own selection set belongs to the field's return type, which
        // is unknown here, so the enclosing type does NOT propagate into it.
        pushChildren(node, { name: fieldName, kind: ASTEngine.SymbolKind.Property }, { root: sel.root, enclosingType: undefined, path: childPath }, inExtension, (c) => this.typeOf(c) === "Name" || this.typeOf(c) === "Alias")
        continue
      }

      // ---- fragment spread ---------------------------------------------------
      if (t === "FragmentSpread") {
        const spreadNode = this.firstChildOfType(node, "FragmentName")
        const spreadName = spreadNode ? this.nameOf(spreadNode) : undefined
        if (spreadName && sel.root) {
          addRelationship(sel.root, spreadName, ASTEngine.RelationshipType.Uses, this.lineOf(spreadNode), "fragment_spread", {
            ...([...sel.path].length ? { selectionPath: sel.path.join(".") } : {}),
          })
        }
        this.emitDirectiveApplications(node, directivesOf(node), sel.root ?? "", sel, addRelationship, false)
        continue
      }

      // ---- inline fragment ----------------------------------------------------
      if (t === "InlineFragment") {
        const typeCondition = this.firstChildOfType(node, "TypeCondition")
        const onType = typeCondition ? this.namedTypeName(typeCondition) : undefined
        if (onType && sel.root && typeCondition) {
          addRelationship(sel.root, onType, ASTEngine.RelationshipType.Uses, this.lineOf(this.namedTypeNode(typeCondition) ?? typeCondition), "inline_fragment_type_condition", {
            ...([...sel.path].length ? { selectionPath: sel.path.join(".") } : {}),
          })
        }
        this.emitDirectiveApplications(node, directivesOf(node), sel.root ?? "", sel, addRelationship, false)
        // The type condition is optional; without one the selections stay on
        // whatever type encloses them.
        pushChildren(node, { name: onType, kind: ASTEngine.SymbolKind.Type }, { root: sel.root, enclosingType: onType ?? sel.enclosingType, path: [...sel.path] }, inExtension, (c) => this.typeOf(c) === "TypeCondition")
        continue
      }

      // ---- variable reference inside an argument value ------------------------
      if (t === "Variable") {
        const valueParent = node.parent
        if (valueParent?.type === "Value" && sel.root) {
          const varName = this.nameOf(node)
          if (varName) {
            addRelationship(sel.root, `$${varName}`, ASTEngine.RelationshipType.Uses, this.lineOf(node), "variable_reference", {
              ...([...sel.path].length ? { selectionPath: sel.path.join(".") } : {}),
            })
          }
        }
        continue
      }

      // ---- default: descend through wrappers ---------------------------------
      pushChildren(node, owner, sel, inExtension)
    }

    // ------------------------------------------------- extension post-pass
    // Drop an extension's own symbol when the same file also DECLARES the type:
    // two `class Query` symbols would be a duplicate identity in the index, and
    // the extension's members already carry `ownerName: "Query"`.
    for (const ext of extensionSymbols) {
      if (!declaredHere.has(ext.kindKey)) continue
      const sym = symbols[ext.index]
      symbols.splice(ext.index, 1)
      for (let i = extensionSymbols.length - 1; i >= 0; i--) {
        if (extensionSymbols[i].index > ext.index) extensionSymbols[i].index--
      }
      if (sym) sym.metadata = { ...sym.metadata, droppedExtensionSymbol: true }
    }
    // ------------------------------------------------ overrides: a supplied member
    //
    // `type Film implements Node` plus a field `id` on `Film` and a field `id` on
    // `Node` is the ONE place GraphQL has an override-shaped construct: §3.6 requires
    // the object to supply every member the interface declares, so the object's field
    // is the one that implements it. Measured on the corpus before this was written —
    // 1,054 occurrences across 4 files, all of them in documents the grammar parses
    // with zero ERROR/MISSING nodes, and **all 1,054 same-document**, which is the
    // resolution this post-pass can do.
    //
    // Both endpoints are symbols the analyzer already emits (`property`, qualified
    // `Type.field`), so the edge resolves at both ends without a project-scope join.
    // A cross-file split — the interface in one file, the object in another — gets the
    // `implements` edge and both member lists and NO `overrides` edge from this lane,
    // which is stated as a limitation rather than papered over by resolving names
    // against a corpus this analyzer never sees.
    for (const h of heritageEdges) {
      if (h.owner === h.iface) continue
      const mine = memberNameNodes.get(h.owner)
      const theirs = memberNameNodes.get(h.iface)
      if (!mine || !theirs) continue
      for (const [member, nameNode] of mine) {
        if (!theirs.has(member)) continue
        addRelationship(`${h.owner}.${member}`, `${h.iface}.${member}`, ASTEngine.RelationshipType.Override, this.lineOf(nameNode), "interface_member_supplied", {
          implementedType: h.owner,
          supertype: h.iface,
          supertypeKind: h.ifaceKind ?? "undeclared_in_this_document",
          member,
        })
      }
    }

    // `exports` is derived after the post-pass so a dropped symbol is not
    // published as an export of the file.
    for (const s of symbols) {
      if (s.metadata?.droppedExtensionSymbol) continue
      // `topLevel` is set at emit time by the arms that create a type-system
      // declaration. The previous rule re-derived it per symbol from a string
      // vocabulary, which cost 210 ms (18%) on the public schema and could
      // disagree with the emit path the moment a spelling changed.
      if (s.metadata?.topLevel !== true) continue
      exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
      // ...and as an EDGE, because `ParseResult.exports` has no consumer.
      //
      // `parallel-indexer.ts` reads `result.imports` (line 3293, into `brain_import`)
      // and reads NOTHING named `exports`: the only `exports` it knows is
      // `relType === "exports"`, a relationship. So every declaration this analyzer
      // listed as an export of the schema reached no graph, no `bb_graph`, no
      // `bb_impact` — and `exports` is one of the ten ontology types, so the graph
      // had no way to answer "what does this schema offer a client". 19 sibling
      // analyzers publish it as an edge; this is that same move, and it is the reason
      // the json lane stopped ruling `exports` on a grammar inventory (a Node manifest
      // writes `exports` as an ordinary object key, which no grammar can see).
      //
      // The SOURCE is the file, spelled the way the store expects: `metadata.fileLevel`
      // is the M60/#910 contract for a module-level edge whose source is the importing
      // FILE rather than a symbol, and the store rewrites `source_external` to the
      // project-relative path on exactly that flag. `zig` spells the same source
      // `"(file)"`; nothing here claims a symbol that the file does not contain.
      addRelationship("(file)", s.name, ASTEngine.RelationshipType.Exports, s.range.startLine, "exports", {
        fileLevel: true,
        ...(s.metadata?.graphqlType ? { graphqlType: s.metadata.graphqlType } : {}),
        ...(s.metadata?.graphqlCategory ? { graphqlCategory: s.metadata.graphqlCategory } : {}),
      })
    }

    return {
      language: "graphql",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "GraphQL",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
        documentKind: this.documentKind(rootNode),
      },
    }
  }

  // ---------------------------------------------------------------- helpers

  private documentKind(rootNode: Node): "type_system" | "executable" | "mixed" | "empty" {
    let hasTypeSystem = false
    let hasExecutable = false
    for (const def of this.topLevelDefinitions(rootNode)) {
      const inner = this.innermostNamed(def)
      if (!inner) continue
      if (this.typeOf(inner) === "OperationDefinition" || this.typeOf(inner) === "FragmentDefinition") hasExecutable = true
      else hasTypeSystem = true
    }
    if (hasTypeSystem && hasExecutable) return "mixed"
    if (hasTypeSystem) return "type_system"
    if (hasExecutable) return "executable"
    return "empty"
  }

  /**
   * The document's top-level declarations: for each `Definition`, the innermost
   * named child, which is the actual construct. Cheap (one level of the tree)
   * and it is the only place a type can be DECLARED, so it is exactly the set
   * an extension has to be compared against.
   */
  private topLevelDeclarations(rootNode: Node): Array<{ name?: string; symbolKind: ASTEngine.SymbolKind; typeNode: string }> {
    const out: Array<{ name?: string; symbolKind: ASTEngine.SymbolKind; typeNode: string }> = []
    for (const def of this.topLevelDefinitions(rootNode)) {
      const inner = this.innermostNamed(def)
      if (!inner) continue
      const typeNode = inner.type
      if (typeNode === "SchemaDefinition") {
        out.push({ name: "schema", symbolKind: ASTEngine.SymbolKind.Namespace, typeNode })
        continue
      }
      if (typeNode === "DirectiveDefinition") {
        const n = this.nameOf(inner)
        if (n) out.push({ name: `@${n}`, symbolKind: ASTEngine.SymbolKind.Function, typeNode })
        continue
      }
      if (typeNode.endsWith("Extension")) continue // an extension never declares
      const kind = this.definitionKindOf(typeNode)
      if (!kind) continue
      const n = this.nameOf(inner)
      if (n) out.push({ name: n, symbolKind: kind, typeNode })
    }
    return out
  }

  /**
   * The top-level type EXTENSIONS of a document, with the kind of the definition
   * each one extends. Computed in the pre-pass, beside `topLevelDeclarations`,
   * because both answers come from the same one-level walk and computing either
   * on demand meant re-walking every definition per question.
   */
  private topLevelExtensions(rootNode: Node): Array<{ name: string; symbolKind: string }> {
    const out: Array<{ name: string; symbolKind: string }> = []
    for (const def of this.topLevelDefinitions(rootNode)) {
      const inner = this.innermostNamed(def)
      if (!inner || !inner.type.endsWith("Extension")) continue
      if (this.typeOf(inner) === "SchemaExtension") {
        out.push({ name: "schema", symbolKind: ASTEngine.SymbolKind.Namespace })
        continue
      }
      const definitionType = EXTENSION_TO_DEFINITION[inner.type]
      const kind = definitionType ? this.definitionKindOf(definitionType) : undefined
      const n = this.nameOf(inner)
      if (kind && n) out.push({ name: n, symbolKind: kind })
    }
    return out
  }

  private definitionKindOf(typeNode: string): ASTEngine.SymbolKind | undefined {
    switch (typeNode) {
      case "ObjectTypeDefinition":
      case "InputObjectTypeDefinition":
        return ASTEngine.SymbolKind.Class
      case "InterfaceTypeDefinition":
        return ASTEngine.SymbolKind.Interface
      case "UnionTypeDefinition":
      case "ScalarTypeDefinition":
        return ASTEngine.SymbolKind.Type
      case "EnumTypeDefinition":
        return ASTEngine.SymbolKind.Enum
      default:
        return undefined
    }
  }

  /**
   * The rule that classifies a top-level definition, reached by unwrapping the
   * grammar's pass-through rules.
   *
   * The WRAPPER SET IS EXPLICIT. "Descend while there is exactly one named
   * child" is not the same rule and is wrong: a shorthand operation is
   * `Definition > ExecutableDefinition > OperationDefinition > SelectionSet >
   * Selection > Field > Name`, and an unconditional descent returns `Name` — so
   * `{ ping }` was classified as a type-system definition and every file's
   * `documentKind` was wrong. A `schema` block hit the same descent
   * (`… > SchemaDefinition > OperationTypeDefinition > NamedType > Name`).
   */
  private static readonly DEFINITION_WRAPPERS = new Set([
    "Document",
    "Definition",
    "ExecutableDefinition",
    "TypeSystemDefinition",
    "TypeSystemExtension",
    "TypeDefinition",
    "TypeExtension",
  ])

  private innermostNamed(node: Node): Node | null {
    let cur: Node = node
    for (;;) {
      if (!RealGraphqlAnalyzer.DEFINITION_WRAPPERS.has(this.typeOf(cur))) return cur
      const next = this.onlyNamedChild(cur)
      if (!next) return cur
      cur = next
    }
  }

  private onlyNamedChild(node: Node | null): Node | null {
    if (!node) return null
    const kids = node.namedChildren
    if (kids.length !== 1) return null
    return kids[0]
  }

  /**
   * The document's `Definition` children. The tree is
   * `source_file > Document > Definition`, so the root is NOT the document —
   * reading `Definition` straight off `source_file` finds nothing, which is how
   * the extension de-duplication silently became a no-op and every
   * `extend type X` in a file that also declared `X` published a SECOND `class
   * X` (a duplicate identity in the index).
   */
  private topLevelDefinitions(rootNode: Node): Node[] {
    if (this.typeOf(rootNode) === "Definition") return [rootNode]
    if (this.typeOf(rootNode) === "Document") return this.childrenOfType(rootNode, "Definition")
    const document = this.firstChildOfType(rootNode, "Document")
    if (document) return this.childrenOfType(document, "Definition")
    return this.childrenOfType(rootNode, "Definition")
  }

  private childrenOfType(node: Node, type: string): Node[] {
    const out: Node[] = []
    for (const c of node.namedChildren) {
      if (c && this.typeOf(c) === type) out.push(c)
    }
    return out
  }

  private emitTypeSymbol(
    node: Node,
    name: string,
    kind: ASTEngine.SymbolKind,
    typeNode: string,
    symbols: ASTEngine.UniversalSymbol[],
    _relationships: ASTEngine.UniversalRelationship[],
    _sel: unknown,
    _inExtension: boolean,
    /** the caller's ALREADY-MEMOISED `Directives` scan, so this is not a second one */
    directives: DirectiveApplication[] | null,
  ): void {
    symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      scope: "",
      visibility: "public",
      docstring: this.descriptionOf(node),
      metadata: {
        // `graphqlType` is the GRAMMAR's node type, on every branch of this
        // analyzer, so a consumer can match on it; `graphqlCategory` is the
        // specification's word for the same thing. They used to be one field
        // with two possible vocabularies, which silently emptied `exports`.
        graphqlType: typeNode,
        topLevel: true,
        graphqlCategory:
          typeNode === "UnionTypeDefinition"
            ? "union"
            : typeNode === "ScalarTypeDefinition"
              ? "scalar"
              : typeNode === "EnumTypeDefinition"
                ? "enum"
                : typeNode === "InputObjectTypeDefinition"
                  ? "input"
                  : typeNode === "InterfaceTypeDefinition"
                    ? "interface"
                    : "object",
        ...this.directiveMetadata(directives),
      },
    })
  }

  /**
   * A directive applied to a declaration is metadata ON that declaration, and —
   * when the directive is defined in this file — a real reference to the
   * `@directive` function symbol. Federation schemas (`@key(fields: "id")`,
   * `@external`, `@requires`) carry their meaning almost entirely in these
   * applications, so dropping them drops the schema's structure.
   */
  private emitDirectiveApplications(
    _node: Node,
    applications: DirectiveApplication[] | null,
    owner: string,
    sel: { root?: string },
    addRelationship: (source: string, target: string, type: ASTEngine.RelationshipType, line: number, role: string, metadata?: Record<string, any>) => void,
    inExtension: boolean,
  ): void {
    if (!owner || !applications) return
    for (const app of applications) {
      addRelationship(owner, `@${app.name}`, ASTEngine.RelationshipType.Uses, app.line, "directive_application", {
        ...(app.arguments ? { arguments: app.arguments } : {}),
        ...(sel.root && sel.root !== owner ? { within: sel.root } : {}),
        ...(inExtension ? { extension: true } : {}),
      })
      // `@auth(role: RED)` — a directive argument may name an enum member, and
      // that is a reference. The directive's own declaration may be in another
      // file, so exactly as with an executable field argument the member is named
      // BARE and the store's unique-name strategy decides it. Naming a type here
      // would be a fabrication.
      const dnode = DIRECTIVE_NODE.get(app)
      const dargs = dnode ? this.firstChildOfType(dnode, "Arguments") : null
      if (dargs) {
        for (const arg of this.childrenOfType(dargs, "Argument")) {
          this.emitEnumValueReferences(owner, this.firstChildOfType(arg, "Value"), undefined, addRelationship, {
            declaration: "directive_argument",
            directive: `@${app.name}`,
          })
        }
      }
    }
  }

  /**
   * The `Directives` scan itself: the `Directives` child of a definition, as
   * structured metadata. A directive argument is a CONSTANT in GraphQL (the
   * specification forbids variables there), so the `Value` node's own text is the
   * literal's exact source spelling — no unquoting, no guessing, no regular
   * expression. Called ONCE per node; the walk memoises it in a WeakMap, because
   * this scan is the analyzer's single most expensive operation.
   */
  private scanDirectiveApplications(node: Node): DirectiveApplication[] | null {
    const directives = this.firstChildOfType(node, "Directives")
    if (!directives) return null
    const list: Array<{ name: string; arguments?: Record<string, string>; line: number }> = []
    for (const d of this.childrenOfType(directives, "Directive")) {
      const nameNode = this.firstChildOfType(d, "Name")
      if (!nameNode) continue
      const argsNode = this.firstChildOfType(d, "Arguments")
      const args: Record<string, string> = {}
      if (argsNode) {
        for (const a of this.childrenOfType(argsNode, "Argument")) {
          const argName = this.nameOf(a)
          const value = this.firstChildOfType(a, "Value")
          if (argName && value) args[argName] = value.text
        }
      }
      list.push({ name: nameNode.text, ...(Object.keys(args).length ? { arguments: args } : {}), line: this.lineOf(nameNode) })
      DIRECTIVE_NODE.set(list[list.length - 1], d)
    }
    return list.length ? list : null
  }

  /** The memoised scan's result, as symbol metadata; `{}` when there is none. */
  private directiveMetadata(applications: DirectiveApplication[] | null): { graphqlDirectives?: DirectiveApplication[] } {
    // The "no directives" result is SHARED, not allocated per call. It is spread
    // into a fresh object at each of its seven use sites, so it is never
    // mutated, and the profile's second-largest cost after the accessor layer
    // was the garbage collector at 9.4% — a throwaway `{}` per symbol and per
    // relationship is exactly the kind of churn it charges for.
    return applications ? { graphqlDirectives: applications } : RealGraphqlAnalyzer.NO_DIRECTIVE_METADATA
  }

  /** Frozen so a future in-place write fails loudly instead of corrupting every symbol. */
  private static readonly NO_DIRECTIVE_METADATA: { graphqlDirectives?: DirectiveApplication[] } = Object.freeze({})

  /**
   * `on A | B | C` — the same left-recursion shape as `implements`, so the
   * locations are collected from the whole subtree, not from direct children.
   */
  private collectDirectiveLocations(node: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    // Iterative for the same reason as `collectNamedTypes`: `on A | B | C` nests
    // once per clause, and a 20,000-clause location list exhausted the stack.
    const stack: Node[] = [node]
    while (stack.length) {
      const n = stack.pop()!
      if (this.typeOf(n) === "DirectiveLocation") {
        const inner = this.findChild(n, (c) => this.typeOf(c) === "ExecutableDirectiveLocation" || this.typeOf(c) === "TypeSystemDirectiveLocation")
        const leaf = inner ? (inner.namedChild(0) ?? inner) : n
        out.push({ name: leaf.text, node: leaf })
        continue
      }
      const kids = n.namedChildren
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i]
        if (c) stack.push(c)
      }
    }
    return out
  }

  /**
   * Every `NamedType` in a subtree, in source order and deduplicated.
   *
   * `ImplementsInterfaces` and `UnionMemberTypes` are left-recursive, so
   * `implements A & B & C` produces `I > I > I` in a tree-sitter build that
   * keeps the nesting, and a flat `I > [implements, A, &, B, &, C]` in one that
   * inlines the auxiliary repeat. Reading only DIRECT children — which is what
   * this analyzer used to do — therefore loses every implemented interface but
   * the last, and every union member but the last, on any grammar that nests.
   * Walking the subtree is correct for both shapes.
   */
  private collectNamedTypes(node: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const seen = new Set<string>()
    // Iterative for the same reason as `findDescendant`: `ImplementsInterfaces` and
    // `UnionMemberTypes` are LEFT-recursive, so the tree nests once per clause and a
    // 20,000-clause chain exhausted the stack. Children are pushed in reverse so
    // they pop in order, preserving the pre-order the recursion produced.
    const stack: Node[] = [node]
    while (stack.length) {
      const n = stack.pop()!
      if (this.typeOf(n) === "NamedType") {
        const name = this.nameOf(n)
        if (name && !seen.has(name)) {
          seen.add(name)
          out.push({ name, node: n })
        }
        continue
      }
      const kids = n.namedChildren
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i]
        if (c) stack.push(c)
      }
    }
    return out
  }

  private namedTypeNode(typeNode: Node): Node | null {
    return this.findDescendant(typeNode, (n) => this.typeOf(n) === "NamedType")
  }

  /** Resolve a `Type`/`TypeCondition` node to its base named type name. */
  private namedTypeName(typeNode: Node): string | undefined {
    const named = this.namedTypeNode(typeNode)
    return named ? this.nameOf(named) : undefined
  }

  /**
   * Non-null-ness read off the grammar, not off the text. `typeNode.text`
   * containing `!` was the previous implementation; a type NAME may legally
   * contain `!` nowhere, but a future grammar could wrap the marker, and the
   * `NonNullType` node is the fact.
   */
  private isNonNullType(typeNode: Node): boolean {
    const first = typeNode.namedChild(0)
    return first?.type === "NonNullType"
  }

  /** The `Value` of a `DefaultValue` child, as its exact source spelling. */
  private defaultValueOf(node: Node): string | undefined {
    const dv = this.firstChildOfType(node, "DefaultValue")
    if (!dv) return undefined
    const value = this.firstChildOfType(dv, "Value")
    return value?.text
  }

  /**
   * Every `EnumValue` in a VALUE position — a reference — with its line.
   *
   * The grammar puts an `EnumValue` node in two different places, and conflating
   * them is the whole bug: `EnumValueDefinition > EnumValue` is a DECLARATION
   * (already a symbol, with a `contains` edge from its enum), while
   * `Value > EnumValue` is a REFERENCE to one. Only the second is a relationship,
   * and the test is the parent, never the node type alone. Values nest
   * (`ListValue > Value`, `ObjectField > Value`), so this descends rather than
   * looking at direct children.
   */
  private enumValueReferences(valueNode: Node | null | undefined): Array<{ name: string; line: number }> {
    const out: Array<{ name: string; line: number }> = []
    if (!valueNode) return out
    // Iterative for the same reason as `findDescendant`: this walks a whole `Value`
    // subtree, and a value nested thousands of levels deep would exhaust the stack.
    // A matched `EnumValue` is still a leaf here — `continue`, not `return`, because
    // the walk is a loop now and returning would abandon the rest of the subtree.
    const stack: Node[] = [valueNode]
    while (stack.length) {
      const n = stack.pop()!
      if (this.typeOf(n) === "EnumValue" && n.parent?.type === "Value") {
        const name = this.nameOf(n)
        if (name) out.push({ name, line: this.lineOf(n) })
        continue
      }
      const kids = n.namedChildren
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i]
        if (c) stack.push(c)
      }
    }
    return out
  }

  /**
   * Emit `uses` edges for the enum values a value position names.
   *
   * `enumType` is supplied ONLY where the document itself states which enum the
   * value belongs to — an `InputValueDefinition` or `VariableDefinition` carries
   * its own `Type` sibling, so `color: Color = RED` proves `RED` is `Color.RED`.
   * An executable field argument does not: `item(filter: { color: RED })` names
   * the INPUT OBJECT, and reaching `Color` would need that object's declaration,
   * which is in another file. So there the target stays the bare member name and
   * the store's own unique-name strategy decides it — the same rule the analyzer
   * already applies to a field selection.
   */
  private emitEnumValueReferences(
    source: string,
    valueNode: Node | null | undefined,
    enumType: string | undefined,
    addRelationship: (source: string, target: string, type: ASTEngine.RelationshipType, line: number, role: string, metadata?: Record<string, any>) => void,
    metadata: Record<string, any> = {},
  ): void {
    if (!source) return
    for (const ref of this.enumValueReferences(valueNode)) {
      const target = enumType ? `${enumType}.${ref.name}` : ref.name
      addRelationship(source, target, ASTEngine.RelationshipType.Uses, ref.line, "enum_value_reference", { ...metadata, ...(enumType ? { enumType } : {}) })
    }
  }

  private argumentNames(argsNode: Node): string[] {
    return this.childrenOfType(argsNode, "Argument")
      .map((a) => this.nameOf(a))
      .filter((n): n is string => !!n)
  }

  private argumentPairs(argsNode: Node): Array<{ name?: string; type?: string; typeNode?: Node; defaultNode?: Node }> {
    const pairs: Array<{ name?: string; type?: string; typeNode?: Node; defaultNode?: Node }> = []
    for (const arg of this.childrenOfType(argsNode, "InputValueDefinition")) {
      const typeNode = this.firstChildOfType(arg, "Type")
      pairs.push({
        name: this.nameOf(arg),
        type: typeNode ? this.namedTypeName(typeNode) : undefined,
        typeNode: typeNode ?? undefined,
        defaultNode: this.firstChildOfType(arg, "DefaultValue") ?? undefined,
      })
    }
    return pairs
  }

  /**
   * An argument's `isOptional` is GraphQL's own rule, not a guess from the
   * `!`: a NON-NULL argument is required; a NULLABLE argument is optional only
   * when it has a default. `f(x: Int)` is required, `f(x: Int = 1)` is not.
   */
  private extractArguments(argsNode: Node): ASTEngine.Parameter[] {
    const params: ASTEngine.Parameter[] = []
    for (const arg of this.childrenOfType(argsNode, "InputValueDefinition")) {
      const name = this.nameOf(arg)
      if (!name) continue
      const typeNode = this.firstChildOfType(arg, "Type")
      const defaultValue = this.defaultValueOf(arg)
      params.push({
        name,
        type: typeNode ? this.namedTypeName(typeNode) : undefined,
        defaultValue,
        // GraphQL's own rule, from §3.6.1: an argument is OPTIONAL only when it
        // is NULLABLE **and** has a default. `f(a: Int)` is required even
        // though `Int` is nullable, because a caller must pass something;
        // `f(a: Int = 1)` is not. The previous implementation asked only
        // `!typeNode.text.includes("!")`, so it reported both nullable shapes
        // as optional and inverted the one distinction GraphQL makes.
        isOptional: typeNode ? !this.isNonNullType(typeNode) && defaultValue !== undefined : true,
      })
    }
    return params
  }

  // ------------------------------------------------------------- descriptions

  /**
   * The description's VALUE, per specification §2.9.4.
   *
   * A `"…"` string is unquoted and its `EscapedCharacter` sequences are resolved
   * by an explicit character scan — `\" \\ \/ \b \f \n \r \t \uXXXX` and
   * `\\u{…}` — because the previous implementation returned the raw inner text
   * with the backslashes still in it, so `"a \"quote\""` was published as
   * `a \"quote\"`.
   *
   * A `"""…"""` block string is dedented as the specification defines: split on
   * line terminators, take the common indent of every line after the first that
   * has non-whitespace content, strip it, and drop leading and trailing blank
   * lines. Then `\"""` becomes `"""`.
   */
  private descriptionOf(node: Node): string | undefined {
    const desc = this.firstChildOfType(node, "Description")
    if (!desc) return undefined
    const sv = this.firstChildOfType(desc, "StringValue")
    if (!sv) return undefined
    const raw = sv.text
    if (raw.length >= 6 && raw.startsWith('"""') && raw.endsWith('"""')) {
      return this.blockStringValue(raw.slice(3, raw.length - 3))
    }
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      return this.unescapeStringValue(raw.slice(1, raw.length - 1))
    }
    return raw
  }

  /** §2.9.4 BlockStringValue: the common-indent algorithm, then the escape. */
  private blockStringValue(inner: string): string {
    const lines = inner.split("\n")
    let common: number | undefined
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      let indent = 0
      while (indent < line.length && (line[indent] === " " || line[indent] === "\t")) indent++
      if (indent === line.length) continue // blank line: does not constrain
      common = common === undefined ? indent : Math.min(common, indent)
    }
    if (common !== undefined && common > 0) {
      for (let i = 1; i < lines.length; i++) lines[i] = lines[i].slice(common)
    }
    while (lines.length > 0 && lines[0].trim() === "") lines.shift()
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
    return lines.join("\n").replaceAll('\\"""', '"""')
  }

  /** §2.9.4 EscapedCharacter, resolved by scanning — no regular expression. */
  private unescapeStringValue(inner: string): string {
    let out = ""
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]
      if (ch !== "\\") {
        out += ch
        continue
      }
      const next = inner[++i]
      switch (next) {
        case "b":
          out += "\b"
          break
        case "f":
          out += "\f"
          break
        case "n":
          out += "\n"
          break
        case "r":
          out += "\r"
          break
        case "t":
          out += "\t"
          break
        case "u": {
          if (inner[i + 1] === "{") {
            const close = inner.indexOf("}", i + 2)
            if (close > 0) {
              const code = Number.parseInt(inner.slice(i + 2, close), 16)
              if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
                out += String.fromCodePoint(code)
                i = close
                break
              }
            }
            out += "\\u"
            break
          }
          const hex = inner.slice(i + 1, i + 5)
          const code = Number.parseInt(hex, 16)
          if (hex.length === 4 && Number.isFinite(code)) {
            out += String.fromCharCode(code)
            i += 4
          } else {
            out += "\\u"
          }
          break
        }
        case undefined:
          out += "\\"
          break
        default:
          // `\" \\ \/` and anything else: the escaped character itself.
          out += next
          break
      }
    }
    return out
  }

  // -------------------------------------------------------------------- ranges

  /**
   * 1-based line and column, byte offsets, and a leading `Description` skipped.
   *
   * The `Description` is a child of the definition node in this grammar, so a
   * naive `nodeToRange` reports the DOCSTRING's line for every described type,
   * field, argument, enum value and input field. On the GitHub public schema
   * that is 3,131 of 3,332 symbols — 94 % of the file's symbols pointing at a
   * line that does not contain the name they are named for. The M59/#861 rule
   * (a decorated declaration's line belongs to the name, not to its decorator)
   * is the same defect with a different decorator, and scala
   * (`declaration-lines-825`), typescript and javascript already implement it.
   */
  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    // The range starts at the definition's FIRST TOKEN, with a leading
    // `Description` excluded. One rule, no per-construct exceptions, and the
    // range always contains the symbol's own name — which a Name-anchored rule
    // did NOT: `directive @auth` writes `@` and `auth` as two tokens, and the
    // `schema` namespace's first `Name` descendant lives inside a root
    // operation type, so anchoring on a `Name` put the namespace's range on
    // `schema { query: Query`'s `Query` and left it containing neither "schema"
    // nor its own name.
    let anchor: Node = node
    const firstChild = node.child(0)
    if (firstChild && this.typeOf(firstChild) === "Description") {
      const afterDescription = node.child(1)
      if (afterDescription) anchor = afterDescription
    }
    return {
      startLine: anchor.startPosition.row + 1,
      startColumn: anchor.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: anchor.startIndex,
      endIndex: node.endIndex,
    }
  }

  private lineOf(node: Node | null): number {
    return node ? node.startPosition.row + 1 : 0
  }

  // ------------------------------------------------------------ node plumbing

  /** The definition's own name: its direct `Name` child, or a wrapper's. */
  private nameOf(node: Node): string | undefined {
    return this.firstChildOfType(node, "Name")?.text
  }

  /**
   * Is there a child matching `predicate`, ANONYMOUS children included?
   *
   * `findChild` walks `namedChild`, and `repeatable` is an anonymous keyword
   * token in this grammar, so `directive @a repeatable on FIELD` reported
   * `repeatable: false` — the specification's June-2018 feature was invisible
   * on every directive that used it.
   */
  private hasChild(node: Node, predicate: (n: Node) => boolean): boolean {
    // ALL children here, named and anonymous: `repeatable` is an anonymous
    // keyword token, so a named-only walk cannot see it.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) return true
    }
    return false
  }

  private isAnyOf(node: Node, ...types: string[]): boolean {
    return types.includes(this.typeOf(node))
  }

  /**
   * A node's NAMED children, in ONE wasm call.
   *
   * web-tree-sitter documents `namedChild(index)` as *"fairly fast, but its cost
   * is technically log(n), so if you might be iterating over a long list of
   * children, you should use Node#namedChildren instead"*, and that getter
   * materialises the whole list in a single call and CACHES it on the node. A
   * `namedChildCount` + `namedChild(i)` loop is therefore the O(n log n)
   * anti-pattern, and it was the one this analyzer used in nine places.
   *
   * The CPU profile of the 20,368-line GitHub public schema said so before this
   * change: the tree-sitter accessor layer — `setValue`, `getValue`,
   * `ts_node_named_child_wasm`, `ts_node_named_child_count_wasm`,
   * `get namedChildCount` — was over 11% of self time, and `pushChildren`, which
   * runs once per node, was its largest caller. The binding's own `children` /
   * `namedChildren` getters also replace a per-child `unmarshalNode` with one
   * bulk transfer, so this is fewer wasm round-trips as well as less arithmetic.
   *
   * The returned array is the BINDING'S OWN CACHE. It is read, never written.
   */
  private namedChildrenOf(node: Node): readonly (Node | null)[] {
    return node.namedChildren
  }

  /**
   * The first NAMED child of `type`, or null — with no closure and no per-index
   * wasm call.
   *
   * `findChild(node, n => this.typeOf(n) === "X")` is the idiomatic spelling and it was
   * used 40 times here, so it allocated 40 closures PER SYMBOL and reached `.type`
   * through a call frame for every child it examined. The comparison is a string
   * equality; the closure buys nothing. This is the same shape the SQL analyzer
   * uses for its own direct-child reads, and it is the shape the profile asked
   * for: `analyze` self time was 6.1% and the tree-sitter accessor layer was
   * another ~9%, and both are dominated by the NUMBER of property reads rather
   * than by any algorithm of ours.
   */
  private firstChildOfType(node: Node | null, type: string): Node | null {
    if (!node) return null
    for (const child of node.namedChildren) {
      if (child !== null && this.typeOf(child) === type) return child
    }
    return null
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (const child of node.namedChildren) {
      if (child && predicate(child)) return child
    }
    return null
  }

  /**
   * The first descendant satisfying `predicate`, in pre-order.
   *
   * ITERATIVE, and the recursion was a real defect rather than a style choice. This
   * walks to the depth of the subtree when the predicate does not match early, and
   * `[[[…[Int]]]]` is exactly that case: the `NamedType` sits at the BOTTOM, so the
   * recursion went as deep as the nesting. Measured, list nesting **2,749 deep
   * threw `RangeError: Maximum call stack size exceeded`**, and because the engine's
   * guard turns any throw into a minimal result, that file yielded ZERO symbols and
   * one opaque error — silently losing a whole type definition. The threshold is a
   * function of stack-frame size, so it is a platform figure, not a guarantee.
   *
   * `A & B & C` was never affected, which is why the bug survived the corpus: the
   * left-recursive rules put a `NamedType` at depth 1, so the predicate matched
   * immediately and the recursion never went deep. 5,000 clauses still work.
   *
   * Children are pushed in reverse so they POP in order, which keeps this a
   * pre-order DFS with first-match-wins — the same order, and the same result, as
   * the recursion it replaces.
   */
  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    const stack: Node[] = []
    const rootKids = node.namedChildren
    for (let i = rootKids.length - 1; i >= 0; i--) {
      const c = rootKids[i]
      if (c) stack.push(c)
    }
    while (stack.length) {
      const n = stack.pop()!
      if (predicate(n)) return n
      const kids = n.namedChildren
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i]
        if (c) stack.push(c)
      }
    }
    return null
  }
}
