import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent, type OverrideCompanion } from "./override-context"

// ============================================================================
// M12.21 — SWIFT ANALYZER (Systems family)
// ============================================================================
// Pure-AST extraction (zero regex). Family contract (Java M12.02 / C# M12.07 /
// ObjC M12.19 / Rust M12.18):
//
//   Symbols
//     - protocol_declaration  -> interface (methods -> method)
//     - class_declaration     -> class / struct / enum / actor / extension
//       decided by the grammar's anonymous keyword token (class/struct/enum/
//       actor) or the `extension` keyword token — never source-text scanning
//     - extension             -> extension (name = the EXTENDED type, NO
//       self-owner; members attach to it)
//     - init_declaration      -> constructor named "constructor" (Java/C# name)
//     - deinit / subscript    -> NOT symbols (ObjC dealloc precedent)
//     - functions             -> method when owned by a type, function at
//       file scope (protocol_function_declaration -> method)
//     - type-scope vars       -> property; file-scope vars -> variable
//     - enum_entry            -> enum_member (only inside an enum body —
//       switch cases are never symbols)
//     - typealias / associatedtype -> type
//     - params, locals, closures -> NOT symbols (C# M12.07 negative contract:
//       ParamsAreNotSymbols, LocalsAreNotSymbols, LambdaParamsAreNotSymbols)
//
//   Relationships
//     - contains: REAL ownership only (type -> member). Locals carry no
//       owner, so they emit nothing.
//     - extends:  first inheritance base of class/struct/actor (superclass)
//     - implements: remaining bases (adopted protocols)
//     - calls:    member calls resolve to the LEAF target (`users.first` ->
//       `first`, `[1,2].map` -> `map`); source = enclosing method. Bare
//       builtins (print/String/Int/...) are filtered (C# BuiltinsAreFiltered
//       precedent).
//     - instantiates: bare CAPITALIZED call `User(...)` -> instantiates ONLY
//       (no calls edge — Swift construction syntax, Java `new Foo()` analog)
//     - uses:     ONLY `self.` member reads (Swift's `this`), source = the
//       enclosing TYPE, target = field leaf. Type references emit nothing.
//     - overrides: qualified `Owner.method -> Parent.method`, resolved via
//       the class hierarchy + shared companion index (Java/C# M12.02-03
//       semantics)
//     - references: file-scope imports -> `root -> module` (ObjC M12.19)
// ============================================================================

const MEMBER_OWNER_KINDS = new Set([
  ASTEngine.SymbolKind.Class,
  ASTEngine.SymbolKind.Struct,
  ASTEngine.SymbolKind.Interface,
  ASTEngine.SymbolKind.Enum,
  ASTEngine.SymbolKind.Actor,
  ASTEngine.SymbolKind.Extension,
])

// Bare stdlib calls that carry no semantic edge (C# BuiltinsAreFiltered
// precedent). Member calls like `users.map` are NOT filtered — only bare
// identifier invocations of these names.
const BUILTIN_BARE_CALLS = new Set([
  "print", "debugPrint", "assert", "precondition", "fatalError",
  "String", "Int", "Double", "Float", "Bool", "Array", "Dictionary",
  "Set", "Optional", "Any", "Void", "Character", "Data", "Date",
  // `defer { }` parses as call_expression(simple_identifier "defer", lambda_literal)
  // in the pinned grammar — it is a control keyword, never a real function call.
  "defer",
])

interface OverrideTask {
  fqn: string
  methodName: string
  ownerFqn: string
}

interface WalkFrame {
  node: Node
  parentSymbol: ASTEngine.UniversalSymbol | null
  typeName: string | null
}

export class RealSwiftAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const patternsObj: Record<string, boolean> = {}
    const frameworksObj: Record<string, boolean> = {}

    const metadata: Partial<ASTEngine.FileMetadata> = {
      linesOfCode: 0,
      performanceScore: 100,
      architecturalInsights: [],
      detectedFrameworks: [],
      patterns: [],
    }

    if (!rootNode) return { symbols, imports, relationships, exports, metadata, errors: [] }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          ;(metadata as any).errors = (metadata as any).errors || []
          ;(metadata as any).errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: n.startPosition.row + 1, startColumn: n.startPosition.column + 1,
              endLine: n.endPosition.row + 1, endColumn: n.endPosition.column + 1,
              startIndex: n.startIndex, endIndex: n.endIndex,
            },
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

    // Override-resolution state (Java/C# M12.02-03 machinery).
    const overrideTasks: OverrideTask[] = []
    const classHierarchy = new Map<string, string[]>()
    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()

    const emittedCalls = new Set<string>()
    const emittedUses = new Set<string>()
    const emittedContains = new Set<string>()

    const stack: WalkFrame[] = [
      { node: rootNode, parentSymbol: null, typeName: null },
    ]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node: curr, parentSymbol } = popped
      let newParentSymbol = parentSymbol
      let newTypeName = popped.typeName

      if (curr.type === "import_declaration") {
        this.handleImport(curr, imports, frameworksObj)
      } else if (curr.type === "protocol_declaration") {
        newParentSymbol = this.handleProtocol(curr, symbols, relationships, parentSymbol, patternsObj, classHierarchy)
        if (newParentSymbol) newTypeName = newParentSymbol.name
      } else if (curr.type === "class_declaration") {
        newParentSymbol = this.handleDeclaration(curr, symbols, relationships, parentSymbol, patternsObj, classHierarchy)
        if (newParentSymbol) newTypeName = newParentSymbol.name
      } else if (curr.type === "function_declaration" || curr.type === "protocol_function_declaration") {
        newParentSymbol = this.handleFunction(curr, symbols, relationships, parentSymbol, overrideTasks, context?.overrideCompanion)
      } else if (curr.type === "init_declaration") {
        // init -> constructor named "constructor" (Java/C# family convention)
        const vis = this.getVisibility(curr)
        const meta: Record<string, any> = {}
        const funcAttrs = this.extractAttributes(curr)
        if (funcAttrs.length > 0) meta.annotations = funcAttrs
        const sym = this.createSymbol("constructor", ASTEngine.SymbolKind.Constructor, curr, parentSymbol, symbols, meta, vis)
        this.collectFunctionMeta(curr, meta, sym)
        newParentSymbol = sym
      } else if (curr.type === "deinit_declaration" || curr.type === "subscript_declaration") {
        // Not symbols (ObjC dealloc / C# indexer-not-materialized precedent).
      } else if (
        curr.type === "property_declaration" ||
        curr.type === "protocol_property_declaration"
      ) {
        this.handleVariable(curr, symbols, parentSymbol, newTypeName, frameworksObj, patternsObj)
      } else if (curr.type === "enum_entry") {
        // enum_member ONLY inside an enum body — the parent symbol is the
        // enum. Switch `case` patterns are never symbols.
        if (parentSymbol && parentSymbol.kind === ASTEngine.SymbolKind.Enum) {
          const caseNode = this.firstNamedChild(curr)
          const caseName = caseNode ? caseNode.text : curr.text
          if (caseName && caseName !== "case") {
            this.createSymbol(caseName, ASTEngine.SymbolKind.EnumMember, curr, parentSymbol, symbols, { enumCase: true })
          }
        }
      } else if (curr.type === "typealias_declaration") {
        const nameNode = this.findChildByType(curr, "type_identifier") || this.firstNamedChild(curr)
        if (nameNode && (nameNode.type === "type_identifier" || nameNode.type === "simple_identifier" || nameNode.type === "identifier")) {
          this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Type, curr, parentSymbol, symbols, { isTypeAlias: true })
        }
      } else if (curr.type === "associatedtype_declaration") {
        const nameNode = this.findChildByType(curr, "type_identifier") || this.firstNamedChild(curr)
        if (nameNode && (nameNode.type === "type_identifier" || nameNode.type === "simple_identifier" || nameNode.type === "identifier")) {
          this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Type, curr, parentSymbol, symbols, { isAssociatedType: true })
        }
      } else if (curr.type === "call_expression") {
        this.handleCall(curr, relationships, parentSymbol, emittedCalls)
      } else if (curr.type === "navigation_expression") {
        // `self.x` member READ -> uses (source = enclosing type, target = leaf).
        this.handleSelfUse(curr, relationships, newTypeName, parentSymbol, emittedUses)
      }

      // ---- pattern / metadata flags (unchanged from M11 behavior) ----
      if (curr.type === "where_clause") {
        patternsObj["Generics with Where Clauses"] = true
      } else if (curr.type === "willset_clause" || curr.type === "didset_clause" || curr.type === "willset_didset_block") {
        patternsObj["Property Observers (willSet/didSet)"] = true
      } else if (curr.type === "call_expression" && this.isDeferCall(curr)) {
        patternsObj["Defer (Cleanup)"] = true
      } else if (curr.type === "do_statement") {
        patternsObj["Do-Catch Blocks"] = true
      } else if (curr.type === "getter_specifier" || curr.type === "setter_specifier") {
        patternsObj["Computed Properties"] = true
      } else if (curr.type === "availability_condition") {
        patternsObj["Platform Availability Checks"] = true
      } else if (curr.type === "macro_declaration") {
        patternsObj["Swift Macros"] = true
      } else if (curr.type === "lambda_literal") {
        patternsObj["Closures"] = true
      }
      if (
        curr.type === "try_operator" ||
        curr.type === "catch_block" ||
        (curr.type === "control_transfer_statement" && this.hasChildType(curr, "throw_keyword"))
      ) {
        patternsObj["Error Handling"] = true
      }
      if (curr.type === "await_expression" || curr.type === "async") {
        patternsObj["Async/Await"] = true
      }
      if (
        curr.type === "optional_type" ||
        curr.type === "guard_statement" ||
        (curr.type === "navigation_expression" && this.hasAnonToken(curr, "?")) ||
        ((curr.type === "if_statement" || curr.type === "while_statement") && this.hasChildType(curr, "value_binding_pattern"))
      ) {
        patternsObj["Optional Handling"] = true
      }
      if (curr.type === "type_parameters") {
        patternsObj["Generics"] = true
      }
      if (curr.type === "if_statement" || curr.type === "for_statement" || curr.type === "while_statement" || curr.type === "repeat_while_statement" || curr.type === "switch_statement") {
        if (!metadata.cyclomaticComplexity) metadata.cyclomaticComplexity = 1
        metadata.cyclomaticComplexity++
      }
      if (curr.type === "modifiers") {
        for (let i = 0; i < curr.namedChildCount; i++) {
          const mod = curr.namedChild(i)
          if (!mod) continue
          if (mod.type === "ownership_modifier")
            patternsObj["ARC Memory Management"] = true
          if (mod.type === "property_behavior_modifier" || mod.text === "lazy")
            patternsObj["Lazy Initialization"] = true
          if (mod.type === "inheritance_modifier" || mod.text === "final")
            patternsObj["Final/Sealed"] = true
        }
      }

      for (let i = curr.childCount - 1; i >= 0; i--) {
        const child = curr.child(i)
        if (child) stack.push({ node: child, parentSymbol: newParentSymbol, typeName: newTypeName })
      }
    }

    for (const p in patternsObj) {
      metadata.patterns!.push(p)
    }
    for (const f in frameworksObj) {
      metadata.detectedFrameworks!.push(f)
    }

    // Build symbol map for override resolution: `Owner.method` -> symbol.
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Constructor || s.kind === ASTEngine.SymbolKind.Function) {
        const owner = s.ownerName || "root"
        symbolMap.set(`${owner}.${s.name}`, s)
      }
    }

    // Post-loop: contains (real ownership only) + references (imports).
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner && s.kind !== ASTEngine.SymbolKind.Extension) {
        const key = `${_owner}\u0000${s.name}`
        if (!emittedContains.has(key)) {
          emittedContains.add(key)
          relationships.push({
            type: ASTEngine.RelationshipType.Contains,
            source: _owner,
            target: s.name,
            isExternal: false,
            weight: 1,
            confidence: 1.0,
            metadata: {},
          })
        }
      }
    }
    for (const imp of imports) {
      if (imp.module) {
        relationships.push({
          type: ASTEngine.RelationshipType.References,
          source: "root",
          target: imp.module,
          isExternal: true,
          weight: 0.9,
          confidence: 1.0,
          metadata: { importModule: imp.module },
        })
      }
    }

    this.resolveOverrides(overrideTasks, classHierarchy, symbolMap, relationships, context?.overrideCompanion)
    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      relationships,
      imports,
      exports,
      metadata,
      errors: (metadata as any).errors || [],
    }
  }

  // ============================================================================
  // EVIDENCE TIERS
  // ============================================================================

  /**
   * Evidence-tier classification (managed-OO family contract — mirrors
   * dart/csharp/java; M14 section D requires >=2 distinct evidenceClass
   * values). Same rules as the family: structural (grammar clauses, conf
   * 1.0) | usage_contextual (calls, mixin uses) | import_based (import
   * directives) | inferred (confidence < 1 edges).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "imports" || type === "exports" || type === "references") { md.evidenceClass = "import_based"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "overrides") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  // ==========================================================================
  // Declaration handlers
  // ==========================================================================

  private handleProtocol(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    patternsObj: Record<string, boolean>,
    classHierarchy: Map<string, string[]>,
  ): ASTEngine.UniversalSymbol | null {
    patternsObj["Protocol-Oriented Programming"] = true
    const nameNode = this.findChildByType(node, "type_identifier") || this.firstNamedChild(node)
    if (!nameNode) return parent

    const meta: Record<string, any> = { isProtocol: true, hasGenerics: this.hasChildType(node, "type_parameter_clause") || this.hasChildType(node, "type_parameters") }
    if (meta.hasGenerics) patternsObj["Generics"] = true
    const vis = this.getVisibility(node)
    const symbol = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Interface, nameNode, parent, symbols, meta, vis)

    // Protocol inheritance is NOT materialized as extends/implements (ObjC
    // M12.19 precedent: `@protocol A <NSObject>` emits no edge).
    return symbol
  }

  private handleDeclaration(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    patternsObj: Record<string, boolean>,
    classHierarchy: Map<string, string[]>,
  ): ASTEngine.UniversalSymbol | null {
    let kind = ASTEngine.SymbolKind.Class

    if (this.hasAnonToken(node, "actor")) {
      kind = ASTEngine.SymbolKind.Actor
    } else if (this.hasAnonToken(node, "struct")) {
      kind = ASTEngine.SymbolKind.Struct
    } else if (this.hasAnonToken(node, "enum")) {
      kind = ASTEngine.SymbolKind.Enum
    } else if (this.hasAnonToken(node, "extension")) {
      kind = ASTEngine.SymbolKind.Extension
    }

    // Name: the type identifier. For extensions it is the EXTENDED type
    // (inside a user_type), and the extension has NO owner (never self-owner).
    let nameNode: Node | null = null
    if (kind === ASTEngine.SymbolKind.Extension) {
      nameNode = this.findDescendantTypeIdentifier(node)
    } else {
      nameNode = this.findChildByType(node, "type_identifier") || this.findChildByType(node, "user_type") || this.firstNamedChild(node)
    }
    if (!nameNode) return parent

    let rawName = nameNode.type === "user_type" && nameNode.namedChildCount > 0 ? nameNode.namedChild(0)!.text : nameNode.text

    const meta: Record<string, any> = {
      hasGenerics: this.hasChildType(node, "type_parameter_clause") || this.hasChildType(node, "type_parameters"),
    }
    if (meta.hasGenerics) patternsObj["Generics"] = true
    if (kind === ASTEngine.SymbolKind.Struct) meta.isValueType = true
    if (kind === ASTEngine.SymbolKind.Enum) meta.isValueType = true

    const vis = this.getVisibility(node)

    // Enum raw type (`enum Status: String`) -> metadata ONLY, no edge.
    if (kind === ASTEngine.SymbolKind.Enum) {
      const rawType = this.findEnumRawType(node)
      if (rawType) meta.rawType = rawType
    }

    const symbol = this.createSymbol(rawName, kind, nameNode, parent, symbols, meta, vis)

    // extends / implements for class/struct/actor only.
    if (kind !== ASTEngine.SymbolKind.Enum && kind !== ASTEngine.SymbolKind.Extension) {
      const bases = this.extractBases(node)
      const parents: string[] = []
      // Swift semantics (probe-verified fixture #266): ONLY a class can have
      // a superclass — its FIRST base is extends, the rest are adopted
      // protocols (implements). Structs and actors have NO superclass, so
      // every base is a protocol adoption -> implements. (M12.21 previously
      // emitted extends for struct/actor first-bases; fixed in the #266 wave.)
      const firstIsSuperclass = kind === ASTEngine.SymbolKind.Class
      for (let i = 0; i < bases.length; i++) {
        const base = bases[i]
        parents.push(base)
        const isExtends = firstIsSuperclass && i === 0
        relationships.push({
          type: isExtends ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
          source: symbol.name,
          target: base,
          isExternal: true,
          weight: isExtends ? 1 : 0.9,
          confidence: 1.0,
          metadata: { isImplements: !isExtends },
        })
      }
      if (parents.length > 0) classHierarchy.set(symbol.name, parents)
    }

    return symbol
  }

  private handleFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    overrideTasks: OverrideTask[],
    companion?: OverrideCompanion,
  ): ASTEngine.UniversalSymbol | null {
    const nameNode = this.findChildByType(node, "simple_identifier") || this.findChildByType(node, "identifier")
    // Operator overloads (`static func + (l:r:) -> V`): the name is the
    // anonymous operator token after `func` (`+`, `==`, `[]`, ...) — no
    // simple_identifier exists, and without this the whole method is
    // silently dropped (the dart #265 operator-signature bug class).
    const opName = nameNode ? null : this.operatorName(node)
    if (!nameNode && !opName) return parent

    const isMethod = !!parent && MEMBER_OWNER_KINDS.has(parent.kind as ASTEngine.SymbolKind)
    const kind = isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function

    const vis = this.getVisibility(node)
    const meta: Record<string, any> = {
      hasGenerics: this.hasChildType(node, "type_parameter_clause") || this.hasChildType(node, "type_parameters"),
    }
    const funcAttrs = this.extractAttributes(node)
    if (funcAttrs.length > 0) meta.annotations = funcAttrs

    const symbol = this.createSymbol(opName ?? nameNode!.text, kind, opName ? node : nameNode!, parent, symbols, meta, vis)
    this.collectFunctionMeta(node, meta, symbol)
    // Per-symbol cyclomatic complexity (managed-OO family contract — csharp
    // #264 / dart #265 waves; same node set as the file-level counter).
    symbol.complexity = this.calculateCyclomaticComplexity(node)

    // override keyword -> Overrides task (qualified resolution deferred to
    // the post-loop with the hierarchy + companion, Java/C# semantics).
    // The grammar nests the token: modifiers > member_modifier [override].
    if (this.hasDescendantAnonToken(node, "override") && parent) {
      overrideTasks.push({
        fqn: `${parent.name}.${symbol.name}`,
        methodName: symbol.name,
        ownerFqn: parent.name,
      })
    }

    // Return type (lightweight, metadata only — the `->` token child scan).
    const returnNode = this.findReturnType(node)
    if (returnNode) symbol.returnType = returnNode.text

    return symbol
  }

  // ==========================================================================
  // Variable / call / uses handlers
  // ==========================================================================

  private handleVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    parent: ASTEngine.UniversalSymbol | null,
    typeName: string | null,
    frameworksObj: Record<string, boolean>,
    patternsObj: Record<string, boolean>,
  ) {
    // Locals are NOT symbols (C# LocalsAreNotSymbols). Only type-scope
    // members (property) and file-scope bindings (variable) qualify.
    if (parent && !MEMBER_OWNER_KINDS.has(parent.kind as ASTEngine.SymbolKind)) return

    const vis = this.getVisibility(node)
    const annotations: string[] = []
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "modifiers" || c.type === "attribute")) {
        for (let j = 0; j < c.namedChildCount; j++) {
          const mod = c.namedChild(j)
          if (!mod) continue
          if (mod.type === "attribute") {
            const text = mod.text
            annotations.push(text)
            if (text.indexOf("@State") !== -1 || text.indexOf("@Binding") !== -1 || text.indexOf("@Environment") !== -1 || text.indexOf("@ObservedObject") !== -1) {
              frameworksObj["SwiftUI"] = true
              patternsObj["Property Wrappers"] = true
            }
            if (text.indexOf("@Published") !== -1) {
              frameworksObj["Combine"] = true
              patternsObj["Property Wrappers"] = true
            }
            if (text.indexOf("@MainActor") !== -1 || text.indexOf("@Sendable") !== -1 || text.indexOf("@globalActor") !== -1) {
              patternsObj["Swift Concurrency"] = true
            }
            if (text.startsWith("@")) patternsObj["Property Wrappers"] = true
          }
        }
      }
    }

    const meta: Record<string, any> = {}
    if (annotations.length > 0) meta.annotations = annotations

    const kind = parent ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Variable

    // Name from the binding pattern: `var x: Int` / `let x = ...` — the
    // pattern's simple_identifier (first identifier child).
    const patternNode = this.findChildByType(node, "pattern")
    if (patternNode) {
      const idNode = this.findChildByType(patternNode, "simple_identifier") || this.findChildByType(patternNode, "identifier") || this.firstNamedChild(patternNode)
      if (idNode) {
        this.createSymbol(idNode.text, kind, idNode, parent, symbols, meta, vis)
      }
    } else {
      const idNode = this.findChildByType(node, "simple_identifier") || this.findChildByType(node, "identifier")
      if (idNode) {
        this.createSymbol(idNode.text, kind, idNode, parent, symbols, meta, vis)
      }
    }
  }

  private handleCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    emittedCalls: Set<string>,
  ) {
    const source = parent ? parent.name : "root"

    // The function child: bare identifier or navigation/member expression.
    const funcNode = this.findChildByType(node, "simple_identifier") || this.findChildByType(node, "identifier") || this.findChildByType(node, "navigation_expression")

    if (!funcNode) return

    // Subscript READ (`entries[key]`) parses as call_expression with a
    // `[key]` call_suffix in the pinned grammar — it is a property access,
    // NOT a function call (no calls edge; family property-read precedent).
    if (this.isSubscriptRead(node)) return

    if (funcNode.type === "navigation_expression") {
      // Member call -> leaf target (`users.first` -> `first`, `[1,2].map` -> `map`).
      const leaf = this.navigationLeaf(funcNode)
      if (!leaf || leaf === "$0") return
      this.emitCall(relationships, source, leaf, emittedCalls)
      return
    }

    // Bare identifier call.
    const target = funcNode.text
    if (!target || BUILTIN_BARE_CALLS.has(target)) return

    const firstChar = target.charCodeAt(0)
    const isCapitalized = firstChar >= 65 && firstChar <= 90 && target.length > 1

    if (isCapitalized) {
      // Bare capitalized call = construction syntax -> instantiates ONLY
      // (Java `new Foo()` analog — never also a calls edge).
      const key = `${source}\u0000instantiates\u0000${target}`
      if (!emittedCalls.has(key)) {
        emittedCalls.add(key)
        relationships.push({
          type: ASTEngine.RelationshipType.Instantiates,
          source,
          target,
          isExternal: true,
          weight: 0.7,
          confidence: 1.0,
          metadata: { isInstantiation: true },
        })
      }
    } else {
      this.emitCall(relationships, source, target, emittedCalls)
    }
  }

  private emitCall(
    relationships: ASTEngine.UniversalRelationship[],
    source: string,
    target: string,
    emittedCalls: Set<string>,
  ) {
    const key = `${source}\u0000calls\u0000${target}`
    if (emittedCalls.has(key)) return
    emittedCalls.add(key)
    relationships.push({
      type: ASTEngine.RelationshipType.Calls,
      source,
      target,
      isExternal: true,
      weight: 1,
      confidence: 0.95,
      metadata: {},
    })
  }

  private handleSelfUse(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    typeName: string | null,
    parent: ASTEngine.UniversalSymbol | null,
    emittedUses: Set<string>,
  ) {
    // `self.x` -> uses (source = enclosing TYPE, target = leaf). Other
    // receivers (locals, type names) emit nothing — only Swift's `this`.
    // self may sit one level down on a nested chain (`self.pipeline.readerIndex`
    // is navigation > navigation(self_expression) > suffix) — walk the RECEIVER
    // chain only. NEVER into calls: `self.decode(...)?.buffer` reads `.buffer`
    // off the CALL RESULT, not off self (the receiver chain ends at the call).
    const hasSelf = this.hasSelfReceiver(node)
    if (!hasSelf) return

    // `self.helper()` is a METHOD CALL — the callee of a call_expression
    // emits `calls` via handleCall, never also `uses` (member reads only,
    // the M12.21 contract). Rust M12.18 uses the same parent-type gate.
    if (node.parent && node.parent.type === "call_expression") return

    const leaf = this.navigationLeaf(node)
    if (!leaf) return

    const source = typeName || (parent?.ownerName ? parent.ownerName : null) || parent?.name || "root"
    const key = `${source}\u0000uses\u0000${leaf}`
    if (emittedUses.has(key)) return
    emittedUses.add(key)
    relationships.push({
      type: ASTEngine.RelationshipType.Uses,
      source,
      target: leaf,
      isExternal: false,
      weight: 0.7,
      confidence: 0.95,
      metadata: { isFieldAccess: true },
    })
  }

  // ==========================================================================
  // Override resolution (Java/C# shared machinery)
  // ==========================================================================

  private resolveOverrides(
    tasks: OverrideTask[],
    classHierarchy: Map<string, string[]>,
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    relationships: ASTEngine.UniversalRelationship[],
    companion?: OverrideCompanion,
  ) {
    for (const task of tasks) {
      let targetFqn: string | null = null

      // Pass 1: BFS over the in-file hierarchy, exact name match.
      const queue: string[] = []
      const ownerH = classHierarchy.get(task.ownerFqn)
      if (ownerH) {
        for (let i = 0; i < ownerH.length; i++) queue.push(ownerH[i])
      }
      const seen: Set<string> = new Set()

      while (queue.length > 0) {
        const parentName = queue.shift()!
        if (seen.has(parentName)) continue
        seen.add(parentName)

        const potentialTargetFqn = `${parentName}.${task.methodName}`
        if (symbolMap.has(potentialTargetFqn)) {
          targetFqn = potentialTargetFqn
          break
        }
        const pH = classHierarchy.get(parentName)
        if (pH) {
          for (let i = 0; i < pH.length; i++) queue.push(pH[i])
        }
      }

      // Pass 2: cross-file declaring-parent resolution via the companion.
      if (!targetFqn && companion && ownerH && ownerH.length > 0) {
        const declaring = findDeclaringParent(task.methodName, ownerH, companion, (t) => classHierarchy.get(t) ?? [])
        if (declaring) targetFqn = `${declaring}.${task.methodName}`
      }

      // Pass 3: deterministic per-file fallback — first hierarchy parent.
      if (!targetFqn && ownerH && ownerH.length > 0) {
        targetFqn = `${ownerH[0]}.${task.methodName}`
      }

      if (targetFqn) {
        relationships.push({
          type: ASTEngine.RelationshipType.Overrides,
          source: task.fqn,
          target: targetFqn,
          isExternal: true,
          weight: 0.8,
          confidence: 1.0,
          metadata: { relationshipType: "method_override", isSwiftOverride: true, evidenceClass: "structural" },
        })
      }
    }
  }

  // ==========================================================================
  // Symbol creation / helpers
  // ==========================================================================

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    symbols: ASTEngine.UniversalSymbol[],
    meta: Record<string, any> = {},
    visibility: string = "internal",
  ): ASTEngine.UniversalSymbol {
    const symbol: ASTEngine.UniversalSymbol = {
      id: parent ? `${parent.id}.${name}` : name,
      name,
      kind,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
      parentId: parent ? parent.id : undefined,
      ownerName: parent ? parent.name : undefined,
      parent: parent ? parent.name : undefined,
      metadata: meta,
      visibility,
    }

    if (meta.isAsync) symbol.isAsync = true
    if (meta.throws) symbol.throws = "true"
    if (meta.annotations) symbol.annotations = JSON.stringify(meta.annotations)

    symbols.push(symbol)
    return symbol
  }

  private collectFunctionMeta(node: Node, meta: Record<string, any>, symbol: ASTEngine.UniversalSymbol) {
    let isAsync = false
    let throws = false
    const nodeQueue: Node[] = [node]
    while (nodeQueue.length > 0) {
      const c = nodeQueue.pop()!
      if (c.text === "async" || c.type === "async") isAsync = true
      if (c.type === "throw_keyword" || c.text === "throws" || c.type === "throws") throws = true
      for (let i = c.childCount - 1; i >= 0; i--) {
        if (c.child(i)) nodeQueue.push(c.child(i)!)
      }
    }
    if (isAsync) { meta.isAsync = true; symbol.isAsync = true }
    if (throws) { meta.throws = true; symbol.throws = "true" }
  }

  private getVisibility(node: Node): string {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "modifiers") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const mod = child.namedChild(j)
          if (mod) {
            // visibility_modifier holds the keyword as its token text
            // (probe-verified against the pinned tree-sitter-swift).
            if (mod.text === "public") return "public"
            if (mod.text === "private") return "private"
            if (mod.text === "fileprivate") return "fileprivate"
            if (mod.text === "internal") return "internal"
            if (mod.text === "open") return "open"
            if (mod.text === "package") return "package"
          }
        }
      }
    }
    return "internal"
  }

  private extractAttributes(node: Node): string[] {
    const attrs: string[] = []
    const queue: Node[] = [node]
    while (queue.length > 0) {
      const c = queue.pop()!
      if (c.type === "attribute") {
        const text = c.text.trim()
        if (text.startsWith("@")) attrs.push(text)
      }
      for (let i = c.childCount - 1; i >= 0; i--) {
        if (c.child(i)) queue.push(c.child(i)!)
      }
    }
    return attrs
  }

  private handleImport(node: Node, imports: ASTEngine.ImportInfo[], frameworksObj: Record<string, boolean>) {
    let moduleName = ""
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "simple_identifier" || c.type === "type_identifier" || c.type === "identifier")) {
        moduleName = c.text
        break
      }
    }
    if (moduleName) {
      imports.push({
        module: moduleName,
        isExternal: true,
        range: {
          startLine: node.startPosition.row + 1,
          startColumn: node.startPosition.column,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column,
          startIndex: node.startIndex,
          endIndex: node.endIndex,
        },
      })
      if (moduleName === "SwiftUI") frameworksObj["SwiftUI"] = true
      if (moduleName === "Combine") frameworksObj["Combine"] = true
      if (moduleName === "UIKit") frameworksObj["UIKit"] = true
      if (moduleName === "Foundation") frameworksObj["Foundation"] = true
    }
  }

  // ---- tree helpers (pure AST, no source scanning) ----

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }

  private hasChildType(node: Node, type: string): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return true
    }
    return false
  }

  private firstNamedChild(node: Node): Node | null {
    return node.namedChildCount > 0 ? node.namedChild(0) : null
  }

  /**
   * Per-symbol cyclomatic complexity (managed-OO family contract — csharp
   * #264 wave precedent). Mirrors the file-level counter's node set, adapted
   * to the pinned swift grammar (switch_entry per case, guard_statement,
   * catch_block, conjunction/disjunction/ternary expressions); base 1.
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1
    const complexityNodes = new Set([
      "if_statement", "for_statement", "while_statement", "repeat_while_statement",
      "switch_entry", "guard_statement", "catch_block",
      "conjunction_expression", "disjunction_expression", "ternary_expression",
    ])
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (complexityNodes.has(n.type)) complexity++
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return complexity
  }

  /** `x[key]` parses as call_expression with a `[key]` call_suffix. */
  private isSubscriptRead(node: Node): boolean {
    const suffix = this.findChildByType(node, "call_suffix")
    if (!suffix) return false
    const args = this.findChildByType(suffix, "value_arguments")
    return !!args && this.hasAnonToken(args, "[")
  }

  /** Operator overload name: the anonymous operator token after `func`. */
  private operatorName(node: Node): string | null {
    let sawFunc = false
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (!c.isNamed && c.type === "func") { sawFunc = true; continue }
      if (sawFunc) {
        if (c.isNamed && c.type === "simple_identifier") return null
        if (!c.isNamed && c.type !== "(" && c.type !== ")" && c.type !== "{") {
          return `operator ${c.text}`
        }
      }
    }
    return null
  }

  /** `defer { ... }` parses as call_expression(simple_identifier "defer", call_suffix > lambda_literal). */
  private isDeferCall(node: Node): boolean {
    const fn = this.findChildByType(node, "simple_identifier") || this.findChildByType(node, "identifier")
    if (!fn || fn.text !== "defer") return false
    const suffix = this.findChildByType(node, "call_suffix")
    return !!suffix && this.findChildByType(suffix, "lambda_literal") !== null
  }

  /** Match an anonymous keyword token (`struct`, `enum`, `extension`, `actor`, `override`, `self`). */
  private hasAnonToken(node: Node, tokenType: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === tokenType) return true
    }
    return false
  }

  /**
   * Walk the navigation RECEIVER chain: navigation_expression > (nested
   * navigation_expression | self_expression | anonymous self token). Stops at
   * the first non-receiver child (a call_expression/try_expression) — the
   * suffix then applies to that call's RESULT, not to self.
   */
  private hasSelfReceiver(node: Node): boolean {
    let cur: Node | null = node
    let guard = 0
    while (cur && guard++ < 64) {
      if (cur.type === "self_expression" || (cur.type === "self" && !cur.isNamed)) return true
      let next: Node | null = null
      for (let i = 0; i < cur.namedChildCount; i++) {
        const c = cur.namedChild(i)
        if (!c) continue
        if (c.type === "navigation_expression" || c.type === "self_expression") { next = c; break }
      }
      if (!next) return false
      cur = next
    }
    return false
  }

  /** Match an anonymous keyword token anywhere in the subtree (nested modifier tokens). */
  private hasDescendantAnonToken(node: Node, tokenType: string): boolean {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (c.type === tokenType && !c.isNamed) return true
      for (let i = c.childCount - 1; i >= 0; i--) {
        const child = c.child(i)
        if (child) stack.push(child)
      }
    }
    return false
  }

  /** For extensions: the type_identifier inside the user_type (the extended type). */
  private findDescendantTypeIdentifier(node: Node): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (c.type === "type_identifier") return c
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const child = c.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return null
  }

  private findEnumRawType(node: Node): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "inheritance_specifier") {
        const inner = this.findChildByType(c, "user_type") || this.findChildByType(c, "type_identifier")
        return inner ? inner.text : c.text
      }
    }
    return null
  }

  /** Base type names from the inheritance specifier (class/struct/actor). */
  private extractBases(node: Node): string[] {
    const bases: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "inheritance_specifier") {
        const name = this.extractBaseName(c)
        if (name) bases.push(name)
      }
    }
    return bases
  }

  private extractBaseName(spec: Node): string | null {
    // `user_type > type_identifier` — take the leaf type identifier.
    for (let i = 0; i < spec.namedChildCount; i++) {
      const c = spec.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier") return c.text
      if (c.type === "user_type") {
        const leaf = this.findChildByType(c, "type_identifier")
        if (leaf) return leaf.text
      }
      if (c.type === "type_identifier" && c.text) return c.text
    }
    const txt = spec.text.trim()
    return txt && !txt.includes(" ") ? txt : null
  }

  /** Leaf name of a navigation_expression: `users.first` -> `first`. */
  private navigationLeaf(node: Node): string | null {
    // The last navigation_suffix child holds the leaf identifier.
    let leaf: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "navigation_suffix") {
        leaf = this.findChildByType(c, "simple_identifier") || this.findChildByType(c, "identifier") || c
      }
    }
    if (leaf) return leaf.text
    // Fallback: last simple_identifier child.
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "simple_identifier") leaf = c
    }
    return leaf ? leaf.text : null
  }

  /** Return type node after the `->` anonymous token (lightweight). */
  private findReturnType(node: Node): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === "->") {
        // Next sibling is the return type.
        const nxt = node.child(i + 1)
        if (nxt && nxt.isNamed) return nxt
      }
    }
    return null
  }
}
