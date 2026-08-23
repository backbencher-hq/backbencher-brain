import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

export class RealScalaAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
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
      analysisVersion: "scala-2.0",
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

    // ─────────────────────────────────────────────────────────────────────
    // Type-index for O(1) owner lookups during the relationship post-pass.
    // Container kinds: class / trait(interface) / object(module) / enum /
    // given — exactly the symbol kinds that can own members.
    // ─────────────────────────────────────────────────────────────────────
    const typeIndex = new Map<string, ASTEngine.UniversalSymbol>()
    const indexType = (s: ASTEngine.UniversalSymbol) => {
      if (!typeIndex.has(s.name)) typeIndex.set(s.name, s)
    }

    // ─────────────────────────────────────────────────────────────────────
    // Single-pass traversal. `parent` is the enclosing symbol (class/trait/
    // object/enum/given); ownership comes from it, so top-level declarations
    // (no parent) never produce self-contain edges. handleCall runs exactly
    // once per call_expression (the previous double-invocation produced
    // duplicate calls/instantiates edges).
    // ─────────────────────────────────────────────────────────────────────
    const stack: { node: Node; parent: ASTEngine.UniversalSymbol | null }[] = [{ node: rootNode, parent: null }]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node, parent } = popped
      let currentParent = parent

      if (node.type === "package_clause") {
        // package com.example.service — namespace marker only (no symbol,
        // matching the Java/Kotlin contract where packages are not symbols).
        const pkgChildren: string[] = []
        const walkPkg = (n: Node) => {
          if (n.type === "identifier") pkgChildren.push(n.text)
          for (let i = 0; i < n.namedChildCount; i++) {
            const ch = n.namedChild(i)
            if (ch) walkPkg(ch)
          }
        }
        walkPkg(node)
        if (pkgChildren.length > 0) {
          metadata.packageName = pkgChildren.join(".")
          patternsObj["Packages"] = true
        }
      } else if (node.type === "class_definition") {
        const cls = this.handleClass(node, symbols, relationships, exports, patternsObj, parent)
        if (cls) { currentParent = cls; indexType(cls) }
      } else if (node.type === "object_definition") {
        const obj = this.handleObject(node, symbols, relationships, exports, patternsObj, parent)
        if (obj) { currentParent = obj; indexType(obj) }
      } else if (node.type === "trait_definition") {
        const tr = this.handleTrait(node, symbols, relationships, exports, patternsObj, parent)
        if (tr) { currentParent = tr; indexType(tr) }
      } else if (node.type === "function_definition" || node.type === "function_declaration") {
        // function_declaration = abstract method (trait signatures, e.g.
        // `def save(item: T): T`). The old analyzer only handled
        // function_definition, silently dropping every abstract trait method.
        const fn = this.handleFunction(node, symbols, relationships, exports, patternsObj, parent)
        if (fn) currentParent = fn
      } else if (node.type === "val_definition" || node.type === "var_definition") {
        this.handleVariable(node, symbols, exports, parent)
      } else if (node.type === "type_definition") {
        this.handleTypeAlias(node, symbols, parent)
      } else if (node.type === "import_declaration") {
        this.handleImport(node, imports)
      } else if (node.type === "enum_definition") {
        const en = this.handleEnum(node, symbols, relationships, exports, patternsObj, parent)
        if (en) { currentParent = en; indexType(en) }
      } else if (node.type === "given_definition") {
        const g = this.handleGiven(node, symbols, relationships, patternsObj, parent)
        if (g) { currentParent = g; indexType(g) }
      } else if (node.type === "extension_definition") {
        // Scala 3 extension: `extension (s: String) { def shout(...) }`.
        // The extension wrapper itself is NOT a symbol — its inner
        // function_definitions are the extension methods and are emitted by
        // the generic function handler below (parent unchanged, so they stay
        // top-level functions unless the extension is nested in a type).
        patternsObj["Extension Methods (Scala 3)"] = true
      } else if (node.type === "export_declaration") {
        patternsObj["Exports (Scala 3)"] = true
      } else if (node.type === "match_expression") {
        patternsObj["Case Classes & Pattern Matching"] = true
      } else if (node.type === "for_expression") {
        patternsObj["For Comprehensions"] = true
      } else if (node.type === "type_identifier" || node.type === "type") {
        hasTypes = true
      } else if (node.type === "annotation") {
        const annText = node.text
        if (annText.includes("main") || annText.includes("Test")) patternsObj["Annotations"] = true
        if (annText.includes("BeanProperty") || annText.includes("scala.beans")) patternsObj["Java Interop"] = true
        if (annText.includes("tailrec")) patternsObj["Tail Recursion"] = true
        if (annText.includes("specialized")) patternsObj["Specialized Generics"] = true
      } else if (node.type === "catch_clause") {
        patternsObj["Error Handling"] = true
      } else if (node.type === "lambda_expression" || node.type === "anonymous_function") {
        patternsObj["Lambdas"] = true
      } else if (node.type === "self_type") {
        patternsObj["Self Types"] = true
      } else if (node.type === "context_bound") {
        patternsObj["Type Classes (Context Bounds)"] = true
      } else if (node.type === "infix_expression" || node.type === "infix_type") {
        patternsObj["Infix Notation"] = true
      } else if (node.type === "interpolated_string_expression" || node.type === "interpolated_string" || node.type === "string_interpolation") {
        patternsObj["String Interpolation"] = true
      } else if (node.type === "derives_clause") {
        patternsObj["Derives (Typeclass Derivation)"] = true
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
      } else if (node.type === "using_clause" || node.type === "using") {
        patternsObj["Using Clauses (Scala 3)"] = true
      } else if (node.type === "implicit") {
        patternsObj["Implicit Parameters & Conversions"] = true
      } else if (node.type === "lazy") {
        patternsObj["Lazy Initialization"] = true
      } else if (node.type === "override") {
        patternsObj["Override/Polymorphism"] = true
      }

      if (node.type === "call_expression") {
        this.handleCall(node, relationships, patternsObj, parent)
      } else if (node.type === "instance_expression") {
        // `new Type(...)` — constructor invocation. In v0.26.2 the grammar
        // models this as instance_expression (type_identifier + arguments),
        // NOT a call_expression wrapping it, so the old analyzer missed every
        // constructor. Emit instantiates from the enclosing symbol.
        this.handleInstantiation(node, relationships, parent)
      }

      if (node.type === "if_expression" || node.type === "while_expression" || node.type === "do_while_expression" || node.type === "match_expression" || node.type === "for_expression" || node.type === "try_expression") {
        if (!metadata.cyclomaticComplexity) metadata.cyclomaticComplexity = 1
        metadata.cyclomaticComplexity++
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

    // ─────────────────────────────────────────────────────────────────────
    // Relationship post-pass (matches the Kotlin/Java contract):
    //   contains    owner → member
    //   overrides   real methods with 'override' modifier → declaring parent
    //   references  imports → root
    // ─────────────────────────────────────────────────────────────────────
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
      if (
        s.kind === ASTEngine.SymbolKind.Method &&
        s.ownerName &&
        !s.metadata?.isPhantom &&
        s.metadata?.isOverride
      ) {
        const ownerSym = typeIndex.get(s.ownerName)
        const parents: string[] = ownerSym?.metadata?.superTypes ?? []
        let overrideParent = parents.length > 0 ? parents[0] : ""
        if (context?.overrideCompanion && parents.length > 0) {
          const declaring = findDeclaringParent(
            s.name,
            parents,
            context.overrideCompanion,
            (t) => typeIndex.get(t)?.metadata?.superTypes ?? [],
          )
          if (declaring) overrideParent = declaring
        }
        if (overrideParent) {
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${overrideParent}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.9,
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

  /** Collect modifiers (sealed/abstract/final/case/implicit/override/etc). */
  private collectModifiers(node: Node): Set<string> {
    const mods = new Set<string>()
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "modifiers") {
        for (let j = 0; j < c.childCount; j++) {
          const m = c.child(j)
          if (m) mods.add(m.type)
        }
      } else {
        mods.add(c.type) // case / sealed / etc. as direct unnamed children
      }
    }
    return mods
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

  /** Extract supertypes from an extends_clause (direct type children in v0.26.2). */
  private extractSupertypes(extendsClause: Node): string[] {
    const out: string[] = []
    for (let i = 0; i < extendsClause.childCount; i++) {
      const c = extendsClause.child(i)
      if (!c || !c.isNamed) continue
      if (c.type === "type_identifier" || c.type === "identifier") {
        out.push(c.text)
      } else if (c.type === "stable_type_identifier") {
        // dotted parents like js.Object / scala.Any: keep FULL dotted name
        // (cross-language convention decided in M14.1)
        out.push(c.text)
      } else if (c.type === "generic_type" || c.type === "applied_type") {
        for (let j = 0; j < c.childCount; j++) {
          const ch = c.child(j)
          if (ch && ch.type === "type_identifier") {
            out.push(ch.text)
            break
          }
        }
      } else if (c.type === "compound_type") {
        for (let j = 0; j < c.namedChildCount; j++) {
          const ch = c.namedChild(j)
          if (ch && (ch.type === "type_identifier" || ch.type === "generic_type")) {
            out.push(ch.type === "type_identifier" ? ch.text : this.extractSupertypes(ch)[0] || ch.text)
          }
        }
      }
    }
    return out
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

    const mods = this.collectModifiers(node)
    const isCase = this.isCaseClass(node)
    const isSealed = mods.has("sealed")
    const isAbstract = mods.has("abstract")
    const isFinal = mods.has("final")
    const isImplicit = mods.has("implicit")

    // Constructor parameters: emit a constructor symbol + property symbols
    // for val/var params (case class params are implicitly val).
    const classParamsNode = this.findChild(node, "class_parameters")
    const constructorParams: string[] = []
    if (classParamsNode) {
      const ctor = this.createSymbol("constructor", ASTEngine.SymbolKind.Constructor, classParamsNode, null, {
        type: "constructor",
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Class,
        scalaSpecific: true,
      })
      // ownerName must point at the class so contains resolves
      ctor.ownerName = name
      symbols.push(ctor)

      for (let i = 0; i < classParamsNode.namedChildCount; i++) {
        const cp = classParamsNode.namedChild(i)
        if (cp?.type !== "class_parameter") continue
        const pName = cp.childForFieldName("name")?.text
        if (!pName) continue
        constructorParams.push(pName)
        const pMods = this.collectModifiers(cp)
        const isVal = pMods.has("val")
        const isVar = pMods.has("var")
        if (isVal || isVar || isCase) {
          // val/var constructor params and case class params are real fields
          const prop = this.createSymbol(pName, ASTEngine.SymbolKind.Property, cp, null, {
            type: isVar ? "var" : "val",
            isConstructorProperty: true,
            ownerName: name,
            ownerKind: ASTEngine.SymbolKind.Class,
            isCaseClassParam: isCase,
          })
          prop.ownerName = name
          symbols.push(prop)
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

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i],
          type: i === 0 ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
          line_number: extendsClause.startPosition.row + 1,
          metadata: { isTrait: i > 0 },
        })
      }
    }

    return symbol
  }

  private handleObject(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const mods = this.collectModifiers(node)
    const isCase = this.isCaseClass(node)
    const isSealed = mods.has("sealed")

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

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i],
          type: i === 0 ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
          line_number: extendsClause.startPosition.row + 1,
          metadata: { isTrait: i > 0 },
        })
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

    const mods = this.collectModifiers(node)
    const isSealed = mods.has("sealed")
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

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i],
          type: ASTEngine.RelationshipType.Extends, // trait supertypes: ALL are extends
          line_number: extendsClause.startPosition.row + 1,
          metadata: { isTrait: i > 0 },
        })
      }
    }

    return symbol
  }

  private handleEnum(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Enum, node, parent, { type: "enum", scala3: true })
    symbols.push(symbol)
    patternsObj["Scala 3 Enums"] = true

    if (this.isPublic(node)) {
      exports.push({ name, kind: ASTEngine.SymbolKind.Enum, range: symbol.range })
    }

    // Enum cases: simple_enum_case (`case Red`) and full_enum_case
    // (`case Red extends Color(0xff0000)` / `case B(val x: Int) extends E`).
    const walkEnumBody = (n: Node) => {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "simple_enum_case" || c.type === "full_enum_case") {
          const caseName = this.findChildIdentifier(c)
          if (caseName) {
            const member = this.createSymbol(caseName, ASTEngine.SymbolKind.EnumMember, c, symbol, {
              type: "enum_case",
              ownerName: name,
              ownerKind: ASTEngine.SymbolKind.Enum,
              scala3: true,
            })
            member.ownerName = name
            symbols.push(member)
          }
        } else {
          walkEnumBody(c)
        }
      }
    }
    const enumBody = this.findChild(node, "enum_body")
    if (enumBody) walkEnumBody(enumBody)

    return symbol
  }

  private handleTypeAlias(node: Node, symbols: ASTEngine.UniversalSymbol[], parent: ASTEngine.UniversalSymbol | null) {
    const name = this.extractIdentifier(node, "name")
    if (!name) return

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Type, node, parent, { isTypeAlias: true })
    symbols.push(symbol)
  }

  private handleGiven(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    patternsObj["Given/Using (Scala 3)"] = true
    patternsObj["Contextual Abstractions"] = true

    const explicitName = this.findChildIdentifier(node)
    const name = explicitName || `given_${node.startPosition.row + 1}`

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Constant, node, parent, {
      type: "given",
      isGiven: true,
      scala3: true,
      anonymous: !explicitName,
    })
    symbols.push(symbol)
    return symbol
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

    const mods = this.collectModifiers(node)
    const isAbstract = node.type === "function_declaration" || mods.has("abstract")
    const isOverride = mods.has("override")
    const isImplicit = mods.has("implicit")
    const isInline = mods.has("inline_modifier") || mods.has("transparent_modifier")

    const parameters: ASTEngine.Parameter[] = []
    let returnType: string | undefined = undefined

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "parameters") {
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
              isImplicit: hasImplicit,
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
        returnType,
        isAbstract,
        isOverride,
        isImplicit,
        isInline,
        isExtension: parent?.type === "extension_definition",
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
    // Skip LOCAL variables inside function bodies (val/var declared in a
    // method/extension/lambda body are not project-level symbols — matches
    // the Kotlin contract where `val store` inside `createService()` is not
    // emitted). Class-level and top-level val/var ARE emitted.
    let ancestor = node.parent
    while (ancestor && ancestor.type !== "source_file") {
      if (
        ancestor.type === "function_definition" ||
        ancestor.type === "function_declaration" ||
        ancestor.type === "lambda_expression" ||
        ancestor.type === "anonymous_function" ||
        ancestor.type === "block" && ancestor.parent?.type === "function_definition"
      ) {
        return
      }
      if (
        ancestor.type === "class_definition" ||
        ancestor.type === "trait_definition" ||
        ancestor.type === "object_definition" ||
        ancestor.type === "enum_definition"
      ) {
        break
      }
      ancestor = ancestor.parent
    }

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

  private handleInstantiation(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
  ) {
    // instance_expression :: type_identifier | arguments  (v0.26.2)
    // Top-level constructions (no enclosing symbol) are attributed to the
    // "(script)" sentinel rather than silently dropped - matches the
    // kotlin/groovy script-attribution convention (M14.1).
    const sourceName = parent?.name ?? "(script)"
    const typeNode = node.namedChild(0)
    if (!typeNode) return
    let typeName = typeNode.text
    if (typeNode.type === "generic_type" || typeNode.type === "applied_type") {
      typeName = this.extractSupertypes(typeNode)[0] || typeNode.text
    }
    if (typeName && typeName !== "unknown") {
      relationships.push({
        source: sourceName,
        target: typeName,
        type: ASTEngine.RelationshipType.Instantiates,
        confidence: 0.9,
        line_number: typeNode.startPosition.row + 1,
        metadata: { isInstantiation: true },
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
        // Scala 3 quote/splice syntax ('{ ... }, 'Sym) and backtick literals:
        // callees beginning with a quote character are not method calls or
        // constructions. Previously they emitted bogus PascalCase
        // Instantiates edges on macro-heavy code (dotty compiler corpus).
        if (fnNode.text.startsWith("'") || fnNode.text.startsWith("`")) return
        // Curried application wrapper: `self.add(1)(2)` parses as an outer
      // call_expression whose function is the inner call `self.add(1)`. The
      // inner call is visited separately by the walker and emits the correct
      // `calls → add` edge — emitting here too would produce the noise target
      // `self.add(1)` AND a duplicate `add` edge.
      if (fnNode.type === "call_expression") return
      let calledName = fnNode.text
      if (fnNode.type === "field_expression") {
        // obj.method — the leaf identifier is the method name
        const kids: string[] = []
        for (let i = 0; i < fnNode.namedChildCount; i++) {
          const c = fnNode.namedChild(i)
          if (c && c.type === "identifier") kids.push(c.text)
        }
        calledName = kids.length > 0 ? kids[kids.length - 1] : calledName
      }
      if (calledName) {
        // Companion-apply constructor idiom (Type(...)) — capitalized target
        // emits ONLY Instantiates (matches the Kotlin contract: a capitalized
        // call like `User(...)` is an instantiation, not a plain call).
        const first = calledName.charCodeAt(0)
        const isCapitalized = first >= 65 && first <= 90
        if (isCapitalized) {
          relationships.push({
            source: parent.name,
            target: calledName,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.7,
            line_number: node.startPosition.row + 1,
            metadata: { isInstantiation: true },
          })
        } else {
          relationships.push({
            source: parent.name,
            target: calledName,
            type: ASTEngine.RelationshipType.Calls,
            line_number: node.startPosition.row + 1,
            metadata: {},
          })
        }
        if (["map", "filter", "flatMap", "foreach", "fold", "reduce", "collect"].includes(calledName)) {
          patternsObj["Higher-Order Functions"] = true
          patternsObj["Functional Programming"] = true
        }
      }
    }
  }

  private handleImport(node: Node, imports: ASTEngine.ImportInfo[]): void {
    if (node.type !== "import_declaration") return

    const parts: string[] = []
    const selectors: { local: string; imported: string }[] = []

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "identifier" || child.type === ".") {
        if (child.type === "identifier") parts.push(child.text)
      } else if (child.type === "namespace_wildcard") {
        selectors.push({ local: "*", imported: "*" })
      } else if (child.type === "namespace_selectors") {
        for (let j = 0; j < child.childCount; j++) {
          const sel = child.child(j)
          if (!sel) continue
          if (sel.type === "identifier") {
            selectors.push({ local: sel.text, imported: sel.text })
          } else if (sel.type === "arrow_renamed_identifier") {
            // `D => Renamed` — local alias is the RHS, imported name is the LHS
            const imported = sel.namedChild(0)
            const local = sel.namedChild(1)
            if (imported && local) {
              selectors.push({ local: local.text, imported: imported.text })
            }
          }
        }
      } else if (child.type === "as_renamed_identifier") {
        // `Z as W` — the module path keeps the ORIGINAL segment (`x.y.Z`),
        // the alias is the local name. Losing `Z` truncated the module path
        // and broke the references edge for renamed imports.
        const original = child.namedChild(0)
        const alias = child.namedChild(1)
        if (original && original.type === "identifier") {
          parts.push(original.text)
          selectors.push({ local: alias && alias.type === "identifier" ? alias.text : original.text, imported: original.text })
        }
      }
    }

    const pathStr = parts.join(".")

    if (selectors.length === 0) {
      let last = "*"
      if (pathStr.length > 0) {
        const idx = pathStr.lastIndexOf(".")
        last = idx >= 0 ? pathStr.substring(idx + 1) : pathStr
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

  private findChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === type) return c
    }
    return null
  }

  private findChildIdentifier(node: Node): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.isNamed && c.type === "identifier") return c.text
    }
    return null
  }
}
