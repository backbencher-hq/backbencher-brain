// Dart Intelligence Engine
// M12.11 rewrite: C#-family contract, pure-AST, fully regex-free.
//   - Symbols: classes, mixins, extensions, enums (+enum members), typedefs,
//     methods, getters/setters -> property, fields, top-level functions,
//     constructors -> "constructor"; NO locals/params/lambda-params as symbols.
//   - Relationships: leaf identities (calls: Counter -> Sqrt); contains from
//     ownerName; extends/implements/mixin-uses; instantiates (capitalized
//     constructor invocations + constructor_invocation nodes); imports/exports
//     (import/export/part directives); overrides (@override or same-name in
//     base, in-file or cross-file via override companion); global builtins
//     (print/assert) filtered.
//   - Dart call syntax: no `new` — capitalized identifier + argument_part
//     selector = constructor invocation (instantiates); lowercase identifier +
//     argument_part = function call; selector chains (obj.method(...)) resolve
//     to the leaf method name; cascade_section calls resolve to the selector.

import type { Node } from "web-tree-sitter"
import * as path from "path"
import { ASTEngine } from "./engine"

// ============================================================================
// PURE-STRING HELPERS (regex-free normalization)
// ============================================================================

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

function stripCommentMarkers(text: string): string {
  if (text.startsWith("///")) return text.slice(3).trimStart()
  if (text.startsWith("//")) return text.slice(2).trimStart()
  if (text.startsWith("/*")) {
    const end = text.endsWith("*/") ? text.length - 2 : text.length
    return text.slice(2, end).trim()
  }
  return text.trim()
}

function isCapitalized(text: string): boolean {
  if (text.length === 0) return false
  const code = text.charCodeAt(0)
  return code >= 65 && code <= 90 // 'A'..'Z'
}


// ============================================================================
// SCOPE MANAGEMENT — frames carry an immutable snapshot of the scope chain
// ============================================================================

enum DartScopeKind {
  Global = "global",
  Class = "class",
  Function = "function",
}

interface DartScopeEntry {
  name: string
  kind: DartScopeKind
}

function scopeOwnerName(scopes: DartScopeEntry[]): string | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].kind === DartScopeKind.Class) return scopes[i].name
  }
  return undefined
}

function scopeString(scopes: DartScopeEntry[]): string {
  const parts: string[] = []
  for (let i = 1; i < scopes.length; i++) {
    const s = scopes[i]
    if (s.kind !== DartScopeKind.Global) parts.push(s.name)
  }
  return parts.join(".")
}

// ============================================================================
// ANALYZER
// ============================================================================

export class RealDartAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const frameworks: Record<string, boolean> = { Dart: true }
    const patterns: Record<string, boolean> = {}
    const scopes: DartScopeEntry[] = [{ name: "__global__", kind: DartScopeKind.Global }]
    const moduleName = path.basename(filePath, path.extname(filePath))

    // --- Error collection --------------------------------------------------
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    // --- Symbol + import/export extraction (single iterative traversal) ----
    interface Frame {
      node: Node
      scopes: DartScopeEntry[]
      functionDepth: number
    }

    const stack: Frame[] = [{ node: rootNode, scopes, functionDepth: 0 }]
    let cyclomaticComplexity = 1
    const seenMembers = new Set<string>() // owner:name — overload dedup

    while (stack.length > 0) {
      const { node, scopes: frameScopes, functionDepth } = stack.pop()!
      const scopeStack = [...frameScopes]
      let nextFunctionDepth = functionDepth

      const t = node.type
      if (
        t === "if_statement" ||
        t === "for_statement" ||
        t === "while_statement" ||
        t === "do_statement" ||
        t === "switch_statement" ||
        t === "catch_clause" ||
        t === "conditional_expression" ||
        t === "logical_and_expression" ||
        t === "logical_or_expression"
      ) {
        cyclomaticComplexity++
      }

      switch (t) {
        case "class_definition": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            const isAbstract = this.hasModifier(node, "abstract")
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              isAbstract,
              genericParameters: this.extractTypeParameters(node),
              metadata: { isClass: true, isAbstract },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })

            // heritage: extends / with / implements
            this.extractClassHeritage(node, name, relationships, patterns)
          }
          break
        }

        case "mixin_declaration": {
          // tree-sitter-dart exposes the mixin name as a direct `identifier`
          // child (no name field): `mixin_declaration > identifier > class_body`
          const name =
            node.childForFieldName("name")?.text ||
            this.findChildByType(node, "identifier")?.text
          if (name) {
            const comments = this.collectComments(node)
            patterns["Mixins"] = true
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Mixin,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isMixin: true },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })
          }
          break
        }

        case "extension_declaration": {
          const targetType = this.extensionTargetType(node)
          // Unnamed extensions (`extension on String {...}`) take the target
          // type as their name so their members keep an owner scope.
          const name = node.childForFieldName("name")?.text || targetType
          if (name) {
            const comments = this.collectComments(node)
            patterns["Extensions"] = true
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Extension,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isExtension: true, targetType, isUnnamedExtension: !node.childForFieldName("name") },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })
          }
          break
        }

        case "enum_declaration": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Enum,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isEnum: true },
            })
            // enum members
            const body = this.findChildByType(node, "enum_body")
            if (body) {
              for (let i = 0; i < body.namedChildCount; i++) {
                const c = body.namedChild(i)
                if (c && c.type === "enum_constant") {
                  const mname = c.childForFieldName("name")?.text
                  if (mname) {
                    symbols.push({
                      name: mname,
                      kind: ASTEngine.SymbolKind.EnumMember,
                      range: this.nodeToRange(c),
                      scope: name,
                      ownerName: name,
                      ownerKind: ASTEngine.SymbolKind.Enum,
                      visibility: mname.startsWith("_") ? "private" : "public",
                      metadata: { isEnumMember: true },
                    })
                  }
                }
              }
            }
            scopeStack.push({ name, kind: DartScopeKind.Class })
          }
          break
        }

        case "type_alias": {
          const nameNode = node.childForFieldName("name") || this.findChildByType(node, "type_identifier")
          const name = nameNode?.text
          if (name && name !== "Function") {
            const comments = this.collectComments(node)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.TypeAlias,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isTypeAlias: true },
            })
          }
          break
        }

        case "declaration": {
          const sig = this.findSignatureIn(node)
          if (sig) {
            if (this.isConstructorSignature(sig.type)) {
              const owner = scopeOwnerName(scopeStack)
              if (owner) {
                this.processConstructor(node, sig, owner, symbols, relationships, patterns)
              }
            } else {
              this.processFunctionOrMethod(node, sig, symbols, scopeStack, patterns, seenMembers)
            }
          } else {
            // field / top-level variable declaration
            this.processFieldOrVariable(node, symbols, scopeStack)
          }
          break
        }

        case "method_signature":
        case "function_signature":
        case "getter_signature":
        case "setter_signature":
        case "function_declaration": {
          // Bare signatures (mixin bodies, extension bodies, top-level
          // functions) WITHOUT a `declaration` wrapper. Class members wrapped
          // in `declaration` are handled by that case — skip them here to
          // avoid double-processing.
          if (node.parent?.type === "declaration") break
          const owner = scopeOwnerName(scopeStack)
          // Factories surface as `method_signature > factory_constructor_signature`
          // — dispatch constructors to processConstructor.
          const inner = this.findInnerSignature(node)
          if (owner && this.isConstructorSignature(inner.type)) {
            this.processConstructor(node, inner, owner, symbols, relationships, patterns)
          } else if (owner || t === "function_declaration") {
            this.processFunctionOrMethod(node, node, symbols, scopeStack, patterns, seenMembers)
          } else if (t === "function_signature") {
            // top-level function — signature with sibling function_body
            this.processTopLevelFunction(node, symbols, scopeStack, patterns)
          }
          break
        }

        case "constructor_signature":
        case "factory_constructor_signature":
        case "constant_constructor_signature":
        case "redirecting_factory_constructor_signature": {
          // Wrapped by `declaration` (plain constructors) or `method_signature`
          // (factories) — both handled by their wrapper cases.
          const ptype = node.parent?.type
          if (ptype === "declaration" || ptype === "method_signature") break
          const owner = scopeOwnerName(scopeStack)
          if (owner) {
            this.processConstructor(node, node, owner, symbols, relationships, patterns)
          }
          break
        }

        case "initialized_identifier_list":
        case "initialized_variable_declaration":
        case "static_final_declaration_list": {
          const parent = node.parent
          if (parent && (parent.type === "program" || parent.type === "compilation_unit" || parent.type === "library_definition")) {
            this.processTopLevelVariables(node, symbols, scopeStack)
          }
          break
        }

        case "import_specification":
        case "library_export":
        case "part_directive": {
          this.processImportExport(node, imports, exports, frameworks, relationships, moduleName)
          break
        }
      }

      // Recurse children
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, scopes: scopeStack, functionDepth: nextFunctionDepth })
        }
      }
    }

    // --- Relationship passes -------------------------------------------------
    this.addContainmentRelationships(symbols, relationships)
    this.extractOverrideRelationships(symbols, relationships, context?.overrideCompanion)
    this.extractCallRelationships(rootNode, relationships, moduleName)

    // --- Metadata ------------------------------------------------------------
    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns)
    const detectedFrameworks = Object.keys(frameworks)
    const frameworkPatterns = detectedPatterns.map((p) => ({
      framework: "Dart",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    return {
      language: "dart",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks.length > 1 ? detectedFrameworks[1] : detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "4.0.0-m12.11-family-contract",
      },
    }
  }

  // ============================================================================
  // SYMBOL PROCESSORS
  // ============================================================================

  private processConstructor(
    node: Node,
    sig: Node,
    owner: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: Record<string, boolean>,
  ): void {
    const isFactory =
      sig.type === "factory_constructor_signature" || sig.type === "redirecting_factory_constructor_signature"
    const isConst = sig.type === "constant_constructor_signature"
    if (isFactory) patterns["Factory"] = true

    // Named constructors: `Counter.initial()` / `factory Counter.zero() = ...`
    // — the named segment is a DIRECT identifier child of the signature (the
    // class name arrives via the name field, parameters live inside the
    // formal_parameter_list, so direct identifiers are unambiguous).
    let isNamed = false
    let namedSegment: string | undefined
    const directIds = this.directIdentifiers(sig)
    const named = directIds.find((id) => id !== owner)
    if (named) {
      isNamed = true
      namedSegment = named
    }

    const params = this.extractParameters(sig)
    const comments = this.collectComments(node)
    const annotations = this.extractAnnotations(node)

    symbols.push({
      name: "constructor",
      kind: ASTEngine.SymbolKind.Constructor,
      range: this.nodeToRange(node),
      scope: owner,
      ownerName: owner,
      ownerKind: ASTEngine.SymbolKind.Class,
      visibility: "public",
      parameters: params,
      comments,
      decorators: annotations,
      metadata: { isFactory, isConst, isNamed, namedSegment, isConstructor: true },
    })

    // factory redirection: `factory Counter.zero() = Counter.initial;` —
    // ONLY the redirecting form carries the target inside the signature;
    // expression-bodied factories (`factory X.y() => X(...)`) construct via
    // the normal constructor-invocation path in the calls pass.
    if (isFactory && sig.type === "redirecting_factory_constructor_signature") {
      const redirectNode = this.findChildByType(sig, "type_identifier")
      if (redirectNode) {
        relationships.push({
          source: owner,
          target: redirectNode.text,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.95,
          metadata: { isFactoryRedirection: true },
        })
      }
    }
  }

  private processFunctionOrMethod(
    node: Node,
    sig: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    patterns: Record<string, boolean>,
    seenMembers: Set<string>,
  ): void {
    // Dig through method_signature wrappers to the inner getter/setter/function
    // signature which carries the name field.
    const inner = this.findInnerSignature(sig)
    const nameNode = inner.childForFieldName("name") || this.findChildByType(inner, "identifier")
    if (!nameNode) return

    const name = nameNode.text
    const owner = scopeOwnerName(scopeStack)
    const dedupKey = `${owner ?? "module"}:${name}`
    if (seenMembers.has(dedupKey)) return
    seenMembers.add(dedupKey)

    const isGetter = inner.type === "getter_signature"
    const isSetter = inner.type === "setter_signature"
    if (isGetter || isSetter) patterns["Getters and Setters"] = true

    const params = this.extractParameters(inner)
    const returnType = this.extractReturnType(inner)
    const isAsync = this.isAsyncSignature(node, inner)
    const isStatic = this.hasModifier(node, "static") || this.hasModifier(inner, "static")
    const isAbstract = !this.hasBody(node) && (this.hasModifier(node, "abstract") || owner !== undefined)
    const comments = this.collectComments(node)
    const annotations = this.extractAnnotations(node)

    if (isAsync || (returnType && returnType.startsWith("Future"))) patterns["Async Programming"] = true

    const kind =
      isGetter || isSetter
        ? ASTEngine.SymbolKind.Property
        : owner
          ? ASTEngine.SymbolKind.Method
          : ASTEngine.SymbolKind.Function

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind,
      range: this.rangeIncludingBody(node, inner),
      scope: scopeString(scopeStack),
      ownerName: owner,
      ownerKind: owner ? scopeOwnerKind(scopeStack) : undefined,
      visibility: name.startsWith("_") ? "private" : "public",
      parameters: params,
      returnType,
      comments,
      decorators: annotations,
      isStatic,
      isAsync,
      isAbstract,
      complexity: this.methodComplexity(node),
      metadata: { isGetter, isSetter, isStatic, isAsync, isAbstract, hasBody: this.hasBody(node) },
    }
    symbols.push(symbol)

    scopeStack.push({ name, kind: DartScopeKind.Function })
  }

  private processTopLevelFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    patterns: Record<string, boolean>,
  ): void {
    const nameNode = node.childForFieldName("name") || this.findChildByType(node, "identifier")
    if (!nameNode) return
    const name = nameNode.text
    const params = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const isAsync = this.isAsyncSignature(node, node)
    if (isAsync || (returnType && returnType.startsWith("Future"))) patterns["Async Programming"] = true
    const comments = this.collectComments(node)

    symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.rangeIncludingBody(node, node),
      scope: scopeString(scopeStack),
      visibility: name.startsWith("_") ? "private" : "public",
      parameters: params,
      returnType,
      comments,
      isAsync,
      complexity: this.methodComplexity(node),
      metadata: { isAsync, isTopLevelFunction: true },
    })
    scopeStack.push({ name, kind: DartScopeKind.Function })
  }

  private processFieldOrVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
  ): void {
    const declList = this.findChildByType(node, "initialized_identifier_list") ||
      this.findChildByType(node, "initialized_variable_declaration") ||
      this.findChildByType(node, "static_final_declaration_list") ||
      (node.type === "initialized_identifier_list" || node.type === "initialized_variable_declaration" ||
        node.type === "static_final_declaration_list"
        ? node
        : undefined)
    if (!declList) return

    const owner = scopeOwnerName(scopeStack)
    const isStatic = this.hasModifier(node, "static") || node.type === "static_final_declaration_list"
    const isFinal = this.hasModifier(node, "final") || node.type === "static_final_declaration_list"
    const isConst = this.hasModifier(node, "const")
    const isLate = this.hasModifier(node, "late")
    const dataType = this.extractFieldType(node, declList)

    for (let i = 0; i < declList.namedChildCount; i++) {
      const child = declList.namedChild(i)
      if (!child) continue
      let name: string | undefined
      if (child.type === "initialized_identifier" || child.type === "static_final_declaration") {
        const id = this.findChildByType(child, "identifier")
        name = id?.text
      } else if (child.type === "identifier") {
        name = child.text
      }
      if (!name) continue

      const kind =
        owner
          ? ASTEngine.SymbolKind.Property
          : isConst || isFinal
            ? ASTEngine.SymbolKind.Constant
            : ASTEngine.SymbolKind.Variable

      symbols.push({
        name,
        kind,
        range: this.nodeToRange(node),
        scope: scopeString(scopeStack),
        ownerName: owner,
        ownerKind: owner ? scopeOwnerKind(scopeStack) : undefined,
        visibility: name.startsWith("_") ? "private" : "public",
        isStatic,
        metadata: { isStatic, isFinal, isConst, isLate, dataType, isField: owner !== undefined },
      })
    }
  }

  private processTopLevelVariables(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
  ): void {
    const isFinal = this.hasModifier(node, "final") || this.hasModifier(node.parent!, "final")
    const isConst = this.hasModifier(node, "const") || this.hasModifier(node.parent!, "const")
    const dataType = this.extractFieldType(node, node)

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      let name: string | undefined
      if (child.type === "initialized_identifier" || child.type === "static_final_declaration") {
        const id = this.findChildByType(child, "identifier")
        name = id?.text
      } else if (child.type === "identifier") {
        name = child.text
      }
      if (!name) continue
      symbols.push({
        name,
        kind: isConst || isFinal ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(node),
        scope: scopeString(scopeStack),
        visibility: name.startsWith("_") ? "private" : "public",
        metadata: { isStatic: false, isFinal, isConst, dataType, isField: false, isTopLevelVariable: true },
      })
    }
  }

  private processImportExport(
    node: Node,
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    frameworks: Record<string, boolean>,
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
  ): void {
    if (node.type === "part_directive") {
      const uriNode = this.findDescendantByType(node, "string_literal") || this.findDescendantByType(node, "uri")
      const uri = uriNode ? unquote(uriNode.text) : ""
      if (uri) {
        imports.push({ module: uri, source: uri, imported: ["*"], isPart: true, range: this.nodeToRange(node) })
        relationships.push({
          source: moduleName,
          target: `${uri}:*`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          metadata: { isPart: true },
        })
      }
      return
    }

    const isExport = node.type === "library_export" || node.text.startsWith("export")
    const uriNode = this.findDescendantByType(node, "string_literal") || this.findDescendantByType(node, "uri")
    const uri = uriNode ? unquote(uriNode.text) : ""
    if (!uri) return

    if (uri.startsWith("package:flutter/")) frameworks["Flutter"] = true
    if (uri.startsWith("package:angular/")) frameworks["AngularDart"] = true

    if (isExport) {
      exports.push({ name: uri, isDefault: false, range: this.nodeToRange(node) })
      relationships.push({
        source: moduleName,
        target: uri,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        metadata: {},
      })
    } else {
      imports.push({ module: uri, source: uri, imported: ["*"], isTypeOnly: false, range: this.nodeToRange(node) })
      relationships.push({
        source: moduleName,
        target: `${uri}:*`,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1.0,
        metadata: {},
      })
    }
  }

  // ============================================================================
  // RELATIONSHIP PASSES
  // ============================================================================

  private addContainmentRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.ownerName) {
        relationships.push({
          source: symbol.ownerName,
          target: symbol.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }
  }

  private extractOverrideRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    overrideCompanion?: Map<string, Set<string>>,
  ): void {
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of symbols) {
      const list = byName.get(s.name) ?? []
      list.push(s)
      byName.set(s.name, list)
    }
    const baseByClass = new Map<string, string>()
    for (const r of relationships) {
      if (r.type === ASTEngine.RelationshipType.Extends && r.source && r.target) {
        baseByClass.set(r.source, r.target)
      }
    }
    const baseDeclares = (base: string, method: string): boolean => {
      const inFile = byName.get(method)?.some((bm) => bm.ownerName === base) ?? false
      if (inFile) return true
      const companion = overrideCompanion?.get(base)
      return !!companion && companion.has(method)
    }
    for (const s of symbols) {
      if ((s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Property) && s.ownerName) {
        const base = baseByClass.get(s.ownerName)
        if (!base) continue
        if (!baseDeclares(base, s.name)) continue
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.95,
          metadata: {},
        })
      }
    }
  }

  private extractCallRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
  ): void {
    // Current call source = enclosing function/method/constructor leaf name.
    const resolveCurrent = (n: Node, current: string | null): string | null => {
      if (n.type === "function_declaration") {
        const nm = n.childForFieldName("name")?.text
        if (nm) return nm
      }
      // Only signature-bearing nodes change the call context. `declaration`
      // nodes matter only when they DIRECTLY wrap a signature (class members);
      // class/enum/extension containers must NOT leak their first member name.
      let sig: Node | null = null
      if (this.isSignatureNode(n.type)) {
        sig = n
      } else if (n.type === "declaration") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && this.isSignatureNode(c.type)) {
            sig = c
            break
          }
        }
      }
      if (sig) {
        const inner = this.findInnerSignature(sig)
        if (this.isConstructorSignature(sig.type) || this.isConstructorSignature(inner.type)) return "constructor"
        const nm = inner.childForFieldName("name")?.text
        if (nm) return nm
      }
      return current
    }

    const processNode = (n: Node, current: string | null): void => {
      const prev = current
      const t = n.type
      current = resolveCurrent(n, current)
      // Dart grammar: a function_body/function_expression_body is a named
      // child of the CONTAINER (class_body, extension_body, program) that
      // FOLLOWS the signature node it belongs to — the previous named sibling
      // carries the call context (e.g. `method_signature` then `function_body`).
      if (
        (t === "function_body" || t === "block" || t === "function_expression_body") &&
        current === prev
      ) {
        const prevSib = n.previousNamedSibling
        if (prevSib) {
          const sigSource = resolveCurrent(prevSib, current)
          if (sigSource !== current) current = sigSource
        }
      }
      const callSource = current || moduleName

      // Constructor invocation: `List<int>.filled(3, 0)` → instantiates List
      if (t === "constructor_invocation") {
        const typeNode = this.findChildByType(n, "type_identifier")
        if (typeNode && isCapitalized(typeNode.text)) {
          relationships.push({
            source: callSource,
            target: typeNode.text,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { isConstructorInvocation: true },
          })
        }
      }

      // selector + argument_part = call site (Dart has no invocation_expression)
      if (t === "selector" && this.findChildByType(n, "argument_part")) {
        const leaf = this.resolveSelectorCallee(n)
        if (leaf) {
          if (this.isDartGlobalBuiltin(leaf)) {
            // filtered
          } else if (isCapitalized(leaf) && this.selectorIsBareCall(n)) {
            // Capitalized identifier directly before argument_part = Dart
            // constructor invocation (types are capitalized): `Counter(1)`,
            // `MyWidget(...)`, `Duration(seconds: 1)`.
            relationships.push({
              source: callSource,
              target: leaf,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              metadata: {},
            })
          } else {
            relationships.push({
              source: callSource,
              target: leaf,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: {},
            })
          }
        }
      }

      // cascade calls: `list.add(1)..remove(2)` → calls remove/clear
      if (t === "cascade_section") {
        const sel = this.findChildByType(n, "cascade_selector")
        const hasArgs = this.findChildByType(n, "argument_part")
        if (sel && hasArgs) {
          const mname = this.findChildByType(sel, "identifier")?.text
          if (mname && !this.isDartGlobalBuiltin(mname)) {
            relationships.push({
              source: callSource,
              target: mname,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: { isCascade: true },
            })
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) processNode(child, current)
      }

      current = prev
    }

    processNode(node, null)
  }

  // ============================================================================
  // CLASS HERITAGE
  // ============================================================================

  private extractClassHeritage(
    node: Node,
    className: string,
    relationships: ASTEngine.UniversalRelationship[],
    patterns: Record<string, boolean>,
  ): void {
    // superclass: `extends X with M1, M2` — first type_identifier is the base,
    // the `mixins` child carries the with-clause.
    const superclass = this.findChildByType(node, "superclass")
    if (superclass) {
      const base = this.firstTypeIdentifier(superclass, /*excludeMixins*/ true)
      if (base) {
        relationships.push({
          source: className,
          target: base.text,
          type: ASTEngine.RelationshipType.Extends,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    // interfaces: `implements A, B<C>`
    const interfaces = this.findChildByType(node, "interfaces")
    if (interfaces) {
      for (const ti of this.allTypeIdentifiers(interfaces)) {
        relationships.push({
          source: className,
          target: ti.text,
          type: ASTEngine.RelationshipType.Implements,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    // mixins (with-clause): inside superclass OR directly on the class
    let mixinsNode = superclass ? this.findChildByType(superclass, "mixins") : undefined
    if (!mixinsNode) mixinsNode = this.findChildByType(node, "mixins")
    if (mixinsNode) {
      patterns["Mixins"] = true
      for (const ti of this.allTypeIdentifiers(mixinsNode)) {
        relationships.push({
          source: className,
          target: ti.text,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 1.0,
          metadata: { isMixin: true },
        })
      }
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private isDartGlobalBuiltin(name: string): boolean {
    // Global functions (filtered) + Object leaf methods (mirrors the JS
    // family contract: `toString`, `hashCode`, ... are universal, not real
    // project call targets).
    if (name === "print" || name === "assert" || name === "identical") return true
    if (name === "toString" || name === "hashCode" || name === "runtimeType" || name === "noSuchMethod") return true
    return false
  }

  private selectorIsBareCall(selector: Node): boolean {
    // true when the node directly before the selector is a plain
    // identifier/type_identifier (no assignable selector chain).
    const prev = selector.previousNamedSibling
    if (!prev) return false
    return prev.type === "identifier" || prev.type === "type_identifier" || prev.type === "simple_identifier"
  }

  private resolveSelectorCallee(selector: Node): string | null {
    const prev = selector.previousNamedSibling
    if (!prev) return null
    if (prev.type === "unconditional_assignable_selector" || prev.type === "conditional_assignable_selector" ||
        prev.type === "assignable_selector" || prev.type === "selector") {
      // obj.method(...) / Future.delayed(...) / super.toString()
      const inner = this.findChildByType(prev, "identifier")
      if (inner) return inner.text
      // nested selector chain (e.g. a.b.c()) — last identifier wins
      const chain = this.lastIdentifier(prev)
      return chain
    }
    if (prev.type === "identifier" || prev.type === "type_identifier" || prev.type === "simple_identifier") {
      return prev.text
    }
    return null
  }

  private lastIdentifier(node: Node): string | null {
    let result: string | null = null
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier" || n.type === "type_identifier") result = n.text
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return result
  }

  private isSignatureNode(type: string): boolean {
    return (
      type === "function_signature" || type === "method_signature" ||
      type === "getter_signature" || type === "setter_signature" ||
      type === "constructor_signature" || type === "factory_constructor_signature" ||
      type === "constant_constructor_signature" || type === "redirecting_factory_constructor_signature"
    )
  }

  private isConstructorSignature(type: string): boolean {
    return (
      type === "constructor_signature" || type === "factory_constructor_signature" ||
      type === "constant_constructor_signature" || type === "redirecting_factory_constructor_signature"
    )
  }

  private findSignatureIn(node: Node): Node | null {
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 64) {
      const n = stack.pop()!
      if (this.isSignatureNode(n.type)) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private findInnerSignature(node: Node): Node {
    if (node.type !== "method_signature") return node
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (this.isSignatureNode(n.type) && n.type !== "method_signature") {
        return n
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return node
  }

  private hasBody(node: Node): boolean {
    const sib = node.nextNamedSibling
    if (sib && (sib.type === "function_body" || sib.type === "block")) return true
    return this.findChildByType(node, "function_body") !== null
  }

  private rangeIncludingBody(node: Node, sig: Node): ASTEngine.UniversalSymbol["range"] {
    const range = this.nodeToRange(node)
    let sib: Node | null = node.nextSibling
    let guard = 0
    while (sib && guard++ < 8) {
      if (sib.type === "function_body" || sib.type === "block") {
        range.endLine = sib.endPosition.row + 1
        range.endColumn = sib.endPosition.column + 1
        range.endIndex = sib.endIndex
        break
      }
      if (sib.type === "}" || sib.type === "class_body" || sib.type === "extension_body") break
      sib = sib.nextSibling
    }
    return range
  }

  private isAsyncSignature(node: Node, sig: Node): boolean {
    // `async` appears as a token child of the function_body or as a modifier
    const body = this.findChildByType(node, "function_body")
    if (body) {
      if (this.hasToken(body, "async")) return true
    } else {
      const sib = node.nextSibling
      if (sib && sib.type === "function_body" && this.hasToken(sib, "async")) return true
    }
    return false
  }

  private hasToken(node: Node, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === token || c.text === token)) return true
    }
    return false
  }

  private hasModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === modifier || c.text === modifier)) return true
    }
    // modifiers may live on the parent declaration wrapper
    if (node.parent) {
      for (let i = 0; i < node.parent.childCount; i++) {
        const c = node.parent.child(i)
        if (c && (c.type === modifier || c.text === modifier)) return true
      }
    }
    return false
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const out: ASTEngine.Parameter[] = []
    const paramsNode = this.findChildByType(node, "formal_parameter_list")
    if (!paramsNode) return out
    const stack: Node[] = [paramsNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "formal_parameter" || n.type === "optional_formal_parameter" ||
        n.type === "named_formal_parameter" || n.type === "default_formal_parameter" ||
        n.type === "constructor_param" || n.type === "typed_identifier"
      ) {
        const nameNode = n.childForFieldName("name") || this.findChildByType(n, "identifier")
        if (nameNode && nameNode.text !== "this" && nameNode.text !== "super") {
          const typeNode = n.childForFieldName("type") ||
            (n.type === "typed_identifier" ? this.firstTypeIdentifier(n, false) : undefined)
          const isNamed =
            n.type === "named_formal_parameter" || n.type === "default_formal_parameter" ||
            n.parent?.type === "named_formal_parameters"
          const isOptional = n.type === "optional_formal_parameter" || n.type === "default_formal_parameter"
          const already = out.some((p) => p.name === nameNode.text)
          if (!already) out.push({ name: nameNode.text, type: typeNode?.text ?? "dynamic", isOptional, isNamed })
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  private extractReturnType(node: Node): string | undefined {
    const rt = node.childForFieldName("return_type")
    if (rt) return rt.text
    const voidType = this.findChildByType(node, "void_type")
    if (voidType) return "void"
    // first type_identifier BEFORE the name field
    const nameNode = node.childForFieldName("name")
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c === nameNode) break
      if (c.type === "type_identifier" || c.type === "builtin_type" || c.type === "generic_type") return c.text
    }
    return undefined
  }

  private extractFieldType(node: Node, declList: Node): string | undefined {
    const candidates: Node[] = [node, declList]
    for (const cand of candidates) {
      for (let i = 0; i < cand.namedChildCount; i++) {
        const c = cand.namedChild(i)
        if (!c) continue
        if (c.type === "type_identifier" || c.type === "builtin_type" || c.type === "generic_type" ||
            c.type === "void_type") {
          return c.text
        }
      }
    }
    if (node.parent) {
      for (let i = 0; i < node.parent.namedChildCount; i++) {
        const c = node.parent.namedChild(i)
        if (!c) continue
        if (c.type === "type_identifier" || c.type === "builtin_type" || c.type === "generic_type") return c.text
      }
    }
    return undefined
  }

  private extractTypeParameters(node: Node): string[] | undefined {
    const tp = this.findChildByType(node, "type_parameters")
    if (!tp) return undefined
    const out: string[] = []
    for (let i = 0; i < tp.namedChildCount; i++) {
      const c = tp.namedChild(i)
      if (c && c.type === "type_parameter") out.push(c.text)
    }
    return out.length > 0 ? out : undefined
  }

  private extensionTargetType(node: Node): string | undefined {
    // `extension NumExt on int` — the target type follows the `on` keyword;
    // first type-ish named child that isn't the name.
    const name = node.childForFieldName("name")?.text
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.type === "extension_body" || c.type === "identifier") continue
      if (c.type === "type_identifier" || c.type === "builtin_type" || c.type === "generic_type" ||
          c.type === "void_type") {
        if (c.text === name) continue
        return c.text
      }
    }
    // `extension on String` (unnamed extension) — the first type identifier
    return undefined
  }

  private extractAnnotations(node: Node): string[] | undefined {
    const annotations: string[] = []
    let prev: Node | null = node.previousNamedSibling
    let guard = 0
    while (prev && guard++ < 8) {
      if (prev.type === "annotation" || prev.type === "marker_annotation") {
        annotations.unshift(prev.text)
        prev = prev.previousNamedSibling
      } else {
        break
      }
    }
    return annotations.length > 0 ? annotations : undefined
  }

  private collectComments(node: Node): string[] | undefined {
    const comments: string[] = []
    // Dart doc comments and annotations precede the declaration; annotations
    // (`@override`) sit between the doc comment and the node, so skip them.
    let sibling = node.previousSibling
    let guard = 0
    while (sibling && guard++ < 12) {
      if (sibling.type === "comment" || sibling.type === "documentation_comment") {
        comments.unshift(stripCommentMarkers(sibling.text))
        sibling = sibling.previousSibling
      } else if (sibling.type === "annotation" || sibling.type === "marker_annotation") {
        sibling = sibling.previousSibling
      } else {
        break
      }
    }
    return comments.length > 0 ? comments : undefined
  }

  private directIdentifiers(node: Node): string[] {
    const out: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "type_identifier")) out.push(c.text)
    }
    return out
  }

  private methodComplexity(node: Node): number {
    let c = 1
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" || n.type === "for_statement" || n.type === "while_statement" ||
        n.type === "do_statement" || n.type === "switch_statement" || n.type === "catch_clause" ||
        n.type === "conditional_expression" || n.type === "logical_and_expression" || n.type === "logical_or_expression"
      ) {
        c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return c
  }

  private firstTypeIdentifier(node: Node, excludeMixins: boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (excludeMixins && c.type === "mixins") continue
      if (c.type === "type_identifier" || c.type === "generic_type" || c.type === "builtin_type") {
        const ti = this.findChildByType(c, "type_identifier") || c
        return ti
      }
      if (c.type === "identifier") return c
    }
    return null
  }

  private allTypeIdentifiers(node: Node): Node[] {
    const out: Node[] = []
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 64) {
      const n = stack.pop()!
      if (n.type === "type_identifier" && n.parent && n.parent.type !== "type_arguments") {
        out.push(n)
      } else if (n.type === "identifier" && n.parent && n.parent.type === "mixins") {
        out.push(n)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private findDescendantByType(node: Node, type: string): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === type) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
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

function scopeOwnerKind(scopes: DartScopeEntry[]): ASTEngine.SymbolKind | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].kind === DartScopeKind.Class) {
      // The scope entry does not carry its kind beyond class-ness; the caller
      // resolves the concrete kind via the last symbol of that name.
      return ASTEngine.SymbolKind.Class
    }
  }
  return undefined
}
