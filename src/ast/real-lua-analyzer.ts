// Pure-AST Lua analyzer — M12.32 extraction contract.
// Declarations and relationships come from Tree-sitter nodes/fields. No regex
// fallback or source-wide scanning is used.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface LuaFrame {
  callable?: string
  /**
   * M60 LUA-37: the RESOLVABLE owner of this frame — the container a symbol
   * declared in this body belongs to.
   *
   * `callable` is the LABEL: the full text a body belongs to, so
   * `function Buffer:initialize()` sets it to `"Buffer:initialize"`. That is
   * correct for a scope — a local inside that method is scoped to that method and
   * not to any other — but it is NOT a name any symbol is filed under, because
   * LUA-15 files the method itself as name `initialize` with owner `Buffer`.
   * Using the label as `ownerName` therefore produced owners that resolve to
   * nothing.
   *
   * Measured on 300 kong files: 23.0% of symbols carried a qualified
   * `ownerName`, and 22.6% of `contains` edges carried a qualified SOURCE — of
   * which 100% (2,175 of 2,175) named no symbol in the file. One relationship in
   * five could not be joined to a symbol, so a consumer walking from a symbol to
   * its members hit a wall for a fifth of the graph. The dedicated gate missed it
   * because it checks that a symbol's NAME is not a path, and never checked that
   * its OWNER resolves to one.
   *
   * So the frame carries both: the label for scope, the owner for identity.
   * `qualifiedName` on the symbol's metadata already preserves the full path for
   * display, so nothing is lost by making the owner resolvable.
   */
  owner?: string
  /**
   * M60 LUA-37: the enclosing function's own SYMBOL NAME — the thing a
   * `contains` edge must point at.
   *
   * For `function fs.appendFile(...)` the label is "fs.appendFile", the owner is
   * "fs", and the symbol this frame's body is filed under is named "appendFile".
   * A nested `function write` inside it is contained by the method, so the edge
   * must read `appendFile -> write`. Reading it from the label instead gave
   * `fs.appendFile -> write`, and "fs.appendFile" is not a symbol, so a consumer
   * walking from a symbol to its members could not follow 1,352 luvit edges and
   * 22.6% of kong's. The name is the only one of the three readings that
   * resolves, and the whole point of an edge source is that it can be followed.
   */
  selfName?: string
  localNames: Set<string>
  /**
   * M60 LUA-49: names bound by a for-clause, each carrying the loop's END offset so
   * the re-assignment test can ask whether that loop is still open. A bare
   * `localNames` entry cannot express this, because Lua scopes a loop variable to
   * the loop body and nothing else — the assignment after the loop is a different
   * binding. See `registerLoopBindings`.
   */
  loopBindings?: Array<{ name: string; endIndex: number }>
  /**
   * M60 LUA-20: true inside ANY function body, including a nameless closure.
   * `callable` cannot serve this purpose: a nameless closure at file scope has
   * no callable, so a guard written as `if (frame.callable)` never fires there
   * — which is exactly where a closure's `return` leaked out as a file export.
   * Keying the guard on a synthetic callable would fix the symptom by
   * fabricating a symbol; this records the fact that already exists.
   */
  inFunction: boolean
}

interface LuaContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  globalVariables: Set<string>
  declaredTables: Set<string>
  /** M60 LUA-35: file-scope returns that carry no NAME. A disclosure, never an export. */
  unpublishedSurface: Array<{ shape: string; detail: string | null; line: number; why: string }>
  frameworks: Set<string>
  patterns: Set<string>
  seenRelationships: Set<string>
  /** M60 LUA-02: counted during the walk, because the stored edge carries the callee FIELD ("create"), not the qualified path ("coroutine.create"). */
  coroutineCalls: number
  /** M60 LUA-44: every function/method declaration, as ONE label -> its declaration
   * lines. Ordered by LINE, not by visit order, because the walk pops a stack and
   * therefore visits siblings in reverse — "the later declaration replaces the
   * earlier one" is a claim about the source order, so it must be read off the
   * source order and never off the traversal. */
  declarationsByLabel: Map<string, Array<{ line: number; owner: string | null; member: string | null }>>
  /** M60 LUA-44: the tables whose members this file declares, keyed by owner, then
   * by member name -> the member's FIRST declaration line. The line is kept
   * because an `overrides` edge must be anchored at a site: a synthesized edge
   * with no line is indistinguishable from one the analyzer invented. */
  membersByOwner: Map<string, Map<string, number>>
  /** M60 LUA-44: derived table -> the tables its member lookup falls back to. Both
   * Lua inheritance forms land here, because both mean the same thing for an
   * override: `setmetatable(D, B)` (direct) and `setmetatable(D, {__index = B})`
   * (through a metatable). */
  supertypeLinks: Map<string, Set<string>>
  /** M60 LUA-51: every link `collectFactorySupertypeLinks` derived, keyed
   * `"derived|base"`, holding BOTH endpoint names and the LINE of the supertype
   * argument. An `extends` edge synthesized with no line is indistinguishable from
   * one the analyzer invented, which is the same reason `membersByOwner` keeps
   * first-declaration lines for `overrides` — and keeping the names in the value
   * rather than re-splitting the key is what stops this map being confused with
   * `supertypeLinks`, which holds two other conventions. */
  factorySupertypeLines: Map<string, { derived: string; base: string; line: number }>
}

export class RealLuaAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: LuaContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      globalVariables: new Set<string>(),
      declaredTables: new Set<string>(),
      unpublishedSurface: [],
      frameworks: new Set<string>(),
      patterns: new Set<string>(),
      seenRelationships: new Set<string>(),
      coroutineCalls: 0,
      declarationsByLabel: new Map(),
      membersByOwner: new Map(),
      supertypeLinks: new Map(),
      factorySupertypeLines: new Map(),
    }

    this.collectErrors(rootNode, ctx)
    // M60 LUA-06: BEFORE the walk, so a constructor call does not depend on
    // where its table was declared.
    this.collectDeclaredTables(rootNode, ctx)
    // M60 LUA-44: also BEFORE the walk, because a supertype link may be written
    // after the member that overrides it, and an override needs both sides.
    this.collectSupertypeLinks(rootNode, ctx)
    // M60 LUA-51: same reason, and it is a separate convention from the three
    // `collectSupertypeLinks` reads. Also BEFORE the walk.
    this.collectFactorySupertypeLinks(rootNode, ctx)
    const rootFrame: LuaFrame = { localNames: new Set<string>(), inFunction: false }
    const stack: { node: Node; frame: LuaFrame }[] = [{ node: rootNode, frame: rootFrame }]

    while (stack.length > 0) {
      const entry = stack.pop()!
      const node = entry.node
      const frame = entry.frame
      if (node.isMissing) continue

      this.processNode(node, frame, ctx)

      let childFrame = frame
      if (node.type === "function_declaration" || node.type === "function_definition") {
        // M60 LUA-20: an ANONYMOUS function establishes a scope too. Only
        // `function_declaration` used to, so a closure shared its enclosing
        // frame entirely, with two measured symptoms:
        //
        //  1. `extractExport`'s guard is `if (frame.callable) return`, so a
        //     closure at FILE scope had no callable and its internal
        //     `return x` was published as the FILE's export. Reproduced:
        //     `local t = { cb = function(x) return x end }` + `return { a = 1 }`
        //     published an export named "x" from inside the closure, while the
        //     file's real `return { a = 1 }` published nothing.
        //  2. A closure's own locals were attributed to the enclosing function:
        //     `local captured` inside `function() return captured end` nested in
        //     `outer` came out with ownerName "outer".
        //
        // A nameless closure has no identity of its own, so it keeps the
        // ENCLOSING callable as its label — inventing a synthetic one would
        // fabricate a symbol — but it gets its own localNames, so a local inside
        // a callback is not confused with one in the enclosing body.
        const functionName = node.type === "function_declaration" ? this.functionName(node) : undefined
        // M60 LUA-21: a closure SEES the enclosing scope's locals — that is what
        // a closure is. Starting from an empty set meant an assignment to an
        // UPVALUE looked like a new declaration. Measured at
        // luvit/deps/utils.lua:99, inside `function (e, ...) ... end` nested in
        // `local function adapt(c, fn, ...)`, the statement `c = nil` emitted
        // `contains adapt -> c` — an edge naming `c`, which has no symbol,
        // because `c` is a PARAMETER of adapt and parameters are not emitted as
        // symbols. The result was a containment edge pointing at nothing.
        // Inheriting the enclosing locals is also simply what the language says:
        // the assignment mutates adapt's parameter, it does not declare anything.
        //
        // REGRESSED AND RESTORED. This line was `new Set<string>(frame.localNames)`
        // and was changed to `new Set<string>()` by c82067ea, a commit titled
        // "test(xml): replace the differential's recall claim with an oracle-free
        // coverage gate" — an XML commit that touched the Lua analyzer and left
        // the paragraph above, which explains exactly why the inheritance is
        // required, still asserting it. The result was LUA-21 reintroduced, and it
        // was invisible to all seven dedicated gates: they read fixtures, and
        // LUA-21 only manifests on real code that writes to an enclosing local.
        //
        // The corpus differential caught it, and that is the only reason it was
        // caught at all: UNEXPLAINED 1 -> 44 and direct-path relationship SPURIOUS
        // 0 -> 42 on the 83-file slice, restored to 1 and 0 by this line. It is
        // the second time in two days that a stale-base commit has dropped Lua
        // analyzer work (41811754 records the first), and both times the comment
        // outlived the code it described.
        const locals = new Set<string>(frame.localNames)
        for (const parameter of this.extractParameters(node)) locals.add(parameter.name)
        if (functionName || node.type === "function_definition") {
          // M60 LUA-37: `callable` is the LABEL and `owner` is the resolvable
          // container. For `function Buffer:initialize()` the label is
          // "Buffer:initialize" — correct as a scope, and not a name any symbol
          // is filed under, because LUA-15 files the method as name `initialize`
          // with owner `Buffer`. An anonymous function has no name, so it inherits
          // the enclosing frame's owner, which is what keeps a local inside a
          // nameless closure attached to something that exists.
          const nameNode = node.childForFieldName("name")
          const bareOwner = (nameNode ? this.functionOwner(nameNode) : undefined) ?? functionName ?? frame.owner ?? frame.callable
          // The symbol name this body is filed under: the member's own name for a
          // method, the function's own name otherwise, and the enclosing frame's
          // for an anonymous closure — which has none of its own.
          const selfName = (nameNode ? this.splitMemberName(nameNode, functionName ?? "").name : functionName) || frame.selfName
          childFrame = {
            callable: functionName ?? frame.callable,
            owner: bareOwner,
            selfName,
            localNames: locals,
            inFunction: true,
          }
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, frame: childFrame })
      }
    }

    this.addContainsRelationships(ctx)
    // M60 LUA-51: BEFORE addOverrideRelationships, because that method reads
    // `supertypeLinks` and the factory links must already be in it.
    this.addFactorySupertypeEdges(ctx)
    this.addOverrideRelationships(ctx)
    const detectedFrameworks = [...ctx.frameworks]
    const detectedPatterns = [...ctx.patterns]

    return {
      language: "lua",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        // M60 LUA-35. Present ONLY when there is something to say, and every field
        // is derived from the parse: `shape` from the node type, `detail` from the
        // node's own text, `line` from its start position, `why` a fixed reason per
        // shape. Nothing here is a constant shaped like a measurement, which is the
        // LUA-11 rule — a count or score that did not vary with the file would be
        // worse than an absent field, and this is a list that is empty whenever the
        // module's surface is nameable.
        ...(ctx.unpublishedSurface.length ? { unpublishedSurface: ctx.unpublishedSurface } : {}),
        complexity: ctx.symbols.length + ctx.relationships.length,
        linesOfCode: this.lineCount(content),
        cyclomaticComplexity: this.calculateCyclomaticComplexity(rootNode),
        framework: detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns: detectedFrameworks.map((framework) => ({
          framework,
          patterns: [{ type: "usage", detected: true, description: `${framework} usage detected` }],
        })),
        architecturalInsights: this.generateArchitecturalInsights(ctx),
        architecturalScore: this.calculateArchitecturalScore(ctx),
        codeQuality: this.assessCodeQuality(ctx),
        hasTypeInference: false,
        // M60 LUA-11: performanceScore and memoryEfficiency were the literals
        // 85 and 85 — the two most checkable-looking numbers in this block and
        // the two that were invented. They are gone under those NAMES as well as
        // those values, because a derived number published as "performanceScore"
        // is still a lie: it claims to measure performance, and this analyzer
        // measures no time at all. What replaces them is named for what it is —
        // relationshipDensity and retainedRowKb — and each is either derived
        // from the analysed file or ABSENT.
        relationshipDensity: this.relationshipDensity(ctx),
        retainedRowKb: this.retainedRowKb(ctx),
        // M60 LUA-02: counted from the CALLS the walk actually saw, not from a
        // symbol flag nothing ever set — which made this a structural zero.
        coroutineUsage: this.countCoroutineSymbols(ctx),
        analysisVersion: "4.0.0-lua-m12.32",
      },
    }
  }

  private processNode(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    switch (node.type) {
      case "function_declaration":
        this.extractFunction(node, frame, ctx, this.isLocalFunction(node))
        break
      case "variable_declaration":
        if (this.isLocalVariableDeclaration(node)) this.extractLocalDeclaration(node, frame, ctx)
        break
      case "assignment_statement":
        this.extractAssignment(node, frame, ctx)
        break
      case "function_call":
        this.processCall(node, frame, ctx)
        break
      case "return_statement":
        this.extractExport(node, frame, ctx)
        break
      case "for_statement":
        // M60 LUA-49: a for-clause binds names, and the frame never heard of it.
        this.registerLoopBindings(node, frame)
        break
      case "identifier":
        this.detectFrameworks(node.text, ctx)
        // M60 LUA-40: `uses` — a name read as a value. See emitNameRead for why the
        // role is read off the PARENT and never off the text.
        this.emitNameRead(node, frame, ctx)
        break
      case "dot_index_expression":
      case "method_index_expression":
      case "bracket_index_expression":
        // M60 LUA-41: `references` — a member read. The three forms are the whole
        // set the grammar produces for a qualified name, and one node type is one
        // pass over the same role test.
        this.emitMemberRead(node, frame, ctx)
        break
    }
  }

  /**
   * M60 LUA-40 — `uses`: a name this scope READS.
   *
   * Measured before it was written (script/m60/lua-ontology-census.ts, probe
   * B4-bare-name-read): 295,019 bare-name reads across 3,250 corpus files. The
   * type was absent, so the largest read surface the language has was invisible.
   *
   * The rule is a ROLE, read off the parent node, never a text shape. Each
   * exclusion is a different relationship that is already published or is not a
   * declaration at all:
   *
   *   callee of a function_call      -> that is `calls`, published by processCall
   *   a `variable_list` child        -> a DECLARATION, published as a symbol and
   *                                     as `contains`
   *   the LHS of an assignment       -> a WRITE, not a read
   *   a `field`'s key                 -> a table-literal KEY, a declaration site
   *   a `function_declaration` name  -> a member DECLARATION
   *   the RECEIVER of an index expr  -> part of a qualified name; that read is
   *                                     `references` (LUA-41), and publishing both
   *                                     would double-count one fact under two labels
   *   a `parameters` child           -> a parameter BINDING, not a use of it
   *
   * Confidence is 0.9, not 1.0, and the reason is not a hedge: the node proves
   * the file READS A NAME. Which binding that name denotes — a local, an
   * upvalue, a global, a stdlib function, a field of a required module — is not
   * written anywhere in the tree. The machine-readable reason code the honesty
   * contract §4 requires for anything under 1.0 is `evidenceClass:
   * "usage_contextual"`, which is this codebase's existing word for a link
   * established by a NAME in a value position (real-css-analyzer.ts:737).
   */
  /**
   * M60 LUA-45: node identity, the only way that works on this runtime.
   *
   * `web-tree-sitter` returns a FRESH wrapper object on every access, so
   * `parent.namedChild(0) === node` is false even when both name the same span —
   * measured on validation/m14/fixtures/lua/name-reads.lua, where the receiver
   * test silently never fired and published 3 edges it exists to suppress:
   * `apply -> config` at L22, `apply -> helper` at L24 and `never -> helper` at
   * L29. Every one of them states a qualified access twice under two labels.
   *
   * The identity that IS stable is the SPAN, which is what this compares. It is
   * the family's own idiom and not a local invention: real-c-analyzer.ts:2336,
   * :2525 and :6012 all compare `startIndex`/`endIndex` for exactly this reason.
   * `type` is compared too because a span can be covered by more than one node
   * type in a grammar that reuses a token, and a wrong-type match here would
   * suppress a real edge.
   */
  private isSameNode(a: Node | null | undefined, b: Node | null | undefined): boolean {
    if (!a || !b) return false
    return a.type === b.type && a.startIndex === b.startIndex && a.endIndex === b.endIndex
  }

  private emitNameRead(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    const parent = node.parent
    if (!parent) return
    const pt = parent.type
    if (pt === "function_call") {
      if (this.isSameNode(parent.childForFieldName("name"), node) || this.isSameNode(parent.namedChild(0), node)) return
    } else if (pt === "variable_list" || pt === "parameters") {
      return
    } else if (pt === "assignment_statement") {
      if (this.isSameNode(parent.namedChild(0), node)) return
    } else if (pt === "field") {
      if (this.isSameNode(parent.childForFieldName("name"), node)) return
    } else if (pt === "function_declaration") {
      if (this.isSameNode(parent.childForFieldName("name"), node)) return
    } else if (pt === "dot_index_expression" || pt === "method_index_expression") {
      // M60 LUA-47: BOTH halves of a qualified name are excluded, and only the
      // receiver half used to be. `M.field` is a `dot_index_expression` whose
      // named children are the RECEIVER `M` and the FIELD `field`, so excluding
      // `namedChild(0)` alone left the field to reach `uses` as well — and
      // `emitMemberRead` publishes that same field as `references`, or
      // `processCall` publishes it as `calls`. One access, one span, two labels:
      //
      //   local v = tbl.member   ->  uses -> member       AND references -> member
      //   tbl:method()           ->  uses -> method       AND calls      -> method
      //   local v = tbl.inner.member -> uses -> inner, uses -> member,
      //                                references -> inner, references -> member
      //
      // Measured, 400 corpus files: 8,041 member edges carry BOTH a `uses` and a
      // `references` edge for the same member on the same line — 26.07% of every
      // `uses`+`references` edge on the corpus. Reproduce with
      // `npx tsx script/m60/lua-uses-references-double-publish.ts --cap 400`.
      //
      // It survived a reading because the exclusion is CORRECT and its COMMENT is
      // accurate — "the receiver head of a qualified name is not read on its own
      // account" is true, and it is about the head — so nothing asserted that the
      // field was covered, and the fixture that claims to pin this pair
      // (validation/m14/fixtures/lua/name-reads.expectation.json) forbids
      // `uses -> config` and `uses -> helper`, which are both RECEIVERS, and has
      // no row for `uses -> retries` or `uses -> record`, which are both FIELDS.
      // The suite was green on a defect it did not name. `validation/m14/fixtures/
      // lua/read-classes` now forbids all four, and the mutant in
      // script/m60/mutate-lua-read-classes.ts reinstates the old half-rule.
      //
      // The field of a `bracket_index_expression` is deliberately NOT excluded:
      // `tbl[key]` reads `key`, which is a VARIABLE holding the subscript, and
      // reading it is a real bare-name read. A literal `tbl["member"]` has a
      // `string` field, which never reaches here at all. That asymmetry is why the
      // two index forms are separate cases and not one.
      if (this.isSameNode(parent.namedChild(0), node)) return
      if (this.isSameNode(parent.namedChild(parent.namedChildCount - 1), node)) return
    } else if (pt === "bracket_index_expression") {
      // Receiver only — see the case above for why the field stays a `uses`.
      if (this.isSameNode(parent.namedChild(0), node)) return
    }
    this.addRelationship(
      ctx,
      frame.callable || "global",
      node.text,
      ASTEngine.RelationshipType.Uses,
      { luaSpecific: true, relationshipType: "lua_name_read" },
      node,
      { confidence: 0.9 },
    )
  }

  /**
   * M60 LUA-41 — `references`: a MEMBER of a table read without calling it.
   *
   * Measured first, the same way: probe B3-member-read counted 198,720 qualified
   * reads across 2,643 files. A qualified read is the shape the family's
   * `references` is for and the shape this lane was missing: css's `var(--x)`
   * asserts a dependency on a NAME that may be declared in another file, and
   * `M.field` asserts exactly that — `M` is written, `field` is written, and
   * which module owns `field` is not written anywhere.
   *
   * The same four exclusions as `calls`/`contains` already rely on, each for the
   * same reason: a member's CALLEE is a `calls` edge (processCall), a member's
   * DECLARATION is a symbol plus a `contains` edge, a member ASSIGNED TO is a
   * write, and a `field`'s key is a table-literal key.
   *
   * A COMPUTED index (`dao[method or context .. "_by_" .. endpoint_key]`) has no
   * name, and LUA-22's payload lesson applies unchanged: a literal STRING index
   * does (`dao["rows"]`, read as `rows`), a number and a variable-held key do not.
   *
   * The TARGET is the member's own field name, which is what every other lua edge
   * uses for a member (LUA-13/LUA-15: `obj:method()` yields target `method`), and
   * the RECEIVER is recorded in metadata so a consumer that needs the qualified
   * path has it without this edge having to claim an identity it cannot prove.
   * The cost of that choice is measured and declared: two tables in one file can
   * both have a member `run`, and the bare name fuses them. The qualified path is
   * recorded per edge, so the ambiguity is recoverable rather than lost.
   */
  private emitMemberRead(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    const parent = node.parent
    if (parent) {
      const pt = parent.type
      // LUA-45: span comparison, never `===` — see isSameNode.
      if (pt === "function_call" && (this.isSameNode(parent.childForFieldName("name"), node) || this.isSameNode(parent.namedChild(0), node))) return
      if (pt === "function_declaration" && this.isSameNode(parent.childForFieldName("name"), node)) return
      if (pt === "field" && this.isSameNode(parent.childForFieldName("name"), node)) return
      // M60 LUA-46: an assignment TARGET sits inside a `variable_list`, so the
      // `assignment_statement` exclusion below could never fire. Measured on the
      // wired grammar (script/m60/lua-grammar-shape.ts), `a = 1` parses as
      //
      //   assignment_statement {name=identifier}
      //     variable_list {name=identifier}
      //       identifier "a"
      //
      // so a target's PARENT is `variable_list`, and `namedChild(0)` of the
      // assignment_statement is that variable_list — never the target itself. The
      // exclusion was dead code on every write in the language, while the doc
      // comment above already claimed "a member ASSIGNED TO is a write". A comment
      // asserting a behaviour is not evidence that it exists; this lane has now
      // made that mistake twice (LUA-30, and here).
      //
      // MEASURED POPULATION over 3,252 corpus files: 84,354 assignment targets, of
      // which 69,521 are bare identifiers and 14,833 are QUALIFIED names. Each of
      // those 14,833 published a `references` edge for a member that was written
      // and never read — `memberlist_protocol.fields = 1` at
      // docker/contrib/wireshark/memberlist.lua:41, `pinfo.cols.protocol = proto`
      // at :126. That is 6.9% of the 214,155 member-shaped nodes in the corpus
      // stating a read that does not exist, and 4,461 of them duplicate a read of
      // the same member on the right-hand side of the same statement. Reproduce
      // with `npx tsx script/m60/lua-write-as-read.ts --full`.
      //
      // The same node type is a declaration's target list, so this also stops
      // `local x, y = 1, 2` from publishing a read of either bound name.
      if (pt === "variable_list") return
    }
    let member: string | undefined
    let memberNode: Node | undefined
    if (node.type === "bracket_index_expression") {
      const key = node.childForFieldName("field")
      if (key?.type !== "string") return
      member = this.stringValue(key)
      memberNode = key
    } else {
      const last = node.namedChildCount > 0 ? node.namedChild(node.namedChildCount - 1) : undefined
      if (last?.type !== "identifier") return
      member = last.text
      memberNode = last
    }
    if (!member || !memberNode) return
    const receiver = this.nameBearing(node.childForFieldName("table"))
    this.addRelationship(
      ctx,
      frame.callable || "global",
      member,
      ASTEngine.RelationshipType.References,
      {
        luaSpecific: true,
        relationshipType: "lua_member_read",
        ...(receiver ? { receiver } : {}),
      },
      memberNode,
      { confidence: 0.9 },
    )
  }

  private extractFunction(node: Node, frame: LuaFrame, ctx: LuaContext, isLocal: boolean): void {
    // M60 LUA-15: a member's identity is its container plus its own name, and
    // the two are recorded ONCE.
    //
    // This used to be `nameNode?.text`, which for `function Buffer:initialize()`
    // is the string "Buffer:initialize" — a PATH. So the symbol was filed as
    // name "Buffer:initialize" AND ownerName "Buffer" AND ownerKind Class: the
    // container stored twice, once inside the name. M49 W2's ruling is that a
    // member's identity is its container, not its bare name; the old shape
    // satisfied neither reading.
    //
    // The consequence was not cosmetic and is why this matters to a user: a call
    // edge carries the callee's own NAME (`obj:method()` yields target `method`,
    // see callee()), so it could never be joined to a declaration filed as
    // "Buffer:initialize". Call-to-declaration resolution failed for every
    // method in the language, silently — both sides looked well-formed.
    //
    // A declaration's name has three readings, and conflating them is how the
    // first version of the lua truth oracle reported its OWN bug as an analyzer
    // defect: the LABEL (full text — the scope a body belongs to), the NAME (the
    // field — the symbol's identity) and the OWNER (the receiver).
    const nameNode = node.childForFieldName("name") || node.namedChild(0)
    if (!nameNode) return // Anonymous function expressions are expression noise.
    const label = nameNode.text
    if (!label) return
    const { name, owner } = this.splitMemberName(nameNode, label)

    const parameters = this.extractParameters(node)
    const isMethod = !!owner
    // M60 LUA-19: `isLocal` tested for the `local` KEYWORD, which is not what
    // "local" means. A function declared without `local` but NESTED inside
    // another function is still lexically local to it:
    //
    //   local function spawn(...)        -- L72, spawn
    //     local onExit                   -- L74
    //     function onExit(code, signal)  -- L125  <- no `local` keyword
    //
    // was filed with scope "global" and a `contains global -> onExit` edge,
    // because the keyword test said "not local". The lua truth oracle found 47
    // such edges on luvit alone, every one of them a function nested inside
    // another. It is a scope-attribution defect, not a cosmetic one: `scope` is
    // what a consumer reads to decide where a symbol belongs, and a closure
    // declared inside `spawn` does not belong to the file's global scope.
    //
    // Calls INSIDE the nested function were already correct, which is why this
    // showed up only as unexplained `contains` edges and not as misattributed
    // calls: the walk sets childFrame.callable on the way in, so only the
    // symbol's own scope and the edge naming it used the keyword test.
    const lexicallyLocal = isLocal || !!frame.callable
    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: lexicallyLocal ? (frame.callable || "global") : "global",
      visibility: lexicallyLocal ? "private" : "public",
      parameters,
      ownerName: owner,
      ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
      // M60 LUA-37: the enclosing body's own symbol name, so a declaration nested
      // in this one can be contained BY IT rather than by its label. See
      // addContainsRelationships, which reads this and never reads `scope`.
      frameSelfName: frame.selfName,
      // qualifiedName keeps the full path, which is what it is FOR. The `name`
      // field is the identity; this is the path. Before the fix the path was
      // doing the identity's job and no path was recorded at all.
      qualifiedName: label,
      metadata: { luaSpecific: true, isLocal: lexicallyLocal, isMethod, ownerTable: owner, qualifiedName: label },
    }
    ctx.symbols.push(symbol)
    if (owner) {
      ctx.declaredTables.add(owner)
      ctx.patterns.add("Object-Oriented Programming")
      // M60 LUA-44: a member DECLARATION, which is what an `overrides` edge needs
      // on the overriding side. Recorded here, where the owner/member split has
      // already been made, rather than re-derived in the post-pass.
      const members = ctx.membersByOwner.get(owner) ?? new Map<string, number>()
      if (!members.has(name)) members.set(name, node.startPosition.row + 1)
      ctx.membersByOwner.set(owner, members)
    }
    // M60 LUA-44: the label is the IDENTITY (LUA-15's contract), so two
    // declarations of one label are two declarations of one name — which is
    // exactly what a redefinition is.
    const byLabel = ctx.declarationsByLabel.get(label) ?? []
    byLabel.push({ line: node.startPosition.row + 1, owner: owner ?? null, member: owner ? name : null })
    ctx.declarationsByLabel.set(label, byLabel)
    if (lexicallyLocal) ctx.globalVariables.delete(name)
  }

  // M60 LUA-15: split a declaration's name into its OWN name and its OWNER.
  //
  // In this grammar `function Buffer:initialize()` and `function
  // Buffer.readUInt8()` both put an index expression in the `name` field, with
  // the RECEIVER first and the FIELD last:
  //   method_index_expression
  //     table: (identifier "Buffer")
  //     :     (identifier "initialize")
  // so the field is the LAST named child and the receiver the first. Taking the
  // first yields "Buffer" — the table, not the method.
  private splitMemberName(nameNode: Node, label: string): { name: string; owner?: string } {
    if (nameNode.type !== "dot_index_expression" && nameNode.type !== "method_index_expression") {
      return { name: label }
    }
    const first = nameNode.namedChild(0)
    const last = nameNode.namedChildCount > 1 ? nameNode.namedChild(nameNode.namedChildCount - 1) : undefined
    const owner = first?.type === "identifier" ? first.text : undefined
    return { name: last?.text || label, owner }
  }

  private extractLocalDeclaration(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    // M60 LUA-00: this asked for a `name_list` field, which the pinned grammar
    // does not have. The real shape is
    //   variable_declaration > [anon `local`] > assignment_statement
    //     > variable_list [name=identifier, ...] > expression_list [value=...]
    // so the name list is a `variable_list` CHILD, reached by node TYPE, never
    // by a field name. The old `childForFieldName("name_list") ||
    // namedChild(0)` returned the anon `local` token here, and because
    // plainVariableName rejects non-identifiers the whole declaration was
    // silently dropped: `local c = 3` published no symbol at all.
    // M60 LUA-23: a variable_declaration has TWO shapes, and the LUA-00 fix
    // handled only one:
    //   local a, b = 1, 2  ->  variable_declaration > assignment_statement
    //                                  > variable_list + expression_list
    //   local solo         ->  variable_declaration > variable_list      (no
    //                           assignment_statement at all)
    // Reading namedChild(0) as the assignment and then looking for a
    // variable_list INSIDE it returned nothing for the second shape, so a bare
    // `local x` produced no symbol and no containment edge. It was already broken
    // before LUA-00 and survived that fix, because the corpus measurement was
    // byte-identical across the change and nothing asserted the shape. The
    // committed fixture lane caught it on its first run.
    const first = node.type === "variable_declaration" ? node.namedChild(0) : node
    const assignment = first?.type === "assignment_statement" ? first : undefined
    const variableList = assignment
      ? this.childOfType(assignment, "variable_list")
      : (first?.type === "variable_list" ? first : undefined)
    if (!variableList) return
    for (let i = 0; i < variableList.namedChildCount; i++) {
      const variable = variableList.namedChild(i)
      const name = this.plainVariableName(variable)
      if (!variable || !name) continue
      frame.localNames.add(name)
      // A bare `local x` has no assignment and therefore no value; the two
      // shapes differ here as well as at the lookup above.
      const value = assignment ? this.assignmentValue(assignment) : undefined
      const isTable = this.isTableNode(value)
      if (isTable) ctx.declaredTables.add(name)
      ctx.symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(variable),
        scope: frame.callable || "global",
        // M60 LUA-37: a declaration inside a body is contained by the FUNCTION whose
      // body it is, so the owner is that function's own name (`selfName`), not the
      // function's own owner. `function fs.appendFile()` has owner "fs" and self
      // "appendFile", and a local inside it must read `appendFile -> localName`:
      // "fs" is the owner of the METHOD, and using it filed the local as a sibling
      // of the method rather than a member of it, which cost 525 unexplained
      // contains edges on an 83-file kong slice.
      ownerName: frame.selfName ?? frame.owner ?? frame.callable,
        frameSelfName: frame.selfName,
        ownerKind: frame.callable ? ASTEngine.SymbolKind.Function : undefined,
        visibility: frame.callable ? "private" : "public",
        metadata: { luaSpecific: true, isLocal: true, isTable, tableFields: isTable ? this.tableFieldNames(value!) : [] },
      })
    }
  }

  /**
   * M60 LUA-49: a for-clause BINDS a name, and the frame never heard of it.
   *
   * `extractAssignment` suppresses a local re-assignment with
   * `frame.localNames.has(name)` — the one line standing between a re-assignment and
   * a fabricated declaration. `localNames` was filled from exactly one place,
   * `variable_declaration` (real-lua-analyzer.ts:649), so every OTHER binding form in
   * the language fell through it. A generic-for clause is the common one:
   *
   *     for _, line in ipairs(lines) do
   *       line = line:match("(.-)%%") or line     <- a re-assignment
   *     end
   *
   * `line` is bound by the clause, so the statement above re-assigns a local and
   * declares nothing. The analyzer had no record of the binding, published a
   * `variable` SYMBOL for it, and `addContainsRelationships` then published
   * `contains get_packages -> line` — a containment edge for a declaration that never
   * happened, sitting on the assignment's line rather than the clause's.
   *
   * Found by the ORACLE rather than by reading: `lua-truth-oracle.ts` records
   * for-clause names in `localsIn` (for its own LUA-26 exemption), so it correctly
   * declined to derive the re-assignment, and the two disagreed. Four unexplained
   * `contains` edges over ~600 corpus files, every one this shape:
   * `contains get_packages -> line` (snacks.nvim/lua/snacks/image/doc.lua:131),
   * `contains json -> item` (snacks.nvim/lua/snacks/picker/source/proc.lua:172),
   * and one each in kong and luarocks.
   *
   * WHAT THIS DOES NOT DO, stated because the omission is the other half of the
   * defect: the loop BINDING itself is still not published as a declaration. Lua
   * binds `line` there, and neither a symbol nor a `contains` edge says so — the
   * edge that used to appear was on the wrong line and for the wrong reason.
   * Publishing the binding is the larger change and it is not made here: `for k, v in
   * pairs(t)` is one of the most frequent constructs in Lua, so it is a symbol-count
   * and payload decision for the whole graph surface, not a lane-local fix. Reported
   * rather than done (§8 of the workstream, and limitation 14 of the doc).
   *
   * Scope: the name is recorded WITH THE LOOP'S END OFFSET, and the re-assignment
   * test asks whether that loop is still lexically open at the assignment. That is
   * not a refinement, it is the whole correctness of the rule: Lua scopes a loop
   * variable to the loop body, so
   *
   *     for _, v in ipairs(t) do v = f(v) end   -- a RE-assignment
   *     v = 5                                    -- a DIFFERENT binding
   *
   * are different facts. Recording the name in `localNames` unconditionally, which is
   * what the first version of this fix did, got the first line right and the second
   * one wrong: it suppressed 18 real `contains` edges on kong alone. The oracle caught
   * it as 18 MISSING, which is the oracle working — it derives the post-loop
   * assignment because the loop really has closed.
   *
   * Lua has no block scope for locals — a `do ... end` does not open one — so the
   * binding goes in the ENCLOSING FUNCTION's frame rather than a block frame, and the
   * loop's own extent is what bounds it. At file scope `frame.callable` is undefined
   * and `extractAssignment`'s existing `frame.callable &&` guard still lets a
   * file-scope assignment declare a global, which is correct: after
   * `for _, v in ...` ends at file scope, `v = 5` assigns a global.
   */
  private registerLoopBindings(node: Node, frame: LuaFrame): void {
    const clause = node.namedChild(0)
    if (!clause) return
    const end = node.endIndex
    const add = (n: Node | null): void => {
      if (n?.type !== "identifier") return
      let list = frame.loopBindings
      if (!list) frame.loopBindings = list = []
      list.push({ name: n.text, endIndex: end })
    }
    if (clause.type === "for_numeric_clause") {
      add(clause.childForFieldName("name"))
      return
    }
    if (clause.type !== "for_generic_clause") return
    for (let i = 0; i < clause.namedChildCount; i++) {
      const list = clause.namedChild(i)
      if (list?.type !== "variable_list") continue
      for (let j = 0; j < list.namedChildCount; j++) add(list.namedChild(j))
    }
  }

  /** Is `name` bound by a for-clause whose loop is still open at byte offset `at`? */
  private inOpenLoopBinding(frame: LuaFrame, name: string, at: number): boolean {
    const list = frame.loopBindings
    if (!list) return false
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].name === name && at < list[i].endIndex) return true
    }
    return false
  }

  private extractAssignment(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    if (node.parent?.type === "variable_declaration" && this.isLocalVariableDeclaration(node.parent)) return
    // M60 LUA-00: `name_list` is not a field in this grammar; the name list is
    // a `variable_list` child (see extractLocalDeclaration for the full shape).
    const variableList = this.childOfType(node, "variable_list")
    if (!variableList) return
    const value = this.assignmentValue(node)
    for (let i = 0; i < variableList.namedChildCount; i++) {
      const variable = variableList.namedChild(i)
      const name = this.plainVariableName(variable)
      if (!variable || !name) continue // field/table mutations are not declarations
      // The `frame.callable &&` guard covers the LOCAL case only, and must NOT cover the
      // loop case. At file scope, `x = 1` with no `local` assigns a GLOBAL and does
      // declare a symbol — that is the language's rule and it is why the guard
      // exists. But a for-clause binds a real local at file scope too, so
      //
      //   for _, v in ipairs(X) do
      //     _, v = next(v)          <- a RE-assignment, at FILE SCOPE
      //   end
      //
      // declares nothing. Folding the loop test inside the guard exempted file-scope
      // loops and published 7 fabricated `contains` edges over the 4-repo oracle draw
      // — `contains global -> _` and `-> v` at
      // kong/db/schema/entities/clustering_data_planes.lua:7, `contains global -> l`
      // at plenary.nvim/lua/plenary/scandir.lua:22, and four more. The oracle found
      // all seven, in one shape, which is the strongest evidence available that the
      // rule is one rule and not seven.
      if ((frame.callable && frame.localNames.has(name)) || this.inOpenLoopBinding(frame, name, node.startIndex)) continue // local re-assignment
      const isTable = this.isTableNode(value)
      if (isTable) ctx.declaredTables.add(name)
      ctx.symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(variable),
        scope: frame.callable || "global",
        ownerName: frame.selfName ?? frame.owner ?? frame.callable,
        frameSelfName: frame.selfName,
        ownerKind: frame.callable ? ASTEngine.SymbolKind.Function : undefined,
        visibility: frame.callable ? "private" : "public",
        metadata: { luaSpecific: true, isGlobal: !frame.callable, isTable, tableFields: isTable ? this.tableFieldNames(value!) : [] },
      })
      if (!frame.callable) ctx.globalVariables.add(name)
    }
  }

  private processCall(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    // M60 LUA-01: there is no `function` field on a function_call in this
    // grammar. The callee is the call's `name` field, and it is either a plain
    // identifier (`require(...)`) or an index expression (`M.new(...)`,
    // `obj:method(...)`). The old `childForFieldName("function") || ... ||
    // namedChild(0)` reached the right node only by accident, through the
    // fallback, which is exactly the arrangement that hid the other four.
    const functionNode = node.childForFieldName("name") || node.namedChild(0)
    if (!functionNode) return
    // M60 LUA-13: `node.text` on a multi-line callee is a SOURCE SNIPPET, not
    // a name. `obj\n  .method()` yields the 4-character-per-line text
    // "obj\n  .method", which is not a symbol, cannot be matched to a
    // declaration, and is dropped downstream by the pool-worker's garbage-target
    // filter (src/ast/pool-worker.ts:391 rejects any target containing a
    // newline). Measured consequence: writing the identical call on one line
    // produced the edge `caller2 -> obj.method` and splitting it across two
    // lines produced NO EDGE AT ALL. So the bug is not merely an ugly name — it
    // silently deletes a call from the graph, and line breaks are ordinary in
    // real Lua.
    //
    // The fix is to read the callee's NAME from its structure: an index
    // expression is `table <op> field`, so the symbol is the field, and the
    // receiver is kept in metadata rather than concatenated into the name. The
    // line still comes from the name-bearing node, which is unchanged.
    const callee = this.callee(functionNode)
    if (!callee) return
    const callName = callee.name
    // IDENTITY is the field; a NAME MATCH is the qualified path. Conflating them
    // is a regression this lane already made once: the LUA-13 fix made the edge
    // target the callee's field, which silently killed every check comparing
    // callName against a dotted name — including the Coroutines pattern, dead
    // from wave 2 until the LUA-02 gate caught it. `coroutine.create(f)` has
    // identity "create" and qualified name "coroutine.create", and only the
    // second can be matched against a library.
    const qualified = functionNode.text
    this.detectFrameworks(qualified, ctx)

    const values = this.callArguments(node)
    const firstString = this.stringValue(values[0])
    if (callName === "require" || callName === "module") {
      if (firstString) this.addImport(firstString, frame, node, ctx)
      return
    }
    if (callName === "pcall" || callName === "xpcall") {
      if (values[0]?.text === "require") {
        const moduleName = this.stringValue(values[1])
        if (moduleName) this.addImport(moduleName, frame, node, ctx)
      }
    }

    const source = frame.callable || "global"
    if (callName !== "pcall" && callName !== "xpcall") {
      this.addRelationship(ctx, source, callName, ASTEngine.RelationshipType.Calls, { luaSpecific: true }, callee.nameNode)
    }

    if (qualified === "coroutine.create" || qualified === "coroutine.wrap") {
      ctx.patterns.add("Coroutines")
      ctx.coroutineCalls++
    }
    if (callName === "setmetatable") {
      ctx.patterns.add("Object-Oriented Programming (Metatables)")
      const target = values[0]
      const metatable = values[1]
      // M60 LUA-32: BOTH arguments must be names, not expressions. The guard below
      // only ever checked the first argument, so `setmetatable(self, { __index =
      // super })` published `extends self -> { __index = super }` — the whole
      // table constructor as the TARGET. Two measured losses on kong:
      // `self -> { __index = super }` at kong/db/dao/init.lua:990 and
      // `_M -> { __call = ..., __index = ... }` at kong/cmd/utils/log.lua:88, whose
      // target spans five lines.
      //
      // That second one is why this hid for so long: the target contains NEWLINES,
      // and pool-worker's target filter rejects any target containing one, so the
      // edge never reached the store. Through the pipeline the defect was
      // INVISIBLE — the edge was simply absent, indistinguishable from an edge that
      // was never derived. It surfaced only from the direct-path/pipeline seam
      // probe added in LUA-31, which compares the two paths per file and reports
      // labels the pipeline drops. Same defect class as LUA-29 on a path LUA-29's
      // whitelist never touched.
      const srcName = this.nameBearing(target)
      const mtName = this.nameBearing(metatable)
      // M60 LUA-48: a table is not its own base. `setmetatable(M, M)` sets M's
      // metatable to itself — an idiom for making a module table self-referential,
      // not an inheritance relation — and the guard published `extends M -> M`, a
      // type relation the language cannot express.
      //
      // Measured by script/m60/lua-labelling-audit.ts over the whole 3,252-file draw:
      // 2 self-edges on `extends`, both of this shape —
      // `return setmetatable(M, M)` at lazy.nvim/lua/lazy/state.lua:45 and
      // `local ret = setmetatable(M, M)` at trouble.nvim/lua/trouble/cache.lua:59 —
      // at confidence 1.0 and `evidenceClass: structural`, i.e. asserted as parse
      // facts. A fabricated edge is what poisons `bb_graph`, `bb_impact` and
      // `bb_migrate`: `extends M -> M` reads downstream as "M inherits from M",
      // which is a cycle no refactoring advice should be built on.
      //
      // The same audit found 3 `contains` self-edges that are NOT this defect and are
      // deliberately left alone: `function sum.sum(a, b)` at
      // luarocks/spec/fixtures/busted_project/sum.lua:3 is a method named `sum` on
      // owner `sum`, and a Lua table may carry a member with its own name. The
      // distinction is whether the relation is TYPE-TO-TYPE or CONTAINER-TO-MEMBER,
      // and only the first is inexpressible.
      if (target && metatable && !this.isTableNode(target) && srcName && mtName && srcName !== mtName) {
        this.addRelationship(ctx, srcName, mtName, ASTEngine.RelationshipType.Extends, { luaSpecific: true, relationshipType: "lua_metatable" }, metatable)
      }
      if (metatable?.type === "identifier") {
        const tableName = metatable.text
        ctx.declaredTables.add(tableName)
      }
    }

    const constructor = this.constructorTarget(functionNode, ctx)
    if (constructor) {
      this.addRelationship(ctx, source, constructor, ASTEngine.RelationshipType.Instantiates, { luaSpecific: true, relationshipType: "instantiates" }, callee.nameNode)
    }

    if (callName === "class" || qualified === "Object:extend" || qualified === "Object.extend") {
      const className = firstString
      if (className) {
        ctx.symbols.push({
          name: className,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          scope: source,
          ownerName: frame.selfName ?? frame.owner ?? frame.callable,
        frameSelfName: frame.selfName,
          metadata: { luaSpecific: true, isLibraryClass: true },
        })
      }
      ctx.patterns.add("Object-Oriented Programming (Libraries)")
    }
  }

  private addImport(moduleName: string, frame: LuaFrame, node: Node, ctx: LuaContext): void {
    ctx.imports.push({
      module: moduleName,
      items: [],
      isDefaultImport: true,
      isNamespaceImport: false,
      range: this.nodeToRange(node),
      metadata: { luaSpecific: true },
    })
    this.addRelationship(ctx, frame.callable || "global", moduleName, ASTEngine.RelationshipType.Imports, { luaSpecific: true, relationshipType: "lua_require" }, node)
    // A required module name is a real signal and is kept. The bare-identifier
    // rules (World of Warcraft's CreateFrame/UIParent, Wireshark's
    // Proto/DissectorTable) are NOT reproduced here: those are globals that any
    // file may define, and LUA-04 measured exactly that failure.
    if (moduleName.startsWith("resty")) ctx.frameworks.add("OpenResty")
    if (moduleName === "socket" || moduleName === "lfs" || moduleName === "cjson" || moduleName === "ssl") ctx.frameworks.add("LuaRocks Core Modules")
    if (moduleName === "lapis") ctx.frameworks.add("Lapis")
    if (moduleName === "middleclass" || moduleName === "classic" || moduleName === "30log") ctx.patterns.add("Object-Oriented Programming (Libraries)")
    if (moduleName === "hs" || moduleName.startsWith("hs.")) ctx.frameworks.add("Hammerspoon")
    if (moduleName.startsWith("lovr")) ctx.frameworks.add("LÖVR (VR/AR)")
  }

  // M60 LUA-06: this was ORDER-DEPENDENT, and therefore wrong. `declaredTables`
  // was filled during the same single traversal that read it, so whether a
  // constructor call produced an edge depended on whether the table's
  // declaration happened to appear EARLIER IN THE FILE. Proven by probe, with
  // the two files differing only in statement order:
  //
  //   local A = {}            A.new()
  //   function A.new() end    local A = {}
  //   A.new()                 function A.new() end
  //
  //   first  -> instantiates global->A   (edge present)
  //   second -> NO EDGE                  (same semantics, no edge)
  //
  // A relationship that depends on where its declaration sits is not a fact
  // about the program, it is a fact about the traversal. The fix is a PRE-PASS:
  // collect every name this file binds to a table, before any call is examined.
  // One traversal, order-independent.
  private constructorTarget(functionNode: Node, ctx: LuaContext): string | undefined {
    if (!["dot_index_expression", "method_index_expression"].includes(functionNode.type)) return undefined
    const method = functionNode.childForFieldName("method") || functionNode.childForFieldName("field")
    const table = functionNode.childForFieldName("table")
    if ((method?.text === "new" || method?.text === "constructor") && table?.text && ctx.declaredTables.has(table.text)) return table.text
    return undefined
  }

  // M60 LUA-06: collect the file's table-valued names BEFORE the walk, so a
  // constructor call does not depend on the order of the declaration.
  private collectDeclaredTables(root: Node, ctx: LuaContext): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "variable_declaration" || node.type === "assignment_statement") {
        const inner = node.type === "variable_declaration" ? node.namedChild(0) : node
        const list = inner?.type === "assignment_statement" ? inner.namedChild(0) : undefined
        const values = inner?.type === "assignment_statement" ? inner.namedChild(1) : undefined
        const first = values?.namedChild(0)
        if (list?.type === "variable_list" && first?.type === "table_constructor") {
          for (let i = 0; i < list.namedChildCount; i++) {
            const id = list.namedChild(i)
            if (id?.type === "identifier") ctx.declaredTables.add(id.text)
          }
        }
      }
      if (node.type === "function_declaration") {
        const nm = node.childForFieldName("name")
        if (nm && (nm.type === "dot_index_expression" || nm.type === "method_index_expression")) {
          const recv = nm.namedChild(0)
          if (recv?.type === "identifier") ctx.declaredTables.add(recv.text)
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) stack.push(c) }
    }
  }

  /**
   * M60 LUA-44: derived table -> the tables its member lookup falls back to.
   *
   * Lua has NO inheritance keyword, so a grammar inventory can never find this
   * relation — it is a CONVENTION over three ordinary constructs, and the
   * ontology-coverage gate's own json ruling says in as many words that a grammar
   * cannot see a convention. All three forms are read here because all three mean
   * the same thing for an override:
   *
   *   setmetatable(D, B)            D's members fall back to B's  (direct)
   *   setmetatable(D, {__index = B})  the same, through an inline metatable
   *   local Mt = {__index = B}; setmetatable(D, Mt)   the same, through a named
   *                                    metatable — kong's idiom, and the shape
   *                                    probe B2 actually found
   *   D.__index = B                 the same, assigned after the fact
   *
   * The named-metatable form needs TWO HOPS and is why this method does not simply
   * read the second argument: `setmetatable(_lmdb, _lmdb_mt)` names a METATABLE,
   * and reading it as a supertype would make every metatable in the corpus look
   * like a base class. Resolving `Mt -> Mt.__index -> Base` is the difference
   * between the two, and it is a derivation over parse facts rather than a guess:
   * both hops are written in the file.
   *
   * The third form is deliberately absent from the B2 probe in
   * script/m60/lua-ontology-census.ts, which reads only the inline
   * `setmetatable` forms and therefore UNDER-counts (1 occurrence). That probe is
   * the falsifiable instrument for the ruling; this is the analyzer's wider read,
   * and the gap between them is disclosed rather than reconciled by widening the
   * probe until the numbers agree.
   */
  private collectSupertypeLinks(root: Node, ctx: LuaContext): void {
    const link = (derived: string | undefined, base: string | undefined): void => {
      if (!derived || !base || derived === base) return
      if (ctx.declaredTables.has(derived) || ctx.declaredTables.has(base)) {
        const set = ctx.supertypeLinks.get(derived) ?? new Set<string>()
        set.add(base)
        ctx.supertypeLinks.set(derived, set)
      }
    }
    /** The `__index = Base` field of a table literal, or undefined. The `field`
     * node's KEY is the role test, so a table literal that merely CONTAINS the
     * string "__index" as a value cannot match. */
    const indexField = (table: Node | null | undefined): string | undefined => {
      if (table?.type !== "table_constructor") return undefined
      for (let i = 0; i < table.namedChildCount; i++) {
        const f = table.namedChild(i)
        if (f?.type !== "field") continue
        const key = f.childForFieldName("name") ?? f.namedChild(0)
        const value = f.namedChild(1)
        if (key?.text === "__index" && value?.type === "identifier") return value.text
      }
      return undefined
    }
    /** Metatable variable -> the table its `__index` names. */
    const metatableIndex = new Map<string, string>()
    /** Deferred, because a metatable variable may be DEFINED AFTER the
     * `setmetatable` call that uses it, and this walk is a stack, not source order. */
    const pending: Array<{ derived: string | undefined; second: Node | null | undefined }> = []
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "function_call") {
        const fn = node.childForFieldName("name")
        const args = node.childForFieldName("arguments")
        if (fn?.type === "identifier" && (fn.text === "setmetatable" || fn.text === "setmetatable2")) {
          const a0 = args?.namedChild(0) ?? null
          pending.push({ derived: a0?.type === "identifier" ? a0.text : undefined, second: args?.namedChild(1) ?? null })
        }
      }
      if (node.type === "variable_declaration" || node.type === "assignment_statement") {
        const inner = node.type === "variable_declaration" ? node.namedChild(0) : node
        if (inner?.type === "assignment_statement") {
          const list = inner.namedChild(0)
          const values = inner.namedChild(1)
          const table = values?.type === "expression_list" ? values.namedChild(0) : undefined
          const base = indexField(table)
          if (base && list?.type === "variable_list") {
            for (let i = 0; i < list.namedChildCount; i++) {
              const id = list.namedChild(i)
              if (id?.type === "identifier") metatableIndex.set(id.text, base)
            }
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) stack.push(c) }
    }
    // Resolve the deferred sites now that every metatable variable is known.
    for (const site of pending) {
      const second = site.second
      if (second?.type === "identifier") {
        // A NAMED metatable: follow its `__index` if it has one, otherwise the
        // second argument IS the base (`setmetatable(D, B)`).
        link(site.derived, metatableIndex.get(second.text) ?? second.text)
      } else {
        const base = indexField(second)
        if (base) link(site.derived, base)
      }
    }
    // `D.__index = Base` — the metamethod field assigned after the fact.
    const stack2: Node[] = [root]
    while (stack2.length > 0) {
      const node = stack2.pop()!
      if (node.type === "assignment_statement") {
        const list = node.namedChild(0)
        const values = node.namedChild(1)
        const lhs = list?.type === "variable_list" ? list.namedChild(0) ?? null : null
        const rhs = values?.type === "expression_list" ? values.namedChild(0) ?? null : null
        if (
          (lhs?.type === "dot_index_expression" || lhs?.type === "method_index_expression") &&
          lhs.namedChild(lhs.namedChildCount - 1)?.text === "__index" &&
          rhs?.type === "identifier"
        ) {
          const receiver = lhs.namedChild(0)
          link(receiver?.type === "identifier" ? receiver.text : undefined, rhs.text)
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) stack2.push(c) }
    }
  }

  /**
   * M60 LUA-51 — a WRITTEN supertype CLAUSE, expressed as an ordinary call argument.
   *
   * MEASURED BEFORE THIS METHOD EXISTED (script/m60/lua-supertype-arg-probe.ts, over
   * the 3,250 admitted corpus files): 7 written supertype arguments across 5 files,
   * of which 2 are inheritance and neither was emitted. The two:
   *
   *   luarocks/vendor/argparse.lua:277   local Command = class({...}, {...}, Parser)
   *   luarocks/vendor/argparse.lua:328   local Option  = class({...}, {...}, Argument)
   *
   * `extends` read only `setmetatable` (real-lua-analyzer.ts:924) and the `class`
   * branch read only `firstString`, the class's own NAME — so a parent passed in ANY
   * argument position was invisible.
   *
   * ## Why the position is READ and not GUESSED
   *
   * The obvious implementation is "the third argument of a `class` call is the
   * parent", and it is wrong in a way the corpus demonstrates: middleclass's own form
   * is `class("Name", Super)` — second position — and luarocks' is
   * `class(prototype, properties, parent)` — third. A fixed index publishes a wrong
   * edge for one of them and misses the other.
   *
   * So the position comes from the CALLEE'S OWN PARAMETER LIST, which the same file
   * writes down:
   *
   *   local function class(prototype, properties, parent)
   *                        0           1          2      <- the parent slot
   *
   * A parameter whose NAME states the supertype role (`parent`, `super`, `base`,
   * `supertype`, `superclass`, …) identifies its own slot. If the file does not
   * declare such a parameter there is nothing to read, and no edge is published — so
   * the rule cannot invent a relation from a call that never claimed one.
   *
   * ## Why this is `extends` and not `implements`
   *
   * Because the callee's body composes the parent into the object it returns:
   *
   *   if parent then cl.__prototype = deep_update(deep_update({}, parent.__prototype), prototype)
   *
   * The new class's prototype is built FROM the parent's. That is inheritance, and it
   * is the same relation the `setmetatable` forms already publish, so it carries the
   * same label and feeds the same `supertypeLinks` map that `overrides` reads.
   *
   * ## Confidence
   *
   * 0.95, `usage_contextual` — NOT 1.0 and NOT `structural`, and deliberately so.
   * Both endpoint NAMES are written in the file, which is what earns `extends` 1.0
   * elsewhere; what is a convention rather than a fact is the ROLE: that a parameter
   * named `parent` means the supertype. `overrides`' `lua_inherited_member` takes the
   * same 0.95 for the same reason and cites the same family precedent
   * (real-objective-c-analyzer.ts:1020). The corpus shows the cost of reading it as
   * certain: `snacks.nvim/lua/snacks/layout.lua` and three other files declare a
   * `parent` parameter for TREE TRAVERSAL (`_each(widget, parent)`,
   * `add(result, parent)`), and the probe returns all 5 of those alongside the 2 real
   * ones.
   *
   * So the read is narrowed to the case the corpus proves is inheritance: the factory
   * must be ASSIGNED to a top-level name, because `local Command = class(...)` is what
   * makes the edge's SOURCE a name a consumer can follow, and the derived and base
   * names must differ.
   */
  private collectFactorySupertypeLinks(root: Node, ctx: LuaContext): void {
    const SUPERTYPE_ROLES = new Set([
      "parent", "super", "base", "supertype", "superclass", "super_class", "parentclass", "parent_class",
    ])
    /** Parameter names of a `parameters` node, in order. `...` is a
     * `vararg_expression` and is not a slot, so it is skipped rather than counted. */
    const paramNames = (params: Node | null): string[] => {
      const out: string[] = []
      if (!params) return out
      for (let i = 0; i < params.namedChildCount; i++) {
        const c = params.namedChild(i)
        if (!c) continue
        if (c.type === "identifier") out.push(c.text)
        else if (c.type === "vararg_expression") continue
        else out.push("")
      }
      return out
    }
    // Does the factory fold `param` into a METAMETHOD field of the object it builds?
    // That is what inheritance means in Lua, and it is the only discriminator the
    // corpus supports — the parameter NAME is not one, because `parent` is also the
    // ordinary name for a tree-traversal argument.
    //
    // Two shapes, both written in real code:
    //
    //   (a) `parent.__prototype`          luarocks/vendor/argparse.lua:41
    //   (b) `cl.__super = parent`         the same relation, other spelling
    //
    // A parameter role alone is satisfied by five call sites in the corpus that are
    // plain recursion over a tree — `_each(widget, parent)` at
    // snacks.nvim/lua/snacks/layout.lua:186, `add(result, parent)` at
    // snacks.nvim/lua/snacks/picker/source/lsp/init.lua:379 and three more — and
    // publishing `extends` for those asserts that a widget's parent is a supertype.
    const foldsIntoMetamethod = (fn: Node, param: string): boolean => {
      let found = false
      const isRole = (n: Node | null | undefined): boolean => n?.type === "identifier" && n.text === param
      const visit = (n: Node): void => {
        if (found) return
        // (a) `param.__x`
        if (n.type === "dot_index_expression" || n.type === "method_index_expression") {
          if (isRole(n.namedChild(0))) {
            const last = n.namedChild(n.namedChildCount - 1)
            if (last?.text?.startsWith("__")) { found = true; return }
          }
        }
        // (b) `x.__y = param`
        if (n.type === "assignment_statement") {
          const lhs = n.namedChild(0)
          const lhsNode = lhs?.type === "variable_list" ? lhs.namedChild(0) : undefined
          if (lhsNode && (lhsNode.type === "dot_index_expression" || lhsNode.type === "method_index_expression")) {
            const field = lhsNode.namedChild(lhsNode.namedChildCount - 1)
            const rhs = n.namedChild(1)
            const rhsNode = rhs?.type === "expression_list" ? rhs.namedChild(0) : undefined
            if (field?.text?.startsWith("__") && isRole(rhsNode)) { found = true; return }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
      }
      // Skip the `parameters` node itself so a default value cannot self-satisfy.
      const body = fn.childForFieldName("body") ?? fn
      for (let i = 0; i < body.namedChildCount; i++) { const c = body.namedChild(i); if (c) visit(c) }
      return found
    }

    // Pass 1 — the names this file binds a factory to, keeping only the factories
    // whose body folds the role parameter into a metamethod. A `function M.foo()`
    // binds a FIELD, which is not a call target, so only a plain `function foo()` /
    // `local function foo()` counts.
    const factoryParams = new Map<string, string[]>()
    const stack0: Node[] = [root]
    while (stack0.length > 0) {
      const node = stack0.pop()!
      if (node.type === "function_declaration" || node.type === "function_definition") {
        const nameNode = node.childForFieldName("name")
        if (nameNode?.type === "identifier" && nameNode.text && !factoryParams.has(nameNode.text)) {
          const ps = paramNames(node.childForFieldName("parameters"))
          if (ps.some((p) => SUPERTYPE_ROLES.has(p.toLowerCase()) && foldsIntoMetamethod(node, p))) {
            factoryParams.set(nameNode.text, ps)
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) stack0.push(c) }
    }
    if (factoryParams.size === 0) return

    // Pass 2 — calls to those factories, and the name each result is bound to. The
    // binding is read from the ENCLOSING declaration, so the edge's source is a name
    // and not a temporary.
    const stack1: Node[] = [root]
    while (stack1.length > 0) {
      const node = stack1.pop()!
      if (node.type === "variable_declaration" || node.type === "assignment_statement") {
        const inner = node.type === "variable_declaration" ? node.namedChild(0) : node
        const call = inner?.type === "assignment_statement" ? inner.namedChild(1) : node
        const value = call?.type === "expression_list" ? call.namedChild(0) : undefined
        if (value?.type === "function_call" && inner) {
          const callee = value.childForFieldName("name")
          const args = value.childForFieldName("arguments")
          if (callee?.type === "identifier" && args) {
            const ps = factoryParams.get(callee.text)
            if (ps) {
              const list = inner.namedChild(0)
              const derived = list?.type === "variable_list" ? list.namedChild(0) : undefined
              const derivedName = derived?.type === "identifier" ? derived.text : undefined
              ps.forEach((p, slot) => {
                if (!SUPERTYPE_ROLES.has(p.toLowerCase())) return
                const argNode = args.namedChild(slot)
                if (argNode?.type !== "identifier") return
                const baseName = argNode.text
                if (!derivedName || derivedName === baseName) return
                const existing = ctx.supertypeLinks.get(derivedName) ?? new Set<string>()
                existing.add(baseName)
                ctx.supertypeLinks.set(derivedName, existing)
                ctx.factorySupertypeLines.set(`${derivedName}|${baseName}`, {
                  derived: derivedName, base: baseName, line: argNode.startPosition.row + 1,
                })
              })
            }
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) stack1.push(c) }
    }
  }

  /**
   * M60 LUA-51 — publish the `extends` edge for a factory supertype clause.
   *
   * `extends` was emitted only from the `setmetatable` call site, so a link collected
   * by `collectFactorySupertypeLinks` reached `overrides` and nothing else. This runs
   * beside it and emits the same relation, deduplicated against the `extends` edges
   * already in the result so a link both readers find is published once.
   *
   * It iterates `factorySupertypeLines` and NOT `supertypeLinks`, and that is the whole
   * correction. The first version walked `supertypeLinks`, which is the union of THREE
   * conventions, and so published the third one — `D.__index = Base` — under this
   * method's `lua_factory_supertype` label. Measured on the file that exposed it:
   *
   *   luarocks/vendor/argparse.lua:99   class_metatable.__index = parent
   *
   * produced `class_metatable -[extends 0.95 lua_factory_supertype]-> parent` — a link
   * the walk had deliberately never published, carrying a label that says "factory" for
   * a construct with no factory in it. `factorySupertypeLines` is keyed only by links
   * `collectFactorySupertypeLinks` created, so iterating it cannot reach the other two.
   */
  private addFactorySupertypeEdges(ctx: LuaContext): void {
    const seen = new Set<string>()
    for (const e of ctx.relationships) {
      if (e.type !== ASTEngine.RelationshipType.Extends) continue
      seen.add(`${e.source}|${e.target}`)
    }
    for (const [key, link] of ctx.factorySupertypeLines) {
      const { derived, base, line } = link
      if (seen.has(key)) continue
      seen.add(key)
      // `evidenceClass` rides in the metadata rather than the options because
      // `addRelationship` derives it from the TYPE alone (`evidenceClassFor`: anything
      // that is not imports/references/uses is `structural`), and a 0.95 edge must not
      // claim `structural`. Its own spread lands after the derived value, so this wins.
      this.addRelationship(
        ctx,
        derived,
        base,
        ASTEngine.RelationshipType.Extends,
        { luaSpecific: true, relationshipType: "lua_factory_supertype", evidenceClass: "usage_contextual" },
        null,
        { confidence: 0.95, symbolRange: { startLine: line } },
      )
    }
  }

  private extractExport(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    // M60 LUA-20: the guard is "inside any function", not "has a callable" — a
    // nameless closure at file scope has no callable and its `return` was
    // published as the FILE's export.
    if (frame.inFunction) return
    // M60 LUA-00: `return_statement` has no `expression_list` FIELD in this
    // grammar — the expression list is a child of that TYPE. The old lookup
    // returned the anon `return` token, so `values?.namedChild(0)` was
    // undefined and EVERY top-level `return <name>` published no export. The
    // two-file differential never saw it because its fixture returns a name the
    // suite did not assert on.
    const values = this.childOfType(node, "expression_list")
    const target = values?.namedChild(0)
    if (!target) return
    // M60 LUA-42: the module SURFACE is a relationship, not only a list.
    // `exports` was measured at 0 edges over 3,250 corpus files while this very
    // method published 5,173 export NAMES — so the surface existed, was named,
    // and the graph could not see it: no edge says what a file publishes, and
    // `bb_graph` cannot answer "what does this module export" from an array.
    //
    // The SOURCE is the file's global scope, which is this analyzer's existing
    // convention and not an invention: `imports` and a file-scope `calls` edge
    // are already sourced from `global` (addImport, processCall), and c's
    // getRelationshipSource documents the same rule for the family. A Lua chunk
    // has no module symbol, and inventing one from the filename would fabricate
    // a symbol that no source contains.
    //
    // Only the shapes whose SURFACE NAME IS WRITTEN get an edge. The four shapes
    // that carry no name stay silent exactly as they already stayed silent in the
    // export list — `return require("x")`, `return "s"`, `return function() end`
    // and a positional `return {1,2}` publish no name here either, and inventing
    // one would be the fabrication rule. They remain recorded in
    // ctx.unpublishedSurface, which is a disclosure and never an edge.
    if (target.type === "identifier") {
      ctx.exports.push({ name: target.text, isDefault: true, range: this.nodeToRange(node), metadata: { luaSpecific: true } })
      this.addExportEdge(ctx, target.text, target)
      return
    }
    // M60 LUA-09: `return { a = 1, b = 2 }` published NOTHING. Only `return
    // <ident>` was ever handled, and the returned table literal is the dominant
    // way a Lua module publishes its surface — 366 of Kong's 1,309 files and 33
    // of Luvit's 199, carrying 1,377 nameable exports, by the grammar-based
    // census in script/m60/lua-export-census.ts. Not estimated from a guess at
    // prevalence: counted off the wired grammar, because the census also
    // settled which shapes must stay silent (see below).
    //
    // The rule is deliberately narrow, and each exclusion is a measurement or a
    // correctness constraint, not caution for its own sake:
    //
    //   - A member with NO `name` field is a POSITIONAL entry (`return { 1, 2 }`)
    //     and publishes nothing. Publishing it would mean inventing a name that
    //     no source text supports. The existing `tableFieldNames` helper cannot
    //     be reused here: it falls back to `namedChild(0)`, which for a
    //     positional entry is the VALUE, so it would yield the names "1" and
    //     "2". Only the `name` FIELD is read.
    //   - A `["k"] = 1` member puts a STRING node in the `name` field, not an
    //     identifier (measured), with the unquoted text under `content`. An
    //     identifier-only match would silently drop every string key.
    //   - A nested `return { sub = { x = 1 } }` publishes `sub` only. `x` is a
    //     member of sub, not of the module; flattening it would invent a
    //     top-level export.
    //   - `return require("x")`, `return "s"` and `return setmetatable(M, mt)`
    //     stay silent. Naming a re-export would mean inventing an export name
    //     from a module path or a literal, which is a different relationship
    //     entirely. Pinned as silent in the gate so a future change cannot start
    //     inventing them unnoticed.
    // M60 LUA-35: `return setmetatable(M, mt)` names M. The module's surface IS
    // M — the metatable is an attribute OF M, not a second export — so this is
    // the one shape LUA-09 left silent that carries a defensible name and was
    // simply never wired. Measured on kong by
    // script/m60/lua-silent-export-census.ts: 3 files carry a name here
    // (`_M`, `deprecation`), 2 more pass an expression with no name to publish.
    //
    // The other three silent shapes carry NO name and are recorded as a
    // DISCLOSURE instead of an export, because "no exports" otherwise means two
    // indistinguishable things — this module defines nothing, and this module's
    // surface exists but cannot be named. A disclosure separates them while
    // publishing no name at all: an export called "kong.tools.dns" for a
    // re-export of kong.tools.dns would be a fabricated name, which is the same
    // fabrication LUA-22/LUA-29/LUA-32 refused for relationship targets.
    if (target.type === "function_call") {
      // The callee NAME is the call's `name` FIELD, reached exactly as
      // processCall reaches it. Passing the function_call node itself to
      // callee() returns undefined — that is LUA-29's whitelist, which rejects
      // function_call because a call ON a call has no name. Here the node IS the
      // call, so the name has to be read off its field, and getting that wrong
      // made every disclosure read `call-result` with a null detail.
      const nameNode = target.childForFieldName("name") ?? target.namedChild(0)
      const calleeName = nameNode ? this.callee(nameNode)?.name : undefined
      if (calleeName === "setmetatable") {
          const first = this.callArgument(target, 0)
          const named = this.nameBearing(first)
          if (named) {
            ctx.exports.push({ name: named, isDefault: true, range: this.nodeToRange(first!), metadata: { luaSpecific: true, viaMetatable: true } })
            this.addExportEdge(ctx, named, first ?? null)
          } else {
            ctx.unpublishedSurface.push({ shape: "call-result", detail: calleeName ?? null, line: target.startPosition.row + 1, why: "setmetatable's first argument is an expression, so the surface has no name" })
          }
        } else if (calleeName === "require") {
        const arg = this.callArgument(target, 0)
        const path = arg?.type === "string" ? this.stringValue(arg) : null
        ctx.unpublishedSurface.push({ shape: "re-export", detail: path ?? null, line: target.startPosition.row + 1, why: "the surface is another module's, not this module's" })
      } else {
        ctx.unpublishedSurface.push({ shape: "call-result", detail: calleeName ?? null, line: target.startPosition.row + 1, why: "the result of a call is statically unknowable" })
      }
      return
    }
    if (target.type === "string") {
      ctx.unpublishedSurface.push({ shape: "value-literal", detail: this.stringValue(target) ?? null, line: target.startPosition.row + 1, why: "a value is not a name" })
      return
    }
    if (target.type === "function_definition") {
      ctx.unpublishedSurface.push({ shape: "anonymous-function", detail: null, line: target.startPosition.row + 1, why: "an anonymous function has no name" })
      return
    }
    if (target.type === "table_constructor") {
      for (let i = 0; i < target.namedChildCount; i++) {
        const f = target.namedChild(i)
        if (!f || f.type !== "field") continue
        const key = f.childForFieldName("name")
        if (!key) continue
        let name: string | undefined
        if (key.type === "identifier") name = key.text
        else if (key.type === "string") name = this.stringValue(key)
        if (!name) continue
        // M59: the range is the NAME-BEARING node's own, not the `return`
        // statement's. On a multi-line literal those differ, and anchoring on
        // the return would collapse every member onto the `return` line.
        ctx.exports.push({ name, isDefault: false, range: this.nodeToRange(key), metadata: { luaSpecific: true } })
        this.addExportEdge(ctx, name, key)
      }
    }
  }

  /** M60 LUA-42: the `exports` edge for one nameable module-surface name.
   *
   * Confidence 1.0 and `evidenceClass: "structural"`, because both halves of the
   * claim are written in the file: a `return` at chunk scope names this name. That
   * is the difference from `uses`/`references` (LUA-40/LUA-41), where the name is
   * written but the BINDING it denotes is not — the reason those two carry 0.9
   * and those two only.
   */
  private addExportEdge(ctx: LuaContext, name: string, nameNode: Node | null): void {
    this.addRelationship(
      ctx,
      "global",
      name,
      ASTEngine.RelationshipType.Exports,
      { luaSpecific: true, relationshipType: "lua_module_return" },
      nameNode,
    )
  }

  /**
   * M60 LUA-44 — `overrides`, the type this lane was missing.
   *
   * MEASURED BEFORE THIS METHOD EXISTED, on 3,250 corpus files through
   * `parseFile` (script/m60/lua-ontology-census.ts):
   *
   *   B1-override-redefinition   65 occurrences / 37 files
   *   B2-override-inherited       1 occurrence  /  1 file
   *
   * Both non-zero, so `overrides` could NOT be ruled and had to be built. That is
   * the whole reason this method exists: the ontology-coverage gate refuses a
   * ruling whose probe finds a non-zero count, and the lua grammar's 100 node
   * types include no `override_specifier` and no `redefinition` node, so no
   * grammar inventory would ever have found it — instrument A is silent here by
   * construction, and only instrument B could falsify the ruling.
   *
   * TWO SHAPES, two labels, because Lua expresses two different things and fusing
   * them would state one of them falsely:
   *
   *   lua_redefinition    the SAME name declared twice in one chunk. The later
   *                       declaration replaces the earlier one. 1.0, structural —
   *                       both endpoints are nodes this parse saw, and the
   *                       `overridesLine` metadata carries the prior declaration's
   *                       line so the two are distinguishable, exactly as
   *                       real-bash-analyzer.ts:343 does for the same construct.
   *
   *   lua_inherited_member  a member of D that D also inherits from a base B. 0.95,
   *                       structural — the family number for this edge is objc's
   *                       (real-objective-c-analyzer.ts:1020), and perl uses 0.95
   *                       for the same verified-base case. It is not 1.0 because
   *                       the corpus's inheritance is a CONVENTION over
   *                       `setmetatable`/`__index`, and nothing in the tree says
   *                       the link is meant as inheritance.
   *
   * The DIRECTION and the ENDPOINTS deliberately do NOT copy objc's
   * `Derived.member -> Base.member`. This lane's member-identity contract (LUA-15,
   * pinned by validation/m14/fixtures/lua/member-identity.expectation.json) holds
   * that a member's identity is its container plus its own name and that the
   * qualified path must not BE the name — that fixture FORBIDS `Buffer:initialize`
   * as a symbol name. So the edge runs `Derived -> Base`, the same pair `extends`
   * uses, and the overridden member travels in metadata as `member` plus the
   * qualified `memberPath`. Two tables in one file can therefore produce an
   * `overrides` and an `extends` edge between the same pair, under different type
   * labels; the store treats a distinct type on the same pair as a distinct link,
   * which is the property that keeps them from being read as one fact.
   */
  private addOverrideRelationships(ctx: LuaContext): void {
    // Shape 1 — one name declared more than once in this chunk.
    for (const [label, decls] of ctx.declarationsByLabel) {
      if (decls.length < 2) continue
      const byLine = [...decls].sort((a, b) => a.line - b.line)
      const first = byLine[0]
      for (let i = 1; i < byLine.length; i++) {
        const d = byLine[i]
        // TARGET is the MEMBER's own name when the declaration has an owner, so the
        // pair reads exactly like the `contains` pair for the same declaration
        // (`M` -> `serialize`). The first version put the LABEL in the target, which
        // is the qualified path `M.serialize` — the very form LUA-15's
        // member-identity fixture forbids as a symbol name, and a consumer joining
        // `contains` to `overrides` on (source, target) would have found one edge
        // with a bare member and one with a dotted path. Measured on the corpus, that
        // version produced labelShape {bare 54, dotted 8, colon 4}; with the member
        // name the mixed shapes collapse to bare. The path stays in metadata as
        // `qualifiedName`, which is what it is for.
        this.addRelationship(
          ctx,
          d.owner ?? "global",
          d.owner ? (d.member ?? label) : label,
          ASTEngine.RelationshipType.Overrides,
          {
            luaSpecific: true,
            relationshipType: "lua_redefinition",
            redefinition: true,
            qualifiedName: label,
            overridesLine: first.line,
            overriddenOwner: first.owner,
          },
          null,
          { confidence: 1.0, symbolRange: { startLine: d.line } },
        )
      }
    }
    // Shape 2 — a member declared on D that D inherits from a base B.
    for (const [derived, bases] of ctx.supertypeLinks) {
      const derivedMembers = ctx.membersByOwner.get(derived)
      if (!derivedMembers || derivedMembers.size === 0) continue
      for (const base of bases) {
        const baseMembers = ctx.membersByOwner.get(base)
        if (!baseMembers) continue
        for (const [member, line] of derivedMembers) {
          if (!baseMembers.has(member)) continue
          this.addRelationship(
            ctx,
            derived,
            base,
            ASTEngine.RelationshipType.Overrides,
            {
              luaSpecific: true,
              relationshipType: "lua_inherited_member",
              isOverride: true,
              member,
              memberPath: `${derived}.${member} -> ${base}.${member}`,
              // M60 LUA-52: the tier is `usage_contextual`, NOT the `structural` that
              // `evidenceClassFor` hands every type which is not imports/references/uses.
              // The rule this analyzer already wrote for ITSELF is at
              // `addFactorySupertypeEdges` (:1381): "a 0.95 edge must not claim
              // `structural`". `structural` asserts both endpoints are nodes this parse
              // saw, which is true here — and is not the claim. The claim is that a
              // member SHADOWS another through an `__index` chain, and Lua's inheritance
              // is a CONVENTION over `setmetatable`/`__index` with nothing in the tree
              // saying the link is meant as inheritance. Same reason, same 0.95, same
              // tier as `lua_factory_supertype`.
              //
              // MEASURED (validation/m60/lua/ontology-census.json, 3,252 files): 2 of
              // 67 `overrides` edges carried `structural` at confidence 0.95, and the
              // census counted 67 edges before and after this change — the tier is the
              // whole difference. Pinned by
              // `validation/m14/fixtures/lua/override-shapes.expectation.json`, whose
              // forbid half fails an implementation that derives the tier from the
              // type, and by the mutant in script/m60/mutate-lua-evidence-tier.ts.
              evidenceClass: "usage_contextual",
            },
            null,
            { confidence: 0.95, symbolRange: { startLine: line } },
          )
        }
      }
    }
  }

  private addContainsRelationships(ctx: LuaContext): void {
    // M60 LUA-37: the edge SOURCE must be a NAME a consumer can follow, and the
    // symbol's `scope` is a LABEL, not one — a nested function inside
    // `function fs.appendFile(...)` has scope "fs.appendFile" and no ownerName, and
    // the old fallback read the label straight into the edge. Resolution order:
    //
    //   1. `ownerName`            — the container, always a symbol (LUA-37)
    //   2. `frameSelfName`        — the enclosing function's own symbol name
    //   3. "global"               — a file-scope declaration
    //
    // and never `scope`. `frameSelfName` is recorded on the symbol at creation,
    // because by the time this runs the frames are gone; storing it is what makes
    // the edge's source a name rather than a path.
    for (const symbol of ctx.symbols) {
      const owner = symbol.ownerName
        || ((symbol as any).frameSelfName as string | undefined)
        || (symbol.scope === "global" || !symbol.scope ? "global" : (symbol.scope as string))
      // M60 LUA-37 follow-up: a blanket `owner !== symbol.name` skip dropped a real
      // edge — `contains stack -> stack` in examples/app/libs/stack.lua, where L20 is
      // `local stack = {}` and L22 is `function stack.stack(...)`. The method IS a
      // member of that table and the two are distinct symbols (a variable and a
      // method, at different ranges), so the edge is a true statement.
      //
      // The first attempt at fixing it — "emit a self-named edge when another symbol
      // with the same name exists" — was wrong, and the corpus said so immediately:
      // it added 5 false edges on kong. The failing shapes are
      //
      //     local function new_router(version)      -- L347, a function
      //       local new_router, err = ...           -- L426, a local that SHADOWS it
      //
      // Two same-named symbols exist, but they are not a container and a member; the
      // local at L426 merely shares the name of the function it is written inside. The
      // same shape produced `initialize -> initialize`, `logout -> logout`,
      // `failed -> failed` and `sleep_once_for_balancer_init -> …`.
      //
      // So the discriminator is not "does the name occur twice" but "WAS THE OWNER
      // WRITTEN AS A RECEIVER". `splitMemberName` sets `owner` only for a real
      // `function a.b` / `function a:b` receiver, and a receiver is precisely what
      // makes the container real: the source says the method belongs to it. When the
      // owner instead came from the enclosing frame, it is an inference about scope,
      // and two symbols sharing that name prove nothing. `metadata.isMethod` is
      // already set from the same `!!owner`, so no new field is needed.
      const selfNamed = owner === symbol.name
      const ownerWrittenAsReceiver = (symbol.metadata as any)?.isMethod === true
      const containerExists = selfNamed && ownerWrittenAsReceiver && ctx.symbols.some(
        (o: any) => o.name === owner && o !== symbol && (o.range?.startLine !== symbol.range?.startLine || o.kind !== symbol.kind),
      )
      if (owner && (owner !== symbol.name || containerExists)) {
        // M60 LUA-01: a Contains edge and the symbol it names must never
        // disagree about the line — java's declarationLineNode states the rule
        // outright ("the symbol range and its `contains` edge move together") and
        // scala pinned it first. The edge is synthesized here rather than
        // observed at a site, so the line is the SYMBOL's own declaration line,
        // not an invented node. Passing no node would leave the edge lineless,
        // which is the LUA-01 defect all over again on the one kind that CAN
        // name its line honestly.
        this.addRelationship(ctx, owner, symbol.name, ASTEngine.RelationshipType.Contains, {}, undefined, { symbolRange: symbol.range })
      }
    }
  }

  private addRelationship(
    ctx: LuaContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    metadata: Record<string, any>,
    // M60 LUA-01: the node whose START is the line this edge belongs to.
    //
    // The contract is M59 (#825)'s, copied from the family rather than
    // invented here. Java states it at real-java-analyzer.ts:967-971: "the line
    // is where the CALL IS WRITTEN — the name field of the method_invocation,
    // not the invocation node's own start. Measured with the M59 oracle on real
    // java: a method_invocation starts at its RECEIVER, so `a.b()\n  .c()` put
    // c on the line a.b() opened on."
    //
    // tree-sitter-lua has the identical hazard — `obj\n  .method()` is a
    // function_call whose dot_index_expression opens on the `obj` line while
    // `method` is written on the next — so the rule transfers unchanged. Before
    // this parameter every lua relationship carried NO line at all: 0 of 15 on
    // a purpose-built probe, against java's line_number:2 through the identical
    // pipeline, which is why M60's matrix reads lua `lines: n/a`.
    //
// A synthesized edge carries no node, so its line comes from `opts.symbolRange`
    // instead. See addContainsRelationships.
    nameNode?: Node | null,
    opts?: { symbolRange?: { startLine: number }; confidence?: number },
  ): void {
    if (!source || !target) return
    const key = `${type}${source}${target}`
    // M60 LUA-01: the dedup is UNCONDITIONAL, and it was already unconditional before
    // this pass — a `dedupe` option existed, was passed `false` at four call sites, and
    // could not change a single output:
    //
    //     if (opts?.dedupe === false) {
    //       if (ctx.seenRelationships.has(key)) return
    //     } else if (ctx.seenRelationships.has(key)) return
    //     ctx.seenRelationships.add(key)
    //
    // Both arms ran the SAME test and the key was recorded either way, so the flag was
    // read and ignored. A flag whose value does not matter is a claim about the output
    // that no reader can check, which is the shape this analyzer has now produced three
    // times — LUA-02's `isCoroutine` counter that could only read 0, LUA-10's dead `+5`
    // scoring branch, and this. `script/m60/lua-dead-flag-probe.ts` measures the
    // population; `script/m60/verify-lua-dedupe-invariant.ts` proves the removal is
    // behaviour-preserving by diffing the whole edge set before and after.
    //
    // WHY UNCONDITIONAL IS THE RIGHT BEHAVIOUR and not merely the current one. A callee
    // called from four places is one edge in the store, which is the intent stated above
    // and in the LUA-01 note. The per-site problem the dedup causes is recorded as its
    // own finding (LUA-01b) and is NOT silently changed here, because whether the store
    // may hold two edges of one kind between one pair of symbols is a schema question
    // above this analyzer.
    //
    // WHAT THAT COSTS, MEASURED. 37 of 90 redefinition attempts corpus-wide land on a key
    // that already exists, so one name declared N times publishes ONE `overrides` edge
    // and the later declarations' own lines are unrepresented. The extreme is 13 attempts
    // on one key — `overrides global enqueue`, a name declared 14 times in one chunk.
    // That is a real shortfall and it is declared (limitation 17) rather than fixed here,
    // because making the flag work would add 37 edges that share (type, source, target)
    // with an edge already stored — LUA-01b's schema question, decided above this file.
    if (ctx.seenRelationships.has(key)) return
    ctx.seenRelationships.add(key)
    const relationship: ASTEngine.UniversalRelationship = {
      source,
      target,
      type,
      confidence: opts?.confidence ?? 1.0,
      metadata,
    }
    // 1-based, on the name-bearing node. Absent rather than 0 or -1 when there
    // is no node to name: a legacy "0 means no line stored" is exactly the
    // ambiguity M62's address owner exists to remove, and inventing a line here
    // would re-create it.
    if (nameNode) relationship.line_number = nameNode.startPosition.row + 1
    else if (opts?.symbolRange) relationship.line_number = opts.symbolRange.startLine
    // M60 LUA-43: every edge carries its evidence tier, from ONE function.
    //
    // Measured before this line: 119,606 of 119,606 lua relationships carried NO
    // `evidenceClass` at all, so the honesty contract §4 requirement — a
    // machine-readable reason code beside every confidence below 1.0 — had
    // nothing to point at, and the three tiers the family already uses
    // (`structural`, `usage_contextual`, `import_based`, spelled out at
    // real-css-analyzer.ts:737) could not be told apart on a lua edge.
    //
    // The mapping is css's, applied per type and for the same reasons:
    //   structural       both endpoints are nodes this parse saw
    //   usage_contextual the link rests on a NAME in a value position
    //   import_based     the endpoint may be declared OUTSIDE this tree
    //
    // `imports` and `references` are `import_based` for the same reason css gives:
    // a `require("x")` module and an `M.field` member are both dependencies on a
    // name that may live in another file, and the property really is imported
    // from somewhere.
    relationship.metadata = { evidenceClass: this.evidenceClassFor(type), ...relationship.metadata }
    ctx.relationships.push(relationship)
  }

  /** M60 LUA-43: the evidence tier for a relationship type. See the call site for
   * why these three words and not a fourth. */
  private evidenceClassFor(type: ASTEngine.RelationshipType): "structural" | "usage_contextual" | "import_based" {
    if (type === ASTEngine.RelationshipType.Imports || type === ASTEngine.RelationshipType.References) return "import_based"
    if (type === ASTEngine.RelationshipType.Uses) return "usage_contextual"
    return "structural"
  }

  private functionName(node: Node): string | undefined {
    return node.childForFieldName("name")?.text || node.namedChild(0)?.text
  }

  private hasChildType(node: Node, type: string): boolean {
    for (let i = 0; i < node.childCount; i++) if (node.child(i)?.type === type) return true
    return false
  }

  private isLocalFunction(node: Node): boolean {
    return this.hasChildType(node, "local")
  }

  private isLocalVariableDeclaration(node: Node): boolean {
    return this.hasChildType(node, "local")
  }

  /**
   * The resolvable CONTAINER of a member: the HEAD of the receiver path.
   *
   * M60 LUA-37. `function Buffer:initialize()` has receiver `Buffer`; `function
   * Buffer.meta.index()` has receiver `Buffer.meta`. Returning the receiver's
   * text verbatim makes the second an owner of `"Buffer.meta"`, which no symbol is
   * filed under, so the owner still does not resolve. The head is the only part
   * of the path that is a declared name, and the analyzer already files
   * `Buffer` as a symbol. Returns undefined for a bare name — a plain function
   * has no container, and its own name is its scope.
   */
  private functionOwner(nameNode: Node): string | undefined {
    if (!["dot_index_expression", "method_index_expression"].includes(nameNode.type)) return undefined
    const recv = nameNode.childForFieldName("table")?.text
    if (!recv) return undefined
    const head = recv.split(".")[0]
    return head.length > 0 ? head : undefined
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const list = node.childForFieldName("parameters")
    if (!list) return []
    const parameters: ASTEngine.Parameter[] = []
    for (let i = 0; i < list.namedChildCount; i++) {
      const child = list.namedChild(i)
      if (!child) continue
      if (child.type === "identifier") parameters.push({ name: child.text, type: "Any" })
      else if (child.type === "vararg_expression") parameters.push({ name: "...", type: "Any", isVariadic: true })
    }
    return parameters
  }

  private plainVariableName(node: Node | null | undefined): string | undefined {
    return node?.type === "identifier" ? node.text : undefined
  }

  private isTableNode(node: Node | undefined): boolean {
    return node?.type === "table_constructor"
  }

  private assignmentValue(node: Node): Node | undefined {
    const expressionList = node.childForFieldName("value") || node.namedChild(1)
    return expressionList?.namedChild(0) || expressionList || undefined
  }

  private callArguments(node: Node): Node[] {
    const argumentList = node.childForFieldName("arguments")
    if (!argumentList) return []
    const source = argumentList
    const values: Node[] = []
    for (let i = 0; i < source.namedChildCount; i++) {
      const child = source.namedChild(i)
      if (child) values.push(child)
    }
    return values
  }

  private callArgument(node: Node, index: number): Node | undefined {
    return this.callArguments(node)[index]
  }

  private stringValue(node: Node | undefined): string | undefined {
    if (!node || node.type !== "string") return undefined
    return this.cleanLuaString(node.text)
  }

  private tableFieldNames(node: Node): string[] {
    const result: string[] = []
    const fieldList = node
    for (let i = 0; i < (fieldList?.namedChildCount || 0); i++) {
      const field = fieldList?.namedChild(i)
      if (!field || field.type !== "field") continue
      // M60 LUA-00: a `field` node in this grammar has no `key` field. Its
      // shape is `field > [anon name=identifier] + [anon `=`] + value`, so the
      // key is the first NAMED child. The old chain asked for `key`, then
      // `name`, then fell back to namedChild(0) — and the grammar resolved
      // neither field, so every table field name came from the fallback or not
      // at all. `name` IS a real field on `field`, so the middle term is kept
      // and only the invented one is dropped.
      const key = field.childForFieldName("name") || field.namedChild(0)
      if (key?.text) result.push(key.text)
    }
    return result
  }

  // M60 LUA-13 + LUA-01: the callee's NAME and the node that CARRIES ITS LINE
  // must be the same node, returned together so they cannot drift apart.
  //
  // Getting this wrong took three measurements, and each wrong answer was
  // plausible enough to nearly ship:
  //   1. `node.text` on the callee — on a call split across lines that is a
  //      SOURCE SNIPPET ("obj\n  .method"), which the pool-worker's
  //      garbage-target filter deletes (pool-worker.ts:391 rejects any target
  //      containing a newline). Consequence: `obj\n.method()` produced NO EDGE
  //      while the identical one-line call produced one. A line break silently
  //      removed a call from the graph.
  //   2. the first identifier in the index expression — that is the RECEIVER
  //      (`obj`), not the thing called.
  //   3. the index expression itself — its start is the receiver's line, so
  //      `obj\n  .method()` reported the `obj` line and the gate caught it.
  //
  // The callee of `table . field` / `table : field` is `field`, and `field` is
  // the LAST named child, so its own start position is the line the method name
  // is written on — which is exactly M59 (#825)'s rule and exactly what java
  // gets from `childForFieldName("name")` on its invocation node.
  // M60 LUA-32: the ONE rule for "is this node a name", shared by the callee
  // whitelist (LUA-29/LUA-30) and the setmetatable path, so the two cannot drift
  // apart the way `table_index_expression` did (LUA-27). Three node forms carry a
  // name; everything else is an expression, and an expression used as a target is
  // a payload — unmatchable, unreferenceable, and unbounded in shape.
  //
  // `dot_index_expression` and `method_index_expression` yield their FULL TEXT
  // (`Account.Meta`), which is a path rather than a bare name. That is kept
  // deliberately: these are relationship ENDPOINTS, not symbols, and the
  // member-identity rule that forbids '.' in a SYMBOL name (verify-lua-member-identity)
  // is a different contract from what a reference to `Account.Meta` may look like.
  private nameBearing(node: Node | null | undefined): string | undefined {
    if (!node) return undefined
    if (node.type === "identifier") return node.text
    if (node.type === "dot_index_expression" || node.type === "method_index_expression") return node.text
    return undefined
  }

  private callee(functionNode: Node): { name: string; nameNode: Node } | undefined {
    if (functionNode.type === "identifier") return { name: functionNode.text, nameNode: functionNode }
    if (functionNode.type === "dot_index_expression" || functionNode.type === "method_index_expression") {
      const last = functionNode.namedChildCount > 0 ? functionNode.namedChild(functionNode.namedChildCount - 1) : undefined
      if (last?.text) return { name: last.text, nameNode: last }
    }
    // M60 LUA-22: a call through a COMPUTED index has no name to record.
    // `dao[method or context .. "_by_" .. endpoint_key](...)` —
    // kong/api/endpoints.lua:260 — has a callee that is an EXPRESSION, and
    // falling through to `functionNode.text` published that whole expression as
    // the relationship target. A payload masquerading as a name is the defect
    // class M60 records for other lanes ("publishes the target
    // 'ns.Iface<number>', a payload rather than a name"), and it is worse here:
    // the target is unmatchable, unreferenceable and unbounded in shape.
    //
    // Skipped rather than recorded as a best guess: a computed callee is not a
    // fact about the call graph, and inventing a name for it would be the same
    // fabrication under a different spelling. A literal index (`dao["rows"]`)
    // IS a name and is handled by the dot/method branch above.
    // The node type is `bracket_index_expression` in the WIRED grammar, measured
    // by parsing `dao[expr](x)`. Writing `table_index_expression` here — which is
    // what the 0.5.0 grammar repo's node-types.json calls it — repeated LUA-00's
    // exact error: naming a node type the pinned grammar does not emit, which
    // makes the branch unreachable. verify-lua-grasped-fields caught it, which is
    // the gate doing precisely the job it was built for, on the very defect class
    // it was built to catch, in the same lane.
    // M60 LUA-30: a LITERAL string index IS a name, and LUA-22's fix above threw
    // it away with the computed ones. `dao["rows"]()` names exactly the field
    // `dao.rows()` names, but the measured tree builds both as
    // `bracket_index_expression` — the literal one as {table, field=string}, the
    // computed one as {table, field=<expr>} — so the branch cannot tell them
    // apart by TYPE and the whole class was dropped. Measured on a probe:
    //   dao["rows"]()  ->  NO EDGE      (should be calls:rows)
    //   dao.rows()     ->  calls:rows
    // The comment above this branch claimed "a literal index IS a name and is
    // handled by the dot/method branch above". That was false: a literal index is
    // a bracket_index_expression, never a dot or method one, so the intent was
    // documented and never implemented. A comment asserting a behaviour is not
    // evidence that the behaviour exists.
    //
    // Only a literal STRING names a field. Measured, all three forms:
    //   dao["rows"]()  field=string      -> the name IS the unquoted content
    //   dao[1]()       field=number      -> an array index, not a name
    //   dao[k]()       field=identifier  -> a VARIABLE holding the key, and
    //                                       which key is not statically knowable
    if (functionNode.type === "bracket_index_expression") {
      const field = functionNode.childForFieldName("field")
      if (field?.type !== "string") return undefined
      const literal = this.stringValue(field)
      return literal ? { name: literal, nameNode: field } : undefined
    }
    // M60 LUA-29: a call ON A CALL has no name either, and this fallthrough was
    // publishing one. `require("some.module")()` — the shape at
    // kong/cmd/init.lua:9 and kong/init.lua:58 — has a callee that is itself a
    // `function_call`, so `functionNode.text` produced the relationship target
    // `require("kong.globalpatches")`, a payload rather than a name, the same
    // defect class LUA-22 fixed two lines above for computed indexes and missed
    // here for the adjacent case. Measured on kong: 51 edges whose target is a
    // whole call, e.g. `require("kong.tools.dns")`,
    // `ws_migration_teardown(operations.postgres.teardown)`,
    // `sandbox(expression)`. Unmatchable, unreferenceable, unbounded in shape —
    // every property M60 records for a fabricated target.
    //
    // It survived this long because the ORACLE shared it: script/m60/lua-truth-oracle.ts
    // had no guard here either, so both sides emitted the payload and the
    // differential read the agreement as confirmation. Fixing the oracle's side
    // first is what exposed it — which is the argument the LUA-22 comment makes
    // about an oracle that shares a defect, demonstrated rather than asserted.
    //
    // A WHITELIST, for the reason LUA-27 gives on the oracle side: two blacklists
    // in a row is how `table_index_expression` stayed in the oracle as dead code.
    // These four forms are the only callees that carry a name, and the grammar —
    // not this file's memory of it — is the authority for that list.
    if (functionNode.type === "function_call" || functionNode.type === "table_constructor" ||
        functionNode.type === "binary_expression" || functionNode.type === "parenthesized_expression" ||
        functionNode.type === "string" || functionNode.type === "number") return undefined
    if (functionNode.text) return { name: functionNode.text, nameNode: functionNode }
    return undefined
  }

  // M60 LUA-01: reach a child by node TYPE. The five field literals this
  // analyzer used to ask for (`name_list`, `function`, `expression_list`, `key`)
  // do not exist in the pinned grammar, and every one of them sat behind a
  // `|| namedChild(0)` fallback that turned "this field does not exist" into
  // "quietly use whatever happens to be first" — a wrong answer that could not
  // raise, log, or fail. Type-directed lookup has no fallback to hide behind:
  // either the child is there or the path does not run.
  private childOfType(node: Node | null | undefined, type: string): Node | undefined {
    if (!node) return undefined
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return undefined
  }

  private cleanLuaString(text: string): string {
    const cleaned = text.trim()
    if (cleaned.length >= 2) {
      const first = cleaned[0]
      const last = cleaned[cleaned.length - 1]
      if ((first === '"' || first === "'") && first === last) return cleaned.substring(1, cleaned.length - 1)
    }
    if (cleaned.startsWith("[[") && cleaned.endsWith("]]")) return cleaned.substring(2, cleaned.length - 2)
    return cleaned
  }

  // M60 LUA-04: framework detection fired on EVERY identifier node and matched
  // BARE NAMES — `use`, `setup`, `GetTime`, `C_Timer`, `Proto`, `UIParent`. So a
  // file containing `local setup = 1` was labelled "Neovim Configuration", and
  // the committed gate for this defect class caught a probe labelled BOTH
  // "Neovim Configuration" AND "World of Warcraft Addon" purely from three
  // ordinary variable names.
  //
  // The analyzer's own header claims "No regex fallback or source-wide scanning
  // is used". A bare-name equality test applied to every identifier is
  // source-wide scanning wearing an AST costume, so this is a contract failure
  // and not only a precision one.
  //
  // The rule now: a framework is claimed only from a QUALIFIED member access
  // (`vim.api`, `love.graphics`, `ngx.timer`) or from a `require`d module name
  // that names it. A bare identifier never names a framework. That is narrower
  // than the old rule on purpose — and the gate asserts the CONVERSE too, so it
  // cannot be satisfied by deleting detection: a file that really does use
  // `vim.api` must still be labelled Neovim.
  private detectFrameworks(text: string, ctx: LuaContext): void {
    // Only qualified accesses count. `text` here is a callee or an identifier
    // node's text; a qualified access always contains a separator, so a name
    // with no separator can be rejected before any comparison is attempted.
    if (!text.includes(".")) return
    const head = text.split(".")[0]
    if (!head) return
    if (head === "vim") ctx.frameworks.add("Neovim Configuration")
    if (head === "love") ctx.frameworks.add("Love2D")
    if (head === "ngx" || head === "resty") ctx.frameworks.add("OpenResty")
    if (head === "display" || head === "system" || head === "transition" || head === "Runtime") ctx.frameworks.add("Corona SDK / Solar2D")
    if (head === "lovr") ctx.frameworks.add("LÖVR (VR/AR)")
    if (head === "redis") ctx.frameworks.add("Redis Scripting")
  }

  private collectErrors(rootNode: Node, ctx: LuaContext): void {
    if (!rootNode.hasError) return
    const stack: Node[] = [rootNode]
    while (stack.length) {
      const node = stack.pop()!
      if (node.type === "ERROR" || node.isMissing) {
        ctx.errors.push({ message: `Syntax ${node.type} detected.`, range: this.nodeToRange(node), severity: "warning" })
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  private calculateCyclomaticComplexity(rootNode: Node): number {
    let complexity = 1
    const stack: Node[] = [rootNode]
    while (stack.length) {
      const node = stack.pop()!
      if (node.type === "if_statement" || node.type === "for_statement" || node.type === "while_statement" || node.type === "repeat_statement") complexity++
      if (node.type === "binary_expression") {
        const operator = node.childForFieldName("operator")
        if (operator?.text === "and" || operator?.text === "or") complexity++
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  // M60 LUA-02: this counted `symbol.metadata?.isCoroutine`, which NO code path
  // in the analyzer ever set — processCall adds the string "Coroutines" to
  // ctx.patterns and stops. So the count could only ever read 0, and it was
  // published as a count. It is now counted from the calls the walk actually
  // saw: `coroutine.create` and `coroutine.wrap` are ordinary function_call
  // nodes, so a file that uses them reports a positive number and a file that
  // does not reports 0 that means something.
  // M60 LUA-02. Counted during the walk, not afterwards and not from the stored
  // edges: the edge carries the callee FIELD, so after the LUA-13 fix there is
  // no relationship whose target is "coroutine.create" — the field is "create".
  // Two earlier versions of this fix were wrong in ways the gate caught: the
  // first counted ctx.symbols (a call is not a declaration, so it read 0), the
  // second counted relationship targets (which no longer exist under that name,
  // so it also read 0). Counting at the point where the qualified name is still
  // in hand is the only place the fact exists.
  private countCoroutineSymbols(ctx: LuaContext): number {
    return ctx.coroutineCalls
  }

  // M60 LUA-11: a derived figure, or absent. Returns undefined when there is
  // nothing to measure rather than a number that means nothing.
  private relationshipDensity(ctx: LuaContext): number | undefined {
    if (ctx.symbols.length === 0 && ctx.relationships.length === 0) return undefined
    // Symbols and relationships per unit of analysed surface. A file that
    // yields many relationships per symbol is denser, not better or worse, so
    // this is deliberately labelled a DENSITY figure and bounded rather than
    // dressed up as a judgement.
    const perSymbol = ctx.symbols.length === 0 ? 0 : ctx.relationships.length / ctx.symbols.length
    return Math.max(0, Math.min(100, Math.round(100 - perSymbol * 10)))
  }

  private retainedRowKb(ctx: LuaContext): number | undefined {
    if (ctx.symbols.length === 0 && ctx.relationships.length === 0) return undefined
    // A structural size estimate in KB from the counts actually retained: a
    // symbol row and a relationship row each, at a stated per-row allowance.
    // Named `memoryFootprintKb` rather than `memoryEfficiency` because that is
    // what it is; an "efficiency" score cannot be derived from row counts.
    const SYMBOL_ROW_KB = 0.5
    const RELATIONSHIP_ROW_KB = 0.25
    const kb = ctx.symbols.length * SYMBOL_ROW_KB + ctx.relationships.length * RELATIONSHIP_ROW_KB
    return Math.round(kb * 100) / 100
  }

  // M60 LUA-10: the +5 branch for "Module/Table Pattern" rewarded a string
  // nothing ever added, so a published score was computed from a dead branch —
  // and codeQuality thresholds on that score, so the error propagated into a
  // second published field. The branch is gone rather than wired up: a module
  // table IS this language's module idiom, so awarding points for it would
  // award points to most Lua files, which measures nothing.
  private calculateArchitecturalScore(ctx: LuaContext): number {
    let score = 70
    if (ctx.relationships.length > 0) score += 10
    if (ctx.exports.length > 0) score += 5
    if (ctx.patterns.has("Object-Oriented Programming (Metatables)")) score += 10
    if (ctx.patterns.has("Object-Oriented Programming (Libraries)")) score += 5
    return Math.min(100, score)
  }

  private assessCodeQuality(ctx: LuaContext): string {
    const score = this.calculateArchitecturalScore(ctx)
    if (score >= 90) return "excellent"
    if (score >= 80) return "good"
    if (score >= 60) return "fair"
    return "poor"
  }

  private generateArchitecturalInsights(ctx: LuaContext): any[] {
    const insights: any[] = []
    if (ctx.patterns.has("Object-Oriented Programming (Metatables)")) {
      insights.push({ type: "architecture", category: "lua_oop", message: "Lua object-oriented patterns detected through metatables.", severity: "info" })
    }
    return insights
  }

  private lineCount(content: string): number {
    let count = 1
    for (let i = 0; i < content.length; i++) if (content[i] === "\n") count++
    return count
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
