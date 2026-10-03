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
 *   contains: heading -> nested heading / table / code block / front matter
 *   uses: heading/table/code -> link destination, image source,
 *     uri autolink, email autolink (from the inline grammar)
 *   references: a `#fragment` destination resolved to the heading it names, which is
 *     the one edge class here whose target is a symbol THIS file publishes (measured
 *     1,107 of 1,107) — see `addRel`'s call site for why it is not `uses`.
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

    // A heading, a table and a code fence are SITES, not declarations: the same
    // construct can legitimately appear twice under one owner (two `scala` examples
    // in one section, `## Example` in every section). Keying them by `owner + name`
    // dropped every repeat, and it dropped the repeat's `contains` edge with it —
    // measured on this lane's own pinned corpus (scala3@18df09c0, 738 tracked .md
    // files) at 1,584 of 3,742 fenced code blocks erased, across 406 of 738 files.
    //
    // The first occurrence therefore keeps its EXACT previous spelling, so every
    // existing fixture, ground-truth fact and doc claim survives byte-for-byte, and
    // only the Nth repeat is disambiguated — the `uniquePath` rule yaml already
    // uses for duplicate mapping keys (real-yaml-analyzer.ts), on the same principle:
    // a name that repeats is a fact about the document, and hiding it is worse than
    // spelling it.
    const siteOccurrences = new Map<string, number>()
    // Relationship identity, per the M59 #822 rule stated below. O(1) per edge.
    const relIds = new Set<string>()

    /**
     * A site's identity, in the two spellings the store and the graph need.
     *
     * `id` is the fully-qualified, ordinaled path — published as the symbol's `id` and
     * `qualifiedName`, so two occurrences of the same construct never share a row key.
     *
     * `target` is the spelling an EDGE addresses the site by, and it is the CONTRACT
     * spelling for a first occurrence: the bare construct name, exactly as the lane
     * always wrote it. Only a repeat is ordinaled. This split is what keeps the round
     * additive — the 59 hand-audited M12 ground-truth facts and 31 contract checks
     * name bare targets, and a fix that cannot see the defect is not allowed to break
     * the evidence that could not see it either.
     *
     * yaml's `uniquePath` is the same rule one level up: `if (!isDuplicate) return base`.
     */
    const siteId = (qualifiedBase: string, name: string): { id: string; target: string; repeat: boolean } => {
      const n = (siteOccurrences.get(qualifiedBase) ?? 0) + 1
      siteOccurrences.set(qualifiedBase, n)
      return {
        id: n === 1 ? qualifiedBase : `${qualifiedBase}#${n}`,
        target: n === 1 ? name : `${name}#${n}`,
        repeat: n > 1,
      }
    }

    /**
     * A heading's GitHub anchor, derived from its DISPLAY text.
     *
     * A same-document link `[see](#install)` names a heading by its anchor, not by its
     * text, and the two are not the same string: GitHub lowercases, drops every
     * character that is not a letter, digit, space or hyphen, turns spaces into
     * hyphens, and gives a repeated anchor a `-1`, `-2` ordinal. So `## Install Now!`
     * is `#install-now`, and a second `## Install Now!` is `#install-now-1`.
     *
     * This lane had no notion of an anchor at all, which is why 8,839 of the 10,182
     * bare `#anchor` targets in a 420-file draw named no heading — not because the
     * links are broken (most are not) but because the lane published heading TEXT
     * where a link names a heading's ANCHOR, so the two spellings could never meet.
     *
     * Character codes, not a regex, for the reason the closing-run trim uses them:
     * 0 regex literals is a measured, pinned property of this analyzer and a slug
     * function is exactly the kind of place a `/[^a-z0-9]+/g` reaches for. What is
     * left is a loop over code units and an if-chain, which is also easier to read as
     * the specification it is: this IS the algorithm, spelled out.
     *
     * ASCII-only, and that is a DECLARED boundary (MD-D6) rather than an oversight:
     * GitHub's slugger keeps Unicode letters, so `Café` is `#café` and this would be
     * `#caf`. Measured on the pinned corpus: 24 headings contain non-ASCII characters
     * and all 24 are Unicode PUNCTUATION (`What’s new in…`), which the renderer also
     * drops, so ASCII-only matches every one of them; and 0 corpus links target a
     * non-ASCII anchor. Telling a Unicode letter from Unicode punctuation without a
     * pattern is the whole of the problem.
     */
    const anchorSlug = (text: string): string => {
      let out = ""
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        const ch = text[i]
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += ch.toLowerCase()
        else if (c === 32 || c === 9 || c === 45) out += "-"
        // everything else — ASCII punctuation — is dropped
      }
      return out
    }

    // A relationship's identity is (source, type, target, SITE LINE) — the M59 #822
    // rule, and the same key the store's own relationship primary key uses. Without
    // the line, the two `heading -> code_block.scala` edges of a two-block section
    // are byte-identical strings and `INSERT OR IGNORE` keeps one of them, so a
    // per-site symbol would still be unreachable from the graph.
    const addRel = (
      source: string,
      type: string,
      target: string,
      metadata: Record<string, unknown>,
      line?: number,
      // The two ends name DIFFERENT sites even when they spell the same string.
      // See the call site below for why a name cannot answer that question here.
      distinctSites = false,
    ) => {
      if (!source || !target) return
      if (source === target && !distinctSites) return
      const at = typeof line === "number" && line > 0 ? line : 0
      const id = `${source}\u0000${type}\u0000${target}\u0000${at}`
      if (relIds.has(id)) return
      relIds.add(id)
      // M59 (#825) one-line base: 1-based, taken from the node that CARRIES THE NAME
      // the edge is about — the same rule typescript documents at its own
      // `line_number` emission. Written as a spread on the literal rather than an
      // assignment afterwards, because that is the spelling 32 sibling lanes use and
      // because M60.P1 measures a lane's emission with the source needle
      // `/\bline_number\s*:/` against the analyzer file: an assignment satisfies the
      // behaviour and not the measurement, and a matrix that cannot see a field a
      // lane genuinely publishes is a matrix that will call the field absent.
      relationships.push({
        source,
        target,
        type: type as ASTEngine.RelationshipType,
        confidence: 1.0,
        metadata,
        ...(at > 0 ? { line_number: at } : {}),
      })
    }

    // Inline trees from the engine: aligned arrays of parsed inline trees, the byte
    // offset of the corresponding `inline` node in `content`, and that block's 1-based
    // FILE line. `mdInlineLines` was already computed by the engine and read by nobody;
    // it is the only way to put a real line on an edge whose node lives in a SUB-PARSE
    // of a substring, because a node row inside that sub-tree is relative to the
    // substring, not to the file.
    const mdInlineTrees: any[] = context?.mdInlineTrees ?? []
    const mdInlineStarts: number[] = context?.mdInlineStarts ?? []
    const mdInlineLines: number[] = context?.mdInlineLines ?? []
    const inlineByStart = new Map<number, { tree: any; line: number }>()
    for (let i = 0; i < mdInlineStarts.length; i++) {
      // Defensive: a hand-built context (a probe, a mutant) may omit the lines array.
      // Absent means unknown, never 0 — 0 is not a line and R6 forbids a mirror base.
      inlineByStart.set(mdInlineStarts[i], { tree: mdInlineTrees[i], line: mdInlineLines[i] })
    }

    // Heading hierarchy, carrying BOTH spellings on purpose.
    //
    //   `name` is the CONTRACT spelling — the heading text — and is what `ownerName`
    //     and a `contains` edge's SOURCE are written as. This is the M11 contract the
    //     M12 ground truth (59 facts) and the contract probe (31 checks) pin, and it
    //     is unchanged by this round.
    //   `id` is IDENTITY — the owner-qualified path, with an `#N` ordinal on a repeat.
    //
    // Conflating the two is what made the first attempt at this fix fail: publishing
    // the qualified id as `ownerName` changed every endpoint spelling in the lane and
    // broke 59 hand-audited facts to fix a defect those facts could not see. Identity
    // and spelling are different questions and get different fields.
    const headingStack: { name: string; id: string; level: number }[] = []
    // Current heading owner for block-level facts (tables/code/front matter): the
    // contract spelling for `ownerName` and edge sources, the id for the base path.
    let currentOwner: string | undefined = undefined
    let currentOwnerId: string | undefined = undefined
    // Document-level container for top-level facts.
    const DOC = "document"

    /**
     * How many headings were PUBLISHED, counted as they are published.
     *
     * MD-L2 (2026-10-03, the M60 pass-2 line-by-line read). This field used to be
     * `headingStack.length`, evaluated in the RETURN object — and by then the stack
     * holds the ancestor chain of the LAST heading the walk reached, not the headings
     * of the document. CommonMark caps that chain at six, so the field could not
     * exceed 6 in any document ever written, under any heading count, on any corpus.
     *
     * Measured on a 1,200-file draw of a corpus whose documents carry hundreds of
     * headings: the field took exactly the five values 0, 1, 2, 3 and 4
     * (94 / 361 / 542 / 186 / 17 files) with a maximum of 4, against a mean of 7.1
     * published headings per file in the same draw
     * (`validation/m60/markdown/pass2-labelling-probe.json`, `headingCountMetadata`).
     * A consumer filtering documents by "how many headings does this have" was reading
     * the nesting depth of the last one.
     *
     * Nothing in this repository reads markdown's `headingCount` — html's field of the
     * same name is its own and is computed by its own counter at
     * `real-html-analyzer.ts:754` — so the change is contained to this file, and the
     * old value was wrong rather than load-bearing.
     */
    let publishedHeadings = 0

    // Same-document references, resolved after the walk.
    //
    // `anchorMap` is filled as headings are published, so by the time the walk ends
    // every heading's ANCHOR and its RESOLVED spelling are both known. The ordinal is
    // kept per anchor rather than per site, because two headings under DIFFERENT
    // parents can share an anchor — `## Install` under `# A` and `## Install` under
    // `# B` are two sites with distinct ids and one anchor, and GitHub disambiguates
    // them with `-1` exactly as it does for two identical headings under one parent.
    const anchorMap = new Map<string, { name: string; line: number }>()
    const anchorOccurrences = new Map<string, number>()
    const pendingAnchors: { source: string; fragment: string; literal: string; line?: number }[] = []

    // Collect all inline node byte offsets in source order for matching.
    const inlineStarts = new Set<number>(mdInlineStarts)

    // Link reference definitions are BLOCK-level and may sit after the references
    // that use them, so they are collected before the single emit pass rather than
    // during it. One extra walk of the block tree that never enters an inline subtree:
    // O(block nodes), leaving the complexity envelope's "O(block nodes + inline facts)"
    // intact and the inline half — the expensive half — walked exactly once.
    const definitions = new Map<string, { destination: string; line: number }>()
    this.collectReferenceDefinitions(rootNode, definitions)

    // Single iterative DFS over the block tree.
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      const type = node.type

      if (type === "atx_heading" || type === "setext_heading") {
        const level = this.headingLevel(node)
        const name = this.headingText(node)
        if (name) {
          publishedHeadings++
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop()
          }
          const owner = headingStack.length > 0 ? headingStack[headingStack.length - 1].name : undefined
          const ownerId = headingStack.length > 0 ? headingStack[headingStack.length - 1].id : undefined
          const base = ownerId ? `${ownerId}.${name}` : name
          const { id, target, repeat } = siteId(base, name)
          const range = this.nodeToRange(node)
          symbols.push({
            // The site's RESOLVED spelling, which is the bare text for a first
            // occurrence and `Text#n` for a repeat. It has to be this and not the
            // bare text: the edge below already says `target`, the store resolves
            // an endpoint by symbol NAME, and publishing the bare text while the
            // edge says `Text#2` is a name nothing declares. Measured on this lane's
            // own corpus, 120 scala3 markdown files: 529 of 1,843 relationships
            // (28.7%) named a symbol that did not exist, every one of them a
            // repeated site. A first occurrence is unchanged, which is why
            // `heading-identity` and `code-block-site-identity` still read as they
            // always did and this went unmeasured for a full review cycle.
            name: target,
            kind: ASTEngine.SymbolKind.Type,
            id,
            qualifiedName: id,
            range,
            visibility: "public",
            ownerName: owner,
            ownerKind: owner ? ASTEngine.SymbolKind.Type : undefined,
            scope: owner,
            metadata: {
              nodeType: type,
              headingLevel: level,
              isMarkdownHeading: true,
              // A repeated heading is a fact about the document (`## Example` in
              // every section), not a duplicate to be swallowed.
              isRepeatedSite: repeat || undefined,
            },
          })
          // The edge's SOURCE is the parent's contract spelling and its TARGET is the
          // child's identity, so a repeated child is addressable while a first
          // occurrence reads exactly as it always did.
          //
          // A child whose TEXT equals its parent's is a real containment between two
          // different sections — `# Changelog` over `## Changelog`, `# Setup` over
          // `## Setup` — and it used to publish NOTHING, because both ends spell
          // `Changelog` and `addRel` drops a self-edge. Found by the differential, not
          // by the read: the tree oracle derives the edge from the grammar and the
          // analyzer did not have it, so one corpus file
          // (`vendor/github.com/google/uuid/CHANGELOG.md`, kubernetes) read MISSING=1
          // in about one draw in nine, which is exactly the rate at which a reader
          // would have written it off as noise.
          //
          // `ownerId !== id` is not a hopeful check: a child's id is
          // `${ownerId}.${name}` (or that with a `#n` site suffix), so for any
          // non-empty `name` it can never equal `ownerId`. `if (name)` above already
          // excludes the empty case. The two symbols are therefore distinct by
          // construction, and the self-edge filter — which exists to stop a symbol
          // referring to itself — has nothing to stop here.
          if (owner) addRel(owner, ASTEngine.RelationshipType.Contains, target, { role: "heading_hierarchy" }, range.startLine, ownerId !== id)
          // Register the anchor against the spelling this heading is PUBLISHED under,
          // so a same-document link resolves to a name the file actually declares.
          const slug = anchorSlug(name)
          if (slug) {
            const seen = (anchorOccurrences.get(slug) ?? 0) + 1
            anchorOccurrences.set(slug, seen)
            const key = seen === 1 ? slug : `${slug}-${seen - 1}`
            if (!anchorMap.has(key)) anchorMap.set(key, { name: target, line: range.startLine })
          }
          // The stack carries the RESOLVED spelling, so a child of a repeated parent
          // names the parent the way the parent is published and the way the parent's
          // own incoming edge names it. Three spellings of one thing would be the
          // defect this fixes, not a reason to keep the bare one here.
          headingStack.push({ name: target, id, level })
          currentOwner = target
          currentOwnerId = id
        }
        patterns.push("Markdown headings")
        // Emit inline-derived uses for this heading's inline content.
        this.emitInlineUses(node, inlineByStart, addRel, currentOwner ?? DOC, definitions, pendingAnchors)
        continue
      }

      // Inline content inside paragraphs, block quotes, list items — every
      // inline block that is NOT a heading's direct inline child. Source is
      // the current heading owner (or the document).
      if (type === "inline") {
        const inline = inlineByStart.get(node.startIndex)
        if (inline?.tree?.rootNode) {
          const source = currentOwner ?? DOC
          this.walkInlineTree(inline.tree.rootNode, addRel, source, inline.line, definitions, pendingAnchors)
        }
        continue
      }

      if (type === "pipe_table") {
        const name = this.tableName(node, content)
        const owner = currentOwner ?? DOC
        const ownerId = currentOwnerId ?? DOC
        const base = ownerId === DOC ? name : `${ownerId}.${name}`
        const { id, target, repeat } = siteId(base, name)
        const range = this.nodeToRange(node)
        symbols.push({
          name: target,
          kind: ASTEngine.SymbolKind.Class,
          id,
          qualifiedName: id,
          range,
          visibility: "public",
          ownerName: owner === DOC ? undefined : owner,
          ownerKind: owner === DOC ? undefined : ASTEngine.SymbolKind.Type,
          scope: owner === DOC ? undefined : owner,
          metadata: {
            nodeType: type,
            isMarkdownTable: true,
            isRepeatedSite: repeat || undefined,
          },
        })
        addRel(owner, ASTEngine.RelationshipType.Contains, target, { role: "table_under_heading" }, range.startLine)
        // Column names from the header row.
        const header = this.findChildByType(node, new Set(["pipe_table_header"]))
        if (header) {
          for (let i = 0; i < header.namedChildCount; i++) {
            const cell = header.namedChild(i)
            if (cell?.type === "pipe_table_cell") {
              const col = cell.text.trim()
              // A column is a site too, and a table's columns are addressed by the
              // table's OWN disambiguated id so two same-header tables never share
              // a column endpoint.
              if (!col) continue
              // The SYMBOL is what makes that edge resolvable, and it is the half
              // that was missing: the comment above said columns are sites, the edge
              // was emitted for every column of every table, and no column symbol was
              // ever declared — so the edge named something the file did not contain.
              // Measured after the repeat-site fix above, over 120 scala3 markdown
              // files, 31 endpoints still named no symbol and every one of them was
              // a column. A table column is a member of its table, so it publishes as
              // one: the header cell's own range, so a reader can navigate to it.
              const cSite = siteId(`${id}.${col}`, col)
              symbols.push({
                name: cSite.target,
                kind: ASTEngine.SymbolKind.Property,
                id: cSite.id,
                qualifiedName: cSite.id,
                range: this.nodeToRange(cell),
                visibility: "public",
                ownerName: target,
                ownerKind: ASTEngine.SymbolKind.Class,
                scope: target,
                metadata: {
                  nodeType: "pipe_table_cell",
                  isMarkdownTableColumn: true,
                  isRepeatedSite: cSite.repeat || undefined,
                },
              })
              addRel(target, ASTEngine.RelationshipType.Contains, cSite.target, { role: "table_column" }, range.startLine, cSite.id !== id)
            }
          }
        }
        patterns.push("Markdown tables")
        continue
      }

      if (type === "fenced_code_block" || type === "indented_code_block") {
        // MD-G1. An INDENTED (4-space) code block is the same construct as a fenced
        // one and the grammar names the node, so the lane was emitting nothing for it:
        // measured, 2 sites in 2 of 738 corpus files. The count is small; the
        // ASYMMETRY inside one construct is the defect — a reader of the graph cannot
        // tell "this document has no code" from "this document has code the lane
        // dropped", and the fenced form proves the lane has a symbol for this.
        //
        // It shares the fenced path's SITE IDENTITY, which is what keeps the two forms
        // from colliding: both are `code_block` under the same owner, so an indented
        // block after a fenced one is `code_block#2` and not a second `code_block`.
        const infoNode = this.findChildByType(node, new Set(["info_string"]))
        const langNode = infoNode ? this.findChildByType(infoNode, new Set(["language"])) : null
        const lang = langNode?.text?.trim() ?? infoNode?.text?.trim() ?? "text"
        const owner = currentOwner ?? DOC
        const ownerId = currentOwnerId ?? DOC
        const name = lang === "text" ? "code_block" : `code_block.${lang}`
        const base = ownerId === DOC ? name : `${ownerId}.${name}`
        const { id, target, repeat } = siteId(base, name)
        const range = this.nodeToRange(node)
        // An indented block has NO WAY to declare a language — there is no info string
        // in the construct — so `language` is omitted rather than defaulted to `text`.
        // The `text` default below is a FENCE convention and means "a fence with no
        // language declared", which is a different fact from "a language that cannot be
        // known"; publishing `language: "text"` here would be a fabricated one, and
        // `nodeType` already carries the distinction (`indented_code_block`) through the
        // worker into `annotations`.
        const declaredLang = langNode?.text?.trim() ?? infoNode?.text?.trim()
        symbols.push({
          name: target,
          kind: ASTEngine.SymbolKind.Function,
          id,
          qualifiedName: id,
          range,
          visibility: "public",
          ownerName: owner === DOC ? undefined : owner,
          ownerKind: owner === DOC ? undefined : ASTEngine.SymbolKind.Type,
          scope: owner === DOC ? undefined : owner,
          metadata: {
            nodeType: type,
            ...(declaredLang ? { language: declaredLang } : {}),
            isMarkdownCodeBlock: true,
            isRepeatedSite: repeat || undefined,
          },
        })
        addRel(owner, ASTEngine.RelationshipType.Contains, target, { role: "code_block_under_heading" }, range.startLine)
        patterns.push("Markdown code blocks")
        continue
      }

      if (type === "minus_metadata") {
        const name = "front_matter"
        const owner = DOC
        const { id, target, repeat } = siteId(`${owner}.${name}`, name)
        const range = this.nodeToRange(node)
        symbols.push({
          // Same rule as every other site: the published name is the RESOLVED
          // spelling, so a document with two front-matter blocks publishes
          // `front_matter` and `front_matter#2` and any edge naming the second
          // resolves. A first occurrence — every document until the second block
          // exists — is byte-identical to what it always was.
          name: target,
          kind: ASTEngine.SymbolKind.Namespace,
          id,
          qualifiedName: id,
          range,
          visibility: "public",
          ownerName: owner,
          ownerKind: undefined,
          metadata: {
            nodeType: type,
            isMarkdownFrontMatter: true,
            isRepeatedSite: repeat || undefined,
          },
        })
        patterns.push("Markdown front matter")
        continue
      }

      // Descend into children (skip nothing — inline nodes are consumed above).
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }

    // Same-document references, resolved now that every heading's published spelling
    // is known.
    //
    // A fragment is URL-decoded and lowercased before lookup, because that is the form
    // a fragment is written in: a link to `#Install%20Now` and one to
    // `#install-now` name the same heading. The ANCHOR is already lowercase, so the
    // comparison is on the decoded fragment.
    let anchorsResolved = 0
    let anchorsUndefined = 0
    for (const p of pendingAnchors) {
      const frag = this.decodeFragment(p.fragment)
      const hit = frag ? anchorMap.get(frag) : undefined
      if (!hit) {
        // MD-D1's ruling, applied to the internal case: a reference that names nothing
        // is NOT published. An undefined reference link already takes this path (a
        // measured 171 fabricated endpoints, dominated by bare citation markers), and
        // an unresolved fragment is the same defect with a different spelling — an
        // edge whose endpoint is a name no symbol declares. Publishing it would put
        // back, in the one class this round spent its effort removing, exactly what
        // was removed. The COUNT is disclosed rather than dropped, so the information
        // survives as a measurement even where the edge does not.
        anchorsUndefined++
        continue
      }
      anchorsResolved++
      // The line is the HEADING's, not the link's, and that is the house convention
      // rather than a preference: M59 #825 takes `line_number` from the node that
      // CARRIES THE NAME the edge is about, and java's mapped-column edge does the
      // same thing for the same reason (the column is named inside the annotation, so
      // the annotation's line is the edge's line). It is also what makes the edge
      // RESOLVE: the store keys an endpoint as `${fileId}:${name}:${line}`, so a
      // target-name-plus-link-line pair would name a row that does not exist — the
      // dangling-endpoint class again, one line away. The link's own line is kept in
      // metadata, so where the author wrote it is not lost.
      //
      // MD-L1 (2026-10-03, the M60 pass-2 labelling review). The TYPE is `references`,
      // and it was `uses`. The label change is the whole of the defect and it is
      // measured, not stylistic:
      //
      //   Every link destination this lane publishes was `uses` — 10,709 of them in a
      //   1,200-file corpus draw, of which **0** have a target that is a name the file
      //   declares. That is not a quality footnote, it is the aggregate a consumer
      //   reads: "this analyzer's edges resolve at 0.0%". The number is an artefact of
      //   the label, because those 10,709 are four different relations published under
      //   one name. Classified on the tree by the node's OWN text, the same draw gives:
      //
      //     scheme (https:, mailto:, …)  8,943   an external resource, unresolvable by
      //                                              construction — no file declares it
      //     relative (./other.md, …)     1,325   another file; 822 resolve to a tracked
      //                                              file, 503 name a dead path
      //     fragment (#install)           1,406   a heading IN THIS FILE
      //     absolute-path (/img/x.png)     131
      //
      //   The third class is the one that is a reference to something DECLARED, and it
      //   is the only edge class in this lane whose target binds to a published symbol:
      //   **1,107 of 1,107, 100.0%** (`validation/m60/markdown/pass2-labelling-probe.json`,
      //   role `markdown_internal_anchor`, `targetResolved`). css's `references` is the
      //   same shape for the same reason — `var(--x)` reading a custom property the file
      //   declares — and the enum itself spells the class twice: `References = "references"`
      //   beside `DependsOn = "references"`, against `Uses = "uses"`.
      //
      //   So the split is: a destination the FILE DECLARES is a `references` edge; a
      //   destination the file merely NAMES — a URL, an autolink, a cross-file path — is
      //   a `uses` edge. That relabels 1,107 edges the lane already published and adds
      //   none, so the fabrication class the workstream forbids is untouched.
      //
      //   What it does NOT do is claim the cross-file class: 1,325 relative destinations
      //   are published as `uses` and 503 of them name a path no tracked file has. A
      //   per-file analyzer cannot tell a live path from a dead one — production hands a
      //   markdown analyzer no project index (`PROJECT_INDEX_EXTENSIONS` carries `.sol`
      //   only) — so relabelling those would publish a `references` edge the lane cannot
      //   resolve at all. They stay `uses`, and the limitation is declared in the doc
      //   rather than left for a reader to discover.
      //
      //   The SOURCE half of this edge class is a separate fact and is NOT a defect: 610
      //   of the 1,107 name `document` as their source, because the linking paragraph
      //   sits above the document's first heading. `document` is the repo-wide
      //   pseudo-owner that html, json, toml and yaml all use and none of them publish;
      //   `parallel-indexer.ts` writes `source_symbol_id = null` with the name kept in
      //   `source_external`, which is nullable by design.
      addRel(
        p.source,
        ASTEngine.RelationshipType.References,
        hit.name,
        {
          role: "markdown_internal_anchor",
          linkText: p.literal,
          linkForm: "internal_anchor",
          anchor: frag,
          ...(p.line ? { linkLine: p.line } : {}),
        },
        hit.line,
      )
    }
    if (anchorsResolved > 0) patterns.push("Markdown internal anchor references")
    if (anchorsUndefined > 0) patterns.push(`Markdown undefined internal anchors: ${anchorsUndefined}`)

    this.classifyEvidenceTier(relationships)

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
        headingCount: publishedHeadings,
        inlineBlockCount: mdInlineTrees.length,
      },
    }
  }

  /**
   * M14 #419-D: assign `metadata.evidenceClass` from the closed five-tier vocabulary,
   * applied centrally so an emission site cannot skip it (the shape 22 sibling lanes
   * use; typescript's `classifyEvidenceTier` is the reference).
   *
   * This lane's absence was not cosmetic. With no stored class, the read-time
   * derivation in `graph-core.ts` decides instead, and its `STRUCTURAL_TYPES` set is
   * `{calls, inherits, implements, overrides}` — it does NOT contain `contains`. So
   * every heading-hierarchy, table and code-block edge, which is a direct AST
   * parent/child relation and cannot be anything but structural, was rendered to
   * users as `inferred`: "a guess (heuristic or confidence < 0.7) — treat as a hint,
   * never as fact". The graph was telling the reader to distrust the one class of edge
   * in this lane that is derived from the tree itself.
   *
   * The markdown mapping, and why each row is what it is:
   *   contains -> structural       a parent/child relation read off the block tree.
   *   uses     -> reference_qualified
   *     A link destination is not a guess about a NAME: the destination is a node's
   *     own text and, for a reference link, it is the destination the document's own
   *     `link_reference_definition` declares. That is qualifier evidence — stronger
   *     than `usage_contextual` ("the name appears in context"), weaker than structure
   *     — which is exactly what the tier is for. Every published `uses` edge in this
   *     lane resolves a destination the grammar read out of a node, so the
   *     `resolved === false` arm that other lanes need is unreachable here and is
   *     deliberately not invented.
   *   references -> reference_qualified
   *     The same tier as `uses`, for the same reason, and deliberately NOT
   *     `structural`: the edge is not a parent/child relation read off the tree. A
   *     `#fragment` names a heading, the analyzer recomputes that heading's anchor and
   *     looks it up, and the edge exists because the lookup HIT. The lookup is the
   *     qualification.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      if (t === "contains") {
        md.evidenceClass = "structural"
        continue
      }
      if (t === "uses") {
        md.evidenceClass = "reference_qualified"
        continue
      }
      if (t === "references") {
        md.evidenceClass = "reference_qualified"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * Collect `link_reference_definition` nodes into `label -> destination`.
   *
   * A reference link (`[text][ref]`, `[ref][]`, `[ref]`) carries only its LABEL; the
   * destination lives in a definition elsewhere in the document, and CommonMark puts
   * definitions at BLOCK level, so they are found here rather than in the inline tree.
   * Before this, a document's reference links produced no `uses` edge at all —
   * measured on this lane's pinned corpus (scala3@18df09c0, 738 tracked .md files) at
   * 671 sites (44 uses + 627 definitions) across 66 files, while the lane doc claimed
   * "Links (inline and reference destinations)".
   *
   * The walk descends named children but SKIPS `inline` subtrees: a definition cannot
   * live inside one, and skipping keeps this pass off the inline grammar's node count,
   * which is the expensive half of a markdown file. First definition of a label wins,
   * which is CommonMark's own rule.
   */
  private collectReferenceDefinitions(root: Node, into: Map<string, { destination: string; line: number }>): void {
    const s: Node[] = [root]
    while (s.length > 0) {
      const n = s.pop()!
      if (n.type === "inline") continue
      if (n.type === "link_reference_definition") {
        const labelNode = this.findChildByType(n, new Set(["link_label"]))
        const destNode = this.findChildByType(n, new Set(["link_destination"]))
        if (labelNode && destNode) {
          const label = this.stripBrackets(labelNode.text)
          const destination = destNode.text.trim()
          if (label && destination && !into.has(label)) {
            into.set(label, { destination, line: labelNode.startPosition.row + 1 })
          }
        }
        continue
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) s.push(c)
      }
    }
  }

  /**
   * A heading's OWN `inline` node, which the two heading forms do not hold the same way.
   *
   * MD-DEFECT-1 (2026-10-03, the M60 pass-2 review). The ATX form puts the heading text in
   * a DIRECT `inline` child:
   *
   *     atx_heading > atx_h1_marker, inline
   *
   * and the SETEXT form does not — the text lives one level down, inside the paragraph the
   * underline terminates:
   *
   *     setext_heading > paragraph > inline , setext_h1_underline
   *
   * Both shapes are measured on the pinned wasm, not read off a spec. `emitInlineUses`
   * resolved the heading's inline with `findChildByType`, which walks DIRECT named
   * children only, so it returned null for every setext heading and the method returned
   * before emitting anything: **every link, image, autolink and reference link inside a
   * setext heading was silently dropped.** The `if (!inline) return` read as a guard
   * against a heading with no text, and it was in fact a guard that matched half the
   * heading forms.
   *
   * The population is small and it is stated rather than inflated: 76 setext headings in a
   * 1,200-file corpus draw, of which 17 files carry one, and a whole-corpus scan of every
   * line whose FOLLOWING line is a setext underline and which itself contains a link found
   * **3** — `docker/vendor/github.com/hashicorp/go-immutable-radix/README.md:1`,
   * `docker/vendor/github.com/hashicorp/go-immutable-radix/v2/README.md:1`, and
   * `packer/README.md:4`. All three are H1 badge banners. Three instances is small; the
   * asymmetry inside ONE construct is the defect, and the same argument closed MD-G1 for
   * indented code blocks at a population the lane's own first estimate understated by 100x.
   * It is also a dead branch in the sense the workstream names — reachable, and always
   * taking the early return for one of the two heading forms.
   *
   * The engine already supplies the tree. `extractMarkdownInlineBlocks` walks the WHOLE
   * block tree and collects every `inline` node, so the setext paragraph's inline is in
   * `context.mdInlineStarts` under its own byte offset; nothing but this lookup was
   * missing, and no shared file changes.
   *
   * Depth is bounded to one `paragraph` hop on purpose. A heading's text is the inline
   * inside that paragraph, and reaching further would start picking up inline blocks that
   * are body content rather than heading text.
   */
  private headingInline(node: Node): Node | null {
    const direct = this.findChildByType(node, new Set(["inline"]))
    if (direct) return direct
    // SETEXT: the heading text is the paragraph's inline, one level down.
    const paragraph = this.findChildByType(node, new Set(["paragraph"]))
    if (!paragraph) return null
    return this.findChildByType(paragraph, new Set(["inline"]))
  }

  /**
   * Walk a heading node's own inline child and emit `uses` edges for every
   * link/image/autolink in the companion inline tree matched by byte offset.
   *
   * `headingInline` rather than a direct-child lookup, for the reason its own comment
   * gives: an ATX heading holds its `inline` directly and a setext heading holds it inside
   * a `paragraph`, and reading only the direct form dropped every link in every setext
   * heading in the corpus.
   */
  private emitInlineUses(
    node: Node,
    inlineByStart: Map<number, { tree: any; line: number }>,
    addRel: (source: string, type: string, target: string, metadata: Record<string, unknown>, line?: number) => void,
    source: string,
    definitions: Map<string, { destination: string; line: number }>,
    pendingAnchors?: { source: string; fragment: string; literal: string; line?: number }[],
  ): void {
    const inline = this.headingInline(node)
    if (!inline) return
    const entry = inlineByStart.get(inline.startIndex)
    if (entry?.tree?.rootNode) this.walkInlineTree(entry.tree.rootNode, addRel, source, entry.line, definitions, pendingAnchors)
  }

  /**
   * Walk a parsed inline tree and emit `uses` edges for links, images, autolinks and
   * reference links.
   *
   * Two structural facts about the companion inline grammar make this correct rather
   * than merely working, and both were measured against the pinned wasm rather than
   * read off a spec:
   *
   * 1. A link inside a `code_span` is UNREACHABLE here, structurally. The grammar
   *    gives `code_span` only ANONYMOUS children (`[`, `]`, `(`, `:`, `/`, `.`,
   *    `code_span_delimiter`) — no `link_destination` — and this walk descends NAMED
   *    children only. A `[nope](https://bad.example)` inside backticks therefore
   *    cannot be emitted, which is correct, and it is correct for a reason a reader
   *    can check rather than for the absence of a filter.
   *
   * 2. A link inside `strong_emphasis`/`emphasis` IS reachable, because those are
   *    named nodes with named children. That is also correct: `**a [x](u)**` is a link.
   *
   * `baseLine` is the 1-based FILE line of this inline block. A node row inside this
   * sub-tree is relative to the SUBSTRING the engine parsed, so `baseLine + row` is
   * the file line, and it is the only correct conversion available — which is why the
   * engine hands `mdInlineLines` over at all.
   */
  private walkInlineTree(
    root: any,
    addRel: (source: string, type: string, target: string, metadata: Record<string, unknown>, line?: number) => void,
    source: string,
    baseLine: number,
    definitions: Map<string, { destination: string; line: number }>,
    pendingAnchors?: { source: string; fragment: string; literal: string; line?: number }[],
  ): void {
    const fileLine = (node: any): number | undefined => {
      if (typeof baseLine !== "number" || baseLine <= 0) return undefined
      return baseLine + (typeof node.startPosition?.row === "number" ? node.startPosition.row : 0)
    }
    const s: any[] = [root]
    while (s.length > 0) {
      const inn = s.pop()!
      switch (inn.type) {
        case "link_destination": {
          // Only reached as a NAMED child of inline_link / image, so it is a real
          // destination and never a code span's punctuation.
          const target = inn.text.trim()
          if (target) {
            // A destination that is ONLY a fragment names a heading in THIS document,
            // so it is an internal reference and not an external one. It is deferred
            // rather than emitted here, for one reason: a link may precede the heading
            // it points at, so at this point in the walk that heading's resolved
            // spelling does not exist yet. Deferring costs one list and gets the
            // resolution exact, where a pre-pass would have had to re-derive every
            // heading's identity — and a second implementation of the identity rules
            // is exactly the failure this lane has already paid for twice (the oracle
            // and the analyzer agreeing on a name neither published, then 28.7% of
            // relationships naming symbols the file did not declare).
            if (pendingAnchors && target.charCodeAt(0) === 35 /* '#' */) {
              pendingAnchors.push({ source, fragment: target.slice(1), literal: target, line: fileLine(inn) })
            } else {
              addRel(source, ASTEngine.RelationshipType.Uses, target, { role: "markdown_link", linkText: target }, fileLine(inn))
            }
          }
          break
        }
        case "uri_autolink":
        case "email_autolink": {
          // The grammar exposes the URI/email only as the node's raw text in angle
          // brackets (no child node) — strip the brackets by position.
          const target = this.stripAngleBrackets(inn.text)
          if (target) addRel(source, ASTEngine.RelationshipType.Uses, target, { role: "markdown_autolink" }, fileLine(inn))
          break
        }
        case "full_reference_link":
        case "collapsed_reference_link":
        case "shortcut_link": {
          this.emitReferenceLink(inn, addRel, source, definitions, fileLine(inn))
          break
        }
        case "image": {
          // An image in reference form carries a `link_label` instead of a
          // `link_destination`; in inline form the destination is a named child and
          // was already handled by the `link_destination` arm above.
          const labelNode = this.findChildByTypeAny(inn, new Set(["link_label"]))
          if (labelNode) {
            this.emitReferenceLink(inn, addRel, source, definitions, fileLine(inn), this.stripBrackets(labelNode.text))
          }
          break
        }
      }
      for (let i = inn.namedChildCount - 1; i >= 0; i--) {
        const c = inn.namedChild(i)
        if (c) s.push(c)
      }
    }
  }

  /**
   * A reference link's edge points at the DESTINATION the document declares.
   *
   * A reference link with NO matching `link_reference_definition` is NOT published,
   * and that is the specification rather than a noise heuristic. CommonMark: "If a
   * link reference definition has not been defined for the link label, then it is not
   * a link" — the construct renders as literal text. So `[1]` in a legal notice, or
   * `[missing closing paren](url` with the paren never closed, is not a link and
   * emitting an edge to a target named `1` would be a fabricated endpoint.
   *
   * Measured, not assumed: publishing the undefined case produced 171 edges across 34
   * of the lane's 738 corpus files, and sampling them showed them dominated by bare
   * bracketed citation markers — `NOTICE.md: document -> 1` six times over. Those are
   * also an R10 target-spelling problem: `1` is not a name this lane spells its
   * symbols with. Suppressing the undefined case removed 171 fabricated endpoints and
   * left the 213 genuinely-resolved reference links, which are the whole point.
   *
   * The consequence worth stating: an undefined reference is invisible rather than
   * flagged. That is a real limitation and it is a DECISION, taken because the
   * alternative measures as fabrication.
   */
  private emitReferenceLink(
    node: any,
    addRel: (source: string, type: string, target: string, metadata: Record<string, unknown>, line?: number) => void,
    source: string,
    definitions: Map<string, { destination: string; line: number }>,
    line: number | undefined,
    knownLabel?: string,
  ): void {
    // `[text][ref]` carries the reference in a `link_label`; `[ref][]` and `[ref]`
    // carry it in the link text, which IS the label.
    const label = knownLabel ?? this.referenceLabelOf(node)
    if (!label) return
    const defined = definitions.get(label)
    // Undefined => literal text, not a link. See the method comment.
    if (!defined) return
    addRel(
      source,
      ASTEngine.RelationshipType.Uses,
      defined.destination,
      { role: "markdown_link", linkText: label, linkForm: node.type, resolvedVia: "link_reference_definition" },
      line,
    )
  }

  /** The reference label of a reference link: its `link_label`, else its link text. */
  private referenceLabelOf(node: any): string | undefined {
    const labelNode = this.findChildByTypeAny(node, new Set(["link_label"]))
    if (labelNode) {
      const t = this.stripBrackets(labelNode.text)
      if (t) return t
    }
    const textNode = this.findChildByTypeAny(node, new Set(["link_text"]))
    if (textNode) {
      const t = textNode.text.trim()
      if (t) return t
    }
    return undefined
  }

  /** Strip surrounding square brackets by position, no regex. */
  private stripBrackets(text: string): string {
    const t = text.trim()
    if (t.length >= 2 && t.charCodeAt(0) === 91 && t.charCodeAt(t.length - 1) === 93) {
      return t.slice(1, -1).trim()
    }
    return t
  }

  /** `findChildByType` over a sub-parse node, which is typed `any` not `Node`. */
  private findChildByTypeAny(node: any, types: Set<string>): any {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && types.has(child.type)) return child
    }
    return null
  }

  /** Strip surrounding angle brackets by position, no regex. */
  private stripAngleBrackets(text: string): string {
    const t = text.trim()
    if (t.length >= 2 && t.charCodeAt(0) === 60 && t.charCodeAt(t.length - 1) === 62) {
      return t.slice(1, -1)
    }
    return t
  }

  /**
   * A link fragment, percent-decoded and lowercased, for comparison against a heading
   * anchor. No regex, and no `decodeURIComponent` either: that throws on a malformed
   * escape (`#100%`), and a document with a typo in a link would then fail to parse
   * rather than fail to resolve. The decode is skipped for any escape that is not a
   * valid pair of hex digits and the raw text is used instead — a fragment that
   * cannot be decoded cannot match a slug that contains only letters, digits and
   * hyphens anyway, so the fallback loses nothing that could have resolved.
   */
  private decodeFragment(frag: string): string {
    let out = ""
    for (let i = 0; i < frag.length; i++) {
      const c = frag.charCodeAt(i)
      if (c === 37 /* '%' */ && i + 2 < frag.length) {
        const hi = this.hexVal(frag.charCodeAt(i + 1))
        const lo = this.hexVal(frag.charCodeAt(i + 2))
        if (hi >= 0 && lo >= 0) {
          out += String.fromCharCode(hi * 16 + lo)
          i += 2
          continue
        }
      }
      out += frag[i]
    }
    return out.toLowerCase()
  }

  /** -1 for anything that is not a hex digit. */
  private hexVal(c: number): number {
    if (c >= 48 && c <= 57) return c - 48
    if (c >= 97 && c <= 102) return c - 87
    if (c >= 65 && c <= 70) return c - 55
    return -1
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
  /**
   * A heading's display text.
   *
   * Three grammar facts, each a defect before this round, all resolved by position
   * rather than by pattern (the lane's zero-regex property is the reason these reads
   * exist at all, and none of them needed a regex to fix).
   *
   * 1. ATX CLOSING SEQUENCE. `# H #` is the heading `H`. The grammar already splits
   *    the marker out as a named `atx_hN_marker` child, so the closing run is removed
   *    by position: everything after the last space, when that remainder is only `#`
   *    characters. Before this, such a heading published a symbol named `H #`, so a
   *    document that closed its headings and one that did not produced two different
   *    symbols for the same section.
   *
   * 2. A NAME NEVER CONTAINS A NEWLINE. A multi-line setext heading's text is its
   *    PARAGRAPH, and the paragraph holds the text plus the underline, so the
   *    previous "node text minus the last line" fallback returned every line but the
   *    underline. Measured: a two-line setext heading published
   *    `"Multi Line Title\nsecond line of paragraph"` — a name carrying an embedded
   *    newline into `ownerName`, the qualified path and every display surface. Only
   *    the first line is the heading.
   *
   * 3. AN EMPTY HEADING IS ABSENCE, NOT A NAME. `#` with no content returns undefined
   *    here, so nothing is published for it. The previous fallback returned the marker
   *    itself, so a document of empty headings published a `contains` chain of
   *    symbols named `#`, `##`, `###` — which is the M60 R7 class (a name that is
   *    not a name), one step short of the register's own `MARKER` pattern, and two
   *    sibling `##` headings named `##` collided and lost a level of hierarchy.
   *
   *    The empty case has to be caught by TYPE, not by an empty inline child: a bare
   *    `#` is `atx_heading > atx_h1_marker` with NO `inline` child at all (measured on
   *    the pinned wasm), so a guard written as "if the inline text is empty, stop"
   *    never runs for the one case it was written for, and the setext fallback
   *    rescues the marker. That is why the first attempt at this fix appeared to do
   *    nothing.
   */
  private headingText(node: Node): string | undefined {
    // ATX: the text is the inline child and nothing else. No inline child means no
    // heading, and the node's own text is the marker, which is never a name.
    if (node.type === "atx_heading") {
      const inline = this.findChildByType(node, new Set(["inline"]))
      if (!inline) return undefined
      const text = this.stripAtxClosingSequence(inline.text.trim())
      return text ? text : undefined
    }
    // Setext: the text is the paragraph's FIRST line. The underline is the last line,
    // and everything between them is continuation, not heading.
    const raw = node.text.trim()
    if (!raw) return undefined
    const nl = raw.indexOf("\n")
    const first = (nl >= 0 ? raw.slice(0, nl) : raw).trim()
    return first ? first : undefined
  }

  /**
   * Remove an ATX heading's optional closing `#` run, by position and by
   * character code — no regex. CommonMark: "The optional closing sequence of #s
   * must be preceded by spaces or tabs and may be followed by spaces or tabs only."
   * A `#` that is preceded by no space (`a#b`) is part of the text and is kept; a run
   * that is followed by other text is part of the text and is kept.
   */
  private stripAtxClosingSequence(text: string): string {
    if (text.length === 0 || text.charCodeAt(text.length - 1) !== 35 /* # */) return text
    let end = text.length
    while (end > 0 && text.charCodeAt(end - 1) === 35) end--
    if (end === text.length) return text
    // Everything before the run must END in a space or tab for the run to be a
    // closing sequence rather than part of the heading text.
    const before = text.charCodeAt(end - 1)
    if (before !== 32 /* space */ && before !== 9 /* tab */) return text
    return text.slice(0, end).trim()
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
