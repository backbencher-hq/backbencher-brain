import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// Shell builtins and reserved words that do not represent project-level
// command calls. `echo`, `cd`, `printf`, … are execution primitives, not
// symbols; emitting a Calls edge for them would drown the relationship graph
// in noise. External binaries (`docker`, `git`, `jq`, …) and project-defined
// functions are still emitted as Calls.
const SHELL_BUILTINS = new Set([
  "echo", "printf", "cd", "pwd", "exit", "return", "break", "continue",
  "shift", "source", ".", "export", "local", "declare", "typeset", "readonly",
  "set", "unset", "alias", "unalias", "trap", "eval", "exec", "true", "false",
  "sudo",
  "test", "[", "command", "builtin", "type", "let", "pushd", "popd", "dirs",
  "wait", "jobs", "fg", "bg", "kill", "read", "readarray", "mapfile",
  "getopts", "ulimit", "umask", "times", "enable", "help", "hash", "bind",
  "compgen", "complete", "compopt", "logout", "suspend", "caller", "disown",
  "shopt", "history", "fc", "getopts", "coproc",
])

const DECLARATION_KEYWORDS = new Set(["export", "local", "declare", "typeset", "readonly"])

// $@, $*, $?, $$, $#, $!, $_ — positional/special parameter punctuation.
// They are tracked as function parameters but are shell bookkeeping, not
// project variables, so they never become Uses edges.
const SPECIAL_VAR_PUNCTUATION = new Set(["@", "*", "?", "$", "#", "!", "_"])

export class RealBashAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // ---------------------------------------------------------------- state
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const patterns = new Set<string>()

    // Scope tracking: only real function scopes (no synthetic `global` /
    // `script` / `subshell_N` scopes ever enter the stack).
    const declaredSymbols = new Set<string>()
    const functionStack: string[] = []
    const functionParams = new Map<string, Set<string>>()
    const relKeys = new Set<string>()
    let caseDepth = 0

    let cyclomaticComplexity = 1
    let hasStrictError = false
    let usesEval = false
    let usesSudo = false
    let hasCurlPipeBash = false
    let hasChmod777 = false
    let hasRmRoot = false

    const enclosingFunction = (): string => functionStack[functionStack.length - 1] ?? ""
    const relSource = (): string => enclosingFunction() || "global"

    const addRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, unknown> = {},
    ) => {
      const key = `${source}\u0000${type}\u0000${target}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      relationships.push({ source, target, type, confidence, metadata })
    }

    const isAllDigits = (text: string): boolean => {
      if (text.length === 0) return false
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        if (code < 48 || code > 57) return false
      }
      return true
    }

    const stack: { node: Node; exit: boolean }[] = [{ node: rootNode, exit: false }]
    while (stack.length > 0) {
      const { node, exit } = stack.pop()!
      if (!node) continue

      if (exit) {
        if (node.type === "function_definition") functionStack.pop()
        else if (node.type === "case_item") caseDepth--
        continue
      }

      stack.push({ node, exit: true })

      // Cyclomatic complexity: one count per decision point.
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

      if (node.type === "function_definition") {
        const parentFn = enclosingFunction()
        this.extractFunction(node, symbols, parentFn)
        const name = this.functionName(node)
        if (name) {
          functionStack.push(name)
          if (!functionParams.has(name)) functionParams.set(name, new Set())
        }
        patterns.add("Function Definition")
      } else if (node.type === "case_item") {
        caseDepth++
      } else if (node.type === "command_substitution") {
        patterns.add("Command Substitution")
      } else if (node.type === "subshell") {
        patterns.add("Subshell")
      } else if (node.type === "pipeline") {
        // curl | bash / wget | sh — AST-level pipe detection, no source text.
        const names: string[] = []
        const collect = (n: Node) => {
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (!child) continue
            if (child.type === "command") {
              const name = this.commandNameOf(child)
              if (name) names.push(name)
            } else if (child.type !== "pipeline") {
              collect(child)
            }
          }
        }
        collect(node)
        const hasDownloader = names.some((n) => n === "curl" || n === "wget")
        const hasShell = names.some((n) => n === "bash" || n === "sh" || n === "zsh" || n === "dash")
        if (hasDownloader && hasShell) {
          hasCurlPipeBash = true
          patterns.add("Insecure Pipe Execution")
        }
      } else if (node.type === "simple_expansion" || node.type === "expansion") {
        // Uses: $VAR, ${VAR}, ${VAR:-x}, ${arr[1]} → target variable name.
        const name = this.expansionVariableName(node)
        if (name && name.length > 0) {
          if (isAllDigits(name) && name !== "0") {
            // Positional parameter reference ($1..$9) — feeds the enclosing
            // function's parameter list, never a Uses edge. $0 is the script
            // name, not a parameter, and is excluded.
            const fn = enclosingFunction()
            if (fn) functionParams.get(fn)?.add(name)
          } else if (name === "0") {
            // $0 — script name reference; not a project variable.
          } else if (!SPECIAL_VAR_PUNCTUATION.has(name)) {
            addRel(relSource(), name, ASTEngine.RelationshipType.Uses, 0.8, {
              isVariableReference: true,
              bashSpecific: true,
            })
          }
        }
      } else if (node.type === "variable_assignment") {
        if (node.parent?.type !== "declaration_command") {
          this.extractAssignment(node, symbols, enclosingFunction(), false, declaredSymbols)
        }
      } else if (node.type === "declaration_command") {
        this.extractDeclaration(node, symbols, enclosingFunction(), functionParams, declaredSymbols)
      } else if (node.type === "command") {
        this.extractCommand(node, symbols, imports, patterns, {
          addRel,
          relSource,
          caseDepth,
          flags: {
            usesEval: () => usesEval,
            usesSudo: () => usesSudo,
            hasChmod777: () => hasChmod777,
            hasRmRoot: () => hasRmRoot,
            hasStrictError: () => hasStrictError,
          },
          setFlag: {
            eval: (v: boolean) => (usesEval = v),
            sudo: (v: boolean) => (usesSudo = v),
            chmod777: (v: boolean) => (hasChmod777 = v),
            rmRoot: (v: boolean) => (hasRmRoot = v),
            strictError: (v: boolean) => (hasStrictError = v),
          },
        })
      }

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push({ node: child, exit: false })
      }
    }

    // ------------------------------------------------------------- post pass
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if (sym.kind === ASTEngine.SymbolKind.Function) {
        const params = functionParams.get(sym.name)
        if (params && params.size > 0) {
          const paramObjects: { name: string; type: string }[] = []
          for (const p of params) paramObjects.push({ name: p, type: "any" })
          sym.parameters = paramObjects
        }
      }
      if (sym.ownerName) {
        addRel(sym.ownerName, sym.name, ASTEngine.RelationshipType.Contains, 1.0, {})
      }
    }

    // --------------------------------------------------------------- metrics
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
    const patternsArray = [...patterns]
    const frameworks = this.detectFrameworks(patternsArray)

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
      // Syntax errors are engine-owned (engine.ts merges treeErrors) — this
      // analyzer never duplicates them.
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: "Bash Script",
        patterns: patternsArray,
        detectedFrameworks: frameworks,
        frameworkPatterns: [{ framework: "Bash", patterns: patternsArray }],
        architecturalInsights: this.generateInsights(patternsArray, hasStrictError),
        architecturalScore: score,
        codeQuality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        securityScore: Math.min(100, Math.max(0, security)),
        maintainabilityScore: Math.min(100, Math.max(0, maintainability)),
        analysisVersion: "4.1-bash-pure-ast-no-regex",
      },
    }
  }

  // -------------------------------------------------------------- functions

  private stripQuotes(text: string): string {
    if (text.length >= 2) {
      const first = text.charCodeAt(0)
      const last = text.charCodeAt(text.length - 1)
      if ((first === 34 || first === 39) && last === first) return text.slice(1, -1)
    }
    return text
  }

  private commandNameOf(node: Node): string {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "command_name") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const word = child.namedChild(j)
          if (word && word.type === "word") return word.text
        }
        return child.text
      }
    }
    return ""
  }

  private functionName(node: Node): string {
    let prev: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "compound_statement" && prev && (prev.type === "word" || prev.type === "identifier")) {
        return prev.text
      }
      prev = child
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "word" && child.text !== "function") return child.text
    }
    return ""
  }

  private extractFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], parentFn: string) {
    const name = this.functionName(node)
    if (!name) return
    symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: parentFn || undefined,
      visibility: "public",
      ownerName: parentFn || undefined,
      parameters: [],
      metadata: { bashSpecific: true },
    })
  }

  private extractAssignment(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    parentFn: string,
    isArray: boolean,
    declaredSymbols: Set<string>,
  ) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "variable_name" && child.text.trim() !== "") {
        const key = `${parentFn || "global"}\u0000${child.text}`
        if (declaredSymbols.has(key)) return // reassignment, not a declaration
        declaredSymbols.add(key)
        symbols.push({
          name: child.text,
          kind: ASTEngine.SymbolKind.Variable,
          range: this.nodeToRange(node),
          scope: parentFn || undefined,
          visibility: parentFn ? "private" : "public",
          ownerName: parentFn || undefined,
          metadata: { bashSpecific: true, isArray, isImplicitGlobal: !parentFn },
        })
        return
      }
    }
  }

  private extractDeclaration(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    parentFn: string,
    functionParams: Map<string, Set<string>>,
    declaredSymbols: Set<string>,
  ) {
    const keyword = node.child(0)?.text ?? ""
    if (!DECLARATION_KEYWORDS.has(keyword)) return

    // export -f fn — exports a function definition; mark the existing symbol.
    const hasFunctionFlag = (() => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "word" && child.text === "-f") return true
      }
      return false
    })()

    const isArrayDecl = keyword === "declare" || keyword === "typeset"
    let sawArrayFlag = false
    if (isArrayDecl) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "word" && child.text === "-a") sawArrayFlag = true
      }
    }

    const emit = (name: string, range: ASTEngine.UniversalSymbol["range"]) => {
      if (!name || name.trim() === "") return
      const key = `${parentFn || "global"}\u0000${name}`
      if (declaredSymbols.has(key)) return // reassignment, not a declaration
      declaredSymbols.add(key)
      if (keyword === "export" || keyword === "readonly") {
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Constant,
          range,
          scope: parentFn || undefined,
          visibility: "public",
          ownerName: parentFn || undefined,
          metadata: {
            bashSpecific: true,
            isExported: keyword === "export",
            isReadonly: keyword === "readonly",
          },
        })
      } else {
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Variable,
          range,
          scope: parentFn || undefined,
          visibility: "private",
          ownerName: parentFn || undefined,
          metadata: {
            bashSpecific: true,
            isLocal: keyword === "local",
            isDeclared: keyword === "declare" || keyword === "typeset",
            isArray: sawArrayFlag,
          },
        })
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "variable_assignment") {
        if (hasFunctionFlag) {
          // export -f fn=... is unusual; treat the name as a function export
          for (let j = 0; j < child.namedChildCount; j++) {
            const vn = child.namedChild(j)
            if (vn && vn.type === "variable_name") {
              this.markFunctionExported(symbols, vn.text)
            }
          }
          continue
        }
        for (let j = 0; j < child.namedChildCount; j++) {
          const vn = child.namedChild(j)
          if (vn && vn.type === "variable_name") {
            emit(vn.text, this.nodeToRange(child))
            if (keyword === "local" && parentFn) {
              // positional $1..$9 defaults (local x=$1) also record parameters
              const valueNode = child.namedChild(1)
              this.collectPositionalFromValue(valueNode, functionParams, parentFn)
            }
          }
        }
      } else if (child.type === "word" && !child.text.startsWith("-") && child.text !== keyword) {
        if (hasFunctionFlag) this.markFunctionExported(symbols, child.text)
        else emit(child.text, this.nodeToRange(child))
      }
    }
  }

  private collectPositionalFromValue(
    node: Node | null,
    functionParams: Map<string, Set<string>>,
    fnName: string,
  ) {
    if (!node) return
    const scan = (n: Node) => {
      if (n.type === "simple_expansion") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "variable_name" && c.text.length > 0 && c.text.charCodeAt(0) >= 48 && c.text.charCodeAt(0) <= 57) {
            functionParams.get(fnName)?.add(c.text)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) scan(child)
      }
    }
    scan(node)
  }

  private markFunctionExported(symbols: ASTEngine.UniversalSymbol[], name: string) {
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.kind === ASTEngine.SymbolKind.Function && s.name === name) {
        s.metadata = { ...s.metadata, isExported: true }
        s.visibility = "public"
        return
      }
    }
  }

  private expansionVariableName(node: Node): string {
    // $VAR → variable_name child; ${VAR...} → variable_name or subscript base.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "variable_name") return child.text
      if (child.type === "subscript") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const base = child.namedChild(j)
          if (base && base.type === "variable_name") return base.text
        }
      }
      if (child.type === "special_variable_name") return child.text
    }
    return ""
  }

  private extractCommand(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
    patterns: Set<string>,
    ctx: {
      addRel: (source: string, target: string, type: ASTEngine.RelationshipType, confidence: number, metadata?: Record<string, unknown>) => void
      relSource: () => string
      caseDepth: number
      flags: { usesEval: () => boolean; usesSudo: () => boolean; hasChmod777: () => boolean; hasRmRoot: () => boolean; hasStrictError: () => boolean }
      setFlag: { eval: (v: boolean) => void; sudo: (v: boolean) => void; chmod777: (v: boolean) => void; rmRoot: (v: boolean) => void; strictError: (v: boolean) => void }
    },
  ) {
    const cmdName = this.commandNameOf(node)
    if (!cmdName) return

    // Dependency/pattern classification for well-known tooling.
    if (cmdName === "docker" || cmdName === "docker-compose" || cmdName === "kubectl" || cmdName === "helm") {
      patterns.add("Container/Orchestration Script")
      patterns.add("Deployment Script")
    } else if (cmdName === "aws" || cmdName === "gcloud" || cmdName === "az" || cmdName === "terraform") {
      patterns.add("Cloud Infrastructure Script")
    } else if (cmdName === "npm" || cmdName === "yarn" || cmdName === "pnpm" || cmdName === "cargo" || cmdName === "go") {
      patterns.add("Build/Compilation Script")
    } else if (cmdName === "curl" || cmdName === "wget") {
      patterns.add("Network Request Script")
    } else if (cmdName === "eval") {
      ctx.setFlag.eval(true)
      patterns.add("Dynamic Code Execution")
    } else if (cmdName === "sudo") {
      ctx.setFlag.sudo(true)
      patterns.add("Privilege Escalation")
    }

    if (cmdName === "source" || cmdName === ".") {
      const arg = this.firstArgumentWord(node)
      if (arg) {
        imports.push({
          module: arg,
          items: ["*"],
          isDefaultImport: true,
          isNamespaceImport: false,
          range: this.nodeToRange(node),
        })
        ctx.addRel(ctx.relSource(), arg, ASTEngine.RelationshipType.Imports, 1.0, { isSourceImport: true })
        ctx.addRel(ctx.relSource(), arg, ASTEngine.RelationshipType.References, 1.0, {
          isSourceDependency: true,
          bashSpecific: true,
        })
      }
      return
    }

    if (cmdName === "export") {
      this.handleExportCommand(node, symbols, ctx)
      return
    }

    if (cmdName === "alias") {
      const aliasName = this.aliasNameOf(node)
      if (aliasName) {
        symbols.push({
          name: aliasName,
          kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node),
          scope: ctx.relSource() === "global" ? undefined : ctx.relSource(),
          visibility: "public",
          ownerName: ctx.relSource() === "global" ? undefined : ctx.relSource(),
          metadata: { isAlias: true, bashSpecific: true },
        })
      }
      return
    }

    if (cmdName === "trap") {
      this.handleTrap(node, ctx)
      return
    }

    if (cmdName === "set") {
      if (this.hasErrexitFlags(node)) {
        ctx.setFlag.strictError(true)
        patterns.add("Strict Error Handling")
      }
      return
    }

    if (cmdName === "chmod") {
      if (this.hasArgument(node, "777")) {
        ctx.setFlag.chmod777(true)
        patterns.add("Insecure Permissions")
      }
      return
    }

    if (cmdName === "rm") {
      if (this.isRmRoot(node)) {
        ctx.setFlag.rmRoot(true)
        patterns.add("Destructive File Operation")
      }
      return
    }

    if (SHELL_BUILTINS.has(cmdName)) return
    if (ctx.caseDepth > 0) return // case-branch commands excluded as dispatch noise
    ctx.addRel(ctx.relSource(), cmdName, ASTEngine.RelationshipType.Calls, 1.0, {
      isFunctionCall: true,
      isExternalCommand: true,
    })
  }

  private handleExportCommand(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    ctx: { relSource: () => string },
  ) {
    // `export -f fn` in command position — mark function exported.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "word" || child.text !== "-f") continue
      for (let j = 0; j < node.namedChildCount; j++) {
        const word = node.namedChild(j)
        if (word && word.type === "word" && !word.text.startsWith("-") && word.text !== "export") {
          this.markFunctionExported(symbols, word.text)
        }
      }
      return
    }
    // `export VAR=value` in command position → Constant.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "variable_assignment") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const vn = child.namedChild(j)
          if (vn && vn.type === "variable_name") {
            symbols.push({
              name: vn.text,
              kind: ASTEngine.SymbolKind.Constant,
              range: this.nodeToRange(child),
              scope: ctx.relSource() === "global" ? undefined : ctx.relSource(),
              visibility: "public",
              ownerName: ctx.relSource() === "global" ? undefined : ctx.relSource(),
              metadata: { isExported: true, bashSpecific: true },
            })
          }
        }
      }
    }
  }

  private aliasNameOf(node: Node): string {
    // `alias ll='ls -la'` parses the definition as a concatenation whose first
    // word carries the name and an `=` separator (e.g. `ll=`). The grammar
    // provides no structural field for the alias name, so the name is the
    // portion before the first `=` — index arithmetic, not source scanning.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      const text = child.type === "concatenation" ? child.text : child.type === "word" ? child.text : ""
      if (text) {
        const eq = text.indexOf("=")
        if (eq > 0) {
          const name = text.slice(0, eq)
          if (name.trim() !== "" && !name.startsWith("-")) return name
        }
      }
    }
    return ""
  }

  private handleTrap(
    node: Node,
    ctx: { addRel: (source: string, target: string, type: ASTEngine.RelationshipType, confidence: number, metadata?: Record<string, unknown>) => void },
  ) {
    // trap 'handler' SIGNAL — the handler is the first argument; the signal
    // list follows. Emits signal → handler Calls edges.
    let handler = ""
    const signals: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      const type = child.type
      if (type === "raw_string" || type === "string") {
        const inner = this.stripQuotes(child.text)
        if (!handler) handler = inner
      } else if (type === "word") {
        if (child.text === "trap") continue
        if (child.text.startsWith("-")) continue
        if (!handler) handler = child.text
        else signals.push(child.text)
      }
    }
    if (handler && signals.length > 0) {
      for (const signal of signals) {
        ctx.addRel(signal, handler, ASTEngine.RelationshipType.Calls, 0.7, {
          isTrapHandler: true,
          bashSpecific: true,
        })
      }
    }
  }

  private hasErrexitFlags(node: Node): boolean {
    let sawO = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "word") continue
      const text = child.text
      if (text === "-o") {
        sawO = true
        continue
      }
      if (sawO && text === "errexit") return true
      sawO = false
      if (text.startsWith("-") && text.length > 1) {
        for (let j = 1; j < text.length; j++) {
          if (text.charCodeAt(j) === 101) return true // lowercase e → errexit
        }
      }
    }
    return false
  }

  private hasArgument(node: Node, value: string): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "word" && child.text === value) return true
    }
    return false
  }

  private isRmRoot(node: Node): boolean {
    let hasRecursive = false
    let hasForce = false
    let hasRoot = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "word") continue
      const text = child.text
      if (text === "/") hasRoot = true
      else if (text.startsWith("-")) {
        for (let j = 1; j < text.length; j++) {
          const code = text.charCodeAt(j)
          if (code === 114) hasRecursive = true // r
          if (code === 102) hasForce = true // f
        }
      }
    }
    return hasRecursive && hasForce && hasRoot
  }

  private firstArgumentWord(node: Node): string {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type === "command_name") continue
      if (child.type === "word" || child.type === "raw_string" || child.type === "string" || child.type === "concatenation") {
        return this.stripQuotes(child.text)
      }
    }
    return ""
  }

  private detectFrameworks(patterns: string[]): string[] {
    const frameworks = ["Bash"]
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Container/Orchestration Script") frameworks.push("Docker/Kubernetes")
      if (patterns[i] === "Cloud Infrastructure Script") frameworks.push("Cloud Native")
    }
    return frameworks
  }

  private generateInsights(patterns: string[], hasStrictError: boolean): string[] {
    const insights: string[] = []
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Deployment Script") {
        insights.push("This script contains deployment logic.")
        break
      }
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
