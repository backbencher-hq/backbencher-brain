import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Pure-AST Markdown analyzer (tree-sitter-markdown block grammar +
 * tree-sitter-markdown-inline companion grammar).
 *
 * The block grammar (wasm/tree-sitter-markdown.wasm) models headings, lists,
 * tables, code fences, block quotes, and front matter as nodes, but leaves
 * INLINE content (`paragraph → inline`, heading `inline`) as an opaque text
 * node — links/images/autolinks are NOT nodes in the block grammar. The
 * engine therefore pre-parses every inline block with the companion inline
 * grammar (wasm/tree-sitter-markdown_inline.wasm) and hands the trees to
 * this analyzer via `context.mdInlineTrees` (aligned with
 * `context.mdInlineStarts` byte offsets), exactly like the vue/svelte SFC
 * pre-parse. The analyzer matches each `inline` node back to its tree by
 * byte offset, so every emitted fact is AST-derived — zero source-text
 * regexes.
 *
 * Symbol map (M11 contract preserved: ATX headings -> type with hierarchy):
 *   - atx_heading / setext_heading -> type (section), owner = parent heading
 *   - pipe_table                   -> class (data table)
 *   - fenced_code_block            -> function (executable/declared snippet)
 *   - minus_metadata (front matter) -> namespace (document metadata)
 *
 * Relationship map:
 *   - contains: heading -> nested heading / table / code block / front matter
 *   - uses: heading/table/code -> link destination, image source,
 *     uri autolink, email autolink (from the inline grammar)
 */
export class RealMarkdownAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const patterns: string[] = []

    // O(1) identity dedupe for symbols (qualified by owner chain) and
    // relationships (source + type + target triples).
    const symbolIds = new Set<string>()
    const relIds = new Set<string>()

    const addRel = (source: string, type: string, target: string, metadata: Record<string, unknown>) => {
      if (!source || !target || source === target) return
      const id = `${source}\u0000${type}\u0000${target}`
      if (relIds.has(id)) return
      relIds.add(id)
      relationships.push({ source, target, type: type as ASTEngine.RelationshipType, confidence: 1.0, metadata })
    }

    // Inline trees from the engine: aligned arrays of parsed inline trees and
    // the byte offset of the corresponding `inline` node in `content`.
    const mdInlineTrees: any[] = context?.mdInlineTrees ?? []
    const mdInlineStarts: number[] = context?.mdInlineStarts ?? []
    const inlineByStart = new Map<number, any>()
    for (let i = 0; i < mdInlineStarts.length; i++) {
      inlineByStart.set(mdInlineStarts[i], mdInlineTrees[i])
    }

    // Heading hierarchy: stack of (name, level) for owner assignment.
    const headingStack: { name: string; level: number }[] = []
    // Current heading owner for block-level facts (tables/code/front matter).
    let currentOwner: string | undefined = undefined
    // Document-level container for top-level facts.
    const DOC = "document"

    // Collect all inline node byte offsets in source order for matching.
    const inlineStarts = new Set<number>(mdInlineStarts)

    // Single iterative DFS over the block tree.
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      const type = node.type

      if (type === "atx_heading" || type === "setext_heading") {
        const level = this.headingLevel(node)
        const name = this.headingText(node)
        if (name) {
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop()
          }
          const owner = headingStack.length > 0 ? headingStack[headingStack.length - 1].name : undefined
          const symId = owner ? `${owner}.${name}` : name
          if (!symbolIds.has(symId)) {
            symbolIds.add(symId)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Type,
              range: this.nodeToRange(node),
              visibility: "public",
              ownerName: owner,
              ownerKind: owner ? ASTEngine.SymbolKind.Type : undefined,
              metadata: { nodeType: type, headingLevel: level, isMarkdownHeading: true },
            })
          }
          if (owner) addRel(owner, ASTEngine.RelationshipType.Contains, name, { role: "heading_hierarchy" })
          headingStack.push({ name, level })
          currentOwner = name
        }
        patterns.push("Markdown headings")
        // Emit inline-derived uses for this heading's inline content.
        this.emitInlineUses(node, inlineByStart, addRel, name)
        continue
      }

      // Inline content inside paragraphs, block quotes, list items — every
      // inline block that is NOT a heading's direct inline child. Source is
      // the current heading owner (or the document).
      if (type === "inline") {
        const inlineTree = inlineByStart.get(node.startIndex)
        if (inlineTree?.rootNode) {
          const source = currentOwner ?? DOC
          this.walkInlineTree(inlineTree.rootNode, addRel, source)
        }
        continue
      }

      if (type === "pipe_table") {
        const name = this.tableName(node, content)
        const owner = currentOwner ?? DOC
        const symId = `${owner}.${name}`
        if (!symbolIds.has(symId)) {
          symbolIds.add(symId)
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: owner,
            ownerKind: owner === DOC ? undefined : ASTEngine.SymbolKind.Type,
            metadata: { nodeType: type, isMarkdownTable: true },
          })
        }
        addRel(owner, ASTEngine.RelationshipType.Contains, name, { role: "table_under_heading" })
        // Column names from the header row.
        const header = this.findChildByType(node, new Set(["pipe_table_header"]))
        if (header) {
          for (let i = 0; i < header.namedChildCount; i++) {
            const cell = header.namedChild(i)
            if (cell?.type === "pipe_table_cell") {
              const col = cell.text.trim()
              if (col) addRel(name, ASTEngine.RelationshipType.Contains, col, { role: "table_column" })
            }
          }
        }
        patterns.push("Markdown tables")
        continue
      }

      if (type === "fenced_code_block") {
        const infoNode = this.findChildByType(node, new Set(["info_string"]))
        const langNode = infoNode ? this.findChildByType(infoNode, new Set(["language"])) : null
        const lang = langNode?.text?.trim() ?? infoNode?.text?.trim() ?? "text"
        const owner = currentOwner ?? DOC
        const name = lang === "text" ? "code_block" : `code_block.${lang}`
        const symId = `${owner}.${name}`
        if (!symbolIds.has(symId)) {
          symbolIds.add(symId)
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: owner,
            ownerKind: owner === DOC ? undefined : ASTEngine.SymbolKind.Type,
            metadata: { nodeType: type, language: lang, isMarkdownCodeBlock: true },
          })
        }
        addRel(owner, ASTEngine.RelationshipType.Contains, name, { role: "code_block_under_heading" })
        patterns.push("Markdown code blocks")
        continue
      }

      if (type === "minus_metadata") {
        const name = "front_matter"
        const owner = DOC
        const symId = `${owner}.${name}`
        if (!symbolIds.has(symId)) {
          symbolIds.add(symId)
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Namespace,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: owner,
            ownerKind: undefined,
            metadata: { nodeType: type, isMarkdownFrontMatter: true },
          })
        }
        patterns.push("Markdown front matter")
        continue
      }

      // Descend into children (skip nothing — inline nodes are consumed above).
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return {
      language: "markdown",
      symbols,
      relationships,
      imports,
      exports: [],
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns,
        framework: "Markdown",
        headingCount: headingStack.length,
        inlineBlockCount: mdInlineTrees.length,
      },
    }
  }

  /**
   * Walk a heading node's own inline child and emit `uses` edges for every
   * link/image/autolink in the companion inline tree matched by byte offset.
   */
  private emitInlineUses(
    node: Node,
    inlineByStart: Map<number, any>,
    addRel: (source: string, type: string, target: string, metadata: Record<string, unknown>) => void,
    source: string,
  ): void {
    const inline = this.findChildByType(node, new Set(["inline"]))
    if (!inline) return
    const inlineTree = inlineByStart.get(inline.startIndex)
    if (inlineTree?.rootNode) this.walkInlineTree(inlineTree.rootNode, addRel, source)
  }

  /** Walk a parsed inline tree and emit uses edges for links/autolinks. */
  private walkInlineTree(
    root: any,
    addRel: (source: string, type: string, target: string, metadata: Record<string, unknown>) => void,
    source: string,
  ): void {
    const s: any[] = [root]
    while (s.length > 0) {
      const inn = s.pop()!
      if (inn.type === "link_destination") {
        addRel(source, ASTEngine.RelationshipType.Uses, inn.text.trim(), { role: "markdown_link", linkText: inn.text.trim() })
      } else if (inn.type === "uri_autolink" || inn.type === "email_autolink") {
        // The grammar exposes the URI/email only as the node's raw text in
        // angle brackets (no child node) — strip the brackets by position.
        const target = this.stripAngleBrackets(inn.text)
        if (target) addRel(source, ASTEngine.RelationshipType.Uses, target, { role: "markdown_autolink" })
      }
      for (let i = inn.namedChildCount - 1; i >= 0; i--) {
        const c = inn.namedChild(i)
        if (c) s.push(c)
      }
    }
  }

  /** Strip surrounding angle brackets by position, no regex. */
  private stripAngleBrackets(text: string): string {
    const t = text.trim()
    if (t.length >= 2 && t.charCodeAt(0) === 60 && t.charCodeAt(t.length - 1) === 62) {
      return t.slice(1, -1)
    }
    return t
  }

  private headingLevel(node: Node): number {
    const marker = this.findChildByType(
      node,
      new Set([
        "atx_h1_marker", "atx_h2_marker", "atx_h3_marker",
        "atx_h4_marker", "atx_h5_marker", "atx_h6_marker",
        "setext_h1_underline", "setext_h2_underline",
      ]),
    )
    if (marker) {
      const t = marker.type
      if (t.includes("h1")) return 1
      if (t.includes("h2")) return 2
      if (t.includes("h3")) return 3
      if (t.includes("h4")) return 4
      if (t.includes("h5")) return 5
      if (t.includes("h6")) return 6
    }
    return 1
  }

  /** Heading display text: the inline child's raw text (no marker, no regex). */
  private headingText(node: Node): string {
    const inline = this.findChildByType(node, new Set(["inline"]))
    if (inline) {
      const text = inline.text.trim()
      if (text) return text
    }
    // Setext headings have no inline marker stripping — the paragraph child
    // holds the text; fall back to node text minus the underline line.
    const text = node.text.trim()
    const nl = text.lastIndexOf("\n")
    return nl >= 0 ? text.slice(0, nl).trim() : text
  }

  /** Table identity: header cell text joined by `/` (no regex). */
  private tableName(node: Node, content: string): string {
    const header = this.findChildByType(node, new Set(["pipe_table_header"]))
    if (header) {
      const parts: string[] = []
      for (let i = 0; i < header.namedChildCount; i++) {
        const cell = header.namedChild(i)
        if (cell?.type === "pipe_table_cell") {
          const t = cell.text.trim()
          if (t) parts.push(t)
        }
      }
      if (parts.length > 0) return parts.join("/")
    }
    return "table"
  }

  private findChildByType(node: Node, types: Set<string>): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && types.has(child.type)) return child
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
