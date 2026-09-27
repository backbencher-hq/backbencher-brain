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

export class RealFsharpAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

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

      let currentScope = [...scopePath]
      let childCallOwner = callOwner
      let childBodyDepth = bodyDepth

      if (type === "namespace" || type === "named_module" || type === "module_defn") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const name = nameNode.text
          symbols.push({
            name,
            kind: type === "namespace" ? ASTEngine.SymbolKind.Namespace : ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
          currentScope.push(name)
        }
      } else if (type === "type_definition") {
        // Pure AST: the clean name is type_name -> long_identifier -> identifier;
        // declared generic params are type_arguments -> type_argument_defn ->
        // type_argument (no source-text regex needed).
        const typeNameNode = this.findDescendant(node, (n) => n.type === "type_name")
        const typeInfo = typeNameNode ? this.typeInfoOf(typeNameNode) : null
        const name = typeInfo?.name ?? null
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
          var isMeasure = !!this.findDescendant(node, function (n) {
            return n.type === "attribute" && (n.text.includes("Measure") || n.text.includes("[<Measure"))
          })
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

          symbols.push({
            name,
            kind,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            genericParameters: typeInfo?.genericParameters,
            metadata: { nodeType: type },
          })
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
              symbols.push({
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
                  symbols.push({
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
                symbols.push({
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
            const targetName = ifaceType ? ifaceType.text : null
            if (targetName) {
              pushRel(
                name,
                targetName,
                ASTEngine.RelationshipType.Implements,
                1.0,
                { nodeType: "interface_implementation" },
                lineOf(ifaceType),
              )
            }
          }

          // Extract class inherits as relationships (search recursively within type)
          for (const inh of inherits) {
            const baseType = this.findDescendant(inh, (n) => n.type === "long_identifier" || n.type === "identifier")
            const targetName = baseType ? baseType.text : null
            if (targetName) {
              // FSD3: `inherit` is ALWAYS an extends edge. The retired rule here
              // was "the name starts with I and its second character is
              // uppercase, therefore implements" — a guess that mislabels a base
              // class named `IThing` and labels an interface by luck. F#
              // implements interfaces with `interface ... with` (handled above).
              pushRel(
                name,
                targetName,
                ASTEngine.RelationshipType.Extends,
                1.0,
                { nodeType: "class_inherits_decl" },
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
            if (leftNode)
              nameNode = this.findChild(leftNode, (n) => n.type === "identifier" || n.type === "identifier_pattern")
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

              symbols.push({
                name,
                kind,
                range: this.nodeToRange(node),
                ownerName: owner,
                isAsync,
                metadata: { nodeType: type },
              })

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
              if (kind === ASTEngine.SymbolKind.Method || kind === ASTEngine.SymbolKind.Function) {
                childCallOwner = name
              } else if (kind === ASTEngine.SymbolKind.Property) {
                childCallOwner = undefined
              } else {
                childCallOwner = callOwner
              }
              childBodyDepth = bodyDepth + 1
            } else {
              // Default impl of an abstract member: walk body, no symbol.
              childCallOwner = callOwner
              childBodyDepth = bodyDepth + 1
            }
          }
        }
      } else if (type === "additional_constr_defn") {
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          symbols.push({
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
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            ownerName: owner,
            metadata: { nodeType: "member_signature" },
          })
          if (owner) abstractMemberNames.add(`${owner}:${nameNode.text}`)
        }
      } else if (type === "val_property_defn") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode && nameNode.text) {
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "val_property_defn" },
          })
        }
      } else if (type === "object_expression") {
        const ifaceName = this.findDescendant(node, (n) => n.type === "long_identifier" || n.type === "identifier")
        if (ifaceName && ifaceName.text) {
          const ownerName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          symbols.push({
            name: "new " + ifaceName.text,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName,
            metadata: { nodeType: "object_expression" },
          })
          if (ownerName) {
            pushRel(
              ownerName,
              ifaceName.text,
              ASTEngine.RelationshipType.Implements,
              1.0,
              { nodeType: "object_expression" },
              lineOf(node),
            )
          }
        }
      } else if (type === "active_pattern") {
        // One function symbol named by the full active pattern, e.g. (|Even|Odd|)
        symbols.push({
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
          symbols.push({
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
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "module_val_declaration", isDeclaration: true },
          })
        }
      } else if (type === "type_extension") {
        const nameNode = this.findChild(node, (n) => n.type === "type_name" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const name = nameNode.text
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "type_extension" },
          })
        }
      } else if (type === "attribute") {
        const attrNameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (attrNameNode && attrNameNode.text) {
          const attrText = attrNameNode.text
          if (attrText.includes("TypeProvider") || attrText.includes("TypeProviderAssembly")) {
            symbols.push({
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
          pushRel(
            owner || "Global",
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
          symbols.push({
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
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
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

    // Exports: all public non-variable symbols
    for (const s of symbols) {
      const isVariable = s.kind === ASTEngine.SymbolKind.Variable
      if (!isVariable) {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
      }
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
