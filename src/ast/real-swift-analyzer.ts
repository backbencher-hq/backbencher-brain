/**
 * Author: Muhammad Ishaq Khan
 *
 * Swift analyzer. Declarations (class/struct/enum/protocol/extension/func/var/typealias) plus the
 * dependency edges. The override/companion machinery lives in `override-context.ts` so that an
 * extension declaring its type's companion is resolved once rather than re-derived at every call site;
 * protocol conformance makes this lane one of the family's `implements` lanes.
 *
 * Relationship types it covers (all ten plus one extended): calls, extends, implements, instantiates,
 * uses, references, contains, overrides, exports, imports, and — the extended value landed
 * 2026-10-23 at rung R3, no grammar change — renders (a View type's `var body: some View` names the
 * component the type renders; see extractRenderRelationships below and the census at
 * validation/m14/fixtures/swift/m14-swift-extended-census-output.txt).
 * Grammar: `wasm/tree-sitter-swift.wasm` (pinned; grammar probes under validation/m14/fixtures/swift/).
 *
 * Where the rest of the lane lives: docs/analyzers/real-swift-analyzer.md · spec
 * script/m14/spec/swift-completeness.json · fixtures validation/m14/fixtures/swift/ · validation
 * validation/m14/results/ and validation/m14/verification/SWIFT-FIX.md.
 *
 * WHEN THIS FILE CHANGES, EDIT THESE TOO — a change here that skips them publishes a contract nobody
 * updated: `src/ast/override-context.ts` (the declaring-parent / override-companion resolution this
 * file relies on) · `src/ast/engine.ts` (the shared ParseResult/relationship contract) ·
 * `script/m14/spec/swift-completeness.json` (a new or removed node type changes a bucket) ·
 * `validation/m14/fixtures/swift/*.expectation.json` (the pins sections B and D read) ·
 * `script/m14/completeness-inventory.ts` (Lead-owned: this lane's requiredKinds/docs rows) ·
 * `docs/analyzers/real-swift-analyzer.md`.
 */
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
//       `first`); source = enclosing method. Bare builtins (print/String/
//       Int/...) are filtered (C# BuiltinsAreFiltered precedent).
//     - instantiates: bare CAPITALIZED call `User(...)` -> instantiates ONLY
//       (no calls edge — Swift construction syntax, Java `new Foo()` analog)
//     - uses:     ONLY `self.` member READS (Swift's `this`), source = the
//       enclosing METHOD, target = field leaf. Type references emit nothing.
//     - overrides: qualified `Owner.method -> Parent.method`, resolved via
//       the class hierarchy + shared companion index (Java/C# M12.02-03
//       semantics)
//     - references: file-scope imports -> `root -> module` (ObjC M12.19)
//     - exports:  a TOP-LEVEL declaration whose access level is public/open.
//       Swift has no `export` keyword (measured: 150 distinct node types from the
//       pinned grammar, none naming an export declaration; 0 anonymous `export`
//       tokens on 400 corpus files) — access control IS the export construct, the
//       same relation java derives from JLS 7.6. Source `root` = this file's scope.
//     - exports: SWIFTD21 — `@_exported import M`, Swift's one explicit
//       re-export verb, -> `root -> M`. The `public`/`open`/`package` module
//       interface is NOT emitted: a Swift file declares no module, so no
//       file-level construct can name the publisher. Measured, not asserted —
//       see docs/analyzers/swift-ontology-measurements.md.
//     - imports: the SAME import statement as a MODULE dependency, under the
//       family's first-class module-dependency label (c `#include`, go import
//       path, php `use`/require, haskell FFI entity). Target is the MODULE
//       (first dotted segment), so a scoped `import let WinSDK.IPPROTO_IP`
//       names `WinSDK` and carries the scoped item in metadata.
//     - exports: Swift's API surface — a FILE-SCOPE declaration whose access
//       level is public/open/package. A module re-export (`@_exported
//       import M`) is published on the `imports` edge instead, because a
//       MODULE is not a symbol and the family's export invariant requires an
//       export name to resolve to a top-level symbol.
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

// ---------------------------------------------------------------------------
// SWIFT4b — SCOPE, not just ownership. INCOMING_SWIFT JOB 2 rules that a
// declaration whose lexical owner is a BODY is a LOCAL and never a member or a
// module declaration. SWIFT4 enforced it for FUNCTION bodies with a parent-kind
// check; every OTHER body kept the enclosing TYPE as its frame's parent, so its
// locals were minted as members. Measured on the 1,256-file draw after the
// lane's oracle learned to read bodies correctly: 220+ fabricated
// `contains Type -> local` edges — `Lock -> err` from a `deinit`
// (lock.swift:89), `AtomicBox -> oldPtrBits`/`oldPtr` (atomics.swift:476-477),
// `NIONetworkInterface -> baseString`/`maskString` from `debugDescription`'s
// getter (Interfaces.swift:190-191), `ByteCount -> byteBufferMaxIndex` from
// `byteBufferCapacity`'s getter (ByteCount.swift:124).
//
// These are the BODY node types in the pinned grammar; entering one makes its
// contents local scope.
const LOCAL_SCOPE_BODIES = new Set([
  "function_body",
  "computed_property",
  "computed_getter",
  "computed_setter",
  "willset_didset_block",
  "willset_clause",
  "didset_clause",
  "lambda_literal",
])
// A container declaration opens its OWN member scope: a nested type's members
// ARE `contains Nested -> member` (the nested type itself is the local, not
// what it declares), and a nested function re-enters local scope at its own
// body. Clearing the flag here is what keeps those edges alive.
const SCOPE_RESET_DECLARATIONS = new Set([
  "class_declaration",
  "protocol_declaration",
  "function_declaration",
  "protocol_function_declaration",
  "init_declaration",
])

// The anonymous SCOPE-KIND tokens Swift's `import` grammar admits between the
// `import` keyword and the path (`import struct Foundation.URLSession`). The
// grammar's own token names, read by handleImport's importScopeKind.
const SWIFT_IMPORT_SCOPE_KINDS = new Set([
  "struct", "class", "enum", "func", "var", "let",
  "typealias", "protocol", "actor", "macro",
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
  /**
   * (#825 lineage, swift lane): the override DECLARATION's own line —
   * the method NAME's line, checkable against the source. Never a guess: an
   * edge whose declaration has no range stays unlined (the field's ruled
   * absence state) rather than borrowing the enclosing type's line.
   */
  line?: number
}

/**
 * SWIFTD21 (`@_exported import M`): the module this file's module re-publishes,
 * and the MODULE NAME's own node so the `exports` edge is lined at a site a
 * reader can check. Carried out of the walk and published after it, because the
 * relationship needs the same `root` source convention the `references` edge for
 * the same statement already uses (ObjC M12.19) and one statement must not
 * publish two differently-sourced edges.
 */
interface ReExportSite {
  module: string
  node: Node
  /**
   * Which Swift form spelled the re-export. `public_import` is SE-0409's
   * access-controlled import; `underscored_exported_import` is `@_exported`.
   * The two are DIFFERENT constructs that publish the same fact, so the form is
   * carried rather than flattened (DERIV_EXPORTS_SWIFT4 pins both by name, one
   * per fixture).
   */
  form: string
}

interface WalkFrame {
  node: Node
  parentSymbol: ASTEngine.UniversalSymbol | null
  typeName: string | null
  /** SWIFT4b: this node sits inside a BODY (see LOCAL_SCOPE_BODIES). */
  localScope: boolean
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

    // The PROJECT's cross-file declaration tables, when a caller supplied one.
    // See `crossFileTables` for what it reads and why it is inert when absent.
    const cross = this.crossFileTables(context, classHierarchy)

    const emittedCalls = new Set<string>()
    // #942: per-(source, leaf) CALL SITE counts. `emittedCalls` dedupes the
    // relationship list to one edge per (source, label, target), so two sites
    // sharing a (source, leaf) share ONE relationship — and an enum-construction
    // conversion at one of them must not retire the other's genuine call (nor
    // leave a dangling edge when the other site is gone). Counted per site, the
    // post-walk retires the edge only when no non-construction site remains.
    const callSiteCounts = new Map<string, number>()
    // (#825 lineage): the LINES of those sites, per (source, leaf).
    // `emittedCalls` keeps the FIRST site's edge, which after a #942
    // conversion may be a site that no longer emits a call — so a surviving
    // `calls` edge must be re-lined onto a site that is STILL a call, or the
    // line names a construction and is not checkable against the source.
    const callSiteLines = new Map<string, number[]>()
    const emittedUses = new Set<string>()
    const emittedContains = new Set<string>()
    // SW-B candidates: navigation calls with capitalized heads, resolved
    // post-walk against declared enum cases (symbols must be whole first).
    const enumCtorCandidates: Array<{ source: string; head: string | null; owner: string | null; leaf: string; removeCalls: boolean; line?: number }> = []
    // SW-G: class -> superclass (first base when it IS a superclass),
    // recorded at declaration time for `super.init(...)` targets.
    const superByClass = new Map<string, string>()
    // SWIFTD21: `@_exported import M` sites, resolved to `exports` edges after
    // the walk (they need no symbol table, but they share the references edge's
    // emission site so one statement cannot publish two differently-sourced rows).
    const reExports: ReExportSite[] = []
    // DERIV_EXPORTS_SWIFT4: the SOURCE of every `exports` edge is the file's own
    // leaf name — typescript's moduleLeafName() spelling for a module-level edge
    // endpoint, and NOT the literal `root` this analyzer uses for `references`.
    // `root` is in parallel-indexer's SYMBOL_NAME_DENYLIST, so an edge sourced
    // there can never bind to a stored symbol; an `exports` TARGET is a
    // declaration in this very file and DOES bind (pinned by
    // swift/exports-visibility, whose forbid list names `exports root -> Shape`).
    const moduleSource = this.moduleLeafName(filePath)
    // One name, one row: a second declaration publishing a name the compiler
    // would reject the file for, and a duplicate row is noise a reader cannot
    // act on (go GO7's export-uniqueness invariant). Shared by the visibility
    // exports emitted in the walk and the module re-exports emitted after it.
    const emittedExportNames = new Set<string>()

    const stack: WalkFrame[] = [
      { node: rootNode, parentSymbol: null, typeName: null, localScope: false },
    ]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node: curr, parentSymbol, localScope } = popped
      let newParentSymbol = parentSymbol
      let newTypeName = popped.typeName
      // SWIFT4b: the scope THIS node's children inherit. A body node makes its
      // contents LOCAL; a container declaration opens a fresh member scope; any
      // other node propagates the frame's scope.
      const nominalRecovery = curr.type === "ERROR" && this.isNominalRecovery(curr)
      const childLocalScope = SCOPE_RESET_DECLARATIONS.has(curr.type) || nominalRecovery
        ? false
        : (LOCAL_SCOPE_BODIES.has(curr.type) ? true : localScope)

      if (curr.type === "import_declaration") {
        this.handleImport(curr, imports, frameworksObj, reExports)
      } else if (curr.type === "protocol_declaration") {
        newParentSymbol = this.handleProtocol(curr, symbols, relationships, parentSymbol, patternsObj, classHierarchy, localScope)
        if (newParentSymbol) newTypeName = newParentSymbol.name
      } else if (curr.type === "class_declaration") {
        newParentSymbol = this.handleDeclaration(curr, symbols, relationships, parentSymbol, patternsObj, classHierarchy, inFileKinds, cross.kinds, superByClass, localScope)
        if (newParentSymbol) newTypeName = newParentSymbol.name
      } else if (nominalRecovery) {
        // SW-D23 (#940): the pinned grammar fails to REDUCE some nominal
        // headers (measured: `nonisolated(unsafe)` in the body costs
        // AsyncTestingChannel.swift its whole `class` header — the header and
        // body land in an ERROR node instead). Nothing reduces it back, so
        // the container symbol was never minted and every member it owns was
        // orphaned (ownerName undefined: no `contains`, no member inventory
        // for bare reads, no owner for `self.init`). The recovery shape is
        // read from the tokens alone — the kind is the same anonymous keyword
        // token SWIFTD1 already decides by, the name is the recovery's own
        // name node — never from source text.
        newParentSymbol = this.handleDeclaration(curr, symbols, relationships, parentSymbol, patternsObj, classHierarchy, inFileKinds, cross.kinds, superByClass, localScope)
        if (newParentSymbol) newTypeName = newParentSymbol.name
      } else if (curr.type === "function_declaration" || curr.type === "protocol_function_declaration") {
        newParentSymbol = this.handleFunction(curr, symbols, relationships, parentSymbol, overrideTasks, context?.overrideCompanion, localScope)
      } else if (curr.type === "init_declaration") {
        // init -> constructor named "constructor" (Java/C# family convention)
        const vis = this.getVisibility(curr)
        const meta: Record<string, any> = {}
        const funcAttrs = this.extractAttributes(curr)
        if (funcAttrs.length > 0) meta.annotations = funcAttrs
        const sym = this.createSymbol("constructor", ASTEngine.SymbolKind.Constructor, curr, parentSymbol, symbols, meta, vis, this.getDeclaredVisibility(curr), localScope)
        this.collectFunctionMeta(curr, meta, sym)
        newParentSymbol = sym
      } else if (curr.type === "deinit_declaration" || curr.type === "subscript_declaration") {
        // Not symbols (ObjC dealloc / C# indexer-not-materialized precedent).
      } else if (
        curr.type === "property_declaration" ||
        curr.type === "protocol_property_declaration"
      ) {
        this.handleVariable(curr, symbols, parentSymbol, newTypeName, frameworksObj, patternsObj, localScope)
      } else if (curr.type === "enum_entry") {
        // enum_member ONLY inside an enum body — the parent symbol is the
        // enum. Switch `case` patterns are never symbols.
        if (!localScope && parentSymbol && parentSymbol.kind === ASTEngine.SymbolKind.Enum) {
          // #924 (swift half): an attributed case (`@available(...) case x`)
          // puts a `modifiers` node FIRST, so taking the first named child
          // published the ATTRIBUTE PAYLOAD as the member's name — 5 cases in
          // swift-nio HTTPTypes.swift became `@available(*, deprecated,
          // message: "Cannot be thrown")`, the real names were absent, and the
          // dedupe folded all five into one `contains` target whose "name" is
          // a decorator payload. The name is the identifier after `case`; the
          // modifiers are metadata (surface them there, never as a name).
          let caseNode: Node | null = null
          for (let i = 0; i < curr.namedChildCount; i++) {
            const c = curr.namedChild(i)
            if (!c || c.type === "modifiers" || c.type === "attribute") continue
            caseNode = c
            if (c.type === "simple_identifier" || c.type === "identifier") break
          }
          const caseName = caseNode ? caseNode.text : curr.text
          if (caseName && caseName !== "case") {
            // The IDENTIFIER node carries the range, exactly as functions use
            // their name node: a decorated declaration's line is its own `case`
            // line, never the decorator's (the #861 decorated-range ruling,
            // applied to swift).
            this.createSymbol(caseName, ASTEngine.SymbolKind.EnumMember, caseNode ?? curr, parentSymbol, symbols, { enumCase: true })
          }
        }
      } else if (curr.type === "typealias_declaration") {
        const nameNode = this.findChildByType(curr, "type_identifier") || this.firstNamedChild(curr)
        if (nameNode && (nameNode.type === "type_identifier" || nameNode.type === "simple_identifier" || nameNode.type === "identifier")) {
          // DERIV_EXPORTS_SWIFT: these two branches were the only ones that never
          // read the declaration's visibility, so `createSymbol` fell back to its
          // "internal" default and a `public typealias X` published visibility
          // `internal` — the symbol contract's visibility row claims this field is
          // supported, and for this declaration kind it was not read at all. The
          // export rule reads the same field, so leaving it would have made
          // `public typealias` silently unexportable.
          this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Type, curr, parentSymbol, symbols, { isTypeAlias: true }, this.getVisibility(curr), this.getDeclaredVisibility(curr), localScope)
        }
      } else if (curr.type === "associatedtype_declaration") {
        const nameNode = this.findChildByType(curr, "type_identifier") || this.firstNamedChild(curr)
        if (nameNode && (nameNode.type === "type_identifier" || nameNode.type === "simple_identifier" || nameNode.type === "identifier")) {
          this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Type, curr, parentSymbol, symbols, { isAssociatedType: true }, this.getVisibility(curr), this.getDeclaredVisibility(curr), localScope)
        }
      } else if (curr.type === "call_expression") {
        this.handleCall(curr, relationships, parentSymbol, emittedCalls, enumCtorCandidates, superByClass, callSiteCounts, callSiteLines)
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

      // DERIV_EXPORTS_SWIFT4 — `exports`: a FILE-SCOPE declaration whose access
      // level is `public`/`open`/`package` is part of the module's interface.
      // `parentSymbol === null` IS the file-scope test at declaration time, and
      // it is what excludes a member (its parent is the owning type or
      // extension) and a type declared inside a function body (its parent is
      // the function). Extensions are excluded by isExportingDeclaration: an
      // extension is named after the EXTENDED type, so exporting it would name
      // a declaration this file does not contain.
      if (parentSymbol === null && !localScope && this.isExportingDeclaration(curr)) {
        this.emitDeclarationExport(curr, moduleSource, relationships, exports, emittedExportNames)
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
        if (child) stack.push({ node: child, parentSymbol: newParentSymbol, typeName: newTypeName, localScope: childLocalScope })
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
        // #942: retire the contributing SITES, then drop a `calls` edge whose
        // site count fell to zero, then append the instantiates edges. Splice
        // by (source, leaf) alone took a DIFFERENT site's genuine call — and
        // splicing this candidate's own index alone under-retired, because the
        // dedupe had already folded a second site into the same relationship.
        const retiredSites = new Set<string>()
        // PER POOL, never global: two different pools can share a SOURCE LINE
        // (`XCTAssertLessThanOrEqual(MemoryLayout.size(ofValue: Level1.case1(...)), 24)`
        // puts a `size` call and a `case1` conversion on one line), and a
        // global line set would re-line — or delink — an unrelated edge.
        const retiredLines = new Map<string, Set<number>>()
        const constructions: Array<{ source: string; target: string; line?: number }> = []
        for (const cand of enumCtorCandidates) {
          const key = cand.head ?? cand.owner
          if (!key || !enumCases.has(`${key}.${cand.leaf}`)) continue
          if (cand.removeCalls) {
            const siteKey = `${cand.source}\u0000${cand.leaf}`
            const left = (callSiteCounts.get(siteKey) ?? 0) - 1
            callSiteCounts.set(siteKey, left)
            if (typeof cand.line === "number") {
              const set = retiredLines.get(siteKey)
              if (set) set.add(cand.line)
              else retiredLines.set(siteKey, new Set([cand.line]))
            }
            if (left <= 0) retiredSites.add(siteKey)
          }
          constructions.push({ source: cand.source, target: key, line: cand.line })
        }
        if (retiredSites.size > 0) {
          for (let i = relationships.length - 1; i >= 0; i--) {
            const r = relationships[i]
            if (r.type !== ASTEngine.RelationshipType.Calls) continue
            if (!retiredSites.has(`${r.source}\u0000${String(r.target)}`)) continue
            relationships.splice(i, 1)
          }
        }
        // Re-line the SURVIVING calls edges onto a site that is still a call
        // (#942 + ): the edge kept by the dedupe is the first site's, and
        // that site may be exactly the one this conversion retired — the
        // construction edge above already carries it.
        if (callSiteLines.size > 0) {
          for (const r of relationships) {
            if (r.type !== ASTEngine.RelationshipType.Calls) continue
            const key = `${r.source}\u0000${String(r.target)}`
            const lines = callSiteLines.get(key)
            if (!lines) continue
            const retired = retiredLines.get(key)
            if (!retired) continue
            let kept: number | undefined
            for (const l of lines) {
              if (!retired.has(l)) { kept = l; break }
            }
            // No surviving DISTINCT line means the pool's sites share the
            // retired line — a call still lives on it, so the current line
            // stays right and is never dropped.
            if (typeof kept === "number") r.line_number = kept
          }
        }
        for (const c of constructions) {
          const ekey = `${c.source}\u0000instantiates\u0000${c.target}`
          if (emittedCalls.has(ekey)) continue
          emittedCalls.add(ekey)
          relationships.push({
            type: ASTEngine.RelationshipType.Instantiates,
            source: c.source,
            target: c.target,
            isExternal: true,
            weight: 0.7,
            confidence: 0.95,
            // The CONVERTED call site's line, carried on the candidate.
            ...(typeof c.line === "number" ? { line_number: c.line } : {}),
            metadata: { isEnumConstruction: true },
          })
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
      // M14 endpoint integrity: a declaration the parser recovered with NO name
      // (measured: swift-corpus's validation-test/compiler_crashers_fixed/
      // 27700-swift-modulefile-loadallmembers.swift, whose `let:Boolean` yields a
      // symbol with name "") has no target to name. An edge with an empty endpoint
      // is a defect in the emitting lane: the fleet instrument counts it in `edges`
      // and then skips it in every class (incoming-gate.ts's `if (tgt.length === 0)
      // continue`), which is exactly the unclassed edge the declaration gate refuses
      // to ratchet. The nameless symbol still exists in `symbols` — only the edge is withheld.
      if (_owner && s.name && s.kind !== ASTEngine.SymbolKind.Extension) {
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
            // The DECLARATION's own line (the member's range start).
            ...(typeof s.range?.startLine === "number" ? { line_number: s.range.startLine } : {}),
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
          // The import statement's own line (handleImport records the range).
          ...(typeof imp.range?.startLine === "number" ? { line_number: imp.range.startLine } : {}),
          // `isImportNameReference` is the marker the `references` family uses to
          // say this edge names a MODULE brought into scope rather than a symbol
          // the graph holds (INCOMING_SWIFT JOB 2, preserved by DERIV_EXPORTS_SWIFT4).
          // It is why leaving `references` in place beside `imports` is not a
          // duplicate claim: the two carry different markers and answer different
          // questions ("what names came into scope" vs "what does this file depend on").
          //
          // M14 SWIFT RESIDUAL — THE CLAIM MOVES ONTO THE KEY THE ARBITER READS.
          // `isExternal: true` has been set on this RELATIONSHIP since INCOMING_SWIFT
          // JOB 2, and `externalClaimOf` (script/m14/incoming-rule.ts:396) reads
          // `rel.metadata` ONLY — so the statement was invisible and the lane's `extOK`
          // column read 0 while its own sentence above said "a MODULE brought into scope
          // rather than a symbol the graph holds". Measured on the 400-file bounded run
          // (`m14-swift-cause-probe.mts`): 916 `references` + 900 `imports` edges are
          // unresolvable, every one of them naming a module no file in the run declares
          // (Foundation, UIKit, XCTest, Flutter, NIOCore …). Publishing the SAME claim
          // inside `metadata` is ROUTING, not a new judgement. It cannot move a
          // resolution: `classifyEdge` consults a claim only where the run declares no
          // symbol of that name (`:1147`), and with a declaration present it reads the
          // claim "to RECORD it, never to move the outcome" (`:1188-1194`) — so
          // `resolved`, `collRes` and `amb(decl)` are untouched in both directions.
          metadata: { importModule: imp.module, isImportNameReference: true, isExternal: true },
        })
      }
    }
    // SWIFTD21: `exports` — the re-export half of an `@_exported import M`.
    //
    // SOURCE (superseded by DERIV_EXPORTS_SWIFT4, the pin wave that decides it):
    // the source is the FILE'S LEAF NAME, not the literal `root`. The
    // root-sourcing argument was that Swift's file declares no module, so no
    // file-level construct can name one — and that argument is right about
    // MODULES and wrong about EDGE ENDPOINTS. `root` is in parallel-indexer's
    // SYMBOL_NAME_DENYLIST, so an edge sourced there can never bind to a stored
    // symbol; the family spells a file-as-module endpoint with the file's leaf
    // name (typescript's moduleLeafName(), go's packageName, python's
    // moduleName), and swift/exports-visibility pins that spelling — including
    // the forbid `exports root -> Shape`. The leaf is a name for the file this
    // edge was read from, not a claim that SwiftPM's module is called that; a
    // consumer that needs the compiled module name still cannot get it here,
    // which is why the endpoint is spelled the way every other lane spells the
    // file it parsed.
    //
    // SCOPE: this block is the explicit re-export half (`public import` per
    // SE-0409, and `@_exported import`). The declaration half — a `public`/
    // `open`/`package` FILE-SCOPE declaration, 8,091 sites in 979 files of the
    // same sample — is emitted beside it in the walk, through
    // isExportingDeclaration / emitDeclarationExport, under the SAME leaf-name
    // source, so one module interface carries one source spelling.
    //
    // Confidence 1.0: `@_exported` is SPELLED on the statement, so this is a fact
    // about the declaration rather than an inference about it. `classifyEvidenceTier`
    // labels it `import_based`, the same tier as the `references` edge beside it.
    //
    // WHY the module IS an `ExportInfo` row, `type: "module"`: the harness's
    // export invariant requires every export name to resolve to a top-level
    // symbol, and a MODULE is not one — which is exactly what the row's own
    // `type: "module"` declares. The name is importable by construction (that is
    // what a re-export means) and the binding is the import statement in this
    // same file, published as the `imports` edge carrying `isModuleReExport`.
    // run-fixtures.ts admits the row on those grounds — its invariant opens "an
    // export must name an IMPORTABLE UNIT, i.e. a name an importer can bind" —
    // corroborated by that import edge, so the exemption cannot be claimed by
    // labeling a member a module. The alternative (no row, to dodge the check)
    // was rejected: DERIV_EXPORTS_SWIFT4 was authored with the rows, and hiding
    // a real binding because a check's premise does not cover it is the wrong
    // direction — the check gains the category instead.
    {
      const seen = new Set<string>()
      for (const re of reExports) {
        const key = `${moduleSource}\u0000${re.module}`
        if (seen.has(key)) continue
        seen.add(key)
        const reLine = this.nodeLine(re.node)
        relationships.push({
          type: ASTEngine.RelationshipType.Exports,
          source: moduleSource,
          target: re.module,
          isExternal: true,
          weight: 0.9,
          confidence: 1.0,
          // The MODULE NAME's own line — the site a reader checks, the same node
          // the ImportInfo row and the references edge are lined at (
          // `@_exported\nimport Basic` lines the edge at the module name, 11,
          // never the attribute's line, 10).
          ...(typeof reLine === "number" ? { line_number: reLine } : {}),
          // M14 SWIFT RESIDUAL: `@_exported import M` re-exports a MODULE, and the
          // relationship already says `isExternal: true` (`:768`) — but the arbiter
          // reads `metadata`. Same routing, same safety, as the `references`/`imports`
          // edges: a claim is consulted only where the run declares no symbol of that
          // name, so no resolution can move. The `exports` INFO row below keeps its
          // metadata unchanged: it is a declaration, not an external claim.
          metadata: { exportForm: re.form, reExport: true, reexportsModule: re.module, isExternal: true },
        })
        if (!emittedExportNames.has(re.module)) {
          emittedExportNames.add(re.module)
          exports.push({
            name: re.module,
            type: "module",
            range: {
              startLine: re.node.startPosition.row + 1,
              startColumn: re.node.startPosition.column + 1,
              endLine: re.node.endPosition.row + 1,
              endColumn: re.node.endPosition.column + 1,
              startIndex: re.node.startIndex,
              endIndex: re.node.endIndex,
            },
            metadata: { exportForm: re.form, reExport: true, reexportsModule: re.module },
          })
        }
      }
    }

    // (The visibility half of `exports` — a FILE-SCOPE `public`/`open`/`package`
    // declaration — is emitted IN THE WALK, at `isExportingDeclaration`, so the
    // edge endpoint and the name node come from the declaration being visited
    // rather than from the symbol table. DERIV_EXPORTS_SWIFT4 supersedes the
    // symbol-table version that stood here: it was sourced at `root`, which
    // cannot bind, and it carried the `swift_access_level` vocabulary that no
    // fixture pins. See emitDeclarationExport below.)

    // ----------------------------------------------------------------------------
    // ONTOLOGY: `imports` — the module dependency, under its own label.
    //
    // The `references` edge above is UNCHANGED and stays: the differential's
    // swift oracle derives `references: root -> <spelled path>` (differential.ts
    // deriveSwiftEdges, the import_declaration branch), so removing or relabelling
    // it here would be a change this lane cannot make (the oracle and
    // validation/m14/differential-baseline.json are master-owned) and would be a
    // silent product regression for every consumer that reads `references`.
    //
    // So this lane ADDS the family's first-class module-dependency label beside
    // it rather than moving the fact. That is the bash BD9 precedent — bash emits
    // `imports` AND `references` from one `source`/`.` construct with different
    // markers (`isSourceImport` vs `isSourceDependency`) — and it is what makes
    // Swift's module dependency answerable by the kind bb_graph actually groups
    // on: src/lsp/graph_request.ts reads rows typed `imports` with both endpoints
    // NULL and `source_external = <file>` into the file-level `dependencies`
    // section, which is "what does this file import". `fileLevel: true` is what
    // makes the parallel-indexer put the IMPORTING FILE in `source_external`
    // instead of the placeholder string `root` (the M60/#910 contract).
    //
    // Two lanes argue against carrying both labels for one fact (go's R10 note
    // and ruby's "a third time under a second label"). R10's argument is about
    // SEPARATORS — `net/http`, `github.com/…/cmp` — that no Go declaration can
    // contain; Swift's module specifier is a bare capitalized identifier, so
    // R10 does not bite here. The stronger form of their point (one fact, one
    // edge) is nonetheless correct, and resolving it needs the swift oracle and
    // the baseline changed together: REPORTED to master, not done here.
    // ----------------------------------------------------------------------------
    const emittedImports = new Set<string>()
    // How many SCOPED imports of each module this file makes. The edge is one per
    // MODULE (pinned: `import Foundation` plus `import struct
    // Foundation.URLSession` is one `imports Foundation`), so when a module is
    // scoped N>1 times the edge's `scopedItem` — a single-valued field copied
    // from the first statement that mentioned the module — names one of N and
    // reads as if it named all of them.
    //
    // Measured on the corpus before this rule (swift-nio + alamofire + apple/swift
    // tracked files): 25 (file, module) pairs scope-import one module 2+ times,
    // and the largest is swift-nio's Sources/NIOCore/BSDSocketAPI.swift with 37
    // scoped `WinSDK` imports. So the partial field was not a corner case.
    //
    // The rule: `scopedItem` is published only when the module has EXACTLY ONE
    // scoped import in the file. Above that it is dropped and the count is
    // published instead, because a field that is silently partial is worse than a
    // field that is absent. Nothing is lost — every statement keeps its own
    // `ImportInfo` row with its own `scopedItem`, which is the per-statement
    // record and is unchanged by this.
    const scopedImportsPerModule = new Map<string, number>()
    for (const imp of imports) {
      const imd = (imp.metadata ?? {}) as Record<string, any>
      const im = typeof imd.module === "string" ? imd.module : null
      if (!im || imd.isScopedImport !== true) continue
      scopedImportsPerModule.set(im, (scopedImportsPerModule.get(im) ?? 0) + 1)
    }
    for (const imp of imports) {
      const md = (imp.metadata ?? {}) as Record<string, any>
      // The module name comes from the statement's own metadata, with the
      // first-segment rule re-applied as a fallback so this channel can never go
      // silently dead again: keying on a metadata field that the producer does not
      // set emitted 0 `imports` edges while every other type stayed live, and the
      // fixture that pins this (`swift/scoped-import-metadata`) read the absence as
      // a missing rule rather than as a broken producer.
      const spelled = typeof imp.module === "string" ? imp.module : ""
      const moduleName =
        typeof md.module === "string" && md.module ? md.module : spelled.split(".")[0] || null
      if (!moduleName || emittedImports.has(moduleName)) continue
      emittedImports.add(moduleName)
      const scopedHere = scopedImportsPerModule.get(moduleName) ?? 0
      const edgeMd: Record<string, any> = {
        ...md,
        // `isImport` is the MARKER the completeness section-B inventory reads,
        // so the kind is claimed twice over (go GO precedent) and the evidence
        // tier stays import_based.
        isImport: true,
        isModuleDependency: true,
        // #910: the importer is this FILE, so the indexer must be told this is
        // a file-level edge rather than a scope placeholder named `root`.
        fileLevel: true,
        // M14 SWIFT RESIDUAL: the same module-external claim the `references` edge
        // carries, on the key the arbiter reads — see the block at that edge above.
        // `isExternal` was already `true` on this relationship (`:893`); `metadata` is
        // the only place `externalClaimOf` looks.
        isExternal: true,
      }
      if (scopedHere > 1) {
        delete edgeMd.scopedItem
        edgeMd.scopedItemCount = scopedHere
      }
      relationships.push({
        type: ASTEngine.RelationshipType.Imports,
        source: "root",
        target: moduleName,
        isExternal: true,
        weight: 0.9,
        confidence: 1.0,
        // The MODULE NAME's own line (handleImport records the name node's
        // range), the same site the references edge names.
        ...(typeof imp.range?.startLine === "number" ? { line_number: imp.range.startLine } : {}),
        metadata: edgeMd,
      })
    }

    // ----------------------------------------------------------------------------
    // `exports` — SUPERSEDED BLOCK, deliberately removed rather than kept beside
    // the walk emission. It read the symbol table and published every file-scope
    // `public`/`open`/`package` symbol at `source: "root"` with the
    // `access_level` vocabulary. DERIV_EXPORTS_SWIFT4 replaces it on three
    // counts, all pinned: the source is the file's LEAF NAME (root cannot bind
    // — it is in parallel-indexer's SYMBOL_NAME_DENYLIST), the form vocabulary
    // is `visibility_modifier` / `public_import` / `underscored_exported_import`
    // and the evidence class keys on it (`reExport` → import_based), and the
    // MODULE re-export is an `ExportInfo` row (`type: "module"`) rather than an
    // edge-only fact. Two implementations of one rule is exactly the shape that
    // produced the earlier `imports` dead channel: the emission now lives in ONE
    // place, the walk, reached through isExportingDeclaration.
    // ----------------------------------------------------------------------------

    this.resolveOverrides(
      overrideTasks,
      classHierarchy,
      symbolMap,
      relationships,
      context?.overrideCompanion ?? cross.companion,
      cross.getParents(classHierarchy),
    )
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
      if (type === "imports" || type === "references") { md.evidenceClass = "import_based"; continue }
      // DERIV_EXPORTS_SWIFT4: the two halves of Swift's export surface carry
      // DIFFERENT evidence classes, and `reExport` is the discriminator. A
      // visibility-modifier export is a grammar clause read off the
      // declaration's own `modifiers` node — structural, confidence 1.0, nothing
      // inferred. A re-exporting import (`public import` / `@_exported import`)
      // is import-based, the same class as the `references` edge beside it. The
      // marker is `reExport` rather than `exportForm` so a new form spelling
      // cannot silently inherit the wrong class.
      if (type === "exports") {
        md.evidenceClass = md.reExport === true ? "import_based" : "structural"
        continue
      }
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
    localScope: boolean = false,
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
    const symbol = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Interface, nameNode, parent, symbols, meta, vis, this.getDeclaredVisibility(node), localScope)

    // Protocol inheritance IS materialized as extends edges (family
    // contract, probe-verified 2026-09: csharp `interface IX : IA` ->
    // extends, java `interface IX extends IA` -> extends, objc
    // `@protocol B <A>` -> extends). The AnyObject / Any markers in the
    // inheritance list are CLASS-CONSTRAINT annotations, not protocol
    // parents — excluded (probe-verified: `protocol P: AnyObject, B` in
    // swift-nio parses AnyObject as an inheritance_specifier).
    const baseSites = this.extractBaseSites(node)
    const parents: string[] = []
    for (let i = 0; i < baseSites.length; i++) {
      const base = baseSites[i].name
      if (base === "AnyObject" || base === "Any") continue
      parents.push(base)
      relationships.push({
        type: ASTEngine.RelationshipType.Extends,
        source: symbol.name,
        target: base,
        isExternal: true,
        weight: 1,
        confidence: 1.0,
        // The base SPECIFIER's own line in the inheritance clause.
        line_number: this.nodeLine(baseSites[i].node),
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
    localScope: boolean = false,
  ): ASTEngine.UniversalSymbol | null {
    let kind = ASTEngine.SymbolKind.Class

    // SW-D23 (#940): a recovered header decides its kind from the header's own
    // keyword token, NOT from the deep search below — the deep search sees a
    // nested declaration's keyword and would name the container after it.
    const recoveredKind = node.type === "ERROR" ? this.recoveryKind(node) : null
    if (recoveredKind) {
      kind = recoveredKind
    } else if (this.hasAnonToken(node, "actor")) {
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
    const recoveredName = node.type === "ERROR" ? this.recoveryNameNode(node) : null
    if (recoveredName) {
      nameNode = recoveredName
    } else if (kind === ASTEngine.SymbolKind.Extension) {
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

    const symbol = this.createSymbol(rawName, kind, nameNode, parent, symbols, meta, vis, this.getDeclaredVisibility(node), localScope)

    const baseSites = this.extractBaseSites(node)
    const bases = baseSites.map((b) => b.name)
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
          line_number: this.nodeLine(baseSites[i].node),
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
      for (let i = 0; i < baseSites.length; i++) {
        const base = baseSites[i].name
        parents.push(base)
        relationships.push({
          type: ASTEngine.RelationshipType.Implements,
          source: symbol.name,
          target: base,
          isExternal: true,
          weight: 0.9,
          confidence: 1.0,
          line_number: this.nodeLine(baseSites[i].node),
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
          line_number: this.nodeLine(baseSites[i].node),
          metadata: { isImplements: true },
        })
      }
    }

    // `renders` — A COMPONENT RENDERS ANOTHER COMPONENT (R3, no grammar change).
    //
    // THE CONTRACT (`src/ast/types.ts:145-154`): *"A component RENDERS another
    // component: source = the rendering symbol, target = the rendered
    // component."* The fleet's four `renders` lanes all use this shape, and the
    // dart lane's is the one this copies (`real-dart-analyzer.ts:4274`,
    // extractRenderRelationships): the COMPONENT is the source and the RENDERED
    // COMPONENT'S NAME is the target, with the DECLARED TYPE as the host
    // discriminator — because A FILTER ON THE NAME DOES NOT SEPARATE THE
    // CONSTRUCT FROM ITS IMPOSTORS; A FILTER ON THE DECLARED TYPE DOES (the
    // dart lane measured 5,893 `build` methods, 5,578 returning something that
    // is not a component, 5,350 returning Widget).
    //
    // FOR SWIFT THE CONSTRUCT IS SWIFTUI'S `var body: some View` — the
    // rendering entry point, exactly what Flutter's `build` method is:
    //   struct ContentView: View {
    //     var body: some View { VStack { Text("hi") } }
    //   }
    // `ContentView` IS the component and `VStack` IS the component it renders —
    // the structural analogue of a React component returning `<VStack/>`.
    // Tree-dump-proven on the served build (41c4fdb2…): the shape parses as
    // property_declaration > pattern[body] + type_annotation > opaque_type[some
    // View] + computed_property > statements > call_expression[VStack].
    //
    // THE TRIGGER, AND BOTH HALVES ARE MEASURED (the census,
    // validation/m14/fixtures/swift/m14-swift-extended-census-output.txt, whole
    // admitted 1,507-file population):
    //   · the enclosing type CONFORMS TO `View` (72 conformances over 38
    //     files) — the framework's own marker, so a `body` property on a
    //     non-View type is not a rendering host (the protobuf-builder shape);
    //   · the property is named `body` AND its type_annotation is `some View`
    //     (85 sites over 38 files) — SwiftUI's own rendering-entry convention.
    // Requiring BOTH the conformance and the typed `body` keeps the dart
    // lesson: neither half alone separates the construct from its impostors.
    //
    // WHAT DOES NOT FIRE, each pinned by the fixture:
    //   · a construction DEEPER than the body's top-level expression — an
    //     argument (`NavigationLink(destination: DetailView())`) is an
    //     ordinary instantiates/calls row; only the top-level DSL call names
    //     what the body RENDERS (dart's "a construction that is NOT the
    //     returned expression" refusal);
    //   · a `body` on a type that does not conform to View — not a host;
    //   · a lowercase or non-DSL top-level call — a `calls` row, unchanged
    //     (a SwiftUI intrinsic that builds no component, the JS lane's
    //     lowercase-tag convention);
    //   · `some View` on a NON-body member (a helper returning a view) — the
    //     helper is not the type's rendering entry point.
    if (kind === ASTEngine.SymbolKind.Class || kind === ASTEngine.SymbolKind.Struct || kind === ASTEngine.SymbolKind.Extension) {
      if (bases.includes("View")) {
        this.extractRenderRelationships(node, symbol.name, relationships)
      }
    }

    return symbol
  }

  /**
   * `renders` — the rendered component named by a View body's TOP-LEVEL DSL
   * call. Swift's rendering entry point is `var body: some View { … }` on a
   * type conforming to `View`; the component the body's outermost
   * `call_expression` names is what the type renders (the dart lane's
   * `build`-returns-`Widget` shape, `real-dart-analyzer.ts:4274`). Deeper
   * constructions stay their existing `calls`/`instantiates` rows — only the
   * top-level expression is the rendered tree's root, and every other
   * construction inside it is an ARGUMENT or a CHILD, not the render.
   */
  private extractRenderRelationships(
    node: Node,
    className: string,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const classBody = this.findChildByType(node, "class_body")
    if (!classBody) return
    for (let i = 0; i < classBody.namedChildCount; i++) {
      const member = classBody.namedChild(i)
      if (!member || member.type !== "property_declaration") continue
      // THE PROPERTY IS NAMED `body` and its declared type is `some View` —
      // both read from nodes, never text-matched in the aggregate (the
      // type_annotation's own text IS the node's text, which is the grammar's
      // spelling of `: some View`).
      const pattern = this.findChildByType(member, "pattern")
      if (!pattern || pattern.text !== "body") continue
      const typeAnno = this.findChildByType(member, "type_annotation")
      if (!typeAnno || typeAnno.text.trim() !== ": some View") continue
      const computed = this.findChildByType(member, "computed_property")
      if (!computed) continue
      const statements = this.findChildByType(computed, "statements")
      if (!statements) continue
      // THE TOP-LEVEL EXPRESSION — the body's outermost statement. Only a
      // call_expression names a component; a `calls`-shaped top level is the
      // fleet's shared non-component refusal (a lowercase or non-DSL call).
      const expr = statements.namedChild(0)
      if (!expr || expr.type !== "call_expression") continue
      const callee = this.findChildByType(expr, "simple_identifier") || this.findChildByType(expr, "identifier")
      if (!callee) continue
      const target = callee.text
      // A component name is a TYPE NAME — Swift's capitalization convention,
      // the same test the JS lane applies to a JSX tag (`<div>` is an
      // intrinsic, not a component). `some View` itself names no component.
      if (!/^[A-Z]/.test(target) || target === "View" || target === "Self") continue
      relationships.push({
        source: className,
        target,
        type: ASTEngine.RelationshipType.Renders,
        confidence: 0.9,
        line_number: this.nodeLine(callee),
        metadata: { isRenderHost: true, renderHost: "body", renderTarget: target },
      })
    }
  }

  private handleFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    overrideTasks: OverrideTask[],
    companion?: OverrideCompanion,
    localScope: boolean = false,
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

    const symbol = this.createSymbol(opName ?? nameNode!.text, kind, opName ? node : nameNode!, parent, symbols, meta, vis, this.getDeclaredVisibility(node), localScope)
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
        line: symbol.range?.startLine,
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
    localScope: boolean = false,
  ) {
    // Locals are NOT symbols (C# LocalsAreNotSymbols). Only type-scope
    // members (property) and file-scope bindings (variable) qualify.
    //
    // SWIFT4b: the parent check alone missed every body that mints no symbol of
    // its own — a `deinit`/`subscript` body, a computed getter/setter, a
    // willSet/didSet block, a closure — because there the frame's parent is
    // still the enclosing TYPE (see LOCAL_SCOPE_BODIES).
    if (localScope) return
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
          this.createSymbol(idNode.text, kind, idNode, parent, symbols, meta, vis, this.getDeclaredVisibility(node), localScope)
        }
      }
    } else {
      const idNode = this.findChildByType(node, "simple_identifier") || this.findChildByType(node, "identifier")
      if (idNode) {
        this.createSymbol(idNode.text, kind, idNode, parent, symbols, meta, vis, this.getDeclaredVisibility(node))
      }
    }
  }

  private handleCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    emittedCalls: Set<string>,
    enumCtorCandidates?: Array<{ source: string; head: string | null; owner: string | null; leaf: string; removeCalls: boolean; line?: number }>,
    superByClass?: Map<string, string>,
    callSiteCounts?: Map<string, number>,
    callSiteLines?: Map<string, number[]>,
  ) {
    // SW-D21 (#938): a switch-case PATTERN with an associated value does not
    // reduce in the pinned grammar — `case .websocket(let x):` recovers as a
    // call_expression whose callee navigation STARTS AT THE `case` KEYWORD
    // (`simple_identifier "case"` + navigation_suffix + a call_suffix whose
    // value_arguments hold `let` and an ERROR). A pattern match is not a call
    // and not construction, so nothing may be emitted for it: the pre-fix
    // code took the leaf (`websocket`) and published a fabricated `calls`
    // edge (measured on the full-extent swift-nio draw: 3 rows across
    // Client.swift/Server.swift, the only unexplained-by-truth edges in the
    // lane). The keyword is a reserved word, so the shape is read from the
    // token, never from source text.
    if (this.isCasePatternRecovery(node)) return

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
            enumCtorCandidates.push({ source, head: null, owner, leaf, removeCalls: false, line: this.nodeLine(node) })
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
          // SW-G owner rule (#941): a member symbol names its CONTAINER
          // (ownerName); a type symbol IS the container — deinit/subscript/
          // observer bodies have no symbol of their own, which is the only
          // reason the type name fallback exists. The pre-fix expression
          // (`ownerName ?? name`) therefore minted the enclosing symbol's OWN
          // name as a target: inside an initializer whose owner is not
          // resolvable it published `instantiates constructor -> constructor`
          // (source and target both `constructor`, which is not a type).
          const owner = parent
            ? (MEMBER_OWNER_KINDS.has(parent.kind) ? parent.name : (parent.ownerName ?? null))
            : null
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
                // The DELEGATION call site's line (`self.init()` / `super.init()`).
                ...(typeof this.nodeLine(node) === "number" ? { line_number: this.nodeLine(node)! } : {}),
                metadata: { isSuperInit: recv === "super", isSelfInit: recv !== "super" },
              })
            }
          }
          // SW-G, verbatim: "Unresolvable stays silent." An initializer
          // delegation is NEVER a `calls` edge — `init` is not a name in this
          // vocabulary (constructors are literally `constructor`), so the old
          // fall-through published a dangling target (the dart DT-A disease
          // SW-G was written to remove) and the truth side mirrored it.
          return
        }
      }
      // SW-B (ultimate review): record enum-construction CANDIDATES
      // (`Result.success(1)` may build Result, not call success) — resolved
      // post-walk against declared enum cases (symbols must be whole first).
      // The receiver is second-to-last in the chain (`P.Foo.bar` -> Foo).
      // #942: the index this site's own `calls` edge lands at (-1 when
      // emitCall deduped it). The post-walk must splice THAT edge: the old
      // splice removed "the first edge with this (source, leaf)", which
      // belongs to a DIFFERENT call site whenever two sites in one scope call
      // the same leaf name — measured on the alamofire full-extent draw, where
      // `static var get: Endpoint { method(.get) }` silently lost its call to
      // `Endpoint.method` because a property initializer elsewhere in the type
      // called `Path.method(.get)`.
      this.emitCall(relationships, source, leaf, emittedCalls, callSiteCounts, this.nodeLine(this.navigationLeafNode(funcNode)), callSiteLines)
      if (enumCtorCandidates) {
        const chain = this.navigationChain(funcNode)
        const receiver = chain.length >= 2 ? chain[chain.length - 2] : null
        if (receiver && this.isTypeName(receiver) && receiver !== "Self" && receiver !== "super" && receiver !== "this") {
          enumCtorCandidates.push({ source, head: receiver, owner: null, leaf, removeCalls: true, line: this.nodeLine(this.navigationLeafNode(funcNode)) })
        } else if (receiver === "Self") {
          // SW-H: `Self.a(v)` in an enum builds the enclosing enum.
          const owner = parent?.ownerName ?? null
          if (owner) enumCtorCandidates.push({ source, head: null, owner, leaf, removeCalls: true, line: this.nodeLine(this.navigationLeafNode(funcNode)) })
        }
      }
      return
    }

    // Bare identifier call.
    const target = this.stripNameQuoting(funcNode.text)
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
          // The construction site's callee node line.
          ...(typeof this.nodeLine(funcNode) === "number" ? { line_number: this.nodeLine(funcNode)! } : {}),
          metadata: { isInstantiation: true },
        })
      }
    } else {
      // #942: bare calls are call SITES too — the (source, leaf) pool the
      // enum-construction retirement consults must include them, or a
      // conversion in one scope retires the edge of a genuine bare call that
      // nothing else re-creates (`static var get: Int { method(.get) }` next
      // to `var path = Path.method(.get)`).
      this.emitCall(relationships, source, target, emittedCalls, callSiteCounts, this.nodeLine(funcNode), callSiteLines)
    }
  }

  private emitCall(
    relationships: ASTEngine.UniversalRelationship[],
    source: string,
    target: string,
    emittedCalls: Set<string>,
    callSiteCounts?: Map<string, number>,
    line?: number,
    callSiteLines?: Map<string, number[]>,
  ) {
    // #942: count every SITE, including the ones the dedupe below absorbs — the
    // post-walk needs sites, not edges.
    if (callSiteCounts) {
      const siteKey = `${source}\u0000${target}`
      callSiteCounts.set(siteKey, (callSiteCounts.get(siteKey) ?? 0) + 1)
      if (typeof line === "number") {
        const arr = callSiteLines?.get(siteKey)
        if (arr) arr.push(line)
        else callSiteLines?.set(siteKey, [line])
      }
    }
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
      // The CALLEE node's own line — the site a reader checks.
      ...(typeof line === "number" ? { line_number: line } : {}),
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
      // SW-D22 (#939): the climb must also traverse the UNWRAP wrapper. The
      // pinned grammar puts a force-unwrap (`x.a!`) inside a
      // `postfix_expression`, so an LHS member under the wrapper stopped the
      // walk on its first step, never reached the assignment, and the
      // SCD1 gate never fired (`$0.status!.st_dev += 1` published
      // `uses -> status`, 2 rows on the full-extent swift-nio draw).
      let a = node.parent
      while (a && (a.type === "directly_assignable_expression" || a.type === "postfix_expression" || a.type === "navigation_expression" || a.type === "navigation_suffix")) a = a.parent
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
      // The leaf segment's own node line (`self.a.b` -> the `b` node).
      ...(typeof this.nodeLine(this.navigationLeafNode(node)) === "number"
        ? { line_number: this.nodeLine(this.navigationLeafNode(node))! }
        : {}),
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
      // SW-D22 (#939): traverse the unwrap wrapper too (`x.a!` sits inside a
      // postfix_expression) — otherwise the climb stops on the first step and
      // an assignment LHS under a force-unwrap reads as a value.
      let a = n.parent
      while (
        a && (a.type === "directly_assignable_expression" ||
          a.type === "postfix_expression" ||
          a.type === "navigation_expression" ||
          a.type === "navigation_suffix")
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
      } else if (this.isNominalRecovery(n)) {
        // SW-D23 (#940): an ERROR-recovered nominal is a container for its
        // members exactly like a reduced one — without this the member
        // inventory for a whole recovered class/extension stays invisible to
        // bare reads (the mirror lives in the oracle's deriveSwiftBareUses).
        const nm = this.recoveryName(n)
        if (nm) {
          cTy = nm
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
        // #924: a KEYWORD-ESCAPED read (`return \`default\``) names the inner
        // text — normalization happens BEFORE the ownership gate, because the
        // member inventory is keyed on the stripped name (createSymbol applies
        // the same rule), and a raw lookup would simply fail to resolve.
        lookup = this.stripNameQuoting(lookup)
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
              line_number: this.nodeLine(n),
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

  /**
   * The PROJECT's cross-file declaration tables, read from
   * `AnalyzeContext.projectIndex` when a caller supplied one.
   *
   * WHY THIS EXISTS, WITH THE NUMBER. `overrides` resolves in three passes
   * (exact in-file BFS -> companion-verified declaring parent -> first-parent
   * guess at confidence 0.5). Pass 2 needs BOTH a companion (owner -> declared
   * members) and a way to walk bases it cannot see in this file. Measured over
   * the 1,256-file draw with `script/m14/swift-overrides-premise-probe.ts`:
   *
   *     tier                        edges  parent declares the method
   *     pass1 in-file (1.0)            71            71  (100.0%)
   *     pass3 first-parent (0.5)      210            87  ( 41.4%)
   *
   * so the guess's premise — "the first hierarchy parent declares the method" —
   * fails for 123 of 210 edges (58.6%). swift-nio shows the mechanism:
   * `final class PipeChannel: BaseStreamSocketChannel<PipePair>` overriding
   * `connectSocket`, where `connectSocket` is declared two levels up, on
   * `BaseSocketChannel` (Sources/NIOPosix/BaseSocketChannel.swift:479). The
   * guess names the DIRECT base, which does not declare it.
   *
   * Pass 2 could not fix that, and the reason is a wiring fact rather than a
   * logic one: Pass 2 reads `context.overrideCompanion`, and
   * `src/ast/parallel-indexer.ts` builds the batch companion only for the
   * languages its `PROJECT_INDEX_EXTENSIONS` map lists — today `".sol"` — so no
   * Swift caller has ever supplied one. `src/ast/pool-worker.ts`'s `parse_batch`
   * supplies `context.projectIndex` instead, and the Dart lane already reads
   * that channel (`dartCompanionFor`). This method is the Swift equivalent: it
   * reads the channel production is designed to fill, so the moment the indexer
   * is told to build an index for `.swift`, this lane needs no further change.
   *
   * ADDITIVE AND INERT WHEN ABSENT. With no `projectIndex` — a single-file
   * parse, every fixture, the differential — `companion` is undefined, `kinds`
   * is `context.typeKinds` exactly as before, and `getParents` returns the
   * per-file hierarchy, so output is byte-identical to before this method
   * existed. Nothing here decides anything on its own: it only supplies the
   * cross-file answers the file cannot see.
   */
  private crossFileTables(
    context: ASTEngine.AnalyzeContext | undefined,
    classHierarchy: Map<string, string[]>,
  ): {
    companion: OverrideCompanion | undefined
    kinds: Map<string, string> | undefined
    getParents: (local: Map<string, string[]>) => (typeName: string) => readonly string[]
  } {
    const pi: any = (context as any)?.projectIndex
    const kinds = (context?.typeKinds as Map<string, string> | undefined)
      ?? (pi?.typeKinds instanceof Map ? (pi.typeKinds as Map<string, string>) : undefined)
    if (!pi || !(pi.typeMembers instanceof Map) || !(pi.typeBases instanceof Map)) {
      // No project index: exactly the pre-existing per-file behaviour.
      return { companion: undefined, kinds, getParents: (local) => (t: string) => local.get(t) ?? [] }
    }

    // Companion = owner -> its OWN members plus every ancestor's, so
    // `findDeclaringParent`'s breadth-first search can settle on the ancestor
    // that really declares the method instead of the nearest base. Computed
    // lazily per owner and memoised: a file asks about a handful of owners, and
    // recomputing a transitive closure per question would be the O(n^2) the
    // complexity envelope forbids.
    const cache = new Map<string, Set<string>>()
    const closure = (owner: string, seen: Set<string> = new Set()): Set<string> => {
      const hit = cache.get(owner)
      if (hit) return hit
      const out = new Set<string>()
      if (seen.has(owner)) return out
      seen.add(owner)
      for (const m of (pi.typeMembers.get(owner) ?? []) as Iterable<string>) out.add(m)
      for (const b of (pi.typeBases.get(owner) ?? []) as string[]) {
        for (const m of closure(b, seen)) out.add(m)
      }
      cache.set(owner, out)
      return out
    }
    const companion = new Map<string, Set<string>>()
    for (const owner of pi.typeMembers.keys() as Iterable<string>) companion.set(owner, closure(owner))

    return {
      companion,
      kinds,
      // The project's bases first, the file's own second: a type declared in
      // THIS file is authoritative here, and a type the file never mentions can
      // only come from the index.
      getParents: (local) => (t: string) => {
        const localParents = local.get(t)
        if (localParents && localParents.length > 0) return localParents
        const projectParents = pi.typeBases.get(t) as string[] | undefined
        return projectParents && projectParents.length > 0 ? projectParents : []
      },
    }
  }

  private resolveOverrides(
    tasks: OverrideTask[],
    classHierarchy: Map<string, string[]>,
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    relationships: ASTEngine.UniversalRelationship[],
    companion?: OverrideCompanion,
    getParents?: (typeName: string) => readonly string[],
  ) {
    const parentsOf = getParents ?? ((t: string) => classHierarchy.get(t) ?? [])
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
        for (const next of parentsOf(parentName)) queue.push(next)
      }

      // Pass 2: cross-file declaring-parent resolution via the companion.
      if (!targetFqn && companion && ownerH && ownerH.length > 0) {
        const declaring = findDeclaringParent(task.methodName, ownerH, companion, parentsOf)
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
          ...(typeof task.line === "number" ? { line_number: task.line } : {}),
          metadata: { relationshipType: "method_override", isSwiftOverride: true, ...(reasonCode ? { reasonCode } : {}) },
        })
      }
    }
  }

  // ==========================================================================
  // Symbol creation / helpers
  // ==========================================================================

  /**
   * #924 (swift half): Swift's keyword-escape quoting is NOT part of a name.
   * ``case `continue` `` declares the identifier `continue`; ``static var
   * `default` `` declares `default` — and every REFERENCE in the corpus spells
   * them without backticks (`flags: Flags = .default`), so a published name that
   * keeps the syntax is a name no reference can ever match. Measured at full
   * extent (`script/m14/tmp/sw-name-census.ts`): 29 symbols and 40 targets
   * carried the backticks. Exactly one surrounding pair is stripped; a name
   * that merely contains a backtick keeps it.
   */
  private stripNameQuoting(text: string): string {
    if (text.length >= 2 && text.charCodeAt(0) === 96 && text.charCodeAt(text.length - 1) === 96) {
      return text.slice(1, -1)
    }
    return text
  }

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    symbols: ASTEngine.UniversalSymbol[],
    meta: Record<string, any> = {},
    visibility: string = "internal",
    declaredVisibility: string | null = null,
    /** SWIFT4b: the declaration sits inside a BODY (see LOCAL_SCOPE_BODIES). */
    localScope: boolean = false,
  ): ASTEngine.UniversalSymbol {
    name = this.stripNameQuoting(name)
    // Swift ACCESS CONTROL is inherited through an EXTENSION and nowhere else
    // (DERIV_EXPORTS_SWIFT4): `public extension Store { func added() {} }` makes
    // `added` public — Swift's own rule, and the rule INCOMING_SWIFT JOB 2's
    // symbol pin states — while a `public struct` does NOT lift its members
    // (each member states its own level). `declaredVisibility` is the
    // declaration's OWN modifier, read off the DECLARATION node; it is a
    // separate parameter because this method receives the NAME node, which has
    // no modifiers of its own — reading them here would make every member of an
    // extension inherit, including one that spells `private`.
    if (
      parent &&
      parent.kind === ASTEngine.SymbolKind.Extension &&
      declaredVisibility === null &&
      parent.visibility
    ) {
      visibility = parent.visibility
    }
    // A declaration inside a FUNCTION BODY (or an initializer) is NOT a member of
    // the function: Swift's grammar admits a nested type there, and the local
    // type owns only what is declared inside it. Publishing
    // `ownerName = <function>` minted `contains <function> -> <Type>` for every
    // such declaration (measured at 355 truth edges by the lane's own oracle),
    // and INCOMING_SWIFT JOB 2 forbids it in both spellings. Withholding the
    // owner is what removes the edge — the symbol itself still exists, still
    // names its members, and is still reachable as an `instantiates` target.
    //
    // SWIFT4b: the parent-kind half is not enough. It sees a function body
    // because that body's parent IS the function symbol, but the walk keeps the
    // enclosing TYPE as the frame's parent inside every body that mints no
    // symbol of its own — `deinit`, `subscript`, a computed getter/setter, a
    // willSet/didSet block, a closure — so `localScope` carries the fact from
    // the walk (LOCAL_SCOPE_BODIES) and extends the same rule to those.
    const functionScoped =
      localScope ||
      (!!parent &&
        (parent.kind === ASTEngine.SymbolKind.Function ||
          parent.kind === ASTEngine.SymbolKind.Method ||
          parent.kind === ASTEngine.SymbolKind.Constructor))
    const owner = functionScoped ? null : parent
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
      parentId: owner ? owner.id : undefined,
      ownerName: owner ? owner.name : undefined,
      parent: owner ? owner.name : undefined,
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

  /**
   * The declaration's OWN access-level modifier, or null when it states none.
   *
   * The null case is load-bearing (DERIV_EXPORTS_SWIFT4): a member of an
   * extension INHERITS the extension's level only when it declares none of its
   * own, so "no modifier" and "explicitly internal" must be distinguishable —
   * `getVisibility` returns "internal" for both, which is right for the symbol
   * field and wrong for the inheritance rule.
   */
  private getDeclaredVisibility(node: Node): string | null {
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
    return null
  }

  private getVisibility(node: Node): string {
    return this.getDeclaredVisibility(node) ?? "internal"
  }

  /**
   * The EXPORTING access levels, or null when the declaration is not part of the
   * module's interface. Swift has no `export` keyword (measured: 150 node types
   * over 400 corpus files, none an export declaration, 0 anonymous `export`
   * tokens) — its export construct IS access control. What counts as an export
   * is measured, over 3,656 files (script/m14/swift-import-export-probe.ts) with
   * 52,113 file-scope declarations as the denominator: 5,708 `public`, 43
   * `open`, against 1,325 explicit `internal`, 1,470 `private`, 195
   * `fileprivate` and 43,368 with no modifier at all — 5,751 of 52,113 (11.04%).
   * `internal`, `private`, `fileprivate` and the no-modifier default are the
   * ABSENCE of an export, so they are not in this set. `package` IS in the
   * condition below as a declared grammar-version boundary, not a measured one:
   * the pinned grammar (npm tree-sitter-swift 0.7.1) cannot reduce it — all six
   * synthetic shapes parse to an ERROR while `public func` reduces cleanly, and
   * the corpus probe finds 0 `package` visibility_modifier nodes in 3,656 files
   * — so it cannot fire on this corpus and this lane does not claim it does.
   */
  private exportingVisibility(node: Node): string | null {
    const vis = this.getDeclaredVisibility(node)
    if (vis === "public" || vis === "open" || vis === "package") return vis
    return null
  }

  /**
   * The MODULE-LEVEL SOURCE of an `exports` edge: the file's own leaf name
   * (typescript's moduleLeafName() convention), e.g.
   * `…/fixtures/swift/exports-visibility.swift` -> `exports-visibility`.
   *
   * FOREIGN ON PURPOSE: never `root`. `root` is in parallel-indexer's
   * SYMBOL_NAME_DENYLIST, so an edge sourced there can never bind to a stored
   * symbol; the leaf name is what every other lane spells for a file-as-module
   * endpoint (go's packageName, python's moduleName). This is a NAME for the
   * file the edge was read from, not a claim about SwiftPM's module name, which
   * no Swift source file contains.
   */
  private moduleLeafName(filePath: string): string {
    let start = 0
    for (let i = filePath.length - 1; i >= 0; i--) {
      if (filePath[i] === "/") { start = i + 1; break }
    }
    let end = filePath.length
    for (let i = start; i < filePath.length; i++) {
      if (filePath[i] === ".") { end = i; break }
    }
    return filePath.slice(start, end)
  }

  /**
   * DERIV_EXPORTS_SWIFT4 — does this declaration publish a name for the module?
   *
   * Returns the kind the export row carries, or null when the declaration
   * exports nothing. Three gates, in order:
   *
   *   1. an EXPORTING access level (`exportingVisibility`): `public`/`open`/
   *      `package` and nothing else;
   *   2. NOT an extension: an extension symbol is named after the EXTENDED type
   *      (`public extension Array`), so exporting it would name a declaration
   *      this file does not contain — measured at 54 file-scope sites in a
   *      3,656-file draw, all of which would be fabrications;
   *   3. the declaration KINDS that can carry a level: a nominal
   *      (`class`/`struct`/`enum`/`actor`), a protocol, a function, a
   *      property binding and a typealias.
   *
   * The caller gates on `parentSymbol === null` (file scope) — a member and a
   * function-local type never reach here.
   */
  private isExportingDeclaration(node: Node): ASTEngine.SymbolKind | null {
    if (this.exportingVisibility(node) === null) return null
    if (node.type === "class_declaration" && this.hasAnonToken(node, "extension")) return null
    if (node.type === "ERROR") {
      if (!this.isNominalRecovery(node)) return null
      return this.recoveryKind(node)
    }
    if (node.type === "class_declaration") {
      const valueType = this.hasAnonToken(node, "struct") || this.hasAnonToken(node, "enum")
      if (valueType) {
        if (this.hasAnonToken(node, "struct")) return ASTEngine.SymbolKind.Struct
        if (this.hasAnonToken(node, "enum")) return ASTEngine.SymbolKind.Enum
      }
      if (this.hasAnonToken(node, "actor")) return ASTEngine.SymbolKind.Actor
      return ASTEngine.SymbolKind.Class
    }
    if (node.type === "protocol_declaration") return ASTEngine.SymbolKind.Interface
    if (node.type === "function_declaration" || node.type === "protocol_function_declaration") {
      return ASTEngine.SymbolKind.Function
    }
    if (node.type === "property_declaration" || node.type === "protocol_property_declaration") {
      return ASTEngine.SymbolKind.Variable
    }
    if (node.type === "typealias_declaration") return ASTEngine.SymbolKind.Type
    return null
  }

  /**
   * The NAME (and its node, for the line rule) a declaration publishes — one
   * entry per binding, because a multi-binding declaration (`var a = 1, b = 2`)
   * carries a sibling `pattern` per binding (SWIFTD18) and publishing only the
   * first would silently drop the rest.
   *
   * Polled by the export emission only: the symbol table already carries these
   * names, but the export LINE must come from the declaration's own name node
   * (a decorated declaration's line is its NAME's line, never the
   * decorator's — pinned by the `Decorated` row of swift/exports-visibility and
   * mutant SW-EXP-14).
   */
  private exportedDeclarationNames(node: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    if (node.type === "property_declaration" || node.type === "protocol_property_declaration") {
      const pat = this.findChildByType(node, "pattern")
      if (pat) {
        const pats: Node[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "pattern") pats.push(c)
        }
        for (const pn of pats) {
          const idNode = this.findChildByType(pn, "simple_identifier") || this.findChildByType(pn, "identifier") || this.firstNamedChild(pn)
          if (idNode) out.push({ name: idNode.text, node: idNode })
        }
      }
      return out
    }
    if (node.type === "protocol_declaration") {
      const nm = this.findChildByType(node, "type_identifier")
      if (nm) out.push({ name: nm.text, node: nm })
      return out
    }
    if (node.type === "class_declaration") {
      const nm = this.findChildByType(node, "type_identifier") || this.findChildByType(node, "user_type")
      if (nm) {
        const leaf = nm.type === "user_type" ? this.lastTypeIdentifier(nm) : nm
        if (leaf) out.push({ name: leaf.text, node: leaf })
      }
      return out
    }
    if (node.type === "function_declaration" || node.type === "protocol_function_declaration") {
      const nm = this.findChildByType(node, "simple_identifier") || this.findChildByType(node, "identifier")
      if (nm) out.push({ name: nm.text, node: nm })
      else {
        // Operator overloads (`static func + `) have no identifier; the name is
        // the anonymous operator token (the same recovery handleFunction uses).
        const opName = this.operatorName(node)
        if (opName) out.push({ name: opName, node })
      }
      return out
    }
    if (node.type === "typealias_declaration") {
      const nm = this.findChildByType(node, "type_identifier") || this.firstNamedChild(node)
      if (nm) out.push({ name: nm.text, node: nm })
      return out
    }
    if (node.type === "ERROR") {
      const nm = this.recoveryNameNode(node)
      if (nm) out.push({ name: nm.text, node: nm })
      return out
    }
    return out
  }

  /**
   * DERIV_EXPORTS_SWIFT4 — publish ONE file-scope declaration as an `exports`
   * edge and an `ExportInfo` row.
   *
   * `swiftExport: true` is the marker the CLASSIFICATION keys on indirectly
   * (`reExport` absent -> structural): the access level is a grammar clause read
   * off the declaration's own `modifiers` node, so nothing here is inferred and
   * no reason code is owed (honesty contract ).
   */
  private emitDeclarationExport(
    node: Node,
    moduleSource: string,
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    emitted: Set<string>,
  ): void {
    const vis = this.exportingVisibility(node)
    if (!vis) return
    const kind = this.isExportingDeclaration(node) ?? ASTEngine.SymbolKind.Class
    for (const resolved of this.exportedDeclarationNames(node)) {
      this.publishDeclarationExport(node, resolved, kind, vis, moduleSource, relationships, exports, emitted)
    }
  }

  /** One published NAME: the row, the edge, and the (source, name) dedupe. */
  private publishDeclarationExport(
    node: Node,
    resolved: { name: string; node: Node },
    kind: ASTEngine.SymbolKind,
    vis: string,
    moduleSource: string,
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    emitted: Set<string>,
  ): void {
    const name = this.stripNameQuoting(resolved.name)
    if (!name || emitted.has(name)) return
    const nameNode = resolved.node
    // ENDPOINT INTEGRITY: the name node must lie INSIDE the declaration node it
    // was read from. A resolver that returned a node from another subtree would
    // publish a name — and a LINE — belonging to a different declaration, and
    // the line is the one field a reader checks against the source (
    // `Decorated`'s edge must carry the NAME's line, 73, never the
    // `@available` declaration's, 71). A foreign node is withheld, not published.
    if (nameNode.startIndex < node.startIndex || nameNode.endIndex > node.endIndex) return
    emitted.add(name)
    exports.push({
      name,
      kind,
      range: {
        startLine: nameNode.startPosition.row + 1,
        startColumn: nameNode.startPosition.column + 1,
        endLine: nameNode.endPosition.row + 1,
        endColumn: nameNode.endPosition.column + 1,
        startIndex: nameNode.startIndex,
        endIndex: nameNode.endIndex,
      },
      visibility: vis,
      metadata: { exportForm: "visibility_modifier", accessLevel: vis },
    })
    relationships.push({
      type: ASTEngine.RelationshipType.Exports,
      source: moduleSource,
      target: name,
      isExternal: false,
      weight: 1,
      confidence: 1.0,
      ...(typeof this.nodeLine(nameNode) === "number" ? { line_number: this.nodeLine(nameNode)! } : {}),
      metadata: { exportForm: "visibility_modifier", accessLevel: vis, swiftExport: true },
    })
  }

  /** `@_exported` — the underscored re-export attribute, by its NAME node. */
  private hasExportedAttribute(node: Node): boolean {
    return this.hasAttributeNamed(node, "_exported")
  }

  /**
   * The form in which an import RE-PUBLISHES its module, or null for an
   * ordinary import (which is a dependency and nothing else).
   *
   * Two forms, both pinned by swift/exports-visibility:
   *   - `public import M` (SE-0409) — the `public` modifier on the import;
   *   - `@_exported import M` — Swift's literal re-export attribute.
   * `public` is checked first so a hypothetical `@_exported public import M`
   * keeps the access-controlled form; both publish the same fact.
   */
  private importReExportForm(node: Node): string | null {
    let reExportForm: string | null = null
    if (node.type === "import_declaration") {
      if (this.exportingVisibility(node) === "public") reExportForm = "public_import"
      else if (this.hasExportedAttribute(node)) reExportForm = "underscored_exported_import"
    }
    return reExportForm
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

  private handleImport(
    node: Node,
    imports: ASTEngine.ImportInfo[],
    frameworksObj: Record<string, boolean>,
    reExports: ReExportSite[],
  ) {
    // The module PATH: the import's own `identifier` node, which holds one
    // `simple_identifier` per dotted segment (`(identifier ["."] (simple_identifier)
    // (simple_identifier))`), or the bare `simple_identifier` of a plain import.
    // Probe-verified: script/m14/swift-grammar-shape-probe.ts. Never source text —
    // the kind keyword and the attributes are SEPARATE children of the
    // declaration, so reading the first identifier-ish child reads the path only.
    let spelled = ""
    let moduleNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "simple_identifier" || c.type === "type_identifier" || c.type === "identifier")) {
        spelled = c.text
        moduleNode = c
        break
      }
    }
    // The MODULE is the FIRST dotted segment; anything after it is a submodule
    // path or a scoped declaration hanging off the module (the doc's rule, and
    // swift-ontology-measurements.md: `import let WinSDK.IPPROTO_IP` is a
    // dependency on `WinSDK`). `identifier` children are the segments, so the
    // split is over a node's own name rather than over source text.
    const moduleName = spelled.split(".")[0] ?? ""
    // The SCOPE KEYWORD, when the import restricts what it brings in
    // (`import struct Foo.Bar`): an ANONYMOUS token on the declaration beside
    // `import` — the grammar's own token name (`struct`, `let`, `func`, `enum`,
    // `class`, `protocol`, `var`, `typealias`), never a substring of the path.
    let scopeKind = ""
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c || c.isNamed) continue
      if (c.type === "import") continue
      scopeKind = c.type
      break
    }
    if (moduleName) {
      // the range is the MODULE NAME's site, not the whole import
      // declaration — an attribute on its own line (`@testable
      // \nimport Alamofire`) made the declaration start one line above the
      // `import`, so the references edge claimed a line holding only
      // `@testable` (measured on alamofire Tests/ProtectedTests.swift).
      const site = moduleNode ?? node
      const range = {
        startLine: site.startPosition.row + 1,
        startColumn: site.startPosition.column + 1,
        endLine: site.endPosition.row + 1,
        endColumn: site.endPosition.column + 1,
        startIndex: site.startIndex,
        endIndex: site.endIndex,
      }
      // The per-STATEMENT row keeps the SPELLED path in `module` — that is what the
      // `references` edge beside it names (per statement, 6 statements -> 6 edges),
      // and the module-level `imports` edge reads the module name out of the
      // metadata below. The two labels are deliberately different rules over one
      // statement: one per statement, one per MODULE.
      const importMd: Record<string, any> = {
        module: moduleName,
        moduleSpecifier: spelled,
        isModuleDependency: true,
      }
      // A dotted path is the submodule/scope spelling of the same module.
      if (spelled !== moduleName) importMd.submodulePath = spelled
      if (scopeKind.length > 0) {
        importMd.isScopedImport = true
        importMd.scopedKind = scopeKind
        const item = spelled.split(".").slice(1).join(".")
        if (item.length > 0) importMd.scopedItem = item
      }
      // The explicit re-export forms: it is still an import (the module is
      // bound into scope), and the fact that this file's module re-publishes it
      // rides this edge's metadata as well as the `exports` edge.
      const reExportForm = this.importReExportForm(node)
      if (reExportForm) {
        importMd.isModuleReExport = true
        importMd.reExportForm = reExportForm
      }
      imports.push({ module: spelled, isExternal: true, range, metadata: importMd })
      // SWIFTD21 (the ontology lane, DERIV_EXPORTS_SWIFT3): `@_exported import M`
      // is Swift's one explicit RE-EXPORT verb — the module this file belongs to
      // re-publishes M's API to ITS importers. The pre-fix lane read the module
      // name and stopped, so the one Swift statement that says "this file's
      // module exports something" was recorded as an ordinary import and the
      // `exports` relationship type never fired at all (measured: 0 on every
      // corpus, against 40 `@_exported import` sites in 27 files of
      // swift-corpus — see docs/analyzers/swift-ontology-measurements.md).
      if (reExportForm) {
        // The re-export names the module the path SPELLS (`Mixed.Submodule` stays
        // whole — a dotted module name is a module name, DERIV_EXPORTS_SWIFT3).
        reExports.push({ module: spelled, node: site, form: reExportForm })
      }
      if (moduleName === "SwiftUI") frameworksObj["SwiftUI"] = true
      if (moduleName === "Combine") frameworksObj["Combine"] = true
      if (moduleName === "UIKit") frameworksObj["UIKit"] = true
      if (moduleName === "Foundation") frameworksObj["Foundation"] = true
    }
  }

  /**
   * The NAME of an `attribute` node: its first named child.
   *
   * The attribute arrives as `import_declaration > modifiers > attribute`, and
   * the pinned grammar spells it `('@' (user_type (type_identifier)))` — so the
   * attribute's NAME is its first named child's text, never the attribute node's
   * own text and never the file's text. Reading the name node is what stops
   * `@objc(name: "_exported")` and a comment from producing a hit, and it is the
   * same rule the census's probe P2 uses on the other side of the comparison.
   */
  private attributeName(node: Node): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) return c.text
    }
    return null
  }

  private hasAttributeNamed(node: Node, want: string): boolean {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "attribute" && this.attributeName(n) === want) return true
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return false
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

  /**
   * Operator overload name: the token immediately after `func`.
   *
   * The grammar reads most operator tokens as ANONYMOUS children (`==`, `+`,
   * `<`, `===`) but falls back to a NAMED `custom_operator` node for sequences
   * it has no reserved token for — measured on the pinned wasm: `func !==` and
   * `func ~=` both parse as `custom_operator`, `func ===`/`func <`/`func ==` as
   * anonymous tokens. The pre-fix loop accepted only anonymous children, so the
   * named forms fell through to the first anonymous child that was not a paren
   * — the parameter comma — and minted `operator ,`: measured in the corpus as
   * a symbol and an `exports` edge naming `operator ,` in
   * swift-corpus/SwiftCompilerSources/Sources/SIL/ApplySite.swift (the `~=`
   * overload), SIL/Instruction.swift and COM/IUnknown+Identity.swift (the `!==`
   * overloads). A comma is not an operator Swift can declare, so that endpoint
   * was FABRICATED, the defect class INCOMING_SWIFT JOB 2 forbids.
   *
   * `custom_operator` is the only named node accepted here; a named
   * `simple_identifier` is a normal function name (return null), and anything
   * else before the first paren is not a name token.
   */
  private operatorName(node: Node): string | null {
    let sawFunc = false
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (!c.isNamed && c.type === "func") { sawFunc = true; continue }
      if (sawFunc) {
        if (c.isNamed && c.type === "simple_identifier") return null
        if (c.isNamed && c.type === "custom_operator") return `operator ${c.text}`
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
  /**
   * SW-D21 (#938): `case .X(let y)` recovery — the callee navigation's first
   * token is the reserved `case` keyword (parsed as a simple_identifier).
   * Swift never lets `case` name a value, so this is always grammar recovery.
   */
  private isCasePatternRecovery(callNode: Node): boolean {
    for (let i = 0; i < callNode.namedChildCount; i++) {
      const c = callNode.namedChild(i)
      if (!c || c.type !== "navigation_expression") continue
      const head = this.firstNamedChild(c)
      if (head && (head.type === "simple_identifier" || head.type === "identifier") && head.text === "case") return true
    }
    return false
  }

  /**
   * SW-D23 (#940): is this ERROR node a nominal DECLARATION the pinned grammar
   * failed to reduce? True when its FIRST child is the anonymous nominal
   * keyword token and its own next named child is the type name (`user_type`
   * for an extension, an identifier otherwise). The name must be the
   * recovery's own name node — never a nested declaration's — so a top-level
   * `ERROR` that merely contains declarations somewhere below is not treated
   * as one itself.
   */
  /**
   * The nominal kind of an ERROR-recovered header, read from the TOKENS: the
   * first anonymous nominal keyword child, provided nothing but header material
   * (`modifiers` / `attribute` / `comment`) precedes it. Declaration content
   * before a keyword means the keyword belongs to a nested declaration that the
   * recovery left as a SIBLING (measured: `extension SocketAddressError { ...
   * struct UnknownHost ... }` carries the nested `struct` token as a direct
   * child of the recovery, so a plain "does any child token say struct" test
   * names the extension a struct).
   */
  private recoveryKind(node: Node): ASTEngine.SymbolKind | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (!c.isNamed) {
        if (c.type === "class") return ASTEngine.SymbolKind.Class
        if (c.type === "struct") return ASTEngine.SymbolKind.Struct
        if (c.type === "enum") return ASTEngine.SymbolKind.Enum
        if (c.type === "extension") return ASTEngine.SymbolKind.Extension
        if (c.type === "actor") return ASTEngine.SymbolKind.Actor
        continue
      }
      if (c.type === "modifiers" || c.type === "attribute" || c.type === "comment") continue
      return null
    }
    return null
  }

  /**
   * The recovery's OWN name node: the first non-header child, which is the
   * extended `user_type` for an extension and an identifier otherwise. Anything
   * else (a nested declaration's type_identifier, a parameter type) is not this
   * header's name.
   */
  private recoveryNameNode(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "modifiers" || c.type === "attribute" || c.type === "comment") continue
      if (c.type === "user_type" || c.type === "type_identifier" || c.type === "simple_identifier" || c.type === "identifier") return c
      return null
    }
    return null
  }

  private recoveryName(node: Node): string | null {
    const n = this.recoveryNameNode(node)
    if (!n) return null
    if (n.type === "user_type") {
      const leaf = this.lastTypeIdentifier(n)
      return leaf ? leaf.text : null
    }
    return n.text
  }

  private isNominalRecovery(node: Node): boolean {
    if (node.type !== "ERROR") return false
    return this.recoveryKind(node) !== null && this.recoveryNameNode(node) !== null
  }

  /**
   * (#825 lineage): base sites WITH their name nodes, because a heritage
   * edge must name the base specifier's own line — the declaration's line is a
   * different site, and borrowing it is the fabrication the line rule forbids.
   */
  private extractBaseSites(node: Node): Array<{ name: string; node: Node }> {
    const sites: Array<{ name: string; node: Node }> = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "inheritance_specifier") {
        const site = this.extractBaseSite(c)
        if (site) sites.push(site)
      }
    }
    return sites
  }

  /**
   * The store's `line_number` for a node: its 1-based start row.
   * `undefined` when there is no node — the field's ruled absence state, never
   * a fabricated 0 and never an enclosing declaration's line (/ R6).
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
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

  private extractBaseSite(spec: Node): { name: string; node: Node } | null {
    // `user_type > type_identifier` — take the LEAF type identifier
    // (SWIFTD19: last segment of dotted names, family leaf convention).
    for (let i = 0; i < spec.namedChildCount; i++) {
      const c = spec.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier") return { name: c.text, node: c }
      if (c.type === "user_type") {
        const leaf = this.lastTypeIdentifier(c)
        if (leaf) return { name: leaf.text, node: leaf }
      }
    }
    const txt = spec.text.trim()
    return txt && !txt.includes(" ") ? { name: txt, node: spec } : null
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
      const member = this.stripNameQuoting(m.text)
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
      // SCD1 write gate (same climb as handleSelfUse/handleBareUses) —
      // including the `postfix_expression` unwrap wrapper (#939).
      let a = node.parent
      while (a && (a.type === "directly_assignable_expression" || a.type === "postfix_expression" || a.type === "navigation_expression" || a.type === "navigation_suffix")) a = a.parent
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
        // The member identifier node inside this suffix.
        line_number: this.nodeLine(m),
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
          const keyPathMember = this.stripNameQuoting(m.text)
          const key = `${source}\u0000uses\u0000${keyPathMember}`
          if (!emittedUses.has(key)) {
            emittedUses.add(key)
            relationships.push({
              type: ASTEngine.RelationshipType.Uses,
              source,
              target: keyPathMember,
              isExternal: false,
              weight: 0.7,
              confidence: 0.9,
              line_number: this.nodeLine(m),
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

  /**
   * The leaf IDENTIFIER NODE of a navigation (`users.first` -> the `first`
   * node) — the site a `uses`/`calls` edge's line must name. Paired with
   * `navigationLeaf` (the string form) so no line is ever taken from a
   * different segment of the chain.
   */
  private navigationLeafNode(node: Node): Node | null {
    let leaf: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "navigation_suffix") {
        leaf = this.findChildByType(c, "simple_identifier") || this.findChildByType(c, "identifier") || c
      }
    }
    if (leaf) return leaf
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "simple_identifier") leaf = c
    }
    return leaf
  }

  /** Leaf name of a navigation_expression: `users.first` -> `first`. */
  private navigationLeaf(node: Node): string | null {
    // The last navigation_suffix child holds the leaf identifier.
    let leaf: Node | null = null
    let sawSuffix = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "navigation_suffix") {
        // #924: a suffix with NO identifier is not a member name — the pinned
        // grammar leaves a tuple POSITION (`pair.0`, `_key.1`) as a suffix
        // whose only child is the position token, and the old `|| c` fallback
        // published `.0`/`.1` as the target (full extent: 4 targets across
        // WebSocketFrame.swift / MultiThreadedEventLoopGroup.swift). A position
        // is not a name in this vocabulary, so there is no edge to publish.
        sawSuffix = true
        leaf = this.findChildByType(c, "simple_identifier") || this.findChildByType(c, "identifier")
      }
    }
    if (leaf) return this.stripNameQuoting(leaf.text)
    // The fallback below exists for the suffix-less shape the pinned grammar can
    // produce; it must NOT run when a suffix was present and nameless, because
    // the only simple_identifier in sight is then the RECEIVER — the first
    // version of this rule dropped the `.0` TARGET and still published
    // `queueCallbackPair` for `queueCallbackPair.1(overallError)`. Measured at
    // full extent (652 files, both corpora): exactly ONE site has this shape, and
    // it is that call through a tuple position — a local variable is not a call
    // target. A position is not a name, so the whole edge goes, not just the leaf.
    if (sawSuffix) return null
    // Fallback: last simple_identifier child.
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "simple_identifier") leaf = c
    }
    return leaf ? this.stripNameQuoting(leaf.text) : null
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
