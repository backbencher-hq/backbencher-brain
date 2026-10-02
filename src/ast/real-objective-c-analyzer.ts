import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

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
          relationships.push({
            source: "root",
            target: modName,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            line_number: this.nodeLine(modNode ?? node),
            metadata: { isObjCImport: true },
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
            // adopts the protocol (same parameterized_arguments shape as a
            // plain class). Emit implements sourced from the EXTENDED class
            // (family convention: swift extension protocol adoption).
            for (let ci = 0; ci < node.namedChildCount; ci++) {
              const cn = node.namedChild(ci)
              if (cn && cn.type === "parameterized_arguments") {
                for (let pj = 0; pj < cn.namedChildCount; pj++) {
                  const pn = cn.namedChild(pj)
                  if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) {
                    relationships.push({ source: nameNode.text, target: pn.text, type: ASTEngine.RelationshipType.Implements, confidence: 1.0, line_number: this.nodeLine(pn), metadata: { objcSpecific: true, isProtocol: true, isCategoryProtocol: true } })
                  }
                }
              }
            }
          } else {
            // Plain class: extract superclass + protocols for relationships.
            let foundName = false
            let superName: string | null = null
            // The node each inherited name was read from. A name captured as a string has no
            // line, and the M59.A7 contract asks for the line of the NAME.
            let superNode: Node | null = null
            let protocols: string[] = []
            const protocolNodes: Node[] = []
            for (let ci = 0; ci < node.namedChildCount; ci++) {
              const cn = node.namedChild(ci)
              if (!cn) continue
              if (cn.type === "identifier" && !foundName) { foundName = true; continue }
              // Pinned grammar: superclass is the plain identifier after `:`;
              // protocols live under parameterized_arguments > type_name.
              if ((cn.type === "type_identifier" || cn.type === "identifier") && !superName) { superName = cn.text; superNode = cn }
              if (cn.type === "parameterized_arguments") {
                for (let pj = 0; pj < cn.namedChildCount; pj++) {
                  const pn = cn.namedChild(pj)
                  if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) { protocols.push(pn.text); protocolNodes.push(pn) }
                }
              }
            }
            if (superName) { relationships.push({ source: nameNode.text, target: superName, type: ASTEngine.RelationshipType.Extends, confidence: 1.0, line_number: this.nodeLine(superNode ?? nameNode), metadata: { objcSpecific: true } }) }
            for (let pk = 0; pk < protocols.length; pk++) { relationships.push({ source: nameNode.text, target: protocols[pk], type: ASTEngine.RelationshipType.Implements, confidence: 1.0, line_number: this.nodeLine(protocolNodes[pk] ?? nameNode), metadata: { objcSpecific: true, isProtocol: true } }) }
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
          // the same way; prototypes (function_declarator) never bind.
          //
          // An UNTERMINATED declaration publishes nothing (see
          // isUnterminatedDeclaration): it has no declarator, so the only
          // identifier in reach is a specifier macro. Traversal still descends
          // either way — the walk below is driven by this branch's return
          // state, not by the loop — so nothing nested is skipped.
          if (!isUnterminatedDeclaration(node)) {
            for (let di = 0; di < node.namedChildCount; di++) {
              const dc = node.namedChild(di)
              if (!dc) continue
              let dname: string | null = null
              if (dc.type === "init_declarator") {
                dname = this.declaratorName(dc)
              } else if (dc.type === "identifier") {
                dname = dc.text
              } else if (dc.type === "pointer_declarator" || dc.type === "array_declarator" ||
                         dc.type === "parenthesized_declarator" || dc.type === "attributed_declarator") {
                dname = this.declaratorName(dc)
              }
              if (dname) {
                symbols.push({
                  name: dname,
                  kind: ASTEngine.SymbolKind.Variable,
                  range: this.getRange(node),
                  metadata: { objcSpecific: true },
                })
                // OC-E: file-scope names are resolvable read targets.
                globals.add(dname)
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
                  receiverLeaf = receiver.text
                  recvTargetNode = receiver
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
                relationships.push({ source: activeScope, target: receiverLeaf, type: ASTEngine.RelationshipType.Instantiates, confidence: 0.9, line_number: this.nodeLine(recvTargetNode ?? node), metadata: { isObjCAlloc: true } })
              }
            } else {
              relationships.push({
                source: activeScope,
                target: msgSel,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.95,
                line_number: this.nodeLine(this.fullMessageSelectorNode(node) ?? node),
                metadata: { isMessageExpression: true }
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
                  metadata: { isBareRead: true, isMessageArgument: !this.sameNode(kk.n, recvNode) },
                })
              }
            }
          }
       }
      else if (node.type === "call_expression") {
        const funcNode = this.findChild(node, (n) => n.type === "identifier")
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
              metadata: { isFieldRead: true, relationshipType: "field_access" },
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
              metadata: { isBareRead: true },
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
            metadata: { isOverride: true },
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
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
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
  private findDeclaredName(node: Node): string | null {    const walkForIdentifier = (n: Node | null): Node | null => {
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
   */
  private fullMethodSelector(node: Node): string {
    let sel = ""
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "identifier") {
        sel += c.text
        const next = i + 1 < count ? node.namedChild(i + 1) : null
        if (next && next.type === "method_parameter") sel += ":"
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
