// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

const OTP_BEHAVIOURS = new Set(["gen_server", "gen_statem", "gen_event", "supervisor", "application"])

export class RealErlangAnalyzer implements LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    let currentModule: string | undefined
    let currentLine = 0

    const stack: Node[] = [rootNode]
    const seenFuncalls = new Set<string>()
    const patterns: Record<string, boolean> = {}

    while (stack.length > 0) {
      const node = stack.pop()!
      const type = node.type
      currentLine = node.startPosition.row + 1

      if (type === "include_attribute" || type === "include_lib_attribute") {
        var fNode = this.getChildByType(node, "string") || this.getChildByType(node, "string_literal");
        if (fNode) { imports.push({ module: fNode.text.replace(/['"]/g, ""), file: fNode.text, line: currentLine, isNif: false }); }
      } else if (type === "module_attribute") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          currentModule = nameNode.text
          symbols.push({
            name: currentModule,
            kind: SymbolKind.Module,
            range: this.nodeToRange(node),
            metadata: { nodeType: "module_attribute" },
          })
        }
      } else if (type === "behaviour_attribute") {
        const beNode = this.getChildByType(node, "atom")
        if (beNode?.text && OTP_BEHAVIOURS.has(beNode.text)) {
          symbols.push({
            name: beNode.text,
            kind: SymbolKind.Interface,
            range: this.nodeToRange(node),
            metadata: { nodeType: "behaviour", behaviourName: beNode.text },
          })
          relationships.push({
            source: currentModule || filePath,
            target: beNode.text,
            type: RelationshipType.Implements,
            confidence: 1.0,
            metadata: {
              erlangSpecific: true,
              behaviour: beNode.text,
              context: "OTP behaviour callback implementation",
            },
          })
        }
      } else if (type === "wild_attribute") {
        const attrNameNode = this.getChildByType(node, "attr_name")
        if (attrNameNode?.text === "nifs" || attrNameNode?.text === "on_load") {
          const listNode = this.getChildByType(node, "list")
          if (listNode) {
            this.processList(listNode, (item) => {
              const funcNode = this.getChildByType(item, "binary_op_expr") || this.getChildByType(item, "atom")
              const funcName = funcNode?.text?.split("/")[0]
              if (funcName && funcName !== "nifs") {
                symbols.push({
                  name: funcName,
                  kind: SymbolKind.Function,
                  range: this.nodeToRange(node),
                  ownerName: currentModule,
                  metadata: { nodeType: attrNameNode.text, isNif: true },
                })
              }
            })
          }
        }
      } else if (type === "export_attribute") {
        const listNode = this.getChildByType(node, "list")
        if (listNode) {
          this.processList(listNode, (fa) => {
            if (fa?.type === "fa") {
              const nameNode = this.getChildByType(fa, "atom")
              const arityNode = this.getChildByType(fa, "integer")
              if (nameNode?.text) {
                exports.push({
                  name: nameNode.text,
                  arity: arityNode ? parseInt(arityNode.text) : 0,
                  file: filePath,
                  line: currentLine,
                })
              }
            }
          })
        }
      } else if (type === "record_decl") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          const fields: string[] = []
          const fieldsContainer = this.getChildByType(node, "list") || this.getChildByType(node, "{")
          if (fieldsContainer) {
            this.processList(fieldsContainer, (field) => {
              const fieldNameNode = this.getChildByType(field, "atom")
              if (fieldNameNode?.text) fields.push(fieldNameNode.text)
            })
          }
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Struct,
            range: this.nodeToRange(node),
            ownerName: currentModule,
            metadata: { nodeType: "record_decl", fields },
          })
        }
      } else if (type === "define") {
        var macroNode = this.getChildByType(node, "macro_name") || this.getChildByType(node, "atom");
        if (macroNode && macroNode.text && macroNode.text !== "define") {
          symbols.push({ name: macroNode.text, kind: SymbolKind.Struct, range: this.nodeToRange(node), ownerName: currentModule, metadata: { nodeType: "macro_definition", isMacro: true } });
        }
      } else if (type === "type_alias") {
        const typeNameNode = this.getChildByType(node, "type_name")
        const typeName = typeNameNode?.text?.replace(/\(\)$/, "") || this.getChildByType(node, "atom")?.text
        if (typeName) {
          symbols.push({
            name: typeName,
            kind: SymbolKind.Type,
            range: this.nodeToRange(node),
            ownerName: currentModule,
            metadata: { nodeType: "type_alias" },
          })
        }
      } else if (type === "spec") {
        const nameNode = this.getChildByType(node, "function_name") || this.getChildByType(node, "atom")
        if (nameNode?.text) {
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Interface,
            range: this.nodeToRange(node),
            ownerName: currentModule,
            metadata: { nodeType: "spec", isSpec: true },
          })
        }
      } else if (type === "send_expression") {
        var destNode = this.getChildByType(node, "atom") || node.namedChild(0);
        if (destNode && currentModule) {
          relationships.push({ source: currentModule, target: destNode.text, type: RelationshipType.Calls, confidence: 0.8, metadata: { erlangSpecific: true, isMessagePass: true } });
        }
      } else if (type === "fun_decl") {
        const funcClauses = this.collectChildrenByType(node, "function_clause")
        let funcName = ""
        let symbolRegistered = false
        for (const funcClause of funcClauses) {
          if (!funcClause) continue
          const nameNode = this.getChildByType(funcClause, "atom") || this.getChildByType(funcClause, "var")
          if (nameNode?.text) {
            funcName = nameNode.text
            const funcLine = funcClause.startPosition.row + 1

            // Register the function symbol once (all clauses share the same name)
            if (!symbolRegistered) {
              symbols.push({
                name: funcName,
                kind: SymbolKind.Function,
                range: this.nodeToRange(node),
                ownerName: currentModule,
                metadata: { nodeType: "function_clause", clauseCount: funcClauses.length },
              })
              symbolRegistered = true
            }

            // Extract calls from EVERY clause (not just the first)
            this.extractCallsFromFunction(
              funcClause,
              currentModule,
              funcName,
              funcLine,
              relationships,
              imports,
              seenFuncalls,
            )
          }
        }
      } else if (type === "receive_expression") {
        patterns["Message Reception (receive)"] = true
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child && child.type === "after_clause") {
            const timeoutNode = this.getChildByType(child, "integer")
            if (timeoutNode) {
              relationships.push({
                source: currentModule || filePath,
                target: `timeout_${timeoutNode.text}ms`,
                type: RelationshipType.References,
                confidence: 0.8,
                metadata: { erlangSpecific: true, isReceiveTimeout: true },
              })
            }
            patterns["Receive with Timeout"] = true
          }
        }
      }

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
    relationships: UniversalRelationship[],
    imports: ImportInfo[],
    seenCalls: Set<string>,
  ) {
    const stack: Node[] = [funcNode]

    while (stack.length > 0) {
      const node = stack.pop()!

      if (node.type === "call") {
        const cnNode = node.namedChild(0); const cn = cnNode ? cnNode.text : "";
        if (cn === "spawn" || cn === "spawn_link" || cn === "spawn_monitor") {
          if (currentModule) { relationships.push({ source: currentModule + ":" + funcName, target: cn, type: RelationshipType.Calls, confidence: 0.9, metadata: { erlangSpecific: true, isProcessSpawn: true } }); }
        }
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
                type: RelationshipType.Calls,
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
              }
            }
          }
        }
      }

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

  private processList(listNode: Node, callback: (item: Node) => void) {
    for (let i = 0; i < listNode.childCount; i++) {
      const child = listNode.child(i)
      if (child?.isNamed) {
        callback(child)
      }
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
