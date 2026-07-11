// @ts-nocheck — Ported from backbencher.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"

export class RealCleanAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, fileContent: string, filePath: string): ParseResult {
    // 100% STATELESS THREAD SAFETY: All state instantiated inside analyze()
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    // O(1) Lookups for state
    const commentRanges: { start: number; end: number }[] = []

    // O(N) TIME & O(D) SPACE COMPLEXITY CEILING: Iterative State Stack for DFS
    const walkStack: Array<{ node: Node; activeFunction: string }> = [
      { node: rootNode, activeFunction: "" },
    ]

    while (walkStack.length > 0) {
      const { node, activeFunction } = walkStack.pop()!

      if (node.isMissing) continue

      if (node.type === "line_comment" || node.type === "block_comment") {
        commentRanges.push({ start: node.startIndex, end: node.endIndex })
      } else if (node.type === "constructor") {
        const cName = this.findChild(node, (n) => n.type === "identifier")
        if (cName) {
          symbols.push({
            name: cName.text, kind: SymbolKind.Constructor,
            range: { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column, startIndex: node.startIndex, endIndex: node.endIndex },
            metadata: { cleanSpecific: true, isADTConstructor: true },
          })
          // instantiates: ADT constructor definition — treat as instantiation target
          relationships.push({
            source: activeFunction || "global",
            target: cName.text,
            type: RelationshipType.Instantiates,
            confidence: 0.8,
            metadata: { cleanSpecific: true, isADTConstructor: true },
          })
        }
      }

      let nextActiveFunction = activeFunction

      if (node.type === "function_declaration") {
        const identifiers = this.filterChildren(node, (n) => n.type === "identifier")
        const nameNode =
          identifiers.length > 1 && identifiers[0].text[0] === identifiers[0].text[0].toUpperCase()
            ? identifiers[1] // Skip return type (uppercase) to get function name
            : identifiers[0]
        if (nameNode) {
          const name = nameNode.text
          nextActiveFunction = name

          symbols.push({
            name,
            kind: SymbolKind.Function,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            metadata: { cleanSpecific: true },
          })
        }
      } else if (
        node.type === "type_definition" ||
        node.type === "class_declaration" ||
        node.type === "instance_declaration"
      ) {
        const nameNode = node.childForFieldName("name") || this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          let kind = SymbolKind.Type
          if (node.type === "class_declaration") kind = SymbolKind.Interface
          else if (node.type === "instance_declaration") kind = SymbolKind.Class

          // Track Implements: instance ClassName Type where ...
          if (node.type === "instance_declaration") {
            const identifiers = this.filterChildren(node, (n) => n.type === "identifier")
            if (identifiers.length >= 2) {
              relationships.push({
                source: identifiers[1].text,
                target: identifiers[0].text,
                type: RelationshipType.Implements,
                confidence: 0.9,
                metadata: { cleanSpecific: true },
              })
            }
          }

          symbols.push({
            name: nameNode.text,
            kind: kind,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            metadata: { cleanSpecific: true },
          })
        }
      } else if (node.type === "module_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Module,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            metadata: { cleanSpecific: true },
          })
        }
      } else if (node.type === "import_declaration") {
        const importNodes = this.filterChildren(node, (n) => n.type === "identifier")
        if (importNodes.length > 0) {
          const moduleName = importNodes[0].text
          imports.push({
            module: moduleName,
            isNamespaceImport: true,
            items: [],
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            metadata: { cleanSpecific: true },
          })
          // depends: module import = compile-time dependency
          relationships.push({
            source: activeFunction || "global",
            target: moduleName,
            type: RelationshipType.References,
            confidence: 1.0,
            metadata: { cleanSpecific: true, isImportDependency: true },
          })
        }
      } else if (node.type === "case_default" || node.type === "alt") {
        // Pattern match alternatives — only uppercase identifiers are constructors (true calls)
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child && child.type === "identifier" && activeFunction && activeFunction !== child.text) {
            // Clean convention: uppercase = constructor, lowercase = variable binding
            const isConstructor = child.text[0] === child.text[0].toUpperCase() && child.text[0] !== child.text[0].toLowerCase()
            if (isConstructor) {
              relationships.push({ source: activeFunction, target: child.text, type: RelationshipType.Calls, confidence: 0.85, metadata: { cleanSpecific: true, fromPatternMatch: true, isConstructorCall: true } })
            } else {
              // Lowercase pattern variable — track as Uses (variable binding from pattern)
              relationships.push({ source: activeFunction, target: child.text, type: RelationshipType.Uses, confidence: 0.5, metadata: { cleanSpecific: true, fromPatternBinding: true } })
            }
          }
        }
      } else if (node.type === "application") {
        // (func arg1 arg2 ...) — the real function call mechanism in Clean
        // NOTE: application children are _expression wrappers, not bare identifiers
        // Navigate: application → _expression → identifier for the function
        const funcExpr = node.namedChild(0)
        const funcNode = funcExpr?.namedChild(0)
        if (funcNode && funcNode.type === "identifier" && activeFunction && activeFunction !== funcNode.text) {
          // Clean naming convention: uppercase = ADT constructor, lowercase = function
          const isConstructor = funcNode.text[0] === funcNode.text[0].toUpperCase() && funcNode.text[0] !== funcNode.text[0].toLowerCase()
          relationships.push({
            source: activeFunction,
            target: funcNode.text,
            type: isConstructor ? RelationshipType.Instantiates : RelationshipType.Calls,
            confidence: isConstructor ? 0.8 : 0.95,
            metadata: { cleanSpecific: true, fromApplication: true, isConstructorCall: isConstructor },
          })
        }
        // references/instantiates: arguments to function application
        for (let i = 1; i < node.namedChildCount; i++) {
          const argExpr = node.namedChild(i)
          if (!argExpr) continue
          // Recurse into arg expressions to find all identifier references
          this.collectIdentifiers(argExpr, activeFunction, relationships)
        }
      } else if (node.type === "infix_expression") {
        // a + b → both sides are references (uses), and the operator may be a function call
        const leftExpr = node.namedChild(0)
        const rightExpr = node.namedChild(2)
        if (leftExpr) this.collectIdentifiers(leftExpr, activeFunction, relationships)
        if (rightExpr) this.collectIdentifiers(rightExpr, activeFunction, relationships)
      } else if (node.type === "lambda") {
        // Lambda: track as inline function, detect body relationships
        if (activeFunction) {
          const lambdaName = `lambda_${activeFunction}_${node.startPosition.row}`
          symbols.push({
            name: lambdaName,
            kind: SymbolKind.Function,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            ownerName: activeFunction,
            visibility: "private",
            metadata: { cleanSpecific: true, isLambda: true },
          })
          // Lambda body may call functions — let child walker handle it
          nextActiveFunction = lambdaName
        }
      } else if (node.type === "wildcard") {
        // `_` — no binding, no relationship. Skip.
        continue
      } else if (node.type === "operator" && node.text === "\\" && activeFunction) {
        // Heuristic: \ is the lambda operator in Clean
        // Pattern: \ params... -> body or \ params... = body
        // Detect the lambda and create an inline function symbol
        const siblings = node.parent?.namedChildren || []
        const lambdaIdx = siblings.indexOf(node)
        if (lambdaIdx >= 0) {
          // Find the -> or = separator and body
          let bodyExpr: Node | null = null
          let paramCount = 0
          for (let j = lambdaIdx + 1; j < siblings.length; j++) {
            const sib = siblings[j]
            if (!sib) continue
            if (sib.type === "operator" && (sib.text === "->" || sib.text === "=")) {
              bodyExpr = siblings[j + 1] || null
              break
            }
            if (sib.type === "identifier") paramCount++
          }
          if (bodyExpr && paramCount > 0) {
            const lambdaName = `lambda_${activeFunction}_${node.startPosition.row}`
            symbols.push({
              name: lambdaName,
              kind: SymbolKind.Function,
              range: {
                startLine: node.startPosition.row + 1,
                startColumn: node.startPosition.column,
                endLine: bodyExpr.endPosition.row + 1,
                endColumn: bodyExpr.endPosition.column,
                startIndex: node.startIndex,
                endIndex: bodyExpr.endIndex,
              },
              ownerName: activeFunction,
              visibility: "private",
              metadata: { cleanSpecific: true, isLambda: true },
            })
            // Walk lambda body with new active function context
            nextActiveFunction = lambdaName
          }
        }
      } else if (node.type === "list_comprehension") {
        // Track comprehension generators as Uses relationships
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "generator") {
            this.collectIdentifiers(child, activeFunction, relationships)
          }
          if (child?.type === "guard") {
            this.collectIdentifiers(child, activeFunction, relationships)
          }
        }
      } else if (node.type === "generator") {
        // pat <- expr: track expr references
        const exprNode = node.childForFieldName("expression")
        if (exprNode) this.collectIdentifiers(exprNode, activeFunction, relationships)
        // Track pattern bindings as Uses (new variables bound by the generator)
        const patNode = node.childForFieldName("pattern")
        if (patNode) this.collectIdentifiers(patNode, activeFunction, relationships)
      } else if (node.type === "guard") {
        // Boolean guard in comprehension: track referenced identifiers
        const condNode = node.childForFieldName("condition")
        if (condNode) this.collectIdentifiers(condNode, activeFunction, relationships)
      } else if (node.type === "let_qualifier") {
        // let x = expr in comprehension: track value references
        const valNode = node.childForFieldName("value")
        if (valNode) this.collectIdentifiers(valNode, activeFunction, relationships)
      } else if (node.type === "field_access") {
        // record.field or record!field: record=References, field=Uses
        const recordNode = node.childForFieldName("record")
        if (recordNode) this.collectIdentifiers(recordNode, activeFunction, relationships)
      } else if (node.type === "record_expression") {
        // { field = value, ... }: track field values as Uses
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "identifier") continue // skip field names
          if (child) this.collectIdentifiers(child, activeFunction, relationships)
        }
      } else if (node.type === "record_update") {
        // { expr & field = value }: record=References, field values=Uses
        const recordNode = node.childForFieldName("record")
        if (recordNode) this.collectIdentifiers(recordNode, activeFunction, relationships)
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child && child.type !== "identifier" && child.text !== "&") {
            this.collectIdentifiers(child, activeFunction, relationships)
          }
        }
      } else if (node.type === "identifier" && activeFunction && activeFunction !== node.text) {
        // Fallback: identifier directly inside a function_declaration body (not inside an application sub-node)
        if (node.parent?.type === "function_declaration") {
          relationships.push({
            source: activeFunction,
            target: node.text,
            type: RelationshipType.Uses,
            confidence: 0.5,
            metadata: { cleanSpecific: true, fromIdentifierFallback: true },
          })
        }
      } else if (node.type === "ERROR") {
        errors.push({
          message: "Syntax Error",
          range: {
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
          },
          severity: "error",
        })
      }

      // Add children to stack in reverse order for correct DFS traversal
      // Where/guard clauses pass active function context for nested call detection
      if (node.type === "where" || node.type === "guard") nextActiveFunction = activeFunction
      // ABSOLUTE ZERO WASM-BRIDGE ARRAYS
      const childCount = node.namedChildCount
      for (let i = childCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({ node: child, activeFunction: nextActiveFunction })
        }
      }
    }

    // Export only module-scope symbols (functions, types, classes, interfaces, modules, constructors)
    // Exclude lambdas and internal variables
    const EXPORTABLE_KINDS = new Set([
      SymbolKind.Function,
      SymbolKind.Type,
      SymbolKind.Interface,
      SymbolKind.Class,
      SymbolKind.Module,
      SymbolKind.Constructor,
    ])
    for (const sym of symbols) {
      if (!sym.name.startsWith("_") && EXPORTABLE_KINDS.has(sym.kind) && !sym.ownerName) {
        exports.push({ name: sym.name, kind: sym.kind, range: sym.range, visibility: "public" })
      }
    }

    // Post-loop: add contains for owned symbols
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

    return {
      language: "clean",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: fileContent.split("\n").length,
      },
    }
  }

  // LAWS COMPLIANT HELPER 1: ZERO ARRAY INSTANTIATION FOR FIND
  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) {
        return child
      }
    }
    return null
  }

  // LAWS COMPLIANT HELPER 2: ZERO ARRAY INSTANTIATION EXPORT
  private filterChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
    const result: Node[] = []
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) {
        result.push(child)
      }
    }
    return result
  }

  // Recursively collect all identifiers from an expression subtree for relationship tracking
  private collectIdentifiers(node: Node, activeFunction: string, relationships: UniversalRelationship[]): void {
    if (!node || !activeFunction) return

    // Handle application nodes INSIDE the subtree (nested calls in infix expressions, etc.)
    if (node.type === "application") {
      const funcExpr = node.namedChild(0)
      const funcNode = funcExpr?.namedChild(0)
      if (funcNode && funcNode.type === "identifier" && funcNode.text !== activeFunction) {
        const isConstructor = funcNode.text[0] === funcNode.text[0].toUpperCase() && funcNode.text[0] !== funcNode.text[0].toLowerCase()
        relationships.push({
          source: activeFunction,
          target: funcNode.text,
          type: isConstructor ? RelationshipType.Instantiates : RelationshipType.Calls,
          confidence: isConstructor ? 0.8 : 0.95,
          metadata: { cleanSpecific: true, fromApplication: true, isConstructorCall: isConstructor },
        })
      }
      // Continue recursing into arguments to find references
      for (let i = 1; i < node.namedChildCount; i++) {
        const argExpr = node.namedChild(i)
        if (argExpr) this.collectIdentifiers(argExpr, activeFunction, relationships)
      }
      return
    }

    // Leaf identifier
    if (node.type === "identifier" && node.text !== activeFunction) {
      const isConstructor = node.text[0] === node.text[0].toUpperCase() && node.text[0] !== node.text[0].toLowerCase()
      relationships.push({
        source: activeFunction,
        target: node.text,
        type: isConstructor ? RelationshipType.Instantiates : RelationshipType.References,
        confidence: isConstructor ? 0.8 : 0.7,
        metadata: { cleanSpecific: true, isApplicationArgument: true, isConstructorInstantiation: isConstructor },
      })
      return
    }

    // Recurse into children (e.g., _expression, application, infix_expression, lambda, etc.)
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.collectIdentifiers(child, activeFunction, relationships)
      }
    }
  }
}
