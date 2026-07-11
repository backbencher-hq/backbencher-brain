// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

interface Scope {
  node: Node
  name: string
  kind: SymbolKind
}

interface HaskellContext {
  symbols: UniversalSymbol[]
  relationships: UniversalRelationship[]
  imports: ImportInfo[]
  exports: ExportInfo[]
  errors: ParseError[]
  patterns: Record<string, boolean>
  frameworks: Record<string, boolean>
  typeSignatures: Record<string, string>
  functionSymbolIndex: Record<string, number>
}

export class RealHaskellAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
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
    }
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean }[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    while (stack.length > 0) {
      const { node, isExit } = stack.pop()!

      if (isExit) {
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

      // Complexity Detection
      if (node.type === "case" || node.type === "if" || node.type === "guards" || node.type === "guard_equation") {
        cyclomaticComplexity++
      }

      // Pattern Detection from specific nodes
      if (node.type === "do" || node.type === "do_expression") ctx.patterns["Monads"] = true
      if (node.type === "list_comprehension") ctx.patterns["List Comprehensions"] = true
      if (node.type === "case_expression" || node.type === "match" || node.type === "pattern_match")
        ctx.patterns["Pattern Matching"] = true

      // Process Node Types
      if (node.type === "header" || node.type === "module_declaration") {
        pushedScope = this.processModule(node, ctx, scopeStack)
      } else if (node.type === "import_declaration" || node.type === "import") {
        this.processImport(node, ctx)
      } else if (node.type === "signature" || node.type === "type_signature") {
        this.processSignature(node, ctx)
        continue
      } else if (node.type === "function" || node.type === "bind" || node.type === "function_declaration") {
        pushedScope = this.processFunction(node, ctx, currentScope, scopeStack)
      } else if (node.type === "class" || node.type === "class_declaration") {
        pushedScope = this.processClass(node, ctx, scopeStack)
      } else if (node.type === "instance" || node.type === "instance_declaration") {
        pushedScope = this.processInstance(node, ctx, scopeStack)
      } else if (
        node.type === "data_declaration" ||
        node.type === "newtype_declaration" ||
        node.type === "data" ||
        node.type === "newtype" ||
        node.type === "data_type"
      ) {
        pushedScope = this.processData(node, ctx, scopeStack)
      } else if (node.type === "exp_apply" || node.type === "application" || node.type === "apply") {
        // 1. Call Graph Extraction
        const funcNode = this.namedChildAt(node, 0)
        if (
          funcNode &&
          (funcNode.type === "variable" ||
            funcNode.type === "identifier" ||
            funcNode.type === "varid" ||
            funcNode.type === "operator")
        ) {
          if (
            currentScope &&
            (currentScope.kind === SymbolKind.Function || currentScope.kind === SymbolKind.Method)
          ) {
            ctx.relationships.push({
              source: currentScope.name,
              target: funcNode.text,
              type: RelationshipType.Calls,
              metadata: {},
            })
          }
        }
      } else if (node.type === "operator" || node.type === "infix" || node.type === "operator_name") {
        // 4. The Operator Blindspot
        if (
          currentScope &&
          (currentScope.kind === SymbolKind.Function || currentScope.kind === SymbolKind.Method)
        ) {
          ctx.relationships.push({
            source: currentScope.name,
            target: node.text,
            type: RelationshipType.Calls,
            metadata: {},
          })
        }
        if (node.text === ">>=" || node.text === ">>" || node.text === "<-") ctx.patterns["Monads"] = true
        if (node.text === "<$>" || node.text === "<*>") ctx.patterns["Functors and Applicatives"] = true
        if (node.text === "|>") ctx.patterns["Pipe Operator"] = true
      } else if (node.type === "bind_stmt" || node.type === "<-") {
        // 2. The Do-Notation Ignorance (Execution Flow Ruin)
        const right = this.namedChildAt(node, 1) || this.namedChildAt(node, 0) // fallback if LHS is missing
        if (
          right &&
          (right.type === "variable" ||
            right.type === "identifier" ||
            right.type === "varid" ||
            right.type === "exp_apply")
        ) {
          // We map the do-block bind execution as a call
          let targetName = right.text
          if (right.type === "exp_apply") {
            const subFunc = this.namedChildAt(right, 0)
            if (subFunc) targetName = subFunc.text
          }
          if (
            currentScope &&
            (currentScope.kind === SymbolKind.Function || currentScope.kind === SymbolKind.Method)
          ) {
            ctx.relationships.push({
              source: currentScope.name,
              target: targetName,
              type: RelationshipType.Calls,
              metadata: {},
            })
          }
        }
      } else if (
        node.type === "data_constructor" ||
        node.type === "newtype_constructor" ||
        node.type === "data_constructor_decl"
      ) {
        let cName = this.findNamedChildByType(node, ["conid", "identifier", "name", "type", "constructor"])?.text
        if (!cName) {
          const match = node.text.match(/^[A-Z][a-zA-Z0-9_]*/)
          if (match) cName = match[0]
        }
        if (cName) {
          ctx.symbols.push({
            name: cName,
            kind: SymbolKind.Constructor || SymbolKind.Function,
            range: this.nodeToRange(node),
            scope: currentScope?.name || "",
            visibility: "public",
            metadata: { isDataConstructor: true },
          })
        }
      } else if (
        node.type === "where" ||
        node.type === "let" ||
        node.type === "let_in" ||
        node.type === "list_comprehension"
      ) {
        const scopeName = `${currentScope?.name || "global"}_${node.type}_${cyclomaticComplexity}_${node.startIndex}`
        scopeStack.push({ node, name: scopeName, kind: SymbolKind.Namespace })
        pushedScope = true
      }

      if (pushedScope) stack.push({ node, isExit: true })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    // --- HASKELL CALL GRAPH EXTRACTION ---
    // Walks identifiers to build caller→callee map.
    // Haskell function application is implicit (juxtaposition), so we track
    // non-declaration variable/name/varid nodes as potential calls.
    try {
      const extractHaskellCalls = (n: Node) => {
        if (n.type === "variable" || n.type === "name" || n.type === "varid") {
          let isDecl = false
          let p: Node | null = n.parent
          if (p && (p.type === "signature" || p.type === "bind" || p.type === "function")) {
            if (p.namedChildCount > 0 && p.namedChild(0)?.id === n.id) {
              isDecl = true
            }
          }

          if (!isDecl && n.text !== "IO" && n.text !== "putStrLn" && !/^[A-Z]/.test(n.text)) {
            let sourceName = "Global"
            let curr: Node | null = n.parent
            while (curr) {
              if (curr.type === "bind" || curr.type === "signature" || curr.type === "function") {
                if (curr.namedChildCount > 0) {
                  const first = curr.namedChild(0)
                  if (first) sourceName = first.text
                }
                break
              }
              curr = curr.parent
            }
            ctx.relationships.push({
              source: sourceName,
              target: n.text,
              type: RelationshipType.Calls,
              metadata: { haskellSpecific: true },
            })
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) extractHaskellCalls(child)
        }
      }
      extractHaskellCalls(rootNode)
    } catch (e) {
      // Graceful degradation — call graph extraction should never crash the analyzer
    }
    // --- END HASKELL CALL GRAPH EXTRACTION ---

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

    // Post-loop: add contains for owned symbols
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        ctx.relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    if (ctx.exports.length === 0) { for (let i = 0; i < ctx.symbols.length; i++) { const s = ctx.symbols[i]; if (!s.ownerName || s.ownerKind === SymbolKind.Module) { ctx.exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" }); } } }
    return {
      language: "haskell",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: ctx.symbols.length + ctx.relationships.length,
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
        analysisVersion: "10.0.0-haskell-dfs-strict",
      },
    }
  }

  private processModule(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    let moduleName = ""
    const moduleNode = this.findNamedChildByType(node, ["module", "module_id", "qconid"])

    if (moduleNode) {
      moduleName = moduleNode.text
    } else {
      const mIdx = this.findChildIndexByText(node, "module")
      if (mIdx !== -1 && node.childCount > mIdx + 1) {
        moduleName = node.child(mIdx + 1)?.text || ""
      }
    }
    if (!moduleName) return false

    // Process Exports
    const exportsList = this.findNamedChildByType(node, ["exports", "export_list"])
    if (exportsList) {
      for (let i = 0; i < exportsList.namedChildCount; i++) {
        const expNode = exportsList.namedChild(i)
        if (expNode) {
          let exportName = expNode.text.trim()
          if (exportName.startsWith("module ")) {
            exportName = exportName.replace("module ", "").trim()
          } else {
            exportName = exportName.split("(")[0].trim()
          }
          if (exportName && exportName !== ",") {
            ctx.exports.push({ name: exportName, isDefault: false, range: this.nodeToRange(expNode) })
          }
        }
      }
    }

    ctx.symbols.push({
      name: moduleName,
      kind: SymbolKind.Module,
      range: this.nodeToRange(node),
      scope: "",
      visibility: "public",
      metadata: { haskellSpecific: true },
    })
    scopeStack.push({ node, name: moduleName, kind: SymbolKind.Module })
    return true
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
      } else if (
        child.type === "module" ||
        child.type === "module_id" ||
        child.type === "qconid" ||
        child.type === "identifier"
      ) {
        if (i > 0 && node.child(i - 1)?.text.trim() === "as") {
          const lastMod = modulesToImport[modulesToImport.length - 1]
          if (lastMod) lastMod.alias = child.text
        } else {
          modulesToImport.push({ name: child.text, isHiding: currentIsHiding })
        }
      } else if (child.type === "import_alias") {
        const aliasMod =
          this.findNamedChildByType(child, ["module", "module_id", "qconid"])?.text ||
          child.text.replace(/^as\s+/, "").trim()
        const lastMod = modulesToImport[modulesToImport.length - 1]
        if (lastMod) lastMod.alias = aliasMod
      } else if (child.type === "hiding") {
        currentIsHiding = true
      } else if (child.type === "import_list" || child.type === "export_list") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const item = child.namedChild(j)
          if (item && item.type !== "hiding") {
            const itemText = item.text.replace(/^[()]/g, "").replace(/[()]$/g, "").trim()
            if (itemText && itemText !== "hiding" && itemText !== ",") items.push(itemText.split("(")[0].trim())
          }
        }
      }
    }

    for (let i = 0; i < modulesToImport.length; i++) {
      const mod = modulesToImport[i]
      if (!mod.name) continue
      const importItems: string[] = []
      if (items.length > 0) {
        for (let j = 0; j < items.length; j++) importItems.push(items[j])
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
      // DependsOn for imports
      ctx.relationships.push({
        source: mod.name,
        target: mod.name,
        type: RelationshipType.References,
        confidence: 0.9,
        metadata: { isHaskellImport: true },
      })

      if (mod.name.indexOf("Scotty") !== -1) ctx.frameworks["Scotty"] = true
      if (mod.name.indexOf("Servant") !== -1) ctx.frameworks["Servant"] = true
      if (mod.name.indexOf("QuickCheck") !== -1) ctx.frameworks["QuickCheck"] = true
      if (mod.name.indexOf("Database.Persist") !== -1) ctx.frameworks["Persistent"] = true
      if (mod.name.indexOf("Yesod") !== -1) ctx.frameworks["Yesod"] = true
    }
  }

  private processSignature(node: Node, ctx: HaskellContext) {
    const nameNode = this.findNamedChildByType(node, ["variable", "identifier", "varid"])
    const typeNode = this.findNamedChildByType(node, ["signature_type"], (t: string) => t.indexOf("type") !== -1)

    if (nameNode && typeNode) {
      ctx.typeSignatures[nameNode.text] = typeNode.text
    } else {
      const parts = node.text.split("::")
      if (parts.length === 2) {
        ctx.typeSignatures[parts[0].trim()] = parts[1].trim()
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
    const nameNode = this.findNamedChildByType(node, ["variable", "identifier", "varid"])
    if (nameNode) name = nameNode?.text || ""
    else if (node.namedChildCount > 0) name = node.namedChild(0)?.text || ""

    if (!name || name === "=" || name === "|" || node.parent?.type === "signature" || node.parent?.type === "function")
      return false

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
      scopeStack.push({ node, name, kind: existing.kind })
      return true
    }

    const typeSignature = ctx.typeSignatures[name]
    let isHigherOrder = false
    let returnType: string | undefined = undefined

    if (typeSignature && typeof typeSignature === "string") {
      // 3. Function Arity & Partial Application Fix
      // HOFs in Haskell have functions as arguments, meaning parens around an arrow: (a -> b)
      if (/\(.*\b->\b.*\)/.test(typeSignature)) {
        isHigherOrder = true
      }
      const parts = typeSignature.split("->")
      returnType = parts.pop()?.trim()
    }
    if (isHigherOrder) ctx.patterns["Higher-Order Functions"] = true

    const kind =
      currentScope && currentScope.kind === SymbolKind.Interface
        ? SymbolKind.Method
        : SymbolKind.Function

    ctx.symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name,
      ownerKind: currentScope?.kind,
      visibility: "public",
      returnType,
      metadata: { typeSignature, isHigherOrder, haskellSpecific: true },
    })
    ctx.functionSymbolIndex[functionKey] = ctx.symbols.length - 1

    scopeStack.push({ node, name, kind })
    return true
  }

  private processData(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Algebraic Data Types"] = true
    let name = ""
    const nameNode = this.findNamedChildByType(node, ["type", "type_constructor", "tycon", "type_name", "name"])

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
      kind: SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: "public",
      metadata: { haskellSpecific: true, isData: node.text.startsWith("data") },
    })

    const deriving = this.findNamedChildByType(node, ["deriving", "deriving_strategy"])
    if (deriving) {
      const derivedClasses = this.collectNamedChildrenByType(deriving, [
        "type",
        "type_constructor",
        "tycon",
        "type_name",
      ])
      for (let i = 0; i < derivedClasses.length; i++) {
        const dc = derivedClasses[i]
        ctx.relationships.push({
          source: name,
          target: dc?.text || "",
          type: RelationshipType.Implements,
          metadata: { derived: true },
        })
      }
    }

    scopeStack.push({ node, name, kind: SymbolKind.Type })
    return true
  }

  private processClass(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Type Classes"] = true
    let name = ""
    const nameNode = this.findNamedChildByType(node, [
      "type",
      "type_constructor",
      "tycon",
      "class_name",
      "type_name",
      "name",
    ])

    if (nameNode) name = nameNode.text
    else {
      const classIdx = this.findChildIndexByText(node, "class")
      if (classIdx !== -1 && node.childCount > classIdx + 1) {
        name = node.child(classIdx + 1)?.text || ""
      }
    }
    if (!name) return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    const superClasses = this.collectNamedChildrenByType(node, ["type", "type_constructor", "tycon"]);
    for (let i = 1; i < superClasses.length; i++) { if (superClasses[i]) { ctx.relationships.push({ source: name, target: superClasses[i].text, type: RelationshipType.Extends, metadata: { isSuperclass: true } }); } }
    ctx.symbols.push({
      name,
      kind: SymbolKind.Interface,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: "public",
      metadata: { haskellSpecific: true },
    })

    scopeStack.push({ node, name, kind: SymbolKind.Interface })
    return true
  }

  private processInstance(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    let className = ""
    let targetType = ""

    const typeNodes = this.collectNamedChildrenByType(node, [
      "type",
      "type_constructor",
      "tycon",
      "class_name",
      "type_name",
      "name",
      "type_patterns",
      "apply",
      "variable",
    ])
    if (typeNodes.length >= 2) {
      className = typeNodes[0]?.text || ""
      targetType = typeNodes[1]?.text || ""
    } else if (typeNodes.length === 1) {
      const parts = (typeNodes[0]?.text || "").split(/\s+/)
      if (parts.length >= 2) {
        className = parts[0]
        targetType = parts[1]
      }
    } else {
      const instIdx = this.findChildIndexByText(node, "instance")
      if (instIdx !== -1 && node.childCount > instIdx + 2) {
        className = node.child(instIdx + 1)?.text || ""
        targetType = node.child(instIdx + 2)?.text || ""
      }
    }

    const name = `${className} ${targetType}`.trim()
    if (!name || name === " ") return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    ctx.symbols.push({
      name,
      kind: SymbolKind.Class,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: "public",
      metadata: { haskellSpecific: true, className, targetType },
    })

    if (className && targetType) {
      ctx.relationships.push({
        source: targetType,
        target: className,
        type: RelationshipType.Implements,
        metadata: { isInstance: true },
      })
    }

    scopeStack.push({ node, name, kind: SymbolKind.Class })
    return true
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

  private namedChildAt(node: Node, index: number): Node | null {
    if (index < 0 || index >= node.namedChildCount) return null
    return node.namedChild(index)
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
