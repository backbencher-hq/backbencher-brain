import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

const OTP_BEHAVIOURS = new Set(["gen_server", "gen_statem", "gen_event", "supervisor", "application"])

export class RealErlangAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    let currentModule: string | undefined
    let currentLine = 0

    const stack: Node[] = [rootNode]
    const seenFuncalls = new Set<string>()
    const registeredFunctions = new Set<string>() // Dedup across fun_decl clauses
    const patterns: Record<string, boolean> = {}

    while (stack.length > 0) {
      const node = stack.pop()!
      const type = node.type
      currentLine = node.startPosition.row + 1

      // ---- -include / -include_lib (pp_include / pp_include_lib) ----
      if (type === "include_attribute" || type === "include_lib_attribute" || type === "pp_include" || type === "pp_include_lib") {
        const fNode = this.getChildByType(node, "string") || this.getChildByType(node, "string_literal")
        if (fNode) {
          const includePath = fNode.text.replace(/['"]/g, "")
          imports.push({ module: includePath, file: includePath, line: currentLine, isNif: false })
          if (currentModule || filePath) {
            relationships.push({
              source: currentModule || filePath,
              target: includePath,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              metadata: { erlangSpecific: true, isInclude: type === "include_attribute" || type === "pp_include", isLibInclude: type === "include_lib_attribute" || type === "pp_include_lib" },
            })
          }
        }
      }

      // ---- -module(...) ----
      else if (type === "module_attribute") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          currentModule = nameNode.text
          symbols.push({
            name: currentModule,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            metadata: { nodeType: "module_attribute" },
          })
        }
      }

      // ---- -behaviour(gen_server). ----
      else if (type === "behaviour_attribute") {
        const beNode = this.getChildByType(node, "atom")
        if (beNode?.text && OTP_BEHAVIOURS.has(beNode.text)) {
          // The behaviour is a cross-module contract, not a declaration in this
          // file: emit the Implements edge only, never a standalone symbol.
          relationships.push({
            source: currentModule || filePath,
            target: beNode.text,
            type: ASTEngine.RelationshipType.Implements,
            confidence: 1.0,
            metadata: {
              erlangSpecific: true,
              behaviour: beNode.text,
              context: "OTP behaviour callback implementation",
            },
          })
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
              const arity = arityNode ? parseInt(arityNode.text.replace(/\D/g, "")) || 0 : 0
              exports.push({
                name: nameNode.text,
                arity,
                file: filePath,
                line: currentLine,
              })
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
          imports.push({
            module: modNode.text,
            functions: funcs,
            file: "",
            line: currentLine,
            isNif: false,
          })
          relationships.push({
            source: currentModule || filePath,
            target: modNode.text,
            type: ASTEngine.RelationshipType.References,
            confidence: 1.0,
            metadata: { erlangSpecific: true, isModuleImport: true, importedFunctions: funcs },
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
                symbols.push({
                  name: nifName.text,
                  kind: ASTEngine.SymbolKind.Function,
                  range: this.nodeToRange(node),
                  ownerName: currentModule,
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
                symbols.push({
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
          symbols.push({
            name: recordName,
            kind: ASTEngine.SymbolKind.Struct,
            range: this.nodeToRange(node),
            ownerName: currentModule,
            metadata: { nodeType: "record_decl", fields },
          })
          // Contains: record → each field
          for (const field of fields) {
            relationships.push({
              source: `${currentModule ? currentModule + ":" : ""}${recordName}`,
              target: field,
              type: ASTEngine.RelationshipType.Contains,
              confidence: 1.0,
              metadata: { erlangSpecific: true, recordField: true },
            })
          }
        }
      }

      // ---- -define(MACRO, value). (pp_define) ----
      else if (type === "define" || type === "pp_define") {
        // Grammar: pp_define → macro_lhs → var(MAX_AGE)
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
          symbols.push({
            name: macroName,
            kind: ASTEngine.SymbolKind.Constant,
            range: this.nodeToRange(node),
            ownerName: currentModule,
            metadata: { nodeType: "macro_definition", isMacro: true },
          })
        }
      }

      // ---- -type name() :: ... ----
      else if (type === "type_alias") {
        const typeNameNode = this.getChildByType(node, "type_name")
        const typeName = typeNameNode?.text?.replace(/\(\)$/, "") || this.getChildByType(node, "atom")?.text
        if (typeName) {
          symbols.push({
            name: typeName,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            ownerName: currentModule,
            metadata: { nodeType: "type_alias" },
          })
        }
      }

      // ---- -spec name(...) :: ... ----
      else if (type === "spec") {
        // Specs are type annotations for the function that follows; the function
        // declaration itself emits the symbol. Record nothing as a standalone
        // symbol — avoids phantom interface/function duplicates.
      }

      // ---- ! (send_expression) ----
      else if (type === "send_expression") {
        const destNode = this.getChildByType(node, "atom") || node.namedChild(0)
        if (destNode && currentModule) {
          relationships.push({
            source: currentModule,
            target: destNode.text,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.8,
            metadata: { erlangSpecific: true, isMessagePass: true },
          })
        }
      }

      // ---- #person{name = Name, age = Age} (record_expr) ----
      else if (type === "record_expr") {
        const nameNode = this.getChildByType(node, "record_name") || this.getChildByType(node, "atom")
        const recordName = nameNode?.text?.replace(/^#/, "") || ""
        if (recordName && currentModule) {
          relationships.push({
            source: currentModule,
            target: recordName,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 1.0,
            metadata: { erlangSpecific: true, isRecordExpr: true },
          })
        }
        // Track variable uses in record fields
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "record_field") {
            const fieldName = this.getChildByType(child, "atom")
            const fieldExpr = this.getChildByType(child, "field_expr")
            if (fieldExpr) {
              const varNode = this.getChildByType(fieldExpr, "var")
              if (varNode?.text && currentModule) {
                relationships.push({
                  source: currentModule,
                  target: varNode.text,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.8,
                  metadata: { erlangSpecific: true, isFieldBinding: true, recordField: fieldName?.text },
                })
              }
            }
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

            // Dedup across multiple fun_decl nodes (semicolon-separated clauses)
            if (!symbolRegistered && currentModule) {
              const fullKey = `${currentModule}:${funcName}`
              if (!registeredFunctions.has(fullKey)) {
                registeredFunctions.add(fullKey)
                symbols.push({
                  name: funcName,
                  kind: ASTEngine.SymbolKind.Function,
                  range: this.nodeToRange(node),
                  ownerName: currentModule,
                  metadata: { nodeType: "function_clause", clauseCount: funcClauses.length },
                })
                // Contains: module contains this function
                relationships.push({
                  source: currentModule,
                  target: funcName,
                  type: ASTEngine.RelationshipType.Contains,
                  confidence: 1.0,
                  metadata: { erlangSpecific: true, isModuleMember: true },
                })
              }
              symbolRegistered = true
            }

            // Extract calls from EVERY clause
            this.extractCallsFromFunction(
              funcClause,
              currentModule,
              funcName,
              funcLine,
              relationships,
              imports,
              seenFuncalls,
              registeredFunctions,
            )
          }
        }
      }

      // ---- receive ... end ----
      else if (type === "receive_expression") {
        patterns["Message Reception (receive)"] = true
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "after_clause") {
            const timeoutNode = this.getChildByType(child, "integer")
            if (timeoutNode) {
              relationships.push({
                source: currentModule || filePath,
                target: `timeout_${timeoutNode.text}ms`,
                type: ASTEngine.RelationshipType.References,
                confidence: 0.8,
                metadata: { erlangSpecific: true, isReceiveTimeout: true },
              })
            }
            patterns["Receive with Timeout"] = true
          }
        }
      }

      // ---- var references (Uses) ----
      // Variable usage is tracked contextually through record_expr field bindings
      // and function call extraction. Individual var node tracking is too noisy.

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push(child)
      }
    }

    if (currentModule) patterns["OTP Module"] = true
    const pa: string[] = []
    for (const k in patterns) pa.push(k)

    return {
      language: "erlang",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: pa,
        framework: currentModule || "Erlang",
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  private extractCallsFromFunction(
    funcNode: Node,
    currentModule: string | undefined,
    funcName: string,
    lineNumber: number,
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    seenCalls: Set<string>,
    registeredFunctions: Set<string>,
  ) {
    const stack: Node[] = [funcNode]

    while (stack.length > 0) {
      const node = stack.pop()!

      if (node.type === "call") {
        const callee = node.namedChild(0)
        const calleeText = callee?.text || ""

        // Process spawn: spawn(fun() -> ... end) / spawn(Module, Function, Args)
        if (calleeText === "spawn" || calleeText === "spawn_link" || calleeText === "spawn_monitor") {
          if (currentModule) {
            relationships.push({
              source: `${currentModule}:${funcName}`,
              target: calleeText,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: { erlangSpecific: true, isProcessSpawn: true },
            })
          }
        }

        // Remote call: io:format(...)
        const remoteNode = this.getChildByType(node, "remote")
        if (remoteNode) {
          const atoms: string[] = []
          this.collectAtoms(remoteNode, atoms)
          if (atoms.length >= 2) {
            const targetModule = atoms[0]
            const targetFunc = atoms[1]
            const callKey = `${targetModule}:${targetFunc}`
            if (!seenCalls.has(callKey)) {
              seenCalls.add(callKey)
              relationships.push({
                source: currentModule ? `${currentModule}:${funcName}` : funcName,
                target: callKey,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                metadata: { erlangSpecific: true, context: "remote function call" },
              })
              if (!imports.some((imp) => imp.module === targetModule)) {
                imports.push({
                  module: targetModule,
                  functions: [targetFunc],
                  file: "",
                  line: lineNumber,
                  isNif: false,
                })
                relationships.push({
                  source: currentModule || "global",
                  target: targetModule,
                  type: ASTEngine.RelationshipType.References,
                  confidence: 0.9,
                  metadata: { erlangSpecific: true, isModuleDep: true },
                })
              }
            }
          }
        }

        // Local call: factorial(N - 1) — callee is an atom matching a known function
        if (callee?.type === "atom" && calleeText && !remoteNode && currentModule) {
          const localKey = `${currentModule}:${calleeText}`
          if (registeredFunctions.has(localKey) && !seenCalls.has(localKey)) {
            seenCalls.add(localKey)
            relationships.push({
              source: `${currentModule}:${funcName}`,
              target: calleeText,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: { erlangSpecific: true, context: "local function call" },
            })
          }
        }
      }

      // Track remote module references (even outside call context)
      if (node.type === "remote") {
        const atoms: string[] = []
        this.collectAtoms(node, atoms)
        if (atoms.length >= 1 && !imports.some((imp) => imp.module === atoms[0])) {
          imports.push({
            module: atoms[0],
            functions: [],
            file: "",
            line: lineNumber,
            isNif: false,
          })
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
