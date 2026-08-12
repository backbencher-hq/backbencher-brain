import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * REAL ZIG ANALYZER v6.0 — declaration-site-only extraction.
 *
 * Grounded in the verified tree-sitter-zig AST shape:
 *   - Top-level and container-level `variable_declaration` nodes carry the
 *     container kinds: `const X = struct {...}`, `enum {...}`, `union(enum) {...}`,
 *     `error{...}`, or plain constants/type aliases.
 *   - `container_field` nodes are struct/union members (→ Property) or enum
 *     members (→ EnumMember).
 *   - `function_declaration` nodes are Methods inside containers, Functions at
 *     file scope.
 *   - Control-flow, type-annotation, call, block, and field-access nodes are
 *     EXECUTION ARTIFACTS, not declaration sites — they never become symbols.
 */
export class RealZigAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // Walk context: node + the nearest enclosing declaration context.
    // Context is null (file scope), a container symbol (struct/enum/union), or
    // a function symbol (whose body must not produce declaration symbols).
    const walkStack: { node: Node; container: ASTEngine.UniversalSymbol | null; inFunction: boolean }[] = [
      { node: rootNode, container: null, inFunction: false },
    ]

    while (walkStack.length > 0) {
      const item = walkStack.pop()!
      const { node, container, inFunction } = item
      const type = node.type
      const nodeText = this.nodeText(node)

      // ─── CONTAINER / CONSTANT DECLARATION: const X = ... ───
      if (type === "variable_declaration") {
        // Inside a function body: locals are execution artifacts — skip.
        if (inFunction) {
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }

        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        const varName = identNode ? identNode.text : ""
        if (!varName || varName.length > 80) {
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }

        const isExported = nodeText.startsWith("pub ") || nodeText.startsWith("export ")
        const children = this.getAllNamedChildren(node)
        const rhs = children[children.length - 1]
        const rhsType = rhs?.type || ""
        const rhsText = rhs ? this.nodeText(rhs) : ""

        // @import / @cImport: an import, not a symbol.
        if (rhsType === "call_expression" || rhsType === "builtin_function") {
          const builtin = this.anyChild(rhs, (n) => n.type === "builtin_identifier")
          if (builtin && (builtin.text === "@import" || builtin.text === "@cImport")) {
            const argsNode = this.anyChild(rhs, (n) => n.type === "arguments")
            const strNode = argsNode ? this.anyChild(argsNode, (n) => n.type === "string" || n.type === "string_content") : null
            if (strNode) {
              let importTarget = strNode.text
              if (
                (importTarget.startsWith('"') && importTarget.endsWith('"')) ||
                (importTarget.startsWith("'") && importTarget.endsWith("'"))
              ) {
                importTarget = importTarget.substring(1, importTarget.length - 1)
              }
              imports.push({
                module: importTarget,
                isDefaultImport: false,
                range: this.nodeRange(node),
                metadata: { zigImport: true, builtin: builtin.text },
              })
              relationships.push({
                source: container?.name || "global",
                target: importTarget,
                type: ASTEngine.RelationshipType.Imports,
                confidence: 0.9,
                metadata: { zigImport: true },
              } as any)
            }
            this.pushChildren(node, walkStack, container, inFunction)
            continue
          }
        }

        let kind: ASTEngine.SymbolKind = ASTEngine.SymbolKind.Constant
        const isContainer =
          rhsType === "struct_declaration" ||
          rhsType === "enum_declaration" ||
          rhsType === "union_declaration" ||
          rhsType === "error_set_declaration"

        if (rhsType === "struct_declaration") kind = ASTEngine.SymbolKind.Struct
        else if (rhsType === "enum_declaration") kind = ASTEngine.SymbolKind.Enum
        else if (rhsType === "union_declaration") kind = ASTEngine.SymbolKind.Union
        else if (rhsType === "error_set_declaration") kind = ASTEngine.SymbolKind.Enum
        else if (
          rhsType === "number_literal" ||
          rhsType === "integer" ||
          rhsType === "float" ||
          rhsType === "string" ||
          rhsType === "boolean_literal" ||
          rhsType === "char_literal" ||
          rhsType === "builtin_type"
        ) {
          // Value constant (`const MAX_POINTS: usize = 1024`) — not a type.
          kind = ASTEngine.SymbolKind.Constant
        } else if (varName[0] === varName[0].toUpperCase() && varName[0] !== varName[0].toLowerCase()) {
          kind = ASTEngine.SymbolKind.Type
        }

        const sym: ASTEngine.UniversalSymbol = {
          name: varName,
          kind,
          visibility: isExported ? "public" : "private",
          range: this.nodeRange(node),
          scope: container ? container.name : undefined,
          ownerName: container?.name,
          ownerKind: container?.kind,
          metadata: {
            zigDeclaration: kind,
            ...(rhsType === "error_set_declaration" ? { zigErrorSet: true } : {}),
          },
        }
        symbols.push(sym)
        if (isExported) exports.push({ name: varName, kind })

        // Container members belong to the new container symbol.
        const newContainer = isContainer ? sym : container
        this.pushChildren(node, walkStack, newContainer, inFunction)
        continue
      }

      // ─── FUNCTION DECLARATION: pub fn name(...) ───
      if (type === "function_declaration" || type === "function_signature") {
        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        const fnName = identNode ? identNode.text : ""
        const isExported = nodeText.startsWith("pub ") || nodeText.startsWith("export ")
        const isInline = nodeText.includes("inline ")

        if (fnName && fnName.length < 100) {
          const params: ASTEngine.Parameter[] = []
          const paramsNode = this.anyChild(node, (n) => n.type === "parameters")
          if (paramsNode) {
            for (let i = 0; i < paramsNode.namedChildCount; i++) {
              const child = paramsNode.namedChild(i)
              if (!child || child.type !== "parameter") continue
              const pNameNode = this.anyChild(child, (n) => n.type === "identifier")
              const pTypeNode = this.anyChild(
                child,
                (n) =>
                  n.type === "builtin_type" ||
                  n.type === "nullable_type" ||
                  n.type === "slice_type" ||
                  n.type === "pointer_type" ||
                  n.type === "error_union_type",
              )
              if (pNameNode) {
                params.push({
                  name: pNameNode.text,
                  type: pTypeNode ? this.nodeText(pTypeNode) : undefined,
                })
              }
            }
          }

          // Inside a struct/union/enum container → method; else free function.
          const isMethod = !!container && container.kind !== ASTEngine.SymbolKind.Type
          const sym: ASTEngine.UniversalSymbol = {
            name: fnName,
            kind: isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: container ? container.name : undefined,
            parameters: params,
            ownerName: container?.name,
            ownerKind: container?.kind,
            metadata: { zigFunction: true, inline: isInline, paramCount: params.length },
          }
          symbols.push(sym)
          if (isExported && !isMethod) exports.push({ name: fnName, kind: ASTEngine.SymbolKind.Function })
        }
        // Function body: execution artifacts only — no declaration symbols.
        this.pushChildren(node, walkStack, container, true)
        continue
      }

      // ─── CONTAINER FIELD: struct/union member or enum member ───
      if (type === "container_field") {
        const nameNode = this.anyChild(node, (n) => n.type === "identifier")
        const fieldName = nameNode ? nameNode.text : ""
        if (fieldName && fieldName.length < 50) {
          const isEnumMember = container?.kind === ASTEngine.SymbolKind.Enum
          const typeNode = this.anyChild(
            node,
            (n) =>
              n.type === "builtin_type" ||
              n.type === "nullable_type" ||
              n.type === "slice_type" ||
              n.type === "pointer_type" ||
              n.type === "error_union_type",
          )
          symbols.push({
            name: fieldName,
            kind: isEnumMember ? ASTEngine.SymbolKind.EnumMember : ASTEngine.SymbolKind.Property,
            visibility: "public",
            range: this.nodeRange(node),
            scope: container?.name,
            ownerName: container?.name,
            ownerKind: container?.kind,
            returnType: isEnumMember ? undefined : typeNode ? this.nodeText(typeNode) : undefined,
            metadata: { zigField: true, ...(isEnumMember ? { zigEnumMember: true } : {}) },
          })
        }
        this.pushChildren(node, walkStack, container, inFunction)
        continue
      }

      // ─── ERROR SET MEMBERS: error{ InvalidPoint, OutOfMemory } ───
      // Only identifiers that are DIRECT children of the error_set node are
      // members; the declaring variable's LHS identifier is not one.
      if (type === "identifier" && container && container.metadata?.zigErrorSet && node.parent?.type === "error_set_declaration") {
        const identText = node.text
        if (identText && identText.length < 50) {
          symbols.push({
            name: identText,
            kind: ASTEngine.SymbolKind.EnumMember,
            visibility: "public",
            range: this.nodeRange(node),
            scope: container.name,
            ownerName: container.name,
            ownerKind: container.kind,
            metadata: { zigErrorSetMember: true },
          })
        }
        continue
      }

      // ─── SWITCH EXPRESSION: complexity tracking only ───
      if (type === "switch_expression") {
        relationships.push({
          source: container?.name || "global",
          target: "switch",
          type: ASTEngine.RelationshipType.References,
          confidence: 0.5,
          metadata: { zigSwitch: true },
        })
      }

      // ─── ERROR REPORTING ───
      if (node.hasError || type === "ERROR") {
        const snippet = nodeText.substring(0, 50)
        errors.push({
          message: `Zig syntax error: ${snippet}`,
          range: {
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
          },
          severity: "error",
        })
      }

      // ─── PUSH CHILDREN (default: preserve container/function context) ───
      this.pushChildren(node, walkStack, container, inFunction)
    }

    // Contains relationships for owned symbols
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }
    // Import reference relationships
    for (const imp of imports) {
      if (imp.module) {
        relationships.push({
          source: "root",
          target: imp.module,
          type: ASTEngine.RelationshipType.References,
          isExternal: true,
          weight: 0.9,
          metadata: { importModule: imp.module },
        })
      }
    }
    // Export relationships
    for (const exp of exports) {
      relationships.push({
        source: "module",
        target: exp.name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 0.9,
        metadata: { zigExport: true },
      } as any)
    }

    return {
      language: "zig",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "Zig",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
      },
    }
  }

  private pushChildren(
    node: Node,
    walkStack: { node: Node; container: ASTEngine.UniversalSymbol | null; inFunction: boolean }[],
    container: ASTEngine.UniversalSymbol | null,
    inFunction: boolean,
  ): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) walkStack.push({ node: child, container, inFunction })
    }
  }

  // ─── PURE HELPER FUNCTIONS ───

  private nodeRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private nodeText(node: Node | null): string {
    if (!node) return ""
    return node.text
  }

  private anyChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private getAllNamedChildren(node: Node): Node[] {
    const children: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) children.push(child)
    }
    return children
  }
}
