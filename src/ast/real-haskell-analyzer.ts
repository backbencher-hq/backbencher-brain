import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
}

interface HaskellContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  frameworks: Record<string, boolean>
  typeSignatures: Record<string, string>
  functionSymbolIndex: Record<string, number>
  // Every function/method name declared in this file, collected by a pre-pass
  // so unqualified calls resolve even to LATER-defined functions (forward
  // references) and to class/instance methods.
  declaredFunctions: Set<string>
  // Module name set by the header; module-level symbols get ownerName = module
  // so the post-loop emits module → member contains edges. (The header subtree
  // ends before the body, so the scope stack cannot carry the module.)
  currentModule: string | undefined
  currentFunction: string | undefined
  seenRels: Set<string>
}

export class RealHaskellAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: HaskellContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      frameworks: {},
      typeSignatures: {},
      functionSymbolIndex: {},
      declaredFunctions: new Set(),
      currentModule: undefined,
      currentFunction: undefined,
      seenRels: new Set(),
    }
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean; restoreFn?: string }[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    // Pre-pass: collect declared function/method names so unqualified calls
    // resolve (module-level functions, class signatures, instance methods).
    this.collectDeclaredFunctions(rootNode, ctx.declaredFunctions)

    while (stack.length > 0) {
      const { node, isExit, restoreFn } = stack.pop()!

      if (isExit) {
        if (restoreFn !== undefined) ctx.currentFunction = restoreFn
        else if (node.type === "function" || node.type === "bind" || node.type === "class" || node.type === "instance" || node.type === "data" || node.type === "newtype") {
          ctx.currentFunction = undefined
        }
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) scopeStack.pop()
        continue
      }

      if (node.hasError || node.isMissing) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          ctx.errors.push({
            message: `Syntax ${node.type} detected.`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let pushedScope = false
      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

      // Complexity Detection — the pinned grammar's actual emitted node types
      // (case → alternatives; if → conditional; guard branches → guards).
      if (node.type === "case" || node.type === "conditional" || node.type === "guards") {
        cyclomaticComplexity++
      }

      // Pattern Detection from specific nodes
      if (node.type === "do") ctx.patterns["Monads"] = true
      if (node.type === "list_comprehension") ctx.patterns["List Comprehensions"] = true
      if (node.type === "case" || node.type === "patterns") ctx.patterns["Pattern Matching"] = true

      // Process Node Types
      if (node.type === "header") {
        pushedScope = this.processModule(node, ctx, scopeStack)
      } else if (node.type === "import") {
        this.processImport(node, ctx)
      } else if (node.type === "signature") {
        // Expression-position annotation `(e :: T)` — parens-wrapped — is not
        // a declaration: skip entirely (HSD9 companion guard).
        if (node.parent?.type === "parens") continue
        this.processSignature(node, ctx, currentScope)
        continue
      } else if (node.type === "function" || node.type === "bind") {
        // Do-notation bind (`z <- fetch x`): an expression, not a declaration —
        // walk its children but never emit a symbol (its applies execute in the
        // enclosing function). Distinguish via the `<-` unnamed child.
        const hasArrowBind = this.hasChildOfType(node, "<-")
        const localScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const insideLocalBlock = localScope?.kind === ASTEngine.SymbolKind.Namespace
        if (hasArrowBind) {
          // Do-bind exit must RESTORE, not wipe: without restoreFn the exit
          // handler's else-if treats this as a scope exit and clears
          // currentFunction — the SECOND and later binds of a do-block then
          // lose all call attribution (HSD9, cabal GenSPDXExc `generate`).
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
        } else if (!insideLocalBlock) {
          pushedScope = this.processFunction(node, ctx, currentScope, scopeStack)
        } else if (node.type === "function") {
          // Where/let-local FUNCTION: no symbol (locals are not module
          // symbols), but its calls attribute to ITSELF — `go->local` is a
          // true edge between two real callables. Attributing internals to
          // the ENCLOSING function (the old behavior) was the fabrication;
          // dropping them entirely hid real calls.
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          const head = node.namedChildCount > 0 ? node.namedChild(0) : null
          if (head?.type === "variable") {
            ctx.currentFunction = head.text
          } else if (head && (head.type === "infix" || head.type === "prefix_id")) {
            ctx.currentFunction = this.findNamedChildByType(head, ["operator"])?.text
          }
          scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace })
        } else {
          // Where/let-local BIND (`x = compute 1`): not a module symbol, but
          // it IS a named nullary callable (HSD6) — its body's calls attribute
          // to itself, never leaking to the enclosing function.
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          const head = node.namedChildCount > 0 ? node.namedChild(0) : null
          if (head?.type === "variable") ctx.currentFunction = head.text
        }
      } else if (node.type === "let" || node.type === "local_binds" || node.type === "list_comprehension") {
        // Scoped blocks: locals are not module symbols. (do is NOT included —
        // monadic actions execute in the enclosing function and their applies
        // attribute to it.)
        scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace })
        pushedScope = true
      } else if (node.type === "class") {
        pushedScope = this.processClass(node, ctx, scopeStack)
      } else if (node.type === "instance") {
        pushedScope = this.processInstance(node, ctx, scopeStack)
      } else if (node.type === "data_type" || node.type === "newtype") {
        pushedScope = this.processData(node, ctx, scopeStack)
      } else if (node.type === "record") {
        // HSD5: body-position record `U { un = 5 }` is Haskell's other
        // construction idiom — instantiates the constructor. Record UPDATE
        // (`u { un = 6 }`) has a variable head, not a constructor: no edge.
        // Data-DECLARATION records (inside data_constructor) never emit.
        const ctor = this.findNamedChildByType(node, ["constructor"])
        if (ctor?.text && ctx.currentFunction && !this.isDataDeclarationPosition(node)) {
          this.pushRel(ctx, ctx.currentFunction, ctor.text, ASTEngine.RelationshipType.Instantiates, 0.9, {
            haskellSpecific: true,
            isRecordConstruction: true,
          })
        }
      } else if (node.type === "apply") {
        this.extractApplyCall(node, ctx)
      } else if (node.type === "infix") {
        this.processInfix(node, ctx)
      }

      if (pushedScope) stack.push({ node, isExit: true })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    const frameworks: string[] = []
    for (const f in ctx.frameworks) frameworks.push(f)

    const patterns: string[] = []
    for (const p in ctx.patterns) patterns.push(p)

    const frameworkPatterns: {
      framework: string
      patterns: { type: string; detected: boolean; description: string }[]
    }[] = []
    for (let i = 0; i < frameworks.length; i++) {
      frameworkPatterns.push({
        framework: frameworks[i],
        patterns: [{ type: "usage", detected: true, description: `${frameworks[i]} usage detected` }],
      })
    }

    // Post-loop: contains for owned symbols — module → members, type →
    // constructors, record → fields, class/instance → methods. Skip self-named
    // edges (data User = User {...} → the type and constructor share the name,
    // which would collapse into a self-loop in symbol-ID space).
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || (s.scope && s.scope !== ctx.currentModule ? s.scope : undefined)
      if (_owner && _owner !== s.name) {
        this.pushRel(ctx, _owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {})
      }
    }

    // Exports: header export list wins; otherwise every module-level symbol
    // (Haskell exports everything by default).
    if (ctx.exports.length === 0) {
      for (const s of ctx.symbols) {
        if (s.ownerName === ctx.currentModule || (!s.ownerName && !s.scope)) {
          ctx.exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
        }
      }
    }

    // Evidence tiers: every edge leaves with an evidenceClass (M14 section D
    // family contract) — after all edges exist, before return.
    this.classifyEvidenceTier(ctx.relationships)

    return {
      language: "haskell",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworks[0],
        patterns,
        detectedFrameworks: frameworks,
        frameworkPatterns,
        architecturalScore: Math.min(100, Math.max(0, 100 - ctx.errors.length * 5)),
        codeQuality: ctx.errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "10.1.0-haskell-pure-ast",
      },
    }
  }

  // ==========================================================================
  // Relationship emission (dedupe by source|type|target identity).
  // ==========================================================================
  private pushRel(
    ctx: HaskellContext,
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
    // Type-position function nodes (signature internals, field "parameter"/
    // "result") are TYPES, not declarations — without this guard their type
    // variables (a, f, m) pollute the callable set and fabricate edges.
    if (node.type === "function" && (node.childForFieldName("parameter") || node.childForFieldName("result"))) {
      return
    }
    if (node.type === "function" || node.type === "bind") {
      // Do-notation binds (`z <- fetch x`) bind VALUES, not callables — but
      // NEVER prune the descent: a do-bind RHS can host an inner do-block
      // whose let-bound functions are real callables (cabal ProjectPlanning
      // `progdb <- liftIO $ do { let addPaths ... }; ... addPaths ...`).
      // The old early-return hid addPaths/globalPaths from the declared set,
      // dropping 4 real call edges (HSD10, probe 2026-09-03).
      if (!(node.type === "bind" && this.hasChildOfType(node, "<-"))) {
        const nameNode = node.namedChildCount > 0 ? node.namedChild(0) : null
        if (nameNode && nameNode.type === "variable") {
          out.add(nameNode.text)
        } else if (nameNode && (nameNode.type === "infix" || nameNode.type === "prefix_id")) {
          // Operator definitions: `a +.+ b = ...` (infix head) and
          // `(<!>) f x = ...` (prefix_id head) declare the OPERATOR as the
          // callable name — probe 2026-09-03.
          const op = this.findNamedChildByType(nameNode, ["operator"])
          if (op?.text) out.add(op.text)
        }
      }
      // NO early return in any case: nested local_binds (where/let) hold more
      // declared callables — where-locals must resolve as call targets.
    }
    if (node.type === "signature") {
      // Expression-position signature — `(e :: T)` inline annotation, always
      // parens-wrapped in expressions — is NOT a declaration. Without this
      // guard `(fromIntegral :: Integer -> Int64)` fabricates a fromIntegral
      // call edge (cabal Timestamp.hs). Declaration signatures are direct
      // children of declarations/local_binds/class/instance bodies.
      if (node.parent?.type === "parens") return
      // Pinned grammar: signature's name child is `variable` (probe 2026-09-03;
      // `identifier`/`varid` literals do not exist in tree-sitter-haskell).
      const nameNode = this.findNamedChildByType(node, ["variable"])
      if (nameNode?.text) out.add(nameNode.text)
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) this.collectDeclaredFunctions(child, out)
    }
  }

  private processModule(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    let moduleName = ""
    // Pinned grammar: `module` (wrapping module_id). `qconid` is a dead
    // literal from an older grammar (F1 audit 2026-09-03).
    const moduleNode = this.findNamedChildByType(node, ["module"])
    if (moduleNode) {
      // module_id children compose dotted names (Data.List → "Data" "List")
      moduleName = this.assembleModuleId(moduleNode)
    } else {
      const mIdx = this.findChildIndexByText(node, "module")
      if (mIdx !== -1 && node.childCount > mIdx + 1) {
        moduleName = node.child(mIdx + 1)?.text || ""
      }
    }
    if (!moduleName) return false
    ctx.currentModule = moduleName

    // Process Exports — pinned grammar node is `exports` (`export_list` is
    // a dead literal; F1 audit 2026-09-03).
    const exportsList = this.findNamedChildByType(node, ["exports"])
    if (exportsList) {
      for (let i = 0; i < exportsList.namedChildCount; i++) {
        const expNode = exportsList.namedChild(i)
        if (expNode) {
          let exportName = expNode.text.trim()
          if (this.startsWithWord(exportName, "module ")) {
            exportName = exportName.slice("module ".length).trim()
          } else {
            const paren = exportName.indexOf("(")
            if (paren >= 0) exportName = exportName.slice(0, paren).trim()
          }
          if (exportName && exportName !== ",") {
            ctx.exports.push({ name: exportName, isDefault: false, range: this.nodeToRange(expNode) })
          }
        }
      }
    }

    ctx.symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(node),
      scope: "",
      visibility: "public",
      metadata: { haskellSpecific: true },
    })
    scopeStack.push({ node, name: moduleName, kind: ASTEngine.SymbolKind.Module })
    return true
  }

  // module_id children compose dotted names: Data → List → "Data.List"
  private assembleModuleId(node: Node): string {
    let out = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      const leaf = c.type === "module_id" ? this.assembleModuleId(c) : c.text
      if (out) out += "."
      out += leaf
    }
    return out || node.text
  }

  private processImport(node: Node, ctx: HaskellContext) {
    let isQualified = false
    const items: string[] = []
    const modulesToImport: { name: string; alias?: string; isHiding?: boolean }[] = []
    let currentIsHiding = this.findChildIndexByText(node, "hiding") !== -1

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "qualified") {
        isQualified = true
      } else if (child.type === "module" || child.type === "module_id") {
        const name = this.assembleModuleId(child)
        if (i > 0 && node.child(i - 1)?.text.trim() === "as") {
          const lastMod = modulesToImport[modulesToImport.length - 1]
          if (lastMod) lastMod.alias = name
        } else {
          modulesToImport.push({ name, isHiding: currentIsHiding })
        }
      } else if (child.type === "hiding") {
        currentIsHiding = true
      } else if (child.type === "import_list") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const item = child.namedChild(j)
          if (item && item.type !== "hiding") {
            const itemText = this.stripOuterParens(item.text.trim())
            if (itemText && itemText !== "hiding" && itemText !== ",") {
              const paren = itemText.indexOf("(")
              items.push(paren >= 0 ? itemText.slice(0, paren).trim() : itemText)
            }
          }
        }
      }
    }

    for (const mod of modulesToImport) {
      if (!mod.name) continue
      const importItems: string[] = []
      if (items.length > 0) {
        for (const item of items) importItems.push(item)
      } else {
        importItems.push("*")
      }
      ctx.imports.push({
        module: mod.name,
        source: mod.name,
        items: importItems,
        isTypeOnly: false,
        range: this.nodeToRange(node),
        metadata: { isQualified, alias: mod.alias, isHiding: mod.isHiding },
      })
      // DependsOn for imports — source is the MODULE (FP-family contract:
      // references module -> dep), never the import itself.
      this.pushRel(ctx, ctx.currentModule || "", mod.name, ASTEngine.RelationshipType.References, 0.9, {
        isHaskellImport: true,
      })

      if (mod.name.indexOf("Scotty") !== -1) ctx.frameworks["Scotty"] = true
      if (mod.name.indexOf("Servant") !== -1) ctx.frameworks["Servant"] = true
      if (mod.name.indexOf("QuickCheck") !== -1) ctx.frameworks["QuickCheck"] = true
      if (mod.name.indexOf("Database.Persist") !== -1) ctx.frameworks["Persistent"] = true
      if (mod.name.indexOf("Yesod") !== -1) ctx.frameworks["Yesod"] = true
    }
  }

  private processSignature(node: Node, ctx: HaskellContext, currentScope: Scope | undefined) {
    // Pinned grammar: signature → variable (name) + function (type); the
    // `signature_type`/`identifier`/`varid` literals do not exist (F1 audit
    // 2026-09-03). The `::` text slice is the honest type extraction — it
    // also covers context-carrying signatures (`merge :: (Semigroup a) => ...`).
    const nameNode = this.findNamedChildByType(node, ["variable"])

    if (nameNode) {
      const idx = node.text.indexOf("::")
      if (idx !== -1) {
        ctx.typeSignatures[nameNode.text] = node.text.slice(idx + 2).trim()
      }
    }

    // Interface/class method declarations: `class Mergeable s where merge :: ...`
    // — the signature inside a class body is a Method symbol owned by the
    // interface, matching C#/Rust/Elixir interface member handling.
    if (
      nameNode &&
      currentScope &&
      (currentScope.kind === ASTEngine.SymbolKind.Interface || currentScope.kind === ASTEngine.SymbolKind.Class)
    ) {
      // O(1) dedup via the function symbol index (no per-signature O(symbols)
      // scan — a class with many method signatures must not be quadratic).
      const methodKey = `${currentScope.name}::${nameNode.text}`
      const existingIdx = ctx.functionSymbolIndex[methodKey]
      if (existingIdx === undefined) {
        ctx.functionSymbolIndex[methodKey] = ctx.symbols.length
        ctx.symbols.push({
          name: nameNode.text,
          kind: ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          scope: currentScope.name || "",
          ownerName: currentScope.name,
          ownerKind: currentScope.kind,
          visibility: "public",
          metadata: { haskellSpecific: true, isInterfaceMethod: true },
        })
      }
    }
  }

  private processFunction(
    node: Node,
    ctx: HaskellContext,
    currentScope: Scope | undefined,
    scopeStack: Scope[],
  ): boolean {
    if (node.type === "function" && (node.childForFieldName("parameter") || node.childForFieldName("result"))) {
      return false
    }

    let name = ""
    const nameNode = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (nameNode && nameNode.type === "variable") {
      name = nameNode.text
    } else if (nameNode && (nameNode.type === "infix" || nameNode.type === "prefix_id")) {
      // Operator definitions: `a +.+ b = ...` / `(<!>) f x = ...` — the symbol
      // name is the OPERATOR (probe 2026-09-03), not the whole head text.
      const op = this.findNamedChildByType(nameNode, ["operator"])
      if (op?.text) name = op.text
    } else if (node.namedChildCount > 0) {
      name = node.namedChild(0)?.text || ""
    }

    if (!name || name === "=" || name === "|" || node.parent?.type === "signature" || node.parent?.type === "function") {
      return false
    }

    const functionKey = `${currentScope?.name || ""}::${name}`
    const existingIndex = ctx.functionSymbolIndex[functionKey]
    const existing = existingIndex !== undefined ? ctx.symbols[existingIndex] : undefined
    if (existing) {
      const newRange = this.nodeToRange(node)
      existing.range.endLine = Math.max(existing.range.endLine, newRange.endLine)
      if (existing.range.endIndex !== undefined && newRange.endIndex !== undefined) {
        existing.range.endIndex = Math.max(existing.range.endIndex, newRange.endIndex)
      } else if (newRange.endIndex !== undefined) {
        existing.range.endIndex = newRange.endIndex
      }
      // Multi-clause functions (`f (Just x) = ...; f Nothing = ...`): the
      // symbol's complexity is the max across clauses.
      if (existing.complexity !== undefined) {
        existing.complexity = Math.max(existing.complexity, this.calculateNodeComplexity(node))
      }
      ctx.currentFunction = name
      scopeStack.push({ node, name, kind: existing.kind })
      return true
    }

    const typeSignature = ctx.typeSignatures[name]
    let isHigherOrder = false
    let returnType: string | undefined = undefined

    if (typeSignature && typeof typeSignature === "string") {
      // HOFs have functions as arguments — parens around an arrow (a -> b).
      // Pure char scan: an arrow while inside a paren pair.
      isHigherOrder = this.hasArrowInParens(typeSignature)
      const parts = this.splitOnArrows(typeSignature)
      if (parts.length > 0) returnType = parts[parts.length - 1].trim()
    }
    if (isHigherOrder) ctx.patterns["Higher-Order Functions"] = true

    const kind =
      currentScope &&
      (currentScope.kind === ASTEngine.SymbolKind.Interface || currentScope.kind === ASTEngine.SymbolKind.Class)
        ? ASTEngine.SymbolKind.Method
        : ASTEngine.SymbolKind.Function

    ctx.symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      returnType,
      complexity: this.calculateNodeComplexity(node),
      metadata: { typeSignature, isHigherOrder, haskellSpecific: true },
    })
    ctx.functionSymbolIndex[functionKey] = ctx.symbols.length - 1

    ctx.currentFunction = name
    scopeStack.push({ node, name, kind })
    return true
  }

  private processData(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Algebraic Data Types"] = true
    // Pinned grammar: data_type/newtype → name (probe 2026-09-03). The
    // `type_constructor`/`tycon`/`type_name` literals are dead (older
    // grammar); the text fallback remains for ERROR-tolerance.
    let name = ""
    const nameNode = this.findNamedChildByType(node, ["name"])
    if (nameNode) name = nameNode.text
    else {
      const dataIdx = this.findChildIndexByText(node, ["data", "newtype"])
      if (dataIdx !== -1 && node.childCount > dataIdx + 1) {
        name = node.child(dataIdx + 1)?.text || ""
      }
    }
    if (!name) return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: { haskellSpecific: true, isData: node.type === "data_type" },
    })

    // Data constructors → Constructor symbols owned by the type. The grammar
    // nests them: data_type → data_constructors → data_constructor → prefix/
    // record; newtype → newtype_constructor directly.
    const ctorNodes: Node[] = []
    const ctorGroup = this.findNamedChildByType(node, ["data_constructors"])
    if (ctorGroup) {
      for (const c of this.collectNamedChildrenByType(ctorGroup, ["data_constructor"])) ctorNodes.push(c)
    }
    for (const c of this.collectNamedChildrenByType(node, ["newtype_constructor", "data_constructor"])) {
      if (!ctorNodes.includes(c)) ctorNodes.push(c)
    }
    for (const cNode of ctorNodes) {
      const cName = this.extractConstructorName(cNode)
      if (cName) {
        ctx.symbols.push({
          name: cName,
          kind: ASTEngine.SymbolKind.Constructor,
          range: this.nodeToRange(cNode),
          scope: name,
          ownerName: name,
          ownerKind: ASTEngine.SymbolKind.Type,
          visibility: "public",
          metadata: { isDataConstructor: true },
        })
      }
      // Record fields → Property symbols owned by the constructor/type
      const recordNode = this.findNamedChildByType(cNode, ["record"])
      if (recordNode) {
        const fields = this.collectFields(recordNode)
        for (const field of fields) {
          const fNameNode = this.findNamedChildByType(field, ["field_name"])
          const varNode = fNameNode ? fNameNode.namedChild(0) : null
          if (varNode?.text) {
            ctx.symbols.push({
              name: varNode.text,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(field),
              scope: name,
              ownerName: name,
              ownerKind: ASTEngine.SymbolKind.Type,
              visibility: "public",
              metadata: { haskellSpecific: true, isRecordField: true },
            })
          }
        }
      }
    }

    // deriving (Show, Eq) → implements type -> derived class. The derived
    // names are `name` nodes nested inside deriving → tuple → name.
    const deriving = this.findNamedChildByType(node, ["deriving", "deriving_strategy"])
    if (deriving) {
      const derived: Node[] = []
      const tuple = this.findNamedChildByType(deriving, ["tuple"])
      if (tuple) {
        for (const n of this.collectNamedChildrenByType(tuple, ["name"])) derived.push(n)
      }
      if (derived.length === 0) {
        for (const n of this.collectNamedChildrenByType(deriving, ["name"])) derived.push(n)
      }
      // Parenthesized single-element deriving: `deriving (Show)` parses as
      // deriving → parens → name (no tuple node) — previously dropped, which
      // mis-pinned every single-class derived instance (cabal GenSPDX*).
      if (derived.length === 0) {
        for (const parens of this.collectNamedChildrenByType(deriving, ["parens"])) {
          for (const n of this.collectNamedChildrenByType(parens, ["name"])) derived.push(n)
        }
      }
      for (const dc of derived) {
        if (!dc?.text) continue
        this.pushRel(ctx, name, dc.text, ASTEngine.RelationshipType.Implements, 1.0, { derived: true })
      }
    }

    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Type })
    return true
  }

  // data_constructor → prefix → constructor "Node" | record → constructor "Rect"
  private extractConstructorName(node: Node): string | undefined {
    const prefix = this.findNamedChildByType(node, ["prefix"])
    if (prefix) {
      const con = this.findNamedChildByType(prefix, ["constructor", "name"])
      if (con?.text) return con.text
    }
    const record = this.findNamedChildByType(node, ["record"])
    if (record) {
      const con = this.findNamedChildByType(record, ["constructor"])
      if (con?.text) return con.text
    }
    const direct = this.findNamedChildByType(node, ["constructor", "name"])
    if (direct?.text) return direct.text
    return undefined
  }

  private processClass(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Type Classes"] = true
    // Pinned grammar: class → name (`class_name`/`type_name`/`tycon` are
    // dead literals; F1 audit 2026-09-03).
    let name = ""
    const nameNode = this.findNamedChildByType(node, ["name"])
    if (nameNode) name = nameNode.text
    else {
      const classIdx = this.findChildIndexByText(node, "class")
      if (classIdx !== -1 && node.childCount > classIdx + 1) {
        name = node.child(classIdx + 1)?.text || ""
      }
    }
    if (!name) return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    // Superclasses: class Semigroup s => Mergeable s → context → apply → first
    // name child. Multiple: class (A a, B a) => C a → context → tuple → applies.
    const context = this.findNamedChildByType(node, ["context"])
    if (context) {
      const superNames: string[] = []
      const applies = this.collectNamedChildrenByType(context, ["apply"])
      for (const ap of applies) {
        const first = ap.namedChildCount > 0 ? ap.namedChild(0) : null
        if (first && (first.type === "name" || first.type === "constructor" || first.type === "type")) {
          superNames.push(first.text)
        }
      }
      // Parens-wrapped: (Show a) → parens → apply
      if (superNames.length === 0) {
        const parens = this.collectNamedChildrenByType(context, ["parens"])
        for (const p of parens) {
          const ap = this.findNamedChildByType(p, ["apply"])
          const first = ap?.namedChildCount ? ap.namedChild(0) : null
          if (first && (first.type === "name" || first.type === "constructor")) superNames.push(first.text)
        }
      }
      for (const sn of superNames) {
        this.pushRel(ctx, name, sn, ASTEngine.RelationshipType.Extends, 1.0, { isSuperclass: true })
      }
    }

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: { haskellSpecific: true },
    })

    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Interface })
    return true
  }

  private processInstance(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    let className = ""
    let targetType = ""

    // Shape: [context?, name(class), type_patterns?, instance_declarations?]
    const classNode = this.findNamedChildByType(node, ["name"])
    const tpNode = this.findNamedChildByType(node, ["type_patterns"])
    if (classNode?.text) className = classNode.text
    if (tpNode) {
      // type_patterns → list → variable (`instance Sized [a]`) | bare
      // name/constructor (`instance Sized Foo`) | parens → apply first child
      // (`instance Functor (Stream f)`). Probe 2026-09-03.
      const direct = this.findNamedChildByType(tpNode, ["name", "constructor"])
      if (direct?.text) {
        targetType = direct.text
      } else {
        const list = this.findNamedChildByType(tpNode, ["list"])
        if (list) {
          targetType = "[]"
        } else {
          const parens = this.findNamedChildByType(tpNode, ["parens"])
          if (parens) {
            const ap = this.findNamedChildByType(parens, ["apply"])
            const first = ap?.namedChildCount ? ap.namedChild(0) : null
            if (first) targetType = first.text
          }
        }
      }
    }

    // Fallback (text-free): instance D Int → second named child
    if (!className || !targetType) {
      const named: string[] = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && (c.type === "name" || c.type === "constructor")) {
          named.push(c.text)
        }
      }
      if (!className && named.length >= 1) className = named[0]
      if (!targetType && named.length >= 2) targetType = named[1]
    }

    // Name the implementation class by its target type (Stream), matching the
    // universal impl-naming contract (Rust `impl User`, Elixir `defimpl`).
    const name = targetType || className
    if (!name || name === " ") return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: { haskellSpecific: true, className, targetType },
    })

    if (className && targetType) {
      this.pushRel(ctx, targetType, className, ASTEngine.RelationshipType.Implements, 1.0, { isInstance: true })
    }

    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Class })
    return true
  }

  // ==========================================================================
  // Call extraction — apply nodes in body position.
  // ==========================================================================
  private extractApplyCall(node: Node, ctx: HaskellContext) {
    const head = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!head) return
    const fn = ctx.currentFunction
    if (!fn) return

    // Constructor application in body → instantiates (record construction /
    // prefix constructor application). Pattern-position applies live inside a
    // `patterns` node and are excluded via currentFunction only firing in body
    // contexts — additionally, applies whose parent chain hits a `patterns`
    // node are patterns, never construction sites.
    if (head.type === "constructor" || head.type === "prefix") {
      if (this.isPatternPosition(node)) return
      this.pushRel(ctx, fn, head.text, ASTEngine.RelationshipType.Instantiates, 0.9, {
        haskellSpecific: true,
        isConstructorApplication: true,
      })
      return
    }

    // Qualified call: M.lookup / Data.Map.size → full qualified target
    // (Erlang gen_server:cast precedent). Pinned grammar: qualified → module
    // + variable (`qconid` is dead; F1 audit 2026-09-03).
    if (head.type === "qualified") {
      const mod = this.findNamedChildByType(head, ["module"])
      const modText = mod ? this.stripTrailingDot(mod.text) : ""
      const func = this.findNamedChildByType(head, ["variable"])
      if (modText && func?.text) {
        this.pushRel(ctx, fn, `${modText}.${func.text}`, ASTEngine.RelationshipType.Calls, 0.9, {
          haskellSpecific: true,
          isQualifiedCall: true,
        })
      }
      return
    }

    // Local call: variable/identifier head → leaf target, only when declared
    // in this file (FP-family resolution: imported/Prelude functions and type
    // variables produce no edge). Self-recursion IS emitted.
    if (head.type === "variable") {
      if (ctx.declaredFunctions.has(head.text)) {
        this.pushRel(ctx, fn, head.text, ASTEngine.RelationshipType.Calls, 0.9, {
          haskellSpecific: true,
          context: "local function call",
        })
      }
    }
  }

  private isPatternPosition(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "patterns") return true
      // Do-notation bind RHS (`z <- fetch x`) and match bodies are not patterns
      if (cur.type === "match") return false
      if (cur.type === "function" || cur.type === "bind" || cur.type === "class" || cur.type === "instance") return false
      cur = cur.parent
    }
    return false
  }

  // =========================================================================
  // Infix handling: backtick calls, $ application, and pattern marking.
  // HSD1/HSD2 (probe 2026-09-03): infix_id is a backtick call (`x `elem2` xs`);
  // operator "$" is function application — Haskell's most common idiom. Both
  // were previously dropped entirely.
  // =========================================================================
  private processInfix(node: Node, ctx: HaskellContext) {
    const opNode = this.findNamedChildByType(node, ["operator"])
    const infixId = this.findNamedChildByType(node, ["infix_id"])

    if (infixId) {
      // Backtick call: the infix_id wraps the called function (variable).
      const fn = ctx.currentFunction
      const target = this.findNamedChildByType(infixId, ["variable"])
      if (fn && target?.text && ctx.declaredFunctions.has(target.text)) {
        this.pushRel(ctx, fn, target.text, ASTEngine.RelationshipType.Calls, 0.9, {
          haskellSpecific: true,
          context: "backtick infix call",
        })
      }
    } else if (opNode?.text === "$") {
      // `$` application: LHS is the applied function (possibly qualified),
      // exactly like an apply head. RHS chains nest further infix/apply nodes
      // and are visited independently. Only the LHS is applied here.
      const fn = ctx.currentFunction
      if (fn) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (!c || c.type === "operator") continue
          if (c.type === "variable" && ctx.declaredFunctions.has(c.text)) {
            this.pushRel(ctx, fn, c.text, ASTEngine.RelationshipType.Calls, 0.9, {
              haskellSpecific: true,
              context: "$ application",
            })
          } else if (c.type === "qualified") {
            const mod = this.findNamedChildByType(c, ["module"])
            const func = this.findNamedChildByType(c, ["variable"])
            const modText = mod ? this.stripTrailingDot(mod.text) : ""
            if (modText && func?.text) {
              this.pushRel(ctx, fn, `${modText}.${func.text}`, ASTEngine.RelationshipType.Calls, 0.9, {
                haskellSpecific: true,
                isQualifiedCall: true,
                context: "$ application",
              })
            }
          }
          break
        }
      }
    }

    // Pattern marking (unchanged contract).
    const op = opNode?.text ?? ""
    if (op === ">>=" || op === ">>" || op === "<-") ctx.patterns["Monads"] = true
    if (op === "<$>" || op === "<*>") ctx.patterns["Functors and Applicatives"] = true
    if (op === "|>") ctx.patterns["Pipe Operator"] = true
  }

  /**
   * Per-symbol cyclomatic complexity (family contract: python #270 / ruby
   * #269 / php #268). Haskell decision points per the analyzer's own
   * module-level counter: case, conditional (if), guards.
   */
  private calculateNodeComplexity(node: Node): number {
    if (!node) return 1
    let complexity = 1
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (n.type === "case" || n.type === "conditional" || n.type === "guards") complexity++
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  /**
   * Evidence-tier classification — same rules as the python/ruby/php family
   * (M14 section D requires >=2 distinct evidenceClass values).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = (r.metadata ??= {})
      if (md.evidenceClass) continue
      const t = r.type
      const conf = r.confidence ?? 0
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") { md.evidenceClass = md.isHaskellImport ? "import_based" : "reference_qualified"; continue }
      if (t === "extends" || t === "implements") { md.evidenceClass = "structural"; continue }
      if (t === "instantiates") { md.evidenceClass = md.isRecordConstruction || md.isConstructorApplication ? "usage_contextual" : "structural"; continue }
      md.evidenceClass = conf >= 0.85 ? "usage_contextual" : "inferred"
    }
  }

  // Data-DECLARATION records live inside data_constructors; body-position
  // records sit under a match/do/bind. Walk up: crossing a match/bind/do
  // before any data_constructor means body position.
  private isDataDeclarationPosition(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "match" || cur.type === "do" || cur.type === "bind" || cur.type === "let_in") return false
      if (cur.type === "data_constructor" || cur.type === "newtype_constructor") return true
      cur = cur.parent
    }
    return false
  }

  // ==========================================================================
  // Pure-string helpers (no regex).
  // ==========================================================================
  private startsWithWord(text: string, word: string): boolean {
    return text.length >= word.length && text.slice(0, word.length) === word
  }

  private stripOuterParens(text: string): string {
    let start = 0
    let end = text.length
    while (start < end && text[start] === "(") start++
    while (end > start && text[end - 1] === ")") end--
    return text.slice(start, end)
  }

  private stripTrailingDot(text: string): string {
    return text.length > 0 && text[text.length - 1] === "." ? text.slice(0, -1) : text
  }

  private hasArrowInParens(text: string): boolean {
    let depth = 0
    for (let i = 0; i < text.length - 1; i++) {
      const ch = text[i]
      if (ch === "(") depth++
      else if (ch === ")") depth = Math.max(0, depth - 1)
      else if (ch === "-" && text[i + 1] === ">" && depth > 0) return true
    }
    return false
  }

  private splitOnArrows(text: string): string[] {
    const parts: string[] = []
    let cur = ""
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "-" && text[i + 1] === ">") {
        parts.push(cur)
        cur = ""
        i++
      } else {
        cur += text[i]
      }
    }
    parts.push(cur)
    return parts
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

  private findNamedChildByType(node: Node, types: string[], extraPredicate?: (type: string) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue

      let found = false
      for (let j = 0; j < types.length; j++) {
        if (types[j] === child.type) {
          found = true
          break
        }
      }
      if (found || (extraPredicate && extraPredicate(child.type))) return child
    }
    return null
  }

  private collectFields(recordNode: Node): Node[] {
    const fields: Node[] = []
    const stack: Node[] = [recordNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        if (child.type === "field") fields.push(child)
        else stack.push(child)
      }
    }
    return fields
  }

  private collectNamedChildrenByType(node: Node, types: string[]): Node[] {
    const matches: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        let found = false
        for (let j = 0; j < types.length; j++) {
          if (types[j] === child.type) {
            found = true
            break
          }
        }
        if (found) matches.push(child)
      }
    }
    return matches
  }

  private hasChildOfType(node: Node, type: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && child.type === type) return true
    }
    return false
  }

  private findChildIndexByText(node: Node, needle: string | string[]): number {
    const needles: string[] = []
    if (Array.isArray(needle)) {
      for (let i = 0; i < needle.length; i++) needles.push(needle[i])
    } else {
      needles.push(needle)
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) {
        for (let j = 0; j < needles.length; j++) {
          if (needles[j] === child.text) return i
        }
      }
    }
    return -1
  }
}
