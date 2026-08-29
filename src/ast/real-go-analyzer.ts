// Utility functions to avoid array methods
function stringIncludes(str: string, val: string): boolean {
  if (!str) return false
  return str.indexOf(val) !== -1
}

function inArray(arr: any[], val: any): boolean {
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === val) return true
  }
  return false
}

function filterSymbols(symbols: any[], predicate: (s: any) => boolean): any[] {
  const result: any[] = []
  if (!symbols) return result
  for (let i = 0; i < symbols.length; i++) {
    if (predicate(symbols[i])) result.push(symbols[i])
  }
  return result
}

function mapSymbols<T, U>(arr: T[], mapper: (item: T) => U): U[] {
  const result: U[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    result.push(mapper(arr[i]))
  }
  return result
}

function someSymbol(arr: any[], predicate: (s: any) => boolean): boolean {
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return true
  }
  return false
}

function findSymbol(arr: any[], predicate: (s: any) => boolean): any | undefined {
  if (!arr) return undefined
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return arr[i]
  }
  return undefined
}

function forEachSymbol(arr: any[], fn: (s: any) => void): void {
  if (!arr) return
  for (let i = 0; i < arr.length; i++) {
    fn(arr[i])
  }
}

function getObjectKeysLength(obj: any): number {
  if (!obj) return 0
  let count = 0
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      count++
    }
  }
  return count
}

function getUniqueStrings(arr: string[]): string[] {
  const seen: Record<string, boolean> = {}
  const result: string[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) {
      seen[arr[i]] = true
      result.push(arr[i])
    }
  }
  return result
}

// Real Go Intelligence Engine
// AST analysis for Go language

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export interface GoContext {
  content: string
  filePath: string
}

export class RealGoAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: GoContext = { filePath, content }

    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    if (rootNode.hasError) {
      const stack = [rootNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: "Brain Engine (Go): Bypassed resilient parser error node",
            range: {
              startLine: n.startPosition.row + 1,
              startColumn: n.startPosition.column + 1,
              endLine: n.endPosition.row + 1,
              endColumn: n.endPosition.column + 1,
            },
            severity: `warning`,
          })
        }
        for (let i = n.childCount - 1; i >= 0; i--) {
          const child = n.child(i)
          if (child) stack.push(child)
        }
      }
    }

    // PHASE 0: Extract package declaration as a Module symbol
    const packageName = this.extractGoPackageName(rootNode)
    if (packageName) {
      symbols.push({
        name: packageName,
        kind: ASTEngine.SymbolKind.Module,
        range: {
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: packageName.length + 9,
          startIndex: 0,
          endIndex: packageName.length + 9,
        },
        visibility: "public",
        metadata: {
          nodeType: "package_clause",
          isGoPackage: true,
        },
      })
    }

    // PHASE 1: Extract Go symbols with proper understanding
    this.extractGoSymbols(rootNode, symbols, ctx)

    // PHASE 2: Analyze Go-specific relationships
    this.analyzeGoRelationships(rootNode, relationships, symbols, ctx)

    // PHASE 3: Process Go imports (with proper module path handling)
    this.processGoImports(rootNode, imports)

    // PHASE 3b: Add DependsOn relationships for imports
    for (const imp of imports) {
      relationships.push({
        source: packageName || filePath,
        target: imp.module || "",
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        // isImport:true makes the edge pinnable as the "imports" relationship
        // kind by completeness section B (family convention — c pins the
        // stdlib.h include edge the same way); isGoImportDep keeps the go-idiom
        // marker for the oracle.
        metadata: { isGoImportDep: true, isImport: true, packageName: imp.metadata?.packageName },
      })
    }

    // PHASE 4: Detect Go frameworks and patterns
    const frameworks = this.detectGoFrameworks(rootNode, imports)
    const patterns = this.detectGoPatterns(rootNode, symbols)

    // PHASE 5: Exports — all public (exported) non-variable symbols
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      const isPrivate = s.visibility === "private"
      const isVar = s.kind === ASTEngine.SymbolKind.Variable
      if (!isPrivate && !isVar) {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" })
      }
    }

    // PHASE 5.5: Declared-type reference graph (M14): struct fields, params,
    // receivers, return values, var declarations. Absent until M14 — the
    // corpus oracle never checked it. qualified_type keeps its dotted
    // pkg.Type form; builtins are excluded.
    this.extractDeclaredTypeRefs(rootNode, relationships)

    // PHASE 5.6: #419-D evidence-tier classification for EVERY emitted
    // relationship (family rules — rust/c/cpp/cpp all classify; go did NOT,
    // so the completeness D-tier gate could never pin >=2 tiers for go).
    this.classifyEvidenceTier(relationships)

    return {
      language: "go",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: this.calculateGoComplexity(symbols, relationships),
        linesOfCode: ctx.content.split("\n").length,
        cyclomaticComplexity: this.calculateCyclomaticComplexity(rootNode),
        framework: frameworks[0]?.name, // Primary framework
        patterns,

        // Go intelligence metadata
        detectedFrameworks: mapSymbols(frameworks, (f) => f.name),
        frameworkPatterns: this.getGoFrameworkPatterns(
          mapSymbols(frameworks, (f) => f.name),
          symbols,
        ),
        architecturalInsights: this.generateGoArchitecturalInsights(symbols, relationships),
        architecturalScore: this.calculateArchitecturalScore(symbols, relationships, patterns),
        codeQuality: this.assessCodeQuality(symbols, relationships, patterns),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.1-go-iterative-stateless",
      },
    }
  }

  /**
   * #419-D evidence-tier classification for EVERY emitted relationship
   * (family rules — mirrors rust/c/cpp so the go analyzer is not the one
   * sibling that leaves edges untagged, keeping completeness section D
   * achievable). Metadata tags already set by the emitter are left intact.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass =
          md.isGoImportDep || md.isImport ? "import_based"
          : md.relationshipType === "declared_type" || md.relationshipType === "return_type" ? "reference_qualified"
          : "usage_contextual"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * M14 — declared-type reference graph. Go type positions: struct fields,
   * parameter declarations (params, receivers, and the SECOND parameter_list
   * holding return values), var/const specs, and composite literal types.
   * qualified_type keeps its dotted pkg.Type form per the M14 dotted-name
   * convention; pointer/array/map/etc. wrappers descend; builtins excluded.
   */
  private extractDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()
    const BUILTINS = new Set(["int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "float32", "float64", "complex64", "complex128", "string", "bool", "byte", "rune", "error", "any"])

    const collectTypeNames = (n: Node, out: string[], qualified?: string): void => {
      if (n.type === "qualified_type") {
        // Full dotted pkg.Type per dotted-name convention.
        if (!out.includes(n.text) && !BUILTINS.has(n.text)) out.push(n.text)
        return
      }
      if (n.type === "type_identifier") {
        if (!BUILTINS.has(n.text) && !out.includes(n.text)) out.push(n.text)
        return
      }
      if (n.type === "block" || n.type === "expression_list") return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNames(c, out, qualified)
      }
    }

    const resolveSource = (start: Node): string => {
      let p: Node | null = start.type === "field_declaration" ? start : start.parent
      let sawTypeSpec = false
      while (p) {
        // Struct fields attribute to the enclosing named struct/interface.
        if (!sawTypeSpec && p.type === "type_spec") {
          for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i)
            if (c && c.type === "type_identifier") return c.text
          }
          sawTypeSpec = true
        }
        if (p.type === "function_declaration" || p.type === "method_declaration") {
          for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i)
            if (!c) continue
            if ((p.type === "method_declaration" && c.type === "field_identifier") || (p.type === "function_declaration" && c.type === "identifier")) return c.text
          }
        }
        p = p.parent
      }
      return "global"
    }

    const emit = (source: string, roots: (Node | null)[], relType: string): void => {
      for (const r of roots) {
        if (!r) continue
        const names: string[] = []
        collectTypeNames(r, names)
        for (const t of names) {
          const key = `${source}|${t}|${relType}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            metadata: { relationshipType: relType },
          })
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "field_declaration": {
          // Struct field: type is everything after the name identifier.
          emit(resolveSource(n), [n], "declared_type")
          break
        }
        case "parameter_declaration": {
          // Params, receivers AND anonymous return-value declarations.
          emit(resolveSource(n), [n], n.namedChildCount === 1 ? "return_type" : "declared_type")
          break
        }
        case "var_spec":
        case "const_spec": {
          emit(resolveSource(n), [n], "declared_type")
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  /**
   * PHASE 1: Extract Go symbols with proper Go semantics understanding
   */
  private extractGoSymbols(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: GoContext, parentStruct?: string) {
    // Package-scope declarations only. Function-local vars/consts/types are
    // NOT symbols (C# M12.07 LocalsAreNotSymbols / Swift M12.21 negative
    // contract) — the walk stops at function/method bodies.
    const stack: { node: Node; parent?: string; inFunction: boolean }[] = [{ node, parent: parentStruct, inFunction: false }]

    while (stack.length > 0) {
      const { node: current, parent, inFunction } = stack.pop()!

      switch (current.type) {
        case "function_declaration":
          this.extractGoFunction(current, symbols, parent)
          // Do NOT descend into the body: locals are not symbols.
          continue
        case "method_declaration":
          this.extractGoMethod(current, symbols)
          continue
        case "type_declaration":
          this.extractGoTypeDeclaration(current, symbols)
          break
        case "var_declaration":
        case "const_declaration":
          if (!inFunction) this.extractGoVariables(current, symbols, parent)
          break
        case "import_declaration":
          // Handled in processGoImports
          break
      }

      const nextInFunction = inFunction || current.type === "block"
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push({ node: child, parent, inFunction: nextInFunction })
      }
    }
  }

  /**
   * Extract Go function declarations
   */
  private extractGoFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], parentStruct?: string) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const functionName = nameNode.text

    // Extract parameters
    const parameters = this.extractGoParameters(node)

    // Extract return type(s)
    const returnType = this.extractGoReturnType(node)

    // Find function calls within this function
    const qualifiedCalls = this.findGoFunctionCalls(node)
    const bodyText = node.childForFieldName("body")?.text || ""

    const apiContractPath = this.extractGoApiContractPathFromComments(node)

    symbols.push({
      name: functionName,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      parameters,
      returnType,
      qualified_calls: qualifiedCalls,
      apiContractPath,
      // Per-symbol cyclomatic complexity (family contract — rust/c/cpp all
      // emit symbol.complexity; go was the only sibling that didn't, so the
      // completeness section-C payload pin was impossible. Added go wave
      // 2026-08-28, same counter as calculateCyclomaticComplexity).
      complexity: this.calculateCyclomaticComplexity(node),
      visibility: this.isGoExported(functionName) ? "public" : "private",
      ownerName: parentStruct,
      ownerKind: parentStruct ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        nodeType: node.type,
        isGoFunction: true,
        isExported: this.isGoExported(functionName),
        hasErrorHandling: this.hasGoErrorHandling(bodyText),
        isInit: functionName === "init",
        hasGenerics: !!findSymbol(node.children, (c) => c && c.type === "type_parameter_list"),
      },
    })
  }

  /**
   * Extract Go method declarations (methods with receivers)
   */
  private extractGoMethod(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const methodName = nameNode.text

    // Extract receiver information
    const receiver = this.extractGoReceiver(node)

    // Extract parameters (excluding receiver)
    const parameters = this.extractGoParameters(node)

    // Extract return type(s)
    const returnType = this.extractGoReturnType(node)

    // Find method calls within this method
    const qualifiedCalls = this.findGoFunctionCalls(node)
    const bodyText = node.childForFieldName("body")?.text || ""

    const apiContractPath = this.extractGoApiContractPathFromComments(node)

    symbols.push({
      name: methodName,
      kind: ASTEngine.SymbolKind.Method,
      range: this.nodeToRange(node),
      parameters,
      returnType,
      qualified_calls: qualifiedCalls,
      apiContractPath,
      // Per-symbol cyclomatic complexity (family contract, go wave 2026-08-28).
      complexity: this.calculateCyclomaticComplexity(node),
      visibility: this.isGoExported(methodName) ? "public" : "private",
      ownerName: receiver?.typeName,
      ownerKind: ASTEngine.SymbolKind.Struct,
      metadata: {
        nodeType: node.type,
        isGoMethod: true,
        receiver: receiver,
        receiverType: receiver?.typeName,
        receiverKind: receiver?.isPointer ? "pointer" : "value",
        isPointerReceiver: receiver?.isPointer || false,
        isExported: this.isGoExported(methodName),
        hasErrorHandling: this.hasGoErrorHandling(bodyText),
        hasGenerics: !!findSymbol(node.children, (c) => c && c.type === "type_parameter_list"),
      },
    })
  }

  /**
   * Extract Go type declarations (structs, interfaces, type aliases)
   */
  private extractGoTypeDeclaration(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    // Go type_declaration contains type_spec children
    for (let i = 0; i < node.namedChildCount; i++) {
      const typeSpec = node.namedChild(i)
      if (typeSpec?.type === "type_spec" || typeSpec?.type === "type_alias") {
        this.extractGoTypeSpec(typeSpec, symbols)
      }
    }
  }

  /**
   * Extract individual type specifications (struct, interface, etc.)
   */
  private extractGoTypeSpec(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const typeName = nameNode.text

    // Get the type definition (struct_type, interface_type, etc.)
    const typeNode = node.childForFieldName("type")
    if (!typeNode) return

    // Check for generics
    const typeParamsNode = findSymbol(node.children, (c) => c && c.type === "type_parameter_list")
    const hasGenerics = !!typeParamsNode

    let kind: ASTEngine.SymbolKind
    let isInterface = false

    switch (typeNode.type) {
      case "struct_type":
        // Systems family (Rust M12.18 / Swift M12.21): struct -> struct
        kind = ASTEngine.SymbolKind.Struct
        break
      case "interface_type":
        kind = ASTEngine.SymbolKind.Interface
        isInterface = true
        break
      default:
        kind = ASTEngine.SymbolKind.Type
    }

    symbols.push({
      name: typeName,
      kind,
      range: this.nodeToRange(node),
      visibility: this.isGoExported(typeName) ? "public" : "private",
      metadata: {
        nodeType: node.type,
        goType: typeNode.type,
        isInterface,
        isStruct: typeNode.type === "struct_type",
        isGoStruct: typeNode.type === "struct_type",
        isExported: this.isGoExported(typeName),
        isTypeAlias: node.type === "type_alias",
        hasGenerics,
      },
    })

    // Extract struct fields or interface methods
    if (typeNode.type === "struct_type") {
      this.extractStructFields(typeNode, symbols, typeName)
    } else if (typeNode.type === "interface_type") {
      this.extractInterfaceMethods(typeNode, symbols, typeName)
    }
  }

  /**
   * Extract struct fields
   */
  private extractStructFields(structNode: Node, symbols: ASTEngine.UniversalSymbol[], structName: string) {
    // Look for field_declaration_list
    for (let i = 0; i < structNode.namedChildCount; i++) {
      const child = structNode.namedChild(i)
      if (child?.type === "field_declaration_list") {
        // Process each field_declaration
        for (let j = 0; j < child.namedChildCount; j++) {
          const fieldDecl = child.namedChild(j)
          if (fieldDecl?.type === "field_declaration") {
            // Extract field name and type
            const fieldNameNode = fieldDecl.childForFieldName("name")
            const fieldTypeNode = fieldDecl.childForFieldName("type")
            // Extract struct tags like `json:"name"` — pure string scan over
            // the raw_string_literal content (backtick-delimited), no regex.
            const tagNode = fieldDecl.childForFieldName("tag")
            let structTags: Record<string, string> = {}
            if (tagNode) {
              const tagText = this.stripRawStringDelimiters(tagNode.text)
              structTags = this.parseStructTags(tagText)
            }

            if (fieldNameNode) {
              symbols.push({
                name: fieldNameNode.text,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(fieldDecl),
                returnType: fieldTypeNode?.text,
                visibility: this.isGoExported(fieldNameNode.text) ? "public" : "private",
                ownerName: structName,
                ownerKind: ASTEngine.SymbolKind.Struct,
                metadata: {
                  structTags: getObjectKeysLength(structTags) > 0 ? structTags : undefined,
                  nodeType: fieldDecl.type,
                  isStructField: true,
                  fieldType: fieldTypeNode?.text,
                  isExported: this.isGoExported(fieldNameNode.text),
                },
              })
            }
          }
        }
        break
      }
    }
  }

  /**
   * Extract interface methods
   */
  private extractInterfaceMethods(interfaceNode: Node, symbols: ASTEngine.UniversalSymbol[], interfaceName: string) {
    // Look for method signatures in interface
    for (let i = 0; i < interfaceNode.namedChildCount; i++) {
      const method = interfaceNode.namedChild(i)
      // method_spec is the ONLY interface-method node in the pinned
      // tree-sitter-go grammar (probe-verified 2026-08-28). 'method_elem'
      // was a dead literal from an older grammar — referencing it FAILED the
      // F1 grammar audit (unknown node type), so it is removed here.
      if (method?.type === "method_spec") {
        const methodName = method.childForFieldName("name")
        if (methodName) {
          const parameters = this.extractGoMethodSpecParameters(method)
          const returnType = this.extractGoMethodSpecReturnType(method)
          symbols.push({
            name: methodName.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(method),
            isAbstract: true, // Interface methods are abstract
            parameters,
            returnType,
            visibility: this.isGoExported(methodName.text) ? "public" : "private",
            ownerName: interfaceName,
            ownerKind: ASTEngine.SymbolKind.Interface,
            metadata: {
              nodeType: method.type,
              isInterfaceMethod: true,
              isExported: this.isGoExported(methodName.text),
            },
          })
        } else {
          // Embedded interface (`Reader`/`io.Closer` in
          // `interface { Reader; Close() error }`). Parsed as constraint_elem
          // whose single named child is the type node (type_identifier or
          // qualified_type) — NOT a named "type" field. The pre-fix code
          // read childForFieldName("type"), which returned nothing, so NO
          // embedded-interface symbol was emitted and the embedding
          // interface's method set silently lost the promoted methods. That
          // let a struct with only Close() be (wrongly) declared to
          // implement ReadCloser — a false positive the differential missed
          // because the oracle shared the same blind spot (go wave deep
          // review 2026-08-29). We set name = LEAF so local embedded
          // interfaces (Reader) resolve; external ones (io.Closer, leaf
          // Closer) find no local interface and contribute nothing.
          const embeddedType = method.childForFieldName("type")
          const embeddedNode = embeddedType ?? (method.namedChildCount > 0 ? method.namedChild(0) : undefined)
          if (embeddedNode) {
            const rawText = embeddedNode.text
            const leaf = rawText.lastIndexOf(".") !== -1 ? rawText.slice(rawText.lastIndexOf(".") + 1) : rawText
            symbols.push({
              name: leaf,
              kind: ASTEngine.SymbolKind.Interface,
              range: this.nodeToRange(method),
              visibility: "public",
              ownerName: interfaceName,
              ownerKind: ASTEngine.SymbolKind.Interface,
              metadata: {
                nodeType: method.type,
                isEmbeddedInterface: true,
                embeddedInterface: rawText,
              },
            })
          }
        }
        continue
      }

      // Embedded interface — parsed as a constraint_elem whose single named
      // child is the type node (type_identifier for `Reader`, qualified_type
      // for `io.Closer`). The pre-fix code only handled embedded interfaces
      // in the method_spec ELSE branch (no-name), which constraint_elem never
      // reached — so embedded-interface symbols were never emitted, the
      // embedding interface's method set lost promoted methods, and a struct
      // with only Close() was (wrongly) declared to implement ReadCloser (or
      // not recognized as implementing ReadCloser when it satisfied the
      // promoted Read too). go wave deep-review 2026-08-29.
      if (method?.type === "constraint_elem") {
        const embeddedNode = method.namedChildCount > 0 ? method.namedChild(0) : undefined
        if (embeddedNode) {
          const rawText = embeddedNode.text
          const leaf = rawText.lastIndexOf(".") !== -1 ? rawText.slice(rawText.lastIndexOf(".") + 1) : rawText
          symbols.push({
            name: leaf,
            kind: ASTEngine.SymbolKind.Interface,
            range: this.nodeToRange(method),
            visibility: "public",
            ownerName: interfaceName,
            ownerKind: ASTEngine.SymbolKind.Interface,
            metadata: {
              nodeType: method.type,
              isEmbeddedInterface: true,
              embeddedInterface: rawText,
            },
          })
        }
      }
    }
  }

  /**
   * Extract Go variables and constants
   */
  private extractGoVariables(node: Node, symbols: ASTEngine.UniversalSymbol[], parentStruct?: string) {
    // Process var/const spec children
    for (let i = 0; i < node.namedChildCount; i++) {
      const spec = node.namedChild(i)
      if (spec?.type === "var_spec" || spec?.type === "const_spec") {
        const nameNodes: Node[] = []
        for (let j = 0; j < spec.namedChildCount; j++) {
          const c = spec.namedChild(j)
          if (c && c.type === "identifier") nameNodes.push(c)
        }
        if (nameNodes.length > 0) {
          const isConst = spec.type === "const_spec"
          for (const nameNode of nameNodes) {
            if (!nameNode) continue
            symbols.push({
              name: nameNode.text,
              kind: isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
              range: this.nodeToRange(spec),
              visibility: this.isGoExported(nameNode.text) ? "public" : "private",
              ownerName: parentStruct,
              ownerKind: parentStruct ? ASTEngine.SymbolKind.Class : undefined,
              metadata: {
                nodeType: spec.type,
                isConst,
                isExported: this.isGoExported(nameNode.text),
              },
            })
          }
        }
      }
    }
  }

  // HELPER METHODS

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

  private isGoExported(name: string): boolean {
    // In Go, exported identifiers start with uppercase letter
    return name.length > 0 && name[0] >= "A" && name[0] <= "Z"
  }

  private extractGoApiContractPathFromComments(node: Node): string | undefined {
    let prevNode = node.previousNamedSibling
    // Gather all preceding comments
    const comments: string[] = []
    while (prevNode && prevNode.type === "comment") {
      comments.unshift(prevNode.text)
      prevNode = prevNode.previousNamedSibling
    }

    for (const comment of comments) {
      // Swaggo annotation: @Router /path/to/endpoint [method] — pure string
      // scan (case-insensitive marker, whitespace-tolerant), no regex.
      const router = this.parseRouterAnnotation(comment)
      if (router) return router
    }
    return undefined
  }

  private extractGoReceiver(methodNode: Node): { name: string; typeName: string; isPointer: boolean } | undefined {
    // Method receiver is the first parameter_list in method_declaration
    let receiverList: Node | null = null

    // Find the receiver parameter list (should be first parameter_list)
    for (let i = 0; i < methodNode.namedChildCount; i++) {
      const child = methodNode.namedChild(i)
      if (child?.type === "parameter_list") {
        receiverList = child
        break
      }
    }

    if (!receiverList) return undefined

    const receiverParam = receiverList.namedChild(0)
    if (!receiverParam || receiverParam.type !== "parameter_declaration") return undefined

    const receiverName = receiverParam.childForFieldName("name")
    const receiverType = receiverParam.childForFieldName("type")

    if (!receiverType) return undefined

    const typeName = receiverType.text
    const isPointer = typeName.startsWith("*")
    const actualTypeName = isPointer ? typeName.substring(1) : typeName

    return {
      name: receiverName?.text || "",
      typeName: actualTypeName,
      isPointer,
    }
  }

  private extractGoParameters(node: Node): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []

    // Find parameter_list (skip receiver for methods)
    let paramLists = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === "parameter_list") {
        paramLists.push(child)
      }
    }

    // For methods, skip first parameter_list (receiver)
    const targetParamList = node.type === "method_declaration" ? paramLists[1] : paramLists[0]
    if (!targetParamList) return parameters

    for (let i = 0; i < targetParamList.namedChildCount; i++) {
      const param = targetParamList.namedChild(i)
      if (param?.type === "parameter_declaration" || param?.type === "variadic_parameter_declaration") {
        const nameNodes: Node[] = []
        for (let j = 0; j < param.namedChildCount; j++) {
          const c = param.namedChild(j)
          if (c && c.type === "identifier") nameNodes.push(c)
        }
        const typeNode = param.childForFieldName("type")

        if (nameNodes.length > 0) {
          for (const nameNode of nameNodes) {
            if (!nameNode) continue
            parameters.push({
              name: nameNode.text,
              type: typeNode?.text,
              isOptional: false, // Go doesn't have optional parameters
            })
          }
        } else if (typeNode) {
          parameters.push({
            name: `arg${parameters.length}`,
            type: typeNode?.text,
            isOptional: false, // Go doesn't have optional parameters
          })
        }
      }
    }

    return parameters
  }

  private extractGoReturnType(node: Node): string | undefined {
    const resultNode = node.childForFieldName("result")
    if (resultNode) {
      return resultNode.text
    }

    // Fallback: look for common return type nodes. NOTE: parameter_list is
    // deliberately NOT in this list. In tree-sitter-go the named result list
    // (func f() (int, error)) is the `result` FIELD, handled above; bare
    // parameter_list children are the RECEIVER (methods) and the PARAMETERS.
    // Scanning for parameter_list here made `func (v *S) HelpPrompt() {}`
    // return "(v *S)" (the receiver!) and made method_spec/method
    // `Diagnostics(diags X)` return the parameters as a fake return type.
    // Those corrupt signatures silently broke interface implements
    // detection (terraform views.Plan -> PlanHuman/PlanJSON, go wave
    // deep-review 2026-08-29: analyzer emitted 0 implements edges where
    // duck typing clearly holds).
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        inArray(
          [
            "type_identifier",
            "qualified_type",
            "pointer_type",
            "slice_type",
            "array_type",
            "map_type",
            "channel_type",
            "function_type",
          ],
          child.type,
        )
      ) {
        return child.text
      }
    }
    return undefined
  }

  private findGoFunctionCalls(functionNode: Node): string[] {
    const calls: string[] = []

    const bodyNode = functionNode.childForFieldName("body")
    if (bodyNode) {
      const stack = [bodyNode]
      while (stack.length > 0) {
        const node = stack.pop()!
        if (node.type === "call_expression") {
          const funcNode = node.childForFieldName("function")
          if (funcNode) {
            const callExpression = this.buildGoCallExpression(funcNode)
            if (callExpression && !this.isGoBuiltin(callExpression)) {
              calls.push(callExpression)
            }
          }
        }
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push(child)
        }
      }
    }

    return calls
  }

  private buildGoCallExpression(funcNode: Node): string | undefined {
    // Non-nameable callees (inline func-literals func(){...}(), parenthesized
    // empty, generics) have no static callable name — skip them. Pre-fix the
    // default branch returned the WHOLE func-literal text, polluting
    // qualified_calls with garbage that resolveGoFunctionCall then emitted
    // as fabricated calls targets (Go wave 2026-08-28, same class as Rust's
    // `(self.0)` — the differential found `depth--\n\t}`, closure bodies etc.
    // as `calls` targets). Identifier and selector callees keep leaf targets.
    switch (funcNode.type) {
      case "identifier":
        return funcNode.text

      case "selector_expression":
        return this.buildGoSelectorExpression(funcNode)

      default:
        return undefined
    }
  }

  private buildGoSelectorExpression(node: Node): string {
    const object = node.childForFieldName("operand")
    const field = node.childForFieldName("field")

    if (!object || !field) return node.text

    const objectText = object.type === "selector_expression" ? this.buildGoSelectorExpression(object) : object.text

    return `${objectText}.${field.text}`
  }

  private isGoBuiltin(call: string): boolean {
    const builtins = [
      "make",
      "new",
      "len",
      "cap",
      "append",
      "copy",
      "delete",
      "panic",
      "recover",
      "print",
      "println",
      "close",
    ]
    return inArray(builtins, call.split(".")[0])
  }

  /**
   * Resolve a goroutine/defer call target through the SAME bare-call symbol
   * contract as analyzeGoFunctionCalls: package-qualified (has a dot) emits
   * the leaf unconditionally; bare names emit only if they name an in-file
   * declared function/method symbol. This drops closure-variable callees
   * (`go done()`, `defer release()` where done/release are var-assigned
   * funcs, NOT declared symbols) so goroutine/defer edges stay consistent
   * with the analyzer's own call resolution and with the differential
   * oracle — which derives only declared-function + qualified leaves.
   */
  private isGoResolvableCallTarget(target: string | undefined, symbols: ASTEngine.UniversalSymbol[]): boolean {
    if (!target) return false
    if (target.indexOf(".") !== -1) return true // qualified -> leaf kept
    return someSymbol(
      symbols,
      (s) =>
        (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
        s.name === target,
    )
  }

  /**
   * Resolve the callable LEAF name of a callee node, for goroutine/defer/
   * channel handlers. Anonymous func-literal callees (`go func(){...}()`,
   * `defer func(){...}()`) and non-named callees have NO static name and
   * must be skipped — the pre-fix handlers returned the whole func-literal
   * text / "anonymous_closure", fabricating garbage calls targets (found
   * #261-family Go wave 2026-08-28, same class as Rust's `(self.0)` fix).
   * Selector callees (`s.start`) resolve to the field LEAF (family contract).
   */
  private resolveGoCallLeaf(funcNode: Node | null | undefined): string | undefined {
    if (!funcNode) return undefined
    if (funcNode.type === "identifier") return funcNode.text
    if (funcNode.type === "selector_expression") {
      const field = funcNode.childForFieldName("field")
      return field?.text
    }
    // func_literal / parenthesized / index / generic callees: no static name.
    return undefined
  }

  // Framework detection
  private detectGoFrameworks(
    rootNode: Node,
    imports: ASTEngine.ImportInfo[],
  ): { name: string; confidence: number; patterns: string[] }[] {
    const frameworks: { name: string; confidence: number; patterns: string[] }[] = []
    const modules = mapSymbols(imports, (imp) => imp.module || "")

    // Pure AST/Import detection, NO primitive string matching
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/gin-gonic/gin"))) {
      frameworks.push({ name: "gin", confidence: 1.0, patterns: ["github.com/gin-gonic/gin"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/labstack/echo"))) {
      frameworks.push({ name: "echo", confidence: 1.0, patterns: ["github.com/labstack/echo"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/gofiber/fiber"))) {
      frameworks.push({ name: "fiber", confidence: 1.0, patterns: ["github.com/gofiber/fiber"] })
    }
    if (someSymbol(modules, (m) => m === "net/http" || m.startsWith("net/http/"))) {
      frameworks.push({ name: "net_http", confidence: 0.8, patterns: ["net/http"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/gorilla/mux"))) {
      frameworks.push({ name: "gorilla_mux", confidence: 1.0, patterns: ["github.com/gorilla/mux"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "google.golang.org/grpc"))) {
      frameworks.push({ name: "grpc", confidence: 1.0, patterns: ["google.golang.org/grpc"] })
    }
    if (someSymbol(modules, (m) => stringIncludes(m, "github.com/stretchr/testify"))) {
      frameworks.push({ name: "testify", confidence: 1.0, patterns: ["github.com/stretchr/testify"] })
    }

    return frameworks
  }

  private detectGoPatterns(rootNode: Node, symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!

      switch (node.type) {
        case "go_statement":
          if (!inArray(patterns, "goroutines")) patterns.push("goroutines")
          break
        case "defer_statement":
          if (!inArray(patterns, "defer")) patterns.push("defer")
          break
        case "send_statement":
        case "receive_statement":
        case "communication_case":
        case "channel_type":
          if (!inArray(patterns, "channels")) patterns.push("channels")
          break
        case "interface_type":
          if (node.namedChildCount === 0) {
            if (!inArray(patterns, "empty_interface")) patterns.push("empty_interface")
          }
          break
        case "if_statement":
          // Check for standard Go error handling: if err != null
          const condition = node.childForFieldName("condition")
          if (condition && stringIncludes(condition.text, "err") && stringIncludes(condition.text, "!=")) {
            if (!inArray(patterns, "error_handling")) patterns.push("error_handling")
          }
          break
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }

    if (someSymbol(symbols, (s) => s.metadata?.isInterface)) if (!inArray(patterns, "$1")) patterns.push("interfaces")
    if (someSymbol(symbols, (s) => s.metadata?.isStruct)) if (!inArray(patterns, "$1")) patterns.push("structs")

    return patterns
  }

  /**
   * Go Relationship Analysis
   * Analyzes Go-specific relationships: struct embedding, interface implementation, method receivers, package dependencies
   */
  private analyzeGoRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    _ctx: GoContext,
  ) {
    // 1. Analyze struct embedding relationships (extends only)
    this.analyzeGoStructEmbedding(rootNode, relationships, symbols)

    // 2. Analyze interface implementation relationships
    this.analyzeGoInterfaceImplementation(rootNode, relationships, symbols)

    // 3. Analyze function call relationships (leaf targets, incl. stdlib)
    this.analyzeGoFunctionCalls(rootNode, relationships, symbols)

    // 3.5. Package-scope call expressions (var/const initializers, e.g.
    // `var _ = intVar(123)`, `var r = regexp.MustCompile(...)`). These are
    // real calls at package level that findGoFunctionCalls (body-only) never
    // captures — a genuine analyzer gap (Go wave 2026-08-28: newexpr.go,
    // session.go NewString, semtok.go MustCompile all leaked as MISSING).
    this.analyzeGoPackageScopeCalls(rootNode, relationships, symbols)

    // 4. Analyze Go-specific patterns (channels, goroutines, defer)
    this.analyzeGoSpecificPatterns(rootNode, relationships, symbols)

    // 5. Analyze selector expression Uses (field access)
    this.analyzeGoSelectorUses(rootNode, relationships, symbols)

    // 6. OwnerName contains pass (Rust M12.18 contract): every symbol with an
    // owner gets ONE `contains owner -> member` edge — covers struct fields,
    // interface methods, and methods uniformly. Replaces the old
    // receiver-only contains and the package-export contains noise.
    for (const s of symbols) {
      const owner = s.ownerName
      if (owner && owner !== s.name) {
        relationships.push({
          source: owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }
  }

  /**
   * Go Struct Embedding Analysis
   * Analyzes struct embedding (anonymous fields) which is Go's composition pattern
   */
  private analyzeGoStructEmbedding(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "type_declaration") {
        const typeSpecs = this.findChildrenByType(node, "type_spec")
        for (const typeSpec of typeSpecs) {
          const structSpec = this.findChildByType(typeSpec, "struct_type")
          if (structSpec) {
            const nameNode = typeSpec.childForFieldName("name")
            const structName = nameNode?.text
            if (structName) {
              // Go embedding = anonymous-field composition with method
              // promotion — family contract (Java/C++/Swift/ObjC): ONE extends
              // edge, no contains twin. The embedded type is a member via the
              // ownerName contains pass below, and field-type dependency edges
              // are NOT emitted (Rust M12.18 contract — fields get contains
              // only, no dangling type-text targets).
              const embeddedTypes = this.extractGoEmbeddedTypes(structSpec)
              forEachSymbol(embeddedTypes, (embeddedType) => {
                relationships.push({
                  source: structName,
                  target: embeddedType,
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 0.8,
                  metadata: {
                    relationshipType: "go_struct_embedding",
                    isEmbedding: true,
                    isAnonymous: true,
                    embedType: "struct_composition_extends",
                  },
                })
              })
            }
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Go Interface Implementation Analysis
   * Analyzes implicit interface implementation (Go's duck typing)
   */
  private analyzeGoInterfaceImplementation(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    // Get all interfaces and their methods
    const interfaces = filterSymbols(symbols, (s) => s.metadata?.isInterface)
    const structs = filterSymbols(symbols, (s) => s.metadata?.isStruct)
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)

    // Embedded-struct method promotion: `type Worker struct { *Shape }`
    // promotes Shape's methods into Worker's method set (Go spec — a
    // promoted method is an element of the embedding struct's method set, so
    // Worker implements any interface Shape implements). The pre-promotion
    // analyzer (and the differential oracle) silently omitted this — Worker
    // could never satisfy an interface via an embedded type, so real
    // satisfied interfaces were missed (and, absent promotion, a struct with
    // only Shape embedded appeared NOT to implement an interface it does).
    // Resolve embedding via the go_struct_embedding extends edges (source =
    // embedding struct, target = embedded type).
    const embeddedOf: Record<string, string[]> = {}
    for (const r of relationships) {
      if (
        (r.type || r.relationshipType || "") === ASTEngine.RelationshipType.Extends &&
        (r.metadata as any)?.relationshipType === "go_struct_embedding"
      ) {
        const src = String(r.source ?? r.from ?? "")
        const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
        if (src && tgt) { if (!embeddedOf[src]) embeddedOf[src] = []; embeddedOf[src].push(tgt) }
      }
    }

    forEachSymbol(interfaces, (interfaceSymbol) => {
      const interfaceMethods = this.getGoInterfaceMethods(interfaceSymbol, symbols)

      forEachSymbol(structs, (structSymbol) => {
        const structName = structSymbol.name
        // Promoted methods: direct + transitive embedding closure (Go
        // method promotion — an embedded type's methods are elements of the
        // embedding struct's method set). We promote the FULL method set
        // (value + pointer receivers) because the overwhelmingly common and
        // spec-valid form is value embedding of a pointer (`*Shape`), which
        // promotes both. This mirrors the oracle exactly.
        const promoted = this.collectGoPromotedMethods(structName, methods, symbols, embeddedOf, new Set())

        const valueMethods = [
          ...filterSymbols(methods, (m) => {
            const receiverType = m.metadata?.receiverType || m.metadata?.receiver?.typeName
            const isPointer = !!(m.metadata?.isPointerReceiver || m.metadata?.receiver?.isPointer)
            return receiverType === structName && !isPointer
          }),
          ...promoted,
        ]
        const pointerMethods = [
          ...filterSymbols(methods, (m) => {
            const receiverType = m.metadata?.receiverType || m.metadata?.receiver?.typeName
            return receiverType === structName
          }),
          ...promoted,
        ]

        // In Go method sets: T has value methods only; *T has value + pointer methods.
        const valueImpl = this.checkGoInterfaceImplementation(interfaceMethods, valueMethods)
        const pointerImpl = this.checkGoInterfaceImplementation(interfaceMethods, pointerMethods)

        if (valueImpl.implements) {
          relationships.push({
            source: structSymbol.name,
            target: interfaceSymbol.name,
            type: ASTEngine.RelationshipType.Implements,
            confidence: valueImpl.confidence,
            metadata: {
              relationshipType: "go_interface_implementation",
              isImplicit: true,
              matchedMethods: valueImpl.matchedMethods,
              implementationType: "duck_typing",
              receiverSet: "value",
            },
          })
        }

        if (!valueImpl.implements && pointerImpl.implements) {
          relationships.push({
            source: structSymbol.name,
            target: interfaceSymbol.name,
            type: ASTEngine.RelationshipType.Implements,
            confidence: pointerImpl.confidence,
            metadata: {
              relationshipType: "go_interface_implementation",
              isImplicit: true,
              matchedMethods: pointerImpl.matchedMethods,
              implementationType: "duck_typing",
              receiverSet: "pointer",
            },
          })
        }
      })    })
  }

  /**
   * Go embedded-struct method promotion (Go spec, promoted methods).
   * Returns the method-symbol set reachable on `structName` through embedded
   * structs (the go_struct_embedding closure built in
   * analyzeGoInterfaceImplementation). `worker struct { *shape; name string }`
   * promotes shape's methods into worker's method set, so worker satisfies
   * any interface shape satisfies. Transitive and cycle-safe. NOTE: deduped
   * by method signature (name+params+return); a struct defining its own
   * method with the same signature as a promoted one shadows the promotion
   * (Go rule: a promoted method at shallower depth wins / is shadowed by an
   * explicit method).
   */
  private collectGoPromotedMethods(
    structName: string,
    methods: ASTEngine.UniversalSymbol[],
    symbols: ASTEngine.UniversalSymbol[],
    embeddedOf: Record<string, string[]>,
    visiting: Set<string>,
  ): ASTEngine.UniversalSymbol[] {
    if (visiting.has(structName)) return []
    visiting.add(structName)
    const acc: ASTEngine.UniversalSymbol[] = []
    const embeddedTypes = embeddedOf[structName]
    if (embeddedTypes) {
      for (const et of embeddedTypes) {
        // Only promote methods belonging to a type ACTUALLY declared in this
        // file (external embedded types have no local methods).
        const embeddedMethods = filterSymbols(
          methods,
          (m) => (m.metadata?.receiverType || m.metadata?.receiver?.typeName) === et,
        )
        const ownSig = (m: ASTEngine.UniversalSymbol) => this.buildGoMethodSignature(m)
        forEachSymbol(embeddedMethods, (m) => {
          // Shadowing: an explicit/shallower method with the same signature
          // wins over a promoted one.
          const shadowed = someSymbol(
            [...filterSymbols(methods, (sm) => (sm.metadata?.receiverType || sm.metadata?.receiver?.typeName) === structName), ...acc],
            (x) => x !== m && this.buildGoMethodSignature(x) === ownSig(m),
          )
          if (!shadowed && !someSymbol(acc, (x) => this.buildGoMethodSignature(x) === ownSig(m))) {
            acc.push(m)
          }
        })
        // Transitive: embedded struct may itself embed another.
        const transitive = this.collectGoPromotedMethods(et, methods, symbols, embeddedOf, visiting)
        forEachSymbol(transitive, (m) => {
          const shadowed = someSymbol(
            [...filterSymbols(methods, (sm) => (sm.metadata?.receiverType || sm.metadata?.receiver?.typeName) === structName), ...acc],
            (x) => x !== m && this.buildGoMethodSignature(x) === this.buildGoMethodSignature(m),
          )
          if (!shadowed && !someSymbol(acc, (x) => this.buildGoMethodSignature(x) === this.buildGoMethodSignature(m))) {
            acc.push(m)
          }
        })
      }
    }
    visiting.delete(structName)
    return acc
  }

  /**
   * Go Function Call Analysis
   * Analyzes Go function calls including package-qualified calls.
   * Family contract (Rust M12.18): calls emit LEAF targets — a receiver chain
   * `s.repo.Save(user)` emits `calls Save -> Save` exactly like Rust's
   * `self.repository.find(id)` emits `calls find -> find`, and stdlib calls
   * (`strings.ToUpper`) emit `calls transform -> ToUpper` like Rust's
   * `calls normalize -> println`. Instantiates fires ONLY for PascalCase
   * top-level FUNCTION symbols (Go constructor convention `NewXxx`) — never
   * for methods or unresolved stdlib leaves.
   */
  private analyzeGoFunctionCalls(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const functions = filterSymbols(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method,
    )

    forEachSymbol(functions, (func) => {
      const qualifiedCalls = func.qualified_calls || []
      forEachSymbol(qualifiedCalls, (call) => {
        // Handle package-qualified calls (package.Function) — leaf target
        const targetFunction = this.resolveGoFunctionCall(call, symbols)
        if (targetFunction) {
          relationships.push({
            source: func.name,
            target: targetFunction,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.8,
            metadata: {
              relationshipType: "go_function_call",
              callExpression: call,
              isPackageQualified: stringIncludes(call, "."),
            },
          })
          // Go constructors: NewFoo() — PascalCase top-level function.
          // Methods and unresolved stdlib leaves never instantiate.
          const ctorSymbol = findSymbol(
            symbols,
            (s) =>
              s.name === targetFunction &&
              s.kind === ASTEngine.SymbolKind.Function &&
              !s.ownerName,
          )
          if (
            ctorSymbol &&
            ctorSymbol.name[0] === ctorSymbol.name[0].toUpperCase() &&
            ctorSymbol.name[0] !== ctorSymbol.name[0].toLowerCase()
          ) {
            relationships.push({
              source: func.name,
              target: targetFunction,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.6,
              metadata: { relationshipType: "go_instantiation", callExpression: call },
            })
          }
        }
      })
    })
  }

  /**
   * Package-scope call analysis. Captures call_expression nodes that sit at
   * package level (var/const initializers, top-level assignments) — e.g.
   * `var _ = intVar(123)`, `var r = regexp.MustCompile(...)`, or
   * `keys.NewString("view_type", "")`. findGoFunctionCalls only walks
   * function/method bodies, so these real calls were NEVER emitted (Go wave
   * 2026-08-28: newexpr.go, session.go NewString, semtok.go MustCompile all
   * leaked as differential MISSING). Emitted with source = package/"global"
   * (no enclosing function). Mirrors resolveGoFunctionCall: bare callee emits
   * only if it names an in-file declared function/method; qualified callee
   * emits the leaf unconditionally; builtins and func-literals skipped.
   */
  private analyzeGoPackageScopeCalls(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const declared = new Set<string>()
    // Instantiates contract (family, mirrored in the differential oracle
    // deriveGoEdges.ctorFns): only PascalCase TOP-LEVEL FUNCTION symbols
    // instantiate — never methods and never unresolved stdlib/external leaves.
    // `flag.String(...)` at package scope must NOT emit instantiates->String
    // even when a same-named method `func (f T) String()` exists in-file
    // (measured as 2 UNEXPLAINED on go-tools beyond the 60-file floor).
    const ctorFns = new Set<string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) {
        declared.add(s.name)
      }
      if (s.kind === ASTEngine.SymbolKind.Function && !s.ownerName) {
        ctorFns.add(s.name)
      }
    }
    const stack: Node[] = [rootNode]
    const emitted = new Set<string>()
    while (stack.length > 0) {
      const node = stack.pop()!
      // Do not descend into function/method bodies — already handled by
      // findGoFunctionCalls on the function/method symbols.
      if (node.type === "function_declaration" || node.type === "method_declaration") continue
      // Deep-review alignment 2026-08-29 (go family final pass): a
      // package-scope IMMEDIATELY-invoked func literal (`var x = func(){...}()`,
      // where the func_literal's parent is a call_expression) RUNS at package
      // init, so its qualified stdlib calls ARE real top-level calls and MUST
      // be emitted (they were silently dropped before — measured 12 MISSING on
      // go-tools beyond the 60-file floor; `var cwd = func(){ os.Getwd() }()`
      // lost Getwd/Fatalf). A STORED closure (`var h = func(){...}` whose
      // parent is NOT a call_expression) is a template that is not statically
      // executed at init — descending it would over-emit, so it is skipped
      // (children pushed only for immediately-invoked bodies).
      if (node.type === "func_literal" && node.parent?.type !== "call_expression") continue
      if (node.type === "call_expression") {
        const fn = node.childForFieldName("function")
        if (fn) {
          const leaf = this.resolveGoCallLeaf(fn)
          // func-literal callee = an IMMEDIATELY-invoked package closure
          // (`var x = func(){...}()`), which RUNS at package init. No call
          // edge to the anonymous func itself, but DESCEND its body so real
          // qualified calls inside it (`os.Getwd`) are emitted (deep-review
          // go family final pass 2026-08-29 — previously dropped, measured
          // 12 MISSING on go-tools beyond the 60-file floor). Stored,
          // non-invoked closures are skipped by the func_literal guard above.
          if (fn.type === "func_literal") {
            for (let i = fn.namedChildCount - 1; i >= 0; i--) {
              const fc = fn.namedChild(i)
              if (fc) stack.push(fc)
            }
            continue
          }
          if (!leaf) continue
          const qualified = fn.type === "selector_expression"
          const isCtor = leaf[0] === leaf[0].toUpperCase() && leaf[0] !== leaf[0].toLowerCase()
          const emit = !this.isGoBuiltin(leaf) && (qualified || declared.has(leaf) || (isCtor && declared.has(leaf)))
          if (emit && !emitted.has("call:" + leaf)) {
            emitted.add("call:" + leaf)
            relationships.push({
              source: "global",
              target: leaf,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              metadata: {
                relationshipType: "go_package_scope_call",
                callExpression: fn.text,
                isPackageQualified: qualified,
              },
            })
          }
          // Instantiates contract (family): ONLY PascalCase top-level
          // FUNCTION symbols — flag.String(...) must not instantiate->String
          // when a method String() exists (deep-review 2026-08-29, go-tools
          // @200 measured 2 UNEXPLAINED). ctorFns = top-level functions only.
          if (isCtor && ctorFns.has(leaf) && !emitted.has("inst:" + leaf)) {
            emitted.add("inst:" + leaf)
            relationships.push({
              source: "global",
              target: leaf,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.6,
              metadata: { relationshipType: "go_package_scope_instantiation", callExpression: fn.text },
            })
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Go-Specific Pattern Analysis
   * Analyzes goroutines, channels, defer statements, and Go idioms
   */
  private analyzeGoSpecificPatterns(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    // Dedup against calls edges already emitted by analyzeGoFunctionCalls
    // (qualified_calls includes call_expressions inside go/defer bodies) —
    // goroutine/defer spawns are calls, one edge per (source, target) pair.
    const emittedCalls = new Set<string>()
    for (const r of relationships) {
      if ((r.type || r.relationshipType || "") === ASTEngine.RelationshipType.Calls) {
        emittedCalls.add(`${r.source}->${r.target}`)
      }
    }

    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "go_statement") {
        const functionCall = this.extractGoRoutineFunction(node)
        // Drop unresolvable bare closure-var goroutines (see
        // isGoResolvableCallTarget): `go done()` where done is a local func
        // var is not a static call to a declared symbol.
        if (functionCall && this.isGoResolvableCallTarget(functionCall, symbols)) {
          const containingFunction = this.findContainingGoFunction(node)
          if (containingFunction && !emittedCalls.has(`${containingFunction}->${functionCall}`)) {
            emittedCalls.add(`${containingFunction}->${functionCall}`)
            relationships.push({
              source: containingFunction,
              target: functionCall,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: {
                relationshipType: "go_goroutine",
                isAsynchronous: true,
                pattern: "goroutine_spawn",
              },
            })
          }
        }
      }

      if (node.type === "send_statement" || node.type === "receive_statement" || this.isGoReceiveExpression(node)) {
        const channelVar = this.extractGoChannelVariable(node)
        const containingFunction = this.findContainingGoFunction(node)
        if (channelVar && containingFunction) {
          relationships.push({
            source: containingFunction,
            target: channelVar,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.8,
            metadata: {
              relationshipType: "go_channel_operation",
              operationType: node.type === "send_statement" ? "send" : "receive",
              pattern: "channel_communication",
            },
          })
        }
      }

      if (node.type === "select_statement" || node.type === "communication_case") {
        const channelVar = this.extractGoChannelVariable(node)
        const containingFunction = this.findContainingGoFunction(node)
        if (channelVar && containingFunction) {
          relationships.push({
            source: containingFunction,
            target: channelVar,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.85,
            metadata: {
              relationshipType: "go_select_channel",
              operationType: node.type === "select_statement" ? "select" : "select_case",
              pattern: "select_statement",
            },
          })
        }
      }

      if (node.type === "defer_statement") {
        const deferredFunction = this.extractDeferredFunction(node)
        const containingFunction = this.findContainingGoFunction(node)
        // Drop unresolvable bare closure-var defers (see
        // isGoResolvableCallTarget): `defer release()` where release is a
        // local func var is not a static call to a declared symbol.
        if (deferredFunction && this.isGoResolvableCallTarget(deferredFunction, symbols) && containingFunction && !emittedCalls.has(`${containingFunction}->${deferredFunction}`)) {
          emittedCalls.add(`${containingFunction}->${deferredFunction}`)
          relationships.push({
            source: containingFunction,
            target: deferredFunction,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            metadata: {
              relationshipType: "go_defer",
              isDeferred: true,
              pattern: "defer_cleanup",
            },
          })
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Go Selector Expression Uses Analysis
   * Tracks field access on structs (e.g., b.name, s.users).
   * Family contract (Rust M12.18): source = containing function/method,
   * target = FIELD LEAF (not the receiver variable). Selectors that are the
   * callee of a call_expression (`s.repo.Save(...)`, `strings.ToUpper(...)`)
   * are handled by the calls analysis and skipped here — one edge per pair.
   */
  private analyzeGoSelectorUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const stack = [rootNode]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "selector_expression") {
        const operand = node.childForFieldName("operand")
        const field = node.childForFieldName("field")
        // Skip selectors that are the callee of a call — the calls analysis
        // emits the leaf-target calls edge (Rust: field_expression inside a
        // call_expression is skipped for uses).
        if (operand && field && node.parent?.type !== "call_expression") {
          const src = this.findContainingGoFunction(node) || "global"
          const tgt = field.text
          const key = `${src}.${tgt}`
          if (!seen.has(key)) {
            seen.add(key)
            relationships.push({
              source: src,
              target: tgt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.7,
              metadata: { relationshipType: "go_selector_use", selectorExpression: key },
            })
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Go Import Processing
   * Handles Go module paths, vendor imports, and package resolution
   */
  private processGoImports(rootNode: Node, imports: ASTEngine.ImportInfo[]) {
    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "import_declaration") {
        this.extractGoImportStatement(node, imports)
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Extract Go import statement with proper module path handling
   */
  private extractGoImportStatement(node: Node, imports: ASTEngine.ImportInfo[]) {
    const specs: Node[] = []

    const stack = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === "import_spec") {
        specs.push(current)
        continue
      }
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }

    for (const spec of specs) {
      this.processGoImportSpec(spec, imports)
    }
  }

  /**
   * Process individual Go import specification
   */
  private processGoImportSpec(spec: Node, imports: ASTEngine.ImportInfo[]) {
    const pathNode = spec.childForFieldName("path")
    const aliasNode = spec.childForFieldName("name")

    if (pathNode) {
      // interpreted_string_literal — strip the surrounding double quotes
      // with a pure first/last-char check (no regex).
      const importPath = this.stripQuotedString(pathNode.text)
      const alias = aliasNode?.text
      const packageName = this.getGoPackageName(importPath)
      const framework = this.detectFrameworkFromGoImport(importPath)

      imports.push({
        module: importPath,
        isDefault: false,
        alias,
        items: [packageName],
        range: this.nodeToRange(spec),
        metadata: {
          isGoImport: true,
          packageName,
          framework,
          isStandardLibrary: this.isGoStandardLibrary(importPath),
          isThirdParty: this.isGoThirdPartyPackage(importPath),
        },
      })
    }
  }

  /**
   * Go Framework Pattern Analysis
   */
  private getGoFrameworkPatterns(frameworks: string[], symbols: ASTEngine.UniversalSymbol[]): any[] {
    const patterns: any[] = []

    for (const framework of frameworks) {
      switch (framework) {
        case "gin":
          patterns.push({
            framework: "Gin Web Framework",
            type: "web_framework",
            patterns: this.detectGinPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "gin.") || stringIncludes(c, "router.")),
              ),
              hasMiddleware: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Use(")),
              ),
              hasHandlers: someSymbol(symbols, (s) => stringIncludes(s.name.toLowerCase(), "handler")),
            },
          })
          break

        case "echo":
          patterns.push({
            framework: "Echo Web Framework",
            type: "web_framework",
            patterns: this.detectEchoPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "echo.") || stringIncludes(c, "e.")),
              ),
              hasMiddleware: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Use(")),
              ),
              hasContext: someSymbol(symbols, (s) =>
                someSymbol(s.parameters || [], (p) => stringIncludes(p.type || "", "Context")),
              ),
            },
          })
          break

        case "fiber":
          patterns.push({
            framework: "Fiber Web Framework",
            type: "web_framework",
            patterns: this.detectFiberPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "fiber.") || stringIncludes(c, "app.")),
              ),
              hasFastHTTP: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "fasthttp")),
              ),
            },
          })
          break

        case "gorilla_mux":
          patterns.push({
            framework: "Gorilla Mux Router",
            type: "router",
            patterns: this.detectGorillaMuxPatterns(symbols),
            confidence: 0.8,
            characteristics: {
              hasRoutes: someSymbol(symbols, (s) =>
                someSymbol(
                  s.qualified_calls || [],
                  (c) => stringIncludes(c, "mux.") || stringIncludes(c, "HandleFunc"),
                ),
              ),
              hasSubrouters: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "PathPrefix")),
              ),
            },
          })
          break

        case "gorm":
          patterns.push({
            framework: "GORM ORM",
            type: "orm",
            patterns: this.detectGORMPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasModels: someSymbol(symbols, (s) => s.kind === ASTEngine.SymbolKind.Class && s.metadata?.isGoStruct),
              hasMigrations: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "AutoMigrate")),
              ),
              hasQueries: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Find") || stringIncludes(c, "Create")),
              ),
            },
          })
          break

        case "grpc":
          patterns.push({
            framework: "gRPC",
            type: "rpc_framework",
            patterns: this.detectGRPCPatterns(symbols),
            confidence: 0.9,
            characteristics: {
              hasServices: someSymbol(symbols, (s) => stringIncludes(s.name.toLowerCase(), "service")),
              hasProtobuf: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "proto")),
              ),
              hasStreamingMethods: someSymbol(symbols, (s) =>
                someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "stream")),
              ),
            },
          })
          break
      }
    }

    return patterns
  }

  /**
   * Go Architectural Insights
   */
  private generateGoArchitecturalInsights(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): any[] {
    const insights: any[] = []

    // Analyze function complexity
    const complexFunctions = filterSymbols(
      symbols,
      (s) =>
        (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
        !!s.qualified_calls &&
        s.qualified_calls.length > 12,
    )
    if (complexFunctions.length > 0) {
      insights.push({
        type: "complexity_analysis",
        category: "function_complexity",
        message: `${complexFunctions.length} functions with high complexity detected`,
        functions: mapSymbols(complexFunctions, (f) => f.name),
        recommendation: "Consider breaking down complex functions into smaller, focused functions",
        severity: "warning",
      })
    }

    // Analyze Go-specific patterns
    const goroutineFunctions = getUniqueStrings(
      mapSymbols(
        filterSymbols(relationships, (r) => r.metadata?.relationshipType === "go_goroutine" && !!r.source),
        (r) => r.source as string,
      ),
    )
    if (goroutineFunctions.length > 0) {
      insights.push({
        type: "concurrency_pattern",
        category: "goroutines",
        message: `Goroutine usage detected in ${goroutineFunctions.length} functions`,
        functions: goroutineFunctions,
        recommendation: "Ensure proper goroutine lifecycle management and channel synchronization",
      })
    }

    // Analyze channel usage
    const channelFunctions = getUniqueStrings(
      mapSymbols(
        filterSymbols(relationships, (r) => r.metadata?.relationshipType === "go_channel_operation" && !!r.source),
        (r) => r.source as string,
      ),
    )
    if (channelFunctions.length > 0) {
      insights.push({
        type: "concurrency_pattern",
        category: "channels",
        message: `Channel communication pattern detected in ${channelFunctions.length} functions`,
        functions: channelFunctions,
        recommendation: "Follow channel ownership patterns and avoid goroutine leaks",
      })
    }

    // Analyze struct-based design
    const structs = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Class && s.metadata?.isGoStruct)
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)

    if (structs.length > 0) {
      const methodToStructRatio = methods.length / structs.length
      insights.push({
        type: "design_pattern",
        category: "struct_design",
        message: `${structs.length} structs with ${methods.length} methods (ratio: ${methodToStructRatio.toFixed(2)})`,
        structs: mapSymbols(structs, (s) => s.name),
        quality: methodToStructRatio > 3 ? "rich_behavior" : methodToStructRatio > 1 ? "balanced" : "anemic_structs",
        recommendation:
          methodToStructRatio < 1
            ? "Consider adding methods to structs for better encapsulation"
            : "Good struct-method balance",
      })
    }

    // Analyze error handling patterns
    const errorHandling = this.analyzeGoErrorHandling(symbols)
    if (errorHandling.functions > 0) {
      insights.push({
        type: "error_handling",
        category: "go_errors",
        message: `Error handling detected in ${errorHandling.functions} functions`,
        coverage: `${((errorHandling.withErrorHandling / errorHandling.functions) * 100).toFixed(1)}%`,
        recommendation:
          errorHandling.withErrorHandling / errorHandling.functions < 0.7
            ? "Improve error handling coverage"
            : "Good error handling practices",
      })
    }

    // Analyze interface usage
    const interfaces = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Interface)
    if (interfaces.length > 0) {
      insights.push({
        type: "design_pattern",
        category: "interfaces",
        message: `${interfaces.length} interfaces promoting loose coupling`,
        interfaces: mapSymbols(interfaces, (i) => i.name),
        recommendation: "Good use of Go interfaces for abstraction",
      })
    }

    return insights
  }

  // ======================== GO FRAMEWORK DETECTION METHODS ========================

  private detectGinPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (
      someSymbol(symbols, (s) =>
        someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "gin.Default") || stringIncludes(c, "gin.New")),
      )
    ) {
      patterns.push("gin_router_setup")
    }
    if (
      someSymbol(symbols, (s) =>
        someSymbol(
          s.qualified_calls || [],
          (c) => stringIncludes(c, "GET") || stringIncludes(c, "POST") || stringIncludes(c, "PUT"),
        ),
      )
    ) {
      patterns.push("rest_endpoints")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Group(")))) {
      patterns.push("route_grouping")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Use(")))) {
      patterns.push("middleware_usage")
    }

    return patterns
  }

  private detectEchoPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "echo.New")))) {
      patterns.push("echo_setup")
    }
    if (
      someSymbol(symbols, (s) => someSymbol(s.parameters || [], (p) => stringIncludes(p.type || "", "echo.Context")))
    ) {
      patterns.push("echo_context_usage")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Bind(")))) {
      patterns.push("request_binding")
    }

    return patterns
  }

  private detectFiberPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "fiber.New")))) {
      patterns.push("fiber_app_setup")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "BodyParser(")))) {
      patterns.push("request_parsing")
    }

    return patterns
  }

  private detectGorillaMuxPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "mux.NewRouter")))) {
      patterns.push("gorilla_router_setup")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "HandleFunc(")))) {
      patterns.push("route_handlers")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "PathPrefix(")))) {
      patterns.push("path_prefixes")
    }

    return patterns
  }

  private detectGORMPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "gorm.Open")))) {
      patterns.push("gorm_connection")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "AutoMigrate(")))) {
      patterns.push("auto_migration")
    }
    if (
      someSymbol(symbols, (s) =>
        someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "Create(") || stringIncludes(c, "Find(")),
      )
    ) {
      patterns.push("crud_operations")
    }

    return patterns
  }

  private detectGRPCPatterns(symbols: ASTEngine.UniversalSymbol[]): string[] {
    const patterns: string[] = []

    if (
      someSymbol(
        symbols,
        (s) => stringIncludes(s.name.toLowerCase(), "service") && s.kind === ASTEngine.SymbolKind.Class,
      )
    ) {
      patterns.push("grpc_services")
    }
    if (someSymbol(symbols, (s) => someSymbol(s.qualified_calls || [], (c) => stringIncludes(c, "grpc.NewServer")))) {
      patterns.push("grpc_server_setup")
    }

    return patterns
  }

  // ======================== GO HELPER METHODS ========================

  // ---- Pure-string helpers (M12.22: no regex in this analyzer) ----

  /** Strip surrounding backticks/quote chars from a raw string literal. */
  private stripRawStringDelimiters(text: string): string {
    if (text.length >= 2) {
      const first = text[0]
      const last = text[text.length - 1]
      if ((first === "`" && last === "`") || (first === "'" && last === "'")) {
        return text.slice(1, -1)
      }
    }
    return text
  }

  /** Strip surrounding double quotes from an interpreted string literal. */
  private stripQuotedString(text: string): string {
    if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
      return text.slice(1, -1)
    }
    return text
  }

  /** Parse struct tags `json:"name" db:"x"` into key -> value (no regex). */
  private parseStructTags(tagText: string): Record<string, string> {
    const result: Record<string, string> = {}
    let i = 0
    const n = tagText.length
    while (i < n) {
      // Skip whitespace
      while (i < n && (tagText[i] === " " || tagText[i] === "\t")) i++
      if (i >= n) break
      // Key: [a-z0-9_]+ up to ':'
      const keyStart = i
      while (i < n && tagText[i] !== ":" && tagText[i] !== " " && tagText[i] !== "\t") i++
      if (i >= n || tagText[i] !== ":") break
      const key = tagText.slice(keyStart, i)
      i++ // skip ':'
      // Value: double-quoted string
      if (i < n && tagText[i] === '"') {
        i++
        let value = ""
        while (i < n && tagText[i] !== '"') {
          if (tagText[i] === "\\" && i + 1 < n) {
            value += tagText[i + 1]
            i += 2
          } else {
            value += tagText[i]
            i++
          }
        }
        i++ // skip closing quote
        if (key) result[key] = value
      }
    }
    return result
  }

  /**
   * Swaggo @Router annotation: `@Router /path/to/endpoint [method]`.
   * Case-insensitive marker, whitespace-tolerant pure scan (no regex).
   */
  private parseRouterAnnotation(comment: string): string | undefined {
    const marker = "@Router"
    const idx = this.indexOfIgnoreCase(comment, marker)
    if (idx < 0) return undefined

    const after = comment.slice(idx + marker.length)
    const path = this.readToken(after)
    if (!path) return undefined

    // Find the [method] bracket after the path.
    const open = after.indexOf("[", after.indexOf(path) + path.length)
    if (open < 0) return undefined
    const close = after.indexOf("]", open)
    if (close < 0) return undefined
    const method = after.slice(open + 1, close).trim()
    if (!method) return undefined

    return `${method.toUpperCase()} ${path}`
  }

  private indexOfIgnoreCase(text: string, search: string): number {
    const lower = text.toLowerCase()
    const target = search.toLowerCase()
    return lower.indexOf(target)
  }

  /** Read the next whitespace-delimited token. */
  private readToken(text: string): string | undefined {
    const n = text.length
    let i = 0
    while (i < n && (text[i] === " " || text[i] === "\t")) i++
    if (i >= n) return undefined
    const start = i
    while (i < n && text[i] !== " " && text[i] !== "\t") i++
    return text.slice(start, i)
  }

  /** Normalize a Go signature: collapse whitespace, variadic, interface{} (no regex). */
  private normalizeGoSignature(sig: string): string {
    // Collapse runs of whitespace to a single space.
    let collapsed = ""
    let prevSpace = false
    for (let i = 0; i < sig.length; i++) {
      const ch = sig[i]
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        if (!prevSpace && collapsed.length > 0) collapsed += " "
        prevSpace = true
      } else {
        collapsed += ch
        prevSpace = false
      }
    }
    // `x ...T` -> `...x` is wrong; actual Go normalize: `...T` stays. Here we
    // mirror the old regex (variadic expansion) by removing space before `...`.
    let variadic = ""
    for (let i = 0; i < collapsed.length; i++) {
      const ch = collapsed[i]
      if (ch === "." && collapsed[i + 1] === "." && collapsed[i + 2] === ".") {
        // trim trailing space before the dots
        if (variadic.length > 0 && variadic[variadic.length - 1] === " ") {
          variadic = variadic.slice(0, -1)
        }
        variadic += "..."
        i += 2
      } else {
        variadic += ch
      }
    }
    // interface{} -> any
    let result = ""
    let k = 0
    while (k < variadic.length) {
      if (
        variadic[k] === "i" &&
        variadic.slice(k, k + 11) === "interface{}"
      ) {
        result += "any"
        k += 11
      } else {
        result += variadic[k]
        k++
      }
    }
    // Trim leading/trailing spaces
    let start = 0
    let end = result.length
    while (start < end && result[start] === " ") start++
    while (end > start && result[end - 1] === " ") end--
    return result.slice(start, end)
  }

  private getGoPackageName(importPath: string): string {
    const parts = importPath.split("/")
    return parts[parts.length - 1]
  }

  private detectFrameworkFromGoImport(importPath: string): string | undefined {
    if (stringIncludes(importPath, "gin-gonic/gin")) return "gin"
    if (stringIncludes(importPath, "labstack/echo")) return "echo"
    if (stringIncludes(importPath, "gofiber/fiber")) return "fiber"
    if (stringIncludes(importPath, "gorilla/mux")) return "gorilla_mux"
    if (stringIncludes(importPath, "gorm.io/gorm")) return "gorm"
    if (stringIncludes(importPath, "github.com/jmoiron/sqlx")) return "sqlx"
    if (stringIncludes(importPath, "entgo.io/ent")) return "ent"
    if (stringIncludes(importPath, "google.golang.org/grpc")) return "grpc"
    if (stringIncludes(importPath, "golang.org/x/")) return "golang_extended"
    if (stringIncludes(importPath, "go.uber.org/fx")) return "fx"
    if (stringIncludes(importPath, "github.com/google/wire")) return "wire"
    if (stringIncludes(importPath, "go.uber.org/zap")) return "zap"
    if (stringIncludes(importPath, "github.com/sirupsen/logrus")) return "logrus"

    return undefined
  }

  private isGoStandardLibrary(importPath: string): boolean {
    const stdLibPrefixes = [
      "fmt",
      "net/http",
      "os",
      "io",
      "strings",
      "strconv",
      "time",
      "json",
      "context",
      "sync",
      "log",
      "bufio",
      "bytes",
      "crypto",
      "database/sql",
      "encoding",
      "errors",
      "flag",
      "html",
      "math",
      "path",
      "reflect",
      "regexp",
      "runtime",
      "sort",
      "testing",
      "unicode",
      "unsafe",
    ]

    return (
      someSymbol(stdLibPrefixes, (prefix) => importPath === prefix || importPath.startsWith(prefix + "/")) ||
      !stringIncludes(importPath, ".")
    )
  }

  private isGoThirdPartyPackage(importPath: string): boolean {
    return stringIncludes(importPath, ".") && !this.isGoStandardLibrary(importPath)
  }

  private analyzeGoErrorHandling(symbols: ASTEngine.UniversalSymbol[]): {
    functions: number
    withErrorHandling: number
  } {
    const functions = filterSymbols(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method,
    )

    let withErrorHandling = 0
    for (const func of functions) {
      if (func.metadata?.hasErrorHandling) {
        withErrorHandling++
      }
    }

    return { functions: functions.length, withErrorHandling }
  }

  /**
   * Go Architectural Score Calculation
   */
  private calculateArchitecturalScore(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): number {
    let score = 75 // Base score for Go

    // Reward Go best practices
    if (inArray(patterns, "error_handling")) score += 8
    if (inArray(patterns, "goroutines")) score += 6
    if (inArray(patterns, "channels")) score += 6
    if (inArray(patterns, "interfaces")) score += 5
    if (inArray(patterns, "dependency_injection")) score += 4

    // Reward proper struct design
    const structs = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Class && s.metadata?.isGoStruct)
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)
    if (structs.length > 0) {
      const methodToStructRatio = methods.length / structs.length
      if (methodToStructRatio >= 1 && methodToStructRatio <= 5) score += 3
    }

    // Reward interface usage
    const interfaces = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Interface)
    if (interfaces.length > 0) {
      score += Math.min(interfaces.length * 2, 6)
    }

    // Penalize complexity issues
    const complexFunctions = filterSymbols(symbols, (s) => !!s.qualified_calls && s.qualified_calls.length > 12)
    score -= complexFunctions.length * 2

    return Math.max(40, Math.min(100, score))
  }

  /**
   * Go Code Quality Assessment
   */
  private assessCodeQuality(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): string {
    const score = this.calculateArchitecturalScore(symbols, relationships, patterns)

    if (score >= 90) return "exceptional"
    if (score >= 80) return "excellent"
    if (score >= 70) return "good"
    if (score >= 60) return "fair"
    if (score >= 50) return "needs_improvement"
    return "poor"
  }

  private calculateGoComplexity(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): number {
    return symbols.length + relationships.length
  }

  /**
   * Go Cyclomatic Complexity Calculation
   * Calculates complexity for Go code including goroutines, channels, defer, type switches, and Go-specific patterns
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1 // Base complexity

    const traverse = (n: Node) => {
      switch (n.type) {
        case "if_statement":
        case "for_statement":
        case "expression_switch_statement":
        case "type_switch_statement":
        case "select_statement":
        case "expression_case":
        case "communication_case":
        case "default_case":
          complexity++
          break
        case "binary_expression": {
          const txt = n.text
          if (stringIncludes(txt, "&&") || stringIncludes(txt, "||")) complexity++
          break
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(node)
    return complexity
  }

  // ===== GO HELPER METHODS FOR RELATIONSHIP ANALYSIS =====

  /**
   * Find child node by type
   */
  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return null
  }

  private findChildrenByType(node: Node, type: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) results.push(child)
    }
    return results
  }

  /**
   * Get Go type name from type declaration
   */
  private getGoTypeName(node: Node): string | undefined {
    const spec = this.findChildByType(node, "type_spec")
    if (spec) {
      const nameNode = spec.childForFieldName("name")
      return nameNode?.text
    }
    return undefined
  }

  /**
   * Extract embedded types from struct (anonymous fields)
   */
  private extractGoEmbeddedTypes(structNode: Node): string[] {
    const embeddedTypes: string[] = []
    const fieldList = this.findChildByType(structNode, "field_declaration_list")

    if (fieldList) {
      for (let i = 0; i < fieldList.namedChildCount; i++) {
        const field = fieldList.namedChild(i)
        if (field?.type === "field_declaration") {
          // Check if it's an embedded field (no field name, just type)
          const fieldNames = []
          for (let j = 0; j < field.namedChildCount; j++) {
            const c = field.namedChild(j)
            if (c && (c.type === "field_identifier" || c.type === "identifier")) fieldNames.push(c)
          }
          if (fieldNames.length === 0) {
            // This is an embedded field
            const typeNode = field.childForFieldName("type") || this.findChildByType(field, "type_identifier")
            if (typeNode) {
              embeddedTypes.push(typeNode.text)
            }
          }
        }
      }
    }

    return embeddedTypes
  }

  /**
   * Get interface methods from interface symbol
   */
  private getGoInterfaceMethods(
    interfaceSymbol: ASTEngine.UniversalSymbol,
    symbols: ASTEngine.UniversalSymbol[],
  ): Array<{ name: string; signature: string }> {
    const interfaceMethods: Array<{ name: string; signature: string }> = []

    // Find methods that belong to this interface
    const methods = filterSymbols(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Method && s.ownerName === interfaceSymbol.name,
    )

    forEachSymbol(methods, (method) => {
      const signature = this.buildGoMethodSignature(method)
      interfaceMethods.push({
        name: method.name,
        signature,
      })
    })

    const embedded = filterSymbols(
      symbols,
      (s) =>
        s.ownerName === interfaceSymbol.name &&
        s.ownerKind === ASTEngine.SymbolKind.Interface &&
        s.metadata?.isEmbeddedInterface,
    )
    forEachSymbol(embedded, (entry) => {
      const target = findSymbol(
        symbols,
        (s) => s.kind === ASTEngine.SymbolKind.Interface && s.name === entry.name && !s.metadata?.isEmbeddedInterface,
      )
      if (!target) return

      const inherited = this.getGoInterfaceMethods(target, symbols)
      forEachSymbol(inherited, (m) => {
        if (!someSymbol(interfaceMethods, (x) => x.name === m.name && x.signature === m.signature)) {
          interfaceMethods.push(m)
        }
      })
    })

    return interfaceMethods
  }

  /**
   * Check if struct implements interface (Go's implicit interface implementation)
   */
  private checkGoInterfaceImplementation(
    interfaceMethods: Array<{ name: string; signature: string }>,
    structMethods: ASTEngine.UniversalSymbol[],
  ): { implements: boolean; confidence: number; matchedMethods: string[] } {
    const matchedMethods: string[] = []
    let totalMethods = interfaceMethods.length

    if (totalMethods === 0) {
      return { implements: false, confidence: 0, matchedMethods: [] }
    }

    forEachSymbol(interfaceMethods, (interfaceMethod) => {
      const matchingMethod = findSymbol(structMethods, (structMethod) => {
        const structSignature = this.buildGoMethodSignature(structMethod)
        return (
          interfaceMethod.name === structMethod.name &&
          this.compareGoMethodSignatures(interfaceMethod.signature, structSignature)
        )
      })

      if (matchingMethod) {
        matchedMethods.push(interfaceMethod.name)
      }
    })

    const doesImplement = matchedMethods.length === totalMethods
    const confidence = doesImplement ? 1.0 : matchedMethods.length / totalMethods

    return { implements: doesImplement, confidence, matchedMethods }
  }

  /**
   * Build Go method signature for comparison
   */
  private buildGoMethodSignature(method: ASTEngine.UniversalSymbol): string {
    const params = mapSymbols(method.parameters || [], (p) => p.type || "interface{}").join(", ") || ""
    const returnType = method.returnType || "void"
    return `${method.name}(${params}) ${returnType}`
  }

  /**
   * Compare Go method signatures for interface implementation
   */
  private compareGoMethodSignatures(sig1: string, sig2: string): boolean {
    // Normalize signatures by removing extra whitespace and variadic expansion
    // (pure char scan + string ops, no regex).
    const normalize = (sig: string) => {
      return this.normalizeGoSignature(sig)
    }
    return normalize(sig1) === normalize(sig2)
  }

  /**
   * Resolve Go function call to find target
   */
  private resolveGoFunctionCall(callExpression: string, symbols: ASTEngine.UniversalSymbol[]): string | undefined {
    // Handle package-qualified calls (package.Function) — always resolve to
    // the LEAF name (Rust M12.18 contract): `strings.ToUpper` -> `ToUpper`,
    // `s.repo.Save` -> `Save`. Stdlib/external leaves are kept as call
    // targets even when no local symbol matches (`calls normalize -> println`).
    if (stringIncludes(callExpression, ".")) {
      const parts = callExpression.split(".")
      const functionName = parts[parts.length - 1]
      if (!functionName) return undefined

      // Local symbol with a matching name wins (method/function leaf).
      const fallback = findSymbol(
        symbols,
        (s) =>
          (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
          s.name === functionName,
      )
      return fallback?.name ?? functionName
    }

    // Handle direct function calls
    const targetFunction = findSymbol(
      symbols,
      (s) =>
        (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method) &&
        s.name === callExpression,
    )

    return targetFunction?.name
  }

  /**
   * Extract Go package name from content
   */
  private extractGoPackageName(rootNode: Node): string | undefined {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i)
      if (child && child.type === "package_clause") {
        const pkgId = child.childForFieldName("package_identifier") || child.namedChild(0)
        return pkgId ? pkgId.text : undefined
      }
    }
    return undefined
  }

  /**
   * Extract function called in goroutine
   */
  private extractGoRoutineFunction(node: Node): string | undefined {
    const callExpr = this.findChildByType(node, "call_expression")
    if (callExpr) {
      const functionNode = callExpr.childForFieldName("function")
      // Leaf resolution (skips anonymous func-literal / non-named callees).
      // Pre-fix this returned "anonymous_closure" / full text — garbage
      // `calls` targets that no static callee name supports (Go wave 2026).
      return this.resolveGoCallLeaf(functionNode)
    }
    return undefined
  }

  /**
   * Find containing Go function for a node
   */
  private findContainingGoFunction(node: Node): string | undefined {
    let current = node.parent
    while (current) {
      if (current.type === "function_declaration" || current.type === "method_declaration") {
        const nameNode = current.childForFieldName("name")
        return nameNode?.text
      }
      current = current.parent
    }
    return undefined
  }

  /**
   * Extract channel variable from channel operation
   */
  private extractGoChannelVariable(node: Node): string | undefined {
    if (node.type === "send_statement") {
      const channelNode = node.childForFieldName("channel")
      return channelNode?.text
    }
    if (node.type === "receive_statement") {
      const channelNode = node.childForFieldName("operand")
      return channelNode?.text
    }
    if (this.isGoReceiveExpression(node)) {
      const channelNode = node.childForFieldName("operand") || node.namedChild(0)
      return channelNode?.text
    }
    return undefined
  }

  private isGoReceiveExpression(node: Node): boolean {
    return node.type === "unary_expression" && node.child(0)?.type === "<-"
  }

  /**
   * Extract deferred function from defer statement
   */
  private extractDeferredFunction(node: Node): string | undefined {
    const callExpr = this.findChildByType(node, "call_expression")
    if (callExpr) {
      const functionNode = callExpr.childForFieldName("function")
      // Leaf resolution (skips anonymous func-literal / non-named callees).
      // Pre-fix this returned the whole func-literal text — garbage `calls`
      // targets for `defer func(){...}()` (Go wave 2026-08-28).
      return this.resolveGoCallLeaf(functionNode)
    }
    return undefined
  }

  private extractGoMethodSpecParameters(node: Node): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []
    const paramList = this.findChildByType(node, "parameter_list")
    if (!paramList) return parameters

    for (let i = 0; i < paramList.namedChildCount; i++) {
      const param = paramList.namedChild(i)
      if (param?.type !== "parameter_declaration") continue

      const typeNode = param.childForFieldName("type")
      const nameNodes: Node[] = []
      for (let j = 0; j < param.namedChildCount; j++) {
        const c = param.namedChild(j)
        if (c && c.type === "identifier") nameNodes.push(c)
      }
      if (nameNodes.length > 0) {
        for (const nameNode of nameNodes) {
          if (!nameNode) continue
          parameters.push({
            name: nameNode.text,
            type: typeNode?.text,
            isOptional: false,
          })
        }
      } else if (typeNode) {
        parameters.push({
          name: `arg${parameters.length}`,
          type: typeNode.text,
          isOptional: false,
        })
      }
    }

    return parameters
  }

  private extractGoMethodSpecReturnType(node: Node): string | undefined {
    const resultNode = node.childForFieldName("result")
    if (resultNode) return resultNode.text

    // Same guard as extractGoReturnType: parameter_list is NOT a return type
    // here. method_spec children are [name, parameter_list(parameters)] and
    // an optional result field; scanning for parameter_list returned the
    // PARAMETERS as a fake return type for `Diagnostics(diags X)` ("(diags
    // tfdiags.Diagnostics)"), silently breaking interface implements
    // detection (terraform views.Plan -> PlanHuman/PlanJSON, go wave
    // deep-review 2026-08-29).
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        inArray(
          [
            "type_identifier",
            "qualified_type",
            "pointer_type",
            "slice_type",
            "array_type",
            "map_type",
            "channel_type",
            "function_type",
          ],
          child.type,
        )
      ) {
        return child.text
      }
    }

    return undefined
  }

  private hasGoErrorHandling(text: string): boolean {
    if (!text) return false
    return (
      stringIncludes(text, "err != nil") ||
      stringIncludes(text, "fmt.Errorf(") ||
      stringIncludes(text, "errors.New(") ||
      stringIncludes(text, "panic(")
    )
  }
}
