import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealSqlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []

    // SQL imports — non-standard #import/@import directives
    // Extracted via AST comment nodes, pure string ops (zero regex)
    const walkForImports = (node: Node) => {
      if (node.type === "comment" || node.type === "marginalia") {
        const txt = node.text.trim()
        if (txt.startsWith("#import ") || txt.startsWith("@import ")) {
          const spaceIdx = txt.indexOf(" ")
          if (spaceIdx !== -1) {
            let path = txt.substring(spaceIdx + 1).trim()
            // Strip quotes and angle brackets (pure string ops)
            let cleaned = ""
            for (let i = 0; i < path.length; i++) {
              const ch = path[i]
              if (ch !== '"' && ch !== "'" && ch !== "<" && ch !== ">") cleaned += ch
            }
            const isExternal = txt.startsWith("@") || cleaned.includes("/")
            imports.push({ module: cleaned, items: [], importType: "sql_import", lineNumber: 0, isExternal })
          }
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) walkForImports(child)
      }
    }
    walkForImports(rootNode)

    const relationships: ASTEngine.UniversalRelationship[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const patternsObj: Record<string, boolean> = {}

    const metadata: Partial<ASTEngine.FileMetadata> = {
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

    const stack: { node: Node; parentSymbol: ASTEngine.UniversalSymbol | null }[] = [
      { node: rootNode, parentSymbol: null },
    ]

    let tableCount = 0
    let lastTableSymbol: ASTEngine.UniversalSymbol | null = null

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
        this.handleIndex(curr, symbols, relationships, metadata, patternsObj)
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
          this.createSymbol(cteName.text, ASTEngine.SymbolKind.Function, curr, parentSymbol || null, symbols, { isCTE: true })
        }
      } else if (curr.type === "union" || curr.type === "intersect" || curr.type === "except") {
        patternsObj["Set Operations (UNION/INTERSECT/EXCEPT)"] = true
      } else if (curr.type === "grant" || curr.type === "grant_statement" || curr.type === "revoke" || curr.type === "revoke_statement") {
        patternsObj["Permissions (GRANT/REVOKE)"] = true
      } else if (curr.type === "schema" || curr.type === "create_schema") {
        const schemaName = this.getIdentifier(curr)
        if (schemaName) {
          this.createSymbol(schemaName.text, ASTEngine.SymbolKind.Namespace, curr, null, symbols, { isSchema: true })
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
          if (pTable && pTable.kind === ASTEngine.SymbolKind.Class) {
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
                      this.createSymbol(colName, ASTEngine.SymbolKind.Property, curr, pTable, symbols, {
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
            this.handleIndex(stmtChild, symbols, relationships, metadata, patternsObj)
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

    // Add Contains for table→column relationships
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({ source: _owner, target: s.name, type: ASTEngine.RelationshipType.Contains, confidence: 1.0, metadata: {} })
      }
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
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    symbols: ASTEngine.UniversalSymbol[],
    meta: Record<string, any> = {},
  ): ASTEngine.UniversalSymbol {
    const symbol: ASTEngine.UniversalSymbol = {
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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    patternsObj: Record<string, boolean>,
  ): ASTEngine.UniversalSymbol | null {
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

    const tableSymbol = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Class, nameNode, null, symbols, {
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
              // Fallback: extract REFERENCES target via pure string ops (no regex)
              const refIdx = curr.text.toUpperCase().indexOf("REFERENCES")
              if (refIdx !== -1) {
                const afterRef = curr.text.substring(refIdx + 10).trim()
                let wordEnd = 0
                while (wordEnd < afterRef.length && 
                       ((afterRef[wordEnd] >= "a" && afterRef[wordEnd] <= "z") ||
                        (afterRef[wordEnd] >= "A" && afterRef[wordEnd] <= "Z") ||
                        (afterRef[wordEnd] >= "0" && afterRef[wordEnd] <= "9") ||
                        afterRef[wordEnd] === "_")) {
                  wordEnd++
                }
                if (wordEnd > 0) references = afterRef.substring(0, wordEnd)
              }
            }
          }

          this.createSymbol(colNameNode.text, ASTEngine.SymbolKind.Property, colNameNode, tableSymbol, symbols, {
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
            type: ASTEngine.RelationshipType.Uses,
            source: tableSymbol.name,
            target: tableRefNode.text,
            isExternal: true,
            weight: 1,
            metadata: { constraint: "foreign_key", isForeignKey: true },
          })
          relationships.push({
            type: ASTEngine.RelationshipType.References,
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
                      symbols[j].kind === ASTEngine.SymbolKind.Property &&
                      symbols[j].parentId === tableSymbol.id
                    ) {
                      symbols[j].metadata = symbols[j].metadata || {}
                      symbols[j].metadata!.isUnique = true
                      exists = true
                      break
                    }
                  }
                  if (!exists) {
                    this.createSymbol(colName, ASTEngine.SymbolKind.Property, node, tableSymbol, symbols, {
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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
  ): ASTEngine.UniversalSymbol | null {
    const nameNode = this.getIdentifier(node)
    if (!nameNode) return null

    const viewSymbol = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Class, nameNode, null, symbols, {
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
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    patternsObj: Record<string, boolean>,
  ) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      const indexSymbol = this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Constant, nameNode, null, symbols, {
        type: "index",
        indexName: nameNode.text,
      })
      patternsObj["Custom Indexes"] = true

      // Extract table name the index is on: CREATE INDEX idx ON table_name (...)
      // Tree-sitter-sql: create_index_statement → [identifier idx, identifier table, parameters (...)]
      // The second identifier (after the index name) is the table name
      let tableName = ""
      let foundFirstName = false
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && (c.type === "identifier" || c.type === "word")) {
          if (!foundFirstName) {
            foundFirstName = true
          } else {
            tableName = c.text
            break
          }
        }
      }
      if (tableName) {
        relationships.push({
          type: ASTEngine.RelationshipType.References,
          source: indexSymbol.name,
          target: tableName,
          isExternal: false,
          weight: 1,
          metadata: { dependency: true, indexOn: tableName },
        })
      }

      if (metadata.performanceScore !== undefined) {
        metadata.performanceScore += 10
      }
    }
  }

  private handleFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    patternsObj: Record<string, boolean>,
  ): ASTEngine.UniversalSymbol | null {
    const nameNode = this.getIdentifier(node)
    if (!nameNode) return null

    const fnName = nameNode.text
    const fnSymbol = this.createSymbol(fnName, ASTEngine.SymbolKind.Function, nameNode, null, symbols, {
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
          this.createSymbol(curr.text, ASTEngine.SymbolKind.Variable, curr, fnSymbol, symbols, { parameter: true })
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
            type: ASTEngine.RelationshipType.Uses,
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

  private handleTrigger(node: Node, symbols: ASTEngine.UniversalSymbol[], patternsObj: Record<string, boolean>) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Function, nameNode, null, symbols, { isTrigger: true })
      patternsObj["Triggers"] = true
    }
  }

  private handleProcedure(node: Node, symbols: ASTEngine.UniversalSymbol[], patternsObj: Record<string, boolean>) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Function, nameNode, null, symbols, { isProcedure: true })
      patternsObj["Stored Procedures"] = true
    }
  }

  private handleAlterTable(node: Node, symbols: ASTEngine.UniversalSymbol[], metadata: Partial<ASTEngine.FileMetadata>, patternsObj: Record<string, boolean>) {
    patternsObj["Schema Evolution (ALTER)"] = true
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(`ALTER_${nameNode.text}`, ASTEngine.SymbolKind.Class, node, null, symbols, { isAlterTable: true, targetTable: nameNode.text })
    }
  }

  private handleTypeDomain(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Type, nameNode, null, symbols, { customType: true })
    }
  }

  private handleDML(node: Node, symbols: ASTEngine.UniversalSymbol[]) {
    const nameNode = this.getIdentifier(node)
    if (nameNode) {
      this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Variable, nameNode, null, symbols, {
        isDML: true,
      })
    }
  }

  private handleSelect(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    patternsObj: Record<string, boolean>,
    parentSymbol: ASTEngine.UniversalSymbol | null,
  ) {
    const name = "query_" + node.startPosition.row
    this.createSymbol(name, ASTEngine.SymbolKind.Function, node, parentSymbol, symbols, {
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
              type: ASTEngine.RelationshipType.Uses,
              source: parentSymbol.name,
              target: curr.text,
              isExternal: true,
              weight: 1,
              metadata: { tableReference: true },
            })
            // View/Function depends on the tables it queries
            if (parentSymbol.metadata?.type === "view" || parentSymbol.metadata?.functionName) {
              relationships.push({
                type: ASTEngine.RelationshipType.References,
                source: parentSymbol.name,
                target: curr.text,
                isExternal: true,
                weight: 1,
                metadata: { dependency: true, tableReference: true },
              })
            }
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
