// @ts-nocheck — Ported from backbencher.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"

interface ElixirContext {
  symbols: UniversalSymbol[]
  relationships: UniversalRelationship[]
  imports: ImportInfo[]
  exports: ExportInfo[]
  errors: ParseError[]
  patterns: Record<string, boolean>
  frameworks: Record<string, boolean>
  content: string
  aliases: Record<string, string>
  functionHeads: Record<string, UniversalSymbol>
}

interface Scope {
  node: Node
  name: string
  kind: SymbolKind
}

const complexityNodes: Record<string, boolean> = {
  "if": true,
  "unless": true,
  "case": true,
  "cond": true,
  "receive": true,
  "def": true,
  "defp": true,
  "defmacro": true,
  "defmacrop": true,
  "with": true,
  "rescue": true,
  "catch": true,
  "after": true,
  "for": true,
  "function_clause": true,
  "do_block": true
}

export class RealElixirAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const ctx: ElixirContext = { 
        symbols: [], relationships: [], imports: [], exports: [], errors: [], 
        patterns: {}, frameworks: {}, content, 
        aliases: {}, functionHeads: {} 
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
          ctx.errors.push({ message: `Syntax ${node.type} detected.`, range: this.nodeToRange(node), severity: "warning" })
        }
      }

      let pushedScope = false
      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
      
      if (node.type === "call") {
         const targetNode = this.findChild(node, (c) => c?.type === "identifier" || c?.type === "dot")
         const t = targetNode?.text || ""
         if (complexityNodes[t]) cyclomaticComplexity++

         if (t) {
            if (t === "defmodule") pushedScope = this.processModule(node, ctx, currentScope, scopeStack)
            else if (t === "def" || t === "defp" || t === "defmacro" || t === "defmacrop") this.processFunction(node, t, ctx, currentScope)
            else if (t === "defprotocol") pushedScope = this.processProtocol(node, ctx, currentScope, scopeStack)
            else if (t === "defimpl") pushedScope = this.processImpl(node, ctx, currentScope, scopeStack)
            else if (t === "defstruct") this.processStruct(node, ctx, currentScope)
            else if (t === "use" || t === "import" || t === "alias" || t === "require") this.processDirective(node, t, ctx, currentScope)
            else {
                if (t === "send" || t === "send_after") {
                ctx.patterns["Actor Model (OTP)"] = true
                ctx.patterns["Message Passing"] = true
                this.recordCall(t, ctx, currentScope, { isMessagePass: true, isSend: true })
              } else if (t === "spawn" || t === "spawn_link" || t === "spawn_monitor" || t === "Task.async" || t === "Task.start" || t === "Task.start_link" || t === "Agent.start" || t === "Agent.start_link") {
                ctx.patterns["Actor Model (OTP)"] = true
                ctx.patterns["Process Spawning"] = true
                this.recordCall(t, ctx, currentScope, { isProcessSpawn: true })
              } else { this.recordCall(t, ctx, currentScope) }
            }
         }
      } else if (node.type === "identifier" && currentScope?.name) {
        // Variable/function reference in function bodies
        const parent = node.parent
        if (parent?.type !== "call" && parent?.type !== "binary_operator" && parent?.type !== "stab_clause" &&
            !["defmodule","def","defp","defmacro","defprotocol","defimpl","defstruct"].includes(node.text)) {
          ctx.relationships.push({
            source: currentScope.name,
            target: node.text,
            type: RelationshipType.References,
            confidence: 0.6,
            metadata: { elixirSpecific: true, isVariableRef: true }
          })
        }
      } else if (node.type === "unary_operator" && node.child(0)?.text === "@") {
        const attrName = node.child(1)?.text
        const attrValue = node.parent?.namedChildren?.find((n: any) => n !== node)?.text || ""
        if (attrName === "moduledoc" || attrName === "doc") ctx.patterns["Documentation"] = true
        if (attrName === "spec" || attrName === "type" || attrName === "typep" || attrName === "opaque") ctx.patterns["Typespecs"] = true
        if (attrName === "callback" || attrName === "macrocallback") ctx.patterns["Behaviours"] = true
        if (attrName === "behaviour" || attrName === "behavior") {
          const bhv = attrValue.replace(/['"]/g, "").trim()
          if (bhv) {
            ctx.relationships.push({ source: currentScope?.name || "Global", target: bhv, type: RelationshipType.Implements, confidence: 0.9, metadata: { elixirSpecific: true, isBehaviour: true } })
          }
        }
      } else if (node.type === "case_clause" || node.type === "cond_clause" || node.type === "receive_clause" || node.type === "try_clause") {
          cyclomaticComplexity++;
      } else if (node.type === "anonymous_function" || node.type === "stab_clause") {
        // fn x -> x + 1  or  &(&1 + 1)
        const name = "lambda_" + node.startPosition.row + "_" + node.startPosition.column
        ctx.symbols.push({
          name, kind: SymbolKind.Function, range: this.nodeToRange(node),
          scope: currentScope?.name || "", ownerName: currentScope?.name, ownerKind: currentScope?.kind,
          visibility: "private", metadata: { elixirSpecific: true, isAnonymous: true, isLambda: true }
        })
      } else if (node.type === "binary_operator") {
          const op = node.child(1)?.text
          if (op === "|>") {
             ctx.patterns["Pipe Operator"] = true
             const right = node.child(2)
             if (right) {
                 let targetName = ""
                 if (right.type === "call") {
                     const rId = this.findChild(right, (c) => c?.type === "identifier" || c?.type === "dot")
                     if (rId) targetName = rId.text
                 } else if (right.type === "identifier" || right.type === "dot") {
                     targetName = right.text
                 }
                 if (targetName) this.recordCall(targetName, ctx, currentScope, { isPipe: true })
             }
          }
          if (op === "and" || op === "or" || op === "&&" || op === "||") cyclomaticComplexity++
      } else if (node.type === "dot") {
          const left = node.child(0)?.text
          if (left === "Enum" || left === "Stream") ctx.patterns["Functional Programming"] = true
      } else if (node.type === "match" || node.type === "case" || node.type === "cond" || node.type === "receive") {
          ctx.patterns["Pattern Matching"] = true
          if (node.type === "receive") ctx.patterns["Actor Model (OTP)"] = true
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

    const frameworkPatterns: { framework: string, patterns: { type: string, detected: boolean, description: string }[] }[] = []
    for (let i = 0; i < frameworks.length; i++) {
        frameworkPatterns.push({
            framework: frameworks[i],
            patterns: [{ type: "usage", detected: true, description: `${frameworks[i]} usage detected` }]
        })
    }

    for (const s of ctx.symbols) {
      const isModLevel = !s.ownerName || s.ownerName === s.name
      const isPub = s.visibility === "public"
      const isExp = [SymbolKind.Module, SymbolKind.Function, SymbolKind.Interface, SymbolKind.Struct].includes(s.kind)
      if (isModLevel && isPub && isExp) { ctx.exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility }) }
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

    return {
      language: "elixir", symbols: ctx.symbols, relationships: ctx.relationships, imports: ctx.imports, exports: ctx.exports, errors: ctx.errors,
      metadata: {
        complexity: ctx.symbols.length + ctx.relationships.length, linesOfCode: content.split("\n").length, cyclomaticComplexity, framework: frameworks[0], patterns: patterns,
        detectedFrameworks: frameworks, frameworkPatterns,
        architecturalScore: Math.min(100, Math.max(0, 100 - ctx.errors.length * 5)), codeQuality: ctx.errors.length === 0 ? "Excellent" : "Fair", hasTypeInference: false, hasFrameworkIntelligence: true, analysisVersion: "10.0.0-elixir-dfs-strict"
      }
    }
  }

  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && predicate(child)) return child;
      }
      return null;
    }
  
    private filterChildren(node: Node, predicate: (child: Node) => boolean): Node[] {
      const res: Node[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && predicate(child)) res.push(child);
      }
      return res;
    }

  private extractName(node: Node): string {
      let aliasNode = this.findChild(node, (c) => c?.type === "alias")
      if (aliasNode) return aliasNode.text
      if (node.namedChildCount > 0) {
          const first = node.namedChild(0)
          if (first?.type === "alias" || first?.type === "identifier") return first.text
          if (first?.type === "dot") return first.text
      }
      return node.text.replace(/[()]/g, "").trim()
  }

  private recordCall(targetName: string, ctx: ElixirContext, currentScope: Scope | undefined, meta: any = {}) {
      let finalTarget = targetName
      const parts = targetName.split(".")
      if (parts.length > 1) {
          const root = parts[0]
          if (ctx.aliases[root]) {
              parts[0] = ctx.aliases[root]!
              finalTarget = parts.join(".")
          }
      }
      ctx.relationships.push({ source: currentScope?.name || "Global", target: finalTarget, type: RelationshipType.Calls, metadata: { elixirSpecific: true, ...meta } })
      // Elixir struct/module instantiation: %StructName{} or ModuleName.new()
      if (finalTarget && (finalTarget[0] === finalTarget[0].toUpperCase() && finalTarget[0] !== finalTarget[0].toLowerCase())) {
        ctx.relationships.push({ source: currentScope?.name || "Global", target: finalTarget, type: RelationshipType.Instantiates, confidence: 0.7, metadata: { elixirSpecific: true, isStruct: true } })
      }
  }

  private processModule(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    const name = this.extractName(argsNode)
    const fullName = currentScope ? `${currentScope.name}.${name}` : name
    const symbol: UniversalSymbol = {
        name: fullName, kind: SymbolKind.Module, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public",
        metadata: { elixirSpecific: true }
    }
    ctx.symbols.push(symbol)
    scopeStack.push({ node, name: fullName, kind: SymbolKind.Module })
    return true
  }

  private processProtocol(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    const name = this.extractName(argsNode)
    const fullName = currentScope ? `${currentScope.name}.${name}` : name
    ctx.symbols.push({ name: fullName, kind: SymbolKind.Interface, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocol: true } })
    scopeStack.push({ node, name: fullName, kind: SymbolKind.Interface })
    return true
  }

  private processImpl(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    let protocol = "Unknown", forType = "Unknown"
    const parts = argsNode.text.split(",")
    protocol = parts[0]?.trim() || "Unknown"
    if (parts.length > 1 && parts[1].indexOf("for:") !== -1) {
        const p2 = parts[1].split("for:")
        if (p2.length > 1) forType = p2[1].trim()
    }
    
    const aliases = this.filterChildren(argsNode, (c) => c?.type === "alias")
    if (aliases.length > 0 && aliases[0]) protocol = aliases[0].text
    
    const fullName = `${protocol}.${forType}`
    ctx.symbols.push({ name: fullName, kind: SymbolKind.Class, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocolImplementation: true } })
    ctx.relationships.push({ source: fullName, target: protocol, type: RelationshipType.Implements, metadata: {} })
    scopeStack.push({ node, name: fullName, kind: SymbolKind.Class })
    return true
  }

  private processStruct(node: Node, ctx: ElixirContext, currentScope: Scope | undefined) {
    const structName = currentScope ? `%${currentScope.name}{}` : "struct"
     ctx.symbols.push({ name: structName, kind: SymbolKind.Struct, range: this.nodeToRange(node), scope: currentScope?.name || "", ownerName: currentScope?.name, ownerKind: currentScope?.kind, visibility: "public", metadata: { elixirSpecific: true, isStruct: true } })
  }

  private processFunction(node: Node, defType: string, ctx: ElixirContext, currentScope: Scope | undefined) {
    const sigNodes = this.filterChildren(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (sigNodes.length === 0) return

    let actualCall: Node | undefined
    let guardList: string[] = []
    let name = "Unknown"
    let hasPattern = false
    const parameters: Parameter[] = []

    let sigNode = sigNodes[0]
    if (sigNode && sigNode.type === "arguments" && sigNode.namedChildCount > 0) {
        const first = sigNode.namedChild(0)
        if (first) sigNode = first
    }

    if (sigNode) {
       if (sigNode.type === "binary_operator" && sigNode.childCount > 1 && sigNode.child(1)?.text === "when") {
          const guardExpr = sigNode.childCount > 2 ? sigNode.child(2) : null
          if (guardExpr) guardList.push(guardExpr.text)
          actualCall = sigNode.childCount > 0 ? sigNode.child(0) || undefined : undefined
          ctx.patterns["Pattern Matching"] = true
          hasPattern = true
       } else {
          actualCall = sigNode
       }
    }

    if (actualCall) {
        if (actualCall.type === "call") {
            const innerId = this.findChild(actualCall, (c) => c?.type === "identifier")
            if (innerId) name = innerId.text
            const innerArgs = this.findChild(actualCall, (c) => c?.type === "arguments")
            if (innerArgs) {
               for (let i=0; i < innerArgs.namedChildCount; i++) {
                   const argChild = innerArgs.namedChild(i)
                   if (!argChild) continue
                   parameters.push({ name: argChild.text, type: "dynamic" })
                   if (argChild.text.indexOf(":") !== -1 || argChild.text.indexOf("%") !== -1 || argChild.text.indexOf("_") !== -1 || argChild.text.startsWith("[")) {
                       hasPattern = true
                       ctx.patterns["Pattern Matching"] = true
                   }
               }
            }
        } else if (actualCall.type === "identifier") {
            name = actualCall.text
        } else if (actualCall.type === "binary_operator") {
            name = actualCall.childCount > 1 ? actualCall.child(1)?.text || "Unknown" : "Unknown"
            parameters.push({ name: actualCall.childCount > 0 ? actualCall.child(0)?.text || "left" : "left", type: "dynamic" })
            parameters.push({ name: actualCall.childCount > 2 ? actualCall.child(2)?.text || "right" : "right", type: "dynamic" })
        }
    }

    const visibility = (defType === "defp" || defType === "defmacrop") ? "private" : "public"
    let isGenCallback = false, isSupCallback = false
    
    if (name === "init" || name === "handle_call" || name === "handle_cast" || name === "handle_info" || name === "terminate") isGenCallback = true
    
    let isSupervisor = false
    if (currentScope) {
        for (let i = 0; i < ctx.symbols.length; i++) {
            if (ctx.symbols[i].name === currentScope.name && ctx.symbols[i].metadata?.isSupervisor) {
                isSupervisor = true
                break
            }
        }
    }
    
    if (name === "init" && isSupervisor) isSupCallback = true

    const arity = parameters.length
    const fnId = `${currentScope?.name || ""}.${name}/${arity}`

    if (ctx.functionHeads[fnId]) {
        const existing = ctx.functionHeads[fnId]!
        existing.metadata!.heads = (existing.metadata!.heads as number) + 1
        if (hasPattern) existing.metadata!.hasPatternMatching = true
        if (guardList.length > 0) {
            let existingGuards = existing.metadata!.guards as string[] || []
            for (let i = 0; i < guardList.length; i++) {
                existingGuards.push(guardList[i])
            }
            existing.metadata!.guards = existingGuards
        }
        return
    }

    const symbol: UniversalSymbol = {
        name, kind: SymbolKind.Function, range: this.nodeToRange(node), scope: currentScope?.name || "", ownerName: currentScope?.name, ownerKind: currentScope?.kind, visibility, parameters,
        metadata: { elixirSpecific: true, isMacro: defType.indexOf("macro") !== -1, arity, heads: 1, hasPatternMatching: hasPattern, guards: guardList, isGenServerCallback: isGenCallback, isSupervisorCallback: isSupCallback }
    }
    ctx.symbols.push(symbol)
    ctx.functionHeads[fnId] = symbol
  }

  private processDirective(node: Node, target: string, ctx: ElixirContext, currentScope: Scope | undefined) {
     const argsNode = this.findChild(node, (c) => c?.type !== "identifier")
     if (!argsNode) return
     const moduleName = this.extractName(argsNode)
     
     if (target === "alias") {
         const parts = moduleName.split(".")
         const defaultAs = parts[parts.length - 1]
         if (defaultAs) ctx.aliases[defaultAs] = moduleName
     } else if (target === "use") {
         if (moduleName.indexOf("Plug") !== -1 && moduleName.indexOf("Plug.") === -1) ctx.frameworks["Plug"] = true
         if (moduleName.indexOf("Phoenix.Controller") !== -1) ctx.frameworks["Phoenix"] = true
         if (moduleName.indexOf("Phoenix.LiveView") !== -1) ctx.frameworks["Phoenix LiveView"] = true
         if (moduleName.indexOf("Ecto.Schema") !== -1) ctx.frameworks["Ecto"] = true
         if (moduleName.indexOf("Phoenix.PubSub") !== -1 || moduleName.indexOf("Phoenix.Channel") !== -1) ctx.frameworks["Phoenix Channels"] = true
         if (moduleName.indexOf("Broadway") !== -1) ctx.frameworks["Broadway"] = true
         if (moduleName.indexOf("GenServer") !== -1) {
             ctx.patterns["Actor Model (OTP)"] = true
             if (currentScope) {
                let sym: UniversalSymbol | undefined
                for (let i = 0; i < ctx.symbols.length; i++) {
                    if (ctx.symbols[i].name === currentScope.name) {
                        sym = ctx.symbols[i]
                        break
                    }
                }
                if (sym && sym.metadata) { sym.metadata.isGenServer = true; sym.metadata.otpBehavior = "GenServer" }
             }
         }
         if (moduleName.indexOf("Supervisor") !== -1) {
             ctx.patterns["Supervision Trees"] = true
             ctx.patterns["Actor Model (OTP)"] = true
             if (currentScope) {
                let sym: UniversalSymbol | undefined
                for (let i = 0; i < ctx.symbols.length; i++) {
                    if (ctx.symbols[i].name === currentScope.name) {
                        sym = ctx.symbols[i]
                        break
                    }
                }
                if (sym && sym.metadata) { sym.metadata.isSupervisor = true; sym.metadata.otpBehavior = "Supervisor" }
             }
         }
     } else if (target === "import") {
         if (moduleName.indexOf("Ecto") !== -1) ctx.frameworks["Ecto"] = true
     }
     
     if (target === "import" || target === "alias" || target === "require") {
         ctx.imports.push({ module: moduleName, source: moduleName, imported: ["*"], isTypeOnly: false, range: this.nodeToRange(node) })
          ctx.relationships.push({ source: currentScope?.name || "Global", target: (argsNode.text || "").replace(/".*"/, "").trim() || node.text, type: RelationshipType.Uses, confidence: 0.8, metadata: { elixirSpecific: true, directiveType: target } })
          ctx.relationships.push({ source: currentScope?.name || "Global", target: moduleName, type: RelationshipType.References, confidence: 0.9, metadata: { elixirSpecific: true, isModuleDep: true } })
     }
  }

  private nodeToRange(node: Node): UniversalSymbol["range"] {
    return { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1, startIndex: node.startIndex, endIndex: node.endIndex }
  }
}
