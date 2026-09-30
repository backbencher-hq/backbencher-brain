import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

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
  // Lexical local identity (see LocalScopes).
  localScopes: LocalScopes
  // Module name set by the header; module-level symbols get ownerName = module
  // so the post-loop emits module → member contains edges. (The header subtree
  // ends before the body, so the scope stack cannot carry the module.)
  currentModule: string | undefined
  currentFunction: string | undefined
  seenRels: Set<string>
}

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
      localScopes: { callableScoped: new Map(), blockLocals: new Map(), frameLocals: new Map() },
      currentModule: undefined,
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

    // Post-loop: contains for owned symbols — module → members, type →
    // constructors, record → fields, class/instance → methods. Skip self-named
    // edges (data User = User {...} → the type and constructor share the name,
    // which would collapse into a self-loop in symbol-ID space).
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || (s.scope && s.scope !== ctx.currentModule ? s.scope : undefined)
      if (_owner && _owner !== s.name) {
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
        if (expNode) {
          let exportName = expNode.text.trim()
          if (this.startsWithWord(exportName, "module ")) {
            exportName = exportName.slice("module ".length).trim()
          } else {
            const paren = exportName.indexOf("(")
            if (paren >= 0) exportName = exportName.slice(0, paren).trim()
          }
          if (exportName && exportName !== ",") {
            ctx.exports.push({ name: exportName, isDefault: false, range: this.nodeToRange(expNode) })
          }
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
      // DependsOn for imports — source is the MODULE (FP-family contract:
      // references module -> dep), never the import itself.
      this.pushRel(
        ctx,
        ctx.currentModule || "",
        mod.name,
        ASTEngine.RelationshipType.References,
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
    return true
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
    const entity = this.findNamedChildByType(node, ["entity"])?.text ?? ""
    const convention = this.findNamedChildByType(node, ["calling_convention"])?.text ?? ""
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
        { evidenceClass: "structural", isForeignImport: true },
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
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
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

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
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

    // Shape: [context?, name(class), type_patterns?, instance_declarations?]
    const classNode = this.findNamedChildByType(node, ["name"])
    const tpNode = this.findNamedChildByType(node, ["type_patterns"])
    if (classNode?.text) className = classNode.text
    if (tpNode) {
      // type_patterns → list → variable (`instance Sized [a]`) | bare
      // name/constructor (`instance Sized Foo`) | parens → apply first child
      // (`instance Functor (Stream f)`). Probe 2026-09-03.
      const direct = this.findNamedChildByType(tpNode, ["name", "constructor"])
      if (direct?.text) {
        targetType = direct.text
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
            if (first) targetType = this.haskellAppliedHeadName(first) ?? first.text
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
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(node),
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

    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Class })
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
    }

    // Pattern marking (unchanged contract).
    const op = opNode?.text ?? ""
    if (op === ">>=" || op === ">>" || op === "<-") ctx.patterns["Monads"] = true
    if (op === "<$>" || op === "<*>") ctx.patterns["Functors and Applicatives"] = true
    if (op === "|>") ctx.patterns["Pipe Operator"] = true
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
      if (t === "references") { md.evidenceClass = md.isHaskellImport ? "import_based" : "reference_qualified"; continue }
      if (t === "extends" || t === "implements") { md.evidenceClass = "structural"; continue }
      if (t === "instantiates") { md.evidenceClass = md.isRecordConstruction || md.isConstructorApplication || md.isQualifiedConstructorApplication ? "usage_contextual" : "structural"; continue }
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
  private startsWithWord(text: string, word: string): boolean {
    return text.length >= word.length && text.slice(0, word.length) === word
  }

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
