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
    }

    this.collectErrors(rootNode, ctx)
    // M60 LUA-06: BEFORE the walk, so a constructor call does not depend on
    // where its table was declared.
    this.collectDeclaredTables(rootNode, ctx)
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
      case "identifier":
        this.detectFrameworks(node.text, ctx)
        break
    }
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
    }
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
      if (frame.callable && frame.localNames.has(name)) continue // local re-assignment
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
      if (target && metatable && !this.isTableNode(target) && srcName && mtName) {
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
    if (target.type === "identifier") {
      ctx.exports.push({ name: target.text, isDefault: true, range: this.nodeToRange(node), metadata: { luaSpecific: true } })
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
      if (owner && owner !== symbol.name) {
        // M60 LUA-01: a Contains edge and the symbol it names must never
        // disagree about the line — java's declarationLineNode states the rule
        // outright ("the symbol range and its `contains` edge move together") and
        // scala pinned it first. The edge is synthesized here rather than
        // observed at a site, so the line is the SYMBOL's own declaration line,
        // not an invented node. Passing no node would leave the edge lineless,
        // which is the LUA-01 defect all over again on the one kind that CAN
        // name its line honestly.
        this.addRelationship(ctx, owner, symbol.name, ASTEngine.RelationshipType.Contains, {}, undefined, { dedupe: false, symbolRange: symbol.range })
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
    // A separate `dedupe` flag exists because Contains edges are SYNTHESIZED
    // after the walk from symbol pairs rather than observed at a site; they
    // carry no node and must not be invented one. See addContainsRelationships.
    nameNode?: Node | null,
    opts?: { dedupe?: boolean; symbolRange?: { startLine: number } },
  ): void {
    if (!source || !target) return
    const key = `${type}\u001f${source}\u001f${target}`
    // M60 LUA-01: `dedupe: false` is for SYNTHESIZED edges only. Observed edges
    // keep the dedup so a callee called from four places is still one edge in
    // the store. The per-site problem that dedup causes is recorded as its own
    // finding (LUA-01b) and is NOT silently changed here, because whether the
    // store may hold two edges of one kind between one pair of symbols is a
    // schema question above this analyzer.
    if (opts?.dedupe === false) {
      // still recorded, so a later edge of the same shape is not re-added
      if (ctx.seenRelationships.has(key)) return
    } else if (ctx.seenRelationships.has(key)) return
    ctx.seenRelationships.add(key)
    const relationship: ASTEngine.UniversalRelationship = {
      source,
      target,
      type,
      confidence: 1.0,
      metadata,
    }
    // 1-based, on the name-bearing node. Absent rather than 0 or -1 when there
    // is no node to name: a legacy "0 means no line stored" is exactly the
    // ambiguity M62's address owner exists to remove, and inventing a line here
    // would re-create it.
    if (nameNode) relationship.line_number = nameNode.startPosition.row + 1
    else if (opts?.symbolRange) relationship.line_number = opts.symbolRange.startLine
    ctx.relationships.push(relationship)
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
