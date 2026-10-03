/**
 * MARKDOWN'S RULING TABLE — the six types this lane does not emit, each with an
 * instrument, a probe, a measured count and the condition that would overturn it.
 *
 * ## Why this file exists rather than a block in the arbiter
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter for the whole ontology
 * workstream and it is SHARED (workstream §8), so this table is a separate module and the
 * wiring — one import and one `RULED_BY_LANG` entry — is a supervisor item. That is the
 * arrangement `BASH_RULED` and `JSON_RULED` set, followed here exactly as
 * `css`/`nim`/`protobuf`/`clean`/`powershell`/`julia`/`scss`/`solidity`/`yaml`/`sql`
 * were added in this wave.
 *
 * Until the wiring lands, `npx tsx script/m14/ontology-coverage-gate.ts markdown`
 * parses the whole admitted corpus and then exits 2 with
 * `no RULING TABLE for markdown` — a verdict about the TABLE, not about the lane, which
 * is the gate refusing to guess correctly.
 *
 * ## WHAT IS IN THIS TABLE, and what is deliberately not
 *
 * Four types — `contains`, `uses`, `references`, `imports` — are EMITTED by production
 * `parseFile` and carry NO row, because the arbiter checks emission first and a row for
 * an emitted type is never read. The absence of a row is therefore the verdict, and it is
 * not an omission:
 *
 *   contains    7,603 edges / 322 files   both ends resolve 100.0%
 *   uses       10,709 edges / 626 files   0 resolve at the target, by construction
 *   references   3,557 edges / 382 files   both ends resolve 100.0%
 *   imports         68 directives on the corpus, one per file-naming include directive
 *
 * The six below are the ones the corpus was measured to say the language cannot express,
 * or measured to say the construct exists and the lane reads it (MD-G3, `imports`, which
 * began as a ruling in this table's own draft and did not survive its own probe).
 *
 * ## The instrument for each row, and why
 *
 * **A: grammar-inventory** where the construct would need a node type the language does
 * not have. The denominator is the **union of both pinned grammars — 104 distinct node
 * types**, 82 from the block grammar and 59 from the companion inline grammar over a
 * 1,200-file draw (`validation/m60/markdown/pass2-labelling-probe.json`,
 * `instrumentA`). The 47 the first version of this lane's probe reported were the BLOCK
 * grammar alone while its own header claimed both; the union is the honest denominator
 * and it is the one every A row below is stated against.
 *
 * **B: parse-tree-count** where the language CAN express the construct and only a count
 * on the tree can tell. Two rows use it and both were written because the naive version
 * of the probe returned a large NON-ZERO number on the wrong question, which is recorded
 * in each row rather than quietly replaced by the probe that agreed with the ruling.
 */
export type Ruled = {
  type: "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

/**
 * `extends` and `implements` share a row's reasoning and are kept as two rows because the
 * arbiter reports per type and a reader asking about one should not have to know the
 * other exists. The node-type lists are the union of what an inheritance clause is called
 * across the pinned grammars in this repository; none is in markdown's 104.
 */
export const MARKDOWN_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "class_declaration",
      "class",
      "class_specifier",
      "interface_declaration",
      "trait_declaration",
      "struct_declaration",
      "inheritance_specifier",
      "superclass",
      "base_class",
      "type_declaration",
    ],
    describe:
      "a type declaration, or a supertype clause inside one. Markdown has no type system: a document declares SECTIONS, and a section is contained in a section rather than inheriting from it — which is `contains`, and is emitted (7,603 edges, both ends resolving 100.0%). Measured: 0 of the 104 node types either pinned grammar produces across a 1,200-file draw is any of the ten names above. OVERTURN: the grammar instantiating a type-declaration or superclass node on this corpus, which `validation/m14/grammar-pins.json` is drift-gated against on `typeSetDigest`.",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "implements_clause",
      "extends_clause",
      "interface_implementation",
      "superclass",
      "base_class",
      "constraint",
      "protocol_conformance",
      "mixin",
    ],
    describe:
      "a clause naming a type as implemented, satisfied or conformed to. Markdown has no types and nothing to conform to, so there is no construct to name and no endpoint an edge could carry. Measured: 0 of the 104 node types either pinned grammar produces is any of the eight names above. OVERTURN: the grammar instantiating a supertype or conformance clause, or a corpus construct that binds a document to another by contract — which is what a markdown `{% include %}` IS, and that construct is `imports` rather than `implements` because it binds by file, not by type.",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "new_expression",
      "object_creation_expression",
      "constructor_invocation",
      "class_instance",
      "instance_expression",
      "jsx_element",
      "component_element",
      "tag_name",
    ],
    describe:
      "a construction of a value from a named type. Two measurements, because a grammar alone would leave the second open. (1) 0 of the 104 node types either pinned grammar produces is any of the eight names above. (2) The language CAN spell an embedded program — 6,243 fenced code blocks in the same 1,200-file draw carry an `info_string` naming another language (1,807 javascript/js/jsx/ts/tsx, 827 bash, 320 yaml, 311 ts) — and none of them is markdown instantiating anything: the fence is quoted text, and the `calls` in it belong to that language's lane. A component-style reading was measured too and is 0: `html_block` carries 1,802 nodes in the draw, of which 10 contain a `<script>` tag, NONE carries a `src`, 2 carry a `<style>`/`<link>`, and 0 `html_tag` in the corpus has a capitalised name (`construct-probe.json` B4), so there is no `Vue`-style capitalised component being used as a component. OVERTURN: a capitalised tag name inside an `html_block`, or any grammar node expressing a construction.",
  },
  {
    type: "exports",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "export_statement",
      "export_declaration",
      "module_exports",
      "public_declaration",
      "visibility_modifier",
      "package_declaration",
      "manifest",
      "plugin_registration",
    ],
    describe:
      "a declaration that publishes a name for a CONSUMER to bind to. A markdown file is a document, not a module: it has no surface another document imports by name. Measured two ways, because this is the type where json's lane recorded that a grammar cannot see a CONVENTION. (1) 0 of the 104 node types either pinned grammar produces is any of the eight names above. (2) The convention probe — the one json's `exports` ruling was overturned by — reads the document's own reserved positions: front matter and the first H1, 193 occurrences in 193 files on the draw (`construct-probe.json` B6). Every one of the 193 names THE DOCUMENT ITSELF, so the edge would be a self-edge, and a `document -> document` self-edge is the M60 R7 class, not an export. The declaration the corpus does carry — a Jekyll `title:`/`permalink:` key — is inside `minus_metadata`, which has **zero named children** (319 nodes in 319 files, `construct-probe.json` A1), so the key is text inside an opaque node and naming it would be a text rule with no node behind it. OVERTURN: a document publishing a name that a DIFFERENT document in the corpus binds to, which is a measurement and not a reading: parse both documents and look for the pair.",
  },
  {
    type: "overrides",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "redefinition",
      "override_specifier",
      "declaration_replacement",
      "duplicate_definition",
      "method_declaration",
      "member_redeclaration",
    ],
    describe:
      "a second declaration that REPLACES a prior one, leaving the first unreachable. The naive probe is the bash one — a second declaration of a name already declared in the file — and on markdown it returns a LARGE non-zero number on the wrong question: 570 same-parent, same-level, same-text heading redeclarations in 23 of 1,200 files (`overrides-probe.json` A; `## Dependencies > ### Added` twice in `kubernetes/CHANGELOG/CHANGELOG-1.23.md`, `### Feature` twice under `## Changes by Kind`), and 2,453 repeated heading texts at any scope in 50 files (probe B). Those are two SECTIONS that share a title, not one replacing the other: CommonMark renders both, and the renderer's own rule gives each a DISTINCT anchor — `slug`, then `slug-1`, `slug-2`. That is measured rather than asserted: 224 anchors in 61 files are held by more than one heading (`overrides-probe.json` C — `#fixed-fields` held by 26 headings in `openapi-spec/versions/3.0.2.md`) and 0 of them displace, because the ordinal exists. The analyzer implements that rule and `markdown/internal-anchor-links` pins it on `Duplicate` and `Duplicate#2`. So the count that decides this ruling is 570 redeclarations and 0 displacements, and the second number is what the type means. 0 of the 104 node types is any of the six names above. OVERTURN: a heading becoming unreachable after a later one claims its anchor — which would mean a renderer that does NOT ordinal repeats, and would be caught by `markdown/internal-anchor-links` and by the `Duplicate#2` row rather than by this probe.",
  },
  {
    type: "calls",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "call_expression",
      "call",
      "function_call",
      "invocation",
      "method_invocation",
      "arguments",
      "command",
      "function_definition",
      "method_definition",
    ],
    describe:
      "an invocation of a named callable. Markdown has no callables: it is a document format, and a document does not call anything. 0 of the 104 node types either pinned grammar produces is any of the nine names above. The measured alternative is the one that matters, because markdown demonstrably CARRIES other languages' programs: 6,243 fenced code blocks in the 1,200-file draw declare another language in their info string, and those programs are quoted text — the fence is the construct markdown has, and a call inside one is a fact about the fenced language, derivable only by that language's analyzer reading the fence, which is a different lane's decision and not a markdown relationship. Emitting `calls` from fence content would put an edge in the graph whose endpoints are names no markdown file declares, and `bb_impact` would then offer to rewrite a caller that does not exist. The delegation alternative was measured on the one construct that could carry it: `html_block` holds 1,802 nodes in the draw, 10 contain a `<script>` tag and NONE carries a `src`, so there is no embedded program this lane could delegate even if delegating were in scope. OVERTURN: a `calls` edge derivable from markdown's OWN nodes — which instrument A would report the moment the grammar produced a call node, and which the `html_block` measurement says is 0 of 1,802 sites.",
  },
]

export default MARKDOWN_RULED