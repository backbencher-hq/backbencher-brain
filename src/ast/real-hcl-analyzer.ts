import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * REAL HCL / TERRAFORM ANALYZER — pure Tree-sitter AST extraction.
 *
 * The vendored `tree-sitter-hcl` grammar emits a `config_file` → `body` tree:
 *   - `block`        = `identifier` (block type) + zero or more `string_lit`
 *                      labels + a nested `body`.
 *   - `attribute`    = `identifier` (key) + `expression`.
 *   - expressions    = `variable_expr` (identifier base + `get_attr` chains),
 *                      `function_call`, `collection_value` (`object`/`tuple`),
 *                      `template_expr` (`quoted_template` with
 *                      `template_interpolation`), `for_expr`, `literal_value`.
 *
 * Extraction contract:
 *   - Symbols: every `block` (kind mapped from block type) and every `attribute`
 *     (`property`) with a stable leaf `name`, a dot-qualified `scope`, and the
 *     enclosing block as `ownerName`/`ownerKind`.
 *   - Relationships:
 *       * `contains`   parent block → child block / attribute (qualified).
 *       * `references` enclosing block → dotted reference path (var.x, local.x,
 *                      module.x, data.TYPE.NAME, RESOURCE_TYPE.NAME.attr, each.x,
 *                      count.index, self.x, terraform.x, ...).
 *   - References are read from Tree-sitter nodes/fields only. Object keys
 *     (`object_elem` `key` field) and `for`-loop variables (`for_intro`
 *     identifiers) are excluded. No source-text regex is used.
 *
 * Complexity: one iterative DFS over the tree (O(nodes)) plus a recursive
 * expression walk that visits each expression node once (O(expression nodes));
 * relationship deduplication is O(1) via a Set key. Syntax errors are owned by
 * ASTEngine (tree-sitter ERROR/MISSING nodes) and are NOT re-emitted here.
 */
export class RealHclAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const relKeys = new Set<string>()
    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      metadata: Record<string, any> = {},
    ) => {
      const key = `${source}\u0000${type}\u0000${target}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      relationships.push({ source, target, type, confidence: 1, metadata })
    }

    // Block type → symbol kind. Blocks that declare data objects (resource,
    // data source) are class-like; value-bearing declarations (variable/output)
    // are variables; everything else (module, provider, terraform, locals and
    // nested blocks) is a module/class container.
    const TOP_LEVEL_KINDS: Record<string, ASTEngine.SymbolKind> = {
      resource: ASTEngine.SymbolKind.Class,
      data: ASTEngine.SymbolKind.Class,
      variable: ASTEngine.SymbolKind.Variable,
      output: ASTEngine.SymbolKind.Variable,
      module: ASTEngine.SymbolKind.Module,
      provider: ASTEngine.SymbolKind.Module,
      terraform: ASTEngine.SymbolKind.Module,
      locals: ASTEngine.SymbolKind.Module,
    }
    const SINGLE_LABEL_BLOCKS = new Set(["variable", "output", "module", "provider"])
    const TYPE_NAME_BLOCKS = new Set(["resource", "data"])

    // Iterative DFS. Each frame carries the enclosing block path (leaf names)
    // and the enclosing block's kind so children get correct owners.
    const stack: { node: Node; blockPath: string[]; blockKind: ASTEngine.SymbolKind | undefined }[] = [
      { node: rootNode, blockPath: [], blockKind: undefined },
    ]

    const pushChildren = (
      node: Node,
      blockPath: string[],
      blockKind: ASTEngine.SymbolKind | undefined,
    ) => {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, blockPath, blockKind })
      }
    }

    while (stack.length > 0) {
      const { node, blockPath, blockKind } = stack.pop()!
      const type = node.type

      if (type === "block") {
        // First identifier is the block type; every subsequent string_lit /
        // identifier child is a label. Identify the block-type child by index
        // (web-tree-sitter namedChild() returns distinct wrapper objects, so a
        // `===` identity test would fail).
        let blockTypeIndex = -1
        for (let i = 0; i < node.namedChildCount; i++) {
          if (node.namedChild(i)?.type === "identifier") {
            blockTypeIndex = i
            break
          }
        }
        const blockType = blockTypeIndex >= 0 ? node.namedChild(blockTypeIndex)!.text : ""
        const labels: string[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          if (i === blockTypeIndex) continue
          const child = node.namedChild(i)
          if (!child) continue
          if (child.type === "string_lit") labels.push(this.readStringLit(child))
          else if (child.type === "identifier") labels.push(child.text)
        }

        if (!blockType) {
          // Malformed block: no type identifier. Descend so nested valid
          // nodes are still reachable; syntax errors are reported by the engine.
          pushChildren(node, blockPath, blockKind)
          continue
        }

        // Stable leaf name using Terraform's native addressing.
        let name: string
        if (TYPE_NAME_BLOCKS.has(blockType)) {
          name = labels.length >= 2 ? `${labels[0]}.${labels[1]}` : labels.join(".")
        } else if (SINGLE_LABEL_BLOCKS.has(blockType)) {
          name = labels[0] ?? blockType
        } else {
          // terraform, locals, and nested blocks (lifecycle, backend, dynamic,
          // content, connection, provisioner, ...) keep their block type as
          // part of the identity so nested labels are unambiguous.
          name = labels.length > 0 ? `${blockType}.${labels.join(".")}` : blockType
        }

        const kind = TOP_LEVEL_KINDS[blockType] ?? ASTEngine.SymbolKind.Class
        const qualified = [...blockPath, name].join(".")

        symbols.push({
          name,
          kind,
          range: this.nodeToRange(node),
          scope: blockPath.join("."),
          visibility: "public",
          ownerName: blockPath.length > 0 ? blockPath[blockPath.length - 1] : undefined,
          ownerKind: blockKind,
          metadata: {
            hclBlockType: blockType,
            hclLabels: labels,
            hclBlockKind: this.classifyBlockKind(blockType),
          },
        })

        if (blockPath.length > 0) {
          addRelationship(blockPath.join("."), qualified, ASTEngine.RelationshipType.Contains)
        }

        // Module blocks import an external module source.
        if (blockType === "module") {
          imports.push({
            module: labels[0] ?? name,
            path: this.findModuleSource(node),
            range: this.nodeToRange(node),
          })
        }

        pushChildren(node, [...blockPath, name], kind)
        continue
      }

      if (type === "attribute") {
        const keyNode = this.findChild(node, (n) => n.type === "identifier")
        const key = keyNode?.text ?? ""
        if (key && blockPath.length > 0) {
          const qualified = [...blockPath, key].join(".")
          const expr = this.findChild(node, (n) => n.type === "expression")
          const valueNode = expr ? expr.namedChild(0) : undefined

          symbols.push({
            name: key,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(node),
            scope: blockPath.join("."),
            visibility: "public",
            ownerName: blockPath[blockPath.length - 1],
            ownerKind: blockKind,
            metadata: { hclValueKind: valueNode?.type ?? "unknown" },
          })

          addRelationship(blockPath.join("."), qualified, ASTEngine.RelationshipType.Contains)

          if (expr) {
            const refs: string[] = []
            this.extractReferences(expr, new Set(), refs)
            for (const ref of refs) {
              addRelationship(blockPath.join("."), ref, ASTEngine.RelationshipType.References)
            }
          }
        }
        // Attributes are leaves: their expression subtree is handled above.
        continue
      }

      // config_file, body, and any other wrapper nodes are descended only.
      pushChildren(node, blockPath, blockKind)
    }

    // The public interface of a module is its top-level blocks.
    for (const s of symbols) {
      if ((s.scope ?? "") === "") {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
      }
    }

    return {
      language: "hcl",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "HCL/Terraform",
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  /**
   * Walk an expression subtree and collect dotted reference paths.
   *
   * A reference is an `expression` node whose direct children form a
   * `variable_expr` (base identifier) followed by `get_attr`/`index` accessors
   * (they are siblings under `expression`, not nested). Real Terraform
   * references are always qualified (`var.x`, `aws_instance.web.id`), so a bare
   * single-identifier path is a type-constraint keyword (`type = string`) or a
   * function name — not a reference — and is skipped. `loopVars` carries
   * `for`-intro identifiers so iteration variables are not mistaken for
   * module/resource references.
   */
  private extractReferences(node: Node, loopVars: Set<string>, out: string[]): void {
    const type = node.type

    if (type === "expression") {
      const parts: string[] = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue
        if (child.type === "variable_expr") {
          const id = this.findChild(child, (n) => n.type === "identifier")
          if (id) parts.push(id.text)
        } else if (child.type === "get_attr") {
          const id = this.findChild(child, (n) => n.type === "identifier")
          if (id) parts.push(id.text)
        } else {
          // index, function_call, collection_value, template_expr, for_expr,
          // literal_value, binary operators, ... — recurse for nested refs.
          this.extractReferences(child, loopVars, out)
        }
      }
      if (parts.length >= 2 && !loopVars.has(parts[0])) {
        out.push(parts.join("."))
      }
      return
    }

    if (type === "for_expr" || type === "for_tuple_expr" || type === "for_object_expr") {
      const childLoopVars = new Set(loopVars)
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child?.type !== "for_intro") continue
        for (let j = 0; j < child.namedChildCount; j++) {
          const intro = child.namedChild(j)
          if (intro?.type === "identifier") childLoopVars.add(intro.text)
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        this.extractReferences(node.namedChild(i)!, childLoopVars, out)
      }
      return
    }

    if (type === "object_elem") {
      // The `key` field is a data key, not a reference; only the value is walked.
      for (let i = 0; i < node.namedChildCount; i++) {
        const field = node.fieldNameForChild?.(i)
        if (field === "key") continue
        this.extractReferences(node.namedChild(i)!, loopVars, out)
      }
      return
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      this.extractReferences(node.namedChild(i)!, loopVars, out)
    }
  }

  /** Read a `string_lit` label/value without source-text regex (grammar field). */
  private readStringLit(node: Node): string {
    const literal = this.findChild(node, (n) => n.type === "template_literal")
    if (literal) return literal.text
    return node.text
  }

  private classifyBlockKind(blockType: string): string {
    const topLevel = new Set([
      "resource", "data", "variable", "output", "module", "provider", "terraform", "locals",
    ])
    return topLevel.has(blockType) ? blockType : "nested"
  }

  /** Find a module block's `source` attribute value (unquoted via grammar field). */
  private findModuleSource(blockNode: Node): string | undefined {
    const body = this.findChild(blockNode, (n) => n.type === "body")
    if (!body) return undefined
    for (let i = 0; i < body.namedChildCount; i++) {
      const attr = body.namedChild(i)
      if (attr?.type !== "attribute") continue
      const key = this.findChild(attr, (n) => n.type === "identifier")
      if (key?.text !== "source") continue
      const expr = this.findChild(attr, (n) => n.type === "expression")
      if (!expr) return undefined
      // The value is `expression → literal_value → string_lit → template_literal`,
      // so search descendants rather than direct children.
      const literal = this.findDescendant(expr, (n) => n.type === "template_literal")
      if (literal) return literal.text
      return expr.text
    }
    return undefined
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
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (predicate(child)) return child
      const found = this.findDescendant(child, predicate)
      if (found) return found
    }
    return null
  }
}
