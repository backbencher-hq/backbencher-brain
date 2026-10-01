import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
}

interface CleanContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  // Every function/method name declared in this file (module-level functions
  // + class/instance method names), collected by a pre-pass so unqualified
  // calls resolve even to LATER-defined functions (forward references).
  declaredFunctions: Set<string>
  functionSymbolIndex: Record<string, number>
  // Module name set by the module declaration; module-level symbols get
  // ownerName = module so the post-loop emits module → member contains edges.
  currentModule: string | undefined
  currentFunction: string | undefined
  seenRels: Set<string>
}

export class RealCleanAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, fileContent: string, filePath: string): ASTEngine.ParseResult {
    const ctx: CleanContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      declaredFunctions: new Set(),
      functionSymbolIndex: {},
      currentModule: undefined,
      currentFunction: undefined,
      seenRels: new Set(),
    }
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean; restoreFn?: string }[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    // Pre-pass: collect declared function/method names (forward references).
    this.collectDeclaredFunctions(rootNode, ctx.declaredFunctions)

    while (stack.length > 0) {
      const { node, isExit, restoreFn } = stack.pop()!

      if (isExit) {
        if (restoreFn !== undefined) ctx.currentFunction = restoreFn
        else if (
          node.type === "function_declaration" ||
          // An `operator_definition` makes a callable exactly as a
          // function_declaration does, so it must relinquish attribution on the
          // same terms. Without this the operator stayed `currentFunction` past
          // its own scope and swallowed every later module-level application:
          // measured on clean-stdlib/StdOverloadedList.icl, `(++|)` claimed
          // `flatten l` from the `Flatten :== flatten l` macro 6 lines below it
          // (the single UNEXPLAINED row of the exhaustive mini-differential).
          node.type === "operator_definition" ||
          node.type === "type_definition" ||
          node.type === "class_declaration" ||
          node.type === "instance_declaration"
        ) {
          ctx.currentFunction = undefined
        }
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) scopeStack.pop()
        continue
      }

      if (node.isMissing) continue

      if (node.hasError) {
        if (node.type === "ERROR") {
          ctx.errors.push({
            message: "Syntax Error",
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            severity: "error",
          })
        }
      }

      // Complexity — the PINNED grammar's emitted decision points.
      //
      // A function guard is a `guard_equation` (1,594 sites over this lane's
      // corpora); the `guard` node type beside it is a LIST-COMPREHENSION
      // qualifier (23 sites, every one of them under a `comprehension_qualifier`,
      // e.g. `[ k \\ k <- xs | k > 0 ]`). Counting only `guard` therefore measured
      // comprehension filters while 1,594 function guards — the decision points
      // this counter exists for — went uncounted. Both are counted now: they are
      // different decision points, not two spellings of one.
      if (node.type === "case_expression" || node.type === "case_alternative" || node.type === "guard_equation" || node.type === "guard" || node.type === "binary_expression") {
        cyclomaticComplexity++
      }

      let pushedScope = false
      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

      // Pattern marking
      if (node.type === "list_comprehension") ctx.patterns["List Comprehensions"] = true
      if (node.type === "case_expression") ctx.patterns["Pattern Matching"] = true

      if (node.type === "module_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "module_name")
        if (nameNode) {
          const name = this.assembleModuleName(nameNode)
          ctx.currentModule = name
          ctx.symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            metadata: { cleanSpecific: true },
          })
        }
      } else if (node.type === "import_declaration") {
        this.processImport(node, ctx)
      } else if (node.type === "type_definition") {
        pushedScope = this.processTypeDefinition(node, ctx, scopeStack)
      } else if (node.type === "class_declaration") {
        pushedScope = this.processClass(node, ctx, scopeStack)
      } else if (node.type === "instance_declaration") {
        pushedScope = this.processInstance(node, ctx, scopeStack)
      } else if (node.type === "function_declaration") {
        const localScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const insideLocalBlock = localScope?.kind === ASTEngine.SymbolKind.Namespace
        if (!insideLocalBlock) {
          pushedScope = this.processFunction(node, ctx, currentScope, scopeStack)
        } else {
          // Where-local function: scoped noise — its internals attribute to
          // nothing (M11.11 closure boundary).
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          ctx.currentFunction = undefined
          scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace })
        }
      } else if (node.type === "operator_definition") {
        // An operator definition is a CALLABLE wherever it lives — the Clean
        // norm for Eq/Ord instance members, and the definition half of a
        // module-level operator declaration — EXCEPT inside a where block, where
        // it is scoped noise like a where-local function (M11.11). Its body is
        // therefore attributed for the first time: measured over this lane's five
        // corpora (`script/m14/tmp/clean-dcl-shapes.ts`), 39 real module-level and
        // 192 instance-member operator definitions whose bodies hold 12 and 39
        // applications — this ruling gives 8 and 11 of them an attribution target,
        // the rest having heads the lane's own call gate excludes.
        const localScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const insideLocalBlock = localScope?.kind === ASTEngine.SymbolKind.Namespace
        const opName = insideLocalBlock ? null : this.operatorDefinitionName(node)
        if (opName) {
          pushedScope = this.processCallable(node, opName, ctx, currentScope, scopeStack)
        } else if (insideLocalBlock) {
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          ctx.currentFunction = undefined
          scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace })
        }
        // A pattern mis-shape (`# (a,b,c) = expr;`) is not a definition at all:
        // it publishes nothing and attributes nothing, exactly as before.
      } else if (node.type === "type_signature") {
        // Record the signature for return-type metadata.
        const sigName = this.findChild(node, (n) => n.type === "signature_name")
        const typeFn = this.findChild(node, (n) => n.type === "type_function")
        if (sigName?.text && typeFn?.text) {
          ctx.patterns["Typed Functions"] = true
        }
        // A MODULE-LEVEL declaration signature IS the file's interface (the whole
        // content of a `.dcl`), so it publishes a symbol. The HC2 precedent
        // (real-c-analyzer.ts): a C prototype publishes a Function marked
        // `isDeclaration`, and a prototype+definition pair merges into ONE
        // symbol, the definition winning — a Clean definition module is the same
        // case with different syntax, which is why the definition replaces this
        // symbol in `processCallable` rather than sitting beside it.
        //
        // Class/instance member signatures are already Method symbols from the
        // class/instance path, and a where-local signature is scoped noise; only
        // the module scope publishes here (scopeStack empty).
        if (scopeStack.length === 0) {
          const declName = this.declarationName(node)
          if (declName) this.processDeclaration(node, declName, ctx)
        }
        continue
      } else if (node.type === "class_member" || node.type === "instance_member") {
        // Members are processed via their inner type_signature /
        // function_declaration children during the walk.
      } else if (node.type === "application") {
        this.extractApplication(node, ctx)
      } else if (node.type === "case_alternative") {
        // Pattern-position constructors are NOT calls/instantiates; the
        // alternative body's applies are walked as children.
        ctx.patterns["Pattern Matching"] = true
      } else if (node.type === "lambda_expression") {
        ctx.patterns["Higher-Order Functions"] = true
      } else if (node.type === "where_block") {
        // where-locals: scoped noise.
        scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace })
        pushedScope = true
      }

      if (pushedScope) stack.push({ node, isExit: true })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    // Post-loop: contains for owned symbols — module → members, type →
    // constructors/fields, class/instance → methods. Self-named edges skipped.
    for (const s of ctx.symbols) {
      const _owner = s.ownerName
      if (_owner && _owner !== s.name) {
        // The CHILD's own naming line: this is the anchor that resolves the
        // intended target among same-named siblings (#921).
        this.pushRel(ctx, _owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)
      }
    }

    // Exports: all module-level symbols (Clean has no export keyword; the
    // module definition list governs, and everything is public by default).
    const EXPORTABLE_KINDS = new Set([
      ASTEngine.SymbolKind.Function,
      ASTEngine.SymbolKind.Type,
      ASTEngine.SymbolKind.Interface,
      ASTEngine.SymbolKind.Class,
      ASTEngine.SymbolKind.Module,
      ASTEngine.SymbolKind.Constructor,
      ASTEngine.SymbolKind.Property,
    ])
    // A symbol the MODULE owns is part of the module's interface, so it is
    // exported — the haskell lane's rule verbatim (`s.ownerName ===
    // currentModule`, real-haskell-analyzer.ts). The condition here used to be
    // `!sym.ownerName`, the exact NEGATION of the rule this block's own comment
    // stated, so it exported nothing but the module symbol itself: measured over
    // this lane's five corpora, 312 of 312 files exported <= 1 thing (6,031
    // module-owned symbols against 295 exports in total). A `.dcl`'s declared
    // interface is precisely what this list exists for, which is why the fix
    // rides the declaration ruling and not a wave of its own.
    //
    // Class/instance members keep their owner (`<class>` / the instance target
    // type), so they are NOT exported: their membership rides the `contains`
    // edge, exactly as the haskell lane treats a class method.
    //
    // Name-keyed first-wins dedupe — the exports-family invariant
    // (run-fixtures.ts, M49 JVM-closure audit) requires UNIQUE export names,
    // because a duplicate cannot identify its provider. Clean reaches the
    // collision honestly: `instance Eq ParseState where ...` publishes its
    // Class under the instance TARGET type, so a file that both defines the
    // type and implements an instance for it offered `ParseState` twice
    // (measured: 59 of 312 files before this line). Same dedupe as
    // cpp/go/objc/clojure (`seenExportNames`), keyed by bare name — a Clean
    // module exports a name, not a name+kind pair.
    const seenExportNames = new Set<string>()
    for (const sym of ctx.symbols) {
      if (sym.name.startsWith("_")) continue
      if (!EXPORTABLE_KINDS.has(sym.kind)) continue
      if (seenExportNames.has(sym.name)) continue
      if (sym.ownerName === ctx.currentModule || !sym.ownerName) {
        seenExportNames.add(sym.name)
        ctx.exports.push({ name: sym.name, kind: sym.kind, range: sym.range, visibility: "public" })
      }
    }

    const patterns: string[] = []
    for (const p in ctx.patterns) patterns.push(p)

    return {
      language: "clean",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: fileContent.split("\n").length,
        cyclomaticComplexity,
        patterns,
        hasTypeInference: true,
        analysisVersion: "11.0.0-clean-pure-ast",
      },
    }
  }

  // ==========================================================================
  // Relationship emission (dedupe by source|type|target identity).
  // ==========================================================================
  // Dimension 8 / M59.O2 (reviews/LANE-AUDIT-FORMULA.md §8): an edge carries the SITE
  // LINE it happened on — 1-based, on the name-bearing node, per-site and not
  // per-set — because navigation is the product. Two consequences, both deliberate:
  //
  //   * the line is part of the DEDUPE KEY (the clojure lane's rule,
  //     real-clojure-analyzer.ts:1388): a function called from three lines is three
  //     edges at three lines, not one edge at whichever line the walk saw first.
  //     The store already keys its rows the same way (parallel-indexer.ts:4439),
  //     and for a `contains` edge the child's own naming line is what resolves the
  //     intended target among same-named siblings (#921);
  //   * a line that is not a positive integer is recorded as ABSENT, never as 0.
  //     M59.O2: the contract is "the site line or NULL" — a fabricated 0 reads as
  //     "line 0" to every reader downstream.
  private pushRel(
    ctx: CleanContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any> = {},
    line?: number,
  ) {
    const hasLine = typeof line === "number" && Number.isInteger(line) && line > 0
    const key = `${source}|${type}|${target}|${hasLine ? line : ""}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    ctx.relationships.push({
      source,
      target,
      type,
      confidence,
      metadata,
      ...(hasLine ? { line_number: line as number } : {}),
    })
  }

  /** 1-based line of a node, or undefined — never 0 (M59.O2). */
  private lineOf(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    const line = node.startPosition.row + 1
    return line > 0 ? line : undefined
  }

  // The name a `type_signature` DECLARES, normalized across the four shapes the
  // pinned grammar puts inside `signature_name`:
  //
  //   identifier              `f :: !Int -> Bool`
  //   constructor             `NSMakeSize :: !NSSize !NSSizeType -> NSSize*`
  //                           — Clean lets an uppercase name be a FUNCTION, and
  //                           the grammar types it `constructor`
  //   parenthesized_operator  `(%.) infixl 9 :: ...` — the name is `%.`
  //   parenthesized_name      `(bitxor) :: !Int !Int -> Int` — the name is
  //                           `bitxor` (a prefix declaration of an infix-capable
  //                           name)
  //
  // A parenthesized shape carrying a comma or a brace is NOT a name: it is the
  // grammar's mis-shape for a PATTERN (`# (a,b,c) = expr;`, `# (r,{gst & ls=s})`),
  // and publishing it would fabricate a symbol no source declares. Measured over
  // this lane's five corpora (312 files, 148 of them `.dcl`): 2,753 module-level
  // signature sites, of which 1,021 names were published nowhere — 708
  // identifiers, 259 constructors, 45 operators, 9 parenthesized names.
  private declarationName(node: Node): string | null {
    const sigName = this.findChild(node, (n) => n.type === "signature_name")
    if (!sigName) return null
    const kid = sigName.namedChildCount > 0 ? sigName.namedChild(0) : null
    if (!kid) return null
    if (kid.type === "identifier" || kid.type === "constructor") return kid.text
    if (kid.type === "parenthesized_operator" || kid.type === "parenthesized_name") {
      return this.unparenthesize(kid.text)
    }
    return null
  }

  // The name an `operator_definition` declares. Same normalization as
  // `declarationName`'s parenthesized branch, so a signature and its definition
  // land on ONE key and merge instead of producing two symbols.
  private operatorDefinitionName(node: Node): string | null {
    const nameNode =
      node.childForFieldName("name") ??
      this.findChild(node, (n) => n.type === "parenthesized_operator" || n.type === "parenthesized_name")
    if (!nameNode?.text) return null
    return this.unparenthesize(nameNode.text)
  }

  /** Inner text of `(x)`, or null when the parens hold a PATTERN, not a name. */
  private unparenthesize(text: string): string | null {
    const inner = text.replace(/^\(|\)$/g, "").trim()
    if (!inner || /[,{}]/.test(inner)) return null
    return inner
  }

  // The declared name of a function definition, read from the grammar's FIELD.
  //
  // `findChild(node, n => n.type === "identifier")` returns the FIRST identifier child, which is
  // only the name while the name happens to be typed `identifier`. An uppercase definition's
  // name is typed `constructor`, so the heuristic skipped over it and published the first
  // PARAMETER as the function name. Measured over this lane's five corpora, per grammar:
  //
  //   pinned v1.2.4 : 4,607 declarations — 452 published a parameter as the name, 252 dropped
  //   v1.2.7        : 4,647 declarations — 447 published a parameter as the name, 244 dropped
  //
  // So this is a live HEAD defect, not something the grammar bump introduced: e.g.
  // `NSMakeSize w h #! ptr = ...` was published as `function:w` and
  // `AppDelDidFinishLaunching impAppDelDidFinishLaunching self cmd ...` as
  // `function:impAppDelDidFinishLaunching`. Both grammars expose `name:`, so the field is used
  // when present and the old heuristic remains only as a fallback for nodes without one.
  private declaredName(node: Node): Node | null {
    const byField = node.childForFieldName("name")
    if (byField?.text) return byField
    return this.findChild(node, (n) => n.type === "identifier")
  }

  // ==========================================================================
  // Pre-pass: declared function/method names (forward-reference resolution).
  // ==========================================================================
  private collectDeclaredFunctions(node: Node, out: Set<string>): void {
    if (node.type === "function_declaration") {
      const id = this.declaredName(node)
      if (id?.text) out.add(id.text)
      return
    }
    if (node.type === "type_signature") {
      const name = this.declarationName(node)
      if (name) out.add(name)
      return
    }
    if (node.type === "operator_definition") {
      const name = this.operatorDefinitionName(node)
      if (name) out.add(name)
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) this.collectDeclaredFunctions(child, out)
    }
  }

  // module_name children compose dotted names (Data.Map → Data + "." + Map)
  private assembleModuleName(node: Node): string {
    let out = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      const leaf = c.type === "module_name" ? this.assembleModuleName(c) : c.text
      if (out) out += "."
      out += leaf
    }
    return out || node.text
  }

  private processImport(node: Node, ctx: CleanContext) {
    const modules = node.childrenForFieldName("module")
    const aliasNode = node.childForFieldName("alias")
    const alias = aliasNode ? this.assembleModuleName(aliasNode) : undefined
    const isQualified = node.children.some((child) => child !== null && child.type === "qualified")
    for (const modNode of modules) {
      if (!modNode) continue
      const modName = this.assembleModuleName(modNode)
      ctx.imports.push({
        module: modName,
        source: modName,
        items: [],
        isTypeOnly: false,
        range: this.nodeToRange(node),
        metadata: { cleanSpecific: true, isQualified, alias },
      })
      // Site line = the imported module NAME's line (`import StdEnv` → that line).
      this.pushRel(
        ctx,
        ctx.currentModule || "",
        modName,
        ASTEngine.RelationshipType.References,
        1.0,
        { cleanSpecific: true, isImportDependency: true },
        this.lineOf(modNode),
      )
      if (modName.indexOf("StdEnv") !== -1) ctx.patterns["Standard Environment"] = true
    }
  }

  private processTypeDefinition(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const nameNode = this.findChild(node, (n) => n.type === "constructor")
    if (!nameNode?.text) return false
    const name = nameNode.text
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true },
    })

    // ADT constructors → Constructor symbols owned by the type. The grammar
    // nests them under type_definition_body → data_constructors.
    const typeBody = this.findChild(node, (n) => n.type === "type_definition_body")
    const ctorContainer = typeBody ? this.findChild(typeBody, (n) => n.type === "data_constructors") : null
    const ctorNodes = ctorContainer
      ? this.filterChildren(ctorContainer, (n) => n.type === "data_constructor")
      : this.filterChildren(node, (n) => n.type === "data_constructor")
    for (const cNode of ctorNodes) {
      const cName = this.findChild(cNode, (n) => n.type === "constructor")
      if (!cName?.text) continue
      ctx.symbols.push({
        name: cName.text,
        kind: ASTEngine.SymbolKind.Constructor,
        range: this.nodeToRange(cNode),
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Type,
        visibility: "public",
        metadata: { cleanSpecific: true, isADTConstructor: true },
      })
    }

    // Record fields → Property symbols owned by the type. The grammar nests
    // record_definition under type_definition_body.
    const recordDef =
      this.findChild(node, (n) => n.type === "record_definition") ||
      (typeBody ? this.findChild(typeBody, (n) => n.type === "record_definition") : null)
    if (recordDef) {
      for (let i = 0; i < recordDef.namedChildCount; i++) {
        const rf = recordDef.namedChild(i)
        if (!rf || rf.type !== "record_field") continue
        const fieldId = this.findChild(rf, (n) => n.type === "identifier")
        if (!fieldId?.text) continue
        ctx.symbols.push({
          name: fieldId.text,
          kind: ASTEngine.SymbolKind.Property,
          range: this.nodeToRange(rf),
          ownerName: name,
          ownerKind: ASTEngine.SymbolKind.Type,
          visibility: "public",
          metadata: { cleanSpecific: true, isRecordField: true },
        })
      }
    }

    ctx.patterns["Algebraic Data Types"] = true
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Type })
    return true
  }

  private processClass(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const nameNode = this.findChild(node, (n) => n.type === "class_name")
    if (!nameNode?.text) return false
    const name = nameNode.text
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true },
    })
    // Class member signatures → Method symbols owned by the interface.
    // Shape: class_member → type_signature → signature_name → identifier.
    for (let i = 0; i < node.namedChildCount; i++) {
      const member = node.namedChild(i)
      if (!member || member.type !== "class_member") continue
      const sig = this.findChild(member, (n) => n.type === "type_signature")
      // The member name normalizes through all four `signature_name` shapes, so a
      // class operator (`class Eq a where (==) :: a a -> Bool`) finally publishes
      // its Method — measured on this lane's corpora, 45 module-level and the
      // class-member operator signatures were published nowhere before.
      const mName = sig ? this.declarationName(sig) : null
      if (!mName) continue
      ctx.symbols.push({
        name: mName,
        kind: ASTEngine.SymbolKind.Method,
        range: this.nodeToRange(member),
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Interface,
        visibility: "public",
        metadata: { cleanSpecific: true, isClassMethod: true },
      })
    }

    ctx.patterns["Type Classes"] = true
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Interface })
    return true
  }

  private processInstance(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const classNode = this.findChild(node, (n) => n.type === "instance_class")
    const targetNode = this.findChild(node, (n) => n.type === "constructor")
    const className = classNode?.text || ""
    const targetType = targetNode?.text || ""
    if (!className || !targetType) return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    // Name the implementation class by its target type (Vec), matching the
    // universal impl-naming contract (Rust `impl User`, Elixir `defimpl`,
    // Haskell `instance Mergeable (Stream a)` → class Stream).
    const name = targetType
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true, className, targetType },
    })

    // Site line = the class NAME node's line (`instance Eq ParseState where` → that
    // line). For an implements edge the class name is the name-bearing node.
    this.pushRel(
      ctx,
      targetType,
      className,
      ASTEngine.RelationshipType.Implements,
      1.0,
      { cleanSpecific: true, isInstance: true },
      this.lineOf(classNode),
    )

    ctx.patterns["Type Classes"] = true
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Class })
    return true
  }

  private processFunction(
    node: Node,
    ctx: CleanContext,
    currentScope: Scope | undefined,
    scopeStack: Scope[],
  ): boolean {
    const nameNode = this.declaredName(node)
    if (!nameNode?.text) return false
    return this.processCallable(node, nameNode.text, ctx, currentScope, scopeStack)
  }

  // Publish (or extend) the callable named `name` in the current scope and make
  // it the attribution target for its body. Shared by `function_declaration` and
  // `operator_definition` — the two shapes Clean uses to DEFINE a callable — so
  // the clause-merge and declaration-merge rules cannot drift between them.
  private processCallable(
    node: Node,
    name: string,
    ctx: CleanContext,
    currentScope: Scope | undefined,
    scopeStack: Scope[],
  ): boolean {
    const functionKey = `${currentScope?.name || ""}::${name}`
    const existingIdx = ctx.functionSymbolIndex[functionKey]
    if (existingIdx !== undefined) {
      const existing = ctx.symbols[existingIdx]
      if (existing.metadata?.isDeclaration) {
        // HC2: the DEFINITION wins over the declaration occurrence — one entity,
        // the definition's own range, and no longer a bare declaration. This is
        // what keeps a `.icl`'s `f :: T` + `f x = ...` at ONE symbol instead of
        // four (2,753 module-level signature sites meet 1,294 in-file
        // definitions on this lane's corpora).
        existing.range = this.nodeToRange(node)
        delete existing.metadata.isDeclaration
        ctx.currentFunction = name
        scopeStack.push({ node, name, kind: existing.kind })
        return true
      }
      // Multi-clause definition (map2 f [] = ... / map2 f [x:xs] = ...) — merge
      const newRange = this.nodeToRange(node)
      existing.range.endLine = Math.max(existing.range.endLine, newRange.endLine)
      if (existing.range.endIndex !== undefined && newRange.endIndex !== undefined) {
        existing.range.endIndex = Math.max(existing.range.endIndex, newRange.endIndex)
      }
      ctx.currentFunction = name
      scopeStack.push({ node, name, kind: existing.kind })
      return true
    }

    const kind =
      currentScope &&
      (currentScope.kind === ASTEngine.SymbolKind.Interface || currentScope.kind === ASTEngine.SymbolKind.Class)
        ? ASTEngine.SymbolKind.Method
        : ASTEngine.SymbolKind.Function

    ctx.symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true },
    })
    ctx.functionSymbolIndex[functionKey] = ctx.symbols.length - 1

    ctx.currentFunction = name
    scopeStack.push({ node, name, kind })
    return true
  }

  // A module-level DECLARATION signature publishes a Function symbol marked
  // `isDeclaration`, which a later definition replaces (see processCallable). A
  // repeated declaration is one entity: the first occurrence wins.
  private processDeclaration(node: Node, name: string, ctx: CleanContext): void {
    const functionKey = `::${name}`
    if (ctx.functionSymbolIndex[functionKey] !== undefined) return
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      ownerName: ctx.currentModule,
      visibility: "public",
      metadata: { cleanSpecific: true, isDeclaration: true },
    })
    ctx.functionSymbolIndex[functionKey] = ctx.symbols.length - 1
  }

  // ==========================================================================
  // Call extraction — application nodes in body position.
  // ==========================================================================
  private extractApplication(node: Node, ctx: CleanContext) {
    const head = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!head) return
    const fn = ctx.currentFunction
    if (!fn) return

    // Qualified call: M.lookup / 'Data.Error'.isError → full qualified target
    // (the Erlang gen_server:cast precedent).
    if (head.type === "qualified_identifier") {
      this.pushRel(
        ctx,
        fn,
        head.text,
        ASTEngine.RelationshipType.Calls,
        0.9,
        { cleanSpecific: true, isQualifiedCall: true },
        this.lineOf(head),
      )
      return
    }

    // Constructor application (uppercase head) in body → instantiates
    // (Erlang record_expr / Haskell ctor-app analog). Pattern-position applies
    // live inside case_alternative heads / function head patterns, excluded
    // via isPatternPosition.
    if (head.type === "constructor") {
      if (this.isPatternPosition(node)) return
      this.pushRel(
        ctx,
        fn,
        head.text,
        ASTEngine.RelationshipType.Instantiates,
        0.9,
        { cleanSpecific: true, isConstructorApplication: true },
        this.lineOf(head),
      )
      return
    }

    // Local call: identifier head → leaf target, only when declared in-file
    // (FP-family resolution: StdEnv/imported functions and pattern vars are
    // not local symbols → no edge). Self-recursion IS emitted.
    if (head.type === "identifier") {
      if (ctx.declaredFunctions.has(head.text)) {
        this.pushRel(
          ctx,
          fn,
          head.text,
          ASTEngine.RelationshipType.Calls,
          0.9,
          { cleanSpecific: true, context: "local function call" },
          this.lineOf(head),
        )
      }
    }
  }

  private isPatternPosition(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      // case_alternative head (the pattern before ->) is never a construction
      if (cur.type === "case_alternative") return cur.namedChild(0) === node || this.isBeforeArrow(cur, node)
      // Function head patterns live before the `=` token — the RHS is a
      // different subtree, so any application under function_declaration that
      // precedes the = token is a pattern.
      if (cur.type === "function_declaration") return this.isBeforeEquals(cur, node)
      if (cur.type === "type_definition" || cur.type === "class_declaration" || cur.type === "instance_declaration") return false
      cur = cur.parent
    }
    return false
  }

  private isBeforeArrow(caseAlt: Node, node: Node): boolean {
    for (let i = 0; i < caseAlt.namedChildCount; i++) {
      const c = caseAlt.namedChild(i)
      if (!c) continue
      if (c.type === "arrow") return node.startIndex < c.startIndex
      if (c === node) return true
    }
    return false
  }

  // Pattern territory inside a function definition is everything BEFORE its body
  // FIELD. The pre-fix form scanned the children for one typed `operator` with
  // text `=`, which the pinned grammar cannot produce — measured, three ways:
  // a definition's s-expression carries name/pattern…/body and NO `=` child at
  // all; across the lane's 312 corpus files the 1,576 `operator` nodes are
  // operator SYMBOLS whose parents are binary_expression (829), unary_expression
  // (99), paren_pattern (9), operator_definition (5), instance_class (11), … and
  // never a function_declaration; and no `operator` node's text is `=`. The gate
  // could not fire, so a grammar that app-lifts a pattern into an `application`
  // would have started fabricating `instantiates` with nothing to stop it — the
  // exact failure this guard was written against. Expressed against the field,
  // the rule is live and means the same thing.
  private isBeforeEquals(fnDecl: Node, node: Node): boolean {
    const body = fnDecl.childForFieldName("body")
    if (!body) return false // no body (damaged parse): claim no pattern territory
    return node.startIndex < body.startIndex
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

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private filterChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
    const result: Node[] = []
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) result.push(child)
    }
    return result
  }
}
