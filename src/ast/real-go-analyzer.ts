// Utility functions to avoid array methods
function stringIncludes(str: string, val: string): boolean {
  if (!str) return false
  return str.indexOf(val) !== -1
}

function inArray(arr: any[], val: any): boolean {
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === val) return true
  }
  return false
}

function filterSymbols(symbols: any[], predicate: (s: any) => boolean): any[] {
  const result: any[] = []
  if (!symbols) return result
  for (let i = 0; i < symbols.length; i++) {
    if (predicate(symbols[i])) result.push(symbols[i])
  }
  return result
}

function mapSymbols<T, U>(arr: T[], mapper: (item: T) => U): U[] {
  const result: U[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    result.push(mapper(arr[i]))
  }
  return result
}

function someSymbol(arr: any[], predicate: (s: any) => boolean): boolean {
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return true
  }
  return false
}

function findSymbol(arr: any[], predicate: (s: any) => boolean): any | undefined {
  if (!arr) return undefined
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return arr[i]
  }
  return undefined
}

function forEachSymbol(arr: any[], fn: (s: any) => void): void {
  if (!arr) return
  for (let i = 0; i < arr.length; i++) {
    fn(arr[i])
  }
}

function getObjectKeysLength(obj: any): number {
  if (!obj) return 0
  let count = 0
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      count++
    }
  }
  return count
}

function getUniqueStrings(arr: string[]): string[] {
  const seen: Record<string, boolean> = {}
  const result: string[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) {
      seen[arr[i]] = true
      result.push(arr[i])
    }
  }
  return result
}

// Real Go Intelligence Engine
// AST analysis for Go language

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export interface GoContext {
  content: string
  filePath: string
}

export class RealGoAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: GoContext = { filePath, content }

    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    if (rootNode.hasError) {
      const stack = [rootNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: "Brain Engine (Go): Bypassed resilient parser error node",
            range: {
              startLine: n.startPosition.row,
              startColumn: n.startPosition.column,
              endLine: n.endPosition.row,
              endColumn: n.endPosition.column,
            },
            severity: `warning`,
          })
        }
        for (let i = n.childCount - 1; i >= 0; i--) {
          const child = n.child(i)
          if (child) stack.push(child)
        }
      }
    }

    // PHASE 0: Extract package declaration as a Module symbol
    const packageName = this.extractGoPackageName(rootNode)
    if (packageName) {
      symbols.push({
        name: packageName,
        kind: ASTEngine.SymbolKind.Module,
        range: {
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: packageName.length + 9,
          startIndex: 0,
          endIndex: packageName.length + 9,
        },
        visibility: "public",
        metadata: {
          nodeType: "package_clause",
          isGoPackage: true,
        },
      })
    }

    // PHASE 1: Extract Go symbols with proper understanding
    this.extractGoSymbols(rootNode, symbols, ctx)

    // PHASE 2: Analyze Go-specific relationships
    this.analyzeGoRelationships(rootNode, relationships, symbols, ctx)

    // PHASE 3: Process Go imports (with proper module path handling)
    this.processGoImports(rootNode, imports)

    // PHASE 3b: Add DependsOn relationships for imports
    for (const imp of imports) {
      relationships.push({
        source: packageName || filePath,
        target: imp.module || "",
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        metadata: { isGoImportDep: true, packageName: imp.metadata?.packageName },
      })
    }

    // PHASE 4: Detect Go frameworks and patterns
    const frameworks = this.detectGoFrameworks(rootNode, imports)
    const patterns = this.detectGoPatterns(rootNode, symbols)

    // PHASE 5: Exports — all public (exported) non-variable symbols
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      const isPrivate = s.visibility === "private"
      const isVar = s.kind === ASTEngine.SymbolKind.Variable
      if (!isPrivate && !isVar) {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" })
      }
    }
    return {
      language: "go",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: this.calculateGoComplexity(symbols, relationships),
        linesOfCode: ctx.content.split("\n").length,
        cyclomaticComplexity: this.calculateCyclomaticComplexity(rootNode),
        framework: frameworks[0]?.name, // Primary framework
        patterns,

        // Go intelligence metadata
        detectedFrameworks: mapSymbols(frameworks, (f) => f.name),
        frameworkPatterns: this.getGoFrameworkPatterns(
          mapSymbols(frameworks, (f) => f.name),
          symbols,
        ),
        architecturalInsights: this.generateGoArchitecturalInsights(symbols, relationships),
        architecturalScore: this.calculateArchitecturalScore(symbols, relationships, patterns),
        codeQuality: this.assessCodeQuality(symbols, relationships, patterns),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.1-go-iterative-stateless",
      },
    }
  }

  /**
   * PHASE 1: Extract Go symbols with proper Go semantics understanding
   */
  private extractGoSymbols(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: GoContext, parentStruct?: string) {
    const stack: { node: Node; parent?: string }[] = [{ node, parent: parentStruct }]

    while (stack.length > 0) {
      const { node: current, parent } = stack.pop()!

      switch (current.type) {
        case "function_declaration":
          this.extractGoFunction(current, symbols, parent)
          break
        case "method_declaration":
          this.extractGoMethod(current, symbols)
          break
        case "type_declaration":
          this.extractGoTypeDeclaration(current, symbols)
          break
        case "var_declaration":
        case "const_declaration":
          this.extractGoVariables(current, symbols, parent)
          break
        case "import_declaration":
          // Handled in processGoImports
          break
      }

      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push({ node: child, parent })
      }
    }
  }

  /**
   * Extract Go function declarations
   */
  private extractGoFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], parentStruct?: string) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const functionName = nameNode.text

    // Extract parameters
    const parameters = this.extractGoParameters(node)

    // Extract return type(s)
    const returnType = this.extractGoReturnType(node)

    // Find function calls within this function
    const qualifiedCalls = this.findGoFunctionCalls(node)
    const bodyText = node.childForFieldName("body")?.text || ""

    const apiContractPath = this.extractGoApiContractPathFromComments(node)

    symbols.push({
      name: functionName,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      parameters,
      returnType,
      qualified_calls: qualifiedCalls,
      apiContractPath,
      visibility: this.isGoExported(functionName) ? "public" : "private",
      ownerName: parentStruct,
      ownerKind: parentStruct ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        nodeType: node.type,
        isGoFunction: true,
        isExported: this.isGoExported(functionName),
        hasErrorHandling: this.hasGoErrorHandling(bodyText),
        isInit: functionName === "init",
        hasGenerics: !!findSymbol(node.children, (c) => c && c.type === "type_parameter_list"),
      },
    })
  }

  /**
   * Extract Go method declarations (methods with receivers)
   */
  private extractGoMethod(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const methodName = nameNode.text

    // Extract receiver information
    const receiver = this.extractGoReceiver(node)

    // Extract parameters (excluding receiver)
    const parameters = this.extractGoParameters(node)

    // Extract return type(s)
    const returnType = this.extractGoReturnType(node)

    // Find method calls within this method
    const qualifiedCalls = this.findGoFunctionCalls(node)
    const bodyText = node.childForFieldName("body")?.text || ""

    const apiContractPath = this.extractGoApiContractPathFromComments(node)

    symbols.push({
      name: methodName,
      kind: ASTEngine.SymbolKind.Method,
      range: this.nodeToRange(node),
      parameters,
      returnType,
      qualified_calls: qualifiedCalls,
      apiContractPath,
      visibility: this.isGoExported(methodName) ? "public" : "private",
      ownerName: receiver?.typeName,
      ownerKind: ASTEngine.SymbolKind.Class,
      metadata: {
        nodeType: node.type,
        isGoMethod: true,
        receiver: receiver,
        receiverType: receiver?.typeName,
        receiverKind: receiver?.isPointer ? "pointer" : "value",
        isPointerReceiver: receiver?.isPointer || false,
        isExported: this.isGoExported(methodName),
        hasErrorHandling: this.hasGoErrorHandling(bodyText),
        hasGenerics: !!findSymbol(node.children, (c) => c && c.type === "type_parameter_list"),
      },
    })
  }

  /**
   * Extract Go type declarations (structs, interfaces, type aliases)
   */
  private extractGoTypeDeclaration(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    // Go type_declaration contains type_spec children
    for (let i = 0; i < node.namedChildCount; i++) {
      const typeSpec = node.namedChild(i)
      if (typeSpec?.type === "type_spec" || typeSpec?.type === "type_alias") {
        this.extractGoTypeSpec(typeSpec, symbols)
      }
    }
  }

  /**
   * Extract individual type specifications (struct, interface, etc.)
   */
  private extractGoTypeSpec(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const typeName = nameNode.text

    // Get the type definition (struct_type, interface_type, etc.)
    const typeNode = node.childForFieldName("type")
    if (!typeNode) return

    // Check for generics
    const typeParamsNode = findSymbol(node.children, (c) => c && c.type === "type_parameter_list")
    const hasGenerics = !!typeParamsNode

    let kind: ASTEngine.SymbolKind
    let isInterface = false

    switch (typeNode.type) {
      case "struct_type":
        kind = ASTEngine.SymbolKind.Class
        break
      case "interface_type":
        kind = ASTEngine.SymbolKind.Interface
        isInterface = true
        break
      default:
        kind = ASTEngine.SymbolKind.Type
    }

    symbols.push({
      name: typeName,
      kind,
      range: this.nodeToRange(node),
      visibility: this.isGoExported(typeName) ? "public" : "private",
      metadata: {
        nodeType: node.type,
        goType: typeNode.type,
        isInterface,
        isStruct: typeNode.type === "struct_type",
        isGoStruct: typeNode.type === "struct_type",
        isExported: this.isGoExported(typeName),
        isTypeAlias: node.type === "type_alias",
        hasGenerics,
      },
    })

    // Extract struct fields or interface methods
    if (typeNode.type === "struct_type") {
      this.extractStructFields(typeNode, symbols, typeName)
    } else if (typeNode.type === "interface_type") {
      this.extractInterfaceMethods(typeNode, symbols, typeName)
    }
  }

  /**
   * Extract struct fields
   */
  private extractStructFields(structNode: Node, symbols: ASTEngine.UniversalSymbol[], structName: string) {
    // Look for field_declaration_list
    for (let i = 0; i < structNode.namedChildCount; i++) {
      const child = structNode.namedChild(i)
      if (child?.type === "field_declaration_list") {
        // Process each field_declaration
        for (let j = 0; j < child.namedChildCount; j++) {
          const fieldDecl = child.namedChild(j)
          if (fieldDecl?.type === "field_declaration") {
            // Extract field name and type
            const fieldNameNode = fieldDecl.childForFieldName("name")
            const fieldTypeNode = fieldDecl.childForFieldName("type")
            // Extract struct tags like `json:"name"`
            const tagNode = fieldDecl.childForFieldName("tag")
            let structTags: Record<string, string> = {}
            if (tagNode) {
              const tagText = tagNode.text.replace(/^[`']|[`']$/g, "")
              const tagRegex = /([a-z0-9_]+):"((?:[^"\\]|\\.)*)"/g
              let match
              while ((match = tagRegex.exec(tagText)) !== null) {
                structTags[match[1]] = match[2]
              }
            }

            if (fieldNameNode) {
              symbols.push({
                name: fieldNameNode.text,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(fieldDecl),
                returnType: fieldTypeNode?.text,
                visibility: this.isGoExported(fieldNameNode.text) ? "public" : "private",
                ownerName: structName,
                ownerKind: ASTEngine.SymbolKind.Class,
                metadata: {
                  structTags: getObjectKeysLength(structTags) > 0 ? structTags : undefined,
                  nodeType: fieldDecl.type,
                  isStructField: true,
                  fieldType: fieldTypeNode?.text,
                  isExported: this.isGoExported(fieldNameNode.text),
                },
              })
            }
          }
        }
        break
      }
    }
  }

  /**
   * Extract interface methods
   */
  private extractInterfaceMethods(interfaceNode: Node, symbols: ASTEngine.UniversalSymbol[], interfaceName: string) {
    // Look for method signatures in interface
    for (let i = 0; i < interfaceNode.namedChildCount; i++) {
      const method = interfaceNode.namedChild(i)
      if (method?.type === "method_spec" || method?.type === "method_elem") {
        const methodName = method.childForFieldName("name")
        if (methodName) {
          const parameters = this.extractGoMethodSpecParameters(method)
          const returnType = this.extractGoMethodSpecReturnType(method)
          symbols.push({
            name: methodName.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(method),
            isAbstract: true, // Interface methods are abstract
            parameters,
            returnType,
            visibility: this.isGoExported(methodName.text) ? "public" : "private",
            ownerName: interfaceName,
            ownerKind: ASTEngine.SymbolKind.Interface,
            metadata: {
              nodeType: method.type,
              isInterfaceMethod: true,
              isExported: this.isGoExported(methodName.text),
            },
          })
        } else {
          const embeddedType = method.childForFieldName("type")
          if (embeddedType) {
            symbols.push({
              name: embeddedType.text,
              kind: ASTEngine.SymbolKind.Interface,
              range: this.nodeToRange(method),
              visibility: "public",
              ownerName: interfaceName,
              ownerKind: ASTEngine.SymbolKind.Interface,
              metadata: {
                nodeType: method.type,
                isEmbeddedInterface: true,
                embeddedInterface: embeddedType.text,
              },
            })
          }
        }
      }
    }
  }

  /**
   * Extract Go variables and constants
   */
  private extractGoVariables(node: Node, symbols: ASTEngine.UniversalSymbol[], parentStruct?: string) {
    // Process var/const spec children
    for (let i = 0; i < node.namedChildCount; i++) {
      const spec = node.namedChild(i)
      if (spec?.type === "var_spec" || spec?.type === "const_spec") {
        const nameNodes: Node[] = []
        for (let j = 0; j < spec.namedChildCount; j++) {
          const c = spec.namedChild(j)
          if (c && c.type === "identifier") nameNodes.push(c)
        }
        if (nameNodes.length > 0) {
          const isConst = spec.type === "const_spec"
          for (const nameNode of nameNodes) {
            if (!nameNode) continue
            symbols.push({
              name: nameNode.text,
              kind: isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
              range: this.nodeToRange(spec),
              visibility: this.isGoExported(nameNode.text) ? "public" : "private",
              ownerName: parentStruct,
              ownerKind: parentStruct ? ASTEngine.SymbolKind.Class : undefined,
              metadata: {
                nodeType: spec.type,
                isConst,
                isExported: this.isGoExported(nameNode.text),
              },
            })
          }
        }
      }
    }
  }

  // HELPER METHODS

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

  private isGoExported(name: string): boolean {
    // In Go, exported identifiers start with uppercase letter
    return name.length > 0 && name[0] >= "A" && name[0] <= "Z"
  }

  private extractGoApiContractPathFromComments(node: Node): string | undefined {
    let prevNode = node.previousNamedSibling
    // Gather all preceding comments
    const comments: string[] = []
    while (prevNode && prevNode.type === "comment") {
      comments.unshift(prevNode.text)
      prevNode = prevNode.previousNamedSibling
    }

    for (const comment of comments) {
      // Swaggo annotation: @Router /path/to/endpoint [method]
      const match = comment.match(/@Router\s+([^\s]+)\s+\[([^\]]+)\]/i)
      if (match) {
        return `${match[2].toUpperCase()} ${match[1]}`
      }
    }
    return undefined
  }

  private extractGoReceiver(methodNode: Node): { name: string; typeName: string; isPointer: boolean } | undefined {
    // Method receiver is the first parameter_list in method_declaration
    let receiverList: Node | null = null

    // Find the receiver parameter list (should be first parameter_list)
    for (let i = 0; i < methodNode.namedChildCount; i++) {
      const child = methodNode.namedChild(i)
      if (child?.type === "parameter_list") {
        receiverList = child
        break
      }
    }

    if (!receiverList) return undefined

    const receiverParam = receiverList.namedChild(0)
    if (!receiverParam || receiverParam.type !== "parameter_declaration") return undefined

    const receiverName = receiverParam.childForFieldName("name")
    const receiverType = receiverParam.childForFieldName("type")

    if (!receiverType) return undefined

    const typeName = receiverType.text
    const isPointer = typeName.startsWith("*")
    const actualTypeName = isPointer ? typeName.substring(1) : typeName

    return {
      name: receiverName?.text || "",
      typeName: actualTypeName,
      isPointer,
    }
  }

  private extractGoParameters(node: Node): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []

    // Find parameter_list (skip receiver for methods)
    let paramLists = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === "parameter_list") {
        paramLists.push(child)
      }
    }

    // For methods, skip first parameter_list (receiver)
    const targetParamList = node.type === "method_declaration" ? paramLists[1] : paramLists[0]
    if (!targetParamList) return parameters

    for (let i = 0; i < targetParamList.namedChildCount; i++) {
      const param = targetParamList.namedChild(i)
      if (param?.type === "parameter_declaration" || param?.type === "variadic_parameter_declaration") {
        const nameNodes: Node[] = []
        for (let j = 0; j < param.namedChildCount; j++) {
          const c = param.namedChild(j)
          if (c && c.type === "identifier") nameNodes.push(c)
        }
        const typeNode = param.childForFieldName("type")

        if (nameNodes.length > 0) {
          for (const nameNode of nameNodes) {
            if (!nameNode) continue
            parameters.push({
              name: nameNode.text,
              type: typeNode?.text,
              isOptional: false, // Go doesn't have optional parameters
            })
          }
        } else if (typeNode) {
          parameters.push({
            name: `arg${parameters.length}`,
            type: typeNode?.text,
            isOptional: false, // Go doesn't have optional parameters
          })
        }
      }
    }

    return parameters
  }

  private extractGoReturnType(node: Node): string | undefined {
    const resultNode = node.childForFieldName("result")
    if (resultNode) {
      return resultNode.text
    }

    // Fallback: look for common return type nodes
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        inArray(
          [
            "type_identifier",
            "qualified_type",
            "pointer_type",
            "slice_type",
            "array_type",
            "map_type",
            "channel_type",
            "function_type",
            "parameter_list",
          ],
          child.type,
        )
      ) {
        return child.text
      }
    }
    return undefined
  }

  private findGoFunctionCalls(functionNode: Node): string[] {
    const calls: string[] = []

    const bodyNode = functionNode.childForFieldName("body")
    if (bodyNode) {
      const stack = [bodyNode]
      while (stack.length > 0) {
        const node = stack.pop()!
        if (node.type === "call_expression") {
          const funcNode = node.childForFieldName("function")
          if (funcNode) {
            const callExpression = this.buildGoCallExpression(funcNode)
            if (callExpression && !this.isGoBuiltin(callExpression)) {
              calls.push(callExpression)
            }
          }
        }
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push(child)
        }
      }
    }

    return calls
  }

  private buildGoCallExpression(funcNode: Node): string {
    switch (funcNode.type) {
      case "identifier":
        return funcNode.text

      case "selector_expression":
        return this.buildGoSelectorExpression(funcNode)

      default:
        return funcNode.text
    }
  }

  private buildGoSelectorExpression(node: Node): string {
    const object = node.childForFieldName("operand")
    const field = node.childForFieldName("field")

    if (!object || !field) return node.text

    const objectText = object.type === "selector_expression" ? this.buildGoSelectorExpression(object) : object.text

    return `${objectText}.${field.text}`
  }

  private isGoBuiltin(call: string): boolean {
    const builtins = [
      "make",
      "new",
      "len",
      "cap",
      "append",
      "copy",
      "delete",
      "panic",
      "recover",
      "print",
      "println",
      "close",
    ]
    return inArray(builtins, call.split(".")[0])
  }

  // Framework detection
  private detectGoFrameworks(
    rootNode: Node,
    imports: ASTEngine.ImportInfo[],
  ): { name: string; confidence: number; patterns: string[] }[] {
    const frameworks: { name: string; confidence: number; patterns: string[] }[] = []
    const modules = mapSymbols(imports, (imp) => imp.module || "")

    // Pure AST/Import detection, NO primitive string matching
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/gin-gonic/gin"))) {
      frameworks.push({ name: "gin", confidence: 1.0, patterns: ["github.com/gin-gonic/gin"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/labstack/echo"))) {
      frameworks.push({ name: "echo", confidence: 1.0, patterns: ["github.com/labstack/echo"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/gofiber/fiber"))) {
      frameworks.push({ name: "fiber", confidence: 1.0, patterns: ["github.com/gofiber/fiber"] })
    }
    if (someSymbol(modules, (m) => m === "net/http" || m.startsWith("net/http/"))) {
      frameworks.push({ name: "net_http", confidence: 0.8, patterns: ["net/http"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/gorilla/mux"))) {
      frameworks.push({ name: "gorilla_mux", confidence: 1.0, patterns: ["github.com/gorilla/mux"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "google.golang.org/grpc"))) {
      frameworks.push({ name: "grpc", confidence: 1.0, patterns: ["google.golang.org/grpc"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/stretchr/testify"))) {
      frameworks.push({ name: "testify", confidence: 1.0, patterns: ["github.com/stretchr/testify"] })
    }

    return frameworks
  }

  private detectGoPatterns(rootNode: Node, symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!

      switch (node.type) {
        case "go_statement":
          if (!inArray(patterns, "goroutines")) patterns.push("goroutines")
          break
        case "defer_statement":
          if (!inArray(patterns, "defer")) patterns.push("defer")
          break
        case "send_statement":
        case "receive_statement":
        case "communication_case":
        case "channel_type":
          if (!inArray(patterns, "channels")) patterns.push("channels")
          break
        case "interface_type":
          if (node.namedChildCount === 0) {
            if (!inArray(patterns, "empty_interface")) patterns.push("empty_interface")
          }
          break
        case "if_statement":
          // Check for standard Go error handling: if err != null
          const condition = node.childForFieldName("condition")
          if (condition && stringIncludes(condition.text, "err") && stringIncludes(condition.text, "!=")) {
            if (!inArray(patterns, "error_handling")) patterns.push("error_handling")
          }
          break
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }

    if (someSymbol(symbols, (s) => s.metadata?.isInterface)) if (!inArray(patterns, "$1")) patterns.push("interfaces")
    if (someSymbol(symbols, (s) => s.metadata?.isStruct)) if (!inArray(patterns, "$1")) patterns.push("structs")

    return patterns
  }

  /**
   * Go Relationship Analysis
   * Analyzes Go-specific relationships: struct embedding, interface implementation, method receivers, package dependencies
   */
  private analyzeGoRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    ctx: GoContext,
  ) {
    // 1. Analyze struct embedding relationships
    this.analyzeGoStructEmbedding(rootNode, relationships, symbols)

    // 2. Analyze interface implementation relationships
    this.analyzeGoInterfaceImplementation(rootNode, relationships, symbols)

    // 3. Analyze method receiver relationships
    this.analyzeGoMethodReceivers(rootNode, relationships, symbols)

    // 4. Analyze function call relationships
    this.analyzeGoFunctionCalls(rootNode, relationships, symbols)

    // 5. Analyze package-level relationships
    this.analyzeGoPackageRelationships(rootNode, relationships, symbols, ctx)

    // 6. Analyze Go-specific patterns (channels, goroutines, defer)
    this.analyzeGoSpecificPatterns(rootNode, relationships, symbols)

    // 7. Analyze selector expression Uses (field access, method calls on values)
    this.analyzeGoSelectorUses(rootNode, relationships, symbols)
  }

  /**
   * Go Struct Embedding Analysis
   * Analyzes struct embedding (anonymous fields) which is Go's composition pattern
   */
  private analyzeGoStructEmbedding(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "type_declaration") {
        const typeSpecs = this.findChildrenByType(node, "type_spec")
        for (const typeSpec of typeSpecs) {
          const structSpec = this.findChildByType(typeSpec, "struct_type")
          if (structSpec) {
            const nameNode = typeSpec.childForFieldName("name")
            const structName = nameNode?.text
            if (structName) {
              const embeddedTypes = this.extractGoEmbeddedTypes(structSpec)
              forEachSymbol(embeddedTypes, (embeddedType) => {
                relationships.push({
                  source: structName,
                  target: embeddedType,
                  type: ASTEngine.RelationshipType.Contains,
                  confidence: 1.0,
                  metadata: {
                    relationshipType: "go_struct_embedding",
                    isEmbedding: true,
                    isAnonymous: true,
                    embedType: "struct_composition",
                  },
                })
                relationships.push({
                  source: structName,
                  target: embeddedType,
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 0.8,
                  metadata: {
                    relationshipType: "go_struct_embedding",
                    isEmbedding: true,
                    embedType: "struct_composition_extends",
                  },
                })
              })

              const fieldTypes = this.extractGoStructFieldTypes(structSpec)
              forEachSymbol(fieldTypes, ({ fieldName, fieldType }) => {
                if (this.isCustomGoType(fieldType)) {
                  relationships.push({
                    source: structName,
                    target: fieldType,
                    type: ASTEngine.RelationshipType.Uses,
                    confidence: 0.9,
                    metadata: {
                      relationshipType: "go_struct_field",
                      fieldName,
                      fieldType,
                    },
                  })
                }
              })
            }
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Go Interface Implementation Analysis
   * Analyzes implicit interface implementation (Go's duck typing)
   */
  private analyzeGoInterfaceImplementation(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    // Get all interfaces and their methods
    const interfaces = filterSymbols(symbols, (s) => s.metadata?.isInterface)
    const structs = filterSymbols(symbols, (s) => s.metadata?.isStruct)
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)

    forEachSymbol(interfaces, (interfaceSymbol) => {
      const interfaceMethods = this.getGoInterfaceMethods(interfaceSymbol, symbols)

      forEachSymbol(structs, (structSymbol) => {
        const valueMethods = filterSymbols(methods, (m) => {
          const receiverType = m.metadata?.receiverType || m.metadata?.receiver?.typeName
          const isPointer = !!(m.metadata?.isPointerReceiver || m.metadata?.receiver?.isPointer)
          return receiverType === structSymbol.name && !isPointer
        })
        const pointerMethods = filterSymbols(methods, (m) => {
          const receiverType = m.metadata?.receiverType || m.metadata?.receiver?.typeName
          return receiverType === structSymbol.name
        })

        // In Go method sets: T has value methods only; *T has value + pointer methods.
        const valueImpl = this.checkGoInterfaceImplementation(interfaceMethods, valueMethods)
        const pointerImpl = this.checkGoInterfaceImplementation(interfaceMethods, pointerMethods)

        if (valueImpl.implements) {
          relationships.push({
            source: structSymbol.name,
            target: interfaceSymbol.name,
            type: ASTEngine.RelationshipType.Implements,
            confidence: valueImpl.confidence,
            metadata: {
              relationshipType: "go_interface_implementation",
              isImplicit: true,
              matchedMethods: valueImpl.matchedMethods,
              implementationType: "duck_typing",
              receiverSet: "value",
            },
          })
        }

        if (!valueImpl.implements && pointerImpl.implements) {
          relationships.push({
            source: `*${structSymbol.name}`,
            target: interfaceSymbol.name,
            type: ASTEngine.RelationshipType.Implements,
            confidence: pointerImpl.confidence,
            metadata: {
              relationshipType: "go_interface_implementation",
              isImplicit: true,
              matchedMethods: pointerImpl.matchedMethods,
              implementationType: "duck_typing",
              receiverSet: "pointer",
            },
          })
        }
      })
    })
  }

  /**
   * Go Method Receiver Analysis
   * Analyzes method receiver relationships (value vs pointer receivers)
   */
  private analyzeGoMethodReceivers(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)

    forEachSymbol(methods, (method) => {
      const receiverType = method.metadata?.receiverType || method.metadata?.receiver?.typeName
      const receiverKind = method.metadata?.receiverKind || (method.metadata?.receiver?.isPointer ? "pointer" : "value")

      if (receiverType) {
        relationships.push({
          source: receiverType,
          target: method.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {
            relationshipType: "go_method_receiver",
            receiverKind,
            isPointerReceiver: receiverKind === "pointer",
            methodName: method.name,
          },
        })
      }
    })
  }

  /**
   * Go Function Call Analysis
   * Analyzes Go function calls including package-qualified calls
   */
  private analyzeGoFunctionCalls(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const functions = filterSymbols(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method,
    )

    forEachSymbol(functions, (func) => {
      const qualifiedCalls = func.qualified_calls || []
      forEachSymbol(qualifiedCalls, (call) => {
        // Handle package-qualified calls (package.Function)
        const targetFunction = this.resolveGoFunctionCall(call, symbols)
        if (targetFunction && targetFunction !== func.name) {
          relationships.push({
            source: func.name,
            target: targetFunction,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.8,
            metadata: {
              relationshipType: "go_function_call",
              callExpression: call,
              isPackageQualified: stringIncludes(call, "."),
            },
          })
          // Go constructors: NewFoo(), NewBar() — PascalCase functions returning types
          // Also track as Instantiates when the call suggests type construction
          if (targetFunction && targetFunction[0] === targetFunction[0].toUpperCase() && targetFunction[0] !== targetFunction[0].toLowerCase()) {
            relationships.push({
              source: func.name,
              target: targetFunction,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.6,
              metadata: { relationshipType: "go_instantiation", callExpression: call },
            })
          }
        }
      })
    })
  }

  /**
   * Go Package Relationships Analysis
   * Analyzes package-level dependencies and exports
   */
  private analyzeGoPackageRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    ctx: GoContext,
  ) {
    // Analyze package-level relationships from imports
    const content = ctx.content
    const currentPackage = this.extractGoPackageName(rootNode)

    if (currentPackage) {
      // Find exported symbols (capitalized names)
      const exportedSymbols = filterSymbols(symbols, (s) => this.isGoExported(s.name))
      forEachSymbol(exportedSymbols, (symbol) => {
        relationships.push({
          source: currentPackage,
          target: symbol.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {
            relationshipType: "go_package_export",
            isExported: true,
            packageName: currentPackage,
          },
        })
      })
    }
  }

  /**
   * Go-Specific Pattern Analysis
   * Analyzes goroutines, channels, defer statements, and Go idioms
   */
  private analyzeGoSpecificPatterns(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "go_statement") {
        const functionCall = this.extractGoRoutineFunction(node)
        if (functionCall) {
          const containingFunction = this.findContainingGoFunction(node)
          if (containingFunction) {
            relationships.push({
              source: containingFunction,
              target: functionCall,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: {
                relationshipType: "go_goroutine",
                isAsynchronous: true,
                pattern: "goroutine_spawn",
              },
            })
          }
        }
      }

      if (node.type === "send_statement" || node.type === "receive_statement" || this.isGoReceiveExpression(node)) {
        const channelVar = this.extractGoChannelVariable(node)
        const containingFunction = this.findContainingGoFunction(node)
        if (channelVar && containingFunction) {
          relationships.push({
            source: containingFunction,
            target: channelVar,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.8,
            metadata: {
              relationshipType: "go_channel_operation",
              operationType: node.type === "send_statement" ? "send" : "receive",
              pattern: "channel_communication",
            },
          })
        }
      }

      if (node.type === "select_statement" || node.type === "communication_case") {
        const channelVar = this.extractGoChannelVariable(node)
        const containingFunction = this.findContainingGoFunction(node)
        if (channelVar && containingFunction) {
          relationships.push({
            source: containingFunction,
            target: channelVar,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.85,
            metadata: {
              relationshipType: "go_select_channel",
              operationType: node.type === "select_statement" ? "select" : "select_case",
              pattern: "select_statement",
            },
          })
        }
      }

      if (node.type === "defer_statement") {
        const deferredFunction = this.extractDeferredFunction(node)
        const containingFunction = this.findContainingGoFunction(node)
        if (deferredFunction && containingFunction) {
          relationships.push({
            source: containingFunction,
            target: deferredFunction,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            metadata: {
              relationshipType: "go_defer",
              isDeferred: true,
              pattern: "defer_cleanup",
            },
          })
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Go Selector Expression Uses Analysis
   * Tracks field access and method calls on structs (e.g., p.Name, p.Greet())
   */
  private analyzeGoSelectorUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const stack = [rootNode]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "selector_expression") {
        const operand = node.childForFieldName("operand")
        const field = node.childForFieldName("field")
        if (operand && field) {
          const src = operand.text
          const tgt = field.text
          const key = `${src}.${tgt}`
          if (!seen.has(key)) {
            seen.add(key)
            relationships.push({
              source: src,
              target: tgt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.7,
              metadata: { relationshipType: "go_selector_use", selectorExpression: key },
            })
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Go Import Processing
   * Handles Go module paths, vendor imports, and package resolution
   */
  private processGoImports(rootNode: Node, imports: ASTEngine.ImportInfo[]) {
    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "import_declaration") {
        this.extractGoImportStatement(node, imports)
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Extract Go import statement with proper module path handling
   */
  private extractGoImportStatement(node: Node, imports: ASTEngine.ImportInfo[]) {
    const specs: Node[] = []

    const stack = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === "import_spec") {
        specs.push(current)
        continue
      }
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }

    for (const spec of specs) {
      this.processGoImportSpec(spec, imports)
    }
  }

  /**
   * Process individual Go import specification
   */
  private processGoImportSpec(spec: Node, imports: ASTEngine.ImportInfo[]) {
    const pathNode = spec.childForFieldName("path")
    const aliasNode = spec.childForFieldName("name")

    if (pathNode) {
      const importPath = pathNode.text.replace(/"/g, "") // Remove quotes
      const alias = aliasNode?.text
      const packageName = this.getGoPackageName(importPath)
      const framework = this.detectFrameworkFromGoImport(importPath)

      imports.push({
        module: importPath,
        isDefault: false,
        alias,
        items: [packageName],
        range: this.nodeToRange(spec),
        metadata: {
          isGoImport: true,
          packageName,
          framework,
          isStandardLibrary: this.isGoStandardLibrary(importPath),
          isThirdParty: this.isGoThirdPartyPackage(importPath),
        },
      })
    }
  }

  /**
   * Go Framework Pattern Analysis
   */
  private getGoFrameworkPatterns(frameworks: string[], symbols: ASTEngine.UniversalSymbol[]): any[] {
    const patterns: any[] = []

    for (const framework of frameworks) {
      switch (framework) {
        case "gin":
          patterns.push({
            framework: "Gin Web Framework",
            type: "web_framework",
            patterns: this.detectGinPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "gin.") || stringIncludes(c, "router.")),
              ),
              hasMiddleware: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Use(")),
              ),
              hasHandlers: someSymbol(symbols, (s) => stringIncludes(s.name.toLowerCase(), "handler")),
            },
          })
          break

        case "echo":
          patterns.push({
            framework: "Echo Web Framework",
            type: "web_framework",
            patterns: this.detectEchoPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "echo.") || stringIncludes(c, "e.")),
              ),
              hasMiddleware: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Use(")),
              ),
              hasContext: someSymbol(symbols, (s) =>
                someSymbol(s.parameters || [], (p) => stringIncludes(p.type || "", "Context")),
              ),
            },
          })
          break

        case "fiber":
          patterns.push({
            framework: "Fiber Web Framework",
            type: "web_framework",
            patterns: this.detectFiberPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "fiber.") || stringIncludes(c, "app.")),
              ),
              hasFastHTTP: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "fasthttp")),
              ),
            },
          })
          break

        case "gorilla_mux":
          patterns.push({
            framework: "Gorilla Mux Router",
            type: "router",
            patterns: this.detectGorillaMuxPatterns(symbols),
            confidence: 0.8,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(
                  s.qualified_calls || [],
                  (c) => stringIncludes(c, "mux.") || stringIncludes(c, "HandleFunc"),
                ),
              ),
              hasSubrouters: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "PathPrefix")),
              ),
            },
          })
          break

        case "gorm":
          patterns.push({
            framework: "GORM ORM",
            type: "orm",
            patterns: this.detectGORMPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasModels: someSymbol(symbols, (s) => s.kind === ASTEngine.SymbolKind.Class && s.metadata?.isGoStruct),
              hasMigrations: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "AutoMigrate")),
              ),
              hasQueries: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Find") || stringIncludes(c, "Create")),
              ),
            },
          })
          break

        case "grpc":
          patterns.push({
            framework: "gRPC",
            type: "rpc_framework",
            patterns: this.detectGRPCPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasServices: someSymbol(symbols, (s) => stringIncludes(s.name.toLowerCase(), "service")),
              hasProtobuf: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "proto")),
              ),
              hasStreamingMethods: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "stream")),
              ),
            },
          })
          break
      }
    }

    return patterns
  }

  /**
   * Go Architectural Insights
   */
  private generateGoArchitecturalInsights(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): any[] {
    const insights: any[] = []

    // Analyze function complexity
    const complexFunctions = filterSymbols(
      symbols,
      (s) =>
        (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
        !!s.qualified_calls &&
        s.qualified_calls.length > 12,
    )
    if (complexFunctions.length > 0) {
      insights.push({
        type: "complexity_analysis",
        category: "function_complexity",
        message: `${complexFunctions.length} functions with high complexity detected`,
        functions: mapSymbols(complexFunctions, (f) => f.name),
        recommendation: "Consider breaking down complex functions into smaller, focused functions",
        severity: "warning",
      })
    }

    // Analyze Go-specific patterns
    const goroutineFunctions = getUniqueStrings(
      mapSymbols(
        filterSymbols(relationships, (r) => r.metadata?.relationshipType === "go_goroutine" && !!r.source),
        (r) => r.source as string,
      ),
    )
    if (goroutineFunctions.length > 0) {
      insights.push({
        type: "concurrency_pattern",
        category: "goroutines",
        message: `Goroutine usage detected in ${goroutineFunctions.length} functions`,
        functions: goroutineFunctions,
        recommendation: "Ensure proper goroutine lifecycle management and channel synchronization",
      })
    }

    // Analyze channel usage
    const channelFunctions = getUniqueStrings(
      mapSymbols(
        filterSymbols(relationships, (r) => r.metadata?.relationshipType === "go_channel_operation" && !!r.source),
        (r) => r.source as string,
      ),
    )
    if (channelFunctions.length > 0) {
      insights.push({
        type: "concurrency_pattern",
        category: "channels",
        message: `Channel communication pattern detected in ${channelFunctions.length} functions`,
        functions: channelFunctions,
        recommendation: "Follow channel ownership patterns and avoid goroutine leaks",
      })
    }

    // Analyze struct-based design
    const structs = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Class && s.metadata?.isGoStruct)
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)

    if (structs.length > 0) {
      const methodToStructRatio = methods.length / structs.length
      insights.push({
        type: "design_pattern",
        category: "struct_design",
        message: `${structs.length} structs with ${methods.length} methods (ratio: ${methodToStructRatio.toFixed(2)})`,
        structs: mapSymbols(structs, (s) => s.name),
        quality: methodToStructRatio > 3 ? "rich_behavior" : methodToStructRatio > 1 ? "balanced" : "anemic_structs",
        recommendation:
          methodToStructRatio < 1
            ? "Consider adding methods to structs for better encapsulation"
            : "Good struct-method balance",
      })
    }

    // Analyze error handling patterns
    const errorHandling = this.analyzeGoErrorHandling(symbols)
    if (errorHandling.functions > 0) {
      insights.push({
        type: "error_handling",
        category: "go_errors",
        message: `Error handling detected in ${errorHandling.functions} functions`,
        coverage: `${((errorHandling.withErrorHandling / errorHandling.functions) * 100).toFixed(1)}%`,
        recommendation:
          errorHandling.withErrorHandling / errorHandling.functions < 0.7
            ? "Improve error handling coverage"
            : "Good error handling practices",
      })
    }

    // Analyze interface usage
    const interfaces = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Interface)
    if (interfaces.length > 0) {
      insights.push({
        type: "design_pattern",
        category: "interfaces",
        message: `${interfaces.length} interfaces promoting loose coupling`,
        interfaces: mapSymbols(interfaces, (i) => i.name),
        recommendation: "Good use of Go interfaces for abstraction",
      })
    }

    return insights
  }

  // ======================== GO FRAMEWORK DETECTION METHODS ========================

  private detectGinPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (
      someSymbol(symbols, (s) =>
        someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "gin.Default") || stringIncludes(c, "gin.New")),
      )
    ) {
      patterns.push("gin_router_setup")
    }
    if (
      someSymbol(symbols, (s) =>
        someSymbol(
          s.qualified_calls || [],
          (c) => stringIncludes(c, "GET") || stringIncludes(c, "POST") || stringIncludes(c, "PUT"),
        ),
      )
    ) {
      patterns.push("rest_endpoints")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Group(")))) {
      patterns.push("route_grouping")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Use(")))) {
      patterns.push("middleware_usage")
    }

    return patterns
  }

  private detectEchoPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "echo.New")))) {
      patterns.push("echo_setup")
    }
    if (
      someSymbol(symbols, (s) => someSymbol(s.parameters || [], (p) => stringIncludes(p.type || "", "echo.Context")))
    ) {
      patterns.push("echo_context_usage")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Bind(")))) {
      patterns.push("request_binding")
    }

    return patterns
  }

  private detectFiberPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "fiber.New")))) {
      patterns.push("fiber_app_setup")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "BodyParser(")))) {
      patterns.push("request_parsing")
    }

    return patterns
  }

  private detectGorillaMuxPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "mux.NewRouter")))) {
      patterns.push("gorilla_router_setup")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "HandleFunc(")))) {
      patterns.push("route_handlers")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "PathPrefix(")))) {
      patterns.push("path_prefixes")
    }

    return patterns
  }

  private detectGORMPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "gorm.Open")))) {
      patterns.push("gorm_connection")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "AutoMigrate(")))) {
      patterns.push("auto_migration")
    }
    if (
      someSymbol(symbols, (s) =>
        someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Create(") || stringIncludes(c, "Find(")),
      )
    ) {
      patterns.push("crud_operations")
    }

    return patterns
  }

  private detectGRPCPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (
      someSymbol(
        symbols,
        (s) => stringIncludes(s.name.toLowerCase(), "service") && s.kind === ASTEngine.SymbolKind.Class,
      )
    ) {
      patterns.push("grpc_services")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "grpc.NewServer")))) {
      patterns.push("grpc_server_setup")
    }

    return patterns
  }

  // ======================== GO HELPER METHODS ========================

  private getGoPackageName(importPath: string): string {
    const parts = importPath.split("/")
    return parts[parts.length - 1]
  }

  private detectFrameworkFromGoImport(importPath: string): string | undefined {
    if (stringIncludes(importPath, "gin-gonic/gin")) return "gin"
    if (stringIncludes(importPath, "labstack/echo")) return "echo"
    if (stringIncludes(importPath, "gofiber/fiber")) return "fiber"
    if (stringIncludes(importPath, "gorilla/mux")) return "gorilla_mux"
    if (stringIncludes(importPath, "gorm.io/gorm")) return "gorm"
    if (stringIncludes(importPath, "github.com/jmoiron/sqlx")) return "sqlx"
    if (stringIncludes(importPath, "entgo.io/ent")) return "ent"
    if (stringIncludes(importPath, "google.golang.org/grpc")) return "grpc"
    if (stringIncludes(importPath, "golang.org/x/")) return "golang_extended"
    if (stringIncludes(importPath, "go.uber.org/fx")) return "fx"
    if (stringIncludes(importPath, "github.com/google/wire")) return "wire"
    if (stringIncludes(importPath, "go.uber.org/zap")) return "zap"
    if (stringIncludes(importPath, "github.com/sirupsen/logrus")) return "logrus"

    return undefined
  }

  private isGoStandardLibrary(importPath: string): boolean {
    const stdLibPrefixes = [
      "fmt",
      "net/http",
      "os",
      "io",
      "strings",
      "strconv",
      "time",
      "json",
      "context",
      "sync",
      "log",
      "bufio",
      "bytes",
      "crypto",
      "database/sql",
      "encoding",
      "errors",
      "flag",
      "html",
      "math",
      "path",
      "reflect",
      "regexp",
      "runtime",
      "sort",
      "testing",
      "unicode",
      "unsafe",
    ]

    return (
      someSymbol(stdLibPrefixes, (prefix) => importPath === prefix || importPath.startsWith(prefix + "/")) ||
      !stringIncludes(importPath, ".")
    )
  }

  private isGoThirdPartyPackage(importPath: string): boolean {
    return stringIncludes(importPath, ".") && !this.isGoStandardLibrary(importPath)
  }

  private analyzeGoErrorHandling(symbols: ASTEngine.UniversalSymbol[]): {
    functions: number
    withErrorHandling: number
  } {
    const functions = filterSymbols(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method,
    )

    let withErrorHandling = 0
    for (const func of functions) {
      if (func.metadata?.hasErrorHandling) {
        withErrorHandling++
      }
    }

    return { functions: functions.length, withErrorHandling }
  }

  /**
   * Go Architectural Score Calculation
   */
  private calculateArchitecturalScore(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): number {
    let score = 75 // Base score for Go

    // Reward Go best practices
    if (inArray(patterns, "error_handling")) score += 8
    if (inArray(patterns, "goroutines")) score += 6
    if (inArray(patterns, "channels")) score += 6
    if (inArray(patterns, "interfaces")) score += 5
    if (inArray(patterns, "dependency_injection")) score += 4

    // Reward proper struct design
    const structs = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Class && s.metadata?.isGoStruct)
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)
    if (structs.length > 0) {
      const methodToStructRatio = methods.length / structs.length
      if (methodToStructRatio >= 1 && methodToStructRatio <= 5) score += 3
    }

    // Reward interface usage
    const interfaces = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Interface)
    if (interfaces.length > 0) {
      score += Math.min(interfaces.length * 2, 6)
    }

    // Penalize complexity issues
    const complexFunctions = filterSymbols(symbols, (s) => !!s.qualified_calls && s.qualified_calls.length > 12)
    score -= complexFunctions.length * 2

    return Math.max(40, Math.min(100, score))
  }

  /**
   * Go Code Quality Assessment
   */
  private assessCodeQuality(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): string {
    const score = this.calculateArchitecturalScore(symbols, relationships, patterns)

    if (score >= 90) return "exceptional"
    if (score >= 80) return "excellent"
    if (score >= 70) return "good"
    if (score >= 60) return "fair"
    if (score >= 50) return "needs_improvement"
    return "poor"
  }

  private calculateGoComplexity(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): number {
    return symbols.length + relationships.length
  }

  /**
   * Go Cyclomatic Complexity Calculation
   * Calculates complexity for Go code including goroutines, channels, defer, type switches, and Go-specific patterns
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1 // Base complexity

    const traverse = (n: Node) => {
      switch (n.type) {
        case "if_statement":
        case "for_statement":
        case "expression_switch_statement":
        case "type_switch_statement":
        case "select_statement":
        case "expression_case":
        case "communication_case":
        case "default_case":
          complexity++
          break
        case "binary_expression": {
          const txt = n.text
          if (stringIncludes(txt, "&&") || stringIncludes(txt, "||")) complexity++
          break
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(node)
    return complexity
  }

  // ===== GO HELPER METHODS FOR RELATIONSHIP ANALYSIS =====

  /**
   * Find child node by type
   */
  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return null
  }

  private findChildrenByType(node: Node, type: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) results.push(child)
    }
    return results
  }

  /**
   * Get Go type name from type declaration
   */
  private getGoTypeName(node: Node): string | undefined {
    const spec = this.findChildByType(node, "type_spec")
    if (spec) {
      const nameNode = spec.childForFieldName("name")
      return nameNode?.text
    }
    return undefined
  }

  /**
   * Extract embedded types from struct (anonymous fields)
   */
  private extractGoEmbeddedTypes(structNode: Node): string[] {
    const embeddedTypes: string[] = []
    const fieldList = this.findChildByType(structNode, "field_declaration_list")

    if (fieldList) {
      for (let i = 0; i < fieldList.namedChildCount; i++) {
        const field = fieldList.namedChild(i)
        if (field?.type === "field_declaration") {
          // Check if it's an embedded field (no field name, just type)
          const fieldNames = []
          for (let j = 0; j < field.namedChildCount; j++) {
            const c = field.namedChild(j)
            if (c && (c.type === "field_identifier" || c.type === "identifier")) fieldNames.push(c)
          }
          if (fieldNames.length === 0) {
            // This is an embedded field
            const typeNode = field.childForFieldName("type") || this.findChildByType(field, "type_identifier")
            if (typeNode) {
              embeddedTypes.push(typeNode.text)
            }
          }
        }
      }
    }

    return embeddedTypes
  }

  /**
   * Extract struct field types with their names
   */
  private extractGoStructFieldTypes(structNode: Node): Array<{ fieldName: string; fieldType: string }> {
    const fields: Array<{ fieldName: string; fieldType: string }> = []
    const fieldList = this.findChildByType(structNode, "field_declaration_list")

    if (fieldList) {
      for (let i = 0; i < fieldList.namedChildCount; i++) {
        const field = fieldList.namedChild(i)
        if (field?.type === "field_declaration") {
          const nameNodes = []
          for (let j = 0; j < field.namedChildCount; j++) {
            const c = field.namedChild(j)
            if (c && (c.type === "field_identifier" || c.type === "identifier")) nameNodes.push(c)
          }
          const typeNode = field.childForFieldName("type")

          if (nameNodes.length > 0 && typeNode) {
            forEachSymbol(nameNodes, (nameNode: Node | null) => {
              if (nameNode) {
                fields.push({
                  fieldName: nameNode.text,
                  fieldType: typeNode.text,
                })
              }
            })
          }
        }
      }
    }

    return fields
  }

  /**
   * Check if type is a custom Go type (not built-in)
   */
  private isCustomGoType(typeName: string): boolean {
    const builtinTypes = [
      "bool",
      "byte",
      "complex64",
      "complex128",
      "error",
      "float32",
      "float64",
      "int",
      "int8",
      "int16",
      "int32",
      "int64",
      "rune",
      "string",
      "uint",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
      "uintptr",
    ]

    // Remove pointer and slice markers
    const cleanType = typeName
      .replace(/^\*+/, "")
      .replace(/^(\[[\w]*\])+/, "")
      .trim()

    return (
      !inArray(builtinTypes, cleanType) &&
      !cleanType.startsWith("map[") &&
      !cleanType.startsWith("chan ") &&
      !cleanType.startsWith("func(")
    )
  }

  /**
   * Get interface methods from interface symbol
   */
  private getGoInterfaceMethods(
    interfaceSymbol: ASTEngine.UniversalSymbol,
    symbols: ASTEngine.UniversalSymbol[],
  ): Array<{ name: string; signature: string }> {
    const interfaceMethods: Array<{ name: string; signature: string }> = []

    // Find methods that belong to this interface
    const methods = filterSymbols(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Method && s.ownerName === interfaceSymbol.name,
    )

    forEachSymbol(methods, (method) => {
      const signature = this.buildGoMethodSignature(method)
      interfaceMethods.push({
        name: method.name,
        signature,
      })
    })

    const embedded = filterSymbols(
      symbols,
      (s) =>
        s.ownerName === interfaceSymbol.name &&
        s.ownerKind === ASTEngine.SymbolKind.Interface &&
        s.metadata?.isEmbeddedInterface,
    )
    forEachSymbol(embedded, (entry) => {
      const target = findSymbol(
        symbols,
        (s) => s.kind === ASTEngine.SymbolKind.Interface && s.name === entry.name && !s.metadata?.isEmbeddedInterface,
      )
      if (!target) return

      const inherited = this.getGoInterfaceMethods(target, symbols)
      forEachSymbol(inherited, (m) => {
        if (!someSymbol(interfaceMethods, (x) => x.name === m.name && x.signature === m.signature)) {
          interfaceMethods.push(m)
        }
      })
    })

    return interfaceMethods
  }

  /**
   * Check if struct implements interface (Go's implicit interface implementation)
   */
  private checkGoInterfaceImplementation(
    interfaceMethods: Array<{ name: string; signature: string }>,
    structMethods: ASTEngine.UniversalSymbol[],
  ): { implements: boolean; confidence: number; matchedMethods: string[] } {
    const matchedMethods: string[] = []
    let totalMethods = interfaceMethods.length

    if (totalMethods === 0) {
      return { implements: false, confidence: 0, matchedMethods: [] }
    }

    forEachSymbol(interfaceMethods, (interfaceMethod) => {
      const matchingMethod = findSymbol(structMethods, (structMethod) => {
        const structSignature = this.buildGoMethodSignature(structMethod)
        return (
          interfaceMethod.name === structMethod.name &&
          this.compareGoMethodSignatures(interfaceMethod.signature, structSignature)
        )
      })

      if (matchingMethod) {
        matchedMethods.push(interfaceMethod.name)
      }
    })

    const doesImplement = matchedMethods.length === totalMethods
    const confidence = doesImplement ? 1.0 : matchedMethods.length / totalMethods

    return { implements: doesImplement, confidence, matchedMethods }
  }

  /**
   * Build Go method signature for comparison
   */
  private buildGoMethodSignature(method: ASTEngine.UniversalSymbol): string {
    const params = mapSymbols(method.parameters || [], (p) => p.type || "interface{}").join(", ") || ""
    const returnType = method.returnType || "void"
    return `${method.name}(${params}) ${returnType}`
  }

  /**
   * Compare Go method signatures for interface implementation
   */
  private compareGoMethodSignatures(sig1: string, sig2: string): boolean {
    // Normalize signatures by removing extra whitespace and variadic expansion
    const normalize = (sig: string) => {
      return sig
        .replace(/\s+/g, " ")
        .replace(/([\w\.]+)\s*\.\.\./g, "...$1")
        .replace(/\binterface\{\}/g, "any")
        .trim()
    }
    return normalize(sig1) === normalize(sig2)
  }

  /**
   * Resolve Go function call to find target
   */
  private resolveGoFunctionCall(callExpression: string, symbols: ASTEngine.UniversalSymbol[]): string | undefined {
    // Handle package-qualified calls (package.Function)
    if (stringIncludes(callExpression, ".")) {
      const parts = callExpression.split(".")
      const packageName = parts.slice(0, -1).join(".") // everything before last dot
      const functionName = parts[parts.length - 1]

      // Look for function with this name AND matching package context
      const targetFunction = findSymbol(
        symbols,
        (s) =>
          (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
          s.name === functionName &&
          // If the call is package-qualified, prefer functions from that package
          // but since we only have current-file symbols, only match if the symbol
          // is from the same logical grouping or is the only match
          (!s.ownerName || s.ownerName === packageName || packageName === ""),
      )

      // Fall back to name-only match BUT mark confidence lower for cross-package
      if (targetFunction) return targetFunction.name
      const fallback = findSymbol(symbols, (s) =>
        (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
        s.name === functionName,
      )
      return fallback?.name
    }

    // Handle direct function calls
    const targetFunction = findSymbol(
      symbols,
      (s) =>
        (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
        s.name === callExpression,
    )

    return targetFunction?.name
  }

  /**
   * Extract Go package name from content
   */
  private extractGoPackageName(rootNode: Node): string | undefined {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i)
      if (child && child.type === "package_clause") {
        const pkgId = child.childForFieldName("package_identifier") || child.namedChild(0)
        return pkgId ? pkgId.text : undefined
      }
    }
    return undefined
  }

  /**
   * Extract function called in goroutine
   */
  private extractGoRoutineFunction(node: Node): string | undefined {
    const callExpr = this.findChildByType(node, "call_expression")
    if (callExpr) {
      const functionNode = callExpr.childForFieldName("function")
      if (functionNode?.type === "func_literal") {
        return "anonymous_closure"
      }
      return functionNode?.text
    }
    return undefined
  }

  /**
   * Find containing Go function for a node
   */
  private findContainingGoFunction(node: Node): string | undefined {
    let current = node.parent
    while (current) {
      if (current.type === "function_declaration" || current.type === "method_declaration") {
        const nameNode = current.childForFieldName("name")
        return nameNode?.text
      }
      current = current.parent
    }
    return undefined
  }

  /**
   * Extract channel variable from channel operation
   */
  private extractGoChannelVariable(node: Node): string | undefined {
    if (node.type === "send_statement") {
      const channelNode = node.childForFieldName("channel")
      return channelNode?.text
    }
    if (node.type === "receive_statement") {
      const channelNode = node.childForFieldName("operand")
      return channelNode?.text
    }
    if (this.isGoReceiveExpression(node)) {
      const channelNode = node.childForFieldName("operand") || node.namedChild(0)
      return channelNode?.text
    }
    return undefined
  }

  private isGoReceiveExpression(node: Node): boolean {
    return node.type === "unary_expression" && node.child(0)?.type === "<-"
  }

  /**
   * Extract deferred function from defer statement
   */
  private extractDeferredFunction(node: Node): string | undefined {
    const callExpr = this.findChildByType(node, "call_expression")
    if (callExpr) {
      const functionNode = callExpr.childForFieldName("function")
      return functionNode?.text
    }
    return undefined
  }

  private extractGoMethodSpecParameters(node: Node): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []
    const paramList = this.findChildByType(node, "parameter_list")
    if (!paramList) return parameters

    for (let i = 0; i < paramList.namedChildCount; i++) {
      const param = paramList.namedChild(i)
      if (param?.type !== "parameter_declaration") continue

      const typeNode = param.childForFieldName("type")
      const nameNodes: Node[] = []
      for (let j = 0; j < param.namedChildCount; j++) {
        const c = param.namedChild(j)
        if (c && c.type === "identifier") nameNodes.push(c)
      }
      if (nameNodes.length > 0) {
        for (const nameNode of nameNodes) {
          if (!nameNode) continue
          parameters.push({
            name: nameNode.text,
            type: typeNode?.text,
            isOptional: false,
          })
        }
      } else if (typeNode) {
        parameters.push({
          name: `arg${parameters.length}`,
          type: typeNode.text,
          isOptional: false,
        })
      }
    }

    return parameters
  }

  private extractGoMethodSpecReturnType(node: Node): string | undefined {
    const resultNode = node.childForFieldName("result")
    if (resultNode) return resultNode.text

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        inArray(
          [
            "type_identifier",
            "qualified_type",
            "pointer_type",
            "slice_type",
            "array_type",
            "map_type",
            "channel_type",
            "function_type",
            "parameter_list",
          ],
          child.type,
        )
      ) {
        return child.text
      }
    }

    return undefined
  }

  private hasGoErrorHandling(text: string): boolean {
    if (!text) return false
    return (
      stringIncludes(text, "err != nil") ||
      stringIncludes(text, "fmt.Errorf(") ||
      stringIncludes(text, "errors.New(") ||
      stringIncludes(text, "panic(")
    )
  }
}
