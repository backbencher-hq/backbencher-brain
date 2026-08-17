function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

// Strip `<`, `>`, `"`, and `'` characters from an include-path node text
// (`<vector>` → `vector`, `"Service.h"` → `Service.h`). Pure-String scan —
// replaces the legacy `/[<>"']/g` regex used for include-path extraction.
function stripIncludeChars(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== "<" && c !== ">" && c !== '"' && c !== "'") out += c
  }
  return out
}

// Strip a leading access-specifier keyword from a base-class node text
// (`private Repository` → `Repository`). Pure-String scan — replaces the
// legacy `/^public\s+|^protected\s+|^private\s+/` regex.
function stripAccessSpecifier(text: string): string {
  const lower = text.toLowerCase()
  if (lower.startsWith("public")) return text.slice("public".length).trim()
  if (lower.startsWith("protected")) return text.slice("protected".length).trim()
  if (lower.startsWith("private")) return text.slice("private".length).trim()
  return text.trim()
}

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealCppAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const frameworks: Record<string, boolean> = {}
    let memorySafetyScore = 100

    interface Scope {
      node: Node
      name: string
      kind: ASTEngine.SymbolKind
      visibility: "public" | "private" | "protected"
      isTemplate: boolean
      isAbstract: boolean
      symbolRef?: ASTEngine.UniversalSymbol
      friends?: string[]
    }

    const scopeStack: Scope[] = []

    interface StackItem {
      node: Node
      parentContext?: Scope
      isExit?: boolean
    }

    const stack: StackItem[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, parentContext, isExit } = item

      if (isExit) {
        if (parentContext?.symbolRef && parentContext.isAbstract) {
          parentContext.symbolRef.isAbstract = true
          if (parentContext.symbolRef.metadata) {
            parentContext.symbolRef.metadata.isAbstract = true
          }
        }
        if (parentContext && scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === parentContext) {
          scopeStack.pop()
        }
        continue
      }

      if (node.isMissing || node.hasError) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          if (errors.length < 3) errors.push({
            message: `Syntax ${node.type} detected`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let newContext = parentContext
      const type = node.type
      let pushedScope = false

      // 1. V8 Freeze Fix: Only check small text identifiers, not global node text
      if (type === "identifier" || type === "qualified_identifier" || type === "type_identifier") {
        const text = node.text
        if (text === "std::make_unique" || text === "std::make_shared") {
          memorySafetyScore = Math.min(100, memorySafetyScore + 5)
        }
      }
      if (type === "new_expression" || type === "delete_expression") {
        memorySafetyScore = Math.max(0, memorySafetyScore - 5)
      }

      if (type === "using_declaration") {
        const name = this.childText(node, "identifier") || node.text.replace("using", "").replace(";", "").trim()
        if (name && name !== "namespace") {
          imports.push({
            source: name,
            imported: [],
            range: this.nodeToRange(node),
            isTypeOnly: false,
          })
        }
      } else if (type === "alias_declaration") {
        // `using Point = std::pair<double, double>;` — the modern typedef.
        // The alias name is the `name` field (type_identifier); the value is
        // a type_descriptor. Captured as a Type symbol (matches C typedefs).
        const nameNode = node.childForFieldName("name") || this.findChild(node, "type_identifier")
        const name = nameNode?.text
        if (name) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: parentContext?.visibility || "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isTypeAlias: true, isUsingDeclaration: true },
          })
        }
      } else if (type === "type_definition" || node.text.startsWith("typedef")) {
        const typeId = this.findChild(node, "type_identifier")
        if (typeId) {
          symbols.push({
            name: typeId.text,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: parentContext?.visibility || "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isTypeAlias: true },
          })
        }
      } else if (type === "preproc_include") {
        const text = node.text
        imports.push({
          source: text,
          imported: [],
          range: this.nodeToRange(node),
          isTypeOnly: false,
        })
        // depends: #include = compile-time dependency
        const includePath = stripIncludeChars(text.slice(text.indexOf("include") + "include".length)).trim()
        if (includePath) {
          relationships.push({
            source: "global",
            target: includePath,
            type: ASTEngine.RelationshipType.References,
            confidence: 1.0,
            metadata: { isIncludeDependency: true },
          })
        }

        const lowerText = text.toLowerCase()
        if (stringIncludes(lowerText, "memory") || stringIncludes(lowerText, "unique_ptr") || stringIncludes(lowerText, "shared_ptr")) {
          patterns["RAII"] = true
          patterns["Smart Pointers"] = true
        }
        if (
          stringIncludes(lowerText, "qt") ||
          stringIncludes(lowerText, "qobject") ||
          stringIncludes(lowerText, "qstring") ||
          stringIncludes(lowerText, "qwidget")
        )
          frameworks["Qt"] = true
        if (stringIncludes(lowerText, "iostream") || stringIncludes(lowerText, "vector") || stringIncludes(lowerText, "algorithm"))
          frameworks["stl"] = true
        if (stringIncludes(lowerText, "windows.h")) frameworks["win32"] = true
      }

      if (type === "auto") patterns["auto"] = true
      if (type === "lambda_expression") patterns["lambda"] = true

      // 5. Deep Tree Walk Fix: Only check direct children for constexpr
      if (this.hasDirectModifier(node, "constexpr")) patterns["constexpr"] = true

      if (type === "access_specifier") {
        if (parentContext) {
          const t = node.text.replace(":", "").trim()
          if (t === "public" || t === "private" || t === "protected") {
            parentContext.visibility = t as any
          }
        }
      }

      if (type === "namespace_definition") {
        const name = this.childText(node, "namespace_identifier") || "anonymous"
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCppNamespace: true, fullName: this.buildFullName(scopeStack, name) },
        })
        newContext = {
          node,
          name,
          kind: ASTEngine.SymbolKind.Namespace,
          visibility: "public",
          isTemplate: false,
          isAbstract: false,
          friends: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "class_specifier" || type === "struct_specifier" || type === "union_specifier") {
        // Forward declaration (`class X;`) — no body: NOT a symbol, no scope
        // push (matches the C negative contract: forward decls produce no
        // symbol). Only the type identifier lives inside, so walk children
        // (harmless) and continue.
        const bodyNode = this.findChild(node, "class_body") || this.findChild(node, "field_declaration_list")
        if (!bodyNode) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        const name = this.childText(node, "type_identifier") || "anonymous"
        const kind = ASTEngine.SymbolKind.Class
        const defaultVis = type === "class_specifier" ? "private" : "public"

        const isTemplate = node.parent?.type === "template_declaration"

        newContext = { node, name, kind, visibility: defaultVis, isTemplate, isAbstract: false, friends: [] }
        scopeStack.push(newContext)
        pushedScope = true

        const baseClasses: string[] = []
        const baseClause = this.findChild(node, "base_class_clause")
        if (baseClause) {
          // 4. Empty Inheritance Graph Fix: Check inside base_class nodes
          for (let i = 0; i < baseClause.namedChildCount; i++) {
            const bc = baseClause.namedChild(i)
            if (!bc) continue
            let typeNode =
              this.findChild(bc, "type_identifier") ||
              this.findChild(bc, "qualified_identifier") ||
              this.findChild(bc, "template_type")

            if (!typeNode && bc.type !== "base_class" && bc.type !== "access_specifier") {
              typeNode = bc
            } else if (!typeNode && bc.type === "base_class") {
              typeNode = bc.namedChild(bc.namedChildCount - 1)
            }
            if (typeNode && typeNode.type !== "access_specifier") {
              const text = stripAccessSpecifier(typeNode.text)
              if (text) {
                baseClasses.push(text)
                relationships.push({
                  source: name,
                  target: text,
                  type: ASTEngine.RelationshipType.Extends,
                  metadata: { nodeType: typeNode.type },
                })
              }
            }
          }
          
          // Track base class virtual methods for Implements relationships
          if (!((this as any)._baseVirtuals)) (this as any)._baseVirtuals = new Map<string, string[]>()
          for (const baseClass of baseClasses) {
            const baseKey = `${baseClass}`
            if (!(this as any)._baseVirtuals.has(baseKey)) {
              (this as any)._baseVirtuals.set(baseKey, [])
            }
          }
        }

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          visibility: parentContext?.visibility || "public",
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          metadata: {
            isCppClass: true,
            isTemplate,
            baseClasses,
          },
        }
        symbols.push(sym)
        newContext.symbolRef = sym
      } else if (type === "enum_specifier") {
        const name = this.childText(node, "type_identifier") || "anonymous"
        let isEnumClass = false
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child && (child.text === "class" || child.text === "struct")) {
            isEnumClass = true
            break
          }
        }

        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility: parentContext?.visibility || "public",
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          metadata: { isCppEnum: true, isEnumClass, isScopedEnum: isEnumClass },
        })
        newContext = {
          node,
          name,
          kind: ASTEngine.SymbolKind.Enum,
          visibility: "public",
          isTemplate: false,
          isAbstract: false,
          friends: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "function_definition" || type === "field_declaration" || type === "declaration") {
        const funcDetails = this.getFunctionDetails(node)

        let isStatic = this.hasDirectModifier(node, "static")
        let isConstexpr = this.hasDirectModifier(node, "constexpr")
        let isConst = this.hasDirectModifier(node, "const")
        let isVirtual = this.hasDirectModifier(node, "virtual") || this.hasDirectModifier(node, "override")

        if (funcDetails) {
          const { name: funcName, scope: explicitScope, isDestructor, isOperator } = funcDetails

          // 3. Out-of-Line Method Orphan Fix: Use explicit scope if defined (e.g. MyClass::myMethod)
          const actualOwnerName = explicitScope || parentContext?.name
          const actualOwnerKind = explicitScope ? ASTEngine.SymbolKind.Class : parentContext?.kind

          const isConstructor = actualOwnerName === funcName && actualOwnerKind === ASTEngine.SymbolKind.Class

          // 2. Pure Virtual Hallucination Fix: Only check direct immediate children for '0' in a field declaration
          let isPureVirtual = false
          if (isVirtual || type === "field_declaration" || type === "declaration") {
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i)
              if (child && child.type === "number_literal" && child.text === "0") {
                isPureVirtual = true
                break
              }
            }
          }

          if (isPureVirtual && parentContext && parentContext.name === actualOwnerName) {
            parentContext.isAbstract = true
          }

          const isTemplate = node.parent?.type === "template_declaration"
        // Destructors are compiler-managed lifecycle members; exclude them from
        // the declaration symbol set (matching the universal contract's focus on
        // user declarations).
        if (isDestructor) {
          // still walk children for nested declarations
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }

        const kind = isConstructor
            ? ASTEngine.SymbolKind.Constructor
            : actualOwnerKind === ASTEngine.SymbolKind.Class
              ? ASTEngine.SymbolKind.Method
              : ASTEngine.SymbolKind.Function

        // Universal contract: constructors are normalized to the name
        // "constructor" (identical to the C# normalization). The C++ class name
        // remains available via ownerName.
        let symName = funcName
        if (isConstructor) symName = "constructor"

          const sym: ASTEngine.UniversalSymbol = {
            name: symName,
            kind: kind,
            range: this.nodeToRange(node),
            visibility: parentContext?.visibility || "public",
            isStatic,
            ownerName: actualOwnerName,
            ownerKind: actualOwnerKind,
            metadata: {
              isCppFunction: true,
              isTemplate,
              isVirtual,
              isPureVirtual,
              isConst,
              isStatic,
              isConstexpr,
              isConstructor,
              isDestructor,
              isOperatorOverload: isOperator,
            },
          }
          // Detect Implements: virtual method override in derived class
          if ((isVirtual || isPureVirtual) && parentContext?.kind === ASTEngine.SymbolKind.Class && !isConstructor) {
            // This is a virtual method in a class. Track it for future overrides.
            const bv = (this as any)._baseVirtuals
            if (bv) {
              const classVirtuals = bv.get(parentContext.name) || []
              classVirtuals.push(funcName)
              bv.set(parentContext.name, classVirtuals)
            }
          }
          if (isVirtual && parentContext?.kind === ASTEngine.SymbolKind.Class && actualOwnerKind === ASTEngine.SymbolKind.Class && isConstructor === false) {
            // Check if this overrides a base class virtual method
            const bv = (this as any)._baseVirtuals
            if (bv && parentContext.symbolRef) {
              const baseClasses = parentContext.symbolRef.metadata?.baseClasses as string[] || []
              for (const baseClass of baseClasses) {
                const baseMethods = bv.get(baseClass)
                if (baseMethods && baseMethods.includes(funcName)) {
                  relationships.push({
                    source: `${parentContext.name}.${funcName}`,
                    target: `${baseClass}.${funcName}`,
                    type: ASTEngine.RelationshipType.Implements,
                    confidence: 0.9,
                    metadata: { isOverride: true, isVirtual: true },
                  })
                  // overrides: explicit virtual method override detection
                  relationships.push({
                    source: `${parentContext.name}.${funcName}`,
                    target: `${baseClass}.${funcName}`,
                    type: ASTEngine.RelationshipType.Overrides,
                    confidence: 0.95,
                    metadata: { isVirtualOverride: true },
                  })
                }
              }
            }
          }

          symbols.push(sym)

          if (type === "function_definition") {
            newContext = {
              node,
              name: funcName,
              kind,
              visibility: "public",
              isTemplate: false,
              isAbstract: false,
              friends: [],
              symbolRef: sym
            }
            scopeStack.push(newContext)
            pushedScope = true
          }
        } else if (type === "field_declaration" || type === "declaration") {
          const decls = this.findAllChildren(node, "init_declarator")
          if (decls.length === 0) {
            // Member fields use field_identifier (`int id_;`); pointer/reference
            // members wrap it in a pointer_declarator (`UserRepository *repository_;`).
            const ptrWrap =
              this.findChild(node, "pointer_declarator") || this.findChild(node, "reference_declarator")
            const basicDecl =
              this.findChild(node, "identifier") ||
              this.findChild(node, "field_identifier") ||
              (ptrWrap ? this.findChild(ptrWrap, "field_identifier") || this.findChild(ptrWrap, "identifier") : null)
            if (basicDecl) decls.push(node)
          }

          for (let idx = 0; idx < decls.length; idx++) {
            const d = decls[idx];
            // Still finding the immediate identifier for a variable, no deep walks
            let idNode = this.findChild(d, "identifier") || this.findChild(d, "field_identifier")
            if (!idNode) {
              const ptr = this.findChild(d, "pointer_declarator") || this.findChild(d, "reference_declarator")
              if (ptr) idNode = this.findChild(ptr, "identifier") || this.findChild(ptr, "field_identifier")
            }

            const name = idNode ? idNode.text : this.childText(d, "identifier") || this.childText(d, "field_identifier")
            // Function-local declarations are execution artifacts, not
            // declaration sites — only class-scope fields and file-scope
            // variables become symbols.
            const insideFunction =
              parentContext &&
              (parentContext.kind === ASTEngine.SymbolKind.Function ||
                parentContext.kind === ASTEngine.SymbolKind.Method ||
                parentContext.kind === ASTEngine.SymbolKind.Constructor)
            if (name && !stringIncludes(name, "(") && !insideFunction) {
              // File-scope static (internal linkage) → private, matching the
              // C family contract; class-scope members keep the
              // access-specifier visibility.
              const visStatic =
                isStatic && parentContext?.kind !== ASTEngine.SymbolKind.Class ? "private" : undefined
              symbols.push({
                name,
                kind: isConstexpr
                  ? ASTEngine.SymbolKind.Constant
                  : parentContext?.kind === ASTEngine.SymbolKind.Class
                    ? ASTEngine.SymbolKind.Property
                    : ASTEngine.SymbolKind.Variable,
                range: this.nodeToRange(d),
                visibility: visStatic || parentContext?.visibility || "public",
                isStatic,
                ownerName: parentContext?.name,
                ownerKind: parentContext?.kind,
                metadata: {
                  isConstexpr,
                  isStatic,
                  isConst,
                },
              })
            }
          }
        }
      } else if (type === "enumerator") {
        const name = this.childText(node, "identifier")
        if (name) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isCppEnumMember: true },
          })
        }
      } else if (type === "field_expression") {
        // struct.field or ptr->field → Uses relationship (family contract:
        // field access is a USES edge, never a references/uses pair). When the
        // field access is the function of a call (`obj.method()`), the
        // call_expression branch already emits the `calls` edge — skipping it
        // here avoids the redundant `uses` pair (one edge per pair).
        const field = node.childForFieldName("field")
        const obj = node.childForFieldName("argument") || node.namedChild(0)
        if (
          field &&
          field.text.trim() &&
          !(obj && obj.type === "call_expression") &&
          node.parent?.type !== "call_expression"
        ) {
          const source = parentContext?.name || "global"
          const relKey = `${source}::uses::${field.text}`
          if (!(this as any)._emittedUses) {
            (this as any)._emittedUses = new Set<string>()
          }
          const uses = (this as any)._emittedUses
          if (!uses.has(relKey)) {
            uses.add(relKey)
            relationships.push({
              source,
              target: field.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              metadata: { relationshipType: "field_access", accessedFrom: obj?.text },
            })
          }
        }
      } else if (type === "call_expression") {
        const funcNode = node.childForFieldName("function") || node.namedChild(0)
        if (funcNode) {
          let targetName = funcNode.text
          let qualifiedName = targetName

          if (funcNode.type === "field_expression") {
            // obj.method() or ptr->method()
            const field = funcNode.childForFieldName("field")
            const obj = funcNode.childForFieldName("argument") || funcNode.namedChild(0)
            if (field) {
              targetName = field.text
              qualifiedName = obj ? `${obj.text}.${field.text}` : field.text
            }
          } else if (funcNode.type === "qualified_identifier") {
            // ns::func() or Class::method()
            const nameNode = funcNode.namedChild(funcNode.namedChildCount - 1)
            if (nameNode) targetName = nameNode.text
            qualifiedName = funcNode.text
          } else if (funcNode.type === "template_function") {
            // func<T>()
            const baseNode = funcNode.namedChild(0)
            if (baseNode) targetName = baseNode.text
            qualifiedName = targetName
          }

          const source = parentContext?.name || "global"

          if (!targetName.startsWith("operator")) {
            relationships.push({
              source,
              target: targetName,
              fromSymbol: source,
              toSymbol: qualifiedName,
              type: ASTEngine.RelationshipType.Calls,
              metadata: { line: node.startPosition.row, qualified: qualifiedName },
            })
          }
        }
      } else if (type === "new_expression") {
        // Track instantiations: new Foo() or new std::vector<int>()
        const typeNode = node.namedChild(0)
        if (typeNode) {
          let typeName = typeNode.text
          if (typeNode.type === "qualified_identifier") {
            const nameNode = typeNode.namedChild(typeNode.namedChildCount - 1)
            if (nameNode) typeName = nameNode.text
          }
          const source = parentContext?.name || "global"
          relationships.push({
            source,
            target: typeName,
            fromSymbol: source,
            toSymbol: typeNode.text,
            type: ASTEngine.RelationshipType.Instantiates,
            metadata: { line: node.startPosition.row, isNew: true },
          })
        }
      }

      if (pushedScope) {
        stack.push({ node, parentContext: newContext, isExit: true })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parentContext: newContext })
        }
      }
    }

    // Populate exports for file-scope public symbols
    for (const sym of symbols) {
      if (!sym.ownerName && !sym.ownerKind) {
        // File-scope: global namespace
        const isPrivate = sym.visibility === "private" || sym.isStatic
        if (!isPrivate && !sym.name.startsWith("anonymous")) {
          exports.push({
            name: sym.name,
            kind: sym.kind,
            range: sym.range,
            visibility: sym.visibility || "public",
          })
        }
      } else if (sym.visibility === "public" && !sym.isStatic) {
        // Class-scope: public non-static members
        exports.push({
          name: sym.name,
          kind: sym.kind,
          range: sym.range,
          visibility: sym.visibility,
        })
      }
    }

    // Post-loop: add contains for owned symbols (class→method, class→field, namespace→class)
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        linesOfCode: content.split("\n").length,
        patterns: (() => { const arr: string[] = []; for (const p in patterns) arr.push(p); return arr; })(),
        detectedFrameworks: (() => { const arr: string[] = []; for (const f in frameworks) arr.push(f); return arr; })(),
        memorySafetyScore,
      },
    }
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

  private findChild(node: Node, type: string, text?: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) {
        if (text === undefined || child.text === text) return child
      }
    }
    return null
  }

  private findAllChildren(node: Node, type: string): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) res.push(child)
    }
    return res
  }

  private childText(node: Node, type: string): string | null {
    const child = this.findChild(node, type)
    return child ? child.text : null
  }

  private hasDirectModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.text === modifier) return true
      if (
        (child.type === "type_qualifier" ||
          child.type === "storage_class_specifier" ||
          child.type === "virtual_specifier") &&
        child.text === modifier
      ) {
        return true
      }
    }
    // Also check inside function_declarator for virtual_specifier (override keyword)
    const funcDecl = this.findChild(node, "function_declarator")
    if (funcDecl) {
      for (let i = 0; i < funcDecl.childCount; i++) {
        const child = funcDecl.child(i)
        if (child?.type === "virtual_specifier" && child.text === modifier) return true
      }
    }
    return false
  }

  private getFunctionDetails(
    node: Node,
  ): { name: string; scope?: string; isDestructor: boolean; isOperator: boolean } | null {
    let decl = this.findChild(node, "function_declarator")
    if (!decl) {
      const ptr = this.findChild(node, "pointer_declarator") || this.findChild(node, "reference_declarator")
      if (ptr) decl = this.findChild(ptr, "function_declarator")
    }

    if (!decl) return null

    let nameNode =
      this.findChild(decl, "identifier") ||
      this.findChild(decl, "field_identifier") ||
      this.findChild(decl, "destructor_name") ||
      this.findChild(decl, "operator_name") ||
      this.findChild(decl, "qualified_identifier")

    if (!nameNode) return null

    let name = nameNode.text
    let scope: string | undefined = undefined
    let isDestructor = nameNode.type === "destructor_name" || name.startsWith("~")
    let isOperator = nameNode.type === "operator_name" || name.startsWith("operator")

    if (nameNode.type === "qualified_identifier") {
      // `ConsoleLogger::log` parses as qualified_identifier[namespace_identifier,
      // identifier]. The scope is the FIRST named child (namespace/type/class),
      // the method name is the LAST named child. Checking `identifier` before
      // `namespace_identifier` wrongly grabs the method name as the scope
      // (constructor:log in log) — so inspect in the right order.
      const actualNameNode = nameNode.namedChild(nameNode.namedChildCount - 1)
      let scopeNode: Node | null = null
      for (let i = 0; i < nameNode.namedChildCount - 1; i++) {
        const c = nameNode.namedChild(i)
        if (c && (c.type === "namespace_identifier" || c.type === "type_identifier" || c.type === "identifier")) {
          scopeNode = c
          break
        }
        // `Registry<T>::add` — the scope is a template_type (`Registry<T>`);
        // use its underlying type name so template method definitions resolve
        // their owner correctly (instead of leaking to the namespace).
        if (c && c.type === "template_type") {
          const tname = c.childForFieldName("name") || this.findChild(c, "type_identifier")
          if (tname) {
            scopeNode = tname
            break
          }
        }
      }
      // Nested qualification (A::B::fn): the outer scope wraps a nested
      // qualified_identifier; use its full text as the scope.
      const firstChild = nameNode.namedChild(0)
      if (!scopeNode && firstChild && firstChild.type === "qualified_identifier") {
        scopeNode = firstChild
      }

      if (actualNameNode) {
        name = actualNameNode.text
        if (scopeNode) scope = scopeNode.text
        if (actualNameNode.type === "destructor_name" || name.startsWith("~")) isDestructor = true
        if (actualNameNode.type === "operator_name" || name.startsWith("operator")) isOperator = true
      }
    }

    return { name, scope, isDestructor, isOperator }
  }

  private buildFullName(scopeStack: any[], name: string): string {
    const parts: string[] = []
    for (let i = 0; i < scopeStack.length; i++) {
      if (scopeStack[i].kind === ASTEngine.SymbolKind.Namespace) {
        parts.push(scopeStack[i].name)
      }
    }
    parts.push(name)
    return parts.join("::")
  }
}
