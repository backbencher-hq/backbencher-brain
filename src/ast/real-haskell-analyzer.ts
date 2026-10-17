import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { BINDING_SEP } from "./types"

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
  // Local binders visible from this scope: name -> scoped identity
  // (`owner.local`). Only callable frames (isFrame) and local blocks carry it.
  locals?: Map<string, string>
  // A callable frame owns the edge attribution for its RHS (`currentFunction`).
  isFrame?: boolean
}

// Scoped local identity (M60 functional lane, 2026-09-26). A where/let local is
// NOT a module symbol, but its edges must be distinguishable from a
// module-level callable of the same name (the shadowing class): every local
// gets a lexical identity `${owner}.${name}`, and target resolution walks the
// scope stack so a local is only ever a target from inside its own scope.
interface LocalScopes {
  // callable node id -> scoped identity (bare name for module-level callables)
  callableScoped: Map<number, string>
  // local_binds/let block node id -> the binders it declares
  blockLocals: Map<number, Map<string, string>>
  // callable node id -> where-locals visible across that callable's whole RHS
  frameLocals: Map<number, Map<string, string>>
}

/**
 * Keywords that may stand ALONE as an `export` node's only named child when the
 * grammar mis-parses `data D` / `class C a` in an export list (the name lands in
 * a sibling `ERROR`). `readExportName` must not publish one of these as a name.
 *
 * Declared at module scope, not rebuilt per call: it is read once per `export`
 * node and the export list is the hottest loop in `processModule`.
 */
const HASKELL_DECLARATION_KEYWORDS: ReadonlySet<string> = new Set([
  "type", "data", "newtype", "class", "instance", "family", "pattern", "proc", "default", "module",
])

interface HaskellContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  frameworks: Record<string, boolean>
  typeSignatures: Record<string, string>
  functionSymbolIndex: Record<string, number>
  // Every function/method name declared in this file, collected by a pre-pass
  // so unqualified calls resolve even to LATER-defined functions (forward
  // references) and to class/instance methods.
  declaredFunctions: Set<string>
  // class name -> the method names its body declares, collected by a pre-pass so
  // an INSTANCE can be matched against its class regardless of declaration order
  // (Haskell permits `instance` before `class` in a file, and a second pass over
  // emitted symbols would miss every instance that appears first).
  classMethods: Map<string, Set<string>>
  // Lexical local identity (see LocalScopes).
  localScopes: LocalScopes
  // Module name set by the header; module-level symbols get ownerName = module
  // so the post-loop emits module → member contains edges. (The header subtree
  // ends before the body, so the scope stack cannot carry the module.)
  currentModule: string | undefined
  currentFunction: string | undefined
  seenRels: Set<string>
}

// The grammar's type-bearing node vocabulary (VERIFY_HS9). Used ONLY by
// isTypePosition, to tell a TYPE-level operator from an expression-level one —
// `infix` is aliased from _exp_infix, _pat_infix and _type_infix alike, so the
// operator child cannot make that distinction. Names taken from the pinned
// grammar's own rules (grammar/type.js, grammar/data.js, grammar/decl.js,
// grammar/context.js); nothing here is a guess about a node type that the
// grammar does not define.
const HASKELL_TYPE_BEARING_NODES = new Set([
  "type", "signature", "type_synomym", "type_synonym", "data_type", "newtype",
  "type_patterns", "type_family", "type_instance", "deriving", "deriving_instance",
  "class", "instance", "strict_field", "field_pattern", "forall",
  "quantified_variables", "promoted", "type_params", "constraint", "context",
  "deriving_strategy", "via", "kind_signature", "arity", "kind", "children",
])

export class RealHaskellAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: HaskellContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      frameworks: {},
      typeSignatures: {},
      functionSymbolIndex: {},
      declaredFunctions: new Set(),
      classMethods: new Map(),
      localScopes: { callableScoped: new Map(), blockLocals: new Map(), frameLocals: new Map() },
      // A file with no `module` header is module `Main` — the language rule.
      // Defaulted HERE, before the walk, because the import edge is pushed during
      // it and read `currentModule || ""`; defaulting in the post-loop was too
      // late and still produced `imports -> Distribution.Simple` with no source.
      currentModule: "Main",
      currentFunction: undefined,
      seenRels: new Set(),
    }
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean; restoreFn?: string }[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    // Pre-pass: collect declared function/method names so unqualified calls
    // resolve (module-level functions, class signatures, instance methods).
    // Where/let locals are NOT module-level callables — they are resolved
    // lexically (collectLocalScopes), so this prepass skips local blocks.
    this.collectDeclaredFunctions(rootNode, ctx.declaredFunctions)
    this.collectClassMethods(rootNode, ctx.classMethods)
    this.collectLocalScopes(rootNode, ctx.localScopes)

    while (stack.length > 0) {
      const { node, isExit, restoreFn } = stack.pop()!

      if (isExit) {
        if (restoreFn !== undefined) ctx.currentFunction = restoreFn
        else if (node.type === "function" || node.type === "bind" || node.type === "class" || node.type === "instance" || node.type === "data" || node.type === "newtype") {
          ctx.currentFunction = undefined
        }
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) scopeStack.pop()
        continue
      }

      if (node.hasError || node.isMissing) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          ctx.errors.push({
            message: `Syntax ${node.type} detected.`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let pushedScope = false
      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

      // Complexity Detection — the pinned grammar's actual emitted node types
      // (case → alternatives; if → conditional; guard branches → guards).
      if (node.type === "case" || node.type === "conditional" || node.type === "guards") {
        cyclomaticComplexity++
      }

      // Pattern Detection from specific nodes
      if (node.type === "do") ctx.patterns["Monads"] = true
      if (node.type === "list_comprehension") ctx.patterns["List Comprehensions"] = true
      if (node.type === "case" || node.type === "patterns") ctx.patterns["Pattern Matching"] = true

      // Process Node Types
      if (node.type === "header") {
        pushedScope = this.processModule(node, ctx, scopeStack)
      } else if (node.type === "import") {
        this.processImport(node, ctx)
      } else if (node.type === "signature") {
        // HSD17 (probe 2026-09-03, hledger): declaration signatures
        // (declarations/local_binds/class/instance bodies) are type trees —
        // processed as declarations and never descended (no calls inside).
        // Expression-position annotations (`x <- T.pack <$> some c`-style
        // `e :: T` binds, or the parens form `(fetch x :: IO X)`) host the
        // annotated EXPRESSION as child 0 — previously skipped wholesale,
        // dropping every real call beneath them (6/6 hledger residuals).
        const p = node.parent?.type
        const isDeclSig = p === "declarations" || p === "local_binds" || p === "class" || p === "instance" || p === "class_declarations" || p === "instance_declarations"
        if (isDeclSig) {
          // A signature inside a local block types a LOCAL — it must not
          // overwrite a module-level name's signature record.
          this.processSignature(node, ctx, currentScope, currentScope?.kind === ASTEngine.SymbolKind.Namespace)
          continue
        }
        const expr = node.namedChildCount > 0 ? node.namedChild(0) : null
        if (expr) stack.push({ node: expr })
        continue
      } else if (node.type === "function" || node.type === "bind") {
        // Do-notation bind (`z <- fetch x`): an expression, not a declaration —
        // walk its children but never emit a symbol (its applies execute in the
        // enclosing function). Distinguish via the `<-` unnamed child.
        const hasArrowBind = this.hasChildOfType(node, "<-")
        const localScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const insideLocalBlock = localScope?.kind === ASTEngine.SymbolKind.Namespace
        if (hasArrowBind) {
          // Do-bind exit must RESTORE, not wipe: without restoreFn the exit
          // handler's else-if treats this as a scope exit and clears
          // currentFunction — the SECOND and later binds of a do-block then
          // lose all call attribution (HSD9, cabal GenSPDXExc `generate`).
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
        } else if (!insideLocalBlock) {
          pushedScope = this.processFunction(node, ctx, currentScope, scopeStack)
          // HSD19: a module/class-level bind whose head is a PATTERN
          // (constructor `Right samplejournal2 = ...`, tuple, annotated) is
          // not a callable — no scope was pushed. Its body executes at module
          // init within the ENCLOSING attribution context (the oracle keeps
          // its fn identically), so preserve rather than leak the previous
          // function's name into this bind's body.
          if (!pushedScope && !(node.type === "function" && (node.childForFieldName("parameter") || node.childForFieldName("result")))) {
            stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          }
        } else if (node.type === "function") {
          // Where/let-local FUNCTION: no symbol (locals are not module
          // symbols), but its calls attribute to ITSELF — `go->local` is a
          // true edge between two real callables. Attributing internals to
          // the ENCLOSING function (the old behavior) was the fabrication;
          // dropping them entirely hid real calls.
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          const head = node.namedChildCount > 0 ? node.namedChild(0) : null
          let localName: string | undefined
          if (head?.type === "variable") {
            localName = head.text
          } else if (head && (head.type === "infix" || head.type === "prefix_id")) {
            const op = this.findNamedChildByType(head, ["operator"])?.text
            if (op) {
              localName = op
            } else {
              // HSD19: local backtick-operator definition — name is the
              // infix_id's variable; without this the currentFunction was
              // wiped to undefined and the body's calls were dropped.
              const infixId = this.findNamedChildByType(head, ["infix_id"])
              const tv = infixId ? this.findNamedChildByType(infixId, ["variable"]) : undefined
              if (tv?.text) localName = tv.text
            }
          }
          // Scoped identity (M60 functional lane 2026-09-26): a local's edges
          // carry its lexical owner chain (`owner.local`) so a same-named
          // module-level callable can never merge with it. The symbol contract
          // is unchanged — a local still publishes NO symbol.
          const scopedLocal = ctx.localScopes.callableScoped.get(node.id) ?? localName
          ctx.currentFunction = scopedLocal
          scopeStack.push({
            node,
            name: scopedLocal ?? "local",
            kind: ASTEngine.SymbolKind.Namespace,
            locals: ctx.localScopes.frameLocals.get(node.id),
            isFrame: true,
          })
        } else {
          // Where/let-local BIND (`x = compute 1`): not a module symbol, but
          // it IS a named nullary callable (HSD6) — its body's calls attribute
          // to itself, never leaking to the enclosing function.
          stack.push({ node, isExit: true, restoreFn: ctx.currentFunction })
          const head = node.namedChildCount > 0 ? node.namedChild(0) : null
          const scopedLocal =
            ctx.localScopes.callableScoped.get(node.id) ?? (head?.type === "variable" ? head.text : undefined)
          if (scopedLocal !== undefined) {
            ctx.currentFunction = scopedLocal
            scopeStack.push({
              node,
              name: scopedLocal,
              kind: ASTEngine.SymbolKind.Namespace,
              locals: ctx.localScopes.frameLocals.get(node.id),
              isFrame: true,
            })
          }
        }
      } else if (node.type === "let" || node.type === "local_binds" || node.type === "list_comprehension") {
        // Scoped blocks: locals are not module symbols. (do is NOT included —
        // monadic actions execute in the enclosing function and their applies
        // attribute to it.)
        const blockLocals = ctx.localScopes.blockLocals.get(node.id)
        // Do-block `let`: its binders stay visible for the REST of the do
        // block, whose later statements are SIBLINGS of this block — fold them
        // into the nearest callable frame as the walk reaches them (source
        // order), or `do { let addPaths ...; ... addPaths ... }` loses the
        // edge the old flat set happened to provide (HSD10's cabal case).
        if (blockLocals && this.isForwardVisibleLocalBlock(node)) {
          for (let i = scopeStack.length - 1; i >= 0; i--) {
            if (scopeStack[i].isFrame) {
              const fm = scopeStack[i].locals ?? new Map<string, string>()
              for (const [k, v] of blockLocals) fm.set(k, v)
              scopeStack[i].locals = fm
              break
            }
          }
        }
        scopeStack.push({ node, name: "local", kind: ASTEngine.SymbolKind.Namespace, locals: blockLocals })
        pushedScope = true
      } else if (node.type === "class") {
        pushedScope = this.processClass(node, ctx, scopeStack)
      } else if (node.type === "instance") {
        pushedScope = this.processInstance(node, ctx, scopeStack)
      } else if (node.type === "data_type" || node.type === "newtype") {
        pushedScope = this.processData(node, ctx, scopeStack)
      } else if (node.type === "type_synomym") {
        pushedScope = this.processTypeSynonym(node, ctx, scopeStack)
      } else if (node.type === "pattern_synonym") {
        pushedScope = this.processPatternSynonym(node, ctx)
      } else if (node.type === "foreign_import") {
        pushedScope = this.processForeignImport(node, ctx, scopeStack)
      } else if (node.type === "deriving_instance") {

        // HSD12 (probe 2026-09-03, postgrest Routine.hs:65): standalone
        // `deriving instance Show Foo` parses as deriving_instance → name
        // (class) + type_patterns → name (target) and previously emitted
        // NOTHING. Same emission as data-level deriving: implements
        // target -> class, derived:true. (Parens wrapper
        // `deriving instance (Show Foo)` handled one level down. Multi-class
        // parens heads are invalid Haskell — the grammar itself ERRORs.)
        const grab = (nn: Node) => {
          let cls: string | undefined
          let clsNode: Node | null = null
          let target: string | undefined
          for (let i = 0; i < nn.namedChildCount; i++) {
            const c = nn.namedChild(i)
            if (!c) continue
            // HSD18 mirror (probe 2026-09-03): the class head is extracted
            // entry-wise — a bare `name`, a QUALIFIED class head
            // (`deriving instance Csv.ToNamedRecord Session` — full text),
            // or an apply head (class application). Previously the qualified
            // class form emitted NOTHING here even though the data-level
            // deriving path already handled it.
            if (c.type === "name" || c.type === "qualified") {
              cls = c.text
              clsNode = c
            } else if (c.type === "apply") {
              const h = c.namedChildCount > 0 ? c.namedChild(0) : null
              if (h?.text) {
                cls = h.text
                clsNode = h
              }
            } else if (c.type === "type_patterns") {
              const t2 = this.findNamedChildByType(c, ["name", "constructor"])
              target = t2?.text
            } else if (c.type === "parens") grab(c)
          }
          if (cls && target) {
            this.pushRel(
              ctx,
              target,
              cls,
              ASTEngine.RelationshipType.Implements,
              1.0,
              {
                derived: true,
                isStandaloneDeriving: true,
              },
              this.lineOf(clsNode),
            )
          }
        }
        grab(node)
      } else if (node.type === "record") {
        // HSD5: body-position record `U { un = 5 }` is Haskell's other
        // construction idiom — instantiates the constructor. Record UPDATE
        // (`u { un = 6 }`) has a variable head, not a constructor: no edge.
        // Data-DECLARATION records (inside data_constructor) never emit.
        const ctor = this.findNamedChildByType(node, ["constructor"])
        // HSD14-record (probe 2026-09-03): record PATTERNS (`nOf (Person {
        // userName = n }) = n` in a function head, or in a bind-form pattern
        // guard) carry a constructor head and previously fabricated
        // `instantiates` from pattern position. Same gate as apply sites.
        if (ctor?.text && ctx.currentFunction && !this.isDataDeclarationPosition(node) && !this.isPatternPosition(node)) {
          this.pushRel(
            ctx,
            ctx.currentFunction,
            ctor.text,
            ASTEngine.RelationshipType.Instantiates,
            0.9,
            {
              haskellSpecific: true,
              isRecordConstruction: true,
            },
            this.lineOf(ctor),
          )
        }
      } else if (node.type === "apply") {
        this.extractApplyCall(node, ctx, scopeStack)
      } else if (node.type === "infix") {
        this.processInfix(node, ctx, scopeStack)
      } else if (node.type === "prefix_id") {
        // VERIFY_HS9 G1/G2: a PREFIX operator application — `(<+>) a b` or
        // `(:+:) a b`. The grammar gives this its own node type (grammar/
        // operator.js `_pvarsym`/`_pconsym` aliased to prefix_id), it was
        // reached by the walk and nothing read it, so a locally defined
        // operator had no callers and an infix constructor had no constructions.
        // Measured 22 operator + 3 constructor sites on a 60-file draw.
        // A `prefix_id` can also occur in pattern position (`(<+>) p`), and the
        // shared helper gates on that and on type position.
        this.emitOperatorApplication(node, ctx, scopeStack)
      }

      if (pushedScope) stack.push({ node, isExit: true })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    const frameworks: string[] = []
    for (const f in ctx.frameworks) frameworks.push(f)

    const patterns: string[] = []
    for (const p in ctx.patterns) patterns.push(p)

    const frameworkPatterns: {
      framework: string
      patterns: { type: string; detected: boolean; description: string }[]
    }[] = []
    for (let i = 0; i < frameworks.length; i++) {
      frameworkPatterns.push({
        framework: frameworks[i],
        patterns: [{ type: "usage", detected: true, description: `${frameworks[i]} usage detected` }],
      })
    }

    // A file with NO `module` header is module Main — that is the language rule,
    // not a convenience. Without this the import path emitted
    // `imports -> Distribution.Simple` with an EMPTY SOURCE for postgrest's
    // Setup.hs, which is the same defect class the VB lane gates on ("no empty
    // symbol names"): an edge whose owner cannot be resolved to anything in the
    // index. Synthesising the module also gives its members an owner, so the
    // post-loop below can emit `contains Main -> ...` against a module that
    // actually exists rather than dangling.
    if (!ctx.symbols.some((s) => s.kind === ASTEngine.SymbolKind.Module)) {
      ctx.symbols.push({
        name: "Main",
        kind: ASTEngine.SymbolKind.Module,
        range: this.nodeToRange(rootNode),
        scope: "",
        ownerName: "",
        visibility: "public",
        metadata: { haskellSpecific: true, isImplicitMain: true },
      })
      for (const s of ctx.symbols) {
        if (s.kind !== ASTEngine.SymbolKind.Module && !s.ownerName && !s.scope) s.ownerName = "Main"
      }
    }

    // Post-loop: contains for owned symbols — module → members, type →
    // constructors, record → fields, class/instance → methods. Skip self-named
    // edges (data User = User {...} → the type and constructor share the name,
    // which would collapse into a self-loop in symbol-ID space).
    // Names this module actually DECLARES at top level. A class, data/newtype,
    // type synonym or interface owned by the module is a declaration; anything
    // else an instance names is merely in scope.
    const declaredHere = new Set<string>()
    for (const s of ctx.symbols) {
      if (s.ownerName && s.ownerName !== ctx.currentModule) continue
      if (s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Type ||
          // `TypeAlias` is a legacy ALIAS for `type` -- both members carry the value
          // "type" (see SymbolKind in engine.ts) -- so comparing it here tested the
          // same value twice. TypeScript collapses same-valued enum members, which is
          // what made this comparison an error rather than a redundancy.
          s.kind === ASTEngine.SymbolKind.Interface ||
          s.kind === ASTEngine.SymbolKind.Enum) declaredHere.add(s.name)
    }
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || (s.scope && s.scope !== ctx.currentModule ? s.scope : undefined)
      // Containment is only a fact about this module when the OWNER is declared
      // here. An instance body is defined against a class that is very often
      // imported (`instance Applicative Reference`, `instance Described (List
      // sep)`), and `contains` is emitted from ownership alone -- so without this
      // the module appears to DECLARE `Applicative` and `pure`, or `Described`
      // and `describe`. Re-parenting those methods to the class (above) is only
      // half the fix; the predicate "is the owner declared HERE" is the other
      // half, and it is what keeps the true local case:
      //   class Shape ... ; instance Shape Circle where area = ...
      // still yields `contains Shape -> area`, because Shape is declared here.
      if (_owner && _owner !== ctx.currentModule && s.kind === ASTEngine.SymbolKind.Method && !declaredHere.has(_owner)) continue
      // An `Instance` is named after the type it instantiates and is owned by the
      // module that instantiates it, so emitting containment here asserts the
      // module DECLARES that type:
      //   instance (...) => Described (List sep) where
      // would produce `contains Distribution.Described -> List` for a `List` that
      // is in scope from elsewhere. The relationship that IS a fact about this
      // module is the `implements` edge the instance pushes itself.
      if (_owner && _owner !== s.name && s.kind !== ASTEngine.SymbolKind.Instance) {
        this.pushRel(ctx, _owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)
      }
    }

    // Exports: header export list wins; otherwise every module-level symbol
    // (Haskell exports everything by default).
    if (ctx.exports.length === 0) {
      for (const s of ctx.symbols) {
        if (s.ownerName === ctx.currentModule || (!s.ownerName && !s.scope)) {
          ctx.exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
        }
      }
    }

    // ── THE BINDING CHANNEL, for the one class of edge this lane emits that no
    // declaration can ever answer: a callee that is a where/let LOCAL.
    //
    // The class is old and deliberate. A local is NOT a module symbol
    // (HSD6/HSD19, unchanged — this publishes no symbol), but it IS a declared
    // callable, so its call sites attribute to the local and its edge identity is
    // the lexical owner chain (`owner.local`, nested `owner.inner.local`; see
    // `collectLocalScopes` and docs/analyzers/real-haskell-analyzer.md). What was
    // missing is not the identity — the analyzer computes it and publishes it AS
    // THE TARGET — but the DISPOSITION: a target spelled `helper.go` reads, to
    // every key space, exactly like a target that names a declaration which is
    // missing. It is neither.
    //
    // The family already owns the channel for exactly this statement: the BINDING
    // spelling (`BINDING_SEP`, src/ast/types.ts:190) carried by the
    // `metadata.localBinding` claim the arbiter verifies — dart
    // (`real-dart-analyzer.ts:2801`), php, fsharp (`real-fsharp-analyzer.ts:577`),
    // julia (`real-julia-analyzer.ts:1440`), objective-c
    // (`real-objective-c-analyzer.ts:1516`). The claim says "this target names a
    // binding, not a declaration"; the arbiter REFUTES it the moment a declaration
    // answers the target (`incoming-rule.ts:1124-1130`, checked BEFORE the count),
    // and the separator is U+0000, which no published key can carry
    // (`incoming-rule.ts:150-161`).
    //
    // MEASURED over the 400-file incoming-gate draw: 902 of this lane's 7,701
    // `unresolved` edges are exactly this class (11.7% — the largest cause in the
    // lane whose answer the analyzer already holds), and `collRes` cannot move:
    // the edge was never resolved and is not resolved by a claim.
    //
    // THE IDENTITY IS KEPT VERBATIM after the separator, so the target still
    // carries the lexical owner chain the M60 wave defined, and the LAST dotted
    // segment — the leaf every consumer reduces to (`normTarget`,
    // `differential.ts:1026`, and the lane's committed truth in
    // validation/m12/ground-truth/haskell.json) — is byte-identical. The callable
    // that makes the call goes in front, which is the family's spelling
    // (`${source}${BINDING_SEP}${binding}`).
    const localIdentities = new Set<string>()
    for (const block of ctx.localScopes.blockLocals.values()) {
      for (const identity of block.values()) localIdentities.add(identity)
    }
    if (localIdentities.size > 0) {
      for (const rel of ctx.relationships) {
        const target = rel.target ?? ""
        if (!localIdentities.has(target)) continue
        rel.target = `${rel.source ?? ""}${BINDING_SEP}${target}`
        rel.metadata = { ...(rel.metadata ?? {}), localBinding: true }
      }
    }

    // Evidence tiers: every edge leaves with an evidenceClass (M14 section D
    // family contract) — after all edges exist, before return.
    this.classifyEvidenceTier(ctx.relationships)

    return {
      language: "haskell",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworks[0],
        patterns,
        detectedFrameworks: frameworks,
        frameworkPatterns,
        architecturalScore: Math.min(100, Math.max(0, 100 - ctx.errors.length * 5)),
        codeQuality: ctx.errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "10.1.0-haskell-pure-ast",
      },
    }
  }

  // ==========================================================================
  // Relationship emission (dedupe by source|type|target identity).
  // ==========================================================================
  // M59.A7 / formula §8 (dimension 8) — the site line, the clean/erlang
  // contract verbatim:
  //   * the line is part of the DEDUPE KEY: a function called from three lines
  //     is three edges at three lines, not one edge at whichever line the walk
  //     saw first (the store keys its rows the same way, parallel-indexer.ts);
  //   * the anchor is the NAME-BEARING node — the callee head for a call, the
  //     constructed name for an `instantiates`, the class name for
  //     `implements`/`extends`, the imported module name for `references`, and
  //     the child's OWN naming line for `contains` (#921: it is what resolves
  //     the intended target among same-named siblings);
  //   * a line that is not a positive integer is recorded as ABSENT, never as 0
  //     (M59.O2: the contract is "the site line or NULL" — a fabricated 0 reads
  //     as "line 0" to every reader downstream).
  private pushRel(
    ctx: HaskellContext,
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

  // ==========================================================================
  // Pre-pass: declared function/method names (forward-reference resolution).
  // ==========================================================================
  // class -> its method names. This is what makes `overrides` derivable at all:
  // an instance declares a method name, and the only way to know that name
  // OVERRIDES rather than merely exists is to compare it against the class
  // body's method set. A single walk cannot do that — the instance may be
  // visited before the class, and in the payloads/cabal corpus it frequently is
  // — so the class side is gathered first and the instance side is compared
  // against it when the instance is reached.
  private collectClassMethods(node: Node, out: Map<string, Set<string>>): void {
    if (node.type === "class") {
      const clsName = this.findNamedChildByType(node, ["name"])?.text ?? ""
      if (clsName) {
        let set = out.get(clsName)
        if (!set) { set = new Set<string>(); out.set(clsName, set) }
        // The methods are NOT direct children of `class` — they sit under
        // class_declarations, and a class method is a SIGNATURE
        // (`area :: a -> Double` → signature → variable), not a binding. A
        // DefaultSignatures method does have a body, and that is a `function`.
        // Reading only direct `function`/`bind` children found nothing at all,
        // which is why the first attempt emitted zero overrides.
        const decls = this.findNamedChildByType(node, ["class_declarations"])
        const groups: Node[] = decls ? [decls] : []
        for (const g of groups) {
          for (const sig of this.collectNamedChildrenByType(g, ["signature"])) {
            const v = this.findNamedChildByType(sig, ["variable"])
            if (v?.text) set.add(v.text)
          }
          for (const fn of this.collectNamedChildrenByType(g, ["function", "bind"])) {
            const first = fn.namedChildCount > 0 ? fn.namedChild(0) : null
            if (first?.type === "variable" && first.text) set.add(first.text)
          }
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) this.collectClassMethods(c, out)
    }
  }

  private collectDeclaredFunctions(node: Node, out: Set<string>): void {
    // Type-position function nodes (signature internals, field "parameter"/
    // "result") are TYPES, not declarations — without this guard their type
    // variables (a, f, m) pollute the callable set and fabricate edges.
    if (node.type === "function" && (node.childForFieldName("parameter") || node.childForFieldName("result"))) {
      return
    }
    if (node.type === "function" || node.type === "bind") {
      // Do-notation binds (`z <- fetch x`) bind VALUES, not callables — but
      // NEVER prune the descent: a do-bind RHS can host an inner do-block
      // whose let-bound functions are real callables (cabal ProjectPlanning
      // `progdb <- liftIO $ do { let addPaths ... }; ... addPaths ...`).
      // The old early-return hid addPaths/globalPaths from the declared set,
      // dropping 4 real call edges (HSD10, probe 2026-09-03).
      if (!(node.type === "bind" && this.hasChildOfType(node, "<-"))) {
        const nameNode = node.namedChildCount > 0 ? node.namedChild(0) : null
        if (nameNode && nameNode.type === "variable") {
          out.add(nameNode.text)
        } else if (nameNode && (nameNode.type === "infix" || nameNode.type === "prefix_id")) {
          // Operator definitions: `a +.+ b = ...` (infix head) and
          // `(<!>) f x = ...` (prefix_id head) declare the OPERATOR as the
          // callable name — probe 2026-09-03. HSD19: backtick-operator
          // definitions declare the infix_id's variable.
          const op = this.findNamedChildByType(nameNode, ["operator"])
          const tv = op ? undefined : (() => {
            const infixId = this.findNamedChildByType(nameNode, ["infix_id"])
            return infixId ? this.findNamedChildByType(infixId, ["variable"]) : undefined
          })()
          const callable = op?.text ?? tv?.text
          if (callable) out.add(callable)
        }
      }
      // NO early return in any case: nested local_binds (where/let) hold more
      // declared callables — where-locals must resolve as call targets.
    }
    if (node.type === "signature") {
      // HSD17 prepass: only DECLARATION signatures declare callables, and
      // only via their child-0 variable. The parens form `(e :: T)` annotates
      // an expression; the match-child form (`T m = rhs :: T`) hosts the RHS
      // expression as child 0 — reading the first variable DESCENDANT there
      // fabricated a declared-callable entry for the first expression
      // identifier (e.g. treeFromPaths in hledger Account.hs).
      if (node.parent?.type === "parens") return
      const first = node.namedChildCount > 0 ? node.namedChild(0) : null
      if (first?.type !== "variable") return
      out.add(first.text)
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      // Where/let locals declare SCOPED callables, never module-level ones
      // (M60 functional lane 2026-09-26): their identity is `${owner}.${name}`
      // and their visibility is lexical, so they must not enter the flat
      // module-level set — that set made a local of ANY function a candidate
      // target from anywhere in the file.
      if (child.type === "local_binds" || child.type === "let" || child.type === "let_in") continue
      this.collectDeclaredFunctions(child, out)
    }
  }

  // ==========================================================================
  // Pre-pass: lexical local identity (M60 functional lane, 2026-09-26).
  // A callable declared inside a where/let block is a real callable but NOT
  // a module symbol (HSD6/HSD19 contract, unchanged). Its identity carries
  // its lexical owner chain: `outer.local` (nested: `outer.inner.local`), so
  // it can never be confused with a module-level callable of the same name.
  // ==========================================================================
  private collectLocalScopes(root: Node, out: LocalScopes): void {
    const stack: { n: Node; frameId: number; frameScoped: string | undefined }[] = [
      { n: root, frameId: -1, frameScoped: undefined },
    ]
    while (stack.length > 0) {
      const { n, frameId, frameScoped } = stack.pop()!
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        const t = child.type
        if (t === "local_binds" || t === "let" || t === "let_in") {
          const binders = this.localBlockBinders(child)
          if (binders.length > 0) {
            const map = new Map<string, string>()
            for (const b of binders) {
              const nm = this.callableHeadName(b)
              if (!nm) continue
              const scoped = frameScoped !== undefined ? `${frameScoped}.${nm}` : nm
              map.set(nm, scoped)
              out.callableScoped.set(b.id, scoped)
            }
            if (map.size > 0) {
              out.blockLocals.set(child.id, map)
              // A where-block shadows for the WHOLE RHS of its callable, not
              // just its own subtree — its binders join the frame's visible
              // set. Do-block `let` blocks are forward-only (handled at walk
              // time, where source order is known).
              if (t === "local_binds" && frameId >= 0) {
                const fm = out.frameLocals.get(frameId) ?? new Map<string, string>()
                for (const [k, v] of map) fm.set(k, v)
                out.frameLocals.set(frameId, fm)
              }
            }
          }
          // Descend: binders open their own frames; their siblings (and the
          // let's other children) keep the enclosing frame.
          for (let j = 0; j < child.namedChildCount; j++) {
            const c = child.namedChild(j)
            if (!c) continue
            const scoped = out.callableScoped.get(c.id)
            if (scoped !== undefined && this.callableHeadName(c) !== undefined) {
              stack.push({ n: c, frameId: c.id, frameScoped: scoped })
            } else {
              stack.push({ n: c, frameId, frameScoped })
            }
          }
          continue
        }
        const nm = this.callableHeadName(child)
        if (nm !== undefined) {
          const scoped = frameScoped !== undefined ? `${frameScoped}.${nm}` : nm
          out.callableScoped.set(child.id, scoped)
          stack.push({ n: child, frameId: child.id, frameScoped: scoped })
        } else {
          stack.push({ n: child, frameId, frameScoped })
        }
      }
    }
  }

  /** Direct callable children of a where/let block (the local binders). */
  private localBlockBinders(block: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < block.namedChildCount; i++) {
      const c = block.namedChild(i)
      if (!c || (c.type !== "function" && c.type !== "bind")) continue
      if (this.callableHeadName(c) === undefined) continue
      out.push(c)
    }
    return out
  }

  /**
   * The declared name of a callable node, or undefined when the node is not a
   * callable at all (type-position function, do-bind, pattern-headed bind).
   * Mirrors collectDeclaredFunctions' naming rules exactly — one ruler for
   * module-level and local callables.
   */
  private callableHeadName(node: Node): string | undefined {
    if (node.type !== "function" && node.type !== "bind") return undefined
    if (node.type === "function" && (node.childForFieldName("parameter") || node.childForFieldName("result"))) {
      return undefined
    }
    if (node.type === "bind" && this.hasChildOfType(node, "<-")) return undefined
    const head = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!head) return undefined
    if (head.type === "variable") return head.text
    if (head.type === "infix" || head.type === "prefix_id") {
      const op = this.findNamedChildByType(head, ["operator"])
      if (op?.text) return op.text
      const infixId = this.findNamedChildByType(head, ["infix_id"])
      const tv = infixId ? this.findNamedChildByType(infixId, ["variable"]) : undefined
      return tv?.text
    }
    return undefined
  }

  /**
   * A do-block `let` (`do { let g = ...; ... g x }`): its binders stay visible
   * for the REST of the do block — subsequent statements are siblings, not
   * descendants, so the block scope alone cannot carry them. Folded into the
   * nearest callable frame as the walk reaches the block (source order).
   */
  private isForwardVisibleLocalBlock(node: Node): boolean {
    if (node.type !== "local_binds") return false
    const p = node.parent
    return p?.type === "let" && p.parent?.type === "do"
  }

  /**
   * Resolve a bare variable head to its callable target: the innermost
   * visible local wins (Haskell scoping — a where-binder shadows the module
   * binding for its whole RHS), else the module-level declared set, else no
   * edge (imported/Prelude/parameter names produce none).
   */
  private resolveCallableTarget(name: string, scopeStack: Scope[], ctx: HaskellContext): string | undefined {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const locals = scopeStack[i].locals
      if (locals !== undefined) {
        const hit = locals.get(name)
        if (hit !== undefined) return hit
      }
    }
    return ctx.declaredFunctions.has(name) ? name : undefined
  }

  private processModule(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    let moduleName = ""
    // Pinned grammar: `module` (wrapping module_id). `qconid` is a dead
    // literal from an older grammar (F1 audit 2026-09-03).
    const moduleNode = this.findNamedChildByType(node, ["module"])
    if (moduleNode) {
      // module_id children compose dotted names (Data.List → "Data" "List")
      moduleName = this.assembleModuleId(moduleNode)
    } else {
      const mIdx = this.findChildIndexByText(node, "module")
      if (mIdx !== -1 && node.childCount > mIdx + 1) {
        moduleName = node.child(mIdx + 1)?.text || ""
      }
    }
    if (!moduleName) return false
    ctx.currentModule = moduleName

    // Process Exports — pinned grammar node is `exports` (`export_list` is
    // a dead literal; F1 audit 2026-09-03).
    const exportsList = this.findNamedChildByType(node, ["exports"])
    if (exportsList) {
      for (let i = 0; i < exportsList.namedChildCount; i++) {
        const expNode = exportsList.namedChild(i)
        if (!expNode) continue
        // The export list carries THREE node types and two of them were dropped
        // or mangled:
        //
        //   export         a name, in one of four shapes (see readExportName)
        //   module_export  `module M` — a RE-EXPORT
        //   comment/haddock documentation, which is not a name
        //
        // The comment half was already handled: iterating every named child
        // published the comments as exported names — measured 39 `exports` edges
        // across the corpus whose target was a `--` comment, e.g.
        // `exports Hasql.Decoders -> "-- * Result"`.
        //
        // M60-HK2 (tree census 2026-10-03, `script/m14/tmp/hs-export-ffi-probe.ts`
        // over all 14,066 admitted files, `validation/m14/results/` sibling
        // hs-export-ffi.json): `module_export` occurs 409 times and every one was
        // dropped, because the guard was `if (expNode.type !== "export") continue`.
        // The analyzer's own comment above used to justify reading the list as
        // the one place a re-export is stated at all — and it was skipping them.
        let exportName: string | undefined
        let isReExport = false
        let anchor: Node = expNode
        if (expNode.type === "export") {
          const read = this.readExportName(expNode, exportsList, i)
          exportName = read.name
          if (read.anchor) anchor = read.anchor
        } else if (expNode.type === "module_export") {
          const mod = this.findNamedChildByType(expNode, ["module", "module_id"])
          exportName = mod ? this.assembleModuleId(mod) : undefined
          isReExport = exportName !== undefined
        } else {
          continue
        }
        if (exportName && exportName !== ",") {
          ctx.exports.push({ name: exportName, isDefault: false, range: this.nodeToRange(expNode) })
          // `exports` is a product relationship type and the export LIST was
          // already being read and stored in ctx.exports — but only as a flat
          // array of names, so the graph never learned what a module makes
          // public. In Haskell that list is the module's entire API surface,
          // and it is the one place a re-export (`module M`) or a narrowed
          // export (`module M (foo)`) is stated at all, so an omission here
          // loses information no other node carries.
          //
          // `T(A, B)` is normalised to `T` by readExportName, which is the type
          // the module exports; the constructor list is a visibility detail of T,
          // not a second exported name.
          this.pushRel(
            ctx,
            moduleName,
            exportName,
            ASTEngine.RelationshipType.Exports,
            1.0,
            { evidenceClass: "structural", ...(isReExport ? { isReExport: true } : {}) },
            this.lineOf(anchor),
          )
        }
      }
    }

    ctx.symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(node),
      scope: "",
      visibility: "public",
      metadata: { haskellSpecific: true },
    })
    scopeStack.push({ node, name: moduleName, kind: ASTEngine.SymbolKind.Module })
    return true
  }

  /**
   * THE NAME an `export` node exports, or undefined when it exports none.
   *
   * WHY THIS IS NOT `expNode.text`. The export list states a name with a
   * DECLARATION KEYWORD in front of it whenever the entry narrows what is
   * exported, and the raw text is the whole phrase:
   *
   *     export -> namespace("type") + name("T")        text "type T"
   *     export -> namespace("pattern") + name("P")     text "pattern P"
   *     export -> name("U") + children("(..)")         text "U(..)"
   *     export -> variable("data")   + ERROR("D")      text "data"   (a mis-parse)
   *
   * Measured over the whole corpus before this method existed (analyzer pass,
   * `script/m14/tmp/hs-ontology-analyse.ts`): 392 of 54,830 `exports` edges
   * carried a target that was a keyword or a keyword phrase — 100 `type`,
   * 32 `data`, 8 `pattern`, and the rest `pattern <Ctor>` / `type <Ty>`.
   * `exports Data.Type.Bool -> type` names the Haskell keyword: it resolves to
   * nothing, and `T(A, B)`-style narrowing means the thing the module actually
   * exports is `T`, not `T(A, B)`.
   *
   * Tree shapes, counted on the pinned grammar over all 14,066 admitted files
   * (`script/m14/tmp/hs-export-ffi-probe.ts`): 31,892 `export` nodes —
   * 6,697 with a `name`/`constructor` child, 24,515 a bare `variable`, 43 a bare
   * declaration keyword whose real name the grammar pushed into a SIBLING `ERROR`
   * (37 of the 43 recoverable that way), and 0 unclassified.
   *
   * The 6 unrecoverable ones emit NOTHING. Under standing rule R7 the honest
   * state for "I cannot read this name" is absence, not a keyword standing in for
   * a name — a literal in a name-bearing field becomes an edge endpoint that does
   * not exist in the source, and `bb_graph` will happily count and display it.
   */
  private readExportName(expNode: Node, exportsList: Node, index: number): { name: string | undefined; anchor?: Node } {
    // 1. `type T` / `pattern P` / `T(A, B)` / `T(..)` — the grammar already knows
    //    the name and the qualifier separately.
    const named = this.findNamedChildByType(expNode, ["name", "constructor"])
    if (named?.text) return { name: named.text, anchor: named }
    // 2. A STANDALONE namespace export of an operator: `type (&&)`, `type (||)`,
    //    `pattern (:|)`. Pinned grammar:
    //      export -> namespace("type") + prefix_id("(&&)") -> operator("&&")
    //    The name is the OPERATOR, read from its own node, exactly as
    //    `processFunction` names an operator definition (`a +.+ b` declares
    //    `+.+`). Without this case the fall-through below cut the text at the
    //    first `(` and published the KEYWORD — measured, on the two `type (&&)` /
    //    `type (||)` entries of `libraries/base/src/Data/Type/Bool.hs:20-21` and
    //    the three `pattern …` entries of
    //    `testsuite/tests/parser/should_compile/T25900.hs:4-6`.
    const opId = this.findNamedChildByType(expNode, ["prefix_id", "infix_id"])
    if (opId) {
      // `constructor_operator` is the PATTERN-SYNONYM form: `pattern (:|)` puts
      // its name in that node, not in `operator` (measured on
      // testsuite/tests/parser/should_compile/T25900.hs:6).
      const op = this.findNamedChildByType(opId, ["operator", "constructor_operator"])
      if (op?.text) return { name: op.text, anchor: op }
      const innerVar = this.findNamedChildByType(opId, ["variable"])
      if (innerVar?.text) return { name: innerVar.text, anchor: innerVar }
    }
    // 2. A bare `variable` that is NOT a declaration keyword: `f`, `x`, `>>=`.
    const variable = this.findNamedChildByType(expNode, ["variable"])
    if (variable?.text) {
      if (!HASKELL_DECLARATION_KEYWORDS.has(variable.text)) return { name: variable.text, anchor: variable }
      // 3. `data`/`class` mis-parsed on its own, with the real name in the next
      //    `ERROR` sibling of the same comma-separated `exports` list.
      for (let j = index + 1; j < exportsList.namedChildCount; j++) {
        const nx = exportsList.namedChild(j)
        if (!nx) continue
        if (nx.type === "export" || nx.type === "module_export") break
        if (nx.type === "ERROR") {
          const rec = this.findNamedChildByType(nx, ["name", "constructor"])
          if (rec?.text) return { name: rec.text, anchor: rec }
        }
      }
      return { name: undefined }
    }
    // 4. Anything else: an operator entry (`(>>=)`) keeps its own text, which is
    //    the name. A qualified re-export inside a narrowed list keeps its dotted
    //    form. Anything with an interior `(` that we have not already handled is
    //    not reduced further — the earlier `indexOf("(")` cut turned
    //    `History(historyBreakpointId, …)` into `History`, which is right, but it
    //    also could not tell a narrowed export from a qualified one, and the
    //    `name` child above now can.
    const text = expNode.text.trim()
    if (!text) return { name: undefined }
    const paren = text.indexOf("(")
    return { name: paren >= 0 ? text.slice(0, paren).trim() : text, anchor: expNode }
  }

  // module_id children compose dotted names: Data → List → "Data.List"
  private assembleModuleId(node: Node): string {
    let out = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      const leaf = c.type === "module_id" ? this.assembleModuleId(c) : c.text
      if (out) out += "."
      out += leaf
    }
    return out || node.text
  }

  private processImport(node: Node, ctx: HaskellContext) {
    let isQualified = false
    const items: string[] = []
    const modulesToImport: { name: string; alias?: string; isHiding?: boolean; node?: Node }[] = []
    let currentIsHiding = this.findChildIndexByText(node, "hiding") !== -1

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === "qualified") {
        isQualified = true
      } else if (child.type === "module" || child.type === "module_id") {
        const name = this.assembleModuleId(child)
        if (i > 0 && node.child(i - 1)?.text.trim() === "as") {
          const lastMod = modulesToImport[modulesToImport.length - 1]
          if (lastMod) lastMod.alias = name
        } else {
          modulesToImport.push({ name, isHiding: currentIsHiding, node: child })
        }
      } else if (child.type === "hiding") {
        currentIsHiding = true
      } else if (child.type === "import_list") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const item = child.namedChild(j)
          if (item && item.type !== "hiding") {
            const itemText = this.stripOuterParens(item.text.trim())
            if (itemText && itemText !== "hiding" && itemText !== ",") {
              const paren = itemText.indexOf("(")
              items.push(paren >= 0 ? itemText.slice(0, paren).trim() : itemText)
            }
          }
        }
      }
    }

    for (const mod of modulesToImport) {
      if (!mod.name) continue
      const importItems: string[] = []
      if (items.length > 0) {
        for (const item of items) importItems.push(item)
      } else {
        importItems.push("*")
      }
      ctx.imports.push({
        module: mod.name,
        source: mod.name,
        items: importItems,
        isTypeOnly: false,
        range: this.nodeToRange(node),
        metadata: { isQualified, alias: mod.alias, isHiding: mod.isHiding },
      })
      // A module import is an IMPORT, and the product has an `imports`
      // relationship type for exactly that — python and typescript already
      // publish theirs there. This lane published 2,119 of its 2,126 `references`
      // edges from this one line, so `references` was 99.7% a mislabel: measured
      // over 208 files, 2,119 edges carried `isHaskellImport` and only 7 were
      // genuine references (the FFI entity edges). A consumer querying
      // `references` for haskell was reading a module graph and could not tell.
      //
      // Relabelled rather than duplicated. Publishing one fact under two labels
      // counts it twice in the graph, and this lane's whole claim is that its
      // counts mean something.
      this.pushRel(
        ctx,
        ctx.currentModule || "",
        mod.name,
        ASTEngine.RelationshipType.Imports,
        0.9,
        {
          isHaskellImport: true,
        },
        this.lineOf(mod.node),
      )

      if (mod.name.indexOf("Scotty") !== -1) ctx.frameworks["Scotty"] = true
      if (mod.name.indexOf("Servant") !== -1) ctx.frameworks["Servant"] = true
      if (mod.name.indexOf("QuickCheck") !== -1) ctx.frameworks["QuickCheck"] = true
      if (mod.name.indexOf("Database.Persist") !== -1) ctx.frameworks["Persistent"] = true
      if (mod.name.indexOf("Yesod") !== -1) ctx.frameworks["Yesod"] = true
    }
  }

  private processSignature(node: Node, ctx: HaskellContext, currentScope: Scope | undefined, inLocalBlock = false) {
    // Pinned grammar: signature → variable (name) + function (type); the
    // `signature_type`/`identifier`/`varid` literals do not exist (F1 audit
    // 2026-09-03). The `::` text slice is the honest type extraction — it
    // also covers context-carrying signatures (`merge :: (Semigroup a) => ...`).
    const nameNode = this.findNamedChildByType(node, ["variable"])

    if (nameNode && !inLocalBlock) {
      const idx = node.text.indexOf("::")
      if (idx !== -1) {
        ctx.typeSignatures[nameNode.text] = node.text.slice(idx + 2).trim()
      }
    }

    // Interface/class method declarations: `class Mergeable s where merge :: ...`
    // — the signature inside a class body is a Method symbol owned by the
    // interface, matching C#/Rust/Elixir interface member handling.
    if (
      nameNode &&
      currentScope &&
      (currentScope.kind === ASTEngine.SymbolKind.Interface || currentScope.kind === ASTEngine.SymbolKind.Class)
    ) {
      // O(1) dedup via the function symbol index (no per-signature O(symbols)
      // scan — a class with many method signatures must not be quadratic).
      const methodKey = `${currentScope.name}::${nameNode.text}`
      const existingIdx = ctx.functionSymbolIndex[methodKey]
      if (existingIdx === undefined) {
        ctx.functionSymbolIndex[methodKey] = ctx.symbols.length
        ctx.symbols.push({
          name: nameNode.text,
          kind: ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          scope: currentScope.name || "",
          ownerName: currentScope.name,
          ownerKind: currentScope.kind,
          visibility: "public",
          metadata: { haskellSpecific: true, isInterfaceMethod: true },
        })
      }
    }
  }

  private processFunction(
    node: Node,
    ctx: HaskellContext,
    currentScope: Scope | undefined,
    scopeStack: Scope[],
  ): boolean {
    if (node.type === "function" && (node.childForFieldName("parameter") || node.childForFieldName("result"))) {
      return false
    }

    let name = ""
    const nameNode = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (nameNode && nameNode.type === "variable") {
      name = nameNode.text
    } else if (nameNode && (nameNode.type === "infix" || nameNode.type === "prefix_id")) {
      // Operator definitions: `a +.+ b = ...` / `(<!>) f x = ...` — the symbol
      // name is the OPERATOR (probe 2026-09-03), not the whole head text.
      const op = this.findNamedChildByType(nameNode, ["operator"])
      if (op?.text) {
        name = op.text
      } else {
        // HSD19 backtick-operator definition (hledger BalanceReport):
        // `(rspec,journal) `gives` r = do ...` — the head is an infix whose
        // operator child is an infix_id wrapping the backtick name.
        const infixId = this.findNamedChildByType(nameNode, ["infix_id"])
        const tv = infixId ? this.findNamedChildByType(infixId, ["variable"]) : undefined
        if (tv?.text) name = tv.text
      }
    }
    // HSD19 (probe 2026-09-03): heads that are NOT nameable callables —
    // constructor patterns (`Right samplejournal2 = ...`), tuple patterns,
    // annotated binds (`x :: T = ...`, head is a signature) — declare NO
    // symbol and NO callable name. The old raw-text branch named symbols
    // after the whole head text ("Right", the tuple text, the type
    // annotation) and attributed their bodies to those phantom names.

    if (!name || name === "=" || name === "|" || node.parent?.type === "signature" || node.parent?.type === "function") {
      return false
    }

    const functionKey = `${currentScope?.name || ""}::${name}`
    const existingIndex = ctx.functionSymbolIndex[functionKey]
    const existing = existingIndex !== undefined ? ctx.symbols[existingIndex] : undefined
    if (existing) {
      const newRange = this.nodeToRange(node)
      existing.range.endLine = Math.max(existing.range.endLine, newRange.endLine)
      if (existing.range.endIndex !== undefined && newRange.endIndex !== undefined) {
        existing.range.endIndex = Math.max(existing.range.endIndex, newRange.endIndex)
      } else if (newRange.endIndex !== undefined) {
        existing.range.endIndex = newRange.endIndex
      }
      // Multi-clause functions (`f (Just x) = ...; f Nothing = ...`): the
      // symbol's complexity is the max across clauses.
      if (existing.complexity !== undefined) {
        existing.complexity = Math.max(existing.complexity, this.calculateNodeComplexity(node))
      }
      ctx.currentFunction = name
      scopeStack.push({
        node,
        name,
        kind: existing.kind,
        locals: ctx.localScopes.frameLocals.get(node.id),
        isFrame: true,
      })
      return true
    }

    const typeSignature = ctx.typeSignatures[name]
    let isHigherOrder = false
    let returnType: string | undefined = undefined

    if (typeSignature && typeof typeSignature === "string") {
      // HOFs have functions as arguments — parens around an arrow (a -> b).
      // Pure char scan: an arrow while inside a paren pair.
      isHigherOrder = this.hasArrowInParens(typeSignature)
      const parts = this.splitOnArrows(typeSignature)
      if (parts.length > 0) returnType = parts[parts.length - 1].trim()
    }
    if (isHigherOrder) ctx.patterns["Higher-Order Functions"] = true

    const kind =
      currentScope &&
      (currentScope.kind === ASTEngine.SymbolKind.Interface || currentScope.kind === ASTEngine.SymbolKind.Class)
        ? ASTEngine.SymbolKind.Method
        : ASTEngine.SymbolKind.Function

    ctx.symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      returnType,
      complexity: this.calculateNodeComplexity(node),
      metadata: { typeSignature, isHigherOrder, haskellSpecific: true },
    })
    ctx.functionSymbolIndex[functionKey] = ctx.symbols.length - 1

    ctx.currentFunction = name
    scopeStack.push({ node, name, kind, locals: ctx.localScopes.frameLocals.get(node.id), isFrame: true })
    return true
  }

  // A type synonym is a first-class declaration — `type Result = [Int64]` names
  // a type that other code can annotate with, so omitting it left every use of
  // the name with nothing to resolve to. The grammar's node is spelled
  // `type_synomym` (the upstream typo is in the node NAME, not this comment), and
  // its shape is `name` + right-hand side, so the name is the first `name` child.
  private processTypeSynonym(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Type Synonyms"] = true
    const nameNode = this.findNamedChildByType(node, ["name"])
    const name = nameNode?.text ?? ""
    if (!name) return false
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: { haskellSpecific: true, isTypeSynonym: true },
    })
    if (currentScope) {
      this.pushRel(
        ctx,
        currentScope.name,
        name,
        ASTEngine.RelationshipType.Contains,
        1.0,
        { evidenceClass: "structural" },
        this.lineOf(node),
      )
    }
    // uses — the synonym's dependency on the types it is DEFINED in terms of.
    // `type Params = Map.Map ByteString ByteString` is a real type-level edge:
    // the alias does not exist without them, and nothing else in the graph
    // carries it (the module `contains` edge says ownership, not composition).
    //
    // This is `uses` and not `references` deliberately. A `references` edge here
    // would claim Params *refers to* ByteString the way a body refers to a
    // function; this is a synonym standing in for a type, which is what `uses`
    // is for in every other lane that emits it (kotlin, javascript, css, toml).
    //
    // Read from the RIGHT-HAND SIDE only: taking every `name` leaf in the node
    // would include the LHS, producing a `Params uses Params` self-edge.
    if (nameNode) {
      for (const leaf of this.collectTypeNameLeafNodes(node, nameNode)) {
        if (leaf.text.trim() === name) continue
        // The line is the LEAF's, not the declaration's. A multi-line synonym
        // (`type ConnectionError =` / `  ConnectionError1` / `  | Maybe ByteString`)
        // cited its own first line for every `uses` edge, so
        // `uses ConnectionError -> Maybe` pointed at the `type` keyword and the
        // name was on neither the cited line nor — for a multi-line RHS — on any
        // line the reader would land on. The edge belongs to the declaration, but
        // the DESTINATION is where the type is written.
        this.pushRel(
          ctx,
          name,
          leaf.text.trim(),
          ASTEngine.RelationshipType.Uses,
          1.0,
          { evidenceClass: "declared_type" },
          this.lineOf(leaf),
        )
      }
    }
    return true
  }

  // Type-name leaves reachable in a subtree, skipping the subtree rooted at
  // `skip`, returned as NODES so a caller can cite each one's own line.
  // Haskell type expressions nest arbitrarily (`Map.Map ByteString ByteString`
  // is apply → qualified(name) + name), so this walks rather than reading one
  // level, and it takes `name` and `constructor` only: a `variable` in a type
  // position is a type PARAMETER (`f a`), not a type, and publishing `a` as a
  // use of some type named `a` is exactly the fabrication the declared-type
  // contract forbids.
  private collectTypeNameLeafNodes(node: Node, skip: Node | null, out: Node[] = []): Node[] {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      // `.id`, not object identity: web-tree-sitter returns a FRESH wrapper on every
      // access, so `c === skip` never matched and the subtree the caller asked to
      // prune was walked anyway — the skipped names could be republished as uses
      // (hygiene class KAD2/TSD2, caught by script/m14/verify-analyzer-hygiene.ts).
      if (!c || (skip !== null && c.id === skip.id)) continue
      if (c.type === "name" || c.type === "constructor") {
        if (c.text.trim() && !out.some((o) => o.text === c.text)) out.push(c)
        continue
      }
      this.collectTypeNameLeafNodes(c, null, out)
    }
    return out
  }

  // A pattern synonym is a first-class top-level DECLARATION — `pattern Head a b =
// expr` names a constructor-shaped value the module defines, so omitting it left
// every use of the name with nothing to resolve to, exactly as omitting a type
// synonym did. It is not exotic: GHC's own sources carry 1,094 of them across
// 261 files (`script/m14/tmp/hs-pattern-synonyms.ts`, all 14,038 admitted files),
// and 94 export entries name one, so those `exports` edges had a target nothing
// declared. Found by the `haskell/exports-and-ffi` fixture, which the M14 runner
// refused with `export(s) [":|"] do not resolve to a top-level symbol`.
//
// MEASURED shape distribution over those 1,094 nodes: 449 carry a readable name
// (421 a `signature` child, 28 a bare `equation`), and 645 are VIEW PATTERNS
// (`pattern P x <- Q x where P x = Q x`) whose name the previous reader could not
// reach at all. The name is ALWAYS the head of the equation's left-hand side, so
// one rule covers every shape:
//
//   pattern_synonym -> pattern + signature -> prefix_id -> constructor_operator   (`:|`)
//   pattern_synonym -> pattern + signature -> constructor                       (`Zero`)
//   pattern_synonym -> pattern + equation  -> apply(apply(constructor, x), y)    (`OptMResult`)
//   pattern_synonym -> pattern + equation  -> apply -> constructor              (a view pattern)
//   pattern_synonym -> pattern + equation  -> infix -> constructor_operator      (`:|`)
//
// The symbol kind is `constructor`, not `function`: a pattern synonym is built
// and matched like a data constructor (`instantiates` already targets it through
// the `apply`-head rule), and calling it a function would put a name the module
// never defines into the FP-family `calls` set.
private processPatternSynonym(node: Node, ctx: HaskellContext): boolean {
    ctx.patterns["Pattern Synonyms"] = true
    const sig = this.findNamedChildByType(node, ["signature"])
    const eq = this.findNamedChildByType(node, ["equation"])
    // A pattern synonym is normally declared TWICE — a signature and an equation
    // (`pattern (:|) :: …` then `pattern xs :| ys = …`) — and both halves name the
    // same value. Publishing one symbol per half would double the symbol and, worse,
    // double the `contains` edge at two different site lines for a single
    // declaration. So the name is resolved once and `publishPatternSynonym`
    // collapses the halves through the O(1) index, extending the range — the same
    // treatment a multi-clause function gets in `processFunction`.
    let name: string | undefined
    let anchor: Node | undefined
    if (sig) {
      // `pattern (:|) :: …` — the name is the head of the signature, not child 0
      // verbatim: `signature` here is `prefix_id + :: + function`.
      const head = this.findNamedChildByType(sig, ["prefix_id", "infix_id", "constructor", "constructor_operator", "variable"])
      if (head) {
        name =
          head.type === "prefix_id" || head.type === "infix_id"
            ? this.findNamedChildByType(head, ["constructor_operator", "operator", "constructor", "variable"])?.text
            : head.text
        anchor = head
      }
    }
    if (!name && eq) {
      // The LEFT-HAND SIDE only. `equation` children are the LHS, the `<-`/`=`
      // token, and the RHS; taking the first `apply`/`infix`/`constructor` child
      // is the LHS by construction, and the LHS head is the name.
      for (let i = 0; i < eq.namedChildCount; i++) {
        const c = eq.namedChild(i)
        if (!c) continue
        if (c.type === "constructor" && c.text) { name = c.text; anchor = c; break }
        if (c.type === "infix") {
          const op = this.findNamedChildByType(c, ["constructor_operator", "operator"])
          if (op?.text) { name = op.text; anchor = op; break }
          continue
        }
        if (c.type === "apply") {
          const head = this.haskellAppliedHeadName(c)
          if (head) { name = head; anchor = this.findAppliedHeadNode(c) ?? c; break }
        }
      }
    }
    // A shape this reader cannot name: ABSENCE, not a placeholder. Under rule R7
    // a literal in a name-bearing field becomes a symbol no file contains.
    if (!name || !anchor) return false
    return this.publishPatternSynonym(name, node, anchor, ctx)
  }

  private publishPatternSynonym(name: string, declNode: Node, anchor: Node, ctx: HaskellContext): boolean {
    if (!name || name === " ") return false
    const key = `${ctx.currentModule ?? ""}::${name}`
    const existingIdx = ctx.functionSymbolIndex[key]
    if (existingIdx !== undefined) {
      const existing = ctx.symbols[existingIdx]
      if (existing) {
        const declRange = this.nodeToRange(declNode)
        existing.range.endLine = Math.max(existing.range.endLine, declRange.endLine)
        if (existing.range.endIndex !== undefined && declRange.endIndex !== undefined) {
          existing.range.endIndex = Math.max(existing.range.endIndex, declRange.endIndex)
        }
      }
      return true
    }
    const range = this.nodeToRange(declNode)
    range.startLine = anchor.startPosition.row + 1
    range.startColumn = anchor.startPosition.column + 1
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Constructor,
      range,
      scope: ctx.currentModule ?? "",
      ownerName: ctx.currentModule,
      ownerKind: ASTEngine.SymbolKind.Type,
      visibility: "public",
      metadata: { haskellSpecific: true, isPatternSynonym: true },
    })
    ctx.functionSymbolIndex[key] = ctx.symbols.length - 1
    return true
  }

  /** The node carrying the head name of an applied type/expression spine. */
  private findAppliedHeadNode(node: Node): Node | null {
    let cur: Node | null = node
    let guard = 0
    while (cur && guard++ < 64) {
      if (cur.type === "apply" || cur.type === "parens" || cur.type === "strict") {
        cur = cur.namedChildCount > 0 ? cur.namedChild(0) : null
        continue
      }
      break
    }
    return cur
  }

  // FFI declarations. `foreign import capi "libpq-fe.h PQresultStatus"`
  // parses as foreign_import → calling_convention, entity (the C symbol),
  // signature → variable (the HASKELL name) → function (its type). Nothing in
  // the tree above the module carried the Haskell-side binding, so a file whose
  // entire content is FFI published one symbol: the module. postgrest's
  // `Hasql/LibPq14/Ffi.hs` is exactly that file — 6 declarations, 0 published.
  // The Haskell name is `signature → variable`; the C entity is kept as metadata
  // and as a `references` edge, because that string is how a reader finds the
  // symbol in the C headers and nothing else in the graph points at it.
  private processForeignImport(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Foreign Imports"] = true
    const sig = this.findNamedChildByType(node, ["signature"])
    const varNode = sig ? this.findNamedChildByType(sig, ["variable"]) : null
    const name = varNode?.text ?? ""
    if (!name) return false
    // The C entity is a string LITERAL in the Haskell source:
    //   foreign import ccall unsafe "RTSkeepAlive" c_keepCAFsForGHCi :: () -> IO ()
    // and the grammar's `entity` node text is the literal WITH its quotes. The
    // analyzer published it verbatim, so the `references` endpoint carried
    // `"RTSkeepAlive"` — quotes included.
    //
    // MEASURED, both directions. Over all 14,066 admitted files the tree carries
    // 1,153 `foreign_import` nodes and 1,040 of their `entity` texts are quoted
    // literals (90.2%). On the analyzer's own corpus pass, 935 `references` edges
    // were emitted and 1,866 of the corpus's FFI endpoint occurrences resolved to
    // no published symbol — the samples are unambiguous:
    //   references c_keepCAFsForGHCi -> "keepCAFsForGHCi"
    //   references getOrSetLibHSghcFastStringTable -> "getOrSetLibHSghcFastStringTable"
    //   references setHeapSize -> "setHeapSize"
    // The spelling a reader needs in order to find the symbol in the C header is
    // `RTSkeepAlive`, and the doc comment on this very method said so — the string
    // "is kept as metadata and as a `references` edge, because that string is how a
    // reader finds the symbol in the C headers". With the quotes it is not that
    // string. A pure char scan, like every other string operation in this lane.
    const convention = this.findNamedChildByType(node, ["calling_convention"])?.text ?? ""
    const entity = this.foreignEntityName(this.readForeignEntity(node) ?? "", convention)
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: {
        haskellSpecific: true,
        isForeignImport: true,
        ...(entity ? { foreignEntity: entity } : {}),
        ...(convention ? { callingConvention: convention } : {}),
      },
    })
    const owner = currentScope?.name || ctx.currentModule
    if (owner) {
      this.pushRel(
        ctx,
        owner,
        name,
        ASTEngine.RelationshipType.Contains,
        1.0,
        // The entity travels with the edge as well as the symbol: the cited line
        // is the `foreign import` line, which spells the C name
        // (`WaitForSingleObject`) while the Haskell binding adds an underscore
        // (`waitForSingleObject_`). A consumer — or a gate — checking that the
        // target name appears at the cited line has to be able to find the
        // spelling that IS there.
        { evidenceClass: "structural", isForeignImport: true, ...(entity ? { foreignEntity: entity } : {}) },
        this.lineOf(node),
      )
      if (entity) {
        this.pushRel(
          ctx,
          name,
          entity,
          ASTEngine.RelationshipType.References,
          0.9,
          { evidenceClass: "foreign_symbol", isForeignEntity: true },
          this.lineOf(node),
        )
      }
    }
    return true
  }

  private processData(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Algebraic Data Types"] = true
    // Pinned grammar: data_type/newtype → name (probe 2026-09-03). The
    // `type_constructor`/`tycon`/`type_name` literals are dead (older
    // grammar); the text fallback remains for ERROR-tolerance.
    let name = ""
    const nameNode = this.findNamedChildByType(node, ["name"])
    if (nameNode) name = nameNode.text
    else {
      const dataIdx = this.findChildIndexByText(node, ["data", "newtype"])
      if (dataIdx !== -1 && node.childCount > dataIdx + 1) {
        name = node.child(dataIdx + 1)?.text || ""
      }
    }
    if (!name) return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    const typeRange = this.nodeToRange(node)
    // A `data`/`newtype` declaration puts its keyword on its own line often
    // enough that the node's start line is the bare word `data`:
    //   data
    //     RuleCommands
    //       (scope :: Scope)
    // Anchoring the symbol at its own `name` node puts every `contains` edge
    // citing it on the line the name is written, which is the line a reader wants.
    if (nameNode) {
      typeRange.startLine = nameNode.startPosition.row + 1
      typeRange.startColumn = nameNode.startPosition.column
    }
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: typeRange,
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: { haskellSpecific: true, isData: node.type === "data_type" },
    })

    // Data constructors → Constructor symbols owned by the type. The grammar
    // nests them: data_type → data_constructors → data_constructor → prefix/
    // record; newtype → newtype_constructor directly.
    //
    // GADTs nest DIFFERENTLY: `data Expr a where` puts its constructors under
    // `gadt_constructors` → `gadt_constructor`, never under `data_constructors`.
    // Searching only for the latter published the TYPE and dropped every GADT
    // constructor, so on postgrest's `Hasql/Decoders/All.hs:116` the type
    // `NullableOrNot` appeared with neither `NonNullable` nor `Nullable` — and
    // because those constructors carry the types, the `nonNullable`/`nullable`
    // FUNCTIONS were the only surviving symbols, which reads as if the GADT had
    // no constructors at all. `extractConstructorName` already resolves them: its
    // `["constructor", "name"]` fallback finds a gadt_constructor's own
    // `constructor` child. They only had to be COLLECTED.
    const ctorNodes: Node[] = []
    for (const group of ["data_constructors", "gadt_constructors"]) {
      const g = this.findNamedChildByType(node, [group])
      if (!g) continue
      for (const c of this.collectNamedChildrenByType(g, ["data_constructor", "gadt_constructor"])) {
        if (!ctorNodes.includes(c)) ctorNodes.push(c)
      }
    }
    for (const c of this.collectNamedChildrenByType(node, ["newtype_constructor", "data_constructor", "gadt_constructor"])) {
      if (!ctorNodes.includes(c)) ctorNodes.push(c)
    }
    for (const cNode of ctorNodes) {
      const cName = this.extractConstructorName(cNode)
      if (cName) {
        ctx.symbols.push({
          name: cName,
          kind: ASTEngine.SymbolKind.Constructor,
          range: this.nodeToRange(cNode),
          scope: name,
          ownerName: name,
          ownerKind: ASTEngine.SymbolKind.Type,
          visibility: "public",
          metadata: { isDataConstructor: true },
        })
      }
      // Record fields → Property symbols owned by the constructor/type
      const recordNode = this.findNamedChildByType(cNode, ["record"])
      if (recordNode) {
        const fields = this.collectFields(recordNode)
        for (const field of fields) {
          const fNameNode = this.findNamedChildByType(field, ["field_name"])
          const varNode = fNameNode ? fNameNode.namedChild(0) : null
          if (varNode?.text) {
            ctx.symbols.push({
              name: varNode.text,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(field),
              scope: name,
              ownerName: name,
              ownerKind: ASTEngine.SymbolKind.Type,
              visibility: "public",
              metadata: { haskellSpecific: true, isRecordField: true },
            })
          }
        }
      }
    }

    // deriving (Show, Eq) → implements type -> derived class. Entries are
    // extracted ELEMENT-WISE (HSD18, probe 2026-09-03): a bare `name`, a
    // qualified class (`Csv.ToNamedRecord` — full text), or a class
    // APPLICATION (`MonadError SessionError` — head only; the argument is
    // NOT a class). Previously name-leaves inside qualified/apply entries
    // were missed (hledger) or argument leaves were mis-collected.
    // Parenthesized SINGLE entries (`deriving newtype (Show)`) recurse one
    // level down — regression-guarded by the fixture pin UserId->Show
    // (2026-09-03: element-wise rewrite dropped the parens recursion and the
    // fixture caught it).
    const deriving = this.findNamedChildByType(node, ["deriving", "deriving_strategy"])
    if (deriving) {
      const derived: string[] = []
      // Parallel to `derived`, pushed in lockstep: the CLASS's own node, which is
      // the name-bearing anchor for this edge (the clean lane's instance rule).
      const derivedNodes: Node[] = []
      const grab = (nn: Node) => {
        for (let i = 0; i < nn.namedChildCount; i++) {
          const c = nn.namedChild(i)
          if (!c) continue
          if (c.type === "name") {
            derived.push(c.text)
            derivedNodes.push(c)
          } else if (c.type === "qualified") {
            derived.push(c.text)
            derivedNodes.push(c)
          } else if (c.type === "apply") {
            const h = c.namedChildCount > 0 ? c.namedChild(0) : null
            if (h?.text) {
              derived.push(h.text)
              derivedNodes.push(h)
            }
          } else if (c.type === "parens") grab(c)
        }
      }
      const tuple = this.findNamedChildByType(deriving, ["tuple"])
      if (tuple) grab(tuple)
      grab(deriving)
      for (let i = 0; i < derived.length; i++) {
        this.pushRel(
          ctx,
          name,
          derived[i],
          ASTEngine.RelationshipType.Implements,
          1.0,
          { derived: true },
          this.lineOf(derivedNodes[i]),
        )
      }
    }

    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Type })
    return true
  }

  // data_constructor → prefix → constructor "Node" | record → constructor "Rect"
  private extractConstructorName(node: Node): string | undefined {
    const prefix = this.findNamedChildByType(node, ["prefix"])
    if (prefix) {
      const con = this.findNamedChildByType(prefix, ["constructor", "name"])
      if (con?.text) return con.text
    }
    const record = this.findNamedChildByType(node, ["record"])
    if (record) {
      const con = this.findNamedChildByType(record, ["constructor"])
      if (con?.text) return con.text
    }
    const direct = this.findNamedChildByType(node, ["constructor", "name"])
    if (direct?.text) return direct.text
    return undefined
  }

  private processClass(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    ctx.patterns["Type Classes"] = true
    // Pinned grammar: class → name (`class_name`/`type_name`/`tycon` are
    // dead literals; F1 audit 2026-09-03).
    let name = ""
    const nameNode = this.findNamedChildByType(node, ["name"])
    if (nameNode) name = nameNode.text
    else {
      const classIdx = this.findChildIndexByText(node, "class")
      if (classIdx !== -1 && node.childCount > classIdx + 1) {
        name = node.child(classIdx + 1)?.text || ""
      }
    }
    if (!name) return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    // Superclasses: the constraint tree is walked EXACTLY as the oracle does
    // (`deriveHaskellEdges`'s #872 lockstep) — tuple lists, parens wrappers,
    // quantified (forall) bodies, and applied heads taking the LEFT-SPINE class
    // (`Eq (f a) => D` : the class is Eq, `(f a)` is its argument).
    //
    // This was the ONE half of #872 that never landed: the review recorded the
    // analyzer as fixed, the oracle comment says "exactly as the analyzer now
    // does", and the analyzer was still the flat list below — which the review
    // itself describes as the PRE-fix state. The cost was invisible until
    // `hledger-lib/Hledger/Write/Html/HtmlCommon.hs` (`class (Spr.Lines b) =>
    // Lines b`) surfaced at depth: `extends Lines -> Spr.Lines` MISSING, and the
    // fixture's own tuple class pinned nothing, so no gate could have caught it.
    // Two shapes were missing, and they are different failures: the TUPLE (every
    // list-context superclass dropped — the shape the canonical 60-file draw
    // never sampled) and the QUALIFIED head (`P.Show` vs `Show`), which is taken
    // VERBATIM because that is the text the oracle derives; taking the leaf would
    // only trade a MISSING edge for a differently-spelled one.
    const context = this.findNamedChildByType(node, ["context"])
    if (context) {
      const superNames = new Set<string>()
      // class name text -> the node that carried it (the extends anchor).
      const superNodes = new Map<string, Node>()
      const stack: Node[] = [context]
      while (stack.length > 0) {
        const x = stack.pop()!
        if (x.type === "apply") {
          // Left spine: apply(apply(f, a), b) => f. An applied head is the class.
          let head: Node | null = x
          while (head && head.type === "apply") head = head.namedChildren[0] ?? null
          if (head && (head.type === "name" || head.type === "constructor" || head.type === "qualified")) {
            superNames.add(head.text)
            if (!superNodes.has(head.text)) superNodes.set(head.text, head)
          }
        }
        for (const c of x.namedChildren) if (c) stack.push(c)
      }
      for (const sn of superNames) {
        // A class that lists ITSELF as a superclass is legal Haskell under
        // `UndecidableSuperClasses`, and GHC's own testsuite does it:
        //   class (Frac (Frac a) ~ Frac a, Fractional (Frac a), ID (Frac a)) => ID a
        // (testsuite/tests/typecheck/should_compile/T11254.hs:12). So this is a
        // true statement about the source — and it is still not published, for
        // the reason the `contains` post-loop already gives 30 lines below: a
        // self-named edge collapses into a SELF-LOOP in symbol-ID space, where it
        // can be neither traversed nor distinguished from the declaration itself.
        //
        // MEASURED: this was the ONLY `extends` row the differential disagreed on
        // (1 UNEXPLAINED of 98 over a 1,200-file stride draw,
        // `script/m14/tmp/hs-oracle-agreement.ts`), because the F5 oracle drops
        // structural self-edges outright. Two independent readings, one rule.
        if (sn === name) continue
        this.pushRel(
          ctx,
          name,
          sn,
          ASTEngine.RelationshipType.Extends,
          1.0,
          { isSuperclass: true },
          this.lineOf(superNodes.get(sn)),
        )
      }
    }

    // Anchor at the node carrying the class NAME, for the same reason `data` and
    // `instance` are anchored there (§4e). A class declaration routinely puts the
    // keyword alone and the name many lines down:
    //   class
    //     ( c SpecVersion
    //     , c TestedWith
    //     ...
    //     FieldGrammar (c :: Type -> Constraint) (g :: Type -> Type) where
    // The class node itself starts on the bare `class` keyword and its `name` child
    // is ~9 lines later, so every `contains` edge for the class cited a line with
    // no name on it. This was the last remaining criterion-5 row.
    const classRange = this.nodeToRange(node)
    if (nameNode) {
      classRange.startLine = nameNode.startPosition.row + 1
      classRange.startColumn = nameNode.startPosition.column
    }

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: classRange,
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: { haskellSpecific: true },
    })

    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Interface })
    return true
  }

  /**
   * M60 (#924, haskell E half): the TYPE NAME at the head of an applied type.
   *
   * An instance declaration such as  instance GArbitrary (M1 i c f)  declares an
   * implementation FOR the type M1 i c f, whose name is its head type constructor
   * M1; the published symbol was the whole application (M1 i c), i.e. a payload
   * where a name belongs — measured as 2 distinct strings over 6 occurrences on the
   * census's own haskell samples (script/m14/tmp/c924-name-surface-probe.ts). Walks
   * the APPLICATION SPINE (apply / parens / strict) to the leftmost leaf and returns
   * its text verbatim (a qualified head keeps its dots). The class head already
   * takes this same left-spine descent; only the instance TARGET did not.
   */
  private haskellAppliedHeadName(node: Node | null | undefined): string | undefined {
    let cur: Node | null | undefined = node
    let guard = 0
    while (cur && guard++ < 64) {
      if (cur.type === "apply" || cur.type === "parens" || cur.type === "strict") {
        cur = cur.namedChildCount > 0 ? cur.namedChild(0) : null
        continue
      }
      break
    }
    return cur?.text || undefined
  }

  private processInstance(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {
    let className = ""
    let targetType = ""
    // The node that CARRIES the target type's name. An instance declaration is
    // routinely multi-line and its `instance` keyword sits on its own line:
    //   instance IsGraph ipkg srcpkg =>
    //     IsNode (GenericPlanPackage ipkg srcpkg) where
    // so the instance node's start line is the `instance` keyword and never
    // contains the symbol's own name. Anchoring the symbol's range at this node
    // puts the name — and therefore every `contains` edge citing it — on the line
    // a reader would land on. Measured over cabal: 32 edges in one file cited a
    // bare `instance` keyword.
    let targetNode: Node | null = null

    // Shape: [context?, name(class), type_patterns?, instance_declarations?]
    const classNode = this.findNamedChildByType(node, ["name"])
    const tpNode = this.findNamedChildByType(node, ["type_patterns"])
    if (classNode?.text) className = classNode.text
    if (tpNode) {
      // type_patterns → list → variable (`instance Sized [a]`) | bare
      // name/constructor (`instance Sized Foo`) | parens → apply first child
      // (`instance Functor (Stream f)`). Probe 2026-09-03.
      //
      // `qualified` is the fourth shape and it was MISSING, which is a GAP and not
      // a nicety: `instance TrieMap IntMap.IntMap` is
      // `type_patterns -> qualified("IntMap.IntMap")`, so no branch matched,
      // `targetType` stayed empty, and the instance SYMBOL was published under
      // the CLASS's own name — `instance TrieMap IntMap.IntMap` produced a symbol
      // named `TrieMap` beside the file's `class TrieMap`, i.e. two symbols with
      // one name and different kinds — while the edge the language plainly
      // expresses, `implements IntMap.IntMap -> TrieMap`, was never emitted.
      // MEASURED (stride-40 draw, 351 files, 282 `instance` nodes,
      // `script/m14/tmp/hs-verify-ffi-instance.ts`): `instance TrieMap
      // IntMap.IntMap` at compiler/GHC/Data/TrieMap.hs:139 and `instance
      // MonadGetUnique USM.UniqSM` at compiler/GHC/Types/Unique/DSM.hs:158.
      //
      // The text is taken VERBATIM, which is this lane's standing convention for a
      // qualified head: qualified CALLS publish the full `M.lookup` (the Erlang
      // `gen_server:cast` precedent) and a qualified SUPERCLASS keeps its dots,
      // because taking the leaf would only trade a MISSING edge for a
      // differently-spelled one. `IntMap.IntMap` is also how the source writes
      // it, so the edge target is greppable back to the declaration.
      const direct = this.findNamedChildByType(tpNode, ["name", "constructor"])
      if (direct?.text) {
        targetType = direct.text
        targetNode = direct
      } else {
        const list = this.findNamedChildByType(tpNode, ["list"])
        if (list) {
          targetType = "[]"
        } else {
          const parens = this.findNamedChildByType(tpNode, ["parens"])
          if (parens) {
            const ap = this.findNamedChildByType(parens, ["apply"])
            const first = ap?.namedChildCount ? ap.namedChild(0) : null
            // M60 (#924, haskell E half): the TARGET TYPE's NAME, not the whole
            // application — (M1 i c f) names the type M1, and publishing M1 i c
            // put a payload where a name belongs. See haskellAppliedHeadName.
            if (first) {
              targetType = this.haskellAppliedHeadName(first) ?? first.text
              // anchor on the APPLIED HEAD, which is where the name is written:
              // `(GenericPlanPackage ipkg srcpkg)` names it at the apply's first
              // child, not at the enclosing `instance` keyword's line
              const head = first.namedChildren.find((c: any) => c.type === "name" || c.type === "constructor")
              targetNode = head ?? first
            }
          } else {
            // A QUALIFIED target, and ONLY when it is the FIRST type pattern.
            // `instance TrieMap IntMap.IntMap` is `type_patterns ->
            // qualified("IntMap.IntMap")` and no other branch above can name it.
            //
            // "ONLY when it is the first" is load-bearing, and the first version of
            // this fix got it wrong. `findNamedChildByType` scans for the first child
            // of a recognised TYPE, so adding "qualified" to that list let a LATER
            // pattern hijack the target of a multi-parameter instance whose first
            // pattern was parenthesised — measured over the corpus, that silently
            // moved 2 `implements` and 5 `overrides` edges onto the wrong type:
            //
            //   compiler/GHC/HsToCore/Quote.hs:1239
            //     instance RepTV (HsBndrVis GhcRn) TH.BndrVis
            //     type_patterns children, document order: [0] parens  [1] qualified
            //   compiler/GHC/ThToHs.hs:1600
            //     instance CvtFlag TH.BndrVis (HsBndrVis GhcPs)
            //     type_patterns children, document order: [0] qualified  [1] parens
            //
            // Gating on position rather than on type makes the change strictly
            // ADDITIVE: every shape the pre-existing branches already read is still
            // read by them, and the only new case is a first pattern nothing else
            // could name. That is checked by the same-ruler census (FIX 2 net +120
            // `implements` with 0 rows moved off a previously-correct target) and by
            // the `instance-target-no-qualified` mutant.
            const firstPattern = tpNode.namedChildCount > 0 ? tpNode.namedChild(0) : null
            if (firstPattern?.type === "qualified" && firstPattern.text) {
              targetType = firstPattern.text
              targetNode = firstPattern
            }
          }
        }
      }
    }

    // Fallback (text-free): instance D Int → second named child
    if (!className || !targetType) {
      const named: string[] = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && (c.type === "name" || c.type === "constructor")) {
          named.push(c.text)
        }
      }
      if (!className && named.length >= 1) className = named[0]
      if (!targetType && named.length >= 2) targetType = named[1]
    }

    // Name the implementation class by its target type (Stream), matching the
    // universal impl-naming contract (Rust `impl User`, Elixir `defimpl`).
    const name = targetType || className
    if (!name || name === " ") return false

    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    const instRange = this.nodeToRange(node)
    if (targetNode) {
      // start where the NAME is, end where the declaration is
      instRange.startLine = targetNode.startPosition.row + 1
      instRange.startColumn = targetNode.startPosition.column
    }
    ctx.symbols.push({
      name,
      // An INSTANCE, not a class. It is named after the type it instantiates,
      // and `contains` is derived from symbol ownership, so publishing it as
      // a Class asserted this module DECLARES that type. The scope pushed for
      // the body below stays Class on purpose -- method resolution reads it.
      kind: ASTEngine.SymbolKind.Instance,
      range: instRange,
      scope: currentScope?.name || "",
      ownerName: currentScope?.name || ctx.currentModule,
      visibility: "public",
      metadata: { haskellSpecific: true, className, targetType },
    })

    if (className && targetType) {
      this.pushRel(
        ctx,
        targetType,
        className,
        ASTEngine.RelationshipType.Implements,
        1.0,
        { isInstance: true },
        this.lineOf(classNode),
      )
    }

    // overrides — the relationship Haskell actually has instead of class
    // inheritance. `instance Shape Rec where area r = ...` OVERRIDES the
    // `area` declared by `class Shape`: same name, same arity, and the
    // instance's version is the one a `Shape Rec` value dispatches to. Without
    // this the graph said only "Rec implements Shape", and the method-level
    // dispatch — the whole point of a typeclass — was invisible, so a reader
    // could not tell WHICH member an instance supplied.
    //
    // It was also the one product relationship type this lane had audited but
    // never produced: `overrides` is in haskell's F5 label set, yet neither the
    // analyzer nor the oracle emitted a single row, so the audit was comparing
    // nothing to nothing and reading green.
    //
    // The class side comes from the pre-pass (declaration order is not
    // guaranteed); the instance side is this node's own method names. An
    // instance that defines a method the class does NOT declare is not an
    // override, and is deliberately not published as one.
    const classM = ctx.classMethods.get(className)
    if (classM && classM.size > 0 && targetType) {
      const decls = this.findNamedChildByType(node, ["instance_declarations"])
      const bodies: Node[] = []
      if (decls) {
        for (const d of this.collectNamedChildrenByType(decls, ["function", "bind"])) bodies.push(d)
      }
      for (const d of this.collectNamedChildrenByType(node, ["function", "bind"])) {
        if (!bodies.includes(d)) bodies.push(d)
      }
      for (const b of bodies) {
        const mName = b.namedChildCount > 0 ? b.namedChild(0)?.text : undefined
        if (!mName || !classM.has(mName)) continue
        this.pushRel(
          ctx,
          `${targetType}.${mName}`,
          `${className}.${mName}`,
          ASTEngine.RelationshipType.Override,
          1.0,
          { isInstanceMethod: true, evidenceClass: "structural" },
          this.lineOf(b),
        )
      }
    }

    // Methods of an instance belong to the CLASS it instantiates, not to the
    // type being instantiated. `instance (...) => Described (List sep)` defines
    // `describe`: `describe` is a member of `Described`, and `List` is only what
    // is being described. Ownership by the target type made every instance body
    // claim its subject type as a declaration here.
    scopeStack.push({ node, name: className || name, kind: ASTEngine.SymbolKind.Class })
    return true
  }

  // ==========================================================================
  // Call extraction — apply nodes in body position.
  // ==========================================================================
  private extractApplyCall(node: Node, ctx: HaskellContext, scopeStack: Scope[]) {
    const head = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!head) return
    const fn = ctx.currentFunction
    if (!fn) return

    // Constructor application in body → instantiates (record construction /
    // prefix constructor application). Pattern-position applies live inside a
    // `patterns` node and are excluded via currentFunction only firing in body
    // contexts — additionally, applies whose parent chain hits a `patterns`
    // node are patterns, never construction sites.
    if (head.type === "constructor" || head.type === "prefix") {
      if (this.isPatternPosition(node)) return
      this.pushRel(
        ctx,
        fn,
        head.text,
        ASTEngine.RelationshipType.Instantiates,
        0.9,
        {
          haskellSpecific: true,
          isConstructorApplication: true,
        },
        this.lineOf(head),
      )
      return
    }

    // Qualified call: M.lookup / Data.Map.size → full qualified target
    // (Erlang gen_server:cast precedent). Pinned grammar: qualified → module
    // + variable (`qconid` is dead; F1 audit 2026-09-03).
    // HSD16 (probe 2026-09-03, 985 corpus occurrences): a qualified head
    // wrapping a CONSTRUCTOR (`M.Just 1`, `C.Registry availableDb`) is a
    // body-position data-constructor application — instantiates, not calls.
    // Previously only the function form was derived and 564 cabal + 331
    // postgrest + 87 hledger construction sites were silently dropped.
    if (head.type === "qualified") {
      const mod = this.findNamedChildByType(head, ["module"])
      const modText = mod ? this.stripTrailingDot(mod.text) : ""
      const ctor = this.findNamedChildByType(head, ["constructor"])
      if (modText && ctor?.text) {
        if (!this.isPatternPosition(node)) {
          this.pushRel(
            ctx,
            fn,
            `${modText}.${ctor.text}`,
            ASTEngine.RelationshipType.Instantiates,
            0.9,
            {
              haskellSpecific: true,
              isQualifiedConstructorApplication: true,
            },
            this.lineOf(head),
          )
        }
        return
      }
      const func = this.findNamedChildByType(head, ["variable"])
      if (modText && func?.text) {
        this.pushRel(
          ctx,
          fn,
          `${modText}.${func.text}`,
          ASTEngine.RelationshipType.Calls,
          0.9,
          {
            haskellSpecific: true,
            isQualifiedCall: true,
          },
          this.lineOf(head),
        )
      }
      return
    }

    // Local call: variable/identifier head → leaf target, only when declared
    // in this file (FP-family resolution: imported/Prelude functions and type
    // variables produce no edge). Self-recursion IS emitted. A VISIBLE local
    // wins over a module-level namesake and resolves to its scoped identity
    // (`owner.local`); an invisible local is not a target at all.
    if (head.type === "variable") {
      const target = this.resolveCallableTarget(head.text, scopeStack, ctx)
      if (target !== undefined) {
        this.pushRel(
          ctx,
          fn,
          target,
          ASTEngine.RelationshipType.Calls,
          0.9,
          {
            haskellSpecific: true,
            context: "local function call",
          },
          this.lineOf(head),
        )
      }
    }
  }

  private isPatternPosition(node: Node): boolean {
    let cur: Node | null = node.parent
    let prev: Node | null = node
    while (cur) {
      if (cur.type === "patterns") return true
      // Case-alternative pattern region (HSD14, probe 2026-09-03): the pattern
      // sits as a DIRECT child of `alternative` (before the `->` arrow); the
      // branch body lives inside the sibling `match`, which terminates below.
      // Reaching `alternative` first therefore means pattern territory —
      // `case s of Circle r -> ...` must NOT claim `instantiates Circle`.
      if (cur.type === "alternative") return true
      if (cur.type === "pattern_guard") {
        // Bind-form pattern guard (`| Just x <- m = x`): only the FIRST child
        // (the pattern before `<-`) is pattern territory; the scrutinee is an
        // expression and keeps walking (it may host deeper case patterns).
        // Boolean-exp guards parse as `boolean`, never as `pattern_guard`.
        // NOTE: compare node ids — web-tree-sitter hands out a fresh wrapper
        // object per namedChild() access, so identity (===) never matches.
        if (prev && prev.id === cur.namedChild(0)?.id) return true
      } else if (cur.type === "match" || cur.type === "do" || cur.type === "class" || cur.type === "instance") {
        // Match/do bodies and instance/class bodies are expression territory.
        return false
      } else if (cur.type === "function" || cur.type === "bind") {
        // Function/bind HEAD slot (HSD19, probe 2026-09-03): child 0 hosts the
        // head — an infix definition (`Tok a == Tok b`, ``(a,b) `gives` r``),
        // or a constructor/tuple PATTERN (`Right x = ...`, `T m = ...`). Any
        // constructor apply inside that slot is pattern territory. Everything
        // else reached through function/bind is expression territory: the
        // body is the sibling `match`, and a do-bind RHS (`x <- pure (J 1)`)
        // is a direct child at index >= 1 — must keep emitting.
        if (prev.type === "match" || prev.type === "patterns") return false
        if (prev.id === cur.namedChild(0)?.id) return true
        return false
      }
      prev = cur
      cur = cur.parent
    }
    return false
  }

  // =========================================================================
  // Infix handling: backtick calls, $ application, and pattern marking.
  // HSD1/HSD2 (probe 2026-09-03): infix_id is a backtick call (`x `elem2` xs`);
  // operator "$" is function application — Haskell's most common idiom. Both
  // were previously dropped entirely.
  // =========================================================================
  private processInfix(node: Node, ctx: HaskellContext, scopeStack: Scope[]) {
    const opNode = this.findNamedChildByType(node, ["operator"])
    const infixId = this.findNamedChildByType(node, ["infix_id"])

    if (infixId) {
      // VERIFY_HS9: a TICKED CONSTRUCTOR in body position (`x `Cons` y`) is a
      // construction, not a call — the ticked name is a `constructor` child, so
      // the variable lookup below finds nothing and the site was dropped whole.
      // Measured 9 such sites on a 60-file draw (script/m14/tmp/hs9-opshape-
      // probe.ts, EXP/infix_id:constructor). Pattern-ticked constructors are
      // gated below exactly like every other pattern site.
      const tickedCtor = this.findNamedChildByType(infixId, ["constructor"])
      if (tickedCtor?.text) {
        const fnC = ctx.currentFunction
        if (fnC && !this.isPatternPosition(node) && !this.isTypePosition(node)) {
          this.pushRel(
            ctx,
            fnC,
            tickedCtor.text,
            ASTEngine.RelationshipType.Instantiates,
            0.9,
            {
              haskellSpecific: true,
              isTickedConstructorApplication: true,
            },
            this.lineOf(tickedCtor),
          )
        }
        return
      }
      // Backtick call: the infix_id wraps the called function (variable).
      // HSD19 companion: an infix DEFINITION head (`(a,b) `gives` r = ...`)
      // is pattern territory (head slot) — its own infix_id is the name being
      // defined, never a call. Gated identically to constructor applies.
      if (this.isPatternPosition(node)) return
      const fn = ctx.currentFunction
      const target = this.findNamedChildByType(infixId, ["variable"])
      const resolved = target?.text !== undefined ? this.resolveCallableTarget(target.text, scopeStack, ctx) : undefined
      if (fn && resolved !== undefined) {
        this.pushRel(
          ctx,
          fn,
          resolved,
          ASTEngine.RelationshipType.Calls,
          0.9,
          {
            haskellSpecific: true,
            context: "backtick infix call",
          },
          this.lineOf(target),
        )
      }
    } else if (opNode?.text === "$") {
      // `$` application: LHS is the applied function (possibly qualified),
      // exactly like an apply head. RHS chains nest further infix/apply nodes
      // and are visited independently. Only the LHS is applied here.
      const fn = ctx.currentFunction
      if (fn) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (!c || c.type === "operator") continue
          const resolved = c.type === "variable" ? this.resolveCallableTarget(c.text, scopeStack, ctx) : undefined
          if (resolved !== undefined) {
            this.pushRel(
              ctx,
              fn,
              resolved,
              ASTEngine.RelationshipType.Calls,
              0.9,
              {
                haskellSpecific: true,
                context: "$ application",
              },
              this.lineOf(c),
            )
          } else if (c.type === "qualified") {
            const mod = this.findNamedChildByType(c, ["module"])
            const func = this.findNamedChildByType(c, ["variable"])
            const modText = mod ? this.stripTrailingDot(mod.text) : ""
            if (modText && func?.text) {
              this.pushRel(
                ctx,
                fn,
                `${modText}.${func.text}`,
                ASTEngine.RelationshipType.Calls,
                0.9,
                {
                  haskellSpecific: true,
                  isQualifiedCall: true,
                  context: "$ application",
                },
                this.lineOf(c),
              )
            }
          }
          break
        }
      }
    } else {
      // VERIFY_HS9 G1/G2 — every OTHER infix shape is an operator or a
      // constructor application, and the file that DEFINES an operator as a
      // callable published it with no callers at all (see the doc's
      // "VERIFY_HS9 measurement log"). Two sub-shapes, one walk:
      //   `constructor_operator` head  -> instantiates (it CONSTRUCTS)
      //   plain `operator` head        -> calls, but only when this file
      //                                   declares that operator as a callable
      this.emitOperatorApplication(node, ctx, scopeStack)
    }

    // Pattern marking (unchanged contract).
    const op = opNode?.text ?? ""
    if (op === ">>=" || op === ">>" || op === "<-") ctx.patterns["Monads"] = true
    if (op === "<$>" || op === "<*>") ctx.patterns["Functors and Applicatives"] = true
    if (op === "|>") ctx.patterns["Pipe Operator"] = true
  }

  // ==========================================================================
  // VERIFY_HS9 — operator and infix-constructor APPLICATION (G1 + G2).
  //
  // What was missing, measured (script/m14/tmp/hs9-opshape-probe.ts, 60-file
  // GHC draw, all counts AST-side):
  //
  //   EXP/infix:operator            3,140   of which 86 name an operator THIS
  //                                         file declares as a callable
  //   EXP/infix:constructor_operator   111   an infix DATA-CONSTRUCTOR
  //                                         application (`a :+: b`) — a
  //                                         construction, emitted as nothing
  //   EXP/infix_id:constructor          9   a ticked constructor (`x `Cons` y`)
  //   EXP/prefix_id:operator           22   `(<+>) a b`, a prefix application
  //   EXP/prefix_id:constructor_operator 3   `(:+:) a b`
  //   TYP/infix:operator               29   TYPE-level operator — must emit
  //                                         nothing, and the node type alone
  //                                         cannot tell it from an expression
  //   PAT/infix:constructor_operator   98   pattern — must emit nothing
  //
  // WHY THE POSITION TEST IS NOT OPTIONAL: `infix` is ONE node type for THREE
  // syntactic positions in the pinned grammar. _exp_infix (grammar/exp.js:353),
  // _pat_infix (grammar/pat.js:99) and _type_infix (grammar/type.js:116) are all
  // aliased to `infix`, and all three use the field names left_operand /
  // operator / right_operand. A type-level operator is a bare `operator` node,
  // exactly like an expression's — the 29 TYP rows above are sites that an
  // operator-only test would have turned into 29 fabricated calls.
  //
  // WHY NAME RESOLUTION IS RIGHT AND NOT A GUESS: Haskell resolves an
  // unqualified name lexically, and a module's own top-level declaration — or
  // class method — SHADOWS the implicit Prelude import. So in a module that
  // declares `==`, `x == y` IS that module's `==`; the alternative would be an
  // ambiguous-occurrence error. This is the same rule resolveCallableTarget
  // already applies to plain variables, extended to operators.
  //
  // WHY SECTIONS ARE NOT EMITTED: `(x +)` is a PARTIAL application — it builds
  // a function value, it performs no call. `(<+>) a b` is a full application
  // and is emitted. The line is full-application vs partial, and it is stated
  // here rather than left to a reader of the code.
  // ==========================================================================
  private emitOperatorApplication(node: Node, ctx: HaskellContext, scopeStack: Scope[]): void {
    const fn = ctx.currentFunction
    if (!fn) return
    // Pattern territory and type territory are both non-expression: a matched
    // `a :+: b` constructs nothing, and a type-level operator is not a call.
    if (this.isPatternPosition(node) || this.isTypePosition(node)) return

    // `infix` names its operator with a FIELD (grammar/exp.js:353,
    // `field('operator', ...)`); `prefix_id` wraps the symbol directly
    // (grammar/operator.js `_pvarsym`/`_pconsym`). Read the field first and
    // fall back to the first named child, so the same helper serves both.
    const opField = node.childForFieldName("operator")
    const head: Node | null = opField ?? (node.namedChildCount > 0 ? node.namedChild(0) : null)
    if (!head) return

    if (head.type === "constructor_operator") {
      this.pushRel(
        ctx,
        fn,
        head.text,
        ASTEngine.RelationshipType.Instantiates,
        0.9,
        {
          haskellSpecific: true,
          isInfixConstructorApplication: true,
        },
        this.lineOf(head),
      )
      return
    }
    if (head.type !== "operator") return
    // `$` is handled by its own branch above: it applies the LEFT operand, not
    // itself, so resolving `$` as a declared callable would be a different
    // (and wrong) edge.
    if (head.text === "$") return
    const resolved = this.resolveCallableTarget(head.text, scopeStack, ctx)
    if (resolved === undefined) return
    this.pushRel(
      ctx,
      fn,
      resolved,
      ASTEngine.RelationshipType.Calls,
      0.9,
      {
        haskellSpecific: true,
        context: "operator application",
      },
      this.lineOf(head),
    )
  }

  /**
   * VERIFY_HS9: is this node part of a TYPE rather than an expression?
   *
   * Needed because `infix` covers expression, pattern AND type position in the
   * pinned grammar (see emitOperatorApplication). The list is the grammar's own
   * type-bearing vocabulary; the loop stops at an expression-bearing node so a
   * `type` buried inside a body does not capture expression operators above it.
   * Measured 29 type-level `infix:operator` sites on a 60-file draw, so this
   * test is load-bearing rather than defensive.
   */
  private isTypePosition(node: Node): boolean {
    let cur: Node | null = node.parent
    let guard = 0
    while (cur && guard++ < 256) {
      if (HASKELL_TYPE_BEARING_NODES.has(cur.type)) return true
      if (
        cur.type === "match" || cur.type === "do" || cur.type === "bind" ||
        cur.type === "let_in" || cur.type === "lambda" || cur.type === "record" ||
        cur.type === "guard"
      ) {
        return false
      }
      cur = cur.parent
    }
    return false
  }

  /**
   * Per-symbol cyclomatic complexity (family contract: python #270 / ruby
   * #269 / php #268). Haskell decision points per the analyzer's own
   * module-level counter: case, conditional (if), guards.
   */
  private calculateNodeComplexity(node: Node): number {
    if (!node) return 1
    let complexity = 1
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (n.type === "case" || n.type === "conditional" || n.type === "guards") complexity++
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  /**
   * Evidence-tier classification — same rules as the python/ruby/php family
   * (M14 section D requires >=2 distinct evidenceClass values).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = (r.metadata ??= {})
      if (md.evidenceClass) continue
      const t = r.type
      const conf = r.confidence ?? 0
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "imports") { md.evidenceClass = md.isHaskellImport ? "import_based" : "structural"; continue }
      if (t === "references") { md.evidenceClass = md.isHaskellImport ? "import_based" : "reference_qualified"; continue }
      if (t === "extends" || t === "implements") { md.evidenceClass = "structural"; continue }
      if (t === "overrides") { md.evidenceClass = md.isInstanceMethod ? "structural" : md.evidenceClass ?? "structural"; continue }
      if (t === "instantiates") { md.evidenceClass = md.isRecordConstruction || md.isConstructorApplication || md.isQualifiedConstructorApplication || md.isInfixConstructorApplication || md.isTickedConstructorApplication ? "usage_contextual" : "structural"; continue }
      md.evidenceClass = conf >= 0.85 ? "usage_contextual" : "inferred"
    }
  }

  // Data-DECLARATION records live inside data_constructors; body-position
  // records sit under a match/do/bind. Walk up: crossing a match/bind/do
  // before any data_constructor means body position.
  private isDataDeclarationPosition(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "match" || cur.type === "do" || cur.type === "bind" || cur.type === "let_in") return false
      if (cur.type === "data_constructor" || cur.type === "newtype_constructor") return true
      cur = cur.parent
    }
    return false
  }

  // ==========================================================================
  // Pure-string helpers (no regex).
  // ==========================================================================
  private stripOuterParens(text: string): string {
    let start = 0
    let end = text.length
    while (start < end && text[start] === "(") start++
    while (end > start && text[end - 1] === ")") end--
    return text.slice(start, end)
  }

  private stripTrailingDot(text: string): string {
    return text.length > 0 && text[text.length - 1] === "." ? text.slice(0, -1) : text
  }

  /**
   * The C entity a `foreign_import` binds, or undefined when the declaration
   * names none.
   *
   * The Haskell 2010 FFI grammar is `foreign import [cc] [safety] import
   * [stringliteral] (entity | variadic)`: the string literal is the OPTIONAL
   * HEADER and the entity is the name that follows it. The pinned grammar models
   * both as `entity` children, so `foreign import capi "libwidget.h"
   * "widget_alloc" c_widgetAlloc` carries TWO of them — the header first — and
   * taking the FIRST match publishes the header as the symbol:
   * `references c_widgetAlloc -> "libwidget.h"`, a file name where a function
   * name belongs.
   *
   * MEASURED, and it corrected the hypothesis: over all 14,038 admitted `.hs`
   * files there are 1,153 `foreign_import` nodes and the shape distribution is
   * 1,040 with ONE quoted `entity` (which IS the entity — GHC writes
   * `foreign import ccall unsafe "rts_isDebugged" c_rtsIsDebugged`), 113 with NO
   * `entity` node at all, exactly 1 whose entity sits inside a sibling `ERROR`,
   * and ZERO with two `entity` children
   * (`script/m14/tmp/hs-ffi-shapes.ts`). So on THIS corpus the header case never
   * fires and the only live FFI defect was the quotes. The LAST-entity rule is
   * kept because it is strictly more correct on a shape the grammar does produce
   * elsewhere, and the count above is what says its reach here is 0 — a fix whose
   * corpus measurement is 0 is still worth having, and its 0 is recorded rather
   * than implied.
   */
  private readForeignEntity(node: Node): string | undefined {
    let found: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "entity") found = c
    }
    return found?.text
  }

  /**
   * Drop ONE surrounding pair of double quotes.
   *
   * The FFI `entity` is a Haskell string literal, so the grammar's node text is
   * `"name"` and the quotes are part of the node's text rather than of the name.
   * Only the exact pair is removed, and only when both ends have one: a C
   * identifier cannot contain `"`, and a bare word that happens to be an entity
   * (the `foreign export`/`foreign import` variants whose entity is not a literal)
   * is left exactly as it was. No regex — the lane's string contract is char
   * scans over values already extracted from AST nodes.
   */
  private stripQuotes(text: string): string {
    if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') return text.slice(1, -1)
    return text
  }

  /**
   * THE C SYMBOL an FFI `entity` literal binds, not the whole literal.
   *
   * MEASURED DEFECT (2026-10-03, `script/m14/tmp/hs-verify-ffi-instance.ts`, tree
   * pass over a stride-40 draw of the GHC corpus — 351 files, 23 `foreign_import`
   * nodes): 7 of those 23 entity literals (30.4 %) carry a HEADER AND THE C NAME
   * IN ONE STRING, separated by a space, and the analyzer published the header as
   * the symbol:
   *
   *   references log1pDoubleOld -> "math.h log1p"      <- a FILE NAME
   *   references functionInC    -> "T15933.h function_in_c"
   *
   * This is the Haskell 2010 Report's own grammar, F.3.2.1:
   *
   *     impent  →  'static' [chname] [&] [cid]  |  string
   *
   * and for the string form the header and the entity share one literal, so
   * `foreign import ccall "T15933.h function_in_c"` binds the C symbol
   * `function_in_c`. GHC writes both shapes in this very corpus:
   * `foreign import ccall unsafe "RTSkeepAlive" c_keepCAFsForGHCi` (name only)
   * and the two above (header + name). The name-only shape is unaffected, which
   * is why the defect sat unread: every spot check drew the common form.
   *
   * WHY THE PRIOR MEASUREMENT MISSED IT. `readForeignEntity`'s own comment
   * records a tree census of 1,153 `foreign_import` nodes with "ZERO with two
   * `entity` children", and concluded the header case never fires. That count is
   * of NODES, and it is correct — this grammar really does model the header and
   * the entity as ONE `entity` node whose text is the whole literal. The header
   * is inside the string, not beside it, so no node census can see it; only the
   * literal's CONTENT distinguishes the two shapes. A fix whose measured reach
   * was recorded as 0 was recorded from the wrong quantity.
   *
   * RULE, IN TWO PARTS, BOTH CONDITIONED ON THE CALLING CONVENTION.
   *
   * (a) `javascript` NAMES NO ENTITY, so it yields "". `foreign import
   *     javascript "(($1, $2) => { return $1($2); })"` binds a JAVASCRIPT BODY.
   *     Measured over a stride-12 draw (1,170 files, 62 `foreign_import` nodes,
   *     `script/m14/tmp/hs-verify-ffi-conv.ts`): 13 of 13 `javascript` nodes name
   *     JS code and not one names an entity. Before this branch the analyzer
   *     published those bodies verbatim, and 8 of them SHIPPED — they contain
   *     none of the characters `pool-worker.filterNoiseRelationships` bans, so
   *     the filter did not catch them:
   *
   *       references js_print         -> "console.log($1)"
   *       references js_req_to_str   -> "$1.text($2)"
   *       references js_server_create -> "$1.createServer($2)"
   *       references js_fetch_post    -> "r.text();"
   *
   *     That is the R7 payload-as-name shape: a code fragment standing where a
   *     symbol belongs, counted by bb_graph and displayed by bb_impact. Under R7
   *     the honest state for "no entity is named here" is ABSENCE. The declaration
   *     still publishes its Haskell symbol and its `contains` edge; only the
   *     `references` edge — which asserts an external symbol exists — is withheld.
   *
   * (b) For every C convention (`ccall`, `capi`, `stdcall`, `prim`, …) the C
   *     entity is the LAST whitespace-separated token of the unquoted literal,
   *     less a leading `&`. A C identifier contains neither a space nor a `&`
   *     sigil, and the Report puts the header and the `static` keyword before the
   *     entity, separated by a space. Measured in the same draw, the C
   *     conventions are where the header and the `&` actually live:
   *
   *       capi   HEADER_PLUS_NAME  x6   "math.h log1p"
   *       ccall  HEADER_PLUS_NAME  x2   "test_error_throwing.h equivalent_to_id"
   *       ccall  AMPERSAND         x1   "stdio.h &putchar"
   *
   *     against 37 name-only C nodes and 13 javascript ones. The `&` is Report
   *     F.3.2.1's `impent → 'static' [chname] [&] [cid]`: it means "pass the
   *     address of this entity" and is not part of the entity's spelling, so
   *     `foreign import ccall unsafe "&ghc_unique_counter64" ghc_unique_counter64`
   *     (compiler/GHC/Types/Unique/Supply.hs:280) names the C symbol
   *     `ghc_unique_counter64`.
   *
   * A corpus-wide count of the two prefix defects together, over the 1,356 quoted
   * FFI literals GHC writes: **391 header+name and 42 `&`-prefixed = 433 of
   * 1,356 (31.9 %)**, with 923 clean. That count is taken over the literals; the
   * convention split is taken over the tree, because only the tree knows which
   * convention a literal belongs to and the two must not be conflated — 10 of the
   * 391 text-level "header" hits are JavaScript bodies, not headers.
   */
  private foreignEntityName(literal: string, convention: string): string {
    // (a) No entity is named by a javascript FFI declaration.
    if (convention === "javascript") return ""
    // (b) The C entity is the last space-separated token, less a leading `&`.
    const unquoted = this.stripQuotes(literal).trim()
    if (!unquoted) return ""
    let start = 0
    for (let i = 0; i < unquoted.length; i++) {
      if (unquoted[i] === " " || unquoted[i] === "\t" || unquoted[i] === "\n" || unquoted[i] === "\r") {
        start = i + 1
      }
    }
    let name = unquoted.slice(start)
    if (name[0] === "&") name = name.slice(1)
    return name
  }

  private hasArrowInParens(text: string): boolean {
    let depth = 0
    for (let i = 0; i < text.length - 1; i++) {
      const ch = text[i]
      if (ch === "(") depth++
      else if (ch === ")") depth = Math.max(0, depth - 1)
      else if (ch === "-" && text[i + 1] === ">" && depth > 0) return true
    }
    return false
  }

  private splitOnArrows(text: string): string[] {
    const parts: string[] = []
    let cur = ""
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "-" && text[i + 1] === ">") {
        parts.push(cur)
        cur = ""
        i++
      } else {
        cur += text[i]
      }
    }
    parts.push(cur)
    return parts
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

  private findNamedChildByType(node: Node, types: string[], extraPredicate?: (type: string) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue

      let found = false
      for (let j = 0; j < types.length; j++) {
        if (types[j] === child.type) {
          found = true
          break
        }
      }
      if (found || (extraPredicate && extraPredicate(child.type))) return child
    }
    return null
  }

  private collectFields(recordNode: Node): Node[] {
    const fields: Node[] = []
    const stack: Node[] = [recordNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        if (child.type === "field") fields.push(child)
        else stack.push(child)
      }
    }
    return fields
  }

  private collectNamedChildrenByType(node: Node, types: string[]): Node[] {
    const matches: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        let found = false
        for (let j = 0; j < types.length; j++) {
          if (types[j] === child.type) {
            found = true
            break
          }
        }
        if (found) matches.push(child)
      }
    }
    return matches
  }

  private hasChildOfType(node: Node, type: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && child.type === type) return true
    }
    return false
  }

  private findChildIndexByText(node: Node, needle: string | string[]): number {
    const needles: string[] = []
    if (Array.isArray(needle)) {
      for (let i = 0; i < needle.length; i++) needles.push(needle[i])
    } else {
      needles.push(needle)
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) {
        for (let j = 0; j < needles.length; j++) {
          if (needles[j] === child.text) return i
        }
      }
    }
    return -1
  }
}
