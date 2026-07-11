// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealFsharpAnalyzer implements LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    const walkStack: { node: Node; scopePath: string[] }[] = [{ node: rootNode, scopePath: [] }]

    while (walkStack.length > 0) {
      const { node, scopePath } = walkStack.pop()!
      const type = node.type

      let currentScope = [...scopePath]

      if (type === "namespace" || type === "named_module" || type === "module_defn") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const name = nameNode.text
          symbols.push({
            name,
            kind: type === "namespace" ? SymbolKind.Namespace : SymbolKind.Module,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
          currentScope.push(name)
        }
      } else if (type === "type_definition") {
        const nameNode = this.findDescendant(node, (n) => n.type === "type_name" || n.type === "identifier")
        const typeNameNode = nameNode ? this.findChild(nameNode, (n) => n.type === "identifier") : undefined
        const name = typeNameNode && typeNameNode.text ? typeNameNode.text : nameNode ? nameNode.text : null
        if (name) {
          const hasAnonTypeDefn = !!this.findChild(node, (n) => n.type === "anon_type_defn")
          const hasRecordTypeDefn = this.findDescendants(node, (n) => n.type === "record_type_defn").length > 0
          const hasUnionTypeDefn = this.findDescendants(node, (n) => n.type === "union_type_defn").length > 0
          const hasInterfaceTypeDefn = this.findDescendants(node, (n) => n.type === "interface_type_defn").length > 0
          const hasEnumTypeDefn = this.findDescendants(node, (n) => n.type === "enum_type_defn").length > 0
          const hasDelegateTypeDefn = this.findDescendants(node, (n) => n.type === "delegate_type_defn").length > 0
          const hasTypeAbbrevDefn = this.findDescendants(node, (n) => n.type === "type_abbrev_defn").length > 0

          let kind = SymbolKind.Class
          let isInterface = false
          var isMeasure = !!this.findDescendant(node, function(n) { return n.type === "attribute" && (n.text.includes("Measure") || n.text.includes("[<Measure")); });
          if (isMeasure) kind = SymbolKind.Type;
          if (hasRecordTypeDefn) {
            kind = SymbolKind.Struct
          } else if (hasUnionTypeDefn) {
            kind = SymbolKind.Enum
          } else if (hasInterfaceTypeDefn) {
            kind = SymbolKind.Interface
            isInterface = true
          } else if (hasEnumTypeDefn) {
            kind = SymbolKind.Enum
          } else if (hasDelegateTypeDefn) kind = SymbolKind.Type
          else if (hasTypeAbbrevDefn) kind = SymbolKind.Type
          else if (hasAnonTypeDefn) {
            const anonNode = this.findChild(node, (n) => n.type === "anon_type_defn")
            if (anonNode) {
              const memberSigs = this.findDescendants(anonNode, (n) => n.type === "member_signature")
              const hasMemberSig = memberSigs.length > 0
              const hasInherits = this.findDescendants(anonNode, (n) => n.type === "class_inherits_decl").length > 0
              const hasInterfaceImpl =
                this.findDescendants(anonNode, (n) => n.type === "interface_implementation").length > 0
              const hasInterfaceKeyword = !!this.findDescendant(
                anonNode,
                (n) => n.type === "identifier" && n.text === "interface",
              )
              const hasConcreteMembers = this.findDescendants(anonNode, (n) => n.type === "member_defn").length > 0
              if (hasMemberSig && !hasInherits && !hasInterfaceImpl && !hasConcreteMembers) {
                kind = SymbolKind.Interface
                isInterface = true
              } else if (hasInterfaceKeyword && !hasInherits && !hasConcreteMembers) {
                kind = SymbolKind.Interface
                isInterface = true
              } else if (
                name.startsWith("I") &&
                name.length > 1 &&
                name[1] === name[1].toUpperCase() &&
                hasMemberSig &&
                !hasInherits
              ) {
                kind = SymbolKind.Interface
                isInterface = true
              }
            }
          }

          symbols.push({
            name,
            kind,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
          currentScope.push(name)

          // Extract DU cases as EnumMember symbols
          if (kind === SymbolKind.Enum) {
            const unionDefns = this.findDescendants(node, (n) => n.type === "union_type_defn")
            for (const unionDefn of unionDefns) {
              const cases = this.findDescendants(unionDefn, (n) => n.type === "union_type_case")
              for (const c of cases) {
                const caseNameNode = this.findDescendant(c, (n) => n.type === "identifier")
                if (caseNameNode && caseNameNode.text) {
                  symbols.push({
                    name: caseNameNode.text,
                    kind: SymbolKind.EnumMember,
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
                  kind: SymbolKind.EnumMember,
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
              relationships.push({
                source: name,
                target: targetName,
                type: RelationshipType.Implements,
                metadata: { nodeType: "interface_implementation" },
              })
            }
          }

          // Extract class inherits as relationships (search recursively within type)
          const inherits = this.findDescendants(node, (n) => n.type === "class_inherits_decl", 8)
          for (const inh of inherits) {
            const baseType = this.findDescendant(inh, (n) => n.type === "long_identifier" || n.type === "identifier")
            const targetName = baseType ? baseType.text : null
            if (targetName) {
              const isIfaceImpl =
                targetName.startsWith("I") && targetName.length > 1 && targetName[1] === targetName[1].toUpperCase()
              relationships.push({
                source: name,
                target: targetName,
                type: isIfaceImpl ? RelationshipType.Implements : RelationshipType.Extends,
                metadata: { nodeType: "class_inherits_decl" },
              })
            }
          }
        }
      } else if (type === "value_declaration" || type === "function_or_value_defn" || type === "member_defn") {
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
              nameNode = idents.length >= 2 ? idents[1] : idents[0]
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
          // Check for override modifier (non-named keyword token in member_defn text)
          const hasOverride = type === "member_defn" && !!(node.text && /^override\b/.test(node.text))
          let kind: SymbolKind
          if (isMember && hasMethodOrProp) {
            const propNameNode = this.findDescendant(node, (n) => n.type === "property_or_ident")
            if (propNameNode) {
              const propText = propNameNode.text
              kind =
                propText.endsWith("_") || propText.includes("set")
                  ? SymbolKind.Property
                  : SymbolKind.Method
            } else {
              kind = SymbolKind.Method
            }
          } else if (isMember) {
            kind = SymbolKind.Method
          } else {
            kind = isFunc ? SymbolKind.Function : SymbolKind.Variable
          }

          if (node.type === "ce_expression" || node.type === "short_comp_expression") {
          var ceBuilder = node.namedChild(0);
          if (ceBuilder && (ceBuilder.type === "identifier" || ceBuilder.type === "long_identifier") && ceBuilder.text) {
            var ceOwner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined;
            if (ceOwner) {
              relationships.push({ source: ceOwner, target: ceBuilder.text, type: RelationshipType.Calls, confidence: 0.75, metadata: { nodeType: type, isComputationExpression: true } });
            }
          }
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
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            isAsync,
            metadata: { nodeType: type },
          })
          // Overrides relationship
          if (hasOverride) {
            const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
            if (owner) {
              relationships.push({
                source: owner,
                target: name,
                type: RelationshipType.Overrides,
                confidence: 0.9,
                metadata: { nodeType: type, isOverride: true },
              })
            }
          }
        }
      } else if (type === "additional_constr_defn") {
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          symbols.push({
            name: "new " + nameNode.text,
            kind: SymbolKind.Constructor,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "additional_constr_defn" },
          })
        }
      } else if (type === "member_signature") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "property_or_ident")
        if (nameNode && nameNode.text) {
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Method,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "member_signature" },
          })
        }
      } else if (type === "val_property_defn") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode && nameNode.text) {
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Property,
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
            kind: SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName,
            metadata: { nodeType: "object_expression" },
          })
          if (ownerName) {
            relationships.push({
              source: ownerName,
              target: ifaceName.text,
              type: RelationshipType.Implements,
              metadata: { nodeType: "object_expression" },
            })
            relationships.push({
              source: ownerName,
              target: ifaceName.text,
              type: RelationshipType.Instantiates,
              confidence: 0.85,
              metadata: { nodeType: "object_expression", isNew: true },
            })
          }
        }
      } else if (type === "active_pattern") {
        const nameNode = this.findChild(node, (n) => n.type === "active_pattern_op_name" || n.type === "identifier")
        if (nameNode && nameNode.text) {
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Function,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "active_pattern" },
          })
        }
      } else if (type === "exception_definition") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode && nameNode.text) {
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "exception_definition" },
          })
        }
      } else if (type === "type_extension") {
        const nameNode = this.findChild(node, (n) => n.type === "type_name" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const name = nameNode.text
          symbols.push({
            name,
            kind: SymbolKind.Class,
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
              kind: SymbolKind.Class,
              range: this.nodeToRange(node),
              ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
              metadata: { nodeType: "attribute", isTypeProvider: true },
            })
          }
        }
      } else if (type === "open_statement" || type === "open_decl") {
        var openTarget = this.findDescendant(node, function(n) { return n.type === "long_identifier" || n.type === "identifier"; });
        if (openTarget && openTarget.text) {
          imports.push({ module: openTarget.text, items: ["*"], isDefault: false, range: this.nodeToRange(node) });
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined;
          relationships.push({ source: owner || openTarget.text, target: openTarget.text, type: RelationshipType.References, confidence: 0.9, metadata: { nodeType: type, isOpen: true } });
        }
      } else if (type === "import_decl") {
        const targetNode = this.findChild(node, (n) => n.type === "long_identifier" || n.type === "identifier")
        if (targetNode && targetNode.text) {
          imports.push({
            module: targetNode.text,
            items: [],
            isDefault: true,
            range: this.nodeToRange(node),
          })
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined;
          relationships.push({ source: owner || targetNode.text, target: targetNode.text, type: RelationshipType.References, confidence: 0.9, metadata: { nodeType: type, isImport: true } });
        }
      } else if (type === "module_abbrev") {
        const children = this.filterChildren(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (children.length >= 2) {
          symbols.push({
            name: children[0].text,
            kind: SymbolKind.Module,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "module_abbrev" },
          })
          relationships.push({
            source: children[0].text,
            target: children[1].text,
            type: RelationshipType.References,
            metadata: { nodeType: "module_abbrev" },
          })
        }
      } else if (type === "brace_expression") {
        // Record creation: { Name = value; Age = value }
        const ownerName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
        if (ownerName) {
          const fieldInits = this.findDescendants(node, (n) => n.type === "field_initializer", 4)
          if (fieldInits.length > 0) {
            relationships.push({
              source: ownerName,
              target: "record_expression",
              type: RelationshipType.Instantiates,
              confidence: 0.7,
              metadata: { nodeType: "brace_expression", isRecord: true, fieldCount: fieldInits.length },
            })
            for (const fi of fieldInits) {
              const fieldId = this.findChild(fi, (n) => n.type === "long_identifier" || n.type === "identifier")
              if (fieldId?.text) {
                relationships.push({
                  source: ownerName,
                  target: fieldId.text,
                  type: RelationshipType.Uses,
                  confidence: 0.7,
                  metadata: { nodeType: "field_initializer", isFieldAccess: true },
                })
              }
            }
          }
        }
      } else if (type === "dot_expression" || type === "property_or_ident") {
        // this.Name, obj.Method — field/property access
        const identifiers = this.filterChildren(node, (n) => n.type === "identifier")
        if (identifiers.length >= 2) {
          const ownerName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          if (ownerName) {
            relationships.push({
              source: ownerName,
              target: node.text,
              type: RelationshipType.Uses,
              confidence: 0.6,
              metadata: { nodeType: type, isFieldAccess: true },
            })
          }
        }
      } else if (type === "app_expression" || type === "application_expression") {
        var fnNode = node.namedChild(0);
        if (fnNode) {
          var fnName = (fnNode.type === "long_identifier" || fnNode.type === "identifier" || fnNode.type === "long_identifier_or_op") ? fnNode.text : fnNode.type === "dot_expression" ? fnNode.text : "";
          if (fnName && fnName.length > 1) {
            var ownerName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined;
            if (ownerName) {
              relationships.push({ source: ownerName, target: fnName, type: RelationshipType.Calls, confidence: 0.8, metadata: { nodeType: type } });
            }
          }
        }
      } else if (type === "compiler_directive_decl" || type === "fsi_directive_decl") {
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Macro,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({ node: child, scopePath: currentScope })
        }
      }
    }

    // Add Contains relationships: scope owner → owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: { nodeType: s.metadata?.nodeType || "symbol", isContained: true },
        })
      }
    }

    // Exports: all public non-variable symbols
    for (const s of symbols) {
      const isVariable = s.kind === SymbolKind.Variable
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
