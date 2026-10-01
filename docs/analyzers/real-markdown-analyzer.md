# Markdown analyzer

## Language

- Analyzer: `src/ast/real-markdown-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-markdown.wasm` (block grammar) +
  `wasm/tree-sitter-markdown_inline.wasm` (companion inline grammar),
  loaded as `tree-sitter-markdown`
- Detection: `.md`, `.markdown` → `markdown` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine` → `RealMarkdownAnalyzer`

## Two-grammar design

tree-sitter-markdown is split into a block grammar and an inline grammar.
The block grammar models headings, lists, tables, code fences, block quotes,
and front matter as nodes, but leaves **inline content** (`paragraph →
inline`, heading `inline`) as an opaque text node — links/images/autolinks
are NOT nodes in the block grammar. The engine therefore pre-parses every
inline block with the companion inline grammar and hands the parsed trees to
the analyzer via `context.mdInlineTrees`/`mdInlineStarts` (byte offsets),
mirroring the vue/svelte SFC pre-parse. The analyzer matches each `inline`
node back to its tree by byte offset, so every link fact is AST-derived —
the old analyzer's regex heading-stripping and its complete absence of link
extraction are both gone.

## Symbol contract

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| ATX heading (`#`..`######`) | `type` | `atx_heading` + `atx_hN_marker` | heading text |
| Setext heading (`===`/`---` underline) | `type` | `setext_heading` + `setext_hN_underline` | heading text |
| Pipe table | `class` | `pipe_table` | header cells joined by `/` |
| Fenced code block | `function` | `fenced_code_block` + `info_string` → `language` | `code_block.<lang>` |
| Front matter (`---` block) | `namespace` | `minus_metadata` | `front_matter` |

Heading ownership follows the document hierarchy: an h2 is owned by the
enclosing h1, an h3 by the enclosing h2, and so on (the M11 contract `ATX
headings as type; heading hierarchy via parent chain`). Table columns are
emitted as `contains` children of the table symbol.

## Relationship ontology

- `contains`: heading → nested heading, table, code fence; table → column.
- `uses`: owning heading/document → every link destination, image source,
  URI autolink, and email autolink resolved from the inline grammar (links
  inside paragraphs, lists, and block quotes attach to the enclosing
  heading).

## Supported constructs

- ATX headings h1–h6 and setext headings (both underline forms), with full
  hierarchy ownership.
- YAML front matter (`---` at document start), pipe tables with column
  extraction, fenced code blocks with language detection.
- Links (inline and reference destinations), images, URI autolinks
  (`<https://...>`), email autolinks (`<user@host>`), anchors, relative
  paths — all from the inline grammar.

## Unsupported / explicit boundaries

- HTML blocks and `<details>` inside numbered-list items: valid CommonMark
  that the vendored block grammar recovers from with ERROR nodes (named in
  `markdown-corpus-errors.json`).
- `||` inside a pipe-table cell (the literal `|` inside a code span breaks
  the row) and a heading at EOF without trailing newline: two more valid
  edge constructs the block grammar does not model, recorded explicitly.
- Task-list markers and list markers are not symbols (noise).

## Regex inventory

Zero regex literals and zero `RegExp` calls. Autolink angle brackets are
stripped by position (`charCodeAt(0) === 60 && last === 62`), and heading
levels come from the `atx_hN_marker`/`setext_hN_underline` node types. The
machine-checked census is `validation/m12/results/regex-census.json`
(markdown: 4 → 0).

## Complexity envelope

Measured in `validation/m12/results/markdown-corpus-complexity.json`:
one production `parseFile` pass per acceptance file; single iterative DFS
over the block tree; O(1) byte-offset map from the engine's inline
pre-parse; Map-backed symbol dedupe; Set-backed relationship dedupe —
O(block nodes + inline facts), no per-symbol O(n) scans. Corpus:
`scala3@18df09c` (738 tracked `.md` files).

## Verification

- Differential: `validation/m12/results/markdown-differential.json` — 59
  facts, precision/recall 1.000, 0 FP/FN/unknown.
- Contract: `validation/m12/results/markdown-contract.json` — 31/31.
- Shape: `validation/m12/results/markdown-shape-safety.json` — 28
  referenced node types (block + inline grammars), 28 live, 0 dead,
  43 observed.
- Corpus: `validation/m12/results/markdown-corpus-errors.json` — 738
  tracked, 734 clean, 4 named grammar limits, 0 unexpected, 0 crashes.
