// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealGraphqlAnalyzer implements LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []

    const gqlMatches = content.matchAll(/#import\s+["\x27]([^"\x27]+)["\x27]/g)
    for (const m of gqlMatches) {
      imports.push({ module: m[1].replace(/["<>]/g, ""), items: [], importType: "gql_import", lineNumber: 0, isExternal: m[0].includes("<") || !m[1].startsWith(".") })
    }

    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    const walkStack: { node: Node; scopePath: string[]; ownerName: string; ownerKind: string }[] = [
      { node: rootNode, scopePath: [], ownerName: "", ownerKind: "" },
    ]

    while (walkStack.length > 0) {
      const { node, scopePath, ownerName, ownerKind } = walkStack.pop()!
      const type = node.type
      let currentScope = [...scopePath]
      let currentOwnerName = ownerName
      let currentOwnerKind = ownerKind

      if (type === "schema_definition" || type === "schema_extension") {
        const schemaName = type === "schema_extension" ? "SchemaExtension" : "Schema"
        const schemaSymbol: UniversalSymbol = {
          name: schemaName,
          kind: SymbolKind.Namespace,
          range: {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
          },
          scope: currentScope.join("."),
          ownerName: currentOwnerName || undefined,
          ownerKind: (currentOwnerKind as any) || undefined,
          metadata: {
            graphqlType: type === "schema_extension" ? "schema_extension" : "schema",
          },
        }
        symbols.push(schemaSymbol)
        currentScope.push(schemaName)
        currentOwnerName = schemaName
        currentOwnerKind = "namespace"

        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)!
          if (child.type === "operation_type_definition") {
            const opTypeNode = child.namedChild(0)
            const namedTypeNode = this.findChild(child, (n) => n.type === "named_type")
            if (opTypeNode) {
              const opType = opTypeNode.text
              const returnType = namedTypeNode ? namedTypeNode.text : undefined
              const fieldSymbol: UniversalSymbol = {
                name: opType,
                kind: SymbolKind.Property,
                range: {
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                  startColumn: child.startPosition.column,
                  endColumn: child.endPosition.column,
                  startIndex: child.startIndex,
                  endIndex: child.endIndex,
                },
                scope: currentScope.join("."),
                returnType,
                ownerName: currentOwnerName,
                ownerKind: currentOwnerKind as any,
                metadata: { graphqlRole: "root_operation_type" },
              }
              symbols.push(fieldSymbol)
            }
          }
        }
      }

      if (
        type === "object_type_definition" ||
        type === "interface_type_definition" ||
        type === "enum_type_definition" ||
        type === "union_type_definition" ||
        type === "scalar_type_definition" ||
        type === "input_object_type_definition" ||
        type === "object_type_extension" ||
        type === "interface_type_extension" ||
        type === "input_object_type_extension" ||
        type === "union_type_extension" ||
        type === "enum_type_extension" ||
        type === "scalar_type_extension"
      ) {
        const nameNode = this.findChild(node, (n) => n.type === "name")
        if (nameNode) {
          const typeName = nameNode.text
          let kind = SymbolKind.Class
          if (type.includes("interface")) kind = SymbolKind.Interface
          if (type.includes("enum")) kind = SymbolKind.Enum
          if (type.includes("union")) kind = SymbolKind.Type
          if (type.includes("scalar")) kind = SymbolKind.Type
          if (type.includes("input_object") || type.includes("input_object")) kind = SymbolKind.Interface

          const isExtension = type.includes("extension")
          const graphqlType = type.replace("_type_definition", "").replace("_type_extension", "_extension")

          const descNode = this.findChild(node, (n) => n.type === "string_value" || n.type === "description")
          const docstring = descNode
            ? descNode.text
                .replace(/^"""|"""$/g, "")
                .replace(/^"|"$/g, "")
                .trim()
            : undefined

          const typeSymbol: UniversalSymbol = {
            name: typeName,
            kind,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            ownerName: currentOwnerName || undefined,
            ownerKind: (currentOwnerKind as any) || undefined,
            docstring,
            metadata: {
              graphqlType,
              isExtension,
            },
          }
          symbols.push(typeSymbol)
          const symbolId = `${typeName}:${node.startPosition.row + 1}`

          currentScope.push(typeName)
          currentOwnerName = typeName
          currentOwnerKind = kind.toString()

          if (isExtension) {
            relationships.push({
              type: RelationshipType.Extends,
              sourceId: symbolId,
              targetId: typeName,
              metadata: { extensionType: graphqlType },
            })
          }

          const implementsInterfaces = this.findChild(node, (n) => n.type === "implements_interfaces")
          if (implementsInterfaces) {
            for (let i = 0; i < implementsInterfaces.namedChildCount; i++) {
              const child = implementsInterfaces.namedChild(i)!
              const interfaceName =
                child.type === "named_type"
                  ? this.findChild(child, (n) => n.type === "name")?.text || child.text
                  : child.type === "name"
                    ? child.text
                    : null
              if (interfaceName) {
                relationships.push({
                  type: RelationshipType.Implements,
                  sourceId: symbolId,
                  targetId: interfaceName,
                  metadata: {},
                })
              }
            }
          }
        }
      }

      const parentType = node.parent?.type
      if (
        type === "field_definition" ||
        type === "enum_value_definition" ||
        (type === "input_value_definition" && parentType !== "arguments_definition")
      ) {
        const nameNode = this.findChild(node, (n) => n.type === "name" || n.type === "enum_value")
        if (nameNode) {
          const fieldName = nameNode.text
          const typeNode = this.findChild(node, (n) => n.type === "type")
          const returnType = typeNode ? typeNode.text : undefined
          const argumentsNode = this.findChild(
            node,
            (n) => n.type === "arguments" || n.type === "input_fields_definition",
          )

          const fieldSymbol: UniversalSymbol = {
            name: fieldName,
            kind: SymbolKind.Property,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            returnType,
            ownerName: currentOwnerName || undefined,
            ownerKind: (currentOwnerKind as any) || undefined,
            parameters: argumentsNode ? this.extractArguments(argumentsNode) : undefined,
            metadata: {
              graphqlRole:
                type === "enum_value_definition"
                  ? "enum_value"
                  : type === "input_value_definition"
                    ? "input_field"
                    : "field",
            },
          }
          symbols.push(fieldSymbol)

          const fieldSymbolId = `${currentOwnerName}.${fieldName}:${node.startPosition.row + 1}`

          if (currentOwnerName) {
            relationships.push({
              type: RelationshipType.Contains,
              sourceId: currentOwnerName,
              targetId: fieldSymbolId,
              metadata: { role: type === "enum_value_definition" ? "enum_value" : "field" },
            })
          }

          if (returnType) {
            const cleanType = returnType.replace(/[\[\]!]/g, "")
            if (cleanType && cleanType !== fieldName) {
              relationships.push({
                type: RelationshipType.Uses,
                sourceId: fieldSymbolId,
                targetId: cleanType,
                metadata: { relationshipRole: "field_return_type" },
              })
            }
          }
        }
      }

      if (type === "directive_definition") {
        const nameNode = this.findChild(node, (n) => n.type === "name")
        if (nameNode) {
          const directiveName = `@${nameNode.text}`
          const argumentsNode = this.findChild(node, (n) => n.type === "arguments_definition")
          const dirDefSymbol: UniversalSymbol = {
            name: directiveName,
            kind: SymbolKind.Function,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            ownerName: currentOwnerName || undefined,
            ownerKind: (currentOwnerKind as any) || undefined,
            parameters: argumentsNode ? this.extractArguments(argumentsNode) : undefined,
            metadata: { graphqlRole: "directive_definition" },
          }
          symbols.push(dirDefSymbol)
          currentScope.push(directiveName)
          currentOwnerName = directiveName
          currentOwnerKind = "function"
        }
      }

      if (type === "operation_definition" || type === "fragment_definition") {
        const nameNode = this.findChild(node, (n) => n.type === "name")
        const opTypeNode = this.findChild(node, (n) => n.type === "operation_type")
        const opType = opTypeNode ? opTypeNode.text : type === "fragment_definition" ? "fragment" : "query"
        const opName = nameNode ? nameNode.text : `Anonymous_${opType}_${node.startPosition.row}`

        const opSymbol: UniversalSymbol = {
          name: opName,
          kind: SymbolKind.Method,
          range: {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
          },
          scope: currentScope.join("."),
          metadata: {
            graphqlOperationType: opType,
          },
        }
        symbols.push(opSymbol)
        currentScope.push(opName)
        currentOwnerName = opName
        currentOwnerKind = "method"
      }

      if (type === "directive" && node.parent && node.parent.type !== "directive_definition") {
        const nameNode = this.findChild(node, (n) => n.type === "name")
        if (nameNode) {
          const dirSymbol: UniversalSymbol = {
            name: `@${nameNode.text}`,
            kind: SymbolKind.Constructor,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            ownerName: currentOwnerName || undefined,
            ownerKind: (currentOwnerKind as any) || undefined,
            metadata: { graphqlRole: "directive_usage" },
          }
          symbols.push(dirSymbol)
        }
      }

      if (type === "fragment_spread") {
        const nameNode = this.findChild(node, (n) => n.type === "name")
        if (nameNode && currentOwnerName) {
          relationships.push({
            type: RelationshipType.Uses,
            sourceId: currentOwnerName,
            targetId: nameNode.text,
            metadata: { usageType: "fragment_spread" },
          })
        }
      }

      if (type === "inline_fragment") {
        const typeCondition = this.findChild(node, (n) => n.type === "type_condition")
        if (typeCondition) {
          const namedType = this.findChild(typeCondition, (n) => n.type === "named_type")
          if (namedType && currentOwnerName) {
            relationships.push({
              type: RelationshipType.Uses,
              sourceId: currentOwnerName,
              targetId: namedType.text,
              metadata: { usageType: "inline_fragment_type_condition" },
            })
          }
        }
      }

      if (type === "variable_definition") {
        const varNode = this.findChild(node, (n) => n.type === "variable")
        const typeNode = this.findChild(node, (n) => n.type === "type")
        if (varNode && typeNode) {
          const varSymbol: UniversalSymbol = {
            name: varNode.text,
            kind: SymbolKind.Variable,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            returnType: typeNode.text,
            ownerName: currentOwnerName || undefined,
            ownerKind: (currentOwnerKind as any) || undefined,
            metadata: { graphqlRole: "variable" },
          }
          symbols.push(varSymbol)
        }
      }

      if (type === "ERROR") {
        errors.push({
          message: `GraphQL Syntax Error at ${node.startPosition.row + 1}:${node.startPosition.column}`,
          range: {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
          },
          severity: "error",
        })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({
            node: child,
            scopePath: currentScope,
            ownerName: currentOwnerName,
            ownerKind: currentOwnerKind,
          })
        }
      }
    }

    for (var _gi = 0; _gi < symbols.length; _gi++) { var gs = symbols[_gi]; if (!gs.ownerName || gs.ownerName === "Schema" || gs.ownerKind === "namespace") { exports.push({ name: gs.name, kind: gs.kind, range: gs.range, visibility: "public" }); } }
    return {
      language: "graphql",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "GraphQL",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
      },
    }
  }

  private extractArguments(argsNode: Node): Parameter[] {
    const params: Parameter[] = []
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const arg = argsNode.namedChild(i)!
      if (arg.type === "input_value_definition" || arg.type === "argument" || arg.type === "variable_definition") {
        const nameNode = this.findChild(arg, (n) => n.type === "name" || n.type === "variable")
        const typeNode = this.findChild(arg, (n) => n.type === "type")
        if (nameNode) {
          params.push({
            name: nameNode.text,
            type: typeNode ? typeNode.text : undefined,
            isOptional: !typeNode ? true : !typeNode.text.includes("!"),
          })
        }
      }
    }
    return params
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) {
        return child
      }
    }
    return null
  }
}
