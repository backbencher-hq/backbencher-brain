import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

const PERL_BUILTINS = new Set([
  "abs", "alarm", "atan2", "bind", "binmode", "bless", "caller", "chdir", "chmod", "chomp",
  "chop", "chown", "close", "closedir", "cmp", "connect", "continue", "cos", "crypt", "defined",
  "delete", "die", "do", "dump", "each", "eof", "eval", "exec", "exists", "exit", "exp", "fcntl",
  "fileno", "flock", "fork", "format", "formline", "getc", "getgrent", "getgrgid", "getgrnam",
  "gethostbyname", "getlogin", "getnetbyname", "getpeername", "getpgrp", "getppid", "getpriority",
  "getprotobyname", "getpwnam", "getservbyname", "getsockname", "getsockopt", "glob", "gmtime", "goto",
  "grep", "hex", "if", "index", "int", "ioctl", "join", "keys", "kill", "last", "lc", "lcfirst",
  "length", "link", "listen", "local", "localtime", "lock", "log", "lstat", "map", "mkdir", "msgctl",
  "msgget", "msgrcv", "msgsnd", "my", "next", "oct", "open", "opendir", "ord", "pack", "pipe",
  "pop", "pos", "print", "printf", "prototype", "push", "quotemeta", "rand", "read", "readdir",
  "readline", "readlink", "readpipe", "recv", "redo", "ref", "rename", "require", "reset", "return",
  "reverse", "rewinddir", "rindex", "rmdir", "scalar", "seek", "seekdir", "select", "semctl", "semget",
  "semop", "send", "setpgrp", "setpriority", "setsockopt", "shift", "shmctl", "shmget", "shmread",
  "shmwrite", "shutdown", "sin", "sleep", "socket", "socketpair", "sort", "splice", "split", "sprintf",
  "sqrt", "srand", "stat", "study", "substr", "symlink", "syscall", "sysopen", "sysread", "sysseek",
  "syswrite", "tell", "telldir", "tie", "tied", "time", "times", "truncate", "uc", "ucfirst", "umask",
  "undef", "unlink", "unpack", "unshift", "untie", "utime", "values", "vec", "wait", "waitpid", "wantarray",
  "warn", "write", "xor",
])

/**
 * Perl extraction deliberately follows the stable AST contract:
 * packages/classes/roles, named subs, top-level package variables, imports,
 * inheritance, calls, constructor calls, and explicit Moose declarations.
 * Lexical locals, parameters, anonymous subs, and arbitrary expression nodes
 * are not symbols. No source-text regular expressions are used.
 */
export class RealPerlAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    _filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const frameworks = new Set<string>(["Perl"])
    const patterns = new Set<string>()
    const symbolKeys = new Set<string>()
    const symbolsByKey = new Map<string, ASTEngine.UniversalSymbol>()
    const relationshipKeys = new Set<string>()
    const packageBases = new Map<string, string[]>()
    const packageMethods = new Map<string, Set<string>>()
    const deferredIsa: { owner: string; right: Node }[] = []

    if (!rootNode) return this.result(symbols, relationships, imports, exports, errors, content, frameworks, patterns)

    this.collectErrors(rootNode, errors)

    type WalkState = {
      packageName: string
      ownerName?: string
      ownerKind?: ASTEngine.SymbolKind
      functionName?: string
      insideFunction: boolean
      visibility: string
    }

    const addSymbol = (
      name: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      state: WalkState,
      extra: Record<string, unknown> = {},
      ownerOverride?: string,
    ): ASTEngine.UniversalSymbol | undefined => {
      if (!name) return undefined
      const owner = ownerOverride ?? state.ownerName
      const key = `${kind}\u001f${owner || ""}\u001f${name}`
      if (symbolKeys.has(key)) return symbolsByKey.get(key)
      const symbol: ASTEngine.UniversalSymbol = {
        name,
        kind,
        range: this.nodeToRange(node),
        scope: owner || state.packageName || undefined,
        ownerName: owner,
        ownerKind: owner ? state.ownerKind : undefined,
        visibility: state.visibility,
        metadata: { perlSpecific: true, ...extra },
      }
      symbolKeys.add(key)
      symbolsByKey.set(key, symbol)
      symbols.push(symbol)
      return symbol
    }

    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      metadata: Record<string, unknown> = {},
      confidence = 0.9,
    ) => {
      if (!source || !target) return
      const key = `${type}\u001f${source}\u001f${target}`
      if (relationshipKeys.has(key)) return
      relationshipKeys.add(key)
      relationships.push({ source, target, type, confidence, metadata: { perlSpecific: true, ...metadata } })
    }

    const addCall = (target: string, state: WalkState) => {
      if (!target || PERL_BUILTINS.has(target) || target === "use" || target === "no") return
      addRelationship(state.functionName || state.ownerName || state.packageName || "global", this.leafName(target), ASTEngine.RelationshipType.Calls)
    }

    const walk = (node: Node, state: WalkState): void => {
      switch (node.type) {
        case "package_statement": {
          const nameNode = node.childForFieldName("name") || this.findChildByType(node, "package")
          const name = nameNode?.text || ""
          if (!name) break
          const kind = ASTEngine.SymbolKind.Class
          addSymbol(name, kind, node, { ...state, packageName: "" }, { isPackage: true })
          patterns.add("Packages")

          const block = node.childForFieldName("body") || this.findChildByType(node, "block")
          if (block) {
            walkChildren(block, { ...state, packageName: name, ownerName: name, ownerKind: kind, insideFunction: false })
          }
          // A non-block package declaration changes the lexical package for
          // all following siblings. The source-file walker passes this state
          // by reference through the sequential child loop below.
          state.packageName = name
          return
        }


        case "subroutine_declaration_statement":
        case "method_declaration_statement": {
          if (state.insideFunction) {
            // Named subs nested in a closure are not stable package API symbols,
            // but their body can still contain useful calls.
            const nestedBody = node.childForFieldName("body") || this.findChildByType(node, "block")
            if (nestedBody) walkChildren(nestedBody, { ...state, insideFunction: true })
            return
          }
          const nameNode = node.childForFieldName("name") || this.findChildByType(node, "bareword")
          const rawName = nameNode?.text || ""
          if (!rawName) break
          const isConstructor = rawName === "new"
          const name = isConstructor ? "constructor" : rawName
          const owner = state.packageName || state.ownerName
          const kind = isConstructor ? ASTEngine.SymbolKind.Constructor : owner ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function
          const symbol = addSymbol(name, kind, node, {
            ...state,
            ownerName: owner,
            ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
          }, {
            originalName: rawName,
            isMethod: !!owner,
            isConstructor,
          }, owner)
          if (symbol) {
            symbol.parameters = this.extractParameters(node)
            symbol.ownerKind = owner ? ASTEngine.SymbolKind.Class : undefined
          }
          if (owner && symbol) {
            let methodSet = packageMethods.get(owner)
            if (!methodSet) {
              methodSet = new Set<string>()
              packageMethods.set(owner, methodSet)
            }
            methodSet.add(rawName)
          }
          const body = node.childForFieldName("body") || this.findChildByType(node, "block")
          if (body) walkChildren(body, { ...state, ownerName: owner, ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined, functionName: name, insideFunction: true })
          return
        }

        case "variable_declaration": {
          const declaration = this.declarationKind(node)
          patterns.add("Variable Declarations")
          // `my`/`state`/`field` declarations are lexical and deliberately
          // excluded. Only package globals (`our`) at file/package scope are
          // stable symbols.
          if (state.insideFunction || declaration !== "our") break
          for (const variable of this.variableChildren(node)) {
            const varNameNode = this.findChildByType(variable, "varname")
            const rawName = varNameNode?.text || ""
            const name = this.stripSigil(rawName)
            if (!name || name === "_") continue
            const kind = this.isAllCapsName(name) ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable
            addSymbol(name, kind, variable, state, { perlDeclType: declaration, sigil: variable.type }, state.packageName || undefined)
          }
          break
        }

        case "use_statement": {
          const moduleNode = node.childForFieldName("module") || this.findChildByType(node, "package")
          const module = moduleNode?.text || ""
          if (!module) break
          const args = this.argumentValues(node)
          imports.push({
            module,
            items: args.length > 0 ? args : ["*"],
            isDefault: true,
            range: this.nodeToRange(node),
            metadata: { perlSpecific: true, type: "use" },
          })
          patterns.add("Module Includes")
          if (module === "Moose" || module === "Moo" || module === "Mojo::Base") frameworks.add(module === "Mojo::Base" ? "Mojolicious" : "Moose/Moo OOP")
          if (module === "parent" || module === "base") {
            const parents = args.filter((arg) => !this.isOption(arg))
            if (state.packageName) {
              const existing = packageBases.get(state.packageName) || []
              for (const parent of parents) if (parent && !existing.includes(parent)) existing.push(parent)
              packageBases.set(state.packageName, existing)
            }
          }
          if (module === "Mojo::Base" && state.packageName && args[0] && !this.isOption(args[0])) {
            const existing = packageBases.get(state.packageName) || []
            if (!existing.includes(args[0])) existing.push(args[0])
            packageBases.set(state.packageName, existing)
          }
          return
        }

        case "assignment_expression": {
          const left = node.childForFieldName("left")
          const right = node.childForFieldName("right")
          const leftVar = left ? this.variableChildren(left).map((variable) => this.findChildByType(variable, "varname")).find(Boolean) : undefined
          const leftName = leftVar?.text || ""
          if (leftName === "ISA" && right && state.packageName) deferredIsa.push({ owner: state.packageName, right })
          if (leftName === "EXPORT" && right) {
            for (const exported of this.wordValues(right)) {
              exports.push({ name: exported, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), metadata: { perlSpecific: true, exportArray: "EXPORT" } })
            }
            patterns.add("Exports")
          }
          break
        }

        case "ambiguous_function_call_expression":
        case "function_call_expression": {
          const functionNode = node.childForFieldName("function") || this.findChildByType(node, "function")
          const target = functionNode?.text || ""
          if (target === "has") {
            const property = this.firstValue(node)
            if (property && state.packageName && !symbolKeys.has(`${ASTEngine.SymbolKind.Property}\u001f${state.packageName}\u001f${property}`)) {
              addSymbol(property, ASTEngine.SymbolKind.Property, node, { ...state, ownerName: state.packageName, ownerKind: ASTEngine.SymbolKind.Class }, { isMooseProperty: true }, state.packageName)
            }
            frameworks.add("Moose/Moo OOP")
            patterns.add("Declarative Properties")
          } else if (target === "with" || target === "extends") {
            const type = target === "with" ? ASTEngine.RelationshipType.Implements : ASTEngine.RelationshipType.Extends
            for (const arg of this.argumentValues(node)) addRelationship(state.packageName || "global", this.leafName(arg), type, { mooseKeyword: target })
            frameworks.add("Moose/Moo OOP")
          } else if (target === "new") {
            const requestedType = this.firstValue(node)
            const instanceTarget = requestedType && !requestedType.includes("$") ? `${this.leafName(requestedType)}.constructor` : "constructor"
            addRelationship(state.functionName || state.packageName || "global", instanceTarget, ASTEngine.RelationshipType.Instantiates, { isConstructor: true })
          } else {
            addCall(target, state)
          }
          break
        }

        case "method_call_expression": {
          const methodNode = this.findChildByType(node, "method")
          const method = methodNode?.text || ""
          if (method === "new") {
            const invocant = node.childForFieldName("invocant") || this.firstNamedChild(node)
            const target = invocant ? this.invocantName(invocant) : ""
            // A concrete package invocant is resolvable; a scalar or chained
            // method receiver is dynamic and must not become a phantom type.
            if (target && !target.includes("$") && !target.includes("->")) {
              addRelationship(state.functionName || state.packageName || "global", `${this.leafName(target)}.constructor`, ASTEngine.RelationshipType.Instantiates, { isConstructor: true })
            }
          } else {
            addCall(method, state)
          }
          break
        }
      }

      if (node.type !== "source_file") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child) walk(child, state)
        }
      }
    }

    const walkChildren = (container: Node, state: WalkState): void => {
      for (let i = 0; i < container.namedChildCount; i++) {
        const child = container.namedChild(i)
        if (child) walk(child, state)
      }
    }

    // Source-file children are intentionally visited in order because a
    // non-block package declaration changes the active Perl package.
    const rootState: WalkState = { packageName: "", insideFunction: false, visibility: "public" }
    if (rootNode.type === "source_file") walkChildren(rootNode, rootState)
    else walk(rootNode, rootState)

    for (const item of deferredIsa) {
      for (const parent of this.wordValues(item.right)) {
        if (parent) {
          const bases = packageBases.get(item.owner) || []
          if (!bases.includes(parent)) bases.push(parent)
          packageBases.set(item.owner, bases)
        }
      }
    }

    for (const [owner, bases] of packageBases) {
      for (const base of bases) addRelationship(owner, this.leafName(base), ASTEngine.RelationshipType.Extends, { via: "Perl inheritance" })
    }

    // Resolve overrides against local declarations first, then the project
    // companion index supplied by the production/differential caller.
    for (const symbol of symbols) {
      if ((symbol.kind !== ASTEngine.SymbolKind.Method && symbol.kind !== ASTEngine.SymbolKind.Constructor) || !symbol.ownerName) continue
      const base = packageBases.get(symbol.ownerName)?.[0]
      if (!base) continue
      const baseLeaf = this.leafName(base)
      const method = String(symbol.metadata?.originalName || symbol.name)
      const candidateNames = [method, symbol.name]
      const localMethods = packageMethods.get(base) || packageMethods.get(baseLeaf)
      const companionMethods = context?.overrideCompanion?.get(base) || context?.overrideCompanion?.get(baseLeaf)
      const localDeclares = candidateNames.some((candidate) => localMethods?.has(candidate))
      const companionDeclares = candidateNames.some((candidate) => companionMethods?.has(candidate))
      if (localDeclares || companionDeclares) {
        addRelationship(`${symbol.ownerName}.${method}`, `${baseLeaf}.${method}`, ASTEngine.RelationshipType.Overrides, { isOverride: true }, 0.95)
      } else if (!context?.overrideCompanion) {
        // Pass 3 (family parity with java/groovy resolveOverrides): the base
        // is not declared in this file and no companion index was supplied
        // (production callers never populate one — see M37.10). Emit the
        // deterministic first-parent guess BELOW the patterns.ts threshold
        // (0.7): visible in raw output, counted as heuristic (honest
        // suspicion) by the differential. Pre-M37.10 this edge was silently
        // dropped for every externally-declared base package.
        addRelationship(`${symbol.ownerName}.${method}`, `${baseLeaf}.${method}`, ASTEngine.RelationshipType.Overrides, { isOverride: true, reasonCode: "first-parent-guess" }, 0.5)
      }
    }

    // Stable ownership edges are generated once, after extraction.
    for (const symbol of symbols) {
      if (symbol.ownerName && symbol.ownerName !== symbol.name) addRelationship(symbol.ownerName, symbol.name, ASTEngine.RelationshipType.Contains, {}, 1.0)
    }

    const metadata: Partial<ASTEngine.FileMetadata> = {
      complexity: symbols.length + relationships.length,
      linesOfCode: this.lineCount(content),
      cyclomaticComplexity: this.countBranches(rootNode) + 1,
      framework: [...frameworks][0],
      detectedFrameworks: [...frameworks],
      patterns: [...patterns],
      frameworkPatterns: [...patterns].map((pattern) => ({ framework: "Perl", patterns: [{ type: "usage", detected: true, description: pattern }] })),
      architecturalInsights: [],
      architecturalScore: Math.max(0, 100 - errors.length * 5),
      codeQuality: errors.length === 0 ? "Excellent" : "Fair",
      hasTypeInference: false,
      hasFrameworkIntelligence: true,
      analysisVersion: "3.0.0-perl-ast",
    }

    return { symbols, relationships, imports, exports, errors, metadata }
  }

  private result(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    errors: ASTEngine.ParseError[],
    content: string,
    frameworks: Set<string>,
    patterns: Set<string>,
  ) {
    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: this.lineCount(content),
        cyclomaticComplexity: 1,
        framework: [...frameworks][0],
        detectedFrameworks: [...frameworks],
        patterns: [...patterns],
        frameworkPatterns: [],
        architecturalInsights: [],
        architecturalScore: Math.max(0, 100 - errors.length * 5),
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.0-perl-ast",
      },
    }
  }

  private collectErrors(root: Node, errors: ASTEngine.ParseError[]): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "ERROR" || node.isMissing) {
        errors.push({ message: `Syntax ${node.type} detected.`, range: this.nodeToRange(node), severity: "warning" })
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  private variableChildren(node: Node): Node[] {
    const result: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && (child.type === "scalar" || child.type === "array" || child.type === "hash")) result.push(child)
    }
    return result
  }

  private declarationKind(node: Node): string {
    const text = node.text
    if (text.startsWith("our ")) return "our"
    if (text.startsWith("my ")) return "my"
    if (text.startsWith("state ")) return "state"
    if (text.startsWith("field ")) return "field"
    return "unknown"
  }

  private argumentValues(node: Node): string[] {
    const values: string[] = []
    const module = node.childForFieldName("module")
    if (module && module.type !== "package") values.push(...this.wordValues(module))
    const list = this.findChildByType(node, "list_expression")
    if (list) values.push(...this.wordValues(list))
    if (values.length === 0) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child !== module && (child.type === "string_literal" || child.type === "quoted_word_list" || child.type === "autoquoted_bareword")) values.push(...this.wordValues(child))
      }
    }
    return values
  }

  private wordValues(node: Node): string[] {
    if (node.type === "string_content" || node.type === "autoquoted_bareword" || node.type === "bareword" || node.type === "package") return node.text ? this.splitWords(node.text) : []
    if (node.type === "quoted_word_list") {
      const content = node.childForFieldName("content") || this.findChildByType(node, "string_content")
      return content ? this.splitWords(content.text) : []
    }
    if (node.type === "string_literal") {
      const content = node.childForFieldName("content") || this.findChildByType(node, "string_content")
      return [content ? content.text : this.unquote(node.text)]
    }
    const values: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) values.push(...this.wordValues(child))
    }
    return values
  }

  private splitWords(text: string): string[] {
    const result: string[] = []
    let current = ""
    for (const char of text) {
      if (char === " " || char === "\t" || char === "\n" || char === ",") {
        if (current) result.push(current)
        current = ""
      } else current += char
    }
    if (current) result.push(current)
    return result
  }

  private firstValue(node: Node): string | undefined {
    const values = this.argumentValues(node)
    return values[0]
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const parameters = node.childForFieldName("parameters")
    if (!parameters) return []
    const result: ASTEngine.Parameter[] = []
    const stack: Node[] = [parameters]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === "scalar" || current.type === "array" || current.type === "hash") {
        const varname = this.findChildByType(current, "varname")
        if (varname) result.push({ name: this.stripSigil(varname.text) })
        continue
      }
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return result
  }

  private invocantName(node: Node): string {
    if (node.type === "scalar" || node.type === "array" || node.type === "hash") {
      // Keep the sigil: it distinguishes a dynamic variable receiver from a
      // concrete package invocant such as BaseService->new().
      return node.text
    }
    if (node.type === "function_call_expression" || node.type === "ambiguous_function_call_expression") {
      const fn = node.childForFieldName("function") || this.findChildByType(node, "function")
      return fn?.text || ""
    }
    return node.text
  }

  private isOption(value: string): boolean {
    return value.length > 0 && value[0] === "-"
  }

  private stripSigil(name: string): string {
    if (!name) return name
    const first = name[0]
    return first === "$" || first === "@" || first === "%" || first === "#" ? name.slice(1) : name
  }

  private unquote(text: string): string {
    if (text.length >= 2) {
      const first = text[0]
      const last = text[text.length - 1]
      if ((first === "'" && last === "'") || (first === '"' && last === '"')) return text.slice(1, -1)
    }
    return text
  }

  private leafName(name: string): string {
    const colon = name.lastIndexOf("::")
    return colon >= 0 ? name.slice(colon + 2) : name
  }

  private isAllCapsName(name: string): boolean {
    let hasLetter = false
    for (const char of name) {
      if (char >= "a" && char <= "z") return false
      if ((char >= "A" && char <= "Z") || (char >= "0" && char <= "9") || char === "_") hasLetter = true
    }
    return hasLetter
  }

  private findChildByType(node: Node, type: string): Node | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return undefined
  }

  private firstNamedChild(node: Node): Node | undefined {
    return node.namedChildCount > 0 ? (node.namedChild(0) || undefined) : undefined
  }

  private countBranches(root: Node): number {
    const branchTypes = new Set(["if_statement", "unless_statement", "while_statement", "until_statement", "for_statement", "foreach_statement", "conditional_expression", "ternary_expression"])
    let count = 0
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (branchTypes.has(node.type)) count++
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return count
  }

  private lineCount(content: string): number {
    let lines = 1
    for (const char of content) if (char === "\n") lines++
    return lines
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
