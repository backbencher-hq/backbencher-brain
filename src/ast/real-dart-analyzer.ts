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
    // DARTD12: getter/setter pairs share owner:name — dedup by
    // owner:name:kind so a class with `get value` AND `set value` keeps both
    // symbols (setters carry the value param; the pair collapsed to one
    // Property symbol before).
    const seenMembers = new Set<string>() // owner:name:kind — accessor-pair dedup

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
        t === "switch_statement_case" ||
        t === "switch_expression_case" ||
        t === "catch_clause" ||
        t === "conditional_expression" ||
        t === "logical_and_expression" ||
        t === "logical_or_expression"
      ) {
        cyclomaticComplexity++
      }

      switch (t) {
        case "class_definition": {
          // `class A = Base with M;` is a mixin-application class: the name is
          // an identifier child of the mixin_application_class node (no name
          // field), so fall back to it for the symbol.
          const name = node.childForFieldName("name")?.text ||
            (this.findChildByType(node, "mixin_application_class")
              ? this.findDescendantByType(node, "identifier")?.text
              : undefined)
          if (name) {
            const comments = this.collectComments(node)
            // Dart 3 class modifiers (sealed/base/interface/final): sealed is
            // implicitly abstract (can't be instantiated, only subtyped in
            // the same library); the rest are captured for the symbol model.
            const isSealed = this.hasModifier(node, "sealed")
            const isBase = this.hasModifier(node, "base")
            const isInterfaceClass = this.hasModifier(node, "interface")
            const isFinalClass = this.hasModifier(node, "final")
            const isAbstract = this.hasModifier(node, "abstract") || isSealed
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              isAbstract,
              genericParameters: this.extractTypeParameters(node),
              metadata: { isClass: true, isAbstract, isSealed, isBase, isInterfaceClass, isFinalClass },
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
            // DARTD14: `mixin M on Base implements I` — the on-base is a
            // direct type_identifier child of the mixin_declaration (NOT the
            // name: probed dart-mixin-shape.ts); implements/with reuse the
            // class heritage extractor. Corpus had mixin on-clauses emitting
            // zero heritage edges.
            this.extractClassHeritage(node, name, relationships, patterns)
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
            // DARTD15: enhanced enums carry implements/with heritage like
            // classes (`enum Poly implements Shape`) — same extractor.
            this.extractClassHeritage(node, name, relationships, patterns)
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
          // Local functions (local_function_declaration > lambda_expression >
          // function_signature[name]) are NOT symbols — family contract: no
          // locals (csharp/python/go never emit them; DARTD8). Without this
          // guard their signature hit this case and leaked as top-level
          // Function symbols with an empty scope (counted as duplicate
          // functions across a corpus census).
          if (t === "function_signature" && node.parent?.type === "lambda_expression") break
          const owner = scopeOwnerName(scopeStack)
          // Factories surface as `method_signature > factory_constructor_signature`
          // — dispatch constructors to processConstructor.
          const inner = this.findInnerSignature(node)
          if (owner && this.isConstructorSignature(inner.type)) {
            this.processConstructor(node, inner, owner, symbols, relationships, patterns)
          } else if (owner || t === "function_declaration") {
            this.processFunctionOrMethod(node, node, symbols, scopeStack, patterns, seenMembers)
          } else if (t === "function_signature" || t === "getter_signature" || t === "setter_signature") {
            // top-level function/getter/setter — signature with sibling
            // function_body. Top-level accessors were silently dropped before
            // (no dispatch branch), leaving their calls attributed to a
            // non-declared source (DARTD10 — corpus: translate.dart's
            // `List<String> get _deepLKeys`).
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
        case "static_final_declaration_list": {
          // Top-level variables: the tree-sitter-dart root is `program` (there
          // is no compilation_unit/library_definition wrapper — a library
          // directive is a `library_name` child). Final/const top-level vars
          // live in static_final_declaration_list; var/inferred ones in
          // initialized_identifier_list.
          const parent = node.parent
          if (parent && parent.type === "program") {
            this.processTopLevelVariables(node, symbols, scopeStack)
          }
          break
        }

        case "import_specification":
        case "library_export":
        case "part_directive":
        case "part_of_directive": {
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
    // Deduplicate identical rows: calls/instantiates emit ONE row PER CALL
    // SITE, so N sites of the same callee in one function push N identical
    // (type,source,target,confidence) rows — 192,761 redundant rows across
    // the proxicall corpus (35% of all relationships; icon files carried
    // 1,511 identical `instantiates` rows from 1,512 const fields). The
    // oracle/fixtures are presence-based, so multiplicity is pure payload
    // pollution. Keep the first row per key (first metadata wins) — DARTD7.
    {
      const seenRel = new Set<string>()
      const uniq: ASTEngine.UniversalRelationship[] = []
      for (const r of relationships) {
        const key = `${r.type}|${r.source}|${r.target}|${r.confidence}`
        if (seenRel.has(key)) continue
        seenRel.add(key)
        uniq.push(r)
      }
      relationships.splice(0, relationships.length, ...uniq)
    }
    this.classifyEvidenceTier(relationships)

    // --- Metadata ------------------------------------------------------------
    // DARTD13 (part 2): `P(this.name)` — the constructor_param node carries
    // ONLY the name; its type is the type of the field it initializes. Bind
    // post-pass (O(symbols), no parent scans — DARTD6 lesson): every
    // constructor param still typed `dynamic` resolves against a field of the
    // same name in the owning class. `super.key` and unresolvable names stay
    // `dynamic` (honest no-type).
    {
      const fieldTypeByClass = new Map<string, string>()
      for (const s of symbols) {
        if ((s.metadata ?? {}).isField && s.ownerName) {
          const dt = (s.metadata as any).dataType
          if (dt) fieldTypeByClass.set(`${s.ownerName}.${s.name}`, dt)
        }
      }
      for (const s of symbols) {
        if (s.kind === ASTEngine.SymbolKind.Constructor && s.ownerName) {
          for (const p of s.parameters ?? []) {
            if (p.type === "dynamic") {
              const ft = fieldTypeByClass.get(`${s.ownerName}.${p.name}`)
              if (ft) p.type = ft
            }
          }
        }
      }
    }
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
    const name = this.signatureName(inner)
    if (!name) return
    const owner = scopeOwnerName(scopeStack)
    const isGetter0 = inner.type === "getter_signature"
    const isSetter0 = inner.type === "setter_signature"
    const dedupKey = `${owner ?? "module"}:${name}:${isGetter0 ? "get" : isSetter0 ? "set" : "fn"}`
    if (seenMembers.has(dedupKey)) return
    seenMembers.add(dedupKey)

    const isGetter = isGetter0
    const isSetter = isSetter0
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

    const isAccessor = node.type === "getter_signature" || node.type === "setter_signature"
    symbols.push({
      name,
      kind: isAccessor ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Function,
      range: this.rangeIncludingBody(node, node),
      scope: scopeString(scopeStack),
      visibility: name.startsWith("_") ? "private" : "public",
      parameters: params,
      returnType,
      comments,
      isAsync,
      complexity: this.methodComplexity(node),
      metadata: {
        isAsync,
        isGetter: node.type === "getter_signature",
        isSetter: node.type === "setter_signature",
        isTopLevelFunction: !isAccessor,
        isTopLevelAccessor: isAccessor,
      },
    })
    scopeStack.push({ name, kind: DartScopeKind.Function })
  }

  private processFieldOrVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
  ): void {
    const declList = this.findChildByType(node, "initialized_identifier_list") ||
      this.findChildByType(node, "static_final_declaration_list") ||
      (node.type === "initialized_identifier_list" || node.type === "static_final_declaration_list"
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
    // `part 'x.dart'` (library lists a part) and `part of 'lib.dart'`
    // (part file names its library) are both library-coupling directives —
    // each produces an imports edge so the part graph is visible (ProxiCall
    // has 29 `part of` files, incl. generated freezed output).
    if (node.type === "part_directive" || node.type === "part_of_directive") {
      const uriNode = this.findDescendantByType(node, "string_literal") || this.findDescendantByType(node, "uri")
      const uri = uriNode ? unquote(uriNode.text) : ""
      if (uri) {
        imports.push({ module: uri, source: uri, imported: ["*"], isPart: true, range: this.nodeToRange(node) })
        relationships.push({
          source: moduleName,
          target: `${uri}:*`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          metadata: { isPart: true, isPartOf: node.type === "part_of_directive" },
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
    // DARTD16: the old engine only checked the DIRECT extends base — so a
    // chain (`A extends B extends C`, hello declared on C) emitted nothing,
    // interface implementations (`class X implements Shape { area() }`) —
    // which ARE overrides in Dart — emitted nothing, and cross-file bases
    // (Flutter's `build`, `createState`, `==` — 99.8% of the corpus's 34,306
    // @override sites) emitted nothing because production never passes an
    // overrideCompanion (parseFile callers pass no context). Three passes
    // mirroring the csharp family contract (real-csharp-analyzer.ts
    // resolveOverrides): in-file BFS over ALL heritage (extends + implements
    // + with), cross-file companion when provided, then a deterministic
    // first-heritage-parent fallback for cross-file framework bases.
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of symbols) {
      const list = byName.get(s.name) ?? []
      list.push(s)
      byName.set(s.name, list)
    }
    // Heritage graph from extends/implements/uses edges (in-file knowledge).
    const heritageByClass = new Map<string, string[]>()
    const firstHeritage = new Map<string, string>()
    for (const r of relationships) {
      if (!r.source || !r.target) continue
      const type = r.type ?? r.relationshipType ?? ""
      if (type === "extends" || type === "implements" || type === "uses") {
        const list = heritageByClass.get(r.source) ?? []
        if (!list.includes(r.target)) list.push(r.target)
        heritageByClass.set(r.source, list)
        if (!firstHeritage.has(r.source)) firstHeritage.set(r.source, r.target)
      }
    }
    // Base declares the member? In-file by owner, else companion.
    const declares = (base: string, method: string): boolean => {
      const inFile = byName.get(method)?.some((bm) => bm.ownerName === base) ?? false
      if (inFile) return true
      const companion = overrideCompanion?.get(base)
      return !!companion && companion.has(method)
    }
    const seenOverride = new Set<string>()
    for (const s of symbols) {
      if ((s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Property) && s.ownerName) {
        const heritage = heritageByClass.get(s.ownerName)
        if (!heritage || heritage.length === 0) continue
        // Pass 1: BFS over the full heritage graph (extends/implements/with,
        // transitively) for a base that declares this member IN-FILE.
        let target: string | null = null
        const seenCls = new Set<string>()
        const queue = [...heritage]
        while (queue.length > 0 && !target) {
          const base = queue.shift()!
          if (seenCls.has(base)) continue
          seenCls.add(base)
          if (declares(base, s.name)) {
            target = base
            break
          }
          for (const h of heritageByClass.get(base) ?? []) queue.push(h)
        }
        let confidence = 0.95
        let metadata: Record<string, unknown> = { isOverride: true, relationshipType: "method_override" }
        if (target) {
          // exact in-file resolution
        } else if (overrideCompanion && heritage.length > 0) {
          // Pass 2: cross-file companion declaring-parent resolution.
          const seen2 = new Set<string>()
          const q2 = [...heritage]
          while (q2.length > 0 && !target) {
            const base = q2.shift()!
            if (seen2.has(base)) continue
            seen2.add(base)
            if (this.companionHas(overrideCompanion, base, s.name)) {
              target = base
              break
            }
            for (const h of heritageByClass.get(base) ?? []) q2.push(h)
          }
        }
        if (!target) {
          // Pass 3: deterministic cross-file fallback — the first heritage
          // parent (csharp parity). Flutter methods override StatelessWidget
          // etc.; the base class is real even when declared elsewhere.
          // GATED on the @override annotation: fields (kind Property too)
          // can never override in Dart and carry no annotation — without
          // this gate every field of a subclass faked an external override
          // (`Poly.sides -> Shape.sides`).
          const hasOverrideAnn = (s.decorators ?? []).some((d) => d.includes("@override"))
          if (hasOverrideAnn) {
            target = firstHeritage.get(s.ownerName) ?? null
            confidence = 0.8
            metadata = { isOverride: true, relationshipType: "method_override", isExternalBase: true }
          }
        }
        if (!target) continue
        const key = `${s.ownerName}.${s.name}->${target}.${s.name}`
        if (seenOverride.has(key)) continue
        seenOverride.add(key)
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${target}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence,
          metadata,
        })
      }
    }
  }

  /** Companion lookup with leaf-name fallback (bases may arrive qualified). */
  private companionHas(companion: Map<string, Set<string>>, base: string, method: string): boolean {
    if (companion.get(base)?.has(method)) return true
    const leaf = base.includes(".") ? base.split(".").pop()! : base
    return leaf !== base && !!companion.get(leaf)?.has(method)
  }

  private extractCallRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
  ): void {
    // Current call source = enclosing function/method/constructor leaf name.
    const resolveCurrent = (n: Node, current: string | null): string | null => {
      // Local functions are NOT call contexts (family contract: locals fold
      // into the enclosing function's call set — csharp/python/go parity,
      // DARTD8). tree-sitter-dart: local_function_declaration >
      // lambda_expression > function_signature[name] — the signature's only
      // lambda parent is that wrapper, so returning `current` keeps the
      // enclosing function as source for calls inside the local body.
      if (n.type === "function_signature" && n.parent?.type === "lambda_expression") {
        return current
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
        const nm = this.signatureName(inner)
        if (nm) return nm
      }
      return current
    }

    // Enclosing CLASS/MIXIN/ENUM/EXTENSION for non-function contexts: field
    // initializers and annotation arguments carry no function context, but
    // their constructions belong to the owning type, NOT the module/file name
    // (csharp parity: parentContext?.rawName || "global" — DARTD9). Without
    // this, every const field initializer of a big icon class attributed its
    // instantiates to the file basename.
    const resolveOwner = (n: Node, owner: string | null): string | null => {
      const t = n.type
      if (t === "class_definition" || t === "enum_declaration") {
        const nm = n.childForFieldName?.("name")?.text
        return nm || owner
      }
      if (t === "extension_declaration") {
        const nm = n.childForFieldName?.("name")?.text || this.extensionTargetType(n)
        return nm || owner
      }
      if (t === "mixin_declaration") {
        // mixin name is a direct identifier child (no name field)
        const id = this.findChildByType(n, "identifier")
        return id ? id.text : owner
      }
      return owner
    }

    const processNode = (n: Node, current: string | null, owner: string | null): void => {
      const prev = current
      const prevOwner = owner
      const t = n.type
      current = resolveCurrent(n, current)
      owner = resolveOwner(n, owner)
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
      const callSource = current || owner || moduleName

      // Constructor invocation: `List<int>.filled(3, 0)` → instantiates List.
      // `new Foo()` parses as new_expression and `const Foo()` as
      // const_object_expression — both are explicit constructor invocations
      // with a type_identifier child and construction args (the dart wave
      // differential oracle surfaced them as MISSING before this branch).
      if (t === "constructor_invocation" || t === "new_expression" || t === "const_object_expression") {
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

      // cascade calls: `list.add(1)..remove(2)` → calls remove/clear.
      // DARTD17: `b..a.b.c(1)` — the cascade_selector names only the FIRST
      // segment (`a`); the deeper chain lives in nested
      // unconditional_assignable_selector children (probed cascade-shape.ts).
      // The true leaf is the LAST identifier in the section that has args.
      if (t === "cascade_section") {
        const sel = this.findChildByType(n, "cascade_selector")
        const hasArgs = this.findChildByType(n, "argument_part")
        if (sel && hasArgs) {
          // Callee chain = identifiers in selector children ONLY — skipping
          // argument_part keeps call arguments (`b..foo(a.bar)`) out.
          let mname: string | null = null
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || c.type === "cascade_selector" || c.type === "argument_part") {
              if (c && c.type === "cascade_selector") {
                const id = this.lastIdentifier(c)
                if (id) mname = id
              }
              continue
            }
            const id = this.lastIdentifier(c)
            if (id) mname = id
          }
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
        if (child) processNode(child, current, owner)
      }

      current = prev
      owner = prevOwner
    }

    processNode(node, null, null)
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
    // Mixin application class: `class A = Base with M;` — the base + mixins
    // live in a mixin_application node (no superclass node). The base is
    // `extends`, the with-clause mixins are `uses`.
    const mixinAppCls = this.findChildByType(node, "mixin_application_class")
    if (mixinAppCls) {
      const app = this.findChildByType(mixinAppCls, "mixin_application")
      if (app) {
        const base = this.resolvedHeritageNames(app)[0] ?? null
        if (base) {
          relationships.push({
            source: className,
            target: base,
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            metadata: {},
          })
        }
        const mx = this.findChildByType(app, "mixins")
        if (mx) {
          patterns["Mixins"] = true
          for (const ti of this.allTypeIdentifiers(mx)) {
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
    }

    // DARTD14: mixin `on`-base — `mixin M on Base implements I` parses the
    // on-base as a DIRECT type_identifier child of mixin_declaration (probed
    // dart-mixin-shape.ts: [mixin, identifier, type_identifier, interfaces]).
    // The superclass/interfaces branches below never see it.
    if (node.type === "mixin_declaration") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "type_identifier") {
          relationships.push({
            source: className,
            target: c.text,
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            metadata: { isMixinOn: true },
          })
          break
        }
      }
    }

    // superclass: `extends X with M1, M2` — the resolved base is the first
    // RESOLVED heritage name (DAD1: the first raw type_identifier is often an
    // import-alias prefix); the `mixins` child carries the with-clause.
    const superclass = this.findChildByType(node, "superclass")
    if (superclass) {
      const base = this.resolvedHeritageNames(superclass)[0] ?? null
      if (base) {
        relationships.push({
          source: className,
          target: base,
          type: ASTEngine.RelationshipType.Extends,
          confidence: 1.0,
          metadata: {},
        })
      }
    }
    // interfaces: `implements A, B<C>` — resolved names only (DAD2: alias
    // prefixes `_i2.Database` must not emit `_i2` as an interface target).
    const interfaces = this.findChildByType(node, "interfaces")
    if (interfaces) {
      for (const ti of this.resolvedHeritageNames(interfaces)) {
        relationships.push({
          source: className,
          target: ti,
          type: ASTEngine.RelationshipType.Implements,
          confidence: 1.0,
          metadata: { isImplements: true },
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
  // EVIDENCE TIERS
  // ============================================================================

  /**
   * Evidence-tier classification (family contract — mirrors csharp/java/rust;
   * M14 section D requires >=2 distinct evidenceClass values). Same rules as
   * the managed-OO family: structural (grammar clauses, conf 1.0) |
   * usage_contextual (calls, mixin uses) | import_based (import/export/part
   * directives) | inferred (confidence < 1 edges).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "imports" || type === "exports") { md.evidenceClass = "import_based"; continue }
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
    return prev.type === "identifier" || prev.type === "type_identifier"
  }

  private resolveSelectorCallee(selector: Node): string | null {
    const prev = selector.previousNamedSibling
    if (!prev) return null
    if (prev.type === "unconditional_assignable_selector" || prev.type === "conditional_assignable_selector" ||
        prev.type === "selector") {
      // obj.method(...) / Future.delayed(...) / super.toString()
      const inner = this.findChildByType(prev, "identifier")
      if (inner) return inner.text
      // nested selector chain (e.g. a.b.c()) — last identifier wins
      const chain = this.lastIdentifier(prev)
      return chain
    }
    if (prev.type === "identifier" || prev.type === "type_identifier") {
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
      type === "constant_constructor_signature" || type === "redirecting_factory_constructor_signature" ||
      type === "operator_signature"
    )
  }

  private isConstructorSignature(type: string): boolean {
    return (
      type === "constructor_signature" || type === "factory_constructor_signature" ||
      type === "constant_constructor_signature" || type === "redirecting_factory_constructor_signature"
    )
  }

  private signatureName(inner: Node): string | null {
    const nameNode = inner.childForFieldName("name")
    if (nameNode) return nameNode.text
    // Operator overloads (`Vec operator +(Vec other)`) carry the operator
    // token as the 3rd child of operator_signature (return type, `operator`
    // keyword, token, parameters) — no name field, no identifier.
    if (inner.type === "operator_signature") {
      const opTok = inner.childCount >= 3 ? inner.child(2) : null
      return opTok ? `operator ${opTok.text}` : null
    }
    const id = this.findChildByType(inner, "identifier")
    return id ? id.text : null
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
    // Modifiers may live on the parent `declaration` wrapper (class fields:
    // `declaration > static_final_declaration_list` carries static/final
    // tokens on the declaration). ONLY scan a declaration wrapper — scanning
    // an arbitrary parent like class_body (thousands of sibling members)
    // made per-member modifier checks O(class)² on large files.
    if (node.parent && node.parent.type === "declaration") {
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
        n.type === "formal_parameter" || n.type === "constructor_param" || n.type === "typed_identifier"
      ) {
        const nameNode = n.childForFieldName("name") || this.findChildByType(n, "identifier")
        if (nameNode && nameNode.text !== "this" && nameNode.text !== "super") {
          // DARTD13: tree-sitter-dart has NO `type` field on formal_parameter
          // (probed dart-param-children.ts) — the old childForFieldName("type")
          // never matched, so EVERY typed param degraded to `dynamic` (8,094
          // in the corpus census). The type is a leading child BEFORE the name:
          // type_identifier (`int x`), function_type (`void Function() cb`),
          // or nullable_type suffix (`int? x` → type_identifier + nullable_type).
          // The name identifier is always LAST; type children precede it.
          let typeText: string | undefined
          if (n.type === "typed_identifier") {
            typeText = this.firstTypeIdentifier(n, false)?.text
          } else {
            const kids: Node[] = []
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) kids.push(c)
            }
            const nameIdx = kids.findIndex((c) =>
              // web-tree-sitter creates a NEW wrapper object per access, so
              // reference equality always fails (same trap extractReturnType's
              // KAD2 sweep fixed) — compare byte spans.
              nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex,
            )
            for (let i = 0; i < nameIdx; i++) {
              const c = kids[i]
              if (c.type === "type_identifier" || c.type === "function_type" ||
                  c.type === "nullable_type" || c.type === "void_type") {
                typeText = c.text
                break
              }
            }
          }
          // Named vs positional-optional: the grammar wraps BOTH `{...}` and
          // `[...]` parameter groups in optional_formal_parameters — the
          // distinction is the container's opening bracket (`{` = named,
          // `[` = positional). `this.id` / `super.key` constructor params sit
          // under a formal_parameter wrapper, so walk ancestors to find the
          // group. Default values are sibling literals.
          let group: Node | undefined
          let p: Node | null = n.parent
          while (p && p.type !== "optional_formal_parameters") p = p.parent
          if (p && p.type === "optional_formal_parameters") group = p
          const isNamed = group ? group.text.startsWith("{") : false
          const isOptional = group !== undefined
          const hasDefault = n.text.includes("=")
          const already = out.some((p) => p.name === nameNode.text)
          if (!already) out.push({ name: nameNode.text, type: typeText ?? "dynamic", isOptional, isNamed })
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
    // first type_identifier BEFORE the name field — span-based stop (KAD2
    // sweep: `c === nameNode` never matched fresh wrappers, so the scan
    // ran past the name and could return the return-type... or a type
    // AFTER the name) — positional stop restores the intended "before the
    // name" semantics deterministically.
    const nameNode = node.childForFieldName("name")
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex) break
      if (c.type === "type_identifier" || c.type === "void_type") return c.text
    }
    return undefined
  }

  private extractFieldType(node: Node, declList: Node): string | undefined {
    // Field/variable type: a type-ish DIRECT child of the declaration or its
    // decl list. Dart puts the explicit type in front of the list
    // (`declaration > [const_builtin, type_identifier, <list>]` — probed
    // dart-typedecl-shapes.ts). Inferred fields (`static const x = Ctor(...)`)
    // carry NO type node at all → undefined is correct. NEVER scan ancestors:
    // the old parent fallback iterated every class_body member per field —
    // O(class)², 13.6 s on phosphor_icons_regular.dart (1,512 fields × 3k-
    // member scan per field). Same trap hasModifier documents and avoids;
    // a bound is not needed since direct-child scans are O(1) per field.
    const candidates: Node[] = [node, declList]
    for (const cand of candidates) {
      for (let i = 0; i < cand.namedChildCount; i++) {
        const c = cand.namedChild(i)
        if (!c) continue
        if (c.type === "type_identifier" || c.type === "void_type") {
          return c.text
        }
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
      if (c.type === "type_identifier" || c.type === "void_type") {
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
      if (prev.type === "annotation") {
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
      } else if (sibling.type === "annotation") {
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
    // The method BODY is a sibling of the signature node (tree-sitter-dart:
    // `method_signature`/`function_signature` then a following `function_body`
    // or `function_expression_body` inside class_body/program), so walk both
    // the node and its next named sibling(s) — otherwise per-method
    // cyclomatic complexity never counts branches inside the body.
    const stack: Node[] = [node]
    let sib: Node | null = node.nextNamedSibling
    let guard = 0
    while (sib && guard++ < 8) {
      if (sib.type === "function_body" || sib.type === "block" || sib.type === "function_expression_body") {
        stack.push(sib)
        break
      }
      if (sib.type === "class_body" || sib.type === "extension_body" || sib.type === "}" || sib.type === "declaration" || sib.type === "method_signature" || sib.type === "function_signature") break
      sib = sib.nextNamedSibling
    }
    guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" || n.type === "for_statement" || n.type === "while_statement" ||
        n.type === "do_statement" || n.type === "switch_statement_case" || n.type === "switch_expression_case" ||
        n.type === "catch_clause" || n.type === "conditional_expression" || n.type === "logical_and_expression" || n.type === "logical_or_expression"
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
      if (c.type === "type_identifier") {
        return c
      }
      if (c.type === "identifier") return c
    }
    return null
  }

  /**
   * Resolved heritage names (DAD1/DAD2 contract): the real class names from a
   * heritage clause, with import-alias prefixes dropped and generic arguments
   * excluded.
   *
   * tree-sitter-dart parses a qualified supertype FLAT: `extends _i1.SmartFake`
   * is superclass > [_i1, `.`, SmartFake] — adjacent type_identifiers joined by
   * an anonymous `.` token where the FIRST is the import-alias container, not a
   * class name (the mocktail shape: `class _FakeX_0 extends _i1.SmartFake
   * implements _i2.Database`). Taking the first raw identifier named the base
   * after the alias (DAD1); enumerating all type_identifiers leaked the alias
   * into implements targets (DAD2).
   *
   * Rule over RAW children (anonymous tokens carry the disambiguation):
   * keep type_identifier/identifier nodes whose next raw sibling is NOT a `.`
   * token — a `.` means this name is an alias prefix; `,` or end-of-clause or
   * type_arguments means it is a real name. type_arguments are generic
   * arguments, never bases; mixins are handled separately as `uses`.
   * Probed shapes (dart-heritage-shapes.ts, 2026-09-03):
   *   `_i1.SmartFake`            -> [SmartFake]
   *   `Alpha, Beta`              -> [Alpha, Beta]
   *   `_i2.Database, _i3.Future` -> [Database, Future]
   *   `generics.Map<String, int>`-> [Map]
   */
  private resolvedHeritageNames(node: Node): string[] {
    const out: string[] = []
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "type_arguments" || c.type === "mixins") continue
      if (c.type !== "type_identifier" && c.type !== "identifier") continue
      const next = node.child(i + 1)
      if (next && next.type === ".") continue // alias prefix: `A.B` keeps B
      out.push(c.text)
    }
    return out
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
