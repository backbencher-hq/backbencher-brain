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
  /**
   * M59.A7 (#825): the CALLEE node of each deduped call, keyed by the enclosing
   * function's `startIndex` and then by the call text. The calls lane iterates
   * `symbol.qualified_calls` — a deduped STRING list by design (M37 #604, GOD9)
   * — so the node an edge's line comes from has to be recorded where the scan
   * still holds it. Reset at the top of every `analyze()`: a `startIndex` is
   * file-local, so a retained map would attribute another file's line.
   */
  private goCallSites = new Map<number, Map<string, Node>>()

  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: GoContext = { filePath, content }
    this.goCallSites = new Map()

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
          // GO4 (go review): endIndex is an exclusive byte offset —
          // `package p` is 8 + len bytes (0..8+len), not +9 (the +9 is
          // correct only for 1-based endColumn).
          endIndex: packageName.length + 8,
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
        // The FAMILY'S first-class `imports` kind, not a `references` edge
        // (#799 round). An import names a MODULE, not a symbol: with the edge
        // labelled `references`, every import path landed in the lane's
        // references target surface, and an import path is a string literal
        // (`net/http`, `github.com/google/go-cmp/cmp`) whose separators — `/`,
        // `.`, `-` — no Go declaration may contain. R10 asks whether a target is
        // a NAME; the answer for a module specifier is that it is a dependency,
        // and the family's label for a dependency is `imports` (c moved to it in
        // #910; go's own requiredKinds has named `imports` since the wave). The
        // references surface is now separator-free, so a future foreign spelling
        // there fails R10 immediately instead of hiding behind a recorded
        // import-path convention.
        type: ASTEngine.RelationshipType.Imports,
        confidence: 0.9,
        // isImport:true + isGoImportDep keep the edge pinnable as the "imports"
        // relationship kind by completeness section B, which reads the MARKER
        // (script/m14/completeness-inventory.ts, section B) — so the kind is
        // claimed twice over and the evidence tier stays import_based.
        // M59.A7 (#825): the import_spec, whose line is the path's line for a
        // single import and for each entry of a grouped one (the spec starts
        // at its path — an alias would share the line).
        ...(imp.range?.startLine ? { line_number: imp.range.startLine } : {}),
        metadata: { isGoImportDep: true, isImport: true, packageName: imp.metadata?.packageName },
      })
    }

    // PHASE 4: Detect Go frameworks and patterns
    const frameworks = this.detectGoFrameworks(rootNode, imports)
    const patterns = this.detectGoPatterns(rootNode, symbols)

    // PHASE 5: Exports — all public (exported) non-variable symbols
    // M49 JVM-closure exports invariant (F3 gate): export names must be
    // UNIQUE and top-level-resolvable. Go methods (value + pointer receivers
    // share the method name; iface impls redeclare it) duplicated `Run`/
    // `Notify`/`Close` — methods are members, membership rides Contains;
    // only package-level units export. First occurrence wins the export
    // slot (identical dedupe to the cpp/scalar fixes).
    const seenExportNames = new Set<string>()
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      const isPrivate = s.visibility === "private"
      const isVar = s.kind === ASTEngine.SymbolKind.Variable
      const isMethod = s.kind === ASTEngine.SymbolKind.Method
      // GO7 (go review): owned members (struct fields with ownerName) are
      // not top-level units — the old predicate exported every PUBLIC
      // field (`X int` in any struct), tripping the harness-global
      // export-uniqueness invariant on the first fixture with an uppercase
      // field. Membership rides Contains (same rule as methods).
      if (!isPrivate && !isVar && !isMethod && !s.ownerName && !seenExportNames.has(s.name)) {
        seenExportNames.add(s.name)
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
        // GO6 (go review): `complexity` was the synthetic
        // symbols+relationships heuristic while a real per-file
        // cyclomaticComplexity sat beside it — the exact disease the
        // family removed everywhere else. One contract: both report the
        // real cyclomatic number.
        complexity: this.calculateCyclomaticComplexity(rootNode),
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
      // The dedicated `imports` kind is an import-based fact (the JVM lanes'
      // T1/kotlin K8 regression class: the classifier's isImport branch fired
      // only for `references`, so the dedicated kind fell through to
      // usage_contextual). Go's import edges moved to this label this round.
      if (t === "imports") { md.evidenceClass = "import_based"; continue }
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

    // M59.A7 (#825): the node form of collectTypeNames — same traversal, same
    // BUILTINS guard, same first-wins dedupe, but it keeps the NODE the name is
    // written on so the edge can carry that line instead of the construct's.
    const collectTypeNameNodes = (n: Node, out: Node[], qualified?: string): void => {
      if (n.type === "qualified_type" || n.type === "type_identifier") {
        if (!BUILTINS.has(n.text) && !out.some((x) => x.text === n.text)) out.push(n)
        return
      }
      if (n.type === "block" || n.type === "expression_list") return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNameNodes(c, out, qualified)
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
        const names: Node[] = []
        collectTypeNameNodes(r, names)
        for (const t of names) {
          // R10 (#799 round): a QUALIFIED type USE is published under the name
          // the lane would publish for that type as a symbol — `io.Writer` ->
          // `Writer` — with the package-qualified spelling kept in
          // metadata.qualifiedType. One node kind, one answer: this is the
          // rule the same round applied to struct/interface embedding's
          // `extends` target, and it is what retires `references|.` for this
          // surface. The R10 census measures the separators in a lane's
          // TARGETS against the characters its own SYMBOLS use, and no Go
          // declaration may contain `.`; a qualified use is written `pkg.Name`
          // but DECLARES `Name`. (`uses` already targeted the leaf for
          // `pkg.Fn` selector uses, so the raw form was this surface alone.)
          const qualified = t.type === "qualified_type" ? t.text : undefined
          const dot = qualified ? qualified.lastIndexOf(".") : -1
          const target = qualified && dot > 0 ? qualified.slice(dot + 1) : t.text
          const key = `${source}|${target}|${relType}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            ...(this.nodeLine(t) ? { line_number: this.nodeLine(t)! } : {}),
            metadata: { relationshipType: relType, ...(qualified ? { qualifiedType: qualified } : {}) },
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
            // #889: a grouped field declaration names ONE OR MORE fields
            // (`A, B int`), and the grammar's `name` field exposes only the
            // FIRST `field_identifier` — so `childForFieldName("name")`
            // published `A` and silently dropped `B` (and `D`/`E` of
            // `C, D, E string`). The name nodes are collected the same way
            // `extractGoVariables` already collects var/const names, because
            // it is the same rule: a declaration that names N names declares N
            // symbols. GO5's blank-identifier rule applies here too — Go
            // allows `_ int` as a padding field, and `_` is not a declaration.
            const fieldTypeNode = fieldDecl.childForFieldName("type")
            // Declared name NODES (a grouped declaration has several), deduped
            // by SOURCE POSITION rather than object identity: tree-sitter hands
            // out a fresh node wrapper per accessor call, so `includes()` never
            // matches and the first name would be published twice.
            const declaredNameNodes: Node[] = []
            const seenFieldStart = new Set<number>()
            const addDeclaredName = (n: Node | null | undefined) => {
              if (!n) return
              const at = n.startIndex ?? -1
              if (seenFieldStart.has(at)) return
              seenFieldStart.add(at)
              declaredNameNodes.push(n)
            }
            addDeclaredName(fieldDecl.childForFieldName("name"))
            for (let k = 0; k < fieldDecl.namedChildCount; k++) {
              const c = fieldDecl.namedChild(k)
              if (c && c.type === "field_identifier") addDeclaredName(c)
            }
            // Go's own rule (GO5, already applied to var/const): `_` declares
            // nothing. It is a NAME though — `_ bool` is not an embedded field,
            // so the embedded branch below must not fire for it (publishing a
            // field named `bool` was this fixture's first catch).
            const fieldNameNodes = declaredNameNodes.filter((n) => n.text !== "_")
            const hasDeclaredName = declaredNameNodes.length > 0
            // Extract struct tags like `json:"name"` — pure string scan over
            // the raw_string_literal content (backtick-delimited), no regex.
            const tagNode = fieldDecl.childForFieldName("tag")
            let structTags: Record<string, string> = {}
            if (tagNode) {
              const tagText = this.stripRawStringDelimiters(tagNode.text)
              structTags = this.parseStructTags(tagText)
            }

            // Embedded field (`io.Reader`, `*S2`, `T[P]`): no explicit name, but
            // the language still declares a FIELD — named by the type's leaf.
            // Registered rather than silent, and the same leaf rule the
            // embedded-interface path already uses (#889's second surface).
            if (!hasDeclaredName && fieldTypeNode) {
              const embeddedName = this.goEmbeddedFieldName(fieldTypeNode)
              if (embeddedName) {
                symbols.push({
                  name: embeddedName,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(fieldTypeNode),
                  returnType: fieldTypeNode.text,
                  visibility: this.isGoExported(embeddedName) ? "public" : "private",
                  ownerName: structName,
                  ownerKind: ASTEngine.SymbolKind.Struct,
                  metadata: {
                    structTags: getObjectKeysLength(structTags) > 0 ? structTags : undefined,
                    nodeType: fieldDecl.type,
                    isStructField: true,
                    fieldType: fieldTypeNode.text,
                    isExported: this.isGoExported(embeddedName),
                    isEmbeddedField: true,
                    embeddedField: fieldTypeNode.text,
                  },
                })
              }
            }

            for (const fieldNameNode of fieldNameNodes) {
              symbols.push({
                name: fieldNameNode.text,
                kind: ASTEngine.SymbolKind.Property,
                // The FIELD's own span, not the whole declaration: `A, B int`
                // names two fields at two positions, and a consumer that jumps
                // to `B` must land on `B` (#919's range rule).
                range: this.nodeToRange(fieldNameNode),
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
                  // #889: this field shares its declaration with others
                  groupedFieldDeclaration: fieldNameNodes.length > 1,
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
   * The NAME an embedded field declares.
   *
   * Go's spec: "A field declared with a type but no explicit field name is
   * called an embedded field ... The unqualified type name acts as the field
   * name." So `io.Reader` declares a field `Reader`, `*S2` declares `S2`, and
   * `T[P]` declares `T` — the same LEAF rule the embedded-INTERFACE path in
   * `extractInterfaceMethods` already applies. Wrappers are transparent; only
   * the leaf names the field.
   */
  private goEmbeddedFieldName(typeNode: Node): string | undefined {
    let cur: Node | undefined = typeNode
    for (let guard = 0; guard < 8 && cur; guard++) {
      const t = cur.type
      if (t === "pointer_type") {
        cur = (cur.namedChildCount > 0 ? cur.namedChild(0) : undefined) ?? undefined
        continue
      }
      if (t === "generic_type") {
        cur = (cur.namedChildCount > 0 ? cur.namedChild(0) : undefined) ?? undefined
        continue
      }
      break
    }
    if (!cur) return undefined
    if (cur.type !== "type_identifier" && cur.type !== "qualified_type") return undefined
    const raw = cur.text
    const dot = raw.lastIndexOf(".")
    const leaf = dot !== -1 ? raw.slice(dot + 1) : raw
    // A dot-imported external type still names its own leaf; a leaf that is not
    // an identifier (a qualified type with generics, an error-recovered node)
    // names nothing honest, so it contributes no symbol.
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(leaf) ? leaf : undefined
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
      // GO2 (go review): union/tilde constraint members (`int | string`,
      // `~int`) are NOT embedded interfaces — the old code minted Interface
      // symbols named `~int | ~string` and extends edges to the whole
      // operator text. Only plain type references embed; the rest stay
      // silent (union members as individuals is a wave of its own).
      if (method?.type === "constraint_elem") {
        const embeddedNode = method.namedChildCount > 0 ? method.namedChild(0) : undefined
        if (
          embeddedNode &&
          (embeddedNode.type === "type_identifier" || embeddedNode.type === "qualified_type")
        ) {
          const rawText = embeddedNode.text
          const leaf = rawText.lastIndexOf(".") !== -1 ? rawText.slice(rawText.lastIndexOf(".") + 1) : rawText
          if (leaf && this.isPlainGoIdentifier(leaf)) {
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
          // GO5 (go review): blank `_` is not a declaration — `var _ = f()`
          // minted a "_" Variable symbol. The grammar types it `identifier`.
          if (c && c.type === "identifier" && c.text !== "_") nameNodes.push(c)
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

  /** GO3: file has a dot-import (`import . "fmt"`) — bare identifiers may
   *  name dot-imported package members, which no local symbol can resolve.
   *  Calls resolve leniently (documented); bare READS stay strict. */
  private hasGoDotImport(rootNode: Node): boolean {
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "import_spec") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "dot") return true
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return false
  }

  /** GO1: identifiers under a qualified_type (`pkg.Foo`) name types, never
   *  values — the composite-literal and declared-type passes own those. */
  private hasGoQualifiedAncestor(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "qualified_type") return true
      if (
        cur.type === "call_expression" || cur.type === "field_declaration" ||
        cur.type === "function_declaration" || cur.type === "method_declaration" ||
        cur.type === "block" || cur.type === "composite_literal" ||
        cur.type === "var_spec" || cur.type === "const_spec" ||
        cur.type === "short_var_declaration" || cur.type === "assignment_statement"
      ) return false
      cur = cur.parent
    }
    return false
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
    let actualTypeName = isPointer ? typeName.substring(1) : typeName
    // Generic receivers (`func (m MapLattice[Key, Elem, L]) Ident() ...`)
    // carry their type ARGUMENTS — strip them so the method owner resolves to
    // the declared type name (`MapLattice`), or the receiverType never matches
    // the type_spec name and generic types can never be interface-checked
    // (M37 #604: go-tools MapLattice methods were orphaned). The oracle's
    // deriveGoImplements strips `<.*$` the same way.
    const lt = actualTypeName.indexOf("[")
    if (lt > 0) actualTypeName = actualTypeName.slice(0, lt)

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
        // GO20 (#914): a variadic parameter keeps its variadic-ness in the
        // payload (`args ...T`) — `type` stays the ELEMENT type (the pinned
        // payload contract), and `isVariadic` carries the marker so the
        // signature compare can render `...T`. Without it `Logf(format
        // string, args ...any)` compared EQUAL to `Logf(format string, args
        // []any)` — a duck-typing check Go would refuse.
        const isVariadic = param.type === "variadic_parameter_declaration"
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
              ...(isVariadic ? { isVariadic: true } : {}),
            })
          }
        } else if (typeNode) {
          parameters.push({
            name: `arg${parameters.length}`,
            type: typeNode?.text,
            isOptional: false, // Go doesn't have optional parameters
            ...(isVariadic ? { isVariadic: true } : {}),
          })
        }
      }
    }

    return parameters
  }

  private extractGoReturnType(node: Node): string | undefined {
    const resultNode = node.childForFieldName("result")
    if (resultNode) {
      // Named-result parameter_list (`(result any, err error)`) must reduce
      // to its TYPES, or an interface method that names its results
      // (`Handle(...) (result any, err error)`) can never textually match an
      // implementation that does not (`Handle(...) (any, error)`) — silently
      // dropping real implements edges (M37 #604 go-tools: defaultHandler,
      // jsonrpc2 Handler/Preempter). Canonical form: `T` for a single
      // result, `(T1, T2)` for several.
      if (resultNode.type === "parameter_list") {
        const types: string[] = []
        for (let i = 0; i < resultNode.namedChildCount; i++) {
          const p = resultNode.namedChild(i)
          if (!p || p.type !== "parameter_declaration") continue
          const t = p.childForFieldName("type")
          if (!t) continue
          // `a, b int` is ONE declaration naming TWO results of type int.
          let names = 0
          for (let j = 0; j < p.namedChildCount; j++) {
            const c = p.namedChild(j)
            if (c && c.type === "identifier") names++
          }
          for (let k = 0; k < Math.max(1, names); k++) types.push(t.text)
        }
        if (types.length === 1) return types[0]
        if (types.length > 1) return `(${types.join(", ")})`
        return resultNode.text
      }
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

  /**
   * M59.A7 (#825): the 1-based line of a syntax node, or `undefined` when the
   * node is absent. Never 0 — a site that cannot be named is OMITTED from the
   * edge (the #820 rule), so a reader can tell "no line" from "line 1".
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

  /**
   * M59.A7 (#825): the node that NAMES a call. A `selector_expression` starts at
   * its RECEIVER, and a receiver-continued chain is valid Go — `.` does not
   * insert a semicolon, so `builder.` + newline + `Reset()` parses — which makes
   * the selector's own start the wrong site exactly as the c lane measured on a
   * newline-continued function-pointer call. The `field` child is the leaf the
   * edge's target is built from, so it is the leaf that carries the line.
   */
  private goCalleeNameNode(funcNode: Node | null | undefined): Node | undefined {
    if (!funcNode) return undefined
    if (funcNode.type === "selector_expression") {
      return funcNode.childForFieldName("field") ?? funcNode
    }
    return funcNode
  }

  /**
   * M59.A7 (#825): the callee leaf of a STATEMENT-level call — `defer`/`go`
   * statements. The statement starts at its keyword (and `defer` does not insert
   * a semicolon, so `defer` + newline + `cleanup()` is valid Go), so the keyword
   * is not where the target is named.
   */
  private goStatementCalleeNode(node: Node): Node | undefined {
    const callExpr = this.findChildByType(node, "call_expression")
    return callExpr ? this.goCalleeNameNode(callExpr.childForFieldName("function")) : undefined
  }

  private findGoFunctionCalls(functionNode: Node): string[] {
    const calls: string[] = []
    const sites = new Map<string, Node>()
    const seen = new Set<string>()

    const bodyNode = functionNode.childForFieldName("body")
    if (bodyNode) {
      const stack = [bodyNode]
      while (stack.length > 0) {
        const node = stack.pop()!
        if (node.type === "call_expression") {
          const funcNode = node.childForFieldName("function")
          if (funcNode) {
            const callExpression = this.buildGoCallExpression(funcNode)
            // Dedupe per symbol (M37 #604 wave-3, GOD9): the #383 rust lesson
            // — qualified_calls is a UNIQUE set of callee paths per function;
            // the pre-fix list pushed one row per CALL SITE, so a function
            // calling fmt.Println at 5 sites carried 5 identical entries
            // (29,463 excess rows across go-tools+terraform, 4,719 symbols).
            if (callExpression && !this.isGoBuiltin(callExpression) && !seen.has(callExpression)) {
              seen.add(callExpression)
              calls.push(callExpression)
              // The callee's LEAF is the naming node the edge's line comes
              // from, not the selector (which starts at its receiver). The
              // first site wins, exactly like the dedup above keeps the first
              // occurrence.
              sites.set(callExpression, this.goCalleeNameNode(funcNode) ?? funcNode)
            }
          }
        }
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push(child)
        }
      }
    }

    this.goCallSites.set(functionNode.startIndex, sites)
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
    // GO13 (second review): match the CALLEE LEAF, never the receiver. The
    // old first-segment test dropped every qualified call on a
    // builtin-named package (`copy.DeepCopyValue(x)` from
    // terraform/internal/copy never emitted — lane MISSING), while the
    // oracle filters by resolved leaf. Leaf semantics keeps every other
    // call site identical (they already pass leaves or pop() explicitly)
    // and preserves the deliberate `v.len()` method/builtin rule.
    const segs = call.split(".")
    return inArray(builtins, segs[segs.length - 1])
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
   * GO3: with a dot-import in the file, bare names may be dot-imported
   * members — resolve leniently (besides builtins, filtered by callers).
   */
  private isGoResolvableCallTarget(target: string | undefined, symbols: ASTEngine.UniversalSymbol[], dotImported = false): boolean {
    if (!target) return false
    if (target.indexOf(".") !== -1) return true // qualified -> leaf kept
    if (dotImported) return true
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

    // The pre-fix guards tested `!inArray(patterns, "$1")` — a template
    // leftover literal that never matched, making the dedupe dead code. The
    // pushes were safe only because detectGoPatterns runs once per file; the
    // guards now test the actual pattern name (M37 #604 hygiene).
    if (someSymbol(symbols, (s) => s.metadata?.isInterface)) if (!inArray(patterns, "interfaces")) patterns.push("interfaces")
    if (someSymbol(symbols, (s) => s.metadata?.isStruct)) if (!inArray(patterns, "structs")) patterns.push("structs")


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

    // 3.6. Composite-literal construction (`Foo{...}`, `&Foo{...}`,
    // `pkg.Foo{...}`) — Go's primary construction syntax, which emits NO
    // instantiates today (M37 #604: 65,843 composite literals across
    // go-tools+terraform with zero construction edges; rust emits
    // instantiates for `Foo { ... }` struct literals, csharp for `new Foo()`
    // — family parity). Source = containing fn/method ("global" at package
    // scope), target = the literal's type leaf. Slice/map/array literals and
    // elided element types (no type child) are skipped.
    this.analyzeGoCompositeLiteralConstruction(rootNode, relationships)

    // 4. Analyze Go-specific patterns (channels, goroutines, defer)
    this.analyzeGoSpecificPatterns(rootNode, relationships, symbols)

    // 5. Analyze selector expression Uses (field access)
    this.analyzeGoSelectorUses(rootNode, relationships, symbols)

    // 5.5. Bare-identifier value reads (GO1). The analyzer previously
    // emitted NO bare-identifier edges at all (`return G` produced zero
    // relationships) while call args, index/key operands, range values and
    // return operands all read file-visible values. C-family discipline
    // with lexical scope stack (params/receiver/locals bind, shadowing
    // suppresses) and resolvability required (package-scope vars/consts/
    // funcs only — dot-imported names stay silent, recorded limitation).
    this.analyzeGoBareIdentifierUses(rootNode, relationships, symbols)

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
          // M59.A7 (#825): the member's own declaration line (its name node, so
          // a wrapped declaration reports where the name is written).
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
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
          const nameNode = typeSpec.childForFieldName("name")
          const typeName = nameNode?.text
          if (!typeName) continue
          // (a) Struct embedding = anonymous-field composition with method
          // promotion — family contract (Java/C++/Swift/ObjC): ONE extends
          // edge, no contains twin. The embedded type is a member via the
          // ownerName contains pass below, and field-type dependency edges
          // are NOT emitted (Rust M12.18 contract — fields get contains
          // only, no dangling type-text targets).
          const structSpec = this.findChildByType(typeSpec, "struct_type")
          if (structSpec) {
            const embeddedTypeNodes = this.extractGoEmbeddedTypeNodes(structSpec)
            forEachSymbol(embeddedTypeNodes, (embeddedType) => {
              // R10 (#889 round): the target is the embedded type's LEAF, the
              // same rule the interface branch below applies and the same way
              // this lane spells every other name surface (its own
              // embedded-interface member symbol is `Closer`, `contains`/
              // `references`/`uses` all resolve to leaves). Publishing RAW
              // source text (`io.Reader`, or `Pair[int, string]` for an
              // embedded generic instantiation) made one relationship kind
              // spell the same type two ways inside one file, and it is what
              // put `extends|.` in the lane's unruled separator vocabulary. A
              // local leaf still resolves; an external one stays a
              // dangling-but-real target, exactly like `io.Closer` in the
              // interface branch. The raw spelling is KEPT in metadata.
              const rawEmbedded = String(embeddedType.text)
              const embedLeaf = this.goEmbeddedFieldName(embeddedType)
              if (!embedLeaf) return
              relationships.push({
                source: typeName,
                target: embedLeaf,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 0.8,
                // M59.A7 (#825): the EMBEDDED TYPE's line — the site the
                // embedded declaration is written on.
                ...(this.nodeLine(embeddedType) ? { line_number: this.nodeLine(embeddedType)! } : {}),
                metadata: {
                  relationshipType: "go_struct_embedding",
                  isEmbedding: true,
                  isAnonymous: true,
                  embedType: "struct_composition_extends",
                  embeddedStruct: rawEmbedded,
                },
              })
            })
          }
          // (b) Interface embedding (`interface { Reader; io.Closer }`) is
          // Go's interface inheritance — the family contract (java interface
          // extends interface, rust trait supertrait) gives an EXTENDS edge,
          // exactly like struct embedding. GOD4/M37 #604: the pre-fix analyzer
          // emitted only a member-symbol contains for embedded interfaces, so
          // the embedding relationship never appeared as extends (measured
          // 156 embedding sites across go-tools+terraform). Target is the
          // LEAF (`Reader`, `Closer`) so a local declaration resolves; an
          // external `io.Closer` keeps its leaf as a dangling-but-real target
          // (rust pins external supertrait leaves the same way).
          const interfaceSpec = this.findChildByType(typeSpec, "interface_type")
          if (interfaceSpec) {
            for (let j = 0; j < interfaceSpec.namedChildCount; j++) {
              const elem = interfaceSpec.namedChild(j)
              if (!elem || elem.type !== "constraint_elem") continue
              const inner = elem.namedChildCount > 0 ? elem.namedChild(0) : undefined
              if (!inner) continue
              // GO2: union/tilde members (`int | string`, `~int`) are not
              // embedded interfaces — only plain type references extend.
              if (inner.type !== "type_identifier" && inner.type !== "qualified_type") continue
              const raw = inner.text
              const leaf = raw.lastIndexOf(".") !== -1 ? raw.slice(raw.lastIndexOf(".") + 1) : raw
              if (!leaf || !this.isPlainGoIdentifier(leaf)) continue
              relationships.push({
                source: typeName,
                target: leaf,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 0.8,
                // M59.A7 (#825): the embedded interface reference's own line.
                ...(this.nodeLine(inner) ? { line_number: this.nodeLine(inner)! } : {}),
                metadata: {
                  relationshipType: "go_interface_embedding",
                  isEmbedding: true,
                  isAnonymous: true,
                  embedType: "interface_inheritance_extends",
                  embeddedInterface: raw,
                },
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
    // Get all interfaces and their methods. Implementor candidates are ALL
    // declared non-interface types with receivers — structs AND named
    // non-struct types (`type HandlerFunc func(...)`, `type subcommands
    // []command`) can carry methods in Go and therefore satisfy interfaces
    // (M37 #604 go-tools: HandlerFunc/PreempterFunc/subcommands implements
    // were silently missed because only isStruct symbols were checked). The
    // method sets below filter by receiverType anyway, so extra candidates
    // with no methods contribute nothing.
    const interfaces = filterSymbols(symbols, (s) => s.metadata?.isInterface)
    const structs = filterSymbols(
      symbols,
      (s) =>
        (s.kind === ASTEngine.SymbolKind.Struct || s.kind === ASTEngine.SymbolKind.Type) &&
        !s.metadata?.isInterface,
    )
    const methods = filterSymbols(symbols, (s) => s.kind === ASTEngine.SymbolKind.Method)

    // GO20 (#914): the implementor candidates are the file's RECEIVER TYPE
    // NAMES, not merely the types DECLARED in it. Go's method set is a
    // PACKAGE-level property: `func (s *clientDispatcher) LogTrace(...)` in
    // tsclient.go says everything this file knows about `clientDispatcher`
    // (gopls declares the struct in protocol.go, a different file) and all 21
    // of Client's methods are declared right here, so the pair is provable
    // from this file's own evidence. Requiring a same-file `type` declaration
    // silently dropped every such row. The differential oracle has always
    // keyed its implementor map by receiver name, so this removes an
    // asymmetry rather than creating one — mirrored exactly: no generics skip
    // is possible for a name with no declaration in the file, and no
    // promotion is possible for a type whose embedding is declared elsewhere.
    const declaredTypeNames = new Set<string>()
    for (const s of symbols) {
      if (
        s.kind === ASTEngine.SymbolKind.Struct ||
        s.kind === ASTEngine.SymbolKind.Class ||
        s.kind === ASTEngine.SymbolKind.Interface ||
        s.kind === ASTEngine.SymbolKind.Type
      ) {
        declaredTypeNames.add(s.name)
      }
    }
    const candidates: Array<{ name: string; hasGenerics: boolean }> = mapSymbols(structs, (s) => ({
      name: s.name,
      hasGenerics: !!s.metadata?.hasGenerics,
    }))
    for (const m of methods) {
      const receiverType = m.metadata?.receiverType || m.metadata?.receiver?.typeName
      if (typeof receiverType !== "string" || !receiverType) continue
      if (declaredTypeNames.has(receiverType)) continue
      if (someSymbol(candidates, (c) => c.name === receiverType)) continue
      candidates.push({ name: receiverType, hasGenerics: false })
    }

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
      // Generic-instantiation guard (M37 #604): neither a generic interface
      // (`Semilattice[Elem]`) nor a generic implementor (`MapLattice[K, E,
      // L]`) can be verified textually — satisfaction requires type
      // UNIFICATION over instantiations (Elem := map[Key]Elem), which no
      // signature comparison can decide. Both this analyzer and the oracle
      // refuse rather than guess (the differential stays symmetric).
      if (interfaceSymbol.metadata?.hasGenerics) return
      const interfaceMethods = this.getGoInterfaceMethods(interfaceSymbol, symbols)

      forEachSymbol(candidates, (candidate) => {
        if (candidate.hasGenerics) return
        const structName = candidate.name
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
            source: structName,
            target: interfaceSymbol.name,
            type: ASTEngine.RelationshipType.Implements,
            confidence: valueImpl.confidence,
            // M59.A7 (#825): the interface declaration's own line — the site
            // that NAMES the target (the struct's line would name the source).
            ...(interfaceSymbol.range?.startLine ? { line_number: interfaceSymbol.range.startLine } : {}),
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
            source: structName,
            target: interfaceSymbol.name,
            type: ASTEngine.RelationshipType.Implements,
            confidence: pointerImpl.confidence,
            ...(interfaceSymbol.range?.startLine ? { line_number: interfaceSymbol.range.startLine } : {}),
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

    // GO3: dot-import leniency for bare callees (mirrored by the oracle).
    const dotImported = this.hasGoDotImport(rootNode)
    forEachSymbol(functions, (func) => {
      const qualifiedCalls = func.qualified_calls || []
      // M59.A7 (#825): the callee leaf recorded by findGoFunctionCalls, keyed by
      // the enclosing symbol's startIndex (file-local, so it cannot collide).
      const callSites = this.goCallSites.get(func.range?.startIndex ?? -1)
      forEachSymbol(qualifiedCalls, (call) => {
        const callLine = this.nodeLine(callSites?.get(call))
        // Handle package-qualified calls (package.Function) — leaf target
        const targetFunction = this.resolveGoFunctionCall(call, symbols, dotImported)
        // Builtin-leaf guard (deep-review 2026-08-29, go-tools @200): the
        // oracle filters Go builtins by RESOLVED leaf name. findGoFunctionCalls
        // checks the FULL call text (`v.len` -> prefix `v`), so a method call
        // like `v.len()` on a receiver whose leaf collides with a builtin
        // (`len`) slips through and emits a fabricated `calls len`. Skip any
        // call edge whose resolved target is a Go builtin, mirroring the
        // differential oracle exactly.
        if (targetFunction && this.isGoBuiltin(targetFunction)) {
          return
        }
        if (targetFunction) {
          relationships.push({
            source: func.name,
            target: targetFunction,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.8,
            ...(callLine ? { line_number: callLine } : {}),
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
              ...(callLine ? { line_number: callLine } : {}),
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
    // GO3: dot-import leniency for bare package-scope callees (mirrored).
    const dotImported = this.hasGoDotImport(rootNode)
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
          if (!leaf) {
            // #799 round: an UNNAMEABLE callee is not a reason to abandon the
            // subtree. resolveGoCallLeaf returns undefined for parenthesized,
            // index/generic-instantiation and PARSE-RECOVERY callees; the old
            // `continue` therefore pruned real code nested under debris. The
            // measured case (go-tools @full extent, the two `calls` MISSING
            // rows of slicesbackward.go): the pinned grammar's error recovery
            // wraps `func indexExprMethodCall(s []sync.Mutex) {...}` in
            // `call_expression` chains whose callee is another call_expression,
            // so `s[i].Lock()` / `s[i].Unlock()` were never reached while
            // `s[i].String()` twelve lines later was — the difference was
            // recovery luck, not source. No edge is claimed here (an unnamed
            // callee names no target); the walk descends, exactly like the
            // oracle's flat DFS, so nested real calls are found and nested
            // debris is judged by the same rules everywhere in the file.
            for (let i = node.namedChildCount - 1; i >= 0; i--) {
              const child = node.namedChild(i)
              if (child) stack.push(child)
            }
            continue
          }
          const qualified = fn.type === "selector_expression"
          const isCtor = leaf[0] === leaf[0].toUpperCase() && leaf[0] !== leaf[0].toLowerCase()
          const emit = !this.isGoBuiltin(leaf) && (qualified || dotImported || declared.has(leaf) || (isCtor && declared.has(leaf)))
          if (emit && !emitted.has("call:" + leaf)) {
            emitted.add("call:" + leaf)
            relationships.push({
              source: "global",
              target: leaf,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              // M59.A7 (#825): the package-scope walk holds the callee node
              // directly — its LEAF's line, not the statement's.
              ...(this.nodeLine(this.goCalleeNameNode(fn)) ? { line_number: this.nodeLine(this.goCalleeNameNode(fn))! } : {}),
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
              ...(this.nodeLine(this.goCalleeNameNode(fn)) ? { line_number: this.nodeLine(this.goCalleeNameNode(fn))! } : {}),
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
  /**
   * Go composite-literal construction analysis. `Foo{...}`, `&Foo{...}` and
   * `pkg.Foo{...}` are Go's primary construction syntax — but before M37
   * #604 instantiates fired ONLY for NewXxx constructor calls, so struct
   * construction by literal was invisible to the graph (65,843 composite
   * literals across go-tools+terraform with zero construction edges). Rust
   * emits instantiates for struct literals (`Foo { ... }`), csharp for
   * `new Foo()` — this is family parity, not a new edge kind. Target is the
   * literal's type LEAF (dotted pkg.Foo -> Foo, matching the calls leaf
   * contract); source is the containing fn/method or "global" at package
   * scope. Slice/map/array literals carry a wrapper type child (not a named
   * type) and elided element literals have no type child — both are skipped
   * naturally by the type-child gate below.
   */
  private analyzeGoCompositeLiteralConstruction(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]) {
    const stack: Node[] = [rootNode]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const node = stack.pop()!
      // A GRAMMAR error region is not evidence of a construction. The pinned
      // tree-sitter-go errors on two legal constructs — a package-scope generic
      // function VALUE (`var _ = slices.Backward[[]int]`) and a method whose
      // receiver is an instantiated generic type (`func (Either[A, B]) A() A`)
      // — and error RECOVERY re-reads the following declaration's text as a
      // composite literal: for `func caller(s []int) {` it produced
      // `composite_literal "s []int) { _ = s }"` and this pass published
      // `instantiates -> s`, i.e. a construction edge to a NAME the source
      // never constructs (and named after a parameter). The oracle mirrored the
      // same fabrication from the same broken tree, so the differential agreed
      // with it. Neither side derives construction from an ERROR subtree now.
      if (node.type === "ERROR" || node.isMissing) continue
      // Package-scope stored-closure contract (mirrors
      // analyzeGoPackageScopeCalls and the oracle): a func_literal that is
      // NOT immediately invoked AND has no enclosing function/method is a
      // stored package template (`var factory = func(){ &Result{} }`) that
      // does not statically run at init — composite literals inside it are
      // not statically construction. Local closures inside bodies keep the
      // enclosing fn as source (findContainingGoFunction succeeds).
      if (
        node.type === "func_literal" &&
        node.parent?.type !== "call_expression" &&
        !this.findContainingGoFunction(node)
      ) {
        continue
      }
      if (node.type === "composite_literal") {
        const typeNode = node.childForFieldName("type") ?? (node.namedChildCount > 0 ? node.namedChild(0) : undefined)
        let target: string | undefined
        if (typeNode) {
          if (typeNode.type === "type_identifier") {
            target = typeNode.text
          } else if (typeNode.type === "qualified_type") {
            const raw = typeNode.text
            const dot = raw.lastIndexOf(".")
            target = dot !== -1 ? raw.slice(dot + 1) : raw
          } else if (typeNode.type === "generic_type") {
            // GO8 (go review): generic composite literals (`Box[int]{...}`)
            // carry a generic_type child — the constructed type is its base
            // type_identifier. Previously no edge at all.
            const base = typeNode.namedChildCount > 0 ? typeNode.namedChild(0) : undefined
            if (base && (base.type === "type_identifier" || base.type === "qualified_type")) {
              const raw = base.text
              const dot = raw.lastIndexOf(".")
              target = dot !== -1 ? raw.slice(dot + 1) : raw
            }
          }
        }
        // Elided element literal (`[]Foo{{...}}`) and wrapper-type literals
        // (map/slice/array/function) yield no named target. Builtin-guard:
        // composite literals cannot target builtins directly.
        if (target && !this.isGoBuiltin(target)) {
          const src = this.findContainingGoFunction(node) || "global"
          const key = `${src}.${target}`
          if (!seen.has(key)) {
            seen.add(key)
            relationships.push({
              source: src,
              target,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.8,
              // M59.A7 (#825): the constructed TYPE's line.
              ...(this.nodeLine(typeNode) ? { line_number: this.nodeLine(typeNode)! } : {}),
              metadata: { relationshipType: "go_composite_literal_construction", isConstructor: true },
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
    // GO3: dot-import leniency for goroutine/defer callees.
    const dotImported = this.hasGoDotImport(rootNode)
    // Dedup against calls edges already emitted by analyzeGoFunctionCalls
    // (qualified_calls includes call_expressions inside go/defer bodies) —
    // goroutine/defer spawns are calls, one edge per (source, target) pair.
    const emittedCalls = new Set<string>()
    for (const r of relationships) {
      if ((r.type || r.relationshipType || "") === ASTEngine.RelationshipType.Calls) {
        emittedCalls.add(`${r.source}->${r.target}`)
      }
    }
    // Channel-op dedup (GOD8): one row per (fn, channel, direction).
    const emittedChannelUses = new Set<string>()

    const stack = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "go_statement") {
        const functionCall = this.extractGoRoutineFunction(node)
        // Drop unresolvable bare closure-var goroutines (see
        // isGoResolvableCallTarget): `go done()` where done is a local func
        // var is not a static call to a declared symbol.
        if (functionCall && this.isGoResolvableCallTarget(functionCall, symbols, dotImported)) {
          // GO3: dot-import leniency must not resurrect builtins (`go len()`
          // is nonsense) — builtins stay excluded on both sides.
          if (this.isGoBuiltin(functionCall.split(".").pop() ?? functionCall)) {
            continue
          }
          const containingFunction = this.findContainingGoFunction(node)
          if (containingFunction && !emittedCalls.has(`${containingFunction}->${functionCall}`)) {
            emittedCalls.add(`${containingFunction}->${functionCall}`)
            relationships.push({
              source: containingFunction,
              target: functionCall,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              // M59.A7 (#825): the callee leaf of the `go` statement.
              ...(this.nodeLine(this.goStatementCalleeNode(node)) ? { line_number: this.nodeLine(this.goStatementCalleeNode(node))! } : {}),
              metadata: {
                relationshipType: "go_goroutine",
                isAsynchronous: true,
                pattern: "goroutine_spawn",
              },
            })
          }
        }
      }

      // Channel send/receive/select ops (M37 #604 wave-3 ruling GOD8): emit
      // a DEDUPED uses edge to the channel target with send/receive
      // direction, and ONLY when the operand resolves to a DECLARED channel:
      // a bare package-scope var/const OR a member selector (leaf = field
      // name). The pre-fix handler pushed the raw operand text with no
      // dedup, fabricating 79 duplicate rows and garbage targets at corpus
      // scale: member channels (`h.jobs <- v`) as dotted `h.jobs`, method-
      // result channels (`<-ctx.Done()`) as `ctx.Done()`, and bare
      // LOCAL/param channels (`c <- v`) as `c` — LocalsAreNotSymbols, so a
      // local name is not a valid relationship target (same resolvability
      // gate the goroutine/defer branches apply via
      // isGoResolvableCallTarget). Measured go-tools+terraform 3,924 files:
      // 156 selector / 160 bare / 169 call operands, of which only 27 bare
      // identifiers name a package-scope var.
      //
      // Parse shapes (probe-verified 2026-09): a select/communication_case
      // WRAPS its inner send_statement/receive_statement (case <-c: is
      // communication_case > receive_statement > unary_expression), so
      // handling send_statement/receive_statement/unary-receive alone covers
      // select cases — no separate communication_case branch (the pre-fix
      // double-counted via both). Dedup per (fn, channel, direction) so two
      // sends on one channel collapse to one row.
      if (node.type === "send_statement" || node.type === "receive_statement" || this.isGoReceiveExpression(node)) {
        const channelVar = this.extractGoChannelVariable(node)
        const containingFunction = this.findContainingGoFunction(node)
        if (channelVar && containingFunction && (channelVar.member || this.isGoDeclaredPackageVar(channelVar.name, symbols))) {
          const isSend = node.type === "send_statement"
          const key = `${containingFunction}->${channelVar.name}->${isSend ? "send" : "receive"}`
          if (!emittedChannelUses.has(key)) {
            emittedChannelUses.add(key)
            relationships.push({
              source: containingFunction,
              target: channelVar.name,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.8,
              // M59.A7 (#825): the send/receive statement's line.
              ...(this.nodeLine(node) ? { line_number: this.nodeLine(node)! } : {}),
              metadata: {
                relationshipType: "go_channel_operation",
                operationType: isSend ? "send" : "receive",
                pattern: "channel_communication",
              },
            })
          }
        }
      }

      if (node.type === "defer_statement") {
        const deferredFunction = this.extractDeferredFunction(node)
        const containingFunction = this.findContainingGoFunction(node)
        // Drop unresolvable bare closure-var defers (see
        // isGoResolvableCallTarget): `defer release()` where release is a
        // local func var is not a static call to a declared symbol.
        // GO3: builtins stay excluded under dot-import leniency.
        if (deferredFunction && this.isGoResolvableCallTarget(deferredFunction, symbols, dotImported) && !this.isGoBuiltin(deferredFunction.split(".").pop() ?? deferredFunction) && containingFunction && !emittedCalls.has(`${containingFunction}->${deferredFunction}`)) {
          emittedCalls.add(`${containingFunction}->${deferredFunction}`)
          relationships.push({
            source: containingFunction,
            target: deferredFunction,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            // M59.A7 (#825): the callee leaf of the `defer` statement.
            ...(this.nodeLine(this.goStatementCalleeNode(node)) ? { line_number: this.nodeLine(this.goStatementCalleeNode(node))! } : {}),
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
   * GO1: bare-identifier value reads. Every bare `identifier` that names a
   * file-visible VALUE (package-scope var/const/func) is a Uses edge, with:
   * -walked with a lexical scope stack (function/method/func-literal
   *  params+receivers bind at entry; block/short-var/var/range/for/if-init/
   *  select-assign/type-switch-guard bindings bind in walk order, so reads
   *  before any binding still resolve outward — C-family flow discipline);
   * - declaration positions never read (entity names via first-identifier
   *  rule; composite-literal struct keys skipped; labels/package/import
   *  paths/blank `_` excluded);
   * - call callees (span-matched; generic/index wrappers climbed),
   *  member leaves (selector path owns them; objects stay readable),
   *  qualified non-leaves, channel operands (channel pass owns them),
   *  assignment/inc/dec LHS writes, go/defer callees all excluded;
   * - resolvability required: unknown names (std/dot-imported/external)
   *  stay silent — no junk edges.
   */
  private analyzeGoBareIdentifierUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const fileValues = new Set<string>()
    for (const s of symbols) {
      if (
        !s.ownerName &&
        (s.kind === ASTEngine.SymbolKind.Variable ||
          s.kind === ASTEngine.SymbolKind.Constant ||
          s.kind === ASTEngine.SymbolKind.Function)
      ) {
        fileValues.add(s.name)
      }
    }
    const emitted = new Set<string>()
    interface ScopeFrame {
      names: Set<string>
    }
    const scopeStack: ScopeFrame[] = []
    const isShadowed = (name: string): boolean => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeStack[i].names.has(name)) return true
      }
      return false
    }
    // Bind every bare identifier under `node`, except inside nested calls,
    // composite literals and func literals (their identifiers read or
    // belong to inner scopes) and blank `_`.
    const bindNamesUnder = (node: Node, frame: ScopeFrame): void => {
      const walk: Node[] = [node]
      while (walk.length > 0) {
        const m = walk.pop()!
        if (m !== node && (m.type === "call_expression" || m.type === "composite_literal" || m.type === "func_literal")) {
          continue
        }
        if (m.type === "identifier" && m.text !== "_") frame.names.add(m.text)
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) walk.push(c)
        }
      }
    }
    // Parameters (and method receivers): bind the identifiers of each
    // parameter_declaration / variadic_parameter_declaration.
    //
    // GO10 (second review): bind the leading NAME identifiers only, not
    // the whole subtree. Go params are names-first (`a, b int` binds a
    // AND b), so everything before the first type-ish child is a name —
    // but an array length (`a [N]int`) or any type-position identifier is
    // a VALUE read, not a binding (probe: `f(a [N]int)` with file const N
    // suppressed the genuine `return N` read). Types are usually
    // type_identifier-typed (auto-skipped), but array lengths and similar
    // are bare identifiers. Unnamed params (`f(int, string)`) bind nothing.
    const bindParamsOf = (declNode: Node | null, frame: ScopeFrame): void => {
      if (!declNode) return
      const seen: Node[] = [declNode]
      while (seen.length > 0) {
        const m = seen.pop()!
        if (m.type === "parameter_declaration" || m.type === "variadic_parameter_declaration") {
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") {
              if (c.text !== "_") frame.names.add(c.text)
            } else {
              break
            }
          }
          continue
        }
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) seen.push(c)
        }
      }
    }
    // Keyed-element struct keys (`Point{X: y}`) never read; map-literal
    // variable keys are the documented residual (shapes identical).
    //
    // GO11 (second review): the shapes are NOT identical — a keyed element
    // belongs to the nearest composite literal, and that literal's TYPE
    // tells struct keys (field names, never read) from map keys (key
    // EXPRESSIONS, genuinely read: `map[Color]int{Red: 1}` reads Red).
    // Probe-verified missing pair on both... (uses is uncompared for go,
    // so the lane cannot see it — fixtures gate it). Elided inner
    // literals (`[]Point{{X: 1}}`) and non-map literals stay silent
    // (conservative = old behavior).
    const isCompositeKey = (node: Node): boolean => {
      let cur: Node | null = node.parent
      let keyed: Node | null = null
      while (cur) {
        if (cur.type === "keyed_element") {
          const first = cur.namedChildCount > 0 ? cur.namedChild(0) : null
          if (first && node.startIndex >= first.startIndex && node.endIndex <= first.endIndex) {
            keyed = cur
            break
          }
          return false
        }
        if (
          cur.type === "composite_literal" || cur.type === "call_expression" ||
          cur.type === "field_declaration" || cur.type === "function_declaration" ||
          cur.type === "method_declaration" || cur.type === "block"
        ) return false
        cur = cur.parent
      }
      if (!keyed) return false
      cur = keyed.parent
      while (cur) {
        if (cur.type === "composite_literal") {
          for (let i = 0; i < cur.namedChildCount; i++) {
            const c = cur.namedChild(i)
            if (c && c.type === "map_type") return false
          }
          return true
        }
        if (
          cur.type === "call_expression" || cur.type === "field_declaration" ||
          cur.type === "function_declaration" || cur.type === "method_declaration" ||
          cur.type === "block"
        ) return true
        cur = cur.parent
      }
      return true
    }
    // Channel operands belong to the channel-op pass (leaf + direction).
    const isChannelOperand = (node: Node): boolean => {
      let cur: Node | null = node.parent
      let steps = 0
      while (cur && steps < 4) {
        if (cur.type === "send_statement") {
          const ch = cur.childForFieldName("channel")
          return !!ch && node.startIndex >= ch.startIndex && node.endIndex <= ch.endIndex
        }
        if (cur.type === "unary_expression") {
          const op = cur.child(0)
          if (op && op.type === "<-") return true
        }
        if (cur.type === "receive_statement" || cur.type === "communication_case") return true
        if (
          cur.type === "call_expression" || cur.type === "field_declaration" ||
          cur.type === "function_declaration" || cur.type === "method_declaration" ||
          cur.type === "block" || cur.type === "expression_list"
        ) return false
        cur = cur.parent
        steps++
      }
      return false
    }
    const isCallCallee = (node: Node): boolean => {
      let top: Node = node
      let p: Node | null = node.parent
      while (p && (p.type === "index_expression" || p.type === "generic_type")) {
        top = p
        p = p.parent
      }
      if (!p || p.type !== "call_expression") return false
      const fnField = p.childForFieldName("function")
      if (fnField) return fnField.startIndex === top.startIndex && fnField.endIndex >= top.endIndex
      const first = p.namedChild(0)
      return !!first && first.startIndex === top.startIndex && first.endIndex >= top.endIndex
    }
    // GO9 (second review): assignment LHS is a WRITE — but EVERY side of
    // every assignment wraps in expression_list (`a = 1` is
    // assignment > [expression_list[a], expression_list[1]]), so the old
    // direct-parent check never fired and every written name leaked as a
    // use whenever it resolved (probe: `a, b = 1, 2` with no reads at all
    // emitted f->a, f->b). Climb through expression_lists only: landing in
    // the FIRST child subtree of an assignment_statement is a write;
    // stopping anywhere else (index/call/selector/unary = a genuine read
    // like `arr[i]`, `*p`, `s.f`) is not. `=` and `+=` are both writes
    // (family parity with the selector pass, which got this gate in S1).
    // F6 note: go has no `compound_assignment_statement` node — `a += 1`
    // and `a = 1` are both `assignment_statement` (operator is anonymous).
    const isAssignLhsWrite = (node: Node): boolean => {
      let cur: Node | null = node
      let p: Node | null = node.parent
      while (p && p.type === "expression_list") {
        const gp = p.parent
        if (gp && gp.type === "assignment_statement") {
          const lhs = gp.namedChild(0)
          return !!lhs && cur.startIndex >= lhs.startIndex && cur.endIndex <= lhs.endIndex
        }
        cur = p
        p = p.parent
      }
      return false
    }
    const isEntityName = (node: Node): boolean => {
      const p = node.parent
      if (!p) return false
      if (
        p.type === "function_declaration" || p.type === "method_declaration" ||
        p.type === "type_spec" || p.type === "field_declaration" ||
        p.type === "package_clause" || p.type === "label_name"
      ) {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "field_identifier")) {
            return c.startIndex === node.startIndex && c.endIndex === node.endIndex
          }
        }
      }
      // var/const specs: an identifier declares iff it is the first
      // identifier child, or a non-identifier sibling follows it (the
      // type/value section): `var x, y = f()` (x, y declare), `var G int`
      // (G declares), `var x = y` (x declares, y reads).
      if (p.type === "var_spec" || p.type === "const_spec") {
        let seenIdent = false
        let isFirstIdent = false
        let laterNonIdent = false
        let found = false
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") {
            if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) {
              if (!seenIdent) isFirstIdent = true
              found = true
            }
            seenIdent = true
          } else if (found) {
            laterNonIdent = true
          }
        }
        return isFirstIdent || laterNonIdent
      }
      // short_var: names live in the left field (`x, y := ..`).
      if (p.type === "short_var_declaration" || (p.type === "expression_list" && p.parent && p.parent.type === "short_var_declaration")) {
        const decl = p.type === "short_var_declaration" ? p : p.parent
        const left = decl!.childForFieldName("left") ?? decl!.namedChild(0)
        return !!left && node.startIndex >= left.startIndex && node.endIndex <= left.endIndex
      }
      if (
        p.type === "goto_statement" || p.type === "break_statement" ||
        p.type === "continue_statement" || p.type === "labeled_statement"
      ) return true
      return false
    }
    const stack: Array<{ node: Node; exit: boolean; pushed: boolean }> = [{ node: rootNode, exit: false, pushed: false }]
    while (stack.length > 0) {
      const { node, exit, pushed } = stack.pop()!
      if (exit) {
        if (pushed) scopeStack.pop()
        continue
      }
      const t = node.type
      let pushedScope = false
      if (t === "function_declaration" || t === "method_declaration" || t === "func_literal") {
        const frame: ScopeFrame = { names: new Set<string>() }
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (!c) continue
          // GO14 (second review): generic type parameters bind too
          // (`func f[T any]` shadows a file value T — types and values
          // share scope in Go). They parse as parameter_declaration nodes
          // under type_parameter_list, which this loop never visited, so a
          // colliding file value misattributed (probe: `return T` emitted
          // f->T for the const instead of staying silent for the param).
          if (c.type === "parameter_list" || c.type === "type_parameter_list") bindParamsOf(c, frame)
        }
        // Method receivers live in the FIRST parameter_list; the loop above
        // already covers every parameter_list, receiver included.
        scopeStack.push(frame)
        pushedScope = true
      } else if (t === "block") {
        scopeStack.push({ names: new Set<string>() })
        pushedScope = true
      } else if (
        t === "var_spec" || t === "const_spec" || t === "short_var_declaration" ||
        t === "range_clause" || t === "type_switch_statement"
      ) {
        // Bindings mirror the isEntityName declaring rules exactly (same
        // predicate family — a name the gate treats as declaring must bind
        // here, or reads leak; a name it treats as reading must not bind,
        // or genuine uses vanish).
        const top = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null
        if (top) {
          if (t === "range_clause") {
            // All children except the LAST (the ranged-over value) bind.
            for (let i = 0; i < node.namedChildCount - 1; i++) {
              const c = node.namedChild(i)
              if (c) bindNamesUnder(c, top)
            }
          } else if (t === "type_switch_statement") {
            // `switch t := x.(type)` — first-child expression_list binds
            // when a scrutinee follows; bare `switch x.(type)` reads.
            if (node.namedChildCount > 2) {
              const first = node.namedChild(0)
              if (first) bindNamesUnder(first, top)
            }
          } else {
            // var/const/short: bind exactly the declaring occurrences.
            const walk: Node[] = [node]
            while (walk.length > 0) {
              const m = walk.pop()!
              if (m !== node && (m.type === "call_expression" || m.type === "composite_literal" || m.type === "func_literal")) {
                continue
              }
              if (m.type === "identifier" && m.text !== "_" && isEntityName(m)) top.names.add(m.text)
              for (let i = m.namedChildCount - 1; i >= 0; i--) {
                const c = m.namedChild(i)
                if (c) walk.push(c)
              }
            }
          }
        }
      } else if (t === "receive_statement") {
        // `case r := <-ch`: expression_list DIRECT children bind (assigned
        // targets); the `<-` operand reads (channel pass owns it — skipped
        // at emission, never bound here).
        const top = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null
        if (top) {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && c.type === "expression_list") bindNamesUnder(c, top)
          }
        }
      } else if (t === "identifier") {
        const name = node.text
        const p = node.parent
        if (
          name && name !== "_" &&
          !isEntityName(node) &&
          !isCompositeKey(node) &&
          !isChannelOperand(node) &&
          !isCallCallee(node) &&
          // F6 audit: `field_expression` is not a tree-sitter-go type (that is
          // rust's name for the shape `r.cfg` here — go uses
          // `selector_expression`), so the old guard could never fire. It is
          // also not needed: a selector's receiver is a genuine read
          // (`x := db.cfg` reads db — probe-verified `f->cfg f->db`), and a
          // selector that is a call callee is already excluded by
          // isCallCallee above. Removed rather than re-pointed at
          // selector_expression, which would silently drop the receiver read.
          !this.hasGoQualifiedAncestor(node) &&
          // GO9 (second review): assignment LHS is a WRITE — but EVERY
          // side of every assignment wraps in expression_list, so the old
          // direct-parent check never fired (see isAssignLhsWrite above).
          !isAssignLhsWrite(node) &&
          !(p && (p.type === "inc_statement" || p.type === "dec_statement")) &&
          !(p && (p.type === "goto_statement" || p.type === "break_statement" || p.type === "continue_statement" || p.type === "labeled_statement")) &&
          !isShadowed(name) &&
          fileValues.has(name)
        ) {
          const src = this.findContainingGoFunction(node) || "global"
          const key = `${src}::uses::${name}`
          if (!emitted.has(key)) {
            emitted.add(key)
            relationships.push({
              source: src,
              target: name,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              // M59.A7 (#825): the identifier's own line.
              ...(this.nodeLine(node) ? { line_number: this.nodeLine(node)! } : {}),
              metadata: { relationshipType: "identifier_usage", nodeType: node.type },
            })
          }
        }
      }
      stack.push({ node, exit: true, pushed: pushedScope })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, exit: false, pushed: false })
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
        // S1 write-gate (GOD4-class, M37 #604): assignment-LHS and inc/dec
        // operands are WRITES, never read-uses — the family write-gate that
        // cpp/c/php/ruby/python/groovy/objc/ts all enforce and go was missing
        // (measured 204 pure-write selector sites across go-tools+terraform
        // 3,924 files, e.g. `r.cfg = newCfg` emitting `uses apply -> cfg`).
        // tree-sitter-go wraps the LHS in the FIRST expression_list child of
        // an assignment_statement (`=` AND `+=` — the operator is an
        // anonymous token, both are writes per SCD1 family parity); a
        // chained operand selector (`r.cfg` inside `r.cfg.V = v`) is a
        // GENUINE read (fetch the struct to reach V) and keeps its edge.
        // inc_statement/dec_statement operands (`r.cfg.V++`) are writes.
        // Node identity is compared by .id — two wrapper objects for the
        // same tree node are not === (web-tree-sitter wraps per retrieval).
        const isWritePos =
          (node.parent?.type === "inc_statement" || node.parent?.type === "dec_statement") ||
          (node.parent?.type === "expression_list" &&
            node.parent.parent?.type === "assignment_statement" &&
            node.parent.parent?.namedChild(0)?.id === node.parent.id)
        // GOD8: a selector that is a channel SEND/RECEIVE operand
        // (`h.jobs <- v`, `<-h.jobs`) is owned by the channel-op pass in
        // analyzeGoSpecificPatterns (leaf + send/receive direction); the
        // selector pass skips it so member channels get ONE row, not two.
        const isChannelOperand =
          node.parent?.type === "send_statement" ||
          node.parent?.type === "communication_case" ||
          (node.parent?.type === "unary_expression" && node.parent.child(0)?.type === "<-") ||
          (node.parent?.type === "receive_statement" && node.parent.parent?.type === "communication_case")
        if (operand && field && node.parent?.type !== "call_expression" && !isWritePos && !isChannelOperand) {
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
              // M59.A7 (#825): the FIELD identifier's line, not the receiver's —
              // the c lane's receiver-start lesson applied to `a.b`.
              ...(this.nodeLine(field) ? { line_number: this.nodeLine(field)! } : {}),
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

  // GO2: plain-identifier shape check (no regex): letter/underscore head,
  // word-class tail. Recovery-artifact names (qualified, templated,
  // operator-soup like `~int | ~string`) fail and emit no symbol/edge.
  private isPlainGoIdentifier(s: string): boolean {
    if (s.length === 0) return false
    const c0 = s.charCodeAt(0)
    const firstOk = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95
    if (!firstOk) return false
    for (let i = 1; i < s.length; i++) {
      const c = s.charCodeAt(i)
      const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
      if (!ok) return false
    }
    return true
  }

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

  /**
   * Go Cyclomatic Complexity Calculation
   * Calculates complexity for Go code including goroutines, channels, defer, type switches, and Go-specific patterns
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1 // Base complexity

    // SCD10 family parity (M37 #599 pre-wave): ARMS are the decisions,
    // wrappers are not — java counts switch_block_statement_group but not
    // switch_statement; kotlin counts when_entry but not when_expression.
    // The previous counter counted BOTH the wrapper (expression/type/
    // select switch) AND its arms, double-counting every switch, and
    // missed type_case (type-switch arms) entirely. Probe-verified arm
    // node names on the pinned grammar: expression_case, type_case,
    // communication_case, default_case.
    const traverse = (n: Node) => {
      switch (n.type) {
        case "if_statement":
        case "for_statement":
        case "expression_case":
        case "type_case":
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
    return this.extractGoEmbeddedTypeNodes(structNode).map((n) => n.text)
  }

  /**
   * M59.A7 (#825): the node form of extractGoEmbeddedTypes. The extends edge
   * this feeds carries the embedded TYPE's own line, so the walk has to return
   * the node the name is written on, not just its text. One traversal serves
   * both — the text form delegates here, so the two can never disagree.
   */
  private extractGoEmbeddedTypeNodes(structNode: Node): Node[] {
    const embeddedTypes: Node[] = []
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
              embeddedTypes.push(typeNode)
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
    visiting?: Set<string>,
  ): Array<{ name: string; signature: string }> {
    // G12 (go review): cycle guard — `interface A { B }; interface B { A }`
    // (invalid Go, parseable tree) recursed forever → stack overflow. The
    // promoted-methods collector already carries a visiting set; this one
    // did not.
    const seen = visiting ?? new Set<string>()
    if (seen.has(interfaceSymbol.name)) return []
    seen.add(interfaceSymbol.name);
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

      const inherited = this.getGoInterfaceMethods(target, symbols, seen)
      forEachSymbol(inherited, (m) => {
        if (!someSymbol(interfaceMethods, (x) => x.name === m.name && x.signature === m.signature)) {
          interfaceMethods.push(m)
        }
      })
    })

    // GO20 (#914): release the visiting mark on the way OUT, so it is a
    // PATH mark and not a global "seen" set. Left in place (the pre-fix
    // behaviour, mirrored by the oracle) it poisoned DIAMONDS: for
    // `interface A { B; C }` with `B { D }` and `C { D }`, the first branch
    // marked D visited and the second branch's `D` lookup returned NOTHING — so
    // A silently lost D's methods depending on declaration order. The mark is
    // still checked on entry, so the `A { B }; B { A }` cycle guard G12 relies
    // on is unchanged.
    seen.delete(interfaceSymbol.name)

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
    // GO20 (#914): a variadic parameter renders as `...T`. The parameter TYPE
    // is not part of Go's notion of a varying `...T` vs `[]T` — they are
    // DIFFERENT types, and an interface satisfied by one is not satisfied by
    // the other. Normalization keeps it (normalizeGoSignature only drops the
    // space before the dots).
    const params = mapSymbols(method.parameters || [], (p) => (p.isVariadic ? "..." : "") + (p.type || "interface{}")).join(", ") || ""
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
  private resolveGoFunctionCall(callExpression: string, symbols: ASTEngine.UniversalSymbol[], dotImported = false): string | undefined {
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

    // Handle direct function calls. GO3: with a dot-import in the file,
    // bare names may be dot-imported members (besides builtins, filtered
    // by callers) — resolve leniently, mirrored by the oracle.
    if (dotImported) return callExpression || undefined
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
        // M14.0.F1 (#880): `package_clause` declares NO fields in this grammar —
        // the old `childForFieldName("package_identifier")` could never match
        // (it is a node TYPE, not a field) and the named-child fallback carried
        // the value all along. Read the node by type, so the audit's field table
        // and this lookup agree.
        const pkgId = this.findChildByType(child, "package_identifier") ?? child.namedChild(0)
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
  // GOD8 (M37 #604 wave-3): channel-op target resolution. Returns the
  // channel's declared-name LEAF for (a) a bare identifier naming a
  // PACKAGE-scope var/const (caller gates via isGoDeclaredPackageVar) and
  // (b) a member selector (leaf = field name — the channel-op pass owns
  // member channel edges with send/receive direction, so the selector pass
  // skips channel operands). Call results (`<-ctx.Done()`) and bare
  // LOCAL/param channels (`c <- v`) have no declared channel symbol and
  // return undefined (LocalsAreNotSymbols — same resolvability gate the
  // goroutine/defer branches apply via isGoResolvableCallTarget).
  private extractGoChannelVariable(node: Node): { name: string; member: boolean } | undefined {
    const operandNode = (n: Node): Node | undefined => {
      if (n.type === "send_statement") {
        const c = n.childForFieldName("channel")
        return c?.type === "identifier" || c?.type === "selector_expression" ? c : undefined
      }
      // receive_statement wraps a unary `<-` expression; both carry the
      // operand.
      const direct = n.childForFieldName("operand") || (n.namedChildCount > 0 ? n.namedChild(0) : undefined)
      const unwrapped =
        direct && (direct.type === "unary_expression" || direct.type === "receive_statement")
          ? (direct.namedChildCount > 0 ? direct.namedChild(0) : undefined)
          : direct
      return unwrapped?.type === "identifier" || unwrapped?.type === "selector_expression" ? unwrapped : undefined
    }
    if (node.type === "send_statement" || node.type === "receive_statement" || this.isGoReceiveExpression(node)) {
      const op = operandNode(node)
      if (!op) return undefined
      if (op.type === "identifier") return { name: op.text, member: false }
      if (op.type === "selector_expression") {
        const f = op.childForFieldName("field")
        return f ? { name: f.text, member: true } : undefined
      }
    }
    return undefined
  }

  private isGoReceiveExpression(node: Node): boolean {
    return node.type === "unary_expression" && node.child(0)?.type === "<-"
  }

  // GOD8: a bare identifier is a valid channel-op target only when it names a
  // declared PACKAGE-scope var/const (LocalsAreNotSymbols — locals/params
  // never qualify; the same resolvability gate the goroutine/defer branches
  // apply via isGoResolvableCallTarget). Member selectors (member=true) are
  // always valid — the field is a declared member.
  private isGoDeclaredPackageVar(name: string, symbols: ASTEngine.UniversalSymbol[]): boolean {
    return someSymbol(
      symbols,
      (s) =>
        s.name === name &&
        (s.kind === ASTEngine.SymbolKind.Variable || s.kind === ASTEngine.SymbolKind.Constant) &&
        !s.ownerName,
    )
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
      // GO20 (#914): `variadic_parameter_declaration` was rejected outright, so
      // EVERY variadic interface method lost its last parameter and no struct
      // could ever be shown to satisfy it — the analyzer's half of the grpc
      // generated-code rows (`Foo(ctx, in *X, opts ...grpc.CallOption)` lost
      // `opts`, the implementation kept it as a plain param, and the textual
      // signature compare then refused a pair Go accepts). The declared and
      // implemented sides must read the same node set or the compare is not a
      // comparison of signatures at all.
      const isVariadic = param?.type === "variadic_parameter_declaration"
      if (param?.type !== "parameter_declaration" && !isVariadic) continue

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
            ...(isVariadic ? { isVariadic: true } : {}),
          })
        }
      } else if (typeNode) {
        parameters.push({
          name: `arg${parameters.length}`,
          type: typeNode.text,
          isOptional: false,
          ...(isVariadic ? { isVariadic: true } : {}),
        })
      }
    }

    return parameters
  }

  private extractGoMethodSpecReturnType(node: Node): string | undefined {
    const resultNode = node.childForFieldName("result")
    if (resultNode) {
      // Same named-result reduction as extractGoReturnType (M37 #604):
      // interface `Ident() Elem` vs generic-impl canonical types must compare
      // by TYPE only.
      if (resultNode.type === "parameter_list") {
        const types: string[] = []
        for (let i = 0; i < resultNode.namedChildCount; i++) {
          const p = resultNode.namedChild(i)
          if (!p || p.type !== "parameter_declaration") continue
          const t = p.childForFieldName("type")
          if (!t) continue
          let names = 0
          for (let j = 0; j < p.namedChildCount; j++) {
            const c = p.namedChild(j)
            if (c && c.type === "identifier") names++
          }
          for (let k = 0; k < Math.max(1, names); k++) types.push(t.text)
        }
        if (types.length === 1) return types[0]
        if (types.length > 1) return `(${types.join(", ")})`
        return resultNode.text
      }
      return resultNode.text
    }

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
