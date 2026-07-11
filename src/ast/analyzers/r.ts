// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealRAnalyzer implements LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ParseResult, "language" | "metadata"> & { metadata?: Partial<FileMetadata> } {
    const symbols: UniversalSymbol[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const relationships: UniversalRelationship[] = []
    const metadata: Partial<FileMetadata> = {
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
        this.handleBinaryOperator(current, symbols, exports, relationships, metadata)
      } else if (type === "call") {
        this.handleCall(current, symbols, imports, relationships, metadata)
      } else if (type === "comment") {
        this.handleComment(current, metadata)
      } else if (type === "function_definition" || type === "function") {
        const name = `anon_func_${current.startPosition.row + 1}_${current.startPosition.column + 1}`
        symbols.push({
          name,
          kind: SymbolKind.Function,
          range: this.getRange(current),
          signature: this.extractSignature(current),
          parameters: this.extractParameters(current),
          metadata: { rSpecific: true, isAnonymous: true },
        })
        this.pushIfUnique(metadata.patterns, "Anonymous Functions")
      } else if (type === "dollar") {
        const lhs = current.child(0)
        const rhs = current.child(2)
        if (lhs && rhs) {
          relationships.push({
            type: RelationshipType.Calls,
            source: lhs.text,
            target: rhs.text,
            metadata: { rSpecific: true, isMemberAccess: true },
          })
        }
      } else if (type === "subscript") {
        this.pushIfUnique(metadata.patterns, "Vectorized Subsetting")
      } else if (type === "formula") {
        this.pushIfUnique(metadata.patterns, "Formula Interface")
        if (metadata.statisticalFocus !== undefined) metadata.statisticalFocus += 10
      }

      if (type === "if" || type === "for" || type === "while" || type === "repeat") {
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

    // Post-loop: add contains for owned symbols (R is top-level, default owner is 'global')
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope || 'global'
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    return {
      symbols,
      imports,
      relationships,
      exports,
      metadata,
      errors: metadata.errors || [],
    }
  }

  private detectFrameworksFromImports(imports: ImportInfo[], metadata: Partial<FileMetadata>) {
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
    symbols: UniversalSymbol[],
    exports: ExportInfo[],
    relationships: UniversalRelationship[],
    metadata: Partial<FileMetadata>,
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

      const name = lhs.text
      if (!name) return
      const doc = this.extractDocstring(node)

      if (rhs.type === "function_definition" || rhs.type === "function") {
        const isS3Method = name.indexOf(".") !== -1 && name.charCodeAt(0) !== 46

        symbols.push({
          name,
          kind: isS3Method ? SymbolKind.Method : SymbolKind.Function,
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
            type: RelationshipType.Implements,
            metadata: { relationshipSubType: "s3_method" },
          })
        }

        if (doc && doc.indexOf("@export") !== -1) exports.push({ name, kind: SymbolKind.Function })
        return
      }

      if (rhs.type === "call") {
        const fnNode = rhs.childForFieldName("function") || rhs.child(0)
        const fnName = fnNode ? fnNode.text : ""

        // Catch R6 Classes
        if (fnName === "R6Class") {
          const baseClasses = this.extractNamedArguments(rhs, "inherit")
          symbols.push({
            name,
            kind: SymbolKind.Class,
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, type: "R6", isR6Class: true, baseClasses },
          })
          for (const bc of baseClasses) {
            relationships.push({
              source: name,
              target: bc,
              type: RelationshipType.Extends,
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
            kind: SymbolKind.Class,
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, type: "R5", isR5Class: true, baseClasses },
          })
          for (const bc of baseClasses) {
            relationships.push({
              source: name,
              target: bc,
              type: RelationshipType.Extends,
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
            kind: SymbolKind.Function, // Mapped as functional component
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
            kind: SymbolKind.Function,
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
            kind: SymbolKind.Function,
            range: this.getRange(node),
            docstring: doc,
            metadata: { rSpecific: true, isReactive: true, reactiveType: fnName },
          })
          return
        }
      }

      symbols.push({
        name,
        kind: SymbolKind.Variable,
        range: this.getRange(node),
        metadata: { rSpecific: true },
      })
    }
  }

  private extractR6Methods(
    callNode: Node,
    className: string,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
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
                    (methodVal.type === "function_definition" || methodVal.type === "function")
                  ) {
                    const methodName = methodNameNode.text
                    symbols.push({
                      name: methodName,
                      kind: SymbolKind.Function,
                      range: this.getRange(methodVal),
                      signature: this.extractSignature(methodVal),
                      parameters: this.extractParameters(methodVal),
                      docstring: "",
                      metadata: { rSpecific: true, isR6Method: true, r6Visibility: argName, ownerClass: className },
                    })
                    relationships.push({
                      source: className,
                      target: methodName,
                      type: RelationshipType.Contains,
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
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
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
                    (methodVal.type === "function_definition" || methodVal.type === "function")
                  ) {
                    const methodName = methodNameNode.text
                    symbols.push({
                      name: methodName,
                      kind: SymbolKind.Function,
                      range: this.getRange(methodVal),
                      signature: this.extractSignature(methodVal),
                      parameters: this.extractParameters(methodVal),
                      docstring: "",
                      metadata: { rSpecific: true, isR5Method: true, ownerClass: className },
                    })
                    relationships.push({
                      source: className,
                      target: methodName,
                      type: RelationshipType.Contains,
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

  private extractParameters(node: Node): Parameter[] {
    const params: Parameter[] = []
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

  private handleComment(node: Node, metadata: Partial<FileMetadata>): void {
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
    symbols: UniversalSymbol[],
    imports: ImportInfo[],
    relationships: UniversalRelationship[],
    metadata: Partial<FileMetadata>,
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

    const parentFn = this.findParentFunction(node)
    if (parentFn) {
      relationships.push({
        type: RelationshipType.Calls,
        source: parentFn,
        target: fnName,
        metadata: {},
      })
      // R class instantiation: ClassName$new() or ClassName()
      if (fnName && (fnName.endsWith("$new") || (fnName[0] === fnName[0].toUpperCase() && fnName[0] !== fnName[0].toLowerCase()))) {
        relationships.push({
          type: RelationshipType.Instantiates,
          source: parentFn,
          target: fnName.replace("$new", ""),
          confidence: 0.7,
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
                type: RelationshipType.References,
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
            type: RelationshipType.References,
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
            kind: SymbolKind.Class,
            range: this.getRange(node),
            docstring: this.extractDocstring(node),
            metadata: { rSpecific: true, type: "S4", isS4Class: true, baseClasses },
          })
          for (const bc of baseClasses) {
            relationships.push({
              source: className,
              target: bc,
              type: RelationshipType.Extends,
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
          symbols.push({
            name: methodName,
            kind: fnName === "setMethod" ? SymbolKind.Method : SymbolKind.Function,
            range: this.getRange(node),
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

  private findParentFunction(node: Node): string | null {
    let current: Node | null = node.parent
    while (current) {
      if (current.type === "binary_operator") {
        const operator = current.child(1)?.text
        if (operator === "<-" || operator === "=") {
          const rhs = current.child(2)
          if (rhs && (rhs.type === "function_definition" || rhs.type === "function")) {
            return current.child(0)?.text || null
          }
        }
      }
      current = current.parent
    }
    return null
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
      } else if (prev.type === "return" || prev.type === "throw") {
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
                  if (ca && (ca.type === "string" || ca.type === "identifier")) {
                    let text = ca.text
                    if (text.startsWith('"') || text.startsWith("'"))
                      text = text.substring(1, text.length - 1)
                    if (text) results.push(text)
                  }
                }
              }
            } else if (valNode.type === "string" || valNode.type === "identifier") {
              let text = valNode.text
              if (text.startsWith('"') || text.startsWith("'"))
                text = text.substring(1, text.length - 1)
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
