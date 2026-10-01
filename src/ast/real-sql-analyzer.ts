import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

type SqlSymbol = ASTEngine.UniversalSymbol
type SqlRelationship = ASTEngine.UniversalRelationship

type ParseState = {
  symbols: SqlSymbol[]
  relationships: SqlRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  relationshipKeys: Set<string>
  relationshipsByKey: Map<string, SqlRelationship>
  symbolKeys: Set<string>
  patterns: Set<string>
  metadata: Partial<ASTEngine.FileMetadata>
}

const SQL_BUILTINS = new Set([
  "abs", "avg", "coalesce", "count", "date", "datetime", "extract", "first_value", "floor",
  "greatest", "ifnull", "least", "lower", "max", "min", "nullif", "rank", "round", "row_number",
  "sum", "trim", "upper", "cast", "convert", "current_date", "current_time", "current_timestamp",
  "json_agg", "json_build_object", "lag", "lead", "length", "now", "percentile_cont", "substring",
])

const identifierTypes = new Set(["identifier", "word"])
const queryTypes = new Set(["select", "set_operation", "create_query", "subquery", "cte"])

export class RealSqlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const state: ParseState = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      relationshipKeys: new Set(),
      relationshipsByKey: new Map(),
      symbolKeys: new Set(),
      patterns: new Set(),
      metadata: {
        linesOfCode: this.countLines(content),
        performanceScore: 100,
        architecturalInsights: [],
        detectedFrameworks: ["SQL"],
        patterns: [],
        complexity: 1,
        cyclomaticComplexity: 1,
      },
    }

    this.collectImports(rootNode, state)
    if (rootNode) this.processRoot(rootNode, state)

    if (state.symbols.filter((s) => s.metadata?.type === "table").length > 2) {
      state.metadata.architecturalInsights!.push("Complex schema detected")
    }
    if (state.patterns.has("Foreign Key Constraints")) {
      state.metadata.architecturalInsights!.push("Relational integrity enforced via Foreign Keys")
    }
    state.metadata.patterns = [...state.patterns].sort()
    state.metadata.complexity = Math.max(1, state.metadata.cyclomaticComplexity ?? 1)

    return {
      symbols: state.symbols,
      relationships: state.relationships,
      imports: state.imports,
      exports: state.exports,
      metadata: state.metadata,
      errors: [],
    }
  }

  private processRoot(node: Node, state: ParseState): void {
    const stack: Node[] = []
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }

    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === "transaction" || current.type === "block") {
        this.addPattern(current.type === "transaction" ? "Transaction Management" : "Procedural Block", state)
        this.bumpComplexity(current, state)
        for (let i = current.namedChildCount - 1; i >= 0; i--) {
          const child = current.namedChild(i)
          if (child && (child.type === "statement" || child.type === "block" || child.type === "transaction")) stack.push(child)
        }
        continue
      }
      this.processStatement(current, state, null)
    }
  }

  private processStatement(node: Node, state: ParseState, owner: SqlSymbol | null): void {
    if (node.type === "statement") {
      const children = this.namedChildren(node)
      const declaration = children.find((c) => this.isDeclaration(c.type))
      if (declaration) {
        if (queryTypes.has(declaration.type) || declaration.type === "from") this.processQuery(node, state, owner)
        else this.processStatement(declaration, state, owner)
        return
      }
      if (children.some((c) => queryTypes.has(c.type) || c.type === "from" || c.type === "cte")) {
        this.processQuery(node, state, owner)
      }
      return
    }

    switch (node.type) {
      case "create_table":
      case "create_table_statement":
        this.processTable(node, state)
        return
      case "create_view":
      case "create_materialized_view":
        this.processView(node, state)
        return
      case "create_index":
      case "create_index_statement":
        this.processIndex(node, state)
        return
      case "create_function":
      case "create_function_statement":
        this.processFunction(node, state)
        return
      case "create_trigger":
      case "create_trigger_statement":
        this.processTrigger(node, state)
        return
      case "create_type":
      case "create_type_statement":
      case "create_domain_statement":
        this.processType(node, state)
        return
      case "create_schema":
      case "schema":
        this.processNamedContainer(node, ASTEngine.SymbolKind.Namespace, "schema", state)
        return
      case "create_sequence":
        this.processNamedContainer(node, ASTEngine.SymbolKind.Constant, "sequence", state)
        return
      case "create_role":
        this.processNamedContainer(node, ASTEngine.SymbolKind.Namespace, "role", state)
        return
      case "create_extension":
        this.processNamedContainer(node, ASTEngine.SymbolKind.Module, "extension", state)
        return
      case "alter_table":
      case "alter_table_statement":
        this.addPattern("Schema Evolution (ALTER)", state)
        this.recordTableTarget(node, "uses", "alter", state)
        return
      case "drop_table":
      case "drop_view":
      case "drop_index":
      case "drop_type":
      case "drop_schema":
      case "drop_table_statement":
      case "drop_view_statement":
        this.addPattern("Schema Evolution (DROP)", state)
        return
      case "insert":
      case "insert_statement":
        this.recordDml(node, "insert", state)
        return
      case "update":
      case "update_statement":
        this.recordDml(node, "update", state)
        return
      case "delete":
      case "delete_statement":
        this.recordDml(node, "delete", state)
        return
      case "select":
      case "set_operation":
      case "cte":
      case "create_query":
      case "subquery":
        this.processQuery(node, state, owner)
        return
      case "set_statement":
      case "reset_statement":
        this.addPattern("Session Configuration", state)
        return
      case "comment_statement":
        this.addPattern("SQL Documentation", state)
        return
      case "transaction":
      case "block":
        this.addPattern("Transaction Management", state)
        this.bumpComplexity(node, state)
        return
      default:
        if (node.type === "grant" || node.type === "revoke" || node.type === "grant_statement" || node.type === "revoke_statement") {
          this.addPattern("Permissions (GRANT/REVOKE)", state)
        }
    }
  }

  private processTable(node: Node, state: ParseState): void {
    const object = this.directChild(node, "object_reference") ?? this.directChild(node, "identifier")
    const nameNode = object ? this.referenceNameNode(object) : null
    if (!nameNode) return
    const table = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Class, nameNode, null, state, {
      type: "table",
      isSchemaEntity: true,
      qualifiedName: object?.type === "object_reference" ? this.referenceText(object) : nameNode.text,
    })

    const definitions = this.directChild(node, "column_definitions")
    if (definitions) {
      for (const column of this.namedChildren(definitions).filter((c) => c.type === "column_definition")) {
        this.processColumn(column, table, state)
      }
      const tableConstraints = this.directChild(definitions, "constraints")
      if (tableConstraints) {
        for (const constraint of this.namedChildren(tableConstraints).filter((c) => c.type === "constraint")) {
          this.processConstraint(constraint, table, state)
        }
      }
    }

    const legacyColumns = this.namedChildren(node).filter((c) =>
      c.type === "create_table_column_parameter" || c.type === "column_def" || c.type === "column",
    )
    for (const column of legacyColumns) this.processColumn(column, table, state)

    this.addPattern("Tables", state)
  }

  private processColumn(node: Node, table: SqlSymbol, state: ParseState): void {
    const nameNode = node.childForFieldName?.("name") ?? this.firstIdentifier(node)
    if (!nameNode || !identifierTypes.has(nameNode.type)) return
    const typeNode = node.childForFieldName?.("type")
    let isPrimaryKey = false
    let isUnique = false
    let references: string | undefined
    let referenceNode: Node | null = null

    for (const child of this.namedChildren(node)) {
      if (child.type === "keyword_primary" || child.type === "primary_key_constraint") isPrimaryKey = true
      if (child.type === "keyword_unique" || child.type === "unique_constraint") isUnique = true
      if (child.type === "object_reference" && child !== nameNode) {
        referenceNode = child
        references = this.referenceLeaf(child)
      }
      if (child.type === "references_constraint" || child.type === "foreign_key_constraint") {
        const ref = this.firstDescendant(child, "object_reference")
        if (ref) {
          referenceNode = ref
          references = this.referenceLeaf(ref)
        }
      }
    }

    const column = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Property, nameNode, table, state, {
      type: "column",
      sqlType: typeNode?.text,
      isPrimaryKey,
      isUnique,
      references,
    })
    this.addRelationship(ASTEngine.RelationshipType.Contains, table.name, column.name, state)
    if (isPrimaryKey) this.addPattern("Primary Key Constraint", state)
    if (isUnique) this.addPattern("Unique Constraint", state)
    if (references && referenceNode) {
      this.addPattern("Foreign Key Constraints", state)
      this.addRelationship(ASTEngine.RelationshipType.References, table.name, references, state, { constraint: "foreign_key", column: column.name })
    }
  }

  private processConstraint(node: Node, table: SqlSymbol, state: ParseState): void {
    const nameNode = this.constraintNameNode(node)
    const ref = this.firstDescendant(node, "object_reference")
    const reference = ref ? this.referenceLeaf(ref) : undefined
    const hasPrimary = this.containsType(node, "primary_key_constraint") || this.containsType(node, "keyword_primary")
    const hasUnique = this.containsType(node, "keyword_unique") || this.containsType(node, "unique_constraint")
    const hasForeign = !!reference

    if (nameNode) {
      const constraint = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Constant, nameNode, table, state, {
        type: "constraint",
        constraintKind: hasForeign ? "foreign_key" : hasPrimary ? "primary_key" : hasUnique ? "unique" : "check",
      })
      this.addRelationship(ASTEngine.RelationshipType.Contains, table.name, constraint.name, state)
    }
    if (hasPrimary) this.addPattern("Primary Key Constraint", state)
    if (hasUnique) this.addPattern("Unique Constraint", state)
    if (hasForeign) {
      this.addPattern("Foreign Key Constraints", state)
      this.addRelationship(ASTEngine.RelationshipType.References, table.name, reference!, state, { constraint: "foreign_key" })
    }
  }

  private processView(node: Node, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : null
    if (!nameNode) return
    const kind = node.type === "create_materialized_view" ? "materialized_view" : "view"
    const view = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Class, nameNode, null, state, {
      type: kind,
      isSchemaEntity: true,
      qualifiedName: this.referenceText(object!),
    })
    this.addPattern(kind === "view" ? "Views" : "Materialized Views", state)
    const query = this.firstDescendant(node, "create_query")
    if (query) this.processQuery(query, state, view)
  }

  private processIndex(node: Node, state: ParseState): void {
    const identifiers = this.namedChildren(node).filter((c) => c.type === "identifier")
    const nameNode = identifiers[0] ?? this.firstDescendant(node, "identifier")
    const object = this.firstDescendant(node, "object_reference")
    if (!nameNode) return
    const tableName = object ? this.referenceLeaf(object) : undefined
    const index = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Constant, nameNode, null, state, {
      type: "index",
      indexName: nameNode.text,
      table: tableName,
      columns: this.identifierTexts(this.firstDescendant(node, "index_fields")),
    })
    this.addPattern("Custom Indexes", state)
    if (tableName) {
      this.addRelationship(ASTEngine.RelationshipType.References, index.name, tableName, state, { dependency: true, indexOn: tableName })
      this.addRelationship(ASTEngine.RelationshipType.Contains, tableName, index.name, state)
      if (state.metadata.performanceScore !== undefined) state.metadata.performanceScore += 10
    }
    void index
  }

  private processFunction(node: Node, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : null
    if (!nameNode) return
    const args = this.directChild(node, "function_arguments")
    const params: ASTEngine.Parameter[] = []
    if (args) {
      for (const argument of this.namedChildren(args).filter((c) => c.type === "function_argument")) {
        const parameter = argument.childForFieldName?.("name") ?? this.firstIdentifier(argument)
        const type = this.firstTypeNode(argument)
        if (parameter) params.push({ name: parameter.text, type: type?.text })
      }
    }
    const returnType = this.returnTypeNode(node)?.text
    const fn = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Function, nameNode, null, state, {
      functionName: nameNode.text,
      qualifiedName: this.referenceText(object!),
      sqlFunction: true,
    }, { parameters: params, returnType })
    this.addPattern("Stored Functions", state)
    this.processQueryDependencies(node, fn, state)
    this.processCalls(node, fn.name, state)
  }

  private processTrigger(node: Node, state: ParseState): void {
    const references = this.descendants(node, "object_reference")
    const triggerRef = references[0]
    const tableRef = references[1]
    const actionRef = references[2]
    const triggerName = triggerRef ? this.referenceNameNode(triggerRef) : null
    if (!triggerName) return
    const trigger = this.createSymbol(triggerName.text, ASTEngine.SymbolKind.Function, triggerName, null, state, {
      type: "trigger",
      isTrigger: true,
      targetTable: tableRef ? this.referenceLeaf(tableRef) : undefined,
      actionFunction: actionRef ? this.referenceLeaf(actionRef) : undefined,
    })
    this.addPattern("Triggers", state)
    const triggerTarget = tableRef ? this.referenceLeaf(tableRef) : undefined
    const triggerAction = actionRef ? this.referenceLeaf(actionRef) : undefined
    if (triggerTarget) this.addRelationship(ASTEngine.RelationshipType.References, trigger.name, triggerTarget, state, { triggerTarget: true })
    if (triggerAction) this.addRelationship(ASTEngine.RelationshipType.Calls, trigger.name, triggerAction, state, { triggerAction: true })
  }

  private processType(node: Node, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : null
    if (!nameNode) return
    const enumElements = this.firstDescendant(node, "enum_elements")
    const values = this.literalTexts(enumElements)
    this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Type, nameNode, null, state, {
      type: values.length > 0 ? "enum" : "custom_type",
      enumValues: values,
      customType: true,
    })
    this.addPattern(values.length > 0 ? "Enum Types" : "Custom Types", state)
  }

  private processNamedContainer(node: Node, kind: ASTEngine.SymbolKind, type: string, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    this.createSymbol(nameNode.text, kind, nameNode, null, state, { type, isSchemaEntity: true })
    this.addPattern(type === "schema" ? "Schemas" : type === "sequence" ? "Sequences" : type === "extension" ? "Extensions" : "Roles", state)
  }

  private recordDml(node: Node, operation: string, state: ParseState): void {
    const scope = node.parent?.type === "statement" ? node.parent : node
    const target = this.dmlTarget(node) ?? this.referenceLeaf(this.firstDescendant(scope, "object_reference"))
    if (target) this.addRelationship(ASTEngine.RelationshipType.Uses, "global", target, state, { operation, tableReference: true })
    this.addPattern(`${operation.toUpperCase()} Statements`, state)
    const queryRoot = node.parent?.type === "statement" ? node.parent : node
    this.processQueryDependencies(queryRoot, null, state)
  }

  private processQuery(node: Node, state: ParseState, owner: SqlSymbol | null): void {
    if (this.containsType(node, "join")) this.addPattern("Join Query Mapping", state)
    if (this.containsType(node, "cte")) this.addPattern("Common Table Expressions (CTE)", state)
    if (this.containsType(node, "set_operation")) this.addPattern("Set Operations (UNION/INTERSECT/EXCEPT)", state)
    if (this.containsType(node, "subquery")) this.addPattern("Subqueries", state)
    if (this.containsType(node, "case")) this.addPattern("Conditional Logic (CASE/WHEN)", state)
    if (this.containsType(node, "all_fields")) {
      this.addPattern("SELECT *", state)
      if (state.metadata.performanceScore !== undefined) state.metadata.performanceScore = Math.max(0, state.metadata.performanceScore - 30)
      state.metadata.architecturalInsights!.push("SELECT * detected — consider explicit column selection")
    }
    this.bumpComplexity(node, state)
    this.processQueryDependencies(node, owner, state)
    this.processCalls(node, owner?.name ?? "global", state)
  }

  private processQueryDependencies(node: Node, owner: SqlSymbol | null, state: ParseState): void {
    const source = owner?.name ?? "global"
    const localCtes = new Set(this.descendants(node, "cte").map((cte) => this.firstIdentifier(cte)?.text).filter((name): name is string => !!name))
    const relations = this.descendants(node, "relation")
    for (const relation of relations) {
      const object = this.namedChildren(relation).find((c) => c.type === "object_reference")
      if (object) {
        const target = this.referenceLeaf(object)
        if (target && !localCtes.has(target)) this.addRelationship(ASTEngine.RelationshipType.Uses, source, target, state, { tableReference: true })
      }
    }
    const directFrom = this.descendants(node, "from")
    for (const from of directFrom) {
      for (const child of this.namedChildren(from)) {
        if (child.type === "object_reference") {
          const target = this.referenceLeaf(child)
          if (target && !localCtes.has(target)) this.addRelationship(ASTEngine.RelationshipType.Uses, source, target, state, { tableReference: true })
        }
      }
    }
  }

  private processCalls(node: Node, source: string, state: ParseState): void {
    for (const invocation of this.descendants(node, "invocation")) {
      const object = this.directChild(invocation, "object_reference")
      const target = object ? this.referenceLeaf(object) : ""
      if (target && !SQL_BUILTINS.has(target.toLowerCase())) {
        this.addRelationship(ASTEngine.RelationshipType.Calls, source, target, state)
      }
    }
  }

  private recordTableTarget(node: Node, type: "uses" | "references", operation: string, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const target = object ? this.referenceLeaf(object) : undefined
    if (target) this.addRelationship(type === "uses" ? ASTEngine.RelationshipType.Uses : ASTEngine.RelationshipType.References, "global", target, state, { operation, tableReference: true })
  }

  private dmlTarget(node: Node): string | undefined {
    if (node.type === "insert") {
      const object = this.directChild(node, "object_reference")
      return object ? this.referenceLeaf(object) : undefined
    }
    if (node.type === "update") {
      const relation = this.directChild(node, "relation")
      const object = relation ? this.directChild(relation, "object_reference") : this.firstDescendant(node, "object_reference")
      return object ? this.referenceLeaf(object) : undefined
    }
    if (node.type === "delete") {
      const scope = node.parent?.type === "statement" ? node.parent : node
      return this.referenceLeaf(this.firstDescendant(scope, "object_reference"))
    }
    return this.referenceLeaf(this.firstDescendant(node, "object_reference"))
  }

  private parentFrom(node: Node): Node | null {
    let current = node.parent
    while (current) {
      if (current.type === "from") return current
      current = current.parent
    }
    return null
  }

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: SqlSymbol | null,
    state: ParseState,
    metadata: Record<string, any> = {},
    extra: Partial<SqlSymbol> = {},
  ): SqlSymbol {
    const identity = `${node.startIndex}:${kind}:${name}:${parent?.name ?? ""}`
    if (state.symbolKeys.has(identity)) return state.symbols.find((s) => s.name === name && s.kind === kind && s.ownerName === parent?.name)!
    state.symbolKeys.add(identity)
    const symbol: SqlSymbol = {
      name,
      kind,
      range: this.range(node),
      parentId: parent ? `${parent.id}.${name}` : undefined,
      ownerName: parent?.name,
      ownerKind: parent?.kind,
      parent: parent?.name,
      metadata,
      ...extra,
    }
    symbol.id = symbol.parentId ?? name
    state.symbols.push(symbol)
    if (parent) this.addRelationship(ASTEngine.RelationshipType.Contains, parent.name, name, state)
    return symbol
  }

  private addRelationship(type: ASTEngine.RelationshipType, source: string, target: string, state: ParseState, metadata: Record<string, any> = {}): void {
    if (!source || !target || source === target && type === ASTEngine.RelationshipType.Contains) return
    const key = `${type}\u0000${source}\u0000${target}`
    const existing = state.relationshipsByKey.get(key)
    if (existing) {
      if (metadata.operation) {
        const operations = Array.isArray(existing.metadata?.operations) ? existing.metadata.operations : existing.metadata?.operation ? [existing.metadata.operation] : []
        if (!operations.includes(metadata.operation)) existing.metadata = { ...existing.metadata, operations: [...operations, metadata.operation] }
      }
      return
    }
    state.relationshipKeys.add(key)
    const relationship = { type, source, target, confidence: 1, weight: 1, metadata }
    state.relationshipsByKey.set(key, relationship)
    state.relationships.push(relationship)
  }

  private collectImports(root: Node, state: ParseState): void {
    for (const node of this.descendants(root, "comment").concat(this.descendants(root, "marginalia"))) {
      const text = node.text.trim()
      const isHashImport = text.startsWith("#import ")
      const isAtImport = text.startsWith("@import ")
      if (!isHashImport && !isAtImport) continue
      const start = text.indexOf(" ")
      if (start < 0) continue
      const module = this.stripImportDelimiters(text.slice(start + 1).trim())
      if (!module) continue
      state.imports.push({
        module,
        items: [],
        importType: "sql_import",
        lineNumber: node.startPosition.row + 1,
        isExternal: isAtImport || module.includes("/"),
        range: this.range(node),
      })
    }
  }

  private stripImportDelimiters(value: string): string {
    let start = 0
    let end = value.length
    while (start < end && (value[start] === '"' || value[start] === "'" || value[start] === "<")) start++
    while (end > start && (value[end - 1] === '"' || value[end - 1] === "'" || value[end - 1] === ">")) end--
    return value.slice(start, end)
  }

  private addPattern(pattern: string, state: ParseState): void {
    state.patterns.add(pattern)
  }

  private bumpComplexity(node: Node, state: ParseState): void {
    const stack: Node[] = [node]
    let increment = 0
    while (stack.length) {
      const current = stack.pop()!
      if (current.type === "case" || current.type === "join" || current.type === "when_clause" || current.type === "set_operation") increment++
      for (let i = 0; i < current.namedChildCount; i++) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    state.metadata.cyclomaticComplexity = (state.metadata.cyclomaticComplexity ?? 1) + increment
  }

  private isDeclaration(type: string): boolean {
    return type.startsWith("create_") || type.startsWith("alter_") || type.startsWith("drop_") || type === "insert" || type === "update" || type === "delete" || type === "select" || type === "set_operation" || type === "cte" || type === "transaction" || type === "block"
  }

  private directChild(node: Node, type: string): Node | null {
    for (const child of this.namedChildren(node)) if (child.type === type) return child
    return null
  }

  private firstIdentifier(node: Node | null): Node | null {
    return node ? this.descendants(node, "identifier")[0] ?? null : null
  }

  private firstTypeNode(node: Node): Node | null {
    for (const child of this.namedChildren(node)) {
      if (child.type === "type" || child.type.startsWith("keyword_") && child.type !== "keyword_default") return child
    }
    return null
  }

  private returnTypeNode(node: Node): Node | null {
    const children = this.namedChildren(node)
    const returns = children.findIndex((c) => c.type === "keyword_returns")
    if (returns >= 0) return children[returns + 1] ?? null
    return null
  }

  private referenceNameNode(node: Node): Node | null {
    if (node.type === "identifier" || node.type === "word") return node
    return node.childForFieldName?.("name") ?? this.lastIdentifier(node)
  }

  private lastIdentifier(node: Node): Node | null {
    const ids = this.descendants(node, "identifier")
    return ids.length ? ids[ids.length - 1] : null
  }

  private referenceLeaf(node: Node | null): string | undefined {
    const name = node ? this.referenceNameNode(node) : null
    return name?.text
  }

  private referenceText(node: Node): string {
    const ids = this.descendants(node, "identifier")
    return ids.map((id) => id.text).join(".")
  }

  private constraintNameNode(node: Node): Node | null {
    const children = this.namedChildren(node)
    const keyword = children.findIndex((c) => c.type === "keyword_constraint")
    if (keyword >= 0) return children.slice(keyword + 1).find((c) => identifierTypes.has(c.type)) ?? null
    return null
  }

  private identifierTexts(node: Node | null): string[] {
    return node ? this.descendants(node, "identifier").map((n) => n.text) : []
  }

  private literalTexts(node: Node | null): string[] {
    return node ? this.descendants(node, "literal").map((n) => n.text) : []
  }

  private containsType(node: Node, type: string): boolean {
    return node.type === type || this.descendants(node, type).length > 0
  }

  private firstDescendant(node: Node, type: string): Node | null {
    if (node.type === type) return node
    return this.descendants(node, type)[0] ?? null
  }

  private descendants(node: Node, type?: string): Node[] {
    const result: Node[] = []
    const stack: Node[] = []
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
    while (stack.length) {
      const current = stack.pop()!
      if (!type || current.type === type) result.push(current)
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return result
  }

  private namedChildren(node: Node): Node[] {
    const result: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) result.push(child)
    }
    return result
  }

  private range(node: Node): SqlSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private countLines(content: string): number {
    let lines = 1
    for (let i = 0; i < content.length; i++) if (content[i] === "\n") lines++
    return lines
  }
}
