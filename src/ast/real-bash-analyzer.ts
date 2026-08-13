import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealBashAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // 1. ISOLATED STATE (Thread-Safe)
    const exportedVars: Record<string, boolean> = {}
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const patterns: Record<string, boolean> = {}

    // 2. METRICS TRACKED IN-PASS
    let cyclomaticComplexity = 1
    let hasStrictError = false
    let usesEval = false
    let usesSudo = false
    let hasCurlPipeBash = false
    let hasChmod777 = false
    let hasRmRoot = false

    // Scope Tracking for O(1) lookups and Subshell isolation
    const scopeStack: string[] = []
    const functionParams: Record<string, Record<string, boolean>> = {}

    // Helper to get the current scope (returns top of stack, or "" for global)
    const currentScope = () => scopeStack[scopeStack.length - 1] || ""

    // Helper to get the nearest actual function scope (ignores subshells for parameter attribution)
    const currentFunctionScope = () => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (!scopeStack[i].startsWith("subshell_")) return scopeStack[i]
      }
      return ""
    }

    // 3. THE TRUE SINGLE-PASS UNIFIED WALK
    const stack: { node: Node; isExit: boolean }[] = [{ node: rootNode, isExit: false }]
    while (stack.length > 0) {
      const { node, isExit } = stack.pop()!

      if (!node) continue

      if (isExit) {
        // --- Scope Management (Leave) ---
        if (node.type === "function_definition" || node.type === "subshell") {
          let isScopeNode = false
          if (node.type === "function_definition") {
            let nameText = ""
            for (let i = 0; i < node.childCount; i++) {
              const c = node.child(i)
              if (c && (c.type === "word" || c.type === "identifier" || c.type === "command_name")) {
                nameText = c.text
                break
              }
            }
            if (!nameText) {
              for (let i = 0; i < node.childCount; i++) {
                const c = node.child(i)
                if (
                  c &&
                  c.text !== "function" &&
                  c.text !== "()" &&
                  c.text !== "{" &&
                  c.type !== "compound_statement"
                ) {
                  nameText = c.text
                  break
                }
              }
            }
            if (nameText) isScopeNode = true
          } else {
            isScopeNode = true
          }
          if (isScopeNode) scopeStack.pop()
        }
        continue
      }

      stack.push({ node, isExit: true })

      // --- Scope Management (Enter) ---
      if (node.type === "function_definition") {
        let nameText = ""
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && (c.type === "word" || c.type === "identifier" || c.type === "command_name")) {
            nameText = c.text
            break
          }
        }

        if (!nameText) {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (c && c.text !== "function" && c.text !== "()" && c.text !== "{" && c.type !== "compound_statement") {
              nameText = c.text
              break
            }
          }
        }

        if (nameText) {
          const parentScope = currentScope()
          scopeStack.push(nameText)
          functionParams[nameText] = {}
          this.extractFunction(node, symbols, parentScope)
        }
      } else if (node.type === "subshell") {
        const parentScope = currentScope()
        const subId = `subshell_${node.startIndex}`
        scopeStack.push(subId)
        // instantiates: (cmd) creates a child process/shell — treat as instantiation
        relationships.push({
          source: parentScope || "global",
          target: subId,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.8,
          metadata: { isSubshell: true, bashSpecific: true },
        })
      }

      // --- Error Tracking ---
      if (node.type === "ERROR" || node.isMissing) {
        errors.push({
          message: "Brain Engine (Bash): Bypassed resilient parser error node",
          range: this.nodeToRange(node),
          severity: "warning",
        })
      }

      // --- In-Pass Cyclomatic Complexity ---
      if (
        node.type === "if_statement" ||
        node.type === "for_statement" ||
        node.type === "while_statement" ||
        node.type === "case_item" ||
        node.type === "elif_clause" ||
        node.type === "test_command" ||
        node.type === "binary_expression"
      ) {
        cyclomaticComplexity++
      }

      // --- Single-Pass Parameter Detection ---
      if (node.type === "special_variable_name" && /^[0-9]+$|^[@*]$/.test(node.text)) {
        const fnScope = currentFunctionScope()
        if (fnScope) {
          ;(functionParams[fnScope] = functionParams[fnScope] || {})[node.text] = true
        }
      }

      // --- Symbol & Pattern Routing ---
      if (node.type === "variable_assignment") {
        this.extractVariable(node, symbols, currentScope())
      } else if (node.type === "variable_expansion" || node.type === "simple_expansion") {
        // uses: $VAR, ${VAR} — track variable usage
        const varName = node.text.replace(/^[\$]/, "").replace(/[{}]/g, "")
        if (varName && varName.trim() !== "" && !/^\d+$/.test(varName) && varName !== "@" && varName !== "*" && varName !== "?") {
          relationships.push({
            source: currentScope() || "script",
            target: varName,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.7,
            metadata: { isVariableReference: true, bashSpecific: true },
          })
        }
      } else if (node.type === "special_variable_name" && /^[0-9]+$|^[@*?#]$/.test(node.text.replace(/^\$/, ""))) {
        // uses: $1, $2, $@, $*, $? — positional/special params
        const refName = node.text.replace(/^\$/, "")
        relationships.push({
          source: currentScope() || "script",
          target: refName,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 0.6,
          metadata: { isPositionalParam: true, bashSpecific: true },
        })
      } else if (node.type === "command_substitution") {
        patterns["Command Substitution"] = true
        // Extract the inner command as a symbol reference
        let innerCmd = ""
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.type === "command_name") {
            innerCmd = c.text
            break
          }
        }
        if (innerCmd) {
          symbols.push({
            name: `\$${innerCmd}`,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node),
            scope: currentScope(),
            visibility: "private",
            metadata: { isCommandSubstitution: true, bashSpecific: true },
          })
          // instantiates: $(cmd) spawns a new process/context — treat as instantiation
          relationships.push({
            source: currentScope() || "global",
            target: innerCmd,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.85,
            metadata: { isCommandSubstitution: true, bashSpecific: true },
          })
        }
      } else if (node.type === "pipeline" || node.type === "list") {
        // Pipeline: cat file | grep pattern > out.txt
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child && child.type === "command") {
            let pipeCmd = ""
            for (let j = 0; j < child.childCount; j++) {
              const c = child.child(j)
              if (c && c.type === "command_name") { pipeCmd = c.text; break }
            }
            if (pipeCmd && !pipeCmd.startsWith("-")) {
              relationships.push({
                source: currentScope() || "global",
                target: pipeCmd,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                metadata: { isFunctionCall: true, isPipelineCommand: true },
              })
            }
          }
        }
      } else if (node.type === "case_item") {
        // case patterns: commands inside a case branch are CALLS, not
        // declarations — emitting them as Function symbols pollutes the
        // symbol table with builtins like shift/exit/echo. Record a Calls
        // relationship instead; the enclosing function_definition provides
        // the declaration symbol.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (!child) continue
          if (child.type === "command") {
            let caseCmd = ""
            for (let j = 0; j < child.childCount; j++) {
              const c = child.child(j)
              if (c && c.type === "command_name") { caseCmd = c.text; break }
            }
            if (caseCmd && !caseCmd.startsWith("-")) {
              relationships.push({
                source: currentScope() || "global",
                target: caseCmd,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                metadata: { isCaseCommand: true, isFunctionCall: true, bashSpecific: true },
              })
            }
          }
        }
      } else if (node.type === "command") {
        let cmdName = ""
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.type === "command_name") {
            cmdName = c.text
            break
          }
        }

        if (cmdName) {
          if (cmdName === "docker" || cmdName === "docker-compose" || cmdName === "kubectl" || cmdName === "helm") {
            patterns["Container/Orchestration Script"] = true
            patterns["Deployment Script"] = true
          } else if (cmdName === "aws" || cmdName === "gcloud" || cmdName === "az" || cmdName === "terraform") {
            patterns["Cloud Infrastructure Script"] = true
          } else if (
            cmdName === "npm" ||
            cmdName === "yarn" ||
            cmdName === "pnpm" ||
            cmdName === "cargo" ||
            cmdName === "go"
          ) {
            patterns["Build/Compilation Script"] = true
          } else if (cmdName === "curl" || cmdName === "wget") {
            patterns["Network Request Script"] = true
            // Check for curl|bash pipe pattern
            const fullText = node.text
            if (/curl.*\|.*bash|wget.*\|.*sh/i.test(fullText)) {
              hasCurlPipeBash = true
              patterns["Insecure Pipe Execution"] = true
            }
          } else if (cmdName === "chmod") {
            if (node.text.includes("777")) {
              hasChmod777 = true
              patterns["Insecure Permissions"] = true
            }
          } else if (cmdName === "rm") {
            if (/rm\s+-rf\s+\//.test(node.text)) {
              hasRmRoot = true
              patterns["Destructive File Operation"] = true
            }
          } else if (cmdName === "eval") {
            usesEval = true
            patterns["Dynamic Code Execution"] = true
          } else if (cmdName === "sudo") {
            usesSudo = true
            patterns["Privilege Escalation"] = true
          } else if (cmdName === "alias") {
            // alias: track as symbol alias creation
            const aliasDef = node.text.replace(/^alias\s+/, "")
            const eqIdx = aliasDef.indexOf("=")
            if (eqIdx > 0) {
              const aliasName = aliasDef.substring(0, eqIdx).trim()
              symbols.push({
                name: aliasName,
                kind: ASTEngine.SymbolKind.Function,
                range: this.nodeToRange(node),
                scope: currentScope(),
                visibility: "public",
                metadata: { isAlias: true, bashSpecific: true },
              })
            }
          } else if (cmdName === "trap") {
            // trap: extract signal→handler relationship
            const trapArgs: string[] = []
            for (let i = 0; i < node.childCount; i++) {
              const c = node.child(i)
              if (c && c.type === "word" && c.text !== "trap") {
                trapArgs.push(c.text.replace(/['"]/g, ""))
              }
            }
            if (trapArgs.length >= 2) {
              const handler = trapArgs[0]
              const signal = trapArgs[trapArgs.length - 1]
              if (handler && signal) {
                relationships.push({
                  source: signal,
                  target: handler,
                  type: ASTEngine.RelationshipType.Calls,
                  confidence: 0.7,
                  metadata: { isTrapHandler: true, bashSpecific: true },
                })
              }
            }
          } else if (cmdName === "set") {
            for (let i = 0; i < node.childCount; i++) {
              const c = node.child(i)
              if (c && c.type === "word") {
                if (/^-[a-zA-Z]*e[a-zA-Z]*$/.test(c.text) || (c.text === "-o" && node.text.indexOf("errexit") !== -1)) {
                  hasStrictError = true
                  patterns["Strict Error Handling"] = true
                }
              }
            }
          }
        }

        this.extractCommand(node, symbols, imports, relationships, currentScope())
      } else if (node.type === "declaration_command") {
        let cmdName = ""
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.type === "command_name") {
            cmdName = c.text
            break
          }
        }
        if (!cmdName) {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (c && (c.type === "export" || c.type === "local" || c.type === "declare" || c.type === "typeset")) {
              cmdName = c.type
              break
            }
          }
        }
        if (cmdName === "export") {
          patterns["Environment Variable Tracking"] = true
          this.extractExport(node, symbols, exportedVars, currentScope())
        } else if (cmdName === "local" || cmdName === "declare" || cmdName === "typeset") {
          this.extractLocal(node, symbols, currentScope())
        }
      }

      // --- Recurse ---
      // Use raw child count to avoid WASM arrays
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push({ node: child, isExit: false })
      }
    }

    // 4. POST-PROCESS PARAMETERS (O(N) on symbols, extremely fast)
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if (sym.kind === ASTEngine.SymbolKind.Function) {
        const params = functionParams[sym.name]
        if (
          params &&
          (function (o) {
            for (let k in o) return true
            return false
          })(params)
        ) {
          const paramObjects: { name: string; type: string }[] = []
          for (const p in params) {
            paramObjects.push({ name: p, type: "any" })
          }
          sym.parameters = paramObjects
        }
      }
    }

    // 4. METRIC CALCULATION
    let security = 50
    let maintainability = 50

    if (hasStrictError) {
      security += 20
      maintainability += 10
    }
    if (usesEval) security -= 30
    if (usesSudo) security -= 10
    if (hasCurlPipeBash) security -= 25
    if (hasChmod777) security -= 20
    if (hasRmRoot) security -= 40

    let hasFunction = false
    for (let i = 0; i < symbols.length; i++) {
      if (symbols[i].kind === ASTEngine.SymbolKind.Function) {
        hasFunction = true
        break
      }
    }
    if (hasFunction) maintainability += 20
    if (cyclomaticComplexity > 10) maintainability -= 15

    const score = Math.round((security + maintainability) / 2)
    const patternsArray: string[] = []
    for (const p in patterns) patternsArray.push(p)
    const frameworks = this.detectFrameworks(patternsArray)

    // Phantom Symbols: e.g. implicit global env variables exported
    const phantomSymbols: ASTEngine.UniversalSymbol[] = []
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (
        (s.kind === ASTEngine.SymbolKind.Variable || s.kind === ASTEngine.SymbolKind.Constant) &&
        s.metadata?.isExported
      ) {
        phantomSymbols.push({
          name: `ENV_${s.name}`,
          kind: ASTEngine.SymbolKind.Variable,
          range: s.range,
          metadata: { isPhantom: true, injectedBy: "bash_export_env" },
        })
      }
    }

    // Global scope symbol for top-level relationships
    phantomSymbols.push({
      name: "global",
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(rootNode),
      scope: "",
      visibility: "public",
      metadata: { isPhantom: true, injectedBy: "bash_global_scope" },
    })

    for (let i = 0; i < phantomSymbols.length; i++) {
      symbols.push(phantomSymbols[i])
    }

    // Post-loop: add contains for owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    return {
      language: "bash",
      symbols,
      relationships,
      imports,
      exports: symbols.filter((s) => s.metadata?.isExported).map((s) => ({
        name: s.name,
        type: s.kind,
        range: s.range,
        isType: false,
      })),
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworks[0] === "Bash" ? "Bash Script" : frameworks[0] || "Bash Script",
        patterns: patternsArray,
        detectedFrameworks: frameworks,
        frameworkPatterns: [{ framework: "Bash", patterns: patternsArray }],
        architecturalInsights: this.generateInsights(symbols, patternsArray, hasStrictError),
        architecturalScore: score,
        codeQuality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        securityScore: Math.min(100, Math.max(0, security)),
        maintainabilityScore: Math.min(100, Math.max(0, maintainability)),
        analysisVersion: "4.0-bash-native-ast-pure-single-pass",
      },
    }
  }

  private extractFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], scope: string) {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "word" || c.type === "identifier" || c.type === "command_name")) {
        symbols.push({
          name: c.text,
          kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node),
          scope: scope,
          visibility: "public",
          ownerName: "script",
          parameters: [],
          metadata: { bashSpecific: true },
        })
        return // Break and exit so we only add it once
      }
    }

    // Fallback if Tree-sitter hides the name inside a wrapper node or it's just the first non-keyword word
    let nameText = ""
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.text !== "function" && c.text !== "()" && c.text !== "{" && c.type !== "compound_statement") {
        nameText = c.text
        break
      }
    }

    if (nameText && nameText.trim().length > 0) {
      symbols.push({
        name: nameText,
        kind: ASTEngine.SymbolKind.Function,
        range: this.nodeToRange(node),
        scope: scope,
        visibility: "public",
        ownerName: "script",
        parameters: [], // Filled during post-processing
        metadata: { bashSpecific: true },
      })
    }
  }

  private extractLocal(node: Node, symbols: ASTEngine.UniversalSymbol[], scope: string) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "variable_assignment") {
        for (let j = 0; j < child.childCount; j++) {
          const c = child.child(j)
          if (c && c.type === "variable_name" && c.text.trim() !== "") {
            symbols.push({
              name: c.text,
              kind: ASTEngine.SymbolKind.Variable,
              range: this.nodeToRange(child),
              scope: scope,
              visibility: "private",
              ownerName: scope || "script",
              metadata: { bashSpecific: true, isLocal: true },
            })
            break
          }
        }
      } else if (
        child.type === "word" &&
        !(child.text === "local" || child.text === "declare" || child.text === "typeset") &&
        !child.text.startsWith("-") &&
        child.text.trim() !== ""
      ) {
        symbols.push({
          name: child.text,
          kind: ASTEngine.SymbolKind.Variable,
          range: this.nodeToRange(child),
          scope: scope,
          visibility: "private",
          ownerName: scope || "script",
          metadata: { bashSpecific: true, isLocal: true },
        })
      }
    }
  }

  private extractVariable(node: Node, symbols: ASTEngine.UniversalSymbol[], scope: string) {
    if (node.parent?.type === "declaration_command") return

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "variable_name" && c.text.trim() !== "") {
        const isImplicitGlobal = !scope.startsWith("subshell_")
        symbols.push({
          name: c.text,
          kind: ASTEngine.SymbolKind.Variable,
          range: this.nodeToRange(node),
          scope: scope,
          visibility: isImplicitGlobal ? "public" : "private",
          ownerName: scope || "script",
          metadata: { bashSpecific: true, isImplicitGlobal, inSubshell: scope.startsWith("subshell_") },
        })
        break
      }
    }
  }

  private extractExport(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    exportedVars: Record<string, boolean>,
    scope: string,
  ) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "variable_assignment") {
        for (let j = 0; j < child.childCount; j++) {
          const c = child.child(j)
          if (c && c.type === "variable_name" && c.text.trim() !== "") {
            exportedVars[c.text] = true
            symbols.push({
              name: c.text,
              kind: ASTEngine.SymbolKind.Constant,
              range: this.nodeToRange(child),
              scope: scope,
              visibility: "public",
              ownerName: scope || "script",
              metadata: { isExported: true, bashSpecific: true },
            })
            break
          }
        }
      } else if (
        child.type === "word" &&
        child.text !== "export" &&
        !child.text.startsWith("-") &&
        child.text.trim() !== ""
      ) {
        exportedVars[child.text] = true
        symbols.push({
          name: child.text,
          kind: ASTEngine.SymbolKind.Constant,
          range: this.nodeToRange(child),
          scope: scope,
          visibility: "public",
          ownerName: scope || "script",
          metadata: { isExported: true, bashSpecific: true },
        })
      }
    }
  }

  private extractCommand(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    scope: string,
  ) {
    let nameNode = null
    let otherNode = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "command_name") {
        nameNode = c
      } else if (c.type !== "command_name") {
        if (!otherNode) otherNode = c
      }
    }

    if (!nameNode || nameNode.text.trim() === "") return

    const cmdName = nameNode.text
    if (cmdName === "source" || cmdName === ".") {
      if (otherNode && otherNode.text.trim() !== "") {
        const sourcePath = otherNode.text
        imports.push({
          module: sourcePath,
          items: ["*"],
          isDefaultImport: true,
          isNamespaceImport: false,
          range: this.nodeToRange(node),
        })
        // imports relationship: source/. loads another script
        relationships.push({
          source: scope || "global",
          target: sourcePath,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          metadata: { isSourceImport: true },
        })
        // depends relationship: explicit script dependency
        relationships.push({
          source: scope || "global",
          target: sourcePath,
          type: ASTEngine.RelationshipType.References,
          confidence: 1.0,
          metadata: { isSourceDependency: true, bashSpecific: true },
        })
      }
    } else if (cmdName === "export") {
      // Handle export in command position (not declaration_command)
      // Check for export -f (function export)
      let exportFlags = ""
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && c.type === "word" && c.text.startsWith("-")) {
          exportFlags = c.text
          break
        }
      }
      if (exportFlags.includes("f")) {
        // export -f funcname — mark function as exported
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.type === "word" && !c.text.startsWith("-") && c.text !== "export") {
            const existingFn = symbols.find(s => s.name === c.text && s.kind === ASTEngine.SymbolKind.Function)
            if (existingFn) {
              existingFn.metadata = { ...existingFn.metadata, isExported: true }
              existingFn.visibility = "public"
            }
          }
        }
      } else if (otherNode && otherNode.type === "variable_assignment") {
        for (let i = 0; i < otherNode.childCount; i++) {
          const c = otherNode.child(i)
          if (c && c.type === "variable_name" && c.text.trim() !== "") {
            symbols.push({
              name: c.text,
              kind: ASTEngine.SymbolKind.Constant,
              range: this.nodeToRange(node),
              scope,
              visibility: "public",
              metadata: { isExported: true, bashSpecific: true },
            })
          }
        }
      }
    } else {
      if (!scope.startsWith("subshell_")) {
        const caller = scope && scope.trim() !== "" ? scope.trim() : "global"
        relationships.push({
          source: caller,
          target: cmdName,
          type: ASTEngine.RelationshipType.Calls,
          confidence: 1.0,
          metadata: { isFunctionCall: true, isExternalCommand: true },
        })
      }
    }
  }

  private detectFrameworks(patterns: string[]): string[] {
    const frameworks = ["Bash"]
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Container/Orchestration Script") frameworks.push("Docker/Kubernetes")
      if (patterns[i] === "Cloud Infrastructure Script") frameworks.push("Cloud Native")
    }
    return frameworks
  }

  private generateInsights(
    symbols: ASTEngine.UniversalSymbol[],
    patterns: string[],
    hasStrictError: boolean,
  ): string[] {
    const insights: string[] = []
    let hasDeploymentCmd = false
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Deployment Script") {
        hasDeploymentCmd = true
        break
      }
    }
    if (hasDeploymentCmd) {
      insights.push("This script contains deployment logic.")
    }

    let hasContainerPattern = false
    let hasEnvPattern = false
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Container/Orchestration Script") hasContainerPattern = true
      if (patterns[i] === "Environment Variable Tracking") hasEnvPattern = true
    }

    if (hasContainerPattern) insights.push("Acts as a container orchestration script")
    if (hasEnvPattern) insights.push("Manages environment states for downstream processes")
    if (!hasStrictError) insights.push("Lacks 'set -e' for strict error catching")
    return insights
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
}
