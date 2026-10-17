/**
 * Objective-C Intelligence Engine — Author: Muhammad Ishaq Khan
 * What this file is: the pure-AST analyzer for Objective-C (extensions m/mm/objc), wired in
 * engine.ts getAnalyzer → RealObjectiveCAnalyzer. Imports come from preproc_include nodes
 * DURING the walk (no source-text scanning); framework detection is a String.includes check on
 * the module name. The binding separator it reads is the FAMILY constant in src/ast/types.ts
 * (see the import comment below), so family-wide identity changes belong there, not here.
 * Grammar: tree-sitter-objc.wasm (WASM loaded by engine.ts).
 * Relationship types covered: calls, uses, contains, imports, references, exports, extends,
 * implements, overrides, instantiates.
 * Where its scripts/validations live: docs/analyzers/real-objective-c-analyzer.md,
 * script/m14/spec/objc-completeness.json, validation/m14/fixtures/objc/**, and the LANG_CONFIG
 * row in script/m14/completeness-inventory.ts (id "objc").
 * EDIT THESE TOO when this file changes: src/ast/types.ts (the family binding separator), the
 * spec, the fixtures, the doc above, and the LANG_CONFIG row.
 * GATE CAVEAT, recorded where the co-edit list can act on it: section G's head-comment check
 * looks for src/ast/real-<id>-analyzer.ts, so for id `objc` it looks for a file this lane does
 * not have (`real-objective-c-analyzer.ts` is the real one). The check needs an analyzerFile
 * mapping; until then this lane's section G reads `analyzer file absent` however complete the
 * head is.
 */
import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
// OC-E BINDING SPELLING. The separator is the FAMILY constant (`src/ast/types.ts:190`), imported
// rather than re-spelled: the store's leaf extractor (`pool-worker.ts:812-833`), the gate's binding
// verifier (`incoming-rule.ts:506-510`) and dart/php/julia/fsharp all read THIS spelling, and a
// local copy of `"\u0000"` would be a second rule that could drift from the first.
import { BINDING_SEP } from "./types"

// OC-E: implicit names and constant spellings are never value reads —
// `self`/`super` are implicit receivers, `nil`/`Nil`/`NULL`/`YES`/`NO`/
// `true`/`false` are constants, `_cmd` is the implicit second method
// parameter (reads of it are definition artifacts, not dependencies).
const BARE_READ_SKIP: ReadonlySet<string> = new Set([
  "self", "super", "nil", "Nil", "NULL", "YES", "NO", "true", "false", "_cmd",
])

// OC-E: the declarator wrappers a DECLARED NAME can nest under (shared by the
// init-declarator and parameter-declarator name tests). Climbing these is how
// `handler` inside `void (^handler)(NSString *)` is recognized as a declaration
// rather than a read.
const DECLARATOR_WRAPPERS: ReadonlySet<string> = new Set([
  "array_declarator", "pointer_declarator", "parenthesized_declarator", "attributed_declarator",
  "abstract_pointer_declarator", "abstract_block_pointer_declarator", "block_pointer_declarator",
  "function_declarator",
])

// Is this declaration's terminating `;` a MISSING token?
//
// `declaration` is the grammar's home for a real C declaration AND for parse
// wreckage. When two macro lines STACK with no declaration between them —
// `NS_ASSUME_NONNULL_END` on one line and the next macro on the following one,
// which is how every Apple header closes one nullability region and opens
// another — the grammar absorbs both identifiers as SPECIFIERS and closes the
// declaration with a MISSING `;`. Nothing is declared (measured: the node's
// named children are two identifiers and there is no declarator at all, while
// `declaratorField` resolves to the second macro), yet the file-scope loop
// below publishes that second identifier as a Variable. That is the phantom
// class the #743 grammar wave removed for c and cpp (`variable
// NS_ASSUME_NONNULL_END`); objc's grammar cannot remove it (see the
// `macro_prefixed_objc_declaration` note in grammars/tree-sitter-objc), so the
// analyzer refuses it here instead. A declaration that was never terminated
// declares nothing.
function isUnterminatedDeclaration(node: any): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.isMissing && child.type === ";") return true
  }
  return false
}

// The same refusal, for a declaration the grammar could not parse at all. An `ERROR` node
// inside a declaration means the grammar guessed at the shape, and what it produced is a
// fragment of the source line — so any name read out of it is a name the analyzer invented.
//
// Measured (afnetworking, AFURLSessionManager.m): `@property (...) AFURLSessionDid…Block
// didFinishEventsForBackgroundURLSession AF_API_UNAVAILABLE(macos);` mis-nests as a
// `declaration` whose children are the property header's own words, ERROR nodes, and a
// `function_declarator` named `AF_API_UNAVAILABLE` with a parameter list `(macos)`. The
// prototype arm published that macro as a Function symbol, and the OC-ONT-8 exports family
// published it as this unit's surface — a name no file declares. 2 declarations over the two
// production corpora (the other is the same file's AF_API_AVAILABLE line).
//
// Deliberately ERROR-only: an `isMissing` node is a separate, narrower class the caller
// already tests for (the missing terminator), and widening this to every `isMissing` child
// would refuse declarations whose only fault is an unbalanced paren inside a macro body.
function hasParseError(node: any): boolean {
  const stack: any[] = [node]
  let guard = 0
  while (stack.length > 0 && guard++ < 20000) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "ERROR") return true
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return false
}

// ============================================================================
// CONV-OC-1: framework detection — the family contract (CONV-CS-2 reference,
// swift/java siblings) over this lane's existing markers.
// ============================================================================
// The trigger set is UNCHANGED: UIKit/Foundation/AppKit/Cocoa, added by
// `preproc_include` on the module name. What was missing is the published
// contract over it. The lane published `detectedFrameworks` and a primary pick
// and NOTHING ELSE, so `frameworkPatterns` — the key that states HOW each
// framework was recognised — was absent from every payload, on every file
// (measured: 7 of 7 detecting files over 153 real corpus files).
//
// The primary pick was also derived from the Set's insertion order, which is the
// order the imports happen to be visited in — a property of the file's statement
// order, not of the code's meaning. The census cannot see this (a Set is
// deduped by construction, and `[...frameworks][0]` is a legitimate read), so the
// declared table below is what makes the pick deterministic: on a file importing
// both `<Foundation/Foundation.h>` and `<UIKit/UIKit.h>` the answer must not
// depend on which `#import` was written first.
//
// OBJC_FRAMEWORK_ORDER is the emitted order and therefore the primary pick:
// application frameworks most-specific first, and the base library LAST —
// Foundation is imported by nearly every Objective-C file including every
// framework's own headers, so "first imported wins" would report Foundation as
// the primary framework for anything that also imports a UI framework, which is
// the reverse of what a consumer wants. Test frameworks would sort last of all by
// the same rule as CS_FRAMEWORK_ORDER; this lane observes none (no XCTest marker
// was invented here to fill that slot — see the wave record).
const OBJC_FRAMEWORK_ORDER = ["UIKit", "AppKit", "Cocoa", "Foundation"]

// The pattern kind each framework is observed BY, so `frameworkPatterns` states
// the same fact as `detectedFrameworks` rather than re-deriving it. Names shared
// with the swift sibling (CONV-SW-3) keep the same spelling for the same reason
// they name the same thing.
const OBJC_FRAMEWORK_PATTERNS: Record<string, string[]> = {
  UIKit: ["ui_framework"],
  AppKit: ["ui_framework"],
  Cocoa: ["app_umbrella"],
  Foundation: ["base_library"],
}

// OBJCD9 (M60 DERIV_EXPORTS_OBJC): the export markers Objective-C/C declarations
// actually carry.
//
// A member of this set is compared against `node.text` of a `storage_class_specifier`
// — a NAMED node type the grammar emits — so the test is over the grammar's own
// output, not a pattern in source text (lane rule 1).
//
// WHY A CLOSED SET IS HONEST HERE AND A CONVENTION WOULD NOT BE. The corpus
// census (script/m60/objc-exports-census.ts, 322 admitted files, 211,430 nodes)
// counted every candidate export spelling the grammar could carry:
// FOUNDATION_EXPORT 98 declarations in 18 files, `extern` 1; `attribute_specifier`
// 0 and `visibility_specification` 1; export-named `preproc_def` 0 of 24. So
// FOUNDATION_EXPORT and `extern` are the two this corpus uses, and the set says
// so with a measurement rather than a recollection.
//
// "Every declaration in a header is public" is deliberately NOT in this set and
// produces no edge: that is the umbrella-header + module-map CONVENTION, not a
// declaration, and 162 of 169 corpus headers would each manufacture an edge per
// symbol. A convention the grammar cannot see must not be turned into a graph
// edge; it is declared as a limitation with the count attached.
// OC-ONT-8: the symbol kinds that can BE a translation unit's published surface.
//
// A class, a protocol (`@interface`/`@protocol`), a `typedef`, an enum, a struct/union, a
// function and a variable are file-scope DECLARATIONS, and objective-c/C gives each of them
// linkage. A METHOD, a PROPERTY and an enum MEMBER are members of one of those, and
// membership is what `contains` says — publishing a selector as the unit's surface would
// claim the unit defines a name it only owns.
//
// WHY THIS SET EXISTS RATHER THAN "every top-level symbol". Measured over the two
// production corpora: with the member kinds allowed, 777 export rows were produced of which
// 108 sat on `method` symbols that carry no `ownerName` — methods DECLARED inside a
// `@protocol`, which this lane leaves unowned (a pre-existing symbol-level gap, reported and
// not repaired here because repairing it moves `contains` for every protocol in the
// corpus). The kind test is over the analyzer's own symbol model, not over source text.
const OBJC_LINKAGE_UNIT_KINDS: ReadonlySet<string> = new Set([
  ASTEngine.SymbolKind.Class,
  ASTEngine.SymbolKind.Interface,
  ASTEngine.SymbolKind.Struct,
  ASTEngine.SymbolKind.Union,
  ASTEngine.SymbolKind.Enum,
  ASTEngine.SymbolKind.Type,
  ASTEngine.SymbolKind.Function,
  ASTEngine.SymbolKind.Variable,
  ASTEngine.SymbolKind.Constant,
])

const OBJC_EXPORT_MARKERS: ReadonlySet<string> = new Set([
  // Foundation's spelling of `extern __attribute__((visibility("default")))` —
  // the marker every framework header uses for its published surface.
  "FOUNDATION_EXPORT",
  // C's own keyword for external linkage. One occurrence in the corpus, and the
  // grammar has a node type for it, so leaving it out would be the arbitrary
  // choice rather than the principled one.
  "extern",
])

export class RealObjectiveCAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []

    const exports: ASTEngine.ExportInfo[] = []; const frameworks = new Set<string>()
    const errors: ASTEngine.ParseError[] = []

    // Imports are extracted from the AST (preproc_include nodes) during the
    // walk below — no source-text scanning. Framework detection is a pure
    // String.includes check on the module name.

    // Law 3 & 4: Explicit Iterative Stack (O(N) single-pass) and ZERO mutable class props.
    // isInBody distinguishes a real EXECUTION context (method/function/block
    // body) from a declaration context that merely has a class name on the
    // scope stack — `@implementation Foo { SD_LOCK_DECLARE(_lock); }` parses
    // the ivar-area macro as a call_expression, and the pre-fix code emitted
    // a fabricated `calls` edge for it because activeScope (the class name)
    // was non-global there (OBJCD6).
    //
    // OC-E (first OO review): bare-identifier VALUE reads (`uses`). Three
    // walk-state additions carry the scope model — owner (enclosing class
    // name, "" at file scope; categories resolve to the extended class
    // because the class branch sets it from the class name), bindable (true
    // only under a REAL definition or block — method_declaration prototypes
    // must not bind their parameter names into a stale frame), and block
    // exit markers (reusing the isExit flag, which no producer ever sets —
    // a marker pops one block value-frame).
    const walkStack: Array<{ node: Node; isExit: boolean; activeScope: string; parentType: string; isInBody: boolean; owner: string; bindable: boolean }> = [
      { node: rootNode, isExit: false, activeScope: "global", parentType: "", isInBody: false, owner: "", bindable: false }
    ]

    // OC-E scope inventory. valueFrame holds the current method/function
    // definition's bound value names (parameters + body locals); blockFrames
    // is the open block-literal chain (innermost last). classMembers maps a
    // class name to its same-file ivar + property names (pre-scan below —
    // headers are invisible in a .m translation unit, so cross-file ivars
    // stay silent by design). globals holds file-scope declared names.
    // Lookup order frame -> block chain -> class -> globals; anything
    // unbound is silent (family resolvability contract — macro constants,
    // type names, enum cases and keyword spellings never emit).
    let valueFrame: Set<string> | null = null
    const blockFrameStack: Array<Set<string>> = []
    const globals = new Set<string>()
    const classMembers = new Map<string, Set<string>>()
    // OC-ONT-4: class name -> superclass, read from the same-file `extends` clause the
    // `@interface` already declares. `[[super alloc] init]` allocates a SUPERCLASS
    // instance and the superclass is only nameable when a clause in THIS translation unit
    // says so: a `.m` with its `@interface` in a header cannot resolve it, and naming
    // `super` instead would publish a keyword no file declares. Filled as the walk
    // reaches each class declaration, and the declaration always precedes its
    // `@implementation` in the file, so a `[super alloc]` in a body reads a filled map.
    const classSuper = new Map<string, string>()
    // OC-ONT-8: the linkage inventory the `exports` family is derived from. A file-scope
    // declaration is published to the units that import this file exactly when it has
    // EXTERNAL linkage, and `static` is the one spelling of the opposite (C99 6.2.2p5,
    // which Objective-C inherits verbatim). `internalLinkage` holds the names a `static`
    // removed; `exportMarkers`/`exportLineByName` hold the marker spelling and the line of
    // each declaration that carried one, so a marker row keeps naming the marker it rests
    // on while the EDGE itself is emitted once, in the post-pass, from the symbol table.
    const internalLinkage = new Set<string>()
    const exportMarkers = new Map<string, string>()
    const exportLineByName = new Map<string, number>()
    // OC-F (second review): same-file enum case names — `case Red:` and
    // `x == Alpha` reference enum members as values. NS_ENUM/NS_OPTIONS
    // definitions live in headers (out of unit, silent by design); in-file
    // enums (plain + typedef, OC-D symbols) resolve here. Flat set: a name
    // bound anywhere nearer (locals/params/ivars/globals) wins first.
    const enumCases = new Set<string>()
    {
      const preStack: Node[] = [rootNode]
      while (preStack.length > 0) {
        const pn = preStack.pop()!
        if (!pn || pn.isMissing) continue
        if (pn.type === "enum_specifier") {
          const elist = this.findChild(pn, (n) => n.type === "enumerator_list")
          if (elist) {
            for (let ei = 0; ei < elist.namedChildCount; ei++) {
              const en = elist.namedChild(ei)
              if (!en || en.type !== "enumerator") continue
              const nm = this.findChild(en, (n) => n.type === "identifier")
              if (nm && nm.text.trim()) enumCases.add(nm.text)
            }
          }
        }
        if (pn.type === "class_interface" || pn.type === "class_implementation") {
          const cn = this.findChild(pn, (n) => n.type === "identifier" || n.type === "type_identifier")
          if (cn) {
            let members = classMembers.get(cn.text)
            if (!members) { members = new Set<string>(); classMembers.set(cn.text, members) }
            const memStack: Node[] = [pn]
            while (memStack.length > 0) {
              const mn = memStack.pop()!
              if (!mn) continue
              if (mn !== pn && (mn.type === "class_interface" || mn.type === "class_implementation" || mn.type === "protocol_declaration")) continue
              if (mn.type === "property_declaration" || mn.type === "instance_variable") {
                const mname = this.findDeclaredName(mn)
                if (mname) members!.add(mname)
              }
              for (let mi = mn.namedChildCount - 1; mi >= 0; mi--) {
                const mc = mn.namedChild(mi)
                if (mc) memStack.push(mc)
              }
            }
          }
        }
        for (let pi = pn.namedChildCount - 1; pi >= 0; pi--) {
          const pc = pn.namedChild(pi)
          if (pc) preStack.push(pc)
        }
      }
    }
    const bindValue = (name: string): void => {
      if (!name) return
      if (blockFrameStack.length > 0) blockFrameStack[blockFrameStack.length - 1].add(name)
      else if (valueFrame) valueFrame.add(name)
      else globals.add(name)
    }
    const isBoundValue = (name: string, owner: string): boolean => {
      for (let bi = blockFrameStack.length - 1; bi >= 0; bi--) {
        if (blockFrameStack[bi].has(name)) return true
      }
      if (valueFrame && valueFrame.has(name)) return true
      const cm = classMembers.get(owner)
      if (cm && cm.has(name)) return true
      if (globals.has(name)) return true
      // OC-F: same-file enum cases resolve last (locals/params/ivars and
      // globals shadow them — a nearer binding always wins).
      if (enumCases.has(name)) return true
      return false
    }

    while (walkStack.length > 0) {
      const state = walkStack.pop()!
      if (!state) continue
      // OC-E block exit marker: pop one block value-frame.
      if (state.isExit) {
        blockFrameStack.pop()
        continue
      }

      const { node, isExit, activeScope, parentType, isInBody, owner, bindable } = state
      if (isExit || !node || node.isMissing) continue

      let nextActiveScope = activeScope
      let nextIsInBody = isInBody
      let nextOwner = owner
      let nextBindable = bindable

      // Law 1: Flawless Database Extraction (cover all major Obj-C constructs)

      // 0. Imports (#import / #include). Pure AST: the grammar emits
      // preproc_include with a system_lib_string child (`<Foundation/...>`)
      // or a string_literal child (`"Local.h"`). No source-text scanning.
      if (node.type === "preproc_include") {
        let modName: string | null = null
        // The NODE the module name was read from: M59.A7 asks for the line of the NAME, and
        // a name captured as a string has no line. For a quoted include the name is the
        // string_content INSIDE the quotes (the quotes are punctuation, not part of a name).
        let modNode: Node | null = null
        let isSystem = false
        for (let ci = 0; ci < node.namedChildCount; ci++) {
          const cn = node.namedChild(ci)
          if (!cn) continue
          if (cn.type === "system_lib_string") {
            isSystem = true
            const txt = cn.text
            if (txt.length >= 2) { modName = txt.slice(1, txt.length - 1); modNode = cn }
          } else if (cn.type === "string_literal") {
            const content = this.findChild(cn, (n) => n.type === "string_content")
            modName = content ? content.text : cn.text
            modNode = content ?? cn
          }
          if (modName) break
        }
        if (modName) {
          if (modName.includes("UIKit")) frameworks.add("UIKit")
          if (modName.includes("Foundation")) frameworks.add("Foundation")
          if (modName.includes("AppKit")) frameworks.add("AppKit")
          if (modName.includes("Cocoa")) frameworks.add("Cocoa")
          imports.push({
            module: modName, items: [], importType: "include",
            lineNumber: node.startPosition.row + 1,
            isExternal: isSystem || !modName.startsWith("."),
          })
          // OC-ONT-1 — RESTORED FROM THIS LANE'S OWN COMMITTED REVISION `be3415738`, because
          // the pin is on this branch and the emission is not. The `#import`/`#include` is a
          // first-class `imports` edge, not only a `references` edge with import metadata:
          // the reader that answers "what does this module depend on" filters on
          // `relationship_type IN ('imports','exports')` (src/lsp/graph_usages.ts,
          // src/lsp/graph_request.ts), so a C include was visible to it and an Objective-C
          // include was not. Measured in that revision: 902 edges over this lane's admitted
          // corpus, none of them reachable by that query.
          //
          // The pre-existing `references` edge is KEPT, not replaced. Both statements are
          // true of `#import <Foundation/Foundation.h>` (the file depends on that module AND
          // references it), so the change is additive — no consumer loses a label it had —
          // and it follows the precedent this lane already set for the one fact that needs
          // two labels (`calls` AND `instantiates` for `[[Foo alloc] init]`).
          //
          // `isObjCModuleImport: false` is written rather than left absent so the flag is
          // TOTAL over both dependency forms: a consumer can branch on it without a null
          // check, and the fixture objc/module-imports pins that an `#include` is not a
          // module import instead of asserting the absence of a field.
          relationships.push({
            source: "root",
            target: modName,
            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,
            line_number: this.nodeLine(modNode ?? node),
            metadata: {
              relationshipType: "include_dependency",
              isObjCImport: true,
              isObjCModuleImport: false,
              isImport: true,
              isSystem,
              module: modName,
              fileLevel: true,
            },
          })
          // The `references` twin carries its OWN reason code (honesty §4.1: every row below
          // 1.0 names why). An `#include`/`#import` names a HEADER PATH — exact as written,
          // but whether that path resolves to a file in this repository is not checked here
          // and for a system framework never can be. A clang module's row below keeps a
          // DIFFERENT code, because a module is not a header path: one code for both forms
          // would call an unresolved path and an unverifiable module name the same fact.
          relationships.push({
            source: "root",
            target: modName,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            line_number: this.nodeLine(modNode ?? node),
            metadata: { isObjCImport: true, isObjCModuleImport: false, reasonCode: "include-target-not-resolved" },
          })
        }
      }
      // 0b. Clang MODULE imports — `@import Module;`. Objective-C has TWO dependency
      // declarations and this branch read only the `#import` above. The pinned grammar
      // emits a `module_import` node for the `@import` form, whose single named child is
      // an `identifier` holding the module name — there are no `<>` or quotes to strip,
      // which is why the branch above cannot simply be widened to cover it.
      //
      // RESTORED FROM THE SAME COMMITTED REVISION `be3415738`, which measured it before
      // writing it (the router's own 322 admitted files, production `parseFile`):
      // `preproc_include` 904 sites -> 902 imports + 902 references, while
      // `module_import` 6 sites / 6 files -> 0 edges. Six is few, but a dependency a
      // consumer cannot see is not less of a dependency for being rare, and clang modules
      // are the form Apple's own modern example code uses.
      //
      // Same two labels as `#import` and for the same reason; `relationshipType` differs
      // (`module_import` vs `include_dependency`) because a clang module is not a header
      // path: the target names a MODULE, and nothing in this walk knows whether the build
      // defines one under that name. The fixture objc/module-imports pins both spellings,
      // and a later revision of this file (`b727b0fe4`) relabelled the module branch back
      // to `include_dependency` — which is why the pin and the revision must agree before
      // anything is restored, not just the presence of an emission.
      if (node.type === "module_import") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier")
        const modName = nameNode ? nameNode.text.trim() : ""
        if (modName) {
          imports.push({
            module: modName, items: [], importType: "module",
            lineNumber: node.startPosition.row + 1,
            isExternal: true,
          })
          relationships.push({
            source: "root",
            target: modName,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            line_number: this.nodeLine(nameNode ?? node),
            // Its OWN code, not the include's: the target names a MODULE and nothing in this
            // walk knows whether the build defines a module under that name. Pinned by
            // objc/module-imports ("the sub-1.0 twin carries its OWN reason code").
            metadata: { isObjCImport: true, isObjCModuleImport: true, reasonCode: "clang-module-name-not-resolved" },
          })
          relationships.push({
            source: "root",
            target: modName,
            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,
            line_number: this.nodeLine(nameNode ?? node),
            metadata: {
              relationshipType: "module_import",
              isObjCImport: true,
              isObjCModuleImport: true,
              isImport: true,
              isSystem: false,
              module: modName,
              fileLevel: true,
            },
          })
        }
      }
      // 1. Classes & Implementations. tree-sitter-objc parses BOTH plain classes
      // and categories as class_interface/class_implementation. A category is
      // distinguished by a SECOND identifier child (the category name) before
      // any method/property: `@interface MyClass (MyCategory)`. Detect it and
      // emit an Extension symbol instead of a duplicate Class.
      if (node.type === "class_interface" || node.type === "class_implementation") {
        const identNodes: string[] = []
        for (let ci = 0; ci < node.namedChildCount; ci++) {
          const cn = node.namedChild(ci)
          if (cn && cn.type === "identifier") identNodes.push(cn.text)
        }
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          // OC-E: methods resolve ivar/property reads against the enclosing
          // class (categories contribute the extended class name here).
          nextOwner = nameNode.text
          // Category detection: a category is `@interface Name (CategoryName)`
          // which carries an anonymous `(` token. A plain class has `:` then a
          // superclass identifier — never a paren. This is exact, not heuristic.
          let hasParen = false
          for (let ci = 0; ci < node.childCount; ci++) {
            const c = node.child(ci)
            if (c && !c.isNamed && c.type === "(") { hasParen = true; break }
          }
          const isCategory = hasParen

          if (isCategory) {
            symbols.push({
              name: nameNode.text,
              kind: ASTEngine.SymbolKind.Extension,
              range: this.getRange(node),
              ownerName: activeScope !== "global" ? activeScope : undefined,
              metadata: { objcSpecific: true, isCategory: true, categoryName: identNodes[1] },
            })
            // Categories can ALSO declare protocol conformance:
            // `@interface NSString (Cat) <NSCoding>` — the class genuinely
            // adopts the protocol. Emit implements sourced from the EXTENDED
            // class (family convention: swift extension protocol adoption).
            //
            // OC-ONT-6: the adoption list is selected by POSITION, not by shape,
            // because a class EXTENSION re-declares the enclosing class's generic
            // TYPE PARAMETERS in front of its `()` with the very same
            // `parameterized_arguments`: `@interface Cache <KeyType, ObjectType> ()`
            // published `implements Cache -> KeyType`. A category's genuine list sits
            // AFTER the `(`, so the two are mirror images and only a positional rule
            // separates them (objc/generics-and-reason-codes pins both).
            for (const p of this.objcInheritanceLists(node).protocols) {
              relationships.push({ source: nameNode.text, target: p.name, type: ASTEngine.RelationshipType.Implements, confidence: 1.0, line_number: this.nodeLine(p.node), metadata: { objcSpecific: true, isProtocol: true, isCategoryProtocol: true } })
            }
          } else {
            // Plain class: extract superclass + protocols for relationships.
            //
            // OC-ONT-6: `<...>` is NOT always a protocol list. All three of a
            // lightweight-generic class's lists are `parameterized_arguments`, so the
            // adoption list is picked by POSITION — see `objcInheritanceLists` for the
            // rule and the fabricated edges it removes (`implements Cache -> KeyType`).
            const { superClass: superName, superNode, protocols: protocolList } =
              this.objcInheritanceLists(node)
            const protocols: string[] = protocolList.map((p) => p.name)
            // OC-ONT-4: remember the clause for `[[super alloc] ...]` inside this class's
            // methods. An `@implementation` may also restate it, so the later declaration
            // refines rather than blanks an entry (a bare `@implementation Foo` carries no
            // colon and must not erase the `@interface Foo : Bar` already recorded).
            if (superName) classSuper.set(nameNode.text, superName)
            if (superName) { relationships.push({ source: nameNode.text, target: superName, type: ASTEngine.RelationshipType.Extends, confidence: 1.0, line_number: this.nodeLine(superNode ?? nameNode), metadata: { objcSpecific: true } }) }
            for (const p of protocolList) { relationships.push({ source: nameNode.text, target: p.name, type: ASTEngine.RelationshipType.Implements, confidence: 1.0, line_number: this.nodeLine(p.node ?? nameNode), metadata: { objcSpecific: true, isProtocol: true } }) }
            symbols.push({
              name: nameNode.text,
              kind: ASTEngine.SymbolKind.Class,
              range: this.getRange(node),
              ownerName: activeScope !== "global" ? activeScope : undefined,
              metadata: { objcSpecific: true, type: node.type, superClass: superName, protocols },
            })
          }
        }
      }
      // 3. Protocols (@protocol)
      else if (node.type === "protocol_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Interface,
            range: this.getRange(node),
            metadata: { objcSpecific: true, isProtocol: true },
          })
          // Protocol inheritance: `@protocol Child <Parent, Grandparent>` —
          // inherited protocols are the identifiers under
          // protocol_reference_list (probe-verified 2026-08-30). Protocols
          // inherit other protocols in ObjC (family convention: interface
          // extends interface), so emit extends for each inherited parent.
          const refList = this.findChild(node, (n) => n.type === "protocol_reference_list")
          if (refList) {
            for (let ci = 0; ci < refList.namedChildCount; ci++) {
              const cn = refList.namedChild(ci)
              if (cn && cn.type === "identifier") {
                relationships.push({ source: nameNode.text, target: cn.text, type: ASTEngine.RelationshipType.Extends, confidence: 1.0, line_number: this.nodeLine(cn), metadata: { objcSpecific: true, isProtocolInheritance: true } })
              }
            }
          }
        }
      }
      // 4. Methods (@method) — OBJCD7: an ObjC method's identity is the FULL
      // selector ("storeImage:forName:", "getPathForName:bundle:preferredScale:"),
      // not its first keyword. The grammar nests keyword identifiers at the
      // top level alternating with method_parameter nodes (parameter locals
      // live INSIDE method_parameter, probe-verified 2026-09). Leaf naming
      // merged distinct selectors sharing a first keyword (SDImageCache:
      // initWithNamespace / initWithNamespace:diskCacheDirectory: /
      // initWithNamespace:diskCacheDirectory:config: -> one symbol, 14 of 59
      // methods silently lost) and made message-send targets unresolvable.
      else if (node.type === "method_declaration" || node.type === "method_definition") {
        const sel = this.fullMethodSelector(node)
        if (sel) {
          nextActiveScope = sel
          if (node.type === "method_definition") {
            // OC-E: methods never nest — a definition opens a fresh value
            // frame (parameters + body locals). Declarations bind nothing
            // (their parameter names must not leak into a stale frame).
            valueFrame = new Set<string>()
            nextBindable = true
          }
          // The `+`/`-` sign is an anonymous token child of the method node
          // (`method_declaration [-:"-"] [;:";"]`) — pure AST, no text scan.
          const isClassMethod = this.isClassMethodToken(node)
          symbols.push({
            name: sel,
            kind: ASTEngine.SymbolKind.Method,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            complexity: this.calculateCyclomaticComplexity(node),
            metadata: { objcSpecific: true, isClassMethod, isInstanceMethod: !isClassMethod, selector: sel },
          })
        }
      } 
      // 5. Standard C Functions. OBJCD5: pointer/object-return helpers parse
      // the defining declarator NESTED — `static NSArray * fn(...)` is
      // function_definition > pointer_declarator > function_declarator, and
      // `static NSDictionary<...> * fn(...)` adds a generic_specifier sibling.
      // The pre-fix code looked for a DIRECT function_declarator/identifier
      // child, so every pointer-return C helper was silently dropped — and
      // because the function was never symbolized, activeScope stayed
      // "global" and its ENTIRE body (calls, uses, instantiates) was
      // suppressed. Corpus (afnetworking+sdwebimage, 153 files): 46 of 110
      // C helper functions affected. Resolution: the FIRST function_declarator
      // in document order that is NOT inside the compound_statement is the
      // definition's head (parameters nest function-pointer declarators
      // strictly AFTER the head in the tree).
      else if (node.type === "function_definition") {
        const nameNode = this.findFunctionName(node)
        if (nameNode) {
          // OC-ONT-8: `static NSInteger helper(...) {}` is a DEFINITION with internal
          // linkage — the helper is a real symbol and a real call target, but it is not
          // part of what this translation unit publishes. 50 of the corpus's file-scope
          // function definitions carried `static` and every one was published public.
          for (let si = 0; si < node.namedChildCount; si++) {
            const sc = node.namedChild(si)
            if (sc && sc.type === "storage_class_specifier" && sc.text.trim() === "static") {
              internalLinkage.add(nameNode.text)
              break
            }
          }
          nextActiveScope = nameNode.text
          // OC-E: file-scope C functions open a fresh value frame with no
          // enclosing class (their locals are the richest bare-read source
          // in helper-heavy files).
          valueFrame = new Set<string>()
          nextOwner = ""
          nextBindable = true
          // OC-H (second review): file-scope function names are resolvable
          // value reads (`cb = helper` decay, recursion references) — bare
          // `helper` can never invoke a method (receivers required), so the
          // global attribution is exact. Locals shadow via frame-first order.
          globals.add(nameNode.text)
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Function,
            range: this.getRange(node),
            complexity: this.calculateCyclomaticComplexity(node),
            metadata: { objcSpecific: true },
          })
        }
      }
      // 6. Properties (@property) — the name lives deep inside the trailing
      // struct_declaration (`NSString *prefix` → struct_declaration →
      // struct_declarator → pointer_declarator → identifier).
      else if (node.type === "property_declaration") {
        const nameNode = this.findDeclaredName(node)
        if (nameNode) {
          symbols.push({
            name: nameNode,
            kind: ASTEngine.SymbolKind.Property,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true },
          })
        }
      }
      // 6b. Instance variables (@implementation X { ... }) — declarations, not locals.
      else if (node.type === "instance_variable") {
        const nameNode = this.findDeclaredName(node)
        if (nameNode) {
          symbols.push({
            name: nameNode,
            kind: ASTEngine.SymbolKind.Property,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true, isInstanceVariable: true },
          })
        }
      }
      // 6c. C type declarations (OC-D, first OO review — C parity). The
      // pinned objc wasm shares the C node shapes exactly (shape-dumped):
      // struct_specifier > type_identifier + field_declaration_list,
      // enum_specifier > type_identifier + enumerator_list > enumerator,
      // type_definition > typedef-name (+ optional struct/enum for
      // `typedef struct {...} Size`). C symbolizes all of these (holy-c
      // waves); objc dropped them, so identical C code lost its entire type
      // inventory in a .m file. Mirror C's symbol shapes (Struct + Property
      // fields owned by the struct, Enum + EnumMember owned by the enum,
      // Type for aliases, anonymous structs named by their typedef).
      // Type-USE references are deliberately NOT ported: every ObjC method
      // signature mentions Foundation types, so C-style type-use references
      // would be systematic noise (ruled in the spec).
      else if (node.type === "struct_specifier" || node.type === "union_specifier") {
        const sname = this.findChild(node, (n) => n.type === "type_identifier")
        const tname = sname ? sname.text : this.typedefName(node)
        // Definition-only: a bare `struct Node *p` reference (no field
        // list, not under a typedef) declares nothing.
        const defines = !!this.findChild(node, (n) => n.type === "field_declaration_list") ||
          (node.parent != null && node.parent.type === "type_definition")
        if (tname && defines) {
          symbols.push({
            name: tname,
            kind: ASTEngine.SymbolKind.Struct,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true, isCStruct: true },
          })
          const flist = this.findChild(node, (n) => n.type === "field_declaration_list")
          if (flist) {
            for (let fi = 0; fi < flist.namedChildCount; fi++) {
              const fd = flist.namedChild(fi)
              if (!fd || fd.type !== "field_declaration") continue
              // The field name nests under pointer declarators
              // (`struct Node *next`), so search the declaration subtree
              // (nested struct_specifiers carry type_identifiers, never
              // field_identifiers — the first hit is the field).
              const fname = this.deepFind(fd, (n) => n.type === "field_identifier")
              if (fname && fname.text.trim()) {
                symbols.push({
                  name: fname.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.getRange(fd),
                  ownerName: tname,
                  metadata: { objcSpecific: true, isStructField: true },
                })
              }
            }
          }
        }
      }
      else if (node.type === "enum_specifier") {
        const ename = this.findChild(node, (n) => n.type === "type_identifier")
        // Apple's macro spelling carries the name INSIDE the macro's own arguments and has no
        // trailing declarator at all — `typedef NS_ENUM(NSUInteger, Foo) { ... };` — so both of
        // the ordinary routes to a name are unavailable: the C path looks for a
        // `type_identifier` CHILD (the macro's arguments are `identifier` nodes), and
        // `typedefName` looks for a trailing alias declarator on the `type_definition` (there
        // is none). Both return null, the whole enum branch is skipped, and an 18-line
        // declaration that now parses with ZERO error nodes still contributes no symbol and no
        // members: a clean tree the analyzer reads as empty.
        //
        // So the name is resolved from the arguments, explicitly, as the LAST identifier —
        // `NS_ENUM(underlying, Name)` puts the underlying type first. Taking the FIRST, which
        // is what a bare "first identifier" rule would do, names every such enum
        // `NSUInteger`, and 35 of them would then collide on one owner.
        const macroArgs = this.findChild(node, (n) => n.type === "macro_enum_arguments")
        let macroName: string | null = null
        if (macroArgs) {
          for (let i = macroArgs.namedChildCount - 1; i >= 0; i--) {
            const c = macroArgs.namedChild(i)
            if (c && c.text && c.text.trim()) { macroName = c.text.trim(); break }
          }
        }
        const tname = macroName ?? (ename ? ename.text : this.typedefName(node))
        // Definition-only: `enum Color x` (no enumerator list, not under a
        // typedef) is a use, not a declaration.
        const defines = !!this.findChild(node, (n) => n.type === "enumerator_list") ||
          (node.parent != null && node.parent.type === "type_definition")
        if (tname && defines) {
          symbols.push({
            name: tname,
            kind: ASTEngine.SymbolKind.Enum,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true, isCEnum: true },
          })
          const elist = this.findChild(node, (n) => n.type === "enumerator_list")
          if (elist) {
            for (let ei = 0; ei < elist.namedChildCount; ei++) {
              const en = elist.namedChild(ei)
              if (!en || en.type !== "enumerator") continue
              const mname = this.findChild(en, (n) => n.type === "identifier")
              if (mname && mname.text.trim()) {
                symbols.push({
                  name: mname.text,
                  kind: ASTEngine.SymbolKind.EnumMember,
                  range: this.getRange(en),
                  ownerName: tname,
                  metadata: { objcSpecific: true },
                })
              }
            }
          }
        }
      }
      else if (node.type === "type_definition") {
        // `typedef int Counter` — the alias is the LAST type_identifier
        // child (specifier types precede it). When the typedef defines a
        // struct/enum, the aggregate branch above owns the symbol (C parity:
        // `typedef struct Node {...} Node` emits struct:Node only, never a
        // parallel type:Node).
        let alias: Node | null = null
        for (let ti = 0; ti < node.namedChildCount; ti++) {
          const tc = node.namedChild(ti)
          if (tc && (tc.type === "type_identifier" || tc.type === "identifier")) alias = tc
        }
        const hasAggregate = !!this.findChild(node, (n) => n.type === "struct_specifier" || n.type === "union_specifier" || n.type === "enum_specifier")
        if (alias && !hasAggregate) {
          symbols.push({
            name: alias.text,
            kind: ASTEngine.SymbolKind.Type,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true, isTypedef: true },
          })
        }
      }
      // 7. Variables (C-style declarations) — file-scope only; method-body
      // declarations are locals (execution artifacts) and blocks are generated.
      else if (node.type === "block_literal") {
        // Anonymous blocks have generated names — skip as symbols.
        // OC-E: a block opens a chained value frame for its parameters
        // (closed by the exit marker pushed with the children below).
        if (nextBindable) blockFrameStack.push(new Set<string>())
      } else if (node.type === "declaration" && activeScope === "global") {
          // OC-E: every declarator binds (multi-declarator `int x = 1,
          // y = 2` binds both) through the declarator name — pointer
          // globals (`static NSString * k = ...`) nest the name under a
          // pointer_declarator, so a direct-child lookup misses them. Bare
          // declarators without initializers (`static NSArray * g;`) bind
          // the same way.
          //
          // A PROTOTYPE binds its name too (C parity: `collectBoundLocals`
          // in real-c-analyzer.ts lists `function_declarator`), and it is
          // symbolized as a FUNCTION rather than a variable — see the
          // function_declarator arm below.
          //
          // An UNTERMINATED declaration publishes nothing (see
          // isUnterminatedDeclaration): it has no declarator, so the only
          // identifier in reach is a specifier macro. Traversal still descends
          // either way — the walk below is driven by this branch's return
          // state, not by the loop — so nothing nested is skipped.
          if (!isUnterminatedDeclaration(node) && !hasParseError(node)) {
            // The export marker slot, read once for the whole declaration: an
            // Objective-C/C export marker (`FOUNDATION_EXPORT`, `extern`) is a
            // NAMED `storage_class_specifier` the grammar emits, which is what
            // makes the `exports` edge declaration-backed rather than a spelling
            // matched in source text.
            //
            // OC-ONT-8: the same slot is ALSO where `static` is read, because internal
            // linkage (C99 6.2.2p5) is the one spelling that REMOVES a file-scope
            // declaration from this unit's published surface. Measured over the pinned
            // corpus before the rule existed: 50 file-scope function_definitions and 67
            // file-scope declarations carried `static` and every one was published
            // `visibility: "public"` — asserting an importability the language denies.
            let exportMarker: string | null = null
            let storageStatic = false
            for (let si = 0; si < node.namedChildCount; si++) {
              const sc = node.namedChild(si)
              if (!sc || sc.type !== "storage_class_specifier") continue
              const st = sc.text.trim()
              if (st === "static") storageStatic = true
              if (!exportMarker && OBJC_EXPORT_MARKERS.has(st)) exportMarker = st
            }
            for (let di = 0; di < node.namedChildCount; di++) {
              const dc = node.namedChild(di)
              if (!dc) continue
              let dname: string | null = null
              // OBJCD9 (M60 DERIV_EXPORTS_OBJC): a declarator chain that reaches
              // a `function_declarator` is a function PROTOTYPE, whatever wraps
              // it — `void f(int);` (bare) or `NSString * f(NSDictionary *d);`
              // (pointer). The pre-fix arm list knew only the wrappers and had no
              // function_declarator case at all, which cost two different things
              // measured over the 322-file admitted universe by
              // script/m60/objc-prototype-defect.ts and
              // script/m60/objc-proto-label.ts: 8 of 8 bare prototypes published
              // NO symbol at all, and 13 pointer-returning prototypes published
              // as `variable`. 21 of the corpus's 23 file-scope prototypes were
              // wrong or absent. Handed the same three prototypes, RealCAnalyzer
              // publishes 3 functions and this analyzer published none, so the
              // grammar is not the difference — the objc grammar inherits
              // upstream tree-sitter-c 0.24.1 and parses them identically.
              const isPrototype =
                dc.type === "function_declarator" ||
                ((dc.type === "pointer_declarator" || dc.type === "array_declarator" ||
                  dc.type === "parenthesized_declarator" || dc.type === "attributed_declarator") &&
                  this.declaratorChainHasFunctionDeclarator(dc))
              if (dc.type === "init_declarator") {
                dname = this.declaratorName(dc)
              } else if (dc.type === "identifier") {
                dname = dc.text
              } else if (isPrototype || dc.type === "pointer_declarator" || dc.type === "array_declarator" ||
                         dc.type === "parenthesized_declarator" || dc.type === "attributed_declarator") {
                dname = this.declaratorName(dc)
              }
              if (dname) {
                symbols.push({
                  name: dname,
                  kind: isPrototype ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Variable,
                  range: this.getRange(node),
                  metadata: isPrototype
                    ? { objcSpecific: true, isCFunctionPrototype: true }
                    : { objcSpecific: true },
                })
                // OC-E: file-scope names are resolvable read targets. A
                // prototype's name is one too — `cb = helper` decay needs it, and
                // the C analyzer binds `function_declarator` names for the same
                // reason (C parity, measured on the same three prototypes).
                globals.add(dname)
                // OBJCD9 (second half): an export MARKER is a declaration of
                // external linkage, so the declared name is an export. Shape is
                // the house one for a language with no module keyword —
                // `<file-scope source> -> <exported name>`, as go
                // (`packageName -> name`), python (`moduleName -> name`) and
                // typescript (`moduleLeafName -> name`) do. It is deliberately
                // NOT the C sibling's `<name> -> <macro>`: that shape's TARGET is
                // the marker, which names no symbol anywhere, so one of the two
                // endpoints could never resolve. Here both do — the target is a
                // symbol in this file, and `fileLevel` is what lets the store name
                // the importing FILE on the source half (the same key c and
                // powershell set for exactly this situation).
                // OC-ONT-8: the DECLARATION is recorded here and the export EDGE is
                // emitted in the post-pass, once every symbol of the file is known. The
                // reason is that the two things an export row needs come from different
                // places: the marker and the linkage come from THIS node, while the name
                // that can actually be exported is the SYMBOL the declaration produces —
                // and a declaration whose declarator is a phantom (the unterminated
                // stacked-macro shape, afnetworking AFURLRequestSerialization.h:31)
                // produces no symbol, so it must publish no edge. Emitting here keyed the
                // row on the declarator TEXT, which is how a phantom could be exported.
                if (storageStatic) internalLinkage.add(dname)
                if (exportMarker) { exportMarkers.set(dname, exportMarker); exportLineByName.set(dname, this.nodeLine(node)) }
              }
            }
          }
      } else if (node.type === "declaration" && nextBindable) {
        // OC-E: in-body declarations bind their declarator names as locals
        // (no symbols — locals are execution artifacts, family contract),
        // including bare declarators without initializers.
        for (let di = 0; di < node.namedChildCount; di++) {
          const dc = node.namedChild(di)
          if (!dc) continue
          if (dc.type === "init_declarator") {
            const dname = this.declaratorName(dc)
            if (dname) bindValue(dname)
          } else if (dc.type === "identifier") {
            bindValue(dc.text)
          } else if (dc.type === "pointer_declarator" || dc.type === "array_declarator" ||
                     dc.type === "parenthesized_declarator" || dc.type === "attributed_declarator") {
            const dname = this.declaratorName(dc)
            if (dname) bindValue(dname)
          }
        }
      } else if ((node.type === "method_parameter" || node.type === "parameter_declaration") && nextBindable) {
        // OC-E: parameter names bind into the current frame. Only the
        // declarator identifier binds (type names are type_identifier, and
        // `id` parses as typedefed_specifier — never bare identifiers).
        const pname = this.declaratorName(node)
        if (pname) bindValue(pname)
      }
      // 7b. For-in loop variables (`for (id x in items)`) — the identifier
      // directly preceding the anonymous `in` token binds as a local; the
      // collection (`items`) stays a read candidate for the rule below.
      else if (node.type === "for_statement" && nextBindable) {
        const cc = node.childCount
        for (let fi = 0; fi < cc; fi++) {
          const fc = node.child(fi)
          if (fc && !fc.isNamed && fc.type === "in" && fi > 0) {
            for (let fj = fi - 1; fj >= 0; fj--) {
              const pc = node.child(fj)
              if (pc && pc.isNamed) {
                if (pc.type === "identifier") bindValue(pc.text)
                break
              }
            }
            break
          }
        }
      }
      // 8. Relationships (Obj-C Message Expressions `[receiver selector]` & C-Function Calls)      // OBJCD7: the callable identity of a message send is the FULL selector
      // (storeImage:forName:, initWithBlock:), not its first keyword — a
      // leaf-named edge could not resolve to the exact overload. The grammar
      // flattens keywords and arguments as siblings; a keyword is an
      // identifier whose NEXT child is an anonymous ':' token (colons are
      // direct anonymous children of message_expression, probe-verified
      // 2026-09). Zero-argument messages have no ':' — the selector is the
      // LAST identifier child (receiver identifiers live in nested nodes;
      // `[foo bar]` -> bar, `[[Foo alloc] init]` -> init).
      else if (node.type === "message_expression") {
         const msgSel = this.fullMessageSelector(node)
         if (msgSel && activeScope !== "global" && isInBody) {
            // alloc/new detection uses the FIRST keyword (these are zero-arg
            // selectors, so the leaf equals the full selector).
            const firstKw = msgSel.split(":")[0]
            if (firstKw === "alloc" || firstKw === "new") {
              let receiverLeaf: string | null = null
              // The node the instantiated CLASS name was read from: the line belongs to the
              // reference site's name, not to the enclosing statement's start.
              let recvTargetNode: Node | null = null
              const receiver = node.namedChild(0)
              if (receiver) {
                if (receiver.type === "identifier" || receiver.type === "type_identifier") {
                  // OC-ONT-4: `[[self alloc] init]` allocates an instance of the
                  // RECEIVER'S OWN CLASS, and `[[super alloc] init]` one of its
                  // superclass. `self`/`super` are the implicit receiver KEYWORDS — no file
                  // declares them and no consumer can resolve them — so the pre-fix code
                  // published `instantiates <method> -> self`, 24 of 507 corpus edges
                  // (4.7%), naming a keyword. The enclosing class is already resolved here
                  // (`owner`), and `super` resolves from the same-file extends clause.
                  // Where neither is knowable the row is NOT published: a target that names
                  // a keyword is a worse answer than no row, and the oracle divergence
                  // instrument classifies exactly this refusal as the analyzer being right
                  // (script/m60/objc-oracle-divergence.ts, `instantiates->self`).
                  // objc/linkage-and-imports pins the resolved pair
                  // (`duplicate -> Serializer`, the SUPERCLASS, and no row naming `super`).
                  const keyword = receiver.text === "self" || receiver.text === "super" ? receiver.text : null
                  if (keyword) {
                    const resolved = keyword === "self" ? owner : classSuper.get(owner)
                    // `super` must name the SUPERCLASS, never the enclosing class: naming the
                    // subclass would invert the edge (objc/linkage-and-imports forbids it).
                    if (resolved && resolved !== "global") {
                      receiverLeaf = resolved
                      recvTargetNode = receiver
                    }
                  } else {
                    receiverLeaf = receiver.text
                    recvTargetNode = receiver
                  }
                } else if (receiver.type === "message_expression") {
                  // Nested: [[Logger alloc] ...] — the inner message's receiver
                  // is the class. If the inner selector is itself alloc/new,
                  // its own visit already emitted the Instantiates edge.
                  const innerSel = this.findChild(receiver, (n) => n.type === "identifier")
                  if (innerSel && (innerSel.text === "alloc" || innerSel.text === "new")) {
                    const innerRecv = receiver.namedChild(0)
                    if (innerRecv && (innerRecv.type === "identifier" || innerRecv.type === "type_identifier")) {
                      receiverLeaf = innerRecv.text
                      recvTargetNode = innerRecv
                    }
                  }
                }
              }
              if (receiverLeaf) {
                // Honesty §4.1: `[Foo alloc]` names the allocator's RECEIVER in this
                // translation unit — the name is exact — but whether that name denotes a
                // class this build can see as an allocator (`+alloc` on a class declared
                // elsewhere, a class extension in a header, a macro spelling a factory) is
                // not checked across files. That is the doubt, so it is the code
                // (objc/generics-and-reason-codes pins the word).
                relationships.push({ source: activeScope, target: receiverLeaf, type: ASTEngine.RelationshipType.Instantiates, confidence: 0.9, line_number: this.nodeLine(recvTargetNode ?? node), metadata: { isObjCAlloc: true, reasonCode: "allocator-receiver-not-cross-file-checked" } })
              }
            } else {
              // Honesty §4.1: the row is below 1.0 and now says why. A message send names a
              // SELECTOR; which class implements it is decided at runtime, so the edge is
              // dynamic dispatch even when the receiver's class is known in this file. The
              // C-call producer below keeps a DIFFERENT code — one code for both would call
              // a runtime dispatch and an unresolved translation unit the same fact
              // (objc/generics-and-reason-codes and objc/selector-attributes pin the pair).
              relationships.push({
                source: activeScope,
                target: msgSel,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.95,
                line_number: this.nodeLine(this.fullMessageSelectorNode(node) ?? node),
                metadata: { isMessageExpression: true, reasonCode: "dynamic-dispatch-selector" }
              })
            }
            // OC-E bare reads inside the send: the receiver (namedChild(0)
            // when it is a bare identifier) and every argument identifier.
            // Keywords (identifier followed by ':') and the zero-argument
            // selector (last non-keyword identifier when the send has no
            // keywords) are NAMES, never reads. Unbound names (type
            // receivers like NSString, macro constants) stay silent.
            const msgKids: Array<{ n: Node; isKeyword: boolean }> = []
            for (let mi = 0; mi < node.childCount; mi++) {
              const mc = node.child(mi)
              if (!mc || !mc.isNamed || mc.type !== "identifier") continue
              const nxt = mi + 1 < node.childCount ? node.child(mi + 1) : null
              msgKids.push({ n: mc, isKeyword: !!(nxt && !nxt.isNamed && nxt.type === ":") })
            }
            const recvNode = node.namedChild(0)
            const hasKeyword = msgKids.some((k) => k.isKeyword)
            let lastNonRecv = -1
            if (!hasKeyword) {
              for (let ki = msgKids.length - 1; ki >= 0; ki--) {
                if (!this.sameNode(msgKids[ki].n, recvNode)) { lastNonRecv = ki; break }
              }
            }
            for (let ki = 0; ki < msgKids.length; ki++) {
              const kk = msgKids[ki]
              if (kk.isKeyword || ki === lastNonRecv) continue
              const ktext = kk.n.text.trim()
              if (!ktext || BARE_READ_SKIP.has(ktext)) continue
              if (this.sameNode(kk.n, recvNode)) {
                // Receiver position: self/super are implicit, never reads.
                if (ktext === "self" || ktext === "super") continue
              }
              if (isBoundValue(ktext, nextOwner)) {
                relationships.push({
                  source: activeScope,
                  target: ktext,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.9,
                  line_number: this.nodeLine(kk.n),
                  metadata: { isBareRead: true, isMessageArgument: !this.sameNode(kk.n, recvNode), reasonCode: "value-read-by-scope-inference" },
                })
              }
            }
          }
       }
      else if (node.type === "call_expression") {
        // The grammar FIELDS the callee as `function`: an `identifier` for a C call and a
        // `field_expression` for `self.blockProp(x)` (probe-verified on the pinned wasm,
        // 2026-10). The old code looked only for a direct `identifier` child, so a callee
        // reached through a FIELD produced NO `calls` row at all while the same
        // `field_expression` still produced its `uses` row — the call was invisible.
        // Measured over the router's 322 admitted files before this branch existed
        // (script/m60/objc-call-shape-probe.ts): identifier 3,615 sites -> 2,277 edges,
        // field_expression 823 sites / 44 callee names -> 0 edges.
        const funcNode = node.childForFieldName("function") ?? this.findChild(node, (n) => n.type === "identifier")
        // OC-G (second review): `@protocol(P)` parses as at_expression >
        // call_expression with callee `protocol` — a compiler directive,
        // not an invocation (OC-R2 @selector parity: directives name,
        // never call). `@encode` already stays silent by shape.
        const inAtDirective = (() => {
          let p: Node | null | undefined = node.parent
          let g = 0
          while (p && g++ < 3) {
            if (p.type === "at_expression") return true
            if (p.type === "message_expression" || p.type === "call_expression") return false
            p = p.parent
          }
          return false
        })()
        if (funcNode && activeScope !== "global" && isInBody && !(inAtDirective && funcNode.text === "protocol")) {
          if (funcNode.type === "field_expression") {
            // A FIELD-INVOKED callee (`self.progressHandler(3)`). The name a consumer can
            // resolve is the FIELD's, never the receiver's: for a chain the outermost
            // `field_expression`'s own `field` IS the innermost field
            // (`self.sink.onTap(1)` -> `onTap`), and naming `sink` would name a value.
            //
            // The row is deliberately NOT the C branch's: the callee name is exact here
            // too, but what is undetermined is the KIND of callable the field holds — a
            // block, a function pointer, or (in a .mm) a C++ member — so it carries its
            // own code `field-callee-kind-not-determined`. Collapsing it onto
            // `callee-not-resolved-in-unit` would say a translation-unit binding is
            // unresolved (objc/field-invocation forbids exactly that).
            const fieldNode = funcNode.childForFieldName("field") ?? this.findChild(funcNode, (n) => n.type === "field_identifier")
            if (fieldNode && fieldNode.text.trim()) {
              relationships.push({
                source: activeScope,
                target: fieldNode.text,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.95,
                line_number: this.nodeLine(fieldNode),
                metadata: { isFieldInvocation: true, reasonCode: "field-callee-kind-not-determined" }
              })
            }
          } else {
            relationships.push({
              source: activeScope,
              target: funcNode.text,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.95,
              line_number: this.nodeLine(funcNode),
              metadata: { isCFunctionCall: true }
            })
          }
        }
      }
      // 8b. Member READS (managed-OO family contract — dart/swift/csharp
      // emit uses for property/ivar reads). ObjC dot-syntax `self.next`,
      // `w.next`, `self.origin.x` parse as field_expression with a
      // field_identifier (probe-verified 2026-08-30). Emit uses -> the
      // field name, from the enclosing method scope. Writes (LHS of
      // assignment_expression) are NOT reads — only reads become uses.
      else if (node.type === "field_expression" && activeScope !== "global" && isInBody) {
        const field = node.childForFieldName("field") ?? this.findChild(node, (n) => n.type === "field_identifier")
        if (field && field.text.trim()) {
          // Skip the LHS of an assignment (a write, not a read): the
          // field_expression is the assignment's left child.
          if (parentType !== "assignment_expression") {
            relationships.push({
              source: activeScope,
              target: field.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(field),
              // Honesty §4.1: sub-1.0 rows carry their own machine-readable code, and
              // `uses` has ONE — the read is exact (the field name is in the source) and
              // what the row infers is WHICH binding the name denotes, resolved against
              // the enclosing class's members. The `calls` rows for the same node keep a
              // different word (`field-callee-kind-not-determined`), because the call is
              // about the callable's KIND and the read is about the binding
              // (objc/generics-and-reason-codes pins the family, objc/field-invocation
              // pins that the two labels on one node are told apart by their flags).
              metadata: { isFieldRead: true, relationshipType: "field_access", reasonCode: "value-read-by-scope-inference" },
            })
          }
        }
      }
      // 8c. Bare-identifier VALUE reads (OC-E, managed-OO family contract).
      // A bare identifier in a body is a read when it names a bound value
      // (parameter, body local, same-file ivar/property, file global).
      // Everything else is a name, not a read: declarations (declarator
      // names via isDeclaratorName and the parameter-declarator chain via
      // isParameterDeclaredName, direct declaration children, parameter
      // and method keywords), message parts (handled in the send branch
      // above), call callees (CGD17 parity — the callee is a call, not a
      // read), assignment-LHS writes (span-matched like the C analyzer),
      // for-in loop variables, @synthesize/@selector names, and the implicit
      // / constant spellings (self/super/nil/YES/NO/_cmd).
      else if (node.type === "identifier" && nextBindable && activeScope !== "global") {
        const text = node.text.trim()
        if (text && !BARE_READ_SKIP.has(text)) {
          const parent = node.parent
          const ptype = parent ? parent.type : ""
          let isName = false
          if (ptype === "method_declaration" || ptype === "method_definition" ||
              ptype === "method_parameter" || ptype === "parameter_declaration" ||
              ptype === "property_implementation" || ptype === "selector_expression" ||
              ptype === "function_declarator" || ptype === "message_expression" ||
              ptype === "declaration") {
            isName = true
          } else if (ptype === "call_expression" && parent && parent.namedChild(0) && this.sameNode(parent.namedChild(0)!, node)) {
            isName = true
          } else if (ptype === "assignment_expression" && parent && parent.namedChild(0) && this.spanContains(parent.namedChild(0)!, node)) {
            isName = true
          } else if (ptype === "for_statement" && parent && this.isForInVariable(parent, node)) {
            isName = true
          } else if (this.isDeclaratorName(node) || this.isParameterDeclaredName(node)) {
            isName = true
          }
          if (!isName && isBoundValue(text, nextOwner)) {
            relationships.push({
              source: activeScope,
              target: text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(node),
              // Honesty §4.1: the read is exact — the identifier is in the source — and what
              // the row INFERS is which binding the name denotes (parameter, body local,
              // same-file ivar/property, file global). That is the whole of the doubt, so it
              // is the whole of the code (objc/generics-and-reason-codes pins the word).
              metadata: { isBareRead: true, reasonCode: "value-read-by-scope-inference" },
            })
          }
        }
      }

      // Law 2: Absolute Zero array bridge. Bounds checked loops only.
      // A method/function/block node starts a real body: its children (and
      // their descendants) are execution context. Everything else (class
      // ivar braces, @interface declarations, file-scope) is not — message
      // sends and calls there are macro/declaration artifacts, never edges.
      const childCount = node.namedChildCount
      nextIsInBody = nextIsInBody || node.type === "method_definition" || node.type === "method_declaration" || node.type === "function_definition" || node.type === "block_literal"
      // OC-E: block exit markers are pushed FIRST so they pop AFTER all
      // children (LIFO) and close the block's value frame.
      if (node.type === "block_literal" && nextBindable) {
        walkStack.push({ node, isExit: true, activeScope: nextActiveScope, parentType: node.type, isInBody: nextIsInBody, owner: nextOwner, bindable: nextBindable })
      }
      for (let i = childCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
           walkStack.push({ node: child, isExit: false, activeScope: nextActiveScope, parentType: node.type, isInBody: nextIsInBody, owner: nextOwner, bindable: nextBindable })
        }
      }
    }

    // Law 3: O(1) MAP deduplications. @interface + @implementation are the
    // SAME class/method/property in Obj-C (the header declares, the .m
    // defines) — they must merge into one symbol, so the key is
    // kind:owner:name (no start line). Categories are the exception: several
    // distinct categories may exist on one class, so the category NAME joins
    // the key (extension::NSString:MyAdditions vs extension::NSString:Other).
    const uniqueSymbolsMap = new Map<string, ASTEngine.UniversalSymbol>()
    for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i]
        const catKey = s.kind === ASTEngine.SymbolKind.Extension && s.metadata?.isCategory ? `:${s.metadata?.categoryName ?? ''}` : ''
        uniqueSymbolsMap.set(`${s.kind}:${s.ownerName || ''}:${s.name}${catKey}`, s)
    }
    const uniqueSymbols = Array.from(uniqueSymbolsMap.values())

    // Dedup key includes the relationship TYPE — two distinct facts with the
    // same (source, target) pair (e.g. calls vs instantiates for `[Foo alloc]`)
    // must never collapse into one. When same-key uses edges merge, the
    // read-kind flags union: a name read BOTH as a member (`self.x`) and as
    // a bare value (`x`) was genuinely read both ways (OC-E fixture pins
    // the field-read mark on such merges).
    const uniqueRelMap = new Map<string, ASTEngine.UniversalRelationship>()
    for (let i = 0; i < relationships.length; i++) {
        const rk = `${relationships[i].type}|${relationships[i].source}->${relationships[i].target}`
        const prev = uniqueRelMap.get(rk)
        if (prev) {
          const pm: any = prev.metadata ?? {}
          const nm: any = relationships[i].metadata ?? {}
          if (nm.isFieldRead) pm.isFieldRead = true
          if (nm.isBareRead) pm.isBareRead = true
          prev.metadata = pm
          // M59.A7: a merged duplicate must not LOSE the line the other copy carried —
          // the dedup key is (type, source, target), so two reads of the same member at
          // different sites collapse to one row and the survivor keeps the first line it
          // was given (which is the site the row already claimed).
          if (prev.line_number === undefined && relationships[i].line_number !== undefined) {
            prev.line_number = relationships[i].line_number
          }
        } else {
          uniqueRelMap.set(rk, relationships[i])
        }
    }
    const uniqueRelationships = Array.from(uniqueRelMap.values())
    const relKeySet = new Set(uniqueRelMap.keys())

    // --- OC-ONT-8: the `exports` family, at the FLEET's scope and vocabulary.
    //
    // WHAT AN EXPORT IS HERE. A file-scope declaration with EXTERNAL linkage is visible to
    // every translation unit that imports this file (C99 6.2.2p5, inherited verbatim), and
    // that is the whole of the claim: a class, a protocol, a `typedef` of a struct, a
    // function, a variable, and a marker-bearing declaration (`FOUNDATION_EXPORT`, `extern`)
    // all publish the same way. Measured with script/m60/objc-construct-site-probe.ts over
    // the 322 admitted files: 338 file-scope external-linkage construct sites against 98
    // edges emitted by the marker-only rule — the 240-site gap is the declarations that are
    // publishable and were not published, and the same instrument's own export scope is the
    // external-linkage one this family now uses.
    //
    // WHY `<root> -> <name>` AND NOT THE C SIBLING'S `<name> -> <MACRO>`. The C analyzer
    // publishes `exports curl_strequal -> CURL_EXTERN`, whose TARGET names no symbol
    // anywhere. go (`packageName -> name`), python (`moduleName -> name`), typescript
    // (`moduleLeafName -> name`) and powershell (`top().scope -> name`) all put the
    // container on the source half and the NAME on the target half, so both ends resolve.
    // Objective-C has no module keyword, so the container is the translation unit — the
    // `root` this lane already uses for its file-scope edges — and `fileLevel` is the key
    // the store reads to name the importing FILE on such a row. The FLEET vocabulary
    // (`relationshipType: "module_export"`, `isExport`, `fileLevel`) is what c, cpp and
    // powershell publish, so a consumer reads one shape for all five.
    //
    // NOT AN EXPORT: a `static` unit (internal linkage), a member (it rides `contains`), a
    // category label (OC-B), an imported module (a dependency, `imports`/`references`), a
    // superclass declared elsewhere, and a type parameter (OC-ONT-6). Each of those is
    // pinned as a forbidden row by objc/linkage-and-imports.
    //
    // The marker rows keep their OWN vocabulary on top (`exportMarker`) because a marker is
    // a different FACT about the same declaration — what spelling the claim came from —
    // while the claim itself is one thing.
    for (const s of uniqueSymbols) {
      // Members are not top-level units.
      if (s.ownerName || s.scope) continue
      // OC-B: a category is not a top-level resolvable unit — exporting `@interface
      // NSString (Trim)` as `NSString` would claim the class is defined here. This also
      // excludes the category LABEL, which is never a symbol in this lane at all.
      if (s.kind === ASTEngine.SymbolKind.Extension) continue
      // A member is not a linkage unit (see OBJC_LINKAGE_UNIT_KINDS for the measurement
      // behind this line: 108 of 777 rows otherwise sat on ownerless `method` symbols).
      if (!OBJC_LINKAGE_UNIT_KINDS.has(s.kind)) continue
      // Internal linkage: visible only inside this translation unit.
      if (internalLinkage.has(s.name)) continue
      const key = `${ASTEngine.RelationshipType.Exports}|root->${s.name}`
      if (relKeySet.has(key)) continue
      relKeySet.add(key)
      const marker = exportMarkers.get(s.name)
      uniqueRelationships.push({
        source: "root",
        target: s.name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        ...(exportLineByName.has(s.name) ? { line_number: exportLineByName.get(s.name)! } : s.range?.startLine ? { line_number: s.range.startLine } : {}),
        metadata: {
          relationshipType: "module_export",
          isExport: true,
          isObjCExport: true,
          fileLevel: true,
          ...(marker ? { exportMarker: marker } : {}),
        },
      })
    }

    // Add Contains relationships for owned symbols (dedup against existing
    // edges — a contains must never be emitted twice for the same pair)
    for (const s of uniqueSymbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        const key = `${ASTEngine.RelationshipType.Contains}|${_owner}->${s.name}`
        if (!relKeySet.has(key)) {
          relKeySet.add(key)
          uniqueRelationships.push({
            source: _owner,
            target: s.name,
            type: ASTEngine.RelationshipType.Contains,
            confidence: 1.0,
            // M59.A7: the line of the name this edge NAMES — the member's own declared
            // name line, taken from the symbol's range (the symbol and the edge come from
            // one selection: the same node named both).
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            metadata: { isContained: true },
          })
        }
      }
    }
    // --- Override relationships (OBJCD8, M37.10 family implicit-override
    // model — ruby/php/python precedent). ObjC dispatch is by selector: a
    // method a subclass declares with the same FULL SELECTOR as a superclass
    // method overrides it. ObjC was the only inheritance-based family member
    // with zero override machinery — the classifyEvidenceTier branch was dead
    // code and every cross-class redeclaration was silent. Selector identity
    // (OBJCD7) makes the same-name test exact. In-file base declaring the
    // method -> verified override at 0.95; base is a known external super
    // (extends target not declared in-file) -> deterministic Pass-3
    // first-parent guess at 0.5 with reasonCode 'first-parent-guess', below
    // the patterns.ts 0.7 threshold (honest suspicion, counted as heuristic
    // by the differential). NSObject/NSProxy are the universal root — like
    // ruby's implicit Object / java's implicit superclass, no override is
    // ever declared against them in-file, so they are excluded from baseByClass
    // (a guess toward the root for every method would be systematic noise;
    // verified overrides of the root are impossible in a translation unit).
    const classNameSet = new Set<string>()
    for (const s of uniqueSymbols) {
      if (s.kind === ASTEngine.SymbolKind.Class) classNameSet.add(s.name)
    }
    // baseByClass: source of a Class extends edge -> its superclass. Only
    // non-category class inheritance (metadata.isProtocolInheritance edges
    // are protocol extends and carry no superclass meaning).
    const baseByClass = new Map<string, string>()
    for (const r of uniqueRelationships) {
      if (r.type === ASTEngine.RelationshipType.Extends && classNameSet.has(String(r.source)) && !r.metadata?.isProtocolInheritance) {
        const t = String(r.target)
        if (t && t !== "NSObject" && t !== "NSProxy") baseByClass.set(String(r.source), t)
      }
    }
    const methodsByOwner = new Map<string, Set<string>>()
    for (const s of uniqueSymbols) {
      if (s.kind === ASTEngine.SymbolKind.Method && s.ownerName) {
        let names = methodsByOwner.get(s.ownerName)
        if (!names) { names = new Set<string>(); methodsByOwner.set(s.ownerName, names) }
        names.add(s.name)
      }
    }
    for (const s of uniqueSymbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      const base = baseByClass.get(s.ownerName)
      if (!base) continue
      const inFileBaseMethods = classNameSet.has(base) ? methodsByOwner.get(base) : undefined
      if (inFileBaseMethods?.has(s.name)) {
        // Verified: the superclass is declared in this file and declares the
        // same full selector.
        const key = `${ASTEngine.RelationshipType.Overrides}|${s.ownerName}.${s.name}->${base}.${s.name}`
        if (!relKeySet.has(key)) {
          relKeySet.add(key)
          uniqueRelationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${base}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.95,
            // M59.A7: the OVERRIDING member's own declaration line (the base's copy lives
            // in another translation unit, and the row is written here).
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            // The VERIFIED branch names its own evidence: the superclass is declared in THIS
            // file and declares the same full selector, so this row is a verification. The
            // guessed branch below keeps `first-parent-guess` — one code for both would call
            // a verification a guess (objc/selector-attributes pins the pair).
            metadata: { isOverride: true, reasonCode: "verified-base-declared-in-file" },
          })
        }
      } else if (!classNameSet.has(base)) {
        // Pass 3 (family parity): the base is NOT declared in this file —
        // declaring-parent verification is impossible in this translation
        // unit (the @interface naming the superclass lives in a header or
        // another file). Deterministic first-parent guess below threshold.
        const key = `${ASTEngine.RelationshipType.Overrides}|${s.ownerName}.${s.name}->${base}.${s.name}`
        if (!relKeySet.has(key)) {
          relKeySet.add(key)
          uniqueRelationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${base}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.5,
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            metadata: { isOverride: true, reasonCode: "first-parent-guess" },
          })
        }
      }
    }

    // --- Reason codes for the C-call producer (honesty §4.1). A C call names its callee
    // EXACTLY — the identifier is in the source — but the grammar cannot tell a function
    // from a macro, and whether THIS translation unit defines the name is what the code has
    // to say. So it is stamped only where the claim is true: the callee is not a function
    // this file declares. An in-unit callee keeps NO code, because "not resolved in this
    // unit" would be a statement the store itself contradicts. objc/field-invocation and
    // objc/generics-and-reason-codes pin the external cases (`dispatch_async`,
    // `dispatch_once`) and pin that the message-send producer keeps its OWN code, so the
    // two branches must not share one.
    const fileFunctions = new Set<string>()
    for (const s of uniqueSymbols) {
      if (s.kind === ASTEngine.SymbolKind.Function) fileFunctions.add(s.name)
    }
    for (const r of uniqueRelationships) {
      if (r.type !== ASTEngine.RelationshipType.Calls) continue
      const md: any = r.metadata ?? {}
      if (!md.isCFunctionCall || md.reasonCode) continue
      if (!fileFunctions.has(String(r.target))) md.reasonCode = "callee-not-resolved-in-unit"
    }

    // --- OC-E BINDING SPELLING: a unit-local read is a BINDING, not a declaration -------------
    //
    // WHAT WAS WRONG. Every bare-identifier read this walk emits carries
    // `isBareRead: true, reasonCode: "value-read-by-scope-inference"` — the analyzer's own proof
    // that the name denotes a value BOUND IN THIS SCOPE (`isBoundValue`, :298: a parameter, a body
    // local, a block parameter, a for-in variable, a same-file ivar/property, a file global, an
    // enum case). The edge then publishes the BARE NAME, and the binding identity — the callable
    // the name was bound in, which is `r.source` and has been in hand the whole time — is thrown
    // away. The store publishes no locals (DARTD8), so a bare local name can never be answered;
    // where some unrelated declaration in the project happens to carry the same spelling, the
    // store binds the read to THAT declaration instead. MEASURED, whole 262-file admitted
    // population (`validation/m14/fixtures/objc/binding-census.ts`, which reproduces the gate's
    // TABLE 1 row for row): of the 7,077 unresolved bare reads this pass touches, 6,939 are
    // unresolved, 1,209 are bound to a foreign same-named declaration and 793 sit in the ambiguous
    // column — 2,002 reads attached to a declaration the source never named. The largest single
    // cause in this lane's 20,930-edge residual is this construct: 6,939 edges, 33.2%.
    //
    // THE FIX IS THE FAMILY'S, NOT A NEW CLAIM. `BINDING_SEP` + `metadata.localBinding` is the
    // mechanism dart (`real-dart-analyzer.ts:2801`), php (`real-php-analyzer.ts:3140`, the
    // `$variable` fix that took that lane 57.2% -> 27.6%), julia (`real-julia-analyzer.ts:1440`)
    // and fsharp (`real-fsharp-analyzer.ts:577`) already publish, and the gate verifies it by the
    // TARGET'S OWN SPELLING (`verifyBindingClaim`), refuting a marked edge whose target carries no
    // separator. A binding claim is checked BEFORE the declaration count and can never return
    // `resolved`, so this cannot mass-move edges into `collRes` — the trap this lane's brief names.
    //
    // THE PREDICATE IS DELIBERATELY NARROWER THAN "EVERY BARE READ", and each exclusion is a
    // measured class rather than caution:
    //   * `isFieldRead` is refused. `self.width` / `w.next` names a MEMBER — a property or ivar of
    //     a class — not a binding, and claiming a binding for it would be false. Those 3,617 edges
    //     stay exactly where they are (a separate named cause in the report).
    //   * a name THIS FILE PUBLISHES is refused. Then the name denotes a declaration the store can
    //     see (`_count`, `store`, `gTotal`, `gItems`, an enum case), the bare spelling is the right
    //     one, and re-spelling it would DESTROY a correct link rather than remove a false one. The
    //     test is the file's own published symbol set, which is exactly what the store will key.
    //   * a dual-marked read (bare AND field, the dedup union at :1288-1289) is refused by the
    //     `isFieldRead` clause, because one of its two provenances names a member.
    //
    // WHAT IT COSTS, STATED RATHER THAN DISCOVERED LATER. The 1,209 false links become unbound
    // (their `target_symbol_id` goes from a WRONG declaration to NULL), so the store's `resolved`
    // count FALLS while the gate's residual falls with it. That trade is the point — a wrong link
    // is worse than no link — and it is why the number is reported on both sides rather than only
    // the improving one. No edge is dropped: the target stays a non-empty string, and
    // `pool-worker`'s leaf extractor already reads the segment AFTER the separator (`:826-833`),
    // which is the php-lane lesson that a lane adopting this spelling inherits.
    const publishedNames = new Set<string>()
    for (const s of uniqueSymbols) if (s.name) publishedNames.add(s.name)
    for (const r of uniqueRelationships) {
      if (r.type !== ASTEngine.RelationshipType.Uses) continue
      const md: any = r.metadata ?? {}
      if (md.isBareRead !== true || md.isFieldRead === true) continue
      const leaf = String(r.target ?? "")
      // No source means no binding identity to spell, and a target the file itself publishes is a
      // declaration, not a unit-local — the two refusals above, applied.
      if (!leaf || !r.source || publishedNames.has(leaf)) continue
      r.target = `${r.source}${BINDING_SEP}${leaf}`
      md.localBinding = true
    }

    // Evidence-tier classification (managed-OO family contract — swift/dart/
    // csharp #264–#266 precedent; M14 section D requires >=2 distinct
    // evidenceClass values). structural (grammar clauses, conf 1.0) |
    // usage_contextual (calls, conf >= 0.85) | import_based (import
    // directives) | inferred (confidence < 1 non-call edges).
    this.classifyEvidenceTier(uniqueRelationships)
    // M49 JVM-closure exports invariant (F3 gate): export names must be
    // UNIQUE and top-level-resolvable. The pre-fix pass exported EVERY
    // symbol — objc selectors (`authorizeAmount:`, `setValue:forKey:`)
    // duplicated across classes/interfaces/categories and ivars leaked
    // (`_count`). Selectors are members (membership rides Contains);
    // only top-level units export, deduped first-wins.
    {
      const seenExportNames = new Set<string>()
      for (let i = 0; i < uniqueSymbols.length; i++) {
        const s = uniqueSymbols[i]
        // OC-B: categories are not top-level resolvable units (swift
        // precedent: extension symbols exist but never export) — exporting
        // `@interface NSString (Trim)` as "NSString" claims the class is
        // defined here.
        if (s.ownerName) continue
        if (s.kind === ASTEngine.SymbolKind.Extension) continue
        if (seenExportNames.has(s.name)) continue
        seenExportNames.add(s.name)
        // OC-ONT-8: `visibility` states who can see the name, so a `static` unit is
        // `private` rather than `public` — the pre-fix state published all 50 corpus
        // static function definitions and all 67 static declarations as `public`,
        // asserting an importability the language denies (C99 6.2.2p5). The name stays in
        // this list because it IS a symbol of this file; only the visibility claim moves.
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: internalLinkage.has(s.name) ? "private" : "public" })
      }
    }
    // CONV-OC-1: the emitted order is the declared table, never the Set's insertion
    // order, and the pick is the table's first entry rather than `[...frameworks][0]`.
    // Names observed but absent from the table are appended in sorted order rather than
    // dropped — a marker added without an order entry must degrade to a disclosed
    // position, never to silent non-publication.
    //
    // Deliberately computed as local consts feeding an INLINE metadata literal, the
    // csharp/swift shape. The first version of this fix wrapped the literal in an IIFE,
    // which published the same object while making the source unreadable to the R8
    // census: `collectMetadata` recognises a metadata VALUE only when it is an object
    // literal, so the lane stopped being examined as a contract binding at all — a newly
    // blind instrument, caught by re-running the census rather than by assuming the
    // refactor was neutral. The two published arrays are each an expression over the
    // frameworks Set, so the read is visible where the write is.
    const detectedFrameworks: string[] = [...frameworks]
    detectedFrameworks.sort((a, b) => {
      const ra = OBJC_FRAMEWORK_ORDER.indexOf(a)
      const rb = OBJC_FRAMEWORK_ORDER.indexOf(b)
      if (ra === -1 && rb === -1) return a < b ? -1 : a > b ? 1 : 0
      if (ra === -1) return 1
      if (rb === -1) return -1
      return ra - rb
    })
    const frameworkPatterns = detectedFrameworks.map((f) => ({
      framework: f,
      patterns: OBJC_FRAMEWORK_PATTERNS[f] ?? ["usage"],
    }))
    return {
      language: "objective-c",
      symbols: uniqueSymbols,
      relationships: uniqueRelationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: uniqueSymbols.length,
        linesOfCode: content.split("\n").length,
        detectedFrameworks,
        framework: detectedFrameworks.length > 0 ? detectedFrameworks[0] : undefined,
        frameworkPatterns,
      },
    }
  }

  /**
   * Evidence-tier classification — same rules as the swift/dart/csharp
   * family (see swift wave #266 for the full rationale).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      // OC-ONT-8: `exports` is a DECLARATION fact — the declaration is in this file and its
      // linkage is read off the grammar's own `storage_class_specifier` — so it is
      // structural, the tier c/cpp/powershell classify it as. `imports`/`references` stay
      // `import_based`: those name something OUT of this unit (a header, a module), which
      // is the tier's meaning.
      if (type === "exports") { md.evidenceClass = "structural"; continue }
      if (type === "imports" || type === "references") { md.evidenceClass = "import_based"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "overrides") {
        // OBJCD8 M37.10 family contract: verified overrides are structural; a
        // Pass-3 first-parent guess is only "inferred" (the external base may
        // not even declare the method).
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * Per-symbol cyclomatic complexity (managed-OO family contract — csharp
   * #264 wave precedent). The objc grammar is a C superset, so the node set
   * mirrors the C analyzer's exactly: branch constructs + short-circuit
   * &&/|| operators only; base 1. Probe-verified against the pinned wasm
   * (do_statement confirmed present, 2026-08-30).
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1
    const complexityNodes = new Set([
      "if_statement", "for_statement", "while_statement", "do_statement",
      "case_statement", "conditional_expression",
    ])
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (complexityNodes.has(n.type)) complexity++
      else if (n.type === "binary_expression") {
        // Short-circuit operators count as decision points (C family T1) —
        // same operator-field lookup as the C analyzer (the token is an
        // anonymous child, so namedChild iteration misses it).
        const op = n.childForFieldName("operator")
        if (op && (op.text === "&&" || op.text === "||")) complexity++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return complexity
  }

  /**
   * OC-E helpers: bare-identifier read classification. web-tree-sitter
   * returns fresh wrappers per accessor call, so node identity is compared
   * by span (start/end offsets), never by reference.
   */
  private sameNode(a: Node | null, b: Node | null): boolean {
    if (!a || !b) return false
    return a.startIndex === b.startIndex && a.endIndex === b.endIndex
  }
  private spanContains(outer: Node | null, inner: Node | null): boolean {
    if (!outer || !inner) return false
    return outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex
  }
  /**
   * True when the identifier is the DECLARED name of an init_declarator
   * (`int y = ...`, `int arr[10] = ...`, `Counter g = ...`): climb through
   * name-wrapping declarators (array/pointer/parenthesized); the name is
   * the declarator subtree under the init_declarator's FIRST named child.
   * Initializer values live outside that subtree and stay reads.
   */
  private isDeclaratorName(node: Node): boolean {
    let cur: Node | null = node
    let p: Node | null = node.parent ?? null
    while (p && DECLARATOR_WRAPPERS.has(p.type) && cur) {
      cur = p
      p = p.parent ?? null
    }
    if (!p || p.type !== "init_declarator" || !cur) return false
    const head = p.namedChild(0)
    return !!head && this.spanContains(head, cur)
  }

  /**
   * OC-E: true when the identifier is the DECLARED NAME of a parameter
   * (`void (^handler)(NSString *)`, `NSString *name`, `int n`). Structural, not
   * textual: climb the name-wrapping declarators and require that the node we
   * land on IS the enclosing parameter's own `declarator` field — a declarator
   * subtree holds no expressions, so nothing inside it can be a value read, and
   * OC-E's rule is that "declaration names" are names, never reads.
   *
   * The direct `identifier < parameter_declaration` shape was already covered by
   * the parent-type test. The BLOCK-POINTER parameter is the shape that leaked:
   * its name nests `identifier < block_pointer_declarator <
   * parenthesized_declarator < function_declarator < parameter_declaration`, so
   * neither the parent-type test nor isDeclaratorName (which needs an
   * init_declarator) could see it, and the declaration line was published as a
   * `uses` read. Measured before the fix (script/m14/tmp/oc-callee-uses.ts):
   * `void register_block(void (^handler)(NSString *)) { int x = 0; }` emitted
   * `uses register_block -> handler` with NO read anywhere in the file — while
   * the C analyzer, handed the same function-pointer parameter, emits nothing
   * (family parity), and the M12 fixture read it as a false positive against a
   * truth that only counts the call.
   */
  private isParameterDeclaredName(node: Node): boolean {
    let cur: Node | null = node
    let p: Node | null = node.parent ?? null
    while (p && DECLARATOR_WRAPPERS.has(p.type) && cur) {
      cur = p
      p = p.parent ?? null
    }
    if (!p || !cur) return false
    if (p.type !== "parameter_declaration" && p.type !== "method_parameter") return false
    const declared = p.childForFieldName("declarator")
    // method_parameter exposes no `declarator` field (probe 2026-09: its named
    // children are method_type + identifier) — there its identifier child IS the
    // name, never a read target.
    if (!declared) return p.type === "method_parameter"
    return this.spanContains(declared, cur)
  }
  /**
   * True when the identifier is a for-in loop variable
   * (`for (id x in items)`): the named sibling directly preceding the
   * anonymous `in` token.
   */
  private isForInVariable(forNode: Node, node: Node): boolean {
    const cc = forNode.childCount
    for (let i = 0; i < cc; i++) {
      const c = forNode.child(i)
      if (c && !c.isNamed && c.type === "in" && i > 0) {
        for (let j = i - 1; j >= 0; j--) {
          const pc = forNode.child(j)
          if (pc && pc.isNamed) return this.sameNode(pc, node)
        }
        return false
      }
    }
    return false
  }
  /**
   * The bound name declared by an init_declarator, method_parameter, or
   * parameter_declaration: the declarator identifier (through wrappers for
   * arrays/pointers; first document-order identifier for parameters, where
   * type names are type_identifier and `id` is a typedefed_specifier).
   */
  private declaratorName(node: Node): string | null {
    if (node.type === "init_declarator") {
      const head = node.namedChild(0)
      if (!head) return null
      const stack: Node[] = [head]
      while (stack.length > 0) {
        const c = stack.pop()!
        if (c.type === "identifier") return c.text
        for (let i = c.namedChildCount - 1; i >= 0; i--) {
          const ch = c.namedChild(i)
          if (ch) stack.push(ch)
        }
      }
      return null
    }
    const direct = this.findChild(node, (n) => n.type === "identifier")
    if (direct) return direct.text
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (c.type === "identifier") return c.text
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const ch = c.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return null
  }

  /**
   * OC-D: the typedef alias naming an anonymous aggregate
   * (`typedef struct {...} Size` -> "Size"): the LAST type_identifier
   * child directly under the enclosing type_definition.
   */
  private typedefName(node: Node): string | null {
    const p = node.parent
    if (!p || p.type !== "type_definition") return null
    let alias: Node | null = null
    for (let i = 0; i < p.namedChildCount; i++) {
      const c = p.namedChild(i)
      if (c && (c.type === "type_identifier" || c.type === "identifier")) alias = c
    }
    return alias ? alias.text : null
  }

  // Walk struct_declaration → struct_declarator → (pointer/reference) →
  // identifier to find the declared property/ivar name.
  private findDeclaredName(node: Node): string | null {
    const walkForIdentifier = (n: Node | null): Node | null => {
      if (!n) return null
      if (n.type === "identifier") return n
      for (let i = 0; i < n.namedChildCount; i++) {
        const found = walkForIdentifier(n.namedChild(i))
        if (found) return found
      }
      return null
    }
    const idNode = walkForIdentifier(node)
    if (!idNode) return null
    // Exclude type identifiers (NSString, NSObject, id, etc.) that appear
    // BEFORE the declarator — the declared name is the LAST identifier in a
    // struct_declaration subtree. Prefer identifiers that are NOT in the
    // type position (first child).
    const structDecl = this.findChild(node, (n) => n.type === "struct_declaration")
    if (structDecl) {
      const sd = this.findChild(structDecl, (n) => n.type === "struct_declarator")
      if (sd) {
        const deep = walkForIdentifier(sd)
        if (deep) return deep.text
      }
    }
    return idNode.text
  }

  /**
   * OBJCD9: does this declarator subtree reach a `function_declarator`?
   *
   * A declaration is a function PROTOTYPE when its declarator chain contains one,
   * whatever wraps it: `void f(int)` nests the declarator bare, `NSString * f(d)`
   * nests it under a `pointer_declarator`. The wrapper is a return type, not a
   * different kind of thing, and the pre-fix arm list read the wrapper as if it
   * were. Structural — `node.type` and a pre-order walk — with no text test and
   * no regex.
   */
  private declaratorChainHasFunctionDeclarator(node: Node): boolean {
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 10000) {
      const c = stack.pop()!
      if (c.type === "function_declarator") return true
      // A parameter_list holds parameter_declarations whose OWN declarators are
      // function POINTERS (`void f(void (*cb)(int))`). Those are not the
      // declaration's function-ness, so the walk stops at the parameter list.
      if (c.type === "parameter_list") continue
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const ch = c.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return false
  }

  /**
   * OBJCD5: the defining name of a function_definition — the first
   * function_declarator in document order that is NOT inside the body
   * (compound_statement), then its first identifier child. Handles the
   * pointer_declarator > function_declarator nesting of pointer-return C
   * helpers. The head always precedes any parameter-nested function-pointer
   * declarator in the tree, so pre-order first-hit is exact (probe-verified
   * against the pinned tree-sitter-objc, 2026-09).
   */
  private findFunctionName(node: Node): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (c.type === "compound_statement") continue
      if (c.type === "function_declarator") {
        const id = this.findChild(c, (n) => n.type === "identifier")
        return id || c
      }
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const child = c.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return null
  }

  // The `+`/`-` sign is an anonymous token child of a method node
  // (`method_declaration [-:"-"] [;:";"]`) — scan the non-named children for
  // the `+` token. Pure AST, never source-text scanning.
  private isClassMethodToken(node: Node): boolean {
    const count = node.childCount
    for (let i = 0; i < count; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === "+") return true
    }
    return false
  }

  /**
   * OBJCD7: full ObjC selector of a method_declaration/method_definition.
   * The pinned grammar nests keyword identifiers at the TOP level of the
   * method node (parameter locals live INSIDE the method_parameter nodes,
   * probe-verified 2026-09): `- (void)storeImage:(UIImage*)image
   * forName:(NSString*)name` -> top-level children are identifier
   * "storeImage", method_parameter, identifier "forName", method_parameter.
   * A keyword gets ':' when the NEXT named sibling is a method_parameter.
   *
   * A selector is that keyword chain and NOTHING ELSE. The grammar also puts a
   * method's TRAILING ANNOTATION MACROS at the method node's top level as bare
   * identifiers with no `method_parameter` after them:
   *
   *   method_declaration "- (instancetype)initWithBaseURL:(NSURL *)url
   *                           sessionConfiguration:(NSURLSessionConfiguration *)c
   *                           NS_DESIGNATED_INITIALIZER;"
   *     identifier        "initWithBaseURL"
   *     method_parameter  ":(NSURL *)url"
   *     identifier        "sessionConfiguration"
   *     method_parameter  ":(NSURLSessionConfiguration *)c"
   *     identifier        "NS_DESIGNATED_INITIALIZER"   <- an annotation, not a keyword
   *
   * Concatenating every top-level identifier published
   * `initWithBaseURL:sessionConfiguration:NS_DESIGNATED_INITIALIZER` — a symbol
   * no class in the world declares, and an `overrides` TARGET
   * (`AFURLSessionManager.<that name>`) that resolves to nothing. Measured over
   * the admitted universe by script/m60/objc-selector-integrity.ts before this
   * fix: 79 method nodes in 29 files (NS_REFINED_FOR_SWIFT 62,
   * NS_DESIGNATED_INITIALIZER 15, NS_SWIFT_NOTHROW 2) and 109 fabricated
   * `overrides` targets.
   *
   * So the chain STOPS at the first bare identifier: after a keyword it is an
   * annotation; with no keyword seen it is the zero-argument selector and
   * anything after it is an annotation too. The alternative reading — a bare
   * identifier BEFORE the keywords is the selector — is not a guess: the same
   * probe counted the shapes of all 2,891 method nodes and `bareThenKeyword` is
   * 0, `bareOnlyMulti` 0, `keywordChain` 1,595, `singleBare` 1,217,
   * `bareAfterKeyword` 79. The rule is the grammar's, and the census is what
   * would refute it.
   */
  private fullMethodSelector(node: Node): string {
    let sel = ""
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "identifier") {
        const next = i + 1 < count ? node.namedChild(i + 1) : null
        if (next && next.type === "method_parameter") { sel += c.text + ":"; continue }
        // No parameter follows: a zero-argument selector only if nothing has been
        // collected yet, otherwise a trailing annotation. Either way the chain ends.
        if (sel === "") sel = c.text
        break
      }
    }
    return sel
  }

  /**
   * OBJCD7: full selector of a message_expression. The grammar flattens
   * keywords and arguments as SIBLINGS; a keyword is an identifier whose
   * NEXT child is an anonymous ':' token (the colons are direct anonymous
   * children of message_expression, probe-verified 2026-09). Zero-argument
   * messages have no ':' — the selector is then the LAST identifier child
   * (receiver identifiers live inside nested nodes for complex receivers;
   * `[foo bar]` -> bar, `[self.imageTable removeAllObjects]` ->
   * removeAllObjects, `[[Foo alloc] init]` -> init).
   */
  /**
   * The FIRST selector node of a message send — the same selection `fullMessageSelector`
   * builds its text from, returned as a NODE.
   *
   * The M59.A7 contract is that a relationship's `line_number` is the line of the NAME it
   * names, and a name captured as a string has no line. swift's round paid for this lesson
   * with a surviving `calls Endpoint -> method` edge that claimed the CONVERTED site's line,
   * because the text and the line came from two different selections; here they come from one
   * walk, and the equivalence probe re-checks that the node's own text is a prefix of the
   * published selector (a keyword send) or equal to it (a zero-argument send).
   */
  private fullMessageSelectorNode(node: Node): Node | null {
    let firstKeyword: Node | null = null
    let lastIdentifier: Node | null = null
    const count = node.childCount
    for (let i = 0; i < count; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.isNamed && c.type === "identifier") {
        const nxt = i + 1 < count ? node.child(i + 1) : null
        if (nxt && !nxt.isNamed && nxt.type === ":") {
          if (!firstKeyword) firstKeyword = c
        } else {
          lastIdentifier = c
        }
      }
    }
    return firstKeyword ?? lastIdentifier
  }

  /**
   * The 1-based line a node is WRITTEN on. The unit of the M59.A7 contract, and deliberately
   * computed from the node itself: two runs of the same file must produce the same number.
   */
  private nodeLine(n: Node): number {
    return n.startPosition.row + 1
  }

  /**
   * OC-ONT-6 — the three lists Objective-C spells with ONE token sequence.
   *
   * `@interface Cache <KeyType, ObjectType> : Store <KeyType, ObjectType> <CacheProtocol>`
   * has three `parameterized_arguments` children, and the pinned grammar names all three
   * identically: the class's own lightweight-generic TYPE PARAMETERS, its superclass's TYPE
   * ARGUMENTS, and its ADOPTED PROTOCOLS. Reading every list as an adoption list published
   * `implements Cache -> KeyType` / `-> ObjectType` — the class's own type parameters as
   * protocols, names no file declares (objc/generics-and-reason-codes).
   *
   * The lists are separated by POSITION, and position is exact here rather than heuristic
   * because the pinned grammar keeps the `:` and `(` tokens as direct children:
   *
   *   1. a list BEFORE the `:` is part of the DECLARATION — the class's own type parameters,
   *      never a protocol;
   *   2. the FIRST list after the `:` is the superclass's type ARGUMENTS exactly when every
   *      name in it is one of those parameters, and is otherwise the adoption list: the
   *      ordinary `@interface Plain : NSObject <NSCopying>` declares no parameters, so its
   *      single list adopts;
   *   3. every later list is an adoption list.
   *
   * A class EXTENSION re-declares the enclosing class's parameters in front of its `()`
   * (`@interface Cache <KeyType, ObjectType> ()`), so its lists are all declaration-region
   * and none adopts; a CATEGORY is the mirror image — `@interface Plain (Trim)
   * <NSFastEnumeration>` — and its list sits AFTER the `(`, so a category's lists all adopt.
   * The two positions are mirrors, which is why the rule cannot be "a list before the paren"
   * alone (objc/generics-and-reason-codes pins both).
   *
   * The same partition is re-derived independently in
   * script/m60/objc-construct-site-probe.ts so the F5 differential compares two derivations
   * rather than one against itself.
   */
  private objcInheritanceLists(node: Node): {
    superClass: string | null
    superNode: Node | null
    typeParams: string[]
    protocols: Array<{ name: string; node: Node }>
  } {
    const membersOf = (pa: Node): Array<{ name: string; node: Node }> => {
      const out: Array<{ name: string; node: Node }> = []
      for (let i = 0; i < pa.namedChildCount; i++) {
        const m = pa.namedChild(i)
        if (m && (m.type === "type_identifier" || m.type === "identifier" || m.type === "type_name")) {
          out.push({ name: m.text, node: m })
        }
      }
      return out
    }
    // The `:` and `(` that bound the two regions, plus every list in child order.
    let colonIdx = -1
    let parenIdx = -1
    const lists: Array<{ node: Node; idx: number }> = []
    for (let ci = 0; ci < node.childCount; ci++) {
      const c = node.child(ci)
      if (!c) continue
      if (!c.isNamed && c.type === ":" && colonIdx < 0) { colonIdx = ci; continue }
      if (!c.isNamed && c.type === "(" && parenIdx < 0) { parenIdx = ci; continue }
      if (c.isNamed && c.type === "parameterized_arguments") lists.push({ node: c, idx: ci })
    }
    // A category is `@interface Name (Category)`; an extension is `@interface Name ()`.
    // Both carry the paren, and this file treats both through the category branch.
    const isCategory = parenIdx >= 0 && (colonIdx < 0 || parenIdx < colonIdx)
    const isDeclarationRegion = (idx: number): boolean =>
      colonIdx >= 0 ? idx < colonIdx : isCategory && idx < parenIdx

    // 1. the declaration region's lists are the class's own type parameters.
    const typeParams: string[] = []
    for (const l of lists) {
      if (!isDeclarationRegion(l.idx)) continue
      for (const m of membersOf(l.node)) typeParams.push(m.name)
    }
    const paramSet = new Set(typeParams)

    // 2/3. the inheritance region, in child order: the superclass name, its type arguments,
    // then the adoption list. `argsConsumed` is what makes the SECOND post-colon list adopt
    // even when its names repeat the parameters (the `Store <KeyType, ObjectType>` case).
    let superClass: string | null = null
    let superNode: Node | null = null
    const protocols: Array<{ name: string; node: Node }> = []
    let argsConsumed = false
    for (let ci = 0; ci < node.childCount; ci++) {
      const c = node.child(ci)
      if (!c) continue
      if (colonIdx >= 0 && ci > colonIdx && superClass === null && c.isNamed &&
          (c.type === "identifier" || c.type === "type_identifier")) {
        superClass = c.text
        superNode = c
        continue
      }
      if (!c.isNamed || c.type !== "parameterized_arguments") continue
      if (isDeclarationRegion(ci)) continue
      const mem = membersOf(c)
      if (colonIdx >= 0 && !argsConsumed && mem.length > 0 && mem.every((m) => paramSet.has(m.name))) {
        argsConsumed = true
        continue
      }
      for (const m of mem) protocols.push(m)
      if (colonIdx >= 0) argsConsumed = true
    }
    return { superClass, superNode, typeParams, protocols }
  }

  private fullMessageSelector(node: Node): string {
    let sel = ""
    let lastId: string | null = null
    const count = node.childCount
    for (let i = 0; i < count; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.isNamed && c.type === "identifier") {
        const nxt = i + 1 < count ? node.child(i + 1) : null
        if (nxt && !nxt.isNamed && nxt.type === ":") {
          sel += c.text + ":"
        } else {
          lastId = c.text
        }
      }
    }
    if (sel) return sel
    return lastId ?? ""
  }

  // Pure cursor helper protecting V8 from GC Thrashing
  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
        const child = node.namedChild(i)
        if (child && predicate(child)) return child
    }
    return null
  }

  // Deep pre-order variant of findChild (first document-order match in the
  // subtree, including the node itself).
  private deepFind(node: Node, predicate: (n: Node) => boolean): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (predicate(c)) return c
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const ch = c.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return null
  }

  private getRange(node: Node) {
    return {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        startIndex: node.startIndex,
        endIndex: node.endIndex
    }
  }
}
