function stringIncludes(str: string, val: string): boolean {
  if (!str) return false
  return str.indexOf(val) !== -1
}

function someSymbol(arr: any[], predicate: (s: any) => boolean): boolean {
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return true
  }
  return false
}

// Real Kotlin Intelligence Engine
// AST analysis for Kotlin with Android, Spring Boot, Ktor intelligence

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

export interface KotlinContext {
  content: string
  currentFile: string
  packageStack: string[]
  classStack: string[]
  // KAD5 (M37 kotlin wave): importAliases and annotations were WRITE-ONLY —
  // extractImport/extractAnnotation populated them, nothing ever read them
  // (annotation values reach consumers through symbol metadata instead).
  // Removed dead state; kept currentFile/packageStack/classStack (read).
}

export class RealKotlinAnalyzer implements ASTEngine.LanguageAnalyzer {
  private findChildByType(node: Node, types: string[]): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) {
        for (let j = 0; j < types.length; j++) {
          if (types[j] === c.type) return c
        }
      }
    }
    return null
  }

  analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext): ASTEngine.ParseResult {
    const ctx: KotlinContext = {
      content,
      currentFile: filePath,
      packageStack: [],
      classStack: [],
    }

    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // ========================================================================
    // STAGE 3: RESILIENT PARSING & ERROR NODE BYPASS
    // ========================================================================
    if (rootNode.hasError) {
      const collectErrors = (node: Node) => {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({
            message: `Syntax ${node.type} detected. The Brain Engine is bypassing this broken node.`,
            // 1-based rows/columns, consistent with nodeToRange and every
            // other analyzer (was 0-based: error locations off-by-one).
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column + 1,
            },
            severity: `warning`,
          })
        }
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) collectErrors(child)
        }
      }
      collectErrors(rootNode)
    }

    // PHASE 1: Extract all symbols with proper Kotlin scoping
    this.extractSymbolsWithScoping(rootNode, ctx, symbols, content, undefined, relationships)

    // PHASE 2: Analyze Kotlin relationships (inheritance, data classes, sealed classes)
    this.analyzeRelationships(rootNode, relationships, symbols, ctx)

    // PHASE 3: Process import statements
    this.processImportsExports(rootNode, imports, exports)

    // Fallback text extraction for parser variations that omit field names
    // PHASE 4: Detect Kotlin frameworks (Android, Spring Boot, Ktor, etc.)
    const frameworks = this.detectKotlinFrameworks(content, symbols, imports)
    const patterns = this.detectKotlinPatterns(symbols, relationships, content, rootNode)

    // ========================================================================
    // STAGE 3: PHANTOM SYMBOL INJECTION (Framework Heuristics)
    // Data-class generated members (componentN/copy/equals/hashCode/
    // toString) so calls resolving against them produce real call-graph
    // edges. Phantoms carry metadata.isPhantom and are excluded from
    // exports/override resolution downstream.
    // ========================================================================
    this.injectPhantomSymbols(rootNode, symbols, frameworks, ctx)

    // --- KOTLIN CALL GRAPH EXTRACTION ---
    // Walks the full AST and extracts caller→callee relationships from
    // call_expression nodes. Targets are built from the navigation structure
    // (receiver.selector); stdlib calls are filtered; PascalCase callees are
    // constructor calls → Instantiates (not Calls).
    try {
      const extractKotlinCalls = (n: Node) => {
        // Source attribution walks up to the nearest DECLARATION — not just
        // function_declaration. Calls from class-level contexts (property
        // initializers, init blocks) belong to the enclosing class; calls
        // from secondary constructors belong to the constructor (M14 #419
        // K7 fix — previously these all fell through to the bogus "Global"
        // placeholder).
        const resolveCallSource = (start: Node | null): string => {
          let p: Node | null = start
          while (p) {
            // KAD-MR3 K11: constructor/init calls attribute to the CLASS
            // NAME — the same string the renamed ctor symbol now carries
            // (java C3 family convention), so the edge's source always
            // resolves to a real symbol (the pre-fix bare "constructor"
            // merged every class's ctor calls into one bucket).
            if (p.type === "secondary_constructor" || p.type === "primary_constructor") {
              const cls = p.parent
              const clsName = cls ? this.findChildByType(cls, ["type_identifier", "simple_identifier"])?.text : undefined
              return clsName ?? "constructor"
            }
            // M49/M37 #866: an object_literal (`object : Runnable { ... }`)
            // is its own declaration boundary — a call written in a member
            // initialiser belongs to that anonymous type, NOT to whatever
            // method lexically encloses the literal (the pre-fix answer was
            // the OUTER method `build`, while java/groovy/scala all say the
            // anonymous type). Same derivation as the symbol emitter, so the
            // field symbol and its initialiser call can never disagree.
            if (p.type === "object_literal") {
              return this.anonymousObjectName(p)
            }
            if (p.type === "function_declaration" || p.type === "class_declaration" || p.type === "object_declaration") {
              const nameNode = this.findChildByType(p, ["simple_identifier", "type_identifier"])
              if (nameNode) return nameNode.text
            }
            p = p.parent
          }
          return "Global"
        }
        if (n.type === 'call_expression') {
          const callExpr = this.buildKotlinCallExpression(n)
          const targetName = callExpr
          const leaf = targetName.split(".").pop() || targetName
          // Exact-leaf stdlib filter applies ONLY to receiver-less global
          // calls (listOf(), println()). Qualified calls (list.add(...))
          // have a receiver: suppressing them by bare leaf name deleted real
          // in-project call edges whenever a user method shared a stdlib
          // name (add/map/first/last...) — M14.1 fix.
          const isQualified = targetName.includes(".")
          const isStdlib = this.kotlinStdlibExact.has(targetName) || (!isQualified && this.kotlinStdlibExact.has(leaf))
          if (targetName && targetName !== "print" && targetName !== "println" && !isStdlib) {
            const sourceName = resolveCallSource(n.parent)
            const isPascal = leaf.length > 0 && leaf[0] >= "A" && leaf[0] <= "Z"
            // MEASURED (M14.2, Exposed corpus, 791 kotlin files): qualified
            // PascalCase calls are enum/member accesses, not constructions —
            // 158 occurrences (MySQL.ForShare(, case().When() ...) all
            // fabricated Instantiates edges (~6.5% of instantiation edges),
            // vs 2268 legitimate bare constructions. Restrict the
            // construction heuristic to receiver-less calls; qualified
            // PascalCase is a Calls edge.
            if (isPascal && !isQualified) {
              relationships.push({
                source: sourceName,
                target: leaf,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.7,
                // M59 (#825): the constructed type is named by the callee leaf.
                ...this.lineField(this.calleeLeafNode(n, leaf), n),
                metadata: { kotlinSpecific: true, isInstantiation: true },
              })
            } else {
              relationships.push({
                source: sourceName,
                target: leaf,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.7,
                // M59 (#825): the call is written at the callee leaf.
                ...this.lineField(this.calleeLeafNode(n, leaf), n),
                metadata: { kotlinSpecific: true },
              })
            }
          }
        } else if (n.type === 'constructor_delegation_call') {
          // M14 #419 K2: secondary-constructor delegation — super(...) /
          // this(...) — is a call edge from the constructor. super/this are
          // UNNAMED keyword children (only value_arguments are named), so the
          // receiver is read from node text. The target is the literal
          // keyword, NEVER resolved to a parent type: any guess could
          // fabricate a wrong edge (the class's own extends edge carries the
          // real parent). Confidence 1.0: delegation is structural syntax.
          const text = n.text.trim()
          const sourceName = resolveCallSource(n.parent)
          let target = "super"
          if (text.startsWith("this")) target = "this"
          relationships.push({
            source: sourceName,
            target,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 1.0,
            // M59 (#825): `super(...)`/`this(...)` are unnamed keyword children,
            // so the delegation node's own line is the site that carries it.
            line_number: n.startPosition.row + 1,
            metadata: {
              relationshipType: "constructor_invocation",
              constructorReceiver: target,
              callExpression: text,
            },
          })
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) extractKotlinCalls(child)
        }
      }
      extractKotlinCalls(rootNode)
    } catch (e) {
      // Graceful degradation
    }
    // --- END KOTLIN CALL GRAPH EXTRACTION ---

    // --- DECLARED-TYPE REFERENCE GRAPH ---
    // Every declaration position (constructor params, function params,
    // properties, extension receivers, return types, as-casts, is-checks)
    // references its named types. This graph was silently absent until M14 —
    // the corpus oracle never checked it. Generics expand to base + all
    // arguments; nullable wrappers descend; type_identifiers are the only
    // name-bearing leaves so primitives are correctly silent.
    try {
      this.extractDeclaredTypeRefs(rootNode, relationships)
      this.collectExpressionUses(rootNode, relationships, symbols)
    } catch (e) {
      // Graceful degradation
    }


    // Add Contains + Overrides + DependsOn. `ownerName` is the enclosing type
    // name — NOT scope — so top-level declarations (no owner) never produce a
    // self-contain edge.
    // Pre-built type-index so the override parent lookup is O(1) per method
    // (no per-method symbol scans — the hot path stays linear).
    // KAD-MR3 K15 (M49.K1): enums participate in heritage (KD19), so the
    // override-lookup map holds Class/Interface/Enum — matching the
    // enum-supertype heritage pass exactly.
    const typeIndex = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Interface || s.kind === ASTEngine.SymbolKind.Enum) {
        if (!typeIndex.has(s.name)) typeIndex.set(s.name, s)
      }
    }
    // KAD-MR3 K2: in-file declaration index built ONCE (O(M) total, not
    // per-method — the java C11 lesson). Keyed owner → METHOD NAME →
    // Set<"(T1,T2)" sigs>. The name dimension is the load-bearing one
    // (kotlinx-coroutines BroadcastChannel.kt: SubBroadcastChannel.send must
    // NOT verify against BroadcastChannel merely because the interface
    // declares some OTHER generic-signature method — send comes from the
    // EXTERNAL SendChannel; name-blind sig membership paired it and emitted
    // 8 fabricated 0.9/structural overrides on the corpus).
    const declSigs = new Map<string, Map<string, Set<string>>>()
    for (const t of symbols) {
      if (t.kind !== ASTEngine.SymbolKind.Method || !t.ownerName || t.metadata?.isPhantom) continue
      let nameMap = declSigs.get(t.ownerName)
      if (!nameMap) { nameMap = new Map(); declSigs.set(t.ownerName, nameMap) }
      let set = nameMap.get(t.name)
      if (!set) { set = new Set(); nameMap.set(t.name, set) }
      const tSig = "(" + (t.parameters ?? []).map((p: any) => p.type ?? "").join(",") + ")"
      set.add(tSig)
    }
    for (const s of symbols) {
      const _owner = s.ownerName
      if (_owner) {
        // M59 (#825): a containment edge's navigable site is the member's own
        // declaration line, from the symbol so the two cannot disagree.
        //
        // A SYNTHESISED member has no such site. kotlin's data classes generate
        // componentN/copy/equals/hashCode/toString (`metadata.isPhantom`), and
        // their symbol range is the ENCLOSING CLASS's range — so the edge used to
        // claim the class's line for a name written nowhere, and a tool
        // navigating to `DataHolder.component1` opened the class. Measured on a
        // real file (JsonTestsData.kt): 7 of 8 phantom containment edges named no
        // line containing the name; the same shape reached the store as 16 rows.
        // The line is omitted rather than guessed: unknown is a state, not a
        // placeholder (#820/#821/#823).
        const isSynthetic = s.metadata?.isPhantom === true
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          ...(!isSynthetic && s.range?.startLine ? { line_number: s.range.startLine } : {}),
          metadata: { isContained: true },
        })
      }
      // Overrides: real methods with 'override' modifier, keyed by
      // owner-qualified method name → declaring-parent method name. The
      // parents come from the ENCLOSING CLASS's supertypes (a method symbol
      // does not carry them). Phantom/generated symbols are excluded (their
      // override targets are stdlib, not project symbols).
      //
      // KAD-MR3 K2 (M49.K1 kotlin wave) — override VERIFICATION, closing the
      // weakest machinery in the JVM family (probe: `Sub : Bar()` where Bar
      // never declares foo still emitted Sub.foo→Bar.foo at 0.5, and the
      // GENUINE override could never rise above 0.5 either):
      //   1. IN-FILE BFS (java JD-anon / scala wave convention): the first
      //      ancestor in declaration order that DECLARED the method in this
      //      file verifies at 0.9/evidence structural. Requires a signature
      //      match (payload c) so overloads never pair; ancestors reached
      //      through generic supertypes fall back to name-only (the scala
      //      SCD-E substitution ruling — textual sig comparison is invalid
      //      across type-variable substitution).
      //   2. Anonymous objects (object : Runnable {...}) verify through their
      //      superTypes metadata (already carried by the object_literal
      //      handler) — the same BFS, reached via typeIndex.
      //   3. No verifiable in-file declarer → the deterministic per-file
      //      default (first supertype) stays at 0.5/inferred reasonCode
      //      "first-supertype-guess" — below the consumer threshold, honestly
      //      labeled as the guess it is.
      //   4. Signature payload: metadata.overrideSig carries the normalized
      //      parameter-type list "(T1,T2)" — downstream can now distinguish
      //      overloaded targets without a resolution engine.
      if (
        s.kind === ASTEngine.SymbolKind.Method &&
        s.ownerName &&
        !s.metadata?.isPhantom &&
        s.metadata?.modifiers?.includes?.("override")
      ) {
        const ownerSym = typeIndex.get(s.ownerName)
        const parents: string[] = ownerSym?.metadata?.superTypes ?? []
        const overrideSig =
          s.parameters && s.parameters.length >= 0
            ? "(" + s.parameters.map((p: any) => p.type ?? "").join(",") + ")"
            : undefined
        let overrideParent = parents.length > 0 ? parents[0] : ""
        // Confidence reflects EVIDENCE TIER (patterns.ts filters >= 0.7):
        // verified in-file targets carry project-level evidence; the
        // per-file fallback is a first-supertype GUESS that may not even
        // declare the method, so it must stay below the consumer threshold.
        let confidence = 0.5
        let reasonCode = "first-supertype-guess"
        let evidence = "inferred"
        if (parents.length > 0) {
          // In-file declaration membership test against the hoisted declSigs
          // index. Signatures from method symbols so overload resolution is
          // exact; generic-substituted sigs fall back to name-only.
          const declared = (typeName: string): boolean => {
            const nameMap = declSigs.get(typeName)
            if (!nameMap) return false
            // The parent must declare a method with the SAME NAME first —
            // signature compatibility is only consulted after the name
            // matches (see declSigs comment: name-blind pairing fabricated
            // cross-member overrides on the corpus).
            const sigs = nameMap.get(s.name)
            if (!sigs || sigs.size === 0) return false
            if (overrideSig && sigs.has(overrideSig)) return true
            // No signature on a side (extractor gap) OR a generic type
            // variable in either sig: name-only pairing. A sig carrying a
            // bare capitalized token (T, R) is a type VARIABLE — concrete
            // types (Int, String) still require the exact sig so overloads
            // never pair.
            const hasTypeVar = (sig: string): boolean => {
              const inner = sig.slice(1, -1)
              if (!inner) return false
              for (const tok of inner.split(",")) {
                const t2 = tok.trim()
                if (t2.length === 1 && t2 >= "A" && t2 <= "Z") return true
              }
              return false
            }
            if (!overrideSig) return true
            for (const s2 of sigs) if (hasTypeVar(s2) || hasTypeVar(overrideSig)) return true
            return false
          }
          // BFS over the typeIndex hierarchy (companion-free fallback: the
          // index itself provides getParents from superTypes metadata).
          const queue: string[] = [...parents]
          const seen = new Set<string>()
          let depth = 0
          while (queue.length > 0 && depth < 10) {
            depth++
            const parent = queue.shift()!
            if (seen.has(parent)) continue
            seen.add(parent)
            if (declared(parent)) {
              overrideParent = parent
              confidence = 0.9
              reasonCode = "in-file-verified"
              evidence = "structural"
              break
            }
            const gp = typeIndex.get(parent)?.metadata?.superTypes ?? []
            for (const g of gp) if (!seen.has(g)) queue.push(g)
          }
        }
        if (context?.overrideCompanion && parents.length > 0) {
          const declaring = findDeclaringParent(
            s.name,
            parents,
            context.overrideCompanion,
            (t) => typeIndex.get(t)?.metadata?.superTypes ?? [],
          )
          if (declaring) {
            overrideParent = declaring
            confidence = 0.9
            reasonCode = "companion-index"
            evidence = "structural"
          }
        }
        if (overrideParent) {
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${overrideParent}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence,
            // M59 (#825): the override occurs at the OVERRIDING declaration.
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            metadata: { isOverride: true, overrideParent, reasonCode, evidenceClass: evidence, overrideSig },
          })
        }
      }
    }
    for (const imp of imports) {
      relationships.push({
        source: "root",
        target: imp.module || "",
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        // M59 (#825): the imported module is named on the import statement.
        ...(imp.range?.startLine ? { line_number: imp.range.startLine } : {}),
        metadata: { isImportDep: true },
      })
    }

    // Rewrite import-reference sources from the placeholder "root" to the
    // file's primary top-level type so references carry a symbol identity
    // (imports precede declarations in source order).
    const primaryType = symbols.find((s) => {
      if (s.ownerName) return false
      return s.kind === ASTEngine.SymbolKind.Class ||
             s.kind === ASTEngine.SymbolKind.Interface ||
             s.kind === ASTEngine.SymbolKind.Enum
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && rel.source === "root") {
          rel.source = primaryType.name
        }
      }
    }

    // KAD-MR3 K1 (M49.K1 kotlin wave): an export is TOP-LEVEL public API.
    //   - only declarations WITHOUT an owner export (nested classes / methods
    //     of Outer are members reachable through Outer, not exports — the old
    //     ownerKind===Class hole exported every member: probe "Outer{Inner;foo}")
    //   - private AND internal are excluded (Kotlin: internal is a published
    //     API of the module, not the consumer surface — probe "internal class
    //     Hidden" leaked)
    //   - phantoms/anonymous objects stay excluded (unchanged)
    // Family contract = java JAD3 (public + owner-bearing kinds whitelisted).
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.metadata?.isPhantom || s.metadata?.isAnonymousObject) continue
      if (s.visibility !== "public" && s.visibility !== undefined) continue
      if (s.ownerName) continue
      exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" })
    }
    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: this.calculateRealComplexity(symbols, relationships),
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: this.calculateCyclomaticComplexity(rootNode),
        framework: frameworks[0], // Primary framework
        patterns,

        // Kotlin intelligence metadata
        detectedFrameworks: frameworks,
        frameworkPatterns: this.getKotlinFrameworkPatterns(frameworks, symbols),
        architecturalInsights: this.generateArchitecturalInsights(symbols, relationships),
        architecturalScore: this.calculateArchitecturalScore(symbols, relationships, patterns),
        codeQuality: this.assessKotlinCodeQuality(symbols, relationships, patterns),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.0-infallible-brain",
      },
    }
  }

  /**
   * PHASE 1: Real Kotlin Symbol Extraction with Scoping
   * Understands Kotlin semantics: classes, data classes, sealed classes, objects, functions
   */
  private injectPhantomSymbols(
    rootNode: Node,
    symbols: ASTEngine.UniversalSymbol[],
    frameworks: string[],
    ctx: KotlinContext,
  ): void {
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      let hasData = false;
      // Data flag lives in metadata.modifiers (extractors store modifiers
      // there, not at the top level).
      const symModifiers: string[] = symbol.metadata?.modifiers ?? []
      for (let j = 0; j < symModifiers.length; j++) {
        if (symModifiers[j] === "data") { hasData = true; break }
      }
      if (symbol.kind === ASTEngine.SymbolKind.Class && hasData) {
        const properties: ASTEngine.UniversalSymbol[] = []
        for (let j = 0; j < symbols.length; j++) {
           const s = symbols[j]
           if (s.ownerName === symbol.name && s.kind === ASTEngine.SymbolKind.Property) properties.push(s)
        }

        for (let index = 0; index < properties.length; index++) {
          const prop = properties[index];
          symbols.push({
            name: `component${index + 1}`,
            kind: ASTEngine.SymbolKind.Method,
            scope: symbol.name,
            ownerName: symbol.name,
            modifiers: ["phantom", "data_class_generated", "operator"],
            range: symbol.range,
            parameters: [],
            returnType: prop.returnType || prop.type || "Any",
            metadata: { isPhantom: true },
          })
        }

        const copyParams: any[] = []
        for (let j = 0; j < properties.length; j++) {
           copyParams.push({ name: properties[j].name, type: properties[j].returnType || properties[j].type || "Any" })
        }

        symbols.push({
          name: "copy",
          kind: ASTEngine.SymbolKind.Method,
          scope: symbol.name,
          // M59 (#825): ownerName is what makes the member CONTAINED by its class
          // — the injector set it for componentN but not for copy/equals/hashCode/
          // toString, so `contains Money -> copy` never existed while
          // `contains Money -> component1` did. Same class, same synthesis route,
          // opposite outcomes on a real corpus file (measured on
          // JsonTestsData.kt: 7 componentN containment edges, 0 for the other four
          // members). java's phantoms (lombok/Spring-Data, processPhantomSymbols)
          // have always carried ownerName.
          ownerName: symbol.name,
          modifiers: ["phantom", "data_class_generated"],
          range: symbol.range,
          parameters: copyParams,
          returnType: symbol.name,
          metadata: { isPhantom: true },
        })

        const stdMethods = [
          { name: "equals", type: "Boolean", params: [{ name: "other", type: "Any?" }] },
          { name: "hashCode", type: "Int", params: [] },
          { name: "toString", type: "String", params: [] },
        ]

        for (let j = 0; j < stdMethods.length; j++) {
          const method = stdMethods[j]
          symbols.push({
            name: method.name,
            kind: ASTEngine.SymbolKind.Method,
            scope: symbol.name,
            // Same ownerName gap as `copy` above (M59 #825): without it these
            // three generated overrides were the only members of the data class
            // with no containment edge at all.
            ownerName: symbol.name,
            modifiers: ["phantom", "data_class_generated", "override"],
            range: symbol.range,
            parameters: method.params,
            returnType: method.type,
            metadata: { isPhantom: true },
          })
        }
      }
    }
  }

  private extractSymbolsWithScoping(
    node: Node,
    ctx: KotlinContext,
    symbols: ASTEngine.UniversalSymbol[],
    content: string,
    parentClass?: string,
    relationships?: ASTEngine.UniversalRelationship[],
  ): void {
    const stack: { n: Node; pClass?: string; isPop?: boolean; name?: string }[] = [{ n: node, pClass: parentClass }]

    while (stack.length > 0) {
      const entry = stack.pop()!
      if (entry.isPop) {
        if (entry.name) {
          ctx.classStack.pop()
        }
        continue
      }

      const n = entry.n
      const pClass = entry.pClass
      let nextParentClass = pClass
      let pushedName: string | undefined = undefined

      switch (n.type) {
        case "function_declaration":
          this.extractFunction(n, symbols, ctx, pClass)
          break
        case "class_declaration": {
          const isInterface = someSymbol(n.children, (c) => c?.type === "interface")
          const isEnum = someSymbol(n.children, (c) => c?.type === "enum")
          const cName = this.findChildByType(n, ["type_identifier", "simple_identifier"])?.text
          if (cName) {
            ctx.classStack.push(cName)
            pushedName = cName
            nextParentClass = cName
          }
          if (isInterface) {
            this.extractInterface(n, symbols, ctx, pClass)
          } else if (isEnum) {
            this.extractEnumClass(n, symbols, ctx, pClass)
          } else {
            this.extractClass(n, symbols, ctx, pClass)
          }
          break
        }
        case "object_declaration": {
          const oName = this.findChildByType(n, ["type_identifier", "simple_identifier"])?.text
          if (oName) {
            ctx.classStack.push(oName)
            pushedName = oName
            nextParentClass = oName
          }
          this.extractObject(n, symbols, ctx, pClass)
          break
        }
        case "property_declaration":
          this.extractProperty(n, symbols, ctx, pClass, relationships)
          break
        case "primary_constructor":
        case "constructor_declaration":
        case "secondary_constructor":
          this.extractConstructor(n, symbols, ctx, pClass)
          break
        case "package_header":
          this.extractPackage(n, ctx)
          break
        case "import_header":
          this.extractImport(n, ctx)
          break
        case "annotation":
          this.extractAnnotation(n, symbols, ctx)
          break
        case "type_alias": {
          // M14 #419 K5: typealias Fn = (Int) -> String declares a type
          // symbol (kind 'type', matching the JVM-family record/typealias
          // convention). The aliased RHS types are referenced separately by
          // extractDeclaredTypeRefs.
          const tName = this.findChildByType(n, ["type_identifier", "simple_identifier"])
          if (tName) {
            const tModifiers = this.extractModifiers(n, ctx)
            symbols.push({
              name: tName.text,
              kind: ASTEngine.SymbolKind.Type,
              range: this.symbolRange(n),
              scope: this.currentScope(ctx),
              visibility: this.determineVisibility(tModifiers, ctx),
              ownerName: pClass,
              ownerKind: pClass ? ASTEngine.SymbolKind.Class : undefined,
              decorators: this.extractAnnotations(n, ctx),
              metadata: {
                modifiers: tModifiers,
                annotations: this.extractAnnotations(n, ctx).map((a) => this.kotlinShortAnnotationName(a)),
                isTypeAlias: true,
                kotlinSpecific: true,
              },
            })
          }
          break
        }
        case "object_literal": {
          // M14 #419 K6: an anonymous object (object : Runner { ... }) is a
          // real runtime type. It gets a symbol named after its implemented
          // supertype (anonymous_* — the established noise convention, so it
          // never leaks into the index) and its contained members attribute
          // to it instead of the enclosing class (the previous P->go
          // contains edge was a misattribution). The supertype reference
          // edge is emitted by extractDeclaredTypeRefs.
          const deleg = this.findChildByType(n, ["delegation_specifier"])
          let superName: string | undefined
          if (deleg) {
            // The supertype name is read through the shared derivation below
            // (single source of truth, shared with the call-source resolver).
            const findType = (node: Node): Node | null => {
              if (node.type === "type_identifier") return node
              for (let i = 0; i < node.namedChildCount; i++) {
                const c = node.namedChild(i)
                if (c) { const r = findType(c); if (r) return r }
              }
              return null
            }
            const tId = findType(deleg)
            if (tId) superName = tId.text
          }
          const anonName = this.anonymousObjectName(n)
          // M49/M37 #867: who OWNS the anonymous type. The census over all four
          // JVM analyzers measured kotlin alone reporting the enclosing CLASS
          // for a literal declared inside a method, while java/groovy/scala all
          // report the enclosing method. Ruled: ownerName = the innermost
          // enclosing DECLARATION (java/groovy/scala already do this; a type
          // declared in a method body is scoped to that method, not a member of
          // the class). Kotlin reported the class only because this walker
          // carries `pClass` and no function context, not by design.
          const anonOwner = this.anonymousObjectOwner(n, pClass)
          ctx.classStack.push(anonName)
          pushedName = anonName
          nextParentClass = anonName
          symbols.push({
            name: anonName,
            kind: ASTEngine.SymbolKind.Class,
            range: this.symbolRange(n),
            scope: this.currentScope(ctx),
            visibility: this.determineVisibility(this.extractModifiers(n, ctx), ctx),
            ownerName: anonOwner.name,
            ownerKind: anonOwner.kind,
            decorators: this.extractAnnotations(n, ctx),
            metadata: {
              modifiers: [],
              annotations: this.extractAnnotations(n, ctx).map((a) => this.kotlinShortAnnotationName(a)),
              isObject: true,
              isAnonymousObject: true,
              superTypes: superName ? [superName] : [],
              superTypesAreConstructorCalls: superName ? [false] : [],
              kotlinSpecific: true,
            },
          })
          break
        }
      }

      // Schedule the pop if we pushed to ctx.classStack
      if (pushedName) {
        stack.push({ n: n, isPop: true, name: pushedName })
      }

      // Push children uniformly!
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) {
          stack.push({ n: child, pClass: nextParentClass })
        }
      }
    }
  }

  /**
   * Extract Kotlin function with extension functions and suspend functions
   */
  private extractFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const functionName = nameNode.text
    const qualifiedName = this.buildQualifiedName(functionName, ctx, parentClass)

    // Extract modifiers
    const modifiers = this.extractModifiers(node, ctx)

    // Extract parameters with Kotlin features (default values, named parameters)
    const parameters = this.extractKotlinParameters(node, ctx)

    // Extract return type
    const returnType = this.extractReturnType(node, ctx)

    // Extract receiver type (for extension functions)
    const receiverType = this.extractReceiverType(node, ctx)

    // Find function calls within this function
    const qualifiedCalls = this.findKotlinFunctionCalls(node, ctx)

    // Extract annotations
    const annotations = this.extractAnnotations(node, ctx)

    // Extract KDoc comments
    const kdoc = this.extractKDocComment(node, ctx)

    // Determine function characteristics
    const visibility = this.determineVisibility(modifiers, ctx)
    let isInline = false, isInfix = false, isOperator = false, isSuspend = false
    for (let i = 0; i < modifiers.length; i++) {
      if (modifiers[i] === "inline") isInline = true
      else if (modifiers[i] === "infix") isInfix = true
      else if (modifiers[i] === "operator") isOperator = true
      else if (modifiers[i] === "suspend") isSuspend = true
    }
    const isExtension = !!receiverType

    // Extract API Contract Path if this is a web handler (Spring/Ktor)
    const apiContract = this.extractKotlinApiContract(node, ctx)
    const apiContractPath = apiContract.path
    const apiMethod = apiContract.method

    // function-level generics: fun <U> identity(x: U) — previously dropped
    const fnTypeParameters = this.extractTypeParameters(node, ctx)

    const symbol: ASTEngine.UniversalSymbol = {
      name: functionName,
      kind: parentClass ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
      range: this.symbolRange(node),
      scope: this.currentScope(ctx),
      visibility,
      isAsync: isSuspend,
      parameters,
      returnType,
      decorators: annotations,
      // Top-level per family contract: the DB ingester reads
      // symbol.complexity (|| 1) for gravity scoring — metadata-only values
      // left every kotlin symbol at complexity 1 in the index.
      complexity: this.calculateFunctionComplexity(node, ctx),
      comments: kdoc ? [kdoc] : [],
      qualified_calls: qualifiedCalls,
      apiContractPath,
      genericParameters: fnTypeParameters.length > 0 ? fnTypeParameters : undefined,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        receiverType,
        apiMethod,
        isInline,
        isInfix,
        isOperator,
        isSuspend,
        isExtension,
        complexity: this.calculateFunctionComplexity(node, ctx),
        parameterCount: parameters.length,
        hasKDoc: !!kdoc,
        ...(fnTypeParameters.length > 0 ? { typeParameters: fnTypeParameters } : {}),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  /**
   * Spring mapping annotation extraction. Returns the route PATH ONLY and
   * the HTTP method separately: brain_symbol.api_contract_path is an exact
   * match key shared across languages (doc-engine queries
   * s.api_contract_path=?), so embedding "GET " into it breaks every
   * cross-language route join against analyzers that store bare paths.
   */
  private extractKotlinApiContract(node: Node, ctx: KotlinContext): { path?: string; method?: string } {
    // Two annotation shapes occur under the pinned kotlin wasm:
    //   a) modifiers > annotation > constructor_invocation > value_arguments
    //      (AST args available)
    //   b) the ENTIRE annotation collapsed into a leaf `modifiers` node whose
    //      text is '@GetMapping("/users")' - no annotation child exists.
    // Both must be handled or Spring/Ktor route paths silently vanish.
    const MAPPINGS = ["@GetMapping", "@PostMapping", "@PutMapping", "@DeleteMapping", "@PatchMapping", "@RequestMapping"]

    const candidates: { text: string; args?: Node }[] = []
    const modifiersNode = this.findChildByType(node, ["modifiers"])
    if (modifiersNode) {
      const stack: Node[] = [modifiersNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "annotation") candidates.push({ text: n.text, args: this.getValueArguments(n) })
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      if (candidates.length === 0 && modifiersNode.text.includes("Mapping")) {
        candidates.push({ text: modifiersNode.text })
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const mod = node.namedChild(i)
      if (mod?.type === "annotation") candidates.push({ text: mod.text, args: this.getValueArguments(mod) })
    }

    for (const { text, args } of candidates) {
      // Compare by AST-resolved SHORT name: fully-qualified annotations
      // (@org.springframework.web.bind.annotation.GetMapping) do not carry a
      // "@GetMapping" prefix in their raw text.
      const shortName = this.kotlinShortAnnotationName(text)
      const mapping = MAPPINGS.find((m) => shortName === m.slice(1))
      if (!mapping) continue

      const method = mapping.slice(1).replace("Mapping", "").toUpperCase()
      let path = "/"

      if (args && args.namedChildCount > 0) {
        // KAD-MR3 E6 (M49.K1 wave): uniform named-argument walk. The old code
        // had a value=/method= branch ONLY for @RequestMapping and a raw
        // first-arg fallback for the typed mappings — `@GetMapping(value =
        // "/x")` produced apiContractPath "value = /x" (probe-verified),
        // silently breaking every cross-language route join. Grammar probe:
        // every argument is a value_argument whose children are [name?,
        // expression]; paths live in string literals — positional
        // ("/z"), named (value = "/x"), arrays (value = ["/p","/q"],
        // arrayOf("/a","/b")), and the RequestMethod.X enum value.
        let methodStr = "ANY"
        const paths: string[] = []
        for (let j = 0; j < args.namedChildCount; j++) {
          const arg = args.namedChild(j)
          if (!arg || arg.type !== "value_argument") continue
          // Split the argument into its name (simple_identifier) and its
          // value expression (everything after it).
          let name = ""
          let expr: Node | null = null
          for (let k = 0; k < arg.namedChildCount; k++) {
            const c = arg.namedChild(k)
            if (!c) continue
            if (c.type === "simple_identifier" && !expr) name = c.text
            else if (!expr) expr = c
          }
          const isRequestMethod = name === "method" || (!name && stringIncludes(arg.text, "method"))
          if (isRequestMethod) {
            // RequestMethod.GET — the enum member is the last identifier
            // segment of the argument text (navigation_expression leaf).
            const segs = arg.text.split(".")
            if (segs.length > 1) methodStr = segs[segs.length - 1].toUpperCase()
            continue
          }
          // Path values: named `value`/`path`, or positional.
          if (name && name !== "value" && name !== "path") continue
          if (!expr) continue
          if (expr.type === "string_literal") {
            paths.push(expr.text.split('"').join(""))
          } else if (expr.type === "collection_literal") {
            for (let k = 0; k < expr.namedChildCount; k++) {
              const e = expr.namedChild(k)
              if (e?.type === "string_literal") paths.push(e.text.split('"').join(""))
            }
          } else if (expr.type === "call_expression") {
            // arrayOf("/a", "/b") — string literals among the call's
            // value_arguments.
            for (let k = 0; k < expr.namedChildCount; k++) {
              const inner = expr.namedChild(k)
              if (inner?.type !== "call_suffix") continue
              for (let m2 = 0; m2 < inner.namedChildCount; m2++) {
                const va = inner.namedChild(m2)
                if (va?.type !== "value_arguments") continue
                for (let m3 = 0; m3 < va.namedChildCount; m3++) {
                  const e = va.namedChild(m3)
                  if (e?.type === "string_literal") paths.push(e.text.split('"').join(""))
                }
              }
            }
          }
        }
        if (paths.length > 0) path = paths[0]
        if (methodStr !== "ANY") {
          return { path, method: methodStr }
        }
        return { path, method }
      }

      // leaf-modifier fallback: parse from raw text (leaf `modifiers` node —
      // no annotation child exists). KAD-MR3 E6b: the two regexes
      // (/"([^"]*)"/, /RequestMethod\.([A-Za-z]+)/) are replaced with char
      // walks — the M12/R2 no-regex census contract.
      const afterName = text.slice(mapping.length)
      const firstQuote = afterName.indexOf('"')
      if (firstQuote !== -1) {
        const close = afterName.indexOf('"', firstQuote + 1)
        if (close !== -1) path = afterName.slice(firstQuote + 1, close)
      }
      if (mapping !== "@RequestMapping") return { path, method }
      const rmIdx = afterName.indexOf("RequestMethod.")
      if (rmIdx !== -1) {
        let end = rmIdx + "RequestMethod.".length
        while (end < afterName.length) {
          const ch = afterName[end]!
          const isAlpha = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")
          if (!isAlpha) break
          end++
        }
        const mname = afterName.slice(rmIdx + "RequestMethod.".length, end)
        if (mname) return { path, method: mname.toUpperCase() }
      }
      return { path, method: "ANY" }
    }
    return {}
  }

  /**
   * Extract Kotlin class with data classes, sealed classes, and inner classes
   */
  private extractClass(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const className = nameNode.text
    const qualifiedName = this.buildQualifiedName(className, ctx, parentClass)

    // Extract modifiers
    const modifiers = this.extractModifiers(node, ctx)

    // Extract inheritance and interfaces
    const superTypes = this.extractSuperTypes(node, ctx)
    const superTypeKinds = this.extractSuperTypesWithKinds(node)

    // Extract type parameters (generics)
    const typeParameters = this.extractTypeParameters(node, ctx)

    // Extract annotations
    const annotations = this.extractAnnotations(node, ctx)

    // Extract KDoc
    const kdoc = this.extractKDocComment(node, ctx)

    // Determine class characteristics
    const visibility = this.determineVisibility(modifiers, ctx)
    let isData = false, isSealed = false, isAbstract = false, isInner = false, isOpen = false
    for (let i = 0; i < modifiers.length; i++) {
      if (modifiers[i] === "data") isData = true
      else if (modifiers[i] === "sealed") isSealed = true
      else if (modifiers[i] === "abstract") isAbstract = true
      else if (modifiers[i] === "inner") isInner = true
      else if (modifiers[i] === "open") isOpen = true
    }

    const symbol: ASTEngine.UniversalSymbol = {
      name: className,
      kind: ASTEngine.SymbolKind.Class,
      range: this.symbolRange(node),
      // Scope = package + enclosing types, EXCLUDING this class's own name,
      // so a class is never a container of itself.
      scope: this.enclosingScope(ctx),
      visibility,
      isAbstract,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      comments: kdoc ? [kdoc] : [],
      metadata: {
        modifiers,
        // Short annotation names (last dotted segment) so framework pattern
        // detection matches fully-qualified annotations exactly like bare ones.
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        superTypes,
        superTypesAreConstructorCalls: superTypeKinds.map((s) => s.isConstructorCall),
        // M59 (#825): parallel line array — one line per supertype, in the
        // same order. Heritage edges take their line from here, not from the
        // class header (which names only the first supertype).
        superTypeLines: superTypeKinds.map((s) => s.line),
        inheritance: superTypes,
        typeParameters,
        isData,
        isDataClass: isData,
        isSealed,
        isInner,
        isOpen,
        methodCount: this.countMethods(node, ctx),
        propertyCount: this.countProperties(node, ctx),
        hasCompanionObject: this.hasCompanionObject(node, ctx),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    // Push class to stack for member extraction
  }

  /**
   * Extract Kotlin object (singleton)
   */
  private extractObject(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string) {
    const nameNode = this.findChildByType(node, ["type_identifier", "simple_identifier"])
    if (!nameNode) return

    const objectName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const superTypes = this.extractSuperTypes(node, ctx)
    const superTypeKinds = this.extractSuperTypesWithKinds(node)
    const annotations = this.extractAnnotations(node, ctx)

    const symbol: ASTEngine.UniversalSymbol = {
      name: objectName,
      kind: ASTEngine.SymbolKind.Class, // Using Class for objects
      range: this.symbolRange(node),
      scope: this.enclosingScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        superTypes,
        superTypesAreConstructorCalls: superTypeKinds.map((s) => s.isConstructorCall),
        // M59 (#825): parallel line array — one line per supertype.
        superTypeLines: superTypeKinds.map((s) => s.line),
        isObject: true,
        isCompanionObject: (() => { for (let i = 0; i < modifiers.length; i++) if (modifiers[i] === "companion") return true; return false; })(),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  /**
   * M49/M37 #867: the DECLARATION that owns an anonymous type — the innermost
   * enclosing `function_declaration` when the literal sits inside one, and the
   * enclosing class (`pClass`) otherwise.
   *
   * Ruled language-wide (not just here): `ownerName` = innermost enclosing
   * declaration. Three of the four JVM analyzers already did that before this
   * ruling — java's own source comment claimed to "mirror the kotlin family
   * convention exactly" while its code used the enclosing declaration, so the
   * comment and the majority disagreed and kotlin was the outlier. Lambdas and
   * `init` blocks are not declarations: a literal inside one is still owned by
   * the enclosing function/class, matching java (which pushes no context for a
   * lambda either).
   */
  private anonymousObjectOwner(node: Node, pClass?: string): { name?: string; kind?: ASTEngine.SymbolKind } {
    let ancestor = node.parent
    while (ancestor && ancestor.type !== "source_file") {
      if (ancestor.type === "function_declaration") {
        const nameNode = this.findChildByType(ancestor, ["simple_identifier"])
        // `method`, not `function`: this analyzer emits every function_declaration
        // symbol as ASTEngine.SymbolKind.Method, and the owner kind must agree
        // with the syntax that names it (java/groovy/scala all report `method`
        // for the same context).
        if (nameNode) return { name: nameNode.text, kind: ASTEngine.SymbolKind.Method }
        break
      }
      // A nested class starts a fresh ownership scope: the inner literal's
      // owner is the inner type, never a method of the outer one.
      if (ancestor.type === "class_declaration" || ancestor.type === "object_declaration") break
      ancestor = ancestor.parent
    }
    return { name: pClass, kind: pClass ? ASTEngine.SymbolKind.Class : undefined }
  }

  /**
   * M49/M37 #866: the name an anonymous object's members — and the calls made
   * from them — attribute to. ONE derivation, shared by the symbol emitter and
   * the call-source resolver, so a field symbol and its initialiser call can
   * never disagree about which type they belong to (java/groovy convention:
   * `anonymous_<SuperName>`).
   */
  private anonymousObjectName(node: Node): string {
    const deleg = this.findChildByType(node, ["delegation_specifier"])
    let superName: string | undefined
    if (deleg) {
      // The type identifier is nested (delegation_specifier -> user_type ->
      // type_identifier), so findChildByType's direct-children scan is
      // insufficient — recurse for the first type_identifier.
      const findType = (n: Node): Node | null => {
        if (n.type === "type_identifier") return n
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) { const r = findType(c); if (r) return r }
        }
        return null
      }
      const tId = findType(deleg)
      if (tId) superName = tId.text
    }
    return superName ? `anonymous_${superName}` : "anonymous_object"
  }

  /**
   * Extract Kotlin property with getters/setters and delegation
   */
  private extractProperty(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string, relationships?: ASTEngine.UniversalRelationship[]) {
    // Locals inside a function body are not project-level symbols. The scan
    // stops at the nearest DECLARATION: class_declaration / object_declaration
    // and now object_literal — a `val` that is a member of an anonymous class
    // body is a MEMBER, even though it is lexically inside the enclosing
    // method (M49/M37 #866: the scan previously walked straight past the
    // literal, hit that method, and dropped the field entirely — java and
    // groovy emit it as `property field owner=anonymous_Runnable`).
    let ancestor = node.parent
    while (ancestor && ancestor.type !== "class_declaration" && ancestor.type !== "object_declaration" && ancestor.type !== "object_literal" && ancestor.type !== "source_file") {
      if (ancestor.type === "function_declaration") return
      ancestor = ancestor.parent
    }

    const declarationNode = this.findChildByType(node, ["variable_declaration"])
    const nameNode = declarationNode
      ? this.findChildByType(declarationNode, ["simple_identifier", "type_identifier"])
      : this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const propertyName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const propertyType = this.extractPropertyType(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    // Analyze property characteristics
    const isVal = this.isValProperty(node)
    const isVar = this.isVarProperty(node)
    let isLateInit = false, isConst = false
    for (let i = 0; i < modifiers.length; i++) {
      if (modifiers[i] === "lateinit") isLateInit = true
      if (modifiers[i] === "const") isConst = true
    }
    const hasDelegate = this.hasDelegate(node)

    // Extension properties: `val String.lastChar: Char` — a user_type receiver
    // appears BEFORE the simple_identifier, exactly like extension functions.
    // Previously invisible: no isExtension marker, no relationship (M14.1 fix;
    // positional because the pinned kotlin wasm exposes zero named fields).
    let extensionReceiver: string | undefined
    let extensionReceiverNode: Node | undefined
    {
      // Field-first, same contract as extractReceiverType (#382 item 3):
      // `val String.len2: Int` resolves `receiver` to "String" on the pinned
      // wasm; the positional scan below is the fallback for builds that do not
      // declare the field.
      let receiverNode: any = node.childForFieldName("receiver")
      for (let i = 0; receiverNode == null && i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c?.type === "simple_identifier") break
        // Upstream grammar (>= wasm 2026-08) wraps the extension receiver in
        // a dedicated receiver_type node; older pinned builds exposed a bare
        // user_type. Both handled.
        if (
          c?.type === "receiver_type" ||
          c?.type === "user_type" ||
          c?.type === "nullable_type" ||
          c?.type === "type_identifier"
        ) {
          receiverNode = c
          break
        }
      }
      if (receiverNode) {
        const t = receiverNode.text
        extensionReceiver = t.endsWith("?") ? t.slice(0, -1) : t
        // M59 (#825): kept so the extension edge can name the line the receiver
        // TYPE is written on rather than the declaration's line.
        extensionReceiverNode = receiverNode
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      name: propertyName,
      kind: ASTEngine.SymbolKind.Property,
      range: this.symbolRange(node),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      decorators: annotations,
      returnType: propertyType,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        propertyType,
        isVal,
        isVar,
        isLateInit,
        isConst,
        hasDelegate,
        hasCustomGetter: this.hasCustomGetter(node),
        hasCustomSetter: this.hasCustomSetter(node),
        ...(extensionReceiver ? { isExtension: true, extensionReceiver } : {}),
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    if (extensionReceiver && relationships) {
      relationships.push({
        source: propertyName,
        target: extensionReceiver,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        // M59 (#825): the receiver type is named by its receiver node.
        ...this.lineField(extensionReceiverNode, node),
        metadata: {
          relationshipType: "kotlin_extension_property",
          isExtension: true,
        },
      })
    }
  }

  /**
   * Kotlin-specific framework detection
   */
  private detectKotlinFrameworks(
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
  ): string[] {
    const frameworks: Record<string, boolean> = {}
    const hasImport = (pkg: string) => {
      for (let i = 0; i < imports.length; i++) {
        const mod = imports[i].module
        if (mod && (mod.startsWith(pkg) || mod === pkg)) return true
      }
      return false
    }

    if (hasImport("org.springframework") || hasImport("org.springframework.boot")) {
      frameworks["Spring Boot"] = true
      frameworks["Spring Framework"] = true
    }
    if (hasImport("io.ktor")) frameworks["Ktor"] = true
    if (hasImport("io.micronaut")) frameworks["Micronaut"] = true
    if (hasImport("io.reactivex.rxjava2") || hasImport("io.reactivex.rxjava3")) frameworks["RxJava"] = true
    if (hasImport("org.hibernate") || hasImport("javax.persistence") || hasImport("jakarta.persistence"))
      frameworks["Hibernate / JPA"] = true
    if (hasImport("kotlinx.coroutines")) frameworks["Kotlin Coroutines"] = true
    if (hasImport("org.junit") || hasImport("kotlin.test")) frameworks["JUnit"] = true
    if (hasImport("io.mockk") || hasImport("org.mockito")) frameworks["Mocking Framework"] = true
    if (hasImport("androidx.compose")) frameworks["Jetpack Compose"] = true
    if (hasImport("android.app") || hasImport("androidx")) frameworks["Android SDK"] = true

    // Annotation-driven detection: real-world files frequently use
    // fully-qualified annotations WITHOUT the corresponding import (conflict
    // avoidance, generated code). Imports alone missed every such file.
    // Names compared through metadata.annotations short names.
    const annotationNames = new Set<string>()
    for (let i = 0; i < symbols.length; i++) {
      const anns: string[] = symbols[i].metadata?.annotations ?? []
      for (let j = 0; j < anns.length; j++) annotationNames.add(anns[j])
    }
    const hasAnnotation = (...names: string[]) => names.some((n) => annotationNames.has(n))
    if (hasAnnotation("Service", "RestController", "Controller", "Repository", "Component", "SpringBootApplication")) {
      frameworks["Spring Boot"] = true
      frameworks["Spring Framework"] = true
    }
    if (hasAnnotation("Entity", "Table")) frameworks["Hibernate / JPA"] = true
    if (hasAnnotation("Dao", "Database")) frameworks["Room"] = true
    if (hasAnnotation("Composable")) frameworks["Jetpack Compose"] = true
    if (hasAnnotation("Test", "RunWith", "ExtendWith")) frameworks["JUnit"] = true

    const result: string[] = []
    for (const key in frameworks) {
      if (Object.prototype.hasOwnProperty.call(frameworks, key)) {
        result.push(key)
      }
    }
    return result
  }



  /**
   * Detect Kotlin-specific patterns
   */
  private detectKotlinPatterns(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    content: string,
    rootNode?: Node,
  ): string[] {
    const patterns: string[] = []

    let hasData = false, hasSealed = false, hasExtension = false, hasSuspend = false, hasDelegate = false, hasCompanion = false, hasOperator = false
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.metadata?.isData) hasData = true
      if (s.metadata?.isSealed) hasSealed = true
      if (s.metadata?.isExtension) hasExtension = true
      if (s.metadata?.isSuspend) hasSuspend = true
      if (s.metadata?.hasDelegate) hasDelegate = true
      if (s.metadata?.hasCompanionObject || s.metadata?.isCompanionObject) hasCompanion = true
      if (s.metadata?.isOperator) hasOperator = true
    }

    if (hasData) patterns.push("Data Classes")
    if (hasSealed) patterns.push("Sealed Classes")
    if (hasExtension) patterns.push("Extension Functions")
    if (hasSuspend) patterns.push("Coroutines")
    // KAD-MR3 K10 (M49.K1 wave): text.includes("?")/"is "/"->"/"let"/"by "
    // matched COMMENTS, STRINGS and IDENTIFIERS — probe: "// this is a test"
    // fabricated Smart Casts; a method named `letIt` fabricated Higher-Order
    // Functions. Every textual flag is now gated on the AST node the pattern
    // actually means (probed grammar shapes: check_expression = is/!is,
    // navigation + quest = ?., postfix ! - = !!, elvis_expression = ?:,
    // lambda_literal/anonymous_function = lambdas, delegation_specifier
    // text containing " by " = delegation).
    const astHas = new Map<string, boolean>()
    const scanAst = (n: Node): void => {
      switch (n.type) {
        case "check_expression": astHas.set("is", true); break
        case "elvis_expression": astHas.set("elvis", true); break
        case "lambda_literal":
        case "anonymous_function": astHas.set("lambda", true); break
      }
      if (n.type === "navigation_expression") {
        for (let i = 0; i < n.namedChildCount; i++) {
          if (n.namedChild(i)?.type === "quest") astHas.set("nullsafe", true)
        }
      }
      if (n.type === "postfix_expression" && n.text.endsWith("!!")) astHas.set("notnull", true)
      if (n.type === "delegation_specifier" && stringIncludes(n.text, " by ")) astHas.set("by", true)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) scanAst(c)
      }
    }
    if (rootNode) scanAst(rootNode)
    if (astHas.get("nullsafe") || astHas.get("notnull") || astHas.get("elvis")) patterns.push("Null Safety")
    if (astHas.get("is")) patterns.push("Smart Casts")
    if (astHas.get("lambda")) patterns.push("Higher-Order Functions")
    if (hasDelegate || astHas.get("by")) {
      patterns.push("Delegation")
      patterns.push("Property Delegation")
    }
    if (stringIncludes(content, "buildString {")) patterns.push("DSL Patterns")
    if (stringIncludes(content, "@GetMapping") || stringIncludes(content, "@PostMapping") || stringIncludes(content, "@RequestMapping")) patterns.push("REST API")
    if (hasCompanion) patterns.push("Companion Objects")
    if (hasOperator) patterns.push("Operator Overloading")

    return patterns
  }

  private extractKotlinParameters(node: Node, ctx: KotlinContext): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []

    let paramsNode = this.findChildByType(node, ["function_value_parameters"])
    if (!paramsNode) return parameters
    // KAD-MR3 K9 (grammar-probe decisive): default expressions are SIBLINGS
    // of `parameter` nodes inside function_value_parameters — children
    // ALTERNATE [parameter, default?, parameter, default?...]. A default is
    // any non-parameter child following a parameter (call_expression,
    // string_literal, null_literal, prefix_expression, ...). The old fix
    // (namedChildCount>2 on the parameter) never fired — and the original
    // 4-literal whitelist silently reported isOptional:false on defaulted
    // params like `= compute()`, `= null`, `= -1`.
    const kids: Node[] = []
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const c = paramsNode.namedChild(i)
      if (c) kids.push(c)
    }
    for (let i = 0; i < kids.length; i++) {
      const paramNode = kids[i]!
      if (paramNode.type !== "parameter") continue
      const next = kids[i + 1]
      const defaultNode = next && next.type !== "parameter" ? next : null
      const nameNode = this.findChildByType(paramNode, ["simple_identifier"])
      const typeNode = this.findChildByType(paramNode, ["user_type", "nullable_type", "type_identifier"])
      if (nameNode) {
        parameters.push({
          name: nameNode.text,
          type: typeNode ? this.cleanKotlinType(typeNode.text) : undefined,
          isOptional: !!defaultNode,
          defaultValue: defaultNode ? defaultNode.text : undefined,
        })
      }
    }
    return parameters
  }

  private buildQualifiedName(name: string, ctx: KotlinContext, parentClass?: string): string {
    const scope = parentClass || this.currentScope(ctx)
    return scope ? `${scope}.${name}` : name
  }

  private currentScope(ctx: KotlinContext): string {
    return [...ctx.packageStack, ...ctx.classStack].join(".")
  }

  /**
   * Scope of a type declaration = package + ENCLOSING types, excluding the
   * declaration's own name (which has already been pushed onto classStack by
   * the time the extractor runs). A container must never contain itself.
   */
  private enclosingScope(ctx: KotlinContext): string {
    const enclosing = ctx.classStack.slice(0, ctx.classStack.length - 1)
    return [...ctx.packageStack, ...enclosing].join(".")
  }

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Tiers: structural (grammar clauses, conf 1.0) | usage_contextual (calls,
   * field access, companion-apply idioms) | import_based | reference_qualified
   * | inferred (sub-1.0 resolutions). Applied centrally at end of analyze()
   * so no emission site can forget it.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") {
        // KAD-MR3 K18: contains edges whose own emitter labeled them
        // "heuristic" (the compose PascalCase guess) keep that label — the
        // old blanket "structural" made a naming heuristic indistinguishable
        // from verified containment. Verified contains edges still default
        // to structural.
        md.evidenceClass = md.relationshipType === "compose_ui_tree" ? "heuristic" : "structural"
        continue
      }
      if (t === "references") {
        // isImportDep: kotlin/scala import edges carry this flag (M14 #419
        // K8 — the JVM-family tier bug: the classifier only recognized
        // isImport/isGroovyImport/isJavaImport, so kotlin import edges were
        // mislabeled reference_qualified).
        md.evidenceClass = (md.isImport || md.isImportDep) ? "import_based" : "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements") {
        md.evidenceClass = conf >= 1 ? "structural" : "inferred"
        continue
      }
      if (t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = md.isNew || conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }


  /**
   * M59 (#825): the `line_number` field for a relationship, taken from the node
   * that CARRIES THE NAME the edge is about. java and scala settled this rule
   * (the line belongs to the name, never to the construct that contains it) and
   * kotlin shares their node shapes, so it is the same contract, ported.
   *
   * Returns nothing at all when no node is available — never 0: #820/#821, a
   * stored 0 is a claim that the relationship occurs on line 0.
   */
  private lineField(nameNode: Node | null | undefined, fallback?: Node | null): { line_number?: number } {
    const n = nameNode ?? fallback
    return n ? { line_number: n.startPosition.row + 1 } : {}
  }

  /**
   * M59 (#825): the node that NAMES a kotlin call.
   *
   * Measured from the pinned wasm rather than assumed: a kotlin
   * `call_expression`'s named children are `navigation_expression` and
   * `call_suffix`, and the navigation expression SPANS the receiver — for
   * `s\n .trim()\n .toUpperCase()` the node opens on line 5 while
   * `.toUpperCase()` (the name, and the `()` that follows it) is written on 7.
   * The last identifier inside the navigation expression is the callee leaf,
   * which is where the call is written.
   */
  private calleeLeafNode(callNode: Node, leafText?: string): Node | null {
    const nav = callNode.namedChild(0)
    if (!nav) return null
    let last: Node | null = null
    let legacyLast: Node | null = null
    let leafHit: Node | null = null
    const visit = (n: Node, recordLeaf: boolean): void => {
      if (n.type === "simple_identifier" || n.type === "type_identifier") {
        last = n
        if (recordLeaf && leafText !== undefined && n.text === leafText) leafHit = n
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, recordLeaf)
      }
    }
    // Legacy domain first: the callee head. A last-match here is the true
    // callee for every well-formed shape, and restricting the leaf search to
    // the head means a same-named argument on a later line can never steal
    // the line (`foo(\n  foo\n)` keeps the head's line).
    visit(nav, true)
    legacyLast = last
    // Layer 2, measured on Exposed Table.kt: the when-entry monster
    // call@51-53 takes its target from TEXT salvage (no nav child at all —
    // the nav lives in the body lambda), so the head domain misses while the
    // true callee (`unrolled.addAll`, line 52) sits in a later sibling
    // subtree. Whole-node search, last-match: later same-named arguments
    // could shadow in theory; the Tier A gate below is the arbiter.
    if (!leafHit && leafText !== undefined) visit(callNode, true)
    if (!leafHit && leafText !== undefined) {
      const navChild = this.findChildByType(callNode, ["navigation_expression"])
      if (navChild && navChild.id !== nav.id) visit(navChild, true)
    }
    // M59 (#825) follow-up, measured on Exposed Table.kt: braceless
    // when-entries glue into one monster call_expression, so the LAST
    // identifier (the next entry's condition) is not the callee — but the
    // target leaf still is. The line must belong to the node that produced
    // the edge's TARGET, never to the construct's tail. Falls back to the
    // legacy last-identifier exactly where the leaf is absent, so
    // well-formed calls keep their lines bit-for-bit.
    return leafHit ?? legacyLast ?? last ?? nav
  }

  /**
   * M59 (#825): the node whose start is the DECLARATION's own line.
   *
   * An annotation is a modifier — `@Test`/`@Bean` decorate the declaration, they
   * are not where it is written. Measured on the 40-file kotlin oracle sample:
   * with the node's own start, `contains` and `overrides` edges landed on the
   * ANNOTATION line for every annotated member (102 of the sample's 241
   * inconsistent claims started at an `@Test`/`@Bean` line). java measured the
   * same defect at 27% of its symbols and scala settled the contract; kotlin
   * inherits one rule, not a third variant.
   *
   * The symbol range and the edges that name it move together, so a symbol and
   * its `contains`/`overrides` lines can never disagree.
   */
  private declarationLineNode(node: Node): Node {
    // The NAME identifies the declaration, and the line belongs to the name.
    // Preferred over "first non-trivia child" because a class's own children put
    // its primary CONSTRUCTOR in the same list: measured on the kotlin sample,
    // `private data class SuspendedObject(\n  val transaction: JdbcTransaction)`
    // put the class symbol on line 94 — the constructor PARAMETER's line — while
    // its name is written on 93. Taking the name node is exact for every
    // declaration shape (class, function, property, parameter, enum entry,
    // typealias) instead of depending on child order.
    const name = this.findChildByType(node, ["type_identifier", "simple_identifier"])
    if (name) return name
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "modifiers" || c.type === "annotation") continue
      // M59 (#825) / F6 — and this one was a real hole, not just dead code:
      // tree-sitter-kotlin's comment nodes are `line_comment` and
      // `multiline_comment`; the guard named `comment` (nonexistent) and
      // `block_comment` (nonexistent), so a kotlin `/* … */` written as the
      // first named child was RETURNED as the declaration node and its line
      // became the declaration's — exactly the annotation/comment defect this
      // helper exists to prevent, left open for one comment style.
      if (c.type === "line_comment" || c.type === "multiline_comment") continue
      return c
    }
    return node
  }

  /** The range of a SYMBOL: annotations skipped (see declarationLineNode). */
  private symbolRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    const decl = this.declarationLineNode(node)
    const base = this.nodeToRange(node)
    return {
      ...base,
      startLine: decl.startPosition.row + 1,
      startColumn: decl.startPosition.column + 1,
      startIndex: decl.startIndex,
    }
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

  // Additional helper methods (stubs for now)...
  /**
   * Kotlin Interface Extraction
   */
  private extractInterface(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string): void {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const interfaceName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const superTypes = this.extractSuperTypes(node, ctx)
    const superTypeKinds = this.extractSuperTypesWithKinds(node)
    const typeParameters = this.extractTypeParameters(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    const symbol: ASTEngine.UniversalSymbol = {
      name: interfaceName,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.symbolRange(node),
      scope: this.enclosingScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      isAbstract: true, // All interfaces are abstract
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        superTypes,
        superTypesAreConstructorCalls: superTypeKinds.map((s) => s.isConstructorCall),
        // M59 (#825): parallel line array — one line per supertype, in the
        // same order. Heritage edges take their line from here, not from the
        // class header (which names only the first supertype).
        superTypeLines: superTypeKinds.map((s) => s.line),
        inheritance: superTypes,
        typeParameters,
        methodCount: this.countMethods(node, ctx),
        isKotlinInterface: true,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)
  }

  /**
   * Kotlin Enum Class Extraction
   */
  private extractEnumClass(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext, parentClass?: string): void {
    const nameNode = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (!nameNode) return

    const enumName = nameNode.text
    const modifiers = this.extractModifiers(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)
    const enumValues = this.extractKotlinEnumValues(node)
    // M37.21 #610 (KD19): enums carry supertypes like any other class —
    // `enum class MODE(...) : ForUpdateOrShareMode` must reach the heritage
    // post-pass (Kotlin semantics: constructor-invocation supertype =
    // extends, bare = implements).
    const superTypes = this.extractSuperTypes(node, ctx)
    const superTypeKinds = this.extractSuperTypesWithKinds(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name: enumName,
      kind: ASTEngine.SymbolKind.Enum,
      range: this.symbolRange(node),
      scope: this.enclosingScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      decorators: annotations,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        superTypes,
        superTypesAreConstructorCalls: superTypeKinds.map((s) => s.isConstructorCall),
        // M59 (#825): parallel line array — one line per supertype.
        superTypeLines: superTypeKinds.map((s) => s.line),
        enumValues,
        valueCount: enumValues.length,
        hasEnumMethods: this.countMethods(node, ctx) > 0,
        isKotlinEnum: true,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    // Extract enum values as symbols with the enum_entry node range
    const enumBody = this.findChildByType(node, ["enum_class_body", "class_body"])
    const entryNodes: Node[] = []
    if (enumBody) {
      for (let i = 0; i < enumBody.namedChildCount; i++) {
        const c = enumBody.namedChild(i)
        if (c?.type === "enum_entry") entryNodes.push(c)
      }
    }
    for (let i = 0; i < enumValues.length; i++) {
      const enumValue = enumValues[i]
      const entryNode = entryNodes[i] ?? node
      symbols.push({
        name: enumValue,
        kind: ASTEngine.SymbolKind.EnumMember,
        range: this.symbolRange(entryNode),
        scope: this.currentScope(ctx),
        visibility: "public",
        ownerName: enumName,
        ownerKind: ASTEngine.SymbolKind.Enum,
        metadata: {
          isEnumValue: true,
          kotlinSpecific: true,
        },
      })
    }
  }

  /**
   * Kotlin Constructor Extraction
   */
  private extractConstructor(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    ctx: KotlinContext,
    parentClass?: string,
  ): void {
    const parameters = this.extractKotlinParameters(node, ctx)
    const modifiers = this.extractModifiers(node, ctx)
    const annotations = this.extractAnnotations(node, ctx)

    const isPrimaryConstructor = node.type === "primary_constructor"
    const constructorProperties: Node[] = []
    if (isPrimaryConstructor) {
      parameters.length = 0
      for (let i = 0; i < node.namedChildCount; i++) {
        const paramNode = node.namedChild(i)
        if (paramNode && paramNode.type === "class_parameter") {
          const nameNode = this.findChildByType(paramNode, ["simple_identifier"])
          const typeNode = this.findChildByType(paramNode, ["user_type", "nullable_type", "type_identifier"])

          let exists = false
          if (nameNode) {
            for (let j = 0; j < parameters.length; j++) {
              if (parameters[j].name === nameNode.text) { exists = true; break; }
            }
          }

          if (nameNode && !exists) {
            parameters.push({
              name: nameNode.text,
              type: typeNode ? this.cleanKotlinType(typeNode.text) : "Any",
            })
          }

          const bindingKind = this.findChildByType(paramNode, ["binding_pattern_kind"])
          if (bindingKind && (bindingKind.text === "val" || bindingKind.text === "var")) {
            constructorProperties.push(paramNode)
          }
        }
      }
    }
    let hasDefaults = false;
    for (let i = 0; i < parameters.length; i++) {
      if (parameters[i].defaultValue !== undefined) { hasDefaults = true; break; }
    }

    // KAD-MR3 K11 (M49.K1): the symbol KEEPS ITS DECLARED NAME (the class
    // name) — the java C3 family convention. The pre-fix "constructor"
    // literal collided across classes (contains:A->constructor and
    // contains:B->constructor indistinguishable; every ctor overload
    // collapsed into one symbol per class). The kind field still says
    // Constructor; overload distinctness comes from the parameters payload.
    // The self-contains edge A->A is family-normal (java post-C3 emits it
    // identically).
    const constructorName = parentClass || "constructor"
    // M59 (#825): a PRIMARY constructor is written in the class header, so its
    // navigable line is the class-name line. Its own node starts at the
    // PARAMETER LIST, which is one line down on a wrapped header — measured on
    // Exposed SpringTransactionManager.kt: `private data class SuspendedObject(`
    // on 93, `val transaction: JdbcTransaction,` on 94, and the constructor
    // symbol (named after the class, family convention) claimed 94 where the
    // name it carries is not written. A SECONDARY constructor keeps the same
    // routing for the same reason: its node starts at the `constructor`
    // keyword, which carries no name — the name it carries (the class name,
    // K11 above) is written on the class declaration, never on the keyword
    // line. Falsified the old "keeps its own line" rule on Exposed
    // ResultRow.kt/Table.kt/ColumnType.kt (9 rows: target ResultRow/Join/
    // PrimaryKey/... on a bare `constructor(` line). The contains edge
    // follows the range, so both move together. Note the climb: a member's
    // parent is the class_body wrapper, not the class_declaration itself —
    // routing on the direct parent silently kept the keyword line.
    let ctorDeclNode: Node = node
    let ancestor = node.parent
    while (ancestor && ancestor.type === "class_body") ancestor = ancestor.parent
    if (ancestor && (ancestor.type === "class_declaration" || ancestor.type === "object_declaration")) ctorDeclNode = ancestor
    const symbol: ASTEngine.UniversalSymbol = {
      name: constructorName,
      kind: ASTEngine.SymbolKind.Constructor,
      range: this.symbolRange(ctorDeclNode),
      scope: this.currentScope(ctx),
      visibility: this.determineVisibility(modifiers, ctx),
      parameters,
      decorators: annotations,
      ownerName: parentClass,
      ownerKind: parentClass ? ASTEngine.SymbolKind.Class : undefined,
      metadata: {
        modifiers,
        annotations: annotations.map((a) => this.kotlinShortAnnotationName(a)),
        isPrimaryConstructor,
        parameterCount: parameters.length,
        hasDefaultParameters: hasDefaults,
        kotlinSpecific: true,
      },
    }

    symbols.push(symbol)

    if (parentClass) {
      for (let i = 0; i < constructorProperties.length; i++) {
        const paramNode = constructorProperties[i]
        const nameNode = this.findChildByType(paramNode, ["simple_identifier"])
        const typeNode = this.findChildByType(paramNode, ["user_type", "nullable_type", "type_identifier"])
        const bindingKind = this.findChildByType(paramNode, ["binding_pattern_kind"])
        if (!nameNode || !bindingKind) continue

        symbols.push({
          name: nameNode.text,
          kind: ASTEngine.SymbolKind.Property,
          range: this.symbolRange(paramNode),
          scope: this.currentScope(ctx),
          visibility: this.determineVisibility(this.extractModifiers(paramNode, ctx), ctx),
          ownerName: parentClass,
          ownerKind: ASTEngine.SymbolKind.Class,
          returnType: typeNode ? this.cleanKotlinType(typeNode.text) : undefined,
          metadata: {
            isVal: bindingKind.text === "val",
            isVar: bindingKind.text === "var",
            isConstructorProperty: true,
            kotlinSpecific: true,
          },
        })
      }
    }
  }

  /**
   * Kotlin Package Extraction
   */
  private extractPackage(node: Node, ctx: KotlinContext): void {
    // The package_header child is a dotted `identifier` node (e.g. "com.example.service")
    const packageNameNode = this.findChildByType(node, ["identifier", "simple_identifier", "type_identifier"])
    if (packageNameNode) {
      const packageName = packageNameNode.text
      ctx.packageStack = packageName.split(".")
    }
  }

  /**
   * Kotlin Import Extraction
   */
  private extractImport(node: Node, ctx: KotlinContext): void {
    // KAD5: alias registration was write-only dead state (removed).
    void ctx
  }
  /**
   * Kotlin Annotation Extraction
   */
  private extractAnnotation(node: Node, symbols: ASTEngine.UniversalSymbol[], ctx: KotlinContext): void {
    // KAD5: ctx.annotations was write-only dead state (removed) — annotation
    // values reach consumers through symbol metadata/decorators instead.
    void symbols
    void ctx
  }

  /**
   * Kotlin Modifier Extraction
   */
  private extractModifiers(node: Node, ctx: KotlinContext): string[] {
    const modifiers: string[] = []

    const modifiersNode = this.findChildByType(node, ["modifiers"])
    if (modifiersNode) {
      for (let j = 0; j < modifiersNode.namedChildCount; j++) {
        const modifier = modifiersNode.namedChild(j)
        if (modifier && modifier.type !== "annotation") {
          modifiers.push(modifier.text.trim())
        }
      }
    }

    return modifiers
  }

  /**
   * Kotlin Return Type Extraction
   */
  private extractReturnType(node: Node, ctx: KotlinContext): string | undefined {
    // Positional by necessity: the pinned kotlin wasm exposes exactly four
    // fields (receiver/alternative/condition/consequence — verified 2026-09-16
    // against the wasm) and `return_type` is not one of them
    // (childForFieldName("return_type") is UNDEFINED on `fun f(): Int`).
    // A field read here was provably dead; F1's field audit now fails on any
    // field literal the pinned grammar cannot resolve.
    const typeNode = this.findChildByType(node, ["user_type", "nullable_type", "function_type", "type_identifier"])

    if (typeNode) {
      return this.cleanKotlinType(typeNode.text)
    }

    // KAD-MR3 K3 (M49.K1): expression-body return types are NOT inferable —
    // `fun f() = 42` reports Int only after full type resolution. The old
    // fallback returned "Unit" for EVERY expression body (probe: f()=42 ->
    // Unit) and sniffed "->" in body TEXT (misfires on when-arrows/lambdas).
    // Grammar probe: this pinned wasm exposes NO named fields
    // (childForFieldName("body") is null) — find the body by TYPE.
    // Honest contract: expression body without a declared type → undefined
    // (unknown, never fabricated Unit); block body → Unit (Kotlin semantics).
    const functionBody = this.findChildByType(node, ["function_body"])
    if (functionBody && !functionBody.text.startsWith("{")) {
      return undefined
    }
    return "Unit"
  }

  /**
   * Kotlin Receiver Type Extraction (for extension functions)
   */
  private extractReceiverType(node: Node, ctx: KotlinContext): string | undefined {
    // FIELD-FIRST (#382 item 3). The pinned kotlin wasm (upstream 1852ea1,
    // rebuilt in f51879d9) exposes a `receiver` field — verified live
    // 2026-09-16: `fun String.clip()` and `val String.len2: Int` both resolve it
    // to "String" while a plain `fun f()` leaves it undefined. The positional
    // scan stays as the fallback for a build that does not declare it (upstream
    // grammar once wrapped the receiver in a bare receiver_type/user_type child).
    const fieldReceiver = node.childForFieldName("receiver")
    if (fieldReceiver) return this.cleanKotlinType(fieldReceiver.text)

    // Positional fallback: the leading type child before the function name
    // (fun String.shout → receiver_type/user_type "String").
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "simple_identifier") break
      if (
        c?.type === "receiver_type" ||
        c?.type === "user_type" ||
        c?.type === "nullable_type" ||
        c?.type === "type_identifier"
      ) {
        return this.cleanKotlinType(c.text)
      }
    }
    return undefined
  }
  /**
   * Kotlin Function Call Detection
   * Analyzes Kotlin method calls, extension functions, and Android/Spring patterns
   */
  private findKotlinFunctionCalls(node: Node, ctx: KotlinContext): string[] {
    const calls: string[] = []
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        const callName = this.buildKotlinCallExpression(n)
        if (callName && !this.isKotlinBuiltin(callName)) {
          calls.push(callName)
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return calls
  }
  /**
   * Kotlin Annotations Extraction (multiple)
   */
  private extractAnnotations(node: Node, ctx: KotlinContext): string[] {
    const annotations: string[] = []
    
    // Explicitly push expect/actual as pseudo-annotations so they persist
    const modifiers = this.extractModifiers(node, ctx);
    if (modifiers.includes("expect")) annotations.push("@expect");
    if (modifiers.includes("actual")) annotations.push("@actual");

    // Collect ONLY this declaration's own annotations — those in its
    // `modifiers` child (or direct annotation children). A subtree walk would
    // leak member annotations into the container's decorators.
    const collect = (n: Node) => {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "annotation")) {
          annotations.push(c.text.startsWith("@") ? c.text.slice(1) : c.text)
        }
      }
    }
    if (node) {
      collect(node)
      const modifiersNode = this.findChildByType(node, ["modifiers"])
      if (modifiersNode) collect(modifiersNode)
    }
    return annotations
  }

  /**
   * Kotlin KDoc Comment Extraction
   */
  private extractKDocComment(node: Node, ctx: KotlinContext): string | undefined {
    // KDoc is the /** ... */ comment immediately BEFORE the declaration
    // (Kotlin docs: KDoc precedes its item). Scan BACKWARDS from the
    // declaration and stop at the first non-comment sibling — exactly one
    // doc, the adjacent one, can ever attach.
    //
    // KAD2 (M37 kotlin wave, TSD6-class): the original forward scan broke
    // on `sibling === node` — a dead comparison (web-tree-sitter returns
    // fresh wrapper objects per access, so identity never matched, the F7
    // node-identity rule). The scan therefore ran PAST the declaration and
    // returned the FIRST KDoc in the file: in a probe, `second` and `third`
    // both inherited `first`'s doc. Positional (id/startIndex) comparison
    // fixes the stop; the backward direction keeps only the adjacent doc.
    const parent = node.parent
    if (!parent) return undefined

    // Span-based self-detection (id comparisons across separately-obtained
    // wrappers are also unsafe; spans are stable). Scan BACKWARDS from the
    // declaration; stop at the first non-comment sibling so exactly the
    // adjacent doc can attach — never one from further up.
    let selfIdx = -1
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c && c.startIndex === node.startIndex && c.endIndex === node.endIndex) { selfIdx = i; break }
    }
    for (let i = selfIdx - 1; i >= 0; i--) {
      const sibling = parent.namedChild(i)
      if (!sibling) continue
      if (
        (sibling.type === "multiline_comment" || sibling.type === "line_comment") &&
        sibling.text.startsWith("/**")
      ) {
        return sibling.text
      }
      break
    }

    return undefined
  }

  /**
   * Kotlin Visibility Determination
   */
  private determineVisibility(
    modifiers: string[],
    ctx: KotlinContext,
  ): "public" | "private" | "protected" | "internal" {
    for (let i = 0; i < modifiers.length; i++) {
      const mod = modifiers[i]
      if (mod === "private") return "private"
      if (mod === "protected") return "protected"
      if (mod === "internal") return "internal"
    }


    return "public" // Default in Kotlin
  }

  /**
   * Kotlin Function Complexity Calculation
   */
  private calculateFunctionComplexity(node: Node, ctx: KotlinContext): number {
    let complexity = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "if_expression" ||
        n.type === "when_entry" || // per-case, matching java/TS switch_case granularity
        n.type === "for_statement" ||
        n.type === "while_statement" ||
        n.type === "do_while_statement" ||
        n.type === "catch_block" ||
        n.type === "elvis_expression"
      ) {
        complexity++
      } else if (n.type === "conjunction_expression" || n.type === "disjunction_expression") {
        complexity++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  /**
   * Kotlin Super Types Extraction
   */
  /**
   * Extract the clean base type name of every supertype. A delegation_specifier
   * contains either a user_type directly (Repository<User>) or a
   * constructor_invocation (BaseService<User>()) wrapping one. The base name
   * strips type arguments and nullability so relationship targets are valid
   * symbol leaves (pool-worker's noise filter rejects targets containing <>).
   */
  private extractSuperTypes(node: Node, ctx: KotlinContext): string[] {
    return this.extractSuperTypesWithKinds(node).map((s) => s.name)
  }

  /**
   * Kotlin semantics (Kotlin docs, Inheritance): a supertype written with a
   * constructor invocation `Base()` is an extended CLASS; a bare type `Repo`
   * is an IMPLEMENTED interface. Position alone is wrong - a class whose
   * first (or only) supertype is an interface was labelled extends.
   *
   * M59 (#825): each entry also carries the line the SUPERtype is NAMED on.
   * A kotlin supertype list wraps (`class A :\n    B(),\n    C`), so the
   * class header's line names only the first entry. Same rule as java's
   * `extractJavaInheritance` and scala's `extractSupertypes`.
   */
  private extractSuperTypesWithKinds(node: Node): { name: string; isConstructorCall: boolean; line: number }[] {
    const out: { name: string; isConstructorCall: boolean; line: number }[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "delegation_specifier") {
        const invocation = this.findChildByType(c, ["constructor_invocation"])
        let userType = this.findChildByType(c, ["user_type"])
        if (!userType && invocation) userType = this.findChildByType(invocation, ["user_type"])
        if (userType) {
          out.push({
            name: this.cleanKotlinBaseType(userType.text),
            isConstructorCall: !!invocation,
            line: userType.startPosition.row + 1,
          })
        }
      }
    }
    return out
  }

  /**
   * Reduce a (possibly generic/nullable) type to its base name:
   * "BaseService<User>" → "BaseService", "User?" → "User",
   * "Map<String, List<Int>>" → "Map".
   */
  private cleanKotlinBaseType(typeText: string): string {
    let t = typeText
    while (t.endsWith("?")) t = t.slice(0, -1)
    const lt = t.indexOf("<")
    if (lt !== -1) t = t.slice(0, lt)
    return t.trim()
  }

  /**
   * Kotlin Type Parameters Extraction
   */
  /**
   * Positional `value_arguments` lookup. The pinned kotlin wasm exposes only
   * four fields (receiver/alternative/condition/consequence — verified
   * 2026-09-16), none of which is `value_arguments`, so this helper remains the
   * mechanism for annotation/route argument extraction (M14.1). The earlier
   * "fieldCount=0" claim in this comment was stale: the 1852ea1 rebuild added
   * field info, but only `receiver` among the fields this analyzer would want.
   */
  private getValueArguments(node: Node): Node | undefined {
    // annotation > constructor_invocation > value_arguments: grandchild, so a
    // shallow lookup misses it. Recursive descent required.
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "value_arguments") return c
        stack.push(c)
      }
    }
    return undefined
  }

  // KAD-MR3 K13 (M49.K1): getCallFunctionName, extractKotlinAnnotationArguments
  // and extractKotlinAnnotationTarget were dead (grep-proven zero call sites) —
  // deleted. extractKotlinAnnotationArguments's arg-walk lives on in the
  // E6 route extractor as a real consumer.

  private extractTypeParameters(node: Node, ctx: KotlinContext): string[] {
    const typeParameters: string[] = []

    const typeParamList = this.findChildByType(node, ["type_parameters"])
    if (typeParamList) {
      for (let i = 0; i < typeParamList.namedChildCount; i++) {
        const typeParam = typeParamList.namedChild(i)
        if (typeParam?.type === "type_parameter") {
          // Positional: no `name` field on type_parameter in the pinned wasm
          // (verified — `class A<T>` gives type_parameter > type_identifier).
          const paramName = typeParam.namedChildren.find(
            (c: any) => c.type === "simple_identifier" || c.type === "type_identifier",
          )?.text
          if (paramName) {
            typeParameters.push(paramName)
          }
        }
      }
    }

    return typeParameters
  }
  /**
   * Kotlin Method Counting — DIRECT members only.
   * KAD-MR3 K14 (M49.K1): the subtree-wide count misattributed nested
   * structure — a nested class's members inflated the OUTER class's counts
   * (class Outer { class Nested { fun nm() } } reported methodCount=2 for
   * Outer). Probed containers: class/object bodies are class_body, enum
   * members live in enum_class_body.
   */
  private countMethods(node: Node, ctx: KotlinContext): number {
    let count = 0
    for (const bt of ["class_body", "enum_class_body"]) {
      const body = this.findChildByType(node, [bt])
      if (!body) continue
      for (let i = 0; i < body.namedChildCount; i++) {
        const m = body.namedChild(i)
        if (m?.type === "function_declaration") count++
      }
    }
    return count
  }

  /**
   * Kotlin Property Counting — DIRECT members only (KAD-MR3 K14, see
   * countMethods). Companion-object properties belong to the companion, not
   * the outer class.
   */
  private countProperties(node: Node, ctx: KotlinContext): number {
    let count = 0
    for (const bt of ["class_body", "enum_class_body"]) {
      const body = this.findChildByType(node, [bt])
      if (!body) continue
      for (let i = 0; i < body.namedChildCount; i++) {
        const m = body.namedChild(i)
        if (m?.type === "property_declaration") count++
      }
    }
    return count
  }

  /**
   * Kotlin Companion Object Detection — DIRECT member of THIS type only
   * (KAD-MR3 K14: the subtree-wide scan credited a nested class's companion
   * to the outer class).
   */
  private hasCompanionObject(node: Node, ctx: KotlinContext): boolean {
    for (const bt of ["class_body", "enum_class_body"]) {
      const body = this.findChildByType(node, [bt])
      if (!body) continue
      for (let i = 0; i < body.namedChildCount; i++) {
        const m = body.namedChild(i)
        if (m?.type !== "companion_object" && m?.type !== "object_declaration") continue
        if (m.type === "companion_object") return true
        const modifiers = this.extractModifiers(m, ctx)
        for (let j = 0; j < modifiers.length; j++) {
          if (modifiers[j] === "companion") return true
        }
      }
    }
    return false
  }

  /**
   * Kotlin Property Type Extraction
   */
  private extractPropertyType(node: Node, ctx: KotlinContext): string | undefined {
    // The declared type lives inside the variable_declaration child
    // (property_declaration → variable_declaration → user_type).
    const declarationNode = this.findChildByType(node, ["variable_declaration"])
    const typeNode =
      this.findChildByType(node, ["user_type", "nullable_type", "function_type", "type_identifier"]) ||
      (declarationNode ? this.findChildByType(declarationNode, ["user_type", "nullable_type", "function_type", "type_identifier"]) : null)
    if (typeNode) {
      return this.cleanKotlinType(typeNode.text)
    }

    // Infer from the initializer expression child (e.g. `const val VERSION = 1`).
    //
    // This used to read `childForFieldName("initializer")` on the declaration and
    // on the property node. Both reads were PROVABLY DEAD: the initializer is not
    // a named field in the pinned kotlin wasm (verified 2026-09-16 —
    // `property_declaration` children are binding_pattern_kind, variable_declaration,
    // `=(anon)`, then the expression), so the expression arm never fired and only
    // the literal scan below ever produced a type. Removing the dead reads keeps
    // the measured behaviour identical (it is now explicit rather than accidental).
    // A positional initializer read (named child after the anonymous `=`) is a
    // candidate improvement, tracked rather than smuggled in here.
    const LITERAL_TYPES = ["integer_literal", "real_literal", "string_literal", "character_literal", "boolean_literal", "call_expression"]
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && LITERAL_TYPES.indexOf(c.type) !== -1) {
        return this.inferKotlinTypeFromInitializer(c)
      }
    }

    return undefined
  }

  /**
   * Kotlin Val Property Detection
   */
  private isValProperty(node: Node): boolean {
    // KAD4 (M37 kotlin wave): AST-based, not text-based — `val x = "var y"`
    // made text matching report BOTH val and var for one property. The
    // binding_pattern_kind child carries the binding keyword verbatim.
    const binding = this.findChildByType(node, ["binding_pattern_kind"])
    if (binding) return binding.text === "val"
    return stringIncludes(node.text, "val ") && !stringIncludes(node.text, "var ")
  }

  /**
   * Kotlin Var Property Detection
   */
  private isVarProperty(node: Node): boolean {
    const binding = this.findChildByType(node, ["binding_pattern_kind"])
    if (binding) return binding.text === "var"
    return stringIncludes(node.text, "var ")
  }

  /**
   * Kotlin Property Delegation Detection
   */
  private hasDelegate(node: Node): boolean {
    // KAD4: the grammar emits a dedicated property_delegate child. Text
    // matching (" by ") fabricated delegation for `"powered by Acme"` —
    // the AST node is probe-verified, no text fallback.
    return !!this.findChildByType(node, ["property_delegate"])
  }

  /**
   * Kotlin Custom Getter Detection
   */
  private hasCustomGetter(node: Node): boolean {
    return this.hasPropertyAccessor(node, "getter")
  }

  /**
   * Kotlin accessor run: the pinned grammar emits accessors as SIBLINGS of
   * property_declaration (class_body > [property_declaration, getter,
   * setter]) — probe-verified, and the run is CONTIGUOUS (a setter follows
   * the getter, not the declaration). Text matching fabricated both ("get()")
   * hit `val t = m.get()` (a plain call named get); "set("+"value") hit
   * `val u = s.set(1, value)`). Span-locate the declaration among its
   * parent's children, then walk the contiguous accessor run that follows.
   */
  private hasPropertyAccessor(node: Node, accessorType: string): boolean {
    const parent = node.parent
    if (!parent) return false
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c && c.startIndex === node.startIndex && c.endIndex === node.endIndex) {
        for (let j = i + 1; j < parent.namedChildCount; j++) {
          const sib = parent.namedChild(j)
          if (sib?.type === "getter" || sib?.type === "setter") {
            if (sib.type === accessorType) return true
            continue
          }
          break
        }
        return false
      }
    }
    return false
  }

  /**
   * Kotlin Custom Setter Detection
   */
  private hasCustomSetter(node: Node): boolean {
    return this.hasPropertyAccessor(node, "setter")
  }
  // ======================== ADDITIONAL KOTLIN HELPER METHODS ========================

  /**
   * Declared-type reference graph (M14). Emits References edges from the
   * enclosing function/class to every named type used in a declaration
   * position. Exact-triple dedupe guards against nested-declaration overlap
   * (e.g. lambda params inside a property initializer).
   */
  private extractDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()
    // M59 (#825): `{name, line}` pairs, not bare names — the line must be the
    // line the TYPE IS NAMED, not the line the enclosing type expression starts
    // on (a kotlin type can wrap: `Map<String,\n  List<X>>`). Same shape scala
    // and java settled on for the same reason.
    const collectTypeNames = (n: Node, out: Array<{ name: string; line: number }>): void => {
      if (n.type === "type_identifier") {
        if (!out.some((x) => x.name === n.text)) out.push({ name: n.text, line: n.startPosition.row + 1 })
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNames(c, out)
      }
    }
    const resolveSource = (start: Node): string => {
      // KAD6 (M37 kotlin wave): start at the declaration ITSELF. Starting at
      // parent attributed a top-level function's return type to "Global"
      // while its parameters (emitted at the parameter node, whose parent
      // chain reaches the function) sourced to the function — one
      // declaration, two owners. Walking from `start` keeps every nested
      // emit site's attribution identical (their first enclosing declaration
      // is unchanged) and fixes the top-level return/receiver case.
      let p: Node | null = start
      while (p) {
        if (p.type === "function_declaration" || p.type === "class_declaration" || p.type === "object_declaration") {
          const name = this.findChildByType(p, ["simple_identifier", "type_identifier"])
          if (name) return name.text
        }
        p = p.parent
      }
      return "Global"
    }
    const emit = (decl: Node, typeRoots: (Node | null)[], kind: string, relType = "declared_type", sourceOverride?: string): void => {
      const source = sourceOverride ?? resolveSource(decl)
      for (const tr of typeRoots) {
        if (!tr) continue
        const names: Array<{ name: string; line: number }> = []
        collectTypeNames(tr, names)
        for (const { name: t, line } of names) {
          const key = `${source}|${t}|${kind}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            // M59 (#825): the line the referenced TYPE is named on.
            line_number: line,
            metadata: { relationshipType: relType, declaredOn: decl.type },
          })
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "class_parameter":
        case "parameter": {
          // Type clause = everything except the name identifier and binding
          // keywords; collecting all type_identifiers in the subtree is exact
          // because only types are type_identifiers.
          emit(n, [n], n.type)
          break
        }
        case "variable_declaration": {
          emit(n, [n], "variable_declaration")
          break
        }
        case "as_expression":
        case "check_expression": {
          // Rightmost operand is the target type (`x as T`, `o is T`).
          if (n.namedChildCount >= 2) {
            const right = n.namedChild(n.namedChildCount - 1)
            emit(n, [right], n.type, n.type)
          }
          break
        }
        case "callable_reference": {
          // M14 #419 K3: Foo::bar — a callable reference is a first-class
          // handle to a member of Foo, so the enclosing declaration
          // references the type. The referenced type is the first
          // type_identifier child (Foo); package-qualified forms
          // (pkg.Foo::bar) keep their receiver via collectTypeNames.
          const tId = this.findChildByType(n, ["type_identifier"])
          if (tId) emit(n, [tId], "callable_reference", "callable_reference")
          break
        }
        case "type_alias": {
          // M14 #419 K5: the alias references its RHS types. Source is the
          // alias NAME itself (Fn), not the enclosing declaration — the
          // aliased types belong to the alias's own definition. Type
          // parameters of the alias are bindings, not references.
          const tName = this.findChildByType(n, ["type_identifier", "simple_identifier"])
          if (tName) {
            const rhs: Node[] = []
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && c.type !== "type_identifier" && c.type !== "type_parameters") rhs.push(c)
            }
            emit(n, rhs, "type_alias", "type_alias", tName.text)
          }
          break
        }
        case "object_literal": {
          // M14 #419 K6: the anonymous object implements its supertype — the
          // delegation_specifier is a real type usage at the object-literal
          // site, attributed to the enclosing declaration (run).
          const deleg = this.findChildByType(n, ["delegation_specifier"])
          if (deleg) emit(n, [deleg], "object_literal", "object_literal")
          break
        }
        case "function_declaration": {
          // Return type: first user/nullable/function-type direct child AFTER
          // the parameter list; receiver type: such a child BEFORE the name.
          let sawParams = false
          let sawName = false
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "function_value_parameters") { sawParams = true; continue }
            if (c.type === "simple_identifier" || c.type === "type_identifier") {
              if (!sawName && !sawParams && !c.text.startsWith("`")) {
                // First identifier is the name unless a user_type already
                // preceded it (extension receivers precede the name).
                if (i > 0 && n.namedChild(i - 1)?.type === "user_type") {
                  emit(n, [c], "receiver_type")
                }
                sawName = true
                continue
              }
              continue
            }
            // KAD3 (M37 kotlin wave): the pinned grammar wraps the extension
            // receiver in a dedicated receiver_type node (fun String.shout
            // → receiver_type > user_type > type_identifier) — user_type
            // alone never matched, so receiver types never emitted a
            // declared_type reference. collectTypeNames descends into the
            // wrapper, so passing it is exact.
            if ((c.type === "receiver_type" || c.type === "user_type" || c.type === "nullable_type" || c.type === "function_type")) {
              if (!sawName && !sawParams) {
                emit(n, [c], "receiver_type")
                sawName = true
              } else if (sawParams) {
                emit(n, [c], "return_type", "return_type")
                break
              }
            }
          }
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  /**
   * M14 #419 K1/K4: expression-level Uses edges.
   * - indexing_expression / directly_assignable_expression (with an
   *   indexing_suffix child): `xs[i]` reads and writes USE the indexed
   *   expression — previously only contains edges were emitted, so the array
   *   reference was invisible to the use graph.
   * - interpolated_identifier: "hi $name" string templates USE the
   *   referenced identifier. Kotlin's grammar produces a real template node
   *   (unlike groovy's opaque GStrings — the groovy S1 ruling), so the read
   *   is visible and must be captured.
   * - CONV-K-1 (#740): BARE and DOTTED member reads. Property reads are the
   *   most common read form in kotlin and produced NOTHING — `return x` and
   *   `return this.x` both emitted zero uses (probe-confirmed live), while
   *   only the indexing (K1) and template (K4) forms were ever claimed. Gate
   *   A: the name must resolve to a DECLARED MEMBER of the enclosing type.
   *   Gate B (CGD15): a name the enclosing function/lambda binds as a
   *   parameter or local is not a member read — without it `val x = 9` inside
   *   a method fabricates uses(method -> x) on a property it only shadows.
   *   Both gates are the real work; the emission is a line.
   * Deduped per (source, target) so repeated indexing in one function emits
   * one honest edge, not a fan of identical edges.
   */
  private collectExpressionUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const emitted = new Set<string>()
    // Declared members per owning type — gate A's inventory. `ownerName` IS
    // the enclosing type name (the family-wide symbol contract).
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
    const resolveSource = (start: Node | null): string => {
      let p: Node | null = start
      while (p) {
        // KAD-MR3 K11: same class-name attribution as the call graph — uses
        // inside ctors/init blocks belong to the class-named ctor symbol.
        if (p.type === "secondary_constructor" || p.type === "primary_constructor") {
          const cls = p.parent
          const clsName = cls ? this.findChildByType(cls, ["type_identifier", "simple_identifier"])?.text : undefined
          return clsName ?? "constructor"
        }
        if (p.type === "function_declaration" || p.type === "class_declaration" || p.type === "object_declaration") {
          const name = this.findChildByType(p, ["simple_identifier", "type_identifier"])
          if (name) return name.text
        }
        p = p.parent
      }
      return "Global"
    }
    const emitUse = (n: Node, target: string): void => {
      if (!target) return
      const source = resolveSource(n.parent)
      const key = `${source}|${target}|uses`
      if (emitted.has(key)) return
      emitted.add(key)
      relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        // M59 (#825): a read happens where the name is written. `n` is the
        // expression the walk found, which is the site that carries it.
        line_number: n.startPosition.row + 1,
        metadata: { relationshipType: "expression_use" },
      })
    }
    // Enclosing TYPE for gate A. Stops at the nearest type-bearing declaration,
    // mirroring the class/object scoping the symbol table uses.
    const resolveOwner = (start: Node | null): string | null => {
      let p: Node | null = start
      while (p) {
        if (p.type === "class_declaration" || p.type === "object_declaration") {
          const nm = this.findChildByType(p, ["type_identifier", "simple_identifier"])
          return nm ? nm.text : null
        }
        p = p.parent
      }
      return null
    }
    // Gate B (CGD15). Bindings are `parameter` / `class_parameter` /
    // `variable_declaration` — the LAST of which is also how a MEMBER property
    // names itself, so bindings are only collected from scopes INSIDE a
    // function or lambda; a class-level property declaration is a member, not
    // a local. Memoised per scope node.
    const boundCache = new Map<number, Set<string>>()
    const boundOf = (scope: Node): Set<string> => {
      const hit = boundCache.get(scope.id)
      if (hit) return hit
      const out = new Set<string>()
      const w: Node[] = [scope]
      while (w.length > 0) {
        const m = w.pop()!
        if (m.type === "simple_identifier") {
          const pt = m.parent?.type ?? ""
          if (pt === "parameter" || pt === "class_parameter" || pt === "variable_declaration") {
            out.add(m.text)
          }
        }
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) w.push(c)
        }
      }
      boundCache.set(scope.id, out)
      return out
    }
    const isLocallyBound = (n: Node, name: string): boolean => {
      let p: Node | null = n.parent
      while (p) {
        if (
          p.type === "function_declaration" || p.type === "lambda_literal" ||
          p.type === "primary_constructor" || p.type === "secondary_constructor"
        ) {
          if (boundOf(p).has(name)) return true
        }
        if (p.type === "class_declaration" || p.type === "object_declaration") break
        p = p.parent
      }
      return false
    }
    // Assignment LHS is a WRITE (KAD1's rule, generalised to the bare and
    // dotted forms): climb the assignable path, then gate by SPAN.
    const isWriteLhs = (n: Node): boolean => {
      let a: Node | null = n.parent
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
    // Positions that DECLARE rather than read: a property/local name
    // (`variable_declaration`), a parameter, or a type name. A navigation leaf
    // (`this.x`, `a.b`) and a chain base ARE read positions and are NOT here.
    const NOT_A_READ = new Set([
      "parameter", "class_parameter", "variable_declaration", "type_identifier",
      "user_type", "nullable_type", "import_header", "package_header",
      "function_declaration", "class_declaration", "object_declaration",
      "property_declaration", "value_parameter",
    ])
    const emitMemberRead = (n: Node, target: string): void => {
      const source = resolveSource(n.parent)
      const key = `${source}|${target}|uses`
      if (emitted.has(key)) return
      emitted.add(key)
      relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.6,
        // M59 (#825): a bare member read IS its identifier node.
        line_number: n.startPosition.row + 1,
        metadata: { isBareRead: true, relationshipType: "expression_use" },
      })
    }
    const walk = (n: Node): void => {
      if (n.type === "indexing_expression" || n.type === "directly_assignable_expression") {
        // Receiver is the first named child when the node carries an
        // indexing_suffix (xs[i] read, xs[i] = write). directly_assignable_expression
        // without indexing (obj.field = ...) is deliberately excluded — only
        // the probe-verified indexing form emits here.
        const recv = n.namedChild(0)
        let hasIndexing = false
        for (let i = 0; i < n.namedChildCount; i++) {
          if (n.namedChild(i)?.type === "indexing_suffix") { hasIndexing = true; break }
        }
        // KAD1 (M37 kotlin wave, JAD1-class): assignment LHS is a WRITE, not
        // a read — `xs[0] = 5` / `xs[1] += 2` emitted a bogus uses edge for
        // the receiver (java gates array writes by span; kotlin had no
        // gate). Both `=` and `op=` parse as `assignment` whose FIRST named
        // child is the LHS expression — gate by span, never by text.
        const parent = n.parent
        const lhs = parent && parent.type === "assignment" ? parent.namedChild(0) : null
        const isWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
        if (recv && hasIndexing && !isWrite) emitUse(n, recv.text)
      } else if (n.type === "interpolated_identifier") {
        emitUse(n, n.text)
      } else if (n.type === "simple_identifier") {
        // CONV-K-1 (#740): bare / dotted / chain-base member reads. A bare
        // CALLEE (`go(x)`) is owned by the call graph; a declaration name and
        // a write LHS are not reads (both gates below).
        const txt = n.text
        const pt = n.parent?.type ?? ""
        const owner = resolveOwner(n.parent)
        const isMember = !!owner && (membersByOwner.get(owner)?.has(txt) ?? false)
        if (
          !NOT_A_READ.has(pt) &&
          pt !== "call_expression" &&
          !isWriteLhs(n) &&
          !isLocallyBound(n, txt) &&
          isMember
        ) {
          emitMemberRead(n, txt)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  /**
   * Kotlin Call Expression Builder
   */
  private buildKotlinCallExpression(node: Node): string {    switch (node.type) {
      case "simple_identifier":
      case "identifier":
        return node.text

      case "navigation_expression":
        return this.buildKotlinNavigationExpression(node)

      case "call_expression": {
        // A call like `"hi".shout(2)` has a navigation_expression child (the
        // callee path) plus a call_suffix (the arguments) — the arguments must
        // NOT leak into the callee name.
        const nav = this.findChildByType(node, ["navigation_expression"])
        if (nav) return this.buildKotlinNavigationExpression(nav)
        const functionName = this.findChildByType(node, ["simple_identifier", "identifier"])
        return functionName ? functionName.text : node.text.split("(")[0]
      }

      default:
        return node.text
    }
  }

  /**
   * Kotlin Navigation Expression Builder (for method calls)
   */
  private buildKotlinNavigationExpression(node: Node): string {
    const receiver = node.namedChild(0)
    let selector = node.namedChild(node.namedChildCount - 1)

    if (!receiver || !selector) return node.text

    // navigation_suffix WRAPS the member name; using the suffix node's raw
    // text leaked its leading '.' producing "service..save".
    if (selector.type === "navigation_suffix") {
      const inner = selector.namedChild(selector.namedChildCount - 1)
      if (!inner) return node.text
      selector = inner
    }

    const receiverText =
      receiver.type === "navigation_expression"
        ? this.buildKotlinNavigationExpression(receiver)
        : receiver.type === "call_expression"
          ? this.buildKotlinCallExpression(receiver) // chained calls keep the PATH only (no argument text)
          : receiver.text

    return `${receiverText}.${selector.text}`
  }

  /**
   * Check if function call is Kotlin builtin
   */
  /**
   * Stdlib check for qualified_calls. EXACT matching only - the previous
   * substring loop classified any user call whose name merely CONTAINED a
   * builtin word (getUserById -> "get", runMigration -> "run") as stdlib,
   * silently emptying symbol.qualified_calls (M14.1 fix). Qualified calls are
   * suppressed only by full-name match or stdlib package prefix; unqualified
   * calls by exact leaf against the stdlib set + scope-function extras.
   */
  private isKotlinBuiltin(call: string): boolean {
    if (!call) return false
    for (const prefix of RealKotlinAnalyzer.stdlibPackagePrefixes) {
      if (call.startsWith(prefix)) return true
    }
    if (this.kotlinStdlibExact.has(call)) return true
    if (!call.includes(".")) {
      return RealKotlinAnalyzer.kotlinBuiltinExtras.has(call)
    }
    return false
  }

  private static readonly stdlibPackagePrefixes = [
    "kotlin.", "kotlinx.", "java.", "javax.", "android.", "androidx.",
  ]

  private static readonly kotlinBuiltinExtras: ReadonlySet<string> = new Set([
    "println", "print", "readLine", "require", "check", "error",
    "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
    "toString", "equals", "hashCode", "copy", "componentN",
    "repeat", "uppercase", "lowercase", "trim",
    "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
    "arrayOf", "emptyList", "emptyMap", "emptySet",
  ])

  /**
   * Exact stdlib names used by the call-graph filter (leaf-level). Operators
   * like plus/minus/times are deliberately excluded so in-file operator
   * overloads produce real Calls edges.
   */
  private kotlinStdlibExact: Set<string> = new Set([
    "println", "print", "readLine", "require", "check", "error",
    "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
    "toString", "equals", "hashCode", "copy", "componentN",
    "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
    "arrayOf", "emptyList", "emptyMap", "emptySet",
    "repeat", "uppercase", "lowercase", "trim", "startsWith", "endsWith",
    "contains", "substring", "map", "filter", "reduce", "fold", "forEach",
    "sorted", "sortedBy", "distinct", "first", "last", "add", "remove",
    "size", "isEmpty", "isNotEmpty", "put", "get", "getOrElse", "getOrDefault",
    "any", "all", "none", "count", "sum", "max", "min", "take", "drop",
  ])

  /**
   * Kotlin Annotation Name Extraction
   */
  private getKotlinAnnotationName(node: Node): string | undefined {
    // Direct name child (marker annotations, plain @Foo).
    const direct = this.findChildByType(node, ["simple_identifier", "type_identifier"])
    if (direct) return `@${direct.text}`
    // Use-site annotations (@field:JvmField) wrap the name in a user_type.
    // Fully-qualified names (@org.x.Service) parse as user_type with MULTIPLE
    // identifier children IN ORDER (org, x, Service) - the short name is the
    // LAST segment; taking the first yielded '@org' and silently broke every
    // FQ-annotated declaration's name resolution.
    const userType = this.findChildByType(node, ["user_type"])
    if (userType) {
      let last: Node | null = null
      for (let i = 0; i < userType.namedChildCount; i++) {
        const c = userType.namedChild(i)
        if (c && (c.type === "type_identifier" || c.type === "simple_identifier")) last = c
      }
      if (last) return `@${last.text}`
    }
    return undefined
  }

  /**
   * Reduce raw annotation text to its short name: "@org.x.GetMapping(\"/u\")"
   * → "GetMapping". Decorators keep the raw source text; anything comparing
   * annotation NAMES must compare through this normalization.
   */
  private kotlinShortAnnotationName(raw: string): string {
    let t = raw.startsWith("@") ? raw.slice(1) : raw
    const paren = t.indexOf("(")
    if (paren !== -1) t = t.slice(0, paren)
    const dot = t.lastIndexOf(".")
    return dot === -1 ? t : t.slice(dot + 1)
  }

  /**
   * Kotlin Annotation Arguments Extraction
   */
  private extractKotlinAnnotationArguments(node: Node): string[] {
    const args: string[] = []
    const argsNode = this.getValueArguments(node)

    if (argsNode) {
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const arg = argsNode.namedChild(i)
        if (arg) {
          args.push(arg.text)
        }
      }
    }

    return args
  }

  /**
   * Kotlin Annotation Target Extraction
   */
  private extractKotlinAnnotationTarget(node: Node): string | undefined {
    // Use-site targets like @field:, @get:, @set: are first-class AST nodes.
    const targetNode = this.findChildByType(node, ["use_site_target"])
    if (targetNode) {
      const text = targetNode.text
      return text.endsWith(":") ? text.slice(0, -1) : text
    }
    return undefined
  }

  /**
   * Kotlin Type Cleaning
   */
  private cleanKotlinType(typeText: string): string {
    const parts = typeText.split(" ")
    const validParts: string[] = []
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) validParts.push(parts[i])
    }
    return validParts.join(" ").replace("??", "?").replace("? ?", "?").trim()
  }

  /**
   * Kotlin Type Inference from Initializer
   */
  /**
   * Infer the type of a property from its initializer using the initializer
   * NODE TYPE — never by regex-testing its text. Kotlin literal nodes carry
   * their kind in the grammar: integer_literal, real_literal, float_literal,
   * string_literal, character_literal, boolean_literal, call_expression.
   */
  private inferKotlinTypeFromInitializer(initNode: Node): string {
    const text = initNode.text.trim()
    switch (initNode.type) {
      case "integer_literal":
        return text.endsWith("L") ? "Long" : "Int"
      case "real_literal":
        return text.endsWith("f") || text.endsWith("F") ? "Float" : "Double"
      case "float_literal":
        return "Float"
      case "string_literal":
        return "String"
      case "character_literal":
        return "Char"
      case "boolean_literal":
        return "Boolean"
      case "call_expression": {
        const callee = this.buildKotlinCallExpression(initNode)
        const name = callee.split(".").pop() || callee
        if (name === "listOf" || name === "emptyList") return "List<*>"
        if (name === "mutableListOf") return "MutableList<*>"
        if (name === "setOf" || name === "emptySet") return "Set<*>"
        if (name === "mapOf" || name === "emptyMap") return "Map<*, *>"
        if (name === "arrayOf") return "Array<*>"
        return name
      }
      default:
        return "Any"
    }
  }

  /**
   * Kotlin Enum Values Extraction
   */
  private extractKotlinEnumValues(node: Node): string[] {
    const values: string[] = []

    const enumBody = this.findChildByType(node, ["enum_class_body", "class_body"])
    if (!enumBody) return values

    for (let i = 0; i < enumBody.namedChildCount; i++) {
      const child = enumBody.namedChild(i)
      if (child?.type === "enum_entry") {
        const nameNode = this.findChildByType(child, ["simple_identifier", "type_identifier"])
        if (nameNode) {
          values.push(nameNode.text)
        }
      }
    }

    return values
  }
  private calculateRealComplexity(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): number {
    return symbols.length + relationships.length
  }
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      switch (n.type) {
        case "if_expression":
        // else_clause deliberately NOT counted: an `else` is not an
        // independent decision (family contract). Counting both if and
        // else double-counted every if/else.
        case "for_statement":
        case "while_statement":
        case "do_while_statement":
        case "when_entry":
        case "catch_block":
        case "elvis_expression":
          complexity++
          break
        case "conjunction_expression":
        case "disjunction_expression":
          complexity++
          break
        case "lambda_literal":
          break
      }

      // (The former `infix_expression` + childForFieldName("operator") branch was
      // deleted 2026-09-16: `operator` is not a field in the pinned wasm, so the
      // test could never be true — and it was redundant anyway, because `&&`/`||`
      // parse as conjunction_expression / disjunction_expression, which the switch
      // above already counts. Verified on `if (a && b) {}`.)

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return complexity
  }
  /**
   * M59 (#825): `{name, node}` pairs, not bare names.
   *
   * The compose containment edges are derived from the CALLS inside a
   * `@Composable` body, and their target is the called name — so the line must
   * come from the call node that carries it. Returning the node is the cheapest
   * way to keep that true as the walk changes; the previous string-only return
   * left those edges with no line at all (unknown, which is honest but useless).
   */
  private extractFunctionCalls(node: Node): Array<{ name: string; node: Node }> {
    const calls: Array<{ name: string; node: Node }> = []
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        // Navigation-aware leaf extraction — qualified compose calls
        // (theme.MyScreen()) have no direct identifier child.
        const full = this.buildKotlinCallExpression(n)
        calls.push({ name: full.split(".").pop() || full, node: this.calleeLeafNode(n) ?? n })
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return calls
  }

  private analyzeRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    ctx: KotlinContext,
  ): void {
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!

      if (n.type === "function_declaration") {
        let receiverNode: any = undefined; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "simple_identifier") break; if (c?.type === "receiver_type" || c?.type === "user_type" || c?.type === "nullable_type" || c?.type === "type_identifier") { receiverNode = c; break; } }
        const nameNode = this.findChildByType(n, ["simple_identifier", "type_identifier"])
        if (receiverNode && nameNode) {
          const receiverType = receiverNode.text.endsWith("?") ? receiverNode.text.slice(0, -1) : receiverNode.text
          // Extension functions ADD members to a type but are NOT inheritance
          // (Kotlin docs: "extension functions do not modify the class").
          // Labelling them Extends fabricated false hierarchy edges on real
          // code (Exposed corpus). Uses with isExtension marker is honest.
          relationships.push({
            source: nameNode.text,
            target: receiverType,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            // M59 (#825): the receiver type is named by its receiver node.
            ...this.lineField(receiverNode, n),
            metadata: {
              relationshipType: "kotlin_extension_function",
              isExtension: true,
            },
          })
        }

        // Composable detection via AST-resolved short annotation names, not
        // raw-text substring: fully-qualified @androidx.compose.runtime.
        // Composable does not contain the literal "@Composable".
        const isComposable = this.extractAnnotations(n, ctx).some((a) => this.kotlinShortAnnotationName(a) === "Composable")
        if (isComposable && nameNode) {
          const bodyNode = this.findChildByType(n, ["function_body", "class_body"])
          if (bodyNode) {
            const bodyCalls = this.extractFunctionCalls(bodyNode)
            for (let i = 0; i < bodyCalls.length; i++) {
              const call = bodyCalls[i].name
              if (call.length > 0 && call[0] >= "A" && call[0] <= "Z") {
                relationships.push({
                  source: nameNode.text,
                  target: call,
                  // M59 (#825): the UI component is named at its call site.
                  line_number: bodyCalls[i].node.startPosition.row + 1,
                  type: ASTEngine.RelationshipType.Contains,
                  confidence: 0.8,
                  metadata: {
                    relationshipType: "compose_ui_tree",
                    isUiComponent: true,
                    // KAD-MR3 K18/K4 (M49.K1): a PascalCase-name heuristic is
                    // NOT verified containment — the tier classifier stamped
                    // every contains edge "structural" (probe: Intent(...)
                    // identical to Text(...)). Honest label: heuristic — same
                    // tier as a 0.5 override guess. The compose edge keeps
                    // its 0.8 (patterns.ts filters >=0.7), but consumers can
                    // now distinguish it from verified containment.
                    evidenceClass: "heuristic",
                  },
                })
              }
            }
          }
        }
      }

      if (n.type === "call_expression") {
        // Callee leaf via the navigation-aware builder: qualified calls
        // (scope.launch {}) wrap the callee in a navigation_expression and
        // have NO direct simple_identifier child — first-identifier lookup
        // silently missed every idiomatic dispatch.
        const full = this.buildKotlinCallExpression(n)
        const callName = full.split(".").pop() || ""
        if (callName === "launch" || callName === "async" || callName === "withContext") {
          let parentFunc = n.parent
          while (parentFunc && parentFunc?.type !== "function_declaration") {
            parentFunc = parentFunc.parent
          }
          if (parentFunc) {
            const parentName = this.findChildByType(parentFunc, ["simple_identifier", "type_identifier"])?.text
            if (parentName) {
              relationships.push({
                source: parentName,
                target: callName,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 1.0,
                // M59 (#825): the dispatcher is named at the call itself.
                ...this.lineField(this.calleeLeafNode(n, callName), n),
                metadata: {
                  relationshipType: "coroutine_dispatch",
                  isAsync: true,
                },
              })
            }
          }
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    for (let i = 0; i < symbols.length; i++) {
      const cls = symbols[i]
      // M37.21 #610 (KD19, probe-verified on Exposed ForUpdateOption.kt):
      // enums are first-class heritage participants in Kotlin — `enum class
      // MODE(...) : ForUpdateOrShareMode` was silently dropped because this
      // post-pass filtered Class||Interface only. Kotlin semantics
      // unchanged: supertype WITH constructor invocation = extends, bare =
      // implements (an enum's entries pass constructor args to the base
      // when the base is a class).
      if (cls.kind === ASTEngine.SymbolKind.Class || cls.kind === ASTEngine.SymbolKind.Interface || cls.kind === ASTEngine.SymbolKind.Enum) {
        // M14 #419 K6: anonymous objects (object_literal) carry superTypes in
        // METADATA but emit NO hierarchy edge. They are expression-types, not
        // class declarations — the inheritance graph must not be polluted with
        // pseudo-classes (anonymous_Table implements Table). Their type
        // dependency is carried by the object_literal References edge, and the
        // differential oracle (which derives heritage only for *_declaration
        // nodes) agrees. Named object_declaration still emits heritage.
        if (cls.metadata?.isAnonymousObject) continue
        if (cls.metadata?.superTypes) {
          const ctorCalls: boolean[] | undefined = cls.metadata?.superTypesAreConstructorCalls
          // M59 (#825): the line the SUPERtype is named on — a wrapped
          // supertype list puts each parent on its own line, so the class
          // header's line is only correct for the first entry. Never 0:
          // absent when unknown (#820/#821).
          const superLines: number[] | undefined = cls.metadata?.superTypeLines
          for (let j = 0; j < cls.metadata.superTypes.length; j++) {
            // Kotlin semantics: supertype with constructor invocation `Base()`
            // = extends (class); bare type `Repo` = implements (interface).
            // For interfaces, all supertypes are extends. Previously position
            // alone decided (j === 0), mislabelling interface-first classes.
            const isExtends =
              cls.kind === ASTEngine.SymbolKind.Interface || ctorCalls?.[j] === true
            relationships.push({
              source: cls.name,
              target: cls.metadata.superTypes[j],
              type: isExtends ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
              confidence: 1.0,
              ...(typeof superLines?.[j] === "number" ? { line_number: superLines[j] } : {}),
              metadata: { relationshipType: isExtends ? "kotlin_extends" : "kotlin_implements" },
            })
          }
        }
      }
    }
  }

  private processImportsExports(node: Node, imports: ASTEngine.ImportInfo[], exports: ASTEngine.ExportInfo[]): void {
    const stack: Node[] = [node]

    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "import_header") {
        const pathNode = this.findChildByType(n, ["identifier"])
        if (pathNode) {
          const importPath = pathNode.text
          const aliasNode = this.findChildByType(n, ["import_alias"])
          // The pinned wasm serializes 'import x.y.*' as identifier="x.y"
          // PLUS a sibling wildcard_import node — the identifier text never
          // contains '.*', so a suffix test can never fire.
          const isWildcard = !!this.findChildByType(n, ["wildcard_import"])
          // KAD-MR3 K7 (M49.K1): the pinned wasm serializes the alias node's
          // TEXT as "as Baz" — the keyword is glued to the identifier. The
          // real alias is the node's LAST named child (type_identifier "Baz",
          // probe-verified); the raw text leaked "as Baz" into items AND
          // metadata.alias.
          const aliasText = aliasNode
            ? (aliasNode.namedChild(aliasNode.namedChildCount - 1)?.text ?? aliasNode.text)
            : undefined

          imports.push({
            module: importPath,
            items: isWildcard ? ["*"] : [aliasText ?? (importPath.split(".").pop() || importPath)],
            isDefaultImport: false,
            isNamespaceImport: isWildcard,
            range: this.nodeToRange(n),
            metadata: {
              isKotlinImport: true,
              alias: aliasText,
            },
          })
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  // KAD-MR3 K6 (M49.K1): performKotlinTypeInference was DEAD MACHINERY — it
  // gated on SymbolKind.Variable, but the extractor emits Property symbols
  // and no Variable kind, so every branch (is/has→Boolean,
  // remember/mutableStateOf→MutableState) was unreachable (probe: kinds
  // [class, method], zero Variables). Deleted rather than fed — fabricating
  // return types from NAME PREFIXES ("isValid→Boolean") is a guessing
  // heuristic masquerading as inference. metadata.hasTypeInference stays
  // (declared-type extraction IS real inference input).

  private getKotlinFrameworkPatterns(frameworks: string[], symbols: ASTEngine.UniversalSymbol[]): any[] {
    const patterns: any[] = []
    for (let i = 0; i < frameworks.length; i++) {
      const fw = frameworks[i]
      if (fw === "Jetpack Compose") {
        let hasUI = false, hasState = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.annotations) {
            for (let k = 0; k < s.metadata.annotations.length; k++) {
              if (s.metadata.annotations[k] === "Composable") hasUI = true
            }
          }
          if (s.qualified_calls) {
            for (let k = 0; k < s.qualified_calls.length; k++) {
              if (s.qualified_calls[k] === "remember" || s.qualified_calls[k] === "mutableStateOf") hasState = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasUI) fwPatterns.push("ui_components")
        if (hasState) fwPatterns.push("state_management")
        patterns.push({ framework: fw, patterns: fwPatterns })
      } else if (fw === "Android SDK") {
        let hasMvvm = false, hasLifecycle = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.superTypes) {
            for (let k = 0; k < s.metadata.superTypes.length; k++) {
              if (s.metadata.superTypes[k] === "ViewModel") hasMvvm = true
              if (s.metadata.superTypes[k] === "Activity" || s.metadata.superTypes[k] === "Fragment") hasLifecycle = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasMvvm) fwPatterns.push("mvvm_architecture")
        if (hasLifecycle) fwPatterns.push("android_lifecycle")
        patterns.push({ framework: fw, patterns: fwPatterns })
      } else if (fw === "Room") {
        let hasEntities = false, hasDaos = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.annotations) {
            for (let k = 0; k < s.metadata.annotations.length; k++) {
              if (s.metadata.annotations[k] === "Entity") hasEntities = true
              if (s.metadata.annotations[k] === "Dao") hasDaos = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasEntities) fwPatterns.push("database_entities")
        if (hasDaos) fwPatterns.push("data_access_objects")
        patterns.push({ framework: fw, patterns: fwPatterns })
      } else if (fw === "Spring Boot") {
        let hasRest = false, hasService = false
        for (let j = 0; j < symbols.length; j++) {
          const s = symbols[j]
          if (s.metadata?.annotations) {
            for (let k = 0; k < s.metadata.annotations.length; k++) {
              if (s.metadata.annotations[k] === "RestController") hasRest = true
              if (s.metadata.annotations[k] === "Service") hasService = true
            }
          }
        }
        const fwPatterns: string[] = []
        if (hasRest) fwPatterns.push("rest_controllers")
        if (hasService) fwPatterns.push("services")
        patterns.push({ framework: fw, patterns: fwPatterns })
      }
    }
    return patterns
  }

  private generateArchitecturalInsights(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): any[] {
    const insights: any[] = []

    let viewModelsCount = 0, composablesCount = 0, suspendCount = 0
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.metadata?.superTypes) {
        for (let j = 0; j < s.metadata.superTypes.length; j++) {
          if (s.metadata.superTypes[j] === "ViewModel") viewModelsCount++
        }
      }
      if (s.metadata?.annotations) {
        for (let j = 0; j < s.metadata.annotations.length; j++) {
          if (s.metadata.annotations[j] === "Composable") composablesCount++
        }
      }
      if (s.metadata?.modifiers) {
        for (let j = 0; j < s.metadata.modifiers.length; j++) {
          if (s.metadata.modifiers[j] === "suspend") suspendCount++
        }
      }
    }

    if (viewModelsCount > 0) {
      insights.push({
        type: "architecture",
        category: "android_mvvm",
        message: `Detected ${viewModelsCount} ViewModels, indicating MVVM architecture.`,
        severity: "info",
      })
    }

    if (composablesCount > 0) {
      insights.push({
        type: "ui_framework",
        category: "compose",
        message: `Jetpack Compose UI detected with ${composablesCount} composable functions.`,
        severity: "info",
      })
    }

    if (suspendCount > 0) {
      insights.push({
        type: "concurrency",
        category: "coroutines",
        message: `Coroutine usage detected with ${suspendCount} suspend functions.`,
        severity: "info",
      })
    }

    return insights
  }



  private calculateArchitecturalScore(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): number {
    let score = 80
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Jetpack Compose") score += 5
      if (patterns[i] === "Coroutines") score += 5
      if (patterns[i] === "Data Classes") score += 5
    }
    return Math.min(100, score)
  }

  private assessKotlinCodeQuality(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: string[],
  ): string {
    const score = this.calculateArchitecturalScore(symbols, relationships, patterns)
    if (score >= 90) return "excellent"
    if (score >= 80) return "good"
    if (score >= 60) return "fair"
    return "poor"
  }
}
