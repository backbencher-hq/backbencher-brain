// Pure-AST Lua analyzer — M12.32 extraction contract.
// Declarations and relationships come from Tree-sitter nodes/fields. No regex
// fallback or source-wide scanning is used.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface LuaFrame {
  callable?: string
  localNames: Set<string>
}

interface LuaContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  globalVariables: Set<string>
  declaredTables: Set<string>
  frameworks: Set<string>
  patterns: Set<string>
  seenRelationships: Set<string>
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
      frameworks: new Set<string>(),
      patterns: new Set<string>(),
      seenRelationships: new Set<string>(),
    }

    this.collectErrors(rootNode, ctx)
    const rootFrame: LuaFrame = { localNames: new Set<string>() }
    const stack: { node: Node; frame: LuaFrame }[] = [{ node: rootNode, frame: rootFrame }]

    while (stack.length > 0) {
      const entry = stack.pop()!
      const node = entry.node
      const frame = entry.frame
      if (node.isMissing) continue

      this.processNode(node, frame, ctx)

      let childFrame = frame
      if (node.type === "function_declaration") {
        const functionName = this.functionName(node)
        if (functionName) {
          const locals = new Set<string>()
          for (const parameter of this.extractParameters(node)) locals.add(parameter.name)
          childFrame = { callable: functionName, localNames: locals }
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
        hasFrameworkIntelligence: true,
        performanceScore: 85,
        memoryEfficiency: 85,
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
    // The verified grammar exposes declarations through the `name` field;
    // retain the named-child fallback for grammars that omit that field.
    const nameNode = node.childForFieldName("name") || node.namedChild(0)
    const name = nameNode?.text
    if (!name) return // Anonymous function expressions are expression noise.

    const parameters = this.extractParameters(node)
    const owner = this.functionOwner(nameNode)
    const isMethod = !!owner
    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: isLocal ? (frame.callable || "global") : "global",
      visibility: isLocal ? "private" : "public",
      parameters,
      ownerName: owner,
      ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
      metadata: { luaSpecific: true, isLocal, isMethod, ownerTable: owner },
    }
    ctx.symbols.push(symbol)
    if (owner) {
      ctx.declaredTables.add(owner)
      ctx.patterns.add("Object-Oriented Programming")
    }
    if (isLocal) ctx.globalVariables.delete(name)
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
    const assignment = node.type === "variable_declaration" ? node.namedChild(0) : node
    const variableList = this.childOfType(assignment, "variable_list")
    if (!variableList) return
    for (let i = 0; i < variableList.namedChildCount; i++) {
      const variable = variableList.namedChild(i)
      const name = this.plainVariableName(variable)
      if (!variable || !name) continue
      frame.localNames.add(name)
      const value = this.assignmentValue(assignment!)
      const isTable = this.isTableNode(value)
      if (isTable) ctx.declaredTables.add(name)
      ctx.symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(variable),
        scope: frame.callable || "global",
        ownerName: frame.callable,
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
        ownerName: frame.callable,
        ownerKind: frame.callable ? ASTEngine.SymbolKind.Function : undefined,
        visibility: frame.callable ? "private" : "public",
        metadata: { luaSpecific: true, isGlobal: !frame.callable, isTable, tableFields: isTable ? this.tableFieldNames(value!) : [] },
      })
      if (!frame.callable) ctx.globalVariables.add(name)
    }
  }

  private processCall(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    // M60 LUA-00: there is no `function` field on a function_call in this
    // grammar. The callee is the call's `name` field, and it is either a plain
    // identifier (`require(...)`) or an index expression (`M.new(...)`,
    // `obj:method(...)`). The old `childForFieldName("function") || ... ||
    // namedChild(0)` reached the right node only by accident, through the
    // fallback, which is exactly the arrangement that hid the other four.
    const functionNode = node.childForFieldName("name") || node.namedChild(0)
    if (!functionNode) return
    const callName = functionNode.text
    if (!callName) return
    this.detectFrameworks(callName, ctx)

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
      this.addRelationship(ctx, source, callName, ASTEngine.RelationshipType.Calls, { luaSpecific: true })
    }

    if (callName === "coroutine.create" || callName === "coroutine.wrap") {
      ctx.patterns.add("Coroutines")
    }
    if (callName === "setmetatable") {
      ctx.patterns.add("Object-Oriented Programming (Metatables)")
      const target = values[0]
      const metatable = values[1]
      if (target && metatable && !this.isTableNode(target)) {
        this.addRelationship(ctx, target.text, metatable.text, ASTEngine.RelationshipType.Extends, { luaSpecific: true, relationshipType: "lua_metatable" })
      }
      if (metatable?.type === "identifier") {
        const tableName = metatable.text
        ctx.declaredTables.add(tableName)
      }
    }

    const constructor = this.constructorTarget(functionNode, ctx)
    if (constructor) {
      this.addRelationship(ctx, source, constructor, ASTEngine.RelationshipType.Instantiates, { luaSpecific: true, relationshipType: "instantiates" })
    }

    if (callName === "class" || callName === "Object:extend" || callName === "Object.extend") {
      const className = firstString
      if (className) {
        ctx.symbols.push({
          name: className,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          scope: source,
          ownerName: frame.callable,
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
    this.addRelationship(ctx, frame.callable || "global", moduleName, ASTEngine.RelationshipType.Imports, { luaSpecific: true, relationshipType: "lua_require" })
    if (moduleName.startsWith("resty")) ctx.frameworks.add("OpenResty")
    if (moduleName === "socket" || moduleName === "lfs" || moduleName === "cjson" || moduleName === "ssl") ctx.frameworks.add("LuaRocks Core Modules")
    if (moduleName === "lapis") ctx.frameworks.add("Lapis")
    if (moduleName === "middleclass" || moduleName === "classic" || moduleName === "30log") ctx.patterns.add("Object-Oriented Programming (Libraries)")
    if (moduleName === "hs" || moduleName.startsWith("hs.")) ctx.frameworks.add("Hammerspoon")
    if (moduleName.startsWith("lovr")) ctx.frameworks.add("LÖVR (VR/AR)")
  }

  private constructorTarget(functionNode: Node, ctx: LuaContext): string | undefined {
    if (!["dot_index_expression", "method_index_expression"].includes(functionNode.type)) return undefined
    const method = functionNode.childForFieldName("method") || functionNode.childForFieldName("field")
    const table = functionNode.childForFieldName("table")
    if ((method?.text === "new" || method?.text === "constructor") && table?.text && ctx.declaredTables.has(table.text)) return table.text
    return undefined
  }

  private extractExport(node: Node, frame: LuaFrame, ctx: LuaContext): void {
    if (frame.callable) return
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
    }
  }

  private addContainsRelationships(ctx: LuaContext): void {
    for (const symbol of ctx.symbols) {
      const owner = symbol.ownerName || (symbol.scope && symbol.scope !== "global" ? symbol.scope : "global")
      if (owner && owner !== symbol.name) {
        this.addRelationship(ctx, owner, symbol.name, ASTEngine.RelationshipType.Contains, {})
      }
    }
  }

  private addRelationship(ctx: LuaContext, source: string, target: string, type: ASTEngine.RelationshipType, metadata: Record<string, any>): void {
    if (!source || !target) return
    const key = `${type}\u001f${source}\u001f${target}`
    if (ctx.seenRelationships.has(key)) return
    ctx.seenRelationships.add(key)
    ctx.relationships.push({ source, target, type, confidence: 1.0, metadata })
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

  private functionOwner(nameNode: Node): string | undefined {
    if (!["dot_index_expression", "method_index_expression"].includes(nameNode.type)) return undefined
    return nameNode.childForFieldName("table")?.text
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

  // M60 LUA-00: reach a child by node TYPE. The five field literals this
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

  private detectFrameworks(text: string, ctx: LuaContext): void {
    if (text.startsWith("love.")) ctx.frameworks.add("Love2D")
    if (text.startsWith("ngx.") || text.startsWith("resty.")) ctx.frameworks.add("OpenResty")
    if (text === "CreateFrame" || text === "UIParent" || text === "C_Timer" || text === "GetTime") ctx.frameworks.add("World of Warcraft Addon")
    if (text === "Proto" || text === "DissectorTable") ctx.frameworks.add("Wireshark Plugin")
    if (text.startsWith("redis.call")) ctx.frameworks.add("Redis Scripting")
    if (text.startsWith("display.") || text.startsWith("Runtime:") || text.startsWith("system.") || text.startsWith("transition.")) ctx.frameworks.add("Corona SDK / Solar2D")
    if (text.startsWith("vim.") || text === "use" || text === "setup") ctx.frameworks.add("Neovim Configuration")
    if (text.startsWith("lovr.")) ctx.frameworks.add("LÖVR (VR/AR)")
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

  private countCoroutineSymbols(ctx: LuaContext): number {
    let count = 0
    for (const symbol of ctx.symbols) if (symbol.metadata?.isCoroutine) count++
    return count
  }

  private calculateArchitecturalScore(ctx: LuaContext): number {
    let score = 70
    if (ctx.relationships.length > 0) score += 10
    if (ctx.exports.length > 0) score += 5
    if (ctx.patterns.has("Object-Oriented Programming (Metatables)")) score += 10
    if (ctx.patterns.has("Module/Table Pattern")) score += 5
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
