import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
}

interface CleanContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  // Every function/method name declared in this file (module-level functions
  // + class/instance method names), collected by a pre-pass so unqualified
  // calls resolve even to LATER-defined functions (forward references).
  declaredFunctions: Set<string>
  functionSymbolIndex: Record<string, number>
  // Module name set by the module declaration; module-level symbols get
  // ownerName = module so the post-loop emits module → member contains edges.
  currentModule: string | undefined
  currentFunction: string | undefined
  seenRels: Set<string>
}

export class RealCleanAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, fileContent: string, filePath: string): ASTEngine.ParseResult {
    const ctx: CleanContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      declaredFunctions: new Set(),
      functionSymbolIndex: {},
      currentModule: undefined,
      currentFunction: undefined,
      seenRels: new Set(),
    }
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean; restoreFn?: string }[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    // Pre-pass: collect declared function/method names (forward references).
    this.collectDeclaredFunctions(rootNode, ctx.declaredFunctions)

    while (stack.length > 0) {
      const { node, isExit, restoreFn } = stack.pop()!

      if (isExit) {
        if (restoreFn !== undefined) ctx.currentFunction = restoreFn
        else if (node.type === "function_declaration" || node.type === "type_definition" || node.type === "class_declaration" || node.type === "instance_declaration") {
          ctx.currentFunction = undefined
        }
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) scopeStack.pop()
        continue
      }

      if (node.isMissing) continue

      if (node.hasError) {
        if (node.type === "ERROR") {
          ctx.errors.push({
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
      }

      // Complexity — the v1.2.4 grammar's emitted decision points.
      if (node.type === "case_expression" || node.type === "case_alternative" || node.type === "guard" || node.type === "binary_expression") {
        cyclomaticComplexity++
      }

      let pushedScope = false
      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

      // Pattern marking
      if (node.type === "list_comprehension") ctx.patterns["List Comprehensions"] = true
      if (node.type === "case_expression") ctx.patterns["Pattern Matching"] = true

      if (node.type === "module_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "module_name")
        if (nameNode) {
          const name = this.assembleModuleName(nameNode)
          ctx.currentModule = name
          ctx.symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            metadata: { cleanSpecific: true },
          })
        }
      } else if (node.type === "import_declaration") {
        this.processImport(node, ctx)
      } else if (node.type === "type_definition") {
        pushedScope = this.processTypeDefinition(node, ctx, scopeStack)
      } else if (node.type === "class_declaration") {
        pushedScope = this.processClass(node, ctx, scopeStack)
      } else if (node.type === "instance_declaration") {
        pushedScope = this.processInstance(node, ctx, scopeStack)
      } else if (node.type === "function_declaration") {
        const localScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const insideLocalBlock = localScope?.kind === ASTEngine.SymbolKind.Namespace
        if (!insideLocalBlock) {
          pushedScope = this.processFunction(node, ctx, currentScope, scopeStack)
        } else {
          // Where-local function: scoped noise — its internals attribute to
          // nothing (M11.11 closure boundary).
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          ctx.currentFunction = undefined
          scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace })
        }
      } else if (node.type === "type_signature") {
        // Record the signature for return-type metadata; the function symbol
        // comes from the function_declaration. Class member signatures are
        // already Method symbols from the class_member → type_signature path
        // (handled in processClass via signature_name).
        const sigName = this.findChild(node, (n) => n.type === "signature_name")
        const typeFn = this.findChild(node, (n) => n.type === "type_function")
        if (sigName?.text && typeFn?.text) {
          ctx.patterns["Typed Functions"] = true
        }
        continue
      } else if (node.type === "class_member" || node.type === "instance_member") {
        // Members are processed via their inner type_signature /
        // function_declaration children during the walk.
      } else if (node.type === "application") {
        this.extractApplication(node, ctx)
      } else if (node.type === "case_alternative") {
        // Pattern-position constructors are NOT calls/instantiates; the
        // alternative body's applies are walked as children.
        ctx.patterns["Pattern Matching"] = true
      } else if (node.type === "lambda_expression") {
        ctx.patterns["Higher-Order Functions"] = true
      } else if (node.type === "where_block") {
        // where-locals: scoped noise.
        scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace })
        pushedScope = true
      }

      if (pushedScope) stack.push({ node, isExit: true })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    // Post-loop: contains for owned symbols — module → members, type →
    // constructors/fields, class/instance → methods. Self-named edges skipped.
    for (const s of ctx.symbols) {
      const _owner = s.ownerName
      if (_owner && _owner !== s.name) {
        this.pushRel(ctx, _owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {})
      }
    }

    // Exports: all module-level symbols (Clean has no export keyword; the
    // module definition list governs, and everything is public by default).
    const EXPORTABLE_KINDS = new Set([
      ASTEngine.SymbolKind.Function,
      ASTEngine.SymbolKind.Type,
      ASTEngine.SymbolKind.Interface,
      ASTEngine.SymbolKind.Class,
      ASTEngine.SymbolKind.Module,
      ASTEngine.SymbolKind.Constructor,
      ASTEngine.SymbolKind.Property,
    ])
    for (const sym of ctx.symbols) {
      if (!sym.name.startsWith("_") && EXPORTABLE_KINDS.has(sym.kind) && !sym.ownerName) {
        ctx.exports.push({ name: sym.name, kind: sym.kind, range: sym.range, visibility: "public" })
      }
    }

    const patterns: string[] = []
    for (const p in ctx.patterns) patterns.push(p)

    return {
      language: "clean",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: fileContent.split("\n").length,
        cyclomaticComplexity,
        patterns,
        hasTypeInference: true,
        analysisVersion: "11.0.0-clean-pure-ast",
      },
    }
  }

  // ==========================================================================
  // Relationship emission (dedupe by source|type|target identity).
  // ==========================================================================
  private pushRel(
    ctx: CleanContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any> = {},
  ) {
    const key = `${source}|${type}|${target}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    ctx.relationships.push({ source, target, type, confidence, metadata })
  }

  // ==========================================================================
  // Pre-pass: declared function/method names (forward-reference resolution).
  // ==========================================================================
  private collectDeclaredFunctions(node: Node, out: Set<string>): void {
    if (node.type === "function_declaration") {
      const id = this.findChild(node, (n) => n.type === "identifier")
      if (id?.text) out.add(id.text)
      return
    }
    if (node.type === "type_signature") {
      const name = this.findChild(node, (n) => n.type === "signature_name")
      if (name?.text) out.add(name.text)
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) this.collectDeclaredFunctions(child, out)
    }
  }

  // module_name children compose dotted names (Data.Map → Data + "." + Map)
  private assembleModuleName(node: Node): string {
    let out = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      const leaf = c.type === "module_name" ? this.assembleModuleName(c) : c.text
      if (out) out += "."
      out += leaf
    }
    return out || node.text
  }

  private processImport(node: Node, ctx: CleanContext) {
    const modules = node.childrenForFieldName("module")
    const aliasNode = node.childForFieldName("alias")
    const alias = aliasNode ? this.assembleModuleName(aliasNode) : undefined
    const isQualified = node.children.some((child) => child !== null && child.type === "qualified")
    for (const modNode of modules) {
      if (!modNode) continue
      const modName = this.assembleModuleName(modNode)
      ctx.imports.push({
        module: modName,
        source: modName,
        items: [],
        isTypeOnly: false,
        range: this.nodeToRange(node),
        metadata: { cleanSpecific: true, isQualified, alias },
      })
      this.pushRel(ctx, ctx.currentModule || "", modName, ASTEngine.RelationshipType.References, 1.0, {
        cleanSpecific: true,
        isImportDependency: true,
      })
      if (modName.indexOf("StdEnv") !== -1) ctx.patterns["Standard Environment"] = true
    }
  }

  private processTypeDefinition(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const nameNode = this.findChild(node, (n) => n.type === "constructor")
    if (!nameNode?.text) return false
    const name = nameNode.text
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true },
    })

    // ADT constructors → Constructor symbols owned by the type. The grammar
    // nests them under type_definition_body → data_constructors.
    const typeBody = this.findChild(node, (n) => n.type === "type_definition_body")
    const ctorContainer = typeBody ? this.findChild(typeBody, (n) => n.type === "data_constructors") : null
    const ctorNodes = ctorContainer
      ? this.filterChildren(ctorContainer, (n) => n.type === "data_constructor")
      : this.filterChildren(node, (n) => n.type === "data_constructor")
    for (const cNode of ctorNodes) {
      const cName = this.findChild(cNode, (n) => n.type === "constructor")
      if (!cName?.text) continue
      ctx.symbols.push({
        name: cName.text,
        kind: ASTEngine.SymbolKind.Constructor,
        range: this.nodeToRange(cNode),
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Type,
        visibility: "public",
        metadata: { cleanSpecific: true, isADTConstructor: true },
      })
    }

    // Record fields → Property symbols owned by the type. The grammar nests
    // record_definition under type_definition_body.
    const recordDef =
      this.findChild(node, (n) => n.type === "record_definition") ||
      (typeBody ? this.findChild(typeBody, (n) => n.type === "record_definition") : null)
    if (recordDef) {
      for (let i = 0; i < recordDef.namedChildCount; i++) {
        const rf = recordDef.namedChild(i)
        if (!rf || rf.type !== "record_field") continue
        const fieldId = this.findChild(rf, (n) => n.type === "identifier")
        if (!fieldId?.text) continue
        ctx.symbols.push({
          name: fieldId.text,
          kind: ASTEngine.SymbolKind.Property,
          range: this.nodeToRange(rf),
          ownerName: name,
          ownerKind: ASTEngine.SymbolKind.Type,
          visibility: "public",
          metadata: { cleanSpecific: true, isRecordField: true },
        })
      }
    }

    ctx.patterns["Algebraic Data Types"] = true
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Type })
    return true
  }

  private processClass(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const nameNode = this.findChild(node, (n) => n.type === "class_name")
    if (!nameNode?.text) return false
    const name = nameNode.text
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true },
    })
    // Class member signatures → Method symbols owned by the interface.
    // Shape: class_member → type_signature → signature_name → identifier.
    for (let i = 0; i < node.namedChildCount; i++) {
      const member = node.namedChild(i)
      if (!member || member.type !== "class_member") continue
      const sig = this.findChild(member, (n) => n.type === "type_signature")
      const sigName = sig ? this.findChild(sig, (n) => n.type === "signature_name") : null
      const mName = sigName ? this.findChild(sigName, (n) => n.type === "identifier") : null
      if (!mName?.text) continue
      ctx.symbols.push({
        name: mName.text,
        kind: ASTEngine.SymbolKind.Method,
        range: this.nodeToRange(member),
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Interface,
        visibility: "public",
        metadata: { cleanSpecific: true, isClassMethod: true },
      })
    }

    ctx.patterns["Type Classes"] = true
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Interface })
    return true
  }

  private processInstance(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const classNode = this.findChild(node, (n) => n.type === "instance_class")
    const targetNode = this.findChild(node, (n) => n.type === "constructor")
    const className = classNode?.text || ""
    const targetType = targetNode?.text || ""
    if (!className || !targetType) return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    // Name the implementation class by its target type (Vec), matching the
    // universal impl-naming contract (Rust `impl User`, Elixir `defimpl`,
    // Haskell `instance Mergeable (Stream a)` → class Stream).
    const name = targetType
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true, className, targetType },
    })

    this.pushRel(ctx, targetType, className, ASTEngine.RelationshipType.Implements, 1.0, {
      cleanSpecific: true,
      isInstance: true,
    })

    ctx.patterns["Type Classes"] = true
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Class })
    return true
  }

  private processFunction(
    node: Node,
    ctx: CleanContext,
    currentScope: Scope | undefined,
    scopeStack: Scope[],
  ): boolean {
    const nameNode = this.findChild(node, (n) => n.type === "identifier")
    if (!nameNode?.text) return false
    const name = nameNode.text

    const functionKey = `${currentScope?.name || ""}::${name}`
    const existingIdx = ctx.functionSymbolIndex[functionKey]
    if (existingIdx !== undefined) {
      // Multi-clause function (map2 f [] = ... / map2 f [x:xs] = ...) — merge
      const existing = ctx.symbols[existingIdx]
      const newRange = this.nodeToRange(node)
      existing.range.endLine = Math.max(existing.range.endLine, newRange.endLine)
      if (existing.range.endIndex !== undefined && newRange.endIndex !== undefined) {
        existing.range.endIndex = Math.max(existing.range.endIndex, newRange.endIndex)
      }
      ctx.currentFunction = name
      scopeStack.push({ node, name, kind: existing.kind })
      return true
    }

    const kind =
      currentScope &&
      (currentScope.kind === ASTEngine.SymbolKind.Interface || currentScope.kind === ASTEngine.SymbolKind.Class)
        ? ASTEngine.SymbolKind.Method
        : ASTEngine.SymbolKind.Function

    ctx.symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true },
    })
    ctx.functionSymbolIndex[functionKey] = ctx.symbols.length - 1

    ctx.currentFunction = name
    scopeStack.push({ node, name, kind })
    return true
  }

  // ==========================================================================
  // Call extraction — application nodes in body position.
  // ==========================================================================
  private extractApplication(node: Node, ctx: CleanContext) {
    const head = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!head) return
    const fn = ctx.currentFunction
    if (!fn) return

    // Qualified call: M.lookup / 'Data.Error'.isError → full qualified target
    // (the Erlang gen_server:cast precedent).
    if (head.type === "qualified_identifier") {
      this.pushRel(ctx, fn, head.text, ASTEngine.RelationshipType.Calls, 0.9, {
        cleanSpecific: true,
        isQualifiedCall: true,
      })
      return
    }

    // Constructor application (uppercase head) in body → instantiates
    // (Erlang record_expr / Haskell ctor-app analog). Pattern-position applies
    // live inside case_alternative heads / function head patterns, excluded
    // via isPatternPosition.
    if (head.type === "constructor") {
      if (this.isPatternPosition(node)) return
      this.pushRel(ctx, fn, head.text, ASTEngine.RelationshipType.Instantiates, 0.9, {
        cleanSpecific: true,
        isConstructorApplication: true,
      })
      return
    }

    // Local call: identifier head → leaf target, only when declared in-file
    // (FP-family resolution: StdEnv/imported functions and pattern vars are
    // not local symbols → no edge). Self-recursion IS emitted.
    if (head.type === "identifier") {
      if (ctx.declaredFunctions.has(head.text)) {
        this.pushRel(ctx, fn, head.text, ASTEngine.RelationshipType.Calls, 0.9, {
          cleanSpecific: true,
          context: "local function call",
        })
      }
    }
  }

  private isPatternPosition(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      // case_alternative head (the pattern before ->) is never a construction
      if (cur.type === "case_alternative") return cur.namedChild(0) === node || this.isBeforeArrow(cur, node)
      // Function head patterns live before the `=` token — the RHS is a
      // different subtree, so any application under function_declaration that
      // precedes the = token is a pattern.
      if (cur.type === "function_declaration") return this.isBeforeEquals(cur, node)
      if (cur.type === "type_definition" || cur.type === "class_declaration" || cur.type === "instance_declaration") return false
      cur = cur.parent
    }
    return false
  }

  private isBeforeArrow(caseAlt: Node, node: Node): boolean {
    for (let i = 0; i < caseAlt.namedChildCount; i++) {
      const c = caseAlt.namedChild(i)
      if (!c) continue
      if (c.type === "arrow") return node.startIndex < c.startIndex
      if (c === node) return true
    }
    return false
  }

  private isBeforeEquals(fnDecl: Node, node: Node): boolean {
    for (let i = 0; i < fnDecl.namedChildCount; i++) {
      const c = fnDecl.namedChild(i)
      if (!c) continue
      if (c.type === "operator" && c.text === "=") return node.startIndex < c.startIndex
    }
    return false
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

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private filterChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
    const result: Node[] = []
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) result.push(child)
    }
    return result
  }
}
