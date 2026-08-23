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
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

export interface KotlinContext {
  content: string
  currentFile: string
  packageStack: string[]
  classStack: string[]
  importAliases: Map<string, string>
  annotations: Map<string, string[]>
}

export class RealKotlinAnalyzer implements ASTEngine.LanguageAnalyzer {
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

  analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext): ASTEngine.ParseResult {
    const ctx: KotlinContext = {
      content,
      currentFile: filePath,
      packageStack: [],
      classStack: [],
      importAliases: new Map(),
      annotations: new Map(),
    }

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
            // 1-based rows/columns, consistent with nodeToRange and every
            // other analyzer (was 0-based: error locations off-by-one).
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column + 1,
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
    this.extractSymbolsWithScoping(rootNode, ctx, symbols, content, undefined, relationships)

    // PHASE 2: Analyze Kotlin relationships (inheritance, data classes, sealed classes)
    this.analyzeRelationships(rootNode, relationships, symbols, ctx)

    // PHASE 3: Process import statements
    this.processImportsExports(rootNode, imports, exports)

    // Fallback text extraction for parser variations that omit field names
    // PHASE 4: Detect Kotlin frameworks (Android, Spring Boot, Ktor, etc.)
    const frameworks = this.detectKotlinFrameworks(content, symbols, imports)
    const patterns = this.detectKotlinPatterns(symbols, relationships, content)

    // ========================================================================
    // STAGE 3: PHANTOM SYMBOL INJECTION (Framework Heuristics)
    // Data-class generated members (componentN/copy/equals/hashCode/
    // toString) so calls resolving against them produce real call-graph
    // edges. Phantoms carry metadata.isPhantom and are excluded from
    // exports/override resolution downstream.
    // ========================================================================
    this.injectPhantomSymbols(rootNode, symbols, frameworks, ctx)

    // PHASE 5: Kotlin-specific analysis (nullability, coroutines, etc.)
    const typeInference = this.performKotlinTypeInference(symbols, relationships)

    // --- KOTLIN CALL GRAPH EXTRACTION ---
    // Walks the full AST and extracts caller→callee relationships from
    // call_expression nodes. Targets are built from the navigation structure
    // (receiver.selector); stdlib calls are filtered; PascalCase callees are
    // constructor calls → Instantiates (not Calls).
    try {
      const extractKotlinCalls = (n: Node) => {
        if (n.type === 'call_expression') {
          const callExpr = this.buildKotlinCallExpression(n)
          const targetName = callExpr
          const leaf = targetName.split(".").pop() || targetName
          // Exact-leaf stdlib filter applies ONLY to receiver-less global
          // calls (listOf(), println()). Qualified calls (list.add(...))
          // have a receiver: suppressing them by bare leaf name deleted real
          // in-project call edges whenever a user method shared a stdlib
          // name (add/map/first/last...) — M14.1 fix.
          const isQualified = targetName.includes(".")
          const isStdlib = this.kotlinStdlibExact.has(targetName) || (!isQualified && this.kotlinStdlibExact.has(leaf))
          if (targetName && targetName !== "print" && targetName !== "println" && !isStdlib) {
            let p: Node | null = n.parent
            let sourceName = "Global"
            while (p) {
              if (p.type === 'function_declaration') {
                const nameNode = this.findChildByType(p, ["simple_identifier", "type_identifier"])
                if (nameNode) sourceName = nameNode.text
                break
              }
              p = p.parent
            }
            const isPascal = leaf.length > 0 && leaf[0] >= "A" && leaf[0] <= "Z"
            // MEASURED (M14.2, Exposed corpus, 791 kotlin files): qualified
            // PascalCase calls are enum/member accesses, not constructions —
            // 158 occurrences (MySQL.ForShare(, case().When() ...) all
            // fabricated Instantiates edges (~6.5% of instantiation edges),
            // vs 2268 legitimate bare constructions. Restrict the
            // construction heuristic to receiver-less calls; qualified
            // PascalCase is a Calls edge.
            if (isPascal && !isQualified) {
              relationships.push({
                source: sourceName,
                target: leaf,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.7,
                metadata: { kotlinSpecific: true, isInstantiation: true },
              })
            } else {
              relationships.push({
                source: sourceName,
                target: leaf,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.7,
                metadata: { kotlinSpecific: true },
              })
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) extractKotlinCalls(child)
        }
      }
      extractKotlinCalls(rootNode)
    } catch (e) {
      // Graceful degradation
    }
    // --- END KOTLIN CALL GRAPH EXTRACTION ---

    // Add Contains + Overrides + DependsOn. `ownerName` is the enclosing type
    // name — NOT scope — so top-level declarations (no owner) never produce a
    // self-contain edge.
    // Pre-built type-index so the override parent lookup is O(1) per method
    // (no per-method symbol scans — the hot path stays linear).
    const typeIndex = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Interface) {
        if (!typeIndex.has(s.name)) typeIndex.set(s.name, s)
      }
    }
    for (const s of symbols) {
      const _owner = s.ownerName
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: { isContained: true },
        })
      }
      // Overrides: real methods with 'override' modifier, keyed by
      // owner-qualified method name → declaring-parent method name. The
      // parents come from the ENCLOSING CLASS's supertypes (a method symbol
      // does not carry them). Phantom/generated symbols are excluded (their
      // override targets are stdlib, not project symbols). The target is the
      // first ancestor in declaration order that actually declares the method
      // (companion index when provided); without context it falls back to the
      // first hierarchy parent — the deterministic per-file default.
      if (
        s.kind === ASTEngine.SymbolKind.Method &&
        s.ownerName &&
        !s.metadata?.isPhantom &&
        s.metadata?.modifiers?.includes?.("override")
      ) {
        const ownerSym = typeIndex.get(s.ownerName)
        const parents: string[] = ownerSym?.metadata?.superTypes ?? []
        let overrideParent = parents.length > 0 ? parents[0] : ""
        // Confidence reflects EVIDENCE TIER (patterns.ts filters >= 0.7):
        // companion-resolved targets carry project-level evidence; the
        // per-file fallback is a first-supertype GUESS that may not even
        // declare the method, so it must stay below the consumer threshold.
        let confidence = 0.5
        if (context?.overrideCompanion && parents.length > 0) {
          const declaring = findDeclaringParent(
            s.name,
            parents,
            context.overrideCompanion,
            (t) => typeIndex.get(t)?.metadata?.superTypes ?? [],
          )
          if (declaring) {
            overrideParent = declaring
            confidence = 0.9
          }
        }
        if (overrideParent) {
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${overrideParent}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence,
            metadata: { isOverride: true, overrideParent },
          })
        }
      }
    }
    for (const imp of imports) {
      relationships.push({
        source: "root",
        target: imp.module || "",
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        metadata: { isImportDep: true },
      })
    }

    // Rewrite import-reference sources from the placeholder "root" to the
    // file's primary top-level type so references carry a symbol identity
    // (imports precede declarations in source order).
    const primaryType = symbols.find((s) => {
      if (s.ownerName) return false
      return s.kind === ASTEngine.SymbolKind.Class ||
             s.kind === ASTEngine.SymbolKind.Interface ||
             s.kind === ASTEngine.SymbolKind.Enum
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && rel.source === "root") {
          rel.source = primaryType.name
        }
      }
    }

    for (let i = 0; i < symbols.length; i++) { const s = symbols[i]; if (!s.metadata?.isPhantom && s.visibility !== "private" && (!s.ownerName || s.ownerKind === ASTEngine.SymbolKind.Class)) { exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" }); } }
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
    symbols: ASTEngine.UniversalSymbol[],
    frameworks: string[],
    ctx: KotlinContext,
  ): void {
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      let hasData = false;
      // Data flag lives in metadata.modifiers (extractors store modifiers
      // there, not at the top level).
      const symModifiers: string[] = symbol.metadata?.modifiers ?? []
      for (let j = 0; j < symModifiers.length; j++) {
        if (symModifiers[j] === "data") { hasData = true; break }
      }
      if (symbol.kind === ASTEngine.SymbolKind.Class && hasData) {
        const properties: ASTEngine.UniversalSymbol[] = []
        for (let j = 0; j < symbols.length; j++) {
           const s = symbols[j]
           if (s.ownerName === symbol.name && s.kind === ASTEngine.SymbolKind.Property) properties.push(s)
        }

        for (let index = 0; index < properties.length; index++) {
          const prop = properties[index];
          symbols.push({
            name: `component${index + 1}`,
            kind: ASTEngine.SymbolKind.Method,
            scope: symbol.name,
            ownerName: symbol.name,
            modifiers: ["phantom", "data_class_generated", "operator"],
            range: symbol.range,
            parameters: [],
            returnType: prop.returnType || prop.type || "Any",
            metadata: { isPhantom: true },
          })
        }

        const copyParams: any[] = []
        for (let j = 0; j < properties.length; j++) {
           copyParams.push({ name: properties[j].name, type: properties[j].returnType || properties[j].type || "Any" })
        }

        symbols.push({
          name: "copy",
          kind: ASTEngine.SymbolKind.Method,
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
            kind: ASTEngine.SymbolKind.Method,
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
    symbols: ASTEngine.UniversalSymbol[],
    content: string,
    parentClass?: string,
    relationships?: ASTEngine.UniversalRelationship[],
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
            this.extractInterface(n, symbols, ctx, pClass)
          } else if (isEnum) {
            this.extractEnumClass(n, symbols, ctx, pClass)
          } else {
            this.extractClass(n, symbols, ctx, pClass)
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
          this.extractObject(n, symbols, ctx, pClass)
          break
        }
        case "property_declaration":
          this.extractProperty(n, symbols, ctx, pClass, relationships)
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
  private extractFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
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
    const apiContract = this.extractKotlinApiContract(node, ctx)
    const apiContractPath = apiContract.path
    const apiMethod = apiContract.method

    // function-level generics: fun <U> identity(x: U) — previously dropped
    const fnTypeParameters = this.extractTypeParameters(node, ctx)

    const symbol: ASTEngine.UniversalSymbol = {
      name: functionName,
      kind: parentClass ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
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
      genericParameters: fnTypeParameters.length > 0 ? fnTypeParameters : undefined,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        receiverType,
        apiMethod,
        isInline,
        isInfix,
        isOperator,
        isSuspend,
        isExtension,
        complexity: this.calculateFunctionComplexity(node, ctx),
        parameterCount: parameters.length,
        hasKDoc: !!kdoc,
        ...(fnTypeParameters.length > 0 ? { typeParameters: fnTypeParameters } : {}),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  /**
   * Spring mapping annotation extraction. Returns the route PATH ONLY and
   * the HTTP method separately: brain_symbol.api_contract_path is an exact
   * match key shared across languages (doc-engine queries
   * s.api_contract_path=?), so embedding "GET " into it breaks every
   * cross-language route join against analyzers that store bare paths.
   */
  private extractKotlinApiContract(node: Node, ctx: KotlinContext): { path?: string; method?: string } {
    // Two annotation shapes occur under the pinned kotlin wasm:
    //   a) modifiers > annotation > constructor_invocation > value_arguments
    //      (AST args available)
    //   b) the ENTIRE annotation collapsed into a leaf `modifiers` node whose
    //      text is '@GetMapping("/users")' - no annotation child exists.
    // Both must be handled or Spring/Ktor route paths silently vanish.
    const MAPPINGS = ["@GetMapping", "@PostMapping", "@PutMapping", "@DeleteMapping", "@PatchMapping", "@RequestMapping"]

    const candidates: { text: string; args?: Node }[] = []
    const modifiersNode = this.findChildByType(node, ["modifiers"])
    if (modifiersNode) {
      const stack: Node[] = [modifiersNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "annotation") candidates.push({ text: n.text, args: this.getValueArguments(n) })
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      if (candidates.length === 0 && modifiersNode.text.includes("Mapping")) {
        candidates.push({ text: modifiersNode.text })
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const mod = node.namedChild(i)
      if (mod?.type === "annotation") candidates.push({ text: mod.text, args: this.getValueArguments(mod) })
    }

    for (const { text, args } of candidates) {
      // Compare by AST-resolved SHORT name: fully-qualified annotations
      // (@org.springframework.web.bind.annotation.GetMapping) do not carry a
      // "@GetMapping" prefix in their raw text.
      const shortName = this.kotlinShortAnnotationName(text)
      const mapping = MAPPINGS.find((m) => shortName === m.slice(1))
      if (!mapping) continue

      const method = mapping.slice(1).replace("Mapping", "").toUpperCase()
      let path = "/"

      if (args && args.namedChildCount > 0) {
        if (mapping === "@RequestMapping") {
          let methodStr = "ANY"
          for (let j = 0; j < args.namedChildCount; j++) {
            const arg = args.namedChild(j)
            if (!arg) continue
            if (stringIncludes(arg.text, "method") && stringIncludes(arg.text, "RequestMethod.")) {
              const parts = arg.text.split(".")
              methodStr = parts[parts.length - 1]
            } else if (!stringIncludes(arg.text, "=")) {
              path = arg.text.split('"').join("")
            } else if (arg.text.startsWith("value")) {
              path = arg.text.split("=")[1].split('"').join("").trim()
            }
          }
          return { path, method: methodStr.toUpperCase() }
        }
        pathMatch_loop: {
          const first = args.namedChild(0)?.text?.split('"').join("") || "/"
          path = first || "/"
          break pathMatch_loop
        }
        return { path, method }
      }

      // leaf-modifier fallback: parse from raw text
      const afterName = text.slice(mapping.length)
      const quoted = afterName.match(/"([^"]*)"/)
      if (quoted) path = quoted[1]
      if (mapping !== "@RequestMapping") return { path, method }
      const reqMethod = afterName.match(/RequestMethod\.([A-Za-z]+)/)
      return { path, method: reqMethod ? reqMethod[1].toUpperCase() : "ANY" }
    }
    return {}
  }

  /**
   * Extract Kotlin class with data classes, sealed classes, and inner classes
   */
  private extractClass(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const className = nameNode.text
    const qualifiedName = this.buildQualifiedName(className, ctx, parentClass)

    // Extract modifiers
    const modifiers = this.extractModifiers(node, ctx)

    // Extract inheritance and interfaces
    const superTypes = this.extractSuperTypes(node, ctx)
    const superTypeKinds = this.extractSuperTypesWithKinds(node)

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

    const symbol: ASTEngine.UniversalSymbol = {
      name: className,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(node),
      // Scope = package + enclosing types, EXCLUDING this class's own name,
      // so a class is never a container of itself.
      scope: this.enclosingScope(ctx),
      visibility,
      isAbstract,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      comments: kdoc ? [kdoc] : [],
      metadata: {
        modifiers,
        // Short annotation names (last dotted segment) so framework pattern
        // detection matches fully-qualified annotations exactly like bare ones.
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        superTypes,
        superTypesAreConstructorCalls: superTypeKinds.map((s) => s.isConstructorCall),
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
  private extractObject(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
    const nameNode = this.findChildByType(node, ["type_identifier", "simple_identifier"])
    if (!nameNode) return

    const objectName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const superTypes = this.extractSuperTypes(node, ctx)
    const superTypeKinds = this.extractSuperTypesWithKinds(node)
    const annotations = this.extractAnnotations(node, ctx)

    const symbol: ASTEngine.UniversalSymbol = {
      name: objectName,
      kind: ASTEngine.SymbolKind.Class, // Using Class for objects
      range: this.nodeToRange(node),
      scope: this.enclosingScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        superTypes,
        superTypesAreConstructorCalls: superTypeKinds.map((s) => s.isConstructorCall),
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
  private extractProperty(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string, relationships?: ASTEngine.UniversalRelationship[]) {
    let ancestor = node.parent
    while (ancestor && ancestor.type !== "class_declaration" && ancestor.type !== "object_declaration" && ancestor.type !== "source_file") {
      if (ancestor.type === "function_declaration") return
      ancestor = ancestor.parent
    }

    const declarationNode = this.findChildByType(node, ["variable_declaration"])
    const nameNode = declarationNode
      ? this.findChildByType(declarationNode, ["simple_identifier", "type_identifier"])
      : this.findChildByType(node, ["simple_identifier", "type_identifier"])
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

    // Extension properties: `val String.lastChar: Char` — a user_type receiver
    // appears BEFORE the simple_identifier, exactly like extension functions.
    // Previously invisible: no isExtension marker, no relationship (M14.1 fix;
    // positional because the pinned kotlin wasm exposes zero named fields).
    let extensionReceiver: string | undefined
    {
      let receiverNode: any = undefined
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c?.type === "simple_identifier") break
        // Upstream grammar (>= wasm 2026-08) wraps the extension receiver in
        // a dedicated receiver_type node; older pinned builds exposed a bare
        // user_type. Both handled.
        if (
          c?.type === "receiver_type" ||
          c?.type === "user_type" ||
          c?.type === "nullable_type" ||
          c?.type === "type_identifier"
        ) {
          receiverNode = c
          break
        }
      }
      if (receiverNode) {
        const t = receiverNode.text
        extensionReceiver = t.endsWith("?") ? t.slice(0, -1) : t
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      name: propertyName,
      kind: ASTEngine.SymbolKind.Property,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      decorators: annotations,
      returnType: propertyType,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        propertyType,
        isVal,
        isVar,
        isLateInit,
        isConst,
        hasDelegate,
        hasCustomGetter: this.hasCustomGetter(node),
        hasCustomSetter: this.hasCustomSetter(node),
        ...(extensionReceiver ? { isExtension: true, extensionReceiver } : {}),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    if (extensionReceiver && relationships) {
      relationships.push({
        source: propertyName,
        target: extensionReceiver,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: {
          relationshipType: "kotlin_extension_property",
          isExtension: true,
        },
      })
    }
  }

  /**
   * Kotlin-specific framework detection
   */
  private detectKotlinFrameworks(
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
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

    // Annotation-driven detection: real-world files frequently use
    // fully-qualified annotations WITHOUT the corresponding import (conflict
    // avoidance, generated code). Imports alone missed every such file.
    // Names compared through metadata.annotations short names.
    const annotationNames = new Set<string>()
    for (let i = 0; i < symbols.length; i++) {
      const anns: string[] = symbols[i].metadata?.annotations ?? []
      for (let j = 0; j < anns.length; j++) annotationNames.add(anns[j])
    }
    const hasAnnotation = (...names: string[]) => names.some((n) => annotationNames.has(n))
    if (hasAnnotation("Service", "RestController", "Controller", "Repository", "Component", "SpringBootApplication")) {
      frameworks["Spring Boot"] = true
      frameworks["Spring Framework"] = true
    }
    if (hasAnnotation("Entity", "Table")) frameworks["Hibernate / JPA"] = true
    if (hasAnnotation("Dao", "Database")) frameworks["Room"] = true
    if (hasAnnotation("Composable")) frameworks["Jetpack Compose"] = true
    if (hasAnnotation("Test", "RunWith", "ExtendWith")) frameworks["JUnit"] = true

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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
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

  private extractKotlinParameters(node: Node, ctx: KotlinContext): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []

    let paramsNode = this.findChildByType(node, ["function_value_parameters"])
    if (!paramsNode) return parameters
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const paramNode = paramsNode.namedChild(i)
      if (paramNode && paramNode.type === "parameter") {
        const nameNode = this.findChildByType(paramNode, ["simple_identifier"])
        const typeNode = this.findChildByType(paramNode, ["user_type", "nullable_type", "type_identifier"])
        const defaultNode = this.findChildByType(paramNode, [
          "string_literal",
          "integer_literal",
          "real_literal",
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

  /**
   * Scope of a type declaration = package + ENCLOSING types, excluding the
   * declaration's own name (which has already been pushed onto classStack by
   * the time the extractor runs). A container must never contain itself.
   */
  private enclosingScope(ctx: KotlinContext): string {
    const enclosing = ctx.classStack.slice(0, ctx.classStack.length - 1)
    return [...ctx.packageStack, ...enclosing].join(".")
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

  // Additional helper methods (stubs for now)...
  /**
   * Kotlin Interface Extraction
   */
  private extractInterface(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string): void {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const interfaceName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const superTypes = this.extractSuperTypes(node, ctx)
    const superTypeKinds = this.extractSuperTypesWithKinds(node)
    const typeParameters = this.extractTypeParameters(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    const symbol: ASTEngine.UniversalSymbol = {
      name: interfaceName,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      scope: this.enclosingScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      isAbstract: true, // All interfaces are abstract
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        superTypes,
        superTypesAreConstructorCalls: superTypeKinds.map((s) => s.isConstructorCall),
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
  private extractEnumClass(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string): void {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const enumName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)
    const enumValues = this.extractKotlinEnumValues(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name: enumName,
      kind: ASTEngine.SymbolKind.Enum,
      range: this.nodeToRange(node),
      scope: this.enclosingScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        enumValues,
        valueCount: enumValues.length,
        hasEnumMethods: this.countMethods(node, ctx) > 0,
        isKotlinEnum: true,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    // Extract enum values as symbols with the enum_entry node range
    const enumBody = this.findChildByType(node, ["enum_class_body", "class_body"])
    const entryNodes: Node[] = []
    if (enumBody) {
      for (let i = 0; i < enumBody.namedChildCount; i++) {
        const c = enumBody.namedChild(i)
        if (c?.type === "enum_entry") entryNodes.push(c)
      }
    }
    for (let i = 0; i < enumValues.length; i++) {
      const enumValue = enumValues[i]
      const entryNode = entryNodes[i] ?? node
      symbols.push({
        name: enumValue,
        kind: ASTEngine.SymbolKind.EnumMember,
        range: this.nodeToRange(entryNode),
        scope: this.currentScope(ctx),
        visibility: "public",
        ownerName: enumName,
        ownerKind: ASTEngine.SymbolKind.Enum,
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
    symbols: ASTEngine.UniversalSymbol[],
    ctx: KotlinContext,
    parentClass?: string,
  ): void {
    const parameters = this.extractKotlinParameters(node, ctx)
    const modifiers = this.extractModifiers(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    const isPrimaryConstructor = node.type === "primary_constructor"
    const constructorProperties: Node[] = []
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

          const bindingKind = this.findChildByType(paramNode, ["binding_pattern_kind"])
          if (bindingKind && (bindingKind.text === "val" || bindingKind.text === "var")) {
            constructorProperties.push(paramNode)
          }
        }
      }
    }
    let hasDefaults = false;
    for (let i = 0; i < parameters.length; i++) {
      if (parameters[i].defaultValue !== undefined) { hasDefaults = true; break; }
    }

    const constructorName = "constructor"
    const symbol: ASTEngine.UniversalSymbol = {
      name: constructorName,
      kind: ASTEngine.SymbolKind.Constructor,
      range: this.nodeToRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      parameters,
      decorators: annotations,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        isPrimaryConstructor,
        parameterCount: parameters.length,
        hasDefaultParameters: hasDefaults,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    if (parentClass) {
      for (let i = 0; i < constructorProperties.length; i++) {
        const paramNode = constructorProperties[i]
        const nameNode = this.findChildByType(paramNode, ["simple_identifier"])
        const typeNode = this.findChildByType(paramNode, ["user_type", "nullable_type", "type_identifier"])
        const bindingKind = this.findChildByType(paramNode, ["binding_pattern_kind"])
        if (!nameNode || !bindingKind) continue

        symbols.push({
          name: nameNode.text,
          kind: ASTEngine.SymbolKind.Property,
          range: this.nodeToRange(paramNode),
          scope: this.currentScope(ctx),
          visibility: this.determineVisibility(this.extractModifiers(paramNode, ctx), ctx),
          ownerName: parentClass,
          ownerKind: ASTEngine.SymbolKind.Class,
          returnType: typeNode ? this.cleanKotlinType(typeNode.text) : undefined,
          metadata: {
            isVal: bindingKind.text === "val",
            isVar: bindingKind.text === "var",
            isConstructorProperty: true,
            kotlinSpecific: true,
          },
        })
      }
    }
  }

  /**
   * Kotlin Package Extraction
   */
  private extractPackage(node: Node, ctx: KotlinContext): void {
    // The package_header child is a dotted `identifier` node (e.g. "com.example.service")
    const packageNameNode = this.findChildByType(node, ["identifier", "simple_identifier", "type_identifier"])
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
  private extractAnnotation(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext): void {
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
    // The receiver of an extension function is the leading type child before
    // the function name (fun String.shout → receiver_type/user_type "String").
    // Upstream grammar wraps it in receiver_type; older builds expose a bare
    // user_type — both accepted.
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "simple_identifier") break
      if (
        c?.type === "receiver_type" ||
        c?.type === "user_type" ||
        c?.type === "nullable_type" ||
        c?.type === "type_identifier"
      ) {
        return this.cleanKotlinType(c.text)
      }
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

    // Collect ONLY this declaration's own annotations — those in its
    // `modifiers` child (or direct annotation children). A subtree walk would
    // leak member annotations into the container's decorators.
    const collect = (n: Node) => {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "annotation")) {
          annotations.push(c.text.startsWith("@") ? c.text.slice(1) : c.text)
        }
      }
    }
    if (node) {
      collect(node)
      const modifiersNode = this.findChildByType(node, ["modifiers"])
      if (modifiersNode) collect(modifiersNode)
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

      // KDoc is a multiline_comment in tree-sitter-kotlin (not "comment" —
      // that node type does not exist in this grammar; docstrings were
      // silently never extracted before M14.1).
      if (
        (sibling?.type === "multiline_comment" || sibling?.type === "line_comment") &&
        sibling.text.startsWith("/**")
      ) {
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
        n.type === "elvis_expression"
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
  /**
   * Extract the clean base type name of every supertype. A delegation_specifier
   * contains either a user_type directly (Repository<User>) or a
   * constructor_invocation (BaseService<User>()) wrapping one. The base name
   * strips type arguments and nullability so relationship targets are valid
   * symbol leaves (pool-worker's noise filter rejects targets containing <>).
   */
  private extractSuperTypes(node: Node, ctx: KotlinContext): string[] {
    return this.extractSuperTypesWithKinds(node).map((s) => s.name)
  }

  /**
   * Kotlin semantics (Kotlin docs, Inheritance): a supertype written with a
   * constructor invocation `Base()` is an extended CLASS; a bare type `Repo`
   * is an IMPLEMENTED interface. Position alone is wrong - a class whose
   * first (or only) supertype is an interface was labelled extends.
   */
  private extractSuperTypesWithKinds(node: Node): { name: string; isConstructorCall: boolean }[] {
    const out: { name: string; isConstructorCall: boolean }[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "delegation_specifier") {
        const invocation = this.findChildByType(c, ["constructor_invocation"])
        let userType = this.findChildByType(c, ["user_type"])
        if (!userType && invocation) userType = this.findChildByType(invocation, ["user_type"])
        if (userType) {
          out.push({ name: this.cleanKotlinBaseType(userType.text), isConstructorCall: !!invocation })
        }
      }
    }
    return out
  }

  /**
   * Reduce a (possibly generic/nullable) type to its base name:
   * "BaseService<User>" → "BaseService", "User?" → "User",
   * "Map<String, List<Int>>" → "Map".
   */
  private cleanKotlinBaseType(typeText: string): string {
    let t = typeText
    while (t.endsWith("?")) t = t.slice(0, -1)
    const lt = t.indexOf("<")
    if (lt !== -1) t = t.slice(0, lt)
    return t.trim()
  }

  /**
   * Kotlin Type Parameters Extraction
   */
  /**
   * Positional `value_arguments` lookup. The pinned kotlin wasm exposes
   * ZERO named fields (fieldCount=0), so every childForFieldName call in
   * this file returns undefined - this helper is the required fallback
   * for annotation/route argument extraction (M14.1).
   */
  private getValueArguments(node: Node): Node | undefined {
    // annotation > constructor_invocation > value_arguments: grandchild, so a
    // shallow lookup misses it. Recursive descent required.
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "value_arguments") return c
        stack.push(c)
      }
    }
    return undefined
  }

  private getCallFunctionName(node: Node): string | undefined {
    const fn = node.childForFieldName?.("function")
    if (fn) return fn.text
    const first = node.namedChild(0)
    return first && /identifier|navigation_expression|field_expression/.test(first.type) ? first.text : undefined
  }

  private extractTypeParameters(node: Node, ctx: KotlinContext): string[] {
    const typeParameters: string[] = []

    const typeParamList = this.findChildByType(node, ["type_parameters"])
    if (typeParamList) {
      for (let i = 0; i < typeParamList.namedChildCount; i++) {
        const typeParam = typeParamList.namedChild(i)
        if (typeParam?.type === "type_parameter") {
          // pinned wasm has no named fields: positional name extraction
          const paramName =
            typeParam.childForFieldName("name")?.text ||
            typeParam.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "type_identifier")?.text
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
      if (n.type === "function_declaration") {
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
      if (n.type === "property_declaration") {
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
    // The declared type lives inside the variable_declaration child
    // (property_declaration → variable_declaration → user_type).
    const declarationNode = this.findChildByType(node, ["variable_declaration"])
    const typeNode =
      this.findChildByType(node, ["user_type", "nullable_type", "function_type", "type_identifier"]) ||
      (declarationNode ? this.findChildByType(declarationNode, ["user_type", "nullable_type", "function_type", "type_identifier"]) : null)
    if (typeNode) {
      return this.cleanKotlinType(typeNode.text)
    }

    // Infer from the initializer: it may live inside variable_declaration
    // (with an initializer field) or as a literal/expression child directly
    // under the property node (e.g. `const val VERSION = 1`).
    const initializer =
      (declarationNode ? declarationNode.childForFieldName("initializer") : null) ||
      node.childForFieldName("initializer")
    if (initializer) {
      return this.inferKotlinTypeFromInitializer(initializer)
    }
    const LITERAL_TYPES = ["integer_literal", "real_literal", "string_literal", "character_literal", "boolean_literal", "call_expression"]
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && LITERAL_TYPES.indexOf(c.type) !== -1) {
        return this.inferKotlinTypeFromInitializer(c)
      }
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

      case "call_expression": {
        // A call like `"hi".shout(2)` has a navigation_expression child (the
        // callee path) plus a call_suffix (the arguments) — the arguments must
        // NOT leak into the callee name.
        const nav = this.findChildByType(node, ["navigation_expression"])
        if (nav) return this.buildKotlinNavigationExpression(nav)
        const functionName = this.findChildByType(node, ["simple_identifier", "identifier"])
        return functionName ? functionName.text : node.text.split("(")[0]
      }

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
  /**
   * Stdlib check for qualified_calls. EXACT matching only - the previous
   * substring loop classified any user call whose name merely CONTAINED a
   * builtin word (getUserById -> "get", runMigration -> "run") as stdlib,
   * silently emptying symbol.qualified_calls (M14.1 fix). Qualified calls are
   * suppressed only by full-name match or stdlib package prefix; unqualified
   * calls by exact leaf against the stdlib set + scope-function extras.
   */
  private isKotlinBuiltin(call: string): boolean {
    if (!call) return false
    for (const prefix of RealKotlinAnalyzer.stdlibPackagePrefixes) {
      if (call.startsWith(prefix)) return true
    }
    if (this.kotlinStdlibExact.has(call)) return true
    if (!call.includes(".")) {
      return RealKotlinAnalyzer.kotlinBuiltinExtras.has(call)
    }
    return false
  }

  private static readonly stdlibPackagePrefixes = [
    "kotlin.", "kotlinx.", "java.", "javax.", "android.", "androidx.",
  ]

  private static readonly kotlinBuiltinExtras: ReadonlySet<string> = new Set([
    "println", "print", "readLine", "require", "check", "error",
    "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
    "toString", "equals", "hashCode", "copy", "componentN",
    "repeat", "uppercase", "lowercase", "trim",
    "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
    "arrayOf", "emptyList", "emptyMap", "emptySet",
  ])

  /**
   * Exact stdlib names used by the call-graph filter (leaf-level). Operators
   * like plus/minus/times are deliberately excluded so in-file operator
   * overloads produce real Calls edges.
   */
  private kotlinStdlibExact: Set<string> = new Set([
    "println", "print", "readLine", "require", "check", "error",
    "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
    "toString", "equals", "hashCode", "copy", "componentN",
    "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
    "arrayOf", "emptyList", "emptyMap", "emptySet",
    "repeat", "uppercase", "lowercase", "trim", "startsWith", "endsWith",
    "contains", "substring", "map", "filter", "reduce", "fold", "forEach",
    "sorted", "sortedBy", "distinct", "first", "last", "add", "remove",
    "size", "isEmpty", "isNotEmpty", "put", "get", "getOrElse", "getOrDefault",
    "any", "all", "none", "count", "sum", "max", "min", "take", "drop",
  ])

  /**
   * Kotlin Annotation Name Extraction
   */
  private getKotlinAnnotationName(node: Node): string | undefined {
    // Direct name child (marker annotations, plain @Foo).
    const direct = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (direct) return `@${direct.text}`
    // Use-site annotations (@field:JvmField) wrap the name in a user_type.
    // Fully-qualified names (@org.x.Service) parse as user_type with MULTIPLE
    // identifier children IN ORDER (org, x, Service) - the short name is the
    // LAST segment; taking the first yielded '@org' and silently broke every
    // FQ-annotated declaration's name resolution.
    const userType = this.findChildByType(node, ["user_type"])
    if (userType) {
      let last: Node | null = null
      for (let i = 0; i < userType.namedChildCount; i++) {
        const c = userType.namedChild(i)
        if (c && (c.type === "type_identifier" || c.type === "simple_identifier")) last = c
      }
      if (last) return `@${last.text}`
    }
    return undefined
  }

  /**
   * Reduce raw annotation text to its short name: "@org.x.GetMapping(\"/u\")"
   * → "GetMapping". Decorators keep the raw source text; anything comparing
   * annotation NAMES must compare through this normalization.
   */
  private kotlinShortAnnotationName(raw: string): string {
    let t = raw.startsWith("@") ? raw.slice(1) : raw
    const paren = t.indexOf("(")
    if (paren !== -1) t = t.slice(0, paren)
    const dot = t.lastIndexOf(".")
    return dot === -1 ? t : t.slice(dot + 1)
  }

  /**
   * Kotlin Annotation Arguments Extraction
   */
  private extractKotlinAnnotationArguments(node: Node): string[] {
    const args: string[] = []
    const argsNode = this.getValueArguments(node)

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
    // Use-site targets like @field:, @get:, @set: are first-class AST nodes.
    const targetNode = this.findChildByType(node, ["use_site_target"])
    if (targetNode) {
      const text = targetNode.text
      return text.endsWith(":") ? text.slice(0, -1) : text
    }
    return undefined
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
  /**
   * Infer the type of a property from its initializer using the initializer
   * NODE TYPE — never by regex-testing its text. Kotlin literal nodes carry
   * their kind in the grammar: integer_literal, real_literal, float_literal,
   * string_literal, character_literal, boolean_literal, call_expression.
   */
  private inferKotlinTypeFromInitializer(initNode: Node): string {
    const text = initNode.text.trim()
    switch (initNode.type) {
      case "integer_literal":
        return text.endsWith("L") ? "Long" : "Int"
      case "real_literal":
        return text.endsWith("f") || text.endsWith("F") ? "Float" : "Double"
      case "float_literal":
        return "Float"
      case "string_literal":
        return "String"
      case "character_literal":
        return "Char"
      case "boolean_literal":
        return "Boolean"
      case "call_expression": {
        const callee = this.buildKotlinCallExpression(initNode)
        const name = callee.split(".").pop() || callee
        if (name === "listOf" || name === "emptyList") return "List<*>"
        if (name === "mutableListOf") return "MutableList<*>"
        if (name === "setOf" || name === "emptySet") return "Set<*>"
        if (name === "mapOf" || name === "emptyMap") return "Map<*, *>"
        if (name === "arrayOf") return "Array<*>"
        return name
      }
      default:
        return "Any"
    }
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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
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
        // Navigation-aware leaf extraction — qualified compose calls
        // (theme.MyScreen()) have no direct identifier child.
        const full = this.buildKotlinCallExpression(n)
        calls.push(full.split(".").pop() || full)
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
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    ctx: KotlinContext,
  ): void {
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!

      if (n.type === "function_declaration") {
        let receiverNode: any = undefined; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "simple_identifier") break; if (c?.type === "receiver_type" || c?.type === "user_type" || c?.type === "nullable_type" || c?.type === "type_identifier") { receiverNode = c; break; } }
        const nameNode = this.findChildByType(n, ["simple_identifier", "type_identifier"])
        if (receiverNode && nameNode) {
          const receiverType = receiverNode.text.endsWith("?") ? receiverNode.text.slice(0, -1) : receiverNode.text
          // Extension functions ADD members to a type but are NOT inheritance
          // (Kotlin docs: "extension functions do not modify the class").
          // Labelling them Extends fabricated false hierarchy edges on real
          // code (Exposed corpus). Uses with isExtension marker is honest.
          relationships.push({
            source: nameNode.text,
            target: receiverType,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            metadata: {
              relationshipType: "kotlin_extension_function",
              isExtension: true,
            },
          })
        }

        // Composable detection via AST-resolved short annotation names, not
        // raw-text substring: fully-qualified @androidx.compose.runtime.
        // Composable does not contain the literal "@Composable".
        const isComposable = this.extractAnnotations(n, ctx).some((a) => this.kotlinShortAnnotationName(a) === "Composable")
        if (isComposable && nameNode) {
          const bodyNode = this.findChildByType(n, ["function_body", "class_body"])
          if (bodyNode) {
            const bodyCalls = this.extractFunctionCalls(bodyNode)
            for (let i = 0; i < bodyCalls.length; i++) {
              const call = bodyCalls[i]
              if (call.length > 0 && call[0] >= "A" && call[0] <= "Z") {
                relationships.push({
                  source: nameNode.text,
                  target: call,
                  type: ASTEngine.RelationshipType.Contains,
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
        // Callee leaf via the navigation-aware builder: qualified calls
        // (scope.launch {}) wrap the callee in a navigation_expression and
        // have NO direct simple_identifier child — first-identifier lookup
        // silently missed every idiomatic dispatch.
        const full = this.buildKotlinCallExpression(n)
        const callName = full.split(".").pop() || ""
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
                type: ASTEngine.RelationshipType.Uses,
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
      if (cls.kind === ASTEngine.SymbolKind.Class || cls.kind === ASTEngine.SymbolKind.Interface) {
        if (cls.metadata?.superTypes) {
          const ctorCalls: boolean[] | undefined = cls.metadata?.superTypesAreConstructorCalls
          for (let j = 0; j < cls.metadata.superTypes.length; j++) {
            // Kotlin semantics: supertype with constructor invocation `Base()`
            // = extends (class); bare type `Repo` = implements (interface).
            // For interfaces, all supertypes are extends. Previously position
            // alone decided (j === 0), mislabelling interface-first classes.
            const isExtends =
              cls.kind === ASTEngine.SymbolKind.Interface || ctorCalls?.[j] === true
            relationships.push({
              source: cls.name,
              target: cls.metadata.superTypes[j],
              type: isExtends ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
              confidence: 1.0,
              metadata: { relationshipType: isExtends ? "kotlin_extends" : "kotlin_implements" },
            })
          }
        }
      }
    }
  }

  private processImportsExports(node: Node, imports: ASTEngine.ImportInfo[], exports: ASTEngine.ExportInfo[]): void {
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "import_header") {
        const pathNode = this.findChildByType(n, ["identifier"])
        if (pathNode) {
          const importPath = pathNode.text
          const aliasNode = this.findChildByType(n, ["import_alias"])
          // The pinned wasm serializes 'import x.y.*' as identifier="x.y"
          // PLUS a sibling wildcard_import node — the identifier text never
          // contains '.*', so a suffix test can never fire.
          const isWildcard = !!this.findChildByType(n, ["wildcard_import"])

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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): any {
    const inferences: Record<string, string> = {}
    let count = 0

    for (const sym of symbols) {
      if (sym.kind === ASTEngine.SymbolKind.Variable && !sym.returnType) {
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

  private getKotlinFrameworkPatterns(frameworks: string[], symbols: ASTEngine.UniversalSymbol[]): any[] {
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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): string {
    const score = this.calculateArchitecturalScore(symbols, relationships, patterns)
    if (score >= 90) return "excellent"
    if (score >= 80) return "good"
    if (score >= 60) return "fair"
    return "poor"
  }
}
