// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
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

// Real Kotlin Intelligence Engine
// AST analysis for Kotlin with Android, Spring Boot, Ktor intelligence

import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export interface KotlinContext {
  content: string
  currentFile: string
  packageStack: string[]
  classStack: string[]
  importAliases: Map<string, string>
  annotations: Map<string, string[]>
}

export class RealKotlinAnalyzer implements LanguageAnalyzer {
  private findChildByType(node: Node, types: string[]): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) {
        for (let j = 0; j < types.length; j++) {
          if (types[j] === c.type) return c
        }
      }
    }
    return null
  }

  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const ctx: KotlinContext = {
      content,
      currentFile: filePath,
      packageStack: [],
      classStack: [],
      importAliases: new Map(),
      annotations: new Map(),
    }

    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

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

    // PHASE 1: Extract all symbols with proper Kotlin scoping
    this.extractSymbolsWithScoping(rootNode, ctx, symbols, content)

    // PHASE 2: Analyze Kotlin relationships (inheritance, data classes, sealed classes)
    this.analyzeRelationships(rootNode, relationships, symbols)

    // PHASE 3: Process import statements
    this.processImportsExports(rootNode, imports, exports)

    // Fallback text extraction for parser variations that omit field names
    // PHASE 4: Detect Kotlin frameworks (Android, Spring Boot, Ktor, etc.)
    const frameworks = this.detectKotlinFrameworks(content, symbols, imports)
    const patterns = this.detectKotlinPatterns(symbols, relationships, content)

    // ========================================================================
    // STAGE 3: PHANTOM SYMBOL INJECTION (Framework Heuristics)
    // ========================================================================
    this.injectPhantomSymbols(rootNode, symbols, frameworks, ctx)

    // PHASE 5: Kotlin-specific analysis (nullability, coroutines, etc.)
    const typeInference = this.performKotlinTypeInference(symbols, relationships)

    // --- KOTLIN CALL GRAPH EXTRACTION ---
    // Walks the full AST and extracts caller→callee relationships
    // using tree-sitter Kotlin node types: call_expression, invocation_expression, method_invocation
    try {
      const extractKotlinCalls = (n: Node) => {
        if (n.type === 'call_expression' || n.type === 'invocation_expression' || n.type === 'method_invocation') {
          let targetName: string | null = null;
          if (n.childForFieldName) {
             const fnNode = n.childForFieldName('function') || n.childForFieldName('name') || n.childForFieldName('method');
             if (fnNode) targetName = fnNode.text;
          }
          if (!targetName && n.namedChildCount > 0) {
             for (let i=0; i<n.namedChildCount; i++) {
                const c = n.namedChild(i);
                if (c && (c.type === 'identifier' || c.type === 'simple_identifier')) {
                   targetName = c.text;
                   break;
                }
             }
          }
          if (targetName && targetName !== "print" && targetName !== "println") {
            let p: Node | null = n.parent;
            let sourceName = "Global";
            while (p) {
               if (p.type === 'function_declaration' || p.type === 'method_declaration') {
                  const nameNode = p.childForFieldName('name');
                  if (nameNode) {
                      sourceName = nameNode.text;
                  } else {
                      for (let i=0; i<p.namedChildCount; i++) {
                          const c = p.namedChild(i);
                          if (c && (c.type === 'identifier' || c.type === 'simple_identifier')) {
                              sourceName = c.text;
                              break;
                          }
                      }
                  }
                  break;
               }
               p = p.parent;
            }
            relationships.push({
              source: sourceName,
              target: targetName,
              type: RelationshipType.Calls,
              metadata: { kotlinSpecific: true }
            });
            // Kotlin constructor calls share call_expression — PascalCase targets are likely instantiations
            if (targetName && targetName[0] === targetName[0].toUpperCase() && targetName[0] !== targetName[0].toLowerCase()) {
              relationships.push({
                source: sourceName,
                target: targetName,
                type: RelationshipType.Instantiates,
                confidence: 0.7,
                metadata: { kotlinSpecific: true, isInstantiation: true },
              })
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i);
          if (child) extractKotlinCalls(child);
        }
      };
      extractKotlinCalls(rootNode);
    } catch (e) {
      // Graceful degradation
    }
    // --- END KOTLIN CALL GRAPH EXTRACTION ---

    // Add Contains + Overrides + DependsOn
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: { isContained: true },
        })
      }
      // Overrides: methods with 'override' modifier
      if (s.kind === SymbolKind.Method && s.metadata?.modifiers?.includes?.("override")) {
        relationships.push({
          source: s.ownerName || "root",
          target: s.name,
          type: RelationshipType.Overrides,
          confidence: 0.9,
          metadata: { isOverride: true },
        })
      }
    }
    for (const imp of imports) {
      relationships.push({
        source: "root",
        target: imp.module || "",
        type: RelationshipType.References,
        confidence: 0.9,
        metadata: { isImportDep: true },
      })
    }

    for (let i = 0; i < symbols.length; i++) { const s = symbols[i]; if (!s.metadata?.isPhantom && s.visibility !== "private" && (!s.ownerName || s.ownerKind === SymbolKind.Class)) { exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" }); } }
    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: this.calculateRealComplexity(symbols, relationships),
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: this.calculateCyclomaticComplexity(rootNode),
        framework: frameworks[0], // Primary framework
        patterns,

        // Kotlin intelligence metadata
        detectedFrameworks: frameworks,
        frameworkPatterns: this.getKotlinFrameworkPatterns(frameworks, symbols),
        architecturalInsights: this.generateArchitecturalInsights(symbols, relationships),
        architecturalScore: this.calculateArchitecturalScore(symbols, relationships, patterns),
        codeQuality: this.assessKotlinCodeQuality(symbols, relationships, patterns),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.0-infallible-brain",
      },
    }
  }

  /**
   * PHASE 1: Real Kotlin Symbol Extraction with Scoping
   * Understands Kotlin semantics: classes, data classes, sealed classes, objects, functions
   */
  private injectPhantomSymbols(
    rootNode: Node,
    symbols: UniversalSymbol[],
    frameworks: string[],
    ctx: KotlinContext,
  ): void {
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      let hasData = false;
      if (symbol.modifiers) {
        for (let j = 0; j < symbol.modifiers.length; j++) {
          if (symbol.modifiers[j] === "data") { hasData = true; break; }
        }
      }
      if (symbol.kind === SymbolKind.Class && hasData) {
        const properties: UniversalSymbol[] = []
        for (let j = 0; j < symbols.length; j++) {
           const s = symbols[j]
           if (s.scope === symbol.name && s.kind === SymbolKind.Property) properties.push(s)
        }

        for (let index = 0; index < properties.length; index++) {
          const prop = properties[index];
          symbols.push({
            name: `component${index + 1}`,
            kind: SymbolKind.Method,
            scope: symbol.name,
            modifiers: ["phantom", "data_class_generated", "operator"],
            range: symbol.range,
            parameters: [],
            returnType: prop.type || "Any",
            metadata: { isPhantom: true },
          })
        }

        const copyParams: any[] = []
        for (let j = 0; j < properties.length; j++) {
           copyParams.push({ name: properties[j].name, type: properties[j].type || "Any" })
        }

        symbols.push({
          name: "copy",
          kind: SymbolKind.Method,
          scope: symbol.name,
          modifiers: ["phantom", "data_class_generated"],
          range: symbol.range,
          parameters: copyParams,
          returnType: symbol.name,
          metadata: { isPhantom: true },
        })

        const stdMethods = [
          { name: "equals", type: "Boolean", params: [{ name: "other", type: "Any?" }] },
          { name: "hashCode", type: "Int", params: [] },
          { name: "toString", type: "String", params: [] },
        ]

        for (let j = 0; j < stdMethods.length; j++) {
          const method = stdMethods[j]
          symbols.push({
            name: method.name,
            kind: SymbolKind.Method,
            scope: symbol.name,
            modifiers: ["phantom", "data_class_generated", "override"],
            range: symbol.range,
            parameters: method.params,
            returnType: method.type,
            metadata: { isPhantom: true },
          })
        }
      }
    }
  }

  private extractSymbolsWithScoping(
    node: Node,
    ctx: KotlinContext,
    symbols: UniversalSymbol[],
    content: string,
    parentClass?: string,
  ): void {
    const stack: { n: Node; pClass?: string; isPop?: boolean; name?: string }[] = [{ n: node, pClass: parentClass }]

    while (stack.length > 0) {
      const entry = stack.pop()!
      if (entry.isPop) {
        if (entry.name) {
          ctx.classStack.pop()
        }
        continue
      }

      const n = entry.n
      const pClass = entry.pClass
      let nextParentClass = pClass
      let pushedName: string | undefined = undefined

      switch (n.type) {
        case "function_declaration":
          this.extractFunction(n, symbols, ctx, pClass)
          break
        case "class_declaration": {
          const isInterface = someSymbol(n.children, (c) => c?.type === "interface")
          const isEnum = someSymbol(n.children, (c) => c?.type === "enum")
          const cName = this.findChildByType(n, ["type_identifier", "simple_identifier"])?.text
          if (cName) {
            ctx.classStack.push(cName)
            pushedName = cName
            nextParentClass = cName
          }
          if (isInterface) {
            this.extractInterface(n, symbols, ctx)
          } else if (isEnum) {
            this.extractEnumClass(n, symbols, ctx)
          } else {
            this.extractClass(n, symbols, ctx)
          }
          break
        }
        case "object_declaration": {
          const oName = this.findChildByType(n, ["type_identifier", "simple_identifier"])?.text
          if (oName) {
            ctx.classStack.push(oName)
            pushedName = oName
            nextParentClass = oName
          }
          this.extractObject(n, symbols, ctx)
          break
        }
        case "property_declaration":
          this.extractProperty(n, symbols, ctx, pClass)
          break
        case "primary_constructor":
        case "constructor_declaration":
        case "secondary_constructor":
          this.extractConstructor(n, symbols, ctx, pClass)
          break
        case "package_header":
          this.extractPackage(n, ctx)
          break
        case "import_header":
          this.extractImport(n, ctx)
          break
        case "annotation":
          this.extractAnnotation(n, symbols, ctx)
          break
      }

      // Schedule the pop if we pushed to ctx.classStack
      if (pushedName) {
        stack.push({ n: n, isPop: true, name: pushedName })
      }

      // Push children uniformly!
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) {
          stack.push({ n: child, pClass: nextParentClass })
        }
      }
    }
  }

  /**
   * Extract Kotlin function with extension functions and suspend functions
   */
  private extractFunction(node: Node, symbols: UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const functionName = nameNode.text
    const qualifiedName = this.buildQualifiedName(functionName, ctx, parentClass)

    // Extract modifiers
    const modifiers = this.extractModifiers(node, ctx)

    // Extract parameters with Kotlin features (default values, named parameters)
    const parameters = this.extractKotlinParameters(node, ctx)

    // Extract return type
    const returnType = this.extractReturnType(node, ctx)

    // Extract receiver type (for extension functions)
    const receiverType = this.extractReceiverType(node, ctx)

    // Find function calls within this function
    const qualifiedCalls = this.findKotlinFunctionCalls(node, ctx)

    // Extract annotations
    const annotations = this.extractAnnotations(node, ctx)

    // Extract KDoc comments
    const kdoc = this.extractKDocComment(node, ctx)

    // Determine function characteristics
    const visibility = this.determineVisibility(modifiers, ctx)
    let isInline = false, isInfix = false, isOperator = false, isSuspend = false
    for (let i = 0; i < modifiers.length; i++) {
      if (modifiers[i] === "inline") isInline = true
      else if (modifiers[i] === "infix") isInfix = true
      else if (modifiers[i] === "operator") isOperator = true
      else if (modifiers[i] === "suspend") isSuspend = true
    }
    const isExtension = !!receiverType

    // Extract API Contract Path if this is a web handler (Spring/Ktor)
    const apiContractPath = this.extractKotlinApiContractPath(node, ctx)

    const symbol: UniversalSymbol = {
      name: functionName,
      kind: parentClass ? SymbolKind.Method : SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility,
      isAsync: isSuspend,
      parameters,
      returnType,
      decorators: annotations,
      comments: kdoc ? [kdoc] : [],
      qualified_calls: qualifiedCalls,
      apiContractPath,
      ownerName: parentClass,
      ownerKind: parentClass ? SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        receiverType,
        isInline,
        isInfix,
        isOperator,
        isSuspend,
        isExtension,
        complexity: this.calculateFunctionComplexity(node, ctx),
        parameterCount: parameters.length,
        hasKDoc: !!kdoc,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  private extractKotlinApiContractPath(node: Node, ctx: KotlinContext): string | undefined {
    const modifiersNode = this.findChildByType(node, ["modifiers"])
    if (node) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const mod = node.namedChild(i)
        if (mod?.type === "annotation" || mod?.type === "marker_annotation") {
          const text = mod.text
          if (
            text.startsWith("@GetMapping") ||
            text.startsWith("@PostMapping") ||
            text.startsWith("@PutMapping") ||
            text.startsWith("@DeleteMapping") ||
            text.startsWith("@PatchMapping")
          ) {
            const method = text.split("Mapping")[0].replace("@", "").toUpperCase()
            const args = mod.childForFieldName("arguments")
            let pathMatch = "/"
            if (args && args.namedChildCount > 0) {
              pathMatch = args.namedChild(0)?.text?.split('"').join("") || "/"
            }
            return `${method} ${pathMatch}`
          }
          if (text.startsWith("@RequestMapping")) {
            const args = mod.childForFieldName("arguments")
            let path = "/"
            let methodStr = "ANY"
            if (args) {
              for (let j = 0; j < args.namedChildCount; j++) {
                const arg = args.namedChild(j)
                if (!arg) continue
                if (stringIncludes(arg.text, "method") && stringIncludes(arg.text, "RequestMethod.")) {
                  const parts = arg.text.split(".")
                  methodStr = parts[parts.length - 1]
                } else if (!stringIncludes(arg.text, "=")) {
                  path = arg.text.split('"').join("")
                } else if (arg.text.startsWith("value")) {
                  path = arg.text.split("=")[1].split('"').join("")
                }
              }
            }
            return `${methodStr.toUpperCase()} ${path}`
          }
        }
      }
    }

    if (node.parent?.type === "call_expression") {
      const callName = node.parent.childForFieldName("function")?.text
      const methods = ["get", "post", "put", "patch", "delete", "options", "head"]
      if (callName && someSymbol(methods, (m) => m === callName)) {
        const args = node.parent.childForFieldName("arguments")
        const path = args?.namedChild(0)?.text?.split('"').join("")
        if (path) return `${callName.toUpperCase()} ${path}`
      }
    }
    return undefined
  }

  /**
   * Extract Kotlin class with data classes, sealed classes, and inner classes
   */
  private extractClass(node: Node, symbols: UniversalSymbol[], ctx: KotlinContext) {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const className = nameNode.text
    const qualifiedName = this.buildQualifiedName(className, ctx)

    // Extract modifiers
    const modifiers = this.extractModifiers(node, ctx)

    // Extract inheritance and interfaces
    const superTypes = this.extractSuperTypes(node, ctx)

    // Extract type parameters (generics)
    const typeParameters = this.extractTypeParameters(node, ctx)

    // Extract annotations
    const annotations = this.extractAnnotations(node, ctx)

    // Extract KDoc
    const kdoc = this.extractKDocComment(node, ctx)

    // Determine class characteristics
    const visibility = this.determineVisibility(modifiers, ctx)
    let isData = false, isSealed = false, isAbstract = false, isInner = false, isOpen = false
    for (let i = 0; i < modifiers.length; i++) {
      if (modifiers[i] === "data") isData = true
      else if (modifiers[i] === "sealed") isSealed = true
      else if (modifiers[i] === "abstract") isAbstract = true
      else if (modifiers[i] === "inner") isInner = true
      else if (modifiers[i] === "open") isOpen = true
    }

    const symbol: UniversalSymbol = {
      name: className,
      kind: SymbolKind.Class,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility,
      isAbstract,
      decorators: annotations,
      comments: kdoc ? [kdoc] : [],
      metadata: {
        modifiers,
        superTypes,
        inheritance: superTypes,
        typeParameters,
        isData,
        isDataClass: isData,
        isSealed,
        isInner,
        isOpen,
        methodCount: this.countMethods(node, ctx),
        propertyCount: this.countProperties(node, ctx),
        hasCompanionObject: this.hasCompanionObject(node, ctx),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    // Push class to stack for member extraction
  }

  /**
   * Extract Kotlin object (singleton)
   */
  private extractObject(node: Node, symbols: UniversalSymbol[], ctx: KotlinContext) {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const objectName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const superTypes = this.extractSuperTypes(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    const symbol: UniversalSymbol = {
      name: objectName,
      kind: SymbolKind.Class, // Using Class for objects
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      decorators: annotations,
      metadata: {
        modifiers,
        superTypes,
        isObject: true,
        isCompanionObject: (() => { for (let i = 0; i < modifiers.length; i++) if (modifiers[i] === "companion") return true; return false; })(),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  /**
   * Extract Kotlin property with getters/setters and delegation
   */
  private extractProperty(node: Node, symbols: UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const propertyName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const propertyType = this.extractPropertyType(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    // Analyze property characteristics
    const isVal = this.isValProperty(node)
    const isVar = this.isVarProperty(node)
    let isLateInit = false, isConst = false
    for (let i = 0; i < modifiers.length; i++) {
      if (modifiers[i] === "lateinit") isLateInit = true
      if (modifiers[i] === "const") isConst = true
    }
    const hasDelegate = this.hasDelegate(node)

    const symbol: UniversalSymbol = {
      name: propertyName,
      kind: SymbolKind.Property,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      decorators: annotations,
      ownerName: parentClass,
      ownerKind: parentClass ? SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        propertyType,
        isVal,
        isVar,
        isLateInit,
        isConst,
        hasDelegate,
        hasCustomGetter: this.hasCustomGetter(node),
        hasCustomSetter: this.hasCustomSetter(node),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  /**
   * Kotlin-specific framework detection
   */
  private detectKotlinFrameworks(
    content: string,
    symbols: UniversalSymbol[],
    imports: ImportInfo[],
  ): string[] {
    const frameworks: Record<string, boolean> = {}
    const hasImport = (pkg: string) => {
      for (let i = 0; i < imports.length; i++) {
        const mod = imports[i].module
        if (mod && (mod.startsWith(pkg) || mod === pkg)) return true
      }
      return false
    }

    if (hasImport("org.springframework") || hasImport("org.springframework.boot")) {
      frameworks["Spring Boot"] = true
      frameworks["Spring Framework"] = true
    }
    if (hasImport("io.ktor")) frameworks["Ktor"] = true
    if (hasImport("io.micronaut")) frameworks["Micronaut"] = true
    if (hasImport("io.reactivex.rxjava2") || hasImport("io.reactivex.rxjava3")) frameworks["RxJava"] = true
    if (hasImport("org.hibernate") || hasImport("javax.persistence") || hasImport("jakarta.persistence"))
      frameworks["Hibernate / JPA"] = true
    if (hasImport("kotlinx.coroutines")) frameworks["Kotlin Coroutines"] = true
    if (hasImport("org.junit") || hasImport("kotlin.test")) frameworks["JUnit"] = true
    if (hasImport("io.mockk") || hasImport("org.mockito")) frameworks["Mocking Framework"] = true
    if (hasImport("androidx.compose")) frameworks["Jetpack Compose"] = true
    if (hasImport("android.app") || hasImport("androidx")) frameworks["Android SDK"] = true

    const result: string[] = []
    for (const key in frameworks) {
      if (Object.prototype.hasOwnProperty.call(frameworks, key)) {
        result.push(key)
      }
    }
    return result
  }



  /**
   * Detect Kotlin-specific patterns
   */
  private detectKotlinPatterns(
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    content: string,
  ): string[] {
    const patterns: string[] = []

    let hasData = false, hasSealed = false, hasExtension = false, hasSuspend = false, hasDelegate = false, hasCompanion = false, hasOperator = false
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.metadata?.isData) hasData = true
      if (s.metadata?.isSealed) hasSealed = true
      if (s.metadata?.isExtension) hasExtension = true
      if (s.metadata?.isSuspend) hasSuspend = true
      if (s.metadata?.hasDelegate) hasDelegate = true
      if (s.metadata?.hasCompanionObject || s.metadata?.isCompanionObject) hasCompanion = true
      if (s.metadata?.isOperator) hasOperator = true
    }

    if (hasData) patterns.push("Data Classes")
    if (hasSealed) patterns.push("Sealed Classes")
    if (hasExtension) patterns.push("Extension Functions")
    if (hasSuspend) patterns.push("Coroutines")
    if (stringIncludes(content, "?") || stringIncludes(content, "!!") || stringIncludes(content, "?.")) patterns.push("Null Safety")
    if (stringIncludes(content, "is ") || stringIncludes(content, "as ")) patterns.push("Smart Casts")
    if (stringIncludes(content, "->") || stringIncludes(content, "let") || stringIncludes(content, "apply")) patterns.push("Higher-Order Functions")
    if (hasDelegate || stringIncludes(content, "by ")) {
      patterns.push("Delegation")
      patterns.push("Property Delegation")
    }
    if (stringIncludes(content, "buildString {") || stringIncludes(content, ".() ->")) patterns.push("DSL Patterns")
    if (stringIncludes(content, "@GetMapping") || stringIncludes(content, "@PostMapping") || stringIncludes(content, "@RequestMapping")) patterns.push("REST API")
    if (hasCompanion) patterns.push("Companion Objects")
    if (hasOperator) patterns.push("Operator Overloading")

    return patterns
  }

  private extractKotlinParameters(node: Node, ctx: KotlinContext): Parameter[] {
    const parameters: Parameter[] = []

    let paramsNode = this.findChildByType(node, ["function_value_parameters", "value_parameters"])
    if (!paramsNode) return parameters
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const paramNode = paramsNode.namedChild(i)
      if (paramNode && paramNode.type === "parameter") {
        const nameNode = this.findChildByType(paramNode, ["simple_identifier"])
        const typeNode = this.findChildByType(paramNode, ["user_type", "nullable_type", "type_identifier"])
        const defaultNode = this.findChildByType(paramNode, [
          "expression",
          "string_literal",
          "integer_literal",
          "boolean_literal",
        ])

        if (nameNode) {
          parameters.push({
            name: nameNode.text,
            type: typeNode ? this.cleanKotlinType(typeNode.text) : undefined,
            isOptional: !!defaultNode,
            defaultValue: defaultNode ? defaultNode.text : undefined,
          })
        }
      }
    }
    return parameters
  }

  private buildQualifiedName(name: string, ctx: KotlinContext, parentClass?: string): string {
    const scope = parentClass || this.currentScope(ctx)
    return scope ? `${scope}.${name}` : name
  }

  private currentScope(ctx: KotlinContext): string {
    return [...ctx.packageStack, ...ctx.classStack].join(".")
  }

  private nodeToRange(node: Node): UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  // Additional helper methods (stubs for now)...
  /**
   * Kotlin Interface Extraction
   */
  private extractInterface(node: Node, symbols: UniversalSymbol[], ctx: KotlinContext): void {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const interfaceName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const superTypes = this.extractSuperTypes(node, ctx)
    const typeParameters = this.extractTypeParameters(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    const symbol: UniversalSymbol = {
      name: interfaceName,
      kind: SymbolKind.Interface,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      isAbstract: true, // All interfaces are abstract
      decorators: annotations,
      metadata: {
        modifiers,
        superTypes,
        inheritance: superTypes,
        typeParameters,
        methodCount: this.countMethods(node, ctx),
        isKotlinInterface: true,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  /**
   * Kotlin Enum Class Extraction
   */
  private extractEnumClass(node: Node, symbols: UniversalSymbol[], ctx: KotlinContext): void {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const enumName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)
    const enumValues = this.extractKotlinEnumValues(node)

    const symbol: UniversalSymbol = {
      name: enumName,
      kind: SymbolKind.Enum,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      decorators: annotations,
      metadata: {
        modifiers,
        enumValues,
        valueCount: enumValues.length,
        hasEnumMethods: this.countMethods(node, ctx) > 0,
        isKotlinEnum: true,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    // Extract enum values as symbols
    for (const enumValue of enumValues) {
      symbols.push({
        name: enumValue,
        kind: SymbolKind.EnumMember,
        range: this.nodeToRange(node), // Would need specific range
        scope: this.currentScope(ctx),
        visibility: "public",
        ownerName: enumName,
        ownerKind: SymbolKind.Enum,
        metadata: {
          isEnumValue: true,
          kotlinSpecific: true,
        },
      })
    }
  }

  /**
   * Kotlin Constructor Extraction
   */
  private extractConstructor(
    node: Node,
    symbols: UniversalSymbol[],
    ctx: KotlinContext,
    parentClass?: string,
  ): void {
    const parameters = this.extractKotlinParameters(node, ctx)
    const modifiers = this.extractModifiers(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    const isPrimaryConstructor = node.type === "primary_constructor"
    if (isPrimaryConstructor) {
      parameters.length = 0
      for (let i = 0; i < node.namedChildCount; i++) {
        const paramNode = node.namedChild(i)
        if (paramNode && paramNode.type === "class_parameter") {
          const nameNode = this.findChildByType(paramNode, ["simple_identifier"])
          const typeNode = this.findChildByType(paramNode, ["user_type", "nullable_type", "type_identifier"])

          let exists = false
          if (nameNode) {
            for (let j = 0; j < parameters.length; j++) {
              if (parameters[j].name === nameNode.text) { exists = true; break; }
            }
          }

          if (nameNode && !exists) {
            parameters.push({
              name: nameNode.text,
              type: typeNode ? this.cleanKotlinType(typeNode.text) : "Any",
            })
          }
        }
      }
    }
    let hasDefaults = false;
    for (let i = 0; i < parameters.length; i++) {
      if (parameters[i].defaultValue !== undefined) { hasDefaults = true; break; }
    }

    const constructorName = isPrimaryConstructor ? "constructor" : parentClass || "constructor"
    const symbol: UniversalSymbol = {
      name: constructorName,
      kind: SymbolKind.Constructor,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      parameters,
      decorators: annotations,
      ownerName: parentClass,
      ownerKind: parentClass ? SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        isPrimaryConstructor,
        parameterCount: parameters.length,
        hasDefaultParameters: hasDefaults,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    // In Kotlin, primary constructors can define properties (val/var)
    if (isPrimaryConstructor && parentClass) {
      let paramsNode = node.childForFieldName("parameters") || findSymbol(node.children, (c) => c?.type === "value_parameters")
      if (paramsNode) {
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const paramNode = paramsNode.namedChild(i)
          if (paramNode && paramNode.type === "parameter") {
            const text = paramNode.text
            if (text.startsWith("val ") || text.startsWith("var ")) {
              const nameNode =
                paramNode.childForFieldName("name") || findSymbol(paramNode.children, (c) => c?.type === "simple_identifier")
              const typeNode = paramNode.childForFieldName("type")
              if (nameNode) {
                symbols.push({
                  name: nameNode.text,
                  kind: SymbolKind.Property,
                  range: this.nodeToRange(paramNode),
                  scope: this.currentScope(ctx),
                  visibility: this.determineVisibility(modifiers, ctx),
                  ownerName: parentClass,
                  ownerKind: SymbolKind.Class,
                  returnType: typeNode ? this.cleanKotlinType(typeNode.text) : undefined,
                  metadata: {
                    isVal: text.startsWith("val "),
                    isVar: text.startsWith("var "),
                    isConstructorProperty: true,
                    kotlinSpecific: true,
                  },
                })
              }
            }
          }
        }
      }
    }
  }

  /**
   * Kotlin Package Extraction
   */
  private extractPackage(node: Node, ctx: KotlinContext): void {
    const packageNameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (packageNameNode) {
      const packageName = packageNameNode.text
      ctx.packageStack = packageName.split(".")
    }
  }

  /**
   * Kotlin Import Extraction
   */
  private extractImport(node: Node, ctx: KotlinContext): void {
    const importPathNode = this.findChildByType(node, ["identifier"])
    if (!importPathNode) return

    const importPath = importPathNode.text
    const aliasNode = this.findChildByType(node, ["import_alias"])

    if (aliasNode) {
      // Handle import aliasing: import com.example.Foo as Bar
      ctx.importAliases.set(aliasNode.text, importPath)
    } else {
      // Extract class name from import path
      const parts = importPath.split(".")
      const className = parts[parts.length - 1]
      if (className) {
        ctx.importAliases.set(className, importPath)
      }
    }
  }
  /**
   * Kotlin Annotation Extraction
   */
  private extractAnnotation(node: Node, symbols: UniversalSymbol[], ctx: KotlinContext): void {
    const annotationName = this.getKotlinAnnotationName(node)
    if (!annotationName) return

    const annotationArgs = this.extractKotlinAnnotationArguments(node)
    const target = this.extractKotlinAnnotationTarget(node)

    // Store annotation for current context
    const currentClassOrFunction = ctx.classStack[ctx.classStack.length - 1]
    if (currentClassOrFunction) {
      if (!ctx.annotations.has(currentClassOrFunction)) {
        ctx.annotations.set(currentClassOrFunction, [])
      }
      ctx.annotations.get(currentClassOrFunction)?.push(annotationName)
    }
  }

  /**
   * Kotlin Modifier Extraction
   */
  private extractModifiers(node: Node, ctx: KotlinContext): string[] {
    const modifiers: string[] = []

    const modifiersNode = this.findChildByType(node, ["modifiers"])
    if (modifiersNode) {
      for (let j = 0; j < modifiersNode.namedChildCount; j++) {
        const modifier = modifiersNode.namedChild(j)
        if (modifier && modifier.type !== "annotation") {
          modifiers.push(modifier.text.trim())
        }
      }
    }

    // Also check direct text for common modifiers, but only before body/args
    const prefixText = node.text.split(/[\{\(\=]/)[0] || node.text
    const kotlinModifiers = [
      "public",
      "private",
      "protected",
      "internal",
      "final",
      "open",
      "abstract",
      "sealed",
      "override",
      "virtual",
      "static",
      "const",
      "inline",
      "infix",
      "operator",
      "suspend",
      "expect",
      "actual",
      "data",
      "inner",
      "enum",
      "annotation",
      "companion",
      "lateinit",
      "tailrec",
      "external",
    ]

    for (let i = 0; i < kotlinModifiers.length; i++) {
      const mod = kotlinModifiers[i]
      if (stringIncludes(prefixText, `${mod} `)) {
        let hasMod = false
        for (let j = 0; j < modifiers.length; j++) {
          if (modifiers[j] === mod) { hasMod = true; break; }
        }
        if (!hasMod) {
          modifiers.push(mod)
        }
      }
    }

    return modifiers
  }

  /**
   * Kotlin Return Type Extraction
   */
  private extractReturnType(node: Node, ctx: KotlinContext): string | undefined {
    const typeNode =
      node.childForFieldName("return_type") ||
      this.findChildByType(node, ["user_type", "nullable_type", "function_type", "type_identifier"])

    if (typeNode) {
      return this.cleanKotlinType(typeNode.text)
    }

    // Check for lambda return type
    const functionBody = node.childForFieldName("body")
    if (stringIncludes(functionBody?.text || "", "->")) {
      return "() -> Unit" // Lambda type
    }

    // Check for Unit return type (default in Kotlin)
    return "Unit"
  }

  /**
   * Kotlin Receiver Type Extraction (for extension functions)
   */
  private extractReceiverType(node: Node, ctx: KotlinContext): string | undefined {
    let receiverNode: Node | undefined = undefined
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "simple_identifier") break
      if (c?.type === "user_type" || c?.type === "nullable_type" || c?.type === "type_identifier") {
        receiverNode = c
        break
      }
    }
    if (receiverNode) {
      return this.cleanKotlinType(receiverNode.text)
    }

    // Check if this is an extension function by looking at function declaration
    const functionText = node.text
    const extensionMatch = functionText.match(/fun\s+(\w+(?:<[^>]*>)?)\s*\./)
    if (extensionMatch) {
      return extensionMatch[1]
    }

    return undefined
  }
  /**
   * Kotlin Function Call Detection
   * Analyzes Kotlin method calls, extension functions, and Android/Spring patterns
   */
  private findKotlinFunctionCalls(node: Node, ctx: KotlinContext): string[] {
    const calls: string[] = []
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        const callName = this.buildKotlinCallExpression(n)
        if (callName && !this.isKotlinBuiltin(callName)) {
          calls.push(callName)
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return calls
  }
  /**
   * Kotlin Annotations Extraction (multiple)
   */
  private extractAnnotations(node: Node, ctx: KotlinContext): string[] {
    const annotations: string[] = []
    
    // Explicitly push expect/actual as pseudo-annotations so they persist
    const modifiers = this.extractModifiers(node, ctx);
    if (modifiers.includes("expect")) annotations.push("@expect");
    if (modifiers.includes("actual")) annotations.push("@actual");

    const modifiersNode = this.findChildByType(node, ["modifiers"])
    if (node) {
      const stack: Node[] = [node]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "annotation" || n.type === "user_type" || n.type === "marker_annotation") {
          annotations.push(n.text.replace(/^@/, ""))
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) stack.push(child)
        }
      }
    }
    return annotations
  }

  /**
   * Kotlin KDoc Comment Extraction
   */
  private extractKDocComment(node: Node, ctx: KotlinContext): string | undefined {
    // Look for KDoc comment before the node
    const parent = node.parent
    if (!parent) return undefined

    for (let i = 0; i < parent.namedChildCount; i++) {
      const sibling = parent.namedChild(i)
      if (sibling === node) break

      if (sibling?.type === "comment" && sibling.text.startsWith("/**")) {
        return sibling.text
      }
    }

    return undefined
  }

  /**
   * Kotlin Visibility Determination
   */
  private determineVisibility(
    modifiers: string[],
    ctx: KotlinContext,
  ): "public" | "private" | "protected" | "internal" {
    for (let i = 0; i < modifiers.length; i++) {
      const mod = modifiers[i]
      if (mod === "private") return "private"
      if (mod === "protected") return "protected"
      if (mod === "internal") return "internal"
    }


    return "public" // Default in Kotlin
  }

  /**
   * Kotlin Function Complexity Calculation
   */
  private calculateFunctionComplexity(node: Node, ctx: KotlinContext): number {
    let complexity = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "if_expression" ||
        n.type === "when_expression" ||
        n.type === "for_statement" ||
        n.type === "while_statement" ||
        n.type === "catch_block" ||
        n.type === "elvis_expression" ||
        n.type === "safe_nav_expression"
      ) {
        complexity++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  /**
   * Kotlin Super Types Extraction
   */
  private extractSuperTypes(node: Node, ctx: KotlinContext): string[] {
    const superTypes: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "delegation_specifier") {
        const userType = this.findChildByType(c, ["user_type"])
        if (userType) {
          superTypes.push(this.cleanKotlinType(userType.text))
        } else {
          superTypes.push(this.cleanKotlinType(c.text.replace(/\(.*\)/, "")))
        }
      }
    }
    return superTypes
  }

  /**
   * Kotlin Type Parameters Extraction
   */
  private extractTypeParameters(node: Node, ctx: KotlinContext): string[] {
    const typeParameters: string[] = []

    const typeParamList = this.findChildByType(node, ["type_parameters"])
    if (typeParamList) {
      for (let i = 0; i < typeParamList.namedChildCount; i++) {
        const typeParam = typeParamList.namedChild(i)
        if (typeParam?.type === "type_parameter") {
          const paramName = typeParam.childForFieldName("name")?.text
          if (paramName) {
            typeParameters.push(paramName)
          }
        }
      }
    }

    return typeParameters
  }
  /**
   * Kotlin Method Counting
   */
  private countMethods(node: Node, ctx: KotlinContext): number {
    let count = 0

    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "function_declaration" || n.type === "method_declaration") {
        count++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return count
  }

  /**
   * Kotlin Property Counting
   */
  private countProperties(node: Node, ctx: KotlinContext): number {
    let count = 0
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "property_declaration" || n.type === "field_declaration") {
        count++
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return count
  }

  /**
   * Kotlin Companion Object Detection
   */
  private hasCompanionObject(node: Node, ctx: KotlinContext): boolean {
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "object_declaration") {
        const modifiers = this.extractModifiers(n, ctx)
        for (let j = 0; j < modifiers.length; j++) {
          if (modifiers[j] === "companion") return true
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return false
  }

  /**
   * Kotlin Property Type Extraction
   */
  private extractPropertyType(node: Node, ctx: KotlinContext): string | undefined {
    const typeNode = this.findChildByType(node, ["user_type", "nullable_type", "function_type", "type_identifier"])
    if (typeNode) {
      return this.cleanKotlinType(typeNode.text)
    }

    // Try to infer from initializer
    const initializer = node.childForFieldName("initializer")
    if (initializer) {
      return this.inferKotlinTypeFromInitializer(initializer)
    }

    return undefined
  }

  /**
   * Kotlin Val Property Detection
   */
  private isValProperty(node: Node): boolean {
    return stringIncludes(node.text, "val ") && !stringIncludes(node.text, "var ")
  }

  /**
   * Kotlin Var Property Detection
   */
  private isVarProperty(node: Node): boolean {
    return stringIncludes(node.text, "var ")
  }

  /**
   * Kotlin Property Delegation Detection
   */
  private hasDelegate(node: Node): boolean {
    return stringIncludes(node.text, " by ")
  }

  /**
   * Kotlin Custom Getter Detection
   */
  private hasCustomGetter(node: Node): boolean {
    return stringIncludes(node.text, "get()") || stringIncludes(node.text, "get() =")
  }

  /**
   * Kotlin Custom Setter Detection
   */
  private hasCustomSetter(node: Node): boolean {
    return stringIncludes(node.text, "set(") && stringIncludes(node.text, "value")
  }
  // ======================== ADDITIONAL KOTLIN HELPER METHODS ========================

  /**
   * Kotlin Call Expression Builder
   */
  private buildKotlinCallExpression(node: Node): string {
    switch (node.type) {
      case "simple_identifier":
      case "identifier":
        return node.text

      case "navigation_expression":
        return this.buildKotlinNavigationExpression(node)

      case "call_expression":
        const functionName = this.findChildByType(node, ["simple_identifier", "identifier"])?.text
        return functionName || node.text

      default:
        return node.text
    }
  }

  /**
   * Kotlin Navigation Expression Builder (for method calls)
   */
  private buildKotlinNavigationExpression(node: Node): string {
    const receiver = node.namedChild(0)
    const selector = node.namedChild(node.namedChildCount - 1)

    if (!receiver || !selector) return node.text

    const receiverText =
      receiver.type === "navigation_expression" ? this.buildKotlinNavigationExpression(receiver) : receiver.text

    return `${receiverText}.${selector.text}`
  }

  /**
   * Check if function call is Kotlin builtin
   */
  private isKotlinBuiltin(call: string): boolean {
    const builtins = [
      "println",
      "print",
      "readLine",
      "require",
      "check",
      "error",
      "let",
      "run",
      "with",
      "apply",
      "also",
      "takeIf",
      "takeUnless",
      "toString",
      "equals",
      "hashCode",
      "copy",
      "componentN",
    ]

    for (let i = 0; i < builtins.length; i++) {
      if (stringIncludes(call, builtins[i])) return true
    }

    return call.startsWith("kotlin.") || call.startsWith("java.") || call.startsWith("android.")
  }

  /**
   * Kotlin Annotation Name Extraction
   */
  private getKotlinAnnotationName(node: Node): string | undefined {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (nameNode) {
      return `@${nameNode.text}`
    }

    // Extract from text
    const match = node.text.match(/@(\w+)/)
    return match ? `@${match[1]}` : undefined
  }

  /**
   * Kotlin Annotation Arguments Extraction
   */
  private extractKotlinAnnotationArguments(node: Node): string[] {
    const args: string[] = []
    const argsNode = node.childForFieldName("arguments")

    if (argsNode) {
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const arg = argsNode.namedChild(i)
        if (arg) {
          args.push(arg.text)
        }
      }
    }

    return args
  }

  /**
   * Kotlin Annotation Target Extraction
   */
  private extractKotlinAnnotationTarget(node: Node): string | undefined {
    // Look for use-site targets like @field:, @get:, @set:, etc.
    const match = node.text.match(/@(\w+):/)
    return match ? match[1] : undefined
  }

  /**
   * Kotlin Type Cleaning
   */
  private cleanKotlinType(typeText: string): string {
    const parts = typeText.split(" ")
    const validParts: string[] = []
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) validParts.push(parts[i])
    }
    return validParts.join(" ").replace("??", "?").replace("? ?", "?").trim()
  }

  /**
   * Kotlin Type Inference from Initializer
   */
  private inferKotlinTypeFromInitializer(initNode: Node): string {
    const text = initNode.text.trim()

    // Number literals
    if (/^\d+$/.test(text)) return "Int"
    if (/^\d+L$/.test(text)) return "Long"
    if (/^\d+\.\d+f?$/i.test(text)) return "Double"
    if (/^true|false$/.test(text)) return "Boolean"

    // String literals
    if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return "String"

    // Collection literals
    if (text.startsWith("listOf")) return "List<*>"
    if (text.startsWith("mutableListOf")) return "MutableList<*>"
    if (text.startsWith("setOf")) return "Set<*>"
    if (text.startsWith("mapOf")) return "Map<*, *>"

    // Array literals
    if (text.startsWith("arrayOf")) return "Array<*>"

    // Constructor calls
    const constructorMatch = text.match(/^(\w+)\s*\(/)
    if (constructorMatch) {
      return constructorMatch[1]
    }

    return "Any" // Fallback
  }

  /**
   * Kotlin Enum Values Extraction
   */
  private extractKotlinEnumValues(node: Node): string[] {
    const values: string[] = []

    const enumBody = this.findChildByType(node, ["enum_class_body", "class_body"])
    if (!enumBody) return values

    for (let i = 0; i < enumBody.namedChildCount; i++) {
      const child = enumBody.namedChild(i)
      if (child?.type === "enum_entry") {
        const nameNode = this.findChildByType(child, ["simple_identifier", "type_identifier"])
        if (nameNode) {
          values.push(nameNode.text)
        }
      }
    }

    return values
  }
  private calculateRealComplexity(
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
  ): number {
    return symbols.length + relationships.length
  }
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      switch (n.type) {
        case "if_expression":
        case "else_clause":
        case "for_statement":
        case "while_statement":
        case "do_while_statement":
        case "when_entry":
        case "catch_block":
        case "elvis_expression":
          complexity++
          break
        case "conjunction_expression":
        case "disjunction_expression":
          complexity++
          break
        case "lambda_literal":
          break
      }

      if (n.type === "infix_expression") {
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") {
          complexity++
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return complexity
  }
  private extractFunctionCalls(node: Node): string[] {
    const calls: string[] = []
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        const callName = this.findChildByType(n, ["simple_identifier", "identifier"])?.text || n.text.split("(")[0]
        calls.push(callName)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return calls
  }

  private analyzeRelationships(
    node: Node,
    relationships: UniversalRelationship[],
    symbols: UniversalSymbol[],
  ): void {
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!

      if (n.type === "function_declaration") {
        let receiverNode: any = undefined; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "simple_identifier") break; if (c?.type === "user_type" || c?.type === "nullable_type" || c?.type === "type_identifier") { receiverNode = c; break; } }
        const nameNode = this.findChildByType(n, ["simple_identifier", "type_identifier"])
        if (receiverNode && nameNode) {
          const receiverType = receiverNode.text.endsWith("?") ? receiverNode.text.slice(0, -1) : receiverNode.text
          relationships.push({
            source: nameNode.text,
            target: receiverType,
            type: RelationshipType.Extends,
            confidence: 1.0,
            metadata: {
              relationshipType: "kotlin_extension_function",
              isExtension: true,
            },
          })
        }

        const isComposable = stringIncludes(n.text, "@Composable")
        if (isComposable && nameNode) {
          const bodyNode = this.findChildByType(n, ["function_body", "class_body"])
          if (bodyNode) {
            const bodyCalls = this.extractFunctionCalls(bodyNode)
            for (let i = 0; i < bodyCalls.length; i++) {
              const call = bodyCalls[i]
              if (/^[A-Z]/.test(call)) {
                relationships.push({
                  source: nameNode.text,
                  target: call,
                  type: RelationshipType.Contains,
                  confidence: 0.8,
                  metadata: {
                    relationshipType: "compose_ui_tree",
                    isUiComponent: true,
                  },
                })
              }
            }
          }
        }
      }

      if (n.type === "call_expression") {
        const callName = this.findChildByType(n, ["simple_identifier", "identifier"])?.text || n.text.split("(")[0]
        if (callName === "launch" || callName === "async" || callName === "withContext") {
          let parentFunc = n.parent
          while (parentFunc && parentFunc?.type !== "function_declaration") {
            parentFunc = parentFunc.parent
          }
          if (parentFunc) {
            const parentName = this.findChildByType(parentFunc, ["simple_identifier", "type_identifier"])?.text
            if (parentName) {
              relationships.push({
                source: parentName,
                target: callName,
                type: RelationshipType.Uses,
                confidence: 1.0,
                metadata: {
                  relationshipType: "coroutine_dispatch",
                  isAsync: true,
                },
              })
            }
          }
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    for (let i = 0; i < symbols.length; i++) {
      const cls = symbols[i]
      if (cls.kind === SymbolKind.Class || cls.kind === SymbolKind.Interface) {
        if (cls.metadata?.superTypes) {
          for (let j = 0; j < cls.metadata.superTypes.length; j++) {
            // First supertype of a class = extends, rest = implements.
            // For interfaces, all supertypes are extends.
            const isExtends = cls.kind === SymbolKind.Interface || j === 0
            relationships.push({
              source: cls.name,
              target: cls.metadata.superTypes[j],
              type: isExtends ? RelationshipType.Extends : RelationshipType.Implements,
              confidence: 1.0,
              metadata: { relationshipType: isExtends ? "kotlin_extends" : "kotlin_implements" },
            })
          }
        }
      }
    }
  }

  private processImportsExports(node: Node, imports: ImportInfo[], exports: ExportInfo[]): void {
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "import_header") {
        const pathNode = this.findChildByType(n, ["identifier"])
        if (pathNode) {
          const importPath = pathNode.text
          const aliasNode = this.findChildByType(n, ["import_alias"])
          const isWildcard = importPath.endsWith(".*")

          imports.push({
            module: importPath,
            items: isWildcard ? ["*"] : [aliasNode ? aliasNode.text : importPath.split(".").pop() || importPath],
            isDefaultImport: false,
            isNamespaceImport: isWildcard,
            range: this.nodeToRange(n),
            metadata: {
              isKotlinImport: true,
              alias: aliasNode ? aliasNode.text : undefined,
            },
          })
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  private performKotlinTypeInference(
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
  ): any {
    const inferences: Record<string, string> = {}
    let count = 0

    for (const sym of symbols) {
      if (sym.kind === SymbolKind.Variable && !sym.returnType) {
        if (sym.name.startsWith("is") || sym.name.startsWith("has")) {
          sym.returnType = "Boolean"
          inferences[sym.name] = "Boolean"
          count++
        } else {
          let hasState = false
          if (sym.qualified_calls) {
            for (let j = 0; j < sym.qualified_calls.length; j++) {
              const c = sym.qualified_calls[j]
              if (c === "mutableStateOf" || c === "remember") { hasState = true; break; }
            }
          }
          if (hasState) {
            sym.returnType = "MutableState"
            inferences[sym.name] = "MutableState"
            count++
          }
        }
      }
    }
    return { inferred: count > 0, count, details: inferences }
  }

  private getKotlinFrameworkPatterns(frameworks: string[], symbols: UniversalSymbol[]): any[] {
    const patterns: any[] = []
    for (let i = 0; i < frameworks.length; i++) {
      const fw = frameworks[i]
      if (fw === "Jetpack Compose") {
        let hasUI = false, hasState = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.annotations) {
            for (let k = 0; k < s.metadata.annotations.length; k++) {
              if (s.metadata.annotations[k] === "Composable") hasUI = true
            }
          }
          if (s.qualified_calls) {
            for (let k = 0; k < s.qualified_calls.length; k++) {
              if (s.qualified_calls[k] === "remember" || s.qualified_calls[k] === "mutableStateOf") hasState = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasUI) fwPatterns.push("ui_components")
        if (hasState) fwPatterns.push("state_management")
        patterns.push({ framework: fw, patterns: fwPatterns })
      } else if (fw === "Android SDK") {
        let hasMvvm = false, hasLifecycle = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.superTypes) {
            for (let k = 0; k < s.metadata.superTypes.length; k++) {
              if (s.metadata.superTypes[k] === "ViewModel") hasMvvm = true
              if (s.metadata.superTypes[k] === "Activity" || s.metadata.superTypes[k] === "Fragment") hasLifecycle = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasMvvm) fwPatterns.push("mvvm_architecture")
        if (hasLifecycle) fwPatterns.push("android_lifecycle")
        patterns.push({ framework: fw, patterns: fwPatterns })
      } else if (fw === "Room") {
        let hasEntities = false, hasDaos = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.annotations) {
            for (let k = 0; k < s.metadata.annotations.length; k++) {
              if (s.metadata.annotations[k] === "Entity") hasEntities = true
              if (s.metadata.annotations[k] === "Dao") hasDaos = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasEntities) fwPatterns.push("database_entities")
        if (hasDaos) fwPatterns.push("data_access_objects")
        patterns.push({ framework: fw, patterns: fwPatterns })
      } else if (fw === "Spring Boot") {
        let hasRest = false, hasService = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.annotations) {
            for (let k = 0; k < s.metadata.annotations.length; k++) {
              if (s.metadata.annotations[k] === "RestController") hasRest = true
              if (s.metadata.annotations[k] === "Service") hasService = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasRest) fwPatterns.push("rest_controllers")
        if (hasService) fwPatterns.push("services")
        patterns.push({ framework: fw, patterns: fwPatterns })
      }
    }
    return patterns
  }

  private generateArchitecturalInsights(
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
  ): any[] {
    const insights: any[] = []

    let viewModelsCount = 0, composablesCount = 0, suspendCount = 0
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.metadata?.superTypes) {
        for (let j = 0; j < s.metadata.superTypes.length; j++) {
          if (s.metadata.superTypes[j] === "ViewModel") viewModelsCount++
        }
      }
      if (s.metadata?.annotations) {
        for (let j = 0; j < s.metadata.annotations.length; j++) {
          if (s.metadata.annotations[j] === "Composable") composablesCount++
        }
      }
      if (s.metadata?.modifiers) {
        for (let j = 0; j < s.metadata.modifiers.length; j++) {
          if (s.metadata.modifiers[j] === "suspend") suspendCount++
        }
      }
    }

    if (viewModelsCount > 0) {
      insights.push({
        type: "architecture",
        category: "android_mvvm",
        message: `Detected ${viewModelsCount} ViewModels, indicating MVVM architecture.`,
        severity: "info",
      })
    }

    if (composablesCount > 0) {
      insights.push({
        type: "ui_framework",
        category: "compose",
        message: `Jetpack Compose UI detected with ${composablesCount} composable functions.`,
        severity: "info",
      })
    }

    if (suspendCount > 0) {
      insights.push({
        type: "concurrency",
        category: "coroutines",
        message: `Coroutine usage detected with ${suspendCount} suspend functions.`,
        severity: "info",
      })
    }

    return insights
  }



  private calculateArchitecturalScore(
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    patterns: string[],
  ): number {
    let score = 80
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Jetpack Compose") score += 5
      if (patterns[i] === "Coroutines") score += 5
      if (patterns[i] === "Data Classes") score += 5
    }
    return Math.min(100, score)
  }

  private assessKotlinCodeQuality(
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    patterns: string[],
  ): string {
    const score = this.calculateArchitecturalScore(symbols, relationships, patterns)
    if (score >= 90) return "excellent"
    if (score >= 80) return "good"
    if (score >= 60) return "fair"
    return "poor"
  }
}
