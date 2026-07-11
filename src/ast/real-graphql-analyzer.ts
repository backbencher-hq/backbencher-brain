// @ts-nocheck — Ported from backbencher.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"

export class RealGraphqlAnalyzer implements LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []

    // Extract imports — GraphQL uses #import directive (tool-specific convention)
    // This is a pragma, not part of the GraphQL AST spec, so regex is the practical approach
    const gqlMatches = content.matchAll(/#import\s+["\x27]([^"\x27]+)["\x27]/g)
    for (const m of gqlMatches) {
      const importPath = m[1].replace(/["<>]/g, "")
      imports.push({ module: importPath, items: [], importType: "gql_import", lineNumber: 0, isExternal: m[0].includes("<") || !importPath.startsWith(".") })
      relationships.push({
        source: "schema",
        target: importPath,
        type: RelationshipType.References,
        confidence: 0.8,
        metadata: { isGqlImport: true },
      })
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

      // Pass-through wrapper nodes from newer grammar (tree-sitter-graphql ABI 14+)
      if (type === "Document" || type === "Definition" || type === "TypeSystemDefinition" || type === "TypeSystemExtension" || type === "ExecutableDefinition" || type === "TypeDefinition") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) walkStack.push({ node: child, scopePath: currentScope, ownerName: currentOwnerName, ownerKind: currentOwnerKind })
        }
        continue
      }

      if (type === "schema_definition" || type === "SchemaDefinition" || type === "schema_extension" || type === "SchemaExtension") {
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
          if (child.type === "operation_type_definition" || child.type === "OperationTypeDefinition") {
            const opTypeNode = child.namedChild(0)
            const namedTypeNode = this.findChild(child, (n) => n.type === "named_type" || n.type === "NamedType")
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
        type === "object_type_definition" || type === "ObjectTypeDefinition" ||
        type === "interface_type_definition" || type === "InterfaceTypeDefinition" ||
        type === "enum_type_definition" || type === "EnumTypeDefinition" ||
        type === "union_type_definition" || type === "UnionTypeDefinition" ||
        type === "scalar_type_definition" || type === "ScalarTypeDefinition" ||
        type === "input_object_type_definition" || type === "InputObjectTypeDefinition" ||
        type === "object_type_extension" || type === "ObjectTypeExtension" ||
        type === "interface_type_extension" || type === "InterfaceTypeExtension" ||
        type === "input_object_type_extension" || type === "InputObjectTypeExtension" ||
        type === "union_type_extension" || type === "UnionTypeExtension" ||
        type === "enum_type_extension" || type === "EnumTypeExtension" ||
        type === "scalar_type_extension" || type === "ScalarTypeExtension"
      ) {
        const nameNode = this.findChild(node, (n) => n.type === "name" || n.type === "Name")
        if (nameNode) {
          const typeName = nameNode.text
          let kind = SymbolKind.Class
          if (type.includes("interface")) kind = SymbolKind.Interface
          if (type.includes("enum")) kind = SymbolKind.Enum
          if (type.includes("union")) kind = SymbolKind.Type
          if (type.includes("scalar")) kind = SymbolKind.Type
          if (type.includes("input_object") || type.includes("input_object")) kind = SymbolKind.Interface

          const isExtension = type.includes("extension") || type.includes("Extension")
          const graphqlType = type.replace("_type_definition", "").replace("_type_extension", "_extension")

          const descNode = this.findChild(node, (n) => n.type === "string_value" || n.type === "StringValue" || n.type === "description" || n.type === "Description")
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
              source: symbolId,
              target: typeName,
              type: RelationshipType.Extends,
              metadata: { extensionType: graphqlType },
            })
          }

          const implementsInterfaces = this.findChild(node, (n) => n.type === "implements_interfaces" || n.type === "ImplementsInterfaces")
          if (implementsInterfaces) {
            for (let i = 0; i < implementsInterfaces.namedChildCount; i++) {
              const child = implementsInterfaces.namedChild(i)!
              let interfaceName: string | null = null
              if (child.type === "named_type" || child.type === "NamedType") {
                const innerName = this.findChild(child, (n) => n.type === "name" || n.type === "Name")
                interfaceName = innerName?.text || child.text
              } else if (child.type === "name" || child.type === "Name") {
                interfaceName = child.text
              }
              if (interfaceName) {
                relationships.push({
                  source: symbolId,
                  target: interfaceName,
                  type: RelationshipType.Implements,
                  metadata: {},
                })
              }
            }
          }
        }
      }

      const parentType = node.parent?.type
      if (
        type === "field_definition" || type === "FieldDefinition" ||
        type === "enum_value_definition" || type === "EnumValueDefinition" ||
        (type === "input_value_definition" || type === "InputValueDefinition") && parentType !== "arguments_definition" && parentType !== "ArgumentsDefinition"
      ) {
        const nameNode = this.findChild(node, (n) => n.type === "name" || n.type === "Name" || n.type === "enum_value" || n.type === "EnumValue")
        if (nameNode) {
          const fieldName = nameNode.text
          const typeNode = this.findChild(node, (n) => n.type === "type" || n.type === "Type")
          const returnType = typeNode ? typeNode.text : undefined
          const argumentsNode = this.findChild(node, (n) =>
            n.type === "arguments" || n.type === "Arguments" ||
            n.type === "input_fields_definition" || n.type === "InputFieldsDefinition" ||
            n.type === "ArgumentsDefinition"
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
              source: currentOwnerName,
              target: fieldSymbolId,
              type: RelationshipType.Contains,
              metadata: { role: type === "enum_value_definition" ? "enum_value" : "field" },
            })
          }

          if (returnType) {
            const cleanType = returnType.replace(/[\[\]!]/g, "")
            if (cleanType && cleanType !== fieldName) {
              relationships.push({
                source: fieldSymbolId,
                target: cleanType,
                type: RelationshipType.Uses,
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
            source: currentOwnerName,
            target: nameNode.text,
            type: RelationshipType.Uses,
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
              source: currentOwnerName,
              target: namedType.text,
              type: RelationshipType.Uses,
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

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (!s.ownerName || s.ownerName === "Schema" || s.ownerKind === "namespace") {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
      }
    }
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
