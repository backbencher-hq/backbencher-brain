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
//     - extends:  class/struct/actor superclass (first base when the kind
//       resolves to a class) AND protocol -> inherited protocol parents
//       (AnyObject/Any class-constraint markers excluded — family contract:
//       csharp interface IX : IA / java interface extends / objc protocol <A>)
//     - implements: adopted protocols — remaining class bases, EVERY
//       extension base (Swift forbids redundant conformances, so extension
//       adoptions are always additional), and every enum base except a
//       stdlib raw-value type in first slot (String/Int/...)
//       (`enum E: String, Codable` -> implements E -> Codable)
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

// Stdlib raw-value types of a raw-representable enum (`enum E: String, Codable`).
// Only a stdlib-named FIRST base is the raw value; every other base (and a
// non-stdlib first base like `enum E: Error`) is a protocol conformance.
// (Swift also allows custom RawRepresentable raw types — unresolvable
// statically; the stdlib gate is the deterministic rule, documented SWIFTD15.)
const ENUM_RAW_VALUE_TYPES = new Set([
  "String", "Character",
  "Int", "Int8", "Int16", "Int32", "Int64",
  "UInt", "UInt8", "UInt16", "UInt32", "UInt64",
  "Float", "Float32", "Float64", "Double",
])

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
  // Fixed-width stdlib numerics (SWIFTD16): trivial value construction, same
  // class as Int/Double — filtered for consistency (Int8-64/UInt8-64 were
  // previously missed while Int was filtered; corpus: UInt8 244 / Int64 72 /
  // UInt16 47 bare constructions per swift-nio 200-file census).
  "UInt", "UInt8", "UInt16", "UInt32", "UInt64",
  "Int8", "Int16", "Int32", "Int64",
  // `defer { }` parses as call_expression(simple_identifier "defer", lambda_literal)
  // in the pinned grammar — it is a control keyword, never a real function call.
  "defer",
  // SW-E (ultimate review): `type(of:)` is a stdlib free function like
  // print/assert — a bare `type` call is the metatype query, never user
  // code. Member reads (`x.type` is invalid Swift) are unaffected.
  "type",
])

// ============================================================================
// CONV-SW-3 (#838/#836): framework detection — the family contract (CONV-CS-2,
// java sibling) reached through this lane's existing markers.
// ============================================================================
// The trigger set is UNCHANGED: SwiftUI/Combine/UIKit/Foundation, written by the
// import walker and by the property-wrapper handler exactly as before. What was
// missing is the published contract over it. Before this round the lane published
// `detectedFrameworks` and nothing else, and it built that array by iterating the
// observation map — so its ORDER was the order triggers happened to be visited in
// the walk, which is a property of the file's statement order rather than of the
// code's meaning. `frameworksObj` cannot be the pick order for the same reason
// python's import order could not be (CONV-PY-1).
//
// SWIFT_FRAMEWORK_ORDER is the emitted order and therefore the primary pick:
// application frameworks most-specific first, then UIKit, and the base library
// LAST. Foundation is imported by nearly every Swift file including every
// framework's own headers, so "most common first" would report Foundation as the
// primary framework for anything that imports both it and a UI framework — the
// reverse of what a consumer wants. Test frameworks would sort last of all, by the
// same rule as CS_FRAMEWORK_ORDER; this lane observes none yet (see the wave record
// for why no marker was invented here to fill that slot).
const SWIFT_FRAMEWORK_ORDER = ["SwiftUI", "Combine", "UIKit", "Foundation"]

// The pattern kinds each framework is observed BY, so `frameworkPatterns` states
// the same fact as `detectedFrameworks` rather than re-deriving it.
const SWIFT_FRAMEWORK_PATTERNS: Record<string, string[]> = {
  SwiftUI: ["declarative_ui"],
  Combine: ["reactive_streams"],
  UIKit: ["ui_framework"],
  Foundation: ["base_library"],
}

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

    // In-file declared kinds (SWIFTD1): protocol names are knowable from the
    // parse tree itself, so `class X: LocalProtocol` resolves to implements
    // even without the cross-file companion. (Mirrors csharp M12.07's
    // collectDeclaredTypeKinds pre-pass.)
    const inFileKinds = new Map<string, string>()
    this.collectDeclaredKinds(rootNode, inFileKinds)

    const emittedCalls = new Set<string>()
    const emittedUses = new Set<string>()
    const emittedContains = new Set<string>()
    // SW-B candidates: navigation calls with capitalized heads, resolved
    // post-walk against declared enum cases (symbols must be whole first).
    const enumCtorCandidates: Array<{ source: string; head: string | null; owner: string | null; leaf: string; removeCalls: boolean }> = []
    // SW-G: class -> superclass (first base when it IS a superclass),
    // recorded at declaration time for `super.init(...)` targets.
    const superByClass = new Map<string, string>()

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
        newParentSymbol = this.handleDeclaration(curr, symbols, relationships, parentSymbol, patternsObj, classHierarchy, inFileKinds, context?.typeKinds as Map<string, string> | undefined, superByClass)
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
        this.handleCall(curr, relationships, parentSymbol, emittedCalls, enumCtorCandidates, superByClass)
      } else if (curr.type === "navigation_expression") {
        // `self.x` member READ -> uses (source = enclosing type, target = leaf).
        this.handleSelfUse(curr, relationships, newTypeName, parentSymbol, emittedUses)
        // SW-A (ultimate review): NON-self member reads (`store.items`,
        // `a.b.c` links, `C.shared`) — the self rule and the bare-member
        // rule both miss them. Suffix members read unless callee/write.
        this.handleMemberUses(curr, relationships, parentSymbol, newTypeName, emittedUses)
      } else if (curr.type === "key_path_expression") {
        // SW-D (ultimate review): key-path members (`\.name`, `\C.name`)
        // always read the member identity (even `obj[keyPath: \.x] = v`
        // reads WHICH member to set through). `\.self` names the whole
        // value, never a member.
        this.handleKeyPathUses(curr, relationships, parentSymbol, newTypeName, emittedUses)
      }

      // ---- pattern / metadata flags (unchanged from M11 behavior) ----
      // M14.0.F6: "where_clause" was a dead literal — the pinned grammar parses
      // generic where clauses as type_constraints (probe-verified 2026-09); no
      // Swift source ever produced a where_clause node, so the "Generics with
      // Where Clauses" flag could never fire. Fixed to match reality.
      if (curr.type === "type_constraints") {
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

    // #754: BARE member reads (after the walk, so the symbol table is whole).
    this.handleBareUses(rootNode, relationships, symbols, emittedUses)

    // SW-B (ultimate review): enum-case construction (`Result.success(1)`
    // builds Result). Convert recorded candidates whose (head, leaf) is a
    // declared enum case: drop the dangling leaf call, emit instantiates.
    // Static factory methods (`C.create()`) are not cases — stays calls.
    // SW-H (second review): implicit (`.a(v)`) and Self (`Self.a(v)`)
    // constructions resolve against the ENCLOSING enum instead of a head.
    if (enumCtorCandidates.length > 0) {
      const enumCases = new Set<string>()
      for (const s of symbols) {
        if (s.kind === ASTEngine.SymbolKind.EnumMember && s.ownerName) {
          enumCases.add(`${s.ownerName}.${s.name}`)
        }
      }
      if (enumCases.size > 0) {
        for (const cand of enumCtorCandidates) {
          const key = cand.head ?? cand.owner
          if (!key || !enumCases.has(`${key}.${cand.leaf}`)) continue
          if (cand.removeCalls) {
            for (let i = relationships.length - 1; i >= 0; i--) {
              const r = relationships[i]
              if (r.type === ASTEngine.RelationshipType.Calls && r.source === cand.source && String(r.target) === cand.leaf) {
                relationships.splice(i, 1)
                break
              }
            }
          }
          const ekey = `${cand.source}\u0000instantiates\u0000${key}`
          if (!emittedCalls.has(ekey)) {
            emittedCalls.add(ekey)
            relationships.push({
              type: ASTEngine.RelationshipType.Instantiates,
              source: cand.source,
              target: key,
              isExternal: true,
              weight: 0.7,
              confidence: 0.95,
              metadata: { isEnumConstruction: true },
            })
          }
        }
      }
    }

    for (const p in patternsObj) {
      metadata.patterns!.push(p)
    }
    // CONV-SW-3: the emitted order is the declared table, never the walk order.
    // Names observed but absent from the table are appended in sorted order rather
    // than dropped — a marker added without an order entry must degrade to a
    // disclosed position, never to silent non-publication.
    const emittedFrameworks: string[] = SWIFT_FRAMEWORK_ORDER.filter((f) => frameworksObj[f] === true)
    const unlistedFrameworks: string[] = []
    for (const f in frameworksObj) {
      if (frameworksObj[f] === true && SWIFT_FRAMEWORK_ORDER.indexOf(f) === -1) unlistedFrameworks.push(f)
    }
    unlistedFrameworks.sort()
    for (let i = 0; i < unlistedFrameworks.length; i++) emittedFrameworks.push(unlistedFrameworks[i])
    metadata.detectedFrameworks = emittedFrameworks
    metadata.framework = emittedFrameworks.length > 0 ? emittedFrameworks[0] : undefined
    metadata.frameworkPatterns = emittedFrameworks.map((f) => ({
      framework: f,
      patterns: SWIFT_FRAMEWORK_PATTERNS[f] ?? ["usage"],
    }))

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

  /** Pre-pass: record every protocol/class/struct/actor/enum/extension name. */
  private collectDeclaredKinds(rootNode: Node, out: Map<string, string>): void {
    const stack: Node[] = [rootNode]
    let guard = 0
    while (stack.length > 0 && guard++ < 500000) {
      const n = stack.pop()!
      if (n.type === "protocol_declaration") {
        const nm = this.findChildByType(n, "type_identifier")
        if (nm) out.set(nm.text, "interface")
      } else if (n.type === "class_declaration") {
        const nm = this.findChildByType(n, "type_identifier") || this.findChildByType(n, "user_type")
        if (nm) {
          const leaf = nm.type === "user_type" && nm.namedChildCount > 0 ? nm.namedChild(0)!.text : nm.text
          if (this.hasAnonToken(n, "class")) out.set(leaf, "class")
          else if (this.hasAnonToken(n, "struct")) out.set(leaf, "struct")
          else if (this.hasAnonToken(n, "actor")) out.set(leaf, "actor")
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
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
      if (type === "overrides") {
        // Family contract (dart DARTD16 / csharp Pass-3 parity): a verified
        // override (in-file or companion evidence) is structural; a Pass-3
        // first-parent guess is only "inferred" — the parent may not even
        // declare the method, and guessing structural would hide the
        // evidence gap from the #419-D tier audit.
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
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

    // M14.0.F6: "type_parameter_clause" was a dead literal (probe-verified:
    // the pinned grammar parses generics as type_parameters, checked in the
    // OR below). Removed per the dead-literal audit.
    const meta: Record<string, any> = { isProtocol: true, hasGenerics: this.hasChildType(node, "type_parameters") }
    if (meta.hasGenerics) patternsObj["Generics"] = true
    const vis = this.getVisibility(node)
    const symbol = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Interface, nameNode, parent, symbols, meta, vis)

    // Protocol inheritance IS materialized as extends edges (family
    // contract, probe-verified 2026-09: csharp `interface IX : IA` ->
    // extends, java `interface IX extends IA` -> extends, objc
    // `@protocol B <A>` -> extends). The AnyObject / Any markers in the
    // inheritance list are CLASS-CONSTRAINT annotations, not protocol
    // parents — excluded (probe-verified: `protocol P: AnyObject, B` in
    // swift-nio parses AnyObject as an inheritance_specifier).
    const bases = this.extractBases(node)
    const parents: string[] = []
    for (const base of bases) {
      if (base === "AnyObject" || base === "Any") continue
      parents.push(base)
      relationships.push({
        type: ASTEngine.RelationshipType.Extends,
        source: symbol.name,
        target: base,
        isExternal: true,
        weight: 1,
        confidence: 1.0,
        metadata: { isImplements: false },
      })
    }
    if (parents.length > 0) classHierarchy.set(symbol.name, parents)
    return symbol
  }

  private handleDeclaration(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    patternsObj: Record<string, boolean>,
    classHierarchy: Map<string, string[]>,
    inFileKinds: Map<string, string>,
    crossFileKinds?: Map<string, string>,
    superByClass?: Map<string, string>,
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
    // SWIFTD19: a dotted extension target (`extension Outer.Inner`) names the
    // LEAF type (Inner) — the user_type holds sibling type_identifiers in
    // source order, so the leaf is the LAST one. The pre-fix code took the
    // FIRST (Outer), minting an extension symbol that collided with the
    // container type's symbol id and mis-attributing every member.
    let nameNode: Node | null = null
    if (kind === ASTEngine.SymbolKind.Extension) {
      const ut = this.findChildByType(node, "user_type")
      if (ut) {
        nameNode = this.lastTypeIdentifier(ut)
      } else {
        nameNode = this.findDescendantTypeIdentifier(node)
      }
    } else {
      nameNode = this.findChildByType(node, "type_identifier") || this.findChildByType(node, "user_type") || this.firstNamedChild(node)
    }
    if (!nameNode) return parent

    let rawName = nameNode.type === "user_type" && nameNode.namedChildCount > 0 ? nameNode.namedChild(0)!.text : nameNode.text
    // Dotted name fallback: leaf of the user_type (last type_identifier).
    if (kind === ASTEngine.SymbolKind.Extension && nameNode.type === "user_type") {
      const leaf = this.lastTypeIdentifier(nameNode)
      if (leaf) rawName = leaf.text
    }

    const meta: Record<string, any> = {
      hasGenerics: this.hasChildType(node, "type_parameters"),
    }
    if (meta.hasGenerics) patternsObj["Generics"] = true
    if (kind === ASTEngine.SymbolKind.Struct) meta.isValueType = true
    if (kind === ASTEngine.SymbolKind.Enum) meta.isValueType = true

    const vis = this.getVisibility(node)

    // Enum raw value (`enum Status: String`) -> metadata ONLY when the
    // first base names a stdlib raw-value type. A protocol in first slot
    // (`enum E: Error`, 46 corpus sites) is a CONFORMANCE, never a raw type
    // — the pre-SWIFTD15 code minted bogus rawType=Error payload there.
    if (kind === ASTEngine.SymbolKind.Enum) {
      const rawType = this.findEnumRawType(node)
      if (rawType && ENUM_RAW_VALUE_TYPES.has(rawType)) meta.rawType = rawType
    }

    const symbol = this.createSymbol(rawName, kind, nameNode, parent, symbols, meta, vis)

    const bases = this.extractBases(node)
    const parents: string[] = []
    if (kind === ASTEngine.SymbolKind.Class || kind === ASTEngine.SymbolKind.Struct || kind === ASTEngine.SymbolKind.Actor) {
      // Swift semantics (probe-verified fixture #266): ONLY a class can have
      // a superclass. A class's FIRST base is extends ONLY IF it is actually
      // a class — a first-base protocol is still an adoption (implements).
      // The cross-file companion (context.typeKinds) carries corpus protocol
      // names so `class X: SomeProtocol` resolves to implements on BOTH
      // sides; unknown externals keep the deterministic Swift rule: first
      // base = superclass (extends) when the kind is a class, else implements.
      // Structs and actors have NO superclass, so every base is implements.
      const firstIsSuperclass =
        kind === ASTEngine.SymbolKind.Class &&
        (bases.length > 0 ? (inFileKinds.get(bases[0]) ?? crossFileKinds?.get(bases[0]) ?? "class") === "class" : true)
      for (let i = 0; i < bases.length; i++) {
        const base = bases[i]
        parents.push(base)
        const isExtends = firstIsSuperclass && i === 0
        if (isExtends && superByClass) superByClass.set(symbol.name, base)
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
    } else if (kind === ASTEngine.SymbolKind.Extension) {
      // SWIFTD14: Swift extensions CANNOT add a superclass, and the compiler
      // forbids redundant conformances — every extension base is an ADDITIONAL
      // protocol adoption (implements). Corpus: 380 sites in swift-nio that
      // previously emitted nothing (csharp partial-class conformance is the
      // managed-OO analog and IS materialized).
      for (const base of bases) {
        parents.push(base)
        relationships.push({
          type: ASTEngine.RelationshipType.Implements,
          source: symbol.name,
          target: base,
          isExternal: true,
          weight: 0.9,
          confidence: 1.0,
          metadata: { isImplements: true },
        })
      }
    } else if (kind === ASTEngine.SymbolKind.Enum) {
      // SWIFTD15: enum conformances. The raw value (first base, stdlib-named
      // only) is metadata, NOT an edge; every remaining base is an adopted
      // protocol. Corpus: 181 enums carry bases; ~93% first-slot are
      // protocols (Sendable 76 / Error 46 / Hashable 22 / Equatable 17).
      // Mirrors dart DARTD15 (enhanced-enum conformances -> implements).
      const skipFirst = bases.length > 0 && ENUM_RAW_VALUE_TYPES.has(bases[0])
      for (let i = skipFirst ? 1 : 0; i < bases.length; i++) {
        const base = bases[i]
        relationships.push({
          type: ASTEngine.RelationshipType.Implements,
          source: symbol.name,
          target: base,
          isExternal: true,
          weight: 0.9,
          confidence: 1.0,
          metadata: { isImplements: true },
        })
      }
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
      hasGenerics: this.hasChildType(node, "type_parameters"),
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

    // SWIFTD18: multi-binding declarations (`var a = 1, b = 2`, `let x = 1,
    // y = 2`) carry one sibling `pattern` child PER binding in the pinned
    // grammar (probe-verified 2026-09). The pre-fix code symbolized only the
    // FIRST pattern, silently dropping every additional property/variable.
    // (Locals remain non-symbols by contract — this handler returns early for
    // non-type parents before reaching here.)
    const patternNodes: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "pattern") patternNodes.push(c)
    }
    if (patternNodes.length > 0) {
      for (const pn of patternNodes) {
        const idNode = this.findChildByType(pn, "simple_identifier") || this.findChildByType(pn, "identifier") || this.firstNamedChild(pn)
        if (idNode) {
          this.createSymbol(idNode.text, kind, idNode, parent, symbols, meta, vis)
        }
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
    enumCtorCandidates?: Array<{ source: string; head: string | null; owner: string | null; leaf: string; removeCalls: boolean }>,
    superByClass?: Map<string, string>,
  ) {
    const source = parent ? parent.name : "root"

    // The function child: bare identifier or navigation/member expression.
    const funcNode = this.findChildByType(node, "simple_identifier") || this.findChildByType(node, "identifier") || this.findChildByType(node, "navigation_expression")

    if (!funcNode) {
      // SW-H (second review): implicit enum-case construction (`.a(v)`)
      // parses the callee as a prefix_expression (leading dot) — no
      // simple_identifier, so the call is silent. Record for post-walk
      // resolution against the enclosing enum's cases.
      if (enumCtorCandidates) {
        const pre = this.findChildByType(node, "prefix_expression")
        const dotFirst = pre ? pre.child(0) : null
        if (pre && dotFirst && !dotFirst.isNamed && dotFirst.type === ".") {
          let leaf: string | null = null
          for (let i = 0; i < pre.namedChildCount; i++) {
            const c = pre.namedChild(i)
            if (c && (c.type === "simple_identifier" || c.type === "identifier")) { leaf = c.text; break }
          }
          const owner = parent?.ownerName ?? null
          if (leaf && owner) {
            enumCtorCandidates.push({ source, head: null, owner, leaf, removeCalls: false })
          }
        }
      }
      return
    }

    // Subscript READ (`entries[key]`) parses as call_expression with a
    // `[key]` call_suffix in the pinned grammar — it is a property access,
    // NOT a function call (no calls edge; family property-read precedent).
    if (this.isSubscriptRead(node)) return

    if (funcNode.type === "navigation_expression") {
      // Member call -> leaf target (`users.first` -> `first`, `[1,2].map` -> `map`).
      const leaf = this.navigationLeaf(funcNode)
      if (!leaf || leaf === "$0") return
      // SW-G (second review): `super.init(...)` / `self.init(...)` /
      // `Self.init(...)` construct (dart DT-D parity) — never a call to a
      // method named `init` (constructors are literally `constructor`).
      // super builds the superclass (prescan), self/Self the enclosing type.
      if (leaf === "init") {
        const recv = this.navigationReceiver(funcNode)
        if (recv === "super" || recv === "self" || recv === "Self") {
          const owner = parent?.ownerName ?? parent?.name
          let target: string | null = null
          if ((recv === "self" || recv === "Self") && owner) target = owner
          else if (recv === "super" && owner && superByClass) target = superByClass.get(owner) ?? null
          if (target) {
            const key = `${source}\u0000instantiates\u0000${target}`
            if (!emittedCalls.has(key)) {
              emittedCalls.add(key)
              relationships.push({
                type: ASTEngine.RelationshipType.Instantiates,
                source,
                target,
                isExternal: true,
                weight: 0.7,
                confidence: 0.95,
                metadata: { isSuperInit: recv === "super", isSelfInit: recv !== "super" },
              })
            }
            return
          }
        }
      }
      // SW-B (ultimate review): record enum-construction CANDIDATES
      // (`Result.success(1)` may build Result, not call success) — resolved
      // post-walk against declared enum cases (symbols must be whole first).
      // The receiver is second-to-last in the chain (`P.Foo.bar` -> Foo).
      if (enumCtorCandidates) {
        const chain = this.navigationChain(funcNode)
        const receiver = chain.length >= 2 ? chain[chain.length - 2] : null
        if (receiver && this.isTypeName(receiver) && receiver !== "Self" && receiver !== "super" && receiver !== "this") {
          enumCtorCandidates.push({ source, head: receiver, owner: null, leaf, removeCalls: true })
        } else if (receiver === "Self") {
          // SW-H: `Self.a(v)` in an enum builds the enclosing enum.
          const owner = parent?.ownerName ?? null
          if (owner) enumCtorCandidates.push({ source, head: null, owner, leaf, removeCalls: true })
        }
      }
      this.emitCall(relationships, source, leaf, emittedCalls)
      return
    }

    // Bare identifier call.
    const target = funcNode.text
    if (!target || BUILTIN_BARE_CALLS.has(target)) return
    // SWIFTD16: XCTest assertion FUNCTIONS (XCTAssertEqual/XCTFail/XCTSkip/...)
    // are the one capitalized free-function family in Swift — the capitalized-
    // call construction rule would fabricate `instantiates -> XCTAssertEqual`
    // (8,226 occurrences, 59% of all capitalized bare calls, per the swift-nio
    // census). They are not types; filtered like builtins (no edge).
    if (target.startsWith("XCT")) return

    const firstChar = target.charCodeAt(0)
    // SWIFTD17 (OO family closure #613 family sweep): the `length > 1` carve
    // out (inherited from M12.21 without rationale) mislabeled single-letter
    // constructions (`struct E: Error` / `E()`, 15 sites in the swift-nio
    // corpus tests) as `calls` instead of `instantiates` — capitalized is a
    // type-name signal regardless of length, and Swift's naming rules reserve
    // single capital letters for types (never free functions).
    const isCapitalized = firstChar >= 65 && firstChar <= 90

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
    // `self.x` -> uses (source = enclosing METHOD, target = leaf — #814). Other
    // receivers (locals, type names) emit nothing — only Swift's `this`.
    // self may sit one level down on a nested chain (`self.pipeline.readerIndex`
    // is navigation > navigation(self_expression) > suffix) — walk the RECEIVER
    // chain only. NEVER into calls: `self.decode(...)?.buffer` reads `.buffer`
    // off the CALL RESULT, not off self (the receiver chain ends at the call).
    // SCD1 (M37 #599 pre-wave, swift twin of java JAD1/kotlin KAD1): an
    // assignment LHS is a WRITE, never a read — `self.count = 0` emitted a
    // bogus `uses count`. The pinned grammar parses `=` and `+=` alike as
    // `assignment`, so one gate covers both (probe-verified); the LHS is
    // wrapped in `directly_assignable_expression`, so walk past it to the
    // assignment and gate only when this node sits INSIDE the LHS span
    // (the RHS of `self.count = self.count + 1` stays a genuine read).
    {
      // The walk must climb the whole ASSIGNABLE PATH, not just the
      // directly_assignable_expression wrapper: a nested member chain is one
      // navigation_expression inside another, and only the OUTER one hangs
      // directly off the wrapper. Walking through
      // directly_assignable_expression alone therefore missed every inner LHS
      // node, so `self.settings.pointee.on_body = …` emitted a bogus
      // `uses pointee` for the middle segment (F5 2026-09-12, swift-nio
      // HTTPDecoder.swift, unexplained=1) — the SCD1 rule broken from the
      // inside. RHS values are not on this path (they sit under
      // binary/call/collection nodes, which stop the walk), and the span check
      // below still decides: only nodes INSIDE the LHS span are writes.
      let a = node.parent
      while (a && (a.type === "directly_assignable_expression" || a.type === "navigation_expression" || a.type === "navigation_suffix")) a = a.parent
      if (a && a.type === "assignment") {
        const lhs = a.namedChild(0)
        if (lhs && lhs.startIndex <= node.startIndex && lhs.endIndex >= node.endIndex) return
      }
    }
    const hasSelf = this.hasSelfReceiver(node)
    if (!hasSelf) return

    // `self.helper()` is a METHOD CALL — the callee of a call_expression
    // emits `calls` via handleCall, never also `uses` (member reads only,
    // the M12.21 contract). Rust M12.18 uses the same parent-type gate.
    // SWIFTD17 exception: a SUBSCRIPT call (`self.items[key]`) is a property
    // ACCESS, not a method invocation — the base navigation IS a genuine
    // container read and must emit uses. Family precedent (probe-verified
    // 2026-09): php and objc both emit container-read uses for subscript
    // reads AND writes (`$this->items[$i]`, `self.items[i] = v`). The
    // pre-fix gate suppressed the base because it is the funcNode of a
    // call_expression — subscript and method calls were not distinguished.
    const par = node.parent
    if (par && par.type === "call_expression" && !this.isSubscriptRead(par)) return

    const leaf = this.navigationLeaf(node)
    if (!leaf) return

    // M49 W15 #814 (owner rule: converge on METHOD source). The original rule
    // sourced `self.x` to the enclosing TYPE (typeName first). The method is
    // the actor that reads, and the family now agrees on that: probe
    // `class Store { var count = 0; func read() -> Int { return self.count } }`
    // is the exact shape java/javascript pointed at, and resolving to the
    // method is what makes `x calls read` + `read uses count` compose into
    // reachability. A read at CLASS level (a property initializer) has no
    // method, so typeName remains the fallback.
    const source =
      (parent && (parent.kind === ASTEngine.SymbolKind.Method || parent.kind === ASTEngine.SymbolKind.Constructor)
        ? parent.name
        : null) ||
      typeName ||
      (parent?.ownerName ? parent.ownerName : null) ||
      parent?.name ||
      "root"
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

  /**
   * M49 #754 (CONV-SW-1): BARE member reads. The main walk only emits uses
   * for `self.x` navigation reads, so a plain `return count` on a declared
   * property emitted NOTHING while `return self.count` did (probe-confirmed
   * live: `uses edges on x: 0`). Mirrors java #739 / dart #752. Gate A: the
   * name must resolve to a DECLARED MEMBER of the enclosing type (the symbol
   * table's ownerName IS the enclosing type); gate B (CGD15): a name the
   * CURRENT function binds locally is not a member read — without it every
   * local/loop variable fabricates an edge.
   */
  private handleBareUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    emittedUses: Set<string>,
  ): void {
    const membersByOwner = new Map<string, Set<string>>()
    for (const s of symbols) {
      if (!s.ownerName) continue
      let set = membersByOwner.get(s.ownerName)
      if (!set) {
        set = new Set<string>()
        membersByOwner.set(s.ownerName, set)
      }
      set.add(s.name)
    }
    // Positions that DECLARE rather than read (`var count`), plus two that name
    // something other than a member of the ENCLOSING type: an argument label
    // (`group: channelEL`) names a parameter, and an implicit member expression
    // (`.regular`) resolves through a base the type checker infers. Both were
    // corpus false edges (nio FileType / Bootstrap) until gated here.
    const NOT_A_READ = new Set([
      "pattern", "parameter", "function_declaration", "protocol_function_declaration",
      "class_declaration", "protocol_declaration", "struct_declaration",
      "enum_declaration", "extension_declaration", "actor_declaration",
      "typealias_declaration", "associatedtype_declaration", "type_annotation",
      "user_type", "import_declaration", "attribute", "enum_entry",
      "value_argument_label",
    ])
    const TYPE_DECLS = new Set([
      "class_declaration", "protocol_declaration", "struct_declaration",
      "enum_declaration", "extension_declaration", "actor_declaration",
    ])
    const FUNC_SCOPES = new Set([
      "function_declaration", "protocol_function_declaration",
      "init_declaration", "deinit_declaration",
    ])
    // CGD15 value scopes: a name can also be BOUND by a `let` inside a computed
    // property or a closure. Treating only functions as scopes read those locals
    // as members (corpus false edges: nio EventLoop `fullNS`, TestUtils
    // `ipv6Loopback`).
    const VALUE_SCOPES = new Set(["lambda_literal", "property_declaration"])
    // SCD1 walk (same as handleSelfUse): climb the whole ASSIGNABLE PATH, then
    // gate only when this node sits INSIDE the assignment's LHS span.
    const isWrite = (n: Node): boolean => {
      let a = n.parent
      while (
        a && (a.type === "directly_assignable_expression" ||
          a.type === "navigation_expression" || a.type === "navigation_suffix")
      ) a = a.parent
      if (a && a.type === "assignment") {
        const lhs = a.namedChild(0)
        return !!lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex
      }
      return false
    }
    // A value scope's OWN name declares a member — it must not shadow itself
    // (`var description: String { ... }` still reads the member `description`).
    const ownNameSpan = (scope: Node): number => {
      if (scope.type === "property_declaration") {
        const pat = this.findChildByType(scope, "pattern")
        const id = pat ? this.findChildByType(pat, "simple_identifier") : null
        return id ? id.startIndex : -1
      }
      return -1
    }
    const collectBound = (node: Node, out: Set<string>): void => {
      const own = ownNameSpan(node)
      const w: Node[] = [node]
      while (w.length > 0) {
        const m = w.pop()!
        if (m.type === "simple_identifier" && m.startIndex !== own) {
          const pt = m.parent?.type ?? ""
          if (pt === "parameter" || pt === "pattern") out.add(m.text)
        }
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) w.push(c)
        }
      }
    }
    const extendLocals = (locals: Set<string>, scope: Node): Set<string> => {
      const bound = new Set<string>()
      collectBound(scope, bound)
      if (bound.size === 0) return locals
      const next = new Set(locals)
      for (const nm of bound) next.add(nm)
      return next
    }
    const walk = (n: Node, ty: string | null, fn: string | null, locals: Set<string>): void => {
      const t = n.type
      let cTy = ty
      let cFn = fn
      let cLocals = locals
      if (TYPE_DECLS.has(t)) {
        // Depth-first: `extension Foo` (and any qualified or generic name)
        // carries its name under `user_type`, where the shallow child search
        // finds nothing — so EVERY bare read inside an extension was silently
        // dropped (corpus finding: nio FileType, IPv4Header, EventLoop,
        // ByteBuffer — Swift puts a large share of its members in extensions).
        const nameNode =
          this.firstDescendantOfType(n, "type_identifier") ||
          this.firstDescendantOfType(n, "simple_identifier")
        if (nameNode) {
          cTy = nameNode.text
          cFn = null
        }
      } else if (FUNC_SCOPES.has(t)) {
        cFn = t === "init_declaration" ? "constructor" : (this.findChildByType(n, "simple_identifier")?.text ?? cFn)
        cLocals = extendLocals(locals, n)
      } else if (VALUE_SCOPES.has(t)) {
        cLocals = extendLocals(locals, n)
      }
      if (t === "simple_identifier") {
        const txt = n.text
        const pt = n.parent?.type ?? ""
        // SW-F (ultimate review): projected values (`$count` for @State
        // `count`) read the wrapped member. `$0`-style closure shorthands
        // (all digits) are never members.
        let lookup = txt
        if (lookup.startsWith("$")) {
          const rest = lookup.slice(1)
          if (!rest || this.isAllDigits(rest)) {
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) walk(c, cTy, cFn, cLocals)
            }
            return
          }
          lookup = rest
        }
        const isMember = !!cTy && (membersByOwner.get(cTy)?.has(lookup) ?? false)
        // A chain leaf (`self.x`, `obj.x`) is owned by handleSelfUse; a bare
        // CALLEE (`go(...)`) is owned by handleCall; a leading-dot implicit
        // member (`.regular`) infers its base, so it is not a read of THIS type.
        const isImplicitMember = pt === "prefix_expression" && (n.parent?.text ?? "").startsWith(".")
        if (
          !NOT_A_READ.has(pt) &&
          !isImplicitMember &&
          pt !== "navigation_suffix" &&
          pt !== "call_expression" &&
          !isWrite(n) &&
          !cLocals.has(txt) &&
          !cLocals.has(lookup) &&
          isMember
        ) {
          const source = cFn || cTy || "root"
          const key = `${source}\u0000uses\u0000${lookup}`
          if (!emittedUses.has(key)) {
            emittedUses.add(key)
            relationships.push({
              type: ASTEngine.RelationshipType.Uses,
              source,
              target: lookup,
              isExternal: false,
              weight: 0.7,
              confidence: 0.6,
              metadata: { isBareRead: true },
            })
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c, cTy, cFn, cLocals)
      }
    }
    walk(rootNode, null, null, new Set<string>())
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

      let confidence = 1.0
      let reasonCode: string | undefined

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
        if (declaring) {
          targetFqn = `${declaring}.${task.methodName}`
          // Companion-verified declaring parent — high confidence, below
          // the exact-in-file 1.0 (matches kotlin/scala's 0.9 tier).
          confidence = 0.9
          reasonCode = "companion-index"
        }
      }

      // Pass 3: deterministic per-file fallback — first hierarchy parent.
      // Confidence 0.5 (family parity with java/groovy resolveOverrides):
      // the parent may not even declare the method, and a guess emitted at
      // 1.0 was indistinguishable from a companion-verified override in
      // thresholded analysis — the exact anti-pattern java's Pass-3 comment
      // documents as fixed. classifyEvidenceTier then labels these
      // "inferred" instead of "structural" (confidence < 0.9 branch).
      if (!targetFqn && ownerH && ownerH.length > 0) {
        targetFqn = `${ownerH[0]}.${task.methodName}`
        // Confidence 0.5 (family parity with java/groovy resolveOverrides):
        // the parent may not even declare the method, and a guess emitted
        // at 1.0 was indistinguishable from a companion-verified override
        // in thresholded analysis — the exact anti-pattern java's Pass-3
        // comment documents as fixed. classifyEvidenceTier then labels
        // these "inferred" instead of "structural" (<0.9 branch).
        confidence = 0.5
        reasonCode = "first-parent-guess"
      }

      if (targetFqn) {
        relationships.push({
          type: ASTEngine.RelationshipType.Overrides,
          source: task.fqn,
          target: targetFqn,
          isExternal: true,
          weight: 0.8,
          confidence,
          metadata: { relationshipType: "method_override", isSwiftOverride: true, ...(reasonCode ? { reasonCode } : {}) },
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
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
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
          startColumn: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column + 1,
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

  /**
   * Depth-first (pre-order) first named descendant of the given type. Needed
   * where the node of interest is wrapped: a type declaration's name sits in a
   * direct `type_identifier` child for `struct Foo`, but under `user_type` for
   * `extension Foo` — so a shallow search finds nothing and the declaration
   * reads as nameless (#754 corpus finding).
   */
  private firstDescendantOfType(node: Node, type: string): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const x = stack.pop()!
      if (x.type === type) return x
      for (let i = x.namedChildCount - 1; i >= 0; i--) {
        const c = x.namedChild(i)
        if (c) stack.push(c)
      }
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
      if (!next && cur.type === "navigation_expression") {
        // Glued grammar shapes (probe-verified 2026-09, swift-nio corpus)
        // where self is the TRUE base of this navigation's suffix but sits
        // one wrapper deeper than the receiver chain followed. The wrapper
        // is the nav's FIRST child (the receiver spine):
        //   - `buf.readerIndex + self.count` parses as
        //     navigation > additive_expression(nav, self) > suffix(.count) —
        //     the suffix binds to the additive's RIGHT spine (self), and the
        //     left operand is an independent read walked separately.
        //   - `c_loop(&self.ctx, ...)` parses as
        //     navigation > prefix_expression(& self) > suffix(.ctx) — the
        //     inout `&` wraps the base; passing by reference is a genuine
        //     use (C-interop pattern, LinuxUring/SHA1).
        const spine = cur.namedChild(0)
        if (spine && (spine.type === "additive_expression" || spine.type === "prefix_expression")) {
          // The spine's direct self_expression IS the base (additive right
          // spine / inout prefix operand); otherwise continue the chain
          // through it (`&self.x.y` nests a nav inside the prefix).
          let selfChild: Node | null = null
          for (let i = 0; i < spine.namedChildCount; i++) {
            const c = spine.namedChild(i)
            if (c?.type === "self_expression") { selfChild = c; break }
          }
          if (selfChild) return true
          next = spine
        }
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

  /**
   * Leaf of a (possibly dotted) user_type: the LAST sibling type_identifier
   * (`Outer.Inner` -> Inner, `Foundation.URLSession` -> URLSession). The
   * user_type node holds its dotted segments as sibling type_identifier
   * children in source order (probe-verified 2026-09), so the leaf is simply
   * the last one. SWIFTD19: the pre-fix code returned the FIRST segment,
   * fabricating extends/implements edges to the wrong (module/container)
   * name — e.g. `class Sub2: Foundation.URLSession` became extends Sub2 ->
   * Foundation, and `extension Foo: SomeMod.Proto` became implements Foo ->
   * SomeMod.
   */
  private lastTypeIdentifier(ut: Node): Node | null {
    let last: Node | null = null
    for (let i = 0; i < ut.namedChildCount; i++) {
      const c = ut.namedChild(i)
      if (c && c.type === "type_identifier") last = c
    }
    if (last) return last
    // Fallback for non-flat user_types (nested user_type in user_type).
    const stack: Node[] = [ut]
    let best: Node | null = null
    while (stack.length > 0) {
      const c = stack.pop()!
      if (c.type === "type_identifier") {
        if (!best || c.startIndex >= best.startIndex) best = c
      }
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const child = c.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return best
  }

  private extractBaseName(spec: Node): string | null {
    // `user_type > type_identifier` — take the LEAF type identifier
    // (SWIFTD19: last segment of dotted names, family leaf convention).
    for (let i = 0; i < spec.namedChildCount; i++) {
      const c = spec.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier") return c.text
      if (c.type === "user_type") {
        const leaf = this.lastTypeIdentifier(c)
        if (leaf) return leaf.text
      }
    }
    const txt = spec.text.trim()
    return txt && !txt.includes(" ") ? txt : null
  }

  /** SW-F: all-ASCII-digits check without regex (family contract). */
  private isAllDigits(text: string): boolean {
    if (text.length === 0) return false
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c < 48 || c > 57) return false
    }
    return true
  }

  /** SW-G: receiver head of a navigation (`super`/`self`/`Self`/identifier). */
  private navigationReceiver(node: Node): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "self_expression") return "self"
      if (c.type === "super_expression") return "super"
      if (c.type === "simple_identifier" || c.type === "identifier" || c.type === "type_identifier") return c.text
      if (c.type === "navigation_expression") return this.navigationReceiver(c)
      return null
    }
    return null
  }

  /**
   * SW-B: document-order member texts of a navigation chain
   * (`P.Foo.bar` -> [P, Foo, bar]). The DIRECT receiver of the leaf method
   * is second-to-last — the ultimate head is wrong for 3+ chains. Never
   * descends into nested call_expressions (arguments are not chain
   * members: `a.b[x]` must yield [a, b], never [a, b, x]).
   */
  private navigationChain(node: Node): string[] {
    const out: string[] = []
    const stack: Node[] = [node]
    const seen: Node[] = []
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n !== node && n.type === "call_expression") continue
      seen.push(n)
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    seen.sort((a, b) => a.startIndex - b.startIndex)
    for (const n of seen) {
      if (n.type === "simple_identifier" || n.type === "identifier" || n.type === "type_identifier") {
        out.push(n.text)
      }
    }
    return out
  }

  /** SW-B: capitalized type-name signal (SWIFTD17 rule, shared). */
  private isTypeName(text: string): boolean {
    if (text.length === 0) return false
    const code = text.charCodeAt(0)
    return code >= 65 && code <= 90
  }

  /**
   * SW-A (ultimate review): NON-self navigation member reads. Every
   * navigation_suffix member reads unless (a) it is the invoked callee (its
   * navigation is the func of a non-subscript call and it is the last
   * suffix), (b) the chain is self-rooted (handleSelfUse owns those),
   * (c) it sits in an assignment-LHS span (SCD1), (d) it is an implicit-dot
   * member (`.regular` — base inferred, bare-uses parity), or (e) it names
   * self/Self/$0. Shares emittedUses with handleSelfUse (first metadata
   * wins) and sources identically (method > type > owner > name > root).
   */
  private handleMemberUses(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    typeName: string | null,
    emittedUses: Set<string>,
  ): void {
    if (this.hasSelfReceiver(node)) return
    const source =
      (parent && (parent.kind === ASTEngine.SymbolKind.Method || parent.kind === ASTEngine.SymbolKind.Constructor)
        ? parent.name
        : null) ||
      typeName ||
      (parent?.ownerName ? parent.ownerName : null) ||
      parent?.name ||
      "root"
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.type !== "navigation_suffix") continue
      const m = this.findChildByType(c, "simple_identifier") || this.findChildByType(c, "identifier")
      if (!m || !m.text) continue
      const member = m.text
      if (member === "$0" || member === "self" || member === "Self") continue
      // Callee: this navigation invokes through this suffix (non-subscript).
      const par = node.parent
      if (par && par.type === "call_expression" && !this.isSubscriptRead(par)) {
        let last = false
        for (let j = node.namedChildCount - 1; j >= 0; j--) {
          const s = node.namedChild(j)
          if (s && s.type === "navigation_suffix") {
            last = s.startIndex === c.startIndex && s.endIndex === c.endIndex
            break
          }
        }
        if (last) continue
      }
      // Implicit-dot root (`.regular`): the base is inferred, not THIS type.
      let outer: Node | null = node
      while (outer && outer.parent && outer.parent.type === "navigation_expression") outer = outer.parent
      const firstTok = outer ? outer.child(0) : null
      if (firstTok && !firstTok.isNamed && firstTok.type === ".") continue
      // SCD1 write gate (same climb as handleSelfUse/handleBareUses).
      let a = node.parent
      while (a && (a.type === "directly_assignable_expression" || a.type === "navigation_expression" || a.type === "navigation_suffix")) a = a.parent
      if (a && a.type === "assignment") {
        const lhs = a.namedChild(0)
        if (lhs && lhs.startIndex <= c.startIndex && lhs.endIndex >= c.endIndex) continue
      }
      const key = `${source}\u0000uses\u0000${member}`
      if (emittedUses.has(key)) continue
      emittedUses.add(key)
      relationships.push({
        type: ASTEngine.RelationshipType.Uses,
        source,
        target: member,
        isExternal: false,
        weight: 0.7,
        confidence: 0.9,
        metadata: { isMemberRead: true },
      })
    }
  }

  /**
   * SW-D (ultimate review): key-path members (`\.name`, `\C.name`) always
   * read the member identity.
   */
  private handleKeyPathUses(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    typeName: string | null,
    emittedUses: Set<string>,
  ): void {
    const source =
      (parent && (parent.kind === ASTEngine.SymbolKind.Method || parent.kind === ASTEngine.SymbolKind.Constructor)
        ? parent.name
        : null) ||
      typeName ||
      (parent?.ownerName ? parent.ownerName : null) ||
      parent?.name ||
      "root"
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "navigation_suffix") {
        const m = this.findChildByType(n, "simple_identifier") || this.findChildByType(n, "identifier")
        if (m && m.text && m.text !== "self" && m.text !== "Self") {
          const key = `${source}\u0000uses\u0000${m.text}`
          if (!emittedUses.has(key)) {
            emittedUses.add(key)
            relationships.push({
              type: ASTEngine.RelationshipType.Uses,
              source,
              target: m.text,
              isExternal: false,
              weight: 0.7,
              confidence: 0.9,
              metadata: { isMemberRead: true, isKeyPath: true },
            })
          }
        }
        continue
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
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
