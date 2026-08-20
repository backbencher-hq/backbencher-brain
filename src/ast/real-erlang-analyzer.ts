import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

const OTP_BEHAVIOURS = new Set(["gen_server", "gen_statem", "gen_event", "supervisor", "application"])

interface ErlangContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  seenRels: Set<string>
  seenImports: Set<string>
  // Every function name declared in this file (one module per file), collected
  // by a pre-pass so local calls to LATER-defined functions resolve.
  declaredFunctions: Set<string>
  // Function symbols already emitted (dedup across multi-clause fun_decl).
  registeredFunctions: Set<string>
  currentModule: string | undefined
  currentFunction: string | undefined
}

export class RealErlangAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: ErlangContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      seenRels: new Set(),
      seenImports: new Set(),
      declaredFunctions: new Set(),
      registeredFunctions: new Set(),
      currentModule: undefined,
      currentFunction: undefined,
    }
    let cyclomaticComplexity = 1

    // Pre-pass: collect every function name in the file so local calls resolve
    // even when the callee is defined LATER (forward references).
    this.collectDeclaredFunctions(rootNode, ctx.declaredFunctions)

    const stack: { node: Node; isExit?: boolean }[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const { node, isExit } = stack.pop()!
      if (isExit) {
        if (node.type === "fun_decl") ctx.currentFunction = undefined
        continue
      }
      const type = node.type
      const currentLine = node.startPosition.row + 1
      let pushedScope = false

      // ---- -include / -include_lib (pp_include / pp_include_lib) ----
      if (type === "include_attribute" || type === "include_lib_attribute" || type === "pp_include" || type === "pp_include_lib") {
        const fNode = this.getChildByType(node, "string") || this.getChildByType(node, "string_literal")
        if (fNode) {
          const includePath = this.stripQuotes(fNode.text)
          ctx.imports.push({ module: includePath, file: includePath, line: currentLine, isNif: false })
          this.pushRel(ctx, ctx.currentModule || filePath, includePath, ASTEngine.RelationshipType.References, 0.9, {
            erlangSpecific: true, isInclude: type === "include_attribute" || type === "pp_include", isLibInclude: type === "include_lib_attribute" || type === "pp_include_lib",
          })
        }
      }

      // ---- -module(...) ----
      else if (type === "module_attribute") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          ctx.currentModule = nameNode.text
          ctx.symbols.push({
            name: ctx.currentModule,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            metadata: { nodeType: "module_attribute" },
          })
        }
      }

      // ---- -behaviour(gen_server). / -behaviour(my_behaviour). ----
      else if (type === "behaviour_attribute") {
        const beNode = this.getChildByType(node, "atom")
        if (beNode?.text) {
          // Any behaviour is a cross-module contract: the Implements edge only,
          // never a standalone symbol. OTP behaviours additionally mark the
          // OTP patterns.
          this.pushRel(ctx, ctx.currentModule || filePath, beNode.text, ASTEngine.RelationshipType.Implements, 1.0, {
            erlangSpecific: true,
            behaviour: beNode.text,
            context: "OTP behaviour callback implementation",
          })
          if (OTP_BEHAVIOURS.has(beNode.text)) {
            ctx.patterns["Actor Model (OTP)"] = true
            ctx.patterns["OTP Behaviours"] = true
          }
        }
      }

      // ---- -export([greet/1, add/2]). ----
      else if (type === "export_attribute") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "fa") {
            const nameNode = this.getChildByType(child, "atom")
            const arityNode = this.getChildByType(child, "integer") || this.getChildByType(child, "arity")
            if (nameNode?.text) {
              const arity = arityNode ? parseInt(this.keepDigits(arityNode.text)) || 0 : 0
              ctx.exports.push({ name: nameNode.text, arity, file: filePath, line: currentLine })
            }
          }
        }
      }

      // ---- -import(lists, [map/2]). ----
      else if (type === "import_attribute") {
        const modNode = this.getChildByType(node, "atom")
        const funcs: string[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "fa") {
            const faName = this.getChildByType(child, "atom")
            if (faName?.text) funcs.push(faName.text)
          }
        }
        if (modNode?.text) {
          ctx.imports.push({ module: modNode.text, functions: funcs, file: "", line: currentLine, isNif: false })
          this.pushRel(ctx, ctx.currentModule || filePath, modNode.text, ASTEngine.RelationshipType.References, 1.0, {
            erlangSpecific: true, isModuleImport: true, importedFunctions: funcs,
          })
        }
      }

      // ---- -nifs([...]) / -on_load(...) ----
      else if (type === "wild_attribute") {
        const attrNameNode = this.getChildByType(node, "attr_name")
        if (attrNameNode?.text === "nifs" || attrNameNode?.text === "on_load") {
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child?.type === "fa") {
              const nifName = this.getChildByType(child, "atom")
              if (nifName?.text) {
                ctx.symbols.push({
                  name: nifName.text,
                  kind: ASTEngine.SymbolKind.Function,
                  range: this.nodeToRange(node),
                  ownerName: ctx.currentModule,
                  metadata: { nodeType: attrNameNode.text, isNif: true },
                })
              }
            }
          }
        }
      }

      // ---- -record(person, {name, age}). ----
      else if (type === "record_decl") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          const recordName = nameNode.text
          const fields: string[] = []
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child?.type === "record_field") {
              const fieldNameNode = this.getChildByType(child, "atom")
              if (fieldNameNode?.text) {
                fields.push(fieldNameNode.text)
                // Record fields → property symbols owned by the record (struct),
                // matching the universal struct-field contract (C/Rust/Zig).
                ctx.symbols.push({
                  name: fieldNameNode.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(child),
                  ownerName: recordName,
                  ownerKind: ASTEngine.SymbolKind.Struct,
                  metadata: { nodeType: "record_field", isRecordField: true },
                })
              }
            }
          }
          ctx.symbols.push({
            name: recordName,
            kind: ASTEngine.SymbolKind.Struct,
            range: this.nodeToRange(node),
            ownerName: ctx.currentModule,
            metadata: { nodeType: "record_decl", fields },
          })
        }
      }

      // ---- -define(MACRO, value). (pp_define) ----
      else if (type === "define" || type === "pp_define") {
        let macroName = ""
        const macroLhs = this.getChildByType(node, "macro_lhs")
        if (macroLhs) {
          const varNode = this.getChildByType(macroLhs, "var") || this.getChildByType(macroLhs, "atom")
          macroName = varNode?.text || ""
        }
        if (!macroName) {
          const atomNode = this.getChildByType(node, "macro_name") || this.getChildByType(node, "atom")
          if (atomNode && atomNode.text !== "define") macroName = atomNode.text
        }
        if (macroName) {
          ctx.symbols.push({
            name: macroName,
            kind: ASTEngine.SymbolKind.Constant,
            range: this.nodeToRange(node),
            ownerName: ctx.currentModule,
            metadata: { nodeType: "macro_definition", isMacro: true },
          })
        }
      }

      // ---- -type name() :: ... / -type maybe(T) :: ... ----
      else if (type === "type_alias") {
        const typeNameNode = this.getChildByType(node, "type_name")
        const typeName = typeNameNode?.text ? this.stripFirstParen(typeNameNode.text) : this.getChildByType(node, "atom")?.text
        if (typeName) {
          ctx.symbols.push({
            name: typeName,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            ownerName: ctx.currentModule,
            metadata: { nodeType: "type_alias" },
          })
        }
      }

      // ---- -spec name(...) :: ... ----
      else if (type === "spec") {
        // Specs are type annotations for the function that follows; the function
        // declaration itself emits the symbol. Record nothing standalone.
      }

      // ---- ! (message send — binary_op_expr in this grammar) ----
      else if (type === "binary_op_expr") {
        const op = node.child(1)?.text
        if (op === "!") {
          ctx.patterns["Message Passing"] = true
          ctx.patterns["Actor Model (OTP)"] = true
        }
        if (op === "andalso" || op === "orelse") cyclomaticComplexity++
      }

      // ---- #person{name = Name} (record_expr — construction only) ----
      else if (type === "record_expr") {
        // Record updates (State#state{...}) and accesses (State#state.q) are
        // record_update_expr / record_field_expr node types — NOT construction.
        // A record_expr in a function head (expr_args, before clause_body) is a
        // PATTERN, not a construction site.
        if (!this.isInFunHead(node)) {
          const nameNode = this.getChildByType(node, "record_name") || this.getChildByType(node, "atom")
          const recordName = nameNode ? this.stripLeadingHash(nameNode.text) : ""
          if (recordName) {
            this.pushRel(ctx, ctx.currentFunction || ctx.currentModule || "Global", recordName, ASTEngine.RelationshipType.Instantiates, 1.0, {
              erlangSpecific: true, isRecordExpr: true,
            })
          }
        }
      }

      // ---- fun_decl (function definition) ----
      else if (type === "fun_decl") {
        const funcClauses = this.collectChildrenByType(node, "function_clause")
        let funcName = ""
        let symbolRegistered = false
        for (const funcClause of funcClauses) {
          if (!funcClause) continue
          const nameNode = this.getChildByType(funcClause, "atom") || this.getChildByType(funcClause, "var")
          if (nameNode?.text) {
            funcName = nameNode.text
            const funcLine = funcClause.startPosition.row + 1
            if (!symbolRegistered && ctx.currentModule) {
              const fullKey = `${ctx.currentModule}:${funcName}`
              if (!ctx.registeredFunctions.has(fullKey)) {
                ctx.registeredFunctions.add(fullKey)
                ctx.symbols.push({
                  name: funcName,
                  kind: ASTEngine.SymbolKind.Function,
                  range: this.nodeToRange(node),
                  ownerName: ctx.currentModule,
                  metadata: { nodeType: "function_clause", clauseCount: funcClauses.length },
                })
              }
              symbolRegistered = true
            }
            // Extract calls from EVERY clause
            this.extractCallsFromFunction(funcClause, ctx, funcName, funcLine)
          }
        }
        if (funcName) {
          ctx.currentFunction = funcName
          pushedScope = true
        }
      }

      // ---- receive ... end ----
      else if (type === "receive_expr") {
        ctx.patterns["Message Reception (receive)"] = true
        ctx.patterns["Actor Model (OTP)"] = true
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "receive_after") {
            cyclomaticComplexity++
            ctx.patterns["Receive with Timeout"] = true
          }
        }
      }

      // ---- case / if / try decision points ----
      else if (type === "case_expr" || type === "if_expr" || type === "try_expr") {
        cyclomaticComplexity++
      }

      // ---- function clauses (each is a branch) ----
      else if (type === "function_clause" || type === "fun_clause") {
        cyclomaticComplexity++
      }

      if (pushedScope) stack.push({ node, isExit: true })
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push({ node: child })
      }
    }

    // Post-loop: contains for owned symbols — module → its types/constants/
    // records/functions/nifs; record → its fields (record-name source).
    for (const s of ctx.symbols) {
      const _owner = s.ownerName
      if (_owner) {
        this.pushRel(ctx, _owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, { erlangSpecific: true, isModuleMember: true })
      }
    }

    if (ctx.currentModule) ctx.patterns["OTP Module"] = true
    const pa: string[] = []
    for (const k in ctx.patterns) pa.push(k)

    return {
      language: "erlang",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        patterns: pa,
        framework: "Erlang",
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  // ==========================================================================
  // Relationship emission (dedupe by source|type|target identity).
  // ==========================================================================
  private pushRel(
    ctx: ErlangContext,
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
  // Pure-string helpers (no regex).
  // ==========================================================================
  private stripQuotes(text: string): string {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '"' || ch === "'") continue
      out += ch
    }
    return out
  }

  private keepDigits(text: string): string {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch >= "0" && ch <= "9") out += ch
    }
    return out
  }

  // `name()` → `name`; `maybe(T)` → `maybe` (strip the parameter list).
  private stripFirstParen(text: string): string {
    const paren = text.indexOf("(")
    return (paren >= 0 ? text.slice(0, paren) : text).trim()
  }

  private stripLeadingHash(text: string): string {
    return text.length > 0 && text[0] === "#" ? text.slice(1) : text
  }

  // ==========================================================================
  // Pre-pass: declared function names (forward-reference resolution).
  // ==========================================================================
  private collectDeclaredFunctions(node: Node, out: Set<string>): void {
    if (node.type === "fun_decl") {
      const clauses = this.collectChildrenByType(node, "function_clause")
      for (const c of clauses) {
        const nameNode = this.getChildByType(c, "atom") || this.getChildByType(c, "var")
        if (nameNode?.text) out.add(nameNode.text)
      }
      return
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) this.collectDeclaredFunctions(child, out)
    }
  }

  // A record_expr directly in a function head (expr_args before clause_body) is
  // a pattern match, not a construction site.
  private isInFunHead(node: Node): boolean {
    let cur = node.parent
    while (cur) {
      if (cur.type === "clause_body") return false
      if (cur.type === "function_clause" || cur.type === "fun_clause") return true
      cur = cur.parent
    }
    return false
  }

  // ==========================================================================
  // Call extraction (per function clause).
  // ==========================================================================
  private extractCallsFromFunction(
    funcNode: Node,
    ctx: ErlangContext,
    funcName: string,
    lineNumber: number,
  ) {
    const stack: Node[] = [funcNode]

    while (stack.length > 0) {
      const node = stack.pop()!

      if (node.type === "call") {
        const callee = node.namedChild(0)
        const calleeText = callee?.text || ""

        // OTP process spawning — pattern only (spawn is a BIF, not a local
        // function; the FP-family builtin-exclusion rule).
        if (calleeText === "spawn" || calleeText === "spawn_link" || calleeText === "spawn_monitor") {
          ctx.patterns["Actor Model (OTP)"] = true
          ctx.patterns["Process Spawning"] = true
        }

        // Remote call: io:format(...) → calls func -> io:format
        const remoteNode = this.getChildByType(node, "remote")
        if (remoteNode) {
          const atoms: string[] = []
          this.collectAtoms(remoteNode, atoms)
          if (atoms.length >= 2) {
            this.pushRel(ctx, funcName, `${atoms[0]}:${atoms[1]}`, ASTEngine.RelationshipType.Calls, 0.9, {
              erlangSpecific: true, context: "remote function call",
            })
          }
        } else if (callee?.type === "atom" && calleeText && ctx.currentModule) {
          // Local call: only when the callee is declared in this file
          // (forward references resolve via the pre-pass). BIFs (length, self,
          // element, ...) and imported functions are not local symbols.
          if (ctx.declaredFunctions.has(calleeText)) {
            this.pushRel(ctx, funcName, calleeText, ASTEngine.RelationshipType.Calls, 0.9, {
              erlangSpecific: true, context: "local function call",
            })
          }
        }
      }

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push(child)
      }
    }
  }

  private collectAtoms(node: Node, atoms: string[]) {
    if (node.type === "atom" && node.isNamed && node.text) {
      atoms.push(node.text)
    }
    for (let i = 0; i < node.childCount; i++) {
      this.collectAtoms(node.child(i)!, atoms)
    }
  }

  private getChildByType(node: Node, targetType: string): Node | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === targetType) return child
    }
    return undefined
  }

  private collectChildrenByType(node: Node, targetType: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === targetType) results.push(child)
    }
    return results
  }

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
}
