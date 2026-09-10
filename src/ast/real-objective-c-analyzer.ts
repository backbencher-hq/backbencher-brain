import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

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
    const walkStack: Array<{ node: Node; isExit: boolean; activeScope: string; parentType: string; isInBody: boolean }> = [
      { node: rootNode, isExit: false, activeScope: "global", parentType: "", isInBody: false }
    ]

    while (walkStack.length > 0) {
      const state = walkStack.pop()!
      if (!state) continue
      
      const { node, isExit, activeScope, parentType, isInBody } = state
      if (isExit || !node || node.isMissing) continue

      let nextActiveScope = activeScope
      let nextIsInBody = isInBody

      // Law 1: Flawless Database Extraction (cover all major Obj-C constructs)

      // 0. Imports (#import / #include). Pure AST: the grammar emits
      // preproc_include with a system_lib_string child (`<Foundation/...>`)
      // or a string_literal child (`"Local.h"`). No source-text scanning.
      if (node.type === "preproc_include") {
        let modName: string | null = null
        let isSystem = false
        for (let ci = 0; ci < node.namedChildCount; ci++) {
          const cn = node.namedChild(ci)
          if (!cn) continue
          if (cn.type === "system_lib_string") {
            isSystem = true
            const txt = cn.text
            if (txt.length >= 2) modName = txt.slice(1, txt.length - 1)
          } else if (cn.type === "string_literal") {
            const content = this.findChild(cn, (n) => n.type === "string_content")
            modName = content ? content.text : cn.text
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
                    relationships.push({ source: nameNode.text, target: pn.text, type: ASTEngine.RelationshipType.Implements, confidence: 1.0, metadata: { objcSpecific: true, isProtocol: true, isCategoryProtocol: true } })
                  }
                }
              }
            }
          } else {
            // Plain class: extract superclass + protocols for relationships.
            let foundName = false
            let superName: string | null = null
            let protocols: string[] = []
            for (let ci = 0; ci < node.namedChildCount; ci++) {
              const cn = node.namedChild(ci)
              if (!cn) continue
              if (cn.type === "identifier" && !foundName) { foundName = true; continue }
              // Pinned grammar: superclass is the plain identifier after `:`;
              // protocols live under parameterized_arguments > type_name.
              if ((cn.type === "type_identifier" || cn.type === "identifier") && !superName) { superName = cn.text }
              if (cn.type === "parameterized_arguments") {
                for (let pj = 0; pj < cn.namedChildCount; pj++) {
                  const pn = cn.namedChild(pj)
                  if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) protocols.push(pn.text)
                }
              }
            }
            if (superName) { relationships.push({ source: nameNode.text, target: superName, type: ASTEngine.RelationshipType.Extends, confidence: 1.0, metadata: { objcSpecific: true } }) }
            for (let pk = 0; pk < protocols.length; pk++) { relationships.push({ source: nameNode.text, target: protocols[pk], type: ASTEngine.RelationshipType.Implements, confidence: 1.0, metadata: { objcSpecific: true, isProtocol: true } }) }
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
                relationships.push({ source: nameNode.text, target: cn.text, type: ASTEngine.RelationshipType.Extends, confidence: 1.0, metadata: { objcSpecific: true, isProtocolInheritance: true } })
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
      // 7. Variables (C-style declarations) — file-scope only; method-body
      // declarations are locals (execution artifacts) and blocks are generated.
      else if (node.type === "block_literal") {
        // Anonymous blocks have generated names — skip as symbols.
      } else if (node.type === "declaration" && activeScope === "global") {
         const declarator = this.findChild(node, (n) => n.type === "init_declarator" || n.type === "identifier")
         const nameNode = declarator ? (declarator.type === "init_declarator" ? this.findChild(declarator, (n) => n.type === "identifier") : declarator) : null
         if (nameNode) {
           symbols.push({
             name: nameNode.text,
             kind: ASTEngine.SymbolKind.Variable,
             range: this.getRange(node),
             metadata: { objcSpecific: true },
           })
         }
      }
      // 8. Relationships (Obj-C Message Expressions `[receiver selector]` & C-Function Calls)
      // OBJCD7: the callable identity of a message send is the FULL selector
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
              const receiver = node.namedChild(0)
              if (receiver) {
                if (receiver.type === "identifier" || receiver.type === "type_identifier") {
                  receiverLeaf = receiver.text
                } else if (receiver.type === "message_expression") {
                  // Nested: [[Logger alloc] ...] — the inner message's receiver
                  // is the class. If the inner selector is itself alloc/new,
                  // its own visit already emitted the Instantiates edge.
                  const innerSel = this.findChild(receiver, (n) => n.type === "identifier")
                  if (innerSel && (innerSel.text === "alloc" || innerSel.text === "new")) {
                    const innerRecv = receiver.namedChild(0)
                    if (innerRecv && (innerRecv.type === "identifier" || innerRecv.type === "type_identifier")) {
                      receiverLeaf = innerRecv.text
                    }
                  }
                }
              }
              if (receiverLeaf) {
                relationships.push({ source: activeScope, target: receiverLeaf, type: ASTEngine.RelationshipType.Instantiates, confidence: 0.9, metadata: { isObjCAlloc: true } })
              }
            } else {
              relationships.push({
                source: activeScope,
                target: msgSel,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.95,
                metadata: { isMessageExpression: true }
              })
            }
         }
      }
      else if (node.type === "call_expression") {
        const funcNode = this.findChild(node, (n) => n.type === "identifier")
        if (funcNode && activeScope !== "global" && isInBody) {
            relationships.push({
              source: activeScope,
              target: funcNode.text,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.95,
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
              metadata: { isFieldRead: true, relationshipType: "field_access" },
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
      for (let i = childCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
           walkStack.push({ node: child, isExit: false, activeScope: nextActiveScope, parentType: node.type, isInBody: nextIsInBody })
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
    // must never collapse into one.
    const uniqueRelMap = new Map<string, ASTEngine.UniversalRelationship>()
    for (let i = 0; i < relationships.length; i++) {
        uniqueRelMap.set(`${relationships[i].type}|${relationships[i].source}->${relationships[i].target}`, relationships[i])
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
        if (s.ownerName) continue
        if (seenExportNames.has(s.name)) continue
        seenExportNames.add(s.name)
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
      }
    }
    return {
      language: "objective-c",
      symbols: uniqueSymbols,
      relationships: uniqueRelationships,
      imports,
      exports,
      errors,
      metadata: { complexity: uniqueSymbols.length, linesOfCode: content.split("\n").length, detectedFrameworks: [...frameworks], framework: [...frameworks][0] },
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
