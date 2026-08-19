import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealRAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const declaredTypes = new Set<string>()
    const metadata: Partial<ASTEngine.FileMetadata> = {
      detectedFrameworks: [],
      patterns: [],
      architecturalInsights: [],
      cyclomaticComplexity: 1,
      linesOfCode: 0,
      dataManipulationIntensity: 0,
      statisticalFocus: 0,
      codeQuality: "excellent",
      architecturalScore: 100,
    }

    if (!rootNode) return { symbols, imports, errors: [] }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!metadata.errors) metadata.errors = []
          metadata.errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.getRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    const stack: Node[] = [rootNode]

    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue

      const type = current.type

      if (type === "binary_operator") {
        this.handleBinaryOperator(current, symbols, exports, relationships, metadata, declaredTypes)
      } else if (type === "call") {
        this.handleCall(current, symbols, imports, relationships, metadata, declaredTypes)
      } else if (type === "comment") {
        this.handleComment(current, metadata)
      } else if (type === "function_definition") {
        // Skip a function node nested directly inside another function node
        // (tree-sitter-r wraps the body in a second function node) — the outer
        // definition is handled by this same branch, so the inner wrapper would
        // otherwise duplicate the anonymous symbol.
        const fnParent = current.parent
        const isNestedWrapper =
          fnParent &&
          fnParent.type === "function_definition"
        // Skip a function that is the target of a named assignment — the
        // binary_operator handler already emits the named symbol, so the walk
        // must not ALSO emit an anon_func for the same definition.
        // NOTE: reference equality (child() === current) does NOT work with
        // web-tree-sitter — each child() call returns a fresh wrapper object.
        // Compare byte ranges instead.
        const isAssignmentTarget =
          fnParent &&
          fnParent.type === "binary_operator" &&
          (fnParent.child(1)?.text === "<-" ||
            fnParent.child(1)?.text === "=" ||
            fnParent.child(1)?.text === "<<-" ||
            fnParent.child(1)?.text === "->") &&
          (this.sameNode(fnParent.child(0), current) || this.sameNode(fnParent.child(2), current))
        // Anonymous function expressions are executable values, not stable
        // declarations. Named R functions are emitted by the assignment
        // handler; R6/R5 and S4 method values are emitted by their enclosing
        // class-system call handlers.
        if (!isNestedWrapper && !isAssignmentTarget) {
          this.pushIfUnique(metadata.patterns, "Anonymous Functions")
        }
      } else if (type === "subset") {
        this.pushIfUnique(metadata.patterns, "Vectorized Subsetting")
      } else if (type === "unary_operator" && current.child(0)?.text === "~") {
        this.pushIfUnique(metadata.patterns, "Formula Interface")
        if (metadata.statisticalFocus !== undefined) metadata.statisticalFocus += 10
      }

      if (type === "if_statement" || type === "for_statement" || type === "while_statement" || type === "repeat_statement") {
        if (metadata.cyclomaticComplexity !== undefined) {
          metadata.cyclomaticComplexity++
        }
      }

      for (let i = current.childCount - 1; i >= 0; i--) {
        const child = current.child(i)
        if (child) {
          stack.push(child)
        }
      }
    }

    this.detectFrameworksFromImports(imports, metadata)

    // Post-loop: add contains for owned symbols (R is top-level, default owner is 'global').
    // The set-based pass keeps relationship generation linear and removes the
    // duplicate contains edges emitted by R6/R5 method extraction.
    const containsKeys = new Set<string>()
    for (const rel of relationships) {
      if (rel.type === ASTEngine.RelationshipType.Contains && rel.source && rel.target) {
        containsKeys.add(`${rel.source}\u001f${rel.target}`)
      }
    }
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope || 'global'
      if (_owner) {
        const key = `${_owner}\u001f${s.name}`
        if (containsKeys.has(key)) continue
        containsKeys.add(key)
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    // Relationship identity is source/type/target. Preserve one edge per
    // semantic fact even when the same call appears in multiple AST wrappers.
    const uniqueRelationships: ASTEngine.UniversalRelationship[] = []
    const relationshipKeys = new Set<string>()
    for (const rel of relationships) {
      const key = `${rel.type || rel.relationshipType || ""}\u001f${rel.source || rel.from || ""}\u001f${rel.target || rel.to || ""}`
      if (relationshipKeys.has(key)) continue
      relationshipKeys.add(key)
      uniqueRelationships.push(rel)
    }

    return {
      symbols,
      imports,
      relationships: uniqueRelationships,
      exports,
      metadata,
      errors: metadata.errors || [],
    }
  }

  private detectFrameworksFromImports(imports: ASTEngine.ImportInfo[], metadata: Partial<ASTEngine.FileMetadata>) {
    let hasTidyverse = false
    let hasGgplot2 = false
    let hasShiny = false
    let hasPlumber = false
    let hasDataTable = false
    let hasRcpp = false

    for (let i = 0; i < imports.length; i++) {
      const module = imports[i].module
      if (module === "dplyr" || module === "ggplot2" || module === "tidyr" || module === "tidyverse")
        hasTidyverse = true
      if (module === "ggplot2") hasGgplot2 = true
      if (module === "shiny") hasShiny = true
      if (module === "plumber") hasPlumber = true
      if (module === "data.table") hasDataTable = true
      if (module === "Rcpp") hasRcpp = true
    }

    if (hasTidyverse) this.pushIfUnique(metadata.detectedFrameworks, "Tidyverse")
    if (hasGgplot2) this.pushIfUnique(metadata.detectedFrameworks, "ggplot2")
    if (hasShiny) {
      this.pushIfUnique(metadata.detectedFrameworks, "Shiny")
      if (!metadata.frameworkPatterns) metadata.frameworkPatterns = []
      metadata.frameworkPatterns.push({ framework: "Shiny", pattern: "ui/server" })
    }
    if (hasPlumber) this.pushIfUnique(metadata.detectedFrameworks, "Plumber")
    if (hasDataTable) this.pushIfUnique(metadata.detectedFrameworks, "data.table")
    if (hasRcpp) this.pushIfUnique(metadata.detectedFrameworks, "Rcpp")
  }

  private pushIfUnique(arr: string[] | undefined, value: string) {
    if (!arr) return
    let exists = false
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === value) {
        exists = true
        break
      }
    }
    if (!exists) arr.push(value)
  }

  private handleBinaryOperator(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    declaredTypes: Set<string>,
  ): void {
    const operatorNode = node.child(1)
    if (!operatorNode) return
    const operator = operatorNode.text

    if (operator === "%>%" || operator === "|>") {
      this.pushIfUnique(metadata.patterns, "Pipe Operations")
      if (metadata.dataManipulationIntensity !== undefined) metadata.dataManipulationIntensity += 20
    }

    if (operator === "<-" || operator === "=" || operator === "<<-" || operator === "->") {
      let lhs =
        operator === "->"
          ? node.childForFieldName("rhs") || node.child(2)
          : node.childForFieldName("lhs") || node.child(0)
      let rhs =
        operator === "->"
          ? node.childForFieldName("lhs") || node.child(0)
          : node.childForFieldName("rhs") || node.child(2)

      if (!lhs || !rhs) return

      // Only identifier assignments are declarations. Calls, subsets, and
      // `$`/`@` extraction nodes are mutations or expression results, not
      // stable variable identities.
      if (lhs.type !== "identifier") return
      const name = lhs.text
      if (!name) return
      const doc = this.extractDocstring(node)

      // Function-local assignments are execution locals, not file-level
      // declarations. This also prevents indexed/call-shaped local LHS nodes
      // from becoming phantom symbols in large R packages.
      const insideFunction = this.hasFunctionAncestor(node)
      if (insideFunction) return

      if (rhs.type === "function_definition") {
        const isS3Method = name.indexOf(".") !== -1 && name.charCodeAt(0) !== 46

        symbols.push({
          name,
          kind: isS3Method ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
          range: this.getRange(node),
          signature: this.extractSignature(rhs),
          docstring: doc,
          parameters: this.extractParameters(rhs),
          metadata: { rSpecific: true, isS3Method },
        })

        if (isS3Method) {
          this.pushIfUnique(metadata.patterns, "S3 Object System")
          let toName = ""
          for (let i = 0; i < name.length; i++) {
            if (name[i] === ".") break
            toName += name[i]
          }
          relationships.push({
            source: name,
            target: toName,
            type: ASTEngine.RelationshipType.Implements,
            metadata: { relationshipSubType: "s3_method" },
          })
        }

        if (doc && doc.indexOf("@export") !== -1) exports.push({ name, kind: ASTEngine.SymbolKind.Function })
        return
      }

      if (rhs.type === "call") {
        const fnNode = rhs.childForFieldName("function") || rhs.child(0)
        const fnName = fnNode ? this.callFunctionName(fnNode) : ""

        // Catch R6 Classes
        if (fnName === "R6Class") {
          const baseClasses = this.extractNamedArguments(rhs, "inherit")
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Class,
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, type: "R6", isR6Class: true, baseClasses },
          })
          declaredTypes.add(name)
          for (const bc of baseClasses) {
            relationships.push({
              source: name,
              target: bc,
              type: ASTEngine.RelationshipType.Extends,
              metadata: { relationshipSubType: "r6_inherits" },
            })
          }
          this.extractR6Methods(rhs, name, symbols, relationships)
          return
        }

        // Catch R5 (Reference Classes)
        if (fnName === "setRefClass") {
          const baseClasses = this.extractNamedArguments(rhs, "contains")
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Class,
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, type: "R5", isR5Class: true, baseClasses },
          })
          declaredTypes.add(name)
          for (const bc of baseClasses) {
            relationships.push({
              source: name,
              target: bc,
              type: ASTEngine.RelationshipType.Extends,
              metadata: { relationshipSubType: "r5_inherits" },
            })
          }
          this.extractR5Methods(rhs, name, symbols, relationships)
          return
        }

        // Catch Shiny Modules
        if (fnName === "moduleServer") {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Function, // Mapped as functional component
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, isShinyModuleServer: true, framework: "Shiny" },
          })
          this.pushIfUnique(metadata.patterns, "Shiny Modules")
          return
        }

        // Catch Inline C++ via Rcpp
        if (fnName === "cppFunction" || fnName === "cxxfunction") {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Function,
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, isInlineCpp: true, crossLanguage: "cpp" },
          })
          this.pushIfUnique(metadata.patterns, "Rcpp / Inline C++")
          return
        }

        // Catch Reactive Blocks
        if (
          fnName === "reactive" ||
          fnName === "observe" ||
          fnName === "observeEvent" ||
          fnName === "eventReactive" ||
          fnName === "reactiveVal" ||
          fnName === "reactiveValues" ||
          fnName === "reactiveExpr"
        ) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Function,
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, isReactive: true, reactiveType: fnName },
          })
          return
        }
      }

      // This branch is reached only for module-level identifier assignments;
      // field mutations and all function-local assignments returned above.
      symbols.push({
        name,
        kind: this.isAllCapsName(name) ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
        range: this.getRange(node),
        metadata: { rSpecific: true },
      })
    }
  }

  private sameNode(a: Node | null | undefined, b: Node | null | undefined): boolean {
    if (!a || !b) return false
    return a.startIndex === b.startIndex && a.endIndex === b.endIndex
  }

  private callFunctionName(fnNode: Node): string {
    // R6::R6Class, dplyr::filter etc. — collapse the namespace so framework
    // detection (R6Class, setRefClass, moduleServer, cppFunction...) matches
    // the bare function name.
    if (fnNode.type === "namespace_operator") {
      const parts = fnNode.text.split("::")
      return parts.length > 1 ? parts[parts.length - 1] : fnNode.text
    }
    return fnNode.text
  }

  private isAllCapsName(name: string): boolean {
    if (!name || name.length < 2) return false
    let hasLetter = false
    for (let i = 0; i < name.length; i++) {
      const c = name[i]
      if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) {
        hasLetter = true
        if (c >= "a" && c <= "z") return false
      }
    }
    return hasLetter
  }

  private extractR6Methods(
    callNode: Node,
    className: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ) {
    const argsNode = this.getArgumentsNode(callNode)
    if (!argsNode) return
    for (let i = 0; i < argsNode.childCount; i++) {
      const arg = argsNode.child(i)
      if (arg && arg.type === "argument") {
        const argNameNode = arg.childForFieldName("name") || arg.child(0)
        const argName = argNameNode ? argNameNode.text : ""
        if (argName === "public" || argName === "private" || argName === "active") {
          const listCall = arg.childForFieldName("value") || arg.child(2)
          if (
            listCall &&
            listCall.type === "call" &&
            (listCall.childForFieldName("function") || listCall.child(0))?.text === "list"
          ) {
            const listArgs = this.getArgumentsNode(listCall)
            if (listArgs) {
              for (let j = 0; j < listArgs.childCount; j++) {
                const listArg = listArgs.child(j)
                if (listArg && listArg.type === "argument") {
                  const methodNameNode = listArg.childForFieldName("name") || listArg.child(0)
                  const methodVal = listArg.childForFieldName("value") || listArg.child(2)
                  if (
                    methodNameNode &&
                    methodVal &&
                    (methodVal.type === "function_definition")
                  ) {
                    const methodName = methodNameNode.text
                    symbols.push({
                      name: methodName,
                      kind: ASTEngine.SymbolKind.Method,
                      range: this.getRange(methodVal),
                      signature: this.extractSignature(methodVal),
                      parameters: this.extractParameters(methodVal),
                      docstring: "",
                      ownerName: className,
                      metadata: { rSpecific: true, isR6Method: true, r6Visibility: argName, ownerClass: className },
                    })
                    relationships.push({
                      source: className,
                      target: methodName,
                      type: ASTEngine.RelationshipType.Contains,
                      metadata: { relationshipSubType: "r6_method", visibility: argName },
                    })
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private extractR5Methods(
    callNode: Node,
    className: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ) {
    const argsNode = this.getArgumentsNode(callNode)
    if (!argsNode) return
    for (let i = 0; i < argsNode.childCount; i++) {
      const arg = argsNode.child(i)
      if (arg && arg.type === "argument") {
        const argNameNode = arg.childForFieldName("name") || arg.child(0)
        const argName = argNameNode ? argNameNode.text : ""
        if (argName === "methods") {
          const listCall = arg.childForFieldName("value") || arg.child(2)
          if (
            listCall &&
            listCall.type === "call" &&
            (listCall.childForFieldName("function") || listCall.child(0))?.text === "list"
          ) {
            const listArgs = this.getArgumentsNode(listCall)
            if (listArgs) {
              for (let j = 0; j < listArgs.childCount; j++) {
                const listArg = listArgs.child(j)
                if (listArg && listArg.type === "argument") {
                  const methodNameNode = listArg.childForFieldName("name") || listArg.child(0)
                  const methodVal = listArg.childForFieldName("value") || listArg.child(2)
                  if (
                    methodNameNode &&
                    methodVal &&
                    (methodVal.type === "function_definition")
                  ) {
                    const methodName = methodNameNode.text
                    symbols.push({
                      name: methodName,
                      kind: ASTEngine.SymbolKind.Method,
                      range: this.getRange(methodVal),
                      signature: this.extractSignature(methodVal),
                      parameters: this.extractParameters(methodVal),
                      docstring: "",
                      ownerName: className,
                      metadata: { rSpecific: true, isR5Method: true, ownerClass: className },
                    })
                    relationships.push({
                      source: className,
                      target: methodName,
                      type: ASTEngine.RelationshipType.Contains,
                      metadata: { relationshipSubType: "r5_method" },
                    })
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private getParametersNode(node: Node): Node | null {
    const byField = node.childForFieldName("parameters")
    if (byField) return byField
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "parameters") return c
    }
    return null
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const params: ASTEngine.Parameter[] = []
    const parametersNode = this.getParametersNode(node)
    if (parametersNode) {
      for (let i = 0; i < parametersNode.childCount; i++) {
        const p = parametersNode.child(i)
        if (p && p.type === "parameter") {
          const nameNode = p.childForFieldName("name") || p.child(0)
          const defaultValueNode = p.childForFieldName("default_value") || p.child(2)
          if (nameNode) {
            params.push({
              name: nameNode.text,
              isOptional: !!defaultValueNode || p.text.indexOf("=") !== -1,
            })
          }
        }
      }
    }
    return params
  }

  private handleComment(node: Node, metadata: Partial<ASTEngine.FileMetadata>): void {
    if (node.text.startsWith("#'")) {
      this.pushIfUnique(metadata.patterns, "Roxygen Documentation")
    }
  }

  private getArgumentsNode(node: Node): Node | null {
    const byField = node.childForFieldName("arguments")
    if (byField) return byField
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "arguments") return c
    }
    return null
  }

  private handleCall(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    declaredTypes: Set<string>,
  ): void {
    const fnNode = node.childForFieldName("function") || node.child(0)
    if (!fnNode) return

    let fnName = fnNode.text

    if (fnNode.type === "namespace_operator") {
      const ns = fnNode.child(0)?.text
      if (ns && fnNode.child(1)?.text === "::") {
        imports.push({
          module: ns,
          names: [],
          range: this.getRange(node),
          isWildcard: true,
        })
      }
    }

    // S3 Generics detection
    if (fnName === "UseMethod") {
      this.pushIfUnique(metadata.patterns, "S3 Object System (Generics)")
      return
    }

    if (fnName.indexOf("apply") !== -1) {
      this.pushIfUnique(metadata.patterns, "Apply Family")
    }
    if (fnName === "data.frame" || fnName === "tibble" || fnName === "as.data.frame") {
      this.pushIfUnique(metadata.patterns, "Data Frames")
    }

    if (fnName === "lm" || fnName === "glm" || fnName === "summary") {
      if (metadata.statisticalFocus !== undefined) metadata.statisticalFocus += 30
    }

    // Tidyverse NSE checking
    if (["mutate", "select", "filter", "summarise", "group_by", "arrange", "aes", "vars"].includes(fnName)) {
      this.pushIfUnique(metadata.patterns, "Tidyverse Data Masking (NSE)")
      if (metadata.dataManipulationIntensity !== undefined) metadata.dataManipulationIntensity += 10
    }

    // Shiny NS
    if (fnName === "NS") {
      this.pushIfUnique(metadata.patterns, "Shiny Module Namespace (NS)")
    }

    if (fnName === "tryCatch" || fnName === "withCallingHandlers") {
      this.pushIfUnique(metadata.patterns, "Error Handling")
    }

    if (fnName === "on.exit") {
      this.pushIfUnique(metadata.patterns, "Cleanup Handlers")
    }

    if (["substitute", "quote", "bquote", "match.call", "match.arg", "enquo", "enquos", "expr", "enexpr"].includes(fnName)) {
      this.pushIfUnique(metadata.patterns, "Non-Standard Evaluation (NSE)")
    }

    const parentFn = this.findEnclosingCallable(node)
    if (parentFn) {
      relationships.push({
        type: ASTEngine.RelationshipType.Calls,
        source: parentFn,
        target: fnName,
        metadata: {},
      })
      // R6/R5 construction is only certain when the receiver was declared as
      // a class in this file. Capitalized external calls are not guessed as
      // instantiation, avoiding false positives such as `I()` and `DataMask$new()`.
      const constructorName = this.constructorTarget(fnNode)
      if (constructorName && declaredTypes.has(constructorName)) {
        relationships.push({
          type: ASTEngine.RelationshipType.Instantiates,
          source: parentFn,
          target: constructorName,
          confidence: 0.9,
          metadata: { isRConstructor: true },
        })
      }
    }

    if (fnName === "library" || fnName === "require") {
      const args = this.getArgumentsNode(node)
      if (args && args.childCount > 0) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "identifier" || arg.type === "string" || arg.type === "argument")) {
            let moduleName = arg.text
            if (arg.type === "argument") moduleName = arg.child(0)?.text || moduleName
            if (moduleName.startsWith('"') || moduleName.startsWith("'")) {
              moduleName = moduleName.substring(1, moduleName.length - 1)
            }
            if (moduleName && moduleName !== "(" && moduleName !== ")" && moduleName !== ",") {
              imports.push({
                module: moduleName,
                names: [],
                range: this.getRange(node),
                isWildcard: true,
              })
              // DependsOn for library/require imports
              relationships.push({
                source: "global",
                target: moduleName,
                type: ASTEngine.RelationshipType.References,
                confidence: 0.9,
                metadata: { rSpecific: true },
              })
            }
          }
        }
      }
      return
    }

    // Cross-language C++ resolution
    if (fnName === "sourceCpp") {
      this.pushIfUnique(metadata.patterns, "Rcpp / C++ Integration")
      const args = this.getArgumentsNode(node)
      if (args && args.childCount > 0) {
        let firstArg: Node | null = args.child(0)
        if (firstArg && firstArg.type === "argument") firstArg = firstArg.child(0)
        if (firstArg && firstArg.type === "string") {
          let path = firstArg.text
          if (path.length >= 2) path = path.substring(1, path.length - 1)
          imports.push({
            module: path,
            names: [],
            range: this.getRange(node),
            isWildcard: true,
          })
          relationships.push({
            type: ASTEngine.RelationshipType.References,
            source: "sourceCpp",
            target: path,
            metadata: { isCrossLanguage: true, language: "cpp" },
          })
        }
      }
      return
    }

    if (fnName === "source") {
      const args = this.getArgumentsNode(node)
      if (args && args.childCount > 0) {
        let firstArg: Node | null = args.child(0)
        if (firstArg && firstArg.type === "argument") firstArg = firstArg.child(0)
        if (firstArg && firstArg.type === "string") {
          let path = firstArg.text
          if (path.length >= 2) path = path.substring(1, path.length - 1)
          imports.push({
            module: path,
            names: [],
            range: this.getRange(node),
            isWildcard: true,
          })
        }
      }
      return
    }

    // S4 Object System detection
    if (fnName === "setClass") {
      this.pushIfUnique(metadata.patterns, "S4 Object System")
      const args = this.getArgumentsNode(node)
      if (args) {
        let className = ""
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "string" || arg.type === "argument")) {
            let text = arg.text
            if (arg.type === "argument") text = arg.child(0)?.text || text
            if (text.startsWith('"') || text.startsWith("'")) {
              className = text.substring(1, text.length - 1)
              break
            }
          }
        }
        if (className) {
          const baseClasses = this.extractNamedArguments(node, "contains")
          symbols.push({
            name: className,
            kind: ASTEngine.SymbolKind.Class,
            range: this.getRange(node),
            docstring: this.extractDocstring(node),
            metadata: { rSpecific: true, type: "S4", isS4Class: true, baseClasses },
          })
          declaredTypes.add(className)
          const slotNames = this.extractNamedArgumentKeys(node, "slots")
          for (const slotName of slotNames) {
            symbols.push({
              name: slotName,
              kind: ASTEngine.SymbolKind.Property,
              range: this.getRange(node),
              ownerName: className,
              ownerKind: ASTEngine.SymbolKind.Class,
              metadata: { rSpecific: true, isS4Slot: true },
            })
          }
          for (const bc of baseClasses) {
            relationships.push({
              source: className,
              target: bc,
              type: ASTEngine.RelationshipType.Extends,
              metadata: { relationshipSubType: "s4_inherits" },
            })
          }
        }
      }
      return
    }

    if (fnName === "setGeneric" || fnName === "setMethod") {
      const args = this.getArgumentsNode(node)
      if (args) {
        let methodName = ""
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "string" || arg.type === "argument")) {
            let text = arg.text
            if (arg.type === "argument") text = arg.child(0)?.text || text
            if (text.startsWith('"') || text.startsWith("'")) {
              methodName = text.substring(1, text.length - 1)
              break
            }
          }
        }
        if (methodName) {
          let ownerName: string | undefined
          if (fnName === "setMethod") {
            const classArg = this.stringArgumentAt(args, 1)
            if (classArg) ownerName = classArg
          }
          symbols.push({
            name: methodName,
            kind: fnName === "setMethod" ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
            range: this.getRange(node),
            ownerName,
            ownerKind: ownerName ? ASTEngine.SymbolKind.Class : undefined,
            docstring: this.extractDocstring(node),
            metadata: {
              rSpecific: true,
              type: fnName === "setGeneric" ? "S4_Generic" : "S4_Method",
              isS4Generic: fnName === "setGeneric",
              isS4Method: fnName === "setMethod",
            },
          })
        }
      }
    }
  }

  private hasFunctionAncestor(node: Node): boolean {
    let current: Node | null = node.parent
    while (current) {
      if (current.type === "function_definition") return true
      current = current.parent
    }
    return false
  }

  private findEnclosingCallable(node: Node): string | null {
    let current: Node | null = node.parent
    while (current) {
      if (current.type === "function_definition") {
        const parent = current.parent
        if (parent?.type === "binary_operator") {
          const op = parent.child(1)?.text
          if (op === "<-" || op === "=" || op === "<<-") {
            return parent.child(0)?.text || null
          }
        }
        // R6/R5 methods are named arguments inside `list(...)` values of
        // an R6Class/setRefClass call. Do not treat arbitrary named closure
        // arguments (`callback = function(...)`) as declarations/call scopes.
        if (parent?.type === "argument") {
          const methodName = parent.childForFieldName("name") || parent.child(0)
          let p: Node | null = parent.parent
          let sawMethodList = false
          while (p) {
            if (p.type === "call") {
              const fn = p.childForFieldName("function") || p.child(0)
              if (fn?.text === "list") sawMethodList = true
              else if (sawMethodList && (fn?.text === "R6Class" || fn?.text === "setRefClass")) {
                if (methodName?.text) return methodName.text
                break
              }
            }
            if (p.type === "function_definition") break
            p = p.parent
          }
        }
        // A setMethod call stores the generic name as its first string
        // argument; its anonymous function body still has a stable method
        // source for call relationships.
        let p: Node | null = parent
        while (p) {
          if (p.type === "call") {
            const fn = p.childForFieldName("function") || p.child(0)
            if (fn?.text === "setMethod") return this.stringArgumentAt(this.getArgumentsNode(p), 0) || null
            break
          }
          if (p.type === "function_definition") break
          p = p.parent
        }
        return null
      }
      current = current.parent
    }
    return null
  }

  private constructorTarget(fnNode: Node): string | null {
    if (fnNode.type === "extract_operator") {
      const operator = fnNode.child(1)?.text
      if (operator === "$" || operator === "@") return fnNode.child(0)?.text || null
    }
    const text = fnNode.text
    const marker = text.indexOf("$new")
    if (marker > 0) return text.substring(0, marker)
    return null
  }

  private stringArgumentAt(args: Node | null, index: number): string | undefined {
    if (!args) return undefined
    let seen = 0
    // The grammar exposes commas as named children too, so skip punctuation
    // explicitly while retaining source-order positional arguments.
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      const value = arg.type === "argument" ? (arg.childForFieldName("value") || arg.child(0)) : arg
      if (!value) continue
      if (seen === index && value.type === "string") {
        const content = value.childForFieldName("content") || value.child(0)
        return content?.text || this.unquoteString(value.text)
      }
      seen++
    }
    return undefined
  }

  private extractNamedArgumentKeys(node: Node, argName: string): string[] {
    const results: string[] = []
    const args = this.getArgumentsNode(node)
    if (!args) return results
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type !== "argument") continue
      const nameNode = arg.childForFieldName("name") || arg.child(0)
      if (!nameNode || nameNode.text !== argName) continue
      const value = arg.childForFieldName("value") || arg.child(2)
      if (!value || value.type !== "call") continue
      const fn = value.childForFieldName("function") || value.child(0)
      if (!fn || fn.text !== "c") continue
      const values = this.getArgumentsNode(value)
      if (!values) continue
      for (let j = 0; j < values.namedChildCount; j++) {
        const entry = values.namedChild(j)
        if (!entry || entry.type !== "argument") continue
        const entryName = entry.childForFieldName("name") || entry.child(0)
        if (entryName?.text) results.push(entryName.text)
      }
    }
    return results
  }

  private unquoteString(text: string): string {
    const trimmed = text.trim()
    if (trimmed.length >= 2) {
      const first = trimmed[0]
      const last = trimmed[trimmed.length - 1]
      if ((first === '"' || first === "'") && first === last) return trimmed.substring(1, trimmed.length - 1)
    }
    return trimmed
  }

  private extractSignature(node: Node): string | undefined {
    const parameters = this.getParametersNode(node)
    return parameters ? parameters.text : undefined
  }

  private extractDocstring(node: Node): string | undefined {
    let prev: Node | null = node.previousSibling
    let docsStack: string[] = []
    while (prev) {
      if (prev.type === "comment") {
        docsStack.push(prev.text)
        prev = prev.previousSibling
      } else if (prev.type === "return") {
        prev = prev.previousSibling
      } else {
        break
      }
    }

    if (docsStack.length === 0) return undefined

    let combined = ""
    for (let i = docsStack.length - 1; i >= 0; i--) {
      combined += docsStack[i]
      if (i > 0) combined += "\n"
    }
    return combined
  }

  private extractNamedArguments(node: Node, argName: string): string[] {
    const results: string[] = []
    const args = this.getArgumentsNode(node)
    if (!args) return results
    for (let i = 0; i < args.childCount; i++) {
      const arg = args.child(i)
      if (arg && arg.type === "argument") {
        const nameNode = arg.childForFieldName("name") || arg.child(0)
        if (nameNode && nameNode.text === argName) {
          const valNode = arg.childForFieldName("value") || arg.child(2)
          if (valNode) {
            if (valNode.type === "call" && (valNode.childForFieldName("function") || valNode.child(0))?.text === "c") {
              const cArgs = this.getArgumentsNode(valNode)
              if (cArgs) {
                for (let j = 0; j < cArgs.childCount; j++) {
                  const ca = cArgs.child(j)
                  if (ca && (ca.type === "string" || ca.type === "identifier" || ca.type === "argument")) {
                    const value = ca.type === "argument" ? (ca.childForFieldName("value") || ca.child(2)) : ca
                    if (!value) continue
                    let text = value.text
                    if (value.type === "string") {
                      const content = value.childForFieldName("content") || value.child(0)
                      text = content?.text || this.unquoteString(text)
                    }
                    if (text) results.push(text)
                  }
                }
              }
            } else if (valNode.type === "string" || valNode.type === "identifier") {
              let text = valNode.text
              if (valNode.type === "string") {
                const content = valNode.childForFieldName("content") || valNode.child(0)
                text = content?.text || this.unquoteString(text)
              }
              if (text) results.push(text)
            }
          }
        }
      }
    }
    return results
  }

  private getRange(node: Node) {
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
