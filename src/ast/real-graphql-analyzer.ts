import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * REAL GRAPHQL ANALYZER — pure Tree-sitter AST extraction against the vendored
 * `tree-sitter-graphql` grammar (PascalCase node types: `ObjectTypeDefinition`,
 * `FieldDefinition`, `NamedType`, `OperationDefinition`, …).
 *
 * Symbol contract (declaration nodes only — usages are relationships):
 *   - `SchemaDefinition` → `namespace` `schema`, with root operation types as
 *     `property` children.
 *   - `ObjectTypeDefinition` → `class`; `InterfaceTypeDefinition` → `interface`;
 *     `UnionTypeDefinition` / `ScalarTypeDefinition` → `type`;
 *     `EnumTypeDefinition` → `enum`; `EnumValueDefinition` → `enum_member`;
 *     `InputObjectTypeDefinition` → `class`.
 *   - `FieldDefinition` / input `InputValueDefinition` → `property` (owned by
 *     the enclosing type).
 *   - `DirectiveDefinition` → `function` `@name`.
 *   - `OperationDefinition` / `FragmentDefinition` → `method`.
 *   - `VariableDefinition` → `variable` `$name` (owned by the operation).
 *
 * Relationship ontology:
 *   - `contains`   type → field, enum → value, input → field, schema → root op.
 *   - `implements` object/interface → implemented interface.
 *   - `uses`       type reference (field return/argument type, input field type,
 *                  union member) and executable reference (field selection,
 *                  fragment spread, inline-fragment type condition).
 *
 * Type names are read from the `NamedType → Name` grammar path (descending
 * through `NonNullType`/`ListType`); descriptions are unquoted from the
 * `Description → StringValue` leaf by string slicing — no source-text regex.
 * Syntax errors are owned by ASTEngine (tree-sitter ERROR/MISSING nodes).
 */
export class RealGraphqlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const relKeys = new Set<string>()
    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      metadata: Record<string, any> = {},
    ) => {
      const key = `${source}\u0000${type}\u0000${target}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      relationships.push({ source, target, type, confidence: 1, metadata })
    }

    interface Owner {
      name?: string
      kind?: ASTEngine.SymbolKind
    }

    const TYPE_KIND: Record<string, ASTEngine.SymbolKind> = {
      ObjectTypeDefinition: ASTEngine.SymbolKind.Class,
      InterfaceTypeDefinition: ASTEngine.SymbolKind.Interface,
      UnionTypeDefinition: ASTEngine.SymbolKind.Type,
      EnumTypeDefinition: ASTEngine.SymbolKind.Enum,
      ScalarTypeDefinition: ASTEngine.SymbolKind.Type,
      InputObjectTypeDefinition: ASTEngine.SymbolKind.Class,
    }

    const stack: { node: Node; owner: Owner }[] = [{ node: rootNode, owner: {} }]
    const pushChildren = (node: Node, owner: Owner) => {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner })
      }
    }

    const emitSymbol = (symbol: ASTEngine.UniversalSymbol) => symbols.push(symbol)

    while (stack.length > 0) {
      const { node, owner } = stack.pop()!
      const t = node.type

      // ---- Schema definition -------------------------------------------------
      if (t === "SchemaDefinition") {
        emitSymbol({
          name: "schema",
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          scope: "",
          visibility: "public",
          metadata: { graphqlType: "schema" },
        })
        for (let i = 0; i < node.namedChildCount; i++) {
          const opDef = node.namedChild(i)
          if (opDef?.type !== "OperationTypeDefinition") continue
          const opType = this.findChild(opDef, (n) => n.type === "OperationType")?.text ?? "operation"
          const named = this.findChild(opDef, (n) => n.type === "NamedType")
          const rootType = named ? this.nameOf(named) : undefined
          emitSymbol({
            name: opType,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(opDef),
            scope: "schema",
            returnType: rootType,
            ownerName: "schema",
            ownerKind: ASTEngine.SymbolKind.Namespace,
            metadata: { graphqlRole: "root_operation_type" },
          })
          addRelationship("schema", `schema.${opType}`, ASTEngine.RelationshipType.Contains)
          if (rootType) addRelationship(`schema.${opType}`, rootType, ASTEngine.RelationshipType.Uses, { relationshipRole: "root_operation_type" })
        }
        continue
      }

      // ---- Object / interface / input type definitions ----------------------
      if (t === "ObjectTypeDefinition" || t === "InterfaceTypeDefinition" || t === "InputObjectTypeDefinition") {
        const name = this.nameOf(node)
        if (name) {
          const kind = TYPE_KIND[t]
          emitSymbol({
            name,
            kind,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            docstring: this.docstring(node),
            metadata: { graphqlType: t },
          })
          // implements interfaces (object and interface types)
          if (t === "ObjectTypeDefinition" || t === "InterfaceTypeDefinition") {
            const implementsNode = this.findChild(node, (n) => n.type === "ImplementsInterfaces")
            if (implementsNode) {
              for (let i = 0; i < implementsNode.namedChildCount; i++) {
                const member = implementsNode.namedChild(i)
                if (member?.type !== "NamedType") continue
                const iface = this.nameOf(member)
                if (iface) addRelationship(name, iface, ASTEngine.RelationshipType.Implements)
              }
            }
          }
          pushChildren(node, { name, kind })
        }
        continue
      }

      // ---- Union type --------------------------------------------------------
      if (t === "UnionTypeDefinition") {
        const name = this.nameOf(node)
        if (name) {
          emitSymbol({
            name,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            docstring: this.docstring(node),
            metadata: { graphqlType: "union" },
          })
          const membersNode = this.findChild(node, (n) => n.type === "UnionMemberTypes")
          if (membersNode) {
            for (let i = 0; i < membersNode.namedChildCount; i++) {
              const member = membersNode.namedChild(i)
              if (member?.type !== "NamedType") continue
              const memberName = this.nameOf(member)
              if (memberName) addRelationship(name, memberName, ASTEngine.RelationshipType.Uses, { relationshipRole: "union_member" })
            }
          }
        }
        continue
      }

      // ---- Enum type ---------------------------------------------------------
      if (t === "EnumTypeDefinition") {
        const name = this.nameOf(node)
        if (name) {
          emitSymbol({
            name,
            kind: ASTEngine.SymbolKind.Enum,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            docstring: this.docstring(node),
            metadata: { graphqlType: "enum" },
          })
          pushChildren(node, { name, kind: ASTEngine.SymbolKind.Enum })
        }
        continue
      }

      // ---- Enum value --------------------------------------------------------
      if (t === "EnumValueDefinition") {
        const enumValue = this.findChild(node, (n) => n.type === "EnumValue")
        const valueName = enumValue ? this.nameOf(enumValue) : undefined
        if (valueName && owner.name) {
          emitSymbol({
            name: valueName,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            scope: owner.name,
            ownerName: owner.name,
            ownerKind: owner.kind,
            docstring: this.docstring(node),
            metadata: { graphqlRole: "enum_value" },
          })
          addRelationship(owner.name, `${owner.name}.${valueName}`, ASTEngine.RelationshipType.Contains)
        }
        continue
      }

      // ---- Scalar type -------------------------------------------------------
      if (t === "ScalarTypeDefinition") {
        const name = this.nameOf(node)
        if (name) {
          emitSymbol({
            name,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            docstring: this.docstring(node),
            metadata: { graphqlType: "scalar" },
          })
        }
        continue
      }

      // ---- Directive definition ----------------------------------------------
      if (t === "DirectiveDefinition") {
        const name = this.nameOf(node)
        if (name) {
          const directiveName = `@${name}`
          const argsNode = this.findChild(node, (n) => n.type === "ArgumentsDefinition")
          emitSymbol({
            name: directiveName,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            parameters: argsNode ? this.extractArguments(argsNode) : undefined,
            docstring: this.docstring(node),
            metadata: { graphqlRole: "directive_definition" },
          })
        }
        continue
      }

      // ---- Field definition (SDL) --------------------------------------------
      if (t === "FieldDefinition") {
        const fieldName = this.nameOf(node)
        if (fieldName && owner.name) {
          const typeNode = this.findChild(node, (n) => n.type === "Type")
          const returnType = typeNode ? this.namedTypeName(typeNode) : undefined
          const argsNode = this.findChild(node, (n) => n.type === "ArgumentsDefinition")
          const params = argsNode ? this.extractArguments(argsNode) : undefined
          emitSymbol({
            name: fieldName,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(node),
            scope: owner.name,
            returnType,
            ownerName: owner.name,
            ownerKind: owner.kind,
            parameters: params,
            docstring: this.docstring(node),
            metadata: { graphqlRole: "field", rawType: typeNode?.text },
          })
          addRelationship(owner.name, `${owner.name}.${fieldName}`, ASTEngine.RelationshipType.Contains)
          if (returnType) {
            addRelationship(`${owner.name}.${fieldName}`, returnType, ASTEngine.RelationshipType.Uses, { relationshipRole: "field_return_type" })
          }
          if (argsNode) {
            for (const arg of this.argumentPairs(argsNode)) {
              if (arg.type) addRelationship(`${owner.name}.${fieldName}`, arg.type, ASTEngine.RelationshipType.Uses, { relationshipRole: "field_argument_type" })
            }
          }
        }
        continue
      }

      // ---- Input field (InputValueDefinition under InputFieldsDefinition) ----
      if (t === "InputValueDefinition" && node.parent?.type === "InputFieldsDefinition") {
        const fieldName = this.nameOf(node)
        if (fieldName && owner.name) {
          const typeNode = this.findChild(node, (n) => n.type === "Type")
          const fieldType = typeNode ? this.namedTypeName(typeNode) : undefined
          emitSymbol({
            name: fieldName,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(node),
            scope: owner.name,
            returnType: fieldType,
            ownerName: owner.name,
            ownerKind: owner.kind,
            docstring: this.docstring(node),
            metadata: { graphqlRole: "input_field", rawType: typeNode?.text },
          })
          addRelationship(owner.name, `${owner.name}.${fieldName}`, ASTEngine.RelationshipType.Contains)
          if (fieldType) {
            addRelationship(`${owner.name}.${fieldName}`, fieldType, ASTEngine.RelationshipType.Uses, { relationshipRole: "input_field_type" })
          }
        }
        continue
      }

      // ---- Operation definition ----------------------------------------------
      if (t === "OperationDefinition") {
        const opType = this.findChild(node, (n) => n.type === "OperationType")?.text ?? "query"
        const nameNode = this.findChild(node, (n) => n.type === "Name")
        const opName = nameNode?.text ?? `Anonymous_${opType}_${node.startPosition.row + 1}`
        emitSymbol({
          name: opName,
          kind: ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          scope: "",
          visibility: "public",
          metadata: { graphqlOperationType: opType },
        })
        // variables
        const varsNode = this.findChild(node, (n) => n.type === "VariableDefinitions")
        if (varsNode) {
          for (let i = 0; i < varsNode.namedChildCount; i++) {
            const varDef = varsNode.namedChild(i)
            if (varDef?.type !== "VariableDefinition") continue
            const varNode = this.findChild(varDef, (n) => n.type === "Variable")
            const varName = varNode ? this.nameOf(varNode) : undefined
            const typeNode = this.findChild(varDef, (n) => n.type === "Type")
            if (varName) {
              emitSymbol({
                name: `$${varName}`,
                kind: ASTEngine.SymbolKind.Variable,
                range: this.nodeToRange(varDef),
                scope: opName,
                returnType: typeNode ? this.namedTypeName(typeNode) : undefined,
                ownerName: opName,
                ownerKind: ASTEngine.SymbolKind.Method,
                metadata: { graphqlRole: "variable", rawType: typeNode?.text },
              })
            }
          }
        }
        pushChildren(node, { name: opName, kind: ASTEngine.SymbolKind.Method })
        continue
      }

      // ---- Fragment definition ------------------------------------------------
      if (t === "FragmentDefinition") {
        const fragNode = this.findChild(node, (n) => n.type === "FragmentName")
        const fragName = fragNode ? this.nameOf(fragNode) : undefined
        if (fragName) {
          emitSymbol({
            name: fragName,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            metadata: { graphqlRole: "fragment" },
          })
          const typeCondition = this.findChild(node, (n) => n.type === "TypeCondition")
          const onType = typeCondition ? this.namedTypeName(typeCondition) : undefined
          if (onType) addRelationship(fragName, onType, ASTEngine.RelationshipType.Uses, { relationshipRole: "fragment_type_condition" })
          pushChildren(node, { name: fragName, kind: ASTEngine.SymbolKind.Method })
        }
        continue
      }

      // ---- Variable definition (inside operation; also reached generically) --
      if (t === "VariableDefinition") {
        // Already emitted by the OperationDefinition handler; do not duplicate.
        continue
      }

      // ---- Executable field selection -----------------------------------------
      if (t === "Field" && this.isExecutableField(node)) {
        const fieldName = this.nameOf(node)
        if (fieldName && owner.name) {
          addRelationship(owner.name, fieldName, ASTEngine.RelationshipType.Uses, { relationshipRole: "field_selection" })
        }
        pushChildren(node, owner)
        continue
      }

      // ---- Fragment spread ----------------------------------------------------
      if (t === "FragmentSpread") {
        const spreadNode = this.findChild(node, (n) => n.type === "FragmentName")
        const spreadName = spreadNode ? this.nameOf(spreadNode) : undefined
        if (spreadName && owner.name) {
          addRelationship(owner.name, spreadName, ASTEngine.RelationshipType.Uses, { relationshipRole: "fragment_spread" })
        }
        continue
      }

      // ---- Inline fragment ----------------------------------------------------
      if (t === "InlineFragment") {
        const typeCondition = this.findChild(node, (n) => n.type === "TypeCondition")
        const onType = typeCondition ? this.namedTypeName(typeCondition) : undefined
        if (onType && owner.name) {
          addRelationship(owner.name, onType, ASTEngine.RelationshipType.Uses, { relationshipRole: "inline_fragment_type_condition" })
        }
        pushChildren(node, owner)
        continue
      }

      // ---- Default: descend through wrappers ----------------------------------
      pushChildren(node, owner)
    }

    for (const s of symbols) {
      if ((s.scope ?? "") === "") {
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

  /** A `Field` node is an executable selection; SDL declarations are `FieldDefinition`. */
  private isExecutableField(node: Node): boolean {
    return node.parent?.type === "Selection" || node.parent?.type === "SelectionSet"
  }

  /** The definition name: direct `Name` child, or a nested name wrapper. */
  private nameOf(node: Node): string | undefined {
    const direct = this.findChild(node, (n) => n.type === "Name")
    if (direct) return direct.text
    return undefined
  }

  /** Resolve a `Type`/`TypeCondition` node to its base named type name. */
  private namedTypeName(typeNode: Node): string | undefined {
    const named = this.findDescendant(typeNode, (n) => n.type === "NamedType")
    if (!named) return undefined
    return this.nameOf(named)
  }

  /** Unquote a `StringValue` (regular or block) without regex. */
  private docstring(defNode: Node): string | undefined {
    const desc = this.findChild(defNode, (n) => n.type === "Description")
    if (!desc) return undefined
    const sv = this.findChild(desc, (n) => n.type === "StringValue")
    if (!sv) return undefined
    const raw = sv.text
    if (raw.startsWith('"""')) {
      const inner = raw.slice(3)
      return inner.endsWith('"""') ? inner.slice(0, -3).trim() : inner.trim()
    }
    if (raw.startsWith('"')) {
      const inner = raw.slice(1)
      return inner.endsWith('"') ? inner.slice(0, -1) : inner
    }
    return raw
  }

  private extractArguments(argsNode: Node): ASTEngine.Parameter[] {
    const params: ASTEngine.Parameter[] = []
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const arg = argsNode.namedChild(i)
      if (arg?.type !== "InputValueDefinition") continue
      const name = this.nameOf(arg)
      const typeNode = this.findChild(arg, (n) => n.type === "Type")
      if (!name) continue
      params.push({
        name,
        type: typeNode ? this.namedTypeName(typeNode) : undefined,
        isOptional: typeNode ? !typeNode.text.includes("!") : true,
      })
    }
    return params
  }

  private argumentPairs(argsNode: Node): { name?: string; type?: string }[] {
    const pairs: { name?: string; type?: string }[] = []
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const arg = argsNode.namedChild(i)
      if (arg?.type !== "InputValueDefinition") continue
      const typeNode = this.findChild(arg, (n) => n.type === "Type")
      pairs.push({ name: this.nameOf(arg), type: typeNode ? this.namedTypeName(typeNode) : undefined })
    }
    return pairs
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (predicate(child)) return child
      const found = this.findDescendant(child, predicate)
      if (found) return found
    }
    return null
  }
}
