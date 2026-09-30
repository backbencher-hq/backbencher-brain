// Pure-AST F# analyzer — M12 per-analyzer perfection contract.
//
// Emits exactly the M12 differential contract (mirroring the C# family):
//   Symbols: namespace, module, class, interface, enum, enum_member,
//            property, method, function, constructor (named "constructor").
//            NO locals, NO lambda params, NO synthetic members.
//   Relationships: contains, extends, implements, calls (source = enclosing
//            function/method/constructor, target = leaf name), instantiates,
//            overrides (qualified Owner.method -> Parent.method), references
//            (open -> module paths). NO uses (C# family emits none).
//
// Pure AST: no regex on source text; override/default/member keywords are read
// from tree-sitter token nodes. Builtins (console output, Object leaf methods)
// are filtered like the C# family.
import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// F# console output + .NET Console — filtered like C#'s Console.WriteLine.
// NOTE: sprintf/sprintfn are string formatting (analog of string.Format),
// which the C# family KEEPS (e.g. calls:CompareTo:Compare). Only console
// output and Object leaf methods are filtered.
const FSHARP_CONSOLE_BUILTINS = new Set([
  "printfn", "printf", "eprintfn", "eprintf", "fprintfn", "fprintf",
  "Console.WriteLine", "Console.Write", "Console.Error.WriteLine", "Console.Error.Write",
])
const OBJECT_LEAF_METHODS = new Set(["ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals"])

/**
 * Every grammar node that WRAPS a written type in F#. The name is always inside one of
 * these; the POSITION is decided by the wrapper's parent. Read off the wired grammar
 * (script/m14/tmp/fs001-shape-census.ts over 400 real files) and from
 * `grammars/tree-sitter-fsharp/fsharp/grammar.js` — the list is F1-audited against the
 * wasm, so a grammar rename shows up as an unknown node type rather than as a silent 0.
 */
/** The three node kinds that can own a declaration, as a named test rather than a closure. */
const isCallableOwnerNode = (n: Node): boolean =>
  n.type === "member_defn" || n.type === "function_or_value_defn" || n.type === "additional_constr_defn"

const TYPE_WRAPPER_NODES = new Set([
  "simple_type", "postfix_type", "paren_type", "generic_type", "function_type",
  "compound_type", "list_type", "atomic_type", "nullable_type", "struct_type",
  "static_type", "byref_type", "flexible_type", "types",
])


export class RealFsharpAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    /**
     * The names this run has PUBLISHED as symbols, maintained as they are pushed.
     *
     * This is the invariant every relationship's SOURCE must satisfy, and it is the one the
     * structural rules kept getting wrong in both directions. A guard that refuses whenever a
     * declaration is nested refuses `isAttribute -> FSharpEntity`, where the binding is a
     * local inside an active pattern and IS published as a function; a guard that does not
     * refuse publishes `argInfo -> ArgReprInfo`, where the binding is a local and is NOT
     * published. Neither defect is visible downstream, because one edge resolves to a
     * perfectly good symbol and the other resolves to nothing, and a graph consumer has no way
     * to tell those apart from the shape of the edge alone.
     *
     * Membership is exact because a declaration's symbol is pushed when the walk visits the
     * declaration, and the declared-type emission happens while walking its SUBTREE — so by
     * the time a name is tested, the walk has already published it if it publishes it at all.
     */
    const publishedNames = new Set<string>()
    const publish = (s: ASTEngine.UniversalSymbol): void => {
      if (s?.name) publishedNames.add(s.name)
      symbols.push(s)
    }

    // M59.A7 dim 8 (the haskell precedent): every relationship carries the line
    // of the node that BEARS it, dedup-keyed WITH that line so two same-shape
    // sites on different lines are two facts. `line_number` is payload, never
    // identity (M12 identity is file:type:sourceId:targetId).
    const seenRels = new Set<string>()
    const pushRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, any> = {},
      line?: number,
    ) => {
      const hasLine = typeof line === "number" && Number.isInteger(line) && line > 0
      const key = `${source}|${type}|${target}|${hasLine ? line : ""}`
      if (seenRels.has(key)) return
      seenRels.add(key)
      relationships.push({
        source,
        target,
        type,
        confidence,
        metadata,
        ...(hasLine ? { line_number: line as number } : {}),
      })
    }
    /** 1-based line of a node, or undefined — never 0 (M59.O2). */
    const lineOf = (node: Node | null | undefined): number | undefined => {
      if (!node) return undefined
      const line = node.startPosition.row + 1
      return line > 0 ? line : undefined
    }

    // Per-type abstract member names — used to dedup abstract+default pairs
    // (F# `abstract member X` + `default _.X()` is ONE logical member).
    const abstractMemberNames = new Set<string>()
    // baseType per type name (from `inherit Base()`) — for qualified overrides.
    const baseTypes = new Map<string, string>()

    // FS-D2: every type name this file DECLARES with a real `type X = …` body — i.e.
    // NOT by `type X with …`. An extension is not a declaration: F#'s `type X with` is
    // the language's only way to add members to a type declared elsewhere, so
    // counting it as a declaration would let two extensions of an undeclared type mint
    // it twice, and would let an extension that PRECEDES its own `type X = …` (4 of
    // the corpus's 68 extensions do) suppress the real declaration. Collected up front
    // so the rule is order-independent.
    const typeNamesDeclaredInFile = this.collectDeclaredTypeNames(rootNode)
    // FS-D17: the scope a FILE declares, read before the walk rather than during it.
    const fileScope = this.collectFileScope(rootNode)
    // FS-D2: which names a `type X with …` has ALREADY published as the file's own
    // declaration. Scoped to extensions on purpose — a general one-symbol-per-name set
    // would collapse an F# SIGNATURE file's forward declaration into its definition,
    // which script/m14/tmp/fs018-compare-dumps.ts reported as 30 dropped symbols
    // across 15 corpus files before the rule shipped.
    const typeExtensionsPublished = new Set<string>()

    // FS-D8: the names the EXPORT rule needs, filled while the walk visits them, so
    // the export pass costs no second traversal. A MODULE's members are importable by
    // `open`; a TYPE's are not — that asymmetry IS the exports-family ruling the
    // fixture runner's invariant states.
    const moduleNames = new Set<string>()
    const namespaceNames = new Set<string>()

    interface WalkFrame {
      node: Node
      scopePath: string[]
      callOwner: string | undefined // nearest enclosing function/method/constructor
      bodyDepth: number // >0 => inside a function/member body (locals live here)
    }
    const walkStack: WalkFrame[] = [{ node: rootNode, scopePath: [], callOwner: undefined, bodyDepth: 0 }]

    while (walkStack.length > 0) {
      const { node, scopePath, callOwner, bodyDepth } = walkStack.pop()!
      const type = node.type

      // FS-D15 + FS-D16. A parse-recovery region is a fact about the PARSER, not about
      // the program, and this analyzer was doing two wrong things with one.
      //
      // It mined them. Inside an `ERROR` node the grammar hands back a recovery
      // artifact, and this walk reads that artifact as if it were code: in
      // fsharp/src/Compiler/Interactive/fsi.fsi the recovery for a malformed
      // `type IEventLoop =` produced a chain of `typecast_expression` ending in an
      // `application_expression`, and the analyzer published
      // `calls GetDefaultConfiguration -> abstract`, `-> member` and `-> Sealed` — the
      // language keywords and an attribute name, called by a symbol that appears
      // nowhere near them. Fabrication is the worst class there is, because it is
      // indistinguishable from a real edge to a consumer.
      //
      // And it never said so. `errors` was declared on line 48 and returned on line 937
      // and never pushed to, so the analyzer's own contract — "syntax errors: ERROR/
      // MISSING nodes pushed as warning ParseError (never silently dropped)" — had been
      // a claim in the docs with no code behind it. The region that produced those three
      // fabricated calls was reported NOWHERE.
      //
      // Both are fixed by the same two lines, and they are one decision rather than two:
      // a recovery region is DISCLOSED and not MINED. Disclosing it means the caller can
      // see exactly which spans to distrust, which is strictly more information than the
      // fabricated edges ever were, and it makes the grammar gaps the lane already knows
      // about (`member val`, `not null` — 6/400 files collapsing to a root ERROR)
      // visible in the result instead of only in a probe. Suppressing the edges is the
      // part that costs something, and the cost is measured rather than assumed: see
      // script/m14/tmp/fs031-error-region-delta.ts, which counts what the rule removes
      // before and after.
      if (type === "ERROR") {
        errors.push({
          message: "parse recovery region: the tree here is the parser's reconstruction, not the source",
          range: { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column },
          severity: "warning",
        })
        // Do NOT descend. The whole subtree is recovery, and descending would re-derive
        // the same artifact through a different node type.
        continue
      }
      if (node.isMissing) {
        errors.push({
          message: `missing ${node.type} — the parser inserted this token`,
          range: { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column },
          severity: "warning",
        })
        continue
      }

      let currentScope = [...scopePath]
      let childCallOwner = callOwner
      let childBodyDepth = bodyDepth

      if (type === "namespace" || type === "named_module" || type === "module_defn") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const name = nameNode.text
          publish({
            name,
            kind: type === "namespace" ? ASTEngine.SymbolKind.Namespace : ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
          if (type === "namespace") namespaceNames.add(name)
          else moduleNames.add(name)
          currentScope.push(name)
        }
      } else if (type === "type_definition") {
        // FS-D2: `type X with …` reaches the analyzer as a `type_definition` whose
        // ONLY body child is a `type_extension` — the grammar wraps it
        // (`_type_defn_body`'s `type_extension` arm, under `type_definition`). So the
        // duplicate is not the extension branch alone: the `type_definition` branch
        // mints the symbol, pushes the scope, and then walks INTO the extension, which
        // minted it a second time. Measured: 54 duplicate type symbols per 400 real
        // files (script/m14/tmp/fs012-self-containment.ts), every one a
        // `type_definition` + `type_extension` pair at the SAME line.
        const isExtensionBody = !!this.findChild(node, (n) => n.type === "type_extension")
        // FS-D8: a BARE `type X` (the grammar's `type_declaration`, "no body") is a
        // FORWARD DECLARATION — the surface an F# SIGNATURE file writes before the
        // definition. `type Surface` / `type Surface = member this.Real = 1` is ONE
        // entity, so the export list must name it once; both SYMBOLS stay, because
        // both are real declarations and the surface one carries the .fsi's line.
        const isForwardDeclaration = !!this.findChild(node, (n) => n.type === "type_declaration")
        // Pure AST: the clean name is type_name -> long_identifier -> identifier;
        // declared generic params are type_arguments -> type_argument_defn ->
        // type_argument (no source-text regex needed).
        const typeNameNode = this.findDescendant(node, (n) => n.type === "type_name")
        const typeInfo = typeNameNode ? this.typeInfoOf(typeNameNode) : null
        const name = typeInfo?.name ?? null
        // FS-D8: a TYPE's access modifier is written INSIDE its `type_name` (the node's
        // own text is literally `internal Tables<'Token>`), a value's or a member's on
        // the declaration. Read structurally, never from the declaration's text.
        const accessModifier = this.accessModifierOf(node, typeNameNode ?? null)
        if (name) {
          const hasAnonTypeDefn = !!this.findChild(node, (n) => n.type === "anon_type_defn")
          const hasRecordTypeDefn = this.findDescendants(node, (n) => n.type === "record_type_defn").length > 0
          const hasUnionTypeDefn = this.findDescendants(node, (n) => n.type === "union_type_defn").length > 0
          const hasInterfaceTypeDefn = this.findDescendants(node, (n) => n.type === "interface_type_defn").length > 0
          const hasEnumTypeDefn = this.findDescendants(node, (n) => n.type === "enum_type_defn").length > 0
          const hasDelegateTypeDefn = this.findDescendants(node, (n) => n.type === "delegate_type_defn").length > 0
          const hasTypeAbbrevDefn = this.findDescendants(node, (n) => n.type === "type_abbrev_defn").length > 0

          let kind = ASTEngine.SymbolKind.Class
          let isInterface = false
          // FS-D27. A UNIT OF MEASURE is a structural fact, not a substring.
          //
          // The test was `n.text.includes("Measure") || n.text.includes("[<Measure")` on any
          // `attribute` descendant — the one text read left in this analyzer, and the only
          // thing here that was not AST-derived. Two defects, and the second is worse than
          // the first:
          //
          //   1. the second clause is dead, being a substring of the first;
          //   2. `[<MeasureAnnotatedAbbreviation>]` is a DIFFERENT and perfectly ordinary F#
          //      attribute — it marks a generic abbreviation — and it CONTAINS the substring.
          //      `fsharp/src/FSharp.Core/prim-types.fs:483` writes
          //      `[<MeasureAnnotatedAbbreviation>] type float<[<Measure>] 'Measure> = float`,
          //      where the real measure marker is on the TYPE PARAMETER and the type itself
          //      is an abbreviation. The substring test cannot tell those apart, and `findDescendant`
          //      returns whichever comes first, so the abbreviation was classified as a measure.
          //
          // The name is read from the tree, and only from the attributes attached to the TYPE:
          //
          //     type_definition
          //       attributes "[<Measure>]"
          //         attribute "Measure"
          //           simple_type "Measure" -> long_identifier "Measure" -> identifier "Measure"
          //
          // An exact name match, on the `attributes` node that is a DIRECT child of the type,
          // is what the language means: `Measure` and its `MeasureAttribute` spelling name the
          // same attribute, and nothing else does. A `Measure` on a type PARAMETER is a
          // different fact about a different node and is not consulted here — the parameter
          // positions are the R9 declared-type graph's business, not the kind classifier's.
          const isMeasure = this.filterChildren(node, (n) => n.type === "attributes").some((attrs) =>
            this.findDescendants(attrs, (n) => n.type === "attribute", 3).some((attr) => {
              const nm =
                this.findDescendant(attr, (n) => n.type === "long_identifier", 3) ??
                this.findDescendant(attr, (n) => n.type === "identifier", 3)
              return nm?.text === "Measure" || nm?.text === "MeasureAttribute"
            }),
          )
          if (isMeasure) kind = ASTEngine.SymbolKind.Type
          if (hasRecordTypeDefn) {
            kind = ASTEngine.SymbolKind.Class
          } else if (hasUnionTypeDefn) {
            kind = ASTEngine.SymbolKind.Enum
          } else if (hasInterfaceTypeDefn) {
            kind = ASTEngine.SymbolKind.Interface
            isInterface = true
          } else if (hasEnumTypeDefn) {
            kind = ASTEngine.SymbolKind.Enum
          } else if (hasDelegateTypeDefn) kind = ASTEngine.SymbolKind.Type
          else if (hasTypeAbbrevDefn) kind = ASTEngine.SymbolKind.Type
          else if (hasAnonTypeDefn) {
            const anonNode = this.findChild(node, (n) => n.type === "anon_type_defn")
            if (anonNode) {
              const memberSigs = this.findDescendants(anonNode, (n) => n.type === "member_signature")
              const hasMemberSig = memberSigs.length > 0
              const hasInherits = this.findDescendants(anonNode, (n) => n.type === "class_inherits_decl").length > 0
              const hasInterfaceImpl =
                this.findDescendants(anonNode, (n) => n.type === "interface_implementation").length > 0
              const hasConcreteMembers = this.findDescendants(
                anonNode,
                (n) => n.type === "member_defn" && !this.findDescendant(n, (child) => child.type === "member_signature"),
              ).length > 0
              if (hasMemberSig && !hasInherits && !hasInterfaceImpl && !hasConcreteMembers) {
                kind = ASTEngine.SymbolKind.Interface
                isInterface = true
              }
            }
          }

          // FS-D2: the publication rule for a TYPE EXTENSION, and nothing else.
          //
          // `type X with …` is not a declaration of X — it is F#'s only way to add
          // members to a type declared elsewhere. So an extension publishes X only when
          // this file has no real `type X = …` at all (the member-only type F# also
          // allows), and never a second time.
          //
          // DELIBERATELY NOT a general one-symbol-per-name rule. An F# SIGNATURE file
          // forward-declares a type and then defines it, and the definition is the one
          // carrying the members; a blanket dedupe kept the forward declaration and
          // dropped the definition. The rule is scoped to extensions, the one place
          // the duplication is a defect.
          const isExtensionOnly =
            isExtensionBody && !typeNamesDeclaredInFile.has(name) && !typeExtensionsPublished.has(name)
          if (!isExtensionBody || isExtensionOnly) {
            publish({
              name,
              kind,
              range: this.nodeToRange(node),
              ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
              genericParameters: typeInfo?.genericParameters,
              metadata: {
                nodeType: type,
                ...(isExtensionBody ? { isTypeExtension: true } : {}),
                ...(isForwardDeclaration ? { isForwardDeclaration: true } : {}),
                ...(accessModifier ? { accessModifier } : {}),
              },
            })
          }
          if (isExtensionBody) typeExtensionsPublished.add(name)
          // The SCOPE is pushed either way: an extension's members belong to the
          // extended type whether or not this file declares it.
          currentScope.push(name)

          // Base type from `inherit Base()` — needed for qualified override targets.
          const inherits = this.findDescendants(node, (n) => n.type === "class_inherits_decl", 8)
          if (inherits.length > 0) {
            const firstInherit = inherits[0]
            const baseType = this.findDescendant(firstInherit, (n) => n.type === "long_identifier" || n.type === "identifier")
            if (baseType?.text) baseTypes.set(name, baseType.text)
          }

          if (hasRecordTypeDefn) {
            const fields = this.findDescendants(node, (n) => n.type === "record_field")
            for (const field of fields) {
              const fieldName = this.findChild(field, (n) => n.type === "identifier")
              if (!fieldName?.text) continue
              publish({
                name: fieldName.text,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(field),
                ownerName: name,
                ownerKind: kind,
                metadata: { nodeType: "record_field", isRecordField: true },
              })
            }
          }

          // Extract DU cases as EnumMember symbols
          if (kind === ASTEngine.SymbolKind.Enum) {
            const unionDefns = this.findDescendants(node, (n) => n.type === "union_type_defn")
            for (const unionDefn of unionDefns) {
              const cases = this.findDescendants(unionDefn, (n) => n.type === "union_type_case")
              for (const c of cases) {
                const caseNameNode = this.findDescendant(c, (n) => n.type === "identifier")
                if (caseNameNode && caseNameNode.text) {
                  publish({
                    name: caseNameNode.text,
                    kind: ASTEngine.SymbolKind.EnumMember,
                    range: this.nodeToRange(c),
                    ownerName: name,
                    metadata: { nodeType: "union_type_case" },
                  })
                }
              }
            }
          }

          // Extract enum cases
          const enumDefns = this.findDescendants(node, (n) => n.type === "enum_type_defn")
          for (const enumDefn of enumDefns) {
            const cases = this.findDescendants(enumDefn, (n) => n.type === "enum_type_case")
            for (const c of cases) {
              const caseNameNode = this.findDescendant(c, (n) => n.type === "identifier")
              if (caseNameNode && caseNameNode.text) {
                publish({
                  name: caseNameNode.text,
                  kind: ASTEngine.SymbolKind.EnumMember,
                  range: this.nodeToRange(c),
                  ownerName: name,
                  metadata: { nodeType: "enum_type_case" },
                })
              }
            }
          }

          // Extract interface implementations as relationships (search recursively within type)
          const ifaceImpls = this.findDescendants(node, (n) => n.type === "interface_implementation", 8)
          for (const impl of ifaceImpls) {
            const ifaceType = this.findDescendant(impl, (n) => n.type === "long_identifier" || n.type === "identifier")
            const writtenIface = ifaceType ? ifaceType.text : null
            if (writtenIface) {
              // FS-D9 (R10 spelling) — see the extends arm's note. A qualified interface
              // is written `System.IDisposable` and DECLARES `IDisposable`; the edge
              // carries the leaf so it joins to a symbol, and the qualified spelling
              // stays in `metadata.qualifiedType`.
              const leaf = writtenIface.includes(".") ? (writtenIface.split(".").pop() as string) : writtenIface
              pushRel(
                name,
                leaf,
                ASTEngine.RelationshipType.Implements,
                1.0,
                {
                  nodeType: "interface_implementation",
                  ...(leaf !== writtenIface ? { qualifiedType: writtenIface } : {}),
                },
                lineOf(ifaceType),
              )
            }
          }

          // Extract class inherits as relationships (search recursively within type)
          for (const inh of inherits) {
            const baseType = this.findDescendant(inh, (n) => n.type === "long_identifier" || n.type === "identifier")
            const writtenName = baseType ? baseType.text : null
            if (writtenName) {
              // FSD3: `inherit` is ALWAYS an extends edge. The retired rule here
              // was "the name starts with I and its second character is
              // uppercase, therefore implements" — a guess that mislabels a base
              // class named `IThing` and labels an interface by luck. F#
              // implements interfaces with `interface ... with` (handled above).
              //
              // FS-D9 (R10 spelling): the edge's TARGET is the LEAF, because that is
              // the name the lane publishes for that type as a symbol, and a consumer
              // joins edges to symbols. `inherit System.Exception()` is written with a
              // namespace and DECLARES `Exception`; the qualified spelling is kept in
              // `metadata.qualifiedType` so nothing is lost. R10 is the family rule
              // applied to ten lanes; this lane was never asked, and the lane's own
              // truth oracle derived the leaf independently, which is how the 3 sites
              // in the corpus were found.
              const leaf = writtenName.includes(".") ? (writtenName.split(".").pop() as string) : writtenName
              pushRel(
                name,
                leaf,
                ASTEngine.RelationshipType.Extends,
                1.0,
                {
                  nodeType: "class_inherits_decl",
                  ...(leaf !== writtenName ? { qualifiedType: writtenName } : {}),
                },
                lineOf(baseType),
              )
            }
          }
        }
      } else if (type === "value_declaration" || type === "function_or_value_defn" || type === "member_defn") {
        // Locals (value_declaration/function_or_value_defn nested inside a
        // function body) are NOT symbols — same contract as the C# family.
        if (bodyDepth > 0 && (type === "value_declaration" || type === "function_or_value_defn")) {
          // Still walk children so calls inside locals attribute to the
          // enclosing function (e.g. `let doubled = items |> List.map ...`).
          childCallOwner = callOwner
          childBodyDepth = bodyDepth
        } else {
          let nameNode = this.findChild(
            node,
            (n) =>
              !!n.text && (n.type === "identifier" || n.type === "long_identifier" || n.type === "identifier_pattern"),
          )
          if (!nameNode) {
            const leftNode = this.findChild(
              node,
              (n) => n.type === "function_declaration_left" || n.type === "value_declaration_left",
            )
            if (leftNode) {
              nameNode = this.findChild(leftNode, (n) => n.type === "identifier" || n.type === "identifier_pattern")
              // FS-D6: when that child is an `identifier_pattern`, its TEXT IS THE WHOLE
              // LEFT-HAND SIDE. For `let f (a: string) : string = …` the
              // `identifier_pattern` reads `f (a: string) : string` — parameters and
              // return annotation included — so taking its text published the signature
              // as the symbol's NAME. Measured: 60 such symbols per 400 real files (37
              // with a curried argument list, 23 with a generic argument in the return
              // type), none joinable by a consumer; script/m14/tmp/fs019-adjudicate-loss
              // counts the removed names by the character that disqualifies them — 57 by
              // a parameter list, 16 by a generic argument, 9 by a space, 8 otherwise.
              //
              // The declared name is the pattern's FIRST
              // `long_identifier_or_op -> long_identifier -> identifier` chain, read
              // structurally. A bare `identifier` child is left alone, which is what
              // keeps `let f a b = …` and `let inline f x = …` naming `f` as before — a
              // first draft that also redirected the `identifier` case regressed both,
              // and the A/B caught it as dropped symbols before it shipped.
              if (nameNode?.type === "identifier_pattern") {
                nameNode = this.patternNameNode(nameNode) ?? nameNode
              }
            }
          }
          // Fallback for member_defn: method_or_prop_defn → property_or_ident → identifiers
          if (!nameNode) {
            const mopNode = this.findChild(node, (n) => n.type === "method_or_prop_defn")
            if (mopNode) {
              const propNode = this.findChild(mopNode, (n) => n.type === "property_or_ident")
              if (propNode) {
                // Get the method/property name (second identifier, e.g. "this.Speak" → "Speak")
                const idents = this.filterChildren(propNode, (n) => n.type === "identifier")
                nameNode = idents.length >= 2 ? idents[idents.length - 1] : idents[0]
              }
            }
          }
          if (nameNode && nameNode.text) {
            const name = nameNode.text
            const isFunc = !!this.findChild(
              node,
              (n) =>
                n.type === "function_declaration_left" ||
                n.type === "argument_patterns" ||
                n.type === "argument_spec" ||
                n.type === "arguments_spec",
            )
            const isMember = type === "member_defn"
            const hasMethodOrProp = !!this.findChild(node, (n) => n.type === "method_or_prop_defn")
            const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined

            // abstract+default dedup: if the owner already has an abstract
            // member_signature with this name, this member_defn is the default
            // implementation of that member — skip the duplicate symbol.
            const isAbstractDefaultImpl = isMember && !!owner && abstractMemberNames.has(`${owner}:${name}`)

            if (!isAbstractDefaultImpl) {
              let kind: ASTEngine.SymbolKind
              let isProperty = false
              if (isMember && hasMethodOrProp) {
                const mopNode = this.findChild(node, (n) => n.type === "method_or_prop_defn")
                // Pure AST classification (FSD7, measured on a 120-file census
                // draw): the grammar's own `args:` FIELD decides. The retired
                // rule read named children and recognised two of the four arg
                // shapes the corpus actually uses — a single curried arg
                // (`member _.TryRangeOf pos = ...`) parses as
                // `args:identifier_pattern`, was classified a PROPERTY, and
                // dropped not just its kind but every call in its body
                // (measured: 73 of 604 members; the F5 row's MISSING class).
                if (mopNode) {
                  const argsNode = (mopNode as any).childForFieldName?.("args") ?? null
                  if (argsNode) {
                    isProperty = false
                  } else {
                    // Fallback for arg shapes the field lookup cannot see: any
                    // pattern-ish node between the name and the body.
                    let afterIdent = false
                    for (let i = 0; i < mopNode.namedChildCount; i++) {
                      const c = mopNode.namedChild(i)
                      if (!c) continue
                      if (c.type === "property_or_ident") {
                        afterIdent = true
                        continue
                      }
                      if (afterIdent) {
                        if (
                          c.type === "paren_pattern" ||
                          c.type === "argument_patterns" ||
                          c.type === "identifier_pattern" ||
                          c.type === "typed_pattern" ||
                          c.type === "wildcard_pattern" ||
                          c.type === "list_pattern" ||
                          c.type === "optional_pattern" ||
                          (c.type === "const" && c.text === "()")
                        ) {
                          isProperty = false
                          break
                        }
                        // A computed property: value expression (no args).
                        isProperty = true
                        break
                      }
                    }
                  }
                }
                kind = isProperty ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Method
              } else if (isMember) {
                kind = ASTEngine.SymbolKind.Method
              } else {
                kind = isFunc ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Variable
              }

              const isAsync = !!this.findDescendant(
                node,
                (n) => n.type === "ce_expression" || n.type === "short_comp_expression",
                4,
              )

              // FS-D8: an F# `member` carries its own access modifier
              // (`member private this.Reset()`), and neither `internal` nor `private`
              // is part of the library's importable surface.
              const memberAccess = this.accessModifierOf(node, null)
              publish({
                name,
                kind,
                range: this.nodeToRange(node),
                ownerName: owner,
                isAsync,
                metadata: { nodeType: type, ...(memberAccess ? { accessModifier: memberAccess } : {}) },
              })

              // FS-D29. A MUTUAL RECURSION GROUP IS ONE NODE WITH SEVERAL BINDINGS.
              //
              //     let rec groupFirst (a: GroupDep) : GroupSecond = …
              //     and groupSecond (b: GroupSecondDep) : GroupFirst = …
              //
              // is a single `function_or_value_defn` holding both clauses, and only the first
              // was published. So `groupSecond` did not exist as a symbol at all, and its
              // parameter and return types were attributed to `groupFirst` — which is a real
              // published name, so the edges resolved and nothing downstream could tell. The
              // F# compiler corpus is written almost entirely in this shape.
              //
              // Each `and` clause is a binding in its own right, so each gets a symbol, with
              // the SAME kind and owner as the first: they are siblings, not nested.
              const extraLefts: Node[] = []
              for (let i = 0; i < node.namedChildCount; i++) {
                const c = node.namedChild(i)
                if (c && (c.type === "function_declaration_left" || c.type === "value_declaration_left")) {
                  extraLefts.push(c)
                }
              }
              for (let k = 1; k < extraLefts.length; k++) {
                const andName = this.nameOfDeclarationLeft(extraLefts[k]!)
                if (andName && andName !== name) {
                  publish({
                    name: andName,
                    kind,
                    range: this.nodeToRange(node),
                    ownerName: owner,
                    isAsync,
                    metadata: { nodeType: type, isMutualRecursionClause: true },
                  })
                }
              }

              // Qualified override: source = Owner.method, target = Base.method.
              if (isMember && this.firstTokenIs(node, "override")) {
                const baseName = owner ? baseTypes.get(owner) : undefined
                pushRel(
                  owner ? `${owner}.${name}` : name,
                  baseName ? `${baseName}.${name}` : name,
                  ASTEngine.RelationshipType.Overrides,
                  1.0,
                  { nodeType: type, isOverride: true },
                  lineOf(node),
                )
              }

              // Calls inside this member/function attribute to it; computed
              // property getters emit no calls (C# family contract).
              //
              // FS-D10: a top-level `let` owns the calls in its INITIALISER, whatever
              // its kind. The rule was keyed on the kind, so a `let checker = …` (a
              // VARIABLE, because it takes no arguments) did not become an owner, and
              // in an F# SCRIPT — where the top level IS the program and there is no
              // enclosing namespace, module or function — every call in it had no source
              // and was DROPPED. The lane's own truth oracle derives those edges from the
              // binding, and the differential measured the gap: 2,520 MISSING `calls`
              // rows per 200 real files, every one of them a real call.
              //
              // The kind gate remains for the case that motivated it: a computed PROPERTY
              // (`member _.X = expr`) emits no calls, which is the C# family contract and
              // is pinned by the lane's ground truth.
              if (kind === ASTEngine.SymbolKind.Property && !this.hasExplicitSetter(node)) {
                childCallOwner = undefined
              } else {
                // FS-D13: the "a computed property getter emits no calls" rule is the
                // C# family contract, and in C# an EXPRESSION-bodied property has no
                // second body for code to live in. F#'s `with get, set` DOES:
                //     member _.EventLoop
                //         with get () = evLoop
                //         and set (x: IEventLoop) = evLoop.ScheduleRestart()
                // The accessor is a `property_accessor` node carrying its own `set`
                // keyword token, so the rule is read structurally: a member with an
                // explicit SETTER has a body that executes, and suppressing its calls
                // deletes real code paths. Measured by the lane's own truth oracle.
                childCallOwner = name
              }
              childBodyDepth = bodyDepth + 1
            } else {
              // FS-D12: a `default` implementation of an abstract member publishes no
              // SYMBOL — the abstract signature is the canonical one, and the dedup is
              // correct. But its BODY belongs to that same member, so the body must be
              // owned by it.
              //
              // The arm passed the enclosing owner through unchanged, and inside a class
              // the enclosing owner is undefined — so every call in every `default`
              // implementation was DROPPED. F#'s OO surface is written this way
              // (`abstract member Compile : …` + `default x.Compile (pwd, argv) = …`),
              // and the lane's own truth oracle measured the gap: 731 of 817 MISSING
              // `calls` rows per 120 real files were this one shape. The same reasoning
              // as FS-D10, one level down.
              childCallOwner = name
              childBodyDepth = bodyDepth + 1
            }
          }
        }
      } else if (type === "additional_constr_defn") {
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          publish({
            name: "constructor",
            kind: ASTEngine.SymbolKind.Constructor,
            range: this.nodeToRange(node),
            ownerName: owner,
            metadata: { nodeType: "additional_constr_defn" },
          })
          // `new(...) = ...` also declares the type's constructor — the symbol is
          // named "constructor" by contract (C# family); the node's line is kept
          // in its range, so no relationship is owed here.
          childCallOwner = "constructor"
          childBodyDepth = bodyDepth + 1
        }
      } else if (type === "member_signature") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "property_or_ident")
        if (nameNode && nameNode.text) {
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            ownerName: owner,
            metadata: { nodeType: "member_signature" },
          })
          if (owner) abstractMemberNames.add(`${owner}:${nameNode.text}`)
        }
      } else if (type === "value_declaration" && bodyDepth > 0) {
        // FS-D5: this arm exists to reach the one `value_declaration` shape the walk
        // can arrive at INSIDE a class body — the 77 corpus nodes whose parent is
        // `member_defn` (script/m14/tmp/fs001-shape-census.ts). The arm it replaced read
        // `val_property_defn`, which is an ANONYMOUS node (`_val_property_defn` in the
        // grammar's hidden-rule list): it can never be a named child, so the branch was
        // unreachable, and F1 could not see it — its `isTypeComparison` only accepts a
        // `x.type === "…"` member expression while the analyzer dispatches on the bare
        // local `type` (that gate hole is proven in script/m14/tmp/fs007-f1-gate-hole.ts:
        // 41 of the analyzer's 92 type comparisons are inside F1's validated set).
        //
        // The F# member-property this arm was WRITTEN for — `member val A : int with
        // get, set` — is a live, common construct (890 occurrences in the F# compiler
        // corpus alone) that the pinned grammar does not parse: it arrives as a
        // root-level ERROR, not as a `value_declaration`. So no symbol is emitted here,
        // and the construct is recorded as a GRAMMAR gap rather than papered over with a
        // text rule. What the arm does do is keep the walk's depth accounting correct
        // for the shapes that DO parse, so a `value_declaration` in a body is walked
        // (its subtree's calls attribute to the enclosing member) without being minted.
        childCallOwner = callOwner
        childBodyDepth = bodyDepth
      } else if (type === "object_expression") {
        const iface = this.objectExpressionInterface(node)
        if (iface) {
          const { written, leaf } = iface
          const ownerName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          publish({
            name: "new " + written,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName,
            metadata: { nodeType: "object_expression" },
          })
          // FS-D7: the object's own members belong to the object. `{ new IDisposable
          // with member _.Dispose() = … }` published `Dispose` with NO owner at all,
          // because the branch minted a Class symbol and never opened a scope for it —
          // measured on the second corpora, where an F# SCRIPT (no namespace, no
          // module) has an empty enclosing scope and every member of every object
          // expression came out ownerless: suave examples/WebSocket/Program.fs:181,
          // fsharp-data HtmlNode.fs:123,206, elmish
          // docs/docs/subscription.fsx:71,144,803,833. The scope is opened under the
          // SAME name the symbol is published under, so the `contains` edge resolves to
          // a symbol that exists.
          currentScope.push("new " + written)
          if (ownerName) {
            // FS-D9 (R10 spelling), same rule: `{ new System.IDisposable with … }`
            // implements `IDisposable`, which is the name the leaf declares. Measured: 13
            // dotted `implements` targets per 400 real files, all of them this shape.
            pushRel(
              ownerName,
              leaf,
              ASTEngine.RelationshipType.Implements,
              1.0,
              { nodeType: "object_expression", ...(leaf !== written ? { qualifiedType: written } : {}) },
              lineOf(node),
            )
          }
        }
      } else if (type === "active_pattern") {
        // One function symbol named by the full active pattern, e.g. (|Even|Odd|)
        publish({
          name: node.text,
          kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node),
          ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
          metadata: { nodeType: "active_pattern" },
        })
      } else if (type === "exception_definition") {
        // `exception NotFound of string` — NotFound is under long_identifier.
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier")
        if (nameNode && nameNode.text) {
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "exception_definition" },
          })
        }
      } else if (type === "module_val_declaration") {
        // FSD9: a .fsi `val X : T` declares the surface — 203 of them in the
        // lane's 120-file census draw, every one publishing NOTHING until now
        // (the node exists because this lane's own grammar patch added the
        // rule). One Function symbol, owned by the enclosing module/type, marked
        // isDeclaration: a later .fs definition is the SAME entity (the Clean
        // .dcl/.icl merge precedent).
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode?.text) {
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "module_val_declaration", isDeclaration: true },
          })
        }
      } else if (type === "type_extension") {
        // FS-D2: the enclosing `type_definition` has already decided whether this
        // extension's name is published, and pushed the scope. A REACHED-here
        // `type_extension` is the nested body of such a `type_definition` (the grammar
        // wraps every `type X with` in one), so the correct action is exactly one
        // thing: carry the scope name forward so the members below own the extended
        // type, and publish nothing. Publishing a Class here is what produced the 54
        // duplicate symbols and 57 `contains X -> X` self-edges per 400 real files.
        //
        // The scope name is read through `typeInfoOf` — the SAME extraction the
        // `type_definition` branch uses — and not from the node's raw text. That
        // distinction is load-bearing: `type internal Tables<'Token> with` has a
        // `type_name` whose text is the whole `internal Tables<'Token>`, so pushing
        // its text put every extension member under an owner that matches no symbol
        // anywhere. Caught by the A/B as 510 REAL-LOSS rows for exactly this.
        const typeNameNode = this.findChild(node, (n) => n.type === "type_name")
        const extName = typeNameNode ? this.typeInfoOf(typeNameNode)?.name ?? null : null
        if (extName) currentScope.push(extName)
      } else if (type === "attribute") {
        const attrNameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (attrNameNode && attrNameNode.text) {
          const attrText = attrNameNode.text
          if (attrText.includes("TypeProvider") || attrText.includes("TypeProviderAssembly")) {
            publish({
              name: attrText,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
              metadata: { nodeType: "attribute", isTypeProvider: true },
            })
          }
        }
      } else if (type === "import_decl") {
        // FS-A1 (measured dead branches retired): `open_statement`/`open_decl`
        // never occur — 0 of 363,609 nodes in the shape census — `open X` IS
        // this node (558 in the same draw). The branch that read them was a
        // second, unreachable copy of this rule.
        const targetNode = this.findChild(node, (n) => n.type === "long_identifier" || n.type === "identifier")
        if (targetNode && targetNode.text) {
          imports.push({
            module: targetNode.text,
            items: [],
            isDefault: true,
            range: this.nodeToRange(node),
          })
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          // FSD10: a module-less file sources its file-level edges from
          // `Global`, never from the opened name itself (self-sourcing makes an
          // import unfalsifiable: any target would "reference" itself).
          //
          // FS-D17 adds the file's DECLARED scope between the two, because `owner` is a
          // property of where the walk happens to be and the file's scope is a property
          // of the file. Without it, whether an `open` was attributed to the module or to
          // `Global` depended on whether the `open` appeared above or below the `module`
          // keyword — see this method for the two corpus files that disagree.
          pushRel(
            owner || fileScope || "Global",
            targetNode.text,
            ASTEngine.RelationshipType.References,
            0.9,
            { nodeType: type, isImport: true },
            lineOf(node),
          )
        }
      } else if (type === "application_expression") {
        // Call/instantiation: source = enclosing function/method/constructor,
        // target = leaf name of the callee (C# family contract).
        let fnName = ""
        const fnNode = node.namedChild(0)
        if (fnNode) {
          if (
            fnNode.type === "long_identifier" ||
            fnNode.type === "identifier" ||
            fnNode.type === "long_identifier_or_op"
          ) {
            fnName = fnNode.text
          } else if (fnNode.type === "infix_expression") {
            // Pipeline `a |> f` — the callee is the RHS operand.
            const rhs = fnNode.namedChild(fnNode.namedChildCount - 1)
            if (rhs && (rhs.type === "long_identifier" || rhs.type === "identifier" || rhs.type === "long_identifier_or_op")) {
              fnName = rhs.text
            }
          } else if (fnNode.type === "dot_expression") {
            fnName = fnNode.text
          }
        }
        if (fnName && fnName.length > 1 && callOwner) {
          const leaf = fnName.split(".").pop() || fnName
          if (!this.isFSharpBuiltin(fnName, leaf)) {
            // Constructor chaining `new() = Point(0, 0)` — instantiation of the
            // enclosing type from the constructor body.
            const enclosingType = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
            if (callOwner === "constructor" && leaf === enclosingType) {
              pushRel(
                callOwner,
                leaf,
                ASTEngine.RelationshipType.Instantiates,
                0.95,
                { nodeType: type, isConstructorChain: true },
                lineOf(node),
              )
            } else {
              pushRel(callOwner, leaf, ASTEngine.RelationshipType.Calls, 0.8, { nodeType: type }, lineOf(node))
            }
          }
        }
      } else if (type === "prefixed_expression") {
        // FSD8(b): an explicit `new Foo(...)` is a CONSTRUCTION. `new` is the
        // only thing that distinguishes one in F# — a bare `Foo(...)` stays a
        // call (a capitalised name is not evidence), which is why this reads the
        // prefix token instead of the callee's spelling. The inner application
        // must not ALSO emit a call: the operand's children go on the stack, the
        // operand node itself does not, so its call branch never runs while
        // calls inside its ARGUMENTS still do.
        if (this.firstTokenIs(node, "new") && callOwner) {
          const operand = node.namedChild(0)
          if (operand && operand.type === "application_expression") {
            const calleeNode = operand.namedChild(0)
            const calleeText = calleeNode ? calleeNode.text : ""
            const leaf = calleeText.split(".").pop() || calleeText
            if (calleeText && calleeText.length > 1 && !this.isFSharpBuiltin(calleeText, leaf)) {
              pushRel(callOwner, leaf, ASTEngine.RelationshipType.Instantiates, 0.95, { nodeType: type, isNewConstruction: true }, lineOf(node))
              for (let i = operand.namedChildCount - 1; i >= 0; i--) {
                const argChild = operand.namedChild(i)
                if (argChild) {
                  walkStack.push({ node: argChild, scopePath: currentScope, callOwner: childCallOwner, bodyDepth: childBodyDepth })
                }
              }
              continue
            }
          }
        }
      } else if (type === "compiler_directive_decl") {
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Macro,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({ node: child, scopePath: currentScope, callOwner: childCallOwner, bodyDepth: childBodyDepth })
        }
      }
    }

    // Add Contains relationships: scope owner → owned symbols (the line is the
    // symbol's own line — the containment fact is ABOUT that declaration).
    //
    // FS-D3: a self-edge is refused, because a name that contains itself is a
    // statement about the graph's own bookkeeping rather than about the code, and a
    // consumer walking containment would loop. Measured on 400 real files
    // (script/m14/tmp/fs012-self-containment.ts): 368 such edges from three distinct
    // sources — a DU case named after its own type (`type
    // TypeProviderDesignation = TypeProviderDesignation of string`, a real and common
    // F# spelling, 305 of them), a member named after its own type (3 sites: `E.E`,
    // `MatchClause.Pattern`, `Map.Map`), and the `type_extension` of FS-D2.
    //
    // The refusal is at COMPOSITION, covering every tier — the same place the c lane's
    // #917 self-override fix put it — so the alternative (suppressing the label) is not
    // on the table: the DU case genuinely IS contained by its union.
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner && _owner !== s.name) {
        pushRel(
          _owner,
          s.name,
          ASTEngine.RelationshipType.Contains,
          1.0,
          { nodeType: s.metadata?.nodeType || "symbol", isContained: true },
          s.range?.startLine,
        )
      }
    }

    // FS-D4: the R9 declared-type reference graph. See extractDeclaredTypeRefs.
    this.extractDeclaredTypeRefs(rootNode, pushRel, publishedNames)

    // FS-D8: the EXPORT surface. F#'s importable units are the ones an `open` can
    // bind:
    //   * a file-scope unit — a namespace, a module, a type (a DU case is reachable
    //     through its type, never on its own);
    //   * a MODULE's own members, because `open M` binds them directly. F# is the
    //     haskell/ocaml shape the fixture-runner's export invariant already names, and
    //     that invariant is what caught the previous behaviour: the lane exported EVERY
    //     non-variable symbol, so a record field, a method and an object expression's
    //     member were published as importable units no `open` can bind. F3 reports it
    //     as `export(s) … do not resolve to a top-level symbol (membership rides
    //     Contains)`.
    //   * a TYPE's members are NOT exported — `open M` binds `M.Type`, and a member is
    //     reached as `M.Type.Member`; membership rides `contains`.
    //
    // VISIBILITY, which this now reads and previously did not: the grammar emits an
    // `access_modifier` node and F# has three levels, so an `internal` or `private`
    // declaration is not exported. The old code wrote `visibility: "public"` for every
    // symbol regardless, and the F# compiler corpus is full of internal types
    // (`type internal Tables<'Token>`, `type internal ByteMemory`).
    //
    // FORWARD DECLARATIONS (an `.fsi` `type X` followed by `type X = …`) are ONE
    // entity: both symbols stay, and the export names the DEFINITION, which is the one
    // carrying the members — the same surface/definition merge the lane already applies
    // to `module_val_declaration` (the Clean .dcl/.icl precedent). The fixture-runner
    // invariant's uniqueness clause is what surfaced this: `duplicate export name(s)
    // ["Surface"]`.
    const exportedNames = new Set<string>()
    const declaredUnits = new Set(
      symbols
        .filter((s) => !s.ownerName && s.metadata?.isForwardDeclaration !== true)
        .map((s) => s.name),
    )
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Variable) continue
      // a DU case / record field is reachable through its type, not on its own
      if (s.kind === ASTEngine.SymbolKind.EnumMember) continue
      const isForwardDecl = s.metadata?.isForwardDeclaration === true
      if (isForwardDecl && declaredUnits.has(s.name)) continue
      const visibility = this.visibilityOf(s)
      if (visibility === "private" || visibility === "internal") continue
      const isTypeMember =
        !!s.ownerName && !moduleNames.has(s.ownerName) && !namespaceNames.has(s.ownerName)
      if (isTypeMember) continue
      if (!s.ownerName && (s.kind === ASTEngine.SymbolKind.Property || s.kind === ASTEngine.SymbolKind.Method)) continue
      if (exportedNames.has(s.name)) continue
      exportedNames.add(s.name)
      exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: visibility as any })
    }
    return {
      language: "fsharp",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "F#",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
      },
    }
  }

  /**
   * FS-D11 — is this written type a TYPE QUERY rather than a declared type?
   *
   * `typeof<T>` and `unbox<T>` are EXPRESSIONS that carry a type argument:
   * `typeof<TypeInThisAssembly>.Assembly.Location` depends on a RUNTIME VALUE, and
   * publishing `references loc -> TypeInThisAssembly` as a declared-type dependency
   * says the opposite — that the declaration names the type in its signature.
   *
   * The discriminator walks up through the two shapes the grammar spells the query with,
   * because it spells it differently depending on which one it is:
   *   * `typed_expression` whose `base` is a `long_identifier_or_op` reading `typeof` /
   *     `unbox` — the corpus's own shape (measured by reading the tree: `typeof<Foo>` is
   *     `typed_expression > long_identifier_or_op(typeof) + types > simple_type`);
   *   * a `static_type` wrapper, the other spelling.
   *
   * A first draft tested only the DIRECT parent for the `long_identifier_or_op`, which
   * measured nothing, because the type's parent is the `typed_expression` and the
   * `long_identifier_or_op` is ITS base. The differential's UNEXPLAINED row is what
   * forced the second reading.
   */
  /**
   * FS-D13 — does a member declare an explicit SETTER?
   *
   * F#'s `member _.P with get, set` is ONE member with two `property_accessor` bodies,
   * and the setter's body executes. The property-getter contract ("a computed property
   * emits no calls", inherited from the C# family) is about an EXPRESSION-bodied
   * property, which has no second body to run code in — applying it to the setter
   * deleted the calls in real code.
   *
   * Read from the `property_accessor` node's own keyword token, never from the member's
   * text: `with get () = … and set (x) = …` and `with get, set` are the same shape.
   */
  private hasExplicitSetter(memberDefn: Node): boolean {
    const mop = this.findChild(memberDefn, (n) => n.type === "method_or_prop_defn")
    if (!mop) return false
    for (const acc of this.findDescendants(mop, (n) => n.type === "property_accessor", 6)) {
      for (let i = 0; i < acc.childCount; i++) {
        const c = acc.child(i)
        if (c && !c.isNamed && c.type === "set") return true
      }
    }
    return false
  }

  private isTypeQueryPosition(t: Node): boolean {
    let cur: Node | null = t
    for (let hop = 0; cur && hop < 3; hop++) {
      if (cur.type === "static_type") return true
      // `typed_expression` holds the query operator and the type as SIBLINGS:
      //     (typed_expression (long_identifier_or_op "typeof") (types (simple_type …)))
      // — so the operator is a CHILD, not the parent, and a test that looked for a
      // `typeof` parent measured nothing. The first two attempts each got one of these
      // two facts wrong, and both were caught by the differential's row rather than by
      // reading, which is the argument for running one at all.
      if (cur.type === "typed_expression") {
        for (let i = 0; i < cur.namedChildCount; i++) {
          const c = cur.namedChild(i)
          if (c && c.type === "long_identifier_or_op" && (c.text === "typeof" || c.text === "unbox")) return true
        }
        return false
      }
      const parent: Node | null = cur.parent
      if (!parent) return false
      if (parent.type === "long_identifier_or_op" && (parent.text === "typeof" || parent.text === "unbox")) return true
      if (parent.type === "static_type" || parent.type === "typed_expression") {
        cur = parent
        continue
      }
      return false
    }
    return false
  }

  /** The member's declared name: `method_or_prop_defn -> property_or_ident`, LAST identifier. */
  /**
   * The interface an OBJECT EXPRESSION constructs, as `{ written, leaf }`.
   *
   * FS-D14. The object-expression branch used to take the first `long_identifier`
   * descendant of the node and call that the interface name, which is right exactly
   * when the name is unqualified. A qualified name is NESTED in this grammar —
   *
   *     object_expression
   *       new
   *       typed_expression "System.Collections.Generic.IEqualityComparer<InferedType>"
   *         dot_expression "System.Collections.Generic.IEqualityComparer"
   *           long_identifier_or_op "System.Collections"
   *             long_identifier "System"        <-- what the old code found
   *           . identifier "Collections"
   *           . long_identifier_or_op "Generic.IEqualityComparer"
   *         types "InferedType"
   *
   * — so "first `long_identifier`" is the FIRST SEGMENT, and the published name was
   * `new System` with `implements -> System`, a target that resolves to nothing.
   *
   * The differential found it twice and in the most useful way available: the lane's
   * truth side read the SECOND segment. `{ new System.Collections.Generic.IEqualityComparer
   * with … }` gave the analyzer `System` and the truth `Collections`, which cannot both
   * be the interface and makes it obvious that the name is somewhere else entirely
   * rather than that one of them is off by a rule. Two implementations independently
   * wrong in the same place is the cheapest kind of evidence there is.
   *
   * The written name is therefore read from the `dot_expression` that carries it — a
   * node whose own text IS the full dotted path — and the leaf from the LAST identifier
   * inside it, so R10's spelling rule applies to the same leaf a consumer would join.
   * The tree this is built on is printed by script/m14/tmp/fs030-object-expr-name.ts.
   */
  private objectExpressionInterface(node: Node): { written: string; leaf: string } | undefined {
    // The interface is the object's FIRST DIRECT CHILD, and the fix is to read it there.
    //
    // The subtree search below was written for a DOTTED interface — `{ new System.IDisposable
    // with … }` — and asked for the first `dot_expression` anywhere inside. When the interface
    // is BARE, `{ new IDisposable with … }`, that search finds nothing of its own and keeps
    // descending, into the member bodies. So the first dotted expression in the subtree won,
    // and on fsharp/src/fsi/fsimain.fs:54 that was
    // `Thread.CurrentThread.CurrentUICulture`, giving
    //
    //     implements  Main  ->  CurrentUICulture
    //
    // where truth derives
    //
    //     implements  Main  ->  IDisposable
    //
    // One wrong name, and it cost FIVE rows in that file alone: three MISSING (the real
    // interfaces IDisposable, CtrlBreakService and FsiEvaluationSessionHostConfig, each from
    // an object expression, all displaced by whichever dotted name a member body mentioned)
    // and one UNEXPLAINED fabrication. The name it found is not a near-miss — it is a property
    // assignment inside a `Dispose` method, which is not a type and implements nothing.
    //
    // Reading child 0 is also the cheaper rule. "The name after `new`" is a fact about the
    // first child, so a bounded search for a name in a place it cannot appear is a rule that
    // can only ever be wrong, and wrong in the direction of a member body.
    const first = node.namedChild(0)
    const isNameish = (n: Node | null): n is Node =>
      !!n &&
      (n.type === "dot_expression" ||
        n.type === "typed_expression" ||
        n.type === "long_identifier_or_op" ||
        n.type === "long_identifier")
    const carrier = isNameish(first)
      ? first
      : // Kept for shapes where the name is not the first child, so this is a narrowing of
        // where the name may be READ rather than a claim that it is never elsewhere.
        (this.findDescendant(node, (n) => n.type === "dot_expression", 4) ??
          this.findDescendant(
            node,
            (n) => n.type === "typed_expression" || n.type === "long_identifier_or_op" || n.type === "long_identifier",
            4,
          ))
    if (!carrier) return undefined
    // `typed_expression` text carries the type ARGUMENTS too, and an argument list is
    // not part of the type's name.
    const written = carrier.text.split("<")[0]!.trim()
    if (!written) return undefined
    // The leaf is the LAST identifier IN THE CARRIER — the segment after the final dot.
    //
    // Scoped to the carrier, not to the object expression: an object expression's
    // subtree is the interface name AND every member body, so the last identifier in
    // the whole node is whatever the last member happened to mention. The first version
    // of this fix read the subtree and published `implements -> x` for
    // `member _.Equals(x, y) = …` and `-> failwith` for a body that calls it — a
    // strictly worse answer than `System`, because it now varied with the body. The
    // name is the carrier's business alone.
    //
    // A TYPE ARGUMENT is not part of the type's name, and it arrives as an identifier like any
    // other, so reading the last identifier of a `typed_expression` reads the ARGUMENT:
    // `{ new System.Collections.Generic.IEqualityComparer<Foo> with … }` has carrier text
    // `System.Collections.Generic.IEqualityComparer<Foo>`, whose last identifier is `Foo`, and
    // the row came out `implements Fixture.Names -> Foo` — a type argument presented as the
    // type being implemented. The fixture caught it, which is the second thing in this lane
    // that guard has earned its keep on.
    //
    // `written` already handles this for the full name (`split("<")`); the leaf needs the same
    // correction, and taking the carrier's FIRST CHILD is how the grammar says "the type, not
    // its argument" without re-parsing the text.
    const nameish = carrier.type === "typed_expression" ? (carrier.namedChild(0) ?? carrier) : carrier
    const idents = this.findDescendants(nameish, (n) => n.type === "identifier", 8)
    const leaf = idents.length ? idents[idents.length - 1]!.text : written
    return { written, leaf: leaf || written }
  }

  private memberNameOf(decl: Node): string | undefined {
    const mop = this.findChild(decl, (n) => n.type === "method_or_prop_defn")
    const prop = mop ? this.findChild(mop, (n) => n.type === "property_or_ident") : undefined
    const idents = prop ? this.filterChildren(prop, (n) => n.type === "identifier") : []
    return idents.length >= 2 ? idents[idents.length - 1]?.text : idents[0]?.text
  }

  /**
   * The name a `function_or_value_defn` / `value_declaration` DECLARES, read
   * structurally and never from an `identifier_pattern`'s text (FS-D6).
   */
  /**
   * The name a `*_declaration_left` node declares.
   *
   * The binding's own left-hand side spans a parameter list and a return annotation, so its
   * `identifier_pattern` text is the WHOLE left side (FS-D6) and cannot be used. The name is
   * the first `long_identifier` inside the pattern, in document order.
   */
  /**
   * The binding a type annotation belongs to, when the declaration node holds several.
   *
   * `let rec f … and g …` is ONE node with two left-hand sides, and each owns its own
   * signature. The name is read from the left whose SPAN contains the annotation, so the
   * answer is a fact about position rather than about order — and this is the same correction
   * the truth oracle needed for a dotted name and for a `let … and …` group, and the analyzer
   * needed twice.
   */
  private declaredNameAt(decl: Node, t: Node): string | undefined {
    let best: Node | undefined
    for (let i = 0; i < decl.namedChildCount; i++) {
      const c = decl.namedChild(i)
      if (!c) continue
      if (c.type !== "function_declaration_left" && c.type !== "value_declaration_left") continue
      if (c.startIndex <= t.startIndex && t.endIndex <= c.endIndex) best = c
    }
    return best ? this.nameOfDeclarationLeft(best) : undefined
  }

  private nameOfDeclarationLeft(left: Node): string | undefined {
    const pat = this.findChild(left, (n) => n.type === "identifier_pattern")
    const carrier =
      (pat ? this.findChild(pat, (n) => n.type === "long_identifier_or_op") ?? this.findChild(pat, (n) => n.type === "long_identifier") : undefined) ??
      left
    const idents = this.findDescendants(carrier, (n) => n.type === "identifier", 3)
      .filter((n) => n.startIndex < (pat?.endIndex ?? left.endIndex))
      .sort((a, b) => a.startIndex - b.startIndex)
    if (idents.length) return idents[0]!.text
    const direct = this.findChild(left, (n) => n.type === "identifier")
    return direct?.text
  }

  private declaredBindingName(decl: Node): string | undefined {
    // The DECLARATION LEFT is read FIRST, and the direct-child shortcut second — the order is
    // the fix, not an accident of preference.
    //
    // `let rec f … and g …` is ONE `function_or_value_defn` holding both clauses, and in that
    // shape the node has a direct `long_identifier` child belonging to the SECOND clause. The
    // shortcut therefore answered `visitVal` for the binding that begins
    //
    //     let rec visitEntity (entity: Entity) : TypedTreeNode = …        // line 2485
    //     and visitVal (v: Val) : TypedTreeNode = …                      // line 2506
    //
    // and every declared type in the FIRST binding's signature was published under the
    // SECOND binding's name — three rows in TypedTreeOps.Attributes.fs, and the same shape
    // throughout the compiler corpus, which is written almost entirely in `let rec … and …`
    // groups. Nothing downstream could tell: `visitVal` is a real published symbol, so the
    // edge resolved.
    // The first `*_declaration_left` in DOCUMENT ORDER across BOTH types — not
    // "function_declaration_left, else value_declaration_left".
    //
    // In a mutual group the group's own name is a `value_declaration_left` at index 0 and the
    // `and` clause's is a `function_declaration_left` at index 2 (printed by
    // script/m14/tmp/fs035-and-group.ts for the same grammar, on Symbols.fs). Asking for the
    // function form first therefore returns the `and` clause. This is the identical fault the
    // truth oracle had, found independently, and the two implementations agreeing on the FIX
    // while each had it separately is the reason a shared rule is worth stating twice.
    let left: Node | undefined
    for (let i = 0; i < decl.namedChildCount; i++) {
      const c = decl.namedChild(i)
      if (c && (c.type === "function_declaration_left" || c.type === "value_declaration_left")) {
        left = c
        break
      }
    }
    if (!left) {
      const direct = this.findChild(decl, (n) => n.type === "identifier" || n.type === "long_identifier")
      if (direct?.text) return direct.text.includes(".") ? (direct.text.split(".").pop() as string) : direct.text
      return undefined
    }
    const pat = this.findChild(left, (n) => n.type === "identifier_pattern")
    const leaf = pat ? this.patternNameNode(pat) : this.findChild(left, (n) => n.type === "identifier")
    if (leaf?.text) return leaf.text
    // The pattern's own text is only a NAME when it is nothing but a name. That was three
    // regexes — `/[()<]/`, `/\s:/` and `/^[A-Za-z_][A-Za-z0-9_']*$/` — and the grammar already
    // says it: a bare name is an `identifier_pattern` whose only content is a
    // `long_identifier`. A pattern that carries a parameter list, a type argument or a return
    // annotation has a CHILD for it, so the test is "does this node have exactly one name
    // child and nothing else", which is about the tree rather than about a string.
    //
    // This was the last of the six regex literals the M12 census found in this file. All six
    // are gone, and `docs/analyzers/real-fsharp-analyzer.md` had claimed the count was 0.
    if (pat) {
      const names = this.filterChildren(pat, (n) => n.type === "long_identifier" || n.type === "long_identifier_or_op")
      const isBareName =
        names.length === 1 && pat.namedChildCount === 1 && !this.findDescendant(pat, (n) => n.type === "argument_patterns", 2)
      if (isBareName) {
        const text = names[0]!.text
        if (text) return text.includes(".") ? (text.split(".").pop() as string) : text
      }
    }
    return undefined
  }

  /**
   * The declared NAME inside an `identifier_pattern` — the FIRST
   * `long_identifier_or_op -> long_identifier -> identifier` chain.
   *
   * Not `pattern.text`: an `identifier_pattern` spans the entire left-hand side,
   * parameters and return annotation included, so its text is a signature, not a name.
   * See FS-D6 at the call site.
   */
  private patternNameNode(pattern: Node): Node | undefined {
    const holder =
      pattern.type === "identifier_pattern"
        ? pattern
        : this.findChild(pattern, (n) => n.type === "identifier_pattern")
    const scope: Node = holder ?? pattern
    return this.findDescendant(
      scope,
      (n) =>
        n.type === "identifier" &&
        !!n.parent &&
        (n.parent.type === "long_identifier" || n.parent.type === "long_identifier_or_op"),
      3,
    )
  }

  /**
   * The nearest ANCESTOR matching the predicate, bounded by `maxDepth` hops.
   *
   * Distinct from `findDescendant` on purpose: the declared-type graph asks "which
   * declaration am I inside?", which is a question about the tree ABOVE the node, and
   * reusing the descendant search for it would mean passing the whole root — an O(n)
   * scan per type node, i.e. O(n²) over a file. Bounded hops keep the walk linear (the
   * lane's own hot-path rule: no per-symbol O(n) scans).
   */
  /**
   * The OUTERMOST callable above `n` — the member a local belongs to — or undefined if
   * there is none, which means `n` is itself top-level and is its own owner.
   *
   * This replaces `findAncestor(decl, isCallable, 8)`, and the bound was the defect. A
   * depth-limited search cannot distinguish "there is no callable above this" from "the
   * callable is further than 8 levels up", and the code treated both as the first. It then
   * fell through to publishing the LOCAL's own name, and a local is not a symbol — the lane's
   * contract, pinned by the `Negative.fs` fixture, says so — so the edge it published had no
   * other end:
   *
   *     references insert -> ConsoleKeyInfo      // `let insert(key: ConsoleKeyInfo) =` in console.fs
   *     references select -> Type                // `let select (methInfo:MethodInfo) =` in the same file
   *
   * Neither `insert` nor `select` is a symbol; the truth oracle independently derived both
   * facts against `ReadLine`, the method that contains them, and the differential reported
   * 125 such rows. `insert` sits inside nested `for`/`do` bindings in a method body, which is
   * more than 8 levels up.
   *
   * Walking to the root and keeping the LAST callable found is both unbounded and simpler to
   * state: a local inside a local inside a member is owned by the member, because a namespace
   * and a module are not callables and so never become the answer. A decl with no callable
   * anywhere above it really is top-level, and its own name is then correct — which is the
   * `annotated : Bar` case in the fixture, and the reason the fallback is kept rather than
   * removed.
   *
   * Cost is O(depth) per annotation and the walk terminates at the root, so the bound that
   * caused this cannot come back.
   */
  /**
   * Owner lookups, memoised PER DECLARATION rather than per annotation.
   *
   * Both of the root walks below are O(depth) and both are asked the same question about the
   * same `decl` once for every type node the declaration carries — so a member with four
   * annotations walked to the root four times to learn the same thing. The pass is therefore
   * O(annotations · depth) over what is really O(declarations · depth).
   *
   * MEASURED on CheckExpressions.fs (702 KB), analyze-only with the parse excluded and the
   * median of 7: 1411 ms before this change, 1510 ms after the walks were introduced — about
   * 7% of the analyzer's own time, from two lines of correct-looking code. It is easy to miss
   * because the end-to-end dump barely moves: parse is 8.6 s on that file, so a 100 ms
   * regression is under 1% of the number a corpus run reports. That is the same shape as the
   * O(n^2) the M12 envelope found on the production path, found there by scaling rather than by
   * reading — so it was found here by measuring the thing the walks sit inside, not the file.
   *
   * Keyed by node in a WeakMap, so it needs no reset between runs and cannot outlive its tree.
   */
  private readonly ownerMemo = new WeakMap<Node, { callable?: Node | null; typeDef?: Node | null }>()

  private outermostCallableAbove(n: Node): Node | undefined {
    const hit = this.ownerMemo.get(n)
    if (hit && "callable" in hit) return hit.callable ?? undefined
    let found: Node | undefined
    let cur: Node | null = n.parent
    while (cur) {
      if (isCallableOwnerNode(cur)) found = cur
      cur = cur.parent
    }
    this.ownerMemo.set(n, { ...(hit ?? {}), callable: found ?? null })
    return found
  }

  /**
   * The type declaration whose body contains `n`, walking to the root.
   *
   * The OUTERMOST one, which for a mutual group is the node that holds every clause in the
   * group — `type A = … and B = …` is one `type_definition` with both bodies inside it. The
   * name of the type that actually owns a declaration is recovered separately, by taking the
   * last `type_name` before the declaration; see the class-field arm in `resolveSource`.
   */
  private outermostTypeDefinitionAbove(n: Node): Node | undefined {
    const hit = this.ownerMemo.get(n)
    if (hit && "typeDef" in hit) return hit.typeDef ?? undefined
    let found: Node | undefined
    let cur: Node | null = n.parent
    while (cur) {
      if (cur.type === "type_definition") found = cur
      cur = cur.parent
    }
    this.ownerMemo.set(n, { ...(hit ?? {}), typeDef: found ?? null })
    return found
  }

  private findAncestor(node: Node, predicate: (n: Node) => boolean, maxDepth: number = 12): Node | undefined {
    let cur: Node | null = node.parent
    for (let i = 0; cur && i < maxDepth; i++) {
      if (predicate(cur)) return cur
      cur = cur.parent
    }
    return undefined
  }

  /**
   * The ACCESS MODIFIER written on a declaration, from the grammar's own
   * `access_modifier` node — never from the declaration's text.
   *
   * Where the modifier sits differs by construct, which is why a declaration node and
   * (for a type) its `type_name` node are both offered:
   *   * a TYPE — `type internal Tables<'Token>` puts it INSIDE the `type_name`, as its
   *     first named child; that node's own text is literally `internal Tables<'Token>`,
   *     which is how the pre-FS-D6 name read published a name with an access modifier
   *     inside it;
   *   * a VALUE or a MEMBER — `let internal f = …`, `member private this.Reset()` — puts
   *     it on the declaration itself;
   *   * an omitted modifier is `public` in F# and the grammar then emits no node, so
   *     the answer is `undefined`, which the caller treats as public. `undefined` is
   *     deliberately NOT "public": a caller can tell "written public" from "written
   *     nothing" without a second pass.
   */
  private accessModifierOf(decl: Node, typeNameNode: Node | null): string | undefined {
    const read = (n: Node | null): string | undefined => {
      if (!n) return undefined
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "access_modifier") return c.text
      }
      return undefined
    }
    const fromTypeName = read(typeNameNode)
    if (fromTypeName) return fromTypeName
    const fromDecl = read(decl)
    if (fromDecl) return fromDecl
    // an `attributes` wrapper can sit between the declaration and the modifier, so one
    // more bounded level is read before giving up. (Only NAMED nodes can appear here:
    // the grammar's `member_modifier` is a hidden rule — `_member_modifier` — so it is
    // inlined and can never be a node type. A first draft tested for it and F1 caught
    // the dead branch, which is the gate working.)
    for (let i = 0; i < decl.namedChildCount; i++) {
      const c = decl.namedChild(i)
      if (!c) continue
      if (c.type === "attributes" || c.type === "type_attributes") {
        const inner = read(c)
        if (inner) return inner
      }
    }
    return undefined
  }

  /** The access modifier a symbol was minted with, defaulting to F#'s implicit public. */
  private visibilityOf(symbol: ASTEngine.UniversalSymbol): "public" | "internal" | "private" {
    const recorded = (symbol.metadata as any)?.accessModifier
    if (recorded === "internal" || recorded === "private" || recorded === "public") return recorded
    return "public"
  }

  /**
   * Every type name this file DECLARES with a real `type X = …` body — i.e. NOT by
   * `type X with …`. Collected before the walk so the publication rule is
   * order-independent.
   */
  /**
   * The module or namespace a FILE declares, or undefined.
   *
   * FS-D17. An `open` is a SIBLING of the file's `module` declaration, not a child, so a
   * scope stack maintained by walking down the tree is empty when the walk reaches one.
   * The analyzer's behaviour was then inconsistent in a way the corpus made obvious:
   *
   *   FscMain.fs         `module … CommandLineMain` (line 3), `open System` (line 5)
   *                      -> the import was sourced to the module, because the walk had
   *                         already entered the module node by the time it got there
   *   AssemblyCheck.fs   `open System` (line 3), `module AssemblyCheck =` (line 10)
   *                      -> the import was sourced to `Global`, because the walk had not
   *                         reached the module yet
   *
   * The file's scope is the same in both cases — in F# the whole file is inside
   * `AssemblyCheck` — so one of the two answers was wrong and the rule that produced them
   * was "wherever the walk happened to be", which is not a rule about the program. The
   * fix is a PRE-PASS, so the answer does not depend on the order of two sibling
   * declarations.
   *
   * A module is preferred over a namespace because a file that declares both nests the
   * module inside the namespace, and a module name is the closer scope of the two.
   *
   * Measured: 128 UNEXPLAINED open-path rows per 120 corpus files before the rule, and
   * the two example files above disagreeing with each other rather than with the truth.
   *
   * ONE top-level declaration, and only one. The first version of this pre-pass took the
   * FIRST module it found, which is right for AssemblyCheck.fs and wrong for
   * `docs/fcs/project.fsx`, and the two are the same shape: an `open` above the `module`
   * keyword. In a single-module file that scope is the file's, wherever the `open` sits. In
   * a SCRIPT with several modules it is not — `project.fsx` opens `System` at line 35 and
   * declares `module Inputs` at line 48, and code above the first module in a script is at
   * the SCRIPT's scope, not inside `Inputs`. "The first module" made 128 rows disagree in
   * the other direction.
   *
   * So the distinction is the count, and it is structural rather than a file extension: a
   * file with more than one top-level module/namespace is a script, and the walk's own scope
   * — which is correct inside a module and correctly empty above the first one — already
   * answers it.
   */
  private collectFileScope(root: Node): string | undefined {
    // TOP-LEVEL declarations only. A `module` nested inside another module does not make
    // the file a script, and counting it would turn an ordinary file into one.
    const topLevel: string[] = []
    let topLevelStartIndex: number | undefined
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "module_defn" || n.type === "named_module" || n.type === "namespace") {
        const nm = this.findChild(n, (c) => c.type === "type_name" || c.type === "long_identifier" || c.type === "identifier")
        if (nm?.text) {
          topLevel.push(nm.text.trim())
          if (topLevelStartIndex === undefined) topLevelStartIndex = n.startIndex
        }
        continue // do not descend: nested modules are not top-level
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (topLevel.length !== 1) return undefined

    // ...and only if nothing EXECUTES above it. Two corpus files have one top-level module
    // and an `open` above it, and they need opposite answers:
    //
    //   AssemblyCheck.fs   comments + `open`, then `module AssemblyCheck =`
    //                      -> the module is the file's scope, and the imports belong to it
    //   docs/fcs/project.fsx   `open System` (35), `let checker = …` (42), `module Inputs` (48)
    //                      -> a SCRIPT: the binding at line 42 executes before any module
    //                         exists, so the file is script-scoped and the imports belong
    //                         to the script, not to `Inputs`
    //
    // The discriminator is the top-level BINDING, and it is structural: `module M` and
    // `module N` further down project.fsx look like two more top-level modules and are not
    // — they are inside triple-quoted strings (script/m14/tmp/fs036-top-level.ts), so
    // counting module nodes is not enough on its own. A binding that executes above the
    // module is what makes a file a script, and it is the same fact in both files.
    //
    // Keying on the `.fsx` extension instead would have been shorter and would have been a
    // guess about which files are scripts rather than a statement about the code. It would
    // also have been wrong for a `.fs` file that genuinely is a script.
    const moduleStart = topLevelStartIndex
    if (moduleStart === undefined) return undefined
    const codeWalker: Node[] = [root]
    while (codeWalker.length > 0) {
      const n = codeWalker.pop()!
      if (
        (n.type === "function_or_value_defn" || n.type === "value_declaration" || n.type === "sequential_expression") &&
        n.startIndex < moduleStart
      ) {
        return undefined
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) codeWalker.push(c)
      }
    }
    return topLevel[0]
  }

  private collectDeclaredTypeNames(root: Node): Set<string> {
    const names = new Set<string>()
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "type_definition" && !this.findChild(n, (c) => c.type === "type_extension")) {
        const typeNameNode = this.findDescendant(n, (c) => c.type === "type_name", 3)
        if (typeNameNode) {
          const li = this.findChild(typeNameNode, (c) => c.type === "long_identifier")
          const id = li
            ? this.findDescendant(li, (c) => c.type === "identifier", 3)
            : this.findChild(typeNameNode, (c) => c.type === "identifier")
          if (id?.text) names.add(id.text)
        }
        continue
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return names
  }

  /**
   * FS-D4 — the R9 DECLARED-TYPE reference graph: a declaration's WRITTEN type is a
   * dependency, published as a `references` edge marked
   * `metadata.relationshipType === "declared_type"`.
   *
   * WHY THIS LANE NEEDED IT. R9 is a family standard — rust's own R13 header calls it
   * one ("mirrors go/c/zig") and thirteen lanes implement it.
   * `script/m60/declared-type-refs-census.ts` measured fsharp **absent** with the
   * control present: the snippet parses, the holder is walked, and the lane emits no
   * type reference at all. A capability that is absent emits nothing for a per-edge
   * oracle to adjudicate, which is why it survived — the same failure mode R9 was
   * created to find.
   *
   * THE POSITIONS. A written type in F# is a `simple_type` / `postfix_type` /
   * `generic_type` / … wrapper whose NAME is a `long_identifier` (dotted) or a bare
   * `identifier`; the position is decided by the wrapper's PARENT, and the source
   * attribution follows the family rule measured off java/kotlin/python and pinned by
   * csharp's `declared-type-graph` fixture: a MEMBER's written type belongs to the
   * enclosing TYPE, a parameter's / return's / local's to the enclosing CALLABLE.
   *
   *   record field        -> the record type   (a field is a property OF the type)
   *   class-body `let`    -> the class          (F#'s private field — a member)
   *   member parameter    -> the member
   *   member return type  -> the member
   *   DU case payload    -> the union type
   *   module let / local -> the binding or the enclosing function
   *   type abbreviation  -> the abbreviation
   *   class inherit      -> REFUSED: already an `extends` edge
   *   interface impl     -> REFUSED: already an `implements` edge
   *   the ambiguous `type X = SomeType` (which the grammar reads as a one-case union)
   *                     -> REFUSED: the RHS and a DU case are the same text, and
   *                        script/m14/tmp/fs020 measured 114 such sites per 400 files
   *                        that single-file analysis cannot separate. See that probe
   *                        for the ruling.
   *
   * WHAT MUST NOT BECOME A NAME, each measured (script/m14/tmp/fs016):
   *   a bound type PARAMETER (`'T`, `^T`) — inside a declaration's own `type_arguments`
   *   it is a BINDING, not a dependency (rust's R13 rule; csharp's `_genericBound`
   *   control);
   *   an UNDERSCORE (`_`, the anonymous type of `Map<string,_>`) — not a name at all;
   *   an F# PREDEFINED type (`int`, `string`, `unit`, …) — the analogue of go's
   *   BUILTINS set and csharp's `int`/`string` control.
   * Deliberately NOT used: the capitalisation of a name. F# lets a type be named
   * anything, so this lane does not guess a type from its spelling.
   */
  private extractDeclaredTypeRefs(
    rootNode: Node,
    pushRel: (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, any>,
      line?: number,
    ) => void,
    /**
     * The names this run has published as symbols. Passed in rather than reached for because
     * this pass is a SEPARATE walk from the one that publishes them — the R9 graph is
     * extracted after the main traversal — so the set is threaded rather than captured, and
     * the ordering that makes membership exact (a declaration's symbol is published before
     * its subtree is walked) is a property of the CALLER, not of this method.
     */
    publishedNames: Set<string>,
  ): void {
    const PREDEFINED = new Set([
      "int", "uint", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
      "nativeint", "unativeint", "float", "double", "float32", "single", "decimal", "bool",
      "char", "string", "obj", "unit", "void", "exn", "list", "array", "seq", "option", "ref",
      "byte", "sbyte", "intptr", "uintptr", "bigint",
    ])

    // The name-bearing node inside a type wrapper. Wrappers nest (`postfix_type` holds a
    // `simple_type` for its base and a `long_identifier` for the postfix), so the rule
    // is: descend to the first type-ish child, then take the LAST
    // `long_identifier`/`identifier` at that level — the name the wrapper writes LAST,
    // which is the type the whole expression denotes (`int option` is `option`;
    // `Map<string,int>` is `Map`). This is also the node the edge carries its LINE on
    // (M59.A7), never the wrapper's own start.
    const nameNodeOf = (t: Node): Node | null => {
      let cur: Node | null = t
      for (let guard = 0; guard < 8 && cur; guard++) {
        if (cur.type === "type_argument") return null // a bound type parameter
        if (cur.type === "long_identifier") {
          let leaf: Node | null = null
          for (let i = 0; i < cur.namedChildCount; i++) {
            const c = cur.namedChild(i)
            if (c && (c.type === "identifier" || c.type === "long_identifier")) leaf = c
          }
          return leaf ?? cur
        }
        if (cur.type === "identifier") return cur
        let next: Node | null = null
        for (let i = 0; i < cur.namedChildCount; i++) {
          const c = cur.namedChild(i)
          if (
            c &&
            (TYPE_WRAPPER_NODES.has(c.type) ||
              c.type === "type_argument" ||
              c.type === "type_arguments" ||
              c.type === "long_identifier" || // the name written DIRECTLY on the wrapper
              c.type === "identifier")
          ) {
            next = c
            break
          }
        }
        if (!next) return null
        cur = next
      }
      return null
    }

    /**
     * Is this node an F# TYPE BINDER — `'T`, `^T` — rather than a named type?
     *
     * The grammar writes a binder as a leading apostrophe token and then an identifier:
     *
     *     type_argument "'T"
     *       '          "'"
     *       identifier "T"
     *
     * so the binder is a TOKEN in the tree and not a spelling to be recognised in a string.
     * That is what replaced the regex `/^['^]/` — the fourth of the six literals the M12
     * census found in this file, all of which this analyzer's doc claimed did not exist.
     */
    const isTypeBinderNode = (node: Node): boolean => {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && c.type === "'") return true
      }
      return false
    }

    /**
     * Is this node a NAME — a bare `identifier`, or a dotted chain of them ending at `leaf`?
     *
     * Replaces the regex `/^[A-Za-z_][A-Za-z0-9_']*$/`. The grammar already distinguishes an
     * `identifier` from everything else, and asking the TREE is a stronger statement than
     * asking whether a string looks like a name: a dotted path `System.IDisposable` is a
     * `long_identifier` over identifiers, and both facts are then checkable.
     */
    const isIdentifierNameNode = (node: Node, leaf: string): boolean => {
      if (node.type === "identifier") return node.text === leaf
      if (node.type === "long_identifier" || node.type === "long_identifier_or_op") {
        const last = this.filterChildren(node, (n) => n.type === "identifier").pop()
        return last?.text === leaf
      }
      const inner = this.findDescendant(node, (n) => n.type === "identifier", 3)
      return inner?.text === leaf
    }

  /**
   * The published name for a type-bearing node, or null when it is not a dependency.
   */
    const publishedName = (node: Node): string | null => {
      const text = (node.text ?? "").trim()
      if (!text) return null
      if (text === "_") return null
      const leaf = text.includes(".") ? (text.split(".").pop() as string) : text
      if (!leaf || leaf === "_") return null
      // A TYPE BINDER is not a dependency. `'T` and `^T` are the F# spellings, and the
      // grammar has a node for it: a type_variable / type_binder, whose own text is the
      // apostrophe. Reading the NODE is the whole point — the previous test was the regex
      // `/^['^]/` on the text, which is the sixth of the six regex literals the M12 census
      // found in this file and which the analyzer's own doc claimed did not exist.
      if (isTypeBinderNode(node)) return null
      if (PREDEFINED.has(leaf)) return null
      // A name is an IDENTIFIER or a dotted chain of them, and the grammar has an
      // `identifier` node for the former. The previous test was the regex
      // `/^[A-Za-z_][A-Za-z0-9_']*$/` applied to the leaf's text; walking the node says the
      // same thing without a pattern, and says it about the TREE rather than about a string
      // that happens to look like a name.
      if (!isIdentifierNameNode(node, leaf)) return null
      return leaf
    }

    /**
     * Which of a callable's type positions a written type sits in.
     *
     * F# writes a callable's types in three places and the AST separates all three: a
     * PARAMETER inside an argument list (`paren_pattern` for a curried `(a: T)`,
     * `argument_patterns`/`argument_spec`/`curried_spec` for an unparenthesised `a: T`),
     * a RETURN type after the argument list, and a LOCAL's annotation inside a body. A
     * first draft collapsed the parameter case into "not a return type" and labelled it
     * `local_annotation`, which is a third position; the `fsharp/name-surface` fixture
     * pins the corrected labels on `takesGeneric (payload: ResizeArray<int>) : Map<string,
     * int>` — one line, one parameter and one return type, two different labels.
     */
    const callablePosition = (t: Node, decl: Node): "parameter" | "return_type" | "local_annotation" => {
      const inArgs = this.findAncestor(
        t,
        (n) =>
          n.type === "paren_pattern" ||
          n.type === "argument_patterns" ||
          n.type === "argument_spec" ||
          n.type === "arguments_spec" ||
          n.type === "curried_spec",
        3,
      )
      if (inArgs) return "parameter"
      if (decl.type === "value_declaration") return "local_annotation"
      return "return_type"
    }

    /** The declaration a written type belongs to, per the family attribution rule. */
    const resolveSource = (t: Node): { source: string; declaredOn: string } | null => {
      const parent = t.parent
      if (!parent) return null
      if (parent.type === "class_inherits_decl" || parent.type === "interface_implementation") {
        // REFUSED: already an `extends` / `implements` edge. A second, weaker edge for
        // the same fact is the duplicate R9 exists to prevent.
        return null
      }
      if (
        parent.type === "type_attribute" ||
        parent.type === "type_arguments" ||
        parent.type === "type_argument_defn"
      ) {
        return null
      }
      if (parent.type === "record_field") {
        const rt = this.findAncestor(parent, (n) => n.type === "record_type_defn", 6)
        if (!rt) return null
        const td = this.findAncestor(rt, (n) => n.type === "type_definition", 2)
        if (!td) return null
        const tn = this.findDescendant(td, (n) => n.type === "type_name", 3)
        const name = tn ? this.typeInfoOf(tn)?.name ?? null : null
        return name ? { source: name, declaredOn: "record_field" } : null
      }
      if (parent.type === "union_type_field") {
        const ud = this.findAncestor(parent, (n) => n.type === "union_type_defn", 4)
        if (!ud) return null
        const tn = this.findDescendant(ud, (n) => n.type === "type_name", 2)
        const name = tn ? this.typeInfoOf(tn)?.name ?? null : null
        return name ? { source: name, declaredOn: "union_case_payload" } : null
      }
      // A type ABBREVIATION's right-hand side is a real dependency: `type Names = Dep
      // list` depends on Dep, which is the fact a reader wants from the graph. The
      // ambiguous `type Names = Dep` shape is deliberately left out (see the header).
      if (parent.type === "type_abbrev_defn") {
        const tn = this.findChild(parent, (n) => n.type === "type_name")
        const name = tn ? this.typeInfoOf(tn)?.name ?? null : null
        return name ? { source: name, declaredOn: "type_abbreviation" } : null
      }
      // Everything else is a parameter / return / local annotation, which belongs to the
      // enclosing CALLABLE. `parent` ITSELF can be that declaration — a class body's
      // `let mutable f : Dep` writes its annotation on a `simple_type` whose parent IS
      // the `function_or_value_defn` — so the direct parent is tested first and only
      // then are ancestors walked.
      const isDecl = (n: Node) =>
        n.type === "member_defn" ||
        n.type === "function_or_value_defn" ||
        n.type === "value_declaration" ||
        n.type === "additional_constr_defn"
      // A LAMBDA parameter is not a declaration and owns nothing.
      //
      //     let sb = fun (sb: StringBuilder) (c: char) -> …
      //
      // The `simple_type`'s nearest declaration ancestor is the `let sb` that HOLDS the
      // lambda, so the walk attributed `StringBuilder` to `sb` — a symbol that exists, so
      // nothing downstream could tell the edge was wrong, and the truth oracle (which
      // refuses lambda parameters independently) derived no such row. The lane's contract
      // says it outright and pins it in the negative fixture: lambda params are NOT
      // symbols. So an annotation on one is a fact about a value that the graph does not
      // publish, and publishing it under the holder's name is worse than publishing
      // nothing: it is a true-shaped edge about the wrong thing.
      //
      // The discriminator is the `fun_expression` between the pattern and the declaration,
      // which is the only thing that makes this a lambda parameter rather than a member's.
      const inLambda = this.findAncestor(
        parent,
        (n) => n.type === "fun_expression",
        6,
      )
      if (inLambda) return null
      const decl = isDecl(parent) ? parent : this.findAncestor(parent, isDecl, 14)
      if (!decl) return null
      const pos = callablePosition(t, decl)
      if (decl.type === "member_defn") {
        const mop = this.findChild(decl, (n) => n.type === "method_or_prop_defn")
        const prop = mop ? this.findChild(mop, (n) => n.type === "property_or_ident") : undefined
        const idents = prop ? this.filterChildren(prop, (n) => n.type === "identifier") : []
        const name = idents.length >= 2 ? idents[idents.length - 1]?.text : idents[0]?.text
        return name ? { source: name, declaredOn: pos } : null
      }
      if (decl.type === "additional_constr_defn") return { source: "constructor", declaredOn: "parameter" }
      // A `let` DIRECTLY in a class body is F#'s private field, so its written type
      // belongs to the TYPE. A `let` INSIDE a body is a LOCAL, and a local's written type
      // belongs to the enclosing CALLABLE — the family attribution rule, and the rule
      // the lane's own truth oracle derives independently.
      //
      // The distinction is "is there a CALLABLE between the declaration and its type",
      // not "is there a type_definition above me": a first draft asked the latter, so
      // `member this.BodyLocal() = let local : Dep = …` attributed the local's type to
      // the CLASS. The truth oracle found it as the single MISSING row on
      // fsharp/declared-type-graph (`BodyLocal -> Dep` against the analyzer's
      // `Holder -> Dep`), which is the second opinion doing the job it exists for.
      const inTypeBody = this.findAncestor(decl, (n) => n.type === "type_extension_elements", 3) !== undefined
      const enclosingCallable = this.outermostCallableAbove(decl)
      if (inTypeBody && enclosingCallable === undefined) {
        // a field of the class: the type owns it.
        //
        // The owning type is the one whose body CONTAINS this declaration, and in a mutual
        // type group the group's node holds several:
        //
        //     type FSharpAssemblyContents(…) =          // <- the group's first type
        //         member val …
        //     and FSharpImplementationFileContents(…) =  // <- the type that owns the field
        //         let mutable Binding : …
        //
        // Two things were wrong here. `findAncestor(decl, type_definition, 6)` is bounded
        // and cannot tell "no type above" from "further than 6 up". And taking the FIRST
        // `type_name` descendant of that node names the group's FIRST type, so a field in
        // the `and` clause was published under its sibling's name — a name that exists, so
        // the edge resolved and nothing downstream could tell it was wrong. Measured in
        // Exprs.fs: `FSharpAssemblyContents -> Binding` against the truth's
        // `FSharpImplementationFileContents -> Binding`.
        //
        // The owner is the LAST type name that begins before the field does, in document
        // order — which is the same correction the truth oracle needed for identifiers in a
        // dotted name, and for the same reason: an array is not a document.
        const td = this.outermostTypeDefinitionAbove(decl)
        if (!td) return null
        const fieldStart = decl.startIndex
        const names = this.findDescendants(td, (n) => n.type === "type_name", 4)
          .filter((n) => n.startIndex < fieldStart)
          .sort((a, b) => a.startIndex - b.startIndex)
        const tn = names.length ? names[names.length - 1] : undefined
        const tName = tn ? this.typeInfoOf(tn)?.name ?? null : null
        if (tName) return { source: tName, declaredOn: "class_field" }
      }
      // A local: the ENCLOSING callable is the source, never the local's own name —
      // `let local : Dep` is a dependency of the function that contains it.
      if (enclosingCallable) {
        if (enclosingCallable.type === "additional_constr_defn") return { source: "constructor", declaredOn: "local_annotation" }
        const cName =
          enclosingCallable.type === "member_defn"
            ? this.memberNameOf(enclosingCallable)
            : this.declaredBindingName(enclosingCallable)
        if (cName) return { source: cName, declaredOn: "local_annotation" }
      }
      // The fallback publishes a name ONLY if this run has already published it as a symbol.
      //
      // A structural guard was tried here first and was wrong in both directions, which is
      // what the membership test exists to settle. Refusing every nested declaration refuses
      // `isAttribute -> FSharpEntity`, where the binding is a local inside an active pattern
      // and IS published as a function; not refusing publishes `argInfo -> ArgReprInfo`,
      // where the binding is a local and is NOT published, and the edge has no other end.
      // Neither defect is visible downstream: one resolves to a perfectly good symbol and the
      // other to nothing, and an edge's shape alone does not distinguish them.
      //
      // `publishedNames` is exact here rather than approximate: a declaration's symbol is
      // pushed when the walk visits the declaration, and this runs while walking its subtree.
      // MEASURED, THEN REVERTED: reading the left-hand side whose SPAN contains the
      // annotation, rather than the first one on the node, is the right idea for a mutual
      // group and it made the corpus much worse — MISSING 8 -> 48, UNEXPLAINED 66 -> 139.
      //
      // The reason is that a left-hand side does not always SPAN the type it owns. In
      // `let rec f (x: int) : R = …` the parameter's type is inside the left, but the RETURN
      // type is a sibling of the pattern rather than a descendant of the left, so no left
      // contains it, the positional lookup answers nothing, and the row is dropped instead of
      // attributed. A position test that is right for half the positions and silent for the
      // other half is the same defect as the bound it replaced, wearing a different hat.
      //
      // The `and`-clause SYMBOL PUBLICATION that came with it is kept, because that part is
      // independently correct and separately measured: before, `groupSecond` did not exist as
      // a symbol at all, which is a fact about the symbol table and not about attribution.
      const name = this.declaredBindingName(decl)
      if (name && publishedNames.has(name)) return { source: name, declaredOn: pos }
      return null
    }

    const emitted = new Set<string>()
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      // FS-D30: this pass is a SECOND WALK, and it had none of the recovery rule the first
      // walk got. `visit` refuses to descend into an `ERROR` node and discloses it instead,
      // because the tree there is the parser's reconstruction rather than the program — but
      // this loop started at the root and took every node it met, so on a file the grammar
      // cannot read it mined the recovery artifact anyway and published its rows.
      //
      // The evidence is a corpus file that is large enough to be worth parsing:
      // CheckExpressions.fs, 702 KB, produced ZERO symbols and 147 relationships, every one
      // of them a `references` row with an EMPTY target — `RecursiveBindingInfo -> `,
      // `CheckedBindingInfo -> `, `ValScheme -> `. An edge with no target is not a wrong
      // answer, it is the absence of one, and 147 of them is what a walk through a
      // reconstruction looks like when it is asked to read meaning out of it.
      //
      // So the rule is now the SAME rule in both walks, which is the only way "a recovery
      // region is disclosed and not mined" can be a property of the analyzer rather than a
      // property of one of its two loops.
      if (n.type === "ERROR" || n.isMissing) continue
      if (TYPE_WRAPPER_NODES.has(n.type)) {
        // only the OUTERMOST wrapper, so a postfix_type inside a list_type is not
        // counted once per layer
        const nestedInType = n.parent != null && TYPE_WRAPPER_NODES.has(n.parent.type)
        // FS-D11: a TYPE QUERY is not a written type. `typeof<T>` and `unbox<T>` are
        // EXPRESSIONS that carry a type argument — `typeof<TypeInThisAssembly>.Assembly
        // .Location` is a dependency on a runtime value, and publishing
        // `references loc -> TypeInThisAssembly` says the opposite.
        //
        // The discriminator is the PARENT, and it is two shapes because the grammar
        // spells the query two ways: a `static_type` wrapper, and a bare
        // `long_identifier_or_op` named `typeof`/`unbox` whose child is the type. A
        // first draft refused only the `static_type` wrapper and measured nothing,
        // because `typeof<Foo>` does not produce one — verified by reading the tree,
        // not by assuming the wrapper.
        if (!this.isTypeQueryPosition(n) && !nestedInType) {
          const nameNode = nameNodeOf(n)
          const target = nameNode ? publishedName(nameNode) : null
          const src = resolveSource(n)
          const key = `${src?.source}|${target}|${n.startIndex}`
          if (target && src && !emitted.has(key)) {
            emitted.add(key)
            pushRel(
              src.source,
              target,
              ASTEngine.RelationshipType.References,
              1.0,
              {
                nodeType: n.type,
                relationshipType: "declared_type",
                declaredOn: src.declaredOn,
                declaredType: target,
              },
              nameNode ? nameNode.startPosition.row + 1 : n.startPosition.row + 1,
            )
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * Pure-AST name + declared generic-parameter extraction for a type_name
   * node. The clean name is long_identifier -> identifier (generics live in a
   * sibling type_arguments node, never inside the identifier).
   */
  private typeInfoOf(node: Node): { name: string; genericParameters?: string[] } | null {
    const liNode = this.findChild(node, (n) => n.type === "long_identifier")
    const idNode = liNode
      ? this.findDescendant(liNode, (n) => n.type === "identifier")
      : this.findChild(node, (n) => n.type === "identifier")
    if (!idNode?.text) return null
    const genericParameters: string[] = []
    const taNode = this.findChild(node, (n) => n.type === "type_arguments")
    if (taNode) {
      for (let i = 0; i < taNode.namedChildCount; i++) {
        const c = taNode.namedChild(i)
        if (c?.type !== "type_argument_defn") continue
        const argNode = this.findChild(c, (n) => n.type === "type_argument")
        if (argNode?.text) genericParameters.push(argNode.text)
      }
    }
    return {
      name: idNode.text,
      genericParameters: genericParameters.length > 0 ? genericParameters : undefined,
    }
  }

  private isFSharpBuiltin(call: string, leaf: string): boolean {
    if (FSHARP_CONSOLE_BUILTINS.has(call)) return true
    if (OBJECT_LEAF_METHODS.has(leaf)) return true
    if (call === "Console.WriteLine" || call.startsWith("Console.")) return true
    return false
  }

  private firstTokenIs(node: Node, text: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === text) return true
      // Skip leading attribute/comment trivia tokens
      if (c.isNamed) break
    }
    return false
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return undefined
  }

  private filterChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) results.push(child)
    }
    return results
  }

  private findDescendants(node: Node, predicate: (n: Node) => boolean, maxDepth: number = 5): Node[] {
    const results: Node[] = []
    if (maxDepth <= 0) return results
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        if (predicate(child)) results.push(child)
        results.push(...this.findDescendants(child, predicate, maxDepth - 1))
      }
    }
    return results
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean, maxDepth: number = 5): Node | undefined {
    if (maxDepth <= 0) return undefined
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        if (predicate(child)) return child
        const found = this.findDescendant(child, predicate, maxDepth - 1)
        if (found) return found
      }
    }
    return undefined
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
}
