// @ts-nocheck — Ported from backbencher.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"

/**
 * REAL ZIG ANALYZER v5.0 - Grounded in real tree-sitter-zig 0.2.0 AST
 *
 * ALL node type names verified by direct WASM parsing of Zig source files.
 * Grammar uses: for_statement, while_statement, comptime_declaration,
 * error_set_declaration, error_type, switch_expression, etc.
 *
 * 4 LAWS:
 * 1. Flawless Database Extraction (UniversalSymbol, UniversalRelationship)
 * 2. Zero WASM arrays (O(1) namedChildCount + namedChild access per symbol)
 * 3. O(N) iterative DFS (single while loop, push children in reverse)
 * 4. 100% stateless (pure helper functions only)
 */
export class RealZigAnalyzer implements LanguageAnalyzer {
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
      const nodeText = this.nodeText(node)

      // ─── FUNCTION DECLARATION: pub fn name(...) { ... } ───
      if (type === "function_declaration" || type === "function_signature") {
        const isExported = nodeText.startsWith("pub ") || nodeText.startsWith("export ")
        const isInline = nodeText.includes("inline ")
        const isExported_ = isExported

        let fnName = ""
        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        if (identNode) fnName = identNode.text

        if (fnName && fnName.length < 100) {
          const params: Parameter[] = []
          const paramsNode = this.anyChild(node, (n) => n.type === "parameters")
          if (paramsNode) {
            for (let i = 0; i < paramsNode.namedChildCount; i++) {
              const child = paramsNode.namedChild(i)
              if (!child || child.type === ",") continue
              if (child.type === "parameter") {
                const pNameNode = this.anyChild(child, (n) => n.type === "identifier")
                const pTypeNode = this.anyChild(
                  child,
                  (n) =>
                    n.type === "builtin_type" ||
                    n.type === "nullable_type" ||
                    n.type === "slice_type" ||
                    n.type === "pointer_type" ||
                    n.type === "identifier" ||
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
          }

          symbols.push({
            name: fnName,
            kind: SymbolKind.Function,
            visibility: isExported_ ? "public" : "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            parameters: params,
            returnType: "void",
            metadata: {
              zigFunction: true,
              inline: isInline,
              paramCount: params.length,
            },
          })
          currentScope.push(fnName)
          if (isExported_) {
            exports.push({ name: fnName, kind: SymbolKind.Function })
          }
        }
      }

      // ─── VARIABLE / CONSTANT DECLARATION: const X = ... ───
      if (type === "variable_declaration") {
        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        if (!identNode) {
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) walkStack.push({ node: child, scopePath: currentScope })
          }
          continue
        }

        const varName = identNode.text
        if (!varName || varName.length > 80) {
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) walkStack.push({ node: child, scopePath: currentScope })
          }
          continue
        }

        const isExported = nodeText.startsWith("pub ") || nodeText.startsWith("export ")
        const children = this.getAllNamedChildren(node)
        const rhs = children[children.length - 1]
        const rhsType = rhs?.type || ""
        const rhsText = rhs ? this.nodeText(rhs) : ""

        if (rhsType === "enum_declaration" || rhsText.includes("enum{")) {
          symbols.push({
            name: varName,
            kind: SymbolKind.Enum,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigDeclaration: "enum", zigEnum: true },
          })
          if (isExported) exports.push({ name: varName, kind: SymbolKind.Enum })
          currentScope.push(varName)
        } else if (rhsType === "error_set_declaration" || rhsText.startsWith("error{")) {
          symbols.push({
            name: varName,
            kind: SymbolKind.Enum,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigDeclaration: "error_set", zigErrorSet: true },
          })
          if (isExported) exports.push({ name: varName, kind: SymbolKind.Enum })
          currentScope.push(varName)
        } else if (rhsType === "struct_declaration" || rhsText.includes("struct{") || rhsText.startsWith("struct{")) {
          symbols.push({
            name: varName,
            kind: SymbolKind.Class,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigDeclaration: "struct", zigStruct: true },
          })
          if (isExported) exports.push({ name: varName, kind: SymbolKind.Class })
          currentScope.push(varName)
        } else if (varName[0] === varName[0].toUpperCase() && varName[0] !== varName[0].toLowerCase()) {
          symbols.push({
            name: varName,
            kind: SymbolKind.Type,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigDeclaration: "type_alias" },
          })
          if (isExported) exports.push({ name: varName, kind: SymbolKind.Type })
        } else {
          symbols.push({
            name: varName,
            kind: SymbolKind.Constant,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigDeclaration: "constant" },
          })
          if (currentScope.length > 0) {
            relationships.push({
              source: currentScope[currentScope.length - 1],
              target: varName,
              type: RelationshipType.Contains,
              metadata: {},
            })
          }
          if (isExported) exports.push({ name: varName, kind: SymbolKind.Constant })
        }
      }

      // ─── FOR STATEMENT: for (...) |...| { ... } ───
      if (type === "for_statement") {
        const isInline = nodeText.includes("inline ")
        symbols.push({
          name: isInline ? "inline for" : "for",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: {
            zigLoop: true,
            zigFor: true,
            inline: isInline,
            loopType: isInline ? "inline_for" : "for",
          },
        })
        currentScope.push(isInline ? "inline for" : "for")
      }

      // ─── WHILE STATEMENT: while (...) { ... } ───
      if (type === "while_statement") {
        const isInline = nodeText.includes("inline ")
        symbols.push({
          name: isInline ? "inline while" : "while",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: {
            zigLoop: true,
            zigWhile: true,
            inline: isInline,
            loopType: isInline ? "inline_while" : "while",
          },
        })
        currentScope.push(isInline ? "inline while" : "while")
      }

      // ─── LABELED STATEMENT: inline for/while blocks (line 88 in lang.zig uses labeled_statement for comptime blocks)
      // Check if it's a labeled block containing a loop
      if (type === "labeled_statement") {
        if (
          nodeText.includes("inline for") ||
          nodeText.includes("inline while") ||
          nodeText.includes("for (") ||
          nodeText.includes("while (")
        ) {
          const isInline = nodeText.includes("inline ")
          const isFor = nodeText.includes("for (")
          const isWhile = nodeText.includes("while (")

          if (isFor) {
            symbols.push({
              name: isInline ? "inline for" : "for",
              kind: SymbolKind.Function,
              visibility: "private",
              range: this.nodeRange(node),
              scope: currentScope.join("."),
              metadata: {
                zigLoop: true,
                zigFor: true,
                inline: isInline,
                loopType: isInline ? "inline_for" : "for",
                labeled: true,
              },
            })
            currentScope.push(isInline ? "inline for" : "for")
          } else if (isWhile) {
            symbols.push({
              name: isInline ? "inline while" : "while",
              kind: SymbolKind.Function,
              visibility: "private",
              range: this.nodeRange(node),
              scope: currentScope.join("."),
              metadata: {
                zigLoop: true,
                zigWhile: true,
                inline: isInline,
                loopType: isInline ? "inline_while" : "while",
                labeled: true,
              },
            })
            currentScope.push(isInline ? "inline while" : "while")
          }
        }
      }

      // ─── COMPTIME DECLARATION: comptime { ... } ───
      if (type === "comptime_declaration") {
        symbols.push({
          name: "comptime",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: {
            zigComptimeBlock: true,
            zigComptime: true,
            snippet: nodeText.substring(0, 80),
          },
        })
        currentScope.push("comptime")
      }

      // ─── COMPTIME EXPRESSION: comptime blk: { ... } (labeled comptime block)
      if (type === "comptime_expression") {
        symbols.push({
          name: "comptime",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: {
            zigComptimeBlock: true,
            zigComptime: true,
            comptimeExpression: true,
            snippet: nodeText.substring(0, 80),
          },
        })
        currentScope.push("comptime")
      }

      // ─── LABELED TYPE EXPRESSION (comptime blk: form) ───
      if (type === "labeled_type_expression") {
        if (nodeText.includes("comptime")) {
          symbols.push({
            name: "comptime",
            kind: SymbolKind.Function,
            visibility: "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: {
              zigComptimeBlock: true,
              zigComptime: true,
              labeled: true,
              snippet: nodeText.substring(0, 80),
            },
          })
          currentScope.push("comptime")
        }
      }

      // ─── ERROR SET DECLARATION: error { ... } ───
      if (type === "error_set_declaration") {
        symbols.push({
          name: "error_set",
          kind: SymbolKind.Enum,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigErrorSet: true },
        })
      }

      // ─── ERROR TYPE (error union): error!T ───
      if (type === "error_type" || type === "error_union_type") {
        symbols.push({
          name: "error",
          kind: SymbolKind.Type,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigErrorType: true },
        })
      }

      // ─── ENUM DECLARATION (inline) ───
      if (type === "enum_declaration") {
        symbols.push({
          name: "enum",
          kind: SymbolKind.Enum,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigEnum: true },
        })
      }

      // ─── STRUCT DECLARATION (inline) ───
      if (type === "struct_declaration") {
        symbols.push({
          name: "struct",
          kind: SymbolKind.Class,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigStruct: true },
        })
      }

      // ─── SWITCH EXPRESSION: switch (x) { ... } ───
      if (type === "switch_expression") {
        symbols.push({
          name: "switch",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: {
            zigSwitch: true,
            snippet: nodeText.substring(0, 80),
          },
        })
        currentScope.push("switch")
      }

      // ─── SWITCH CASE (arm): .Tag => { ... } ───
      if (type === "switch_case") {
        symbols.push({
          name: "switch_case",
          kind: SymbolKind.Method,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigSwitchCase: true, snippet: nodeText.substring(0, 50) },
        })
      }

      // ─── TRY EXPRESSION: try expr ───
      if (type === "try_expression") {
        symbols.push({
          name: "try",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigTry: true },
        })
      }

      // ─── RETURN EXPRESSION: return expr ───
      if (type === "return_expression") {
        symbols.push({
          name: "return",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigReturn: true },
        })
      }

      // ─── BREAK EXPRESSION: break ───
      if (type === "break_expression") {
        symbols.push({
          name: "break",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigBreak: true },
        })
      }

      // ─── CONTINUE EXPRESSION: continue ───
      if (type === "continue_expression") {
        symbols.push({
          name: "continue",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigContinue: true },
        })
      }

      // ─── BUILTIN FUNCTION CALL: @import, @cImport, @TypeOf, etc. ───
      if (type === "builtin_function") {
        const identNode = this.anyChild(node, (n) => n.type === "builtin_identifier")
        const argsNode = this.anyChild(node, (n) => n.type === "arguments")
        const fnName = identNode?.text || ""

        if (fnName === "@import" || fnName === "@cImport") {
          if (argsNode) {
            const strNode = this.anyChild(argsNode, (n) => n.type === "string" || n.type === "string_content")
            if (strNode) {
              // Strip quotes without regex
              let importTarget = strNode.text
              if ((importTarget.startsWith('"') && importTarget.endsWith('"')) || (importTarget.startsWith("'") && importTarget.endsWith("'"))) {
                importTarget = importTarget.substring(1, importTarget.length - 1)
              }
              imports.push({
                module: importTarget,
                isDefaultImport: false,
                range: this.nodeRange(node),
              })
              // Import relationship
              const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "global"
              relationships.push({
                source: scopeName,
                target: importTarget,
                type: RelationshipType.Imports,
                confidence: 0.9,
                metadata: { zigImport: true },
              } as any)
              if (fnName === "@cImport") {
                symbols.push({
                  name: importTarget,
                  kind: SymbolKind.Namespace,
                  visibility: "private",
                  range: this.nodeRange(node),
                  scope: currentScope.join("."),
                  metadata: { cImport: true, importedModule: importTarget },
                })
              }
            }
          }
        } else if (fnName.startsWith("@")) {
          symbols.push({
            name: fnName,
            kind: SymbolKind.Function,
            visibility: "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigBuiltin: true, builtin: fnName },
          })
        }
      }

      // ─── CALL EXPRESSION: func(args) ───
      if (type === "call_expression") {
        const fnField = this.anyChild(node, (n) => n.type === "identifier" || n.type === "field_expression")
        if (fnField) {
          const fnText = this.nodeText(fnField)
          if (fnText && fnText.length < 60 && !fnText.startsWith("@")) {
            symbols.push({
              name: fnText,
              kind: SymbolKind.Function,
              visibility: "private",
              range: this.nodeRange(node),
              scope: currentScope.join("."),
              metadata: { zigCall: true },
            })
            // Push call relationship
            relationships.push({
              source: currentScope.join(".") || "global",
              target: fnText,
              type: RelationshipType.Calls,
              confidence: 0.8,
              metadata: { zigSpecific: true },
            })
            // Zig instantiation: Foo.init() or Foo{} struct literal
            if (fnText.endsWith(".init") || (fnText[0] === fnText[0].toUpperCase() && fnText[0] !== fnText[0].toLowerCase())) {
              relationships.push({
                source: currentScope.join(".") || "global",
                target: fnText.replace(".init", ""),
                type: RelationshipType.Instantiates,
                confidence: 0.75,
                metadata: { zigSpecific: true, isConstructor: true },
              })
            }
          }
        }
      }

      // ─── CONTAINER FIELD (struct/enum property): field: Type ───
      if (type === "container_field") {
        const nameNode = this.anyChild(node, (n) => n.type === "identifier")
        const fieldName = nameNode?.text || ""
        if (fieldName && fieldName.length < 50) {
          const typeNode = this.anyChild(
            node,
            (n) =>
              n.type === "builtin_type" ||
              n.type === "nullable_type" ||
              n.type === "slice_type" ||
              n.type === "pointer_type" ||
              n.type === "identifier" ||
              n.type === "error_union_type",
          )
          symbols.push({
            name: fieldName,
            kind: SymbolKind.Property,
            visibility: "public",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            returnType: typeNode ? this.nodeText(typeNode) : undefined,
            metadata: { zigField: true },
          })
          if (currentScope.length > 0) {
            relationships.push({
              source: currentScope[currentScope.length - 1],
              target: fieldName,
              type: RelationshipType.Contains,
              metadata: {},
            })
          }
        }
      }

      // ─── BLOCK: { ... } ───
      if (type === "block") {
        if (nodeText.length < 300 && node.startPosition.row < 100) {
          symbols.push({
            name: "block",
            kind: SymbolKind.Function,
            visibility: "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigBlock: true },
          })
          currentScope.push("block")
        }
      }

      // ─── FIELD EXPRESSION: std.math, x.field ───
      if (type === "field_expression") {
        const children = this.getAllNamedChildren(node)
        if (children.length >= 2) {
          const fieldName = children[children.length - 1].text
          if (fieldName && fieldName.length < 50) {
            symbols.push({
              name: fieldName,
              kind: SymbolKind.Property,
              visibility: "private",
              range: this.nodeRange(node),
              scope: currentScope.join("."),
              metadata: { zigFieldAccess: true },
            })
          }
        }
      }

      // ─── BUILTIN TYPE: u32, i64, bool, f32, noreturn, type ───
      if (type === "builtin_type") {
        if (nodeText && nodeText.length < 30) {
          symbols.push({
            name: nodeText,
            kind: SymbolKind.Type,
            visibility: "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigBuiltinType: true },
          })
        }
      }

      // ─── NULLABLE TYPE: ?T ───
      if (type === "nullable_type") {
        if (nodeText.length < 50) {
          symbols.push({
            name: nodeText,
            kind: SymbolKind.Type,
            visibility: "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigNullable: true },
          })
        }
      }

      // ─── SLICE TYPE: []T ───
      if (type === "slice_type") {
        if (nodeText.length < 50) {
          symbols.push({
            name: nodeText,
            kind: SymbolKind.Type,
            visibility: "private",
            range: this.nodeRange(node),
            scope: currentScope.join("."),
            metadata: { zigSlice: true },
          })
        }
      }

      // ─── IDENTIFIER (type reference, PascalCase) ───
      if (type === "identifier") {
        const identText = node.text
        if (identText && identText.length > 0 && identText.length < 80 && !(identText[0] >= "0" && identText[0] <= "9")) {
          if (identText[0] === identText[0].toUpperCase() && identText[0] !== identText[0].toLowerCase()) {
            symbols.push({
              name: identText,
              kind: SymbolKind.Type,
              visibility: "private",
              range: this.nodeRange(node),
              scope: currentScope.join("."),
              metadata: { zigTypeIdentifier: true },
            })
          }
        }
      }

      // ─── IF STATEMENT ───
      if (type === "if_statement" || type === "if_expression") {
        symbols.push({
          name: "if",
          kind: SymbolKind.Function,
          visibility: "private",
          range: this.nodeRange(node),
          scope: currentScope.join("."),
          metadata: { zigIf: true },
        })
        currentScope.push("if")
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

      // ─── PUSH CHILDREN ───
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({ node: child, scopePath: currentScope })
        }
      }
    }

    // Post-loop: add contains for owned symbols and references for imports
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }
    for (const imp of imports) {
      if (imp.module) {
        relationships.push({
          source: "root",
          target: imp.module,
          type: RelationshipType.References,
          isExternal: true,
          weight: 0.9,
          metadata: { importModule: imp.module },
        })
      }
    }
    // Add export relationships from the exports array
    for (const exp of exports) {
      relationships.push({
        source: "module",
        target: exp.name,
        type: RelationshipType.Exports,
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

  // ─── PURE HELPER FUNCTIONS ───

  private nodeRange(node: Node): UniversalSymbol["range"] {
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
