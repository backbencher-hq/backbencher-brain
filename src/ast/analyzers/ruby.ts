// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealRubyAnalyzer implements LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ParseResult, "language" | "metadata"> & { metadata?: Partial<FileMetadata> } {
    const symbols: UniversalSymbol[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const relationships: UniversalRelationship[] = []

    // Use true Objects for O(1) tracking, no Sets or Maps needed for simple flags
    const frameworksObj: Record<string, boolean> = {}
    const patternsObj: Record<string, boolean> = {}

    const metadata: Partial<FileMetadata> = {
      detectedFrameworks: [],
      frameworkPatterns: [],
      cyclomaticComplexity: 1,
      linesOfCode: 0,
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

    // Manually count lines of code
    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    // Iterative stack
    const stack: { node: Node; parent: UniversalSymbol | null }[] = [{ node: rootNode, parent: null }]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node, parent } = popped
      let currentParent = parent

      const type = node.type

      if (type === "class") {
        const cls = this.handleClass(node, symbols, relationships, frameworksObj, patternsObj, parent)
        if (cls) currentParent = cls
      } else if (type === "module") {
        const mod = this.handleModule(node, symbols, parent)
        if (mod) currentParent = mod
      } else if (type === "method") {
        this.handleMethod(node, symbols, parent)
      } else if (type === "singleton_method") {
        this.handleSingletonMethod(node, symbols, parent)
      } else if (type === "singleton_class") {
        patternsObj["Eigenclass (Singleton Class)"] = true
      } else if (type === "assignment") {
        this.handleAssignment(node, symbols, parent)
      } else if (type === "call") {
        this.handleCall(node, imports, relationships, frameworksObj, patternsObj, parent, symbols)
      } else if (type === "command") {
        // Method calls without parentheses: `puts "hello"`, `redirect_to path`
        this.handleCommand(node, imports, relationships, frameworksObj, patternsObj, parent, symbols)
      } else if (type === "command_call") {
        // Chained commands: `foo.bar arg1, arg2`
        this.handleCommandCall(node, imports, relationships, frameworksObj, patternsObj, parent, symbols)
      } else if (type === "block" || type === "do_block") {
        const name = `${type}_${node.startPosition.row + 1}_${node.startPosition.column + 1}`
        symbols.push({
          name,
          kind: SymbolKind.Function,
          range: this.getRange(node),
          ownerName: parent ? parent.name : undefined,
          metadata: { rubySpecific: true, isAnonymousBlock: true },
        })
      } else if (type === "lambda") {
        const name = `lambda_${node.startPosition.row + 1}_${node.startPosition.column + 1}`
        symbols.push({
          name,
          kind: SymbolKind.Function,
          range: this.getRange(node),
          ownerName: parent ? parent.name : undefined,
          metadata: { rubySpecific: true, isLambda: true },
        })
      } else if (type === "rescue") {
        patternsObj["Error Handling"] = true
      }

      if (
        type === "if" ||
        type === "unless" ||
        type === "while" ||
        type === "until" ||
        type === "for" ||
        type === "case"
      ) {
        if (metadata.cyclomaticComplexity !== undefined) {
          metadata.cyclomaticComplexity++
        }
      }

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) {
          stack.push({ node: child, parent: currentParent })
        }
      }
    }

    this.detectFrameworks(imports, symbols, frameworksObj, patternsObj)

    for (const fw in frameworksObj) {
      metadata.detectedFrameworks!.push(fw)
    }
    for (const pat in patternsObj) {
      metadata.frameworkPatterns!.push({ framework: pat, patterns: ["Route DSL"] })
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

  private handleClass(
    node: Node,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    frameworksObj: Record<string, boolean>,
    patternsObj: Record<string, boolean>,
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return null

    const name = nameNode.text
    const superclassNode = node.childForFieldName("superclass")
    let superClass: string | undefined = undefined
    let isRailsModel = false
    let isRailsController = false

    if (superclassNode) {
      superClass = superclassNode.text

      if (superclassNode.type === "scope_resolution") {
        const scope = superclassNode.childForFieldName("scope")?.text || this.getFirstNamedChildText(superclassNode)
        const sName = superclassNode.childForFieldName("name")?.text || this.getLastNamedChildText(superclassNode)

        if (scope === "ActiveRecord" && sName === "Base") {
          isRailsModel = true
        } else if (scope === "ActionController" && sName === "Base") {
          isRailsController = true
        } else if (scope === "Sinatra" && sName === "Base") {
          frameworksObj["Sinatra"] = true
          patternsObj["Sinatra"] = true
        }
      } else if (superclassNode.type === "constant" || superclassNode.type === "identifier") {
        const sName = superclassNode.text
        if (sName === "ApplicationRecord") isRailsModel = true
        if (sName === "ApplicationController") isRailsController = true
      }

      relationships.push({
        source: name,
        target: superClass,
        type: RelationshipType.Extends,
        metadata: { railsSpecific: isRailsModel || isRailsController },
      })
    }

    const symbol: UniversalSymbol = {
      name,
      kind: SymbolKind.Class,
      range: this.getRange(node),
      ownerName: parent ? parent.name : undefined,
      parent: parent ? parent.name : undefined,
      metadata: { rubySpecific: true, isRailsModel, isRailsController, superClass },
    }
    symbols.push(symbol)
    return symbol
  }

  private getFirstNamedChildText(node: Node): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && child.isNamed) return child.text
    }
    return undefined
  }

  private getLastNamedChildText(node: Node): string | undefined {
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i)
      if (child && child.isNamed) return child.text
    }
    return undefined
  }

  private handleModule(
    node: Node,
    symbols: UniversalSymbol[],
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return null

    const symbol: UniversalSymbol = {
      name: nameNode.text,
      kind: SymbolKind.Module,
      range: this.getRange(node),
      ownerName: parent ? parent.name : undefined,
      parent: parent ? parent.name : undefined,
      metadata: { rubySpecific: true },
    }
    symbols.push(symbol)
    return symbol
  }

  private handleMethod(
    node: Node,
    symbols: UniversalSymbol[],
    parent: UniversalSymbol | null,
  ): void {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const isTopLevel = !parent

    symbols.push({
      name: nameNode.text,
      kind: isTopLevel ? SymbolKind.Function : SymbolKind.Method,
      range: this.getRange(node),
      ownerName: parent ? parent.name : undefined,
      parent: parent ? parent.name : undefined,
      metadata: { rubySpecific: true, visibility: "public" },
    })
  }

  private handleSingletonMethod(
    node: Node,
    symbols: UniversalSymbol[],
    parent: UniversalSymbol | null,
  ): void {
    const nameNode = node.childForFieldName("name")
    const objectNode = node.childForFieldName("object")
    if (!nameNode) return

    const fullName = objectNode ? `${objectNode.text}.${nameNode.text}` : `self.${nameNode.text}`

    symbols.push({
      name: fullName,
      kind: SymbolKind.Method,
      range: this.getRange(node),
      ownerName: parent ? parent.name : undefined,
      parent: parent ? parent.name : undefined,
      metadata: { rubySpecific: true, isSingleton: true },
    })
  }

  private handleAssignment(
    node: Node,
    symbols: UniversalSymbol[],
    parent: UniversalSymbol | null,
  ): void {
    const left = node.childForFieldName("left")
    if (!left) return

    const leftType = left.type
    if (
      leftType === "constant" ||
      leftType === "global_variable" ||
      leftType === "instance_variable" ||
      leftType === "class_variable"
    ) {
      symbols.push({
        name: left.text,
        kind: SymbolKind.Variable,
        range: this.getRange(node),
        ownerName: parent ? parent.name : undefined,
        parent: parent ? parent.name : undefined,
        metadata: { rubySpecific: true, variableType: leftType },
      })
    }
  }

  private findArgumentList(node: Node): Node | null {
    const argsField = node.childForFieldName("arguments")
    if (argsField) return argsField
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && child.type === "argument_list") return child
    }
    return null
  }

  private handleCall(
    node: Node,
    imports: ImportInfo[],
    relationships: UniversalRelationship[],
    frameworksObj: Record<string, boolean>,
    patternsObj: Record<string, boolean>,
    parent: UniversalSymbol | null,
    symbols: UniversalSymbol[],
  ): void {
    const methodNode = node.childForFieldName("method")
    let methodName = ""
    let receiver = ""

    if (!methodNode) {
      const potentialMethod = this.getFirstNamedChild(node)
      if (potentialMethod && potentialMethod.type === "identifier") {
        methodName = potentialMethod.text
      }
    } else {
      methodName = methodNode.text
      // Extract receiver: look at siblings before the method node
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.id === methodNode.id) break
        if (child && (child.type === "identifier" || child.type === "constant" || child.type === "scope_resolution") && child.text !== methodName) {
          receiver = child.text
        }
      }
    }

    if (!methodName) return

    const qualifiedName = receiver ? `${receiver}.${methodName}` : methodName

    // Track normal function calls for Code Gravity
    if (
      methodName !== "require" &&
      methodName !== "require_relative" &&
      methodName !== "load" &&
      methodName !== "has_many" &&
      methodName !== "belongs_to" &&
      methodName !== "has_one" &&
      methodName !== "include" &&
      methodName !== "extend"
    ) {
      relationships.push({
        source: parent ? parent.name : "Global",
        target: methodName,
        fromSymbol: parent ? parent.name : "Global",
        toSymbol: qualifiedName,
        type: RelationshipType.Calls,
        metadata: { rubySpecific: true, qualified: qualifiedName },
      })

      // Ruby instantiation: ClassName.new → Instantiates
      if (methodName === "new" && receiver) {
        relationships.push({
          source: parent ? parent.name : "Global",
          target: receiver,
          fromSymbol: parent ? parent.name : "Global",
          toSymbol: receiver,
          type: RelationshipType.Instantiates,
          confidence: 0.9,
          metadata: { rubySpecific: true, qualified: receiver, isNew: true },
        })
      }
    }

    if (methodName === "require" || methodName === "require_relative" || methodName === "load") {
      const args = this.findArgumentList(node)
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && arg.type === "string") {
            let text = arg.text
            let cleanText = ""
            for (let j = 0; j < text.length; j++) {
              if (text[j] !== "'" && text[j] !== '"') {
                cleanText += text[j]
              }
            }
            imports.push({
              module: cleanText,
              names: [],
              range: this.getRange(node),
              isWildcard: true,
              metadata: { requireMethod: methodName },
            })
          }
        }
      }
    } else if (
      methodName === "has_many" ||
      methodName === "belongs_to" ||
      methodName === "has_one" ||
      methodName === "has_and_belongs_to_many"
    ) {
      const args = this.findArgumentList(node)
      if (args) {
        let firstNamedArg: Node | null = null
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && arg.isNamed) {
            firstNamedArg = arg
            break
          }
        }
        if (
          firstNamedArg &&
          (firstNamedArg.type === "symbol" ||
            firstNamedArg.type === "string" ||
            firstNamedArg.type === "identifier" ||
            firstNamedArg.type === "simple_symbol")
        ) {
          let text = firstNamedArg.text
          if (text.charCodeAt(0) === 58) {
            text = text.substring(1)
          }
          const range = this.getRange(node)
          symbols.push({
            name: text,
            kind: SymbolKind.Property,
            range: {
              startLine: range.startLine,
              endLine: range.endLine,
              startIndex: range.startIndex,
              startColumn: range.startColumn, endColumn: range.endColumn,
              endIndex: range.endIndex,
            },
            visibility: "public",
            metadata: { associationType: methodName, sourceModel: parent?.name },
          })
          relationships.push({
            source: parent ? parent.name : "unknown",
            target: text,
            type: RelationshipType.Uses,
            metadata: { relationshipType: `activerecord_${methodName}` },
          })
        }
      }
    } else if (methodName === "scope" || methodName === "default_scope") {
      const args = this.findArgumentList(node)
      if (args && args.childCount > 0) {
        const firstArg = args.child(0)
        let scopeName = ""
        if (
          firstArg &&
          (firstArg.type === "symbol" || firstArg.type === "string" || firstArg.type === "simple_symbol")
        ) {
          scopeName = firstArg.text
          if (scopeName.charCodeAt(0) === 58) {
            scopeName = scopeName.substring(1)
          }
          const range = this.getRange(node)
          symbols.push({
            name: scopeName,
            kind: SymbolKind.Function,
            range: {
              startLine: range.startLine,
              endLine: range.endLine,
              startIndex: range.startIndex,
              startColumn: range.startColumn, endColumn: range.endColumn,
              endIndex: range.endIndex,
            },
            visibility: "public",
            metadata: { scopeType: methodName, sourceModel: parent?.name },
          })
          relationships.push({
            source: parent ? parent.name : "unknown",
            target: scopeName,
            type: RelationshipType.Uses,
            metadata: { relationshipType: `activerecord_${methodName}` },
          })
        }
      }
    } else if (methodName === "validates" || methodName === "validate") {
      const args = this.findArgumentList(node)
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (
            arg &&
            (arg.type === "symbol" ||
              arg.type === "string" ||
              arg.type === "identifier" ||
              arg.type === "simple_symbol")
          ) {
            let fieldName = arg.text
            if (fieldName.charCodeAt(0) === 58) {
              fieldName = fieldName.substring(1)
            }
            const range = this.getRange(node)
            symbols.push({
              name: fieldName,
              kind: SymbolKind.Variable,
              range: {
                startLine: range.startLine,
                endLine: range.endLine,
                startIndex: range.startIndex,
              startColumn: range.startColumn, endColumn: range.endColumn,
                endIndex: range.endIndex,
              },
              visibility: "public",
              metadata: { validationType: methodName, sourceModel: parent?.name },
            })
            relationships.push({
              source: parent ? parent.name : "unknown",
              target: fieldName,
              type: RelationshipType.Uses,
              metadata: { relationshipType: methodName, validation: true },
            })
          }
        }
      }
    } else if (methodName === "event" || methodName === "transition") {
      const args = this.findArgumentList(node)
      if (args && args.childCount > 0) {
        const firstArg = args.child(0)
        if (
          firstArg &&
          (firstArg.type === "symbol" || firstArg.type === "identifier" || firstArg.type === "simple_symbol")
        ) {
          let eventName = firstArg.text
          if (eventName.charCodeAt(0) === 58) {
            eventName = eventName.substring(1)
          }
          const range = this.getRange(node)
          symbols.push({
            name: eventName,
            kind: SymbolKind.Variable,
            range: {
              startLine: range.startLine,
              endLine: range.endLine,
              startIndex: range.startIndex,
              startColumn: range.startColumn, endColumn: range.endColumn,
              endIndex: range.endIndex,
            },
            visibility: "public",
            metadata: { stateMachineType: methodName, sourceModel: parent?.name },
          })
          relationships.push({
            source: parent ? parent.name : "unknown",
            target: eventName,
            type: RelationshipType.Uses,
            metadata: { relationshipType: `aasm_${methodName}` },
          })
        }
      }
    } else if (methodName === "include" || methodName === "extend" || methodName === "prepend") {
      const relType = methodName === "extend" ? RelationshipType.Uses
        : RelationshipType.Implements
      const args = this.findArgumentList(node)
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "constant" || arg.type === "identifier" || arg.type === "scope_resolution")) {
            relationships.push({
              source: parent ? parent.name : "unknown",
              target: arg.text,
              type: relType,
              metadata: { rubySpecific: true, mixinType: methodName },
            })
          }
        }
      }
    } else if (methodName === "define_method") {
      const args = this.findArgumentList(node)
      if (args && args.childCount > 0) {
        let argName = ""
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "symbol" || arg.type === "simple_symbol" || arg.type === "string")) {
            argName = arg.text
            if (argName.charCodeAt(0) === 58) argName = argName.substring(1)
            if ((argName.startsWith('"') || argName.startsWith("'")) && argName.length >= 2)
              argName = argName.substring(1, argName.length - 1)
            break
          }
        }
        if (argName) {
          symbols.push({
            name: argName,
            kind: SymbolKind.Method,
            range: this.getRange(node),
            ownerName: parent ? parent.name : undefined,
            metadata: { rubySpecific: true, isDynamicMethod: true },
          })
        }
      }
    } else if (methodName === "alias_method") {
      const args = this.findArgumentList(node)
      if (args && args.childCount >= 2) {
        const names: string[] = []
        for (let i = 0; i < args.childCount && names.length < 2; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "symbol" || arg.type === "simple_symbol")) {
            let name = arg.text
            if (name.charCodeAt(0) === 58) name = name.substring(1)
            names.push(name)
          }
        }
        if (names.length === 2) {
          relationships.push({
            source: parent ? parent.name : "unknown",
            target: names[0],
            type: RelationshipType.Calls,
            metadata: { rubySpecific: true, aliasedTo: names[1] },
          })
        }
      }
    } else if (methodName === "module_function") {
      patternsObj["Module Functions"] = true
    } else if (methodName === "method_missing" || methodName === "const_missing") {
      patternsObj["Metaprogramming"] = true
    } else if (methodName === "respond_to" || methodName === "respond_to_missing") {
      patternsObj["Dynamic Dispatch"] = true
    } else if (methodName === "attr_accessor" || methodName === "attr_reader" || methodName === "attr_writer") {
      const args = this.findArgumentList(node)
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "symbol" || arg.type === "simple_symbol" || arg.type === "identifier")) {
            let propName = arg.text
            if (propName.charCodeAt(0) === 58) propName = propName.substring(1)
            symbols.push({
              name: propName,
              kind: SymbolKind.Property,
              range: this.getRange(node),
              ownerName: parent ? parent.name : undefined,
              metadata: { rubySpecific: true, accessorType: methodName },
            })
          }
        }
      }
    } else if (methodName === "delegate") {
      const args = this.findArgumentList(node)
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && (arg.type === "symbol" || arg.type === "simple_symbol")) {
            let propName = arg.text
            if (propName.charCodeAt(0) === 58) propName = propName.substring(1)
            symbols.push({
              name: propName,
              kind: SymbolKind.Property,
              range: this.getRange(node),
              ownerName: parent ? parent.name : undefined,
              metadata: { rubySpecific: true, delegated: true },
            })
          }
        }
      }
    }
  }

  // Handle method calls without parentheses: `puts "hello"`, `redirect_to path`
  private handleCommand(
    node: Node,
    _imports: ImportInfo[],
    relationships: UniversalRelationship[],
    frameworksObj: Record<string, boolean>,
    patternsObj: Record<string, boolean>,
    parent: UniversalSymbol | null,
    _symbols: UniversalSymbol[],
  ): void {
    // Find the method name — first named identifier child
    let methodName = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "identifier") {
        methodName = child.text
        break
      }
    }
    if (!methodName) return

    // Skip Ruby builtins
    if (["puts", "print", "p", "pp", "raise", "fail", "exit", "abort", "warn"].includes(methodName)) return

    // Framework detection
    if (methodName === "redirect_to" || methodName === "render") frameworksObj["Rails"] = true
    if (methodName === "before_action" || methodName === "after_action") patternsObj["Callbacks"] = true
    if (methodName === "validates" || methodName === "validate") patternsObj["Validations"] = true

    relationships.push({
      source: parent ? parent.name : "Global",
      target: methodName,
      fromSymbol: parent ? parent.name : "Global",
      toSymbol: methodName,
      type: RelationshipType.Calls,
      metadata: { rubySpecific: true, commandStyle: true },
    })
  }

  // Handle chained commands: `foo.bar arg1, arg2`
  private handleCommandCall(
    node: Node,
    imports: ImportInfo[],
    relationships: UniversalRelationship[],
    frameworksObj: Record<string, boolean>,
    patternsObj: Record<string, boolean>,
    parent: UniversalSymbol | null,
    symbols: UniversalSymbol[],
  ): void {
    // Find method name — last identifier before arguments
    let methodName = ""
    let receiver = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "identifier") {
        if (!receiver && !methodName) {
          receiver = child.text
        } else if (receiver && !methodName) {
          methodName = child.text
        } else if (methodName) {
          // Already found both, use this as method (chained)
          receiver = methodName
          methodName = child.text
        }
      }
    }
    if (!methodName) return

    const qualifiedName = receiver ? `${receiver}.${methodName}` : methodName

    relationships.push({
      source: parent ? parent.name : "Global",
      target: methodName,
      fromSymbol: parent ? parent.name : "Global",
      toSymbol: qualifiedName,
      type: RelationshipType.Calls,
      metadata: { rubySpecific: true, commandStyle: true, qualified: qualifiedName },
    })
  }

  private getFirstNamedChild(node: Node): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && child.isNamed) return child
    }
    return null
  }

  private detectFrameworks(
    imports: ImportInfo[],
    symbols: UniversalSymbol[],
    frameworksObj: Record<string, boolean>,
    patternsObj: Record<string, boolean>,
  ) {
    for (let i = 0; i < imports.length; i++) {
      const mod = imports[i].module
      if (mod === "rails" || mod === "rails/all") {
        frameworksObj["Ruby on Rails"] = true
      } else if (mod === "sinatra" || mod === "sinatra/base") {
        frameworksObj["Sinatra"] = true
        patternsObj["Sinatra"] = true
      }
    }

    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if (sym.metadata?.isRailsModel || sym.metadata?.isRailsController) {
        frameworksObj["Ruby on Rails"] = true
      }
    }
  }

  private getRange(node: Node): {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
    startIndex: number
    endIndex: number
  } {
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
