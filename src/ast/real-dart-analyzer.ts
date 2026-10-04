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

/**
 * Dart's implicit `dynamic` — a TYPE NAME the analyzer publishes under
 * `parameters[].type`, NOT a grammar node type.
 *
 * Named rather than written inline because the F1 grammar audit reads every
 * `X.type === "lit"` as a node-type reference (`isTypeComparison`), so the
 * inline comparison was reported as `unknownNodeTypes: ["dynamic"]` on this
 * lane for a literal the grammar is never asked about. The reference is honest
 * about what it is now; the audit is not being taught to skip anything.
 */
const IMPLICIT_DYNAMIC_TYPE = "dynamic"

/**
 * Positions where a `type_identifier` is a type mention the analyzer has ALREADY
 * published under another label, plus the one position where it is not a mention
 * of a type at all.
 *
 * Every entry is here because publishing it a second time would DOUBLE-COUNT one
 * fact under two labels, or claim a mention that the source does not make. The
 * inventory that produced this list is measured, not recalled —
 * `validation/m14/fixtures/dart/type-position-probe.ts` walks the same corpus and
 * prints the parent-position histogram; `collectTypeMention` carries the reason
 * for each group.
 */
const DART_TYPE_MENTION_DOUBLE_COUNTED = new Set<string>([
  // heritage — `extends` / `implements` / `with` (extractClassHeritage)
  "superclass", "interfaces", "mixins",
  // a mixin `on`-base is an `extends` edge (DARTD14), and a mixin-application
  // class publishes its base and its with-list through the same extractor
  "mixin_declaration", "mixin_application",
  // construction is `instantiates`
  "new_expression", "const_object_expression", "constructor_invocation",
  "redirecting_factory_constructor_signature",
  // `class Box<T>` DECLARES a type variable; it does not mention a type
  "type_parameter",
  // parse damage: not a fact about a well-formed program
  "ERROR",
])

/**
 * M60 rule R7 — no relationship endpoint may be the placeholder literal
 * `unknown`.
 *
 * MEASURED, analyzer-side, and reproducible with `BB_DART_CONC=1` — the census is
 * deterministic only at concurrency 1, for the reason its own header records:
 *
 *   BEFORE (`git show HEAD:src/ast/real-dart-analyzer.ts`):
 *     all 2,351 tracked `.dart` files of `proxicall` — **239** rows carry the literal
 *       as an endpoint: 154 `uses`, 68 `contains`, 17 `calls`.
 *     the 2,735-file sample across 5 repositories this lane's census uses — **106**
 *       rows: 85 `uses`, 19 `contains`, 2 `calls`.
 *   AFTER (this filter in place), the same two runs: **0** and **0**.
 *   `symbolsNamedUnknown 0` in both AFTER runs: no sampled file publishes a symbol
 *   named `unknown`, because `src/ast/pool-worker.ts` `keepSymbol`'s UNIVERSAL
 *   denylist rejects the name for every language. So every one of those rows was an
 *   endpoint NOTHING COULD BIND.
 *
 * Those 106 rows moved the published relationship total by 104 rather than 106: the
 * filter shares its loop with the dedup, and two of the 85 `uses` rows were
 * duplicates the dedup was already discarding. Both numbers are stated because a
 * reader who subtracts one from the other should find that difference rather than
 * trip on it.
 *
 * The shape is one construction, and it is common:
 *
 *   `ApiError.unknown('Data transformation failed: $e')`
 *
 * The selector chain reduces to its leaf, the leaf of a constructor call on a
 * capitalized type is the named constructor's segment, and the segment happens to
 * be the word `unknown`. The published edge read `map calls unknown`, i.e. a
 * symbol named `unknown` that no file in the corpus contains, colliding with the
 * pipeline's own "no target" sentinel.
 *
 * The alternative was to publish `map calls ApiError`, which is a different claim
 * and a false one — a call is not a call OF the type. The third alternative,
 * `instantiates ApiError`, is the shape `DT-A` trusts only for an IN-FILE named
 * constructor, and widening that to a cross-file guess would put edges in the graph
 * that the oracle does not derive and that nothing can check.
 *
 * So the edge goes. That is R7's own instruction: when a fallback has nothing
 * truthful to say, the honest state is ABSENCE and not the string `unknown`. The
 * cost is declared rather than assumed — a Dart declaration literally named
 * `unknown` loses its edge, and `proxicall/lib/models/nms/user_segment.dart`
 * declares exactly one (an enum constant, `enum SegmentType { …, unknown, … }`),
 * so the price is measured and non-zero: one declaration, and it published no edge
 * to it before the filter either.
 */
const R7_PLACEHOLDER_NAME = "unknown"

/**
 * The members `Object` declares, and therefore the members EVERY Dart class's
 * interface contains whether or not the class mentions them.
 *
 * Dart has no other root: every class implicitly extends `Object`, so
 * `toString`, `hashCode`, `runtimeType`, `noSuchMethod` and `operator ==` are
 * reachable from every type in the language. That makes this set the one place
 * where an override target can be named WITHOUT knowing the base's own file, and
 * `extractOverrideRelationships` uses it for exactly that. Measured against the
 * Dart SDK's own sources (`dart-sdk/sdk/lib/core/object.dart`, parsed through the
 * production entry point): `Object.toString`, `Object.hashCode`,
 * `Object.runtimeType`, `Object.noSuchMethod` and `Object.operator ==` are all
 * published declarations there.
 */
const DART_OBJECT_TYPE = "Object"
const DART_OBJECT_INTERFACE_MEMBERS = new Set<string>([
  "toString", "hashCode", "runtimeType", "noSuchMethod", "operator ==",
])



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

/**
 * The inheritance-closed member set for every type in a `ProjectIndex`, derived ONCE
 * per index and shared by every file.
 *
 * `extractOverrideRelationships` runs per file, so deriving this inside it rebuilds
 * the whole closure for each file: on ProxiCall/lib with `--dart-deps=direct` that is
 * 13,846 types re-closed 2,351 times, and the differential stopped completing inside
 * two hours. Memoised on the index object with a WeakMap, so the cost is paid once per
 * run and a garbage-collected index takes its companion with it.
 *
 * The closure is what makes the two resolution paths agree — see the `exposed` comment
 * in `extractOverrideRelationships` — so it is the one piece of cross-file state this
 * analyzer holds, and holding it per-index rather than per-file is the difference
 * between a lane that runs and a lane that does not.
 */
const DARt_COMPANION_CACHE = new WeakMap<object, Map<string, Set<string>>>()

function dartCompanionFor(projectIndex: any): Map<string, Set<string>> | undefined {
  if (!projectIndex?.typeMembers) return undefined
  const key = projectIndex as object
  const hit = DARt_COMPANION_CACHE.get(key)
  if (hit) return hit
  const out = new Map<string, Set<string>>()
  const closure = (t: string, seen: Set<string>): Set<string> => {
    const cached = out.get(t)
    if (cached) return cached
    // A cycle in the type graph must terminate with "nothing known", not hang.
    if (seen.has(t)) return new Set<string>()
    seen.add(t)
    const members = new Set<string>(projectIndex.typeMembers.get(t) ?? [])
    for (const b of projectIndex.typeBases?.get(t) ?? []) for (const m of closure(b, seen)) members.add(m)
    out.set(t, members)
    return members
  }
  for (const t of projectIndex.typeKinds?.keys() ?? []) closure(t, new Set())
  DARt_COMPANION_CACHE.set(key, out)
  return out
}

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
    // owner:name:kind -> index in `symbols`. The accessor-pair dedup (DARTD12)
    // AND the duplicate-declaration ruling (#753/DARTD20) both live here, so the
    // value is the slot the LAST declaration of a name must replace.
    const seenMembers = new Map<string, number>()
    // M60 line contract, SYMBOL side: `contains`/`overrides` name the DECLARED
    // member, and a WRAPPED declaration puts the name on a later line than the
    // declaration's start — `final void Function(UrlRequest? u,\n    String? s)\n        _onSucceeded;` (cronet_http jni_bindings.dart). MEASURED before
    // this map: 148 of 32,016 edges on a 120-file draw claimed the start line,
    // i.e. a line the named token is not written on. Keyed by name+range
    // because one declaration node can carry several names (`int a = 1, b = 2`).
    const nameLines = new Map<string, number>()

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

        case "extension_type_declaration": {
          // Dart 3 EXTENSION TYPES (`extension type X._(objc.ObjCObject o)
          // implements I`) — registered as MISSING in the lane's own spec
          // (script/m14/spec/dart-completeness.json: "Dart 3 extension type
          // symbols", node_type "extension_type_declaration,
          // representation_declaration") and recorded by the M60 shape census
          // as UNSCANNED (validation/m60/results/unscanned-shapes.json, 169
          // occurrences). The #753 duplicate census over the FULL extent found
          // it independently: 303 declarations in 4 pinned dart-http files
          // (jni/objc bindings), whose members were emitted as TOP-LEVEL
          // symbols with no owner — no `contains`, no heritage, no enclosing
          // type for a call. Probed shape (dt-exttype-shape.ts):
          //   extension_type_declaration
          //     identifier [field=name]  <- the container name
          //     representation_declaration > identifier [field=name] <- field
          //     interfaces               <- heritage (same clause as a class)
          //     class_body [field=body]  <- members
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            const rep = this.findChildByType(node, "representation_declaration")
            const repType = this.representationTypeName(rep)
            patterns["Extensions"] = true
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Extension,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isExtension: true, isExtensionType: true, representationType: repType },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })
            // the REPRESENTATION FIELD is a real member accessor of the type
            // (`X(T field)` exposes `field`), so it joins the symbol table and
            // gets a `contains` edge like any other declared member.
            const repName = rep?.childForFieldName("name")?.text
            if (rep && repName && repName !== "_") {
              const repRange = this.nodeToRange(rep)
              // M60 line contract, FIELD side: the `contains X -> field` edge
              // NAMES the field, and a wrapped representation declaration
              // (`X._(\n  ffi.Pointer<…> _$this,\n) implements …`, the pinned
              // FFI bindings' shape) puts the name on a later line than the
              // declaration's start. The lane's own consistency probe caught
              // exactly this as its ONLY inconsistent edge out of 32,989
              // (`UrlRequestCallbackProxy$…::_$this` claimed line 42, the
              // container line). The symbol keeps the declaration SPAN; the
              // edge takes the NAME's line, like every other member.
              const repNameNode = rep.childForFieldName("name")
              if (repNameNode) nameLines.set(dartNameLineKey(repName, repRange), this.nodeLine(repNameNode)!)
              symbols.push({
                name: repName,
                kind: ASTEngine.SymbolKind.Property,
                range: repRange,
                scope: name,
                ownerName: name,
                ownerKind: ASTEngine.SymbolKind.Extension,
                visibility: repName.startsWith("_") ? "private" : "public",
                metadata: { isRepresentationField: true, dataType: repType },
              })
            }
            this.extractClassHeritage(node, name, relationships, patterns)
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
              this.processFunctionOrMethod(node, sig, symbols, scopeStack, patterns, seenMembers, nameLines)
            }
          } else {
            // field / top-level variable declaration
            this.processFieldOrVariable(node, symbols, scopeStack, nameLines)
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
          // DARTD20 (#753): the INNER signature of a `method_signature`
          // wrapper is processed by the WRAPPER's own visit (which digs to
          // `findInnerSignature`), so visiting it again here built a SECOND
          // symbol for the same member — and a worse one: the inner node has
          // no body SIBLING (complexity collapsed to 1) and no annotation
          // sibling (`@override` was never attached). The FIRST-wins dedup
          // this lane used to have hid that duplicate; the family ruling's
          // LAST-wins (registerCallable) exposed it, which is how it was
          // found: `dart/payload-and-complexity` and
          // `dart/dedup-and-attribution` failed the moment the ruling
          // landed. Same rule as the `declaration` guard above.
          if (node.parent?.type === "method_signature") break
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
            this.processFunctionOrMethod(node, node, symbols, scopeStack, patterns, seenMembers, nameLines)
          } else if (t === "function_signature" || t === "getter_signature" || t === "setter_signature") {
            // top-level function/getter/setter — signature with sibling
            // function_body. Top-level accessors were silently dropped before
            // (no dispatch branch), leaving their calls attributed to a
            // non-declared source (DARTD10 — corpus: translate.dart's
            // `List<String> get _deepLKeys`).
            this.processTopLevelFunction(node, symbols, scopeStack, patterns, nameLines, seenMembers)
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
            this.processTopLevelVariables(node, symbols, scopeStack, nameLines)
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
    this.addContainmentRelationships(symbols, relationships, nameLines)
    this.extractOverrideRelationships(symbols, relationships, context?.overrideCompanion, nameLines, (context as any)?.projectIndex)
    this.extractExpressionRelationships(rootNode, relationships, moduleName, symbols, (context as any)?.projectIndex)
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
        // M60 R7, in the one pass that already rewrites the row list. See
        // R7_PLACEHOLDER_NAME for the measurement and for what the alternatives
        // would have claimed.
        if (
          r.source === R7_PLACEHOLDER_NAME || r.target === R7_PLACEHOLDER_NAME ||
          (r as any).from === R7_PLACEHOLDER_NAME || (r as any).to === R7_PLACEHOLDER_NAME
        ) continue
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
            if (p.type === IMPLICIT_DYNAMIC_TYPE) {
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
      // DT-C: the redirect target may be alias-qualified
      // (`= _i1.Impl.make` — the raw first type_identifier is the import
      // alias, not the class). Collect the qualified name AFTER the `=`
      // token only (parameters precede it and carry their own identifiers).
      // Parts: [Class, ctor] or [alias, Class, ctor] — the class is
      // second-to-last (singletons like `= _$Y` stay whole).
      const parts: string[] = []
      // M60 line contract: the node that NAMES the redirect edge is the
      // redirect target identifier itself (`= A.B` written on a later line
      // than the `factory` keyword).
      const partNodes: Node[] = []
      let pastEquals = false
      for (let i = 0; i < sig.childCount; i++) {
        const c = sig.child(i)
        if (!c) continue
        if (!pastEquals) {
          if (!c.isNamed && c.type === "=") pastEquals = true
          continue
        }
        if (c.isNamed && (c.type === "type_identifier" || c.type === "identifier")) {
          parts.push(c.text)
          partNodes.push(c)
        }
      }
      const redirectTarget = parts.length <= 1 ? parts[0] : parts[parts.length - 2]
      const redirectNode = partNodes.length <= 1 ? partNodes[0] : partNodes[partNodes.length - 2]
      if (redirectTarget) {
        relationships.push({
          source: owner,
          target: redirectTarget,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.95,
          line_number: this.nodeLine(redirectNode),
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
    seenMembers: Map<string, number>,
    nameLines: Map<string, number>,
  ): void {
    // Dig through method_signature wrappers to the inner getter/setter/function
    // signature which carries the name field.
    const inner = this.findInnerSignature(sig)
    const nameNode = this.signatureNameNode(inner)
    const name = this.signatureName(inner)
    if (!name) return
    const owner = scopeOwnerName(scopeStack)
    const isGetter0 = inner.type === "getter_signature"
    const isSetter0 = inner.type === "setter_signature"
    const dedupKey = `${owner ?? "module"}:${name}:${isGetter0 ? "get" : isSetter0 ? "set" : "fn"}`
    // DARTD20 (#753, the family dup-key ruling): one scope declaring the same
    // member twice is INVALID Dart (a compile error), so no compiling program
    // reaches the shape — the analyzer's answer is a DETERMINISTIC family
    // contract. dart kept the FIRST body (the symbol's range, parameters,
    // return type, comments and `contains` line all described the declaration
    // that does not run). The family matrix this was registered against is
    // settled by python's #748, measured on 512 pinned files: 21 of the 25
    // duplicate-name scopes were declaration CHAINS, 3 were branch
    // ALTERNATIVES, exactly ONE was a genuine rebinding — and the language's
    // own answer there was LAST-WINS. Same here (see registerCallable).

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
    // Replace IN PLACE when the scope already declared this name: the symbol
    // table keeps exactly one entry per (owner,name,kind), and it is the
    // declaration that RUNS (registerCallable).
    if (!this.registerCallable(symbols, seenMembers, dedupKey, symbol, nameLines, nameNode)) return

    scopeStack.push({ name, kind: DartScopeKind.Function })
  }

  /**
   * One symbol per (scope,name,kind), LAST declaration wins (DARTD20 — the
   * family dup-key ruling; #753). Both producers of callable symbols use this:
   * a duplicate is a compile error in Dart, so the analyzer's answer for the
   * shape is a deterministic contract, and the family's (settled by python
   * #748) is that the LAST declaration owns the name. Returns false when the
   * symbol REPLACED an earlier one, so the caller can skip its scope push.
   */
  private registerCallable(
    symbols: ASTEngine.UniversalSymbol[],
    seenMembers: Map<string, number>,
    dedupKey: string,
    symbol: ASTEngine.UniversalSymbol,
    nameLines: Map<string, number>,
    nameNode: Node | null,
  ): boolean {
    if (nameNode) nameLines.set(dartNameLineKey(symbol.name, symbol.range), this.nodeLine(nameNode)!)
    const priorIdx = seenMembers.get(dedupKey)
    if (priorIdx !== undefined) {
      symbols[priorIdx] = symbol
      return false
    }
    seenMembers.set(dedupKey, symbols.length)
    symbols.push(symbol)
    return true
  }

  private processTopLevelFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    patterns: Record<string, boolean>,
    nameLines: Map<string, number>,
    seenMembers: Map<string, number>,
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
    const range = this.rangeIncludingBody(node, node)
    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: isAccessor ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Function,
      range,
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
    }
    // #753 (program scope): the duplicate census over the FULL extent found 15
    // genuine duplicate TOP-LEVEL callables in the pinned corpora (test-file
    // helpers in proxicall and http2) — dart emitted BOTH symbols for those,
    // which is the same defect one scope up. Same ruling, same helper.
    const accessorKind = node.type === "getter_signature" ? "get" : node.type === "setter_signature" ? "set" : "fn"
    if (!this.registerCallable(symbols, seenMembers, `module:${name}:${accessorKind}`, symbol, nameLines, nameNode)) return
    scopeStack.push({ name, kind: DartScopeKind.Function })
  }

  private processFieldOrVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    nameLines: Map<string, number>,
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
    const declRange = this.nodeToRange(node)

    for (let i = 0; i < declList.namedChildCount; i++) {
      const child = declList.namedChild(i)
      if (!child) continue
      let name: string | undefined
      let nameNode: Node | null = null
      if (child.type === "initialized_identifier" || child.type === "static_final_declaration") {
        nameNode = this.findChildByType(child, "identifier")
        name = nameNode?.text
      } else if (child.type === "identifier") {
        name = child.text
        nameNode = child
      }
      if (!name) continue
      nameLines.set(dartNameLineKey(name, declRange), this.nodeLine(nameNode ?? child)!)

      const kind =
        owner
          ? ASTEngine.SymbolKind.Property
          : isConst || isFinal
            ? ASTEngine.SymbolKind.Constant
            : ASTEngine.SymbolKind.Variable

      symbols.push({
        name,
        kind,
        range: declRange,
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
    nameLines: Map<string, number>,
  ): void {
    const isFinal = this.hasModifier(node, "final") || this.hasModifier(node.parent!, "final")
    const isConst = this.hasModifier(node, "const") || this.hasModifier(node.parent!, "const")
    const dataType = this.extractFieldType(node, node)
    const declRange = this.nodeToRange(node)

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      let name: string | undefined
      let nameNode: Node | null = null
      if (child.type === "initialized_identifier" || child.type === "static_final_declaration") {
        nameNode = this.findChildByType(child, "identifier")
        name = nameNode?.text
      } else if (child.type === "identifier") {
        name = child.text
        nameNode = child
      }
      if (!name) continue
      nameLines.set(dartNameLineKey(name, declRange), this.nodeLine(nameNode ?? child)!)
      symbols.push({
        name,
        kind: isConst || isFinal ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
        range: declRange,
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
          line_number: this.nodeLine(uriNode),
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
      // M49 exports invariant: `export 'uri.dart' show X` re-exports a FILE,
      // not a bindable name — the uri is a module path (relationship target
      // below already carries it), never a resolvable export entry. Exported
      // BINDINGS (`export 'x.dart' show Alpha` binds Alpha) belong in the
      // export list; the bare uri does not. Dropping the uri push leaves the
      // Exports relationship intact.
      // exports.push({ name: uri, isDefault: false, range: this.nodeToRange(node) })
      relationships.push({
        source: moduleName,
        target: uri,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        line_number: this.nodeLine(uriNode),
        metadata: {},
      })
    } else {
      imports.push({ module: uri, source: uri, imported: ["*"], isTypeOnly: false, range: this.nodeToRange(node) })
      relationships.push({
        source: moduleName,
        target: `${uri}:*`,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1.0,
        line_number: this.nodeLine(uriNode),
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
    nameLines: Map<string, number>,
  ): void {
    for (const symbol of symbols) {
      if (symbol.ownerName) {
        relationships.push({
          source: symbol.ownerName,
          target: symbol.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // The member's OWN NAME line — the name node when the producers could
          // hand one over (a wrapped declaration moves it off the start line),
          // the declaration start otherwise (php stamps contains the same way).
          line_number: nameLines.get(dartNameLineKey(symbol.name, symbol.range)) ?? symbol.range?.startLine,
          metadata: {},
        })
      }
    }
  }

  private extractOverrideRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    overrideCompanion?: Map<string, Set<string>>,
    nameLines?: Map<string, number>,
    // LAST, and it must stay last: this parameter was added after `nameLines`, and
    // inserting it earlier silently swapped the two — `nameLines` landed in this
    // slot, the name-line lookup started returning undefined, and every override
    // edge fell back to the declaration's START line (the return type) instead of
    // the signature's line. `dart/callsite-lines-825` caught it, pinning exactly
    // that distinction. Optional parameters with different types are the worst kind
    // of reorder: it compiles, it type-checks, and it is silently wrong.
    projectIndex?: any,
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
    const companionForPass2: Map<string, Set<string>> | undefined =
      overrideCompanion ?? dartCompanionFor(projectIndex)

  // DARTD16's cross-file pass is implemented, documented, and — until now —
  // unreachable: `overrideCompanion` is an OPTIONAL context field that no caller in
  // src/ or script/ ever populated, so Pass 2 was dead code. The repo already ships
  // the cross-file knowledge this needs, in `ProjectIndex` (`typeMembers`,
  // `typeBases`) and `buildResolutionTables`, which the Solidity lane reads for the
  // same reason. Deriving the companion from it here is additive: with no
  // `projectIndex` in context the field is undefined and every pass below behaves
  // exactly as before, byte for byte.
  //
  // `allMembers` is INHERITANCE-CLOSED, which is the semantics Pass 2 wants: it
  // answers "does this base expose the member", not "does it declare it". That is
  // also why it settles the freezed family. `sealed class TemplateState extends
  // Equatable` does not declare `props` but does expose it, so
  // `TemplateInitial.props` resolves against TemplateState — the nearest base whose
  // interface the member actually replaces — instead of being left to the
  // first-parent fallback, which had no way to tell a base that exposes a member
  // from one that merely inherits it.
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
    // BASES ONLY. `heritageByClass` above also collects `uses`, because a read is
    // evidence that a type is relevant to this file — but it is not a BASE, and
    // closing the exposure of a class through a `uses` edge would make every type the
    // file merely mentions into a supertype. The walk keeps using `heritageByClass`
    // for breadth; this map is what "inherits from" means when the question is
    // whether a base EXPOSES a member.
    const basesOf = new Map<string, string[]>()
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      if (type !== "extends" && type !== "implements") continue
      if (!r.source || !r.target) continue
      const list = basesOf.get(r.source) ?? []
      if (!list.includes(r.target)) list.push(r.target)
      basesOf.set(r.source, list)
    }

    // Does this base EXPOSE the member — its own, or one it inherits?
    //
    // This is the whole of a defect that survived fifteen commits because every
    // corpus row that exposed it was read as an oracle bug. The answer CHANGED
    // depending on whether a project index was supplied:
    //
    //   class A { void close() {} }
    //   class B extends A {}
    //   class C extends B { @override void close() {} }
    //
    // With no index, `declares("B", "close")` looked for a symbol named `close`
    // OWNED BY B. B has none, so the walk continued to A and published
    // `C.close->A.close` — a DECLARER answer. With an index the companion's
    // `allMembers` is inheritance-closed, so B exposes `close` and the same file
    // published `C.close->B.close` — an EXPOSER answer. The same code, two
    // different edges, decided by the environment rather than by the language.
    //
    // EXPOSER is the right question for `overrides`. The edge names the base whose
    // INTERFACE the member replaces, and a class that inherits a getter replaces
    // that getter whether or not it re-declares it. It is also what the companion
    // path already did, so this makes the two paths agree instead of making the
    // no-index answer "more correct".
    //
    // The oracle reached the same rule independently by closing its own in-file
    // member sets over inheritance, and the two now agree on the three-deep chain
    // as well as on the freezed family.
    const exposedCache = new Map<string, Set<string>>()
    const exposing = new Set<string>()
    const exposed = (cls: string): Set<string> => {
      const cached = exposedCache.get(cls)
      if (cached) return cached
      // A cycle in the type graph must terminate with "nothing known", not hang.
      if (exposing.has(cls)) return new Set<string>()
      exposing.add(cls)
      const out = new Set<string>()
      for (const [name, syms] of byName) if (syms.some((bm) => bm.ownerName === cls)) out.add(name)
      for (const b of basesOf.get(cls) ?? []) for (const m of exposed(b)) out.add(m)
      exposing.delete(cls)
      exposedCache.set(cls, out)
      return out
    }

    // Base exposes the member? In-file closure first, then the companion. The
    // companion is consulted even when the base is declared here, because a base can
    // expose a member it inherits from a package — which is the freezed case, and the
    // reason the early return here would have broken it.
    const declares = (base: string, method: string): boolean => {
      if (exposed(base).has(method)) return true
      const companion = companionForPass2?.get(base)
      return !!companion && companion.has(method)
    }
    // Every type name DECLARED in this file, distinct from every member name. The
    // Pass-1 `declares` check answers "does this base have the member", which is
    // not the question the fallback gate needs: it needs "is this base in this
    // file at all", and only a declaration inventory answers that.
    //
    // Declarations ONLY. A base named in an `extends` clause is not thereby
    // declared here — that is the whole premise of the external fallback — so
    // harvesting extends/implements targets into this set would mark every
    // external base as in-file and refute every fallback. It did exactly that on
    // the first attempt: `class Banner extends StatelessWidget` lost its
    // `toString -> StatelessWidget.toString` edge, which the
    // `dart/dedup-and-attribution` fixture correctly pins. A failing fixture caught
    // it, which is the argument for pinning behaviour at all.
    const TYPE_KINDS = new Set<ASTEngine.SymbolKind>([
      ASTEngine.SymbolKind.Class, ASTEngine.SymbolKind.Interface,
      ASTEngine.SymbolKind.Enum, ASTEngine.SymbolKind.Type,
    ])
    const inFileTypes = new Set<string>()
    for (const s of symbols) {
      if (typeof s.name === "string" && s.name && TYPE_KINDS.has(s.kind)) inFileTypes.add(s.name)
    }
    const seenOverride = new Set<string>()
    for (const s of symbols) {
      if ((s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Property) && s.ownerName) {
        // A STATIC member is not overridable. Dart resolves a static call against the
        // STATIC TYPE it was written on, so a subclass declaring the same static name
        // shadows nothing and overrides nothing — there is no such thing as overriding
        // a static method, and no `@override` is even legal on one.
        //
        // The gate that excludes FIELDS from this loop ("fields can never override in
        // Dart") was written for fields; the same reasoning covers static methods and
        // was never written down. It produced a fabricated edge at 0.95, the highest
        // confidence this pass uses, for the one case where the claim is provably
        // impossible:
        //
        //   class BrowserWebSocket implements WebSocket {
        //     static Future<BrowserWebSocket> connect(Uri url, {...}) async { ... }
        //   }
        //
        // claimed `BrowserWebSocket.connect -> WebSocket.connect`. `WebSocket.connect`
        // is itself `static`, so the "base" does not have an instance member to
        // override either. Two statics, one edge, no override.
        if (s.isStatic) continue
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
        } else if (companionForPass2 && heritage.length > 0) {
          // Pass 2: cross-file companion declaring-parent resolution.
          const seen2 = new Set<string>()
          const q2 = [...heritage]
          while (q2.length > 0 && !target) {
            const base = q2.shift()!
            if (seen2.has(base)) continue
            seen2.add(base)
            if (this.companionHas(companionForPass2, base, s.name)) {
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
            const first = firstHeritage.get(s.ownerName) ?? null
            // A fallback may only fire where there is NO EVIDENCE AGAINST it. The
            // first heritage parent is the right guess when it lives in another
            // repository, because then nothing in this file can refute it. But if
            // Pass 1 already walked an in-file base and PROVED it does not declare
            // this member, claiming it is a fabricated edge, not a guess: the edge
            // asserts "this member overrides that member in that base", and the base
            // demonstrably has no such member.
            //
            // freezed is the case that reaches it. `sealed class TemplateState
            // extends Equatable` declares no `props`; `class TemplateInitial
            // extends TemplateState` does, annotated `@override` (freezed emits the
            // annotation). Pass 1 walks TemplateState in-file, finds no `props`, and
            // cannot reach Equatable; Pass 3 then attributed the override to
            // TemplateState — a class that does not override anything. The real
            // base is Equatable. Measured 91 such rows on 1,294 ProxiCall/lib
            // files, all of them freezed `props` / `hashCode` / `toString` /
            // `operator ==` against Equatable.
            //
            // The genuine external cases are untouched: `FmsCubit extends Cubit` and
            // `InventoryCategoryException implements Exception` have a first parent
            // that is NOT in this file, so there is no evidence against and the
            // fallback still fires.
            // Two refutations, and the second is only possible once a project index
            // exists. The first is in-file evidence: this file declares the base and
            // the base has no such member. The second is PROJECT-WIDE evidence: the
            // index knows the base, and the inheritance-closed member set says it does
            // not EXPOSE the member. That is the same standard as the first one, at a
            // wider scope, and it is what the gate was missing — it was written before
            // the companion existed and could only ever look at this file.
            //
            // It matters because a 0.8 first-parent claim is wrong the moment the base
            // is KNOWN. dart-http's `WebSocketSink` is `abstract interface class
            // WebSocketSink implements DelegatingStreamSink` and declares only
            // `close`; `done`, `add`, `addError` and `addStream` come from
            // `DelegatingStreamSink`. So every `X.done -> WebSocketSink.done` names a
            // base that does not have the member — 37 rows on that lane alone, all
            // @0.8, all unrefuted only because the base was declared in a DIFFERENT
            // file of the same repository.
            const indexKnowsBase = first !== null && companionForPass2?.has(first) === true
            const refuted = first !== null && !declares(first, s.name) &&
              (byName.get(s.name)?.some((bm) => bm.ownerName === first) ?? false) === false &&
              ((heritageByClass.has(first) || inFileTypes.has(first)) || indexKnowsBase)
            if (!refuted) {
              target = first
              confidence = 0.8
              metadata = { isOverride: true, relationshipType: "method_override", isExternalBase: true }
              // THE OBJECT INTERFACE IS THE ONE OVERRIDE TARGET THAT NEEDS NO
              // EVIDENCE ABOUT THE BASE.
              //
              // Reaching this point means no base the run can see exposes the
              // member, so the first heritage parent is a NAME and not a
              // declaration. When the member is one of `Object`'s own, the parent
              // inherits it — `class ProtocolException implements Exception` with
              // `@override String toString()` does not override
              // `Exception.toString`, because `Exception` declares no `toString`
              // at all (`dart-sdk/sdk/lib/core/exceptions.dart` publishes 17
              // symbols and `Exception.toString` is not one of them). The edge
              // `ProtocolException.toString -> Exception.toString` therefore
              // named a member that does not exist, and the graph asserted a
              // declaration there.
              //
              // MEASURED over 4,788 corpus files at `BB_DART_CONC=1` (3 repos
              // read whole: dart-http 335, riverpod 1,295, proxicall 2,351; 2
              // sampled: flutter-packages 404, dart-sdk 403):
              //
              //   before — 247,737 `overrides` rows, 2,422 of them (0.98%) name a
              //            target no published declaration provides. Every one of
              //            the 2,422 is this shape, and every one is an
              //            `isExternalBase` fallback.
              //   after  — those rows name `Object.<member>`, which IS published
              //            in the SDK sources, and the residual unexplained
              //            `overrides` population falls by the same 2,422.
              //
              // WHAT THIS TRADES, stated rather than argued away. If an
              // out-of-run base DOES declare the member — a user class in another
              // package with its own `toString` — then `Base.toString` was the
              // nearest correct target and `Object.toString` is one hop further
              // up. The retarget cannot tell the two cases apart without the
              // base's own file, and it prefers naming a declaration that
              // provably EXISTS over naming one that may not. That is the same
              // preference the rest of this pass already makes when it refuses a
              // refuted fallback: an edge the graph cannot walk asserts something
              // that is not there, and a narrower graph that is true beats a
              // wider one that is not.
              //
              // The row is tagged `isObjectInterfaceBase`, so a consumer can tell
              // a retargeted row from a first-parent row, and M14 §4's
              // countability holds: it is one boolean over a single type at a
              // single confidence.
              if (
                first !== null &&
                first !== DART_OBJECT_TYPE &&
                DART_OBJECT_INTERFACE_MEMBERS.has(s.name)
              ) {
                // The BASE name, not the qualified member: the push below appends
                // `.${s.name}` itself. Writing `Object.toString` here produced the
                // target `Object.toString.toString`, which the fixture caught on
                // its first run.
                target = DART_OBJECT_TYPE
                metadata = {
                  isOverride: true,
                  relationshipType: "method_override",
                  isExternalBase: true,
                  isObjectInterfaceBase: true,
                  firstHeritageParent: first,
                }
              }
            }
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
          // The overriding METHOD's own name line — the node that names the
          // edge, not the base it shadows (and not a wrapped start line).
          line_number: nameLines?.get(dartNameLineKey(s.name, s.range)) ?? s.range?.startLine,
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

  /**
   * The whole-tree EXPRESSION pass: `calls`, `uses`, `instantiates` and
   * `references`.
   *
   * Named for what it reads rather than for when it was written. It began as the
   * call pass, but it is also the only traversal that already knows, at every
   * node, which declaration encloses it (`current`/`owner`, the family attribution
   * rule), and a type mention's SOURCE is the same question a call's source is.
   * A second traversal would have had to re-derive that attribution, and two
   * copies of one rule are two rules that drift.
   *
   * `projectIndex` is LAST and it must stay last — the same hazard
   * `extractOverrideRelationships` documents: an optional parameter inserted
   * earlier silently swapped the ones after it.
   */
  private extractExpressionRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
    symbols: ASTEngine.UniversalSymbol[],
    projectIndex?: any,
  ): void {
    // The types this run can SEE. `references` publishes a type mention only when
    // the mentioned name binds to a type declaration the analyzer can point at —
    // a type from another file is a real mention, but from one file it is a NAME,
    // and a name with nothing behind it is what `references` must not publish
    // (see `collectTypeMention`).
    //
    // Same-file types come from the symbol table the first pass just built.
    // UNNAMED EXTENSIONS ARE EXCLUDED, and that exclusion is load-bearing:
    // `extension on String {}` is published under the name of its TARGET type, so
    // admitting it would make every mention of `String` in the file resolve to
    // this file's extension — an edge to a symbol that is not the type the code
    // names.
    const visibleTypes = new Set<string>()
    for (const s of symbols) {
      const kind = s.kind as ASTEngine.SymbolKind
      const isType = kind === ASTEngine.SymbolKind.Class || kind === ASTEngine.SymbolKind.Mixin ||
        kind === ASTEngine.SymbolKind.Extension || kind === ASTEngine.SymbolKind.Enum ||
        kind === ASTEngine.SymbolKind.TypeAlias
      if (!isType) continue
      if (kind === ASTEngine.SymbolKind.Extension && (s.metadata as any)?.isUnnamedExtension) continue
      if (s.name) visibleTypes.add(s.name)
    }
    // What this FILE declared, kept apart from what the index contributed, so a
    // row can say which of the two resolved it. Production supplies no index for
    // `.dart`, so there the two are the same set and every row says false.
    const fileTypes = new Set(visibleTypes)
    for (const t of projectIndex?.typeKinds?.keys?.() ?? []) visibleTypes.add(String(t))

    // DT-A (first review): in-file named constructors (`Foo.named`) — the
    // calls below consult this set so construction wins over the dangling
    // leaf call. Cross-file named ctors stay leaf calls (translation-unit
    // boundary, documented).
    const namedCtors = new Set<string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Constructor && s.ownerName) {
        const seg = (s.metadata as any)?.namedSegment
        if (seg) namedCtors.add(`${s.ownerName}.${seg}`)
      }
    }
    // DT-F+ (#752): declared members per owning type. A BARE identifier read
    // (`return count;`) is only a member read when it resolves to a member of
    // the enclosing type — otherwise every local/loop variable fabricates a
    // uses edge (a false edge is worse than a missing one, #299). Built once
    // from the symbol table; O(symbols) like namedCtors above.
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
    // DT2 (second review): file-scope VALUE names — top-level variables,
    // constants, functions and accessors. Types (classes, enums, mixins,
    // extensions, typedefs) are never values. Locals shadow globals and
    // members shadow both (Dart scoping); the arms below are mutually
    // exclusive by construction.
    const topLevelValues = new Set<string>()
    for (const s of symbols) {
      if (s.ownerName) continue
      if (
        s.kind === ASTEngine.SymbolKind.Variable ||
        s.kind === ASTEngine.SymbolKind.Constant ||
        s.kind === ASTEngine.SymbolKind.Function ||
        s.kind === ASTEngine.SymbolKind.Property
      ) {
        topLevelValues.add(s.name)
      }
    }
    // DT-D (first review): superclass per class (resolved, alias-free) for
    // `super(...)` initializer targets. Superclass-child clauses only —
    // mixin-application bases are vanishingly rare as super targets.
    const superByClass = new Map<string, string>()
    {
      const pre: Node[] = [node]
      while (pre.length > 0) {
        const cn = pre.pop()!
        if (!cn) continue
        if (cn.type === "class_definition") {
          const nm = cn.childForFieldName?.("name")?.text
          const sup = this.findChildByType(cn, "superclass")
          if (nm && sup) {
            const base = this.resolvedHeritageNames(sup)[0]
            if (base) superByClass.set(nm, base)
          }
        }
        for (let i = cn.namedChildCount - 1; i >= 0; i--) {
          const ch = cn.namedChild(i)
          if (ch) pre.push(ch)
        }
      }
    }
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
      if (t === "extension_declaration" || t === "extension_type_declaration") {
        const nm = n.childForFieldName?.("name")?.text || this.extensionTargetType(n)
        return nm || owner
      }
      if (t === "mixin_declaration") {
        // mixin name is a direct identifier child (no name field)
        const id = this.findChildByType(n, "identifier")
        return id ? id.text : owner
      }
      // `typedef A = B;` — the alias is a PUBLISHED symbol (kind `type`), so the
      // mention of `B` belongs to `A` and not to the file. Added for `references`;
      // it cannot move `calls`/`uses`/`instantiates`, because a typedef has no
      // body for an expression to sit in.
      if (t === "type_alias") {
        const nm = n.childForFieldName?.("name")?.text || this.findChildByType(n, "type_identifier")?.text
        return nm || owner
      }
      return owner
    }

    const processNode = (
      n: Node,
      current: string | null,
      owner: string | null,
      locals: Set<string>,
    ): void => {
      const prev = current
      const prevOwner = owner
      const t = n.type
      current = resolveCurrent(n, current)
      owner = resolveOwner(n, owner)
      // DT-F+ (#752 gate B): names the CURRENT FUNCTION binds locally are not
      // member reads (CGD15 parity). A function body's bindings are its own
      // declarators plus the formal parameters of the preceding signature
      // sibling (Dart puts the body AFTER the signature in the container).
      let childLocals = locals
      if (t === "function_body" || t === "function_expression_body" || t === "block") {
        const bound = this.collectDartLocals(n)
        const sig = n.previousNamedSibling
        if (sig) for (const nm of this.collectDartLocals(sig)) bound.add(nm)
        if (bound.size > 0) {
          childLocals = new Set(locals)
          for (const nm of bound) childLocals.add(nm)
        }
      }
      // DT2: constructor initializer lists (`: x = p`, `: super(p)`) read
      // the constructor's parameters, but the list is a SIBLING of the
      // signature — not under any body. Bind the sibling signature's
      // params for this subtree (same collectDartLocals machinery).
      if (t === "initializers") {
        const par = n.parent
        if (par) {
          for (let k = 0; k < par.namedChildCount; k++) {
            const sib = par.namedChild(k)
            if (sib && (sib.type === "constructor_signature" || sib.type === "method_signature" || sib.type === "function_signature")) {
              const bound = this.collectDartLocals(sib)
              if (bound.size > 0) {
                childLocals = new Set(locals)
                for (const nm of bound) childLocals.add(nm)
              }
              break
            }
          }
        }
      }
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
            line_number: this.nodeLine(typeNode),
            metadata: { isConstructorInvocation: true },
          })
        }
      }

      // selector + argument_part = call site (Dart has no invocation_expression).
      // DT-A: the receiver chain decides construction vs call. `Foo.named()`
      // (capitalized head + in-file named ctor) and `p.Foo()` (prefix +
      // capitalized method) instantiate; static methods (`C.create()`) and
      // unknown cross-file `X.y()` stay leaf calls.
      if (t === "selector" && this.findChildByType(n, "argument_part")) {
        const { head, links } = this.invocationChain(n)
        if (links.length === 0) {
          const leafNode = this.resolveSelectorCalleeNode(n)
          const leaf = leafNode?.text ?? null
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
                line_number: this.nodeLine(leafNode),
                metadata: {},
              })
            } else {
              relationships.push({
                source: callSource,
                target: leaf,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                line_number: this.nodeLine(leafNode),
                metadata: {},
              })
            }
          }
        } else {
          const method = links[links.length - 1]
          const before = links.length > 1 ? links[links.length - 2] : this.headNameText(head)
          const headText = this.headNameText(head)
          // The leaf of the chain is the node that NAMES the edge (a wrapped
          // `obj.\n method()` puts it on its own line).
          const calleeNode = n.previousNamedSibling ? this.lastIdentifierNode(n.previousNamedSibling) : null
          if (this.isDartGlobalBuiltin(method)) {
            // filtered
          } else if (
            links.length === 1 && isCapitalized(method) && headText !== null &&
            !isCapitalized(headText) && head !== null &&
            (head.type === "identifier" || head.type === "type_identifier")
          ) {
            // Prefix-qualified construction: `p.Foo(...)` builds Foo.
            relationships.push({
              source: callSource,
              target: method,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(calleeNode),
              metadata: { isNamedConstructor: true, isPrefixQualified: true },
            })
          } else if (
            before !== null && isCapitalized(before) && namedCtors.has(`${before}.${method}`)
          ) {
            // Named construction: `Foo.named()`, `P.Foo.bar()` (in-file).
            relationships.push({
              source: callSource,
              target: before,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(calleeNode),
              metadata: { isNamedConstructor: true },
            })
          } else {
            relationships.push({
              source: callSource,
              target: method,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              line_number: this.nodeLine(calleeNode),
              metadata: {},
            })
          }
        }
      }

      // DT-F: member reads — a selector WITHOUT its own argument_part reads
      // its member (`obj.method` tear-off, `this.count`, `C.total`,
      // `a?.value`). The callee link (immediately followed by the
      // argument-carrying selector) belongs to the call; assignment-LHS
      // plain-`=` members are writes; builtins stay filtered. A capitalized
      // head with an in-file named ctor is a constructor tear-off
      // (`Foo.named` builds Foo — DT-A).
      if (t === "selector" && !this.findChildByType(n, "argument_part")) {
        const memberNode = this.linkMemberNode(n)
        const member = memberNode?.text ?? null
        if (member && !this.isDartGlobalBuiltin(member)) {
          const next = n.nextNamedSibling
          const nextIsArgs = !!next && next.type === "selector" && !!this.findChildByType(next, "argument_part")
          if (!nextIsArgs && !this.selectorIsLhsWrite(n)) {
            const head = n.previousNamedSibling
            const headText = this.headNameText(head)
            if (headText !== null && isCapitalized(headText) && namedCtors.has(`${headText}.${member}`)) {
              relationships.push({
                source: callSource,
                target: headText,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.95,
                line_number: this.nodeLine(memberNode),
                metadata: { isNamedConstructor: true, isTearOff: true },
              })
            } else {
              relationships.push({
                source: callSource,
                target: member,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.9,
                line_number: this.nodeLine(memberNode),
                metadata: { isMemberRead: true },
              })
            }
          }
        }
      }

      // A `qualified` name is the SAME member read as `identifier` + `selector`,
      // parsed the other way round, and only one of the two shapes was handled.
      //
      // `mode == M.off` parses as `equality_expression(identifier(M),
      // selector(.off))`, so the branch above reads the member and publishes
      // `uses source -> off`. `case M.off:` parses as a single `qualified` node
      // under a `constant_pattern`, so nothing read it: the string "qualified"
      // appeared NOWHERE in this analyzer, and a switch case naming a declared
      // enum member or constant published no edge of any kind — not `uses`, not
      // `references`, nothing. Measured over ProxiCall/lib: 78 such constant
      // patterns in 82 files, every one a false negative, led by
      // `case WalletOperationType.recipientLookup:` and
      // `case SessionOfflineBannerMode.offline =>`. The same text, the same
      // meaning, two node shapes, and only the common one was read.
      //
      // SCOPE, deliberately narrow. This fires only where a `qualified` sits
      // under a `constant_pattern`, which is unambiguous: it names a constant
      // being TESTED (`case M.off:`, `if (x case M.off)`). A `qualified` in a TYPE
      // position (`prefix.Type` in an annotation) is a different question — it
      // names a type, and whether that deserves a `uses` edge is a family
      // decision this lane has not made. Widening to every `qualified` would
      // answer that question by accident, so it stays open and visible.
      if (t === "qualified" && n.parent?.type === "constant_pattern") {
        const segs = n.text.split(".")
        const member = segs[segs.length - 1]
        const head = segs.length > 1 ? segs[segs.length - 2] : null
        if (member && !this.isDartGlobalBuiltin(member) && member !== head) {
          // A named constructor is still a construction: `case Foo.named:` tests
          // the constructor `Foo.named`, so it instantiates Foo (DT-A), the same
          // way the selector branch above treats a `Foo.named` tear-off.
          if (head !== null && isCapitalized(head) && namedCtors.has(`${head}.${member}`)) {
            relationships.push({
              source: callSource,
              target: head,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(n),
              metadata: { isNamedConstructor: true, isConstantPattern: true },
            })
          } else {
            relationships.push({
              source: callSource,
              target: member,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isMemberRead: true, isConstantPattern: true },
            })
          }
        }
      }

      // DT-F+ (#752): BARE identifier member reads. The selector branch above
      // only sees dotted reads (`this.count`, `obj.count`), so a plain
      // `return count;` on a declared field emitted NOTHING (probe-confirmed:
      // uses edges on x = 0). Mirrors java #739 / javascript #744. Gate A: the
      // name must resolve to a DECLARED MEMBER of the enclosing type; gate B:
      // it must not be a local/param of the current function.
      if (t === "identifier") {
        const txt = n.text
        const ptype = n.parent?.type ?? ""
        const memberLink =
          ptype === "unconditional_assignable_selector" ||
          ptype === "conditional_assignable_selector" ||
          ptype === "cascade_selector" ||
          ptype === "selector"
        // A bare callee head (`go(n)`) is a CALL, not a value read — the
        // argument-carrying selector owns it (the calls branch above).
        const next = n.nextNamedSibling
        const nextIsCall = !!next && next.type === "selector" &&
          !!this.findChildByType(next, "argument_part")
        const declName = this.isDartDeclNameParent(ptype) || this.isDartDeclaredName(n)
        const isWrite = this.selectorIsLhsWrite(n)
        // DT2: labels (`cb:`), label definitions and control-transfer
        // targets (`break outer`) name, never read.
        const isLabel = ptype === "labeled_statement" || ptype === "break_statement" ||
          ptype === "continue_statement"
        // DT2: field-initializer targets (`: x = v`) bind the field —
        // only the value reads. The target is the first named child.
        const isFieldInitTarget = ptype === "field_initializer" && (() => {
          const first = n.parent?.namedChild(0)
          return !!first && first.startIndex === n.startIndex && first.endIndex === n.endIndex
        })()
        // DT2: `this`/`super` are keyword receivers, never value reads
        // (verified non-identifier in the pinned grammar; belt and braces).
        if (txt === "this" || txt === "super") {
          // fall through to no arm (silent)
        } else if (
          !memberLink &&
          !nextIsCall &&
          !declName &&
          !isWrite &&
          !isLabel &&
          !isFieldInitTarget
        ) {
          const isDeclaredMember = !!owner && (membersByOwner.get(owner)?.has(txt) ?? false)
          if (!locals.has(txt) && isDeclaredMember) {
            relationships.push({
              source: callSource,
              target: txt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.6,
              line_number: this.nodeLine(n),
              metadata: { isBareRead: true },
            })
          } else if (locals.has(txt)) {
            // DT2: bound locals/params read as values (OC-E parity).
            // Exact scope resolution — confidence 0.9, lane-compared.
            relationships.push({
              source: callSource,
              target: txt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isLocalRead: true },
            })
          } else if (!isDeclaredMember && topLevelValues.has(txt)) {
            // DT2: file-scope values read as values. Members shadow
            // globals (checked above); locals shadow both (checked above).
            relationships.push({
              source: callSource,
              target: txt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isGlobalRead: true },
            })
          }
        }
      }

      // DT-D: constructor redirection in initializer lists — `B() : super(1)`,
      // `B.named() : super.named(2)` construct the superclass (resolved,
      // alias-free); `B() : this.named(x)` constructs the own class.
      if (t === "initializer_list_entry") {        let headIsSuper = false
        let headIsThis = false
        // The `super`/`this` HEAD token is the node that names the destination
        // class of the redirection (M60 line contract).
        let headNode: Node | null = null
        const firstRaw = n.child(0)
        if (firstRaw && !firstRaw.isNamed && (firstRaw.text === "super" || firstRaw.text === "this")) {
          headIsSuper = firstRaw.text === "super"
          headIsThis = firstRaw.text === "this"
          headNode = firstRaw
        } else {
          const firstNamed = n.namedChild(0)
          if (firstNamed && (firstNamed.type === "super" || firstNamed.type === "this")) {
            headIsSuper = firstNamed.type === "super"
            headIsThis = firstNamed.type === "this"
            headNode = firstNamed
          }
        }
        if (headIsSuper && owner) {
          const base = superByClass.get(owner)
          if (base) {
            relationships.push({
              source: callSource,
              target: base,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(headNode),
              metadata: { isSuperConstructor: true },
            })
          }
        } else if (headIsThis && owner) {
          relationships.push({
            source: callSource,
            target: owner,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            line_number: this.nodeLine(headNode),
            metadata: { isRedirectingConstructor: true },
          })
        }
      }

      // DT-D (continued): `this.named(...)` redirects parse as a `redirection`
      // node (`:` `this` `.` `named` `arguments`) rather than an initializer
      // entry. Same targets: this -> own class, super -> superclass.
      if (t === "redirection" && owner) {
        let rSuper = false
        let rThis = false
        let headTok: Node | null = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "this") { rThis = true; headTok = c; break }
          if (c.type === "super") { rSuper = true; headTok = c; break }
          if (c.type === "identifier" || c.type === "type_identifier" || c.type === "arguments") continue
          break
        }
        if (rSuper) {
          const base = superByClass.get(owner)
          if (base) {
            relationships.push({
              source: callSource,
              target: base,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(headTok),
              metadata: { isSuperConstructor: true },
            })
          }
        } else if (rThis) {
          relationships.push({
            source: callSource,
            target: owner,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            line_number: this.nodeLine(headTok),
            metadata: { isRedirectingConstructor: true },
          })
        }
      }

      // DT-F: subscript bases (`xs[0]`, `xs?[0]`, `m['k']`) — the grammar
      // parses the index as a bare `selector` sibling holding `[`
      // (no assignable member, no argument_part). An index operation
      // presupposes a value, so the base reads without inventory.
      // Declaration names (`int xs[3]`) bind, never read.
      if (t === "identifier") {
        const parent = n.parent
        const ptype = parent?.type ?? ""
        if (!this.isDartDeclNameParent(ptype) && ptype !== "label" && !this.isDartDeclaredName(n)) {
          const nx = n.nextNamedSibling
          if (nx && ((nx.type === "selector" && this.isIndexSelector(nx)) || this.isIndexAssignable(nx))) {
            relationships.push({
              source: callSource,
              target: n.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isSubscriptBase: true },
            })
          } else if (this.isInsideTemplateSubstitution(n)) {
            // DT-F: string interpolation reads (`'hello $name'`,
            // `'sum ${n + 1}'`) — every bare identifier inside a template
            // substitution is evaluated. Declaration-shaped names still bind.
            relationships.push({
              source: callSource,
              target: n.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isInterpolationRead: true },
            })
          }
        }
      }

      // DT-F: `$name` interpolation placeholder (distinct node type).
      if (t === "identifier_dollar_escaped") {
        const raw = n.text
        const name = raw.startsWith("$") ? raw.slice(1) : raw
        if (name) {
          relationships.push({
            source: callSource,
            target: name,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            line_number: this.nodeLine(n),
            metadata: { isInterpolationRead: true },
          })
        }
      }
      // DARTD17: `b..a.b.c(1)` — the cascade_selector names only the FIRST
      // segment (`a`); the deeper chain lives in nested
      // unconditional_assignable_selector children (probed cascade-shape.ts).
      // DARTD18 (OO family closure): a cascade_section may carry SEVERAL
      // invocations (`..transform(x)..listen(y)` = one section holding two
      // selector+argument_part pairs). One call is emitted per selector that
      // is IMMEDIATELY followed by its own argument_part sibling — so
      // `..headers.addAll(x)` calls addAll (headers is a bare getter, no
      // args), and multi-invocation sections call every method, not just the
      // last (dart-http corpus: echo_server's `..transform(..)..listen(..)`
      // previously dropped the transform call).
      // DT-F: selectors NOT followed by an argument_part are getter reads
      // (`..length` → uses->length), unless the section assigns (`..b = 1`
      // writes b — gated on a direct anonymous `=` child).
      if (t === "cascade_section") {
        let sectionAssigns = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.text === "=") { sectionAssigns = true; break }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type !== "cascade_selector" && c.type !== "unconditional_assignable_selector" &&
              c.type !== "conditional_assignable_selector" && c.type !== "selector") continue
          const next = n.namedChild(i + 1)
          if (next && next.type === "argument_part") {
            const idNode = this.lastIdentifierNode(c)
            const id = idNode?.text ?? null
            if (id && !this.isDartGlobalBuiltin(id)) {
              relationships.push({
                source: callSource,
                target: id,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                line_number: this.nodeLine(idNode),
                metadata: { isCascade: true },
              })
            }
          } else if (!sectionAssigns) {
            const idNode = this.lastIdentifierNode(c)
            const id = idNode?.text ?? null
            if (id && !this.isDartGlobalBuiltin(id)) {
              relationships.push({
                source: callSource,
                target: id,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.9,
                line_number: this.nodeLine(idNode),
                metadata: { isMemberRead: true, isCascade: true },
              })
            }
          }
        }
      }

      // `references`: the declaration mentions a TYPE. Collected here, on the one
      // traversal that knows the enclosing declaration — see `collectTypeMention`.
      if (t === "type_identifier") {
        this.collectTypeMention(n, callSource, relationships, visibleTypes, fileTypes)
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) processNode(child, current, owner, childLocals)
      }

      current = prev
      owner = prevOwner
    }

    processNode(node, null, null, new Set<string>())
  }

  // ============================================================================
  // `references` — A DECLARATION MENTIONS A TYPE
  // ============================================================================

  /**
   * One type mention, read off ONE node. No recursion, no state: everything it
   * needs (`source`, the type set, the row sink) arrives as an argument, so the
   * rule below is the whole rule and a reader does not have to reconstruct a walk
   * to know what a `references` edge claims.
   *
   * ## WHAT IS CLAIMED
   *
   * `X references T` means: the declaration `X` names the type `T` in a TYPE
   * POSITION, and `T` binds to a type declaration this run can see.
   *
   * Dart is statically typed, and a type position is a grammatical position, not
   * a convention — the grammar has a dedicated node (`type_identifier`) that never
   * appears where a value identifier appears. So the mention is a PARSE FACT, not
   * a name-shape guess. What is not a parse fact is the BINDING of that name to a
   * declaration, which is why the edge is published only when the name resolves
   * and carries 0.95 rather than 1.0 — the same derivation `instantiates` is
   * published at, for the same reason (a syntactic role plus a resolved name).
   *
   * ## WHY RESOLUTION IS A GATE AND NOT A REPORT
   *
   * Measured over 1,000 corpus files across 5 repositories: 75,769 type mentions
   * outside heritage clauses, of which 3,460 (4.57%) name a type the same file
   * declares. The other 95.43% name `String`, `Widget`, `Future` — real types, in
   * `dart:core` and the Flutter SDK, declared in files this per-file run has not
   * read. Publishing those would make the label mostly a list of SDK types, at
   * ~22x the edge count, and every one of them an endpoint no symbol in the index
   * can bind. A narrow graph that is true beats a wide graph that is not, so the
   * unresolvable majority is deliberately unread, and the number is stated rather
   * than left to be discovered downstream.
   *
   * A `projectIndex` widens the gate to every type the run can see
   * (`src/ast/project-index.ts` `typeKinds`), which is how the differential's
   * `--dart-deps=direct` runs measure more than production does. Production does
   * not supply one for `.dart`: `parallel-indexer.ts` `PROJECT_INDEX_EXTENSIONS`
   * names only `.sol`. So the published set is file-local in production and grows
   * with an index — recorded per row in `isIndexResolved` so the two answers are
   * distinguishable in the store rather than conflated.
   *
   * ## WHAT IS NOT A REFERENCE
   *
   * Measured parent-position inventory (the probe that produced it is
   * `validation/m14/fixtures/dart/type-position-probe.ts`):
   *
   *   published — formal_parameter, normal_parameter_type, super_formal_parameter,
   *     constructor_param (a `this.x` parameter's type), function_signature /
   *     getter_signature / setter_signature / operator_signature (return types),
   *     type_arguments (`List<T>`, `Map<K,V>`), function_type, record_type_field,
   *     type_cast (`as T`), type_test (`is T`), try_statement (`on T catch`),
   *     initialized_variable_definition, typed_identifier, for_loop_parts,
   *     declaration (a field's type), program (a top-level `const String x`),
   *     qualified (the LEAF of `prefix.Type`), constructor_tearoff (`http.Client`
   *     used as a value), extension_declaration (`on T`), representation_declaration
   *     (an extension type's representation type), type_alias (`typedef A = B`),
   *     type_bound (`<T extends B>`), object_pattern / variable_pattern / cast_pattern
   *     (a Dart 3 pattern's type), record_type.
   *
   *   NOT published, each for a stated reason:
   *     superclass / interfaces / mixins / mixin_declaration / mixin_application —
   *       heritage already publishes `extends` / `implements` / `uses`, and a second
   *       label for the same fact double-counts it.
   *     new_expression / const_object_expression / constructor_invocation /
   *       redirecting_factory_constructor_signature — construction already publishes
   *       `instantiates`.
   *     type_parameter — `class Box<T>` DECLARES a type variable; it does not
   *       mention a type. A mention of `T` inside that class resolves to the type
   *       VARIABLE, which is what `isTypeParameterShadowed` refuses.
   *     ERROR — nothing inside a parse-error region is a fact about a well-formed
   *       program, and this analyzer's error policy is to publish what survived the
   *       parse, not what the recovery invented.
   *
   * The last one is the reason this method checks the PARENT at all: in this
   * grammar `type_identifier` only ever appears in a type position, so the node
   * type alone would publish the double-counted positions above.
   */
  private collectTypeMention(
    n: Node,
    source: string,
    relationships: ASTEngine.UniversalRelationship[],
    visibleTypes: Set<string>,
    fileTypes: Set<string>,
  ): void {
    const parent = n.parent
    const position = parent ? parent.type : ""
    if (DART_TYPE_MENTION_DOUBLE_COUNTED.has(position)) return

    // A `type_identifier` under a `qualified` name is ALWAYS the type, and the
    // node's own text is that type: `prefix.Type` carries `prefix` as an
    // `identifier` sibling, and `Type.member` carries `member` as one — so there is
    // nothing to strip, and the import alias is never in this branch (DAD1/DT-B).
    //
    // The first version of this read the leaf off the `qualified` NODE instead,
    // which returns null for a `type_identifier` — so every prefixed type mention
    // (`c.List<int>`, `E2.one` in a constant pattern) was silently dropped. The
    // battery in script/m14/verify-dart-references.ts caught it as a missing
    // EXPECTED row on both sides, which is the one class of defect two
    // implementations of one rule share.
    const name = n.text
    if (!name || name === IMPLICIT_DYNAMIC_TYPE) return
    // SELF-REFERENCE IS NOT A DEPENDENCY. An unnamed extension is published under
    // its target type's name, so without this `extension on String` publishes
    // `String references String`.
    if (name === source) return
    if (!visibleTypes.has(name)) return
    // A mention of a TYPE VARIABLE resolves to the variable, not to a type that
    // happens to share its spelling. Ancestor-walked rather than tracked in the
    // scope set, because it runs only for names that already resolved (measured:
    // 4.57% of mentions), so the walk costs nothing on the other 95%.
    if (this.isTypeParameterShadowed(n, name)) return

    relationships.push({
      source,
      target: name,
      type: ASTEngine.RelationshipType.References,
      confidence: 0.95,
      line_number: this.nodeLine(n),
      metadata: {
        isTypeMention: true,
        typePosition: position,
        isIndexResolved: !fileTypes.has(name),
      },
    })
  }

  /**
   * Is `name` bound by a TYPE PARAMETER of an enclosing declaration?
   * `class Box<T> { T value; }` — `T` here is the type variable the class
   * introduced, so the mention is not a reference to a declared type even when
   * something in the project is also called `T`.
   */
  private isTypeParameterShadowed(n: Node, name: string): boolean {
    let cur: Node | null = n.parent
    let guard = 0
    while (cur && guard++ < 32) {
      const tp = this.findChildByType(cur, "type_parameters")
      if (tp) {
        for (let i = 0; i < tp.namedChildCount; i++) {
          const c = tp.namedChild(i)
          if (!c || c.type !== "type_parameter") continue
          // The parameter's TEXT SPANS ITS BOUND. `class Box<T extends Wallet>` is
          // ONE `type_parameter` node whose `type_bound` is a child of it, so
          // `c.text` is `"T extends Wallet"` — and comparing that against `T` never
          // matches, so the gate declined every CONSTRAINED type variable, which is
          // the common case. Measured on a 9-line reproduction with the file's own
          // `class T {}` present: this published `Box -> T`, `get -> T` and
          // `put -> T`, three edges that resolve — at the WRONG declaration, since
          // `T` inside `Box` is the variable and the class is something else.
          const declared = c.childForFieldName?.("name")?.text ??
            this.findChildByType(c, "type_identifier")?.text
          if (declared === name) return true
        }
      }
      cur = cur.parent
    }
    return false
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
        const baseNode = this.resolvedHeritageNodes(app)[0] ?? null
        if (baseNode) {
          relationships.push({
            source: className,
            target: baseNode.text,
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            line_number: this.nodeLine(baseNode),
            metadata: {},
          })
        }
        const mx = this.findChildByType(app, "mixins")
        if (mx) {
          patterns["Mixins"] = true
          // DT-B: resolved (alias-free) mixin names — `with _i2.M` leaked
          // the alias as a mixin use.
          for (const ti of this.resolvedHeritageNodes(mx)) {
            relationships.push({
              source: className,
              target: ti.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              line_number: this.nodeLine(ti),
              metadata: { isMixin: true },
            })
          }
        }
      }
    }

    // DARTD14: mixin `on`-base — `mixin M on Base implements I` parses the
    // on-base as a DIRECT type_identifier child of mixin_declaration (probed
    // dart-mixin-shape.ts: [mixin, identifier, type_identifier, interfaces]).
    // The superclass/interfaces branches below never see it. DT-B: resolved
    // (alias-free) names — `on _i1.Base` leaked the alias as the base.
    if (node.type === "mixin_declaration") {
      const onNodes = this.resolvedHeritageNodes(node).filter((n) => n.text !== className)
      for (const baseNode of onNodes) {
        relationships.push({
          source: className,
          target: baseNode.text,
          type: ASTEngine.RelationshipType.Extends,
          confidence: 1.0,
          line_number: this.nodeLine(baseNode),
          metadata: { isMixinOn: true },
        })
      }
    }

    // superclass: `extends X with M1, M2` — the resolved base is the first
    // RESOLVED heritage name (DAD1: the first raw type_identifier is often an
    // import-alias prefix); the `mixins` child carries the with-clause.
    const superclass = this.findChildByType(node, "superclass")
    if (superclass) {
      const baseNode = this.resolvedHeritageNodes(superclass)[0] ?? null
      if (baseNode) {
        relationships.push({
          source: className,
          target: baseNode.text,
          type: ASTEngine.RelationshipType.Extends,
          confidence: 1.0,
          line_number: this.nodeLine(baseNode),
          metadata: {},
        })
      }
    }
    // interfaces: `implements A, B<C>` — resolved names only (DAD2: alias
    // prefixes `_i2.Database` must not emit `_i2` as an interface target).
    const interfaces = this.findChildByType(node, "interfaces")
    if (interfaces) {
      for (const ti of this.resolvedHeritageNodes(interfaces)) {
        relationships.push({
          source: className,
          target: ti.text,
          type: ASTEngine.RelationshipType.Implements,
          confidence: 1.0,
          line_number: this.nodeLine(ti),
          metadata: { isImplements: true },
        })
      }
    }

    // mixins (with-clause): inside superclass OR directly on the class
    let mixinsNode = superclass ? this.findChildByType(superclass, "mixins") : undefined
    if (!mixinsNode) mixinsNode = this.findChildByType(node, "mixins")
    if (mixinsNode) {
      patterns["Mixins"] = true
      // DT-B: resolved (alias-free) mixin names (same `_i2.M` leak as above).
      for (const ti of this.resolvedHeritageNodes(mixinsNode)) {
        relationships.push({
          source: className,
          target: ti.text,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 1.0,
          line_number: this.nodeLine(ti),
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
      // `references` is a MENTION in a type position (a parse fact) bound to a
      // declaration by name (not a parse fact), so it is `usage_contextual` — the
      // same tier `calls` gets — and never `structural`: claiming the binding is
      // structural would overstate it, since a per-file run cannot see the other
      // files that declare most Dart types.
      if (type === "references") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
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
    return this.resolveSelectorCalleeNode(selector)?.text ?? null
  }

  /** Node form of `resolveSelectorCallee` — the CALLEE identifier is the node
   *  that names a call/instantiates edge (M60 line contract). */
  private resolveSelectorCalleeNode(selector: Node): Node | null {
    const prev = selector.previousNamedSibling
    if (!prev) return null
    if (prev.type === "unconditional_assignable_selector" || prev.type === "conditional_assignable_selector" ||
        prev.type === "selector") {
      // obj.method(...) / Future.delayed(...) / super.toString()
      const inner = this.findChildByType(prev, "identifier")
      if (inner) return inner
      // nested selector chain (e.g. a.b.c()) — last identifier wins
      return this.lastIdentifierNode(prev)
    }
    if (prev.type === "identifier" || prev.type === "type_identifier") {
      return prev
    }
    return null
  }

  private lastIdentifier(node: Node): string | null {
    return this.lastIdentifierNode(node)?.text ?? null
  }

  /**
   * Node form of `lastIdentifier`: the identifier that NAMES a cascade link's
   * edge is also the node whose line the edge carries (M60 line contract), so
   * both views come from ONE traversal and cannot disagree.
   */
  private lastIdentifierNode(node: Node): Node | null {
    let result: Node | null = null
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier" || n.type === "type_identifier") result = n
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return result
  }

  /**
   * DT-A/DT-F: the member identifier of a link selector
   * (`unconditional_assignable_selector` / `conditional_assignable_selector`
   * child holding `method` in `obj.method`, `?.value`, `..length`).
   */
  private linkMember(sel: Node): string | null {
    return this.linkMemberNode(sel)?.text ?? null
  }

  /** Node form of `linkMember`: the member identifier itself is the node that
   *  NAMES a member-read/tear-off edge (M60 line contract). */
  private linkMemberNode(sel: Node): Node | null {
    const probe: Node[] = sel.type === "selector" ? this.namedChildrenOf(sel) : [sel]
    for (const c of probe) {
      if (c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector" ||
          c.type === "cascade_selector") {
        const id = this.findChildByType(c, "identifier") ?? this.findChildByType(c, "type_identifier")
        if (id) return id
      }
    }
    return null
  }

  private namedChildrenOf(n: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }

  /**
   * DT-A: receiver chain of an invocation, walking back through
   * link-selector siblings from the argument-carrying selector.
   * `P.Foo.bar()` -> head `P`, links [`Foo`, `bar`]; bare `foo()` ->
   * head `foo`, no links.
   */
  private invocationChain(argsSelector: Node): { head: Node | null; links: string[] } {
    const links: string[] = []
    let c: Node | null | undefined = argsSelector.previousNamedSibling
    while (c) {
      if (c.type === "selector") {
        const m = this.linkMember(c)
        if (!m) break
        links.unshift(m)
        c = c.previousNamedSibling
      } else if (
        c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector"
      ) {
        const id = this.findChildByType(c, "identifier") ?? this.findChildByType(c, "type_identifier")
        if (!id) break
        links.unshift(id.text)
        c = c.previousNamedSibling
      } else break
    }
    return { head: c, links }
  }

  private headNameText(head: Node | null): string | null {
    if (head && (head.type === "identifier" || head.type === "type_identifier")) return head.text
    return null
  }

  /**
   * DT-F: true when the selector sits in an assignment LHS write position
   * with a plain `=` operator (`a.b = c` writes b; `a.b += c` and `a.b ??= c`
   * read it). Span-matched like the C analyzer's LHS gate.
   */
  private selectorIsLhsWrite(sel: Node): boolean {
    let p: Node | null | undefined = sel.parent
    let guard = 0
    while (p && guard++ < 16) {
      if (p.type === "assignment_expression") {
        // Plain `=` writes the LHS; compound (`+=`, `??=`, ...) reads it.
        // Pure string comparison — never regex (family contract).
        let opText: string | null = null
        for (let i = 0; i < p.childCount; i++) {
          const c = p.child(i)
          if (c && !c.isNamed && c.text.includes("=")) { opText = c.text; break }
        }
        if (opText !== "=") return false
        const lhs = p.namedChild(0)
        if (lhs && lhs.startIndex <= sel.startIndex && lhs.endIndex >= sel.endIndex) return true
        return false
      }
      if (p.type === "function_body" || p.type === "block" || p.type === "class_body" ||
          p.type === "program" || p.type === "declaration") return false
      p = p.parent
    }
    return false
  }

  /** DT-F: declaration-name positions whose identifiers are binds, never reads. */
  private isDartDeclNameParent(ptype: string): boolean {
    return ptype === "formal_parameter" || ptype === "constructor_param" ||
      ptype === "function_signature" || ptype === "method_signature" ||
      ptype === "getter_signature" || ptype === "setter_signature" ||
      ptype === "type_alias" || ptype === "label" ||
      // #752: field / static-field declaration names (`int count = 0;`,
      // `static final int x = 1;`) — the declaration is a BIND, not a read.
      ptype === "initialized_identifier" || ptype === "static_final_declaration" ||
      ptype === "class_definition" || ptype === "enum_declaration" ||
      ptype === "mixin_declaration" || ptype === "extension_declaration" ||
      // M60 (#933 triage): `enum_declaration` covered the enum's OWN name but
      // not each VALUE's node, so every enum constant was published as a bare
      // read of its own enum (`uses Shape -> circle` at the declaration line,
      // confidence 0.6). The M12 harness files sub-threshold facts as
      // `unknown`, never as false positives, which is how it survived the
      // lane's whole fixture and mutant program — probe-verified node shape:
      // `(enum_body (enum_constant (identifier)))`. The constant's ARGUMENTS
      // are outside this gate and stay ordinary reads.
      ptype === "enum_constant" ||
      // DARTD21: an extension type's container name AND its representation
      // field name (`extension type X._(T object$)`) are declarations.
      ptype === "extension_type_declaration" || ptype === "representation_declaration"
  }

  /**
   * DT-F+ (#752): the names a function scope binds locally — its own
   * declarators plus formal / constructor / catch parameters. Used by the
   * bare-member-read gate so a name the CURRENT FUNCTION binds suppresses the
   * member read (CGD15 parity: a local is not a member, #299 — a false edge is
   * worse than a missing one). O(subtree), no regex.
   */
  private collectDartLocals(root: Node): Set<string> {
    const out = new Set<string>()
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier" && this.isDartDeclaredName(n)) out.add(n.text)
      // M14.0.F6 (2026-09-15): two of the names here cannot occur in the pinned
      // dart grammar, so their branches were dead — `simple_formal_parameter`
      // (the grammar's rule is HIDDEN and underscore-prefixed,
      // `_simple_formal_parameter`, so it never appears as a node type at all)
      // and `catch_clause_parameter` (dart's node is `catch_parameters`, which
      // IS listed). Measured: a catch clause parses as
      // `(catch_clause (catch_parameters (identifier) (identifier)))` and a
      // parameter as `(formal_parameter …)` — both already covered, so removing
      // the two names changes nothing (the gate's own definition of a dead
      // literal is a comparison that can never fire).
      if (
        n.type === "formal_parameter" || n.type === "constructor_param" ||
        n.type === "super_formal_parameter" || n.type === "catch_parameters"
      ) {
        const id = this.findChildByType(n, "identifier")
        if (id) out.add(id.text)
      }
      // DT2 (second review): for-in loop variables (`for (var x in xs)` —
      // the identifier preceding the `in` token) and pattern-bound names
      // (`variable_pattern` always; `constant_pattern` only under a binding
      // ancestor — a bare `case Foo:` tests a type, it binds nothing).
      if (n.type === "for_loop_parts") {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.text === "in") {
            for (let j = 0; j < i; j++) {
              const pc = n.child(j)
              if (pc && pc.isNamed && pc.type === "identifier") out.add(pc.text)
            }
            break
          }
        }
      }
      if (n.type === "variable_pattern") {
        const id = this.deepIdentifier(n)
        if (id) out.add(id.text)
      }
      if (n.type === "constant_pattern" && this.isBindingPatternContext(n)) {
        const id = this.deepIdentifier(n)
        if (id) out.add(id.text)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  /**
   * DT2: first document-order `identifier` in a subtree (pattern contents
   * nest — direct-child lookup misses `var (a, b)`-style bindings).
   */
  private deepIdentifier(n: Node): Node | null {
    const stack: Node[] = [n]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (c.type === "identifier") return c
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const ch = c.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return null
  }

  /**
   * DT2: is this pattern node inside a BINDING context? Only structural
   * descent counts: a `var (a, b)` destructuring binds through record /
   * list / map wrappers to the declaration (or for-in head). A case TEST
   * (`InvitationStatus.declined => ...` inside `var x = switch ...`)
   * crosses a switch/if boundary — it tests, never binds, even when the
   * whole switch initializes a variable.
   */
  private isBindingPatternContext(n: Node): boolean {
    let p: Node | null | undefined = n.parent
    let guard = 0
    while (p && guard++ < 8) {
      const t = p.type
      if (t === "pattern_variable_declaration" || t === "for_loop_parts") return true
      if (
        t !== "record_pattern" && t !== "list_pattern" && t !== "map_pattern" &&
        t !== "constant_pattern" && t !== "variable_pattern"
      ) return false
      p = p.parent
    }
    return false
  }

  /**
   * DT-F: is this identifier the DECLARED name of its definition
   * (`var q = ...`, `int xs[3]`, `int xs[3] = ...`)? Names precede the
   * first `=` child; values follow it. Definitions without `=` bind every
   * identifier they directly hold.
   */
  private isDartDeclaredName(n: Node): boolean {
    const parent = n.parent
    if (!parent) return false
    const ptype = parent.type
    if (ptype !== "initialized_variable_definition" && ptype !== "static_final_declaration") return false
    let eqIdx = -1
    let myIdx = -1
    for (let i = 0; i < parent.childCount; i++) {
      const c = parent.child(i)
      if (!c) continue
      if (!c.isNamed && c.text === "=" && eqIdx === -1) eqIdx = i
      if (c.isNamed && c.startIndex === n.startIndex && c.endIndex === n.endIndex) myIdx = i
    }
    if (myIdx === -1) return false
    if (eqIdx === -1) return true
    return myIdx < eqIdx
  }

  /** DT-F: is this selector an index operation (`xs[0]` parses the index
   *  as a member-less selector holding brackets)? Member selectors name a
   *  member; argument selectors invoke. Bounded shape scan, never regex. */
  private isIndexSelector(sel: Node): boolean {
    if (this.linkMember(sel) !== null) return false
    if (this.findChildByType(sel, "argument_part")) return false
    return this.subtreeHasBracket(sel)
  }

  /** DT-F: is this assignable an index target (`xs[3] = 4` wraps the base
   *  and index in assignable_expression)? Same member-less + bracket test
   *  applied to the node itself. */
  private isIndexAssignable(sel: Node): boolean {
    if (sel.type !== "unconditional_assignable_selector" && sel.type !== "conditional_assignable_selector") return false
    if (this.findChildByType(sel, "identifier") ?? this.findChildByType(sel, "type_identifier")) return false
    return this.subtreeHasBracket(sel)
  }

  private subtreeHasBracket(sel: Node): boolean {
    const stack: Node[] = [sel]
    let guard = 0
    while (stack.length > 0 && guard++ < 32) {
      const c = stack.pop()!
      if (!c.isNamed && (c.text === "[" || c.text === "?[")) return true
      // All children (anonymous brackets are invisible to named traversal).
      for (let i = 0; i < c.childCount; i++) {
        const ch = c.child(i)
        if (ch) stack.push(ch)
      }
    }
    return false
  }

  /** DT-F: bounded ancestor climb — is this node inside string interpolation? */
  private isInsideTemplateSubstitution(n: Node): boolean {
    let p: Node | null | undefined = n.parent
    let guard = 0
    while (p && guard++ < 8) {
      if (p.type === "template_substitution") return true
      if (p.type === "function_body" || p.type === "block" || p.type === "class_body" ||
          p.type === "program" || p.type === "declaration") return false
      p = p.parent
    }
    return false
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
    // keyword, token, parameters) — no name field, no identifier. The name is
    // the SYNTHESISED spelling `operator +` (a lane contract, like kotlin's
    // phantom members) — never the raw token, so this branch does NOT go
    // through `signatureNameNode`'s text.
    if (inner.type === "operator_signature") {
      const opTok = this.operatorTokenNode(inner)
      return opTok ? `operator ${opTok.text}` : null
    }
    const id = this.findChildByType(inner, "identifier")
    return id ? id.text : null
  }

  /** The operator symbol token of an `operator_signature`.
   *
   *  This locates the `operator` KEYWORD and takes the token after it. It must NOT
   *  hardcode a child index: the return type in front of the keyword is not one
   *  node but a variable number of them. A plain `bool` is a single
   *  `type_identifier`, so `child(2)` is the operator token — but a SCOPED return
   *  type (`core$_.bool`, `ns.bool`) is a `scoped_identifier` the grammar splits,
   *  which shifts every later child by one.
   *
   *  Measured: `extension ByteString$$Methods on ByteString { core$_.bool
   *  operator >(ByteString byteString) { ... } }` in ok_http's JNI bindings, where
   *  `child(2)` then names the member after the return type's last segment and
   *  publishes `operator bool` — a member name that names a TYPE, on a class that
   *  has no such member, while the real `operator >` went missing. Scanning for
   *  the keyword is invariant to how the return type is spelled. */
  private operatorTokenNode(inner: Node): Node | null {
    for (let i = 0; i < inner.childCount; i++) {
      const c = inner.child(i)
      if (c && !c.isNamed && c.text === "operator") return inner.child(i + 1)
    }
    return null
  }

  /** Node form of `signatureName`: the node that names a member edge is also
   *  the node whose LINE the edge carries (M60 line contract). For an operator
   *  overload the naming node is the operator TOKEN — its line, not its text,
   *  is what the synthesised spelling contributes. */
  private signatureNameNode(inner: Node): Node | null {
    const nameNode = inner.childForFieldName("name")
    if (nameNode) return nameNode
    if (inner.type === "operator_signature") {
      return this.operatorTokenNode(inner)
    }
    return this.findChildByType(inner, "identifier")
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
              // `record_type` joins the list for DARTGAP3. A Dart 3 record is a
              // real declared type and it is spelled as a leading child exactly
              // like the other four, so `void f((int, String) p)` degraded its
              // parameter to `dynamic` and the record vanished from the graph.
              // The type text is taken verbatim from the node, so positional
              // `($1, $2)` and named `({int a, String b})` both survive with the
              // spelling the file used — no normalization, because a record's
              // field NAMES are part of its type.
              if (c.type === "type_identifier" || c.type === "function_type" ||
                  c.type === "nullable_type" || c.type === "void_type" ||
                  c.type === "record_type") {
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
          if (!already) out.push({ name: nameNode.text, type: typeText ?? IMPLICIT_DYNAMIC_TYPE, isOptional, isNamed })
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
    // A `childForFieldName("return_type")` read stood here and was DEAD: the
    // pinned grammar's field set has no such field (F1's 22-field oracle), and a
    // probe over both pinned corpora resolved it on 0 of 117,200 nodes. The fallback
    // it guarded was therefore the only path that ever ran, which is why removing it
    // cannot move a payload — it only removes a field the grammar never had.
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
      // `record_type` for DARTGAP3, same reason as the parameter extractor: a
      // record RETURN type was silently lost, so `({int a, String b}) f()` published
      // no return type at all and the function looked untyped. Verbatim text, so the
      // field names inside the record survive as written.
      if (c.type === "type_identifier" || c.type === "void_type" || c.type === "record_type") return c.text
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
        // `record_type` for DARTGAP3 — `late (int, String) pair;` is a leading
        // child exactly like `late int n;`, so the direct-child rule was right and
        // the node-type list was the only thing missing.
        if (c.type === "type_identifier" || c.type === "void_type" || c.type === "record_type") {
          return c.text
        }
      }
    }
    return undefined
  }

  /** The representation type's leaf name (`extension type X(objc.ObjCObject o)`
   *  -> `ObjCObject`): alias-free like every other type name this lane emits
   *  (DARTD1/DARTD2), since the first identifier is the IMPORT PREFIX. */
  private representationTypeName(rep: Node | null): string | undefined {
    if (!rep) return undefined
    const nameNode = rep.childForFieldName("name")
    let leaf: string | undefined
    for (let i = 0; i < rep.namedChildCount; i++) {
      const c = rep.namedChild(i)
      if (!c) continue
      if (nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex) break
      if (c.type === "type_identifier" || c.type === "void_type") leaf = c.text
    }
    return leaf
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
    return this.resolvedHeritageNodes(node).map((n) => n.text)
  }

  /** Node form of `resolvedHeritageNames` — the heritage-name node IS the node
   *  that names an extends/implements/uses edge (M60 line contract), so text
   *  and line come from one selection. */
  private resolvedHeritageNodes(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "type_arguments" || c.type === "mixins") continue
      if (c.type !== "type_identifier" && c.type !== "identifier") continue
      const next = node.child(i + 1)
      if (next && next.type === ".") continue // alias prefix: `A.B` keeps B
      out.push(c)
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

  /**
   * M60 (#929 lineage, dart lane): the line a relationship CLAIMS is the line
   * of the node that NAMES its target — the base clause for extends/implements,
   * the declared member for contains, the callee for calls, the constructed
   * class for instantiates, the overriding method for overrides, the uri
   * literal for an import/export/part, the redirect target for a factory
   * redirection. No node means NO field (absent is honest; `0` is the M59
   * fabrication).
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
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

/**
 * M60 line contract, SYMBOL side (dart lane). The `contains`/`overrides` edges
 * name the DECLARED member, and a WRAPPED declaration puts the name on a later
 * line than the declaration's start (`final void Function(UrlRequest? u,\n
 *     JString? s) _onRedirectReceived;` in cronet_http's generated jni
 * bindings). Keyed by name + range because one declaration node can carry
 * several names (`int a = 1, b = 2`).
 */
function dartNameLineKey(name: string, range: ASTEngine.UniversalSymbol["range"] | undefined): string {
  return `${name}|${range?.startIndex ?? -1}|${range?.endIndex ?? -1}`
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
