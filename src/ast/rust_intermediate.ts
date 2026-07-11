// @ts-nocheck
// Real Rust Intelligence Engine
// AST analysis for Rust language

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealRustAnalyzer implements ASTEngine.LanguageAnalyzer {
  private currentFile: string = ""
  private content: string = ""

    analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    this.currentFile = filePath
    this.content = content

    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // ========================================================================
    // STAGE 3: RESILIENT PARSING & ERROR NODE BYPASS
    // ========================================================================
    if (rootNode.hasError) {
      const collectErrors = (node: Node) => {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({
            message: `Syntax ${node.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: node.startPosition.row,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row,
              endColumn: node.endPosition.column,
            },
            severity: `warning`,
          })
        }
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) collectErrors(child)
        }
      }
      collectErrors(rootNode)
    }

    // PHASE 1: Extract Rust symbols with proper understanding
    this.extractRustSymbols(rootNode, symbols, relationships, content)

    // PHASE 2: Analyze Rust-specific relationships
    this.analyzeRustRelationships(rootNode, relationships, symbols)

    // PHASE 3: Process Rust imports (use statements and crates)
    this.processRustImports(rootNode, imports)

    // PHASE 4: Detect Rust frameworks and patterns
    const frameworks = this.detectRustFrameworks(content)
    const patterns = this.detectRustPatterns(content, symbols)

    // ========================================================================
    // STAGE 3: PHANTOM SYMBOL INJECTION (Framework Heuristics)
    // ========================================================================
    this.injectPhantomSymbols(rootNode, symbols, frameworks)

    return {
      language: "rust",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: this.calculateRustComplexity(symbols, relationships),
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: this.calculateCyclomaticComplexity(rootNode),
        framework: frameworks[0], // Primary framework
        patterns,

        // Rust intelligence metadata
        detectedFrameworks: frameworks,
        frameworkPatterns: this.getRustFrameworkPatterns(frameworks, symbols),
        architecturalInsights: this.generateRustArchitecturalInsights(symbols, relationships),
        architecturalScore: this.calculateArchitecturalScore(symbols, relationships, patterns),
        codeQuality: this.assessCodeQuality(symbols, relationships, patterns),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.0-infallible-brain",
      },
    }
  }

  /**
   * PHASE 1: Extract Rust symbols with proper Rust semantics understanding
   */
    private injectPhantomSymbols(rootNode: Node, symbols: ASTEngine.UniversalSymbol[], frameworks: string[]): void {
    const isSerde = frameworks.includes("serde")
    const isDiesel = frameworks.includes("diesel")

    for (const symbol of symbols) {
      // Rust Macros: Inject phantom symbols for common macros like #[derive(Serialize, Deserialize)]
      if (symbol.kind === ASTEngine.SymbolKind.Struct || symbol.kind === ASTEngine.SymbolKind.Enum) {
        if (isSerde && symbol.decorators?.some((d) => d.includes("Serialize"))) {
          symbols.push({
            name: "serialize",
            kind: ASTEngine.SymbolKind.Method,
            scope: symbol.name,
            modifiers: ["phantom", "macro_generated", "serde"],
            range: symbol.range,
            parameters: [{ name: "serializer", type: "S" }],
            returnType: "Result<S::Ok, S::Error>",
            metadata: { isPhantom: true },
          })
        }
        if (isSerde && symbol.decorators?.some((d) => d.includes("Deserialize"))) {
          symbols.push({
            name: "deserialize",
            kind: ASTEngine.SymbolKind.Method,
            scope: symbol.name,
            modifiers: ["phantom", "macro_generated", "serde"],
            range: symbol.range,
            parameters: [{ name: "deserializer", type: "D" }],
            returnType: `Result<${symbol.name}, D::Error>`,
            metadata: { isPhantom: true },
          })
        }
      }
    }
  }

private extractRustSymbols(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    content: string,
    parentImpl?: string,
    parentTrait?: string,
  ) {
    switch (node.type) {
      case "struct_item":
        this.extractRustStruct(node, symbols, relationships)
        break

      case "enum_item":
        this.extractRustEnum(node, symbols)
        break

      case "trait_item":
        this.extractRustTrait(node, symbols)
        break

      case "impl_item":
        this.extractRustImpl(node, symbols)
        break

      case "function_item":
        this.extractRustFunction(node, symbols, relationships, parentImpl)
        break

      case "function_signature_item":
        this.extractRustTraitMethod(node, symbols, parentTrait)
        break

      case "const_item":
      case "static_item":
        this.extractRustConstants(node, symbols)
        break

      case "type_item":
        this.extractRustTypeAlias(node, symbols)
        break

      case "mod_item":
        this.extractRustModule(node, symbols)
        break

      case "foreign_mod_item":
        this.extractRustFFI(node, symbols, relationships)
        break
    }

    // Recursively process children
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        // Pass impl context to children
        const implContext = node.type === "impl_item" ? this.getImplTarget(node) : parentImpl
        const traitContext = node.type === "trait_item" ? this.getRustTraitName(node) : parentTrait
        this.extractRustSymbols(child, symbols, relationships, content, implContext, traitContext)
      }
    }
  }

  /**
   * Extract Rust FFI bindings
   */
  private extractRustFFI(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === "function_signature_item") {
        const nameNode = this.findChildByType(child, "identifier")
        if (nameNode) {
          const funcName = nameNode.text
          symbols.push({
            name: funcName,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(child),
            visibility: "public",
            metadata: {
              nodeType: child.type,
              isRustFunction: true,
              isFFI: true,
            },
          })

          relationships.push({
            source: this.currentFile,
            target: funcName,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 1.0,
            metadata: {
              relationshipType: "ffi_import",
              isFFI: true,
            },
          })
        }
      }
    }
  }

  /**
   * Extract Rust struct declarations
   */
  private extractRustStruct(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ) {
    const nameNode = this.findChildByType(node, "type_identifier")
    if (!nameNode) return

    const structName = nameNode.text
    const visibility = this.getRustVisibility(node)
    const attributes = this.extractRustAttributes(node)

    // ORM Database Intelligence (Diesel, SQLx)
    const dbTableName = this.extractDatabaseTableName(attributes)
    if (dbTableName) {
      relationships.push({
        source: structName,
        target: dbTableName,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 1.0,
        metadata: {
          isDatabase: true,
          relationshipType: "mapped_table",
        },
      })
    }

    symbols.push({
      name: structName,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(node),
      visibility,
      decorators: attributes,
      metadata: {
        nodeType: node.type,
        isRustStruct: true,
        visibility: visibility,
        attributes,
        isPublic: visibility === "public",
      },
    })

    // Extract struct fields
    this.extractRustStructFields(node, symbols, structName)
  }

  private extractDatabaseTableName(attributes: string[]): string | null {
    const hasOrmDerive = attributes.some(
      (attr) => attr.includes("derive") && (attr.includes("Queryable") || attr.includes("FromRow")),
    )

    if (hasOrmDerive) {
      for (const attr of attributes) {
        const tableMatch = attr.match(/table_name\s*=\s*"([^"]+)"/)
        if (tableMatch) return tableMatch[1]
      }
      return "implied_table_name" // Or we could try to infer from struct name
    }
    return null
  }

  /**
   * Extract Rust enum declarations
   */
  private extractRustEnum(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = this.findChildByType(node, "type_identifier")
    if (!nameNode) return

    const enumName = nameNode.text
    const visibility = this.getRustVisibility(node)

    symbols.push({
      name: enumName,
      kind: ASTEngine.SymbolKind.Enum,
      range: this.nodeToRange(node),
      visibility,
      decorators: this.extractRustAttributes(node),
      metadata: {
        nodeType: node.type,
        isRustEnum: true,
        visibility: visibility,
        attributes: this.extractRustAttributes(node),
      },
    })

    // Extract enum variants
    this.extractRustEnumVariants(node, symbols, enumName)
  }

  /**
   * Extract Rust trait declarations
   */
  private extractRustTrait(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = this.findChildByType(node, "type_identifier")
    if (!nameNode) return

    const traitName = nameNode.text
    const visibility = this.getRustVisibility(node)
    const attributes = this.extractRustAttributes(node)

    symbols.push({
      name: traitName,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      visibility,
      decorators: attributes,
      metadata: {
        nodeType: node.type,
        isRustTrait: true,
        visibility: visibility,
        typeParameters: this.extractTypeParameters(node),
        attributes: this.extractRustAttributes(node),
      },
    })
  }

  /**
   * Extract Rust impl blocks
   */
  private extractRustImpl(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const target = this.getImplTarget(node)
    const traitName = this.getImplTrait(node)

    if (target) {
      // Note: We don't create a symbol for impl blocks themselves,
      // but we process their methods with the target context
      // The methods will be extracted when we recurse into the impl block
    }
  }

  /**
   * Extract Rust function declarations
   */
  private extractRustFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parentImpl?: string,
  ) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode) return

    const functionName = nameNode.text
    const visibility = this.getRustVisibility(node)
    const isAsync = this.hasRustModifier(node, "async")
    const attributes = this.extractRustAttributes(node)

    // Framework Route Extraction (Axum / Actix / Rocket)
    this.extractFrameworkRoute(functionName, attributes, relationships)

    // Extract parameters
    const parameters = this.extractRustParameters(node)

    // Extract return type
    const returnType = this.extractRustReturnType(node)

    // Find function calls within this function
    const qualifiedCalls = this.findRustFunctionCalls(node)

    const kind = parentImpl ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function

    symbols.push({
      name: functionName,
      kind,
      range: this.nodeToRange(node),
      parameters,
      returnType,
      qualified_calls: qualifiedCalls,
      apiContractPath: this.extractApiContractPath(attributes),
      isAsync,
      visibility,
      decorators: attributes,
      ownerName: parentImpl,
      ownerKind: parentImpl ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        nodeType: node.type,
        isRustFunction: true,
        isAsync,
        visibility: visibility,
        attributes,
        isSelfMethod: this.isSelfMethod(node),
        selfKind: this.getSelfKind(node), // &self, &mut self, self
      },
    })
  }

  
  private extractApiContractPath(attributes: string[]): string | undefined {
    const routeRegex = /#\[\s*(get|post|put|delete|patch|head|options)\s*\(\s*"([^"]+)"/i
    for (const attr of attributes) {
      const match = attr.match(routeRegex)
      if (match) {
        return `${match[1].toUpperCase()} ${match[2]}`;
      }
    }
    return undefined;
  }

  private extractFrameworkRoute(
    functionName: string,
    attributes: string[],
    relationships: ASTEngine.UniversalRelationship[],
  ) {
    const routeRegex = /#\[\s*(get|post|put|delete|patch|head|options)\s*\(\s*"([^"]+)"/i

    for (const attr of attributes) {
      const match = attr.match(routeRegex)
      if (match) {
        const httpMethod = match[1].toUpperCase()
        const route = match[2]

        relationships.push({
          source: functionName,
          target: route,
          type: ASTEngine.RelationshipType.Exports,
          confidence: 1.0,
          metadata: {
            isApiEndpoint: true,
            httpMethod,
            route,
            framework: this.inferFrameworkFromRoute(attr),
          },
        })
      }
    }
  }

  private inferFrameworkFromRoute(attr: string): string {
    if (attr.includes("rocket::") || attr.includes("#[get") || attr.includes("#[post")) {
      return "rocket/actix/etc" // We can keep it generic or specific if we have more context
    }
    return "rust_web_framework"
  }

  /**
   * Extract Rust trait method signatures
   */
  private extractRustTraitMethod(node: Node, symbols: ASTEngine.UniversalSymbol[], parentTrait?: string) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode) return

    const methodName = nameNode.text
    const isAsync = this.hasRustModifier(node, "async")

    // Extract parameters
    const parameters = this.extractRustParameters(node)

    // Extract return type
    const returnType = this.extractRustReturnType(node)

    symbols.push({
      name: methodName,
      kind: ASTEngine.SymbolKind.Method,
      range: this.nodeToRange(node),
      parameters,
      returnType,
      isAsync,
      isAbstract: true, // Trait methods are abstract
      visibility: "public", // Trait methods are always public
      ownerName: parentTrait,
      ownerKind: ASTEngine.SymbolKind.Interface,
      metadata: {
        nodeType: node.type,
        isRustTraitMethod: true,
        isAsync,
        selfKind: this.getSelfKind(node),
      },
    })
  }

  /**
   * Extract Rust constants and statics
   */
  private extractRustConstants(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode) return

    const constName = nameNode.text
    const visibility = this.getRustVisibility(node)
    const isStatic = node.type === "static_item"

    symbols.push({
      name: constName,
      kind: ASTEngine.SymbolKind.Constant,
      range: this.nodeToRange(node),
      visibility,
      isStatic,
      metadata: {
        nodeType: node.type,
        isRustConstant: true,
        isStatic,
        visibility: visibility,
      },
    })
  }

  /**
   * Extract Rust type aliases
   */
  private extractRustTypeAlias(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = this.findChildByType(node, "type_identifier")
    if (!nameNode) return

    const typeName = nameNode.text
    const visibility = this.getRustVisibility(node)

    symbols.push({
      name: typeName,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      visibility,
      metadata: {
        nodeType: node.type,
        isRustTypeAlias: true,
        visibility: visibility,
        typeParameters: this.extractTypeParameters(node),
      },
    })
  }

  /**
   * Extract Rust module declarations
   */
  private extractRustModule(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode) return

    const moduleName = nameNode.text
    const visibility = this.getRustVisibility(node)

    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(node),
      visibility,
      metadata: {
        nodeType: node.type,
        isRustModule: true,
        visibility: visibility,
      },
    })
  }

  /**
   * Extract struct fields
   */
  private extractRustStructFields(structNode: Node, symbols: ASTEngine.UniversalSymbol[], structName: string) {
    const fieldList = this.findChildByType(structNode, "field_declaration_list")
    if (!fieldList) return

    for (let i = 0; i < fieldList.namedChildCount; i++) {
      const field = fieldList.namedChild(i)
      if (field?.type === "field_declaration") {
        const fieldName = this.findChildByType(field, "field_identifier")?.text
        if (fieldName) {
          const fieldVisibility = this.getRustVisibility(field)
          const fieldType = this.extractFieldType(field)

          symbols.push({
            name: fieldName,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(field),
            returnType: fieldType,
            visibility: fieldVisibility,
            ownerName: structName,
            ownerKind: ASTEngine.SymbolKind.Class,
            metadata: {
              nodeType: field.type,
              isRustStructField: true,
              fieldType,
              visibility: fieldVisibility,
            },
          })
        }
      }
    }
  }

  /**
   * Extract enum variants
   */
  private extractRustEnumVariants(enumNode: Node, symbols: ASTEngine.UniversalSymbol[], enumName: string) {
    const variantList = this.findChildByType(enumNode, "enum_variant_list")
    if (!variantList) return

    for (let i = 0; i < variantList.namedChildCount; i++) {
      const variant = variantList.namedChild(i)
      if (variant?.type === "enum_variant") {
        const variantName = this.findChildByType(variant, "identifier")?.text
        if (variantName) {
          symbols.push({
            name: variantName,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(variant),
            visibility: "public", // Enum variants are public within the enum
            ownerName: enumName,
            ownerKind: ASTEngine.SymbolKind.Enum,
            metadata: {
              nodeType: variant.type,
              isRustEnumVariant: true,
            },
          })
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

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return null
  }

  private getRustVisibility(node: Node): "public" | "private" {
    // Look for visibility_modifier child
    const visibilityNode = this.findChildByType(node, "visibility_modifier")
    return visibilityNode?.text.startsWith("pub") ? "public" : "private"
  }

  private hasRustModifier(node: Node, modifier: string): boolean {
    // Check for function_modifiers or look in text
    const modifiersNode = this.findChildByType(node, "function_modifiers")
    if (modifiersNode) {
      return modifiersNode.text.includes(modifier)
    }
    return node.text.includes(`${modifier} `)
  }

  private getImplTarget(implNode: Node): string | undefined {
    const info = this.extractRustImplFor(implNode)
    return info.type
  }

  private getImplTrait(implNode: Node): string | undefined {
    const info = this.extractRustImplFor(implNode)
    return info.trait
  }

  private extractRustAttributes(node: Node): string[] {
    const attributes: string[] = []

    // Attribute items are often siblings that appear immediately before an item.
    const prev: string[] = []
    let sibling = node.previousSibling
    while (sibling && sibling.type === "attribute_item") {
      prev.push(sibling.text)
      sibling = sibling.previousSibling
    }
    attributes.push(...prev.reverse())

    // In Tree-sitter rust, attribute_item is usually a child of the item itself (like struct_item, function_item)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "attribute_item") {
        attributes.push(child.text)
      }
    }

    // Also look for outer attributes like #![...]
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "inner_attribute_item") {
        attributes.push(child.text)
      }
    }

    return attributes
  }

  private getRustTraitName(node: Node): string | undefined {
    return this.findChildByType(node, "type_identifier")?.text
  }

  private extractTypeParameters(node: Node): string[] {
    const typeParams: string[] = []
    const typeParamsNode = this.findChildByType(node, "type_parameters")
    if (typeParamsNode) {
      for (let i = 0; i < typeParamsNode.namedChildCount; i++) {
        const param = typeParamsNode.namedChild(i)
        if (param?.type === "type_parameter") {
          const paramName = this.findChildByType(param, "type_identifier")
          if (paramName) typeParams.push(paramName.text)
        }
      }
    }
    return typeParams
  }

  private isSelfMethod(functionNode: Node): boolean {
    const params = this.findChildByType(functionNode, "parameters")
    if (!params) return false

    const firstParam = params.namedChild(0)
    if (!firstParam) return false

    // Check if first parameter is some form of self
    return firstParam.text.includes("self")
  }

  private getSelfKind(functionNode: Node): string | undefined {
    const params = this.findChildByType(functionNode, "parameters")
    if (!params) return undefined

    const firstParam = params.namedChild(0)
    if (!firstParam) return undefined

    const paramText = firstParam.text.trim()
    if (paramText.includes("&mut self")) return "&mut self"
    if (paramText.includes("&self")) return "&self"
    if (paramText === "self") return "self"

    return undefined
  }

  private extractRustParameters(node: Node): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []
    const paramsNode = this.findChildByType(node, "parameters")
    if (!paramsNode) return parameters

    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const param = paramsNode.namedChild(i)
      if (param?.type === "parameter") {
        const nameNode = this.findChildByType(param, "identifier")
        if (nameNode && nameNode.text !== "self") {
          const paramType = this.extractParameterType(param)
          parameters.push({
            name: nameNode.text,
            type: paramType,
            isOptional: false, // Rust doesn't have optional parameters
          })
        }
      }
    }

    return parameters
  }

  private extractParameterType(paramNode: Node): string | undefined {
    // Look for type after the colon
    for (let i = 0; i < paramNode.namedChildCount; i++) {
      const child = paramNode.namedChild(i)
      if (child && child.type !== "identifier" && child.type !== "mutable_specifier") {
        return child.text
      }
    }
    return undefined
  }

  private extractRustReturnType(node: Node): string | undefined {
    const ret = node.childForFieldName("return_type")
    if (ret) return ret.text

    // Look for return type after ->
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        ["type_identifier", "generic_type", "reference_type", "primitive_type", "abstract_type"].includes(child.type)
      ) {
        return child.text
      }
    }
    return undefined
  }

  private extractFieldType(fieldNode: Node): string | undefined {
    // Find the type after the field name
    for (let i = 0; i < fieldNode.namedChildCount; i++) {
      const child = fieldNode.namedChild(i)
      if (child && child.type !== "field_identifier" && child.type !== "visibility_modifier") {
        return child.text
      }
    }
    return undefined
  }

  private findRustFunctionCalls(functionNode: Node): string[] {
    const calls: string[] = []

    const traverse = (node: Node) => {
      if (node.type === "call_expression") {
        const funcNode = node.childForFieldName("function")
        if (funcNode) {
          const callExpression = this.buildRustCallExpression(funcNode)
          if (callExpression && !this.isRustBuiltin(callExpression)) {
            calls.push(callExpression)
          }
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    const bodyNode = this.findChildByType(functionNode, "block")
    if (bodyNode) {
      traverse(bodyNode)
    }

    return calls
  }

  private buildRustCallExpression(funcNode: Node): string {
    switch (funcNode.type) {
      case "identifier":
        return funcNode.text

      case "scoped_identifier":
        return funcNode.text

      case "field_expression":
        return this.buildRustFieldExpression(funcNode)

      default:
        return funcNode.text
    }
  }

  private buildRustFieldExpression(node: Node): string {
    // Build method call like obj.method()
    const object = node.childForFieldName("value")
    const field = node.childForFieldName("field")

    if (!object || !field) return node.text

    return `${object.text}.${field.text}`
  }

  private isRustBuiltin(call: string): boolean {
    const builtins = [
      "println!",
      "print!",
      "dbg!",
      "panic!",
      "assert!",
      "assert_eq!",
      "vec!",
      "format!",
      "write!",
      "writeln!",
    ]
    return builtins.includes(call)
  }

  // Framework detection
  private detectRustFrameworks(content: string): string[] {
    const frameworks = new Set<string>()

    // Async runtime
    if (content.includes("tokio") || content.includes("#[tokio::main]")) frameworks.add("tokio")
    if (content.includes("async-std")) frameworks.add("async_std")

    // Web frameworks
    if (content.includes("actix") || content.includes("actix-web") || content.includes("actix_web")) frameworks.add("actix_web")
    if (content.includes("axum")) frameworks.add("axum")
    if (content.includes("warp")) frameworks.add("warp")
    if (content.includes("rocket")) frameworks.add("rocket")

    // Serialization
    if (content.includes("serde")) frameworks.add("serde")

    // Testing
    if (content.includes("#[test]") || content.includes("assert_eq!")) frameworks.add("testing")

    // CLI
    if (content.includes("clap")) frameworks.add("clap")

    // ORM & Database
    if (content.includes("diesel")) frameworks.add("diesel")
    if (content.includes("sqlx")) frameworks.add("sqlx")
    if (content.includes("sea-orm") || content.includes("sea_orm")) frameworks.add("seaorm")

    // FFI
    if (content.includes('extern "C"')) frameworks.add("ffi")

    return Array.from(frameworks)
  }

  private detectRustPatterns(content: string, symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (content.includes("async ") || content.includes(".await")) patterns.push("async_await")
    if (content.includes("Option<") || content.includes("Some(") || content.includes("None"))
      patterns.push("option_type")
    if (content.includes("Result<") || content.includes("Ok(") || content.includes("Err(")) patterns.push("result_type")
    if (content.includes("match ")) patterns.push("pattern_matching")
    if (content.includes("impl ")) patterns.push("trait_implementation")
    if (content.includes("#[derive(")) patterns.push("derive_macros")
    if (symbols.some((s) => s.metadata?.isRustTrait)) patterns.push("traits")
    if (symbols.some((s) => s.metadata?.isRustEnum)) patterns.push("enums")
    if (content.includes("Box<") || content.includes("Rc<") || content.includes("Arc<")) patterns.push("smart_pointers")

    return patterns
  }

  /**
   * Rust Relationship Analysis
   * Analyzes Rust-specific relationships: traits, impls, modules, ownership
   */
  private analyzeRustRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    // 1. Analyze trait implementation relationships
    this.analyzeRustTraitImplementations(rootNode, relationships, symbols)

    // 2. Analyze module relationships
    this.analyzeRustModuleRelationships(rootNode, relationships, symbols)

    // 3. Analyze struct field relationships
    this.analyzeRustStructRelationships(rootNode, relationships, symbols)

    // 4. Analyze function call relationships
    this.analyzeRustFunctionCalls(rootNode, relationships, symbols)

    // 5. Analyze ownership and borrowing patterns
    this.analyzeRustOwnershipRelationships(rootNode, relationships, symbols)
  }

  /**
   * Rust Trait Implementation Analysis
   */
  private analyzeRustTraitImplementations(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const traverse = (node: Node) => {
      if (node.type === "impl_item") {
        // Extract impl Trait for Type relationships
        const implFor = this.extractRustImplFor(node)
        if (implFor.trait && implFor.type) {
          relationships.push({
            source: implFor.type,
            target: implFor.trait,
            type: ASTEngine.RelationshipType.Implementation,
            confidence: 1.0,
            metadata: {
              relationshipType: "rust_trait_impl",
              isRustImplementation: true,
              implType: "trait_for_type",
            },
          })
        }

        // Extract inherent impl (impl Type) relationships
        if (!implFor.trait && implFor.type) {
          const methods = this.extractRustImplMethods(node)
          methods.forEach((methodName) => {
            relationships.push({
              source: implFor.type,
              target: methodName,
              type: ASTEngine.RelationshipType.Contains,
              confidence: 1.0,
              metadata: {
                relationshipType: "rust_inherent_impl",
                isRustImplementation: true,
                implType: "inherent",
              },
            })
          })
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
  }

  /**
   * Rust Module Relationship Analysis
   */
  private analyzeRustModuleRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const traverse = (node: Node) => {
      if (node.type === "mod_item") {
        const moduleName = this.getRustModuleName(node)
        if (moduleName) {
          // Find items defined in this module
          const moduleItems = this.extractRustModuleItems(node)
          moduleItems.forEach((itemName) => {
            relationships.push({
              source: moduleName,
              target: itemName,
              type: ASTEngine.RelationshipType.Contains,
              confidence: 1.0,
              metadata: {
                relationshipType: "rust_module_contains",
                isRustModule: true,
              },
            })
          })
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
  }

  /**
   * Rust Struct Relationship Analysis
   */
  private analyzeRustStructRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const traverse = (node: Node) => {
      if (node.type === "struct_item") {
        const structName = this.getRustStructName(node)
        if (structName) {
          const fields = this.extractRustStructFieldList(node)
          fields.forEach((field) => {
            if (field.type) {
              relationships.push({
                source: structName,
                target: field.type,
                type: ASTEngine.RelationshipType.Composition,
                confidence: 0.9,
                metadata: {
                  relationshipType: "rust_struct_field",
                  fieldName: field.name,
                  fieldType: field.type,
                  isRustComposition: true,
                },
              })
            }
          })
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
  }

  /**
   * Rust Function Call Analysis
   */
  private analyzeRustFunctionCalls(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const functions = symbols.filter(
      (s) => s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method,
    )

    functions.forEach((func) => {
      const calls = func.qualified_calls || []
      calls.forEach((call) => {
        const targetFunction = this.resolveRustCallTarget(func, call, functions)

        if (targetFunction && targetFunction !== func) {
          const source = this.getRustQualifiedSymbolName(func)
          const target = this.getRustQualifiedSymbolName(targetFunction)
          relationships.push({
            source,
            target,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.8,
            metadata: {
              relationshipType: "rust_function_call",
              callExpression: call,
              isRustCall: true,
            },
          })
        }
      })
    })
  }

  /**
   * Rust Ownership Analysis
   */
  private analyzeRustOwnershipRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const traverse = (node: Node) => {
      // Analyze ownership patterns in function parameters
      if (node.type === "function_item") {
        const funcName = this.getRustFunctionName(node)
        const sym = symbols.find(
          (s) =>
            (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
            s.name === funcName &&
            s.range.startLine === node.startPosition.row + 1 &&
            s.range.startColumn === node.startPosition.column + 1,
        )
        const source = sym ? this.getRustQualifiedSymbolName(sym) : funcName || "anonymous_function"
        const ownershipPatterns = this.analyzeRustOwnershipInFunction(node)

        ownershipPatterns.forEach((pattern) => {
          if (pattern.type === "borrow" && pattern.targetType) {
            relationships.push({
              source,
              target: pattern.targetType,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.7,
              metadata: {
                relationshipType: "rust_borrow",
                borrowType: pattern.borrowType, // "immutable" | "mutable"
                isRustOwnership: true,
              },
            })
          }
        })
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
  }

  /**
   * Rust Import Processing
   * Handles Rust use statements, crate imports, and module system
   */
  private processRustImports(rootNode: Node, imports: ASTEngine.ImportInfo[]) {
    const traverse = (node: Node) => {
      if (node.type === "use_declaration") {
        this.extractRustUseStatement(node, imports)
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
  }

  /**
   * Extract Rust use statement with proper crate and module handling
   */
  private extractRustUseStatement(node: Node, imports: ASTEngine.ImportInfo[]) {
    const useTree = node.childForFieldName("argument")
    if (useTree) {
      const importPath = this.extractRustUsePath(useTree)
      const isExternal = this.isExternalCrate(importPath)
      const crateName = this.getRustCrateName(importPath)

      imports.push({
        module: importPath,
        isDefault: false,
        isNamespace: importPath.includes("::*"),
        items: this.extractRustImportedNames(useTree),
        metadata: {
          isRustImport: true,
          crateName,
          isExternal,
          isStandardLibrary: this.isRustStandardLibrary(importPath),
          framework: this.detectFrameworkFromRustImport(importPath),
        },
      })
    }
  }

  /**
   * Rust Framework Pattern Analysis
   * Detects Actix Web, Warp, Rocket, Axum, Tonic, Diesel, Serde patterns
   */
  private getRustFrameworkPatterns(frameworks: string[], symbols: ASTEngine.UniversalSymbol[]): any[] {
    const patterns: any[] = []

    for (const framework of frameworks) {
      switch (framework) {
        case "actix_web":
          patterns.push({
            framework: "Actix Web",
            type: "web_framework",
            patterns: this.detectActixWebPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: symbols.some((s) => s.decorators?.some((d) => d.includes("#[get]") || d.includes("#[post]"))),
              hasHandlers: symbols.some((s) => s.parameters?.some((p) => p.type?.includes("HttpRequest"))),
              hasMiddleware: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("middleware"))),
              hasActorSystem: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("Actor"))),
            },
          })
          break

        case "warp":
          patterns.push({
            framework: "Warp",
            type: "web_framework",
            patterns: this.detectWarpPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasFilters: symbols.some((s) =>
                s.qualified_calls?.some((c) => c.includes("Filter") || c.includes("warp::")),
              ),
              hasCombinable: symbols.some((s) =>
                s.qualified_calls?.some((c) => c.includes(".and(") || c.includes(".or(")),
              ),
              hasAsyncHandlers: symbols.some((s) => s.isAsync && s.qualified_calls?.some((c) => c.includes("Reply"))),
            },
          })
          break

        case "rocket":
          patterns.push({
            framework: "Rocket",
            type: "web_framework",
            patterns: this.detectRocketPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: symbols.some((s) => s.decorators?.some((d) => d.includes("#[rocket::"))),
              hasGuards: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("FromRequest"))),
              hasResponders: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("Responder"))),
            },
          })
          break

        case "axum":
          patterns.push({
            framework: "Axum",
            type: "web_framework",
            patterns: this.detectAxumPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRouters: symbols.some((s) =>
                s.qualified_calls?.some((c) => c.includes("Router") || c.includes("axum::")),
              ),
              hasExtractors: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("extract::"))),
              hasLayers: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("layer("))),
            },
          })
          break

        case "diesel":
          patterns.push({
            framework: "Diesel ORM",
            type: "orm",
            patterns: this.detectDieselPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasSchema: symbols.some((s) =>
                s.qualified_calls?.some((c) => c.includes("diesel::") || c.includes("schema")),
              ),
              hasQueryable: symbols.some((s) => s.decorators?.some((d) => d.includes("#[derive(Queryable)"))),
              hasMigrations: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("migration"))),
            },
          })
          break

        case "serde":
          patterns.push({
            framework: "Serde",
            type: "serialization",
            patterns: this.detectSerdePatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasSerialize: symbols.some((s) => s.decorators?.some((d) => d.includes("#[derive(Serialize"))),
              hasDeserialize: symbols.some((s) => s.decorators?.some((d) => d.includes("#[derive(Deserialize"))),
              hasCustomSerde: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("serde::"))),
            },
          })
          break

        case "tonic":
          patterns.push({
            framework: "Tonic gRPC",
            type: "rpc_framework",
            patterns: this.detectTonicPatterns(symbols),
            confidence: 0.8,
            characteristics: {
              hasServices: symbols.some((s) =>
                s.qualified_calls?.some((c) => c.includes("tonic::") || c.includes("Service")),
              ),
              hasProto: symbols.some((s) => s.qualified_calls?.some((c) => c.includes("prost") || c.includes("proto"))),
            },
          })
          break
      }
    }

    return patterns
  }

  /**
   * Rust Architectural Insights
   * Deep analysis of Rust ownership, lifetimes, memory safety, and performance
   */
  private generateRustArchitecturalInsights(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): any[] {
    const insights: any[] = []

    // Analyze ownership patterns
    const borrowingFunctions = symbols.filter((s) =>
      s.parameters?.some((p) => p.type?.includes("&") || p.type?.includes("&mut")),
    )
    if (borrowingFunctions.length > 0) {
      insights.push({
        type: "memory_safety",
        category: "borrowing_patterns",
        message: `Borrowing patterns detected in ${borrowingFunctions.length} functions`,
        functions: borrowingFunctions.map((f) => f.name),
        recommendation: "Good use of Rust's ownership system for memory safety",
      })
    }

    // Analyze Option and Result usage
    const optionUsage = symbols.filter(
      (s) => s.returnType?.includes("Option<") || s.qualified_calls?.some((c) => c.includes("Option::")),
    )
    const resultUsage = symbols.filter(
      (s) => s.returnType?.includes("Result<") || s.qualified_calls?.some((c) => c.includes("Result::")),
    )

    if (optionUsage.length > 0 || resultUsage.length > 0) {
      insights.push({
        type: "error_handling",
        category: "rust_types",
        message: `Rust error handling: ${optionUsage.length} Option types, ${resultUsage.length} Result types`,
        recommendation: "Excellent use of Rust's type system for null safety and error handling",
      })
    }

    // Analyze unsafe code usage
    const unsafeFunctions = symbols.filter(
      (s) => s.qualified_calls?.some((c) => c.includes("unsafe")) || s.metadata?.isUnsafe,
    )
    if (unsafeFunctions.length > 0) {
      insights.push({
        type: "safety_analysis",
        category: "unsafe_code",
        message: `Unsafe code detected in ${unsafeFunctions.length} functions`,
        functions: unsafeFunctions.map((f) => f.name),
        recommendation: "Review unsafe code blocks for correctness and necessity",
        severity: "warning",
      })
    }

    // Analyze trait usage and generics
    const traits = symbols.filter((s) => s.kind === ASTEngine.SymbolKind.Interface && s.metadata?.isRustTrait)
    const genericFunctions = symbols.filter(
      (s) => s.parameters?.some((p) => p.type?.includes("<T>") || p.type?.includes("<")) || s.returnType?.includes("<"),
    )

    if (traits.length > 0 || genericFunctions.length > 0) {
      insights.push({
        type: "abstraction_pattern",
        category: "traits_generics",
        message: `Abstraction patterns: ${traits.length} traits, ${genericFunctions.length} generic functions`,
        recommendation: "Good use of Rust's zero-cost abstraction features",
      })
    }

    // Analyze async/await patterns
    const asyncFunctions = symbols.filter((s) => s.isAsync)
    if (asyncFunctions.length > 0) {
      insights.push({
        type: "concurrency_pattern",
        category: "async_rust",
        message: `Async Rust patterns detected in ${asyncFunctions.length} functions`,
        functions: asyncFunctions.map((f) => f.name),
        recommendation: "Ensure proper async runtime management and avoid blocking operations",
      })
    }

    // Analyze macro usage
    const macroUsage = symbols.filter((s) => s.qualified_calls?.some((c) => c.includes("!") && !c.includes("!=")))
    if (macroUsage.length > 0) {
      insights.push({
        type: "metaprogramming",
        category: "macros",
        message: `Macro usage detected in ${macroUsage.length} locations`,
        recommendation: "Good use of Rust's powerful macro system for code generation",
      })
    }

    // Analyze derive patterns
    const deriveUsage = symbols.filter((s) => s.decorators?.some((d) => d.includes("#[derive(")))
    if (deriveUsage.length > 0) {
      insights.push({
        type: "code_generation",
        category: "derive_macros",
        message: `Derive macros used on ${deriveUsage.length} types`,
        types: deriveUsage.map((d) => d.name),
        recommendation: "Excellent use of derive macros for boilerplate reduction",
      })
    }

    return insights
  }

  // ======================== RUST FRAMEWORK DETECTION METHODS ========================

  private detectActixWebPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []
    const route = /#\[\s*(?:actix_web::)?(get|post|put|delete|patch|head|options)\s*\(/i

    if (symbols.some((s) => s.decorators?.some((d) => route.test(d)))) {
      patterns.push("route_handlers")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("HttpServer") || c.includes("App::")))) {
      patterns.push("web_server")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("middleware")))) {
      patterns.push("middleware_stack")
    }

    return patterns
  }

  private detectWarpPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("warp::") || c.includes("Filter")))) {
      patterns.push("filter_combinators")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes(".and(") || c.includes(".or(")))) {
      patterns.push("composable_filters")
    }

    return patterns
  }

  private detectRocketPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (symbols.some((s) => s.decorators?.some((d) => d.includes("#[rocket::")))) {
      patterns.push("rocket_routes")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("launch()") || c.includes("rocket::")))) {
      patterns.push("rocket_app")
    }

    return patterns
  }

  private detectAxumPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("Router::") || c.includes("axum::")))) {
      patterns.push("axum_routing")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("extract::")))) {
      patterns.push("request_extraction")
    }

    return patterns
  }

  private detectDieselPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (symbols.some((s) => s.decorators?.some((d) => d.includes("#[derive(Queryable")))) {
      patterns.push("orm_models")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("diesel::") || c.includes("schema")))) {
      patterns.push("diesel_queries")
    }

    return patterns
  }

  private detectSerdePatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (
      symbols.some((s) =>
        s.decorators?.some((d) => d.includes("#[derive(Serialize") || d.includes("#[derive(Deserialize")),
      )
    ) {
      patterns.push("serialization")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("serde_json") || c.includes("to_string")))) {
      patterns.push("json_handling")
    }

    return patterns
  }

  private detectTonicPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("tonic::") || c.includes("Service")))) {
      patterns.push("grpc_services")
    }
    if (symbols.some((s) => s.qualified_calls?.some((c) => c.includes("prost") || c.includes("proto")))) {
      patterns.push("protobuf_messages")
    }

    return patterns
  }

  // ======================== RUST HELPER METHODS ========================

  private extractRustUsePath(useTree: Node): string {
    return useTree.text.replace(/^use\s+/, "").replace(/;$/, "")
  }

  private extractRustImportedNames(useTree: Node): string[] {
    const path = useTree.text

    // Handle use foo::{bar, baz}
    const braceMatch = path.match(/\{([^}]+)\}/)
    if (braceMatch) {
      return braceMatch[1]
        .split(",")
        .map((s) => s.trim())
        .map((s) => s.replace(/^self$/, "").trim())
        .filter((s) => s.length > 0)
        .map((s) => {
          const alias = s.split(" as ")
          return alias[alias.length - 1].trim()
        })
    }

    if (path.endsWith("::*")) {
      return []
    }

    // Handle use foo::bar::baz
    if (path.includes("::")) {
      const parts = path.split("::")
      return [parts[parts.length - 1].replace(/[{};]/g, "")]
    }

    return [path.replace(/^use\s+/, "").replace(/;$/, "")]
  }

  private getRustCrateName(importPath: string): string {
    const parts = importPath.split("::")
    return parts[0]
  }

  private isExternalCrate(importPath: string): boolean {
    const stdCrates = ["std", "core", "alloc", "proc_macro"]
    const crateName = this.getRustCrateName(importPath)
    return !stdCrates.includes(crateName) && !importPath.startsWith("crate::")
  }

  private isRustStandardLibrary(importPath: string): boolean {
    const stdPrefixes = ["std::", "core::", "alloc::", "proc_macro::"]
    return stdPrefixes.some((prefix) => importPath.startsWith(prefix))
  }

  private detectFrameworkFromRustImport(importPath: string): string | undefined {
    if (importPath.includes("actix_web")) return "actix_web"
    if (importPath.includes("warp")) return "warp"
    if (importPath.includes("rocket")) return "rocket"
    if (importPath.includes("axum")) return "axum"
    if (importPath.includes("diesel")) return "diesel"
    if (importPath.includes("serde")) return "serde"
    if (importPath.includes("tonic")) return "tonic"
    if (importPath.includes("tokio")) return "tokio"

    return undefined
  }

  private calculateArchitecturalScore(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): number {
    let score = 85 // Base score

    // Reward Rust-specific good practices
    if (patterns.includes("option_type")) score += 5
    if (patterns.includes("result_type")) score += 5
    if (patterns.includes("traits")) score += 5
    if (patterns.includes("derive_macros")) score += 3

    return Math.min(100, score)
  }

  private assessCodeQuality(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): string {
    const score = this.calculateArchitecturalScore(symbols, relationships, patterns)
    if (score >= 90) return "excellent"
    if (score >= 75) return "good"
    if (score >= 60) return "fair"
    return "needs_improvement"
  }

  private calculateRustComplexity(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): number {
    return symbols.length + relationships.length * 0.5
  }

  /**
   * Rust Cyclomatic Complexity Calculation
   * Calculates complexity for Rust code including pattern matching and error handling
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1 // Base complexity
    const text = node.text

    // Control flow structures
    complexity += (text.match(/\bif\b/g) || []).length
    complexity += (text.match(/\belse\s+if\b/g) || []).length
    complexity += (text.match(/\belse\b/g) || []).length
    complexity += (text.match(/\bwhile\b/g) || []).length
    complexity += (text.match(/\bfor\b/g) || []).length
    complexity += (text.match(/\bloop\b/g) || []).length

    // Pattern matching (Rust-specific)
    complexity += (text.match(/\bmatch\b/g) || []).length
    const matchArms = text.match(/=>\s*{|=>\s*[^,\n]+/g) || []
    complexity += matchArms.length

    // Error handling patterns
    complexity += (text.match(/\?/g) || []).length * 0.5 // ? operator adds some complexity
    complexity += (text.match(/\.unwrap\(\)/g) || []).length
    complexity += (text.match(/\.expect\(/g) || []).length

    // Logical operators
    complexity += (text.match(/&&/g) || []).length
    complexity += (text.match(/\|\|/g) || []).length

    // Rust-specific control flow
    complexity += (text.match(/\bbreak\b/g) || []).length * 0.5
    complexity += (text.match(/\bcontinue\b/g) || []).length * 0.5
    complexity += (text.match(/\breturn\b/g) || []).length * 0.5

    // Closure complexity
    complexity += (text.match(/\|[^|]*\|/g) || []).length * 0.3

    // Async/await complexity
    complexity += (text.match(/\bawait\b/g) || []).length * 0.5
    complexity += (text.match(/async\s+fn/g) || []).length * 0.5

    // Macro complexity
    complexity += (text.match(/\w+!/g) || []).length * 0.2

    return Math.round(complexity)
  }

  // ======================== RUST RELATIONSHIP HELPER METHODS ========================

  /**
   * Extract impl Trait for Type information
   */
  private extractRustImplFor(node: Node): { trait?: string; type?: string } {
    const traitNode = node.childForFieldName("trait")
    const typeNode = node.childForFieldName("type")
    if (typeNode) {
      return {
        trait: traitNode?.text,
        type: typeNode.text,
      }
    }

    const text = node.text

    // Match impl<...> Trait for Type where ... { ... }
    const traitForTypeMatch = text.match(
      /impl\s+(?:<[^>]+>\s*)?([^\s{]+)\s+for\s+([^\s{]+)(?:\s+where\s+[^{]+)?\s*\{/,
    )
    if (traitForTypeMatch) {
      return {
        trait: traitForTypeMatch[1].trim(),
        type: traitForTypeMatch[2].trim(),
      }
    }

    // Match impl<...> Type where ... { ... }
    const inherentMatch = text.match(/impl\s+(?:<[^>]+>\s*)?([^\s{]+)(?:\s+where\s+[^{]+)?\s*\{/) 
    if (inherentMatch) {
      return {
        type: inherentMatch[1].trim(),
      }
    }

    return {}
  }

  /**
   * Extract method names from impl block
   */
  private extractRustImplMethods(node: Node): string[] {
    const methods: string[] = []
    const text = node.text

    // Extract function definitions within impl
    const functionMatches = text.match(/fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)
    if (functionMatches) {
      functionMatches.forEach((match) => {
        const funcMatch = match.match(/fn\s+([A-Za-z_][A-Za-z0-9_]*)/)
        if (funcMatch) {
          methods.push(funcMatch[1])
        }
      })
    }

    return methods
  }

  private getRustQualifiedSymbolName(symbol: ASTEngine.UniversalSymbol): string {
    return symbol.ownerName ? `${symbol.ownerName}.${symbol.name}` : symbol.name
  }

  private resolveRustCallTarget(
    source: ASTEngine.UniversalSymbol,
    call: string,
    funcs: ASTEngine.UniversalSymbol[],
  ): ASTEngine.UniversalSymbol | undefined {
    if (call.startsWith("self.") && source.ownerName) {
      const name = call.split(".").at(-1)
      return funcs.find((f) => f.ownerName === source.ownerName && f.name === name)
    }

    if (call.startsWith("Self::") && source.ownerName) {
      const name = call.split("::").at(-1)
      return funcs.find((f) => f.ownerName === source.ownerName && f.name === name)
    }

    if (call.includes("::")) {
      const parts = call.split("::")
      const name = parts.at(-1)
      const owner = parts.length > 1 ? parts[parts.length - 2] : undefined
      const hits = funcs.filter((f) => f.name === name)
      if (owner) {
        const hit = hits.find((f) => f.ownerName === owner)
        if (hit) return hit
      }
      if (hits.length === 1) return hits[0]
      if (source.ownerName) return hits.find((f) => f.ownerName === source.ownerName)
      return undefined
    }

    if (call.includes(".")) {
      const name = call.split(".").at(-1)
      const hits = funcs.filter((f) => f.name === name)
      if (hits.length === 1) return hits[0]
      if (source.ownerName) return hits.find((f) => f.ownerName === source.ownerName)
      return undefined
    }

    const hits = funcs.filter((f) => f.name === call)
    if (hits.length === 1) return hits[0]
    if (source.ownerName) return hits.find((f) => f.ownerName === source.ownerName)
    return undefined
  }

  /**
   * Get module name from mod declaration
   */
  private getRustModuleName(node: Node): string | null {
    const nameNode = node.childForFieldName("name")
    return nameNode ? nameNode.text : null
  }

  /**
   * Extract items defined in a module
   */
  private extractRustModuleItems(node: Node): string[] {
    const items: string[] = []
    const text = node.text

    // Extract various item types
    const patterns = [
      /fn\s+([A-Za-z_][A-Za-z0-9_]*)/g, // functions
      /struct\s+([A-Za-z_][A-Za-z0-9_]*)/g, // structs
      /enum\s+([A-Za-z_][A-Za-z0-9_]*)/g, // enums
      /trait\s+([A-Za-z_][A-Za-z0-9_]*)/g, // traits
      /type\s+([A-Za-z_][A-Za-z0-9_]*)/g, // type aliases
      /const\s+([A-Za-z_][A-Za-z0-9_]*)/g, // constants
      /static\s+([A-Za-z_][A-Za-z0-9_]*)/g, // statics
    ]

    patterns.forEach((pattern) => {
      let match
      while ((match = pattern.exec(text)) !== null) {
        items.push(match[1])
      }
    })

    return [...new Set(items)] // Remove duplicates
  }

  /**
   * Get struct name from struct declaration
   */
  private getRustStructName(node: Node): string | null {
    const nameNode = node.childForFieldName("name")
    return nameNode ? nameNode.text : null
  }

  /**
   * Extract struct fields with types
   */
  private extractRustStructFieldList(node: Node): Array<{ name: string; type?: string }> {
    const fields: Array<{ name: string; type?: string }> = []

    // Traverse the struct to find field declarations
    const traverse = (n: Node) => {
      if (n.type === "field_declaration") {
        const fieldName = n.childForFieldName("name")?.text
        const fieldType = n.childForFieldName("type")?.text

        if (fieldName) {
          fields.push({
            name: fieldName,
            type: fieldType,
          })
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(node)
    return fields
  }

  /**
   * Get function name from function declaration
   */
  private getRustFunctionName(node: Node): string | null {
    const nameNode = node.childForFieldName("name")
    return nameNode ? nameNode.text : null
  }

  /**
   * Analyze ownership patterns in function
   */
  private analyzeRustOwnershipInFunction(node: Node): Array<{
    type: "borrow" | "move" | "reference"
    borrowType?: "immutable" | "mutable"
    targetType?: string
  }> {
    const patterns: Array<{
      type: "borrow" | "move" | "reference"
      borrowType?: "immutable" | "mutable"
      targetType?: string
    }> = []

    const text = node.text

    // Analyze parameter ownership patterns
    const parameterMatches = text.match(/\([^)]*\)/g)
    if (parameterMatches) {
      parameterMatches.forEach((paramText) => {
        // Immutable borrow: &Type
        const immutableBorrows = paramText.match(/&([A-Za-z_][A-Za-z0-9_::<>]*)/g)
        if (immutableBorrows) {
          immutableBorrows.forEach((borrow) => {
            const typeMatch = borrow.match(/&([A-Za-z_][A-Za-z0-9_::<>]*)/)
            if (typeMatch) {
              patterns.push({
                type: "borrow",
                borrowType: "immutable",
                targetType: typeMatch[1],
              })
            }
          })
        }

        // Mutable borrow: &mut Type
        const mutableBorrows = paramText.match(/&mut\s+([A-Za-z_][A-Za-z0-9_::<>]*)/g)
        if (mutableBorrows) {
          mutableBorrows.forEach((borrow) => {
            const typeMatch = borrow.match(/&mut\s+([A-Za-z_][A-Za-z0-9_::<>]*)/)
            if (typeMatch) {
              patterns.push({
                type: "borrow",
                borrowType: "mutable",
                targetType: typeMatch[1],
              })
            }
          })
        }
      })
    }

    return patterns
  }
}
