// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealSqlAnalyzer implements LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ParseResult, "language" | "metadata"> & { metadata: Partial<FileMetadata> } {
    const symbols: UniversalSymbol[] = []
    const imports: ImportInfo[] = []

    const sql1Matches = content.matchAll(/#import\s+["\x27]?([^"\x27\n]+)["\x27]?/g)
    for (const m of sql1Matches) {
      imports.push({ module: m[1].replace(/["<>]/g, ""), items: [], importType: "sql_import", lineNumber: 0, isExternal: m[0].includes("<") || !m[1].startsWith(".") })
    }
    const sql2Matches = content.matchAll(/@import\s+["\x27]?([^"\x27\n]+)["\x27]?/g)
    for (const m of sql2Matches) {
      imports.push({ module: m[1].replace(/["<>]/g, ""), items: [], importType: "sql_import", lineNumber: 0, isExternal: m[0].includes("<") || !m[1].startsWith(".") })
    }

    const relationships: UniversalRelationship[] = []
    const exports: ExportInfo[] = []
    const patternsObj: Record<string, boolean> = {}

    const metadata: Partial<FileMetadata> = {
      linesOfCode: 0,
      performanceScore: 100,
      architecturalInsights: [],
      detectedFrameworks: ["SQL"],
      patterns: [],
    }

    if (!rootNode) return { symbols, imports, relationships, exports, metadata, errors: [] }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          const errorsArr = (metadata as any).errors || []
          errorsArr.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: n.startPosition.row + 1, startColumn: n.startPosition.column + 1,
              endLine: n.endPosition.row + 1, endColumn: n.endPosition.column + 1,
              startIndex: n.startIndex, endIndex: n.endIndex,
            },
            severity: "warning",
          })
          ;(metadata as any).errors = errorsArr
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    const stack: { node: Node; parentSymbol: UniversalSymbol | null }[] = [
      { node: rootNode, parentSymbol: null },
    ]

    let tableCount = 0
    let lastTableSymbol: UniversalSymbol | null = null

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node: curr, parentSymbol } = popped
      let newParentSymbol = parentSymbol

      if (curr.type === "create_table_statement" || curr.type === "create_table") {
        newParentSymbol = this.handleTable(curr, symbols, relationships, metadata, patternsObj)
        lastTableSymbol = newParentSymbol
        tableCount++
      } else if (curr.type === "create_view_statement" || curr.type === "create_view") {
        newParentSymbol = this.handleView(curr, symbols, relationships, metadata)
      } else if (curr.type === "create_index_statement" || curr.type === "create_index") {
        this.handleIndex(curr, symbols, metadata, patternsObj)
      } else if (curr.type === "select_statement" || curr.type === "select") {
        this.handleSelect(curr, symbols, relationships, metadata, patternsObj, parentSymbol)
      } else if (curr.type === "create_function_statement" || curr.type === "create_function") {
        newParentSymbol = this.handleFunction(curr, symbols, relationships, metadata, patternsObj)
      } else if (curr.type === "create_type_statement" || curr.type === "create_domain_statement") {
        this.handleTypeDomain(curr, symbols)
      } else if (curr.type === "create_trigger_statement" || curr.type === "create_trigger") {
        this.handleTrigger(curr, symbols, patternsObj)
      } else if (curr.type === "create_procedure_statement" || curr.type === "procedure_body") {
        this.handleProcedure(curr, symbols, patternsObj)
      } else if (curr.type === "alter_table_statement" || curr.type === "alter_table") {
        this.handleAlterTable(curr, symbols, metadata, patternsObj)
      } else if (curr.type === "drop_table_statement" || curr.type === "drop_view_statement" || curr.type === "drop_table" || curr.type === "drop_view") {
        patternsObj["Schema Evolution (DROP)"] = true
      } else if (curr.type === "cte" || curr.type === "with_clause" || curr.type === "common_table_expression") {
        patternsObj["Common Table Expressions (CTE)"] = true
        const cteName = this.getIdentifier(curr)
        if (cteName) {
          this.createSymbol(cteName.text, SymbolKind.Function, curr, parentSymbol || null, symbols, { isCTE: true })
        }
      } else if (curr.type === "union" || curr.type === "intersect" || curr.type === "except") {
        patternsObj["Set Operations (UNION/INTERSECT/EXCEPT)"] = true
      } else if (curr.type === "grant" || curr.type === "grant_statement" || curr.type === "revoke" || curr.type === "revoke_statement") {
        patternsObj["Permissions (GRANT/REVOKE)"] = true
      } else if (curr.type === "schema" || curr.type === "create_schema") {
        const schemaName = this.getIdentifier(curr)
        if (schemaName) {
          this.createSymbol(schemaName.text, SymbolKind.Namespace, curr, null, symbols, { isSchema: true })
        }
      } else if (curr.type === "begin" || curr.type === "start_transaction" || curr.type === "commit" || curr.type === "rollback") {
        patternsObj["Transaction Management"] = true
      } else if (curr.type === "case_expression" || curr.type === "case_statement" || curr.type === "case_when") {
        patternsObj["Conditional Logic (CASE/WHEN)"] = true
      } else if (curr.type === "subquery" || curr.type === "scalar_subquery") {
        patternsObj["Subqueries"] = true
      } else if (
        curr.type === "insert_statement" ||
        curr.type === "update_statement" ||
        curr.type === "delete_statement" ||
        curr.type === "update" ||
        curr.type === "delete" ||
        curr.type === "insert"
      ) {
        this.handleDML(curr, symbols)
      } else if (curr.type === "ERROR") {
        if (curr.text.toUpperCase().indexOf("UNIQUE") !== -1) {
          patternsObj["Unique Constraint"] = true
          const pTable = newParentSymbol || lastTableSymbol
          if (pTable && pTable.kind === SymbolKind.Class) {
            let currentLine = ""
            const rawText = curr.text + "\n"
            for (let i = 0; i < rawText.length; i++) {
              const char = rawText[i]
              if (char === "\n" || char === ",") {
                if (currentLine.toUpperCase().indexOf("UNIQUE") !== -1) {
                  const trimmed = currentLine.trim()
                  let spaceIdx = 0
                  for (let k = 0; k < trimmed.length; k++) {
                    if (trimmed[k] === " " || trimmed[k] === "\t") {
                      spaceIdx = k
                      break
                    }
                  }
                  if (spaceIdx > 0) {
                    const colName = trimmed.substring(0, spaceIdx)
                    if (
                      colName &&
                      colName.toUpperCase() !== "UNIQUE" &&
                      colName.toUpperCase() !== "CONSTRAINT" &&
                      colName.toUpperCase() !== "CREATE"
                    ) {
                      this.createSymbol(colName, SymbolKind.Property, curr, pTable, symbols, {
                        type: "column",
                        isUnique: true,
                      })
                    }
                  }
                }
                currentLine = ""
              } else {
                currentLine += char
              }
            }
          }
        }
      } else if (curr.type === "statement") {
        const stmtChild = curr.namedChild(0)
        if (stmtChild) {
          if (stmtChild.type === "create_table") {
            newParentSymbol = this.handleTable(stmtChild, symbols, relationships, metadata, patternsObj)
            lastTableSymbol = newParentSymbol
            tableCount++
          } else if (stmtChild.type === "create_view") {
            newParentSymbol = this.handleView(stmtChild, symbols, relationships, metadata)
          } else if (stmtChild.type === "create_index") {
            this.handleIndex(stmtChild, symbols, metadata, patternsObj)
          } else if (stmtChild.type === "select") {
            this.handleSelect(stmtChild, symbols, relationships, metadata, patternsObj, parentSymbol)
          } else if (stmtChild.type === "create_function") {
            newParentSymbol = this.handleFunction(stmtChild, symbols, relationships, metadata, patternsObj)
          } else if (stmtChild.type === "update" || stmtChild.type === "delete" || stmtChild.type === "insert") {
            this.handleDML(stmtChild, symbols)
          } else if (stmtChild.type === "create_trigger") {
            this.handleTrigger(stmtChild, symbols, patternsObj)
          } else if (stmtChild.type === "procedure_body" || stmtChild.type === "create_procedure") {
            this.handleProcedure(stmtChild, symbols, patternsObj)
          } else if (stmtChild.type === "alter_table") {
            this.handleAlterTable(stmtChild, symbols, metadata, patternsObj)
          } else if (stmtChild.type === "cte" || stmtChild.type === "with_clause") {
            patternsObj["Common Table Expressions (CTE)"] = true
          }
        }
      }

      for (let i = curr.childCount - 1; i >= 0; i--) {
        const child = curr.child(i)
        if (child) stack.push({ node: child, parentSymbol: newParentSymbol })
      }
    }

    if (tableCount > 2) {
      metadata.architecturalInsights!.push("Complex schema detected")
    }

    for (const p in patternsObj) {
      metadata.patterns!.push(p)
    }

    return {
      symbols,
      relationships,
      imports,
      exports,
      metadata,
      errors: (metadata as any).errors || [],
    }
  }

  private createSymbol(
    name: string,
    kind: SymbolKind,
    node: Node,
    parent: UniversalSymbol | null,
    symbols: UniversalSymbol[],
    meta: Record<string, any> = {},
  ): UniversalSymbol {
    const symbol: UniversalSymbol = {
      id: parent ? `${parent.id}.${name}` : name,
      name,
      kind,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
      parentId: parent ? parent.id : undefined,
      ownerName: parent ? parent.name : undefined,
      parent: parent ? parent.name : undefined,
      metadata: meta,
    }
    symbols.push(symbol)
    return symbol
  }

  private getIdentifier(node: Node): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "identifier" || c.type === "word" || c.type === "string")) return c
    }
    return null
  }

  private handleTable(
    node: Node,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    metadata: Partial<FileMetadata>,
    patternsObj: Record<string, boolean>,
  ): UniversalSymbol | null {
    let nameNode: Node | null = this.getIdentifier(node)

    // SQLite: table name might be inside an object_reference
    if (!nameNode) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && c.type === "object_reference") {
          nameNode = this.getIdentifier(c)
        }
      }
    }
    if (!nameNode) return null

    let hasPrimaryKey = false
    let hasForeignKey = false

    const tableSymbol = this.createSymbol(nameNode.text, SymbolKind.Class, nameNode, null, symbols, {
      type: "table",
      isSchemaEntity: true,
    })

    let hasErrorNode = false
    const queue: Node[] = [node]
    while (queue.length > 0) {
      const curr = queue.pop()
      if (!curr) continue

      if (curr.type === "ERROR") {
        hasErrorNode = true
      }

      if (
        curr.type === "create_table_column_parameter" ||
        curr.type === "column_definition" ||
        curr.type === "column_def" ||
        curr.type === "column"
      ) {
        const colNameNode = this.getIdentifier(curr)
        if (colNameNode) {
          let isPK = false
          let isUnique = false
          let references: string | undefined = undefined

          const colText = curr.text.toUpperCase()
          if (colText.indexOf("PRIMARY KEY") !== -1) {
            isPK = true
            hasPrimaryKey = true
            patternsObj["Primary Key Constraint"] = true
          }
          if (colText.indexOf("UNIQUE") !== -1) {
            isUnique = true
            patternsObj["Unique Constraint"] = true
          }
          for (let k = 0; k < curr.childCount; k++) {
            const c = curr.child(k)
            if (c && c.type === "unique_constraint") {
              isUnique = true
              patternsObj["Unique Constraint"] = true
            }
          }
          if (colText.indexOf("REFERENCES") !== -1) {
            hasForeignKey = true
            patternsObj["Foreign Key Constraints"] = true
            for (let j = 0; j < curr.childCount; j++) {
              const child = curr.child(j)
              if (child && child.type === "references_constraint") {
                const refName = this.getIdentifier(child)
                if (refName) references = refName.text
              }
            }
            if (!references) {
              // Try to extract from text like "REFERENCES users(id)"
              const match = curr.text.match(/REFERENCES\s+([a-zA-Z0-9_]+)/i)
              if (match) references = match[1]
            }
          }

          this.createSymbol(colNameNode.text, SymbolKind.Property, colNameNode, tableSymbol, symbols, {
            type: "column",
            isPrimaryKey: isPK,
            isUnique,
            references,
          })
        }
      } else if (curr.type === "references_constraint" || curr.type === "foreign_key_constraint") {
        patternsObj["Foreign Key Constraints"] = true
        let tableRefNode = this.getIdentifier(curr)
        if (!tableRefNode) {
          for (let j = 0; j < curr.childCount; j++) {
            const child = curr.child(j)
            if (child && child.type === "object_reference") {
              tableRefNode = this.getIdentifier(child)
            }
          }
        }
        if (tableRefNode) {
          hasForeignKey = true
          relationships.push({
            type: RelationshipType.Uses,
            source: tableSymbol.name,
            target: tableRefNode.text,
            isExternal: true,
            weight: 1,
            metadata: { constraint: "foreign_key", isForeignKey: true },
          })
        }
      } else if (curr.type === "primary_key_constraint") {
        hasPrimaryKey = true
        patternsObj["Primary Key Constraint"] = true
      }

      for (let i = curr.childCount - 1; i >= 0; i--) {
        const child = curr.child(i)
        if (child) queue.push(child)
      }
    }

    // Fallback for badly parsed trees containing ERROR nodes (like VARCHAR(50) UNIQUE)
    if (hasErrorNode) {
      const textUpper = node.text.toUpperCase()
      if (textUpper.indexOf("UNIQUE") !== -1) {
        patternsObj["Unique Constraint"] = true

        let inParens = 0
        let currentLine = ""
        const rawText = node.text
        for (let i = 0; i < rawText.length; i++) {
          const char = rawText[i]
          if (char === "(") inParens++
          else if (char === ")") inParens--

          if (char === "\n" || char === ",") {
            if (currentLine.toUpperCase().indexOf("UNIQUE") !== -1) {
              const trimmed = currentLine.trim()
              let spaceIdx = 0
              for (let k = 0; k < trimmed.length; k++) {
                if (trimmed[k] === " " || trimmed[k] === "\t") {
                  spaceIdx = k
                  break
                }
              }
              if (spaceIdx > 0) {
                const colName = trimmed.substring(0, spaceIdx)
                if (
                  colName &&
                  colName.toUpperCase() !== "UNIQUE" &&
                  colName.toUpperCase() !== "CONSTRAINT" &&
                  colName.toUpperCase() !== "CREATE"
                ) {
                  // Check if we didn't already extract it
                  let exists = false
                  for (let j = 0; j < symbols.length; j++) {
                    if (
                      symbols[j].name === colName &&
                      symbols[j].kind === SymbolKind.Property &&
                      symbols[j].parentId === tableSymbol.id
                    ) {
                      symbols[j].metadata = symbols[j].metadata || {}
                      symbols[j].metadata!.isUnique = true
                      exists = true
                      break
                    }
                  }
                  if (!exists) {
                    this.createSymbol(colName, SymbolKind.Property, node, tableSymbol, symbols, {
                      type: "column",
                      isUnique: true,
                    })
                  }
                }
              }
            }
            currentLine = ""
          } else {
            currentLine += char
          }
        }
      }
    }

    if (hasForeignKey) {
      let found = false
      if (metadata.architecturalInsights) {
        for (let i = 0; i < metadata.architecturalInsights.length; i++) {
          if (metadata.architecturalInsights[i].indexOf("Relational integrity") !== -1) found = true
        }
        if (!found) metadata.architecturalInsights.push("Relational integrity enforced via Foreign Keys")
      }
    }

    let normalizationScore = 50
    if (hasPrimaryKey) normalizationScore += 10
    if (hasForeignKey) normalizationScore += 20
    ;(metadata as any).normalizationScore = normalizationScore

    return tableSymbol
  }

  private handleView(
    node: Node,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    metadata: Partial<FileMetadata>,
  ): UniversalSymbol | null {
    const nameNode = this.getIdentifier(node)
    if (!nameNode) return null

    const viewSymbol = this.createSymbol(nameNode.text, SymbolKind.Class, nameNode, null, symbols, {
      type: "view",
      isSchemaEntity: true,
    })

    let queryNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "select_statement" || c.type === "select")) queryNode = c
    }
    if (queryNode) {
      this.handleSelect(queryNode, symbols, relationships, metadata, {}, viewSymbol)
    }

    return viewSymbol
  }

  private handleIndex(
    node: Node,
    symbols: UniversalSymbol[],
    metadata: Partial<FileMetadata>,
    patternsObj: Record<string, boolean>,
  ) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, SymbolKind.Constant, nameNode, null, symbols, {
        type: "index",
        indexName: nameNode.text,
      })
      patternsObj["Custom Indexes"] = true

      if (metadata.performanceScore !== undefined) {
        metadata.performanceScore += 10
      }
    }
  }

  private handleFunction(
    node: Node,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    metadata: Partial<FileMetadata>,
    patternsObj: Record<string, boolean>,
  ): UniversalSymbol | null {
    const nameNode = this.getIdentifier(node)
    if (!nameNode) return null

    const fnName = nameNode.text
    const fnSymbol = this.createSymbol(fnName, SymbolKind.Function, nameNode, null, symbols, {
      functionName: fnName,
    })

    let paramsNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "parameters") paramsNode = c
    }

    if (paramsNode) {
      const queue: Node[] = [paramsNode]
      while (queue.length > 0) {
        const curr = queue.pop()!
        if (curr.type === "identifier" || curr.type === "word") {
          this.createSymbol(curr.text, SymbolKind.Variable, curr, fnSymbol, symbols, { parameter: true })
        }
        for (let i = curr.childCount - 1; i >= 0; i--) {
          const child = curr.child(i)
          if (child) queue.push(child)
        }
      }
    }

    let bodyNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "body") bodyNode = c
    }

    if (bodyNode) {
      const queue: Node[] = [bodyNode]
      while (queue.length > 0) {
        const curr = queue.pop()!
        if (curr.type === "select_statement" || curr.type === "select") {
          this.handleSelect(curr, symbols, relationships, metadata, patternsObj, fnSymbol)
        } else if (curr.type === "identifier" || curr.type === "word") {
          relationships.push({
            type: RelationshipType.Uses,
            source: fnSymbol.name,
            target: curr.text,
            isExternal: true,
            weight: 1,
            metadata: {},
          })
        }
        for (let i = curr.childCount - 1; i >= 0; i--) {
          const child = curr.child(i)
          if (child) queue.push(child)
        }
      }
    }

    return fnSymbol
  }

  private handleTrigger(node: Node, symbols: UniversalSymbol[], patternsObj: Record<string, boolean>) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, SymbolKind.Function, nameNode, null, symbols, { isTrigger: true })
      patternsObj["Triggers"] = true
    }
  }

  private handleProcedure(node: Node, symbols: UniversalSymbol[], patternsObj: Record<string, boolean>) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, SymbolKind.Function, nameNode, null, symbols, { isProcedure: true })
      patternsObj["Stored Procedures"] = true
    }
  }

  private handleAlterTable(node: Node, symbols: UniversalSymbol[], metadata: Partial<FileMetadata>, patternsObj: Record<string, boolean>) {
    patternsObj["Schema Evolution (ALTER)"] = true
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(`ALTER_${nameNode.text}`, SymbolKind.Class, node, null, symbols, { isAlterTable: true, targetTable: nameNode.text })
    }
  }

  private handleTypeDomain(node: Node, symbols: UniversalSymbol[]) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, SymbolKind.Type, nameNode, null, symbols, { customType: true })
    }
  }

  private handleDML(node: Node, symbols: UniversalSymbol[]) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, SymbolKind.Variable, nameNode, null, symbols, {
        isDML: true,
      })
    }
  }

  private handleSelect(
    node: Node,
    symbols: UniversalSymbol[],
    relationships: UniversalRelationship[],
    metadata: Partial<FileMetadata>,
    patternsObj: Record<string, boolean>,
    parentSymbol: UniversalSymbol | null,
  ) {
    const name = "query_" + node.startPosition.row
    this.createSymbol(name, SymbolKind.Function, node, parentSymbol, symbols, {
      isQuery: true,
    })

    const queue: Node[] = [node]
    while (queue.length > 0) {
      const curr = queue.pop()
      if (!curr) continue

      const upperText = curr.text.toUpperCase()
      if (curr.type === "join_clause" || curr.type === "join") {
        patternsObj["Join Query Mapping"] = true
      }

      if (curr.type === "select_list" || curr.type === "select_clause" || curr.type === "select") {
        for (let i = 0; i < curr.namedChildCount; i++) {
          const child = curr.namedChild(i)
          if (child && (child.type === "asterisk" || (child.type === "all" && child.text === "*"))) {
            if (metadata.performanceScore !== undefined && (metadata.performanceScore as number) > 75) {
              metadata.performanceScore = (metadata.performanceScore as number) - 30
            }
            metadata.architecturalInsights = metadata.architecturalInsights || []
            metadata.architecturalInsights.push("SELECT * detected — consider explicit column selection")
          }
        }
      }

      for (let i = curr.childCount - 1; i >= 0; i--) {
        const child = curr.child(i)
        if (child) queue.push(child)
      }
    }

    if (parentSymbol) {
      let fromClause: Node | null = null
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && (c.type === "from_clause" || c.type === "from")) fromClause = c
      }
      if (fromClause) {
        const localQueue: Node[] = [fromClause]
        while (localQueue.length > 0) {
          const curr = localQueue.pop()!
          if (curr.type === "identifier" || curr.type === "word") {
            relationships.push({
              type: RelationshipType.Uses,
              source: parentSymbol.name,
              target: curr.text,
              isExternal: true,
              weight: 1,
              metadata: { tableReference: true },
            })
          }
          for (let i = curr.childCount - 1; i >= 0; i--) {
            const child = curr.child(i)
            if (child) localQueue.push(child)
          }
        }
      }
    }
  }
}
