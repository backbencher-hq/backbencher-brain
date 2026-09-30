import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

/**
 * SCD1: is this infix operator an ASSIGNMENT?
 *
 * The gate started as a hand-list, and two claims made about it were false on
 * real code, in opposite directions.
 *
 * FALSE, in the direction of missing writes: `++=`, `&&=`, `||=` were removed
 * from the list with the note "NOT Scala operators (no legal parse produces
 * them) — dead entries". A grammar has no table of legal Scala operators; it
 * lexes an `operator_identifier`, so a user-defined one is indistinguishable
 * from a built-in at parse time. dotty DEFINES `def ++=` (MutableSet.scala:31,
 * SepCheck.scala:152, Implicits.scala:2183) and uses it 105 times in 400 files.
 * Measured over 400 scala3 files (script/m14/tmp/scala-assign-op-census.ts),
 * the infix operators ending in `=` that the hand-list did not know:
 *
 *     105 ++=    20 ::=    16 :=     6 &~=     5 ||=     3 +++=
 *       2 &&=     1 :+=     1 ~~=
 *
 * and the ones that end in `=` but are NOT assignments: 4 `===` and 2
 * `frozen_=:=`, both comparisons.
 *
 * FALSE, in the direction of phantom writes (that one was the ORACLE's, fixed
 * there): `++` and `--` were in the list, and Scala has neither `++=`-style
 * `++` nor `--` as an assignment — `a ++ b` concatenates and `a -- b`
 * subtracts, and both are reads.
 *
 * So the rule is the LANGUAGE rule, stated once: an infix operator is an
 * assignment when it ends with `=` and is not a comparison and not an arrow.
 * Comparisons are the ones ending in `==`, `<=` or `>=`, or carrying `=:=` /
 * `<:<`; the arrows are `=>`, `<-`, `<:`, `>:` and `=:`. Both halves are needed:
 * `==`, `<=`, `>=`, `=>` all end in `=`, and `===` ends in `==`.
 */
const COMPOUND_ASSIGN_OPS = new Set(["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])
function scalaOperatorIsAssignment(op: string): boolean {
  if (!op || !op.endsWith("=")) return false
  // The built-in compound assignments, enumerated so the set is visible rather
  // than implied; the checks below are what make the rule CORRECT for the rest.
  if (COMPOUND_ASSIGN_OPS.has(op)) return true
  if (op.endsWith("==") || op.endsWith("<=") || op.endsWith(">=")) return false
  if (op.includes("=:=") || op.includes("<:<")) return false
  if (op === "=>" || op === "<-" || op === "<:" || op === ">:" || op === "=:") return false
  return true
}

/**
 * S1.17 (M49 #715): does this parameter-type signature carry a GENERIC TYPE
 * VARIABLE (T, A, F — Scala's single-capital type-parameter convention,
 * possibly compound like `H :: T` or bracketed like `List[A]`)? Char-scan
 * (R2: no regex literals in analyzers — the register may only shrink). The
 * old hasTypeVar regex required a preceding `(,:` boundary, so bracketed
 * args (`List[A]` → "(List[A])") never registered as type variables and the
 * generic-substitution override fallback never fired for them.
 */
/**
 * M60 (#924, scala half): quoting syntax is not part of an identifier's NAME.
 * `@Test def `object` =` declares the identifier `object`, and the corpus's
 * own references spell it WITHOUT the backticks — a published name that keeps the
 * syntax is a name no reference can spell. Same remedy as the swift half
 * (real-swift-analyzer.ts stripNameQuoting), with kotlin's semantics: the strings
 * this file publishes are also ids and qualified names ("A.`object`"), so every
 * COMPLETE backtick run is quoting, wherever it sits in the string; an unmatched
 * backtick is not a run and is kept verbatim. Measured before the fix on the
 * census's own samples: 104 occurrences / 52 distinct names, and 52 of those
 * names were invisible to the register's whitespace-keyed routing
 * (script/m14/tmp/c924-name-surface-probe.ts).
 */
function stripScalaQuoting(text: string): string {
  if (!text.includes("`")) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 96) {
      const close = text.indexOf("`", i + 1)
      if (close === -1) {
        out += text.slice(i)
        break
      }
      out += text.slice(i + 1, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

function sigHasTypeVar(sig: string): boolean {
  const n = sig.length
  let i = 0
  while (i < n) {
    const c = sig[i]
    if (c === "(" || c === "," || c === ":" || c === "|" || c === "[" || c === "<" || c === "&" || i === 0) {
      // scan forward past separators to the identifier start
      let j = i
      while (j < n && (sig[j] === "(" || sig[j] === "[" || sig[j] === " " || sig[j] === ":" || sig[j] === ",")) j++
      if (j < n && sig[j] >= "A" && sig[j] <= "Z") {
        let end = j + 1
        while (end < n && ((sig[end] >= "A" && sig[end] <= "Z") || (sig[end] >= "a" && sig[end] <= "z") || (sig[end] >= "0" && sig[end] <= "9") || sig[end] === "_")) end++
        // a SINGLE capital letter alone is a type variable (T, F, A);
        // multi-capital words like Int/List are concrete types. Two-token
        // compounds (H :: T) are caught when the outer loop reaches `::`.
        if (end === j + 1) return true
        i = end
        continue
      }
      i = j > i ? j : i + 1
      continue
    }
    i++
  }
  return false
}

/**
 * A symbol cannot override ITSELF. Measured at 200-file depth on scala3:
 * `Position.checkInput -> Position.checkInput` (line 106) — `private[scala]
 * object Position extends Position`, so the declaring ancestor resolves back to
 * the owning name. The oracle refuses the same edge by its own rule ("self-
 * collision guard": `parentName === occName` seeds no override chain), so the
 * analyzer and the truth machinery agree that it is unrepresentable rather than
 * merely unverified. Guarded by class identity rather than by the emitted
 * source/target text, because two distinct classes may share a leaf name and
 * THAT override is legitimate.
 */
function isSelfOverride(declaring: string | undefined | null, ownerName: string | undefined | null): boolean {
  return !!declaring && !!ownerName && declaring === ownerName
}

export class RealScalaAnalyzer implements ASTEngine.LanguageAnalyzer {
  // S1.21: stable per-file counter for anonymous given names (see handleGiven).
  // Reset at the top of every analyze() so each file counts from 1.
  private givenCounter = 0

  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const exports: ASTEngine.ExportInfo[] = []
    // S1.21: stable per-file counter for anonymous given names (see handleGiven).
    this.givenCounter = 0

    const patternsObj: Record<string, boolean> = {}
    const frameworksObj: Record<string, boolean> = {}
    let hasTypes = false
    // real cyclomatic complexity, java-convention (0-based branch count)
    let cyclomaticComplexity = 0

    const metadata: Partial<ASTEngine.FileMetadata> = {
      linesOfCode: 0,
      complexity: 0,
      architecturalScore: 85,
      codeQuality: "excellent",
      hasTypeInference: false,
      hasFrameworkIntelligence: true,
      analysisVersion: "scala-2.0",
      detectedFrameworks: [],
      patterns: [],
    }

    // S1.8 (M49 scala wave #715): the early return must carry the FULL empty
    // shape — downstream consumers destructure relationships/exports/metadata
    // unconditionally; the old { symbols, imports, errors } triage crashed
    // them on null-root files instead of honestly reporting an empty file.
    if (!rootNode) {
      return {
        symbols,
        imports,
        relationships,
        exports,
        metadata,
        errors: [],
      }
    }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!metadata.errors) metadata.errors = []
          metadata.errors.push({
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

    // Manually count loc
    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    // ─────────────────────────────────────────────────────────────────────
    // Type-index for O(1) owner lookups during the relationship post-pass.
    // Container kinds: class / trait(interface) / object(module) / enum /
    // given — exactly the symbol kinds that can own members.
    // ─────────────────────────────────────────────────────────────────────
    const typeIndex = new Map<string, ASTEngine.UniversalSymbol>()
    // ScalaD-G companion routing: same-name class/module entries coexist —
    // first-seen per KIND wins. Methods carry ownerKind (stamped at walk
    // time), so the override post-pass resolves the owner against the entry
    // matching its owner's KIND, never a first-wins global that a companion
    // module can shadow.
    const typeIndexByKind = new Map<string, ASTEngine.UniversalSymbol>()
    const kindKey = (name: string, kind: ASTEngine.SymbolKind) => `${kind}:${name}`
    const indexType = (s: ASTEngine.UniversalSymbol) => {
      if (!typeIndex.has(s.name)) typeIndex.set(s.name, s)
      const kk = kindKey(s.name, s.kind)
      if (!typeIndexByKind.has(kk)) typeIndexByKind.set(kk, s)
    }
    // Owner resolution: exact kind match first, then the legacy first-wins
    // entry (pre-ownerKind symbols and unknown kinds keep old behavior).
    const resolveOwner = (s: ASTEngine.UniversalSymbol): ASTEngine.UniversalSymbol | undefined => {
      if (s.ownerKind) {
        const exact = typeIndexByKind.get(kindKey(s.ownerName ?? "", s.ownerKind))
        if (exact) return exact
      }
      return typeIndex.get(s.ownerName ?? "")
    }

    // ─────────────────────────────────────────────────────────────────────
    // Single-pass traversal. `parent` is the enclosing symbol (class/trait/
    // object/enum/given); ownership comes from it, so top-level declarations
    // (no parent) never produce self-contain edges. handleCall runs exactly
    // once per call_expression (the previous double-invocation produced
    // duplicate calls/instantiates edges).
    // ─────────────────────────────────────────────────────────────────────
    const stack: { node: Node; parent: ASTEngine.UniversalSymbol | null }[] = [{ node: rootNode, parent: null }]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node, parent } = popped
      let currentParent = parent

      if (node.type === "package_clause") {
        // package com.example.service — namespace marker only (no symbol,
        // matching the Java/Kotlin contract where packages are not symbols).
        // S1.9 (M49 #715): scope the name walk to the package_identifier
        // child ONLY. The old whole-subtree walk absorbed identifiers from
        // the `template_body` of `package foo { class Bar }`, producing
        // packageName "foo.Bar" — the class name is NOT part of the package.
        const pkgId = this.findChild(node, "package_identifier")
        const pkgChildren: string[] = []
        const walkPkg = (n: Node) => {
          if (n.type === "identifier") pkgChildren.push(n.text)
          for (let i = 0; i < n.namedChildCount; i++) {
            const ch = n.namedChild(i)
            if (ch) walkPkg(ch)
          }
        }
        if (pkgId) walkPkg(pkgId)
        if (pkgChildren.length > 0) {
          metadata.packageName = pkgChildren.join(".")
          patternsObj["Packages"] = true
        }
      } else if (node.type === "class_definition") {
        const cls = this.handleClass(node, symbols, relationships, exports, patternsObj, parent)
        if (cls) { currentParent = cls; indexType(cls) }
      } else if (node.type === "object_definition") {
        const obj = this.handleObject(node, symbols, relationships, exports, patternsObj, parent)
        if (obj) { currentParent = obj; indexType(obj) }
      } else if (node.type === "trait_definition") {
        const tr = this.handleTrait(node, symbols, relationships, exports, patternsObj, parent)
        if (tr) { currentParent = tr; indexType(tr) }
      } else if (node.type === "function_definition" || node.type === "function_declaration") {
        // function_declaration = abstract method (trait signatures, e.g.
        // `def save(item: T): T`). The old analyzer only handled
        // function_definition, silently dropping every abstract trait method.
        const fn = this.handleFunction(node, symbols, relationships, exports, patternsObj, parent)
        if (fn) currentParent = fn
      } else if (node.type === "val_definition" || node.type === "var_definition" || node.type === "val_declaration" || node.type === "var_declaration") {
        this.handleVariable(node, symbols, exports, parent)
      } else if (node.type === "type_definition") {
        this.handleTypeAlias(node, symbols, parent)
      } else if (node.type === "import_declaration") {
        this.handleImport(node, imports)
      } else if (node.type === "enum_definition") {
        const en = this.handleEnum(node, symbols, relationships, exports, patternsObj, parent)
        if (en) { currentParent = en; indexType(en) }
      } else if (node.type === "given_definition") {
        const g = this.handleGiven(node, symbols, relationships, exports, patternsObj, parent)
        if (g) { currentParent = g; indexType(g) }
      } else if (node.type === "extension_definition") {
        // Scala 3 extension: `extension (s: String) { def shout(...) }`.
        // The extension wrapper itself is NOT a symbol — its inner
        // function_definitions are the extension methods and are emitted by
        // the generic function handler below (parent unchanged, so they stay
        // top-level functions unless the extension is nested in a type).
        patternsObj["Extension Methods (Scala 3)"] = true
      } else if (node.type === "export_declaration") {
        patternsObj["Exports (Scala 3)"] = true
      } else if (node.type === "match_expression") {
        patternsObj["Case Classes & Pattern Matching"] = true
      } else if (node.type === "for_expression") {
        patternsObj["For Comprehensions"] = true
      } else if (node.type === "type_identifier" || node.type === "type") {
        hasTypes = true
      } else if (node.type === "annotation") {
        // SCD5: annotation-NAME flags only. The previous text.includes checks
        // fabricated patterns from unrelated identifiers: a string literal
        // "Testing" triggered "Annotations", a method named mymain triggered
        // it too, and "@Deprecated" (real scala, common) never set anything
        // while any identifier containing "tailrec" did. NOTE: node IS the
        // annotation here — collectAnnotations scans a definition's CHILDREN,
        // so it must not be called on the annotation itself (always empty).
        const short = this.annotationShortName(node)
        if (short === "Test" || short === "main") patternsObj["Annotations"] = true
        if (short === "BeanProperty") patternsObj["Java Interop"] = true
        if (short === "tailrec") patternsObj["Tail Recursion"] = true
        if (short === "specialized") patternsObj["Specialized Generics"] = true
      } else if (node.type === "catch_clause") {
        patternsObj["Error Handling"] = true
      } else if (node.type === "lambda_expression") {
        patternsObj["Lambdas"] = true
      } else if (node.type === "self_type") {
        patternsObj["Self Types"] = true
      } else if (node.type === "context_bound") {
        patternsObj["Type Classes (Context Bounds)"] = true
      } else if (node.type === "infix_expression" || node.type === "infix_type") {
        patternsObj["Infix Notation"] = true
      } else if (node.type === "interpolated_string_expression" || node.type === "interpolated_string") {
        patternsObj["String Interpolation"] = true
      } else if (node.type === "derives_clause") {
        patternsObj["Derives (Typeclass Derivation)"] = true
      } else if (node.type === "package_object") {
        patternsObj["Package Objects"] = true
      } else if (node.type === "throw_expression" || node.type === "throw") {
        // SCD4: the throw's target must be a NAMEABLE type. The previous raw
        // node.text embedded the whole construction with its arguments
        // (`new IllegalArgumentException("negative: " + x)` became a single
        // unmatchable References target — garbage in the graph).
        // throw new IllegalArgumentException(...) -> IllegalArgumentException;
        // throw ex (bare identifier) -> ex.
        const thrown = node.namedChild(0)
        if (thrown) {
          let target: string | undefined
          if (thrown.type === "instance_expression") {
            const typeNode = thrown.namedChild(0)
            if (typeNode) {
              target = typeNode.type === "generic_type" ? (typeNode.namedChild(0)?.text ?? typeNode.text) : typeNode.text
            }
          } else if (thrown.type === "identifier") {
            target = thrown.text
          } else if (thrown.type === "call_expression") {
            // S1.14 (M49 #715): `throw Foo("x")` — the thrown EXPRESSION is a
            // construction whose callee leaf names the exception type. The old
            // handler only knew instance_expression|identifier, so the
            // common call-shaped throw was silently unrecorded.
            const callee = thrown.childForFieldName("function")
            if (callee) {
              const kids: string[] = []
              for (let i = 0; i < callee.namedChildCount; i++) {
                const c = callee.namedChild(i)
                if (c && c.type === "identifier") kids.push(c.text)
              }
              target = kids.length > 0 ? kids[kids.length - 1] : callee.text.split("[")[0]
            }
          } else if (thrown.type === "field_expression") {
            // `throw a.b` — a pre-constructed value referenced by its dotted
            // path; the full path is the honest target (leaf-only would lose
            // the receiver identity).
            target = thrown.text
          }
          if (target) {
            relationships.push({
              // S1.7: ONE top-level sentinel — throws join calls/refs on
              // "(script)" (was "global", the third disconnected root node).
              source: parent?.name || "(script)",
              target,
              type: ASTEngine.RelationshipType.References,
              // S1.4 (M49 #715): explicit confidence — undefined is treated
              // as 1 by the classifier but filtered inconsistently by
              // downstream >= 0.7 consumers. A throw target is structural.
              confidence: 0.95,
              // M59 (#825): the throw target is named at the throw expression.
              line_number: (thrown ?? node).startPosition.row + 1,
              metadata: { scalaSpecific: true, isThrow: true, relationshipType: "throw_target" },
            })
          }
        }
      } else if (node.type === "opaque_modifier") {
        patternsObj["Opaque Types (Scala 3)"] = true
      } else if (node.type === "inline_modifier" || node.type === "transparent_modifier") {
        patternsObj["Inline Methods (Scala 3)"] = true
      } else if (node.type === "using") {
        patternsObj["Using Clauses (Scala 3)"] = true
      } else if (node.type === "implicit") {
        patternsObj["Implicit Parameters & Conversions"] = true
      } else if (node.type === "lazy") {
        patternsObj["Lazy Initialization"] = true
      } else if (node.type === "override") {
        patternsObj["Override/Polymorphism"] = true
      }

      if (node.type === "call_expression") {
        this.handleCall(node, relationships, patternsObj, parent)
      } else if (node.type === "instance_expression") {
        // `new Type(...)` — constructor invocation. In v0.26.2 the grammar
        // models this as instance_expression (type_identifier + arguments),
        // NOT a call_expression wrapping it, so the old analyzer missed every
        // constructor. Emit instantiates from the enclosing symbol.
        this.handleInstantiation(node, relationships, parent)
        // M37.21 #610 (JD18 family lesson from java, probe-verified in
        // scala: run inside new Runnable {...} attributed to Service with no
        // anonymous symbol): an anonymous class body (template_body child)
        // declares REAL members. Mirror the kotlin/java family convention:
        // anonymous_<SuperName> Class symbol (noise name, never leaks into
        // the index) owned by the enclosing type, pushed as the walk parent
        // so the body's members attribute to the anonymous type
        // (contains anonymous_Runnable -> run).
        const templateBody = this.findChild(node, "template_body")
        if (templateBody) {
          const typeNode = node.namedChild(0)
          // M60 (#924, scala E): a SYNTHETIC name must be canonical — never source
          // text. M60/S3: the STRUCTURAL walk is the whole enforcement — the earlier
          // `stripTypeArgs(typeNode.text)` fallback published `anonymous_(IO ~> F)`
          // for a natural-transformation supertype and a multi-line
          // `anonymous_:\n  private var cur = ...` for a body with no supertype at
          // all. An unnameable supertype now takes the canonical fallback.
          const superName = this.stripTypeArgs(this.scalaAnonymousSupertypeName(typeNode))
          const anonName = superName ? `anonymous_${superName}` : "anonymous_object"
          const anonSym: ASTEngine.UniversalSymbol = {
            name: anonName,
            kind: ASTEngine.SymbolKind.Class,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column + 1,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            visibility: "public",
            ownerName: parent?.name,
            ownerKind: parent?.kind,
            metadata: { isAnonymousObject: true, superTypes: superName ? [superName] : [], scalaSpecific: true },
          }
          symbols.push(anonSym)
          indexType(anonSym)
          currentParent = anonSym
        }
      }

      if (
        node.type === "if_expression" || node.type === "while_expression" || node.type === "do_while_expression" || node.type === "for_expression"
      ) {
        cyclomaticComplexity++
      } else if (node.type === "case_clause") {
        // SCD10 family parity — ARMS are the decisions, wrappers are not:
        // java counts switch_block_statement_group (arm groups) but not
        // switch_statement; kotlin counts when_entry but not when_expression.
        // Scala's match arms (case_clause) and catch arms (case_clause
        // inside catch_clause) are the decision points; counting the
        // match/try/catch wrappers too would double-count every arm
        // (a 3-arm match scored 4 under the naive wrapper count).
        cyclomaticComplexity++
      } else if (node.type === "infix_expression") {
        const op = node.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") cyclomaticComplexity++
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parent: currentParent })
        }
      }
    }

    this.detectFrameworks(imports, frameworksObj)
    this.detectCompanionObjects(symbols, patternsObj)

    metadata.hasTypeInference = hasTypes
    // cross-language metric consistency (M14): complexity IS the cyclomatic
    // count (java convention), not a synthetic heuristic like the previous
    // symbols.length * 1.5.
    // +1 base: the walk counts raw decision points; stored metric is
    // textbook cyclomatic complexity (family contract).
    metadata.complexity = cyclomaticComplexity + 1
    metadata.cyclomaticComplexity = cyclomaticComplexity + 1

    for (const fw in frameworksObj) metadata.detectedFrameworks!.push(fw)
    for (const pat in patternsObj) metadata.patterns!.push(pat)

    // ─────────────────────────────────────────────────────────────────────

    // Relationship post-pass (matches the Kotlin/Java contract):
    //   contains    owner → member
    //   overrides   real methods with 'override' modifier → declaring parent
    //   references  imports → root
    // ─────────────────────────────────────────────────────────────────────
    // ScalaD-A/B (two-corpus gate wave 2026-09): the old keyworded path
    // emitted a first-supertype GUESS (0.5) whenever the companion index was
    // absent — even when the REAL declaring ancestor was in this file
    // (ConcurrentImpl.get -> CommonImpl.get @0.5, while CommonImpl never
    // declares get; AtomicCell does). And keywordless implementations of
    // ABSTRACT members (no `override` needed in Scala) emitted nothing at
    // all. Both now resolve the verified in-file declaring ancestor first:
    // same NAME + parameter-type signature anywhere up the in-file supertype
    // chain -> exact-in-file override @1.0. Only keyworded methods without an
    // exact in-file match keep the companion/first-supertype tiers.
    const sigText = (m: ASTEngine.UniversalSymbol): string =>
      "(" + (m.parameters ?? []).map((p) => this.compactType(p.type || "unknown")).join(",") + ")"
    // ScalaD-H (M37.21 #610, byname-implicits-13.scala / spec-example1.scala):
    // a param type that is a GENERIC TYPE VARIABLE (`def to(t: T)` in trait
    // Generic, `def m(x: T)` in @specialized class C) is substituted at the
    // implementation site (`to(t: AABB)`, `m(x: Int)`) — textual sig equality
    // then rejects a GENUINE override. Mirror the oracle's hasTypeVar rule:
    // if either sig carries a type-variable token (single-capital identifier,
    // possibly compound like `H :: T`), fall back to name-only pairing;
    // concrete-vs-concrete mismatches still never pair (overload guard).
    // S1.17 (M49 #715): the token test is now sigHasTypeVar (char-scan,
    // bracket-aware) — the regex missed bracketed vars (`List[A]` params),
    // so `def m(x: List[A])` vs `def m(x: List[Int])` never paired.
    const hasTypeVar = (sig: string): boolean => sigHasTypeVar(sig)
    const methodSigsByOwner = new Map<string, Map<string, Set<string>>>()
    // S1-perf (M49 #715): a name→symbol visibility index replaces the O(S)
    // symbols.some scan per ancestor hop inside findDeclaringAncestor
    // (O(hops·S) per method → O(1) lookups; scala3 Setup.scala carries 60+
    // methods in one file). Built once, reused by every method.
    const nonPrivateMethodsByOwner = new Map<string, Map<string, ASTEngine.UniversalSymbol[]>>()
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName || s.visibility === "private") continue
      let byName = nonPrivateMethodsByOwner.get(s.ownerName)
      if (!byName) { byName = new Map(); nonPrivateMethodsByOwner.set(s.ownerName, byName) }
      let arr = byName.get(s.name)
      if (!arr) { arr = []; byName.set(s.name, arr) }
      arr.push(s)
    }
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName || s.metadata?.isPhantom) continue
      let byName = methodSigsByOwner.get(s.ownerName)
      if (!byName) { byName = new Map(); methodSigsByOwner.set(s.ownerName, byName) }
      let sigs = byName.get(s.name)
      if (!sigs) { sigs = new Set(); byName.set(s.name, sigs) }
      sigs.add(sigText(s))
    }
    // BFS over the in-file supertype chain for a non-private ancestor method
    // with the same name and signature (the declaring parent of `s`).
    const findDeclaringAncestor = (s: ASTEngine.UniversalSymbol): string | null => {
      const ownerSym = resolveOwner(s)
      if (!ownerSym) return null
      const sig = sigText(s)
      const seen = new Set<string>()
      const queue: string[] = [...(ownerSym.metadata?.superTypes ?? [])]
      while (queue.length > 0) {
        const parent = queue.shift()!
        if (seen.has(parent)) continue
        seen.add(parent)
        const parentMethods = methodSigsByOwner.get(parent)
        const parentSigs = parentMethods?.get(s.name)
        // S1-perf: O(1) non-private method lookup (name-keyed index built
        // above) replaces the symbols.some linear scan per hop.
        const ownerMethods = nonPrivateMethodsByOwner.get(parent)?.get(s.name) ?? []
        if (parentSigs?.has(sig)) {
          // Private members are not inherited (JLS/Scala): a private-only
          // exact-signature match is an independent member — keep searching.
          const nonPrivate = ownerMethods.some((bm) => sigText(bm) === sig)
          if (nonPrivate) return parent
        }
        // ScalaD-H generic-substitution fallback: the parent declares the
        // member under a type-variable sig (or the child is the substituted
        // form) — name-only pairing, same rule as the oracle. Private-only
        // members still never pair (checked below only on exact matches).
        if (!parentSigs?.has(sig) && parentSigs && parentSigs.size > 0 &&
            ([...parentSigs].some(hasTypeVar) || hasTypeVar(sig))) {
          if (ownerMethods.length > 0) return parent
        }
        const pSym = typeIndex.get(parent)
        if (pSym?.metadata?.superTypes) {
          for (const p of pSym.metadata.superTypes) queue.push(p)
        }
      }
      return null
    }
    for (const s of symbols) {
      const _owner = s.ownerName
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // M59 (#825): a containment edge has no "call site", but it does have
          // a navigable site — the member's own declaration line. Taken from the
          // symbol's range rather than a syntax node because this loop runs over
          // the symbol table, and omitted entirely when the symbol has no range
          // (never written as 0 — #820).
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
          metadata: { isContained: true },
        })
      }
      if (
        s.kind === ASTEngine.SymbolKind.Method &&
        s.ownerName &&
        !s.metadata?.isPhantom &&
        s.metadata?.isOverride
      ) {
        // ScalaD-B: keyworded methods first try the verified in-file declaring
        // ancestor (exact signature); only if none exists do the companion /
        // first-supertype guess tiers run.
        const declaringInFile = findDeclaringAncestor(s)
        if (declaringInFile && !isSelfOverride(declaringInFile, s.ownerName)) {
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${declaringInFile}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 1.0,
            // M59 (#825): the override occurs at the OVERRIDING declaration, so
            // the line is the overriding method's own — not the base's.
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            // S1.3 (M49 #715): override edges carry the parameter signature
            // payload — the source/target keep the family convention
            // (Owner.name → Parent.name), but the SIG travels in metadata so
            // overloads foo(Int)/foo(String) are distinguishable downstream.
            metadata: { isOverride: true, overrideParent: declaringInFile, reasonCode: "exact-in-file", overrideSig: sigText(s) },
          })
          continue
        }
        const ownerSym = resolveOwner(s)
        const parents: string[] = ownerSym?.metadata?.superTypes ?? []
        let overrideParent = parents.length > 0 ? parents[0] : ""
        // Confidence reflects EVIDENCE TIER (patterns.ts filters >= 0.7):
        // companion-resolved targets carry project-level evidence; the
        // per-file fallback is a first-supertype GUESS that may not even
        // declare the method.
        let confidence = 0.5
        let reasonCode = "first-supertype-guess"
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
          }
        }
        if (overrideParent && !isSelfOverride(overrideParent, s.ownerName)) {
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${overrideParent}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence,
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            metadata: { isOverride: true, overrideParent, reasonCode, overrideSig: sigText(s) },
          })
        }
      }
    }

    // ScalaD-A: KEYWORDLESS implementations. Implementing an ABSTRACT member
    // needs no `override` in Scala (required only for CONCRETE base members),
    // so these are genuine, common overrides (cats-effect trait impls). A
    // keywordless exact-signature match is verified when the in-file ancestor
    // member exists and is non-private; keywordless + concrete ancestor of the
    // same signature cannot compile, so the match implies abstraction. No
    // guessing tier for implicit pairs — overloads must never pair.
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      if (s.metadata?.isPhantom || s.metadata?.isOverride || s.visibility === "private") continue
      const declaringInFile = findDeclaringAncestor(s)
      if (declaringInFile && !isSelfOverride(declaringInFile, s.ownerName)) {
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${declaringInFile}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 1.0,
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
          metadata: { isOverride: true, implicitOverride: true, overrideParent: declaringInFile, reasonCode: "exact-in-file", overrideSig: sigText(s) },
        })
      }
    }
    for (const imp of imports) {
      relationships.push({
        // S1.7: ONE top-level sentinel — imports join calls/instantiates on
        // "(script)" (was "root", a third disconnected file-root node).
        source: "(script)",
        target: imp.module || "",
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        // M59 (#825): an import reference occurs where its TARGET is written —
        // the module's last segment (handleImport records that line), falling
        // back to the statement's start. Omitted, never zeroed, when neither is
        // known (#820).
        ...(imp.moduleLine || imp.range?.startLine ? { line_number: imp.moduleLine || imp.range!.startLine } : {}),
        metadata: { isImportDep: true },
      })
    }

    // M14 #419 G1: rewrite import-reference sources from the placeholder
    // "root" to the file's primary top-level type so references carry a
    // symbol identity (imports precede declarations in source order) —
    // matching kotlin. Scoped to isImportDep edges only: top-level
    // declared-type refs also resolve to the file sentinel.
    // S1.7: the unparented-file sentinel is now "(script)" (one node for the
    // whole top level), so the rewrite matches against that instead of root.
    const primaryType = symbols.find((s) => {
      if (s.ownerName) return false
      return s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Interface || s.kind === ASTEngine.SymbolKind.Enum || s.kind === ASTEngine.SymbolKind.Module
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && rel.source === "(script)" && rel.metadata?.isImportDep) {
          rel.source = primaryType.name
        }
      }
    }

    // Declared-type reference graph (M14): constructor params, val/var type
    // clauses, function params, return types, @throws annotations,
    // asInstanceOf/isInstanceOf targets. Absent until M14 — the corpus
    // oracle never checked it.
    this.collectDeclaredTypeRefs(rootNode, relationships)
    this.collectExpressionUses(rootNode, relationships)

    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      relationships,
      imports,
      exports,
      metadata,
      errors: metadata.errors || [],
    }
  }

  private detectFrameworks(imports: ASTEngine.ImportInfo[], frameworksObj: Record<string, boolean>) {
    for (let i = 0; i < imports.length; i++) {
      const source = imports[i].module
      if (!source) continue
      if (source.indexOf("play.api") !== -1) frameworksObj["Play Framework"] = true
      if (source.indexOf("akka") !== -1) frameworksObj["Akka"] = true
      if (source.indexOf("org.apache.spark") !== -1) frameworksObj["Apache Spark"] = true
      // S1.23 (M49 #715): the dominant Scala ecosystems were invisible. The
      // roots below are unambiguous module-path prefixes (no substring
      // false-positives: indexOf against a root like "cats." cannot match
      // user code that merely CONTAINS the letters).
      const isRoot = (root: string): boolean => source === root || source.startsWith(root + ".")
      if (isRoot("cats")) frameworksObj["Cats Effect"] = true
      if (isRoot("zio")) frameworksObj["ZIO"] = true
      if (isRoot("org.http4s")) frameworksObj["http4s"] = true
      if (isRoot("slick") || isRoot("org.slick")) frameworksObj["Slick"] = true
      if (isRoot("fs2")) frameworksObj["FS2"] = true
      if (isRoot("org.scalatest")) frameworksObj["ScalaTest"] = true
      // S1.24 (M49 #741, CONV-S-1): Spring was invisible to scala while java,
      // kotlin and groovy all detect it — the only JVM language blind to the
      // dominant enterprise ecosystem (and to the JSON/HTTP libraries that come
      // with a mixed JVM shop). Same unambiguous root-prefix rule as above:
      // `com.mycompany.springframework` is user code and stays undetected.
      // Names follow kotlin's for the same ecosystem ("Spring Boot" /
      // "Spring Framework"), which is also scala's own Title-Case list style;
      // java and groovy instead emit the lowercase key "spring". That
      // divergence is recorded in the spec (D21) rather than silently resolved
      // here — one analyzer must not unilaterally rename a family payload.
      if (isRoot("org.springframework.boot")) frameworksObj["Spring Boot"] = true
      if (isRoot("org.springframework")) frameworksObj["Spring Framework"] = true
      if (isRoot("com.fasterxml.jackson")) frameworksObj["Jackson"] = true
      if (isRoot("com.github.plokhotnyuk.jsoniter_scala")) frameworksObj["jsoniter-scala"] = true
      if (isRoot("com.softwaremill.sttp")) frameworksObj["sttp"] = true
    }
  }

  private detectCompanionObjects(symbols: ASTEngine.UniversalSymbol[], patternsObj: Record<string, boolean>) {
    const classNames: Record<string, boolean> = {}
    const objectNames: Record<string, boolean> = {}

    // First pass: index class and object names
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if (sym.kind === ASTEngine.SymbolKind.Class || sym.metadata?.isTrait) {
        classNames[sym.name] = true
      } else if (sym.metadata?.isObject) {
        objectNames[sym.name] = true
      }
    }

    // Second pass: link companion objects
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if ((sym.kind === ASTEngine.SymbolKind.Class || sym.metadata?.isTrait) && objectNames[sym.name]) {
        if (!sym.metadata) sym.metadata = {}
        sym.metadata.hasCompanionObject = true
        patternsObj["Companion Objects"] = true
      } else if (sym.metadata?.isObject && classNames[sym.name]) {
        if (!sym.metadata) sym.metadata = {}
        sym.metadata.isCompanionObject = true
        patternsObj["Companion Objects"] = true
      }

      if (sym.metadata?.isCaseClass) {
        if (!sym.metadata) sym.metadata = {}
        sym.metadata.hasCompanionObject = true // automatically has companion object
      }
    }
  }

  private extractIdentifier(node: Node, field: string): string | null {
    const child = node.childForFieldName(field)
    if (child) return child.text

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (
        c &&
        c.isNamed &&
        (c.type === "identifier" || c.type === "type_identifier")
      ) {
        return c.text
      }
    }
    return null
  }

  /** Collect modifiers (sealed/abstract/final/case/implicit/override/etc). */
  private collectModifiers(node: Node): Set<string> {
    const mods = new Set<string>()
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "modifiers") {
        for (let j = 0; j < c.childCount; j++) {
          const m = c.child(j)
          if (m) mods.add(m.type)
        }
      } else {
        mods.add(c.type) // case / sealed / etc. as direct unnamed children
      }
    }
    return mods
  }

  /**
   * SCD5: the short name of ONE annotation node (@Deprecated →
   * "Deprecated", @org.x.Transactional → "Transactional"). The walk calls
   * this on the annotation node itself; collectAnnotations (below) reuses it
   * for every annotation child of a definition.
   */
  private annotationShortName(ann: Node): string | null {
    for (let k = 0; k < ann.namedChildCount; k++) {
      const nc = ann.namedChild(k)
      if (nc && (nc.type === "identifier" || nc.type === "type_identifier" || nc.type === "stable_type_identifier")) {
        const text = nc.text
        const dot = text.lastIndexOf(".")
        return dot === -1 ? text : text.slice(dot + 1)
      }
    }
    return null
  }

  /**
   * Annotation short names from a definition's modifiers (@Deprecated →
   * "Deprecated", @org.x.Transactional → "Transactional"). Previously
   * annotations were consumed only as pattern-flag substrings and symbols
   * carried no decorator data at all, unlike every sibling analyzer.
   */
  private collectAnnotations(node: Node): string[] {
    const out: string[] = []
    // Annotations appear BOTH as direct children of the definition AND
    // inside a modifiers wrapper depending on construct — scan both.
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type !== "annotation" && c.type !== "modifiers") continue
      const container = c.type === "annotation" ? null : c
      const sources: Node[] = container ? [container] : [c]
      for (const src of sources) {
        for (let j = 0; j < src.childCount; j++) {
          const ann = container ? src.child(j) : src
          if (!ann || ann.type !== "annotation") continue
          const short = this.annotationShortName(ann)
          if (short) out.push(short)
          if (!container) break // direct annotation child: handled itself
        }
      }
    }
    return out
  }

  /**
   * M59 (#825): the node whose START is the declaration's own line.
   *
   * tree-sitter-scala gives a definition the line of its LEADING ANNOTATION —
   * measured, not assumed: for
   *
   *     @tailrec                  ← row 4
   *     def loop(n: Int): Int =   ← row 5
   *
   * the `function_definition` node starts at row 4 while its `name` field is at
   * row 5. Stamping the node's start put the `contains` edge (and the symbol's
   * own line) on the annotation, so the line no longer contained the declared
   * name — 4 of 13 remaining scala oracle failures on a 60-file sample, and the
   * shape that would otherwise be copied by java/kotlin/groovy.
   *
   * An annotation is a modifier: it decorates the declaration, it is not where
   * the declaration is written. Skipping leading annotations (and `modifiers`
   * wrappers) gives the declaration keyword line, which is what a tool must
   * point at and what the tier contract can check against the source.
   *
   * COMMENTS are skipped for the same reason, and that is not hypothetical —
   * measured on cats-effect's QueueBenchmark.scala, where
   *
   *     @Param(Array("32768")) // must be a power of 2
   *     var size: Int = _
   *
   * gives `var_definition` the named children `annotation, comment, identifier,
   * type_identifier, wildcard`: skipping only the annotation selected the
   * trailing COMMENT, so the symbol and its `contains` edge landed on the
   * annotation's line (47, column 26) instead of the declaration's (48, column
   * 6). A comment is text ABOUT the declaration, never the declaration.
   */
  private declarationLineNode(node: Node): Node {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "annotation" || c.type === "modifiers") continue
      // M59 (#825) / F6: tree-sitter-scala's comment nodes are `comment` and
      // `block_comment` — `line_comment` does not exist in that grammar (the
      // wasm node-type table is the check), so it was dead code.
      if (c.type === "comment" || c.type === "block_comment") continue
      return c
    }
    return node
  }

  private getVisibility(node: Node): string {
    let modifiersNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "modifiers") {
        modifiersNode = c
        break
      }
    }
    if (modifiersNode) {
      for (let i = 0; i < modifiersNode.childCount; i++) {
        const mod = modifiersNode.child(i)
        if (mod && mod.type === "access_modifier") {
          // `private[effect]` / `protected[pkg]` SCOPE qualifiers are NOT a
          // hard private: a qualified private is visible (and overridable)
          // within its scope — ScalaD-C (two-corpus wave 2026-09): IO.tag is
          // `private[effect]` and its 26 inner IO subclasses implement it
          // keywordless. Modeled as package-scoped so it is never exported
          // but still inheritable. Bare private stays private.
          if (mod.text.includes("[")) return "package"
          const inner = mod.child(0)
          if (inner && (inner.type === "private" || inner.type === "protected")) return inner.type
        }
        if (mod && (mod.type === "private" || mod.type === "protected")) return mod.type
      }
    }
    return "public"
  }

  private isPublic(node: Node): boolean {
    return this.getVisibility(node) === "public"
  }

  private isCaseClass(node: Node): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "case") return true
    }
    return false
  }

  /**
   * ScalaDoc extraction: a multiline_comment starting with '/**' immediately
   * preceding the declaration (previous sibling). Mirrors the kotlin KDoc
   * approach; previously scala symbols carried NO comments at all.
   */
  private extractScalaDoc(node: Node): string | undefined {
    // KAD2 twin (M37 #597 sweep): dead `sibling === node` stop leaked the
    // first ScalaDoc in the file onto every doc-less declaration.
    // Span-locate + backward scan, strict adjacency (kotlin KAD2 contract).
    const parent = node.parent
    if (!parent) return undefined
    let selfIdx = -1
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c && c.startIndex === node.startIndex && c.endIndex === node.endIndex) { selfIdx = i; break }
    }
    for (let i = selfIdx - 1; i >= 0; i--) {
      const sibling = parent.namedChild(i)
      if (!sibling) continue
      // scala grammar types doc comments as block_comment (kotlin uses
      // multiline_comment - each grammar names them differently)
      if (sibling.type === "block_comment" && sibling.text.startsWith("/**")) return sibling.text
      break
    }
    return undefined
  }

  /**
   * Generic type-parameter extraction from type_parameters nodes
   * (`class Store[T]`, `def map[R](...)`). Previously scala symbols carried
   * NO generic information at all - silent absence (M14 #383 fix).
   */
  private extractScalaTypeParameters(node: Node): string[] {
    const tpNode = node.namedChildren.find((c: any) => c.type === "type_parameters")
    if (!tpNode) return []
    const out: string[] = []
    for (let i = 0; i < tpNode.namedChildCount; i++) {            const c = tpNode.namedChild(i)
            if (c && this.isTypeishNodeName(c.type)) {
        out.push(c.text.trim())
      }
    }
    return out
  }

  private buildScalaCallPath(fnNode: Node): string {
    const parts: string[] = []
    let cur: Node | null = fnNode
    while (cur) {
      if (cur.type === "field_expression") {
        parts.unshift(cur.namedChild(cur.namedChildCount - 1)?.text ?? "")
        cur = cur.namedChild(0)
      } else if (cur.type === "call_expression") {
        cur = cur.namedChild(0) // descend into the called function: drop argument text
      } else {
        parts.unshift(cur.text)
        break
      }
    }
    return parts.filter(Boolean).join(".")
  }

  /**
   * Per-function cyclomatic complexity (1 + decision points) - java/kotlin
   * parity (M14 #301 prerequisite).
   */
  private calculateScalaFunctionComplexity(node: Node): number {
    let complexity = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "if_expression" ||
        n.type === "while_expression" ||
        n.type === "do_while_expression" ||
        n.type === "for_expression"
      ) {
        complexity++
      } else if (n.type === "case_clause") {
        // SCD10 family parity: ARMS are the decisions (java counts
        // switch_block_statement_group not switch_statement; kotlin counts
        // when_entry not when_expression). Match arms AND catch arms are
        // case_clause nodes; wrappers (match_expression/try_expression/
        // catch_clause) are deliberately NOT counted — that double-counts.
        complexity++
      } else if (n.type === "infix_expression") {
        // Short-circuit operators are decision points (family contract).
        // Previously never counted on scala.
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") complexity++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Tiers: structural (grammar clauses, conf 1.0) | usage_contextual (calls,
   * field access, companion-apply idioms) | import_based | reference_qualified
   * | inferred (sub-1.0 resolutions). Applied centrally at end of analyze()
   * so no emission site can forget it.
   */
  /**
   * Declared-type reference graph (M14). References edges from the enclosing
   * function/class to every named type in a declaration position. Scala's
   * @throws[IO] annotation parses as generic_type("throws", [IO]) — the
   * "throws" name is skipped, its arguments become throws_type edges.
   */
  private collectDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()

    // M59 (#825, second half): a type name is stamped with the line of the
    // NODE THAT CARRIES THE NAME, not with the line its enclosing type
    // expression happens to start on. `type Shape[T] = Shape.Cases[(\n
    //   Shape.Case[Cons[T], (T, Lst[T])],\n  Shape.Case[Nil.type, Unit]\n)]`
    // names Cons/Lst/Unit on lines 2-4 of that expression; stamping the root's
    // line put all of them on the `type` line, which fails the oracle against
    // the source (9 of 13 remaining scala failures on a 60-file sample). The
    // call-site half of the same defect was fixed in this round too: the line
    // belongs to the name, never to the construct that contains it.
    const collectTypeNames = (n: Node, out: Array<{ name: string; line: number }>): void => {
      const push = (name: string): void => {
        if (name === "throws") return
        if (out.some((x) => x.name === name)) return
        out.push({ name, line: n.startPosition.row + 1 })
      }
      if (n.type === "type_identifier") {
        push(n.text)
        return
      }
      // S1.11 (M49 #715): `stable_type_identifier` — dotted/qualified types
      // (js.Object, scala.Any, collection.mutable.Map) recursed into plain
      // `identifier` children that collectTypeNames ignored, so qualified
      // type positions emitted ZERO references. The FULL dotted text is the
      // honest target (cross-language convention: kotlin/java keep dotted).
      if (n.type === "stable_type_identifier") {
        push(n.text)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNames(c, out)
      }
    }

    const resolveSource = (start: Node): string => {
      let p: Node | null = start.type === "function_definition" || start.type === "function_declaration"
        ? start
        : start.parent
      while (p) {
        if (p.type === "function_definition" || p.type === "function_declaration") {
          const name = this.scalaDeclaredNameOf(p)
          if (name) return name
        }
        if (p.type === "class_definition" || p.type === "object_definition" || p.type === "trait_definition" || p.type === "enum_definition") {
          const name = this.scalaDeclaredNameOf(p)
          if (name) return name
        }
        p = p.parent
      }
      // S1.7 (M49 #715): ONE top-level sentinel — "(script)" everywhere
      // (calls/instantiates/throws/refs/imports). The old split left the
      // file root as three disconnected graph nodes.
      return "(script)"
    }

    const emit = (decl: Node, roots: Node[], kind: string, relType = "declared_type", sourceOverride?: string, leafOnly = false): void => {
      const source = sourceOverride ?? resolveSource(decl)
      for (const r of roots) {
        if (!r) continue
        const names: Array<{ name: string; line: number }> = []
        collectTypeNames(r, names)
        for (const { name: raw, line: nameLine } of names) {
          // S1.11-merge: the G6 recorded contract (derives-refs fixture) is
          // LEAF targets for derives clauses ("scala.util.hashing.Hashing"
          // references Hashing — the family lastSegment convention); type
          // POSITIONS (val/param/return/given) keep the full dotted form per
          // the M14.1 cross-language convention. surface-specific, recorded.
          const t = leafOnly ? (raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw) : raw
          if (!t) continue
          const key = `${source}|${t}|${kind}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            // M59 (#825): a type reference occurs where the type is NAMED, so
            // the line is the type node's own — this one site covers
            // declared_type / return_type / pattern_type / type_alias /
            // cast_target / instanceof_check / given_type / tuple_type /
            // annotation_type, which together were 1,129 line-less edges on a
            // 60-file scala sample. Note what it is NOT: the declaration's line.
            // `def f: Map[K, V]` written over several lines references Map on
            // the line Map is written on. `nameLine` (not `r`'s start) is what
            // makes that true when the type expression itself is multi-line.
            line_number: nameLine,
            metadata: { relationshipType: relType, declaredOn: decl.type },
          })
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "given_definition": {
          // SCD12: `given Ordering[Int] with {}` / `given od: Ordering[Int]` —
          // the given's type clause references the type it PROVIDES. The
          // generic_type/type_identifier child IS that clause (the named
          // identifier child, when present, is the given's own name —
          // excluded). Previously givens emitted zero type references.
          // S1.11: stable_type_identifier joins (qualified given types).
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && this.isTypePositionNode(c.type)) roots.push(c)
          }
          if (roots.length) emit(n, roots, "given_definition", "given_type")
          break
        }
        case "class_parameter":
        case "parameter": {
          emit(n, [n], n.type)
          break
        }
        case "val_definition":
        case "var_definition":
        case "val_declaration":
        case "var_declaration": {
          // SCD9 joins: abstract val/var declarations now emit symbols, so
          // their type clauses must emit refs too (trait Service { val name:
          // String } references String — previously invisible). Same type
          // child shapes as the definition forms.
          // Type clause = direct type children. The name identifier precedes
          // the type in this grammar, so no positional break; initializers
          // are call_expression/literal children and never match type nodes.
          // S1.11: stable_type_identifier (js.Object) is a type child too —
          // `val x: js.Object` emitted zero refs without it.
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && this.isTypePositionNode(c.type)) roots.push(c)
          }
          if (roots.length) emit(n, roots, n.type)
          break
        }
        case "annotation": {
          // @throws[IO] — see function_definition note.
          const gt = this.findChild(n, "generic_type")
          if (gt && gt.namedChild(0)?.text === "throws") {
            const argsNode = this.findChild(gt, "type_arguments")
            if (argsNode) emit(n, [argsNode], "throws_annotation", "throws_type")
          }
          break
        }
        case "function_definition":
        case "function_declaration": {
          let sawParams = false
          // S1.12: is there a parameters clause at all? A parameterless def
          // (`def size: Int`) has none — its type child IS the return type.
          const hasParamsClause = !!this.findChild(n, "parameters")
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "parameters") { sawParams = true; continue }
            // M14 #419 G5: tuple_type (and other *_type forms) in RETURN
            // position — def pair(): (Int, String) references Int and String.
            // M14.0.F6: "functional_type" was a dead literal — the pinned
            // tree-sitter-scala grammar names arrow types "function_type"
            // (probe-verified 2026-09: def pair(): (Int, String) => Int). It
            // was added here once and could never fire, silently dropping
            // arrow-type return references.
            // S1.12 (M49 #715): a PARAMETERLESS def (`def size: Int`) never
            // sets sawParams, so its return type was labeled annotation_type
            // / declared_type — invisible to return-filtered consumers. A
            // type child AFTER an empty-but-present parameter list is still a
            // return; a type child with NO parameters clause at all in a
            // FUNCTION is the parameterless return form.
            if (c.type === "generic_type" || c.type === "type_identifier" || c.type === "function_type" || c.type === "tuple_type" || c.type === "stable_type_identifier") {
              // @throws[IO] annotation type parses as generic_type("throws",
              // [IO]) and appears BEFORE parameters; skip "throws" itself,
              // emit its arguments as throws_type edges.
              if (!sawParams && c.namedChild(0)?.text === "throws") {
                const argsNode = this.findChild(c, "type_arguments")
                if (argsNode) emit(n, [argsNode], "throws_annotation", "throws_type")
                continue
              }
              // M14 #419 G5: tuple_type return refs carry declaredOn tuple_type
              // so the mutant pins the fix precisely.
              emit(n, [c], c.type === "tuple_type" ? "tuple_type" : ((sawParams || !hasParamsClause) ? "return_type" : "annotation_type"), sawParams || !hasParamsClause ? "return_type" : "declared_type")
            }
          }
          break
        }
        case "call_expression": {
          // x.asInstanceOf[T] / o.isInstanceOf[T] (call-shaped parses)
          const fn = n.childForFieldName?.("function")
          const fnText = fn ? fn.text : ""
          if (fnText.endsWith("asInstanceOf") || fnText.endsWith("isInstanceOf")) {
            const args = n.childForFieldName?.("arguments") || this.findChild(n, "type_arguments")
            if (args) emit(n, [args], fnText.endsWith("asInstanceOf") ? "cast_target" : "instanceof_check")
          }
          break
        }
        case "generic_function": {
          // x.asInstanceOf[T] / o.isInstanceOf[T] parse as generic_function
          // (field_expression + type_arguments), not call_expression.
          const fe = this.findChild(n, "field_expression")
          const tail = fe ? (fe.namedChild(fe.namedChildCount - 1)?.text ?? "") : ""
          if (tail === "asInstanceOf" || tail === "isInstanceOf") {
            const args = this.findChild(n, "type_arguments")
            if (args) emit(n, [args], tail === "asInstanceOf" ? "cast_target" : "instanceof_check", tail === "asInstanceOf" ? "cast_target" : "instanceof_check")
          }
          break
        }
        case "typed_pattern": {
          // M14 #419 G2: case p: Point — the pattern type is the LAST named
          // child (type_identifier / type form). Previously pattern types
          // were invisible; only the case-class param types emitted refs.
          const last = n.namedChild(n.namedChildCount - 1)
          if (last) emit(n, [last], "typed_pattern", "pattern_type")
          break
        }
        case "case_class_pattern": {
          // M14 #419 G2: case Point(a, b) — the constructor type is the
          // FIRST named child (type_identifier).
          const first = n.namedChild(0)
          if (first) emit(n, [first], "case_class_pattern", "pattern_type")
          break
        }
        case "derives_clause": {
          // M14 #419 G6: derives Show, Hashing — the clause references the
          // derived typeclasses; source is the enclosing declaration.
          // S1.11-merge: leafOnly — the G6 recorded contract pins LEAF
          // targets for qualified derives (see emit()).
          emit(n, [n], "derives_clause", "derives_type", undefined, true)
          break
        }
        case "type_definition": {
          // M14 #419 G7: type Fn = (Int) => String — the alias references
          // its RHS types; source is the ALIAS name itself (not the
          // enclosing declaration). The alias's own type parameters are
          // bindings, not references.
          const tName = this.findChild(n, "type_identifier") ?? this.findChild(n, "identifier")
          if (tName) {
            const rhs: Node[] = []
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && c !== tName && c.type !== "type_parameters") rhs.push(c)
            }
            emit(n, rhs, "type_definition", "type_alias", tName.text)
          }
          break
        }
        case "self_type": {
          // M14 #419 G9: self: Service => — the self type is the LAST named
          // child; source is the enclosing trait/class.
          const last = n.namedChild(n.namedChildCount - 1)
          if (last) emit(n, [last], "self_type", "self_type")
          break
        }
        case "field_expression": {
          // M14 #419 G3: Foo.bar method values — a field_expression whose
          // receiver is a CAPITALIZED identifier is a type-qualified member
          // handle and references the type. Call positions (the function of
          // a call_expression, e.g. xs.map) are skipped — the call edge
          // carries them; lowercase receivers (h.value) are Uses (G8, in
          // collectExpressionUses). Package paths (com.foo.bar) start
          // lowercase and never match.
          const isCallFn = n.parent && n.parent.type === "call_expression" && n.parent.childForFieldName?.("function")?.id === n.id
          if (!isCallFn) {
            const recv = this.leftmostIdentifier(n)
            // The receiver is an `identifier` (Foo), NOT a type_identifier,
            // so the emit helper's collectTypeNames would never see it — push
            // the edge directly.
            if (recv && recv.text.length > 0 && recv.text.charCodeAt(0) >= 65 && recv.text.charCodeAt(0) <= 90) {
              const source = resolveSource(n)
              const key = `${source}|${recv.text}|field_expression`
              if (!emitted.has(key)) {
                emitted.add(key)
                relationships.push({
                  source,
                  target: recv.text,
                  type: ASTEngine.RelationshipType.References,
                  confidence: 0.95,
                  // M59 (#825): the referenced type is named by the receiver.
                  line_number: recv.startPosition.row + 1,
                  metadata: { relationshipType: "method_value", declaredOn: "field_expression" },
                })
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
   * M14 #419 G4/G8: expression-level Uses edges.
   * - interpolated_string_expression > interpolation: s"hi $name" USES the
   *   interpolated identifier (simple $name form — the direct identifier
   *   child). The ${expr} block form is expression-use territory (scala
   *   emits no expression-level uses by design — D1/D3 boundary).
   * - field_expression (non-call position): h.value reads/writes and nullary
   *   access xs.length USE the receiver — scala had no field-access uses
   *   collector (only extension methods emitted Uses), the family gap vs
   *   java/groovy/kotlin. Receiver-only: never guess method-vs-field (D3
   *   ruling). Call positions (xs.map(...)) are skipped — the call edge
   *   carries them; capitalized receivers (Foo.bar) are References (G3,
   *   collectDeclaredTypeRefs). Deduped per (source, target).
   */
  private collectExpressionUses(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()
    const resolveSource = (start: Node | null): string => {
      let p: Node | null = start && (start.type === "function_definition" || start.type === "function_declaration")
        ? start
        : start ? start.parent : null
      while (p) {
        if (p.type === "function_definition" || p.type === "function_declaration") {
          const name = this.scalaDeclaredNameOf(p)
          if (name) return name
        }
        if (p.type === "class_definition" || p.type === "object_definition" || p.type === "trait_definition" || p.type === "enum_definition") {
          const name = this.scalaDeclaredNameOf(p)
          if (name) return name
        }
        p = p.parent
      }
      // S1.7: one top-level sentinel (see collectDeclaredTypeRefs).
      return "(script)"
    }
    const emitUse = (n: Node, target: string, nameNode?: Node): void => {
      if (!target) return
      // SCD1 (JAD1/KAD1 family contract): assignment LHS is a WRITE, not a
      // read. `h.value = 5` previously emitted uses h. Both write shapes are
      // gated (probe-verified): `=` parses as assignment_expression (LHS =
      // first named child); `+=` and friends parse as infix_expression whose
      // operator_identifier text is the compound-assign op — gated ONLY for
      // that op set, because infix_expression is also the BINARY node
      // (`h.value + 1` is a read and must still emit; ==/<= must too).
      // The read side of `h.value = h.value + 1` still emits (span check
      // hits only the LHS occurrence).
      const p = n.parent
      const isCompoundAssign = p !== null && p.type === "infix_expression" && scalaOperatorIsAssignment(p.childForFieldName?.("operator")?.text ?? p.namedChild(1)?.text ?? "")
      const lhs = p && (p.type === "assignment_expression" || isCompoundAssign) ? p.namedChild(0) : null
      if (lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex) return
      const source = resolveSource(n.parent)
      const key = `${source}|${target}|uses`
      if (emitted.has(key)) return
      emitted.add(key)
      relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.Uses,
        // M59 (#825): a read happens where the NAME is written, so the line
        // comes from the name node — not from `n`, which for a field access is
        // the receiver and would hand a multi-line chain the line it opened on
        // (the same defect class fixed for calls above). `n` is the fallback
        // only when no name node was passed.
        line_number: (nameNode ?? n).startPosition.row + 1,
        confidence: 0.9,
        metadata: { relationshipType: "expression_use" },
      })
    }
    const walk = (n: Node): void => {
      if (n.type === "interpolation") {
        const id = n.namedChild(0)
        if (id && id.type === "identifier") emitUse(n, id.text, id)
      } else if (n.type === "field_expression") {
        const isCallFn = n.parent && n.parent.type === "call_expression" && n.parent.childForFieldName?.("function")?.id === n.id
        if (!isCallFn) {
          const recv = this.leftmostIdentifier(n)
          // M49 W15 (family-parity gate G9, the `member-read-through-receiver`
          // construct): `this.count` emitted `uses <method> -> this` — the edge
          // targeted the literal KEYWORD, which is not a symbol in the graph at
          // all, so the member read was invisible and the target was garbage.
          // Every other managed-OO analyzer targets the MEMBER here
          // (java/swift/python/dart/cpp/csharp/php/go/rust all emit
          // `<method> -> count`; probe-verified across 13 analyzers). A
          // self-receiver resolves to its member leaf; any other receiver keeps
          // the base-variable read (reading `h.value` also reads `h`).
          const isSelfReceiver = recv !== null && (recv.text === "this" || recv.text === "super")
          if (isSelfReceiver) {
            const leaf = n.childForFieldName?.("field")
            if (leaf && leaf.text.length > 0) emitUse(n, leaf.text, leaf)
          } else if (recv && recv.text.length > 0 && !(recv.text.charCodeAt(0) >= 65 && recv.text.charCodeAt(0) <= 90)) {
            // Capitalized receivers are type references (G3) — never Uses.
            emitUse(n, recv.text, recv)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        // M14 #419 G1: isImportDep — the JVM-family tier bug (the classifier
        // ignored the flag, so every scala import edge was mislabeled
        // reference_qualified; kotlin/java/groovy now recognize their flags).
        md.evidenceClass = md.isImportDep ? "import_based" : "reference_qualified"
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
        md.evidenceClass = conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }


  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    extraMetadata: any = {},
  ): ASTEngine.UniversalSymbol {
    // M60 (#924, scala half): quoting syntax is not part of a NAME — and this
    // factory is the one place every published scala name is built. id,
    // ownerName and every `contains` target are derived FROM this string, so
    // stripping here keeps the whole surface consistent; it cannot break
    // resolution, because the analysis resolves references against the SOURCE's
    // own spellings (a reference to a backticked name is itself backticked)
    // long before anything is published. Backticked CALLS need nothing here:
    // handleCall and the oracle both refuse a backticked callee in lockstep, so
    // no call target can carry the syntax.
    name = stripScalaQuoting(name)
    const decorators = this.collectAnnotations(node)
    const kdoc = this.extractScalaDoc(node)
    // M59 (#825): the DECLARATION's own line (annotations skipped), so the
    // symbol line and its `contains` edge agree and both point at the keyword.
    const decl = this.declarationLineNode(node)
    return {
      name,
      kind,
      range: {
        startLine: decl.startPosition.row + 1,
        startColumn: decl.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        startIndex: decl.startIndex,
        endIndex: node.endIndex,
      },
      id: `${parent ? parent.id + "." : ""}${name}`,
      parent: parent ? parent.name : undefined,
      ownerName: parent ? parent.name : undefined,
      // ScalaD-G (M37.21 #610, scala3 Setup.scala): companion objects share
      // the class NAME (object Setup + class Setup) and the override post-pass
      // looks up the OWNER in a name-keyed typeIndex — without ownerKind the
      // module shadowed the class and its superTypes were unreachable (BFS
      // died at hop 0, Setup.isPreCC -> SetupAPI.isPreCC never emitted).
      // Stamp ownerKind at walk time so the post-pass routes lookups to the
      // same-kind index entry.
      ownerKind: parent ? parent.kind : undefined,
      visibility: this.getVisibility(node),
      parameters: extraMetadata.parameters,
      returnType: extraMetadata.returnType,
      decorators,
      comments: kdoc ? [kdoc] : [],
      // Hoisted top-level per family contract: the DB ingester reads
      // symbol.complexity (|| 1) for gravity scoring — leaving it only in
      // metadata left every scala symbol at complexity 1 in the index.
      complexity: extraMetadata.complexity,
      metadata: { ...extraMetadata, annotations: decorators },
    }
  }

  // ==========================================================================
  // ZERO-REGEX STRING HELPERS (M49 JVM-closure wave, user directive: analyzers
  // carry no regex unless a text micro-parse genuinely requires it).
  //
  // Each helper replaces a former regex literal with a char-scan whose
  // equivalence is provable by string algebra, recorded here per the
  // closure-audit rule that equivalence claims carry their own proof:
  //
  // - stripBracketGroups ≡ replace(/\[[^\[\]]*\]/g, ""), FAITHFULLY:
  //     the regex matches `[` + a run containing NO `[` and NO `]` + `]`.
  //     At each `[` the scan looks for the FIRST `]`; if any `[` occurs
  //     before it, the match at this position fails (regex would advance)
  //     and the `[` is emitted verbatim. A bare `>` or `<` is NEVER
  //     consumed — measured on cats-effect `ParallelF[Id, *] ~> Id` where
  //     a depth-scanner prototype dropped the `>` of `~>` (fabricated
  //     `(ParallelF ~ Id)` targets, caught by the corpus differential).
  // - stripAngleGroups ≡ replace(/<[^<>]*>/g, ""), same first-delimiter
  //     discipline for `<`/`>`; `~>` survives because a `>` with no
  //     preceding unmatched `<` is copied through.
  // - stripTypeArgs ≡ bracket pass THEN angle pass (the original chained
  //     replaces ran left-to-right in that order), then trim. Callers
  //     loop to a fixpoint for nested groups, as before.
  // - compactType ≡ replace(/\s+/g, ""): `\s+` is a maximal whitespace
  //     run; the scan copies non-space chars and skips runs — identical
  //     output for every input (whitespace = Unicode space class per
  //     JS \s; the scan uses the same set via c===" "||\t||\n||\r||\f||\v).
  // - isTypeishNodeName ≡ /identifier|type_identifier|_parameter$/.test
  //     (unanchored) and ≡ /_type$|type_identifier/.test: `includes(sub)`
  //     ≡ unanchored literal alternation; suffix tests use endsWith.
  // - isTypePositionNode ≡ (/type$|_type$/.test(t) || t==="type_identifier"
  //     || t==="stable_type_identifier" || t==="generic_type"):
  //     /type$|_type$/ over a node-type string ≡ endsWith("type") because
  //     _type$ is subsumed by type$ (any string ending in "_type" ends
  //     in "type") — the disjunction is exactly endsWith("type").
  // =========================================================================

  private stripBracketGroups(s: string): string {
    // Faithful emulation of replace(/\[[^\[\]]*\]/g, ""): at each `[`,
    // find the first `]`; match only if NO `[` lies between (else emit the
    // `[` and advance — exactly the regex engine's next-position retry).
    let out = ""
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== "[") { out += s[i]; continue }
      let j = i + 1
      let nested = false
      while (j < s.length && s[j] !== "]") {
        if (s[j] === "[") { nested = true; break }
        j++
      }
      if (j < s.length && !nested) { i = j; continue }
      out += s[i]
    }
    return out
  }

  private stripAngleGroups(s: string): string {
    // Faithful emulation of replace(/<[^<>]*>/g, ""): first `>` with no
    // `<` between; otherwise emit and advance. `~>` / `=>` survive.
    let out = ""
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== "<") { out += s[i]; continue }
      let j = i + 1
      let nested = false
      while (j < s.length && s[j] !== ">") {
        if (s[j] === "<") { nested = true; break }
        j++
      }
      if (j < s.length && !nested) { i = j; continue }
      out += s[i]
    }
    return out
  }

  /**
   * M60 (#924, scala E): the HEAD TYPE NAME of a type node — never the node's source
   * text. `new ScalaRandom[F](Applicative[F].pure(new JavaSecureRandom())) with
   * SecureRandom[F] {}` is an instance_expression whose type is a compound_type: a
   * whole EXPRESSION (constructor arguments included) whose NAME is the head type
   * constructor. The generic_type path already collapsed to the head; this applies the
   * same collapse to every type shape, descending the head position (compound base →
   * applied constructor → generic type) and falling back to the old text behaviour only
   * when the shape is none of those. Measured: SecureRandomCompanionPlatform.scala:70,
   * node shape in script/m14/tmp/c924-scala-val-shape.ts.
   */
  private scalaTypeHeadName(typeNode: Node): string {
    let n: Node | null = typeNode
    for (let guard = 0; n && guard < 8; guard++) {
      if (n.type === "type_identifier") return n.text
      if (n.type === "compound_type") n = n.childForFieldName("base") ?? n.namedChild(0)
      else if (n.type === "applied_constructor_type") n = n.namedChild(0)
      else if (n.type === "generic_type") n = n.namedChild(0)
      else break
    }
    return this.stripTypeArgs(typeNode.text)
  }

  /**
   * M60/S3: the SUPER TYPE NAME for an ANONYMOUS class — structurally walked, and
   * "" when no type name is reachable.
   *
   * This exists beside scalaTypeHeadName rather than replacing it because the two
   * answer different questions. scalaTypeHeadName names an INSTANTIATION target,
   * where the node's own text is the honest type (`new (IO ~> F) {}` really does
   * instantiate the natural-transformation type `(IO ~> F)`), and that label is
   * audited. An ANONYMOUS CLASS's name is SYNTHETIC — the analyzer's own rule,
   * stated at its emission site, is "a SYNTHETIC name must be canonical - never
   * source text" (#924) — and scalaTypeHeadName's text fallback violates it: for
   * a type shape the walk does not recognise it returns `stripTypeArgs(text)`.
   *
   * Measured on both corpora (script/m14/tmp/scala-garbage-names.ts, 400 files
   * each) — `anonymous_<source text>` symbols, whose name is no declared name in
   * their own file:
   *
   *   cats-effect 20 of 291, of which 18 are a natural-transformation supertype
   *     `new (IO ~> F) { ... }` -> `anonymous_(IO ~> F)` (LiftIO.scala:36,
   *     Async.scala:199, Resource.scala:244/580/997/1123, pure.scala x5, ...)
   *   scala3 15 of 191, of which 2 are a MULTI-LINE body published as a NAME:
   *     `anonymous_:\n      private var cur = Env.this\n      def hasNext = ...`
   *     (CheckCaptures.scala:77, CapturedVars.scala:114)
   *
   * The shapes that must still resolve, probed before this was written rather
   * than guessed (script/m14/tmp/scala-snip.ts /tmp/anon.txt):
   *
   *   new Runnable {}                     -> instance_expression > type_identifier
   *   new java.util.Comparator[String] {} -> generic_type > stable_type_identifier
   *                                          > stable_identifier(id,id) + type_identifier
   *   new Console.MapKConsole[Int] {}      -> generic_type > stable_type_identifier
   *                                          > identifier + type_identifier
   *   new ScalaRandom[F](a) with Sec[F] {} -> compound_type > base >
   *                                          applied_constructor_type > generic_type
   *
   * A qualified name is its leading identifiers joined by "." plus the final
   * type_identifier — which is what the text happened to be, now for a reason.
   */
  private scalaAnonymousSupertypeName(typeNode: Node | null): string {
    if (!typeNode) return ""
    const walk = (n: Node | null, guard: number): string => {
      if (!n || guard > 8) return ""
      switch (n.type) {
        case "type_identifier":
          return n.text
        case "compound_type": {
          const base = n.childForFieldName("base")
          return walk(base ?? n.namedChild(0), guard + 1)
        }
        case "applied_constructor_type":
        case "generic_type":
          return walk(n.namedChild(0), guard + 1)
        case "stable_type_identifier": {
          // `java.util.concurrent.Callable` arrives RIGHT-NESTED:
          //   stable_identifier( stable_identifier(java, util), concurrent )
          // so the segments must be collected RECURSIVELY — a flat scan of the
          // direct children drops `concurrent` and publishes
          // `anonymous_concurrent.Callable` (measured on
          // `new java.util.concurrent.Callable[String] { ... }`).
          const segs: string[] = []
          const collectStable = (t: Node, guard: number): void => {
            if (guard > 8) return
            for (let i = 0; i < t.namedChildCount; i++) {
              const c = t.namedChild(i)
              if (!c || c.type === "type_identifier") continue
              if (c.type === "stable_identifier") collectStable(c, guard + 1)
              else if (c.type === "identifier") segs.push(c.text)
            }
          }
          collectStable(n, 0)
          let last = ""
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "type_identifier") last = c.text
          }
          if (!last) return ""
          return segs.length > 0 ? `${segs.join(".")}.${last}` : last
        }
        default:
          return ""
      }
    }
    return walk(typeNode, 0)
  }

  private stripTypeArgs(s: string): string {
    // Original order preserved: bracket groups strip first, then angle
    // groups (replace-chain semantics), then trim.
    return this.stripAngleGroups(this.stripBracketGroups(s)).trim()
  }

  private compactType(s: string): string {
    let out = ""
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") continue
      out += c
    }
    return out
  }

  /** ≡ /identifier|type_identifier|_parameter$/.test(t): unanchored "identifier" ≡ includes (type_identifier is subsumed by it). NO _type disjunct — deliberately narrower than isExtensionReceiverTypeNode. */
  private isTypeishNodeName(t: string): boolean {
    return t.includes("identifier") || t.endsWith("_parameter")
  }

  /** ≡ /_type$|type_identifier/.test(t): suffix or the exact node type — NOT the bare-identifier disjunct of isTypeishNodeName. */
  private isExtensionReceiverTypeNode(t: string): boolean {
    return t.endsWith("_type") || t.includes("type_identifier")
  }

  /** ≡ /type$|_type$/.test(t) || t === "type_identifier" || t === "stable_type_identifier" (generic_type variant adds itself). */
  private isTypePositionNode(t: string): boolean {
    return t.endsWith("type") || t === "type_identifier" || t === "stable_type_identifier"
  }

  /** Extract supertypes from an extends_clause (direct type children in v0.26.2). */
  /**
   * M59 (#825): each supertype name is paired with the LINE IT IS WRITTEN ON.
   *
   * Scala writes the parents of a long inheritance list one per line:
   *
   *     trait IterableLike[+A]
   *       extends FromIterable          ← 106
   *          with IterableOps[A]        ← 107
   *          with IterablePolyTransforms[A]   ← 108
   *
   * Stamping the clause's start line put IterableOps/PolyTransforms on 106, a
   * line they are not written on — 8 of 8 remaining scala oracle failures at the
   * 300-file scale, including the `trait T1 extends { ... } with Base` form where
   * the parent appears AFTER an early-init block. Same defect family as the call
   * site (`#825` half one) and the declared-type reference: the line belongs to
   * the NAME, never to the construct containing it.
   */
  private extractSupertypes(extendsClause: Node): Array<{ name: string; line: number }> {
    const out: Array<{ name: string; line: number }> = []
    const push = (name: string, n: Node): void => {
      if (!name) return
      if (out.some((x) => x.name === name)) return
      out.push({ name, line: n.startPosition.row + 1 })
    }
    for (let i = 0; i < extendsClause.childCount; i++) {
      const c = extendsClause.child(i)
      if (!c || !c.isNamed) continue
      if (c.type === "type_identifier" || c.type === "identifier") {
        push(c.text, c)
      } else if (c.type === "stable_type_identifier") {
        // dotted parents like js.Object / scala.Any: keep FULL dotted name
        // (cross-language convention decided in M14.1)
        push(c.text, c)
      } else if (c.type === "generic_type") {
        // Prefer a dotted base (stable_type_identifier:
        // collection.mutable.ArrayBuffer[Int] -> full dotted name per
        // cross-language convention). Bare type_identifier alone would
        // drop qualified generic supertypes.
        let pushed = false
        for (let j = 0; j < c.childCount; j++) {
          const ch = c.child(j)
          if (ch && ch.type === "stable_type_identifier") {
            push(ch.text, ch)
            pushed = true
            break
          }
        }
        if (!pushed) {
          for (let j = 0; j < c.childCount; j++) {
            const ch = c.child(j)
            if (ch && ch.type === "type_identifier") {
              push(ch.text, ch)
              break
            }
          }
        }
      } else if (c.type === "compound_type") {
        for (let j = 0; j < c.namedChildCount; j++) {
          const ch = c.namedChild(j)
          if (ch && (ch.type === "type_identifier" || ch.type === "generic_type")) {
            if (ch.type === "type_identifier") push(ch.text, ch)
            else {
              const inner = this.extractSupertypes(ch)
              if (inner.length > 0) push(inner[0].name, ch)
              else push(ch.text, ch)
            }
          }
        }
      }
    }
    return out
  }

  private handleClass(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const mods = this.collectModifiers(node)
    const isCase = this.isCaseClass(node)
    const isSealed = mods.has("sealed")
    const isAbstract = mods.has("abstract")
    const isFinal = mods.has("final")
    const isImplicit = mods.has("implicit")

    // Constructor parameters: emit a constructor symbol + property symbols
    // for val/var params (case class params are implicitly val).
    const classParamsNode = this.findChild(node, "class_parameters")
    const constructorParams: string[] = []
    if (classParamsNode) {
      // S1.1 (M49 #715): ctor/property symbols previously created with
      // parent=null, so createSymbol derived id from the NAME alone — every
      // class's ctor collapsed to id "constructor" and every val param to
      // id "x" (probe: two classes → ["constructor","constructor"],["x","x"]).
      // A stub parent (id = class name, never pushed to symbols) qualifies
      // the ids: A.constructor / A.x. Same fix in handleEnum.
      const idStub = { id: name, name } as unknown as ASTEngine.UniversalSymbol
      const ctor = this.createSymbol("constructor", ASTEngine.SymbolKind.Constructor, classParamsNode, idStub, {
        type: "constructor",
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Class,
        scalaSpecific: true,
      })
      // ownerName must point at the class so contains resolves
      ctor.ownerName = name
      // S1.15: the ctor carries its parameter payload (names + types),
      // mirroring the java convention of copying components into the ctor.
      const ctorParams: ASTEngine.Parameter[] = []
      symbols.push(ctor)

      for (let i = 0; i < classParamsNode.namedChildCount; i++) {
        const cp = classParamsNode.namedChild(i)
        if (cp?.type !== "class_parameter") continue
        const pName = cp.childForFieldName("name")?.text
        if (!pName) continue
        constructorParams.push(pName)
        const paramType = cp.childForFieldName("type")?.text
        if (paramType) ctorParams.push({ name: pName, type: paramType, isImplicit: false })
        const pMods = this.collectModifiers(cp)
        const isVal = pMods.has("val")
        const isVar = pMods.has("var")
        if (isVal || isVar || isCase) {
          // val/var constructor params and case class params are real fields
          const prop = this.createSymbol(pName, ASTEngine.SymbolKind.Property, cp, idStub, {
            type: isVar ? "var" : "val",
            isConstructorProperty: true,
            ownerName: name,
            ownerKind: ASTEngine.SymbolKind.Class,
            isCaseClassParam: isCase,
          })
          prop.ownerName = name
          symbols.push(prop)
        }
      }
      if (ctorParams.length > 0) ctor.parameters = ctorParams
    }

    if (isSealed) patternsObj["Sealed Types"] = true

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Class, node, parent, {
      type: "class",
      isObject: false,
      isCaseClass: isCase,
      isSealed,
      isAbstract,
      isFinal,
      isImplicit,
      constructorParams: constructorParams.length > 0 ? constructorParams : undefined,
    })
    symbols.push(symbol)

    if (isImplicit) patternsObj["Implicit Classes (Extension Methods)"] = true

    // S1.5 (M49 #715): nested types must NOT export — handleVariable already
    // guards `!parent`; class/object/trait/enum were missing the guard, so
    // `class Outer { class Inner }` exported Inner as a top-level API name.
    if (this.isPublic(node) && !parent) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Class,
        range: symbol.range,
      })
    }

    const typeParams = this.extractScalaTypeParameters(node)
    if (typeParams.length > 0) {
      symbol.genericParameters = typeParams
      symbol.metadata!.typeParameters = typeParams
    }

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes.map((s) => s.name)
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i].name,
          // Scala: extends covers classes AND traits; first supertype =
          // extends is the documented convention (parenless class extends is
          // legal, so kotlin's ctor-invocation signal does not transfer).
          type: i === 0 ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
          // S1.4: explicit structural confidence (1.0) — undefined is
          // classifier-defaulted today but downstream >= 0.7 filters read
          // the field directly.
          confidence: 1.0,
          // M59 (#825): the parent's OWN line, not the clause's.
          line_number: supertypes[i].line,
          metadata: { isTrait: i > 0 },
        })
      }
    }

    return symbol
  }

  private handleObject(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const mods = this.collectModifiers(node)
    const isCase = this.isCaseClass(node)
    const isSealed = mods.has("sealed")

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Module, node, parent, {
      type: "object",
      isObject: true,
      isCaseObject: isCase,
      isSealed,
      scalaSpecific: true,
      isStatic: true,
    })

    ;(symbol as any).isStatic = true

    symbols.push(symbol)

    // S1.5: nested objects must not export (top-level guard, same as class).
    // M49 JVM-closure exports invariant: a companion object shares its
    // class's NAME (class Service + object Service), so the object's export
    // entry duplicates the class's — the F3 export-uniqueness gate (see
    // run-fixtures.ts) rejects duplicate export names. The class is the
    // importable unit; the companion resolves through it. Suppressed only
    // when a same-name type export already exists in THIS file.
    if (this.isPublic(node) && !parent && !exports.some((e) => e.name === name)) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Module,
        range: symbol.range,
      })
    }

    const typeParams = this.extractScalaTypeParameters(node)
    if (typeParams.length > 0) {
      symbol.genericParameters = typeParams
      symbol.metadata!.typeParameters = typeParams
    }

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes.map((s) => s.name)
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i].name,
          // Scala: extends covers classes AND traits; first supertype =
          // extends is the documented convention (parenless class extends is
          // legal, so kotlin's ctor-invocation signal does not transfer).
          type: i === 0 ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements,
          confidence: 1.0,
          line_number: extendsClause.startPosition.row + 1,
          metadata: { isTrait: i > 0 },
        })
      }
    }

    return symbol
  }

  private handleTrait(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const mods = this.collectModifiers(node)
    const isSealed = mods.has("sealed")
    if (isSealed) patternsObj["Sealed Types"] = true

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Interface, node, parent, {
      type: "trait",
      isTrait: true,
      scalaSpecific: true,
      isSealed,
    })
    symbols.push(symbol)

    // S1.5: nested traits must not export (top-level guard, same as class).
    if (this.isPublic(node) && !parent) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Interface,
        range: symbol.range,
      })
    }

    const typeParams = this.extractScalaTypeParameters(node)
    if (typeParams.length > 0) {
      symbol.genericParameters = typeParams
      symbol.metadata!.typeParameters = typeParams
    }

    const extendsClause = this.findChild(node, "extends_clause")
    if (extendsClause) {
      const supertypes = this.extractSupertypes(extendsClause)
      symbol.metadata!.superTypes = supertypes.map((s) => s.name)
      for (let i = 0; i < supertypes.length; i++) {
        relationships.push({
          source: symbol.name,
          target: supertypes[i].name,
          type: ASTEngine.RelationshipType.Extends, // trait supertypes: ALL are extends
          confidence: 1.0,
          // M59 (#825): the parent's OWN line, not the clause's.
          line_number: supertypes[i].line,
          metadata: { isTrait: i > 0 },
        })
      }
    }

    return symbol
  }

  private handleEnum(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Enum, node, parent, { type: "enum", scala3: true })
    symbols.push(symbol)
    patternsObj["Scala 3 Enums"] = true

    // S1.5: nested enums must not export; S1-NEW-1: enum HERITAGE — the old
    // handleEnum never looked at extends_clause, so `enum Color(val hex: Int)
    // extends Serializable` emitted ZERO extends edges and NO superTypes
    // metadata — and the oracle never derived it either (a J3-class shared
    // blind spot the differential could never catch; probe s1-probe3). The
    // extractor + walk mirror handleTrait (all supertypes are extends).
    if (this.isPublic(node) && !parent) {
      exports.push({ name, kind: ASTEngine.SymbolKind.Enum, range: symbol.range })
    }

    const enumExtends = this.findChild(node, "extends_clause")
    if (enumExtends) {
      const supertypes = this.extractSupertypes(enumExtends)
      symbol.metadata!.superTypes = supertypes.map((s) => s.name)
      for (const st of supertypes) {
        relationships.push({
          source: name,
          target: st.name,
          type: ASTEngine.RelationshipType.Extends,
          confidence: 1.0,
          // M59 (#825): the parent's OWN line, not the clause's.
          line_number: st.line,
          metadata: { isTrait: true },
        })
      }
    }

    // SCD6b: enum constructor params (class_parameters > class_parameter,
    // identical shape to handleClass) — mirror handleClass: constructor
    // symbol + val-param property symbols. `enum Planet(val mass: Double)`
    // previously emitted NO constructor and NO mass field; every case of
    // the enum carries that field.
    const enumParamsNode = this.findChild(node, "class_parameters")
    if (enumParamsNode) {
      // S1.1: stub-parent id qualification (see handleClass).
      const idStub = { id: name, name } as unknown as ASTEngine.UniversalSymbol
      const ctor = this.createSymbol("constructor", ASTEngine.SymbolKind.Constructor, enumParamsNode, idStub, {
        type: "constructor",
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Enum,
        scalaSpecific: true,
      })
      ctor.ownerName = name
      // S1.15: ctor parameter payload (enum parity with handleClass).
      const ctorParams: ASTEngine.Parameter[] = []
      symbols.push(ctor)

      for (let i = 0; i < enumParamsNode.namedChildCount; i++) {
        const cp = enumParamsNode.namedChild(i)
        if (cp?.type !== "class_parameter") continue
        const pName = cp.childForFieldName("name")?.text
        if (!pName) continue
        const paramType = cp.childForFieldName("type")?.text
        if (paramType) ctorParams.push({ name: pName, type: paramType, isImplicit: false })
        const pMods = this.collectModifiers(cp)
        const isVal = pMods.has("val")
        const isVar = pMods.has("var")
        if (isVal || isVar) {
          const prop = this.createSymbol(pName, ASTEngine.SymbolKind.Property, cp, idStub, {
            type: isVar ? "var" : "val",
            isConstructorProperty: true,
            ownerName: name,
            ownerKind: ASTEngine.SymbolKind.Enum,
          })
          prop.ownerName = name
          symbols.push(prop)
        }
      }
      if (ctorParams.length > 0) ctor.parameters = ctorParams
    }

    // Enum cases: simple_enum_case (`case Red`) and full_enum_case
    // (`case Red extends Color(0xff0000)` / `case B(val x: Int) extends E`).
    const walkEnumBody = (n: Node) => {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "simple_enum_case" || c.type === "full_enum_case") {
          const caseName = this.findChildIdentifier(c)
          if (caseName) {
            const member = this.createSymbol(caseName, ASTEngine.SymbolKind.EnumMember, c, symbol, {
              type: "enum_case",
              ownerName: name,
              ownerKind: ASTEngine.SymbolKind.Enum,
              scala3: true,
            })
            member.ownerName = name
            symbols.push(member)
          }
        } else {
          walkEnumBody(c)
        }
      }
    }
    const enumBody = this.findChild(node, "enum_body")
    if (enumBody) walkEnumBody(enumBody)

    return symbol
  }

  private handleTypeAlias(node: Node, symbols: ASTEngine.UniversalSymbol[], parent: ASTEngine.UniversalSymbol | null) {
    const name = this.extractIdentifier(node, "name")
    if (!name) return

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Type, node, parent, { isTypeAlias: true })
    symbols.push(symbol)
  }

  private handleGiven(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    patternsObj["Given/Using (Scala 3)"] = true
    patternsObj["Contextual Abstractions"] = true

    // M60/S6: the given's name is its `name:` FIELD and nothing else.
    //
    // The old read was `findChildIdentifier(node)` — the first DIRECT named
    // child of type `identifier` — which is wrong for a given in a way that is
    // invisible in a snippet and loud in a corpus: an ANONYMOUS given has no
    // `name:` field, and its BODY is often a bare identifier, so the body was
    // published as the given's name.
    //
    //   given Show[String] = ShowAny   -> published as `ShowAny`
    //   given given Context = this      -> published as `this`
    //   given ArgsSummary = state0      -> published as `state0`
    //
    // Two failures in one: the declared name (there is none) is invented, and
    // every such given in one owner then publishes the SAME name — in
    // Formatting.scala, 24 `given Show[X] = ShowAny` lines collapse onto the
    // single name `ShowAny`, which is ALSO a real `object ShowAny` in the file.
    // Measured on 400 files (script/m14/tmp/scala-given-body-census.ts):
    // scala3 has 85 anonymous givens, 40 of which carry a bare-identifier child,
    // and 28 of the 40 publish a name another symbol under the same owner
    // already holds. cats-effect has no given at all, so the corpus split is
    // 40/0.
    //
    // A named given still carries the name in the same field, and the field's
    // node type varies with the name (`given myOrd: ...` is an `identifier`,
    // `given + : Ord[Int] with ...` an `operator_identifier`) — which is why the
    // field is read rather than a node type matched.
    const explicitName = node.childForFieldName("name")?.text ?? null
    // S1.21 (M49 #715): anonymous given names were derived from the SOURCE
    // ROW (`given_${node.startPosition.row + 1}`), so any edit ABOVE the given
    // silently renamed the symbol and broke every stored reference. A stable
    // per-file COUNTER (first-anonymous = 1) is rename-stable under upstream
    // edits (only intra-file ordering shifts count, which re-analysis
    // recomputes atomically).
    if (!explicitName) this.givenCounter += 1
    const name = explicitName || `given_${this.givenCounter}`

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Constant, node, parent, {
      type: "given",
      isGiven: true,
      scala3: true,
      anonymous: !explicitName,
    })
    symbols.push(symbol)
    // S1.21b: a NAMED given is a public top-level value — it is callable,
    // importable, and takes part in implicit resolution exactly like a val.
    // The old handler had no export path at all, so `given myOrd: Ordering[Int]`
    // vanished from the public API surface.
    if (explicitName && this.isPublic(node) && !parent) {
      exports.push({ name, kind: ASTEngine.SymbolKind.Constant, range: symbol.range })
    }
    return symbol
  }

  private handleFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")

    let extensionReceiverType: string | undefined
    // M59 #825 follow-through (found by the oracle at HEAD, scala3
    // tests/warn/ext-override.scala): the use of the receiver TYPE is written
    // where the type node is — `extension (x: Bla)` names Bla on the extension
    // line, which need not be the method's line. The old stamp took the
    // method's declaration node, so a multi-line extension claimed a line its
    // name is not written on — the exact class #825 closed everywhere else.
    let extensionReceiverTypeNode: Node | null = null
    {
      // index-loop idiom, consistent with every other traversal in this file
      let anc: Node | null = node.parent
      while (anc) {
        if (anc.type === "extension_definition") {
          for (let i = 0; i < anc.namedChildCount; i++) {
            const pc = anc.namedChild(i)
            if (!pc || pc.type !== "parameters") continue
            if (pc.namedChildCount > 0 && pc.namedChild(0)) {
              const p0 = pc.namedChild(0)!
              for (let j = 0; j < p0.namedChildCount; j++) {
                const tc = p0.namedChild(j)
                if (tc && this.isExtensionReceiverTypeNode(tc.type)) {
                  // Nullable-extension receiver `String.?(...)` (Scala 3):
                  // strip ONE trailing ? — the old /\?$/ anchor is exact.
                  const t = tc.text
                  extensionReceiverType = t.endsWith("?") ? t.slice(0, -1) : t
                  extensionReceiverTypeNode = tc
                  break
                }
              }
            }
            break
          }
          break
        }
        if (anc.type === "class_definition" || anc.type === "trait_definition" || anc.type === "object_definition") break
        anc = anc.parent
      }
    }
    if (!name) return null

    const isMethod =
      parent &&
      (parent.metadata?.type === "class" ||
        parent.metadata?.type === "trait" ||
        parent.metadata?.type === "object" ||
        parent.kind === ASTEngine.SymbolKind.Class ||
        parent.kind === ASTEngine.SymbolKind.Interface ||
        parent.kind === ASTEngine.SymbolKind.Module)

    const mods = this.collectModifiers(node)
    const isAbstract = node.type === "function_declaration" || mods.has("abstract")
    const isOverride = mods.has("override")
    const isImplicit = mods.has("implicit")
    const isInline = mods.has("inline_modifier") || mods.has("transparent_modifier")

    const parameters: ASTEngine.Parameter[] = []
    let returnType: string | undefined = undefined

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "parameters") {
        let hasImplicit = false
        for (let j = 0; j < child.namedChildCount; j++) {
          const paramChild = child.namedChild(j)
          if (paramChild && paramChild.type === "implicit") {
            hasImplicit = true
            break
          }
        }
        for (let j = 0; j < child.namedChildCount; j++) {
          const paramNode = child.namedChild(j)
          if (paramNode && paramNode.type === "parameter") {
            const paramName = paramNode.childForFieldName("name")?.text || ""
            const paramType = paramNode.childForFieldName("type")?.text || ""
            parameters.push({
              name: paramName,
              type: paramType,
              isImplicit: hasImplicit,
            })
          }
        }
      }
    }

    const returnTypeNode = node.childForFieldName("return_type") || node.childForFieldName("type")
    if (returnTypeNode) {
      returnType = returnTypeNode.text
    }

    // S1.5b (M49 #715): enum methods leaked as free `Function` exports — the
    // isMethod check omits parent.kind === Enum (the enum body container is
    // the enum symbol but its metadata.type is "enum"), so `def hex` inside
    // `enum E` both misclassified AND exported at top level. Enum members
    // are methods of the enum (they need an enum instance).
    const isEnumMethod = parent?.kind === ASTEngine.SymbolKind.Enum || parent?.metadata?.type === "enum"
    const methodKind = isMethod || isEnumMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function

    const symbol = this.createSymbol(
      name,
      methodKind,
      node,
      parent,
      {
        type: "function",
        parameters: parameters.length > 0 ? parameters : undefined,
        returnType,
        isAbstract,
        isOverride,
        isImplicit,
        isInline,
        // Scala 3 extension methods: the receiver lives on the enclosing
        // extension_definition's parameters, NOT on the function node, and
        // the wrapper never becomes a parent symbol. Detect via ancestors.
        isExtension: !!extensionReceiverType,
        complexity: this.calculateScalaFunctionComplexity(node),
      },
    )

    symbols.push(symbol)

    // function-level generics: def map[R](...) — attach post-push (#383)
    const fnTypeParams = this.extractScalaTypeParameters(node)
    if (fnTypeParams.length > 0) {
      symbol.genericParameters = fnTypeParams
      symbol.metadata!.typeParameters = fnTypeParams
    }

    // M60/SDJ-1: the polarity of this gate was INVERTED, and it is the whole of
    // SDJ-1's residual. `isMethod` asks whether the walk parent is a TYPE, so
    // `!isMethod` meant "emit the extension receiver only when the extension is
    // nested inside a METHOD" — and dropped it for the far more common shape,
    // an extension block directly in an object, class or trait. The rule has no
    // dependence on where the extension sits: a def inside an
    // `extension_definition` uses that extension's receiver type.
    //
    // Measured on 400 files (script/m14/tmp/scala-extension-census.ts):
    // scala3 has 131 extension blocks holding 648 defs; this gate published 237
    // of them and dropped 382. cats-effect has 0 extension blocks at all, which
    // is why a corpus-level reading of this gate looks clean there.
    //
    // The ORACLE carried the same inversion from the other side — its gate was
    // `/^\s*def\s/.test(node.text)`, which is false for a def carrying modifiers
    // (`private inline def isGlobalTerminal`) and true for a bare one. So the two
    // sides were wrong on COMPLEMENTARY subsets and agreed, by accident, only on
    // a plain def inside an extension nested in a type.
    if (extensionReceiverType) {
      relationships.push({
        source: name,
        target: extensionReceiverType,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        // M59 (#825): the line belongs to the NAME — the receiver TYPE node,
        // not the method that uses it. `extension (x: Bla)` on its own line
        // puts `Bla` there; the method body follows below.
        line_number: (extensionReceiverTypeNode ?? node).startPosition.row + 1,
        metadata: { relationshipType: "scala_extension_method", isExtension: true },
      })
    }

    // S1.5 (family contract): only TOP-LEVEL public functions export — the
    // old push skipped isMethod but not local functions (`def inner` inside
    // `def outer` escaped as a top-level export) nor enum methods (5b above).
    if (this.isPublic(node) && methodKind === ASTEngine.SymbolKind.Function && !parent) {
      exports.push({
        name,
        kind: ASTEngine.SymbolKind.Function,
        range: symbol.range,
      })
    }

    if (name === "apply") patternsObj["Factory Pattern (apply)"] = true
    if (name === "unapply" || name === "unapplySeq") patternsObj["Extractor Pattern (unapply)"] = true

    return symbol
  }

  private handleVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
    parent: ASTEngine.UniversalSymbol | null,
  ): void {
    // Skip LOCAL variables inside function bodies (val/var declared in a
    // method/extension/lambda body are not project-level symbols — matches
    // the Kotlin contract where `val store` inside `createService()` is not
    // emitted). Class-level and top-level val/var ARE emitted.
    let ancestor = node.parent
    while (ancestor) {
      if (
        ancestor.type === "function_definition" ||
        ancestor.type === "function_declaration" ||
        ancestor.type === "lambda_expression" ||
        (ancestor.type === "block" && ancestor.parent?.type === "function_definition")
      ) {
        return
      }
      if (
        ancestor.type === "class_definition" ||
        ancestor.type === "trait_definition" ||
        ancestor.type === "object_definition" ||
        ancestor.type === "enum_definition" ||
        // M49/M37 #866: `template_body` is the body of an anonymous class
        // (`new Runnable { val field = target() }`). A val/var written
        // directly in it is a MEMBER of that type, not a local of the method
        // the literal happens to sit in — so the boundary check comes first,
        // exactly like the three named type forms above. Pre-fix the scan
        // walked past the body, reached the enclosing `def`, and dropped the
        // member entirely (java/groovy emit `property field
        // owner=anonymous_Runnable`). The body's PARENT must be the
        // instance_expression, otherwise this is a named/anonymous class body
        // handled by the branches above.
        (ancestor.type === "template_body" && ancestor.parent?.type === "instance_expression")
      ) {
        break
      }
      ancestor = ancestor.parent
    }

    // SCD9: ABSTRACT members parse as val_declaration / var_declaration (a
    // type clause with no initializer) while concrete ones are
    // val_definition / var_definition. The walk only handled the concrete
    // forms, so `trait Service { val name: String }` — every abstract
    // interface member — emitted NOTHING (abstract def was fixed earlier;
    // this is the same gap for fields). declarations carry the same name
    // child shape as definitions.
    let patternNode = node.childForFieldName("pattern")
    if (!patternNode) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.isNamed && child.type === "identifier") {
          patternNode = child
          break
        }
      }
    }
    if (!patternNode) return

    // S1.19 (M49 #715): tuple destructuring (`val (a, b) = pair`) parses the
    // name as a tuple_pattern — the old code emitted a literal "(a, b)"
    // symbol. Destructured fields are a run-time VALUE SHAPE, not declared
    // API symbols (there is no single symbol to name them); skip instead of
    // emitting garbage. Each element's USES are still emitted by the
    // expression collectors (the identifiers are ordinary reads).
    if (patternNode.type === "tuple_pattern") return

    // M60/S12: that refusal was for ONE of five pattern shapes, and the other
    // four published the PATTERN'S SOURCE TEXT as the symbol name. A `val`'s
    // pattern is a NAME only when it is a name; every other pattern is a
    // destructuring or matching shape with no single name to publish:
    //
    //   val State(queue, size) = s          -> `State(queue, size)`
    //   val selfRef :: regularRef = r       -> `selfRef :: regularRef`
    //   val vdef @ ValDef(_, tpt, rhs) = t  -> `vdef @ ValDef(_, tpt, rhs)`
    //   val _ = w                           -> `_`
    //   val s"${RootPackageName @ _}/" = rp  -> `s"${RootPackageName @ _}/"`
    //
    // None of them is spellable by a reference and none can be joined to
    // anything, so they are graph garbage with a name-shaped disguise — and the
    // analyzer's own rule (M60 #924, "quoting syntax is not part of a NAME",
    // createSymbol's "a SYNTHETIC name must be canonical") says a published name
    // is a NAME.
    //
    // The census is what makes the list exhaustive rather than a guess
    // (script/m14/tmp/scala-val-pattern-census.ts, 400 files each). scala3
    // 15,216 val/var definitions: identifier 14704, tuple_pattern 375,
    // case_class_pattern 91, infix_pattern 23, capture_pattern 10,
    // identifiers 8, operator_identifier 3, interpolated_string_expression 2.
    // cats-effect 3,577: identifier 3396, tuple_pattern 123, wildcard 54,
    // case_class_pattern 4. So the NAME shapes are `identifier`, `identifiers`
    // and `operator_identifier`; everything else is a pattern.
    //
    // Measured reach on the corpora: 2 published rows on a 400-file scala3 draw
    // (semanticdb/Scala3.scala:187-188, the symbolic-value string pattern — the
    // only one of the five that occurs at class/object level in that draw; the
    // rest sit inside methods and are already dropped by the function-scope
    // gate). All five are reachable at class or object level and are pinned by
    // validation/m14/fixtures/scala/m60-val-pattern-is-a-name.
    if (
      patternNode.type !== "identifier" &&
      patternNode.type !== "identifiers" &&
      patternNode.type !== "operator_identifier"
    ) return

    // M60 (#924, scala E): `val A, B = Value` declares TWO constants — the grammar
    // carries them as an `identifiers` node, and publishing its source text made
    // `A, B` one name that no reference can spell (measured: EnumerationTests.scala:3,
    // node shape in script/m14/tmp/c924-scala-val-shape.ts). Unlike the tuple_pattern
    // refused above (a run-time VALUE shape, S1.19), every child here IS a declared
    // name, so each is published as its own symbol over the definition's own range.
    const kind = node.type === "val_definition" || node.type === "val_declaration"
      ? ASTEngine.SymbolKind.Constant
      : ASTEngine.SymbolKind.Variable
    const declared: string[] = []
    if (patternNode.type === "identifiers") {
      for (let i = 0; i < patternNode.childCount; i++) {
        const child = patternNode.child(i)
        if (child && child.isNamed && child.type === "identifier") declared.push(child.text)
      }
    }
    if (declared.length === 0) declared.push(patternNode.text)
    for (const name of declared) {
      const symbol = this.createSymbol(name, kind, node, parent, { type: node.type, isAbstract: node.type === "val_declaration" || node.type === "var_declaration" })
      symbols.push(symbol)

      if (this.isPublic(node) && !parent) {
        exports.push({
          name,
          kind: kind,
          range: symbol.range,
        })
      }
    }
  }

  private handleInstantiation(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
  ) {
    // instance_expression :: type_identifier | arguments  (v0.26.2)
    // Top-level constructions (no enclosing symbol) are attributed to the
    // "(script)" sentinel rather than silently dropped - matches the
    // kotlin/groovy script-attribution convention (M14.1).
    const sourceName = parent?.name ?? "(script)"
    const typeNode = node.namedChild(0)
    if (!typeNode) return
    // M60 (#924, scala E): the instantiated NAME is the head type — a compound_type's
    // text carries the constructor ARGUMENTS, which are syntax, not a name.
    let typeName = this.scalaTypeHeadName(typeNode)
    // Scala renders type arguments with SQUARE brackets: List[(A, B)](args)
    // — targets must be clean base names, so strip bracketed type args in
    // both syntaxes iteratively (nested args List[(A[B], C)] need repeated
    // passes; the <> form arrives via generic_type nodes).
    let prevTypeName: string | undefined
    do {
      prevTypeName = typeName
      typeName = this.stripTypeArgs(typeName)
    } while (typeName !== prevTypeName)
    if (typeName && typeName !== "unknown") {
      relationships.push({
        source: sourceName,
        target: typeName,
        type: ASTEngine.RelationshipType.Instantiates,
        confidence: 0.9,
        line_number: typeNode.startPosition.row + 1,
        metadata: { isInstantiation: true },
      })
    }
  }

  private handleCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    patternsObj: Record<string, boolean>,
    parent: ASTEngine.UniversalSymbol | null,
  ) {
    const fnNode = node.childForFieldName("function")
      if (fnNode) {
        // Scala 3 quote/splice syntax ('{ ... }, 'Sym) and backtick literals:
        // callees beginning with a quote character are not method calls or
        // constructions. Previously they emitted bogus PascalCase
        // Instantiates edges on macro-heavy code (dotty compiler corpus).
        if (fnNode.text.startsWith("'") || fnNode.text.startsWith("`")) return
        // Matrix 1b payload: symbol-level qualified call list (#383).
        // Dotted path WITHOUT argument text (family contract with java):
        // raw fnNode.text embedded inner-call arguments on chains
        // (`db.list(user).map` was stored as "db.list(user).map").
        // SCD7: AFTER the curried-application guard — the push previously
        // ran BEFORE it, so `self.add(1)(2)` double-pushed "self.add" (once
        // from the outer wrapper, once from the inner call). The guard
        // returns for wrapper nodes, so pushing below it is exact.
        if (parent && fnNode.type !== "call_expression") {
          if (!parent.qualified_calls) parent.qualified_calls = []
          parent.qualified_calls.push(this.buildScalaCallPath(fnNode))
        }
        // Curried application wrapper: `self.add(1)(2)` parses as an outer
        // call_expression whose function is the inner call `self.add(1)`. The
        // inner call is visited separately by the walker and emits the correct
        // `calls → add` edge — emitting here too would produce the noise target
        // `self.add(1)` AND a duplicate `add` edge.
        if (fnNode.type === "call_expression") return
        // M60/S11: a `calls` / `instantiates` TARGET MUST BE A NAME, so the CALLEE must
        // be a name-bearing shape. `calledName = fnNode.text` below is a NAME only
        // for those shapes; for anything else it is the callee EXPRESSION, and the
        // edge becomes unmatchable garbage — the class the analyzer already
        // documents and fixed for `throw` (SCD4, "the raw node.text embedded the
        // whole construction with its arguments ... became a single unmatchable
        // References target") and had not fixed here.
        //
        // Two shapes were live on the corpora:
        //   instance_expression         a CURRIED CONSTRUCTION — `new
        //     LensRef[F, A, B](ref)(get, set)` parses as a call_expression whose
        //     function is the instance_expression, so the target was
        //     `new LensRef(ref)`. handleInstantiation already publishes the
        //     `instantiates` edge for the construction itself, so nothing is lost.
        //   infix_expression / parenthesized_expression — dotty's right-associative
        //     `/:` reads `deps /: f(x)` as a call whose function is the infix
        //     expression, so the target was the WHOLE expression, newlines and all
        //     (`!inIntersection\n || accountsFor(elem)\n || ...`).
        //
        // The allowlist is the census, not a guess
        // (script/m14/tmp/scala-callee-shape-census.ts, 400 files each):
        //   identifier 25081 / field_expression 18842 / call_expression 1824 /
        //   generic_function 300 / instance_expression 15 / infix_expression 10 /
        //   parenthesized_expression 9 / wildcard 4 / prefix_expression 2 /
        //   operator_identifier 1        (scala3)
        //   identifier 8063 / field_expression 9477 / call_expression 1560 /
        //   generic_function 711 / wildcard 12 / instance_expression 8   (cats-effect)
        // `wildcard` is excluded: `_(x)` applies a PLACEHOLDER lambda, and `_` is
        // not a name in the graph.
        //
        // This was a SHARED BLIND SPOT with deriveScalaEdges, which fell back to
        // the same node text, so the differential reported 0 unexplained while
        // both sides published the same garbage — the J3 class a differential
        // cannot catch by construction. Measured before the fix: 8 analyzer rows
        // on cats-effect and 34 on scala3 whose target contains a space or a
        // parenthesis, and every one of them was in the oracle too. A name cannot
        // contain a space or a parenthesis, so the census test is exact.
        const CALLEE_NAME_SHAPES = new Set([
          "identifier", "field_expression", "generic_function", "operator_identifier",
          "type_identifier", "stable_type_identifier",
        ])
        if (!CALLEE_NAME_SHAPES.has(fnNode.type)) return
        // S1.10 (M49 #715): a GENERIC function node (`generic_function`, e.g.
        // `foo.bar[Baz](1)`) is a call whose leaf must be extracted BEFORE the
        // bracket strip — the old code fell through with fnNode.text
        // ("foo.bar[Baz]"), left the dotted "foo.bar" as the Calls target, and
        // the oracle emitted the same dotted shape: a shared blind spot no
        // differential could catch (probe s1-probe3). Extract the LAST
        // identifier leaf, mirroring the field_expression path.
        let calledName = ""
        let isQualified = false
        // M59 (#825): the emitted line must be the CALLEE's line, not the
        // call_expression's. A call_expression starts at its receiver, so in a
        // multi-line chain every call in the chain inherits the line the chain
        // opened on: measured on cats-effect Example.scala, `…replicateA_(2)
        // .as(ExitCode(2))` — written on line 23 — was reported on line 22,
        // because the parenthesised group that opens the chain starts there.
        // The callee leaf's own position is the line the call is written on.
        let calleeNode: Node | null = null
        if (fnNode.type === "generic_function") {
          const leaves: Node[] = []
          const findLeaves = (nn: Node): void => {
            if (nn.type === "identifier") { leaves.push(nn); return }
            if (nn.type === "type_arguments") return
            for (let i = 0; i < nn.namedChildCount; i++) {
              const c = nn.namedChild(i)
              if (c) findLeaves(c)
            }
          }
          findLeaves(fnNode)
          if (leaves.length > 0) {
            calleeNode = leaves[leaves.length - 1]
            calledName = calleeNode.text
            isQualified = leaves.length > 1
          }
        } else {
          calledName = fnNode.text
          calleeNode = fnNode
          isQualified = fnNode.type === "field_expression"
          if (isQualified) {
            // obj.method — the leaf identifier is the method name
            const leaves: Node[] = []
            for (let i = 0; i < fnNode.namedChildCount; i++) {
              const c = fnNode.namedChild(i)
              if (c && c.type === "identifier") leaves.push(c)
            }
            if (leaves.length > 0) {
              calleeNode = leaves[leaves.length - 1]
              calledName = calleeNode.text
            }
          }
        }
        const calleeLine = (calleeNode ?? node).startPosition.row + 1
      // Top-level (script-style) calls have no enclosing symbol. Attributing
      // them to a "(script)" sentinel mirrors handleInstantiation — dropping
      // them silently hollowed out top-level call graphs.
      // S1.7 (M49 #715): ONE top-level sentinel. The old code split the file
      // root across THREE nodes — (script) for calls/instantiates, root for
      // declared refs/imports, global for throws — so one file's top level
      // was three disconnected graph nodes (cross-language oddity; kotlin/java
      // each use one). Everything unparented now sources to "(script)".
      const sourceName = parent?.name ?? "(script)"
      if (calledName) {
        // Companion-apply construction idiom (Type(...)): in Scala, PascalCase
        // receiver-less calls ARE constructions (case-class/class companion
        // apply). MEASURED twice: M14.1 kept the heuristic (0.5% noise on the
        // scala3 60-file differential vs Java's removed 4.2% grails-core
        // fabrication); 2026-08 re-measure on a 300-file scala3 sample found
        // 1156 QUALIFIED PascalCase calls obj.Method() — enum-case/module
        // member accesses (LoadDestination.Jump, tpd.This), all fabricated
        // Instantiates when fed through the heuristic. Restriction: bare
        // Type(...) stays Instantiates; qualified obj.Method() emits Calls.
        const first = calledName.charCodeAt(0)
        const isCapitalized = first >= 65 && first <= 90
        // Same bracket-arg hygiene for companion-apply targets, iterative
        // for nested args: List[(A[B], C)](...) must target List.
        let prevCalled: string | undefined
        do {
          prevCalled = calledName
          calledName = this.stripBracketGroups(calledName).trim()
        } while (calledName !== prevCalled)
        if (isCapitalized && !isQualified) {
          relationships.push({
            source: sourceName,
            target: calledName,
            type: ASTEngine.RelationshipType.Instantiates,
            // S1.4: explicit heuristic confidence — a bare PascalCase call is
            // a companion-apply GUESS (documented 0.7 contract), never an
            // implicit-1.0 structural edge.
            confidence: 0.7,
            line_number: calleeLine,
            metadata: { isInstantiation: true },
          })
        } else {
          relationships.push({
            source: sourceName,
            target: calledName,
            type: ASTEngine.RelationshipType.Calls,
            // S1.4: method calls carry the documented 0.9 confidence (docs
            // promise 0.9 for calls; the classifier reads it explicitly).
            confidence: 0.9,
            line_number: calleeLine,
            metadata: {},
          })
        }
        if (["map", "filter", "flatMap", "foreach", "fold", "reduce", "collect"].includes(calledName)) {
          patternsObj["Higher-Order Functions"] = true
          patternsObj["Functional Programming"] = true
        }
      }
    }
  }

  private handleImport(node: Node, imports: ASTEngine.ImportInfo[]): void {
    if (node.type !== "import_declaration") return

    const parts: string[] = []
    const selectors: { local: string; imported: string }[] = []
    // M59 (#825): the line the TARGET of the import edge is written on. The
    // target is the dotted module, and its LAST segment is the name the edge
    // names — which is not always on the statement's first line. Measured on
    // cats-effect TestInstances.scala: the module `cats.effect.kernel.testkit`
    // opens on 21 while the renamed segment
    // (`TestInstances => KernelTestkitTestInstances`) that the analyzer appends
    // to it is written on 29, so the edge claimed a line its own name is not on.
    // Tracking the last segment's line is exact for every form (plain, renamed,
    // aliased) because `parts` IS the target.
    let moduleLine = node.startPosition.row + 1

    // M60/S7: quoting is not part of a NAME, so it is stripped from every
    // segment of the module path — the same rule createSymbol applies to every
    // symbol (M60 #924, whose comment states that factory is "the one place
    // every published scala name is built"). handleImport was the one site that
    // built a published name from raw node text, so
    // `import scala.language.`2.13`` published an `imp.module` AND a
    // `references` target of "scala.language.`2.13`" — a name no other edge can
    // spell, since the only other way to write that package is
    // `scala.language.2.13` (and `2.13` is backticked precisely because it is
    // not a legal Scala identifier). The reference could not join to anything.
    //
    // Measured on the full corpus (script/m14/tmp/scala-quoting-census.ts):
    // 658 of 23,650 import declarations in scala3 carry a backticked path
    // segment; cats-effect has 0 of 1,337. The 60-file lane rotation drew 8 of
    // them, which is why the differential saw the disagreement at all.
    const part = (text: string): string => stripScalaQuoting(text)

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "identifier" || child.type === ".") {
        if (child.type === "identifier") { parts.push(part(child.text)); moduleLine = child.startPosition.row + 1 }
      } else if (child.type === "namespace_wildcard") {
        selectors.push({ local: "*", imported: "*" })
      } else if (child.type === "namespace_selectors") {
        for (let j = 0; j < child.childCount; j++) {
          const sel = child.child(j)
          if (!sel) continue
          if (sel.type === "identifier") {
            selectors.push({ local: sel.text, imported: sel.text })
          } else if (sel.type === "arrow_renamed_identifier") {
            // `D => Renamed` — local alias is the RHS, imported name is the
            // LHS. The imported segment MUST join the module path
            // (scala.collection.{immutable => im} imports
            // scala.collection.immutable) — dropping it truncated the
            // references edge target, same failure mode the as-form fix
            // below solved.
            const imported = sel.namedChild(0)
            const local = sel.namedChild(1)
            if (imported && local) {
              parts.push(part(imported.text))
              moduleLine = imported.startPosition.row + 1
              selectors.push({ local: local.text, imported: imported.text })
            }
          }
        }
      } else if (child.type === "as_renamed_identifier") {
        // `Z as W` — the module path keeps the ORIGINAL segment (`x.y.Z`),
        // the alias is the local name. Losing `Z` truncated the module path
        // and broke the references edge for renamed imports.
        const original = child.namedChild(0)
        const alias = child.namedChild(1)
        if (original && original.type === "identifier") {
          parts.push(part(original.text))
          moduleLine = original.startPosition.row + 1
          selectors.push({ local: alias && alias.type === "identifier" ? alias.text : original.text, imported: original.text })
        }
      }
    }

    const pathStr = parts.join(".")

    if (selectors.length === 0) {
      let last = "*"
      if (pathStr.length > 0) {
        const idx = pathStr.lastIndexOf(".")
        last = idx >= 0 ? pathStr.substring(idx + 1) : pathStr
      }
      if (last === "*") last = pathStr
      selectors.push({ local: last, imported: last })
    }

    imports.push({
      module: pathStr,
      // M59 (#825): the line the module's last segment is written on (see above).
      moduleLine,
      // S1.25 (M49 #715): family consumers read `items` (engine.ts
      // ImportInfo.items: string[]) — scala was the ONLY family member
      // populating the legacy `specifiers` shape, so downstream import
      // listing silently showed nothing for scala. Both shapes are filled:
      // items = imported names, specifiers kept for any legacy reader.
      items: selectors.map((s) => s.imported),
      specifiers: selectors,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
    })
  }

  /**
   * M14 #419 G3/G8: the LEFTMOST identifier of a field_expression — for
   * a.b.c that is a (recursing through nested field_expressions); package
   * paths (com.foo.bar) yield com, so capitalized-receiver detection is
   * safe against package-qualified members.
   */
  private leftmostIdentifier(node: Node): Node | null {
    if (node.type === "identifier") return node
    const first = node.namedChild(0)
    return first ? this.leftmostIdentifier(first) : null
  }

  /**
   * The DECLARED NAME of a definition, read from its `name:` FIELD.
   *
   * M60/S8: this replaces "first child of type identifier", which is wrong for
   * an operator-named method. `def <&[B](that: IO[B]): IO[A]` carries its name
   * as an `operator_identifier`, so the first `identifier` child is the TYPE
   * PARAMETER `B` — and `resolveSource` then attributed every reference inside
   * that method to a type parameter named `B`. Two failures in one: the edge's
   * source is a binding rather than a declaration, and because the edge dedupe
   * key is (source, target, kind), every operator-named method in a file
   * collapses onto ONE bogus source, so the edge COUNT drops too.
   *
   * Measured on cats-effect/core/shared/src/main/scala/cats/effect/IO.scala,
   * where the operators `<*`, `<&`, `*>`, `>>`, `!>`, `&>` are the only sources
   * the derived truth attributes references to and the analyzer does not: 26
   * rows on the whole cats-effect corpus, and the whole of a 60-file rotation
   * read clean because the draw did not include this file.
   *
   * The lane's comparison matches on (label, target), so it cannot see a wrong
   * SOURCE at all — which is why this survived the `uses` audit at 100% too:
   * collectExpressionUses carries the same resolveSource.
   */
  private scalaDeclaredNameOf(node: Node): string | null {
    const f = node.childForFieldName?.("name")
    if (f) return f.text
    return this.findChild(node, "identifier")?.text ?? null
  }

  private findChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === type) return c
    }
    return null
  }

  /**
   * The declared name of a node that carries it as a bare `identifier` child —
   * an enum case (`case Red`, `case B(val x: Int) extends E`). Its `name:` field
   * would serve too, but the grammar's enum-case shape is the one place a
   * first-identifier scan and the field agree, and this helper is NOT safe for a
   * `given`: an anonymous given has no `name:` field and its BODY can be a bare
   * identifier, so the scan returns the given's VALUE. handleGiven reads the
   * field for that reason (M60/S6).
   */
  private findChildIdentifier(node: Node): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.isNamed && c.type === "identifier") return c.text
    }
    return null
  }
}
