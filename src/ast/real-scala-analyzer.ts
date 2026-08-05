import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealScalaAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const exports: ASTEngine.ExportInfo[] = []

    const patternsObj: Record<string, boolean> = {}
    const frameworksObj: Record<string, boolean> = {}
    let hasTypes = false

    const metadata: Partial<ASTEngine.FileMetadata> = {
      linesOfCode: 0,
      complexity: 0,
      architecturalScore: 85,
      codeQuality: "excellent",
      hasTypeInference: false,
      hasFrameworkIntelligence: true,
      analysisVersion: "scala-1.0",
      detectedFrameworks: [],
      patterns: [],
    }

    if (!rootNode) return { symbols, imports, errors: [] }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!metadata.errors) metadata.errors = []
          metadata.errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: n.startPosition.row + 1, startColumn: n.startPosition.column + 1,
              endLine: n.endPosition.row + 1, endColumn: n.endPosition.column + 1,
              startIndex: n.startIndex, endIndex: n.endIndex,
            },
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    // Manually count loc
    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    const stack: { node: Node; parent: ASTEngine.UniversalSymbol | null }[] = [{ node: rootNode, parent: null }]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node, parent } = popped
      let currentParent = parent

      if (node.type === "class_definition") {
        const cls = this.handleClass(node, symbols, relationships, exports, patternsObj, parent)
        if (cls) currentParent = cls
      } else if (node.type === "object_definition") {
        const obj = this.handleObject(node, symbols, relationships, exports, parent)
        if (obj) currentParent = obj
      } else if (node.type === "trait_definition") {
        const tr = this.handleTrait(node, symbols, relationships, exports, patternsObj, parent)
        if (tr) currentParent = tr
      } else if (node.type === "function_definition") {
        const fn = this.handleFunction(node, symbols, relationships, exports, patternsObj, parent)
        if (fn) currentParent = fn
      } else if (node.type === "val_definition" || node.type === "var_definition") {
        this.handleVariable(node, symbols, exports, parent)
      } else if (node.type === "type_definition") {
        this.handleTypeAlias(node, symbols, parent)
      } else if (node.type === "import_declaration") {
        this.handleImport(node, imports)
      } else if (node.type === "match_expression") {
        patternsObj["Case Classes & Pattern Matching"] = true
      } else if (node.type === "for_expression") {
        patternsObj["For Comprehensions"] = true
      } else if (node.type === "type_identifier" || node.type === "type") {
        hasTypes = true
      } else if (node.type === "enum_definition") {
        const enumName = this.extractIdentifier(node, "name")
        if (enumName) {
          const sym = this.createSymbol(enumName, ASTEngine.SymbolKind.Enum, node, parent, { type: "enum", scala3: true })
          symbols.push(sym)
          currentParent = sym
          patternsObj["Scala 3 Enums"] = true
        }
      } else if (node.type === "extension_definition") {
        const extName = node.namedChild(1)?.text || `extension_${node.startPosition.row + 1}`
        const sym = this.createSymbol(extName, ASTEngine.SymbolKind.Function, node, parent, { isExtension: true, scala3: true })
        symbols.push(sym)
        currentParent = sym
      } else if (node.type === "export_declaration") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && (c.type === "identifier" || c.type === "namespace_wildcard" || c.type === "namespace_selectors")) {
            exports.push({ name: c.text, kind: ASTEngine.SymbolKind.Class })
          }
        }
      } else if (node.type === "given_definition") {
        patternsObj["Given/Using (Scala 3)"] = true
        patternsObj["Contextual Abstractions"] = true
      } else if (node.type === "annotation") {
        const annText = node.text
        if (annText.includes("main") || annText.includes("Test")) patternsObj["Annotations"] = true
        if (annText.includes("BeanProperty") || annText.includes("scala.beans")) patternsObj["Java Interop"] = true
        if (annText.includes("tailrec")) patternsObj["Tail Recursion"] = true
        if (annText.includes("specialized")) patternsObj["Specialized Generics"] = true
      } else if (node.type === "catch_clause") {
        patternsObj["Error Handling"] = true
      } else if (node.type === "lambda_expression" || node.type === "anonymous_function") {
        const lambdaName = `lambda_${node.startPosition.row + 1}_${node.startPosition.column + 1}`
        const sym = this.createSymbol(lambdaName, ASTEngine.SymbolKind.Function, node, parent, { isLambda: true })
        symbols.push(sym)
      } else if (node.type === "self_type") {
        patternsObj["Self Types"] = true
      } else if (node.type === "context_bound") {
        patternsObj["Type Classes (Context Bounds)"] = true
      } else if (node.type === "infix_expression" || node.type === "infix_type") {
        patternsObj["Infix Notation"] = true
      } else if (node.type === "string_interpolation" || node.type === "interpolation") {
        patternsObj["String Interpolation"] = true
      } else if (node.type === "derives_clause") {
        patternsObj["Derives (Typeclass Derivation)"] = true
      } else if (node.type === "package") {
        const pkgName = this.extractIdentifier(node, "name") || node.namedChild(0)?.text
        if (pkgName) {
          const sym = this.createSymbol(pkgName, ASTEngine.SymbolKind.Namespace, node, null, { isPackage: true })
          symbols.push(sym)
        }
      } else if (node.type === "package_object") {
        patternsObj["Package Objects"] = true
      } else if (node.type === "throw_expression" || node.type === "throw") {
        const thrown = node.namedChild(0)
        if (thrown) {
          relationships.push({
            source: parent?.name || "global",
            target: thrown.type === "call_expression" ? (thrown.childForFieldName?.("function")?.text || thrown.text) : thrown.text,
            type: ASTEngine.RelationshipType.References,
            metadata: { scalaSpecific: true, isThrow: true },
          })
        }
      } else if (node.type === "opaque_modifier") {
        patternsObj["Opaque Types (Scala 3)"] = true
      } else if (node.type === "inline_modifier" || node.type === "transparent_modifier") {
        patternsObj["Inline Methods (Scala 3)"] = true
      }
      if (node.type === "call_expression") {
        this.handleCall(node, relationships, patternsObj, parent)
      }

      if (node.type === "modifiers" || node.type === "parameters") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child && child.type === "implicit") {
            patternsObj["Implicit Parameters & Conversions"] = true
            patternsObj["Type Classes"] = true
          }
          if (child && child.type === "lazy") {
            patternsObj["Lazy Initialization"] = true
          }
          if (child && child.type === "override") {
            patternsObj["Override/Polymorphism"] = true
          }
          if (child && child.type === "using") {
            patternsObj["Using Clauses (Scala 3)"] = true
          }
        }
      }

      if (node.type === "if_expression" || node.type === "while_expression" || node.type === "do_while_expression" || node.type === "match_expression" || node.type === "for_expression" || node.type === "try_expression") {
        if (!metadata.cyclomaticComplexity) metadata.cyclomaticComplexity = 1
        metadata.cyclomaticComplexity++
      }

      if (node.type === "call_expression") {
        this.handleCall(node, relationships, patternsObj, parent)
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parent: currentParent })
        }
      }
    }

    this.detectFrameworks(imports, frameworksObj)
    this.detectCompanionObjects(symbols, patternsObj)

    metadata.hasTypeInference = hasTypes
    metadata.complexity = symbols.length * 1.5

    for (const fw in frameworksObj) metadata.detectedFrameworks!.push(fw)
    for (const pat in patternsObj) metadata.patterns!.push(pat)

    // Add Contains + DependsOn
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope; if (_owner) relationships.push({ source: _owner, target: s.name, type: ASTEngine.RelationshipType.Contains, confidence: 1.0, metadata: {} })
    }
    for (const imp of imports) {
      relationships.push({ source: "root", target: imp.module || "", type: ASTEngine.RelationshipType.References, confidence: 0.9, metadata: {} })
    }
    
    return {
      symbols,
      relationships,
      imports,
      exports,
      metadata,
      errors: metadata.errors || [],
    }
  }

  private detectFrameworks(imports: ASTEngine.ImportInfo[], frameworksObj: Record<string, boolean>) {
    for (let i = 0; i < imports.length; i++) {
      const source = imports[i].module
      if (!source) continue
      if (source.indexOf("play.api") !== -1) frameworksObj["Play Framework"] = true
      if (source.indexOf("akka") !== -1) frameworksObj["Akka"] = true
      if (source.indexOf("org.apache.spark") !== -1) frameworksObj["Apache Spark"] = true
    }
  }

  private detectCompanionObjects(symbols: ASTEngine.UniversalSymbol[], patternsObj: Record<string, boolean>) {
    const classNames: Record<string, boolean> = {}
    const objectNames: Record<string, boolean> = {}

    // First pass: index class and object names
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if (sym.kind === ASTEngine.SymbolKind.Class || sym.metadata?.isTrait) {
        classNames[sym.name] = true
      } else if (sym.metadata?.isObject) {
        objectNames[sym.name] = true
      }
    }

    // Second pass: link companion objects
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if ((sym.kind === ASTEngine.SymbolKind.Class || sym.metadata?.isTrait) && objectNames[sym.name]) {
        if (!sym.metadata) sym.metadata = {}
        sym.metadata.hasCompanionObject = true
        patternsObj["Companion Objects"] = true
      } else if (sym.metadata?.isObject && classNames[sym.name]) {
        if (!sym.metadata) sym.metadata = {}
        sym.metadata.isCompanionObject = true
        patternsObj["Companion Objects"] = true
      }

      if (sym.metadata?.isCaseClass) {
        if (!sym.metadata) sym.metadata = {}
        sym.metadata.hasCompanionObject = true // automatically has companion object
      }
    }
  }

  private extractIdentifier(node: Node, field: string): string | null {
    const child = node.childForFieldName(field)
    if (child) return child.text

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (
        c &&
        c.isNamed &&
        (c.type === "identifier" || c.type === "type_identifier" || c.type === "scoped_identifier")
      ) {
        return c.text
      }
    }
    return null
  }

  private getVisibility(node: Node): string {
    let modifiersNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "modifiers") {
        modifiersNode = c
        break
      }
    }
    if (modifiersNode) {
      for (let i = 0; i < modifiersNode.childCount; i++) {
        const mod = modifiersNode.child(i)
        if (mod && mod.type === "access_modifier") {
          const inner = mod.child(0)
          if (inner && (inner.type === "private" || inner.type === "protected")) return inner.type
        }
        if (mod && (mod.type === "private" || mod.type === "protected")) return mod.type
      }
    }
    return "public"
  }

  private isPublic(node: Node): boolean {
    return this.getVisibility(node) === "public"
  }

  private isSealed(node: Node): boolean {
    let modifiersNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "modifiers") {
        modifiersNode = c
        break
      }
    }
    if (modifiersNode) {
      for (let i = 0; i < modifiersNode.childCount; i++) {
        const mod = modifiersNode.child(i)
        if (mod && mod.type === "sealed") return true
      }
    }
    return false
  }

  private isCaseClass(node: Node): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "case") return true
    }
    return false
  }

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    extraMetadata: any = {},
  ): ASTEngine.UniversalSymbol {
    return {
      name,
      kind,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
      id: `${parent ? parent.id + "." : ""}${name}`,
      parent: parent ? parent.name : undefined,
      ownerName: parent ? parent.name : undefined,
      visibility: this.getVisibility(node),
      parameters: extraMetadata.parameters,
      returnType: extraMetadata.returnType,
      metadata: { ...extraMetadata },
    }
  }

  private handleClass(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const isCase = this.isCaseClass(node)
    const isSealed = this.isSealed(node)
    let isAbstract = false
    let isFinal = false
    let isImplicit = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "modifiers") {
        for (let j = 0; j < c.namedChildCount; j++) {
          const m = c.namedChild(j)
          if (m && m.type === "abstract") isAbstract = true
          if (m && m.type === "final") isFinal = true
          if (m && m.type === "implicit") isImplicit = true
        }
      }
    }

    let classParamsNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "class_parameters") {
        classParamsNode = c
        break
      }
    }

    const constructorParams: string[] = []
    if (classParamsNode) {
      for (let i = 0; i < classParamsNode.childCount; i++) {
        const c = classParamsNode.child(i)
        if (c && c.type === "class_parameter") {
          let pName = c.childForFieldName("name")?.text
          if (!pName) {
            for (let j = 0; j < c.childCount; j++) {
              const ch = c.child(j)
              if (ch && ch.type === "identifier") {
                pName = ch.text
                break
              }
            }
          }
          if (pName) constructorParams.push(pName)
        }
      }
    }

    if (isSealed) patternsObj["Sealed Types"] = true

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Class, node, parent, {
      type: "class",
      isObject: false,
      isCaseClass: isCase,
      isSealed,
      isAbstract,
      isFinal,
      isImplicit,
      constructorParams: constructorParams.length > 0 ? constructorParams : undefined,
    })
    symbols.push(symbol)

    if (isImplicit) patternsObj["Implicit Classes (Extension Methods)"] = true

    if (this.isPublic(node)) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Class,
        range: symbol.range,
      })
    }

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "extends_clause") {
        this.traceInheritance(c, symbol, relationships, ASTEngine.RelationshipType.Extends)
        break
      }
    }

    return symbol
  }

  private handleObject(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const isCase = this.isCaseClass(node) // case object
    const isSealed = this.isSealed(node)

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Module, node, parent, {
      type: "object",
      isObject: true,
      isCaseObject: isCase,
      isSealed,
      scalaSpecific: true,
      isStatic: true,
    })

    ;(symbol as any).isStatic = true

    symbols.push(symbol)

    if (this.isPublic(node)) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Module,
        range: symbol.range,
      })
    }

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "extends_clause") {
        this.traceInheritance(c, symbol, relationships, ASTEngine.RelationshipType.Extends)
        break
      }
    }

    return symbol
  }

  private handleTrait(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const isSealed = this.isSealed(node)
    if (isSealed) patternsObj["Sealed Types"] = true

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Interface, node, parent, {
      type: "trait",
      isTrait: true,
      scalaSpecific: true,
      isSealed,
    })
    symbols.push(symbol)

    if (this.isPublic(node)) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Interface,
        range: symbol.range,
      })
    }

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "extends_clause") {
        this.traceInheritance(c, symbol, relationships, ASTEngine.RelationshipType.Extends)
        break
      }
    }

    return symbol
  }

  private traceInheritance(
    extendsClause: Node,
    sourceSymbol: ASTEngine.UniversalSymbol,
    relationships: ASTEngine.UniversalRelationship[],
    relType: ASTEngine.RelationshipType,
  ): void {
    let isFirst = true
    for (let i = 0; i < extendsClause.childCount; i++) {
      const c = extendsClause.child(i)
      if (!c) continue
      let typeName: string | null = null
      if (c.type === "type_identifier" || c.type === "identifier") {
        typeName = c.text
      } else if (c.type === "generic_type") {
        for (let j = 0; j < c.childCount; j++) {
          const ch = c.child(j)
          if (ch && ch.type === "type_identifier") {
            typeName = ch.text
            break
          }
        }
      }

      if (typeName) {
        relationships.push({
          source: sourceSymbol.name,
          target: typeName,
          type: isFirst ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
          metadata: {
            isTrait: !isFirst,
          },
        })
        isFirst = false
      }
    }
  }

  private handleTypeAlias(node: Node, symbols: ASTEngine.UniversalSymbol[], parent: ASTEngine.UniversalSymbol | null) {
    const name = this.extractIdentifier(node, "name")
    if (!name) return

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Type, node, parent, { isTypeAlias: true })
    symbols.push(symbol)
  }

  private handleFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const isMethod =
      parent &&
      (parent.metadata?.type === "class" ||
        parent.metadata?.type === "trait" ||
        parent.metadata?.type === "object" ||
        parent.kind === ASTEngine.SymbolKind.Class ||
        parent.kind === ASTEngine.SymbolKind.Interface ||
        parent.kind === ASTEngine.SymbolKind.Module)

    const parameters: ASTEngine.Parameter[] = []
    let returnType: string | undefined = undefined

    let numParamsLists = 0
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "parameters") {
        numParamsLists++
        let hasImplicit = false
        for (let j = 0; j < child.namedChildCount; j++) {
          const paramChild = child.namedChild(j)
          if (paramChild && paramChild.type === "implicit") {
            hasImplicit = true
            break
          }
        }
        for (let j = 0; j < child.namedChildCount; j++) {
          const paramNode = child.namedChild(j)
          if (paramNode && paramNode.type === "parameter") {
            const paramName = paramNode.childForFieldName("name")?.text || ""
            const paramType = paramNode.childForFieldName("type")?.text || ""
            parameters.push({
              name: paramName,
              type: paramType,
              isImplicit: hasImplicit
            })
          }
        }
      }
    }

    const returnTypeNode = node.childForFieldName("return_type") || node.childForFieldName("type")
    if (returnTypeNode) {
      returnType = returnTypeNode.text
    }

    const symbol = this.createSymbol(
      name,
      isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
      node,
      parent,
      {
        type: "function",
        parameters: parameters.length > 0 ? parameters : undefined,
        returnType
      },
    )

    symbols.push(symbol)

    if (this.isPublic(node) && !isMethod) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Function,
        range: symbol.range,
      })
    }

    let numParams = numParamsLists
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.isNamed && (child.type === "parameters" || child.type === "type" || child.type === "type_identifier")) {
        const nestedStack = [child]
        while (nestedStack.length > 0) {
          const p = nestedStack.pop()
          if (!p) continue
          if (p.type === "type_identifier" || p.type === "identifier") {
            relationships.push({
              source: symbol.name,
              target: p.text,
              type: ASTEngine.RelationshipType.Uses,
              metadata: {},
            })
          }
          for (let j = p.childCount - 1; j >= 0; j--) {
            const c = p.child(j)
            if (c && c.isNamed) nestedStack.push(c)
          }
        }
      }
    }

    if (numParams > 1) {
      patternsObj["Currying"] = true
    }

    if (name === "apply") patternsObj["Factory Pattern (apply)"] = true
    if (name === "unapply" || name === "unapplySeq") patternsObj["Extractor Pattern (unapply)"] = true

    return symbol
  }

  private handleVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
    parent: ASTEngine.UniversalSymbol | null,
  ): void {
    let patternNode = node.childForFieldName("pattern")
    if (!patternNode) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.isNamed && child.type === "identifier") {
          patternNode = child
          break
        }
      }
    }
    if (!patternNode) return

    const name = patternNode.text
    const kind = node.type === "val_definition" ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable
    const symbol = this.createSymbol(name, kind, node, parent, { type: node.type })
    symbols.push(symbol)

    if (this.isPublic(node) && !parent) {
      exports.push({
        name,
        kind: kind,
        range: symbol.range,
      })
    }
  }

  private handleCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ) {
    const fnNode = node.childForFieldName("function")
    if (fnNode && parent) {
      let calledName = fnNode.text
      if (fnNode.type === "field_expression") {
        const field = fnNode.childForFieldName("field")
        if (field) calledName = field.text
      }
      if (calledName) {
        relationships.push({
          source: parent.name,
          target: calledName,
          type: ASTEngine.RelationshipType.Calls,
          metadata: {},
        })
        if (calledName[0] === calledName[0].toUpperCase() && calledName[0] !== calledName[0].toLowerCase()) {
          relationships.push({
            source: parent.name,
            target: calledName,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.7,
            metadata: { isInstantiation: true },
          })
        }
        if (["map", "filter", "flatMap", "foreach", "fold", "reduce", "collect"].includes(calledName)) {
          patternsObj["Higher-Order Functions"] = true
          patternsObj["Functional Programming"] = true
        }
      }
    }

    const fieldNode = fnNode || node.namedChild(0)
    if (fieldNode && fieldNode.type === "field_expression") {
      const field = fieldNode.childForFieldName("field")
      if (field && ["map", "filter", "flatMap", "foreach", "fold", "reduce", "collect"].includes(field.text)) {
        patternsObj["Higher-Order Functions"] = true
        patternsObj["Functional Programming"] = true
      }
    }
  }

  private handleImport(node: Node, imports: ASTEngine.ImportInfo[]): void {
    if (node.type !== "import_declaration") return

    let pathStr = ""
    const selectors: { local: string; imported: string }[] = []

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "identifier" || child.type === ".") {
        pathStr += child.text
      } else if (child.type === "namespace_wildcard") {
        selectors.push({ local: "*", imported: "*" })
        pathStr += ".*"
      } else if (child.type === "namespace_selectors") {
        for (let j = 0; j < child.childCount; j++) {
          const sel = child.child(j)
          if (sel && sel.type === "identifier") {
            selectors.push({ local: sel.text, imported: sel.text })
          }
        }
      }
    }

    if (pathStr.length > 0 && pathStr.charCodeAt(pathStr.length - 1) === 46) {
      // '.'
      pathStr = pathStr.substring(0, pathStr.length - 1)
    }

    if (selectors.length === 0) {
      let last = "*"
      for (let i = pathStr.length - 1; i >= 0; i--) {
        if (pathStr.charCodeAt(i) === 46) {
          // '.'
          last = pathStr.substring(i + 1)
          break
        }
      }
      if (last === "*") last = pathStr
      selectors.push({ local: last, imported: last })
    }

    imports.push({
      module: pathStr,
      specifiers: selectors,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
    })
  }
}
