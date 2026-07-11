// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"
interface DartContext {
  currentFile: string
  content: string
  libraryName: string
}
interface Scope {
  node: Node
  name: string
  kind: SymbolKind
  isStatic: boolean
}

export class RealDartAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const ctx: DartContext = { currentFile: filePath, content, libraryName: "" }
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []
    const patterns: Record<string, boolean> = {}
    const frameworks: Record<string, boolean> = {}
    let cyclomaticComplexity = 1
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean }[] = [{ node: rootNode }]

    const complexityNodes: Record<string, boolean> = {
      if_statement: true,
      for_statement: true,
      while_statement: true,
      do_statement: true,
      switch_statement: true,
      catch_clause: true,
      conditional_expression: true,
      logical_and_expression: true,
      logical_or_expression: true,
    }

    while (stack.length > 0) {
      const { node, isExit } = stack.pop()!
      if (isExit) {
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) scopeStack.pop()
        continue
      }
      if (node.hasError || node.isMissing) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({ message: `Syntax ${node.type} detected.`, range: this.nodeToRange(node), severity: "warning" })
        }
      }
      const type = node.type
      let pushedScope = false
      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

      if (complexityNodes[type]) cyclomaticComplexity++

      switch (type) {
        case "class_definition":
          pushedScope = this.processClass(node, symbols, relationships, currentScope, patterns, frameworks)
          break
        case "mixin_declaration":
          pushedScope = this.processMixin(node, symbols, currentScope, patterns)
          break
        case "extension_declaration":
          pushedScope = this.processExtension(node, symbols, currentScope, patterns)
          break
        case "enum_declaration":
          pushedScope = this.processEnum(node, symbols, currentScope)
          break
        case "function_declaration":
        case "method_declaration":
        case "getter_declaration":
        case "setter_declaration":
          pushedScope = this.processFunctionOrMethod(node, symbols, currentScope, patterns)
          break
        case "function_signature":
        case "method_signature":
        case "getter_signature":
        case "setter_signature":
          if (!node.parent || (node.parent.type.indexOf("declaration") === -1 && node.parent.type !== "declaration")) {
            this.processFunctionOrMethod(node, symbols, currentScope, patterns)
          }
          break
        case "constructor_signature":
        case "factory_constructor_signature":
        case "constructor_declaration":
        case "factory_constructor_declaration":
          if (type.indexOf("declaration") !== -1)
            pushedScope = this.processConstructor(node, symbols, relationships, currentScope, patterns)
          else if (!node.parent || node.parent.type.indexOf("declaration") === -1)
            this.processConstructor(node, symbols, relationships, currentScope, patterns)
          break
        case "declaration":
          let hasSignature = false
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && c.type.indexOf("signature") !== -1) {
              hasSignature = true
              break
            }
          }
          if (hasSignature) {
            pushedScope = this.processFunctionOrMethod(node, symbols, currentScope, patterns)
          } else {
            this.processFieldOrVariable(node, symbols, currentScope, patterns)
          }
          break
        case "initialized_identifier_list":
        case "initialized_variable_declaration":
          if (node.parent?.type === "program" || node.parent?.type === "static_final_declaration_list")
            this.processFieldOrVariable(node, symbols, currentScope, patterns)
          break
        case "import_specification":
        case "library_export":
          this.processImportExport(node, imports, exports, frameworks, relationships)
          break
        case "import_or_export":
        case "library_import":
        case "import_directive":
        case "export_directive":
          // Wrapper nodes — skip, the leaf nodes above handle the actual URI
          break
        case "part_directive":
          this.processPart(node, imports, patterns)
          break
        case "type_identifier":
        case "identifier":
        case "simple_identifier":
          this.processMethodChannelIdentifier(node, relationships, currentScope)
          // General variable reference tracking
          if (currentScope && node.text && !node.text.startsWith("_") &&
              node.parent?.type !== "function_signature" && node.parent?.type !== "method_signature" &&
              node.parent?.type !== "class_definition" && node.parent?.type !== "superclass" &&
              node.parent?.type !== "interfaces" && node.parent?.type !== "mixins" &&
              node.parent?.type !== "variable_declaration" && node.parent?.type !== "initialized_variable_declaration") {
            relationships.push({
              source: currentScope.name,
              target: node.text,
              type: RelationshipType.References,
              confidence: 0.6,
              metadata: { isVariableRef: true, dartSpecific: true }
            })
          }
          break
        case "creation_expression":
        case "invocation_expression":
          this.processInvocation(node, relationships, currentScope, patterns)
          break
        case "cascade_expression":
        case "cascade_section":
          this.processCascade(node, relationships, currentScope, patterns)
          break
        case "type_arguments":
          this.processSelector(node, relationships, currentScope, patterns)
          break
      }

      if (pushedScope && symbols.length > 0) {
        const lastSymbol = symbols[symbols.length - 1]
        scopeStack.push({ node, name: lastSymbol.name, kind: lastSymbol.kind, isStatic: lastSymbol.isStatic || false })
        stack.push({ node, isExit: true })
      }
      if (type === "null_assert_expression" || type === "conditional_property_access" || type === "if_null_expression")
        patterns["Null Safety"] = true
      if (type === "type_identifier" && (node.text === "List" || node.text === "Map" || node.text === "Set")) {
        if (node.nextNamedSibling && node.nextNamedSibling.type === "type_arguments") {
          patterns["Typed Collections"] = true
          patterns["Generics"] = true
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    const frameworkArray: string[] = []
    for (const f in frameworks) frameworkArray.push(f)

    // --- DART CALL GRAPH EXTRACTION (rewritten for correctness) ---
    // Walks the full AST and extracts caller→callee relationships.
    // Uses tree-sitter Dart node types: argument_part indicates a call site,
    // selector chains (e.g. obj.method) resolve to the last identifier.
    try {
      // Track which function/method scope we're currently inside
      let currentFunction: string | null = null

      const extractCalls = (n: Node): void => {
        const t = n.type

        // Update current function scope when entering/leaving declarations
        if (t === "function_declaration" || t === "method_declaration" || t === "getter_declaration" ||
            t === "setter_declaration" || t === "constructor_declaration" || t === "factory_constructor_declaration" ||
            t === "declaration" ||
            t === "function_signature" || t === "method_signature" || t === "getter_signature" ||
            t === "setter_signature" || t === "constructor_signature" || t === "factory_constructor_signature") {
          const prev = currentFunction
          const sigNode = this.findChild(n, (c) => c?.type.indexOf("signature") !== -1) || n
          const nameNode = sigNode.childForFieldName("name") || this.findChild(sigNode, (c) => c?.type === "identifier")
          if (nameNode) currentFunction = nameNode.text
          for (let i = 0; i < n.childCount; i++) extractCalls(n.child(i)!)

          // Walk sibling function_body (for signature and declaration nodes where
          // the body is not a child but a following sibling in the tree)
          let sib: Node | null = n.nextSibling
          while (sib) {
            if (sib.type === "function_body" || sib.type === "block") {
              for (let i = 0; i < sib.childCount; i++) extractCalls(sib.child(i)!)
              break
            }
            if (sib.type.indexOf("declaration") !== -1 || sib.type.indexOf("signature") !== -1 ||
                sib.type === "}" || sib.type === "class_body") break
            sib = sib.nextSibling
          }

          currentFunction = prev
          return
        }

        // Handle selector chains: obj.method() or just method()
        // In Dart tree-sitter, function calls are selector + argument_part, not invocation_expression.
        if (t === "selector") {
          const hasCall = this.findChild(n, (c) => c?.type === "argument_part")
          if (hasCall && currentFunction) {
            let callee = ""
            const prevSib = n.previousNamedSibling
            if (prevSib && (prevSib.type === "identifier" || prevSib.type === "type_identifier")) {
              callee = prevSib.text
            } else {
              const idNode = this.findChild(n, (c) => c?.type === "identifier" || c?.type === "type_identifier")
              if (idNode) callee = idNode.text
              else callee = n.text.split("(")[0]?.replace(/[^a-zA-Z0-9_]/g, "") || ""
            }
            if (callee && callee !== "print" && callee !== "super" && callee !== "this" &&
                callee !== "true" && callee !== "false" && callee !== "null" && callee.length > 0) {
              const alreadyAdded = relationships.some(
                (r) => r.source === currentFunction && r.target === callee && r.type === RelationshipType.Calls
              )
              if (!alreadyAdded) {
                relationships.push({
                  source: currentFunction,
                  target: callee,
                  type: RelationshipType.Calls,
                  confidence: 0.9,
                  metadata: { line: n.startPosition.row },
                })
              }
            }
          }
        }

        // Handle invocation_expression: function calls like emit(), print(), context.read()
        if (t === "invocation_expression") {
          const fnNode = n.childForFieldName("function") ||
            this.findChild(n, (c) => c?.type === "identifier" || c?.type === "type_identifier")
          if (fnNode && currentFunction) {
            const callee = fnNode.text
            if (callee && callee !== "print" && callee !== "super" && callee !== "this" &&
                callee !== "true" && callee !== "false" && callee !== "null") {
              relationships.push({
                source: currentFunction,
                target: callee,
                type: RelationshipType.Calls,
                confidence: 0.9,
                metadata: { line: n.startPosition.row },
              })
            }
          }
        }

        // Handle creation_expression: constructor calls like MyWidget(), PaymentState()
        if (t === "creation_expression") {
          const typeNode = n.childForFieldName("type") ||
            this.findChild(n, (c) => c?.type === "type_identifier" || c?.type === "identifier")
          if (typeNode && currentFunction) {
            relationships.push({
              source: currentFunction,
              target: typeNode.text,
              type: RelationshipType.Instantiates,
              confidence: 0.9,
              metadata: { line: n.startPosition.row },
            })
          }
        }

        // Find calls: any named child followed by argument_part as next named sibling
        for (let i = 0; i < n.namedChildCount - 1; i++) {
          const child = n.namedChild(i)
          const next = n.namedChild(i + 1)
          if (!child || !next) continue
          if (next.type !== "argument_part") continue

          let callee = ""
          const ct = child.type

          if (ct === "identifier" || ct === "type_identifier") {
            callee = child.text
          } else if (ct === "selector") {
            const inner = this.findChild(child, (c) =>
              c?.type === "_assignable_selector" || c?.type === "identifier")
            callee = inner?.text || child.text.replace(/^[.?]/, "")
          }

          if (!callee || callee === "print" || callee === "super" || callee === "this" ||
              callee === "true" || callee === "false" || callee === "null" ||
              callee.length === 0) continue

          if (currentFunction) {
            // Skip if already added by invocation_expression handling above
            const alreadyAdded = relationships.some(
              (r) => r.source === currentFunction && r.target === callee && r.type === RelationshipType.Calls
            )
            if (!alreadyAdded) {
              relationships.push({
                source: currentFunction,
                target: callee,
                type: RelationshipType.Calls,
                confidence: 0.9,
                metadata: { line: n.startPosition.row },
              })
            }
          }
        }

        // Walk into child nodes
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) extractCalls(child)
        }
      }

      // Always extract call graph (no sparse threshold)
      extractCalls(rootNode)
    } catch (e) {
      // Graceful degradation — call graph extraction should never crash the analyzer
    }
    // --- END DART CALL GRAPH EXTRACTION ---

    // --- END DART CALL GRAPH EXTRACTION ---

    const patternsArray: string[] = []
    for (const p in patterns) patternsArray.push(p)

    const frameworkPatterns: {
      framework: string
      patterns: { type: string; detected: boolean; description: string }[]
    }[] = []
    for (let i = 0; i < frameworkArray.length; i++) {
      frameworkPatterns.push({
        framework: frameworkArray[i],
        patterns: [{ type: "usage", detected: true, description: `${frameworkArray[i]} usage detected` }],
      })
    }

    for (const s of symbols) { const tl = !s.ownerName && !s.ownerKind; const pub = s.visibility !== "private" && !s.name.startsWith("_"); const exp = [SymbolKind.Class, SymbolKind.Enum, SymbolKind.Function, SymbolKind.Method, SymbolKind.Variable, SymbolKind.Constructor].includes(s.kind); if (tl && pub && exp) { exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" }) } }

    // Post-loop: add contains for owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
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
      language: "dart",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworkArray[0],
        patterns: patternsArray,
        detectedFrameworks: frameworkArray,
        frameworkPatterns,
        architecturalScore: Math.min(100, Math.max(0, 100 - errors.length * 5)),
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "6.0.1-dart-dfs-strict",
      },
    }
  }

  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private findDescendant(node: Node, predicate: (child: Node) => boolean): Node | null {
    if (predicate(node)) return node
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      const found = this.findDescendant(child, predicate)
      if (found) return found
    }
    return null
  }

  private filterChildren(node: Node, predicate: (child: Node) => boolean): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) res.push(child)
    }
    return res
  }

  private processClass(
    node: Node,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
    frameworks: Record<string, boolean>,
  ): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const className = nameNode?.text
    let superclassText: string | undefined = undefined
    let isStatefulWidget = false,
      isStatelessWidget = false,
      isWidget = false

    const superclassNode = node.childForFieldName("superclass")
    if (superclassNode) {
      const typeId = this.findChild(superclassNode, (c) => c?.type === "type_identifier" || c?.type === "identifier")
      if (typeId) {
        superclassText = typeId.text
        relationships.push({
          source: className,
          target: superclassText,
          type: RelationshipType.Extends,
          metadata: {},
        })
        if (superclassText.indexOf("Widget") !== -1) isWidget = true
        if (superclassText === "StatefulWidget") isStatefulWidget = true
        if (superclassText === "StatelessWidget") isStatelessWidget = true
        if (superclassText.indexOf("Bloc") !== -1 || superclassText.indexOf("Cubit") !== -1) patterns["BLoC"] = true
        if (superclassText.indexOf("Notifier") !== -1) patterns["Provider/Riverpod"] = true
      }
    }

    const interfacesNode = node.childForFieldName("interfaces")
    if (interfacesNode) {
      for (let i = 0; i < interfacesNode.namedChildCount; i++) {
        const child = interfacesNode.namedChild(i)
        if (child?.type === "type_identifier" || child?.type === "identifier")
          relationships.push({
            source: className,
            target: child?.text,
            type: RelationshipType.Implements,
            metadata: {},
          })
      }
    }

    let mixins: Node | null | undefined =
      this.findChild(node, (c) => c?.type === "mixins") || node.childForFieldName("mixins")
    if (!mixins && superclassNode) mixins = this.findChild(superclassNode, (c) => c?.type === "mixins")
    if (mixins) {
      patterns["Mixins"] = true
      for (let i = 0; i < mixins.namedChildCount; i++) {
        const child = mixins.namedChild(i)
        if (child?.type === "type_identifier" || child?.type === "identifier")
          relationships.push({
            source: className,
            target: child?.text,
            type: RelationshipType.Uses,
            metadata: { isMixin: true },
          })
      }
    }

    const annotations = this.extractAnnotations(node)
    // Dart 3 class modifiers: sealed, final, base, interface, abstract, mixin
    // tree-sitter-dart (GitHub master) produces these as named children of class_definition
    let isAbstract = this.hasModifier(node, "abstract")
    let isSealed = false, isFinal = false, isBase = false, isInterface = false, isMixinClass = false
    if (!isAbstract) {
      for (let i = 0; i < Math.min(5, node.childCount); i++) {
        const child = node.child(i)
        if (!child) continue
        if (child.type === "abstract" || child.text === "abstract") isAbstract = true
        if (child.type === "sealed" || child.text === "sealed") isSealed = true
        if (child.type === "base" || child.text === "base") isBase = true
        if (child.type === "interface" || child.text === "interface") isInterface = true
        if (child.text === "final" || child.type === "final") isFinal = true
        if (child.type === "mixin" || child.text === "mixin") isMixinClass = true
      }
    }
    const typeParams = this.findChild(node, (c) => c?.type === "type_parameters")
    const typeParametersList: string[] = []
    if (typeParams) {
      patterns["Generics"] = true
      for (let i = 0; i < typeParams.namedChildCount; i++) {
        const child = typeParams.namedChild(i)
        if (child?.type === "type_parameter") typeParametersList.push(child?.text)
      }
    }

    if (isWidget) {
      frameworks["Flutter"] = true
      patterns["Widget Architecture"] = true
    }
    symbols.push({
      name: className,
      kind: SymbolKind.Class,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: className.startsWith("_") ? "private" : "public",
      decorators: annotations,
      isAbstract,
      metadata: {
        superclass: superclassText,
        isWidget,
        isStatefulWidget,
        isStatelessWidget,
        typeParameters: typeParametersList,
        dartSpecific: true,
        isAbstract,
        isSealed,
        isFinal,
        isBase,
        isInterface,
        isMixinClass,
        hasNamedConstructors: false,
      },
    })
    return true
  }

  private processMixin(
    node: Node,
    symbols: UniversalSymbol[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ): boolean {
    const nameNode = node.childForFieldName("name") || this.findChild(node, (c) => c?.type === "identifier")
    if (!nameNode) return false
    patterns["Mixins"] = true
    symbols.push({
      name: nameNode?.text,
      kind: SymbolKind.Class,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: nameNode?.text.startsWith("_") ? "private" : "public",
      metadata: { isMixin: true, dartSpecific: true },
    })
    return true
  }

  private processExtension(
    node: Node,
    symbols: UniversalSymbol[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ): boolean {
    const nameNode = node.childForFieldName("name") || this.findChild(node, (c) => c?.type === "identifier")
    if (!nameNode) return false
    let targetType: string | undefined
    const typeIdNodes = this.filterChildren(node, (c) => c?.type === "type_identifier" || c?.type === "builtin_type")
    if (typeIdNodes.length > 0) {
      let targetNode: Node | undefined
      for (let i = 0; i < typeIdNodes.length; i++) {
        if (typeIdNodes[i] && typeIdNodes[i] !== nameNode) {
          targetNode = typeIdNodes[i]
          break
        }
      }
      if (targetNode) targetType = targetNode.text
    }
    if (!targetType) {
      const onNode = this.findChild(
        node,
        (c) =>
          c &&
          c !== nameNode &&
          (c?.type === "type_identifier" || c?.type === "identifier" || c?.type === "builtin_type"),
      )
      if (onNode) targetType = onNode.text
    }
    patterns["Extensions"] = true
    symbols.push({
      name: nameNode?.text,
      kind: SymbolKind.Class,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: nameNode?.text.startsWith("_") ? "private" : "public",
      metadata: { isExtension: true, targetType, dartSpecific: true },
    })
    return true
  }

  private processMethodChannelIdentifier(
    node: Node,
    relationships: UniversalRelationship[],
    currentScope: Scope | undefined,
  ) {
    if (node.text === "MethodChannel" || node.text === "EventChannel" || node.text === "BasicMessageChannel") {
      let searchArea = node.parent
      if (searchArea) searchArea = searchArea.parent
      if (searchArea) searchArea = searchArea.parent
      if (searchArea) searchArea = searchArea.parent

      if (searchArea) {
        const stringLiteral = this.findDescendant(
          searchArea,
          (c) => c.type === "string_literal" && c.startIndex > node.startIndex && c.startIndex - node.endIndex < 50,
        )
        if (stringLiteral) {
          const channelName = stringLiteral.text.replace(/['"]/g, "")
          // Avoid pushing duplicates within the same scope
          const isDuplicate = relationships.some(
            (r) => r.target === channelName && r.metadata?.bridgeMechanism === node.text,
          )
          if (!isDuplicate) {
            relationships.push({
              source: currentScope?.name || "Global",
              target: channelName,
              type: RelationshipType.Uses,
              metadata: { isCrossLanguage: true, bridgeMechanism: node.text },
            })
          }
        }
      }
    }
  }

  private processEnum(node: Node, symbols: UniversalSymbol[], currentScope: Scope | undefined): boolean {
    const nameNode = node.childForFieldName("name") || this.findChild(node, (c) => c?.type === "identifier")
    if (!nameNode) return false
    let isEnhancedEnum = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "enum_body" && c?.text.indexOf(";") !== -1) {
        isEnhancedEnum = true
        break
      }
    }
    symbols.push({
      name: nameNode?.text,
      kind: SymbolKind.Enum,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: nameNode?.text.startsWith("_") ? "private" : "public",
      metadata: { dartSpecific: true, isEnhancedEnum },
    })
    return true
  }

  private processFunctionOrMethod(
    node: Node,
    symbols: UniversalSymbol[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ): boolean {
    const isDecl = node.type.indexOf("declaration") !== -1
    const sigNode = isDecl ? this.findChild(node, (c) => c?.type.indexOf("signature") !== -1) || node : node
    const nameNode =
      sigNode.childForFieldName("name") ||
      this.findChild(sigNode, (c) => c?.type === "identifier" || c?.type === "operator")
    if (!nameNode) return false

    const functionName = nameNode?.text
    const parameters = this.extractDartParameters(sigNode)
    const returnType = this.extractDartReturnType(sigNode)

    let annotations = this.extractAnnotations(node)
    if (!isDecl && node.parent && node.parent.type.indexOf("declaration") !== -1) {
      const parentAnnotations = this.extractAnnotations(node.parent)
      for (let i = 0; i < parentAnnotations.length; i++) annotations.push(parentAnnotations[i])
    }

    const isGetter = sigNode.type === "getter_signature" || node.type === "getter_declaration"
    const isSetter = sigNode.type === "setter_signature" || node.type === "setter_declaration"
    if (isGetter || isSetter) patterns["Getters and Setters"] = true

    let sibling = node.nextNamedSibling
    if (
      !sibling &&
      node.parent &&
      (node.parent.type.indexOf("declaration") !== -1 || node.parent.type.indexOf("signature") !== -1)
    )
      sibling = node.parent.nextNamedSibling
    let isAsync = false,
      isGenerator = false

    // Helper to safely check starts without allocating massive strings
    const checkModifiers = (n: Node) => {
      for (let i = 0; i < Math.min(3, n.childCount); i++) {
        const c = n.child(i)
        if (c?.text === "async" || c?.type === "async") isAsync = true
        if (c?.text === "sync*" || c?.text === "async*" || c?.type === "sync*" || c?.type === "async*")
          isGenerator = true
      }
    }

    if (sibling && sibling.type === "function_body") {
      checkModifiers(sibling)
    }
    if (!sibling) {
      const bodyNode = isDecl ? node.childForFieldName("body") : sigNode.childForFieldName("body")
      if (bodyNode) {
        checkModifiers(bodyNode)
      }
    }
    if (isAsync || returnType?.startsWith("Future")) patterns["Async Programming"] = true

    let hasNullSafety = false
    if (returnType && returnType.indexOf("?") !== -1) hasNullSafety = true
    for (let i = 0; i < parameters.length; i++) {
      if (parameters[i].type && parameters[i].type!.indexOf("?") !== -1) hasNullSafety = true
    }
    // Only check the actual signature nodes, not the body!
    const sigToCheck = isDecl ? this.findChild(node, (c) => c?.type.indexOf("signature") !== -1) || node : node
    if (sigToCheck.type.indexOf("signature") !== -1) {
      if (sigToCheck.text.indexOf("?") !== -1 || sigToCheck.text.indexOf("!") !== -1) hasNullSafety = true
    }
    if (hasNullSafety) patterns["Null Safety"] = true

    let isStatic = this.hasModifier(node, "static") || this.hasModifier(sigNode, "static")

    let isOverride = false
    for (let i = 0; i < annotations.length; i++) {
      if (annotations[i] === "@override") isOverride = true
    }

    const symbol: UniversalSymbol = {
      name: functionName,
      kind:
        isGetter || isSetter
          ? SymbolKind.Property
          : currentScope
            ? SymbolKind.Method
            : SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      visibility: functionName.startsWith("_") ? "private" : "public",
      parameters,
      returnType,
      decorators: annotations,
      ownerName: currentScope?.name,
      ownerKind: currentScope?.kind,
      isAsync,
      metadata: { isAsync, isGenerator, isStatic, isOverride, isGetter, isSetter, dartSpecific: true, hasNullSafety },
    }

    // FIX: When node is a signature or generic declaration, function_body
    // may be a SIBLING not a child. Extend range to include it.
    const isSigOrDecl = node.type === "declaration" || node.type.indexOf("signature") !== -1
    if (isSigOrDecl) {
      let sib: Node | null = node.nextSibling
      while (sib) {
        if (sib.type === "function_body" || sib.type === "block") {
          symbol.range.endLine = sib.endPosition.row + 1
          symbol.range.endColumn = sib.endPosition.column + 1
          symbol.range.endIndex = sib.endIndex
          break
        }
        if (sib.type.indexOf("declaration") !== -1 || sib.type.indexOf("signature") !== -1 ||
            sib.type === "}" || sib.type === "class_body") break
        sib = sib.nextSibling
      }
    }

    const relationships: any[] = []
    symbols.push(symbol)
    // Push overrides relationship
    if (isOverride && currentScope?.name) {
      relationships.push({
        source: `${currentScope.name}.${functionName}`,
        target: functionName,
        type: RelationshipType.Overrides,
        confidence: 0.9,
        metadata: { isOverride: true, dartSpecific: true }
      })
    }
    return isDecl
  }

  private processConstructor(
    node: Node,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ): boolean {
    if (!currentScope) return false
    const isDecl = node.type.indexOf("declaration") !== -1
    const sigNode = isDecl ? this.findChild(node, (c) => c?.type.indexOf("signature") !== -1) || node : node
    const isFactory = this.hasModifier(node, "factory") || sigNode.type === "factory_constructor_signature"
    if (isFactory) patterns["Factory"] = true

    let name = currentScope.name,
      isNamed = false
    const nameNode = sigNode.childForFieldName("name")
    if (nameNode) {
      name = `${currentScope.name}.${nameNode.text}`
      isNamed = true
    } else {
      const idNodes = this.filterChildren(sigNode, (c) => c?.type === "identifier")
      if (idNodes.length >= 2 && idNodes[0] && idNodes[0].text === currentScope.name && idNodes[1]) {
        name = `${currentScope.name}.${idNodes[1].text}`
        isNamed = true
      }
    }

    const parameters = this.extractDartParameters(sigNode)
    if (isNamed) {
      let classSymbol: UniversalSymbol | undefined
      for (let i = 0; i < symbols.length; i++) {
        if (symbols[i].name === currentScope.name && symbols[i].kind === SymbolKind.Class) {
          classSymbol = symbols[i]
          break
        }
      }
      if (classSymbol && classSymbol.metadata) classSymbol.metadata.hasNamedConstructors = true
    }
    const isConst = this.hasModifier(node, "const") || sigNode.type === "constant_constructor_signature"
    let annotations = this.extractAnnotations(node)
    if (!isDecl && node.parent && node.parent.type.indexOf("declaration") !== -1) {
      const parentAnnotations = this.extractAnnotations(node.parent)
      for (let i = 0; i < parentAnnotations.length; i++) annotations.push(parentAnnotations[i])
    }

    symbols.push({
      name,
      kind: SymbolKind.Constructor,
      range: this.nodeToRange(node),
      scope: currentScope.name,
      visibility: name.startsWith("_") ? "private" : "public",
      parameters,
      decorators: annotations,
      ownerName: currentScope.name,
      ownerKind: SymbolKind.Class,
      metadata: { isFactory, isConst, isNamed, dartSpecific: true },
    })

    if (isFactory) {
      const redirectNode = this.findChild(
        sigNode,
        (c) =>
          c?.type === "redirecting_factory_constructor_signature" || c?.type === "redirecting_constructor_invocation",
      )
      let targetName = ""
      if (redirectNode) {
        const typeId = this.findChild(redirectNode, (c) => c?.type === "type_identifier" || c?.type === "identifier")
        if (typeId) targetName = typeId.text
      } else {
        let equalsIdx = -1
        for (let i = 0; i < sigNode.childCount; i++) {
          if (sigNode.child(i)?.text === "=") {
            equalsIdx = i
            break
          }
        }
        if (equalsIdx !== -1 && sigNode.childCount > equalsIdx + 1) {
          let target: Node | undefined
          for (let i = equalsIdx + 1; i < sigNode.childCount; i++) {
            const c = sigNode.child(i)
            if (c?.type === "identifier" || c?.type === "type_identifier") {
              target = c
              break
            }
          }
          if (target) targetName = target.text
        }
      }
      if (targetName)
        relationships.push({
          source: currentScope.name,
          target: targetName,
          type: RelationshipType.Instantiates,
          metadata: { isFactoryRedirection: true },
        })
    }
    return isDecl
  }

  private processFieldOrVariable(
    node: Node,
    symbols: UniversalSymbol[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ) {
    let isStatic = this.hasModifier(node, "static"),
      isFinal = this.hasModifier(node, "final"),
      isLate = this.hasModifier(node, "late"),
      isConst = this.hasModifier(node, "const")
    if (node.type === "initialized_identifier_list" && node.parent) {
      if (node.parent.type === "static_final_declaration_list" || node.parent.text.indexOf("static") !== -1) {
        isStatic = true
        isFinal = true
      }
      if (this.hasModifier(node.parent, "static")) isStatic = true
      if (this.hasModifier(node.parent, "final")) isFinal = true
      if (this.hasModifier(node.parent, "late")) isLate = true
      if (this.hasModifier(node.parent, "const")) isConst = true
    }
    if (isLate) patterns["Late Initialization"] = true
    const declList =
      node.type === "initialized_identifier_list" ||
      node.type === "initialized_variable_declaration" ||
      node.type === "static_final_declaration_list"
        ? node
        : this.findChild(
            node,
            (c) =>
              c?.type === "initialized_identifier_list" ||
              c?.type === "initialized_variable_declaration" ||
              c?.type === "static_final_declaration_list",
          )
    if (!declList) return
    let typeNode = this.findChild(
      node,
      (c) => c?.type === "type_identifier" || c?.type === "builtin_type" || c?.type === "generic_type",
    )
    if (!typeNode && node.parent)
      typeNode = this.findChild(node.parent, (c) => c?.type === "type_identifier" || c?.type === "builtin_type")
    const typeString = typeNode?.text || "dynamic"

    for (let i = 0; i < declList.namedChildCount; i++) {
      const child = declList.namedChild(i)
      if (child?.type === "initialized_identifier" || child?.type === "static_final_declaration") {
        const nameNode = this.findChild(child, (c) => c?.type === "identifier")
        if (nameNode)
          symbols.push({
            name: nameNode?.text,
            kind:
              currentScope && currentScope.kind === SymbolKind.Class
                ? SymbolKind.Property
                : SymbolKind.Variable,
            range: this.nodeToRange(node),
            scope: currentScope?.name || "",
            visibility: nameNode.text.startsWith("_") ? "private" : "public",
            ownerName: currentScope?.name,
            ownerKind: currentScope?.kind,
            isStatic,
            metadata: { isStatic, isFinal, isLate, isConst, dataType: typeString, dartSpecific: true },
          })
      } else if (child?.type === "identifier") {
        symbols.push({
          name: child?.text,
          kind:
            currentScope && currentScope.kind === SymbolKind.Class
              ? SymbolKind.Property
              : SymbolKind.Variable,
          range: this.nodeToRange(node),
          scope: currentScope?.name || "",
          visibility: child?.text.startsWith("_") ? "private" : "public",
          ownerName: currentScope?.name,
          ownerKind: currentScope?.kind,
          isStatic,
          metadata: { isStatic, isFinal, isLate, isConst, dataType: typeString, dartSpecific: true },
        })
      }
    }
  }

  private processImportExport(
    node: Node,
    imports: ImportInfo[],
    exports: ExportInfo[],
    frameworks: Record<string, boolean>,
    relationships: UniversalRelationship[],
  ) {
    const isExport = node.text.startsWith("export")
    const uriNode = this.findDescendant(node, (c) => c?.type === "string_literal")
    if (uriNode) {
      const moduleUri = uriNode?.text.replace(/['"]/g, "")
      if (moduleUri.startsWith("package:flutter/")) frameworks["Flutter"] = true
      if (moduleUri.startsWith("package:angular/")) frameworks["AngularDart"] = true
      if (moduleUri.indexOf("bloc") !== -1) frameworks["BLoC"] = true
      if (isExport) exports.push({ name: moduleUri, isDefault: false, range: this.nodeToRange(node) })
      else
        imports.push({
          module: moduleUri,
          source: moduleUri,
          imported: ["*"],
          isTypeOnly: false,
          range: this.nodeToRange(node),
        })
      // depends: import = compile-time dependency
      relationships.push({
        source: "global",
        target: moduleUri,
        type: RelationshipType.References,
        confidence: 0.9,
        metadata: { isDartImport: true }
      })
    }
  }

  private processPart(node: Node, imports: ImportInfo[], patterns: Record<string, boolean>) {
    let uriNode = this.findDescendant(node, (c) => c?.type === "string_literal")
    if (uriNode) {
      imports.push({
        uri: uriNode.text.replace(/['"]/g, ""),
        isExport: false,
        isPart: true,
      })
      patterns["Code Generation (part)"] = true
      return
    }
  }

  private processSelector(
    node: Node,
    relationships: UniversalRelationship[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ) {
    if (!currentScope) return
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && (child.type === "type_identifier" || child.type === "identifier")) {
        if (child.text.includes("Bloc") || child.text.includes("Cubit")) patterns["BLoC"] = true
        relationships.push({
          source: currentScope.name,
          target: child.text,
          type: RelationshipType.Instantiates,
          metadata: { isWidgetTree: true },
        })
      }
    }
  }

  private processInvocation(
    node: Node,
    relationships: UniversalRelationship[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ) {
    let targetName = "",
      isWidgetTree = false
    if (node.type === "creation_expression") {
      const typeNode =
        node.childForFieldName("type") ||
        this.findChild(node, (c) => c?.type === "type_identifier" || c?.type === "identifier")
      if (typeNode) {
        targetName = typeNode.text
        // Only mark as widget tree if the created type is a known Flutter widget
        isWidgetTree = /Widget$|Element$|Builder$|Painter$|Delegate$/.test(targetName)
      }
    } else if (node.type === "invocation_expression") {
      const fnNode = node.childForFieldName("function") || this.findChild(node, (c) => c?.type === "identifier")
      if (fnNode) {
        targetName = fnNode.text
        // Only mark as widget tree for known widget-returning functions
        isWidgetTree = /^Material$|^Scaffold$|^Container$|^Column$|^Row$|^Text$|^Center$|^Padding$|^SizedBox$|^Expanded$/.test(targetName)
      }
    }

    if (targetName) {
      if (
        targetName === "BlocProvider" ||
        targetName === "ChangeNotifierProvider" ||
        targetName.indexOf("Provider") !== -1
      )
        patterns["Provider/Riverpod"] = true
      let sourceName = currentScope?.name || "Global"
      let p: Node | null = node.parent
      while (p && p !== currentScope?.node) {
        if (p.type === "creation_expression") {
          const pt =
            p.childForFieldName("type") ||
            this.findChild(p, (c) => c?.type === "type_identifier" || c?.type === "identifier")
          if (pt) {
            sourceName = pt.text
            break
          }
        } else if (p.type === "invocation_expression") {
          const pfn = p.childForFieldName("function") || this.findChild(p, (c) => c?.type === "identifier")
          if (pfn && /^[A-Z]/.test(pfn.text)) {
            sourceName = pfn.text
            break
          }
        }
        p = p.parent
      }
      relationships.push({
        source: sourceName,
        target: targetName,
        type: isWidgetTree ? RelationshipType.Instantiates : RelationshipType.Calls,
        metadata: isWidgetTree ? { isWidgetTree: true } : {},
      })
    }
  }

  private processCascade(
    node: Node,
    relationships: UniversalRelationship[],
    currentScope: Scope | undefined,
    patterns: Record<string, boolean>,
  ) {
    if (node.type === "cascade_expression") {
      const receiver = node.namedChildren[0]
      if (!receiver) return
      let receiverName = "UnknownReceiver"
      if (receiver.type === "identifier" || receiver.type === "simple_identifier") {
        receiverName = receiver.text
      } else if (receiver.type === "creation_expression") {
        const typeNode =
          receiver.childForFieldName("type") ||
          this.findChild(receiver, (c) => c?.type === "type_identifier" || c?.type === "identifier")
        if (typeNode) receiverName = typeNode.text
      }
      const sections = this.filterChildren(node, (c) => c?.type === "cascade_section")
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i]
        if (!section) continue
        const methodNode = this.findChild(
          section,
          (c) => c?.type === "identifier" || c?.type === "invocation_expression",
        )
        if (methodNode) {
          let methodName = methodNode.text
          if (methodNode.type === "invocation_expression") {
            const fn =
              methodNode.childForFieldName("function") || this.findChild(methodNode, (c) => c?.type === "identifier")
            if (fn) methodName = fn.text
          } else if (methodNode.type === "identifier") {
            const args = this.findChild(section, (c) => c?.type === "argument_part")
            if (args) methodName = methodNode.text
          }
          if (methodName && methodName !== receiverName)
            relationships.push({
              source: currentScope?.name || "Global",
              target: `${receiverName}.${methodName}`,
              type: RelationshipType.Calls,
              metadata: { cascade: true },
            })
        }
      }
    }
  }

  private extractDartParameters(node: Node): Parameter[] {
    const parameters: Parameter[] = []
    const paramsNode =
      node.childForFieldName("parameters") || this.findChild(node, (c) => c?.type === "formal_parameter_list")
    if (!paramsNode) return parameters
    const paramStack = [paramsNode]
    while (paramStack.length > 0) {
      const pNode = paramStack.pop()!
      if (
        pNode.type === "formal_parameter" ||
        pNode.type === "optional_formal_parameter" ||
        pNode.type === "named_formal_parameter" ||
        pNode.type === "default_formal_parameter" ||
        pNode.type === "constructor_param"
      ) {
        const nameNode = pNode.childForFieldName("name") || this.findChild(pNode, (c) => c?.type === "identifier")
        const typeNode = pNode.childForFieldName("type") || this.findChild(pNode, (c) => c?.type === "type_identifier")
        if (nameNode) {
          const isNamed =
            pNode.type === "named_formal_parameter" ||
            pNode.type === "default_formal_parameter" ||
            pNode.parent?.type === "named_formal_parameters" ||
            (pNode.parent?.type === "optional_formal_parameters" && pNode.parent?.text.indexOf("{") !== -1)
          const isOptional =
            pNode.type === "optional_formal_parameter" ||
            pNode.parent?.type === "optional_formal_parameters" ||
            pNode.text.indexOf("required") === -1

          let found = false
          for (let i = 0; i < parameters.length; i++) {
            if (parameters[i].name === nameNode?.text) {
              found = true
              break
            }
          }
          if (!found)
            parameters.push({ name: nameNode?.text, type: typeNode ? typeNode?.text : "dynamic", isOptional, isNamed })
        }
      }
      for (let i = pNode.namedChildCount - 1; i >= 0; i--) {
        const c = pNode.namedChild(i)
        if (c) paramStack.push(c)
      }
    }
    return parameters
  }

  private extractDartReturnType(node: Node): string | undefined {
    const typeNode =
      node.childForFieldName("return_type") ||
      this.findChild(node, (c) => c?.type === "type_identifier" || c?.type === "void_type")
    if (typeNode) return typeNode?.text
    return undefined
  }

  private extractAnnotations(node: Node): string[] {
    const annotations: string[] = []
    let prev: Node | null = node.previousNamedSibling
    while (prev && (prev.type === "annotation" || prev.type === "marker_annotation")) {
      annotations.push(prev.text)
      prev = prev.previousNamedSibling
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === "annotation" || child?.type === "marker_annotation") annotations.push(child?.text)
    }
    return annotations
  }

  private hasModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c?.type === "modifier" || c?.type === modifier || c?.text === modifier)) return true
    }
    return false
  }

  private nodeToRange(node: Node): UniversalSymbol["range"] {
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
