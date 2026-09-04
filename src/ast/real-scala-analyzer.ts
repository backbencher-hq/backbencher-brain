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
    // real cyclomatic complexity, java-convention (0-based branch count)
    let cyclomaticComplexity = 0

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
      } else if (node.type === "lambda_expression") {
        patternsObj["Lambdas"] = true
      } else if (node.type === "self_type") {
        patternsObj["Self Types"] = true
      } else if (node.type === "context_bound") {
        patternsObj["Type Classes (Context Bounds)"] = true
      } else if (node.type === "infix_expression" || node.type === "infix_type") {
        patternsObj["Infix Notation"] = true
      } else if (node.type === "interpolated_string_expression" || node.type === "interpolated_string") {
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
      } else if (node.type === "using") {
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
        cyclomaticComplexity++
      } else if (node.type === "infix_expression") {
        const op = node.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") cyclomaticComplexity++
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
    // cross-language metric consistency (M14): complexity IS the cyclomatic
    // count (java convention), not a synthetic heuristic like the previous
    // symbols.length * 1.5.
    // +1 base: the walk counts raw decision points; stored metric is
    // textbook cyclomatic complexity (family contract).
    metadata.complexity = cyclomaticComplexity + 1
    metadata.cyclomaticComplexity = cyclomaticComplexity + 1

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
        // Confidence reflects EVIDENCE TIER (patterns.ts filters >= 0.7):
        // companion-resolved targets carry project-level evidence; the
        // per-file fallback is a first-supertype GUESS that may not even
        // declare the method.
        let confidence = 0.5
        let reasonCode = "first-supertype-guess"
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
            reasonCode = "companion-index"
          }
        }
        if (overrideParent) {
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${overrideParent}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence,
            metadata: { isOverride: true, overrideParent, reasonCode },
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

    // M14 #419 G1: rewrite import-reference sources from the placeholder
    // "root" to the file's primary top-level type so references carry a
    // symbol identity (imports precede declarations in source order) —
    // matching kotlin. Scoped to isImportDep edges only: top-level
    // declared-type refs also resolve to "root".
    const primaryType = symbols.find((s) => {
      if (s.ownerName) return false
      return s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Interface || s.kind === ASTEngine.SymbolKind.Enum || s.kind === ASTEngine.SymbolKind.Module
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && rel.source === "root" && rel.metadata?.isImportDep) {
          rel.source = primaryType.name
        }
      }
    }

    // Declared-type reference graph (M14): constructor params, val/var type
    // clauses, function params, return types, @throws annotations,
    // asInstanceOf/isInstanceOf targets. Absent until M14 — the corpus
    // oracle never checked it.
    this.collectDeclaredTypeRefs(rootNode, relationships)
    this.collectExpressionUses(rootNode, relationships)

    this.classifyEvidenceTier(relationships)

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
        (c.type === "identifier" || c.type === "type_identifier")
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

  /**
   * Annotation short names from a definition's modifiers (@Deprecated →
   * "Deprecated", @org.x.Transactional → "Transactional"). Previously
   * annotations were consumed only as pattern-flag substrings and symbols
   * carried no decorator data at all, unlike every sibling analyzer.
   */
  private collectAnnotations(node: Node): string[] {
    const out: string[] = []
    // Annotations appear BOTH as direct children of the definition AND
    // inside a modifiers wrapper depending on construct — scan both.
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type !== "annotation" && c.type !== "modifiers") continue
      const container = c.type === "annotation" ? null : c
      const sources: Node[] = container ? [container] : [c]
      for (const src of sources) {
        for (let j = 0; j < src.childCount; j++) {
          const ann = container ? src.child(j) : src
          if (!ann || ann.type !== "annotation") continue
          let nameNode: Node | null = null
          for (let k = 0; k < ann.namedChildCount; k++) {
            const nc = ann.namedChild(k)
            if (nc && (nc.type === "identifier" || nc.type === "type_identifier" || nc.type === "stable_type_identifier")) {
              nameNode = nc
              break
            }
          }
          if (nameNode) {
            const text = nameNode.text
            const dot = text.lastIndexOf(".")
            out.push(dot === -1 ? text : text.slice(dot + 1))
          }
          if (!container) break // direct annotation child: handled itself
        }
      }
    }
    return out
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

  /**
   * ScalaDoc extraction: a multiline_comment starting with '/**' immediately
   * preceding the declaration (previous sibling). Mirrors the kotlin KDoc
   * approach; previously scala symbols carried NO comments at all.
   */
  private extractScalaDoc(node: Node): string | undefined {
    const parent = node.parent
    if (!parent) return undefined
    for (let i = 0; i < parent.namedChildCount; i++) {
      const sibling = parent.namedChild(i)
      if (sibling === node) break
      // scala grammar types doc comments as block_comment (kotlin uses
      // multiline_comment - each grammar names them differently)
      if (sibling?.type === "block_comment" && sibling.text.startsWith("/**")) {
        return sibling.text
      }
    }
    return undefined
  }

  /**
   * Generic type-parameter extraction from type_parameters nodes
   * (`class Store[T]`, `def map[R](...)`). Previously scala symbols carried
   * NO generic information at all - silent absence (M14 #383 fix).
   */
  private extractScalaTypeParameters(node: Node): string[] {
    const tpNode = node.namedChildren.find((c: any) => c.type === "type_parameters")
    if (!tpNode) return []
    const out: string[] = []
    for (let i = 0; i < tpNode.namedChildCount; i++) {
      const c = tpNode.namedChild(i)
      if (c && /identifier|type_identifier|_parameter$/.test(c.type)) {
        out.push(c.text.trim())
      }
    }
    return out
  }

  private buildScalaCallPath(fnNode: Node): string {
    const parts: string[] = []
    let cur: Node | null = fnNode
    while (cur) {
      if (cur.type === "field_expression") {
        parts.unshift(cur.namedChild(cur.namedChildCount - 1)?.text ?? "")
        cur = cur.namedChild(0)
      } else if (cur.type === "call_expression") {
        cur = cur.namedChild(0) // descend into the called function: drop argument text
      } else {
        parts.unshift(cur.text)
        break
      }
    }
    return parts.filter(Boolean).join(".")
  }

  /**
   * Per-function cyclomatic complexity (1 + decision points) - java/kotlin
   * parity (M14 #301 prerequisite).
   */
  private calculateScalaFunctionComplexity(node: Node): number {
    let complexity = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "if_expression" ||
        n.type === "while_expression" ||
        n.type === "do_while_expression" ||
        n.type === "match_expression" ||
        n.type === "for_expression" ||
        n.type === "try_expression"
      ) {
        complexity++
      } else if (n.type === "infix_expression") {
        // Short-circuit operators are decision points (family contract).
        // Previously never counted on scala.
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") complexity++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Tiers: structural (grammar clauses, conf 1.0) | usage_contextual (calls,
   * field access, companion-apply idioms) | import_based | reference_qualified
   * | inferred (sub-1.0 resolutions). Applied centrally at end of analyze()
   * so no emission site can forget it.
   */
  /**
   * Declared-type reference graph (M14). References edges from the enclosing
   * function/class to every named type in a declaration position. Scala's
   * @throws[IO] annotation parses as generic_type("throws", [IO]) — the
   * "throws" name is skipped, its arguments become throws_type edges.
   */
  private collectDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()

    const collectTypeNames = (n: Node, out: string[]): void => {
      if (n.type === "type_identifier") {
        if (n.text !== "throws" && !out.includes(n.text)) out.push(n.text)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNames(c, out)
      }
    }

    const resolveSource = (start: Node): string => {
      let p: Node | null = start.type === "function_definition" || start.type === "function_declaration"
        ? start
        : start.parent
      while (p) {
        if (p.type === "function_definition" || p.type === "function_declaration") {
          const name = this.findChild(p, "identifier")
          if (name) return name.text
        }
        if (p.type === "class_definition" || p.type === "object_definition" || p.type === "trait_definition") {
          const name = this.findChild(p, "identifier")
          if (name) return name.text
        }
        p = p.parent
      }
      return "root"
    }

    const emit = (decl: Node, roots: Node[], kind: string, relType = "declared_type", sourceOverride?: string): void => {
      const source = sourceOverride ?? resolveSource(decl)
      for (const r of roots) {
        if (!r) continue
        const names: string[] = []
        collectTypeNames(r, names)
        for (const t of names) {
          const key = `${source}|${t}|${kind}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            metadata: { relationshipType: relType, declaredOn: decl.type },
          })
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "class_parameter":
        case "parameter": {
          emit(n, [n], n.type)
          break
        }
        case "val_definition":
        case "var_definition": {
          // Type clause = direct type children. The name identifier precedes
          // the type in this grammar, so no positional break; initializers
          // are call_expression/literal children and never match type nodes.
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && (/type$|_type$/.test(c.type) || c.type === "type_identifier")) roots.push(c)
          }
          if (roots.length) emit(n, roots, n.type)
          break
        }
        case "annotation": {
          // @throws[IO] — see function_definition note.
          const gt = this.findChild(n, "generic_type")
          if (gt && gt.namedChild(0)?.text === "throws") {
            const argsNode = this.findChild(gt, "type_arguments")
            if (argsNode) emit(n, [argsNode], "throws_annotation", "throws_type")
          }
          break
        }
        case "function_definition":
        case "function_declaration": {
          let sawParams = false
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "parameters") { sawParams = true; continue }
            // M14 #419 G5: tuple_type (and other *_type forms) in RETURN
            // position — def pair(): (Int, String) references Int and String.
            // M14.0.F6: "functional_type" was a dead literal — the pinned
            // tree-sitter-scala grammar names arrow types "function_type"
            // (probe-verified 2026-09: def pair(): (Int, String) => Int). It
            // was added here once and could never fire, silently dropping
            // arrow-type return references.
            if (c.type === "generic_type" || c.type === "type_identifier" || c.type === "function_type" || c.type === "tuple_type") {
              // @throws[IO] annotation type parses as generic_type("throws",
              // [IO]) and appears BEFORE parameters; skip "throws" itself,
              // emit its arguments as throws_type edges.
              if (!sawParams && c.namedChild(0)?.text === "throws") {
                const argsNode = this.findChild(c, "type_arguments")
                if (argsNode) emit(n, [argsNode], "throws_annotation", "throws_type")
                continue
              }
              // M14 #419 G5: tuple_type return refs carry declaredOn tuple_type
              // so the mutant pins the fix precisely.
              emit(n, [c], c.type === "tuple_type" ? "tuple_type" : (sawParams ? "return_type" : "annotation_type"), sawParams ? "return_type" : "declared_type")
            }
          }
          break
        }
        case "call_expression": {
          // x.asInstanceOf[T] / o.isInstanceOf[T] (call-shaped parses)
          const fn = n.childForFieldName?.("function")
          const fnText = fn ? fn.text : ""
          if (fnText.endsWith("asInstanceOf") || fnText.endsWith("isInstanceOf")) {
            const args = n.childForFieldName?.("arguments") || this.findChild(n, "type_arguments")
            if (args) emit(n, [args], fnText.endsWith("asInstanceOf") ? "cast_target" : "instanceof_check")
          }
          break
        }
        case "generic_function": {
          // x.asInstanceOf[T] / o.isInstanceOf[T] parse as generic_function
          // (field_expression + type_arguments), not call_expression.
          const fe = this.findChild(n, "field_expression")
          const tail = fe ? (fe.namedChild(fe.namedChildCount - 1)?.text ?? "") : ""
          if (tail === "asInstanceOf" || tail === "isInstanceOf") {
            const args = this.findChild(n, "type_arguments")
            if (args) emit(n, [args], tail === "asInstanceOf" ? "cast_target" : "instanceof_check", tail === "asInstanceOf" ? "cast_target" : "instanceof_check")
          }
          break
        }
        case "typed_pattern": {
          // M14 #419 G2: case p: Point — the pattern type is the LAST named
          // child (type_identifier / type form). Previously pattern types
          // were invisible; only the case-class param types emitted refs.
          const last = n.namedChild(n.namedChildCount - 1)
          if (last) emit(n, [last], "typed_pattern", "pattern_type")
          break
        }
        case "case_class_pattern": {
          // M14 #419 G2: case Point(a, b) — the constructor type is the
          // FIRST named child (type_identifier).
          const first = n.namedChild(0)
          if (first) emit(n, [first], "case_class_pattern", "pattern_type")
          break
        }
        case "derives_clause": {
          // M14 #419 G6: derives Show, Hashing — the clause references the
          // derived typeclasses; source is the enclosing declaration.
          emit(n, [n], "derives_clause", "derives_type")
          break
        }
        case "type_definition": {
          // M14 #419 G7: type Fn = (Int) => String — the alias references
          // its RHS types; source is the ALIAS name itself (not the
          // enclosing declaration). The alias's own type parameters are
          // bindings, not references.
          const tName = this.findChild(n, "type_identifier") ?? this.findChild(n, "identifier")
          if (tName) {
            const rhs: Node[] = []
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && c !== tName && c.type !== "type_parameters") rhs.push(c)
            }
            emit(n, rhs, "type_definition", "type_alias", tName.text)
          }
          break
        }
        case "self_type": {
          // M14 #419 G9: self: Service => — the self type is the LAST named
          // child; source is the enclosing trait/class.
          const last = n.namedChild(n.namedChildCount - 1)
          if (last) emit(n, [last], "self_type", "self_type")
          break
        }
        case "field_expression": {
          // M14 #419 G3: Foo.bar method values — a field_expression whose
          // receiver is a CAPITALIZED identifier is a type-qualified member
          // handle and references the type. Call positions (the function of
          // a call_expression, e.g. xs.map) are skipped — the call edge
          // carries them; lowercase receivers (h.value) are Uses (G8, in
          // collectExpressionUses). Package paths (com.foo.bar) start
          // lowercase and never match.
          const isCallFn = n.parent && n.parent.type === "call_expression" && n.parent.childForFieldName?.("function")?.id === n.id
          if (!isCallFn) {
            const recv = this.leftmostIdentifier(n)
            // The receiver is an `identifier` (Foo), NOT a type_identifier,
            // so the emit helper's collectTypeNames would never see it — push
            // the edge directly.
            if (recv && recv.text.length > 0 && recv.text.charCodeAt(0) >= 65 && recv.text.charCodeAt(0) <= 90) {
              const source = resolveSource(n)
              const key = `${source}|${recv.text}|field_expression`
              if (!emitted.has(key)) {
                emitted.add(key)
                relationships.push({
                  source,
                  target: recv.text,
                  type: ASTEngine.RelationshipType.References,
                  confidence: 0.95,
                  metadata: { relationshipType: "method_value", declaredOn: "field_expression" },
                })
              }
            }
          }
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  /**
   * M14 #419 G4/G8: expression-level Uses edges.
   * - interpolated_string_expression > interpolation: s"hi $name" USES the
   *   interpolated identifier (simple $name form — the direct identifier
   *   child). The ${expr} block form is expression-use territory (scala
   *   emits no expression-level uses by design — D1/D3 boundary).
   * - field_expression (non-call position): h.value reads/writes and nullary
   *   access xs.length USE the receiver — scala had no field-access uses
   *   collector (only extension methods emitted Uses), the family gap vs
   *   java/groovy/kotlin. Receiver-only: never guess method-vs-field (D3
   *   ruling). Call positions (xs.map(...)) are skipped — the call edge
   *   carries them; capitalized receivers (Foo.bar) are References (G3,
   *   collectDeclaredTypeRefs). Deduped per (source, target).
   */
  private collectExpressionUses(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()
    const resolveSource = (start: Node | null): string => {
      let p: Node | null = start && (start.type === "function_definition" || start.type === "function_declaration")
        ? start
        : start ? start.parent : null
      while (p) {
        if (p.type === "function_definition" || p.type === "function_declaration") {
          const name = this.findChild(p, "identifier")
          if (name) return name.text
        }
        if (p.type === "class_definition" || p.type === "object_definition" || p.type === "trait_definition" || p.type === "enum_definition") {
          const name = this.findChild(p, "identifier")
          if (name) return name.text
        }
        p = p.parent
      }
      return "root"
    }
    const emitUse = (n: Node, target: string): void => {
      if (!target) return
      const source = resolveSource(n.parent)
      const key = `${source}|${target}|uses`
      if (emitted.has(key)) return
      emitted.add(key)
      relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { relationshipType: "expression_use" },
      })
    }
    const walk = (n: Node): void => {
      if (n.type === "interpolation") {
        const id = n.namedChild(0)
        if (id && id.type === "identifier") emitUse(n, id.text)
      } else if (n.type === "field_expression") {
        const isCallFn = n.parent && n.parent.type === "call_expression" && n.parent.childForFieldName?.("function")?.id === n.id
        if (!isCallFn) {
          const recv = this.leftmostIdentifier(n)
          // Capitalized receivers are type references (G3) — never Uses.
          if (recv && recv.text.length > 0 && !(recv.text.charCodeAt(0) >= 65 && recv.text.charCodeAt(0) <= 90)) {
            emitUse(n, recv.text)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        // M14 #419 G1: isImportDep — the JVM-family tier bug (the classifier
        // ignored the flag, so every scala import edge was mislabeled
        // reference_qualified; kotlin/java/groovy now recognize their flags).
        md.evidenceClass = md.isImportDep ? "import_based" : "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements") {
        md.evidenceClass = conf >= 1 ? "structural" : "inferred"
        continue
      }
      if (t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }


  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    extraMetadata: any = {},
  ): ASTEngine.UniversalSymbol {
    const decorators = this.collectAnnotations(node)
    const kdoc = this.extractScalaDoc(node)
    return {
      name,
      kind,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
      id: `${parent ? parent.id + "." : ""}${name}`,
      parent: parent ? parent.name : undefined,
      ownerName: parent ? parent.name : undefined,
      visibility: this.getVisibility(node),
      parameters: extraMetadata.parameters,
      returnType: extraMetadata.returnType,
      decorators,
      comments: kdoc ? [kdoc] : [],
      // Hoisted top-level per family contract: the DB ingester reads
      // symbol.complexity (|| 1) for gravity scoring — leaving it only in
      // metadata left every scala symbol at complexity 1 in the index.
      complexity: extraMetadata.complexity,
      metadata: { ...extraMetadata, annotations: decorators },
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
      } else if (c.type === "generic_type") {
        // Prefer a dotted base (stable_type_identifier:
        // collection.mutable.ArrayBuffer[Int] -> full dotted name per
        // cross-language convention). Bare type_identifier alone would
        // drop qualified generic supertypes.
        let pushed = false
        for (let j = 0; j < c.childCount; j++) {
          const ch = c.child(j)
          if (ch && ch.type === "stable_type_identifier") {
            out.push(ch.text)
            pushed = true
            break
          }
        }
        if (!pushed) {
          for (let j = 0; j < c.childCount; j++) {
            const ch = c.child(j)
            if (ch && ch.type === "type_identifier") {
              out.push(ch.text)
              break
            }
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

    const typeParams = this.extractScalaTypeParameters(node)
    if (typeParams.length > 0) {
      symbol.genericParameters = typeParams
      symbol.metadata!.typeParameters = typeParams
    }

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i],
          // Scala: extends covers classes AND traits; first supertype =
          // extends is the documented convention (parenless class extends is
          // legal, so kotlin's ctor-invocation signal does not transfer).
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

    const typeParams = this.extractScalaTypeParameters(node)
    if (typeParams.length > 0) {
      symbol.genericParameters = typeParams
      symbol.metadata!.typeParameters = typeParams
    }

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i],
          // Scala: extends covers classes AND traits; first supertype =
          // extends is the documented convention (parenless class extends is
          // legal, so kotlin's ctor-invocation signal does not transfer).
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

    const typeParams = this.extractScalaTypeParameters(node)
    if (typeParams.length > 0) {
      symbol.genericParameters = typeParams
      symbol.metadata!.typeParameters = typeParams
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

    let extensionReceiverType: string | undefined
    {
      // index-loop idiom, consistent with every other traversal in this file
      let anc: Node | null = node.parent
      while (anc) {
        if (anc.type === "extension_definition") {
          for (let i = 0; i < anc.namedChildCount; i++) {
            const pc = anc.namedChild(i)
            if (!pc || pc.type !== "parameters") continue
            if (pc.namedChildCount > 0 && pc.namedChild(0)) {
              const p0 = pc.namedChild(0)!
              for (let j = 0; j < p0.namedChildCount; j++) {
                const tc = p0.namedChild(j)
                if (tc && /_type$|type_identifier/.test(tc.type)) {
                  extensionReceiverType = tc.text.replace(/\?$/, "")
                  break
                }
              }
            }
            break
          }
          break
        }
        if (/^(class|trait|object)_definition$/.test(anc.type)) break
        anc = anc.parent
      }
    }
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
        // Scala 3 extension methods: the receiver lives on the enclosing
        // extension_definition's parameters, NOT on the function node, and
        // the wrapper never becomes a parent symbol. Detect via ancestors.
        isExtension: !!extensionReceiverType,
        ...(extensionReceiverType ? {} : {}),
        complexity: this.calculateScalaFunctionComplexity(node),
      },
    )

    symbols.push(symbol)

    // function-level generics: def map[R](...) — attach post-push (#383)
    const fnTypeParams = this.extractScalaTypeParameters(node)
    if (fnTypeParams.length > 0) {
      symbol.genericParameters = fnTypeParams
      symbol.metadata!.typeParameters = fnTypeParams
    }

    if (extensionReceiverType && !isMethod) {
      relationships.push({
        source: name,
        target: extensionReceiverType,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { relationshipType: "scala_extension_method", isExtension: true },
      })
    }

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
    while (ancestor) {
      if (
        ancestor.type === "function_definition" ||
        ancestor.type === "function_declaration" ||
        ancestor.type === "lambda_expression" ||
        (ancestor.type === "block" && ancestor.parent?.type === "function_definition")
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
    if (typeNode.type === "generic_type") {
      typeName = this.extractSupertypes(typeNode)[0] || typeNode.text
    }
    // Scala renders type arguments with SQUARE brackets: List[(A, B)](args)
    // — targets must be clean base names, so strip bracketed type args in
    // both syntaxes iteratively (nested args List[(A[B], C)] need repeated
    // passes; the <> form arrives via generic_type nodes).
    let prevTypeName: string | undefined
    do {
      prevTypeName = typeName
      typeName = typeName.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim()
    } while (typeName !== prevTypeName)
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
      if (fnNode) {
        // Scala 3 quote/splice syntax ('{ ... }, 'Sym) and backtick literals:
        // callees beginning with a quote character are not method calls or
        // constructions. Previously they emitted bogus PascalCase
        // Instantiates edges on macro-heavy code (dotty compiler corpus).
        if (fnNode.text.startsWith("'") || fnNode.text.startsWith("`")) return
        // Matrix 1b payload: symbol-level qualified call list (#383).
        // Dotted path WITHOUT argument text (family contract with java):
        // raw fnNode.text embedded inner-call arguments on chains
        // (`db.list(user).map` was stored as "db.list(user).map").
        if (parent) {
          if (!parent.qualified_calls) parent.qualified_calls = []
          parent.qualified_calls.push(this.buildScalaCallPath(fnNode))
        }
        // Curried application wrapper: `self.add(1)(2)` parses as an outer
      // call_expression whose function is the inner call `self.add(1)`. The
      // inner call is visited separately by the walker and emits the correct
      // `calls → add` edge — emitting here too would produce the noise target
      // `self.add(1)` AND a duplicate `add` edge.
      if (fnNode.type === "call_expression") return
      let calledName = fnNode.text
      const isQualified = fnNode.type === "field_expression"
      if (isQualified) {
        // obj.method — the leaf identifier is the method name
        const kids: string[] = []
        for (let i = 0; i < fnNode.namedChildCount; i++) {
          const c = fnNode.namedChild(i)
          if (c && c.type === "identifier") kids.push(c.text)
        }
        calledName = kids.length > 0 ? kids[kids.length - 1] : calledName
      }
      // Top-level (script-style) calls have no enclosing symbol. Attributing
      // them to a "(script)" sentinel mirrors handleInstantiation — dropping
      // them silently hollowed out top-level call graphs.
      const sourceName = parent?.name ?? "(script)"
      if (calledName) {
        // Companion-apply construction idiom (Type(...)): in Scala, PascalCase
        // receiver-less calls ARE constructions (case-class/class companion
        // apply). MEASURED twice: M14.1 kept the heuristic (0.5% noise on the
        // scala3 60-file differential vs Java's removed 4.2% grails-core
        // fabrication); 2026-08 re-measure on a 300-file scala3 sample found
        // 1156 QUALIFIED PascalCase calls obj.Method() — enum-case/module
        // member accesses (LoadDestination.Jump, tpd.This), all fabricated
        // Instantiates when fed through the heuristic. Restriction: bare
        // Type(...) stays Instantiates; qualified obj.Method() emits Calls.
        const first = calledName.charCodeAt(0)
        const isCapitalized = first >= 65 && first <= 90
        // Same bracket-arg hygiene for companion-apply targets, iterative
        // for nested args: List[(A[B], C)](...) must target List.
        let prevCalled: string | undefined
        do {
          prevCalled = calledName
          calledName = calledName.replace(/\[[^\[\]]*\]/g, "").trim()
        } while (calledName !== prevCalled)
        if (isCapitalized && !isQualified) {
          relationships.push({
            source: sourceName,
            target: calledName,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.7,
            line_number: node.startPosition.row + 1,
            metadata: { isInstantiation: true },
          })
        } else {
          relationships.push({
            source: sourceName,
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
            // `D => Renamed` — local alias is the RHS, imported name is the
            // LHS. The imported segment MUST join the module path
            // (scala.collection.{immutable => im} imports
            // scala.collection.immutable) — dropping it truncated the
            // references edge target, same failure mode the as-form fix
            // below solved.
            const imported = sel.namedChild(0)
            const local = sel.namedChild(1)
            if (imported && local) {
              parts.push(imported.text)
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
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
    })
  }

  /**
   * M14 #419 G3/G8: the LEFTMOST identifier of a field_expression — for
   * a.b.c that is a (recursing through nested field_expressions); package
   * paths (com.foo.bar) yield com, so capitalized-receiver detection is
   * safe against package-qualified members.
   */
  private leftmostIdentifier(node: Node): Node | null {
    if (node.type === "identifier") return node
    const first = node.namedChild(0)
    return first ? this.leftmostIdentifier(first) : null
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
